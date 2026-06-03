/**
 * renderer.js
 * Toàn bộ code vẽ canvas: bảng cờ, quân cờ, tường, hiệu ứng.
 */

'use strict';

/* ══════════════════════════════════
   MAIN DRAW
══════════════════════════════════ */
function draw() {
  if (!ctx) return;
  const g = Math.sin(gPh) * .5 + .5;
  ctx.clearRect(0, 0, N * C, N * C);

  /* Cells */
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    ctx.fillStyle = j === 0 ? '#b0ccee' : j === 8 ? '#eeb8b8' : '#c8a462';
    ctx.beginPath(); ctx.roundRect(i * C + 3, j * C + 3, C - 6, C - 6, 6); ctx.fill();
    const sh = ctx.createLinearGradient(i * C, j * C, i * C, j * C + C);
    sh.addColorStop(0, 'rgba(255,255,255,.22)'); sh.addColorStop(.5, 'rgba(255,255,255,.04)'); sh.addColorStop(1, 'rgba(0,0,0,.12)');
    ctx.fillStyle = sh; ctx.beginPath(); ctx.roundRect(i * C + 3, j * C + 3, C - 6, C - 6, 6); ctx.fill();
    if (j === 0) { ctx.fillStyle = `rgba(68,136,255,${.08 + g * .06})`; ctx.beginPath(); ctx.roundRect(i * C + 3, j * C + 3, C - 6, C - 6, 6); ctx.fill(); }
    if (j === 8) { ctx.fillStyle = `rgba(255,68,68,${.08 + g * .06})`; ctx.beginPath(); ctx.roundRect(i * C + 3, j * C + 3, C - 6, C - 6, 6); ctx.fill(); }
    // Fog overlay
    if (fogMode && isInFog(i, j)) {
      ctx.save(); ctx.fillStyle = `rgba(4,6,20,${.82 + Math.sin(gPh + i * .3 + j * .4) * .05})`;
      ctx.beginPath(); ctx.roundRect(i * C + 3, j * C + 3, C - 6, C - 6, 6); ctx.fill();
      ctx.fillStyle = `rgba(30,50,120,.12)`;
      ctx.beginPath(); ctx.roundRect(i * C + 3, j * C + 3, C - 6, C - 6, 6); ctx.fill(); ctx.restore();
    }
  }

  /* Goal arrows */
  ctx.save(); ctx.globalAlpha = .2 + g * .1; ctx.font = 'bold 8px sans-serif'; ctx.textAlign = 'center';
  ctx.fillStyle = '#3366cc'; for (let i = 0; i < N; i++) ctx.fillText('▲', i * C + C / 2, C - 3);
  ctx.fillStyle = '#cc3333'; for (let i = 0; i < N; i++) ctx.fillText('▼', i * C + C / 2, N * C - 1);
  ctx.restore();

  /* Gift Box */
  if (powerMode && gift.active) _drawGift(g);

  /* Teleport overlay */
  if (teleMode) {
    const op = cur === 'blue' ? players.red : players.blue;
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      if (i === op.x && j === op.y) continue;
      ctx.save(); ctx.fillStyle = `rgba(0,195,255,${.15 + g * .1})`;
      ctx.shadowColor = '#00bbff'; ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.roundRect(i * C + 3, j * C + 3, C - 6, C - 6, 6); ctx.fill(); ctx.restore();
    }
  }

  /* Move highlights */
  const showHL = mode === 'move' && (!acted || dblMove) && !over && !teleMode && !(gMode === 'ai' && cur === 'red');
  if (showHL) _drawMoveHighlights(g);

  /* Shield aura */
  if (powerMode) ['blue', 'red'].forEach(who => {
    if (!shields[who]) return;
    const p = players[who], cx = p.x * C + C / 2, cy = p.y * C + C / 2;
    ctx.save(); ctx.strokeStyle = `rgba(100,220,100,${.5 + g * .4})`; ctx.lineWidth = 3;
    ctx.shadowColor = '#44cc44'; ctx.shadowBlur = 14 + g * 10;
    ctx.beginPath(); ctx.arc(cx, cy, 28 + g * 3, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
  });

  /* Ghost wall preview */
  if (ghostWall.x >= 0 && (mode === 'H' || mode === 'V') && !acted && !over && !(gMode === 'ai' && cur === 'red'))
    _drawGhostWall(g);

  /* Real walls */
  const hideWalls = (chaosMode && turnN < chaosHideUntil) || (blindMode && turnN < blindHideUntil);
  hW.forEach(w => _drawHWall(w, hideWalls));
  vW.forEach(w => _drawVWall(w, hideWalls));

  /* Pawns */
  drawPawnAt(players.blue.x, players.blue.y, 'blue', cur === 'blue', g);
  const hideRedPawn = fogMode && (gMode === '2p' || gMode === 'ai') && isInFog(players.red.x, players.red.y);
  if (!hideRedPawn) drawPawnAt(players.red.x, players.red.y, 'red', cur === 'red', g);
  updPanels();
}

