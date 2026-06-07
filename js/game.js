/**
 * game.js
 * Logic cốt lõi: init, lượt đi, tường, win condition, timer,
 * power-up, chaos, fog, blind, undo, replay, BFS helpers.
 */

'use strict';

/* ══ roundRect POLYFILL ══ */
(() => {
  if (CanvasRenderingContext2D.prototype.roundRect) return;
  CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r = 0) {
    if (typeof r === 'object') r = r[0] || 0;
    r = Math.min(Math.abs(r), w / 2, h / 2);
    this.moveTo(x + r, y); this.lineTo(x + w - r, y); this.quadraticCurveTo(x + w, y, x + w, y + r);
    this.lineTo(x + w, y + h - r); this.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    this.lineTo(x + r, y + h); this.quadraticCurveTo(x, y + h, x, y + h - r);
    this.lineTo(x, y + r); this.quadraticCurveTo(x, y, x + r, y); this.closePath(); return this;
  };
})();

/* ══ HELPER ══ */
function rnd(n) { return Math.random() * n; }
function opp(w) { return w === 'blue' ? 'red' : 'blue'; }
function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

/* ══════════════════════════════════
   INIT
══════════════════════════════════ */
function initGame() {
  players = { blue: { x: 4, y: 8, walls: 10 }, red: { x: 4, y: 0, walls: 10 } };
  cur = 'blue'; mode = 'move'; hW = []; vW = [];
  acted = false; over = false; hist = null;
  turnN = 0; teleMode = false; dblMove = false;
  shields = { blue: false, red: false }; frozen = { blue: 0, red: 0 };
  playerPU = { blue: null, red: null }; gift = { x: 0, y: 0, active: false };
  ghostWall = { x: -1, y: -1 };
  moveHistory = [];
  chaosCounter = 0; lastChaosEvent = ''; chaosHideUntil = -1;
  fogRevealedWalls = { h: new Set(), v: new Set() };
  blindCounter = 0; blindHideUntil = -1;
  cancelAnimationFrame(raf);
  if (typeof _aiSessionId !== 'undefined') _aiSessionId++; // cancel pending AI callbacks
  if (powerMode) spawnGift();
  updPUBar();
  setMode('move'); startTimer(); loop();
}

/* ══════════════════════════════════
   GAME LOOP
══════════════════════════════════ */
function loop() { if (over) { draw(); return; } gPh += .055; draw(); raf = requestAnimationFrame(loop); }

/* ══════════════════════════════════
   TIMER
══════════════════════════════════ */
function startTimer() {
  clearInterval(tiv);
  if (gMode === 'ai' && cur === 'red') {
    document.getElementById('ttxt').textContent = '';
    document.getElementById('tbar').style.width = '0'; return;
  }
  if (powerMode) updPUBar();
  tLeft = 60; updTimerUI();
  tiv = setInterval(() => { tLeft--; updTimerUI(); if (tLeft <= 0) endTurn(true); }, 1000);
}

function updTimerUI() {
  const pct = (tLeft / 60) * 100;
  const bar = document.getElementById('tbar'), txt = document.getElementById('ttxt');
  bar.style.width = pct + '%';
  if (tLeft <= 10) { bar.style.background = '#ff4444'; txt.style.color = '#ff4444'; txt.textContent = '⚠ ' + tLeft + 's'; }
  else if (tLeft <= 20) { bar.style.background = '#ff8c00'; txt.style.color = '#ff8c00'; txt.textContent = '⏱ ' + tLeft + 's'; }
  else { bar.style.background = 'linear-gradient(90deg,#4488ff,#ffd700)'; txt.style.color = '#ffd700'; txt.textContent = '⏱ ' + tLeft + 's'; }
}

