/*
 * いきがみえる囲碁 — 「いしとり もんだい」のソルバー
 * くろ（攻め方）が、決められた手数のうちに しるしのついた しろの石を取れるかを読み切る。
 * しろ（受け方）は いちばん長く生きのびる手を選ぶ（パス＝ほかの所に打つ、もふくむ）。
 *
 * 読む範囲：しるしの石のまわり（2マス以内）の空き点と、そのまわりで いき が少ない くろの石の いき。
 * n は「くろが打てる残りの回数」。1手問題なら n = 1、3手なら 2、5手なら 3。
 */
(function (global) {
  'use strict';
  const E = global.Engine;
  const PASS = E.PASS;

  function Solver(size, target) {
    this.size = size;
    this.target = target;       // しるしの石の点
    this.memo = new Map();
    this.nodes = 0;
  }

  // しるしの石のどれかが取られたか
  Solver.prototype.captured = function (b) {
    for (const p of this.target) if (b[p] !== E.WHITE) return true;
    return false;
  };

  // 読む候補の点。forWhite なら しろ用（くろの石を取りにいく手もふくむ）
  Solver.prototype.cands = function (b, forWhite) {
    const size = this.size, g = E.geo(size);
    const tg = new Set();
    for (const p of this.target) if (b[p] === E.WHITE) for (const s of E.groupAt(b, size, p).stones) tg.add(s);
    const libs = new Set();
    for (const s of tg) for (const q of g.nb[s]) if (!b[q]) libs.add(q);
    const near = new Set();
    const tgx = [...tg].map(s => [s % size, (s / size) | 0]);
    for (let p = 0; p < g.n; p++) {
      if (b[p] || libs.has(p)) continue;
      const x = p % size, y = (p / size) | 0;
      for (const [sx, sy] of tgx) if (Math.abs(sx - x) + Math.abs(sy - y) <= 2) { near.add(p); break; }
    }
    // しるしの石に となりあう くろの連で、いき が少ないものの いき
    const weak = new Set();
    const seen = new Set();
    for (const s of tg) for (const q of g.nb[s]) {
      if (b[q] !== E.BLACK || seen.has(q)) continue;
      const gr = E.groupAt(b, size, q);
      for (const t of gr.stones) seen.add(t);
      if (gr.libs.length <= (forWhite ? 2 : 1)) for (const l of gr.libs) if (!libs.has(l)) weak.add(l);
    }
    const out = [...libs];
    for (const p of weak) if (!near.has(p)) out.push(p);
    for (const p of near) out.push(p);
    return out;
  };

  Solver.prototype.key = function (b, ko, n, side) {
    return side + ':' + n + ':' + ko + ':' + b.join('');
  };

  // くろの番：n 回以内に取れるか
  Solver.prototype.attack = function (b, ko, n) {
    const k = this.key(b, ko, n, 0);
    const hit = this.memo.get(k);
    if (hit !== undefined) return hit;
    this.nodes++;
    let ok = false;
    for (const m of this.cands(b, false)) {
      const r = E.play(b, this.size, m, E.BLACK, ko);
      if (typeof r === 'string') continue;
      if (this.captured(r.board)) { ok = true; break; }
      if (n > 1 && this.defendFails(r.board, r.ko, n - 1)) { ok = true; break; }
    }
    this.memo.set(k, ok);
    return ok;
  };

  // しろの番：どう受けても n 回以内に取られるか
  Solver.prototype.defendFails = function (b, ko, n) {
    const k = this.key(b, ko, n, 1);
    const hit = this.memo.get(k);
    if (hit !== undefined) return hit;
    this.nodes++;
    let fails = true;
    for (const w of this.defenses(b, ko)) {
      if (!this.attack(w.board, w.ko, n)) { fails = false; break; }
    }
    this.memo.set(k, fails);
    return fails;
  };

  // しろの受けの一覧（パスもふくむ）：[{ move, board, ko }]
  Solver.prototype.defenses = function (b, ko) {
    const out = [];
    for (const m of this.cands(b, true)) {
      const r = E.play(b, this.size, m, E.WHITE, ko);
      if (typeof r === 'string') continue;
      out.push({ move: m, board: r.board, ko: r.ko });
    }
    out.push({ move: PASS, board: b, ko: -1 });
    return out;
  };

  // いちばん少ない回数（nMax 回以内で取れなければ Infinity）
  Solver.prototype.minLen = function (b, ko, nMax) {
    for (let n = 1; n <= nMax; n++) if (this.attack(b, ko, n)) return n;
    return Infinity;
  };

  // くろの正解手の一覧（n 回以内に取れる手）
  Solver.prototype.solutions = function (b, ko, n) {
    const out = [];
    for (const m of this.cands(b, false)) {
      const r = E.play(b, this.size, m, E.BLACK, ko);
      if (typeof r === 'string') continue;
      if (this.captured(r.board) || (n > 1 && this.defendFails(r.board, r.ko, n - 1))) out.push(m);
    }
    return out;
  };

  // しろの いちばん しぶとい受け。n = くろの残りの回数。{ move, len }
  // しろの受けの分類（同じ長さなら小さい方を選ぶ）：0 いき に のびる / 1 くろの石を アタリにする・取る / 2 パス / 3 そのほか
  Solver.prototype.defenseKind = function (b, w) {
    if (w.move === PASS) return 2;
    const g = E.geo(this.size);
    for (const q of g.nb[w.move]) if (this.target.includes(q) || (b[q] === E.WHITE && E.groupAt(b, this.size, q).stones.some(s => this.target.includes(s)))) return 0;
    for (const q of g.nb[w.move]) if (w.board[q] === E.BLACK && E.groupAt(w.board, this.size, q).libs.length <= 1) return 1;
    if (w.board.some((c, i) => b[i] === E.BLACK && c === E.EMPTY)) return 1;
    return 3;
  };

  // しろの いちばん しぶとい受け。n = くろの残りの回数。{ move, len }
  Solver.prototype.bestDefense = function (b, ko, n) {
    let best = null;
    for (const w of this.defenses(b, ko)) {
      const len = this.minLen(w.board, w.ko, n);
      const kind = this.defenseKind(b, w);
      if (!best || len > best.len || (len === best.len && kind < best.kind)) best = { move: w.move, len, kind };
    }
    return { move: best.move, len: best.len };
  };

  // 本手順が ひとつに決まるか：しろが どの「いちばん しぶとい受け」（自然な受け）を選んでも、くろの正解は いつも ひとつ
  Solver.prototype.uniqueLines = function (b, ko, n) {
    const sols = this.solutions(b, ko, n);
    if (sols.length !== 1) return false;
    const r = E.play(b, this.size, sols[0], E.BLACK, ko);
    if (this.captured(r.board)) return true;
    let maxLen = 0;
    const ws = [];
    for (const w of this.defenses(r.board, r.ko)) {
      const len = this.minLen(w.board, w.ko, n - 1);
      if (len > maxLen) { maxLen = len; ws.length = 0; }
      if (len === maxLen) ws.push(w);
    }
    if (maxLen === Infinity) return false;
    // しろが選びそうな受け（いき に のびる・くろを アタリにする）だけを見る。どれもなければ パスなど
    const kinds = ws.map(w => Math.min(this.defenseKind(r.board, w), 2));
    const k0 = Math.min(...kinds);
    return ws.every((w, i) => kinds[i] !== k0 || this.uniqueLines(w.board, w.ko, maxLen));
  };

  // まちがえやすい手：しるしの石の いき に おいて アタリに したのに、にげられてしまう手と しろの逃げ方
  Solver.prototype.traps = function (b, n) {
    const out = [];
    const sols = new Set(this.solutions(b, -1, n));
    const libs = new Set();
    for (const p of this.target) if (b[p] === E.WHITE) for (const l of E.groupAt(b, this.size, p).libs) libs.add(l);
    for (const m of libs) {
      if (sols.has(m)) continue;
      const r = E.play(b, this.size, m, E.BLACK, -1);
      if (typeof r === 'string') continue;
      const d = this.bestDefense(r.board, r.ko, n - 1);
      if (d) out.push([m, d.move]);
    }
    return out;
  };

  // 正解手順（くろは最短の手、しろはいちばん しぶとい受け）
  Solver.prototype.mainLine = function (b, ko, n) {
    const line = [];
    let cur = b, curKo = ko;
    for (let left = n; left >= 1; left--) {
      let pick = null;
      for (const m of this.solutions(cur, curKo, left)) {
        const r = E.play(cur, this.size, m, E.BLACK, curKo);
        const len = this.captured(r.board) ? 0 : this.bestDefense(r.board, r.ko, left - 1).len;
        if (!pick || len < pick.len) pick = { m, r, len };
      }
      if (!pick) break;
      line.push(pick.m);
      cur = pick.r.board; curKo = pick.r.ko;
      if (this.captured(cur)) break;
      const d = this.bestDefense(cur, curKo, left - 1);
      line.push(d.move);
      if (d.move !== PASS) { const r = E.play(cur, this.size, d.move, E.WHITE, curKo); cur = r.board; curKo = r.ko; } else curKo = -1;
    }
    return { line, board: cur };
  };

  // 問題の文字列から局面を作る（X くろ、O しろ、T しるしの しろ、. なし）
  function parse(rows) {
    const size = rows.length;
    const board = new Int8Array(size * size);
    const target = [];
    rows.forEach((r, y) => [...r].forEach((c, x) => {
      const p = y * size + x;
      if (c === 'X') board[p] = E.BLACK;
      else if (c === 'O') board[p] = E.WHITE;
      else if (c === 'T') { board[p] = E.WHITE; target.push(p); }
    }));
    return { size, board, target };
  }

  global.Tsumego = { Solver, parse };
})(typeof window !== 'undefined' ? window : globalThis);
