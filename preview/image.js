/* 图片件：占位、淡入、懒加载、出错重试、灯箱；缓存注册；#/image-lab 演示页。
   接口：CommonsImage.html / mount / destroy / set / release / reset / retry / open / close / registerCache / clearCache
   页面模块约定：routes + mount() + destroy()，并自行登记到 window.CommonsPages。 */
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
    var source = window.COMMONS_IMAGE_SAMPLE;
    if (!source) return null;
    if (!demoModule) demoModule = source.create({ cssValue: cssValue, esc: esc, html: html, release: release, reset: reset, set: set });
    return demoModule;
  }
  function labPage() { var d = demo(); return d ? d.page() : '<section class="imglab"><p role="status">暂无图片。</p></section>'; }
  function labMount() { var d = demo(); if (d) d.mount(); }
  function labStop() { if (demoModule) demoModule.stop(); }
  function labAct(act) { var d = demo(); if (d) d.act(act); }
  function labCount() { if (demoModule && isDemo()) demoModule.count(); }

  var SCRIPT_SRC = (document.currentScript && document.currentScript.src) || '';
  var KNOWN_MAX = 400;
  var ZOOM_MAX = 8;
  var known = new Set();
  var decoding = new Map();
  var installed = false;
  var lb = null;
  var NOOP = function () {};

  var ICON_CLOSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M6 6l12 12M18 6L6 18"/></svg>';
  var ICON_PREV = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M15 5l-7 7 7 7"/></svg>';
  var ICON_NEXT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/></svg>';

  function esc(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function cssValue(v) {
    return String(v == null ? '' : v).replace(/[^\w\s#(),.%\/+\-]/g, '');
  }

  function reduced() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  /* ---------- 图片 ---------- */

  function html(o) {
    o = o || {};
    var w = Number(o.width) || 0;
    var h = Number(o.height) || 0;
    var ratio = w && h ? w + ' / ' + h : (o.ratio ? cssValue(o.ratio) : '4 / 3');
    var tall = !!(w && h && h / w > 2);
    var held = !!o.hold;
    var zoom = o.zoom !== false;
    var style = 'aspect-ratio:' + ratio + (o.color ? ';--img-color:' + cssValue(o.color) : '');
    var attrs = ' data-img-fig data-img-state="loading"' +
      (o.group ? ' data-img-group="' + esc(o.group) + '"' : '') +
      (w && h ? ' data-img-w="' + w + '" data-img-h="' + h + '"' : '') +
      (o.full ? ' data-img-full="' + esc(o.full) + '"' : '') +
      (o.fallback ? ' data-img-fallback="' + esc(o.fallback) + '"' : '') +
      (o.src ? ' data-img-src="' + esc(o.src) + '"' : '') +
      (o.srcset ? ' data-img-srcset="' + esc(o.srcset) + '"' : '');
    var img = '<img class="img-main" alt="' + esc(o.alt) + '"' +
      (held ? '' : (o.src ? ' src="' + window.Commons.safeUrl(o.src) + '"' : '') + (o.srcset ? ' srcset="' + esc(o.srcset) + '"' : '')) +
      (o.sizes ? ' sizes="' + esc(o.sizes) + '"' : '') +
      (w && h ? ' width="' + w + '" height="' + h + '"' : '') +
      (o.priority ? ' loading="eager" fetchpriority="high"' : ' loading="lazy"') +
      ' decoding="async" draggable="false">';
    var body = zoom
      ? '<button type="button" class="img-open" data-img-act="open" aria-label="' + esc('查看大图：' + (o.alt || '图片')) + '">' + img + '</button>'
      : '<div class="img-static">' + img + '</div>';
    var tag = o.tag || (tall ? '长图' : '');
    return '<figure class="img-fig' + (tall ? ' is-tall' : '') + '"' + attrs + '>' +
      '<div class="img-frame" style="' + esc(style) + '">' +
        (o.blur ? '<img class="img-ph" src="' + window.Commons.safeUrl(o.blur) + '" alt="" aria-hidden="true" decoding="sync">' : '') +
        body +
        (tag ? '<span class="img-tag">' + esc(tag) + '</span>' : '') +
        '<div class="img-err" role="status" hidden><p>图片没加载上</p>' +
          '<button type="button" class="button small" data-img-act="retry">重试</button></div>' +
      '</div>' +
      (o.caption ? '<figcaption>' + esc(o.caption) + '</figcaption>' : '') +
    '</figure>';
  }

  function keyOf(src) {
    src = String(src || '');
    return src.length > 200 ? src.length + ':' + src.slice(0, 96) + src.slice(-64) : src;
  }

  function decodeOnce(key, img) {
    if (decoding.has(key)) return decoding.get(key);
    var p = (img.decode ? img.decode() : Promise.resolve()).then(NOOP, NOOP).then(function () {
      known.add(key);
      if (known.size > KNOWN_MAX) known.delete(known.values().next().value);
    });
    decoding.set(key, p);
    if (decoding.size > KNOWN_MAX) decoding.delete(decoding.keys().next().value);
    return p;
  }

  function figOf(node) {
    return node && node.closest ? node.closest('[data-img-fig]') : null;
  }

  function mainOf(fig) {
    return fig.querySelector('.img-main');
  }

  function showError(fig, on) {
    var box = fig.querySelector('.img-err');
    if (box) box.hidden = !on;
  }

  function loaded(img) {
    var fig = figOf(img);
    if (!fig || fig.getAttribute('data-img-state') === 'ready') return;
    var key = keyOf(img.currentSrc || img.src);
    if (known.has(key) && !fig.hasAttribute('data-img-fresh')) fig.setAttribute('data-img-instant', '');
    showError(fig, false);
    decodeOnce(key, img).then(function () {
      if (!fig.isConnected || mainOf(fig) !== img) return;
      fig.setAttribute('data-img-state', 'ready');
      fig.removeAttribute('data-img-fresh');
      labCount();
    });
  }

  function failed(img) {
    var fig = figOf(img);
    if (!fig) return;
    fig.setAttribute('data-img-state', 'error');
    showError(fig, true);
  }

  function check(img) {
    if (!img.getAttribute('src')) return;
    if (img.complete) {
      if (img.naturalWidth) loaded(img);
      else failed(img);
    }
  }

  function bind(fig) {
    fig.setAttribute('data-img-bound', '');
    var img = mainOf(fig);
    if (img) check(img);
  }

  function release(fig) {
    var img = mainOf(fig);
    if (!img || img.getAttribute('src')) return;
    var set = fig.getAttribute('data-img-srcset');
    var src = fig.getAttribute('data-img-src');
    if (!src && !set) return;
    if (set) img.setAttribute('srcset', set);
    if (src) img.setAttribute('src', src);
  }

  function reset(fig) {
    var img = mainOf(fig);
    if (!img) return;
    img.removeAttribute('src');
    img.removeAttribute('srcset');
    fig.setAttribute('data-img-state', 'loading');
    fig.removeAttribute('data-img-instant');
    fig.setAttribute('data-img-fresh', '');
    fig.removeAttribute('data-img-tries');
    showError(fig, false);
  }

  function retry(fig) {
    var img = mainOf(fig);
    if (!img) return;
    if (document.activeElement && fig.contains(document.activeElement)) {
      var opener = fig.querySelector('.img-open');
      if (opener) opener.focus({ preventScroll: true });
    }
    var tries = (Number(fig.getAttribute('data-img-tries')) || 0) + 1;
    var fallback = fig.getAttribute('data-img-fallback');
    var src = fig.getAttribute('data-img-src');
    fig.setAttribute('data-img-tries', String(tries));
    fig.setAttribute('data-img-state', 'loading');
    fig.setAttribute('data-img-fresh', '');
    showError(fig, false);
    img.removeAttribute('src');
    img.removeAttribute('srcset');
    if (fallback && tries === 1) {
      img.setAttribute('src', fallback);
    } else {
      var set = fig.getAttribute('data-img-srcset');
      if (set) img.setAttribute('srcset', set);
      img.setAttribute('src', fallback && tries > 1 ? fallback : (src || ''));
    }
  }

  function set(fig, o) {
    o = o || {};
    if (o.blur) {
      var ph = fig.querySelector('.img-ph');
      if (!ph) {
        ph = document.createElement('img');
        ph.className = 'img-ph';
        ph.alt = '';
        ph.setAttribute('aria-hidden', 'true');
        fig.querySelector('.img-frame').insertBefore(ph, fig.querySelector('.img-frame').firstChild);
      }
      ph.src = o.blur;
    }
    if (o.full) fig.setAttribute('data-img-full', o.full);
    if (o.fallback) fig.setAttribute('data-img-fallback', o.fallback);
    if (o.src) fig.setAttribute('data-img-src', o.src);
    if (o.srcset) fig.setAttribute('data-img-srcset', o.srcset);
    if (o.release !== false) release(fig);
  }

  /* ---------- 事件 ---------- */

  function onMedia(e) {
    var t = e.target;
    if (!t || t.nodeType !== 1 || !t.classList || !t.classList.contains('img-main')) return;
    if (e.type === 'load') loaded(t);
    else failed(t);
  }

  function onClick(e) {
    var btn = e.target.closest && e.target.closest('[data-img-act]');
    if (!btn) return;
    var act = btn.getAttribute('data-img-act');
    var fig = figOf(btn);
    if (act === 'open' && fig) {
      e.preventDefault();
      open(fig, btn);
    } else if (act === 'retry' && fig) {
      e.preventDefault();
      retry(fig);
    } else if (act.indexOf('lab-') === 0) {
      labAct(act, btn);
    }
  }

  function install() {
    if (installed) return;
    installed = true;
    document.addEventListener('load', onMedia, true);
    document.addEventListener('error', onMedia, true);
    document.addEventListener('click', onClick);
  }

  function mount(root) {
    install();
    var scope = root && root.querySelectorAll ? root : document;
    var list = scope.querySelectorAll('[data-img-fig]:not([data-img-bound])');
    for (var i = 0; i < list.length; i++) bind(list[i]);
    labMount();
  }

  function destroy() {
    close(true);
    labStop();
    if (!installed) return;
    installed = false;
    document.removeEventListener('load', onMedia, true);
    document.removeEventListener('error', onMedia, true);
    document.removeEventListener('click', onClick);
  }

  /* ---------- 灯箱 ---------- */

  function itemOf(fig) {
    var img = mainOf(fig);
    return {
      el: fig,
      thumb: img ? (img.currentSrc || img.src) : '',
      full: fig.getAttribute('data-img-full') || (img ? (img.currentSrc || img.src) : ''),
      w: Number(fig.getAttribute('data-img-w')) || 0,
      h: Number(fig.getAttribute('data-img-h')) || 0,
      alt: img ? img.alt : '',
      caption: (fig.querySelector('figcaption') || {}).textContent || '',
      color: (fig.querySelector('.img-frame') || { style: {} }).style.getPropertyValue('--img-color')
    };
  }

  function open(fig, opener) {
    if (lb) close(true);
    var group = fig.getAttribute('data-img-group');
    var figs = group
      ? Array.prototype.filter.call(document.querySelectorAll('[data-img-fig][data-img-group]'), function (f) {
          return f.getAttribute('data-img-group') === group && f.getAttribute('data-img-state') !== 'error';
        })
      : [fig];
    var items = figs.map(itemOf);
    var index = Math.max(0, figs.indexOf(fig));

    var root = document.createElement('div');
    root.className = 'img-lb';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', '图片查看');
    root.innerHTML =
      '<div class="img-lb-bar">' +
        '<div class="img-lb-meta"><span data-img-lb-count aria-live="polite"></span><span data-img-lb-size></span></div>' +
        '<button type="button" class="img-lb-btn" data-img-lb="close" aria-label="关闭，Esc">' + ICON_CLOSE + '</button>' +
      '</div>' +
      '<div class="img-lb-stage" data-img-lb-stage>' +
        '<img class="img-lb-img" alt="" draggable="false">' +
        '<button type="button" class="img-lb-btn img-lb-nav prev" data-img-lb="prev" aria-label="上一张，左方向键">' + ICON_PREV + '</button>' +
        '<button type="button" class="img-lb-btn img-lb-nav next" data-img-lb="next" aria-label="下一张，右方向键">' + ICON_NEXT + '</button>' +
        '<div class="img-lb-cap" data-img-lb-cap></div>' +
      '</div>' +
      '<div class="img-lb-foot">' +
        (items.length > 1 ? '<button type="button" class="img-lb-btn" data-img-lb="prev" aria-label="上一张">' + ICON_PREV + '</button>' : '') +
        '<button type="button" class="img-lb-btn" data-img-lb="out" aria-label="缩小">−</button>' +
        '<span class="img-lb-zoom" data-img-lb-zoom>100%</span>' +
        '<button type="button" class="img-lb-btn" data-img-lb="in" aria-label="放大">+</button>' +
        '<button type="button" class="img-lb-btn" data-img-lb="fit" aria-label="适合窗口">适合</button>' +
        (items.length > 1 ? '<button type="button" class="img-lb-btn" data-img-lb="next" aria-label="下一张">' + ICON_NEXT + '</button>' : '') +
      '</div>';

    lb = {
      root: root,
      stage: root.querySelector('[data-img-lb-stage]'),
      img: root.querySelector('.img-lb-img'),
      items: items,
      index: index,
      s: 1,
      x: 0,
      y: 0,
      bw: 0,
      bh: 0,
      nw: 0,
      nh: 0,
      token: 0,
      opener: opener || fig.querySelector('.img-open'),
      inert: [],
      ptrs: new Map(),
      g: null,
      lastTap: 0,
      lastTapX: 0,
      lastTapY: 0
    };

    Array.prototype.forEach.call(document.body.children, function (n) {
      if (n !== root && !n.hasAttribute('inert')) {
        n.setAttribute('inert', '');
        lb.inert.push(n);
      }
    });
    document.body.appendChild(root);
    document.documentElement.classList.add('img-lb-open');

    if (items.length < 2) {
      Array.prototype.forEach.call(root.querySelectorAll('[data-img-lb="prev"],[data-img-lb="next"]'), function (b) { b.hidden = true; });
    }

    root.addEventListener('click', lbClick);
    lb.stage.addEventListener('pointerdown', lbDown);
    lb.stage.addEventListener('pointermove', lbMove);
    lb.stage.addEventListener('pointerup', lbUp);
    lb.stage.addEventListener('pointercancel', lbUp);
    lb.stage.addEventListener('wheel', lbWheel, { passive: false });
    document.addEventListener('keydown', lbKey, true);
    window.addEventListener('resize', lbLayout);

    show(index);
    var first = root.querySelector('[data-img-lb="close"]');
    if (first) first.focus({ preventScroll: true });
  }

  function lbClick(e) {
    var b = e.target.closest && e.target.closest('[data-img-lb]');
    if (!b || !lb) return;
    var a = b.getAttribute('data-img-lb');
    if (a === 'close') close();
    else if (a === 'prev') go(-1);
    else if (a === 'next') go(1);
    else if (a === 'in') zoomTo(lb.s * 1.5, 0, 0, true);
    else if (a === 'out') zoomTo(lb.s / 1.5, 0, 0, true);
    else if (a === 'fit') zoomTo(1, 0, 0, true);
  }

  function show(i) {
    var it = lb.items[i];
    lb.index = i;
    lb.token += 1;
    var token = lb.token;
    lb.s = 1;
    lb.x = 0;
    lb.y = 0;
    var count = lb.root.querySelector('[data-img-lb-count]');
    count.textContent = lb.items.length > 1 ? '第 ' + (i + 1) + ' / ' + lb.items.length + ' 张' : '第 1 张';
    lb.root.querySelector('[data-img-lb-cap]').textContent = it.caption || '';
    lb.img.alt = it.alt || '';
    if (it.color) lb.img.style.setProperty('--img-color', it.color);
    else lb.img.style.removeProperty('--img-color');
    var sep = !!(it.full && it.full !== it.thumb);
    lb.prov = sep;
    lb.nw = it.w;
    lb.nh = it.h;
    sizeText(sep ? 0 : it.w, sep ? 0 : it.h);
    lb.img.src = it.thumb || it.full;
    if (!(it.w && it.h)) {
      lb.img.onload = function () {
        if (token !== lb.token) return;
        lb.nw = lb.img.naturalWidth;
        lb.nh = lb.img.naturalHeight;
        sizeText(sep ? 0 : lb.nw, sep ? 0 : lb.nh);
        lbLayout();
      };
    } else {
      lb.img.onload = null;
    }
    lbLayout();
    if (sep) {
      var pre = new Image();
      pre.onload = function () {
        if (!lb || token !== lb.token) return;
        (pre.decode ? pre.decode() : Promise.resolve()).then(NOOP, NOOP).then(function () {
          if (!lb || token !== lb.token) return;
          lb.prov = false;
          lb.nw = pre.naturalWidth;
          lb.nh = pre.naturalHeight;
          sizeText(lb.nw, lb.nh);
          lb.img.onload = null;
          lb.img.src = it.full;
          lbLayout();
        });
      };
      pre.onerror = function () {
        if (!lb || token !== lb.token) return;
        lb.prov = false;
        sizeText(it.w, it.h);
        lbLayout();
      };
      pre.src = it.full;
    }
    var prev = lb.root.querySelectorAll('[data-img-lb="prev"]');
    var next = lb.root.querySelectorAll('[data-img-lb="next"]');
    Array.prototype.forEach.call(prev, function (b) { b.disabled = i === 0; });
    Array.prototype.forEach.call(next, function (b) { b.disabled = i === lb.items.length - 1; });
  }

  function sizeText(w, h) {
    lb.root.querySelector('[data-img-lb-size]').textContent = w && h ? '原图 ' + w + ' × ' + h : '';
  }

  function lbLayout() {
    if (!lb) return;
    var W = lb.stage.clientWidth;
    var H = lb.stage.clientHeight;
    var nw = lb.nw || lb.img.naturalWidth || W;
    var nh = lb.nh || lb.img.naturalHeight || H;
    var sc = Math.min(W / nw, H / nh, lb.prov ? Infinity : 1);
    lb.bw = nw * sc;
    lb.bh = nh * sc;
    lb.img.style.width = lb.bw + 'px';
    lb.img.style.height = lb.bh + 'px';
    lb.fitScale = sc;
    clampPan();
    apply(false);
  }

  function clampPan() {
    var W = lb.stage.clientWidth;
    var H = lb.stage.clientHeight;
    var mx = Math.max(0, (lb.bw * lb.s - W) / 2);
    var my = Math.max(0, (lb.bh * lb.s - H) / 2);
    lb.x = clamp(lb.x, -mx, mx);
    lb.y = clamp(lb.y, -my, my);
  }

  function apply(settle) {
    lb.img.classList.toggle('is-settling', !!settle && !reduced());
    lb.img.style.transform = 'translate(calc(-50% + ' + lb.x + 'px), calc(-50% + ' + lb.y + 'px)) scale(' + lb.s + ')';
    var nat = lb.nw || lb.bw;
    var pct = nat ? Math.round(lb.bw * lb.s / nat * 100) : 100;
    lb.root.querySelector('[data-img-lb-zoom]').textContent = pct + '%';
  }

  function zoomTo(ns, px, py, settle) {
    ns = clamp(ns, 1, ZOOM_MAX);
    var k = ns / lb.s;
    lb.x = px - (px - lb.x) * k;
    lb.y = py - (py - lb.y) * k;
    lb.s = ns;
    if (ns === 1) { lb.x = 0; lb.y = 0; }
    clampPan();
    apply(settle);
  }

  function go(d) {
    var n = lb.index + d;
    if (n < 0 || n >= lb.items.length) {
      lb.x = 0;
      lb.y = 0;
      apply(true);
      return;
    }
    show(n);
  }

  function stagePoint(cx, cy) {
    var r = lb.stage.getBoundingClientRect();
    return { x: cx - (r.left + r.width / 2), y: cy - (r.top + r.height / 2) };
  }

  function lbWheel(e) {
    e.preventDefault();
    var dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    var p = stagePoint(e.clientX, e.clientY);
    zoomTo(lb.s * Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0018)), p.x, p.y, false);
  }

  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

  function lbDown(e) {
    if (e.target.closest('button')) return;
    lb.stage.setPointerCapture(e.pointerId);
    lb.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    lb.img.classList.remove('is-settling');
    if (lb.ptrs.size === 1) {
      lb.g = { mode: 'pan', sx: e.clientX, sy: e.clientY, x0: lb.x, y0: lb.y, t0: performance.now(), moved: false, onStage: e.target === lb.stage };
      lb.stage.classList.add('is-panning');
    } else if (lb.ptrs.size === 2) {
      var pts = Array.from(lb.ptrs.values());
      lb.g = { mode: 'pinch', d0: dist(pts[0], pts[1]) || 1, s0: lb.s, m0: stagePoint((pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2), x0: lb.x, y0: lb.y, moved: true };
    }
  }

  function lbMove(e) {
    if (!lb.ptrs.has(e.pointerId) || !lb.g) return;
    lb.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    var g = lb.g;
    if (g.mode === 'pan') {
      var dx = e.clientX - g.sx;
      var dy = e.clientY - g.sy;
      if (Math.hypot(dx, dy) > 6) g.moved = true;
      if (!g.moved) return;
      lb.x = g.x0 + dx;
      lb.y = g.y0 + dy;
      if (lb.s > 1.001) clampPan();
      apply(false);
    } else if (g.mode === 'pinch' && lb.ptrs.size >= 2) {
      var pts = Array.from(lb.ptrs.values());
      var ns = clamp(g.s0 * dist(pts[0], pts[1]) / g.d0, 1, ZOOM_MAX);
      var m = stagePoint((pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2);
      var k = ns / g.s0;
      lb.s = ns;
      lb.x = m.x - (g.m0.x - g.x0) * k;
      lb.y = m.y - (g.m0.y - g.y0) * k;
      clampPan();
      apply(false);
    }
  }

  function lbUp(e) {
    if (!lb.ptrs.has(e.pointerId)) return;
    lb.ptrs.delete(e.pointerId);
    var g = lb.g;
    if (!g) return;
    if (g.mode === 'pinch') {
      if (lb.ptrs.size === 1) {
        var rest = Array.from(lb.ptrs.values())[0];
        lb.g = { mode: 'pan', sx: rest.x, sy: rest.y, x0: lb.x, y0: lb.y, t0: performance.now(), moved: true, onStage: false };
        return;
      }
      lb.g = null;
      lb.stage.classList.remove('is-panning');
      if (lb.s < 1.02) zoomTo(1, 0, 0, true);
      else { clampPan(); apply(true); }
      return;
    }
    if (lb.ptrs.size) return;
    lb.g = null;
    lb.stage.classList.remove('is-panning');
    var W = lb.stage.clientWidth;
    if (!g.moved) {
      var now = performance.now();
      var p = stagePoint(e.clientX, e.clientY);
      if (now - lb.lastTap < 320 && Math.hypot(e.clientX - lb.lastTapX, e.clientY - lb.lastTapY) < 24) {
        lb.lastTap = 0;
        zoomTo(lb.s > 1.05 ? 1 : 2.5, p.x, p.y, true);
      } else {
        lb.lastTap = now;
        lb.lastTapX = e.clientX;
        lb.lastTapY = e.clientY;
        if (g.onStage && lb.s <= 1.001) {
          var token = lb.token;
          setTimeout(function () { if (lb && lb.lastTap && lb.token === token && performance.now() - lb.lastTap >= 300) close(); }, 320);
        }
      }
      return;
    }
    if (lb.s <= 1.001) {
      if (Math.abs(lb.y) > 120 && Math.abs(lb.y) > Math.abs(lb.x) * 1.2) { close(); return; }
      if (Math.abs(lb.x) > W * 0.15) { go(lb.x < 0 ? 1 : -1); return; }
      lb.x = 0;
      lb.y = 0;
      apply(true);
    } else {
      clampPan();
      apply(true);
    }
  }

  function lbKey(e) {
    if (!lb) return;
    var k = e.key;
    if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (k === 'ArrowLeft') { e.preventDefault(); go(-1); }
    else if (k === 'ArrowRight') { e.preventDefault(); go(1); }
    else if (k === '+' || k === '=') { e.preventDefault(); zoomTo(lb.s * 1.5, 0, 0, true); }
    else if (k === '-' || k === '_') { e.preventDefault(); zoomTo(lb.s / 1.5, 0, 0, true); }
    else if (k === '0') { e.preventDefault(); zoomTo(1, 0, 0, true); }
    else if (k === 'Tab') {
      var f = Array.prototype.filter.call(lb.root.querySelectorAll('button'), function (b) { return !b.disabled && !b.hidden && b.offsetParent !== null; });
      if (!f.length) return;
      var i = f.indexOf(document.activeElement);
      e.preventDefault();
      f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
    }
  }

  function close(immediate) {
    if (!lb) return;
    var cur = lb;
    lb = null;
    document.removeEventListener('keydown', lbKey, true);
    window.removeEventListener('resize', lbLayout);
    document.documentElement.classList.remove('img-lb-open');
    cur.inert.forEach(function (n) { n.removeAttribute('inert'); });
    var done = function () { if (cur.root.parentNode) cur.root.parentNode.removeChild(cur.root); };
    if (immediate === true || reduced()) done();
    else {
      cur.root.classList.add('is-closing');
      setTimeout(done, 140);
    }
    var back = cur.opener && cur.opener.isConnected ? cur.opener : (cur.items[cur.index].el.querySelector('.img-open'));
    if (immediate !== true && back && back.focus) back.focus();
  }

  /* ---------- 缓存 ---------- */

  function registerCache(o) {
    o = o || {};
    if (!/^https?:$/.test(location.protocol)) {
      console.info('[CommonsImage] file:// 下不注册 Service Worker，缓存只在 http(s) 下生效。');
      return Promise.resolve(null);
    }
    if (!('serviceWorker' in navigator)) return Promise.resolve(null);
    var url;
    try {
      url = new URL(o.url || new URL('sw.js', SCRIPT_SRC || location.href).href, location.href);
    } catch (err) {
      return Promise.resolve(null);
    }
    if (o.version) url.searchParams.set('v', String(o.version));
    return navigator.serviceWorker.register(url.href, o.scope ? { scope: o.scope } : undefined).catch(function (err) {
      console.warn('[CommonsImage] Service Worker 注册失败：', err && err.message);
      return null;
    });
  }

  function clearCache() {
    known.clear();
    decoding.clear();
    var jobs = [];
    if (window.caches && caches.keys) {
      jobs.push(caches.keys().then(function (keys) {
        return Promise.all(keys.filter(function (k) { return k.indexOf('commons-') === 0; }).map(function (k) { return caches.delete(k); }));
      }));
    }
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'clear' });
    }
    return Promise.all(jobs).then(function () { return true; }, function () { return false; });
  }

  /* ---------- 演示页 #/image-lab ---------- */

  window.CommonsImage = {
    routes: { 'image-lab': labPage },
    nav: [['image-lab', '图片件', 'image', 'data']],
    icons: { image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15.5 9.5h.01' },
    html: html,
    mount: mount,
    destroy: destroy,
    set: set,
    release: release,
    reset: reset,
    retry: retry,
    open: open,
    close: close,
    registerCache: registerCache,
    clearCache: clearCache
  };
  (window.CommonsPages = window.CommonsPages || []).push(window.CommonsImage);
})();