/* ══════════════════════════════════
   MODE (move / H wall / V wall)
══════════════════════════════════ */
function setMode(m) {
  if (over) return;
  if (gMode === 'ai' && cur === 'red') return;
  if (gMode === 'online' && cur !== myOnlineRole) return;
  mode = m;
  ['mBtn', 'hBtn', 'vBtn'].forEach(id => document.getElementById(id).classList.remove('act'));
  if (m === 'move') document.getElementById('mBtn').classList.add('act');
  if (m === 'H') document.getElementById('hBtn').classList.add('act');
  if (m === 'V') document.getElementById('vBtn').classList.add('act');
}

/* ══════════════════════════════════
   UNDO / HISTORY
══════════════════════════════════ */
function saveHist() {
  hist = {
    pl: JSON.parse(JSON.stringify(players)),
    hW: hW.slice(), vW: vW.slice(),
    teleMode, dblMove,
    shields: JSON.parse(JSON.stringify(shields)),
    frozen: JSON.parse(JSON.stringify(frozen)),
    playerPU: JSON.parse(JSON.stringify(playerPU)),
    gift: { ...gift }
  };
}

function undo() {
  if (!acted || !hist || over) return;
  if (gMode === 'ai' && cur === 'red') return;
  if (gMode === 'online' && cur !== myOnlineRole) return;
  players = JSON.parse(JSON.stringify(hist.pl));
  hW = hist.hW.slice(); vW = hist.vW.slice();
  teleMode = hist.teleMode; dblMove = hist.dblMove;
  shields = JSON.parse(JSON.stringify(hist.shields));
  frozen = JSON.parse(JSON.stringify(hist.frozen));
  playerPU = JSON.parse(JSON.stringify(hist.playerPU));
  gift = { ...hist.gift };
  acted = false; updPUBar();
  if (gMode === 'online') {
    sendOnlineMove({
      action: 'undo',
      state: {
        players: JSON.parse(JSON.stringify(players)),
        hW: hW.slice(), vW: vW.slice(),
        shields: JSON.parse(JSON.stringify(shields)),
        frozen: JSON.parse(JSON.stringify(frozen)),
        playerPU: JSON.parse(JSON.stringify(playerPU)),
        gift: { ...gift }, teleMode, dblMove, cur
      }
    });
    showToast('↩', 'Hoàn tác', 'Đã gửi thông báo hoàn tác đến đối thủ');
  }
}

/* Snapshot cho replay */
function takeSnapshot(who, desc) {
  moveHistory.push({
    who, desc,
    pl: JSON.parse(JSON.stringify(players)),
    hW: hW.slice(), vW: vW.slice(),
    turnN
  });
}

/* ══════════════════════════════════
   END TURN
══════════════════════════════════ */

/**
 * Xử lý các hiệu ứng cuối lượt: freeze, chaos, blind, fog.
 * Được gọi bởi cả endTurn() (offline/AI) lẫn nextTurnOnline() (online)
 * để đảm bảo hai máy luôn đồng bộ state.
 *
 * Lưu ý: cur đã được cập nhật sang người chơi TIẾP THEO trước khi gọi.
 * Trả về true nếu cur bị freeze và bị bỏ lượt (đã xoay sang người kế).
 */
function _applyTurnEffects() {
  // Freeze: bỏ lượt nếu bị đóng băng
  let didFreeze = false;
  if (powerMode && frozen[cur] > 0) {
    frozen[cur]--;
    showToast('❄️', 'Đóng băng!', `${cur === 'blue' ? '🔵 Blue' : '🔴 Red'} bị bỏ lượt!`);
    cur = opp(cur);
    didFreeze = true;
  }

  if (powerMode) updPUBar();

  // Chaos event mỗi 3 lượt
  if (chaosMode) {
    chaosCounter++;
    if (chaosCounter % 3 === 0) triggerChaosEvent();
  }

  // Blind mode: ẩn tường mỗi 4 lượt trong 3 lượt
  if (blindMode) {
    blindCounter++;
    if (blindCounter % 4 === 0) {
      blindHideUntil = turnN + 3;
      showChaosBanner('🌫️ CỜ MÙ — TƯỜNG BIẾN MẤT 3 LƯỢT!', 'cb-fog');
      showToast('🌫️', 'Cờ mù!', 'Tất cả tường ẩn trong 3 lượt tiếp theo!');
    }
  }

  // Fog of War: cập nhật vùng đã khám phá
  if (fogMode) updateFogReveal();

  return didFreeze;
}

