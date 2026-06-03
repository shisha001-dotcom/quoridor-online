/**
 * online.js
 * Multiplayer online qua PeerJS WebRTC:
 * tạo phòng, tham gia phòng, gửi/nhận nước đi, chat.
 */

'use strict';

/* ══════════════════════════════════
   ONLINE STATE
══════════════════════════════════ */
let peer         = null;   // PeerJS instance
let onlineConn   = null;   // DataConnection
let myOnlineRole = null;   // 'blue' (host) | 'red' (guest)
let myRoomCode   = null;
let onlineReady  = false;

/* ══════════════════════════════════
   HELPERS
══════════════════════════════════ */
function genRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c = '';
  for (let i = 0; i < 6; i++) c += chars[Math.floor(Math.random() * chars.length)];
  return c;
}

function setConnStatus(type, text) {
  const el  = document.getElementById('connStatus');
  const dot = document.getElementById('csDot');
  const txt = document.getElementById('csText');
  if (!el) return;
  el.className  = 'conn-status cs-' + type;
  dot.className = 'cs-dot cs-dot-' + type;
  txt.textContent = text;
}

function showRoleTag(elId, role) {
  const el = document.getElementById(elId);
  if (!el) return;
  const isBlue = role === 'blue';
  el.innerHTML = `<span class="online-role ${isBlue ? 'role-blue' : 'role-red'}">
    ${isBlue ? '🔵 Bạn là Blue (đi trước)' : '🔴 Bạn là Red (đi sau)'}
  </span>`;
}

function getRoomLink(code) {
  return location.href.split('?')[0] + '?room=' + code;
}

function copyRoomLink() {
  const link = getRoomLink(myRoomCode);
  navigator.clipboard.writeText(link)
    .then(() => showToast('📋', 'Đã copy!', 'Link phòng đã được copy vào clipboard'))
    .catch(() => showToast('📋', 'Mã phòng: ' + myRoomCode, 'Chia sẻ mã này cho bạn bè'));
}

function destroyPeer() {
  if (onlineConn) { try { onlineConn.close(); } catch (e) {} onlineConn = null; }
  if (peer)       { try { peer.destroy();     } catch (e) {} peer = null; }
  onlineReady = false;
}

/* ══════════════════════════════════
   TẠO PHÒNG (host)
══════════════════════════════════ */
function onlineCreate() {
  document.getElementById('onlineSetup').style.display   = 'none';
  document.getElementById('onlineWaiting').style.display = 'block';
  myRoomCode    = genRoomCode();
  myOnlineRole  = 'blue';

  document.getElementById('displayRoomCode').textContent = myRoomCode;
  const link = getRoomLink(myRoomCode);
  document.getElementById('shareLinkBox').textContent    = link;
  showRoleTag('myRoleTag', 'blue');
  setConnStatus('wait', 'Đang khởi tạo kết nối...');

  destroyPeer();
  peer = new Peer('qr-' + myRoomCode, { debug: 0 });

  peer.on('open', () => {
    setConnStatus('wait', 'Đã sẵn sàng · Chờ đối thủ kết nối...');
    document.getElementById('oppWaitText').style.display = 'block';
  });

  peer.on('connection', conn => {
    onlineConn = conn;
    conn.on('open', () => {
      onlineReady = true;
      setConnStatus('conn', '✅ Đối thủ đã kết nối!');
      document.getElementById('oppWaitText').style.display = 'none';
      ['onlineStartNorm', 'onlineStartPow', 'onlineStartChaos', 'onlineStartFog', 'onlineStartBlind']
        .forEach(id => document.getElementById(id).style.display = 'block');
      showToast('🌐', 'Đối thủ kết nối!', 'Hãy chọn kiểu chơi để bắt đầu!');
      conn.send({ type: 'CONNECTED', role: 'red' });
    });
    conn.on('data',  handleOnlineData);
    conn.on('close', handleDisconnect);
    conn.on('error', () => handleDisconnect());
  });

  peer.on('error', e => setConnStatus('err', '❌ Lỗi kết nối: ' + e.type));
}

