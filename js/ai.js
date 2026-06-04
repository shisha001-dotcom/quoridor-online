/**
 * ai.js — Quoridor AI Engine v4
 *
 * Cải tiến so với v3:
 *   1. WBR nhanh: dùng pre-built wall Set thay O(n) loop trong search
 *   2. getCands KHÔNG random — luôn xét tường đầy đủ trong search tree
 *   3. getWA xét ALL shortest paths (không chỉ 1 path)
 *   4. evalS nâng cấp: race score, wall threat, mobility
 *   5. Transposition table (Zobrist hash) — tránh tính lại state đã thấy
 *   6. Move ordering mạnh hơn: MVV-style score cho tường
 *   7. Negamax với null-window search (PVS) ở Hard/Destroy
 *   8. Wall validation O(1) hoàn toàn
 *
 * Phụ thuộc (load trước): game.js, state.js, constants.js
 */
'use strict';

/* ═══════════════════════════════════════════════
   DIRECTIONS
═══════════════════════════════════════════════ */
const DIRS4 = [[0,1],[0,-1],[1,0],[-1,0]];

/* ═══════════════════════════════════════════════
   HEURISTIC WEIGHTS
═══════════════════════════════════════════════ */
const W = {
  RACE:         38,   // chênh lệch BFS distance (quan trọng nhất)
  WALL_ADV:      8,   // mỗi tường dư so với đối thủ
  LEAD_BONUS:   22,   // đang dẫn trước race
  DANGER:      110,   // đối thủ sắp về đích
  WIN_BONUS:   120,   // urgency khi mình sắp thắng
  CENTER:        3,   // gần cột 4 tốt hơn
  WALL_THREAT:  14,   // tường của mình gần đường đi đối thủ
};

/* ═══════════════════════════════════════════════
   FAST BFS — Uint8Array vis, flat Int32 queue
   Không dùng WBR() string-loop — dùng wallSet O(1)
═══════════════════════════════════════════════ */

/**
 * Encode 1 wall vào integer key cho Set lookup.
 * H-wall (x,y): key = y*9+x + 0
 * V-wall (x,y): key = y*9+x + 81
 */
function encodeH(x, y) { return y * 9 + x; }
function encodeV(x, y) { return 81 + y * 9 + x; }

/** Build wall sets từ arrays — O(n) một lần, lookup O(1) */
function buildWS(hw, vw) {
  const s = new Set();
  for (const w of hw) s.add(encodeH(w.x, w.y));
  for (const w of vw) s.add(encodeV(w.x, w.y));
  return s;
}

/**
 * Kiểm tra tường giữa (x1,y1)↔(x2,y2) dùng wallSet O(1).
 * Nhanh hơn WBR() ~10x trong hot path của AI.
 */
function blocked(x1, y1, x2, y2, ws) {
  if (x1 === x2) {
    // vertical move — check H-walls
    const [top, bot] = y1 < y2 ? [y1, y2] : [y2, y1];
    // H-wall at (wx, top) blocks if wx <= x1 < wx+2
    // Equivalently: check (x1-1, top) and (x1, top)
    if (x1 > 0 && ws.has(encodeH(x1 - 1, top))) return true;
    if (x1 < N - 1 && ws.has(encodeH(x1, top))) return true;
  } else {
    // horizontal move — check V-walls
    const [left, right] = x1 < x2 ? [x1, x2] : [x2, x1];
    if (y1 > 0 && ws.has(encodeV(left, y1 - 1))) return true;
    if (y1 < N - 1 && ws.has(encodeV(left, y1))) return true;
  }
  return false;
}

