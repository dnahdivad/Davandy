// DAVANDY client
(() => {
'use strict';
const $ = s => document.querySelector(s);
const SIZE = 15, CENTER = 7;

// ---------------- local state ----------------
let ws, S = null, seat = -1, gameId = null;
let pending = new Map();          // "r,c" -> {id, letter}
let selected = null;              // rack tile id
let swapMode = false, swapSel = new Set();
let cursor = null;                // {r, c, dir:'a'|'d'}
let rackOrder = [];
let reqNo = 0, lastPreview = null;
let endShown = false, lastTurnSeen = null, lastLogLen = 0;
let muted = localStorage.getItem('davandy:mute') === '1';
const opts = { mode: 'duel', headStart: 0, headStartSeat: 1, timer: 0, difficulty: 'squall' };

// ---------------- sound ----------------
let actx;
function beep(notes) {
  if (muted) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    let t = actx.currentTime;
    for (const [f, d] of notes) {
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = 'square'; o.frequency.value = f;
      g.gain.setValueAtTime(0.05, t); g.gain.exponentialRampToValueAtTime(0.001, t + d);
      o.connect(g); g.connect(actx.destination); o.start(t); o.stop(t + d);
      t += d * 0.8;
    }
  } catch {}
}
const SFX = {
  place: () => beep([[660, .05]]),
  back: () => beep([[330, .05]]),
  play: () => beep([[523, .08], [659, .08], [784, .12]]),
  light: () => beep([[784, .1], [988, .1], [1175, .1], [1568, .25]]),
  turn: () => beep([[440, .08], [880, .12]]),
  bad: () => beep([[160, .15]]),
  win: () => beep([[523, .12], [659, .12], [784, .12], [1047, .4]]),
};

// ---------------- sea backdrop ----------------
(function sea() {
  const c = $('#sea'), x = c.getContext('2d');
  const W = 160, H = 100; c.width = W; c.height = H;
  const stars = Array.from({ length: 40 }, () => [Math.random() * W | 0, Math.random() * H * 0.45 | 0, Math.random()]);
  let t = 0;
  function frame() {
    t++;
    x.fillStyle = '#0b1622'; x.fillRect(0, 0, W, H);
    for (const [sx, sy, p] of stars) { x.fillStyle = (Math.sin(t / 8 + p * 20) > 0.6) ? '#cfe3ea' : '#3b5566'; x.fillRect(sx, sy, 1, 1); }
    // moon
    x.fillStyle = '#e9e1c0'; x.fillRect(130, 10, 6, 6); x.fillRect(129, 11, 8, 4); x.fillStyle = '#0b1622'; x.fillRect(133, 10, 4, 4);
    // lighthouse on the horizon
    const hz = 58;
    x.fillStyle = '#1d2c38'; x.fillRect(18, hz - 14, 4, 14); x.fillRect(17, hz - 16, 6, 2);
    if ((t >> 4) % 2) { x.fillStyle = '#ffcf4a'; x.fillRect(19, hz - 17, 2, 2); x.fillStyle = 'rgba(255,207,74,.12)'; x.beginPath(); x.moveTo(20, hz - 16); x.lineTo(70, hz - 26); x.lineTo(70, hz - 8); x.fill(); }
    // sea bands
    for (let y = hz; y < H; y++) {
      const d = (y - hz) / (H - hz);
      x.fillStyle = `rgb(${12 + d * 8 | 0},${30 + d * 20 | 0},${44 + d * 26 | 0})`; x.fillRect(0, y, W, 1);
      if (y % 3 === 0) for (let i = 0; i < W; i += 7 + (y % 5)) {
        const ph = Math.sin((i + t * (0.3 + d)) / 6 + y);
        if (ph > 0.75) { x.fillStyle = d < .3 ? '#2b4f63' : '#3d6a80'; x.fillRect((i + (t * (0.2 + d) | 0)) % W, y, 2 + (d * 3 | 0), 1); }
      }
    }
    setTimeout(() => requestAnimationFrame(frame), 120);
  }
  frame();
})();

// ---------------- socket ----------------
function connect() {
  ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
  ws.onopen = () => { if (gameId) joinGame(gameId); };
  ws.onclose = () => { setTimeout(connect, 1500); };
  ws.onmessage = e => onMsg(JSON.parse(e.data));
}
function send(m) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); }
function joinGame(id, name) {
  send({ type: 'join', id, token: localStorage.getItem('davandy:' + id), name });
}

