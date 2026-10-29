/* R13 TALK-1 · 讲堂 #/talks、回看 #/talk/<id>、准备 #/talk/new。
   登记 window.CommonsTalks，并 push 到 window.CommonsPages。
   播放走 CommonsMedia.player。录制、转写、翻译只展示合成槽位。 */
(function () {
  'use strict';

  var state = {
    root: null,
    page: '',
    talk: null,
    dir: 'all',
    tab: 'chapters',
    lang: 'zh',
    query: '',
    follow: true,
    time: 0,
    playing: false,
    chapter: -1,
    currentCue: null,
    pendingSeek: null,
    player: null,
    blob: null,
    poster: '',
    palette: null,
    boardHandle: null,
    boardLive: false,
    boardApplied: 0,
    mediaToken: 0,
    job: 0,
    unbind: [],
    programmatic: false,
    timer: freshTimer(),
    draft: null
  };

  var blobCache = {};

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function read(key, fallback) {
    try {
      if (window.Commons && window.Commons.read) return window.Commons.read(key, fallback);
    } catch (err) { /* 读不到就用默认 */ }
    return fallback;
  }

  function write(key, value) {
    try {
      if (window.Commons && window.Commons.write) return window.Commons.write(key, value) !== false;
    } catch (err) { /* 下面统一当失败 */ }
    return false;
  }

  function toast(message) {
    if (window.Commons && window.Commons.toast) window.Commons.toast(message);
  }

  function icon(name) {
    if (window.Commons && window.Commons.icon) return window.Commons.icon(name);
    return '';
  }

  function parts() {
    var hash = '';
    try { hash = String(location.hash || ''); } catch (err) { hash = ''; }
    return hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  }

  function isLive() {
    if (window.COMMONS_BUILD_LIVE === true) return true;
    return !(location.protocol === 'file:' || (window.COMMONS_BUILD && window.COMMONS_BUILD.mode === 'demo'));
  }
  function sample() {
    if (isLive()) return null;
    var data = window.COMMONS_TALKS_SAMPLE;
    if (!data || data.schema !== 'commons.talk.review/1' || !Array.isArray(data.talks)) return null;
    return data;
  }

  function talkById(id) {
    var data = sample();
    if (!data || !id) return null;
    for (var i = 0; i < data.talks.length; i++) if (data.talks[i].id === id) return data.talks[i];
    return null;
  }

  function personById(id) {
    var data = sample();
    var list = data && data.speakers || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function personLink(handle, name, level) {
    if (window.CommonsLinks && typeof window.CommonsLinks.person === 'function') {
      return window.CommonsLinks.person(handle, name, { level: level });
    }
    return handle ? '<a class="lk-person" href="#/u/' + encodeURIComponent(handle) + '">' + esc(name) + '</a>' : esc(name);
  }

  function objectLink(kind, id, label) {
    if (window.CommonsLinks && typeof window.CommonsLinks.a === 'function') return window.CommonsLinks.a(kind, id, label);
    var roots = { org: 'org', knowledge: 'knowledge', skill: 'skills', prompt: 'prompts', component: 'components', pattern: 'patterns', talk: 'talk' };
    return id && roots[kind]
      ? '<a class="lk-object" href="#/' + roots[kind] + '/' + encodeURIComponent(id) + '">' + esc(label) + '</a>'
      : '<span>' + esc(label) + '</span>';
  }

  function directionOf(id) {
    var data = sample();
    var list = data && data.directions || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return { id: id || '', label: id || '未分类', cat: 1 };
  }

  function clock(sec) {
    var s = Math.max(0, Math.round(Number(sec) || 0));
    var m = Math.floor(s / 60);
    var r = s % 60;
    return m + ':' + (r < 10 ? '0' : '') + r;
  }

  function durationOf(talk) {
    var n = Number(talk && talk.duration);
    return isFinite(n) && n > 0 ? n : 0;
  }

  function avatar(person, size) {
    person = person || { id: 'x', name: '讲者', level: 0 };
    var api = window.CommonsAvatar;
    if (api && typeof api.html === 'function') {
      return api.html({ id: person.id, name: person.name, size: size || 40, level: person.level || 0 });
    }
    var cls = (size || 40) >= 56 ? 'talk-letter talk-letter-lg' : 'talk-letter';
    var name = person.name || '讲';
    return '<span class="' + cls + '" aria-hidden="true">' + esc(name.slice(0, 1)) + '</span>';
  }

  /* safe-fn: 内部文本都经过 esc，头像走 avatar() */
  function speakerLink(person, size) {
    if (!person) return '<span class="talk-speaker"><span><b>讲者未署名</b></span></span>';
    return '<span class="talk-speaker">' +
      avatar(person, size || 40) +
      '<span><b>' + ( /* safe: personLink 自行转义 */ personLink(person.handle, person.name, person.level) ) + '</b><small>L' + String(Number(person.level) || 0) + ' · ' + esc(person.levelName || '') +
      (person.team ? ' · ' + ( /* safe: objectLink 自行转义 */ objectLink('org', person.team.id, person.team.name) ) : '') + '</small></span></span>';
  }

  /* safe-fn: 头像走 avatar()，名字和等级经过 esc */
  function speakerInline(person, size) {
    if (!person) return '<span class="talk-speaker talk-speaker-inline"><b>讲者未署名</b></span>';
    return '<span class="talk-speaker talk-speaker-inline">' +
      avatar(person, size || 24) + '<b>' + ( /* safe: personLink 自行转义 */ personLink(person.handle, person.name, person.level) ) + '</b><small>L' + String(Number(person.level) || 0) + ' ' + esc(person.levelName || '') +
      (person.team ? ' · ' + ( /* safe: objectLink 自行转义 */ objectLink('org', person.team.id, person.team.name) ) : '') + '</small></span>';
  }

  function referencesHTML(talk) {
    var list = talk.references || [];
    if (!list.length) return '';
    return '<section class="talk-linked"><h2>这场引用了</h2><p>' + ( /* safe: objectLink 自行转义 */ list.map(function (item) {
      return objectLink(item.kind, item.id, item.label);
    }).join(' · ') ) + '</p></section>';
  }

  function otherTalksHTML(talk) {
    var data = sample();
    var rows = data ? data.talks.filter(function (item) { return item.id !== talk.id && item.speakerId === talk.speakerId; }).slice(0, 3) : [];
    if (!rows.length) return '<section class="talk-linked"><h2>讲者的其他课</h2><p>暂时没有其他课。</p></section>';
    return '<section class="talk-linked"><h2>讲者的其他课</h2><p>' + ( /* safe: objectLink 自行转义 */ rows.map(function (item) {
      return objectLink('talk', item.id, item.title);
    }).join(' · ') ) + '</p></section>';
  }

  function safeUrl(url) {
    if (window.Commons && typeof window.Commons.safeUrl === 'function') return window.Commons.safeUrl(url);
    return /^assets\/[\w./-]+$/.test(String(url || '')) ? esc(url) : '#';
  }

  function crumb(tail) {
    return '<p class="talk-crumb"><a href="#/talks">讲堂</a><span aria-hidden="true">/</span><span>' + esc(tail) + '</span></p>';
  }

  function sampleTag() {
    if (isLive()) return '';
    return '<span class="pill outline talk-sample">示例</span>';
  }

  function coverHTML(talk, eager) {
    if (talk && talk.cover && safeUrl(talk.cover) !== '#') {
      return '<img class="talk-cover" src="' + safeUrl(talk.cover) + '" alt="' + esc((talk.title || '公开课') + '封面') + '" width="1280" height="720" decoding="async"' + (eager ? '' : ' loading="lazy"') + '>';
    }
    return '<canvas class="talk-cover" data-talk-cover data-id="' + esc(talk && talk.id) + '" width="640" height="360" aria-hidden="true"></canvas>';
  }

  function statsHTML(talk) {
    return '<div class="talk-stats">' +
      '<div><b>' + esc(String(Number(talk.watched) || 0)) + '</b><span>人看过</span></div>' +
      '<div><b>' + esc(String(Number(talk.reproduced) || 0)) + '</b><span>人复现了</span></div>' +
      '</div>';
  }

  function cardHTML(talk, hero) {
    var dir = directionOf(talk.direction);
    var person = personById(talk.speakerId);
    var learn = (talk.learn || []).map(function (item) { return '<li>' + esc(item) + '</li>'; }).join('');
    var foot = hero
      ? (learn ? '<ul class="talk-feat-learn" aria-label="你会学到">' + learn + '</ul>' : '') +
        '<div class="talk-feat-foot">' + speakerLink(person, 40) + statsHTML(talk) +
        '<a class="button primary" href="#/talk/' + esc(talk.id) + '">看这场</a></div>'
      : '<div class="talk-card-foot">' + speakerInline(person) +
        '<span class="talk-count">' + esc(String(Number(talk.watched) || 0)) + ' 人看过</span></div>';
    return '<article class="talk-card' + (hero ? ' is-featured' : '') + '" data-talk-dir="' + esc(talk.direction || '') + '">' +
      '<a class="talk-cover-link" href="#/talk/' + esc(talk.id) + '" tabindex="-1" aria-hidden="true">' + coverHTML(talk, hero) +
      '<span class="talk-dur">' + esc(clock(durationOf(talk))) + '</span></a>' +
      '<div class="talk-card-body">' +
      '<p class="talk-kicker" data-cat="' + String(Number(dir.cat) || 1) + '"><i class="talk-dot" aria-hidden="true"></i>' + (hero ? '本周头条 · ' : '') + esc(dir.label) + '</p>' +
      (hero ? '<h2 class="talk-feat-title">' : '<h3>') + '<a href="#/talk/' + esc(talk.id) + '">' + esc(talk.title) + '</a>' + (hero ? '</h2>' : '</h3>') +
      '<p class="talk-summary">' + esc(talk.summary || '') + '</p>' +
      foot + '</div></article>';
  }

  function missingHTML(title, body) {
    return '<div class="talk-page" data-talk-root data-talk-page="missing">' +
      crumb('讲堂') +
      '<div class="talk-missing"><h1>' + esc(title) + '</h1><p>' + esc(body) + '</p>' +
      '<a class="button primary" href="#/talks">回到讲堂</a></div></div>';
  }

  function brokenHTML(insideHub) {
    return '<div class="talk-page" data-talk-root data-talk-page="broken">' +
      '<div class="talk-missing">' + (insideHub ? '<p role="alert">讲堂暂时没有载入。</p>' : '<h1>讲堂暂时没有载入。</h1>') +
      '<button type="button" class="button" data-talk-act="reload">再试一次</button></div></div>';
  }

  function homeHTML() {
    var data = sample();
    if (!data) return brokenHTML(true);
    var hero = null;
    for (var i = 0; i < data.talks.length; i++) if (data.talks[i].featured) hero = data.talks[i];
    if (!hero) hero = data.talks[0] || null;
    var dirs = (data.directions || []).filter(function (dir) {
      return data.talks.some(function (talk) { return talk.direction === dir.id; });
    });
    var filters = '<div class="talk-filters" role="group" aria-label="按方向看">' +
      '<button type="button" class="chip selected" data-talk-act="dir" data-id="all" aria-pressed="true">全部</button>' +
      dirs.map(function (dir) {
        return '<button type="button" class="chip" data-talk-act="dir" data-id="' + esc(dir.id) + '" aria-pressed="false">' + esc(dir.label) + '</button>';
      }).join('') + '</div>';
    var ordered = hero ? [hero].concat(data.talks.filter(function (talk) { return talk !== hero; })) : data.talks;
    var grid = ordered.map(function (talk) { return cardHTML(talk, talk === hero); }).join('');
    var upcoming = (data.upcoming || []).map(function (item) {
      var who = personById(item.speakerId);
      return '<a href="#/rooms"><time datetime="' + esc(item.when || '') + '">' + esc(String(item.when || '').slice(5).replace('-', '.')) + ' ' + esc(item.time || '') + '</time>' +
        '<span><b>' + esc(item.title) + '</b><small>' + esc(who ? who.name : '讲者待定') + '</small></span>' +
        '<span class="button small">去报名</span></a>';
    }).join('');
    return '<div class="talk-page" data-talk-root data-talk-page="home">' +
      '<div class="talk-head"><p class="talk-lead">群友讲给群友的公开课，看完能照着做。</p>' +
      '<div class="talk-head-actions">' + sampleTag() + '<a class="button" href="#/talk/new">准备一场课</a></div></div>' +
      filters +
      '<div class="talk-grid" data-talk-grid data-dir="all">' + grid + '</div>' +
      '<section class="talk-section" aria-label="下一场"><div class="talk-section-head"><h2>下一场</h2></div>' +
      (upcoming ? '<div class="talk-next">' + upcoming + '</div>' : '<p class="talk-empty-inline">还没有排期。</p>') +
      '</section></div>';
  }

  function speakerHTML(id) {
    var data = sample();
    if (!data) return brokenHTML();
    var person = personById(id);
    if (!person) return missingHTML('没有这位讲者', '名单里没有这个人。');
    var list = data.talks.filter(function (talk) { return talk.speakerId === person.id; });
    return '<div class="talk-page" data-talk-root data-talk-page="speaker">' +
      '<div class="talk-crumb-row">' + crumb(person.name) + sampleTag() + '</div>' +
      '<header class="talk-profile">' + avatar(person, 56) +
      '<div class="talk-head-copy"><h1>' + ( /* safe: personLink 自行转义 */ personLink(person.handle, person.name, person.level) ) + '</h1>' +
      '<p class="talk-lead">L' + String(Number(person.level) || 0) + ' ' + esc(person.levelName || '') +
      ' · 贡献值 ' + esc(String(Number(person.contribution) || 0)) + ' · ' + esc(person.focus || '') + '</p></div>' +
      '<a class="button" href="#/talk/new">准备一场课</a></header>' +
      '<section class="talk-section" aria-label="讲过的课"><div class="talk-section-head"><h2>讲过的课</h2><span>' + esc(String(list.length)) + ' 场</span></div>' +
      (list.length ? '<div class="talk-grid" data-dir="all">' + list.map(function (talk) { return cardHTML(talk, false); }).join('') + '</div>' : '<p class="talk-empty-inline">还没有讲过课。</p>') +
      '</section></div>';
  }

  function sideTabs(talk) {
    return [
      ['chapters', '章节'],
      ['script', '逐字稿'],
      ['points', '要点'],
      ['board', '白板'],
      ['followups', talk.kind === 'meeting' ? '待办' : '问题']
    ];
  }

  function cueText(cue, lang) {
    var zh = cue.text || '';
    var en = (cue.translation && cue.translation.en) || '';
    if (lang === 'en') return en || zh;
    if (lang === 'both') return en ? zh + ' ／ ' + en : zh;
    return zh;
  }

  function cueMatches(cue, query) {
    if (!query) return true;
    var who = personById(cue.speakerId);
    var blob = (cue.text || '') + ' ' + ((cue.translation && cue.translation.en) || '') + ' ' + (who ? who.name : '');
    return blob.toLowerCase().indexOf(query.toLowerCase()) >= 0;
  }

  function scriptHTML(talk, lang, query) {
    var rows = (talk.transcript || []).filter(function (cue) { return cueMatches(cue, query); });
    if (!rows.length) return '<p class="talk-empty-inline">没有对上的句子。清空搜索再看全部。</p>';
    return rows.map(function (cue, i) {
      var who = personById(cue.speakerId);
      var en = (cue.translation && cue.translation.en) || '';
      var showEn = lang === 'both' || lang === 'en';
      var text = lang === 'en' ? (en || cue.text || '') : (cue.text || '');
      return '<button type="button" class="talk-cue" data-talk-cue data-talk-act="jump" data-t="' + String(Number(cue.t) || 0) + '" data-end="' + String(Number(cue.end) || 0) + '"' + (i === rows.length - 1 ? ' data-last="1"' : '') + '>' +
        '<span class="talk-cue-time">' + esc(clock(cue.t)) + '</span>' +
        '<span class="talk-cue-who">' + esc(who ? who.name : '讲者') + '</span>' +
        '<span class="talk-cue-text">' + esc(text) + '</span>' +
        (showEn && lang !== 'en' ? '<span class="talk-cue-en">' + esc(en) + '</span>' : '') +
        '</button>';
    }).join('');
  }

  function chaptersHTML(talk) {
    var list = talk.chapters || [];
    if (!list.length) return '<p class="talk-empty-inline">还没有章节。</p>';
    return list.map(function (ch, i) {
      return '<button type="button" class="talk-chapter" data-talk-chapter data-talk-act="jump" data-t="' + String(Number(ch.t) || 0) + '"' + (i === 0 ? ' aria-current="true"' : '') + '>' +
        '<span class="talk-time">' + esc(clock(ch.t)) + '</span><span>' + esc(ch.title) + '</span></button>';
    }).join('');
  }

  function savedPoints() {
    var list = read('talks.saved', []);
    return Array.isArray(list) ? list : [];
  }

  function isSaved(id) {
    return savedPoints().some(function (item) { return item && item.id === id; });
  }

  function pointsHTML(talk) {
    var list = talk.points || [];
    if (!list.length) return '<p class="talk-empty-inline">还没有整理出要点。</p>';
    return list.map(function (point) {
        var saved = isSaved(point.id);
        return '<article class="talk-point"><button type="button" class="talk-point-jump" data-talk-act="jump" data-t="' + String(Number(point.t) || 0) + '">' +
          '<span class="talk-time">' + esc(clock(point.t)) + '</span><b>' + esc(point.title) + '</b><p>' + esc(point.body || '') + '</p></button>' +
          '<button type="button" class="button ghost small" data-talk-act="save" data-id="' + esc(point.id) + '"' + (saved ? ' disabled aria-pressed="true"' : '') + '>' +
          (saved ? '已收藏' : '收藏') + '</button></article>';
      }).join('');
  }

  function followupsHTML(talk) {
    if (talk.kind === 'meeting') {
      var actions = talk.actions || [];
      if (!actions.length) return '<p class="talk-empty-inline">这场没有待办。</p>';
      return '<ul class="talk-list">' + actions.map(function (item) {
        var who = personById(item.ownerId);
        return '<li class="talk-action"><div class="talk-action-top">' + avatar(who, 32) + '<b>' + ( /* safe: personLink 自行转义 */ (who ? personLink(who.handle, who.name, who.level) : '未指定') ) + '</b></div>' +
          '<p>' + esc(item.text) + '</p><p class="talk-note">截止 ' + esc(item.due || '未定') + '</p></li>';
      }).join('') + '</ul>';
    }
    var questions = talk.questions || [];
    if (!questions.length) return '<p class="talk-empty-inline">这场没有听众提问。</p>';
    return '<ul class="talk-list">' + questions.map(function (item) {
      var who = personById(item.askerId);
      var answered = !!item.answered;
      return '<li class="talk-q"><div class="talk-q-top">' + avatar(who, 32) + '<b>' + ( /* safe: personLink 自行转义 */ (who ? personLink(who.handle, who.name, who.level) : '听众') ) + '</b>' +
        '<span class="pill' + (answered ? '' : ' outline') + '">' + (answered ? '已回答' : '还没回答') + '</span></div>' +
        '<p>' + esc(item.text) + '</p><div class="talk-inline-actions">' +
        '<button type="button" class="button ghost small" data-talk-act="jump" data-t="' + String(Number(item.t) || 0) + '">跳到这句话</button>' +
        (answered && item.answerAt != null ? '<button type="button" class="button ghost small" data-talk-act="jump" data-t="' + String(Number(item.answerAt) || 0) + '">跳到回答</button>' : '') +
        '</div></li>';
    }).join('') + '</ul>';
  }

  function stageHTML(talk, message, retry) {
    return '<div class="talk-wait">' + coverHTML(talk, true) +
      '<p class="talk-wait-note" role="status">' + esc(message) + '</p>' +
      (retry ? '<button type="button" class="button small talk-wait-retry" data-talk-act="media-retry">重试</button>' : '') + '</div>';
  }

  function watchHTML(id) {
    var data = sample();
    if (!data) return brokenHTML();
    var talk = talkById(id);
    if (!talk) return missingHTML('没有这场课', '这个地址对不上任何一场，回讲堂重新选。');
    var dir = directionOf(talk.direction);
    var learn = (talk.learn || []).map(function (item) { return '<li>' + esc(item) + '</li>'; }).join('');
    var tabs = sideTabs(talk).map(function (tab) {
      var on = tab[0] === 'chapters';
      return '<button type="button" role="tab" id="talk-tab-' + esc(tab[0]) + '" data-talk-act="tab" data-id="' + esc(tab[0]) + '" aria-selected="' + (on ? 'true' : 'false') + '" aria-controls="talk-panel-' + esc(tab[0]) + '">' + esc(tab[1]) + '</button>';
    }).join('');
    return '<div class="talk-page" data-talk-root data-talk-page="watch" data-talk-id="' + esc(talk.id) + '">' +
      '<div class="talk-crumb-row">' + crumb('回看') + sampleTag() + '</div>' +
      '<header class="talk-watch-head"><h1>' + esc(talk.title) + '</h1>' +
      '<div class="talk-meta">' + speakerInline(personById(talk.speakerId), 32) +
      '<span class="talk-meta-item" data-cat="' + String(Number(dir.cat) || 1) + '"><i class="talk-dot" aria-hidden="true"></i>' + esc(dir.label) + '</span>' +
      '<span class="talk-meta-item">' + esc(clock(durationOf(talk))) + '</span>' +
      '<span class="talk-meta-item">' + esc(String(Number(talk.watched) || 0)) + ' 人看过</span>' +
      '<span class="talk-meta-item">' + esc(String(Number(talk.reproduced) || 0)) + ' 人复现了</span></div></header>' +
      '<div class="talk-watch"><div class="talk-stage">' +
      '<div class="talk-player" data-talk-player' + (talk.cover ? ' data-cover="1"' : '') + '>' + stageHTML(talk, '正在准备音频') + '</div>' +
      (learn ? '<section class="talk-learn-box" aria-label="你会学到"><h2>你会学到</h2><ol class="talk-learn">' + learn + '</ol></section>' : '') +
      '<p class="talk-consent-line">未录制 · 发言人同意未收集 · 逐字稿和章节为预置文本</p>' +
      '</div><aside class="talk-side"><div class="tabs" role="tablist" aria-label="回看">' + tabs + '</div>' +
      '<div class="talk-tools" data-talk-lang hidden>' +
      '<input class="talk-search" type="search" data-talk-search placeholder="搜索逐字稿" aria-label="搜索逐字稿" autocomplete="off">' +
      '<div class="segmented small" role="group" aria-label="字幕语言">' +
      '<button type="button" data-talk-act="lang" data-id="zh" aria-pressed="true">中文</button>' +
      '<button type="button" data-talk-act="lang" data-id="both" aria-pressed="false">对照</button>' +
      '<button type="button" data-talk-act="lang" data-id="en" aria-pressed="false">English</button></div>' +
      '<button type="button" class="button small" data-talk-act="follow" data-talk-follow hidden>回到当前</button></div>' +
      '<section class="talk-panel" role="tabpanel" id="talk-panel-chapters" data-talk-panel="chapters" aria-labelledby="talk-tab-chapters">' + chaptersHTML(talk) + '</section>' +
      '<section class="talk-panel" role="tabpanel" id="talk-panel-script" data-talk-panel="script" aria-labelledby="talk-tab-script" hidden>' +
      '<div class="talk-script" data-talk-script tabindex="0" aria-label="逐字稿">' + scriptHTML(talk, 'zh', '') + '</div></section>' +
      '<section class="talk-panel" role="tabpanel" id="talk-panel-points" data-talk-panel="points" aria-labelledby="talk-tab-points" hidden>' + pointsHTML(talk) + '</section>' +
      '<section class="talk-panel" role="tabpanel" id="talk-panel-board" data-talk-panel="board" aria-labelledby="talk-tab-board" hidden>' +
      '<div class="talk-board-live" data-talk-board-live hidden></div>' +
      '<canvas class="talk-board-still" data-talk-board-still width="640" height="360" aria-label="白板示意"></canvas>' +
      '<p class="talk-note"><span data-talk-board-count></span> <span data-talk-board-note></span></p></section>' +
      '<section class="talk-panel" role="tabpanel" id="talk-panel-followups" data-talk-panel="followups" aria-labelledby="talk-tab-followups" hidden>' + followupsHTML(talk) + '</section>' +
      '</aside></div>' + referencesHTML(talk) + otherTalksHTML(talk) + '</div>';
  }

  function capTable() {
    var data = sample();
    var list = data && data.durationCaps;
    if (Array.isArray(list) && list.length) return list;
    return [
      { id: 'L3', label: 'L3 骨干 · 讨论室', minutes: 60 },
      { id: 'L4', label: 'L4 领航员 · 舞台', minutes: 120 },
      { id: 'lecturer', label: '讲师或主持人', minutes: 180 }
    ];
  }

  function templatePack() {
    var live = window.COMMONS_BOARD_TEMPLATES;
    if (!live && window.CommonsBoard) {
      var api = window.CommonsBoard.templates;
      if (typeof api === 'function') {
        try { live = api(); } catch (err) { live = null; }
      } else if (Array.isArray(api)) live = api;
    }
    if (Array.isArray(live) && live.length) {
      var list = live.map(function (item) {
        if (typeof item === 'string') return { id: item, label: item };
        var id = String((item && (item.id || item.label || item.name)) || '');
        var label = String((item && (item.label || item.name || item.id)) || '');
        return { id: id, label: label };
      }).filter(function (item) { return item.id; });
      if (list.length) return { list: list, live: true };
    }
    var data = sample();
    return { list: (data && data.boardTemplates) || [], live: false };
  }

  function defaultDraft() {
    var data = sample();
    var capId = data && data.me && data.me.capId;
    var caps = capTable();
    if (!caps.some(function (cap) { return cap.id === capId; })) capId = caps[0] ? caps[0].id : 'L4';
    return { title: '', learn: ['', '', ''], capId: capId, outline: [{ title: '', minutes: '' }], templates: [] };
  }

  function freshTimer() {
    return { running: false, index: 0, elapsed: 0, last: 0, interval: 0, announced: false };
  }

  function normalizeDraft(raw) {
    var base = defaultDraft();
    if (!raw || typeof raw !== 'object') return base;
    base.title = typeof raw.title === 'string' ? raw.title.slice(0, 120) : '';
    var learn = Array.isArray(raw.learn) ? raw.learn : [];
    base.learn = [0, 1, 2].map(function (i) { return typeof learn[i] === 'string' ? learn[i].slice(0, 160) : ''; });
    var caps = capTable();
    if (caps.some(function (cap) { return cap.id === raw.capId; })) base.capId = raw.capId;
    var known = {};
    templatePack().list.forEach(function (item) { known[item.id] = true; });
    var rows = Array.isArray(raw.outline) ? raw.outline.slice(0, 24) : [];
    if (rows.length) {
      base.outline = rows.map(function (row) {
        row = row || {};
        var minutes = typeof row.minutes === 'number' || typeof row.minutes === 'string' ? String(row.minutes).replace(/[^\d]/g, '').slice(0, 3) : '';
        return { title: typeof row.title === 'string' ? row.title.slice(0, 80) : '', minutes: minutes };
      });
    }
    base.templates = Array.isArray(raw.templates) ? raw.templates.map(String).filter(function (id) { return known[id]; }) : [];
    return base;
  }

  function outlineRow(row, i) {
    var n = i + 1;
    return '<div class="talk-row" data-talk-row>' +
      '<label class="field">第 ' + String(n) + ' 节<input name="section" maxlength="80" value="' + esc(row.title || '') + '" aria-label="第 ' + String(n) + ' 节标题"></label>' +
      '<label class="field">分钟<input name="minutes" inputmode="numeric" min="1" max="180" step="1" value="' + esc(row.minutes || '') + '" aria-label="第 ' + String(n) + ' 节分钟"></label>' +
      '<button type="button" class="button ghost small" data-talk-act="row-remove" data-i="' + String(i) + '">去掉</button></div>';
  }

  function outlineHTML(rows) {
    if (!rows.length) return '<p class="talk-empty-inline">还没有大纲。</p>';
    return rows.map(outlineRow).join('');
  }

  function prepHTML() {
    var data = sample();
    if (!data) return brokenHTML();
    var draft = normalizeDraft(read('talks.draft', null));
    var pack = templatePack();
    var caps = capTable();
    var capOptions = caps.map(function (cap) {
      return '<option value="' + esc(cap.id) + '"' + (cap.id === draft.capId ? ' selected' : '') + '>' + esc(cap.label) + ' · ' + esc(String(Number(cap.minutes) || 0)) + ' 分钟</option>';
    }).join('');
    var chips = pack.list.map(function (item) {
      var on = draft.templates.indexOf(item.id) >= 0;
      return '<button type="button" class="chip' + (on ? ' selected' : '') + '" data-talk-act="template" data-id="' + esc(item.id) + '" aria-pressed="' + (on ? 'true' : 'false') + '">' + esc(item.label) + '</button>';
    }).join('');
    var learns = draft.learn.map(function (value, i) {
      return '<label class="field">第 ' + String(i + 1) + ' 条<input name="learn" maxlength="160" value="' + esc(value) + '"></label>';
    }).join('');
    return '<div class="talk-page" data-talk-root data-talk-page="prep">' +
      '<div class="talk-crumb-row">' + crumb('准备') + sampleTag() + '</div>' +
      '<header class="talk-head-copy"><h1>准备一场公开课</h1>' +
      '<p class="talk-lead">大纲只存在这台浏览器，不开房、不录音。</p></header>' +
      '<form class="talk-form" data-talk-form>' +
      '<label class="field">标题<input name="title" maxlength="120" value="' + esc(draft.title) + '" placeholder="一场课，一句话"></label>' +
      '<fieldset class="talk-learn-fields"><legend class="talk-kicker">你会学到</legend>' + learns + '</fieldset>' +
      '<label class="field">时长上限<select name="cap">' + capOptions + '</select></label>' +
      '<div><div class="talk-section-head"><h2>大纲</h2><button type="button" class="button small" data-talk-act="row-add">加一节</button></div>' +
      '<div data-talk-outline>' + outlineHTML(draft.outline) + '</div></div>' +
      '<p class="talk-total" data-talk-total data-over="0">合计 0 分钟</p>' +
      '<p class="talk-total-note" data-talk-total-note></p>' +
      '<div class="talk-form-group"><h2>要用的白板</h2>' +
      '<div class="talk-templates">' + chips + '</div></div>' +
      '<div class="talk-form-actions"><button type="submit" class="button primary">存在本机</button><p class="talk-save-note" data-talk-save-note></p></div>' +
      '</form>' +
      '<section class="talk-timer" data-talk-timer data-over="0" aria-label="试讲计时">' +
      '<h2>试讲计时</h2>' +
      '<p class="talk-timer-name" data-talk-timer-name>还没开始</p>' +
      '<p class="talk-timer-clock" data-talk-timer-clock>0:00</p>' +
      '<p class="talk-timer-note" data-talk-timer-note aria-live="polite"></p>' +
      '<div class="talk-timer-actions">' +
      '<button type="button" class="button" data-talk-act="timer-start">开始</button>' +
      '<button type="button" class="button" data-talk-act="timer-pause" disabled>暂停</button>' +
      '<button type="button" class="button" data-talk-act="timer-next" disabled>下一节</button>' +
      '<button type="button" class="button ghost" data-talk-act="timer-reset">重来</button></div></section></div>';
  }

  function talksRoute() {
    if (isLive()) {
      return '<div class="talk-page" data-talk-root><div class="talk-empty"><h1>讲堂</h1><p>还没有场次。</p></div></div>';
    }
    try {
      var bits = parts();
      if (bits[0] === 'talks' && bits[1] === 'speaker') return speakerHTML(bits[2] || '');
      return homeHTML();
    } catch (err) {
      return brokenHTML();
    }
  }

  function talkRoute() {
    if (isLive()) return missingHTML('暂无讲堂回看', '');
    try {
      var bits = parts();
      if (bits[1] === 'new') return prepHTML();
      if (bits[1]) return watchHTML(bits[1]);
      return missingHTML('先从讲堂选一场', '单场回看要带场次编号。');
    } catch (err) {
      return brokenHTML();
    }
  }

  function tokenColor(name) {
    try { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
    catch (err) { return ''; }
  }

  function palette() {
    var keys = ['--paper', '--surface', '--ink', '--muted', '--accent', '--line-strong', '--slate-300'];
    var out = {};
    var n;
    for (n = 1; n <= 10; n++) keys.push('--cat-' + n);
    keys.forEach(function (key) { out[key] = tokenColor(key); });
    return out;
  }

  function catOf(talk) {
    var dir = directionOf(talk && talk.direction);
    var n = Number(dir.cat);
    if (!(n >= 1 && n <= 10)) n = 1;
    return '--cat-' + n;
  }

  function paintCover(canvas, talk, chapter, pal) {
    if (!canvas || !canvas.getContext) return;
    var ctx = canvas.getContext('2d');
    if (!ctx) return;
    var w = canvas.width;
    var h = canvas.height;
    var ink = pal['--ink'];
    var paper = pal['--paper'] || pal['--surface'];
    var cat = pal[catOf(talk)] || pal['--accent'] || ink;
    if (!ink || !cat) return;
    var shift = (chapter % 4) * 28;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = ink;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = cat;
    ctx.beginPath();
    ctx.arc(w * 0.74 - shift, h * 0.46, h * 0.42, 0, Math.PI * 2);
    ctx.fill();
    if (!paper) return;
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = paper;
    ctx.fillRect(40, h - 108 - shift * 0.3, 200 + chapter * 24, 8);
    ctx.globalAlpha = 0.5;
    ctx.fillRect(40, h - 88, 108, 8);
    ctx.globalAlpha = 1;
    ctx.fillRect(40, 40, 8, 72 + chapter * 12);
  }

  function reduceOps(ops) {
    var map = {};
    var order = [];
    (ops || []).forEach(function (item) {
      var id = item.target || item.id;
      if (!id) return;
      if (item.type === 'remove') {
        delete map[id];
        order = order.filter(function (key) { return key !== id; });
        return;
      }
      if (!map[id]) order.push(id);
      map[id] = Object.assign({}, map[id] || {}, item.patch || {});
    });
    return order.filter(function (id) { return map[id]; }).map(function (id) { return map[id]; });
  }

  function clipText(ctx, text, max) {
    var s = String(text || '');
    if (ctx.measureText(s).width <= max) return s;
    while (s && ctx.measureText(s + '…').width > max) s = s.slice(0, -1);
    return s ? s + '…' : '';
  }

  function drawArrow(ctx, item, color) {
    var x1 = Number(item.x1) || 0;
    var y1 = Number(item.y1) || 0;
    var x2 = Number(item.x2) || 0;
    var y2 = Number(item.y2) || 0;
    var ang = Math.atan2(y2 - y1, x2 - x1);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - 12 * Math.cos(ang - 0.45), y2 - 12 * Math.sin(ang - 0.45));
    ctx.lineTo(x2 - 12 * Math.cos(ang + 0.45), y2 - 12 * Math.sin(ang + 0.45));
    ctx.closePath();
    ctx.fill();
  }

  function paintBoard(canvas, ops, pal) {
    if (!canvas || !canvas.getContext) return;
    var ctx = canvas.getContext('2d');
    if (!ctx) return;
    var w = canvas.width;
    var h = canvas.height;
    var paper = pal['--paper'] || pal['--surface'];
    var ink = pal['--ink'];
    if (!paper || !ink) return;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = paper;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = pal['--line-strong'] || pal['--slate-300'] || ink;
    ctx.lineWidth = 2;
    ctx.strokeRect(12, 12, w - 24, h - 24);
    ctx.font = '18px sans-serif';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    reduceOps(ops).forEach(function (item) {
      var kind = item.kind || 'rect';
      var token = typeof item.color === 'string' ? pal['--' + item.color] : '';
      var cat = token || pal['--cat-' + (Number(item.cat) || 1)] || pal['--accent'] || ink;
      if (kind === 'arrow' || kind === 'line') {
        var from = item.a || {};
        var to = item.b || {};
        drawArrow(ctx, {
          x1: isFinite(Number(from.x)) ? Number(from.x) : Number(item.x1),
          y1: isFinite(Number(from.y)) ? Number(from.y) : Number(item.y1),
          x2: isFinite(Number(to.x)) ? Number(to.x) : Number(item.x2),
          y2: isFinite(Number(to.y)) ? Number(to.y) : Number(item.y2)
        }, ink);
        return;
      }
      if (kind === 'text') {
        ctx.fillStyle = ink;
        ctx.fillText(clipText(ctx, item.text, w - (Number(item.x) || 0) - 24), Number(item.x) || 24, Number(item.y) || 24);
        return;
      }
      var x = Number(item.x) || 24;
      var y = Number(item.y) || 24;
      var bw = Number(item.w) || 160;
      var bh = Number(item.h) || 72;
      ctx.beginPath();
      ctx.rect(x, y, bw, bh);
      if (kind === 'rect') {
        ctx.globalAlpha = 0.16;
        ctx.fillStyle = cat;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = cat;
        ctx.stroke();
        ctx.fillStyle = ink;
        ctx.fillText(clipText(ctx, item.text, bw - 20), x + 12, y + bh / 2);
        return;
      }
      ctx.fillStyle = pal['--surface'] || paper;
      ctx.fill();
      ctx.strokeStyle = kind === 'frame' ? ink : (pal['--line-strong'] || ink);
      ctx.stroke();
      ctx.fillStyle = ink;
      var title = item.text || item.title || '';
      ctx.fillText(clipText(ctx, title, bw - 20), x + 12, y + 28);
      if (item.meta) {
        ctx.fillStyle = pal['--muted'] || ink;
        ctx.fillText(clipText(ctx, item.meta, bw - 20), x + 12, y + 54);
      }
    });
  }

  function drawCovers(root) {
    var pal = state.palette || palette();
    state.palette = pal;
    root.querySelectorAll('canvas[data-talk-cover]').forEach(function (canvas) {
      var talk = talkById(canvas.getAttribute('data-id'));
      if (talk) paintCover(canvas, talk, 0, pal);
    });
  }

  function posterFor(talk) {
    if (talk && talk.cover) return talk.cover;
    try {
      var canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 360;
      paintCover(canvas, talk, 0, state.palette || palette());
      return canvas.toDataURL('image/png');
    } catch (err) { return ''; }
  }

  function wavBlob(buffer) {
    var channel = buffer.getChannelData(0);
    var n = channel.length;
    var bytes = new ArrayBuffer(44 + n * 2);
    var view = new DataView(bytes);
    function str(offset, text) {
      var i;
      for (i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
    }
    str(0, 'RIFF');
    view.setUint32(4, 36 + n * 2, true);
    str(8, 'WAVE');
    str(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, buffer.sampleRate, true);
    view.setUint32(28, buffer.sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    str(36, 'data');
    view.setUint32(40, n * 2, true);
    var offset = 44;
    var i;
    for (i = 0; i < n; i++) {
      var sampleValue = Math.max(-1, Math.min(1, channel[i]));
      view.setInt16(offset, sampleValue < 0 ? sampleValue * 0x8000 : sampleValue * 0x7fff, true);
      offset += 2;
    }
    return new Blob([bytes], { type: 'audio/wav' });
  }

  function synth(talk) {
    var id = talk && talk.id;
    if (id && blobCache[id]) return Promise.resolve(blobCache[id]);
    var Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!Ctx) return Promise.reject(new Error('audio'));
    var duration = durationOf(talk);
    if (!(duration > 0) || duration > 180) return Promise.reject(new Error('duration'));
    var rate = 16000;
    var ctx;
    try { ctx = new Ctx(1, Math.ceil(rate * duration), rate); }
    catch (err) { return Promise.reject(err); }
    var marks = (talk.chapters && talk.chapters.length) ? talk.chapters : [{ t: 0 }];
    marks.forEach(function (mark, index) {
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      var start = Math.max(0, Math.min(duration - 0.2, Number(mark.t) || 0));
      var end = Math.min(duration - 0.01, start + 0.28);
      if (!(end > start)) return;
      osc.type = 'sine';
      osc.frequency.value = 360 + (index % 5) * 48;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.06, Math.min(end, start + 0.02));
      gain.gain.exponentialRampToValueAtTime(0.0001, end);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(end + 0.01);
    });
    return ctx.startRendering().then(function (buffer) {
      var blob = wavBlob(buffer);
      if (id) blobCache[id] = blob;
      return blob;
    });
  }

  function captionsFor(talk, lang) {
    return (talk.transcript || []).map(function (cue) {
      return { t: Number(cue.t) || 0, end: Number(cue.end) || 0, text: cueText(cue, lang) };
    });
  }

  function setMediaHTML(html) {
    var slot = state.root && state.root.querySelector('[data-talk-player]');
    if (!slot) return;
    if (state.player) {
      try { state.player.destroy(); } catch (err) { /* 播放器已卸 */ }
      state.player = null;
    }
    slot.innerHTML = html;
  }

  function mountPlayer() {
    var talk = state.talk;
    var slot = state.root && state.root.querySelector('[data-talk-player]');
    var api = window.CommonsMedia;
    if (!talk || !slot || !state.blob) return;
    if (!api || typeof api.player !== 'function') {
      setMediaHTML(stageHTML(talk, '播放器没接上，逐字稿照常可看'));
      return;
    }
    if (state.player) {
      try { state.player.destroy(); } catch (err) { /* 换字幕前先卸掉上一个 */ }
      state.player = null;
    }
    var cat = Number(directionOf(talk.direction).cat) || 1;
    var handle;
    try {
      handle = api.player(slot, {
        kind: 'audio',
        src: (talk.media && talk.media.src) || ('sample:talk:' + talk.id),
        data: state.blob,
        poster: state.poster || undefined,
        title: talk.title,
        duration: durationOf(talk),
        chapters: (talk.chapters || []).map(function (ch) { return { t: Number(ch.t) || 0, label: ch.title || '' }; }),
        captions: captionsFor(talk, state.lang)
      }, { cat: cat });
    } catch (err) {
      setMediaHTML(stageHTML(talk, '播放器没挂上，逐字稿照常可看', true));
      return;
    }
    state.player = handle;
    handle.on('time', onTime);
    handle.on('play', function () { state.playing = true; });
    handle.on('pause', function () { state.playing = false; });
    handle.on('ended', function () {
      state.playing = false;
      onTime(durationOf(talk));
    });
    handle.on('ready', function () {
      if (state.pendingSeek != null && state.player === handle) {
        var at = state.pendingSeek;
        state.pendingSeek = null;
        handle.seek(at);
      }
    });
    handle.on('error', function () { /* 播放器自己有重试 */ });
  }

  function whenLoaded(fn) {
    if (document.readyState === 'complete') {
      fn();
      return function () {};
    }
    function onLoad() {
      window.removeEventListener('load', onLoad);
      fn();
    }
    window.addEventListener('load', onLoad);
    return function () { window.removeEventListener('load', onLoad); };
  }

  function startMedia() {
    var token = ++state.mediaToken;
    var talk = state.talk;
    if (!talk || !state.root) return;
    setMediaHTML(stageHTML(talk, '正在准备音频'));
    state.poster = posterFor(talk);
    function alive() { return token === state.mediaToken && state.root && state.talk === talk; }
    var cancel = whenLoaded(function () {
      if (!alive()) return;
      synth(talk).then(function (blob) {
        if (!alive()) return;
        state.blob = blob;
        mountPlayer();
        if (state.pendingSeek != null && state.player) state.player.seek(state.pendingSeek);
      }, function () {
        if (!alive()) return;
        setMediaHTML(stageHTML(talk, '音频没生成出来，逐字稿照常可看', true));
      });
    });
    state.unbind.push(cancel);
  }

  function chapterIndex(talk, t) {
    var list = (talk && talk.chapters) || [];
    var idx = 0;
    list.forEach(function (ch, i) { if (t >= Number(ch.t)) idx = i; });
    return list.length ? idx : -1;
  }

  function markChapters(idx) {
    if (!state.root) return;
    state.root.querySelectorAll('[data-talk-chapter]').forEach(function (node, i) {
      if (i === idx) node.setAttribute('aria-current', 'true');
      else node.removeAttribute('aria-current');
    });
  }

  function pauseFollow() {
    if (!state.follow) return;
    state.follow = false;
    syncFollowButton();
  }

  function syncFollowButton() {
    var btn = state.root && state.root.querySelector('[data-talk-follow]');
    if (!btn) return;
    var visible = state.tab === 'script';
    btn.hidden = state.follow || !visible;
  }

  function scrollCue(node) {
    var scroller = node.closest('[data-talk-script]');
    if (!scroller || scroller.hidden) return;
    var delta = node.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    var next = scroller.scrollTop + delta - (scroller.clientHeight - node.offsetHeight) / 2;
    state.programmatic = true;
    scroller.scrollTop = Math.max(0, next);
    window.requestAnimationFrame(function () {
      window.requestAnimationFrame(function () { state.programmatic = false; });
    });
  }

  function markCues(t) {
    if (!state.root) return;
    var want = 'script';
    var current = null;
    state.root.querySelectorAll('[data-talk-cue]').forEach(function (node) {
      var start = Number(node.getAttribute('data-t'));
      var end = Number(node.getAttribute('data-end'));
      var last = node.getAttribute('data-last') === '1';
      var on = t >= start && (t < end || (last && t >= start));
      node.classList.toggle('is-current', on);
      if (on) node.setAttribute('aria-current', 'true');
      else node.removeAttribute('aria-current');
      var panel = node.closest('[data-talk-panel]');
      if (on && panel && panel.getAttribute('data-talk-panel') === want) current = node;
    });
    if (current && state.follow && current !== state.currentCue) {
      state.currentCue = current;
      scrollCue(current);
    }
    if (!current) state.currentCue = null;
  }

  function onTime(t) {
    if (typeof t !== 'number' || !isFinite(t) || !state.talk || !state.root) return;
    state.time = t;
    var idx = chapterIndex(state.talk, t);
    if (idx !== state.chapter) state.chapter = idx;
    markChapters(idx);
    markCues(t);
    syncBoard(t);
  }

  function seekTo(t) {
    var talk = state.talk;
    var next = Math.max(0, Number(t) || 0);
    var dur = durationOf(talk);
    if (dur && next > dur) next = dur;
    state.pendingSeek = next;
    onTime(next);
    if (state.player && state.player.seek) {
      state.player.seek(next);
      state.pendingSeek = next;
    }
  }

  function setBoardNote(text) {
    var el = state.root && state.root.querySelector('[data-talk-board-note]');
    if (el) el.textContent = text;
  }

  function setBoardCount(n) {
    var el = state.root && state.root.querySelector('[data-talk-board-count]');
    if (!el) return;
    el.textContent = n ? '板上 ' + n + ' 笔' : '播放后按时间出现';
  }

  function toBoardOp(item) {
    return { id: item.id, actor: item.actor, clock: item.clock, type: item.type, target: item.target, patch: item.patch };
  }

  function fallbackBoard(ops) {
    if (state.boardHandle && state.boardHandle.destroy) {
      try { state.boardHandle.destroy(); } catch (err) { /* 白板卸不掉就盖住 */ }
    }
    state.boardHandle = null;
    state.boardLive = false;
    state.boardApplied = 0;
    var live = state.root && state.root.querySelector('[data-talk-board-live]');
    var still = state.root && state.root.querySelector('[data-talk-board-still]');
    if (live) live.hidden = true;
    if (still) {
      still.hidden = false;
      paintBoard(still, ops || [], state.palette || palette());
    }
    setBoardNote('· 静态示意');
    setBoardCount((ops || []).length);
  }

  function tryLiveBoard(root) {
    var host = root.querySelector('[data-talk-board-live]');
    var api = window.CommonsBoard;
    if (!host || !api || typeof api.mount !== 'function') return false;
    try {
      var handle = api.mount(host, {
        doc: { objects: [] },
        role: 'viewer',
        readOnly: true,
        chrome: 'none',
        actor: 'talk-replay',
        name: '回放'
      });
      if (!handle || typeof handle.apply !== 'function') {
        if (handle && handle.destroy) handle.destroy();
        return false;
      }
      state.boardHandle = handle;
      state.boardLive = true;
      state.boardApplied = 0;
      host.hidden = false;
      var still = root.querySelector('[data-talk-board-still]');
      if (still) still.hidden = true;
      setBoardNote('');
      return true;
    } catch (err) {
      return false;
    }
  }

  function fitBoard() {
    var handle = state.boardHandle;
    if (!handle || typeof handle.fit !== 'function') return;
    try { handle.fit(); } catch (err) { /* 镜头停在默认位置 */ }
  }

  function syncBoard(time) {
    if (!state.root || !state.talk) return;
    var ops = ((state.talk.board && state.talk.board.ops) || []).filter(function (item) {
      return Number(item.t) <= time + 0.001;
    });
    if (state.boardLive && state.boardHandle) {
      if (ops.length < state.boardApplied) {
        try {
          if (state.boardHandle.destroy) state.boardHandle.destroy();
          state.boardHandle = null;
          state.boardLive = false;
          state.boardApplied = 0;
          if (!tryLiveBoard(state.root)) {
            fallbackBoard(ops);
            return;
          }
          ops.forEach(function (item) { state.boardHandle.apply(toBoardOp(item)); });
          state.boardApplied = ops.length;
          setBoardCount(ops.length);
          fitBoard();
          return;
        } catch (err) {
          fallbackBoard(ops);
          return;
        }
      }
      try {
        var grew = ops.length > state.boardApplied;
        ops.slice(state.boardApplied).forEach(function (item) { state.boardHandle.apply(toBoardOp(item)); });
        state.boardApplied = ops.length;
        setBoardCount(ops.length);
        if (grew) fitBoard();
        return;
      } catch (err) {
        fallbackBoard(ops);
        return;
      }
    }
    var canvas = state.root.querySelector('[data-talk-board-still]');
    if (canvas) paintBoard(canvas, ops, state.palette || palette());
    setBoardCount(ops.length);
  }

  function paintScript() {
    var host = state.root && state.root.querySelector('[data-talk-script]');
    if (!host || !state.talk) return;
    host.innerHTML = scriptHTML(state.talk, state.lang, state.query);
    state.currentCue = null;
    markCues(state.time);
  }

  function syncLangButtons() {
    if (!state.root) return;
    state.root.querySelectorAll('[data-talk-act="lang"]').forEach(function (btn) {
      btn.setAttribute('aria-pressed', btn.getAttribute('data-id') === state.lang ? 'true' : 'false');
    });
  }

  function setLang(lang) {
    if (lang !== 'zh' && lang !== 'both' && lang !== 'en') return;
    if (lang === state.lang) return;
    var playing = state.playing;
    var at = state.time;
    state.lang = lang;
    state.pendingSeek = at;
    syncLangButtons();
    paintScript();
    if (state.player) {
      try { state.player.destroy(); } catch (err) { /* 换字幕 */ }
      state.player = null;
      mountPlayer();
      if (playing && state.player && state.player.play) state.player.play();
    }
  }

  function setTab(id) {
    if (!state.root) return;
    var known = false;
    state.root.querySelectorAll('[data-talk-act="tab"]').forEach(function (btn) {
      var on = btn.getAttribute('data-id') === id;
      if (on) known = true;
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    if (!known) return;
    state.tab = id;
    state.currentCue = null;
    state.root.querySelectorAll('[data-talk-panel]').forEach(function (panel) {
      panel.hidden = panel.getAttribute('data-talk-panel') !== id;
    });
    var tools = state.root.querySelector('[data-talk-lang]');
    if (tools) tools.hidden = id !== 'script';
    syncFollowButton();
    markCues(state.time);
  }

  function setDir(id) {
    if (!state.root) return;
    state.dir = id || 'all';
    state.root.querySelectorAll('[data-talk-act="dir"]').forEach(function (btn) {
      var on = btn.getAttribute('data-id') === state.dir;
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.classList.toggle('selected', on);
    });
    var grid = state.root.querySelector('[data-talk-grid]');
    if (grid) grid.setAttribute('data-dir', state.dir);
    state.root.querySelectorAll('[data-talk-grid] [data-talk-dir]').forEach(function (card) {
      card.hidden = state.dir !== 'all' && card.getAttribute('data-talk-dir') !== state.dir;
    });
  }

  function readForm(root) {
    var title = root.querySelector('[name="title"]');
    var learns = root.querySelectorAll('[name="learn"]');
    var cap = root.querySelector('[name="cap"]');
    var rows = root.querySelectorAll('[data-talk-row]');
    var templates = [];
    root.querySelectorAll('[data-talk-act="template"][aria-pressed="true"]').forEach(function (btn) {
      templates.push(btn.getAttribute('data-id'));
    });
    return normalizeDraft({
      title: title ? title.value : '',
      learn: [0, 1, 2].map(function (i) { return learns[i] ? learns[i].value : ''; }),
      capId: cap ? cap.value : '',
      outline: Array.prototype.map.call(rows, function (row) {
        var name = row.querySelector('[name="section"]');
        var minutes = row.querySelector('[name="minutes"]');
        return { title: name ? name.value : '', minutes: minutes ? minutes.value : '' };
      }),
      templates: templates
    });
  }

  function capById(id) {
    var caps = capTable();
    for (var i = 0; i < caps.length; i++) if (caps[i].id === id) return caps[i];
    return caps[0] || { id: 'L4', label: '上限', minutes: 120 };
  }

  function totalMinutes(outline) {
    return (outline || []).reduce(function (sum, row) {
      var n = Number(row.minutes);
      if (!isFinite(n) || n <= 0) return sum;
      return sum + Math.min(180, Math.round(n));
    }, 0);
  }

  function paintTotal() {
    if (!state.root) return;
    var draft = readForm(state.root);
    state.draft = draft;
    var total = totalMinutes(draft.outline);
    var cap = capById(draft.capId);
    var limit = Number(cap.minutes) || 0;
    var over = limit > 0 && total > limit;
    var line = state.root.querySelector('[data-talk-total]');
    var note = state.root.querySelector('[data-talk-total-note]');
    if (line) {
      line.dataset.over = over ? '1' : '0';
      line.textContent = '合计 ' + total + ' 分钟 · 上限 ' + limit + ' 分钟';
    }
    if (note) note.textContent = over ? '超出「' + cap.label + '」。可以先存着，开讲前把大纲压回去。' : '';
  }

  function captureDraft() {
    if (!state.root || state.root.getAttribute('data-talk-page') !== 'prep') return;
    var draft = readForm(state.root);
    state.draft = draft;
    write('talks.draft', draft);
  }

  function saveDraft(explicit) {
    if (!state.root) return;
    var draft = readForm(state.root);
    state.draft = draft;
    var ok = write('talks.draft', draft);
    var note = state.root.querySelector('[data-talk-save-note]');
    if (note) note.textContent = ok ? '已存在本机' : '没存上，内容还在页面上';
    if (explicit && ok) toast('已存在本机');
  }

  function replaceOutline(draft) {
    var host = state.root && state.root.querySelector('[data-talk-outline]');
    if (!host) return;
    host.innerHTML = outlineHTML(draft.outline);
    paintTotal();
  }

  function addRow() {
    if (!state.root) return;
    var draft = readForm(state.root);
    if (draft.outline.length >= 24) {
      toast('大纲先留在 24 节以内。');
      return;
    }
    draft.outline.push({ title: '', minutes: '' });
    replaceOutline(draft);
    var inputs = state.root.querySelectorAll('[data-talk-outline] [name="section"]');
    var last = inputs[inputs.length - 1];
    if (last) last.focus();
  }

  function removeRow(index) {
    if (!state.root) return;
    var draft = readForm(state.root);
    if (index < 0 || index >= draft.outline.length) return;
    draft.outline.splice(index, 1);
    replaceOutline(draft);
    paintTimer();
  }

  function toggleTemplate(btn) {
    var on = btn.getAttribute('aria-pressed') === 'true';
    btn.setAttribute('aria-pressed', on ? 'false' : 'true');
    btn.classList.toggle('selected', !on);
  }

  function timerSections() {
    if (!state.root) return [];
    return readForm(state.root).outline.filter(function (row) {
      return Number(row.minutes) > 0;
    }).map(function (row) {
      return { title: row.title || '未命名的一节', minutes: Math.min(180, Math.round(Number(row.minutes))) };
    });
  }

  function clearTimer() {
    if (state.timer.interval) window.clearInterval(state.timer.interval);
    state.timer.interval = 0;
    state.timer.running = false;
  }

  function setTimerNote(text) {
    var el = state.root && state.root.querySelector('[data-talk-timer-note]');
    if (!el || el.textContent === text) return;
    el.textContent = text;
  }

  function paintTimer() {
    if (!state.root || state.root.getAttribute('data-talk-page') !== 'prep') return;
    var sections = timerSections();
    var box = state.root.querySelector('[data-talk-timer]');
    var name = state.root.querySelector('[data-talk-timer-name]');
    var clockEl = state.root.querySelector('[data-talk-timer-clock]');
    var start = state.root.querySelector('[data-talk-act="timer-start"]');
    var pause = state.root.querySelector('[data-talk-act="timer-pause"]');
    var next = state.root.querySelector('[data-talk-act="timer-next"]');
    var done = state.timer.index >= sections.length && sections.length > 0 && !state.timer.running && state.timer.elapsed === 0 && state.timer.index > 0;
    var section = sections[state.timer.index];
    var planned = section ? section.minutes * 60 : 0;
    var over = !!(section && state.timer.elapsed > planned);
    if (box) box.dataset.over = over ? '1' : '0';
    if (name) {
      name.textContent = !sections.length ? '还没有可计时的一节' : section ? section.title : '大纲走完了';
    }
    if (clockEl) clockEl.textContent = clock(state.timer.elapsed) + (planned ? ' / ' + clock(planned) : '');
    if (over) setTimerNote('这一节超时了。可以进下一节，也可以继续讲。没有录音。');
    else if (done) setTimerNote('大纲走完了。这只是试讲计时，没有录下来。');
    else if (state.timer.running) setTimerNote('');
    if (start) start.disabled = state.timer.running || !sections.length || !section;
    if (pause) pause.disabled = !state.timer.running;
    if (next) next.disabled = !section || (!state.timer.running && state.timer.elapsed <= 0 && state.timer.index === 0);
  }

  function timerTick() {
    if (!state.timer.running) return;
    var now = Date.now();
    state.timer.elapsed += (now - state.timer.last) / 1000;
    state.timer.last = now;
    var sections = timerSections();
    if (!sections[state.timer.index]) {
      timerFinish();
      return;
    }
    paintTimer();
  }

  function timerStart() {
    var sections = timerSections();
    if (!sections.length) {
      setTimerNote('先加一节，并写上分钟数。');
      paintTimer();
      return;
    }
    if (state.timer.index >= sections.length) {
      setTimerNote('大纲走完了。按重来再走一遍。没有录音。');
      return;
    }
    if (state.timer.running) return;
    state.timer.running = true;
    state.timer.last = Date.now();
    state.timer.interval = window.setInterval(timerTick, 200);
    paintTimer();
  }

  function timerPause() {
    if (!state.timer.running) return;
    clearTimer();
    paintTimer();
  }

  function timerFinish() {
    clearTimer();
    state.timer.index = timerSections().length;
    state.timer.elapsed = 0;
    setTimerNote('大纲走完了。这只是试讲计时，没有录下来。');
    paintTimer();
  }

  function timerNext() {
    var sections = timerSections();
    if (state.timer.index >= sections.length - 1) {
      timerFinish();
      return;
    }
    state.timer.index += 1;
    state.timer.elapsed = 0;
    state.timer.last = Date.now();
    setTimerNote('');
    paintTimer();
  }

  function timerReset() {
    clearTimer();
    state.timer = freshTimer();
    setTimerNote('');
    paintTimer();
  }

  function savePoint(btn) {
    var talk = state.talk;
    if (!talk) return;
    var id = btn.getAttribute('data-id');
    var point = (talk.points || []).filter(function (item) { return item.id === id; })[0];
    if (!point) return;
    if (isSaved(point.id)) {
      toast('已经收藏过了');
      return;
    }
    var list = savedPoints().filter(function (item) { return item && item.id !== point.id; });
    list.push({ id: point.id, talkId: talk.id, title: point.title, t: point.t, savedAt: new Date().toISOString(), synthetic: true });
    if (!write('talks.saved', list)) return;
    btn.textContent = '已收藏';
    btn.disabled = true;
    btn.setAttribute('aria-pressed', 'true');
    toast('已收藏到本机');
  }

  function resumeFollow() {
    state.follow = true;
    state.currentCue = null;
    syncFollowButton();
    markCues(state.time);
  }

  function onClick(event) {
    var root = state.root;
    if (!root || !root.contains(event.target)) return;
    var el = event.target.closest('[data-talk-act]');
    if (!el || !root.contains(el)) return;
    var act = el.getAttribute('data-talk-act');
    if (act === 'dir') setDir(el.getAttribute('data-id'));
    else if (act === 'tab') setTab(el.getAttribute('data-id'));
    else if (act === 'lang') setLang(el.getAttribute('data-id'));
    else if (act === 'jump') seekTo(el.getAttribute('data-t'));
    else if (act === 'follow') resumeFollow();
    else if (act === 'save') savePoint(el);
    else if (act === 'media-retry') startMedia();
    else if (act === 'reload') {
      if (window.Commons && window.Commons.refresh) window.Commons.refresh();
    } else if (act === 'template') toggleTemplate(el);
    else if (act === 'row-add') addRow();
    else if (act === 'row-remove') removeRow(Number(el.getAttribute('data-i')));
    else if (act === 'timer-start') timerStart();
    else if (act === 'timer-pause') timerPause();
    else if (act === 'timer-next') timerNext();
    else if (act === 'timer-reset') timerReset();
  }

  function onSubmit(event) {
    var form = event.target && event.target.closest ? event.target.closest('[data-talk-form]') : null;
    if (!form || !state.root || !state.root.contains(form)) return;
    event.preventDefault();
    saveDraft(true);
  }

  function onInput(event) {
    if (!state.root || !state.root.contains(event.target)) return;
    if (event.target.matches('[data-talk-search]')) {
      state.query = event.target.value || '';
      paintScript();
      return;
    }
    if (state.root.getAttribute('data-talk-page') === 'prep' && event.target.matches('input, textarea, select')) paintTotal();
  }

  function onScroll(event) {
    if (state.programmatic) return;
    var scroller = event.target;
    if (!scroller || !scroller.closest) return;
    if (!scroller.matches('[data-talk-script]')) return;
    pauseFollow();
  }

  function onWheel(event) {
    if (!state.root || !state.root.contains(event.target)) return;
    if (event.target.closest('[data-talk-script]')) pauseFollow();
  }

  function onPointerDown(event) {
    if (!state.root || !state.root.contains(event.target)) return;
    var scroller = event.target.closest('[data-talk-script]');
    if (!scroller) return;
    if (event.target.closest('button, a, input, textarea, select')) return;
    pauseFollow();
  }

  function bind(root) {
    function on(target, type, fn, options) {
      target.addEventListener(type, fn, options);
      state.unbind.push(function () { target.removeEventListener(type, fn, options); });
    }
    on(root, 'click', onClick);
    on(root, 'submit', onSubmit);
    on(root, 'input', onInput);
    on(root, 'change', onInput);
    on(root, 'scroll', onScroll, true);
    on(root, 'wheel', onWheel, { passive: true });
    on(root, 'touchmove', onWheel, { passive: true });
    on(root, 'pointerdown', onPointerDown);
  }

  function destroy() {
    state.mediaToken += 1;
    state.job += 1;
    captureDraft();
    state.unbind.forEach(function (fn) { try { fn(); } catch (err) { /* 卸监听 */ } });
    state.unbind = [];
    clearTimer();
    state.timer = freshTimer();
    if (state.player) {
      try { state.player.destroy(); } catch (err) { /* 播放器可能已被媒体模块卸掉 */ }
    }
    if (state.boardHandle && state.boardHandle.destroy) {
      try { state.boardHandle.destroy(); } catch (err) { /* 白板可能已卸 */ }
    }
    state.player = null;
    state.blob = null;
    state.poster = '';
    state.boardHandle = null;
    state.boardLive = false;
    state.boardApplied = 0;
    state.root = null;
    state.talk = null;
    state.page = '';
    state.follow = true;
    state.time = 0;
    state.playing = false;
    state.chapter = -1;
    state.currentCue = null;
    state.pendingSeek = null;
    state.query = '';
    state.lang = 'zh';
    state.tab = 'chapters';
    state.dir = 'all';
  }

  function mount() {
    var root = document.querySelector('[data-talk-root]');
    if (!root || !document.body.contains(root)) return;
    destroy();
    state.root = root;
    state.page = root.getAttribute('data-talk-page') || '';
    state.talk = talkById(root.getAttribute('data-talk-id') || '');
    // No replay/list API exists yet. Live routes deliberately stay empty.
    if (isLive()) return;
    bind(root);
    state.palette = palette();
    drawCovers(root);
    if (state.page === 'watch' && state.talk) {
      if (!tryLiveBoard(root)) {
        setBoardNote('· 静态示意');
      }
      syncBoard(0);
      startMedia();
    }
    if (state.page === 'prep') {
      paintTotal();
      paintTimer();
    }
  }

  window.CommonsTalks = {
    routes: {
      talks: talksRoute,
      talk: talkRoute
    },
    hub: ['talks'],
    nav: [['talks', '讲堂', 'podium', 'practice']],
    icons: {
      podium: 'M4 16h16M6 16V8h12v8M8 8V5h8v3M12 16v3'
    },
    mount: mount,
    destroy: destroy
  };

  if (window.CommonsLinks && typeof window.CommonsLinks.provide === 'function') {
    window.CommonsLinks.provide('talk', function (handle) {
      if (isLive()) return null;
      var data = sample();
      var ids = {};
      (data && data.speakers || []).forEach(function (person) { if (person.handle === handle) ids[person.id] = true; });
      var rows = (data && data.talks || []).filter(function (talk) { return ids[talk.speakerId]; });
      return rows.length ? { label: '讲堂', href: '#/talk/' + encodeURIComponent(rows[0].id), count: rows.length, icon: 'podium' } : null;
    });
  }

  (window.CommonsPages = window.CommonsPages || []).push(window.CommonsTalks);
})();