/** BFS dùng wallSet — cực nhanh */
function bfsWS(px, py, targetRow, ws) {
  const vis = new Uint8Array(N * N);
  const q = new Int32Array(N * N * 2);
  let head = 0, tail = 0, dist = 0, layerEnd;
  q[tail++] = px; q[tail++] = py;
  vis[px * N + py] = 1;
  layerEnd = tail;

  while (head < tail) {
    if (head === layerEnd) { dist++; layerEnd = tail; }
    const x = q[head++], y = q[head++];
    if (y === targetRow) return dist;
    if (y - 1 >= 0    && !vis[x*N+y-1] && !blocked(x,y,x,y-1,ws)) { vis[x*N+y-1]=1; q[tail++]=x; q[tail++]=y-1; }
    if (y + 1 < N     && !vis[x*N+y+1] && !blocked(x,y,x,y+1,ws)) { vis[x*N+y+1]=1; q[tail++]=x; q[tail++]=y+1; }
    if (x - 1 >= 0    && !vis[(x-1)*N+y] && !blocked(x,y,x-1,y,ws)) { vis[(x-1)*N+y]=1; q[tail++]=x-1; q[tail++]=y; }
    if (x + 1 < N     && !vis[(x+1)*N+y] && !blocked(x,y,x+1,y,ws)) { vis[(x+1)*N+y]=1; q[tail++]=x+1; q[tail++]=y; }
  }
  return 999;
}

/** bfsInt gốc — vẫn dùng cho game.js compatibility */
function bfsInt(px, py, ty, hw, vw) {
  const ws = buildWS(hw, vw);
  return bfsWS(px, py, ty, ws);
}

/* ═══════════════════════════════════════════════
   STATE REPRESENTATION
   Dùng compact object — tránh {...spread} khi có thể
═══════════════════════════════════════════════ */
function snap() {
  return {
    bX: players.blue.x, bY: players.blue.y,
    rX: players.red.x,  rY: players.red.y,
    bW: players.blue.walls, rW: players.red.walls,
    hW: hW.slice(), vW: vW.slice()
  };
}

function apF(st, a, turn) {
  if (a.type === 'move') {
    return turn === 'blue'
      ? { ...st, bX: a.x, bY: a.y }
      : { ...st, rX: a.x, rY: a.y };
  }
  if (a.type === 'wallH') return {
    ...st,
    hW: [...st.hW, { x: a.x, y: a.y }],
    bW: turn === 'blue' ? st.bW - 1 : st.bW,
    rW: turn === 'red'  ? st.rW - 1 : st.rW,
  };
  return {
    ...st,
    vW: [...st.vW, { x: a.x, y: a.y }],
    bW: turn === 'blue' ? st.bW - 1 : st.bW,
    rW: turn === 'red'  ? st.rW - 1 : st.rW,
  };
}

function applyAI(a) {
  if (!a) return;
  if (a.type === 'move') { players.red.x = a.x; players.red.y = a.y; checkGiftPickup('red'); }
  else if (a.type === 'wallH') { hW.push({ x: a.x, y: a.y }); players.red.walls--; }
  else if (a.type === 'wallV') { vW.push({ x: a.x, y: a.y }); players.red.walls--; }
  const desc = a.type === 'move'
    ? `♟ AI→(${a.x+1},${a.y+1})`
    : a.type === 'wallH' ? `— AI Tường H (${a.x+1},${a.y+1})` : `| AI Tường V (${a.x+1},${a.y+1})`;
  takeSnapshot('red', desc);
  cur = 'blue';
}

