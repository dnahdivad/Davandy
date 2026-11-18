// Lighthouse balance check: two bots (common-words only) play co-op games.
const G = require('../game');
const WL = require('wordlist-english');
const COMMON = [...new Set([...WL['english/10'], ...WL['english/20'], ...WL['english/35']].filter(w => /^[a-z]{2,8}$/.test(w)).map(w => w.toUpperCase()))].filter(G.isWord);
const SIZE = 15;
function counts(s) { const c = {}; for (const ch of s) c[ch] = (c[ch] || 0) + 1; return c; }
function genMoves(g, seat) {
  const rack = g.players[seat].rack, blanks = rack.filter(t => t.blank).length;
  const moves = [];
  const empty = g.board.every(r => r.every(x => !x));
  for (const dir of ['a', 'd']) for (let line = 0; line < SIZE; line++) {
    const cell = i => dir === 'a' ? g.board[line][i] : g.board[i][line];
    const lineLetters = []; for (let i = 0; i < SIZE; i++) if (cell(i)) lineLetters.push(cell(i).l);
    const avail = counts(rack.filter(t => !t.blank).map(t => t.l).join('') + lineLetters.join(''));
    const cand = COMMON.filter(w => { const c = counts(w); let need = 0; for (const k in c) if ((avail[k] || 0) < c[k]) need += c[k] - (avail[k] || 0); return need <= blanks; });
    for (const w of cand) for (let s = 0; s + w.length <= SIZE; s++) {
      if (s > 0 && cell(s - 1)) continue; if (s + w.length < SIZE && cell(s + w.length)) continue;
      const pool = [...rack]; const pl = []; let ok = true, hook = false;
      for (let i = 0; i < w.length; i++) {
        const x = cell(s + i);
        if (x) { if (x.l !== w[i]) { ok = false; break; } hook = true; continue; }
        let t = pool.find(t => !t.blank && t.l === w[i]) || pool.find(t => t.blank);
        if (!t) { ok = false; break; }
        pool.splice(pool.indexOf(t), 1);
        const r = dir === 'a' ? line : s + i, c = dir === 'a' ? s + i : line;
        pl.push({ id: t.id, r, c, letter: w[i] });
      }
      if (!ok || !pl.length) continue;
      if (empty && !pl.some(p => p.r === 7 && p.c === 7)) continue;
      if (!empty && !hook && !pl.some(p => [[1,0],[-1,0],[0,1],[0,-1]].some(([a,b]) => g.board[p.r+a] && g.board[p.r+a][p.c+b]))) continue;
      const a = G.analyse(g, seat, pl);
      if (a.ok) moves.push({ pl, a });
    }
  }
  return moves;
}
function value(g, m) {
  const unlit = g.lanterns.filter(l => !l.lit);
  let v = m.a.lights.length * 1000;
  const after = unlit.filter(l => !m.a.lights.some(x => x.r === l.r && x.c === l.c));
  // reward reaching toward remaining lanterns
  for (const l of after) {
    const d = Math.min(...m.pl.map(p => Math.max(Math.abs(p.r - l.r), Math.abs(p.c - l.c))));
    v += Math.max(0, 8 - d) * 6;
    // lining up: a fresh tile in the lantern's row/column with clear squares between
    for (const p of m.pl) {
      const same = p.r === l.r ? 'r' : p.c === l.c ? 'c' : null; if (!same) continue;
      const dist = same === 'r' ? Math.abs(p.c - l.c) : Math.abs(p.r - l.r);
      if (dist >= l.req) continue;
      let clear = true;
      for (let k = 1; k < dist; k++) { const rr = same === 'r' ? l.r : l.r + Math.sign(p.r - l.r) * k, cc = same === 'c' ? l.c : l.c + Math.sign(p.c - l.c) * k; if (g.board[rr][cc] && !m.pl.some(q => q.r === rr && q.c === cc)) { clear = false; break; } }
      if (clear) { v += 25; break; }
    }
  }
  v -= (m.a.crowds || 0) * 40;
  return v + m.pl.length;
}
function playGame(diff, seed) {
  const g = G.newGame({ id: 'S', mode: 'lighthouse', difficulty: diff, seed });
  G.addPlayer(g, 'A', 'a'); G.addPlayer(g, 'B', 'b');
  while (g.status === 'playing') {
    const ms = genMoves(g, g.turn);
    if (!ms.length) { const r = g.players[g.turn].rack; if (g.bag.length >= r.length) G.swap(g, g.turn, r.map(t => t.id)); else G.pass(g, g.turn); continue; }
    ms.sort((x, y) => value(g, y) - value(g, x));
    G.play(g, g.turn, ms[0].pl);
  }
  return { win: g.winner === 'team', left: g.turnsLeft, lit: g.lanterns.filter(l => l.lit).length, unlit: g.lanterns.filter(l => !l.lit).map(l => l.req).join(''), of: g.lanterns.length };
}
module.exports = { genMoves, value, playGame };
if (require.main !== module) return;
const N = +process.argv[2] || 12;
for (const diff of ['calm', 'squall', 'storm']) {
  const res = []; for (let i = 0; i < N; i++) res.push(playGame(diff, 1000 + i));
  const wins = res.filter(r => r.win);
  console.log(diff.padEnd(7), `wins ${wins.length}/${N}`, 'avg turns spare', (wins.reduce((s, r) => s + r.left, 0) / (wins.length || 1)).toFixed(1), 'losses lit:', res.filter(r => !r.win).map(r => `${r.lit}/${r.of}[${r.unlit}]`).join(' '));
}
