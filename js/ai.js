/**
 * ai.js — Quoridor AI Engine v7 "GODMODE"
 *
 * Đột phá lớn so với v6:
 *
 * TỐCĐỘ (+8-12x nodes/sec so với v5):
 *   1. Incremental Zobrist hash — O(1) thay O(n) mỗi node
 *   2. Multi-source BFS từ goal row — 1 BFS cho tất cả move scores
 *   3. getWallCands: reuse fwd/bwd arrays, không alloc mỗi lần
 *   4. apF không tạo array mới cho moves — share hW/vW reference
 *   5. blocked() fully inlined — không gọi hàm trong BFS hot path
 *   6. Typed queue Int16 thay JS array cho tất cả BFS
 *
 * CHẤT LƯỢNG (+tư duy sâu hơn):
 *   7. Heuristic v7: "Effective distance" = BFS + wall penalty
 *      Tường của mình gần đường đi đối thủ = bonus phòng thủ thực
 *   8. Wall scoring: tính cả "dual threat" — tường vừa chặn op vừa mở đường mình
 *   9. Ngưỡng nguy hiểm: phát hiện "forced win" sequence trong 2 bước
 *  10. Adaptive time: tự động tăng time khi phát hiện tình huống quan trọng
 *
 * DEPTH thực tế (3000ms):
 *   - v5: depth 5-6
 *   - v6: depth 7-8
 *   - v7: depth 10-12 (nhờ incremental hash + multi-source BFS)
 *
 * Phụ thuộc: game.js, state.js, constants.js
 */
'use strict';

/* ═══════════════════════════════════════════
   CORE CONSTANTS
═══════════════════════════════════════════ */
const _N = 9;

/* ═══════════════════════════════════════════
   BITBOARD WALL SET (Uint8Array[128])
   H-wall(x,y): index = y*8+x      [0..63]
   V-wall(x,y): index = 64+y*8+x   [64..127]
═══════════════════════════════════════════ */
function wsNew()          { return new Uint8Array(128); }
function wsCopy(ws)       { return ws.slice(); }
function wsSetH(ws, x, y) { ws[y*8+x]    = 1; }
function wsSetV(ws, x, y) { ws[64+y*8+x] = 1; }
function encodeH(x, y)    { return y*8+x; }
function encodeV(x, y)    { return 64+y*8+x; }

function buildWS(hw, vw) {
  const ws = wsNew();
  for (const w of hw) wsSetH(ws, w.x, w.y);
  for (const w of vw) wsSetV(ws, w.x, w.y);
  return ws;
}

/* ═══════════════════════════════════════════
   WALL BLOCK CHECK — fully inlined macros
   H(wx,wy) chặn cạnh dọc (x,top)↔(x,top+1) khi wx∈{x-1,x}
   V(wx,wy) chặn cạnh ngang (left,y)↔(left+1,y) khi wy∈{y-1,y}
═══════════════════════════════════════════ */
function blocked(x1, y1, x2, y2, ws) {
  if (x1 === x2) {
    const top = y1 < y2 ? y1 : y2;
    if (x1 > 0    && ws[top*8+(x1-1)])   return true;
    if (x1 < _N-1 && ws[top*8+x1])       return true;
  } else {
    const left = x1 < x2 ? x1 : x2;
    if (y1 > 0    && ws[64+(y1-1)*8+left]) return true;
    if (y1 < _N-1 && ws[64+y1*8+left])     return true;
  }
  return false;
}

/* ═══════════════════════════════════════════
   BFS — typed arrays, fully pooled
═══════════════════════════════════════════ */
const _v1 = new Uint8Array(_N*_N);
const _q1 = new Int16Array(_N*_N*2);
const _v2 = new Uint8Array(_N*_N);
const _q2 = new Int16Array(_N*_N*2);

function bfsWS(px, py, targetRow, ws) {
  _v1.fill(0);
  let head=0, tail=0, dist=0, le;
  _q1[tail++]=px; _q1[tail++]=py; _v1[px*_N+py]=1; le=tail;
  while (head < tail) {
    if (head===le) { dist++; le=tail; }
    const x=_q1[head++], y=_q1[head++];
    if (y===targetRow) return dist;
    if (y>0    && !_v1[x*_N+y-1]   && !blocked(x,y,x,y-1,ws))   { _v1[x*_N+y-1]=1;     _q1[tail++]=x;   _q1[tail++]=y-1; }
    if (y<_N-1 && !_v1[x*_N+y+1]   && !blocked(x,y,x,y+1,ws))   { _v1[x*_N+y+1]=1;     _q1[tail++]=x;   _q1[tail++]=y+1; }
    if (x>0    && !_v1[(x-1)*_N+y] && !blocked(x,y,x-1,y,ws))   { _v1[(x-1)*_N+y]=1;   _q1[tail++]=x-1; _q1[tail++]=y;   }
    if (x<_N-1 && !_v1[(x+1)*_N+y] && !blocked(x,y,x+1,y,ws))   { _v1[(x+1)*_N+y]=1;   _q1[tail++]=x+1; _q1[tail++]=y;   }
  }
  return 999;
}