function endTurn(timeout = false) {
  if ((!acted && !timeout && !dblMove) || over) return;
  if (gMode === 'online' && cur !== myOnlineRole && !timeout) return;

  teleMode = false; dblMove = false; acted = false; hist = null;
  turnN++;
  cur = opp(cur);

  _applyTurnEffects();

  if (gMode === 'online') {
    // Gửi toàn bộ context để peer đồng bộ đúng
    sendOnlineMove({
      action: 'endturn',
      who: opp(cur), // người vừa đi xong
      // Gửi kèm các counter để peer không cần tính lại
      turnN,
      chaosCounter,
      blindCounter,
      blindHideUntil,
      chaosHideUntil,
      frozen: JSON.parse(JSON.stringify(frozen)),
      cur  // cur hiện tại sau khi đã xử lý freeze
    });
    startTimer(); updPanels(); return;
  }

  if (gMode === 'ai' && cur === 'red') {
    clearInterval(tiv); updPanels();
    const delay = 80; // v5 async — delay nhỏ để UI render xong
    setTimeout(aiMove, delay);
  } else {
    startTimer();
  }
}

/* ══════════════════════════════════
   WALL HELPERS
══════════════════════════════════ */
function WBR(x1, y1, x2, y2, hw, vw) {
  for (const w of hw) if (x1 === x2 && (y1 === w.y && y2 === w.y + 1 || y2 === w.y && y1 === w.y + 1) && x1 >= w.x && x1 < w.x + 2) return true;
  for (const w of vw) if (y1 === y2 && (x1 === w.x && x2 === w.x + 1 || x2 === w.x && x1 === w.x + 1) && y1 >= w.y && y1 < w.y + 2) return true;
  return false;
}
function WB(x1, y1, x2, y2) { return WBR(x1, y1, x2, y2, hW, vW); }

/* ══════════════════════════════════
   BFS SHORTEST PATH
   Dùng chung cho cả game.js và ai.js.
   Chỉ khai báo ở đây — ai.js dùng trực tiếp.
══════════════════════════════════ */
function BFS(px, py, ty, hw, vw) {
  const vis = new Set(), q = [{ x: px, y: py, d: 0 }]; vis.add(px + ',' + py);
  while (q.length) {
    const { x, y, d } = q.shift(); if (y === ty) return d;
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= N || ny >= N || vis.has(nx + ',' + ny)) continue;
      if (!WBR(x, y, nx, ny, hw, vw)) { vis.add(nx + ',' + ny); q.push({ x: nx, y: ny, d: d + 1 }); }
    }
  }
  return 999;
}

/* Path còn thông sau khi đặt tường — dùng lại BFS, không duplicate traversal */
function pathOK(pl, ty, hw, vw, eH, eV) {
  const tH = eH ? [...hw, eH] : hw;
  const tV = eV ? [...vw, eV] : vw;
  return BFS(pl.x, pl.y, ty, tH, tV) < 999;
}

/* ══════════════════════════════════
   VALID MOVES
══════════════════════════════════ */
function validMoves() {
  const p = players[cur], o = cur === 'blue' ? players.red : players.blue, mv = [];
  for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
    const nx = p.x + dx, ny = p.y + dy;
    if (nx < 0 || ny < 0 || nx >= N || ny >= N || WB(p.x, p.y, nx, ny)) continue;
    if (nx === o.x && ny === o.y) {
      const jx = o.x + dx, jy = o.y + dy;
      if (jx >= 0 && jy >= 0 && jx < N && jy < N && !WB(o.x, o.y, jx, jy)) {
        mv.push({ x: jx, y: jy });
      } else {
        for (const [a, b] of [[dx === 0 ? 1 : 0, dy === 0 ? 1 : 0], [dx === 0 ? -1 : 0, dy === 0 ? -1 : 0]]) {
          const ax = o.x + a, ay = o.y + b;
          if (ax >= 0 && ay >= 0 && ax < N && ay < N && !WB(o.x, o.y, ax, ay)) mv.push({ x: ax, y: ay });
        }
      }
    } else mv.push({ x: nx, y: ny });
  }
  return mv;
}

