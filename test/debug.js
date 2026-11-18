const G = require('../game'); const { genMoves, value } = require('./sim');
for (const seed of [1000,1001,1002,1003,1004,1005,1006,1007]) {
  const g = G.newGame({ id: 'S', mode: 'lighthouse', difficulty: 'calm', seed });
  G.addPlayer(g, 'A', 'a'); G.addPlayer(g, 'B', 'b');
  while (g.status === 'playing') {
    const ms = genMoves(g, g.turn);
    if (!ms.length) { const r = g.players[g.turn].rack; if (g.bag.length >= r.length) G.swap(g, g.turn, r.map(t => t.id)); else G.pass(g, g.turn); continue; }
    ms.sort((x, y) => value(g, y) - value(g, x)); G.play(g, g.turn, ms[0].pl);
  }
  if (g.winner === 'team') continue;
  const L = new Map(g.lanterns.map(l => [l.r+','+l.c, l]));
  console.log('seed', seed);
  for (let r = 0; r < 15; r++) console.log(g.board[r].map((x, c) => { const l = L.get(r+','+c); return x ? (l ? (l.lit?'*':'!')+x.l : ' '+x.l) : (l ? (l.lit?' *':' '+l.req) : ' .'); }).join(''));
  console.log(g.log.filter(x=>x.kind==='play').map(x=>x.word).join(' '));
}
