// いしとり もんだいの検証：node test/tsumego.test.js
// 全問について、ちょうど決められた手数で取れること・それより短くは取れないこと・
// 初手の正解がひとつで data の first と一致すること・本手順の くろの手が どれも ひとつに決まることを確かめる。
'use strict';
require('../js/rules.js');
require('../js/tsumego.js');
require('../js/tsumego-data.js');
const E = globalThis.Engine, T = globalThis.Tsumego, PROBS = globalThis.TSUMEGO_PROBLEMS;
const assert = require('assert');

assert.strictEqual(PROBS.length, 30, '30問');
const count = { 1: 0, 3: 0, 5: 0 };
const seen = new Set();
PROBS.forEach((pr, i) => {
  const tag = `第${i + 1}問「${pr.title}」`;
  count[pr.moves]++;
  const key = pr.rows.join('/');
  assert.ok(!seen.has(key), `${tag}：同じ問題がある`);
  seen.add(key);
  const { size, board, target } = T.parse(pr.rows);
  assert.ok(target.length > 0, `${tag}：しるしの石がない`);
  // しるしの石は ひとつの連（1手の「どれが とれる？」だけは いくつもの石に しるし）
  const g = E.groupAt(board, size, target[0]);
  if (pr.moves > 1) for (const t of target) assert.ok(g.stones.includes(t), `${tag}：しるしの石が ばらばら`);
  // いき が 0 の石はない
  for (const gr of E.allGroups(board, size).groups) assert.ok(gr.libs.length > 0, `${tag}：いき が ない石がある`);
  const n = (pr.moves + 1) / 2;
  const S = new T.Solver(size, target);
  assert.strictEqual(S.minLen(board, -1, n + 1), n, `${tag}：最短手数`);
  const sols = S.solutions(board, -1, n);
  assert.strictEqual(sols.length, 1, `${tag}：初手の正解がひとつではない`);
  assert.strictEqual(E.pointName(size, sols[0]), pr.first, `${tag}：初手`);
  assert.ok(S.uniqueLines(board, -1, n), `${tag}：本手順が ひとつに決まらない`);
  // 本手順をたどると、ちょうど取れる
  const ml = S.mainLine(board, -1, n);
  assert.strictEqual(ml.line.length, pr.moves, `${tag}：手順の長さ`);
  assert.ok(S.captured(ml.board), `${tag}：手順のさいごに取れていない`);
  // 解説に初手が書いてある
  assert.ok(pr.text.includes(pr.first), `${tag}：解説に初手がない`);
  // まちがえやすい手は 本当に にげられる
  for (const [a, d] of S.traps(board, n)) {
    const r = E.play(board, size, a, E.BLACK, -1);
    const w = d === E.PASS ? { board: r.board, ko: -1 } : E.play(r.board, size, d, E.WHITE, r.ko);
    assert.ok(!S.attack(w.board, w.ko, n - 1 || 1) || n === 1, `${tag}：まちがえやすい手 ${E.pointName(size, a)}`);
  }
});
assert.deepStrictEqual(count, { 1: 10, 3: 12, 5: 8 });
console.log(`all ${PROBS.length} problems OK (1手 ${count[1]}・3手 ${count[3]}・5手 ${count[5]})`);
