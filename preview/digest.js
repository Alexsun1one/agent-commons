/* R13 HOME-2 · 「今天」简报：你不在的时候发生了什么。 */
(function () {
  'use strict';

  var STORE = 'digest.demo.v1';
  var PANDA_DAY = 'assets/mascot/panda-main-front-1024.webp';
  var PANDA_NIGHT = 'assets/mascot/panda-avatar-night-sky-512.webp';
  var PANDA_CHEER = 'assets/mascot/panda-squad-512.webp';
  var WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];
  var ICONS = {
    spark: 'm12 2 2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5z',
    draft: 'M7 4h8l4 4v12H7zM15 4v4h4M9 12h6M9 16h4',
    reply: 'M4 5h16v10H9l-5 4V5M8 9h8M8 12h5',
    bounty: 'M12 3v18M7 8.5C7 6.6 8.8 5 12 5s5 1.4 5 3.5-2 3-5 3-5 1.1-5 3S8.8 21 12 21s5-1.6 5-3.5',
    question: 'M12 17h.01M9.5 9a2.5 2.5 0 1 1 3.8 2.1C12.4 12 12 12.6 12 13.2V14',
    soon: 'M12 7v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
    hot: 'M12 21a6 6 0 0 0 6-6c0-4-6-9-6-9S6 11 6 15a6 6 0 0 0 6 6z',
    drift: 'M3 20h18M4 15c3 0 4-7 8-7s5 5 8 3',
    library: 'M5 5h6v14H5zM13 8h6v11h-6zM7 8h2M7 11h2M15 11h2M15 14h2',
    solved: 'M4 12l5 5L20 6',
    check: 'M4 12l5 5L20 6'
  };
  var ICON_SHARED = {
    draft: 'in-progress',
    reply: 'discussion',
    bounty: 'help',
    question: 'question',
    soon: 'reminder',
    hot: 'trending',
    drift: 'distilled',
    library: 'organized',
    solved: 'resolved',
    spark: 'spark'
  };
  var KIND_LABEL = {
    draft: 'Agent 草稿',
    reply: '回我的消息',
    bounty: '悬赏快到期',
    question: '我可能能答',
    soon: '快开始',
    hot: '今日热点',
    drift: '话题漂移',
    library: '新收录',
    solved: '新解决'
  };
  var bound = false;
  var live = { cards: null, error: '', loading: false };

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

  function personLink(handle, name, level) {
    if (window.CommonsLinks && typeof window.CommonsLinks.person === 'function') {
      return window.CommonsLinks.person(handle, name, { level: level });
    }
    return handle ? '<a class="lk-person" href="#/u/' + encodeURIComponent(handle) + '">' + esc(name) + '</a>' : esc(name);
  }

  function objectLink(kind, id, label) {
    if (window.CommonsLinks && typeof window.CommonsLinks.a === 'function') return window.CommonsLinks.a(kind, id, label);
    var roots = { thread: 'threads', talk: 'talk', room: 'room', skill: 'skills', prompt: 'prompts', knowledge: 'knowledge' };
    return id && roots[kind]
      ? '<a class="lk-object" href="#/' + roots[kind] + '/' + encodeURIComponent(id) + '">' + esc(label) + '</a>'
      : '<span>' + esc(label) + '</span>';
  }

  function icon(name, size) {
    var px = size || 18;
    var sharedName = ICON_SHARED[name] || name;
    var shared = '';
    if (window.CommonsIcons && window.CommonsIcons.svg) {
      shared = window.CommonsIcons.svg(sharedName, { size: px }) || '';
      if (!shared && sharedName !== name) shared = window.CommonsIcons.svg(name, { size: px }) || '';
    }
    var own = ICONS[name] || ICONS.spark;
    if (shared) return shared;
    return '<svg viewBox="0 0 24 24" width="' + /* safe: px is a local numeric icon size */ px + '" height="' + /* safe: px is a local numeric icon size */ px + '" aria-hidden="true"><path d="' + /* safe: own 取自本文件 ICONS 常量表 */ own + '" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }

  function isLive() {
    return !!(window.CommonsAPI && window.CommonsAPI.mode === 'live');
  }

  function now() { return new Date(); }

  function hourNow() { return now().getHours(); }

  function isNight() { return hourNow() < 6; }

  function greeting() {
    var h = hourNow();
    if (h < 6) return '还没睡？';
    if (h < 12) return '早上好';
    if (h < 18) return '下午好';
    return '晚上好';
  }

  function pandaSrc() { return isNight() ? PANDA_NIGHT : PANDA_DAY; }

  function defaultStore() {
    return {
      lastVisit: new Date(now().getTime() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      seen: [],
      cleared: false
    };
  }

  function readStore() {
    var saved = C().read ? C().read(STORE, null) : null;
    if (!saved || typeof saved !== 'object') return defaultStore();
    return {
      lastVisit: saved.lastVisit || defaultStore().lastVisit,
      seen: Array.isArray(saved.seen) ? saved.seen : [],
      cleared: saved.cleared === true
    };
  }

  function writeStore(data) {
    return !!(C().write && C().write(STORE, data));
  }

  function daysAway(iso) {
    var then = new Date(iso).getTime();
    if (isNaN(then)) return 3;
    return Math.max(0, Math.floor((now().getTime() - then) / 86400000));
  }

  function visitLine(store) {
    var days = daysAway(store.lastVisit);
    if (days <= 0) return '你今天已经来过。这期间：';
    if (days === 1) return '上次来是昨天，这期间：';
    return '上次来是 ' + days + ' 天前，这期间：';
  }

  function card(id, kind, bucket, title, body, href, action, sample, real, author, object) {
    return {
      id: id,
      kind: kind,
      bucket: bucket,
      title: title,
      body: body,
      href: href,
      action: action,
      sample: sample !== false,
      real: real === true,
      author: author || null,
      object: object || null
    };
  }

  function agentDrafts() {
    var out = [];
    var notify = window.COMMONS_NOTIFY_SAMPLE;
    if (notify && Array.isArray(notify.items)) {
      notify.items.forEach(function (item) {
        if (item.category === 'agent') {
          out.push(card('draft-' + item.id, 'draft', 'need', item.title, item.body, item.link || '#/agents', '去确认', true));
        }
      });
    }
    if (!out.length) {
      out.push(card('draft-fallback', 'draft', 'need', '墨白起草了一条回复', '关于「子代理读不到项目规则」的排查步骤，等你确认后才会发出。', '#/agents', '去确认', true));
    }
    return out;
  }

  function repliesToMe() {
    var out = [];
    var notify = window.COMMONS_NOTIFY_SAMPLE;
    if (notify && Array.isArray(notify.items)) {
      notify.items.forEach(function (item) {
        if (item.category === 'reply' || item.category === 'mention') {
          out.push(card('reply-' + item.id, 'reply', 'need', item.title, item.body, item.link || '#/threads', '去看', true));
        }
      });
    }
    var thread = window.COMMONS_THREAD_SAMPLE;
    if (thread && Array.isArray(thread.messages)) {
      var meId = thread.me && thread.me.id;
      var mine = {};
      thread.messages.forEach(function (msg) {
        if (msg.authorId === meId) mine[msg.id] = true;
      });
      thread.messages.forEach(function (msg) {
        if (msg.reply_to && mine[msg.reply_to] && msg.authorId !== meId) {
          var who = null;
          (thread.people || []).forEach(function (p) { if (p.id === msg.authorId) who = p; });
          out.push(card('thread-' + msg.id, 'reply', 'need', ((who && who.name) || '有人') + ' 回了你', msg.body, '#/threads/' + encodeURIComponent((thread.post && thread.post.id) || 'post-demo') + '?m=' + encodeURIComponent(msg.id), '去看', true, false, who, { kind: 'thread', id: (thread.post && thread.post.id) || 'post-demo', label: ((who && who.name) || '有人') + ' 回了你' }));
        }
      });
    }
    if (!out.length) {
      out.push(card('reply-fallback', 'reply', 'need', '松原回了你', '「有用」的 toast 文案要对齐等级制度。L1 举报照样进队列。', '#/threads', '去看', true, false, { handle: 'song-yuan', name: '松原', level: 5 }));
    }
    return out.slice(0, 3);
  }

  function daysUntil(iso) {
    var t = new Date(iso).getTime();
    if (isNaN(t)) return 99;
    return Math.ceil((t - now().getTime()) / 86400000);
  }

  function myBounties() {
    var out = [];
    var sample = window.COMMONS_BOUNTY_SAMPLE;
    var list = sample && Array.isArray(sample.bounties) ? sample.bounties : [];
    list.forEach(function (b) {
      if (b.status !== 'active') return;
      if (!(b.mine || (b.my_stake && b.my_stake > 0))) return;
      var left = b.deadline_at ? daysUntil(b.deadline_at) : 99;
      if (left > 7) return;
      var title = (b.object && b.object.title) || '我的悬赏';
      var when = left <= 0 ? '今天截止' : '还剩 ' + left + ' 天';
      out.push(card('bounty-' + b.id, 'bounty', 'need', title, when + ' · ' + (b.kind === 'promo' ? '推广' : '求助'), '#/bounties', '去处理', true));
    });
    if (!out.length) {
      out.push(card('bounty-fallback', 'bounty', 'need', 'tr-cli：终端里的翻译助手', '还剩 4 天 · 两个待审提交', '#/bounties', '去处理', true));
    }
    return out;
  }

  function answerableQuestions() {
    var out = [];
    var kb = window.COMMONS_KB_SAMPLE;
    var list = kb && Array.isArray(kb.problems) ? kb.problems : [];
    list.forEach(function (p) {
      if (p.status === 'pending') {
        out.push(card('kb-' + p.id, 'question', 'need', p.title, p.phenomenon, '#/solved/' + encodeURIComponent(p.id), '去答', true, false, p.author));
      }
    });
    if (!out.length) {
      out.push(card('kb-fallback', 'question', 'need', 'Node 构建时找不到本地模块', '本机开发正常，CI 执行构建时报模块不存在。', '#/solved', '去答', true));
    }
    return out.slice(0, 2);
  }

  function soonEvents() {
    var out = [];
    var rooms = window.COMMONS_ROOMS_SAMPLE;
    if (rooms && Array.isArray(rooms.rooms)) {
      rooms.rooms.forEach(function (r) {
        if (r.state === 'scheduled' && typeof r.startOffsetMin === 'number' && r.startOffsetMin >= 0 && r.startOffsetMin <= 24 * 60) {
          var mins = Math.max(1, r.startOffsetMin);
          out.push(card('room-' + r.id, 'soon', 'need', r.title, mins < 60 ? mins + ' 分钟后开始 · 讨论房间' : Math.round(mins / 60) + ' 小时后开始 · 讨论房间', '#/rooms', '去参加', true, false, null, { kind: 'room', id: r.id, label: r.title }));
        }
      });
    }
    var talks = window.COMMONS_TALKS_SAMPLE;
    if (talks && Array.isArray(talks.upcoming)) {
      talks.upcoming.slice(0, 1).forEach(function (t) {
        var speaker = (talks.speakers || []).find(function (person) { return person.id === t.speakerId; });
        out.push(card('talk-' + t.id, 'soon', 'need', t.title, (t.when || '') + ' ' + (t.time || '') + ' · 讲堂', '#/talks', '去报名', true, false, speaker, { kind: 'talk', id: t.id, label: t.title }));
      });
    }
    if (!out.length) {
      out.push(card('soon-fallback', 'soon', 'need', '调用轨迹复盘会', '42 分钟后开始 · 讨论房间', '#/rooms', '去参加', true));
    }
    return out.slice(0, 2);
  }

  function hotTop3() {
    var out = [];
    var hot = window.COMMONS_HOT_SAMPLE;
    var items = [];
    var events = {};
    if (hot && Array.isArray(hot.events)) {
      hot.events.forEach(function (event) { events[event.id] = event; });
    }
    if (hot && hot.digest && Array.isArray(hot.digest.sections)) {
      hot.digest.sections.forEach(function (sec) {
        (sec.items || []).forEach(function (it) {
          var event = events[it.event_id] || {};
          var original = event.title || it.title || '';
          items.push({
            title: event.title_zh || it.title_zh || original,
            text: (event.title_zh || it.title_zh) && original ? '原文 · ' + original : (it.summary_zh || it.text),
            heat: it.heat || 0,
            id: it.event_id
          });
        });
      });
    }
    items.sort(function (a, b) { return b.heat - a.heat; });
    items.slice(0, 3).forEach(function (it, i) {
      out.push(card('hot-' + (it.id || i), 'hot', 'watch', it.title, it.text, '#/hot', '去看', true));
    });
    if (!out.length) {
      out.push(card('hot-fallback', 'hot', 'watch', 'OpenAI 发布 GPT-5.5，长任务智能体更稳', '原文 · OpenAI releases GPT-5.5 with steadier long-running agent skills', '#/hot', '去看', true));
    }
    return out;
  }

  function driftSentence() {
    var d = window.COMMONS_INSIGHTS_DRIFT;
    if (!d || d.schemaVersion !== 1 || !d.risefall) {
      return card('drift-empty', 'drift', 'watch', '本周话题漂移', '漂移数据还没接上，这一句先空着。', '#/drift', '去看', false, false);
    }
    var entries = {};
    (d.entries || []).forEach(function (e) { entries[e.key] = e.label; });
    function name(key) { return entries[key] || key; }
    function side(board, label) {
      var up = board && board.rising && board.rising[0];
      var down = board && board.falling && board.falling[0];
      if (!up && !down) return '';
      var parts = [];
      if (up) parts.push('「' + name(up.key) + '」涨得最多');
      if (down) parts.push('「' + name(down.key) + '」降得最多');
      return label + '里' + parts.join('，');
    }
    var bits = [side(d.risefall.industries, '行业'), side(d.risefall.apps, '应用')].filter(Boolean);
    var text;
    if (!bits.length) text = '近 4 周和前 4 周比，没有哪个行业或应用的份额有可展示的变化。';
    else text = '近 4 周和前 4 周比，' + bits.join('；') + '。份额的分母是当周全部文字消息。';
    return card('drift-week', 'drift', 'watch', '本周话题漂移', text, '#/drift', '去看漂移', false, true);
  }

  function newLibrary() {
    var out = [];
    var lib = window.COMMONS_LIBRARY_SAMPLE;
    if (lib && Array.isArray(lib.skills) && lib.skills[0]) {
      out.push(card('skill-' + lib.skills[0].id, 'library', 'watch', lib.skills[0].name, lib.skills[0].summary, '#/skills/' + encodeURIComponent(lib.skills[0].id), '去看 Skill', true, false, { handle: lib.skills[0].authorHandle, name: lib.skills[0].author, level: lib.skills[0].authorLevel }, { kind: 'skill', id: lib.skills[0].id, label: lib.skills[0].name }));
    }
    if (lib && Array.isArray(lib.prompts) && lib.prompts[0]) {
      out.push(card('prompt-' + lib.prompts[0].id, 'library', 'watch', lib.prompts[0].name, lib.prompts[0].when, '#/prompts/' + encodeURIComponent(lib.prompts[0].id), '去看提示词', true, false, { handle: lib.prompts[0].authorHandle, name: lib.prompts[0].author, level: lib.prompts[0].authorLevel }, { kind: 'prompt', id: lib.prompts[0].id, label: lib.prompts[0].name }));
    }
    if (!out.length) {
      out.push(card('lib-fallback', 'library', 'watch', '需求切片器', '把模糊需求收敛成目标、对象、做与不做、验收四个槽位。', '#/skills', '去看 Skill', true));
    }
    return out.slice(0, 2);
  }

  function newlySolved() {
    var out = [];
    var kb = window.COMMONS_KB_SAMPLE;
    var list = kb && Array.isArray(kb.problems) ? kb.problems : [];
    var weekAgo = new Date(now().getTime() - 7 * 86400000);
    list.forEach(function (p) {
      if (p.status !== 'verified') return;
      var at = p.updated_at ? new Date(p.updated_at) : null;
      if (at && !isNaN(at.getTime()) && at < weekAgo) return;
      out.push(card('solved-' + p.id, 'solved', 'watch', p.title, p.root_cause, '#/solved/' + encodeURIComponent(p.id), '去看解法', true, false, p.author));
    });
    if (!out.length && kb && kb.stats) {
      out.push(card('solved-week', 'solved', 'watch', '本周新解决 ' + kb.stats.solvedThisWeek + ' 个问题', '问题库这一周刚核过的解法。', '#/solved', '去看', true));
    }
    if (!out.length) {
      out.push(card('solved-fallback', 'solved', 'watch', 'Python 脚本换台机器就找不到配置文件', '代码把开发者机器上的绝对路径写死了。', '#/solved', '去看解法', true));
    }
    return out.slice(0, 2);
  }

  function allCards() {
    if (isLive()) return Array.isArray(live.cards) ? live.cards : [];
    return []
      .concat(agentDrafts())
      .concat(repliesToMe())
      .concat(myBounties())
      .concat(answerableQuestions())
      .concat(soonEvents())
      .concat(hotTop3())
      .concat([driftSentence()])
      .concat(newLibrary())
      .concat(newlySolved());
  }

  function visibleCards(store) {
    var cards = allCards();
    if (store.cleared) return [];
    var seen = {};
    store.seen.forEach(function (id) { seen[id] = true; });
    return cards.filter(function (c) { return !seen[c.id]; });
  }

  function cardHTML(item) {
    var kind = KIND_LABEL[item.kind] || '简报';
    var mark = item.real ? '真实记录 · 匿名聚合' : '';
    return '<article class="dg-card" data-kind="' + esc(item.kind) + '" data-bucket="' + esc(item.bucket) + '" data-digest-id="' + esc(item.id) + '">' +
      '<span class="dg-mark" aria-hidden="true">' + icon(item.kind, 18) + '</span>' +
      '<div class="dg-copy"><div class="dg-meta"><span>' + esc(kind) + '</span>' + (mark ? '<span>' + esc(mark) + '</span>' : '') + '</div>' +
      '<h3>' + ( /* safe: objectLink 与 esc 均自行转义 */ (item.object ? objectLink(item.object.kind, item.object.id, item.object.label || item.title) : esc(item.title)) ) + '</h3>' +
      (item.author && item.author.name ? '<p class="dg-author">来自 ' + ( /* safe: personLink 自行转义 */ personLink(item.author.handle, item.author.name, item.author.level) ) + '</p>' : '') +
      '<p>' + esc(item.body) + '</p></div>' +
      '<div class="dg-actions">' +
      '<a class="button primary small" href="' + safeUrl(item.href) + '">' + esc(item.action) + '</a>' +
      '<button class="button ghost small" type="button" data-digest-action="seen" data-id="' + esc(item.id) + '">看过了</button>' +
      '</div></article>';
  }

  function listHTML(cards, compact) {
    var shown = compact ? cards.filter(function (c) { return c.bucket === 'need'; }).slice(0, 3) : cards;
    if (!shown.length) return '';
    return shown.map(cardHTML).join('');
  }

  function emptyHTML() {
    return '<div class="dg-empty" data-digest-empty>' +
      '<img src="' + safeUrl(PANDA_CHEER) + '" alt="" data-dg-img>' +
      
      '<p>暂时没有要处理的新变化。</p>' +
      '<button class="button tonal" type="button" data-digest-action="restore">再看一遍</button>' +
      '</div>';
  }

  function heroHTML(store, remaining) {
    return '<header class="dg-hero">' +
      '<div class="dg-panda"><img src="' + safeUrl(pandaSrc()) + '" alt="" data-dg-img></div>' +
      '<div class="dg-hero-copy"><span class="dg-kicker">今天' + (isLive() ? '' : ' · 示例') + '</span>' +
      '<h1>' + esc(greeting()) + '</h1>' +
      '<p>' + esc(visitLine(store)) + '</p>' +
      (remaining ? '<div class="dg-hero-actions">' +
        '<button class="button" type="button" data-digest-action="seen-all">全部看过</button>' +
        '<a class="button ghost" href="#/calendar">活动日历</a>' +
        '</div>' : '') +
      '</div></header>';
  }

  function sectionsHTML(cards) {
    var need = cards.filter(function (c) { return c.bucket === 'need'; });
    var watch = cards.filter(function (c) { return c.bucket === 'watch'; });
    var html = '';
    if (need.length) {
      html += '<section class="dg-section" aria-labelledby="dg-need"><div class="dg-section-head"><h2 id="dg-need">需要你做的</h2><span class="dg-count">' + need.length + '</span></div><div class="dg-list">' + listHTML(need, false) + '</div></section>';
    }
    if (watch.length) {
      html += '<section class="dg-section" aria-labelledby="dg-watch"><div class="dg-section-head"><h2 id="dg-watch">值得看的</h2><span class="dg-count">' + watch.length + '</span></div><div class="dg-list">' + listHTML(watch, false) + '</div></section>';
    }
    return html;
  }

  function pad(n) { return n < 10 ? '0' + n : String(n); }

  function dateKey(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function weekDates() {
    var today = now();
    var startPad = (today.getDay() + 6) % 7;
    var start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - startPad);
    var days = [];
    var i;
    for (i = 0; i < 7; i += 1) {
      days.push(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
    }
    return days;
  }

  function calendarEvents() {
    if (isLive()) return [];
    var sample = window.COMMONS_CALENDAR_SAMPLE;
    var list = sample && Array.isArray(sample.events) ? sample.events : [];
    return list;
  }

  function eventsOnDay(key) {
    return calendarEvents().filter(function (ev) {
      var d = ev && ev.start ? new Date(ev.start) : null;
      return d && !isNaN(d.getTime()) && dateKey(d) === key;
    });
  }

  function asideMeta() {
    if (isLive()) return { streakDays: 0, streakHint: '', weekMarks: [0, 0, 0, 0, 0, 0, 0] };
    var sample = window.COMMONS_CALENDAR_SAMPLE;
    var aside = sample && sample.aside && typeof sample.aside === 'object' ? sample.aside : {};
    var marks = Array.isArray(aside.weekMarks) ? aside.weekMarks : [1, 1, 0, 1, 1, 1, 1];
    return {
      streakDays: typeof aside.streakDays === 'number' ? aside.streakDays : 7,
      streakHint: aside.streakHint || '从上周三连续打开。只记在本机。',
      weekMarks: marks
    };
  }

  function miniCalHTML() {
    var days = weekDates();
    var today = dateKey(now());
    var cells = days.map(function (d, i) {
      var key = dateKey(d);
      var count = eventsOnDay(key).length;
      var cls = 'dg-mini-day' + (key === today ? ' is-today' : '') + (count ? ' has-event' : '');
      return '<a class="' + cls + '" href="#/calendar" aria-label="' + esc(key) + '，' + count + ' 项">' +
        '<span>' + WEEKDAYS[i] + '</span><b>' + d.getDate() + '</b>' +
        (count ? '<i class="dg-mini-dot" aria-hidden="true"></i>' : '<i class="dg-mini-dot is-empty" aria-hidden="true"></i>') +
        '</a>';
    }).join('');
    return '<section class="dg-side-card">' +
      '<div class="dg-meta"><span>本周日历</span></div>' +
      '<h2>点日期打开日历</h2>' +
      '<div class="dg-mini-week" aria-label="本周">' + cells + '</div>' +
      '<a class="button ghost small" href="#/calendar">打开活动日历</a>' +
      '</section>';
  }

  function streakHTML() {
    var meta = asideMeta();
    var days = Math.max(0, Math.min(99, meta.streakDays));
    var marks = meta.weekMarks;
    var dots = WEEKDAYS.map(function (label, i) {
      var on = Number(marks[i]) > 0;
      return '<span class="dg-streak-dot' + (on ? ' is-on' : '') + '" title="' + label + '"><i></i><small>' + label + '</small></span>';
    }).join('');
    return '<section class="dg-side-card">' +
      '<div class="dg-meta"><span>我的连续天数</span></div>' +
      '<p class="dg-streak-num">' + days + '</p>' +
      '<p>' + esc(meta.streakHint) + '</p>' +
      '<div class="dg-streak-row" aria-hidden="true">' + dots + '</div>' +
      '</section>';
  }

  function rhythmHTML() {
    var days = weekDates();
    var counts = days.map(function (d) { return eventsOnDay(dateKey(d)).length; });
    var max = 1;
    counts.forEach(function (n) { if (n > max) max = n; });
    var today = dateKey(now());
    var bars = days.map(function (d, i) {
      var n = counts[i];
      var pct = Math.max(8, Math.round((n / max) * 100));
      return '<div class="dg-rhythm-col' + (dateKey(d) === today ? ' is-today' : '') + '">' +
        '<i style="--dg-h:' + /* safe: pct is 8–100 from event counts */ pct + '%"></i>' +
        '<small>' + WEEKDAYS[i] + '</small></div>';
    }).join('');
    var total = counts.reduce(function (sum, n) { return sum + n; }, 0);
    return '<section class="dg-side-card">' +
      '<div class="dg-meta"><span>本周节奏</span></div>' +
      '<h2>本周 ' + total + ' 场活动</h2>' +
      '<div class="dg-rhythm" aria-hidden="true">' + bars + '</div>' +
      '<p>按天查看活动数。</p>' +
      '</section>';
  }

  function asideHTML() {
    return miniCalHTML() + streakHTML() + rhythmHTML();
  }

  function bodyHTML() {
    var store = readStore();
    var cards = visibleCards(store);
    if (!cards.length) return heroHTML(store, false) + emptyHTML();
    return heroHTML(store, true) + sectionsHTML(cards);
  }

  function liveErrorHTML() {
    if (live.error === 'closed') {
      return '<div class="dg-empty" role="status" data-digest-empty><p>这个功能还没开放</p><p>管理员还没打开。</p></div>';
    }
    return '<div class="dg-empty" role="alert" data-digest-empty><p>' + esc(live.error || '今天没有载入') + '</p>' +
      '<button class="button" type="button" data-digest-action="retry">重试</button></div>';
  }

  function liveLoadingHTML() {
    return '<div class="dg-empty" aria-live="polite"><p>正在读取今天…</p></div>';
  }

  function page() {
    if (isLive() && live.error) {
      return '<main class="dg-page" data-digest-root>' + liveErrorHTML() + '</main>';
    }
    if (isLive() && live.cards === null) {
      return '<main class="dg-page" data-digest-root>' + liveLoadingHTML() + '</main>';
    }
    return '<main class="dg-page" data-digest-root><div class="dg-layout"><div class="dg-main">' +
      bodyHTML() + '</div><aside class="dg-aside" aria-label="本周">' + asideHTML() + '</aside></div></main>';
  }

  function embedHTML() {
    if (isLive() && live.error) {
      return '<section class="dg-embed dg-embed-bar" data-digest-embed><p>' + esc(live.error || '今天没有载入') +
        '</p><button type="button" class="button small" data-digest-action="retry">重试</button></section>';
    }
    if (isLive() && live.cards === null) {
      return '<section class="dg-embed dg-embed-bar" data-digest-embed><p>正在读取今天…</p></section>';
    }
    var store = readStore();
    var cards = visibleCards(store);
    var need = cards.filter(function (c) { return c.bucket === 'need'; }).length;
    var watch = cards.filter(function (c) { return c.bucket === 'watch'; }).length;
    var line;
    if (!need && !watch) line = '你不在的时候：这期间的事你都看过了';
    else line = '你不在的时候：' + need + ' 件要你做 · ' + watch + ' 件值得看';
    return '<section class="dg-embed dg-embed-bar" data-digest-embed>' +
      '<p>' + esc(line) + '</p>' +
      '<a class="button ' + (need ? 'primary' : 'ghost') + ' small" href="#/today">打开今天</a>' +
      '</section>';
  }

  function bindImages(root) {
    (root || document).querySelectorAll('[data-dg-img]').forEach(function (img) {
      function fail() { img.hidden = true; }
      if (img.complete && !img.naturalWidth) fail();
      else img.addEventListener('error', fail, { once: true });
    });
  }

  function cardFromNotify(item, kind) {
    return card(String(item.id || kind), kind, 'need', item.title || '新通知', item.body || '', item.link || '#/notifications', '去看', false, true);
  }

  function loadLive() {
    if (!isLive() || !window.CommonsAPI) return;
    if (live.loading) return;
    live.loading = true;
    live.error = '';
    Promise.all([
      window.CommonsAPI.get('/notify/daily-digest').then(function (row) { return { ok: true, data: row.data }; }, function (error) { return { ok: false, error: error }; }),
      window.CommonsAPI.get('/feed/digest').then(function (row) { return { ok: true, data: row.data }; }, function (error) { return { ok: false, error: error }; })
    ]).then(function (rows) {
      if (!rows[0].ok && !rows[1].ok) {
        live.cards = null;
        live.loading = false;
        var first = rows[0].error;
        live.error = (first && (first.status === 501 || first.code === 'capability_unavailable')) ? 'closed' : ((first && first.message) || '今天没有载入');
        refresh();
        return;
      }
      var cards = [];
      var digest = rows[0].ok ? rows[0].data : null;
      ((digest && digest.categories) || []).forEach(function (group) {
        (group.items || []).forEach(function (item) {
          var kind = group.category === 'agent' ? 'draft' : (group.category === 'mention' ? 'reply' : (group.category || 'reply'));
          cards.push(cardFromNotify(item, kind));
        });
      });
      var feed = rows[1].ok ? rows[1].data : null;
      var hotItems = [];
      if (feed && Array.isArray(feed.sections)) {
        feed.sections.forEach(function (sec) { hotItems = hotItems.concat(sec.items || []); });
      } else if (feed && Array.isArray(feed.items)) hotItems = feed.items;
      hotItems.slice(0, 3).forEach(function (item) {
        cards.push(card('hot-' + (item.event_id || item.id || item.title), 'hot', 'watch', item.title || item.headline || '热点', item.excerpt || item.summary || '', '#/hot', '去看', false, true));
      });
      live.cards = cards;
      live.loading = false;
      live.error = '';
      refresh();
    });
  }

  function refresh() {
    var root = document.querySelector('[data-digest-root]');
    if (root) {
      if (isLive() && (live.error || live.cards === null)) {
        root.innerHTML = live.error ? liveErrorHTML() : liveLoadingHTML();
      } else {
        var main = root.querySelector('.dg-main');
        var aside = root.querySelector('.dg-aside');
        if (main) main.innerHTML = bodyHTML();
        else root.innerHTML = bodyHTML();
        if (aside) aside.innerHTML = asideHTML();
      }
      bindImages(root);
    }
    var embeds = document.querySelectorAll('[data-digest-embed]');
    embeds.forEach(function (node) {
      var holder = document.createElement('div');
      holder.innerHTML = embedHTML();
      if (holder.firstElementChild) node.replaceWith(holder.firstElementChild);
    });
  }

  function markSeen(id) {
    var store = readStore();
    if (store.seen.indexOf(id) === -1) store.seen.push(id);
    var left = visibleCards(store);
    if (!left.length) store.cleared = true;
    if (writeStore(store)) refresh();
  }

  function markAll() {
    var store = readStore();
    allCards().forEach(function (c) {
      if (store.seen.indexOf(c.id) === -1) store.seen.push(c.id);
    });
    store.cleared = true;
    if (writeStore(store)) refresh();
  }

  function restore() {
    var store = defaultStore();
    if (writeStore(store)) refresh();
  }

  function onClick(event) {
    var action = event.target.closest('[data-digest-action]');
    if (!action) return;
    var type = action.dataset.digestAction;
    if (type === 'seen') markSeen(action.dataset.id);
    else if (type === 'seen-all') markAll();
    else if (type === 'restore') restore();
    else if (type === 'retry') loadLive();
  }

  function mount() {
    var host = document.querySelector('[data-digest-host]');
    if (host && !host.querySelector('[data-digest-embed]')) render(host);
    if (!document.querySelector('[data-digest-root], [data-digest-embed]')) return;
    if (isLive() && live.cards === null && !live.loading) loadLive();
    bindImages(document);
    if (bound) return;
    document.addEventListener('click', onClick);
    bound = true;
  }

  function destroy() {
    if (!bound) return;
    document.removeEventListener('click', onClick);
    bound = false;
  }

  function render(container) {
    if (!container) return;
    container.innerHTML = embedHTML();
  }

  window.CommonsDigest = {
    routes: { today: page },
    nav: [['today', '今天', 'spark', 'discover']],
    icons: { spark: ICONS.spark },
    render: render,
    mount: mount,
    destroy: destroy
  };
  (window.CommonsPages = window.CommonsPages || []).push(window.CommonsDigest);
})();