function onMsg(m) {
  if (m.type === 'error') { toast(m.error, true); SFX.bad(); if (!$('#lobby').hidden) { gameId = null; history.replaceState(null, '', '/'); } return; }
  if (m.type === 'needName') { showJoin(m); return; }
  if (m.type === 'joined') {
    gameId = m.id; seat = m.seat;
    if (m.token) localStorage.setItem('davandy:' + m.id, m.token);
    history.replaceState(null, '', '?g=' + m.id);
    $('#lobby').hidden = true; $('#game').hidden = false;
    return;
  }
  if (m.type === 'goto') { resetLocal(); gameId = m.id; history.replaceState(null, '', '?g=' + m.id); joinGame(m.id); return; }
  if (m.type === 'preview') { if (m.req === reqNo) { lastPreview = m.preview; renderPreview(); } return; }
  if (m.type === 'state') {
    const prev = S; S = m.state; seat = S.you; S._skew = Date.now() - S.now;
    onState(prev, m.event);
  }
}

function resetLocal() { pending.clear(); selected = null; swapMode = false; swapSel.clear(); cursor = null; endShown = false; lastPreview = null; S = null; lastLogLen = 0; }

// ---------------- lobby ----------------
$('#name').value = localStorage.getItem('davandy:name') || '';
document.querySelectorAll('.mode').forEach(b => b.onclick = () => {
  document.querySelectorAll('.mode').forEach(x => x.classList.toggle('on', x === b));
  opts.mode = b.dataset.mode;
  $('#duelOpts').hidden = opts.mode !== 'duel'; $('#lhOpts').hidden = opts.mode !== 'lighthouse';
});
document.querySelectorAll('.seg').forEach(seg => seg.querySelectorAll('button').forEach(b => b.onclick = () => {
  seg.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
  const k = seg.dataset.key, v = b.dataset.v;
  opts[k] = isNaN(+v) ? v : +v;
  $('#hsWho').hidden = !opts.headStart;
  lhHint();
}));
const LH = { calm: [24, '3 3 4 4 5'], squall: [22, '3 4 4 5 5 6'], storm: [20, '4 4 5 5 6 6'] };
function lhHint() { const [t, r] = LH[opts.difficulty]; $('#lhHint').textContent = `${r.split(' ').length} lanterns (needing words of ${r.replaceAll(' ', ', ')} letters) in ${t} shared turns.`; }
lhHint();
function myName(el) { const n = el.value.trim(); if (!n) { el.focus(); toast('Enter your name', true); return null; } localStorage.setItem('davandy:name', n); return n; }
$('#createGo').onclick = () => { const name = myName($('#name')); if (name) send({ type: 'create', name, ...opts }); };
$('#codeGo').onclick = () => { const c = $('#code').value.trim().toUpperCase(); if (c.length === 4) { gameId = c; joinGame(c); } };
$('#code').onkeydown = e => { if (e.key === 'Enter') $('#codeGo').click(); };
function showJoin(m) {
  gameId = m.id;
  $('#createPanel').hidden = true; $('#joinPanel').hidden = false;
  $('#joinCode').textContent = m.id;
  $('#joinBlurb').textContent = `${m.host} has started a ${m.mode === 'duel' ? 'DUEL' : 'LIGHTHOUSE game'} and is waiting for you.`;
  $('#joinName').value = localStorage.getItem('davandy:name') || '';
  $('#joinName').focus();
}
$('#joinGo').onclick = () => { const name = myName($('#joinName')); if (name) joinGame(gameId, name); };
$('#joinName').onkeydown = e => { if (e.key === 'Enter') $('#joinGo').click(); };
$('#rulesBtn').onclick = $('#helpBtn').onclick = () => { $('#rulesModal').hidden = false; };
$('#rulesModal').onclick = e => { if (e.target.id === 'rulesModal') $('#rulesModal').hidden = true; };

