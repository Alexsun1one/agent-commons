/* R13 BOARD-1 · 讲课白板 window.CommonsBoard
 *
 * 嵌入（给 ROOM-1）
 *   const board = CommonsBoard.mount(el, { doc, role, readOnly, onOp, actor, name, chrome, laser })
 *     doc       getDoc() 的快照，或对象数组；不给就是空白板
 *     role      'host' 全部权限 | 'drawer' 能画 | 'viewer' 只看（激光笔要 laser: true 才能用）
 *     readOnly  强制只看：不产出任何文档 op
 *     onOp      本端产生的每个 op 都从这里抛出（文档 op 和在场 op）
 *     actor     本端身份（写进 op.actor）；name 显示名；chrome 'full' | 'none'（只要画布）
 *   返回 { apply(op), getDoc(), setRole(role, { laser }), follow(userId), destroy(), ... }
 *
 * 文档 op：{ id, actor, clock, type: 'add' | 'update' | 'remove' | 'reorder', target, patch }
 *   clock 是 Lamport 时钟。每个字段按 (clock, actor) 定序，后写的赢；op.id 去重；乱序、重复到达都收敛。
 *   reorder 只改 z（分数层级）。投票写成每人一个字段 v.<actor>，并发 +1 不会互相覆盖。
 * 在场 op（不进文档、不进撤销）：
 *   { type: 'cursor', actor, x, y, name }，离开时 { type: 'cursor', actor, gone: true }
 *   { type: 'view', actor, x, y, w, h, name }  讲课人看到的世界坐标矩形，跟随就是把它装进自己的视口
 *   { type: 'laser', actor, x, y }             激光笔轨迹点，1 秒后淡出
 *
 * 渲染：静态层 + 活动层两张 canvas。只有状态变了才排一帧 rAF，静止时一帧都不排。
 * 颜色全部在运行时从 tokens.css 的 CSS 变量读取；文档里只存 token 名。
 */