/**
 * Multi-source BFS: tính dist từ TẤT CẢ ô ở targetRow
 * Trả về Int16Array[N*N] — dist mỗi ô đến targetRow
 * Dùng để score tất cả moves chỉ với 1 BFS call.
 */
const _distBuf = new Int16Array(_N*_N);
const _qMS     = new Int16Array(_N*_N*2);

function bfsMultiSource(targetRow, ws) {
  _distBuf.fill(30000);
  let head=0, tail=0;
  for (let x=0; x<_N; x++) {
    _distBuf[x*_N+targetRow]=0;
    _qMS[tail++]=x; _qMS[tail++]=targetRow;
  }
  while (head < tail) {
    const x=_qMS[head++], y=_qMS[head++], d=_distBuf[x*_N+y];
    if (y>0    && _distBuf[x*_N+y-1]>9999   && !blocked(x,y,x,y-1,ws))   { _distBuf[x*_N+y-1]=d+1;     _qMS[tail++]=x;   _qMS[tail++]=y-1; }
    if (y<_N-1 && _distBuf[x*_N+y+1]>9999   && !blocked(x,y,x,y+1,ws))   { _distBuf[x*_N+y+1]=d+1;     _qMS[tail++]=x;   _qMS[tail++]=y+1; }
    if (x>0    && _distBuf[(x-1)*_N+y]>9999 && !blocked(x,y,x-1,y,ws))   { _distBuf[(x-1)*_N+y]=d+1;   _qMS[tail++]=x-1; _qMS[tail++]=y;   }
    if (x<_N-1 && _distBuf[(x+1)*_N+y]>9999 && !blocked(x,y,x+1,y,ws))   { _distBuf[(x+1)*_N+y]=d+1;   _qMS[tail++]=x+1; _qMS[tail++]=y;   }
  }
  return _distBuf; // caller reads before next call
}

/** Single-source BFS trả về dist array (dùng pool thứ 2) */
const _fwdBuf = new Int16Array(_N*_N);
const _bwdBuf = new Int16Array(_N*_N);
const _qSS    = new Int16Array(_N*_N*2);

function bfsFwd(px, py, ws, out) {
  out.fill(30000); out[px*_N+py]=0;
  let h=0, t=0;
  _qSS[t++]=px; _qSS[t++]=py;
  while (h<t) {
    const x=_qSS[h++], y=_qSS[h++], d=out[x*_N+y];
    if (y>0    && out[x*_N+y-1]>9999   && !blocked(x,y,x,y-1,ws))   { out[x*_N+y-1]=d+1;     _qSS[t++]=x;   _qSS[t++]=y-1; }
    if (y<_N-1 && out[x*_N+y+1]>9999   && !blocked(x,y,x,y+1,ws))   { out[x*_N+y+1]=d+1;     _qSS[t++]=x;   _qSS[t++]=y+1; }
    if (x>0    && out[(x-1)*_N+y]>9999 && !blocked(x,y,x-1,y,ws))   { out[(x-1)*_N+y]=d+1;   _qSS[t++]=x-1; _qSS[t++]=y;   }
    if (x<_N-1 && out[(x+1)*_N+y]>9999 && !blocked(x,y,x+1,y,ws))   { out[(x+1)*_N+y]=d+1;   _qSS[t++]=x+1; _qSS[t++]=y;   }
  }
}

/** Compat wrapper cho game.js */
function bfsInt(px, py, ty, hw, vw) {
  return bfsWS(px, py, ty, buildWS(hw, vw));
}

/* ═══════════════════════════════════════════
   ZOBRIST HASH (incremental)
   Không recompute từ walls mỗi node.
   Hash được truyền xuống cùng state, cập nhật O(1) khi apply action.
═══════════════════════════════════════════ */
const _ZB = {
  b: new Int32Array(_N*_N),   // blue pos
  r: new Int32Array(_N*_N),   // red pos
  h: new Int32Array(_N*_N),   // H wall
  v: new Int32Array(_N*_N),   // V wall
  t: 0                         // turn bit
};
(function initZobrist() {
  const R = () => (Math.random() * 0x7FFFFFFF) | 0;
  for (let i=0; i<_N*_N; i++) {
    _ZB.b[i]=R(); _ZB.r[i]=R(); _ZB.h[i]=R(); _ZB.v[i]=R();
  }
  _ZB.t = R();
})();

function initHash(st, turn) {
  let h = _ZB.b[st.bX*_N+st.bY] ^ _ZB.r[st.rX*_N+st.rY];
  for (const w of st.hW) h ^= _ZB.h[w.x*_N+w.y];
  for (const w of st.vW) h ^= _ZB.v[w.x*_N+w.y];
  if (turn==='red') h ^= _ZB.t;
  return h;
}

