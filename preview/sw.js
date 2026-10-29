/* Service Worker：静态资源、图片衍生图、HTML 外壳的缓存。只在 http(s) 下由 CommonsImage.registerCache() 注册。
   版本：注册地址带 ?v=<版本号>，版本变了就清掉旧缓存。
   铁律：/api/* 一律不经过缓存，直接走网络（和服务端 no-store 一致）。
   APP-1 只加三件事：install 预热外壳；没有外壳时改回 offline.html；最近 50 张卡片快照放进 SHELL。
   缓存名仍是 static / img / shell 三个。图片 LRU 仍是 200。install 末尾仍 skipWaiting。 */
'use strict';

var VERSION = new URL(self.location.href).searchParams.get('v') || '1';
var PREFIX = 'commons-';
var STATIC = PREFIX + 'static-' + VERSION;
var IMAGES = PREFIX + 'img-' + VERSION;
var SHELL = PREFIX + 'shell-' + VERSION;
var CURRENT = [STATIC, IMAGES, SHELL];
var IMAGE_LIMIT = 200;
var PAGE_LIMIT = 50;
var PAGE_HTML_LIMIT = 12000;
var NAV_TIMEOUT = 5000;
var SCOPE = new URL(self.registration.scope).pathname;
var SHELL_KEY = new URL(self.registration.scope).href;
var LRU_KEY = new URL(SCOPE + '__commons-lru.json', self.location.origin).href;
var PAGES_INDEX = new URL(SCOPE + '__commons-pages.json', self.location.origin).href;

/* 带内容哈希的文件名：app.3fa9c1d2.js 或 app-3fa9c1d2.css */
var HASHED = /[.\-_][0-9a-f]{8,32}\.(?:js|css|woff2?|svg|png|jpe?g|webp|avif|gif|ico)$/i;
/* 图片衍生图的路径约定（和服务端图片接口对齐，改这里即可）。location 以 / 开头，不含 /api/。 */
var IMAGE_PATH = /^\/(?:img|media|thumb|derived)\//;
var STATIC_EXT = /\.(?:js|css|woff2?|svg|png|jpe?g|webp|avif|gif|ico|json|webmanifest)$/i;

function isApi(url) {
  return /(^|\/)api(\/|$)/.test(url.pathname);
}

function noStore(res) {
  var cc = res.headers.get('Cache-Control') || '';
  return /no-store/i.test(cc);
}

function cacheable(res) {
  return res && res.status === 200 && res.type !== 'opaque' && !noStore(res);
}

self.addEventListener('install', function (event) {
  event.waitUntil(precache().catch(function () {}).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) {
        return k.indexOf(PREFIX) === 0 && CURRENT.indexOf(k) === -1;
      }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('message', function (event) {
  var data = event.data || {};
  if (data.type === 'clear') {
    lru = null;
    event.waitUntil(caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k.indexOf(PREFIX) === 0; }).map(function (k) { return caches.delete(k); }));
    }));
  } else if (data.type === 'skip-waiting') {
    self.skipWaiting();
  } else if (data.type === 'remember-page') {
    event.waitUntil(rememberPage(data));
  }
});

/* ---------- 图片 LRU：用一个 JSON 记录最近使用时间，超过 200 张淘汰最久没用的 ---------- */

var lru = null;
var lruQueue = Promise.resolve();

function lruLoad(cache) {
  if (lru) return Promise.resolve(lru);
  return cache.match(LRU_KEY).then(function (res) {
    return res ? res.json() : {};
  }).catch(function () { return {}; }).then(function (m) {
    lru = m || {};
    return lru;
  });
}

