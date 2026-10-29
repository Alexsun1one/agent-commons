/* R13 AVA-FE · 头像体系与表情反应。
   接口：CommonsAvatar.html / stack / openEditor / mount / destroy
         CommonsReact.bar
   页面模块：routes + nav + icons，自行登记到 window.CommonsPages。 */
(function () {
  'use strict';

  function isDemo() {
    if (window.COMMONS_BUILD_LIVE === true || (window.CommonsAPI && window.CommonsAPI.mode === 'live')) return false;
    if (window.COMMONS_BUILD && window.COMMONS_BUILD.mode) return window.COMMONS_BUILD.mode === 'demo';
    return !!((window.CommonsAPI && window.CommonsAPI.mode === 'demo') || window.location.protocol === 'file:');
  }
  var demoModule = null;
  function demo() {
    if (!isDemo()) return null;
    var source = window.COMMONS_AVATAR_SAMPLE;
    if (!source) return null;
    if (!demoModule) demoModule = source.create({ names: source.names, LEVELS: LEVELS, PANDAS: PANDAS, SIZES: SIZES, bar: bar, esc: esc, html: html, meHTML: meHTML, meLevel: meLevel, meName: meName, meSaved: meSaved, memOf: memOf, mergeCounts: mergeCounts, stack: stack });
    return demoModule;
  }
  function labPage() { var d = demo(); return d ? d.page() : '<section class="ava-lab"><p role="status">暂无头像目录。</p></section>'; }
  function paintLab() { var d = demo(); if (d) d.paint(); }

  var PANDAS = [['brand-blue', '品牌蓝'], ['classic', '经典'], ['graphite', '石墨'], ['mint', '薄荷'], ['mist-purple', '雾紫'], ['night-sky', '夜空']];

  var SIZES = [24, 32, 40, 56, 96];
  var LEVELS = [
    { level: 1, name: '新队员', frame: 'none', how: '用邀请码注册' },
    { level: 2, name: '队员', frame: 'none', how: '账号满 7 天、活跃 5 天、收到 3 次合格的「有用」' },
    { level: 3, name: '骨干', frame: 'ring', how: '近 60 天过半活跃、内容被采纳 5 次、举报准确率达标' },
    { level: 4, name: '领航员', frame: 'double', how: '自动达标后由治理员复核' },
    { level: 5, name: '先锋', frame: 'stars', how: '只能由治理委员会授予' }
  ];
  var STATUS = {
    online: '在线',
    room: '在房间里',
    'in-room': '在房间里',
    speaking: '正在说话'
  };
  var REACTIONS = [
    { id: 'up', label: '赞', icon: 'appreciation', color: 'var(--cat-2)' },
    { id: 'useful', label: '有用', icon: 'verified', color: 'var(--accent)' },
    { id: 'learned', label: '学到了', icon: 'bulb', color: 'var(--cat-4)' },
    { id: 'spark', label: '灵光', icon: 'spark', color: 'var(--cat-1)' },
    { id: 'question', label: '疑问', icon: 'question', color: 'var(--cat-9)' },
    { id: 'reproduced', label: '复现了', icon: 'reproduced', color: 'var(--cat-3)' },
    { id: 'favorite', label: '收藏', icon: 'favorite', color: 'var(--cat-5)' },
    { id: 'cheer', label: '加油', icon: 'help', color: 'var(--cat-7)' },
    { id: 'smile', label: '笑', icon: '', color: 'var(--cat-9)', path: 'M8 14.2s1.6 2.3 4 2.3 4-2.3 4-2.3M9 9.2h.01M15 9.2h.01M12 20.5a8.5 8.5 0 1 1 0-17 8.5 8.5 0 0 1 0 17' },
    { id: 'heart', label: '心', icon: '', color: 'var(--violet-500)', path: 'M12 19s-7-4.4-7-9.2A3.8 3.8 0 0 1 12 8.2a3.8 3.8 0 0 1 7 1.6C19 14.6 12 19 12 19z' },
    { id: 'seen', label: '看过', icon: 'source', color: 'var(--cat-10)' },
    { id: 'rocket', label: '火箭', icon: '', color: 'var(--cat-2)', path: 'M14 4.5c2.6 1 4.6 3 5.5 5.5L13 16.5l-5.5-5.5zM8.2 15.4 6 18.8l3.4-2.2M9.6 10.2 7.4 8M13.8 14.4 16 16.6M8.8 16.8c-1.6.4-3.2.6-4.3-.5s-.9-2.7-.5-4.3' }
  ];
  var FILE_MAX = 8 * 1024 * 1024;
  var STORE_MAX = 200 * 1024;

  var reactById = {};
  REACTIONS.forEach(function (r) { reactById[r.id] = r; });

  var bound = false;
  var reactMem = {};
  var picker = { target: '', plus: null };
  var editor = null;
  var crop = null;

  function esc(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function reduced() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function read(key, fallback) {
    if (window.Commons && typeof window.Commons.read === 'function') return window.Commons.read(key, fallback);
    return fallback;
  }

  function write(key, value) {
    if (window.Commons && typeof window.Commons.write === 'function') return window.Commons.write(key, value);
    return false;
  }

  function toast(msg) {
    if (window.Commons && typeof window.Commons.toast === 'function') window.Commons.toast(msg);
  }

  function modal(title, html) {
    if (window.Commons && typeof window.Commons.modal === 'function') window.Commons.modal(title, html);
  }

  function closeModal() {
    if (window.Commons && typeof window.Commons.closeModal === 'function') window.Commons.closeModal();
  }

  function si(name, size) {
    if (window.CommonsIcons && typeof window.CommonsIcons.svg === 'function') {
      return window.CommonsIcons.svg(name, { size: size || 16 });
    }
    return '';
  }

  function hash32(s) {
    s = String(s == null ? 'x' : s);
    var h = 2166136261;
    var i;
    for (i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function sizePx(size) {
    var n = Number(size);
    if (SIZES.indexOf(n) !== -1) return n;
    if (size === 'tiny') return 24;
    if (size === 'big' || size === 'portrait') return 96;
    return 40;
  }

  function firstLetter(name) {
    var s = String(name || '').replace(/\s+/g, '');
    return s ? s.charAt(0) : '';
  }

  var FAMILIES = [
    ['var(--blue-200)', 'var(--blue-400)', 'var(--blue-600)'],
    ['var(--cat-9)', 'var(--cat-2)', 'var(--blue-800)'],
    ['var(--cat-3)', 'var(--cat-1)', 'var(--cat-7)'],
    ['var(--teal-200)', 'var(--teal-400)', 'var(--teal-700)'],
    ['var(--violet-200)', 'var(--violet-400)', 'var(--violet-700)'],
    ['var(--slate-300)', 'var(--slate-500)', 'var(--slate-700)']
  ];

  function cool(token, pct) {
    return 'color-mix(in oklab,' + token + ' ' + pct + '%, var(--slate-200))';
  }

  function geoSVG(id) {
    var h = hash32(id);
    var fam = FAMILIES[h % FAMILIES.length];
    var shift = (h >>> 3) % 3;
    var bg = cool(fam[shift], 58);
    var mid = cool(fam[(shift + 1) % 3], 72);
    var deep = cool(fam[(shift + 2) % 3], 80);
    var clip = 'ava' + h.toString(16);
    var n = 2 + ((h >>> 16) % 2);
    var tones = [mid, deep, mid];
    var shapes = [];
    var i;
    for (i = 0; i < n; i++) {
      var kind = (h >>> (i * 3 + 18)) % 4;
      var col = tones[i];
      var cx = 14 + ((h >>> (i * 5 + 2)) % 36);
      var cy = 12 + ((h >>> (i * 5 + 7)) % 40);
      var r = 10 + ((h >>> (i * 4 + 11)) % 18);
      if (kind === 0) {
        shapes.push('<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="' + col + '" fill-opacity=".78"/>');
      } else if (kind === 1) {
        shapes.push('<path d="M' + (cx - r) + ' ' + cy + ' A' + r + ' ' + r + ' 0 0 1 ' + (cx + r) + ' ' + cy + 'Z" fill="' + col + '" fill-opacity=".74"/>');
      } else if (kind === 2) {
        shapes.push('<path d="M' + (cx - r) + ' ' + (cy - 3) + ' A' + r + ' ' + (r * 0.9) + ' 0 0 1 ' + (cx + r) + ' ' + (cy + 8) + '" fill="none" stroke="' + col + '" stroke-width="7" stroke-linecap="round"/>');
      } else {
        var rot = ((h >>> (i * 2 + 1)) % 70) - 35;
        shapes.push('<rect x="' + (cx - r) + '" y="' + (cy - 5) + '" width="' + (r * 2) + '" height="11" rx="4" transform="rotate(' + rot + ' ' + cx + ' ' + cy + ')" fill="' + col + '" fill-opacity=".76"/>');
      }
    }
    return '<svg class="ava-geo" viewBox="0 0 64 64" aria-hidden="true">' +
      '<defs><clipPath id="' + clip + '"><circle cx="32" cy="32" r="32"/></clipPath></defs>' +
      '<g clip-path="url(#' + clip + ')">' +
      '<rect width="64" height="64" fill="' + bg + '"/>' +
      shapes.join('') +
      '</g></svg>';
  }

  function frameSVG(level) {
    var lv = Number(level) || 0;
    if (lv < 3) return '';
    var marks = '';
    if (lv >= 5) {
      var i;
      for (i = 0; i < 8; i++) {
        var a = (i / 8) * Math.PI * 2 - Math.PI / 2;
        var x = (32 + Math.cos(a) * 29).toFixed(2);
        var y = (32 + Math.sin(a) * 29).toFixed(2);
        var tone = i % 3 === 0 ? 'var(--accent)' : i % 3 === 1 ? 'var(--slate-300)' : 'var(--slate-700)';
        marks += '<circle cx="' + x + '" cy="' + y + '" r="1.7" fill="' + tone + '"/>';
      }
    }
    var ring = '<circle cx="32" cy="32" r="30.2" fill="none" stroke="var(--accent)" stroke-width="1.6"/>';
    var inner = lv >= 4 ? '<circle cx="32" cy="32" r="27.2" fill="none" stroke="var(--slate-300)" stroke-width="1.2"/>' : '';
    return '<svg class="ava-frame" viewBox="0 0 64 64" aria-hidden="true">' + ring + inner + marks + '</svg>';
  }

  function statusName(status) {
    return STATUS[status] || '';
  }

  function html(o) {
    o = o || {};
    var id = String(o.id == null ? 'x' : o.id);
    var name = String(o.name || '');
    var size = sizePx(o.size);
    var src = o.src ? String(o.src) : '';
    var synthetic = isDemo() && o.sample !== false && (o.sample === true || /^m([1-9]|[1-3][0-9]|40)$/.test(id) || (id !== 'me' && !(window.CommonsAPI && window.CommonsAPI.mode === 'live')));
    var panda = !src && synthetic;
    if (panda) {
      var wallNumber = /^m([1-9]|[1-3][0-9]|40)$/.test(id) ? Number(id.slice(1)) : 0;
      src = 'assets/avatars/panda-' + String(wallNumber || hash32(id) % 40 + 1).padStart(2, '0') + '.webp';
    }
    var level = Number(o.level) || 0;
    var frame = o.frame ? String(o.frame) : '';
    var stacked = o.stacked === true;
    var status = o.status ? String(o.status) : '';
    var showLetter = !panda && o.letter !== false && firstLetter(name);
    var label = name ? name + (statusName(status) ? ' · ' + statusName(status) : '') : (statusName(status) || '头像');
    var geo = geoSVG(id);
    var photo = src
      ? '<img class="ava-photo" src="' + window.Commons.safeUrl(src) + '" alt="" draggable="false">'
      : '';
    if (src) geo = geo.replace('class="ava-geo"', 'class="ava-geo" hidden');
    var LV = window.CommonsLevel;
    var useLevelSystem = level > 0 && !frame && LV && typeof LV.ringClass === 'function';
    var ringClass = useLevelSystem && !stacked ? LV.ringClass(level) : '';
    var ringCls = ringClass ? ' ' + ringClass : '';
    var levelAttrs = level > 0 && LV && typeof LV.attrs === 'function'
      ? LV.attrs(level)
      : 'data-level="' + esc(String(level || '')) + '"';
    var framePic = frame
      ? '<img class="ava-frame-pic" src="' + window.Commons.safeUrl(frame) + '" alt="" draggable="false">'
      : (useLevelSystem || stacked ? '' : frameSVG(level));
    var letter = showLetter ? '<span class="ava-letter" aria-hidden="true">' + esc(firstLetter(name)) + '</span>' : '';
    var st = statusName(status)
      ? '<span class="ava-dot" data-status="' + esc(status === 'in-room' ? 'room' : status) + '" title="' + esc(statusName(status)) + '"></span>'
      : '';
    return '<span class="ava' + /* safe: CommonsLevel 已逐值转义 */ ringCls + '" data-ava data-size="' + size + '" ' + /* safe: CommonsLevel 已逐值转义 */ levelAttrs +
      (status ? ' data-status="' + esc(status) + '"' : '') +
      ' style="--ava-size:' + size + 'px" role="img" aria-label="' + esc(label) + '">' +
      '<span class="ava-core">' + geo + photo + letter + '</span>' + framePic + st +
      '</span>';
  }

  function stack(people, opt) {
    people = people || [];
    opt = opt || {};
    var max = Number(opt.max);
    if (!max || max < 1) max = 4;
    var shown = people.slice(0, max);
    var extra = people.length - shown.length;
    var items = shown.map(function (p) {
      p = p || {};
      return html({ id: p.id, name: p.name, size: p.size || 32, src: p.src, level: p.level, frame: p.frame, status: p.status, letter: p.letter, stacked: true });
    }).join('');
    var more = extra > 0 ? '<span class="ava-more" aria-label="还有' + extra + '人">+' + extra + '</span>' : '';
    return '<span class="ava-stack">' + items + more + '</span>';
  }

  function meSaved() {
    if (!isDemo()) return null;
    var raw = read('avatar.me', null);
    return raw && typeof raw === 'object' ? raw : null;
  }

  function meLevel() {
    if (!isDemo()) return 0;
    var saved = meSaved();
    if (saved && saved.level) return Number(saved.level) || 2;
    var sample = window.COMMONS_GROWTH_SAMPLE;
    if (sample && sample.me && sample.me.level) return Number(sample.me.level) || 2;
    return 2;
  }

  function meName() {
    var saved = meSaved();
    if (saved && saved.name) return String(saved.name);
    if (window.CommonsMember && typeof window.CommonsMember.identity === 'function') {
      var idn = window.CommonsMember.identity();
      if (idn && idn.name) return idn.name;
    }
    return isDemo() && window.COMMONS_AVATAR_SAMPLE ? window.COMMONS_AVATAR_SAMPLE.names[0] : '我';
  }

  function meId() {
    var saved = meSaved();
    if (saved && saved.kind === 'geo' && saved.seed) return String(saved.seed);
    return 'me';
  }

  function meSrc() {
    var saved = meSaved();
    return saved && saved.kind === 'photo' && saved.src ? String(saved.src) : '';
  }

  function meFrame() {
    var saved = meSaved();
    return saved && saved.frameUrl ? String(saved.frameUrl) : '';
  }

  function meFrameKey() {
    var saved = meSaved();
    return saved && saved.frame ? String(saved.frame) : 'none';
  }

  function meHTML(size, extra) {
    extra = extra || {};
    return html({
      id: meId(),
      name: meName(),
      size: size || 40,
      src: extra.src != null ? extra.src : meSrc(),
      level: extra.level != null ? extra.level : (meFrameKey() === 'none' ? 0 : meLevel()),
      frame: extra.frame != null ? extra.frame : meFrame(),
      status: extra.status,
      letter: extra.letter
    });
  }

  function recentList() {
    if (!isDemo()) return [];
    var list = read('react.recent', []);
    return Array.isArray(list) ? list.filter(function (id) { return reactById[id]; }) : [];
  }

  function pushRecent(id) {
    var list = recentList().filter(function (x) { return x !== id });
    list.unshift(id);
    write('react.recent', list.slice(0, 8));
  }

  function iconReact(rec, size) {
    if (rec.icon) {
      var node = si(rec.icon, size || 16);
      if (node) return node;
    }
    if (rec.path) {
      return '<svg class="ava-react-svg" viewBox="0 0 24 24" width="' + esc(String(size || 16)) + '" height="' + esc(String(size || 16)) + '" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + esc(rec.path) + '"></path></svg>';
    }
    return '';
  }

  function memOf(targetId) {
    if (!reactMem[targetId]) reactMem[targetId] = { counts: {}, mine: {} };
    return reactMem[targetId];
  }

  function mergeCounts(targetId, counts, mine) {
    var mem = memOf(targetId);
    var key;
    if (counts && typeof counts === 'object') {
      for (key in counts) {
        if (Object.prototype.hasOwnProperty.call(counts, key) && reactById[key]) {
          mem.counts[key] = Number(counts[key]) || 0;
        }
      }
    }
    if (mine) {
      if (typeof mine === 'string') mem.mine[mine] = true;
      else if (Array.isArray(mine)) mine.forEach(function (k) { if (reactById[k]) mem.mine[k] = true; });
      else if (typeof mine === 'object') {
        for (key in mine) {
          if (Object.prototype.hasOwnProperty.call(mine, key) && reactById[key]) mem.mine[key] = !!mine[key];
        }
      }
    }
    return mem;
  }

  function bar(o) {
    o = o || {};
    var targetId = String(o.targetId || 'x');
    var readonly = !isDemo();
    var mem = mergeCounts(targetId, o.counts, o.mine);
    var shown = REACTIONS.filter(function (r) {
      return (mem.counts[r.id] || 0) > 0 || mem.mine[r.id];
    }).sort(function (a, b) {
      return (mem.counts[b.id] || 0) - (mem.counts[a.id] || 0);
    });
    var buttons = shown.map(function (r) {
      var n = mem.counts[r.id] || 0;
      var on = !!mem.mine[r.id];
      return '<button type="button" class="ava-react-btn"' + (readonly ? ' disabled' : '') + ' data-ava-act="react" data-id="' + esc(r.id) + '" data-target="' + esc(targetId) + '"' +
        ' aria-pressed="' + on + '" style="--ava-react:' + r.color + '" title="' + esc(r.label) + '">' +
        iconReact(r, 16) +
        (n ? '<span class="ava-react-n">' + esc(String(n)) + '</span>' : '') +
        '</button>';
    }).join('');
    var open = picker.target === targetId;
    return '<div class="ava-react" data-react-bar="' + esc(targetId) + '" role="toolbar" aria-label="表情反应">' +
      buttons +
      (readonly ? '' : '<button type="button" class="ava-react-plus" data-ava-act="react-open" data-target="' + esc(targetId) + '" aria-expanded="' + open + '" aria-haspopup="true" aria-label="添加反应">+</button>') +
      (open ? pickerHTML(targetId) : '') +
      '</div>';
  }

  function pickerHTML(targetId) {
    var mem = memOf(targetId);
    var recent = recentList();
    var ordered = REACTIONS.slice().sort(function (a, b) {
      var ia = recent.indexOf(a.id);
      var ib = recent.indexOf(b.id);
      if (ia === -1 && ib === -1) return 0;
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });
    return '<div class="ava-react-panel" data-react-panel="' + esc(targetId) + '" role="dialog" aria-label="选择反应">' +
      ordered.map(function (r) {
        var on = !!mem.mine[r.id];
        return '<button type="button" class="ava-react-pick" data-ava-act="react" data-id="' + esc(r.id) + '" data-target="' + esc(targetId) + '"' +
          ' aria-pressed="' + on + '" style="--ava-react:' + r.color + '">' +
          iconReact(r, 18) + '<span>' + esc(r.label) + '</span></button>';
      }).join('') +
      '</div>';
  }

  function paintBar(targetId, keepAct, keepId) {
    var nodes = document.querySelectorAll('[data-react-bar="' + targetId + '"]');
    var i;
    for (i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var wrap = document.createElement('div');
      wrap.innerHTML = bar({ targetId: targetId });
      var next = wrap.firstElementChild;
      if (next) el.replaceWith(next);
    }
    if (keepAct) {
      var sel = '[data-ava-act="' + keepAct + '"][data-target="' + targetId + '"]' + (keepId ? '[data-id="' + keepId + '"]' : '');
      var focus = document.querySelector(sel);
      if (focus && focus.focus) focus.focus({ preventScroll: true });
    }
  }

  function burstAt(btn) {
    if (!btn || reduced()) return;
    var pop = document.createElement('span');
    pop.className = 'ava-burst';
    pop.setAttribute('aria-hidden', 'true');
    pop.innerHTML = '<i></i><i></i><i></i><i></i><i></i>';
    btn.appendChild(pop);
    window.setTimeout(function () { if (pop.parentNode) pop.parentNode.removeChild(pop); }, 500);
  }

  function toggleReact(targetId, id, btn) {
    if (!isDemo()) return;
    if (!reactById[id]) return;
    var mem = memOf(targetId);
    if (mem.mine[id]) {
      mem.mine[id] = false;
      mem.counts[id] = Math.max(0, (mem.counts[id] || 1) - 1);
      if (!mem.counts[id]) delete mem.counts[id];
    } else {
      mem.mine[id] = true;
      mem.counts[id] = (mem.counts[id] || 0) + 1;
      pushRecent(id);
      burstAt(btn);
      if (id === 'useful') toast('对方的贡献值 +5，规则见等级制度');
    }
    var keepOpen = picker.target === targetId;
    paintBar(targetId, keepOpen ? 'react' : 'react', id);
    if (keepOpen) {
      picker.plus = document.querySelector('[data-ava-act="react-open"][data-target="' + targetId + '"]');
    }
  }

  function openPicker(targetId, plus) {
    if (!isDemo()) return;
    picker.target = targetId;
    picker.plus = plus;
    paintBar(targetId, 'react-open');
    var first = document.querySelector('[data-react-panel="' + targetId + '"] .ava-react-pick');
    if (first && first.focus) first.focus({ preventScroll: true });
  }

  function closePicker(restore) {
    var target = picker.target;
    var plus = picker.plus;
    picker.target = '';
    picker.plus = null;
    if (target) paintBar(target, restore ? 'react-open' : '');
    if (restore && plus && plus.focus) plus.focus({ preventScroll: true });
  }

  /* ---------- 编辑器 ---------- */

  function seedsForBatch(batch) {
    var out = [];
    var i;
    for (i = 0; i < 6; i++) out.push('seed-' + (batch * 6 + i + 1));
    return out;
  }

  function editorState() {
    if (!editor) {
      var saved = meSaved();
      editor = {
        tab: 'gen',
        batch: 0,
        seed: saved && saved.kind === 'geo' && saved.seed ? saved.seed : seedsForBatch(0)[0],
        frame: saved && saved.frame ? saved.frame : 'none',
        error: '',
        src: saved && saved.kind === 'photo' ? saved.src : ''
      };
    }
    return editor;
  }

  function frameNeed(lv) {
    if (lv <= 2) return '';
    if (lv === 3) return '升到 L3 骨干（近 60 天过半活跃、内容被采纳 5 次、举报准确率达标）';
    if (lv === 4) return '升到 L4 领航员（达标后由治理员复核）';
    return '由治理委员会授予 L5 先锋';
  }

  function editorInner() {
    var st = editorState();
    var mine = meLevel();
    var tabs = [
      ['gen', '生成的'],
      ['upload', '上传'],
      ['frame', '头像框']
    ];
    var body = '';
    if (st.tab === 'gen') {
      body = '<div class="ava-ed-grid" role="listbox" aria-label="生成的头像">' +
        seedsForBatch(st.batch).map(function (seed) {
          var on = st.seed === seed;
          return '<button type="button" class="ava-ed-pick" data-ava-act="pick-seed" data-id="' + esc(seed) + '" role="option" aria-selected="' + on + '">' +
            html({ id: seed, name: meName(), size: 56, level: 0, letter: true }) +
            '</button>';
        }).join('') +
        '</div>' +
        '<div class="ava-ed-row">' +
        '<button type="button" class="button ghost" data-ava-act="reshuffle">换一批</button>' +
        '<button type="button" class="button primary" data-ava-act="save-geo">用这个</button>' +
        '</div>';
    } else if (st.tab === 'upload') {
      body = '<div class="field">' +
        '<label for="ava-file">从本机选一张图</label>' +
        '<input id="ava-file" type="file" accept="image/*" data-ava-form="file">' +
        '<small>只在这台浏览器里裁剪，导出 256×256。演示存本机，不上传。</small>' +
        '</div>' +
        (st.error ? '<p class="ava-ed-err" role="alert">' + esc(st.error) + '</p>' : '') +
        '<div class="ava-crop" data-ava-crop tabindex="0" role="application" aria-label="圆形裁剪，拖动平移，滚轮缩放，方向键微调"' + (crop && crop.ready ? '' : ' hidden') + '>' +
        '<div class="ava-crop-stage"><img class="ava-crop-img" alt="" draggable="false"></div>' +
        '</div>' +
        '<div class="ava-crop-previews" ' + (crop && crop.ready ? '' : 'hidden') + '>' +
        '<span data-preview="96"></span><span data-preview="40"></span><span data-preview="24"></span>' +
        '</div>' +
        '<div class="ava-ed-row">' +
        '<button type="button" class="button primary" data-ava-act="save-photo"' + (crop && crop.ready ? '' : ' disabled') + '>保存裁剪</button>' +
        '</div>';
    } else {
      body = '<ul class="ava-ed-frames">' + LEVELS.map(function (lv) {
        var key = lv.frame;
        var locked = mine < lv.level && key !== 'none';
        if (lv.level <= 2 && key === 'none' && lv.level === 2) return '';
        if (lv.level === 1) {
          locked = false;
          key = 'none';
        }
        var on = st.frame === key && !locked;
        var need = locked ? frameNeed(lv.level) : '';
        return '<li>' +
          '<button type="button" class="ava-ed-frame" data-ava-act="pick-frame" data-id="' + esc(key) + '"' +
          (locked ? ' disabled data-state="disabled"' : '') +
          ' aria-pressed="' + on + '">' +
          html({ id: meId(), name: meName(), size: 56, src: meSrc(), level: key === 'none' ? 0 : lv.level, letter: true }) +
          '<span><b>' + (key === 'none' ? '无框' : ('L' + lv.level + ' · ' + esc(lv.name))) + '</b>' +
          (locked ? '<small>' + si('blocked', 14) + '还差：' + esc(need) + '</small>' : '<small>' + esc(lv.how) + '</small>') +
          '</span></button></li>';
      }).join('') + '</ul>' +
        '<div class="ava-ed-row"><button type="button" class="button primary" data-ava-act="save-frame">保存头像框</button></div>';
    }
    return '<div class="ava-editor" data-ava-editor data-tab="' + esc(st.tab) + '">' +
      '<p class="ava-kicker">示例 · 我的等级 L' + esc(String(mine)) + ' ' + esc((LEVELS[mine - 1] || {}).name || '') + '</p>' +
      '<div class="segmented" role="tablist" aria-label="编辑方式">' +
      tabs.map(function (t) {
        return '<button type="button" role="tab" data-ava-act="ed-tab" data-id="' + t[0] + '" aria-selected="' + (st.tab === t[0]) + '">' + t[1] + '</button>';
      }).join('') +
      '</div>' + body + '</div>';
  }

  function paintEditor() {
    var body = document.getElementById('dialog-body');
    if (!body || !body.querySelector('[data-ava-editor]')) return;
    var act = document.activeElement;
    var keep = act && act.getAttribute && act.getAttribute('data-ava-act');
    var keepId = act && act.dataset ? act.dataset.id : '';
    body.innerHTML = editorInner();
    bindCropDom();
    if (keep) {
      var next = body.querySelector('[data-ava-act="' + keep + '"]' + (keepId ? '[data-id="' + keepId + '"]' : ''));
      if (next && next.focus) next.focus({ preventScroll: true });
    }
  }

  function openEditor() {
    if (!isDemo()) { window.location.hash = '#/account'; return; }
    editor = null;
    crop = null;
    editorState();
    modal('编辑我的头像', editorInner());
    bindCropDom();
  }

  function bindCropDom() {
    if (!crop || !crop.img) return;
    var stage = document.querySelector('[data-ava-crop]');
    if (!stage) return;
    var img = stage.querySelector('.ava-crop-img');
    if (img) {
      img.src = crop.url;
      crop.node = img;
    }
    applyCrop();
  }

  function setCropError(msg) {
    editorState().error = msg;
    crop = null;
    paintEditor();
  }

  function loadFile(file) {
    editorState().error = '';
    if (!file) return;
    if (!file.type || file.type.indexOf('image/') !== 0) {
      setCropError('这份文件不是图片。请选 jpg、png、webp 这类常见格式。');
      return;
    }
    if (file.size > FILE_MAX) {
      setCropError('图片太大了（超过 8MB）。换一张小一点的，或先压缩再选。');
      return;
    }
    var reader = new FileReader();
    reader.onerror = function () { setCropError('这张图读不出来。文件可能坏了，换一张试试。'); };
    reader.onload = function () {
      var url = String(reader.result || '');
      var img = new Image();
      img.onload = function () {
        crop = {
          img: img,
          url: url,
          ready: true,
          scale: 1,
          x: 0,
          y: 0,
          drag: false,
          lastX: 0,
          lastY: 0,
          pinch: 0
        };
        editorState().error = '';
        paintEditor();
      };
      img.onerror = function () { setCropError('这张图读不出来。文件可能坏了，换一张试试。'); };
      img.src = url;
    };
    reader.readAsDataURL(file);
  }

  function stageSize() {
    var stage = document.querySelector('.ava-crop-stage');
    return stage ? stage.clientWidth : 240;
  }

  function coverScale() {
    if (!crop || !crop.img) return 1;
    var s = stageSize();
    return Math.max(s / crop.img.naturalWidth, s / crop.img.naturalHeight);
  }

  function clampCrop() {
    if (!crop || !crop.img) return;
    var s = stageSize();
    var sc = coverScale() * crop.scale;
    var w = crop.img.naturalWidth * sc;
    var h = crop.img.naturalHeight * sc;
    var maxX = Math.max(0, (w - s) / 2);
    var maxY = Math.max(0, (h - s) / 2);
    crop.x = Math.max(-maxX, Math.min(maxX, crop.x));
    crop.y = Math.max(-maxY, Math.min(maxY, crop.y));
    if (crop.scale < 1) crop.scale = 1;
    if (crop.scale > 4) crop.scale = 4;
  }

  function applyCrop() {
    if (!crop || !crop.ready) return;
    clampCrop();
    var img = document.querySelector('.ava-crop-img');
    if (img) {
      var sc = coverScale() * crop.scale;
      img.style.width = (crop.img.naturalWidth * sc) + 'px';
      img.style.height = (crop.img.naturalHeight * sc) + 'px';
      img.style.transform = 'translate(' + crop.x + 'px,' + crop.y + 'px)';
    }
    paintCropPreviews();
  }

  function drawCrop(out) {
    if (!crop || !crop.img) return '';
    var canvas = document.createElement('canvas');
    canvas.width = out;
    canvas.height = out;
    var ctx = canvas.getContext('2d');
    if (!ctx) return '';
    ctx.beginPath();
    ctx.arc(out / 2, out / 2, out / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    var s = stageSize();
    var sc = coverScale() * crop.scale;
    var dw = crop.img.naturalWidth * sc * (out / s);
    var dh = crop.img.naturalHeight * sc * (out / s);
    var dx = (out - dw) / 2 + crop.x * (out / s);
    var dy = (out - dh) / 2 + crop.y * (out / s);
    ctx.drawImage(crop.img, dx, dy, dw, dh);
    return canvas;
  }

  function paintCropPreviews() {
    var canvas = drawCrop(96);
    if (!canvas) return;
    [96, 40, 24].forEach(function (n) {
      var host = document.querySelector('[data-preview="' + n + '"]');
      if (!host) return;
      host.innerHTML = html({ id: 'crop', name: meName(), size: n, src: canvas.toDataURL('image/jpeg', 0.88), level: 0, letter: false });
    });
  }

  function exportPhoto() {
    var canvas = drawCrop(256);
    if (!canvas) return '';
    var q = 0.9;
    var url = canvas.toDataURL('image/jpeg', q);
    while (url.length * 0.75 > STORE_MAX && q > 0.55) {
      q -= 0.08;
      url = canvas.toDataURL('image/jpeg', q);
    }
    if (url.length * 0.75 > STORE_MAX) {
      var small = document.createElement('canvas');
      small.width = 192;
      small.height = 192;
      var ctx = small.getContext('2d');
      if (ctx) {
        ctx.drawImage(canvas, 0, 0, 192, 192);
        url = small.toDataURL('image/jpeg', 0.8);
      }
    }
    return url;
  }

  function postUpload(blob) {
    /* live 模式以后走 POST /api/uploads。演示不发请求。 */
    void blob;
    return Promise.resolve({ ok: false, demo: true });
  }

  function saveMe(data) {
    if (!isDemo()) { window.location.hash = '#/account'; return; }
    var prev = meSaved() || {};
    var next = {
      kind: data.kind,
      seed: data.seed || prev.seed || meId(),
      src: data.src || '',
      frame: data.frame || prev.frame || 'none',
      frameUrl: data.frameUrl || prev.frameUrl || '',
      name: meName(),
      level: meLevel(),
      savedAt: new Date().toISOString()
    };
    write('avatar.me', next);
    closeModal();
    toast('头像已保存在这台浏览器里。');
    paintLab();
  }

  /* ---------- 演示页 ---------- */

  /* ---------- 事件 ---------- */

  function onClick(event) {
    var btn = event.target.closest('[data-ava-act]');
    if (!btn) {
      if (picker.target && !event.target.closest('[data-react-panel], [data-ava-act="react-open"]')) closePicker(false);
      return;
    }
    var act = btn.getAttribute('data-ava-act');
    var id = btn.dataset.id || '';
    var target = btn.dataset.target || '';
    if (act === 'edit') {
      openEditor();
      return;
    }
    if (act === 'ed-tab') {
      editorState().tab = id;
      paintEditor();
      return;
    }
    if (act === 'reshuffle') {
      editorState().batch += 1;
      editorState().seed = seedsForBatch(editorState().batch)[0];
      paintEditor();
      return;
    }
    if (act === 'pick-seed') {
      editorState().seed = id;
      paintEditor();
      return;
    }
    if (act === 'save-geo') {
      saveMe({ kind: 'geo', seed: editorState().seed, src: '', frame: editorState().frame });
      return;
    }
    if (act === 'save-photo') {
      if (!crop || !crop.ready) return;
      var src = exportPhoto();
      if (!src) {
        editorState().error = '裁剪没有完成。图还在，请再试一次。';
        paintEditor();
        return;
      }
      postUpload(null);
      saveMe({ kind: 'photo', src: src, seed: meId(), frame: editorState().frame });
      return;
    }
    if (act === 'pick-frame') {
      if (btn.disabled) return;
      editorState().frame = id;
      paintEditor();
      return;
    }
    if (act === 'save-frame') {
      var saved = meSaved() || {};
      saveMe({
        kind: saved.kind || 'geo',
        seed: saved.seed || meId(),
        src: saved.src || '',
        frame: editorState().frame
      });
      return;
    }
    if (act === 'react-open') {
      if (picker.target === target) closePicker(true);
      else openPicker(target, btn);
      return;
    }
    if (act === 'react') {
      toggleReact(target, id, btn);
    }
  }

  function onChange(event) {
    var input = event.target.closest('[data-ava-form="file"]');
    if (!input) return;
    loadFile(input.files && input.files[0]);
    input.value = '';
  }

  function onKey(event) {
    if (event.key === 'Escape' && picker.target) {
      event.preventDefault();
      closePicker(true);
      return;
    }
    var cropEl = event.target.closest('[data-ava-crop]');
    if (cropEl && crop && crop.ready) {
      var step = event.shiftKey ? 8 : 2;
      if (event.key === 'ArrowLeft') { event.preventDefault(); crop.x -= step; applyCrop(); }
      if (event.key === 'ArrowRight') { event.preventDefault(); crop.x += step; applyCrop(); }
      if (event.key === 'ArrowUp') { event.preventDefault(); crop.y -= step; applyCrop(); }
      if (event.key === 'ArrowDown') { event.preventDefault(); crop.y += step; applyCrop(); }
      return;
    }
    var barEl = event.target.closest('[data-react-bar], [data-react-panel]');
    if (!barEl) return;
    var keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'Enter', ' '];
    if (keys.indexOf(event.key) === -1) return;
    var items = [].slice.call(barEl.querySelectorAll('button'));
    var i = items.indexOf(document.activeElement);
    if (event.key === 'Enter' || event.key === ' ') return;
    event.preventDefault();
    if (!items.length) return;
    if (event.key === 'Home') { items[0].focus(); return; }
    if (event.key === 'End') { items[items.length - 1].focus(); return; }
    var dir = (event.key === 'ArrowLeft' || event.key === 'ArrowUp') ? -1 : 1;
    var next = items[(i + dir + items.length) % items.length];
    if (next) next.focus();
  }

  function onPointerDown(event) {
    var stage = event.target.closest('[data-ava-crop]');
    if (!stage || !crop || !crop.ready) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    crop.drag = true;
    crop.lastX = event.clientX;
    crop.lastY = event.clientY;
    stage.setPointerCapture && stage.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event) {
    if (!crop || !crop.ready || !crop.drag) return;
    crop.x += event.clientX - crop.lastX;
    crop.y += event.clientY - crop.lastY;
    crop.lastX = event.clientX;
    crop.lastY = event.clientY;
    applyCrop();
  }

  function onPointerUp() {
    if (crop) crop.drag = false;
  }

  function onWheel(event) {
    var stage = event.target.closest('[data-ava-crop]');
    if (!stage || !crop || !crop.ready) return;
    event.preventDefault();
    var delta = event.deltaY > 0 ? 0.92 : 1.08;
    crop.scale *= delta;
    applyCrop();
  }

  function onTouchStart(event) {
    var stage = event.target.closest('[data-ava-crop]');
    if (!stage || !crop || !crop.ready) return;
    if (event.touches.length === 2) {
      var a = event.touches[0];
      var b = event.touches[1];
      var dx = a.clientX - b.clientX;
      var dy = a.clientY - b.clientY;
      crop.pinch = Math.sqrt(dx * dx + dy * dy);
      crop.drag = false;
    }
  }

  function onTouchMove(event) {
    var stage = event.target.closest('[data-ava-crop]');
    if (!stage || !crop || !crop.ready) return;
    if (event.touches.length === 2 && crop.pinch) {
      event.preventDefault();
      var a = event.touches[0];
      var b = event.touches[1];
      var dx = a.clientX - b.clientX;
      var dy = a.clientY - b.clientY;
      var d = Math.sqrt(dx * dx + dy * dy);
      crop.scale *= d / crop.pinch;
      crop.pinch = d;
      applyCrop();
    }
  }

  function onPhotoError(event) {
    var img = event.target;
    if (!img || img.tagName !== 'IMG' || !img.classList || !img.classList.contains('ava-photo')) return;
    img.hidden = true;
    var geo = img.previousElementSibling;
    if (geo) geo.hidden = false;
  }

  if (!window.__commonsAvaPhotoBound) {
    window.__commonsAvaPhotoBound = true;
    document.addEventListener('error', onPhotoError, true);
  }

  function mount() {
    if (!bound) {
      document.addEventListener('click', onClick);
      document.addEventListener('change', onChange);
      document.addEventListener('keydown', onKey);
      document.addEventListener('pointerdown', onPointerDown);
      document.addEventListener('pointermove', onPointerMove);
      document.addEventListener('pointerup', onPointerUp);
      document.addEventListener('pointercancel', onPointerUp);
      document.addEventListener('wheel', onWheel, { passive: false });
      document.addEventListener('touchstart', onTouchStart, { passive: true });
      document.addEventListener('touchmove', onTouchMove, { passive: false });
      bound = true;
    }
    if (!document.querySelector('[data-avatar-lab]')) return;
  }

  function destroy() {
    if (!bound) return;
    document.removeEventListener('click', onClick);
    document.removeEventListener('change', onChange);
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('pointerdown', onPointerDown);
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerup', onPointerUp);
    document.removeEventListener('pointercancel', onPointerUp);
    document.removeEventListener('wheel', onWheel);
    document.removeEventListener('touchstart', onTouchStart);
    document.removeEventListener('touchmove', onTouchMove);
    bound = false;
    picker.target = '';
    picker.plus = null;
    editor = null;
    crop = null;
  }

  window.CommonsAvatar = {
    routes: { 'avatar-lab': labPage },
    hub: ['avatar-lab'],
    nav: [['avatar-lab', '头像与表情', 'smile', 'personal']],
    icons: { smile: 'M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18' },
    html: html,
    stack: stack,
    openEditor: openEditor,
    mount: mount,
    destroy: destroy
  };

  window.CommonsReact = {
    bar: bar,
    list: REACTIONS.map(function (r) { return { id: r.id, label: r.label }; })
  };

  (window.CommonsPages = window.CommonsPages || []).push(window.CommonsAvatar);
})();
