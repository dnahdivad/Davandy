// DAVANDY rules engine. Server-authoritative; the browser only displays state.
'use strict';
const fs = require('fs');
const path = require('path');

const SIZE = 15;
const CENTER = 7;

// ---------- dictionary ----------
let DICT = null;
function loadDict() {
  if (DICT) return DICT;
  const file = path.join(__dirname, 'dict', 'words.txt');
  DICT = new Set(fs.readFileSync(file, 'utf8').split('\n').map(w => w.trim().toUpperCase()).filter(Boolean));
  return DICT;
}
function isWord(w) { return loadDict().has(w.toUpperCase()); }

// ---------- tiles ----------
const VALUES = { A:1,B:3,C:3,D:2,E:1,F:4,G:2,H:4,I:1,J:8,K:5,L:1,M:3,N:1,O:1,P:3,Q:10,R:1,S:1,T:1,U:1,V:4,W:4,X:8,Y:4,Z:10,'?':0 };
const COUNTS = { A:9,B:2,C:2,D:4,E:12,F:2,G:3,H:2,I:9,J:1,K:1,L:4,M:2,N:6,O:8,P:2,Q:1,R:6,S:4,T:6,U:4,V:2,W:2,X:1,Y:2,Z:1,'?':2 };
// Duel scoring: only the main word scores. Length bonus rewards finding longer words.
const LENGTH_BONUS = [0, 0, 0, 0, 2, 5, 9, 14, 20, 26, 32, 38, 44, 50, 56, 62];
const SHELL_BONUS = 5;      // flat bonus per shell square covered - flat, so where you put a Q doesn't matter
const FULL_RACK_BONUS = 20; // using 7+ tiles in one go
const TUNE = { TIDE_GAP: 20, SWELL: [[90, 1.75], [50, 1.5], [20, 1.25]] }; // trailing by this much brings the tide in (tests can switch it off)
const TIDE_RINSE = 3;       // free swaps per turn while the tide is with you
const MAX_SCORELESS = 6;    // consecutive passes/swaps (both players) that end a duel

const LIGHTHOUSE = {
  calm:   { turns: 24, reqs: [3, 3, 4, 4, 5] },
  squall: { turns: 22, reqs: [3, 4, 4, 5, 5, 6] },
  storm:  { turns: 20, reqs: [4, 4, 5, 5, 6, 6] },
};

// Shell squares: a symmetric scatter.
const SHELL_BASE = [[0,3],[0,11],[2,6],[2,8],[3,0],[3,14],[6,2],[6,12],[8,2],[8,12],[11,0],[11,14],[12,6],[12,8],[14,3],[14,11],[5,5],[5,9],[9,5],[9,9]];
const SHELLS = new Set(SHELL_BASE.map(([r, c]) => r + ',' + c));

function rng(seed) { // mulberry32
  let a = seed >>> 0;
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

function makeBag(rand) {
  const bag = [];
  let id = 0;
  for (const [l, n] of Object.entries(COUNTS)) for (let i = 0; i < n; i++) bag.push({ id: 't' + (id++), l: l === '?' ? '' : l, v: VALUES[l], blank: l === '?' });
  for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; }
  return bag;
}

function placeLanterns(reqs, rand) {
  // Lanterns sit 3-6 squares out from the centre; longer requirements sit further out.
  const sorted = [...reqs].sort((a, b) => a - b);
  for (let attempt = 0; attempt < 5000; attempt++) {
    const out = [];
    let ok = true;
    for (const req of sorted) {
      // short words travel far, long words sit closer in: reach and length are the two challenges, not stacked
      const RANGE = { 3: [5, 6], 4: [4, 6], 5: [3, 5], 6: [3, 4], 7: [2, 4] };
      const [lo, hi] = RANGE[req] || [3, 5];
      let placed = false;
      for (let k = 0; k < 200 && !placed; k++) {
        const r = Math.floor(rand() * SIZE), c = Math.floor(rand() * SIZE);
        const d = Math.max(Math.abs(r - CENTER), Math.abs(c - CENTER));
        if (d < lo || d > hi || SHELLS.has(r + ',' + c)) continue;
        if (out.some(o => Math.max(Math.abs(o.r - r), Math.abs(o.c - c)) < 3)) continue;
        out.push({ r, c, req, lit: false, litBy: null, word: null });
        placed = true;
      }
      if (!placed) { ok = false; break; }
    }
    // spread across quadrants: no more than 2 lanterns per quadrant
    if (ok) {
      const q = {};
      for (const o of out) { const k = (o.r < CENTER ? 'N' : o.r > CENTER ? 'S' : 'M') + (o.c < CENTER ? 'W' : o.c > CENTER ? 'E' : 'M'); q[k] = (q[k] || 0) + 1; }
      if (Object.values(q).every(n => n <= 2)) return out;
    }
  }
  throw new Error('could not place lanterns');
}

