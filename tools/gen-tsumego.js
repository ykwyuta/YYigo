// いしとり問題の候補を作る：node tools/gen-tsumego.js [手数 1|3|5] [個数] [seed] [盤 7|9] > candidates.json
// ランダムな局面から、次の条件を満たすものだけを残す。
//  - ちょうど N 手で取れて、それより短くは取れない
//  - 本手順の くろの手が どれも ひとつだけ（ほかに正解がない）
//  - くろの石に むだがない（どれか1つを取り除くと N 手では取れない）
//  - しろの石（しるし以外）にも むだがない（どれか1つを取り除くと 手数か正解が かわる）
'use strict';
require('../js/rules.js');
require('../js/tsumego.js');
const E = globalThis.Engine, T = globalThis.Tsumego;
const [moves = '3', count = '10', seedArg = '1', sizeArg = '7'] = process.argv.slice(2);
const N = (+moves + 1) / 2, size = +sizeArg;
let seed = +seedArg >>> 0 || 1;
const rnd = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; };
const ri = n => (rnd() * n) | 0;
const g = E.geo(size);

function valid(board) {
  const { groups } = E.allGroups(board, size);
  for (const gr of groups) {
    if (gr.libs.length === 0) return false;
    if (gr.color === E.BLACK && gr.libs.length < 2) return false;
  }
  return true;
}
function check(board, target) {
  const S = new T.Solver(size, target);
  if (S.minLen(board, -1, N) !== N) return null;
  if (S.attack(board, -1, N - 1 || 1) && N > 1) return null;
  const sols = S.solutions(board, -1, N);
  if (sols.length !== 1) return null;
  if (!S.uniqueLines(board, -1, N)) return null;
  const ml = S.mainLine(board, -1, N);
  let b = board, ko = -1;
  for (let k = 0; k < ml.line.length; k++) {
    const m = ml.line[k];
    if (k % 2 === 0 && S.solutions(b, ko, N - k / 2).length !== 1) return null;
    if (k % 2 === 1 && m === E.PASS) return null;
    if (m === E.PASS) { ko = -1; continue; }
    const r = E.play(b, size, m, k % 2 ? E.WHITE : E.BLACK, ko);
    b = r.board; ko = r.ko;
  }
  return { first: sols[0], line: ml.line };
}

const out = [];
let tries = 0;
while (out.length < +count && tries < 200000) {
  tries++;
  const board = new Int8Array(g.n);
  // しるしの石（1〜3個のつながった石）
  const tn = 1 + ri(3);
  let p = ri(g.n);
  const target = [p];
  board[p] = E.WHITE;
  while (target.length < tn) {
    const q = target[ri(target.length)];
    const nb = g.nb[q].filter(r => !board[r]);
    if (!nb.length) break;
    const r = nb[ri(nb.length)];
    board[r] = E.WHITE; target.push(r);
  }
  const near = [];
  for (let q = 0; q < g.n; q++) {
    if (board[q]) continue;
    const x = q % size, y = (q / size) | 0;
    if (target.some(t => Math.max(Math.abs(t % size - x), Math.abs(((t / size) | 0) - y)) <= 2)) near.push(q);
  }
  const nb = 2 + ri(6), nw = ri(4);
  for (let k = 0; k < nb + nw && near.length; k++) {
    const i = ri(near.length);
    board[near[i]] = k < nb ? E.BLACK : E.WHITE;
    near.splice(i, 1);
  }
  if (!valid(board)) continue;
  const tg = E.groupAt(board, size, target[0]);
  if (N > 1 && tg.libs.length < 2) continue;
  const res = check(board, target);
  if (!res) continue;
  if (process.env.NET) {
    // 初手で アタリに しない問題（ゲタ など）だけ
    const r0 = E.play(board, size, res.first, E.BLACK, -1);
    if (E.groupAt(r0.board, size, target[0]).libs.length < 2) continue;
  }
  // むだな石がないか
  let redundant = false;
  for (let q = 0; q < g.n && !redundant; q++) {
    if (!board[q] || target.includes(q) || tg.stones.includes(q)) continue;
    const b2 = board.slice(); b2[q] = 0;
    if (!valid(b2)) continue;
    const S = new T.Solver(size, target);
    if (board[q] === E.BLACK) { if (S.attack(b2, -1, N)) redundant = true; }
    else {
      const r2 = check(b2, target);
      if (r2 && r2.first === res.first) redundant = true;
    }
  }
  if (redundant) continue;
  const rows = [];
  for (let y = 0; y < size; y++) {
    let s = '';
    for (let x = 0; x < size; x++) {
      const q = y * size + x;
      s += board[q] === E.BLACK ? 'X' : board[q] === E.WHITE ? (target.includes(q) ? 'T' : 'O') : '.';
    }
    rows.push(s);
  }
  out.push({ moves: +moves, rows, first: E.pointName(size, res.first), line: res.line.map((m, k) => (k % 2 ? '○' : '●') + E.pointName(size, m)).join(' ') });
  process.stderr.write(`found ${out.length} after ${tries} tries\n`);
}
console.log(JSON.stringify(out, null, 1));
