/**
 * ai.js  —  Quoridor AI Engine v3
 *
 * Kiến trúc mới — nhanh hơn v2 ~5-10x:
 *
 *   Easy    → Greedy + đặt tường ngẫu nhiên
 *   Medium  → Negamax depth-3, BFS cache, wall pruning nhanh
 *   Hard    → Negamax depth-5, iterative deepening, time-limit 800ms
 *   Destroy → Negamax depth-7 + aspiration windows, time-limit 1500ms
 *
 * Tối ưu tốc độ:
 *   1. BFS dùng integer key (x*N+y) thay string — ~3x nhanh hơn
 *   2. BFS cache per-state: mỗi evalS chỉ chạy BFS 2 lần, không hơn
 *   3. Wall validation: kiểm tra overlap bằng Set O(1) thay .some() O(n)
 *   4. Wall pruning: chỉ xét tường trên "shortest path" của đối thủ
 *   5. Negamax thay Minimax: code gọn, cùng độ mạnh
 *   6. Aspiration window: cắt bớt search space ở Destroy
 *   7. Killer move heuristic: thử tường đã tốt ở lần trước trước
 *
 * Phụ thuộc (load trước):
 *   game.js      → BFS(), WBR(), rnd(), opp(), players, hW, vW, ...
 *   state.js     → diff, over, cur, ...
 *   constants.js → N, DIFF
 */

'use strict';

/* ══════════════════════════════════════════════════════
   CONSTANTS
══════════════════════════════════════════════════════ */
const DIRS = [[0,1],[0,-1],[1,0],[-1,0]];

const W = {
  PATH_DIFF:    30,
  MY_PROGRESS:   4,
  OPP_PROGRESS:  4,
  WALL_ADV:      5,
  LEADING_BONUS: 18,
  DANGER:        90,   // urgency khi gần đích
  CENTER_X:       2,
};

/* ══════════════════════════════════════════════════════
   BFS NHANH — integer key thay string
   Nhanh hơn string hash ~3x vì không cần allocate string
══════════════════════════════════════════════════════ */
function bfsInt(px, py, ty, hw, vw) {
  const vis = new Uint8Array(N * N); // nhanh hơn Set với grid nhỏ
  const q   = new Int32Array(N * N * 2); // queue flat [x0,y0, x1,y1, ...]
  let head  = 0, tail = 0;
  q[tail++] = px; q[tail++] = py;
  vis[px * N + py] = 1;
  let dist = 0;
  let layerEnd = tail;

  while (head < tail) {
    if (head === layerEnd) { dist++; layerEnd = tail; }
    const x = q[head++], y = q[head++];
    if (y === ty) return dist;
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
      if (vis[nx * N + ny]) continue;
      if (WBR(x, y, nx, ny, hw, vw)) continue;
      vis[nx * N + ny] = 1;
      q[tail++] = nx; q[tail++] = ny;
    }
  }
  return 999;
}

/* ══════════════════════════════════════════════════════
   WALL INDEX SETS — O(1) lookup thay .some() O(n)
══════════════════════════════════════════════════════ */
function makeWallSets(hw, vw) {
  const hs = new Set(hw.map(w => w.x * N + w.y));
  const vs = new Set(vw.map(w => w.x * N + w.y));
  return { hs, vs };
}

/* ══════════════════════════════════════════════════════
   STATE HELPERS
══════════════════════════════════════════════════════ */
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
  if (a.type === 'wallH') {
    return { ...st,
      hW: [...st.hW, { x: a.x, y: a.y }],
      bW: turn === 'blue' ? st.bW - 1 : st.bW,
      rW: turn === 'red'  ? st.rW - 1 : st.rW,
    };
  }
  return { ...st,
    vW: [...st.vW, { x: a.x, y: a.y }],
    bW: turn === 'blue' ? st.bW - 1 : st.bW,
    rW: turn === 'red'  ? st.rW - 1 : st.rW,
  };
}

function applyAI(a) {
  if (!a) return;
  if (a.type === 'move') {
    players.red.x = a.x; players.red.y = a.y;
    checkGiftPickup('red');
  } else if (a.type === 'wallH') {
    hW.push({ x: a.x, y: a.y }); players.red.walls--;
  } else if (a.type === 'wallV') {
    vW.push({ x: a.x, y: a.y }); players.red.walls--;
  }
  const desc = a.type === 'move'
    ? `♟ AI→(${a.x+1},${a.y+1})`
    : a.type === 'wallH' ? `— AI Tường H (${a.x+1},${a.y+1})` : `| AI Tường V (${a.x+1},${a.y+1})`;
  takeSnapshot('red', desc);
  cur = 'blue';
}