// ---------- game creation ----------
function newGame({ id, mode, difficulty = 'squall', headStart = 0, headStartSeat = 1, timer = 0, seed }) {
  seed = seed ?? Math.floor(Math.random() * 2 ** 31);
  const rand = rng(seed);
  const g = {
    id, mode, seed,
    settings: { difficulty, headStart: Number(headStart) || 0, headStartSeat, timer: Number(timer) || 0 },
    board: Array.from({ length: SIZE }, () => Array(SIZE).fill(null)),
    bag: makeBag(rand),
    players: [],
    turn: 0, turnNo: 0, scoreless: 0,
    status: 'waiting', winner: null,
    log: [], chat: [],
    lanterns: [], turnsLeft: null,
    tideRinseUsed: 0,
    turnDeadline: null,
    lastMove: [],
    created: Date.now(),
  };
  if (mode === 'lighthouse') {
    const cfg = LIGHTHOUSE[difficulty] || LIGHTHOUSE.squall;
    g.lanterns = placeLanterns(cfg.reqs, rand);
    g.turnsLeft = cfg.turns;
  }
  return g;
}

function addPlayer(g, name, token) {
  if (g.players.length >= 2) throw new Error('This game already has two players.');
  const seat = g.players.length;
  const p = { name: String(name || 'Player').slice(0, 16), token, rack: [], score: 0 };
  if (g.mode === 'duel' && g.settings.headStart && g.settings.headStartSeat === seat) p.score = g.settings.headStart;
  g.players.push(p);
  draw(g, p, 7);
  if (g.players.length === 2) {
    g.status = 'playing';
    g.turn = Math.floor(rng(g.seed + 7)() * 2);
    logLine(g, `${g.players[g.turn].name} goes first.`);
    startTurn(g);
  }
  return seat;
}

function draw(g, p, upTo) { while (p.rack.length < upTo && g.bag.length) p.rack.push(g.bag.pop()); }
function logLine(g, text, extra = {}) { g.log.push({ t: Date.now(), text, ...extra }); if (g.log.length > 200) g.log.shift(); }

function swellFor(g, seat) {
  if (g.mode !== 'duel' || g.players.length < 2) return 1;
  const gap = g.players[1 - seat].score - g.players[seat].score;
  for (const [min, x] of TUNE.SWELL) if (gap >= min) return x;
  return 1;
}
function tideFor(g, seat) {
  if (g.mode !== 'duel' || g.players.length < 2) return false;
  return g.players[1 - seat].score - g.players[seat].score >= TUNE.TIDE_GAP;
}

function startTurn(g) {
  g.tideRinseUsed = 0;
  g.turnDeadline = g.settings.timer ? Date.now() + g.settings.timer * 1000 : null;
  const p = g.players[g.turn];
  if (tideFor(g, g.turn) && p.rack.length < 8 && g.bag.length) {
    draw(g, p, 8);
    logLine(g, `The tide is with ${p.name}: an 8th tile washes in.`, { kind: 'tide' });
  }
}

function endTurn(g, scored) {
  if (g.status !== 'playing') return;
  g.scoreless = scored ? 0 : g.scoreless + 1;
  g.turnNo++;
  if (g.mode === 'lighthouse') {
    g.turnsLeft--;
    if (g.lanterns.every(l => l.lit)) { g.status = 'over'; g.winner = 'team'; logLine(g, `Every lantern is lit with ${g.turnsLeft} turns to spare!`, { kind: 'win' }); g.turnDeadline = null; return; }
    if (g.turnsLeft <= 0) { g.status = 'over'; g.winner = 'sea'; logLine(g, `The light ran out. ${g.lanterns.filter(l => l.lit).length} of ${g.lanterns.length} lanterns lit.`, { kind: 'lose' }); g.turnDeadline = null; return; }
  } else {
    const p = g.players[g.turn];
    if (p.rack.length === 0 && g.bag.length === 0) return finishDuel(g, g.turn);
    if (g.scoreless >= MAX_SCORELESS) return finishDuel(g, null);
  }
  g.turn = 1 - g.turn;
  startTurn(g);
}

