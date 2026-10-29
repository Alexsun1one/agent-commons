/* 作品轮盘。真实实践来自 COMMONS_FIELDWORK，合成作品来自 COMMONS_DATA.works。不改 app.js。 */
(function () {
  'use strict';

  var AGENT_TAGS = { '扣子': 1, 'Codex': 1, 'WorkBuddy': 1, 'GPT': 1, 'Opus': 1, '图像生成': 1 };
  var CHECK_RE = /复核|检查|检验|批准|判断|核对/;
  var ORDER = ['办公与业务', '开发与维护', '内容创作'];
  var CAT = { '办公与业务': 1, '开发与维护': 2, '内容创作': 3, '示例': 10 };
  var C30 = 0.8660254037844386;
  var DWELL = 1400;
  function live() { return !!(window.CommonsAPI && window.CommonsAPI.mode === 'live'); }
  function sampleHub() { return (!live() && window.COMMONS_WORK_HUB_SAMPLE) || { contrast: {}, stationPreset: {} }; }

  var generation = 0;
  var mounted = null;

  function proj(x, y, z) { return [(x - y) * C30, (x + y) * 0.5 - z]; }
  function F(n) { return Math.round(n * 10) / 10; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function norm(a) { a = a % 360; return a < 0 ? a + 360 : a; }
  function shortest(from, to) {
    var d = norm(to) - norm(from);
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    return from + d;
  }
  function reduced() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
  function cssEscape(value) {
    if (window.CSS && window.CSS.escape) return window.CSS.escape(String(value));
    return String(value).replace(/["\\]/g, '\\$&');
  }
  function readRaw(name) {
    try { return String(getComputedStyle(document.documentElement).getPropertyValue(name) || '').trim(); }
    catch (e) { return ''; }
  }
  function readMs(name, fallback) {
    var raw = readRaw(name);
    var n = parseFloat(raw);
    if (!(n > 0)) return fallback;
    if (raw.charAt(raw.length - 1) === 's' && raw.slice(-2) !== 'ms') return n * 1000;
    return n;
  }
  function readPx(name, fallback) {
    var n = parseFloat(readRaw(name));
    return n > 0 ? n : fallback;
  }
  function curve(t, a, b) {
    var u = 1 - t;
    return 3 * u * u * t * a + 3 * u * t * t * b + t * t * t;
  }
  function cubicBezier(x1, y1, x2, y2) {
    return function (x) {
      if (x <= 0) return 0;
      if (x >= 1) return 1;
      var lo = 0, hi = 1, t = x, i;
      for (i = 0; i < 16; i++) {
        t = (lo + hi) / 2;
        if (curve(t, x1, x2) < x) lo = t;
        else hi = t;
      }
      return curve(t, y1, y2);
    };
  }
  function parseLinear(fn) {
    var body = fn.slice(fn.indexOf('(') + 1, fn.lastIndexOf(')'));
    var stops = [];
    body.split(',').forEach(function (part) {
      var bits = part.trim().split(/\s+/).filter(Boolean);
      if (!bits.length) return;
      var y = parseFloat(bits[0]);
      if (bits.length === 1) stops.push({ y: y, x: null });
      else bits.slice(1).forEach(function (raw) { stops.push({ y: y, x: parseFloat(raw) / 100 }); });
    });
    if (!stops.length) return function (x) { return x; };
    if (stops[0].x == null) stops[0].x = 0;
    if (stops[stops.length - 1].x == null) stops[stops.length - 1].x = 1;
    var i = 0;
    while (i < stops.length) {
      if (stops[i].x == null) {
        var j = i;
        while (j < stops.length && stops[j].x == null) j++;
        var from = stops[i - 1].x;
        var to = stops[j].x;
        var n = j - i;
        var k;
        for (k = 0; k < n; k++) stops[i + k].x = from + (to - from) * (k + 1) / (n + 1);
        i = j;
      } else i++;
    }
    return function (x) {
      if (x <= 0) return stops[0].y;
      if (x >= 1) return stops[stops.length - 1].y;
      var n;
      for (n = 1; n < stops.length; n++) {
        var b = stops[n];
        if (x <= b.x) {
          var a = stops[n - 1];
          var t = (b.x - a.x) ? (x - a.x) / (b.x - a.x) : 1;
          return a.y + (b.y - a.y) * t;
        }
      }
      return stops[stops.length - 1].y;
    };
  }
  function readEase(name, fallback) {
    var raw = readRaw(name);
    var bez = raw.match(/cubic-bezier\(\s*(-?[0-9.]+)\s*,\s*(-?[0-9.]+)\s*,\s*(-?[0-9.]+)\s*,\s*(-?[0-9.]+)\s*\)/);
    if (bez) return cubicBezier(+bez[1], +bez[2], +bez[3], +bez[4]);
    if (raw.indexOf('linear(') !== -1) return parseLinear(raw);
    return fallback;
  }

  function personName(owner) {
    var people = live() ? [] : ((window.COMMONS_DATA && window.COMMONS_DATA.people) || []);
    for (var i = 0; i < people.length; i++) if (people[i].id === owner) return people[i].name || '';
    return '';
  }
  function isWork(item) {
    if (!item || typeof item !== 'object') return false;
    if (Array.isArray(item.nodes)) return true;
    return !!(item.owner && !item.source && !Array.isArray(item.steps));
  }
  function isDemo(item) {
    if (item.demo === true || item.synthetic === true) return true;
    if (item.demo === false) return false;
    return isWork(item);
  }
  function roleOfTag(tag) { return AGENT_TAGS[tag] ? 'agent' : 'human'; }
  function stationsOf(item) {
    if (Array.isArray(item.stations) && item.stations.length) {
      return item.stations.map(function (s) {
        var tag = s.tag || s.title || '';
        var role = s.role === 'agent' || s.role === 'human' ? s.role : roleOfTag(tag);
        return { title: s.title || tag, tag: tag, role: role };
      });
    }
    if (isWork(item)) {
      var row = (sampleHub().stationPreset || {})[item.id] || [];
      return (item.nodes || []).map(function (name, i) {
        return { title: name, tag: name, role: row[i] || 'human' };
      });
    }
    return (item.steps || []).map(function (s) {
      return { title: s.title || '', tag: s.tag || '', role: roleOfTag(s.tag) };
    });
  }
  function normalize(item) {
    if (!item || typeof item !== 'object' || (!item.title && !item.id)) return null;
    var demo = isDemo(item);
    var source = item.source || {};
    return {
      id: item.id || '',
      title: item.title || '未命名',
      kind: item.kind || (demo ? '示例' : ''),
      visual: item.visual || (demo ? 'demo' : ''),
      summary: item.summary || item.description || item.subtitle || '',
      category: demo ? '示例' : (item.category || '未分类'),
      demo: demo,
      contrast: (sampleHub().contrast || {})[item.id] || '',
      stations: stationsOf(item),
      date: source.date || '',
      group: source.group || '',
      limits: demo ? '示例作品，不是归档里的人。' : (item.limits || ''),
      who: demo ? (item.who || personName(item.owner) || '合成人物') : (item.who || '一位群友（已匿名）')
    };
  }
  function group(list) {
    var real = list.filter(function (it) { return !it.demo; });
    var demo = list.filter(function (it) { return it.demo; });
    var out = [];
    ORDER.forEach(function (cat) {
      real.forEach(function (it) { if (it.category === cat) out.push(it); });
    });
    real.forEach(function (it) { if (ORDER.indexOf(it.category) < 0) out.push(it); });
    demo.forEach(function (it) { out.push(it); });
    return out;
  }
  function defaultItems() {
    var fw = (window.COMMONS_FIELDWORK && window.COMMONS_FIELDWORK.items) || [];
    var works = live() ? [] : ((window.COMMONS_DATA && window.COMMONS_DATA.works) || []);
    return fw.concat(works);
  }
  function sectorsOf(items) {
    var names = [];
    items.forEach(function (it) { if (names.indexOf(it.category) < 0) names.push(it.category); });
    var span = 360 / (items.length || 1);
    return names.map(function (name) {
      var idxs = [];
      items.forEach(function (it, i) { if (it.category === name) idxs.push(i); });
      var a0 = idxs[0] * span - span / 2;
      var a1 = idxs[idxs.length - 1] * span + span / 2;
      return { id: name, name: name, demo: name === '示例', count: idxs.length, a0: a0, a1: a1, mid: (a0 + a1) / 2, idxs: idxs };
    });
  }

  function pol(r, deg, cx, cy) {
    var a = deg * Math.PI / 180;
    return [cx + r * Math.sin(a), cy - r * Math.cos(a)];
  }
  function band(r0, r1, a0, a1, cx, cy) {
    var p = function (r, a) { return pol(r, a, cx, cy); };
    var A = p(r1, a0), B = p(r1, a1), C = p(r0, a1), D = p(r0, a0);
    var large = (a1 - a0) > 180 ? 1 : 0;
    return 'M' + F(A[0]) + ' ' + F(A[1]) +
      'A' + r1 + ' ' + r1 + ' 0 ' + large + ' 1 ' + F(B[0]) + ' ' + F(B[1]) +
      'L' + F(C[0]) + ' ' + F(C[1]) +
      'A' + r0 + ' ' + r0 + ' 0 ' + large + ' 0 ' + F(D[0]) + ' ' + F(D[1]) + 'Z';
  }
  function boxGeom(x, y, z, w, d, h) {
    var P = proj;
    var x1 = x + w, y1 = y + d, z1 = z + h;
    var T = P(x, y, z1), R1 = P(x1, y, z1), R2 = P(x1, y, z), B = P(x1, y1, z);
    var L2 = P(x, y1, z), L1 = P(x, y1, z1), Fc = P(x1, y1, z1);
    function path(pts) {
      return pts.map(function (p, i) { return (i ? 'L' : 'M') + F(p[0]) + ' ' + F(p[1]); }).join('') + 'Z';
    }
    return {
      depth: x + y + z + (w + d + h) * 0.5,
      faces: [path([T, R1, Fc, L1]), path([R1, R2, B, Fc]), path([L1, Fc, B, L2])],
      crease: 'M' + F(R1[0]) + ' ' + F(R1[1]) + 'L' + F(Fc[0]) + ' ' + F(Fc[1]) + 'L' + F(L1[0]) + ' ' + F(L1[1]) +
        'M' + F(Fc[0]) + ' ' + F(Fc[1]) + 'L' + F(B[0]) + ' ' + F(B[1]),
      pts: [T, R1, R2, B, L2, L1, Fc]
    };
  }
  function accentsOf(item) {
    var agent = false, check = false;
    (item.stations || []).forEach(function (s) {
      if (s.role === 'agent') agent = true;
      if (s.role === 'human' && CHECK_RE.test((s.tag || '') + (s.title || ''))) check = true;
    });
    return { agent: agent, check: check };
  }
  function motifOf(item) {
    var title = item.title || '';
    var visual = item.visual || '';
    if (!item.demo && (visual === 'layers' || title.indexOf('上架') >= 0 || title.indexOf('跟单') >= 0)) return 'crates';
    if (title.indexOf('日志') >= 0) return 'log';
    if (title.indexOf('表格') >= 0) return 'sheet';
    if (title.indexOf('文档') >= 0 || title.indexOf('需求') >= 0) return 'doc';
    if (title.indexOf('封面') >= 0 || title.indexOf('配图') >= 0) return 'cover';
    if (title.indexOf('来源') >= 0 || title.indexOf('知识') >= 0) return 'cite';
    if (title.indexOf('接管') >= 0 || title.indexOf('暂停') >= 0) return 'gate';
    if (title.indexOf('教学') >= 0 || title.indexOf('带做') >= 0) return 'podium';
    return item.demo ? 'podium' : 'doc';
  }
  function sceneOf(item) {
    var a = accentsOf(item);
    var motif = motifOf(item);
    var boxes = [], lines = [], c = 0;
    function box(x, y, z, w, d, h, role) { boxes.push({ x: x, y: y, z: z, w: w, d: d, h: h, role: role || 'ink' }); }
    function line(pts, role) { lines.push({ pts: pts, role: role || 'ink' }); }
    if (motif === 'crates') {
      box(0, 0.25, 0, 1.55, 1.05, 0.42, 'ink');
      box(0.2, 0.08, 0.42, 1.15, 0.82, 0.36, 'ink');
      box(0.42, 0.2, 0.78, 0.7, 0.55, 0.32, a.agent ? 'agent' : 'ink');
    } else if (motif === 'sheet') {
      box(0, 0.1, 0, 1.9, 1.25, 0.07, 'ink');
      for (c = 1; c <= 3; c++) {
        line([[c * 0.46, 0.16, 0.08], [c * 0.46, 1.22, 0.08]], 'ink');
        line([[0.12, c * 0.3, 0.08], [1.76, c * 0.3, 0.08]], 'ink');
      }
      if (a.agent) box(0.5, 0.36, 0.07, 0.4, 0.24, 0.045, 'agent');
      if (a.check) line([[1.42, 0.82, 0.12], [1.56, 1.02, 0.12], [1.84, 0.62, 0.12]], 'human');
    } else if (motif === 'log') {
      box(0.02, 0.2, 0, 0.1, 1.2, 0.2, 'ink');
      box(-1.05, 0.28, 0.02, 1.05, 1.08, 0.05, 'ink');
      box(0.12, 0.16, 0.02, 1.12, 1.2, 0.06, 'ink');
      for (c = 0; c < 4; c++) line([[0.28, 0.38 + c * 0.22, 0.09], [1.05, 0.38 + c * 0.22, 0.09]], 'ink');
      if (a.check) box(0.9, 0.2, 0.08, 0.1, 0.48, 0.04, 'human');
    } else if (motif === 'doc') {
      box(0.15, 0.4, 0, 1.25, 0.85, 0.06, 'ink');
      box(0.28, 0.55, 0.06, 1.05, 0.06, 1.2, 'ink');
      for (c = 0; c < 4; c++) line([[0.42, 0.61, 0.32 + c * 0.22], [1.16, 0.61, 0.32 + c * 0.22]], a.agent && c === 1 ? 'agent' : 'ink');
    } else if (motif === 'cover') {
      box(0.1, 0.62, 0.04, 1.4, 0.08, 1.2, 'ink');
      box(0.28, 0.5, 0.26, 1.02, 0.06, 0.74, a.agent ? 'agent' : 'ink');
      line([[0.28, 0.56, 0.16], [1.3, 0.56, 0.16]], 'ink');
    } else if (motif === 'cite') {
      box(0, 0.25, 0, 1.65, 1.15, 0.08, 'ink');
      line([[0.15, 0.45, 0.1], [0.15, 1.15, 0.1], [0.4, 1.15, 0.1]], 'ink');
      line([[1.5, 0.45, 0.1], [1.5, 1.15, 0.1], [1.25, 1.15, 0.1]], 'ink');
      if (a.agent) box(0.45, 0.55, 0.08, 0.7, 0.08, 0.045, 'agent');
      if (a.check) box(1.28, 0.32, 0.08, 0.22, 0.22, 0.04, 'human');
    } else if (motif === 'gate') {
      box(0.05, 0.35, 0, 0.14, 0.14, 1.05, 'ink');
      box(1.35, 0.35, 0, 0.14, 0.14, 1.05, 'ink');
      box(0.05, 0.32, 0.72, 1.44, 0.1, 0.08, a.check ? 'human' : 'ink');
      if (a.agent) box(0.58, 0.7, 0, 0.34, 0.34, 0.28, 'agent');
    } else {
      box(0, 0.25, 0, 1.6, 1.1, 0.22, 'ink');
      box(0.28, 0.4, 0.22, 1.05, 0.78, 0.18, 'ink');
      box(0.62, 0.18, 0.4, 0.12, 0.42, 0.62, 'ink');
    }
    return { motif: motif, boxes: boxes, lines: lines };
  }
  function linePath(pts) {
    return pts.map(function (p, i) {
      var q = proj(p[0], p[1], p[2]);
      return (i ? 'L' : 'M') + F(q[0]) + ' ' + F(q[1]);
    }).join('');
  }
  function roleClass(role) { return role === 'agent' ? 'wh-agent' : role === 'human' ? 'wh-human' : 'wh-ink'; }
  function thumb(item) {
    var scene = sceneOf(item);
    var parts = [], pts = [];
    scene.boxes.forEach(function (b) {
      var g = boxGeom(b.x, b.y, b.z, b.w, b.d, b.h);
      g.pts.forEach(function (p) { pts.push(p); });
      parts.push({ depth: g.depth, role: b.role, faces: g.faces, crease: g.crease });
    });
    scene.lines.forEach(function (ln) { ln.pts.forEach(function (p) { pts.push(proj(p[0], p[1], p[2])); }); });
    parts.sort(function (a, b) { return a.depth - b.depth; });
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    pts.forEach(function (p) {
      if (p[0] < minX) minX = p[0];
      if (p[1] < minY) minY = p[1];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] > maxY) maxY = p[1];
    });
    var pad = 0.28;
    var vb = [F(minX - pad), F(minY - pad), F(Math.max(0.2, maxX - minX + pad * 2)), F(Math.max(0.2, maxY - minY + pad * 2))];
    var body = parts.map(function (part) {
      var cls = roleClass(part.role);
      return part.faces.map(function (d) { return '<path class="wh-edge ' + cls + '" d="' + esc(d) + '"/>'; }).join('') +
        '<path class="wh-crease" d="' + esc(part.crease) + '"/>';
    }).join('');
    body += scene.lines.map(function (ln) {
      return '<path class="wh-hair ' + roleClass(ln.role) + '" d="' + linePath(ln.pts) + '"/>';
    }).join('');
    return '<svg class="wh-thumb" data-wh-motif="' + esc(scene.motif) + '" viewBox="' + vb.join(' ') + '" aria-hidden="true">' + body + '</svg>';
  }

  function statusView(el, mode) {
    var copy = {
      loading: '正在把实践摆上轮盘。',
      empty: '还没有可转的作品。群友实践和示例都空着。',
      error: '作品没有加载出来。刷新后再试；群友实践还能在「作品与同行」看。'
    };
    el.innerHTML = '<section class="wh" data-state="' + esc(mode) + '"' + (mode === 'loading' ? ' aria-busy="true"' : '') + ' aria-label="作品轮盘">' +
      (mode === 'loading' ? '<div class="wh-skel" aria-hidden="true"></div>' : '') +
      '<p class="wh-status" role="status">' + copy[mode] + '</p></section>';
    mounted = { root: el, stop: function () {}, cleanups: [] };
  }
  function sowhatText(items, secName, sectors) {
    if (secName) {
      var sec = null;
      sectors.forEach(function (s) { if (s.id === secName) sec = s; });
      return sec ? '这一扇是' + sec.name + '，' + sec.count + ' 件。点外圈那枚小图，看谁在做。' : '';
    }
    var counts = {};
    items.forEach(function (it) { if (!it.demo) counts[it.category] = (counts[it.category] || 0) + 1; });
    var cover = counts['内容创作'] || 0;
    var office = counts['办公与业务'] || 0;
    var dev = counts['开发与维护'] || 0;
    var nums = Object.keys(counts).map(function (k) { return counts[k]; });
    var tail = '';
    if (nums.length && cover === Math.min.apply(null, nums) && cover < Math.max(office, dev)) tail = '创作这里缺人。';
    return '内容创作只有 ' + cover + ' 件，办公与业务 ' + office + ' 件，开发与维护 ' + dev + ' 件。' + tail;
  }
  function openHTML(it, locked) {
    if (locked) return '<span class="button primary wh-open" id="wh-open" aria-disabled="true">查看整理</span>';
    if (it.demo) return '<a class="button primary wh-open" id="wh-open" href="#/work/' + encodeURIComponent(it.id) + '">打开作品</a>';
    return '<button type="button" class="button primary wh-open" id="wh-open" data-action="fieldwork-open" data-id="' + esc(it.id) + '">查看整理</button>';
  }

  function mount(el, items, locked) {
    var gen = generation;
    var sectors = sectorsOf(items);
    var state = {
      spin: 0, from: 0, to: 0, t0: 0, anim: 0, bootFrame: 0, idx: 0,
      playing: false, paused: false, finished: false, timer: 0, rollTimer: 0, sectorHold: '',
      seen: false, popId: '', popFrom: '', popK: 1, popT0: 0, popping: false, spinning: false,
      hoverId: '', hoverTarget: '', hoverK: 0, hoverFromK: 0, hoverToK: 0, hoverT0: 0, hovering: false
    };
    var spring = readEase('--ease-spring', cubicBezier(0.34, 1.4, 0.64, 1));
    var easeOut = readEase('--ease-out', cubicBezier(0.23, 1, 0.32, 1));
    var spinDur = readMs('--motion-layout', 320);
    var hoverDur = readMs('--motion-fast', 120);
    var stageDur = readMs('--motion-stage', 480);
    var popPx = readPx('--space-1', 4);
    var cleanups = [];
    var CX = 500, CY = 500, RIN = 168, ROUT = 318, RSPOKE0 = 328, RSPOKE1 = 392;
    var RMID = (RIN + ROUT) / 2;
    var realN = items.filter(function (it) { return !it.demo; }).length;
    el.innerHTML =
      '<section class="wh" data-state="' + (locked ? 'disabled' : 'default') + '" aria-label="作品轮盘">' +
      '<div class="wh-grid"><div class="wh-stage"><div class="wh-wheel" id="wh-wheel">' +
      '<svg class="wh-ring" id="wh-ring" viewBox="0 0 1000 1000" role="group" aria-label="按类别分成的作品轮盘"></svg>' +
      '<div class="wh-planets" id="wh-planets"></div>' +
      '<div class="wh-labs" id="wh-labs" aria-hidden="true"></div>' +
      '<button type="button" class="wh-hub" id="wh-hub" aria-pressed="false"' + (locked ? ' disabled' : '') + '>' +
      '<span class="wh-hub-roll"><b class="wh-hub-num"></b></span><span class="wh-hub-name"></span><small class="wh-hub-note">转一圈</small></button></div>' +
      (items.some(function (it) { return it.demo; }) ? '<p class="wh-legend"><i class="wh-legend-swatch" aria-hidden="true"></i>虚线边是示例</p>' : '') +
      '<p class="wh-sowhat" id="wh-sowhat"></p></div>' +
      '<aside class="wh-side"><p class="wh-kicker">作品轮盘</p>' +
      '<h2 class="wh-statement">做过的事<br><span class="wh-line">转一圈就<em class="wh-em">找到</em></span></h2>' +
      '<div class="wh-stats" aria-label="作品数量"><div><b id="wh-n-real">' + realN + '</b><span>' + (live() ? '件作品' : '件群友实践') + '</span></div>' +
      (live() ? '' : '<div><b id="wh-n-demo">' + (items.length - realN) + '</b><span>件示例</span></div>') + '</div>' +
      '<article class="wh-detail" id="wh-detail" aria-live="polite">' +
      '<p class="wh-kicker" id="wh-kicker"></p><h3 class="wh-title" id="wh-title"></h3>' +
      '<p class="wh-contrast" id="wh-contrast"></p><p class="wh-summary" id="wh-summary"></p>' +
      '<ol class="wh-chain" id="wh-chain"></ol><p class="wh-who" id="wh-who"></p>' +
      '<p class="wh-meta" id="wh-meta"></p><p class="wh-limits" id="wh-limits"></p>' +
      '<div id="wh-open-slot"></div></article>' +
      '<p class="wh-sr">方向键切换，回车打开。</p>' +
      '</aside></div></section>';

    var root = el.querySelector('.wh');
    var svg = el.querySelector('#wh-ring');
    var planets = el.querySelector('#wh-planets');
    var labs = el.querySelector('#wh-labs');
    var hub = el.querySelector('#wh-hub');
    var wheel = el.querySelector('#wh-wheel');

    function on(node, type, fn) {
      node.addEventListener(type, fn);
      cleanups.push(function () { node.removeEventListener(type, fn); });
    }
    function itemAngle(i) { return (360 / items.length) * i; }
    function drawRing() {
      var html = ['<g id="wh-rotor">'];
      var a, outer, p0, p1;
      for (a = 0; a < 360; a += 6) {
        outer = a % 30 === 0 ? 478 : 472;
        p0 = pol(464, a, CX, CY);
        p1 = pol(outer, a, CX, CY);
        html.push('<line class="wh-tick" x1="' + F(p0[0]) + '" y1="' + F(p0[1]) + '" x2="' + F(p1[0]) + '" y2="' + F(p1[1]) + '"/>');
      }
      sectors.forEach(function (sec, si) {
        var gap = 0.8;
        var cat = CAT[sec.id] || ((si % 9) + 1);
        html.push('<g class="wh-sec' + (sec.demo ? ' wh-demo' : '') + '" data-wh-sec="' + esc(sec.id) + '" style="--wh-cat:var(--cat-' + cat + ')" role="button" tabindex="' + (locked ? '-1' : '0') + '" aria-disabled="' + (locked ? 'true' : 'false') + '" aria-label="' + esc(sec.name) + '，' + esc(sec.count) + ' 件"><path class="wh-sec-bg" d="' + band(RIN, ROUT, sec.a0 + gap, sec.a1 - gap, CX, CY) + '"/></g>');
        sec.idxs.forEach(function (i) {
          var ang = itemAngle(i);
          var aa = pol(RSPOKE0, ang, CX, CY), bb = pol(RSPOKE1, ang, CX, CY);
          html.push('<line class="wh-spoke" x1="' + F(aa[0]) + '" y1="' + F(aa[1]) + '" x2="' + F(bb[0]) + '" y2="' + F(bb[1]) + '"/>');
        });
      });
      html.push('</g>');
      svg.innerHTML = html.join('');
      labs.innerHTML = sectors.map(function (sec) {
        return '<div class="wh-lab' + (sec.demo ? ' wh-demo' : '') + '" data-wh-lab="' + esc(sec.id) + '"><span class="wh-lab-name">' + esc(sec.name) + '</span><b class="wh-lab-n">' + esc(sec.count) + '</b></div>';
      }).join('');
      planets.innerHTML = items.map(function (it, i) {
        return '<button type="button" class="wh-planet' + (it.demo ? ' wh-demo' : '') + '" data-wh-i="' + i + '" aria-label="' + esc(it.title) + (it.demo ? '，示例' : '') + '"' + (locked ? ' disabled' : '') + '>' +
          thumb(it) + '</button>';
      }).join('');
    }
    function wheelPx() {
      var box = wheel.getBoundingClientRect && wheel.getBoundingClientRect();
      return (box && box.width) || 560;
    }
    function userPx(px) { return px * 1000 / wheelPx(); }
    function paintSpin() {
      if (generation !== gen) return;
      var rotor = el.querySelector('#wh-rotor');
      if (rotor) rotor.setAttribute('transform', 'rotate(' + F(state.spin) + ' ' + CX + ' ' + CY + ')');
      var popU = reduced() ? 0 : userPx(popPx);
      var liftU = reduced() ? 0 : userPx(popPx / 2) * (state.hoverK || 0);
      var popScreen = reduced() ? 0 : popPx;
      var liftScreen = reduced() ? 0 : (popPx / 2) * (state.hoverK || 0);
      var sAng = state.spin * Math.PI / 180;
      var hx = -liftU * Math.sin(sAng);
      var hy = -liftU * Math.cos(sAng);
      var rPct = RMID / 10;
      sectors.forEach(function (sec) {
        var p = 0;
        if (sec.id === state.popId) p = state.popK || 0;
        else if (sec.id === state.popFrom) p = 1 - (state.popK || 0);
        var mid = sec.mid * Math.PI / 180;
        var lx = popU * p * Math.sin(mid);
        var ly = -popU * p * Math.cos(mid);
        if (sec.id === state.hoverId) { lx += hx; ly += hy; }
        var node = svg.querySelector('.wh-sec[data-wh-sec="' + cssEscape(sec.id) + '"]');
        if (node) node.setAttribute('transform', 'translate(' + F(lx) + ' ' + F(ly) + ')');
        var lab = labs.querySelector('[data-wh-lab="' + cssEscape(sec.id) + '"]');
        if (!lab) return;
        var ang = (sec.mid + state.spin) * Math.PI / 180;
        var dx = popScreen * p * Math.sin(ang);
        var dy = -popScreen * p * Math.cos(ang);
        if (sec.id === state.hoverId) dy -= liftScreen;
        lab.style.left = (50 + rPct * Math.sin(ang)) + '%';
        lab.style.top = (50 - rPct * Math.cos(ang)) + '%';
        lab.style.transform = 'translate(calc(-50% + ' + F(dx) + 'px), calc(-50% + ' + F(dy) + 'px))';
      });
      var r = 38;
      planets.querySelectorAll('.wh-planet').forEach(function (btn) {
        var i = Number(btn.getAttribute('data-wh-i'));
        var ang = itemAngle(i) + state.spin;
        var rad = ang * Math.PI / 180;
        btn.style.left = (50 + r * Math.sin(rad)) + '%';
        btn.style.top = (50 - r * Math.cos(rad)) + '%';
      });
    }
    function kick() {
      if (state.anim) return;
      state.anim = requestAnimationFrame(frame);
    }
    function frame(now) {
      if (generation !== gen) return;
      state.anim = 0;
      var again = false;
      if (state.spinning) {
        var k = Math.min(1, (now - state.t0) / spinDur);
        state.spin = state.from + (state.to - state.from) * spring(Math.min(1, k));
        if (k < 1) again = true;
        else { state.spin = norm(state.to); state.spinning = false; }
      }
      if (state.popping) {
        var kp = Math.min(1, (now - state.popT0) / spinDur);
        state.popK = spring(Math.min(1, kp));
        if (kp < 1) again = true;
        else { state.popK = 1; state.popping = false; state.popFrom = ''; }
      }
      if (state.hovering) {
        var kh = Math.min(1, (now - state.hoverT0) / hoverDur);
        state.hoverK = state.hoverFromK + (state.hoverToK - state.hoverFromK) * easeOut(Math.min(1, kh));
        if (kh < 1) again = true;
        else {
          state.hovering = false;
          state.hoverK = state.hoverToK;
          if (!state.hoverTarget) state.hoverId = '';
        }
      }
      paintSpin();
      if (again && generation === gen) state.anim = requestAnimationFrame(frame);
    }
    function spinTo(angle) {
      state.from = state.spin;
      state.to = shortest(state.spin, -angle);
      if (reduced() || Math.abs(state.to - state.from) < 0.05) {
        state.spin = norm(state.to);
        state.spinning = false;
        paintSpin();
        return;
      }
      state.t0 = performance.now();
      state.spinning = true;
      kick();
    }
    function setPop(id, immediate) {
      if (!immediate && id === state.popId && !state.popping) return;
      if (immediate || reduced()) {
        state.popFrom = '';
        state.popId = id;
        state.popK = 1;
        state.popping = false;
        paintSpin();
        return;
      }
      state.popFrom = state.popId;
      state.popId = id;
      state.popK = 0;
      state.popT0 = performance.now();
      state.popping = true;
      kick();
    }
    function setHover(id) {
      if (id === state.hoverTarget) return;
      var prev = state.hoverTarget;
      state.hoverTarget = id;
      if (reduced()) {
        state.hoverId = '';
        state.hoverK = 0;
        state.hovering = false;
        paintSpin();
        return;
      }
      state.hoverFromK = (id && id !== prev) ? 0 : (state.hoverK || 0);
      state.hoverId = id || prev;
      state.hoverToK = id ? 1 : 0;
      state.hoverT0 = performance.now();
      state.hovering = true;
      kick();
    }
    function sectorNow() {
      var name = items[state.idx].category;
      var sec = sectors[0];
      sectors.forEach(function (s) { if (s.id === name) sec = s; });
      return sec;
    }
    function noteText() {
      if (state.playing) return '暂停';
      if (state.paused) return '继续';
      return state.finished ? '再走一轮' : '转一圈';
    }
    function snapNumber(next) {
      clearTimeout(state.rollTimer);
      var roll = hub.querySelector('.wh-hub-roll');
      if (roll) roll.innerHTML = '<b class="wh-hub-num">' + esc(next) + '</b>';
    }
    function rollNumber(next) {
      var shown = hub.querySelector('.wh-hub-num');
      var prev = shown ? shown.textContent : '';
      if (prev === next) return;
      if (reduced() || prev === '') { snapNumber(next); return; }
      clearTimeout(state.rollTimer);
      var roll = hub.querySelector('.wh-hub-roll');
      var up = Number(next) >= Number(prev);
      if (up) roll.innerHTML = '<span class="wh-hub-roll-track"><b>' + esc(prev) + '</b><b class="wh-hub-num">' + esc(next) + '</b></span>';
      else roll.innerHTML = '<span class="wh-hub-roll-track" style="transform:translateY(-50%)"><b class="wh-hub-num">' + esc(next) + '</b><b>' + esc(prev) + '</b></span>';
      var track = roll.querySelector('.wh-hub-roll-track');
      if (track) {
        void track.offsetWidth;
        track.style.transform = up ? 'translateY(-50%)' : 'translateY(0)';
      }
      var token = generation;
      state.rollTimer = setTimeout(function () {
        if (generation !== token) return;
        snapNumber(next);
      }, stageDur + 40);
    }
    function paintCenter() {
      var sec = sectorNow();
      var nameEl = hub.querySelector('.wh-hub-name');
      if (nameEl) nameEl.textContent = sec.name;
      rollNumber(String(sec.count));
      hub.setAttribute('aria-label', sec.name + '，' + sec.count + ' 件，' + noteText());
    }
    function paintHub() {
      var note = hub.querySelector('.wh-hub-note');
      if (note) note.textContent = noteText();
      hub.setAttribute('aria-pressed', state.playing ? 'true' : 'false');
      paintCenter();
    }
    function paintSelection() {
      var it = items[state.idx];
      var first = !state.seen;
      state.seen = true;
      setPop(it.category, first);
      svg.querySelectorAll('.wh-sec').forEach(function (node) {
        var on = node.getAttribute('data-wh-sec') === it.category;
        node.classList.toggle('wh-on', on);
        node.setAttribute('aria-pressed', on ? 'true' : 'false');
        if (on) node.setAttribute('data-state', 'selected');
        else if (node.getAttribute('data-state') === 'selected') node.removeAttribute('data-state');
      });
      planets.querySelectorAll('.wh-planet').forEach(function (btn) {
        var on = Number(btn.getAttribute('data-wh-i')) === state.idx;
        btn.classList.toggle('wh-on', on);
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        if (on) btn.setAttribute('data-state', 'selected');
        else if (btn.getAttribute('data-state') === 'selected') btn.removeAttribute('data-state');
      });
      el.querySelector('#wh-kicker').textContent = it.demo ? '示例作品' : it.category + ' · 群友自述';
      el.querySelector('#wh-title').textContent = it.title;
      el.querySelector('#wh-contrast').textContent = it.contrast;
      el.querySelector('#wh-summary').textContent = it.summary;
      el.querySelector('#wh-chain').innerHTML = it.stations.map(function (s) {
        return '<li class="' + (s.role === 'agent' ? 'wh-agent' : 'wh-human') + '" title="' + esc(s.title) + '"><i></i><span>' + esc(s.tag) + '</span></li>';
      }).join('');
      el.querySelector('#wh-who').innerHTML = it.demo
        ? '做的人：' + esc(it.who) + ' <span class="wh-tag">示例</span>'
        : '做的人：一位群友（已匿名）';
      el.querySelector('#wh-meta').textContent = it.demo ? '示例作品 · 不是归档里的人' : ((it.date || '') + ' · ' + (it.group || ''));
      el.querySelector('#wh-limits').textContent = it.limits;
      el.querySelector('#wh-open-slot').innerHTML = openHTML(it, locked);
      el.querySelector('#wh-sowhat').textContent = sowhatText(items, state.sectorHold, sectors);
      paintCenter();
    }
    function openCurrent() {
      var opener = el.querySelector('#wh-open');
      if (!opener || locked || opener.getAttribute('aria-disabled') === 'true') return;
      opener.click();
    }
    function typingTarget(ev) {
      var t = ev.target;
      return !!(t && t.closest && t.closest('input, textarea, select, [contenteditable="true"]'));
    }
    function focusIndex(i, holdSector) {
      state.idx = (i + items.length) % items.length;
      state.sectorHold = holdSector || '';
      var mid = state.sectorHold;
      var target = itemAngle(state.idx);
      if (mid) sectors.forEach(function (s) { if (s.id === mid) target = s.mid; });
      spinTo(target);
      paintSelection();
    }
    function haltTour() {
      state.playing = false;
      clearTimeout(state.timer);
    }
    function arm() {
      clearTimeout(state.timer);
      if (!state.playing || locked) return;
      state.timer = setTimeout(function () {
        if (generation !== gen || !state.playing) return;
        if (state.idx >= items.length - 1) {
          state.playing = false;
          state.paused = false;
          state.finished = true;
          paintHub();
          return;
        }
        focusIndex(state.idx + 1);
        arm();
      }, DWELL);
    }
    function toggleTour() {
      if (locked) return;
      if (state.playing) {
        haltTour();
        state.paused = true;
        paintHub();
        return;
      }
      if (!state.paused) state.idx = 0;
      state.finished = false;
      state.paused = false;
      state.playing = true;
      focusIndex(state.idx);
      paintHub();
      arm();
    }

    drawRing();
    paintSpin();
    focusIndex(0);
    paintHub();

    on(svg, 'click', function (ev) {
      if (locked) return;
      var sec = ev.target.closest && ev.target.closest('.wh-sec');
      if (!sec) return;
      haltTour();
      state.paused = false;
      state.finished = false;
      var name = sec.getAttribute('data-wh-sec');
      var found = null;
      sectors.forEach(function (s) { if (s.id === name) found = s; });
      if (!found) return;
      state.idx = found.idxs[0];
      state.sectorHold = name;
      spinTo(found.mid);
      paintSelection();
      paintHub();
    });
    on(svg, 'pointerover', function (ev) {
      var sec = ev.target && ev.target.closest && ev.target.closest('.wh-sec');
      if (sec) setHover(sec.getAttribute('data-wh-sec'));
      else setHover('');
    });
    on(svg, 'pointerleave', function () { setHover(''); });
    on(svg, 'keydown', function (ev) {
      var sec = ev.target.closest && ev.target.closest('.wh-sec');
      if (!sec || locked) return;
      if (ev.key === ' ') { ev.preventDefault(); sec.click(); }
    });
    on(planets, 'click', function (ev) {
      if (locked) return;
      var btn = ev.target.closest && ev.target.closest('.wh-planet');
      if (!btn) return;
      haltTour();
      state.paused = false;
      state.finished = false;
      focusIndex(Number(btn.getAttribute('data-wh-i')));
      paintHub();
    });
    on(hub, 'click', toggleTour);
    on(wheel, 'keydown', function (ev) {
      if (locked || typingTarget(ev)) return;
      if (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft') {
        ev.preventDefault();
        haltTour();
        state.paused = false;
        state.finished = false;
        focusIndex(state.idx + (ev.key === 'ArrowRight' ? 1 : -1));
        paintHub();
        if (ev.target !== hub) {
          var planet = planets.querySelector('.wh-planet.wh-on');
          if (planet && planet.focus) planet.focus();
        }
        return;
      }
      if (ev.key === 'Enter') {
        ev.preventDefault();
        haltTour();
        state.paused = false;
        state.finished = false;
        var planet = ev.target.closest && ev.target.closest('.wh-planet');
        var sec = ev.target.closest && ev.target.closest('.wh-sec');
        if (planet) focusIndex(Number(planet.getAttribute('data-wh-i')));
        else if (sec) sec.click();
        paintHub();
        openCurrent();
      }
    });
    on(window, 'resize', function () { if (generation === gen) paintSpin(); });
    state.bootFrame = requestAnimationFrame(function () {
      if (generation === gen) paintSpin();
    });

    mounted = {
      root: el,
      stop: function () {
        clearTimeout(state.timer);
        clearTimeout(state.rollTimer);
        cancelAnimationFrame(state.anim);
        cancelAnimationFrame(state.bootFrame);
        state.playing = false;
        state.spinning = false;
      },
      cleanups: cleanups
    };
    root.dataset.whItems = String(items.length);
  }

  // 真实模式没有传作品时，自己读已发布的作品；读不到就保持原来的空/错误态。
  function loadLive(el) {
    var token = generation;
    statusView(el, 'loading');
    window.CommonsAPI.get('/objects', { type: 'work', limit: 30 }).then(function (res) {
      if (token !== generation || !el.isConnected) return;
      var rows = Array.isArray(res.data) ? res.data : [];
      render(el, rows.map(function (o) {
        return { id: o.id, title: o.title, summary: o.excerpt || '', category: '作品', who: (o.author && o.author.display_name) || '' };
      }));
    }).catch(function () {
      if (token !== generation || !el.isConnected) return;
      statusView(el, 'error');
    });
  }

  function render(el, items) {
    if (!el || el.nodeType !== 1) return;
    var mode = el.getAttribute('data-state') || '';
    destroy();
    if (items === undefined && live() && !mode && window.CommonsAPI && typeof window.CommonsAPI.get === 'function') { loadLive(el); return; }
    if (mode === 'loading' || mode === 'error') { statusView(el, mode); return; }
    var list = items === undefined ? defaultItems() : items;
    if (mode === 'empty' || (Array.isArray(list) && list.length === 0)) { statusView(el, 'empty'); return; }
    if (!Array.isArray(list)) { statusView(el, 'error'); return; }
    var ready = group(list.map(normalize).filter(Boolean));
    if (!ready.length) { statusView(el, 'empty'); return; }
    mount(el, ready, mode === 'disabled');
  }
  function destroy() {
    generation += 1;
    var cur = mounted;
    mounted = null;
    if (!cur) return;
    cur.stop();
    cur.cleanups.forEach(function (fn) { fn(); });
    if (cur.root) cur.root.innerHTML = '';
  }

  window.CommonsWorkHub = { render: render, destroy: destroy };
})();