/* ══════════════════════════════════
   CLICK HANDLERS
══════════════════════════════════ */
function onClick(e) {
  if (over) return;
  if (gMode === 'ai' && cur === 'red') return;
  if (gMode === 'online' && cur !== myOnlineRole) return;
  const rc = canvas.getBoundingClientRect();
  const sx = canvas.width / rc.width, sy = canvas.height / rc.height;
  const x = Math.floor((e.clientX - rc.left) * sx / C);
  const y = Math.floor((e.clientY - rc.top) * sy / C);
  if (x < 0 || x >= N || y < 0 || y >= N) return;
  if (teleMode) {
    const o = cur === 'blue' ? players.red : players.blue;
    if (x === o.x && y === o.y) return;
    saveHist(); players[cur].x = x; players[cur].y = y;
    teleMode = false; acted = true;
    checkGiftPickup(cur); checkWin();
    takeSnapshot(cur, `🌀 Teleport → (${x + 1},${y + 1})`);
    if (gMode === 'online' && !over) sendOnlineMove({ action: 'move', who: cur, x, y, pending: true });
    return;
  }
  if (mode === 'move') tryMove(x, y);
  else tryWall(x, y);
}

function onMouseMove(e) {
  if (mode !== 'H' && mode !== 'V') { ghostWall = { x: -1, y: -1 }; return; }
  if (over || acted || (gMode === 'ai' && cur === 'red')) { ghostWall = { x: -1, y: -1 }; return; }
  const rc = canvas.getBoundingClientRect();
  const sx = canvas.width / rc.width, sy = canvas.height / rc.height;
  const x = Math.floor((e.clientX - rc.left) * sx / C);
  const y = Math.floor((e.clientY - rc.top) * sy / C);
  if (x >= 0 && x < N - 1 && y >= 0 && y < N - 1) ghostWall = { x, y };
  else ghostWall = { x: -1, y: -1 };
}

/* ══════════════════════════════════
   MOVE
══════════════════════════════════ */
function tryMove(x, y) {
  if (gMode === 'online' && cur !== myOnlineRole) return;
  if (acted && !dblMove) return;
  const p = players[cur], o = cur === 'blue' ? players.red : players.blue;
  const dx = x - p.x, dy = y - p.y;

  function doMove(nx, ny) {
    saveHist(); p.x = nx; p.y = ny;
    const wasDbl = dblMove; dblMove = false; acted = true;
    checkGiftPickup(cur); checkWin();
    takeSnapshot(cur, (wasDbl ? '⚡ Move×2' : '♟ Di chuyển') + ` → (${nx + 1},${ny + 1})`);
    if (gMode === 'online' && !over) sendOnlineMove({ action: 'move', who: cur, x: nx, y: ny, pending: true });
  }

  // Bước thường
  if (Math.abs(dx) + Math.abs(dy) === 1 && !WB(p.x, p.y, x, y) && !(x === o.x && y === o.y)) { doMove(x, y); return; }
  // Nhảy thẳng qua đối thủ
  if (Math.abs(dx) + Math.abs(dy) === 2 && dx % 2 === 0 && dy % 2 === 0) {
    const mx = p.x + dx / 2, my = p.y + dy / 2;
    if (mx === o.x && my === o.y && !WB(p.x, p.y, mx, my) && !WB(mx, my, x, y)) { doMove(x, y); return; }
  }
  // Nhảy chéo
  if (Math.abs(dx) === 1 && Math.abs(dy) === 1) {
    const adjH = (o.x === p.x && o.y === p.y + dy);
    const adjV = (o.y === p.y && o.x === p.x + dx);
    if (adjH && !WB(p.x, p.y, o.x, o.y)) {
      const jy = o.y + dy;
      const straightBlocked = jy < 0 || jy >= N || WB(o.x, o.y, o.x, jy);
      if (straightBlocked && !WB(o.x, o.y, x, y)) { doMove(x, y); return; }
    }
    if (adjV && !WB(p.x, p.y, o.x, o.y)) {
      const jx = o.x + dx;
      const straightBlocked = jx < 0 || jx >= N || WB(o.x, o.y, jx, o.y);
      if (straightBlocked && !WB(o.x, o.y, x, y)) { doMove(x, y); return; }
    }
  }
}

