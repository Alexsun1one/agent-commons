/* R13 SEARCH-2 · 全站搜索页与命令面板聚合器。 */
(function () {
  'use strict';

  var GROUP_LIMIT = 3;
  var SYNONYMS = {
    cc: ['claude code']
  };
  var KINDS = {
    problem: { label: '问题', route: '#/solved', blurb: '从现象和环境找到可复核的解决记录', order: 1 },
    knowledge: { label: '知识', route: '#/knowledge', blurb: '从问题簇回到方法、边界与证据', order: 2 },
    skill: { label: 'Skill', route: '#/skills', blurb: '查找可复用的智能体能力与使用边界', order: 3 },
    prompt: { label: '提示词', route: '#/prompts', blurb: '按任务寻找提示词、输入条件和限制', order: 4 },
    component: { label: '组件', route: '#/components', blurb: '浏览可组合的界面与工作流组件', order: 5 },
    pattern: { label: '产品形态', route: '#/patterns', blurb: '从场景和约束寻找产品结构参考', order: 6 },
    discussion: { label: '讨论串', route: '#/threads', blurb: '回到问题、分歧和上下文继续讨论', order: 7 },
    work: { label: '作品', route: '#/people', blurb: '找到可复现作品与公开证据', order: 8 },
    agent: { label: 'Agent', route: '#/agents', blurb: '按能力和作品找到合适的智能体', order: 9 },
    member: { label: '成员', route: '#/people', blurb: '按方向、工具和作品寻找同行', order: 10 },
    hot: { label: '热点', route: '#/hot', blurb: '查看近期值得跟进的行业与工具变化', order: 11 },
    talk: { label: '讲堂', route: '#/talks', blurb: '进入可回看的分享和教学内容', order: 12 },
    market: { label: '市集帖', route: '#/market', blurb: '找闲置、求购、合作与招聘线索', order: 13 },
    event: { label: '活动', route: '#/events', blurb: '查看挑战、共学、讲堂与线下活动', order: 14 },
    campaign: { label: '打榜', route: '#/campaigns', blurb: '查看正在进行和已经结束的榜单', order: 15 },
    bounty: { label: '悬赏', route: '#/bounties', blurb: '寻找目标、范围与交付条件明确的任务', order: 16 },
    shop: { label: '商店商品', route: '#/shop', blurb: '用竹子兑换外观、装饰与表情包', order: 17 }
  };
  var RECENT_EXAMPLES = ['Claude Code', 'Agent', '提示词'];
  var TIME_LABELS = { week: '最近 7 天', month: '最近 30 天', older: '更早' };
  var state = {
    root: null,
    query: '',
    filters: { kind: 'all', direction: 'all', tool: 'all', time: 'all' },
    expanded: {},
    drawerOpen: false,
    drawerOpener: null,
    unbind: []
  };
  var liveCache = new Map();
  var livePending = new Map();
  var liveErrors = new Map();

  function text(value) {
    if (Array.isArray(value)) return value.map(text).join(' ');
    if (value && typeof value === 'object') return Object.keys(value).map(function (key) { return text(value[key]); }).join(' ');
    return String(value == null ? '' : value);
  }

  function terms(query) {
    var base = String(query || '').trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    return base.map(function (term) { return [term].concat(SYNONYMS[term] || []); });
  }

  function matches(item, query) {
    var haystack = text(item).toLocaleLowerCase();
    var groups = terms(query);
    return groups.length > 0 && groups.every(function (choices) {
      return choices.some(function (choice) { return haystack.indexOf(choice) !== -1; });
    });
  }

  function normalize(item, fallbackKind, fallbackHref) {
    if (!item || typeof item !== 'object') return null;
    var kind = String(item.kind || fallbackKind || '');
    if (kind === 'component_lib') kind = 'component';
    if (!KINDS[kind]) return null;
    var title = item.title || item.name || item.label;
    if (!title) return null;
    return {
      kind: kind,
      id: String(item.id || item.slug || title),
      title: String(title),
      snippet: String(item.snippet || item.summary || item.phenomenon || item.body || item.blurb || item.description || ''),
      href: String(item.href || fallbackHref || KINDS[kind].route),
      meta: item.meta && typeof item.meta === 'object' ? item.meta : {},
      date: String(item.date || item.updated_at || item.created_at || item.last_seen || item.when || '')
    };
  }

  function result(item, kind, href, snippet, meta, date) {
    return normalize({
      kind: kind,
      id: item.id,
      title: item.title || item.name,
      snippet: snippet,
      href: href,
      meta: meta || {},
      date: date || ''
    }, kind, href);
  }

  function kbAdapter(query) {
    var sample = window.COMMONS_KB_SAMPLE;
    if (!sample) return [];
    var tools = Object.fromEntries((sample.tools || []).map(function (pair) { return pair; }));
    return (sample.problems || []).filter(function (item) { return matches(item, query); }).map(function (item) {
      var tool = item.environments && item.environments[0] ? tools[item.environments[0].tool_key] || item.environments[0].tool_key : '';
      return result(item, 'problem', '#/solved', item.phenomenon, {
        tool: tool,
        direction: item.industry_key || '',
        status: item.status || ''
      }, item.updated_at);
    });
  }

  function libraryAdapter(query) {
    var sample = window.COMMONS_LIBRARY_SAMPLE;
    if (!sample) return [];
    var sets = [
      ['skills', 'skill', '#/skills'],
      ['prompts', 'prompt', '#/prompts'],
      ['components', 'component', '#/components'],
      ['patterns', 'pattern', '#/patterns']
    ];
    return sets.flatMap(function (spec) {
      return (sample[spec[0]] || []).filter(function (item) { return matches(item, query); }).map(function (item) {
        var tool = text(item.clients || item.stack || item.specialty || '');
        var snippet = item.summary || item.when || item.choose || item.scene || item.avoid || '';
        return result(item, spec[1], spec[2], snippet, { tool: tool, direction: item.category || '' }, '');
      });
    });
  }

  function threadAdapter(query) {
    var sample = window.COMMONS_THREAD_SAMPLE;
    if (!sample || !sample.post || !matches(sample, query)) return [];
    return [result(sample.post, 'discussion', '#/threads', sample.post.body, { direction: '讨论' }, sample.post.createdAt)];
  }

  function agentAdapter(query) {
    var sample = window.COMMONS_AGENTCHAT_SAMPLE;
    if (!sample) return [];
    return (sample.agents || []).filter(function (item) { return matches(item, query); }).map(function (item) {
      return result(item, 'agent', '#/agents', item.blurb, { tool: text(item.skills), direction: 'Agent' }, '');
    });
  }

  function hotAdapter(query) {
    var sample = window.COMMONS_HOT_SAMPLE;
    if (!sample) return [];
    var directions = Object.fromEntries((sample.directions || []).map(function (item) { return [item.id, item.label]; }));
    return (sample.events || []).filter(function (item) { return matches(item, query); }).map(function (item) {
      return result(item, 'hot', '#/hot', item.site || '', { direction: directions[item.direction] || item.direction || '' }, item.last_seen);
    });
  }

  function talkAdapter(query) {
    var sample = window.COMMONS_TALKS_SAMPLE;
    if (!sample) return [];
    var directions = Object.fromEntries((sample.directions || []).map(function (item) { return [item.id, item.label]; }));
    return (sample.talks || []).filter(function (item) { return matches(item, query); }).map(function (item) {
      return result(item, 'talk', '#/talk/' + encodeURIComponent(item.id), item.summary, {
        direction: directions[item.direction] || item.direction || ''
      }, '');
    });
  }

  function bountyAdapter(query) {
    var sample = window.COMMONS_BOUNTY_SAMPLE;
    if (!sample) return [];
    return (sample.bounties || []).filter(function (item) { return matches(item, query); }).map(function (item) {
      var post = item.post || item.object || {};
      var copy = Object.assign({}, item, { title: item.title || post.title || item.label || '未命名悬赏' });
      return result(copy, 'bounty', '#/bounties/' + encodeURIComponent(item.id), post.body || item.label || '', {
        direction: item.kind === 'promo' ? '推广' : '悬赏',
        status: item.status || ''
      }, item.created_at || item.deadline_at || '');
    });
  }

  function marketAdapter(query) {
    var sample = window.COMMONS_MARKET_SAMPLE;
    if (!sample) return [];
    var categories = Object.fromEntries((sample.categories || []).map(function (item) { return [item.id, item.label]; }));
    return (sample.listings || []).filter(function (item) { return matches(item, query); }).map(function (item) {
      return result(item, 'market', '#/market/' + encodeURIComponent(item.id), item.body, {
        direction: categories[item.category] || item.category || '',
        status: (sample.statusLabels || {})[item.status] || item.status || ''
      }, item.createdAt);
    });
  }

  function eventsAdapter(query) {
    var sample = window.COMMONS_EVENTS_SAMPLE;
    if (!sample) return [];
    var events = (sample.events || []).filter(function (item) { return matches(item, query); }).map(function (item) {
      return result(item, 'event', '#/event/' + encodeURIComponent(item.id), item.summary, {
        direction: item.kind || '', status: item.status || ''
      }, item.startsAt);
    });
    var campaigns = (sample.campaigns || []).filter(function (item) { return matches(item, query); }).map(function (item) {
      return result(item, 'campaign', '#/campaign/' + encodeURIComponent(item.id), item.summary, {
        direction: '打榜', status: item.status || ''
      }, item.startsAt);
    });
    return events.concat(campaigns);
  }

  function shopAdapter(query) {
    var sample = window.COMMONS_ECONOMY_SAMPLE;
    if (!sample) return [];
    return (sample.shop || []).filter(function (item) { return matches(item, query); }).map(function (item) {
      var stock = item.remaining == null ? '' : '剩余 ' + item.remaining;
      return result({ id: item.key, title: item.name }, 'shop', '#/shop', stock, {
        direction: item.category_label || item.category || '', tool: String(item.price || '') + ' 竹子'
      }, '');
    });
  }

  function memberAdapter(query) {
    var rows = [];
    var profiles = window.COMMONS_PEOPLE_SAMPLE && window.COMMONS_PEOPLE_SAMPLE.profiles;
    (profiles || []).forEach(function (item) {
      if (!matches(item, query)) return;
      rows.push(result({ id: item.handle, title: item.name }, 'member', '#/u/' + encodeURIComponent(item.handle), item.intro, {
        direction: text(item.direction), tool: text(item.tools)
      }, ''));
    });
    ((window.COMMONS_DATA || {}).people || []).forEach(function (item) {
      if (!matches(item, query)) return;
      rows.push(result({ id: item.id, title: item.name }, 'member', '#/people/' + encodeURIComponent(item.id), item.bio || item.role || '', {
        direction: item.role || '', tool: text(item.skills)
      }, ''));
    });
    return rows;
  }

  var SOURCES = [
    { module: function () { return window.CommonsKB; }, adapter: kbAdapter },
    { module: function () { return window.CommonsLibrary; }, adapter: libraryAdapter },
    { module: function () { return window.CommonsThread; }, adapter: threadAdapter },
    { module: function () { return window.CommonsAgentChat; }, adapter: agentAdapter },
    { module: function () { return window.CommonsHot; }, adapter: hotAdapter },
    { module: function () { return window.CommonsTalks; }, adapter: talkAdapter },
    { module: function () { return window.CommonsMarket; }, adapter: marketAdapter },
    { module: function () { return window.CommonsEvents; }, adapter: eventsAdapter },
    { module: function () { return window.CommonsBounty; }, adapter: bountyAdapter },
    { module: function () { return window.CommonsEconomy; }, adapter: shopAdapter },
    { module: function () { return window.CommonsPeople; }, adapter: memberAdapter }
  ];

  function demoSearch(clean) {
    var seen = new Set();
    return SOURCES.flatMap(function (source) {
      var owner = source.module();
      var rows = owner && typeof owner.search === 'function' ? owner.search(clean) : source.adapter(clean);
      return Array.isArray(rows) ? rows : [];
    }).map(function (item) { return normalize(item, item && item.kind, item && item.href); }).filter(function (item) {
      if (!item) return false;
      var key = item.kind + ':' + item.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).sort(function (a, b) {
      return KINDS[a.kind].order - KINDS[b.kind].order || a.title.localeCompare(b.title, 'zh-CN');
    });
  }

  function isLive() {
    return Boolean(window.CommonsAPI && window.CommonsAPI.mode === 'live');
  }

  function notifyLive(query) {
    if (typeof document === 'undefined' || typeof CustomEvent !== 'function') return;
    document.dispatchEvent(new CustomEvent('commons:search-update', { detail: { query: query } }));
  }

  function requestLive(query) {
    if (!query || !isLive() || liveCache.has(query) || livePending.has(query)) return;
    var request = window.CommonsAPI.get('/search-all', { q: query, limit: 50 }).then(function (response) {
      var rows = Array.isArray(response && response.data) ? response.data : [];
      var normalized = rows.map(function (item) { return normalize(item, item && item.kind, item && item.href); }).filter(Boolean);
      liveCache.set(query, normalized);
      liveErrors.delete(query);
    }).catch(function (error) {
      liveErrors.set(query, error || new Error('search_failed'));
    }).then(function () {
      livePending.delete(query);
      notifyLive(query);
    });
    livePending.set(query, request);
  }

  function search(query) {
    var clean = String(query || '').trim();
    if (!clean) return [];
    if (!isLive()) return demoSearch(clean);
    requestLive(clean);
    return liveCache.get(clean) || [];
  }

  function group(rows) {
    var buckets = new Map();
    rows.forEach(function (item) {
      if (!buckets.has(item.kind)) buckets.set(item.kind, []);
      buckets.get(item.kind).push(item);
    });
    return Array.from(buckets.entries()).map(function (entry) {
      return { kind: entry[0], label: KINDS[entry[0]].label, total: entry[1].length, items: entry[1] };
    }).sort(function (a, b) { return KINDS[a.kind].order - KINDS[b.kind].order; });
  }

  function palette(query) {
    return group(search(query)).map(function (bucket) {
      return { kind: bucket.kind, label: bucket.label, total: bucket.total, items: bucket.items.slice(0, GROUP_LIMIT) };
    });
  }

  function hashQuery() {
    var raw = window.location.hash.split('?')[1] || '';
    return new URLSearchParams(raw).get('q') || '';
  }

  function timeBucket(value) {
    if (!value) return 'unknown';
    var stamp = Date.parse(value);
    if (!Number.isFinite(stamp)) return 'unknown';
    var days = Math.max(0, (Date.now() - stamp) / 86400000);
    if (days <= 7) return 'week';
    if (days <= 30) return 'month';
    return 'older';
  }

  function filtered(rows) {
    return rows.filter(function (item) {
      var meta = item.meta || {};
      return (state.filters.kind === 'all' || item.kind === state.filters.kind)
        && (state.filters.direction === 'all' || String(meta.direction || '') === state.filters.direction)
        && (state.filters.tool === 'all' || String(meta.tool || '').toLocaleLowerCase().indexOf(state.filters.tool.toLocaleLowerCase()) !== -1)
        && (state.filters.time === 'all' || timeBucket(item.date) === state.filters.time);
    });
  }

  function unique(rows, field) {
    return Array.from(new Set(rows.map(function (item) { return String((item.meta || {})[field] || '').trim(); }).filter(Boolean))).sort(function (a, b) {
      return a.localeCompare(b, 'zh-CN');
    });
  }

  function regexEscape(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /* safe-fn: text and query are escaped before the only inserted mark tags are added. */
  function highlight(value, query) {
    var escaped = window.Commons.esc(value);
    var words = String(query || '').trim().split(/\s+/).filter(Boolean).map(function (word) { return regexEscape(window.Commons.esc(word)); });
    if (!words.length) return escaped;
    return escaped.replace(new RegExp('(' + words.join('|') + ')', 'gi'), '<mark>$1</mark>');
  }

  function facet(title, name, options) {
    return '<section class="search-facet"><h3>' + window.Commons.esc(title) + '</h3><div>' + options.map(function (option) {
      var selected = state.filters[name] === option[0];
      return '<button class="chip ' + (selected ? 'selected' : '') + '" type="button" data-search-filter="' + window.Commons.esc(name)
        + '" data-value="' + window.Commons.esc(option[0]) + '" aria-pressed="' + String(selected) + '">' + window.Commons.esc(option[1]) + '</button>';
    }).join('') + '</div></section>';
  }

  function facetsHtml(rows) {
    var kinds = group(rows).map(function (bucket) { return [bucket.kind, bucket.label + ' ' + bucket.total]; });
    var directions = unique(rows, 'direction').map(function (value) { return [value, value]; });
    var tools = unique(rows, 'tool').slice(0, 8).map(function (value) { return [value, value]; });
    return facet('类型', 'kind', [['all', '全部']].concat(kinds))
      + facet('方向', 'direction', [['all', '全部']].concat(directions))
      + facet('工具', 'tool', [['all', '全部']].concat(tools))
      + facet('时间', 'time', [['all', '不限'], ['week', '最近 7 天'], ['month', '最近 30 天'], ['older', '更早']]);
  }

  function filterLabel(name, value) {
    if (name === 'kind') return KINDS[value] ? KINDS[value].label : value;
    if (name === 'time') return TIME_LABELS[value] || value;
    return value;
  }

  function activeFilters() {
    return Object.keys(state.filters).filter(function (name) { return state.filters[name] !== 'all'; }).map(function (name) {
      return { name: name, value: state.filters[name], label: filterLabel(name, state.filters[name]) };
    });
  }

  function activeFiltersHtml() {
    var active = activeFilters();
    if (!active.length) return '';
    return '<div class="search-active-label">已选筛选</div><div class="search-active-list">' + active.map(function (item) {
      return '<button class="chip selected search-active-chip" type="button" data-search-remove="' + window.Commons.esc(item.name)
        + '" aria-label="移除筛选：' + window.Commons.esc(item.label) + '"><span>' + window.Commons.esc(item.label)
        + '</span><span aria-hidden="true">×</span></button>';
    }).join('') + (active.length > 1 ? '<button class="button ghost small" type="button" data-search-clear>清除全部</button>' : '') + '</div>';
  }

  function metaHtml(item) {
    var meta = item.meta || {};
    return [meta.direction, meta.tool, item.date].filter(Boolean).map(function (value) {
      return '<span>' + window.Commons.esc(value) + '</span>';
    }).join('');
  }

  /* safe-fn: item strings use highlight/esc and href is sanitized by Commons.safeUrl. */
  function resultHtml(item) {
    return '<a class="search-result" href="' + window.Commons.safeUrl(item.href) + '"><div><span class="search-kind">'
      + window.Commons.esc(KINDS[item.kind].label) + '</span>' + metaHtml(item) + '</div><h3>' + highlight(item.title, state.query)
      + '</h3><p>' + highlight(item.snippet, state.query) + '</p></a>';
  }

  /* safe-fn: bucket label is from KINDS; child rows are rendered by resultHtml. */
  function groupHtml(bucket) {
    var expanded = Boolean(state.expanded[bucket.kind]);
    var visible = expanded ? bucket.items : bucket.items.slice(0, GROUP_LIMIT);
    return '<section class="search-group" data-search-kind="' + window.Commons.esc(bucket.kind) + '"><header><div><h2>'
      + window.Commons.esc(bucket.label) + '</h2><span>' + window.Commons.esc(bucket.total) + ' 条</span></div>'
      + (bucket.total > GROUP_LIMIT ? '<button class="button ghost small" type="button" data-search-more="' + window.Commons.esc(bucket.kind) + '">'
        + (expanded ? '收起' : '看全部') + '</button>' : '') + '</header><div>' + visible.map(resultHtml).join('') + '</div></section>';
  }

  /* safe-fn: examples and kind metadata are local constants; all strings still pass through esc. */
  function discoveryHtml() {
    var recent = RECENT_EXAMPLES.map(function (query) {
      return '<a class="chip search-recent-link" href="#/search?q=' + encodeURIComponent(query) + '">' + window.Commons.esc(query) + '</a>';
    }).join('');
    var entries = Object.keys(KINDS).map(function (kind) {
      var spec = KINDS[kind];
      return '<a class="search-entry" href="' + window.Commons.safeUrl(spec.route) + '"><span>' + window.Commons.esc(spec.label)
        + '</span><p>' + window.Commons.esc(spec.blurb) + '</p><strong aria-hidden="true">→</strong></a>';
    }).join('');
    return '<div class="search-discovery"><section class="search-recent"><header><h2>' + (isLive() ? '试试这些搜法' : '大家最近在搜') + '</h2>' + (isLive() ? '' : '<span class="search-sample">示例</span>') + '</header><div>'
      + recent + '</div></section><section class="search-entries"><header><h2>按类型进入</h2><p>不确定关键词时，先从内容类型开始。</p></header><div>'
      + entries + '</div></section></div>';
  }

  function emptyHtml(hasQuery) {
    if (!hasQuery) return discoveryHtml();
    if (isLive() && livePending.has(state.query)) return '<div class="search-empty"><strong>正在搜索</strong></div>';
    if (isLive() && liveErrors.has(state.query)) return '<div class="search-empty"><strong>搜索暂时不可用</strong><div><button class="button tonal" type="button" data-search-retry>重试</button></div></div>';
    return '<div class="search-empty"><strong>没有找到匹配内容</strong><p>可以换个说法，或者从下面两个入口继续。</p><div><a class="button tonal" href="#/solved">去问题库提问</a><a class="button" href="#/bounties">挂悬赏</a></div></div>';
  }

  function resultsHtml(rows) {
    var buckets = group(filtered(rows));
    return buckets.length ? buckets.map(groupHtml).join('') : emptyHtml(Boolean(state.query));
  }

  function view() {
    state.query = hashQuery().trim();
    state.filters = { kind: 'all', direction: 'all', tool: 'all', time: 'all' };
    state.expanded = {};
    state.drawerOpen = false;
    var rows = search(state.query);
    return '<main class="search-page" data-search-page data-search-has-query="' + String(Boolean(state.query)) + '"><header class="search-hero"><span class="search-eyebrow">全站搜索</span><h1>一个框，找到所有东西</h1>'
      + '<form class="search-form" data-search-form><label class="field"><span class="search-sr">搜索词</span><input class="search-input" name="q" type="search" autocomplete="off" value="'
      + window.Commons.esc(state.query) + '" placeholder="搜问题、Skill、提示词、Agent…"></label><button class="button primary large" type="submit">搜索</button></form>'
      + '<p>' + (isLive() ? '' : '示例数据 · ') + '检索词只留在当前页面，不写入本机记录。</p></header><div class="search-layout">'
      + '<div class="search-mobile-tools"><button class="button tonal search-filter-button" type="button" data-search-drawer-toggle aria-expanded="false"><span>筛选</span><span class="search-filter-count" data-search-filter-count hidden></span></button></div>'
      + '<button class="search-drawer-scrim" type="button" data-search-drawer-close aria-label="关闭筛选" tabindex="-1"></button>'
      + '<aside class="search-filter-drawer" data-search-drawer aria-label="筛选条件" aria-hidden="false"><div class="search-drawer-head"><strong>筛选</strong><button class="button ghost small" type="button" data-search-drawer-close>关闭</button></div><div data-search-facets>'
      + facetsHtml(rows) + '</div></aside><div class="search-result-pane"><div class="search-active" data-search-active>'
      + activeFiltersHtml() + '</div><div class="search-results" data-search-results aria-live="polite">' + resultsHtml(rows) + '</div></div></div></main>';
  }

  function paint() {
    if (!state.root) return;
    var rows = search(state.query);
    var facets = state.root.querySelector('[data-search-facets]');
    var results = state.root.querySelector('[data-search-results]');
    var active = state.root.querySelector('[data-search-active]');
    var count = activeFilters().length;
    if (facets) facets.innerHTML = facetsHtml(rows);
    if (results) results.innerHTML = resultsHtml(rows);
    if (active) active.innerHTML = activeFiltersHtml();
    state.root.dataset.searchHasQuery = String(Boolean(state.query));
    var countNode = state.root.querySelector('[data-search-filter-count]');
    if (countNode) {
      countNode.textContent = String(count);
      countNode.hidden = count === 0;
    }
  }

  function setDrawer(open, restoreFocus) {
    if (!state.root) return;
    state.drawerOpen = Boolean(open);
    var drawer = state.root.querySelector('[data-search-drawer]');
    var toggle = state.root.querySelector('[data-search-drawer-toggle]');
    var isNarrow = window.matchMedia ? window.matchMedia('(max-width: 760px)').matches : false;
    if (drawer) {
      drawer.dataset.open = String(state.drawerOpen);
      drawer.setAttribute('aria-hidden', String(isNarrow && !state.drawerOpen));
    }
    if (toggle) toggle.setAttribute('aria-expanded', String(state.drawerOpen));
    document.body.classList.toggle('search-drawer-open', state.drawerOpen);
    if (state.drawerOpen) {
      state.drawerOpener = document.activeElement;
      var first = drawer && drawer.querySelector('button');
      if (first) first.focus();
    } else if (restoreFocus && state.drawerOpener && state.drawerOpener.isConnected) {
      state.drawerOpener.focus();
    }
  }

  function onSubmit(event) {
    if (!event.target.matches('[data-search-form]')) return;
    event.preventDefault();
    var query = String(new FormData(event.target).get('q') || '').trim();
    var next = '#/search?q=' + encodeURIComponent(query);
    if (window.location.hash === next) {
      state.query = query;
      state.filters = { kind: 'all', direction: 'all', tool: 'all', time: 'all' };
      state.expanded = {};
      setDrawer(false, false);
      paint();
    } else {
      window.location.hash = next;
    }
  }

  function onClick(event) {
    var toggle = event.target.closest('[data-search-drawer-toggle]');
    if (toggle && state.root && state.root.contains(toggle)) {
      setDrawer(!state.drawerOpen, false);
      return;
    }
    var closeDrawer = event.target.closest('[data-search-drawer-close]');
    if (closeDrawer && state.root && state.root.contains(closeDrawer)) {
      setDrawer(false, true);
      return;
    }
    var filter = event.target.closest('[data-search-filter]');
    if (filter && state.root && state.root.contains(filter)) {
      state.filters[filter.dataset.searchFilter] = filter.dataset.value;
      paint();
      return;
    }
    var remove = event.target.closest('[data-search-remove]');
    if (remove && state.root && state.root.contains(remove)) {
      state.filters[remove.dataset.searchRemove] = 'all';
      paint();
      return;
    }
    var clear = event.target.closest('[data-search-clear]');
    if (clear && state.root && state.root.contains(clear)) {
      state.filters = { kind: 'all', direction: 'all', tool: 'all', time: 'all' };
      paint();
      return;
    }
    var more = event.target.closest('[data-search-more]');
    if (more && state.root && state.root.contains(more)) {
      state.expanded[more.dataset.searchMore] = !state.expanded[more.dataset.searchMore];
      paint();
      return;
    }
    var retry = event.target.closest('[data-search-retry]');
    if (retry && state.root && state.root.contains(retry)) {
      liveErrors.delete(state.query);
      requestLive(state.query);
      paint();
    }
  }

  function onKeydown(event) {
    if (event.key === 'Escape' && state.drawerOpen) {
      event.preventDefault();
      setDrawer(false, true);
    }
  }

  function on(target, type, handler) {
    target.addEventListener(type, handler);
    state.unbind.push(function () { target.removeEventListener(type, handler); });
  }

  function mount() {
    var root = document.querySelector('[data-search-page]');
    if (!root) return;
    destroy();
    state.root = root;
    on(root, 'submit', onSubmit);
    on(root, 'click', onClick);
    on(root, 'keydown', onKeydown);
    on(document, 'commons:search-update', function (event) {
      if (event.detail && event.detail.query === state.query) paint();
    });
    paint();
  }

  function destroy() {
    state.unbind.forEach(function (unbind) { unbind(); });
    state.unbind = [];
    document.body.classList.remove('search-drawer-open');
    state.drawerOpen = false;
    state.drawerOpener = null;
    state.root = null;
  }

  var api = {
    nav: [],
    mount: mount,
    destroy: destroy,
    search: search,
    palette: palette,
    synonyms: SYNONYMS
  };
  Object.defineProperty(api, 'routes', {
    enumerable: true,
    get: function () {
      var routes = { search: view };
      var current = window.location.hash.replace(/^#\/?/, '').split('/')[0];
      if (current.indexOf('search?') === 0) routes[current] = view;
      return routes;
    }
  });

  window.CommonsSearch = api;
  (window.CommonsPages = window.CommonsPages || []).push(api);
})();

