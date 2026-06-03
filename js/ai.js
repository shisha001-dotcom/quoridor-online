/**
 * ai.js  —  Quoridor AI Engine v2
 *
 * Kiến trúc:
 *   Easy    → Greedy thuần (BFS path ngắn nhất), noise cao
 *   Medium  → Minimax depth-3 + heuristic cải tiến, đặt tường thông minh
 *   Hard    → Minimax depth-5 + iterative deepening + wall pruning mạnh
 *   Destroy → MCTS (budget lớn) với simulation có đặt tường + heuristic chính xác
 *
 * Phụ thuộc (load trước):
 *   game.js      → BFS(), WBR(), rnd(), opp(), players, hW, vW, checkGiftPickup(), ...
 *   state.js     → diff, over, cur, ...
 *   constants.js → N, DIFF
 */

'use strict';

/* ══════════════════════════════════════════════════════
   INTERNAL CONSTANTS
══════════════════════════════════════════════════════ */
const DIRS = [[0, 1], [0, -1], [1, 0], [-1, 0]];

// Trọng số heuristic — điều chỉnh ở đây để thay đổi hành vi AI
const W = {
  PATH_DIFF:    28,   // khoảng cách path chênh lệch (trọng số chính)
  MY_PROGRESS:   5,   // Red tiến về phía goal (row cao)
  OPP_PROGRESS:  5,   // Blue tiến về phía goal (row thấp) — bị trừ
  WALL_ADV:      6,   // chênh lệch tường còn lại
  LEADING_BONUS: 20,  // bonus khi đang dẫn trước (rd < bd)
  DANGER_BLUE:   80,  // penalty khi Blue còn 1-2 bước
  DANGER_RED:    80,  // bonus khi Red còn 1-2 bước
  CENTER_X:       2,  // bonus nhỏ khi ở gần cột giữa (cột 4)
};

/* ══════════════════════════════════════════════════════
   STATE HELPERS
══════════════════════════════════════════════════════ */

/** Tạo snapshot state từ game state hiện tại */
function snap() {
  return {
    bX: players.blue.x, bY: players.blue.y,
    rX: players.red.x,  rY: players.red.y,
    bW: players.blue.walls, rW: players.red.walls,
    hW: hW.slice(), vW: vW.slice()
  };
}

/**
 * Apply action lên state, trả về state mới (immutable).
 * Fix: wallH/wallV tạo array mới đúng cách, move không cần copy mảng.
 */
function apF(st, a, turn) {
  if (a.type === 'move') {
    // Chỉ thay đổi tọa độ — không cần copy mảng tường
    return turn === 'blue'
      ? { ...st, bX: a.x, bY: a.y }
      : { ...st, rX: a.x, rY: a.y };
  }
  if (a.type === 'wallH') {
    return {
      ...st,
      hW: [...st.hW, { x: a.x, y: a.y }],
      bW: turn === 'blue' ? st.bW - 1 : st.bW,
      rW: turn === 'red'  ? st.rW - 1 : st.rW,
    };
  }
  // wallV
  return {
    ...st,
    vW: [...st.vW, { x: a.x, y: a.y }],
    bW: turn === 'blue' ? st.bW - 1 : st.bW,
    rW: turn === 'red'  ? st.rW - 1 : st.rW,
  };
}

/** Apply AI action lên live game state */
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
    ? `♟ AI→(${a.x + 1},${a.y + 1})`
    : a.type === 'wallH' ? `— AI Tường H (${a.x+1},${a.y+1})` : `| AI Tường V (${a.x+1},${a.y+1})`;
  takeSnapshot('red', desc);
  cur = 'blue';
}