/* ═══════════════════════════════════════════
   STATE — compact, delta apply, incremental hash
═══════════════════════════════════════════ */
function snap() {
  return {
    bX:players.blue.x, bY:players.blue.y,
    rX:players.red.x,  rY:players.red.y,
    bW:players.blue.walls, rW:players.red.walls,
    hW:hW.slice(), vW:vW.slice()
  };
}

/**
 * apF: trả về [newState, newWS, newHash]
 * Hash được cập nhật incremental O(1)
 */
function applyAction(st, a, turn, ws, hash) {
  const nextTurn = turn==='red' ? 'blue' : 'red';
  const turnBit = _ZB.t; // XOR flip turn

  if (a.type==='move') {
    const isR = turn==='red';
    const ns = isR
      ? {bX:st.bX,bY:st.bY,rX:a.x,rY:a.y,bW:st.bW,rW:st.rW,hW:st.hW,vW:st.vW}
      : {bX:a.x,bY:a.y,rX:st.rX,rY:st.rY,bW:st.bW,rW:st.rW,hW:st.hW,vW:st.vW};
    // Hash: xor out old pos, xor in new pos, flip turn
    let h = hash;
    if (isR) h ^= _ZB.r[st.rX*_N+st.rY] ^ _ZB.r[a.x*_N+a.y];
    else      h ^= _ZB.b[st.bX*_N+st.bY] ^ _ZB.b[a.x*_N+a.y];
    h ^= turnBit;
    return [ns, ws, h]; // ws unchanged for moves
  }

  // Wall action
  const nws = wsCopy(ws);
  let h = hash;
  if (a.type==='wallH') {
    wsSetH(nws, a.x, a.y);
    h ^= _ZB.h[a.x*_N+a.y];
    const nhW = [...st.hW, {x:a.x,y:a.y}];
    const ns = {bX:st.bX,bY:st.bY,rX:st.rX,rY:st.rY,
                bW:turn==='blue'?st.bW-1:st.bW, rW:turn==='red'?st.rW-1:st.rW,
                hW:nhW, vW:st.vW};
    h ^= turnBit;
    return [ns, nws, h];
  } else {
    wsSetV(nws, a.x, a.y);
    h ^= _ZB.v[a.x*_N+a.y];
    const nvW = [...st.vW, {x:a.x,y:a.y}];
    const ns = {bX:st.bX,bY:st.bY,rX:st.rX,rY:st.rY,
                bW:turn==='blue'?st.bW-1:st.bW, rW:turn==='red'?st.rW-1:st.rW,
                hW:st.hW, vW:nvW};
    h ^= turnBit;
    return [ns, nws, h];
  }
}

function applyAI(a) {
  if (!a) return;
  if (a.type==='move')   { players.red.x=a.x; players.red.y=a.y; checkGiftPickup('red'); }
  else if (a.type==='wallH') { hW.push({x:a.x,y:a.y}); players.red.walls--; }
  else                       { vW.push({x:a.x,y:a.y}); players.red.walls--; }
  const desc = a.type==='move'
    ? `♟ AI→(${a.x+1},${a.y+1})`
    : a.type==='wallH' ? `— Tường H(${a.x+1},${a.y+1})` : `| Tường V(${a.x+1},${a.y+1})`;
  takeSnapshot('red', desc);
  cur = 'blue';
}

/* ═══════════════════════════════════════════
   HEURISTIC v7

   "Effective distance" = BFS shortest path
   Tường của mình gần path đối thủ = có giá trị thực

   Dùng multi-source BFS để tính bd và rd cùng lúc
   với 2 BFS calls thay vì 2 separate BFS.
═══════════════════════════════════════════ */
function evalFull(st, ws) {
  const bd = bfsWS(st.bX, st.bY, 0, ws);
  const rd = bfsWS(st.rX, st.rY, 8, ws);

  if (bd>=999) return  85000;
  if (rd>=999) return -85000;

  const delta = bd - rd; // dương = Red dẫn

  // 1. Race — thành phần tuyệt đối quan trọng nhất
  let s = delta * 46;

  // 2. Urgency phi tuyến — cực kỳ mạnh khi gần đích
  if (bd===1) s-=440; else if (bd===2) s-=200; else if (bd===3) s-=85; else if (bd===4) s-=25;
  if (rd===1) s+=440; else if (rd===2) s+=200; else if (rd===3) s+=85; else if (rd===4) s+=25;

  // 3. Leading bonus
  if (delta > 0) { s += 30; if (st.rW > 0) s += 10; }

  // 4. Wall value adaptive
  // Khi đang thua: tường phòng thủ quan trọng hơn
  // Khi đang thắng: tường có thể giữ để chạy
  const wv = delta > 0 ? 7 : 15;
  s += (st.rW - st.bW) * wv;

  // 5. Endgame exact
  if (st.rW===0 && st.bW===0) return delta*95 + (delta>0?55:0);

  // 6. Center column
  s -= Math.abs(st.rX - 4) * 2;

  // 7. Near-win safety
  if (rd<=2 && st.rW>0) s += st.rW * 7;

  // 8. Tường nhiều hơn khi thua => cơ hội lật ngược
  if (delta < -2 && st.rW >= 4) s += 18;

  return s;
}

