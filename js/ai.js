/**
 * ai.js
 * AI engine: Easy (greedy), Medium (1-ply minimax),
 * Hard / Destroy (MCTS + Alpha-Beta minimax).
 *
 * Phụ thuộc (load trước):
 *   - game.js  → BFS(), WBR(), rnd(), opp(), players, hW, vW, ...
 *   - state.js → diff, over, cur, ...
 *   - constants.js → N, DIFF
 */

'use strict';

/* ══════════════════════════════════
   AI ENTRY POINT
══════════════════════════════════ */
function aiMove() {
  if (over) return;
  const d = DIFF[diff];
  if (diff === 'destroy' || diff === 'hard') {
    const budget = diff === 'destroy' ? 800 : 500;
    document.getElementById('mctsBar').style.display = 'block';
    document.getElementById('mctsFill').style.width = '0%';
    document.getElementById('mctsIter').textContent = '0 simulations';
    document.getElementById('sbar').innerHTML =
      `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${diff === 'destroy' ? '#ff44ff' : '#ff8844'};animation:blink .6s ease infinite;margin-right:6px"></span>${d.label} đang tính toán...`;
    runMCTS(snap(), budget, (act) => {
      document.getElementById('mctsBar').style.display = 'none';
      applyAI(act); checkWin();
      if (!over) { cur = 'blue'; startTimer(); }
    });
  } else {
    document.getElementById('sbar').innerHTML =
      `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#aa66ff;animation:blink .8s ease infinite;margin-right:6px"></span>${d.label} đang suy nghĩ...`;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const act = aiBest(); applyAI(act); checkWin();
      if (!over) { cur = 'blue'; startTimer(); }
    }));
  }
}

/* ══════════════════════════════════
   HEURISTIC EVALUATION
   (from Red's perspective, higher = better for Red)
══════════════════════════════════ */
function evalS(st) {
  const bd = BFS(st.bX, st.bY, 0, st.hW, st.vW);
  const rd = BFS(st.rX, st.rY, 8, st.hW, st.vW);
  if (bd >= 999) return 50000;
  if (rd >= 999) return -50000;
  let score = (bd - rd) * 20;
  score += (st.rY) * 3;
  score -= (8 - st.bY) * 3;
  score += (st.rW - st.bW) * 4;
  if (rd < bd) score += 15;
  if (bd <= 2) score -= 60;
  if (rd <= 2) score += 60;
  return score;
}

/* ══════════════════════════════════
   MOVE GENERATORS
══════════════════════════════════ */
function getMA(st, turn) {
  const px = turn === 'blue' ? st.bX : st.rX, py = turn === 'blue' ? st.bY : st.rY;
  const ox = turn === 'blue' ? st.rX : st.bX, oy = turn === 'blue' ? st.rY : st.bY;
  const hw = st.hW, vw = st.vW, acts = [];
  for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
    const nx = px + dx, ny = py + dy;
    if (nx < 0 || ny < 0 || nx >= N || ny >= N || WBR(px, py, nx, ny, hw, vw)) continue;
    if (nx === ox && ny === oy) {
      const jx = ox + dx, jy = oy + dy;
      if (jx >= 0 && jy >= 0 && jx < N && jy < N && !WBR(ox, oy, jx, jy, hw, vw)) {
        acts.push({ type: 'move', x: jx, y: jy });
      } else {
        for (const [a, b] of [[dx === 0 ? 1 : 0, dy === 0 ? 1 : 0], [dx === 0 ? -1 : 0, dy === 0 ? -1 : 0]]) {
          const ax = ox + a, ay = oy + b;
          if (ax >= 0 && ay >= 0 && ax < N && ay < N && !WBR(ox, oy, ax, ay, hw, vw)) acts.push({ type: 'move', x: ax, y: ay });
        }
      }
    } else acts.push({ type: 'move', x: nx, y: ny });
  }
  return acts.length ? acts : [{ type: 'move', x: px, y: py }];
}