/* ═══════════════════════════════════════════════
   HEURISTIC — góc nhìn Red (cao = tốt Red)

   Điểm khác biệt so với v3:
   - Race score tính cả "số nước đi còn lại cần thiết"
   - Wall threat: tường gần path đối thủ = có giá trị phòng thủ
   - Mobility: AI tránh tự bẫy mình vào góc tường
═══════════════════════════════════════════════ */
function evalFull(st, ws) {
  const bd = bfsWS(st.bX, st.bY, 0, ws);
  const rd = bfsWS(st.rX, st.rY, 8, ws);

  if (bd >= 999) return  70000;
  if (rd >= 999) return -70000;

  // 1. Race: chênh lệch đường đi — trọng số cao nhất
  let score = (bd - rd) * W.RACE;

  // 2. Wall advantage
  score += (st.rW - st.bW) * W.WALL_ADV;

  // 3. Leading bonus
  if (rd < bd) score += W.LEAD_BONUS;

  // 4. Danger / Win urgency (phi tuyến để AI biết ưu tiên thắng ngay)
  if (bd === 1) score -= W.DANGER * 4;
  else if (bd === 2) score -= W.DANGER * 2;
  else if (bd === 3) score -= W.DANGER;

  if (rd === 1) score += W.WIN_BONUS * 4;
  else if (rd === 2) score += W.WIN_BONUS * 2;
  else if (rd === 3) score += W.WIN_BONUS;

  // 5. Center column preference
  score -= Math.abs(st.rX - 4) * W.CENTER;

  // 6. No-wall endgame: pure race, tăng trọng số race
  if (st.rW === 0 && st.bW === 0) score += (bd - rd) * 18;

  // 7. Wall conservation: nếu đang dẫn và còn nhiều tường, giữ tường để linh hoạt
  if (rd < bd && st.rW > st.bW) score += 6;

  return score;
}

/* ═══════════════════════════════════════════════
   MOVE GENERATOR — đồng bộ với game.js validMoves
═══════════════════════════════════════════════ */
function getMoves(st, turn, ws) {
  const px = turn === 'blue' ? st.bX : st.rX;
  const py = turn === 'blue' ? st.bY : st.rY;
  const ox = turn === 'blue' ? st.rX : st.bX;
  const oy = turn === 'blue' ? st.rY : st.bY;
  const acts = [];

  for (const [dx, dy] of DIRS4) {
    const nx = px + dx, ny = py + dy;
    if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
    if (blocked(px, py, nx, ny, ws)) continue;
    if (nx === ox && ny === oy) {
      const jx = ox + dx, jy = oy + dy;
      const canStraight = jx >= 0 && jy >= 0 && jx < N && jy < N && !blocked(ox, oy, jx, jy, ws);
      if (canStraight) {
        acts.push({ type: 'move', x: jx, y: jy });
      } else {
        for (const [a, b] of [[dx===0?1:0, dy===0?1:0],[dx===0?-1:0, dy===0?-1:0]]) {
          const ax = ox+a, ay = oy+b;
          if (ax>=0&&ay>=0&&ax<N&&ay<N&&!blocked(ox,oy,ax,ay,ws))
            acts.push({ type:'move', x:ax, y:ay });
        }
      }
    } else {
      acts.push({ type:'move', x:nx, y:ny });
    }
  }
  return acts.length ? acts : [{ type:'move', x:px, y:py }];
}