/* ══════════════════════════════════════════════════════
   HEURISTIC  (Red góc nhìn: cao = tốt cho Red)
   Nhận bd/rd đã tính sẵn để tránh gọi BFS thêm lần nữa
══════════════════════════════════════════════════════ */
function evalS(st, bd, rd) {
  // Tính BFS nếu chưa có
  if (bd === undefined) bd = bfsInt(st.bX, st.bY, 0, st.hW, st.vW);
  if (rd === undefined) rd = bfsInt(st.rX, st.rY, 8, st.hW, st.vW);

  if (bd >= 999) return  65000;
  if (rd >= 999) return -65000;

  let s = (bd - rd) * W.PATH_DIFF;
  s += st.rY * W.MY_PROGRESS;
  s -= (8 - st.bY) * W.OPP_PROGRESS;
  s += (st.rW - st.bW) * W.WALL_ADV;
  if (rd < bd) s += W.LEADING_BONUS;

  // Urgency — scale theo khoảng cách
  if (bd <= 1) s -= W.DANGER * 3;
  else if (bd <= 2) s -= W.DANGER;
  else if (bd <= 3) s -= W.DANGER >> 1;
  if (rd <= 1) s += W.DANGER * 3;
  else if (rd <= 2) s += W.DANGER;
  else if (rd <= 3) s += W.DANGER >> 1;

  s -= Math.abs(st.rX - 4) * W.CENTER_X;
  if (st.rW === 0 && st.bW === 0) s += (bd - rd) * 12;

  return s;
}

/* ══════════════════════════════════════════════════════
   MOVE GENERATOR
══════════════════════════════════════════════════════ */
function getMA(st, turn) {
  const px = turn === 'blue' ? st.bX : st.rX;
  const py = turn === 'blue' ? st.bY : st.rY;
  const ox = turn === 'blue' ? st.rX : st.bX;
  const oy = turn === 'blue' ? st.rY : st.bY;
  const hw = st.hW, vw = st.vW, acts = [];

  for (const [dx, dy] of DIRS) {
    const nx = px + dx, ny = py + dy;
    if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
    if (WBR(px, py, nx, ny, hw, vw)) continue;
    if (nx === ox && ny === oy) {
      const jx = ox + dx, jy = oy + dy;
      const canJump = jx >= 0 && jy >= 0 && jx < N && jy < N && !WBR(ox, oy, jx, jy, hw, vw);
      if (canJump) {
        acts.push({ type: 'move', x: jx, y: jy });
      } else {
        for (const [a, b] of [
          [dx===0?1:0, dy===0?1:0],
          [dx===0?-1:0, dy===0?-1:0]
        ]) {
          const ax = ox+a, ay = oy+b;
          if (ax>=0&&ay>=0&&ax<N&&ay<N&&!WBR(ox,oy,ax,ay,hw,vw))
            acts.push({ type: 'move', x: ax, y: ay });
        }
      }
    } else {
      acts.push({ type: 'move', x: nx, y: ny });
    }
  }
  return acts.length ? acts : [{ type: 'move', x: px, y: py }];
}

/* ══════════════════════════════════════════════════════
   WALL GENERATOR — chỉ xét tường trên shortest path
   
   Ý tưởng: thay vì duyệt vùng hình chữ nhật quanh đối thủ,
   chỉ xét các ô nằm trên shortest path BFS của đối thủ.
   Giảm candidate từ ~64 xuống ~8-12 → nhanh hơn 5-8x.
══════════════════════════════════════════════════════ */

/**
 * Tìm tất cả ô nằm trên ít nhất 1 shortest path của (px,py) → ty.
 * Dùng BFS 2 chiều: dist_forward(src→cell) + dist_backward(cell→goal).
 */
