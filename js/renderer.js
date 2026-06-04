/**
 * renderer.js
 * Toàn bộ code vẽ canvas: bảng cờ, quân cờ, tường, hiệu ứng.
 */
'use strict';

/* ══ BOARD PALETTE ══ */
const CELL_BASE   = '#1a1628';
const CELL_LIGHT  = '#201c32';
const CELL_BLUE_R = '#0a1228';
const CELL_RED_R  = '#1c0808';
const BOARD_BG    = '#0d0b1a';

/* ══ MAIN DRAW ══ */
function draw() {
  if (!ctx) return;
  const g = Math.sin(gPh) * .5 + .5;
  ctx.clearRect(0, 0, N * C, N * C);

  ctx.fillStyle = BOARD_BG;
  ctx.beginPath(); ctx.roundRect(0, 0, N * C, N * C, 20); ctx.fill();

  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const isGoalBlue = j === 0, isGoalRed = j === 8;
    const isLight = (i + j) % 2 === 0;
    const baseCol = isGoalBlue ? CELL_BLUE_R : isGoalRed ? CELL_RED_R : isLight ? CELL_LIGHT : CELL_BASE;
    ctx.fillStyle = baseCol;
    ctx.beginPath(); ctx.roundRect(i*C+2, j*C+2, C-4, C-4, 5); ctx.fill();
    const hl = ctx.createLinearGradient(i*C, j*C+2, i*C, j*C+C*0.45);
    hl.addColorStop(0, 'rgba(255,255,255,.07)'); hl.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = hl; ctx.beginPath(); ctx.roundRect(i*C+2, j*C+2, C-4, C-4, 5); ctx.fill();
    if (isGoalBlue) { ctx.fillStyle = `rgba(68,136,255,${.13+g*.06})`; ctx.beginPath(); ctx.roundRect(i*C+2,j*C+2,C-4,C-4,5); ctx.fill(); }
    if (isGoalRed)  { ctx.fillStyle = `rgba(255,68,68,${.13+g*.06})`;  ctx.beginPath(); ctx.roundRect(i*C+2,j*C+2,C-4,C-4,5); ctx.fill(); }
    if (fogMode && isInFog(i, j)) {
      ctx.save();
      ctx.fillStyle = `rgba(5,4,16,${.88+Math.sin(gPh*.7+i*.4+j*.5)*.04})`;
      ctx.beginPath(); ctx.roundRect(i*C+2,j*C+2,C-4,C-4,5); ctx.fill();
      ctx.restore();
    }
  }

  /* Goal dots */
  ctx.save(); ctx.globalAlpha = .2 + g * .08;
  for (let i = 0; i < N; i++) {
    ctx.fillStyle = '#4488ff';
    ctx.beginPath(); ctx.arc(i*C+C/2, C/2, 2.5, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#ff4444';
    ctx.beginPath(); ctx.arc(i*C+C/2, N*C-C/2, 2.5, 0, Math.PI*2); ctx.fill();
  }
  ctx.restore();

  if (powerMode && gift.active) _drawGift(g);

  if (teleMode) {
    const op = cur==='blue' ? players.red : players.blue;
    for (let i=0;i<N;i++) for (let j=0;j<N;j++) {
      if (i===op.x && j===op.y) continue;
      ctx.save(); ctx.fillStyle=`rgba(0,200,255,${.09+g*.05})`; ctx.shadowColor='#00ccff'; ctx.shadowBlur=6;
      ctx.beginPath(); ctx.roundRect(i*C+2,j*C+2,C-4,C-4,5); ctx.fill(); ctx.restore();
    }
  }

  const showHL = mode==='move' && (!acted||dblMove) && !over && !teleMode && !(gMode==='ai'&&cur==='red');
  if (showHL) _drawMoveHighlights(g);

  if (powerMode) ['blue','red'].forEach(who => {
    if (!shields[who]) return;
    const p=players[who], cx=p.x*C+C/2, cy=p.y*C+C/2;
    ctx.save(); ctx.strokeStyle=`rgba(80,220,120,${.6+g*.3})`; ctx.lineWidth=2;
    ctx.shadowColor='#44ee88'; ctx.shadowBlur=14+g*8;
    ctx.beginPath(); ctx.arc(cx,cy,27+g*3,0,Math.PI*2); ctx.stroke(); ctx.restore();
  });

  if (ghostWall.x>=0 && (mode==='H'||mode==='V') && !acted && !over && !(gMode==='ai'&&cur==='red'))
    _drawGhostWall(g);

  const hideWalls = (chaosMode&&turnN<chaosHideUntil)||(blindMode&&turnN<blindHideUntil);
  hW.forEach(w => _drawHWall(w, hideWalls));
  vW.forEach(w => _drawVWall(w, hideWalls));

  drawPawnAt(players.blue.x, players.blue.y, 'blue', cur==='blue', g);
  const hideRedPawn = fogMode && (gMode==='2p'||gMode==='ai') && isInFog(players.red.x, players.red.y);
  if (!hideRedPawn) drawPawnAt(players.red.x, players.red.y, 'red', cur==='red', g);
  updPanels();
}