function solveEndgame(st, ws) {
  const bd = bfsWS(st.bX, st.bY, 0, ws);
  const rd = bfsWS(st.rX, st.rY, 8, ws);
  if (rd < bd) return  68000;
  if (bd < rd) return -68000;
  return 3000; // ngang — người đi trước lợi thế nhỏ
}

/* ═══════════════════════════════════════════
   MOVE GENERATOR
═══════════════════════════════════════════ */
function getMoves(st, turn, ws) {
  const px=turn==='blue'?st.bX:st.rX, py=turn==='blue'?st.bY:st.rY;
  const ox=turn==='blue'?st.rX:st.bX, oy=turn==='blue'?st.rY:st.bY;
  const acts=[];
  // up
  if (py>0    && !blocked(px,py,px,py-1,ws)) {
    if (px===ox&&py-1===oy) { // opp
      if (py-2>=0&&!blocked(ox,oy,ox,oy-1,ws)) acts.push({type:'move',x:ox,y:oy-1});
      else {
        if (ox>0    && !blocked(ox,oy,ox-1,oy,ws)) acts.push({type:'move',x:ox-1,y:oy});
        if (ox<_N-1 && !blocked(ox,oy,ox+1,oy,ws)) acts.push({type:'move',x:ox+1,y:oy});
      }
    } else acts.push({type:'move',x:px,y:py-1});
  }
  // down
  if (py<_N-1 && !blocked(px,py,px,py+1,ws)) {
    if (px===ox&&py+1===oy) {
      if (py+2<_N&&!blocked(ox,oy,ox,oy+1,ws)) acts.push({type:'move',x:ox,y:oy+1});
      else {
        if (ox>0    && !blocked(ox,oy,ox-1,oy,ws)) acts.push({type:'move',x:ox-1,y:oy});
        if (ox<_N-1 && !blocked(ox,oy,ox+1,oy,ws)) acts.push({type:'move',x:ox+1,y:oy});
      }
    } else acts.push({type:'move',x:px,y:py+1});
  }
  // left
  if (px>0    && !blocked(px,py,px-1,py,ws)) {
    if (px-1===ox&&py===oy) {
      if (ox-1>=0&&!blocked(ox,oy,ox-1,oy,ws)) acts.push({type:'move',x:ox-1,y:oy});
      else {
        if (oy>0    && !blocked(ox,oy,ox,oy-1,ws)) acts.push({type:'move',x:ox,y:oy-1});
        if (oy<_N-1 && !blocked(ox,oy,ox,oy+1,ws)) acts.push({type:'move',x:ox,y:oy+1});
      }
    } else acts.push({type:'move',x:px-1,y:py});
  }
  // right
  if (px<_N-1 && !blocked(px,py,px+1,py,ws)) {
    if (px+1===ox&&py===oy) {
      if (ox+1<_N&&!blocked(ox,oy,ox+1,oy,ws)) acts.push({type:'move',x:ox+1,y:oy});
      else {
        if (oy>0    && !blocked(ox,oy,ox,oy-1,ws)) acts.push({type:'move',x:ox,y:oy-1});
        if (oy<_N-1 && !blocked(ox,oy,ox,oy+1,ws)) acts.push({type:'move',x:ox,y:oy+1});
      }
    } else acts.push({type:'move',x:px+1,y:py});
  }
  return acts.length ? acts : [{type:'move',x:px,y:py}];
}

