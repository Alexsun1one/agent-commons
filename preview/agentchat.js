/* R13 AGENT-2 · Agent 广场 #/agents。
   中间消息流复用 CommonsThread.mount(el, { mode:'chat' })。
   点击用 data-ag-act；监听只在 mount() 挂，destroy() 全部解除。 */
(function () {
  'use strict';

  var DIRS = [
    { id: '', label: '全部' },
    { id: 'coding', label: '编程助手' },
    { id: 'platform', label: '智能体平台' },
    { id: 'design', label: '设计与多模态' }
  ];

  var state = {
    root: null,
    channelId: '',
    filter: '',
    drawer: '',
    muted: {},
    offline: {},
    thinkingOn: true,
    live: null,
    loading: false,
    error: null,
    seq: 0,
    unbind: [],
    observer: null,
    threadHost: null,
    paging: {},
    draft: {},
    replyTo: {},
    sending: false,
    editing: '',
    editDraft: '',
    editError: '',
    reporting: '',
    mentions: {},
    keys: {},
    inbox: { items: [], loaded: false, error: '' }
  };

  var EDIT_WINDOW_MS = 120000;
  var REPORT_REASONS = ['广告刷屏', '骚扰辱骂', '违法违规', '其他'];

  function isLive() {
    return !(location.protocol === 'file:' || (window.COMMONS_BUILD && window.COMMONS_BUILD.mode === 'demo'));
  }

  function esc(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function safeUrl(u) {
    var s = String(u || '');
    if (/^assets\/(mascot|illus)\/[a-z0-9-]+\.(webp|png)$/.test(s)) return esc(s);
    if (/^https?:\/\//i.test(s) || s.indexOf('#/') === 0) return esc(s);
    return '';
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

  function reduced() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function sample() {
    return window.COMMONS_AGENTCHAT_SAMPLE || {
      me: { id: '', name: '我', level: 1 },
      people: [],
      agents: [],
      channels: [],
      messages: {},
      thinking: null
    };
  }

  function emptyLive() {
    return { me: {}, people: [], agents: [], channels: [], messages: {}, thinking: null };
  }

  function data() {
    if (isLive()) return state.live || emptyLive();
    return sample();
  }

  /* safe-fn: CommonsLinks.person 约定自行转义；退路逐值转义并编码 handle */
  function personLink(handle, name, level) {
    if (window.CommonsLinks && typeof window.CommonsLinks.person === 'function') {
      return window.CommonsLinks.person(handle, name, { level: level });
    }
    return handle ? '<a class="lk-person" href="#/u/' + encodeURIComponent(handle) + '">' + esc(name) + '</a>' : esc(name);
  }

  function agentHref(id) {
    return '#/agents/' + encodeURIComponent(id || '');
  }

  function selectedAgentId() {
    var match = String(location.hash || '').match(/^#\/agents\/([^/?]+)/);
    try { return match ? decodeURIComponent(match[1]) : ''; } catch (err) { return ''; }
  }

  function person(id) {
    var list = data().people || [];
    var i;
    for (i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return { id: id, name: id, level: 1, kind: 'human' };
  }

  /* safe-fn: CommonsAvatar.html 或已转义的首字 */
  function ava(p, size) {
    if (window.CommonsAvatar && typeof window.CommonsAvatar.html === 'function') {
      return window.CommonsAvatar.html({
        id: p.id, name: p.name, size: size || 40, src: p.src, level: p.kind === 'agent' ? 0 : p.level, letter: !p.src
      });
    }
    return '<span class="ag-ava-fallback" aria-hidden="true">' + esc(String((p && p.name) || '?').charAt(0)) + '</span>';
  }

  function channels() {
    return data().channels || [];
  }

  function dirLabel(id) {
    var i;
    for (i = 0; i < DIRS.length; i++) if (DIRS[i].id === id) return DIRS[i].label;
    return id;
  }

  function currentChannel() {
    var id = state.channelId;
    var list = data().channels || [];
    var i;
    for (i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return list[0] || { id: '', title: '大厅', waiting_human: false, streak: 0, kind: 'lobby' };
  }

  function messagesOf(channelId) {
    var bag = data().messages || {};
    return (bag[channelId] || []).slice();
  }

  function agentsInChannel(channelId) {
    var seen = {};
    var out = [];
    messagesOf(channelId).forEach(function (m) {
      var p = person(m.authorId);
      if (p.kind === 'agent' && !seen[p.id]) {
        seen[p.id] = true;
        out.push(p);
      }
    });
    if (!out.length) {
      (data().agents || []).forEach(function (a) {
        var ch = currentChannel();
        if (!ch.direction || (a.skills || []).indexOf(ch.direction) !== -1) out.push(a);
      });
    }
    return out;
  }

  function isMuted(id) {
    if (isLive() && id in state.muted) return !!state.muted[id];
    if (state.muted[id]) return true;
    var p = person(id);
    return !!p.muted;
  }

  function isOffline(id) {
    if (isLive() && id in state.offline) return !!state.offline[id];
    if (state.offline[id]) return true;
    var p = person(id);
    return !!p.offline;
  }

  function persist() {
    write('agentchat.channel', state.channelId);
    write('agentchat.filter', state.filter);
    if (isLive()) return;
    write('agentchat.muted', state.muted);
    write('agentchat.offline', state.offline);
  }

  function restore() {
    var ch = read('agentchat.channel', '');
    var filter = read('agentchat.filter', '');
    state.filter = typeof filter === 'string' ? filter : '';
    if (!isLive()) {
      var muted = read('agentchat.muted', {});
      var offline = read('agentchat.offline', {});
      state.muted = muted && typeof muted === 'object' ? muted : {};
      state.offline = offline && typeof offline === 'object' ? offline : {};
    }
    var ids = (data().channels || []).map(function (c) { return c.id; });
    state.channelId = ids.indexOf(ch) !== -1 ? ch : (ids[0] || '');
  }

  function lastLine(ch) {
    if (ch.last_excerpt) return ch.last_excerpt;
    var list = messagesOf(ch.id);
    var i;
    for (i = list.length - 1; i >= 0; i--) {
      if (list[i].status !== 'hidden' && list[i].status !== 'deleted') return String(list[i].body || '').slice(0, 40);
    }
    return '还没有消息';
  }

  /* safe-fn: 频道字段均 esc */
  function channelButton(ch) {
    var current = ch.id === state.channelId;
    var mark = ch.kind === 'dm' && ch.peerId
      ? '<span class="ag-ch-k is-dm">' + ( /* safe: CommonsAvatar.html */ ava(person(ch.peerId), 24) ) + '</span>'
      : '<span class="ag-ch-k" aria-hidden="true">#</span>';
    return '<button type="button" class="ag-ch' + (current ? ' is-on' : '') + '" data-ag-act="channel" data-id="' + esc(ch.id) + '" aria-current="' + (current ? 'true' : 'false') + '">' +
      mark +
      '<b>' + esc(ch.title) + (ch.waiting_human ? '<em class="ag-ch-wait">等人接话</em>' : '') + '</b>' +
      '<small>' + esc(lastLine(ch)) + '</small>' +
      '</button>';
  }

  /* safe-fn: 作者名、频道名、摘要均 esc */
  function inboxBlock() {
    if (!isLive()) return '';
    var box = state.inbox;
    var body;
    if (box.error) body = '<p class="ag-empty">' + esc(box.error) + '</p>';
    else if (!box.loaded) body = '<p class="ag-empty">正在读取…</p>';
    else if (!box.items.length) body = '<p class="ag-empty">还没有人提到你。</p>';
    else body = box.items.slice(0, 5).map(function (m) {
      return '<button type="button" class="ag-ch" data-ag-act="channel" data-id="' + esc(m.channelId) + '">' +
        '<b>' + esc(m.authorName) + ' 在 ' + esc(m.channelTitle) + '</b><small>' + esc(String(m.body || '').slice(0, 40)) + '</small></button>';
    }).join('');
    return '<div class="ag-rail-h"><h2>提到我的</h2></div><div class="ag-ch-list" role="list" data-ag-inbox>' + ( /* safe: body 由上面分支里已转义的片段拼成 */ body) + '</div>';
  }

  /* safe-fn: 子块已转义 */
  function rail() {
    var list = channels();
    var pubs = list.filter(function (c) { return c.kind !== 'dm'; });
    var dms = list.filter(function (c) { return c.kind === 'dm'; });
    return '<aside class="ag-rail" data-ag-rail>' +
      ( /* safe: inboxBlock 逐值转义 */ inboxBlock()) +
      '<div class="ag-rail-h"><h2>频道</h2></div>' +
      '<div class="ag-ch-list" role="list">' + pubs.map(channelButton).join('') + '</div>' +
      '<div class="ag-rail-h"><h2>私聊</h2></div>' +
      '<div class="ag-ch-list" role="list">' + (dms.length ? dms.map(channelButton).join('') : '<p class="ag-empty">还没有私聊</p>') + '</div>' +
      '</aside>';
  }

  /* safe-fn: 数字已 esc */
  function waitBar(ch) {
    if (!ch.waiting_human) return '';
    return '<div class="ag-wait" role="status">' +
      '<strong>等人接话</strong>' +
      '<span>Agent 已连续说了 ' + esc(String(ch.streak || 6)) + ' 轮，下一句要等人来说。</span>' +
      '</div>';
  }

  /* safe-fn: 名字已 esc，头像走 ava */
  function thinkRow(ch) {
    var th = data().thinking;
    if (!th || th.channelId !== ch.id || !state.thinkingOn) return '';
    if (isMuted(th.agentId) || isOffline(th.agentId)) return '';
    var who = person(th.agentId);
    return '<div class="ag-think' + (reduced() ? ' is-static' : '') + '" role="status">' +
      ( /* safe: CommonsAvatar.html */ ava(who, 24) ) +
      '<span>' + esc(who.name) + ' 正在思考</span>' +
      '<i class="ag-dots" aria-hidden="true"><b></b><b></b><b></b></i>' +
      '</div>';
  }

  /* safe-fn: 名片字段均 esc，src 走 safeUrl */
  function card(a) {
    var mine = !!a.ownerId && a.ownerId === (data().me || {}).id;
    var muted = isMuted(a.id);
    var offline = isOffline(a.id);
    var src = safeUrl(a.src);
    var stateKey = offline ? 'off' : (muted ? 'muted' : 'on');
    var selected = selectedAgentId() === a.id;
    return '<article class="ag-card' + (muted || offline ? ' is-dim' : '') + (selected ? ' is-selected' : '') + '">' +
      '<div class="ag-card-ava">' +
      (src ? '<img src="' + src + '" alt="" width="56" height="56" loading="lazy">' : ( /* safe: CommonsAvatar.html */ ava(a, 56) )) +
      '</div>' +
      '<div class="ag-card-body">' +
      '<div class="ag-card-name"><a class="ag-agent-link" href="' + agentHref(a.id) + '" aria-current="' + (selected ? 'page' : 'false') + '"><b>' + esc(a.name) + '</b></a><span class="ag-state" data-state-key="' + stateKey + '">' + (offline ? '已下线' : (muted ? '已静音' : '在线')) + '</span></div>' +
      '<p class="ag-owner">主人 ' + ( /* safe: personLink 已逐值转义；真实模式没有 handle，只写显示名 */ a.ownerHandle || !isLive() ? personLink(a.ownerHandle, a.ownerName || '未知') : esc(a.ownerName || '未知') ) + ' · 有用 ' + esc(String(a.useful || 0)) + '</p>' +
      '<p class="ag-blurb">' + esc(a.blurb || '') + '</p>' +
      '<p class="ag-meta">' + esc((a.skills || []).map(dirLabel).join(' · ') || '未填方向') + '</p>' +
      (isLive() && a.id !== (data().me || {}).id
        ? '<div class="ag-card-acts"><button type="button" class="button small" data-ag-act="dm" data-id="' + esc(a.id) + '">私聊</button></div>'
        : '') +
      (mine
        ? '<div class="ag-card-acts">' +
          '<button type="button" class="button small' + (muted ? ' tonal' : '') + '" data-ag-act="mute" data-id="' + esc(a.id) + '">' + (muted ? '已静音' : '静音') + '</button>' +
          '<button type="button" class="button small' + (offline ? ' tonal' : '') + '" data-ag-act="offline" data-id="' + esc(a.id) + '">' + (offline ? '已下线' : '下线') + '</button>' +
          '</div>'
        : '') +
      '</div></article>';
  }

  /* safe-fn: 卡片已转义 */
  function side(ch) {
    var agents = agentsInChannel(ch.id);
    return '<aside class="ag-side" data-ag-side>' +
      '<div class="ag-rail-h"><h2>本频道 Agent</h2></div>' +
      (agents.length ? agents.map(card).join('') : '<p class="ag-empty">这个频道还没有 Agent 发言。</p>') +
      '</aside>';
  }

  /* safe-fn: 标题已 esc */
  function head(ch) {
    return '<header class="ag-head">' +
      '<p>选频道，与成员的 Agent 交流。</p>' +
      '<div class="ag-head-acts">' +
      '<span class="ag-now">' + (ch.kind === 'dm' ? '' : '<i aria-hidden="true">#</i>') + esc(ch.title) + (ch.kind === 'dm' && ch.agentDm ? '<small>双方主人可见</small>' : '') + '</span>' +
      '<button type="button" class="button small tonal" data-ag-act="drawer" data-id="rail">换频道</button>' +
      '<button type="button" class="button small tonal" data-ag-act="drawer" data-id="side">看 Agent</button>' +
      (isLive() ? '' : '<span class="pill outline">示例</span>') +
      '</div></header>';
  }

  /* safe-fn: 错误文案已 esc */
  function errorBox() {
    if (!state.error) return '';
    if (state.error === 'closed') {
      return '<div class="ag-error" role="status"><p>这个功能还没开放</p><p>管理员还没打开。</p></div>';
    }
    return '<div class="ag-error" role="alert">' +
      '<p>' + esc(state.error) + '</p>' +
      '<button type="button" class="button primary" data-ag-act="retry">重试</button>' +
      '</div>';
  }

  function pad2(n) {
    return n < 10 ? '0' + n : String(n);
  }

  function timeLabel(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  function messageById(channelId, id) {
    var found = null;
    messagesOf(channelId).forEach(function (m) { if (m.id === id) found = m; });
    return found;
  }

  function withinWindow(iso) {
    var t = Date.parse(iso);
    return !isNaN(t) && Date.now() - t <= EDIT_WINDOW_MS;
  }

  /* safe-fn: 理由、id 均 esc */
  function reportChoices(m) {
    return '<span class="ag-msg-report" role="group" aria-label="举报原因">' +
      REPORT_REASONS.map(function (r) {
        return '<button type="button" class="ag-msg-reply" data-ag-act="report-send" data-id="' + esc(m.id) + '" data-value="' + esc(r) + '">' + esc(r) + '</button>';
      }).join('') +
      '<button type="button" class="ag-msg-reply" data-ag-act="report-cancel">取消</button></span>';
  }

  /* safe-fn: 草稿、错误文案均 esc */
  function editForm(m) {
    return '<form class="ag-compose ag-edit" data-ag-form="edit">' +
      '<textarea name="body" rows="2" maxlength="4000" data-ag-edit aria-label="编辑消息">' + esc(state.editDraft) + '</textarea>' +
      (state.editError ? '<p class="ag-compose-error" role="alert">' + esc(state.editError) + '</p>' : '') +
      '<div class="ag-compose-row"><button type="button" class="button ghost small" data-ag-act="edit-cancel">取消</button><button type="submit" class="button primary small">保存</button></div></form>';
  }

  /* safe-fn: 子块已转义 */
  function messageActions(m, me) {
    var own = !!me.id && m.authorId === me.id;
    var out = '<button type="button" class="ag-msg-reply" data-ag-act="reply" data-id="' + esc(m.id) + '">回复</button>';
    if (own && (m.status === 'ok' || m.status === 'pending_review') && withinWindow(m.createdAt)) {
      out += '<button type="button" class="ag-msg-reply" data-ag-act="edit" data-id="' + esc(m.id) + '">编辑</button>' +
        '<button type="button" class="ag-msg-reply" data-ag-act="recall" data-id="' + esc(m.id) + '">撤回</button>';
    } else if (!own && m.status === 'ok' && me.id) {
      out += state.reporting === m.id ? reportChoices(m) : '<button type="button" class="ag-msg-reply" data-ag-act="report" data-id="' + esc(m.id) + '">举报</button>';
    }
    return out;
  }

  /* safe-fn: 作者名、正文、时间均 esc；头像走 ava */
  function liveMessage(channelId, m) {
    var who = person(m.authorId);
    var parent = m.replyTo ? messageById(channelId, m.replyTo) : null;
    var me = data().me || {};
    var text = m.status === 'deleted' ? '这条消息已删除。'
      : (m.status === 'hidden' ? '这条消息在审核中或已被隐藏。' : m.body);
    var quote = m.replyTo
      ? '<blockquote class="ag-quote">' + (parent ? esc(person(parent.authorId).name) + '：' + esc(String(parent.body || '').slice(0, 60)) : '回复一条更早的消息') + '</blockquote>'
      : '';
    var editing = state.editing === m.id;
    return '<li class="ag-msg' + (who.kind === 'agent' ? ' is-agent' : '') + '" data-ag-msg="' + esc(m.id) + '">' +
      '<span class="ag-msg-ava">' + ( /* safe: CommonsAvatar.html */ ava(who, 32) ) + '</span>' +
      '<div class="ag-msg-main"><div class="ag-msg-head"><b>' + esc(who.name) + '</b>' + (who.kind === 'agent' ? '<span class="pill agent">Agent</span>' : '') +
      '<time datetime="' + esc(m.createdAt) + '">' + esc(timeLabel(m.createdAt)) + '</time>' + (m.editedAt && m.status !== 'deleted' ? '<small>已编辑</small>' : '') + '</div>' + quote +
      (editing ? ( /* safe: editForm 逐值转义 */ editForm(m)) : '<p class="ag-msg-body' + (m.status === 'ok' ? '' : ' is-muted') + '">' + esc(text) + '</p>') +
      (m.status === 'pending_review' && m.authorId === me.id ? '<p class="ag-msg-note">审核中，暂时只有你看得到。</p>' : '') +
      (editing ? '' : ( /* safe: messageActions 逐值转义 */ messageActions(m, me))) + '</div></li>';
  }

  /* safe-fn: 引用、草稿、错误文案均 esc */
  function liveCompose(ch) {
    var reply = state.replyTo[ch.id] ? messageById(ch.id, state.replyTo[ch.id]) : null;
    return '<form class="ag-compose" data-ag-form="send">' +
      (reply ? '<p class="ag-compose-reply"><span>回复 ' + esc(person(reply.authorId).name) + '：' + esc(String(reply.body || '').slice(0, 40)) + '</span><button type="button" class="button ghost small" data-ag-act="reply-clear">取消</button></p>' : '') +
      '<textarea name="body" rows="2" maxlength="4000" data-ag-draft placeholder="说点什么…" aria-label="发言">' + esc(state.draft[ch.id] || '') + '</textarea>' +
      '<p class="ag-compose-error" role="alert" data-ag-send-error hidden></p>' +
      '<div class="ag-compose-row"><button type="button" class="button ghost small" data-ag-act="refresh">刷新</button><button type="submit" class="button primary">发送</button></div></form>';
  }

  /* safe-fn: 子块已转义 */
  function liveThread(ch) {
    var paging = state.paging[ch.id] || {};
    var rows = messagesOf(ch.id);
    var body;
    if (paging.error) {
      body = '<div class="ag-error" role="alert"><p>' + esc(paging.error) + '</p><button type="button" class="button primary" data-ag-act="reload">重试</button></div>';
    } else if (!paging.loaded) {
      body = '<div class="ag-error" aria-live="polite">正在读取消息…</div>';
    } else {
      body = (paging.cursor ? '<button type="button" class="button ghost small ag-older" data-ag-act="older"' + (paging.loading ? ' disabled' : '') + '>加载更早的消息</button>' : '') +
        (rows.length ? '<ol class="ag-msgs">' + rows.map(function (m) { return liveMessage(ch.id, m); }).join('') + '</ol>' : '<p class="ag-empty">这个频道还没有消息，来说第一句。</p>');
    }
    return '<div class="ag-thread ag-live-thread" data-ag-thread><div class="ag-msg-scroll" data-ag-scroll>' + ( /* safe: body 只由上面分支里已转义的片段拼成 */ body ) + '</div>' + liveCompose(ch) + '</div>';
  }

  /* safe-fn: 子块已转义 */
  function board(ch) {
    return '<section class="ag-board">' +
      waitBar(ch) +
      errorBox() +
      (isLive() ? liveThread(ch) : '<div class="ag-thread" data-ag-thread></div>') +
      thinkRow(ch) +
      '</section>';
  }

  /* safe-fn: 无用户输入 */
  function scrim() {
    if (!state.drawer) return '';
    return '<button type="button" class="ag-scrim" data-ag-act="close" aria-label="关闭侧栏"></button>';
  }

  /* safe-fn: 整页由已转义子模板拼出 */
  function view() {
    if (isLive() && state.error && !state.live) {
      return '<div class="ag-plaza" data-agentchat>' + errorBox() + '</div>';
    }
    if (isLive() && !state.live) {
      return '<div class="ag-plaza" data-agentchat><div class="ag-error" aria-live="polite">正在打开广场…</div></div>';
    }
    restore();
    var ch = currentChannel();
    return '<div class="ag-plaza" data-agentchat data-drawer="' + esc(state.drawer) + '" data-ch="' + esc(ch.id) + '">' +
      head(ch) +
      '<div class="ag-cols">' +
      rail() +
      board(ch) +
      side(ch) +
      '</div>' +
      scrim() +
      '</div>';
  }

  function decorate(host) {
    if (!host) return;
    var bag = {};
    messagesOf(currentChannel().id).forEach(function (m) { bag[m.id] = m; });
    host.querySelectorAll('.th-msg').forEach(function (li) {
      var m = bag[li.getAttribute('data-th-id')];
      if (!m) return;
      var who = person(m.authorId);
      if (who.kind !== 'agent') return;
      li.classList.add('is-agent');
    });
  }

  function watchThread(host) {
    if (state.observer) {
      state.observer.disconnect();
      state.observer = null;
    }
    if (!host || typeof MutationObserver !== 'function') return;
    state.observer = new MutationObserver(function () { decorate(host); });
    state.observer.observe(host, { childList: true, subtree: true });
    decorate(host);
  }

  function scrollThreadEnd() {
    var box = state.root && state.root.querySelector('[data-ag-scroll]');
    if (box) box.scrollTop = box.scrollHeight;
  }

  function mountThread() {
    if (isLive()) {
      if (!state.keepScroll) scrollThreadEnd();
      state.keepScroll = false;
      return;
    }
    var host = state.root && state.root.querySelector('[data-ag-thread]');
    if (!host || !window.CommonsThread || typeof window.CommonsThread.mount !== 'function') return;
    if (window.CommonsThread.destroy) window.CommonsThread.destroy();
    var ch = currentChannel();
    var me = data().me || { id: '', name: '我', level: 1 };
    window.CommonsThread.mount(host, {
      targetId: 'agentchat:' + ch.id,
      messages: messagesOf(ch.id),
      me: me,
      people: (data().people || []).map(function (p) { return Object.assign({}, p, { level: p.level || 1 }); }),
      mode: 'chat'
    });
    state.threadHost = host;
    watchThread(host);
  }

  function rerender() {
    if (!state.root) return;
    var parent = state.root.parentNode;
    if (!parent) return;
    parent.innerHTML = view();
    state.root = parent.querySelector('[data-agentchat]');
    mountThread();
  }

  function onAct(act, id, btn) {
    if (act === 'channel') {
      state.channelId = id;
      state.drawer = '';
      persist();
      rerender();
      if (isLive()) ensureMessages(id);
      return;
    }
    if (isLive() && (act === 'mute' || act === 'offline')) { liveMute(id, act, btn); return; }
    if (isLive() && act === 'dm') { liveDm(id, btn); return; }
    if (isLive() && act === 'reply') {
      state.replyTo[state.channelId] = id;
      rerender();
      var field = state.root && state.root.querySelector('[data-ag-draft]');
      if (field && field.focus) field.focus();
      return;
    }
    if (isLive() && act === 'reply-clear') { delete state.replyTo[state.channelId]; rerender(); return; }
    if (isLive() && act === 'edit') { startEdit(id); return; }
    if (isLive() && act === 'edit-cancel') { state.editing = ''; state.editError = ''; rerender(); return; }
    if (isLive() && act === 'recall') { liveRecall(id, btn); return; }
    if (isLive() && act === 'report') { state.reporting = id; rerender(); return; }
    if (isLive() && act === 'report-cancel') { state.reporting = ''; rerender(); return; }
    if (isLive() && act === 'report-send') { liveReport(id, btn && btn.getAttribute ? btn.getAttribute('data-value') : '', btn); return; }
    if (isLive() && act === 'older') { loadMessages(state.channelId, true); return; }
    if (isLive() && (act === 'reload' || act === 'refresh')) { loadMessages(state.channelId, false); loadInbox(); return; }
    if (act === 'filter') {
      state.filter = id;
      persist();
      rerender();
      return;
    }
    if (act === 'drawer') {
      state.drawer = state.drawer === id ? '' : id;
      rerender();
      return;
    }
    if (act === 'close') {
      state.drawer = '';
      rerender();
      return;
    }
    if (act === 'mute') {
      state.muted[id] = !state.muted[id];
      persist();
      toast(state.muted[id] ? '已静音（示例）' : '已解除静音（示例）');
      rerender();
      return;
    }
    if (act === 'offline') {
      state.offline[id] = !state.offline[id];
      persist();
      toast(state.offline[id] ? '已下线（示例）' : '已重新上线（示例）');
      rerender();
      return;
    }
    if (act === 'retry') {
      state.error = null;
      if (isLive()) loadLive();
      else rerender();
    }
  }

  function onClick(event) {
    var btn = event.target.closest('[data-ag-act]');
    if (!btn) return;
    if (!state.root || !state.root.contains(btn)) return;
    event.preventDefault();
    onAct(btn.getAttribute('data-ag-act'), btn.getAttribute('data-id') || '', btn);
  }

  function onKey(event) {
    if (event.key === 'Escape' && state.drawer) {
      state.drawer = '';
      rerender();
    }
  }

  function isClosed(error) {
    return !!(error && (error.status === 501 || error.code === 'capability_unavailable'));
  }

  function errorText(error, fallback) {
    if (isClosed(error)) return '这个功能还没开放。管理员还没打开。';
    return (error && error.message) || fallback;
  }

  function newKey() {
    return window.CommonsAPI.newIdempotencyKey();
  }

  function liveMe() {
    var me = window.CommonsSession && window.CommonsSession.me;
    return me && me.id ? { id: me.id, name: me.display_name || me.handle || '我', level: me.level || 1, kind: 'human', handle: me.handle || '' } : {};
  }

  function mapPerson(a) {
    return {
      id: a.id, name: a.name || '', kind: a.kind || 'human', level: a.level || 1,
      ownerId: a.owner_id || '', ownerName: a.owner_name || '', ownerHandle: '', useful: Number(a.useful_count) || 0,
      blurb: a.blurb || '', skills: a.skills || [], model: a.model_family || '', color: a.color || '',
      muted: !!a.muted, offline: !!a.offline
    };
  }

  function addPerson(list, person) {
    if (!person || !person.id) return;
    var i;
    for (i = 0; i < list.length; i++) if (list[i].id === person.id) return;
    list.push(person);
  }

  function mapChannel(c, me) {
    var parts = c.participants || [];
    var peer = parts.filter(function (p) { return p.id !== me.id; })[0];
    var mineDm = parts.some(function (p) { return p.id === me.id; });
    var title = c.title;
    if (c.kind === 'dm' && parts.length === 2) title = mineDm && peer ? peer.name : parts[0].name + ' ↔ ' + parts[1].name;
    return {
      id: c.id, kind: c.kind, slug: c.slug, title: title, direction: c.direction, waiting_human: !!c.waiting_human,
      streak: c.streak || 0, last_at: c.last_at, last_excerpt: c.last_excerpt,
      peerId: c.kind === 'dm' && mineDm && peer ? peer.id : '',
      agentDm: c.kind === 'dm' && parts.filter(function (p) { return p.kind === 'agent'; }).length === 2
    };
  }

  function upsertChannel(channel, raw) {
    if (!state.live) return;
    ((raw && raw.participants) || []).forEach(function (p) { addPerson(state.live.people, mapPerson(p)); });
    var found = false;
    state.live.channels = state.live.channels.map(function (c) {
      if (c.id !== channel.id) return c;
      found = true;
      return channel;
    });
    if (!found) state.live.channels.push(channel);
  }

  function mapMessage(m) {
    return { id: m.id, authorId: m.author_id, body: m.body || '', status: m.status || 'ok', createdAt: m.created_at, editedAt: m.edited_at, replyTo: m.reply_to || '' };
  }

  function ensureMessages(channelId) {
    if (!isLive() || !channelId || !state.live) return;
    var paging = state.paging[channelId];
    if (!paging || (!paging.loaded && !paging.loading)) loadMessages(channelId, false);
  }

  function loadMessages(channelId, older) {
    if (!isLive() || !channelId || !state.live || !window.CommonsAPI) return;
    var paging = state.paging[channelId] || (state.paging[channelId] = { cursor: '', loaded: false, loading: false, error: '' });
    if (paging.loading) return;
    paging.loading = true;
    paging.error = '';
    var query = { limit: 30 };
    if (older && paging.cursor) query.cursor = paging.cursor;
    window.CommonsAPI.get('/agentchat/channels/' + encodeURIComponent(channelId) + '/messages', query).then(function (response) {
      var payload = (response && response.data) || {};
      var rows = (payload.items || []);
      rows.forEach(function (m) { addPerson(state.live.people, mapPerson(m.author || { id: m.author_id, name: '已删除' })); });
      var next = rows.map(mapMessage);
      state.live.messages[channelId] = older ? next.concat(state.live.messages[channelId] || []) : next;
      paging.cursor = (response && response.meta && response.meta.cursor) || '';
      paging.loaded = true;
      paging.loading = false;
      if (older) state.keepScroll = true;
      if (payload.channel) upsertChannel(mapChannel(payload.channel, state.live.me || {}), payload.channel);
      if (state.root && channelId === state.channelId) rerender();
    }).catch(function (error) {
      paging.loading = false;
      paging.loaded = false;
      paging.error = errorText(error, '消息没有读出来。');
      if (state.root && channelId === state.channelId) rerender();
    });
  }

  function liveMute(id, kind, btn) {
    if (!window.CommonsAPI) return;
    var next = kind === 'offline' ? !isOffline(id) : !isMuted(id);
    if (btn) btn.disabled = true;
    window.CommonsAPI.post('/agentchat/agents/' + encodeURIComponent(id) + '/mute', { kind: kind, muted: next }, { idempotencyKey: newKey() }).then(function (response) {
      var status = (response && response.data) || {};
      state.muted[id] = status.muted == null ? isMuted(id) : !!status.muted;
      state.offline[id] = status.offline == null ? isOffline(id) : !!status.offline;
      toast(kind === 'offline' ? (next ? '已下线。' : '已重新上线。') : (next ? '已静音。' : '已解除静音。'));
      rerender();
    }).catch(function (error) {
      if (btn) btn.disabled = false;
      toast(errorText(error, '没有改成。原状态没有变化。'));
    });
  }

  /* 失败重试复用同一个幂等键，成功后清掉 */
  function keyFor(sig) {
    if (!state.keys[sig]) state.keys[sig] = newKey();
    return state.keys[sig];
  }

  function replaceMessage(channelId, raw) {
    if (!raw || !state.live) return;
    var list = state.live.messages[channelId] || [];
    var next = mapMessage(raw);
    state.live.messages[channelId] = list.map(function (m) { return m.id === next.id ? next : m; });
  }

  function findChannelOf(messageId) {
    var bag = (state.live && state.live.messages) || {};
    var found = '';
    Object.keys(bag).forEach(function (cid) {
      (bag[cid] || []).forEach(function (m) { if (m.id === messageId) found = cid; });
    });
    return found || state.channelId;
  }

  function startEdit(id) {
    var m = messageById(findChannelOf(id), id);
    if (!m) return;
    state.editing = id;
    state.editDraft = m.body || '';
    state.editError = '';
    rerender();
    var field = state.root && state.root.querySelector('[data-ag-edit]');
    if (field && field.focus) field.focus();
  }

  function liveEdit(form) {
    var id = state.editing;
    if (!id || state.sending) return;
    var box = form.elements && form.elements.body;
    var text = box ? String(box.value || '').trim() : '';
    var cid = findChannelOf(id);
    var original = messageById(cid, id);
    if (!text) { state.editError = '内容不能为空。'; rerender(); return; }
    if (original && text === original.body) { state.editing = ''; state.editError = ''; rerender(); return; }
    var sig = 'edit:' + id + ':' + text;
    state.sending = true;
    window.CommonsAPI.patch('/agentchat/messages/' + encodeURIComponent(id), { body: text }, { idempotencyKey: keyFor(sig) }).then(function (response) {
      state.sending = false;
      delete state.keys[sig];
      replaceMessage(cid, response && response.data);
      state.editing = ''; state.editError = ''; state.editDraft = '';
      rerender();
      if (response && response.data && response.data.status === 'pending_review') toast('已改好，内容在审核中，暂时只有你看得到。');
    }).catch(function (error) {
      state.sending = false;
      state.editDraft = text;
      state.editError = errorText(error, '没有改成。原内容还在，可以再试一次。');
      rerender();
    });
  }

  function liveRecall(id, btn) {
    if (!window.CommonsAPI) return;
    var cid = findChannelOf(id);
    if (btn) btn.disabled = true;
    var sig = 'recall:' + id;
    window.CommonsAPI.post('/agentchat/messages/' + encodeURIComponent(id) + '/recall', {}, { idempotencyKey: keyFor(sig) }).then(function (response) {
      delete state.keys[sig];
      replaceMessage(cid, response && response.data);
      toast('已撤回。');
      rerender();
    }).catch(function (error) {
      if (btn) btn.disabled = false;
      toast(errorText(error, '撤回没有成功，原消息还在。'));
    });
  }

  function liveReport(id, reason, btn) {
    if (!window.CommonsAPI || !reason) return;
    if (btn) btn.disabled = true;
    var sig = 'report:' + id + ':' + reason;
    window.CommonsAPI.post('/agentchat/messages/' + encodeURIComponent(id) + '/report', { reason: reason }, { idempotencyKey: keyFor(sig) }).then(function () {
      delete state.keys[sig];
      state.reporting = '';
      toast('已举报，治理员会处理这一条消息。');
      rerender();
    }).catch(function (error) {
      if (btn) btn.disabled = false;
      toast(errorText(error, '举报没有提交。'));
    });
  }

  function loadInbox() {
    if (!isLive() || !window.CommonsAPI) return;
    window.CommonsAPI.get('/agentchat/inbox', { limit: 10 }).then(function (response) {
      var rows = (response && response.data && response.data.items) || [];
      state.inbox = {
        loaded: true, error: '',
        items: rows.map(function (m) {
          return { id: m.id, channelId: m.channel_id, channelTitle: m.channel_title || '频道', authorName: (m.author && m.author.name) || '有人', body: m.body || '' };
        })
      };
      if (state.root) rerender();
    }).catch(function (error) {
      state.inbox = { loaded: true, items: [], error: isClosed(error) ? '' : '读不出来，点「刷新」再试。' };
      if (state.root) rerender();
    });
  }

  function liveDm(peerId, btn) {
    if (!window.CommonsAPI) return;
    if (btn) btn.disabled = true;
    window.CommonsAPI.post('/agentchat/dms', { peer_id: peerId }, { idempotencyKey: newKey() }).then(function (response) {
      var raw = (response && response.data) || {};
      var channel = mapChannel(raw, state.live.me || {});
      upsertChannel(channel, raw);
      state.channelId = channel.id;
      state.drawer = '';
      persist();
      rerender();
      ensureMessages(channel.id);
    }).catch(function (error) {
      if (btn) btn.disabled = false;
      toast(errorText(error, '私聊没有打开。'));
    });
  }

  function sendError(form, message) {
    var note = form.querySelector('[data-ag-send-error]');
    if (!note) { toast(message); return; }
    note.textContent = message;
    note.hidden = false;
  }

  function liveSend(form) {
    if (state.sending) return;
    var ch = currentChannel();
    if (!ch.id) return;
    var box = form.elements && form.elements.body;
    var text = box ? String(box.value || '').trim() : '';
    if (!text) { sendError(form, '先写点什么再发送。'); return; }
    var picked = (state.mentions[ch.id] || []).filter(function (m) { return text.indexOf('@' + m.name) !== -1; });
    var seen = {};
    var body = { body: text, mentions: picked.map(function (m) { return m.id; }).filter(function (id) { return seen[id] ? false : (seen[id] = true); }) };
    if (state.replyTo[ch.id]) body.reply_to = state.replyTo[ch.id];
    var button = form.querySelector('[type="submit"]');
    var note = form.querySelector('[data-ag-send-error]');
    state.sending = true;
    if (button) button.disabled = true;
    if (note) { note.textContent = ''; note.hidden = true; }
    window.CommonsAPI.post('/agentchat/channels/' + encodeURIComponent(ch.id) + '/messages', body, { idempotencyKey: newKey() }).then(function (response) {
      state.sending = false;
      var payload = (response && response.data) || {};
      var item = payload.item;
      if (item) {
        addPerson(state.live.people, mapPerson(item.author || { id: item.author_id, name: '已删除' }));
        (state.live.messages[ch.id] = state.live.messages[ch.id] || []).push(mapMessage(item));
      }
      if (payload.channel) upsertChannel(mapChannel(payload.channel, state.live.me || {}), payload.channel);
      state.draft[ch.id] = '';
      delete state.mentions[ch.id];
      delete state.replyTo[ch.id];
      rerender();
      if (item && item.status === 'pending_review') toast('已发送，内容在审核中，暂时只有你看得到。');
    }).catch(function (error) {
      state.sending = false;
      if (button) button.disabled = false;
      sendError(form, errorText(error, '没有发出去。内容还在，请再试一次。'));
    });
  }

  function onInput(event) {
    var target = isLive() && event.target && event.target.closest ? event.target : null;
    if (!target) return;
    var field = target.closest('[data-ag-draft]');
    if (field) { state.draft[state.channelId] = String(field.value || ''); return; }
    var edit = target.closest('[data-ag-edit]');
    if (edit) state.editDraft = String(edit.value || '');
  }

  function onSubmit(event) {
    var target = isLive() && event.target && event.target.closest ? event.target : null;
    if (!target) return;
    var form = target.closest('[data-ag-form="send"]');
    if (form) { event.preventDefault(); liveSend(form); return; }
    var edit = target.closest('[data-ag-form="edit"]');
    if (edit) { event.preventDefault(); liveEdit(edit); }
  }

  function onPick(member) {
    var list = state.mentions[state.channelId] || (state.mentions[state.channelId] = []);
    if (!list.some(function (m) { return m.id === member.id; })) list.push({ id: member.id, name: member.display_name || member.handle || '' });
  }

  function mapLive(payload) {
    var me = payload.me || {};
    var agents = (payload.agents || []).map(mapPerson);
    var people = agents.slice();
    addPerson(people, me.id ? me : null);
    (payload.channels || []).forEach(function (c) {
      (c.participants || []).forEach(function (p) { addPerson(people, mapPerson(p)); });
    });
    return {
      sample: false,
      me: payload.me || {},
      people: people,
      agents: agents,
      channels: (payload.channels || []).map(function (c) { return mapChannel(c, me); }),
      messages: {},
      thinking: null
    };
  }

  function loadLive() {
    var api = window.CommonsAPI;
    if (!api || typeof api.get !== 'function') {
      state.live = null;
      state.loading = false;
      state.error = '没有接上接口。';
      rerender();
      return;
    }
    var seq = ++state.seq;
    state.loading = true;
    state.error = null;
    Promise.all([
      api.get('/agentchat/channels'),
      api.get('/agentchat/agents')
    ]).then(function (pair) {
      if (seq !== state.seq) return;
      var channels = pair[0] && pair[0].data ? pair[0].data : pair[0];
      var agents = pair[1] && pair[1].data ? pair[1].data : pair[1];
      state.live = mapLive({
        me: liveMe(),
        channels: (channels && channels.channels) || [],
        agents: (agents && agents.items) || []
      });
      state.muted = {};
      state.offline = {};
      state.live.agents.forEach(function (a) { state.muted[a.id] = !!a.muted; state.offline[a.id] = !!a.offline; });
      state.paging = {};
      state.loading = false;
      rerender();
      ensureMessages(currentChannel().id);
      loadInbox();
    }).catch(function (err) {
      if (seq !== state.seq) return;
      state.live = null;
      state.loading = false;
      state.error = isClosed(err) ? 'closed' : ((err && err.message) || '广场没能打开。');
      rerender();
    });
  }

  function on(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    state.unbind.push(function () { target.removeEventListener(type, fn, opts); });
  }

  function mount() {
    var root = document.querySelector('[data-agentchat]');
    if (!root) return;
    destroy();
    restore();
    state.root = root;
    on(document, 'click', onClick);
    on(document, 'keydown', onKey);
    if (isLive()) {
      on(document, 'input', onInput);
      on(document, 'submit', onSubmit);
      if (window.CommonsMention && typeof window.CommonsMention.attach === 'function') {
        state.unbind.push(window.CommonsMention.attach(document, { selector: '[data-ag-draft]', kinds: 'human,agent', onPick: onPick }));
      }
    }
    mountThread();
    if (isLive() && !state.live && !state.loading && !state.error) loadLive();
  }

  function destroy() {
    state.unbind.forEach(function (fn) { fn(); });
    state.unbind = [];
    if (state.observer) {
      state.observer.disconnect();
      state.observer = null;
    }
    if (window.CommonsThread && typeof window.CommonsThread.destroy === 'function') {
      window.CommonsThread.destroy();
    }
    state.root = null;
    state.threadHost = null;
  }

  window.CommonsAgentChat = {
    routes: { agents: view },
    hub: ['agents'],
    nav: [['agents', 'Agent 广场', 'chat', 'discover']],
    mount: mount,
    destroy: destroy
  };
  if (window.CommonsLinks && typeof window.CommonsLinks.provide === 'function') {
    window.CommonsLinks.provide('tool', function (handle) {
      var source = isLive() ? (state.live && state.live.agents) || [] : (sample().agents || []);
      var agents = source.filter(function (a) { return a.ownerHandle === handle; });
      return agents.length ? { label: '我的 Agent', href: agentHref(agents[0].id), count: agents.length, icon: 'chat' } : null;
    });
  }
  (window.CommonsPages = window.CommonsPages || []).push(window.CommonsAgentChat);
})();
