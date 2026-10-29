/* R13 TOOLS-1 · AI 工具榜、工具详情、工具对比与个人工具栈。 */
(function () {
  'use strict';

  var CATEGORIES = ['全部','编程 Agent','对话模型','本地模型','自动化','知识管理','设计'];
  var CATEGORY_KEY = { '编程 Agent': 'coding', '对话模型': 'chat', '本地模型': 'local', '自动化': 'automation', '知识管理': 'knowledge', '设计': 'design' };
  var CATEGORY_ASSET = {
    coding: 'coding-agent.webp', chat: 'chat-model.webp', local: 'local-model.webp',
    automation: 'automation.webp', knowledge: 'knowledge.webp', design: 'design.webp'
  };
  var state = { root: null, category: '全部', sort: 'usage', compare: [], live: null, loading: false, error: '', unbind: [], request: 0, submitOpen: false, submitBusy: false, notice: '', account: '', subs: null };
  var PRICE_TIERS = ['免费', '订阅', '按量'];

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
    });
  }

  function safeUrl(value) {
    return window.Commons && window.Commons.safeUrl ? window.Commons.safeUrl(value) : '#';
  }

  /* safe-fn: CommonsLinks.person/a 自行转义；降级分支只使用本函数转义后的字段。 */
  function personLink(handle, name, level) {
    if (window.CommonsLinks && typeof window.CommonsLinks.person === 'function') {
      return window.CommonsLinks.person(handle, name, { level: level });
    }
    return handle ? '<a class="lk-person" href="#/u/' + encodeURIComponent(handle) + '">' + esc(name) + '</a>' : esc(name);
  }

  function toolHref(slug) {
    if (window.CommonsLinks && typeof window.CommonsLinks.href === 'function') {
      var shared = window.CommonsLinks.href('tool', slug);
      if (shared) return shared;
    }
    return '#/tool/' + encodeURIComponent(slug || '');
  }

  function icon(name) {
    return window.Commons && window.Commons.icon ? window.Commons.icon(name) : '';
  }

  function toast(message) {
    if (window.Commons && window.Commons.toast) window.Commons.toast(message);
  }

  function isLive() {
    return !!(window.CommonsAPI && window.CommonsAPI.mode === 'live');
  }

  function read(key, fallback) {
    return window.Commons && window.Commons.read ? window.Commons.read('tools.' + key, fallback) : fallback;
  }

  function write(key, value) {
    return !!(window.Commons && window.Commons.write && window.Commons.write('tools.' + key, value));
  }

  function samples() {
    return Array.isArray(window.COMMONS_TOOLS_SAMPLE) ? window.COMMONS_TOOLS_SAMPLE : [];
  }

  function routeInfo() {
    var raw = location.hash.replace(/^#\/?/, '');
    var halves = raw.split('?');
    var parts = halves[0].split('/').filter(Boolean);
    return { parts: parts, query: new URLSearchParams(halves[1] || '') };
  }

  function defaultUses() {
    return { codex: { started_at: '2026-10-20T09:00:00.000Z', purpose: '跨文件改代码并跑验证', show_on_profile: true } };
  }

  function localUses() {
    var value = read('uses', null);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : defaultUses();
  }

  function localReviews() {
    var value = read('reviews', {});
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }

  function overlay(row) {
    var item = JSON.parse(JSON.stringify(row));
    var use = localUses()[item.slug] || null;
    item.mine = use;
    var mine = localReviews()[item.slug];
    if (mine) {
      item.reviews = item.reviews.filter(function (review) { return review.id !== 'mine-' + item.slug; });
      item.reviews.unshift({ id: 'mine-' + item.slug, author: { handle: 'local-self', display_name: '我（本机示例）' }, rating: mine.rating, body: mine.body, helpful_count: 0 });
      item.top_review = item.reviews[0];
    }
    var helpful = read('helpful', {});
    item.reviews.forEach(function (review) {
      if (helpful[review.id]) review.helpful_count = Number(review.helpful_count || 0) + 1;
    });
    return item;
  }

  function allData() {
    if (isLive()) return Array.isArray(state.live) ? state.live : [];
    return samples().map(overlay);
  }

  function ratingText(item) {
    return item.rating && item.rating.median != null ? item.rating.median.toFixed(1) + ' · ' + item.rating.count + ' 人' : '评价不足';
  }

  function currentRows() {
    var rows = allData().filter(function (item) { return state.category === '全部' || item.category === state.category; });
    if (!isLive()) {
      rows.sort(function (a, b) {
        if (state.sort === 'month') return b.month_new_count - a.month_new_count || b.use_count - a.use_count;
        if (state.sort === 'rating') {
          var ar = a.rating.median == null ? -1 : a.rating.median;
          var br = b.rating.median == null ? -1 : b.rating.median;
          return br - ar || b.rating.count - a.rating.count;
        }
        return b.use_count - a.use_count || b.month_new_count - a.month_new_count;
      });
      if (state.sort === 'rating') rows = rows.filter(function (item) { return item.rating.median != null; });
    }
    return rows;
  }

  function sampleBadge() {
    return isLive() ? '' : '<span class="pill outline">示例</span>';
  }

  function resourceTabs() {
    return window.CommonsLibrary && window.CommonsLibrary.typeTabs ? window.CommonsLibrary.typeTabs('tools') : '';
  }

  /* safe-slot: action — 只接收 rankingPage 内写死的比较工具链接 */
  function rankingToolbar(action) {
    return /* safe: CommonsLibrary.typeTabs 逐值转义类型与数量 */ resourceTabs() + '<div class="tools-ranking-toolbar"><p>看成员在用的 AI 工具。</p><div>' + sampleBadge() + (action || '') + '</div></div>';
  }

  /* safe-slot: action — 只接收本模块用写死按钮和 safeUrl 链接拼出的操作区 HTML */
  function header(title, description, action) {
    return '<header class="tools-head"><div><div class="tools-title"><h1>' + esc(title) + '</h1>' + sampleBadge() + '</div><p>' + esc(description) + '</p></div>' + (action || '') + '</header>';
  }

  function filters() {
    return '<div class="tools-controls"><div class="tools-categories" aria-label="工具类别">' + CATEGORIES.map(function (category) {
      return '<button type="button" class="chip" data-tools-act="category" data-value="' + esc(category) + '" aria-pressed="' + (state.category === category) + '">' + esc(category) + '</button>';
    }).join('') + '</div><div class="segmented" aria-label="榜单排序">' + [
      ['usage','在用人数'],['month','本月新增'],['rating','评分']
    ].map(function (option) {
      return '<button type="button" data-tools-act="sort" data-value="' + option[0] + '" aria-pressed="' + (state.sort === option[0]) + '" class="' + (state.sort === option[0] ? 'active' : '') + '">' + option[1] + '</button>';
    }).join('') + '</div></div>';
  }

  function toolLogo(item) {
    if (window.CommonsLogo && typeof window.CommonsLogo.html === 'function') {
      // API 的 id 是 tool-01 一类内部编号；slug 才是品牌 logo 的键。
      return window.CommonsLogo.html(item.slug, item.name, { size: 'lg' });
    }
    var category = CATEGORY_KEY[item.category] || 'coding';
    return '<img class="tools-initial" data-cat="' + esc(category) + '" src="assets/tools/' + esc(CATEGORY_ASSET[category]) + '" alt="">';
  }

  function compareToggle(item) {
    var on = state.compare.indexOf(item.slug) !== -1;
    return '<button type="button" class="button small ' + (on ? 'tonal' : 'ghost') + '" data-tools-act="compare-toggle" data-id="' + esc(item.slug) + '" aria-pressed="' + on + '">' + (on ? '已选' : '对比') + '</button>';
  }

  function toolRow(item, index) {
    var review = item.top_review;
    return '<li class="tools-row"><span class="tools-rank">' + esc(index + 1) + '</span><a class="tools-main" href="' + safeUrl(toolHref(item.slug)) + '">' + /* safe: toolLogo 委托 CommonsLogo 转义，降级分支也转义 */ toolLogo(item) + '<span><strong>' + esc(item.name) + '</strong><small>' + esc(item.vendor) + ' · ' + esc(item.category) + '</small><em>' + esc(item.summary) + '</em></span></a>' +
      '<span class="tools-count"><b>' + esc(item.use_count) + '</b><small>人在用</small></span><span class="tools-count"><b>' + esc(item.month_new_count) + '</b><small>本月新增</small></span><span class="tools-rating"><b>' + esc(ratingText(item)) + '</b><small>' + esc(review ? review.body : '还没有短评') + '</small></span>' + compareToggle(item) + '</li>';
  }

  function compareBar() {
    if (!state.compare.length) return '';
    var href = '#/tools/compare?' + state.compare.map(function (slug, index) { return String.fromCharCode(97 + index) + '=' + encodeURIComponent(slug); }).join('&');
    return '<div class="tools-compare-bar"><span>已选 ' + esc(state.compare.length) + ' 个</span><button type="button" class="button ghost small" data-tools-act="compare-clear">清空</button><a class="button primary small" href="' + safeUrl(href) + '" aria-disabled="' + (state.compare.length < 2) + '">开始对比</a></div>';
  }

  function statePanel(kind) {
    if (kind === 'loading') return '<div class="tools-state" aria-live="polite"><span class="tools-state-mark">…</span><b>正在读取工具榜</b></div>';
    if (kind === 'error') {
      if (state.error === 'closed') return '<div class="tools-state" role="status"><span class="tools-state-mark">·</span><b>这个功能还没开放</b><p>管理员还没打开。</p></div>';
      return '<div class="tools-state" role="alert"><span class="tools-state-mark">!</span><b>工具榜没有载入</b><button type="button" class="button" data-tools-act="retry">重试</button></div>';
    }
    return '<div class="tools-state"><span class="tools-state-mark">0</span><b>这个分类还没有工具</b><button type="button" class="button" data-tools-act="category" data-value="全部">看全部</button></div>';
  }

  /* safe-fn: 选项来自写死常量，提示文案逐值转义 */
  function submitPanel() {
    var notice = state.notice ? '<div class="tools-review-gate" role="status">' + esc(state.notice) + '</div>' : '';
    if (!state.submitOpen) return notice;
    return notice + '<form class="tools-submit-form" data-tools-form="submit"><div class="tools-section-head"><h2>提交一个工具</h2><span>审核通过后上榜</span></div>' +
      '<label class="field"><span>名称</span><input name="name" required maxlength="100"></label>' +
      '<label class="field"><span>地址标识（小写字母、数字、连字符）</span><input name="slug" required maxlength="80" pattern="[a-z0-9]+(-[a-z0-9]+)*"></label>' +
      '<label class="field"><span>厂商</span><input name="vendor" required maxlength="100"></label>' +
      '<label class="field"><span>类别</span><select name="category">' + CATEGORIES.slice(1).map(function (category) { return '<option value="' + esc(category) + '">' + esc(category) + '</option>'; }).join('') + '</select></label>' +
      '<label class="field"><span>价格档</span><select name="price_tier">' + PRICE_TIERS.map(function (tier) { return '<option value="' + esc(tier) + '">' + esc(tier) + '</option>'; }).join('') + '</select></label>' +
      '<label class="field"><span>官网</span><input name="official_url" type="url" required maxlength="500" placeholder="https://"></label>' +
      '<label class="field"><span>标签（逗号分隔，最多 12 个）</span><input name="tags"></label>' +
      '<label class="field"><span>一句话介绍</span><textarea name="summary" maxlength="280" rows="2"></textarea></label>' +
      '<p data-tools-submit-status role="status"></p><div class="tools-submit-actions"><button type="button" class="button" data-tools-act="submit-toggle">取消</button><button type="submit" class="button primary">提交审核</button></div></form>';
  }

  function rankingPage() {
    if (state.loading) return '<div class="tools-page">' + rankingToolbar('') + statePanel('loading') + '</div>';
    if (state.error) return '<div class="tools-page">' + rankingToolbar('') + statePanel('error') + '</div>';
    var rows = currentRows();
    var action = '<a class="button primary" href="#/tools/compare?a=codex&b=cursor">比较工具</a>';
    if (isLive()) action = '<a class="button ghost" href="#/tools/my-submissions">我提交的</a><button type="button" class="button" data-tools-act="submit-toggle" aria-expanded="' + esc(String(state.submitOpen)) + '">提交工具</button>';
    return '<div class="tools-page">' + rankingToolbar(action) + (isLive() ? submitPanel() : '') + filters() + compareBar() +
      (rows.length ? '<div class="tools-list-head"><span>排名与工具</span><span>在用</span><span>新增</span><span>成员评价</span><span></span></div><ol class="tools-list">' + rows.map(toolRow).join('') + '</ol>' : statePanel('empty')) + '</div>';
  }

  function findTool(slug) {
    return allData().filter(function (item) { return item.slug === slug; })[0] || null;
  }

  function lineChart(item) {
    var rows = Array.isArray(item.trend) ? item.trend : [];
    if (!rows.length) return '<div class="tools-chart-empty">还没有趋势数据</div>';
    var max = Math.max.apply(null, rows.map(function (row) { return Number(row.total) || 0; })) || 1;
    var points = rows.map(function (row, index) {
      var x = rows.length === 1 ? 50 : index * 100 / (rows.length - 1);
      var y = 92 - (Number(row.total) || 0) / max * 76;
      return x.toFixed(2) + ',' + y.toFixed(2);
    }).join(' ');
    return '<div class="tools-chart"><svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="近十二周在用人数趋势"><path d="M0 92H100"></path><polyline points="' + esc(points) + '"></polyline></svg><div><span>' + esc(rows[0].week) + '</span><b>' + esc(rows[rows.length - 1].total) + ' 人</b><span>' + esc(rows[rows.length - 1].week) + '</span></div></div>';
  }

  function daysUsing(item) {
    if (!item.mine || !item.mine.started_at) return 0;
    var start = new Date(item.mine.started_at).getTime();
    return Number.isFinite(start) ? Math.max(0, Math.floor((Date.now() - start) / 86400000)) : 0;
  }

  function usePanel(item) {
    var using = !!item.mine;
    return '<section class="tools-use-panel"><div><h2>' + (using ? '正在使用' : '我在用吗？') + '</h2><p>' + (using ? '已连续记录 ' + esc(daysUsing(item)) + ' 天' : '标记后满三天可评分') + '</p></div><label class="field"><span>主要用来做什么</span><input data-tools-purpose value="' + esc(using ? item.mine.purpose || '' : '') + '" maxlength="160" placeholder="可不填"></label><button type="button" class="button ' + (using ? 'tonal' : 'primary') + '" data-tools-act="use-toggle" data-id="' + esc(item.slug) + '" aria-pressed="' + using + '">' + (using ? '取消在用' : '我在用') + '</button></section>';
  }

  function reviewForm(item) {
    if (!item.mine) return '<div class="tools-review-gate">先标记“我在用”，满三天后可评分。</div>';
    var days = daysUsing(item);
    if (days < 3) return '<div class="tools-review-gate">再用 ' + esc(3 - days) + ' 天可评分。</div>';
    var mine = localReviews()[item.slug] || {};
    return '<form class="tools-review-form" data-tools-form="review" data-id="' + esc(item.slug) + '"><label class="field"><span>评分</span><select name="rating">' + [5,4,3,2,1].map(function (value) { return '<option value="' + value + '"' + (Number(mine.rating || 5) === value ? ' selected' : '') + '>' + value + ' 分</option>'; }).join('') + '</select></label><label class="field tools-review-copy"><span>短评</span><textarea name="body" maxlength="280" required placeholder="一句真实使用感受">' + esc(mine.body || '') + '</textarea></label><button class="button primary" type="submit">' + (mine.body ? '更新短评' : '发布短评') + '</button></form>';
  }

  function reviews(item) {
    var rows = Array.isArray(item.reviews) ? item.reviews : [];
    return '<section class="tools-section"><div class="tools-section-head"><h2>成员短评</h2><span>' + esc(item.rating.count) + ' 人评价</span></div>' + reviewForm(item) + (rows.length ? '<ol class="tools-reviews">' + rows.map(function (review) {
      return '<li><div><span class="tools-score">' + esc(review.rating) + '</span><strong>' + /* safe: personLink returns escaped or CommonsLinks-owned HTML */ personLink(review.author.handle, review.author.display_name, review.author.level) + '</strong><small>' + esc(review.body) + '</small></div><button type="button" class="button ghost small" data-tools-act="helpful" data-id="' + esc(review.id) + '">有用 ' + esc(review.helpful_count || 0) + '</button></li>';
    }).join('') + '</ol>' : '<div class="tools-review-gate">还没有短评。</div>') + '</section>';
  }

  function people(item) {
    var users = (item.public_users || []).filter(function (person) { return person.profilePublic !== false; });
    return '<section class="tools-section"><div class="tools-section-head"><h2>谁在用</h2><span>公开主页</span></div>' + (users.length ? '<div class="tools-people">' + users.map(function (person) {
      var shown = person.display_name || person.name || person.handle || '成员';
      return '<a href="#/tools/' + encodeURIComponent(person.handle) + '"><span>' + esc(shown.charAt(0)) + '</span><b>' + esc(shown) + '</b><small>打开工具栈</small></a>';
    }).join('') + '</div>' : '<p class="tools-muted">暂时没有公开展示的成员。</p>') + '</section>';
  }

  function related(item) {
    var groups = item.related || { skills: [], prompts: [], questions: [] };
    var rows = [['Skill',groups.skills],['提示词',groups.prompts],['问题库',groups.questions]];
    return '<section class="tools-section"><div class="tools-section-head"><h2>相关资源</h2><span>按标签匹配</span></div><div class="tools-related">' + rows.map(function (group) {
      var entry = group[1] && group[1][0];
      return entry ? '<a href="' + safeUrl(entry.href) + '"><span>' + esc(group[0]) + '</span><b>' + esc(entry.title) + '</b>' + icon('arrow') + '</a>' : '';
    }).join('') + '</div></section>';
  }

  function detailPage(slug) {
    if (state.loading) return '<div class="tools-page">' + statePanel('loading') + '</div>';
    if (state.error) return '<div class="tools-page">' + statePanel('error') + '</div>';
    var item = findTool(slug);
    if (!item) return '<div class="tools-page">' + statePanel('empty') + '</div>';
    return '<div class="tools-page tools-detail-page"><a class="back" href="#/tools">' + icon('back') + ' 回到工具榜</a><header class="tools-detail-head">' + /* safe: toolLogo 委托 CommonsLogo 转义，降级分支也转义 */ toolLogo(item) + '<div><div class="tools-meta">' + sampleBadge() + '<span>' + esc(item.category) + '</span><span>' + esc(item.price_tier) + '</span></div><h1>' + esc(item.name) + '</h1><p>' + esc(item.summary) + '</p><div class="tools-tags">' + item.tags.map(function (tag) { return '<span class="pill agent">' + esc(tag) + '</span>'; }).join('') + '</div></div><a class="button" href="' + safeUrl(item.official_url) + '" target="_blank" rel="noreferrer">官网 ' + icon('external') + '</a></header>' +
      '<div class="tools-stats"><div><b>' + esc(item.use_count) + '</b><span>人在用</span></div><div><b>' + esc(item.month_new_count) + '</b><span>本月新增</span></div><div><b>' + esc(ratingText(item)) + '</b><span>中位数评分</span></div></div>' + usePanel(item) +
      '<div class="tools-detail-grid"><main><section class="tools-section"><div class="tools-section-head"><h2>近 12 周趋势</h2><span>在用人数</span></div>' + lineChart(item) + '</section>' + reviews(item) + '</main><aside>' + people(item) + related(item) + '<a class="tools-compare-entry" href="#/tools/compare?a=' + esc(item.slug) + '&b=codex"><span>并排看差异</span><b>加入工具对比</b>' + icon('arrow') + '</a></aside></div></div>';
  }

  function queryCompare() {
    var query = routeInfo().query;
    return ['a','b','c'].map(function (key) { return query.get(key); }).filter(Boolean).filter(function (slug, index, list) { return list.indexOf(slug) === index; }).slice(0, 3);
  }

  function comparePage() {
    if (state.loading) return '<div class="tools-page">' + statePanel('loading') + '</div>';
    if (state.error) return '<div class="tools-page">' + statePanel('error') + '</div>';
    var slugs = queryCompare();
    var rows = slugs.map(findTool).filter(Boolean);
    if (rows.length < 2) return '<div class="tools-page">' + header('工具对比','选择两到三个工具并排查看。','<a class="button" href="#/tools">返回榜单</a>') + '<div class="tools-review-gate">至少选择两个工具。</div></div>';
    var facts = [
      ['类别',function (item) { return item.category; }],['价格档',function (item) { return item.price_tier; }],['在用人数',function (item) { return item.use_count + ' 人'; }],['评分',ratingText],['成员短评',function (item) { return item.top_review ? item.top_review.body : '暂无短评'; }]
    ];
    return '<div class="tools-page">' + header('工具对比','选择两到三个工具并排查看。','<a class="button" href="#/tools">返回榜单</a>') + '<div class="tools-compare-table" style="--tools-cols:' + esc(rows.length) + '"><div></div>' + rows.map(function (item) { return '<a class="tools-compare-name" href="' + safeUrl(toolHref(item.slug)) + '">' + /* safe: toolLogo 委托 CommonsLogo 转义，降级分支也转义 */ toolLogo(item) + '<b>' + esc(item.name) + '</b></a>'; }).join('') + facts.map(function (fact) {
      return '<strong>' + esc(fact[0]) + '</strong>' + rows.map(function (item) { return '<span>' + esc(fact[1](item)) + '</span>'; }).join('');
    }).join('') + '</div></div>';
  }

  var SUB_STATUS = { pending_review: ['审核中', 'pill outline'], active: ['已上榜', 'pill agent'], hidden: ['已下架', 'pill outline'] };

  /* safe-fn: 投稿字段逐值转义，上榜工具的链接走 toolHref + safeUrl */
  function submissionRow(item) {
    var status = SUB_STATUS[item.status] || [item.status, 'pill outline'];
    var title = item.status === 'active' ? '<a href="' + safeUrl(toolHref(item.slug)) + '"><strong>' + esc(item.name) + '</strong></a>' : '<strong>' + esc(item.name) + '</strong>';
    var meta = esc(item.category) + ' · ' + esc(item.vendor) + ' · 提交于 ' + esc(String(item.created_at || '').slice(0, 10)) +
      (item.status === 'active' ? ' · ' + esc(item.use_count || 0) + ' 人在用' : '');
    return '<li><div><span class="tools-score">' + esc(String(item.name || '?').charAt(0)) + '</span>' + title + '<small>' + meta + '</small></div><span class="' + esc(status[1]) + '">' + esc(status[0]) + '</span></li>';
  }

  /* safe-fn: 状态文案写死，投稿行来自 submissionRow */
  function submissionsPage() {
    var back = '<a class="back" href="#/tools">' + icon('back') + ' 回到工具榜</a>';
    var head = header('我提交的工具', '看每个投稿的审核状态。', '<a class="button" href="#/tools">去提交新工具</a>');
    var subs = state.subs;
    if (!subs || subs.loading) return '<div class="tools-page">' + back + head + '<div class="tools-state" aria-live="polite"><span class="tools-state-mark">…</span><b>正在读取你的投稿</b></div></div>';
    if (subs.error) {
      var closed = subs.error === 'closed';
      return '<div class="tools-page">' + back + head + '<div class="tools-state" role="' + (closed ? 'status' : 'alert') + '"><span class="tools-state-mark">' + (closed ? '·' : '!') + '</span><b>' +
        (closed ? '这个功能还没开放' : '投稿记录没有载入') + '</b>' + (closed ? '<p>管理员还没打开。</p>' : '<button type="button" class="button" data-tools-act="retry">重试</button>') + '</div></div>';
    }
    if (!subs.items.length) return '<div class="tools-page">' + back + head + '<div class="tools-state"><span class="tools-state-mark">0</span><b>你还没有提交过工具</b><a class="button" href="#/tools">去工具榜提交</a></div></div>';
    return '<div class="tools-page">' + back + head + '<section class="tools-section"><div class="tools-section-head"><h2>投稿</h2><span>' + esc(subs.items.length) + ' 个</span></div><ul class="tools-reviews">' +
      subs.items.map(submissionRow).join('') + '</ul></section></div>';
  }

  function onSubmissions() {
    var info = routeInfo();
    return info.parts[0] === 'tools' && info.parts[1] === 'my-submissions';
  }

  function loadSubs() {
    if (!isLive()) return;
    var subs = state.subs = { items: [], loading: true, error: '' };
    request('GET', '/tools/mine/submissions').then(function (response) {
      if (state.subs !== subs) return;
      subs.items = Array.isArray(response.data) ? response.data : (response.data && response.data.items) || [];
      subs.loading = false;
      paint();
    }, function (error) {
      if (state.subs !== subs) return;
      subs.loading = false;
      subs.error = (error && (error.status === 501 || error.code === 'capability_unavailable')) ? 'closed' : 'load_failed';
      paint();
    });
  }

  function page() {
    var info = routeInfo();
    if (isLive() && info.parts[1] === 'my-submissions') return submissionsPage();
    return info.parts[1] === 'compare' ? comparePage() : info.parts[1] ? stackPage(info.parts[1]) : rankingPage();
  }

  function tool() {
    return detailPage(routeInfo().parts[1] || '');
  }

  function request(method, path, body) {
    var api = window.CommonsAPI;
    if (!api) return Promise.reject(new Error('没有接上接口。'));
    if (method === 'GET') return api.get(path, body);
    var opts = { idempotencyKey: api.newIdempotencyKey() };
    if (method === 'POST') return api.post(path, body || {}, opts);
    return api.del(path, undefined, opts);
  }

  function writeError(error, fallback) {
    if (error && (error.status === 501 || error.code === 'capability_unavailable')) return '这个功能还没开放。';
    return (error && error.message) || fallback || '操作没有完成。';
  }

  function livePath() {
    var info = routeInfo();
    if (info.parts[0] === 'tool') return '/tools/' + encodeURIComponent(info.parts[1] || '');
    if (info.parts[1] === 'compare') return '/tools/compare';
    return '/tools';
  }

  function liveQuery() {
    var info = routeInfo();
    if (info.parts[1] === 'compare') return { a: info.query.get('a'), b: info.query.get('b'), c: info.query.get('c') };
    if (info.parts[0] === 'tools') return { category: state.category === '全部' ? '' : state.category, sort: state.sort };
    return null;
  }

  function loadLive() {
    if (!isLive() || state.loading) return;
    var token = ++state.request;
    state.loading = true;
    state.error = '';
    request('GET', livePath(), liveQuery()).then(function (response) {
      if (token !== state.request) return;
      state.live = Array.isArray(response.data) ? response.data : [response.data];
      state.loading = false;
      paint();
    }, function (error) {
      if (token !== state.request) return;
      state.loading = false;
      state.error = (error && (error.status === 501 || error.code === 'capability_unavailable')) ? 'closed' : 'load_failed';
      paint();
    });
  }

  function paint() {
    if (!state.root) return;
    state.root.innerHTML = routeInfo().parts[0] === 'tool' ? tool() : page();
    if (window.CommonsHubs && typeof window.CommonsHubs.syncScroll === 'function') window.CommonsHubs.syncScroll();
  }

  function onClick(event) {
    var button = event.target.closest('[data-tools-act]');
    if (!button) return;
    var action = button.dataset.toolsAct;
    var id = button.dataset.id || '';
    if (action === 'category') {
      state.category = button.dataset.value || '全部';
      if (isLive()) loadLive(); else paint();
    } else if (action === 'sort') {
      state.sort = button.dataset.value || 'usage';
      if (isLive()) loadLive(); else paint();
    } else if (action === 'compare-toggle') {
      var index = state.compare.indexOf(id);
      if (index >= 0) state.compare.splice(index, 1);
      else if (state.compare.length < 3) state.compare.push(id);
      else toast('一次最多比较三个工具。');
      paint();
    } else if (action === 'compare-clear') {
      state.compare = [];
      paint();
    } else if (action === 'submit-toggle') {
      state.submitOpen = !state.submitOpen;
      state.notice = '';
      paint();
    } else if (action === 'retry') {
      if (isLive() && onSubmissions()) loadSubs(); else loadLive();
    } else if (action === 'use-toggle') {
      var item = findTool(id);
      if (!item) return;
      var purpose = state.root.querySelector('[data-tools-purpose]');
      if (isLive()) {
        if (button.disabled) return;
        button.disabled = true;
        request(item.mine ? 'DELETE' : 'POST', '/tools/' + encodeURIComponent(id) + '/use', { purpose: purpose ? purpose.value : '', show_on_profile: true }).then(function () { toast(item.mine ? '已取消“我在用”。' : '已标记“我在用”。'); loadLive(); }, function (error) { button.disabled = false; toast(writeError(error, '操作没有完成。')); });
      } else {
        var uses = localUses();
        if (item.mine) delete uses[id];
        else uses[id] = { started_at: new Date().toISOString(), purpose: purpose ? purpose.value : '', show_on_profile: true };
        write('uses', uses); toast(item.mine ? '已取消“我在用”（本机示例）。' : '已标记“我在用”（本机示例）。'); paint();
      }
    } else if (action === 'helpful') {
      if (isLive()) {
        if (button.disabled) return;
        button.disabled = true;
        request('POST', '/tools/reviews/' + encodeURIComponent(id) + '/helpful', {}).then(loadLive, function (error) { button.disabled = false; toast(writeError(error, '操作没有完成。')); });
      } else { var helpful = read('helpful', {}); helpful[id] = true; write('helpful', helpful); toast('已记下“有用”（本机示例）。'); paint(); }
    }
  }

  function submitTool(form) {
    if (state.submitBusy || !form.reportValidity()) return;
    var f = form.elements;
    var status = form.querySelector('[data-tools-submit-status]');
    var tags = String(f.tags.value || '').split(/[，,]/).map(function (tag) { return tag.trim(); }).filter(Boolean);
    if (tags.length > 12) { if (status) status.textContent = '标签最多 12 个。'; return; }
    var body = {
      slug: f.slug.value.trim(), name: f.name.value.trim(), vendor: f.vendor.value.trim(), category: f.category.value,
      official_url: f.official_url.value.trim(), price_tier: f.price_tier.value, tags: tags, summary: f.summary.value.trim()
    };
    var submit = form.querySelector('[type="submit"]');
    state.submitBusy = true;
    if (submit) submit.disabled = true;
    if (status) status.textContent = '';
    request('POST', '/tools/submissions', body).then(function () {
      state.submitBusy = false; state.submitOpen = false;
      state.notice = '已提交，审核通过后会出现在工具榜里。可以在“我提交的”里看进度。';
      state.subs = null;
      toast('工具已提交，等待审核。');
      paint();
    }, function (error) {
      state.submitBusy = false;
      if (submit) submit.disabled = false;
      if (status) status.textContent = writeError(error, '工具没有提交。原内容还在表单里。');
    });
  }

  function onSubmit(event) {
    var submitForm = event.target.closest && event.target.closest('[data-tools-form="submit"]');
    if (submitForm && isLive()) { event.preventDefault(); submitTool(submitForm); return; }
    var form = event.target.closest('[data-tools-form="review"]');
    if (!form) return;
    event.preventDefault();
    if (!form.reportValidity()) return;
    var body = { rating: Number(form.elements.rating.value), body: form.elements.body.value.trim() };
    if (isLive()) request('POST', '/tools/' + encodeURIComponent(form.dataset.id) + '/review', body).then(function () { toast('短评已保存。'); loadLive(); }, function (error) { toast(writeError(error, '短评没有保存。')); });
    else { var reviews = localReviews(); reviews[form.dataset.id] = body; write('reviews', reviews); toast('短评已保存在本机示例。'); paint(); }
  }

  function on(target, type, handler) {
    target.addEventListener(type, handler);
    state.unbind.push(function () { target.removeEventListener(type, handler); });
  }

  function sessionAccount() {
    var me = window.CommonsSession && window.CommonsSession.me;
    return me && me.id ? String(me.id) : '';
  }
  if (typeof window.addEventListener === 'function') {
    window.addEventListener('commons:session', function () {
      var next = sessionAccount();
      if (next === state.account) return;
      state.account = next;
      state.live = null; state.error = ''; state.loading = false; state.request += 1;
      state.submitOpen = false; state.submitBusy = false; state.notice = ''; state.subs = null;
      if (isLive() && state.root) { if (onSubmissions()) loadSubs(); else loadLive(); }
    });
  }
  state.account = sessionAccount();

  function mount() {
    if (!onSubmissions()) state.subs = null;
    var root = document.querySelector('.tools-page');
    if (!root) return;
    destroy();
    state.root = root;
    on(document, 'click', onClick);
    on(document, 'submit', onSubmit);
    if (isLive() && onSubmissions()) { if (!state.subs) loadSubs(); return; }
    if (isLive() && !state.live && !state.loading && !state.error) loadLive();
  }

  function destroy() {
    state.unbind.forEach(function (unbind) { unbind(); });
    state.unbind = [];
    state.root = null;
    state.request += 1;
  }

  function stackRows(handle) {
    return samples().filter(function (item) {
      return (item.public_users || []).some(function (person) { return person.profilePublic && person.handle === handle; });
    });
  }

  function stackOwner(handle) {
    var owner = null;
    samples().some(function (item) {
      owner = (item.public_users || []).find(function (person) { return person.handle === handle; }) || null;
      return !!owner;
    });
    return owner;
  }

  function stack(handle) {
    var rows = stackRows(handle);
    if (!rows.length) return '<section class="tools-stack"><h2>我的 AI 工具栈</h2><p class="tools-muted">暂未公开工具栈。</p></section>';
    return '<section class="tools-stack"><div class="tools-section-head"><h2>我的 AI 工具栈</h2><span>' + esc(rows.length) + ' 个</span></div><div>' + rows.map(function (item) {
      return '<a href="' + safeUrl(toolHref(item.slug)) + '">' + /* safe: toolLogo 委托 CommonsLogo 转义，降级分支也转义 */ toolLogo(item) + '<span><b>' + esc(item.name) + '</b><small>' + esc(item.category) + '</small></span></a>';
    }).join('') + '</div></section>';
  }

  function stackPage(handle) {
    var owner = stackOwner(handle);
    var title = owner ? owner.display_name + '的工具栈' : '公开工具栈';
    return '<div class="tools-page tools-stack-page"><a class="back" href="#/tools">' + icon('back') + ' 回到工具榜</a>' +
      header(title, '公开标记为正在使用的工具。', owner ? '<span>成员 · ' + /* safe: personLink returns escaped or CommonsLinks-owned HTML */ personLink(owner.handle, owner.display_name, owner.level) + '</span>' : '') + stack(handle) + '</div>';
  }

  window.CommonsTools = {
    hub: ['tools'],
    routes: { tools: page, tool: tool },
    nav: [['tools','AI 工具榜','grid','library']],
    mount: mount,
    destroy: destroy,
    stack: stack,
    count: function () { return isLive() ? (Array.isArray(state.live) ? state.live.length : null) : samples().length; }
  };
  if (window.CommonsLinks && typeof window.CommonsLinks.provide === 'function') {
    window.CommonsLinks.provide('tool', function (handle) {
      var rows = stackRows(handle);
      return rows.length ? { label: 'AI 工具栈', href: '#/tools/' + encodeURIComponent(handle), count: rows.length, icon: 'grid' } : null;
    });
  }
  (window.CommonsPages = window.CommonsPages || []).push(window.CommonsTools);
})();