/* ══════════════════════════════════
   WALL PLACEMENT
══════════════════════════════════ */
function tryWall(x, y) {
  if (gMode === 'online' && cur !== myOnlineRole) return;
  if (acted) return;
  if (x < 0 || y < 0 || x >= N - 1 || y >= N - 1) return;
  const p = players[cur]; if (p.walls <= 0) return;
  const o = opp(cur);
  const wallDir = mode;

  if (mode === 'H') {
    if (hW.some(w => w.x === x && w.y === y)) return;
    if (hW.some(w => (w.x === x - 1 && w.y === y) || (w.x === x + 1 && w.y === y))) return;
    if (vW.some(w => w.x === x && w.y === y)) return;
    if (!pathOK(players.blue, 8, hW, vW, { x, y }, null) || !pathOK(players.red, 0, hW, vW, { x, y }, null)) return;
    if (powerMode && shields[o]) { shields[o] = false; showToast('🛡️', 'Shield!', 'Tường bị chặn bởi Shield!'); return; }
    saveHist(); hW.push({ x, y });
    takeSnapshot(cur, `— Tường H (${x + 1},${y + 1})`);
  } else {
    if (vW.some(w => w.x === x && w.y === y)) return;
    if (vW.some(w => (w.x === x && w.y === y - 1) || (w.x === x && w.y === y + 1))) return;
    if (hW.some(w => w.x === x && w.y === y)) return;
    if (!pathOK(players.blue, 8, hW, vW, null, { x, y }) || !pathOK(players.red, 0, hW, vW, null, { x, y })) return;
    if (powerMode && shields[o]) { shields[o] = false; showToast('🛡️', 'Shield!', 'Tường bị chặn bởi Shield!'); return; }
    saveHist(); vW.push({ x, y });
    takeSnapshot(cur, `| Tường V (${x + 1},${y + 1})`);
  }
  p.walls--; acted = true;
  if (gMode === 'online' && !over) sendOnlineMove({ action: 'wall', who: cur, dir: wallDir, x, y, pending: true });
}

/* ══════════════════════════════════
   WIN CONDITION
══════════════════════════════════ */
function checkWin() { if (players.blue.y === 0) endGame('blue'); if (players.red.y === 8) endGame('red'); }

function endGame(who) {
  over = true; clearInterval(tiv); cancelAnimationFrame(raf); draw();
  const t = document.getElementById('wtit'), s = document.getElementById('wsub');
  const dl = gMode === 'ai' ? DIFF[diff].label : '';
  if (who === 'blue') {
    t.textContent = '🔵 BLUE THẮNG!'; t.style.color = '#88bbff';
    s.textContent = gMode === 'ai' ? `Xuất sắc! Bạn thắng ${dl}!` : 'Người chơi xanh chiến thắng';
  } else {
    t.textContent = '🔴 RED THẮNG!'; t.style.color = '#ff9999';
    s.textContent = gMode === 'ai' ? `AI ${dl} thắng! Cố lên!` : 'Người chơi đỏ chiến thắng';
  }
  document.getElementById('wov').classList.add('on');
  confetti(who === 'blue' ? '#4488ff' : '#ff4444');
}

function confetti(col) {
  const cs = [col, '#ffd700', '#fff', col + '99'];
  for (let i = 0; i < 70; i++) {
    const d = document.createElement('div'); d.className = 'cf';
    d.style.cssText = `left:${rnd(100)}vw;top:-10px;background:${cs[~~rnd(cs.length)]};--dur:${1.5 + rnd(2)}s;--del:${rnd(1.5)}s;width:${6 + rnd(9)}px;height:${6 + rnd(9)}px;transform:rotate(${rnd(360)}deg)`;
    document.body.appendChild(d); setTimeout(() => d.remove(), (4 + rnd(2)) * 1000);
  }
}