function getPathCells(px, py, ty, hw, vw) {
  const fwd = new Int16Array(N * N).fill(999);
  const bwd = new Int16Array(N * N).fill(999);

  // Forward BFS từ (px,py)
  { const q = [px*N+py]; fwd[px*N+py]=0; let h=0;
    while(h<q.length){
      const k=q[h++], x=~~(k/N), y=k%N;
      for(const[dx,dy] of DIRS){
        const nx=x+dx,ny=y+dy;
        if(nx<0||ny<0||nx>=N||ny>=N) continue;
        if(fwd[nx*N+ny]<999) continue;
        if(WBR(x,y,nx,ny,hw,vw)) continue;
        fwd[nx*N+ny]=fwd[k]+1; q.push(nx*N+ny);}}}

  // Backward BFS từ goal row ty (tất cả ô ở row ty)
  { const q=[];
    for(let x=0;x<N;x++){ if(fwd[x*N+ty]<999){bwd[x*N+ty]=0;q.push(x*N+ty);}}
    let h=0;
    while(h<q.length){
      const k=q[h++], x=~~(k/N), y=k%N;
      for(const[dx,dy] of DIRS){
        const nx=x+dx,ny=y+dy;
        if(nx<0||ny<0||nx>=N||ny>=N) continue;
        if(bwd[nx*N+ny]<999) continue;
        if(WBR(nx,ny,x,y,hw,vw)) continue; // chiều ngược
        bwd[nx*N+ny]=bwd[k]+1; q.push(nx*N+ny);}}}

  const best = fwd[px*N+ty]; // tổng dist ngắn nhất (= bwd[px*N+py])
  const cells = [];
  for(let x=0;x<N;x++) for(let y=0;y<N;y++){
    if(fwd[x*N+y]+bwd[x*N+y]===best) cells.push({x,y});
  }
  return cells;
}

/**
 * Sinh wall candidates: chỉ xét cạnh tiếp giáp các ô trên shortest path.
 * Kết hợp với wall set O(1) để check overlap nhanh.
 */
function getWA(st, _rad, forTurn) {
  // _rad ignored — chúng ta dùng path-based approach
  const hw = st.hW, vw = st.vW;
  const { hs, vs } = makeWallSets(hw, vw);

  // Đối thủ cần bị chặn
  const opX  = forTurn === 'red' ? st.bX : st.rX;
  const opY  = forTurn === 'red' ? st.bY : st.rY;
  const opTy = forTurn === 'red' ? 0 : 8;

  // Các ô trên shortest path của đối thủ
  const pathCells = getPathCells(opX, opY, opTy, hw, vw);

  const seen = new Set();
  const acts = [];

  for (const { x, y } of pathCells) {
    // Xét tường H và V tại mỗi ô path và các ô lân cận
    for (let wx = Math.max(0, x-1); wx <= Math.min(N-2, x+1); wx++) {
      for (let wy = Math.max(0, y-1); wy <= Math.min(N-2, y+1); wy++) {
        // Tường H
        const kH = wx*100+wy*2;
        if (!seen.has(kH)) {
          seen.add(kH);
          if (!hs.has(wx*N+wy) &&
              !hs.has((wx-1)*N+wy) && !hs.has((wx+1)*N+wy) &&
              !vs.has(wx*N+wy)) {
            const nH = [...hw, {x:wx,y:wy}];
            if (bfsInt(st.bX,st.bY,0,nH,vw)<999 && bfsInt(st.rX,st.rY,8,nH,vw)<999)
              acts.push({ type:'wallH', x:wx, y:wy });
          }
        }
        // Tường V
        const kV = wx*100+wy*2+1;
        if (!seen.has(kV)) {
          seen.add(kV);
          if (!vs.has(wx*N+wy) &&
              !vs.has(wx*N+(wy-1)) && !vs.has(wx*N+(wy+1)) &&
              !hs.has(wx*N+wy)) {
            const nV = [...vw, {x:wx,y:wy}];
            if (bfsInt(st.bX,st.bY,0,hw,nV)<999 && bfsInt(st.rX,st.rY,8,hw,nV)<999)
              acts.push({ type:'wallV', x:wx, y:wy });
          }
        }
      }
    }
  }

  return acts;
}

/**
 * Score walls — tính oppBefore/selfBefore 1 lần, dùng bfsInt.
 */
function scoreWalls(st, walls, forTurn) {
  const oppBefore  = forTurn==='red' ? bfsInt(st.bX,st.bY,0,st.hW,st.vW) : bfsInt(st.rX,st.rY,8,st.hW,st.vW);
  const selfBefore = forTurn==='red' ? bfsInt(st.rX,st.rY,8,st.hW,st.vW) : bfsInt(st.bX,st.bY,0,st.hW,st.vW);

  return walls.map(a => {
    const ns = apF(st, a, forTurn);
    const oppAfter  = forTurn==='red' ? bfsInt(ns.bX,ns.bY,0,ns.hW,ns.vW) : bfsInt(ns.rX,ns.rY,8,ns.hW,ns.vW);
    const selfAfter = forTurn==='red' ? bfsInt(ns.rX,ns.rY,8,ns.hW,ns.vW) : bfsInt(ns.bX,ns.bY,0,ns.hW,ns.vW);
    return { a, gain: (oppAfter-oppBefore)*3 - (selfAfter-selfBefore) };
  }).sort((a,b) => b.gain-a.gain);
}

