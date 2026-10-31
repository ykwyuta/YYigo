// ルールエンジンのテスト：node test/rules.test.js
'use strict';
require('../js/rules.js');
require('../js/ai.js');
const E = globalThis.Engine, AI = globalThis.AI;
const assert = require('assert');

// 文字で盤を作る（X = くろ、O = しろ、. = なし）
function pos(rows, turn) {
  const size = rows.length;
  const s = E.newGame({ size: E.SIZES.includes(size) ? size : 9 });
  assert.strictEqual(s.size, size);
  rows.forEach((r, y) => [...r].forEach((c, x) => { s.board[y * size + x] = c === 'X' ? 1 : c === 'O' ? 2 : 0; }));
  s.turn = turn || 0;
  return s;
}
const P = (s, x, y) => y * s.size + x;

// 取る
{
  const s = pos([
    '.......',
    '...X...',
    '..XO...',
    '...X...',
    '.......',
    '.......',
    '.......',
  ]);
  const n = E.apply(s, P(s, 4, 2));
  assert.strictEqual(n.board[P(s, 3, 2)], 0, 'しろが取られる');
  assert.strictEqual(n.caps[0], 1);
  assert.deepStrictEqual(n.last.captured, [P(s, 3, 2)]);
  console.log('capture OK');
}

// 自殺手は打てない。ただし取れるなら打てる
{
  const s = pos([
    '.X.....',
    'X......',
    '.......',
    '.......',
    '.......',
    '.......',
    '.......',
  ], 1);
  assert.strictEqual(E.illegalReason(s, 0), 'suicide');
  const t = pos([
    '.O.....',
    'O......',
    '.......',
    '.......',
    '.......',
    '.......',
    '.......',
  ], 0);
  assert.strictEqual(E.illegalReason(t, 0), 'suicide', 'くろが1つの目に入るのは自殺');
  const u = pos([
    '.XO....',
    'XO.....',
    'O......',
    '.......',
    '.......',
    '.......',
    '.......',
  ], 1);
  assert.strictEqual(E.illegalReason(u, 0), null, '取れるなら打てる');
  console.log('suicide OK');
}

// コウ
{
  const s = pos([
    '.......',
    '..XO...',
    '.X.XO..',
    '..XO...',
    '.......',
    '.......',
    '.......',
  ], 1);
  const a = E.apply(s, P(s, 2, 2)); // しろが取る
  assert.strictEqual(a.caps[1], 1);
  assert.strictEqual(a.ko, P(s, 3, 2));
  assert.strictEqual(E.illegalReason(a, P(s, 3, 2)), 'ko', 'すぐには取り返せない');
  const b = E.apply(E.apply(a, P(s, 5, 5)), P(s, 0, 6));
  assert.strictEqual(E.illegalReason(b, P(s, 3, 2)), null, '1手あけば取り返せる');
  console.log('ko OK');
}

// 置き石
{
  const s = E.newGame({ size: 9, handicap: 3 });
  assert.strictEqual(s.board.filter(c => c === 1).length, 3);
  assert.strictEqual(s.turn, 1, '置き碁は しろ から');
  assert.strictEqual(s.komi, 0.5);
  const t = E.newGame({ size: 19, handicap: 9 });
  assert.strictEqual(t.board.filter(c => c === 1).length, 9);
  console.log('handicap OK');
}

// 数える
{
  const s = pos([
    '..XO...',
    '..XO...',
    '..XO...',
    '..XO...',
    '..XO...',
    '..XO.X.',
    '..XO...',
  ]);
  const sc = E.scoreBoard(s.board, 7, new Set(), 0);
  assert.deepStrictEqual(sc.stones, [8, 7]);
  assert.deepStrictEqual(sc.terr, [14, 0], 'しろの地に くろの石が1つ → しろの地は数えない');
  const sc2 = E.scoreBoard(s.board, 7, new Set([P(s, 5, 5)]), 6.5);
  assert.deepStrictEqual(sc2.terr, [14, 21]);
  assert.strictEqual(sc2.total[1], 28 + 6.5);
  console.log('score OK');
}

// いしとりルール
{
  let s = E.newGame({ size: 7, rule: 'capture', goal: 1 });
  for (const [x, y] of [[3, 2], [3, 3], [2, 3], [0, 0], [4, 3], [0, 1], [3, 4]]) s = E.apply(s, P(s, x, y));
  assert.strictEqual(s.winner, 0);
  assert.strictEqual(s.result, 'capture');
  console.log('capture rule OK');
}

// 高速な盤（AI 用）が、ルールエンジンと同じ結果になるか（ランダムな対局で比べる）
{
  let rs = 1;
  const rnd = () => ((rs = (rs * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  let games = 0, plies = 0;
  for (const size of [7, 9, 13]) {
    for (let g = 0; g < 12; g++) {
      let s = E.newGame({ size });
      const B = new AI.FastBoard(size);
      for (let k = 0; k < size * size * 2; k++) {
        const col = s.turn + 1;
        // 打てる手の一覧が一致する
        for (let p = 0; p < size * size; p++) {
          const a = E.illegalReason(s, p) === null;
          const b = B.isLegal(B.fromEngine(p), col);
          if (a !== b) throw new Error(`legal mismatch size=${size} g=${g} k=${k} p=${p} engine=${a} fast=${b}`);
        }
        const legal = E.legalMoves(s).filter(p => p !== E.PASS && !E.isEye(s.board, size, p, col));
        if (!legal.length) break;
        const p = legal[(rnd() * legal.length) | 0];
        s = E.apply(s, p);
        B.place(B.fromEngine(p), col);
        plies++;
        for (let q = 0; q < size * size; q++) assert.strictEqual(B.c[B.fromEngine(q)], s.board[q], 'board mismatch');
        assert.strictEqual(B.toEngine(B.ko) === E.PASS ? -1 : B.toEngine(B.ko), s.ko, 'ko mismatch');
        assert.deepStrictEqual(B.caps, s.caps);
      }
      games++;
    }
  }
  console.log(`fastboard matches engine (${games} games, ${plies} plies) OK`);
}

// CPU は打てる手を返す。取れる石は「はじめて」でも取る
{
  const s = pos([
    '.......',
    '...X...',
    '..XO...',
    '...X...',
    '.......',
    '.......',
    '.......',
  ]);
  const st = { size: 7, board: s.board, turn: 0, ko: -1, caps: [0, 0], rule: 'capture', goal: 1, komi: 0, last: -1 };
  assert.strictEqual(AI.think(st, 'beginner', 1), P(s, 4, 2));
  assert.strictEqual(AI.think(st, 'normal', 1), P(s, 4, 2));
  console.log('ai capture OK');
}

// 死に石の推定：しろの地の中の くろ1つは死に石
{
  const s = pos([
    '..XO...',
    '..XO...',
    '..XO...',
    '..XO...',
    '..XO...',
    '..XO.X.',
    '..XO...',
  ]);
  s.komi = 6.5;
  const dead = AI.guessDead(s);
  assert.deepStrictEqual(dead, [P(s, 5, 5)]);
  console.log('dead stones OK');
}
console.log('all rules tests passed');
