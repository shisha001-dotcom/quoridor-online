/**
 * state.js
 * Toàn bộ biến trạng thái của game.
 * Không chứa logic — chỉ khai báo và export state.
 */

'use strict';

/* ═══════════════════════════════
   SESSION CONFIG (chọn từ menu)
═══════════════════════════════ */
let gMode      = '2p';    // 'ai' | '2p' | 'online'
let diff       = 'easy';  // 'easy' | 'medium' | 'hard' | 'destroy'
let powerMode  = false;
let chaosMode  = false;
let fogMode    = false;
let blindMode  = false;

/* ═══════════════════════════════
   CORE GAME STATE
═══════════════════════════════ */
let players;   // { blue: {x,y,walls}, red: {x,y,walls} }
let cur;       // 'blue' | 'red' — lượt hiện tại
let mode;      // 'move' | 'H' | 'V'
let hW;        // horizontal walls  [ {x,y}, ... ]
let vW;        // vertical walls    [ {x,y}, ... ]
let acted;     // boolean — người chơi đã thực hiện action chưa
let over;      // boolean — ván đã kết thúc
let hist;      // snapshot để undo
let tLeft = 60;
let tiv;       // timer interval
let raf;       // requestAnimationFrame id
let gPh = 0;   // animation phase
let turnN = 0; // số lượt đã đi

/* ═══════════════════════════════
   POWER-UP STATE
═══════════════════════════════ */
let gift        = { x: 0, y: 0, active: false };
let playerPU    = { blue: null, red: null };
let teleMode    = false;
let dblMove     = false;
let shields     = { blue: false, red: false };
let frozen      = { blue: 0, red: 0 };

/* ═══════════════════════════════
   UI INTERACTION STATE
═══════════════════════════════ */
let ghostWall   = { x: -1, y: -1 }; // hover preview
let canvas, ctx;

/* ═══════════════════════════════
   CHAOS STATE
═══════════════════════════════ */
let chaosCounter    = 0;
let lastChaosEvent  = '';
let chaosHideUntil  = -1;

/* ═══════════════════════════════
   BLIND MODE STATE
═══════════════════════════════ */
let blindCounter    = 0;
let blindHideUntil  = -1;

/* ═══════════════════════════════
   FOG OF WAR STATE
═══════════════════════════════ */
const FOG_RADIUS = 3;
let fogRevealedWalls = { h: new Set(), v: new Set() };

/* ═══════════════════════════════
   MOVE HISTORY (replay)
═══════════════════════════════ */
let moveHistory = [];
let rpIdx       = 0;