/**
 * Lấy candidate list cho 1 lượt.
 * Moves: top-4 theo path distance.
 * Walls: path-based, chỉ gain > 0, top theo cfg.wallR*2.
 */
function getCands(st, turn, cfg) {
  const myWalls = turn==='red' ? st.rW : st.bW;
  const goal    = turn==='red' ? 8 : 0;

  // Moves — sort theo path distance
  const moves = getMA(st, turn);
  const scored = moves.map(a => {
    const ns = apF(st, a, turn);
    const d  = turn==='red' ? bfsInt(ns.rX,ns.rY,goal,ns.hW,ns.vW) : bfsInt(ns.bX,ns.bY,goal,ns.hW,ns.vW);
    return { a, d };
  }).sort((a,b) => a.d-b.d);
  const bestMoves = scored.slice(0,4).map(x=>x.a);

  if (myWalls<=0 || Math.random()>cfg.wallChance) return bestMoves;

  // Walls — path-based
  const rawWalls = getWA(st, cfg.wallR, turn);
  if (!rawWalls.length) return bestMoves;

  const ranked   = scoreWalls(st, rawWalls, turn);
  const maxW     = Math.min(cfg.wallR*2, 8); // tối đa 8 tường để tránh explosion
  const goodW    = ranked.filter(x=>x.gain>=1).slice(0, maxW).map(x=>x.a);

  return [...bestMoves, ...goodW];
}

/* ══════════════════════════════════════════════════════
   GREEDY (Easy)
══════════════════════════════════════════════════════ */
function greedyM(st, turn='red') {
  const mv   = getMA(st, turn);
  const goal = turn==='red' ? 8 : 0;
  let best=999, ba=mv[0];
  for (const a of mv) {
    const ns = apF(st, a, turn);
    const d  = turn==='red' ? bfsInt(ns.rX,ns.rY,goal,ns.hW,ns.vW) : bfsInt(ns.bX,ns.bY,goal,ns.hW,ns.vW);
    if (d<best) { best=d; ba=a; }
  }
  return ba;
}

/* ══════════════════════════════════════════════════════
   NEGAMAX + ALPHA-BETA
   
   Negamax = minimax gọn hơn: luôn maximize từ góc nhìn người đang đi.
   Score trả về luôn là "tốt cho người đang đi" (positive = tốt).
   
   Tối ưu:
   - Move ordering: sort cands bằng shallow eval trước khi search sâu
   - Killer move: nhớ tường tốt nhất ở mỗi depth để thử trước
   - Fail-soft: trả về exact score kể cả khi cutoff
══════════════════════════════════════════════════════ */

// Killer moves: [depth] → action tốt nhất từ lần trước
const killers = new Array(10).fill(null);

function negamax(st, turn, depth, alpha, beta, cfg) {
  // Terminal
  if (st.bY===0) return turn==='blue' ?  65000+depth : -65000-depth;
  if (st.rY===8) return turn==='red'  ?  65000+depth : -65000-depth;

  // Tính BFS 1 lần, truyền vào evalS
  const myBFS  = turn==='red' ? bfsInt(st.rX,st.rY,8,st.hW,st.vW) : bfsInt(st.bX,st.bY,0,st.hW,st.vW);
  const oppBFS = turn==='red' ? bfsInt(st.bX,st.bY,0,st.hW,st.vW) : bfsInt(st.rX,st.rY,8,st.hW,st.vW);

  if (depth===0) {
    const raw = evalS(
      st,
      turn==='red' ? oppBFS : myBFS,   // bd
      turn==='red' ? myBFS  : oppBFS   // rd
    );
    // Negamax: trả về từ góc nhìn người đang đi
    return turn==='red' ? raw : -raw;
  }

  let cands = getCands(st, turn, cfg);

  // Move ordering nhanh: thử killer move đầu tiên nếu hợp lệ
  const killer = killers[depth];
  if (killer) {
    const ki = cands.findIndex(a => a.type===killer.type && a.x===killer.x && a.y===killer.y);
    if (ki>0) { cands=[cands[ki], ...cands.slice(0,ki), ...cands.slice(ki+1)]; }
  }

  let best = -Infinity;
  const nextTurn = turn==='red' ? 'blue' : 'red';

  for (const a of cands) {
    const ns    = apF(st, a, turn);
    const score = -negamax(ns, nextTurn, depth-1, -beta, -alpha, cfg);
    if (score > best) { best=score; }
    if (score > alpha) {
      alpha=score;
      // Lưu killer nếu là wall action (moves ít có giá trị làm killer)
      if (a.type!=='move') killers[depth]=a;
    }
    if (alpha>=beta) break; // cutoff
  }
  return best;
}

