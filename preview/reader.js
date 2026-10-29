/* R13 EDT-1 · 阅读页 window.CommonsReader
   纯渲染器：把编辑器存下的 Tiptap JSON 渲染成阅读页字符串，不依赖 Tiptap。
   所有文字和属性都经 esc()；链接只放行 http(s)；图片只放行 http(s)、站内路径和 data:image（png/jpeg/gif/webp）。
   看不到的知识卡只显示「这张卡你现在看不到」，不输出标题。HTML 作品只输出占位，mount() 时交给 CommonsHTML 沙箱。
   点击只用 data-rdr-act；监听只在 mount() 挂，destroy() 全部解除。 */
(function () {
  'use strict';
  var G = typeof window !== 'undefined' ? window : globalThis;

  var ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"'`]/g, function (c) { return ESC[c]; }); }
  function clip(v, n) { var s = String(v == null ? '' : v); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
  function int(v, min, max, fallback) { if (v == null || v === '') return fallback; var n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback; }
  function isId(v) { return typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v); }
  function isLive() { return !!(G.CommonsAPI && G.CommonsAPI.mode === 'live'); }

  var MAX_DEPTH = 40;
  var MAX_NODES = 20000;

  /* ---------- 地址 ---------- */
  function safeLink(raw) {
    var s = String(raw == null ? '' : raw).trim();
    if (!s || s.length > 2048 || /[\u0000- \u007f<>"'`\\]/.test(s)) return '';
    if (!/^https?:\/\//i.test(s)) return '';
    try {
      var u = new URL(s);
      if ((u.protocol !== 'http:' && u.protocol !== 'https:') || !u.hostname) return '';
      return u.href;
    } catch (e) { return ''; }
  }
  function safeHash(raw) {
    var s = String(raw == null ? '' : raw).trim();
    if (!s || s.length > 256) return '';
    var m = /^#\/([a-z][a-z0-9-]*)(?:\/([^#?\s]+))?(?:[?#].*)?$/.exec(s);
    if (!m) return '';
    var id = m[2] ? encodeURIComponent(decodeURIComponent(m[2])) : '';
    return '#/' + m[1] + (id ? '/' + id : '');
  }
  function safeHref(raw) { return safeHash(raw) || safeLink(raw); }

  var ROUTE_KIND = {
    u: 'person', people: 'person', knowledge: 'knowledge', threads: 'thread', discuss: 'thread',
    talk: 'talk', talks: 'talk', room: 'room', rooms: 'room', event: 'event', events: 'event',
    campaign: 'campaign', campaigns: 'campaign', bounties: 'bounty', market: 'market',
    tool: 'tool', tools: 'tool', skills: 'skill', prompts: 'prompt', components: 'component',
    patterns: 'pattern', group: 'group', groups: 'group', farm: 'farm', parking: 'parking',
    pet: 'pet', games: 'game', orgs: 'org', org: 'org', work: 'work', agents: 'agents'
  };
  var ROUTE_TITLE = {
    write: '写点什么', read: '阅读', knowledge: '知识地图', threads: '讨论串', talks: '讲堂',
    agents: 'Agent 广场', hot: 'AI 热点', solved: '问题库', skills: 'Skill 库', prompts: '提示词库',
    components: '组件库', patterns: '产品形态库', tools: 'AI 工具榜', connect: '接入 Agent',
    welcome: '新人引导', insights: '群的走向', drift: '话题漂移', people: '作品与同行'
  };

  function parseHash(raw) {
    var href = safeHash(raw);
    if (!href) return null;
    var parts = href.slice(2).split('/');
    return { href: href, route: parts[0] || '', id: parts[1] ? decodeURIComponent(parts[1]) : '' };
  }

  function peopleProfiles() {
    var pack = G.COMMONS_PEOPLE_SAMPLE;
    return pack && Array.isArray(pack.profiles) ? pack.profiles : [];
  }
  function handleOf(person) {
    if (!person || typeof person !== 'object') return '';
    if (person.handle) return String(person.handle).replace(/^@+/, '');
    var name = String(person.name || '');
    var list = peopleProfiles();
    for (var i = 0; i < list.length; i++) if (list[i].name === name) return list[i].handle || '';
    return '';
  }
  function lookupTitle(kind, id, fallback) {
    if (!id) return fallback || '';
    var i, pack, list;
    if (kind === 'person') {
      list = peopleProfiles();
      for (i = 0; i < list.length; i++) if (list[i].handle === id) return list[i].name || fallback;
    }
    if (kind === 'knowledge') {
      pack = G.COMMONS_KNOWLEDGE;
      list = pack && Array.isArray(pack.units) ? pack.units : [];
      for (i = 0; i < list.length; i++) if (list[i].id === id) return list[i].title || fallback;
    }
    if (kind === 'work') {
      pack = G.COMMONS_PEOPLE_SAMPLE;
      list = pack && Array.isArray(pack.works) ? pack.works : [];
      for (i = 0; i < list.length; i++) if (list[i].id === id) return list[i].title || fallback;
    }
    if (kind === 'thread') {
      pack = G.COMMONS_THREAD_SAMPLE;
      if (pack && pack.post && pack.post.id === id) return pack.post.title || fallback;
      list = pack && Array.isArray(pack.posts) ? pack.posts : [];
      for (i = 0; i < list.length; i++) if (list[i].id === id) return list[i].title || fallback;
    }
    if (kind === 'talk') {
      pack = G.COMMONS_TALKS_SAMPLE;
      list = pack && Array.isArray(pack.talks) ? pack.talks : [];
      for (i = 0; i < list.length; i++) if (list[i].id === id) return list[i].title || fallback;
    }
    return fallback || id;
  }

  /* safe-fn: CommonsLinks.person 自行转义；退路对名字 esc、handle encodeURIComponent */
  function personLink(handle, name, level) {
    var L = G.CommonsLinks;
    if (L && typeof L.person === 'function') return L.person(handle, name, { level: level });
    return handle ? '<a class="lk-person" href="#/u/' + encodeURIComponent(handle) + '">' + esc(name) + '</a>' : esc(name);
  }
  /* safe-fn: CommonsLinks.a 自行转义；退路拼本模块已登记的阅读/知识路由 */
  function objectLink(kind, id, label) {
    var L = G.CommonsLinks;
    if (L && typeof L.a === 'function') return L.a(kind, id, label);
    var href = '';
    if (kind === 'knowledge' && isId(id)) href = '#/knowledge/' + encodeURIComponent(id);
    else if (kind === 'thread' && isId(id)) href = '#/threads/' + encodeURIComponent(id);
    else if (kind === 'work' && isId(id)) href = '#/work/' + encodeURIComponent(id);
    else if (kind === 'talk' && isId(id)) href = '#/talk/' + encodeURIComponent(id);
    else if (kind === 'person' && id) href = '#/u/' + encodeURIComponent(id);
    return href ? '<a class="lk-link" href="' + href + '">' + esc(label) + '</a>' : esc(label);
  }
  function siteTitle(parsed, fallback) {
    if (!parsed) return fallback || '';
    if (parsed.route === 'u') return lookupTitle('person', parsed.id, fallback);
    if (parsed.route === 'read') return fallback || '阅读页';
    var kind = ROUTE_KIND[parsed.route] || parsed.route;
    if (parsed.id) return lookupTitle(kind, parsed.id, fallback || parsed.id);
    return ROUTE_TITLE[parsed.route] || fallback || parsed.route;
  }
  function siteHref(parsed) {
    if (!parsed) return '';
    var L = G.CommonsLinks;
    var kind = parsed.route === 'u' ? 'person' : ROUTE_KIND[parsed.route];
    if (L && typeof L.href === 'function' && kind && kind !== 'agents') {
      var shared = L.href(kind, parsed.id || undefined);
      if (shared) return shared;
    }
    return parsed.href;
  }
  function siteCard(raw, fallback) {
    var parsed = parseHash(raw);
    if (!parsed) return '';
    var title = siteTitle(parsed, fallback);
    var href = siteHref(parsed);
    return '<a class="rdr-card rdr-site-card" href="' + esc(href) /* safe: href 来自 safeHash 或 CommonsLinks.href */ + '">' +
      '<span class="rdr-card-kind">' + esc(ROUTE_TITLE[parsed.route] || '站内') + '</span>' +
      '<span class="rdr-card-copy"><b>' + esc(clip(title, 60)) + '</b><span class="rdr-card-meta"><i>站内链接</i></span></span>' +
      '<span class="rdr-card-go">' + ico('arrow', 16) + '</span></a>';
  }
  var DATA_IMAGE = /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+=*$/;
  function safeImage(raw) {
    var s = String(raw == null ? '' : raw).trim();
    if (!s) return '';
    if (s.slice(0, 5).toLowerCase() === 'data:') return s.length <= 6000000 && DATA_IMAGE.test(s) ? s : '';
    if (/^https?:\/\//i.test(s)) return safeLink(s);
    if (/^\/(?!\/)[A-Za-z0-9_\-./%]+$/.test(s) && s.indexOf('..') < 0) return s;
    return '';
  }

  /* ---------- 可见范围（编辑器发布面板共用） ---------- */
  var LEVELS = { 1: '新队员', 2: '队员', 3: '骨干', 4: '领航员', 5: '先锋' };
  var SCOPES = {
    private: '仅自己',
    people: '受邀成员',
    members: '社区成员',
    level: '等级可见',
    space: '空间可见',
    public: '公开'
  };
  function visibility(v) {
    v = v && typeof v === 'object' ? v : {};
    var scope = SCOPES[v.scope] ? v.scope : 'private';
    var level = int(v.level, 2, 5, 3);
    var people = Array.isArray(v.peopleNames) ? v.peopleNames.filter(Boolean).slice(0, 20).map(function (x) { return clip(x, 16); }) : [];
    var space = clip(v.spaceName || '', 24);
    var label = SCOPES[scope];
    var who;
    if (scope === 'private') who = '只有你自己能看到。别人打开链接会看到「没有找到」。';
    else if (scope === 'people') {
      label = people.length ? '受邀 ' + people.length + ' 人' : '受邀成员';
      who = people.length ? '你和你点名的 ' + people.length + ' 位成员（' + people.slice(0, 3).join('、') + (people.length > 3 ? ' 等' : '') + '）能看到。' : '你和你点名的成员能看到。还没点名时，只有你自己能看到。';
    } else if (scope === 'members') who = '所有登录的社区成员都能看到，访客看不到，也不会出现在站外。';
    else if (scope === 'level') { label = 'L' + level + ' 及以上'; who = '等级 L' + level + '（' + LEVELS[level] + '）及以上的成员能看到，低于这个等级的成员看不到。'; }
    else if (scope === 'space') { label = space ? '「' + space + '」' : '空间可见'; who = space ? '只有「' + space + '」的成员能看到，离开空间后就看不到了。' : '只有选定空间的成员能看到。'; }
    else who = '任何人都能看到，包括没登录的访客。内测期间不开放。';
    return { scope: scope, label: label, who: who, isPublic: scope === 'public' };
  }

  /* ---------- 表情（与 CommonsReact 的 12 个同名） ---------- */
  var EMOJI = {
    up: { label: '赞', color: 'var(--cat-2)', d: 'M7 11v9H4v-9zM7 11l4-7c1.4 0 2.3 1 2 2.4L12.4 10H18a2 2 0 0 1 2 2.3l-1.1 6A2 2 0 0 1 17 20H7' },
    useful: { label: '有用', color: 'var(--accent)', d: 'M12 3l2.4 1.6 2.9-.2 1 2.7 2.3 1.8-.9 2.8.9 2.8-2.3 1.8-1 2.7-2.9-.2L12 21l-2.4-1.6-2.9.2-1-2.7-2.3-1.8.9-2.8-.9-2.8 2.3-1.8 1-2.7 2.9.2zM8.5 12l2.4 2.4 4.6-4.8' },
    learned: { label: '学到了', color: 'var(--cat-4)', d: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z' },
    spark: { label: '灵光', color: 'var(--cat-1)', d: 'm12 3 1.9 5.6L19.5 10.5l-5.6 1.9L12 18l-1.9-5.6-5.6-1.9 5.6-1.9zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z' },
    question: { label: '疑问', color: 'var(--cat-9)', d: 'M9.2 9a3 3 0 1 1 4.3 2.7c-.9.4-1.5 1.2-1.5 2.2v.6M12 18h.01M12 21.5a9.5 9.5 0 1 1 0-19 9.5 9.5 0 0 1 0 19' },
    reproduced: { label: '复现了', color: 'var(--cat-3)', d: 'M20 11a8 8 0 0 0-14.3-4.9L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.9L20 16M20 20v-4h-4M9 12l2 2 4-4' },
    favorite: { label: '收藏', color: 'var(--cat-5)', d: 'M6 3h12v18l-6-4-6 4z' },
    cheer: { label: '加油', color: 'var(--cat-7)', d: 'M12 21a8 8 0 0 0 8-8c0-4-3-6-4-10-2 2-3 4-3 6-1-1-2-2-2-4-3 2-7 5-7 8a8 8 0 0 0 8 8z' },
    smile: { label: '笑', color: 'var(--cat-9)', d: 'M8 14.2s1.6 2.3 4 2.3 4-2.3 4-2.3M9 9.2h.01M15 9.2h.01M12 20.5a8.5 8.5 0 1 1 0-17 8.5 8.5 0 0 1 0 17' },
    heart: { label: '心', color: 'var(--violet-500)', d: 'M12 19s-7-4.4-7-9.2A3.8 3.8 0 0 1 12 8.2a3.8 3.8 0 0 1 7 1.6C19 14.6 12 19 12 19z' },
    seen: { label: '看过', color: 'var(--cat-10)', d: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z' },
    rocket: { label: '火箭', color: 'var(--cat-2)', d: 'M14 4.5c2.6 1 4.6 3 5.5 5.5L13 16.5l-5.5-5.5zM8.2 15.4 6 18.8l3.4-2.2M9.6 10.2 7.4 8M13.8 14.4 16 16.6M8.8 16.8c-1.6.4-3.2.6-4.3-.5s-.9-2.7-.5-4.3' }
  };
  var EMOJI_ORDER = ['up', 'useful', 'learned', 'spark', 'question', 'reproduced', 'favorite', 'cheer', 'smile', 'heart', 'seen', 'rocket'];
  function emojiSvg(name, size) {
    var e = EMOJI[name];
    if (!e) return '';
    var s = size || 18;
    return '<svg viewBox="0 0 24 24" width="' + Number(s) + '" height="' + Number(s) + '" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + e.d + '"/></svg>';
  }

  /* ---------- 代码语言 ---------- */
  var LANGS = { text: '纯文本', bash: 'Shell', javascript: 'JavaScript', typescript: 'TypeScript', python: 'Python', json: 'JSON', html: 'HTML', css: 'CSS', sql: 'SQL', markdown: 'Markdown', yaml: 'YAML' };
  var LANG_ORDER = ['text', 'bash', 'javascript', 'typescript', 'python', 'json', 'html', 'css', 'sql', 'markdown', 'yaml'];
  function langOf(v) { return LANGS[v] ? v : 'text'; }

  var CARD_KIND = { question: '问题', solution: '解法', pitfall: '踩坑', 'tool-review': '工具体感', debate: '争议', 'work-lead': '作品线索', resource: '资源' };
  var CARD_STATUS = { candidate: '候选', curated: '已整理', verified: '已验证', stale: '可能过时', disputed: '有争议' };

  var ICON = {
    lock: 'M6 11h12v10H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3',
    copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
    share: 'M12 3v12M7 8l5-5 5 5M5 13v7h14v-7',
    bookmark: 'M6 3h12v18l-6-4-6 4z',
    arrow: 'M4 12h16M14 6l6 6-6 6',
    code: 'M8 7l-5 5 5 5M16 7l5 5-5 5',
    toc: 'M4 6h16M4 12h10M4 18h13',
    clock: 'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
    people: 'M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M20 20v-1.5a3.5 3.5 0 0 0-2.5-3.4M15.5 4.2a3.5 3.5 0 0 1 0 6.6',
    check: 'M4 12l5 5L20 6',
    eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
    spark: 'm12 3 1.9 5.6L19.5 10.5l-5.6 1.9L12 18l-1.9-5.6-5.6-1.9 5.6-1.9z',
    close: 'M6 6l12 12M18 6 6 18'
  };
  function ico(name, size) {
    var s = size || 16;
    return '<svg viewBox="0 0 24 24" width="' + Number(s) + '" height="' + Number(s) + '" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + (ICON[name] || ICON.spark) + '"/></svg>';
  }

  /* ---------- 文档遍历 ---------- */
  function newCtx(opts) {
    opts = opts || {};
    return {
      prefix: isId(opts.idPrefix) ? opts.idPrefix : 'rdr',
      headings: [],
      cjk: 0,
      words: 0,
      images: 0,
      codeLines: 0,
      nodes: 0,
      firstText: '',
      resolveCard: typeof opts.resolveCard === 'function' ? opts.resolveCard : function () { return null; },
      resolveWork: typeof opts.resolveWork === 'function' ? opts.resolveWork : function () { return null; },
      group: isId(opts.group) ? opts.group : 'rdr-images'
    };
  }

  function countText(ctx, s) {
    var cjk = s.match(/[\u3400-\u9fff\uf900-\ufaff]/g);
    var words = s.match(/[A-Za-z0-9]+/g);
    ctx.cjk += cjk ? cjk.length : 0;
    ctx.words += words ? words.length : 0;
  }

  function plain(node, depth) {
    if (!node || typeof node !== 'object' || (depth || 0) > MAX_DEPTH) return '';
    if (node.type === 'text') return typeof node.text === 'string' ? node.text : '';
    if (node.type === 'hardBreak') return ' ';
    if (node.type === 'mention') return '@' + clip(node.attrs && node.attrs.label, 32);
    if (node.type === 'emoji') { var e = EMOJI[node.attrs && node.attrs.name]; return e ? '［' + e.label + '］' : ''; }
    if (!Array.isArray(node.content)) return '';
    return node.content.map(function (c) { return plain(c, (depth || 0) + 1); }).join('');
  }

  function marksOf(node) {
    var out = { bold: false, italic: false, code: false, highlight: false, link: '' };
    (Array.isArray(node.marks) ? node.marks : []).forEach(function (m) {
      if (!m || typeof m !== 'object') return;
      if (m.type === 'bold') out.bold = true;
      else if (m.type === 'italic') out.italic = true;
      else if (m.type === 'code') out.code = true;
      else if (m.type === 'highlight') out.highlight = true;
      else if (m.type === 'link') out.link = safeHref(m.attrs && m.attrs.href);
    });
    return out;
  }

  function textNode(node, ctx) {
    var raw = typeof node.text === 'string' ? node.text : '';
    if (!raw) return '';
    countText(ctx, raw);
    var m = marksOf(node);
    var h = esc(raw);
    if (m.code) h = '<code>' + h + '</code>';
    if (m.highlight) h = '<mark>' + h + '</mark>';
    if (m.italic) h = '<em>' + h + '</em>';
    if (m.bold) h = '<strong>' + h + '</strong>';
    if (m.link) {
      if (m.link.charAt(0) === '#') return siteCard(m.link, raw);
      h = '<a href="' + esc(m.link) /* safe: m.link 已过 safeHref 白名单（http/https 或 #/ 站内） */ + '" target="_blank" rel="noopener nofollow ugc">' + h + '</a>';
    }
    return h;
  }

  function kids(node, ctx, depth) {
    if (!Array.isArray(node.content)) return '';
    var out = '';
    for (var i = 0; i < node.content.length; i++) out += renderNode(node.content[i], ctx, depth + 1);
    return out;
  }

  function cardHTML(refId, ctx) {
    var card = isId(refId) ? ctx.resolveCard(refId) : null;
    if (!card || typeof card !== 'object') {
      return '<div class="rdr-card is-locked" role="note">' +
        '<span class="rdr-card-lock">' + ico('lock', 18) + '</span>' +
        '<div><b>这张卡你现在看不到</b><p>它的可见范围比这篇窄。</p></div></div>';
    }
    var kind = CARD_KIND[card.kind] || '知识卡';
    var status = CARD_STATUS[card.status] || '';
    var body = clip(card.solution || card.question || card.context || '', 90);
    var href = '';
    var L = G.CommonsLinks;
    if (L && typeof L.href === 'function') href = L.href('knowledge', card.id) || '';
    if (!href && isId(card.id)) href = '#/knowledge/' + encodeURIComponent(card.id);
    var inner = '<span class="rdr-card-kind">' + esc(kind) + '</span>' +
      '<span class="rdr-card-copy"><b>' + esc(clip(card.title, 60)) + '</b>' +
      (body ? '<small>' + esc(body) + '</small>' : '') +
      '<span class="rdr-card-meta">' + (status ? '<i>' + esc(status) + '</i>' : '') +
      (Number(card.corroboration) > 0 ? '<i>佐证 ' + int(card.corroboration, 0, 99999, 0) + ' 人</i>' : '') + '<i>知识卡</i></span></span>' +
      (href ? '<span class="rdr-card-go">' + ico('arrow', 16) + '</span>' : '');
    return href
      ? '<a class="rdr-card" href="' + esc(href) /* safe: href 来自 CommonsLinks.href 或 #/knowledge/<白名单 id> */ + '">' + inner + '</a>'
      : '<div class="rdr-card">' + inner + '</div>';
  }

  function workHTML(attrs, ctx) {
    var id = attrs && attrs.workId;
    var work = isId(id) ? ctx.resolveWork(id) : null;
    if (!work) {
      return '<div class="rdr-card is-locked" role="note"><span class="rdr-card-lock">' + ico('lock', 18) + '</span>' +
        '<div><b>这个 HTML 作品你现在看不到</b><p>作者可能把它撤回了，或它只对部分成员开放。</p></div></div>';
    }
    var kb = Math.max(1, Math.round(int(attrs.bytes, 0, 2097152, 0) / 1024));
    return '<figure class="rdr-html" data-rdr-html="' + esc(id) + '">' +
      '<figcaption><span class="rdr-html-tag">' + ico('code', 14) + 'HTML 作品</span><b>' + esc(clip(attrs.title || '未命名作品', 60)) + '</b><small>' + kb + ' KB · 在沙箱里运行，不能联网</small></figcaption>' +
      '<div class="rdr-html-frame" data-rdr-html-frame><p class="rdr-html-wait">沙箱预览准备中…</p></div></figure>';
  }

  function imageHTML(attrs, ctx) {
    var src = safeImage(attrs && attrs.src);
    var alt = clip(attrs && attrs.alt, 120);
    var caption = clip(attrs && attrs.caption, 200);
    if (!src) {
      return '<div class="rdr-card is-locked" role="note"><span class="rdr-card-lock">' + ico('lock', 18) + '</span><div><b>这张图片没有显示</b><p>图片地址不在允许的范围里，或还没上传完。</p></div></div>';
    }
    ctx.images += 1;
    var w = int(attrs.width, 0, 20000, 0);
    var h = int(attrs.height, 0, 20000, 0);
    var Img = G.CommonsImage;
    if (Img && typeof Img.html === 'function') {
      return '<div class="rdr-image">' + /* safe: CommonsImage.html 自己转义，src 已过 safeImage */ Img.html({ src: src, full: src, alt: alt || caption || '文中配图', caption: caption, width: w || undefined, height: h || undefined, group: ctx.group }) + '</div>';
    }
    var ratio = w && h ? ' style="aspect-ratio:' + w + ' / ' + h + '"' : '';
    return '<figure class="rdr-figure"><button type="button" class="rdr-zoom" data-rdr-act="zoom" aria-label="' + esc('查看大图：' + (alt || caption || '图片')) + '">' +
      '<img src="' + esc(src) /* safe: src 已过 safeImage 白名单 */ + '" alt="' + esc(alt) + '" loading="lazy" decoding="async"' + (w && h ? ' width="' + w + '" height="' + h + '"' : '') + ratio + '></button>' +
      (caption ? '<figcaption>' + esc(caption) + '</figcaption>' : '') + '</figure>';
  }

  function renderNode(node, ctx, depth) {
    if (!node || typeof node !== 'object' || depth > MAX_DEPTH) return '';
    ctx.nodes += 1;
    if (ctx.nodes > MAX_NODES) return '';
    var a = node.attrs && typeof node.attrs === 'object' ? node.attrs : {};
    switch (node.type) {
      case 'doc': return kids(node, ctx, depth);
      case 'text': return textNode(node, ctx);
      case 'paragraph': {
        var p = kids(node, ctx, depth);
        if (!p) return '';
        if (!ctx.firstText) ctx.firstText = plain(node, depth);
        return '<p>' + p + '</p>';
      }
      case 'heading': {
        var level = a.level === 3 ? 3 : 2;
        var text = clip(plain(node, depth).trim(), 80);
        var hid = ctx.prefix + '-s' + (ctx.headings.length + 1);
        ctx.headings.push({ id: hid, level: level, text: text || '（未命名小节）' });
        return '<h' + level + ' id="' + esc(hid) + '" class="rdr-h" tabindex="-1">' + kids(node, ctx, depth) + '</h' + level + '>';
      }
      case 'bulletList': return '<ul>' + kids(node, ctx, depth) + '</ul>';
      case 'orderedList': {
        var start = int(a.start, 1, 9999, 1);
        return '<ol' + (start > 1 ? ' start="' + start + '"' : '') + '>' + kids(node, ctx, depth) + '</ol>';
      }
      case 'listItem': return '<li>' + kids(node, ctx, depth) + '</li>';
      case 'blockquote': return '<blockquote>' + kids(node, ctx, depth) + '</blockquote>';
      case 'codeBlock': {
        var code = plain(node, depth);
        var lang = langOf(a.language);
        ctx.codeLines += code.split('\n').length;
        countText(ctx, code);
        return '<figure class="rdr-code"><figcaption><span>' + esc(LANGS[lang]) + '</span>' +
          '<button type="button" class="rdr-copy" data-rdr-act="copy" aria-label="复制这段' + esc(LANGS[lang]) + '代码">' + ico('copy', 14) + '<span>复制</span></button></figcaption>' +
          '<pre><code>' + esc(code) + '</code></pre></figure>';
      }
      case 'horizontalRule': return '<hr>';
      case 'hardBreak': return '<br>';
      case 'image': return imageHTML(a, ctx);
      case 'knowledgeCard': return cardHTML(a.refId, ctx);
      case 'htmlWork': return workHTML(a, ctx);
      case 'emoji': {
        var e = EMOJI[a.name];
        if (!e) return '';
        return '<span class="rdr-emoji" role="img" aria-label="' + esc(e.label) + '" title="' + esc(e.label) + '" style="--rdr-emoji:' + e.color + '">' + emojiSvg(a.name, 18) + '</span>';
      }
      case 'mention': {
        var label = clip(a.label, 32);
        if (!label) return '';
        countText(ctx, label);
        var handle = a.handle || handleOf({ name: label, handle: a.handle, id: a.id });
        return '<span class="rdr-mention">@' + ( /* safe: personLink 自行转义 */ personLink(handle, label, a.level) ) + '</span>';
      }
      default: return kids(node, ctx, depth);
    }
  }

  function minutesOf(ctx) {
    var m = ctx.cjk / 400 + ctx.words / 220 + ctx.images * 0.2 + ctx.codeLines / 40;
    return Math.max(1, Math.ceil(m - 0.15));
  }

  function body(doc, opts) {
    var ctx = newCtx(opts);
    var html = renderNode(doc, ctx, 0);
    return { html: html, toc: ctx.headings, minutes: minutesOf(ctx), images: ctx.images, summary: clip(ctx.firstText.trim(), 120), chars: ctx.cjk + ctx.words };
  }

  function toc(doc) { return body(doc).toc; }
  function readingTime(doc) { return body(doc).minutes; }
  function summary(doc, n) { return clip(body(doc).summary, n || 120); }

  /* ---------- 页面 ---------- */
  function when(iso) {
    var d = new Date(iso);
    if (!iso || isNaN(d.getTime())) return '';
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return p(d.getMonth() + 1) + '.' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  /* safe-fn: 返回 CommonsAvatar.html（组件自己转义）或回退分支里 esc 过的首字 */
  function avatarHTML(author) {
    var name = clip(author.name || '成员', 16);
    var A = G.CommonsAvatar;
    if (A && typeof A.html === 'function' && isId(author.id)) {
      return A.html({ id: author.id, name: name, size: 40, level: int(author.level, 1, 5, 1) });
    }
    return '<span class="rdr-avatar" aria-hidden="true">' + esc(name.slice(0, 1)) + '</span>';
  }

  var AIGC = {
    none: null,
    assist: { label: 'AI 辅助', tip: '作者标注：写作时用了 AI 整理、润色或翻译，内容和结论由作者核对。' },
    generated: { label: 'AI 生成', tip: '作者标注：正文主要由 AI 生成，作者做了核对和删改。' }
  };

  function tocList(list, cls) {
    if (!list.length) return '';
    return '<ol class="' + esc(cls) + '">' + list.map(function (t) {
      return '<li class="lv' + Number(t.level) + '"><button type="button" data-rdr-act="toc" data-target="' + esc(t.id) + '">' + esc(t.text) + '</button></li>';
    }).join('') + '</ol>';
  }

  function mineReact(rx) {
    var mine = rx && rx.mine;
    var out = {};
    if (Array.isArray(mine)) mine.forEach(function (k) { out[k] = true; });
    else if (mine && typeof mine === 'object') Object.keys(mine).forEach(function (k) { if (mine[k]) out[k] = true; });
    return out;
  }
  /* safe-fn: live 分支按钮文案写死、kind/计数/标签均 esc；演示走 CommonsReact.bar 或静态 pill */
  function reactHTML(meta) {
    var rx = meta.reactions && typeof meta.reactions === 'object' ? meta.reactions : {};
    if (isLive()) {
      var counts = rx.counts || {};
      var mine = mineReact(rx);
      var shown = EMOJI_ORDER.filter(function (k) { return Number(counts[k]) > 0 || mine[k]; });
      if (!shown.length) shown = ['up', 'useful', 'learned'];
      var rest = EMOJI_ORDER.filter(function (k) { return shown.indexOf(k) < 0; });
      var pill = function (k) {
        return '<button type="button" class="rdr-react-pill" data-rdr-act="react" data-kind="' + esc(k) + '" aria-pressed="' + (mine[k] ? 'true' : 'false') + '" style="--rdr-emoji:' + EMOJI[k].color + '" title="' + esc(EMOJI[k].label) + '">' + emojiSvg(k, 16) + '<b>' + int(counts[k], 0, 99999, 0) + '</b></button>';
      };
      return '<div class="rdr-react-live" role="group" aria-label="表情反应">' + shown.map(pill).join('') +
        (rest.length ? '<details class="rdr-react-more"><summary aria-label="更多反应">+</summary>' + rest.map(pill).join('') + '</details>' : '') +
        '</div>';
    }
    var R = G.CommonsReact;
    var target = 'read-' + (isId(meta.id) ? meta.id : 'x');
    if (R && typeof R.bar === 'function') return R.bar({ targetId: target, counts: rx.counts || {}, mine: rx.mine || [] });
    var demoCounts = rx.counts || {};
    var demoShown = EMOJI_ORDER.filter(function (k) { return Number(demoCounts[k]) > 0; });
    if (!demoShown.length) return '<p class="rdr-muted">还没有人留下反应。</p>';
    return '<div class="rdr-react-static" role="group" aria-label="表情反应">' + demoShown.map(function (k) {
      return '<span class="rdr-react-pill" style="--rdr-emoji:' + EMOJI[k].color + '" title="' + esc(EMOJI[k].label) + '">' + emojiSvg(k, 16) + '<b>' + int(demoCounts[k], 0, 99999, 0) + '</b></span>';
    }).join('') + '</div>';
  }
  /* safe-fn: 标签名 esc；真实模式按钮文案写死 */
  function tagsHTML(meta) {
    var tags = Array.isArray(meta.tags) ? meta.tags : [];
    if (!tags.length) return '';
    var followed = meta.followed && typeof meta.followed === 'object' ? meta.followed : {};
    return '<div class="rdr-tags" role="group" aria-label="标签">' + tags.filter(function (t) { return String(t || '').trim(); }).slice(0, 10).map(function (t) {
      var tag = String(t);
      var on = !!followed[tag];
      return isLive()
        ? '<button type="button" class="rdr-chip" data-rdr-act="follow" data-tag="' + esc(tag) + '" aria-pressed="' + on + '">' + esc(tag) + (on ? ' · 已关注' : ' · 关注') + '</button>'
        : '<span class="rdr-chip">' + esc(tag) + '</span>';
    }).join('') + '</div>';
  }

  function relatedHTML(meta, ctx) {
    var list = Array.isArray(meta.related) ? meta.related : [];
    var rows = [];
    list.slice(0, 8).forEach(function (r) {
      var id = r && typeof r === 'object' ? r.refId : r;
      var card = isId(id) ? ctx.resolveCard(id) : null;
      if (!card) return;
      var relHref = '';
      var CL = G.CommonsLinks;
      if (CL && typeof CL.href === 'function') relHref = CL.href('knowledge', card.id) || '';
      if (!relHref) relHref = '#/knowledge/' + encodeURIComponent(card.id);
      rows.push('<li><a href="' + esc(relHref) /* safe: CommonsLinks.href 或 #/knowledge/<id> */ + '"><span>' + esc(CARD_KIND[card.kind] || '知识卡') + '</span><b>' + esc(clip(card.title, 48)) + '</b>' + ico('arrow', 14) + '</a></li>');
    });
    if (!rows.length) return '';
    return '<section class="rdr-related" aria-label="相关知识"><h2>相关知识</h2><ul>' + rows.join('') + '</ul></section>';
  }

  /* html(doc, meta)：整页阅读模式。meta 字段见回执 §1。 */
  function html(doc, meta) {
    meta = meta && typeof meta === 'object' ? meta : {};
    var ctx = newCtx({ idPrefix: 'rdr', resolveCard: meta.resolveCard, resolveWork: meta.resolveWork, group: 'rdr-' + (isId(meta.id) ? meta.id : 'x') });
    var content = renderNode(doc, ctx, 0);
    var minutes = minutesOf(ctx);
    var vis = visibility(meta.visibility);
    var author = meta.author && typeof meta.author === 'object' ? meta.author : {};
    var level = int(author.level, 1, 5, 0);
    var aigc = AIGC[meta.aigc] || null;
    var title = clip(meta.title || '未命名', 120);
    var lead = clip(meta.summary || '', 240);
    var kind = { knowledge: '知识条目', discussion: '讨论', work: '作品说明', reply: '回复' }[meta.kind] || '内容';
    var tocItems = ctx.headings;
    var saved = !!meta.saved;
    var sample = meta.sample !== false ? '<span class="pill outline">示例</span>' : '';
    var published = when(meta.publishedAt);
    return '<div class="rdr" data-rdr-root data-rdr-id="' + esc(isId(meta.id) ? meta.id : '') + '">' +
      '<div class="rdr-progress" role="progressbar" aria-label="阅读进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span data-rdr-bar></span></div>' +
      '<div class="rdr-layout' + (tocItems.length ? '' : ' no-toc') + '">' +
        '<article class="rdr-article" data-rdr-article>' +
          '<header class="rdr-head">' +
            '<p class="rdr-eyebrow"><span>' + esc(kind) + '</span>' + sample + '</p>' +
            '<h1>' + esc(title) + '</h1>' +
            (lead ? '<p class="rdr-lead">' + esc(lead) + '</p>' : '') +
            '<div class="rdr-byline">' + avatarHTML(author) +
              '<div class="rdr-byline-copy"><b>' + ( /* safe: personLink 自行转义 */ personLink(handleOf(author), clip(author.name || '成员', 16), level) ) + (level ? '<span class="rdr-level">L' + level + ' ' + esc(LEVELS[level]) + '</span>' : '') + '</b>' +
              '<small>' + (published ? esc(published) + ' 发布 · ' : '') + '约 ' + minutes + ' 分钟读完</small></div>' +
            '</div>' +
            '<div class="rdr-meta">' +
              '<span class="rdr-tipwrap"><span class="rdr-chip rdr-scope" tabindex="0" aria-describedby="rdr-scope-tip">' + ico('eye', 14) + esc(vis.label) + '</span>' +
                '<span class="rdr-tip" role="tooltip" id="rdr-scope-tip"><b>谁能看到这篇</b>' + esc(vis.who) + '</span></span>' +
              (isLive() && !int(meta.corroboration, 0, 999999, 0) ? '' : '<span class="rdr-chip">' + ico('people', 14) + '佐证 ' + int(meta.corroboration, 0, 999999, 0) + ' 人</span>') +
              (isLive() && !int(meta.reproduced, 0, 999999, 0) ? '' : '<span class="rdr-chip">' + ico('check', 14) + '复现了 ' + int(meta.reproduced, 0, 999999, 0) + ' 人</span>') +
              '<span class="rdr-chip">' + ico('clock', 14) + '约 ' + minutes + ' 分钟</span>' +
              (aigc ? '<span class="rdr-tipwrap"><span class="rdr-chip rdr-aigc" tabindex="0" aria-describedby="rdr-aigc-tip">' + ico('spark', 14) + esc(aigc.label) + '</span><span class="rdr-tip" role="tooltip" id="rdr-aigc-tip"><b>AIGC 标注</b>' + esc(aigc.tip) + '</span></span>' : '') +
            '</div>' +
          '</header>' +
          (tocItems.length ? '<details class="rdr-toc-mobile"><summary>' + ico('toc', 16) + '目录 · ' + tocItems.length + ' 节</summary>' + tocList(tocItems, 'rdr-toc-list') + '</details>' : '') +
          '<div class="rdr-body" data-rdr-body>' + (content || '<p class="rdr-muted">这篇还没有正文。</p>') + '</div>' +
          '<footer class="rdr-foot">' +
            '<div class="rdr-foot-row"><div class="rdr-react">' + reactHTML(meta) + '</div>' +
              '<div class="rdr-foot-actions">' +
                (isLive() ? '<button type="button" class="button" data-rdr-act="useful" aria-pressed="' + (meta.useful ? 'true' : 'false') + '">' + ico('check', 16) + '<span>' + (meta.useful ? '已标有用' : '有用') + '</span></button>' : '') +
                '<button type="button" class="button" data-rdr-act="save" aria-pressed="' + saved + '">' + ico('bookmark', 16) + '<span>' + (saved ? '已收藏' : '收藏') + '</span></button>' +
                '<button type="button" class="button primary" data-rdr-act="share">' + ico('share', 16) + '<span>分享</span></button>' +
              '</div></div>' +
            tagsHTML(meta) +
            relatedHTML(meta, ctx) +
            (isLive() && isId(meta.id) ? '<section class="rdr-thread-wrap" aria-label="回复"><h2>回复</h2><div data-rdr-thread></div></section>' : '') +
          '</footer>' +
        '</article>' +
        (tocItems.length ? '<aside class="rdr-aside"><nav class="rdr-toc" aria-label="目录"><p class="rdr-toc-title">' + ico('toc', 14) + '目录</p>' + tocList(tocItems, 'rdr-toc-list') + '</nav></aside>' : '') +
      '</div>' +
    '</div>';
  }

  /* ---------- 交互（只在浏览器） ---------- */
  var live = null;

  function reduced() { return !!(G.matchMedia && G.matchMedia('(prefers-reduced-motion: reduce)').matches); }
  function toast(msg) { if (G.Commons && typeof G.Commons.toast === 'function') G.Commons.toast(msg); }
  function store() { return G.Commons && typeof G.Commons.read === 'function' ? G.Commons : null; }
  function apiOpts() { return { idempotencyKey: G.CommonsAPI && G.CommonsAPI.newIdempotencyKey() }; }
  function liveErr(error, fallback) {
    if (error && (error.status === 501 || error.code === 'capability_unavailable')) return '这个功能还没开放';
    return (error && error.message) || fallback || '没有成功，可以再试一次。';
  }

  function mount(root, opts) {
    destroy();
    var el = root && root.querySelector ? (root.matches && root.matches('[data-rdr-root]') ? root : root.querySelector('[data-rdr-root]')) : null;
    if (!el && typeof document !== 'undefined') el = document.querySelector('[data-rdr-root]');
    if (!el) return null;
    opts = opts || {};
    var state = { root: el, opts: opts, frames: [], timers: [], raf: 0, off: [], lightbox: null, last: null };
    live = state;

    var bar = el.querySelector('[data-rdr-bar]');
    var progress = el.querySelector('.rdr-progress');
    var article = el.querySelector('[data-rdr-body]');
    var heads = Array.prototype.slice.call(el.querySelectorAll('.rdr-body .rdr-h'));
    var tocBtns = Array.prototype.slice.call(el.querySelectorAll('[data-rdr-act="toc"]'));

    function measure() {
      state.raf = 0;
      if (!article) return;
      var r = article.getBoundingClientRect();
      var vh = G.innerHeight || 800;
      var span = Math.max(1, r.height - vh * 0.6);
      var p = Math.min(1, Math.max(0, (vh * 0.25 - r.top) / span));
      if (bar) bar.style.transform = 'scaleX(' + p.toFixed(4) + ')';
      if (progress) progress.setAttribute('aria-valuenow', String(Math.round(p * 100)));
      var current = '';
      for (var i = 0; i < heads.length; i++) { if (heads[i].getBoundingClientRect().top <= vh * 0.3) current = heads[i].id; else break; }
      if (!current && heads.length) current = heads[0].id;
      if (current !== state.last) {
        state.last = current;
        tocBtns.forEach(function (b) {
          var on = b.dataset.target === current;
          b.classList.toggle('is-current', on);
          if (on) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
        });
      }
    }
    function onScroll() { if (!state.raf) state.raf = G.requestAnimationFrame(measure); }
    G.addEventListener('scroll', onScroll, { passive: true });
    G.addEventListener('resize', onScroll);
    state.off.push(function () { G.removeEventListener('scroll', onScroll); G.removeEventListener('resize', onScroll); if (state.raf) G.cancelAnimationFrame(state.raf); });
    measure();

    function onClick(event) {
      var btn = event.target.closest && event.target.closest('[data-rdr-act]');
      if (!btn || !el.contains(btn)) return;
      var act = btn.dataset.rdrAct;
      if (act === 'toc') {
        var target = el.querySelector('#' + CSS.escape(btn.dataset.target || ''));
        if (!target) return;
        target.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
        target.focus({ preventScroll: true });
        var details = btn.closest('details');
        if (details) details.open = false;
      } else if (act === 'copy') copyCode(btn);
      else if (act === 'zoom') openLightbox(btn);
      else if (act === 'save') toggleSave(btn);
      else if (act === 'useful') toggleUseful(btn);
      else if (act === 'react') toggleReact(btn);
      else if (act === 'follow') toggleFollow(btn);
      else if (act === 'share') {
        if (typeof opts.onShare === 'function') opts.onShare();
        else if (G.CommonsShare && typeof G.CommonsShare.open === 'function' && opts.share) G.CommonsShare.open(opts.share);
        else toast('分享组件还没加载。');
      }
    }
    el.addEventListener('click', onClick);
    state.off.push(function () { el.removeEventListener('click', onClick); });

    mountWorks(state);
    if (G.CommonsImage && typeof G.CommonsImage.mount === 'function') G.CommonsImage.mount(el);
    var threadHost = el.querySelector('[data-rdr-thread]');
    if (threadHost && isLive() && G.CommonsThread && typeof G.CommonsThread.mount === 'function') {
      var oid = el.dataset.rdrId;
      if (oid) G.CommonsThread.mount(threadHost, { targetId: oid, repliesOnly: true });
    }
    if (isLive() && G.CommonsAPI && typeof G.CommonsAPI.get === 'function') {
      G.CommonsAPI.get('/content/follows').then(function (res) {
        var tags = Array.isArray(res && res.data) ? res.data : [];
        el.querySelectorAll('[data-rdr-act="follow"]').forEach(function (b) {
          var on = tags.indexOf(b.dataset.tag) >= 0;
          b.setAttribute('aria-pressed', String(on));
          b.textContent = (b.dataset.tag || '') + (on ? ' · 已关注' : ' · 关注');
        });
      }).catch(function () {});
    }
    return { destroy: destroy };
  }

  function workPreview(work) {
    if (!work || typeof work !== 'object') return null;
    var title = work.title || '';
    if (isLive()) {
      var assetId = work.id || work.assetId || '';
      var contentUrl = work.content_url || work.contentUrl || '';
      if (!assetId && !contentUrl) return null;
      var liveOpts = { title: title };
      if (assetId) liveOpts.assetId = assetId;
      if (contentUrl) liveOpts.contentUrl = contentUrl;
      return liveOpts;
    }
    if (typeof work.html !== 'string') return null;
    return { html: work.html, title: title };
  }

  function mountWorks(state) {
    var resolve = typeof state.opts.resolveWork === 'function' ? state.opts.resolveWork : function () { return null; };
    Array.prototype.forEach.call(state.root.querySelectorAll('[data-rdr-html]'), function (fig) {
      var frame = fig.querySelector('[data-rdr-html-frame]');
      var work = resolve(fig.dataset.rdrHtml);
      if (!frame) return;
      var options = workPreview(work);
      if (!options) { frame.innerHTML = '<p class="rdr-html-wait">作品内容没有找到。</p>'; return; }
      var H = G.CommonsHTML;
      if (!H || typeof H.render !== 'function') {
        frame.innerHTML = '<p class="rdr-html-wait">HTML 沙箱组件没有加载，作品不在这里运行。</p>';
        return;
      }
      state.frames.push(H.render(frame, options));
    });
  }

  function copyCode(btn) {
    var fig = btn.closest('.rdr-code');
    var code = fig && fig.querySelector('code');
    if (!code) return;
    var label = btn.querySelector('span');
    var done = function (text) {
      if (label) label.textContent = text;
      var t = setTimeout(function () { if (label) label.textContent = '复制'; }, 1800);
      if (live) live.timers.push(t);
    };
    var fallback = function () {
      var range = document.createRange();
      range.selectNodeContents(code);
      var sel = G.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      done('已选中，按 ⌘C');
      toast('浏览器没让直接复制，代码已经选中，按 ⌘C 或 Ctrl+C 复制。');
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(code.textContent).then(function () { done('已复制'); }, fallback);
    else fallback();
  }

  function toggleSave(btn) {
    var s = store();
    var id = live && live.root.dataset.rdrId;
    if (!id) return;
    if (isLive()) {
      if (!G.CommonsAPI) return;
      var adding = btn.getAttribute('aria-pressed') !== 'true';
      var path = '/content/objects/' + encodeURIComponent(id) + '/save';
      var call = adding ? G.CommonsAPI.put(path, {}, apiOpts()) : G.CommonsAPI.del(path, {}, apiOpts());
      btn.disabled = true;
      call.then(function () {
        btn.disabled = false;
        btn.setAttribute('aria-pressed', String(adding));
        var label = btn.querySelector('span');
        if (label) label.textContent = adding ? '已收藏' : '收藏';
        toast(adding ? '已收藏' : '已取消收藏');
      }).catch(function (error) {
        btn.disabled = false;
        toast(liveErr(error, '收藏没有改成。'));
      });
      return;
    }
    var list = s ? s.read('reader.saved', []) : [];
    if (!Array.isArray(list)) list = [];
    var on = list.indexOf(id) < 0;
    list = on ? list.concat(id) : list.filter(function (x) { return x !== id; });
    if (s) s.write('reader.saved', list);
    btn.setAttribute('aria-pressed', String(on));
    var demoLabel = btn.querySelector('span');
    if (demoLabel) demoLabel.textContent = on ? '已收藏' : '收藏';
    toast(on ? '已收藏到本机' : '已取消收藏');
  }
  function toggleUseful(btn) {
    var id = live && live.root.dataset.rdrId;
    if (!id || !isLive() || !G.CommonsAPI) return;
    if (btn.getAttribute('aria-pressed') === 'true') { toast('这一条你已经标过「有用」。'); return; }
    btn.disabled = true;
    G.CommonsAPI.post('/content/objects/' + encodeURIComponent(id) + '/useful', {}, apiOpts()).then(function () {
      btn.disabled = false;
      btn.setAttribute('aria-pressed', 'true');
      var label = btn.querySelector('span');
      if (label) label.textContent = '已标有用';
      toast('对方的贡献值 +5，规则见等级制度');
    }).catch(function (error) {
      btn.disabled = false;
      toast(liveErr(error, '没有标上。'));
    });
  }
  function toggleReact(btn) {
    var id = live && live.root.dataset.rdrId;
    var kind = btn.dataset.kind;
    if (!id || !kind || !isLive() || !G.CommonsAPI) return;
    var on = btn.getAttribute('aria-pressed') !== 'true';
    var path = '/content/objects/' + encodeURIComponent(id) + '/reactions/' + encodeURIComponent(kind);
    var call = on ? G.CommonsAPI.put(path, {}, apiOpts()) : G.CommonsAPI.del(path, {}, apiOpts());
    btn.disabled = true;
    call.then(function () {
      btn.disabled = false;
      btn.setAttribute('aria-pressed', String(on));
      var n = btn.querySelector('b');
      if (n) {
        var next = Math.max(0, int(n.textContent, 0, 99999, 0) + (on ? 1 : -1));
        n.textContent = String(next);
      }
    }).catch(function (error) {
      btn.disabled = false;
      toast(liveErr(error, '表态没有改成。'));
    });
  }
  function toggleFollow(btn) {
    var tag = btn.dataset.tag;
    if (!tag || !isLive() || !G.CommonsAPI) return;
    var on = btn.getAttribute('aria-pressed') !== 'true';
    var path = '/content/follows/' + encodeURIComponent(tag);
    var call = on ? G.CommonsAPI.put(path, {}, apiOpts()) : G.CommonsAPI.del(path, {}, apiOpts());
    btn.disabled = true;
    call.then(function () {
      btn.disabled = false;
      btn.setAttribute('aria-pressed', String(on));
      btn.textContent = tag + (on ? ' · 已关注' : ' · 关注');
    }).catch(function (error) {
      btn.disabled = false;
      toast(liveErr(error, '关注没有改成。'));
    });
  }

  function openLightbox(btn) {
    var img = btn.querySelector('img');
    if (!img || !live) return;
    closeLightbox();
    var dlg = document.createElement('dialog');
    dlg.className = 'rdr-lightbox';
    dlg.setAttribute('aria-label', btn.getAttribute('aria-label') || '查看大图');
    var big = document.createElement('img');
    big.src = img.currentSrc || img.src;
    big.alt = img.alt;
    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'button ghost icon-only rdr-lightbox-close';
    close.setAttribute('aria-label', '关闭大图');
    close.innerHTML = ico('close', 18);
    dlg.append(big, close);
    document.body.appendChild(dlg);
    var back = btn;
    var shut = function () { dlg.close(); };
    close.addEventListener('click', shut);
    dlg.addEventListener('click', function (e) { if (e.target === dlg || e.target === big) shut(); });
    dlg.addEventListener('close', function () { dlg.remove(); if (live && live.lightbox === dlg) live.lightbox = null; if (back.isConnected) back.focus(); });
    live.lightbox = dlg;
    dlg.showModal();
    close.focus();
  }
  function closeLightbox() { if (live && live.lightbox) { var d = live.lightbox; live.lightbox = null; if (d.open) d.close(); d.remove(); } }

  function destroy() {
    if (!live) return;
    var s = live;
    closeLightbox();
    live = null;
    s.off.forEach(function (fn) { fn(); });
    s.timers.forEach(clearTimeout);
    s.frames.forEach(function (f) { if (f && typeof f.destroy === 'function') f.destroy(); });
  }

  G.CommonsReader = {
    html: html,
    body: body,
    toc: toc,
    readingTime: readingTime,
    summary: summary,
    visibility: visibility,
    safeLink: safeLink,
    safeHash: safeHash,
    safeHref: safeHref,
    personLink: personLink,
    objectLink: objectLink,
    siteCard: siteCard,
    siteTitle: siteTitle,
    parseHash: parseHash,
    handleOf: handleOf,
    safeImage: safeImage,
    esc: esc,
    plain: function (doc) { return plain(doc, 0); },
    emoji: { list: EMOJI_ORDER.map(function (k) { return { name: k, label: EMOJI[k].label, color: EMOJI[k].color }; }), svg: emojiSvg },
    langs: LANG_ORDER.map(function (k) { return { id: k, label: LANGS[k] }; }),
    levels: LEVELS,
    cardKinds: CARD_KIND,
    cardStatus: CARD_STATUS,
    icon: ico,
    mount: mount,
    destroy: destroy
  };
})();
