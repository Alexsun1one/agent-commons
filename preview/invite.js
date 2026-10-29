/* R13 INVITE-2 · 邀请好友移动端收紧。示例走 Commons.read/write；live 才请求 /api/invite。 */
(function () {
  'use strict';

  var STORE = 'invite.demo.v2';
  var SENTENCE = '来先锋，一起把方法写成能用的东西。';
  var STATUS = {
    pending: '待接受',
    registered: '已注册',
    onboarded: '完成新人引导',
    contributed: '第一次贡献',
    expired: '已过期',
    revoked: '已作废'
  };
  var state = { root: null, bound: false, data: null, message: '', code: '', link: '', sentence: SENTENCE, abort: null };

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
    });
  }

  function live() {
    return !!(window.CommonsAPI && window.CommonsAPI.mode === 'live');
  }

  function sample() {
    return window.COMMONS_INVITE_SAMPLE || {
      quota: { remaining: 0, used: 0, total: 0, penalty: false },
      sent: 0, accepted: 0, invites: [], people: [],
      me: { name: '我', level: 1 }, rewards: { onboarding: 20, first: 50 }
    };
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function readStore() {
    if (!window.Commons || typeof window.Commons.read !== 'function') return null;
    var value = window.Commons.read(STORE, null);
    return value && typeof value === 'object' && value.quota ? value : null;
  }

  function writeStore(data) {
    if (window.Commons && typeof window.Commons.write === 'function') window.Commons.write(STORE, data);
  }

  /* safe-fn: CommonsLinks.person 自行转义；退路对名字 esc、handle encodeURIComponent */
  function personLink(handle, name) {
    var cleanHandle = String(handle || '').replace(/^@+/, '').trim();
    if (!cleanHandle) return esc(name);
    if (window.CommonsLinks && typeof window.CommonsLinks.person === 'function') {
      return window.CommonsLinks.person(cleanHandle, name);
    }
    return '<a class="lk-person" href="#/u/' + encodeURIComponent(cleanHandle) + '">' + esc(name) + '</a>';
  }

  /* safe-fn: CommonsAvatar.html 自行逐值转义；退路只输出 esc 后的首字 */
  function avatar(item, name) {
    if (window.CommonsAvatar && typeof window.CommonsAvatar.html === 'function') {
      return '<span class="inv-avatar">' + /* safe: CommonsAvatar.html 已逐值转义 */ window.CommonsAvatar.html({
        id: item.handle || item.id || name,
        name: name,
        size: 32,
        level: Number(item.level) || 0,
        src: item.avatar || ''
      }) + '</span>';
    }
    return '<span class="inv-avatar-fallback" aria-hidden="true">' + esc(String(name || '?').charAt(0)) + '</span>';
  }

  function statusTone(status) {
    if (status === 'onboarded' || status === 'contributed') return ' is-done';
    if (status === 'expired' || status === 'revoked') return ' is-off';
    return ' is-live';
  }

  /* safe-fn: 列表项里的名字、附言和状态都经过 esc；子函数返回已转义 HTML */
  function inviteItem(item) {
    var who = item.name || '等待好友';
    var note = item.note ? '<small>· ' + esc(item.note) + '</small>' : '';
    return '<li><div class="inv-person">' + avatar(item, who) + '<div class="inv-person-copy"><span>' +
      personLink(item.handle, who) + '</span>' + note + '</div></div><span class="inv-status' + statusTone(item.status) + '">' +
      esc(STATUS[item.status] || '待接受') + '</span></li>';
  }

  /* safe-fn: 分享句和链接经过 esc；CommonsQR.svg 返回已转义的固定 SVG 结构 */
  function shareCard() {
    var hasLink = !!(state.link && state.code);
    var qr = hasLink && window.CommonsQR && typeof window.CommonsQR.svg === 'function'
      ? window.CommonsQR.svg(state.link, { label: '邀请链接二维码' }) : '';
    var code = qr
      ? '<div class="inv-qr">' + /* safe: CommonsQR.svg 只返回固定 SVG */ qr + '</div>' + issuedLink()
      : '<p class="inv-qr-note">生成后这里会出现二维码</p>';
    return '<aside class="inv-card"><img src="assets/mascot/panda-avatar-brand-blue-512.webp" alt="熊猫">' +
      '<p>' + esc(state.sentence || SENTENCE) + '</p>' + code +
      (hasLink ? '<div class="inv-actions"><button class="button ghost" type="button" data-inv-action="share">生成分享卡</button></div>' : '') + '</aside>';
  }

  /* safe-fn: 空状态文案是写死的 */
  function formBlock(empty) {
    return '<form class="inv-form" data-inv-form>' +
      (empty ? '<p>这个月还没有发出邀请。</p>' : '') +
      '<label class="field">附言<input name="note" maxlength="60" autocomplete="off"></label>' +
      '<button class="button primary large" type="submit">生成邀请链接</button></form>';
  }

  /* safe-fn: 链接码和展示文案都经过 esc */
  function issuedLink() {
    if (!state.link || !state.code) return '';
    return '<div class="inv-link-row"><a class="inv-link" href="#/hello?invite=' + esc(state.code) + '">' + esc(state.link) + '</a>' +
      '<button class="button" type="button" data-inv-action="copy">复制</button></div>';
  }

  /* safe-fn: 子项函数只返回已转义片段 */
  function lists(data) {
    if (!data.invites || !data.invites.length) return '';
    return '<section class="inv-block"><h2>已发出</h2><ul class="inv-list">' + data.invites.map(inviteItem).join('') +
      '</ul></section>';
  }

  /* safe-fn: 奖励数字经过 esc，其余文案写死 */
  function rewardRules(data) {
    return '<details class="inv-rules"><summary><i aria-hidden="true">?</i><span>邀请完成后会有竹子奖励</span></summary>' +
      '<p>完成引导 +' + esc(data.rewards && data.rewards.onboarding) + ' 竹，第一次贡献再 +' +
      esc(data.rewards && data.rewards.first) + '。</p></details>';
  }

  /* safe-fn: 数字和提示都经过 esc，子块来自 safe-fn */
  function inner(data) {
    var quota = data.quota || {};
    var empty = !data.invites || !data.invites.length;
    return '<div class="inv-head"><span>把对的人带进先锋</span>' +
      (live() ? '' : '<span class="inv-badge">示例</span>') + '</div>' +
      '<section class="inv-stats"><div class="inv-stat"><b>' + esc(quota.remaining) + '</b><span>剩余额度</span></div>' +
      '<div class="inv-stat"><b>' + esc(data.sent) + '</b><span>已发出</span></div>' +
      '<div class="inv-stat"><b>' + esc(data.accepted) + '</b><span>已接受</span></div></section>' +
      (quota.penalty ? '<p class="inv-note">这个月额度已减半。</p>' : '') +
      (state.message ? '<p class="inv-warn">' + esc(state.message) + '</p>' : '') +
      '<div class="inv-layout"><div class="inv-block">' + formBlock(empty) + '</div>' + shareCard() + '</div>' +
      rewardRules(data) + lists(data);
  }

  function errorBlock(err) {
    var status = err && err.status;
    if (status === 401 || status === 403) {
      return '<section class="inv-empty"><p>登录后才能邀请好友。</p><a class="button primary" href="#/hello">去登录</a></section>';
    }
    if (status === 501) {
      return '<section class="inv-empty"><p>邀请还没有开放。</p><a class="button ghost" href="#/home">返回首页</a></section>';
    }
    return '<section class="inv-empty"><p>邀请没有载入。</p><button class="button" type="button" data-inv-action="retry">重试</button></section>';
  }

  function paint(data) {
    if (!state.root || !data) return;
    state.data = data;
    state.root.innerHTML = inner(data);
  }

  function show(message) {
    state.message = message || '';
    if (state.data) paint(state.data);
  }

  function load() {
    if (state.abort) state.abort.abort();
    state.abort = typeof AbortController === 'function' ? new AbortController() : null;
    window.CommonsAPI.get('/invite/me', null, { signal: state.abort && state.abort.signal }).then(function (res) {
      if (!state.root) return;
      state.message = '';
      paint(res.data);
    }, function (err) {
      if (!state.root || (err && err.name === 'AbortError')) return;
      state.root.innerHTML = errorBlock(err);
    });
  }

  function issue() {
    var input = state.root && state.root.querySelector('[name=note]');
    var note = input ? String(input.value || '').trim() : '';
    if (note.length > 60) { show('这句话最多 60 个字'); return; }
    if (live()) {
      window.CommonsAPI.post('/invite/codes', { note: note }, {
        idempotencyKey: window.CommonsAPI.newIdempotencyKey(),
        signal: state.abort && state.abort.signal
      }).then(function (res) {
        state.code = res.data.code;
        state.link = res.data.url;
        state.sentence = note || SENTENCE;
        state.message = '';
        return window.CommonsAPI.get('/invite/me');
      }).then(function (res) {
        if (res) paint(res.data);
      }, function (err) {
        if (err && err.name === 'AbortError') return;
        show((err && err.message) || '没有生成邀请');
      });
      return;
    }
    var data = state.data || clone(sample());
    if (!data.quota || Number(data.quota.remaining) < 1) { show('这个月没有邀请额度'); return; }
    data.quota.remaining -= 1;
    data.quota.used = Number(data.quota.used || 0) + 1;
    data.sent = Number(data.sent || 0) + 1;
    var code = 'DEMO-' + String((data.invites || []).length + 1).padStart(4, '0') + '-0000-0001';
    data.invites = [{ id: code, status: 'pending', name: null, level: null, note: note }].concat(data.invites || []);
    state.code = code;
    state.link = (/^https?:$/.test(location.protocol) ? location.origin + location.pathname : '') + '#/hello?invite=' + code;
    state.sentence = note || SENTENCE;
    state.message = '';
    state.data = data;
    writeStore(data);
    paint(data);
  }

  function share() {
    var sentence = state.sentence || SENTENCE;
    var me = state.data && state.data.me;
    if (window.CommonsShare && typeof window.CommonsShare.open === 'function') {
      window.CommonsShare.open({
        title: sentence,
        summary: '',
        visibility: { scope: 'public' },
        format: 'portrait',
        author: me ? { name: me.name, level: me.level } : null
      });
    }
  }

  function copied(message) {
    if (window.Commons && typeof window.Commons.toast === 'function') window.Commons.toast(message);
  }

  function copyLink() {
    if (!state.link) return;
    var fallback = function () {
      var area = document.createElement('textarea');
      area.value = state.link;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      var ok = false;
      try { ok = !!(document.execCommand && document.execCommand('copy')); } catch (err) { ok = false; }
      area.remove();
      copied(ok ? '邀请链接已复制' : '浏览器不让复制，请长按链接复制');
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(state.link).then(function () { copied('邀请链接已复制'); }, fallback);
    } else fallback();
  }

  function onClick(event) {
    var button = event.target.closest('[data-inv-action]');
    if (!button || !state.root || !state.root.contains(button)) return;
    if (button.dataset.invAction === 'share') share();
    else if (button.dataset.invAction === 'copy') copyLink();
    else if (button.dataset.invAction === 'retry') load();
    else if (button.dataset.invAction === 'issue') issue();
  }

  function onSubmit(event) {
    var form = event.target && event.target.closest ? event.target.closest('[data-inv-form]') : null;
    if (!form || !state.root || !state.root.contains(form)) return;
    event.preventDefault();
    issue();
  }

  function page() {
    if (live()) return '<main class="inv-page" data-invite-root><p class="inv-note">正在读取邀请。</p></main>';
    state.data = readStore() || clone(sample());
    state.sentence = SENTENCE;
    return '<main class="inv-page" data-invite-root>' + inner(state.data) + '</main>';
  }

  function mount() {
    var root = document.querySelector('[data-invite-root]');
    if (!root) return;
    if (state.bound) destroy();
    state.root = root;
    root.addEventListener('click', onClick);
    root.addEventListener('submit', onSubmit);
    state.bound = true;
    if (live()) load();
  }

  function destroy() {
    if (state.abort) {
      state.abort.abort();
      state.abort = null;
    }
    if (state.root) {
      state.root.removeEventListener('click', onClick);
      state.root.removeEventListener('submit', onSubmit);
    }
    if (window.CommonsShare && typeof window.CommonsShare.close === 'function') window.CommonsShare.close();
    state.root = null;
    state.bound = false;
  }

  window.CommonsInvite = {
    routes: { invite: page },
    hub: ['invite'],
    nav: [['invite', '邀请好友', 'people', 'personal']],
    mount: mount,
    destroy: destroy
  };
  (window.CommonsPages = window.CommonsPages || []).push(window.CommonsInvite);
})();