function rackValue(p) { return p.rack.reduce((s, t) => s + t.v, 0); }
function finishDuel(g, wentOut) {
  if (wentOut !== null) {
    const other = g.players[1 - wentOut], v = rackValue(other);
    other.score -= v; g.players[wentOut].score += v;
    logLine(g, `${g.players[wentOut].name} went out. ${other.name}'s leftover tiles (${v}) change hands.`);
  } else {
    for (const p of g.players) p.score -= rackValue(p);
    logLine(g, 'Six scoreless turns in a row. Leftover tiles are deducted.');
  }
  g.status = 'over';
  g.turnDeadline = null;
  const [a, b] = g.players;
  g.winner = a.score === b.score ? 'draw' : (a.score > b.score ? 0 : 1);
  logLine(g, g.winner === 'draw' ? `A draw at ${a.score}!` : `${g.players[g.winner].name} wins ${Math.max(a.score, b.score)}–${Math.min(a.score, b.score)}.`, { kind: 'win' });
}

// ---------- move analysis ----------
// placements: [{id, r, c, letter}] (letter only needed for blanks)
function analyse(g, seat, placements) {
  const p = g.players[seat];
  if (!Array.isArray(placements) || !placements.length) return { ok: false, error: 'Place some tiles first.' };
  const seen = new Set(), sq = new Set(), tiles = [];
  for (const pl of placements) {
    const t = p.rack.find(x => x.id === pl.id);
    if (!t || seen.has(pl.id)) return { ok: false, error: 'That tile is not on your rack.' };
    seen.add(pl.id);
    const r = pl.r | 0, c = pl.c | 0;
    if (r < 0 || c < 0 || r >= SIZE || c >= SIZE) return { ok: false, error: 'Off the board.' };
    if (g.board[r][c] || sq.has(r + ',' + c)) return { ok: false, error: 'That square is taken.' };
    sq.add(r + ',' + c);
    let l = t.l;
    if (t.blank) { l = String(pl.letter || '').toUpperCase(); if (!/^[A-Z]$/.test(l)) return { ok: false, error: 'Choose a letter for the blank.' }; }
    tiles.push({ r, c, l, v: t.blank ? 0 : t.v, blank: t.blank, id: t.id });
  }
  const rows = new Set(tiles.map(t => t.r)), cols = new Set(tiles.map(t => t.c));
  if (rows.size > 1 && cols.size > 1) return { ok: false, error: 'Tiles must be in one straight line.' };
  const at = (r, c) => {
    if (r < 0 || c < 0 || r >= SIZE || c >= SIZE) return null;
    return g.board[r][c] || tiles.find(t => t.r === r && t.c === c) || null;
  };
  let horiz = rows.size === 1 && (tiles.length > 1 || at(tiles[0].r, tiles[0].c - 1) || at(tiles[0].r, tiles[0].c + 1));
  if (tiles.length === 1 && !horiz && !(at(tiles[0].r - 1, tiles[0].c) || at(tiles[0].r + 1, tiles[0].c))) horiz = true;
  const dr = horiz ? 0 : 1, dc = horiz ? 1 : 0;

  // contiguity: from min to max on the line, every square filled
  const sorted = [...tiles].sort((a, b) => horiz ? a.c - b.c : a.r - b.r);
  const first = sorted[0], last = sorted[sorted.length - 1];
  for (let r = first.r, c = first.c; r <= last.r && c <= last.c; r += dr, c += dc) if (!at(r, c)) return { ok: false, error: 'There is a gap in your word.' };

  const boardEmpty = g.board.every(row => row.every(x => !x));
  if (boardEmpty) {
    if (!sq.has(CENTER + ',' + CENTER)) return { ok: false, error: 'The first word must cover the centre star.' };
    if (tiles.length < 2) return { ok: false, error: 'The first word needs at least two letters.' };
  } else {
    const touches = tiles.some(t => [[1,0],[-1,0],[0,1],[0,-1]].some(([a, b]) => { const x = at(t.r + a, t.c + b); return x && g.board[t.r + a][t.c + b]; }));
    if (!touches) return { ok: false, error: 'Your word must join onto tiles already on the board.' };
  }

  const wordAt = (r, c, dr, dc) => {
    while (at(r - dr, c - dc)) { r -= dr; c -= dc; }
    const cells = [];
    while (at(r, c)) { const x = at(r, c); cells.push({ r, c, l: x.l, v: x.blank ? 0 : x.v, fresh: !g.board[r][c] }); r += dr; c += dc; }
    return cells;
  };
  const words = [];
  const main = wordAt(first.r, first.c, dr, dc);
  if (main.length >= 2) words.push({ cells: main, main: true });
  for (const t of tiles) {
    const cross = wordAt(t.r, t.c, dc, dr);
    if (cross.length >= 2) words.push({ cells: cross, main: false });
  }
  if (!words.length) return { ok: false, error: 'Make a word of at least two letters.' };
  if (!words.some(w => w.main)) words[0].main = true;

  for (const w of words) w.text = w.cells.map(x => x.l).join('');
  const bad = words.filter(w => !isWord(w.text)).map(w => w.text);

  const mw = words.find(w => w.main);
  const letters = mw.cells.reduce((s, x) => s + x.v, 0);
  const shells = mw.cells.filter(x => x.fresh && SHELLS.has(x.r + ',' + x.c)).length;
  const lengthBonus = LENGTH_BONUS[Math.min(mw.cells.length, LENGTH_BONUS.length - 1)];
  const fullRack = tiles.length >= 7 ? FULL_RACK_BONUS : 0;
  const base = letters + lengthBonus + shells * SHELL_BONUS + fullRack;
  const swell = swellFor(g, seat);
  const score = Math.round(base * swell);

  // lanterns lit by this move
  const lights = [];
  for (const L of g.lanterns) {
    if (L.lit) continue;
    // any word made this turn that runs through the lantern counts, even if the lantern tile was laid earlier
    const through = words.filter(w => w.cells.some(x => x.r === L.r && x.c === L.c));
    const best = through.sort((a, b) => b.cells.length - a.cells.length)[0];
    if (best && best.cells.length >= L.req) lights.push({ lantern: L, word: best.text });
  }
  const lanternMisses = g.lanterns.filter(L => !L.lit && sq.has(L.r + ',' + L.c) && !lights.find(x => x.lantern === L)).map(L => L.req);

  const litNow = new Set(lights.map(x => x.lantern));
  const crowds = g.lanterns.filter(L => !L.lit && !litNow.has(L) && tiles.some(t => Math.abs(t.r - L.r) + Math.abs(t.c - L.c) === 1)).length;
  let error = bad.length ? `Not in the dictionary: ${bad.join(', ')}` : null;
  if (!error && lanternMisses.length) error = `A lantern only takes a tile that lights it: it needs a word of ${Math.max(...lanternMisses)}+ letters.`;
  return {
    ok: !error,
    error,
    tiles, words: words.map(w => ({ text: w.text, main: w.main })), main: mw.text,
    score, breakdown: { letters, lengthBonus, shells: shells * SHELL_BONUS, fullRack, swell, swellBonus: score - base },
    lights: lights.map(x => ({ r: x.lantern.r, c: x.lantern.c, req: x.lantern.req, word: x.word })),
    lanternMisses, crowds,
  };
}

