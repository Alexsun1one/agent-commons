/* R13 HOME-2 · 活动日历：月视图、列表、本机提醒、可复制 ICS。 */
(function () {
  'use strict';

  var STORE = 'calendar.reminders.v1';
  var VIEW_STORE = 'calendar.view.v1';
  var ICONS = {
    calendar: 'M5 4h14a1 1 0 0 1 1 1v15H4V5a1 1 0 0 1 1-1m0 6h16M8 2v4M16 2v4M8 14h2m4 0h2m-8 4h2m4 0h2',
    prev: 'M15 6 9 12l6 6',
    next: 'M9 6l6 6-6 6'
  };
  var TYPE_LABEL = {
    room: '讨论房间',
    talk: '讲堂',
    workshop: '工作坊',
    bounty: '悬赏截止',
    season: '赛季节点'
  };
  var WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];
  var TYPES = ['all', 'room', 'talk', 'workshop', 'bounty', 'season'];
  var TYPE_FILTER = {
    all: '全部',
    room: '讨论房间',
    talk: '讲堂',
    workshop: '工作坊',
    bounty: '悬赏截止',
    season: '赛季节点'
  };
  var state = { view: 'month', year: 2026, month: 9, filter: 'all', selected: null, subscribe: false, openId: null };
  var bound = false;
  var narrowMedia = null;
  var drawerOpener = null;

  function C() { return window.Commons || {}; }

  function esc(value) {
    if (C().esc) return C().esc(String(value == null ? '' : value));
    return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function safeUrl(value) {
    if (C().safeUrl) return C().safeUrl(value);
    var s = String(value == null ? '' : value).trim();
    return /^(?:(?!\/\/)[^:\\\/?#]*(?:[\/?#]|$)|https?:|mailto:|data:image\/)/i.test(s) ? esc(s) : '#';
  }

  /* safe-fn: CommonsLinks.person/a 自行转义；降级分支只使用本函数转义后的字段。 */
  function personLink(handle, name, level) {
    if (window.CommonsLinks && typeof window.CommonsLinks.person === 'function') {
      return window.CommonsLinks.person(handle, name, { level: level });
    }
    return handle ? '<a class="lk-person" href="#/u/' + encodeURIComponent(handle) + '">' + esc(name) + '</a>' : esc(name);
  }

  function eventKind(ev) {
    return ev.type === 'room' ? 'room' : ev.type === 'talk' ? 'talk' : ev.type === 'bounty' ? 'bounty' : ev.type === 'season' ? 'campaign' : 'event';
  }

  function eventHref(ev) {
    var id = ev.targetId || ev.id;
    if (window.CommonsLinks && typeof window.CommonsLinks.href === 'function') {
      var shared = window.CommonsLinks.href(eventKind(ev), id);
      if (shared) return shared;
    }
    return ev.href || '#/calendar';
  }

  function eventLink(ev, label, cls) {
    var kind = eventKind(ev);
    var id = ev.targetId || ev.id;
    if (window.CommonsLinks && typeof window.CommonsLinks.href === 'function' && typeof window.CommonsLinks.a === 'function' && window.CommonsLinks.href(kind, id)) {
      return window.CommonsLinks.a(kind, id, label, cls || 'cal-event-link');
    }
    return '<a class="' + esc(cls || 'cal-event-link') + '" href="' + safeUrl(eventHref(ev)) + '">' + esc(label) + '</a>';
  }

  function icon(name, size) {
    var px = size || 18;
    var shared = window.CommonsIcons && window.CommonsIcons.svg ? window.CommonsIcons.svg(name, { size: px }) : '';
    var own = ICONS[name] || ICONS.calendar;
    if (shared) return shared;
    return '<svg viewBox="0 0 24 24" width="' + /* safe: px is a local numeric icon size */ px + '" height="' + /* safe: px is a local numeric icon size */ px + '" aria-hidden="true"><path d="' + /* safe: own 取自本文件 ICONS 常量表 */ own + '" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }

  function isNarrow() {
    return !!(window.matchMedia && window.matchMedia('(max-width: 390px)').matches);
  }

  function pad(n) { return n < 10 ? '0' + n : String(n); }

  function dateKey(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function parseDate(iso) {
    var d = new Date(iso);
    return isNaN(d.getTime()) ? null : d;
  }

  function isLive() {
    return !!(window.CommonsAPI && window.CommonsAPI.mode === 'live');
  }
  var liveBag = { data: null, error: '', loading: false, request: 0, from: '', to: '' };
  function sample() {
    if (isLive()) return liveBag.data || { events: [], types: [], subscribeHint: '' };
    return window.COMMONS_CALENDAR_SAMPLE || { events: [], types: [], subscribeHint: '' };
  }

  function events() {
    var list = sample().events;
    return Array.isArray(list) ? list : [];
  }

  function reminders() {
    var saved = C().read ? C().read(STORE, []) : [];
    return Array.isArray(saved) ? saved : [];
  }

  function writeReminders(ids) {
    return !!(C().write && C().write(STORE, ids));
  }

  function isReminded(id) {
    return reminders().indexOf(id) !== -1;
  }

  function toggleRemind(id) {
    var ids = reminders().slice();
    var i = ids.indexOf(id);
    if (i === -1) ids.push(id);
    else ids.splice(i, 1);
    if (writeReminders(ids)) {
      if (C().toast) C().toast(i === -1 ? '已记下提醒（只留在本机）' : '已取消提醒');
      refresh();
    }
  }

  function filtered() {
    return events().filter(function (ev) {
      return state.filter === 'all' || ev.type === state.filter;
    }).slice().sort(function (a, b) {
      return String(a.start).localeCompare(String(b.start));
    });
  }

  function eventsOn(key) {
    return filtered().filter(function (ev) {
      var d = parseDate(ev.start);
      return d && dateKey(d) === key;
    });
  }

  function formatTime(iso) {
    var d = parseDate(iso);
    if (!d) return '';
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function formatDay(iso) {
    var d = parseDate(iso);
    if (!d) return '';
    return (d.getMonth() + 1) + '.' + pad(d.getDate());
  }

  function typeLabel(type) {
    return TYPE_LABEL[type] || TYPE_FILTER[type] || '活动';
  }

  function monthLabel() {
    return state.year + ' 年 ' + (state.month + 1) + ' 月';
  }

  function todayKey() {
    return dateKey(new Date());
  }

  function shiftMonth(delta) {
    if (isNarrow() && state.view !== 'list') {
      shiftWeek(delta);
      return;
    }
    var m = state.month + delta;
    var y = state.year;
    if (m < 0) { m = 11; y -= 1; }
    if (m > 11) { m = 0; y += 1; }
    state.year = y;
    state.month = m;
    state.selected = null;
    persistView();
    if (isLive()) loadLive();
    else refresh();
  }

  function weekAnchor() {
    if (state.selected) {
      var picked = parseDate(state.selected + 'T12:00:00');
      if (picked) return picked;
    }
    var today = new Date();
    if (today.getFullYear() === state.year && today.getMonth() === state.month) return today;
    return new Date(state.year, state.month, 1);
  }

  function weekCells() {
    var anchor = weekAnchor();
    var startPad = (anchor.getDay() + 6) % 7;
    var start = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() - startPad);
    var cells = [];
    var i;
    for (i = 0; i < 7; i += 1) {
      cells.push(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
    }
    return cells;
  }

  function shiftWeek(delta) {
    var cells = weekCells();
    var start = cells[0];
    var next = new Date(start.getFullYear(), start.getMonth(), start.getDate() + delta * 7);
    state.year = next.getFullYear();
    state.month = next.getMonth();
    state.selected = dateKey(next);
    persistView();
    if (isLive()) loadLive();
    else refresh();
  }

  function weekLabel() {
    var cells = weekCells();
    return (cells[0].getMonth() + 1) + '.' + pad(cells[0].getDate()) + ' – ' +
      (cells[6].getMonth() + 1) + '.' + pad(cells[6].getDate());
  }

  function persistView() {
    if (C().write) C().write(VIEW_STORE, { view: state.view, year: state.year, month: state.month, filter: state.filter });
  }

  function restoreView() {
    var saved = C().read ? C().read(VIEW_STORE, null) : null;
    if (!saved || typeof saved !== 'object') return;
    if (saved.view === 'list' || saved.view === 'month') state.view = saved.view;
    if (typeof saved.year === 'number') state.year = saved.year;
    if (typeof saved.month === 'number' && saved.month >= 0 && saved.month <= 11) state.month = saved.month;
    if (saved.filter && TYPE_FILTER[saved.filter]) state.filter = saved.filter;
  }

  function monthCells() {
    var first = new Date(state.year, state.month, 1);
    var startPad = (first.getDay() + 6) % 7;
    var start = new Date(state.year, state.month, 1 - startPad);
    var cells = [];
    var i;
    for (i = 0; i < 42; i += 1) {
      var d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      cells.push(d);
    }
    return cells;
  }

  function icsStamp(d) {
    return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + 'T' +
      pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + 'Z';
  }

  function icsEscape(text) {
    return String(text == null ? '' : text).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
  }

  function kicker() {
    return isLive() ? '' : '<span class="cal-kicker">示例</span>';
  }

  function icsText() {
    var lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Agent Commons//HOME-2//ZH',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:先锋队活动日历' + (isLive() ? '' : '（示例）')
    ];
    filtered().forEach(function (ev) {
      var start = parseDate(ev.start);
      var end = parseDate(ev.end) || start;
      if (!start) return;
      lines.push('BEGIN:VEVENT');
      lines.push('UID:' + icsEscape(ev.id) + '@commons.local');
      lines.push('DTSTAMP:' + icsStamp(new Date()));
      lines.push('DTSTART:' + icsStamp(start));
      lines.push('DTEND:' + icsStamp(end));
      lines.push('SUMMARY:' + icsEscape((isLive() ? '' : '[示例] ') + ev.title));
      lines.push('DESCRIPTION:' + icsEscape((typeLabel(ev.type) + ' · ' + (ev.summary || '')).slice(0, 180)));
      if (ev.place) lines.push('LOCATION:' + icsEscape(ev.place));
      lines.push('END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    return lines.join('\n');
  }

  function findEvent(id) {
    var list = events();
    var i;
    for (i = 0; i < list.length; i += 1) {
      if (list[i].id === id) return list[i];
    }
    return null;
  }

  function eventChipHTML(ev) {
    return '<button class="cal-chip" type="button" data-cal-action="open" data-id="' + esc(ev.id) + '" data-type="' + esc(ev.type) + '">' +
      '<i class="cal-chip-bar" aria-hidden="true"></i>' +
      '<span class="cal-chip-time">' + esc(formatTime(ev.start)) + '</span>' +
      '<span class="cal-chip-title">' + esc(ev.title) + '</span>' +
      '</button>';
  }

  function eventHTML(ev) {
    var reminded = isReminded(ev.id);
    return '<article class="cal-event' + (reminded ? ' is-reminded' : '') + '" data-type="' + esc(ev.type) + '">' +
      '<div class="cal-event-copy"><div class="cal-event-meta"><span class="chip" data-type="' + esc(ev.type) + '">' + esc(typeLabel(ev.type)) + '</span>' +
      '<span>' + esc(formatDay(ev.start)) + ' ' + esc(formatTime(ev.start)) + '</span>' +
      (ev.place ? '<span>' + esc(ev.place) + '</span>' : '') +
      '</div>' +
      '<h3>' + /* safe: eventLink returns escaped or CommonsLinks-owned HTML */ eventLink(ev, ev.title) + '</h3>' +
      '<p>' + esc(ev.summary || '') + '</p></div>' +
      '<div class="cal-event-actions">' +
      '<a class="button primary small" href="' + safeUrl(eventHref(ev)) + '">打开</a>' +
      '<button class="button ' + (reminded ? 'tonal' : 'ghost') + ' small" type="button" data-cal-action="remind" data-id="' + esc(ev.id) + '" aria-pressed="' + (reminded ? 'true' : 'false') + '">' +
      (reminded ? '已提醒' : '提醒我') + '</button>' +
      '</div></article>';
  }

  function dayButton(d) {
    var key = dateKey(d);
    var other = d.getMonth() !== state.month;
    var today = key === todayKey();
    var selected = key === state.selected;
    var list = eventsOn(key);
    var dots = list.slice(0, 3).map(function (ev) {
      return '<i class="cal-dot" data-type="' + esc(ev.type) + '"></i>';
    }).join('');
    var extra = list.length > 3 ? '<span class="cal-more">+' + (list.length - 3) + '</span>' : '';
    return '<button class="cal-day' + (other ? ' is-other' : '') + (today ? ' is-today' : '') + (selected ? ' is-selected' : '') + '" type="button" data-cal-action="select" data-value="' + esc(key) + '" aria-pressed="' + (selected ? 'true' : 'false') + '" aria-label="' + esc(key) + '，' + list.length + ' 项">' +
      '<b>' + d.getDate() + '</b><span class="cal-dots">' + dots + extra + '</span></button>';
  }

  function monthDayCell(d) {
    var key = dateKey(d);
    var other = d.getMonth() !== state.month;
    var today = key === todayKey();
    var selected = key === state.selected;
    var list = eventsOn(key);
    var dots = list.slice(0, 3).map(function (ev) {
      return '<i class="cal-dot" data-type="' + esc(ev.type) + '"></i>';
    }).join('');
    var extraDots = list.length > 3 ? '<span class="cal-more">+' + (list.length - 3) + '</span>' : '';
    var shown = list.slice(0, 2);
    var rest = list.length - shown.length;
    var bars = shown.map(eventChipHTML).join('');
    if (rest > 0) {
      bars += '<button class="cal-more-btn" type="button" data-cal-action="select" data-value="' + esc(key) + '">还有 ' + rest + ' 项</button>';
    }
    return '<article class="cal-day' + (other ? ' is-other' : '') + (today ? ' is-today' : '') + (selected ? ' is-selected' : '') + '" data-cal-action="select" data-date="' + esc(key) + '" data-value="' + esc(key) + '">' +
      '<button class="cal-day-num" type="button" data-cal-action="select" data-value="' + esc(key) + '" aria-pressed="' + (selected ? 'true' : 'false') + '" aria-label="' + esc(key) + '，' + list.length + ' 项"><b>' + d.getDate() + '</b></button>' +
      '<span class="cal-dots">' + dots + extraDots + '</span>' +
      '<div class="cal-day-events">' + bars + '</div></article>';
  }

  function monthHTML() {
    var cells = monthCells();
    var selected = state.selected ? eventsOn(state.selected) : [];
    return '<section class="cal-month" aria-label="' + esc(monthLabel()) + '">' +
      '<div class="cal-weekdays">' + WEEKDAYS.map(function (w) { return '<span>' + w + '</span>'; }).join('') + '</div>' +
      '<div class="cal-grid">' + cells.map(monthDayCell).join('') + '</div></section>' +
      (state.selected ? '<section class="cal-list" aria-label="当天活动"><div class="cal-day-label">' + esc(state.selected) + '</div>' +
        (selected.length ? selected.map(eventHTML).join('') : '<div class="cal-empty"><h3>这一天没有活动</h3><p>换一天，或把筛选改回全部。</p></div>') +
        '</section>' : '');
  }

  function drawerHTML() {
    var ev = state.openId ? findEvent(state.openId) : null;
    if (!ev) return '';
    var reminded = isReminded(ev.id);
    var when = esc(formatDay(ev.start)) + ' ' + esc(formatTime(ev.start));
    return '<button class="cal-drawer-scrim" type="button" data-cal-drawer data-cal-action="close-drawer" aria-label="关闭详情"></button>' +
      '<aside class="cal-drawer" data-cal-drawer role="dialog" aria-modal="true" aria-labelledby="cal-drawer-title">' +
      '<header class="cal-drawer-head"><span class="chip" data-type="' + esc(ev.type) + '">' + esc(typeLabel(ev.type)) + '</span>' +
      '<button class="button ghost small" type="button" data-cal-action="close-drawer">关闭</button></header>' +
      '<div class="cal-drawer-body">' + kicker() + +
      '<h2 id="cal-drawer-title" tabindex="-1">' + /* safe: eventLink returns escaped or CommonsLinks-owned HTML */ eventLink(ev, ev.title, 'cal-drawer-link') + '</h2>' +
      '<p>' + when + (ev.place ? ' · ' + esc(ev.place) : '') + '</p>' +
      '<p>' + esc(ev.summary || '') + '</p>' +
      (ev.host ? '<p>主持 · ' + /* safe: personLink returns escaped or CommonsLinks-owned HTML */ personLink(ev.host_handle, ev.host, ev.host_level) + '</p>' : '') +
      '</div>' +
      '<div class="cal-drawer-actions">' +
      '<a class="button primary" href="' + safeUrl(eventHref(ev)) + '">打开</a>' +
      '<button class="button ' + (reminded ? 'tonal' : 'ghost') + '" type="button" data-cal-action="remind" data-id="' + esc(ev.id) + '" aria-pressed="' + (reminded ? 'true' : 'false') + '">' +
      (reminded ? '已提醒' : '提醒我') + '</button>' +
      '</div></aside>';
  }

  function paintDrawer() {
    var root = document.querySelector('[data-calendar-root]');
    if (!root) return;
    var host = root.querySelector('[data-cal-drawer-host]');
    if (!host) {
      host = document.createElement('div');
      host.setAttribute('data-cal-drawer-host', '');
      root.appendChild(host);
    }
    host.innerHTML = drawerHTML();
    if (state.openId) {
      var title = host.querySelector('#cal-drawer-title');
      if (title) title.focus({ preventScroll: true });
    }
  }

  function openDrawer(id, opener) {
    if (!id || !findEvent(id)) return;
    if (state.openId === id) {
      closeDrawer();
      return;
    }
    state.openId = id;
    drawerOpener = opener || document.activeElement;
    paintDrawer();
  }

  function closeDrawer() {
    var opener = drawerOpener;
    state.openId = null;
    drawerOpener = null;
    paintDrawer();
    if (opener && opener.isConnected && opener.focus) opener.focus({ preventScroll: true });
  }

  function weekHTML() {
    var cells = weekCells();
    var keys = {};
    cells.forEach(function (d) { keys[dateKey(d)] = true; });
    var weekEvents = filtered().filter(function (ev) {
      var d = parseDate(ev.start);
      return d && keys[dateKey(d)];
    });
    var selected = state.selected ? eventsOn(state.selected) : weekEvents;
    var label = state.selected || weekLabel();
    return '<section class="cal-week" aria-label="' + esc(weekLabel()) + '">' +
      '<div class="cal-weekdays">' + WEEKDAYS.map(function (w) { return '<span>' + w + '</span>'; }).join('') + '</div>' +
      '<div class="cal-week-grid">' + cells.map(dayButton).join('') + '</div></section>' +
      '<section class="cal-list" aria-label="本周活动"><div class="cal-day-label">' + esc(label) + '</div>' +
      (selected.length ? selected.map(eventHTML).join('') : '<div class="cal-empty"><h3>这几天没有活动</h3><p>换一周，或把筛选改回全部。</p></div>') +
      '</section>';
  }

  function listHTML() {
    var list = filtered();
    if (!list.length) {
      return '<div class="cal-empty"><h3>没有符合筛选的活动</h3><p>' + (isLive() ? '换个筛选条件，或稍后再来看。' : '示例日历覆盖房间、讲堂、工作坊、悬赏和赛季节点。') + '</p></div>';
    }
    return '<section class="cal-list">' + list.map(function (ev, i) {
      var key = formatDay(ev.start);
      var prev = i ? formatDay(list[i - 1].start) : '';
      var label = key !== prev ? '<div class="cal-day-label">' + esc(key) + '</div>' : '';
      return label + eventHTML(ev);
    }).join('') + '</section>';
  }

  function subscribeHTML() {
    if (!state.subscribe) return '';
    var hint = sample().subscribeHint || '沙箱不能下载文件。把 ICS 文本复制到日历应用。';
    return '<section class="cal-subscribe" data-cal-subscribe><h2>订阅日历</h2><p>' + esc(hint) + '</p>' +
      '<label class="field"><span>ICS 文本' + (isLive() ? '' : '（示例）') + '</span><textarea data-cal-ics readonly rows="12"></textarea></label>' +
      '<div class="cal-toolbar"><button class="button primary" type="button" data-cal-action="copy-ics">复制文本</button>' +
      '<button class="button ghost" type="button" data-cal-action="subscribe">收起</button></div></section>';
  }

  function toolbarHTML() {
    return '<div class="cal-toolbar">' +
      '<div class="cal-month-nav">' +
      '<button class="button icon-only ghost" type="button" data-cal-action="prev" aria-label="' + (isNarrow() && state.view !== 'list' ? '上一周' : '上个月') + '">' + icon('prev', 16) + '</button>' +
      '<strong>' + esc(isNarrow() && state.view !== 'list' ? weekLabel() : monthLabel()) + '</strong>' +
      '<button class="button icon-only ghost" type="button" data-cal-action="next" aria-label="' + (isNarrow() && state.view !== 'list' ? '下一周' : '下个月') + '">' + icon('next', 16) + '</button>' +
      '<button class="button ghost small" type="button" data-cal-action="today">今天</button>' +
      '</div>' +
      '<div class="segmented" aria-label="日历视图">' +
      '<button class="' + (state.view === 'month' ? 'selected' : '') + '" type="button" data-cal-action="view" data-value="month" aria-pressed="' + (state.view === 'month' ? 'true' : 'false') + '">' + (isNarrow() ? '周视图' : '月视图') + '</button>' +
      '<button class="' + (state.view === 'list' ? 'selected' : '') + '" type="button" data-cal-action="view" data-value="list" aria-pressed="' + (state.view === 'list' ? 'true' : 'false') + '">列表</button>' +
      '</div>' +
      '<div class="cal-filters" role="group" aria-label="活动类型">' +
      TYPES.map(function (id) {
        return '<button class="chip' + (state.filter === id ? ' selected' : '') + '" type="button" data-cal-action="filter" data-value="' + id + '" aria-pressed="' + (state.filter === id ? 'true' : 'false') + '">' + esc(TYPE_FILTER[id]) + '</button>';
      }).join('') +
      '</div>' +
      '<button class="button tonal" type="button" data-cal-action="subscribe" aria-expanded="' + (state.subscribe ? 'true' : 'false') + '">订阅说明</button>' +
      '</div>';
  }

  function bodyHTML() {
    return '<div class="cal-head"><p>房间、讲堂、工作坊和赛季节点。</p>' + kicker() + '</div>' +
      toolbarHTML() +
      subscribeHTML() +
      (state.view === 'list' ? listHTML() : (isNarrow() ? weekHTML() : monthHTML()));
  }

  function page() {
    restoreView();
    if (isLive() && liveBag.closed) {
      return '<main class="cal-page" data-calendar-root><div class="cal-empty" role="status"><p>这个功能还没开放</p><p>管理员还没打开。</p></div></main>';
    }
    if (isLive() && liveBag.error) {
      return '<main class="cal-page" data-calendar-root><div role="alert"><p>' + esc(liveBag.error) + '</p><button type="button" class="button" data-cal-action="retry">重试</button></div></main>';
    }
    if (isLive() && !liveBag.data) {
      return '<main class="cal-page" data-calendar-root><p>正在读取日历…</p></main>';
    }
    return '<main class="cal-page" data-calendar-root>' + bodyHTML() + '</main>';
  }

  function fillIcs() {
    var ta = document.querySelector('[data-cal-ics]');
    if (ta) ta.value = icsText();
  }

  function refresh() {
    var root = document.querySelector('[data-calendar-root]');
    if (!root) return;
    root.innerHTML = bodyHTML();
    fillIcs();
    paintDrawer();
  }

  function copyIcs() {
    var ta = document.querySelector('[data-cal-ics]');
    var text = ta ? ta.value : icsText();
    var done = function () { if (C().toast) C().toast('已复制 ICS 文本'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(function () {
        if (ta) { ta.focus(); ta.select(); }
      });
      return;
    }
    if (ta) { ta.focus(); ta.select(); }
    if (C().toast) C().toast('请手动复制文本框里的内容');
  }

  function onClick(event) {
    var action = event.target.closest('[data-cal-action]');
    if (!action) return;
    var type = action.dataset.calAction;
    if (type === 'retry') { liveBag.error = ''; liveBag.closed = false; loadLive(); return; }
    if (type === 'prev') shiftMonth(-1);
    else if (type === 'next') shiftMonth(1);
    else if (type === 'today') {
      var now = new Date();
      state.year = now.getFullYear();
      state.month = now.getMonth();
      state.selected = todayKey();
      persistView();
      if (isLive()) loadLive();
      else refresh();
    } else if (type === 'view') {
      state.view = action.dataset.value === 'list' ? 'list' : 'month';
      persistView();
      if (isLive()) loadLive();
      else refresh();
    } else if (type === 'filter') {
      state.filter = TYPE_FILTER[action.dataset.value] ? action.dataset.value : 'all';
      persistView();
      refresh();
    } else if (type === 'select') {
      state.selected = state.selected === action.dataset.value ? null : action.dataset.value;
      refresh();
    } else if (type === 'open') openDrawer(action.dataset.id, action);
    else if (type === 'close-drawer') closeDrawer();
    else if (type === 'remind') toggleRemind(action.dataset.id);
    else if (type === 'subscribe') {
      state.subscribe = !state.subscribe;
      refresh();
    } else if (type === 'copy-ics') copyIcs();
  }

  function onNarrowChange() {
    if (document.querySelector('[data-calendar-root]')) refresh();
  }

  function onKey(event) {
    if (event.key === 'Escape' && state.openId) {
      event.preventDefault();
      closeDrawer();
    }
  }

  function isoDay(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T00:00:00';
  }

  function calendarQuery() {
    var start;
    var end;
    if (isNarrow() && state.view !== 'list') {
      var cells = weekCells();
      start = cells[0];
      end = new Date(cells[6].getFullYear(), cells[6].getMonth(), cells[6].getDate() + 1);
    } else {
      start = new Date(state.year, state.month, 1);
      end = new Date(state.year, state.month + 1, 1);
    }
    return { from: isoDay(start), to: isoDay(end) };
  }

  function isClosed(err) {
    return !!(err && (err.status === 501 || err.code === 'capability_unavailable'));
  }

  function loadLive() {
    if (!isLive() || !window.CommonsAPI) return;
    var query = calendarQuery();
    if (liveBag.loading && liveBag.from === query.from && liveBag.to === query.to) return;
    liveBag.loading = true;
    liveBag.error = '';
    liveBag.closed = false;
    liveBag.from = query.from;
    liveBag.to = query.to;
    var ticket = ++liveBag.request;
    window.CommonsAPI.get('/events/calendar', query).then(function (response) {
      if (ticket !== liveBag.request) return;
      var payload = response && response.data;
      liveBag.data = {
        events: Array.isArray(payload) ? payload : (payload && payload.events) || [],
        types: (payload && payload.types) || [],
        subscribeHint: ''
      };
      liveBag.loading = false;
      liveBag.closed = false;
      refresh();
    }).catch(function (error) {
      if (ticket !== liveBag.request) return;
      liveBag.data = null;
      liveBag.loading = false;
      liveBag.closed = isClosed(error);
      liveBag.error = liveBag.closed ? 'closed' : ((error && error.message) || '日历没有载入');
      refresh();
    });
  }

  function mount() {
    if (!document.querySelector('[data-calendar-root]') || bound) return;
    restoreView();
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    if (window.matchMedia) {
      narrowMedia = window.matchMedia('(max-width: 390px)');
      if (narrowMedia.addEventListener) narrowMedia.addEventListener('change', onNarrowChange);
      else if (narrowMedia.addListener) narrowMedia.addListener(onNarrowChange);
    }
    bound = true;
    fillIcs();
    paintDrawer();
    if (isLive() && !liveBag.data && !liveBag.error && !liveBag.loading) loadLive();
  }

  function destroy() {
    if (!bound) return;
    document.removeEventListener('click', onClick);
    document.removeEventListener('keydown', onKey);
    if (narrowMedia) {
      if (narrowMedia.removeEventListener) narrowMedia.removeEventListener('change', onNarrowChange);
      else if (narrowMedia.removeListener) narrowMedia.removeListener(onNarrowChange);
      narrowMedia = null;
    }
    bound = false;
    state.subscribe = false;
    state.openId = null;
    drawerOpener = null;
  }

  window.CommonsCalendar = {
    routes: { calendar: page },
    hub: ['calendar'],
    nav: [['calendar', '活动日历', 'calendar', 'projects']],
    icons: { calendar: ICONS.calendar },
    mount: mount,
    destroy: destroy
  };
  (window.CommonsPages = window.CommonsPages || []).push(window.CommonsCalendar);
})();