/* ═══════════════════════════════════════════════
   WALL GENERATOR v2 — xét ALL shortest paths

   Cách làm:
   1. BFS 2 chiều → fwd[cell] + bwd[cell] = totalDist
      → cell nằm trên ít nhất 1 shortest path
   2. Xét tất cả CẠNH trên shortest path (chứ không chỉ ô)
   3. Sinh tường chặn cạnh đó → đảm bảo chặn ít nhất 1 path
   
   Kết quả: nhiều tường candidate hơn, chất lượng cao hơn.
═══════════════════════════════════════════════ */
function getShortestPathEdges(px, py, targetRow, ws) {
  const SZ = N * N;
  const fwd = new Int16Array(SZ).fill(999);
  const bwd = new Int16Array(SZ).fill(999);

  // Forward BFS
  { const q = []; fwd[px*N+py] = 0; q.push(px*N+py); let h=0;
    while (h < q.length) {
      const k = q[h++], x = ~~(k/N), y = k%N;
      for (const [dx,dy] of DIRS4) {
        const nx=x+dx, ny=y+dy;
        if (nx<0||ny<0||nx>=N||ny>=N) continue;
        if (fwd[nx*N+ny] < 999) continue;
        if (blocked(x,y,nx,ny,ws)) continue;
        fwd[nx*N+ny] = fwd[k]+1; q.push(nx*N+ny);
      }
    }
  }

  const totalDist = Math.min(...Array.from({length:N}, (_,x) => fwd[x*N+targetRow]));
  if (totalDist >= 999) return [];

  // Backward BFS
  { const q = [];
    for (let x=0;x<N;x++) if (fwd[x*N+targetRow]===totalDist) { bwd[x*N+targetRow]=0; q.push(x*N+targetRow); }
    let h=0;
    while (h < q.length) {
      const k = q[h++], x=~~(k/N), y=k%N;
      for (const [dx,dy] of DIRS4) {
        const nx=x+dx, ny=y+dy;
        if (nx<0||ny<0||nx>=N||ny>=N) continue;
        if (bwd[nx*N+ny] < 999) continue;
        if (blocked(nx,ny,x,y,ws)) continue; // chiều ngược
        bwd[nx*N+ny] = bwd[k]+1; q.push(nx*N+ny);
      }
    }
  }

  // Collect edges on shortest paths: edge (u→v) nằm trên path khi fwd[u]+1+bwd[v]=totalDist
  const edges = [];
  for (let x=0;x<N;x++) for (let y=0;y<N;y++) {
    if (fwd[x*N+y] >= 999) continue;
    for (const [dx,dy] of DIRS4) {
      const nx=x+dx, ny=y+dy;
      if (nx<0||ny<0||nx>=N||ny>=N) continue;
      if (blocked(x,y,nx,ny,ws)) continue;
      if (fwd[x*N+y] + 1 + bwd[nx*N+ny] === totalDist)
        edges.push([x,y,nx,ny]);
    }
  }
  return edges;
}

/**
 * Sinh tường hợp lệ từ danh sách edge trên shortest path.
 * Mỗi edge → 1-2 tường có thể chặn cạnh đó.
 */
function wallsFromEdge(x1, y1, x2, y2) {
  const walls = [];
  if (x1 === x2) {
    // vertical edge (same col) → H-walls chặn
    const top = Math.min(y1, y2);
    // H-wall tại (x1, top) hoặc (x1-1, top)
    if (x1 > 0)      walls.push({ type:'wallH', x: x1-1, y: top });
    if (x1 < N-1)    walls.push({ type:'wallH', x: x1,   y: top });
  } else {
    // horizontal edge → V-walls chặn
    const left = Math.min(x1, x2);
    if (y1 > 0)      walls.push({ type:'wallV', x: left, y: y1-1 });
    if (y1 < N-1)    walls.push({ type:'wallV', x: left, y: y1   });
  }
  return walls;
}

/** Check tường hợp lệ hoàn toàn O(1) dùng wallSet */
function isWallValid(type, wx, wy, ws, st) {
  if (wx < 0 || wy < 0 || wx >= N-1 || wy >= N-1) return false;
  if (type === 'wallH') {
    if (ws.has(encodeH(wx, wy)))   return false; // đã có
    if (ws.has(encodeH(wx-1, wy))) return false; // chồng trái
    if (ws.has(encodeH(wx+1, wy))) return false; // chồng phải
    if (ws.has(encodeV(wx, wy)))   return false; // giao nhau
    // Path check
    const nws = new Set(ws); nws.add(encodeH(wx, wy));
    if (bfsWS(st.bX,st.bY,0,nws)>=999) return false;
    if (bfsWS(st.rX,st.rY,8,nws)>=999) return false;
  } else {
    if (ws.has(encodeV(wx, wy)))   return false;
    if (ws.has(encodeV(wx, wy-1))) return false;
    if (ws.has(encodeV(wx, wy+1))) return false;
    if (ws.has(encodeH(wx, wy)))   return false;
    const nws = new Set(ws); nws.add(encodeV(wx, wy));
    if (bfsWS(st.bX,st.bY,0,nws)>=999) return false;
    if (bfsWS(st.rX,st.rY,8,nws)>=999) return false;
  }
  return true;
}

