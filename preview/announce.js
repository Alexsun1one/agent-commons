/* R13 ANNOUNCE-1 · 公告条、跑马灯、广告位、公告中心和管理面板。 */
(function () {
  'use strict';

  var STORE = 'announce.demo.v2';
  var PLACEMENTS = ['hot-side', 'events', 'market-8', 'games-foot'];
  var ROOTS = '[data-announce-root],[data-announce-chrome],[data-announce-marquee],[data-announce-ad],[data-announce-admin],[data-announce-account],[data-announce-admin-host]';
  var state = {
    filter: 'all', tab: 'items', bound: false, reduced: false, index: 0, raf: 0, timer: 0,
    screenAd: false, media: null, remote: null, error: '', loading: false, day: '',
    month: null, draft: { level: 'normal', title: '', body: '', dismissible: true }, hover: false, focused: false,
    paused: false, lastTs: 0
  };

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
    });
  }

  function safeUrl(value) {
    if (window.Commons && typeof window.Commons.safeUrl === 'function') return window.Commons.safeUrl(value);
    var text = String(value == null ? '' : value).trim();
    return /^(?:(?!\/\/)[^:\\/?#]*(?:[/?#]|$)|https?:|mailto:|data:image\/)/i.test(text) ? esc(text) : '#';
  }

  function live() { return !!(window.CommonsAPI && window.CommonsAPI.mode === 'live'); }
  function sample() { return JSON.parse(JSON.stringify(window.COMMONS_ANNOUNCE_SAMPLE || { viewer: { level: 1, member: false }, items: [], ticker: [], campaigns: [] })); }
  function toast(message) { if (window.Commons && window.Commons.toast) window.Commons.toast(message); }

  function read() {
    var base = sample();
    var saved = window.Commons && window.Commons.read ? window.Commons.read(STORE, null) : null;
    if (!saved || saved.v !== 1) {
      return {
        v: 1, dismissed: [], marqueeOn: true, adsOn: true, caps: {}, counts: {},
        viewer: base.viewer, items: base.items, ticker: base.ticker, campaigns: base.campaigns, demo: true
      };
    }
    saved.dismissed = saved.dismissed || [];
    saved.caps = saved.caps || {};
    saved.counts = saved.counts || {};
    saved.viewer = saved.viewer || base.viewer;
    saved.items = saved.items || base.items;
    saved.ticker = saved.ticker || base.ticker;
    saved.campaigns = saved.campaigns || base.campaigns;
    if (saved.marqueeOn == null) saved.marqueeOn = true;
    if (saved.adsOn == null) saved.adsOn = true;
    saved.demo = true;
    return saved;
  }

  function write(data) {
    return !!(window.Commons && window.Commons.write && window.Commons.write(STORE, data));
  }

  function view() { return live() ? state.remote : read(); }

  function ts(value) {
    var n = Date.parse(value || '');
    return isNaN(n) ? null : n;
  }

  function inWindow(row, now) {
    var start = ts(row.startsAt);
    var end = ts(row.endsAt);
    if (start != null && start > now) return false;
    if (end != null && end <= now) return false;
    return true;
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function dayKey(time) {
    var d = time ? new Date(time) : new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function shortDate(value) {
    var n = ts(value);
    if (n == null) return '';
    var d = new Date(n);
    return (d.getMonth() + 1) + '.' + d.getDate();
  }

  function spanText(row) {
    var start = shortDate(row.startsAt);
    var end = shortDate(row.endsAt);
    return end ? start + '–' + end : start;
  }

  function levelName(level) {
    if (level === 'important') return '重要';
    if (level === 'maintenance') return '维护';
    return '普通';
  }

  function levelClass(level) {
    if (level === 'important' || level === 'maintenance' || level === 'normal') return level;
    return 'normal';
  }

  function levelRank(level) { return level === 'important' ? 0 : level === 'maintenance' ? 1 : 2; }

  function placementName(id) {
    if (id === 'hot-side') return '热点页侧栏';
    if (id === 'events') return '活动专区';
    if (id === 'market-8') return '市集列表第 8 位';
    if (id === 'games-foot') return '游戏中心底部';
    return '';
  }

  function placementClass(id) { return PLACEMENTS.indexOf(id) >= 0 ? id : ''; }

  function audienceOk(row, viewer) {
    var person = viewer || {};
    if (!row.audience || row.audience === 'site') return true;
    if (row.audience === 'level') return (person.level || 1) >= (row.minLevel || 1);
    if (row.audience === 'group') return !!person.groupId && person.groupId === row.groupId;
    return false;
  }

  function canHide(data) {
    if (!data) return false;
    if (data.canHideAds === true) return true;
    var person = data.viewer || {};
    return person.level >= 3 || person.member === true;
  }

  function currentRoute() {
    return String((location.hash || '').replace(/^#\/?/, '').split('?')[0]);
  }

  function adsBlocked(route) {
    var parts = String(route == null ? currentRoute() : route).replace(/^#\/?/, '').split('?')[0].split('/').filter(Boolean);
    if (!parts.length) return false;
    if (parts[0] === 'read' || parts[0] === 'write' || parts[0] === 'exam') return true;
    if (parts[0] === 'talk' && parts[1] && parts[1] !== 'new') return true;
    return parts.indexOf('replay') >= 0;
  }

  function currentItem(data) {
    var now = Date.now();
    var rows = (data.items || []).filter(function (row) {
      return row.status === 'active' && inWindow(row, now) && audienceOk(row, data.viewer) && data.dismissed.indexOf(row.id) < 0;
    });
    rows.sort(function (a, b) {
      var rank = levelRank(a.level) - levelRank(b.level);
      return rank || (ts(b.startsAt) - ts(a.startsAt));
    });
    return rows[0] || null;
  }

  function tickerOf(data) {
    if (!data.marqueeOn) return [];
    var now = Date.now();
    return (data.ticker || []).filter(function (row) {
      return row.enabled !== false && row.public !== false && inWindow(row, now);
    }).sort(function (a, b) { return (a.position || 0) - (b.position || 0); });
  }

  function pickAd(data, placement) {
    var now = Date.now();
    var day = dayKey();
    var rows = (data.campaigns || []).filter(function (row) {
      return row.placement === placement && row.status === 'active' && inWindow(row, now);
    }).sort(function (a, b) { return ts(b.startsAt) - ts(a.startsAt); });
    for (var i = 0; i < rows.length; i += 1) {
      var seen = data.caps[rows[i].id + ':' + day] || 0;
      if (seen < (rows[i].freqCap || 3)) return rows[i];
    }
    return null;
  }

  function statOf(data, ad) {
    var extra = data.counts && data.counts[ad.id] ? data.counts[ad.id] : {};
    return { impressions: (ad.impressions || 0) + (extra.impressions || 0), clicks: (ad.clicks || 0) + (extra.clicks || 0) };
  }

  function targetHref(row) {
    var target = row && row.target || {};
    if (target.kind && target.id && window.CommonsLinks && typeof window.CommonsLinks.href === 'function') {
      var shared = window.CommonsLinks.href(target.kind, target.id);
      if (shared) return shared;
    }
    return target.href || row && (row.href || row.link) || '';
  }

  function linkedCopy(row, body) {
    var href = targetHref(row);
    return href ? '<a class="announce-target" href="' + safeUrl(href) + '">' + /* safe: callers build body only from esc() output */ body + '</a>' : body;
  }

  function barHTML(item) {
    if (!item) return '';
    var close = item.dismissible ? '<button class="button ghost small announce-close" type="button" aria-label="关闭公告" data-announce-action="dismiss" data-id="' + esc(item.id) + '"><span aria-hidden="true">×</span></button>' : '';
    var copy = '<strong class="announce-title">' + esc(item.title) + '</strong><span class="announce-body"> ' + esc(item.body) + '</span>';
    return '<div class="announce-bar" data-announce-bar data-level="' + /* safe: levelClass 只返回普通/重要/维护 */ levelClass(item.level) + '"><span class="announce-level">' + esc(levelName(item.level)) + '</span><p>' +
      /* safe: linkedCopy only wraps module-escaped copy in a sanitized target */ linkedCopy(item, copy) + '</p>' + close + '</div>';
  }

  function marqueeHTML(data) {
    var items = tickerOf(data);
    if (!items.length) return '';
    var reduced = state.reduced || motionReduced();
    var body = items.map(function (row) {
      var copy = esc(row.body);
      return targetHref(row)
        ? '<a class="announce-marquee-item" href="' + safeUrl(targetHref(row)) + '">' + copy + '</a>'
        : '<span class="announce-marquee-item is-static">' + copy + '</span>';
    }).join('');
    var cloneBody = items.map(function (row) {
      var copy = esc(row.body);
      return targetHref(row)
        ? '<a class="announce-marquee-item" href="' + safeUrl(targetHref(row)) + '" tabindex="-1">' + copy + '</a>'
        : '<span class="announce-marquee-item is-static">' + copy + '</span>';
    }).join('');
    var paused = state.hover || state.focused || state.paused;
    var control = '<button class="button ghost small announce-marquee-toggle" type="button" data-announce-action="marquee-toggle" aria-pressed="' + esc(String(state.paused)) + '"' +
      (reduced ? ' aria-disabled="true" disabled' : '') + '>' + (reduced ? '已静止' : state.paused ? '播放' : '暂停') + '</button>';
    if (reduced) {
      return '<div class="announce-marquee is-reduced" data-announce-marquee data-paused="1"><span class="announce-marquee-label">短讯</span>' +
        '<div class="announce-marquee-static" role="list">' + items.map(function (row) {
          var copy = esc(row.body);
          return '<span role="listitem">' + (targetHref(row) ? '<a class="announce-marquee-item" href="' + safeUrl(targetHref(row)) + '">' + copy + '</a>' : copy) + '</span>';
        }).join('') + '</div>' + control + '<span class="sr-only" role="status" data-announce-motion-status></span></div>';
    }
    return '<div class="announce-marquee" data-announce-marquee data-paused="' + (paused ? '1' : '0') + '"><span class="announce-marquee-label">短讯</span>' +
      '<div class="announce-marquee-viewport"><div class="announce-marquee-track" data-announce-track><span class="announce-marquee-copy">' + body + '</span>' +
      '<span class="announce-marquee-copy" aria-hidden="true">' + cloneBody + '</span></div></div>' + control +
      '<span class="sr-only" role="status" data-announce-motion-status></span></div>';
  }

  function chrome() {
    var data = view();
    if (!data) return '';
    var bar = barHTML(currentItem(data));
    var lamp = marqueeHTML(data);
    if (!bar && !lamp) return '';
    return '<div class="announce-chrome" data-announce-chrome>' + bar + lamp + '</div>';
  }

  function adHTML(ad) {
    return '<aside class="announce-ad" data-announce-ad data-id="' + esc(ad.id) + '" data-placement="' + /* safe: placementClass 只返回四个广告位枚举 */ placementClass(ad.placement) + '"><a href="' + safeUrl(ad.link) + '"><img alt="" src="' + safeUrl(ad.image) + '"><span class="announce-ad-line">' + esc(ad.line) + '</span></a><p class="announce-ad-meta"><span class="announce-sponsor">赞助</span><span>为什么看到这个：' + esc(ad.why) + '</span></p></aside>';
  }

  function adSlot(placement, route) {
    var place = placementClass(placement);
    if (!place || state.screenAd) return '';
    var data = view();
    if (!data || data.adsOn === false || data.adsHidden || adsBlocked(route)) return '';
    var ad = pickAd(data, place);
    if (!ad) return '';
    state.screenAd = true;
    return adHTML(ad);
  }

  function badge() {
    var data = view();
    return data && data.demo ? '<span class="announce-sample">示例</span>' : '';
  }

  function historyRows(data) {
    var now = Date.now();
    return (data.items || []).filter(function (row) {
      if (row.status === 'draft') return false;
      var start = ts(row.startsAt);
      if (start != null && start > now) return false;
      if (!audienceOk(row, data.viewer)) return false;
      var current = row.status === 'active' && inWindow(row, now);
      if (state.filter === 'current') return current;
      if (state.filter === 'past') return !current;
      return true;
    });
  }

  function rowHTML(row, data) {
    var dismissed = data.dismissed.indexOf(row.id) >= 0;
    var now = Date.now();
    var current = row.status === 'active' && inWindow(row, now) && !dismissed;
    var action = current && row.dismissible ? '<button class="button ghost small" type="button" data-announce-action="dismiss" data-id="' + esc(row.id) + '">关闭</button>' : '<span class="announce-muted">' + (dismissed ? '已关闭' : '') + '</span>';
    var copy = '<h2>' + esc(row.title) + '</h2><p>' + esc(row.body) + '</p>';
    return '<article class="announce-row"><span class="announce-level">' + esc(levelName(row.level)) + '</span><div>' +
      /* safe: linkedCopy only wraps module-escaped copy in a sanitized target */ linkedCopy(row, copy) + '</div><div>' + action + '<time>' + esc(spanText(row)) + '</time></div></article>';
  }

  function pageBody() {
    if (state.loading && !view()) return '<p class="announce-muted">正在载入。</p>';
    if (state.error && !view()) return '<div class="announce-error"><p>' + esc(state.error) + '</p><button class="button" type="button" data-announce-action="retry">重试</button></div>';
    var data = view();
    if (!data) return '';
    var rows = historyRows(data);
    var filters = [['all', '全部'], ['current', '生效中'], ['past', '已结束']].map(function (pair) {
      var on = state.filter === pair[0];
      return '<button class="chip' + (on ? ' selected' : '') + '" type="button" aria-pressed="' + (on ? 'true' : 'false') + '" data-announce-action="filter" data-value="' + /* safe: 筛选值来自本函数写死的三档 */ pair[0] + '">' + esc(pair[1]) + '</button>';
    }).join('');
    var list = rows.length ? '<div class="announce-list">' + rows.map(function (row) { return rowHTML(row, data); }).join('') + '</div>' : '<div class="announce-empty"><p>还没有公告。</p><a class="button primary" href="#/home">回到发现</a></div>';
    return '<div class="announce-head"><span>生效中与已结束的公告</span><div class="announce-filters" role="group" aria-label="公告范围">' + filters + '</div>' + badge() + '</div>' + list + accountSection();
  }

  function page() { return '<main class="announce-page" data-announce-root>' + pageBody() + '</main>'; }

  function switchRow(key, label, checked, disabled) {
    return '<label class="announce-switch"><span>' + esc(label) + '</span><input type="checkbox" data-announce-pref="' + esc(key) + '"' + (checked ? ' checked' : '') + (disabled ? ' disabled' : '') + '></label>';
  }

  function accountSection() {
    var data = view() || read();
    var hide = canHide(data);
    return '<section class="announce-account" data-announce-account aria-label="公告和广告">' +
      switchRow('marquee', '跑马灯', data.marqueeOn !== false, false) +
      switchRow('ads', '广告', data.adsOn !== false, !hide && data.adsOn !== false) +
      '<button class="button ghost small" type="button" data-announce-action="tip" aria-expanded="' + (state.tip ? 'true' : 'false') + '">?</button>' +
      '<p class="announce-tip"' + (state.tip ? '' : ' hidden') + '>L3 或会员可关</p></section>';
  }

  function previewBar() {
    var draft = state.draft || {};
    return barHTML({ level: draft.level || 'normal', title: draft.title || '标题', body: draft.body || '正文', dismissible: draft.dismissible !== false, id: 'draft' });
  }

  function option(value, label, selected) {
    return '<option value="' + esc(value) + '"' + (selected ? ' selected' : '') + '>' + esc(label) + '</option>';
  }

  function itemForm() {
    var draft = state.draft;
    return '<form class="announce-form" data-announce-form="item"><div class="announce-form-row"><label class="field"><span>级别</span><select name="level" data-announce-field="level">' +
      option('normal', '普通', draft.level === 'normal') + option('important', '重要', draft.level === 'important') + option('maintenance', '维护', draft.level === 'maintenance') +
      '</select></label><label class="field"><span>受众</span><select name="audience">' +
      option('site', '全站', true) + option('level', '某等级以上', false) + option('group', '某小组', false) +
      '</select></label></div><label class="field"><span>标题</span><input name="title" maxlength="40" required data-announce-field="title" value="' + esc(draft.title || '') + '"></label><label class="field"><span>正文</span><input name="body" maxlength="160" required data-announce-field="body" value="' + esc(draft.body || '') + '"></label><div class="announce-form-row"><label class="field"><span>等级</span><input name="min_level" inputmode="numeric" maxlength="1"></label><label class="field"><span>小组</span><input name="group_id" maxlength="64"></label></div><div class="announce-form-row"><label class="field"><span>开始</span><input name="starts_at" type="datetime-local" required></label><label class="field"><span>结束</span><input name="ends_at" type="datetime-local"></label></div><label class="announce-switch"><span>可关闭</span><input name="dismissible" type="checkbox" checked data-announce-field="dismissible"></label><div class="announce-preview" data-announce-preview>' + previewBar() + '</div><button class="button primary" type="submit">发布</button></form>';
  }

  function queueHTML(data) {
    var rows = tickerOf(data).concat((data.ticker || []).filter(function (row) { return row.enabled === false; }));
    if (!rows.length) return '<div class="announce-empty"><p>队列是空的。</p></div>';
    return '<div class="announce-queue">' + rows.map(function (row) {
      var on = row.enabled !== false;
      return '<div class="announce-queue-row"><b>' + esc(row.body) + '</b><button class="button ghost small" type="button" data-announce-action="ticker" data-id="' + esc(row.id) + '" data-on="' + (on ? '1' : '0') + '">' + (on ? '停用' : '启用') + '</button></div>';
    }).join('') + '</div>';
  }

  function coversDay(row, day) {
    var start = ts(row.startsAt);
    var end = ts(row.endsAt);
    var from = ts(day + 'T00:00:00');
    var to = from + 86400000;
    if (start != null && start >= to) return false;
    if (end != null && end <= from) return false;
    return true;
  }

  function calendarHTML(data) {
    var anchor = state.month || new Date();
    var year = anchor.getFullYear();
    var month = anchor.getMonth();
    var first = new Date(year, month, 1);
    var offset = (first.getDay() + 6) % 7;
    var count = new Date(year, month + 1, 0).getDate();
    var cells = ['一', '二', '三', '四', '五', '六', '日'].map(function (label) { return '<span>' + label + '</span>'; }).join('');
    for (var i = 0; i < offset; i += 1) cells += '<span></span>';
    for (var day = 1; day <= count; day += 1) {
      var key = year + '-' + pad(month + 1) + '-' + pad(day);
      var hit = (data.campaigns || []).some(function (row) { return coversDay(row, key); });
      var pressed = state.day === key;
      cells += '<button type="button" data-announce-action="day" data-value="' + esc(key) + '" aria-pressed="' + (pressed ? 'true' : 'false') + '" class="' + (hit ? 'has' : '') + (pressed ? ' selected' : '') + '">' + day + '</button>';
    }
    return '<div class="announce-card"><div class="announce-admin-head"><h2>' + year + '-' + pad(month + 1) + '</h2><div><button class="button ghost small" type="button" data-announce-action="month" data-value="-1">上月</button><button class="button ghost small" type="button" data-announce-action="month" data-value="1">下月</button></div></div><div class="announce-cal">' + cells + '</div></div>';
  }

  function campaignRows(data) {
    var rows = data.campaigns || [];
    if (state.day) rows = rows.filter(function (row) { return coversDay(row, state.day); });
    if (!rows.length) return '<div class="announce-empty"><p>这个位置还没有活动。</p></div>';
    return '<div class="announce-campaigns">' + rows.map(function (row) {
      var stat = statOf(data, row);
      var on = row.status === 'active';
      return '<div class="announce-campaign-row"><div><b>' + esc(row.name) + '</b><p class="announce-muted">' + esc(placementName(row.placement)) + ' · 展示 ' + esc(stat.impressions) + ' · 点击 ' + esc(stat.clicks) + '</p></div><button class="button ghost small" type="button" data-announce-action="campaign" data-id="' + esc(row.id) + '" data-on="' + (on ? '1' : '0') + '">' + (on ? '暂停' : '投放') + '</button></div>';
    }).join('') + '</div>';
  }

  function campaignForm() {
    return '<form class="announce-form" data-announce-form="campaign"><div class="announce-form-row"><label class="field"><span>名称</span><input name="name" maxlength="40" required></label><label class="field"><span>位置</span><select name="placement">' +
      option('hot-side', '热点页侧栏', true) + option('events', '活动专区', false) + option('market-8', '市集列表第 8 位', false) + option('games-foot', '游戏中心底部', false) +
      '</select></label></div><label class="field"><span>一行字</span><input name="line" maxlength="36" required></label><label class="field"><span>图片</span><input name="image" required placeholder="assets/..."></label><label class="field"><span>链接</span><input name="link" required></label><label class="field"><span>为什么看到这个</span><input name="why" maxlength="40" required></label><div class="announce-form-row"><label class="field"><span>开始</span><input name="starts_at" type="datetime-local" required></label><label class="field"><span>结束</span><input name="ends_at" type="datetime-local" required></label></div><button class="button primary" type="submit">保存</button></form>';
  }

  function adminBody() {
    if (state.loading && !view()) return '<p class="announce-muted">正在载入。</p>';
    if (state.error && !view()) return '<div class="announce-error"><p>' + esc(state.error) + '</p><button class="button" type="button" data-announce-action="retry">重试</button></div>';
    var data = view();
    if (!data) return '';
    var tabs = [['items', '公告'], ['ticker', '短讯'], ['ads', '广告']].map(function (pair) {
      var on = state.tab === pair[0];
      return '<button class="' + (on ? 'selected' : '') + '" type="button" data-announce-action="tab" data-value="' + /* safe: 管理页三个写死页签 */ pair[0] + '" aria-pressed="' + on + '">' + esc(pair[1]) + '</button>';
    }).join('');
    var panel = state.tab === 'ticker'
      ? '<form class="announce-form" data-announce-form="ticker"><label class="field"><span>短讯</span><input name="body" maxlength="80" required></label><button class="button primary" type="submit">加上短讯</button></form>' + queueHTML(data)
      : state.tab === 'ads'
        ? campaignForm() + calendarHTML(data) + campaignRows(data)
        : itemForm() + '<div class="announce-list">' + (data.items || []).map(function (row) { return rowHTML(row, data); }).join('') + '</div>';
    return '<div class="announce-admin-head"><div>' + badge() + '<h1>公告管理</h1></div><div class="tabs" role="group" aria-label="公告管理分类">' + tabs + '</div></div>' + panel;
  }

  function adminRoute() { return '<div data-announce-admin-host></div>'; }

  function adminPanel(container) {
    if (!container) return;
    container.innerHTML = '<section class="announce-admin" data-announce-admin>' + adminBody() + '</section>';
  }

  function paint() {
    var active = document.activeElement;
    var keep = active && active.getAttribute ? {
      action: active.getAttribute('data-announce-action') || '',
      id: active.getAttribute('data-id') || '',
      value: active.getAttribute('data-value') || ''
    } : null;
    var root = document.querySelector('[data-announce-root]');
    if (root) root.innerHTML = pageBody();
    var admin = document.querySelector('[data-announce-admin]');
    if (admin) admin.innerHTML = adminBody();
    var account = document.querySelector('[data-announce-account]');
    if (account && !root && !admin) account.outerHTML = accountSection();
    var slot = document.getElementById('announce-slot');
    if (slot) slot.innerHTML = chrome();
    else {
      var chromeNode = document.querySelector('[data-announce-chrome]');
      if (chromeNode) chromeNode.outerHTML = chrome() || '';
    }
    startMotion();
    if (keep && keep.action) {
      var nodes = document.querySelectorAll('[data-announce-action="' + keep.action + '"]');
      var next = Array.prototype.find.call(nodes, function (node) {
        return (!keep.id || node.getAttribute('data-id') === keep.id) && (!keep.value || node.getAttribute('data-value') === keep.value);
      });
      if (next && next.focus) next.focus({ preventScroll: true });
    }
  }

  function localId(prefix) { return prefix + '-' + Date.now().toString(36); }

  function isoFromLocal(value) {
    if (!value) return null;
    var date = new Date(value);
    return isNaN(date.getTime()) ? null : date.toISOString();
  }

  function saveLocal(mutator) {
    var data = read();
    mutator(data);
    if (!write(data)) toast('没有保存下来。');
    else paint();
  }

  function api() { return window.CommonsAPI; }

  function afterWrite(promise) {
    promise.then(function () { state.error = ''; return refreshRemote(); }).catch(function (error) {
      toast((error && error.message) || '没有保存下来。');
    });
  }

  function dismiss(id) {
    if (live()) { afterWrite(api().post('/announce/items/' + encodeURIComponent(id) + '/dismiss', {})); return; }
    saveLocal(function (data) {
      var row = (data.items || []).filter(function (item) { return item.id === id; })[0];
      if (row && row.dismissible === false) { toast('这条公告不能关闭'); return; }
      if (data.dismissed.indexOf(id) < 0) data.dismissed.push(id);
    });
  }

  function setPref(key, on) {
    if (live()) {
      var data = view() || {};
      var body = { marquee_on: data.marqueeOn !== false, ads_on: data.adsOn !== false };
      body[key === 'ads' ? 'ads_on' : 'marquee_on'] = on;
      afterWrite(api().post('/announce/prefs', body));
      return;
    }
    saveLocal(function (data) {
      if (key === 'ads' && data.adsOn !== false && !on && !canHide(data)) { toast('L3 或会员才能关闭广告'); return; }
      if (key === 'ads') data.adsOn = on;
      else data.marqueeOn = on;
    });
  }

  function noteImpression(node) {
    if (!node || node.getAttribute('data-noted') === '1') return;
    node.setAttribute('data-noted', '1');
    var id = node.getAttribute('data-id');
    var placement = node.getAttribute('data-placement') || '';
    if (!id) return;
    if (live()) {
      api().post('/announce/campaigns/' + encodeURIComponent(id) + '/impression', { placement: placement, route: currentRoute() }).catch(function () {});
      return;
    }
    var data = read();
    var key = id + ':' + dayKey();
    data.caps[key] = (data.caps[key] || 0) + 1;
    data.counts[id] = data.counts[id] || { impressions: 0, clicks: 0 };
    data.counts[id].impressions += 1;
    write(data);
  }

  function noteClick(node) {
    var id = node.getAttribute('data-id');
    var placement = node.getAttribute('data-placement') || '';
    if (!id) return;
    if (live()) {
      api().post('/announce/campaigns/' + encodeURIComponent(id) + '/click', { placement: placement, route: currentRoute() }).catch(function () {});
      return;
    }
    var data = read();
    data.counts[id] = data.counts[id] || { impressions: 0, clicks: 0 };
    data.counts[id].clicks += 1;
    write(data);
  }

  function valueOf(form, name) {
    var field = form.elements[name];
    if (!field) return '';
    if (field.type === 'checkbox') return field.checked;
    return field.value;
  }

  function onSubmit(event) {
    var form = event.target.closest ? event.target.closest('[data-announce-form]') : null;
    if (!form) return;
    event.preventDefault();
    var kind = form.getAttribute('data-announce-form');
    if (kind === 'item') return saveItem(form);
    if (kind === 'ticker') return saveTicker(form);
    if (kind === 'campaign') return saveCampaign(form);
  }

  function saveItem(form) {
    var payload = {
      level: valueOf(form, 'level') || 'normal',
      title: String(valueOf(form, 'title') || '').trim(),
      body: String(valueOf(form, 'body') || '').trim(),
      audience: valueOf(form, 'audience') || 'site',
      minLevel: valueOf(form, 'min_level') ? Number(valueOf(form, 'min_level')) : null,
      groupId: String(valueOf(form, 'group_id') || '').trim() || null,
      dismissible: !!valueOf(form, 'dismissible'),
      startsAt: isoFromLocal(valueOf(form, 'starts_at')),
      endsAt: isoFromLocal(valueOf(form, 'ends_at')),
      status: 'active'
    };
    if (!payload.title || !payload.body || !payload.startsAt) { toast('标题、正文和开始时间要填。'); return; }
    if (live()) {
      afterWrite(api().post('/admin/announce/items', {
        level: payload.level, title: payload.title, body: payload.body, audience: payload.audience,
        min_level: payload.audience === 'level' ? payload.minLevel : null,
        group_id: payload.audience === 'group' ? payload.groupId : null,
        dismissible: payload.dismissible, starts_at: payload.startsAt, ends_at: payload.endsAt, status: 'active'
      }));
      return;
    }
    saveLocal(function (data) {
      payload.id = localId('a');
      data.items.unshift(payload);
    });
    state.draft = { level: 'normal', title: '', body: '', dismissible: true };
  }

  function saveTicker(form) {
    var body = String(valueOf(form, 'body') || '').trim();
    if (!body) return;
    if (live()) { afterWrite(api().post('/admin/announce/ticker', { body: body, kind: 'manual', public: true })); return; }
    saveLocal(function (data) {
      var next = data.ticker.reduce(function (max, row) { return Math.max(max, row.position || 0); }, 0) + 1;
      data.ticker.push({ id: localId('t'), kind: 'manual', body: body, public: true, enabled: true, position: next, startsAt: new Date().toISOString(), endsAt: null });
    });
  }

  function saveCampaign(form) {
    var payload = {
      name: String(valueOf(form, 'name') || '').trim(),
      placement: valueOf(form, 'placement'),
      line: String(valueOf(form, 'line') || '').trim(),
      image: String(valueOf(form, 'image') || '').trim(),
      link: String(valueOf(form, 'link') || '').trim(),
      why: String(valueOf(form, 'why') || '').trim(),
      startsAt: isoFromLocal(valueOf(form, 'starts_at')),
      endsAt: isoFromLocal(valueOf(form, 'ends_at'))
    };
    if (!payload.name || !payload.line || !payload.image || !payload.link || !payload.why || !payload.startsAt || !payload.endsAt) {
      toast('广告的字、图、链接和时间要填全。');
      return;
    }
    if (!placementClass(payload.placement)) { toast('投放位置不正确'); return; }
    if (live()) {
      afterWrite(api().post('/admin/announce/campaigns', {
        name: payload.name, placement: payload.placement, image_url: payload.image, line: payload.line,
        link_url: payload.link, why: payload.why, starts_at: payload.startsAt, ends_at: payload.endsAt, freq_cap: 3, status: 'active'
      }));
      return;
    }
    saveLocal(function (data) {
      payload.id = localId('c');
      payload.status = 'active';
      payload.freqCap = 3;
      payload.budgetCents = null;
      payload.impressions = 0;
      payload.clicks = 0;
      data.campaigns.unshift(payload);
    });
  }

  function onClick(event) {
    var adLink = event.target.closest ? event.target.closest('[data-announce-ad] a') : null;
    if (adLink) noteClick(adLink.closest('[data-announce-ad]'));
    var action = event.target.closest ? event.target.closest('[data-announce-action]') : null;
    if (!action) return;
    var type = action.getAttribute('data-announce-action');
    if (type === 'dismiss') { event.preventDefault(); dismiss(action.getAttribute('data-id')); }
    else if (type === 'filter') { state.filter = action.getAttribute('data-value'); paint(); }
    else if (type === 'tab') { state.tab = action.getAttribute('data-value'); paint(); }
    else if (type === 'tip') { state.tip = !state.tip; paint(); }
    else if (type === 'retry') { refreshRemote(); }
    else if (type === 'day') { state.day = state.day === action.getAttribute('data-value') ? '' : action.getAttribute('data-value'); paint(); }
    else if (type === 'month') {
      var base = state.month || new Date();
      state.month = new Date(base.getFullYear(), base.getMonth() + Number(action.getAttribute('data-value')), 1);
      paint();
    } else if (type === 'ticker') toggleTicker(action);
    else if (type === 'campaign') toggleCampaign(action);
    else if (type === 'marquee-toggle') {
      state.paused = !state.paused;
      paint();
      var status = document.querySelector('[data-announce-motion-status]');
      if (status) status.textContent = state.paused ? '短讯已暂停' : '短讯已播放';
    }
  }

  function toggleTicker(action) {
    var id = action.getAttribute('data-id');
    var on = action.getAttribute('data-on') !== '1';
    if (live()) { afterWrite(api().patch('/admin/announce/ticker/' + encodeURIComponent(id), { enabled: on })); return; }
    saveLocal(function (data) {
      data.ticker.forEach(function (row) { if (row.id === id) row.enabled = on; });
    });
  }

  function toggleCampaign(action) {
    var id = action.getAttribute('data-id');
    var on = action.getAttribute('data-on') !== '1';
    if (live()) { afterWrite(api().patch('/admin/announce/campaigns/' + encodeURIComponent(id), { status: on ? 'active' : 'paused' })); return; }
    saveLocal(function (data) {
      data.campaigns.forEach(function (row) { if (row.id === id) row.status = on ? 'active' : 'paused'; });
    });
  }

  function onChange(event) {
    var pref = event.target.getAttribute && event.target.getAttribute('data-announce-pref');
    if (pref) setPref(pref, !!event.target.checked);
    var field = event.target.getAttribute && event.target.getAttribute('data-announce-field');
    if (!field) return;
    if (field === 'dismissible') state.draft.dismissible = !!event.target.checked;
    else state.draft[field] = event.target.value;
    var preview = document.querySelector('[data-announce-preview]');
    if (preview) preview.innerHTML = previewBar();
  }

  function onHover(event) {
    var zone = event.target.closest ? event.target.closest('[data-announce-marquee]') : null;
    if (!zone) {
      if (!state.hover) return;
      state.hover = false;
    } else {
      var related = event.relatedTarget;
      if (related && zone.contains(related)) return;
      var inside = event.type === 'pointerover';
      if (inside === state.hover) return;
      state.hover = inside;
    }
    syncMotionPause();
  }

  function onFocus(event) {
    var zone = event.target.closest ? event.target.closest('[data-announce-marquee]') : null;
    if (event.type === 'focusin') state.focused = !!zone;
    else if (zone && event.relatedTarget && zone.contains(event.relatedTarget)) return;
    else state.focused = false;
    syncMotionPause();
  }

  function syncMotionPause() {
    var paused = state.hover || state.focused || state.paused;
    document.querySelectorAll('[data-announce-marquee]').forEach(function (node) {
      node.setAttribute('data-paused', paused ? '1' : '0');
    });
  }

  function motionReduced() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function onMotion() {
    state.reduced = motionReduced();
    paint();
  }

  function stopMotion() {
    if (state.raf) cancelAnimationFrame(state.raf);
    if (state.timer) clearInterval(state.timer);
    state.raf = 0;
    state.timer = 0;
  }

  function startMotion() {
    stopMotion();
    if (!document.querySelector('[data-announce-marquee]')) return;
    state.reduced = motionReduced();
    if (state.reduced) return;
    state.lastTs = 0;
    var frame = function (now) {
      var track = document.querySelector('[data-announce-track]');
      var paused = state.hover || state.focused || state.paused || (track && track.parentElement && track.closest('[data-announce-marquee]').getAttribute('data-paused') === '1');
      if (track && !paused) {
        var delta = state.lastTs ? Math.min(32, now - state.lastTs) : 16;
        var x = (Number(track.dataset.x) || 0) - delta * 0.04;
        var half = track.scrollWidth / 2;
        if (half > 1 && -x >= half) x += half;
        track.dataset.x = String(Math.round(x * 10) / 10);
        track.style.transform = 'translate3d(' + track.dataset.x + 'px,0,0)';
      }
      state.lastTs = now;
      state.raf = requestAnimationFrame(frame);
    };
    state.raf = requestAnimationFrame(frame);
  }

  function mapItem(row) {
    return {
      id: row.id, level: row.level, title: row.title, body: row.body, audience: row.audience || 'site',
      minLevel: row.min_level, groupId: row.group_id, dismissible: row.dismissible !== false,
      status: row.status || 'active', startsAt: row.starts_at || row.startsAt, endsAt: row.ends_at || row.endsAt,
      dismissed: row.dismissed === true,
      target: row.target || (row.target_kind || row.target_id || row.target_href ? { kind: row.target_kind, id: row.target_id, href: row.target_href } : null)
    };
  }

  function mapCampaign(row) {
    if (!row) return null;
    return {
      id: row.id, name: row.name, placement: row.placement, image: row.image_url || row.image,
      line: row.line, link: row.link_url || row.link, why: row.why, status: row.status || 'active',
      freqCap: row.freq_cap || 3, budgetCents: null, startsAt: row.starts_at || row.startsAt,
      endsAt: row.ends_at || row.endsAt, impressions: row.impressions || 0, clicks: row.clicks || 0
    };
  }

  function applyRemote(active, history, adminItems, adminTicker, adminCampaigns, stats) {
    var slots = active && active.ads ? active.ads.slots || {} : {};
    var campaigns = PLACEMENTS.map(function (id) { return mapCampaign(slots[id]); }).filter(Boolean);
    if (adminCampaigns && adminCampaigns.items) campaigns = adminCampaigns.items.map(mapCampaign);
    var items = history && history.items
      ? history.items.map(mapItem)
      : (active && active.announcement
        ? [mapItem(active.announcement)]
        : (adminItems && adminItems.items ? adminItems.items.map(mapItem) : []));
    var counts = {};
    (stats && stats.rows || []).forEach(function (row) {
      counts[row.campaign_id] = counts[row.campaign_id] || { impressions: 0, clicks: 0 };
      counts[row.campaign_id].impressions += row.impressions;
      counts[row.campaign_id].clicks += row.clicks;
    });
    state.remote = {
      demo: false,
      dismissed: items.filter(function (row) { return row.dismissed; }).map(function (row) { return row.id; }),
      marqueeOn: !(active && active.marquee && active.marquee.enabled === false),
      adsOn: !(active && active.ads && active.ads.hidden),
      adsHidden: !!(active && active.ads && (active.ads.blocked || active.ads.hidden)),
      canHideAds: !!(active && active.prefs && active.prefs.can_hide_ads),
      caps: {},
      counts: counts,
      viewer: { level: active && active.prefs && active.prefs.can_hide_ads ? 3 : 1, member: false },
      items: items,
      ticker: adminTicker && adminTicker.items ? adminTicker.items.map(function (row) {
        return { id: row.id, kind: row.kind, body: row.body, public: row.public !== false, enabled: row.enabled !== false, position: row.position || 0, startsAt: row.starts_at, endsAt: row.ends_at, target: row.target || null };
      }) : ((active && active.marquee && active.marquee.items) || []).map(function (row, index) {
        return { id: row.id, kind: row.kind, body: row.body, public: true, enabled: true, position: index + 1, startsAt: '1970-01-01T00:00:00.000Z', endsAt: null, target: row.target || null };
      }),
      campaigns: campaigns
    };
  }

  function refreshRemote() {
    if (!live()) return Promise.resolve();
    state.loading = true;
    state.error = '';
    var client = api();
    var jobs = [client.get('/announce/active', { route: currentRoute() })];
    var wantHistory = !!document.querySelector('[data-announce-root]');
    var wantAdmin = !!document.querySelector('[data-announce-admin],[data-announce-admin-host]');
    if (wantHistory) jobs.push(client.get('/announce/history'));
    if (wantAdmin) {
      jobs.push(client.get('/admin/announce/items'));
      jobs.push(client.get('/admin/announce/ticker'));
      jobs.push(client.get('/admin/announce/campaigns'));
      jobs.push(client.get('/admin/announce/stats'));
    }
    return Promise.all(jobs).then(function (rows) {
      var index = 0;
      var active = rows[index++].data;
      var history = wantHistory ? rows[index++].data : null;
      var items = wantAdmin ? rows[index++].data : null;
      var ticker = wantAdmin ? rows[index++].data : null;
      var campaigns = wantAdmin ? rows[index++].data : null;
      var stats = wantAdmin ? rows[index++].data : null;
      applyRemote(active, history, items, ticker, campaigns, stats);
      state.loading = false;
      paint();
    }).catch(function () {
      state.loading = false;
      state.error = '公告没有载入。';
      if (!state.remote) paint();
    });
  }

  function mount() {
    var host = document.querySelector('[data-announce-admin-host]');
    if (host && !host.querySelector('[data-announce-admin]')) adminPanel(host);
    if (!document.querySelector(ROOTS)) return;
    if (!state.bound) {
      document.addEventListener('click', onClick);
      document.addEventListener('change', onChange);
      document.addEventListener('submit', onSubmit);
      document.addEventListener('pointerover', onHover);
      document.addEventListener('pointerout', onHover);
      document.addEventListener('focusin', onFocus);
      document.addEventListener('focusout', onFocus);
      if (window.matchMedia) {
        state.media = window.matchMedia('(prefers-reduced-motion: reduce)');
        if (state.media.addEventListener) state.media.addEventListener('change', onMotion);
      }
      state.bound = true;
    }
    if (live()) refreshRemote();
    document.querySelectorAll('[data-announce-ad]').forEach(noteImpression);
    startMotion();
  }

  function destroy() {
    state.screenAd = false;
    state.hover = false;
    state.focused = false;
    stopMotion();
    if (!state.bound) return;
    document.removeEventListener('click', onClick);
    document.removeEventListener('change', onChange);
    document.removeEventListener('submit', onSubmit);
    document.removeEventListener('pointerover', onHover);
    document.removeEventListener('pointerout', onHover);
    document.removeEventListener('focusin', onFocus);
    document.removeEventListener('focusout', onFocus);
    if (state.media && state.media.removeEventListener) state.media.removeEventListener('change', onMotion);
    state.bound = false;
    state.media = null;
  }

  window.CommonsAnnounce = {
    routes: { announcements: page, 'announce-admin': adminRoute },
    hub: ['announcements'],
    nav: [['announcements', '公告', 'megaphone', 'personal']],
    titles: { announcements: '公告', 'announce-admin': '公告管理' },
    icons: { megaphone: 'M5 9v6h3l6 4V5L8 9H5zm9.5-2.5a5 5 0 0 1 0 7' },
    chrome: chrome,
    bar: function () { var data = view(); return data ? barHTML(currentItem(data)) : ''; },
    marquee: function () { var data = view(); return data ? marqueeHTML(data) : ''; },
    adSlot: adSlot,
    adminPanel: adminPanel,
    accountSection: accountSection,
    adsBlocked: adsBlocked,
    mount: mount,
    destroy: destroy
  };
  (window.CommonsPages = window.CommonsPages || []).push(window.CommonsAnnounce);
})();