/* ══════════════════════════════════
   THAM GIA PHÒNG (guest)
══════════════════════════════════ */
function onlineJoin() {
  const code = document.getElementById('joinCodeInput').value.trim().toUpperCase();
  if (code.length < 4) { showToast('❌', 'Mã không hợp lệ', 'Nhập mã phòng 6 ký tự'); return; }
  myRoomCode   = code;
  myOnlineRole = 'red';

  document.getElementById('onlineSetup').style.display      = 'none';
  document.getElementById('onlineConnecting').style.display = 'block';
  showRoleTag('joiningRoleTag', 'red');
  document.getElementById('joiningText').textContent = 'Đang kết nối tới phòng ' + code + '...';

  destroyPeer();
  peer = new Peer(undefined, { debug: 0 });

  peer.on('open', () => {
    const conn = peer.connect('qr-' + code, { reliable: true });
    onlineConn  = conn;

    conn.on('open', () => {
      onlineReady = true;
      document.getElementById('joiningText').textContent = '✅ Kết nối thành công! Chờ host bắt đầu...';
      showToast('🌐', 'Đã vào phòng!', 'Chờ host chọn kiểu chơi...');
    });
    conn.on('data',  handleOnlineData);
    conn.on('close', handleDisconnect);
    conn.on('error', () => {
      document.getElementById('joiningText').textContent = '❌ Không tìm thấy phòng ' + code;
    });
  });

  peer.on('error', e => {
    document.getElementById('joiningText').textContent = '❌ Lỗi: ' + e.type;
  });
}

/* ══════════════════════════════════
   HOST CHỌN KIỂU CHƠI & BẮT ĐẦU
══════════════════════════════════ */
function launchOnline(type) {
  if (!onlineReady) { showToast('⚠️', 'Chưa kết nối', 'Chờ đối thủ kết nối đã!'); return; }
  onlineConn.send({ type: 'START', gameType: type });
  startOnlineGame(type, 'blue');
}

/* ══════════════════════════════════
   NHẬN DỮ LIỆU TỪ PEER
══════════════════════════════════ */
function handleOnlineData(data) {
  if      (data.type === 'START')     startOnlineGame(data.gameType, 'red');
  else if (data.type === 'MOVE')      applyRemoteMove(data.move);
  else if (data.type === 'CHAT')      receiveChatMsg(data.text);
  // 'CONNECTED' handled by host automatically
}

function handleDisconnect() {
  if (over || gMode !== 'online') return;
  showToast('📡', 'Mất kết nối', 'Đối thủ đã ngắt kết nối');
  over = true; clearInterval(tiv); cancelAnimationFrame(raf);
}

/* ══════════════════════════════════
   KHỞI ĐỘNG GAME ONLINE
══════════════════════════════════ */
function startOnlineGame(type, role) {
  myOnlineRole = role;
  powerMode = (type === 'power');
  chaosMode = (type === 'chaos');
  fogMode   = (type === 'fog');
  blindMode = (type === 'blind');
  gMode     = 'online';

  document.querySelectorAll('.scr').forEach(s => s.classList.remove('on'));
  document.getElementById('game').style.display = 'block';

  canvas = document.getElementById('board');
  ctx    = canvas.getContext('2d');
  canvas.onclick      = onClick;
  canvas.onmousemove  = onMouseMove;
  canvas.onmouseleave = () => { ghostWall = { x: -1, y: -1 }; };

  const modeLabel = powerMode ? '⚡ Power-up' : chaosMode ? '🌪️ Chaos' : fogMode ? '👻 Fog' : blindMode ? '🌫️ Cờ mù' : '⚖️ Normal';
  document.getElementById('mbadge').innerHTML =
    `<span class="mbadge mb-n" style="color:#66ddff;border-color:rgba(0,170,255,.4)">🌐 ${modeLabel}</span>`;
  document.getElementById('puBar').style.display   = powerMode ? 'block' : 'none';
  document.getElementById('mctsBar').style.display = 'none';

  // Bật chat
  document.getElementById('chatToggleBtn').style.display = 'block';
  document.getElementById('chatBox').classList.add('on');
  document.getElementById('chatMessages').innerHTML =
    '<div class="chat-msg sys">💬 Phòng #' + myRoomCode + ' — Chúc chơi vui!</div>';

  initGame();

  const roleMsg = role === 'blue' ? '🔵 Bạn là Blue · Đi trước' : '🔴 Bạn là Red · Đi sau';
  showToast('🌐', 'Bắt đầu Online!', roleMsg);
}

/* ══════════════════════════════════
   HỦY KẾT NỐI
══════════════════════════════════ */
function cancelOnline() {
  destroyPeer();
  document.getElementById('onlineSetup').style.display      = 'block';
  document.getElementById('onlineWaiting').style.display    = 'none';
  document.getElementById('onlineConnecting').style.display = 'none';
  ['onlineStartNorm', 'onlineStartPow', 'onlineStartChaos', 'onlineStartFog', 'onlineStartBlind']
    .forEach(id => document.getElementById(id).style.display = 'none');
  onlineReady = false;
  nav('s0');
}