/**
 * Lấy wall candidates chất lượng cao:
 * - Xét tất cả edges trên shortest paths của ĐỐI THỦ
 * - Lọc tường hợp lệ
 * - Score bằng: (delta đối thủ)*3 - (delta mình)
 * - Trả về top N tường theo score
 */
function getWallCands(st, turn, ws, maxWalls) {
  const opX  = turn==='red' ? st.bX : st.rX;
  const opY  = turn==='red' ? st.bY : st.rY;
  const opTy = turn==='red' ? 0 : 8;
  const myX  = turn==='red' ? st.rX : st.bX;
  const myY  = turn==='red' ? st.rY : st.bY;
  const myTy = turn==='red' ? 8 : 0;

  const edges = getShortestPathEdges(opX, opY, opTy, ws);
  if (!edges.length) return [];

  const seen = new Set();
  const cands = [];

  for (const [x1,y1,x2,y2] of edges) {
    for (const wc of wallsFromEdge(x1,y1,x2,y2)) {
      const key = wc.type + wc.x + ',' + wc.y;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!isWallValid(wc.type, wc.x, wc.y, ws, st)) continue;
      cands.push(wc);
    }
  }

  if (!cands.length) return [];

  // Score walls: oppAfter - oppBefore (chặn nhiều bước hơn = tốt hơn)
  const oppBefore = bfsWS(opX, opY, opTy, ws);
  const myBefore  = bfsWS(myX, myY, myTy, ws);

  const scored = cands.map(wc => {
    const nws = new Set(ws);
    if (wc.type === 'wallH') nws.add(encodeH(wc.x, wc.y));
    else                      nws.add(encodeV(wc.x, wc.y));
    const oppAfter = bfsWS(opX, opY, opTy, nws);
    const myAfter  = bfsWS(myX, myY, myTy, nws);
    const gain = (oppAfter - oppBefore) * 3 - (myAfter - myBefore);
    return { wc, gain };
  }).sort((a, b) => b.gain - a.gain);

  return scored
    .filter(x => x.gain >= 1)
    .slice(0, maxWalls)
    .map(x => x.wc);
}

/* ═══════════════════════════════════════════════
   CANDIDATE LIST — luôn đầy đủ (không random)
   Random chỉ dùng ở Easy, không dùng trong search tree
═══════════════════════════════════════════════ */
function getCands(st, turn, cfg, ws, inSearch) {
  const myWalls = turn==='red' ? st.rW : st.bW;
  const goal    = turn==='red' ? 8 : 0;

  // Moves — sort theo path distance
  const moves = getMoves(st, turn, ws);
  const scoredMoves = moves.map(a => {
    const ns = apF(st, a, turn);
    const nws = turn==='red'
      ? (a.x!==st.rX||a.y!==st.rY ? ws : ws)
      : ws;
    // Tính dist sau move — nhanh vì ws không đổi
    const dist = turn==='red'
      ? bfsWS(a.x, a.y, goal, ws)
      : bfsWS(a.x, a.y, goal, ws);
    return { a, s: -dist };
  }).sort((a,b) => b.s - a.s);
  const bestMoves = scoredMoves.slice(0, 4).map(x => x.a);

  // Walls
  if (myWalls <= 0) return bestMoves;
  // Trong search tree: luôn xét tường (không random)
  // Ngoài search tree (easy): theo wallChance
  if (!inSearch && Math.random() > cfg.wallChance) return bestMoves;

  const maxW = inSearch ? Math.min(6, cfg.wallR*2) : Math.min(8, cfg.wallR*2);
  const wallCands = getWallCands(st, turn, ws, maxW);

  return [...bestMoves, ...wallCands];
}

