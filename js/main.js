/**
 * main.js
 * Entry point: stars, preview canvas, navigation, launch handlers.
 * File này được load cuối cùng sau tất cả module khác.
 */

'use strict';

/* ══════════════════════════════════
   STARS BACKGROUND
══════════════════════════════════ */
(function initStars() {
  const s = document.getElementById('stars');
  for (let i = 0; i < 88; i++) {
    const d  = document.createElement('div');
    const sz = Math.random() * 1.8 + .4;
    d.className = 'star';
    d.style.cssText = `left:${rnd(100)}%;top:${rnd(100)}%;width:${sz}px;height:${sz}px;--d:${2 + rnd(4)}s;--dl:${rnd(5)}s;opacity:${rnd(40) / 100 + .05}`;
    s.appendChild(d);
  }
})();

/* ══════════════════════════════════
   MINI PREVIEW CANVAS (màn hình chính)
══════════════════════════════════ */
(function initPreview() {
  const pc = document.getElementById('prev');
  if (!pc) return;
  const px = pc.getContext('2d');
  const NS = 5, CS = 21;
  let t = 0;

  function dp() {
    px.clearRect(0, 0, 108, 108);
    for (let i = 0; i < NS; i++) for (let j = 0; j < NS; j++) {
      px.fillStyle = j === 0 ? '#b8d4f0' : j === 4 ? '#f0c0c0' : '#c8a96e';
      px.beginPath(); px.roundRect(i * CS + 2, j * CS + 2, CS - 4, CS - 4, 3); px.fill();
    }
    const g = Math.sin(t * .05) * .5 + .5;
    [[2, 4, '#4488ff'], [2, 0, '#ff4444']].forEach(([x, y, c]) => {
      const cx = x * CS + CS / 2, cy = y * CS + CS / 2;
      px.save(); px.shadowColor = c; px.shadowBlur = 8 + g * 8;
      px.fillStyle = c; px.beginPath(); px.arc(cx, cy, 7 + g * 2, 0, Math.PI * 2); px.fill(); px.restore();
    });
    t++;
    requestAnimationFrame(dp);
  }
  dp();
})();

/* ══════════════════════════════════
   NAVIGATION
══════════════════════════════════ */
let selDiff = 'easy';

function nav(id) {
  document.querySelectorAll('.scr').forEach(s => s.classList.remove('on'));
  document.getElementById(id).classList.add('on');
}

function pickDiff(d, i) {
  selDiff = d;
  document.querySelectorAll('.dbtn').forEach(b => b.classList.remove('sel'));
  document.getElementById('d' + i).classList.add('sel');
}

/* ══════════════════════════════════
   LAUNCH GAME
══════════════════════════════════ */
function launch(m, type) {
  gMode     = m;
  powerMode = (type === 'power');
  chaosMode = (type === 'chaos');
  fogMode   = (type === 'fog');
  blindMode = (type === 'blind');
  if (m === 'ai') diff = selDiff;

  document.querySelectorAll('.scr').forEach(s => s.classList.remove('on'));
  document.getElementById('game').style.display = 'block';

  canvas = document.getElementById('board');
  ctx    = canvas.getContext('2d');
  canvas.onclick      = onClick;
  canvas.onmousemove  = onMouseMove;
  canvas.onmouseleave = () => { ghostWall = { x: -1, y: -1 }; };

  const lbl = powerMode ? '⚡ Power-up' : chaosMode ? '🌪️ Chaos' : fogMode ? '👻 Fog of War' : blindMode ? '🌫️ Cờ mù' : '⚖️ Normal';
  document.getElementById('mbadge').innerHTML =
    `<span class="mbadge ${powerMode ? 'mb-p' : 'mb-n'}">${lbl}</span>`;
  document.getElementById('puBar').style.display   = powerMode ? 'block' : 'none';
  document.getElementById('mctsBar').style.display = 'none';

  // Ẩn chat (chỉ dùng cho online)
  document.getElementById('chatToggleBtn').style.display = 'none';
  document.getElementById('chatBox').classList.remove('on');

  initGame();
}

/* ══════════════════════════════════
   MENU / REPLAY
══════════════════════════════════ */
function goMenu() {
  clearInterval(tiv);
  cancelAnimationFrame(raf);
  destroyPeer();
  document.getElementById('game').style.display = 'none';
  document.getElementById('wov').classList.remove('on');
  document.querySelectorAll('.scr').forEach(s => s.classList.remove('on'));
  document.getElementById('s0').classList.add('on');
}

function replay() {
  document.getElementById('wov').classList.remove('on');
  initGame();
}