// ---------------- helpers ----------------
const myTurn = () => S && S.status === 'playing' && S.turn === seat;
const me = () => S && S.players[seat];
const rack = () => (me() && me().rack) || [];
const usedIds = () => new Set([...pending.values()].map(p => p.id));
function tileEl(t, cls = '') {
  const d = document.createElement('div');
  d.className = 'tile ' + cls + (t.blank ? ' blank' : '');
  d.innerHTML = (t.l || '') + (t.blank || !t.l ? '' : `<span class="v">${t.v}</span>`);
  return d;
}
function toast(text, bad) {
  const d = document.createElement('div'); d.className = 'toast'; d.textContent = text;
  if (bad) d.style.color = '#ff7a66';
  document.body.appendChild(d); setTimeout(() => d.remove(), 1700);
}
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// ---------------- state arrives ----------------
function onState(prev, ev) {
  // keep local rack order stable
  const ids = rack().map(t => t.id);
  rackOrder = rackOrder.filter(id => ids.includes(id)).concat(ids.filter(id => !rackOrder.includes(id)));
  // drop pending tiles that are no longer valid
  for (const [k, p] of pending) { const [r, c] = k.split(',').map(Number); if (!ids.includes(p.id) || S.board[r][c]) pending.delete(k); }
  if (!myTurn()) { swapMode = false; swapSel.clear(); }
  if (selected && !ids.includes(selected)) selected = null;

  if (ev && ev.kind === 'play') { ev.lights ? SFX.light() : SFX.play(); if (ev.lights) toast(ev.lights > 1 ? `${ev.lights} LANTERNS LIT!` : 'LANTERN LIT!'); }
  if (S.status === 'playing' && S.turn === seat && lastTurnSeen !== S.turnNo && prev && prev.turn !== seat) { SFX.turn(); }
  lastTurnSeen = S.turnNo;
  document.title = (myTurn() ? '● ' : '') + 'DAVANDY' + (S ? ' · ' + S.id : '');

  render();
  if (pending.size) requestPreview(); else { lastPreview = null; renderPreview(); }
  if (S.status === 'over' && !endShown) { endShown = true; setTimeout(showEnd, 700); }
}

// ---------------- rendering ----------------
function render() {
  if (!S) return;
  $('#waiting').hidden = S.status !== 'waiting';
  if (S.status === 'waiting') {
    const link = location.origin + '/?g=' + S.id;
    $('#shareLink').value = link; $('#bigCode').textContent = S.id;
  }
  renderBar(); renderBoard(); renderRack(); renderPartner(); renderLog(); renderLanterns(); renderButtons();
}

function renderBar() {
  for (let i = 0; i < 2; i++) {
    const el = $('#p' + i), p = S.players[i];
    el.className = `who p${i}${i ? ' right' : ''}${S.status === 'playing' && S.turn === i ? ' active' : ''}`;
    if (!p) { el.innerHTML = `<span class="nm">waiting…</span><span class="sc">–</span><span class="sub"></span>`; continue; }
    const online = S.online && S.online[i];
    const youTag = '';
    const sub = S.mode === 'duel' && S.tide[i] && S.status === 'playing' ? `<span class="tide">TIDE ×${S.swell[i]}${i === seat ? ' · YOURS' : ''}</span>` : `${i === seat ? 'you · ' : ''}${p.rackCount} tiles`;
    el.innerHTML = `<span class="nm">${i ? '' : `<i class="dot ${online ? 'on' : ''}"></i>`}${esc(p.name)}${youTag}${i ? `<i class="dot ${online ? 'on' : ''}"></i>` : ''}</span><span class="sc">${S.mode === 'duel' ? p.score : p.score + ' pts'}</span><span class="sub">${sub}</span>`;
  }
  let st = '';
  if (S.status === 'waiting') st = 'WAITING…';
  else if (S.status === 'over') st = S.mode === 'duel' ? (S.winner === 'draw' ? 'A DRAW' : `${esc(S.players[S.winner].name).toUpperCase()} WINS`) : (S.winner === 'team' ? 'THE COAST IS LIT!' : 'DARKNESS FALLS');
  else st = myTurn() ? 'YOUR TURN' : `${esc(S.players[S.turn].name).toUpperCase()}'S TURN`;
  $('#status').innerHTML = st;
  $('#bag').textContent = `bag ${S.bagCount}`;
  if (S.mode === 'lighthouse' && S.turnsLeft != null) $('#bag').textContent += ` · ${S.turnsLeft} turns left`;
}

