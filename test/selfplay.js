// CPU 同士の自動対戦：node test/selfplay.js [くろの強さ] [しろの強さ] [局数] [盤の大きさ] [capture:N]
'use strict';
require('../js/rules.js');
require('../js/ai.js');
const E = globalThis.Engine, AI = globalThis.AI;
const [l0 = 'normal', l1 = 'easy', games = '2', size = '9', rule = ''] = process.argv.slice(2);
const goal = rule.startsWith('capture') ? +(rule.split(':')[1] || 3) : 0;
const tally = { 0: 0, 1: 0, '-1': 0 };
for (let g = 0; g < +games; g++) {
  let s = E.newGame({ size: +size, rule: goal ? 'capture' : 'territory', goal });
  let maxT = 0, totT = 0;
  while (s.winner === null && !E.needsScoring(s)) {
    const t0 = Date.now();
    const st = { size: s.size, board: s.board, turn: s.turn, ko: s.ko, caps: s.caps, rule: s.rule, goal: s.goal, komi: s.komi,
      last: s.last ? s.last.p : -1, lastPass: !!(s.last && s.last.p === E.PASS) };
    const m = AI.think(st, s.turn === 0 ? l0 : l1);
    const dt = Date.now() - t0;
    maxT = Math.max(maxT, dt); totT += dt;
    if (!E.legalMoves(s).includes(m)) throw new Error('illegal move from AI');
    s = E.apply(s, m);
  }
  if (E.needsScoring(s)) s = E.finishScore(s, new Set(AI.guessDead(s)));
  tally[s.winner]++;
  const sc = s.score ? ` score=${s.score.total.join('-')}` : ` caps=${s.caps.join('-')}`;
  console.log(`game ${g + 1}: winner=${s.winner} result=${s.result} ply=${s.ply}${sc} avg=${(totT / s.ply).toFixed(0)}ms max=${maxT}ms`);
  if (g === 0) console.log(s.kifu.slice(0, 40).join(' '));
}
console.log(`${l0}(くろ) ${tally[0]} - ${tally[1]} ${l1}(しろ)  引き分け ${tally[-1]}`);