function getWA(st, rad, cx, cy) {
  if (cx === undefined) { cx = st.bX; cy = st.bY; }
  const acts = [], hw = st.hW, vw = st.vW;
  for (let wy = Math.max(0, cy - rad); wy <= Math.min(N - 2, cy + rad); wy++)
    for (let wx = Math.max(0, cx - rad); wx <= Math.min(N - 2, cx + rad); wx++) {
      if (!hw.some(w => w.x === wx && w.y === wy) &&
        !hw.some(w => (w.x === wx - 1 && w.y === wy) || (w.x === wx + 1 && w.y === wy)) &&
        !vw.some(w => w.x === wx && w.y === wy)) {
        const nH = [...hw, { x: wx, y: wy }];
        if (BFS(st.bX, st.bY, 0, nH, vw) < 999 && BFS(st.rX, st.rY, 8, nH, vw) < 999)
          acts.push({ type: 'wallH', x: wx, y: wy });
      }
      if (!vw.some(w => w.x === wx && w.y === wy) &&
        !vw.some(w => (w.x === wx && w.y === wy - 1) || (w.x === wx && w.y === wy + 1)) &&
        !hw.some(w => w.x === wx && w.y === wy)) {
        const nV = [...vw, { x: wx, y: wy }];
        if (BFS(st.bX, st.bY, 0, hw, nV) < 999 && BFS(st.rX, st.rY, 8, hw, nV) < 999)
          acts.push({ type: 'wallV', x: wx, y: wy });
      }
    }
  return acts;
}

function scoreWalls(st, walls, forTurn) {
  return walls.map(a => {
    const ns = apF(st, a, forTurn);
    const oppBefore = forTurn === 'red' ? BFS(st.bX, st.bY, 0, st.hW, st.vW) : BFS(st.rX, st.rY, 8, st.hW, st.vW);
    const oppAfter = forTurn === 'red' ? BFS(ns.bX, ns.bY, 0, ns.hW, ns.vW) : BFS(ns.rX, ns.rY, 8, ns.hW, ns.vW);
    const selfBefore = forTurn === 'red' ? BFS(st.rX, st.rY, 8, st.hW, st.vW) : BFS(st.bX, st.bY, 0, st.hW, st.vW);
    const selfAfter = forTurn === 'red' ? BFS(ns.rX, ns.rY, 8, ns.hW, ns.vW) : BFS(ns.bX, ns.bY, 0, ns.hW, ns.vW);
    return { a, s: (oppAfter - oppBefore) * 3 - (selfAfter - selfBefore) };
  }).sort((a, b) => b.s - a.s);
}

function getCands(st, turn, cfg) {
  const moves = getMA(st, turn);
  const walls = turn === 'red' ? st.rW : st.bW;
  const scoredMoves = moves.map(a => {
    const ns = apF(st, a, turn);
    const myDist = turn === 'red' ? BFS(ns.rX, ns.rY, 8, ns.hW, ns.vW) : BFS(ns.bX, ns.bY, 0, ns.hW, ns.vW);
    return { a, s: -myDist };
  }).sort((a, b) => b.s - a.s);
  const bestMoves = scoredMoves.slice(0, 6).map(x => x.a);
  if (walls <= 0 || Math.random() > cfg.wallChance) return bestMoves;
  const opX = turn === 'red' ? st.bX : st.rX, opY = turn === 'red' ? st.bY : st.rY;
  const rawWalls = getWA(st, cfg.wallR, opX, opY);
  if (!rawWalls.length) return bestMoves;
  const ranked = scoreWalls(st, rawWalls, turn);
  const goodWalls = ranked.filter(x => x.s >= 1).slice(0, cfg.wallR * 3).map(x => x.a);
  return [...bestMoves, ...goodWalls];
}

/* ══════════════════════════════════
   STATE HELPERS
══════════════════════════════════ */
function apF(st, a, turn) {
  const ns = { ...st, hW: st.hW, vW: st.vW };
  if (a.type === 'move') { if (turn === 'blue') { ns.bX = a.x; ns.bY = a.y; } else { ns.rX = a.x; ns.rY = a.y; } }
  else if (a.type === 'wallH') { ns.hW = [...st.hW, { x: a.x, y: a.y }]; turn === 'blue' ? ns.bW-- : ns.rW--; }
  else if (a.type === 'wallV') { ns.vW = [...st.vW, { x: a.x, y: a.y }]; turn === 'blue' ? ns.bW-- : ns.rW--; }
  return ns;
}

