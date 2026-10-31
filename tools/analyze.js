// 問題の分析：node tools/analyze.js [ファイル（既定は js/tsumego-data.js）] [番号...]
// 各問題について、最短手数・初手の正解（ひとつだけか）・正解手順・読んだ局面の数を表示する
'use strict';
const path = require('path');
require('../js/rules.js');
require('../js/tsumego.js');
const E = globalThis.Engine, T = globalThis.Tsumego;
const file = process.argv[2] && !/^\d+$/.test(process.argv[2]) ? process.argv[2] : path.join(__dirname, '../js/tsumego-data.js');
require(path.resolve(file));
const probs = globalThis.TSUMEGO_PROBLEMS;
const only = process.argv.slice(2).filter(a => /^\d+$/.test(a)).map(a => +a - 1);
probs.forEach((pr, i) => {
  if (only.length && !only.includes(i)) return;
  const { size, board, target } = T.parse(pr.rows);
  const n = (pr.moves + 1) / 2;
  const S = new T.Solver(size, target);
  const t0 = Date.now();
  const len = S.minLen(board, -1, n + 1);
  const sols = S.solutions(board, -1, Math.min(len, n));
  const ml = S.mainLine(board, -1, Math.min(len, n));
  const name = p => E.pointName(size, p);
  const flags = [];
  if (len !== n) flags.push(`手数ちがい(最短${len === Infinity ? 'なし' : len * 2 - 1}手)`);
  if (sols.length !== 1) flags.push(`初手${sols.length}通り`);
  if (pr.first && sols.length && name(sols[0]) !== pr.first) flags.push(`正解ちがい(${pr.first})`);
  // 本手順のくろの手がどれも唯一か
  let b = board, ko = -1;
  for (let k = 0; k < ml.line.length; k++) {
    const m = ml.line[k];
    if (k % 2 === 0) {
      const left = n - k / 2;
      const s2 = S.solutions(b, ko, left);
      if (s2.length !== 1 && k > 0) flags.push(`${k + 1}手目が${s2.length}通り(${s2.map(name).join(',')})`);
    }
    if (m === E.PASS) { ko = -1; continue; }
    const r = E.play(b, size, m, k % 2 ? E.WHITE : E.BLACK, ko);
    b = r.board; ko = r.ko;
  }
  if (len === n && !S.uniqueLines(board, -1, n)) flags.push('しろの受けによって くろの正解が ふたつ');
  console.log(`${i + 1}. ${pr.title || ''} [${pr.moves}手] ${flags.length ? '★' + flags.join(' ') : 'OK'}  ` +
    `正解:${sols.map(name).join(',')}  手順:${ml.line.map((m, k) => (k % 2 ? '○' : '●') + name(m)).join(' ')}  (${S.nodes}局面 ${Date.now() - t0}ms)`);
});
