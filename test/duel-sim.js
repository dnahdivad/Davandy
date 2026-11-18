// Sharp bot (seat 0, always the top-scoring play) vs casual bot (seat 1, a middling play from short common words).
const G = require('../game'); const { genMoves } = require('./sim');
const tide = process.argv[2] !== 'notide', N = +process.argv[3] || 12;
if (!tide) { G.TUNE.TIDE_GAP = 1e9; G.TUNE.SWELL = []; }
const gap = process.argv[4] || 'wide';
let casualWins = 0, margins = [];
for (let i = 0; i < N; i++) {
  const g = G.newGame({ id: 'D', mode: 'duel', seed: 500 + i });
  G.addPlayer(g, 'Sharp', 'a'); G.addPlayer(g, 'Casual', 'b');
  let guard = 0;
  while (g.status === 'playing' && guard++ < 200) {
    const s = g.turn; let ms = genMoves(g, s);
    ms = ms.filter(m => m.a.main.length <= (s === 0 ? 7 : 6));
    if (!ms.length) { const r = g.players[s].rack; try { if (g.bag.length >= 7) G.swap(g, s, r.slice(0, 4).map(t => t.id)); else G.pass(g, s); } catch { G.pass(g, s); } continue; }
    ms.sort((x, y) => y.a.score - x.a.score);
    const pick = s === 0 ? ms[Math.floor(Math.random() * Math.min(ms.length, Math.max(3, ms.length * 0.06)))] : ms[Math.floor(ms.length * (gap === 'wide' ? 0.25 + Math.random() * 0.4 : Math.random() * 0.25))];
    G.play(g, s, pick.pl);
  }
  const [a, b] = g.players; if (b.score > a.score) casualWins++; margins.push(a.score - b.score);
}
console.log(gap.padEnd(6), tide ? 'tide ON ' : 'tide OFF', `casual wins ${casualWins}/${N}`, 'avg margin', (margins.reduce((x, y) => x + y, 0) / N).toFixed(0));