function snap() {
  return {
    bX: players.blue.x, bY: players.blue.y,
    rX: players.red.x, rY: players.red.y,
    bW: players.blue.walls, rW: players.red.walls,
    hW: hW.slice(), vW: vW.slice()
  };
}

function applyAI(a) {
  if (!a) return;
  if (a.type === 'move') { players.red.x = a.x; players.red.y = a.y; checkGiftPickup('red'); }
  else if (a.type === 'wallH') { hW.push({ x: a.x, y: a.y }); players.red.walls--; }
  else if (a.type === 'wallV') { vW.push({ x: a.x, y: a.y }); players.red.walls--; }
  const desc = a.type === 'move' ? `♟ AI→(${a.x + 1},${a.y + 1})` : a.type === 'wallH' ? `— AI Tường H` : `| AI Tường V`;
  takeSnapshot('red', desc);
  cur = 'blue';
}

/* ══════════════════════════════════
   GREEDY BEST MOVE
══════════════════════════════════ */
function greedyM(st, turn = 'red') {
  const mv = getMA(st, turn);
  const goal = turn === 'red' ? 8 : 0;
  let best = 999, ba = mv[0];
  for (const a of mv) {
    const ns = apF(st, a, turn);
    const d = turn === 'red' ? BFS(ns.rX, ns.rY, goal, ns.hW, ns.vW) : BFS(ns.bX, ns.bY, goal, ns.hW, ns.vW);
    if (d < best) { best = d; ba = a; }
  }
  return ba;
}

/* ══════════════════════════════════
   MINIMAX WITH ALPHA-BETA
══════════════════════════════════ */
function mmRoot(st, cfg) {
  const cands = getCands(st, 'red', cfg);
  let best = -Infinity, ba = null;
  const sorted = cands.map(a => ({ a, s: evalS(apF(st, a, 'red')) })).sort((a, b) => b.s - a.s);
  for (const { a } of sorted) {
    const ns = apF(st, a, 'red');
    const sc = mm(ns, 'blue', cfg.depth - 1, -Infinity, Infinity, cfg);
    if (sc > best) { best = sc; ba = a; }
  }
  return ba || getMA(st, 'red')[0];
}

function mm(st, turn, depth, alpha, beta, cfg) {
  if (st.bY === 0) return -50000;
  if (st.rY === 8) return 50000;
  if (depth === 0) return evalS(st);
  const cands = getCands(st, turn, cfg);
  if (turn === 'red') {
    let v = -Infinity;
    for (const a of cands) {
      const ns = apF(st, a, 'red');
      v = Math.max(v, mm(ns, 'blue', depth - 1, alpha, beta, cfg));
      alpha = Math.max(alpha, v); if (beta <= alpha) break;
    }
    return v;
  } else {
    let v = Infinity;
    for (const a of cands) {
      const ns = apF(st, a, 'blue');
      v = Math.min(v, mm(ns, 'red', depth - 1, alpha, beta, cfg));
      beta = Math.min(beta, v); if (beta <= alpha) break;
    }
    return v;
  }
}

/* ══════════════════════════════════
   MAIN AI DISPATCHER
══════════════════════════════════ */
function aiBest() {
  const d = DIFF[diff], st = snap();
  if (diff === 'easy') {
    if (Math.random() < d.noise) return getMA(st, 'red')[~~rnd(getMA(st, 'red').length)];
    if (Math.random() < d.wallChance && st.rW > 0) {
      const wa = getWA(st, d.wallR, st.bX, st.bY);
      if (wa.length) {
        const scored = scoreWalls(st, wa, 'red').filter(x => x.s >= 1);
        if (scored.length) return scored[0].a;
      }
    }
    return greedyM(st, 'red');
  }
  if (diff === 'medium') {
    if (Math.random() < d.noise) return greedyM(st, 'red');
    return mmRoot(st, d);
  }
  return mmRoot(st, d);
}