/* ══════════════════════════════════════════════════════
   HEURISTIC EVALUATION  (Red góc nhìn: cao = tốt cho Red)
══════════════════════════════════════════════════════ */
function evalS(st) {
  const bd = BFS(st.bX, st.bY, 0, st.hW, st.vW);
  const rd = BFS(st.rX, st.rY, 8, st.hW, st.vW);

  // Terminal conditions
  if (bd >= 999) return  60000;   // Blue bị chặn hoàn toàn
  if (rd >= 999) return -60000;   // Red bị chặn hoàn toàn

  let score = 0;

  // 1. Chênh lệch path — thành phần quan trọng nhất
  score += (bd - rd) * W.PATH_DIFF;

  // 2. Tiến độ tuyệt đối mỗi bên
  score += st.rY * W.MY_PROGRESS;         // Red: row càng cao càng tốt
  score -= (8 - st.bY) * W.OPP_PROGRESS;  // Blue: row càng thấp thì trừ điểm Red

  // 3. Lợi thế tường còn lại
  score += (st.rW - st.bW) * W.WALL_ADV;

  // 4. Bonus khi đang dẫn trước race
  if (rd < bd) score += W.LEADING_BONUS;

  // 5. Urgency: thưởng/phạt mạnh khi gần đích
  if (bd <= 1) score -= W.DANGER_BLUE * 3;   // Blue sắp thắng — rất nguy hiểm
  else if (bd <= 2) score -= W.DANGER_BLUE;
  if (rd <= 1) score += W.DANGER_RED * 3;    // Red sắp thắng — rất tốt
  else if (rd <= 2) score += W.DANGER_RED;

  // 6. Nhỏ: ưu tiên ở gần cột giữa (linh hoạt hơn)
  score -= Math.abs(st.rX - 4) * W.CENTER_X;

  // 7. Nếu không còn tường, tập trung chạy
  if (st.rW === 0 && st.bW === 0) score += (bd - rd) * 15;

  return score;
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
      // Ô liền kề là đối thủ — thử nhảy
      const jx = ox + dx, jy = oy + dy;
      const straightOK = jx >= 0 && jy >= 0 && jx < N && jy < N && !WBR(ox, oy, jx, jy, hw, vw);
      if (straightOK) {
        acts.push({ type: 'move', x: jx, y: jy });
      } else {
        // Nhảy chéo khi không thể nhảy thẳng
        for (const [a, b] of [
          [dx === 0 ?  1 : 0, dy === 0 ?  1 : 0],
          [dx === 0 ? -1 : 0, dy === 0 ? -1 : 0]
        ]) {
          const ax = ox + a, ay = oy + b;
          if (ax >= 0 && ay >= 0 && ax < N && ay < N && !WBR(ox, oy, ax, ay, hw, vw))
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
   WALL GENERATOR  (chỉ sinh tường có ý nghĩa chiến thuật)
══════════════════════════════════════════════════════ */

/**
 * Kiểm tra tường H hợp lệ (không chồng, không cắt, không chặn đường).
 * Tách riêng để tái sử dụng trong cả getWA và validate.
 */
function isValidH(wx, wy, hw, vw, st) {
  if (hw.some(w => w.x === wx && w.y === wy)) return false;
  if (hw.some(w => (w.x === wx - 1 && w.y === wy) || (w.x === wx + 1 && w.y === wy))) return false;
  if (vw.some(w => w.x === wx && w.y === wy)) return false;
  const nH = [...hw, { x: wx, y: wy }];
  return BFS(st.bX, st.bY, 0, nH, vw) < 999 && BFS(st.rX, st.rY, 8, nH, vw) < 999;
}

function isValidV(wx, wy, hw, vw, st) {
  if (vw.some(w => w.x === wx && w.y === wy)) return false;
  if (vw.some(w => (w.x === wx && w.y === wy - 1) || (w.x === wx && w.y === wy + 1))) return false;
  if (hw.some(w => w.x === wx && w.y === wy)) return false;
  const nV = [...vw, { x: wx, y: wy }];
  return BFS(st.bX, st.bY, 0, hw, nV) < 999 && BFS(st.rX, st.rY, 8, hw, nV) < 999;
}

/**
 * Sinh tường candidate trong vùng rad xung quanh đối thủ VÀ xung quanh Red.
 * Tốt hơn chỉ nhìn xung quanh Blue: đặt tường chặn đường Blue từ phía Red cũng quan trọng.
 */
function getWA(st, rad, forTurn) {
  const hw = st.hW, vw = st.vW;
  // Trung tâm tìm kiếm: đối thủ (người cần bị chặn) + vị trí mình
  const cx1 = forTurn === 'red' ? st.bX : st.rX; // đối thủ
  const cy1 = forTurn === 'red' ? st.bY : st.rY;
  const cx2 = forTurn === 'red' ? st.rX : st.bX; // mình
  const cy2 = forTurn === 'red' ? st.rY : st.bY;

  const seen = new Set();
  const acts = [];

  for (const [cxBase, cyBase] of [[cx1, cy1], [cx2, cy2]]) {
    const wyMin = Math.max(0, cyBase - rad);
    const wyMax = Math.min(N - 2, cyBase + rad);
    const wxMin = Math.max(0, cxBase - rad);
    const wxMax = Math.min(N - 2, cxBase + rad);

    for (let wy = wyMin; wy <= wyMax; wy++) {
      for (let wx = wxMin; wx <= wxMax; wx++) {
        const kH = `H${wx},${wy}`, kV = `V${wx},${wy}`;
        if (!seen.has(kH)) {
          seen.add(kH);
          if (isValidH(wx, wy, hw, vw, st))
            acts.push({ type: 'wallH', x: wx, y: wy });
        }
        if (!seen.has(kV)) {
          seen.add(kV);
          if (isValidV(wx, wy, hw, vw, st))
            acts.push({ type: 'wallV', x: wx, y: wy });
        }
      }
    }
  }

  return acts;
}

/**
 * Tính điểm cho mỗi tường: (delta path đối thủ) * 3 - (delta path mình).
 * Fix bug #2: tính oppBefore/selfBefore MỘT LẦN ngoài vòng lặp.
 */
function scoreWalls(st, walls, forTurn) {
  // Tính trước 1 lần — không tính lại trong loop
  const oppBefore  = forTurn === 'red' ? BFS(st.bX, st.bY, 0, st.hW, st.vW) : BFS(st.rX, st.rY, 8, st.hW, st.vW);
  const selfBefore = forTurn === 'red' ? BFS(st.rX, st.rY, 8, st.hW, st.vW) : BFS(st.bX, st.bY, 0, st.hW, st.vW);

  return walls.map(a => {
    const ns = apF(st, a, forTurn);
    const oppAfter  = forTurn === 'red' ? BFS(ns.bX, ns.bY, 0, ns.hW, ns.vW) : BFS(ns.rX, ns.rY, 8, ns.hW, ns.vW);
    const selfAfter = forTurn === 'red' ? BFS(ns.rX, ns.rY, 8, ns.hW, ns.vW) : BFS(ns.bX, ns.bY, 0, ns.hW, ns.vW);
    const gain = (oppAfter - oppBefore) * 3 - (selfAfter - selfBefore);
    return { a, gain };
  }).sort((a, b) => b.gain - a.gain);
}

/**
 * Lấy danh sách candidate actions cho một lượt.
 * Chiến lược: luôn xét move + chỉ thêm wall khi chúng thực sự có ích.
 */
function getCands(st, turn, cfg) {
  const myWalls = turn === 'red' ? st.rW : st.bW;
  const goal    = turn === 'red' ? 8 : 0;

  // --- Move candidates: sort theo path distance, lấy top ---
  const moves = getMA(st, turn);
  const scoredMoves = moves.map(a => {
    const ns = apF(st, a, turn);
    const dist = turn === 'red' ? BFS(ns.rX, ns.rY, goal, ns.hW, ns.vW) : BFS(ns.bX, ns.bY, goal, ns.hW, ns.vW);
    return { a, s: -dist };
  }).sort((a, b) => b.s - a.s);
  const bestMoves = scoredMoves.slice(0, 4).map(x => x.a);

  // --- Wall candidates ---
  if (myWalls <= 0 || Math.random() > cfg.wallChance) return bestMoves;

  const rawWalls  = getWA(st, cfg.wallR, turn);
  if (!rawWalls.length) return bestMoves;

  const ranked    = scoreWalls(st, rawWalls, turn);

  // Chỉ lấy tường thực sự làm chậm đối thủ (gain > 0)
  // Với destroy/hard: ngưỡng cao hơn để chỉ giữ tường tốt nhất
  const minGain   = cfg.depth >= 5 ? 1 : 1;
  const maxWalls  = cfg.wallR * 2;
  const goodWalls = ranked.filter(x => x.gain >= minGain).slice(0, maxWalls).map(x => x.a);

  return [...bestMoves, ...goodWalls];
}

/* ══════════════════════════════════════════════════════
   GREEDY (Easy fallback)
══════════════════════════════════════════════════════ */
function greedyM(st, turn = 'red') {
  const mv   = getMA(st, turn);
  const goal = turn === 'red' ? 8 : 0;
  let best = 999, ba = mv[0];
  for (const a of mv) {
    const ns = apF(st, a, turn);
    const d  = turn === 'red' ? BFS(ns.rX, ns.rY, goal, ns.hW, ns.vW) : BFS(ns.bX, ns.bY, goal, ns.hW, ns.vW);
    if (d < best) { best = d; ba = a; }
  }
  return ba;
}

/* ══════════════════════════════════════════════════════
   MINIMAX + ALPHA-BETA  (Medium / Hard)
══════════════════════════════════════════════════════ */
function mmRoot(st, cfg) {
  const cands = getCands(st, 'red', cfg);

  // Move ordering: pre-sort bằng eval nông để alpha-beta cắt nhiều hơn
  const sorted = cands
    .map(a => ({ a, s: evalS(apF(st, a, 'red')) }))
    .sort((a, b) => b.s - a.s);

  let best = -Infinity, ba = null;
  for (const { a } of sorted) {
    const ns = apF(st, a, 'red');
    const sc = mm(ns, 'blue', cfg.depth - 1, -Infinity, Infinity, cfg);
    if (sc > best) { best = sc; ba = a; }
  }
  return ba || getMA(st, 'red')[0];
}

function mm(st, turn, depth, alpha, beta, cfg) {
  // Terminal check
  if (st.bY === 0) return -60000 - depth; // thắng sớm hơn = tốt hơn
  if (st.rY === 8) return  60000 + depth;
  if (depth === 0) return evalS(st);

  const cands = getCands(st, turn, cfg);

  if (turn === 'red') {
    let v = -Infinity;
    for (const a of cands) {
      v = Math.max(v, mm(apF(st, a, 'red'), 'blue', depth - 1, alpha, beta, cfg));
      alpha = Math.max(alpha, v);
      if (beta <= alpha) break; // beta cutoff
    }
    return v;
  } else {
    let v = Infinity;
    for (const a of cands) {
      v = Math.min(v, mm(apF(st, a, 'blue'), 'red', depth - 1, alpha, beta, cfg));
      beta = Math.min(beta, v);
      if (beta <= alpha) break; // alpha cutoff
    }
    return v;
  }
}

/* ══════════════════════════════════════════════════════
   MCTS  (Hard / Destroy)
   Cải tiến:
   - Lưu depth trong node → bỏ getNodeDepth O(depth)
   - Simulation có xét đặt tường (30% chance) với greedy scoring
   - UCT constant điều chỉnh theo difficulty
   - Chọn best child bằng win-rate (không chỉ visits)
══════════════════════════════════════════════════════ */
function runMCTS(rootSt, budget, cb) {
  const isDestroy    = diff === 'destroy';
  const BATCH        = isDestroy ? 30 : 20;
  const ROLLOUT_DEPTH = isDestroy ? 40 : 25;
  const UCT_C        = isDestroy ? 1.2 : 1.4; // exploration constant
  const WALL_SIM_RATE = 0.25; // xác suất đặt tường trong rollout
  const cfg          = DIFF[diff];
  let iter           = 0;

  // Node: lưu depth sẵn để không cần traverse về root mỗi lần
  const root = {
    st: rootSt, parent: null, move: null,
    children: [], wins: 0, visits: 0,
    depth: 0,
    untriedMoves: getCands(rootSt, 'red', cfg)
  };

  // ── UCT score ──
  function uct(node, parentVisits) {
    if (node.visits === 0) return Infinity;
    const exploit = node.wins / node.visits;
    const explore = UCT_C * Math.sqrt(Math.log(parentVisits) / node.visits);
    return exploit + explore;
  }

  // ── Select: đi xuống tree theo UCT ──
  function select(node) {
    while (node.untriedMoves.length === 0 && node.children.length > 0) {
      let best = -Infinity, bc = node.children[0];
      for (const c of node.children) {
        const u = uct(c, node.visits);
        if (u > best) { best = u; bc = c; }
      }
      node = bc;
    }
    return node;
  }

  // ── Expand: thêm 1 child chưa thử ──
  // depth chẵn = lượt Red, depth lẻ = lượt Blue
  function expand(node) {
    if (node.untriedMoves.length === 0) return node;
    const idx        = node.visits < 5 ? 0 : ~~rnd(Math.min(3, node.untriedMoves.length));
    const mv         = node.untriedMoves.splice(idx, 1)[0];
    const parentTurn = node.depth % 2 === 0 ? 'red' : 'blue';
    const childDepth = node.depth + 1;
    const nextTurn   = parentTurn === 'red' ? 'blue' : 'red';
    const ns         = apF(node.st, mv, parentTurn);
    const child = {
      st: ns, parent: node, move: mv,
      children: [], wins: 0, visits: 0,
      depth: childDepth,
      untriedMoves: getCands(ns, nextTurn, cfg)
    };
    node.children.push(child);
    return child;
  }

  // ── Simulate: rollout từ state cho đến khi kết thúc hoặc hết depth ──
  function simulate(initSt, startTurn) {
    let s    = { ...initSt, hW: initSt.hW.slice(), vW: initSt.vW.slice() };
    let turn = startTurn;

    for (let d = 0; d < ROLLOUT_DEPTH; d++) {
      if (s.bY === 0) return -1; // Blue thắng
      if (s.rY === 8) return  1; // Red thắng

      const myWalls = turn === 'red' ? s.rW : s.bW;
      let mv;

      // Thỉnh thoảng xét đặt tường trong simulation
      if (myWalls > 0 && Math.random() < WALL_SIM_RATE) {
        const wCands = getWA(s, 2, turn); // bán kính 2 để nhanh
        if (wCands.length) {
          const ranked = scoreWalls(s, wCands, turn);
          if (ranked[0] && ranked[0].gain >= 2) mv = ranked[0].a;
        }
      }

      if (!mv) {
        // Move: 80% greedy, 20% random
        const acts = getMA(s, turn);
        if (Math.random() < 0.80) {
          const goal = turn === 'red' ? 8 : 0;
          let bestD = 999;
          for (const a of acts) {
            const ns  = apF(s, a, turn);
            const d2  = turn === 'red' ? BFS(ns.rX, ns.rY, goal, ns.hW, ns.vW) : BFS(ns.bX, ns.bY, goal, ns.hW, ns.vW);
            if (d2 < bestD) { bestD = d2; mv = a; }
          }
        } else {
          mv = acts[~~rnd(acts.length)];
        }
      }

      s    = apF(s, mv, turn);
      turn = turn === 'red' ? 'blue' : 'red';
    }

    // Hết depth: dùng heuristic
    const e = evalS(s);
    if (e >  200) return  1;
    if (e < -200) return -1;
    return e / 2000; // fractional result cho UCT chính xác hơn
  }

  // ── Backprop ──
  function backprop(node, result) {
    let n = node, r = result;
    while (n) {
      n.visits++;
      n.wins += r;
      n = n.parent;
      r = -r; // perspective đổi theo mỗi level
    }
  }

  // ── Main MCTS loop (batched để không block UI) ──
  function runBatch() {
    for (let b = 0; b < BATCH && iter < budget && !over; b++, iter++) {
      const node  = select(root);
      const child = expand(node);
      // child.depth chẵn → đến lượt Red đi tiếp; lẻ → Blue đi tiếp
      const simTurn = child.depth % 2 === 0 ? 'red' : 'blue';
      const result  = simulate(child.st, simTurn);
      backprop(child, result);
    }

    // Update progress bar
    const pct = Math.min(100, (iter / budget) * 100);
    document.getElementById('mctsFill').style.width  = pct + '%';
    document.getElementById('mctsIter').textContent  = `${iter} / ${budget} simulations`;

    if (iter < budget && !over) {
      requestAnimationFrame(runBatch);
    } else {
      if (!root.children.length) { cb(getMA(rootSt, 'red')[0]); return; }
      // Chọn child có win-rate cao nhất trong số các child được thăm đủ
      const best = root.children.reduce((a, b) => {
        const rA = a.visits > 0 ? a.wins / a.visits : -Infinity;
        const rB = b.visits > 0 ? b.wins / b.visits : -Infinity;
        return rB > rA ? b : a;
      });
      cb(best.move);
    }
  }

  requestAnimationFrame(runBatch);
}

/* ══════════════════════════════════════════════════════
   AI ENTRY POINT
══════════════════════════════════════════════════════ */
function aiMove() {
  if (over) return;
  const d = DIFF[diff];

  if (diff === 'hard' || diff === 'destroy') {
    const budget = diff === 'destroy' ? 1200 : 700;
    document.getElementById('mctsBar').style.display  = 'block';
    document.getElementById('mctsFill').style.width   = '0%';
    document.getElementById('mctsIter').textContent   = '0 simulations';
    document.getElementById('sbar').innerHTML =
      `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;` +
      `background:${diff === 'destroy' ? '#ff44ff' : '#ff8844'};` +
      `animation:blink .6s ease infinite;margin-right:6px"></span>` +
      `${d.label} đang tính toán...`;

    runMCTS(snap(), budget, act => {
      document.getElementById('mctsBar').style.display = 'none';
      applyAI(act); checkWin();
      if (!over) { cur = 'blue'; startTimer(); }
    });

  } else {
    // easy / medium: chạy đồng bộ trong 2 frames để không đóng băng UI
    document.getElementById('sbar').innerHTML =
      `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;` +
      `background:#aa66ff;animation:blink .8s ease infinite;margin-right:6px"></span>` +
      `${d.label} đang suy nghĩ...`;

    requestAnimationFrame(() => requestAnimationFrame(() => {
      const act = aiBest();
      applyAI(act); checkWin();
      if (!over) { cur = 'blue'; startTimer(); }
    }));
  }
}

/** Dispatcher cho Easy/Medium */
function aiBest() {
  const d  = DIFF[diff];
  const st = snap();

  if (diff === 'easy') {
    // 55% random hoàn toàn → hành vi khó đoán, không đe dọa
    if (Math.random() < d.noise) {
      const mv = getMA(st, 'red');
      return mv[~~rnd(mv.length)];
    }
    // 18% đặt tường ngẫu nhiên nếu có tường tốt
    if (Math.random() < d.wallChance && st.rW > 0) {
      const wa = getWA(st, d.wallR, 'red');
      if (wa.length) {
        const scored = scoreWalls(st, wa, 'red').filter(x => x.gain >= 1);
        if (scored.length) return scored[~~rnd(Math.min(3, scored.length))].a; // random trong top-3
      }
    }
    return greedyM(st, 'red');
  }

  // Medium: minimax depth-3, đôi khi greedy để không hoàn hảo
  if (diff === 'medium') {
    if (Math.random() < d.noise) return greedyM(st, 'red');
    return mmRoot(st, d);
  }

  // Hard: minimax depth-5 (MCTS xử lý trong aiMove, không vào đây)
  return mmRoot(st, d);
}