function lruTouch(url) {
  lruQueue = lruQueue.then(function () {
    return caches.open(IMAGES).then(function (cache) {
      return lruLoad(cache).then(function (m) {
        m[url] = Date.now();
        var urls = Object.keys(m);
        var drops = [];
        if (urls.length > IMAGE_LIMIT) {
          urls.sort(function (a, b) { return m[a] - m[b]; });
          urls.slice(0, urls.length - IMAGE_LIMIT).forEach(function (u) {
            delete m[u];
            drops.push(cache.delete(u));
          });
        }
        return Promise.all(drops).then(function () {
          return cache.put(LRU_KEY, new Response(JSON.stringify(m), { headers: { 'Content-Type': 'application/json' } }));
        });
      });
    });
  }).catch(function () {});
  return lruQueue;
}

/* ---------- 策略 ---------- */

function cacheFirst(event, cacheName, onHit) {
  var req = event.request;
  return caches.open(cacheName).then(function (cache) {
    return cache.match(req).then(function (hit) {
      if (hit) {
        if (onHit) event.waitUntil(onHit(req.url));
        return hit;
      }
      return fetch(req).then(function (res) {
        if (cacheable(res)) {
          var copy = res.clone();
          event.waitUntil(cache.put(req, copy).then(function () { return onHit ? onHit(req.url) : null; }).catch(function () {}));
        }
        return res;
      });
    });
  });
}

function networkFirst(event, cacheName, key) {
  var req = event.request;
  return fetch(req).then(function (res) {
    if (cacheable(res)) {
      var copy = res.clone();
      event.waitUntil(caches.open(cacheName).then(function (c) { return c.put(key || req, copy); }).catch(function () {}));
    }
    return res;
  }).catch(function () {
    return caches.open(cacheName).then(function (c) { return c.match(key || req); }).then(function (hit) {
      return hit || Response.error();
    });
  });
}

function offlineShell(cached) {
  var note = '<div class="img-offline-bar" role="status">你现在离线，显示的是上次打开时的页面。</div>';
  if (!cached) return offlineDocument();
  return cached.text().then(function (text) {
    var out = /<body[^>]*>/i.test(text) ? text.replace(/<body[^>]*>/i, function (m) { return m + note; }) : note + text;
    return new Response(out, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Commons-Offline': '1' } });
  });
}

function navigate(event) {
  var req = event.request;
  var ctl = typeof AbortController === 'function' ? new AbortController() : null;
  var timer = ctl ? setTimeout(function () { ctl.abort(); }, NAV_TIMEOUT) : 0;
  return fetch(req, ctl ? { signal: ctl.signal } : undefined).then(function (res) {
    clearTimeout(timer);
    /* 外壳是不带个人数据的静态页，所以即使带 no-cache 也存一份供离线用；带 no-store 的不存 */
    if (res && res.status === 200 && res.type === 'basic' && !noStore(res)) {
      var copy = res.clone();
      event.waitUntil(caches.open(SHELL).then(function (c) { return c.put(SHELL_KEY, copy); }).catch(function () {}));
    }
    return res;
  }).catch(function () {
    clearTimeout(timer);
    return caches.open(SHELL).then(function (c) { return c.match(SHELL_KEY); }).then(offlineShell);
  });
}

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  /* /api/* 与带凭据头的请求：不碰，浏览器直接走网络 */
  if (isApi(url) || req.headers.has('Authorization')) return;
  /* 媒体流和分段请求：不缓存 */
  if (req.headers.has('Range') || req.destination === 'video' || req.destination === 'audio') return;

  if (req.mode === 'navigate') {
    event.respondWith(navigate(event));
    return;
  }
  if (HASHED.test(url.pathname)) {
    event.respondWith(cacheFirst(event, STATIC).catch(function () { return Response.error(); }));
    return;
  }
  if (req.destination === 'image' || IMAGE_PATH.test(url.pathname)) {
    event.respondWith(cacheFirst(event, IMAGES, function (u) { return lruTouch(u); }).catch(function () { return Response.error(); }));
    return;
  }
  /* 没有哈希的同源静态文件（原型阶段的 css/js）：网络优先，离线时用上次的 */
  if (STATIC_EXT.test(url.pathname)) {
    event.respondWith(networkFirst(event, STATIC));
  }
});

