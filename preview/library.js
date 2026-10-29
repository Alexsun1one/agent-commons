/* R13 LIB-1 · Skill、提示词、组件、产品形态资源库。 */
(function () {
  'use strict';

  var SECTION = {
    skills: { label: 'Skill 库', singular: 'Skill', lead: '装进 Agent 就能用的做法，带完整文件和安装方法。', categories: ['写作','编程','设计','数据','自动化','知识管理'] },
    prompts: { label: '提示词库', singular: '提示词模式', lead: '学结构，不背咒语。填好变量就能复制。', categories: ['写作','编程','分析','生图','Agent 系统提示','评审与自查'] },
    components: { label: '组件库', singular: '组件库', lead: '按任务、技术栈和边界挑组件。', categories: ['无样式基础件','可拥有源码','可访问性交互','完整组件套件','企业级组件','主题化组件','应用组件套件','企业设计系统','微软生态设计系统','开发者产品界面','通用前端组件'] },
    patterns: { label: '产品形态库', singular: '产品形态', lead: '先定信息与动作的骨架，再做视觉。', categories: ['创作协作','快速导航','空间组织','定时摘要','并行协作','主题讨论','上下文助手','关系探索','密集目录','治理审核','过程回放','激励反馈'] }
  };

  var ROUTES = ['skills','prompts','components','patterns'];
  var SECTION_LINKS = [
    ['skills','Skill'],
    ['prompts','提示词'],
    ['components','组件'],
    ['patterns','产品形态'],
    ['tools','AI 工具']
  ];
  var state = {
    root: null,
    route: 'skills',
    query: '',
    category: '全部',
    selected: {},
    installTabs: {},
    compare: [],
    variables: {},
    unbind: [],
    live: null,
    liveError: '',
    liveLoading: false,
    search: { q: '', route: '', items: null },
    searchTimer: 0,
    notFound: {},
    fetching: {},
    cursors: {},
    onlySaved: false,
    savedView: { route: '', items: null, cursor: '' },
    saveBusy: false,
    moreBusy: false
  };

  var ROUTE_OF = { skill: 'skills', prompt: 'prompts', component_lib: 'components', pattern: 'patterns' };
  var TYPE_OF = { skills: 'skill', prompts: 'prompt', components: 'component_lib', patterns: 'pattern' };
  /* 真实模式表单字段：[名称, 标签, 控件, 必填, 提示, 仅投稿]。控件：line 单行 / list 顿号或逗号隔开 / area 多行 / lines 一行一项 */
  var LIVE_FIELDS = {
    skills: [
      ['purpose', '什么时候用', 'area', 1, ''], ['clients', '适用客户端', 'list', 1, '例如：Codex、Claude Code'],
      ['skill_md', '完整文件（SKILL.md）', 'area', 1, ''], ['install', '安装方法（每个客户端各记一份）', 'area', 0, '', 1],
      ['before', '用之前', 'area', 0, ''], ['after', '用之后', 'area', 0, ''],
      ['example_input', '示例：输入', 'area', 1, ''], ['example_output', '示例：输出', 'area', 1, '']
    ],
    prompts: [
      ['use_when', '什么时候用', 'area', 1, ''], ['template', '模板（变量用双花括号）', 'area', 1, '面向 {{audience}}，完成 {{task}}'],
      ['example_input', '示例：输入', 'area', 1, ''], ['example_output', '示例：输出', 'area', 1, ''],
      ['comparison_bad', '差的写法', 'area', 0, ''], ['comparison_good', '好的写法', 'area', 0, ''],
      ['model_notes', '不同模型的注意点（一行一条）', 'lines', 0, '']
    ],
    components: [
      ['strengths', '擅长什么', 'area', 1, ''], ['stack', '技术栈', 'list', 0, '例如：React、Vue'],
      ['choose_when', '什么时候选', 'area', 1, ''], ['avoid_when', '什么时候别选', 'area', 1, ''],
      ['usage_code', '最小用法代码', 'area', 1, ''], ['example', '一个完整示例', 'area', 1, '']
    ],
    patterns: [
      ['use_when', '什么时候用', 'area', 1, ''], ['structure', '结构说明', 'area', 1, ''],
      ['pitfalls', '常见的坑（一行一条）', 'lines', 1, ''], ['site_route', '本站使用路由', 'line', 1, '#/knowledge'],
      ['known_products', '知名产品中的例子（一行一个）', 'lines', 0, ''], ['example', '一个完整示例', 'area', 1, '']
    ]
  };

  function isLive() {
    return !(location.protocol === 'file:' || (window.COMMONS_BUILD && window.COMMONS_BUILD.mode === 'demo'));
  }

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function safeUrl(v) {
    if (window.Commons && typeof window.Commons.safeUrl === 'function') return window.Commons.safeUrl(v);
    var value = String(v || '');
    return value.indexOf('#/') === 0 ? esc(value) : '#';
  }

  function data() {
    if (isLive()) return state.live || { skills: [], prompts: [], components: [], patterns: [] };
    return window.COMMONS_LIBRARY_SAMPLE || { skills: [], prompts: [], components: [], patterns: [] };
  }

  function personLink(handle, name, level) {
    if (window.CommonsLinks && typeof window.CommonsLinks.person === 'function') {
      return window.CommonsLinks.person(handle, name, { level: level });
    }
    return handle ? '<a class="lk-person" href="#/u/' + encodeURIComponent(handle) + '">' + esc(name) + '</a>' : esc(name);
  }

  function objectLink(kind, id, label) {
    if (window.CommonsLinks && typeof window.CommonsLinks.a === 'function') return window.CommonsLinks.a(kind, id, label);
    var roots = { skill: 'skills', prompt: 'prompts', component: 'components', pattern: 'patterns' };
    return id && roots[kind]
      ? '<a class="lk-object" href="#/' + roots[kind] + '/' + encodeURIComponent(id) + '">' + esc(label) + '</a>'
      : '<span>' + esc(label) + '</span>';
  }

  function allItems() {
    return ROUTES.reduce(function (rows, route) { return rows.concat(data()[route] || []); }, []);
  }

  function peopleLine(label, people) {
    if (!Array.isArray(people) || !people.length) return '';
    return '<p class="lib-people"><span>' + esc(label) + '</span>' + ( /* safe: personLink 自行转义 */ people.map(function (person) {
      return personLink(person.handle, person.name, person.level);
    }).join(' · ') ) + '</p>';
  }

  function sameAuthor(item) {
    if (!item.authorHandle) return '';
    var rows = allItems().filter(function (other) { return other.id !== item.id && other.authorHandle === item.authorHandle; }).slice(0, 4);
    if (!rows.length) return '';
    return '<section class="lib-same-author"><h3>同作者的其他资源</h3><p>' + ( /* safe: objectLink 自行转义 */ rows.map(function (other) {
      return objectLink(other.kind, other.id, other.name);
    }).join(' · ') ) + '</p></section>';
  }

  function read(key, fallback) {
    if (window.Commons && typeof window.Commons.read === 'function') return window.Commons.read('library.' + key, fallback);
    return fallback;
  }

  function write(key, value) {
    if (window.Commons && typeof window.Commons.write === 'function') return window.Commons.write('library.' + key, value);
    return false;
  }

  function toast(message) {
    if (window.Commons && typeof window.Commons.toast === 'function') window.Commons.toast(message);
  }

  function icon(name, size) {
    if (window.CommonsIcons && typeof window.CommonsIcons.svg === 'function') return window.CommonsIcons.svg(name, { size: size || 16 });
    if (window.Commons && typeof window.Commons.icon === 'function') return window.Commons.icon(name);
    return '';
  }

  function listPref(key) {
    var value = read(key, []);
    return Array.isArray(value) ? value : [];
  }

  function countPref(key) {
    var value = read(key, {});
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }

  function isFavorite(id) {
    if (isLive()) { var seen = findLive(id); return !!(seen && seen.saved); }
    return listPref('favorites').indexOf(id) !== -1;
  }

  function localCount(key, id) {
    if (isLive()) return 0;
    return Number(countPref(key)[id]) || 0;
  }

  function savedOnly() {
    return isLive() && state.onlySaved && state.savedView.route === state.route && Array.isArray(state.savedView.items);
  }

  function moreCursor() {
    if (searching()) return state.search.cursor || '';
    if (savedOnly()) return state.savedView.cursor || '';
    return state.cursors[state.route] || '';
  }

  function searching() {
    return isLive() && !!state.query.trim() && state.search.route === state.route && Array.isArray(state.search.items);
  }

  function currentItems() {
    var rows = Array.isArray(data()[state.route]) ? data()[state.route] : [];
    if (searching()) rows = state.search.items;
    else if (savedOnly()) rows = state.savedView.items;
    var q = state.query.trim().toLowerCase();
    return rows.filter(function (item) {
      if (state.category !== '全部' && item.category !== state.category) return false;
      if (!q || isLive()) return true;
      var text = [item.name, item.category, item.summary, item.when, item.specialty, item.scene, item.stack].join(' ').toLowerCase();
      return text.indexOf(q) !== -1;
    });
  }

  function currentItem() {
    var rows = currentItems();
    var id = state.selected[state.route];
    var item = rows.filter(function (row) { return row.id === id; })[0] || null;
    if (!item && isLive() && id && state.notFound[id]) return null;
    item = item || rows[0] || null;
    if (item && !(isLive() && id && !rows.some(function (row) { return row.id === id; }))) state.selected[state.route] = item.id;
    return item;
  }

  function itemSummary(item) {
    return item.summary || item.when || item.specialty || item.scene || '';
  }

  function samplePill() {
    return isLive() ? '' : '<span class="pill outline">示例</span>';
  }

  function pendingPills(item) {
    if (item.status === 'pending_review') return '<span class="pill notice">审核中</span>';
    var list = item.pending || [];
    if (!list.length) return '';
    return '<span class="pill notice">待核 ' + esc(String(list.length)) + '</span>';
  }

  function sectionTabs(active) {
    return '<nav class="hub-sub lib-section-tabs" aria-label="资源类型">' + SECTION_LINKS.map(function (row) {
      var count = row[0] === 'tools' ? (window.CommonsTools && window.CommonsTools.count ? window.CommonsTools.count() : null) : (data()[row[0]] || []).length + (isLive() && state.cursors[row[0]] ? '+' : '');
      var current = active === row[0];
      return '<a class="hub-sub-link' + (current ? ' is-current' : '') + '" href="#/' + esc(row[0]) + '"' + (current ? ' aria-current="page"' : '') + '>' + esc(row[1]) + '<small>' + esc(count == null ? '—' : String(count)) + '</small></a>';
    }).join('') + '</nav>';
  }

  // /api/me.capability_reasons 给的原因；没有就返回空串，调用方退回原来的说法。
  function whyNot(action) {
    var session = window.CommonsSession;
    return session && typeof session.reason === 'function' ? session.reason(action) : '';
  }

  function canSubmit() {
    if (!isLive()) return true;
    var session = window.CommonsSession;
    return !(session && typeof session.can === 'function') || session.can('library.submit');
  }

  /* safe-fn: 全部是本文件写死的文案；不写等级数字，门槛由服务器决定 */
  function submitEntry(extraClass) {
    if (canSubmit()) return '<button type="button" class="button primary" data-lib-act="submit-open">我要投稿</button>';
    var why = whyNot('library.submit');
    return '<button type="button" class="button primary" data-lib-act="submit-open" disabled aria-disabled="true"' + (why ? ' title="' + esc(why) + '"' : '') + '>我要投稿</button>' +
      '<p class="lib-gate-note' + ( /* safe: 调用点只传写死的类名 */ extraClass ) + '" role="status">' +
      (why ? esc(why) + (/^需要 L/.test(why) ? '，<a href="#/growth">看看怎么升级</a>' : '') : '你现在的等级还不能投稿，<a href="#/growth">看看怎么升级</a>') + '</p>';
  }

  function header() {
    var meta = SECTION[state.route];
    if (/^#\/(skills|prompts|components|patterns)\/[^/?]+/.test(String(location.hash || ''))) {
      return '<header class="lib-detail-intro"><a class="back" href="#/' + esc(state.route) + '">返回资源库</a><h1>' + esc(meta.label) + '</h1></header>';
    }
    return sectionTabs(state.route) + '<div class="lib-toolbar"><p>' + esc(meta.lead) + '</p><div>' + samplePill() +
      submitEntry('') + '</div></div>';
  }

  function categoryList(route) {
    var base = SECTION[route].categories.slice();
    if (!isLive()) return base;
    (data()[route] || []).forEach(function (item) {
      if (item.category && base.indexOf(item.category) === -1) base.push(item.category);
    });
    return base;
  }

  function filters() {
    var categories = ['全部'].concat(categoryList(state.route));
    return '<div class="lib-filters">' +
      '<label class="lib-search"><span class="visually-hidden">搜索' + esc(SECTION[state.route].label) + '</span>' + icon('search', 16) +
      '<input class="search-input" data-lib-form="search" value="' + esc(state.query) + '" placeholder="搜索名称、用途或技术栈"></label>' +
      '<div class="lib-category-row" aria-label="分类筛选">' + categories.map(function (category) {
        return '<button type="button" class="chip" data-lib-act="category" data-id="' + esc(category) + '" aria-pressed="' + (state.category === category) + '">' + esc(category) + '</button>';
      }).join('') + '</div></div>';
  }

  function listRow(item) {
    var selected = state.selected[state.route] === item.id;
    var used = Number(item.usedCount) + localCount('used', item.id);
    return '<li><button type="button" class="lib-list-row" data-lib-act="select" data-id="' + esc(item.id) + '" aria-current="' + (selected ? 'true' : 'false') + '">' +
      '<span class="lib-row-icon" aria-hidden="true">' + icon(state.route === 'skills' ? 'tool' : state.route === 'prompts' ? 'discussion' : state.route === 'components' ? 'organized' : 'connection', 17) + '</span>' +
      '<span class="lib-row-copy"><span class="lib-row-title"><b>' + esc(item.name) + '</b>' + pendingPills(item) + '</span><small>' + esc(itemSummary(item)) + '</small><span>' + esc(item.category) + ' · ' + esc(String(used)) + ' 人用过</span></span>' +
      ('<span class="lib-row-save" title="' + (isFavorite(item.id) ? '已收藏' : '未收藏') + '">' + icon(isFavorite(item.id) ? 'favorite' : 'save', 15) + '</span>') +
      '</button></li>';
  }

  function listPanel() {
    var rows = currentItems();
    return '<aside class="lib-index" aria-label="资源条目">' +
      '<div class="lib-index-head"><b>' + esc(String(rows.length)) + (isLive() && moreCursor() ? '+' : '') + ' 条</b>' + (isLive() ? '<button type="button" class="chip" data-lib-act="only-saved" aria-pressed="' + esc(String(!!state.onlySaved)) + '">' + icon('favorite', 14) + '只看收藏</button>' : '') + '</div>' +
      (rows.length ? '<ol class="lib-list">' + rows.map(listRow).join('') + '</ol>' : (isLive() && !(data()[state.route] || []).length
        ? '<div class="lib-empty" role="status">' + icon('search', 22) + '<b>还没有人投稿</b>' + submitEntry(' is-empty') + '</div>'
        : '<div class="lib-empty">' + icon('search', 22) + '<b>' + (savedOnly() && !state.savedView.items.length ? '这一类里你还没有收藏' : '没有匹配的条目') + '</b><button type="button" class="button" data-lib-act="clear-filter">清空筛选</button></div>')) +
      (isLive() && moreCursor() ? '<div class="lib-more"><button type="button" class="button" data-lib-act="more"' + (state.moreBusy ? ' disabled aria-busy="true"' : '') + '>' + (state.moreBusy ? '正在加载…' : '加载更多') + '</button></div>' : '') +
      '</aside>';
  }

  function copyButton(kind, id, label) {
    return '<button type="button" class="button small" data-lib-act="copy" data-kind="' + esc(kind) + '" data-id="' + esc(id) + '">' + icon('copy', 14) + esc(label || '复制') + '</button>';
  }

  function codeBlock(code, kind, item, label) {
    return '<div class="lib-code"><div class="lib-code-head"><span>' + esc(label) + '</span>' + copyButton(kind, item.id, '复制') + '</div><pre><code>' + esc(code) + '</code></pre></div>';
  }

  function bounty(item) {
    if (!item.bounty || !window.CommonsBounty || typeof window.CommonsBounty.badge !== 'function') return '';
    try {
      return '<span class="lib-bounty">' + ( /* safe: CommonsBounty.badge 约定返回全部转义的徽标 HTML */ window.CommonsBounty.badge(item.bounty) ) + '</span>';
    } catch (err) {
      return '';
    }
  }

  function canSave() {
    var session = window.CommonsSession;
    return !(session && typeof session.can === 'function') || session.can('content.save');
  }

  /* safe-fn: 数字与 id 均 esc */
  function liveActionBar(item) {
    var mine = item.mine;
    var owner = !!(item.authorId && window.CommonsSession && window.CommonsSession.me && window.CommonsSession.me.id === item.authorId);
    var saved = !!item.saved;
    var saveWhy = canSave() ? '' : whyNot('content.save');
    return '<div class="lib-action-bar">' +
      '<button type="button" class="button' + (saved ? ' tonal' : '') + '" data-lib-act="favorite" data-id="' + esc(item.id) + '" aria-pressed="' + saved + '"' + (canSave() ? '' : ' disabled aria-disabled="true"' + (saveWhy ? ' title="' + esc(saveWhy) + '"' : '')) + '>' + icon('favorite', 15) + (saved ? '已收藏' : '收藏') + '</button>' +
      '<button type="button" class="button' + (mine !== null && mine !== undefined ? ' tonal' : '') + '" data-lib-act="used" data-id="' + esc(item.id) + '" aria-pressed="' + (mine !== null && mine !== undefined) + '"' + (mine !== null && mine !== undefined ? ' disabled' : '') + '>' + icon('verified', 15) + '我用过 <span>' + esc(String(item.usedCount)) + '</span></button>' +
      '<button type="button" class="button' + (mine === true ? ' tonal' : '') + '" data-lib-act="good" data-id="' + esc(item.id) + '" aria-pressed="' + (mine === true) + '">' + icon('appreciation', 15) + '好用 <span>' + esc(String(item.usefulCount)) + '</span></button>' +
      (owner ? '<button type="button" class="button" data-lib-act="edit-open" data-id="' + esc(item.id) + '">编辑</button>' : '') +
      (saveWhy ? '<p class="lib-gate-note" role="status" data-lib-why="favorite">收藏：' + esc(saveWhy) + '</p>' : '') +
      '<p class="lib-form-error" role="alert" data-lib-action-error hidden></p></div>';
  }

  function actionBar(item) {
    if (isLive()) return liveActionBar(item);
    var good = localCount('good', item.id);
    var used = Number(item.usedCount) + localCount('used', item.id);
    return '<div class="lib-action-bar">' +
      '<button type="button" class="button' + (isFavorite(item.id) ? ' tonal' : '') + '" data-lib-act="favorite" data-id="' + esc(item.id) + '" aria-pressed="' + isFavorite(item.id) + '">' + icon('favorite', 15) + (isFavorite(item.id) ? '已收藏' : '收藏') + '</button>' +
      '<button type="button" class="button" data-lib-act="used" data-id="' + esc(item.id) + '">' + icon('verified', 15) + '我用过 <span>' + esc(String(used)) + '</span></button>' +
      '<button type="button" class="button" data-lib-act="good" data-id="' + esc(item.id) + '">' + icon('appreciation', 15) + '好用 <span>' + esc(String(good)) + '</span></button>' +
      bounty(item) + '</div>';
  }

  function skillDetail(item) {
    var tab = state.installTabs[item.id] || item.clients[0];
    var install = item.installs[tab] || '';
    var beforeAfter = isLive() && !item.before && !item.after ? '' :
      '<section><h3>用之前 / 用之后</h3><div class="lib-before-after"><article><span>之前</span><p>' + esc(item.before) + '</p></article><article><span>之后</span><p>' + esc(item.after) + '</p></article></div></section>';
    var installBlock = isLive() && !item.clients.length ? '' :
      '<section><h3>安装</h3><div class="tabs lib-install-tabs" role="tablist" aria-label="安装客户端">' + item.clients.map(function (client) {
        return '<button type="button" role="tab" data-lib-act="install-tab" data-id="' + esc(item.id) + '" data-value="' + esc(client) + '" aria-selected="' + (tab === client) + '">' + esc(client) + '</button>';
      }).join('') + '</div>' + codeBlock(install, 'install', item, tab) + '</section>';
    return '<section class="lib-detail-body">' +
      '<section><h3>适用客户端</h3><div class="lib-tag-row">' + item.clients.map(function (client) { return '<span class="pill agent">' + esc(client) + '</span>'; }).join('') + '</div></section>' +
      beforeAfter + installBlock +
      '<section><h3>' + esc(item.exampleLabel) + '</h3>' + codeBlock(item.example, 'example', item, 'SKILL.md') + '</section>' +
      '</section>';
  }

  function variableValues(item) {
    if (!state.variables[item.id]) {
      state.variables[item.id] = {};
      item.variables.forEach(function (row) { state.variables[item.id][row[0]] = row[2]; });
    }
    return state.variables[item.id];
  }

  function filledPrompt(item) {
    var values = variableValues(item);
    return String(item.template).replace(/{{\s*([\w-]+)\s*}}/g, function (_, key) {
      return values[key] == null || values[key] === '' ? '【' + key + '】' : values[key];
    });
  }

  function highlightedTemplate(item) {
    var text = String(item.template);
    var out = '';
    var last = 0;
    text.replace(/{{\s*([\w-]+)\s*}}/g, function (match, key, offset) {
      out += esc(text.slice(last, offset));
      out += '<mark>{{' + esc(key) + '}}</mark>';
      last = offset + match.length;
      return match;
    });
    return out + esc(text.slice(last));
  }

  function promptDetail(item) {
    var values = variableValues(item);
    return '<section class="lib-detail-body">' +
      (item.when && item.when !== itemSummary(item) ? '<section><h3>什么时候用</h3><p>' + esc(item.when) + '</p></section>' : '') +
      '<section><h3>模式模板</h3><div class="lib-template">' + highlightedTemplate(item) + '</div></section>' +
      '<section><h3>填变量</h3><div class="lib-variable-grid">' + item.variables.map(function (row) {
        return '<label class="field"><span>' + esc(row[1]) + '</span><input data-lib-form="variable" data-id="' + esc(item.id) + '" data-key="' + esc(row[0]) + '" value="' + esc(values[row[0]]) + '"></label>';
      }).join('') + '</div>' +
      '<div class="lib-code"><div class="lib-code-head"><span>拼好的完整提示词</span>' + copyButton('filled', item.id, '一键复制') + '</div><pre><code data-lib-filled="' + esc(item.id) + '">' + esc(filledPrompt(item)) + '</code></pre></div></section>' +
      '<section><h3>完整样例</h3><div class="lib-example-pair"><article><span>输入</span><p>' + esc(item.exampleInput) + '</p></article><article><span>输出</span><p>' + esc(item.exampleOutput) + '</p></article></div></section>' +
      (isLive() && !item.bad && !item.good ? '' : '<section><h3>差的写法 / 好的写法</h3><div class="lib-before-after"><article><span>差</span><p>' + esc(item.bad) + '</p></article><article><span>好</span><p>' + esc(item.good) + '</p></article></div></section>') +
      (isLive() && !item.modelNotes ? '' : '<section class="lib-model-note"><h3>不同模型的注意点</h3><p>' + esc(item.modelNotes) + '</p></section>') +
      '</section>';
  }

  /* safe-fn: 演示预览函数仅返回固定 HTML；真实模式不调用样例脚本 */
  function componentPreview(kind) { return !isLive() && data().componentPreview ? data().componentPreview(kind) : ''; }

  function comparePanel() {
    var items = (data().components || []).filter(function (item) { return state.compare.indexOf(item.id) !== -1; });
    if (items.length < 2) return '<div class="lib-compare-hint"><b>并排对比</b><p>再选 ' + esc(String(2 - items.length)) + ' 个组件库就能并排看。</p></div>';
    return '<section class="lib-compare"><div class="lib-section-head"><div><h3>并排对比</h3></div><button type="button" class="button ghost small" data-lib-act="compare-clear">清空</button></div><div class="lib-compare-grid">' + items.map(function (item) {
      return '<article><div><b>' + esc(item.name) + '</b>' + pendingPills(item) + '</div><dl><div><dt>擅长</dt><dd>' + esc(item.specialty) + '</dd></div><div><dt>技术栈</dt><dd>' + esc(item.stack) + '</dd></div><div><dt>许可</dt><dd>' + esc(item.license) + '</dd></div><div><dt>别选</dt><dd>' + esc(item.avoid) + '</dd></div></dl></article>';
    }).join('') + '</div></section>';
  }

  function componentDetail(item) {
    var compared = state.compare.indexOf(item.id) !== -1;
    return '<section class="lib-detail-body">' +
      '<div class="lib-component-stage">' + (isLive() ? '' : '<div class="lib-component-demo">' + componentPreview(item.preview) + '</div>') + '<dl class="lib-facts">' + (item.specialty && item.specialty !== itemSummary(item) ? '<div><dt>擅长什么</dt><dd>' + esc(item.specialty) + '</dd></div>' : '') + '<div><dt>技术栈</dt><dd>' + esc(item.stack) + '</dd></div><div><dt>许可</dt><dd>' + esc(item.license) + '</dd></div></dl></div>' +
      '<div class="lib-choose-grid"><article><span>什么时候选</span><p>' + esc(item.choose) + '</p></article><article><span>什么时候别选</span><p>' + esc(item.avoid) + '</p></article></div>' +
      '<section><div class="lib-section-head"><h3>最小用法代码</h3><button type="button" class="button' + (compared ? ' tonal' : '') + '" data-lib-act="compare" data-id="' + esc(item.id) + '" aria-pressed="' + compared + '">' + (compared ? '已加入对比' : '加入对比') + '</button></div>' + codeBlock(item.example, 'example', item, '最小用法') + '</section>' +
      comparePanel() + '</section>';
  }

  function diagram(item) {
    var labels = item.diagram.labels || [];
    var type = item.diagram.type;
    var nodes;
    if (type === 'split' || type === 'sidebar' || type === 'master') {
      nodes = '<rect x="18" y="24" width="98" height="112" rx="9"></rect><rect x="128" y="24" width="214" height="112" rx="9"></rect>' +
        '<text x="67" y="84" text-anchor="middle">' + esc(labels[0]) + '</text><text x="235" y="84" text-anchor="middle">' + esc(labels[1]) + '</text>';
    } else if (type === 'canvas' || type === 'graph') {
      nodes = '<path d="M75 80C130 34 186 34 233 75S302 123 330 72"></path><circle cx="72" cy="82" r="25"></circle><circle cx="205" cy="55" r="28"></circle><circle cx="306" cy="97" r="25"></circle>' +
        '<text x="72" y="86" text-anchor="middle">' + esc(labels[0]) + '</text><text x="205" y="59" text-anchor="middle">' + esc(labels[1]) + '</text><text x="306" y="101" text-anchor="middle">' + esc(labels[2]) + '</text>';
    } else if (type === 'board') {
      nodes = labels.map(function (label, i) { var x = 18 + i * 110; return '<rect x="' + esc(String(x)) + '" y="24" width="96" height="112" rx="9"></rect><text x="' + esc(String(x + 48)) + '" y="48" text-anchor="middle">' + esc(label) + '</text><path d="M' + esc(String(x + 14)) + ' 66h68M' + esc(String(x + 14)) + ' 83h54M' + esc(String(x + 14)) + ' 100h62"></path>'; }).join('');
    } else if (type === 'timeline') {
      nodes = '<path d="M42 80H322"></path>' + labels.map(function (label, i) { var x = 64 + i * 118; return '<circle cx="' + esc(String(x)) + '" cy="80" r="14"></circle><text x="' + esc(String(x)) + '" y="116" text-anchor="middle">' + esc(label) + '</text>'; }).join('');
    } else if (type === 'rank') {
      nodes = '<path d="M40 130V94h62v36M124 130V58h62v72M208 130V78h62v52"></path><rect x="285" y="32" width="58" height="98" rx="9"></rect>' +
        '<text x="314" y="55" text-anchor="middle">流水</text><path d="M297 72h34M297 88h28M297 104h34"></path>';
    } else {
      nodes = '<rect x="22" y="24" width="320" height="112" rx="9"></rect>' + labels.map(function (label, i) { var y = 48 + i * 28; return '<circle cx="44" cy="' + esc(String(y - 4)) + '" r="5"></circle><text x="58" y="' + esc(String(y)) + '">' + esc(label) + '</text>'; }).join('');
    }
    return '<svg class="lib-pattern-svg" viewBox="0 0 360 160" role="img" aria-label="' + esc(item.name) + '结构示意">' + ( /* safe: nodes 只由写死 SVG 标签、数字和 esc 后的标签组成 */ nodes ) + '</svg>';
  }

  /* safe-fn: 结构说明与路由均 esc / safeUrl */
  function livePatternDetail(item) {
    var route = String(item.route || '');
    return '<section class="lib-detail-body">' +
      '<section class="lib-pattern-stage"><span class="lib-stage-label">结构说明</span><pre class="lib-pattern-structure"><code>' + esc(item.structure) + '</code></pre></section>' +
      '<div class="lib-pattern-grid">' + (item.products.length ? '<section><h3>知名产品里的例子</h3><ul>' + item.products.map(function (name) { return '<li>' + esc(name) + '</li>'; }).join('') + '</ul></section>' : '') +
      '<section><h3>常见的坑</h3><p>' + esc(item.pitfalls) + '</p></section></div>' +
      (route.indexOf('#/') === 0 ? '<a class="lib-dogfood" href="' + safeUrl(route) + '"><span>' + icon('connection', 18) + '</span><span><small>我们站里用了它</small><b>' + esc(route) + '</b></span>' + icon('arrow', 16) + '</a>' : '') +
      '</section>';
  }

  function patternDetail(item) {
    if (isLive()) return livePatternDetail(item);
    return '<section class="lib-detail-body">' +
      '<section class="lib-pattern-stage"><span class="lib-stage-label">结构示意</span>' + diagram(item) + '</section>' +
      '<div class="lib-pattern-grid"><section><h3>知名产品里的例子</h3><ul>' + item.products.map(function (name) { return '<li>' + esc(name) + '</li>'; }).join('') + '</ul></section><section><h3>常见的坑</h3><p>' + esc(item.pitfalls) + '</p></section></div>' +
      '<a class="lib-dogfood" href="' + safeUrl(item.route) + '"><span>' + icon('connection', 18) + '</span><span><small>我们站里用了它</small><b>' + esc(item.routeName) + '</b></span>' + icon('arrow', 16) + '</a>' +
      '</section>';
  }

  function detailContent(item) {
    if (state.route === 'skills') return skillDetail(item);
    if (state.route === 'prompts') return promptDetail(item);
    if (state.route === 'components') return componentDetail(item);
    return patternDetail(item);
  }

  function detailPanel() {
    var item = currentItem();
    if (!item) {
      if (isLive() && state.notFound[state.selected[state.route]]) return '<main class="lib-detail"><div class="lib-empty" role="status"><b>没有找到这个资源</b><a class="button" href="#/' + esc(state.route) + '">回到列表</a></div></main>';
      return '<main class="lib-detail"><div class="lib-empty"><b>这里还没有内容</b><button type="button" class="button" data-lib-act="clear-filter">清空筛选</button></div></main>';
    }
    var used = Number(item.usedCount) + localCount('used', item.id);
    return '<main class="lib-detail" aria-labelledby="lib-detail-title">' +
      '<header class="lib-detail-head"><div><div class="lib-meta-row"><span class="pill agent">' + esc(item.category) + '</span>' + pendingPills(item) + '</div><h2 id="lib-detail-title">' + esc(item.name) + '</h2><p>' + esc(itemSummary(item)) + '</p><div class="lib-byline"><span>' + ( /* safe: personLink 已逐值转义；真实模式只有显示名，经 esc */ isLive() ? esc(item.author) : personLink(item.authorHandle, item.author, item.authorLevel) ) + '</span>' + (item.version ? '<span>' + esc(item.version) + '</span>' : '') + '<span>' + esc(String(used)) + ' 人用过</span></div>' +
      peopleLine('贡献者', item.contributors) + peopleLine('被谁用过', item.usedBy) + '</div>' +
      (item.image ? '<img class="lib-detail-art" src="' + safeUrl(item.image) + '" alt="' + esc(item.name) + '示意图" width="512" height="512" loading="lazy" decoding="async">' : '') + '</header>' +
      actionBar(item) + detailContent(item) +
      sameAuthor(item) +
      (isLive() && item.status !== 'active'
        ? '<section class="lib-comments"><h3>评论</h3><p class="lib-comments-note" role="status">审核通过后可以评论。</p></section>'
        : '<section class="lib-comments"><h3>评论</h3><div data-library-thread></div></section>') +
      '</main>';
  }

  function lines(list) {
    return Array.isArray(list) ? list.filter(Boolean) : [];
  }

  function isClosed(error) {
    return !!(error && (error.status === 501 || error.code === 'capability_unavailable'));
  }

  function errorText(error, fallback) {
    if (isClosed(error)) return '这个功能还没开放。管理员还没打开。';
    if (error && error.code === 'version_conflict') return '内容已被改过，请刷新。';
    return (error && error.message) || fallback;
  }

  function newKey() {
    return window.CommonsAPI.newIdempotencyKey();
  }

  function promptVariables(template, listed) {
    var keys = [];
    String(template).replace(/{{\s*([\w-]+)\s*}}/g, function (match, key) {
      if (keys.indexOf(key) === -1) keys.push(key);
      return match;
    });
    return keys.map(function (key) {
      var note = lines(listed).filter(function (text) { return text.indexOf(key) === 0; })[0] || '';
      return [key, note.replace(key, '').replace(/^[\s:：-]+/, '') || key, ''];
    });
  }

  /* 接口条目 → 演示版式用的字段。只读接口返回的内容，没有任何示例兜底。 */
  function normalize(raw) {
    var content = raw.content || {};
    var usage = raw.usage || {};
    var author = raw.author || {};
    var example = (raw.examples || [])[0] || {};
    var item = {
      id: raw.id, kind: raw.type, raw: raw, name: raw.title || '', category: raw.category || '', status: raw.status || '',
      authorId: author.id || '', author: author.display_name || '', license: raw.license || '', etag: raw.etag || '',
      usedCount: Number(usage.count) || 0, usefulCount: Number(usage.useful_count) || 0, mine: usage.mine == null ? null : !!usage.mine, saved: !!raw.saved, version: ''
    };
    if (raw.type === 'skill') {
      var installs = {};
      (raw.installs || []).forEach(function (row) { installs[row.client] = row.instructions; });
      item.summary = content.purpose || '';
      item.version = content.version ? String(content.version) : '';
      item.installs = installs;
      item.clients = Object.keys(installs).length ? Object.keys(installs) : lines(raw.clients_or_stacks);
      item.before = content.before || '';
      item.after = content.after || '';
      item.exampleLabel = '完整文件';
      item.example = content.skill_md || '';
    } else if (raw.type === 'prompt') {
      item.when = content.use_when || '';
      item.summary = item.when;
      item.template = content.template || '';
      item.variables = promptVariables(item.template, content.variables);
      item.exampleInput = example.input || '';
      item.exampleOutput = example.output || '';
      item.bad = example.comparison_bad || '';
      item.good = example.comparison_good || '';
      item.modelNotes = lines(content.model_notes).join('；');
    } else if (raw.type === 'component_lib') {
      item.specialty = content.strengths || '';
      item.summary = item.specialty;
      item.stack = lines(raw.clients_or_stacks).join(' / ');
      item.choose = content.choose_when || '';
      item.avoid = content.avoid_when || '';
      item.example = content.usage_code || '';
    } else {
      item.summary = content.use_when || '';
      item.structure = content.structure || '';
      item.products = lines(content.known_products);
      item.pitfalls = lines(content.pitfalls).join('；');
      item.route = content.site_route || '';
    }
    return item;
  }

  function savedFind(id) {
    return (state.savedView.items || []).filter(function (item) { return item.id === id; })[0] || null;
  }

  function findLive(id) {
    var found = null;
    allItems().concat(state.search.items || [], state.savedView.items || []).forEach(function (item) { if (item.id === id) found = item; });
    return found;
  }

  function replaceItem(raw) {
    var route = ROUTE_OF[raw && raw.type];
    if (!route || !state.live) return null;
    var item = normalize(raw);
    var rows = state.live[route];
    var index = -1;
    rows.forEach(function (row, i) { if (row.id === item.id) index = i; });
    if (index >= 0) rows[index] = item; else rows.unshift(item);
    if (state.search.items) state.search.items = state.search.items.map(function (row) { return row.id === item.id ? item : row; });
    if (state.savedView.items) state.savedView.items = state.savedView.items.map(function (row) { return row.id === item.id ? item : row; });
    return item;
  }

  function metaCursor(response) {
    return (response && response.meta && response.meta.next_cursor) || '';
  }

  function appendRows(list, rows) {
    var have = {};
    list.forEach(function (row) { have[row.id] = true; });
    rows.forEach(function (row) { if (!have[row.id]) { have[row.id] = true; list.push(row); } });
  }

  function setSaved(id, on) {
    [state.live ? ROUTES.reduce(function (all, r) { return all.concat(state.live[r] || []); }, []) : [], state.search.items || [], state.savedView.items || []].forEach(function (rows) {
      rows.forEach(function (row) { if (row.id === id) { row.saved = on; if (row.raw) row.raw.saved = on; } });
    });
  }

  var favoriteKeys = {};

  function liveFavorite(id, btn) {
    var item = findLive(id);
    if (!item || state.saveBusy) return;
    var want = !item.saved;
    var sig = (want ? 'save:' : 'unsave:') + id;
    var idem = favoriteKeys[sig] || (favoriteKeys[sig] = newKey());
    state.saveBusy = true;
    if (btn) btn.disabled = true;
    var call = want ? window.CommonsAPI.put : window.CommonsAPI.del;
    call('/content/objects/' + encodeURIComponent(id) + '/save', {}, { idempotencyKey: idem }).then(function (response) {
      delete favoriteKeys[sig];
      state.saveBusy = false;
      var on = !!(response && response.data && response.data.saved);
      setSaved(id, on);
      if (savedOnly() && !on) {
        state.savedView.items = state.savedView.items.filter(function (row) { return row.id !== id; });
        if (state.selected[state.route] === id) state.selected[state.route] = '';
      }
      paint('favorite', id);
      toast(on ? '已收藏。' : '已取消收藏。');
    }).catch(function (error) {
      state.saveBusy = false;
      if (btn) btn.disabled = false;
      actionNote(errorText(error, '没收藏上。原状态没有变化。'));
    });
  }

  function loadSaved() {
    var route = state.route;
    window.CommonsAPI.get('/library/items', { type: TYPE_OF[route], saved: 'true', limit: 50 }).then(function (response) {
      if (!state.onlySaved || state.route !== route) return;
      state.savedView = { route: route, items: liveRows(response).map(normalize), cursor: metaCursor(response) };
      state.selected[route] = '';
      paint('only-saved');
    }).catch(function (error) {
      state.onlySaved = false;
      paint('only-saved');
      toast(errorText(error, '收藏列表没有载入。'));
    });
  }

  function loadMore() {
    if (state.moreBusy || !moreCursor()) return;
    var route = state.route;
    var cursor = moreCursor();
    var which = searching() ? 'search' : savedOnly() ? 'saved' : 'list';
    var path = which === 'search' ? '/library/search' : '/library/items';
    var query = { type: TYPE_OF[route], limit: 50, cursor: cursor };
    if (which === 'search') query.q = state.search.q;
    if (which === 'saved') query.saved = 'true';
    state.moreBusy = true;
    paint('more');
    window.CommonsAPI.get(path, query).then(function (response) {
      state.moreBusy = false;
      var rows = liveRows(response).map(normalize);
      var next = metaCursor(response);
      if (which === 'search') { appendRows(state.search.items, rows); state.search.cursor = next; }
      else if (which === 'saved') { appendRows(state.savedView.items, rows); state.savedView.cursor = next; }
      else { appendRows(state.live[route], rows); state.cursors[route] = next; }
      paint('more');
    }).catch(function (error) {
      state.moreBusy = false;
      paint('more');
      toast(errorText(error, '更多条目没有载入，点「加载更多」再试一次。'));
    });
  }

  function liveRows(response) {
    var rows = response && response.data;
    return Array.isArray(rows) ? rows : (rows && rows.items) || [];
  }

  function loadItem(id, quiet) {
    if (!isLive() || !id || state.fetching[id] || !window.CommonsAPI) return;
    state.fetching[id] = true;
    window.CommonsAPI.get('/library/items/' + encodeURIComponent(id)).then(function (response) {
      state.fetching[id] = false;
      var before = findLive(id);
      var stamp = before ? before.etag + JSON.stringify(before.raw.usage || null) : '';
      var item = replaceItem((response && response.data) || {});
      if (!item) return;
      if (ROUTE_OF[item.kind] !== state.route) { state.notFound[id] = true; }
      if (state.root && !(quiet && stamp === item.etag + JSON.stringify(item.raw.usage || null))) paint();
    }).catch(function (error) {
      state.fetching[id] = false;
      if (error && (error.status === 404 || error.code === 'resource_not_found')) {
        state.notFound[id] = true;
        if (state.root) paint();
        return;
      }
      if (!quiet) toast(errorText(error, '详情没有载入。'));
    });
  }

  function ensureSelected() {
    var id = state.selected[state.route];
    if (isLive() && state.live && id && !findLive(id) && !state.notFound[id]) loadItem(id, false);
  }

  function runSearch() {
    var q = state.query.trim().slice(0, 100);
    var route = state.route;
    if (!q) {
      state.search = { q: '', route: '', items: null };
      paint('search', '', state.query.length);
      return;
    }
    window.CommonsAPI.get('/library/search', { q: q, type: TYPE_OF[route], limit: 50 }).then(function (response) {
      if (state.query.trim().slice(0, 100) !== q || state.route !== route) return;
      state.search = { q: q, route: route, items: liveRows(response).map(normalize), cursor: metaCursor(response) };
      state.selected[route] = '';
      paint('search', '', state.query.length);
    }).catch(function (error) {
      toast(errorText(error, '搜索没有成功，请再试一次。'));
    });
  }

  function actionNote(message) {
    var note = state.root && state.root.querySelector('[data-lib-action-error]');
    if (note) { note.textContent = message; note.hidden = false; }
    toast(message);
  }

  function liveUsed(id, useful, btn) {
    var item = findLive(id);
    if (!item || state.usageBusy) return;
    state.usageBusy = true;
    if (btn) btn.disabled = true;
    window.CommonsAPI.post('/library/items/' + encodeURIComponent(id) + '/used', { useful: useful }, { idempotencyKey: newKey() }).then(function (response) {
      state.usageBusy = false;
      var usage = (response && response.data) || {};
      item.raw.usage = usage;
      item.usedCount = Number(usage.count) || 0;
      item.usefulCount = Number(usage.useful_count) || 0;
      item.mine = usage.mine == null ? null : !!usage.mine;
      paint(useful ? 'good' : 'used', id);
      toast(useful ? '已记下“好用”。' : (item.mine === null ? '已取消。' : '已记下“我用过”。'));
    }).catch(function (error) {
      state.usageBusy = false;
      if (btn) btn.disabled = false;
      actionNote(errorText(error, '没有记上。原记录没有变化。'));
    });
  }

  function splitList(text) {
    var out = [];
    String(text || '').split(/[,，、\n]/).forEach(function (part) {
      var value = part.trim();
      if (value && out.indexOf(value) === -1) out.push(value);
    });
    return out;
  }

  function splitLines(text) {
    var out = [];
    String(text || '').split('\n').forEach(function (part) {
      var value = part.trim();
      if (value && out.indexOf(value) === -1) out.push(value);
    });
    return out;
  }

  function fieldValue(form, name) {
    var control = form.elements && form.elements[name];
    return control ? String(control.value == null ? '' : control.value) : '';
  }

  function liveValuesOf(route, item) {
    var raw = item.raw;
    var c = raw.content || {};
    var ex = (raw.examples || [])[0] || {};
    var v = { name: raw.title || '', category: raw.category || '', tags: lines(raw.tags).join('、'), license: raw.license || '' };
    if (route === 'skills') {
      v.purpose = c.purpose; v.clients = lines(raw.clients_or_stacks).join('、'); v.skill_md = c.skill_md; v.before = c.before; v.after = c.after;
      v.example_input = ex.input; v.example_output = ex.output;
    } else if (route === 'prompts') {
      v.use_when = c.use_when; v.template = c.template; v.model_notes = lines(c.model_notes).join('\n');
      v.example_input = ex.input; v.example_output = ex.output; v.comparison_bad = ex.comparison_bad; v.comparison_good = ex.comparison_good;
    } else if (route === 'components') {
      v.strengths = c.strengths; v.stack = lines(raw.clients_or_stacks).join('、'); v.choose_when = c.choose_when; v.avoid_when = c.avoid_when;
      v.usage_code = c.usage_code; v.example = ex.output;
    } else {
      v.use_when = c.use_when; v.structure = c.structure; v.pitfalls = lines(c.pitfalls).join('\n'); v.site_route = c.site_route;
      v.known_products = lines(c.known_products).join('\n'); v.example = ex.output;
    }
    return v;
  }

  /* safe-fn: 字段名、标签、提示、取值均 esc */
  function liveFieldHtml(spec, value) {
    var control = spec[2] === 'line' || spec[2] === 'list'
      ? '<input name="' + esc(spec[0]) + '" maxlength="400" value="' + esc(value) + '" placeholder="' + esc(spec[4]) + '">'
      : '<textarea name="' + esc(spec[0]) + '" rows="' + (spec[2] === 'area' ? '4' : '3') + '" maxlength="20000" placeholder="' + esc(spec[4]) + '">' + esc(value) + '</textarea>';
    return '<label class="field"><span>' + esc(spec[1]) + (spec[3] ? '' : '（可选）') + '</span>' + control + '</label>';
  }

  /* safe-fn: 分类与取值均 esc */
  function liveFormHtml(route, item) {
    var edit = !!item;
    var v = edit ? liveValuesOf(route, item) : {};
    var cats = categoryList(route);
    if (v.category && cats.indexOf(v.category) === -1) cats.push(v.category);
    return '<form class="lib-submit-form" data-lib-form="' + (edit ? 'live-edit' : 'live-submit') + '" data-kind="' + esc(route) + '"' + (edit ? ' data-id="' + esc(item.id) + '"' : '') + '>' +
      (edit ? '' : '<p>投稿会先进入审核。每条要带完整示例。</p>') +
      '<label class="field"><span>' + esc(SECTION[route].singular) + '名称</span><input name="name" maxlength="200" value="' + esc(v.name) + '"></label>' +
      '<label class="field"><span>分类</span><select name="category">' + cats.map(function (name) {
        return '<option value="' + esc(name) + '"' + (name === v.category ? ' selected' : '') + '>' + esc(name) + '</option>';
      }).join('') + '</select></label>' +
      '<label class="field"><span>标签（顿号或逗号隔开，最多 12 个，可选）</span><input name="tags" maxlength="400" value="' + esc(v.tags) + '"></label>' +
      '<label class="field"><span>许可（可选）</span><input name="license" maxlength="80" value="' + esc(v.license) + '"></label>' +
      LIVE_FIELDS[route].filter(function (spec) { return !(edit && spec[5]); }).map(function (spec) { return liveFieldHtml(spec, v[spec[0]]); }).join('') +
      '<p class="lib-form-error" role="alert" data-lib-form-error hidden></p>' +
      '<div class="lib-submit-actions"><button type="button" class="button" data-lib-act="submit-cancel">取消</button><button type="submit" class="button primary">' + (edit ? '保存修改' : '提交投稿') + '</button></div></form>';
  }

  function setOptional(content, key, value) {
    if (value) content[key] = value; else delete content[key];
  }

  function buildLivePayload(route, v, base) {
    var content = Object.assign({}, base ? (base.raw.content || {}) : {});
    var clients = [];
    var examples;
    var installs;
    if (route === 'skills') {
      content.purpose = v.purpose; content.skill_md = v.skill_md;
      setOptional(content, 'before', v.before); setOptional(content, 'after', v.after);
      clients = splitList(v.clients);
      examples = [{ input: v.example_input, output: v.example_output }];
      if (!base && v.install) installs = clients.map(function (client) { return { client: client, instructions: v.install }; });
    } else if (route === 'prompts') {
      content.use_when = v.use_when; content.template = v.template;
      if (v.model_notes) content.model_notes = splitLines(v.model_notes); else delete content.model_notes;
      examples = [{ input: v.example_input, output: v.example_output, comparison_bad: v.comparison_bad, comparison_good: v.comparison_good }];
    } else if (route === 'components') {
      content.strengths = v.strengths; content.choose_when = v.choose_when; content.avoid_when = v.avoid_when; content.usage_code = v.usage_code;
      clients = splitList(v.stack);
      examples = [{ output: v.example }];
    } else {
      content.use_when = v.use_when; content.structure = v.structure; content.pitfalls = splitLines(v.pitfalls);
      content.site_route = v.site_route;
      if (v.known_products) content.known_products = splitLines(v.known_products); else delete content.known_products;
      examples = [{ output: v.example }];
    }
    if (base) {
      examples = [Object.assign({}, (base.raw.examples || [])[0] || {}, examples[0])].concat((base.raw.examples || []).slice(1));
    }
    var body = { title: v.name, category: v.category, tags: splitList(v.tags), license: v.license, clients_or_stacks: clients, content: content, examples: examples };
    if (installs) body.installs = installs;
    return body;
  }

  function readLiveValues(form, route) {
    var v = { name: fieldValue(form, 'name').trim(), category: fieldValue(form, 'category'), tags: fieldValue(form, 'tags'), license: fieldValue(form, 'license').trim() };
    LIVE_FIELDS[route].forEach(function (spec) { v[spec[0]] = fieldValue(form, spec[0]).trim(); });
    return v;
  }

  function formNote(form, message) {
    var note = form.querySelector && form.querySelector('[data-lib-form-error]');
    if (!note) { toast(message); return; }
    note.textContent = message;
    note.hidden = false;
  }

  function liveSubmit(form) {
    if (form.dataset.busy === '1') return;
    var route = form.dataset.kind;
    var edit = form.dataset.libForm === 'live-edit';
    var base = edit ? findLive(form.dataset.id) : null;
    if (!LIVE_FIELDS[route] || (edit && !base)) return;
    var v = readLiveValues(form, route);
    var missing = [];
    if (!v.name) missing.push('名称');
    if (!v.category) missing.push('分类');
    LIVE_FIELDS[route].forEach(function (spec) { if (spec[3] && !v[spec[0]]) missing.push(spec[1]); });
    if (missing.length) { formNote(form, '请填写：' + missing.join('、')); return; }
    var body = buildLivePayload(route, v, base);
    var button = form.querySelector('[type="submit"]');
    var note = form.querySelector('[data-lib-form-error]');
    form.dataset.busy = '1';
    if (button) button.disabled = true;
    if (note) { note.textContent = ''; note.hidden = true; }
    var request = edit
      ? window.CommonsAPI.patch('/library/items/' + encodeURIComponent(base.id), body, { idempotencyKey: newKey(), ifMatch: base.etag })
      : window.CommonsAPI.post('/library/items', Object.assign({ type: TYPE_OF[route] }, body), { idempotencyKey: newKey() });
    request.then(function (response) {
      var item = replaceItem((response && response.data) || {});
      if (item && ROUTE_OF[item.kind] === state.route) state.selected[state.route] = item.id;
      closeSubmission();
      paint();
      toast(edit ? '修改已保存。' : '投稿已提交，等待审核。');
    }).catch(function (error) {
      form.dataset.busy = '';
      if (button) button.disabled = false;
      formNote(form, errorText(error, '没有提交成功。内容还在，请再试一次。'));
    });
  }

  function openEdit(id) {
    var item = findLive(id);
    if (!item || !window.Commons || typeof window.Commons.modal !== 'function') return;
    window.Commons.modal('编辑' + SECTION[state.route].singular, liveFormHtml(state.route, item));
  }

  function pageInner() {
    currentItem();
    return header() + filters() + '<div class="lib-workspace">' + listPanel() + detailPanel() + '</div>';
  }

  function liveStateHTML(kind) {
    if (kind === 'error') {
      if (state.liveError === 'closed') {
        return '<div class="lib-page" data-library-page data-route="' + esc(state.route) + '"><div class="lib-empty" role="status"><b>这个功能还没开放</b><p>管理员还没打开。</p></div></div>';
      }
      return '<div class="lib-page" data-library-page data-route="' + esc(state.route) + '"><div class="lib-empty" role="alert"><b>' + esc(state.liveError || '资源库没有载入') + '</b><button type="button" class="button" data-lib-act="retry">重试</button></div></div>';
    }
    return '<div class="lib-page" data-library-page data-route="' + esc(state.route) + '"><div class="lib-empty" aria-live="polite"><b>正在读取资源库…</b></div></div>';
  }

  function wrap() {
    if (isLive() && state.liveError) return liveStateHTML('error');
    if (isLive() && !state.live) return liveStateHTML('loading');
    return '<div class="lib-page" data-library-page data-route="' + esc(state.route) + '">' + pageInner() + '</div>';
  }

  function selectedById(id) {
    return (data()[state.route] || []).filter(function (item) { return item.id === id; })[0] || (isLive() ? findLive(id) || savedFind(id) : null);
  }

  function copyText(text) {
    text = String(text || '');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast('已复制到剪贴板。'); }, function () { fallbackCopy(text); });
      return;
    }
    fallbackCopy(text);
  }

  function fallbackCopy(text) {
    var input = document.createElement('textarea');
    input.value = text;
    input.setAttribute('readonly', '');
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.appendChild(input);
    input.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
    input.remove();
    toast(ok ? '已复制到剪贴板。' : '浏览器没有允许复制，请从代码框手动复制。');
  }

  function copyValue(item, kind) {
    if (!item) return '';
    if (kind === 'example') return item.example || '';
    if (kind === 'filled') return filledPrompt(item);
    if (kind === 'install') {
      var tab = state.installTabs[item.id] || (item.clients && item.clients[0]);
      return item.installs && item.installs[tab] || '';
    }
    return '';
  }

  function toggleList(key, id) {
    var list = listPref(key);
    var on = list.indexOf(id) !== -1;
    var next = on ? list.filter(function (value) { return value !== id; }) : list.concat([id]);
    write(key, next);
    return !on;
  }

  function bump(key, id) {
    var map = countPref(key);
    map[id] = (Number(map[id]) || 0) + 1;
    write(key, map);
    return map[id];
  }

  function submissionForm() {
    var meta = SECTION[state.route];
    var extra = '';
    if (state.route === 'skills') extra = '<label class="field"><span>适用客户端</span><input name="clients" required placeholder="例如：Codex、Claude Code"></label><label class="field"><span>完整文件</span><textarea name="example" rows="5" required placeholder="粘贴完整 SKILL.md 内容"></textarea></label>';
    else if (state.route === 'prompts') extra = '<label class="field"><span>模板（变量用双花括号）</span><textarea name="template" rows="4" required placeholder="面向 {{audience}}，完成 {{task}}"></textarea></label><label class="field"><span>完整输入与输出</span><textarea name="example" rows="5" required></textarea></label>';
    else if (state.route === 'components') extra = '<label class="field"><span>技术栈与许可</span><input name="stackLicense" required placeholder="不确定的许可请写“待核”"></label><label class="field"><span>最小用法代码</span><textarea name="example" rows="5" required></textarea></label>';
    else extra = '<label class="field"><span>知名产品中的例子</span><input name="products" required placeholder="拿不准请写“待核”"></label><label class="field"><span>本站使用路由</span><input name="route" required placeholder="#/knowledge"></label>';
    return '<form class="lib-submit-form" data-lib-form="submission" data-kind="' + esc(state.route) + '">' +
      '<p>投稿先存在这台浏览器，每条要带完整示例。</p>' +
      '<label class="field"><span>' + esc(meta.singular) + '名称</span><input name="name" maxlength="80" required></label>' +
      '<label class="field"><span>什么时候用 / 擅长什么</span><textarea name="purpose" rows="3" maxlength="600" required></textarea></label>' + extra +
      '<div class="lib-submit-actions"><button type="button" class="button" data-lib-act="submit-cancel">取消</button><button type="submit" class="button primary">保存投稿草稿</button></div></form>';
  }

  function openSubmission() {
    if (!canSubmit()) return;
    if (window.Commons && typeof window.Commons.modal === 'function') window.Commons.modal('投稿到' + SECTION[state.route].label, isLive() ? liveFormHtml(state.route, null) : submissionForm());
  }

  function closeSubmission() {
    if (window.Commons && typeof window.Commons.closeModal === 'function') window.Commons.closeModal();
  }

  function restoreFocus(key, id, caret) {
    if (!state.root) return;
    var next;
    if (key === 'search') next = state.root.querySelector('[data-lib-form="search"]');
    else if (key) next = state.root.querySelector('[data-lib-act="' + key + '"]' + (id ? '[data-id="' + id + '"]' : ''));
    if (next && next.focus) {
      next.focus({ preventScroll: true });
      if (caret != null && next.setSelectionRange) next.setSelectionRange(caret, caret);
    }
  }

  function mountThread() {
    if (!state.root) return;
    var host = state.root.querySelector('[data-library-thread]');
    var item = currentItem();
    if (!host || !item || !window.CommonsThread || typeof window.CommonsThread.mount !== 'function') return;
    if (typeof window.CommonsThread.destroy === 'function') window.CommonsThread.destroy();
    if (isLive()) {
      window.CommonsThread.mount(host, { targetId: item.id, repliesOnly: true });
      return;
    }
    window.CommonsThread.mount(host, {
      targetId: 'library:' + item.id,
      messages: data().threadMessages || [],
      people: data().threadPeople || [],
      me: (data().threadPeople || [])[0] || { id: '', name: '我', level: 1 },
      mode: 'tree',
      lastRead: data().threadLastRead
    });
  }

  function paint(focusKey, focusId, caret) {
    if (!state.root) return;
    state.root.innerHTML = pageInner();
    if (window.CommonsHubs && typeof window.CommonsHubs.syncScroll === 'function') window.CommonsHubs.syncScroll();
    mountThread();
    restoreFocus(focusKey, focusId, caret);
  }

  function onClick(event) {
    var btn = event.target.closest('[data-lib-act]');
    if (!btn) return;
    var act = btn.dataset.libAct;
    var id = btn.dataset.id || '';
    if (act === 'retry') { loadLive(); return; }
    if (act === 'select') {
      state.selected[state.route] = id;
      paint('select', id);
      if (isLive()) loadItem(id, true);
    } else if (act === 'category') {
      state.category = id;
      state.selected[state.route] = '';
      paint('category', id);
    } else if (act === 'clear-filter') {
      state.query = '';
      state.category = '全部';
      state.onlySaved = false;
      state.savedView = { route: '', items: null, cursor: '' };
      state.search = { q: '', route: '', items: null };
      paint('search');
    } else if (act === 'only-saved') {
      state.onlySaved = !state.onlySaved;
      state.selected[state.route] = '';
      if (state.onlySaved) { paint('only-saved'); loadSaved(); } else { state.savedView = { route: '', items: null, cursor: '' }; paint('only-saved'); }
    } else if (act === 'more') {
      loadMore();
    } else if (act === 'favorite') {
      if (isLive()) { liveFavorite(id, btn); return; }
      toast(toggleList('favorites', id) ? '已收藏到本机。' : '已取消收藏。');
      paint('favorite', id);
    } else if (act === 'used') {
      if (isLive()) { liveUsed(id, false, btn); return; }
      bump('used', id);
      toast('已记下“我用过”（演示）。');
      paint('used', id);
    } else if (act === 'good') {
      if (isLive()) { var seen = findLive(id); liveUsed(id, !(seen && seen.mine === true), btn); return; }
      bump('good', id);
      toast('已记下“好用”（演示）。');
      paint('good', id);
    } else if (act === 'install-tab') {
      state.installTabs[id] = btn.dataset.value;
      paint('install-tab', id);
    } else if (act === 'copy') {
      copyText(copyValue(selectedById(id), btn.dataset.kind));
    } else if (act === 'compare') {
      var index = state.compare.indexOf(id);
      if (index !== -1) state.compare.splice(index, 1);
      else if (state.compare.length < 3) state.compare.push(id);
      else toast('一次最多对比三个。先移除一个再选。');
      paint('compare', id);
    } else if (act === 'compare-clear') {
      state.compare = [];
      paint();
    } else if (act === 'edit-open') {
      openEdit(id);
    } else if (act === 'submit-open') {
      openSubmission();
    } else if (act === 'submit-cancel') {
      closeSubmission();
    }
  }

  function onInput(event) {
    var search = event.target.closest('[data-lib-form="search"]');
    if (search) {
      state.query = search.value;
      if (isLive()) {
        window.clearTimeout(state.searchTimer);
        state.searchTimer = window.setTimeout(runSearch, 300);
        return;
      }
      state.selected[state.route] = '';
      paint('search', '', search.selectionStart);
      return;
    }
    var variable = event.target.closest('[data-lib-form="variable"]');
    if (!variable) return;
    var item = selectedById(variable.dataset.id);
    if (!item) return;
    variableValues(item)[variable.dataset.key] = variable.value;
    var output = state.root && state.root.querySelector('[data-lib-filled="' + variable.dataset.id + '"]');
    if (output) output.textContent = filledPrompt(item);
  }

  function onSubmit(event) {
    var liveForm = isLive() && event.target.closest ? event.target.closest('[data-lib-form="live-submit"], [data-lib-form="live-edit"]') : null;
    if (liveForm) {
      event.preventDefault();
      liveSubmit(liveForm);
      return;
    }
    var form = event.target.closest('[data-lib-form="submission"]');
    if (!form) return;
    event.preventDefault();
    if (!form.reportValidity()) return;
    var fd = new FormData(form);
    var rows = read('submissions', []);
    if (!Array.isArray(rows)) rows = [];
    var fields = {};
    fd.forEach(function (value, key) { fields[key] = String(value); });
    rows.push({ id: 'lib-draft-' + Date.now(), kind: form.dataset.kind, fields: fields, status: 'local-draft', createdAt: new Date().toISOString(), sample: false });
    if (write('submissions', rows)) {
      closeSubmission();
      toast('投稿草稿已保存在本机，未发送或发布。');
    }
  }

  function on(target, type, fn) {
    target.addEventListener(type, fn);
    state.unbind.push(function () { target.removeEventListener(type, fn); });
  }

  function view(route) {
    state.route = ROUTES.indexOf(route) !== -1 ? route : 'skills';
    state.category = '全部';
    state.query = '';
    state.onlySaved = false;
    state.savedView = { route: '', items: null, cursor: '' };
    state.search = { q: '', route: '', items: null };
    var match = String(location.hash || '').match(/^#\/[^/]+\/([^/?]+)/);
    if (match) {
      try { state.selected[state.route] = decodeURIComponent(match[1]); } catch (err) { state.selected[state.route] = ''; }
    }
    return wrap();
  }

  function loadLive() {
    if (!isLive() || state.liveLoading) return;
    if (!window.CommonsAPI || typeof window.CommonsAPI.get !== 'function') {
      state.liveError = '没有接上接口。';
      if (window.Commons && typeof window.Commons.refresh === 'function') window.Commons.refresh();
      return;
    }
    state.liveLoading = true;
    state.liveError = '';
    var types = ['skill', 'prompt', 'component_lib', 'pattern'];
    Promise.all(types.map(function (type) {
      return window.CommonsAPI.get('/library/items', { type: type, limit: 50 });
    })).then(function (responses) {
      var bag = { skills: [], prompts: [], components: [], patterns: [] };
      state.cursors = {};
      responses.forEach(function (response, index) {
        bag[ROUTE_OF[types[index]]] = liveRows(response).map(normalize);
        state.cursors[ROUTE_OF[types[index]]] = metaCursor(response);
      });
      state.live = bag;
      state.liveLoading = false;
      if (window.Commons && typeof window.Commons.refresh === 'function') window.Commons.refresh();
    }).catch(function (error) {
      state.live = null;
      state.liveLoading = false;
      state.liveError = isClosed(error) ? 'closed' : ((error && error.message) || '资源库没有载入');
      if (window.Commons && typeof window.Commons.refresh === 'function') window.Commons.refresh();
    });
  }

  function mount() {
    var root = document.querySelector('[data-library-page]');
    if (!root) return;
    destroy(false);
    state.root = root;
    state.route = root.dataset.route || state.route;
    currentItem();
    if (isLive() && !state.live && !state.liveError && !state.liveLoading) loadLive();
    ensureSelected();
    on(root, 'input', onInput);
    on(document, 'click', onClick);
    on(document, 'submit', onSubmit);
    mountThread();
  }

  function destroy(withThread) {
    state.unbind.forEach(function (fn) { fn(); });
    state.unbind = [];
    state.root = null;
    window.clearTimeout(state.searchTimer);
    if (withThread !== false && window.CommonsThread && typeof window.CommonsThread.destroy === 'function') window.CommonsThread.destroy();
  }

  window.CommonsLibrary = {
    hub: ['skills','prompts','components','patterns'],
    routes: {
      skills: function () { return view('skills'); },
      prompts: function () { return view('prompts'); },
      components: function () { return view('components'); },
      patterns: function () { return view('patterns'); }
    },
    nav: [
      ['skills','Skill 库','tool','library'],
      ['prompts','提示词库','discussion','library'],
      ['components','组件库','organized','library'],
      ['patterns','产品形态库','connection','library']
    ],
    mount: mount,
    destroy: destroy,
    typeTabs: sectionTabs
  };

  if (window.CommonsLinks && typeof window.CommonsLinks.provide === 'function') {
    ['skill', 'prompt', 'component', 'pattern'].forEach(function (kind) {
      window.CommonsLinks.provide(kind, function (handle) {
        var rows = allItems().filter(function (item) { return item.kind === kind && item.authorHandle === handle; });
        return rows.length ? { label: SECTION[rootsFor(kind)].label, href: '#/' + rootsFor(kind) + '/' + encodeURIComponent(rows[0].id), count: rows.length, icon: 'organized' } : null;
      });
    });
  }

  (window.CommonsPages = window.CommonsPages || []).push(window.CommonsLibrary);

  function rootsFor(kind) {
    return { skill: 'skills', prompt: 'prompts', component: 'components', pattern: 'patterns' }[kind];
  }
})();