/* ══ STATIC BOARD (replay) ══ */
function drawBoardStatic() {
  const g = Math.sin(gPh) * .5 + .5;
  ctx.clearRect(0,0,N*C,N*C);
  ctx.fillStyle = BOARD_BG; ctx.beginPath(); ctx.roundRect(0,0,N*C,N*C,20); ctx.fill();
  for (let i=0;i<N;i++) for (let j=0;j<N;j++) {
    const isLight=(i+j)%2===0;
    const base = j===0?CELL_BLUE_R:j===8?CELL_RED_R:isLight?CELL_LIGHT:CELL_BASE;
    ctx.fillStyle=base; ctx.beginPath(); ctx.roundRect(i*C+2,j*C+2,C-4,C-4,5); ctx.fill();
    const hl=ctx.createLinearGradient(i*C,j*C+2,i*C,j*C+C*.4);
    hl.addColorStop(0,'rgba(255,255,255,.06)'); hl.addColorStop(1,'rgba(255,255,255,0)');
    ctx.fillStyle=hl; ctx.beginPath(); ctx.roundRect(i*C+2,j*C+2,C-4,C-4,5); ctx.fill();
    if(j===0){ctx.fillStyle='rgba(68,136,255,.1)';ctx.beginPath();ctx.roundRect(i*C+2,j*C+2,C-4,C-4,5);ctx.fill();}
    if(j===8){ctx.fillStyle='rgba(255,68,68,.1)'; ctx.beginPath();ctx.roundRect(i*C+2,j*C+2,C-4,C-4,5);ctx.fill();}
  }
  hW.forEach(w=>_drawHWall(w,false)); vW.forEach(w=>_drawVWall(w,false));
  drawPawnAt(players.blue.x,players.blue.y,'blue',false,g);
  drawPawnAt(players.red.x, players.red.y, 'red', false,g);
}

/* ══ GIFT BOX ══ */
function _drawGift(g) {
  const gx=gift.x*C+C/2, gy=gift.y*C+C/2;
  const bounce=Math.sin(gPh*2)*.5+.5, scale=0.88+bounce*.12;
  ctx.save(); ctx.translate(gx,gy); ctx.scale(scale,scale);
  for (let ring=3;ring>=1;ring--) {
    ctx.globalAlpha=(0.6+bounce*.4)*0.1/ring;
    ctx.shadowColor='#ffc107'; ctx.shadowBlur=18*ring;
    ctx.fillStyle=`rgba(255,210,0,${0.04*ring})`;
    ctx.beginPath(); ctx.arc(0,0,15+ring*4,0,Math.PI*2); ctx.fill();
  }
  ctx.globalAlpha=1;
  ctx.shadowColor='#ffc107'; ctx.shadowBlur=16+bounce*10;
  ctx.fillStyle=`rgba(255,193,7,${0.88+bounce*.12})`;
  ctx.beginPath(); ctx.roundRect(-12,-12,24,24,4); ctx.fill();
  ctx.strokeStyle='rgba(255,80,20,.85)'; ctx.lineWidth=2.5; ctx.shadowBlur=4;
  ctx.beginPath(); ctx.moveTo(-12,0); ctx.lineTo(12,0); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0,-12); ctx.lineTo(0,12); ctx.stroke();
  ctx.strokeStyle='rgba(255,60,10,.9)'; ctx.lineWidth=2;
  ctx.beginPath(); ctx.arc(-4,-4,4,0,Math.PI*2); ctx.stroke();
  ctx.beginPath(); ctx.arc(4,-4,4,0,Math.PI*2); ctx.stroke();
  ctx.fillStyle='rgba(120,40,0,.9)'; ctx.font='bold 10px Inter,sans-serif';
  ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.shadowBlur=0;
  ctx.fillText('?',1,1); ctx.restore();
}