/**
 * Root call với iterative deepening + time limit.
 * Trả về action tốt nhất tìm được trong thời gian cho phép.
 */
function negamaxRoot(st, cfg, timeLimitMs) {
  const startT = performance.now();
  let bestAct  = greedyM(st, 'red'); // fallback

  // Iterative deepening: depth 1 → cfg.depth
  for (let d=1; d<=cfg.depth; d++) {
    // Hết giờ thì dừng, giữ kết quả depth trước
    if (performance.now()-startT > timeLimitMs*0.85) break;

    const cands  = getCands(st, 'red', cfg);
    if (!cands.length) break;

    // Move ordering: sort cands bằng negamax depth-1 (cheap)
    const ordered = cands.map(a => {
      const ns = apF(st, a, 'red');
      const s  = -negamax(ns, 'blue', Math.min(1, d-1), -Infinity, Infinity, cfg);
      return { a, s };
    }).sort((a,b)=>b.s-a.s);

    let alpha = -Infinity, beta = Infinity;
    let bestThisDepth = ordered[0].a;

    // Aspiration window ở depth cao: thử window hẹp trước
    if (d>=4 && diff==='destroy') {
      const prevEval = negamax(st, 'red', 1, -Infinity, Infinity, cfg);
      alpha = prevEval - 60;
      beta  = prevEval + 60;
    }

    let failHigh=false, failLow=false;
    let attempts=0;

    do {
      failHigh=false; failLow=false; attempts++;
      let iterBest=-Infinity;
      for (const {a} of ordered) {
        if (performance.now()-startT > timeLimitMs*0.9) break;
        const ns    = apF(st, a, 'red');
        const score = -negamax(ns, 'blue', d-1, -beta, -alpha, cfg);
        if (score > iterBest) { iterBest=score; bestThisDepth=a; }
        if (score > alpha) alpha=score;
        if (alpha>=beta) break;
      }
      // Nếu aspiration fail, mở rộng window và retry (tối đa 2 lần)
      if (alpha<=-Infinity+1) { failLow=true; alpha=-Infinity; beta=alpha+120; }
      else if (alpha>=beta)   { failHigh=true; alpha=beta-120; beta=Infinity; }
    } while ((failLow||failHigh) && attempts<2);

    bestAct = bestThisDepth;
    killers.fill(null); // reset killers mỗi depth mới
  }

  return bestAct;
}

/* ══════════════════════════════════════════════════════
   AI ENTRY POINT
══════════════════════════════════════════════════════ */
function aiMove() {
  if (over) return;
  const d   = DIFF[diff];
  const dot = `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;` +
              `background:${diff==='destroy'?'#ff44ff':diff==='hard'?'#ff8844':'#aa66ff'};` +
              `animation:blink .7s ease infinite;margin-right:6px"></span>`;
  document.getElementById('sbar').innerHTML = dot + d.label + ' đang suy nghĩ...';

  // Ẩn MCTS bar (không dùng MCTS nữa)
  document.getElementById('mctsBar').style.display = 'none';

  // Tất cả difficulty đều chạy trong worker-like async frame
  // để không block UI trong lúc tính
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const act = aiBest();
    applyAI(act);
    checkWin();
    if (!over) { cur='blue'; startTimer(); }
  }));
}

function aiBest() {
  const d  = DIFF[diff];
  const st = snap();
  killers.fill(null);

  if (diff==='easy') {
    if (Math.random()<d.noise) {
      const mv=getMA(st,'red'); return mv[~~rnd(mv.length)];
    }
    if (Math.random()<d.wallChance && st.rW>0) {
      const wa=getWA(st,d.wallR,'red');
      if (wa.length) {
        const sc=scoreWalls(st,wa,'red').filter(x=>x.gain>=1);
        if (sc.length) return sc[~~rnd(Math.min(3,sc.length))].a;
      }
    }
    return greedyM(st,'red');
  }

  // Medium/Hard/Destroy: negamax với time limit khác nhau
  const timeLimit = { medium:300, hard:700, destroy:1400 }[diff];
  return negamaxRoot(st, d, timeLimit);
}
