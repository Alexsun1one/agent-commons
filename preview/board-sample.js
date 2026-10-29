/* LG-4 R2: demo-only content; excluded from live builds. */
window.COMMONS_BOARD_SAMPLE = {
create: function (env) {
  var TAU = env.TAU;
  var createBoard = env.createBoard;
  var fill = env.fill;
  var instantiate = env.instantiate;
  var penFrom = env.penFrom;
  var r1 = env.r1;
  var r2 = env.r2;
  var templateList = env.templateList;
  const SIM_LISTENER = 'sim-listener';
  const SIM_HOST = 'sim-host';
  const SAVE_KEY = 'board.demo.v1';
  const P = { root: null, inst: null, pip: null, role: 'host', sim: false, timers: [], saveTimer: 0, offs: [] };

  function seeded(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
  // 手写感：围一圈、打勾、弯箭头、下划线；带一点抖动和速度压感
  function loopPts(cx, cy, rx, ry, rnd) {
    const out = [];
    const n = 72, a0 = -2.5, turns = 1.1;
    for (let i = 0; i <= n; i++) {
      const t = i / n, a = a0 + t * turns * TAU;
      const k = 1 + (rnd() - 0.5) * 0.02 + 0.035 * Math.sin(t * 5.3);
      out.push(r1(cx + Math.cos(a) * rx * k), r1(cy + Math.sin(a) * ry * k * (1 + t * 0.05)), r2(0.45 + 0.4 * Math.sin(t * Math.PI)));
    }
    return out;
  }
  function checkPts(x, y, s) {
    const out = [];
    for (let i = 0; i <= 10; i++) { const t = i / 10; out.push(r1(x + t * s * 0.34), r1(y + t * t * s * 0.42), r2(0.5 + 0.3 * t)); }
    for (let i = 1; i <= 16; i++) { const t = i / 16; out.push(r1(x + s * 0.34 + t * s * 0.66), r1(y + s * 0.42 - (t * 1.1 - 0.1 * t * t) * s * 0.9), r2(0.8 - 0.45 * t)); }
    return out;
  }
  function crossPts(x, y, s, second) {
    const out = [];
    for (let i = 0; i <= 10; i++) { const t = i / 10; out.push(r1(second ? x + s - t * s : x + t * s), r1(y + t * s + Math.sin(t * 3) * 1.2), r2(0.55 + 0.2 * Math.sin(t * Math.PI))); }
    return out;
  }
  function curvePts(p0, p1, p2, n) {
    const out = [];
    for (let i = 0; i <= n; i++) { const t = i / n, u = 1 - t; out.push(r1(u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x), r1(u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y), r2(0.4 + 0.45 * Math.sin(t * Math.PI))); }
    return out;
  }
  function wavePts(x0, x1, y, rnd) {
    const out = [];
    const n = 28;
    for (let i = 0; i <= n; i++) { const t = i / n; out.push(r1(x0 + (x1 - x0) * t), r1(y + Math.sin(t * 9) * 1.6 + (rnd() - 0.5) * 0.6 - t * 2), r2(0.35 + 0.5 * Math.sin(t * Math.PI))); }
    return out;
  }

  function lessonDoc() {
    const objs = [];
    let n = 0;
    const id = () => 'seed-' + (++n).toString(36);
    const push = o => { if (!o.id) o.id = id(); o.z = objs.length + 1; objs.push(o); return o; };
    const tpl = name => templateList().find(t => t.id === name);
    const rnd = seeded(13);
    push({ kind: 'frame', x: 0, y: 0, w: 1200, h: 640, name: '① 做完长什么样' });
    push({ kind: 'frame', x: 1280, y: 0, w: 1200, h: 640, name: '② 好清单和坏清单' });
    // 框一
    push({ kind: 'text', x: 64, y: 52, w: 820, h: 36, text: '怎么给 Agent 写验收清单', fs: 'display', bold: true, color: 'ink' });
    push({ kind: 'text', x: 64, y: 100, w: 860, h: 22, text: '先把「做完」说清楚，再让 Agent 动手。一次任务从说明到回执，分四步。', fs: 'body', color: 'muted' });
    const flow = tpl('flow');
    if (flow) {
      instantiate(flow, 152, 212, id, {
        s1: { text: '写目标' }, s2: { text: '列可检查的结果' }, s3: { text: '给验证命令' }, s4: { text: '约好回执格式' },
        c1: { text: '一句话说清要什么' }, c2: { text: '每条都能判对错' }, c3: { text: '跑哪条命令算通过' }, c4: { text: '交回来长什么样' }
      }, 'topleft').forEach(push);
    }
    push(penFrom(id(), loopPts(480, 279, 120, 47, rnd), 'cat-6', 2));
    push({ kind: 'text', x: 312, y: 448, w: 340, h: 48, text: '这一步最容易偷懒：\n「做得好一点」不算验收', fs: 'item', color: 'cat-6' });
    push(penFrom(id(), curvePts({ x: 428, y: 442 }, { x: 392, y: 384 }, { x: 410, y: 336 }, 22), 'cat-6', 2));
    push(penFrom(id(), curvePts({ x: 398, y: 346 }, { x: 404, y: 340 }, { x: 410, y: 334 }, 6).concat(curvePts({ x: 410, y: 334 }, { x: 416, y: 342 }, { x: 422, y: 350 }, 6)), 'cat-6', 2));
    push(penFrom(id(), wavePts(252, 386, 92, rnd), 'cat-2', 2));
    push(penFrom(id(), checkPts(1062, 238, 34), 'cat-7', 3));
    push({ kind: 'sticky', x: 900, y: 452, w: 232, h: 132, fill: 'sky-100', text: '课后：给你手上的一个任务写 3 条验收', fs: 'item' });
    // 框二
    push({ kind: 'text', x: 1344, y: 52, w: 820, h: 30, text: '好清单 vs 坏清单', fs: 'feature', bold: true, color: 'ink' });
    push({ kind: 'text', x: 1344, y: 92, w: 900, h: 22, text: '能判对错的才叫验收。右边每一条，Agent 都能自己跑一遍证明。', fs: 'body', color: 'muted' });
    const cmp = tpl('compare');
    let rightHead = null;
    if (cmp) {
      const list = instantiate(cmp, 1344, 160, id, {
        la: { text: '模糊的验收' }, l1: { text: '做得好看一点' }, l2: { text: '跑一下没问题就行' }, l3: { text: '尽量快' },
        ra: { text: '可检查的验收' }, r1: { text: '390 宽度下不横向滚动' }, r2: { text: 'node --check 通过，0 报错' }, r3: { text: '首屏 200ms 内出现内容' }
      }, 'topleft');
      list.forEach(push);
      rightHead = list.find(o => o.text === '可检查的验收');
    }
    const kc = tpl('knowledge');
    let card = null;
    if (kc) { const list = instantiate(kc, 2116, 160, id, null, 'topleft'); list.forEach(push); card = list[0]; }
    if (card && rightHead) push({ kind: 'line', a: { id: card.id, x: card.x + card.w / 2, y: card.y + card.h / 2 }, b: { id: rightHead.id, x: rightHead.x + rightHead.w / 2, y: rightHead.y + rightHead.h / 2 }, route: 'curve', arrow: 'end', dash: true, color: 'teal-500', size: 2 });
    [0, 1, 2].forEach(i => push(penFrom(id(), checkPts(1996, 236 + i * 60, 22), 'cat-7', 2)));
    [0, 1, 2].forEach(i => { push(penFrom(id(), crossPts(1628, 238 + i * 60, 16, false), 'cat-6', 2)); push(penFrom(id(), crossPts(1628, 238 + i * 60, 16, true), 'cat-6', 2)); });
    push({ kind: 'sticky', x: 1344, y: 452, w: 260, h: 132, fill: 'violet-100', text: '每条验收都配一句「怎么证明」', fs: 'item' });
    push(penFrom(id(), wavePts(2128, 2420, 344, rnd), 'cat-2', 1));
    push({ kind: 'text', x: 2128, y: 356, w: 300, h: 40, text: '出处：知识地图，有人实际用过', fs: 'ui', color: 'muted' });
    return { format: 'commons-board', version: 1, objects: objs };
  }

  function myName() {
    try { const id = window.CommonsMember && window.CommonsMember.identity(); return id && id.hasProfile ? id.name : '我'; } catch (err) { return '我'; }
  }
  function pageView() {
    return '<section class="bd-page" data-board-page>' +
      '<header class="page-head bd-page-head"><div>' +
      '<h1>怎么给 Agent 写验收清单 <span class="pill outline">示例</span></h1>' +
      '<p>边讲边画，框可以当幻灯片放。</p></div>' +
      '<div class="bd-page-tools">' +
      '<div class="segmented small" role="group" aria-label="我的角色">' +
      '<button type="button" data-board-act="role" data-role="host" aria-pressed="true">主持人</button>' +
      '<button type="button" data-board-act="role" data-role="drawer" aria-pressed="false">能画</button>' +
      '<button type="button" data-board-act="role" data-role="viewer" aria-pressed="false">只看</button></div>' +
      '<button type="button" class="bd-switch" role="switch" aria-checked="false" data-board-act="sim"><span class="bd-switch-track" aria-hidden="true"><span class="bd-switch-thumb"></span></span><span class="bd-switch-label">模拟一位听众</span></button>' +
      '<button type="button" class="button ghost small" data-board-act="reset">恢复示例</button>' +
      '</div></header>' +
      '<div class="bd-host" data-board-host>' +
      '<div class="bd-pip" hidden><div class="bd-pip-head"><span class="bd-pip-title">听众视角 · 模拟</span><span class="bd-pip-sync" data-board-sync>同步中</span></div><div class="bd-pip-board"></div></div>' +
      '</div>' +
      '<p class="bd-sim-note" data-board-note hidden></p>' +
      '</section>';
  }
  function pageSave() {
    clearTimeout(P.saveTimer);
    P.saveTimer = setTimeout(() => {
      P.saveTimer = 0;
      if (!P.inst || !window.Commons || typeof window.Commons.write !== 'function') return;
      const data = { v: 1, objects: P.inst.getDoc().objects };
      const size = JSON.stringify(data).length;
      if (size > 2.5e6) return;
      window.Commons.write(SAVE_KEY, data);
    }, 900);
  }
  function pageOp(op) {
    if (P.pip) P.pip.apply(op);
    if (op && (op.type === 'add' || op.type === 'update' || op.type === 'remove' || op.type === 'reorder')) pageSave();
  }
  function pageMount() {
    const root = document.querySelector('#main [data-board-page]') || document.querySelector('[data-board-page]');
    if (!root) return;
    if (P.root === root && P.inst) return;
    pageDestroy();
    P.root = root;
    const host = root.querySelector('[data-board-host]');
    let saved = null;
    try { saved = window.Commons && typeof window.Commons.read === 'function' ? window.Commons.read(SAVE_KEY, null) : null; } catch (err) { saved = null; }
    const doc = saved && Array.isArray(saved.objects) && saved.objects.length ? saved : lessonDoc();
    P.role = 'host';
    P.inst = createBoard(host, { doc, role: P.role, actor: (window.Commons && window.Commons.currentPersonId) || 'local-self', name: myName(), onOp: pageOp, initialFrame: true });
    const onClick = e => {
      const btn = e.target.closest('[data-board-act]');
      if (!btn || btn.closest('[data-board]')) return;
      const act = btn.dataset.boardAct;
      if (act === 'role') setPageRole(btn.dataset.role);
      else if (act === 'sim') setSim(!P.sim);
      else if (act === 'reset') resetDemo();
    };
    root.addEventListener('click', onClick);
    P.offs.push(() => root.removeEventListener('click', onClick));
  }
  function resetDemo() {
    if (!P.root) return;
    const wasSim = P.sim;
    setSim(false);
    try { if (window.Commons && typeof window.Commons.write === 'function') window.Commons.write(SAVE_KEY, null); } catch (err) { /* 忽略 */ }
    const host = P.root.querySelector('[data-board-host]');
    P.inst.destroy();
    P.inst = createBoard(host, { doc: lessonDoc(), role: P.role, actor: (window.Commons && window.Commons.currentPersonId) || 'local-self', name: myName(), onOp: pageOp, initialFrame: true });
    if (wasSim) setSim(true);
  }
  function setPageRole(r) {
    if (!P.inst) return;
    P.role = r;
    P.root.querySelectorAll('[data-board-act="role"]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.role === r)));
    const restart = P.sim;
    if (restart) setSim(false);
    P.inst.setRole(r, { laser: false });
    P.root.querySelector('.bd-switch-label').textContent = r === 'viewer' ? '模拟讲课人' : '模拟一位听众';
    if (restart) setSim(true);
  }
  function simLater(fn, ms) { const t = setTimeout(() => { P.timers = P.timers.filter(x => x !== t); fn(); }, ms); P.timers.push(t); return t; }
  function simEvery(fn, ms) { const t = setInterval(fn, ms); P.timers.push(t); return t; }
  function setSim(onoff) {
    if (!P.root || !P.inst) return;
    const sw = P.root.querySelector('[data-board-act="sim"]');
    const note = P.root.querySelector('[data-board-note]');
    P.timers.forEach(t => { clearTimeout(t); clearInterval(t); });
    P.timers = [];
    if (P.pip) { P.pip.destroy(); P.pip = null; }
    const pipBox = P.root.querySelector('.bd-pip');
    pipBox.hidden = true;
    P.inst.apply({ type: 'cursor', actor: SIM_LISTENER, gone: true });
    P.inst.apply({ type: 'cursor', actor: SIM_HOST, gone: true });
    if (P.inst.following() === SIM_HOST) P.inst.follow(null);
    P.sim = !!onoff;
    sw.setAttribute('aria-checked', String(P.sim));
    note.hidden = !P.sim;
    if (!P.sim) return;
    if (P.role === 'viewer') simHost(note); else simListener(pipBox, note);
  }
  // 我讲、模拟听众听：右上角小窗是听众那端的白板（另一个实例），吃我的 op、跟随我的视角；听众的光标和一笔回放到我这边
  function simListener(pipBox, note) {
    pipBox.hidden = false;
    const main = P.inst;
    P.pip = createBoard(pipBox.querySelector('.bd-pip-board'), { doc: main.getDoc(), role: 'drawer', actor: SIM_LISTENER, name: '叶知', chrome: 'none', onOp: op => main.apply(op) });
    P.pip.follow(main.actor);
    main.broadcastView();
    note.textContent = '叶知（模拟听众）在跟随你的视角。你画的每一笔都以 op 发到右上角她的白板；她的光标和一笔批注也以 op 回放到你这边。';
    const syncEl = pipBox.querySelector('[data-board-sync]');
    const frames = main.frames();
    const f = frames[0] || { x: 0, y: 0, w: 800, h: 500 };
    let t = 0;
    let drew = false;
    simEvery(() => {
      t += 0.09;
      const x = f.x + f.w * (0.5 + 0.32 * Math.sin(t * 0.9)), y = f.y + f.h * (0.52 + 0.22 * Math.sin(t * 1.7 + 0.6));
      main.apply({ type: 'cursor', actor: SIM_LISTENER, name: '叶知', x: r1(x), y: r1(y) });
    }, 90);
    simLater(() => {
      if (!P.pip || drew) return;
      drew = true;
      const cx = f.x + f.w * 0.76, cy = f.y + f.h * 0.52;
      const pts = [];
      for (let i = 0; i <= 54; i++) { const k = i / 54, a = -1.9 + k * 1.15 * TAU; pts.push(r1(cx + Math.cos(a) * 92 * (1 + 0.04 * Math.sin(k * 7))), r1(cy + Math.sin(a) * 50), r2(0.45 + 0.35 * Math.sin(k * Math.PI))); }
      P.pip.drawScripted(pts, { color: 'cat-8', size: 2 }, 45);
    }, 1800);
    simEvery(() => {
      if (!P.pip) return;
      const ok = main.hash() === P.pip.hash();
      syncEl.textContent = ok ? '两端一致 · ' + main.opCount() + ' 条 op' : '同步中…';
      syncEl.classList.toggle('is-ok', ok);
    }, 700);
  }
  // 我只看、模拟讲课人：讲课人按框讲、用激光笔指，我的视角跟着走；我拖动画布就退出跟随
  function simHost(note) {
    const main = P.inst;
    const frames = main.frames();
    if (!frames.length) { note.textContent = '画布上没有框，模拟讲课人没法按框讲。点「恢复示例」再试。'; return; }
    note.textContent = '顾澄（模拟讲课人）在按框讲，你的视角跟着走。拖动画布就会退出跟随，点「回到讲课人视角」回来。';
    let i = 0;
    const show = () => {
      const f = frames[i % frames.length];
      main.apply({ type: 'view', actor: SIM_HOST, name: '顾澄', x: f.x - 40, y: f.y - 60, w: f.w + 80, h: f.h + 100 });
      let k = 0;
      const lx = f.x + f.w * 0.3, ly = f.y + f.h * 0.42;
      const laser = simEvery(() => {
        k += 1;
        if (k > 22) { clearInterval(laser); return; }
        const a = k / 22;
        const x = lx + a * f.w * 0.4, y = ly + Math.sin(a * Math.PI * 2) * 30;
        main.apply({ type: 'laser', actor: SIM_HOST, x: r1(x), y: r1(y) });
        main.apply({ type: 'cursor', actor: SIM_HOST, name: '顾澄', x: r1(x), y: r1(y) });
      }, 45);
      i += 1;
    };
    main.follow(SIM_HOST);
    show();
    simEvery(show, 3600);
  }
  function pageDestroy() {
    P.timers.forEach(t => { clearTimeout(t); clearInterval(t); });
    P.timers = [];
    if (P.saveTimer) { clearTimeout(P.saveTimer); P.saveTimer = 0; if (P.inst) { try { const data = { v: 1, objects: P.inst.getDoc().objects }; if (JSON.stringify(data).length < 2.5e6 && window.Commons) window.Commons.write(SAVE_KEY, data); } catch (err) { /* 保存失败不拦截换页 */ } } }
    if (P.pip) { P.pip.destroy(); P.pip = null; }
    if (P.inst) { P.inst.destroy(); P.inst = null; }
    P.offs.splice(0).forEach(fn => fn());
    P.root = null;
    P.sim = false;
  }


  return { page: pageView, mount: pageMount, destroy: pageDestroy, lessonDoc: lessonDoc, current: () => P.inst, pip: () => P.pip };
}
};