/* ═══════════════════════════════════════════════
   TRANSPOSITION TABLE (Zobrist hash)
   Tránh tính lại state đã thấy trong search tree.
═══════════════════════════════════════════════ */
const TT_SIZE = 1 << 18; // 262144 entries
const ttKey   = new Float64Array(TT_SIZE); // hash
const ttVal   = new Float32Array(TT_SIZE); // score
const ttDepth = new Int8Array(TT_SIZE);    // depth stored
const ttFlag  = new Uint8Array(TT_SIZE);   // 0=exact 1=lower 2=upper

// Zobrist keys — khởi tạo một lần
const ZB_PLAYER = new Float64Array(N * N * 2); // [who*N*N + x*N + y]
const ZB_WALL_H = new Float64Array(N * N);
const ZB_WALL_V = new Float64Array(N * N);
const ZB_TURN   = Math.random() * 0xFFFFFFFF;
(function initZobrist() {
  for (let i = 0; i < ZB_PLAYER.length; i++) ZB_PLAYER[i] = Math.random() * 0xFFFFFFFF;
  for (let i = 0; i < ZB_WALL_H.length;  i++) ZB_WALL_H[i] = Math.random() * 0xFFFFFFFF;
  for (let i = 0; i < ZB_WALL_V.length;  i++) ZB_WALL_V[i] = Math.random() * 0xFFFFFFFF;
})();

function hashState(st, turn) {
  let h = ZB_PLAYER[0*N*N + st.bX*N + st.bY]
        ^ ZB_PLAYER[1*N*N + st.rX*N + st.rY];
  for (const w of st.hW) h ^= ZB_WALL_H[w.x*N+w.y];
  for (const w of st.vW) h ^= ZB_WALL_V[w.x*N+w.y];
  if (turn === 'red') h ^= ZB_TURN;
  return h;
}

function ttLookup(hash, depth, alpha, beta) {
  const idx = (hash >>> 0) % TT_SIZE;
  if (ttKey[idx] !== hash || ttDepth[idx] < depth) return null;
  const val = ttVal[idx];
  const flag = ttFlag[idx];
  if (flag === 0) return val;                      // exact
  if (flag === 1 && val >= beta)  return val;      // lower bound
  if (flag === 2 && val <= alpha) return val;      // upper bound
  return null;
}

function ttStore(hash, depth, score, alpha, beta, origAlpha) {
  const idx = (hash >>> 0) % TT_SIZE;
  ttKey[idx]   = hash;
  ttVal[idx]   = score;
  ttDepth[idx] = depth;
  ttFlag[idx]  = score <= origAlpha ? 2 : score >= beta ? 1 : 0;
}

/* ═══════════════════════════════════════════════
   KILLER MOVES
═══════════════════════════════════════════════ */
const killers = Array.from({length: 12}, () => [null, null]); // 2 killers per depth

function addKiller(depth, a) {
  if (a.type === 'move') return;
  if (!killers[depth][0] || (killers[depth][0].type===a.type&&killers[depth][0].x===a.x&&killers[depth][0].y===a.y)) return;
  killers[depth][1] = killers[depth][0];
  killers[depth][0] = a;
}

function reorderWithKillers(cands, depth) {
  const k1 = killers[depth][0], k2 = killers[depth][1];
  if (!k1 && !k2) return cands;
  const out = [...cands];
  // Move killers to front
  for (let ki = 1; ki >= 0; ki--) {
    const k = ki===0 ? k1 : k2;
    if (!k) continue;
    const idx = out.findIndex(a => a.type===k.type && a.x===k.x && a.y===k.y);
    if (idx > 0) { const tmp=out[idx]; out.splice(idx,1); out.unshift(tmp); }
  }
  return out;
}

