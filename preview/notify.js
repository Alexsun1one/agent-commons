/* R13 NOTIF-1 · 通知铃铛、收件箱与本机偏好。 */
(function () {
  'use strict';

  var STORE = 'notify.demo.v1';
  var CATEGORIES = [
    ['all', '全部'], ['reply', '回复我'], ['mention', '提到我'], ['reward', '采纳和奖励'],
    ['achievement', '等级和成就'], ['room', '房间和讲堂'], ['agent', 'Agent'],
    ['governance', '治理结果'], ['system', '系统'],
    ['park', '乐园'], ['event', '活动'], ['bounty', '悬赏'], ['market', '市集'],
    ['dm', '私信'], ['announce', '公告'], ['social_follow', '新关注'],
    ['social_poke', '戳一戳'], ['social_reaction', '动态反应'], ['social_share', '动态转发'],
    ['social_join_request', '入组申请'], ['social_join_approved', '申请结果']
  ];
  var DETAILS = {
    reply: '讨论和问题下的新回复', mention: '广场里被点名或被回复',
    reward: '问题验证与旧的奖励通知', achievement: '等级变化与复核',
    room: '房间移出、转交与讲堂提醒', agent: 'Agent 动态',
    governance: '举报、申诉与处置结果', system: '维护与每日汇总',
    park: '默认开启，同类 30 分钟合并成一条', event: '开始提醒、打榜名次与获奖',
    bounty: '新回答、被采纳与到期退回', market: '有人回应你的帖子',
    dm: '只记条数，不含正文', announce: '重要公告',
    social_follow: '成员关注你', social_poke: '成员戳了你一下',
    social_reaction: '成员回应你的动态', social_share: '成员转发你的动态',
    social_join_request: '管理的小组有新申请', social_join_approved: '申请有了结果'
  };
  var ICONS = {
    bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4',
    reply: 'M4 5h16v11H8l-4 4V5', mention: 'M16 8v5a4 4 0 1 1-2-3.46V12a4 4 0 1 1-2.7-3.78',
    reward: 'M12 3v18M7 8.5C7 6.6 8.8 5 12 5s5 1.4 5 3.5-2 3-5 3-5 1.1-5 3S7 21 12 21s5-1.6 5-3.5',
    achievement: 'm12 3 2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4-3.9-3.8 5.4-.8L12 3',
    room: 'M4 5h16v11H8l-4 4V5M8 9h8M8 12h5', agent: 'M8 10h8v7H8zM12 6v4M9 14h.01M15 14h.01',
    governance: 'M12 3 19 6v5c0 4.8-3 8-7 10-4-2-7-5.2-7-10V6l7-3M9 12l2 2 4-5',
    system: 'M12 8v4l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18',
    park: 'M12 3c3 4 6 7 6 11a6 6 0 1 1-12 0c0-4 3-7 6-11M8 14h8',
    event: 'M5 8h14v12H5zM8 4v4M16 4v4M5 12h14',
    bounty: 'M8 7V5h8v2M5 7h14v12H5zM12 11v5M9 14h6',
    market: 'M6 9h12l-1 10H7L6 9M9 9V7a3 3 0 0 1 6 0v2',
    dm: 'M4 6h16v12H4zM4 6l8 7 8-7',
    announce: 'M6 9v6h4l6 3V6L10 9H6M16 10h2'
  };
  var state = { filter: 'all', panelFilter: 'all', view: 'inbox', open: false, live: null, liveError: '', liveLoading: false, liveRequest: 0, account: '' };

  function isLive() {
    return !!(window.CommonsAPI && window.CommonsAPI.mode === 'live');
  }

  function sessionAccount() {
    var me = window.CommonsSession && window.CommonsSession.me;
    return me ? String(me.id || me.handle || '') : '';
  }

  function resetLiveAccount() {
    state.liveRequest += 1;
    state.live = null;
    state.liveError = '';
    state.liveLoading = false;
  }

  function onSessionChange() {
    var next = sessionAccount();
    if (next === state.account) return;
    state.account = next;
    resetLiveAccount();
    if (isLive() && bound) loadLive();
    else refreshBell();
  }

  window.addEventListener('commons:session', onSessionChange);
  var ICON_ALIAS = { social_follow: 'mention', social_poke: 'mention', social_reaction: 'reply', social_share: 'reply', social_join_request: 'room', social_join_approved: 'room' };
  var bound = false;

  function esc(value) {
    return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function read() {
    if (isLive()) return state.live || { items: [], preferences: { categories: {} } };
    var sample = window.COMMONS_NOTIFY_SAMPLE || { items: [], preferences: { categories: {} } };
    var saved = window.Commons && window.Commons.read ? window.Commons.read(STORE, null) : null;
    if (!saved || !Array.isArray(saved.items) || !saved.preferences) {
      saved = JSON.parse(JSON.stringify(sample));
    }
    return saved;
  }

  function write(data) {
    if (isLive()) return false;
    return !!(window.Commons && window.Commons.write && window.Commons.write(STORE, data));
  }

  function icon(name, size, localOnly) {
    name = ICON_ALIAS[name] || name;
    var shared = !localOnly && window.CommonsIcons && window.CommonsIcons.svg ? window.CommonsIcons.svg(name, { size: size || 18 }) : '';
    if (shared) return shared;
    var path = ICONS[name] || ICONS.bell;
    return '<svg viewBox="0 0 24 24" width="' + /* safe: size is a local numeric icon constant */ (size || 18) + '" height="' + /* safe: size is a local numeric icon constant */ (size || 18) + '" aria-hidden="true"><path d="' + path + '" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }

  function unread(data) {
    return data.items.reduce(function (sum, item) { return sum + (item.read_at ? 0 : 1); }, 0);
  }

  function relativeTime(value) {
    var then = new Date(value).getTime();
    var now = Date.now();
    var minutes = Math.max(0, Math.floor((now - then) / 60000));
    if (minutes < 1) return '刚刚';
    if (minutes < 60) return minutes + ' 分钟前';
    var hours = Math.floor(minutes / 60);
    if (hours < 24) return hours + ' 小时前';
    return Math.floor(hours / 24) + ' 天前';
  }

  function avatar(person) {
    if (window.CommonsAvatar && window.CommonsAvatar.html) {
      return window.CommonsAvatar.html({ id: person.id, name: person.name, size: 32 });
    }
    return '<span class="notify-fallback-avatar" aria-hidden="true">' + esc((person.name || '?').charAt(0)) + '</span>';
  }

  function people(item) {
    var actors = item.actors || [];
    if (!actors.length) return '<span class="notify-system-avatar" data-notify-category="' + esc(item.category) + '" aria-hidden="true">' + icon(item.category, 16, true) + '</span>';
    if (actors.length === 1) return avatar(actors[0]);
    if (window.CommonsAvatar && window.CommonsAvatar.stack) return window.CommonsAvatar.stack(actors, { max: 3 });
    return avatar(actors[0]);
  }

  function categoryLabel(id) {
    var row = CATEGORIES.find(function (item) { return item[0] === id; });
    return row ? row[1] : '通知';
  }

  /* safe-fn: CommonsLinks.person 自行转义；降级分支只输出转义后的姓名。 */
  function personLink(handle, name, level) {
    if (window.CommonsLinks && typeof window.CommonsLinks.person === 'function') {
      return window.CommonsLinks.person(handle, name, { level: level });
    }
    return handle ? '<a class="lk-person" href="#/u/' + encodeURIComponent(handle) + '">' + esc(name) + '</a>' : esc(name);
  }

  function targetHref(item) {
    var target = item.target || {};
    if (target.kind && target.id && window.CommonsLinks && typeof window.CommonsLinks.href === 'function') {
      var shared = window.CommonsLinks.href(target.kind, target.id);
      if (shared) return shared;
    }
    return item.link || '';
  }

  function actorLinks(item) {
    var actors = item.actors || [];
    if (!actors.length) return '';
    return '<span class="notify-item-actors">发起人 · ' + actors.map(function (actor) {
      return /* safe: personLink returns escaped or CommonsLinks-owned HTML */ personLink(actor.handle, actor.name, actor.level);
    }).join('、') + '</span>';
  }

  function itemHTML(item, compact) {
    var href = targetHref(item);
    var copy = '<span class="notify-item-line"><strong>' + esc(item.title) + '</strong><time>' + esc(relativeTime(item.occurred_at)) + '</time></span>' +
      '<span class="notify-item-body">' + esc(item.body) + '</span>' +
      (compact ? '' : '<span class="notify-item-meta"><span>' + esc(categoryLabel(item.category)) + '</span></span>');
    return '<article class="notify-item' + (item.read_at ? ' is-read' : ' is-unread') + (item.unavailable ? ' is-unavailable' : '') + '" data-notify-id="' + esc(item.id) + '">' +
      '<span class="notify-item-avatar">' + /* safe: people() returns module-owned avatar/icon HTML and escapes person data */ people(item) + '</span>' +
      '<span class="notify-item-copy">' + (href ? '<a class="notify-item-target" href="' + window.Commons.safeUrl(href) + '">' + copy + '</a>' : '<span class="notify-item-target" aria-disabled="true">' + copy + '</span>') +
      /* safe: actorLinks escapes actor data or delegates to CommonsLinks */ actorLinks(item) + '</span>' +
      (item.read_at ? '' : '<span class="notify-unread" aria-label="未读"></span>') + '</article>';
  }

  function tabs(active, scope) {
    var visible = scope === 'panel' ? CATEGORIES.slice(0, 4) : CATEGORIES;
    return '<div class="tabs notify-tabs" role="tablist" aria-label="通知分类">' + visible.map(function (row) {
      return '<button class="' + (active === row[0] ? 'selected' : '') + '" role="tab" aria-selected="' + (active === row[0]) + '" data-notify-action="filter" data-notify-scope="' + /* safe: scope is a local panel/page enum */ scope + '" data-value="' + row[0] + '">' + esc(row[1]) + '</button>';
    }).join('') + '</div>';
  }

  function filtered(data, filter) {
    return data.items.filter(function (item) { return filter === 'all' || item.category === filter; });
  }

  function emptyState() {
    return '<div class="notify-empty"><img src="assets/illus/empty-review.webp" alt="" width="160" height="160" loading="lazy" decoding="async"><h3>都处理完了</h3><p>新的回复、乐园和活动会出现在这里。</p></div>';
  }

  function bell() {
    var data = read();
    var count = unread(data);
    var items = filtered(data, state.panelFilter).slice(0, 5);
    return '<div class="notify-bell" data-notify-bell>' +
      '<button class="button ghost icon-only notify-bell-button" type="button" data-notify-action="toggle-panel" aria-label="通知，' + count + ' 条未读" aria-expanded="' + /* safe: state.open is boolean */ state.open + '">' + icon('bell', 18) + (count ? '<span class="notify-badge">' + (count > 99 ? '99+' : count) + '</span>' : '') + '</button>' +
      '<section class="notify-popover" aria-label="通知"' + (state.open ? '' : ' hidden') + '><header><div><h2>通知</h2></div><a class="button ghost small" href="#/notifications">查看全部</a></header>' +
      tabs(state.panelFilter, 'panel') + '<div class="notify-popover-list">' + (items.length ? items.map(function (item) { return itemHTML(item, true); }).join('') : emptyState()) + '</div>' +
      '<footer><button class="button ghost small" type="button" data-notify-action="read-all" data-notify-scope="panel">全部标为已读</button><a class="button ghost small" href="#/notifications" data-notify-action="view" data-value="settings">通知设置</a></footer></section></div>';
  }

  function categoryRail(data) {
    return '<aside class="notify-rail" aria-label="通知分类"><span class="notify-rail-title">分类</span>' + CATEGORIES.map(function (row) {
      var count = filtered(data, row[0]).filter(function (item) { return !item.read_at; }).length;
      return '<button class="' + (state.filter === row[0] ? 'selected' : '') + '" type="button" data-notify-action="filter" data-notify-scope="page" data-value="' + row[0] + '"><span>' + icon(row[0] === 'all' ? 'bell' : row[0], 16) + esc(row[1]) + '</span>' + (count ? '<b>' + count + '</b>' : '') + '</button>';
    }).join('') + '</aside>';
  }

  function inboxView(data) {
    var items = filtered(data, state.filter);
    return '<div class="notify-layout">' + categoryRail(data) + '<section class="notify-list-panel"><div class="notify-section-head"><div><h2>' + (state.filter === 'all' ? '最近通知' : esc(categoryLabel(state.filter))) + '</h2></div><button class="button ghost" type="button" data-notify-action="read-all">全部标为已读</button></div><div class="notify-list">' + (items.length ? items.map(function (item) { return itemHTML(item, false); }).join('') : emptyState()) + '</div></section></div>';
  }

  function toggleRow(key, label, detail, checked) {
    return '<label class="notify-pref-row"><span><strong>' + esc(label) + '</strong><small>' + esc(detail) + '</small></span><input type="checkbox" data-notify-pref="' + esc(key) + '"' + (checked ? ' checked' : '') + '><i aria-hidden="true"></i></label>';
  }

  function settingsView(data) {
    var prefs = data.preferences;
    return '<div class="notify-settings"><section><div class="notify-section-head"><div><h2>收到哪些通知</h2></div></div><div class="notify-pref-list">' + CATEGORIES.slice(1).map(function (row) {
      return toggleRow(row[0], row[1], DETAILS[row[0]] || '站内收件箱与铃铛', prefs.categories[row[0]] !== false);
    }).join('') + '</div></section><aside><div class="notify-setting-block"><h3>免打扰</h3><p>时段内的新通知延后显示，不会丢。</p><div class="notify-time-row"><label class="field"><span>开始</span><input type="time" data-notify-time="quiet_start" value="' + esc(prefs.quiet_start || '') + '"></label><label class="field"><span>结束</span><input type="time" data-notify-time="quiet_end" value="' + esc(prefs.quiet_end || '') + '"></label></div></div><div class="notify-setting-block">' + toggleRow('daily_digest', '每日汇总', '「昨天错过了什么」，只在站内', prefs.daily_digest !== false) + '</div><p class="notify-local-note">偏好只存在本机，不发邮件或外部消息。</p></aside></div>';
  }

  function body() {
    var data = read();
    return '<div class="notify-page-head"><span>乐园、活动与悬赏都在这里</span><div class="segmented" aria-label="通知视图"><button class="' + (state.view === 'inbox' ? 'selected' : '') + '" data-notify-action="view" data-value="inbox">收件箱</button><button class="' + (state.view === 'settings' ? 'selected' : '') + '" data-notify-action="view" data-value="settings">偏好设置</button></div>' + (isLive() ? '' : '<span class="pill outline">示例</span>') + '</div>' + (state.view === 'settings' ? settingsView(data) : inboxView(data));
  }

  function page() {
    if (isLive() && state.liveError) {
      if (state.liveError === 'closed') {
        return '<main class="notify-page" data-notify-root><div role="status"><p>这个功能还没开放</p><p>管理员还没打开。</p></div></main>';
      }
      return '<main class="notify-page" data-notify-root><div role="alert"><p>' + esc(state.liveError) + '</p><button type="button" class="button" data-notify-action="retry">重试</button></div></main>';
    }
    if (isLive() && !state.live) {
      return '<main class="notify-page" data-notify-root><p>正在读取通知…</p></main>';
    }
    return '<main class="notify-page" data-notify-root>' + body() + '</main>';
  }

  function refreshPage() {
    var root = document.querySelector('[data-notify-root]');
    if (root) root.innerHTML = body();
  }

  function refreshBell() {
    var current = document.querySelector('[data-notify-bell]');
    if (!current) return;
    var holder = document.createElement('div');
    holder.innerHTML = bell();
    current.replaceWith(holder.firstElementChild);
  }

  function writeOpts() {
    return { idempotencyKey: window.CommonsAPI && window.CommonsAPI.newIdempotencyKey() };
  }

  function liveError(error, fallback) {
    if (error && (error.status === 501 || error.code === 'capability_unavailable')) return '这个功能还没开放。管理员还没打开。';
    return (error && error.message) || fallback || '没有成功，原数据没有动，可以再试一次。';
  }

  function mark(id) {
    var data = read();
    var changed = false;
    var prev = [];
    data.items.forEach(function (item) {
      if (item.id === id && !item.read_at) {
        prev.push({ item: item, read_at: item.read_at });
        item.read_at = new Date().toISOString();
        changed = true;
      }
    });
    if (!changed) return;
    if (isLive()) {
      if (!window.CommonsAPI) return;
      refreshPage(); refreshBell();
      window.CommonsAPI.post('/notify/notifications/' + encodeURIComponent(id) + '/read', {}, writeOpts()).catch(function (error) {
        prev.forEach(function (row) { row.item.read_at = row.read_at; });
        refreshPage(); refreshBell();
        if (window.Commons && window.Commons.toast) window.Commons.toast(liveError(error, '标记已读没有成功。'));
      });
      return;
    }
    if (write(data)) { refreshPage(); refreshBell(); }
  }

  function markAll(scope) {
    var data = read();
    var active = scope === 'panel' ? state.panelFilter : state.filter;
    var prev = [];
    data.items.forEach(function (item) {
      if (!item.read_at && (active === 'all' || item.category === active)) {
        prev.push({ item: item, read_at: item.read_at });
        item.read_at = new Date().toISOString();
      }
    });
    if (isLive()) {
      if (!window.CommonsAPI) return;
      refreshPage(); refreshBell();
      window.CommonsAPI.post('/notify/notifications/read-all', { category: active === 'all' ? null : active }, writeOpts()).catch(function (error) {
        prev.forEach(function (row) { row.item.read_at = row.read_at; });
        refreshPage(); refreshBell();
        if (window.Commons && window.Commons.toast) window.Commons.toast(liveError(error, '全部已读没有成功。'));
      });
      return;
    }
    if (write(data)) { refreshPage(); refreshBell(); }
  }

  function onClick(event) {
    var action = event.target.closest('[data-notify-action]');
    if (!action) {
      if (state.open && !event.target.closest('[data-notify-bell]')) { state.open = false; refreshBell(); }
      return;
    }
    var type = action.dataset.notifyAction;
    if (type === 'toggle-panel') { state.open = !state.open; refreshBell(); return; }
    if (type === 'filter') {
      if (action.dataset.notifyScope === 'panel') state.panelFilter = action.dataset.value;
      else state.filter = action.dataset.value;
      if (action.dataset.notifyScope === 'panel') refreshBell(); else refreshPage();
      return;
    }
    if (type === 'view') { state.view = action.dataset.value; refreshPage(); return; }
    if (type === 'read-all') { markAll(action.dataset.notifyScope); }
    if (type === 'retry') loadLive();
  }

  function onPointer(event) {
    var item = event.target.closest('[data-notify-id]');
    if (item) mark(item.dataset.notifyId);
  }

  function onChange(event) {
    var pref = event.target.dataset.notifyPref;
    var time = event.target.dataset.notifyTime;
    if (!pref && !time) return;
    var data = read();
    var snapshot = JSON.parse(JSON.stringify(data.preferences || {}));
    if (pref === 'daily_digest') data.preferences.daily_digest = event.target.checked;
    else if (pref) data.preferences.categories[pref] = event.target.checked;
    else data.preferences[time] = event.target.value || null;
    if (isLive()) {
      if (!window.CommonsAPI) return;
      refreshPage();
      window.CommonsAPI.put('/notify/preferences', {
        categories: data.preferences.categories || {},
        quiet_start: data.preferences.quiet_start || null,
        quiet_end: data.preferences.quiet_end || null,
        timezone_offset_min: data.preferences.timezone_offset_min || 0,
        daily_digest: !!data.preferences.daily_digest
      }, writeOpts()).catch(function (error) {
        data.preferences = snapshot;
        refreshPage();
        if (window.Commons && window.Commons.toast) window.Commons.toast(liveError(error, '偏好没有保存。'));
      });
      return;
    }
    if (write(data)) refreshPage();
  }

  function onKey(event) {
    if (event.key === 'Escape' && state.open) { state.open = false; refreshBell(); }
  }

  function mount() {
    if (!document.querySelector('[data-notify-root], [data-notify-bell]') || bound) return;
    document.addEventListener('click', onClick);
    document.addEventListener('pointerover', onPointer);
    document.addEventListener('change', onChange);
    document.addEventListener('keydown', onKey);
    bound = true;
    if (isLive() && !state.live && !state.liveLoading) loadLive();
  }

  function loadLive() {
    if (!isLive() || !window.CommonsAPI || state.liveLoading) return;
    var ticket = ++state.liveRequest;
    state.liveLoading = true;
    state.liveError = '';
    Promise.all([
      window.CommonsAPI.get('/notify/notifications'),
      window.CommonsAPI.get('/notify/preferences')
    ]).then(function (rows) {
      if (ticket !== state.liveRequest) return;
      var items = rows[0].data;
      state.live = {
        items: Array.isArray(items) ? items : (items && items.items) || [],
        preferences: rows[1].data || { categories: {} }
      };
      state.liveLoading = false;
      refreshPage();
      refreshBell();
    }).catch(function (error) {
      if (ticket !== state.liveRequest) return;
      state.live = null;
      state.liveLoading = false;
      state.liveError = (error && (error.status === 501 || error.code === 'capability_unavailable')) ? 'closed' : ((error && error.message) || '通知没有载入');
      refreshPage();
    });
  }

  function destroy() {
    if (!bound) return;
    document.removeEventListener('click', onClick);
    document.removeEventListener('pointerover', onPointer);
    document.removeEventListener('change', onChange);
    document.removeEventListener('keydown', onKey);
    bound = false;
    state.open = false;
  }

  window.CommonsNotify = {
    routes: { notifications: page },
    hub: ['notifications'],
    nav: [['notifications', '通知', 'bell', 'personal']],
    icons: { bell: ICONS.bell },
    bell: bell,
    mount: mount,
    destroy: destroy
  };
  (window.CommonsPages = window.CommonsPages || []).push(window.CommonsNotify);
})();

