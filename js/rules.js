/*
 * いきがみえる囲碁 — ルールエンジン
 * 盤面状態は純粋なデータとして扱い、apply は常に新しい状態を返す。
 *
 * 座標：x は左から 0〜size-1、y は上から 0〜size-1。点 p = y * size + x。
 * 石：0 = なし、1 = くろ、2 = しろ。手番 turn は 0 = くろ、1 = しろ（石の色 = turn + 1）。
 * 指し手：点の番号。PASS（-1）はパス。
 * ルール：中国ルール（地＋盤上の石で数える）。自殺手は禁止、コウは同じ形にすぐ戻す手を禁止。
 * 「いしとり」ルール：さきに決めた数の石を取った方の勝ち（はじめての子ども向け）。
 */
(function (global) {
  'use strict';

  const PASS = -1;
  const RESUME = -2;   // 数える前に「つづきを うつ」（パスの回数を 0 にもどす）
  const EMPTY = 0, BLACK = 1, WHITE = 2;
  const SIZES = [7, 9, 13, 19];
  const KOMI = 6.5;

  const SIDES = [
    { name: 'くろ', kanji: '黒', mark: '●' },
    { name: 'しろ', kanji: '白', mark: '○' },
  ];

  // ---------- 盤の形（大きさごとに作っておく） ----------

  const geoCache = {};
  function geo(size) {
    if (geoCache[size]) return geoCache[size];
    const n = size * size;
    const nb = [];
    for (let p = 0; p < n; p++) {
      const x = p % size, y = (p / size) | 0, a = [];
      if (y > 0) a.push(p - size);
      if (x < size - 1) a.push(p + 1);
      if (y < size - 1) a.push(p + size);
      if (x > 0) a.push(p - 1);
      nb.push(a);
    }
    // 星（盤の目印）
    const e = size >= 13 ? 3 : 2, m = (size - 1) / 2, f = size - 1 - e;
    let stars = [[e, e], [f, e], [e, f], [f, f], [m, m]];
    if (size >= 19) stars = stars.concat([[e, m], [f, m], [m, e], [m, f]]);
    const g = { size, n, nb, stars: stars.map(([x, y]) => y * size + x), edge: e };
    geoCache[size] = g;
    return g;
  }

  // 置き石の位置（標準的な順番）
  function handicapPoints(size, k) {
    const g = geo(size);
    const e = g.edge, m = (size - 1) / 2, f = size - 1 - e;
    const P = (x, y) => y * size + x;
    const tr = P(f, e), bl = P(e, f), br = P(f, f), tl = P(e, e), c = P(m, m);
    const l = P(e, m), r = P(f, m), t = P(m, e), b = P(m, f);
    const big = size >= 13;
    const table = {
      2: [tr, bl], 3: [tr, bl, br], 4: [tr, bl, br, tl], 5: [tr, bl, br, tl, c],
      6: [tr, bl, br, tl, l, r], 7: [tr, bl, br, tl, l, r, c],
      8: [tr, bl, br, tl, l, r, t, b], 9: [tr, bl, br, tl, l, r, t, b, c],
    };
    if (k < 2) return [];
    if (!big) k = Math.min(k, 5);
    return table[Math.min(k, 9)];
  }
  function maxHandicap(size) { return size >= 13 ? 9 : 5; }

  // ---------- 石のかたまり（連）と いき（呼吸点） ----------

  // p をふくむ連の石と いき を返す
  function groupAt(board, size, p) {
    const g = geo(size);
    const col = board[p];
    const stones = [], libs = [];
    if (!col) return { stones, libs, color: 0 };
    const seen = new Uint8Array(g.n);
    const st = [p];
    seen[p] = 1;
    while (st.length) {
      const q = st.pop();
      stones.push(q);
      for (const r of g.nb[q]) {
        if (seen[r]) continue;
        const c = board[r];
        if (c === col) { seen[r] = 1; st.push(r); } else if (c === EMPTY) { seen[r] = 1; libs.push(r); }
      }
    }
    return { stones, libs, color: col };
  }

  // 盤上のすべての連（点 → 連の番号、連の一覧）
  function allGroups(board, size) {
    const g = geo(size);
    const id = new Int16Array(g.n).fill(-1);
    const groups = [];
    for (let p = 0; p < g.n; p++) {
      if (!board[p] || id[p] >= 0) continue;
      const gr = groupAt(board, size, p);
      for (const q of gr.stones) id[q] = groups.length;
      groups.push(gr);
    }
    return { id, groups };
  }

  // 低レベルの着手：成功すれば { board, captured: [点...], ko }、反則なら理由の文字列を返す
  // ko：コウで いま打てない点（なければ -1）
  function play(board, size, p, col, ko) {
    if (board[p] !== EMPTY) return 'occupied';
    if (p === ko) return 'ko';
    const g = geo(size);
    const b = board.slice();
    b[p] = col;
    const opp = 3 - col;
    const captured = [];
    for (const q of g.nb[p]) {
      if (b[q] !== opp) continue;
      const gr = groupAt(b, size, q);
      if (gr.libs.length === 0) for (const s of gr.stones) { b[s] = EMPTY; captured.push(s); }
    }
    const mine = groupAt(b, size, p);
    if (mine.libs.length === 0) return 'suicide';
    // 1つ取って、置いた石が1つだけで いき が1つ → 取られた点はすぐには取り返せない（コウ）
    let nko = -1;
    if (captured.length === 1 && mine.stones.length === 1 && mine.libs.length === 1) nko = captured[0];
    return { board: b, captured, ko: nko };
  }

  // 自分の「目」（まわりが全部自分の石で、ななめもおおむね自分の石）か
  function isEye(board, size, p, col) {
    if (board[p] !== EMPTY) return false;
    const g = geo(size);
    for (const q of g.nb[p]) if (board[q] !== col) return false;
    const x = p % size, y = (p / size) | 0;
    let bad = 0, edge = 0;
    for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= size || yy >= size) { edge = 1; continue; }
      if (board[yy * size + xx] === 3 - col) bad++;
    }
    return bad + edge < 2;
  }

  // ---------- ゲームの状態 ----------

  // opts: { size, handicap, rule: 'territory' | 'capture', goal }
  function newGame(opts) {
    opts = opts || {};
    const size = SIZES.includes(opts.size) ? opts.size : 9;
    const g = geo(size);
    const board = new Int8Array(g.n);
    const hc = Math.min(opts.handicap | 0, maxHandicap(size));
    const hpts = handicapPoints(size, hc);
    for (const p of hpts) board[p] = BLACK;
    const rule = opts.rule === 'capture' ? 'capture' : 'territory';
    return {
      size, rule,
      goal: rule === 'capture' ? Math.max(1, opts.goal | 0 || 3) : 0,
      handicap: hpts.length,
      komi: rule === 'capture' ? 0 : (hpts.length ? 0.5 : KOMI),
      board,
      turn: hpts.length ? 1 : 0,
      ko: -1,
      caps: [0, 0],       // 取った石の数（あげはま）
      passes: 0,
      ply: 0,
      last: null,         // { side, p, captured: [点...] }
      kifu: [],
      winner: null,       // null = 対局中、0/1 = 勝った方、-1 = 引き分け
      result: null,       // 'capture' | 'score' | 'resign' | 'limit'
      score: null,        // 数えた結果
      maxPly: size * size * 3,
    };
  }

  function clone(s) {
    return Object.assign({}, s, { board: s.board.slice(), caps: s.caps.slice(), kifu: s.kifu.slice() });
  }

  const KN = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九'];
  function pointName(size, p) {
    if (p === PASS) return 'パス';
    return `${(p % size) + 1}の${KN[(p / size) | 0]}`;
  }
  function moveText(s, p, side) {
    if (side === undefined) side = s.turn;
    return SIDES[side].mark + pointName(s.size, p);
  }

  // 反則の理由（打てるなら null）
  function illegalReason(s, p) {
    if (p === PASS) return null;
    const r = play(s.board, s.size, p, s.turn + 1, s.ko);
    return typeof r === 'string' ? r : null;
  }
  function isLegal(s, p) { return s.winner === null && illegalReason(s, p) === null; }

  function legalMoves(s) {
    if (s.winner !== null) return [];
    const out = [];
    for (let p = 0; p < s.board.length; p++) if (s.board[p] === EMPTY && illegalReason(s, p) === null) out.push(p);
    out.push(PASS);
    return out;
  }

  // その手を いま 打てるか（RESUME もふくむ）
  function canApply(s, p) {
    if (p === RESUME) return needsScoring(s);
    if (s.winner !== null || needsScoring(s)) return false;
    return p === PASS || (p >= 0 && p < s.board.length && illegalReason(s, p) === null);
  }

  function apply(s, p) {
    const side = s.turn;
    const n = clone(s);
    if (p === RESUME) {
      n.passes = 0;
      n.maxPly = Math.max(n.maxPly, n.ply + s.size * s.size);
      return n;
    }
    n.kifu.push(moveText(s, p, side));
    n.ply++;
    if (p === PASS) {
      n.passes++;
      n.ko = -1;
      n.last = { side, p: PASS, captured: [] };
    } else {
      const r = play(s.board, s.size, p, side + 1, s.ko);
      if (typeof r === 'string') throw new Error('illegal move: ' + r);
      n.board = r.board;
      n.ko = r.ko;
      n.caps[side] += r.captured.length;
      n.passes = 0;
      n.last = { side, p, captured: r.captured };
    }
    n.turn = 1 - side;
    if (n.rule === 'capture') {
      if (n.caps[side] >= n.goal) { n.winner = side; n.result = 'capture'; }
      else if (n.passes >= 2 || n.ply >= n.maxPly) {
        n.winner = n.caps[0] === n.caps[1] ? -1 : (n.caps[0] > n.caps[1] ? 0 : 1);
        n.result = 'limit';
      }
    }
    // ふつうのルールでは、2回つづけてパス → 数える（UI 側で死に石を決めてから finishScore）
    return n;
  }

  // 数える段階に入るか（ふつうのルールで2回パス、または手数の上限）
  function needsScoring(s) {
    return s.winner === null && s.rule === 'territory' && (s.passes >= 2 || s.ply >= s.maxPly);
  }

  function resign(s) {
    const n = clone(s);
    n.winner = 1 - s.turn;
    n.result = 'resign';
    return n;
  }

  // ---------- 数える（中国ルール：盤上の自分の石 ＋ 自分だけで囲んだ空き点） ----------

  // dead：死に石の点の集合（Set）。owner[p] = 0 なし / 1 くろ / 2 しろ
  function scoreBoard(board, size, dead, komi) {
    const g = geo(size);
    const b = board.slice();
    if (dead) for (const p of dead) b[p] = EMPTY;
    const owner = new Int8Array(g.n);
    const stones = [0, 0], terr = [0, 0];
    const seen = new Uint8Array(g.n);
    for (let p = 0; p < g.n; p++) {
      if (b[p]) { owner[p] = b[p]; stones[b[p] - 1]++; continue; }
      if (seen[p]) continue;
      const region = [], st = [p];
      let touch = 0;
      seen[p] = 1;
      while (st.length) {
        const q = st.pop();
        region.push(q);
        for (const r of g.nb[q]) {
          if (b[r]) touch |= b[r];
          else if (!seen[r]) { seen[r] = 1; st.push(r); }
        }
      }
      if (touch === 1 || touch === 2) {
        for (const q of region) owner[q] = touch;
        terr[touch - 1] += region.length;
      }
    }
    const total = [stones[0] + terr[0], stones[1] + terr[1] + (komi || 0)];
    return { owner, stones, terr, komi: komi || 0, total, deadCount: dead ? dead.size : 0 };
  }

  function finishScore(s, dead) {
    const n = clone(s);
    const sc = scoreBoard(s.board, s.size, dead, s.komi);
    n.score = sc;
    n.winner = sc.total[0] === sc.total[1] ? -1 : (sc.total[0] > sc.total[1] ? 0 : 1);
    n.result = 'score';
    n.dead = dead ? Array.from(dead) : [];
    return n;
  }

  function replay(opts, moves) {
    let s = newGame(opts);
    for (const m of moves) s = apply(s, m);
    return s;
  }

  global.Engine = {
    PASS, RESUME, EMPTY, BLACK, WHITE, SIZES, KOMI, SIDES,
    geo, handicapPoints, maxHandicap,
    groupAt, allGroups, play, isEye,
    newGame, clone, apply, resign, replay, legalMoves, isLegal, illegalReason, canApply,
    needsScoring, scoreBoard, finishScore,
    pointName, moveText,
  };
})(typeof window !== 'undefined' ? window : globalThis);