/* ══════════════════════════════════
   MCTS ENGINE
══════════════════════════════════ */
function runMCTS(rootSt, budget, cb) {
  const BATCH = diff === 'destroy' ? 25 : 20;
  const ROLLOUT_DEPTH = diff === 'destroy' ? 30 : 20;
  const cfg = DIFF[diff];
  let iter = 0;

  const root = { st: rootSt, parent: null, move: null, children: [], wins: 0, visits: 0, untriedMoves: null };
  root.untriedMoves = getCands(rootSt, 'red', cfg);

  function utc(node, parentVisits) {
    if (node.visits === 0) return Infinity;
    return node.wins / node.visits + 1.5 * Math.sqrt(Math.log(parentVisits) / node.visits);
  }

  function select(node) {
    let n = node;
    while (n.untriedMoves !== null && n.untriedMoves.length === 0 && n.children.length > 0) {
      let best = -Infinity, bc = n.children[0];
      for (const c of n.children) { const u = utc(c, n.visits); if (u > best) { best = u; bc = c; } }
      n = bc;
    }
    return n;
  }

  function expand(node, turn) {
    if (!node.untriedMoves || node.untriedMoves.length === 0) return node;
    const idx = ~~rnd(Math.min(3, node.untriedMoves.length));
    const mv = node.untriedMoves.splice(idx, 1)[0];
    const ns = apF(node.st, mv, turn);
    const nextTurn = turn === 'red' ? 'blue' : 'red';
    const child = { st: ns, parent: node, move: mv, children: [], wins: 0, visits: 0, untriedMoves: getCands(ns, nextTurn, cfg) };
    node.children.push(child);
    return child;
  }

  function simulate(st, startTurn) {
    let s = { ...st, hW: st.hW.slice(), vW: st.vW.slice() };
    let turn = startTurn;
    for (let d = 0; d < ROLLOUT_DEPTH; d++) {
      if (s.bY === 0) return -1;
      if (s.rY === 8) return 1;
      const acts = getMA(s, turn);
      let mv;
      if (Math.random() < 0.7) {
        const goal = turn === 'red' ? 8 : 0;
        let bestD = 999;
        for (const a of acts) {
          const ns = apF(s, a, turn);
          const d2 = turn === 'red' ? BFS(ns.rX, ns.rY, goal, ns.hW, ns.vW) : BFS(ns.bX, ns.bY, goal, ns.hW, ns.vW);
          if (d2 < bestD) { bestD = d2; mv = a; }
        }
      } else { mv = acts[~~rnd(acts.length)]; }
      s = apF(s, mv, turn);
      turn = turn === 'red' ? 'blue' : 'red';
    }
    const e = evalS(s);
    return e > 0 ? 1 : e < 0 ? -1 : 0;
  }

  function backprop(node, result) {
    let n = node, r = result;
    while (n) { n.visits++; n.wins += r; n = n.parent; r = -r; }
  }

  function getNodeDepth(node) {
    let d = 0, n = node;
    while (n.parent) { d++; n = n.parent; } return d;
  }

  function runBatch() {
    for (let b = 0; b < BATCH && iter < budget && !over; b++, iter++) {
      const node = select(root);
      const depth = getNodeDepth(node);
      const turn = depth % 2 === 0 ? 'red' : 'blue';
      const child = expand(node, turn);
      const childDepth = getNodeDepth(child);
      const childTurn = childDepth % 2 === 0 ? 'red' : 'blue';
      const result = simulate(child.st, childTurn);
      backprop(child, result);
    }
    const pct = Math.min(100, (iter / budget) * 100);
    document.getElementById('mctsFill').style.width = pct + '%';
    document.getElementById('mctsIter').textContent = iter + ' / ' + budget + ' simulations';
    if (iter < budget && !over) { requestAnimationFrame(runBatch); }
    else {
      if (!root.children.length) { cb(getMA(rootSt, 'red')[0]); return; }
      const best = root.children.reduce((a, b) => b.visits > a.visits ? b : a);
      cb(best.move);
    }
  }

  requestAnimationFrame(runBatch);
}