/* ══════════════════════════════════
   GIFT BOX / POWER-UP SYSTEM
══════════════════════════════════ */
function spawnGift() {
  let tries = 0, x, y;
  do { x = ~~rnd(N); y = 1 + ~~rnd(7); tries++; }
  while (tries < 50 && ((x === players.blue.x && y === players.blue.y) || (x === players.red.x && y === players.red.y)));
  gift = { x, y, active: true };
}

function checkGiftPickup(who) {
  if (!powerMode || !gift.active) return;
  const p = players[who];
  if (p.x === gift.x && p.y === gift.y) {
    gift.active = false;
    const id = PU_IDS[~~rnd(PU_IDS.length)];
    const def = PU_DEFS[id];
    playerPU[who] = { id, ico: def.ico, name: def.name, desc: def.desc, cls: def.cls };
    showToast('🎁', 'Nhặt được: ' + def.name, def.desc);
    updPUBar();
    setTimeout(() => { if (!over) spawnGift(); }, 800);
  }
}

function activatePU(who) {
  if (!playerPU[who] || over) return;
  if (gMode === 'ai' && who === 'red') return;
  if (cur !== who) { showToast('❌', 'Không phải lượt bạn!', 'Chờ tới lượt mới dùng kỹ năng'); return; }
  const pu = playerPU[who];
  const def = PU_DEFS[pu.id];
  if (!def) return;
  saveHist();
  playerPU[who] = null;
  updPUBar();
  def.use(who);
  takeSnapshot(who, '⚡ Dùng: ' + pu.name);
}

function updPUBar() {
  ['blue', 'red'].forEach(who => {
    const slot = document.getElementById('puSlot' + capitalize(who));
    const nm = document.getElementById('puNm' + capitalize(who));
    const btn = document.getElementById('puUseBtn' + capitalize(who));
    const pu = playerPU[who];
    if (pu) {
      slot.className = `pu-slot has-${who}`;
      slot.querySelector('.pu-ico').textContent = pu.ico;
      nm.textContent = pu.name;
      const isYourTurn = cur === who && !over && !(gMode === 'ai' && who === 'red');
      const canUse = isYourTurn && !teleMode;
      btn.className = `pu-use-btn ${canUse ? 'active-' + who : 'inactive'}`;
      btn.disabled = !canUse;
    } else {
      slot.className = 'pu-slot empty';
      slot.querySelector('.pu-ico').textContent = '🎁';
      nm.textContent = 'Trống';
      btn.className = 'pu-use-btn inactive';
      btn.disabled = true;
    }
  });
}

/* ══════════════════════════════════
   CHAOS MODE
══════════════════════════════════ */
function triggerChaosEvent() {
  let ev;
  do { ev = CHAOS_EVENTS[~~rnd(CHAOS_EVENTS.length)]; }
  while (ev.id === lastChaosEvent && CHAOS_EVENTS.length > 1);
  lastChaosEvent = ev.id;
  showChaosBanner(ev.label, ev.cls);
  setTimeout(() => ev.fn(), 600);
}

function showChaosBanner(txt, cls) {
  const b = document.getElementById('chaosBanner');
  b.textContent = txt; b.className = cls + ' on';
  setTimeout(() => b.classList.remove('on'), 2200);
}