/* ══ MOVE HIGHLIGHTS ══ */
function _drawMoveHighlights(g) {
  const mv=validMoves(), isB=cur==='blue';
  const [rr,gg,bb]=isB?[68,136,255]:[255,68,68];
  for (const {x,y} of mv) {
    const cx=x*C+C/2, cy=y*C+C/2, p=.5+g*.5;
    // Radial glow
    ctx.save();
    const au=ctx.createRadialGradient(cx,cy,3,cx,cy,C*.55);
    au.addColorStop(0,`rgba(${rr},${gg},${bb},${.3*p})`);
    au.addColorStop(.6,`rgba(${rr},${gg},${bb},${.08*p})`);
    au.addColorStop(1,`rgba(${rr},${gg},${bb},0)`);
    ctx.fillStyle=au; ctx.beginPath(); ctx.arc(cx,cy,C*.55,0,Math.PI*2); ctx.fill(); ctx.restore();
    // Cell highlight
    ctx.save(); ctx.shadowColor=`rgb(${rr},${gg},${bb})`; ctx.shadowBlur=12+p*10;
    ctx.fillStyle=`rgba(${rr},${gg},${bb},${.18+p*.1})`;
    ctx.beginPath(); ctx.roundRect(x*C+4,y*C+4,C-8,C-8,6); ctx.fill(); ctx.restore();
    // Border
    ctx.save(); ctx.strokeStyle=`rgba(${rr},${gg},${bb},${.5+p*.35})`; ctx.lineWidth=1.5;
    ctx.shadowColor=`rgb(${rr},${gg},${bb})`; ctx.shadowBlur=6;
    ctx.beginPath(); ctx.roundRect(x*C+4,y*C+4,C-8,C-8,6); ctx.stroke(); ctx.restore();
    // Center dot
    const dr=5+p*4;
    ctx.save(); ctx.shadowColor=`rgb(${rr},${gg},${bb})`; ctx.shadowBlur=10+p*8;
    const dg=ctx.createRadialGradient(cx,cy,0,cx,cy,dr);
    dg.addColorStop(0,'rgba(255,255,255,.98)');
    dg.addColorStop(.4,`rgba(${rr},${gg},${bb},.85)`);
    dg.addColorStop(1,`rgba(${rr},${gg},${bb},0)`);
    ctx.fillStyle=dg; ctx.beginPath(); ctx.arc(cx,cy,dr,0,Math.PI*2); ctx.fill(); ctx.restore();
  }
}

/* ══ GHOST WALL ══ */
function _drawGhostWall(g) {
  const [rr,gg,bb]=cur==='blue'?[68,136,255]:[255,68,68];
  ctx.save(); ctx.globalAlpha=.38+g*.12;
  ctx.shadowColor=`rgb(${rr},${gg},${bb})`; ctx.shadowBlur=14;
  if (mode==='H') {
    const wx=ghostWall.x*C+4, wy=ghostWall.y*C+C-7, ww=C*2-8, wh=11;
    const wg=ctx.createLinearGradient(wx,wy,wx,wy+wh);
    wg.addColorStop(0,`rgba(${rr},${gg},${bb},.95)`); wg.addColorStop(1,`rgba(${rr},${gg},${bb},.5)`);
    ctx.fillStyle=wg; ctx.beginPath(); ctx.roundRect(wx,wy,ww,wh,4); ctx.fill();
    ctx.strokeStyle=`rgba(${rr},${gg},${bb},.7)`; ctx.lineWidth=1; ctx.stroke();
  } else {
    const wx=ghostWall.x*C+C-7, wy=ghostWall.y*C+4, ww=11, wh=C*2-8;
    const wg=ctx.createLinearGradient(wx,wy,wx+ww,wy);
    wg.addColorStop(0,`rgba(${rr},${gg},${bb},.95)`); wg.addColorStop(1,`rgba(${rr},${gg},${bb},.5)`);
    ctx.fillStyle=wg; ctx.beginPath(); ctx.roundRect(wx,wy,ww,wh,4); ctx.fill();
    ctx.strokeStyle=`rgba(${rr},${gg},${bb},.7)`; ctx.lineWidth=1; ctx.stroke();
  }
  ctx.restore();
}

/* ══ WALLS ══ */
function _drawHWall(w, hidden) {
  if (hidden) return;
  if (fogMode && wallInFog(w.x, w.y, 'h')) return;
  const wx=w.x*C+4, wy=w.y*C+C-7, ww=C*2-8, wh=11;
  // Shadow
  ctx.save(); ctx.shadowColor='rgba(0,0,0,.8)'; ctx.shadowBlur=10; ctx.shadowOffsetY=3;
  ctx.fillStyle='#0e0500'; ctx.beginPath(); ctx.roundRect(wx,wy,ww,wh,4); ctx.fill(); ctx.restore();
  // Body gradient
  const wg=ctx.createLinearGradient(wx,wy,wx,wy+wh);
  wg.addColorStop(0,'#cc7a22'); wg.addColorStop(.35,'#e8932e'); wg.addColorStop(.7,'#a0601a'); wg.addColorStop(1,'#5c3408');
  ctx.fillStyle=wg; ctx.beginPath(); ctx.roundRect(wx,wy,ww,wh,4); ctx.fill();
  // Top highlight
  ctx.fillStyle='rgba(255,200,100,.28)'; ctx.beginPath(); ctx.roundRect(wx+3,wy+1,ww-6,3,2); ctx.fill();
}

