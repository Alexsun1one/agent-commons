/* 性能：按需加载脚本（need / prefetch）和默认隐藏的性能面板。
   面板只在地址带 ?perf=1 或按 Shift+P 时打开；不开就不收集；开了也只在本机计算，不存储、不上报。 */
(function () {
  'use strict';

  /* 阈值来源：
     - LCP 1500 ms：docs/innovation/R13/00-blueprint.md §11.2「首屏在内地 4G 下 ≤ 1.5s」。
     - CLS 0.1、INP 200 ms：Web Vitals 的「良好」线。docs/specs/SLO.md 只定服务端口径（见其 §2 末段，
       明确浏览器指标不能用服务端 P95 代替），没有写浏览器端数值，所以这两个取公开的行业线。
     - 渲染 100 ms：一次 render() 的暂定预算，SLO.md 里没有对应条目，待主控或 SLO 补充后改这里。 */
  var LIMITS = { lcp: 1500, cls: 0.1, inp: 200, render: 100 };

  var registry = {};
  var routes = {};
  var pending = {};
  var done = {};
  var prefetched = {};
  var hoverTimer = 0;

  var enabled = false;
  var observers = [];
  var marks = {};
  var m = blank();
  var renders = [];
  var ints = {};
  var cls = { cur: 0, first: 0, last: 0 };
  var panel = null;
  var paintTimer = 0;
  var fallbackOff = null;

  function blank() {
    return { lcp: null, cls: null, inp: null, inpEst: false, longtask: null, render: null, renderP95: null };
  }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  /* ---------- 按需加载 ---------- */

  function abs(src) {
    try { return new URL(src, document.baseURI).href; } catch (e) { return src; }
  }

  function list(v) {
    return v == null ? [] : (Array.isArray(v) ? v : [v]);
  }

  function define(map) {
    Object.keys(map || {}).forEach(function (name) {
      var s = map[name] || {};
      registry[name] = { js: list(s.js), css: list(s.css), global: s.global || '' };
    });
  }

  function specOf(arg) {
    if (typeof arg === 'string') {
      var r = registry[arg];
      return r ? { key: arg, js: r.js, css: r.css, global: r.global } : null;
    }
    if (arg && typeof arg === 'object') {
      var js = list(arg.js);
      var css = list(arg.css);
      return { key: arg.name || JSON.stringify([js, css]), js: js, css: css, global: arg.global || '' };
    }
    return null;
  }

  function findTag(kind, url) {
    var tags = document.querySelectorAll(kind === 'script' ? 'script[src]' : 'link[rel="stylesheet"]');
    for (var i = 0; i < tags.length; i++) {
      if (abs(tags[i].getAttribute(kind === 'script' ? 'src' : 'href')) === url) return tags[i];
    }
    return null;
  }

  function loadScript(src) {
    var url = abs(src);
    var existing = findTag('script', url);
    if (existing && (existing.hasAttribute('data-perf-loaded') || !existing.hasAttribute('data-perf'))) return Promise.resolve();
    if (existing && existing._perfPending) return existing._perfPending;
    var tag = document.createElement('script');
    var promise = new Promise(function (resolve, reject) {
      tag.src = src;
      tag.async = true;
      tag.setAttribute('data-perf', '');
      tag.onload = function () {
        tag.setAttribute('data-perf-loaded', '');
        resolve();
      };
      tag.onerror = function () {
        if (tag.parentNode) tag.parentNode.removeChild(tag);
        reject(new Error('load: ' + src));
      };
    });
    tag._perfPending = promise;
    document.head.appendChild(tag);
    return promise;
  }

  function loadCss(href) {
    var url = abs(href);
    var existing = findTag('link', url);
    if (existing && (existing.hasAttribute('data-perf-loaded') || !existing.hasAttribute('data-perf'))) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var tag = document.createElement('link');
      tag.rel = 'stylesheet';
      tag.href = href;
      tag.setAttribute('data-perf', '');
      tag.onload = function () {
        tag.setAttribute('data-perf-loaded', '');
        resolve();
      };
      tag.onerror = function () {
        if (tag.parentNode) tag.parentNode.removeChild(tag);
        reject(new Error('load: ' + href));
      };
      document.head.appendChild(tag);
    });
  }

  /* need('名字') 或 need({ js, css, global })：每个资源只插入一次；失败后再调用一次就是重试。 */
  function need(arg) {
    var s = specOf(arg);
    if (!s) return Promise.reject(new Error('unknown: ' + arg));
    var value = function () { return s.global ? window[s.global] : true; };
    if (s.global && window[s.global]) return Promise.resolve(window[s.global]);
    if (done[s.key] && !s.global) return Promise.resolve(true);
    if (pending[s.key]) return pending[s.key];
    var p = Promise.all(s.css.map(loadCss)).then(function () {
      return s.js.reduce(function (chain, src) {
        return chain.then(function () { return loadScript(src); });
      }, Promise.resolve());
    }).then(function () {
      if (s.global && !window[s.global]) throw new Error('missing: ' + s.global);
      done[s.key] = true;
      delete pending[s.key];
      return value();
    }, function (err) {
      delete pending[s.key];
      throw err;
    });
    pending[s.key] = p;
    return p;
  }

  function routeOf(r) {
    return String(r || '').replace(/^#?\/?/, '').split('/')[0];
  }

  /* setRoutes({ 'media-lab': ['hls', 'wavesurfer'], ... })：路由 → need 名字数组 */
  function setRoutes(map) {
    Object.keys(map || {}).forEach(function (r) { routes[routeOf(r)] = list(map[r]); });
  }

  function prefetch(route) {
    var names = routes[routeOf(route)];
    if (!names) return 0;
    var n = 0;
    names.forEach(function (name) {
      var s = specOf(name);
      if (!s || (s.global && window[s.global]) || done[s.key]) return;
      s.css.map(function (u) { return [u, 'style']; }).concat(s.js.map(function (u) { return [u, 'script']; })).forEach(function (pair) {
        var url = abs(pair[0]);
        if (prefetched[url]) return;
        prefetched[url] = true;
        var link = document.createElement('link');
        link.rel = 'prefetch';
        link.as = pair[1];
        link.href = pair[0];
        document.head.appendChild(link);
        n += 1;
      });
    });
    return n;
  }

  function hoverOn(e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href^="#/"]') : null;
    clearTimeout(hoverTimer);
    if (!a) return;
    var r = routeOf(a.getAttribute('href'));
    if (!routes[r]) return;
    hoverTimer = setTimeout(function () { prefetch(r); }, 100);
  }

  function hoverOff() {
    clearTimeout(hoverTimer);
  }

  /* ---------- 采集（只在面板打开时） ---------- */

  function observe(type, cb, extra) {
    try {
      var po = new PerformanceObserver(function (l) { cb(l.getEntries()); });
      po.observe(Object.assign({ type: type, buffered: true }, extra || {}));
      observers.push(po);
      return true;
    } catch (e) {
      return false;
    }
  }

  function inpValue() {
    var v = Object.keys(ints).map(function (k) { return ints[k]; }).sort(function (a, b) { return b - a; });
    if (!v.length) return null;
    return v[Math.min(v.length - 1, Math.floor(v.length / 50))];
  }

  function onEventFallback(e) {
    var t0 = e.timeStamp;
    var id = 'f' + t0;
    requestAnimationFrame(function () {
      setTimeout(function () {
        ints[id] = performance.now() - t0;
        m.inp = inpValue();
        schedulePaint();
      }, 0);
    });
  }

  function start() {
    if (enabled) return;
    enabled = true;
    observe('largest-contentful-paint', function (es) {
      var e = es[es.length - 1];
      if (e) m.lcp = e.renderTime || e.loadTime || e.startTime;
      schedulePaint();
    });
    observe('layout-shift', function (es) {
      es.forEach(function (e) {
        if (e.hadRecentInput) return;
        if (cls.cur && e.startTime - cls.last < 1000 && e.startTime - cls.first < 5000) {
          cls.cur += e.value;
        } else {
          cls.cur = e.value;
          cls.first = e.startTime;
        }
        cls.last = e.startTime;
        m.cls = Math.max(m.cls || 0, cls.cur);
      });
      schedulePaint();
    });
    var hasEvent = observe('event', function (es) {
      es.forEach(function (e) {
        if (!e.interactionId) return;
        ints[e.interactionId] = Math.max(ints[e.interactionId] || 0, e.duration);
      });
      m.inp = inpValue();
      schedulePaint();
    }, { durationThreshold: 40 });
    if (!hasEvent) {
      m.inpEst = true;
      ['pointerdown', 'keydown', 'click'].forEach(function (t) { document.addEventListener(t, onEventFallback, true); });
      fallbackOff = function () {
        ['pointerdown', 'keydown', 'click'].forEach(function (t) { document.removeEventListener(t, onEventFallback, true); });
      };
      observe('longtask', function (es) {
        es.forEach(function (e) { m.longtask = Math.max(m.longtask || 0, e.duration); });
        schedulePaint();
      });
    }
  }

  function stop() {
    enabled = false;
    observers.forEach(function (po) { try { po.disconnect(); } catch (e) {} });
    observers = [];
    if (fallbackOff) fallbackOff();
    fallbackOff = null;
    clearTimeout(paintTimer);
    m = blank();
    renders = [];
    ints = {};
    cls = { cur: 0, first: 0, last: 0 };
  }

  /* render() 前后调用：CommonsPerf.mark('render') … CommonsPerf.measure('render') */
  function mark(name) {
    marks[name] = performance.now();
  }

  function measure(name) {
    if (marks[name] == null) return null;
    var d = performance.now() - marks[name];
    delete marks[name];
    if (enabled && name === 'render') {
      renders.push(d);
      if (renders.length > 30) renders.shift();
      m.render = d;
      var sorted = renders.slice().sort(function (a, b) { return a - b; });
      m.renderP95 = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
      schedulePaint();
    }
    return d;
  }

  /* ---------- 面板 ---------- */

  function fmt(kind, v) {
    if (v == null) return '—';
    if (kind === 'cls') return v.toFixed(3);
    return Math.round(v) + ' ms';
  }

  function row(label, value, limit, over, extra) {
    return '<dt>' + esc(label) + '</dt><dd class="' + (over ? 'is-over' : '') + '">' + esc(value) + esc(extra || '') + '</dd><dd class="limit">' + esc(limit) + '</dd>';
  }

  function paint() {
    if (!panel || !enabled) return;
    var renderOver = m.render != null && (m.render > LIMITS.render || (renders.length >= 5 && m.renderP95 > LIMITS.render));
    var inpText = m.inp != null ? fmt('inp', m.inp) : (m.inpEst && m.longtask != null ? '长任务 ' + fmt('inp', m.longtask) : '—');
    panel.querySelector('[data-perf-list]').innerHTML =
      row('LCP', fmt('lcp', m.lcp), '≤ ' + LIMITS.lcp + ' ms', m.lcp != null && m.lcp > LIMITS.lcp) +
      row('CLS', fmt('cls', m.cls), '≤ ' + LIMITS.cls, m.cls != null && m.cls > LIMITS.cls) +
      row(m.inpEst ? 'INP 估' : 'INP', inpText, '≤ ' + LIMITS.inp + ' ms', (m.inp != null && m.inp > LIMITS.inp) || (m.inp == null && m.longtask != null && m.longtask > LIMITS.inp)) +
      row('渲染', fmt('render', m.render), '≤ ' + LIMITS.render + ' ms', renderOver, m.renderP95 != null && renders.length >= 5 ? ' · P95 ' + Math.round(m.renderP95) : '');
  }

  function schedulePaint() {
    if (!panel || paintTimer) return;
    paintTimer = setTimeout(function () {
      paintTimer = 0;
      paint();
    }, 250);
  }

  function build() {
    panel = document.createElement('aside');
    panel.className = 'perf-panel';
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-label', '性能面板');
    panel.innerHTML =
      '<div class="perf-head"><strong>性能</strong>' +
      '<button type="button" class="perf-close" data-perf-close aria-label="关闭性能面板">×</button></div>' +
      '<dl class="perf-list" data-perf-list></dl>' +
      '<p class="perf-note">只在本机计算，不存储、不上报。Shift+P 关闭。</p>';
    panel.querySelector('[data-perf-close]').addEventListener('click', function () { show(false); });
    document.body.appendChild(panel);
  }

  function show(on) {
    if (on === undefined) on = !enabled;
    if (on) {
      if (!panel) build();
      panel.hidden = false;
      start();
      paint();
    } else {
      stop();
      if (panel) panel.hidden = true;
    }
    return enabled;
  }

  function onKey(e) {
    if (e.key !== 'P' || !e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
    var t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    show();
  }

  function init() {
    document.addEventListener('keydown', onKey);
    document.addEventListener('mouseover', hoverOn);
    document.addEventListener('mouseout', hoverOff);
    document.addEventListener('focusin', hoverOn);
    document.addEventListener('touchstart', hoverOn, { passive: true });
    if (/[?&]perf=1(&|$|#)/.test(location.search + location.hash)) show(true);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.CommonsPerf = {
    limits: LIMITS,
    need: need,
    define: define,
    setRoutes: setRoutes,
    prefetch: prefetch,
    mark: mark,
    measure: measure,
    show: show,
    snapshot: function () { return Object.assign({ enabled: enabled }, m); }
  };
})();
