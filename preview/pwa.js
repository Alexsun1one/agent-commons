/* R13 APP-1 · 安装条、离线卡片索引、推送只留界面。
   登记 window.CommonsPwa，并 push 到 window.CommonsPages。
   Service Worker 直接通过浏览器接口注册，不依赖图片或示例模块。
   监听仅在 mount 挂载，destroy 全部解除；注册结果可跨页面复用。 */
(function () {
  'use strict';

  var VERSION = 'app-1';
  var SCRIPT_SRC = document.currentScript && document.currentScript.src || location.href;
  var VISIT_KEY = 'pwa.visits';
  var DISMISS_KEY = 'pwa.install.dismissed';
  var PUSH_KEY = 'pwa.push.permission';
  var RECENT_KEY = 'pwa.recent';
  var PAGE_LIMIT = 50;

  var state = {
    booted: false,
    deferred: null,
    updateReady: false,
    controller: null,
    flagReady: false,
    windowBound: false,
    swStarted: false,
    watched: null,
    reg: null,
    uiBound: false,
    active: false,
    root: null
  };
  var unbind = [];

  function esc(value) {
    if (window.Commons && window.Commons.esc) return window.Commons.esc(value);
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function safeUrl(url) {
    if (window.Commons && window.Commons.safeUrl) return window.Commons.safeUrl(url);
    return '#';
  }

  function read(key, fallback) {
    try {
      return window.Commons && window.Commons.read ? window.Commons.read(key, fallback) : fallback;
    } catch (err) {
      return fallback;
    }
  }

  function write(key, value) {
    try {
      return !!(window.Commons && window.Commons.write && window.Commons.write(key, value));
    } catch (err) {
      return false;
    }
  }

  function on(target, type, fn) {
    target.addEventListener(type, fn);
    unbind.push(function () { target.removeEventListener(type, fn); });
  }

  function cleanId(id) {
    return /^[A-Za-z0-9._-]{1,80}$/.test(id) ? id : '';
  }

  function hashParts() {
    return String(location.hash || '').replace(/^#\/?/, '').split('/').filter(Boolean);
  }

  function visitCount() {
    var cur = read(VISIT_KEY, null);
    return cur && typeof cur.n === 'number' && cur.n > 0 ? cur.n : 0;
  }

  function noteVisit() {
    if (state.booted) return;
    state.booted = true;
    write(VISIT_KEY, { n: visitCount() + 1, at: Date.now() });
  }

  function onboardDone() {
    var flow = read('onboard.flow.v1', null);
    return !!(flow && flow.completed === true);
  }

  function standalone() {
    try {
      if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return true;
    } catch (err) { /* 匹配不到就当还在浏览器里 */ }
    return !!(window.navigator && window.navigator.standalone === true);
  }

  function isIos() {
    var ua = navigator.userAgent || '';
    if (/iPhone|iPad|iPod/i.test(ua)) return true;
    return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  }

  function installEligible() {
    if (standalone()) return false;
    if (read(DISMISS_KEY, false) === true) return false;
    return visitCount() >= 2 || onboardDone();
  }

  function loadRecent() {
    var list = read(RECENT_KEY, []);
    if (!Array.isArray(list)) return [];
    return list.filter(function (row) {
      return row && (row.kind === 'knowledge' || row.kind === 'question') && cleanId(row.id) && typeof row.title === 'string';
    }).slice(0, PAGE_LIMIT);
  }

  function postSnapshot(row) {
    var ctrl = navigator.serviceWorker && navigator.serviceWorker.controller;
    if (!ctrl) return;
    var html = '<article class="pwa-snap"><h1>' + esc(row.title) + '</h1><p>' + esc(row.excerpt) + '</p></article>';
    try {
      ctrl.postMessage({ type: 'remember-page', kind: row.kind, id: row.id, title: row.title, href: row.href, html: html });
    } catch (err) { /* 没有接管的 worker 时记在本机即可 */ }
  }

  function remember(item) {
    if (!item || (item.kind !== 'knowledge' && item.kind !== 'question')) return;
    var id = cleanId(item.id);
    var title = String(item.title || '').trim().slice(0, 180);
    if (!id || !title) return;
    var row = {
      kind: item.kind,
      id: id,
      title: title,
      excerpt: String(item.excerpt || '').trim().slice(0, 280),
      href: item.kind === 'knowledge' ? '#/knowledge/' + id : '#/solved',
      at: Date.now(),
      sample: true
    };
    var list = loadRecent().filter(function (old) { return !(old.kind === row.kind && old.id === row.id); });
    list.unshift(row);
    if (list.length > PAGE_LIMIT) list.length = PAGE_LIMIT;
    write(RECENT_KEY, list);
    postSnapshot(row);
  }

  function rememberQuestion(button) {
    if (!button) return;
    var titleNode = button.querySelector('strong');
    var excerptNode = button.querySelector('.kb-result-phenomenon');
    remember({
      kind: 'question',
      id: button.getAttribute('data-id') || '',
      title: titleNode ? titleNode.textContent : '',
      excerpt: excerptNode ? excerptNode.textContent : '',
      href: '#/solved'
    });
  }

  function noteKnowledge() {
    var parts = hashParts();
    if (parts[0] !== 'knowledge' || !parts[1]) return;
    var heading = document.querySelector('#main h1');
    if (!heading) return;
    var title = heading.textContent.trim();
    if (!title || title === '这个页面不存在') return;
    var lead = document.querySelector('#main .lead');
    remember({
      kind: 'knowledge',
      id: parts[1],
      title: title,
      excerpt: lead ? lead.textContent : '',
      href: '#/knowledge/' + parts[1]
    });
  }

  function noteSolved() {
    if (hashParts()[0] !== 'solved') return;
    rememberQuestion(document.querySelector('[data-kb-act="select"].is-active'));
  }

  function clearBars() {
    document.querySelectorAll('[data-pwa-bars]').forEach(function (node) { node.remove(); });
  }

  function actionButton(className, act, text) {
    var node = document.createElement('button');
    node.className = className;
    node.type = 'button';
    node.setAttribute('data-pwa-act', act);
    node.textContent = text;
    return node;
  }

  function updateBar() {
    var bar = document.createElement('div');
    bar.className = 'pwa-bar pwa-bar-update';
    bar.setAttribute('role', 'status');
    var copy = document.createElement('p');
    copy.textContent = '有新版本，刷新即可';
    bar.appendChild(copy);
    bar.appendChild(actionButton('button primary', 'refresh', '刷新'));
    return bar;
  }

  function iosSteps(host) {
    var list = document.createElement('ol');
    list.className = 'pwa-ios';
    var steps = [
      ['1', '点分享', '用浏览器的分享按钮。'],
      ['2', '添加到主屏幕', '在菜单里选这一项。'],
      ['3', '点添加', '名字是「先锋」。']
    ];
    steps.forEach(function (step) {
      var item = document.createElement('li');
      var num = document.createElement('span');
      num.textContent = step[0];
      var text = document.createElement('div');
      var title = document.createElement('b');
      title.textContent = step[1];
      var detail = document.createElement('p');
      detail.textContent = step[2];
      text.appendChild(title);
      text.appendChild(detail);
      item.appendChild(num);
      item.appendChild(text);
      list.appendChild(item);
    });
    host.appendChild(list);
  }

  function installBar() {
    if (!state.deferred && !isIos()) return null;
    var bar = document.createElement('div');
    bar.className = 'pwa-bar';
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', '安装应用');
    var img = document.createElement('img');
    img.src = 'assets/app-icons/icon-192.png';
    img.alt = '';
    img.width = 40;
    img.height = 40;
    var copy = document.createElement('div');
    var title = document.createElement('strong');
    title.textContent = '把先锋放到主屏幕';
    var detail = document.createElement('p');
    detail.textContent = state.deferred ? '断网也能打开看过的内容。' : '分享 → 添加到主屏幕';
    copy.appendChild(title);
    copy.appendChild(detail);
    if (!state.deferred) iosSteps(copy);
    bar.appendChild(img);
    bar.appendChild(copy);
    if (state.deferred) bar.appendChild(actionButton('button primary', 'install', '安装'));
    bar.appendChild(actionButton('button ghost', 'dismiss-install', '以后再说'));
    return bar;
  }

  function showBars() {
    clearBars();
    if (!document.body) return;
    var host = document.createElement('div');
    host.className = 'pwa-bars';
    host.setAttribute('data-pwa-bars', '');
    if (state.updateReady) host.appendChild(updateBar());
    if (installEligible()) {
      var bar = installBar();
      if (bar) host.appendChild(bar);
    }
    if (host.childElementCount) document.body.appendChild(host);
  }

  function syncInstallSlot() {
    var slot = document.querySelector('[data-pwa-install-slot]');
    if (!slot) return;
    slot.replaceChildren();
    if (state.deferred && installEligible()) {
      var row = document.createElement('div');
      row.className = 'pwa-actions';
      row.appendChild(actionButton('button primary', 'install', '安装'));
      row.appendChild(actionButton('button ghost', 'dismiss-install', '以后再说'));
      slot.appendChild(row);
    }
  }

  function promptInstall() {
    var event = state.deferred;
    if (!event || typeof event.prompt !== 'function') return;
    var choice;
    try { choice = event.prompt(); } catch (err) { return; }
    var done = event.userChoice || choice;
    if (!done || typeof done.then !== 'function') return;
    done.then(function (result) {
      state.deferred = null;
      if (result && result.outcome === 'accepted') write(DISMISS_KEY, true);
      showBars();
      syncInstallSlot();
    }).catch(function () {});
  }

  function refreshApp() {
    var waiting = state.reg && state.reg.waiting;
    if (waiting && waiting.postMessage) waiting.postMessage({ type: 'skip-waiting' });
    var ctrl = navigator.serviceWorker && navigator.serviceWorker.controller;
    if (ctrl && ctrl.postMessage) ctrl.postMessage({ type: 'skip-waiting' });
    window.location.reload();
  }

  /* safe-fn: 按权限枚举返回写死的句子 */
  function permissionCopy(value) {
    if (value === 'granted') return '通知已打开。';
    if (value === 'denied') return '通知已关闭。';
    if (value === 'unsupported') return '这台设备暂时不能开通知。';
    return '有新动静时提醒你。';
  }

  function askPush() {
    var note = document.querySelector('[data-pwa-push-note]');
    function say(text, value) {
      if (note) note.textContent = text;
      write(PUSH_KEY, { value: value || 'unknown', at: Date.now(), sent: false });
    }
    if (!window.Notification || typeof Notification.requestPermission !== 'function') {
      say('这台设备暂时不能开通知。', 'unsupported');
      return;
    }
    var pending;
    try { pending = Notification.requestPermission(); }
    catch (err) { say('这次没有打开。', Notification.permission); return; }
    if (!pending || typeof pending.then !== 'function') {
      say(permissionCopy(Notification.permission), Notification.permission);
      return;
    }
    pending.then(function (result) {
      say(permissionCopy(result), result);
    }).catch(function () {
      say('这次没有打开。', 'unknown');
    });
  }

  function onClick(event) {
    var actNode = event.target.closest('[data-pwa-act]');
    if (actNode) {
      var act = actNode.getAttribute('data-pwa-act');
      if (act === 'install') promptInstall();
      else if (act === 'dismiss-install') {
        write(DISMISS_KEY, true);
        showBars();
        syncInstallSlot();
      } else if (act === 'refresh') refreshApp();
      else if (act === 'push') askPush();
      return;
    }
    var card = event.target.closest('[data-kb-act="select"]');
    if (card) rememberQuestion(card);
  }

  function onBeforeInstall(event) {
    if (event && event.preventDefault) event.preventDefault();
    state.deferred = event;
    showBars();
    syncInstallSlot();
  }

  function onInstalled() {
    state.deferred = null;
    write(DISMISS_KEY, true);
    showBars();
    syncInstallSlot();
  }

  function onControllerChange() {
    var current = navigator.serviceWorker && navigator.serviceWorker.controller;
    if (!current) return;
    var replaced = state.controller && state.controller !== current;
    state.controller = current;
    if (replaced) { state.updateReady = true; showBars(); }
  }

  function onUpdateFound() {
    var worker = state.reg && state.reg.installing;
    if (!worker) return;
    on(worker, 'statechange', function () {
      if (worker.state === 'activated') onControllerChange();
    });
  }

  function versionOf(scriptURL) {
    var match = /[?&]v=([^&]+)/.exec(scriptURL || '');
    return match ? decodeURIComponent(match[1]) : '';
  }

  function watchReg(reg) {
    if (!reg) return;
    state.reg = reg;
    if (!state.active || state.watched === reg) return;
    state.watched = reg;
    on(reg, 'updatefound', onUpdateFound);
  }

  function registerApp() {
    if (!navigator.serviceWorker || !/^https?:$/.test(location.protocol)) return Promise.resolve(null);
    var url = new URL('sw.js', SCRIPT_SRC);
    url.searchParams.set('v', VERSION);
    return navigator.serviceWorker.register(url.href, { updateViaCache: 'none' }).then(function (reg) {
      if (reg) watchReg(reg);
      return reg;
    });
  }

  function registerSw() {
    if (state.swStarted) { watchReg(state.reg); return; }
    state.swStarted = true;
    if (!state.flagReady) {
      state.flagReady = true;
      state.controller = navigator.serviceWorker && navigator.serviceWorker.controller || null;
    }
    if (!navigator.serviceWorker || !/^https?:$/.test(location.protocol)) return;
    navigator.serviceWorker.getRegistration().then(function (existing) {
      if (!existing) return registerApp();
      var worker = existing.active || existing.installing || existing.waiting;
      var version = versionOf(worker && worker.scriptURL);
      if (version.indexOf('app-') !== 0) {
        watchReg(existing);
        return existing;
      }
      if (version !== VERSION) return registerApp();
      watchReg(existing);
      if (typeof existing.update === 'function') existing.update().catch(function () {});
      return existing;
    }).catch(function () { state.swStarted = false; });
  }

  function bindWindowOnce() {
    if (state.windowBound) return;
    state.windowBound = true;
    on(window, 'beforeinstallprompt', onBeforeInstall);
    on(window, 'appinstalled', onInstalled);
    if (navigator.serviceWorker) on(navigator.serviceWorker, 'controllerchange', onControllerChange);
  }

  /* safe-fn: 两个分支都是写死的句子 */
  function installCopyHtml() {
    if (standalone()) return '<p>已经从主屏幕打开，断网也能看过的内容。</p>';
    return '<p>装好后，断网也能打开看过的知识和问题。</p>';
  }

  /* safe-fn: 三步装法是写死的句子 */
  function stepsHtml() {
    if (standalone()) return '';
    return '<ol class="pwa-ios">' +
      '<li><span>1</span><div><b>iPhone</b><p>分享 → 添加到主屏幕</p></div></li>' +
      '<li><span>2</span><div><b>安卓</b><p>浏览器菜单 → 安装应用</p></div></li>' +
      '<li><span>3</span><div><b>电脑</b><p>点地址栏旁的安装图标</p></div></li>' +
      '</ol>';
  }

  /* safe-fn: 标题和摘要走 esc，链接走 safeUrl，种类只有两个字面量 */
  function recentHtml() {
    var list = loadRecent();
    if (!list.length) {
      return '<p class="pwa-empty">还没有看过的内容。</p>' +
        '<p class="pwa-actions"><a class="button" href="' + safeUrl('#/solved') + '">去看问题</a></p>';
    }
    return '<ol class="pwa-recent">' + list.map(function (item) {
      var kind = item.kind === 'question' ? '问题' : '知识';
      return '<li><a href="' + safeUrl(item.href) + '"><b>' + esc(item.title) + '</b><small>' + esc(kind) + '</small></a><p>' + esc(item.excerpt || '') + '</p></li>';
    }).join('') + '</ol>';
  }

  /* safe-fn: 按权限枚举返回写死的句子 */
  function pushNoteHtml() {
    var saved = read(PUSH_KEY, null);
    var value = saved && saved.value;
    return '<p data-pwa-push-note>' + permissionCopy(value) + '</p>';
  }

  /* safe-fn: 各段由上面的安全函数拼出，动态值已转义 */
  function appPage() {
    return '<main class="pwa-page" data-pwa-page>' +
      '<div class="pwa-head"><span>装到桌面，离线也能接着看</span><span class="pill outline">示例</span></div>' +
      '<div class="pwa-layout">' +
      '<section class="pwa-panel" aria-labelledby="pwa-install-title"><h2 id="pwa-install-title">怎么装</h2>' + installCopyHtml() +
      stepsHtml() + '<div data-pwa-install-slot></div></section>' +
      '<div class="pwa-side">' +
      '<section class="pwa-panel" aria-labelledby="pwa-recent-title"><h2 id="pwa-recent-title">最近看过</h2><p class="pwa-note">看过的知识和问题会留在这台设备上。</p>' + recentHtml() + '</section>' +
      '<section class="pwa-panel" aria-labelledby="pwa-push-title"><h2 id="pwa-push-title">通知</h2>' + pushNoteHtml() +
      '<div class="pwa-actions"><button class="button primary" type="button" data-pwa-act="push">开启通知</button></div>' +
      '<p class="pwa-note"><a href="' + safeUrl('#/account') + '">账号与隐私</a></p></section></div></div></main>';
  }

  function mount() {
    state.active = true;
    noteVisit();
    bindWindowOnce();
    registerSw();
    if (!state.uiBound) {
      state.uiBound = true;
      on(document, 'click', onClick);
    }
    showBars();
    var root = document.querySelector('[data-pwa-page]');
    if (!root) return;
    state.root = root;
    syncInstallSlot();
    noteKnowledge();
    noteSolved();
  }

  function destroy() {
    state.active = false;
    unbind.forEach(function (fn) { fn(); });
    unbind = [];
    state.uiBound = false;
    state.windowBound = false;
    state.watched = null;
    state.root = null;
    clearBars();
  }

  window.CommonsPwa = {
    routes: { app: appPage },
    hub: ['app'],
    nav: [['app', '安装应用', 'spark', 'personal']],
    titles: { app: '安装应用' },
    mount: mount,
    destroy: destroy,
    version: VERSION
  };
  (window.CommonsPages = window.CommonsPages || []).push(window.CommonsPwa);
})();