function doChaosRotate() {
  function rot(x, y) { return { x: N - 1 - y, y: x }; }
  const bp = rot(players.blue.x, players.blue.y);
  const rp = rot(players.red.x, players.red.y);
  players.blue.x = bp.x; players.blue.y = bp.y;
  players.red.x = rp.x; players.red.y = rp.y;
  const newH = [], newV = [];
  hW.forEach(w => { const r = rot(w.x, w.y); newV.push({ x: r.x - 1 >= 0 ? r.x - 1 : r.x, y: r.y }); });
  vW.forEach(w => { const r = rot(w.x, w.y); newH.push({ x: r.x, y: r.y >= 0 ? r.y : 0 }); });
  hW = newH.filter(w => w.x >= 0 && w.x < N - 1 && w.y >= 0 && w.y < N - 1);
  vW = newV.filter(w => w.x >= 0 && w.x < N - 1 && w.y >= 0 && w.y < N - 1);
  showToast('🌀', 'Bàn cờ xoay!', 'Mọi thứ đã thay đổi vị trí!');
}

function doChaosWallSwap() {
  const tmp = hW.slice(); hW = vW.slice(); vW = tmp;
  if (BFS(players.blue.x, players.blue.y, 0, hW, vW) >= 999 || BFS(players.red.x, players.red.y, 8, hW, vW) >= 999) {
    const t2 = hW.slice(); hW = vW.slice(); vW = t2;
  }
  showToast('🔄', 'Đảo tường!', 'Tường ngang ↔ Tường dọc hoán đổi!');
}

function doChaosFog() {
  chaosHideUntil = turnN + 3;
  showToast('🌫️', 'Sương mù!', 'Tường ẩn trong 3 lượt!');
}

function doChaosStorm() {
  const all = [...hW.map(w => ({ ...w, t: 'H' })), ...vW.map(w => ({ ...w, t: 'V' }))];
  if (!all.length) { showToast('⚡', 'Bão tường!', 'Không có tường nào để phá!'); return; }
  const w = all[~~rnd(all.length)];
  if (w.t === 'H') hW = hW.filter(h => !(h.x === w.x && h.y === w.y));
  else vW = vW.filter(v => !(v.x === w.x && v.y === w.y));
  showToast('⚡', 'Bão tường!', '1 bức tường ngẫu nhiên bị phá hủy!');
}

/* ══════════════════════════════════
   FOG OF WAR
══════════════════════════════════ */
function updateFogReveal() {
  ['blue', 'red'].forEach(who => {
    const p = players[who];
    hW.forEach(w => {
      if (Math.abs(w.x - p.x) <= FOG_RADIUS && Math.abs(w.y - p.y) <= FOG_RADIUS)
        fogRevealedWalls.h.add(w.x + ',' + w.y);
    });
    vW.forEach(w => {
      if (Math.abs(w.x - p.x) <= FOG_RADIUS && Math.abs(w.y - p.y) <= FOG_RADIUS)
        fogRevealedWalls.v.add(w.x + ',' + w.y);
    });
  });
}

function isInFog(px, py) {
  if (!fogMode) return false;
  const viewerWho = (gMode === '2p' || gMode === 'ai') ? 'blue' : myOnlineRole;
  const vp = players[viewerWho || 'blue'];
  return Math.abs(px - vp.x) > FOG_RADIUS || Math.abs(py - vp.y) > FOG_RADIUS;
}

function wallInFog(wx, wy, dir) {
  if (!fogMode) return false;
  const key = wx + ',' + wy;
  if (dir === 'h') return !fogRevealedWalls.h.has(key);
  return !fogRevealedWalls.v.has(key);
}

