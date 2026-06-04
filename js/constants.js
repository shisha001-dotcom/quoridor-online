/**
 * constants.js
 * Hằng số toàn cục, cấu hình độ khó, và định nghĩa Power-up.
 */

'use strict';

/* ═══════════════════════════════
   BOARD CONSTANTS
═══════════════════════════════ */
const N = 9;   // số ô mỗi chiều
const C = 60;  // kích thước ô (px)

/* ═══════════════════════════════
   DIFFICULTY CONFIG
   wallChance : xác suất xét đặt tường mỗi lượt
   wallR      : bán kính path-based wall search
   noise      : xác suất đi ngẫu nhiên (easy only)
   depth      : max iterative deepening depth (negamax)
   time limit : medium=300ms, hard=700ms, destroy=1400ms (trong ai.js)
═══════════════════════════════ */
const DIFF = {
  easy:    { label: '🌿 Dễ',         wallChance: .20, wallR: 2, noise: .50, depth: 1 },
  medium:  { label: '⚔️ Trung Bình',  wallChance: 1.0, wallR: 3, noise: .00, depth: 4 },
  hard:    { label: '🔥 Khó',         wallChance: 1.0, wallR: 4, noise: .00, depth: 6 },
  destroy: { label: '💀 Hủy Diệt',   wallChance: 1.0, wallR: 5, noise: .00, depth: 8 }
};

/* ═══════════════════════════════
   POWER-UP DEFINITIONS
═══════════════════════════════ */
const PU_DEFS = {
  double: {
    ico: '⚡', name: 'Double Move', cls: 'pc-double',
    desc: 'Di chuyển 2 lần liên tiếp trong lượt này',
    use(who) {
      dblMove = true;
      acted = false;
      showToast('⚡', 'Double Move', 'Di chuyển thêm 1 bước nữa!');
      setMode('move');
      updPanels();
    }
  },
  steal: {
    ico: '🎭', name: 'Wall Steal', cls: 'pc-steal',
    desc: 'Lấy 1 tường từ đối thủ về tay mình',
    use(who) {
      const o = opp(who);
      if (players[o].walls > 0) { players[o].walls--; players[who].walls++; }
      showToast('🎭', 'Wall Steal', 'Lấy 1 tường từ đối thủ!');
      acted = true;
    }
  },
  tele: {
    ico: '🌀', name: 'Teleport', cls: 'pc-tele',
    desc: 'Nhảy tới bất kỳ ô nào trên bàn cờ',
    use(who) {
      teleMode = true;
      showToast('🌀', 'Teleport', 'Click bất kỳ ô nào để nhảy tới!');
      updPanels();
    }
  },
  shield: {
    ico: '🛡️', name: 'Shield', cls: 'pc-shield',
    desc: 'Chặn tường tiếp theo đối thủ cố đặt vào đường bạn',
    use(who) {
      shields[who] = true;
      showToast('🛡️', 'Shield', 'Tường tiếp theo của đối thủ sẽ bị chặn!');
      acted = true;
    }
  },
  bomb: {
    ico: '💣', name: 'Wall Bomb', cls: 'pc-bomb',
    desc: 'Phá huỷ 1 tường ngẫu nhiên trên bàn cờ',
    use(who) {
      const all = [...hW.map(w => ({ ...w, t: 'H' })), ...vW.map(w => ({ ...w, t: 'V' }))];
      if (all.length) {
        const w = all[~~rnd(all.length)];
        if (w.t === 'H') hW = hW.filter(h => !(h.x === w.x && h.y === w.y));
        else vW = vW.filter(v => !(v.x === w.x && v.y === w.y));
      }
      showToast('💣', 'Wall Bomb', 'Một bức tường đã bị phá!');
      acted = true;
    }
  },
  swap: {
    ico: '🔄', name: 'Position Swap', cls: 'pc-swap',
    desc: 'Hoán đổi vị trí với đối thủ ngay lập tức',
    use(who) {
      const o = opp(who);
      const tmp = { x: players[who].x, y: players[who].y };
      players[who].x = players[o].x; players[who].y = players[o].y;
      players[o].x = tmp.x; players[o].y = tmp.y;
      showToast('🔄', 'Position Swap', 'Vị trí hai người đã đổi!');
      acted = true; checkWin();
    }
  },
  freeze: {
    ico: '❄️', name: 'Freeze', cls: 'pc-freeze',
    desc: 'Đối thủ bị đóng băng, bỏ lượt tiếp theo',
    use(who) {
      frozen[opp(who)] = 1;
      showToast('❄️', 'Freeze', 'Đối thủ bị đóng băng 1 lượt!');
      acted = true;
    }
  }
};

const PU_IDS = Object.keys(PU_DEFS);

/* ═══════════════════════════════
   CHAOS EVENTS CONFIG
═══════════════════════════════ */
const CHAOS_EVENTS = [
  { id: 'rotate',   label: '🌀 BÀN CỜ XOAY 90°!',             cls: 'cb-rotate', fn: () => doChaosRotate()   },
  { id: 'wallswap', label: '🔄 ĐẢO TẤT CẢ TƯỜNG!',             cls: 'cb-swap',   fn: () => doChaosWallSwap() },
  { id: 'fog',      label: '🌫️ SƯƠNG MÙ BÍ ẨN!',               cls: 'cb-fog',    fn: () => doChaosFog()      },
  { id: 'storm',    label: '⚡ BÃO TƯỜNG — 1 TƯỜNG BỊ PHÁ!',  cls: 'cb-storm',  fn: () => doChaosStorm()    },
];