// ---------- actions ----------
function mustBeTurn(g, seat) {
  if (g.status !== 'playing') throw new Error('The game is not in play.');
  if (g.turn !== seat) throw new Error("It's not your turn.");
}

function play(g, seat, placements) {
  mustBeTurn(g, seat);
  const a = analyse(g, seat, placements);
  if (!a.ok) throw new Error(a.error);
  const p = g.players[seat];
  for (const t of a.tiles) {
    g.board[t.r][t.c] = { l: t.l, v: t.v, blank: t.blank, by: seat };
    p.rack = p.rack.filter(x => x.id !== t.id);
  }
  g.lastMove = a.tiles.map(t => [t.r, t.c]);
  p.score += a.score;
  const cross = a.words.filter(w => !w.main).map(w => w.text);
  let line = `${p.name} played ${a.main} for ${a.score}`;
  if (cross.length) line += ` (also made ${cross.join(', ')})`;
  logLine(g, line + '.', { kind: 'play', seat, word: a.main, score: a.score });
  for (const L of a.lights) {
    const lan = g.lanterns.find(x => x.r === L.r && x.c === L.c);
    lan.lit = true; lan.litBy = seat; lan.word = L.word;
    logLine(g, `${p.name} lit a lantern with ${L.word}!`, { kind: 'light' });
  }
  draw(g, p, 7);
  endTurn(g, true);
  return a;
}

