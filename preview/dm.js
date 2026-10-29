/* R13 DM-1 · member private messages. */
(function () {
  'use strict';

  var STORE = 'dm.demo.v1';
  var STICKERS = [
    ['assets/mascot/panda-avatar-classic-512.webp', '经典熊猫'],
    ['assets/mascot/panda-avatar-brand-blue-512.webp', '先锋蓝熊猫'],
    ['assets/mascot/panda-avatar-mint-512.webp', '薄荷熊猫'],
    ['assets/mascot/panda-avatar-mist-purple-512.webp', '雾紫熊猫']
  ];
  var state = {
    root: null, unbind: [], timers: [], poll: null, filter: 'inbox', settings: false,
    picker: '', typing: false, imageName: '', error: null, sendError: '', loading: false, live: null, seq: 0,
    drafts: {}, composing: false, account: '', unreadCount: null, unreadAsked: false, readMark: null,
    editing: '', editDraft: '', editError: '', reporting: '', keys: {}
  };
  var EDIT_WINDOW_MS = 120000;
  var REPORT_REASONS = ['广告刷屏', '骚扰辱骂', '违法违规', '其他'];

  function esc(value) {
    return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function clone(value) { return JSON.parse(JSON.stringify(value)); }

  function sample() { return window.COMMONS_DM_SAMPLE || { me: {}, settings: {}, threads: [], messages: {} }; }

  function read() {
    var saved = window.Commons && window.Commons.read ? window.Commons.read(STORE, null) : null;
    if (!saved || !Array.isArray(saved.threads) || !saved.messages) saved = clone(sample());
    return saved;
  }

  function write(data) {
    if (isLive()) return false;
    return !!(window.Commons && window.Commons.write && window.Commons.write(STORE, data));
  }

  function writeOpts() {
    return { idempotencyKey: window.CommonsAPI && window.CommonsAPI.newIdempotencyKey() };
  }

  function liveError(error, fallback) {
    if (error && (error.status === 501 || error.code === 'capability_unavailable')) return '这个功能还没开放。管理员还没打开。';
    return (error && error.message) || fallback || '没有成功，原数据没有动，可以再试一次。';
  }

  function data() { return isLive() ? state.live : read(); }

  function isLive() {
    if (window.COMMONS_BUILD && window.COMMONS_BUILD.mode) return window.COMMONS_BUILD.mode === 'live';
    return !!(window.CommonsAPI && window.CommonsAPI.mode === 'live');
  }

  function sessionAccount() {
    var me = window.CommonsSession && window.CommonsSession.me;
    return me ? String(me.id || me.handle || '') : '';
  }

  function resetLiveAccount() {
    state.seq += 1;
    state.live = null;
    state.loading = false;
    state.error = null;
  }

  function onSessionChange() {
    var next = sessionAccount();
    if (next === state.account) return;
    state.account = next;
    resetLiveAccount();
    if (isLive() && state.root) refreshLive(true);
    else refreshBadge();
  }

  window.addEventListener('commons:session', onSessionChange);

  function routeId() {
    var parts = location.hash.replace(/^#\/?/, '').split('?')[0].split('/').filter(Boolean);
    return parts[0] === 'messages' ? (parts[1] || '') : '';
  }

  function icon(name) {
    return window.Commons && window.Commons.icon ? window.Commons.icon(name) : '';
  }

  function safeUrl(value) {
    return window.Commons && window.Commons.safeUrl ? window.Commons.safeUrl(value) : '#';
  }

  /* safe-fn: CommonsLinks.person 自行转义；降级分支只输出本函数转义后的姓名。 */
  function personLink(handle, name, level) {
    if (window.CommonsLinks && typeof window.CommonsLinks.person === 'function') {
      return window.CommonsLinks.person(handle, name, { level: level });
    }
    return handle ? '<a class="lk-person" href="#/u/' + encodeURIComponent(handle) + '">' + esc(name) + '</a>' : esc(name);
  }

  function previewFromMessage(message) {
    if (message.ref) return message.ref;
    var match = String(message.text || '').match(/#\/[A-Za-z0-9][A-Za-z0-9._~!$&'()*+,;=:@%/?-]*/);
    if (!match) return null;
    var known = (sample().linkPreviews || {})[match[0]];
    if (known) return known;
    var parts = match[0].replace(/^#\//, '').split('/').filter(Boolean);
    return { type: parts[0] || '站内', id: parts[1] || '', title: match[0], subtitle: '站内链接', href: match[0] };
  }


  function avatar(person, small) {
    if (window.CommonsAvatar && window.CommonsAvatar.html) {
      return /* safe: CommonsAvatar owns its HTML and escapes its data */ window.CommonsAvatar.html({
        id: person.id, name: person.name, src: person.avatar, size: small ? 36 : 44
      });
    }
    if (person.avatar) return '<img class="dm-avatar-img" src="' + safeUrl(person.avatar) + '" alt="">';
    return '<span class="dm-avatar-fallback" aria-hidden="true">' + esc((person.name || '?').charAt(0)) + '</span>';
  }

  function other(thread, me) {
    return (thread.participants || []).find(function (person) { return person.id !== me.id; }) || me;
  }

  function threadTitle(thread, me) {
    if (thread.kind === 'group') return thread.title || '小群';
    return other(thread, me).name || thread.title || '私信';
  }

  function clockText(value) {
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    var now = new Date();
    if (date.toDateString() === now.toDateString()) {
      return String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
    }
    return (date.getMonth() + 1) + '.' + date.getDate();
  }

  function dateLabel(value) {
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return (date.getMonth() + 1) + ' 月 ' + date.getDate() + ' 日';
  }

  function unreadTotal(source) {
    return (source && source.threads || []).reduce(function (sum, thread) { return sum + (thread.unread || 0); }, 0);
  }

  function refreshUnread() {
    if (!isLive() || !window.CommonsAPI || typeof window.CommonsAPI.get !== 'function') return;
    window.CommonsAPI.get('/dm/unread-count').then(function (res) {
      var payload = res && res.data ? res.data : res;
      var n = payload && payload.count;
      if (typeof n === 'number') state.unreadCount = n;
      refreshBadge();
    }).catch(function () {});
  }

  function markReadLive(threadId, messages) {
    if (!isLive() || !threadId || !window.CommonsAPI) return;
    var last = messages && messages.length ? messages[messages.length - 1] : null;
    var seq = last && last.seq != null ? last.seq : undefined;
    if (state.readMark && state.readMark.id === threadId && state.readMark.seq === seq) return;
    state.readMark = { id: threadId, seq: seq };
    var body = seq != null ? { seq: seq } : {};
    window.CommonsAPI.post('/dm/threads/' + encodeURIComponent(threadId) + '/read', body, writeOpts())
      .then(function () { refreshUnread(); })
      .catch(function () { state.readMark = null; });
  }

  function badge() {
    if (isLive() && !state.unreadAsked) {
      state.unreadAsked = true;
      refreshUnread();
    }
    var source = isLive() ? (state.live || { threads: [] }) : read();
    var count = isLive() && state.unreadCount != null ? state.unreadCount : unreadTotal(source);
    return '<a class="button ghost icon-only dm-top-badge" href="#/messages" aria-label="私信，' + esc(String(count)) + ' 条未读">' +
      /* safe: shared icon helper returns trusted SVG */ icon('chat') +
      (count ? '<span>' + esc(count > 99 ? '99+' : String(count)) + '</span>' : '') + '</a>';
  }

  function refreshBadge() {
    var current = document.querySelector('.dm-top-badge');
    if (!current) return;
    var holder = document.createElement('div');
    holder.innerHTML = /* safe: badge returns module-owned HTML with a numeric count */ badge();
    current.replaceWith(holder.firstElementChild);
  }

  function threadRow(thread, source, selected) {
    var person = other(thread, source.me);
    var preview = thread.last_message && thread.last_message.text || '还没有消息';
    var label = thread.request_state === 'pending' && thread.request_recipient_id === source.me.id ? '请求' : '';
    return '<a class="dm-thread-row' + (selected ? ' is-selected' : '') + '" href="#/messages/' + esc(thread.id) + '"' +
      (selected ? ' aria-current="page"' : '') + '>' +
      '<span class="dm-thread-avatar">' + /* safe: avatar returns module-owned HTML */ avatar(person, false) +
      (person.online && !thread.blocked ? '<i aria-hidden="true"></i><span class="sr-only">在线</span>' : '') + '</span>' +
      '<span class="dm-thread-copy"><span><strong>' + esc(threadTitle(thread, source.me)) + '</strong>' +
      '<time>' + esc(clockText(thread.updated_at)) + '</time></span><span><small>' + esc(preview) + '</small>' +
      (thread.unread ? '<b aria-label="' + esc(thread.unread) + ' 条未读">' + esc(thread.unread) + '</b>' : '') + '</span></span>' +
      '<span class="dm-thread-flags">' + (thread.pinned ? /* safe: shared icon helper */ icon('pin') : '') +
      (thread.muted ? /* safe: shared icon helper */ icon('mute') : '') +
      (label ? '<em>' + esc(label) + '</em>' : '') + '</span></a>';
  }

  function threadList(source, selected) {
    var items = source.threads.filter(function (thread) {
      var incoming = thread.request_state === 'pending' && thread.request_recipient_id === source.me.id;
      return state.filter === 'requests' ? incoming : !incoming;
    });
    return '<section class="dm-index" aria-label="会话列表"><div class="dm-index-head"><span class="dm-index-caption">会话与请求</span><div>' + (isLive() ? '' : '<span class="sample-badge">示例</span>') +
      '<button class="button ghost icon-only" type="button" data-dm-act="settings" aria-label="私信设置">' +
      /* safe: shared icon helper */ icon('settings') + '</button></div></div>' +
      '<div class="tabs dm-index-tabs" role="group" aria-label="私信分类">' +
      '<button data-dm-act="filter" data-value="inbox" aria-pressed="' + (state.filter === 'inbox') + '" class="' + (state.filter === 'inbox' ? 'selected' : '') + '">会话</button>' +
      '<button data-dm-act="filter" data-value="requests" aria-pressed="' + (state.filter === 'requests') + '" class="' + (state.filter === 'requests' ? 'selected' : '') + '">消息请求' +
      (source.threads.some(function (thread) { return thread.request_state === 'pending' && thread.request_recipient_id === source.me.id; }) ? '<i></i>' : '') + '</button></div>' +
      '<div class="dm-thread-list">' + (items.length ? items.map(function (thread) {
        return threadRow(thread, source, selected === thread.id);
      }).join('') : '<div class="dm-empty"><span aria-hidden="true">' + /* safe: shared icon helper */ icon('chat') + '</span><p>这里还没有消息。</p><a class="button" href="#/friends">去找好友</a></div>') + '</div></section>';
  }

  function card(ref) {
    if (!ref) return '';
    var href = ref.href || '#';
    if (window.CommonsLinks && typeof window.CommonsLinks.href === 'function' && ref.type && ref.id) {
      href = window.CommonsLinks.href(ref.type, ref.id) || href;
    }
    return '<a class="dm-ref-card" href="' + safeUrl(href) + '"><span>' +
      esc(ref.type === 'market' ? '市集' : ref.type === 'event' ? '活动' : ref.type === 'work' ? '作品' : '知识卡') +
      '</span><strong>' + esc(ref.title) + '</strong><small>' + esc(ref.subtitle || '') + '</small>' +
      /* safe: shared icon helper */ icon('arrow') + '</a>';
  }

  function replyPreview(message, all) {
    if (!message.reply_to) return '';
    var quoted = all.find(function (item) { return item.id === message.reply_to; });
    return '<span class="dm-reply-preview">' + esc(quoted ? (quoted.text || '一条消息') : '引用的消息') + '</span>';
  }

  function withinEditWindow(message) {
    var t = Date.parse(message.created_at);
    return !isNaN(t) && Date.now() - t <= EDIT_WINDOW_MS;
  }

  /* safe-fn: id、理由均 esc */
  function reportChoices(message) {
    return '<span class="dm-report-choices" role="group" aria-label="举报原因">' + REPORT_REASONS.map(function (reason) {
      return '<button type="button" data-dm-act="report-send" data-id="' + esc(message.id) + '" data-value="' + esc(reason) + '">' + esc(reason) + '</button>';
    }).join('') + '<button type="button" data-dm-act="report-cancel">取消</button></span>';
  }

  /* safe-fn: 草稿、错误文案均 esc */
  function editForm(message) {
    return '<form class="dm-edit-form" data-dm-edit-form data-id="' + esc(message.id) + '">' +
      '<textarea name="edit" rows="2" maxlength="4000" data-dm-edit aria-label="编辑消息">' + esc(state.editDraft) + '</textarea>' +
      (state.editError ? '<p class="dm-send-error" role="alert">' + esc(state.editError) + '</p>' : '') +
      '<span class="dm-message-actions"><button type="button" data-dm-act="edit-cancel">取消</button><button type="submit">保存</button></span></form>';
  }

  /* safe-fn: 子块已转义 */
  function messageActions(message, own) {
    var live = isLive();
    var editable = live && own && !message.image_ref && !message.sticker_ref && !message.ref && message.text && withinEditWindow(message);
    var reportItem = !own
      ? (live && state.reporting === message.id ? reportChoices(message) : '<button type="button" data-dm-act="report" data-id="' + esc(message.id) + '">举报</button>')
      : '';
    return '<span class="dm-message-actions">' +
      (editable ? '<button type="button" data-dm-act="edit" data-id="' + esc(message.id) + '">编辑</button>' : '') +
      (own ? '<button type="button" data-dm-act="recall" data-id="' + esc(message.id) + '">撤回</button>' : '') +
      '<button type="button" data-dm-act="delete" data-id="' + esc(message.id) + '">删除</button>' +
      reportItem + '</span>';
  }

  function messageHTML(message, source, all) {
    var own = message.sender_id === source.me.id;
    var media = message.image_ref ? '<span class="dm-image-placeholder">' + /* safe: shared icon helper */ icon('image') + '<b>' + esc(message.image_name || '图片') + '</b></span>' : '';
    var sticker = message.sticker_ref ? '<img class="dm-sticker" src="' + safeUrl(message.sticker_ref) + '" alt="熊猫贴纸">' : '';
    var editing = isLive() && state.editing === message.id && !message.recalled;
    return '<article class="dm-message' + (own ? ' is-own' : '') + (message.recalled ? ' is-recalled' : '') + '" data-message-id="' + esc(message.id) + '">' +
      (own ? '' : '<span class="dm-message-avatar">' + /* safe: avatar returns module-owned HTML */ avatar({ id: message.sender_id, name: message.sender_name }, true) + '</span>') +
      '<div><span class="dm-message-author">' + esc(own ? '我' : message.sender_name) + '</span>' +
      replyPreview(message, all) + (editing ? /* safe: editForm escapes its data */ editForm(message) : (message.text ? '<p>' + esc(message.text) + '</p>' : '')) + media + sticker +
      /* safe: card returns module-owned HTML and escapes card fields */ card(previewFromMessage(message)) +
      '<footer><time>' + esc(clockText(message.created_at)) + '</time>' + (message.edited_at && !message.recalled ? '<small>已编辑</small>' : '') +
      (message.recalled || editing ? '' : /* safe: messageActions escapes its data */ messageActions(message, own)) + '</footer></div></article>';
  }

  function messagesHTML(items, source) {
    var lastDay = '';
    return items.map(function (message) {
      var day = dateLabel(message.created_at);
      var divider = day !== lastDay ? '<div class="dm-day"><span>' + esc(day) + '</span></div>' : '';
      lastDay = day;
      return divider + messageHTML(message, source, items);
    }).join('');
  }

  function picker() {
    if (state.picker === 'emoji') {
      return '<div class="dm-picker" role="group" aria-label="选择表情">' + ['🙂', '👍', '🐼', '✨', '🤝', '💡'].map(function (emoji) {
        return '<button type="button" data-dm-act="emoji" data-value="' + emoji + '">' + emoji + '</button>';
      }).join('') + '</div>';
    }
    if (state.picker === 'sticker') {
      return '<div class="dm-picker dm-sticker-picker" role="group" aria-label="选择熊猫贴纸">' + STICKERS.map(function (item) {
        return '<button type="button" data-dm-act="sticker" data-value="' + esc(item[0]) + '" aria-label="' + esc(item[1]) + '"><img src="' + safeUrl(item[0]) + '" alt=""></button>';
      }).join('') + '</div>';
    }
    return '';
  }

  function composer(thread) {
    if (thread.blocked) return '<div class="dm-blocked"><span>' + /* safe: shared icon helper */ icon('lock') + '</span><p>已停止接收对方的消息。</p></div>';
    if (thread.request_state === 'pending' && thread.request_recipient_id) return '';
    return '<form class="dm-composer" data-dm-form><div class="dm-compose-tools">' +
      '<button type="button" class="button ghost icon-only" data-dm-act="toggle-picker" data-value="emoji" aria-label="表情">' + /* safe: shared icon helper */ icon('smile') + '</button>' +
      '<button type="button" class="button ghost icon-only" data-dm-act="toggle-picker" data-value="sticker" aria-label="熊猫贴纸">🐼</button>' +
      '<label class="button ghost icon-only" aria-label="添加图片">' + /* safe: shared icon helper */ icon('image') + '<input type="file" accept="image/*" data-dm-image></label></div>' +
      /* safe: picker returns module-owned controls */ picker() +
      (state.imageName ? '<div class="dm-image-chip"><span>' + /* safe: shared icon helper */ icon('image') + '</span>' + esc(state.imageName) + '<button type="button" data-dm-act="clear-image" aria-label="移除图片">×</button></div>' : '') +
      '<label><span class="sr-only">输入消息</span><textarea name="message" rows="1" maxlength="4000" placeholder="写消息…">' + esc(state.drafts[thread.id] || '') + '</textarea></label>' +
      '<button class="button primary icon-only" type="submit" aria-label="发送">' + /* safe: shared icon helper */ icon('send') + '</button></form>';
  }

  function requestBar(thread, source) {
    if (thread.request_state !== 'pending' || thread.request_recipient_id !== source.me.id) return '';
    return '<div class="dm-request-bar"><div><strong>消息请求</strong><span>接受后才能继续对话</span></div>' +
      '<button class="button ghost" type="button" data-dm-act="decline" data-id="' + esc(thread.id) + '">忽略</button>' +
      '<button class="button primary" type="button" data-dm-act="accept" data-id="' + esc(thread.id) + '">接受</button></div>';
  }

  function emptyConversation() {
    return '<section class="dm-conversation dm-welcome"><img src="assets/mascot/panda-main-front-1024.webp" alt="">' +
      '<h2>选一个会话</h2><p>消息会留在参与者之间。</p></section>';
  }

  function conversation(source, id) {
    var thread = source.threads.find(function (item) { return item.id === id; });
    if (!thread) return emptyConversation();
    var items = source.messages[id] || [];
    var person = other(thread, source.me);
    return '<section class="dm-conversation" aria-label="与' + esc(threadTitle(thread, source.me)) + '的对话"><header class="dm-conversation-head">' +
      '<button class="button ghost icon-only dm-back" type="button" data-dm-act="back" aria-label="返回会话列表">' + /* safe: shared icon helper */ icon('back') + '</button>' +
      '<span class="dm-head-avatar">' + /* safe: avatar returns module-owned HTML */ avatar(person, true) + '</span><div><h2>' +
      (thread.kind === 'group' ? esc(threadTitle(thread, source.me)) : /* safe: personLink returns escaped or CommonsLinks-owned HTML */ personLink(person.handle, threadTitle(thread, source.me), person.level)) + '</h2>' +
      '<span>' + (thread.kind === 'group' ? (thread.participants.length + ' 位成员') : thread.blocked ? '已拉黑' : person.online ? '在线' : '最近有空') + '</span></div>' +
      '<div class="dm-head-actions"><button class="button ghost icon-only" type="button" data-dm-act="pin" data-id="' + esc(thread.id) + '" aria-label="' + (thread.pinned ? '取消置顶' : '置顶') + '">' + /* safe: shared icon helper */ icon('pin') + '</button>' +
      '<button class="button ghost icon-only" type="button" data-dm-act="mute" data-id="' + esc(thread.id) + '" aria-label="' + (thread.muted ? '取消静音' : '静音') + '">' + /* safe: shared icon helper */ icon('mute') + '</button></div></header>' +
      (thread.ref ? '<div class="dm-thread-ref">' + /* safe: card returns module-owned HTML */ card(thread.ref) + '</div>' : '') +
      '<div class="dm-messages" role="log" aria-live="polite" aria-relevant="additions" aria-label="消息记录">' + (items.length ? messagesHTML(items, source) : '<div class="dm-empty"><p>发出第一条消息。</p></div>') + '</div>' +
      '<div class="dm-live-status" role="status" aria-live="polite">' + (state.typing ? '正在输入…' : '') + '</div>' +
      (state.sendError ? '<div class="dm-send-error" role="alert">' + esc(state.sendError) + '<button class="button ghost small" type="button" data-dm-act="retry-send">重试</button></div>' : '') +
      /* safe: requestBar and composer return module-owned controls */ requestBar(thread, source) + composer(thread) + '</section>';
  }

  function settingsPanel(source) {
    var active = source.settings.contact_policy || 'following';
    var options = [['everyone', '所有人'], ['following', '我关注的人'], ['friends', '好友'], ['closed', '关闭']];
    return '<section class="dm-settings"><header><button class="button ghost icon-only dm-back" type="button" data-dm-act="close-settings" aria-label="返回">' + /* safe: shared icon helper */ icon('back') + '</button><div><h2>私信设置</h2><span>谁能联系我</span></div></header><div class="dm-setting-list">' + options.map(function (item) {
      return '<label><span><strong>' + esc(item[1]) + '</strong></span><input type="radio" name="dm-policy" value="' + esc(item[0]) + '"' + (active === item[0] ? ' checked' : '') + '><i aria-hidden="true"></i></label>';
    }).join('') + '</div></section>';
  }

  function body() {
    if (isLive() && !state.live && !state.error) return '<div class="dm-status"><span class="button-spinner" aria-hidden="true"></span><p>正在打开私信…</p></div>';
    if (state.error === 'closed' && isLive()) return '<div class="dm-status" role="status"><h2>这个功能还没开放</h2><p>管理员还没打开。</p></div>';
    if (state.error && isLive()) return '<div class="dm-status"><h2>私信没能打开</h2><p>原数据没有变化。</p><button class="button" type="button" data-dm-act="retry">重试</button></div>';
    var source = data() || clone(sample());
    var selected = routeId();
    return threadList(source, selected) + (state.settings ? settingsPanel(source) : conversation(source, selected));
  }

  function view() {
    return '<main class="dm-page' + (routeId() || state.settings ? ' is-detail' : '') + '" data-dm-root>' + body() + '</main>';
  }

  function focusKey(node) {
    if (!node || !node.getAttribute) return null;
    if (node.name === 'message') return { name: 'message' };
    var act = node.getAttribute('data-dm-act');
    if (act) return { act: act, id: node.getAttribute('data-id') || '', value: node.getAttribute('data-value') || '' };
    return null;
  }

  function restoreFocus(key) {
    if (!key || !state.root) return;
    var selector = key.name ? '[name="' + key.name + '"]' : '[data-dm-act="' + key.act + '"]';
    var nodes = state.root.querySelectorAll(selector);
    var next = Array.prototype.find.call(nodes, function (node) {
      return (!key.id || node.getAttribute('data-id') === key.id) && (!key.value || node.getAttribute('data-value') === key.value);
    });
    if (next && next.focus) {
      next.focus({ preventScroll: true });
      if (key.name && typeof next.setSelectionRange === 'function') next.setSelectionRange(next.value.length, next.value.length);
    }
  }

  function rerender(preferred) {
    if (!state.root) return;
    var active = document.activeElement;
    if (active && active.name === 'message' && routeId()) state.drafts[routeId()] = active.value;
    var keep = preferred || focusKey(active);
    state.root.className = 'dm-page' + (routeId() || state.settings ? ' is-detail' : '');
    state.root.innerHTML = /* safe: body escapes all external/sample data */ body();
    var messages = state.root.querySelector('.dm-messages');
    if (messages) messages.scrollTop = messages.scrollHeight;
    restoreFocus(keep);
  }

  function toast(message) {
    if (window.Commons && window.Commons.toast) window.Commons.toast(message);
  }

  function updateThread(id, fn) {
    var source = read();
    var thread = source.threads.find(function (item) { return item.id === id; });
    if (!thread) return;
    fn(thread, source);
    write(source);
    rerender();
  }

  function deleteMessage(id) {
    var source = read();
    Object.keys(source.messages).some(function (threadId) {
      var index = source.messages[threadId].findIndex(function (item) { return item.id === id; });
      if (index < 0) return false;
      source.messages[threadId].splice(index, 1);
      return true;
    });
    write(source);
    rerender();
  }

  function recallMessage(id) {
    var source = read();
    Object.keys(source.messages).some(function (threadId) {
      var item = source.messages[threadId].find(function (message) { return message.id === id; });
      if (!item) return false;
      item.text = '一条消息已撤回'; item.recalled = true; item.image_ref = null; item.sticker_ref = null; item.ref = null;
      return true;
    });
    write(source);
    rerender();
  }

  function appendMessage(threadId, message) {
    var source = read();
    source.messages[threadId] = source.messages[threadId] || [];
    source.messages[threadId].push(message);
    var thread = source.threads.find(function (item) { return item.id === threadId; });
    if (thread) {
      thread.last_message = { text: message.text || (message.sticker_ref ? '熊猫贴纸' : '图片'), created_at: message.created_at };
      thread.updated_at = message.created_at; thread.unread = 0;
    }
    write(source);
    rerender();
  }

  function simulateReply(threadId) {
    state.typing = true;
    rerender();
    var timer = setTimeout(function () {
      state.typing = false;
      var source = read();
      var thread = source.threads.find(function (item) { return item.id === threadId; });
      var person = thread ? other(thread, source.me) : { id: 'peer', name: '对方' };
      appendMessage(threadId, { id: 'demo-reply-' + Date.now(), sender_id: person.id, sender_name: person.name,
        text: '收到，我晚一点把细节补上。', created_at: new Date().toISOString() });
    }, 1100);
    state.timers.push(timer);
  }

  function sendDemo(text) {
    var id = routeId();
    if (!id || (!text && !state.imageName)) return;
    appendMessage(id, { id: 'demo-' + Date.now(), sender_id: 'local-self', sender_name: '我', text: text,
      image_ref: state.imageName ? 'assets/local-image-placeholder' : null, image_name: state.imageName,
      created_at: new Date().toISOString() });
    state.drafts[id] = '';
    state.imageName = '';
    simulateReply(id);
  }

  function sendLive(text) {
    var api = window.CommonsAPI;
    if (!api || !routeId()) return;
    var threadId = routeId();
    state.loading = true;
    state.sendError = '';
    api.post('/dm/threads/' + encodeURIComponent(routeId()) + '/messages', { text: text }, writeOpts()).then(function (payload) {
      state.loading = false;
      state.drafts[threadId] = '';
      if (state.live) {
        var item = payload && payload.data ? payload.data : payload;
        var created = {
          text: (item && item.text) || text,
          created_at: (item && item.created_at) || new Date().toISOString(),
          sticker_ref: item && item.sticker_ref,
          image_ref: item && item.image_ref
        };
        var thread = (state.live.threads || []).find(function (row) { return row.id === threadId; });
        if (thread) {
          thread.last_message = { text: lastMessageText(created) || text, created_at: created.created_at };
          thread.updated_at = created.created_at;
        }
        patchThreadPreview(state.live, threadId);
      }
      refreshLive(true);
    }).catch(function (error) {
      state.loading = false;
      state.sendError = error && error.message || '消息没有发出。';
      rerender({ name: 'message' });
    });
  }

  function onSubmit(event) {
    var editForm = event.target.closest && event.target.closest('[data-dm-edit-form]');
    if (editForm) { event.preventDefault(); saveEdit(editForm); return; }
    var form = event.target.closest('[data-dm-form]');
    if (!form) return;
    event.preventDefault();
    var field = form.elements.message;
    var text = String(field.value || '').trim();
    if (!text && !state.imageName) return;
    if (isLive()) sendLive(text); else sendDemo(text);
    if (!isLive()) field.value = '';
  }

  function onInput(event) {
    if (event.target && event.target.name === 'message' && routeId()) {
      state.drafts[routeId()] = event.target.value;
    }
    if (event.target && event.target.name === 'edit') state.editDraft = event.target.value;
  }

  /* 失败重试复用同一个幂等键，成功后清掉 */
  function keyFor(sig) {
    if (!state.keys[sig]) state.keys[sig] = window.CommonsAPI.newIdempotencyKey();
    return state.keys[sig];
  }

  function findMessage(id) {
    var bag = (state.live && state.live.messages) || {};
    var found = null;
    Object.keys(bag).forEach(function (threadId) {
      (bag[threadId] || []).forEach(function (item) { if (item.id === id) found = item; });
    });
    return found;
  }

  function startEdit(id) {
    var message = findMessage(id);
    if (!message) return;
    state.editing = id; state.editDraft = message.text || ''; state.editError = ''; state.reporting = '';
    rerender();
    var field = state.root && state.root.querySelector('[name="edit"]');
    if (field && field.focus) field.focus();
  }

  function saveEdit(form) {
    var id = state.editing;
    var message = findMessage(id);
    if (!id || !message || !window.CommonsAPI) return;
    var field = form.elements && form.elements.edit;
    var text = String(field ? field.value : state.editDraft).trim();
    if (!text) { state.editError = '内容不能为空。'; rerender(); return; }
    if (text === message.text) { state.editing = ''; state.editError = ''; rerender(); return; }
    var sig = 'edit:' + id + ':' + text;
    window.CommonsAPI.patch('/dm/messages/' + encodeURIComponent(id), { text: text }, { idempotencyKey: keyFor(sig) }).then(function (response) {
      delete state.keys[sig];
      var item = response && response.data ? response.data : response;
      if (item) { message.text = item.text; message.edited_at = item.edited_at; }
      state.editing = ''; state.editError = ''; state.editDraft = '';
      rerender();
      refreshLive(true);
    }).catch(function (error) {
      state.editDraft = text;
      state.editError = liveError(error, '没有改成。原内容还在，可以再试一次。');
      rerender();
    });
  }

  function onFocus(event) {
    if (!event.target || event.target.name !== 'message') return;
    state.composing = event.type === 'focusin';
  }

  function onChange(event) {
    if (event.target.matches('[data-dm-image]')) {
      state.imageName = event.target.files && event.target.files[0] ? event.target.files[0].name : '';
      rerender();
      return;
    }
    if (event.target.name === 'dm-policy') {
      var value = event.target.value;
      if (isLive() && window.CommonsAPI) {
        window.CommonsAPI.put('/dm/settings', { contact_policy: value }, writeOpts()).then(refreshLive).catch(function (error) {
          state.error = error && error.message || '设置没有保存。'; rerender();
        });
      } else {
        var source = read(); source.settings.contact_policy = value; write(source); rerender();
      }
    }
  }

  function decide(id, accepted) {
    if (isLive() && window.CommonsAPI) {
      window.CommonsAPI.post('/dm/requests/' + encodeURIComponent(id) + '/' + (accepted ? 'accept' : 'decline'), {}, writeOpts())
        .then(refreshLive).catch(function (error) { state.error = error && error.message || '请求没有处理。'; rerender(); });
      return;
    }
    updateThread(id, function (thread) {
      thread.request_state = accepted ? 'accepted' : 'declined'; thread.request_recipient_id = null;
    });
    if (!accepted) location.hash = '#/messages';
  }

  function onClick(event) {
    var button = event.target.closest('[data-dm-act]');
    if (!button) return;
    var action = button.dataset.dmAct;
    var id = button.dataset.id || '';
    if (action === 'back') { location.hash = '#/messages'; return; }
    if (action === 'filter') { state.filter = button.dataset.value; state.settings = false; location.hash = '#/messages'; rerender(); return; }
    if (action === 'settings') { state.settings = true; rerender(); return; }
    if (action === 'close-settings') { state.settings = false; rerender(); return; }
    if (action === 'pin') {
      if (isLive() && window.CommonsAPI) {
        var thread = (data().threads || []).find(function (item) { return item.id === id; });
        var nextPin = !(thread && thread.pinned);
        window.CommonsAPI.put('/dm/threads/' + encodeURIComponent(id) + '/preference', { pinned: nextPin }, writeOpts())
          .then(refreshLive).catch(function (error) { toast(liveError(error, '置顶没有改成。')); });
        return;
      }
      updateThread(id, function (thread) { thread.pinned = !thread.pinned; }); return;
    }
    if (action === 'mute') {
      if (isLive() && window.CommonsAPI) {
        var muteThread = (data().threads || []).find(function (item) { return item.id === id; });
        var nextMute = !(muteThread && muteThread.muted);
        window.CommonsAPI.put('/dm/threads/' + encodeURIComponent(id) + '/preference', { muted: nextMute }, writeOpts())
          .then(refreshLive).catch(function (error) { toast(liveError(error, '静音没有改成。')); });
        return;
      }
      updateThread(id, function (thread) { thread.muted = !thread.muted; }); return;
    }
    if (action === 'accept') { decide(id, true); return; }
    if (action === 'decline') { decide(id, false); return; }
    if (action === 'toggle-picker') { state.picker = state.picker === button.dataset.value ? '' : button.dataset.value; rerender(); return; }
    if (action === 'emoji') {
      var input = state.root.querySelector('[name="message"]'); if (input) { input.value += button.dataset.value; input.focus(); }
      state.picker = ''; return;
    }
    if (action === 'sticker') {
      if (isLive() && window.CommonsAPI) {
        window.CommonsAPI.post('/dm/threads/' + encodeURIComponent(routeId()) + '/messages', {
          text: '', sticker_ref: button.dataset.value
        }, writeOpts()).then(function () {
          state.picker = '';
          refreshLive(true);
        }).catch(function (error) { toast(liveError(error, '贴纸没有发出。')); });
        return;
      }
      appendMessage(routeId(), { id: 'sticker-' + Date.now(), sender_id: 'local-self', sender_name: '我',
        sticker_ref: button.dataset.value, created_at: new Date().toISOString() });
      state.picker = ''; simulateReply(routeId()); return;
    }
    if (action === 'clear-image') { state.imageName = ''; rerender(); return; }
    if (action === 'edit' && isLive()) { startEdit(id); return; }
    if (action === 'edit-cancel') { state.editing = ''; state.editError = ''; rerender(); return; }
    if (action === 'report-cancel') { state.reporting = ''; rerender(); return; }
    if (action === 'report-send' && isLive() && window.CommonsAPI) {
      var reason = button.dataset.value || '';
      var sig = 'report:' + id + ':' + reason;
      window.CommonsAPI.post('/dm/messages/' + encodeURIComponent(id) + '/report', { reason: reason }, { idempotencyKey: keyFor(sig) })
        .then(function () { delete state.keys[sig]; state.reporting = ''; toast('举报已提交，只有这一条消息会交给治理。'); rerender(); })
        .catch(function (error) { toast(liveError(error, '举报没有提交。')); });
      return;
    }
    if (action === 'recall') {
      if (isLive() && window.CommonsAPI) {
        window.CommonsAPI.post('/dm/messages/' + encodeURIComponent(id) + '/recall', {}, writeOpts())
          .then(function () { toast('消息已撤回。'); refreshLive(true); })
          .catch(function (error) { toast(liveError(error, '撤回没有成功。原消息还在。')); });
        return;
      }
      recallMessage(id); toast('消息已撤回。'); return;
    }
    if (action === 'delete') {
      if (isLive() && window.CommonsAPI) {
        window.CommonsAPI.post('/dm/messages/' + encodeURIComponent(id) + '/delete', {}, writeOpts())
          .then(function () { toast('只从你的会话里删除。'); refreshLive(true); })
          .catch(function (error) { toast(liveError(error, '删除没有成功。原消息还在。')); });
        return;
      }
      deleteMessage(id); toast('只从你的会话里删除。'); return;
    }
    if (action === 'report') {
      if (isLive() && window.CommonsAPI) { state.reporting = id; state.editing = ''; rerender(); return; }
      toast('举报已提交，只有这一条消息会交给治理。'); return;
    }
    if (action === 'retry-send') { sendLive(state.drafts[routeId()] || ''); return; }
    if (action === 'retry') { state.error = null; refreshLive(); }
  }

  function mapLive(threadsPayload, settingsPayload, mePayload, messagesPayload) {
    var base = state.live || { me: {}, settings: {}, threads: [], messages: {} };
    base.me = {
      id: mePayload.id,
      name: mePayload.display_name || mePayload.handle || '我',
      avatar: mePayload.avatar_ref || ''
    };
    base.settings = settingsPayload || { contact_policy: 'following' };
    base.threads = (threadsPayload.items || []).map(function (thread) {
      thread.participants = (thread.participants || []).map(function (person) {
        person.avatar = person.avatar || person.avatar_ref || '';
        return person;
      });
      return thread;
    });
    if (messagesPayload && routeId()) base.messages[routeId()] = messagesPayload.items || [];
    if (routeId()) applyLastMessage(base, routeId());
    return base;
  }

  function lastMessageText(message) {
    if (!message) return '';
    if (message.text) return message.text;
    if (message.sticker_ref) return '熊猫贴纸';
    if (message.image_ref || message.image_name) return '图片';
    return '';
  }

  function applyLastMessage(source, threadId) {
    var list = source.messages && source.messages[threadId];
    var last = list && list.length ? list[list.length - 1] : null;
    var thread = (source.threads || []).find(function (item) { return item.id === threadId; });
    if (!thread || !last) return thread;
    thread.last_message = { text: lastMessageText(last), created_at: last.created_at };
    thread.updated_at = last.created_at || thread.updated_at;
    return thread;
  }

  function patchThreadPreview(source, threadId) {
    if (!state.root || !threadId) return;
    var thread = (source.threads || []).find(function (item) { return item.id === threadId; });
    if (!thread) return;
    var current = state.root.querySelector('.dm-thread-row.is-selected');
    if (!current) {
      var href = '#/messages/' + threadId;
      var rows = state.root.querySelectorAll('.dm-thread-row');
      for (var i = 0; i < rows.length; i++) {
        if (rows[i].getAttribute && rows[i].getAttribute('href') === href) { current = rows[i]; break; }
      }
    }
    if (!current || !current.replaceWith) return;
    var holder = document.createElement('div');
    holder.innerHTML = /* safe: threadRow escapes names and preview text */ threadRow(thread, source, true);
    if (holder.firstElementChild) current.replaceWith(holder.firstElementChild);
  }

  function patchLiveMessages(before, after, source) {
    if (!state.root || !routeId()) return;
    var known = {};
    (before || []).forEach(function (message) { known[message.id] = message; });
    var changed = (after || []).some(function (message) {
      var old = known[message.id];
      return old && (!!old.recalled !== !!message.recalled || (old.edited_at || '') !== (message.edited_at || '') || old.text !== message.text);
    });
    if (changed && !state.editing) { rerender(); return; }
    var log = state.root.querySelector('.dm-messages');
    if (!log) return;
    var additions = (after || []).filter(function (message) { return !known[message.id]; });
    if (!additions.length) return;
    var empty = log.querySelector('.dm-empty');
    if (empty) empty.remove();
    var last = before && before.length ? dateLabel(before[before.length - 1].created_at) : '';
    additions.forEach(function (message) {
      var day = dateLabel(message.created_at);
      var holder = document.createElement('div');
      holder.innerHTML = /* safe: messageHTML escapes message data */ (day !== last ? '<div class="dm-day"><span>' + esc(day) + '</span></div>' : '') + messageHTML(message, source, after);
      while (holder.firstChild) log.appendChild(holder.firstChild);
      last = day;
    });
    log.scrollTop = log.scrollHeight;
  }

  function refreshLive(force) {
    if (!isLive()) return;
    if (state.composing && !force) return;
    var api = window.CommonsAPI;
    if (!api) { state.error = '没有接上接口。'; rerender(); return; }
    var seq = ++state.seq;
    var hadLive = !!state.live;
    var activeThread = routeId();
    var before = hadLive && activeThread && state.live.messages[activeThread] ? state.live.messages[activeThread].slice() : [];
    state.loading = !state.live; state.error = null;
    var calls = [api.get('/dm/threads'), api.get('/dm/settings'), api.me()];
    if (routeId()) calls.push(api.get('/dm/threads/' + encodeURIComponent(routeId()) + '/messages'));
    Promise.all(calls).then(function (pair) {
      if (seq !== state.seq) return;
      var threadsPayload = pair[0] && pair[0].data ? pair[0].data : pair[0];
      var settingsPayload = pair[1] && pair[1].data ? pair[1].data : pair[1];
      var mePayload = pair[2] && pair[2].data ? pair[2].data : pair[2];
      var messagesPayload = pair[3] && pair[3].data ? pair[3].data : pair[3];
      state.live = mapLive(threadsPayload || { items: [] }, settingsPayload || {}, mePayload || {}, messagesPayload);
      state.loading = false;
      state.sendError = '';
      if (hadLive && state.root && activeThread === routeId()) {
        patchLiveMessages(before, state.live.messages[activeThread] || [], state.live);
        patchThreadPreview(state.live, activeThread);
        var field = state.root.querySelector('[name="message"]');
        if (field && !state.drafts[activeThread]) field.value = '';
      } else rerender();
      if (routeId()) markReadLive(routeId(), state.live.messages[routeId()] || []);
      refreshUnread();
      refreshBadge();
    }).catch(function (error) {
      if (seq !== state.seq) return;
      state.loading = false; state.error = (error && (error.status === 501 || error.code === 'capability_unavailable')) ? 'closed' : (error && error.message || '私信没能打开。'); rerender();
    });
  }

  function open(options) {
    options = options || {};
    if (isLive() && window.CommonsAPI) {
      return window.CommonsAPI.post('/dm/threads', { with: options.with, ref: options.ref || null }, writeOpts()).then(function (payload) {
        var item = payload && payload.data ? payload.data : payload;
        location.hash = '#/messages/' + encodeURIComponent(item.id);
        return item;
      });
    }
    var source = read();
    var peerId = typeof options.with === 'string' ? options.with : options.with && options.with.id;
    var found = source.threads.find(function (thread) {
      return (thread.participants || []).some(function (person) { return person.id === peerId; });
    });
    if (!found) {
      found = { id: 'dm-new-' + Date.now(), kind: 'direct', title: options.name || '新会话', pinned: false,
        muted: false, unread: 0, request_state: 'accepted', updated_at: new Date().toISOString(), ref: options.ref || null,
        participants: [source.me, { id: peerId || 'new-peer', name: options.name || '新成员',
          avatar: 'assets/mascot/panda-avatar-classic-512.webp' }], last_message: null };
      source.threads.unshift(found); source.messages[found.id] = []; write(source);
    }
    location.hash = '#/messages/' + found.id;
    return Promise.resolve(found);
  }

  function on(target, type, fn) {
    target.addEventListener(type, fn);
    state.unbind.push(function () { target.removeEventListener(type, fn); });
  }

  function mount() {
    var root = document.querySelector('[data-dm-root]');
    if (!root) return;
    destroy();
    state.root = root;
    if (routeId() && state.settings) { state.settings = false; rerender(); }
    on(root, 'click', onClick);
    on(root, 'submit', onSubmit);
    on(root, 'change', onChange);
    on(root, 'input', onInput);
    on(root, 'focusin', onFocus);
    on(root, 'focusout', onFocus);
    if (isLive() && window.CommonsMention && typeof window.CommonsMention.attach === 'function') {
      state.unbind.push(window.CommonsMention.attach(root, { selector: 'textarea[name="message"]', kinds: 'human' }));
    }
    var messages = root.querySelector('.dm-messages');
    if (messages) messages.scrollTop = messages.scrollHeight;
    if (isLive()) {
      refreshLive(true);
      state.poll = setInterval(refreshLive, 15000);
    }
  }

  function destroy() {
    state.unbind.forEach(function (unbind) { unbind(); });
    state.unbind = [];
    state.timers.forEach(clearTimeout); state.timers = [];
    if (state.poll) clearInterval(state.poll);
    state.poll = null; state.typing = false; state.composing = false; state.root = null;
  }

  window.CommonsDM = {
    routes: { messages: view },
    hub: ['messages'],
    nav: [['messages', '私信', 'chat', 'personal']],
    badge: badge,
    open: open,
    mount: mount,
    destroy: destroy
  };
  (window.CommonsPages = window.CommonsPages || []).push(window.CommonsDM);
})();