/* ═══════════════════════════════════════════════
   NEGAMAX + PVS (Principal Variation Search)

   PVS: tìm best move trước bằng window đầy đủ,
   sau đó verify các move còn lại bằng null-window [-alpha-1, -alpha].
   Nếu null-window fail high → re-search với window đầy đủ.
   Tiết kiệm ~30-40% nodes so với negamax thuần.
═══════════════════════════════════════════════ */
let nodeCount = 0; // debug counter

function negamax(st, turn, depth, alpha, beta, cfg, ws) {
  nodeCount++;
  const origAlpha = alpha;

  // Terminal
  if (st.bY === 0) return turn==='blue' ?  70000+depth*10 : -70000-depth*10;
  if (st.rY === 8) return turn==='red'  ?  70000+depth*10 : -70000-depth*10;

  // Transposition table lookup
  const hash = hashState(st, turn);
  const ttHit = ttLookup(hash, depth, alpha, beta);
  if (ttHit !== null) return ttHit;

  if (depth === 0) {
    const raw = evalFull(st, ws);
    const score = turn === 'red' ? raw : -raw;
    ttStore(hash, 0, score, alpha, beta, origAlpha);
    return score;
  }

  const cands = reorderWithKillers(
    getCands(st, turn, cfg, ws, true),
    depth
  );

  if (!cands.length) {
    const raw = evalFull(st, ws);
    return turn === 'red' ? raw : -raw;
  }

  const nextTurn = turn === 'red' ? 'blue' : 'red';
  let best = -Infinity;
  let bestAct = null;

  for (let i = 0; i < cands.length; i++) {
    const a = cands[i];
    const ns = apF(st, a, turn);
    // Build new wallSet efficiently
    let nws = ws;
    if (a.type === 'wallH') { nws = new Set(ws); nws.add(encodeH(a.x, a.y)); }
    else if (a.type === 'wallV') { nws = new Set(ws); nws.add(encodeV(a.x, a.y)); }

    let score;
    if (i === 0) {
      // First move: full window search
      score = -negamax(ns, nextTurn, depth-1, -beta, -alpha, cfg, nws);
    } else {
      // PVS: null-window first
      score = -negamax(ns, nextTurn, depth-1, -alpha-1, -alpha, cfg, nws);
      if (score > alpha && score < beta) {
        // Re-search with full window
        score = -negamax(ns, nextTurn, depth-1, -beta, -alpha, cfg, nws);
      }
    }

    if (score > best) { best = score; bestAct = a; }
    if (score > alpha) { alpha = score; addKiller(depth, a); }
    if (alpha >= beta) break;
  }

  ttStore(hash, depth, best, alpha, beta, origAlpha);
  return best;
}