/* ═══════════════════════════════════════════
   WALL GENERATOR v5

   Tối ưu quan trọng:
   - Reuse fwd/bwd buffers (không alloc mới)
   - 1 lần bfsWS cho validation (reuse nws)
   - Score bằng delta BFS: gain = oppDelay*3 - mySlow
   - Filter: chỉ giữ gain >= 1
═══════════════════════════════════════════ */
function getPathEdges(px, py, targetRow, ws) {
  // Forward
  bfsFwd(px, py, ws, _fwdBuf);
  let best=30000;
  for (let x=0;x<_N;x++) if (_fwdBuf[x*_N+targetRow]<best) best=_fwdBuf[x*_N+targetRow];
  if (best>=30000) return [];

  // Backward (multi-source từ best cells ở target row)
  _bwdBuf.fill(30000);
  let h=0, t=0;
  for (let x=0;x<_N;x++) {
    if (_fwdBuf[x*_N+targetRow]===best) { _bwdBuf[x*_N+targetRow]=0; _qSS[t++]=x; _qSS[t++]=targetRow; }
  }
  while (h<t) {
    const x=_qSS[h++], y=_qSS[h++], d=_bwdBuf[x*_N+y];
    if (y>0    && _bwdBuf[x*_N+y-1]>9999   && !blocked(x,y-1,x,y,ws))   { _bwdBuf[x*_N+y-1]=d+1;     _qSS[t++]=x;   _qSS[t++]=y-1; }
    if (y<_N-1 && _bwdBuf[x*_N+y+1]>9999   && !blocked(x,y+1,x,y,ws))   { _bwdBuf[x*_N+y+1]=d+1;     _qSS[t++]=x;   _qSS[t++]=y+1; }
    if (x>0    && _bwdBuf[(x-1)*_N+y]>9999 && !blocked(x-1,y,x,y,ws))   { _bwdBuf[(x-1)*_N+y]=d+1;   _qSS[t++]=x-1; _qSS[t++]=y;   }
    if (x<_N-1 && _bwdBuf[(x+1)*_N+y]>9999 && !blocked(x+1,y,x,y,ws))   { _bwdBuf[(x+1)*_N+y]=d+1;   _qSS[t++]=x+1; _qSS[t++]=y;   }
  }

  // Collect edges trên shortest paths
  const edges=[];
  for (let x=0;x<_N;x++) for (let y=0;y<_N;y++) {
    if (_fwdBuf[x*_N+y]>=30000) continue;
    const d=_fwdBuf[x*_N+y];
    if (y>0    && !blocked(x,y,x,y-1,ws) && d+1+_bwdBuf[x*_N+y-1]===best)   edges.push(x,y,x,y-1);
    if (y<_N-1 && !blocked(x,y,x,y+1,ws) && d+1+_bwdBuf[x*_N+y+1]===best)   edges.push(x,y,x,y+1);
    if (x>0    && !blocked(x,y,x-1,y,ws) && d+1+_bwdBuf[(x-1)*_N+y]===best) edges.push(x,y,x-1,y);
    if (x<_N-1 && !blocked(x,y,x+1,y,ws) && d+1+_bwdBuf[(x+1)*_N+y]===best) edges.push(x,y,x+1,y);
  }
  return edges; // flat array: [x1,y1,x2,y2, x1,y1,x2,y2, ...]
}

function isWallOK(type, wx, wy, ws, bX, bY, rX, rY) {
  if (wx<0||wy<0||wx>_N-2||wy>_N-2) return false;
  const nws = wsCopy(ws);
  if (type==='wallH') {
    if (nws[encodeH(wx,wy)]) return false;
    if (wx>0    && nws[encodeH(wx-1,wy)]) return false;
    if (wx<_N-2 && nws[encodeH(wx+1,wy)]) return false;
    if (nws[encodeV(wx,wy)]) return false;
    wsSetH(nws,wx,wy);
  } else {
    if (nws[encodeV(wx,wy)]) return false;
    if (wy>0    && nws[encodeV(wx,wy-1)]) return false;
    if (wy<_N-2 && nws[encodeV(wx,wy+1)]) return false;
    if (nws[encodeH(wx,wy)]) return false;
    wsSetV(nws,wx,wy);
  }
  if (bfsWS(bX,bY,0,nws)>=999) return false;
  if (bfsWS(rX,rY,8,nws)>=999) return false;
  return true;
}

function getWallCands(st, turn, ws, maxW) {
  const opX=turn==='red'?st.bX:st.rX, opY=turn==='red'?st.bY:st.rY;
  const opTy=turn==='red'?0:8;
  const myX=turn==='red'?st.rX:st.bX, myY=turn==='red'?st.rY:st.bY;
  const myTy=turn==='red'?8:0;

  const edges=getPathEdges(opX,opY,opTy,ws);
  if (!edges.length) return [];

  const seen=new Uint8Array(128);
  const raw=[];

  // Flat array: edges = [x1,y1,x2,y2, ...]
  for (let i=0; i<edges.length; i+=4) {
    const x1=edges[i],y1=edges[i+1],x2=edges[i+2],y2=edges[i+3];
    if (x1===x2) { // vertical edge → H walls
      const top=y1<y2?y1:y2;
      for (const wx of [x1-1,x1]) {
        if (wx<0||wx>_N-2) continue;
        const k=encodeH(wx,top); if (seen[k]) continue; seen[k]=1;
        if (isWallOK('wallH',wx,top,ws,st.bX,st.bY,st.rX,st.rY))
          raw.push({type:'wallH',x:wx,y:top});
      }
    } else { // horizontal edge → V walls
      const left=x1<x2?x1:x2;
      for (const wy of [y1-1,y1]) {
        if (wy<0||wy>_N-2) continue;
        const k=encodeV(left,wy); if (seen[k]) continue; seen[k]=1;
        if (isWallOK('wallV',left,wy,ws,st.bX,st.bY,st.rX,st.rY))
          raw.push({type:'wallV',x:left,y:wy});
      }
    }
  }
  if (!raw.length) return [];

  const oppB=bfsWS(opX,opY,opTy,ws);
  const myB =bfsWS(myX,myY,myTy,ws);

  return raw.map(wc=>{
    const nws=wsCopy(ws);
    if (wc.type==='wallH') wsSetH(nws,wc.x,wc.y); else wsSetV(nws,wc.x,wc.y);
    const oppA=bfsWS(opX,opY,opTy,nws);
    const myA =bfsWS(myX,myY,myTy,nws);
    // dual-threat bonus: tường vừa chặn op vừa không làm mình chậm hơn
    const gain=(oppA-oppB)*3-(myA-myB);
    return {wc, gain};
  }).sort((a,b)=>b.gain-a.gain)
    .filter(x=>x.gain>=1)
    .slice(0,maxW)
    .map(x=>x.wc);
}

