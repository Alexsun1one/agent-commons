(() => {
  'use strict';

  const RELS = ['similar', 'follows', 'answers', 'contradicts', 'same-tool'];
  const REL_LABEL = { similar: '相似', follows: '追问', answers: '解答', contradicts: '推翻', 'same-tool': '同工具' };
  const REL_VAR = { similar: '--slate-400', follows: '--info', answers: '--success', contradicts: '--danger', 'same-tool': '--violet-500' };
  const REL_REST = { similar: 0.3, follows: 0.3, answers: 0.34, contradicts: 0.4, 'same-tool': 0.16 };
  const DIRECTED = { follows: true, answers: true, contradicts: true };
  const KINDS = ['question', 'solution', 'pitfall', 'tool-review', 'resource', 'debate', 'work-lead'];
  const KIND_LABEL = { question: '问题', solution: '解法', pitfall: '踩坑', 'tool-review': '工具评测', resource: '资源', debate: '争论', 'work-lead': '作品线索' };
  const STATUS_LABEL = { candidate: '候选', curated: '已整理', verified: '已验证', stale: '过期', disputed: '有争议' };
  const STATUSES = ['candidate', 'curated', 'verified', 'disputed', 'stale'];
  const REL_DASH = { similar: [5, 3], follows: [], answers: [], contradicts: [7, 3, 1.5, 3], 'same-tool': [0.5, 3.4] };
  const VIEWS = [['network', '网络'], ['matrix', '矩阵'], ['list', '列表']];
  const SORTS = { title: '标题', cluster: '簇', kind: '类型', status: '状态', corroboration: '佐证', month: '首次出现', deg: '关系数', lastActive: '最近活动' };
  const W = 1500;
  const H = 680;
  const LAYOUTS = { wide: [W, H], square: [1250, 1100] };

  const api = () => window.Commons || {};
  const isLive = () => !!(window.CommonsAPI && window.CommonsAPI.mode === 'live');
  const esc = value => {
    const fn = api().esc;
    if (fn) return fn(String(value ?? ''));
    return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  };
  const icon = name => (api().icon ? api().icon(name) : '');
  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
  const lerp = (a, b, t) => a + (b - a) * t;
  const hash = str => {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return ((h >>> 0) % 100000) / 100000;
  };

  let model = null;
  let sourceRef = null;
  let state = null;
  let root = null;
  let canvas = null;
  let ctx = null;
  let wrap = null;
  let T = null;
  let cssW = 0;
  let cssH = 0;
  let dpr = 1;
  let portrait = false;
  let raf = 0;
  let cleanup = [];
  let liveToken = 0;
  let timers = [];
  let tweens = {};
  let cam = { x: W / 2, y: H / 2, k: 0.7 };
  let camFrom = null;
  let camTo = null;
  let kFit = 0.7;
  let zoomBox = [0, 0, 0, 0];
  let miniBox = null;
  let legendBox = null;
  let miniDrag = null;
  let narrow = false;
  let curFont = '';
  let miniSize = [0, 0];
  const widthCache = new Map();
  let hoverId = '';
  let hoverCluster = '';
  let hits = null;
  let litSel = [];
  let litHover = [];
  let reduced = false;
  let coarse = false;
  let endMode = false;
  let lastLeave = 0;
  let replayTimer = 0;
  let drag = null;
  let sheetDrag = null;
  let brushDrag = null;
  let searchTimer = 0;
  let activeResult = 0;

  /* ---------- 数据与布局 ---------- */

  function data() {
    if (isLive()) {
      sourceRef = null;
      model = null;
      return model;
    }
    const src = window.COMMONS_KNOWLEDGE;
    if (sourceRef === src && model) return model;
    sourceRef = src;
    if (!src || !Array.isArray(src.units) || !Array.isArray(src.clusters)) {
      model = null;
      return model;
    }
    const months = (Array.isArray(src.months) && src.months.length ? src.months : ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']).slice();
    const clusters = src.clusters.filter(c => c && typeof c.id === 'string').map((c, i) => ({
      id: c.id,
      label: String(c.label || c.id),
      x: clamp(Number(c.x) || 0.5, 0, 1),
      y: clamp(Number(c.y) || 0.5, 0, 1),
      cat: (i % 10) + 1,
      members: []
    }));
    const cmap = new Map(clusters.map(c => [c.id, c]));
    const units = src.units.filter(u => u && typeof u.id === 'string').map(u => ({
      id: u.id,
      kind: KIND_LABEL[u.kind] ? u.kind : 'question',
      title: String(u.title || ''),
      question: String(u.question || ''),
      context: String(u.context || ''),
      solution: String(u.solution || ''),
      steps: Array.isArray(u.steps) ? u.steps.map(String) : [],
      tools: Array.isArray(u.tools) ? u.tools.map(String) : [],
      outcome: String(u.outcome || ''),
      unresolved: String(u.unresolved || ''),
      status: STATUS_LABEL[u.status] ? u.status : 'candidate',
      confidence: Number(u.confidence) || 0,
      corroboration: Math.max(0, Number(u.corroboration) || 0),
      cluster: cmap.has(u.cluster) ? u.cluster : (clusters[0] && clusters[0].id) || '',
      xy: [clamp(Number(u.xy && u.xy[0]) || 0.5, 0, 1), clamp(Number(u.xy && u.xy[1]) || 0.5, 0, 1)],
      month: months.includes(u.month) ? u.month : months[0],
      contributors: Array.isArray(u.contributors) ? u.contributors.map(String) : [],
      links: Array.isArray(u.links) ? u.links.filter(l => l && l.to && RELS.includes(l.rel)).map(l => ({ to: String(l.to), rel: l.rel })) : [],
      method: u.method ? String(u.method) : '',
      fieldwork: u.fieldwork ? String(u.fieldwork) : '',
      asked30d: Math.max(0, Math.round(Number(u.asked30d) || 0)),
      lastActive: /^\d{4}-\d{2}-\d{2}$/.test(String(u.lastActive || '')) ? String(u.lastActive) : '',
      a: 0, af: 0, at: 0, sx: 0, sy: 0, sr: 0
    }));
    units.forEach(u => {
      u.mi = months.indexOf(u.month);
      if (!u.lastActive) u.lastActive = u.month + '-01';
      u.ansMi = Infinity;
      u.overMi = Infinity;
    });
    const byId = new Map(units.map(u => [u.id, u]));
    const edges = [];
    const seenEdge = new Set();
    const BEND = { similar: 0.14, follows: 0.24, answers: -0.2, contradicts: 0.3, 'same-tool': -0.11 };
    units.forEach(u => {
      u.links.forEach(l => {
        const b = byId.get(l.to);
        if (!b || b === u) return;
        const sym = l.rel === 'similar' || l.rel === 'same-tool';
        const key = sym ? [u.id, l.to].sort().join('|') + l.rel : u.id + '>' + l.to + l.rel;
        if (seenEdge.has(key)) return;
        seenEdge.add(key);
        const pair = [u.id, l.to].sort().join('|');
        const flip = (hash(pair) > 0.5 ? 1 : -1) * (u.id < l.to ? 1 : -1);
        edges.push({ from: u.id, to: l.to, rel: l.rel, a: u, b, bend: BEND[l.rel] * flip, mi: Math.max(u.mi, b.mi) });
      });
    });
    const neighbors = new Map(units.map(u => [u.id, []]));
    edges.forEach(e => {
      neighbors.get(e.from).push({ id: e.to, rel: e.rel, dir: 'out', edge: e });
      neighbors.get(e.to).push({ id: e.from, rel: e.rel, dir: 'in', edge: e });
    });
    edges.forEach(e => {
      if (e.rel === 'answers') {
        e.a.ansMi = Math.min(e.a.ansMi, e.mi);
        e.b.ansMi = Math.min(e.b.ansMi, e.mi);
      }
      if (e.rel === 'contradicts') e.b.overMi = Math.min(e.b.overMi, e.mi);
    });
    units.forEach(u => { u.deg = neighbors.get(u.id).length; });
    const unresolved = new Set(units.filter(u => u.kind === 'question' && u.ansMi === Infinity).map(u => u.id));
    units.forEach(u => {
      const c = cmap.get(u.cluster);
      if (c) c.members.push(u);
    });
    const relCount = {};
    RELS.forEach(r => { relCount[r] = edges.filter(e => e.rel === r).length; });
    const perMonth = months.map(mo => units.filter(u => u.month === mo).length);
    const perStatus = months.map((mo, i) => {
      const o = {};
      STATUSES.forEach(st => { o[st] = units.filter(u => u.mi === i && u.status === st).length; });
      return o;
    });
    model = {
      src, months, clusters, cmap, units, byId, edges, neighbors, unresolved, relCount, perMonth, perStatus,
      maxCorr: Math.max(2, ...units.map(u => u.corroboration)),
      maxAsked: Math.max(1, ...units.map(u => u.asked30d)),
      synthetic: src.synthetic === true,
      note: String(src.note || '合成示例，不是群聊真实内容。')
    };
    model.snaps = {};
    ['square', 'wide'].forEach(mode => {
      layout(model, mode);
      model.snaps[mode] = {
        u: units.map(u => [u.wx, u.wy]),
        c: clusters.map(c => [c.cx, c.cy, c.R]),
        e: edgeCtl(model),
        bounds: { ...model.bounds }
      };
    });
    model.edges.forEach((e, i) => { e.cwx = model.snaps.wide.e[i][0]; e.cwy = model.snaps.wide.e[i][1]; });
    model.layoutMode = 'wide';
    return model;
  }

  // 点的面积和佐证人数成正比：最少 1 人到最多的人数，半径差 2.5 倍。
  function radiusOf(c, maxC) {
    const lo = 5.5;
    return lo + lo * 1.5 * (Math.sqrt(Math.max(1, c)) - 1) / (Math.sqrt(Math.max(2, maxC)) - 1);
  }

  // 簇间的线画成柔和曲线，弯向不穿过别的簇中心的一侧。
  function edgeCtl(m) {
    return m.edges.map(e => {
      const a = e.a;
      const b = e.b;
      const dx = b.wx - a.wx;
      const dy = b.wy - a.wy;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      const mx = (a.wx + b.wx) / 2;
      const my = (a.wy + b.wy) / 2;
      const cross = a.cluster !== b.cluster;
      const base = cross ? Math.sign(e.bend || 1) * 0.2 : e.bend;
      const cands = cross ? [base, -base, base * 2, -base * 2, base * 0.45, -base * 0.45] : [base];
      let best = null;
      cands.forEach((bd, i) => {
        const off = Math.sign(bd) * Math.min(len * Math.abs(bd), 240);
        const cx = mx + nx * off;
        const cy = my + ny * off;
        let pen = i * 0.5;
        if (cross) {
          for (let k = 1; k < 10; k++) {
            const t = k / 10;
            const px = (1 - t) * (1 - t) * a.wx + 2 * (1 - t) * t * cx + t * t * b.wx;
            const py = (1 - t) * (1 - t) * a.wy + 2 * (1 - t) * t * cy + t * t * b.wy;
            m.clusters.forEach(c => {
              if (c.id === a.cluster || c.id === b.cluster) return;
              const d = Math.hypot(px - c.cx, py - c.cy);
              if (d < c.R * 0.8) pen += c.R * 0.8 - d;
            });
          }
        }
        if (!best || pen < best.pen) best = { pen, cx, cy };
      });
      return [best.cx, best.cy];
    });
  }

  function layout(m, mode) {
    const [AW, AH] = LAYOUTS[mode] || LAYOUTS.wide;
    m.clusters.forEach(c => {
      c.ax = c.x * AW + (hash(c.id + ':x') - 0.5) * 92;
      c.ay = c.y * AH + (hash(c.id + ':y') - 0.5) * 70;
    });
    m.units.forEach(u => {
      const c = m.cmap.get(u.cluster);
      u.cat = c ? c.cat : 1;
      u.r = radiusOf(u.corroboration, m.maxCorr);
      u.ix = (c ? c.ax : AW / 2) + (u.xy[0] - (c ? c.x : 0.5)) * 1300;
      u.iy = (c ? c.ay : AH / 2) + (u.xy[1] - (c ? c.y : 0.5)) * 1300;
      u.wx = u.ix;
      u.wy = u.iy;
    });
    const separate = (list, gap) => {
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const p = list[i];
          const q = list[j];
          let dx = q.wx - p.wx;
          let dy = q.wy - p.wy;
          let d = Math.hypot(dx, dy);
          const min = p.r + q.r + gap;
          if (d >= min) continue;
          if (d < 0.001) {
            const ang = (i * 2.39996 + j * 0.7);
            dx = Math.cos(ang);
            dy = Math.sin(ang);
            d = 1;
          }
          const push = (min - d) / 2;
          p.wx -= dx / d * push;
          p.wy -= dy / d * push;
          q.wx += dx / d * push;
          q.wy += dy / d * push;
        }
      }
    };
    m.clusters.forEach(c => {
      for (let it = 0; it < 140; it++) {
        separate(c.members, 11);
        c.members.forEach(u => {
          u.wx += (u.ix - u.wx) * 0.035;
          u.wy += (u.iy - u.wy) * 0.035;
        });
      }
      for (let it = 0; it < 40; it++) separate(c.members, 11);
    });
    const measure = c => {
      if (!c.members.length) {
        c.cx = c.ax;
        c.cy = c.ay;
        c.R = 34;
        return;
      }
      c.cx = c.members.reduce((s, u) => s + u.wx, 0) / c.members.length;
      c.cy = c.members.reduce((s, u) => s + u.wy, 0) / c.members.length;
      c.R = Math.max(...c.members.map(u => Math.hypot(u.wx - c.cx, u.wy - c.cy) + u.r)) + 18;
    };
    m.clusters.forEach(measure);
    for (let it = 0; it < 60; it++) {
      let moved = false;
      for (let i = 0; i < m.clusters.length; i++) {
        for (let j = i + 1; j < m.clusters.length; j++) {
          const a = m.clusters[i];
          const b = m.clusters[j];
          const dx = b.cx - a.cx;
          const dy = b.cy - a.cy;
          const d = Math.hypot(dx, dy) || 1;
          const need = a.R + b.R + 58;
          if (d >= need) continue;
          const push = (need - d) / 2;
          const ux = dx / d;
          const uy = dy / d;
          a.members.forEach(u => { u.wx -= ux * push; u.wy -= uy * push; });
          b.members.forEach(u => { u.wx += ux * push; u.wy += uy * push; });
          a.cx -= ux * push; a.cy -= uy * push;
          b.cx += ux * push; b.cy += uy * push;
          moved = true;
        }
      }
      if (!moved) break;
    }
    m.clusters.forEach(measure);
    m.clusters.forEach(c => { c.wob = hash(c.id + ':w') * Math.PI * 2; c.wob2 = 2 + Math.floor(hash(c.id + ':k') * 3); });
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    m.clusters.forEach(c => {
      minx = Math.min(minx, c.cx - c.R);
      maxx = Math.max(maxx, c.cx + c.R);
      miny = Math.min(miny, c.cy - c.R - 34);
      maxy = Math.max(maxy, c.cy + c.R + 34);
    });
    m.bounds = { minx, miny, maxx, maxy };
  }

  function useLayout(mode) {
    const snap = model.snaps && model.snaps[mode];
    if (!snap || model.layoutMode === mode) return;
    model.units.forEach((u, i) => { u.wx = snap.u[i][0]; u.wy = snap.u[i][1]; });
    model.clusters.forEach((c, i) => { c.cx = snap.c[i][0]; c.cy = snap.c[i][1]; c.R = snap.c[i][2]; });
    model.edges.forEach((e, i) => { e.cwx = snap.e[i][0]; e.cwy = snap.e[i][1]; });
    model.bounds = { ...snap.bounds };
    model.layoutMode = mode;
  }

  // 按画布比例挑能把全网放得最大的排法：横排、横排转置（竖屏）、方阵。
  function pickLayout(w, h) {
    const padX = Math.min(40, w * 0.06);
    const padY = Math.max(Math.min(36, h * 0.07), fitPadY());
    let best = null;
    [['wide', false, 1.04], ['wide', true, 1], ['square', false, 1]].forEach(([mode, tr, bias]) => {
      const b = model.snaps[mode].bounds;
      const bw = b.maxx - b.minx;
      const bh = b.maxy - b.miny;
      const k = Math.min((w - padX * 2) / (tr ? bh : bw), (h - padY * 2) / (tr ? bw : bh)) * bias;
      if (!best || k > best.k) best = { mode, tr, k };
    });
    useLayout(best.mode);
    portrait = best.tr;
  }

  /* ---------- 状态 ---------- */

  function boot(id) {
    const m = data();
    const last = m ? m.months.length - 1 : 0;
    const compact = isSheet();
    state = {
      range: [0, last],
      view: compact ? 'list' : 'network',
      facet: null,
      sort: { key: 'corroboration', dir: -1 },
      legend: false,
      unresolved: false,
      rel: '',
      query: '',
      selected: '',
      cluster: '',
      unknown: '',
      sheet: compact ? 'open' : 'peek',
      playing: false
    };
    if (id && m && m.byId.has(id)) state.selected = id;
    else if (id) state.unknown = String(id);
    if (id) state.sheet = 'open';
  }

  function baseVisible(u) {
    if (u.mi < state.range[0] || u.mi > state.range[1]) return false;
    if (state.unresolved && !isOpenAt(u, state.range[1])) return false;
    if (state.facet && (u.cluster !== state.facet.cluster || u.status !== state.facet.status)) return false;
    return true;
  }

  // 到第 mi 个月月底，这个问题还没有任何解答线连上。
  function isOpenAt(u, mi) {
    return u.kind === 'question' && u.mi <= mi && u.ansMi > mi;
  }

  function isFullRange() {
    return state.range[0] === 0 && state.range[1] === model.months.length - 1;
  }

  function rangeText() {
    const a = model.months[state.range[0]];
    const b = model.months[state.range[1]];
    return a === b ? a : a + ' – ' + b.slice(a.slice(0, 4) === b.slice(0, 4) ? 5 : 0);
  }

  // 指标条：到第 mi 个月月底的口径，和上个月月底比。
  function metricsAt(mi) {
    const us = model.units.filter(u => u.mi <= mi);
    const verified = us.filter(u => u.status === 'verified').length;
    return {
      units: us.length,
      edges: model.edges.filter(e => e.mi <= mi).length,
      open: us.filter(u => isOpenAt(u, mi)).length,
      fresh: model.units.filter(u => u.mi === mi).length,
      verified: us.length ? verified / us.length : 0
    };
  }

  function relatedSet(id) {
    const keys = new Set();
    if (!id) return keys;
    keys.add(id);
    (model.neighbors.get(id) || []).forEach(n => {
      if (!state.rel || n.rel === state.rel) keys.add(n.id);
    });
    return keys;
  }

  function hayOf(u) {
    if (!u.hay) {
      const c = model.cmap.get(u.cluster);
      u.hay = [u.title, u.question, u.context, u.solution, u.tools.join(' '), c && c.label].join(' ').toLocaleLowerCase();
    }
    return u.hay;
  }

  function scoreOf(u, q) {
    const text = hayOf(u);
    const title = u.title.toLocaleLowerCase();
    let score = 0;
    if (title.includes(q)) score += 12;
    if (text.includes(q)) score += 6;
    const parts = q.split(/[\s,，、。？?！!]+/).filter(p => p.length >= 2);
    if (parts.length > 1 && parts.every(p => text.includes(p))) score += 5;
    const grams = [];
    const flat = q.replace(/[\s,，、。？?！!]+/g, '');
    for (let i = 0; i < flat.length - 1; i++) grams.push(flat.slice(i, i + 2));
    if (grams.length) {
      const hit = grams.filter(g => text.includes(g)).length;
      const ratio = hit / grams.length;
      if (ratio >= 0.5) score += ratio * 6 + grams.filter(g => title.includes(g)).length;
    } else if (flat.length === 1 && text.includes(flat)) score += 2;
    if (!score) return 0;
    return score + u.corroboration * 0.15 + (u.kind === 'question' ? 0.4 : 0);
  }

  function computeHits() {
    const q = state.query.trim().toLocaleLowerCase();
    if (!q) {
      hits = null;
      return;
    }
    hits = model.units
      .filter(baseVisible)
      .map(u => ({ u, s: scoreOf(u, q) }))
      .filter(x => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .map(x => x.u);
  }

  function nearestCluster(q) {
    const query = String(q || '').trim();
    let best = model.clusters[0] || null;
    let score = -1;
    model.clusters.forEach(c => {
      let s = 0;
      for (const ch of query) if (c.label.includes(ch)) s += 1;
      c.members.forEach(u => {
        for (const ch of query) if (u.title.includes(ch)) s += 0.08;
      });
      if (s > score) {
        score = s;
        best = c;
      }
    });
    return best;
  }

  /* ---------- 令牌（运行时读 CSS 变量） ---------- */

  function readTokens() {
    const cs = getComputedStyle(root);
    const probe = document.createElement('i');
    probe.className = 'knet-probe';
    root.appendChild(probe);
    const rgb = name => {
      probe.style.color = 'var(' + name + ')';
      const m = (getComputedStyle(probe).color.match(/[\d.]+/g) || ['0', '0', '0']).map(Number);
      return [m[0], m[1], m[2]];
    };
    const ms = name => {
      const v = cs.getPropertyValue(name).trim();
      const n = parseFloat(v);
      if (!Number.isFinite(n)) return 240;
      return /ms$/.test(v) ? n : n * 1000;
    };
    const t = {
      surface: rgb('--surface'),
      paper: rgb('--paper'),
      ink: rgb('--ink'),
      ink2: rgb('--ink-2'),
      muted: rgb('--muted'),
      faint: rgb('--faint'),
      grid: rgb('--slate-200'),
      line: rgb('--line-strong'),
      edge: rgb('--slate-500'),
      accent: rgb('--accent'),
      danger: rgb('--danger'),
      notice: rgb('--notice'),
      sans: cs.getPropertyValue('--sans').trim() || 'sans-serif',
      mono: cs.getPropertyValue('--mono').trim() || 'monospace',
      fast: ms('--motion-fast'),
      base: ms('--motion-base'),
      enter: ms('--motion-enter'),
      layout: ms('--motion-layout'),
      stage: ms('--motion-stage'),
      exit: ms('--motion-exit'),
      stagger: ms('--stagger'),
      easeOut: bezierOf(cs.getPropertyValue('--ease-out'), [0.23, 1, 0.32, 1]),
      easeInOut: bezierOf(cs.getPropertyValue('--ease-in-out'), [0.65, 0, 0.35, 1]),
      easeOutCss: cs.getPropertyValue('--ease-out').trim() || 'ease-out',
      rel: {},
      cats: []
    };
    RELS.forEach(r => { t.rel[r] = rgb(REL_VAR[r]); });
    for (let i = 1; i <= 10; i++) {
      const c = rgb('--cat-' + i);
      t.cats.push({
        base: col(c),
        tint: col(mix(c, t.surface, 0.9)),
        hull: col(mix(c, t.surface, 0.955)),
        hullHot: col(mix(c, t.surface, 0.9)),
        rim: col(mix(c, t.surface, 0.76)),
        edge: col(mix(c, t.surface, 0.72)),
        light: col(mix(c, t.surface, 0.74)),
        halo: col(mix(c, t.surface, 0.8)),
        glow: col(c, 0.55),
        mid: col(mix(c, t.ink, 0.22)),
        deep: col(mix(c, t.ink, 0.52)),
        label: col(mix(c, t.ink, 0.42))
      });
    }
    probe.remove();
    return t;
  }

  function mix(a, b, t) {
    return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  }

  function col(c, alpha) {
    const a = alpha === undefined ? 1 : alpha;
    return 'rgba' + '(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ',' + a + ')';
  }

  function bezierOf(raw, fallback) {
    const nums = String(raw || '').match(/-?[\d.]+/g);
    const p = /cubic-bezier/.test(raw || '') && nums && nums.length >= 4 ? nums.slice(0, 4).map(Number) : fallback;
    const [x1, y1, x2, y2] = p;
    const bx = t => 3 * x1 * t * (1 - t) * (1 - t) + 3 * x2 * t * t * (1 - t) + t * t * t;
    const by = t => 3 * y1 * t * (1 - t) * (1 - t) + 3 * y2 * t * t * (1 - t) + t * t * t;
    return x => {
      if (x <= 0) return 0;
      if (x >= 1) return 1;
      let lo = 0;
      let hi = 1;
      let t = x;
      for (let i = 0; i < 18; i++) {
        const v = bx(t);
        if (Math.abs(v - x) < 1e-4) break;
        if (v < x) lo = t;
        else hi = t;
        t = (lo + hi) / 2;
      }
      return by(t);
    };
  }

  /* ---------- 动画：只在交互时跑 ---------- */

  function startTween(name, dur) {
    if (endMode || dur <= 0 || (reduced && (name === 'flowSel' || name === 'flowHover' || name === 'cam'))) {
      delete tweens[name];
      kick();
      return;
    }
    tweens[name] = { t0: performance.now(), dur };
    kick();
  }

  function progress(name, now) {
    const t = tweens[name];
    if (!t) return 1;
    return clamp((now - t.t0) / t.dur, 0, 1);
  }

  function kick() {
    if (raf || !ctx) return;
    raf = requestAnimationFrame(frame);
  }

  function frame(now) {
    raf = 0;
    if (!ctx) return;
    const busy = step(now);
    draw(now);
    if (busy) kick();
  }

  function step(now) {
    let busy = false;
    if (tweens.cam && camFrom && camTo) {
      const p = progress('cam', now);
      const e = T.easeInOut(p);
      cam = {
        x: lerp(camFrom.x, camTo.x, e),
        y: lerp(camFrom.y, camTo.y, e),
        k: camFrom.k * Math.pow(camTo.k / camFrom.k, e)
      };
      if (p >= 1) {
        delete tweens.cam;
        syncPanMode();
      } else busy = true;
    }
    const dp = progress('dim', now);
    const de = T.easeOut(dp);
    model.units.forEach(u => { u.a = lerp(u.af, u.at, de); u.grow = u.af === 0 && u.at > 0 ? de : 1; });
    if (dp >= 1) delete tweens.dim;
    else busy = true;
    ['flowSel', 'flowHover'].forEach(name => {
      if (tweens[name]) {
        if (progress(name, now) >= 1) delete tweens[name];
        else busy = true;
      }
    });
    if (tweens.stat) {
      const p = progress('stat', now);
      const el = root && root.querySelector('#knet-stat-num');
      if (el) el.textContent = String(Math.round(model.units.length * T.easeOut(p)));
      if (p >= 1) delete tweens.stat;
      else busy = true;
    }
    return busy;
  }

  /* ---------- 镜头 ---------- */

  function view(wx, wy) {
    return portrait ? [wy, wx] : [wx, wy];
  }

  function toScreen(wx, wy) {
    const v = view(wx, wy);
    return [(v[0] - cam.x) * cam.k + cssW / 2, (v[1] - cam.y) * cam.k + cssH / 2];
  }

  function toView(sx, sy) {
    return [(sx - cssW / 2) / cam.k + cam.x, (sy - cssH / 2) / cam.k + cam.y];
  }

  function viewBox(minx, miny, maxx, maxy) {
    const a = view(minx, miny);
    const b = view(maxx, maxy);
    return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
  }

  function frameTarget(box, maxK, minPadY) {
    const padX = Math.min(40, cssW * 0.06);
    const padY = Math.max(Math.min(36, cssH * 0.07), minPadY || 0);
    const bw = Math.max(1, box[2] - box[0]);
    const bh = Math.max(1, box[3] - box[1]);
    const k = Math.min((cssW - padX * 2) / bw, (cssH - padY * 2) / bh, maxK || Infinity);
    return { x: (box[0] + box[2]) / 2, y: (box[1] + box[3]) / 2, k: Math.max(k, kFit * 0.9) };
  }

  // 手机全图时上下多留出两行簇名的高度（世界坐标里的留白缩到屏幕上不够）。
  function fitPadY() {
    return narrow ? 40 : 0;
  }

  function fitTarget() {
    const b = model.bounds;
    return frameTarget(viewBox(b.minx, b.miny, b.maxx, b.maxy), 0, fitPadY());
  }

  function unitsBox(list, pad) {
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    list.forEach(u => {
      minx = Math.min(minx, u.wx - u.r - pad);
      maxx = Math.max(maxx, u.wx + u.r + pad);
      miny = Math.min(miny, u.wy - u.r - pad);
      maxy = Math.max(maxy, u.wy + u.r + pad);
    });
    return viewBox(minx, miny, maxx, maxy);
  }

  function selectTarget(id) {
    const u = model.byId.get(id);
    if (!u) return fitTarget();
    const rel = [...relatedSet(id)].map(k => model.byId.get(k)).filter(x => x && baseVisible(x));
    let t = frameTarget(unitsBox(rel.length ? rel : [u], 40), kFit * 2.3);
    // 关系点散在好几簇、框起来几乎等于全图时，只框本簇里的邻居，别让选中的点缩在角落
    if (t.k < kFit * 1.3) {
      const near = rel.filter(x => x.cluster === u.cluster);
      if (!near.includes(u)) near.push(u);
      t = frameTarget(unitsBox(near, 40), kFit * 2.3);
    }
    const v = view(u.wx, u.wy);
    t.x = lerp(t.x, v[0], 0.35);
    t.y = lerp(t.y, v[1], 0.35);
    return t;
  }

  function clusterTarget(id) {
    const c = model.cmap.get(id);
    if (!c) return fitTarget();
    return frameTarget(viewBox(c.cx - c.R, c.cy - c.R - 30, c.cx + c.R, c.cy + c.R + 30), kFit * 3.2);
  }

  function currentTarget() {
    if (state.selected && model.byId.has(state.selected)) return selectTarget(state.selected);
    if (state.cluster) return clusterTarget(state.cluster);
    if (hits && hits.length) return frameTarget(unitsBox(hits, 50), kFit * 2.2);
    if (state.facet) {
      const us = model.units.filter(baseVisible);
      if (us.length) return frameTarget(unitsBox(us, 60), kFit * 2.4);
    }
    return fitTarget();
  }

  function flyTo(target) {
    if (!target) return;
    if (endMode || reduced || !cssW) {
      cam = { ...target };
      delete tweens.cam;
      syncPanMode();
      kick();
      return;
    }
    camFrom = { ...cam };
    camTo = { ...target };
    startTween('cam', T.stage);
  }

  function zoomBy(f, sx, sy) {
    const px = sx === undefined ? cssW / 2 : sx;
    const py = sy === undefined ? cssH / 2 : sy;
    const before = toView(px, py);
    const k = clamp(cam.k * f, kFit * 0.8, Math.max(kFit * 4.5, 3));
    delete tweens.cam;
    cam = { x: before[0] - (px - cssW / 2) / k, y: before[1] - (py - cssH / 2) / k, k };
    clampCam();
    syncPanMode();
    kick();
  }

  function clampCam() {
    const b = model.bounds;
    const vb = viewBox(b.minx, b.miny, b.maxx, b.maxy);
    cam.x = clamp(cam.x, vb[0], vb[2]);
    cam.y = clamp(cam.y, vb[1], vb[3]);
  }

  function syncPanMode() {
    if (!wrap) return;
    const z = cam.k > kFit * 1.15;
    if (z === wrap.hasAttribute('data-zoomed')) return;
    wrap.toggleAttribute('data-zoomed', z);
    if (narrow) measureCorners();
  }

  /* ---------- 画布 ---------- */

  // 角落里的控件（缩放、小地图、图例）量出实际位置，作为标签的避让区。
  function measureCorners() {
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const fitHidden = narrow && !wrap.hasAttribute('data-zoomed');
    const box = (sel, onlyZoomed) => {
      const el = wrap.querySelector(sel);
      if (!el || el.hidden || !el.offsetWidth || (onlyZoomed && fitHidden)) return null;
      const z = el.getBoundingClientRect();
      return [z.left - rect.left - 6, z.top - rect.top - 6, z.right - rect.left + 6, z.bottom - rect.top + 6];
    };
    const mc = wrap.querySelector('#knet-mini');
    miniSize = mc ? [mc.clientWidth, mc.clientHeight] : [0, 0];
    zoomBox = box('.knet-zoom', true) || [0, 0, 0, 0];
    miniBox = box('.knet-minimap', true);
    legendBox = box('.knet-legend');
  }

  function sizeCanvas() {
    if (!canvas || !wrap) return false;
    const rect = wrap.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    const w = Math.round(rect.width);
    const h = Math.round(rect.height);
    const nextDpr = Math.min(window.devicePixelRatio || 1, 3);
    const changed = w !== cssW || h !== cssH || nextDpr !== dpr;
    if (!changed) return false;
    dpr = nextDpr;
    cssW = w;
    cssH = h;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    narrow = isSheet();
    pickLayout(w, h);
    measureCorners();
    const b = model.bounds;
    const vb = viewBox(b.minx, b.miny, b.maxx, b.maxy);
    const padX = Math.min(40, cssW * 0.06);
    const padY = Math.max(Math.min(36, cssH * 0.07), fitPadY());
    kFit = Math.min((cssW - padX * 2) / (vb[2] - vb[0]), (cssH - padY * 2) / (vb[3] - vb[1]));
    return true;
  }

  // 簇的轮廓：成员点外扩一圈后的凸包，圆角收边。
  function hull(c, members) {
    const key = members.length + ':' + members.map(u => u.id + (u.grow === undefined ? '' : u.grow.toFixed(2))).join(',') + ':' + model.layoutMode;
    if (c.hullKey !== key) {
      c.hullKey = key;
      c.hullW = hullWorld(c, members);
    }
    return c.hullW.map(p => toScreen(p[0], p[1]));
  }

  function hullWorld(c, members) {
    const pts = [];
    if (!members.length) {
      for (let k = 0; k < 16; k++) {
        const ang = k / 16 * Math.PI * 2;
        pts.push([c.cx + Math.cos(ang) * 34, c.cy + Math.sin(ang) * 34]);
      }
    } else {
      members.forEach(u => {
        const g = u.grow === undefined ? 1 : u.grow;
        const rr = u.r * g + 14;
        for (let k = 0; k < 8; k++) {
          const ang = k / 8 * Math.PI * 2;
          pts.push([u.wx + Math.cos(ang) * rr, u.wy + Math.sin(ang) * rr]);
        }
      });
    }
    pts.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower = [];
    pts.forEach(p => {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
      lower.push(p);
    });
    const upper = [];
    for (let i = pts.length - 1; i >= 0; i--) {
      const p = pts[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
      upper.push(p);
    }
    return lower.slice(0, -1).concat(upper.slice(0, -1));
  }

  function blobPath(pts) {
    const n = pts.length;
    ctx.beginPath();
    const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const start = mid(pts[n - 1], pts[0]);
    ctx.moveTo(start[0], start[1]);
    for (let k = 0; k < n; k++) {
      const p = pts[k];
      const q = mid(p, pts[(k + 1) % n]);
      ctx.quadraticCurveTo(p[0], p[1], q[0], q[1]);
    }
    ctx.closePath();
  }

  function shapePath(kind, x, y, r) {
    ctx.beginPath();
    if (kind === 'solution') {
      const s = r * 0.86;
      if (ctx.roundRect) ctx.roundRect(x - s, y - s, s * 2, s * 2, r * 0.3);
      else ctx.rect(x - s, y - s, s * 2, s * 2);
    } else if (kind === 'pitfall') {
      const s = r * 1.14;
      ctx.moveTo(x, y - s);
      ctx.lineTo(x + s, y);
      ctx.lineTo(x, y + s);
      ctx.lineTo(x - s, y);
      ctx.closePath();
    } else if (kind === 'tool-review') {
      for (let i = 0; i < 6; i++) {
        const a = i * Math.PI / 3;
        const px = x + Math.cos(a) * r * 1.04;
        const py = y + Math.sin(a) * r * 1.04;
        if (i) ctx.lineTo(px, py);
        else ctx.moveTo(px, py);
      }
      ctx.closePath();
    } else if (kind === 'resource') {
      const w = r * 1.16;
      const h = r * 0.64;
      if (ctx.roundRect) ctx.roundRect(x - w, y - h, w * 2, h * 2, h);
      else ctx.rect(x - w, y - h, w * 2, h * 2);
    } else if (kind === 'debate') {
      const s = r * 1.2;
      ctx.moveTo(x, y - s);
      ctx.lineTo(x + s * 0.92, y + s * 0.6);
      ctx.lineTo(x - s * 0.92, y + s * 0.6);
      ctx.closePath();
    } else if (kind === 'work-lead') {
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + i * Math.PI / 5;
        const rr = i % 2 ? r * 0.62 : r * 1.16;
        const px = x + Math.cos(a) * rr;
        const py = y + Math.sin(a) * rr;
        if (i) ctx.lineTo(px, py);
        else ctx.moveTo(px, py);
      }
      ctx.closePath();
    } else {
      ctx.arc(x, y, r, 0, Math.PI * 2);
    }
  }

  function quad(e) {
    const a = e.a;
    const b = e.b;
    const x1 = a.sx;
    const y1 = a.sy;
    const x2 = b.sx;
    const y2 = b.sy;
    const c = toScreen(e.cwx, e.cwy);
    const cx = c[0];
    const cy = c[1];
    const len = Math.hypot(x2 - x1, y2 - y1) || 1;
    const t1 = Math.hypot(cx - x1, cy - y1) || 1;
    const t2 = Math.hypot(x2 - cx, y2 - cy) || 1;
    const ra = Math.min(a.sr + 2, len * 0.3);
    const rb = Math.min(b.sr + 3, len * 0.3);
    return {
      x1: x1 + (cx - x1) / t1 * ra,
      y1: y1 + (cy - y1) / t1 * ra,
      cx,
      cy,
      x2: x2 - (x2 - cx) / t2 * rb,
      y2: y2 - (y2 - cy) / t2 * rb
    };
  }

  function drawLit(e, p, width, alpha) {
    const g = quad(e);
    const c = T.rel[e.rel];
    const q1x = lerp(g.x1, g.cx, p);
    const q1y = lerp(g.y1, g.cy, p);
    const hx = (1 - p) * (1 - p) * g.x1 + 2 * (1 - p) * p * g.cx + p * p * g.x2;
    const hy = (1 - p) * (1 - p) * g.y1 + 2 * (1 - p) * p * g.cy + p * p * g.y2;
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = col(c);
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.setLineDash(REL_DASH[e.rel]);
    ctx.beginPath();
    ctx.moveTo(g.x1, g.y1);
    ctx.quadraticCurveTo(q1x, q1y, hx, hy);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineCap = 'butt';
    if (p < 1) {
      ctx.fillStyle = col(c);
      ctx.beginPath();
      ctx.arc(hx, hy, width + 1.2, 0, Math.PI * 2);
      ctx.fill();
    } else if (DIRECTED[e.rel]) {
      const ang = Math.atan2(g.y2 - g.cy, g.x2 - g.cx);
      const s = 4 + width * 1.3;
      ctx.fillStyle = col(c);
      ctx.beginPath();
      ctx.moveTo(g.x2, g.y2);
      ctx.lineTo(g.x2 - Math.cos(ang - 0.42) * s, g.y2 - Math.sin(ang - 0.42) * s);
      ctx.lineTo(g.x2 - Math.cos(ang + 0.42) * s, g.y2 - Math.sin(ang + 0.42) * s);
      ctx.closePath();
      ctx.fill();
    }
  }

  // 点：形状只表示类型，描边粗细统一；没人接住的问题画成空心。
  function fillStroke(u, cat, x, y, r, hollow) {
    shapePath(u.kind, x, y, r);
    ctx.fillStyle = hollow ? col(T.surface) : cat.base;
    ctx.fill();
    ctx.lineWidth = 1.25;
    ctx.strokeStyle = hollow ? cat.base : cat.mid;
    ctx.stroke();
  }

  // 外圈表示状态：已验证实线细环，候选虚线环，有争议双环；过期整点降透明度。
  function statusRing(u, cat, x, y, r) {
    const st = u.status;
    if (st !== 'verified' && st !== 'candidate' && st !== 'disputed') return r;
    const ring = (rr, color, dash) => {
      ctx.beginPath();
      ctx.arc(x, y, rr, 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.setLineDash(dash);
      ctx.stroke();
      ctx.setLineDash([]);
    };
    const r1 = r + 2.6;
    if (st === 'verified') ring(r1, cat.deep, []);
    else if (st === 'candidate') ring(r1, cat.base, [3.2, 2.6]);
    else {
      ring(r1, col(T.notice), []);
      ring(r1 + 2.4, col(T.notice), []);
      return r1 + 2.4;
    }
    return r1;
  }

  // 热度：近 30 天被问的次数，画成点外侧的一段弧，不用颜色。
  function heatArc(u, x, y, r, overview) {
    if (u.asked30d < (overview ? 8 : 3)) return;
    const span = Math.min(1, u.asked30d / model.maxAsked) * Math.PI * 1.8;
    ctx.beginPath();
    ctx.arc(x, y, r + 2.8, -Math.PI / 2, -Math.PI / 2 + Math.max(0.35, span));
    ctx.strokeStyle = col(T.ink2);
    ctx.lineWidth = 1.6;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.lineCap = 'butt';
  }

  function textHalo(text, x, y) {
    ctx.strokeText(text, x, y);
    ctx.fillText(text, x, y);
  }

  // 字体只在变了时才设；同一字体同一段字的宽度只量一次
  function setFont(f) {
    if (f !== curFont) {
      ctx.font = f;
      curFont = f;
    }
  }

  function textW(f, text) {
    const key = f + '|' + text;
    let w = widthCache.get(key);
    if (w === undefined) {
      setFont(f);
      w = ctx.measureText(text).width;
      if (widthCache.size > 4000) widthCache.clear();
      widthCache.set(key, w);
    }
    return w;
  }

  function wrapLabel(text, maxW) {
    if (textW(curFont, text) <= maxW || text.length < 6) return [text];
    const midIdx = Math.round(text.length / 2);
    let cut = -1;
    let bestD = Infinity;
    for (let i = 2; i < text.length - 2; i++) {
      if (/[\s、，/]/.test(text[i])) {
        const d = Math.abs(i - midIdx);
        if (d < bestD) { bestD = d; cut = i; }
      }
    }
    if (cut < 0) cut = midIdx;
    return [text.slice(0, cut).trim(), text.slice(cut).replace(/^[\s、，]+/, '').trim()];
  }

  function shortTitle(u, max) {
    const t = u.title;
    return t.length > max ? t.slice(0, max - 1) + '…' : t;
  }

  function draw(now) {
    if (!ctx || !model || !T || state.view !== 'network') return;
    const t0 = performance.now();
    const time = now || t0;
    // 尺寸变化交给 ResizeObserver；这里只兜底第一次，免得每帧读布局
    if (!cssW && sizeCanvas()) {
      delete tweens.cam;
      cam = currentTarget();
      syncPanMode();
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    curFont = '';
    ctx.globalAlpha = 1;
    ctx.fillStyle = col(T.surface);
    ctx.fillRect(0, 0, cssW, cssH);

    const gap = 40 * cam.k;
    if (gap >= 18) {
      const tl = toView(0, 0);
      const startX = Math.floor(tl[0] / 40) * 40;
      const startY = Math.floor(tl[1] / 40) * 40;
      ctx.fillStyle = col(T.grid);
      for (let vx = startX; (vx - cam.x) * cam.k + cssW / 2 < cssW; vx += 40) {
        const sx = (vx - cam.x) * cam.k + cssW / 2;
        for (let vy = startY; (vy - cam.y) * cam.k + cssH / 2 < cssH; vy += 40) {
          const sy = (vy - cam.y) * cam.k + cssH / 2;
          ctx.fillRect(sx - 0.6, sy - 0.6, 1.2, 1.2);
        }
      }
    }

    const units = model.units;
    const zoomRatio = cam.k / kFit;
    const endMi = state.range[1];
    units.forEach(u => {
      const p = toScreen(u.wx, u.wy);
      u.sx = p[0];
      u.sy = p[1];
      const g = reduced ? 1 : 0.55 + 0.45 * (u.grow === undefined ? 1 : u.grow);
      u.sr = Math.max(2.6, u.r * cam.k) * g;
    });

    const focusOn = !!(state.selected || hits || state.cluster || hoverId || state.rel);
    const labelFont = 600;
    const labelSize = clamp(Math.round(11 + Math.min(2, (zoomRatio - 1) * 1.5) + (cssW > 600 ? 1 : 0)), 11, 14);
    const clusterLabels = [];
    model.clusters.forEach(c => {
      const members = c.members.filter(u => u.a > 0.01);
      const pts = hull(c, members);
      c.pts = pts;
      const amax = members.reduce((s, u) => Math.max(s, u.a), 0);
      const dimmed = state.cluster && state.cluster !== c.id;
      let alpha = members.length ? 0.35 + 0.65 * amax : 0.55;
      if (dimmed) alpha *= 0.5;
      const cat = T.cats[c.cat - 1];
      const hot = hoverCluster === c.id || state.cluster === c.id || (state.facet && state.facet.cluster === c.id);
      ctx.globalAlpha = alpha;
      blobPath(pts);
      ctx.fillStyle = hot ? cat.hullHot : cat.hull;
      ctx.fill();
      ctx.strokeStyle = cat.rim;
      ctx.lineWidth = 1;
      ctx.setLineDash(members.length ? [] : [3, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
      let minY = Infinity, maxY = -Infinity, minX = Infinity, maxX = -Infinity;
      pts.forEach(p => {
        minY = Math.min(minY, p[1]);
        maxY = Math.max(maxY, p[1]);
        minX = Math.min(minX, p[0]);
        maxX = Math.max(maxX, p[0]);
      });
      c.sbox = [minX, minY, maxX, maxY];
      const vc = view(c.cx, c.cy);
      const b = model.bounds;
      const vb = viewBox(b.minx, b.miny, b.maxx, b.maxy);
      const below = vc[1] > (vb[1] + vb[3]) / 2 + (vb[3] - vb[1]) * 0.12;
      const onScreen = maxX > 24 && minX < cssW - 24 && maxY > 12 && minY < cssH - 12 && (minX + maxX) / 2 > -40 && (minX + maxX) / 2 < cssW + 40;
      if (onScreen) clusterLabels.push({ c, below, alpha: members.length ? Math.max(alpha, 0.55) : 0.5, x: (minX + maxX) / 2, top: minY, bottom: maxY, width: maxX - minX, n: members.length });
    });

    // 关系线：平时一律 1px 中性灰，只有选中、悬停或按关系筛选时才上色、显线型
    // 同一透明度档的线合成一条路径一次描完，省掉几百次 stroke
    const lit = new Set([...litSel, ...litHover]);
    const buckets = new Map();
    model.edges.forEach(e => {
      if (lit.has(e)) return;
      const a = Math.min(e.a.a, e.b.a);
      if (a <= 0.01) return;
      const key = (state.rel === e.rel ? 'r' : 'n') + Math.round(a * 20);
      let b = buckets.get(key);
      if (!b) {
        b = { rel: state.rel === e.rel, a: Math.round(a * 20) / 20, list: [] };
        buckets.set(key, b);
      }
      b.list.push(e);
    });
    buckets.forEach(b => {
      ctx.lineWidth = b.rel ? 1.3 : 1;
      ctx.globalAlpha = (b.rel ? 0.62 : state.rel ? 0.05 : focusOn ? 0.1 : 0.15) * b.a;
      ctx.strokeStyle = col(b.rel ? T.rel[state.rel] : T.edge);
      if (b.rel) {
        ctx.lineCap = 'round';
        ctx.setLineDash(REL_DASH[state.rel]);
      }
      ctx.beginPath();
      b.list.forEach(e => {
        const g = quad(e);
        ctx.moveTo(g.x1, g.y1);
        ctx.quadraticCurveTo(g.cx, g.cy, g.x2, g.y2);
      });
      ctx.stroke();
      if (b.rel) {
        ctx.setLineDash([]);
        ctx.lineCap = 'butt';
      }
    });

    // 亮起的线：按方向流动一次
    const pSel = T.easeInOut(progress('flowSel', time));
    const pHov = T.easeInOut(progress('flowHover', time));
    litSel.forEach(e => {
      const a = Math.min(e.a.at, e.b.at) > 0 ? 1 : 0;
      if (a) drawLit(e, reduced ? 1 : pSel, 1.9, 0.95);
    });
    litHover.forEach(e => {
      if (litSel.includes(e)) return;
      const a = Math.min(e.a.at, e.b.at) > 0 ? 1 : 0;
      if (a) drawLit(e, reduced ? 1 : pHov, 1.5, 0.85);
    });

    // 点
    const hitSet = hits ? new Set(hits.map(u => u.id)) : null;
    const order = units.filter(u => u.a > 0.01);
    const special = u => u.id === state.selected || u.id === hoverId || (hitSet && hitSet.has(u.id));
    order.sort((p, q) => (special(p) ? 1 : 0) - (special(q) ? 1 : 0) || p.a - q.a);
    order.forEach(u => {
      const cat = T.cats[u.cat - 1];
      const x = u.sx;
      const y = u.sy;
      const sel = u.id === state.selected;
      const hov = u.id === hoverId;
      const r = hov && !sel && !reduced ? u.sr * 1.1 : u.sr;
      const fade = u.status === 'stale' ? 0.4 : 1;
      if (sel) {
        ctx.fillStyle = cat.halo;
        ctx.globalAlpha = u.a * 0.45;
        ctx.beginPath();
        ctx.arc(x, y, r + 11, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = u.a;
        ctx.beginPath();
        ctx.arc(x, y, r + 6, 0, Math.PI * 2);
        ctx.fill();
      } else if (hitSet && hitSet.has(u.id)) {
        ctx.globalAlpha = u.a * 0.9;
        ctx.beginPath();
        ctx.arc(x, y, r + 5, 0, Math.PI * 2);
        ctx.fillStyle = cat.halo;
        ctx.fill();
      }
      ctx.globalAlpha = u.a * fade;
      fillStroke(u, cat, x, y, r, isOpenAt(u, endMi));
      const outer = statusRing(u, cat, x, y, r);
      ctx.globalAlpha = u.a * fade * 0.85;
      heatArc(u, x, y, outer, zoomRatio < 1.3);
      if (sel || hov) {
        ctx.globalAlpha = sel ? 1 : 0.7;
        ctx.beginPath();
        ctx.arc(x, y, outer + (u.asked30d >= 2 ? 6 : 3.5), 0, Math.PI * 2);
        ctx.strokeStyle = col(sel ? T.ink : T.ink2);
        ctx.lineWidth = sel ? 2 : 1.2;
        ctx.stroke();
      }
    });

    // 标签：全图只写簇名和点数；放大到簇才写点的短标题；完整标题在悬停卡里
    ctx.lineJoin = 'round';
    ctx.textBaseline = 'middle';
    const placed = narrow && zoomRatio < 1.15 ? [] : [zoomBox];
    if (miniBox) placed.push(miniBox);
    if (legendBox) placed.push(legendBox);
    const overlaps = rect => placed.some(b => rect[0] < b[2] && rect[2] > b[0] && rect[1] < b[3] && rect[3] > b[1]);
    clusterLabels.forEach(L => {
      const cat = T.cats[L.c.cat - 1];
      const fLabel = labelFont + ' ' + labelSize + 'px ' + T.sans;
      const fCount = '500 ' + (labelSize - 1) + 'px ' + T.mono;
      setFont(fLabel);
      const maxW = cssW > 600 ? Math.max(L.width + 80, 190) : Math.max(L.width - 4, 60);
      const lines = wrapLabel(L.c.label, maxW);
      const lh = labelSize + 4;
      const countText = String(L.n);
      const cw = textW(fCount, countText) + 6;
      const widths = lines.map(t => textW(fLabel, t));
      const total = lines.length * lh;
      const wmax = Math.max(...widths.map((wd, i) => wd + (i === lines.length - 1 ? cw : 0)));
      let x0 = clamp(L.x, wmax / 2 + 6, cssW - wmax / 2 - 6);
      const above = L.top - 8 - total + lh / 2;
      const under = L.bottom + 8 + lh / 2;
      const tries = L.below ? [under, under + lh * 0.8, above] : [above, above - lh * 0.8, above - lh * 1.6, under];
      let y0 = tries[0];
      let rect = null;
      const xs = [x0, clamp(L.x - wmax * 0.35, wmax / 2 + 6, cssW - wmax / 2 - 6), clamp(L.x + wmax * 0.35, wmax / 2 + 6, cssW - wmax / 2 - 6)];
      // 先找既不压别的簇名、也不压别的簇的位置；找不到再退一步，只避开簇名。
      const onBlob = r => clusterLabels.some(o => o !== L && o.c.sbox && r[0] < o.c.sbox[2] - 4 && r[2] > o.c.sbox[0] + 4 && r[1] < o.c.sbox[3] - 4 && r[3] > o.c.sbox[1] + 4);
      for (const strict of [true, false]) {
        for (const ty of tries) {
          for (const tx of xs) {
            const r = [tx - wmax / 2 - 4, ty - lh / 2 - 2, tx + wmax / 2 + 4, ty - lh / 2 + total + 2];
            if (r[1] < 4 || r[3] > cssH - 4 || overlaps(r) || (strict && onBlob(r))) continue;
            y0 = ty;
            x0 = tx;
            rect = r;
            break;
          }
          if (rect) break;
        }
        if (rect) break;
      }
      if (!rect && state.cluster !== L.c.id) return;
      if (!rect) rect = [x0 - wmax / 2 - 4, y0 - lh / 2 - 2, x0 + wmax / 2 + 4, y0 - lh / 2 + total + 2];
      placed.push(rect);
      ctx.globalAlpha = L.alpha;
      ctx.strokeStyle = col(T.surface, 0.92);
      ctx.lineWidth = 4;
      ctx.textAlign = 'left';
      lines.forEach((line, i) => {
        const lx = x0 - (widths[i] + (i === lines.length - 1 ? cw : 0)) / 2;
        const ly = y0 + i * lh;
        setFont(fLabel);
        ctx.fillStyle = cat.label;
        textHalo(line, lx, ly);
        if (i === lines.length - 1) {
          setFont(fCount);
          ctx.fillStyle = col(T.faint);
          textHalo(countText, lx + widths[i] + 6, ly);
        }
      });
    });

    const detail = zoomRatio >= 1.6;
    const want = [];
    const selU = state.selected && model.byId.get(state.selected);
    if (selU && selU.a > 0.5) want.push({ u: selU, p: 0 });
    if (detail) {
      if (selU) relatedSet(selU.id).forEach(id => { const u = model.byId.get(id); if (u && u !== selU && u.a > 0.5) want.push({ u, p: 2 }); });
      if (hits) hits.slice(0, 12).forEach(u => { if (u.a > 0.5) want.push({ u, p: 3 }); });
      units.filter(u => u.a > 0.6 && u.sx > -20 && u.sx < cssW + 20 && u.sy > -20 && u.sy < cssH + 20)
        .sort((a, b) => b.corroboration - a.corroboration || b.asked30d - a.asked30d)
        .slice(0, 60)
        .forEach(u => want.push({ u, p: 4 }));
    }
    const seen = new Set();
    const nodesOnScreen = order.filter(u => u.sx > -30 && u.sx < cssW + 30 && u.sy > -30 && u.sy < cssH + 30);
    const hitsNode = (rect, self) => nodesOnScreen.some(u => {
      if (u === self || u.a < 0.3) return false;
      const nx = clamp(u.sx, rect[0], rect[2]);
      const ny = clamp(u.sy, rect[1], rect[3]);
      return (nx - u.sx) * (nx - u.sx) + (ny - u.sy) * (ny - u.sy) < (u.sr + 2) * (u.sr + 2);
    });
    want.forEach(({ u, p }) => {
      if (seen.has(u.id)) return;
      seen.add(u.id);
      const size = p === 0 ? 13 : p <= 2 ? 12 : 11;
      const weight = p === 0 ? 600 : 500;
      const f = weight + ' ' + size + 'px ' + T.sans;
      const text = shortTitle(u, p === 0 ? 22 : p <= 2 ? 14 : 10);
      const w = textW(f, text);
      const h = size + 4;
      const r = u.sr + (p === 0 ? 10 : 6);
      const spots = [
        [u.sx + r, u.sy - h / 2],
        [u.sx - r - w, u.sy - h / 2],
        [u.sx - w / 2, u.sy - r - h],
        [u.sx - w / 2, u.sy + r]
      ];
      let chosen = null;
      for (const s of spots) {
        const rect = [s[0] - 2, s[1], s[0] + w + 2, s[1] + h];
        if (rect[0] < 2 || rect[2] > cssW - 2 || rect[1] < 2 || rect[3] > cssH - 2) continue;
        if (overlaps(rect)) continue;
        if (hitsNode(rect, u)) continue;
        chosen = { x: s[0], y: s[1] + h / 2, rect };
        break;
      }
      if (!chosen && p === 0 && cssW > 600) {
        const s = spots[0];
        chosen = { x: clamp(s[0], 4, cssW - w - 4), y: s[1] + h / 2, rect: [s[0], s[1], s[0] + w, s[1] + h] };
      }
      if (!chosen) return;
      placed.push(chosen.rect);
      ctx.globalAlpha = p >= 3 ? Math.min(1, u.a) : 1;
      ctx.textAlign = 'left';
      ctx.strokeStyle = col(T.surface, 0.94);
      ctx.lineWidth = 4;
      ctx.fillStyle = col(p === 0 ? T.ink : p <= 2 ? T.ink2 : T.muted);
      setFont(f);
      textHalo(text, chosen.x, chosen.y);
    });
    ctx.globalAlpha = 1;
    drawMini();
    const pct = Math.round(zoomRatio * 100) + '%';
    const pctEl = root && root.querySelector('#knet-zoom-pct');
    if (pctEl && pctEl.textContent !== pct) pctEl.textContent = pct;
    canvas.dataset.drawMs = (performance.now() - t0).toFixed(2);
  }

  // 小地图：簇的位置加当前视口框；点一下或拖动就把镜头挪过去。
  function miniMap() {
    const mc = root && root.querySelector('#knet-mini');
    if (!mc) return null;
    const [w, h] = miniSize;
    if (!w || !h) return null;
    const b = model.bounds;
    const vb = viewBox(b.minx, b.miny, b.maxx, b.maxy);
    const pad = 6;
    const k = Math.min((w - pad * 2) / (vb[2] - vb[0]), (h - pad * 2) / (vb[3] - vb[1]));
    const ox = (w - (vb[2] - vb[0]) * k) / 2 - vb[0] * k;
    const oy = (h - (vb[3] - vb[1]) * k) / 2 - vb[1] * k;
    return { mc, w, h, k, ox, oy };
  }

  function drawMini() {
    const mm = miniMap();
    if (!mm) return;
    const { mc, w, h, k, ox, oy } = mm;
    const W2 = Math.round(w * dpr);
    const H2 = Math.round(h * dpr);
    if (mc.width !== W2 || mc.height !== H2) {
      mc.width = W2;
      mc.height = H2;
    }
    const m = mc.getContext('2d');
    if (!m) return;
    m.setTransform(dpr, 0, 0, dpr, 0, 0);
    m.clearRect(0, 0, w, h);
    model.clusters.forEach(c => {
      const v = view(c.cx, c.cy);
      const shown = c.members.some(u => u.at > 0);
      m.globalAlpha = shown ? 0.5 : 0.18;
      m.beginPath();
      m.arc(ox + v[0] * k, oy + v[1] * k, Math.max(3, c.R * k * 0.82), 0, Math.PI * 2);
      m.fillStyle = T.cats[c.cat - 1].base;
      m.fill();
    });
    const a = toView(0, 0);
    const z = toView(cssW, cssH);
    const x0 = ox + a[0] * k;
    const y0 = oy + a[1] * k;
    const x1 = ox + z[0] * k;
    const y1 = oy + z[1] * k;
    if (cam.k <= kFit * 1.05) return;
    m.globalAlpha = 1;
    m.fillStyle = col(T.accent, 0.08);
    m.fillRect(x0, y0, x1 - x0, y1 - y0);
    m.strokeStyle = col(T.accent);
    m.lineWidth = 1.5;
    m.strokeRect(clamp(x0, 1, w - 1), clamp(y0, 1, h - 1), clamp(x1, 1, w - 1) - clamp(x0, 1, w - 1), clamp(y1, 1, h - 1) - clamp(y0, 1, h - 1));
  }

  /* ---------- 目标透明度（选中、悬停、搜索、筛选的淡入淡出） ---------- */

  function retarget(dur) {
    const sel = state.selected && model.byId.get(state.selected);
    let set = null;
    let level = 1;
    if (sel) {
      set = relatedSet(sel.id);
      level = 0.14;
    } else if (hits) {
      set = new Set(hits.map(u => u.id));
      level = 0.18;
    } else if (state.cluster) {
      set = new Set((model.cmap.get(state.cluster) || { members: [] }).members.map(u => u.id));
      level = 0.32;
    } else if (state.rel) {
      set = new Set();
      model.edges.forEach(e => { if (e.rel === state.rel) { set.add(e.from); set.add(e.to); } });
      level = 0.28;
    }
    if (hoverId) {
      const hs = relatedSet(hoverId);
      if (!set) {
        set = hs;
        level = 0.4;
      } else hs.forEach(id => set.add(id));
    }
    let changed = false;
    model.units.forEach(u => {
      const t = !baseVisible(u) ? 0 : !set || set.has(u.id) ? 1 : level;
      if (t !== u.at) changed = true;
      u.af = u.a;
      u.at = t;
    });
    litSel = sel ? (model.neighbors.get(sel.id) || []).filter(n => !state.rel || n.rel === state.rel).map(n => n.edge).filter(e => baseVisible(e.a) && baseVisible(e.b)) : [];
    litHover = hoverId ? (model.neighbors.get(hoverId) || []).filter(n => !state.rel || n.rel === state.rel).map(n => n.edge).filter(e => baseVisible(e.a) && baseVisible(e.b)) : [];
    if (changed) startTween('dim', dur === undefined ? T.base : dur);
    else kick();
  }

  /* ---------- 文案 ---------- */

  function clusterOf(u) {
    return model.cmap.get(u.cluster);
  }

  function overturnedList() {
    const list = [];
    model.edges.forEach(e => {
      if (e.rel !== 'contradicts') return;
      list.push({ u: e.b, by: e.a });
    });
    return list.sort((p, q) => (q.by.month > p.by.month ? 1 : q.by.month < p.by.month ? -1 : 0) || q.u.corroboration - p.u.corroboration);
  }

  function openQuestions() {
    return model.units.filter(u => model.unresolved.has(u.id)).sort((a, b) => b.corroboration - a.corroboration || (a.month < b.month ? -1 : 1));
  }

  function mostAsked() {
    return model.units.filter(u => u.asked30d > 0).sort((a, b) => b.asked30d - a.asked30d || b.corroboration - a.corroboration);
  }

  function topClusters(fn) {
    return model.clusters.map(c => ({ c, n: c.members.reduce((s, u) => s + fn(u), 0) })).sort((a, b) => b.n - a.n);
  }

  function scopeUnits() {
    let list = model.units.filter(baseVisible);
    if (state.cluster) list = list.filter(u => u.cluster === state.cluster);
    if (hits) {
      const set = new Set(hits.map(u => u.id));
      list = list.filter(u => set.has(u.id));
    }
    return list;
  }

  function sowhat() {
    const m = model;
    if (state.unknown) return '地址里的这个点不在网上，可能是旧链接。回到导览，从最多人问的问题重新走进去。';
    const q = state.query.trim();
    if (q) {
      if (!hits || !hits.length) {
        const near = nearestCluster(q);
        return '还没人问过「' + q + '」。离它最近的是「' + (near ? near.label : '') + '」，从那一簇问起最容易接上。';
      }
      return '「' + q + '」接得上 ' + hits.length + ' 个点，最该先看的是「' + hits[0].title + '」。';
    }
    const sel = state.selected && m.byId.get(state.selected);
    if (sel) {
      if (!baseVisible(sel)) return '这个点不在当前的时间范围里。把时间轴的范围拉到 ' + sel.month + '，它才会出现。';
      const nb = m.neighbors.get(sel.id) || [];
      if (nb.some(n => n.rel === 'contradicts' && n.dir === 'in')) return '这条做法后来被推翻了。照着做之前，先看推翻它的那一条。';
      if (nb.some(n => n.rel === 'contradicts' && n.dir === 'out')) return '这条推翻了一个旧做法：不是旧答案错了，是条件变了。';
      if (sel.status === 'disputed') return '这条还有争议。两边的说法都看一眼，再决定用不用。';
      if (sel.status === 'stale') return '这条已经过期。环境变了，别直接照搬，先找更新的解法。';
      if (sel.kind === 'question') {
        const ans = nb.filter(n => n.rel === 'answers').length;
        if (!ans) return '佐证 ' + sel.corroboration + ' 人问过它，近 30 天又被问了 ' + sel.asked30d + ' 次，还没人接住。这是网上最缺答案的地方之一。';
        return ans > 1 ? '这个问题有 ' + ans + ' 种解法，先看佐证多的那一条。' : '这个问题已经有人接住了，顺着绿色的「解答」线走过去看怎么做。';
      }
      if (sel.status === 'verified') return '佐证 ' + sel.corroboration + ' 人，可以放心照着做。';
      if (sel.status === 'candidate') return '这条还只是候选，说的人不多。用之前自己验一遍。';
      return '顺着亮起的线往下走，看它后来被接住了，还是被推翻了。';
    }
    if (state.facet) {
      const c = m.cmap.get(state.facet.cluster);
      const n = m.units.filter(baseVisible).length;
      const word = { candidate: '还只是候选，用之前要自己验', curated: '已经整理过，可以先看', verified: '验证过，可以照着做', disputed: '还有争议，两边都要看', stale: '已经过期，别直接照搬' }[state.facet.status];
      return '「' + (c ? c.label : '') + '」里 ' + STATUS_LABEL[state.facet.status] + '的有 ' + n + ' 条：' + word + '。';
    }
    if (state.cluster) {
      const c = m.cmap.get(state.cluster);
      if (c) {
        const open = c.members.filter(u => m.unresolved.has(u.id));
        if (!open.length) return '「' + c.label + '」的 ' + c.members.length + ' 个点都有人接住了，这一簇可以放心照着走。';
        return '「' + c.label + '」里还有 ' + open.length + ' 个问题没人接住，最该有人认领的是「' + open.sort((a, b) => b.asked30d - a.asked30d || b.corroboration - a.corroboration)[0].title + '」。';
      }
    }
    if (state.unresolved) {
      const top = topClusters(u => (isOpenAt(u, state.range[1]) ? 1 : 0));
      const n = m.units.filter(u => isOpenAt(u, state.range[1])).length;
      return n + ' 个问题还没人接住，最多的在「' + top[0].c.label + '」和「' + top[1].c.label + '」。那里最缺人。';
    }
    if (state.rel) {
      const n = m.relCount[state.rel];
      return {
        similar: n + ' 对相似的问题：同一个坑，很多人各自踩了一遍。',
        follows: n + ' 条追问：表层解决了，更深的卡点才露出来。',
        answers: n + ' 条解答线，每一条都是有人把问题接住了。',
        contradicts: n + ' 处推翻：旧做法不一定错，常常是条件变了。',
        'same-tool': n + ' 条同工具线：会一个工具，能顺手解好几类问题。'
      }[state.rel];
    }
    if (!isFullRange()) {
      const inRange = m.units.filter(baseVisible);
      const open = inRange.filter(u => isOpenAt(u, state.range[1])).length;
      return rangeText() + ' 新长出 ' + inRange.length + ' 个点，其中 ' + open + ' 个问题到月底还没人接住。';
    }
    const hot = mostAsked()[0];
    return '多数问题已经有人接住。真正值得看的是那 ' + m.unresolved.size + ' 个没人接住的，和近 30 天被问了 ' + (hot ? hot.asked30d : 0) + ' 次的「' + (hot ? hot.title : '') + '」。';
  }

  /* ---------- HTML 片段 ---------- */

  function glyph(kind) {
    const s = {
      question: '<circle cx="8" cy="8" r="5.5"/>',
      solution: '<rect x="2.8" y="2.8" width="10.4" height="10.4" rx="2.4"/>',
      pitfall: '<path d="M8 1.6 14.4 8 8 14.4 1.6 8z"/>',
      'tool-review': '<path d="M13.8 8 10.9 13 5.1 13 2.2 8 5.1 3 10.9 3z"/>',
      resource: '<rect x="1.6" y="4.4" width="12.8" height="7.2" rx="3.6"/>',
      debate: '<path d="M8 1.8 14.2 12.4H1.8z"/>',
      'work-lead': '<path d="M8 1.6 9.5 6.1 14.2 6.2 10.4 9 11.8 13.6 8 10.9 4.2 13.6 5.6 9 1.8 6.2 6.5 6.1z"/>'
    }[kind] || '<circle cx="8" cy="8" r="5.5"/>';
    return '<svg class="knet-glyph" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">' + s + '</svg>';
  }

  // 状态图标只从这里取：有 CommonsIcons 就用它，没有就退回简单图形。
  const ICON_ALIAS = {
    candidate: 'candidate', curated: 'organized', verified: 'verified', stale: 'expired', disputed: 'disputed',
    open: 'question', resolved: 'resolved', overturned: 'reversed', hot: 'trending', fresh: 'spark', first: 'spark',
    question: 'question', solution: 'bulb', pitfall: 'pitfall', 'tool-review': 'tool', resource: 'citation', debate: 'disputed', 'work-lead': 'clue',
    relations: 'connection', active: 'in-progress', contributors: 'discussion', cluster: 'distilled'
  };
  const ICON_FALLBACK = {
    verified: '<circle cx="8" cy="8" r="5.6"/><path d="m5.6 8.1 1.6 1.6 3.2-3.4"/>',
    candidate: '<circle cx="8" cy="8" r="5.6" stroke-dasharray="2 2"/>',
    curated: '<rect x="3" y="4" width="10" height="8" rx="1.6"/><path d="M5.5 7h5M5.5 9.4h3"/>',
    stale: '<path d="M4.5 2.8h7M4.5 13.2h7M5 3c0 3 6 3 6 5s-6 2-6 5M11 3c0 3-6 3-6 5s6 2 6 5"/>',
    disputed: '<circle cx="6" cy="8" r="3.6"/><circle cx="10" cy="8" r="3.6"/>',
    open: '<circle cx="8" cy="8" r="5.6"/><path d="M6.4 6.4a1.7 1.7 0 1 1 2.4 1.6c-.5.2-.8.6-.8 1.1M8 11.2v.1"/>',
    resolved: '<circle cx="8" cy="8" r="5.6"/><path d="m5.6 8.1 1.6 1.6 3.2-3.4"/>',
    overturned: '<path d="M3.5 5.5h7a2.5 2.5 0 0 1 0 5H6"/><path d="m5.5 3.5-2 2 2 2"/>',
    hot: '<path d="M3 13h10M4.5 13V9.5M8 13V6.5M11.5 13V3.5"/>',
    fresh: '<path d="M8 2.5 9.2 6.8 13.5 8 9.2 9.2 8 13.5 6.8 9.2 2.5 8 6.8 6.8z"/>',
    active: '<circle cx="8" cy="8" r="5.6"/><path d="M8 5v3l2 1.4"/>'
  };

  function stateIcon(name, size) {
    const px = size || 16;
    const lib = window.CommonsIcons;
    let html = '';
    if (lib && typeof lib.svg === 'function') {
      try { html = lib.svg(ICON_ALIAS[name] || name, { size: px }); } catch { html = ''; }
    }
    if (!html) {
      const g = ICON_FALLBACK[name] || (KIND_LABEL[name] ? '' : ICON_FALLBACK.candidate);
      html = g ? '<svg viewBox="0 0 16 16" width="' + esc(px) + '" height="' + esc(px) + '" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + g + '</svg>' : glyph(name);
    }
    return '<span class="knet-si" data-icon="' + esc(name) + '" aria-hidden="true">' + html + '</span>';
  }

  const STATUS_TONE = { verified: 'success', curated: 'agent', candidate: 'outline', stale: 'gray', disputed: 'notice', open: 'accent' };

  function statusBadge(status) {
    const label = status === 'open' ? '没人接住' : STATUS_LABEL[status] || status;
    return '<span class="pill ' + (STATUS_TONE[status] || '') + ' knet-status" data-status="' + esc(status) + '">' + stateIcon(status, 14) + esc(label) + '</span>';
  }

  /* safe-slot: extra — 调用方传入写死的属性片段 */
  function svg(path, extra) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"' + (extra || '') + '><path d="' + esc(path) + '"/></svg>';
  }

  function iconOf(u) {
    if (model.unresolved.has(u.id)) return 'open';
    if ((u.overMi || Infinity) !== Infinity) return 'overturned';
    return u.status;
  }

  // 热点（近 30 天被问 ≥ 8 次）和本月新出现的点，在标题旁挂一个小图标
  function flagsHTML(u) {
    const f = [];
    if (u.asked30d >= 8) f.push('<span class="knet-flag" data-flag="hot" title="近 30 天被问 ' + esc(u.asked30d) + ' 次">' + stateIcon('hot', 14) + '<span class="knet-sr">热点</span></span>');
    if (u.mi === model.months.length - 1) f.push('<span class="knet-flag" data-flag="fresh" title="本月新出现">' + stateIcon('fresh', 14) + '<span class="knet-sr">本月新出现</span></span>');
    return f.length ? '<span class="knet-flags">' + f.join('') + '</span>' : '';
  }

  // 紧凑列表行：状态图标 · 标题和来路 · 一个计数
  function row(u, meta, n, unit, icon) {
    return '<button type="button" class="knet-row" data-knet="select" data-id="' + esc(u.id) + '" data-cat="' + esc(u.cat) + '"' + (u.id === state.selected ? ' aria-current="true"' : '') + '>' +
      stateIcon(icon || iconOf(u), 16) +
      '<span class="knet-row-copy"><b>' + esc(u.title) + '</b><small><i class="knet-dot"></i>' + esc(meta) + '</small></span>' +
      '<span class="knet-row-n"><b>' + esc(n) + '</b><small>' + esc(unit) + '</small></span></button>';
  }

  function guideHTML() {
    const m = model;
    const asked = mostAsked().slice(0, 4);
    const open = openQuestions().slice(0, 4);
    const over = overturnedList().slice(0, 4);
    const top = topClusters(u => u.asked30d)[0];
    const cl = u => (clusterOf(u) || {}).label || '';
    return '<div class="knet-pane" data-pane="guide">' +
      '<p class="knet-kicker">导览' + (m.synthetic ? ' · <span class="knet-sample-inline">示例</span>' : '') + '</p>' +
      '<h2 class="knet-pane-title">近 30 天问得最多的是「' + esc(top ? top.c.label : '') + '」，还有 ' + m.unresolved.size + ' 个问题没人接住。</h2>' +
      '<p class="knet-pane-lede">每条都能直接飞过去，顺着亮起的线往下走。</p>' +
      '<section class="knet-sec"><h3 class="knet-label">最多人问的<small>近 30 天被问次数</small></h3><div class="knet-rows">' +
      asked.map(u => row(u, cl(u) + ' · ' + KIND_LABEL[u.kind], u.asked30d, '次', u.kind)).join('') + '</div></section>' +
      '<section class="knet-sec"><h3 class="knet-label">还没解决的<small>' + m.unresolved.size + ' 个 · 按佐证</small></h3><div class="knet-rows">' +
      open.map(u => row(u, cl(u) + ' · ' + u.month, '佐证 ' + u.corroboration, '人', 'open')).join('') + '</div>' +
      '<button type="button" class="button small tonal knet-more" data-knet="unresolved-on">只看这 ' + m.unresolved.size + ' 个</button></section>' +
      '<section class="knet-sec"><h3 class="knet-label">被推翻过的<small>' + esc(m.relCount.contradicts) + ' 处</small></h3><div class="knet-rows">' +
      over.map(x => row(x.u, x.by.month + ' 被推翻 · ' + cl(x.u), '佐证 ' + x.u.corroboration, '人', 'overturned')).join('') + '</div></section>' +
      '<p class="knet-hint">键盘：<kbd>/</kbd> 搜索 · <kbd>F</kbd> 全图 · <kbd>+</kbd> <kbd>-</kbd> 缩放 · <kbd>Esc</kbd> 退出选中</p>' +
      '</div>';
  }

  function kvHTML(pairs) {
    return '<dl class="knet-kv">' + pairs.map(p => '<div><dt>' + esc(p[0]) + '</dt><dd>' + /* safe: p[1] 是调用方拼好、已 esc 的 HTML 片段 */ p[1] + '</dd></div>').join('') + '</dl>';
  }

  function clusterHTML(c) {
    const m = model;
    const open = c.members.filter(u => m.unresolved.has(u.id)).length;
    const over = c.members.filter(u => u.overMi !== Infinity).length;
    const asked = c.members.reduce((s, u) => s + u.asked30d, 0);
    const list = c.members.slice().sort((a, b) => (m.unresolved.has(b.id) ? 1 : 0) - (m.unresolved.has(a.id) ? 1 : 0) || b.asked30d - a.asked30d || b.corroboration - a.corroboration);
    return '<div class="knet-pane" data-pane="cluster" data-cat="' + esc(c.cat) + '">' +
      '<div class="knet-pane-top"><button type="button" class="button ghost small knet-back" data-knet="guide">' + svg('M19 12H5M11 18l-6-6 6-6') + '导览</button></div>' +
      '<p class="knet-kicker knet-kicker-cat"><i class="knet-dot"></i>问题簇' + (m.synthetic ? ' · <span class="knet-sample-inline">示例</span>' : '') + '</p>' +
      '<h2 class="knet-pane-title">' + esc(c.label) + '</h2>' +
      '<dl class="knet-stats"><div><dt>知识点</dt><dd>' + c.members.length + '</dd></div><div><dt>没人接住</dt><dd>' + open + '</dd></div><div><dt>被推翻</dt><dd>' + over + '</dd></div><div><dt>近 30 天被问</dt><dd>' + asked + '</dd></div></dl>' +
      '<section class="knet-sec"><h3 class="knet-label">这一簇的点<small>未解的在前 · 右侧是佐证人数</small></h3><div class="knet-rows">' +
      list.map(u => row(u, KIND_LABEL[u.kind] + ' · ' + STATUS_LABEL[u.status] + ' · ' + u.month, '佐证 ' + u.corroboration, '人')).join('') +
      '</div></section></div>';
  }

  function story(u) {
    const solved = u.ansMi !== Infinity ? model.months[u.ansMi] : (u.kind !== 'question' && u.status !== 'candidate' ? u.month : '');
    const overturned = u.overMi !== Infinity ? model.months[u.overMi] : '';
    return { first: u.month, solved, overturned };
  }

  function avatarsHTML(list) {
    if (!list.length) return '';
    return '<span class="knet-avs" role="img" aria-label="贡献者代号 ' + esc(list.join('、')) + '">' + list.slice(0, 4).map((c, i) => '<span class="knet-av" data-i="' + (i % 3) + '" title="' + esc(c) + '">' + esc(String(c).slice(-2)) + '</span>').join('') + (list.length > 4 ? '<span class="knet-av" data-i="more">+' + (list.length - 4) + '</span>' : '') + '</span>';
  }

  function unitHTML(u) {
    const m = model;
    const c = clusterOf(u);
    const groups = {};
    RELS.forEach(r => { groups[r] = []; });
    (m.neighbors.get(u.id) || []).forEach(n => {
      const other = m.byId.get(n.id);
      if (other && groups[n.rel]) groups[n.rel].push({ other, dir: n.dir });
    });
    const relWord = (rel, dir) => {
      if (rel === 'answers') return dir === 'in' ? '解答了它' : '它解答了';
      if (rel === 'contradicts') return dir === 'in' ? '推翻了它' : '它推翻了';
      if (rel === 'follows') return dir === 'in' ? '追问它' : '它追问了';
      return REL_LABEL[rel];
    };
    const relBlocks = RELS.filter(r => groups[r].length).map(rel => '<div class="knet-relgroup" data-rel="' + rel + '"><p class="knet-relhead"><i class="knet-swatch"></i>' + REL_LABEL[rel] + '<span>' + groups[rel].length + '</span></p><div class="knet-rows">' +
      groups[rel].map(x => row(x.other, relWord(rel, x.dir) + ' · ' + KIND_LABEL[x.other.kind] + ' · ' + x.other.month, '佐证 ' + x.other.corroboration, '人')).join('') + '</div></div>').join('');
    const tl = story(u);
    /* safe-slot: label, body — 调用方传入写死文案或已 esc 的片段 */
    const sec = (label, body) => '<section class="knet-sec"><h3 class="knet-label">' + label + '</h3>' + body + '</section>';
    const steps = u.steps.length ? '<ol class="knet-steps">' + u.steps.map(s => '<li>' + esc(s) + '</li>').join('') + '</ol>' : '';
    const actions = (u.method ? '<a class="button small" href="#/knowledge/' + esc(u.method) + '">' + icon('book') + '阅读方法</a>' : '') +
      (u.fieldwork ? '<button type="button" class="button small tonal" data-action="fieldwork-open" data-id="' + esc(u.fieldwork) + '">看群友实践' + icon('arrow') + '</button>' : '');
    const isOpen = m.unresolved.has(u.id);
    const conf = clamp(u.confidence, 0, 1);
    const sep = '<span class="knet-prov-sep" aria-hidden="true"></span>';
    const prov = '<p class="knet-prov">' + (c ? '<button type="button" class="knet-kc-cluster" data-knet="cluster" data-id="' + esc(c.id) + '"><i class="knet-dot"></i>' + esc(c.label) + '</button>' + sep : '') +
      '<span class="knet-num">' + esc(u.month) + '</span>' + sep + '<span>佐证 <b class="knet-num">' + esc(u.corroboration) + '</b> 人</span>' + avatarsHTML(u.contributors) + '</p>';
    const kv = kvHTML([
      ['类型', '<span class="knet-kind">' + glyph(u.kind) + esc(KIND_LABEL[u.kind]) + '</span>'],
      ['状态', statusBadge(u.status) + (isOpen ? statusBadge('open') : '')],
      ['簇', c ? '<span class="knet-kv-cluster"><i class="knet-dot"></i>' + esc(c.label) + '</span>' : '—'],
      ['首次出现', '<span class="knet-num">' + esc(u.month) + '</span>'],
      ['最近活动', '<span class="knet-num">' + esc(u.lastActive) + '</span>'],
      ['佐证人数', '<span class="knet-num">' + esc(u.corroboration) + '</span> 人'],
      ['关系数', '<span class="knet-num">' + esc(u.deg) + '</span> 条'],
      ['近 30 天被问', '<span class="knet-num">' + esc(u.asked30d) + '</span> 次']
    ]);
    const ev = [
      { icon: 'fresh', label: '第一次出现', when: tl.first, done: true },
      { icon: 'resolved', label: u.kind === 'question' ? '被接住' : '整理成条', when: tl.solved || '还没有', done: !!tl.solved },
      { icon: 'overturned', label: '被推翻', when: tl.overturned || '没有', done: !!tl.overturned, kind: 'over' },
      { icon: 'active', label: '最近活动', when: u.lastActive, done: true }
    ];
    const mini = '<ol class="knet-tl">' + ev.map(e => '<li data-done="' + esc(e.done) + '"' + (e.kind ? ' data-kind="' + esc(e.kind) + '"' : '') + '>' + stateIcon(e.icon, 14) + '<span>' + esc(e.label) + '</span><b class="knet-num">' + esc(e.when) + '</b></li>').join('') + '</ol>';
    return '<article class="knet-pane knet-kc" data-pane="unit" data-cat="' + esc(u.cat) + '">' +
      '<div class="knet-pane-top"><button type="button" class="button ghost small knet-back" data-knet="guide">' + svg('M19 12H5M11 18l-6-6 6-6') + '导览</button><span class="knet-id">' + esc(u.id) + '</span></div>' +
      '<header class="knet-kc-head"><div class="knet-kc-tags"><span class="knet-kind">' + stateIcon(u.kind, 14) + esc(KIND_LABEL[u.kind]) + '</span>' + statusBadge(u.status) + (isOpen ? statusBadge('open') : '') + (m.synthetic ? '<span class="knet-sample">示例</span>' : '') + '</div>' +
      '<span class="knet-conf" title="把握：整理者对这条结论的信心"><span class="knet-conf-bar" style="--knet-v:' + conf.toFixed(2) + '" aria-hidden="true"></span>把握 ' + Math.round(conf * 100) + '%</span></header>' +
      '<h2 class="knet-pane-title">' + esc(u.title) + '</h2>' +
      (u.question ? '<p class="knet-kc-q">' + esc(u.question) + '</p>' : '') +
      prov +
      sec('概要', kv) +
      sec('经过', mini) +
      (u.context ? sec('场景', '<p>' + esc(u.context) + '</p>') : '') +
      (u.solution ? sec('做法', '<p>' + esc(u.solution) + '</p>') : '') +
      (steps ? sec('步骤', steps) : '') +
      (u.outcome ? sec('结果', '<p>' + esc(u.outcome) + '</p>') : '') +
      (u.unresolved ? sec('还没解决', '<p>' + esc(u.unresolved) + '</p>') : '') +
      (u.tools.length ? sec('用到的工具', '<p class="knet-tools">' + u.tools.map(s => '<span>' + esc(s) + '</span>').join('') + '</p>') : '') +
      sec('相关知识点<small>' + esc(u.deg) + ' 条 · 按关系</small>', relBlocks || '<p class="knet-quiet">这张卡还没有连到别的点。</p>') +
      (actions ? '<footer class="knet-kc-foot"><div class="knet-kc-actions">' + actions + '</div></footer>' : '') +
      '</article>';
  }

  function cardHTML() {
    if (state.unknown) {
      return '<div class="knet-pane" data-pane="error" data-state="error"><p class="knet-kicker">知识卡</p><h2 class="knet-pane-title">没有「' + esc(state.unknown) + '」这个知识点</h2><p class="knet-pane-lede">可能是旧链接，或者这个点已经合并了。网上的其他点都没有动。</p><button type="button" class="button small" data-knet="guide">回到导览</button></div>';
    }
    const u = state.selected && model.byId.get(state.selected);
    if (u) return unitHTML(u);
    const c = state.cluster && model.cmap.get(state.cluster);
    if (c) return clusterHTML(c);
    return guideHTML();
  }

  function cardKey() {
    if (state.unknown) return 'x:' + state.unknown;
    if (state.selected) return 'u:' + state.selected;
    if (state.cluster) return 'c:' + state.cluster;
    return 'guide';
  }

  function relChips() {
    return RELS.map(rel => '<button type="button" class="chip knet-relchip' + (state.rel === rel ? ' selected' : '') + '" data-knet="rel" data-id="' + rel + '" data-rel="' + rel + '" aria-pressed="' + (state.rel === rel) + '"><i class="knet-swatch"></i>' + REL_LABEL[rel] + '<span class="knet-chip-n">' + esc(model.relCount[rel]) + '</span></button>').join('');
  }

  function clusterIndex() {
    return model.clusters.map(c => {
      const open = c.members.filter(u => model.unresolved.has(u.id)).length;
      const shown = c.members.filter(baseVisible).length;
      return '<button type="button" class="chip knet-cluster' + (state.cluster === c.id ? ' selected' : '') + '" data-knet="cluster" data-id="' + esc(c.id) + '" data-cat="' + esc(c.cat) + '" aria-pressed="' + (state.cluster === c.id) + '"' + (shown ? '' : ' disabled') + ' aria-label="' + esc(c.label) + '，' + c.members.length + ' 个点，' + open + ' 个没人接住"><i class="knet-dot"></i><b>' + esc(c.label) + '</b><small>' + shown + (open ? ' · <em>' + open + ' 未解</em>' : '') + '</small></button>';
    }).join('');
  }

  // 图例：可折叠，分四块：形状、外圈、大小、线型
  function legendHTML() {
    const m = model;
    const ringSvg = st => {
      const ring = {
        verified: '<circle cx="12" cy="12" r="8.2" fill="none" stroke="currentColor" stroke-width="1"/>',
        candidate: '<circle cx="12" cy="12" r="8.2" fill="none" stroke="currentColor" stroke-width="1" stroke-dasharray="2 2"/>',
        disputed: '<circle cx="12" cy="12" r="7.6" fill="none" stroke="currentColor" stroke-width="1"/><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="1"/>',
        stale: '',
        open: ''
      }[st];
      const core = st === 'open' ? '<circle class="knet-lg-hole" cx="12" cy="12" r="5" stroke="currentColor" stroke-width="1.25"/>' : '<circle cx="12" cy="12" r="5" fill="currentColor"' + (st === 'stale' ? ' opacity=".4"' : '') + '/>';
      return '<svg class="knet-lg-ring" viewBox="0 0 24 24" aria-hidden="true">' + core + ring + '</svg>';
    };
    const kinds = KINDS.map(k => '<li>' + glyph(k) + KIND_LABEL[k] + '</li>').join('');
    const rings = ['verified', 'candidate', 'disputed', 'stale', 'open'].map(st => '<li data-status="' + st + '">' + ringSvg(st) + (st === 'open' ? '空心：没人接住' : STATUS_LABEL[st]) + stateIcon(st, 14) + '</li>').join('');
    const refs = [1, Math.round((1 + m.maxCorr) / 2), m.maxCorr].filter((v, i, a) => a.indexOf(v) === i);
    const sizes = refs.map(v => {
      const r = radiusOf(v, m.maxCorr) * 0.72;
      return '<li><svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><circle cx="12" cy="12" r="' + r.toFixed(1) + '" fill="currentColor"/></svg><span class="knet-num">' + esc(v) + '</span> 人</li>';
    }).join('') + '<li><svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><circle cx="12" cy="12" r="5" fill="currentColor"/><path class="knet-lg-arc" d="M12 4.2a7.8 7.8 0 0 1 7.6 6" fill="none" stroke-width="1.6" stroke-linecap="round"/></svg>弧长：近 30 天被问（全图只标 ≥8 次）</li>';
    const lines = RELS.map(rel => {
      const dash = REL_DASH[rel].length ? ' stroke-dasharray="' + REL_DASH[rel].join(' ') + '"' : '';
      const arrow = DIRECTED[rel] ? '<path d="M27 5l4 3-4 3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' : '';
      return '<li data-rel="' + rel + '"><svg viewBox="0 0 34 16" width="34" height="16" aria-hidden="true"><path d="M2 8h28" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"' + dash + '/>' + arrow + '</svg>' + REL_LABEL[rel] + '</li>';
    }).join('');
    return '<div class="knet-legend" id="knet-legend" data-open="' + state.legend + '">' +
      '<div class="knet-legend-body" id="knet-legend-body"' + (state.legend ? '' : ' hidden') + '>' +
      '<section><h4>形状 · 类型</h4><ul>' + kinds + '</ul></section>' +
      '<section><h4>外圈 · 状态</h4><ul>' + rings + '</ul></section>' +
      '<section><h4>大小 · 佐证人数</h4><ul>' + sizes + '</ul></section>' +
      '<section><h4>线型 · 关系</h4><p class="knet-legend-note">平时淡灰，选中才上色</p><ul>' + lines + '</ul></section>' +
      '</div>' +
      '<button type="button" class="button ghost small knet-legend-toggle" data-knet="legend" aria-expanded="' + state.legend + '" aria-controls="knet-legend-body">' + svg('M4 6h16M4 12h10M4 18h6') + '图例' + svg('M6 15l6-6 6 6', ' class="knet-chev"') + '</button>' +
      '</div>';
  }

  function timeHTML() {
    const m = model;
    const n = m.months.length;
    const max = Math.max(...m.perMonth, 1);
    const order = ['verified', 'curated', 'candidate', 'stale', 'disputed'];
    const r = state.range;
    const handle = (edge, v) => '<span class="knet-handle-slot" data-edge="' + esc(edge) + '"><span class="knet-handle" role="slider" tabindex="0" data-edge="' + esc(edge) + '" aria-label="' + (edge ? '范围终点' : '范围起点') + '" aria-valuemin="0" aria-valuemax="' + (n - 1) + '" aria-valuenow="' + esc(v) + '" aria-valuetext="' + esc(m.months[v]) + '"></span></span>';
    return '<div class="knet-time">' +
      '<button type="button" class="button small knet-replay" data-knet="replay" aria-pressed="false">' + svg('M8 5.5v13l10-6.5z', ' class="knet-play"') + svg('M8 6h3v12H8zM13 6h3v12h-3z', ' class="knet-pause"') + '<span>回放</span></button>' +
      '<div class="knet-brush" id="knet-brush" style="--knet-n:' + n + ';--knet-a:' + r[0] + ';--knet-b:' + r[1] + '">' +
      '<div class="knet-bars" aria-hidden="true">' + m.months.map((mo, i) => {
        const ps = m.perStatus[i];
        return '<span class="knet-bar" data-i="' + i + '" data-in="' + (i >= r[0] && i <= r[1]) + '"><small>' + esc(m.perMonth[i]) + '</small><i class="knet-stack" style="--knet-h:' + (m.perMonth[i] / max).toFixed(3) + '">' +
          order.map(st => ps[st] ? '<b data-st="' + st + '" style="flex-grow:' + esc(ps[st]) + '"></b>' : '').join('') + '</i></span>';
      }).join('') + '</div>' +
      '<div class="knet-rail"><span class="knet-rail-fill"></span>' + handle(0, r[0]) + handle(1, r[1]) + '</div>' +
      '<div class="knet-months">' + m.months.map((mo, i) => '<span data-in="' + (i >= r[0] && i <= r[1]) + '">' + esc(i === 0 ? mo : mo.slice(5)) + '</span>').join('') + '</div>' +
      '</div>' +
      '<div class="knet-time-side"><p class="knet-time-read"><b id="knet-time-range">' + esc(rangeText()) + '</b><span id="knet-time-count">' + m.units.filter(baseVisible).length + ' 个点</span></p>' +
      '<p class="knet-stack-key" aria-hidden="true">' + order.map(st => '<span data-st="' + st + '"><i></i>' + STATUS_LABEL[st] + '</span>').join('') + '</p></div>' +
      '</div>';
  }

  function metricsHTML(allowRoll) {
    const m = model;
    const mi = state.range[1];
    const now = metricsAt(mi);
    const prev = mi > 0 ? metricsAt(mi - 1) : null;
    const roll = !!allowRoll && !endMode && !reduced && performance.now() - lastLeave > 1500;
    const items = [
      ['units', '知识点', now.units, prev && now.units - prev.units, true],
      ['edges', '关系', now.edges, prev && now.edges - prev.edges, true],
      ['open', '未解决', now.open, prev && now.open - prev.open, false],
      ['fresh', '近 30 天新增', now.fresh, prev && now.fresh - prev.fresh, true],
      ['verified', '已验证占比', Math.round(now.verified * 100), prev && Math.round(now.verified * 100) - Math.round(prev.verified * 100), true]
    ];
    return items.map(([key, label, v, d, upGood], i) => {
      const trend = d === null || d === undefined ? 'none' : d > 0 ? 'up' : d < 0 ? 'down' : 'flat';
      const good = trend === 'flat' || trend === 'none' ? 'neutral' : (trend === 'up') === upGood ? 'good' : 'bad';
      const unit = key === 'verified' ? '%' : '';
      const dText = trend === 'none' ? '—' : (d > 0 ? '+' : d < 0 ? '−' : '±') + Math.abs(d) + (key === 'verified' ? ' 点' : '');
      const first = i === 0 && roll;
      return '<div class="knet-metric" data-key="' + esc(key) + '"><dt>' + esc(label) + '</dt><dd><b class="knet-metric-v"' + (i === 0 ? ' id="knet-stat-num" data-roll="' + first + '"' : '') + '>' + esc((first ? 0 : v)) + '</b>' + (unit ? '<span class="knet-metric-u">' + unit + '</span>' : '') +
        '<span class="knet-delta" data-trend="' + trend + '" data-good="' + good + '" title="和上个月月底比">' + dText + '</span></dd></div>';
    }).join('');
  }

  function headHTML() {
    const m = model;
    const sample = isLive() ? '' : (!m || m.synthetic ? '<span class="knet-sample" title="' + esc(m ? m.note : '合成示例') + '">示例</span>' : '');
    const lede = m ? '群里问过的事连成了一张网：多数已经有人接住，' + m.unresolved.size + ' 个还在等人。' : '群里问过的事，连成一张网。';
    if (!/^#\/knowledge\/[^/?]+/.test(String(location.hash || ''))) {
      return '<div class="knet-intro"><p>从问题找到方法与实践。</p>' + sample + '</div>' +
        (m ? '<dl class="knet-metrics" id="knet-metrics" data-at="' + state.range[1] + '" aria-label="指标，截至所选范围的最后一个月，和上个月比">' + metricsHTML(true) + '</dl>' : '');
    }
    return '<div class="page-head knet-head"><div class="knet-head-copy"><h1>知识地图' + sample + '</h1><p>' + esc(lede) + '</p></div>' +
      (m ? '<dl class="knet-metrics" id="knet-metrics" data-at="' + state.range[1] + '" aria-label="指标，截至所选范围的最后一个月，和上个月比">' + metricsHTML(true) + '</dl>' : '') +
      '</div>';
  }

  function crumbsHTML() {
    const m = model;
    const sel = state.selected && m.byId.get(state.selected);
    const cid = sel ? sel.cluster : state.cluster || (state.facet && state.facet.cluster) || '';
    const c = cid && m.cmap.get(cid);
    const sep = '<span class="knet-crumb-sep" aria-hidden="true">›</span>';
    const parts = ['<button type="button" class="knet-crumb" data-knet="crumb-root"' + (!c && !sel ? ' aria-current="page"' : '') + '>全部<span class="knet-num">' + m.units.filter(baseVisible).length + '</span></button>'];
    if (c) parts.push(sep + '<button type="button" class="knet-crumb" data-knet="crumb-cluster" data-id="' + esc(c.id) + '" data-cat="' + esc(c.cat) + '"' + (!sel ? ' aria-current="page"' : '') + '><i class="knet-dot"></i>' + esc(c.label) + '</button>');
    if (sel) parts.push(sep + '<span class="knet-crumb" aria-current="page" data-cat="' + esc(sel.cat) + '">' + esc(sel.title) + '</span>');
    const facet = state.facet ? '<button type="button" class="chip selected knet-facet" data-knet="facet-clear" aria-label="清除筛选：' + esc(STATUS_LABEL[state.facet.status]) + '">' + stateIcon(state.facet.status, 14) + esc(STATUS_LABEL[state.facet.status]) + svg('M6 6l12 12M18 6 6 18', ' class="knet-x"') + '</button>' : '';
    return '<nav class="knet-crumbs" aria-label="位置">' + parts.join('') + '</nav>' + facet;
  }

  function segHTML() {
    return '<div class="knet-seg" role="radiogroup" aria-label="视图"><span class="knet-seg-thumb" aria-hidden="true"></span>' +
      VIEWS.map(([id, label]) => '<button type="button" class="knet-seg-item" role="radio" data-knet="view" data-id="' + id + '" aria-checked="' + (state.view === id) + '" tabindex="' + (state.view === id ? 0 : -1) + '">' + label + '</button>').join('') + '</div>';
  }

  // 矩阵：簇 × 状态的单色热力格，点格子过滤网络
  function matrixHTML() {
    const m = model;
    const vis = u => u.mi >= state.range[0] && u.mi <= state.range[1] && (!state.unresolved || isOpenAt(u, state.range[1]));
    const rowsData = m.clusters.map(c => {
      const us = c.members.filter(vis);
      const cells = STATUSES.map(st => us.filter(u => u.status === st).length);
      return { c, cells, total: us.length };
    });
    const max = Math.max(1, ...rowsData.map(r => Math.max(...r.cells)));
    const colTotals = STATUSES.map((st, j) => rowsData.reduce((s, r) => s + r.cells[j], 0));
    const all = colTotals.reduce((s, v) => s + v, 0);
    const head = '<tr><th scope="col" class="knet-mx-corner">簇 \\ 状态</th>' + STATUSES.map(st => '<th scope="col">' + stateIcon(st, 14) + STATUS_LABEL[st] + '</th>').join('') + '<th scope="col" class="knet-mx-total">合计</th></tr>';
    const body = rowsData.map(r => '<tr><th scope="row" data-cat="' + esc(r.c.cat) + '"><i class="knet-dot"></i>' + esc(r.c.label) + '</th>' +
      r.cells.map((v, j) => {
        const on = state.facet && state.facet.cluster === r.c.id && state.facet.status === STATUSES[j];
        const t = v / max;
        return '<td><button type="button" class="knet-mx-cell" data-knet="facet" data-id="' + esc(r.c.id) + '" data-status="' + STATUSES[j] + '" style="--knet-v:' + t.toFixed(3) + '" data-strong="' + (t > 0.55) + '" aria-pressed="' + !!on + '"' + (v ? '' : ' disabled') + ' aria-label="' + esc(r.c.label) + '，' + STATUS_LABEL[STATUSES[j]] + ' ' + esc(v) + ' 条">' + esc(v) + '</button></td>';
      }).join('') + '<td class="knet-mx-total knet-num">' + esc(r.total) + '</td></tr>').join('');
    const foot = '<tr><th scope="row">合计</th>' + colTotals.map(v => '<td class="knet-mx-total knet-num">' + esc(v) + '</td>').join('') + '<td class="knet-mx-total knet-num">' + all + '</td></tr>';
    return '<div class="knet-mx-head"><p>' + esc(rangeText()) + ' · ' + all + ' 个点。格子越深点越多，点格子只看这一格。</p><span class="knet-mx-scale" aria-hidden="true"><small>0</small><i></i><small>' + max + '</small></span></div>' +
      '<div class="knet-mx-scroll"><table class="knet-mx"><thead>' + head + '</thead><tbody>' + body + '</tbody><tfoot>' + foot + '</tfoot></table></div>';
  }

  // 列表：可排序的表格；窄屏变卡片
  function listHTML() {
    const m = model;
    const list = scopeUnits();
    const key = state.sort.key;
    const dir = state.sort.dir;
    const val = u => key === 'cluster' ? (clusterOf(u) || {}).label || '' : key === 'kind' ? KINDS.indexOf(u.kind) : key === 'status' ? STATUSES.indexOf(u.status) : u[key];
    list.sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      const d = typeof va === 'number' ? va - vb : String(va).localeCompare(String(vb), 'zh');
      return d * dir || b.corroboration - a.corroboration;
    });
    const cols = ['title', 'cluster', 'kind', 'status', 'corroboration', 'month', 'deg', 'lastActive'];
    const head = '<tr>' + cols.map(k => {
      const on = key === k;
      return '<th scope="col" data-col="' + k + '" aria-sort="' + (on ? (dir > 0 ? 'ascending' : 'descending') : 'none') + '"><button type="button" class="knet-th" data-knet="sort" data-id="' + k + '">' + SORTS[k] + '<span class="knet-sort" data-dir="' + (on ? (dir > 0 ? 'asc' : 'desc') : '') + '" aria-hidden="true">' + svg(on && dir > 0 ? 'M8 14l4-4 4 4' : 'M8 10l4 4 4-4') + '</span></button></th>';
    }).join('') + '</tr>';
    const body = list.map(u => {
      const c = clusterOf(u);
      const open = isOpenAt(u, state.range[1]);
      return '<tr data-knet="select" data-id="' + esc(u.id) + '" data-cat="' + esc(u.cat) + '" tabindex="0"' + (u.id === state.selected ? ' aria-selected="true"' : '') + '>' +
        '<td data-col="title"><span class="knet-ls-title"><b title="' + esc(u.title) + '">' + esc(u.title) + '</b>' + flagsHTML(u) + '</span></td>' +
        '<td data-col="cluster"><span class="knet-kv-cluster"><i class="knet-dot"></i>' + esc(c ? c.label : '') + '</span></td>' +
        '<td data-col="kind"><span class="knet-kind">' + glyph(u.kind) + esc(KIND_LABEL[u.kind]) + '</span></td>' +
        '<td data-col="status"><span class="knet-st" data-status="' + esc(u.status) + '">' + stateIcon(open ? 'open' : u.status, 14) + esc(open ? '没人接住' : STATUS_LABEL[u.status]) + '</span></td>' +
        '<td data-col="corroboration" class="knet-num">' + esc(u.corroboration) + '</td>' +
        '<td data-col="month" class="knet-num">' + esc(u.month) + '</td>' +
        '<td data-col="deg" class="knet-num">' + esc(u.deg) + '</td>' +
        '<td data-col="lastActive" class="knet-num">' + esc(u.lastActive.slice(5)) + '</td></tr>';
    }).join('');
    return '<div class="knet-ls-head"><p>' + list.length + ' 条 · 按「' + SORTS[key] + '」' + (dir > 0 ? '升序' : '降序') + '。点一行看详情。</p></div>' +
      (list.length ? '<div class="knet-ls-scroll"><table class="knet-ls"><thead>' + head + '</thead><tbody>' + body + '</tbody></table></div>' : '<p class="knet-quiet">当前范围里没有点。把时间轴拉宽，或者清掉筛选。</p>');
  }

  /* ---------- 真实模式：问题库知识网与知识治理页 ----------
     数据来自 GET /governance/knowledge-graph（问题卡 + kb_link，只含调用者看得见的）。
     没有数据就不画，不补示例；#/knowledge/govern 是知识治理页。 */

  const GRAPH_W = 900;
  const GRAPH_STATUS = { verified: '已验证', pending: '待验证', stale: '已过期' };
  const GRAPH_LINK = { related: '相关', duplicate: '重复', replacement: '被替代' };
  const GRAPH_LIST_MAX = 200;
  const ATTENTION_GROUPS = [
    ['stale', '已过期', '这些问题卡被标成了过期，解法可能已经不灵。'],
    ['stale_hint', '可能过期', '有人提示它可能过期，还没有人确认。'],
    ['pending_long', '久未验证', '建好很久，仍没有凑够别的环境里的验证。'],
    ['duplicate', '疑似重复', '已被标成另一张问题卡的重复，可以合并过去。'],
    ['replaced', '已被替代', '已有新的问题卡取代了它，旧卡可以收起。']
  ];
  const num = v => esc(String(Math.round(v * 10) / 10));
  const shortText = (text, n) => { const s = String(text || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
  const problemPath = id => '#/solved/' + encodeURIComponent(id);

  // 有关联的问题卡按连通块放成一圈一圈，没有关联的排成点阵放在下面。
  function layoutGraph(nodes, links) {
    const parent = new Map(nodes.map(n => [n.id, n.id]));
    const find = id => {
      while (parent.get(id) !== id) { parent.set(id, parent.get(parent.get(id))); id = parent.get(id); }
      return id;
    };
    links.forEach(l => { if (parent.has(l.from) && parent.has(l.to)) parent.set(find(l.from), find(l.to)); });
    const groups = new Map();
    nodes.forEach(n => { const k = find(n.id); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(n); });
    const linked = [];
    const lone = [];
    groups.forEach(g => { if (g.length > 1) linked.push(g); else lone.push(g[0]); });
    linked.sort((a, b) => b.length - a.length);
    const pos = new Map();
    let x = 0;
    let y = 0;
    let rowH = 0;
    linked.forEach(g => {
      const r = g.length === 2 ? 34 : Math.min(Math.max(46, g.length * 12), (GRAPH_W - 60) / 2);
      const cell = 2 * r + 60;
      if (x > 0 && x + cell > GRAPH_W) { x = 0; y += rowH; rowH = 0; }
      const cx = x + cell / 2;
      const cy = y + cell / 2;
      g.forEach((n, i) => {
        const a = (2 * Math.PI * i) / g.length - Math.PI / 2;
        pos.set(n.id, { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a), label: g.length <= 12 });
      });
      x += cell;
      rowH = Math.max(rowH, cell);
    });
    let height = linked.length ? y + rowH : 0;
    let loneTop = 0;
    if (lone.length) {
      loneTop = height + (linked.length ? 24 : 0);
      const cols = Math.floor((GRAPH_W - 40) / 52);
      lone.forEach((n, i) => pos.set(n.id, { x: 26 + (i % cols) * 52, y: loneTop + 34 + Math.floor(i / cols) * 40, label: false }));
      height = loneTop + 34 + Math.ceil(lone.length / cols) * 40;
    }
    return { pos: pos, height: Math.max(height, 80), loneTop: loneTop, loneCount: lone.length, hasLinked: linked.length > 0 };
  }

  function graphLegend() {
    return '<ul class="knet-live-legend" aria-label="图例">' +
      Object.keys(GRAPH_STATUS).map(k => '<li><span class="knet-dot" data-status="' + esc(k) + '" aria-hidden="true"></span>' + esc(GRAPH_STATUS[k]) + '</li>').join('') +
      '<li><span class="knet-dot" data-status="pending" data-hint="1" aria-hidden="true"></span>可能过期</li>' +
      '<li><span class="knet-edge-key" data-kind="related" aria-hidden="true"></span>相关</li>' +
      '<li><span class="knet-edge-key" data-kind="duplicate" aria-hidden="true"></span>重复（指向标准卡）</li>' +
      '<li><span class="knet-edge-key" data-kind="replacement" aria-hidden="true"></span>被替代（指向新卡）</li>' +
      '</ul>';
  }

  function graphSVG(g) {
    const L = layoutGraph(g.nodes, g.links);
    const byId = new Map(g.nodes.map(n => [n.id, n]));
    const edges = g.links.filter(l => L.pos.has(l.from) && L.pos.has(l.to)).map(l => {
      const a = L.pos.get(l.from);
      const b = L.pos.get(l.to);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const ex = b.x - (dx / d) * 9;
      const ey = b.y - (dy / d) * 9;
      return '<line class="knet-edge" data-kind="' + esc(l.kind) + '" x1="' + num(a.x) + '" y1="' + num(a.y) + '" x2="' + num(ex) + '" y2="' + num(ey) + '"' +
        (l.kind === 'related' ? '' : ' marker-end="url(#knet-arrow)"') + '/>';
    }).join('');
    const dots = g.nodes.map(n => {
      const p = L.pos.get(n.id);
      if (!p) return '';
      const hint = n.stale_hint && n.status !== 'stale';
      const tip = n.title + ' · ' + (GRAPH_STATUS[n.status] || n.status) + (hint ? ' · 可能过期' : '') + (n.verified ? ' · ' + n.verified + ' 次验证成功' : '');
      return '<a class="knet-node" href="' + window.Commons.safeUrl(problemPath(n.id)) + '" data-status="' + esc(n.status) + '"' + (hint ? ' data-hint="1"' : '') + '>' +
        '<title>' + esc(tip) + '</title><circle cx="' + num(p.x) + '" cy="' + num(p.y) + '" r="7"/>' +
        (p.label ? '<text x="' + num(p.x) + '" y="' + num(p.y + 21) + '" text-anchor="middle">' + esc(shortText(byId.get(n.id).title, 9)) + '</text>' : '') +
        '</a>';
    }).join('');
    const caption = L.loneCount
      ? '<text class="knet-lone-cap" x="4" y="' + num(L.loneTop + 12) + '">' + esc(L.hasLinked ? '还没有关联的问题卡 ' + L.loneCount : '问题卡 ' + L.loneCount + ' 张，还没有互相关联') + '</text>'
      : '';
    return '<svg class="knet-live-svg" viewBox="0 0 ' + GRAPH_W + ' ' + num(L.height) + '" role="img" aria-label="问题库知识网：' + esc(g.nodes.length) + ' 张问题卡，' + esc(g.links.length) + ' 条关联">' +
      '<defs><marker id="knet-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 8 4 0 8z"/></marker></defs>' +
      caption + edges + dots + '</svg>';
  }

  function graphLinkList(g) {
    const title = new Map(g.nodes.map(n => [n.id, n.title]));
    const rows = g.links.slice(0, GRAPH_LIST_MAX).map(l =>
      '<li><a href="' + window.Commons.safeUrl(problemPath(l.from)) + '">' + esc(title.get(l.from) || '问题卡') + '</a> ' + esc(GRAPH_LINK[l.kind] || l.kind) +
      (l.kind === 'related' ? ' ' : '于 ') + '<a href="' + window.Commons.safeUrl(problemPath(l.to)) + '">' + esc(title.get(l.to) || '问题卡') + '</a></li>').join('');
    return g.links.length
      ? '<details class="knet-live-links"><summary>关联清单（' + esc(g.links.length) + '）</summary><ul>' + rows + '</ul>' +
        (g.links.length > GRAPH_LIST_MAX ? '<p class="knet-live-note">只列前 ' + GRAPH_LIST_MAX + ' 条。</p>' : '') + '</details>'
      : '';
  }

  function graphHTML(g) {
    const s = g.summary || {};
    return '<section class="knet-live-graph" aria-labelledby="knet-lg-title">' +
      '<div class="knet-live-graph-head"><div><h2 id="knet-lg-title">问题库知识网</h2>' +
      '<p class="knet-live-note">' + esc(s.total || 0) + ' 张问题卡 · ' + esc(g.links.length) + ' 条关联' +
      (s.truncated ? ' · 只画最近更新的 ' + esc(s.shown) + ' 张' : '') + '</p></div>' +
      '<a class="button tonal small" href="#/knowledge/govern">知识治理页</a></div>' +
      graphLegend() +
      '<div class="knet-live-graph-scroll">' + graphSVG(g) + '</div>' +
      graphLinkList(g) + '</section>';
  }

  function mountLiveGraph(host, alive) {
    if (!host) return;
    const slot = host.querySelector('[data-knet-graph]');
    if (!slot) return;
    window.CommonsAPI.get('/governance/knowledge-graph').then(res => {
      if (!alive()) return;
      const g = res && res.data;
      if (!g || !Array.isArray(g.nodes) || !g.nodes.length) { slot.innerHTML = ''; return; }
      g.links = Array.isArray(g.links) ? g.links : [];
      slot.innerHTML = graphHTML(g);
    }).catch(error => {
      if (!alive()) return;
      if (liveClosed(error) || (error && error.status === 404)) { slot.innerHTML = ''; return; }
      slot.innerHTML = '<p class="knet-live-note" role="status" data-knet-graph-error>知识网图谱没读出来。<button class="button ghost small" type="button" data-knet-graph-retry>重新读取</button></p>';
      const retry = slot.querySelector('[data-knet-graph-retry]');
      if (retry) retry.addEventListener('click', () => { slot.innerHTML = ''; mountLiveGraph(host, alive); });
    });
  }

  function governRow(n, extra) {
    return '<li class="knet-govern-row"><a href="' + window.Commons.safeUrl(problemPath(n.id)) + '">' + esc(n.title || '未命名问题') + '</a>' +
      '<span class="knet-govern-meta"><span class="knet-pill" data-status="' + esc(n.status) + '">' + esc(GRAPH_STATUS[n.status] || n.status) + '</span>' +
      (n.verified ? ' ' + esc(n.verified) + ' 次验证成功' : ' 还没有验证成功') + /* safe: extra 由 governHTML 逐值 esc 后拼成 */ (extra || '') + '</span></li>';
  }

  function governHTML(g) {
    const s = g.summary || {};
    const byId = new Map(g.nodes.map(n => [n.id, n]));
    const target = new Map();
    g.links.forEach(l => { if (l.kind === 'duplicate' || l.kind === 'replacement') target.set(l.kind + ':' + l.from, l.to); });
    const tiles = [['待验证', s.pending], ['已验证', s.verified], ['已过期', s.stale], ['可能过期', s.stale_hint]]
      .map(t => '<div class="knet-govern-tile"><strong class="knet-num">' + esc(t[1] || 0) + '</strong><span>' + esc(t[0]) + '</span></div>').join('');
    const groups = ATTENTION_GROUPS.map(def => {
      const rows = (g.attention || []).filter(a => a.reason === def[0] && byId.has(a.id)).map(a => {
        const n = byId.get(a.id);
        const kind = def[0] === 'duplicate' ? 'duplicate' : def[0] === 'replaced' ? 'replacement' : '';
        const to = kind && byId.get(target.get(kind + ':' + a.id));
        const extra = to ? ' · ' + (kind === 'duplicate' ? '重复于 ' : '被替代为 ') + '<a href="' + window.Commons.safeUrl(problemPath(to.id)) + '">' + esc(shortText(to.title, 24)) + '</a>' : '';
        return governRow(n, extra);
      });
      const label = def[0] === 'pending_long' ? '久未验证（超过 ' + (s.pending_days || 14) + ' 天）' : def[1];
      return rows.length
        ? '<section class="knet-govern-group" data-reason="' + esc(def[0]) + '"><h2>' + esc(label) + ' <span class="knet-num">' + rows.length + '</span></h2><p class="knet-live-note">' + esc(def[2]) + '</p><ul class="knet-govern-list">' + rows.join('') + '</ul></section>'
        : '';
    }).join('');
    return '<div class="knet-govern" data-knet-govern>' +
      '<div class="knet-govern-tiles" role="group" aria-label="问题库现状">' + tiles + '</div>' +
      (groups || '<div class="knet-state" data-state="empty"><h2>现在没有需要处理的问题卡</h2><p>过期、久未验证、重复和被替代的问题卡会列在这里。</p></div>') +
      (s.truncated ? '<p class="knet-live-note">只统计最近更新的 ' + esc(s.shown) + ' 张（共 ' + esc(s.total) + ' 张）。</p>' : '') +
      '<p class="knet-live-actions"><a class="button tonal" href="#/knowledge">看知识网</a> <a class="button tonal" href="#/solved">去问题库</a></p></div>';
  }

  function mountGovern(body, settle, fail, alive) {
    window.CommonsAPI.get('/governance/knowledge-graph').then(res => {
      if (!alive()) return;
      const g = res && res.data;
      settle();
      if (!g || !Array.isArray(g.nodes) || !g.nodes.length) {
        body.innerHTML = '<div class="knet-state" data-state="empty"><h2>问题库里还没有问题卡</h2><p>有了问题卡，这里才会列出需要处理的。</p><p><a class="button" href="#/solved">去问题库</a></p></div>';
        return;
      }
      g.links = Array.isArray(g.links) ? g.links : [];
      g.attention = Array.isArray(g.attention) ? g.attention : [];
      body.innerHTML = governHTML(g);
    }).catch(error => { if (alive()) fail(error); });
  }

  // 真实模式没有「整张知识网」的接口（kb 只有搜索和单题详情），所以先读知识条目列表；
  // 列表为空或读不出来，才露出原来的空状态。
  function liveEmptyHTML() {
    const m = /^#\/knowledge\/([^/?#]+)/.exec(String(location.hash || ''));
    const id = m ? decodeURIComponent(m[1]) : '';
    const head = id === 'govern'
      ? '<div class="page-head knet-head"><div class="knet-head-copy"><h1>知识治理</h1><p>问题库里哪些卡过期了、没人验证、重复了或被替代了，一页看完。</p></div></div>'
      : headHTML();
    return head +
      '<div data-knet-live' + (id ? ' data-id="' + esc(id) + '"' : '') + '>' +
      (id ? '' : '<div data-knet-graph></div>') +
      '<p class="knet-live-status" role="status">正在读取…</p>' +
      '<div hidden data-knet-live-empty>' +
      '<div class="knet-state" data-state="empty">' +
      '<h2>知识网还没长出来</h2>' +
      '<p>问题库和资源库有了内容之后，这里才会连成一张网。</p>' +
      '<p><a class="button" href="#/solved">去问题库</a> <a class="button tonal" href="#/skills">去资源库</a></p>' +
      '</div></div>' +
      '<div data-knet-live-body></div></div>';
  }

  const LIVE_TYPE = { social_post: '动态', market_listing: '市集帖', discussion: '讨论', knowledge: '知识条目', work: '作品', reply: '回复', agent_card: '智能体卡', problem: '问题', skill: '技能', prompt: '提示词', component_lib: '组件库', pattern: '模式', org_post: '团队动态' };
  const liveWhen = value => {
    const d = new Date(value);
    return !value || Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
  };
  const liveMeta = o => [LIVE_TYPE[o.type] || '内容', o.author && o.author.display_name, liveWhen(o.published_at || o.created_at)].filter(Boolean).map(esc).join(' · ');
  const liveClosed = e => !!e && (e.status === 501 || e.code === 'capability_unavailable');
  function liveRow(o) {
    return '<a class="knowledge-item" href="#/read/' + encodeURIComponent(o.id) + '"><h2>' + esc(o.title || '未命名') + '</h2>' +
      (o.excerpt ? '<p>' + esc(o.excerpt) + '</p>' : '') + '<small>' + liveMeta(o) + '</small></a>';
  }

  function mountLive() {
    const host = root && root.querySelector('[data-knet-live]');
    if (!host || !window.CommonsAPI) return;
    const token = ++liveToken;
    const alive = () => token === liveToken && host.isConnected;
    const id = host.getAttribute('data-id') || '';
    const status = host.querySelector('.knet-live-status');
    const empty = host.querySelector('[data-knet-live-empty]');
    const body = host.querySelector('[data-knet-live-body]');
    const settle = () => { if (status) status.remove(); };
    const showEmpty = () => { settle(); if (empty) empty.hidden = false; };
    const fail = error => {
      settle();
      body.innerHTML = liveClosed(error)
        ? '<div class="knet-state" data-state="empty"><h2>这个功能还没开放</h2></div>'
        : '<div class="knet-state" data-state="error" role="alert"><h2>没有读出来</h2><p>' + esc((error && error.message) || '请稍后再试。') + '</p><button class="button" type="button" data-knet-live-retry>重新读取</button></div>';
      const retry = body.querySelector('[data-knet-live-retry]');
      if (retry) retry.addEventListener('click', () => { body.innerHTML = '<p class="knet-live-status" role="status">正在读取…</p>'; mountLive(); });
    };
    if (id === 'govern') { mountGovern(body, settle, fail, alive); return; }
    if (!id) mountLiveGraph(host, alive);
    if (id) {
      window.CommonsAPI.get('/content/objects/' + encodeURIComponent(id)).then(res => {
        if (!alive()) return;
        const o = res.data || {};
        const content = o.content || {};
        settle();
        body.innerHTML = '<article class="knet-live-article"><p class="knet-kicker">' + liveMeta(o) + '</p><h2>' + esc(o.title || '未命名') + '</h2>' +
          (content.summary || o.excerpt ? '<p>' + esc(content.summary || o.excerpt) + '</p>' : '') +
          '<p><a class="button primary" href="#/read/' + encodeURIComponent(o.id || id) + '">阅读全文</a> <a class="button tonal" href="#/knowledge">回知识列表</a></p></article>';
      }).catch(error => {
        if (!alive()) return;
        if (error && (error.status === 404 || error.status === 403)) {
          settle();
          body.innerHTML = '<div class="knet-state" data-state="empty"><h2>没有找到这篇内容</h2><p>它可能还没发布或已被撤回，可以回知识网重新找。</p><p><a class="button" href="#/knowledge">回知识网</a></p></div>';
        } else fail(error);
      });
      return;
    }
    const load = cursor => window.CommonsAPI.get('/objects', Object.assign({ type: 'knowledge', limit: 30 }, cursor ? { cursor: cursor } : {})).then(res => {
      if (!alive()) return;
      const rows = Array.isArray(res.data) ? res.data : [];
      const more = res.meta && res.meta.next_cursor;
      if (!rows.length && !cursor) { showEmpty(); return; }
      settle();
      if (!cursor) {
        body.innerHTML = '<p class="knet-live-actions"><a class="button primary" href="#/write">写一篇</a> <a class="button tonal" href="#/solved">去问题库</a> <a class="button tonal" href="#/skills">去资源库</a></p>' +
          '<div class="knowledge-list" data-knet-live-rows></div><div data-knet-live-more></div>';
      }
      body.querySelector('[data-knet-live-rows]').insertAdjacentHTML('beforeend', rows.map(liveRow).join(''));
      const slot = body.querySelector('[data-knet-live-more]');
      slot.innerHTML = more ? '<button class="button" type="button">加载更多</button>' : '';
      const btn = slot.querySelector('button');
      if (btn) btn.addEventListener('click', () => { btn.disabled = true; load(more); });
    }).catch(error => { if (alive()) fail(error); });
    load(null);
  }

  function shell() {
    const m = model;
    if (isLive()) {
      return liveEmptyHTML();
    }
    if (!m) {
      return headHTML() + '<div class="knet-state" data-state="error"><h2>知识地图没有加载</h2><p>刷新后再试，其他内容不受影响。</p></div>';
    }
    if (!m.units.length) {
      return headHTML() + '<div class="knet-state" data-state="empty"><h2>这张网上还没有点</h2><p>数据接入后，这里会显示知识点。</p></div>';
    }
    return headHTML() +
      '<div class="knet-board">' +
      '<div class="knet-main">' +
      '<section class="knet-stage" aria-label="知识网">' +
      '<div class="knet-toolbar">' +
      '<div class="knet-search" id="knet-searchbox">' +
      '<span class="knet-search-icon">' + icon('search') + '</span>' +
      '<input id="knet-search" class="knet-search-input" type="text" role="combobox" aria-expanded="false" aria-controls="knet-results" aria-autocomplete="list" aria-label="搜索知识网" aria-keyshortcuts="/" placeholder="搜知识点、问题或工具" maxlength="80" autocomplete="off" spellcheck="false" enterkeyhint="search">' +
      '<button type="button" class="button ghost small icon-only knet-search-clear" data-knet="clear" aria-label="清空搜索" hidden>' + svg('M6 6l12 12M18 6 6 18') + '</button>' +
      '<kbd class="knet-enter" aria-hidden="true">/</kbd>' +
      '<div class="knet-results" id="knet-results" role="listbox" aria-label="搜索结果" hidden></div>' +
      '</div>' +
      '<button type="button" class="knet-switch" role="switch" aria-checked="false" data-knet="unresolved"><span class="knet-switch-track" aria-hidden="true"><span class="knet-switch-thumb"></span></span><span class="knet-switch-label">只看未解问题</span><b class="knet-switch-n">' + m.unresolved.size + '</b></button>' +
      segHTML() +
      '<div class="knet-subbar">' +
      '<div class="knet-nav" id="knet-nav"' + (state.selected || state.cluster || state.facet ? ' data-deep' : '') + (state.facet ? ' data-facet' : '') + '>' + crumbsHTML() + '</div>' +
      '<div class="knet-rels" role="group" aria-label="按关系看"' + (state.view === 'network' ? '' : ' hidden') + '><span class="knet-rels-label">关系</span>' + relChips() + '</div>' +
      '</div>' +
      '</div>' +
      '<div class="knet-views" data-view="' + state.view + '">' +
      '<div class="knet-canvas-wrap" id="knet-wrap" tabindex="0" role="group" aria-roledescription="知识网舞台" aria-label="知识网舞台。方向键换点，加减号缩放，F 看全图，Esc 退出选中" aria-describedby="knet-sowhat-text"' + (state.view === 'network' ? '' : ' hidden') + '>' +
      '<canvas id="knet-canvas" aria-hidden="true"></canvas>' +
      '<div class="knet-zoom" role="group" aria-label="缩放"><button type="button" class="button ghost small icon-only" data-knet="zoom-out" aria-label="缩小" aria-keyshortcuts="-">' + svg('M5 12h14') + '</button><span class="knet-zoom-pct knet-num" id="knet-zoom-pct" aria-live="off">100%</span><button type="button" class="button ghost small icon-only" data-knet="zoom-in" aria-label="放大" aria-keyshortcuts="+">' + svg('M12 5v14M5 12h14') + '</button><span class="knet-zoom-sep" aria-hidden="true"></span><button type="button" class="button ghost small icon-only" data-knet="fit" aria-label="看全图" aria-keyshortcuts="F">' + svg('M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5') + '</button></div>' +
      '<div class="knet-minimap" aria-hidden="true"><canvas id="knet-mini"></canvas></div>' +
      legendHTML() +
      '<div class="knet-peek" id="knet-peek" aria-hidden="true" hidden></div>' +
      '</div>' +
      '<div class="knet-matrix" id="knet-matrix"' + (state.view === 'matrix' ? '' : ' hidden') + '>' + (state.view === 'matrix' ? matrixHTML() : '') + '</div>' +
      '<div class="knet-list" id="knet-list"' + (state.view === 'list' ? '' : ' hidden') + '>' + (state.view === 'list' ? listHTML() : '') + '</div>' +
      '</div>' +
      timeHTML() +
      '</section>' +
      '<p class="knet-sowhat" id="knet-sowhat"><span class="knet-sowhat-k">所以呢</span><span id="knet-sowhat-text">' + esc(sowhat()) + '</span></p>' +
      '<nav class="knet-clusters" id="knet-clusters" aria-label="问题簇索引">' + clusterIndex() + '</nav>' +
      '</div>' +
      '<aside class="knet-card" id="knet-card" data-sheet="' + state.sheet + '" aria-label="知识卡">' +
      '<button type="button" class="knet-sheet-handle" data-knet="sheet" aria-expanded="' + (state.sheet === 'open') + '" aria-controls="knet-card-body" aria-label="' + (state.sheet === 'open' ? '收起知识卡' : '展开知识卡') + '"><span class="knet-grabber"></span></button>' +
      '<div class="knet-card-body" id="knet-card-body" data-key="' + esc(cardKey()) + '">' + cardHTML() + '</div>' +
      '</aside>' +
      '</div>' +
      '<div class="knet-sr" id="knet-live" aria-live="polite"></div>';
  }

  function viewHTML(id) {
    endMode = /[?&]motion=end\b/.test(location.search);
    reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    boot(id);
    const m = data();
    const mode = isLive() ? 'empty' : !m ? 'error' : !m.units.length ? 'empty' : 'default';
    return '<div class="knet' + (endMode ? ' is-end' : '') + '" data-knet-root data-state="' + mode + '">' + shell() + '</div>';
  }

  /* ---------- 局部刷新 ---------- */

  function patchCard(animate) {
    const body = root && root.querySelector('#knet-card-body');
    if (!body) return;
    const key = cardKey();
    if (body.dataset.key === key) return;
    body.dataset.key = key;
    body.innerHTML = cardHTML();
    body.scrollTop = 0;
    const card = root.querySelector('#knet-card');
    if (card) card.scrollTop = 0;
    if (animate === false || endMode || !body.animate) return;
    const pane = body.firstElementChild;
    if (!pane) return;
    const dy = reduced ? 0 : 6;
    pane.animate([{ opacity: 0, transform: 'translateY(' + dy + 'px)' }, { opacity: 1, transform: 'none' }], { duration: T.enter, easing: T.easeOutCss });
    [...pane.querySelectorAll('.knet-sec')].slice(0, 8).forEach((el, i) => {
      el.animate([{ opacity: 0, transform: 'translateY(' + dy + 'px)' }, { opacity: 1, transform: 'none' }], { duration: T.enter, delay: (i + 1) * T.stagger, easing: T.easeOutCss, fill: 'backwards' });
    });
  }

  function placeSegThumb(force) {
    const seg = root && root.querySelector('.knet-seg');
    if (!seg || (!force && seg.dataset.at === state.view)) return;
    seg.dataset.at = state.view;
    const on = seg.querySelector('[aria-checked="true"]');
    if (!on) return;
    seg.style.setProperty('--knet-seg-x', on.offsetLeft + 'px');
    seg.style.setProperty('--knet-seg-w', on.offsetWidth + 'px');
    seg.setAttribute('data-ready', '');
  }

  function patchViews() {
    if (!root) return;
    const views = root.querySelector('.knet-views');
    if (views) views.dataset.view = state.view;
    const w = root.querySelector('#knet-wrap');
    if (w) w.hidden = state.view !== 'network';
    const mx = root.querySelector('#knet-matrix');
    if (mx) {
      mx.hidden = state.view !== 'matrix';
      if (state.view === 'matrix') {
        const sx = mx.querySelector('.knet-mx-scroll');
        const keep = sx ? sx.scrollLeft : 0;
        mx.innerHTML = matrixHTML();
        const nx = mx.querySelector('.knet-mx-scroll');
        if (nx) nx.scrollLeft = keep;
      }
    }
    const ls = root.querySelector('#knet-list');
    if (ls) {
      ls.hidden = state.view !== 'list';
      if (state.view === 'list') {
        const sx = ls.querySelector('.knet-ls-scroll');
        const keep = sx ? sx.scrollLeft : 0;
        ls.innerHTML = listHTML();
        const nx = ls.querySelector('.knet-ls-scroll');
        if (nx) nx.scrollLeft = keep;
      }
    }
    const rels = root.querySelector('.knet-rels');
    if (rels) rels.hidden = state.view !== 'network';
    root.querySelectorAll('[data-knet="view"]').forEach(b => {
      const on = b.dataset.id === state.view;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    placeSegThumb();
  }

  function patchChrome() {
    if (!root || !model) return;
    const text = root.querySelector('#knet-sowhat-text');
    const next = sowhat();
    if (text && text.textContent !== next) {
      text.textContent = next;
      if (!endMode && text.animate) text.animate([{ opacity: 0 }, { opacity: 1 }], { duration: T.base, easing: T.easeOutCss });
    }
    root.querySelectorAll('[data-knet="rel"]').forEach(btn => {
      const on = btn.dataset.id === state.rel;
      btn.setAttribute('aria-pressed', String(on));
      btn.classList.toggle('selected', on);
    });
    const sw = root.querySelector('[data-knet="unresolved"]');
    if (sw) sw.setAttribute('aria-checked', String(state.unresolved));
    const idx = root.querySelector('#knet-clusters');
    if (idx) idx.innerHTML = clusterIndex();
    const clear = root.querySelector('[data-knet="clear"]');
    if (clear) clear.hidden = !state.query;
    const box = root.querySelector('#knet-searchbox');
    if (box) box.toggleAttribute('data-filled', !!state.query);
    const nav = root.querySelector('#knet-nav');
    if (nav) {
      nav.innerHTML = crumbsHTML();
      nav.toggleAttribute('data-deep', !!(state.selected || state.cluster || state.facet));
      nav.toggleAttribute('data-facet', !!state.facet);
    }
    const mt = root.querySelector('#knet-metrics');
    if (mt) {
      const key = state.range[1];
      if (mt.dataset.at !== String(key)) {
        mt.dataset.at = String(key);
        mt.innerHTML = metricsHTML(false);
      }
    }
    patchViews();
    patchTime();
    patchCard();
  }

  function patchTime() {
    const brush = root && root.querySelector('#knet-brush');
    if (!brush) return;
    const r = state.range;
    if (!brushDrag) {
      brush.style.setProperty('--knet-a', String(r[0]));
      brush.style.setProperty('--knet-b', String(r[1]));
    }
    brush.querySelectorAll('.knet-bar').forEach(b => {
      const i = Number(b.dataset.i);
      b.dataset.in = String(i >= r[0] && i <= r[1]);
    });
    brush.querySelectorAll('.knet-months span').forEach((s, i) => {
      s.dataset.in = String(i >= r[0] && i <= r[1]);
    });
    brush.querySelectorAll('.knet-handle').forEach(h => {
      const v = r[Number(h.dataset.edge)];
      h.setAttribute('aria-valuenow', String(v));
      h.setAttribute('aria-valuetext', model.months[v]);
    });
    const rt = root.querySelector('#knet-time-range');
    if (rt) rt.textContent = rangeText();
    const ct = root.querySelector('#knet-time-count');
    if (ct) ct.textContent = model.units.filter(baseVisible).length + ' 个点';
  }

  function announce(text) {
    const live = root && root.querySelector('#knet-live');
    if (live) live.textContent = text;
  }

  function setHash(id) {
    const next = id ? '#/knowledge/' + id : '#/knowledge';
    if (location.hash === next) return;
    try {
      history.replaceState(null, '', location.pathname + location.search + next);
    } catch {
      /* file:// 下个别浏览器不允许改地址，忽略 */
    }
  }

  /* ---------- 动作 ---------- */

  function canFly() {
    return state.view === 'network';
  }

  function select(id, opts) {
    const u = model.byId.get(id);
    if (!u) return;
    const o = opts || {};
    state.selected = id;
    state.cluster = '';
    state.unknown = '';
    if (u.mi < state.range[0] || u.mi > state.range[1]) state.range = [Math.min(state.range[0], u.mi), Math.max(state.range[1], u.mi)];
    if (state.unresolved && !isOpenAt(u, state.range[1])) state.unresolved = false;
    if (state.facet && (state.facet.cluster !== u.cluster || state.facet.status !== u.status)) state.facet = null;
    computeHits();
    setHash(id);
    retarget();
    startTween('flowSel', T.stage);
    if (o.fly !== false && canFly()) flyTo(selectTarget(id));
    patchChrome();
    announce('已选中：' + u.title + '，' + KIND_LABEL[u.kind] + '，' + STATUS_LABEL[u.status]);
    reveal(o.sheet);
  }

  function focusCluster(id, opts) {
    const c = model.cmap.get(id);
    if (!c) return;
    state.cluster = id;
    state.selected = '';
    state.unknown = '';
    if (state.facet && state.facet.cluster !== id) state.facet = null;
    setHash('');
    retarget();
    if (canFly()) flyTo(clusterTarget(id));
    patchChrome();
    announce('问题簇：' + c.label + '，' + c.members.length + ' 个点');
    reveal((opts || {}).sheet);
  }

  function backToGuide(fit, sheet) {
    state.selected = '';
    state.cluster = '';
    state.unknown = '';
    setHash('');
    retarget();
    if (fit !== false && canFly()) flyTo(hits && hits.length ? currentTarget() : fitTarget());
    patchChrome();
    announce('回到导览');
    reveal(sheet);
  }

  function goRoot() {
    state.facet = null;
    computeHits();
    backToGuide(true, 'peek');
  }

  function setFacet(cluster, status) {
    const same = state.facet && state.facet.cluster === cluster && state.facet.status === status;
    state.facet = same ? null : { cluster, status };
    state.selected = '';
    state.cluster = '';
    state.unknown = '';
    setHash('');
    computeHits();
    retarget(T.enter);
    if (!same) setView('network', true);
    patchChrome();
    if (canFly()) flyTo(currentTarget());
    const c = model.cmap.get(cluster);
    announce(state.facet ? '只看「' + (c ? c.label : '') + '」里' + STATUS_LABEL[status] + '的 ' + model.units.filter(baseVisible).length + ' 个点' : '清除了筛选');
  }

  function setView(v, quiet) {
    if (!VIEWS.some(x => x[0] === v) || state.view === v) return;
    state.view = v;
    closePeek();
    if (v === 'network') {
      hoverId = '';
      patchViews();
      measureCorners();
      if (sizeCanvas()) syncPanMode();
      delete tweens.cam;
      cam = currentTarget();
      syncPanMode();
      kick();
    } else {
      patchViews();
    }
    if (!quiet) {
      patchChrome();
      announce('切到' + VIEWS.find(x => x[0] === v)[1] + '视图');
    }
  }

  function setRange(a, b, quiet) {
    const last = model.months.length - 1;
    let r0 = clamp(Math.round(a), 0, last);
    let r1 = clamp(Math.round(b), 0, last);
    if (r0 > r1) [r0, r1] = [r1, r0];
    if (r0 === state.range[0] && r1 === state.range[1]) return;
    const grew = r1 > state.range[1] ? r1 : -1;
    state.range = [r0, r1];
    computeHits();
    retarget(T.enter);
    patchChrome();
    if (!quiet) announce('时间范围 ' + rangeText() + '，' + model.units.filter(baseVisible).length + ' 个点');
    const bar = grew >= 0 && root && root.querySelector('.knet-bar[data-i="' + grew + '"] i');
    if (bar && bar.animate && !endMode && !reduced) bar.animate([{ transform: 'scaleY(1)' }, { transform: 'scaleY(1.12)' }, { transform: 'scaleY(1)' }], { duration: T.base, easing: T.easeOutCss });
  }

  function stopReplay() {
    if (replayTimer) clearTimeout(replayTimer);
    timers = timers.filter(t => t !== replayTimer);
    replayTimer = 0;
    state.playing = false;
    const btn = root && root.querySelector('[data-knet="replay"]');
    if (btn) {
      btn.setAttribute('aria-pressed', 'false');
      btn.querySelector('span').textContent = '回放';
    }
  }

  // 回放：用户点了才放，从第一个月一路长到最后一个月，放完停住。
  function startReplay() {
    stopReplay();
    const last = model.months.length - 1;
    if (endMode) {
      setRange(0, last);
      return;
    }
    state.playing = true;
    const btn = root.querySelector('[data-knet="replay"]');
    if (btn) {
      btn.setAttribute('aria-pressed', 'true');
      btn.querySelector('span').textContent = '停止';
    }
    if (!state.selected && !state.cluster && canFly()) flyTo(fitTarget());
    let i = 0;
    setRange(0, 0);
    const tick = () => {
      i += 1;
      setRange(0, i, i < last);
      if (i >= last) {
        stopReplay();
        announce('回放完了：' + model.months[0] + ' 到 ' + model.months[last] + '，网上长出 ' + model.units.length + ' 个点');
        return;
      }
      replayTimer = setTimeout(tick, T.stage + T.layout);
      timers.push(replayTimer);
    };
    replayTimer = setTimeout(tick, T.stage + T.layout);
    timers.push(replayTimer);
  }

  function applyQuery(value, frame) {
    state.query = String(value || '').slice(0, 80);
    computeHits();
    if (state.query && (state.selected || state.cluster)) {
      state.selected = '';
      state.cluster = '';
      setHash('');
    }
    retarget();
    patchChrome();
    renderResults();
    if (frame) flyTo(currentTarget());
  }

  function renderResults() {
    const box = root && root.querySelector('#knet-results');
    const input = root && root.querySelector('#knet-search');
    if (!box || !input) return;
    const q = state.query.trim();
    const open = !!q && document.activeElement === input;
    box.hidden = !open;
    input.setAttribute('aria-expanded', String(open));
    if (!open) {
      input.removeAttribute('aria-activedescendant');
      return;
    }
    if (!hits || !hits.length) {
      const near = nearestCluster(q);
      box.innerHTML = '<p class="knet-results-head">还没人问过这个</p>' + (near ? '<button type="button" class="knet-result knet-result-near" data-knet="cluster" data-id="' + esc(near.id) + '" data-cat="' + esc(near.cat) + '"><i class="knet-dot"></i><span><b>去最近的一簇：' + esc(near.label) + '</b><small>' + near.members.length + ' 个点，可能有相近的问题</small></span></button>' : '');
      input.removeAttribute('aria-activedescendant');
      return;
    }
    activeResult = clamp(activeResult, 0, Math.min(hits.length, 5) - 1);
    box.innerHTML = '<p class="knet-results-head">接得上 ' + hits.length + ' 个点<span>↑↓ 选 · ↵ 飞过去</span></p>' + hits.slice(0, 5).map((u, i) => {
      const c = clusterOf(u);
      return '<button type="button" role="option" id="knet-opt-' + i + '" class="knet-result" data-knet="select" data-id="' + esc(u.id) + '" data-cat="' + esc(u.cat) + '" aria-selected="' + (i === activeResult) + '" tabindex="-1">' + stateIcon(u.kind, 16) + '<span><b>' + esc(u.title) + '</b><small>' + esc(KIND_LABEL[u.kind] + ' · ' + (c ? c.label : '') + ' · 佐证 ' + u.corroboration + ' 人') + '</small></span></button>';
    }).join('');
    input.setAttribute('aria-activedescendant', 'knet-opt-' + activeResult);
  }

  function closeResults() {
    const box = root && root.querySelector('#knet-results');
    const input = root && root.querySelector('#knet-search');
    if (box) box.hidden = true;
    if (input) {
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
    }
  }

  function cssLen(name, fallback) {
    if (!root) return fallback;
    const el = document.createElement('i');
    el.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;height:0;width:var(' + name + ')';
    root.appendChild(el);
    const v = el.getBoundingClientRect().width;
    el.remove();
    return v || fallback;
  }

  // 手机知识卡已进入文档流，不再为底部抽屉预留舞台高度。
  function fitStage() {
    if (root) root.style.removeProperty('--knet-stage-h');
  }

  function isSheet() {
    return !!(window.matchMedia && window.matchMedia('(max-width: 760px)').matches);
  }

  // 保留知识卡状态接口，兼容既有选择与返回动作；手机布局本身不再浮动。
  function reveal(mode) {
    if (mode && isSheet() && state.sheet !== mode) setSheet(mode);
  }

  function setSheet(mode) {
    state.sheet = mode;
    const card = root && root.querySelector('#knet-card');
    if (!card) return;
    card.dataset.sheet = mode;
    card.style.removeProperty('transform');
    const handle = card.querySelector('[data-knet="sheet"]');
    if (handle) {
      handle.setAttribute('aria-expanded', String(mode === 'open'));
      handle.setAttribute('aria-label', mode === 'open' ? '收起知识卡' : '展开知识卡');
    }
  }

  /* ---------- 悬停预览 ---------- */

  function closePeek() {
    showPeek(null);
  }

  function showPeek(u) {
    const peek = root && root.querySelector('#knet-peek');
    if (!peek) return;
    if (!u || coarse) {
      peek.hidden = true;
      peek.removeAttribute('data-open');
      return;
    }
    const c = clusterOf(u);
    peek.dataset.cat = String(u.cat);
    peek.innerHTML = '<p class="knet-peek-kind">' + stateIcon(u.kind, 14) + esc(KIND_LABEL[u.kind]) + '<span>' + esc(c ? c.label : '') + '</span></p>' +
      '<b class="knet-peek-title">' + esc(u.title) + '</b>' +
      '<p class="knet-peek-meta">' + statusBadge(u.status) + (model.unresolved.has(u.id) ? statusBadge('open') : '') + flagsHTML(u) + '</p>' +
      '<p class="knet-peek-nums"><span>佐证 <b>' + esc(u.corroboration) + '</b> 人</span><span>近 30 天被问 <b>' + esc(u.asked30d) + '</b> 次</span><span>关系 <b>' + esc(u.deg) + '</b></span><span>' + esc(u.month) + '</span></p>';
    peek.hidden = false;
    const pw = peek.offsetWidth || 240;
    const ph = peek.offsetHeight || 90;
    let x = u.sx + u.sr + 14;
    if (x + pw > cssW - 8) x = u.sx - u.sr - 14 - pw;
    const y = clamp(u.sy - ph / 2, 8, cssH - ph - 8);
    peek.style.left = Math.max(8, x) + 'px';
    peek.style.top = y + 'px';
    requestAnimationFrame(() => { if (peek.isConnected && !peek.hidden) peek.dataset.open = 'true'; });
  }

  /* ---------- 事件 ---------- */

  function canvasPoint(event) {
    const box = canvas.getBoundingClientRect();
    return [event.clientX - box.left, event.clientY - box.top];
  }

  function hitAt(x, y) {
    const pad = coarse ? 12 : 5;
    let best = '';
    let bestD = Infinity;
    model.units.forEach(u => {
      if (u.at <= 0) return;
      const r = Math.max(u.sr + pad, coarse ? 22 : 10);
      const d = (u.sx - x) * (u.sx - x) + (u.sy - y) * (u.sy - y);
      if (d <= r * r && d < bestD) {
        bestD = d;
        best = u.id;
      }
    });
    return best;
  }

  function clusterAt(x, y) {
    for (const c of model.clusters) {
      const pts = c.pts;
      if (!pts || !c.sbox) continue;
      if (x < c.sbox[0] || x > c.sbox[2] || y < c.sbox[1] || y > c.sbox[3]) continue;
      let inside = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const xi = pts[i][0];
        const yi = pts[i][1];
        const xj = pts[j][0];
        const yj = pts[j][1];
        if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
      }
      if (inside) return c.id;
    }
    return '';
  }

  function setHover(id, clusterId) {
    if (id === hoverId && clusterId === hoverCluster) return;
    const changedNode = id !== hoverId;
    hoverId = id;
    hoverCluster = id ? '' : clusterId;
    if (canvas) canvas.style.cursor = id || clusterId ? 'pointer' : '';
    if (changedNode) {
      retarget(T.fast);
      if (id) startTween('flowHover', T.stage);
      showPeek(id ? model.byId.get(id) : null);
    } else kick();
  }

  function onPointerDown(event) {
    if (!canvas || event.button > 0) return;
    const p = canvasPoint(event);
    drag = { x: p[0], y: p[1], cx: cam.x, cy: cam.y, moved: false, id: event.pointerId };
  }

  function onPointerMove(event) {
    if (!canvas) return;
    const p = canvasPoint(event);
    if (drag && drag.id === event.pointerId && (event.buttons & 1 || event.pointerType === 'touch')) {
      const dx = p[0] - drag.x;
      const dy = p[1] - drag.y;
      const canPan = event.pointerType !== 'touch' || wrap.hasAttribute('data-zoomed');
      if (!drag.moved && Math.hypot(dx, dy) > 5 && canPan) {
        drag.moved = true;
        try { canvas.setPointerCapture(event.pointerId); } catch { /* ignore */ }
        wrap.setAttribute('data-panning', '');
        setHover('', '');
      }
      if (drag.moved) {
        delete tweens.cam;
        cam.x = drag.cx - dx / cam.k;
        cam.y = drag.cy - dy / cam.k;
        clampCam();
        kick();
        return;
      }
    }
    if (event.pointerType === 'touch') return;
    const id = hitAt(p[0], p[1]);
    setHover(id, id ? '' : clusterAt(p[0], p[1]));
  }

  function onPointerUp(event) {
    if (!drag || drag.id !== event.pointerId) return;
    const was = drag;
    drag = null;
    wrap.removeAttribute('data-panning');
    if (was.moved) {
      syncPanMode();
      return;
    }
    const p = canvasPoint(event);
    const id = hitAt(p[0], p[1]);
    if (id) {
      select(id, { sheet: 'open' });
      return;
    }
    const c = clusterAt(p[0], p[1]);
    if (c) {
      if (c !== state.cluster || state.selected) focusCluster(c, { sheet: 'open' });
      else reveal('open');
      return;
    }
    if (state.selected || state.cluster) backToGuide(true, 'peek');
  }

  function onPointerLeave() {
    if (drag && drag.moved) return;
    setHover('', '');
  }

  function onWheel(event) {
    if (!wrap) return;
    const engaged = event.ctrlKey || event.metaKey || document.activeElement === wrap;
    if (!engaged) return;
    event.preventDefault();
    const p = canvasPoint(event);
    zoomBy(Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.0016)), p[0], p[1]);
  }

  function nearestInDir(id, dx, dy) {
    const vis = model.units.filter(u => u.at > 0);
    const cur = model.byId.get(id);
    if (!cur || cur.at <= 0) {
      const sorted = vis.slice().sort((a, b) => Math.hypot(a.sx - cssW / 2, a.sy - cssH / 2) - Math.hypot(b.sx - cssW / 2, b.sy - cssH / 2));
      return sorted[0] ? sorted[0].id : '';
    }
    let best = '';
    let score = Infinity;
    vis.forEach(u => {
      if (u.id === id) return;
      const vx = u.sx - cur.sx;
      const vy = u.sy - cur.sy;
      const dot = vx * dx + vy * dy;
      if (dot <= 0) return;
      const dist = Math.hypot(vx, vy);
      const s = dist * (2 - dot / dist);
      if (s < score) {
        score = s;
        best = u.id;
      }
    });
    return best;
  }

  function onKey(event) {
    if (!root) return;
    const t = event.target;
    if (t && t.id === 'knet-search') return onSearchKey(event);
    if (t && t.classList && t.classList.contains('knet-handle')) return onHandleKey(event);
    if (t && t.dataset && t.dataset.knet === 'view') return onSegKey(event);
    if (t && t.tagName === 'TR' && t.dataset.knet === 'select' && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      select(t.dataset.id, { sheet: 'open' });
      return;
    }
    if (t !== wrap) return;
    const map = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (map[event.key]) {
      event.preventDefault();
      const next = nearestInDir(state.selected, map[event.key][0], map[event.key][1]);
      if (next) select(next);
    } else if (event.key === '0') {
      event.preventDefault();
      flyTo(fitTarget());
    }
  }

  // 全页快捷键：/ 搜索，F 全图，+ / - 缩放，Esc 退出选中。输入框里、弹层开着、带修饰键时不抢。
  function onGlobalKey(event) {
    if (!root || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return;
    const t = event.target;
    const typing = t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
    if (typing) return;
    if (document.querySelector('dialog[open], [aria-modal="true"]:not([hidden])')) return;
    const k = event.key;
    if (k === '/') {
      event.preventDefault();
      const input = root.querySelector('#knet-search');
      if (input) {
        input.focus();
        input.select();
      }
    } else if (k === 'f' || k === 'F') {
      event.preventDefault();
      if (state.view !== 'network') setView('network');
      flyTo(fitTarget());
      syncPanModeLater();
    } else if ((k === '+' || k === '=') && state.view === 'network') {
      event.preventDefault();
      zoomBy(1.3);
    } else if ((k === '-' || k === '_') && state.view === 'network') {
      event.preventDefault();
      zoomBy(1 / 1.3);
    } else if (k === 'Escape' && (state.selected || state.cluster || state.facet)) {
      event.preventDefault();
      if (state.selected || state.cluster) backToGuide(true, 'peek');
      else setFacet(state.facet.cluster, state.facet.status);
    }
  }

  function onSegKey(event) {
    const order = VIEWS.map(v => v[0]);
    const i = order.indexOf(state.view);
    let j = -1;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') j = (i + 1) % order.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') j = (i + order.length - 1) % order.length;
    if (j < 0) return;
    event.preventDefault();
    setView(order[j]);
    const b = root.querySelector('[data-knet="view"][data-id="' + order[j] + '"]');
    if (b) b.focus();
  }

  function onHandleKey(event) {
    const edge = Number(event.target.dataset.edge);
    const last = model.months.length - 1;
    const r = state.range.slice();
    let v = r[edge];
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown' || event.key === 'PageDown') v -= 1;
    else if (event.key === 'ArrowRight' || event.key === 'ArrowUp' || event.key === 'PageUp') v += 1;
    else if (event.key === 'Home') v = 0;
    else if (event.key === 'End') v = last;
    else return;
    event.preventDefault();
    stopReplay();
    v = clamp(v, edge ? r[0] : 0, edge ? last : r[1]);
    r[edge] = v;
    setRange(r[0], r[1]);
  }

  // 时间轴框选：按在把手上就拖那一端，按在别处就从那个月重新框一段。
  function brushPos(event) {
    const rail = root.querySelector('#knet-brush .knet-rail');
    const box = rail.getBoundingClientRect();
    const n = model.months.length;
    return clamp((event.clientX - box.left) / box.width * n - 0.5, 0, n - 1);
  }

  function onBrushDown(event) {
    const brush = event.target.closest && event.target.closest('#knet-brush');
    if (!brush || event.button > 0) return;
    event.preventDefault();
    stopReplay();
    const f = brushPos(event);
    const hd = event.target.closest('.knet-handle');
    let edge;
    let anchor;
    if (hd) {
      edge = Number(hd.dataset.edge);
      anchor = state.range[1 - edge];
    } else {
      edge = 1;
      anchor = Math.round(f);
    }
    try { brush.setPointerCapture(event.pointerId); } catch { /* ignore */ }
    brushDrag = { id: event.pointerId, anchor, moved: false, x: event.clientX };
    brush.setAttribute('data-dragging', '');
    (hd || brush.querySelector('.knet-handle[data-edge="1"]')).focus({ preventScroll: true });
    if (!hd) {
      brush.style.setProperty('--knet-a', String(anchor));
      brush.style.setProperty('--knet-b', String(anchor));
      setRange(anchor, anchor, true);
    }
  }

  function onBrushMove(event) {
    if (!brushDrag || brushDrag.id !== event.pointerId) return;
    if (Math.abs(event.clientX - brushDrag.x) > 3) brushDrag.moved = true;
    const brush = root.querySelector('#knet-brush');
    const f = brushPos(event);
    const a = Math.min(brushDrag.anchor, f);
    const b = Math.max(brushDrag.anchor, f);
    brush.style.setProperty('--knet-a', a.toFixed(3));
    brush.style.setProperty('--knet-b', b.toFixed(3));
    setRange(Math.min(brushDrag.anchor, Math.round(f)), Math.max(brushDrag.anchor, Math.round(f)), true);
  }

  function onBrushUp(event) {
    if (!brushDrag || brushDrag.id !== event.pointerId) return;
    brushDrag = null;
    const brush = root.querySelector('#knet-brush');
    brush.removeAttribute('data-dragging');
    patchTime();
    announce('时间范围 ' + rangeText() + '，' + model.units.filter(baseVisible).length + ' 个点');
  }

  // 小地图：按下或拖动，把镜头中心挪到那里
  function onMiniDown(event) {
    const mm = miniMap();
    if (!mm || event.button > 0) return;
    event.preventDefault();
    try { mm.mc.setPointerCapture(event.pointerId); } catch { /* ignore */ }
    miniDrag = { id: event.pointerId };
    onMiniMove(event);
  }

  function onMiniMove(event) {
    if (!miniDrag || miniDrag.id !== event.pointerId) return;
    const mm = miniMap();
    if (!mm) return;
    const box = mm.mc.getBoundingClientRect();
    delete tweens.cam;
    cam = { x: (event.clientX - box.left - mm.ox) / mm.k, y: (event.clientY - box.top - mm.oy) / mm.k, k: cam.k };
    clampCam();
    syncPanMode();
    kick();
  }

  function onMiniUp(event) {
    if (miniDrag && miniDrag.id === event.pointerId) miniDrag = null;
  }

  function onSearchKey(event) {
    const n = hits ? Math.min(hits.length, 5) : 0;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!n) return;
      event.preventDefault();
      activeResult = (activeResult + (event.key === 'ArrowDown' ? 1 : -1) + n) % n;
      renderResults();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (searchTimer) {
        clearTimeout(searchTimer);
        searchTimer = 0;
        applyQuery(event.target.value, false);
      }
      if (hits && hits.length) {
        const u = hits[activeResult] || hits[0];
        closeResults();
        select(u.id, { sheet: 'open' });
      } else if (state.query.trim()) {
        const near = nearestCluster(state.query);
        closeResults();
        if (near) flyTo(clusterTarget(near.id));
      }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      const box = root.querySelector('#knet-results');
      if (box && !box.hidden) closeResults();
      else {
        event.target.value = '';
        applyQuery('', true);
      }
    }
  }

  function onSheetDown(event) {
    const handle = event.target.closest && event.target.closest('[data-knet="sheet"]');
    if (!handle || !isSheet()) return;
    const card = root.querySelector('#knet-card');
    try { handle.setPointerCapture(event.pointerId); } catch { /* ignore */ }
    const box = card.getBoundingClientRect();
    const peekH = cssLen('--knet-peek', 128);
    const base = state.sheet === 'open' ? 0 : box.height - peekH;
    sheetDrag = { id: event.pointerId, y: event.clientY, base, max: box.height - peekH, dy: 0, t: performance.now() };
    card.setAttribute('data-dragging', '');
  }

  function onSheetMove(event) {
    if (!sheetDrag || sheetDrag.id !== event.pointerId) return;
    const card = root.querySelector('#knet-card');
    sheetDrag.dy = event.clientY - sheetDrag.y;
    const y = clamp(sheetDrag.base + sheetDrag.dy, 0, sheetDrag.max);
    card.style.transform = 'translateY(' + y + 'px)';
  }

  function onSheetUp(event) {
    if (!sheetDrag || sheetDrag.id !== event.pointerId) return;
    const d = sheetDrag;
    sheetDrag = null;
    const card = root.querySelector('#knet-card');
    card.removeAttribute('data-dragging');
    if (Math.abs(d.dy) < 6) {
      setSheet(state.sheet === 'open' ? 'peek' : 'open');
      return;
    }
    const v = d.dy / Math.max(1, performance.now() - d.t);
    const y = d.base + d.dy;
    setSheet(v < -0.4 || (v <= 0.4 && y < d.max / 2) ? 'open' : 'peek');
  }

  function onClick(event) {
    const btn = event.target.closest('[data-knet]');
    if (!btn || !root.contains(btn) || btn.disabled) return;
    const act = btn.dataset.knet;
    if (act === 'select') {
      event.preventDefault();
      const inSheet = !!btn.closest('#knet-card');
      if (btn.closest('#knet-results')) closeResults();
      select(btn.dataset.id, { sheet: inSheet ? 'peek' : 'open' });
      if (inSheet && isSheet() && wrap) {
        const r = wrap.getBoundingClientRect();
        if (r.bottom < 80 || r.top > innerHeight * 0.5) wrap.scrollIntoView({ block: 'start', behavior: reduced || endMode ? 'auto' : 'smooth' });
      }
    } else if (act === 'cluster') {
      event.preventDefault();
      if (btn.closest('#knet-results')) closeResults();
      focusCluster(btn.dataset.id, { sheet: btn.closest('#knet-card') ? '' : 'open' });
    } else if (act === 'guide') {
      event.preventDefault();
      backToGuide();
    } else if (act === 'unresolved' || act === 'unresolved-on') {
      event.preventDefault();
      state.unresolved = act === 'unresolved-on' ? true : !state.unresolved;
      if (state.unresolved && state.selected && !model.unresolved.has(state.selected)) {
        state.selected = '';
        setHash('');
      }
      computeHits();
      retarget(T.enter);
      if (!state.selected && !state.cluster) flyTo(fitTarget());
      patchChrome();
      announce(state.unresolved ? '只看没人接住的 ' + model.unresolved.size + ' 个问题' : '显示全部知识点');
    } else if (act === 'rel') {
      event.preventDefault();
      state.rel = state.rel === btn.dataset.id ? '' : btn.dataset.id;
      retarget();
      if (state.selected) startTween('flowSel', T.stage);
      patchChrome();
      announce(state.rel ? '只看「' + REL_LABEL[state.rel] + '」关系' : '显示全部关系');
    } else if (act === 'clear') {
      event.preventDefault();
      const input = root.querySelector('#knet-search');
      if (input) {
        input.value = '';
        input.focus();
      }
      applyQuery('', true);
    } else if (act === 'replay') {
      event.preventDefault();
      if (state.playing) stopReplay();
      else startReplay();
    } else if (act === 'zoom-in') {
      event.preventDefault();
      zoomBy(1.35);
    } else if (act === 'zoom-out') {
      event.preventDefault();
      zoomBy(1 / 1.35);
    } else if (act === 'fit') {
      event.preventDefault();
      flyTo(fitTarget());
      syncPanModeLater();
    } else if (act === 'sheet') {
      event.preventDefault();
      if (event.detail === 0) setSheet(state.sheet === 'open' ? 'peek' : 'open');
    } else if (act === 'view') {
      event.preventDefault();
      setView(btn.dataset.id);
    } else if (act === 'sort') {
      event.preventDefault();
      const k = btn.dataset.id;
      state.sort = state.sort.key === k ? { key: k, dir: -state.sort.dir } : { key: k, dir: k === 'title' || k === 'cluster' || k === 'kind' || k === 'status' ? 1 : -1 };
      patchViews();
      const th = root.querySelector('.knet-th[data-id="' + k + '"]');
      if (th) th.focus({ preventScroll: true });
      announce('按「' + SORTS[k] + '」' + (state.sort.dir > 0 ? '升序' : '降序') + '排列');
    } else if (act === 'facet') {
      event.preventDefault();
      setFacet(btn.dataset.id, btn.dataset.status);
    } else if (act === 'facet-clear') {
      event.preventDefault();
      if (state.facet) setFacet(state.facet.cluster, state.facet.status);
    } else if (act === 'crumb-root') {
      event.preventDefault();
      goRoot();
    } else if (act === 'crumb-cluster') {
      event.preventDefault();
      focusCluster(btn.dataset.id);
    } else if (act === 'legend') {
      event.preventDefault();
      state.legend = !state.legend;
      const lg = root.querySelector('#knet-legend');
      const body = root.querySelector('#knet-legend-body');
      if (lg) lg.dataset.open = String(state.legend);
      if (body) body.hidden = !state.legend;
      btn.setAttribute('aria-expanded', String(state.legend));
      measureCorners();
      kick();
    }
  }

  function syncPanModeLater() {
    const t = setTimeout(syncPanMode, (endMode || reduced ? 0 : T.stage) + 20);
    timers.push(t);
  }

  function onInput(event) {
    if (event.target.id !== 'knet-search') return;
    activeResult = 0;
    const value = event.target.value;
    if (searchTimer) clearTimeout(searchTimer);
    state.query = String(value || '').slice(0, 80);
    const clear = root.querySelector('[data-knet="clear"]');
    if (clear) clear.hidden = !state.query;
    searchTimer = setTimeout(() => {
      searchTimer = 0;
      applyQuery(value, true);
    }, endMode ? 0 : 140);
    timers.push(searchTimer);
  }

  function onFocusIn(event) {
    if (event.target && event.target.id === 'knet-search') renderResults();
  }

  function onDocDown(event) {
    if (!root) return;
    const box = root.querySelector('#knet-searchbox');
    if (box && !box.contains(event.target)) closeResults();
  }

  function listen(node, name, fn, options) {
    node.addEventListener(name, fn, options);
    cleanup.push(() => node.removeEventListener(name, fn, options));
  }

  /* ---------- 生命周期 ---------- */

  function mount() {
    destroy();
    root = document.querySelector('[data-knet-root]');
    if (!root || !state) return;
    if (isLive()) { mountLive(); return; }
    const m = data();
    if (!m) return;
    endMode = /[?&]motion=end\b/.test(location.search);
    const mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    reduced = !!(mq && mq.matches);
    coarse = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
    T = readTokens();
    wrap = root.querySelector('#knet-wrap');
    canvas = root.querySelector('#knet-canvas');
    ctx = canvas && canvas.getContext ? canvas.getContext('2d') : null;
    if (canvas && !ctx) {
      root.setAttribute('data-state', 'error');
      const body = root.querySelector('#knet-card-body');
      if (body) body.innerHTML = '<div class="knet-pane" data-state="error"><h2 class="knet-pane-title">这个浏览器无法显示知识网</h2><p class="knet-pane-lede">刷新后再试，下面的问题簇和知识卡仍可用。</p></div>';
    }
    listen(root, 'click', onClick);
    listen(root, 'input', onInput);
    listen(root, 'keydown', onKey);
    listen(root, 'focusin', onFocusIn);
    listen(document, 'pointerdown', onDocDown);
    listen(document, 'keydown', onGlobalKey);
    const brush = root.querySelector('#knet-brush');
    if (brush) {
      listen(brush, 'pointerdown', onBrushDown);
      listen(brush, 'pointermove', onBrushMove);
      listen(brush, 'pointerup', onBrushUp);
      listen(brush, 'pointercancel', onBrushUp);
    }
    const mini = root.querySelector('#knet-mini');
    if (mini) {
      listen(mini, 'pointerdown', onMiniDown);
      listen(mini, 'pointermove', onMiniMove);
      listen(mini, 'pointerup', onMiniUp);
      listen(mini, 'pointercancel', onMiniUp);
    }
    const handle = root.querySelector('[data-knet="sheet"]');
    if (handle) {
      listen(handle, 'pointerdown', onSheetDown);
      listen(handle, 'pointermove', onSheetMove);
      listen(handle, 'pointerup', onSheetUp);
      listen(handle, 'pointercancel', onSheetUp);
    }
    if (canvas && ctx) {
      listen(canvas, 'pointerdown', onPointerDown);
      listen(canvas, 'pointermove', onPointerMove);
      listen(canvas, 'pointerup', onPointerUp);
      listen(canvas, 'pointercancel', onPointerUp);
      listen(canvas, 'pointerleave', onPointerLeave);
      listen(wrap, 'wheel', onWheel, { passive: false });
    }
    if (mq) {
      const onMotion = () => { reduced = mq.matches; };
      if (mq.addEventListener) listen(mq, 'change', onMotion);
    }
    if (!ctx) return;
    fitStage();
    listen(window, 'resize', fitStage);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (root && wrap) fitStage(); });
    sizeCanvas();
    computeHits();
    model.units.forEach(u => {
      const v = baseVisible(u) ? 1 : 0;
      u.a = v;
      u.af = v;
      u.at = v;
      u.grow = 1;
    });
    cam = fitTarget();
    retarget(0);
    if (state.selected) {
      startTween('flowSel', T.stage);
      flyTo(selectTarget(state.selected));
    }
    syncPanModeLater();
    placeSegThumb(true);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (root) placeSegThumb(true); });
    const stat = root.querySelector('#knet-stat-num');
    if (stat && stat.dataset.roll === 'true') startTween('stat', T.stage);
    const onResize = () => {
      placeSegThumb(true);
      if (!sizeCanvas()) return;
      delete tweens.cam;
      cam = currentTarget();
      syncPanMode();
      kick();
    };
    const foot = document.querySelector('.app-footer');
    if (foot && window.IntersectionObserver) {
      const io = new IntersectionObserver(entries => {
        const card = root && root.querySelector('#knet-card');
        if (card) card.toggleAttribute('data-tuck', entries.some(e => e.isIntersecting));
      });
      io.observe(foot);
      cleanup.push(() => io.disconnect());
    }
    if (window.ResizeObserver && wrap) {
      const ro = new ResizeObserver(onResize);
      ro.observe(wrap);
      cleanup.push(() => ro.disconnect());
    } else listen(window, 'resize', onResize);
    draw(performance.now());
  }

  function destroy() {
    cleanup.forEach(fn => {
      try { fn(); } catch { /* ignore */ }
    });
    cleanup = [];
    timers.forEach(t => clearTimeout(t));
    timers = [];
    replayTimer = 0;
    searchTimer = 0;
    liveToken += 1;
    if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
    if (root) lastLeave = performance.now();
    tweens = {};
    root = null;
    canvas = null;
    ctx = null;
    wrap = null;
    hoverId = '';
    hoverCluster = '';
    drag = null;
    brushDrag = null;
    miniDrag = null;
    sheetDrag = null;
    litSel = [];
    litHover = [];
    cssW = 0;
    cssH = 0;
    if (state) state.playing = false;
  }

  window.CommonsKnowledge = { hub: ['knowledge'], view: viewHTML, mount, destroy };
})();
