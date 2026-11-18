// DAVANDY server: Express for files, WebSockets for live play, JSON file for persistence.
'use strict';
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const { WebSocketServer } = require('ws');
const G = require('./game');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'games.json');
const KEEP_DAYS = 30;

fs.mkdirSync(DATA_DIR, { recursive: true });
let games = {};
try { games = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch { games = {}; }
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const cutoff = Date.now() - KEEP_DAYS * 864e5;
    for (const [id, g] of Object.entries(games)) if ((g.touched || g.created) < cutoff) delete games[id];
    fs.writeFileSync(DATA_FILE + '.tmp', JSON.stringify(games));
    fs.renameSync(DATA_FILE + '.tmp', DATA_FILE);
  }, 300);
}

G.loadDict();
const app = express();
app.use(express.json());
app.get('/healthz', (_, res) => res.send('ok'));
app.use('/fonts', express.static(path.join(__dirname, 'node_modules/@fontsource/press-start-2p/files')));
app.use('/fonts', express.static(path.join(__dirname, 'node_modules/@fontsource/vt323/files')));
app.use(express.static(path.join(__dirname, 'public')));

const LETTERS = 'BCDFGHJKLMNPQRSTVWXZ';
function newCode() {
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += LETTERS[crypto.randomInt(LETTERS.length)];
    if (!games[c]) return c;
  }
}

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
const sockets = new Map(); // ws -> {gameId, seat}

function broadcast(g, extra) {
  for (const [ws, s] of sockets) {
    if (s.gameId !== g.id || ws.readyState !== 1) continue;
    const online = [0, 1].map(i => [...sockets.values()].some(x => x.gameId === g.id && x.seat === i));
    ws.send(JSON.stringify({ type: 'state', state: { ...G.view(g, s.seat), online }, ...(extra || {}) }));
  }
}

function send(ws, msg) { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); }

wss.on('connection', ws => {
  ws.on('message', raw => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    try { handle(ws, m); }
    catch (e) { send(ws, { type: 'error', error: e.message, req: m.req }); }
  });
  ws.on('close', () => {
    const s = sockets.get(ws);
    sockets.delete(ws);
    if (s && games[s.gameId]) broadcast(games[s.gameId]);
  });
});

function handle(ws, m) {
  if (m.type === 'create') {
    const id = newCode();
    const mode = m.mode === 'lighthouse' ? 'lighthouse' : 'duel';
    const g = G.newGame({ id, mode, difficulty: m.difficulty, headStart: m.headStart, headStartSeat: m.headStartSeat === 0 ? 0 : 1, timer: m.timer });
    const token = crypto.randomBytes(12).toString('hex');
    G.addPlayer(g, m.name, token);
    g.touched = Date.now();
    games[id] = g; save();
    sockets.set(ws, { gameId: id, seat: 0 });
    send(ws, { type: 'joined', id, seat: 0, token });
    return broadcast(g);
  }
  if (m.type === 'join') {
    const g = games[String(m.id || '').toUpperCase()];
    if (!g) throw new Error('No game with that code.');
    let seat = g.players.findIndex(p => p.token === m.token);
    let token = m.token;
    if (seat < 0) {
      if (g.players.length >= 2) {
        sockets.set(ws, { gameId: g.id, seat: -1 }); // watcher
        send(ws, { type: 'joined', id: g.id, seat: -1 });
        return broadcast(g);
      }
      if (!m.name) return send(ws, { type: 'needName', id: g.id, mode: g.mode, host: g.players[0].name });
      token = crypto.randomBytes(12).toString('hex');
      seat = G.addPlayer(g, m.name, token);
    }
    g.touched = Date.now(); save();
    sockets.set(ws, { gameId: g.id, seat });
    send(ws, { type: 'joined', id: g.id, seat, token });
    return broadcast(g);
  }

  const s = sockets.get(ws);
  if (!s) throw new Error('Join a game first.');
  const g = games[s.gameId];
  if (!g) throw new Error('That game has gone.');
  if (s.seat < 0 && m.type !== 'preview') throw new Error('You are watching this game.');

  switch (m.type) {
    case 'preview': {
      if (s.seat < 0) return;
      const a = G.analyse(g, s.seat, m.placements);
      return send(ws, { type: 'preview', req: m.req, preview: a.tiles ? { ok: a.ok, error: a.error, main: a.main, words: a.words, score: a.score, breakdown: a.breakdown, lights: a.lights, lanternMisses: a.lanternMisses, crowds: a.crowds } : a });
    }
    case 'play': { const a = G.play(g, s.seat, m.placements); g.touched = Date.now(); save(); return broadcast(g, { event: { kind: 'play', seat: s.seat, lights: a.lights.length } }); }
    case 'swap': G.swap(g, s.seat, m.ids); break;
    case 'pass': G.pass(g, s.seat); break;
    case 'give': G.give(g, s.seat, m.id); break;
    case 'chat': G.chat(g, s.seat, m.text); break;
    case 'rematch': {
      if (g.status !== 'over') throw new Error('Finish this one first.');
      if (g.rematch) { send(ws, { type: 'goto', id: g.rematch }); return; }
      const id = newCode();
      const n = G.newGame({ id, mode: g.mode, difficulty: g.settings.difficulty, headStart: g.settings.headStart, headStartSeat: g.settings.headStartSeat, timer: g.settings.timer });
      // keep seats and tokens so both players drop straight in
      for (const p of g.players) G.addPlayer(n, p.name, p.token);
      n.touched = Date.now();
      games[id] = n; g.rematch = id; save();
      for (const [w, x] of sockets) if (x.gameId === g.id) send(w, { type: 'goto', id });
      return;
    }
    default: throw new Error('Unknown action.');
  }
  g.touched = Date.now(); save();
  broadcast(g);
}

// turn timers
setInterval(() => {
  for (const g of Object.values(games)) if (G.timeout(g)) { save(); broadcast(g); }
}, 1000);

server.listen(PORT, () => console.log(`DAVANDY listening on :${PORT}`));