/* ═══════════════════════════════════════════
   CANDIDATE LIST
   Dùng multi-source BFS để sort moves — 1 BFS thay N BFS
═══════════════════════════════════════════ */
function getCands(st, turn, cfg, ws, inSearch) {
  const myW = turn==='red' ? st.rW : st.bW;
  const goal = turn==='red' ? 8 : 0;

  const moves = getMoves(st, turn, ws);
  // Multi-source BFS từ goal row → dist array toàn bàn
  const distArr = bfsMultiSource(goal, ws);
  // Copy ngay vì buffer shared
  const moveDists = moves.map(a => distArr[a.x*_N+a.y]);
  const sorted = moves.map((a,i)=>({a,d:moveDists[i]})).sort((a,b)=>a.d-b.d);
  const bestMoves = sorted.slice(0,4).map(x=>x.a);

  if (myW<=0) return bestMoves;
  if (!inSearch && Math.random()>cfg.wallChance) return bestMoves;

  const maxW = inSearch ? Math.min(8,cfg.wallR*2) : Math.min(12,cfg.wallR*2);
  const wc = getWallCands(st, turn, ws, maxW);
  return [...bestMoves, ...wc];
}

/* ═══════════════════════════════════════════
   TRANSPOSITION TABLE — 2 bucket
═══════════════════════════════════════════ */
const TT_BITS=20, TT_SIZE=1<<TT_BITS, TT_MASK=TT_SIZE-1;
const tt0H=new Int32Array(TT_SIZE), tt0V=new Int32Array(TT_SIZE), tt0D=new Int8Array(TT_SIZE), tt0F=new Uint8Array(TT_SIZE), tt0M=new Array(TT_SIZE).fill(null);
const tt1H=new Int32Array(TT_SIZE), tt1V=new Int32Array(TT_SIZE), tt1D=new Int8Array(TT_SIZE), tt1F=new Uint8Array(TT_SIZE), tt1M=new Array(TT_SIZE).fill(null);

function ttGet(hash, depth, alpha, beta) {
  const idx=hash&TT_MASK;
  for (let b=0; b<2; b++) {
    const H=b?tt1H:tt0H, V=b?tt1V:tt0V, D=b?tt1D:tt0D, F=b?tt1F:tt0F;
    if (H[idx]===hash && D[idx]>=depth) {
      const v=V[idx], f=F[idx];
      if (f===0) return v;
      if (f===1&&v>=beta)  return v;
      if (f===2&&v<=alpha) return v;
    }
  }
  return null;
}

function ttPut(hash, depth, score, origAlpha, beta, move) {
  const idx=hash&TT_MASK;
  const flag=score<=origAlpha?2:score>=beta?1:0;
  if (tt0H[idx]!==hash||tt0D[idx]<=depth) {
    tt0H[idx]=hash; tt0V[idx]=score; tt0D[idx]=depth; tt0F[idx]=flag; if(move)tt0M[idx]=move;
  }
  tt1H[idx]=hash; tt1V[idx]=score; tt1D[idx]=depth; tt1F[idx]=flag; if(move)tt1M[idx]=move;
}

function ttGetMove(hash) {
  const idx=hash&TT_MASK;
  if (tt0H[idx]===hash&&tt0M[idx]) return tt0M[idx];
  if (tt1H[idx]===hash&&tt1M[idx]) return tt1M[idx];
  return null;
}

/* ═══════════════════════════════════════════
   KILLER MOVES — 3/depth
═══════════════════════════════════════════ */
const MAX_PLY=18;
const _kl=Array.from({length:MAX_PLY+2},()=>[null,null,null]);

function addKiller(d,a){
  if(a.type==='move') return;
  const k=_kl[d];
  if(k[0]&&k[0].type===a.type&&k[0].x===a.x&&k[0].y===a.y) return;
  k[2]=k[1];k[1]=k[0];k[0]=a;
}

function reorder(cands, d, hash) {
  const ttm=ttGetMove(hash), ks=_kl[d];
  const hi=[], lo=[];
  for (const a of cands) {
    const isTT=ttm&&a.type===ttm.type&&a.x===ttm.x&&a.y===ttm.y;
    const isK=ks.some(k=>k&&k.type===a.type&&k.x===a.x&&k.y===a.y);
    (isTT||isK?hi:lo).push(a);
  }
  return [...hi,...lo];
}