function renderBoard() {
  const b = $('#board');
  if (!b.children.length) {
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
      const d = document.createElement('div'); d.className = 'sq'; d.dataset.r = r; d.dataset.c = c;
      d.onclick = () => clickSquare(r, c); b.appendChild(d);
    }
  }
  const shells = new Set(S.shells.map(([r, c]) => r + ',' + c));
  const lan = new Map(S.lanterns.map(l => [l.r + ',' + l.c, l]));
  const last = new Set((S.lastMove || []).map(([r, c]) => r + ',' + c));
  const bad = lastPreview && !lastPreview.ok;
  for (const d of b.children) {
    const r = +d.dataset.r, c = +d.dataset.c, k = r + ',' + c;
    const L = lan.get(k);
    let cls = 'sq';
    if (r === CENTER && c === CENTER) cls += ' star';
    else if (L) cls += ' lantern' + (L.lit ? ' lit' : '');
    else if (shells.has(k)) cls += ' shell';
    if (cursor && cursor.r === r && cursor.c === c && !S.board[r][c] && !pending.has(k)) cls += ' cursor' + (cursor.dir === 'd' ? ' down' : '');
    const t = S.board[r][c], p = pending.get(k);
    const sig = cls + '|' + (t ? t.l + t.by + last.has(k) : '') + '|' + (p ? p.id + p.letter + bad : '') + '|' + (L ? L.lit : '');
    if (d._sig === sig) continue;
    const wasEmpty = !d.querySelector('.tile');
    d._sig = sig; d.className = cls; d.innerHTML = '';
    if (t) {
      const e = tileEl(t, `by${t.by}${last.has(k) ? ' last' : ''}${wasEmpty ? ' drop' : ''}`); d.appendChild(e);
      if (L) d.insertAdjacentHTML('beforeend', `<span class="req">${L.req}</span>`);
    } else if (p) {
      const rt = rack().find(x => x.id === p.id) || { l: p.letter, v: 0 };
      d.appendChild(tileEl({ ...rt, l: rt.blank ? p.letter : rt.l }, 'pending' + (bad ? ' bad' : '')));
      if (L) d.insertAdjacentHTML('beforeend', `<span class="req">${L.req}</span>`);
    } else if (L) d.insertAdjacentHTML('beforeend', `<span class="req">${L.req}</span>`);
  }
}

function renderRack() {
  const el = $('#rack'); el.innerHTML = '';
  if (seat < 0 || !me()) return;
  const used = usedIds();
  for (const id of rackOrder) {
    const t = rack().find(x => x.id === id); if (!t) continue;
    const d = tileEl(t, (used.has(id) ? 'used ' : '') + (selected === id ? 'sel ' : '') + (swapSel.has(id) ? 'swap' : ''));
    if (t.blank) d.innerHTML = '<span style="opacity:.4">?</span>';
    d.onclick = () => clickRack(id);
    el.appendChild(d);
  }
}

