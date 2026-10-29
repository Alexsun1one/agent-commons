/* R13 ONB-1 · #/account 账号与隐私中心。自行登记 CommonsPages。 */
(function () {
  'use strict';

  var KEY = 'account.preferences.v1';
  var state = {
    root: null, prefs: null, me: null, devices: [], agents: [], totp: null, deleting: false, signingOutOthers: false, meteringBusy: false,
    exportState: null, exportUrl: '', controller: null, timers: [], unbind: [], generation: 0, status: '',
    avatar: { url: '', busy: false, ratio: 0, error: '', retry: null }, rank: { state: 'idle', optedOut: false, publicOn: false, busy: false },
    liveDevices: [], deviceState: 'idle', liveAgents: [], tokenState: 'idle', cardScope: null, cardState: 'idle', visibilityBusy: false, sensitive: null, writeSig: '', writeKey: ''
  };
  var VISIBILITY = [['self', '仅自己'], ['invited', '受邀成员'], ['members', '社区成员']];

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
    });
  }

  function C() { return window.Commons || {}; }
  function api() { return window.CommonsAPI; }
  function live() { return !!(api() && api().mode === 'live'); }
  function sample() { return (window.COMMONS_ONBOARD_SAMPLE || {}).account || { me: {}, devices: [], agents: [], visibility: [] }; }
  function toast(message) { if (typeof C().toast === 'function') C().toast(message); }
  function read(key, fallback) { return typeof C().read === 'function' ? C().read(key, fallback) : fallback; }
  function write(key, value) { return typeof C().write === 'function' ? C().write(key, value) : false; }

  function defaults() {
    return { metering: true, ranking: false, visibility: 'members', totpEnabled: false, deleteState: null, signedOutOthers: false };
  }

  function loadPrefs() {
    var raw = read(KEY, null);
    return Object.assign(defaults(), raw && typeof raw === 'object' ? raw : {});
  }

  function savePrefs() { return write(KEY, state.prefs); }

  function icon(name) {
    var paths = {
      shield: 'M12 3 5 6v5c0 4.5 3 7.5 7 10 4-2.5 7-5.5 7-10V6z', check: 'M5 12l4 4L19 6',
      device: 'M5 4h14v11H5zM9 20h6m-3-5v5', key: 'M14 8a5 5 0 1 1-2 4l8 8m-3-3 2-2',
      data: 'M4 6c0-2 16-2 16 0s-16 2-16 0v6c0 2 16 2 16 0V6m0 6v6c0 2-16 2-16 0v-6',
      agent: 'M8 8V5m8 3V5M5 10h14v9H5zM9 14h.01M15 14h.01M9 18h6',
      arrow: 'M5 12h14m-6-6 6 6-6 6', download: 'M12 4v11m-4-4 4 4 4-4M5 20h14',
      trash: 'M6 7h12m-9 0V4h6v3m-8 0 1 13h8l1-13', bell: 'M6 9a6 6 0 0 1 12 0v5l2 3H4l2-3zm4 11h4',
      lock: 'M7 11V8a5 5 0 0 1 10 0v3m-11 0h12v10H6z', close: 'm7 7 10 10M17 7 7 17', refresh: 'M20 7v5h-5M4 17v-5h5M6 8a7 7 0 0 1 12-2l2 2M18 16a7 7 0 0 1-12 2l-2-2',
      book: 'M4 5c3-1 6-1 8 1 2-2 5-2 8-1v14c-3-1-6-1-8 1-2-2-5-2-8-1z'
    };
    return '<svg class="acc-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + esc(paths[name] || paths.shield) + '"/></svg>';
  }

  function switchButton(action, checked, label, disabled) {
    return '<button type="button" class="acc-switch" data-acc-act="' + esc(action) + '" role="switch" aria-checked="' + esc(String(checked)) + '" aria-label="' + esc(label) + '"' + (disabled ? ' disabled aria-disabled="true"' : '') + '><span aria-hidden="true"><i></i></span></button>';
  }

  function statusPill(text, kind) { return '<span class="acc-status' + (kind ? ' is-' + esc(kind) : '') + '">' + esc(text) + '</span>'; }

  function errorMessage(error, fallback) {
    var code = error && error.code;
    if (code === 'unauthenticated' || code === 'session_expired') return '登录已过期。请重新登录后再继续。';
    if (code === 'totp_required') return '需要动态验证码。';
    if (code === 'totp_invalid') return '动态验证码不正确或已经使用过。等下一组验证码再试。';
    if (code === 'invalid_credentials') return '密码、重置码或验证码不正确。请核对后重试。';
    if (code === 'state_conflict') return (error && error.message) || '账号状态已经变化，请重新读取后再试。';
    if (code === 'rate_limited') return '尝试太频繁了。请按提示稍后再试。';
    if (code === 'network_error') return '没有连上账号服务。原数据没有变化，请稍后重试。';
    if (code === 'capability_unavailable') return '这个功能还没开放。管理员还没打开。';
    return (error && error.message) || fallback || '操作没有完成。原数据没有变化。';
  }

  function accountMe() { return state.me || (live() ? {} : sample().me) || {}; }
  function totpEnabled() { return live() ? !!accountMe().totp_enabled : !!state.prefs.totpEnabled; }
  function pendingDeletion() {
    if (live()) return accountMe().status === 'pending_deletion';
    return !!state.prefs.deleteState;
  }

  function top() {
    var me = accountMe();
    return '<div class="acc-toolbar"><span>安全、可见范围与数据权利</span><div class="acc-toolbar-actions">' + (live() ? '' : '<span class="pill outline">示例</span>') + '<button type="button" class="button ghost" data-acc-act="signout">退出登录</button></div></div><div class="acc-person"><span>' + personFace(me) + '</span><div><b>' + esc(me.display_name || (live() ? '正在读取账号' : '我的账号')) + '</b><small>' + (me.handle ? '@' + esc(me.handle) + ' · L' + esc(me.level || 1) : '账号信息尚未载入') + '</small></div></div>' + avatarBlock();
  }

  /* 头像只认站内媒体地址（/api/media/f/<sha>.<ext>），其余一律不当图片用。 */
  var MEDIA_URL = /^\/api\/media\/f\/[0-9a-f]{64}\.(webp|jpg|avif)$/;
  function personFace(me) {
    if (live() && MEDIA_URL.test(state.avatar.url)) return '<img src="' + /* safe: 已过 MEDIA_URL 白名单，只放行 /api/media/f/ 下的哈希文件 */ esc(state.avatar.url) + '" alt="" width="40" height="40">';
    return esc(String(me.display_name || '我').slice(0, 1));
  }

  function canAvatar() {
    var session = window.CommonsSession;
    return !session || typeof session.can !== 'function' || (session.can('account.avatar.set') && session.can('upload.avatar'));
  }

  /* safe-fn: 状态文字逐值转义；按钮是写死的 */
  function avatarBlock() {
    if (!live()) return '';
    var a = state.avatar;
    var me = accountMe();
    if (!canAvatar()) {
      var session = window.CommonsSession;
      var why = session && typeof session.reason === 'function' ? (session.reason('account.avatar.set') || session.reason('upload.avatar')) : '';
      return '<p class="acc-page-status" data-acc-avatar>' + (why ? '现在还不能换头像：' + esc(why) + '。' : '你现在还不能换头像。') + '</p>';
    }
    var note = a.busy ? '正在上传头像 ' + Math.round(a.ratio * 100) + '%' : a.error;
    return '<div class="acc-inline-actions" data-acc-avatar><label class="button' + (a.busy ? ' is-disabled' : '') + '"><input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" hidden data-acc-avatar-file' + (a.busy ? ' disabled' : '') + '>换头像</label>' +
      (me.avatar_ref && !a.busy ? '<button type="button" class="button ghost" data-acc-act="avatar-clear">移除头像</button>' : '') +
      (a.retry && !a.busy ? '<button type="button" class="button ghost" data-acc-act="avatar-retry">重试</button>' : '') +
      '<small role="' + (a.error && !a.busy ? 'alert' : 'status') + '" aria-live="polite">' + esc(note || '') + '</small></div>';
  }

  function paintAvatar() {
    if (!state.root) return;
    var box = state.root.querySelector('[data-acc-avatar]');
    if (!box) { paint(); return; }
    var holder = document.createElement('div');
    holder.innerHTML = avatarBlock();
    if (holder.firstElementChild) box.replaceWith(holder.firstElementChild);
    var face = state.root.querySelector('.acc-person>span:first-child');
    if (face) face.innerHTML = personFace(accountMe());
  }

  function avatarFromAsset(asset) {
    if (!asset) return '';
    var sizes = asset.sizes || {};
    return sizes['128'] || sizes['256'] || sizes['64'] || (asset.image && asset.image.src) || '';
  }

  function loadAvatar(me, generation) {
    if (!me || !me.avatar_ref) { state.avatar.url = ''; return; }
    api().get('/media/assets/' + encodeURIComponent(me.avatar_ref)).then(function (response) {
      if (generation !== state.generation || !state.root) return;
      state.avatar.url = avatarFromAsset(response.data);
      paintAvatar();
    }).catch(function () {});
  }

  // 外壳头像只听这个轻量事件；不走 CommonsSession.refresh()，免得整页重挂，把「头像换好了」冲掉。
  function announceAvatar(ref, url) {
    try { window.dispatchEvent(new CustomEvent('commons:avatar', { detail: { avatar_ref: ref, url: url } })); } catch (e) { /* 外壳晚一点自己会对上 */ }
  }

  function commitAvatar(assetId, key, generation) {
    state.avatar.busy = true; state.avatar.error = ''; state.avatar.retry = null; state.avatar.ratio = 1;
    paintAvatar();
    return api().put('/account/avatar', { asset_id: assetId }, { idempotencyKey: key, signal: state.controller && state.controller.signal }).then(function (response) {
      if (generation !== state.generation || !state.root) return;
      var data = response && response.data || {};
      state.me = Object.assign({}, state.me, { avatar_ref: data.avatar_ref || null });
      state.avatar.url = (data.avatar && (data.avatar['128'] || data.avatar['256'])) || '';
      state.avatar.busy = false;
      state.status = '头像换好了。';
      announceAvatar(data.avatar_ref || '', state.avatar.url);
      paint();
    }, function (error) {
      if (generation !== state.generation || !state.root) return;
      state.avatar.busy = false;
      state.avatar.error = errorMessage(error, '头像没换成，原头像没变。');
      state.avatar.retry = function () { return commitAvatar(assetId, key, generation); };
      paintAvatar();
    });
  }

  function startAvatar(file) {
    var M = window.CommonsMedia;
    if (!live() || state.avatar.busy || !file) return;
    var generation = state.generation;
    var key = api().newIdempotencyKey();
    state.avatar.busy = true; state.avatar.error = ''; state.avatar.retry = null; state.avatar.ratio = 0;
    paintAvatar();
    function failed(err) {
      if (generation !== state.generation || !state.root) return;
      state.avatar.busy = false;
      state.avatar.error = (err && err.message) || '头像没传上去，请重试。';
      state.avatar.retry = err && typeof err.retry === 'function' ? function () { state.avatar.busy = true; state.avatar.error = ''; state.avatar.retry = null; paintAvatar(); return err.retry().then(done, failed); } : null;
      paintAvatar();
    }
    function done(res) {
      if (generation !== state.generation || !state.root) return;
      return commitAvatar(res.id, key, generation);
    }
    if (!M || typeof M.upload !== 'function') { failed(new Error('上传组件没加载上，刷新页面再试。')); return; }
    M.upload(file, { purpose: 'avatar', onProgress: function (p) { state.avatar.ratio = p.ratio; if (generation === state.generation) paintAvatar(); } }).then(done, failed);
  }

  function clearAvatar() {
    var generation = state.generation;
    var key = api().newIdempotencyKey();
    state.avatar.busy = true; state.avatar.error = ''; state.avatar.retry = null;
    paintAvatar();
    api().del('/account/avatar', null, { idempotencyKey: key, signal: state.controller && state.controller.signal }).then(function (response) {
      if (generation !== state.generation || !state.root) return;
      state.me = Object.assign({}, state.me, { avatar_ref: null });
      state.avatar.url = '';
      state.avatar.busy = false;
      state.status = '头像已移除。';
      announceAvatar('', '');
      paint();
    }, function (error) {
      if (generation !== state.generation || !state.root) return;
      state.avatar.busy = false;
      state.avatar.error = errorMessage(error, '头像没移除，原头像没变。');
      paintAvatar();
    });
  }

  function totpPanel() {
    var enabled = totpEnabled();
    var setup = state.totp;
    var body = '';
    if (setup && setup.mode === 'setup') {
      body = '<div class="acc-totp-setup"><div class="acc-qr" aria-label="二维码位置占位"><span></span><span></span><span></span><span></span><b>QR</b></div><div><span class="acc-kicker">验证器设置</span><p>扫描二维码，或手动输入密钥。</p><code>' + esc(setup.secret) + '</code>' + (!live() ? statusPill('示例密钥', 'sample') : '') + '<form data-acc-form="totp-enable"><div class="field"><label for="account-totp-enable-code">6 位动态验证码</label><input id="account-totp-enable-code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required></div><div class="acc-inline-actions"><button class="button primary" type="submit">验证并开启</button><button class="button ghost" type="button" data-acc-act="totp-cancel">取消</button></div></form></div></div>';
    } else if (setup && setup.mode === 'disable') {
      body = '<form data-acc-form="totp-disable" class="acc-inline-form"><div class="field"><label for="account-totp-disable-code">6 位动态验证码</label><input id="account-totp-disable-code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required></div><div class="field"><label for="account-totp-password">当前密码</label><input id="account-totp-password" name="password" type="password" autocomplete="current-password" maxlength="128" required></div><div class="acc-inline-actions"><button class="button danger" type="submit">关闭两步验证</button><button class="button ghost" type="button" data-acc-act="totp-cancel">取消</button></div></form>';
    }
    return '<section class="acc-block" aria-labelledby="acc-security-title"><div class="acc-block-head"><span>' + icon('shield') + '</span><div><h2 id="acc-security-title">安全</h2><p>敏感操作需要重新验证。</p></div></div><div class="acc-row acc-setting-row"><span class="acc-row-icon">' + icon('shield') + '</span><div class="acc-row-copy"><b>两步验证</b><p>登录时再输入一组动态验证码。</p></div><div class="acc-row-actions">' + statusPill(enabled ? '已开启' : '未开启', enabled ? 'good' : '') + '<button class="button ' + (enabled ? 'ghost' : 'tonal') + '" type="button" data-acc-act="totp-' + (enabled ? 'disable' : 'setup') + '">' + (enabled ? '关闭' : '开始设置') + '</button></div></div>' + body + passwordPanel() + devicesPanel() + '</section>';
  }

  function passwordPanel() {
    var handle = accountMe().handle || '';
    return '<details class="acc-details"><summary class="acc-setting-row"><span class="acc-row-icon">' + icon('key') + '</span><div class="acc-row-copy"><b>修改密码</b><small>使用管理员签发的一次性重置码；成功后全部会话退出。</small></div><span>展开</span></summary><form data-acc-form="password" class="acc-inline-form"><div class="field"><label for="account-password-handle">Handle</label><input id="account-password-handle" name="handle" value="' + esc(handle) + '" autocomplete="username" pattern="[a-z0-9_]{3,32}" required></div><div class="field"><label for="account-reset-code">一次性重置码</label><input id="account-reset-code" name="resetCode" autocomplete="one-time-code" maxlength="64" required></div><div class="field"><label for="account-new-password">新密码</label><input id="account-new-password" name="newPassword" type="password" autocomplete="new-password" minlength="10" maxlength="128" required></div><button class="button primary" type="submit">更新密码</button></form></details>';
  }

  function sensitiveForm(label) {
    if (!state.sensitive) return '';
    var totp = totpEnabled();
    var field = totp
      ? '<div class="field"><label for="account-sensitive-code">动态验证码</label><input id="account-sensitive-code" name="totp_code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required></div>'
      : '<div class="field"><label for="account-sensitive-password">当前密码</label><input id="account-sensitive-password" name="password" type="password" autocomplete="current-password" maxlength="128" required></div>';
    return '<form data-acc-form="sensitive" class="acc-inline-form">' + field + '<div class="acc-inline-actions"><button class="button danger" type="submit">' + esc(label) + '</button><button class="button ghost" type="button" data-acc-act="sensitive-cancel">取消</button></div></form>';
  }

  function devicesPanel() {
    if (live()) {
      var liveRows = state.liveDevices;
      var others = liveRows.filter(function (row) { return !row.current; }).length;
      var confirmingOthers = state.sensitive && state.sensitive.kind === 'others';
      var confirmation = confirmingOthers ? sensitiveForm('确认退出') : '';
      var body = state.deviceState === 'error'
        ? '<div class="acc-empty"><span>' + icon('device') + '</span><p>设备没有读出来。</p><button class="button" type="button" data-acc-act="devices-retry">重试</button></div>'
        : '<div class="acc-device-list">' + liveRows.map(function (row) {
          var pending = state.sensitive && state.sensitive.kind === 'session' && state.sensitive.id === row.id;
          return '<article><span>' + icon('device') + '</span><div><b>' + esc(row.name) + '</b><small>' + esc(row.client || row.last_seen_at || '') + '</small></div>' + (row.current ? statusPill('当前', 'good') : '<button class="button ghost" type="button" data-acc-act="session-revoke" data-id="' + esc(row.id) + '">退出</button>') + (pending ? sensitiveForm('确认退出') : '') + '</article>';
        }).join('') + '</div>';
      return '<div class="acc-subsection"><div class="acc-subhead"><div><h3>登录设备</h3></div><button class="button" type="button" data-acc-act="signout-others-open"' + (others < 1 || state.deviceState !== 'ready' ? ' aria-disabled="true"' : '') + '>退出其他设备</button></div>' + confirmation + body + '</div>';
    }
    var rows = state.devices.filter(function (row) { return !state.prefs.signedOutOthers || row.current; });
    var demoConfirmation = state.signingOutOthers ? '<div class="acc-confirm" role="group" aria-label="确认退出其他设备"><div><b>确认退出其他设备？</b><p>除当前设备外，其他示例会话都会退出。</p></div><div><button class="button danger" type="button" data-acc-act="signout-others-confirm">确认退出</button><button class="button" type="button" data-acc-act="signout-others-cancel">取消</button></div></div>' : '';
    return '<div class="acc-subsection"><div class="acc-subhead"><div><h3>登录设备</h3><p>最近登录的设备</p></div><button class="button" type="button" data-acc-act="signout-others-open"' + (rows.length < 2 ? ' aria-disabled="true"' : '') + '>退出其他设备</button></div>' + demoConfirmation + '<div class="acc-device-list">' + rows.map(function (row) {
      return '<article><span>' + icon('device') + '</span><div><b>' + esc(row.name) + '</b><small>' + esc(row.place) + ' · ' + esc(row.seen) + '</small></div>' + (row.current ? statusPill('当前', 'good') : '') + '</article>';
    }).join('') + '</div></div>';
  }

  var LEGAL = [
    { id: 'age', title: '十八岁以上声明', href: 'legal/age-18.html' },
    { id: 'rules', title: '社区规则', href: 'legal/rules.html' },
    { id: 'terms', title: '用户协议', href: 'legal/terms.html' },
    { id: 'privacy', title: '隐私政策', href: 'legal/privacy.html' },
    { id: 'retention', title: '数据保留期限表', href: 'legal/retention.html' }
  ];

  function legalLinks() {
    return '<div class="acc-links" data-acc-legal><span class="acc-row-icon">' + icon('book') + '</span><div><b>规则与政策</b><small>初稿 · 版本待定 · 生效日期待填</small></div></div><div class="acc-links">' + LEGAL.map(function (item) {
      return live()
        ? '<a href="' + C().safeUrl(item.href) + '"><span>' + icon('arrow') + '</span><div><b>' + esc(item.title) + '</b><small>打开全文</small></div>' + icon('arrow') + '</a>'
        : '<button type="button" data-acc-act="legal" data-doc="' + esc(item.id) + '"><span>' + icon('arrow') + '</span><div><b>' + esc(item.title) + '</b><small>读摘要</small></div>' + icon('arrow') + '</button>';
    }).join('') + '</div>';
  }

  function openLegal(kind) {
    var item = LEGAL.filter(function (row) { return row.id === kind; })[0] || LEGAL[0];
    var bodies = {
      age: '<p>内测只对已满 18 周岁的人开放。注册勾选即作出声明。现在不做证件核验。</p>',
      rules: '<p>对事不对人。删除、封禁、扣分须治理员确认。房间不录音、不转写。</p>',
      terms: '<p>邀请码一次性。内容版权归你。Agent 发言视为你发言。贡献值不能换钱。</p>',
      privacy: '<p>行为计量单独同意。注销冷静期 7 天。群聊原文不上传。跨境单独同意尚未落地。</p>',
      retention: '<p>会话 14 天，导出包 24 小时，邀请码默认 7 天，备份 48 份小时和 14 份日。未定义项上线前定死。</p>'
    };
    if (typeof C().modal === 'function') C().modal(item.title + ' · 初稿', '<div class="acc-legal-full">' + (bodies[kind] || bodies.privacy) + '</div>');
  }

  /* 公开排名：开关 = 没有退出榜单（growth_state.opted_out 取反）。全站榜单是否公开由管理员的总开关决定，默认关。 */
  function rankPublic() { return state.rank.state === 'ready' && !state.rank.optedOut; }
  function rankNote() {
    var r = state.rank;
    if (r.state === 'idle' || r.state === 'loading') return '正在读取排名设置…';
    if (r.state === 'off') return '排名设置暂未开放。';
    if (r.busy) return '正在保存…';
    return r.publicOn ? (r.optedOut ? '你已退出公开榜，自己仍看得到。' : '你会出现在公开赛季榜上。') : (r.optedOut ? '你已退出；全站榜单现在也还没公开。' : '全站榜单现在还没公开；榜单公开后你会出现在上面，想不上榜可以现在就关掉。');
  }

  function loadRank(generation) {
    state.rank = { state: 'loading', optedOut: false, publicOn: false, busy: false };
    var opts = { signal: state.controller && state.controller.signal };
    Promise.all([api().get('/growth/me', null, opts), api().get('/growth/rules', null, opts).then(function (r) { return r; }, function () { return null; })]).then(function (rows) {
      if (generation !== state.generation || !state.root) return;
      state.rank = { state: 'ready', optedOut: !!(rows[0].data && rows[0].data.optedOut), publicOn: !!(rows[1] && rows[1].data && rows[1].data.publicRanking), busy: false };
      paint();
    }).catch(function (error) {
      if (generation !== state.generation || !state.root || (error && error.name === 'AbortError')) return;
      state.rank = { state: 'off', optedOut: false, publicOn: false, busy: false };
      paint();
    });
  }

  function postRank() {
    if (!live() || state.rank.state !== 'ready' || state.rank.busy) return;
    var generation = state.generation;
    var wantOut = rankPublic();
    state.rank.busy = true;
    state.status = '';
    paint('ranking');
    api().post('/growth/optout', { optout: wantOut }, writeOptions()).then(function (response) {
      if (generation !== state.generation || !state.root) return;
      state.rank.optedOut = !!(response && response.data && response.data.optedOut);
      state.rank.busy = false;
      state.status = state.rank.optedOut ? '已退出公开排名。' : '已加入公开排名。';
      paint('ranking');
    }).catch(function (error) {
      if (generation !== state.generation || !state.root) return;
      state.rank.busy = false;
      state.status = errorMessage(error, '排名设置没有改成。原设置没有变化。');
      toast(state.status);
      paint('ranking');
    });
  }

  function privacyPanel() {
    var visibility = live() ? (state.cardScope || 'members') : state.prefs.visibility;
    var scopeLocked = live() && (state.cardState !== 'ready' || state.visibilityBusy);
    return '<section class="acc-block" aria-labelledby="acc-privacy-title"><div class="acc-block-head"><span>' + icon('lock') + '</span><div><h2 id="acc-privacy-title">隐私</h2><p>不同意计量也能正常升级。</p></div></div><div class="acc-setting acc-setting-row"><span class="acc-row-icon">' + icon('data') + '</span><div class="acc-row-copy"><label id="acc-metering-label">行为计量同意</label><p>关掉后，升级只看收到的「有用」和被采纳。</p></div>' + switchButton('metering', !!state.prefs.metering, '行为计量同意', !!state.meteringBusy) + '</div><div class="acc-setting acc-setting-row"><span class="acc-row-icon">' + icon('shield') + '</span><div class="acc-row-copy"><label id="acc-ranking-label">公开排名</label><p>关闭后不上公开赛季榜，自己仍看得到。</p>' + (live() ? '<small data-acc-rank-note>' + esc(rankNote()) + '</small>' : '') + '</div>' + (live() ? switchButton('ranking', rankPublic(), '公开排名', state.rank.state !== 'ready' || state.rank.busy) : switchButton('ranking', !!state.prefs.ranking, '公开排名', false)) + '</div><div class="acc-setting acc-setting-row acc-visibility"><span class="acc-row-icon">' + icon('lock') + '</span><div class="acc-row-copy"><label for="account-visibility">谁能看到我的名片</label></div><select id="account-visibility" data-acc-change="visibility"' + (scopeLocked ? ' disabled' : '') + '>' + VISIBILITY.map(function (item) {
      return '<option value="' + esc(item[0]) + '"' + (item[0] === visibility ? ' selected' : '') + '>' + esc(item[1]) + '</option>';
    }).join('') + '</select></div>' + legalLinks() + '</section>';
  }

  function exportPanel() {
    var ex = state.exportState;
    var body = '';
    if (ex && ex.status === 'running') body = '<div class="acc-export-progress" role="status"><div><span style="--acc-progress:' + esc(ex.progress) + '"></span></div><p>正在整理资料、内容、贡献流水与审计记录… ' + esc(ex.progress) + '%</p></div>';
    if (ex && ex.status === 'ready') body = '<div class="acc-export-ready" role="status">' + icon('check') + '<div><b>导出文件已准备好</b><p>下载链接 24 小时内有效。</p></div><button class="button primary" type="button" data-acc-act="export-download">下载 JSON</button></div>';
    return '<section class="acc-block" aria-labelledby="acc-data-title"><div class="acc-block-head"><span>' + icon('data') + '</span><div><h2 id="acc-data-title">数据</h2><p>导出、注销和撤销都在页面内完成。</p></div></div><div class="acc-row acc-setting-row"><span class="acc-row-icon">' + icon('download') + '</span><div class="acc-row-copy"><b>导出我的数据</b><p>导出资料、内容和贡献记录。</p></div><button class="button tonal" type="button" data-acc-act="export"' + (ex && ex.status === 'running' ? ' aria-busy="true"' : '') + '><span class="button-spinner" aria-hidden="true"></span>' + icon('download') + ' ' + (ex && ex.status === 'running' ? '正在导出' : '开始导出') + '</button></div>' + body + deletePanel() + '</section>';
  }

  function deletePanel() {
    var pending = pendingDeletion();
    var purge = live() ? accountMe().purge_after : state.prefs.deleteState && state.prefs.deleteState.purgeAfter;
    if (pending) return '<div class="acc-danger-zone is-pending"><div><span>' + icon('trash') + '</span><div><b>账号处于 7 天冷静期</b><p>计划清理时间：' + esc(purge || '由服务端确认') + '。冷静期内可撤销。</p></div></div><button class="button tonal" type="button" data-acc-act="delete-cancel">撤销注销</button></div>';
    if (state.deleting) return '<div class="acc-danger-zone"><form data-acc-form="delete"><div><b>确认申请注销</b><p>输入当前密码。提交后进入 7 天冷静期，不会立即清除。</p></div><div class="field"><label for="account-delete-password">当前密码</label><input id="account-delete-password" name="password" type="password" autocomplete="current-password" maxlength="128" required></div><div class="acc-inline-actions"><button class="button danger" type="submit">进入冷静期</button><button class="button ghost" type="button" data-acc-act="delete-close">取消</button></div></form></div>';
    return '<div class="acc-danger-zone"><div><span>' + icon('trash') + '</span><div><b>注销账号</b><p>提交后有 7 天冷静期。期间可以撤销；到期后按隐私政策清理或匿名化。</p></div></div><button class="button danger" type="button" data-acc-act="delete-open">申请注销</button></div>';
  }

  function tokenTail(hint) {
    var text = String(hint || '');
    return text.length > 12 ? '…' + text.slice(-4) : text;
  }

  function agentsPanel() {
    var links = '<div class="acc-links"><a href="#/connect"><span>' + icon('key') + '</span><div><b>管理 Agent 与令牌</b></div>' + icon('arrow') + '</a><a href="#/notifications"><span>' + icon('bell') + '</span><div><b>通知偏好</b></div>' + icon('arrow') + '</a></div>';
    if (!live()) {
      return '<section class="acc-block" aria-labelledby="acc-agent-title"><div class="acc-block-head"><span>' + icon('agent') + '</span><div><h2 id="acc-agent-title">Agent 与通知</h2></div></div><div class="acc-agent-list">' + state.agents.map(function (row) {
        return '<article><span>' + icon('agent') + '</span><div><b>' + esc(row.name) + '</b><small>' + esc(row.scope) + ' · 最近使用 ' + esc(row.used) + '</small></div><code>' + esc(row.token) + '</code></article>';
      }).join('') + '</div>' + links + '</section>';
    }
    var rows = state.liveAgents.filter(function (row) { return row.active !== false; });
    var list = state.tokenState === 'error'
      ? '<div class="acc-empty"><span>' + icon('agent') + '</span><p>' + esc(state.tokenError || '令牌没有读出来。') + '</p><button class="button" type="button" data-acc-act="tokens-retry">重试</button></div>'
      : '<div class="acc-agent-list">' + rows.map(function (row) {
        var pending = state.sensitive && state.sensitive.kind === 'token' && state.sensitive.id === row.id;
        return '<article><span>' + icon('agent') + '</span><div><b>' + esc(row.name) + '</b><small>' + esc(row.scope || '') + '</small></div><code>' + esc(tokenTail(row.hint)) + '</code><button class="button ghost" type="button" data-acc-act="token-revoke" data-id="' + esc(row.id) + '">吊销</button>' + (pending ? sensitiveForm('确认吊销') : '') + '</article>';
      }).join('') + '</div>';
    return '<section class="acc-block" aria-labelledby="acc-agent-title"><div class="acc-block-head"><span>' + icon('agent') + '</span><div><h2 id="acc-agent-title">Agent 与通知</h2></div></div>' + list + links + '</section>';
  }

  function body() {
    if (state.status === 'loading') return top() + '<div class="acc-state" data-state="loading"><span class="acc-state-mark"></span><h2>正在读取账号</h2><p>只读取你的账号状态与安全设置。</p></div>';
    if (state.status === 'error') return top() + '<div class="acc-state" data-state="error"><span>' + icon('shield') + '</span><h2>账号没有读出来</h2><p>原数据没有变化。检查登录状态后再试。</p><button class="button primary" type="button" data-acc-act="retry">重新读取</button></div>';
    return top() + (state.status ? '<p class="acc-page-status" role="status" aria-live="polite">' + esc(state.status) + '</p>' : '<p class="acc-page-status" role="status" aria-live="polite"></p>') + '<div class="acc-grid"><div>' + totpPanel() + privacyPanel() + '</div><div>' + exportPanel() + agentsPanel() + '</div></div>';
  }

  function view() {
    state.prefs = loadPrefs();
    state.me = live() ? null : Object.assign({}, sample().me, { totp_enabled: state.prefs.totpEnabled, metering_consent: state.prefs.metering });
    state.devices = (sample().devices || []).slice();
    state.agents = (sample().agents || []).slice();
    state.status = live() ? 'loading' : '';
    return '<main class="account-page" data-account>' + body() + '</main>';
  }

  function paint(focusAct) {
    if (!state.root) return;
    state.root.innerHTML = body();
    if (focusAct) {
      var next = state.root.querySelector('[data-acc-act="' + focusAct + '"]');
      if (next) next.focus({ preventScroll: true });
    }
  }

  function say(message) {
    state.status = message || '';
    paint();
  }

  function loadMe() {
    if (!live()) return;
    state.status = 'loading';
    paint();
    if (state.controller) state.controller.abort();
    state.controller = window.AbortController ? new AbortController() : null;
    var generation = state.generation;
    api().get('/me', null, { signal: state.controller && state.controller.signal }).then(function (response) {
      if (generation !== state.generation || !state.root) return;
      state.me = response.data || {};
      if (!state.meteringBusy) state.prefs.metering = !!state.me.metering_consent;
      state.status = '';
      paint();
      loadAvatar(state.me, generation);
      loadRank(generation);
      loadSessions(generation);
      loadTokens(generation);
      loadVisibility(generation);
    }).catch(function (error) {
      if (generation !== state.generation || !state.root || (error && error.name === 'AbortError')) return;
      state.status = 'error';
      paint();
    });
  }

  function setBusy(button, busy) {
    if (!button) return;
    button.setAttribute('aria-busy', String(!!busy));
    button.disabled = !!busy;
  }

  function writeOptions() {
    return { idempotencyKey: api().newIdempotencyKey(), signal: state.controller && state.controller.signal };
  }

  function setupTotp(button) {
    if (!live()) {
      state.totp = { mode: 'setup', secret: 'JBSW Y3DP EHPK 3PXP', uri: 'otpauth://totp/AgentCommons:pioneer_demo?secret=EXAMPLE' };
      paint('totp-cancel');
      return;
    }
    setBusy(button, true);
    var generation = state.generation;
    api().post('/auth/totp/setup', {}, writeOptions()).then(function (response) {
      if (generation !== state.generation || !state.root) return;
      state.totp = { mode: 'setup', secret: response.data.secret, uri: response.data.otpauth_uri };
      state.status = '';
      paint('totp-cancel');
    }).catch(function (error) {
      if (generation !== state.generation || !state.root) return;
      state.status = errorMessage(error, '两步验证没有开始。');
      paint('totp-setup');
    });
  }

  function applyConsent(value) {
    state.prefs.metering = !!value;
    if (state.me) state.me.metering_consent = !!value;
  }

  function emitConsent(value) {
    window.dispatchEvent(new CustomEvent('commons:consent-metering', { detail: { consent: !!value } }));
  }

  function onConsentMetering(event) {
    if (!state.prefs || state.meteringBusy) return;
    var value = !!(event && event.detail && event.detail.consent);
    if (state.prefs.metering === value) return;
    applyConsent(value);
    if (state.root) paint();
  }

  window.addEventListener('commons:consent-metering', onConsentMetering);

  function postConsent(next) {
    if (!live() || state.meteringBusy) return;
    var prev = !!state.prefs.metering;
    applyConsent(next);
    state.meteringBusy = true;
    state.status = '';
    paint('metering');
    var generation = state.generation;
    api().post('/growth/consent', { consent: !!next }, writeOptions()).then(function (response) {
      if (generation !== state.generation || !state.root) return;
      var data = response && response.data;
      var value = data && Object.prototype.hasOwnProperty.call(data, 'consentMetering') ? !!data.consentMetering : !!next;
      applyConsent(value);
      state.meteringBusy = false;
      state.status = value ? '已同意行为计量。' : '已改走「收到的有用 + 被采纳」升级路径。';
      paint('metering');
      emitConsent(value);
    }).catch(function (error) {
      if (generation !== state.generation || !state.root) return;
      applyConsent(prev);
      state.meteringBusy = false;
      state.status = errorMessage(error, '行为计量没有改成。原设置没有变化。');
      toast(state.status);
      paint('metering');
    });
  }

  function togglePreference(key) {
    if (live()) {
      if (key === 'ranking') {
        postRank();
        return;
      }
      if (key === 'metering') {
        postConsent(!state.prefs.metering);
        return;
      }
    }
    state.prefs[key] = !state.prefs[key];
    savePrefs();
    state.status = key === 'metering' && !state.prefs[key] ? '已改走「收到的有用 + 被采纳」升级路径。示例 · 仅存本机' : '偏好已保存。示例 · 仅存本机';
    paint(key);
  }

  function revokeExport() {
    if (state.exportUrl) URL.revokeObjectURL(state.exportUrl);
    state.exportUrl = '';
  }

  function exportDone(payload) {
    revokeExport();
    state.exportUrl = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    var expires = new Date(Date.now() + 24 * 60 * 60 * 1000);
    state.exportState = { status: 'ready', progress: 100, expires: expires.toLocaleString('zh-CN', { hour12: false }) };
    state.status = '';
    paint();
  }

  function startDemoExport() {
    state.exportState = { status: 'running', progress: 12 };
    paint();
    [36, 68, 100].forEach(function (progress, index) {
      var timer = window.setTimeout(function () {
        if (!state.root || !state.exportState) return;
        if (progress < 100) { state.exportState.progress = progress; paint(); return; }
        exportDone({ type: 'commons-account-demo-export', sample: true, exportedAt: new Date().toISOString(), account: accountMe(), preferences: state.prefs, agents: state.agents });
      }, (index + 1) * 180);
      state.timers.push(timer);
    });
  }

  function startExport(button) {
    if (state.exportState && state.exportState.status === 'running') return;
    if (!live()) { startDemoExport(); return; }
    state.exportState = { status: 'running', progress: 24 };
    setBusy(button, true);
    paint();
    var generation = state.generation;
    api().get('/me/export', null, { signal: state.controller && state.controller.signal }).then(function (response) {
      if (generation !== state.generation || !state.root) return;
      exportDone(response.data);
    }).catch(function (error) {
      if (generation !== state.generation || !state.root) return;
      state.exportState = null;
      state.status = errorMessage(error, '导出没有完成。');
      paint('export');
    });
  }

  function onClick(event) {
    var button = event.target.closest('[data-acc-act]');
    if (!button || !state.root || !state.root.contains(button)) return;
    var act = button.dataset.accAct;
    if (button.getAttribute('aria-disabled') === 'true') {
      if (act === 'ranking' && live()) {
        if (state.rank.state === 'off') { state.status = '排名设置暂未开放。'; paint(act); }
        return;
      }
      if (act === 'metering') return;
      if (act === 'signout-others-open') { state.status = '没有其他设备需要退出。'; paint(act); return; }
      state.status = live() ? '这项操作暂未开放，服务器状态没有变化。' : '没有其他设备需要退出。';
      paint(act);
      return;
    }
    if (act === 'legal') { openLegal(button.dataset.doc); return; }
    if (act === 'signout') {
      var session = window.CommonsSession;
      if (session && typeof session.signOut === 'function') {
        Promise.resolve(session.signOut()).catch(function (error) {
          state.status = errorMessage(error, '退出没有完成。');
          paint('signout');
        });
        return;
      }
      state.status = live() ? '退出组件还没加载。' : '演示版不连接账号。';
      paint('signout');
      return;
    }
    if (act === 'retry') loadMe();
    else if (act === 'totp-setup') setupTotp(button);
    else if (act === 'totp-disable') { state.totp = { mode: 'disable' }; paint('totp-cancel'); }
    else if (act === 'totp-cancel') { state.totp = null; paint(totpEnabled() ? 'totp-disable' : 'totp-setup'); }
    else if (act === 'metering' || act === 'ranking') togglePreference(act);
    else if (act === 'avatar-clear') clearAvatar();
    else if (act === 'avatar-retry') { if (state.avatar.retry) state.avatar.retry(); }
    else if (act === 'signout-others-open') {
      if (live()) { state.sensitive = { kind: 'others' }; paint('account-sensitive-code'); }
      else { state.signingOutOthers = true; paint('signout-others-confirm'); }
    }
    else if (act === 'signout-others-cancel') { state.signingOutOthers = false; paint('signout-others-open'); }
    else if (act === 'signout-others-confirm') { state.prefs.signedOutOthers = true; state.signingOutOthers = false; savePrefs(); state.status = '其他示例设备已退出。示例 · 仅存本机'; paint('signout-others-open'); }
    else if (act === 'session-revoke') { state.sensitive = { kind: 'session', id: button.dataset.id }; paint('account-sensitive-code'); }
    else if (act === 'token-revoke') { state.sensitive = { kind: 'token', id: button.dataset.id }; paint('account-sensitive-code'); }
    else if (act === 'sensitive-cancel') { state.sensitive = null; paint('signout-others-open'); }
    else if (act === 'devices-retry') loadSessions(state.generation);
    else if (act === 'tokens-retry') loadTokens(state.generation);
    else if (act === 'export') startExport(button);
    else if (act === 'export-download') {
      if (!state.exportUrl) { state.status = '下载链接已失效，请重新导出。'; paint('export'); return; }
      var download = document.createElement('a');
      download.href = state.exportUrl;
      download.download = 'commons-my-data.json';
      download.click();
    }
    else if (act === 'delete-open') { state.deleting = true; paint('delete-close'); }
    else if (act === 'delete-close') { state.deleting = false; paint('delete-open'); }
    else if (act === 'delete-cancel') cancelDelete(button);
  }

  function submitTotpEnable(form) {
    var code = String(new FormData(form).get('code') || '');
    if (!live()) {
      if (!/^[0-9]{6}$/.test(code)) { state.status = '请输入 6 位动态验证码。'; paint(); return; }
      state.prefs.totpEnabled = true; savePrefs(); state.totp = null; state.status = '两步验证已开启。示例 · 仅存本机'; paint('totp-disable'); return;
    }
    var generation = state.generation;
    api().post('/auth/totp/enable', { code: code }, writeOptions()).then(function (response) {
      if (generation !== state.generation || !state.root) return;
      state.me.totp_enabled = !!response.data.totp_enabled; state.totp = null; state.status = '两步验证已开启。'; paint('totp-disable');
    }).catch(function (error) { if (generation === state.generation && state.root) { state.status = errorMessage(error); paint(); } });
  }

  function submitTotpDisable(form) {
    var data = new FormData(form);
    var payload = { code: String(data.get('code') || ''), password: String(data.get('password') || '') };
    if (!live()) { state.prefs.totpEnabled = false; savePrefs(); state.totp = null; state.status = '两步验证已关闭。示例 · 仅存本机'; paint('totp-setup'); return; }
    var generation = state.generation;
    api().post('/auth/totp/disable', payload, writeOptions()).then(function (response) {
      if (generation !== state.generation || !state.root) return;
      state.me.totp_enabled = !!response.data.totp_enabled; state.totp = null; state.status = '两步验证已关闭。'; paint('totp-setup');
    }).catch(function (error) { if (generation === state.generation && state.root) { state.status = errorMessage(error); paint(); } });
  }

  function submitPassword(form) {
    var data = new FormData(form);
    var payload = { handle: String(data.get('handle') || '').trim().toLowerCase(), reset_code: String(data.get('resetCode') || ''), new_password: String(data.get('newPassword') || '') };
    if (!live()) { form.reset(); state.status = '密码修改流程已演示；没有保存密码。示例'; paint(); return; }
    var generation = state.generation;
    api().post('/auth/reset', payload, writeOptions()).then(function () {
      if (generation !== state.generation || !state.root) return;
      state.status = '密码已更新，全部会话已退出。请重新登录。'; paint();
    }).catch(function (error) { if (generation === state.generation && state.root) { state.status = errorMessage(error); paint(); } });
  }

  function submitDelete(form) {
    var password = String(new FormData(form).get('password') || '');
    if (!live()) {
      var date = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      state.prefs.deleteState = { purgeAfter: date.toLocaleString('zh-CN', { hour12: false }) };
      state.deleting = false; savePrefs(); state.status = '已进入 7 天注销冷静期。示例 · 仅存本机'; paint('delete-cancel'); return;
    }
    var generation = state.generation;
    api().post('/me/delete', { password: password }, writeOptions()).then(function (response) {
      if (generation !== state.generation || !state.root) return;
      state.me.status = response.data.status; state.me.purge_after = response.data.purge_after; state.deleting = false; state.status = '注销申请已提交，账号进入 7 天冷静期。'; paint('delete-cancel');
    }).catch(function (error) { if (generation === state.generation && state.root) { state.status = errorMessage(error); paint(); } });
  }

  function cancelDelete() {
    if (!live()) { state.prefs.deleteState = null; savePrefs(); state.status = '注销已撤销。示例 · 仅存本机'; paint('delete-open'); return; }
    var generation = state.generation;
    api().post('/me/delete/cancel', {}, writeOptions()).then(function (response) {
      if (generation !== state.generation || !state.root) return;
      state.me.status = response.data.status; delete state.me.purge_after; state.status = '注销已撤销，账号恢复正常。'; paint('delete-open');
    }).catch(function (error) { if (generation === state.generation && state.root) { state.status = errorMessage(error); paint(); } });
  }

  function onSubmit(event) {
    var form = event.target.closest('[data-acc-form]');
    if (!form || !state.root || !state.root.contains(form)) return;
    event.preventDefault();
    if (!form.reportValidity()) return;
    if (form.dataset.accForm === 'totp-enable') submitTotpEnable(form);
    else if (form.dataset.accForm === 'totp-disable') submitTotpDisable(form);
    else if (form.dataset.accForm === 'password') submitPassword(form);
    else if (form.dataset.accForm === 'delete') submitDelete(form);
    else if (form.dataset.accForm === 'sensitive') submitSensitive(form);
  }

  function writeKey(signature) {
    if (state.writeSig !== signature) {
      state.writeSig = signature;
      state.writeKey = api().newIdempotencyKey();
    }
    return state.writeKey;
  }

  function loadSessions(generation) {
    if (!live()) return;
    state.deviceState = 'loading';
    api().get('/account/sessions', null, { signal: state.controller && state.controller.signal }).then(function (response) {
      if (generation !== state.generation || !state.root) return;
      state.liveDevices = (response.data && response.data.items) || [];
      state.deviceState = 'ready';
      paint();
    }).catch(function (error) {
      if (generation !== state.generation || !state.root || (error && error.name === 'AbortError')) return;
      state.liveDevices = [];
      state.deviceState = 'error';
      state.status = errorMessage(error, '设备没有读出来。');
      paint();
    });
  }

  function loadTokens(generation) {
    if (!live()) return;
    state.tokenState = 'loading';
    api().get('/agents/mine', null, { signal: state.controller && state.controller.signal }).then(function (response) {
      if (generation !== state.generation || !state.root) return;
      var agents = (response.data && response.data.agents) || [];
      state.liveAgents = [];
      agents.forEach(function (agent) {
        (agent.tokens || []).forEach(function (token) {
          state.liveAgents.push({ id: token.id, name: agent.name, scope: (token.scopes || []).join(' · '), hint: token.hint, active: token.active !== false && !token.revoked_at, used: token.last_used_at || '' });
        });
      });
      state.tokenState = 'ready';
      state.tokenError = '';
      paint();
    }).catch(function (error) {
      if (generation !== state.generation || !state.root || (error && error.name === 'AbortError')) return;
      state.liveAgents = [];
      state.tokenState = 'error';
      state.tokenError = errorMessage(error, '令牌没有读出来。');
      paint();
    });
  }

  function loadVisibility(generation) {
    if (!live()) return;
    state.cardState = 'loading';
    api().get('/account/visibility', null, { signal: state.controller && state.controller.signal }).then(function (response) {
      if (generation !== state.generation || !state.root) return;
      state.cardScope = (response.data && response.data.scope) || 'members';
      state.cardState = 'ready';
      paint();
    }).catch(function (error) {
      if (generation !== state.generation || !state.root || (error && error.name === 'AbortError')) return;
      state.cardState = 'off';
      state.status = errorMessage(error, '名片范围没有读出来。');
      paint();
    });
  }

  function submitSensitive(form) {
    var data = new FormData(form);
    var pending = state.sensitive;
    if (!pending || !live()) return;
    var payload = { totp_code: String(data.get('totp_code') || '') || null, password: String(data.get('password') || '') || null };
    var path = pending.kind === 'token' ? '/account/tokens/' + encodeURIComponent(pending.id) + '/revoke'
      : pending.kind === 'session' ? '/account/sessions/' + encodeURIComponent(pending.id) + '/revoke'
      : '/account/sessions/others/revoke';
    var generation = state.generation;
    var key = writeKey(path + ':' + JSON.stringify(payload));
    api().post(path, payload, { idempotencyKey: key, signal: state.controller && state.controller.signal }).then(function () {
      if (generation !== state.generation || !state.root) return;
      state.writeSig = '';
      state.sensitive = null;
      state.status = pending.kind === 'token' ? '令牌已吊销。' : '设备已退出。';
      paint();
      if (pending.kind === 'token') loadTokens(generation);
      else loadSessions(generation);
    }).catch(function (error) {
      if (generation !== state.generation || !state.root) return;
      state.status = errorMessage(error, '没有退出。原登录还在。');
      paint();
    });
  }

  function onChange(event) {
    var file = event.target.closest && event.target.closest('[data-acc-avatar-file]');
    if (file && state.root && state.root.contains(file)) {
      var picked = file.files && file.files[0];
      file.value = '';
      if (picked) startAvatar(picked);
      return;
    }
    var select = event.target.closest('[data-acc-change="visibility"]');
    if (!select || !state.root || !state.root.contains(select)) return;
    if (live()) {
      if (state.cardState !== 'ready' || state.visibilityBusy) return;
      var previous = state.cardScope;
      var next = select.value;
      if (VISIBILITY.every(function (item) { return item[0] !== next; })) return;
      state.cardScope = next;
      state.visibilityBusy = true;
      state.status = '';
      paint();
      var generation = state.generation;
      api().put('/account/visibility', { scope: next }, writeOptions()).then(function (response) {
        if (generation !== state.generation || !state.root) return;
        state.cardScope = (response.data && response.data.scope) || next;
        state.visibilityBusy = false;
        state.status = '名片范围已保存。';
        paint();
      }).catch(function (error) {
        if (generation !== state.generation || !state.root) return;
        state.cardScope = previous;
        state.visibilityBusy = false;
        state.status = errorMessage(error, '名片范围没有改成。原设置没有变化。');
        paint();
      });
      return;
    }
    state.prefs.visibility = select.value; savePrefs(); state.status = '名片范围已保存。示例 · 仅存本机'; paint();
  }

  function on(target, type, handler) {
    target.addEventListener(type, handler);
    state.unbind.push(function () { target.removeEventListener(type, handler); });
  }

  function mount() {
    var root = document.querySelector('[data-account]');
    if (!root) return;
    destroy();
    state.root = root;
    state.prefs = loadPrefs();
    state.devices = (sample().devices || []).slice();
    state.agents = (sample().agents || []).slice();
    if (!live()) state.me = Object.assign({}, sample().me, { totp_enabled: state.prefs.totpEnabled, metering_consent: state.prefs.metering });
    on(document, 'click', onClick);
    on(document, 'submit', onSubmit);
    on(document, 'change', onChange);
    if (live()) loadMe();
  }

  function destroy() {
    state.generation += 1;
    state.unbind.forEach(function (unbind) { unbind(); });
    state.unbind = [];
    state.timers.forEach(function (timer) { window.clearTimeout(timer); });
    state.timers = [];
    if (state.controller) state.controller.abort();
    state.controller = null;
    revokeExport();
    state.root = null;
    state.totp = null;
    state.deleting = false;
    state.signingOutOthers = false;
    state.meteringBusy = false;
    state.avatar = { url: '', busy: false, ratio: 0, error: '', retry: null };
    state.rank = { state: 'idle', optedOut: false, publicOn: false, busy: false };
    state.liveDevices = [];
    state.deviceState = 'idle';
    state.liveAgents = [];
    state.tokenState = 'idle';
    state.tokenError = '';
    state.cardScope = null;
    state.cardState = 'idle';
    state.visibilityBusy = false;
    state.sensitive = null;
    state.writeSig = '';
    state.writeKey = '';
  }

  window.CommonsAccount = {
    routes: { account: view },
    hub: ['account'],
    nav: [['account', '账号与隐私', 'shield', 'personal']],
    mount: mount,
    destroy: destroy
  };
  (window.CommonsPages = window.CommonsPages || []).push(window.CommonsAccount);
})();