/* ══════════════════════════════════
   STATIC BOARD (for replay snapshots)
══════════════════════════════════ */
function drawBoardStatic() {
  const g = Math.sin(gPh) * .5 + .5;
  ctx.clearRect(0, 0, N * C, N * C);
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    ctx.fillStyle = j === 0 ? '#b0ccee' : j === 8 ? '#eeb8b8' : '#c8a462';
    ctx.beginPath(); ctx.roundRect(i * C + 3, j * C + 3, C - 6, C - 6, 6); ctx.fill();
    const sh = ctx.createLinearGradient(i * C, j * C, i * C, j * C + C);
    sh.addColorStop(0, 'rgba(255,255,255,.22)'); sh.addColorStop(.5, 'rgba(255,255,255,.04)'); sh.addColorStop(1, 'rgba(0,0,0,.12)');
    ctx.fillStyle = sh; ctx.beginPath(); ctx.roundRect(i * C + 3, j * C + 3, C - 6, C - 6, 6); ctx.fill();
    if (j === 0) { ctx.fillStyle = `rgba(68,136,255,.12)`; ctx.beginPath(); ctx.roundRect(i * C + 3, j * C + 3, C - 6, C - 6, 6); ctx.fill(); }
    if (j === 8) { ctx.fillStyle = `rgba(255,68,68,.12)`; ctx.beginPath(); ctx.roundRect(i * C + 3, j * C + 3, C - 6, C - 6, 6); ctx.fill(); }
  }
  hW.forEach(w => _drawHWall(w, false));
  vW.forEach(w => _drawVWall(w, false));
  drawPawnAt(players.blue.x, players.blue.y, 'blue', false, g);
  drawPawnAt(players.red.x, players.red.y, 'red', false, g);
}