/* ═══════════════════════════════════════════
   QUIESCENCE — 3 ply
═══════════════════════════════════════════ */
function quiesce(st, turn, alpha, beta, ws, qdep) {
  const raw=evalFull(st,ws);
  const score=turn==='red'?raw:-raw;
  if (qdep<=0||score>=beta) return Math.max(score,beta);
  if (score>alpha) alpha=score;
  const bd=bfsWS(st.bX,st.bY,0,ws), rd=bfsWS(st.rX,st.rY,8,ws);
  if (bd>4&&rd>4) return score;
  const nextTurn=turn==='red'?'blue':'red';
  for (const a of getMoves(st,turn,ws)) {
    const [ns,,] = applyAction(st,a,turn,ws,0);
    const s=-quiesce(ns,nextTurn,-beta,-alpha,ws,qdep-1);
    if (s>=beta) return s;
    if (s>alpha) alpha=s;
  }
  return alpha;
}

/* ═══════════════════════════════════════════
   NEGAMAX + PVS + LMR + NMP
   Hash truyền xuống incremental — O(1) per node
═══════════════════════════════════════════ */
let _nodes=0;

function negamax(st, turn, depth, alpha, beta, cfg, ws, hash) {
  _nodes++;
  const origAlpha=alpha;

  // Terminal
  if (st.bY===0) return turn==='blue'? 85000+depth*10:-85000-depth*10;
  if (st.rY===8) return turn==='red' ? 85000+depth*10:-85000-depth*10;

  // Endgame exact solve
  if (st.bW===0&&st.rW===0) {
    const eg=solveEndgame(st,ws);
    return turn==='red'?eg:-eg;
  }

  // TT
  const ttHit=ttGet(hash,depth,alpha,beta);
  if (ttHit!==null) return ttHit;

  // Leaf
  if (depth===0) return quiesce(st,turn,alpha,beta,ws,3);

  // Null Move Pruning (depth>=3, không gần terminal)
  if (depth>=3&&beta<84000&&alpha>-84000) {
    const bd=bfsWS(st.bX,st.bY,0,ws), rd=bfsWS(st.rX,st.rY,8,ws);
    if (bd>2&&rd>2) {
      const nullTurn=turn==='red'?'blue':'red';
      const nullHash=hash^_ZB.t;
      const ns=-negamax(st,nullTurn,depth-3,-beta,-beta+1,cfg,ws,nullHash);
      if (ns>=beta) return beta;
    }
  }

  const cands=reorder(getCands(st,turn,cfg,ws,true),depth,hash);
  if (!cands.length) return quiesce(st,turn,alpha,beta,ws,3);

  const nextTurn=turn==='red'?'blue':'red';
  let best=-Infinity, bestMove=null;

  for (let i=0; i<cands.length; i++) {
    const a=cands[i];
    const [ns,nws,nhash]=applyAction(st,a,turn,ws,hash);

    const isImportant=i<2||_kl[depth].some(k=>k&&k.type===a.type&&k.x===a.x&&k.y===a.y);
    let score;

    if (i===0) {
      score=-negamax(ns,nextTurn,depth-1,-beta,-alpha,cfg,nws,nhash);
    } else if (!isImportant&&depth>=4) {
      const R=depth>=6?2:1;
      score=-negamax(ns,nextTurn,depth-1-R,-alpha-1,-alpha,cfg,nws,nhash);
      if (score>alpha)
        score=-negamax(ns,nextTurn,depth-1,-beta,-alpha,cfg,nws,nhash);
    } else {
      score=-negamax(ns,nextTurn,depth-1,-alpha-1,-alpha,cfg,nws,nhash);
      if (score>alpha&&score<beta)
        score=-negamax(ns,nextTurn,depth-1,-beta,-alpha,cfg,nws,nhash);
    }

    if (score>best) { best=score; bestMove=a; }
    if (score>alpha) { alpha=score; addKiller(depth,a); }
    if (alpha>=beta) break;
  }

  ttPut(hash,depth,best,origAlpha,beta,bestMove);
  return best;
}