/* ---------- APP-1：外壳预热、离线空状态、最近 50 张卡片。不新开缓存名 ---------- */

var PRECACHE_STATIC = [
  'offline.html', 'manifest.webmanifest', 'tokens.css', 'app.css', 'pwa.css',
  'extensions.css', 'studio.css', 'density.css', 'buddies.css', 'archive-view.css',
  'showcase.css', 'navigation.css', 'motion.css', 'constellation.css', 'fieldwork.css',
  'contributions.css', 'member.css', 'knowledge-net.css', 'ui-kit.css', 'command.css',
  'rings.css', 'work-hub.css', 'work-stage.css', 'state-icons.css', 'media.css',
  'html-render.css', 'growth.css', 'image.css', 'avatar.css', 'hot.css', 'thread.css',
  'insights.css', 'kb.css', 'library.css', 'agentchat.css', 'onboard.css', 'account.css',
  'drift.css', 'talks.css', 'notify.css', 'admin.css',
  'data.js', 'archive-data.js', 'archive-view.js', 'buddies.js', 'extensions.js',
  'showcase.js', 'motion.js', 'navigation.js', 'constellation.js', 'fieldwork-data.js',
  'fieldwork.js', 'contributions.js', 'member.js', 'state-icons.js', 'knowledge-sample-data.js',
  'knowledge-net.js', 'ui-kit.js', 'command.js', 'rings.js', 'work-hub.js', 'work-stage.js',
  'api.js', 'media.js', 'vendor/html-to-image.src.js', 'html-render.js', 'growth-sample.js',
  'growth.js', 'perf.js', 'image.js', 'avatar.js', 'hot-sample.js', 'hot.js',
  'thread-sample.js', 'thread.js', 'onboard-sample.js', 'onboard.js', 'account.js',
  'agentchat-sample.js', 'agentchat.js', 'kb-sample.js', 'kb.js', 'library-sample.js',
  'library.js', 'gravity-line.js', 'insights-sample.js', 'insights-data.js', 'insights-drift.js',
  'insights.js', 'drift.js', 'talks-sample.js', 'talks.js', 'notify-sample.js', 'notify.js',
  'admin-sample.js', 'admin.js', 'app.js', 'pwa.js',
  'assets/illus/empty-offline.webp',
  'assets/app-icons/icon-192.png', 'assets/app-icons/icon-512.png',
  'assets/app-icons/icon-maskable-512.png', 'assets/app-icons/apple-touch-icon.png',
  'assets/app-icons/favicon-32.png', 'assets/app-icons/favicon-16.png',
  'assets/brand/pioneer-mark.svg', 'assets/brand/pioneer-mark.png'
];

function scopeUrl(path) {
  return new URL(path, self.registration.scope).href;
}

function pageKey(kind, id) {
  return new URL(SCOPE + '__commons-page/' + kind + '/' + encodeURIComponent(id), self.location.origin).href;
}

function storeOk(res) {
  return !!(res && res.status === 200 && res.type !== 'opaque' && res.type !== 'error' && !noStore(res));
}

function putOk(cache, url) {
  return fetch(url).then(function (res) {
    if (storeOk(res)) return cache.put(url, res);
  }).catch(function () {});
}

function precache() {
  var staticJob = caches.open(STATIC).then(function (cache) {
    return Promise.all(PRECACHE_STATIC.map(function (path) { return putOk(cache, scopeUrl(path)); }));
  });
  var shellJob = caches.open(SHELL).then(function (cache) {
    var indexUrl = scopeUrl('index.html');
    return fetch(indexUrl).then(function (res) {
      if (!storeOk(res)) return;
      var copy = res.clone();
      return cache.put(indexUrl, res).then(function () { return cache.put(SHELL_KEY, copy); });
    }).catch(function () {});
  });
  return Promise.all([staticJob, shellJob]);
}