/* ══════════════════════════════════
   PLAYER PANELS UI
══════════════════════════════════ */
function updPanels() {
  document.getElementById('wB').textContent = players.blue.walls;
  document.getElementById('wR').textContent = players.red.walls;
  const pb = document.getElementById('pBlue'), pr = document.getElementById('pRed');
  const tb = document.getElementById('tagB'), tr = document.getElementById('tagR');
  const isOnlineOppTurn = gMode === 'online' && cur !== myOnlineRole;
  if (cur === 'blue') {
    pb.className = 'panel blue ab'; pr.className = 'panel red';
    tb.className = 'ptag tab';
    tb.textContent = teleMode ? '🌀 Chọn ô Teleport' : dblMove ? '⚡ Di chuyển lần 2!' : 'Lượt của bạn';
    tr.className = 'ptag tw'; tr.textContent = 'Chờ';
  } else {
    pb.className = 'panel blue'; pr.className = 'panel red ar';
    tb.className = 'ptag tw'; tb.textContent = 'Chờ';
    tr.className = 'ptag tar'; tr.textContent = gMode === 'ai' ? 'AI đang nghĩ...' : gMode === 'online' && cur !== myOnlineRole ? '🌐 Đối thủ đang đi...' : 'Lượt bạn';
  }
  if (powerMode) updPUBar();
  const sb = document.getElementById('sbar');
  if (gMode === 'ai' && cur === 'red') return;
  if (isOnlineOppTurn) { sb.innerHTML = '🌐 Chờ đối thủ đi...'; return; }
  const who = cur === 'blue' ? '🔵 BLUE' : '🔴 RED';
  if (teleMode) sb.innerHTML = `${who} — 🌀 Click bất kỳ ô nào để Teleport`;
  else if (dblMove) sb.innerHTML = `${who} — ⚡ Double Move: click ô để di chuyển thêm!`;
  else if (acted) sb.innerHTML = who + ' — Đã hành động &nbsp;<span style="color:#66ffcc">✓ Kết thúc lượt</span>';
  else if (mode === 'move') sb.innerHTML = who + ' — Chọn ô sáng để di chuyển';
  else sb.innerHTML = who + ' — Hover xem preview · Click để đặt tường';
}

/* ══════════════════════════════════
   TOAST
══════════════════════════════════ */
let toastTm = null;
function showToast(ico, nm, ds) {
  document.getElementById('tIco').textContent = ico;
  document.getElementById('tNm').textContent = nm;
  document.getElementById('tDs').textContent = ds;
  const el = document.getElementById('toast');
  el.classList.add('on');
  clearTimeout(toastTm);
  toastTm = setTimeout(() => el.classList.remove('on'), 2400);
}

/* ══════════════════════════════════
   REPLAY
══════════════════════════════════ */
function openReplay() {
  document.getElementById('replayPanel').style.display = 'block';
  rpIdx = moveHistory.length - 1;
  buildRPList(); rpRender();
}
function closeReplay() { document.getElementById('replayPanel').style.display = 'none'; }

function buildRPList() {
  const list = document.getElementById('rpList'); list.innerHTML = '';
  moveHistory.forEach((snap, i) => {
    const div = document.createElement('div');
    div.className = `rp-entry ${snap.who}`;
    div.textContent = `#${i + 1} ${snap.who === 'blue' ? '🔵' : '🔴'} ${snap.desc}`;
    div.onclick = () => { rpIdx = i; rpRender(); };
    div.id = 'rpe' + i;
    list.appendChild(div);
  });
}

function rpRender() {
  const list = document.getElementById('rpList');
  list.querySelectorAll('.rp-entry').forEach((el, i) => el.classList.toggle('current', i === rpIdx));
  const el = document.getElementById('rpe' + rpIdx);
  if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  document.getElementById('rpPos').textContent = `${rpIdx + 1}/${moveHistory.length}`;
  document.getElementById('rpFirst').disabled = rpIdx <= 0;
  document.getElementById('rpPrev').disabled = rpIdx <= 0;
  document.getElementById('rpNext').disabled = rpIdx >= moveHistory.length - 1;
  document.getElementById('rpLast').disabled = rpIdx >= moveHistory.length - 1;
  const snap = moveHistory[rpIdx];
  if (snap) drawSnapshot(snap);
}

function rpStep(d) { rpIdx = Math.max(0, Math.min(moveHistory.length - 1, rpIdx + d)); rpRender(); }
function rpGo(i) { rpIdx = (i < 0 ? moveHistory.length - 1 : i); rpRender(); }

function drawSnapshot(snap) {
  if (!ctx) return;
  const savedPlayers = players, savedHW = hW, savedVW = vW;
  players = snap.pl; hW = snap.hW; vW = snap.vW;
  drawBoardStatic();
  players = savedPlayers; hW = savedHW; vW = savedVW;
}
