/* 后端接口客户端：window.CommonsAPI。live 模式出错只抛错，不退回示例数据。 */
(function () {
  var BASE = '/api';

  function detectMode() {
    // A shipped live directory cannot be switched to demo by a later config object.
    if (window.COMMONS_BUILD_LIVE === true) return 'live';
    var build = window.COMMONS_BUILD && window.COMMONS_BUILD.mode;
    if (build === 'demo' || build === 'live') return build;
    var meta = document.querySelector('meta[name="commons-mode"]');
    if (meta && (meta.content === 'demo' || meta.content === 'live')) return meta.content;
    return location.protocol === 'file:' ? 'demo' : 'live';
  }

  function CommonsAPIError(status, code, message, requestId, extra) {
    var err = new Error(message || code);
    Object.setPrototypeOf(err, CommonsAPIError.prototype);
    err.name = 'CommonsAPIError';
    err.status = status;
    err.code = code;
    err.requestId = requestId || null;
    err.retryable = !!(extra && extra.retryable);
    err.details = extra || {};
    return err;
  }
  CommonsAPIError.prototype = Object.create(Error.prototype);
  CommonsAPIError.prototype.constructor = CommonsAPIError;

  function url(path, query) {
    if (typeof path !== 'string' || path.charAt(0) !== '/') throw new TypeError('path must start with /');
    var full = path.indexOf(BASE + '/') === 0 || path === BASE ? path : BASE + path;
    if (query) {
      var parts = [];
      Object.keys(query).forEach(function (key) {
        var value = query[key];
        if (value === undefined || value === null || value === '') return;
        parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(value));
      });
      if (parts.length) full += (full.indexOf('?') >= 0 ? '&' : '?') + parts.join('&');
    }
    return full;
  }

  function newKey() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    var bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    return Array.prototype.map.call(bytes, function (b) { return (b + 256).toString(16).slice(1); }).join('');
  }

  function request(method, path, body, opts) {
    opts = opts || {};
    if (api.mode !== 'live') {
      return Promise.reject(CommonsAPIError(0, 'demo_mode', '示例模式下不连接后端'));
    }
    var headers = { Accept: 'application/json' };
    var init = { method: method, credentials: 'same-origin', cache: 'no-store', headers: headers };
    if (method !== 'GET') {
      headers['X-Commons-CSRF'] = '1';
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body === undefined || body === null ? {} : body);
      if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
      if (opts.ifMatch) headers['If-Match'] = opts.ifMatch;
    }
    if (opts.signal) init.signal = opts.signal;
    var target = method === 'GET' ? url(path, body) : url(path);
    return fetch(target, init).then(function (res) {
      var etag = res.headers.get('ETag');
      return res.text().then(function (text) {
        var parsed = null;
        if (text) {
          try { parsed = JSON.parse(text); } catch (e) { parsed = null; }
        }
        if (!res.ok) {
          var e = parsed && parsed.error;
          if (e && e.code) throw CommonsAPIError(res.status, e.code, e.message, e.request_id, e);
          throw CommonsAPIError(res.status, 'http_' + res.status, '服务器返回了无法识别的错误',
            res.headers.get('X-Request-ID'));
        }
        if (!parsed || typeof parsed !== 'object' || !('data' in parsed)) {
          throw CommonsAPIError(res.status, 'bad_response', '服务器返回了无法识别的内容', res.headers.get('X-Request-ID'));
        }
        parsed.meta = parsed.meta || {};
        if (etag && !parsed.meta.etag) parsed.meta.etag = etag;
        return parsed;
      });
    }, function (err) {
      if (err && err.name === 'AbortError') throw err;
      throw CommonsAPIError(0, 'network_error', '网络连接失败，请稍后再试');
    });
  }

  var api = {
    mode: detectMode(),
    Error: CommonsAPIError,
    newIdempotencyKey: newKey,
    get: function (path, query, opts) { return request('GET', path, query, opts); },
    post: function (path, body, opts) { return request('POST', path, body, opts); },
    patch: function (path, body, opts) { return request('PATCH', path, body, opts); },
    put: function (path, body, opts) { return request('PUT', path, body, opts); },
    del: function (path, body, opts) { return request('DELETE', path, body, opts); },
    flags: function () { return request('GET', '/flags').then(function (r) { return r.data; }); },
    me: function () { return request('GET', '/me').then(function (r) { return r.data; }); }
  };

  window.CommonsAPI = api;
  // Shared mode for components that inspect build metadata before mounting.
  window.COMMONS_BUILD = Object.assign({}, window.COMMONS_BUILD || {}, { mode: api.mode });
  // CommonsSession is the shared identity contract. The shell owns return routing.
  var sessionState = api.mode === 'live' ? 'loading' : 'member';
  var sessionMe = null, sessionError = null, sessionRequest = 0;
  function sessionEvent(reason) {
    window.dispatchEvent(new CustomEvent('commons:session', {
      detail: { state: sessionState, me: sessionMe, error: sessionError, reason: reason || 'refresh' }
    }));
  }
  function refreshSession() {
    if (api.mode !== 'live') return Promise.resolve(null);
    var requestId = ++sessionRequest;
    return api.me().then(function (me) {
      if (requestId !== sessionRequest) return sessionMe;
      if (!me || typeof me.handle !== 'string') throw CommonsAPIError(0, 'bad_response', '账号信息没有加载出来');
      sessionState = 'member'; sessionMe = me; sessionError = null;
      sessionEvent();
      return me;
    }).catch(function (err) {
      if (requestId !== sessionRequest) return sessionMe;
      if (err && err.status === 401) {
        sessionState = 'guest'; sessionMe = null; sessionError = null;
        sessionEvent();
        return null;
      }
      sessionError = '账号信息没有加载出来，请重试。';
      sessionEvent();
      throw err;
    });
  }
  function signOut() {
    if (api.mode !== 'live') return Promise.resolve(null);
    ++sessionRequest; // An older /me response must not revive a signed-out identity.
    return api.post('/auth/logout').then(function () {
      ++sessionRequest;
      sessionState = 'guest'; sessionMe = null; sessionError = null;
      sessionEvent('signout');
      return refreshSession().finally(function () { location.hash = '#/hello'; });
    }, function (err) {
      sessionError = '退出状态未确认，请重试。';
      sessionEvent('signout-error');
      throw err;
    });
  }
  window.CommonsSession = Object.freeze({
    get state() { return sessionState; },
    get me() { return sessionMe; },
    get error() { return sessionError; },
    refresh: refreshSession,
    signOut: signOut,
    hasRole: function (name) {
      return ['admin', 'governor', 'host', 'lecturer', 'space_owner'].indexOf(name) !== -1 &&
        !!(sessionMe && Array.isArray(sessionMe.roles) && sessionMe.roles.indexOf(name) !== -1);
    },
    // /api/me.capabilities lists non-owner-only action_rule entries this member passes (level, role, flag).
    can: function (action) {
      if (api.mode !== 'live') return true;
      return !!(sessionMe && Array.isArray(sessionMe.capabilities) && sessionMe.capabilities.indexOf(action) !== -1);
    },
    // /api/me.capability_reasons: why an action is unavailable, as one sentence; '' when allowed or unknown.
    reason: function (action) {
      if (api.mode !== 'live' || !sessionMe) return '';
      var why = sessionMe.capability_reasons && sessionMe.capability_reasons[action];
      if (!why) return '';
      var ROLE = { admin: '管理员', governor: '治理员', host: '主持人', lecturer: '讲师', space_owner: '空间主理人' };
      var roles = (why.roles || []).map(function (r) { return ROLE[r] || r; }).join('、');
      if (why.reason === 'feature_off') return '这个功能还没开放';
      if (why.reason === 'level') return '需要 L' + why.min_level + '（你现在是 L' + why.level + '）' + (roles ? '，或担任' + roles : '');
      if (why.reason === 'role') return '需要担任' + roles;
      if (why.reason === 'totp') return '先在账号里开启动态验证码';
      if (why.reason === 'status') return '账号当前的状态不能做这件事';
      if (why.reason === 'unauthenticated') return '请先登录';
      return '';
    }
  });
  if (api.mode === 'live') {
    // Compatibility shapes contain no records. Never retain globals from a demo tab.
    var empty = Object.freeze([]);
    window.COMMONS_DATA = Object.freeze({ people: empty, works: empty, methods: empty,
      goals: empty, topics: empty, opportunities: empty });
    window.COMMONS_FIELDWORK = Object.freeze({ items: empty });
  }
})();