function offlineDocument() {
  var url = scopeUrl('offline.html');
  return caches.open(STATIC).then(function (cache) {
    return cache.match(url);
  }).then(function (hit) {
    if (hit) return hit;
    return caches.open(SHELL).then(function (cache) { return cache.match(url); });
  }).then(function (hit) {
    if (hit) return hit;
    return new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>你现在离线</title><p style="font:16px/1.6 system-ui;padding:24px">你现在离线。连上网络后刷新就能回来。</p>', {
      status: 503,
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  });
}

var pageQueue = Promise.resolve();

function acceptablePage(data) {
  var kind = data && data.kind;
  var id = data && typeof data.id === 'string' ? data.id : '';
  var href = data && typeof data.href === 'string' ? data.href : '';
  if (kind !== 'knowledge' && kind !== 'question') return null;
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(id)) return null;
  if (kind === 'knowledge' && href !== '#/knowledge/' + id) return null;
  if (kind === 'question' && href !== '#/solved') return null;
  if (/(^|\/)api(\/|$)/.test(href)) return null;
  var html = data && typeof data.html === 'string' ? data.html : '';
  if (html.length > PAGE_HTML_LIMIT) html = html.slice(0, PAGE_HTML_LIMIT);
  var title = data && typeof data.title === 'string' ? data.title.slice(0, 180) : '';
  return { kind: kind, id: id, href: href, title: title, html: html };
}

function rememberPage(data) {
  var item = acceptablePage(data);
  if (!item) return Promise.resolve();
  pageQueue = pageQueue.then(function () { return rememberPageNow(item); }).catch(function () {});
  return pageQueue;
}

function rememberPageNow(item) {
  return caches.open(SHELL).then(function (cache) {
    return cache.match(PAGES_INDEX).then(function (res) {
      return res ? res.json() : [];
    }).catch(function () { return []; }).then(function (list) {
      if (!Array.isArray(list)) list = [];
      list = list.filter(function (row) { return !(row && row.kind === item.kind && row.id === item.id); });
      list.unshift({ kind: item.kind, id: item.id, title: item.title, href: item.href, at: Date.now() });
      var drops = [];
      while (list.length > PAGE_LIMIT) {
        var old = list.pop();
        if (old && old.kind && old.id) drops.push(cache.delete(pageKey(old.kind, old.id)));
      }
      return Promise.all(drops).then(function () {
        return cache.put(pageKey(item.kind, item.id), new Response(item.html, {
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        }));
      }).then(function () {
        return cache.put(PAGES_INDEX, new Response(JSON.stringify(list), {
          headers: { 'Content-Type': 'application/json' }
        }));
      });
    });
  });
}

/* 推送只留事件结构。不订阅、不连推送服务、不改 fetch。 */
self.addEventListener('push', function (event) {
  var title = '先锋';
  var body = '有一条新通知';
  if (event.data) {
    try {
      var payload = event.data.json();
      if (payload && typeof payload.title === 'string' && payload.title) title = payload.title.slice(0, 80);
      if (payload && typeof payload.body === 'string' && payload.body) body = payload.body.slice(0, 180);
    } catch (err) {
      try {
        var text = event.data.text();
        if (text) body = String(text).slice(0, 180);
      } catch (ignore) {}
    }
  }
  if (!self.registration || !self.registration.showNotification) return;
  event.waitUntil(self.registration.showNotification(title, {
    body: body,
    data: { href: './index.html#/notifications' }
  }));
});

self.addEventListener('notificationclick', function (event) {
  if (event.notification && event.notification.close) event.notification.close();
  var target = new URL('./index.html#/notifications', self.registration.scope).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    var i;
    for (i = 0; i < list.length; i++) {
      if (list[i] && list[i].focus) return list[i].focus();
    }
    if (self.clients.openWindow) return self.clients.openWindow(target);
  }));
});