(function () {
  'use strict';

  /* ---------- 小工具 ---------- */

  function isDemo() {
    if (window.COMMONS_BUILD_LIVE === true || (window.CommonsAPI && window.CommonsAPI.mode === 'live')) return false;
    if (window.COMMONS_BUILD && window.COMMONS_BUILD.mode) return window.COMMONS_BUILD.mode === 'demo';
    return !!((window.CommonsAPI && window.CommonsAPI.mode === 'demo') || window.location.protocol === 'file:');
  }
  var demoModule = null;
  function demo() {
    if (!isDemo()) return null;
    var source = window.COMMONS_BOARD_SAMPLE;
    if (!source) return null;
    if (!demoModule) demoModule = source.create({ TAU: TAU, createBoard: createBoard, fill: fill, instantiate: instantiate, penFrom: penFrom, r1: r1, r2: r2, templateList: templateList });
    return demoModule;
  }
  function pageView() { const d = demo(); return d ? d.page() : '<section class="bd-page"><p role="status">暂无白板文档，请从房间打开。</p></section>'; }
  function pageMount() { const d = demo(); if (d) d.mount(); }
  function pageDestroy() { if (demoModule) demoModule.destroy(); }
  function lessonDoc() { const d = demo(); return d ? d.lessonDoc() : { format: 'commons-board', version: 1, objects: [] }; }

  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const now = () => performance.now();
  const r1 = v => Math.round(v * 10) / 10;
  const r2 = v => Math.round(v * 100) / 100;
  const copy = v => (v == null || typeof v !== 'object' ? v : JSON.parse(JSON.stringify(v)));
  const same = (a, b) => a === b || (!!a && !!b && typeof a === 'object' && typeof b === 'object' && JSON.stringify(a) === JSON.stringify(b));
  const rid = () => Math.random().toString(36).slice(2, 9);
  const isEditable = el => !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
  const mod = e => e.metaKey || e.ctrlKey;
  const unit = (dx, dy) => { const l = Math.hypot(dx, dy) || 1; return { x: dx / l, y: dy / l }; };
  const stable = v => {
    if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
    if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
    return JSON.stringify(v);
  };
  const fnv = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16).padStart(8, '0'); };
  const intersects = (a, b) => a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y;
  const inside = (p, b, t) => p.x >= b.x - t && p.x <= b.x + b.w + t && p.y >= b.y - t && p.y <= b.y + b.h + t;
  function segDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
    t = clamp(t, 0, 1);
    return Math.hypot(px - ax - t * dx, py - ay - t * dy);
  }
  function bezierEase(x1, y1, x2, y2) {
    const bx = t => 3 * (1 - t) * (1 - t) * t * x1 + 3 * (1 - t) * t * t * x2 + t * t * t;
    const by = t => 3 * (1 - t) * (1 - t) * t * y1 + 3 * (1 - t) * t * t * y2 + t * t * t;
    const dx = t => 3 * (1 - t) * (1 - t) * x1 + 6 * (1 - t) * t * (x2 - x1) + 3 * t * t * (1 - x2);
    return t => {
      if (t <= 0) return 0;
      if (t >= 1) return 1;
      let s = t;
      for (let i = 0; i < 8; i++) {
        const e = bx(s) - t, d = dx(s);
        if (Math.abs(e) < 1e-5 || !d) break;
        s = clamp(s - e / d, 0, 1);
      }
      return by(s);
    };
  }

  /* ---------- 图标（24 网格，1.6 描边，和 app.js 的 icon() 同一套画法） ---------- */

  const ICON = {
    board: 'M3 4h18v12H3zM12 16v4M8 20h8M6.5 12.5l3-3 2.5 2 4.5-4.5',
    select: 'M6 3.5 18 10.2l-5.3 1.5-2.4 5.3zM12.7 11.7l4 4',
    hand: 'M8 13V5.5a1.5 1.5 0 0 1 3 0V12M11 11V4.5a1.5 1.5 0 0 1 3 0V12M14 11.5V6a1.5 1.5 0 0 1 3 0v8a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-2.7L3.5 14a1.6 1.6 0 0 1 2.6-1.8L8 14.5',
    pen: 'M4 20l1.2-4.8L15.8 4.6a2 2 0 0 1 2.8 0l.8.8a2 2 0 0 1 0 2.8L8.8 18.8zM14 6.5l3.5 3.5',
    marker: 'M14.5 4.5l5 5-8 8H6.5v-5zM6.5 17.5 4 20M12 7l5 5',
    eraser: 'M16.2 4.2 20 8a1.8 1.8 0 0 1 0 2.5L11 19.5H7.5L4 16a1.8 1.8 0 0 1 0-2.5l9.7-9.3a1.8 1.8 0 0 1 2.5 0zM9 10.5l5.5 5.5M11 19.5h9',
    rect: 'M6 5h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z',
    ellipse: 'M12 5c4.4 0 8 3.1 8 7s-3.6 7-8 7-8-3.1-8-7 3.6-7 8-7z',
    diamond: 'M12 3.5 20.5 12 12 20.5 3.5 12z',
    arrow: 'M5 19C9 19 9 7 15 7h4M16 4l3 3-3 3',
    text: 'M5 6V4.5h14V6M12 4.5v15M9 19.5h6',
    sticky: 'M5 4h14v10l-5 6H5zM19 14h-5v6',
    frame: 'M7 3v18M17 3v18M3 7h18M3 17h18',
    image: 'M4 5h16v14H4zM4 15l4.5-4.5 4 4 2.5-2.5L20 17M15.5 9.5h.01',
    laser: 'M14 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1',
    components: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM16.5 13v7M13 16.5h7',
    undo: 'M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
    redo: 'M15 14l5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13',
    minus: 'M5 12h14',
    plus: 'M12 5v14M5 12h14',
    fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
    present: 'M3 4h18v12H3zM12 16v4M8 20h8M10 7.5v5l4.5-2.5z',
    download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
    help: 'M9.2 9a3 3 0 1 1 4.3 2.7c-.9.5-1.5 1.2-1.5 2.3M12 17.5h.01M12 22a10 10 0 1 1 0-20 10 10 0 0 1 0 20z',
    close: 'M6 6l12 12M18 6 6 18',
    prev: 'M15 6l-6 6 6 6',
    next: 'M9 6l6 6-6 6',
    trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
    duplicate: 'M8 8h12v12H8zM4 16V4h12',
    front: 'M5 4h14M12 20V8M7 13l5-5 5 5',
    back: 'M5 20h14M12 4v12M7 11l5 5 5-5',
    group: 'M3 3h7v7H3zM14 14h7v7h-7zM6.5 10v7.5H14M17.5 14V6.5H10',
    ungroup: 'M3 3h7v7H3zM14 14h7v7h-7z',
    alignL: 'M4 4v16M8 7h10v4H8zM8 14h6v4H8z',
    alignC: 'M12 4v16M6 7h12v4H6zM8 14h8v4H8z',
    alignR: 'M20 4v16M6 7h10v4H6zM10 14h6v4h-6z',
    alignT: 'M4 4h16M7 8h4v10H7zM14 8h4v6h-4z',
    alignM: 'M4 12h16M7 6h4v12H7zM14 8h4v8h-4z',
    alignB: 'M4 20h16M7 6h4v10H7zM14 10h4v6h-4z',
    distH: 'M4 4v16M20 4v16M10 7h4v10h-4z',
    distV: 'M4 4h16M4 20h16M7 10h10v4H7z',
    sag: 'M4 7c5 10 11 10 16 0',
    curve: 'M4 18C10 18 14 6 20 6',
    elbow: 'M4 18h8V6h8',
    straight: 'M4 18 20 6',
    arrowEnd: 'M4 12h14M14 7l5 5-5 5',
    dash: 'M3 12h4M10 12h4M17 12h4',
    eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
    upload: 'M12 20V9M7 14l5-5 5 5M5 4h14'
  };
  const ic = name => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="' + ICON[name] + '"/></svg>';

  /* ---------- 常量 ---------- */

  const KINDS = new Set(['pen', 'hl', 'rect', 'ellipse', 'diamond', 'line', 'text', 'sticky', 'card', 'frame', 'image']);
  const SHAPES = new Set(['rect', 'ellipse', 'diamond']);
  const TEXTUAL = new Set(['rect', 'ellipse', 'diamond', 'sticky', 'text', 'card']);
  const ATTACHABLE = new Set(['rect', 'ellipse', 'diamond', 'sticky', 'card', 'text', 'image', 'frame']);
  const WIDTH = { pen: [0, 2.2, 3.8, 6.6], hl: [0, 12, 18, 28], shape: [0, 1.25, 2, 3.25], line: [0, 1.5, 2.25, 3.5] };
  const PALETTE = [['ink', '墨'], ['cat-2', '靛'], ['cat-1', '青'], ['cat-3', '天蓝'], ['cat-4', '紫'], ['cat-6', '品红'], ['cat-5', '深蓝'], ['cat-7', '深青']];
  const CURSOR_COLORS = ['cat-6', 'cat-2', 'cat-7', 'cat-8', 'cat-5', 'cat-1'];
  const STATUS_LABEL = { verified: '已验证', curated: '已整理', candidate: '候选', stale: '可能过时', disputed: '有争议' };
  const FS_FALLBACK = { micro: [11, 16], meta: [12, 18], ui: [13, 20], body: [14, 22], item: [15, 22], section: [18, 26], feature: [22, 30], display: [28, 36], stat: [32, 36], hero: [40, 48] };
  const LASER_LIFE = 1000;
  const GAP = 6;
  const MAX_IMAGE = 5 * 1024 * 1024;
  const HISTORY_MAX = 200;

  const TOOLS = [
    { id: 'select', label: '选择', key: 'V', icon: 'select', view: true },
    { id: 'hand', label: '抓手', key: 'H', icon: 'hand', view: true },
    { sep: true },
    { id: 'pen', label: '笔', key: 'P', icon: 'pen' },
    { id: 'hl', label: '荧光笔', key: 'M', icon: 'marker' },
    { id: 'eraser', label: '橡皮', key: 'E', icon: 'eraser' },
    { sep: true },
    { id: 'rect', label: '矩形', key: 'R', icon: 'rect' },
    { id: 'ellipse', label: '圆', key: 'O', icon: 'ellipse' },
    { id: 'diamond', label: '菱形', key: 'D', icon: 'diamond' },
    { id: 'arrow', label: '连线和箭头', key: 'A', icon: 'arrow' },
    { sep: true },
    { id: 'text', label: '文字', key: 'T', icon: 'text' },
    { id: 'sticky', label: '便签', key: 'N', icon: 'sticky' },
    { id: 'frame', label: '框', key: 'F', icon: 'frame' },
    { id: 'image', label: '插入图片（5MB 以内）', key: 'I', icon: 'image' },
    { sep: true },
    { id: 'laser', label: '激光笔', tip: '激光笔 · L（按住 L 临时用）', key: 'L', icon: 'laser', laser: true }
  ];
  const TOOL_BY_KEY = {};
  TOOLS.forEach(t => { if (t.key) TOOL_BY_KEY['Key' + t.key] = t.id; });

  /* ---------- 文档：对象表 + 字段级后写者赢 ---------- */

  const FIELD = {
    kind: 'k', x: 'n', y: 'n', w: 'n', h: 'n', z: 'n', g: 's', color: 'c', fill: 'c', tc: 'c', size: 'n',
    text: 't', title: 't', meta: 't', fs: 's', align: 's', bold: 'b', pts: 'p', pw: 'n', ph: 'n', a: 'e', b: 'e',
    route: 's', arrow: 's', dash: 'b', name: 't', src: 'i', variant: 's', ref: 's', vote: 'b', radius: 'n'
  };
  const VOTE_KEY = /^v\.[\w-]{1,64}$/;
  const TOKEN_RE = /^[a-z][a-z0-9-]{0,30}(\/\d{1,3})?$/;
  const IMG_RE = /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/;
  const safeUrl = u => (typeof u === 'string' && IMG_RE.test(u) ? u : '');

  function cleanValue(type, v) {
    if (v === null) return null;
    switch (type) {
      case 'k': return KINDS.has(v) ? v : undefined;
      case 'n': return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
      case 's': return typeof v === 'string' && v.length <= 80 ? v : undefined;
      case 't': return typeof v === 'string' ? v.slice(0, 4000) : undefined;
      case 'c': return typeof v === 'string' && TOKEN_RE.test(v) ? v : undefined;
      case 'b': return typeof v === 'boolean' ? v : undefined;
      case 'p': return Array.isArray(v) && v.length <= 60000 && v.every(n => typeof n === 'number' && Number.isFinite(n)) ? v.slice() : undefined;
      case 'e':
        if (!v || typeof v !== 'object' || !Number.isFinite(v.x) || !Number.isFinite(v.y)) return undefined;
        return typeof v.id === 'string' && v.id && v.id.length <= 80 ? { id: v.id, x: v.x, y: v.y } : { x: v.x, y: v.y };
      case 'i': return typeof v === 'string' && v.length < 7.2e6 && IMG_RE.test(v) ? v : undefined;
      default: return undefined;
    }
  }
  function cleanPatch(patch) {
    const out = {};
    if (!patch || typeof patch !== 'object') return out;
    for (const k of Object.keys(patch)) {
      if (k === 'id') continue;
      if (VOTE_KEY.test(k)) { if (patch[k] === 1 || patch[k] === null) out[k] = patch[k]; continue; }
      const type = FIELD[k];
      if (!type) continue;
      const v = cleanValue(type, patch[k]);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }
  const newer = (s, t) => !t || s[0] > t[0] || (s[0] === t[0] && s[1] > t[1]);

  function createDoc(actor) {
    const metas = new Map();
    const live = new Map();
    const vers = new Map();
    const seen = new Set();
    const session = rid();
    let clock = 0;
    let seq = 0;
    let order = null;
    let count = 0;

    function meta(id) {
      let m = metas.get(id);
      if (!m) { m = { on: false, alive: null, state: { id }, f: Object.create(null) }; metas.set(id, m); }
      return m;
    }
    function settle(id, m) {
      const ok = m.on && !!m.state.kind;
      if (ok) live.set(id, m.state); else live.delete(id);
    }
    function apply(op) {
      if (!op || typeof op !== 'object' || typeof op.id !== 'string' || !op.id || seen.has(op.id)) return false;
      const type = op.type;
      const target = op.target;
      if (type !== 'add' && type !== 'update' && type !== 'remove' && type !== 'reorder') return false;
      if (typeof target !== 'string' || !target || target.length > 80) return false;
      const c = Number(op.clock);
      if (!Number.isFinite(c)) return false;
      seen.add(op.id);
      count++;
      if (c > clock) clock = c;
      const stamp = [c, String(op.actor || '')];
      const m = meta(target);
      const wasLive = live.has(target);
      let changed = false;
      let zChanged = false;
      if (type === 'remove') {
        if (newer(stamp, m.alive)) { m.alive = stamp; m.on = false; }
      } else {
        if (type === 'add' && newer(stamp, m.alive)) { m.alive = stamp; m.on = true; }
        const patch = cleanPatch(op.patch);
        for (const k in patch) {
          if (!newer(stamp, m.f[k])) continue;
          m.f[k] = stamp;
          const v = patch[k];
          if (v === null) { if (k in m.state) { delete m.state[k]; changed = true; if (k === 'z') zChanged = true; } }
          else if (!same(m.state[k], v)) { m.state[k] = v; changed = true; if (k === 'z') zChanged = true; }
        }
      }
      settle(target, m);
      const isLive = live.has(target);
      if (isLive !== wasLive) { changed = true; zChanged = true; }
      if (changed) {
        vers.set(target, (vers.get(target) || 0) + 1);
        if (zChanged) order = null;
      }
      return changed;
    }
    function local(type, target, patch) {
      clock += 1;
      seq += 1;
      const op = { id: actor + '.' + session + '.' + seq, actor, clock, type, target, patch: patch == null ? null : copy(patch) };
      apply(op);
      return op;
    }
    function ordered() {
      if (!order) order = Array.from(live.values()).sort((p, q) => (p.z || 0) - (q.z || 0) || (p.id < q.id ? -1 : p.id > q.id ? 1 : 0));
      return order;
    }
    function snapshot(withStamps) {
      const out = { format: 'commons-board', version: 1, clock, objects: ordered().map(o => copy(o)) };
      if (withStamps) {
        const stamps = {};
        metas.forEach((m, id) => { stamps[id] = { on: m.on, a: m.alive, f: Object.assign({}, m.f) }; });
        out.stamps = stamps;
      }
      return out;
    }
    function load(src) {
      const list = Array.isArray(src) ? src : src && Array.isArray(src.objects) ? src.objects : [];
      const stamps = src && !Array.isArray(src) && src.stamps && typeof src.stamps === 'object' ? src.stamps : null;
      if (src && Number.isFinite(src.clock) && src.clock > clock) clock = src.clock;
      const zero = [0, ''];
      list.forEach(o => {
        if (!o || typeof o.id !== 'string' || !o.id || o.id.length > 80) return;
        const patch = cleanPatch(o);
        if (!patch.kind) return;
        const m = meta(o.id);
        const st = stamps && stamps[o.id];
        m.on = st ? st.on !== false : true;
        m.alive = st && Array.isArray(st.a) ? st.a : zero;
        for (const k in patch) {
          m.state[k] = patch[k];
          m.f[k] = st && st.f && Array.isArray(st.f[k]) ? st.f[k] : zero;
        }
        settle(o.id, m);
        vers.set(o.id, (vers.get(o.id) || 0) + 1);
      });
      if (stamps) {
        Object.keys(stamps).forEach(id => {
          if (metas.has(id) || id.length > 80) return;
          const st = stamps[id];
          if (!st || st.on !== false) return;
          const m = meta(id);
          m.on = false;
          m.alive = Array.isArray(st.a) ? st.a : zero;
          if (st.f) Object.keys(st.f).forEach(k => { if (Array.isArray(st.f[k])) m.f[k] = st.f[k]; });
        });
      }
      order = null;
    }
    return {
      apply, local, ordered, snapshot, load,
      get: id => live.get(id) || null,
      raw: id => (metas.has(id) ? metas.get(id).state : null),
      ver: id => vers.get(id) || 0,
      size: () => live.size,
      clock: () => clock,
      count: () => count,
      hash: () => fnv(stable(ordered()))
    };
  }

  /* ---------- 几何：笔迹轮廓、连线、锚点 ---------- */

  const f2 = v => Math.round(v * 100) / 100;

  // 变宽笔迹 → 闭合轮廓（左边沿正向、圆头、右边沿反向、圆尾），中点二次曲线连接，没有折角
  function outlineD(pts, base) {
    const n = (pts.length / 3) | 0;
    if (!n) return '';
    const dot = (x, y, p) => {
      const r = Math.max(0.6, base * (0.4 + 0.6 * clamp(p, 0, 1)) / 2);
      return 'M' + f2(x - r) + ' ' + f2(y) + 'A' + f2(r) + ' ' + f2(r) + ' 0 1 0 ' + f2(x + r) + ' ' + f2(y) + 'A' + f2(r) + ' ' + f2(r) + ' 0 1 0 ' + f2(x - r) + ' ' + f2(y) + 'Z';
    };
    if (n === 1) return dot(pts[0], pts[1], pts[2]);
    const dist = new Float64Array(n);
    let total = 0;
    for (let i = 1; i < n; i++) { total += Math.hypot(pts[3 * i] - pts[3 * i - 3], pts[3 * i + 1] - pts[3 * i - 2]); dist[i] = total; }
    if (total < 0.5) return dot(pts[0], pts[1], pts[2]);
    const taper = Math.min(base * 4, total * 0.35);
    const L = new Float64Array(2 * n);
    const R = new Float64Array(2 * n);
    const rad = new Float64Array(n);
    let nx = 0, ny = 1;
    for (let i = 0; i < n; i++) {
      const x = pts[3 * i], y = pts[3 * i + 1], p = pts[3 * i + 2];
      const i0 = Math.max(0, i - 1), i1 = Math.min(n - 1, i + 1);
      const dx = pts[3 * i1] - pts[3 * i0], dy = pts[3 * i1 + 1] - pts[3 * i0 + 1];
      const len = Math.hypot(dx, dy);
      if (len > 1e-6) { nx = -dy / len; ny = dx / len; }
      const ts = taper ? Math.min(1, dist[i] / taper) : 1;
      const te = taper ? Math.min(1, (total - dist[i]) / taper) : 1;
      const k = (0.62 + 0.38 * Math.sin(ts * Math.PI / 2)) * (0.42 + 0.58 * Math.sin(te * Math.PI / 2));
      const r = Math.max(0.35, base * (0.36 + 0.64 * clamp(p, 0, 1)) / 2 * k);
      rad[i] = r;
      L[2 * i] = x + nx * r; L[2 * i + 1] = y + ny * r;
      R[2 * i] = x - nx * r; R[2 * i + 1] = y - ny * r;
    }
    let d = 'M' + f2(L[0]) + ' ' + f2(L[1]);
    for (let i = 1; i < n - 1; i++) d += 'Q' + f2(L[2 * i]) + ' ' + f2(L[2 * i + 1]) + ' ' + f2((L[2 * i] + L[2 * i + 2]) / 2) + ' ' + f2((L[2 * i + 1] + L[2 * i + 3]) / 2);
    d += 'L' + f2(L[2 * n - 2]) + ' ' + f2(L[2 * n - 1]);
    d += 'A' + f2(rad[n - 1]) + ' ' + f2(rad[n - 1]) + ' 0 0 0 ' + f2(R[2 * n - 2]) + ' ' + f2(R[2 * n - 1]);
    for (let i = n - 2; i >= 1; i--) d += 'Q' + f2(R[2 * i]) + ' ' + f2(R[2 * i + 1]) + ' ' + f2((R[2 * i] + R[2 * i - 2]) / 2) + ' ' + f2((R[2 * i + 1] + R[2 * i - 1]) / 2);
    d += 'L' + f2(R[0]) + ' ' + f2(R[1]);
    d += 'A' + f2(rad[0]) + ' ' + f2(rad[0]) + ' 0 0 0 ' + f2(L[0]) + ' ' + f2(L[1]) + 'Z';
    return d;
  }
  // 荧光笔：等宽中心线
  function centerD(pts) {
    const n = (pts.length / 3) | 0;
    if (!n) return '';
    let d = 'M' + f2(pts[0]) + ' ' + f2(pts[1]);
    if (n === 1) return d + 'L' + f2(pts[0] + 0.01) + ' ' + f2(pts[1]);
    for (let i = 1; i < n - 1; i++) d += 'Q' + f2(pts[3 * i]) + ' ' + f2(pts[3 * i + 1]) + ' ' + f2((pts[3 * i] + pts[3 * i + 3]) / 2) + ' ' + f2((pts[3 * i + 1] + pts[3 * i + 4]) / 2);
    return d + 'L' + f2(pts[3 * n - 3]) + ' ' + f2(pts[3 * n - 2]);
  }

  // 世界坐标点列 [x, y, p, …] → 笔迹对象（点存相对坐标，w/h 可缩放，pw/ph 记原始尺寸）
  function penFrom(id, world, color, size, kind) {
    const k = kind === 'hl' ? 'hl' : 'pen';
    const base = (k === 'hl' ? WIDTH.hl : WIDTH.pen)[size || 2] || 3.8;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < world.length; i += 3) {
      if (world[i] < x0) x0 = world[i];
      if (world[i] > x1) x1 = world[i];
      if (world[i + 1] < y0) y0 = world[i + 1];
      if (world[i + 1] > y1) y1 = world[i + 1];
    }
    const pad = base * 0.75 + 1;
    const x = x0 - pad, y = y0 - pad;
    const pts = [];
    for (let i = 0; i < world.length; i += 3) pts.push(r1(world[i] - x), r1(world[i + 1] - y), r2(world[i + 2]));
    const w = r1(x1 - x0 + pad * 2), h = r1(y1 - y0 + pad * 2);
    return { id, kind: k, x: r1(x), y: r1(y), w, h, pw: w, ph: h, pts, color: color || 'ink', size: size || 2 };
  }

  const centerOf = t => ({ x: t.x + t.w / 2, y: t.y + t.h / 2 });
  const axisOf = (dx, dy) => (Math.abs(dx) >= Math.abs(dy) ? { x: dx >= 0 ? 1 : -1, y: 0 } : { x: 0, y: dy >= 0 ? 1 : -1 });

  // 从图形中心朝 toward 打一条射线，落在图形边上（矩形 / 椭圆 / 菱形），再留一点空隙
  function edgePoint(t, toward) {
    const c = centerOf(t);
    const hw = Math.max(1, t.w / 2), hh = Math.max(1, t.h / 2);
    let dx = toward.x - c.x, dy = toward.y - c.y;
    if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) dy = 1;
    let s;
    if (t.kind === 'ellipse') s = 1 / Math.sqrt(dx * dx / (hw * hw) + dy * dy / (hh * hh));
    else if (t.kind === 'diamond') s = 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh);
    else s = Math.min(Math.abs(dx) > 1e-6 ? hw / Math.abs(dx) : Infinity, Math.abs(dy) > 1e-6 ? hh / Math.abs(dy) : Infinity);
    const u = unit(dx, dy);
    const horiz = Math.abs(dx) / hw >= Math.abs(dy) / hh;
    return { x: c.x + dx * s + u.x * GAP, y: c.y + dy * s + u.y * GAP, n: horiz ? { x: dx >= 0 ? 1 : -1, y: 0 } : { x: 0, y: dy >= 0 ? 1 : -1 } };
  }
  function sidePort(t, horiz, toward) {
    const c = centerOf(t);
    if (horiz) { const s = toward.x >= c.x ? 1 : -1; return { x: c.x + s * (t.w / 2 + GAP), y: c.y, n: { x: s, y: 0 } }; }
    const s = toward.y >= c.y ? 1 : -1;
    return { x: c.x, y: c.y + s * (t.h / 2 + GAP), n: { x: 0, y: s } };
  }
  function endTarget(e, get) {
    if (!e || !e.id) return null;
    const t = get(e.id);
    return t && ATTACHABLE.has(t.kind) ? t : null;
  }
  function bezierAt(p0, p1, p2, p3, t) {
    const u = 1 - t;
    return { x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x, y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y };
  }

  // 连线几何：sag 用 VIZ-1 的悬链线（只取终态，不跑模拟），没有引擎就退回三次贝塞尔
  function lineGeom(o, get) {
    if (!o.a || !o.b) return null;
    const ta = endTarget(o.a, get), tb = endTarget(o.b, get);
    const ca = ta ? centerOf(ta) : o.a, cb = tb ? centerOf(tb) : o.b;
    const gravity = window.CommonsGravity;
    let route = o.route || 'curve';
    if (route === 'sag' && !(gravity && typeof gravity.catenaryPoints === 'function')) route = 'curve';
    let A, B;
    if (route === 'elbow') {
      const horiz = Math.abs(cb.x - ca.x) >= Math.abs(cb.y - ca.y);
      const dirn = horiz ? { x: cb.x >= ca.x ? 1 : -1, y: 0 } : { x: 0, y: cb.y >= ca.y ? 1 : -1 };
      A = ta ? sidePort(ta, horiz, cb) : { x: o.a.x, y: o.a.y, n: dirn };
      B = tb ? sidePort(tb, horiz, ca) : { x: o.b.x, y: o.b.y, n: { x: -dirn.x, y: -dirn.y } };
    } else {
      A = ta ? edgePoint(ta, cb) : { x: o.a.x, y: o.a.y, n: axisOf(cb.x - o.a.x, cb.y - o.a.y) };
      B = tb ? edgePoint(tb, ca) : { x: o.b.x, y: o.b.y, n: axisOf(ca.x - o.b.x, ca.y - o.b.y) };
    }
    const sw = WIDTH.line[o.size || 2] || 2.25;
    const head = 8 + sw * 2.4;
    const g = { route, A, B, sw, head, endA: o.arrow === 'both', endB: o.arrow === 'end' || o.arrow === 'both' };
    const d = Math.hypot(B.x - A.x, B.y - A.y);
    if (route === 'straight' || d < 4) {
      g.kind = 'poly';
      g.pts = [{ x: A.x, y: A.y }, { x: B.x, y: B.y }];
    } else if (route === 'curve') {
      const k = clamp(d * 0.42, 24, 200);
      g.kind = 'bez';
      g.c1 = { x: A.x + A.n.x * k, y: A.y + A.n.y * k };
      g.c2 = { x: B.x + B.n.x * k, y: B.y + B.n.y * k };
      g.pts = [];
      for (let i = 0; i <= 20; i++) g.pts.push(bezierAt(A, g.c1, g.c2, B, i / 20));
    } else if (route === 'sag') {
      const sag = Math.min(14, d * 0.07) / d;
      const n = clamp(Math.round(d / 26), 6, 32);
      g.kind = 'quad';
      g.pts = gravity.catenaryPoints({ x: A.x, y: A.y }, { x: B.x, y: B.y }, 1 + 2.667 * sag * sag, n).map(p => ({ x: p[0], y: p[1] }));
    } else {
      const pts = [{ x: A.x, y: A.y }];
      if (A.n.x !== 0) { const mx = (A.x + B.x) / 2; pts.push({ x: mx, y: A.y }, { x: mx, y: B.y }); }
      else { const my = (A.y + B.y) / 2; pts.push({ x: A.x, y: my }, { x: B.x, y: my }); }
      pts.push({ x: B.x, y: B.y });
      g.kind = 'elbow';
      g.pts = pts.filter((p, i) => i === 0 || Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y) > 0.5);
      if (g.pts.length < 2) g.pts.push({ x: B.x + 0.01, y: B.y });
    }
    const P = g.pts, m = P.length;
    let ia = 1;
    while (ia < m - 1 && Math.hypot(P[ia].x - P[0].x, P[ia].y - P[0].y) < 0.5) ia++;
    let ib = m - 2;
    while (ib > 0 && Math.hypot(P[ib].x - P[m - 1].x, P[ib].y - P[m - 1].y) < 0.5) ib--;
    g.dirA = g.kind === 'bez' ? unit(A.x - g.c1.x, A.y - g.c1.y) : unit(P[0].x - P[ia].x, P[0].y - P[ia].y);
    g.dirB = g.kind === 'bez' ? unit(B.x - g.c2.x, B.y - g.c2.y) : unit(P[m - 1].x - P[ib].x, P[m - 1].y - P[ib].y);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    P.forEach(p => { if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y; });
    const pad = head + sw;
    g.bounds = { x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 };
    return g;
  }
  // 连线路径字符串（canvas 用 Path2D 吃，导出 SVG 也用它）。有箭头的一端把线收回一点，避免圆头戳出箭尖
  function lineD(g) {
    const P = g.pts.map(p => ({ x: p.x, y: p.y }));
    const m = P.length;
    const pull = g.head * 0.62;
    let c1 = g.c1, c2 = g.c2;
    if (g.endB) { P[m - 1] = { x: P[m - 1].x - g.dirB.x * pull, y: P[m - 1].y - g.dirB.y * pull }; if (c2) c2 = { x: c2.x - g.dirB.x * pull, y: c2.y - g.dirB.y * pull }; }
    if (g.endA) { P[0] = { x: P[0].x - g.dirA.x * pull, y: P[0].y - g.dirA.y * pull }; if (c1) c1 = { x: c1.x - g.dirA.x * pull, y: c1.y - g.dirA.y * pull }; }
    let d = 'M' + f2(P[0].x) + ' ' + f2(P[0].y);
    if (g.kind === 'bez') {
      const a = { x: g.endA ? P[0].x : g.A.x, y: g.endA ? P[0].y : g.A.y };
      const b = g.endB ? P[m - 1] : { x: g.B.x, y: g.B.y };
      return 'M' + f2(a.x) + ' ' + f2(a.y) + 'C' + f2(c1.x) + ' ' + f2(c1.y) + ' ' + f2(c2.x) + ' ' + f2(c2.y) + ' ' + f2(b.x) + ' ' + f2(b.y);
    }
    if (g.kind === 'quad' && m > 2) {
      for (let i = 1; i < m - 1; i++) d += 'Q' + f2(P[i].x) + ' ' + f2(P[i].y) + ' ' + f2((P[i].x + P[i + 1].x) / 2) + ' ' + f2((P[i].y + P[i + 1].y) / 2);
      return d + 'L' + f2(P[m - 1].x) + ' ' + f2(P[m - 1].y);
    }
    if (g.kind === 'elbow' && m > 2) {
      for (let i = 1; i < m - 1; i++) {
        const p0 = P[i - 1], p = P[i], p1 = P[i + 1];
        const r = Math.min(12, Math.hypot(p.x - p0.x, p.y - p0.y) / 2, Math.hypot(p1.x - p.x, p1.y - p.y) / 2);
        const u0 = unit(p.x - p0.x, p.y - p0.y), u1 = unit(p1.x - p.x, p1.y - p.y);
        d += 'L' + f2(p.x - u0.x * r) + ' ' + f2(p.y - u0.y * r) + 'Q' + f2(p.x) + ' ' + f2(p.y) + ' ' + f2(p.x + u1.x * r) + ' ' + f2(p.y + u1.y * r);
      }
      return d + 'L' + f2(P[m - 1].x) + ' ' + f2(P[m - 1].y);
    }
    for (let i = 1; i < m; i++) d += 'L' + f2(P[i].x) + ' ' + f2(P[i].y);
    return d;
  }
  function arrowD(tip, dir, head) {
    const W = head * 0.5, px = -dir.y, py = dir.x;
    const bx = tip.x - dir.x * head, by = tip.y - dir.y * head;
    const nx = tip.x - dir.x * head * 0.7, ny = tip.y - dir.y * head * 0.7;
    return 'M' + f2(tip.x) + ' ' + f2(tip.y) + 'L' + f2(bx + px * W) + ' ' + f2(by + py * W) + 'L' + f2(nx) + ' ' + f2(ny) + 'L' + f2(bx - px * W) + ' ' + f2(by - py * W) + 'Z';
  }

  /* ---------- 模板实例化（数据见 board-templates.js） ---------- */

  function templateList() {
    const src = window.CommonsBoardTemplates;
    const list = src && Array.isArray(src.list) ? src.list : Array.isArray(src) ? src : [];
    return list.filter(t => t && typeof t.id === 'string' && Array.isArray(t.items));
  }
  function bindData(bind) {
    if (!isDemo() || !bind || bind.source !== 'knowledge') return null;
    const units = window.COMMONS_KNOWLEDGE && Array.isArray(window.COMMONS_KNOWLEDGE.units) ? window.COMMONS_KNOWLEDGE.units : [];
    let pick = null;
    (bind.prefer || []).some(id => (pick = units.find(u => u && u.id === id)));
    if (!pick && units.length) pick = units.filter(u => u && u.status === 'verified').sort((a, b) => (b.corroboration || 0) - (a.corroboration || 0))[0] || null;
    const u = pick || bind.fallback || {};
    return Object.assign({}, u, { statusLabel: STATUS_LABEL[u.status] || '示例', corroboration: Number(u.corroboration) || 0 });
  }
  const fill = (s, data) => (typeof s === 'string' && data ? s.replace(/\{(\w+)\}/g, (m, k) => (data[k] == null ? '' : String(data[k]))) : s);

  // 返回一组对象：同一个 g（组合），连线的 key 换成真实 id。anchor: 'center' 以 (x, y) 为中心，否则左上角对齐
  function instantiate(tpl, x, y, makeId, overrides, anchor) {
    const items = tpl.items || [];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const grow = (px, py) => { if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py; };
    items.forEach(it => {
      if (it.kind === 'line') { if (it.a && !it.a.key) grow(it.a.x, it.a.y); if (it.b && !it.b.key) grow(it.b.x, it.b.y); }
      else { grow(it.x || 0, it.y || 0); grow((it.x || 0) + (it.w || 0), (it.y || 0) + (it.h || 0)); }
    });
    if (!Number.isFinite(x0)) { x0 = y0 = 0; x1 = y1 = 0; }
    const ox = anchor === 'center' ? x - (x0 + x1) / 2 : x - x0;
    const oy = anchor === 'center' ? y - (y0 + y1) / 2 : y - y0;
    const group = items.length > 1 ? 'g-' + rid() : null;
    const keys = new Map();
    const out = [];
    items.forEach(it => {
      const o = copy(it);
      const key = o.key;
      delete o.key;
      const data = o.bind ? bindData(o.bind) : null;
      delete o.bind;
      if (data) { ['title', 'text', 'meta'].forEach(k => { o[k] = fill(o[k], data); }); if (data.id) o.ref = String(data.id); }
      if (key && overrides && overrides[key]) Object.assign(o, overrides[key]);
      o.id = makeId();
      if (key) keys.set(key, o);
      if (group) o.g = group;
      if (o.kind !== 'line') { o.x = r1((o.x || 0) + ox); o.y = r1((o.y || 0) + oy); o.w = o.w || 120; o.h = o.h || 60; }
      out.push(o);
    });
    out.forEach(o => {
      if (o.kind !== 'line') return;
      ['a', 'b'].forEach(end => {
        const e = o[end] || {};
        if (e.key) {
          const t = keys.get(e.key);
          o[end] = t ? { id: t.id, x: r1(t.x + t.w / 2), y: r1(t.y + t.h / 2) } : { x: ox, y: oy };
        } else o[end] = { x: r1((e.x || 0) + ox), y: r1((e.y || 0) + oy) };
      });
    });
    return out;
  }

  /* ---------- 主题：运行时从 CSS 变量读 ---------- */

  function createTheme(root) {
    const probe = document.createElement('i');
    probe.className = 'bd-probe';
    probe.setAttribute('aria-hidden', 'true');
    root.appendChild(probe);
    const cache = new Map();
    const style = getComputedStyle(root);
    const prop = n => style.getPropertyValue(n).trim();
    const fs = {};
    Object.keys(FS_FALLBACK).forEach(k => { fs[k] = [parseFloat(prop('--text-' + k)) || FS_FALLBACK[k][0], parseFloat(prop('--leading-' + k)) || FS_FALLBACK[k][1]]; });
    const ms = (n, d) => { const v = prop(n); const x = parseFloat(v); return Number.isFinite(x) ? (/ms$/.test(v) ? x : x * 1000) : d; };
    const bez = s => { const m = /cubic-bezier\(([^)]+)\)/.exec(s || ''); const a = m ? m[1].split(',').map(Number) : null; return a && a.length === 4 && a.every(Number.isFinite) ? bezierEase(a[0], a[1], a[2], a[3]) : bezierEase(0.65, 0, 0.35, 1); };
    function color(token) {
      if (!token) return 'transparent';
      let v = cache.get(token);
      if (v) return v;
      const slash = token.indexOf('/');
      const name = slash < 0 ? token : token.slice(0, slash);
      const pct = slash < 0 ? 0 : clamp(parseInt(token.slice(slash + 1), 10) || 0, 0, 100);
      probe.style.color = pct ? 'color-mix(in oklab, var(--' + name + ') ' + pct + '%, var(--surface))' : 'var(--' + name + ')';
      v = getComputedStyle(probe).color || 'currentcolor';
      probe.style.color = '';
      cache.set(token, v);
      return v;
    }
    return {
      color,
      fs,
      sans: prop('--sans') || 'sans-serif',
      mono: prop('--mono') || 'monospace',
      weight: { regular: prop('--weight-regular') || '400', medium: prop('--weight-medium') || '500', semibold: prop('--weight-semibold') || '600' },
      motion: { fast: ms('--motion-fast', 120), enter: ms('--motion-enter', 240), stage: ms('--motion-stage', 480) },
      ease: bez(prop('--ease-in-out')),
      easeOut: bez(prop('--ease-out'))
    };
  }

  /* ---------- 白板实例 ---------- */

  const instances = new Set();

  function createBoard(container, options) {
    const opts = Object.assign({ role: 'host', readOnly: false, chrome: 'full', laser: false }, options || {});
    const actor = String(opts.actor || 'u-' + rid()).replace(/[^\w-]/g, '').slice(0, 48) || 'u-' + rid();
    const myName = String(opts.name || '我').slice(0, 24);
    const onOp = typeof opts.onOp === 'function' ? opts.onOp : null;
    const doc = createDoc(actor);
    if (opts.doc) doc.load(opts.doc);
    let role = ['host', 'drawer', 'viewer'].includes(opts.role) ? opts.role : 'host';
    let readOnly = !!opts.readOnly;
    let laserOk = !!opts.laser;
    const mq = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : null;
    // 每次用时现查：媒体查询的 change 事件要等下一次渲染才派发，后台标签页里会迟到
    const reduced = () => !!(mq && mq.matches);

    const root = document.createElement('div');
    root.className = 'bd';
    root.dataset.board = '';
    root.dataset.chrome = opts.chrome === 'none' ? 'none' : 'full';
    root.innerHTML = chromeHTML();
    container.appendChild(root);
    const $ = s => root.querySelector(s);
    const stage = $('.bd-stage');
    const baseCv = $('.bd-canvas-base');
    const liveCv = $('.bd-canvas-live');
    const bctx = baseCv.getContext('2d');
    const lctx = liveCv.getContext('2d');
    const cursorsEl = $('.bd-cursors');
    const editor = $('.bd-editor');
    const rail = $('.bd-rail');
    const panel = $('.bd-panel');
    const styleBar = $('.bd-style');
    const menu = $('.bd-menu');
    const followBar = $('.bd-follow');
    const presentBar = $('.bd-present');
    const zoomVal = $('.bd-zoom-val');
    const toastEl = $('.bd-toast');
    const fileImage = $('.bd-file-image');
    const fileJson = $('.bd-file-json');
    const theme = createTheme(root);
    const col = t => theme.color(t);
    const measure = document.createElement('canvas').getContext('2d');

    const cam = { x: 0, y: 0, z: 1 };
    let vw = 1, vh = 1, dpr = 1;
    let tool = role === 'viewer' || readOnly ? 'hand' : 'select';
    let held = null;
    const toolStyle = {
      pen: { color: 'cat-2', size: 2 }, hl: { color: 'cat-3', size: 2 }, shape: { color: 'cat-2', size: 2 },
      line: { color: 'ink', size: 2, route: 'sag', arrow: 'end' }, sticky: { color: 'cat-3' }, text: { color: 'ink' }
    };
    const selection = new Set();
    let hover = null;
    let gesture = null;
    let transient = null;
    let exclude = null;
    let erasing = null;
    let editing = null;
    let txn = null;
    const history = [];
    const future = [];
    let clip = null;
    let pasteN = 0;
    let following = null;
    let lastFollow = null;
    const views = new Map();
    const names = new Map();
    const cursors = new Map();
    const lasers = new Map();
    let freezeLaser = false;
    let presenting = null;
    let tween = null;
    let dirty = 0;
    let raf = 0;
    let pointerInside = false;
    let spaceDown = false;
    let destroyed = false;
    let idSeq = 0;
    const idPrefix = actor.slice(0, 16);
    const newId = () => idPrefix + '-' + (++idSeq).toString(36) + rid().slice(0, 4);
    const timers = new Set();
    const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); return t; };
    const disposers = [];
    const on = (el, type, fn, o) => { el.addEventListener(type, fn, o); disposers.push(() => el.removeEventListener(type, fn, o)); };
    const stats = { rafCalls: 0, frames: 0, costs: new Float64Array(240), ci: 0, last: 0, max: 0 };
    const pathCache = new WeakMap();
    const geomCache = new Map();
    const wrapCache = new Map();
    const imgCache = new Map();
    const pointers = new Map();
    let pinch = null;
    let lastCursorSent = 0;
    let lastLaserSent = 0;
    let viewTimer = 0;
    let lastViewKey = '';

    const F_BASE = 1, F_LIVE = 2, F_CAM = 4, F_UI = 8;
    const canEdit = () => !readOnly && role !== 'viewer';
    const canLaser = () => !readOnly && (role !== 'viewer' || laserOk);
    const canVote = () => !readOnly;

    /* ----- 坐标 ----- */
    const toScreen = (x, y) => ({ x: (x - cam.x) * cam.z, y: (y - cam.y) * cam.z });
    const toWorld = (sx, sy) => ({ x: sx / cam.z + cam.x, y: sy / cam.z + cam.y });
    const localPt = e => { const r = stage.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const viewRect = () => ({ x: cam.x, y: cam.y, w: vw / cam.z, h: vh / cam.z });

    /* ----- 帧调度：只在有事时排一帧 ----- */
    function schedule(flags) {
      dirty |= flags;
      if (!raf && !destroyed) { raf = requestAnimationFrame(frame); stats.rafCalls++; }
    }
    function frame() {
      raf = 0;
      if (destroyed) return;
      const t0 = now();
      let again = false;
      if (tween) { stepTween(t0); dirty |= F_CAM; if (tween) again = true; }
      if (lasers.size) { dirty |= F_LIVE; if (pruneLasers(t0)) again = true; }
      const d = dirty;
      dirty = 0;
      if (d & F_CAM) { syncGrid(); placeOverlays(); queueView(); }
      if (d & (F_BASE | F_CAM)) drawBase();
      if (d & (F_LIVE | F_BASE | F_CAM)) drawLive();
      if (d & (F_UI | F_CAM)) syncUi();
      const cost = now() - t0;
      stats.frames++;
      stats.last = cost;
      if (cost > stats.max) stats.max = cost;
      stats.costs[stats.ci++ % stats.costs.length] = cost;
      if (again) schedule(F_LIVE);
    }
    function flush() {
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      if (dirty || tween || lasers.size) frame();
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
    }

    /* ----- 尺寸 ----- */
    function resize() {
      const r = stage.getBoundingClientRect();
      const cx = cam.x + vw / 2 / cam.z, cy = cam.y + vh / 2 / cam.z;
      const first = vw <= 1;
      vw = Math.max(1, r.width);
      vh = Math.max(1, r.height);
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      [baseCv, liveCv].forEach(cv => { cv.width = Math.round(vw * dpr); cv.height = Math.round(vh * dpr); cv.style.width = vw + 'px'; cv.style.height = vh + 'px'; });
      if (!first) { cam.x = cx - vw / 2 / cam.z; cam.y = cy - vh / 2 / cam.z; }
      root.classList.toggle('is-narrow', vw < 720);
      const rail = $('.bd-rail');
      if (rail) rail.setAttribute('aria-orientation', vw < 720 ? 'horizontal' : 'vertical');
      root.classList.toggle('is-short', vh < 664 && vw >= 720);
      schedule(F_BASE | F_LIVE | F_CAM | F_UI);
    }

    /* ----- 文字 ----- */
    function fontOf(fs, bold, mono, size) {
      const s = size || (theme.fs[fs] || theme.fs.body)[0];
      return (bold ? theme.weight.semibold : theme.weight.regular) + ' ' + s + 'px ' + (mono ? theme.mono : theme.sans);
    }
    function wrap(text, maxW, font) {
      const key = font + '|' + Math.round(maxW) + '|' + text;
      let lines = wrapCache.get(key);
      if (lines) return lines;
      measure.font = font;
      lines = [];
      String(text).split('\n').forEach(para => {
        if (!para) { lines.push({ t: '', w: 0 }); return; }
        let line = '';
        let lastSpace = -1;
        for (const ch of para) {
          const test = line + ch;
          if (line && measure.measureText(test).width > maxW) {
            if (ch === ' ') { lines.push({ t: line, w: measure.measureText(line).width }); line = ''; lastSpace = -1; continue; }
            if (lastSpace > 0 && /[\w.,:;!?'"()-]/.test(ch)) {
              const head = line.slice(0, lastSpace);
              lines.push({ t: head, w: measure.measureText(head).width });
              line = line.slice(lastSpace + 1) + ch;
            } else if (/^[，。、；：！？）」』》,.;:!?)]$/.test(ch) && line.length > 1) {
              const head = line.slice(0, -1);
              lines.push({ t: head, w: measure.measureText(head).width });
              line = line.slice(-1) + ch;
            } else {
              lines.push({ t: line, w: measure.measureText(line).width });
              line = ch;
            }
            lastSpace = line.lastIndexOf(' ');
          } else {
            line = test;
            if (ch === ' ') lastSpace = line.length - 1;
          }
        }
        lines.push({ t: line, w: measure.measureText(line).width });
      });
      if (wrapCache.size > 4000) wrapCache.clear();
      wrapCache.set(key, lines);
      return lines;
    }
    function drawText(ctx, text, x, y, w, h, o, z) {
      if (!text) return;
      const sz = theme.fs[o.fs] || theme.fs.body;
      const size = o.size || sz[0], lh = o.lh || sz[1];
      const font = fontOf(o.fs, o.bold, o.mono, o.size);
      let lines = wrap(text, Math.max(8, w), font);
      if (o.clip !== false) {
        const max = Math.max(1, Math.floor((h + 4) / lh));
        if (lines.length > max) { lines = lines.slice(0, max); const last = lines[max - 1]; lines[max - 1] = { t: last.t.replace(/.$/, '') + '…', w: last.w }; }
      }
      const total = lines.length * lh;
      const ty = o.valign === 'middle' ? y + (h - total) / 2 : y;
      ctx.fillStyle = col(o.color || 'ink');
      if (size * z < (dpr >= 2 ? 3.4 : 4.5)) {
        const a = ctx.globalAlpha;
        ctx.globalAlpha = a * 0.28;
        lines.forEach((ln, i) => {
          const lw = Math.min(w, ln.w);
          const lx = o.align === 'center' ? x + (w - lw) / 2 : x;
          ctx.fillRect(lx, ty + i * lh + lh * 0.3, lw, lh * 0.4);
        });
        ctx.globalAlpha = a;
        return;
      }
      ctx.font = font;
      ctx.textBaseline = 'middle';
      ctx.textAlign = o.align === 'center' ? 'center' : 'left';
      const tx = o.align === 'center' ? x + w / 2 : x;
      lines.forEach((ln, i) => ctx.fillText(ln.t, tx, ty + lh * i + lh / 2));
    }
    function textHeight(o) {
      const sz = theme.fs[o.fs || 'item'] || theme.fs.item;
      return Math.max(sz[1], wrap(o.text || ' ', Math.max(8, o.w), fontOf(o.fs || 'item', o.bold)).length * sz[1]);
    }

    /* ----- 绘制 ----- */
    function rrect(ctx, x, y, w, h, r) {
      r = Math.max(0, Math.min(r, w / 2, h / 2));
      ctx.beginPath();
      if (ctx.roundRect) { ctx.roundRect(x, y, w, h, r); return; }
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }
    function shapePath(ctx, o) {
      if (o.kind === 'ellipse') { ctx.beginPath(); ctx.ellipse(o.x + o.w / 2, o.y + o.h / 2, Math.max(0.5, o.w / 2), Math.max(0.5, o.h / 2), 0, 0, TAU); return; }
      if (o.kind === 'diamond') {
        ctx.beginPath();
        ctx.moveTo(o.x + o.w / 2, o.y);
        ctx.lineTo(o.x + o.w, o.y + o.h / 2);
        ctx.lineTo(o.x + o.w / 2, o.y + o.h);
        ctx.lineTo(o.x, o.y + o.h / 2);
        ctx.closePath();
        return;
      }
      rrect(ctx, o.x, o.y, o.w, o.h, o.radius == null ? 10 : o.radius);
    }
    function textBox(o, field) {
      if (field === 'name') return { x: o.x, y: o.y - 26 / cam.z, w: Math.max(120, o.w * 0.6), h: 20 / cam.z };
      if (o.kind === 'diamond') return { x: o.x + o.w / 4, y: o.y + o.h / 4, w: o.w / 2, h: o.h / 2 };
      if (o.kind === 'ellipse') { const px = o.w * 0.15, py = o.h * 0.15; return { x: o.x + px, y: o.y + py, w: o.w - px * 2, h: o.h - py * 2 }; }
      if (o.kind === 'rect') { const p = o.align === 'left' ? 16 : 12; return { x: o.x + p, y: o.y + 6, w: o.w - p * 2, h: o.h - 12 }; }
      if (o.kind === 'sticky') return { x: o.x + 14, y: o.y + 14, w: o.w - 28, h: o.h - (o.vote ? 52 : 28) };
      if (o.kind === 'card') {
        if (o.variant === 'code') return { x: o.x + 16, y: o.y + 44, w: o.w - 32, h: o.h - 56 };
        if (o.variant === 'knowledge') return { x: o.x + 20, y: o.y + 66, w: o.w - 36, h: Math.max(20, o.h - 108) };
        return { x: o.x + 18, y: o.y + 52, w: o.w - 36, h: o.h - 64 };
      }
      return { x: o.x, y: o.y, w: o.w, h: o.h };
    }
    function textStyle(o, field) {
      if (field === 'name') return { fs: 'meta', bold: true, color: 'muted', align: 'left', size: 12 / cam.z, lh: 20 / cam.z };
      if (o.kind === 'text') return { fs: o.fs || 'item', bold: o.bold, color: o.color || 'ink', align: o.align || 'left', valign: 'top', clip: false };
      if (o.kind === 'card') {
        if (o.variant === 'code') return { fs: 'ui', mono: true, color: 'ink-2', align: 'left', valign: 'top' };
        return { fs: o.variant === 'knowledge' ? 'ui' : 'body', color: 'muted', align: 'left', valign: 'top' };
      }
      return { fs: o.fs || 'item', bold: o.bold, color: o.tc || 'ink', align: o.align || 'center', valign: 'middle' };
    }
    const hideText = (o, field) => editing && editing.id === o.id && (editing.field === field);
    function votePill(o) {
      const w = 60, h = 26;
      return { x: o.x + o.w - w - 12, y: o.y + o.h - h - 12, w, h };
    }
    function voteCount(o) { let n = 0; for (const k in o) if (k.charCodeAt(0) === 118 && VOTE_KEY.test(k) && o[k]) n++; return n; }

    function drawShape(ctx, o, z) {
      shapePath(ctx, o);
      if (o.fill) { ctx.fillStyle = col(o.fill); ctx.fill(); }
      if (o.color) { ctx.lineWidth = WIDTH.shape[o.size || 2] || 2; ctx.strokeStyle = col(o.color); ctx.lineJoin = 'round'; ctx.stroke(); }
      if (o.text && !hideText(o, 'text')) { const b = textBox(o); drawText(ctx, o.text, b.x, b.y, b.w, b.h, textStyle(o), z); }
    }
    function softShadow(ctx, o, r, depth) {
      const a = ctx.globalAlpha;
      ctx.fillStyle = col('slate-900');
      ctx.globalAlpha = a * 0.045;
      rrect(ctx, o.x - 1, o.y + depth, o.w + 2, o.h + 1, r + 1);
      ctx.fill();
      ctx.globalAlpha = a * 0.06;
      rrect(ctx, o.x, o.y + 1, o.w, o.h, r);
      ctx.fill();
      ctx.globalAlpha = a;
    }
    function drawSticky(ctx, o, z) {
      softShadow(ctx, o, 6, 4);
      ctx.fillStyle = col(o.fill || 'sky-100');
      rrect(ctx, o.x, o.y, o.w, o.h, 6);
      ctx.fill();
      if (o.text && !hideText(o, 'text')) { const b = textBox(o); drawText(ctx, o.text, b.x, b.y, b.w, b.h, textStyle(o), z); }
      if (o.vote) {
        const p = votePill(o);
        const mine = !!o['v.' + actor];
        rrect(ctx, p.x, p.y, p.w, p.h, p.h / 2);
        ctx.fillStyle = col(mine ? 'accent' : 'surface');
        ctx.fill();
        if (!mine) { ctx.lineWidth = 1; ctx.strokeStyle = col('line-strong'); ctx.stroke(); }
        drawText(ctx, '+1 · ' + voteCount(o), p.x, p.y, p.w, p.h, { fs: 'meta', bold: true, color: mine ? 'on-accent' : 'ink-2', align: 'center', valign: 'middle' }, z);
      }
    }
    function drawCard(ctx, o, z) {
      const v = o.variant || 'note';
      softShadow(ctx, o, 12, 3);
      rrect(ctx, o.x, o.y, o.w, o.h, 12);
      ctx.fillStyle = col(v === 'code' ? 'slate-50' : 'surface');
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = col(v === 'knowledge' ? 'teal-200' : 'line-strong');
      ctx.stroke();
      ctx.save();
      rrect(ctx, o.x, o.y, o.w, o.h, 12);
      ctx.clip();
      if (v === 'knowledge') { ctx.fillStyle = col('teal-500'); ctx.fillRect(o.x, o.y, 4, o.h); }
      else if (v === 'note') { ctx.fillStyle = col(o.color || 'accent'); ctx.fillRect(o.x, o.y, o.w, 4); }
      else { ctx.fillStyle = col('slate-100'); ctx.fillRect(o.x, o.y, o.w, 32); ctx.fillStyle = col('line'); ctx.fillRect(o.x, o.y + 32, o.w, 1); }
      ctx.restore();
      const body = textBox(o);
      if (v === 'knowledge') {
        drawText(ctx, '知识卡引用 · 示例', o.x + 20, o.y + 14, o.w - 36, 16, { fs: 'micro', bold: true, color: 'teal-700' }, z);
        drawText(ctx, o.title || '', o.x + 20, o.y + 34, o.w - 36, 30, { fs: 'item', bold: true, color: 'ink' }, z);
        if (!hideText(o, 'text')) drawText(ctx, o.text || '', body.x, body.y, body.w, body.h, textStyle(o), z);
        ctx.fillStyle = col('teal-50');
        rrect(ctx, o.x + 20, o.y + o.h - 36, Math.min(o.w - 36, 168), 22, 11);
        ctx.fill();
        drawText(ctx, o.meta || '', o.x + 30, o.y + o.h - 36, Math.min(o.w - 36, 168) - 20, 22, { fs: 'meta', bold: true, color: 'teal-700', valign: 'middle' }, z);
      } else if (v === 'code') {
        drawText(ctx, o.title || '代码', o.x + 16, o.y + 6, o.w - 32, 20, { fs: 'meta', mono: true, color: 'muted', valign: 'middle' }, z);
        if (!hideText(o, 'text')) drawText(ctx, o.text || '', body.x, body.y, body.w, body.h, textStyle(o), z);
      } else {
        drawText(ctx, o.title || '', o.x + 18, o.y + 20, o.w - 36, 26, { fs: 'section', bold: true, color: 'ink' }, z);
        if (!hideText(o, 'text')) drawText(ctx, o.text || '', body.x, body.y, body.w, body.h, textStyle(o), z);
      }
    }
    function drawFrame(ctx, o, z, active) {
      rrect(ctx, o.x, o.y, o.w, o.h, 14);
      ctx.fillStyle = col('surface');
      ctx.fill();
      ctx.lineWidth = (active ? 2 : 1) / z;
      ctx.strokeStyle = col(active ? 'accent' : 'line-strong');
      ctx.stroke();
      if (!hideText(o, 'name')) {
        ctx.font = fontOf('meta', true, false, 12 / z);
        ctx.fillStyle = col(active ? 'accent-ink' : 'muted');
        ctx.textBaseline = 'alphabetic';
        ctx.textAlign = 'left';
        ctx.fillText(o.name || '框', o.x + 2 / z, o.y - 9 / z);
      }
    }
    function getImg(src) {
      let im = imgCache.get(src);
      if (!im) { im = new Image(); im.onload = () => schedule(F_BASE); im.src = src; imgCache.set(src, im); }
      return im.complete && im.naturalWidth ? im : null;
    }
    function drawImage(ctx, o) {
      const im = o.src ? getImg(o.src) : null;
      ctx.save();
      rrect(ctx, o.x, o.y, o.w, o.h, 8);
      ctx.clip();
      if (im) ctx.drawImage(im, o.x, o.y, o.w, o.h);
      else { ctx.fillStyle = col('sunk'); ctx.fillRect(o.x, o.y, o.w, o.h); }
      ctx.restore();
      rrect(ctx, o.x, o.y, o.w, o.h, 8);
      ctx.lineWidth = 1;
      ctx.strokeStyle = col('line');
      ctx.stroke();
    }
    function penPath(o) {
      let p = pathCache.get(o.pts);
      if (!p) {
        p = new Path2D(o.kind === 'hl' ? centerD(o.pts) : outlineD(o.pts, WIDTH.pen[o.size || 2] || 3.8));
        if (o.pts) pathCache.set(o.pts, p);
      }
      return p;
    }
    function drawPen(ctx, o) {
      if (!o.pts || !o.pts.length) return;
      const path = penPath(o);
      ctx.save();
      ctx.translate(o.x, o.y);
      const sx = o.w / (o.pw || o.w || 1), sy = o.h / (o.ph || o.h || 1);
      if (Math.abs(sx - 1) > 1e-3 || Math.abs(sy - 1) > 1e-3) ctx.scale(sx, sy);
      if (o.kind === 'hl') {
        ctx.globalAlpha *= 0.34;
        ctx.strokeStyle = col(o.color || 'cat-3');
        ctx.lineWidth = WIDTH.hl[o.size || 2] || 18;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke(path);
      } else {
        ctx.fillStyle = col(o.color || 'ink');
        ctx.fill(path);
      }
      ctx.restore();
    }
    function geomOf(o, get) {
      if (get) return lineGeom(o, get);
      const ka = o.a && o.a.id ? doc.ver(o.a.id) + (doc.get(o.a.id) ? 0 : 0.5) : -1;
      const kb = o.b && o.b.id ? doc.ver(o.b.id) + (doc.get(o.b.id) ? 0 : 0.5) : -1;
      const key = doc.ver(o.id) + ':' + ka + ':' + kb + ':' + (window.CommonsGravity ? 1 : 0);
      const c = geomCache.get(o.id);
      if (c && c.key === key && c.o === o) return c.g;
      const g = lineGeom(o, doc.get);
      geomCache.set(o.id, { key, g, o });
      return g;
    }
    function drawLine(ctx, o, get) {
      const g = geomOf(o, get);
      if (!g) return;
      const c = col(o.color || 'ink');
      ctx.strokeStyle = c;
      ctx.fillStyle = c;
      ctx.lineWidth = g.sw;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      if (o.dash) ctx.setLineDash([g.sw * 3, g.sw * 2.6]);
      ctx.stroke(new Path2D(lineD(g)));
      if (o.dash) ctx.setLineDash([]);
      ctx.lineWidth = Math.max(1, g.sw * 0.6);
      if (g.endB) { const p = new Path2D(arrowD(g.B, g.dirB, g.head)); ctx.fill(p); ctx.stroke(p); }
      if (g.endA) { const p = new Path2D(arrowD(g.A, g.dirA, g.head)); ctx.fill(p); ctx.stroke(p); }
    }
    function drawObj(ctx, o, z, get) {
      switch (o.kind) {
        case 'pen': case 'hl': drawPen(ctx, o); break;
        case 'rect': case 'ellipse': case 'diamond': drawShape(ctx, o, z); break;
        case 'sticky': drawSticky(ctx, o, z); break;
        case 'card': drawCard(ctx, o, z); break;
        case 'frame': drawFrame(ctx, o, z, presenting && presenting.id === o.id); break;
        case 'image': drawImage(ctx, o); break;
        case 'line': drawLine(ctx, o, get); break;
        case 'text': if (!hideText(o, 'text')) drawText(ctx, o.text, o.x, o.y, o.w, o.h, textStyle(o), z); break;
        default: break;
      }
    }
    function boundsOf(o, get) {
      if (!o) return null;
      if (o.kind === 'line') { const g = geomOf(o, get); return g ? g.bounds : null; }
      if (o.kind === 'frame') return { x: o.x, y: o.y - 30 / cam.z, w: o.w, h: o.h + 30 / cam.z };
      return { x: o.x, y: o.y, w: o.w, h: o.h };
    }
    function boxOf(o) {
      if (o.kind === 'line') { const g = geomOf(o); return g ? { x: g.bounds.x + g.head + g.sw, y: g.bounds.y + g.head + g.sw, w: Math.max(1, g.bounds.w - 2 * (g.head + g.sw)), h: Math.max(1, g.bounds.h - 2 * (g.head + g.sw)) } : null; }
      return { x: o.x, y: o.y, w: o.w, h: o.h };
    }
    function unionBox(list, fn) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      list.forEach(o => { const b = (fn || boxOf)(o); if (!b) return; x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); });
      return Number.isFinite(x0) ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
    }
    const setWorld = (ctx, dx, dy) => ctx.setTransform(dpr * cam.z, 0, 0, dpr * cam.z, (-cam.x + (dx || 0)) * cam.z * dpr, (-cam.y + (dy || 0)) * cam.z * dpr);

    function drawBase() {
      const ctx = bctx;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, baseCv.width, baseCv.height);
      setWorld(ctx);
      const view = viewRect();
      const m = 24 / cam.z;
      const vv = { x: view.x - m, y: view.y - m, w: view.w + m * 2, h: view.h + m * 2 };
      const list = doc.ordered();
      for (let i = 0; i < list.length; i++) {
        const o = list[i];
        if ((exclude && exclude.has(o.id)) || (erasing && erasing.has(o.id))) continue;
        const b = o.kind === 'line' ? boundsOf(o) : o;
        if (!b || !intersects(b, vv)) continue;
        ctx.globalAlpha = 1;
        drawObj(ctx, o, cam.z);
      }
      ctx.globalAlpha = 1;
    }

    function drawLive() {
      const ctx = lctx;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, liveCv.width, liveCv.height);
      const z = cam.z;
      const view = viewRect();
      if (transient) {
        if (transient.mode === 'move') {
          const t = transient;
          const vv = { x: view.x - t.dx - 40 / z, y: view.y - t.dy - 40 / z, w: view.w + 80 / z, h: view.h + 80 / z };
          setWorld(ctx, t.dx, t.dy);
          const list = doc.ordered();
          for (let i = 0; i < list.length; i++) {
            const o = list[i];
            if (!t.moving.has(o.id) && !t.rigid.has(o.id)) continue;
            const b = o.kind === 'line' ? boundsOf(o) : o;
            if (!b || !intersects(b, vv)) continue;
            drawObj(ctx, o, z);
          }
          setWorld(ctx);
          t.stretch.forEach(id => { const o = stretchLine(id); if (o) drawObj(ctx, o, z, t.get); });
        } else {
          setWorld(ctx);
          const list = Array.from(transient.map.values()).sort((p, q) => (p.z || 0) - (q.z || 0));
          list.forEach(o => drawObj(ctx, o, z, transient.get));
          (transient.lines || []).forEach(id => { const o = doc.get(id); if (o && !transient.map.has(id)) drawObj(ctx, o, z, transient.get); });
        }
      }
      setWorld(ctx);
      if (erasing && erasing.size) {
        ctx.globalAlpha = 0.22;
        erasing.forEach(id => { const o = doc.get(id); if (o) drawObj(ctx, o, z); });
        ctx.globalAlpha = 1;
      }
      if (gesture && gesture.preview) { ctx.globalAlpha = gesture.type === 'drop' ? 0.55 : 1; drawObj(ctx, gesture.preview, z, gesture.get); ctx.globalAlpha = 1; }
      if (gesture && gesture.type === 'stroke' && gesture.pts.length) drawStrokePreview(ctx);
      if (gesture && gesture.type === 'drop' && gesture.box) {
        const b = gesture.box;
        ctx.setLineDash([6 / z, 5 / z]);
        ctx.lineWidth = 1.5 / z;
        ctx.strokeStyle = col('accent');
        rrect(ctx, b.x, b.y, b.w, b.h, 10);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      // 屏幕坐标层：悬停、选中、手柄、框选、吸附目标、激光
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const snap = gesture && gesture.snap ? doc.get(gesture.snap) : null;
      if (snap) outlineObj(ctx, snap, 'accent', 2, 4);
      if (hover && !selection.has(hover) && !gesture) { const o = doc.get(hover); if (o) outlineObj(ctx, o, 'accent-line', 1.5, 2); }
      drawSelection(ctx);
      if (gesture && gesture.type === 'marquee' && gesture.moved) {
        const a = toScreen(gesture.w0.x, gesture.w0.y), b = toScreen(gesture.w1.x, gesture.w1.y);
        const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), w = Math.abs(a.x - b.x), h = Math.abs(a.y - b.y);
        ctx.fillStyle = col('accent');
        ctx.globalAlpha = 0.07;
        ctx.fillRect(x, y, w, h);
        ctx.globalAlpha = 1;
        ctx.lineWidth = 1;
        ctx.strokeStyle = col('accent');
        ctx.strokeRect(x + 0.5, y + 0.5, w, h);
      }
      if (gesture && gesture.type === 'erase' && gesture.at) {
        ctx.beginPath();
        ctx.arc(gesture.at.x, gesture.at.y, 10, 0, TAU);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = col('slate-400');
        ctx.stroke();
      }
      drawLasers(ctx);
    }
    function outlineObj(ctx, o, token, width, pad) {
      const b = boxOf(o);
      if (!b) return;
      const s = toScreen(b.x, b.y);
      ctx.lineWidth = width;
      ctx.strokeStyle = col(token);
      if (o.kind === 'line') {
        const g = geomOf(o);
        if (!g) return;
        ctx.save();
        setWorld(ctx);
        ctx.lineWidth = (g.sw + 4) / cam.z;
        ctx.globalAlpha = 0.35;
        ctx.lineCap = 'round';
        ctx.stroke(new Path2D(lineD(g)));
        ctx.restore();
        return;
      }
      rrect(ctx, s.x - pad, s.y - pad, b.w * cam.z + pad * 2, b.h * cam.z + pad * 2, o.kind === 'ellipse' ? 8 : 6);
      ctx.stroke();
    }
    function selBox() { return unionBox(selected()); }
    function handlesOf(b) {
      const s = toScreen(b.x, b.y), w = b.w * cam.z, h = b.h * cam.z;
      const x0 = s.x - 4, y0 = s.y - 4, x1 = s.x + w + 4, y1 = s.y + h + 4, mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
      const all = [['nw', x0, y0], ['n', mx, y0], ['ne', x1, y0], ['e', x1, my], ['se', x1, y1], ['s', mx, y1], ['sw', x0, y1], ['w', x0, my]];
      return w < 36 || h < 36 ? all.filter(hd => hd[0].length === 2) : all;
    }
    function drawSelection(ctx) {
      if (!selection.size || (gesture && gesture.type === 'move' && gesture.moved)) {
        if (gesture && gesture.type === 'move' && gesture.moved && transient) {
          const b = selBox();
          if (b) { const s = toScreen(b.x + transient.dx, b.y + transient.dy); ctx.lineWidth = 1; ctx.strokeStyle = col('accent'); ctx.strokeRect(s.x - 4.5, s.y - 4.5, b.w * cam.z + 9, b.h * cam.z + 9); }
        }
        return;
      }
      const list = selected();
      if (list.length === 1 && list[0].kind === 'line') {
        const o = transient && transient.map && transient.map.get(list[0].id) || list[0];
        const g = geomOf(o, transient && transient.get);
        if (!g) return;
        outlineObj(ctx, o, 'accent', 1, 0);
        [g.A, g.B].forEach(p => { const s = toScreen(p.x, p.y); handleDot(ctx, s.x, s.y); });
        return;
      }
      if (list.length <= 80) list.forEach(o => { if (o.kind !== 'line') outlineObj(ctx, transient && transient.map && transient.map.get(o.id) || o, 'accent', 1, 2); });
      const b = transient && transient.map ? unionBox(list.map(o => transient.map.get(o.id) || o)) : selBox();
      if (!b) return;
      const s = toScreen(b.x, b.y);
      ctx.lineWidth = 1.25;
      ctx.strokeStyle = col('accent');
      ctx.strokeRect(s.x - 4.5, s.y - 4.5, b.w * cam.z + 9, b.h * cam.z + 9);
      if (!canEdit() || presenting) return;
      handlesOf(b).forEach(hd => handleSquare(ctx, hd[1], hd[2]));
    }
    function handleSquare(ctx, x, y) {
      ctx.fillStyle = col('surface');
      ctx.strokeStyle = col('accent');
      ctx.lineWidth = 1.5;
      rrect(ctx, x - 4.5, y - 4.5, 9, 9, 2);
      ctx.fill();
      ctx.stroke();
    }
    function handleDot(ctx, x, y) {
      ctx.beginPath();
      ctx.arc(x, y, 5.5, 0, TAU);
      ctx.fillStyle = col('surface');
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = col('accent');
      ctx.stroke();
    }
    function drawStrokePreview(ctx) {
      const g = gesture;
      if (g.tool === 'hl') {
        ctx.save();
        ctx.globalAlpha = 0.34;
        ctx.strokeStyle = col(g.color);
        ctx.lineWidth = WIDTH.hl[g.size] || 18;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke(new Path2D(centerD(g.pts)));
        ctx.restore();
      } else {
        ctx.fillStyle = col(g.color);
        ctx.fill(new Path2D(outlineD(g.pts, WIDTH.pen[g.size] || 3.8)));
      }
    }
    function drawLasers(ctx) {
      const t = now();
      lasers.forEach(tr => {
        const pts = tr.pts;
        if (!pts.length) return;
        const c = col(tr.color);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = c;
        for (let pass = 0; pass < 2; pass++) {
          for (let i = 1; i < pts.length; i++) {
            const age = (freezeLaser ? tr.frozen || t : t) - pts[i].t;
            const a = clamp(1 - Math.max(0, age - LASER_LIFE * 0.55) / (LASER_LIFE * 0.45), 0, 1);
            if (a <= 0) continue;
            const p0 = toScreen(pts[i - 1].x, pts[i - 1].y), p1 = toScreen(pts[i].x, pts[i].y);
            const k = i / pts.length;
            ctx.globalAlpha = pass ? a : a * 0.16;
            ctx.lineWidth = pass ? 1.5 + 2.5 * k : 8 + 6 * k;
            ctx.beginPath();
            ctx.moveTo(p0.x, p0.y);
            ctx.lineTo(p1.x, p1.y);
            ctx.stroke();
          }
        }
        const head = pts[pts.length - 1];
        const age = (freezeLaser ? tr.frozen || t : t) - head.t;
        const a = clamp(1 - Math.max(0, age - LASER_LIFE * 0.55) / (LASER_LIFE * 0.45), 0, 1);
        if (a > 0) {
          const s = toScreen(head.x, head.y);
          ctx.fillStyle = c;
          ctx.globalAlpha = a * 0.18;
          ctx.beginPath(); ctx.arc(s.x, s.y, 12, 0, TAU); ctx.fill();
          ctx.globalAlpha = a;
          ctx.beginPath(); ctx.arc(s.x, s.y, 4.5, 0, TAU); ctx.fill();
        }
        ctx.globalAlpha = 1;
      });
    }
    function pruneLasers(t) {
      let alive = false;
      lasers.forEach((tr, key) => {
        if (freezeLaser) { alive = false; return; }
        while (tr.pts.length && t - tr.pts[0].t > LASER_LIFE) tr.pts.shift();
        if (tr.pts.length > 160) tr.pts.splice(0, tr.pts.length - 160);
        if (tr.pts.length) alive = true; else lasers.delete(key);
      });
      return alive;
    }
    function addLaser(who, x, y, color) {
      let tr = lasers.get(who);
      if (!tr) { tr = { pts: [], color }; lasers.set(who, tr); }
      tr.pts.push({ x, y, t: now() });
      schedule(F_LIVE);
    }

    /* ----- 网格（CSS 背景，跟着镜头走，不占 canvas） ----- */
    function syncGrid() {
      let step = 24 * cam.z;
      while (step < 14) step *= 4;
      const ox = ((-cam.x * cam.z) % step + step) % step, oy = ((-cam.y * cam.z) % step + step) % step;
      stage.style.backgroundSize = step + 'px ' + step + 'px';
      stage.style.backgroundPosition = ox + 'px ' + oy + 'px';
    }

    /* ----- 选择 ----- */
    function selected() { const out = []; selection.forEach(id => { const o = doc.get(id); if (o) out.push(o); }); return out; }
    function groupIds(o) {
      if (!o.g) return [o.id];
      return doc.ordered().filter(p => p.g === o.g).map(p => p.id);
    }
    function select(ids) {
      selection.clear();
      (ids || []).forEach(id => { if (doc.get(id)) selection.add(id); });
      schedule(F_LIVE | F_UI);
    }
    function frameKids(f) {
      const out = [];
      doc.ordered().forEach(o => {
        if (o.id === f.id || o.kind === 'frame') return;
        const b = boxOf(o);
        if (!b) return;
        const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
        if (cx > f.x && cx < f.x + f.w && cy > f.y && cy < f.y + f.h) out.push(o.id);
      });
      return out;
    }

    /* ----- 命中 ----- */
    function hitObj(o, w, tol) {
      switch (o.kind) {
        case 'line': {
          const g = geomOf(o);
          if (!g || !inside(w, g.bounds, tol)) return false;
          const P = g.pts;
          for (let i = 1; i < P.length; i++) if (segDist(w.x, w.y, P[i - 1].x, P[i - 1].y, P[i].x, P[i].y) <= tol + g.sw / 2 + 2 / cam.z) return true;
          return false;
        }
        case 'pen': case 'hl': {
          if (!inside(w, o, tol)) return false;
          const sx = o.w / (o.pw || o.w || 1), sy = o.h / (o.ph || o.h || 1);
          const half = ((o.kind === 'hl' ? WIDTH.hl : WIDTH.pen)[o.size || 2] || 4) / 2 + tol;
          const p = o.pts;
          if (p.length <= 3) return Math.hypot(w.x - (o.x + p[0] * sx), w.y - (o.y + p[1] * sy)) <= half;
          for (let i = 3; i < p.length; i += 3) if (segDist(w.x, w.y, o.x + p[i - 3] * sx, o.y + p[i - 2] * sy, o.x + p[i] * sx, o.y + p[i + 1] * sy) <= half) return true;
          return false;
        }
        case 'frame': {
          const label = { x: o.x, y: o.y - 28 / cam.z, w: Math.max(80 / cam.z, Math.min(o.w, 220 / cam.z)), h: 26 / cam.z };
          if (inside(w, label, 0)) return true;
          const band = 8 / cam.z;
          return inside(w, o, band) && !inside(w, { x: o.x + band, y: o.y + band, w: o.w - band * 2, h: o.h - band * 2 }, 0);
        }
        case 'ellipse': {
          const rx = o.w / 2 + tol, ry = o.h / 2 + tol, dx = w.x - (o.x + o.w / 2), dy = w.y - (o.y + o.h / 2);
          return (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1;
        }
        case 'diamond': {
          const dx = Math.abs(w.x - (o.x + o.w / 2)), dy = Math.abs(w.y - (o.y + o.h / 2));
          return dx / (o.w / 2 + tol) + dy / (o.h / 2 + tol) <= 1;
        }
        default: return inside(w, o, tol);
      }
    }
    function hitTest(w, skip) {
      const tol = 5 / cam.z;
      const list = doc.ordered();
      for (let i = list.length - 1; i >= 0; i--) {
        const o = list[i];
        if (skip && skip(o)) continue;
        if (hitObj(o, w, tol)) return o;
      }
      return null;
    }
    function hitHandle(p) {
      if (!selection.size || !canEdit() || presenting) return null;
      const list = selected();
      if (list.length === 1 && list[0].kind === 'line') {
        const g = geomOf(list[0]);
        if (!g) return null;
        const a = toScreen(g.A.x, g.A.y), b = toScreen(g.B.x, g.B.y);
        if (Math.hypot(p.x - a.x, p.y - a.y) <= 9) return { end: 'a', id: list[0].id };
        if (Math.hypot(p.x - b.x, p.y - b.y) <= 9) return { end: 'b', id: list[0].id };
        return null;
      }
      const b = selBox();
      if (!b) return null;
      const hd = handlesOf(b).find(h => Math.abs(p.x - h[1]) <= 8 && Math.abs(p.y - h[2]) <= 8);
      return hd ? { handle: hd[0], box: b } : null;
    }
    function hitVote(w) {
      if (!canVote()) return null;
      const list = doc.ordered();
      for (let i = list.length - 1; i >= 0; i--) {
        const o = list[i];
        if (o.kind !== 'sticky' || !o.vote) continue;
        if (inside(w, votePill(o), 2 / cam.z)) return o;
        if (inside(w, o, 0)) return null;
      }
      return null;
    }

    /* ----- 文档写入：事务 + 撤销 ----- */
    function begin() { if (!txn) txn = { before: new Map() }; }
    function touch(id) { if (txn && !txn.before.has(id)) txn.before.set(id, copy(doc.get(id))); }
    function emit(type, id, patch) {
      touch(id);
      const op = doc.local(type, id, patch);
      if (onOp) { try { onOp(op); } catch (err) { console.error('board onOp failed', err); } }
      return op;
    }
    function addObj(o) {
      const p = copy(o);
      delete p.id;
      emit('add', o.id, p);
    }
    function updObj(id, patch) {
      const cur = doc.get(id);
      if (!cur) return;
      const p = {};
      let n = 0;
      Object.keys(patch).forEach(k => {
        const v = patch[k] === undefined ? null : patch[k];
        if (v === null ? !(k in cur) : same(cur[k], v)) return;
        p[k] = v;
        n++;
      });
      if (!n) return;
      emit(n === 1 && 'z' in p ? 'reorder' : 'update', id, p);
    }
    function remObj(id) { if (doc.get(id)) emit('remove', id, null); }
    function commit() {
      if (!txn) return;
      const entry = [];
      txn.before.forEach((before, id) => {
        const after = copy(doc.get(id));
        if (!same(before, after)) entry.push({ id, before, after });
      });
      txn = null;
      if (entry.length) {
        history.push(entry);
        if (history.length > HISTORY_MAX) history.shift();
        future.length = 0;
      }
      schedule(F_BASE | F_LIVE | F_UI);
    }
    // 撤销只回退自己改过的字段，别人同时改的字段不动
    function restore(entry, which) {
      const other = which === 'before' ? 'after' : 'before';
      entry.forEach(rec => {
        const target = rec[which], prev = rec[other], cur = doc.get(rec.id);
        if (!target) { if (cur) emit('remove', rec.id, null); return; }
        if (!cur) {
          const p = copy(target);
          delete p.id;
          const raw = doc.raw(rec.id);
          if (raw) Object.keys(raw).forEach(k => { if (k !== 'id' && !(k in p)) p[k] = null; });
          emit('add', rec.id, p);
          return;
        }
        const keys = new Set(Object.keys(target).concat(prev ? Object.keys(prev) : []));
        const p = {};
        let n = 0;
        keys.forEach(k => {
          if (k === 'id') return;
          if (prev && same(target[k], prev[k])) return;
          const v = target[k] === undefined ? null : target[k];
          if (v === null ? !(k in cur) : same(cur[k], v)) return;
          p[k] = v;
          n++;
        });
        if (n) emit(n === 1 && 'z' in p ? 'reorder' : 'update', rec.id, p);
      });
    }
    function undo() {
      if (!canEdit() || !history.length) return;
      endEdit(true);
      const entry = history.pop();
      restore(entry, 'before');
      future.push(entry);
      select(Array.from(selection).filter(id => doc.get(id)));
      announce('已撤销');
      schedule(F_BASE | F_LIVE | F_UI);
    }
    function redo() {
      if (!canEdit() || !future.length) return;
      endEdit(true);
      const entry = future.pop();
      restore(entry, 'after');
      history.push(entry);
      announce('已重做');
      schedule(F_BASE | F_LIVE | F_UI);
    }
    const topZ = () => { const l = doc.ordered(); return l.length ? (l[l.length - 1].z || 0) + 1 : 1; };
    const bottomZ = () => { const l = doc.ordered(); return l.length ? (l[0].z || 0) - 1 : 0; };

    /* ----- 镜头 ----- */
    function setCam(x, y, z) { cam.x = x; cam.y = y; cam.z = clamp(z, 0.08, 4); schedule(F_CAM); }
    function zoomAt(factor, sx, sy) {
      const w = toWorld(sx, sy);
      const z = clamp(cam.z * factor, 0.08, 4);
      setCam(w.x - sx / z, w.y - sy / z, z);
    }
    // 留给浮层的边距：左侧工具栏、顶部操作条、底部缩放条不压住内容
    function insets(extra) {
      const e = extra || 0;
      if (opts.chrome === 'none') return { l: 8 + e, r: 8 + e, t: 8 + e, b: 8 + e };
      if (root.classList.contains('is-narrow')) return { l: 8 + e, r: 8 + e, t: 52 + e, b: 56 + e };
      if (root.classList.contains('is-short')) return { l: 16 + e, r: 16 + e, t: 60 + e, b: 60 + e };
      return { l: 64 + e, r: 16 + e, t: 60 + e, b: 56 + e };
    }
    function camFor(rect, pad, maxZ) {
      const p = typeof pad === 'object' && pad ? pad : { l: pad == null ? 48 : pad, r: pad == null ? 48 : pad, t: pad == null ? 48 : pad, b: pad == null ? 48 : pad };
      const aw = Math.max(40, vw - p.l - p.r), ah = Math.max(40, vh - p.t - p.b);
      const z = clamp(Math.min(aw / Math.max(1, rect.w), ah / Math.max(1, rect.h), maxZ || 2), 0.08, 4);
      return { x: rect.x + rect.w / 2 - (p.l + aw / 2) / z, y: rect.y + rect.h / 2 - (p.t + ah / 2) / z, z };
    }
    function flyTo(target, ms) {
      if (reduced() || !ms) { tween = null; setCam(target.x, target.y, target.z); return; }
      tween = { from: { cx: cam.x + vw / 2 / cam.z, cy: cam.y + vh / 2 / cam.z, z: cam.z }, to: { cx: target.x + vw / 2 / target.z, cy: target.y + vh / 2 / target.z, z: target.z }, t0: now(), ms };
      schedule(F_CAM);
    }
    function stepTween(t) {
      const k = clamp((t - tween.t0) / tween.ms, 0, 1);
      const e = theme.ease(k);
      const f = tween.from, g = tween.to;
      const z = Math.exp(Math.log(f.z) + (Math.log(g.z) - Math.log(f.z)) * e);
      const cx = f.cx + (g.cx - f.cx) * e, cy = f.cy + (g.cy - f.cy) * e;
      cam.z = z;
      cam.x = cx - vw / 2 / z;
      cam.y = cy - vh / 2 / z;
      if (k >= 1) tween = null;
    }
    function fitAll(animate) {
      const b = unionBox(doc.ordered(), o => boundsOf(o));
      if (!b) { flyTo({ x: -vw / 2, y: -vh / 2, z: 1 }, animate ? theme.motion.stage : 0); return; }
      flyTo(camFor(b, insets(8), 1.4), animate ? theme.motion.stage : 0);
    }
    function userMoved() {
      tween = null;
      if (following) { lastFollow = following; following = null; schedule(F_UI); announce('已退出跟随，可以点「回到讲课人视角」'); }
    }
    function queueView() {
      if (!onOp || role !== 'host' || readOnly || viewTimer) return;
      viewTimer = later(() => { viewTimer = 0; sendView(false); }, 60);
    }
    function sendView(force) {
      if (!onOp || destroyed) return;
      const v = { type: 'view', actor, name: myName, x: r1(cam.x), y: r1(cam.y), w: r1(vw / cam.z), h: r1(vh / cam.z) };
      const key = v.x + ',' + v.y + ',' + v.w + ',' + v.h;
      if (!force && key === lastViewKey) return;
      lastViewKey = key;
      try { onOp(v); } catch (err) { console.error('board onOp failed', err); }
    }
    function applyView(v, animate) {
      const target = camFor({ x: v.x, y: v.y, w: v.w, h: v.h }, 0, 4);
      flyTo(target, animate ? Math.min(theme.motion.enter, 240) : 0);
    }

    /* ----- 演示：框当幻灯片 ----- */
    function frames() {
      const fs = doc.ordered().filter(o => o.kind === 'frame');
      return fs.sort((a, b) => (Math.abs(a.y - b.y) < Math.min(a.h, b.h) / 2 ? a.x - b.x : a.y - b.y));
    }
    function present(onoff) {
      if (onoff) {
        const fs = frames();
        if (!fs.length) { toast('画布上还没有框。先用「框」（F）圈出要讲的部分。'); return; }
        endEdit(true);
        const c = toWorld(vw / 2, vh / 2);
        let best = 0, bd = Infinity;
        fs.forEach((f, i) => { const d = Math.hypot(f.x + f.w / 2 - c.x, f.y + f.h / 2 - c.y); if (d < bd) { bd = d; best = i; } });
        presenting = { index: best, id: fs[best].id, tool };
        if (canLaser()) tool = 'laser';
        select([]);
        root.classList.add('is-presenting');
        closeMenu();
        togglePanel(false);
        goFrame(best);
        announce('演示开始。← → 切换框，Esc 退出。');
      } else if (presenting) {
        tool = presenting.tool;
        presenting = null;
        root.classList.remove('is-presenting');
        schedule(F_BASE | F_UI);
        announce('已退出演示');
      }
    }
    function goFrame(i) {
      const fs = frames();
      if (!fs.length || !presenting) return;
      i = clamp(i, 0, fs.length - 1);
      presenting.index = i;
      presenting.id = fs[i].id;
      const f = fs[i];
      flyTo(camFor({ x: f.x, y: f.y - 30, w: f.w, h: f.h + 30 }, insets(4), 2), theme.motion.stage);
      schedule(F_BASE | F_UI);
    }

    /* ----- 在场：光标、跟随、激光 ----- */
    function cursorColor(who) { let h = 0; for (let i = 0; i < who.length; i++) h = (h * 31 + who.charCodeAt(i)) >>> 0; return CURSOR_COLORS[h % CURSOR_COLORS.length]; }
    function onCursor(op) {
      const who = String(op.actor || '').slice(0, 64);
      if (!who || who === actor) return;
      let c = cursors.get(who);
      if (op.gone) { if (c) { c.el.remove(); clearTimeout(c.timer); timers.delete(c.timer); cursors.delete(who); } return; }
      if (!Number.isFinite(op.x) || !Number.isFinite(op.y)) return;
      const name = String(op.name || names.get(who) || '同伴').slice(0, 24);
      names.set(who, name);
      if (!c) {
        const el = document.createElement('div');
        el.className = 'bd-cursor';
        el.style.setProperty('--bd-cursor', 'var(--' + cursorColor(who) + ')');
        c = { el, x: 0, y: 0, name: '', timer: 0 };
        cursors.set(who, c);
        cursorsEl.appendChild(el);
      }
      if (c.name !== name) {
        c.name = name;
        const ava = window.CommonsAvatar && typeof window.CommonsAvatar.html === 'function'
          ? window.CommonsAvatar.html({ id: who, name, size: 24, letter: true })
          : '<span class="bd-cursor-initial">' + esc(Array.from(name)[0] || '?') + '</span>';
        c.el.innerHTML = '<svg class="bd-cursor-arrow" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 1.5 14 7.2l-5.1 1.6L6.6 14z"/></svg><span class="bd-cursor-tag">' + /* safe: CommonsAvatar.html 自己转义 id/name；兜底分支已 esc */ ava + '<span class="bd-cursor-name">' + esc(name) + '</span></span>';
      }
      c.x = op.x;
      c.y = op.y;
      placeCursor(c);
      clearTimeout(c.timer);
      timers.delete(c.timer);
      c.el.classList.remove('is-idle');
      c.timer = later(() => c.el.classList.add('is-idle'), 12000);
    }
    function placeCursor(c) {
      const s = toScreen(c.x, c.y);
      const out = s.x < -40 || s.y < -40 || s.x > vw + 40 || s.y > vh + 40;
      c.el.hidden = out;
      c.el.style.transform = 'translate3d(' + r1(s.x) + 'px,' + r1(s.y) + 'px,0)';
    }
    function onView(op) {
      const who = String(op.actor || '');
      if (!who || who === actor || ![op.x, op.y, op.w, op.h].every(Number.isFinite) || op.w <= 0 || op.h <= 0) return;
      if (op.name) names.set(who, String(op.name).slice(0, 24));
      views.set(who, { x: op.x, y: op.y, w: op.w, h: op.h });
      if (following === who) applyView(op, true);
      if (lastFollow === who || following === who) schedule(F_UI);
    }
    function follow(userId) {
      following = userId ? String(userId) : null;
      if (following) {
        lastFollow = following;
        const v = views.get(following);
        if (v) applyView(v, true);
        announce('正在跟随' + (names.get(following) || '讲课人') + '的视角');
      }
      schedule(F_UI);
    }
    function sendCursor(w, force) {
      if (!onOp) return;
      const t = now();
      if (!force && t - lastCursorSent < 50) return;
      lastCursorSent = t;
      try { onOp({ type: 'cursor', actor, name: myName, x: r1(w.x), y: r1(w.y) }); } catch (err) { console.error('board onOp failed', err); }
    }
    function laserAt(w) {
      addLaser(actor, w.x, w.y, 'rose-500');
      const t = now();
      if (onOp && t - lastLaserSent > 30) {
        lastLaserSent = t;
        try { onOp({ type: 'laser', actor, x: r1(w.x), y: r1(w.y) }); } catch (err) { console.error('board onOp failed', err); }
      }
    }

    /* ----- 指针 ----- */
    function effectiveTool(e) {
      if (spaceDown || e.button === 1) return 'hand';
      if (held === 'laser') return canLaser() ? 'laser' : 'hand';
      if (!canEdit()) return tool === 'laser' && canLaser() ? 'laser' : 'hand';
      return tool;
    }
    function onDown(e) {
      if (e.button === 2 || destroyed) return;
      closeMenu();
      const p = localPt(e);
      pointers.set(e.pointerId, p);
      if (pointers.size === 2) {
        cancelGesture();
        const [a, b] = Array.from(pointers.values());
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        pinch = { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, z0: cam.z, w: toWorld(mid.x, mid.y) };
        userMoved();
        return;
      }
      if (pointers.size > 2) return;
      try { stage.setPointerCapture(e.pointerId); } catch (err) { /* 合成事件没有活动指针 */ }
      if (document.activeElement !== stage && !editing) stage.focus({ preventScroll: true });
      if (editing) endEdit(true);
      const w = toWorld(p.x, p.y);
      const t = effectiveTool(e);
      const touch = e.pointerType === 'touch';
      if (t === 'hand') { startPan(p); return; }
      if (t === 'laser') { gesture = { type: 'laser' }; laserAt(w); return; }
      if (t === 'select') {
        const hv = hitVote(w);
        if (hv) { toggleVote(hv); return; }
        const hd = hitHandle(p);
        if (hd && hd.end) { startEndDrag(hd, w); return; }
        if (hd && hd.handle) { startResize(hd, w, e.shiftKey); return; }
        const o = hitTest(w);
        if (o) {
          const ids = groupIds(o);
          let clickInto = null;
          if (e.shiftKey) {
            const allIn = ids.every(id => selection.has(id));
            ids.forEach(id => (allIn ? selection.delete(id) : selection.add(id)));
          } else if (!ids.every(id => selection.has(id))) {
            select(ids);
          } else if (ids.length > 1 && selection.size === ids.length) clickInto = o.id;
          gesture = { type: 'move', p0: p, w0: w, moved: false, clickInto };
          schedule(F_LIVE | F_UI);
          return;
        }
        if (!e.shiftKey) select([]);
        if (touch) { startPan(p); return; }
        gesture = { type: 'marquee', w0: w, w1: w, moved: false, base: e.shiftKey ? new Set(selection) : null };
        return;
      }
      if (!canEdit()) return;
      if (t === 'pen' || t === 'hl') { startStroke(t, w, e); return; }
      if (t === 'eraser') { gesture = { type: 'erase', at: p }; erasing = new Set(); eraseAt(w); return; }
      if (t === 'arrow') { startConnect(w); return; }
      if (t === 'text') { createText(w); return; }
      if (t === 'sticky') { createSticky(w); return; }
      if (t === 'image') { pickImage(); return; }
      if (SHAPES.has(t) || t === 'frame') { gesture = { type: 'create', kind: t, p0: p, w0: w, preview: null }; return; }
    }
    function onMove(e) {
      if (destroyed) return;
      const p = localPt(e);
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, p);
      if (pinch && pointers.size >= 2) {
        const [a, b] = Array.from(pointers.values());
        const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const z = clamp(pinch.z0 * d / pinch.d0, 0.08, 4);
        setCam(pinch.w.x - mid.x / z, pinch.w.y - mid.y / z, z);
        return;
      }
      const w = toWorld(p.x, p.y);
      if (pointerInside) sendCursor(w);
      if (!gesture) {
        const t = effectiveTool(e);
        if (t === 'laser' && e.pointerType === 'mouse' && canLaser()) { laserAt(w); return; }
        if (t === 'select') hoverAt(p, w);
        return;
      }
      const g = gesture;
      switch (g.type) {
        case 'pan':
          setCam(g.cam.x - (p.x - g.p0.x) / cam.z, g.cam.y - (p.y - g.p0.y) / cam.z, cam.z);
          break;
        case 'laser': laserAt(w); break;
        case 'stroke': strokeMove(e); break;
        case 'erase': g.at = p; eraseAt(w); schedule(F_LIVE); break;
        case 'marquee': g.w1 = w; g.moved = g.moved || Math.hypot(p.x - toScreen(g.w0.x, g.w0.y).x, p.y - toScreen(g.w0.x, g.w0.y).y) > 3; schedule(F_LIVE); break;
        case 'move':
          if (!g.moved) {
            if (Math.hypot(p.x - g.p0.x, p.y - g.p0.y) < 3 || !canEdit()) return;
            g.moved = true;
            beginMove();
          }
          transient.dx = w.x - g.w0.x;
          transient.dy = w.y - g.w0.y;
          schedule(F_LIVE);
          break;
        case 'resize': resizeMove(w, e.shiftKey); break;
        case 'end': endMove(w); break;
        case 'create': createMove(p, w, e.shiftKey); break;
        case 'connect': connectMove(w); break;
        default: break;
      }
    }
    function onUp(e) {
      pointers.delete(e.pointerId);
      if (pinch) { if (pointers.size < 2) pinch = null; return; }
      try { stage.releasePointerCapture(e.pointerId); } catch (err) { /* 已释放 */ }
      const g = gesture;
      if (!g) return;
      gesture = null;
      const p = localPt(e);
      const w = toWorld(p.x, p.y);
      switch (g.type) {
        case 'pan': stage.classList.remove('is-panning'); break;
        case 'stroke': strokeEnd(g, e.type === 'pointercancel'); break;
        case 'erase': eraseEnd(); break;
        case 'marquee': marqueeEnd(g); break;
        case 'move':
          if (g.moved) moveEnd();
          else if (g.clickInto) select([g.clickInto]);
          break;
        case 'resize': resizeEnd(); break;
        case 'end': endEnd(); break;
        case 'create': createEnd(g, w); break;
        case 'connect': connectEnd(g, w); break;
        default: break;
      }
      schedule(F_LIVE | F_UI);
    }
    function cancelGesture() {
      const g = gesture;
      gesture = null;
      if (!g) return;
      if (g.type === 'stroke' && g.id && doc.get(g.id)) { remObj(g.id); commit(); }
      transient = null;
      exclude = null;
      erasing = null;
      schedule(F_BASE | F_LIVE);
    }
    function startPan(p) {
      gesture = { type: 'pan', p0: p, cam: { x: cam.x, y: cam.y } };
      stage.classList.add('is-panning');
      userMoved();
    }
    function hoverAt(p, w) {
      const hd = hitHandle(p);
      let cursor = '';
      if (hd && hd.handle) cursor = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize' }[hd.handle];
      else if (hd && hd.end) cursor = 'crosshair';
      else if (hitVote(w)) cursor = 'pointer';
      stage.style.cursor = cursor;
      const o = hd ? null : hitTest(w);
      const id = o ? o.id : null;
      if (id !== hover) { hover = id; schedule(F_LIVE); }
    }

    /* 笔迹：输入流线平滑 + 速度模拟压感（真笔用真压感） */
    function startStroke(t, w, e) {
      const st = toolStyle[t];
      const real = e.pointerType === 'pen' && e.pressure > 0;
      const p0 = real ? e.pressure : 0.55;
      gesture = { type: 'stroke', tool: t, color: st.color, size: st.size, pts: [w.x, w.y, p0], last: { x: w.x, y: w.y, t: e.timeStamp || now() }, p: p0, real, id: null, sent: 0 };
      begin();
      schedule(F_LIVE);
    }
    function strokeMove(e) {
      const g = gesture;
      const list = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : null;
      (list && list.length ? list : [e]).forEach(ev => {
        const p = localPt(ev);
        const w = toWorld(p.x, p.y);
        const sx = g.last.x + (w.x - g.last.x) * 0.55, sy = g.last.y + (w.y - g.last.y) * 0.55;
        const dScreen = Math.hypot(sx - g.last.x, sy - g.last.y) * cam.z;
        if (dScreen < 0.8) return;
        const t = ev.timeStamp || now();
        let target;
        if (g.real && ev.pressure > 0) target = ev.pressure;
        else { const v = dScreen / Math.max(1, t - g.last.t); target = clamp(1.08 - v / 3, 0.22, 1); }
        g.p += (target - g.p) * (g.real ? 0.5 : 0.2);
        g.pts.push(r1(sx), r1(sy), r2(g.p));
        g.last = { x: sx, y: sy, t, rx: w.x, ry: w.y };
      });
      schedule(F_LIVE);
      if (onOp && now() - g.sent > 110 && g.pts.length >= 9) streamStroke(g);
    }
    function streamStroke(g) {
      g.sent = now();
      const o = penFrom(g.id || newId(), g.pts, g.color, g.size, g.tool);
      if (!g.id) { g.id = o.id; o.z = topZ(); exclude = new Set([o.id]); addObj(o); }
      else updObj(g.id, { x: o.x, y: o.y, w: o.w, h: o.h, pw: o.pw, ph: o.ph, pts: o.pts });
    }
    function strokeEnd(g, cancelled) {
      if (cancelled) { if (g.id) remObj(g.id); commit(); exclude = null; schedule(F_BASE | F_LIVE); return; }
      if (g.last.rx != null && Math.hypot(g.last.rx - g.last.x, g.last.ry - g.last.y) * cam.z > 0.5) g.pts.push(r1(g.last.rx), r1(g.last.ry), r2(g.p));
      const o = penFrom(g.id || newId(), g.pts, g.color, g.size, g.tool);
      if (!g.id) { o.z = topZ(); addObj(o); }
      else updObj(g.id, { x: o.x, y: o.y, w: o.w, h: o.h, pw: o.pw, ph: o.ph, pts: o.pts });
      exclude = null;
      commit();
    }

    function eraseAt(w) {
      const tol = 10 / cam.z;
      const list = doc.ordered();
      let hit = false;
      for (let i = list.length - 1; i >= 0; i--) {
        const o = list[i];
        if (o.kind === 'frame' || erasing.has(o.id)) continue;
        if (hitObj(o, w, tol)) { erasing.add(o.id); hit = true; }
      }
      if (hit) schedule(F_BASE | F_LIVE);
    }
    function eraseEnd() {
      const ids = erasing ? Array.from(erasing) : [];
      erasing = null;
      if (ids.length) { begin(); removeIds(ids); commit(); announce('擦掉了 ' + ids.length + ' 个对象'); }
      schedule(F_BASE | F_LIVE);
    }
    function removeIds(ids) {
      const gone = new Set(ids);
      doc.ordered().forEach(o => {
        if (o.kind !== 'line' || gone.has(o.id)) return;
        const patch = {};
        ['a', 'b'].forEach(end => {
          const e = o[end];
          if (e && e.id && gone.has(e.id)) {
            const g = geomOf(o);
            const p = g ? (end === 'a' ? g.A : g.B) : e;
            patch[end] = { x: r1(p.x), y: r1(p.y) };
          }
        });
        if (Object.keys(patch).length) updObj(o.id, patch);
      });
      ids.forEach(remObj);
      ids.forEach(id => selection.delete(id));
    }

    function marqueeEnd(g) {
      if (!g.moved) { schedule(F_LIVE); return; }
      const box = { x: Math.min(g.w0.x, g.w1.x), y: Math.min(g.w0.y, g.w1.y), w: Math.abs(g.w0.x - g.w1.x), h: Math.abs(g.w0.y - g.w1.y) };
      const ids = new Set(g.base || []);
      doc.ordered().forEach(o => {
        const b = boxOf(o);
        if (!b) return;
        const hit = o.kind === 'frame' ? b.x >= box.x && b.y >= box.y && b.x + b.w <= box.x + box.w && b.y + b.h <= box.y + box.h : intersects(b, box);
        if (hit) groupIds(o).forEach(id => ids.add(id));
      });
      select(Array.from(ids));
    }

    function beginMove() {
      const ids = new Set(selection);
      selected().forEach(o => { if (o.kind === 'frame') frameKids(o).forEach(id => ids.add(id)); });
      const moving = new Set();
      const selLines = new Set();
      ids.forEach(id => { const o = doc.get(id); if (!o) return; if (o.kind === 'line') selLines.add(id); else moving.add(id); });
      const rigid = new Set(), stretch = new Set();
      doc.ordered().forEach(L => {
        if (L.kind !== 'line') return;
        const am = L.a && L.a.id && doc.get(L.a.id) ? moving.has(L.a.id) : selLines.has(L.id);
        const bm = L.b && L.b.id && doc.get(L.b.id) ? moving.has(L.b.id) : selLines.has(L.id);
        if (am && bm) rigid.add(L.id); else if (am || bm) stretch.add(L.id);
      });
      transient = { mode: 'move', moving, rigid, stretch, selLines, dx: 0, dy: 0 };
      transient.get = id => {
        const o = doc.get(id);
        return o && transient && transient.moving.has(id) ? Object.assign({}, o, { x: o.x + transient.dx, y: o.y + transient.dy }) : o;
      };
      exclude = new Set([...moving, ...rigid, ...stretch]);
      hover = null;
      schedule(F_BASE | F_LIVE);
    }
    function stretchLine(id) {
      const o = doc.get(id);
      if (!o || !transient) return null;
      const t = transient;
      const shift = e => (e && !(e.id && doc.get(e.id)) && t.selLines.has(id) ? { x: e.x + t.dx, y: e.y + t.dy } : e);
      return Object.assign({}, o, { a: shift(o.a), b: shift(o.b) });
    }
    function moveEnd() {
      const t = transient;
      transient = null;
      exclude = null;
      if (!t || (!t.dx && !t.dy)) { schedule(F_BASE | F_LIVE); return; }
      begin();
      t.moving.forEach(id => { const o = doc.get(id); if (o) updObj(id, { x: r1(o.x + t.dx), y: r1(o.y + t.dy) }); });
      new Set([...t.rigid, ...t.stretch]).forEach(id => {
        const o = doc.get(id);
        if (!o) return;
        const patch = {};
        ['a', 'b'].forEach(end => {
          const e = o[end];
          if (!e) return;
          const attached = e.id && doc.get(e.id);
          if (attached) { if (t.moving.has(e.id)) patch[end] = { id: e.id, x: r1(e.x + t.dx), y: r1(e.y + t.dy) }; }
          else if (t.selLines.has(id) || t.rigid.has(id)) patch[end] = { x: r1(e.x + t.dx), y: r1(e.y + t.dy) };
        });
        if (Object.keys(patch).length) updObj(id, patch);
      });
      commit();
    }
    function nudge(dx, dy) {
      if (!selection.size || !canEdit()) return;
      begin();
      selected().forEach(o => {
        if (o.kind === 'line') {
          const patch = {};
          ['a', 'b'].forEach(end => { const e = o[end]; if (e && !(e.id && doc.get(e.id))) patch[end] = { x: e.x + dx, y: e.y + dy }; });
          updObj(o.id, patch);
        } else updObj(o.id, { x: o.x + dx, y: o.y + dy });
      });
      commit();
    }

    function startResize(hd, w, shift) {
      const map = new Map();
      const ids = new Set(selection);
      selected().forEach(o => map.set(o.id, Object.assign({}, o)));
      const lines = [];
      doc.ordered().forEach(L => { if (L.kind === 'line' && !map.has(L.id) && ((L.a && ids.has(L.a.id)) || (L.b && ids.has(L.b.id)))) lines.push(L.id); });
      const orig = new Map();
      map.forEach((o, id) => orig.set(id, copy(o)));
      transient = { mode: 'map', map, lines, orig };
      transient.get = id => transient.map.get(id) || doc.get(id);
      exclude = new Set([...map.keys(), ...lines]);
      gesture = { type: 'resize', handle: hd.handle, box: hd.box, shift };
      schedule(F_BASE | F_LIVE);
    }
    function resizeMove(w, shift) {
      const g = gesture, b = g.box, h = g.handle;
      let x0 = b.x, y0 = b.y, x1 = b.x + b.w, y1 = b.y + b.h;
      const min = 8;
      if (h.includes('w')) x0 = Math.min(w.x, x1 - min);
      if (h.includes('e')) x1 = Math.max(w.x, x0 + min);
      if (h.includes('n')) y0 = Math.min(w.y, y1 - min);
      if (h.includes('s')) y1 = Math.max(w.y, y0 + min);
      let sx = (x1 - x0) / Math.max(1, b.w), sy = (y1 - y0) / Math.max(1, b.h);
      const keep = shift || Array.from(transient.orig.values()).some(o => o.kind === 'image');
      if (keep && h.length === 2) {
        const s = Math.max(sx, sy);
        sx = sy = s;
        if (h.includes('w')) x0 = x1 - b.w * s; else x1 = x0 + b.w * s;
        if (h.includes('n')) y0 = y1 - b.h * s; else y1 = y0 + b.h * s;
      }
      if (h === 'n' || h === 's') sx = 1;
      if (h === 'e' || h === 'w') sy = 1;
      const nx = h.includes('w') ? x1 - b.w * sx : x0, ny = h.includes('n') ? y1 - b.h * sy : y0;
      transient.orig.forEach((o, id) => {
        const c = Object.assign({}, o);
        if (o.kind === 'line') {
          ['a', 'b'].forEach(end => { const e = o[end]; if (e) c[end] = Object.assign({}, e, { x: nx + (e.x - b.x) * sx, y: ny + (e.y - b.y) * sy }); });
        } else {
          c.x = nx + (o.x - b.x) * sx;
          c.y = ny + (o.y - b.y) * sy;
          c.w = Math.max(4, o.w * sx);
          c.h = Math.max(4, o.h * sy);
          if (o.kind === 'text') c.h = textHeight(c);
        }
        transient.map.set(id, c);
      });
      schedule(F_LIVE);
    }
    function resizeEnd() {
      const t = transient;
      transient = null;
      exclude = null;
      if (!t) return;
      begin();
      t.map.forEach((c, id) => {
        if (c.kind === 'line') updObj(id, { a: c.a && Object.assign({}, c.a, { x: r1(c.a.x), y: r1(c.a.y) }), b: c.b && Object.assign({}, c.b, { x: r1(c.b.x), y: r1(c.b.y) }) });
        else updObj(id, { x: r1(c.x), y: r1(c.y), w: r1(c.w), h: r1(c.h) });
      });
      commit();
    }

    // 连线端点：拖到图形上就吸附，图形移动时跟着走
    const snapSkip = o => !ATTACHABLE.has(o.kind) || o.kind === 'frame';
    function startEndDrag(hd, w) {
      const o = doc.get(hd.id);
      if (!o) return;
      const map = new Map([[o.id, Object.assign({}, o)]]);
      transient = { mode: 'map', map, lines: [], orig: new Map() };
      transient.get = id => transient.map.get(id) || doc.get(id);
      exclude = new Set([o.id]);
      gesture = { type: 'end', id: o.id, end: hd.end, snap: null };
      endMove(w);
      schedule(F_BASE);
    }
    function endMove(w) {
      const g = gesture;
      const c = transient.map.get(g.id);
      const t = hitTest(w, o => snapSkip(o) || o.id === g.id);
      g.snap = t ? t.id : null;
      c[g.end] = t ? { id: t.id, x: r1(t.x + t.w / 2), y: r1(t.y + t.h / 2) } : { x: r1(w.x), y: r1(w.y) };
      schedule(F_LIVE);
    }
    function endEnd() {
      const t = transient;
      transient = null;
      exclude = null;
      if (!t) return;
      const c = t.map.values().next().value;
      begin();
      updObj(c.id, { a: c.a, b: c.b });
      commit();
    }

    function startConnect(w) {
      const t = hitTest(w, snapSkip);
      const st = toolStyle.line;
      const a = t ? { id: t.id, x: r1(t.x + t.w / 2), y: r1(t.y + t.h / 2) } : { x: r1(w.x), y: r1(w.y) };
      const prev = { id: newId(), kind: 'line', a, b: { x: w.x, y: w.y }, route: st.route, arrow: st.arrow, color: st.color, size: st.size };
      gesture = { type: 'connect', preview: prev, from: t ? t.id : null, w0: w, snap: null, get: id => doc.get(id) };
      schedule(F_LIVE);
    }
    function connectMove(w) {
      const g = gesture;
      const t = hitTest(w, o => snapSkip(o) || o.id === g.from);
      g.snap = t ? t.id : null;
      g.preview.b = t ? { id: t.id, x: r1(t.x + t.w / 2), y: r1(t.y + t.h / 2) } : { x: w.x, y: w.y };
      schedule(F_LIVE);
    }
    function connectEnd(g, w) {
      const o = g.preview;
      const far = Math.hypot(w.x - g.w0.x, w.y - g.w0.y) * cam.z;
      if (!g.snap && far < 6) { schedule(F_LIVE); return; }
      o.b = g.snap ? o.b : { x: r1(w.x), y: r1(w.y) };
      o.z = topZ();
      begin();
      addObj(o);
      commit();
      setTool('select');
      select([o.id]);
    }

    function shapeDefaults(kind) {
      const c = toolStyle.shape.color;
      if (kind === 'frame') return {};
      return { fill: c === 'ink' ? 'slate-50' : c + '/10', color: c === 'ink' ? 'ink' : c + '/65', size: toolStyle.shape.size, tc: 'ink', fs: 'item' };
    }
    function createMove(p, w, shift) {
      const g = gesture;
      if (!g.preview && Math.hypot(p.x - g.p0.x, p.y - g.p0.y) < 4) return;
      let dx = w.x - g.w0.x, dy = w.y - g.w0.y;
      if (shift) { const s = Math.max(Math.abs(dx), Math.abs(dy)); dx = Math.sign(dx || 1) * s; dy = Math.sign(dy || 1) * s; }
      const o = Object.assign({ id: g.preview ? g.preview.id : newId(), kind: g.kind, x: Math.min(g.w0.x, g.w0.x + dx), y: Math.min(g.w0.y, g.w0.y + dy), w: Math.abs(dx), h: Math.abs(dy) }, shapeDefaults(g.kind));
      if (g.kind === 'frame') o.name = '框 ' + (frames().length + 1);
      g.preview = o;
      schedule(F_LIVE);
    }
    function createEnd(g, w) {
      let o = g.preview;
      if (!o || o.w < 6 || o.h < 6) {
        const size = { rect: [168, 96], ellipse: [148, 104], diamond: [148, 116], frame: [640, 400] }[g.kind] || [160, 100];
        o = Object.assign({ id: newId(), kind: g.kind, x: r1(g.w0.x - size[0] / 2), y: r1(g.w0.y - size[1] / 2), w: size[0], h: size[1] }, shapeDefaults(g.kind));
        if (g.kind === 'frame') o.name = '框 ' + (frames().length + 1);
      }
      ['x', 'y', 'w', 'h'].forEach(k => { o[k] = r1(o[k]); });
      o.z = g.kind === 'frame' ? bottomZ() : topZ();
      begin();
      addObj(o);
      commit();
      setTool('select');
      select([o.id]);
      if (g.kind !== 'frame') startEdit(doc.get(o.id), 'text', false);
    }
    function createText(w) {
      const st = toolStyle.text;
      const lh = (theme.fs.item || [15, 22])[1];
      const o = { id: newId(), kind: 'text', x: r1(w.x), y: r1(w.y - lh / 2), w: 240, h: lh, text: '', fs: 'item', color: st.color, z: topZ() };
      begin();
      addObj(o);
      setTool('select');
      select([o.id]);
      startEdit(doc.get(o.id), 'text', true);
    }
    function createSticky(w) {
      const c = toolStyle.sticky.color;
      const o = { id: newId(), kind: 'sticky', x: r1(w.x - 88), y: r1(w.y - 88), w: 176, h: 176, fill: c === 'ink' ? 'slate-100' : c + '/22', text: '', fs: 'item', z: topZ() };
      begin();
      addObj(o);
      setTool('select');
      select([o.id]);
      startEdit(doc.get(o.id), 'text', true);
    }
    function toggleVote(o) {
      const key = 'v.' + actor;
      begin();
      updObj(o.id, { [key]: o[key] ? null : 1 });
      commit();
      announce(o[key] ? '已投一票' : '已撤回这一票');
    }

    /* ----- 文字编辑（textarea 叠在画布上，跟镜头缩放） ----- */
    function startEdit(o, field, created) {
      if (!o || !canEdit()) return;
      if (field === 'text' && !TEXTUAL.has(o.kind)) return;
      if (o.kind === 'card' && o.variant === 'knowledge') { toast('知识卡引用的内容来自知识地图，这里不改。'); return; }
      editing = { id: o.id, field, created: !!created };
      editor.value = o[field] || '';
      editor.hidden = false;
      editor.dataset.kind = o.kind;
      placeEditor();
      editor.focus({ preventScroll: true });
      if (!created) editor.select();
      schedule(F_BASE | F_LIVE);
    }
    function placeEditor() {
      if (!editing) return;
      const o = doc.get(editing.id);
      if (!o) { endEdit(false); return; }
      const st = textStyle(o, editing.field);
      const box = textBox(o, editing.field);
      const sz = theme.fs[st.fs] || theme.fs.body;
      const size = st.size || sz[0], lh = st.lh || sz[1];
      const lines = wrap(editor.value || ' ', Math.max(8, box.w), fontOf(st.fs, st.bold, st.mono, st.size)).length;
      const h = editing.field === 'name' ? box.h : Math.max(lh, lines * lh);
      const top = st.valign === 'middle' ? box.y + (box.h - h) / 2 : box.y;
      const s = toScreen(box.x, top);
      editor.style.transform = 'translate(' + r1(s.x) + 'px,' + r1(s.y) + 'px) scale(' + cam.z + ')';
      editor.style.width = Math.max(40, box.w) + 'px';
      editor.style.height = h + 'px';
      editor.style.font = fontOf(st.fs, st.bold, st.mono, st.size);
      editor.style.lineHeight = lh + 'px';
      editor.style.fontSize = size + 'px';
      editor.style.textAlign = st.align === 'center' ? 'center' : 'left';
      editor.style.color = col(st.color || 'ink');
    }
    function endEdit(save) {
      if (!editing) return;
      const ed = editing;
      editing = null;
      const val = editor.value;
      editor.hidden = true;
      const o = doc.get(ed.id);
      begin();
      if (o) {
        if (ed.created && !val.trim()) remObj(o.id);
        else if (save && val !== (o[ed.field] || '')) {
          const patch = { [ed.field]: val };
          if (o.kind === 'text') patch.h = textHeight(Object.assign({}, o, { text: val }));
          updObj(o.id, patch);
        }
      }
      commit();
      if (document.activeElement === editor) stage.focus({ preventScroll: true });
      schedule(F_BASE | F_LIVE | F_UI);
    }

    /* ----- 编辑命令 ----- */
    function expandSel() {
      const ids = new Set(selection);
      selected().forEach(o => { if (o.kind === 'frame') frameKids(o).forEach(id => ids.add(id)); });
      return Array.from(ids);
    }
    function clipPayload(ids) {
      const list = ids.map(id => copy(doc.get(id))).filter(Boolean).sort((a, b) => (a.z || 0) - (b.z || 0));
      return { format: 'commons-board-clip', version: 1, objects: list };
    }
    function pasteObjects(list, offset) {
      if (!canEdit() || !list || !list.length) return;
      const idMap = new Map(), gMap = new Map();
      list.forEach(o => idMap.set(o.id, newId()));
      let z = topZ();
      const out = list.map(src => {
        const o = cleanPatch(src);
        if (!o.kind) return null;
        o.id = idMap.get(src.id);
        if (o.g) { if (!gMap.has(o.g)) gMap.set(o.g, 'g-' + rid()); o.g = gMap.get(o.g); }
        Object.keys(o).forEach(k => { if (VOTE_KEY.test(k)) delete o[k]; });
        if (o.kind === 'line') {
          ['a', 'b'].forEach(end => {
            const e = o[end];
            if (!e) return;
            if (e.id && idMap.has(e.id)) o[end] = { id: idMap.get(e.id), x: e.x + offset, y: e.y + offset };
            else if (e.id && doc.get(e.id)) o[end] = { id: e.id, x: e.x, y: e.y };
            else o[end] = { x: e.x + offset, y: e.y + offset };
          });
        } else { o.x = r1((o.x || 0) + offset); o.y = r1((o.y || 0) + offset); }
        o.z = z++;
        return o;
      }).filter(Boolean);
      begin();
      out.forEach(addObj);
      commit();
      select(out.map(o => o.id));
      announce('已粘贴 ' + out.length + ' 个对象');
    }
    function duplicate() {
      const ids = expandSel();
      if (!ids.length) return;
      pasteObjects(clipPayload(ids).objects, 24);
    }
    function deleteSel() {
      if (!selection.size || !canEdit()) return;
      const ids = expandSel();
      begin();
      removeIds(ids);
      commit();
      select([]);
      announce('已删除 ' + ids.length + ' 个对象');
    }
    function selectAll() { select(doc.ordered().map(o => o.id)); }
    function group(on) {
      const list = selected();
      if (!canEdit() || !list.length) return;
      begin();
      const g = on && list.length > 1 ? 'g-' + rid() : null;
      list.forEach(o => updObj(o.id, { g }));
      commit();
      announce(g ? '已组合' : '已取消组合');
    }
    function layer(dir) {
      const list = selected().sort((a, b) => (a.z || 0) - (b.z || 0));
      if (!canEdit() || !list.length) return;
      const all = doc.ordered();
      begin();
      if (dir === 'front') { let z = topZ(); list.forEach(o => updObj(o.id, { z: z++ })); }
      else if (dir === 'back') { let z = bottomZ() - list.length; list.forEach(o => updObj(o.id, { z: z++ })); }
      else {
        const ids = new Set(list.map(o => o.id));
        (dir === 'forward' ? list.slice().reverse() : list).forEach(o => {
          const i = all.indexOf(o);
          const j = dir === 'forward' ? all.findIndex((p, k) => k > i && !ids.has(p.id)) : (() => { for (let k = i - 1; k >= 0; k--) if (!ids.has(all[k].id)) return k; return -1; })();
          if (j < 0) return;
          const n1 = all[j], n2 = all[dir === 'forward' ? j + 1 : j - 1];
          const z = n2 ? ((n1.z || 0) + (n2.z || 0)) / 2 : (n1.z || 0) + (dir === 'forward' ? 1 : -1);
          updObj(o.id, { z });
        });
      }
      commit();
    }
    function align(mode) {
      const list = selected().filter(o => o.kind !== 'line');
      if (!canEdit() || list.length < 2) return;
      const b = unionBox(list);
      begin();
      if (mode === 'distH' || mode === 'distV') {
        const hz = mode === 'distH';
        const sorted = list.slice().sort((p, q) => (hz ? p.x + p.w / 2 - (q.x + q.w / 2) : p.y + p.h / 2 - (q.y + q.h / 2)));
        const total = sorted.reduce((s, o) => s + (hz ? o.w : o.h), 0);
        const gap = ((hz ? b.w : b.h) - total) / Math.max(1, sorted.length - 1);
        let at = hz ? b.x : b.y;
        sorted.forEach(o => { updObj(o.id, hz ? { x: r1(at) } : { y: r1(at) }); at += (hz ? o.w : o.h) + gap; });
      } else {
        list.forEach(o => {
          const p = {};
          if (mode === 'alignL') p.x = b.x;
          if (mode === 'alignC') p.x = r1(b.x + b.w / 2 - o.w / 2);
          if (mode === 'alignR') p.x = r1(b.x + b.w - o.w);
          if (mode === 'alignT') p.y = b.y;
          if (mode === 'alignM') p.y = r1(b.y + b.h / 2 - o.h / 2);
          if (mode === 'alignB') p.y = r1(b.y + b.h - o.h);
          updObj(o.id, p);
        });
      }
      commit();
    }
    function applyColor(c) {
      const list = selected();
      if (!list.length) {
        const key = styleKey(tool);
        if (key) { toolStyle[key].color = c; schedule(F_UI); }
        return;
      }
      begin();
      list.forEach(o => {
        if (o.kind === 'sticky') updObj(o.id, { fill: c === 'ink' ? 'slate-100' : c + '/22' });
        else if (SHAPES.has(o.kind)) updObj(o.id, { color: c === 'ink' ? 'ink' : c + '/65', fill: c === 'ink' ? 'slate-50' : c + '/10' });
        else if (o.kind === 'card') updObj(o.id, { color: c });
        else if (o.kind !== 'frame' && o.kind !== 'image') updObj(o.id, { color: c });
      });
      commit();
      const key = list.length === 1 ? styleKey(list[0].kind) : null;
      if (key) toolStyle[key].color = c;
    }
    function applySize(n) {
      const list = selected();
      if (!list.length) { const key = styleKey(tool); if (key && toolStyle[key].size) { toolStyle[key].size = n; schedule(F_UI); } return; }
      begin();
      list.forEach(o => {
        if (o.kind === 'pen' || o.kind === 'hl') {
          // 改线宽不动点位，只按比例补外框
          updObj(o.id, { size: n });
        } else if (SHAPES.has(o.kind) || o.kind === 'line') updObj(o.id, { size: n });
      });
      commit();
    }
    function applyLine(patch) {
      const list = selected().filter(o => o.kind === 'line');
      if (!list.length) { Object.assign(toolStyle.line, patch); schedule(F_UI); return; }
      begin();
      list.forEach(o => updObj(o.id, patch));
      commit();
      Object.assign(toolStyle.line, patch);
    }
    function styleKey(t) {
      if (t === 'pen' || t === 'hl' || t === 'sticky' || t === 'text') return t;
      if (SHAPES.has(t)) return 'shape';
      if (t === 'arrow' || t === 'line') return 'line';
      return null;
    }

    /* ----- 模板 ----- */
    function insertTemplate(id, at) {
      if (!canEdit()) return [];
      const tpl = templateList().find(t => t.id === id);
      if (!tpl) return [];
      const c = at || toWorld(vw / 2, vh / 2);
      let z = topZ();
      const objs = instantiate(tpl, c.x, c.y, newId, null, 'center');
      begin();
      objs.forEach(o => { o.z = z++; addObj(o); });
      commit();
      setTool('select');
      select(objs.map(o => o.id));
      announce('已放入「' + tpl.name + '」，可以继续改');
      return objs.map(o => o.id);
    }
    function thumbSVG(tpl) {
      let n = 0;
      const objs = instantiate(tpl, 0, 0, () => 't' + (++n), null, 'topleft');
      return toSVG(objs, { vars: true, pad: 16, thumb: true });
    }

    /* ----- 导出 ----- */
    function svgColor(token, vars) {
      if (!token) return 'none';
      if (!vars) return col(token);
      const slash = token.indexOf('/');
      return slash < 0 ? 'var(--' + token + ')' : 'color-mix(in oklab, var(--' + token.slice(0, slash) + ') ' + token.slice(slash + 1) + '%, var(--surface))';
    }
    function svgText(text, x, y, w, h, st, vars) {
      if (!text) return '';
      const sz = theme.fs[st.fs] || theme.fs.body;
      const size = st.size || sz[0], lh = st.lh || sz[1];
      let lines = wrap(text, Math.max(8, w), fontOf(st.fs, st.bold, st.mono, st.size));
      if (st.clip !== false) { const max = Math.max(1, Math.floor((h + 4) / lh)); if (lines.length > max) lines = lines.slice(0, max); }
      const total = lines.length * lh;
      const ty = st.valign === 'middle' ? y + (h - total) / 2 : y;
      const anchor = st.align === 'center' ? 'middle' : 'start';
      const tx = st.align === 'center' ? x + w / 2 : x;
      const fam = st.mono ? theme.mono : theme.sans;
      return '<text x="' + f2(tx) + '" font-family="' + esc(fam) + '" font-size="' + f2(size) + '" font-weight="' + esc(st.bold ? theme.weight.semibold : theme.weight.regular) + '" text-anchor="' + anchor + '" dominant-baseline="central" style="fill:' + esc(svgColor(st.color || 'ink', vars)) + '">' +
        lines.map((ln, i) => '<tspan x="' + f2(tx) + '" y="' + f2(ty + lh * i + lh / 2) + '">' + esc(ln.t) + '</tspan>').join('') + '</text>';
    }
    function toSVG(objs, o2) {
      const opt = o2 || {};
      const vars = !!opt.vars;
      const map = new Map(objs.map(o => [o.id, o]));
      const get = id => map.get(id) || null;
      const b = unionBox(objs, o => (o.kind === 'line' ? (lineGeom(o, get) || {}).bounds : o.kind === 'frame' ? { x: o.x, y: o.y - 26, w: o.w, h: o.h + 26 } : o));
      if (!b) return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>';
      const pad = opt.pad == null ? 32 : opt.pad;
      /* safe-fn: 只返回颜色串（运行时计算值或 var(--token)），并且已经 esc */
      function C(t) { return esc(svgColor(t, vars)); }
      const parts = [];
      objs.slice().sort((p, q) => (p.z || 0) - (q.z || 0)).forEach(o => {
        const st = textStyle(o, 'text');
        switch (o.kind) {
          case 'rect': case 'ellipse': case 'diamond': {
            const sty = 'fill:' + (o.fill ? C(o.fill) : 'none') + ';stroke:' + (o.color ? C(o.color) : 'none') + ';stroke-width:' + (WIDTH.shape[o.size || 2] || 2);
            if (o.kind === 'rect') parts.push('<rect x="' + f2(o.x) + '" y="' + f2(o.y) + '" width="' + f2(o.w) + '" height="' + f2(o.h) + '" rx="' + f2(Math.min(o.radius == null ? 10 : o.radius, o.w / 2, o.h / 2)) + '" style="' + esc(sty) + '"/>');
            else if (o.kind === 'ellipse') parts.push('<ellipse cx="' + f2(o.x + o.w / 2) + '" cy="' + f2(o.y + o.h / 2) + '" rx="' + f2(o.w / 2) + '" ry="' + f2(o.h / 2) + '" style="' + esc(sty) + '"/>');
            else parts.push('<path d="M' + f2(o.x + o.w / 2) + ' ' + f2(o.y) + 'L' + f2(o.x + o.w) + ' ' + f2(o.y + o.h / 2) + 'L' + f2(o.x + o.w / 2) + ' ' + f2(o.y + o.h) + 'L' + f2(o.x) + ' ' + f2(o.y + o.h / 2) + 'Z" style="' + esc(sty) + ';stroke-linejoin:round"/>');
            const tb = textBox(o);
            if (!opt.thumb || o.w > 60) parts.push(svgText(o.text, tb.x, tb.y, tb.w, tb.h, st, vars));
            break;
          }
          case 'sticky': {
            parts.push('<rect x="' + f2(o.x) + '" y="' + f2(o.y) + '" width="' + f2(o.w) + '" height="' + f2(o.h) + '" rx="6" style="fill:' + C(o.fill || 'sky-100') + '"/>');
            const tb = textBox(o);
            parts.push(svgText(o.text, tb.x, tb.y, tb.w, tb.h, st, vars));
            if (o.vote) { const p = votePill(o); parts.push('<rect x="' + f2(p.x) + '" y="' + f2(p.y) + '" width="' + f2(p.w) + '" height="' + f2(p.h) + '" rx="' + f2(p.h / 2) + '" style="fill:' + C('surface') + ';stroke:' + C('line-strong') + '"/>' + svgText('+1 · ' + voteCount(o), p.x, p.y, p.w, p.h, { fs: 'meta', bold: true, color: 'ink-2', align: 'center', valign: 'middle' }, vars)); }
            break;
          }
          case 'card': {
            const v = o.variant || 'note';
            parts.push('<rect x="' + f2(o.x) + '" y="' + f2(o.y) + '" width="' + f2(o.w) + '" height="' + f2(o.h) + '" rx="12" style="fill:' + C(v === 'code' ? 'slate-50' : 'surface') + ';stroke:' + C(v === 'knowledge' ? 'teal-200' : 'line-strong') + '"/>');
            const tb = textBox(o);
            if (v === 'knowledge') {
              parts.push('<rect x="' + f2(o.x) + '" y="' + f2(o.y + 6) + '" width="4" height="' + f2(o.h - 12) + '" style="fill:' + C('teal-500') + '"/>');
              parts.push(svgText('知识卡引用 · 示例', o.x + 20, o.y + 14, o.w - 36, 16, { fs: 'micro', bold: true, color: 'teal-700' }, vars));
              parts.push(svgText(o.title || '', o.x + 20, o.y + 34, o.w - 36, 30, { fs: 'item', bold: true, color: 'ink' }, vars));
              parts.push(svgText(o.text || '', tb.x, tb.y, tb.w, tb.h, st, vars));
              parts.push(svgText(o.meta || '', o.x + 20, o.y + o.h - 36, o.w - 36, 22, { fs: 'meta', bold: true, color: 'teal-700', valign: 'middle' }, vars));
            } else if (v === 'code') {
              parts.push('<rect x="' + f2(o.x + 1) + '" y="' + f2(o.y + 1) + '" width="' + f2(o.w - 2) + '" height="31" rx="11" style="fill:' + C('slate-100') + '"/>');
              parts.push(svgText(o.title || '代码', o.x + 16, o.y + 6, o.w - 32, 20, { fs: 'meta', mono: true, color: 'muted', valign: 'middle' }, vars));
              parts.push(svgText(o.text || '', tb.x, tb.y, tb.w, tb.h, st, vars));
            } else {
              parts.push('<rect x="' + f2(o.x + 6) + '" y="' + f2(o.y) + '" width="' + f2(o.w - 12) + '" height="4" style="fill:' + C(o.color || 'accent') + '"/>');
              parts.push(svgText(o.title || '', o.x + 18, o.y + 20, o.w - 36, 26, { fs: 'section', bold: true, color: 'ink' }, vars));
              parts.push(svgText(o.text || '', tb.x, tb.y, tb.w, tb.h, st, vars));
            }
            break;
          }
          case 'text': parts.push(svgText(o.text, o.x, o.y, o.w, o.h, st, vars)); break;
          case 'frame':
            parts.push('<rect x="' + f2(o.x) + '" y="' + f2(o.y) + '" width="' + f2(o.w) + '" height="' + f2(o.h) + '" rx="14" style="fill:' + C('surface') + ';stroke:' + C('line-strong') + '"/>');
            parts.push('<text x="' + f2(o.x + 2) + '" y="' + f2(o.y - 9) + '" font-family="' + esc(theme.sans) + '" font-size="12" font-weight="' + esc(theme.weight.semibold) + '" style="fill:' + C('muted') + '">' + esc(o.name || '框') + '</text>');
            break;
          case 'image':
            if (o.src) parts.push('<image href="' + safeUrl(o.src) + '" x="' + f2(o.x) + '" y="' + f2(o.y) + '" width="' + f2(o.w) + '" height="' + f2(o.h) + '" preserveAspectRatio="none"/>');
            break;
          case 'pen': case 'hl': {
            const sx = o.w / (o.pw || o.w || 1), sy = o.h / (o.ph || o.h || 1);
            const tr = 'translate(' + f2(o.x) + ' ' + f2(o.y) + ') scale(' + f2(sx) + ' ' + f2(sy) + ')';
            if (o.kind === 'hl') parts.push('<path transform="' + tr + '" d="' + centerD(o.pts || []) + '" style="fill:none;stroke:' + C(o.color || 'cat-3') + ';stroke-width:' + (WIDTH.hl[o.size || 2] || 18) + ';stroke-linecap:round;stroke-linejoin:round;opacity:.34"/>');
            else parts.push('<path transform="' + tr + '" d="' + outlineD(o.pts || [], WIDTH.pen[o.size || 2] || 3.8) + '" style="fill:' + C(o.color || 'ink') + '"/>');
            break;
          }
          case 'line': {
            const g = lineGeom(o, get);
            if (!g) break;
            const c = C(o.color || 'ink');
            parts.push('<path d="' + lineD(g) + '" style="fill:none;stroke:' + c + ';stroke-width:' + f2(g.sw) + ';stroke-linecap:round;stroke-linejoin:round' + (o.dash ? ';stroke-dasharray:' + f2(g.sw * 3) + ' ' + f2(g.sw * 2.6) : '') + '"/>');
            if (g.endB) parts.push('<path d="' + arrowD(g.B, g.dirB, g.head) + '" style="fill:' + c + ';stroke:' + c + ';stroke-width:' + f2(Math.max(1, g.sw * 0.6)) + ';stroke-linejoin:round"/>');
            if (g.endA) parts.push('<path d="' + arrowD(g.A, g.dirA, g.head) + '" style="fill:' + c + ';stroke:' + c + ';stroke-width:' + f2(Math.max(1, g.sw * 0.6)) + ';stroke-linejoin:round"/>');
            break;
          }
          default: break;
        }
      });
      const vb = [b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2].map(f2);
      const size = opt.thumb ? ' preserveAspectRatio="xMidYMid meet"' : ' width="' + vb[2] + '" height="' + vb[3] + '"';
      const bg = opt.thumb ? '' : '<rect x="' + vb[0] + '" y="' + vb[1] + '" width="' + vb[2] + '" height="' + vb[3] + '" style="fill:' + C('paper') + '"/>';
      return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + vb.join(' ') + '"' + size + (opt.thumb ? ' aria-hidden="true" focusable="false"' : '') + '>' + bg + parts.join('') + '</svg>';
    }
    function exportPNG(scale) {
      const list = doc.ordered();
      const b = unionBox(list, o => (o.kind === 'frame' ? { x: o.x, y: o.y - 28, w: o.w, h: o.h + 28 } : boundsOf(o)));
      if (!b) return Promise.resolve(null);
      const pad = 40;
      const s = Math.min(scale || 2, 8000 / (b.w + pad * 2), 8000 / (b.h + pad * 2));
      const cv = document.createElement('canvas');
      cv.width = Math.ceil((b.w + pad * 2) * s);
      cv.height = Math.ceil((b.h + pad * 2) * s);
      const ctx = cv.getContext('2d');
      ctx.fillStyle = col('paper');
      ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.setTransform(s, 0, 0, s, (pad - b.x) * s, (pad - b.y) * s);
      const keep = presenting;
      presenting = null;
      list.forEach(o => { ctx.globalAlpha = 1; drawObj(ctx, o, s); });
      presenting = keep;
      return new Promise(resolve => cv.toBlob(blob => resolve(blob), 'image/png'));
    }
    function exportJSON() { return { format: 'commons-board', version: 1, exportedAt: new Date().toISOString(), objects: doc.ordered().map(o => copy(o)) }; }
    function importJSON(data) {
      if (!canEdit()) return 0;
      const list = data && Array.isArray(data.objects) ? data.objects : Array.isArray(data) ? data : null;
      if (!list || (data.format && data.format !== 'commons-board' && data.format !== 'commons-board-clip')) { toast('这个文件不是白板 JSON，画布没有改动。'); return 0; }
      const clean = list.map(o => (o && typeof o.id === 'string' && o.id.length <= 80 ? Object.assign(cleanPatch(o), { id: o.id }) : null)).filter(o => o && o.kind);
      if (!clean.length) { toast('文件里没有可用的对象，画布没有改动。'); return 0; }
      endEdit(true);
      begin();
      const keepIds = new Set(clean.map(o => o.id));
      doc.ordered().slice().forEach(o => { if (!keepIds.has(o.id)) remObj(o.id); });
      clean.forEach(o => {
        const cur = doc.get(o.id);
        if (cur) {
          const p = Object.assign({}, o);
          delete p.id;
          Object.keys(cur).forEach(k => { if (k !== 'id' && !(k in p)) p[k] = null; });
          updObj(o.id, p);
        } else addObj(o);
      });
      commit();
      select([]);
      fitAll(true);
      toast('已导入 ' + clean.length + ' 个对象。不满意可以撤销（⌘Z）。');
      return clean.length;
    }
    function download(blob, name) {
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      later(() => URL.revokeObjectURL(a.href), 4000);
    }
    const stamp = () => { const d = new Date(); const p = n => String(n).padStart(2, '0'); return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()); };

    /* ----- 图片 ----- */
    function pickImage() { if (canEdit()) fileImage.click(); }
    function readImage(file, at) {
      if (!file || !/^image\/(png|jpeg|gif|webp)$/.test(file.type)) { toast('只能插入 PNG、JPG、GIF 或 WebP 图片。'); return; }
      if (file.size > MAX_IMAGE) { toast('这张图片超过 5MB，没有插入。可以先压缩再试。'); return; }
      const fr = new FileReader();
      fr.onload = () => {
        const src = String(fr.result || '');
        const im = new Image();
        im.onload = () => {
          let data = src;
          const maxSide = 1600;
          if (Math.max(im.naturalWidth, im.naturalHeight) > maxSide && file.type !== 'image/gif') {
            const k = maxSide / Math.max(im.naturalWidth, im.naturalHeight);
            const cv = document.createElement('canvas');
            cv.width = Math.round(im.naturalWidth * k);
            cv.height = Math.round(im.naturalHeight * k);
            cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height);
            data = cv.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.88);
          }
          if (!IMG_RE.test(data)) { toast('这张图片读不出来，没有插入。'); return; }
          const c = at || toWorld(vw / 2, vh / 2);
          const w0 = Math.min(im.naturalWidth, 480 / Math.max(cam.z, 0.25));
          const h0 = w0 * im.naturalHeight / Math.max(1, im.naturalWidth);
          const o = { id: newId(), kind: 'image', x: r1(c.x - w0 / 2), y: r1(c.y - h0 / 2), w: r1(w0), h: r1(h0), src: data, z: topZ() };
          begin();
          addObj(o);
          commit();
          setTool('select');
          select([o.id]);
          announce('图片已插入');
        };
        im.onerror = () => toast('这张图片读不出来，没有插入。');
        im.src = src;
      };
      fr.onerror = () => toast('这张图片读不出来，没有插入。');
      fr.readAsDataURL(file);
    }

    /* ----- 外壳 UI ----- */
    function chromeHTML() {
      const tools = TOOLS.map(t => (t.sep ? '<span class="bd-sep" aria-hidden="true"></span>'
        : '<button type="button" class="bd-tool" data-board-act="tool" data-tool="' + t.id + '" aria-pressed="false" aria-label="' + esc(t.label) + '，快捷键 ' + t.key + '" data-tip="' + esc(t.tip || t.label + ' · ' + t.key) + '">' + ic(t.icon) + '</button>')).join('');
      const tiles = templateList().map(t => '<button type="button" class="bd-tile" data-board-act="template" data-template="' + esc(t.id) + '" aria-label="放入「' + esc(t.name) + '」：' + esc(t.desc || '') + '"><span class="bd-tile-thumb" data-thumb="' + esc(t.id) + '"></span><span class="bd-tile-name">' + esc(t.name) + '</span><span class="bd-tile-desc">' + esc(t.desc || '') + '</span></button>').join('');
      return '<div class="bd-stage" tabindex="0" role="application" aria-roledescription="白板" aria-label="白板画布。V 选择，P 笔，按住空格拖动平移，滚轮缩放。">' +
        '<canvas class="bd-canvas bd-canvas-base" aria-hidden="true"></canvas><canvas class="bd-canvas bd-canvas-live" aria-hidden="true"></canvas>' +
        '<div class="bd-cursors" aria-hidden="true"></div>' +
        '<textarea class="bd-editor" hidden aria-label="编辑文字，Esc 完成" spellcheck="false"></textarea></div>' +
        '<div class="bd-rail bd-float" role="toolbar" aria-label="白板工具" aria-orientation="vertical">' + tools +
        '<span class="bd-sep" aria-hidden="true"></span><button type="button" class="bd-tool bd-tool-panel" data-board-act="panel" aria-expanded="false" aria-label="组件面板" data-tip="组件">' + ic('components') + '</button></div>' +
        '<aside class="bd-panel bd-float" hidden aria-label="组件"><div class="bd-panel-head"><div><h3>组件</h3><p>拖到画布上，或点一下放到视野中央</p></div><button type="button" class="bd-icon-btn" data-board-act="panel" aria-label="关闭组件面板">' + ic('close') + '</button></div><div class="bd-panel-grid">' + tiles + '</div></aside>' +
        '<div class="bd-style bd-float" role="toolbar" aria-label="样式" hidden></div>' +
        '<div class="bd-top bd-float" role="toolbar" aria-label="白板操作">' +
        '<button type="button" class="bd-icon-btn" data-board-act="undo" aria-label="撤销（⌘Z）" data-tip="撤销 · ⌘Z">' + ic('undo') + '</button>' +
        '<button type="button" class="bd-icon-btn" data-board-act="redo" aria-label="重做（⇧⌘Z）" data-tip="重做 · ⇧⌘Z">' + ic('redo') + '</button>' +
        '<span class="bd-sep bd-sep-v" aria-hidden="true"></span>' +
        '<button type="button" class="bd-pill-btn" data-board-act="present" aria-label="按框演示">' + ic('present') + '<span>演示</span></button>' +
        '<button type="button" class="bd-icon-btn" data-board-act="menu" data-menu="export" aria-haspopup="menu" aria-expanded="false" aria-label="导出和导入" data-tip="导出 / 导入">' + ic('download') + '</button>' +
        '<button type="button" class="bd-icon-btn" data-board-act="menu" data-menu="help" aria-haspopup="dialog" aria-expanded="false" aria-label="快捷键" data-tip="快捷键">' + ic('help') + '</button></div>' +
        '<div class="bd-zoom bd-float" role="group" aria-label="缩放">' +
        '<button type="button" class="bd-icon-btn" data-board-act="zoom-out" aria-label="缩小（⌘−）">' + ic('minus') + '</button>' +
        '<button type="button" class="bd-zoom-val" data-board-act="zoom-reset" aria-label="缩放比例，点一下回到 100%">100%</button>' +
        '<button type="button" class="bd-icon-btn" data-board-act="zoom-in" aria-label="放大（⌘+）">' + ic('plus') + '</button>' +
        '<button type="button" class="bd-icon-btn" data-board-act="fit" aria-label="适应全部（⇧1）" data-tip="适应全部 · ⇧1">' + ic('fit') + '</button></div>' +
        '<div class="bd-follow bd-float" hidden></div>' +
        '<div class="bd-present bd-float" hidden></div>' +
        '<div class="bd-menu" hidden></div>' +
        '<div class="bd-toast" role="status" aria-live="polite"></div>' +
        '<p class="bd-sr" aria-live="polite"></p>' +
        '<input type="file" class="bd-file-image" accept="image/png,image/jpeg,image/gif,image/webp" hidden>' +
        '<input type="file" class="bd-file-json" accept="application/json,.json" hidden>';
    }
    function renderThumbs() {
      root.querySelectorAll('[data-thumb]').forEach(el => {
        const tpl = templateList().find(t => t.id === el.dataset.thumb);
        if (tpl) el.innerHTML = thumbSVG(tpl);
      });
    }
    function toast(msg) {
      if (opts.chrome === 'none') return;
      toastEl.textContent = msg;
      toastEl.classList.add('is-on');
      clearTimeout(toastEl._t);
      timers.delete(toastEl._t);
      toastEl._t = later(() => toastEl.classList.remove('is-on'), 2800);
    }
    function announce(msg) { const sr = root.querySelector('.bd-sr'); if (sr) sr.textContent = msg; }
    function setTool(t) {
      if (t === 'image') { pickImage(); return; }
      if (!TOOLS.some(x => x.id === t)) return;
      if (!canEdit() && t !== 'hand' && t !== 'select' && !(t === 'laser' && canLaser())) return;
      if (editing) endEdit(true);
      tool = t;
      hover = null;
      stage.style.cursor = '';
      if (t !== 'select') { selection.clear(); }
      schedule(F_LIVE | F_UI);
      const def = TOOLS.find(x => x.id === t);
      announce('工具：' + def.label);
    }
    function togglePanel(open) {
      const want = open == null ? panel.hidden : open;
      panel.hidden = !want;
      root.querySelectorAll('[data-board-act="panel"][aria-expanded]').forEach(b => b.setAttribute('aria-expanded', String(want)));
      root.classList.toggle('has-panel', want);
      if (want && !panel.dataset.ready) { renderThumbs(); panel.dataset.ready = '1'; }
    }
    function styleBarHTML() {
      const list = selected();
      const kinds = new Set(list.map(o => o.kind));
      const key = list.length ? null : styleKey(tool);
      const show = canEdit() && !presenting && (list.length || key);
      if (!show) return '';
      const cur = list.length ? (list[0].kind === 'sticky' || SHAPES.has(list[0].kind) ? (list[0].kind === 'sticky' ? list[0].fill : list[0].color) : list[0].color) : toolStyle[key].color;
      const curBase = String(cur || '').split('/')[0];
      const colorable = !list.length || list.some(o => o.kind !== 'frame' && o.kind !== 'image');
      let h = '';
      if (colorable) {
        h += '<div class="bd-swatches" role="group" aria-label="颜色">' + PALETTE.map(([t, label]) => '<button type="button" class="bd-swatch" data-board-act="color" data-color="' + t + '" style="--sw: var(--' + t + ')" aria-pressed="' + (curBase === t) + '" aria-label="' + label + '"></button>').join('') + '</div>';
      }
      const sizable = list.length ? list.some(o => o.kind === 'pen' || o.kind === 'hl' || SHAPES.has(o.kind) || o.kind === 'line') : !!(toolStyle[key] && toolStyle[key].size);
      if (sizable) {
        const curSize = list.length ? (list[0].size || 2) : toolStyle[key].size;
        h += '<span class="bd-sep bd-sep-v" aria-hidden="true"></span><div class="bd-sizes" role="group" aria-label="线宽">' + [1, 2, 3].map(n => '<button type="button" class="bd-size" data-board-act="size" data-size="' + n + '" aria-pressed="' + (curSize === n) + '" aria-label="' + ['细', '中', '粗'][n - 1] + '"><i style="--dot:' + (n * 2 + 1) + 'px"></i></button>').join('') + '</div>';
      }
      if (kinds.has('line') || key === 'line') {
        const ref = list.find(o => o.kind === 'line') || toolStyle.line;
        h += '<span class="bd-sep bd-sep-v" aria-hidden="true"></span><div class="bd-routes" role="group" aria-label="线形">' + [['sag', '重力下垂'], ['curve', '平滑曲线'], ['elbow', '直角折线'], ['straight', '直线']].map(([r, label]) => '<button type="button" class="bd-icon-btn" data-board-act="route" data-route="' + r + '" aria-pressed="' + ((ref.route || 'curve') === r) + '" aria-label="' + label + '" data-tip="' + label + '">' + ic(r) + '</button>').join('') +
          '<button type="button" class="bd-icon-btn" data-board-act="arrowhead" aria-pressed="' + (ref.arrow !== 'none') + '" aria-label="终点箭头" data-tip="终点箭头">' + ic('arrowEnd') + '</button>' +
          '<button type="button" class="bd-icon-btn" data-board-act="dash" aria-pressed="' + Boolean(ref.dash) + '" aria-label="虚线" data-tip="虚线">' + ic('dash') + '</button></div>';
      }
      if (list.length) {
        h += '<span class="bd-sep bd-sep-v" aria-hidden="true"></span>';
        if (list.length > 1) h += '<button type="button" class="bd-icon-btn" data-board-act="menu" data-menu="align" aria-haspopup="menu" aria-expanded="false" aria-label="对齐和分布" data-tip="对齐和分布">' + ic('alignL') + '</button>';
        const grouped = list.length > 1 && list.every(o => o.g && o.g === list[0].g);
        if (list.length > 1) h += '<button type="button" class="bd-icon-btn" data-board-act="group" aria-pressed="' + grouped + '" aria-label="' + (grouped ? '取消组合（⇧⌘G）' : '组合（⌘G）') + '" data-tip="' + (grouped ? '取消组合 · ⇧⌘G' : '组合 · ⌘G') + '">' + ic(grouped ? 'ungroup' : 'group') + '</button>';
        h += '<button type="button" class="bd-icon-btn" data-board-act="layer" data-dir="front" aria-label="置于顶层（⇧⌘]）" data-tip="置顶 · ⇧⌘]">' + ic('front') + '</button>' +
          '<button type="button" class="bd-icon-btn" data-board-act="layer" data-dir="back" aria-label="置于底层（⇧⌘[）" data-tip="置底 · ⇧⌘[">' + ic('back') + '</button>' +
          '<button type="button" class="bd-icon-btn" data-board-act="duplicate" aria-label="复制一份（⌘D）" data-tip="复制一份 · ⌘D">' + ic('duplicate') + '</button>' +
          '<button type="button" class="bd-icon-btn bd-danger" data-board-act="delete" aria-label="删除（Delete）" data-tip="删除 · Del">' + ic('trash') + '</button>';
      }
      return h;
    }
    let styleKeyCache = '';
    function syncUi() {
      root.dataset.role = role;
      root.dataset.edit = String(canEdit());
      root.dataset.tool = held === 'laser' ? 'laser' : tool;
      stage.dataset.tool = spaceDown ? 'hand' : (held === 'laser' ? 'laser' : (canEdit() ? tool : (tool === 'laser' && canLaser() ? 'laser' : 'hand')));
      root.querySelectorAll('.bd-tool[data-tool]').forEach(b => {
        const t = b.dataset.tool;
        const def = TOOLS.find(x => x.id === t);
        const allowed = canEdit() || def.view || (def.laser && canLaser());
        b.setAttribute('aria-pressed', String(t === (held || tool)));
        if (allowed) { b.removeAttribute('aria-disabled'); b.dataset.tip = def.tip || def.label + ' · ' + def.key; }
        else { b.setAttribute('aria-disabled', 'true'); b.dataset.tip = def.laser ? '激光笔要主持人开启' : '只看：主持人开启后才能画'; }
      });
      const u = root.querySelector('[data-board-act="undo"]'), r = root.querySelector('[data-board-act="redo"]');
      if (u) { u.disabled = !history.length || !canEdit(); u.hidden = !canEdit(); }
      if (r) { r.disabled = !future.length || !canEdit(); r.hidden = !canEdit(); }
      const pt = root.querySelector('.bd-tool-panel');
      if (pt) pt.hidden = !canEdit();
      zoomVal.textContent = Math.round(cam.z * 100) + '%';
      const list = selected();
      const sk = [canEdit(), !!presenting, tool, list.map(o => o.id + ':' + doc.ver(o.id)).join(','), JSON.stringify(toolStyle)].join('|');
      if (sk !== styleKeyCache) {
        styleKeyCache = sk;
        const html = styleBarHTML();
        styleBar.innerHTML = html;
        styleBar.hidden = !html;
      }
      // 跟随
      const fid = following || lastFollow;
      if (fid && !presenting) {
        const nm = esc(names.get(fid) || '讲课人');
        followBar.hidden = false;
        followBar.innerHTML = following
          ? '<span class="bd-follow-dot" aria-hidden="true"></span><span>正在跟随 <b>' + nm + '</b> 的视角</span><button type="button" class="bd-link-btn" data-board-act="unfollow">自己看</button>'
          : '<span>你离开了 ' + nm + ' 的视角</span><button type="button" class="button tonal small" data-board-act="refollow">' + ic('eye') + '回到讲课人视角</button>';
      } else followBar.hidden = true;
      // 演示条
      if (presenting) {
        const fs = frames();
        const f = fs[presenting.index];
        presentBar.hidden = false;
        presentBar.innerHTML = '<button type="button" class="bd-icon-btn" data-board-act="slide" data-dir="-1" aria-label="上一个框（←）"' + (presenting.index <= 0 ? ' disabled' : '') + '>' + ic('prev') + '</button>' +
          '<span class="bd-present-label"><b>' + (Number(presenting.index) + 1) + ' / ' + fs.length + '</b>' + esc(f ? f.name || '框' : '') + '</span>' +
          '<button type="button" class="bd-icon-btn" data-board-act="slide" data-dir="1" aria-label="下一个框（→）"' + (presenting.index >= fs.length - 1 ? ' disabled' : '') + '>' + ic('next') + '</button>' +
          '<span class="bd-sep bd-sep-v" aria-hidden="true"></span><button type="button" class="bd-link-btn" data-board-act="present-exit">退出演示 · Esc</button>';
      } else presentBar.hidden = true;
      const pb = root.querySelector('[data-board-act="present"]');
      if (pb) pb.setAttribute('aria-pressed', String(!!presenting));
    }
    function placeOverlays() {
      cursors.forEach(placeCursor);
      if (editing) placeEditor();
    }
    function openMenu(btn, kind) {
      if (!menu.hidden && menu.dataset.kind === kind) { closeMenu(); return; }
      let h = '';
      if (kind === 'export') {
        h = '<div role="menu" aria-label="导出和导入">' +
          '<button type="button" role="menuitem" data-board-act="export" data-format="png">' + ic('download') + '<span>导出 PNG<small>整块白板，2 倍清晰度</small></span></button>' +
          '<button type="button" role="menuitem" data-board-act="export" data-format="svg">' + ic('download') + '<span>导出 SVG<small>矢量，可再编辑</small></span></button>' +
          '<button type="button" role="menuitem" data-board-act="export" data-format="json">' + ic('download') + '<span>导出 JSON<small>完整数据，能导回来</small></span></button>' +
          (canEdit() ? '<button type="button" role="menuitem" data-board-act="import">' + ic('upload') + '<span>导入 JSON<small>替换当前白板，可撤销</small></span></button>' : '') + '</div>';
      } else if (kind === 'align') {
        h = '<div role="menu" aria-label="对齐和分布" class="bd-menu-grid">' + [['alignL', '左对齐'], ['alignC', '水平居中'], ['alignR', '右对齐'], ['alignT', '顶对齐'], ['alignM', '垂直居中'], ['alignB', '底对齐'], ['distH', '水平等距'], ['distV', '垂直等距']].map(([m, label]) => '<button type="button" role="menuitem" class="bd-icon-btn" data-board-act="align" data-mode="' + m + '" aria-label="' + label + '" data-tip="' + label + '"' + (m.startsWith('dist') && selected().filter(o => o.kind !== 'line').length < 3 ? ' disabled' : '') + '>' + ic(m) + '</button>').join('') + '</div>';
      } else if (kind === 'help') {
        const rows = [['V', '选择'], ['H / 空格拖动', '平移'], ['P', '笔'], ['M', '荧光笔'], ['E', '橡皮'], ['R · O · D', '矩形 · 圆 · 菱形'], ['A', '连线和箭头'], ['T', '文字'], ['N', '便签'], ['F', '框'], ['I', '插入图片'], ['按住 L', '激光笔'], ['⌘Z / ⇧⌘Z', '撤销 / 重做'], ['⌘C · ⌘V · ⌘D', '复制 · 粘贴 · 复制一份'], ['⌘G / ⇧⌘G', '组合 / 取消组合'], ['⌘] · ⌘[', '上移 · 下移一层'], ['⇧1', '适应全部'], ['方向键', '微调（按住 ⇧ 走 10）；演示时切换框'], ['双击', '改文字']];
        h = '<div role="dialog" aria-label="快捷键" class="bd-help"><p class="bd-help-title">快捷键</p><dl>' + rows.map(([k, v]) => '<div><dt><kbd>' + esc(k) + '</kbd></dt><dd>' + esc(v) + '</dd></div>').join('') + '</dl></div>';
      }
      menu.innerHTML = h;
      menu.dataset.kind = kind;
      menu.hidden = false;
      const rb = root.getBoundingClientRect(), bb = btn.getBoundingClientRect();
      const mw = Math.min(menu.offsetWidth || 260, rb.width - 16);
      const left = clamp(bb.right - rb.left - mw, 8, rb.width - mw - 8);
      const top = bb.bottom - rb.top + 8;
      const below = top + (menu.offsetHeight || 200) < rb.height - 8;
      menu.style.left = left + 'px';
      menu.style.top = (below ? top : Math.max(8, bb.top - rb.top - (menu.offsetHeight || 200) - 8)) + 'px';
      root.querySelectorAll('[data-board-act="menu"]').forEach(b => b.setAttribute('aria-expanded', String(b === btn)));
      const first = menu.querySelector('button:not([disabled])');
      if (first && kind !== 'help') first.focus({ preventScroll: true });
    }
    function closeMenu() {
      if (menu.hidden) return;
      menu.hidden = true;
      menu.dataset.kind = '';
      root.querySelectorAll('[data-board-act="menu"]').forEach(b => b.setAttribute('aria-expanded', 'false'));
    }

    function onClick(e) {
      const btn = e.target.closest('[data-board-act]');
      if (!btn || !root.contains(btn) || btn.disabled || btn.getAttribute('aria-disabled') === 'true') {
        if (btn && btn.getAttribute('aria-disabled') === 'true') toast(btn.dataset.tip || '现在不能用');
        if (!e.target.closest('.bd-menu')) closeMenu();
        return;
      }
      const act = btn.dataset.boardAct;
      if (act !== 'menu' && !btn.closest('.bd-menu')) closeMenu();
      switch (act) {
        case 'tool': setTool(btn.dataset.tool); break;
        case 'panel': togglePanel(); break;
        case 'template': if (!btn._dragged) insertTemplate(btn.dataset.template); btn._dragged = false; break;
        case 'undo': undo(); break;
        case 'redo': redo(); break;
        case 'present': present(!presenting); break;
        case 'present-exit': present(false); break;
        case 'slide': goFrame(presenting ? presenting.index + Number(btn.dataset.dir) : 0); break;
        case 'menu': openMenu(btn, btn.dataset.menu); break;
        case 'export': closeMenu(); doExport(btn.dataset.format); break;
        case 'import': closeMenu(); fileJson.click(); break;
        case 'zoom-in': { userMoved(); zoomAt(1.25, vw / 2, vh / 2); break; }
        case 'zoom-out': { userMoved(); zoomAt(0.8, vw / 2, vh / 2); break; }
        case 'zoom-reset': { userMoved(); const c = toWorld(vw / 2, vh / 2); flyTo({ x: c.x - vw / 2, y: c.y - vh / 2, z: 1 }, theme.motion.enter); break; }
        case 'fit': userMoved(); fitAll(true); break;
        case 'color': applyColor(btn.dataset.color); break;
        case 'size': applySize(Number(btn.dataset.size)); break;
        case 'route': applyLine({ route: btn.dataset.route }); break;
        case 'arrowhead': { const ref = selected().find(o => o.kind === 'line') || toolStyle.line; applyLine({ arrow: ref.arrow === 'none' ? 'end' : 'none' }); break; }
        case 'dash': { const ref = selected().find(o => o.kind === 'line') || toolStyle.line; applyLine({ dash: !ref.dash }); break; }
        case 'align': closeMenu(); align(btn.dataset.mode); break;
        case 'group': group(!(btn.getAttribute('aria-pressed') === 'true')); break;
        case 'layer': layer(btn.dataset.dir); break;
        case 'duplicate': duplicate(); break;
        case 'delete': deleteSel(); break;
        case 'unfollow': lastFollow = following; following = null; schedule(F_UI); break;
        case 'refollow': follow(lastFollow); break;
        default: break;
      }
      schedule(F_UI | F_LIVE);
    }
    function doExport(fmt) {
      const name = '讲课白板-' + stamp();
      if (fmt === 'png') exportPNG(2).then(b => { download(b, name + '.png'); toast(b ? '已导出 PNG。' : '白板是空的，没有可导出的内容。'); });
      else if (fmt === 'svg') { download(new Blob([toSVG(doc.ordered())], { type: 'image/svg+xml' }), name + '.svg'); toast('已导出 SVG。'); }
      else if (fmt === 'json') { download(new Blob([JSON.stringify(exportJSON(), null, 2)], { type: 'application/json' }), name + '.json'); toast('已导出 JSON。'); }
    }

    // 组件面板：按住拖到画布；没拖动就当点击
    let tileDragEnd = null;
    disposers.push(() => { if (tileDragEnd) tileDragEnd(); });
    function onTileDown(e) {
      const tile = e.target.closest('.bd-tile');
      if (!tile || e.button !== 0 || !canEdit()) return;
      const id = tile.dataset.template;
      const start = { x: e.clientX, y: e.clientY };
      let ghost = null;
      const tpl = templateList().find(t => t.id === id);
      const move = ev => {
        if (!ghost && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 5) return;
        if (!ghost) {
          ghost = document.createElement('div');
          ghost.className = 'bd-ghost';
          ghost.setAttribute('aria-hidden', 'true');
          ghost.innerHTML = tile.querySelector('.bd-tile-thumb').innerHTML;
          document.body.appendChild(ghost);
          tile._dragged = true;
        }
        ghost.style.transform = 'translate3d(' + (ev.clientX + 12) + 'px,' + (ev.clientY + 12) + 'px,0)';
        const r = stage.getBoundingClientRect();
        const over = ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom && !panel.contains(document.elementFromPoint(ev.clientX, ev.clientY));
        ghost.classList.toggle('is-over', over);
        if (over && tpl) {
          let n = 0;
          const w = toWorld(ev.clientX - r.left, ev.clientY - r.top);
          const objs = instantiate(tpl, w.x, w.y, () => 'd' + (++n), null, 'center');
          gesture = { type: 'drop', box: unionBox(objs, o => (o.kind === 'line' ? null : o)) };
        } else if (gesture && gesture.type === 'drop') gesture = null;
        schedule(F_LIVE);
      };
      const up = ev => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
        tileDragEnd = null;
        if (gesture && gesture.type === 'drop') gesture = null;
        schedule(F_LIVE);
        if (!ghost) return;
        ghost.remove();
        const r = stage.getBoundingClientRect();
        const over = ev.type === 'pointerup' && ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom && !panel.contains(document.elementFromPoint(ev.clientX, ev.clientY));
        if (over) insertTemplate(id, toWorld(ev.clientX - r.left, ev.clientY - r.top));
        later(() => { tile._dragged = false; }, 0);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
      if (tileDragEnd) tileDragEnd();
      tileDragEnd = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); if (ghost) ghost.remove(); tileDragEnd = null; };
    }

    /* ----- 键盘 ----- */
    function active() {
      const a = document.activeElement;
      if (a && root.contains(a)) return a !== editor;
      return pointerInside && !isEditable(a);
    }
    function onKey(e) {
      if (destroyed || e.isComposing || !active()) return;
      if (isEditable(e.target) && e.target !== stage) return;
      const k = e.key;
      if (presenting) {
        if (k === 'ArrowRight' || k === 'PageDown' || k === ' ') { e.preventDefault(); goFrame(presenting.index + 1); return; }
        if (k === 'ArrowLeft' || k === 'PageUp') { e.preventDefault(); goFrame(presenting.index - 1); return; }
        if (k === 'Escape') { e.preventDefault(); present(false); return; }
      }
      if (mod(e)) {
        const c = e.code;
        let done = true;
        if (c === 'KeyZ') (e.shiftKey ? redo : undo)();
        else if (c === 'KeyY') redo();
        else if (c === 'KeyD') duplicate();
        else if (c === 'KeyA') selectAll();
        else if (c === 'KeyG') group(!e.shiftKey);
        else if (c === 'BracketRight') layer(e.shiftKey ? 'front' : 'forward');
        else if (c === 'BracketLeft') layer(e.shiftKey ? 'back' : 'backward');
        else if (c === 'Equal' || c === 'NumpadAdd') { userMoved(); zoomAt(1.25, vw / 2, vh / 2); }
        else if (c === 'Minus' || c === 'NumpadSubtract') { userMoved(); zoomAt(0.8, vw / 2, vh / 2); }
        else if (c === 'Digit0') { userMoved(); const ct = toWorld(vw / 2, vh / 2); flyTo({ x: ct.x - vw / 2, y: ct.y - vh / 2, z: 1 }, theme.motion.enter); }
        else done = false;
        if (done) e.preventDefault();
        return;
      }
      if (e.altKey) return;
      if (k === ' ') { if (!spaceDown) { spaceDown = true; schedule(F_UI); } e.preventDefault(); return; }
      if (k === 'Escape') {
        if (!menu.hidden) { closeMenu(); return; }
        if (gesture) { cancelGesture(); return; }
        if (selection.size) { select([]); return; }
        if (!panel.hidden) { togglePanel(false); return; }
        if (tool !== 'select' && canEdit()) setTool('select');
        return;
      }
      if (k === 'Delete' || k === 'Backspace') { if (selection.size) { e.preventDefault(); deleteSel(); } return; }
      if (k === 'Enter' && selection.size === 1) { const o = selected()[0]; if (TEXTUAL.has(o.kind)) { e.preventDefault(); startEdit(o, 'text', false); } else if (o.kind === 'frame') { e.preventDefault(); startEdit(o, 'name', false); } return; }
      if (k.startsWith('Arrow')) {
        if (!selection.size) return;
        e.preventDefault();
        const s = e.shiftKey ? 10 : 1;
        nudge(k === 'ArrowLeft' ? -s : k === 'ArrowRight' ? s : 0, k === 'ArrowUp' ? -s : k === 'ArrowDown' ? s : 0);
        return;
      }
      if (e.code === 'Digit1' && e.shiftKey) { e.preventDefault(); userMoved(); fitAll(true); return; }
      if (e.code === 'Digit2' && e.shiftKey && selection.size) { e.preventDefault(); userMoved(); const b = unionBox(selected(), o => boundsOf(o)); if (b) flyTo(camFor(b, insets(24), 2), theme.motion.stage); return; }
      if (e.code === 'KeyL') {
        e.preventDefault();
        if (e.repeat || !canLaser()) return;
        held = 'laser';
        held_at = now();
        schedule(F_UI);
        return;
      }
      const t = TOOL_BY_KEY[e.code];
      if (t && !e.shiftKey) { e.preventDefault(); setTool(t); }
    }
    let held_at = 0;
    function onKeyUp(e) {
      if (e.key === ' ' && spaceDown) { spaceDown = false; schedule(F_UI); }
      if (e.code === 'KeyL' && held === 'laser') {
        held = null;
        if (now() - held_at < 260 && canLaser()) tool = 'laser';
        if (gesture && gesture.type === 'laser') gesture = null;
        schedule(F_UI);
      }
    }
    function onWheel(e) {
      if (destroyed) return;
      e.preventDefault();
      closeMenu();
      const p = localPt(e);
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * vh : e.deltaY;
      const dx = e.deltaMode === 1 ? e.deltaX * 16 : e.deltaMode === 2 ? e.deltaX * vw : e.deltaX;
      const wheelLike = e.deltaMode !== 0 || (dx === 0 && Math.abs(dy) >= 40 && Math.abs(dy % 1) < 1e-6);
      userMoved();
      if (e.ctrlKey || e.metaKey || wheelLike) zoomAt(Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0015)), p.x, p.y);
      else setCam(cam.x + dx / cam.z, cam.y + dy / cam.z, cam.z);
    }
    function onDbl(e) {
      if (!canEdit()) return;
      const p = localPt(e);
      const w = toWorld(p.x, p.y);
      const o = hitTest(w);
      if (o) {
        if (o.kind === 'frame') { select([o.id]); startEdit(o, 'name', false); return; }
        if (TEXTUAL.has(o.kind)) { select([o.id]); startEdit(o, 'text', false); }
        return;
      }
      if (tool === 'select') createText(w);
    }
    function onCopy(e) {
      if (!active() || editing || !selection.size) return;
      const payload = clipPayload(expandSel());
      clip = payload.objects;
      pasteN = 0;
      try { e.clipboardData.setData('text/plain', JSON.stringify(payload)); e.preventDefault(); } catch (err) { /* 系统剪贴板不可用时用内部剪贴板 */ }
      if (e.type === 'cut') deleteSel();
      announce(e.type === 'cut' ? '已剪切' : '已复制 ' + payload.objects.length + ' 个对象');
    }
    function onPaste(e) {
      if (!active() || editing || !canEdit()) return;
      const dt = e.clipboardData;
      const file = dt && Array.from(dt.files || []).find(f => /^image\//.test(f.type));
      if (file) { e.preventDefault(); readImage(file); return; }
      const text = dt ? dt.getData('text/plain') : '';
      let parsed = null;
      if (text && text.charAt(0) === '{') { try { parsed = JSON.parse(text); } catch (err) { parsed = null; } }
      if (parsed && parsed.format === 'commons-board-clip' && Array.isArray(parsed.objects)) { e.preventDefault(); pasteN++; pasteObjects(parsed.objects, 24 * pasteN); return; }
      if (clip && (!text || text === JSON.stringify(clipPayload([])))) { e.preventDefault(); pasteN++; pasteObjects(clip, 24 * pasteN); return; }
      if (text && text.trim()) {
        e.preventDefault();
        const c = toWorld(vw / 2, vh / 2);
        const o = { id: newId(), kind: 'text', x: r1(c.x - 160), y: r1(c.y), w: 320, h: 22, text: text.slice(0, 2000), fs: 'item', color: toolStyle.text.color, z: topZ() };
        o.h = textHeight(o);
        begin(); addObj(o); commit(); select([o.id]);
      }
    }

    /* ----- 挂载 ----- */
    on(stage, 'pointerdown', onDown);
    on(stage, 'pointermove', onMove);
    on(stage, 'pointerup', onUp);
    on(stage, 'pointercancel', onUp);
    on(stage, 'pointerenter', () => { pointerInside = true; });
    on(stage, 'pointerleave', e => {
      pointerInside = false;
      if (hover) { hover = null; schedule(F_LIVE); }
      if (onOp && e.pointerType !== 'touch') { try { onOp({ type: 'cursor', actor, gone: true }); } catch (err) { console.error('board onOp failed', err); } }
    });
    on(stage, 'wheel', onWheel, { passive: false });
    on(stage, 'dblclick', onDbl);
    on(stage, 'contextmenu', e => e.preventDefault());
    on(stage, 'dragover', e => { if (canEdit() && e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) e.preventDefault(); });
    on(stage, 'drop', e => {
      const f = e.dataTransfer && Array.from(e.dataTransfer.files || [])[0];
      if (!f || !canEdit()) return;
      e.preventDefault();
      const p = localPt(e);
      readImage(f, toWorld(p.x, p.y));
    });
    on(root, 'click', onClick);
    on(panel, 'pointerdown', onTileDown);
    on(editor, 'input', () => placeEditor());
    on(editor, 'keydown', e => {
      e.stopPropagation();
      if (e.key === 'Escape' || (e.key === 'Enter' && mod(e))) { e.preventDefault(); endEdit(true); }
    });
    on(editor, 'blur', () => { if (editing) endEdit(true); });
    on(fileImage, 'change', () => { const f = fileImage.files && fileImage.files[0]; fileImage.value = ''; if (f) readImage(f); });
    on(fileJson, 'change', () => {
      const f = fileJson.files && fileJson.files[0];
      fileJson.value = '';
      if (!f) return;
      if (f.size > 20 * 1024 * 1024) { toast('文件超过 20MB，没有导入。'); return; }
      const fr = new FileReader();
      fr.onload = () => { try { importJSON(JSON.parse(String(fr.result || ''))); } catch (err) { toast('这个文件读不出来，画布没有改动。'); } };
      fr.readAsText(f);
    });
    on(document, 'keydown', onKey);
    on(document, 'keyup', onKeyUp);
    on(document, 'copy', onCopy);
    on(document, 'cut', onCopy);
    on(document, 'paste', onPaste);
    on(document, 'pointerdown', e => { if (!menu.hidden && !menu.contains(e.target) && !e.target.closest('[data-board-act="menu"]')) closeMenu(); });
    on(window, 'blur', () => { spaceDown = false; held = null; });
    if (mq) {
      const onMq = () => root.classList.toggle('is-reduced', reduced());
      if (mq.addEventListener) { mq.addEventListener('change', onMq); disposers.push(() => mq.removeEventListener('change', onMq)); }
      onMq();
    }
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => resize()) : null;
    if (ro) { ro.observe(stage); disposers.push(() => ro.disconnect()); } else on(window, 'resize', resize);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (!destroyed) { wrapCache.clear(); schedule(F_BASE | F_LIVE); } });

    resize();
    if (doc.size()) {
      const first = opts.initialFrame && root.classList.contains('is-narrow') ? frames()[0] : null;
      if (first) {
        const z = Math.max(0.4, camFor(first, insets(4), 1.4).z);
        setCam(first.x - 8 / z, first.y - 82 / z, z);
      } else fitAll(false);
    }
    else setCam(-vw / 2, -vh / 2, 1);
    syncGrid();
    if (onOp && role === 'host') later(() => sendView(true), 0);

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      timers.forEach(t => clearTimeout(t));
      timers.clear();
      disposers.splice(0).forEach(fn => { try { fn(); } catch (err) { /* 已解除 */ } });
      cursors.forEach(c => c.el.remove());
      cursors.clear();
      lasers.clear();
      root.remove();
      instances.delete(api);
    }

    const api = {
      actor,
      el: root,
      apply(op) {
        if (destroyed || !op || typeof op !== 'object') return false;
        if (op.type === 'cursor') { onCursor(op); return true; }
        if (op.type === 'view') { onView(op); return true; }
        if (op.type === 'laser') {
          const who = String(op.actor || '');
          if (who && who !== actor && Number.isFinite(op.x) && Number.isFinite(op.y)) addLaser(who, op.x, op.y, cursorColor(who));
          return true;
        }
        const changed = doc.apply(op);
        if (changed) {
          const id = op.target;
          if (!doc.get(id)) { selection.delete(id); if (editing && editing.id === id) { editing = null; editor.hidden = true; } if (hover === id) hover = null; }
          schedule(F_BASE | F_LIVE | F_UI);
        }
        return changed;
      },
      getDoc: () => doc.snapshot(true),
      setRole(r, o) {
        if (!['host', 'drawer', 'viewer'].includes(r)) return;
        role = r;
        if (o && typeof o.laser === 'boolean') laserOk = o.laser;
        if (!canEdit()) { cancelGesture(); endEdit(true); select([]); if (tool !== 'laser' || !canLaser()) tool = 'hand'; togglePanel(false); }
        else if (tool === 'hand' && r !== 'viewer') tool = 'select';
        schedule(F_BASE | F_LIVE | F_UI);
        if (r === 'host') sendView(true);
      },
      allowLaser(v) { laserOk = !!v; schedule(F_UI); },
      setReadOnly(v) { readOnly = !!v; api.setRole(role); },
      follow,
      following: () => following,
      broadcastView: () => sendView(true),
      present,
      goFrame: i => goFrame(i),
      frames: () => frames().map(f => ({ id: f.id, name: f.name || '', x: f.x, y: f.y, w: f.w, h: f.h })),
      fit: () => fitAll(true),
      setTool,
      select: ids => select(ids || []),
      insertTemplate,
      exportPNG,
      exportSVG: () => toSVG(doc.ordered()),
      exportJSON,
      importJSON,
      undo,
      redo,
      hash: () => doc.hash(),
      opCount: () => doc.count(),
      camera: () => ({ x: cam.x, y: cam.y, z: cam.z }),
      worldToClient(x, y) { const r = stage.getBoundingClientRect(); const s = toScreen(x, y); return { x: r.left + s.x, y: r.top + s.y }; },
      stats() {
        const n = Math.min(stats.frames, stats.costs.length);
        const arr = Array.from(stats.costs.slice(0, n)).sort((a, b) => a - b);
        const avg = n ? arr.reduce((s, v) => s + v, 0) / n : 0;
        return { objects: doc.size(), rafCalls: stats.rafCalls, frames: stats.frames, pending: !!raf, last: stats.last, avg, p95: n ? arr[Math.min(n - 1, Math.floor(n * 0.95))] : 0, max: stats.max };
      },
      resetStats() { stats.frames = 0; stats.ci = 0; stats.max = 0; stats.costs.fill(0); stats.rafCalls = 0; },
      flush,
      // 演示和测试钩子：按脚本画一笔（经 onOp 发出 add + update，证明 op 回放），以及冻结激光淡出以便截图
      drawScripted(points, style, step) {
        return new Promise(resolve => {
          if (!canEdit()) { resolve(null); return; }
          const id = newId();
          const st = style || {};
          let i = 0;
          const tick = () => {
            if (destroyed) { resolve(null); return; }
            i = Math.min(points.length, i + 9);
            const o = penFrom(id, points.slice(0, i), st.color || 'cat-6', st.size || 2, st.kind);
            if (!doc.get(id)) { o.z = topZ(); begin(); addObj(o); }
            else { begin(); updObj(id, { x: o.x, y: o.y, w: o.w, h: o.h, pw: o.pw, ph: o.ph, pts: o.pts }); }
            schedule(F_BASE);
            if (i < points.length) later(tick, step || 40);
            else { commit(); resolve(id); }
          };
          tick();
        });
      },
      freezeLaser(v) { freezeLaser = !!v; const t = now(); lasers.forEach(tr => { tr.frozen = t; }); schedule(F_LIVE); },
      destroy
    };
    instances.add(api);
    return api;
  }

  /* ---------- 演示页 #/board ---------- */

  /* ---------- 导出 ---------- */

  window.CommonsBoard = {
    version: 1,
    routes: { board: pageView },
    nav: [['board', '讲课白板', 'board', 'data']],
    icons: { board: ICON.board },
    // mount(container, opts) 挂一块白板并返回实例；不带参数时是 app.js 换页后的页面挂载
    mount(container, options) {
      if (container && container.nodeType === 1) return createBoard(container, options);
      pageMount();
      return null;
    },
    destroy() {
      pageDestroy();
      instances.forEach(inst => { if (!inst.el.isConnected) inst.destroy(); });
    },
    templates: () => templateList().map(t => ({ id: t.id, name: t.name, desc: t.desc })),
    // 演示页当前那块白板（调试和截图用；嵌入方拿 mount() 的返回值即可）
    current: () => demoModule && isDemo() ? demoModule.current() : null,
    pip: () => demoModule && isDemo() ? demoModule.pip() : null,
    lessonDoc
  };
  (window.CommonsPages = window.CommonsPages || []).push(window.CommonsBoard);
})();