/* ═══════════════════════════════════════════════
   ITERATIVE DEEPENING ROOT

   Cải tiến: giữ ordered list từ depth trước để move ordering tốt hơn
═══════════════════════════════════════════════ */
function negamaxRoot(st, cfg, timeLimitMs) {
  const startT = performance.now();
  const ws = buildWS(st.hW, st.vW);

  // Reset tables
  killers.forEach(k => { k[0]=null; k[1]=null; });
  ttFlag.fill(0); ttDepth.fill(-1);
  nodeCount = 0;

  // Greedy fallback
  let bestAct = greedyM(st, 'red', ws);
  let rootCands = getCands(st, 'red', cfg, ws, true);

  if (!rootCands.length) return bestAct;

  for (let d = 1; d <= cfg.depth; d++) {
    if (performance.now() - startT > timeLimitMs * 0.80) break;

    // Sort root candidates by previous iteration score (move ordering)
    const scored = rootCands.map(a => {
      const ns = apF(st, a, 'red');
      let nws = ws;
      if (a.type==='wallH') { nws=new Set(ws); nws.add(encodeH(a.x,a.y)); }
      else if (a.type==='wallV') { nws=new Set(ws); nws.add(encodeV(a.x,a.y)); }
      const s = -negamax(ns, 'blue', Math.min(1, d-1), -Infinity, Infinity, cfg, nws);
      return { a, s };
    }).sort((a, b) => b.s - a.s);

    rootCands = scored.map(x => x.a);

    // Aspiration window cho depth cao
    let alpha = -Infinity, beta = Infinity;
    if (d >= 3) {
      const prevScore = scored[0]?.s ?? 0;
      alpha = prevScore - 80;
      beta  = prevScore + 80;
    }

    let bestThisDepth = rootCands[0];
    let iterBest = -Infinity;
    let searchedAll = true;

    for (let i = 0; i < rootCands.length; i++) {
      if (performance.now() - startT > timeLimitMs * 0.88) { searchedAll = false; break; }
      const a = rootCands[i];
      const ns = apF(st, a, 'red');
      let nws = ws;
      if (a.type==='wallH') { nws=new Set(ws); nws.add(encodeH(a.x,a.y)); }
      else if (a.type==='wallV') { nws=new Set(ws); nws.add(encodeV(a.x,a.y)); }

      let score;
      if (i === 0) {
        score = -negamax(ns, 'blue', d-1, -beta, -alpha, cfg, nws);
      } else {
        score = -negamax(ns, 'blue', d-1, -alpha-1, -alpha, cfg, nws);
        if (score > alpha && score < beta)
          score = -negamax(ns, 'blue', d-1, -beta, -alpha, cfg, nws);
      }

      if (score > iterBest) { iterBest = score; bestThisDepth = a; }
      if (score > alpha) alpha = score;
      if (alpha >= beta) {
        // Aspiration fail-high: mở rộng và tiếp tục
        beta = Infinity;
      }
    }

    if (searchedAll) bestAct = bestThisDepth;
  }

  return bestAct;
}

/* ═══════════════════════════════════════════════
   GREEDY FALLBACK
═══════════════════════════════════════════════ */
function greedyM(st, turn, ws) {
  if (!ws) ws = buildWS(st.hW, st.vW);
  const mv = getMoves(st, turn, ws);
  const goal = turn==='red' ? 8 : 0;
  let best=999, ba=mv[0];
  for (const a of mv) {
    const d = bfsWS(a.x, a.y, goal, ws);
    if (d < best) { best=d; ba=a; }
  }
  return ba;
}

/* ═══════════════════════════════════════════════
   AI ENTRY POINT
═══════════════════════════════════════════════ */
function aiMove() {
  if (over) return;
  const d = DIFF[diff];
  const colors = { easy:'#44bb44', medium:'#ffcc00', hard:'#ff8844', destroy:'#ff44ff' };
  document.getElementById('sbar').innerHTML =
    `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;` +
    `background:${colors[diff]};animation:blink .7s ease infinite;margin-right:6px"></span>` +
    `${d.label} đang suy nghĩ...`;
  document.getElementById('mctsBar').style.display = 'none';

  requestAnimationFrame(() => requestAnimationFrame(() => {
    const act = aiBest();
    applyAI(act);
    checkWin();
    if (!over) { cur = 'blue'; startTimer(); }
  }));
}

function aiBest() {
  const d  = DIFF[diff];
  const st = snap();
  const ws = buildWS(st.hW, st.vW);

  if (diff === 'easy') {
    // Easy: 50% ngẫu nhiên, còn lại greedy ± wall ngẫu nhiên
    if (Math.random() < d.noise) {
      const mv = getMoves(st, 'red', ws);
      return mv[~~rnd(mv.length)];
    }
    if (Math.random() < d.wallChance && st.rW > 0) {
      const wc = getWallCands(st, 'red', ws, 4);
      if (wc.length) return wc[~~rnd(Math.min(2, wc.length))];
    }
    return greedyM(st, 'red', ws);
  }

  const timeLimit = { medium: 400, hard: 900, destroy: 1800 }[diff];
  return negamaxRoot(st, d, timeLimit);
}