/* ══════════════════════════════════
   GỬI / NHẬN NƯỚC ĐI
══════════════════════════════════ */
function sendOnlineMove(move) {
  if (gMode !== 'online' || !onlineConn || !onlineConn.open) return;
  onlineConn.send({ type: 'MOVE', move });
}

function applyRemoteMove(move) {
  if (over) return;

  if (move.action === 'move') {
    players[move.who].x = move.x;
    players[move.who].y = move.y;
    checkGiftPickup(move.who);
    checkWin();
    // Không advance turn — chờ endturn signal
  }
  else if (move.action === 'wall') {
    if (move.dir === 'H') hW.push({ x: move.x, y: move.y });
    else                   vW.push({ x: move.x, y: move.y });
    players[move.who].walls--;
  }
  else if (move.action === 'endturn') {
    nextTurnOnline();
  }
  else if (move.action === 'undo') {
    // Đối thủ undo — khôi phục state họ gửi về
    const s = move.state;
    players  = JSON.parse(JSON.stringify(s.players));
    hW       = s.hW.slice();
    vW       = s.vW.slice();
    shields  = JSON.parse(JSON.stringify(s.shields));
    frozen   = JSON.parse(JSON.stringify(s.frozen));
    playerPU = JSON.parse(JSON.stringify(s.playerPU));
    gift     = { ...s.gift };
    teleMode = s.teleMode;
    dblMove  = s.dblMove;
    cur      = s.cur;
    acted    = false;
    hist     = null;
    updPUBar(); updPanels();
    showToast('↩', 'Đối thủ hoàn tác', 'Nước đi vừa rồi đã bị hủy');
  }
}

function nextTurnOnline() {
  acted = false; dblMove = false; teleMode = false;
  ghostWall = { x: -1, y: -1 };
  hist = null;
  turnN++;
  cur = opp(cur);
  if (powerMode) updPUBar();
  startTimer(); updPanels();
}

/* ══════════════════════════════════
   AUTO-JOIN TỪ URL PARAM
══════════════════════════════════ */
(function autoJoinFromURL() {
  const params = new URLSearchParams(location.search);
  const room   = params.get('room');
  if (room) {
    setTimeout(() => {
      nav('s3');
      document.getElementById('joinCodeInput').value = room.toUpperCase();
      onlineJoin();
    }, 600);
  }
})();

/* ══════════════════════════════════
   IN-GAME CHAT
══════════════════════════════════ */
let chatBodyVisible  = true;
let chatUnreadCount  = 0;

function toggleChat() {
  const box = document.getElementById('chatBox');
  box.classList.toggle('on');
  if (box.classList.contains('on')) {
    clearChatUnread();
    const msgs = document.getElementById('chatMessages');
    msgs.scrollTop = msgs.scrollHeight;
  }
  document.getElementById('chatToggleBtn').classList.remove('has-msg');
}

function toggleChatBody() {
  chatBodyVisible = !chatBodyVisible;
  document.getElementById('chatBody').style.display  = chatBodyVisible ? 'flex' : 'none';
  document.getElementById('chatBodyToggle').textContent = chatBodyVisible ? '▾' : '▸';
}

function clearChatUnread() {
  chatUnreadCount = 0;
  const u = document.getElementById('chatUnread');
  if (u) u.style.display = 'none';
}

function addChatMessage(text, type) {
  const msgs = document.getElementById('chatMessages');
  const div  = document.createElement('div');
  div.className   = 'chat-msg ' + type;
  div.textContent = text;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;

  const box = document.getElementById('chatBox');
  if (type === 'opp' && (!box.classList.contains('on') || !chatBodyVisible)) {
    chatUnreadCount++;
    const u = document.getElementById('chatUnread');
    if (u) { u.style.display = 'inline'; u.textContent = chatUnreadCount; }
    const btn = document.getElementById('chatToggleBtn');
    if (btn) btn.classList.add('has-msg');
  }
}

function sendChatMsg(preset) {
  let text = preset || document.getElementById('chatInput').value.trim();
  if (!text) return;
  if (!preset) document.getElementById('chatInput').value = '';
  addChatMessage('Tôi: ' + text, 'me');
  if (onlineConn && onlineConn.open) onlineConn.send({ type: 'CHAT', text });
}

function receiveChatMsg(text) {
  addChatMessage('Đối thủ: ' + text, 'opp');
}