function renderPartner() {
  const el = $('#partner');
  const other = S.players[1 - seat];
  if (S.mode !== 'lighthouse' || seat < 0 || !other || !other.rack) { el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML = `${esc(other.name)}'s tiles<div class="tiles"></div>`;
  for (const t of other.rack) { const d = tileEl(t); if (t.blank) d.innerHTML = '<span style="opacity:.4">?</span>'; el.querySelector('.tiles').appendChild(d); }
}

function renderLanterns() {
  const el = $('#lanternList');
  if (S.mode !== 'lighthouse') { el.innerHTML = ''; return; }
  el.innerHTML = S.lanterns.slice().sort((a, b) => a.req - b.req).map(l => `<span class="${l.lit ? 'lit' : ''}" title="${l.word || ''}">${l.lit ? '★' : '◇'}${l.req}</span>`).join('');
}

function renderLog() {
  const el = $('#log');
  const items = [...S.log.map(x => ({ ...x, isLog: true })), ...S.chat.map(x => ({ ...x }))].sort((a, b) => a.t - b.t);
  const n = items.length + ':' + (items.length && items[items.length - 1].t);
  if (el._n === n) return; el._n = n;
  el.innerHTML = items.map(x => x.isLog
    ? `<div class="k-${x.kind || ''}">${esc(x.text)}</div>`
    : `<div><b class="c${x.seat}">${esc(S.players[x.seat] ? S.players[x.seat].name : '?')}:</b> ${esc(x.text)}</div>`).join('');
  el.scrollTop = el.scrollHeight;
  if (S.chat.length > lastLogLen && lastLogLen && S.chat[S.chat.length - 1].seat !== seat) beep([[990, .04], [1320, .05]]);
  lastLogLen = S.chat.length;
}

function renderButtons() {
  const mine = myTurn();
  $('#playBtn').disabled = !mine || !pending.size || (lastPreview && !lastPreview.ok);
  $('#recallBtn').disabled = !pending.size;
  $('#passBtn').disabled = !mine;
  const freeRinse = S.tideRinseLeft > 0 && mine;
  $('#swapBtn').disabled = !mine;
  $('#swapBtn').textContent = swapMode ? (swapSel.size ? `SWAP ${swapSel.size}${freeRinse && swapSel.size <= S.tideRinseLeft ? ' FREE' : ''}` : 'CANCEL') : (freeRinse ? `RINSE ×${S.tideRinseLeft}` : 'SWAP');
  $('#swapBtn').classList.toggle('on', swapMode);
  $('#giveBtn').hidden = S.mode !== 'lighthouse';
  $('#giveBtn').disabled = !mine || !S.canGive || !selected;
  $('#muteBtn').textContent = muted ? '×' : '♪';
  $('#chatForm').hidden = seat < 0;
}

function renderPreview() {
  const el = $('#preview');
  if (!S || !pending.size || !lastPreview) {
    if (S && S.status === 'playing' && myTurn() && !pending.size) el.innerHTML = cursor ? '<span class="bd">type to place tiles · Enter to play</span>' : '<span class="bd">tap a tile, then a square, or tap a square and type</span>';
    else el.innerHTML = '&nbsp;';
    renderButtons(); return;
  }
  const p = lastPreview;
  if (!p.ok) el.innerHTML = `<span class="bad">${esc(p.error || 'Not valid')}</span>`;
  else {
    let s = `<span class="ok">${esc(p.main)} · ${p.score}</span>`;
    const b = p.breakdown, bits = [`letters ${b.letters}`];
    if (b.lengthBonus) bits.push(`length +${b.lengthBonus}`);
    if (b.shells) bits.push(`shells +${b.shells}`);
    if (b.fullRack) bits.push(`all tiles +${b.fullRack}`);
    if (b.swellBonus) bits.push(`tide ×${b.swell} +${b.swellBonus}`);
    s += ` <span class="bd">(${bits.join(', ')})</span>`;
    if (p.lights && p.lights.length) s += ` <span class="ok">★ lights ${p.lights.length}</span>`;
    if (p.crowds) s += ` <span class="bad">⚠ crowds ${p.crowds > 1 ? p.crowds + ' lanterns' : 'a lantern'}</span>`;
    el.innerHTML = s;
  }
  renderBoard(); renderButtons();
}

let pvTimer;
function requestPreview() {
  clearTimeout(pvTimer);
  if (!pending.size) { lastPreview = null; renderPreview(); return; }
  pvTimer = setTimeout(() => send({ type: 'preview', req: ++reqNo, placements: placements() }), 60);
}
function placements() { return [...pending].map(([k, p]) => { const [r, c] = k.split(',').map(Number); return { id: p.id, r, c, letter: p.letter }; }); }

// ---------------- interaction ----------------
function clickRack(id) {
  if (!myTurn() && S.mode !== 'lighthouse') { selected = selected === id ? null : id; renderRack(); return; }
  if (usedIds().has(id)) return;
  if (swapMode) { swapSel.has(id) ? swapSel.delete(id) : swapSel.add(id); renderRack(); renderButtons(); return; }
  if (selected && selected !== id) { // tap two rack tiles to swap their places
    const a = rackOrder.indexOf(selected), b = rackOrder.indexOf(id);
    [rackOrder[a], rackOrder[b]] = [rackOrder[b], rackOrder[a]]; selected = null;
  } else selected = selected === id ? null : id;
  renderRack(); renderButtons();
}

function clickSquare(r, c) {
  if (!S || S.status !== 'playing' || seat < 0) return;
  const k = r + ',' + c;
  if (pending.has(k)) { pending.delete(k); SFX.back(); cursor = { r, c, dir: cursor ? cursor.dir : 'a' }; afterChange(); return; }
  if (S.board[r][c]) return;
  if (!myTurn()) return;
  if (selected) { placeTile(selected, r, c); selected = null; return; }
  // set / flip typing cursor
  if (cursor && cursor.r === r && cursor.c === c) cursor.dir = cursor.dir === 'a' ? 'd' : 'a';
  else cursor = { r, c, dir: guessDir(r, c) };
  renderBoard(); renderPreview();
}
function guessDir(r, c) {
  const occ = (r, c) => r >= 0 && c >= 0 && r < SIZE && c < SIZE && (S.board[r][c] || pending.has(r + ',' + c));
  if ((occ(r - 1, c) || occ(r + 1, c)) && !(occ(r, c - 1) || occ(r, c + 1))) return 'd';
  return 'a';
}

function placeTile(id, r, c, letter) {
  const t = rack().find(x => x.id === id); if (!t) return;
  if (t.blank && !letter) { askBlank(l => placeTile(id, r, c, l)); return; }
  pending.set(r + ',' + c, { id, letter: t.blank ? letter : t.l });
  SFX.place();
  afterChange();
}
function afterChange() { renderRack(); renderBoard(); renderButtons(); requestPreview(); }

function advanceCursor() {
  if (!cursor) return;
  let { r, c } = cursor;
  do { if (cursor.dir === 'a') c++; else r++; } while (r < SIZE && c < SIZE && (S.board[r][c] || pending.has(r + ',' + c)));
  cursor = r < SIZE && c < SIZE ? { r, c, dir: cursor.dir } : null;
}

document.addEventListener('keydown', e => {
  if (!S || $('#game').hidden || document.activeElement.tagName === 'INPUT') return;
  if (!$('#blankModal').hidden) { if (/^[a-z]$/i.test(e.key)) blankPick(e.key.toUpperCase()); if (e.key === 'Escape') blankPick(null); return; }
  if (e.key === 'Enter') { e.preventDefault(); $('#playBtn').click(); return; }
  if (e.key === 'Escape') { $('#recallBtn').click(); return; }
  if (!myTurn()) return;
  if (e.key === 'Backspace') {
    e.preventDefault();
    const keys = [...pending.keys()]; const k = keys[keys.length - 1];
    if (k) { pending.delete(k); const [r, c] = k.split(',').map(Number); cursor = { r, c, dir: cursor ? cursor.dir : 'a' }; SFX.back(); afterChange(); }
    return;
  }
  if (e.key === ' ') { e.preventDefault(); if (cursor) { cursor.dir = cursor.dir === 'a' ? 'd' : 'a'; renderBoard(); } return; }
  if (/^[a-z]$/i.test(e.key) && cursor) {
    const L = e.key.toUpperCase(), used = usedIds();
    let t = rack().find(x => !used.has(x.id) && !x.blank && x.l === L) || rack().find(x => !used.has(x.id) && x.blank);
    if (!t) { SFX.bad(); return; }
    const { r, c } = cursor;
    pending.set(r + ',' + c, { id: t.id, letter: L });
    SFX.place(); advanceCursor(); afterChange();
  }
});

// blank picker
let blankCb = null;
$('#blankLetters').innerHTML = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(l => `<button data-l="${l}">${l}</button>`).join('');
$('#blankLetters').onclick = e => { if (e.target.dataset.l) blankPick(e.target.dataset.l); };
$('#blankCancel').onclick = () => blankPick(null);
function askBlank(cb) { blankCb = cb; $('#blankModal').hidden = false; }
function blankPick(l) { $('#blankModal').hidden = true; const cb = blankCb; blankCb = null; if (l && cb) cb(l); }

// buttons
$('#playBtn').onclick = () => { if (!$('#playBtn').disabled) { send({ type: 'play', placements: placements() }); cursor = null; } };
$('#recallBtn').onclick = () => { pending.clear(); lastPreview = null; SFX.back(); afterChange(); renderPreview(); };
$('#shuffleBtn').onclick = () => { for (let i = rackOrder.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [rackOrder[i], rackOrder[j]] = [rackOrder[j], rackOrder[i]]; } renderRack(); };
$('#swapBtn').onclick = () => {
  if (!myTurn()) return;
  if (!swapMode) { pending.clear(); swapMode = true; selected = null; afterChange(); renderPreview(); return; }
  if (swapSel.size) {
    const free = S.tideRinseLeft > 0 && swapSel.size <= S.tideRinseLeft;
    if (free || confirm(`Swap ${swapSel.size} tile${swapSel.size > 1 ? 's' : ''}? This uses your turn.`)) send({ type: 'swap', ids: [...swapSel] });
  }
  swapMode = false; swapSel.clear(); renderRack(); renderButtons();
};
$('#giveBtn').onclick = () => { if (selected) { send({ type: 'give', id: selected }); selected = null; } };
$('#passBtn').onclick = () => { if (myTurn() && confirm('Pass your turn?')) send({ type: 'pass' }); };
$('#muteBtn').onclick = () => { muted = !muted; localStorage.setItem('davandy:mute', muted ? '1' : '0'); renderButtons(); };
$('#chatForm').onsubmit = e => { e.preventDefault(); send({ type: 'chat', text: $('#chatIn').value }); $('#chatIn').value = ''; };
$('#copyLink').onclick = () => { navigator.clipboard && navigator.clipboard.writeText($('#shareLink').value); $('#copyLink').textContent = 'COPIED'; };
$('#rematchBtn').onclick = () => { $('#endModal').hidden = true; send({ type: 'rematch' }); };
$('#endClose').onclick = () => { $('#endModal').hidden = true; };

function showEnd() {
  if (!S || S.status !== 'over') return;
  let title, text;
  if (S.mode === 'duel') {
    const [a, b] = S.players;
    if (S.winner === 'draw') { title = 'A DRAW'; text = `${a.name} ${a.score} – ${b.score} ${b.name}`; }
    else { const w = S.players[S.winner], l = S.players[1 - S.winner]; title = S.winner === seat ? 'YOU WIN!' : `${w.name.toUpperCase()} WINS`; text = `${w.name} ${w.score} – ${l.score} ${l.name}`; }
    const words = S.log.filter(x => x.kind === 'play').sort((x, y) => y.score - x.score)[0];
    if (words) text += `. Best word: ${words.word} (${words.score}).`;
  } else {
    const lit = S.lanterns.filter(l => l.lit).length;
    if (S.winner === 'team') { title = 'THE COAST IS LIT!'; text = `All ${lit} lanterns lit with ${S.turnsLeft} turn${S.turnsLeft === 1 ? '' : 's'} to spare.`; }
    else { title = 'DARKNESS FALLS'; text = `${lit} of ${S.lanterns.length} lanterns lit. The sea wins this one.`; }
  }
  (S.winner === seat || S.winner === 'team') ? SFX.win() : SFX.bad();
  $('#endTitle').textContent = title; $('#endText').textContent = text;
  $('#endModal').hidden = false;
}

// countdown
setInterval(() => {
  const el = $('#clock');
  if (!S || !S.turnDeadline || S.status !== 'playing') { el.textContent = ''; return; }
  const left = Math.max(0, Math.round((S.turnDeadline - (Date.now() - (S._skew || 0))) / 1000));
  el.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  el.classList.toggle('low', left <= 15);
}, 250);

// ---------------- boot ----------------
const q = new URLSearchParams(location.search).get('g');
if (q) gameId = q.toUpperCase();
connect();
})();
