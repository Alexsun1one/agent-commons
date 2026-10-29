/* R13 EDT-1 · 分享卡 window.CommonsShare
   在浏览器里用 canvas 画分享图：竖版 1080×1350、横版 1200×630。颜色和字体全部运行时从 tokens.css 的变量读取。
   只有可见范围为「公开」的对象才画标题、摘要和作者；其他范围一律画通用卡（站点名 +「来自先锋社区的一篇内容」），
   通用卡的几何图案用固定种子，不由标题生成（蓝图 §10）。
   对话框样式在 reader.css 的 .shr-*；点击只用 data-shr-act。 */
(function () {
  'use strict';
  var G = window;
  var FORMATS = {
    portrait: { w: 1080, h: 1350, label: '竖版 1080×1350' },
    landscape: { w: 1200, h: 630, label: '横版 1200×630' }
  };
  var GENERIC = {
    title: '来自先锋社区的一篇内容',
    summary: '这篇内容只对社区成员开放。登录后打开链接查看。',
    seed: 'agent-commons-generic'
  };
  var KIND = { knowledge: '知识条目', discussion: '讨论', work: '作品说明', reply: '回复' };
  var LEVELS = { 1: '新队员', 2: '队员', 3: '骨干', 4: '领航员', 5: '先锋' };
  var MARK_A = 'M29.2 7.5c1.3-2.1 4.3-2.1 5.6 0L45 23.6c.6.9.3 1.7-.7 2.2l-11.1 5.7c-1.5.8-2.5 1.8-3.4 3.3L17.5 55.9c-.8 1.4-1.9 2.1-3.5 2.1H7c-2.4 0-3.5-1.9-2.2-4L29.2 7.5Z';
  var MARK_B = 'm46.3 28.4 14.5 25.5c1.3 2.3.2 4.1-2.4 4.1h-9.8c-1.7 0-2.7-.6-3.6-2l-7.5-12c-1.7-2.7-4.2-3-6.8-.8l-3.8 3.2 6.8-10.8c.5-.9 1.3-1.7 2.3-2.2l10.3-5Z';

  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"'`]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }[c]; }); }
  /* safe-fn: CommonsLinks.person 自行转义；退路对名字 esc、handle encodeURIComponent */
  function personLink(handle, name, level) {
    if (G.CommonsLinks && typeof G.CommonsLinks.person === 'function') {
      return G.CommonsLinks.person(handle, name, { level: level });
    }
    return handle ? '<a class="lk-person" href="#/u/' + encodeURIComponent(handle) + '">' + esc(name) + '</a>' : esc(name);
  }
  function siteHash(o) {
    o = o || {};
    if (o.hash && String(o.hash).indexOf('#/') === 0) return String(o.hash);
    if (o.url && String(o.url).charAt(0) === '#') return String(o.url);
    var kind = o.kind || 'knowledge';
    var route = kind === 'discussion' || kind === 'reply' ? 'threads' : kind === 'work' ? 'html-lab' : 'knowledge';
    var id = o.id || '';
    return id ? '#/' + route + '/' + encodeURIComponent(id) : '#/' + route;
  }
  function canPaintImage() {
    return location.protocol !== 'file:';
  }

  /* ---------- 颜色与字体：只从 CSS 变量取 ---------- */
  function tokens() {
    var cs = getComputedStyle(document.documentElement);
    var get = function (n) { return cs.getPropertyValue(n).trim(); };
    var t = {
      surface: get('--surface'), paper: get('--paper'), sunk: get('--sunk'), ink: get('--ink'), ink2: get('--ink-2'), muted: get('--muted'), faint: get('--faint'),
      line: get('--line'), accent: get('--accent'), accentInk: get('--accent-ink'), accentSoft: get('--accent-soft'),
      tintBlue: get('--tint-blue'), tintTeal: get('--tint-teal'), tintViolet: get('--tint-violet'),
      display: get('--display'), sans: get('--sans'), mono: get('--mono'),
      strong: ['--blue-600', '--blue-400', '--teal-500', '--teal-400', '--violet-500', '--violet-400', '--cat-1', '--cat-3', '--cat-5', '--sky-400'].map(get),
      soft: ['--blue-100', '--blue-200', '--teal-100', '--teal-200', '--violet-100', '--violet-200', '--sky-100', '--sky-200'].map(get)
    };
    var missing = !t.surface || !t.ink || !t.accent || !t.display || t.strong.some(function (x) { return !x; }) || t.soft.some(function (x) { return !x; });
    return missing ? null : t;
  }

  /* ---------- 种子随机 ---------- */
  function hash(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function rng(seed) {
    var a = hash(String(seed)) || 1;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* 由种子生成的抽象几何：方格里放四分之一圆、半圆、圆、环、三角、条纹 */
  function pattern(ctx, t, seed, x, y, w, h, radius) {
    var rand = rng(seed);
    var pick = function (list) { return list[Math.floor(rand() * list.length)]; };
    ctx.save();
    roundRect(ctx, x, y, w, h, radius);
    ctx.clip();
    ctx.fillStyle = t.tintBlue;
    ctx.fillRect(x, y, w, h);
    var rows = 4;
    var cell = h / rows;
    var cols = Math.ceil(w / cell);
    var ox = x + (w - cols * cell) / 2;
    var shapes = ['quarter', 'quarter', 'half', 'circle', 'ring', 'tri', 'stripes', 'square', 'blank'];
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        var cx = ox + c * cell, cy = y + r * cell;
        var shape = pick(shapes);
        if (rand() < 0.55) { ctx.fillStyle = pick(t.soft); ctx.fillRect(cx, cy, cell + 0.5, cell + 0.5); }
        ctx.fillStyle = pick(t.strong);
        ctx.strokeStyle = ctx.fillStyle;
        var turn = Math.floor(rand() * 4);
        ctx.save();
        ctx.translate(cx + cell / 2, cy + cell / 2);
        ctx.rotate(turn * Math.PI / 2);
        ctx.translate(-cell / 2, -cell / 2);
        ctx.beginPath();
        if (shape === 'quarter') { ctx.moveTo(0, 0); ctx.arc(0, 0, cell, 0, Math.PI / 2); ctx.closePath(); ctx.fill(); }
        else if (shape === 'half') { ctx.arc(cell / 2, cell, cell / 2, Math.PI, 0); ctx.closePath(); ctx.fill(); }
        else if (shape === 'circle') { ctx.arc(cell / 2, cell / 2, cell * 0.34, 0, Math.PI * 2); ctx.fill(); }
        else if (shape === 'ring') { ctx.lineWidth = cell * 0.09; ctx.arc(cell / 2, cell / 2, cell * 0.3, 0, Math.PI * 2); ctx.stroke(); }
        else if (shape === 'tri') { ctx.moveTo(0, 0); ctx.lineTo(cell, cell); ctx.lineTo(0, cell); ctx.closePath(); ctx.fill(); }
        else if (shape === 'stripes') {
          ctx.lineWidth = cell * 0.07; ctx.lineCap = 'round';
          for (var k = 1; k <= 3; k++) { ctx.moveTo(cell * 0.18, cell * k / 4); ctx.lineTo(cell * 0.82, cell * k / 4); }
          ctx.stroke();
        } else if (shape === 'square') { ctx.fillRect(cell * 0.22, cell * 0.22, cell * 0.56, cell * 0.56); }
        ctx.restore();
      }
    }
    ctx.restore();
  }

  /* ---------- 文字排版：中文逐字、西文按词，超行加省略号 ---------- */
  function units(text) {
    var out = [];
    var re = /[A-Za-z0-9_\-./:@#%&+]+\s*|\s+|[^\s]/g;
    var m;
    while ((m = re.exec(text))) out.push(m[0]);
    return out;
  }
  function wrap(ctx, text, maxW, maxLines) {
    var parts = units(String(text || '').replace(/\s+/g, ' ').trim());
    var lines = [];
    var line = '';
    for (var i = 0; i < parts.length; i++) {
      var next = line + parts[i];
      if (ctx.measureText(next.trimEnd()).width <= maxW || !line) { line = next; continue; }
      lines.push(line.trimEnd());
      line = parts[i].trimStart();
      if (lines.length === maxLines) { line = ''; lines.truncated = true; break; }
    }
    if (line && lines.length < maxLines) lines.push(line.trimEnd());
    else if (line) lines.truncated = true;
    if (lines.truncated && lines.length) {
      var last = lines[lines.length - 1];
      while (last && ctx.measureText(last + '…').width > maxW) last = last.slice(0, -1);
      lines[lines.length - 1] = last + '…';
    }
    return lines;
  }
  function font(weight, size, family) { return weight + ' ' + size + 'px ' + family; }

  function mark(ctx, t, x, y, size) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(size / 64, size / 64);
    ctx.fillStyle = t.accent;
    ctx.fill(new Path2D(MARK_A));
    ctx.fillStyle = t.ink;
    ctx.fill(new Path2D(MARK_B));
    ctx.restore();
  }

  function pill(ctx, t, text, x, y, size) {
    ctx.font = font(600, size, t.sans);
    var w = ctx.measureText(text).width + size * 1.4;
    var h = size * 1.9;
    roundRect(ctx, x - w, y, w, h, h / 2);
    ctx.fillStyle = t.surface;
    ctx.fill();
    ctx.fillStyle = t.ink2;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x - w + size * 0.7, y + h / 2 + 1);
    ctx.textBaseline = 'alphabetic';
  }

  function qr(ctx, t, text, right, bottom, maxSize) {
    if (!text || !G.CommonsQR || typeof G.CommonsQR.svg !== 'function') return;
    var source = G.CommonsQR.svg(text, { label: '分享链接二维码' });
    var box = source.match(/viewBox="0 0 (\d+) (\d+)"/);
    var path = source.match(/<path fill="currentColor" d="([^"]+)"/);
    if (!box || !path || typeof Path2D !== 'function') return;
    var side = Number(box[1]);
    var unit = Math.max(1, Math.floor(maxSize / side));
    var size = side * unit;
    var x = right - size;
    var y = bottom - size;
    ctx.fillStyle = t.surface;
    ctx.fillRect(x, y, size, size);
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(unit, unit);
    ctx.fillStyle = t.ink;
    ctx.fill(new Path2D(path[1]));
    ctx.restore();
  }

  /* 卡片内容：公开 → 标题卡；其他 → 通用卡。返回实际要画的字段 */
  function content(o) {
    o = o || {};
    var scope = o.visibility && typeof o.visibility === 'object' ? o.visibility.scope : o.visibility;
    var open = scope === 'public';
    if (!open) return { kind: 'generic', eyebrow: '先锋社区', title: GENERIC.title, summary: GENERIC.summary, author: null, seed: GENERIC.seed, sample: !!o.sample, href: siteHash(o) };
    var author = o.author && typeof o.author === 'object' ? o.author : null;
    return {
      kind: 'titled',
      eyebrow: KIND[o.kind] || '内容',
      title: String(o.title || '未命名').slice(0, 140),
      summary: String(o.summary || '').slice(0, 240),
      author: author ? { name: String(author.name || '成员').slice(0, 16), level: Number(author.level) || 0, handle: String(author.handle || '') } : null,
      seed: 'title:' + String(o.title || ''),
      sample: !!o.sample,
      href: siteHash(o)
    };
  }

  function draw(canvas, o) {
    var t = tokens();
    if (!t || !canvas || !canvas.getContext) return false;
    var f = FORMATS[o && o.format] || FORMATS.portrait;
    var c = content(o);
    var link = linkOf(o);
    canvas.width = f.w;
    canvas.height = f.h;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = t.surface;
    ctx.fillRect(0, 0, f.w, f.h);
    var portrait = f === FORMATS.portrait;
    var M = portrait ? 72 : 48;
    var art = portrait ? { x: M, y: M, w: f.w - M * 2, h: c.kind === 'generic' ? 720 : 600 } : { x: M, y: M, w: 420, h: f.h - M * 2 };
    pattern(ctx, t, c.seed, art.x, art.y, art.w, art.h, portrait ? 32 : 24);
    qr(ctx, t, link, art.x + art.w - 20, art.y + art.h - 20, portrait ? 144 : 112);
    /* file:// 下不把图片画进 canvas，保持图案底图 */
    if (canPaintImage() && o && o.image) { /* 现网也不画外图，只保留图案 */ }
    if (c.sample) pill(ctx, t, '示例', art.x + art.w - 20, art.y + 20, portrait ? 24 : 20);

    var tx = portrait ? M : art.x + art.w + 56;
    var tw = f.w - tx - M;
    var y = portrait ? art.y + art.h + 84 : M + 52;
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = t.accentInk;
    ctx.font = font(600, portrait ? 28 : 22, t.sans);
    ctx.fillText(c.eyebrow, tx, y);

    var ts = portrait ? 60 : 48;
    var tl = portrait ? 76 : 60;
    ctx.font = font(700, ts, t.display);
    ctx.fillStyle = t.ink;
    var titleLines = wrap(ctx, c.title, tw, 3);
    y += portrait ? 34 : 26;
    titleLines.forEach(function (line) { y += tl; ctx.fillText(line, tx, y - (tl - ts) / 2); });

    if (c.summary) {
      var ss = portrait ? 32 : 26;
      var sl = portrait ? 50 : 40;
      ctx.font = font(400, ss, t.sans);
      ctx.fillStyle = t.muted;
      y += portrait ? 22 : 16;
      wrap(ctx, c.summary, tw, portrait ? 3 : 2).forEach(function (line) { y += sl; ctx.fillText(line, tx, y - (sl - ss) / 2); });
    }

    var fy = f.h - M;
    ctx.strokeStyle = t.line;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(tx, fy - (portrait ? 96 : 76));
    ctx.lineTo(tx + tw, fy - (portrait ? 96 : 76));
    ctx.stroke();
    var my = fy - (portrait ? 48 : 36);
    var ms = portrait ? 48 : 38;
    if (c.author) {
      ctx.fillStyle = t.accentSoft;
      ctx.beginPath();
      ctx.arc(tx + ms / 2, my, ms / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = t.accentInk;
      ctx.font = font(600, ms * 0.46, t.sans);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(c.author.name.slice(0, 1), tx + ms / 2, my + 1);
      ctx.textAlign = 'left';
      ctx.fillStyle = t.ink;
      ctx.font = font(600, portrait ? 28 : 22, t.sans);
      ctx.fillText(c.author.name, tx + ms + 16, my - (portrait ? 14 : 11));
      ctx.fillStyle = t.muted;
      ctx.font = font(400, portrait ? 22 : 18, t.sans);
      ctx.fillText(c.author.level ? 'L' + c.author.level + ' ' + (LEVELS[c.author.level] || '') : '社区成员', tx + ms + 16, my + (portrait ? 18 : 14));
      ctx.textBaseline = 'alphabetic';
    } else {
      ctx.fillStyle = t.muted;
      ctx.font = font(400, portrait ? 24 : 20, t.sans);
      ctx.textBaseline = 'middle';
      ctx.fillText('可见范围由作者决定 · 不在图里展示标题', tx, my);
      ctx.textBaseline = 'alphabetic';
    }
    ctx.font = font(700, portrait ? 30 : 24, t.display);
    var brand = '先锋社区';
    var bw = ctx.measureText(brand).width;
    var bx = tx + tw - bw;
    ctx.fillStyle = t.ink;
    ctx.textBaseline = 'middle';
    ctx.fillText(brand, bx, my + 1);
    ctx.textBaseline = 'alphabetic';
    mark(ctx, t, bx - ms - 12, my - ms / 2, ms);
    if (link) {
      ctx.textAlign = 'left';
      ctx.fillStyle = t.faint || t.muted;
      ctx.font = font(400, portrait ? 20 : 16, t.mono || t.sans);
      ctx.textBaseline = 'alphabetic';
      var hrefY = f.h - (portrait ? 28 : 20);
      ctx.fillText(String(link).slice(0, 64), tx, hrefY);
    }
    return true;
  }

  function render(o) {
    var canvas = document.createElement('canvas');
    if (!draw(canvas, o)) return null;
    return { canvas: canvas, url: canvas.toDataURL('image/png'), kind: content(o).kind, width: canvas.width, height: canvas.height };
  }

  function png(o) {
    return new Promise(function (resolve, reject) {
      var r = render(o);
      if (!r) { reject(new Error('tokens')); return; }
      r.canvas.toBlob(function (blob) { if (blob) { r.blob = blob; resolve(r); } else reject(new Error('blob')); }, 'image/png');
    });
  }

  /* ---------- 对话框 ---------- */
  var live = null;

  function linkOf(o) {
    var hash = siteHash(o);
    if (location.protocol === 'file:') return hash;
    return String(location.href).split('#')[0] + hash;
  }

  function shell(o) {
    var c = content(o);
    var compare = o.compare && c.kind === 'generic';
    var scopeLabel = o.scopeLabel ? '「' + o.scopeLabel + '」' : '非公开';
    var segs = Object.keys(FORMATS).map(function (k) {
      return '<button type="button" data-shr-act="format" data-format="' + k + '" aria-pressed="' + (k === live.format) + '">' + esc(FORMATS[k].label) + '</button>';
    }).join('');
    var card = function (which, title, note) {
      return '<figure class="shr-card" data-shr-card="' + esc(which) + '"><div class="shr-img" data-format="' + esc(live.format) + '"><p class="shr-wait">正在画…</p></div>' +
        '<figcaption><b>' + esc(title) + '</b><span>' + esc(note) + '</span></figcaption>' +
        '<button type="button" class="button small" data-shr-act="copy-image" data-which="' + esc(which) + '">复制图片</button></figure>';
    };
    var actualNote = c.kind === 'generic'
      ? '可见范围是' + scopeLabel + '，图里只有站点名和一句通用说明，不放标题、摘要和作者。'
      : '这篇是公开的，图里带标题、摘要和作者。';
    return '<div class="shr-head"><h2 id="shr-title">分享这篇</h2><button type="button" class="button ghost icon-only" data-shr-act="close" aria-label="关闭">' +
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>' +
      '<div class="shr-body">' +
        '<div class="shr-bar"><div class="segmented" role="group" aria-label="图片尺寸">' + segs + '</div>' + (o.sample !== false && !(window.CommonsAPI && window.CommonsAPI.mode === 'live') ? '<span class="pill">示例</span>' : '') + '</div>' +
        '<div class="shr-grid' + (compare ? ' is-compare' : '') + '">' +
          card('actual', c.kind === 'generic' ? '这篇生成的是通用卡' : '这篇的分享卡', actualNote) +
          (compare ? card('demo', '如果它是公开的（示例）', '只有可见范围为「公开」的内容才会画出标题和摘要。内测期间不开放公开。') : '') +
        '</div>' +
        (c.author ? '<p class="shr-author">作者 · ' + /* safe: personLink 自行转义 */ personLink(c.author.handle, c.author.name, c.author.level) + '</p>' : '') +
        '<p class="shr-msg" data-shr-msg role="status" aria-live="polite"></p>' +
        '<div class="shr-link field"><label for="shr-link-input">链接</label><div class="shr-link-row"><input id="shr-link-input" readonly value="' + esc(linkOf(o)) + '">' +
          '<button type="button" class="button" data-shr-act="copy-link">复制链接</button></div>' +
          '<small>' + (c.kind === 'generic' ? '链接预览同样只显示站点名，没权限的人打开会看到「没有找到」。' : '链接预览会显示标题和摘要。') + '</small></div>' +
      '</div>';
  }

  function paint() {
    if (!live) return;
    var o = live.opts;
    var jobs = [['actual', Object.assign({}, o, { format: live.format })]];
    if (o.compare && content(o).kind === 'generic') jobs.push(['demo', Object.assign({}, o, { format: live.format, visibility: { scope: 'public' } })]);
    live.renders = {};
    jobs.forEach(function (job) {
      var holder = live.dlg.querySelector('[data-shr-card="' + job[0] + '"] .shr-img');
      if (!holder) return;
      holder.dataset.format = live.format;
      var r = render(job[1]);
      if (!r) { holder.innerHTML = '<p class="shr-wait">缺少颜色变量，没法画图。请确认页面加载了 tokens.css。</p>'; return; }
      live.renders[job[0]] = r;
      var img = document.createElement('img');
      img.src = r.url;
      img.width = r.width;
      img.height = r.height;
      img.alt = r.kind === 'generic' ? '通用分享卡：先锋社区，来自先锋社区的一篇内容' : '分享卡：' + String(job[1].title || '');
      holder.replaceChildren(img);
    });
  }

  function say(text) { var m = live && live.dlg.querySelector('[data-shr-msg]'); if (m) m.textContent = text; }

  function copyImage(which) {
    var r = live && live.renders && live.renders[which];
    if (!r) return;
    var fail = function () { say('这个浏览器没让网页直接复制图片（用本机文件打开时很常见）。可以在图片上右键选「复制图像」，手机上长按图片保存。'); };
    if (!navigator.clipboard || typeof navigator.clipboard.write !== 'function' || typeof G.ClipboardItem !== 'function') { fail(); return; }
    var blob = new Promise(function (resolve, reject) { r.canvas.toBlob(function (b) { if (b) resolve(b); else reject(new Error('blob')); }, 'image/png'); });
    try {
      navigator.clipboard.write([new G.ClipboardItem({ 'image/png': blob })]).then(function () { say('图片已复制，可以直接粘贴到聊天里。'); }, fail);
    } catch (e) { fail(); }
  }

  function copyLink() {
    var input = live && live.dlg.querySelector('#shr-link-input');
    if (!input) return;
    var fallback = function () { input.focus(); input.select(); say('浏览器没让直接复制，链接已经选中，按 ⌘C 或 Ctrl+C 复制。'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(input.value).then(function () { say('链接已复制。'); }, fallback);
    else fallback();
  }

  function onClick(e) {
    var btn = e.target.closest('[data-shr-act]');
    if (!btn) { if (e.target === live.dlg) close(); return; }
    var act = btn.dataset.shrAct;
    if (act === 'close') close();
    else if (act === 'format') {
      live.format = FORMATS[btn.dataset.format] ? btn.dataset.format : 'portrait';
      Array.prototype.forEach.call(live.dlg.querySelectorAll('[data-shr-act="format"]'), function (b) { b.setAttribute('aria-pressed', String(b === btn)); });
      say('');
      paint();
    } else if (act === 'copy-image') copyImage(btn.dataset.which);
    else if (act === 'copy-link') copyLink();
  }

  function open(o) {
    close();
    o = o || {};
    var dlg = document.createElement('dialog');
    dlg.className = 'shr-dialog';
    dlg.setAttribute('aria-labelledby', 'shr-title');
    live = { dlg: dlg, opts: o, format: FORMATS[o.format] ? o.format : 'portrait', renders: {}, back: document.activeElement };
    dlg.innerHTML = shell(o);
    dlg.addEventListener('click', onClick);
    dlg.addEventListener('close', function () {
      var back = live && live.dlg === dlg ? live.back : null;
      if (live && live.dlg === dlg) live = null;
      dlg.remove();
      if (back && back.isConnected) back.focus();
    });
    document.body.appendChild(dlg);
    dlg.showModal();
    paint();
    var first = dlg.querySelector('[data-shr-act="format"][aria-pressed="true"]');
    if (first) first.focus();
    return { close: close };
  }

  function close() {
    if (!live) return;
    var d = live.dlg;
    if (d.open) d.close(); else { live = null; d.remove(); }
  }

  G.CommonsShare = { formats: FORMATS, content: content, draw: draw, render: render, png: png, open: open, close: close };
})();
