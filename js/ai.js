/*
 * いきがみえる囲碁 — CPU 思考ルーチン
 * モンテカルロ木探索（UCT + RAVE）。最後までランダムに打ってみる「プレイアウト」をたくさん繰り返し、
 * 勝ちやすい手を選ぶ。制限時間で打ち切るので、スマホでも固まらない。
 * 高速化のため、探索では周りに枠をつけた盤（FastBoard）と「疑似呼吸点」で連を管理する。
 */
(function (global) {
  'use strict';
  const E = global.Engine;
  const PASS = E.PASS;

  // ---------- 高速な盤 ----------

  function FastBoard(size) {
    const W = size + 2, N = W * W;
    this.size = size; this.W = W; this.N = N;
    this.c = new Uint8Array(N);          // 0 空き / 1 くろ / 2 しろ / 3 枠
    this.head = new Int16Array(N);       // 連の代表の点
    this.nxt = new Int16Array(N);        // 連の石をつなぐ輪
    this.plib = new Int32Array(N);       // 疑似呼吸点の数（代表の点だけ使う）
    this.lsum = new Float64Array(N);     // 疑似呼吸点の番号の和
    this.lsq = new Float64Array(N);      // 疑似呼吸点の番号の2乗の和
    this.csz = new Int16Array(N);        // 連の石の数
    this.emp = new Int16Array(N);        // 空き点の一覧
    this.epos = new Int16Array(N);       // 空き点 → 一覧の位置
    this.ne = 0;
    this.ko = 0;
    this.caps = [0, 0];
    this.nb = [-W, 1, W, -1];
    this.dg = [-W - 1, -W + 1, W - 1, W + 1];
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
      const p = y * W + x;
      if (x === 0 || y === 0 || x === W - 1 || y === W - 1) this.c[p] = 3;
      else { this.epos[p] = this.ne; this.emp[this.ne++] = p; }
    }
  }
  FastBoard.prototype.copyFrom = function (o) {
    this.c.set(o.c); this.head.set(o.head); this.nxt.set(o.nxt); this.plib.set(o.plib);
    this.lsum.set(o.lsum); this.lsq.set(o.lsq); this.csz.set(o.csz);
    this.emp.set(o.emp); this.epos.set(o.epos); this.ne = o.ne; this.ko = o.ko;
    this.caps[0] = o.caps[0]; this.caps[1] = o.caps[1];
  };
  FastBoard.prototype.fromXY = function (x, y) { return (y + 1) * this.W + x + 1; };
  FastBoard.prototype.toEngine = function (q) {
    if (q === PASS || q <= 0) return PASS;
    const W = this.W;
    return (((q / W) | 0) - 1) * this.size + (q % W) - 1;
  };
  FastBoard.prototype.fromEngine = function (p) {
    if (p === PASS || p < 0) return 0;
    return this.fromXY(p % this.size, (p / this.size) | 0);
  };
  FastBoard.prototype.inAtari = function (h) {
    const n = this.plib[h];
    return n > 0 && n * this.lsq[h] === this.lsum[h] * this.lsum[h];
  };
  FastBoard.prototype.atariLib = function (h) { return this.lsum[h] / this.plib[h]; };
  FastBoard.prototype.removeEmpty = function (p) {
    const i = this.epos[p], last = this.emp[--this.ne];
    this.emp[i] = last; this.epos[last] = i;
  };
  FastBoard.prototype.addEmpty = function (p) {
    this.epos[p] = this.ne; this.emp[this.ne++] = p;
  };
  FastBoard.prototype.isLegal = function (p, col) {
    const c = this.c;
    if (c[p] !== 0 || p === this.ko) return false;
    for (let i = 0; i < 4; i++) {
      const q = p + this.nb[i], cq = c[q];
      if (cq === 0) return true;
      if (cq === 3) continue;
      const h = this.head[q];
      if (cq === col) { if (!this.inAtari(h)) return true; } else if (this.inAtari(h)) return true;
    }
    return false;
  };
  FastBoard.prototype.isEye = function (p, col) {
    const c = this.c;
    for (let i = 0; i < 4; i++) { const v = c[p + this.nb[i]]; if (v !== col && v !== 3) return false; }
    let bad = 0, edge = 0;
    for (let i = 0; i < 4; i++) { const v = c[p + this.dg[i]]; if (v === 3) edge = 1; else if (v === 3 - col) bad++; }
    return bad + edge < 2;
  };
  FastBoard.prototype.merge = function (a, b) {
    if (this.csz[a] < this.csz[b]) { const t = a; a = b; b = t; }
    let s = b;
    do { this.head[s] = a; s = this.nxt[s]; } while (s !== b);
    const t = this.nxt[a]; this.nxt[a] = this.nxt[b]; this.nxt[b] = t;
    this.csz[a] += this.csz[b]; this.plib[a] += this.plib[b];
    this.lsum[a] += this.lsum[b]; this.lsq[a] += this.lsq[b];
    return a;
  };
  FastBoard.prototype.removeChain = function (h) {
    const c = this.c;
    let s = h, n = 0;
    do { c[s] = 0; this.addEmpty(s); n++; s = this.nxt[s]; } while (s !== h);
    s = h;
    do {
      for (let i = 0; i < 4; i++) {
        const q = s + this.nb[i], cq = c[q];
        if (cq === 1 || cq === 2) { const g = this.head[q]; this.plib[g]++; this.lsum[g] += s; this.lsq[g] += s * s; }
      }
      s = this.nxt[s];
    } while (s !== h);
    return n;
  };
  // 打つ（打てる手であることは呼び出し側で確かめておく）。取った石の数を返す
  FastBoard.prototype.place = function (p, col) {
    const c = this.c, nb = this.nb;
    this.ko = 0;
    if (p === 0) return 0; // パス
    c[p] = col;
    this.removeEmpty(p);
    this.head[p] = p; this.nxt[p] = p; this.csz[p] = 1;
    this.plib[p] = 0; this.lsum[p] = 0; this.lsq[p] = 0;
    for (let i = 0; i < 4; i++) {
      const q = p + nb[i], cq = c[q];
      if (cq === 0) { this.plib[p]++; this.lsum[p] += q; this.lsq[p] += q * q; }
      else if (cq !== 3) { const h = this.head[q]; this.plib[h]--; this.lsum[h] -= p; this.lsq[h] -= p * p; }
    }
    let h = p;
    for (let i = 0; i < 4; i++) {
      const q = p + nb[i];
      if (c[q] === col && this.head[q] !== h) h = this.merge(h, this.head[q]);
    }
    const opp = 3 - col;
    let cap = 0, capP = 0;
    for (let i = 0; i < 4; i++) {
      const q = p + nb[i];
      if (c[q] === opp && this.plib[this.head[q]] === 0) { cap += this.removeChain(this.head[q]); capP = q; }
    }
    if (cap) this.caps[col - 1] += cap;
    h = this.head[p];
    if (cap === 1 && this.csz[h] === 1 && this.plib[h] === 1) this.ko = capP;
    return cap;
  };
  FastBoard.prototype.load = function (board, ko, caps) {
    const size = this.size;
    for (let i = 0; i < board.length; i++) if (board[i]) this.place(this.fromXY(i % size, (i / size) | 0), board[i]);
    this.ko = ko >= 0 ? this.fromEngine(ko) : 0;
    this.caps[0] = caps ? caps[0] : 0; this.caps[1] = caps ? caps[1] : 0;
  };
  // 終局の形での 黒 - 白（盤上の石 ＋ 片方の石だけに囲まれた空き点）
  FastBoard.prototype.area = function (own) {
    const c = this.c, W = this.W, nb = this.nb;
    let sc = 0;
    for (let y = 1; y <= this.size; y++) for (let x = 1; x <= this.size; x++) {
      const p = y * W + x;
      let o = c[p];
      if (o === 0) {
        let m = 0;
        for (let i = 0; i < 4; i++) m |= c[p + nb[i]];
        m &= 3;
        o = m === 1 ? 1 : m === 2 ? 2 : 0;
      }
      if (o === 1) { sc++; if (own) own[p]++; } else if (o === 2) { sc--; if (own) own[p]--; }
    }
    return sc;
  };

  // ---------- プレイアウト（最後までそれらしく打ってみる） ----------

  // 直前の手のまわりで、取れる石があれば取る・アタリの石を逃げる
  function tactical(B, col, last) {
    if (!last) return 0;
    const c = B.c, nb = B.nb;
    for (let i = 0; i < 4; i++) {
      const q = last + nb[i];
      const cq = c[q];
      if (cq !== 1 && cq !== 2) continue;
      const h = B.head[q];
      if (!B.inAtari(h)) continue;
      const lib = B.atariLib(h);
      if (B.isLegal(lib, col)) return lib; // 取る（相手の石）か逃げる（自分の石）
    }
    const cl = c[last];
    if (cl === 3 - col) {
      const h = B.head[last];
      if (B.inAtari(h)) { const lib = B.atariLib(h); if (B.isLegal(lib, col)) return lib; }
    }
    return 0;
  }

  function randomMove(B, col, rnd) {
    const n = B.ne;
    if (!n) return 0;
    let i = (rnd() * n) | 0;
    for (let k = 0; k < n; k++, i = (i + 1) % n) {
      const p = B.emp[i];
      if (B.isLegal(p, col) && !B.isEye(p, col) && !selfAtariBig(B, p, col)) return p;
    }
    return 0;
  }

  // 3つ以上の石をアタリにしてしまう手（ほぼ悪手）
  function selfAtariBig(B, p, col) {
    const c = B.c, nb = B.nb;
    let libs = 0, stones = 1, cap = false;
    const seen = [];
    for (let i = 0; i < 4; i++) {
      const q = p + nb[i], cq = c[q];
      if (cq === 0) { libs++; if (libs >= 2) return false; continue; }
      if (cq === 3) continue;
      const h = B.head[q];
      if (cq === col) {
        if (seen.indexOf(h) >= 0) continue;
        seen.push(h);
        if (!B.inAtari(h)) return false;
        stones += B.csz[h];
      } else if (B.inAtari(h)) cap = true;
    }
    return !cap && stones >= 3;
  }

  // col の番から最後まで打つ。勝った色（1/2）を返す。rec[p] = 最初に p に打った色
  function playout(B, col, opts, rnd, rec, lastP) {
    let passes = 0, moves = 0;
    const limit = B.size * B.size * 2;
    let last = lastP;
    while (passes < 2 && moves < limit) {
      let p = 0;
      if (rnd() < 0.9) p = tactical(B, col, last);
      if (!p) p = randomMove(B, col, rnd);
      if (p) {
        if (rec && !rec[p]) rec[p] = col;
        B.place(p, col);
        passes = 0;
        if (opts.goal && B.caps[col - 1] >= opts.goal) return col;
      } else { B.place(0, col); passes++; }
      last = p;
      col = 3 - col;
      moves++;
    }
    if (opts.goal) {
      if (B.caps[0] !== B.caps[1]) return B.caps[0] > B.caps[1] ? 1 : 2;
    }
    const sc = B.area(opts.own) - (opts.komi || 0);
    return sc > 0 ? 1 : 2;
  }

  // ---------- 木探索（UCT + RAVE） ----------

  function Node(col) {
    this.col = col;   // この局面で打つ色
    this.moves = null; this.n = null; this.w = null; this.rn = null; this.rw = null; this.kids = null;
    this.visits = 0;
  }

  // 有望そうな手には最初からおまけの勝ち点を与える（探索の効率化）
  function expand(node, B, last) {
    const col = node.col, list = [];
    for (let i = 0; i < B.ne; i++) {
      const p = B.emp[i];
      if (B.isLegal(p, col) && !B.isEye(p, col)) list.push(p);
    }
    const k = list.length;
    node.moves = Int16Array.from(list);
    node.n = new Float64Array(k); node.w = new Float64Array(k);
    node.rn = new Float64Array(k); node.rw = new Float64Array(k);
    node.kids = new Array(k).fill(null);
    const tac = tactical(B, col, last);
    const W = B.W, size = B.size;
    for (let i = 0; i < k; i++) {
      const p = list[i];
      const x = p % W - 1, y = ((p / W) | 0) - 1;
      const line = Math.min(x, y, size - 1 - x, size - 1 - y);
      let prior = 0.5;
      if (p === tac) prior = 0.95;
      else if (selfAtariBig(B, p, col)) prior = 0.1;
      else if (line === 0) prior = 0.3;
      else if (last && Math.abs(p % W - last % W) + Math.abs(((p / W) | 0) - ((last / W) | 0)) <= 2) prior = 0.6;
      node.rn[i] = 20; node.rw[i] = 20 * prior;
      node.n[i] = 0; node.w[i] = 0;
    }
  }

  function select(node) {
    let best = -1, bv = -Infinity;
    const lnN = Math.log(node.visits + 1);
    for (let i = 0; i < node.moves.length; i++) {
      const n = node.n[i], rn = node.rn[i];
      const amaf = node.rw[i] / rn;
      let v;
      if (n === 0) v = amaf + 0.2;
      else {
        const q = node.w[i] / n;
        const beta = rn / (n + rn + n * rn * 0.0025);
        v = (1 - beta) * q + beta * amaf + 0.1 * Math.sqrt(lnN / n);
      }
      if (v > bv) { bv = v; best = i; }
    }
    return best;
  }

  function makeRng(seed) {
    let s = seed >>> 0 || 0x9e3779b9;
    return () => {
      s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
  }

  // 局面 st から MCTS。{ root, own（盤ごとの所有の合計）, playouts } を返す
  function search(st, timeMs, maxPlayouts, rnd) {
    const size = st.size;
    const base = new FastBoard(size);
    base.load(st.board, st.ko, st.caps);
    const col0 = st.turn + 1;
    const root = new Node(col0);
    const lastQ = st.last >= 0 ? base.fromEngine(st.last) : 0;
    expand(root, base, lastQ);
    const B = new FastBoard(size);
    const own = new Float64Array(base.N);
    const rec = new Uint8Array(base.N);
    const opts = { komi: st.komi, goal: st.rule === 'capture' ? st.goal : 0, own };
    const t0 = Date.now();
    let n = 0;
    const path = [], idx = [];
    while (n < maxPlayouts) {
      if ((n & 31) === 0 && Date.now() - t0 > timeMs && n >= 32) break;
      B.copyFrom(base);
      rec.fill(0);
      path.length = 0; idx.length = 0;
      let node = root, last = lastQ, winner = 0;
      // 木の中を下りる
      while (true) {
        path.push(node);
        if (!node.moves.length) { idx.push(-1); break; }
        const i = select(node);
        idx.push(i);
        const p = node.moves[i];
        if (!rec[p]) rec[p] = node.col;
        B.place(p, node.col);
        last = p;
        if (opts.goal && B.caps[node.col - 1] >= opts.goal) { winner = node.col; break; }
        if (!node.kids[i]) {
          if (node.n[i] >= 1) { node.kids[i] = new Node(3 - node.col); expand(node.kids[i], B, last); node = node.kids[i]; continue; }
          break;
        }
        node = node.kids[i];
      }
      const lastNode = path[path.length - 1];
      if (!winner) {
        const nextCol = idx[idx.length - 1] < 0 ? lastNode.col : 3 - lastNode.col;
        winner = playout(B, nextCol, opts, rnd, rec, last);
      }
      // 結果を木に戻す
      for (let k = 0; k < path.length; k++) {
        const nd = path[k], i = idx[k];
        nd.visits++;
        const win = winner === nd.col ? 1 : 0;
        if (i >= 0) { nd.n[i]++; nd.w[i] += win; }
        for (let j = 0; j < nd.moves.length; j++) {
          if (rec[nd.moves[j]] === nd.col) { nd.rn[j]++; nd.rw[j] += win; }
        }
      }
      n++;
    }
    return { root, own, playouts: n, base };
  }

  // ---------- 形勢・死に石 ----------

  // 盤の各点が どちらのものになりそうか（+1 くろ 〜 -1 しろ）
  function ownership(st, playouts) {
    const size = st.size;
    const base = new FastBoard(size);
    base.load(st.board, st.ko, st.caps);
    const B = new FastBoard(size);
    const own = new Float64Array(base.N);
    const rnd = makeRng(12345);
    const n = playouts || 600;
    const opts = { komi: st.komi, goal: 0, own };
    for (let i = 0; i < n; i++) {
      B.copyFrom(base);
      playout(B, st.turn + 1, opts, rnd, null, 0);
    }
    const out = new Float64Array(size * size);
    for (let p = 0; p < out.length; p++) out[p] = own[base.fromEngine(p)] / n;
    return out;
  }

  // 死んでいそうな石（その連の点が、たいてい相手のものになる）
  function guessDead(st, own) {
    own = own || ownership(st, 600);
    const { groups } = E.allGroups(st.board, st.size);
    const dead = [];
    for (const g of groups) {
      let sum = 0;
      for (const p of g.stones) sum += own[p];
      const avg = sum / g.stones.length * (g.color === 1 ? 1 : -1);
      if (avg < -0.3) dead.push(...g.stones);
    }
    return dead;
  }

  // ---------- 手を選ぶ ----------

  // margin：最多訪問の手からこの割合以上 訪問された手からランダムに選ぶ（手加減）
  // blunder：この確率で、まったく適当な手を打つ
  // captures：取れる石があれば必ず取る（はじめて向け）
  const LEVELS = {
    beginner: { time: 150, max: 400, margin: 0.3, blunder: 0.55, captures: true },
    easy: { time: 400, max: 3000, margin: 0.6, blunder: 0.12 },
    normal: { time: 1200, max: 20000, margin: 0.97, blunder: 0 },
    hard: { time: 2600, max: 60000, margin: 1, blunder: 0 },
    hint: { time: 1500, max: 30000, margin: 1, blunder: 0 },
  };

  // st: { size, board, turn, ko, caps, rule, goal, komi, last, lastPass }
  function think(st, levelName, seed) {
    const L = LEVELS[levelName] || LEVELS.normal;
    const rnd = makeRng(seed === undefined ? (Date.now() ^ (Math.random() * 1e9)) : seed);
    const col = st.turn + 1;
    const size = st.size;
    const B = new FastBoard(size);
    B.load(st.board, st.ko, st.caps);
    const cands = [];
    for (let i = 0; i < B.ne; i++) {
      const p = B.emp[i];
      if (B.isLegal(p, col) && !B.isEye(p, col)) cands.push(p);
    }
    if (!cands.length) return PASS;
    const territory = st.rule !== 'capture';

    // 相手がパスした：いま数えて勝っていればパスして終わる
    if (territory && st.lastPass) {
      const own = ownership(st, 400);
      const dead = new Set(guessDead(st, own));
      const sc = E.scoreBoard(st.board, size, dead, st.komi);
      const me = st.turn, diff = sc.total[me] - sc.total[1 - me];
      if (diff > 0) return PASS;
    }

    // はじめて：取れる石があれば一番たくさん取れる手、なければ半分以上は適当に
    if (L.captures) {
      let best = 0, bestN = 0;
      for (const p of cands) {
        let n = 0;
        const seen = [];
        for (let i = 0; i < 4; i++) {
          const q = p + B.nb[i];
          if (B.c[q] !== 3 - col) continue;
          const h = B.head[q];
          if (seen.indexOf(h) < 0 && B.inAtari(h)) { seen.push(h); n += B.csz[h]; }
        }
        if (n > bestN || (n === bestN && n && rnd() < 0.5)) { bestN = n; best = p; }
      }
      if (best) return B.toEngine(best);
    }
    // 相手がパスしたあとは、手加減せずに読んで（パスするかどうかも決める）
    if (rnd() < L.blunder && !(territory && st.lastPass)) {
      const ok = cands.filter(p => !selfAtariBig(B, p, col));
      const pool = ok.length ? ok : cands;
      return B.toEngine(pool[(rnd() * pool.length) | 0]);
    }

    const res = search(st, L.time, L.max, rnd);
    const root = res.root;
    if (!root.moves.length) return PASS;
    let bi = 0;
    for (let i = 1; i < root.moves.length; i++) if (root.n[i] > root.n[bi]) bi = i;
    // 盤がほぼ決まっていて、どこに打っても 自分の地の中 か 相手の地の中なら パス
    if (territory) {
      const own = res.own, np = Math.max(1, res.playouts);
      let settled = true;
      for (let i = 0; i < res.base.ne && settled; i++) {
        const q = res.base.emp[i];
        if (Math.abs(own[q] / np) < 0.8) settled = false;
      }
      if (settled) return PASS;
    }
    let pick = bi;
    if (L.margin < 1) {
      const lim = root.n[bi] * L.margin;
      const pool = [];
      for (let i = 0; i < root.moves.length; i++) if (root.n[i] >= lim && root.n[i] > 0) pool.push(i);
      pick = pool[(rnd() * pool.length) | 0];
    }
    return B.toEngine(root.moves[pick]);
  }

  global.AI = { LEVELS, FastBoard, think, ownership, guessDead, search };
})(typeof window !== 'undefined' ? window : globalThis);