/* ══════════════════════════════════
   PRIVATE DRAW HELPERS
══════════════════════════════════ */
function _drawGift(g) {
  const gx = gift.x * C + C / 2, gy = gift.y * C + C / 2;
  const bounce = Math.sin(gPh * 2) * .5 + .5;
  const scale = 0.85 + bounce * .15;
  const glow = 0.6 + bounce * .4;
  ctx.save();
  ctx.translate(gx, gy); ctx.scale(scale, scale);
  for (let ring = 3; ring >= 1; ring--) {
    ctx.globalAlpha = (glow * 0.12) / ring;
    ctx.shadowColor = '#ffd700'; ctx.shadowBlur = 20 * ring;
    ctx.fillStyle = `rgba(255,220,0,${0.05 * ring})`;
    ctx.beginPath(); ctx.arc(0, 0, 16 + ring * 4, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.shadowColor = '#ffcc00'; ctx.shadowBlur = 18 + bounce * 12;
  ctx.fillStyle = `rgba(255,200,0,${0.85 + bounce * .15})`;
  ctx.beginPath(); ctx.roundRect(-13, -13, 26, 26, 5); ctx.fill();
  ctx.strokeStyle = 'rgba(255,100,50,.9)'; ctx.lineWidth = 3; ctx.shadowBlur = 5;
  ctx.beginPath(); ctx.moveTo(-13, 0); ctx.lineTo(13, 0); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, -13); ctx.lineTo(0, 13); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,80,30,1)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(-4, -4, 4, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(4, -4, 4, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = 'rgba(150,60,0,.8)'; ctx.font = 'bold 10px Rajdhani';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.shadowBlur = 0;
  ctx.fillText('?', 1, 1);
  ctx.restore();
}

function _drawMoveHighlights(g) {
  const mv = validMoves(), isB = cur === 'blue';
  const [rr, gg, bb] = isB ? [68, 136, 255] : [255, 68, 68];
  for (const { x, y } of mv) {
    const cx = x * C + C / 2, cy = y * C + C / 2, p = .5 + g * .5;
    ctx.save();
    const au = ctx.createRadialGradient(cx, cy, 4, cx, cy, C * .6);
    au.addColorStop(0, `rgba(${rr},${gg},${bb},${.35 * p})`);
    au.addColorStop(.5, `rgba(${rr},${gg},${bb},${.12 * p})`);
    au.addColorStop(1, `rgba(${rr},${gg},${bb},0)`);
    ctx.fillStyle = au; ctx.beginPath(); ctx.arc(cx, cy, C * .6, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    ctx.save(); ctx.shadowColor = `rgb(${rr},${gg},${bb})`; ctx.shadowBlur = 16 + p * 12;
    ctx.fillStyle = `rgba(${rr},${gg},${bb},${.22 + p * .13})`;
    ctx.beginPath(); ctx.roundRect(x * C + 5, y * C + 5, C - 10, C - 10, 8); ctx.fill(); ctx.restore();
    ctx.save(); ctx.strokeStyle = `rgba(${rr},${gg},${bb},${.55 + p * .35})`; ctx.lineWidth = 2.5;
    ctx.shadowColor = `rgb(${rr},${gg},${bb})`; ctx.shadowBlur = 8;
    ctx.beginPath(); ctx.roundRect(x * C + 5, y * C + 5, C - 10, C - 10, 8); ctx.stroke(); ctx.restore();
    const dr = 7 + p * 5;
    ctx.save(); ctx.shadowColor = `rgb(${rr},${gg},${bb})`; ctx.shadowBlur = 12 + p * 10;
    const dg = ctx.createRadialGradient(cx, cy, 0, cx, cy, dr);
    dg.addColorStop(0, 'rgba(255,255,255,.95)');
    dg.addColorStop(.3, `rgba(${rr},${gg},${bb},.9)`);
    dg.addColorStop(1, `rgba(${rr},${gg},${bb},0)`);
    ctx.fillStyle = dg; ctx.beginPath(); ctx.arc(cx, cy, dr, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    if (p > .8) {
      const sa = (p - .8) / .2;
      ctx.save(); ctx.globalAlpha = sa * .7;
      ctx.fillStyle = `rgb(${rr},${gg},${bb})`; ctx.shadowColor = `rgb(${rr},${gg},${bb})`; ctx.shadowBlur = 6;
      for (const [sx, sy] of [[x * C + 10, y * C + 10], [x * C + C - 10, y * C + 10], [x * C + 10, y * C + C - 10], [x * C + C - 10, y * C + C - 10]]) {
        ctx.beginPath(); ctx.arc(sx, sy, 2, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }
  }
}

function _drawGhostWall(g) {
  const [rr, gg, bb] = cur === 'blue' ? [68, 136, 255] : [255, 68, 68];
  const p = .4 + g * .4;
  if (mode === 'H') {
    const wx = ghostWall.x * C + 5, wy = ghostWall.y * C + C - 8, ww = C * 2 - 10, wh = 13;
    ctx.save(); ctx.globalAlpha = .45; ctx.shadowColor = `rgb(${rr},${gg},${bb})`; ctx.shadowBlur = 12;
    const wg = ctx.createLinearGradient(wx, wy, wx, wy + wh);
    wg.addColorStop(0, `rgba(${rr},${gg},${bb},.9)`); wg.addColorStop(1, `rgba(${rr},${gg},${bb},.5)`);
    ctx.fillStyle = wg; ctx.beginPath(); ctx.roundRect(wx, wy, ww, wh, 5); ctx.fill();
    ctx.strokeStyle = `rgba(${rr},${gg},${bb},.8)`; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.restore();
  } else {
    const wx = ghostWall.x * C + C - 8, wy = ghostWall.y * C + 5, ww = 13, wh = C * 2 - 10;
    ctx.save(); ctx.globalAlpha = .45; ctx.shadowColor = `rgb(${rr},${gg},${bb})`; ctx.shadowBlur = 12;
    const wg = ctx.createLinearGradient(wx, wy, wx + ww, wy);
    wg.addColorStop(0, `rgba(${rr},${gg},${bb},.9)`); wg.addColorStop(1, `rgba(${rr},${gg},${bb},.5)`);
    ctx.fillStyle = wg; ctx.beginPath(); ctx.roundRect(wx, wy, ww, wh, 5); ctx.fill();
    ctx.strokeStyle = `rgba(${rr},${gg},${bb},.8)`; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.restore();
  }
}

function _drawHWall(w, hidden) {
  if (hidden) return;
  if (fogMode && wallInFog(w.x, w.y, 'h')) return;
  const wx = w.x * C + 5, wy = w.y * C + C - 8, ww = C * 2 - 10, wh = 13;
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.7)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 4;
  ctx.fillStyle = '#1e0800'; ctx.beginPath(); ctx.roundRect(wx, wy, ww, wh, 5); ctx.fill(); ctx.restore();
  const wg = ctx.createLinearGradient(wx, wy, wx, wy + wh);
  wg.addColorStop(0, '#b8721e'); wg.addColorStop(.3, '#d4892a'); wg.addColorStop(.65, '#9a5e14'); wg.addColorStop(1, '#6a3a08');
  ctx.fillStyle = wg; ctx.beginPath(); ctx.roundRect(wx, wy, ww, wh, 5); ctx.fill();
  ctx.fillStyle = 'rgba(255,210,120,.3)'; ctx.beginPath(); ctx.roundRect(wx + 3, wy + 1, ww - 6, 3, 2); ctx.fill();
}

function _drawVWall(w, hidden) {
  if (hidden) return;
  if (fogMode && wallInFog(w.x, w.y, 'v')) return;
  const wx = w.x * C + C - 8, wy = w.y * C + 5, ww = 13, wh = C * 2 - 10;
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.7)'; ctx.shadowBlur = 8; ctx.shadowOffsetX = 4;
  ctx.fillStyle = '#1e0800'; ctx.beginPath(); ctx.roundRect(wx, wy, ww, wh, 5); ctx.fill(); ctx.restore();
  const wg = ctx.createLinearGradient(wx, wy, wx + ww, wy);
  wg.addColorStop(0, '#b8721e'); wg.addColorStop(.3, '#d4892a'); wg.addColorStop(.65, '#9a5e14'); wg.addColorStop(1, '#6a3a08');
  ctx.fillStyle = wg; ctx.beginPath(); ctx.roundRect(wx, wy, ww, wh, 5); ctx.fill();
  ctx.fillStyle = 'rgba(255,210,120,.3)'; ctx.beginPath(); ctx.roundRect(wx + 1, wy + 3, 3, wh - 6, 2); ctx.fill();
}

/* ══════════════════════════════════
   DRAW PAWN
══════════════════════════════════ */
function drawPawnAt(px, py, who, isActive, g) {
  const cx = px * C + C / 2, cy = py * C + C / 2, isB = who === 'blue';
  const [rr, gg, bb] = isB ? [68, 136, 255] : [255, 68, 68];
  const lt = isB ? '#aaccff' : '#ffaaaa', dk = isB ? '#0d2e99' : '#991111', R = 22;
  ctx.save(); ctx.globalAlpha = .4; ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.filter = 'blur(4px)';
  ctx.beginPath(); ctx.ellipse(cx + 2, cy + R - 2, R * .65, 5, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  if (isActive) {
    ctx.save(); ctx.globalAlpha = .25 + g * .2; ctx.strokeStyle = `rgb(${rr},${gg},${bb})`; ctx.lineWidth = 3;
    ctx.shadowColor = `rgb(${rr},${gg},${bb})`; ctx.shadowBlur = 18 + g * 12;
    ctx.beginPath(); ctx.arc(cx, cy, R + 6 + g * 5, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    ctx.save(); ctx.globalAlpha = .1 + g * .08; ctx.strokeStyle = `rgb(${rr},${gg},${bb})`; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(cx, cy, R + 12 + g * 4, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
  }
  ctx.save();
  if (isActive) { ctx.shadowColor = `rgb(${rr},${gg},${bb})`; ctx.shadowBlur = 22 + g * 14; }
  else { ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = 8; }
  const bg = ctx.createRadialGradient(cx - 7, cy - 7, 1, cx, cy, R);
  bg.addColorStop(0, '#fff'); bg.addColorStop(.15, lt); bg.addColorStop(.6, `rgb(${rr},${gg},${bb})`); bg.addColorStop(1, dk);
  ctx.fillStyle = bg; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  ctx.save(); ctx.strokeStyle = isActive ? 'rgba(255,255,255,.85)' : 'rgba(255,255,255,.25)'; ctx.lineWidth = isActive ? 2.5 : 1.5;
  if (isActive) { ctx.shadowColor = `rgb(${rr},${gg},${bb})`; ctx.shadowBlur = 10; }
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
  ctx.save(); ctx.globalAlpha = .55;
  const sp = ctx.createRadialGradient(cx - 8, cy - 8, 0, cx - 5, cy - 5, 12);
  sp.addColorStop(0, 'rgba(255,255,255,.95)'); sp.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = sp; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  ctx.save(); ctx.fillStyle = 'rgba(255,255,255,.92)'; ctx.font = 'bold 15px Rajdhani';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 5;
  ctx.fillText(isB ? 'B' : 'R', cx, cy + 1); ctx.restore();
}