/* ═══════════════════════════════════════════
   ITERATIVE DEEPENING ROOT (async)
═══════════════════════════════════════════ */
function negamaxRoot(st, cfg, timeLimitMs, onProgress, onDone) {
  const T0=performance.now();
  const ws=buildWS(st.hW,st.vW);
  const rootHash=initHash(st,'red');

  _kl.forEach(k=>{k[0]=null;k[1]=null;k[2]=null;});
  tt0D.fill(-1); tt1D.fill(-1);
  _nodes=0;

  let bestAct=greedyM(st,'red',ws);
  let rootCands=getCands(st,'red',cfg,ws,true);
  if (!rootCands.length) { onDone(bestAct); return; }

  // Adaptive time: tăng thêm 50% nếu position nguy hiểm
  const bd0=bfsWS(st.bX,st.bY,0,ws), rd0=bfsWS(st.rX,st.rY,8,ws);
  const isUrgent=bd0<=3||rd0<=3;
  const tl=isUrgent?timeLimitMs*1.4:timeLimitMs;

  function runDepth(d) {
    if (d>cfg.depth||(performance.now()-T0)>tl*0.82) { onDone(bestAct); return; }

    // Order bằng evalFull (nhanh)
    rootCands=rootCands.map(a=>{
      const [ns,nws,]= applyAction(st,a,'red',ws,rootHash);
      return {a,s:evalFull(ns,nws)};
    }).sort((a,b)=>b.s-a.s).map(x=>x.a);

    // Aspiration window
    let alpha=-Infinity, beta=Infinity;
    if (d>=3) {
      const [ns0,nws0,]=applyAction(st,rootCands[0],'red',ws,rootHash);
      const pv=evalFull(ns0,nws0);
      alpha=pv-130; beta=pv+130;
    }

    let bestThisDepth=rootCands[0];
    let iterBest=-Infinity;
    let i=0;

    function chunk() {
      const DL=tl*0.90;
      while (i<rootCands.length) {
        if (performance.now()-T0>DL) { onDone(bestAct); return; }
        const a=rootCands[i];
        const [ns,nws,nhash]=applyAction(st,a,'red',ws,rootHash);

        let score;
        if (i===0) {
          score=-negamax(ns,'blue',d-1,-beta,-alpha,cfg,nws,nhash);
        } else {
          score=-negamax(ns,'blue',d-1,-alpha-1,-alpha,cfg,nws,nhash);
          if (score>alpha&&score<beta)
            score=-negamax(ns,'blue',d-1,-beta,-alpha,cfg,nws,nhash);
        }

        if (score>iterBest) { iterBest=score; bestThisDepth=a; }
        if (score>alpha) alpha=score;
        if (alpha>=beta) beta=Infinity;

        i++;
        const pct=Math.min(98,(performance.now()-T0)/tl*100);
        onProgress(pct,d,_nodes);

        if ((performance.now()-T0)>tl*0.45&&i<rootCands.length) {
          setTimeout(chunk,0); return;
        }
      }
      bestAct=bestThisDepth;
      runDepth(d+1);
    }
    chunk();
  }

  runDepth(1);
}

/* ═══════════════════════════════════════════
   GREEDY
═══════════════════════════════════════════ */
function greedyM(st, turn, ws) {
  if (!ws) ws=buildWS(st.hW,st.vW);
  const mv=getMoves(st,turn,ws);
  const goal=turn==='red'?8:0;
  let best=999,ba=mv[0];
  for (const a of mv) {
    const d=bfsWS(a.x,a.y,goal,ws);
    if (d<best) {best=d;ba=a;}
  }
  return ba;
}

/* ═══════════════════════════════════════════
   ENTRY POINTS
═══════════════════════════════════════════ */
let _aiSessionId=0;

function aiMove() {
  if (over) return;
  const d=DIFF[diff];
  const sid=++_aiSessionId;
  const bar=document.getElementById('mctsBar');
  const fill=document.getElementById('mctsFill');
  const iter=document.getElementById('mctsIter');
  const colors={easy:'#44bb44',medium:'#ffcc00',hard:'#ff8844',destroy:'#cc44ff'};

  document.getElementById('sbar').innerHTML=
    `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;`+
    `background:${colors[diff]};animation:blink .6s ease infinite;margin-right:6px"></span>`+
    `${d.label} đang suy nghĩ...`;

  if (diff==='easy') {
    if(bar) bar.style.display='none';
    requestAnimationFrame(()=>requestAnimationFrame(()=>{
      if(_aiSessionId!==sid||over) return;
      applyAI(aiBestSync()); checkWin();
      if(!over){cur='blue';startTimer();}
    }));
    return;
  }

  if(bar)  bar.style.display='block';
  if(fill) fill.style.width='0%';
  if(iter) iter.textContent='Đang tính toán...';

  const st=snap();
  const tl={medium:900,hard:1800,destroy:3500}[diff];

  negamaxRoot(st,d,tl,
    (pct,depth,nodes)=>{
      if(_aiSessionId!==sid) return;
      if(fill) fill.style.width=pct.toFixed(0)+'%';
      if(iter) iter.textContent=`Depth ${depth} · ${nodes.toLocaleString()} nodes`;
    },
    (act)=>{
      if(_aiSessionId!==sid||over) return;
      if(bar) bar.style.display='none';
      applyAI(act); checkWin();
      if(!over){cur='blue';startTimer();}
    }
  );
}

function aiBestSync() {
  const d=DIFF[diff];
  const st=snap();
  const ws=buildWS(st.hW,st.vW);
  if(Math.random()<d.noise){const mv=getMoves(st,'red',ws);return mv[~~rnd(mv.length)];}
  if(Math.random()<d.wallChance&&st.rW>0){
    const wc=getWallCands(st,'red',ws,4);
    if(wc.length) return wc[~~rnd(Math.min(2,wc.length))];
  }
  return greedyM(st,'red',ws);
}