function swap(g, seat, ids) {
  mustBeTurn(g, seat);
  const p = g.players[seat];
  ids = [...new Set(ids || [])];
  if (!ids.length) throw new Error('Pick tiles to swap.');
  if (!ids.every(id => p.rack.some(t => t.id === id))) throw new Error('That tile is not on your rack.');
  const tide = tideFor(g, seat) && g.tideRinseUsed + ids.length <= TIDE_RINSE;
  if (g.bag.length < ids.length) throw new Error('Not enough tiles left in the bag.');
  if (!tide && g.bag.length < 7 && g.mode === 'duel') throw new Error('You can only swap while 7 or more tiles are in the bag.');
  const out = p.rack.filter(t => ids.includes(t.id));
  p.rack = p.rack.filter(t => !ids.includes(t.id));
  const target = p.rack.length + out.length;
  draw(g, p, target);
  for (const t of out) { if (t.blank) t.l = ''; g.bag.splice(Math.floor(Math.random() * (g.bag.length + 1)), 0, t); }
  if (tide) {
    g.tideRinseUsed += ids.length;
    logLine(g, `${p.name} rinsed ${ids.length} tile${ids.length > 1 ? 's' : ''} in the tide (free).`, { kind: 'tide' });
    return { free: true };
  }
  logLine(g, `${p.name} swapped ${ids.length} tile${ids.length > 1 ? 's' : ''}.`);
  endTurn(g, false);
  return { free: false };
}

function pass(g, seat, reason) {
  mustBeTurn(g, seat);
  logLine(g, `${g.players[seat].name} ${reason || 'passed'}.`);
  endTurn(g, false);
}

// Lighthouse: hand one tile to your partner before you play (once per turn).
function give(g, seat, id) {
  mustBeTurn(g, seat);
  if (g.mode !== 'lighthouse') throw new Error('Gifts are a Lighthouse rule.');
  if (g.gaveThisTurn === g.turnNo) throw new Error('You can only give one tile per turn.');
  const p = g.players[seat], q = g.players[1 - seat];
  const t = p.rack.find(x => x.id === id);
  if (!t) throw new Error('That tile is not on your rack.');
  p.rack = p.rack.filter(x => x.id !== id);
  q.rack.push(t);
  draw(g, p, 7);
  g.gaveThisTurn = g.turnNo;
  logLine(g, `${p.name} handed ${t.blank ? 'a blank' : t.l} to ${q.name}.`, { kind: 'give' });
}

function chat(g, seat, text) {
  text = String(text || '').trim().slice(0, 140);
  if (!text) return;
  g.chat.push({ t: Date.now(), seat, text });
  if (g.chat.length > 100) g.chat.shift();
}

function timeout(g) {
  if (g.status !== 'playing' || !g.turnDeadline || Date.now() < g.turnDeadline) return false;
  pass(g, g.turn, "ran out of time");
  return true;
}

// What a given seat is allowed to see.
function view(g, seat) {
  const coop = g.mode === 'lighthouse';
  return {
    id: g.id, mode: g.mode, settings: g.settings, size: SIZE,
    board: g.board, shells: SHELL_BASE, lanterns: g.lanterns, lastMove: g.lastMove,
    bagCount: g.bag.length, turn: g.turn, turnNo: g.turnNo, turnsLeft: g.turnsLeft,
    status: g.status, winner: g.winner, log: g.log.slice(-60), chat: g.chat.slice(-40),
    turnDeadline: g.turnDeadline, now: Date.now(),
    you: seat,
    tide: g.players.map((_, i) => tideFor(g, i)),
    swell: g.players.map((_, i) => swellFor(g, i)),
    tideRinseLeft: tideFor(g, g.turn) ? TIDE_RINSE - g.tideRinseUsed : 0,
    canGive: coop && g.gaveThisTurn !== g.turnNo,
    players: g.players.map((p, i) => ({
      name: p.name, score: p.score, rackCount: p.rack.length,
      rack: (i === seat || coop || g.status === 'over') ? p.rack : null,
    })),
    rules: { LENGTH_BONUS, SHELL_BONUS, FULL_RACK_BONUS, TIDE_GAP: TUNE.TIDE_GAP, TIDE_RINSE, VALUES },
  };
}

module.exports = { TUNE, SIZE, CENTER, VALUES, SHELLS, LIGHTHOUSE, LENGTH_BONUS, newGame, addPlayer, analyse, play, swap, pass, give, chat, timeout, view, isWord, loadDict, rng };
