/*
 * いきがみえる囲碁 — 画面表示と操作
 */
(function () {
  'use strict';
  const E = window.Engine;
  const AI = window.AI;
  const TS = window.Tsumego;
  const PROBS = window.TSUMEGO_PROBLEMS || [];
  const $ = id => document.getElementById(id);
  const STORE = 'yyigo.v1';
  const PASS = E.PASS;
  const KN = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九'];

  const app = {
    G: null,
    states: [],         // states[k] = k 手目のあとの局面（まった用）
    moves: [],
    mode: 'cpu',        // 'cpu' | 'two' | 'tsume'
    human: [true, false],
    level: 'beginner',
    rule: 'capture',
    goal: 3,
    size: 9,
    handicap: 0,
    preview: null,      // おく前に たしかめている点
    look: null,         // タッチした石（いき を見せる）
    hint: null,
    busy: false,
    token: 0,           // 新しいゲームやまったで、古い CPU の思考結果を捨てるため
    anim: null,
    scoring: null,      // 数えている途中：{ dead: Set }
    estimate: null,     // 「いまの じんち」：点ごとの所有（+1 くろ 〜 -1 しろ）
    settings: { libs: true, caps: true, danger: true, confirm: true, numbers: false, sound: true },
    tsume: null,        // いしとり もんだい中：{ idx, solver, target, n, failed, demo }
    tsumeDone: {},
  };

  let cells = [];

  // ---------- 保存 ----------

  function save() {
    try {
      localStorage.setItem(STORE, JSON.stringify({
        settings: app.settings,
        tsumeDone: app.tsumeDone,
        game: {
          mode: app.mode, human: app.human, level: app.level, rule: app.rule, goal: app.goal, size: app.size,
          handicap: app.handicap, moves: app.moves, tsume: app.tsume ? app.tsume.idx : null,
        },
      }));
    } catch (e) { /* 保存できない環境でも遊べる */ }
  }
  function load() {
    try { return JSON.parse(localStorage.getItem(STORE) || 'null'); } catch (e) { return null; }
  }

  // ---------- 小さな図（ルールの説明用） ----------

  // rows：X くろ / O しろ / x o うすい石（これから おく） / + いき / * ×じるし / T しろ（とられる）/ k ▪くろの じんち / w ▫しろの じんち
  // edges：盤のはし（'t' 上, 'b' 下, 'l' 左, 'r' 右）
  function miniSVG(rows, edges) {
    edges = edges || '';
    const h = rows.length, w = rows[0].length, u = 20;
    const W = w * u, H = h * u;
    let s = `<rect class="mb" x="0" y="0" width="${W}" height="${H}"/>`;
    for (let x = 0; x < w; x++) {
      const y0 = edges.includes('t') ? u / 2 : 0, y1 = edges.includes('b') ? H - u / 2 : H;
      s += `<line class="ml" x1="${x * u + u / 2}" y1="${y0}" x2="${x * u + u / 2}" y2="${y1}"/>`;
    }
    for (let y = 0; y < h; y++) {
      const x0 = edges.includes('l') ? u / 2 : 0, x1 = edges.includes('r') ? W - u / 2 : W;
      s += `<line class="ml" x1="${x0}" y1="${y * u + u / 2}" x2="${x1}" y2="${y * u + u / 2}"/>`;
    }
    rows.forEach((r, y) => [...r].forEach((c, x) => {
      const cx = x * u + u / 2, cy = y * u + u / 2;
      if (c === 'X' || c === 'x') s += `<circle class="s1${c === 'x' ? ' gh' : ''}" cx="${cx}" cy="${cy}" r="8.6"/>`;
      if (c === 'O' || c === 'o' || c === 'T') s += `<circle class="s2${c === 'o' ? ' gh' : ''}" cx="${cx}" cy="${cy}" r="8.6"/>`;
      if (c === 'T') s += `<path class="x" d="M${cx - 5},${cy - 5}L${cx + 5},${cy + 5}M${cx + 5},${cy - 5}L${cx - 5},${cy + 5}"/>`;
      if (c === '+') s += `<circle class="lib" cx="${cx}" cy="${cy}" r="3.6"/>`;
      if (c === '*') s += `<path class="x" d="M${cx - 5},${cy - 5}L${cx + 5},${cy + 5}M${cx + 5},${cy - 5}L${cx - 5},${cy + 5}"/>`;
      if (c === 'k') s += `<rect class="tb" x="${cx - 3.5}" y="${cy - 3.5}" width="7" height="7"/>`;
      if (c === 'w') s += `<rect class="tw" x="${cx - 3.5}" y="${cy - 3.5}" width="7" height="7"/>`;
    }));
    return `<svg class="mini" viewBox="0 0 ${W} ${H}" aria-hidden="true">${s}</svg>`;
  }

  const GUIDE = [
    ['石を おく', 'くろと しろが 1こずつ じゅんばんに、線と 線が まじわる ところに 石を おくよ。くろが さき。おいた 石は うごかせないよ。',
      ['.....', '.X...', '..O..', '...X.', '.....']],
    ['いき（こきゅうてん）', '石の たて・よこの となりの あいている ところが「いき」。石が いきを する ところだよ。',
      ['.....', '..+..', '.+X+.', '..+..', '.....']],
    ['とる', 'あいての 石の いき を ぜんぶ ふさぐと、その石を とれるよ。とった 石は 盤から とりのぞくよ。',
      ['.....', '..X..', '.XTx.', '..X..', '.....']],
    ['アタリ', 'いき が あと 1つの ことを「アタリ」と いうよ。アタリに されたら にげよう！ にげると いき が ふえるよ。',
      ['.....', '..X..', '.XO+.', '..X..', '.....']],
    ['つながった 石', 'たて・よこで となりあう 石は なかま。いき は みんなで つかうよ。ななめは つながっていないよ。',
      ['.....', '.++..', '+XX+.', '.++..', '.....']],
    ['すみ と へり', 'すみや へりの 石は いき が すくないよ。すみは 2つ、へりは 3つ。とられやすいから きを つけよう。',
      ['X+...', '+....', '.....', '..+..', '.+X+.'], 'tl'],
    ['おけない ところ', 'いき が 1つも ない ところには おけないよ。でも、おいて あいての 石が とれる ときは おけるよ。',
      ['.O...', 'O*O..', '.O...', '.....', '.....']],
    ['コウ', '1つ とられた すぐあとに、とりかえして おなじ 形に もどすのは ダメ。ほかの ところに 1回 うってからなら とりかえせるよ。',
      ['.....', '.XO..', 'X.XO.', '.XO..', '.....']],
    ['いしとり ルール', 'はじめての 人は「いしとり」から。さきに きめた 数の 石を とった ほうが かち！',
      ['.....', '..X..', '.XTX.', '..X..', '.....']],
    ['じんち（ふつうの 囲碁）', 'じぶんの 石で かこんだ ところが「じんち」。さいごに「じぶんの 石 ＋ じんち」を かぞえて、おおい ほうが かち。',
      ['kkXOw', 'kkXOw', 'kXOww', 'kXOww', 'XXOww'], 'tblr'],
    ['パス と おわり', 'もう うつ ところが ないと おもったら「パス」。ふたり つづけて パスしたら おわって かぞえるよ。',
      ['kXOww', 'kXOww', 'XXOOw', 'kkXOw', 'kkXOw'], 'tblr'],
    ['コミ', 'くろは さきに うてるので すこし とく。だから しろは さいごに 6.5 もらえるよ（コミ）。おきごの ときは 0.5。',
      ['.....', '.X...', '.....', '...O.', '.....']],
  ];

  function fillGuide() {
    $('guide-list').innerHTML = GUIDE.map(([t, d, rows, edges]) =>
      `<div class="g-item">${miniSVG(rows, edges)}<div class="g-body"><b>${t}</b><p>${d}</p></div></div>`).join('');
  }

  // ---------- 初期化 ----------

  function init() {
    const board = $('board');
    board.addEventListener('click', e => {
      const c = e.target.closest('.pt');
      if (c) onPoint(+c.dataset.p);
    });

    $('btn-menu').addEventListener('click', () => {
      $('btn-resign').disabled = !canResign();
      $('btn-estimate').hidden = !(app.mode !== 'tsume' && app.G.rule === 'territory' && app.G.winner === null && !app.scoring);
      $('dlg-menu').showModal();
    });
    $('btn-guide').addEventListener('click', () => $('dlg-guide').showModal());
    $('btn-hint').addEventListener('click', onHint);
    $('btn-pass').addEventListener('click', onPass);
    $('btn-undo').addEventListener('click', onUndo);
    $('btn-score-back').addEventListener('click', onResume);
    $('btn-score-ok').addEventListener('click', onScoreOK);
    $('btn-tsume').addEventListener('click', openTsumeList);
    $('btn-ts-retry').addEventListener('click', () => { if (app.tsume) startTsume(app.tsume.idx, []); });
    $('btn-ts-answer').addEventListener('click', () => { if (app.tsume && !app.tsume.demo) tsumeResult('answer'); });
    $('dlg-tsume').addEventListener('close', () => {
      const v = $('dlg-tsume').returnValue;
      if (/^\d+$/.test(v)) startTsume(+v, []);
    });
    $('dlg-tsume-result').addEventListener('close', () => onTsumeResult($('dlg-tsume-result').returnValue));

    $('dlg-menu').addEventListener('close', () => {
      const v = $('dlg-menu').returnValue;
      if (v === 'new') openNew(false);
      else if (v === 'howto') $('dlg-howto').showModal();
      else if (v === 'tsume') openTsumeList();
      else if (v === 'guide') $('dlg-guide').showModal();
      else if (v === 'estimate') onEstimate();
      else if (v === 'settings') openSettings();
      else if (v === 'resign') onResign();
    });
    const fNew = $('dlg-new').querySelector('form');
    fNew.addEventListener('change', syncNewForm);
    $('dlg-new').addEventListener('close', () => {
      if ($('dlg-new').returnValue !== 'ok') return;
      const hc = +fNew.handicap.value;
      let order = fNew.order.value === 'random' ? (Math.random() < 0.5 ? 'first' : 'second') : fNew.order.value;
      if (hc) order = 'first'; // 置き石は あなた（くろ）
      startGame({
        mode: fNew.mode.value, level: fNew.level.value, order, rule: fNew.rule.value,
        goal: +fNew.goal.value, size: +fNew.size.value, handicap: hc,
      });
    });
    $('dlg-settings').addEventListener('close', () => {
      const f = $('dlg-settings').querySelector('form');
      for (const k of Object.keys(app.settings)) app.settings[k] = f[k].checked;
      app.preview = null;
      save();
      render();
    });
    $('dlg-result').addEventListener('close', () => {
      const v = $('dlg-result').returnValue;
      if (v === 'new') openNew(false);
      else if (v === 'undo') onUndo();
    });

    fillGuide();
    new ResizeObserver(() => {
      const w = $('board').clientWidth / app.size;
      document.body.classList.toggle('small-cells', w < 26);
    }).observe($('board'));

    const saved = load();
    if (saved && saved.settings) Object.assign(app.settings, saved.settings);
    if (saved && saved.tsumeDone) app.tsumeDone = saved.tsumeDone;
    const g = saved && saved.game;
    if (g && g.mode === 'tsume' && PROBS[g.tsume]) {
      startTsume(g.tsume, g.moves || []);
    } else if (g && Array.isArray(g.moves)) {
      app.mode = g.mode === 'two' ? 'two' : 'cpu';
      app.human = g.human || [true, false];
      app.level = AI.LEVELS[g.level] ? g.level : 'beginner';
      app.rule = g.rule === 'territory' ? 'territory' : 'capture';
      app.goal = g.goal || 3;
      app.size = E.SIZES.includes(g.size) ? g.size : 9;
      app.handicap = g.handicap | 0;
      rebuild(g.moves);
      setupBoard();
      render();
      if (E.needsScoring(app.G)) enterScoring();
      else if (app.G.winner === null) proceed();
    } else {
      startGame({ mode: 'cpu', level: 'beginner', order: 'first', rule: 'capture', goal: 3, size: 9, handicap: 0 }, true);
      openNew(true);
    }
  }

  function openSettings() {
    const f = $('dlg-settings').querySelector('form');
    for (const k of Object.keys(app.settings)) f[k].checked = app.settings[k];
    $('dlg-settings').showModal();
  }

  function openNew(first) {
    const f = $('dlg-new').querySelector('form');
    if (app.mode !== 'tsume') {
      f.mode.value = app.mode;
      f.level.value = app.level;
      f.rule.value = app.rule;
      f.goal.value = String(app.goal);
      f.size.value = String(app.size);
    }
    $('welcome').hidden = !first;
    $('btn-new-cancel').hidden = !!first;
    syncNewForm();
    f.handicap.value = String(app.mode === 'tsume' ? 0 : app.handicap);
    if (f.handicap.selectedIndex < 0) f.handicap.value = '0';
    $('dlg-new').showModal();
  }
  function syncNewForm() {
    const f = $('dlg-new').querySelector('form');
    const cpu = f.mode.value === 'cpu';
    f.querySelectorAll('.cpu-only').forEach(el => { el.hidden = !cpu; });
    f.querySelectorAll('.capture-only').forEach(el => { el.hidden = f.rule.value !== 'capture'; });
    $('hc-legend').textContent = cpu ? 'ハンデ（あなたが さきに 石を おく）' : 'ハンデ（くろが さきに 石を おく）';
    const sel = $('sel-handicap');
    const cur = sel.value;
    const max = E.maxHandicap(+f.size.value);
    let h = '<option value="0">なし</option>';
    for (let k = 2; k <= max; k++) h += `<option value="${k}">${k}こ おく（おきご）</option>`;
    sel.innerHTML = h;
    sel.value = +cur <= max ? cur : '0';
    if (sel.selectedIndex < 0) sel.value = '0';
    $('fs-order').querySelectorAll('input').forEach(i => { i.disabled = sel.value !== '0'; });
  }

  function startGame(o, silent) {
    app.token++;
    app.busy = false;
    app.tsume = null;
    app.scoring = null;
    app.estimate = null;
    document.body.classList.remove('tsume-mode', 'scoring');
    app.mode = o.mode;
    app.level = o.level || 'beginner';
    app.rule = o.rule === 'territory' ? 'territory' : 'capture';
    app.goal = o.goal || 3;
    app.size = E.SIZES.includes(o.size) ? o.size : 9;
    app.handicap = o.handicap | 0;
    app.human = o.mode === 'cpu' ? (o.order === 'second' ? [false, true] : [true, false]) : [true, true];
    rebuild([]);
    $('kifu').innerHTML = '';
    setupBoard();
    save();
    render();
    if (!silent) proceed();
  }

  function gameOpts() {
    return { size: app.size, rule: app.rule, goal: app.goal, handicap: app.handicap };
  }

  function rebuild(moves) {
    let s = app.mode === 'tsume' ? tsumeStart(app.tsume.idx) : E.newGame(gameOpts());
    app.states = [s];
    app.moves = [];
    for (const m of moves) {
      if (!E.canApply(s, m)) break;
      s = E.apply(s, m);
      app.states.push(s);
      app.moves.push(m);
    }
    app.G = s;
    app.preview = null;
    app.look = null;
    app.hint = null;
  }

  // 盤の線と点を作り直す
  function setupBoard() {
    const n = app.size;
    document.documentElement.style.setProperty('--n', n);
    document.body.classList.toggle('big19', n >= 19);
    const board = $('board');
    let svg = `<svg class="grid" viewBox="0 0 ${n} ${n}" preserveAspectRatio="none" aria-hidden="true">`;
    for (let i = 0; i < n; i++) {
      const edge = i === 0 || i === n - 1 ? ' edge' : '';
      svg += `<line class="ln${edge}" x1="0.5" y1="${i + 0.5}" x2="${n - 0.5}" y2="${i + 0.5}"/>`;
      svg += `<line class="ln${edge}" x1="${i + 0.5}" y1="0.5" x2="${i + 0.5}" y2="${n - 0.5}"/>`;
    }
    const r = n >= 19 ? 0.09 : 0.08;
    for (const p of E.geo(n).stars) svg += `<circle class="star" cx="${p % n + 0.5}" cy="${((p / n) | 0) + 0.5}" r="${r}"/>`;
    svg += '</svg>';
    board.innerHTML = svg;
    cells = [];
    for (let p = 0; p < n * n; p++) {
      const c = document.createElement('div');
      c.className = 'pt';
      c.dataset.p = p;
      board.appendChild(c);
      cells.push(c);
    }
    let f = '', rk = '';
    for (let i = 0; i < n; i++) { f += `<span>${i + 1}</span>`; rk += `<span>${KN[i]}</span>`; }
    $('files').innerHTML = f;
    $('ranks').innerHTML = rk;
    document.body.classList.toggle('small-cells', board.clientWidth / n < 26);
  }

  // ---------- 状態の問い合わせ ----------

  function humanTurn() { return app.G.winner === null && app.human[app.G.turn] && !app.busy && !app.scoring; }
  function canResign() { return app.mode !== 'tsume' && app.G.winner === null && humanTurn() && app.G.ply > 0; }
  const color = side => side + 1;

  function playerName(side) {
    if (app.mode === 'two') return E.SIDES[side].name;
    if (app.mode === 'tsume') return side === 0 ? 'あなた' : 'しろ';
    return app.human[side] ? 'あなた' : 'CPU';
  }

  // 置いたら どうなるか
  function previewInfo(G, p) {
    const r = E.play(G.board, G.size, p, color(G.turn), G.ko);
    if (typeof r === 'string') return { illegal: r };
    const g = E.geo(G.size);
    const mine = E.groupAt(r.board, G.size, p);
    const opp = 3 - color(G.turn);
    const ataris = new Set(); // アタリになる相手の石
    const seen = new Set();
    for (const q of g.nb[p]) {
      if (r.board[q] !== opp || seen.has(q)) continue;
      const gr = E.groupAt(r.board, G.size, q);
      for (const s of gr.stones) seen.add(s);
      if (gr.libs.length === 1) for (const s of gr.stones) ataris.add(s);
    }
    // アタリだった自分の石が たすかるか
    let saved = 0;
    const seen2 = new Set();
    for (const q of g.nb[p]) {
      if (G.board[q] !== color(G.turn) || seen2.has(q)) continue;
      const gr = E.groupAt(G.board, G.size, q);
      for (const s of gr.stones) seen2.add(s);
      if (gr.libs.length === 1 && mine.libs.length >= 2) saved += gr.stones.length;
    }
    return { board: r.board, captured: r.captured, libs: mine.libs, stones: mine.stones, ataris, saved, ko: r.ko };
  }

  // いま おくと 相手の石が取れる点（点 → 取れる数）
  function captureSpots(G) {
    const out = new Map();
    const opp = 3 - color(G.turn);
    const { groups } = E.allGroups(G.board, G.size);
    for (const gr of groups) {
      if (gr.color !== opp || gr.libs.length !== 1) continue;
      const p = gr.libs[0];
      if (E.illegalReason(G, p) !== null) continue;
      out.set(p, (out.get(p) || 0) + gr.stones.length);
    }
    return out;
  }

  // 手の番号（いま盤にある石が、何手目に置かれたか）
  function moveNumbers() {
    const nums = new Int16Array(app.size * app.size);
    let k = 0;
    for (let i = 1; i < app.states.length; i++) {
      const s = app.states[i];
      if (!s.last || app.states[i - 1].ply === s.ply) continue;
      k++;
      if (s.last.p >= 0) nums[s.last.p] = k;
      for (const c of s.last.captured) nums[c] = 0;
    }
    return nums;
  }

  // ---------- 描画 ----------

  function render() {
    renderBoard();
    renderPlayers();
    renderStatus();
    renderInfo();
    renderKifu();
    const tsDemo = app.tsume && app.tsume.demo;
    $('btn-hint').disabled = !humanTurn() || tsDemo;
    $('btn-pass').disabled = !humanTurn();
    $('btn-undo').disabled = !canUndo() || tsDemo;
    document.body.classList.toggle('scoring', !!app.scoring);
  }

  function renderBoard() {
    const G = app.G, n = G.size, b = G.board;
    const ht = humanTurn();
    const { id, groups } = E.allGroups(b, n);
    const pv = app.preview !== null && ht ? previewInfo(G, app.preview) : null;
    const capSet = new Set(pv && pv.captured ? pv.captured : []);
    const libSet = new Set(), oppLib = new Set();
    if (pv && pv.libs) for (const q of pv.libs) libSet.add(q);
    else if (app.look !== null && b[app.look]) {
      const gr = groups[id[app.look]];
      const opp = app.mode === 'two' ? false : !app.human[gr.color - 1];
      for (const q of gr.libs) (opp ? oppLib : libSet).add(q);
    }
    const spots = ht && app.settings.caps && app.mode !== 'tsume' && !pv ? captureSpots(G) : new Map();
    const nums = app.settings.numbers ? moveNumbers() : null;
    const last = G.last && G.last.p >= 0 ? G.last.p : -1;
    const sc = app.scoring ? E.scoreBoard(b, n, app.scoring.dead, G.komi) : (G.score ? G.score : null);
    const dead = app.scoring ? app.scoring.dead : (G.dead ? new Set(G.dead) : null);
    const est = app.estimate;
    const target = app.tsume ? new Set(app.tsume.target) : null;
    for (let p = 0; p < n * n; p++) {
      const c = cells[p];
      const cls = ['pt'];
      let h = '';
      const st = b[p];
      if (st) {
        const gr = groups[id[p]];
        const sc2 = ['stone', 'c' + st];
        if (p === last && !sc) sc2.push('last');
        if (capSet.has(p)) cls.push('capgo');
        if (dead && dead.has(p)) sc2.push('dead');
        if (target && target.has(p) && st === E.WHITE) sc2.push('target');
        let inner = '';
        if (nums && nums[p]) { inner = `<span class="num">${nums[p]}</span>`; sc2.push('has-num'); }
        h += `<div class="${sc2.join(' ')}">${inner}</div>`;
        const libs = pv ? null : gr.libs.length;
        if (app.settings.libs && libs !== null && libs <= 2 && !sc && !(dead && dead.has(p))) {
          h += `<span class="badge l${libs}">${libs}</span>`;
        }
        if (app.look === p) cls.push('sel');
      } else {
        if (pv && p === app.preview) {
          h += `<div class="stone ghost c${color(G.turn)}"></div>`;
          if (app.settings.danger && pv.libs && pv.libs.length === 1) h += '<span class="badge warn">!</span>';
        }
        if (libSet.has(p)) cls.push('lib');
        if (oppLib.has(p)) cls.push('lib', 'opp');
        if (spots.has(p)) cls.push('cap');
        if (p === G.ko && ht && app.settings.caps) cls.push('ko');
        if (sc && sc.owner[p]) cls.push('terr-' + sc.owner[p]);
        if (est && Math.abs(est[p]) > 0.4) cls.push('terr-' + (est[p] > 0 ? 1 : 2));
      }
      if (st && sc && dead && dead.has(p) && sc.owner[p]) cls.push('terr-' + sc.owner[p]);
      if (st && est && Math.abs(est[p]) > 0.4 && (est[p] > 0 ? 1 : 2) !== st) cls.push('terr-' + (est[p] > 0 ? 1 : 2));
      if (app.hint === p) cls.push('hint-to');
      c.className = cls.join(' ');
      c.innerHTML = h;
    }
  }

  function renderPlayers() {
    const G = app.G;
    const bs = app.mode === 'cpu' && app.human[1] && !app.human[0] ? 1 : 0;
    for (const [elId, side] of [['player-bottom', bs], ['player-top', 1 - bs]]) {
      const el = $(elId);
      const active = G.turn === side && G.winner === null && !app.scoring;
      el.className = `player s${side}${active ? ' active' : ''}`;
      let h = `<div class="pname"><b><i class="pstone s${side}"></i>${playerName(side)}</b><small>${app.mode === 'two' ? (side === 0 ? 'さきに うつ' : 'あとに うつ') : E.SIDES[side].name}${G.handicap && side === 0 && app.mode !== 'tsume' ? `（おきご ${G.handicap}）` : ''}</small></div>`;
      const n = G.caps[side];
      const oc = 1 - side; // 取った石は 相手の色
      if (app.mode === 'tsume') {
        h += `<div class="caps"><span class="lbl">とった 石</span><span class="num">${n}</span></div>`;
        if (side === 0) {
          const left = app.tsume.n - blackMovesMade();
          h += `<div class="pextra">のこり<br><b>${Math.max(0, left)}</b>手</div>`;
        }
      } else if (G.rule === 'capture') {
        let bar = '';
        if (G.goal <= 10) {
          for (let i = 0; i < G.goal; i++) bar += `<i class="${i < n ? 'pstone s' + oc : 'empty'}"></i>`;
          h += `<div class="caps"><span class="lbl">とった 石</span><span class="capbar">${bar}</span><span class="goal">${n} / ${G.goal}</span></div>`;
        }
      } else {
        h += `<div class="caps"><span class="lbl">とった 石</span><span class="num">${n}</span></div>`;
        if (side === 1 && G.komi) h += `<div class="pextra">コミ<br>${G.komi}</div>`;
      }
      el.innerHTML = h;
    }
  }

  function lastLine(G) {
    if (!G.last) return '';
    const who = playerName(G.last.side);
    const cap = G.last.captured.length ? `（${G.last.captured.length}こ とった）` : '';
    return `<span class="lastmv">${who}：${G.kifu[G.kifu.length - 1]}${cap}</span>`;
  }

  function myAtari(G) {
    const { groups } = E.allGroups(G.board, G.size);
    let n = 0;
    for (const gr of groups) if (gr.color === color(G.turn) && gr.libs.length === 1) n += gr.stones.length;
    return n;
  }

  function renderStatus() {
    const G = app.G;
    const el = $('status');
    let cls = 's' + G.turn, text;
    const who = playerName(G.turn);
    const ts = app.tsume;
    const ht = humanTurn();
    if (ts) {
      const pr = PROBS[ts.idx];
      const left = ts.n - blackMovesMade();
      if (ts.demo) { cls += ' hint'; text = 'こたえを ならべているよ…'; }
      else if (G.winner === 0) { cls = 'end'; text = `<b>せいかい！</b> ${pr.moves}手で とったよ`; }
      else if (ts.failed && G.turn === 0) { cls += ' check'; text = '<b>ざんねん！</b> にげられちゃった。「まった」で もどって もういちど！'; }
      else if (!app.human[G.turn]) { cls += ' think'; text = 'しろが にげかたを かんがえているよ<span class="dots"><i></i><i></i><i></i></span>'; }
      else if (app.hint !== null) { cls += ' hint'; text = `ヒント：<b>${E.pointName(G.size, app.hint)}</b> ひかっている ところに おいてね`; }
      else if (app.preview !== null && ht) { text = 'ここで いい？ もういちど タッチすると おくよ'; }
      else { text = `<b>第${ts.idx + 1}問（${pr.moves}手）</b> のこり ${left}手。<span class="lg lg-target"></span> の 石を とろう！`; }
      el.className = 'status ' + cls;
      el.innerHTML = `<span class="msg">${text}</span>${G.last ? lastLine(G) : `<span class="lastmv">「${pr.title}」</span>`}`;
      return;
    }
    if (app.scoring) {
      const sc = E.scoreBoard(G.board, G.size, app.scoring.dead, G.komi);
      cls = 'end';
      text = `<b>おわり！ かぞえるよ</b>　くろ ${sc.total[0]} ・ しろ ${sc.total[1]}<small>×の 石は しんでいる 石。ちがう ときは 石を タッチして なおしてね</small>`;
      el.className = 'status ' + cls;
      el.innerHTML = `<span class="msg">${text}</span>`;
      return;
    }
    if (G.winner !== null) {
      cls = 'end';
      text = G.winner === -1 ? 'ひきわけ' : `${playerName(G.winner)}の かち！`;
      text += '　<small>「メニュー」から あたらしく はじめられるよ</small>';
    } else if (app.estimate) {
      cls += ' hint';
      let k = 0, w = 0;
      for (let p = 0; p < app.estimate.length; p++) { if (app.estimate[p] > 0.4) k++; else if (app.estimate[p] < -0.4) w++; }
      text = `いまの じんち（だいたい）：くろ ${k} ・ しろ ${w}＋コミ ${G.komi}<small>盤を タッチすると けすよ</small>`;
    } else if (!app.human[G.turn]) {
      cls += ' think';
      text = 'CPU が かんがえ中<span class="dots"><i></i><i></i><i></i></span>';
    } else if (app.hint !== null) {
      cls += ' hint';
      text = app.hint === PASS ? 'ヒント：<b>パス</b> が おすすめ！ もう うつ ところが ないみたい' : `ヒント：<b>${E.pointName(G.size, app.hint)}</b> が おすすめ！ ひかっている ところに おいてね`;
    } else if (app.preview !== null && ht) {
      text = 'ここで いい？ <b>もういちど タッチ</b>すると おくよ';
    } else if (myAtari(G) && ht) {
      cls += ' check';
      text = `<b>アタリ！</b> ${app.mode === 'two' ? who + 'の ' : 'あなたの '}石が とられそう！ <span class="lg lg-n1">1</span> の 石を にがそう`;
    } else if (G.last && G.last.p === PASS) {
      text = `${playerName(G.last.side)}が パスしたよ。${G.rule === 'territory' ? 'パスすると おわって かぞえるよ' : ''}`;
    } else {
      const goal = G.rule === 'capture' ? `さきに ${G.goal}こ とったら かち！` : '';
      text = app.mode === 'two' ? `<b>${who}</b>の ばんだよ。${goal}` : `<b>あなたの ばん</b>（${E.SIDES[G.turn].name}）だよ。${goal || '石を おく ところを タッチしてね'}`;
    }
    el.className = 'status ' + cls;
    el.innerHTML = `<span class="msg">${text}</span>${lastLine(G)}`;
  }

  const REASON = {
    suicide: 'ここに おくと、おいた 石の いき が なくなって しまうから おけないよ。（あいての 石が とれる ときは おける）',
    ko: '<b>コウ</b>：とられた すぐあとに とりかえすと、おなじ 形に もどって しまうから まだ おけないよ。ほかの ところに 1回 うってからね。',
    occupied: 'もう 石が あるよ。',
  };

  function renderInfo() {
    const G = app.G;
    const info = $('info');
    const ht = humanTurn();
    if (app.scoring) {
      const sc = E.scoreBoard(G.board, G.size, app.scoring.dead, G.komi);
      info.innerHTML = '<div class="tips"><p class="tip-main">かぞえかた（じぶんの 石 ＋ じんち）</p>' + scoreTable(sc) +
        '<p class="note">しんでいる 石（×）は、あいての じんちに なるよ。</p></div>';
      return;
    }
    if (app.preview !== null && ht) {
      const pv = previewInfo(G, app.preview);
      const me = E.SIDES[G.turn].name, op = E.SIDES[1 - G.turn].name;
      const lines = [];
      if (pv.captured.length) lines.push(`<b class="good">${op}の 石を ${pv.captured.length}こ とれる！</b>`);
      if (pv.saved) lines.push(`<b class="good">アタリの 石が たすかる！</b>`);
      if (pv.ataris.size) lines.push(`${op}の 石が <b>アタリ</b>に なる（つぎに とれるかも）`);
      if (pv.libs.length === 1) lines.push(`<b class="bad">あぶない！ いき が 1つだけ。すぐ とられちゃうかも</b>`);
      else lines.push(`おいた 石の いき は <b>${pv.libs.length}つ</b>（<span class="lg lg-lib"></span>）`);
      info.innerHTML = `<div class="card"><div class="card-body"><div class="card-head"><i class="pstone s${G.turn}"></i><b>${E.pointName(G.size, app.preview)}</b><span class="owner s${G.turn}">${me}</span></div>` +
        `<p class="desc">${lines.join('<br>')}</p><p class="note">もういちど タッチすると おくよ。ほかの ところを タッチすると えらびなおせるよ。</p></div></div>`;
      return;
    }
    if (app.look !== null && G.board[app.look]) {
      const gr = E.groupAt(G.board, G.size, app.look);
      const side = gr.color - 1;
      const mine = app.mode === 'two' ? side === G.turn : app.human[side];
      const nl = gr.libs.length;
      let d = `${gr.stones.length > 1 ? `${gr.stones.length}こ つながった 石。` : ''}いき は <b>${nl}つ</b>（<span class="lg ${mine ? 'lg-lib' : 'lg-lib opp'}"></span>）。`;
      if (nl === 1) d += mine ? '<br><b class="bad">アタリ！ にげないと とられちゃう</b>' : '<br><b class="good">アタリ！ あと 1つ ふさげば とれるよ</b>';
      else if (nl === 2) d += mine ? '<br>いき が すくないよ。きを つけて' : '<br>あと 2つ ふさげば とれるよ';
      const owner = app.mode === 'two' ? `${E.SIDES[side].name}の 石` : (mine ? 'あなたの 石' : 'CPU の 石');
      info.innerHTML = `<div class="card"><div class="card-body"><div class="card-head"><i class="pstone s${side}"></i><b>${E.SIDES[side].name}</b>` +
        `<span class="owner s${side}">${owner}</span><span class="where">${E.pointName(G.size, app.look)}</span></div><p class="desc">${d}</p></div></div>`;
      return;
    }
    if (app.lastIllegal) {
      info.innerHTML = `<div class="tips"><p class="tip-main">そこには おけないよ</p><p class="desc">${REASON[app.lastIllegal] || ''}</p></div>`;
      return;
    }
    if (app.tsume) {
      const pr = PROBS[app.tsume.idx];
      info.innerHTML = `<div class="tips"><p class="tip-main">第${app.tsume.idx + 1}問「${pr.title}」</p>` +
        `<p class="desc">くろを ${app.tsume.n}かい うつまでに、<span class="lg lg-target"></span> の しろい 石を とろう。${pr.hint ? '<br>' + pr.hint : ''}</p></div>`;
      return;
    }
    info.innerHTML =
      '<div class="tips"><p class="tip-main">石を タッチすると いき が みえるよ。</p>' +
      '<ul class="legend">' +
      '<li><span class="lg lg-lib"></span> いき（あいている となり）</li>' +
      '<li><span class="lg lg-n1">1</span> アタリ（あと 1つで とられる）</li>' +
      '<li><span class="lg lg-cap"></span> おくと 石が とれる</li>' +
      '<li><span class="lg lg-warn">!</span> すぐ とられちゃうかも</li>' +
      '</ul></div>';
  }

  function scoreTable(sc) {
    const row = (label, a, b) => `<tr><td>${label}</td><td>${a}</td><td>${b}</td></tr>`;
    return '<table class="score-table"><tr><th></th><th><i class="pstone s0"></i>くろ</th><th><i class="pstone s1"></i>しろ</th></tr>' +
      row('盤の 石', sc.stones[0], sc.stones[1]) + row('じんち', sc.terr[0], sc.terr[1]) + row('コミ', '', sc.komi || 0) +
      `<tr class="total"><td>ごうけい</td><td>${sc.total[0]}</td><td>${sc.total[1]}</td></tr></table>`;
  }

  function renderKifu() {
    const ol = $('kifu');
    const k = app.G.kifu;
    if (ol.children.length > k.length) ol.innerHTML = '';
    for (let i = ol.children.length; i < k.length; i++) {
      const li = document.createElement('li');
      li.textContent = k[i];
      ol.appendChild(li);
    }
  }

  // ---------- 演出 ----------

  function animateMove() {
    const a = app.anim;
    app.anim = null;
    if (!a) return;
    if (a.p >= 0) {
      const st = cells[a.p] && cells[a.p].querySelector('.stone');
      if (st) st.classList.add('drop');
    }
    for (const q of a.captured) {
      const c = cells[q];
      if (!c) continue;
      const d = document.createElement('div');
      d.className = `stone c${a.capColor} gone`;
      c.appendChild(d);
      setTimeout(() => d.remove(), 500);
    }
  }

  let toastTimer = 0;
  function toast(html, cls) {
    const el = $('toast');
    el.innerHTML = html;
    el.className = 'toast show ' + (cls || '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = 'toast'; }, 1800);
  }

  // ---------- 音 ----------
  // スマホのブラウザは「画面をタッチしたとき」にしか音を出す準備ができない。
  // そこで最初のタッチで AudioContext を作って動かし、無音を1回鳴らして音を出せる状態にしておく。
  // iPhone はマナーモード（消音スイッチ）だと Web Audio が鳴らないので、音楽と同じ扱い（playback）にする。
  let actx = null, master = null, unlocked = false, silentAudio = null;
  function audioCtx() {
    if (!actx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      actx = new AC();
      master = actx.createGain();
      master.gain.value = 0.9;
      const comp = actx.createDynamicsCompressor();
      master.connect(comp).connect(actx.destination);
    }
    return actx;
  }
  function silentWav() {
    // 0.1 秒の無音 WAV（8kHz・8bit）
    const n = 800, buf = new Uint8Array(44 + n);
    const dv = new DataView(buf.buffer);
    const str = (o, t) => { for (let i = 0; i < t.length; i++) buf[o + i] = t.charCodeAt(i); };
    str(0, 'RIFF'); dv.setUint32(4, 36 + n, true); str(8, 'WAVEfmt ');
    dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
    dv.setUint32(24, 8000, true); dv.setUint32(28, 8000, true); dv.setUint16(32, 1, true); dv.setUint16(34, 8, true);
    str(36, 'data'); dv.setUint32(40, n, true);
    buf.fill(128, 44);
    let bin = '';
    for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
    return 'data:audio/wav;base64,' + btoa(bin);
  }
  function unlockAudio() {
    if (!app.settings.sound) return;
    try {
      if (navigator.audioSession) navigator.audioSession.type = 'playback';
      else if (!silentAudio) {
        // 古い iPhone：<audio> を1回鳴らすと、マナーモードでも音が出るようになる
        silentAudio = new Audio(silentWav());
        silentAudio.setAttribute('playsinline', '');
        const pr = silentAudio.play();
        if (pr && pr.catch) pr.catch(() => {});
      }
      const ctx = audioCtx();
      if (!ctx) return;
      if (ctx.state !== 'running') ctx.resume().catch(() => {});
      if (!unlocked) {
        const src = ctx.createBufferSource();
        src.buffer = ctx.createBuffer(1, 1, 22050);
        src.connect(ctx.destination);
        src.start(0);
        unlocked = true;
      }
    } catch (e) { /* 音が出せない環境では鳴らさない */ }
  }
  for (const ev of ['pointerdown', 'touchstart', 'touchend', 'mousedown', 'click', 'keydown']) {
    document.addEventListener(ev, unlockAudio, { capture: true, passive: true });
  }
  // 別のアプリから戻ったときなどに止まっていたら、次のタッチで動かし直す
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && actx && actx.state !== 'running') unlocked = false; });

  function tone(freq, start, dur, type, vol, to) {
    const t0 = actx.currentTime + 0.01 + start;
    const o = actx.createOscillator();
    const g = actx.createGain();
    o.type = type || 'triangle';
    o.frequency.setValueAtTime(freq, t0);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol || 0.25, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(master);
    o.start(t0);
    o.stop(t0 + dur + 0.03);
  }
  // 碁石を置く「パチッ」：短い雑音 ＋ 低い音
  function clack() {
    const t0 = actx.currentTime + 0.01;
    const len = Math.floor(actx.sampleRate * 0.05);
    const buf = actx.createBuffer(1, len, actx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 4);
    const src = actx.createBufferSource();
    src.buffer = buf;
    const bp = actx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 2400; bp.Q.value = 1.2;
    const g = actx.createGain();
    g.gain.value = 1.4;
    src.connect(bp).connect(g).connect(master);
    src.start(t0);
    tone(520, 0, 0.08, 'sine', 0.5, 180);
  }
  function play(kind) {
    if (kind === 'move') clack();
    else if (kind === 'cap') [700, 900, 1100].forEach((f, i) => tone(f, 0.08 + i * 0.07, 0.14, 'triangle', 0.3));
    else if (kind === 'check') { tone(660, 0.05, 0.16, 'square', 0.12); tone(880, 0.21, 0.22, 'square', 0.12); }
    else if (kind === 'win') [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.13, 0.32, 'triangle', 0.35));
    else if (kind === 'lose') [392, 330, 262].forEach((f, i) => tone(f, i * 0.18, 0.38, 'sine', 0.35));
  }
  function sound(kind) {
    if (!app.settings.sound) return;
    try {
      const ctx = audioCtx();
      if (!ctx) return;
      if (ctx.state === 'running') play(kind);
      else ctx.resume().then(() => play(kind)).catch(() => {});
    } catch (e) { /* 音が出せない環境では鳴らさない */ }
  }

  function confetti() {
    const box = $('confetti');
    box.innerHTML = '';
    const colors = ['#111', '#f5f5f4', '#f59e0b', '#16a34a', '#2563eb'];
    for (let i = 0; i < 60; i++) {
      const s = document.createElement('i');
      s.style.left = Math.random() * 100 + '%';
      s.style.background = colors[i % colors.length];
      s.style.borderRadius = '50%';
      s.style.width = s.style.height = '12px';
      s.style.animationDelay = Math.random() * 0.6 + 's';
      s.style.animationDuration = 1.6 + Math.random() * 1.2 + 's';
      box.appendChild(s);
    }
    setTimeout(() => { box.innerHTML = ''; }, 3600);
  }

  // ---------- 操作 ----------

  function onPoint(p) {
    const G = app.G;
    app.lastIllegal = null;
    if (app.scoring) return toggleDead(p);
    if (app.estimate) { app.estimate = null; return render(); }
    if (G.board[p]) {
      app.preview = null;
      app.look = app.look === p ? null : p;
      return render();
    }
    app.look = null;
    if (!humanTurn()) { app.preview = null; return render(); }
    const why = E.illegalReason(G, p);
    if (why) {
      app.preview = null;
      app.lastIllegal = why;
      toast(why === 'ko' ? 'コウ：まだ とりかえせないよ' : 'そこには おけないよ');
      return render();
    }
    if (app.settings.confirm && app.preview !== p && app.hint !== p) {
      app.preview = p;
      return render();
    }
    commit(p);
  }

  function onPass() {
    if (!humanTurn()) return;
    const G = app.G;
    if (G.rule === 'territory' && !(G.last && G.last.p === PASS) && G.ply < 10 && !confirm('パスしますか？')) return;
    commit(PASS);
  }

  function commit(p) {
    const prev = app.G;
    const G = E.apply(prev, p);
    app.states.push(G);
    app.moves.push(p);
    app.G = G;
    app.preview = null;
    app.look = null;
    app.hint = null;
    app.anim = { p, captured: G.last.captured, capColor: 2 - prev.turn };
    let solved = false;
    if (app.tsume && prev.turn === 0 && !app.tsume.demo) {
      if (app.tsume.solver.captured(G.board)) solved = true;
      else {
        const left = app.tsume.n - blackMovesMade();
        app.tsume.failed = left < 1 || !app.tsume.solver.defendFails(G.board, G.ko, left);
      }
    } else if (app.tsume && app.tsume.demo && app.tsume.solver.captured(G.board)) solved = true;
    if (solved) {
      app.G = Object.assign(E.clone(G), { winner: 0, result: 'tsume' });
      app.states[app.states.length - 1] = app.G;
    }
    save();
    render();
    animateMove();
    sound('move');
    const capN = G.last.captured.length;
    if (p === PASS) toast(`${playerName(prev.turn)}は パス`);
    else if (capN) {
      setTimeout(() => sound('cap'), 60);
      const name = app.mode === 'cpu' && app.human[prev.turn] ? '' : `${playerName(prev.turn)}が `;
      toast(`${name}<b>${capN}こ</b> とった！`, 'cap');
    }
    if (app.G.winner !== null) return finish();
    if (E.needsScoring(app.G)) return enterScoring();
    if (p !== PASS && !capN && app.mode !== 'tsume') {
      // アタリ！ のお知らせ
      const pv = E.groupAt(G.board, G.size, p);
      const opp = 3 - color(prev.turn);
      const g = E.geo(G.size);
      let atari = false;
      for (const q of g.nb[p]) if (G.board[q] === opp && E.groupAt(G.board, G.size, q).libs.length === 1) atari = true;
      if (atari && pv.libs.length > 1) {
        setTimeout(() => sound('check'), 120);
        toast('<b>アタリ！</b>', 'check');
      }
    }
    proceed();
  }

  function stateForAI(G) {
    return {
      size: G.size, board: Array.from(G.board), turn: G.turn, ko: G.ko, caps: G.caps.slice(),
      rule: G.rule, goal: G.goal, komi: G.komi,
      last: G.last ? G.last.p : -1, lastPass: !!(G.last && G.last.p === PASS),
    };
  }

  function onHint() {
    if (!humanTurn()) return;
    const G = app.G;
    app.preview = null;
    if (app.tsume) {
      const left = app.tsume.n - blackMovesMade();
      const sols = app.tsume.failed ? [] : app.tsume.solver.solutions(G.board, G.ko, left);
      if (!sols.length) { toast('「まった」で もどってみよう'); return; }
      app.hint = sols[0];
      return render();
    }
    const btn = $('btn-hint');
    btn.disabled = true;
    btn.classList.add('busy');
    const tk = app.token;
    ask('think', G, 'hint').then(m => {
      btn.classList.remove('busy');
      if (tk !== app.token || app.G !== G || m === null) { render(); return; }
      app.hint = m;
      render();
    });
  }

  function canUndo() {
    if (app.G.result === 'resign' || app.G.result === 'score') return true;
    if (app.scoring) return true;
    if (!app.moves.length) return false;
    if (app.mode === 'two') return true;
    return undoTarget() >= 0;
  }
  // まったで戻る先（人が打つ番の局面のうち、いまより前で一番新しいもの）
  function undoTarget() {
    for (let k = app.moves.length - 1; k >= 0; k--) {
      if (app.human[app.states[k].turn] && !E.needsScoring(app.states[k])) return k;
    }
    return -1;
  }

  function onUndo() {
    const top = app.states[app.states.length - 1];
    if ((app.G.result === 'resign' || app.G.result === 'score') && app.G !== top) {
      // こうさん・かぞえた結果を取り消して、その局面にもどる
      app.G = top;
      if (E.needsScoring(app.G)) { app.scoring = null; save(); return enterScoring(); }
      save();
      render();
      return proceed();
    }
    if (!canUndo()) return;
    app.scoring = null;
    let k = app.mode === 'two' ? app.moves.length - 1 : undoTarget();
    if (app.mode === 'two') while (k > 0 && E.needsScoring(app.states[k])) k--;
    if (k < 0) k = 0;
    app.token++;
    app.busy = false;
    app.moves.length = k;
    app.states.length = k + 1;
    app.G = app.states[k];
    if (app.tsume) app.tsume.failed = false;
    app.preview = null;
    app.look = null;
    app.hint = null;
    app.estimate = null;
    save();
    render();
    toast('1手 もどしたよ');
    proceed();
  }

  function onResign() {
    if (!canResign()) return;
    if (!confirm('こうさん しますか？')) return;
    app.G = E.resign(app.G); // states には積まない（まったで こうさん前に戻れる）
    save();
    render();
    finish();
  }

  function onEstimate() {
    const G = app.G;
    const tk = app.token;
    toast('かぞえているよ…');
    ask('own', G).then(own => {
      if (tk !== app.token || app.G !== G) return;
      app.estimate = own;
      app.preview = null;
      render();
    });
  }

  // ---------- 数える ----------

  function enterScoring() {
    const G = app.G;
    app.busy = true;
    render();
    const tk = app.token;
    ask('dead', G).then(dead => {
      if (tk !== app.token || app.G !== G) return;
      app.busy = false;
      app.scoring = { dead: new Set(dead) };
      render();
      toast('おわり！ かぞえよう');
    });
  }

  function toggleDead(p) {
    const G = app.G;
    if (!G.board[p]) return;
    const gr = E.groupAt(G.board, G.size, p);
    const d = app.scoring.dead;
    const on = !d.has(p);
    for (const s of gr.stones) { if (on) d.add(s); else d.delete(s); }
    render();
  }

  function onResume() {
    if (!app.scoring) return;
    app.scoring = null;
    commitResume();
  }
  function commitResume() {
    const G = E.apply(app.G, E.RESUME);
    app.states.push(G);
    app.moves.push(E.RESUME);
    app.G = G;
    save();
    render();
    toast('つづきを うとう');
    proceed();
  }

  function onScoreOK() {
    if (!app.scoring) return;
    const dead = app.scoring.dead;
    app.scoring = null;
    app.G = E.finishScore(app.G, dead); // states には積まない（まったで もどれる）
    save();
    render();
    finish();
  }

  // ---------- CPU ----------

  let worker = null, workerOK = typeof Worker !== 'undefined', reqId = 0;
  const pending = new Map();
  function runLocal(job) {
    setTimeout(() => {
      const st = job.st;
      st.board = Int8Array.from(st.board);
      let r;
      if (job.kind === 'dead') r = AI.guessDead(st);
      else if (job.kind === 'own') r = Array.from(AI.ownership(st, 800));
      else r = AI.think(st, job.level);
      job.resolve(r);
    }, 30);
  }
  function getWorker() {
    if (!workerOK) return null;
    if (!worker) {
      try {
        worker = new Worker('js/worker.js');
        worker.onmessage = e => {
          const job = pending.get(e.data.id);
          pending.delete(e.data.id);
          if (job) job.resolve(e.data.result);
        };
        worker.onerror = () => {
          // file:// などで Worker が使えないときは画面側で考える
          workerOK = false;
          worker = null;
          for (const job of pending.values()) runLocal(job);
          pending.clear();
        };
      } catch (e) {
        workerOK = false;
        worker = null;
      }
    }
    return worker;
  }
  function ask(kind, G, level) {
    return new Promise(resolve => {
      const job = { kind, st: stateForAI(G), level, resolve };
      const w = getWorker();
      if (!w) return runLocal(job);
      const id = ++reqId;
      pending.set(id, job);
      w.postMessage({ id, kind, st: job.st, level });
    });
  }

  function proceed() {
    const G = app.G;
    if (G.winner !== null || app.human[G.turn] || app.scoring || E.needsScoring(G)) return;
    app.busy = true;
    render();
    const tk = app.token;
    const t0 = Date.now();
    if (app.tsume) {
      setTimeout(() => {
        if (tk !== app.token || app.G !== G) return;
        const left = app.tsume.n - blackMovesMade();
        const d = app.tsume.solver.bestDefense(G.board, G.ko, Math.max(1, left));
        app.busy = false;
        commit(d.move);
        if (app.tsume && app.tsume.failed) setTimeout(() => { if (tk === app.token) tsumeResult('fail'); }, 900);
      }, app.tsume.demo ? 700 : 600);
      return;
    }
    ask('think', G, app.level).then(m => {
      if (tk !== app.token || app.G !== G) return;
      setTimeout(() => {
        if (tk !== app.token || app.G !== G) return;
        app.busy = false;
        if (m === null || !E.canApply(G, m)) m = PASS;
        commit(m);
      }, Math.max(0, 600 - (Date.now() - t0)));
    });
  }

  function finish() {
    const G = app.G;
    app.busy = false;
    render();
    if (app.tsume) return app.tsume.demo ? tsumeDemoEnd() : tsumeResult('solved');
    let title, text = '', cls = '';
    const solo = app.mode === 'cpu';
    const margin = G.score ? Math.abs(G.score.total[0] - G.score.total[1]) : 0;
    if (G.winner === -1) {
      title = 'ひきわけ';
      text = G.result === 'score' ? 'おなじ かず だったよ（じご）。' : `とった 石が おなじ かず（${G.caps[0]}こ）だったので ひきわけ だよ。`;
    } else {
      const wn = playerName(G.winner), ln = playerName(1 - G.winner);
      const won = solo ? app.human[G.winner] : true;
      title = solo ? (won ? 'かったよ！ おめでとう！' : 'まけちゃった…') : `${wn}（${E.SIDES[G.winner].name}）の かち！`;
      cls = won ? 'win' : 'lose';
      if (G.result === 'capture') text = solo ? (won ? `さきに ${G.goal}こ とったよ！ すごい！` : `CPU が さきに ${G.goal}こ とったよ。「まった」で もどって やりなおせるよ！`) : `さきに ${G.goal}こ とったよ！`;
      else if (G.result === 'limit') text = `とった 石の かずで しょうぶ（くろ ${G.caps[0]}こ・しろ ${G.caps[1]}こ）。`;
      else if (G.result === 'resign') text = `${ln}が こうさん したよ。`;
      else if (G.result === 'score') text = `${margin} もく の さで ${solo ? (won ? 'あなた' : 'CPU') : wn}の かち！`;
      if (solo && !won && G.result === 'resign') text = 'こうさん したよ。また ちょうせん してね！';
      if (won) { sound('win'); confetti(); } else sound('lose');
    }
    $('result-title').textContent = title;
    $('result-title').className = cls;
    $('result-text').textContent = text;
    $('result-score').innerHTML = G.score ? scoreTable(G.score) : '';
    $('btn-result-undo').hidden = !canUndo();
    setTimeout(() => { if (!document.querySelector('dialog[open]')) $('dlg-result').showModal(); }, 700);
  }

  // ---------- いしとり もんだい ----------

  function blackMovesMade() {
    let n = 0;
    for (let k = 0; k < app.moves.length; k++) if (app.states[k].turn === 0) n++;
    return n;
  }

  function tsumeStart(idx) {
    const pr = PROBS[idx];
    const pos = TS.parse(pr.rows);
    const s = E.newGame({ size: pos.size, rule: 'capture', goal: 9999 });
    s.board = pos.board;
    s.turn = 0;
    return s;
  }

  function startTsume(idx, moves) {
    app.token++;
    app.busy = false;
    app.scoring = null;
    app.estimate = null;
    app.mode = 'tsume';
    app.human = [true, false];
    const pr = PROBS[idx];
    const pos = TS.parse(pr.rows);
    app.size = pos.size;
    app.tsume = { idx, solver: new TS.Solver(pos.size, pos.target), target: pos.target, n: (pr.moves + 1) / 2, failed: false, demo: false };
    document.body.classList.remove('scoring');
    document.body.classList.add('tsume-mode');
    rebuild([]);
    for (const m of moves || []) {
      // 保存されていた途中の手を、正解判定つきでもう一度たどる
      if (app.G.winner !== null || !E.canApply(app.G, m)) break;
      app.G = E.apply(app.G, m);
      app.states.push(app.G);
      app.moves.push(m);
      if (app.tsume.solver.captured(app.G.board)) break;
    }
    // くろの番で、まだ取れていない局面までもどす
    while (app.moves.length && (app.G.turn === 1 || app.tsume.solver.captured(app.G.board))) {
      app.moves.pop(); app.states.pop(); app.G = app.states[app.states.length - 1];
    }
    if (app.moves.length) {
      const left = app.tsume.n - blackMovesMade();
      app.tsume.failed = left < 1 || !app.tsume.solver.attack(app.G.board, app.G.ko, left);
    }
    $('kifu').innerHTML = '';
    setupBoard();
    save();
    render();
  }

  function openTsumeList() {
    const done = Object.keys(app.tsumeDone).length;
    let h = `<p class="ts-count">クリア <b>${done}</b> / ${PROBS.length}もん</p>`;
    for (const n of [1, 3, 5]) {
      h += `<h3>${n}手（${['', 'まずは ここから', '', 'すこし むずかしい', '', 'チャレンジ'][n]}）</h3><div class="ts-grid">`;
      PROBS.forEach((p, i) => {
        if (p.moves !== n) return;
        const ok = app.tsumeDone[i];
        h += `<button type="submit" value="${i}" class="ts-btn${ok ? ' done' : ''}${app.tsume && app.tsume.idx === i ? ' cur' : ''}">` +
          `<b>${i + 1}</b><small>${p.title}</small>${ok ? '<i>★</i>' : ''}</button>`;
      });
      h += '</div>';
    }
    $('tsume-list').innerHTML = h;
    $('dlg-tsume').showModal();
  }

  function answerLine(idx) {
    const pr = PROBS[idx];
    const pos = TS.parse(pr.rows);
    const S = new TS.Solver(pos.size, pos.target);
    return S.mainLine(pos.board, -1, (pr.moves + 1) / 2).line;
  }
  function lineHTML(size, line) {
    return line.map((m, k) => `<span class="s${k % 2}">${k % 2 ? '○' : '●'}${E.pointName(size, m)}</span>`).join(' ');
  }

  // kind: 'solved' | 'fail' | 'answer'
  function tsumeResult(kind) {
    const idx = app.tsume.idx, pr = PROBS[idx];
    if (kind === 'solved') {
      app.tsumeDone[idx] = true;
      save();
      sound('win');
      confetti();
    } else if (kind === 'fail') {
      sound('lose');
    }
    const title = { solved: 'せいかい！ おみごと！', fail: 'ざんねん…', answer: `第${idx + 1}問の こたえ` }[kind];
    let h = `<h2 class="${kind === 'solved' ? 'win' : kind === 'fail' ? 'lose' : ''}">${title}</h2>`;
    h += `<p class="ts-sub">第${idx + 1}問「${pr.title}」（${pr.moves}手）</p>`;
    if (kind === 'fail') {
      h += '<p>しろに にげられちゃった。「まった」で もどるか、もういちど はじめから やってみよう。どうしても わからない ときは「こたえを みる」を おしてね。</p>';
    } else {
      h += `<div class="ts-answer">こたえ：${lineHTML(app.size, answerLine(idx))}</div><p class="ts-text">${pr.text}</p>`;
      const pos = TS.parse(pr.rows);
      const traps = new TS.Solver(pos.size, pos.target).traps(pos.board, (pr.moves + 1) / 2);
      if (traps.length) {
        const nm = p => (p === PASS ? 'パス' : E.pointName(pos.size, p));
        h += '<div class="ts-traps"><b>まちがえやすい 手</b><ul>' +
          traps.map(([a, d]) => `<li><span class="s0">●${nm(a)}</span> → <span class="s1">○${nm(d)}</span> で にげられちゃう</li>`).join('') + '</ul></div>';
      }
    }
    const btn = (v, label, cls) => `<button type="submit" value="${v}"${cls ? ` class="${cls}"` : ''}>${label}</button>`;
    let b = '';
    if (kind === 'solved') b = btn('list', 'もんだい いちらん') + (idx + 1 < PROBS.length ? btn('next', 'つぎの もんだい', 'primary') : '');
    else if (kind === 'fail') b = btn('undo', 'まった') + btn('answer', 'こたえを みる') + btn('retry', 'もういちど', 'primary');
    else b = btn('close', 'とじる') + btn('demo', 'こたえを ならべる', 'primary');
    $('tsume-result').innerHTML = h + `<div class="dlg-buttons">${b}</div>`;
    setTimeout(() => {
      if (document.querySelector('dialog[open]')) return;
      $('dlg-tsume-result').showModal();
    }, kind === 'solved' ? 700 : 100);
  }

  function onTsumeResult(v) {
    if (!app.tsume) return;
    const idx = app.tsume.idx;
    if (v === 'next') startTsume(idx + 1, []);
    else if (v === 'list') openTsumeList();
    else if (v === 'retry') startTsume(idx, []);
    else if (v === 'undo') onUndo();
    else if (v === 'answer') tsumeResult('answer');
    else if (v === 'demo') tsumeDemo();
  }

  // こたえを盤に ならべる
  function tsumeDemo() {
    const idx = app.tsume.idx;
    startTsume(idx, []);
    const line = answerLine(idx);
    app.tsume.demo = true;
    app.busy = true;
    render();
    const tk = app.token;
    const step = k => {
      if (tk !== app.token) return;
      if (k >= line.length) return;
      app.busy = false;
      app.human = [true, true]; // 両方とも ここで打つ
      commit(line[k]);
      app.busy = app.G.winner === null;
      render();
      setTimeout(() => step(k + 1), 1100);
    };
    setTimeout(() => step(0), 600);
  }
  function tsumeDemoEnd() {
    app.tsume.demo = false;
    app.human = [true, false];
    render();
    toast('これで とれた！');
  }

  window.IgoApp = app; // デバッグ用
  document.addEventListener('DOMContentLoaded', init);
})();
