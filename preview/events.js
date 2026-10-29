/* R13 EVENT-1 · 活动专区、活动详情、打榜与拉票卡。 */
(function () {
  'use strict';

  var KIND_LABEL = { challenge: '挑战赛', camp: '共学营', meetup: '线下聚会', talks: '讲堂周', campaign: '打榜' };
  var STATUS_LABEL = { live: '进行中', upcoming: '即将开始', ended: '往期' };
  var SOURCE_LABEL = { work: '作品', prompt: '提示词', talk: '讲堂', other: '提交' };
  var STORE = 'events.demo.v1';
  var FLAG = 'M5 4h10l-1.2 4H19l-8 12-1.4-6H5z';
  var CHART = 'M4 19V6m0 13h16M8 16V10m5 6V8m5 8v-4';
  var state = { root: null, bound: false, hero: 0, heroPaused: false, heroTimer: null, unbind: [], live: null, liveError: '', liveLoading: false, liveClosed: false, detail: {}, signups: {}, results: {}, createOpen: false, createDraft: { kind: 'challenge', title: '', summary: '', place: '', starts: '', ends: '', rules: '' }, voted: {}, busy: false, submitOpen: false, draft: { title: '', summary: '', kind: 'other' }, formError: '' };

  function isLive() {
    return !!(window.CommonsAPI && window.CommonsAPI.mode === 'live');
  }

  function C() { return window.Commons || {}; }
  function esc(value) {
    if (typeof C().esc === 'function') return C().esc(String(value == null ? '' : value));
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }
  function safeUrl(value) {
    if (typeof C().safeUrl === 'function') return C().safeUrl(String(value || ''));
    var raw = String(value || '');
    return /^(?:#\/|\.{0,2}\/|assets\/|https?:)/i.test(raw) ? esc(raw) : '#';
  }
  function asset(value) {
    var path = String(value || '');
    return /^assets\/(?:illus|samples|mascot)\/[A-Za-z0-9._-]+\.webp$/.test(path)
      ? path
      : 'assets/illus/cover-agent-plaza.webp';
  }
  function squareCover(value) {
    return asset(value).replace(/^assets\/(?:illus|samples|mascot)\//, 'assets/thumbs/').replace(/\.webp$/, '-sq.webp');
  }
  function squareImage(value) {
    return '<img src="' + safeUrl(squareCover(value)) + '" data-evt-fallback="' + safeUrl(asset(value)) + '" alt="">';
  }
  function announceSlot(position) {
    return window.CommonsAnnounce && typeof window.CommonsAnnounce.adSlot === 'function'
      ? window.CommonsAnnounce.adSlot(position)
      : '';
  }
  function data() {
    if (isLive()) return state.live || { viewer: {}, people: {}, events: [], campaigns: [] };
    return window.COMMONS_EVENTS_SAMPLE || { viewer: {}, people: {}, events: [], campaigns: [] };
  }
  function pathParts() {
    return location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  }
  function allItems() {
    return data().events.concat(data().campaigns);
  }
  // 真实模式下同一个活动可能同时出现在 events 和 campaigns 两个列表里，改的时候两份都要改。
  function eachItem(id, fn) {
    allItems().forEach(function (item) { if (item.id === id) fn(item); });
  }
  function findItem(id) {
    return allItems().find(function (item) { return item.id === id; });
  }
  function person(id) {
    return data().people[id] || { id: id, name: id, level: 1, avatar: 'assets/mascot/panda-avatar-mint-512.webp' };
  }
  /* safe-fn: CommonsLinks.person 按接口约定转义；本地退路对名字 esc、handle encodeURIComponent。 */
  function personLink(handle, name, level) {
    if (window.CommonsLinks && typeof window.CommonsLinks.person === 'function') return window.CommonsLinks.person(handle, name, { level: level });
    return handle ? '<a class="lk-person" href="#/u/' + encodeURIComponent(handle) + '">' + esc(name) + '</a>' : esc(name);
  }
  /* safe-fn: CommonsLinks.a 按接口约定转义；本地退路只用白名单路由并逐值转义。 */
  function objectLink(kind, id, label, cls) {
    if (window.CommonsLinks && typeof window.CommonsLinks.a === 'function') return window.CommonsLinks.a(kind, id, label, cls);
    var routes = { work: 'work', knowledge: 'knowledge', prompt: 'prompts', talk: 'talks', event: 'event', campaign: 'campaign' };
    var route = routes[kind];
    return route && id ? '<a' + (cls ? ' class="' + esc(cls) + '"' : '') + ' href="#/' + route + '/' + encodeURIComponent(id) + '">' + esc(label) + '</a>' : esc(label);
  }
  /* safe-fn: 团队与个人分支分别调用安全链接函数，无共用团队路由时返回 esc 纯文字。 */
  function hostLink(item) {
    // 主办人名字为空时返回空串，不要给出一个空链接标签（tagLine 会把空段过滤掉）。
    if (item.hostSlug) {
      if (!String(item.host == null ? '' : item.host).trim()) return '';
      if (window.CommonsLinks && typeof window.CommonsLinks.a === 'function') return window.CommonsLinks.a('org', item.hostSlug, item.host);
      return esc(item.host);
    }
    var host = person(item.hostId);
    var name = item.host || host.name;
    if (!String(name == null ? '' : name).trim()) return '';
    return personLink(host.handle, name, host.level);
  }
  // 时间 · 地点 · 主办人：只拼非空的段，空段不出分隔符。
  function tagLine(item) {
    return [esc(when(item)), esc(item.place), hostLink(item)].filter(function (seg) {
      return String(seg || '').trim() !== '';
    }).join(' · ');
  }
  function hrefOf(item) {
    return item.kind === 'campaign' ? '#/campaign/' + item.id : '#/event/' + item.id;
  }
  function local() {
    var saved = C().read ? C().read(STORE, null) : null;
    if (saved && typeof saved === 'object') return saved;
    return { signups: [], submissions: [], votes: {} };
  }
  function persist(next) {
    if (C().write) C().write(STORE, next);
  }
  function todayKey() {
    var now = new Date();
    return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
  }
  function voteBucket(campaignId) {
    if (isLive()) return { day: todayKey(), ids: state.voted[campaignId] || [] };
    var store = local();
    var bucket = store.votes[campaignId];
    if (!bucket || bucket.day !== todayKey()) {
      bucket = { day: todayKey(), ids: [] };
      store.votes[campaignId] = bucket;
      persist(store);
    }
    return bucket;
  }
  function remainingVotes(campaignId) {
    if (isLive()) {
      var found = findItem(campaignId);
      return found && found.vote && found.vote.canVote ? found.vote.remaining : 0;
    }
    return Math.max(0, 3 - voteBucket(campaignId).ids.length);
  }
  function toast(message) {
    if (C().toast) C().toast(message);
  }
  function reduced() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function chip(kind, status) {
    return '<span class="evt-chip" data-kind="' + esc(kind) + '">' + esc(KIND_LABEL[kind] || kind) + '</span>' +
      (status ? '<span class="evt-chip is-status" data-status="' + esc(status) + '">' + esc(STATUS_LABEL[status] || status) + '</span>' : '');
  }
  function when(item) {
    var start = String(item.startsAt || '').slice(5, 10).replace('-', '.');
    var end = String(item.endsAt || '').slice(5, 10).replace('-', '.');
    return start && end ? start + '–' + end : start || end;
  }
  function sampleMark() {
    if (isLive()) return '';
    return '<span class="evt-sample">示例</span>';
  }
  function empty(title, actionHref, actionLabel) {
    return '<section class="evt-empty"><img src="assets/illus/empty-no-content.webp" alt="">' +
      '<h2>' + esc(title) + '</h2><a class="button primary" href="' + safeUrl(actionHref) + '">' + esc(actionLabel) + '</a></section>';
  }

  function quietEmpty(text) {
    return '<p class="evt-section-empty">' + esc(text) + '</p>';
  }

  function card(item) {
    var awards = item.status === 'ended' && item.awards && item.awards.length
      ? '<p class="evt-card-meta">' + esc(item.submissions || 0) + ' 件作品 · ' + esc(item.signups || 0) + ' 人 · ' +
        esc(item.awards.map(function (row) { return row.name; }).join('、')) + '</p>'
      : '<p class="evt-card-meta">' + esc(item.signups || 0) + ' 人已报名' +
        (item.submissions ? ' · ' + esc(item.submissions) + ' 件作品' : '') + '</p>';
    return '<a class="evt-card" href="' + safeUrl(hrefOf(item)) + '">' +
      '<span class="evt-card-cover' + (item.kind === 'campaign' ? ' is-square' : '') + '">' +
      (item.kind === 'campaign' ? squareImage(item.cover) : '<img src="' + safeUrl(asset(item.cover)) + '" alt="">') + '</span>' +
      '<span class="evt-card-body">' + chip(item.kind, item.status) +
      '<strong>' + esc(item.title) + '</strong><small>' + esc(item.summary) + '</small>' +
      awards + '</span></a>';
  }

  function section(id, title, items) {
    if (!items.length) {
      return '<section class="evt-section" id="' + esc(id) + '"><header><h2>' + esc(title) + '</h2></header>' +
        quietEmpty('这一栏还空着') + '</section>';
    }
    return '<section class="evt-section" id="' + esc(id) + '"><header><h2>' + esc(title) + '</h2><span>' +
      items.length + '</span></header><div class="evt-grid">' + items.map(card).join('') + '</div></section>';
  }

  function heroSlide(item, index, current) {
    var active = index === current;
    return '<article class="evt-hero-slide' + (active ? ' is-current' : '') + '" data-evt-slide="' + index + '"' +
      (active ? '' : ' hidden inert aria-hidden="true"') + '>' +
      '<img src="' + safeUrl(asset(item.cover)) + '" alt="">' +
      '<div><div class="evt-hero-tags">' + chip(item.kind, item.status) + '</div>' +
      '<h2>' + esc(item.title) + '</h2><p>' + esc(item.summary) + '</p>' +
      '<div class="evt-hero-actions"><a class="button primary" href="' + safeUrl(hrefOf(item)) + '"' + (active ? '' : ' tabindex="-1"') + '>参加</a>' +
      '<span>' + esc(item.signups) + ' 人 · ' + esc(when(item)) + '</span></div></div></article>';
  }

  function hero(items) {
    if (!items.length) return '';
    var current = Math.min(state.hero, items.length - 1);
    return '<section class="evt-hero" data-evt-hero role="group" aria-roledescription="轮播" aria-label="活动推荐">' +
      '<div class="evt-hero-track">' + items.map(function (item, index) {
        return heroSlide(item, index, current);
      }).join('') + '</div>' +
      '<div class="evt-hero-nav">' +
      '<button class="button ghost icon-only" type="button" data-evt-act="hero-prev" aria-label="上一张">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5 8 12l7 7" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button>' +
      '<div class="evt-hero-dots">' + items.map(function (item, index) {
        return '<button type="button" data-evt-act="hero-dot" data-evt-index="' + index + '" aria-label="第 ' +
          (index + 1) + ' 张"' + (index === current ? ' aria-current="true"' : '') + '></button>';
      }).join('') + '</div>' +
      '<button class="button ghost icon-only" type="button" data-evt-act="hero-next" aria-label="下一张">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button>' +
      '<button class="button ghost small evt-hero-pause" type="button" data-evt-act="hero-pause" aria-pressed="' + esc(String(state.heroPaused)) + '">' + (state.heroPaused ? '播放' : '暂停') + '</button>' +
      '<span class="sr-only" role="status" aria-live="polite" data-evt-hero-status></span>' +
      '</div></section>';
  }

  function eventsPage() {
    var items = allItems();
    var live = items.filter(function (item) { return item.status === 'live'; });
    var soon = items.filter(function (item) { return item.status === 'upcoming'; });
    var past = items.filter(function (item) { return item.status === 'ended'; });
    var featured = live.filter(function (item) { return item.featured; });
    if (!featured.length) featured = live.slice(0, 3);
    var ad = announceSlot('events');
    var wholeEmpty = !live.length && !soon.length && !past.length;
    return '<main class="evt-page" data-evt-root data-evt-view="list">' +
      '<div class="evt-head"><p>限时挑战、共学和评选。</p>' + sampleMark() + '</div>' + createHTML() +
      (wholeEmpty ? empty('还没有活动', '#/campaigns', '去打榜') : (
        hero(featured) +
        section('evt-live', '进行中', live) +
        section('evt-soon', '即将开始', soon) +
        section('evt-past', '往期回顾', past)
      )) +
      (ad ? '<section class="evt-ad">' + /* safe: CommonsAnnounce.adSlot 返回已转义广告卡 */ ad + '</section>' : '') +
      '</main>';
  }

  function rewardList(item) {
    return '<ul class="evt-rewards">' + (item.rewards || []).map(function (row) {
      return '<li><strong>' + esc(row.label) + '</strong><small>' + esc(row.note || '拟定') + '</small></li>';
    }).join('') + '</ul>';
  }

  function timeline(item) {
    return '<ol class="evt-timeline">' + (item.timeline || []).map(function (row) {
      return '<li><time>' + esc(row.at) + '</time><span>' + esc(row.text) + '</span></li>';
    }).join('') + '</ol>';
  }

  function wall(item) {
    if (isLive()) {
      var names = state.signups[item.id];
      if (!names) return state.detail[item.id] === 'loading' ? '<p class="evt-wall-more">正在读取…</p>' : empty('报名名单没有读出来', hrefOf(item), '刷新');
      if (!names.length) return empty('还没有人报名', hrefOf(item), '报名');
      return '<div class="evt-wall">' + names.map(function (row) {
        return '<div class="evt-wall-item"><span>' + esc(row.name || '成员') + '</span></div>';
      }).join('') + '<span class="evt-wall-more">共 ' + esc(names.length) + ' 人</span></div>';
    }
    var people = item.participants || [];
    if (!people.length) return empty('还没有人报名', hrefOf(item), '报名');
    return '<div class="evt-wall">' + people.map(function (row) {
      var who = person(row.id || row);
      return '<div class="evt-wall-item">' +
        '<img src="' + safeUrl(asset(who.avatar)) + '" alt="">' +
        '<span>' + personLink(who.handle, who.name, who.level) + '</span></div>';
    }).join('') + '<span class="evt-wall-more">共 ' + esc(item.signups) + ' 人</span></div>';
  }

  function signed(id) {
    if (isLive()) return !!(findItem(id) || {}).signedUp;
    return local().signups.indexOf(id) !== -1;
  }
  function submitted(id) {
    if (isLive()) return !!(findItem(id) || {}).submitted;
    return local().submissions.indexOf(id) !== -1;
  }

  function eventActions(item) {
    if (item.status === 'ended') {
      return '<a class="button" href="#/campaigns">去看打榜</a>';
    }
    var signup = signed(item.id)
      ? '<button class="button" type="button" disabled>已报名</button>'
      : '<button class="button primary" type="button" data-evt-act="signup"' + (state.busy ? ' disabled aria-busy="true"' : '') + '>报名</button>';
    var locked = isLive() && !canDo('events.submit');
    var why = locked ? whyNot('events.submit') : '';
    var submit = item.status === 'live'
      ? (submitted(item.id)
        ? '<button class="button" type="button" disabled>已提交</button>'
        : '<button class="button tonal" type="button" data-evt-act="submit"' + (locked || (isLive() && state.busy) ? ' disabled' : '') + (why ? ' title="' + esc(why) + '"' : '') + '>提交作品</button>' +
          (locked ? '<p class="muted evt-why" role="note" data-evt-locked="submit">' + (why ? esc(why) + (/^需要 L/.test(why) ? '，<a href="#/growth">看看怎么升级</a>' : '') : '你现在的等级还不能提交作品，<a href="#/growth">看看怎么升级</a>') + '</p>' : ''))
      : '';
    return signup + submit;
  }

  // 真实模式：服务器要标题才收提交，所以点「提交作品」先展开一个小表单；演示模式不画。
  function submitForm(item) {
    if (!isLive() || !state.submitOpen || item.status !== 'live' || submitted(item.id)) return '';
    var d = state.draft;
    return '<div class="evt-submit-form" data-evt-submit-form>' +
      '<label class="field"><span>标题</span><input data-evt-field="title" maxlength="80" value="' + esc(d.title) + '"></label>' +
      '<label class="field"><span>一句话说明（可选）</span><input data-evt-field="summary" maxlength="160" value="' + esc(d.summary) + '"></label>' +
      '<label class="field"><span>来源类型</span><select data-evt-field="kind">' + Object.keys(SOURCE_LABEL).map(function (key) {
        return '<option value="' + esc(key) + '"' + (d.kind === key ? ' selected' : '') + '>' + esc(SOURCE_LABEL[key]) + '</option>';
      }).join('') + '</select></label>' +
      (state.formError ? '<p role="alert">' + esc(state.formError) + '</p>' : '') +
      '<button class="button primary" type="button" data-evt-act="submit-send"' + (state.busy ? ' disabled aria-busy="true"' : '') + '>' + (state.busy ? '提交中…' : '确认提交') + '</button> ' +
      '<button class="button ghost" type="button" data-evt-act="submit-cancel"' + (state.busy ? ' disabled' : '') + '>取消</button></div>';
  }

  // 真实模式：活动结束后读 GET /events/{id}/results（报名/候选/投票人/总票 + 前十名）。
  function resultsHTML(item) {
    var r = isLive() && state.results[item.id];
    if (!r) return '';
    var st = r.stats || {};
    var stats = item.stats ? '' : '<dl><div><dt>报名</dt><dd>' + esc(st.signups) + '</dd></div><div><dt>候选</dt><dd>' + esc(st.submissions) + '</dd></div>' +
      '<div><dt>投票人</dt><dd>' + esc(st.voters) + '</dd></div><div><dt>总票</dt><dd>' + esc(st.ballots) + '</dd></div></dl>';
    var winners = (r.winners || []).length
      ? '<ol>' + r.winners.map(function (row) {
        return '<li><b>' + esc(row.rank) + '</b><span>' + esc(row.author || '') + '</span><small>' + esc(row.title) + ' · ' + esc(row.votes) + ' 票</small></li>';
      }).join('') + '</ol>'
      : '<p>这场活动没有候选作品。</p>';
    return '<section class="evt-awards" data-evt-results><h2>活动结果</h2>' + stats + winners + '</section>';
  }

  var KIND_NAME = { challenge: '挑战', camp: '训练营', meetup: '聚会', talks: '讲座', campaign: '评选' };
  // 服务器按等级/角色/开关算好 /api/me.capabilities；没有会话对象时按「不拦」处理，由服务器 403 兜底。
  function canDo(action) {
    var session = window.CommonsSession;
    return !session || typeof session.can !== 'function' || session.can(action);
  }
  // /api/me.capability_reasons 给的原因（等级、功能没开……）；没有就返回空串，调用方退回原来的说法。
  function whyNot(action) {
    var session = window.CommonsSession;
    return session && typeof session.reason === 'function' ? session.reason(action) : '';
  }
  function canCreate() {
    var session = window.CommonsSession;
    return isLive() && !!session && typeof session.can === 'function' && session.can('events.manage');
  }
  function createHTML() {
    if (!canCreate()) return '';
    if (!state.createOpen) return '<div class="evt-create"><button class="button primary" type="button" data-evt-act="create-open">创建活动</button></div>';
    var d = state.createDraft;
    function field(name, label, input) { return '<label class="field"><span>' + /* safe: label 是本函数调用处写死的文案 */ label + '</span>' + /* safe: input 是本文件拼好且已转义的控件 HTML */ input + '</label>'; }
    return '<div class="evt-create evt-submit-form" data-evt-create-form>' +
      field('kind', '类型', '<select data-evt-create="kind">' + Object.keys(KIND_NAME).map(function (key) {
        return '<option value="' + esc(key) + '"' + (d.kind === key ? ' selected' : '') + '>' + esc(KIND_NAME[key]) + '</option>';
      }).join('') + '</select>') +
      field('title', '标题', '<input data-evt-create="title" maxlength="80" value="' + esc(d.title) + '">') +
      field('summary', '一句话说明（可选）', '<input data-evt-create="summary" maxlength="160" value="' + esc(d.summary) + '">') +
      field('place', '地点（可选）', '<input data-evt-create="place" maxlength="80" value="' + esc(d.place) + '">') +
      field('starts', '开始时间', '<input type="datetime-local" data-evt-create="starts" value="' + esc(d.starts) + '">') +
      field('ends', '结束时间', '<input type="datetime-local" data-evt-create="ends" value="' + esc(d.ends) + '">') +
      field('rules', '规则（可选）', '<textarea data-evt-create="rules" rows="4" maxlength="4000">' + esc(d.rules) + '</textarea>') +
      (state.formError ? '<p role="alert">' + esc(state.formError) + '</p>' : '') +
      '<button class="button primary" type="button" data-evt-act="create-send"' + (state.busy ? ' disabled aria-busy="true"' : '') + '>' + (state.busy ? '创建中…' : '确认创建') + '</button> ' +
      '<button class="button ghost" type="button" data-evt-act="create-cancel"' + (state.busy ? ' disabled' : '') + '>取消</button></div>';
  }
  function readCreate() {
    Object.keys(state.createDraft).forEach(function (name) {
      var node = state.root && state.root.querySelector('[data-evt-create="' + name + '"]');
      if (node) state.createDraft[name] = node.value;
    });
  }
  function sendCreate() {
    if (state.busy) return;
    readCreate();
    var d = state.createDraft;
    var title = d.title.trim();
    var starts = d.starts ? new Date(d.starts) : null;
    var ends = d.ends ? new Date(d.ends) : null;
    if (!title) { state.formError = '请填写标题。'; refresh(); return; }
    if (!starts || !ends || isNaN(starts.getTime()) || isNaN(ends.getTime())) { state.formError = '请填写开始和结束时间。'; refresh(); return; }
    if (ends <= starts) { state.formError = '结束时间必须晚于开始时间。'; refresh(); return; }
    liveAct('/events', {
      kind: d.kind, title: title, summary: d.summary.trim(), place: d.place.trim(), rules: d.rules.trim(),
      starts_at: starts.toISOString(), ends_at: ends.toISOString(), visibility: 'members'
    }, function (res) {
      var created = res.data;
      if (created && created.id) {
        var bucket = created.kind === 'campaign' ? 'campaigns' : 'events';
        state.live[bucket] = (state.live[bucket] || []).filter(function (row) { return row.id !== created.id; }).concat([created]);
        state.createDraft = { kind: 'challenge', title: '', summary: '', place: '', starts: '', ends: '', rules: '' };
        state.createOpen = false;
        state.formError = '';
        location.hash = hrefOf(created);
      }
    }, '活动已创建');
  }

  /* safe-slot: extra, body — extra 是本文件按钮 HTML，body 是本文件榜单/结果 HTML */
  function detailShell(item, extra, body) {
    return '<main class="evt-page evt-detail" data-evt-root data-evt-view="detail" data-evt-id="' + esc(item.id) + '">' +
      '<header class="evt-detail-hero"><img src="' + safeUrl(asset(item.cover)) + '" alt="">' +
      '<div><a class="evt-back" href="' + (item.kind === 'campaign' ? '#/campaigns' : '#/events') + '">返回</a>' +
      '<div class="evt-title-line"><h1>' + esc(item.title) + '</h1>' + sampleMark() + '</div>' +
      '<p>' + esc(item.summary) + '</p>' +
      '<div class="evt-detail-tags">' + chip(item.kind, item.status) + '<span>' + tagLine(item) + '</span></div>' +
      '<div class="evt-detail-actions">' + eventActions(item) + extra + '</div>' + submitForm(item) + '</div></header>' +
      '<div class="evt-detail-grid">' +
      '<details class="evt-rules"><summary>规则</summary><p>' + esc(item.rules) + '</p></details>' +
      '<section><h2>时间线</h2>' + timeline(item) + '</section>' +
      '<section><h2>奖励</h2>' + rewardList(item) + '</section>' +
      '<section><h2>参与者</h2>' + wall(item) + '</section>' +
      '</div>' +
      (item.status === 'ended' && item.awards && item.awards.length
        ? '<section class="evt-awards"><h2>获奖名单</h2><ol>' + item.awards.map(function (row) {
          return '<li><b>' + esc(row.rank) + '</b><span>' + esc(row.name) + '</span><small>' + esc(row.title) + '</small></li>';
        }).join('') + '</ol></section>'
        : '') +
      resultsHTML(item) +
      (body || '') +
      // 真实模式：活动不是内容对象、没有回复接口，不画演示用的讨论区。
      (isLive() ? '' : '<section class="evt-thread-wrap"><h2>讨论</h2><div data-evt-thread></div></section>') +
      '</main>';
  }

  function eventPage(id) {
    var item = findItem(id);
    if (!item) return '<main class="evt-page" data-evt-root>' + empty('没有这场活动', '#/events', '返回活动专区') + '</main>';
    if (item.kind === 'campaign') return campaignPage(id);
    return detailShell(item, '', '');
  }

  function deltaMark(item) {
    if (item.lastRank == null || item.rank == null || item.lastRank === item.rank) return '<i class="evt-delta is-same" role="img" aria-label="名次不变">—</i>';
    if (item.lastRank > item.rank) return '<i class="evt-delta is-up" role="img" aria-label="上升">↑' + esc(item.lastRank - item.rank) + '</i>';
    return '<i class="evt-delta is-down" role="img" aria-label="下降">↓' + esc(item.rank - item.lastRank) + '</i>';
  }

  function candidateCard(item, campaign, viewer, compact) {
    var mine = item.authorId === viewer.id;
    var voted = voteBucket(campaign.id).ids.indexOf(item.id) !== -1;
    var can = campaign.status === 'live' && !mine && remainingVotes(campaign.id) > 0 && !voted;
    var action = campaign.status === 'ended'
      ? ''
      : (mine
        ? '<span class="evt-vote-note">自己的作品</span>'
        : '<button class="button' + (can ? ' primary' : '') + '" type="button" data-evt-act="vote" data-evt-id="' +
          esc(item.id) + '" data-evt-campaign="' + esc(campaign.id) + '"' + (can ? '' : ' disabled') + '>' + (voted ? '已投' : '投一票') + '</button>');
    return '<article class="evt-cand" data-evt-candidate="' + esc(item.id) + '" tabindex="-1">' +
      '<b class="evt-rank">' + esc(item.rank) + '</b>' + deltaMark(item) +
      '<span class="evt-cand-cover">' + squareImage(item.cover) + '</span>' +
      '<div class="evt-cand-body"><strong>' + objectLink(item.sourceKind, item.sourceRef, item.title) + '</strong>' +
      '<small class="evt-cand-meta"><span>' + esc(SOURCE_LABEL[item.sourceKind] || '') + ' ·</span><span class="evt-cand-author">' +
      personLink(person(item.authorId).handle, person(item.authorId).name, person(item.authorId).level) + '</span></small>' +
      '<p>' + esc(item.summary) + '</p></div>' +
      '<div class="evt-cand-vote" role="status" aria-live="polite"><strong>' + esc(item.votes) + '</strong><span>票</span>' + action +
      (compact ? '' : '<button class="button ghost small" type="button" data-evt-act="share" data-evt-id="' + esc(item.id) + '">拉票卡</button>') + '</div>' +
      '</article>';
  }

  function pastCampaignRow(item) {
    return '<a class="evt-past-row" href="' + safeUrl(hrefOf(item)) + '"><strong>' + esc(item.title) +
      '</strong><small>' + esc(item.submissions || 0) + ' 个候选</small><i aria-hidden="true">›</i></a>';
  }

  function campaignsPage() {
    var items = data().campaigns || [];
    var active = items.find(function (item) { return item.status === 'live'; });
    var past = items.filter(function (item) { return item.status === 'ended'; });
    var viewer = data().viewer || {};
    var ad = announceSlot('events');
    var activeBoard = active ? '<section class="evt-campaign-lead"><header><div><span>' + chip(active.kind, active.status) + '</span><h2>' + esc(active.title) + '</h2><small>实时前 10 名</small></div></header>' +
      '<div class="evt-board-list">' + (active.candidates || []).slice(0, 10).map(function (row) {
        return candidateCard(row, active, viewer, true);
      }).join('') + '</div></section>' : '';
    var side = active ? '<aside class="evt-campaign-side" aria-label="本场信息">' +
      '<section class="evt-campaign-votes" role="status" aria-live="polite"><strong>' + esc(remainingVotes(active.id)) + '</strong><span>今日剩余票</span></section>' +
      '<details class="evt-campaign-rules"><summary><b aria-hidden="true">?</b><span>规则</span></summary><p>' + esc(active.rules) + '</p></details>' +
      (past.length ? '<section class="evt-campaign-past"><h2>往期</h2>' + past.slice(0, 3).map(pastCampaignRow).join('') + '</section>' : '') +
      (ad ? '<section class="evt-ad">' + /* safe: CommonsAnnounce.adSlot 返回已转义广告卡 */ ad + '</section>' : '') +
      '</aside>' : '';
    return '<main class="evt-page" data-evt-root data-evt-view="campaigns">' +
      '<div class="evt-head"><p>每天三票，投给能复现的作品。</p>' + sampleMark() + '</div>' +
      (items.length ? '<div class="evt-campaign-layout">' + activeBoard + side + '</div>' : empty('还没有评选', '#/events', '去活动专区')) +
      '</main>';
  }

  function campaignPage(id) {
    var item = (data().campaigns || []).find(function (row) { return row.id === id; }) || findItem(id);
    if (!item || item.kind !== 'campaign') {
      return '<main class="evt-page" data-evt-root>' + empty('没有这场打榜', '#/campaigns', '返回打榜') + '</main>';
    }
    var viewer = data().viewer || {};
    var power = isLive() ? !!(item.vote && item.vote.reason === 'new_account') : viewer.level <= 1 && (viewer.accountDays || 0) < 7;
    var left = remainingVotes(item.id);
    var extra = item.status === 'live'
      ? '<span class="evt-vote-left">' + (power ? '新号只能看榜' : '今日还剩 ' + esc(left) + ' 票') + '</span>'
      : '<span class="evt-vote-left">已锁票</span>';
    var board = '<section class="evt-board"><header><h2>实时榜</h2>' + extra + '</header>' +
      '<div class="evt-board-list">' + (item.candidates || []).slice(0, 10).map(function (row) {
        return candidateCard(row, item, viewer);
      }).join('') + '</div></section>';
    var stats = item.status === 'ended' && item.stats
      ? '<section class="evt-stats"><h2>结果</h2><dl>' +
        '<div><dt>报名</dt><dd>' + esc(item.stats.signups) + '</dd></div>' +
        '<div><dt>候选</dt><dd>' + esc(item.stats.submissions) + '</dd></div>' +
        '<div><dt>投票人</dt><dd>' + esc(item.stats.voters) + '</dd></div>' +
        '<div><dt>总票</dt><dd>' + esc(item.stats.ballots) + '</dd></div></dl></section>'
      : '';
    var dialog = '<dialog class="evt-share" data-evt-share aria-label="拉票卡"><button class="button ghost icon-only" type="button" data-evt-act="close-share" aria-label="关闭">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="1.5"/></svg></button>' +
      '<article data-evt-share-card></article>' +
      '<button class="button primary" type="button" data-evt-act="copy-share">复制文案</button></dialog>';
    return detailShell(item, '', board + stats + dialog);
  }

  function shareCard(campaign, item) {
    var who = person(item.authorId);
    var hash = '#/campaign/' + encodeURIComponent(campaign.id);
    var href = location.protocol === 'file:' ? hash : String(location.href).split('#')[0] + hash;
    var qr = window.CommonsQR && typeof window.CommonsQR.svg === 'function'
      ? window.CommonsQR.svg(href, { label: '拉票链接二维码' }) : '';
    return '<div class="evt-share-card" data-kind="' + esc(campaign.kind) + '">' +
      '<div class="evt-share-top">' + squareImage(item.cover) +
      (qr ? '<div class="evt-share-qr">' + /* safe: CommonsQR.svg 只返回固定 SVG */ qr + '</div>' : '') + '</div>' +
      '<p>第 ' + esc(item.rank) + ' 名 · ' + esc(item.votes) + ' 票</p>' +
      '<h3>' + esc(item.title) + '</h3><small>' + esc(who.name) + ' · ' + esc(campaign.title) + '</small></div>';
  }

  function shareText(campaign, item) {
    return '我在投「' + item.title + '」，现在第 ' + item.rank + ' 名。#' + campaign.title + ' #/campaign/' + campaign.id;
  }

  function currentCampaign(campaignId) {
    var id = campaignId || pathParts()[1];
    return (data().campaigns || []).find(function (row) { return row.id === id; });
  }

  function openShare(candidateId) {
    var campaign = currentCampaign();
    var item = campaign && (campaign.candidates || []).find(function (row) { return row.id === candidateId; });
    var dialog = state.root && state.root.querySelector('[data-evt-share]');
    if (!campaign || !item || !dialog) return;
    dialog.querySelector('[data-evt-share-card]').innerHTML = /* safe: shareCard 只插入已转义的本文件 HTML */ shareCard(campaign, item);
    dialog.dataset.text = shareText(campaign, item);
    if (dialog.showModal) dialog.showModal();
    else dialog.setAttribute('open', '');
  }

  function copyShare() {
    var dialog = state.root && state.root.querySelector('[data-evt-share]');
    if (!dialog) return;
    var text = dialog.dataset.text || '';
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast('已复制拉票文案'); }).catch(function () {
        toast(text);
      });
    } else {
      toast(text);
    }
  }

  // 真实模式：只有服务器确认后才提示成功；失败如实显示服务器的话，501 显示「还没开放」。
  function liveAct(path, body, onDone, okText) {
    if (state.busy) return;
    var id = state.root && state.root.getAttribute('data-evt-id');
    state.busy = true;
    state.formError = '';
    refresh();
    window.CommonsAPI.post(path, body, { idempotencyKey: window.CommonsAPI.newIdempotencyKey() }).then(function (res) {
      state.busy = false;
      return Promise.resolve(onDone(res)).then(function () { toast(okText); });
    }).catch(function (error) {
      state.busy = false;
      var message = isClosed(error) ? '这个功能还没开放' : ((error && error.message) || '没有完成，请稍后再试');
      if (state.submitOpen || state.createOpen) state.formError = message;
      toast(message);
    }).then(function () {
      if (state.root && state.root.getAttribute('data-evt-id') === id) refresh();
    });
  }

  function doSignup() {
    var id = state.root && state.root.getAttribute('data-evt-id');
    if (!id || signed(id)) return;
    if (isLive()) {
      liveAct('/events/' + encodeURIComponent(id) + '/signup', {}, function () {
        eachItem(id, function (item) { item.signedUp = true; item.signups = (item.signups || 0) + 1; });
      }, '已报名');
      return;
    }
    var store = local();
    store.signups.push(id);
    persist(store);
    toast('已报名');
    refresh();
  }

  function doSubmit() {
    var id = state.root && state.root.getAttribute('data-evt-id');
    if (!id || submitted(id)) return;
    if (isLive()) {
      state.submitOpen = true;
      refresh();
      var field = state.root && state.root.querySelector('[data-evt-field="title"]');
      if (field) field.focus();
      return;
    }
    var store = local();
    store.submissions.push(id);
    persist(store);
    toast('已记下提交');
    refresh();
  }

  function readDraft() {
    ['title', 'summary', 'kind'].forEach(function (name) {
      var node = state.root && state.root.querySelector('[data-evt-field="' + name + '"]');
      if (node) state.draft[name] = node.value;
    });
  }

  function sendSubmission() {
    var id = state.root && state.root.getAttribute('data-evt-id');
    if (!id || state.busy) return;
    readDraft();
    var title = state.draft.title.trim();
    if (!title) { state.formError = '请填写标题。'; refresh(); return; }
    liveAct('/events/' + encodeURIComponent(id) + '/submissions',
      { title: title, summary: state.draft.summary.trim(), source_kind: state.draft.kind },
      function () {
        state.submitOpen = false;
        state.draft = { title: '', summary: '', kind: 'other' };
        var item = findItem(id);
        eachItem(id, function (row) { row.submitted = true; row.submissions = (row.submissions || 0) + 1; });
        return item && item.kind === 'campaign' ? loadDetail(id, true) : null;
      }, '已提交');
  }

  function doVote(candidateId, campaignId) {
    if (isLive()) {
      if (!candidateId || !campaignId) return;
      liveAct('/events/' + encodeURIComponent(campaignId) + '/votes', { candidate_id: candidateId }, function () {
        (state.voted[campaignId] = state.voted[campaignId] || []).push(candidateId);
        return loadDetail(campaignId, true);
      }, '已投票');
      return;
    }
    var campaign = currentCampaign(campaignId);
    var viewer = data().viewer || {};
    if (!campaign || campaign.status !== 'live') return;
    if (viewer.level <= 1 && (viewer.accountDays || 0) < 7) {
      toast('新号前 7 天只能看榜');
      return;
    }
    var item = (campaign.candidates || []).find(function (row) { return row.id === candidateId; });
    if (!item || item.authorId === viewer.id) {
      toast('不能投自己');
      return;
    }
    var store = local();
    var bucket = voteBucket(campaign.id);
    if (bucket.ids.indexOf(candidateId) !== -1) return;
    if (bucket.ids.length >= 3) {
      toast('今天的 3 票用完了');
      return;
    }
    bucket.ids.push(candidateId);
    store.votes[campaign.id] = bucket;
    persist(store);
    item.votes += 1;
    (campaign.candidates || []).slice().sort(function (a, b) {
      return b.votes - a.votes;
    }).forEach(function (row, index) {
      row.lastRank = row.rank;
      row.rank = index + 1;
    });
    toast('已投票');
    refresh();
  }

  // 真实模式：详情页的「我报过名吗 / 我还剩几票 / 榜单」要单独读。列表接口不带这些。
  function loadDetail(id, force) {
    var item = findItem(id);
    if (!isLive() || !item || (state.detail[id] && !force)) return Promise.resolve();
    state.detail[id] = 'loading';
    var reads = [window.CommonsAPI.get('/events/' + encodeURIComponent(id))];
    var boardAt = item.kind === 'campaign' ? reads.push(window.CommonsAPI.get('/events/' + encodeURIComponent(id) + '/board')) - 1 : -1;
    // 报名名单和结果是附加信息：读不到不影响详情页。
    var signupsAt = reads.push(window.CommonsAPI.get('/events/' + encodeURIComponent(id) + '/signups').catch(function () { return null; })) - 1;
    var resultsAt = item.status === 'ended' ? reads.push(window.CommonsAPI.get('/events/' + encodeURIComponent(id) + '/results').catch(function () { return null; })) - 1 : -1;
    return Promise.all(reads).then(function (rows) {
      var board = boardAt >= 0 && rows[boardAt] ? rows[boardAt].data || {} : null;
      state.signups[id] = rows[signupsAt] && Array.isArray(rows[signupsAt].data) ? rows[signupsAt].data : null;
      state.results[id] = resultsAt >= 0 && rows[resultsAt] ? rows[resultsAt].data || null : null;
      eachItem(id, function (target) {
        Object.assign(target, rows[0].data);
        if (!board) return;
        Object.assign(target, board.event || {});
        target.candidates = (board.items || []).map(function (row) {
          return Object.assign({}, row, { lastRank: row.delta == null ? null : row.rank + row.delta });
        });
      });
      state.detail[id] = 'ok';
    }).catch(function () {
      state.detail[id] = 'error';
    });
  }

  function setHero(next) {
    var slides = state.root ? state.root.querySelectorAll('[data-evt-slide]') : [];
    if (!slides.length) return;
    state.hero = (next + slides.length) % slides.length;
    slides.forEach(function (node, index) {
      var active = index === state.hero;
      node.classList.toggle('is-current', active);
      node.hidden = !active;
      node.toggleAttribute('inert', !active);
      if (active) node.removeAttribute('aria-hidden');
      else node.setAttribute('aria-hidden', 'true');
      node.querySelectorAll('a,button,input,select,textarea,[tabindex]').forEach(function (control) {
        if (active) control.removeAttribute('tabindex');
        else control.setAttribute('tabindex', '-1');
      });
    });
    state.root.querySelectorAll('[data-evt-act="hero-dot"]').forEach(function (node, index) {
      if (index === state.hero) node.setAttribute('aria-current', 'true');
      else node.removeAttribute('aria-current');
    });
    var status = state.root.querySelector('[data-evt-hero-status]');
    if (status) status.textContent = '已显示第 ' + (state.hero + 1) + ' 张活动';
  }

  function stopHeroTimer() {
    if (state.heroTimer) window.clearInterval(state.heroTimer);
    state.heroTimer = null;
  }

  function startHeroTimer() {
    stopHeroTimer();
    if (!state.root || state.heroPaused || reduced()) return;
    var slides = state.root.querySelectorAll('[data-evt-slide]');
    if (slides.length < 2) return;
    state.heroTimer = window.setInterval(function () { setHero(state.hero + 1); }, 6000);
  }

  function toggleHeroPause(button) {
    state.heroPaused = !state.heroPaused;
    button.setAttribute('aria-pressed', String(state.heroPaused));
    button.textContent = state.heroPaused ? '播放' : '暂停';
    var status = state.root && state.root.querySelector('[data-evt-hero-status]');
    if (status) status.textContent = state.heroPaused ? '轮播已暂停' : '轮播已播放';
    startHeroTimer();
  }

  function refresh() {
    var previous = state.root;
    if (!previous) return;
    var active = document.activeElement;
    var keep = active && active.getAttribute ? {
      act: active.getAttribute('data-evt-act') || '',
      id: active.getAttribute('data-evt-id') || '',
      campaign: active.getAttribute('data-evt-campaign') || ''
    } : null;
    destroy();
    previous.insertAdjacentHTML('afterend', /* safe: page() renders escaped local event data */ page());
    previous.remove();
    mount();
    if (keep && state.root) {
      var nodes = keep.act ? state.root.querySelectorAll('[data-evt-act="' + keep.act + '"]') : [];
      var next = Array.prototype.find.call(nodes, function (node) {
        return (!keep.id || node.getAttribute('data-evt-id') === keep.id) && (!keep.campaign || node.getAttribute('data-evt-campaign') === keep.campaign) && !node.disabled;
      });
      if (!next && keep.id) next = state.root.querySelector('[data-evt-candidate="' + keep.id + '"]');
      if (!next) next = state.root.querySelector('h1') || document.querySelector('#main .hub-title');
      if (next) { if (!next.hasAttribute('tabindex')) next.setAttribute('tabindex', '-1'); next.focus({ preventScroll: true }); }
    }
  }

  function onCoverError(event) {
    var img = event.target;
    if (!img.matches || !img.matches('img[data-evt-fallback]')) return;
    var fallback = img.getAttribute('data-evt-fallback');
    img.removeAttribute('data-evt-fallback');
    img.src = fallback;
  }

  function onClick(event) {
    var trigger = event.target.closest('[data-evt-act]');
    if (!trigger || !state.root || !state.root.contains(trigger)) return;
    var act = trigger.getAttribute('data-evt-act');
    if (act === 'retry') { loadLive(); return; }
    if (act === 'hero-prev') setHero(state.hero - 1);
    else if (act === 'hero-next') setHero(state.hero + 1);
    else if (act === 'hero-dot') setHero(Number(trigger.getAttribute('data-evt-index') || 0));
    else if (act === 'hero-pause') toggleHeroPause(trigger);
    else if (act === 'signup') doSignup();
    else if (act === 'submit') doSubmit();
    else if (act === 'submit-send') sendSubmission();
    else if (act === 'create-open') { state.createOpen = true; state.formError = ''; refresh(); }
    else if (act === 'create-cancel') { state.createOpen = false; state.formError = ''; refresh(); }
    else if (act === 'create-send') sendCreate();
    else if (act === 'submit-cancel') { readDraft(); state.submitOpen = false; state.formError = ''; refresh(); }
    else if (act === 'vote') doVote(trigger.getAttribute('data-evt-id'), trigger.getAttribute('data-evt-campaign'));
    else if (act === 'share') openShare(trigger.getAttribute('data-evt-id'));
    else if (act === 'copy-share') copyShare();
    else if (act === 'close-share') {
      var dialog = state.root.querySelector('[data-evt-share]');
      if (dialog && dialog.close) dialog.close();
      else if (dialog) dialog.removeAttribute('open');
    }
  }

  function mountThread(item) {
    var host = state.root && state.root.querySelector('[data-evt-thread]');
    if (!host || !item) return;
    if (isLive()) return;
    if (!window.CommonsThread || typeof window.CommonsThread.mount !== 'function') {
      host.innerHTML = '<p class="evt-thread-fallback">讨论区稍后接入。</p>';
      return;
    }
    window.CommonsThread.mount(host, {
      targetId: 'event:' + item.id,
      messages: item.comments || [],
      me: data().viewer,
      people: data().people,
      mode: 'chat'
    });
  }

  function isClosed(err) {
    return !!(err && (err.status === 501 || err.code === 'capability_unavailable' || err === 'closed'));
  }

  function closedHTML() {
    return '<div class="evt-page" data-evt-root><div class="evt-empty" role="status"><h2>这个功能还没开放</h2><p>管理员还没打开。</p></div></div>';
  }

  function liveStateHTML(kind) {
    if (kind === 'error') {
      if (isClosed(state.liveError) || state.liveClosed) return closedHTML();
      return '<div class="evt-page" data-evt-root><div role="alert"><p>' + esc(state.liveError || '活动没有载入') + '</p><button type="button" class="button" data-evt-act="retry">重试</button></div></div>';
    }
    return '<div class="evt-page" data-evt-root><p>正在读取活动…</p></div>';
  }

  function page() {
    if (isLive() && state.liveError) return liveStateHTML('error');
    if (isLive() && !state.live) return liveStateHTML('loading');
    var parts = pathParts();
    if (parts[0] === 'campaigns') return campaignsPage();
    if (parts[0] === 'campaign') return campaignPage(decodeURIComponent(parts[1] || ''));
    if (parts[0] === 'event') return eventPage(decodeURIComponent(parts[1] || ''));
    return eventsPage();
  }

  function loadLive() {
    if (!isLive() || !window.CommonsAPI || state.liveLoading) return;
    state.liveLoading = true;
    state.liveError = '';
    Promise.all([
      window.CommonsAPI.get('/events'),
      window.CommonsAPI.get('/events/campaigns')
    ]).then(function (rows) {
      var events = rows[0].data;
      var campaigns = rows[1].data;
      state.live = {
        viewer: {},
        people: {},
        events: Array.isArray(events) ? events : (events && events.items) || [],
        campaigns: Array.isArray(campaigns) ? campaigns : (campaigns && campaigns.items) || []
      };
      state.liveLoading = false;
      if (window.Commons && typeof window.Commons.refresh === 'function') window.Commons.refresh();
    }).catch(function (error) {
      state.live = null;
      state.liveLoading = false;
      state.liveClosed = !!(error && (error.status === 501 || error.code === 'capability_unavailable'));
      state.liveError = state.liveClosed ? 'closed' : ((error && error.message) || '活动没有载入');
      if (window.Commons && typeof window.Commons.refresh === 'function') window.Commons.refresh();
    });
  }

  function mount() {
    var root = document.querySelector('[data-evt-root]');
    if (!root) return;
    if (state.bound) destroy();
    state.root = root;
    root.addEventListener('click', onClick);
    root.addEventListener('error', onCoverError, true);
    root.querySelectorAll('img[data-evt-fallback]').forEach(function (img) {
      if (img.complete && !img.naturalWidth) onCoverError({ target: img });
    });
    state.bound = true;
    var parts = pathParts();
    var id = decodeURIComponent(parts[1] || '');
    if (isLive() && !state.live && !state.liveError && !state.liveLoading) loadLive();
    if (isLive() && state.live && (parts[0] === 'event' || parts[0] === 'campaign') && id && !state.detail[id]) {
      loadDetail(id).then(function () { if (state.root && state.root.getAttribute('data-evt-id') === id) refresh(); });
    }
    if ((parts[0] === 'event' || parts[0] === 'campaign') && id) mountThread(findItem(id));
    if (reduced()) root.setAttribute('data-reduced', 'true');
    startHeroTimer();
  }

  function destroy() {
    if (!state.bound || !state.root) return;
    state.root.removeEventListener('click', onClick);
    state.root.removeEventListener('error', onCoverError, true);
    stopHeroTimer();
    var dialog = state.root.querySelector('[data-evt-share]');
    if (dialog && dialog.open && dialog.close) dialog.close();
    if (window.CommonsThread && typeof window.CommonsThread.destroy === 'function') {
      var host = state.root.querySelector('[data-evt-thread]');
      if (host) window.CommonsThread.destroy(host);
    }
    state.root = null;
    state.bound = false;
  }

  window.CommonsEvents = {
    routes: { events: page, event: page, campaigns: page, campaign: page },
    hub: ['events', 'campaigns'],
    nav: [
      ['events', '活动专区', 'flag', 'projects'],
      ['campaigns', '打榜', 'rank', 'projects']
    ],
    icons: { flag: FLAG, rank: CHART },
    mount: mount,
    destroy: destroy
  };
  (window.CommonsPages = window.CommonsPages || []).push(window.CommonsEvents);
  if (window.CommonsLinks && typeof window.CommonsLinks.provide === 'function') {
    window.CommonsLinks.provide('event', function (handle) {
      var count = allItems().filter(function (item) {
        return (item.participants || []).some(function (row) {
          var who = person(row.id || row);
          return who.handle === handle;
        });
      }).length;
      return count ? { label: '活动报名', href: '#/events', count: count, icon: 'flag' } : null;
    });
  }
})();