function _drawVWall(w, hidden) {
  if (hidden) return;
  if (fogMode && wallInFog(w.x, w.y, 'v')) return;
  const wx=w.x*C+C-7, wy=w.y*C+4, ww=11, wh=C*2-8;
  ctx.save(); ctx.shadowColor='rgba(0,0,0,.8)'; ctx.shadowBlur=10; ctx.shadowOffsetX=3;
  ctx.fillStyle='#0e0500'; ctx.beginPath(); ctx.roundRect(wx,wy,ww,wh,4); ctx.fill(); ctx.restore();
  const wg=ctx.createLinearGradient(wx,wy,wx+ww,wy);
  wg.addColorStop(0,'#cc7a22'); wg.addColorStop(.35,'#e8932e'); wg.addColorStop(.7,'#a0601a'); wg.addColorStop(1,'#5c3408');
  ctx.fillStyle=wg; ctx.beginPath(); ctx.roundRect(wx,wy,ww,wh,4); ctx.fill();
  ctx.fillStyle='rgba(255,200,100,.28)'; ctx.beginPath(); ctx.roundRect(wx+1,wy+3,3,wh-6,2); ctx.fill();
}

/* ══ PAWN ══ */
function drawPawnAt(px, py, who, isActive, g) {
  const cx=px*C+C/2, cy=py*C+C/2, isB=who==='blue';
  const [rr,gg,bb]=isB?[68,136,255]:[255,68,68];
  const lt=isB?'#c0d8ff':'#ffc0c0', dk=isB?'#0a2080':'#801010', R=20;

  // Drop shadow
  ctx.save(); ctx.globalAlpha=.35; ctx.fillStyle='rgba(0,0,0,.6)'; ctx.filter='blur(5px)';
  ctx.beginPath(); ctx.ellipse(cx+2,cy+R-1,R*.6,4.5,0,0,Math.PI*2); ctx.fill(); ctx.restore();

  // Active rings
  if (isActive) {
    ctx.save(); ctx.globalAlpha=.18+g*.15; ctx.strokeStyle=`rgb(${rr},${gg},${bb})`; ctx.lineWidth=2.5;
    ctx.shadowColor=`rgb(${rr},${gg},${bb})`; ctx.shadowBlur=20+g*14;
    ctx.beginPath(); ctx.arc(cx,cy,R+7+g*5,0,Math.PI*2); ctx.stroke(); ctx.restore();
    ctx.save(); ctx.globalAlpha=.07+g*.06; ctx.strokeStyle=`rgb(${rr},${gg},${bb})`; ctx.lineWidth=1.5;
    ctx.beginPath(); ctx.arc(cx,cy,R+14+g*4,0,Math.PI*2); ctx.stroke(); ctx.restore();
  }

  // Pawn body
  ctx.save();
  ctx.shadowColor=isActive?`rgb(${rr},${gg},${bb})`:'rgba(0,0,0,.45)';
  ctx.shadowBlur=isActive?20+g*14:10;
  const bg=ctx.createRadialGradient(cx-6,cy-6,1,cx,cy,R);
  bg.addColorStop(0,'rgba(255,255,255,.95)');
  bg.addColorStop(.12,lt);
  bg.addColorStop(.55,`rgb(${rr},${gg},${bb})`);
  bg.addColorStop(1,dk);
  ctx.fillStyle=bg; ctx.beginPath(); ctx.arc(cx,cy,R,0,Math.PI*2); ctx.fill(); ctx.restore();

  // Rim
  ctx.save();
  ctx.strokeStyle=isActive?'rgba(255,255,255,.8)':'rgba(255,255,255,.2)';
  ctx.lineWidth=isActive?2:1.2;
  if (isActive){ctx.shadowColor=`rgb(${rr},${gg},${bb})`;ctx.shadowBlur=8;}
  ctx.beginPath(); ctx.arc(cx,cy,R,0,Math.PI*2); ctx.stroke(); ctx.restore();

  // Specular
  ctx.save(); ctx.globalAlpha=.5;
  const sp=ctx.createRadialGradient(cx-7,cy-7,0,cx-4,cy-4,10);
  sp.addColorStop(0,'rgba(255,255,255,.9)'); sp.addColorStop(1,'rgba(255,255,255,0)');
  ctx.fillStyle=sp; ctx.beginPath(); ctx.arc(cx,cy,R,0,Math.PI*2); ctx.fill(); ctx.restore();

  // Label
  ctx.save(); ctx.fillStyle='rgba(255,255,255,.95)';
  ctx.font=`bold 13px 'Cinzel',serif`;
  ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.shadowColor='rgba(0,0,0,.5)'; ctx.shadowBlur=4;
  ctx.fillText(isB?'B':'R',cx,cy+1); ctx.restore();
}
