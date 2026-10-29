/* R13 R5 · #/login 登录、两步验证与重置码。自行登记 CommonsPages。 */
(function () {
  'use strict';

  var LEGAL = [
    { id: 'age', title: '十八岁以上声明', href: 'legal/age-18.html' },
    { id: 'rules', title: '社区规则', href: 'legal/rules.html' },
    { id: 'terms', title: '用户协议', href: 'legal/terms.html' },
    { id: 'privacy', title: '隐私政策', href: 'legal/privacy.html' },
    { id: 'retention', title: '数据保留期限表', href: 'legal/retention.html' }
  ];

  var state = {
    root: null, panel: 'login', handle: '', password: '', busy: false, error: '', note: '',
    unbind: [], controller: null, generation: 0
  };

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
    });
  }
  function C() { return window.Commons || {}; }
  function api() { return window.CommonsAPI; }
  function live() { return !!(api() && api().mode === 'live'); }
  function session() { return window.CommonsSession || null; }
  function toast(message) { if (typeof C().toast === 'function') C().toast(message); }
  function safeUrl(href) { return C().safeUrl ? C().safeUrl(href) : '#'; }

  function icon(name) {
    var paths = {
      arrow: 'M5 12h14m-6-6 6 6-6 6', back: 'M20 12H4M10 6l-6 6 6 6',
      key: 'M14 8a5 5 0 1 1-2 4l8 8m-3-3 2-2', shield: 'M12 3 5 6v5c0 4.5 3 7.5 7 10 4-2.5 7-5.5 7-10V6z'
    };
    return '<svg class="auth-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + esc(paths[name] || paths.key) + '"/></svg>';
  }

  function messageFor(error) {
    var code = error && error.code;
    if (code === 'invalid_credentials') return '账号或密码不对。请核对后再试。';
    if (code === 'totp_required') return '这个账号开了两步验证。请输入验证器上的 6 位数字。';
    if (code === 'totp_invalid') return '动态验证码不对，或已经用过。等下一组再试。';
    if (code === 'rate_limited') return '尝试太频繁了。请稍后再试。';
    if (code === 'network_error') return '没有连上账号服务。输入还在，请检查网络后重试。';
    if (code === 'demo_mode') return '演示版不连接账号。';
    return (error && error.message) || '没有登录成功。输入还在，请重试。';
  }

  function currentRoute() {
    return String(location.hash || '').replace(/^#\/?/, '').split('?')[0].split('/')[0];
  }

  function stillOnLogin() {
    return currentRoute() === 'login';
  }

  function sessionRetryMessage() {
    var sess = session();
    return (sess && sess.error) || '账号信息没有加载出来，请重试。';
  }

  function takeReturnHash() {
    var sess = session();
    var raw = '';
    if (sess && typeof sess.returnTo === 'string') raw = sess.returnTo;
    if (!raw && typeof C().read === 'function') raw = C().read('session.returnTo', '') || '';
    if (!raw) {
      var query = location.hash.split('?')[1] || '';
      var match = /(?:^|&)next=([^&]+)/.exec(query);
      if (match) {
        try { raw = decodeURIComponent(match[1]); } catch (e) { raw = ''; }
      }
    }
    raw = String(raw || '').trim();
    if (raw && raw.charAt(0) !== '#') raw = '#/' + raw.replace(/^\//, '');
    var pathQuery = raw.replace(/^#\/?/, '');
    var first = pathQuery.split('?')[0].split('/')[0];
    if (!pathQuery || first === 'login' || first === 'welcome' || first === 'hello') return '#/home';
    if (!/^[a-z][a-z0-9-]*(?:\/[A-Za-z0-9._~-]+)*(?:\?[^#]*)?$/.test(pathQuery)) return '#/home';
    return raw.indexOf('#/') === 0 ? raw : '#/' + pathQuery;
  }

  function goAfterSignIn() {
    if (!stillOnLogin()) return;
    var hash = takeReturnHash();
    if (typeof C().write === 'function') C().write('session.returnTo', '');
    location.hash = hash;
  }

  /* safe-fn: 摘要是写死常量；href 取自 LEGAL 表 */
  function legalBody(kind) {
    var blocks = {
      age: '<p>内测只对已满 18 周岁的人开放。注册勾选即作出声明。</p>',
      rules: '<p>对事不对人。删除、封禁须治理员确认。房间不录音。</p>',
      terms: '<p>邀请码一次性。内容版权归你。Agent 发言视为你发言。</p>',
      privacy: '<p>行为计量单独同意。注销冷静期 7 天。跨境单独同意尚未落地。</p>',
      retention: '<p>会话 14 天，导出包 24 小时，邀请码默认 7 天。未定义项上线前定死。</p>'
    };
    var item = LEGAL.filter(function (row) { return row.id === kind; })[0] || LEGAL[0];
    var more = live()
      ? '<p><a class="button ghost" href="' + safeUrl(item.href) + '">打开全文</a></p>'
      : '<p>初稿 · 生效日期待填 · 版本待定</p>';
    return '<div class="auth-legal-full">' + (blocks[kind] || blocks.rules) + more + '</div>';
  }

  function legalNav() {
    return LEGAL.map(function (item) {
      return live()
        ? '<a href="' + safeUrl(item.href) + '">' + esc(item.title) + '</a>'
        : '<button type="button" data-auth-act="legal" data-doc="' + esc(item.id) + '">' + esc(item.title) + '</button>';
    }).join('');
  }

  function feedback() {
    if (state.error) return '<p class="auth-feedback" data-auth-feedback role="alert">' + esc(state.error) + '</p>';
    if (state.note) return '<p class="auth-note" data-auth-feedback role="status">' + esc(state.note) + '</p>';
    return '<p class="auth-feedback" data-auth-feedback role="status"></p>';
  }

  function loginForm() {
    return '<form data-auth-form="login" class="auth-form">' +
      '<div class="field"><label for="auth-handle">登录名</label><input id="auth-handle" name="handle" required minlength="3" maxlength="32" pattern="[a-z0-9_]{3,32}" autocomplete="username" value="' + esc(state.handle) + '" placeholder="例如 lin_09"><small>3–32 位小写字母、数字或下划线。</small></div>' +
      '<div class="field"><label for="auth-password">密码</label><input id="auth-password" name="password" type="password" required minlength="10" maxlength="128" autocomplete="current-password" placeholder="至少 10 个字符"></div>' +
      feedback() +
      '<div class="auth-actions"><button class="button primary large" type="submit"' + (state.busy ? ' aria-busy="true"' : '') + '><span class="button-spinner" aria-hidden="true"></span>' + (state.busy ? '正在登录' : '登录') + '</button></div>' +
      '</form>';
  }

  function totpForm() {
    return '<form data-auth-form="totp" class="auth-form">' +
      '<p class="auth-lead">账号 <b>' + esc(state.handle) + '</b> 开了两步验证。</p>' +
      '<div class="field"><label for="auth-totp">6 位动态验证码</label><input id="auth-totp" name="totp" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required placeholder="000000"></div>' +
      feedback() +
      '<div class="auth-actions"><button class="button" type="button" data-auth-act="panel" data-panel="login">' + icon('back') + ' 返回</button><button class="button primary large" type="submit"' + (state.busy ? ' aria-busy="true"' : '') + '><span class="button-spinner" aria-hidden="true"></span>' + (state.busy ? '正在验证' : '继续登录') + '</button></div>' +
      '</form>';
  }

  function resetForm() {
    return '<form data-auth-form="reset" class="auth-form">' +
      '<p class="auth-lead">重置码由管理员签发，一次性、有期限。这里不会向任何人发邮件。</p>' +
      '<div class="field"><label for="auth-reset-handle">登录名</label><input id="auth-reset-handle" name="handle" required minlength="3" maxlength="32" pattern="[a-z0-9_]{3,32}" autocomplete="username" value="' + esc(state.handle) + '"></div>' +
      '<div class="field"><label for="auth-reset-code">重置码</label><input id="auth-reset-code" name="reset_code" required maxlength="64" autocomplete="one-time-code" placeholder="管理员发给你的一次性码"></div>' +
      '<div class="field"><label for="auth-reset-password">新密码</label><input id="auth-reset-password" name="new_password" type="password" required minlength="10" maxlength="128" autocomplete="new-password" placeholder="至少 10 个字符"></div>' +
      feedback() +
      '<div class="auth-actions"><button class="button" type="button" data-auth-act="panel" data-panel="login">' + icon('back') + ' 返回登录</button><button class="button primary large" type="submit"' + (state.busy ? ' aria-busy="true"' : '') + '><span class="button-spinner" aria-hidden="true"></span>' + (state.busy ? '正在重置' : '重置密码') + '</button></div>' +
      '</form>';
  }

  function panelCopy() {
    if (state.panel === 'totp') return { title: '输入动态验证码', lead: '验证器上的数字大约 30 秒换一次。' };
    if (state.panel === 'reset') return { title: '用重置码换新密码', lead: '向管理员要一次性重置码，再设新密码。' };
    return { title: '登录先锋队', lead: '用登录名和密码进入。开了两步验证时会再要一组数字。' };
  }

  /* safe-fn: 分块由本文件写死；动态值已 esc */
  function inner() {
    var copy = panelCopy();
    var form = state.panel === 'totp' ? totpForm() : state.panel === 'reset' ? resetForm() : loginForm();
    var demo = live() ? '' : '<p class="auth-demo" role="status">演示版不连接账号</p>';
    var links = state.panel === 'login'
      ? '<div class="auth-links"><button type="button" data-auth-act="panel" data-panel="reset">忘记密码</button><a href="#/welcome">用邀请码加入</a></div>'
      : '';
    return '<div class="auth-shell">' +
      '<aside class="auth-art"><img src="assets/mascot/panda-main-front-1024.webp" alt="先锋熊猫"><div><h2>先确认你是谁</h2><p>邀请制内测。没有账号，向邀请人要码。</p></div></aside>' +
      '<section class="auth-card"><header><p class="auth-kicker">邀请制内测</p><h1>' + esc(copy.title) + '</h1><p>' + esc(copy.lead) + '</p></header>' +
      demo + form + links +
      '<nav class="auth-legal" aria-label="规则与政策">' + legalNav() + '</nav>' +
      '</section></div>';
  }

  function view() {
    return '<main class="auth-page" data-auth>' + inner() + '</main>';
  }

  function paint(focusSel) {
    if (!state.root) return;
    state.root.innerHTML = inner();
    var next = focusSel && state.root.querySelector(focusSel);
    if (next) next.focus({ preventScroll: true });
  }

  function switchPanel(panel) {
    state.panel = panel;
    state.error = '';
    if (panel !== 'totp') state.note = '';
    state.busy = false;
    paint(panel === 'reset' ? '#auth-reset-handle' : panel === 'totp' ? '#auth-totp' : '#auth-handle');
  }

  function afterSignedIn() {
    var sess = session();
    var generation = state.generation;
    function stay(message) {
      if (generation !== state.generation || !state.root) return;
      state.busy = false;
      state.error = message || sessionRetryMessage();
      state.note = '';
      paint();
    }
    function jump() {
      if (generation !== state.generation) return;
      state.busy = false;
      state.password = '';
      if (!stillOnLogin()) return;
      goAfterSignIn();
    }
    if (!sess || typeof sess.refresh !== 'function') {
      stay('账号信息没有加载出来，请重试。');
      return;
    }
    Promise.resolve(sess.refresh()).then(function () {
      if (generation !== state.generation || !state.root) return;
      if (sess.state !== 'member') {
        stay(sess.error || '账号信息没有加载出来，请重试。');
        return;
      }
      jump();
    }, function () {
      stay(sess.error || '账号信息没有加载出来，请重试。');
    });
  }

  function post(path, body) {
    if (state.controller) state.controller.abort();
    state.controller = window.AbortController ? new AbortController() : null;
    return api().post(path, body, {
      idempotencyKey: api().newIdempotencyKey(),
      signal: state.controller && state.controller.signal
    });
  }

  function submitLogin(form) {
    var data = new FormData(form);
    var handle = String(data.get('handle') || '').trim().toLowerCase();
    var password = String(data.get('password') || '');
    if (!handle || !password) { state.error = '请填写登录名和密码。'; paint('#auth-handle'); return; }
    state.handle = handle;
    state.password = password;
    if (!live()) {
      state.error = '';
      state.note = '演示版不连接账号。';
      toast('演示版不连接账号');
      paint();
      return;
    }
    state.busy = true;
    state.error = '';
    state.note = '';
    paint();
    var generation = state.generation;
    post('/auth/login', { handle: handle, password: password }).then(function () {
      if (generation !== state.generation || !state.root) return;
      afterSignedIn();
    }).catch(function (error) {
      if (generation !== state.generation || !state.root || (error && error.name === 'AbortError')) return;
      state.busy = false;
      if (error && error.code === 'totp_required') {
        state.error = '';
        state.note = messageFor(error);
        state.panel = 'totp';
        paint('#auth-totp');
        return;
      }
      state.error = messageFor(error);
      paint('#auth-password');
    });
  }

  function submitTotp(form) {
    var code = String(new FormData(form).get('totp') || '').trim();
    if (!/^[0-9]{6}$/.test(code)) { state.error = '请输入 6 位数字。'; paint('#auth-totp'); return; }
    if (!live()) {
      state.error = '';
      state.note = '演示版不连接账号。';
      toast('演示版不连接账号');
      paint();
      return;
    }
    if (!state.handle || !state.password) { switchPanel('login'); return; }
    state.busy = true;
    state.error = '';
    paint();
    var generation = state.generation;
    post('/auth/login', { handle: state.handle, password: state.password, totp_code: code }).then(function () {
      if (generation !== state.generation || !state.root) return;
      afterSignedIn();
    }).catch(function (error) {
      if (generation !== state.generation || !state.root || (error && error.name === 'AbortError')) return;
      state.busy = false;
      state.error = messageFor(error);
      paint('#auth-totp');
    });
  }

  function submitReset(form) {
    var data = new FormData(form);
    var handle = String(data.get('handle') || '').trim().toLowerCase();
    var resetCode = String(data.get('reset_code') || '').trim();
    var password = String(data.get('new_password') || '');
    state.handle = handle;
    if (!live()) {
      state.error = '';
      state.note = '演示版不连接账号。';
      toast('演示版不连接账号');
      paint();
      return;
    }
    state.busy = true;
    state.error = '';
    state.note = '';
    paint();
    var generation = state.generation;
    post('/auth/reset', { handle: handle, reset_code: resetCode, new_password: password }).then(function () {
      if (generation !== state.generation || !state.root) return;
      state.busy = false;
      state.panel = 'login';
      state.note = '密码已重置。请用新密码登录。';
      state.error = '';
      paint('#auth-password');
    }).catch(function (error) {
      if (generation !== state.generation || !state.root || (error && error.name === 'AbortError')) return;
      state.busy = false;
      state.error = messageFor(error);
      paint('#auth-reset-code');
    });
  }

  function onSubmit(event) {
    var form = event.target.closest('[data-auth-form]');
    if (!form || !state.root || !state.root.contains(form)) return;
    event.preventDefault();
    if (state.busy) return;
    if (form.dataset.authForm === 'totp') submitTotp(form);
    else if (form.dataset.authForm === 'reset') submitReset(form);
    else submitLogin(form);
  }

  function onClick(event) {
    var button = event.target.closest('[data-auth-act]');
    if (!button || !state.root || !state.root.contains(button)) return;
    var act = button.dataset.authAct;
    if (act === 'panel') switchPanel(button.dataset.panel || 'login');
    else if (act === 'legal') {
      var item = LEGAL.filter(function (row) { return row.id === button.dataset.doc; })[0];
      if (item && typeof C().modal === 'function') C().modal(item.title + ' · 初稿', legalBody(item.id));
    }
  }

  function on(target, type, handler) {
    target.addEventListener(type, handler);
    state.unbind.push(function () { target.removeEventListener(type, handler); });
  }

  function mount() {
    var root = document.querySelector('[data-auth]');
    if (!root) return;
    destroy();
    state.root = root;
    state.generation += 1;
    on(document, 'click', onClick);
    on(document, 'submit', onSubmit);
  }

  function destroy() {
    state.generation += 1;
    state.unbind.forEach(function (unbind) { unbind(); });
    state.unbind = [];
    if (state.controller) state.controller.abort();
    state.controller = null;
    state.root = null;
    state.busy = false;
    state.password = '';
    state.error = '';
    state.note = '';
    state.panel = 'login';
  }

  window.CommonsAuth = {
    routes: { login: view },
    titles: { login: '登录' },
    bare: ['login'],
    mount: mount,
    destroy: destroy
  };
  (window.CommonsPages = window.CommonsPages || []).push(window.CommonsAuth);
})();
