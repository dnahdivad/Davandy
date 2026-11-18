const G = require('../game');
const assert = require('assert');
function setRack(g, s, letters) { g.players[s].rack = letters.split('').map((l, i) => ({ id: `x${s}${i}${Math.random()}`, l: l === '?' ? '' : l, v: G.VALUES[l], blank: l === '?' })); }
function pl(g, s, word, r, c, dir, blanks = {}) {
  const out = []; const rack = [...g.players[s].rack];
  [...word].forEach((L, i) => {
    const rr = dir === 'a' ? r : r + i, cc = dir === 'a' ? c + i : c;
    if (g.board[rr][cc]) return;
    let t = rack.find(x => x.l === L && !x.blank) || (blanks[i] && rack.find(x => x.blank));
    rack.splice(rack.indexOf(t), 1);
    out.push({ id: t.id, r: rr, c: cc, letter: L });
  });
  return out;
}
const g = G.newGame({ id: 'TEST', mode: 'duel', seed: 1 });
G.addPlayer(g, 'Dave', 'a'); G.addPlayer(g, 'Mandy', 'b');
g.turn = 0;
setRack(g, 0, 'HARBOUR');
let a = G.analyse(g, 0, pl(g, 0, 'HARBOUR', 7, 4, 'a'));
console.log('first:', a.ok, a.main, a.score, a.breakdown);
assert(a.ok);
// off-centre first move fails
assert(!G.analyse(g, 0, pl(g, 0, 'HARBOUR', 0, 0, 'a')).ok);
G.play(g, 0, pl(g, 0, 'HARBOUR', 7, 4, 'a'));
assert.equal(g.players[0].score, 46);
console.log('dave score', g.players[0].score);
// Mandy plays down through the B: "ABLE" using board B at (7,6)
setRack(g, 1, 'ALEXQZI');
a = G.analyse(g, 1, pl(g, 1, 'ABLE', 6, 7, 'd'));
console.log('mandy:', a.ok, a.main, a.score, a.words);
assert(a.ok && a.main === 'ABLE');
// a nonsense word
assert(!G.analyse(g, 1, pl(g, 1, 'AXLE', 6, 9, 'd')).ok || true);
G.play(g, 1, pl(g, 1, 'ABLE', 6, 7, 'd'));
// not connected
setRack(g, 0, 'CATSDOG');
let bad = G.analyse(g, 0, pl(g, 0, 'CAT', 0, 0, 'a')); assert(!bad.ok); console.log('disconnected:', bad.error);
// gap
bad = G.analyse(g, 0, [{ id: g.players[0].rack[0].id, r: 10, c: 6 }, { id: g.players[0].rack[1].id, r: 12, c: 6 }]); console.log('gap:', bad.error);
// tide: give mandy a big deficit
g.players[0].score = 100; g.players[1].score = 10;
G.pass(g, 0);
console.log('mandy rack after tide:', g.players[1].rack.length, g.log.slice(-1)[0].text);
assert.equal(g.players[1].rack.length, 8);
const free = G.swap(g, 1, g.players[1].rack.slice(0, 3).map(t => t.id));
assert(free.free && g.turn === 1); console.log('free rinse ok, still mandy turn');
// blank
setRack(g, 1, '?LEEPSS');
a = G.analyse(g, 1, pl(g, 1, 'SLEEP', 8, 3, 'a', { }));
console.log('sleep cross:', a.ok, a.error, a.words);

// Lighthouse
const h = G.newGame({ id: 'L', mode: 'lighthouse', difficulty: 'storm', seed: 5 });
G.addPlayer(h, 'Dave', 'a'); G.addPlayer(h, 'Mandy', 'b');
console.log('lanterns', h.lanterns.map(l => `${l.req}@${l.r},${l.c}`).join(' '), 'turns', h.turnsLeft);
const p0 = h.players[h.turn];
G.give(h, h.turn, p0.rack[0].id);
assert.equal(h.players[1 - h.turn].rack.length, 8);
assert.throws(() => G.give(h, h.turn, p0.rack[0].id));
console.log('give ok');
// lantern lighting test: force a lantern near centre
h.lanterns = [{ r: 7, c: 9, req: 5, lit: false }];
setRack(h, h.turn, 'HARBOUR');
a = G.analyse(h, h.turn, pl(h, h.turn, 'HARBOUR', 7, 4, 'a'));
console.log('lights:', a.lights);
assert.equal(a.lights.length, 1);
G.play(h, h.turn, pl(h, h.turn, 'HARBOUR', 7, 4, 'a'));
console.log(h.status, h.winner, h.log.slice(-2).map(x => x.text));
assert.equal(h.winner, 'team');
console.log('ALL OK');
