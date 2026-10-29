/* R13 ADMIN-4 · 总管理后台。示例模式读 admin-sample.js；live 模式只读真接口，读不到不回退示例。 */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ 导航与文案 */

  var NAV = [
    { id: 'overview', label: '总览', icon: 'grid', group: '运营' },
    { id: 'users', label: '用户与角色', icon: 'people', group: '运营' },
    { id: 'review', label: '内容与审核', icon: 'inbox', group: '运营' },
    { id: 'reports', label: '举报与治理', icon: 'shield', group: '运营' },
    { id: 'ops', label: '社区运营', icon: 'megaphone', group: '业务', tabs: [['announce', '公告'], ['marquee', '跑马灯'], ['ads', '广告'], ['events', '活动'], ['campaigns', '打榜'], ['groups', '小组']] },
    { id: 'economy', label: '经济', icon: 'coin', group: '业务', tabs: [['bamboo', '竹子'], ['points', '积分'], ['shop', '商店'], ['anomaly', '异常']] },
    { id: 'games', label: '游戏', icon: 'dice', group: '业务', tabs: [['params', '参数'], ['farm', '农场'], ['parking', '车位'], ['exam', '考场题库']] },
    { id: 'market', label: '市集', icon: 'tag', group: '业务' },
    { id: 'agents', label: 'Agent 与开放平台', icon: 'bot', group: '业务', tabs: [['agents', '接入的 Agent'], ['tokens', '令牌'], ['traffic', '公开层流量'], ['crawlers', '爬虫']] },
    { id: 'biz', label: '会员与商业', icon: 'card', group: '业务', tabs: [['plans', '方案'], ['waitlist', '候补名单'], ['orders', '订单'], ['applications', '赞助 / 讲师申请'], ['contributions', '贡献审核']] },
    { id: 'system', label: '系统', icon: 'settings', group: '平台', tabs: [['flags', '功能开关'], ['jobs', '周期任务'], ['health', '健康'], ['config', '配置参数']] },
    { id: 'audit', label: '审计日志', icon: 'audit', group: '平台' }
  ];
  var GROUPS = ['运营', '业务', '平台'];

  var MISSING = {
    announce: ['嵌入件', 'CommonsAnnounce.adminPanel', '公告模块'],
    groups: ['GET', '/api/admin/social/groups', '社交模块']
  };

  var CATEGORY = { forbidden: '禁止品类', scam: '疑似诈骗', counterfeit: '假货或仿品', spam: '垃圾广告', contact: '站外引流', harassment: '骚扰攻击', illegal: '违法违禁', misinformation: '不实信息', copyright: '侵权', privacy: '隐私泄露', other: '其他', daily_net_inflow: '单日净流入过高', pair_roundtrip: '两人来回转移', invite_tree: '同邀请树互投', burst: '短时集中投票', vote_anomaly: '投票异常' };
  var OBJECT_TYPE = { discussion: '讨论', reply: '回复', problem: '问题', prompt: '提示词', market_listing: '市集帖', skill: 'Skill', post: '动态', talk: '讲堂' };
  var SOURCE = { governance: '治理队列', content_report: '内容举报', market: '市集举报', campaign: '打榜异常', economy: '经济异常' };
  var RISK = { critical: '严重', high: '高', medium: '中', low: '低' };
  var CASE_STATUS = { open: '待处理', triaged: '已分派', actioned: '已处置', dismissed: '已驳回', appealed: '申诉中', closed: '已结束' };
  var USER_STATUS = { active: '正常', suspended: '已停用', pending_deletion: '注销中', deleted: '已删除' };
  var ROLE = { admin: '管理员', governor: '治理员', host: '主持人' };
  var ACTION_TYPE = { hide: '隐藏', pending_review: '转待审', rate_limit: '限速', require_source: '要求出处', delete: '删除', ban: '封禁', deduct: '扣分', demote: '降级', restore: '恢复', mute: '禁言' };
  var MODULE = { core: '核心', economy: '经济', farm: '农场', gov: '治理', governance: '治理', parking: '车位', public: '公开层', games: '游戏', events: '活动', market: '市集', announce: '公告', social: '社交', growth: '成长', bounty: '悬赏', agents: 'Agent', membership: '会员', kb: '问题库', admin: '后台' };
  var NAMESPACE = { economy: '经济', farm: '农场', parking: '车位', games: '游戏', events: '活动', market: '市集', bounty: '悬赏', announce: '公告' };
  var EVENT_KIND = { challenge: '挑战赛', cohort: '共学营', meetup: '线下聚会', talk_week: '讲堂周', '挑战赛': '挑战赛', '共学营': '共学营', '线下聚会': '线下聚会', '讲堂周': '讲堂周' };
  var MARKET_CATEGORY = { idle: '闲置', wanted: '求购', collaboration: '合作线索', group_buy: '拼车拼单', '闲置': '闲置', '求购': '求购', '合作线索': '合作线索', '拼车拼单': '拼车拼单' };
  var QUESTION_SOURCE = { kb: '问题库', skill: 'Skill', component: '组件', '问题库': '问题库', 'Skill': 'Skill', '组件': '组件' };
  var AGENT_ABILITY = { 'read:feed': '读取动态', 'draft:post': '起草动态', 'read:kb': '读取问题库', 'farm:water': '农场浇水' };
  var PLAN = { pioneer: '先锋会员', team: '团队空间' };
  var JOB = { 'economy.daily_reset': '经济每日重置', 'feed.fetch': '动态采集', 'feed.cluster': '动态归类', 'growth.recompute': '成长值重算', 'market.expire': '市集条目过期' };
  var FLAG_LABEL = { 'core.objects': '内容读写', 'economy.enabled': '竹子经济', 'farm.enabled': '先锋农场', 'gov.model_egress': '治理模型外发', 'gov.premoderation': '内容先审后发', 'gov.reports': '成员举报', 'parking.enabled': '抢车位', 'public.crawlers': '公开层爬虫' };
  var AUDIT_ACTION = { 'admin_param.rollback': '恢复参数版本', 'admin_param.set': '调整参数', 'gov.case.act': '处置治理事项', 'admin_console.user.view': '查看成员资料', 'flag.set': '调整功能开关', 'economy.admin_adjust': '调整竹子', 'events.vote_anomaly': '投票异常', 'admin.roles': '调整成员角色', 'governance.admin.sanction': '处罚成员', 'growth.appoint': '调整成员等级' };
  var TARGET_TYPE = { principal: '成员', admin_param: '参数', gov_case: '治理事项', feature_flag: '功能开关', event: '活动', object: '内容' };
  var OUTCOME = { ok: '成功', denied: '被拒', failed: '失败', error: '失败' };
  var JOB_STATE = { idle: '正常', running: '运行中', overdue: '已逾期', never: '未运行' };
  var URGENCY = { critical: '紧急', high: '高', normal: '普通' };
  var STATE_LABEL = { executed: '生效中', reverted: '已撤销', expired: '已到期', cancelled: '已取消', awaiting_second: '待二次确认' };
  var KPIS = [
    ['active_today', '今日活跃', 'active', 1], ['new_members_today', '新成员', 'new_members', 1], ['posts_today', '发帖', 'posts', 1],
    ['solved_today', '解决问题', null, 1], ['reports_pending', '举报待办', null, -1], ['anomalies_today', '异常告警', null, -1],
    ['bamboo_net_today', '竹子净流通', 'bamboo_net', 0], ['agent_calls_today', 'Agent 调用', 'agent_calls', 0], ['crawler_today', '爬虫请求', 'crawler', 0]
  ];
  var TRENDS = [['active', '活跃'], ['new_members', '新成员'], ['posts', '发帖'], ['agent_calls', 'Agent 调用'], ['crawler', '爬虫'], ['bamboo_net', '竹子净流通']];
  var USER_ACTIONS = {
    mute: { label: '禁言', high: true, danger: false, endpoint: '/admin/governance/sanctions', audit: 'governance.admin.sanction' },
    ban: { label: '封禁', high: true, danger: true, endpoint: '/admin/governance/sanctions', audit: 'governance.admin.sanction' },
    unban: { label: '解封', high: true, danger: false, endpoint: '/admin/governance/sanctions', audit: 'governance.admin.sanction' },
    role: { label: '改角色', high: true, danger: false, endpoint: '/admin/roles', audit: 'admin.roles' },
    level: { label: '调等级', high: true, danger: false, endpoint: '/admin/growth/appoint', audit: 'growth.appoint' },
    adjust: { label: '调账', high: true, danger: false, endpoint: '/admin/economy/adjust', audit: 'economy.admin_adjust' }
  };
  var BATCH = {
    resolve: { label: '处理', path: 'resolve' },
    dismiss: { label: '驳回', body: function (reason) { return { reason: reason }; }, path: 'dismiss' },
    hide: { label: '隐藏内容', body: function (reason) { return { type: 'hide', reason: reason }; }, path: 'act' },
    pending_review: { label: '转待审', body: function (reason) { return { type: 'pending_review', reason: reason }; }, path: 'act' }
  };

  var state = {
    root: null, boot: 'idle', viewer: null, bootError: '', route: { section: 'overview', tab: '', query: null },
    cache: {}, filters: {}, selection: {}, drawer: null, flow: null, menuOpen: false, notice: '',
    search: { q: '', open: false, status: 'idle', data: null }, trend: 'active', demo: null,
    controllers: [], unbind: [], timers: {}
  };

  /* ------------------------------------------------------------------ 工具 */

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
    });
  }
  function live() { return !!(window.CommonsAPI && window.CommonsAPI.mode === 'live'); }
  function sample() { return window.COMMONS_ADMIN_SAMPLE || {}; }
  function demo() {
    if (!state.demo) state.demo = JSON.parse(JSON.stringify(sample()));
    return state.demo;
  }
  function toast(message) { if (window.Commons && window.Commons.toast) window.Commons.toast(message); }
  function nowMs() { return live() ? Date.now() : (Date.parse(sample().now || '') || Date.now()); }
  function num(value) {
    if (value == null || value === '') return '—';
    if (typeof value !== 'number') return esc(value);
    return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 }).format(value);
  }
  function signed(value) {
    if (value == null) return '—';
    return (value > 0 ? '+' : value < 0 ? '−' : '') + new Intl.NumberFormat('zh-CN').format(Math.abs(value));
  }
  function jsonList(value) {
    if (Array.isArray(value)) return value;
    try { return JSON.parse(value || '[]'); } catch (error) { return []; }
  }
  function maskedToken(value) {
    var text = String(value || '');
    var tail = text.replace(/^vca_/, '').replace(/^…/, '').slice(-4);
    return 'vca_…' + (tail || '????');
  }
  function span(ms) {
    var minutes = Math.round(Math.abs(ms) / 60000);
    if (minutes < 1) return '1 分钟';
    if (minutes < 60) return minutes + ' 分钟';
    if (minutes < 60 * 24) return Math.round(minutes / 60) + ' 小时';
    return Math.round(minutes / 1440) + ' 天';
  }
  function rel(iso) {
    if (!iso) return '—';
    var t = Date.parse(iso);
    if (isNaN(t)) return esc(iso);
    var diff = t - nowMs();
    if (Math.abs(diff) < 60000) return '刚刚';
    return diff < 0 ? span(diff) + '前' : span(diff) + '后';
  }
  function stamp(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return esc(iso);
    return d.toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  }
  function initial(name) { return esc(String(name || '?').trim().charAt(0) || '?'); }
  function safeUrl(url) {
    var text = String(url || '');
    return /^#\/[a-z0-9/_?=&.-]*$/i.test(text) ? esc(text) : '#/admin';
  }
  function label(map, key) { return esc(map[key] || key || '—'); }
  function knownLabel(map, key, fallback) { return esc(map[key] || fallback); }
  function icon(name) {
    var paths = {
      grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
      people: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-7 10v-1a6 6 0 0 1 12 0v1M16 3.5a4 4 0 0 1 0 7.5M22 21v-1a6 6 0 0 0-4-5.6',
      inbox: 'M3 13h5l2 3h4l2-3h5M5 5h14l2 8v6H3v-6z',
      shield: 'M12 3 5 6v5c0 4.5 3 7.5 7 10 4-2.5 7-5.5 7-10V6z',
      megaphone: 'M4 10v4h3l7 4V6L7 10zm13-1.5a4 4 0 0 1 0 7',
      coin: 'M12 3c-4 0-7 1.3-7 3v12c0 1.7 3 3 7 3s7-1.3 7-3V6c0-1.7-3-3-7-3zM5 6c0 1.7 3 3 7 3s7-1.3 7-3M5 12c0 1.7 3 3 7 3s7-1.3 7-3',
      dice: 'M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM8.5 8.5h.01M15.5 15.5h.01M15.5 8.5h.01M8.5 15.5h.01',
      tag: 'M3 12V4h8l10 10-8 8zM7.5 7.5h.01',
      bot: 'M12 3v3M6 7h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2zM9 12h.01M15 12h.01M9 16h6',
      card: 'M3 6h18v12H3zM3 10h18M7 15h4',
      settings: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1-2 2-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21h-3v-.2a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1-2-2 .1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3v-3h.2a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1 2-2 .1.1a1.7 1.7 0 0 0 1.8.3H8a1.7 1.7 0 0 0 1-1.5V3h3v.2a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1 2 2-.1.1a1.7 1.7 0 0 0-.3 1.8V8a1.7 1.7 0 0 0 1.5 1H21v3h-.2a1.7 1.7 0 0 0-1.5 1z',
      audit: 'M6 3h12v18H6zM9 8h6M9 12h6M9 16h4',
      search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm9 16-4.2-4.2',
      arrow: 'm9 6 6 6-6 6',
      back: 'm15 6-6 6 6 6',
      close: 'M6 6l12 12M18 6 6 18',
      menu: 'M4 7h16M4 12h16M4 17h16',
      alert: 'M12 4 3 20h18L12 4zm0 6v4m0 3h.01',
      lock: 'M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5z',
      check: 'm5 12 4 4L19 6',
      plug: 'M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4',
      history: 'M3 12a9 9 0 1 0 3-6.7M3 4v4h4M12 8v4l3 2',
      external: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6'
    };
    return '<svg class="adm-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + esc(paths[name] || paths.grid) + '"/></svg>';
  }
  function pill(text, tone) { return '<span class="adm-pill is-' + esc(tone || 'muted') + '">' + esc(text) + '</span>'; }
  function riskPill(risk) { return pill(RISK[risk] || risk || '—', risk === 'critical' || risk === 'high' ? 'danger' : risk === 'medium' ? 'notice' : 'muted'); }
  function statusPill(status) { return pill(USER_STATUS[status] || status, status === 'active' ? 'good' : status === 'suspended' ? 'danger' : 'muted'); }
  function person(p) {
    if (!p) return '<span class="adm-faint">—</span>';
    return '<span class="adm-person-cell"><span class="adm-avatar" aria-hidden="true">' + initial(p.name || p.handle) + '</span><span><b>' + esc(p.name || p.handle || '未命名') + '</b><small>@' + esc(p.handle || '—') + '</small></span></span>';
  }
  function demoBadge() { return live() ? '<span class="adm-mode is-live">实时</span>' : '<span class="adm-mode">示例</span>'; }

  /* ------------------------------------------------------------------ 路由 */

  function parseRoute() {
    var raw = location.hash.replace(/^#\/?/, '');
    var query = '';
    var cut = raw.indexOf('?');
    if (cut >= 0) { query = raw.slice(cut + 1); raw = raw.slice(0, cut); }
    var parts = raw.split('/').filter(Boolean);
    var section = parts[1] || 'overview';
    var nav = navItem(section) || NAV[0];
    var tab = parts[2] || (nav.tabs ? nav.tabs[0][0] : '');
    if (nav.tabs && !nav.tabs.some(function (t) { return t[0] === tab; })) tab = nav.tabs[0][0];
    return { section: nav.id, tab: tab, query: new URLSearchParams(query) };
  }
  function navItem(id) { return NAV.filter(function (n) { return n.id === id; })[0]; }

  /* ------------------------------------------------------------------ 数据层 */

  function classify(error) {
    if (!error) return 'error';
    if (error.code === 'totp_setup_required') return 'locked';
    if (error.status === 404 || error.status === 405 || error.status === 501 || error.code === 'capability_unavailable') return 'missing';
    if (error.status === 401 || error.status === 403) return 'denied';
    return 'error';
  }

  function fetchInto(key, path, query, after) {
    state.cache[key] = { status: 'loading', path: path, key: key };
    var controller = new AbortController();
    state.controllers.push(controller);
    window.CommonsAPI.get(path, query, { signal: controller.signal }).then(function (res) {
      state.cache[key] = { status: 'ok', data: res.data, meta: res.meta || {}, path: path, key: key };
      (after || paint)();
    }).catch(function (error) {
      if (error && error.name === 'AbortError') { if (state.cache[key] && state.cache[key].status === 'loading') delete state.cache[key]; return; }
      state.cache[key] = { status: classify(error), error: error, path: path, key: key };
      (after || paint)();
    });
  }

  function use(key, path, query, after) {
    if (!live()) return { status: 'ok', data: null };
    if (!state.cache[key]) fetchInto(key, path, query, after);
    return state.cache[key];
  }

  function missingEntry(key) { return { status: 'missing', missing: key }; }

  function invalidate(prefix) {
    Object.keys(state.cache).forEach(function (key) { if (key.indexOf(prefix) === 0) delete state.cache[key]; });
  }

  function apiPost(path, body) {
    return window.CommonsAPI.post(path, body, { idempotencyKey: window.CommonsAPI.newIdempotencyKey() });
  }

  /* ------------------------------------------------------------------ 通用块 */

  /* safe-slot: sub, actions — 副标题与按钮区由调用方转义后拼好 */
  function head(title, sub, actions) {
    return '<div class="adm-head"><div><h1>' + esc(title) + '</h1>' + (sub ? '<p>' + sub + '</p>' : '') + '</div>' + (actions || '') + '</div>';
  }

  function tabsBar(nav, active) {
    if (!nav.tabs) return '';
    return '<nav class="tabs adm-tabs" aria-label="' + esc(nav.label) + '分区">' + nav.tabs.map(function (t) {
      return '<a href="#/admin/' + esc(nav.id) + '/' + esc(t[0]) + '"' + (t[0] === active ? ' aria-current="page" class="is-active"' : '') + '>' + esc(t[1]) + '</a>';
    }).join('') + '</nav>';
  }

  function missingBlock(key, compact) {
    var m = MISSING[key] || ['GET', key, ''];
    return '<div class="adm-missing' + (compact ? ' is-compact' : '') + '">' + icon('plug') + '<div><b>接口未接</b></div>' + (m[2] ? '<span class="adm-missing-owner">' + esc(m[2]) + '</span>' : '') + '</div>';
  }

  function stateBlock(entry) {
    if (!entry || entry.status === 'loading') return '<div class="adm-skeleton" aria-busy="true" aria-label="正在读取"><span></span><span></span><span></span><span></span></div>';
    if (entry.status === 'missing') return entry.missing ? missingBlock(entry.missing) : '<div class="adm-missing">' + icon('plug') + '<div><b>接口未接</b></div></div>';
    if (entry.status === 'locked') return '<div class="adm-gate">' + icon('lock') + '<div><b>需要两步验证</b><span>开启后才能读取这一页。</span></div><a class="button tonal small" href="#/account">去开启</a></div>';
    if (entry.status === 'denied') return '<div class="adm-gate">' + icon('shield') + '<div><b>没有权限</b><span>这一页只对管理员开放。</span></div></div>';
    return '<div class="adm-gate is-error">' + icon('alert') + '<div><b>没有读出来</b><span>' + esc(entry.error && entry.error.message || '请稍后重试') + '</span></div><button class="button small" type="button" data-adm="retry" data-key="' + esc(entry.key || '') + '">重试</button></div>';
  }

  /* safe-slot: meta, body — 调用方传入的是本文件视图函数拼好、已转义的 HTML */
  function card(title, meta, body, cls) {
    return '<section class="adm-card ' + esc(cls || '') + '"><header class="adm-card-head"><h2>' + esc(title) + '</h2>' + (meta ? '<span>' + meta + '</span>' : '') + '</header>' + body + '</section>';
  }

  /* safe-fn: 列头与列渲染函数都来自本文件，各自转义数据；空态按钮是写死的链接 */
  function table(cols, rows, opts) {
    opts = opts || {};
    if (!rows || !rows.length) return '<div class="adm-empty"><b>' + esc(opts.empty || '暂无记录') + '</b>' + /* safe: 写死的按钮 HTML */ (opts.emptyAction || '') + '</div>';
    return '<div class="adm-table-wrap"><table class="adm-table"><thead><tr>' + cols.map(function (col) {
      return '<th scope="col" class="' + esc(col.cls || '') + '">' + /* safe: 列头 HTML 来自本文件常量 */ (col.head || esc(col.label)) + '</th>';
    }).join('') + '</tr></thead><tbody>' + rows.map(function (row, index) {
      var attrs = opts.rowAttrs ? opts.rowAttrs(row, index) : '';
      return '<tr' + /* safe: 行属性由本文件拼接并转义 */ attrs + '>' + cols.map(function (col) {
        return '<td class="' + esc(col.cls || '') + '">' + /* safe: 列渲染函数自行转义数据 */ col.render(row, index) + '</td>';
      }).join('') + '</tr>';
    }).join('') + '</tbody></table></div>';
  }

  function kpiRow(items) {
    return '<div class="adm-stats">' + items.map(function (item) {
      return '<div class="adm-stat"><span>' + esc(item[0]) + '</span><strong>' + /* safe: 数值由 num/signed 格式化 */ item[1] + '</strong>' + (item[2] ? '<small>' + esc(item[2]) + '</small>' : '') + '</div>';
    }).join('') + '</div>';
  }

  function sparkPath(series, width, height) {
    var values = (series || []).map(function (p) { return Number(p.value || 0); });
    if (values.length < 2) return '';
    var max = Math.max.apply(Math, values), min = Math.min.apply(Math, values), range = max - min || 1;
    return values.map(function (v, i) {
      var x = i * width / (values.length - 1), y = height - 2 - (v - min) / range * (height - 4);
      return (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
    }).join('');
  }

  function barChart(series, key) {
    series = series || [];
    if (!series.length) return '<div class="adm-empty"><b>暂无数据</b></div>';
    var values = series.map(function (p) { return Number(p.value || 0); });
    var max = Math.max.apply(Math, values.concat([0])), min = Math.min.apply(Math, values.concat([0]));
    var range = max - min || 1, width = 640, height = 200, left = 44, bottom = 22, top = 10;
    var plot = height - bottom - top, step = (width - left) / series.length, bar = Math.max(6, step * 0.56);
    var zero = top + max / range * plot;
    var ticks = [max, (max + min) / 2, min].map(function (v) { return Math.round(v); });
    var grid = ticks.map(function (v) {
      var y = top + (max - v) / range * plot;
      return '<line x1="' + left + '" x2="' + width + '" y1="' + y.toFixed(1) + '" y2="' + y.toFixed(1) + '"/><text x="' + (left - 8) + '" y="' + (y + 4).toFixed(1) + '" text-anchor="end">' + num(v) + '</text>';
    }).join('');
    var bars = series.map(function (p, i) {
      var v = values[i], x = left + i * step + (step - bar) / 2;
      var y = v >= 0 ? zero - v / range * plot : zero, h = Math.max(1.5, Math.abs(v) / range * plot);
      var last = i === series.length - 1;
      return '<g class="adm-bar' + (last ? ' is-today' : '') + '"><rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + bar.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="3"><title>' + esc(p.day) + '：' + num(v) + '</title></rect>' +
        ((i % 3 === 0 || last) ? '<text x="' + (x + bar / 2).toFixed(1) + '" y="' + (height - 6) + '" text-anchor="middle">' + esc(String(p.day || '').slice(5)) + '</text>' : '') + '</g>';
    }).join('');
    return '<div class="adm-chart-wrap"><svg class="adm-chart" viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="' + esc(key) + '最近 14 天">' + '<g class="adm-chart-grid">' + grid + '</g>' + bars + '</svg></div>';
  }

  /* ------------------------------------------------------------------ 外壳 */

  function side() {
    var counts = navCounts();
    return '<aside class="adm-side" aria-label="后台导航"><a class="adm-brand" href="#/admin">' + icon('shield') + '<span><b>管理后台</b><small>智能体先锋队</small></span></a><nav>' + GROUPS.map(function (group) {
      return '<p class="adm-nav-group">' + esc(group) + '</p><ul>' + NAV.filter(function (n) { return n.group === group; }).map(function (n) {
        var active = state.route.section === n.id;
        var count = counts[n.id];
        return '<li><a class="adm-nav-item' + (active ? ' is-active' : '') + '" href="#/admin/' + esc(n.id) + '"' + (active ? ' aria-current="page"' : '') + '>' + icon(n.icon) + '<span>' + esc(n.label) + '</span>' + (count ? '<em class="adm-nav-count">' + num(count) + '</em>' : '') + '</a>' +
          (active && n.tabs ? '<ul class="adm-subnav">' + n.tabs.map(function (t) {
            var on = state.route.tab === t[0];
            return '<li><a href="#/admin/' + esc(n.id) + '/' + esc(t[0]) + '"' + (on ? ' aria-current="page" class="is-active"' : '') + '>' + esc(t[1]) + '</a></li>';
          }).join('') + '</ul>' : '') + '</li>';
      }).join('') + '</ul>';
    }).join('') + '</nav>' + sideFoot() + '</aside>';
  }

  function sideFoot() {
    var viewer = live() ? state.viewer || {} : demo().viewer || {};
    var roles = (viewer.roles || []).map(function (r) { return ROLE[r] || r; }).join(' · ') || '管理员';
    return '<div class="adm-side-foot"><span class="adm-avatar" aria-hidden="true">' + initial(viewer.display_name || viewer.handle) + '</span><span class="adm-side-who"><b>' + esc(viewer.display_name || viewer.handle || '管理员') + '</b><small>' + esc(roles) + (viewer.totp_enabled ? ' · 已开两步验证' : ' · 未开两步验证') + '</small></span><a class="adm-back" href="#/home">' + icon('back') + '返回社区</a></div>';
  }

  function navCounts() {
    var counts = {};
    var ov = live() ? state.cache.overview : { status: 'ok', data: demo().overview };
    if (ov && ov.status === 'ok' && ov.data) counts.overview = (ov.data.todos || []).length;
    var q = live() ? state.cache['queue:active'] : { status: 'ok', data: demo().queue };
    if (q && q.status === 'ok' && q.data) {
      var items = q.data.items || [];
      counts.review = items.filter(function (i) { return i.source === 'governance' || i.source === 'content_report'; }).length;
      counts.reports = items.length;
    }
    return counts;
  }

  function topbar() {
    var nav = navItem(state.route.section) || NAV[0];
    var tab = nav.tabs ? nav.tabs.filter(function (t) { return t[0] === state.route.tab; })[0] : null;
    var counts = navCounts();
    return '<header class="adm-top"><button class="adm-menu" type="button" data-adm="menu" aria-expanded="' + (state.menuOpen ? 'true' : 'false') + '" aria-label="打开后台导航">' + icon('menu') + '</button>' +
      '<div class="adm-crumb"><span>管理后台</span>' + icon('arrow') + '<b>' + esc(nav.label) + '</b>' + (tab ? icon('arrow') + '<span>' + esc(tab[1]) + '</span>' : '') + '</div>' +
      searchBox() +
      '<div class="adm-top-meta">' + (counts.overview ? '<a class="adm-todo-chip" href="#/admin">待办 <b>' + num(counts.overview) + '</b></a>' : '') + demoBadge() + '</div></header>';
  }

  function notice() {
    return state.notice ? '<div class="adm-notice" role="status"><span>' + esc(state.notice) + '</span><button type="button" data-adm="notice-close" aria-label="关闭提示">' + icon('close') + '</button></div>' : '';
  }

  function view() {
    var r = state.route;
    if (r.section === 'users') return usersView();
    if (r.section === 'review') return queuePage('review');
    if (r.section === 'reports') return queuePage('reports');
    if (r.section === 'ops') return opsView();
    if (r.section === 'economy') return economyView();
    if (r.section === 'games') return gamesView();
    if (r.section === 'market') return marketView();
    if (r.section === 'agents') return agentsView();
    if (r.section === 'biz') return bizView();
    if (r.section === 'system') return systemView();
    if (r.section === 'audit') return auditView();
    return overviewView();
  }

  function bootScreen() {
    if (state.boot === 'denied') return '<div class="adm-boot">' + icon('shield') + '<h1>需要管理员权限</h1><p>当前账号不能进入管理后台。</p><a class="button" href="#/home">返回社区</a></div>';
    if (state.boot === 'error') return '<div class="adm-boot">' + icon('alert') + '<h1>后台没有读出来</h1><p>' + esc(state.bootError || '请稍后重试') + '</p><button class="button primary" type="button" data-adm="reboot">重新读取</button></div>';
    return '<div class="adm-boot" aria-busy="true"><div class="adm-skeleton is-boot"><span></span><span></span><span></span></div><h1>正在进入管理后台</h1></div>';
  }

  function shell() {
    if (live() && state.boot !== 'ready') return bootScreen();
    return '<div class="adm-frame' + (state.menuOpen ? ' is-menu-open' : '') + (state.menuEnter ? ' is-menu-enter' : '') + '">' + side() +
      (state.menuOpen ? '<button class="adm-scrim" type="button" data-adm="menu" aria-label="关闭后台导航"></button>' : '') +
      '<div class="adm-main">' + topbar() + '<div class="adm-body">' + notice() + /* safe: 各视图函数自行转义数据 */ view() + '</div></div>' + drawer() + '</div>';
  }

  /* ------------------------------------------------------------------ 总览 */

  function overviewData() { return live() ? use('overview', '/admin/admin/overview') : { status: 'ok', data: demo().overview }; }

  function kpi(def, data) {
    var item = (data.cards || {})[def[0]] || { value: null, status: '模块未上线' };
    if (item.value == null) {
      return '<article class="adm-kpi is-offline"><span class="adm-kpi-label">' + esc(def[1]) + '</span><strong class="adm-kpi-value">—</strong><span class="adm-kpi-foot">' + esc(item.status || '模块未上线') + '</span></article>';
    }
    var delta = '';
    if (item.previous != null && item.previous !== 0) {
      var pct = (item.value - item.previous) / Math.abs(item.previous) * 100;
      var good = def[3] === 0 ? 'flat' : (pct >= 0) === (def[3] > 0) ? 'good' : 'bad';
      delta = '<span class="adm-delta is-' + good + '">' + (pct >= 0 ? '▲ ' : '▼ ') + Math.abs(pct).toFixed(1) + '%</span><span>昨日 ' + num(item.previous) + '</span>';
    } else if (def[0] === 'reports_pending' && item.opened_yesterday != null) {
      delta = '<span>昨日新增 ' + num(item.opened_yesterday) + '</span>';
    } else if (item.previous === 0) {
      delta = '<span>昨日 0</span>';
    }
    if (def[0] === 'reports_pending') {
      var complaints = (data.cards || {}).complaints_pending;
      if (complaints && complaints.value > 0) delta += '<a class="adm-text-danger" href="#/govern?tab=complaints">第三方投诉 ' + num(complaints.value) + ' 件待处理</a>';
    }
    if (def[0] === 'bamboo_net_today' && item.issued != null) delta = '<span>发 ' + num(item.issued) + ' · 花 ' + num(item.spent) + '</span>';
    var spark = def[2] && data.trends && data.trends[def[2]] ? '<svg class="adm-spark" viewBox="0 0 96 28" aria-hidden="true"><path d="' + esc(sparkPath(data.trends[def[2]], 96, 28)) + '"/></svg>' : '';
    var value = def[0] === 'bamboo_net_today' ? signed(item.value) : num(item.value);
    var alert = def[3] < 0 && item.value > 0 ? ' is-alert' : '';
    return '<article class="adm-kpi' + alert + '"><span class="adm-kpi-label">' + esc(def[1]) + '</span><strong class="adm-kpi-value">' + /* safe: 数值格式化输出 */ value + '</strong><span class="adm-kpi-foot">' + delta + '</span>' + spark + '</article>';
  }

  function todoList(todos) {
    if (!todos || !todos.length) return '<div class="adm-empty"><b>今天没有待办</b><a class="button small" href="#/admin/review">看审核队列</a></div>';
    return '<ol class="adm-todos">' + todos.map(function (t) {
      return '<li><a class="adm-todo is-' + esc(t.urgency) + '" href="' + safeUrl(t.link) + '"><span class="adm-urgency">' + label(URGENCY, t.urgency) + '</span><span class="adm-todo-title">' + esc(t.title) + '<small>' + (t.oldest_at ? '最早 ' + rel(t.oldest_at) : '待处理') + '</small></span><b class="adm-todo-count">' + num(t.count) + '</b>' + icon('arrow') + '</a></li>';
    }).join('') + '</ol>';
  }

  function wiring(data) {
    var rows = [
      ['治理队列', (data.cards.reports_pending || {}).status],
      ['问题库', (data.cards.solved_today || {}).status],
      ['竹子经济', (data.cards.bamboo_net_today || {}).status],
      ['Agent 计量', (data.cards.agent_calls_today || {}).status],
      ['公开层', (data.cards.crawler_today || {}).status]
    ];
    var queueEntry = live() ? state.cache['queue:active'] : { status: 'ok', data: demo().queue };
    var readonly = queueEntry && queueEntry.status === 'ok' ? (queueEntry.data.sources || []).filter(function (s) { return s.writeback === false && s.status === 'ok'; }) : [];
    return '<ul class="adm-wiring">' + rows.map(function (r) {
      var ok = r[1] === 'ok';
      return '<li><span class="adm-dot is-' + (ok ? 'good' : 'muted') + '"></span><span>' + esc(r[0]) + '</span><em>' + (ok ? '已接入' : esc(r[1] || '模块未上线')) + '</em></li>';
    }).join('') + readonly.map(function (s) {
      return '<li><span class="adm-dot is-notice"></span><span>' + esc(s.label) + '</span><em>只读，处理无法回写</em></li>';
    }).join('') + '</ul>';
  }

  function overviewView() {
    var entry = overviewData();
    if (live()) use('queue:active', '/admin/admin/queue', { status: 'active' });
    var sub = entry.status === 'ok' && entry.data ? esc(String(entry.data.day || '').slice(5).replace('-', ' 月 ')) + ' 日 · 更新于 ' + stamp(entry.data.as_of) : '';
    if (entry.status !== 'ok') return head('总览', '') + stateBlock(entry);
    var d = entry.data;
    var series = (d.trends || {})[state.trend];
    var trendTabs = '<div class="segmented adm-seg" role="group" aria-label="趋势指标">' + TRENDS.map(function (t) {
      var off = !(d.trends || {})[t[0]];
      return '<button type="button" data-adm="trend" data-value="' + esc(t[0]) + '" aria-pressed="' + (state.trend === t[0] ? 'true' : 'false') + '"' + (off ? ' disabled' : '') + '>' + esc(t[1]) + '</button>';
    }).join('') + '</div>';
    return head('总览', sub) + '<div class="adm-ov"><div class="adm-ov-main">' +
      '<section class="adm-kpis" aria-label="今日关键数">' + KPIS.map(function (def) { return kpi(def, d); }).join('') + '</section>' +
      '<section class="adm-card adm-ov-trend"><header class="adm-card-head"><h2>最近 14 天</h2>' + trendTabs + '</header>' + (series ? barChart(series, (TRENDS.filter(function (t) { return t[0] === state.trend; })[0] || [])[1]) : '<div class="adm-empty"><b>模块未上线</b></div>') + '</section>' +
      '</div><div class="adm-ov-side">' + card('待办', num((d.todos || []).length) + ' 项', todoList(d.todos), 'adm-ov-todo') + card('接入状态', '', wiring(d), 'adm-ov-wiring') + '</div></div>';
  }

  /* ------------------------------------------------------------------ 用户与角色 */

  function userFilters() {
    var f = state.filters.users || (state.filters.users = { q: '', status: '', level: '', role: '' });
    return f;
  }

  function usersEntry() {
    var f = userFilters();
    if (!live()) {
      var rows = demo().users.filter(function (u) {
        var q = f.q.trim().toLowerCase();
        return (!q || u.handle.indexOf(q) >= 0 || u.name.toLowerCase().indexOf(q) >= 0 || u.id === q) &&
          (!f.status || u.status === f.status) && (!f.level || String(u.level) === f.level) && (!f.role || u.roles.indexOf(f.role) >= 0);
      });
      return { status: 'ok', data: rows, meta: {} };
    }
    var query = { q: f.q.trim() || null, status: f.status || null, level: f.level || null, role: f.role || null, limit: 30 };
    return use('users?' + JSON.stringify(query), '/admin/admin/users', query);
  }

  function usersView() {
    var f = userFilters();
    var entry = usersEntry();
    var rows = entry.status === 'ok' ? (entry.data || []).concat(entry.more || []) : [];
    var segs = [['', '全部'], ['active', '正常'], ['suspended', '已停用'], ['pending_deletion', '注销中']];
    var filters = '<form class="adm-filters" data-adm-form="users" role="search"><label class="adm-input-icon">' + icon('search') + '<input data-adm-focus="users-q" data-adm-input="users-q" name="q" value="' + esc(f.q) + '" placeholder="用户名、名字或 ID" autocomplete="off" aria-label="搜索成员"></label>' +
      '<div class="segmented adm-seg" role="group" aria-label="状态">' + segs.map(function (s) { return '<button type="button" data-adm="users-status" data-value="' + esc(s[0]) + '" aria-pressed="' + (f.status === s[0] ? 'true' : 'false') + '">' + esc(s[1]) + '</button>'; }).join('') + '</div>' +
      '<label class="field adm-select"><span class="adm-sr">等级</span><select data-adm-change="users-level" aria-label="等级"><option value="">全部等级</option>' + [1, 2, 3, 4, 5].map(function (l) { return '<option value="' + l + '"' + (f.level === String(l) ? ' selected' : '') + '>L' + l + '</option>'; }).join('') + '</select></label>' +
      '<label class="field adm-select"><span class="adm-sr">角色</span><select data-adm-change="users-role" aria-label="角色"><option value="">全部角色</option>' + Object.keys(ROLE).map(function (r) { return '<option value="' + esc(r) + '"' + (f.role === r ? ' selected' : '') + '>' + esc(ROLE[r]) + '</option>'; }).join('') + '</select></label></form>';
    var cols = [
      { label: '成员', render: function (u) { return '<button class="adm-row-open" type="button" data-adm="open-user" data-id="' + esc(u.id) + '">' + person(u) + '</button>' + ((u.roles || []).length ? '<span class="adm-tags">' + u.roles.map(function (r) { return '<span class="adm-tag">' + label(ROLE, r) + '</span>'; }).join('') + '</span>' : ''); } },
      { label: '等级', cls: 'num', render: function (u) { return '<span class="adm-level">L' + num(u.level) + '</span>'; } },
      { label: '贡献', cls: 'num', render: function (u) { return num(u.contribution); } },
      { label: '竹子', cls: 'num', render: function (u) { return num(u.bamboo); } },
      { label: '最近活跃', render: function (u) { return '<span class="adm-time">' + rel(u.last_seen_at) + '</span>'; } },
      { label: '状态', render: function (u) { return statusPill(u.status) + (u.sanctions ? '<small class="adm-faint">处罚 ' + num(u.sanctions) + '</small>' : ''); } }
    ];
    var body = entry.status === 'ok' ? table(cols, rows, {
      empty: '没有匹配的成员',
      rowAttrs: function (u) { return ' data-adm="open-user" data-id="' + esc(u.id) + '" class="is-clickable' + (state.drawer && state.drawer.id === u.id ? ' is-selected' : '') + '"'; }
    }) + (entry.meta && entry.meta.next_cursor ? '<div class="adm-more"><button class="button small" type="button" data-adm="users-more">加载更多</button></div>' : '') : stateBlock(entry);
    var sub = entry.status === 'ok' ? num(rows.length) + (entry.meta && entry.meta.next_cursor ? '+' : '') + ' 名成员' : '';
    return head('用户与角色', sub) + filters + body;
  }

  function userDetailEntry(id) {
    if (!live()) {
      var row = demo().users.filter(function (u) { return u.id === id; })[0];
      if (!row) return { status: 'missing', path: '/admin/admin/users/' + id };
      var extra = demo().detail[id] || {};
      return { status: 'ok', data: Object.assign({}, row, {
        totp_enabled: row.roles.length > 0, level_source: row.level >= 4 ? 'appointed' : 'computed', active_sessions: 1,
        contribution: { value: row.contribution, status: 'ok' }, points: { value: row.points, status: 'ok' }, bamboo: { value: row.bamboo, status: 'ok' },
        inviter: extra.inviter || null, invitees: extra.invitees || { total: row.invitees, items: [] }, recent: extra.recent || [],
        sanctions: { status: 'ok', items: extra.sanctions || [] }, roles: row.roles.map(function (r) { return { role: r }; })
      }) };
    }
    return use('user:' + id, '/admin/admin/users/' + encodeURIComponent(id));
  }

  function drawerStat(name, metric) {
    var v = metric && metric.value != null ? num(metric.value) : '—';
    return '<div><span>' + esc(name) + '</span><strong>' + /* safe: num 格式化 */ v + '</strong>' + (metric && metric.status && metric.status !== 'ok' ? '<small>' + esc(metric.status) + '</small>' : '') + '</div>';
  }

  function kv(rows) {
    return '<dl class="adm-kv">' + rows.map(function (r) { return '<div><dt>' + esc(r[0]) + '</dt><dd>' + /* safe: 调用方已转义 */ r[1] + '</dd></div>'; }).join('') + '</dl>';
  }

  function userTab(d, tab) {
    if (tab === 'recent') {
      return (d.recent || []).length ? '<ol class="adm-timeline">' + d.recent.map(function (r) {
        return '<li><span class="adm-time">' + rel(r.occurred_at) + '</span><span>' + knownLabel(AUDIT_ACTION, r.action, '其他动作') + '</span><span class="adm-faint">' + knownLabel(TARGET_TYPE, r.target_type, '其他对象') + '</span>' + (r.outcome === 'ok' ? '' : pill(OUTCOME[r.outcome] || '其他结果', 'notice')) + '</li>';
      }).join('') + '</ol>' : '<div class="adm-empty"><b>暂无行为记录</b></div>';
    }
    if (tab === 'sanctions') {
      var s = d.sanctions || { items: [] };
      if (s.status && s.status !== 'ok') return '<div class="adm-empty"><b>' + esc(s.status) + '</b></div>';
      return (s.items || []).length ? '<ol class="adm-timeline is-sanctions">' + s.items.map(function (a) {
        return '<li>' + pill(ACTION_TYPE[a.action_type] || '未知动作', a.action_type === 'ban' ? 'danger' : 'notice') + '<span class="adm-tl-main"><b>' + esc(a.reason) + '</b><small>' + knownLabel(STATE_LABEL, a.state, '未知状态') + ' · ' + stamp(a.created_at) + (a.expires_at ? ' · 至 ' + stamp(a.expires_at) : '') + '</small></span></li>';
      }).join('') + '</ol>' : '<div class="adm-empty"><b>没有处罚记录</b></div>';
    }
    if (tab === 'invites') {
      var inv = d.invitees || { total: 0, items: [] };
      return '<div class="adm-invite-tree">' + (d.inviter ? '<button class="adm-tree-node is-parent" type="button" data-adm="open-user" data-id="' + esc(d.inviter.id) + '">' + person(d.inviter) + '<small>邀请人</small></button>' : '<div class="adm-tree-node is-parent is-root"><span class="adm-faint">初始成员，没有邀请人</span></div>') +
        '<div class="adm-tree-node is-self">' + person(d) + '<small>邀请了 ' + num(inv.total) + ' 人</small></div>' +
        ((inv.items || []).length ? '<ul>' + inv.items.map(function (c) {
          return '<li><button class="adm-tree-node" type="button" data-adm="open-user" data-id="' + esc(c.id) + '">' + person(c) + '<small>L' + num(c.level) + ' · ' + label(USER_STATUS, c.status) + (c.invitees ? ' · 再邀请 ' + num(c.invitees) : '') + '</small></button></li>';
        }).join('') + '</ul>' : '') + '</div>';
    }
    return kv([
      ['状态', statusPill(d.status)],
      ['角色', (d.roles || []).length ? d.roles.map(function (r) { return '<span class="adm-tag">' + label(ROLE, r.role || r) + '</span>'; }).join('') : '<span class="adm-faint">普通成员</span>'],
      ['等级', 'L' + num(d.level) + ' <span class="adm-faint">' + (d.level_source === 'appointed' ? '任命' : '按贡献') + '</span>'],
      ['两步验证', d.totp_enabled ? '已开启' : '<span class="adm-faint">未开启</span>'],
      ['最近活跃', rel(d.last_seen_at)],
      ['注册', stamp(d.created_at)],
      ['邀请人', d.inviter ? '<button class="adm-link" type="button" data-adm="open-user" data-id="' + esc(d.inviter.id) + '">' + esc(d.inviter.name || d.inviter.handle) + '</button>' : '<span class="adm-faint">无</span>']
    ]);
  }

  function userDrawer() {
    var id = state.drawer.id;
    var entry = userDetailEntry(id);
    if (entry.status !== 'ok') return drawerFrame('成员详情', '', stateBlock(entry), '');
    var d = entry.data;
    var tab = state.drawer.tab || 'summary';
    var tabs = [['summary', '概况'], ['recent', '最近行为'], ['sanctions', '处罚记录'], ['invites', '邀请树']];
    var flow = state.flow && state.flow.kind === 'user' && state.flow.id === id ? state.flow : null;
    var headHtml = '<div class="adm-drawer-person"><span class="adm-avatar is-lg" aria-hidden="true">' + initial(d.name || d.handle) + '</span><div><h2 id="adm-drawer-title">' + esc(d.name || d.handle) + '</h2><small>@' + esc(d.handle) + ' · L' + num(d.level) + ' · ' + label(USER_STATUS, d.status) + '</small></div></div>';
    var stats = '<div class="adm-drawer-stats">' + drawerStat('贡献', d.contribution) + drawerStat('积分', d.points) + drawerStat('竹子', d.bamboo) + drawerStat('邀请', { value: (d.invitees || {}).total, status: 'ok' }) + '</div>';
    var body = flow ? userFlow(d, flow) : '<div class="adm-drawer-tabs" role="tablist">' + tabs.map(function (t) {
      return '<button type="button" role="tab" data-adm="drawer-tab" data-value="' + esc(t[0]) + '" aria-selected="' + (tab === t[0] ? 'true' : 'false') + '">' + esc(t[1]) + '</button>';
    }).join('') + '</div><div class="adm-drawer-section" role="tabpanel">' + userTab(d, tab) + '</div>';
    var suspended = d.status === 'suspended';
    var actions = flow ? '' : '<footer class="adm-drawer-actions">' + ['mute', suspended ? 'unban' : 'ban', 'role', 'level', 'adjust'].map(function (k) {
      var a = USER_ACTIONS[k];
      return '<button class="button small' + (a.danger ? ' danger' : '') + '" type="button" data-adm="user-action" data-value="' + esc(k) + '">' + esc(a.label) + '</button>';
    }).join('') + '</footer>';
    return drawerFrame('', headHtml + stats, body, actions);
  }

  /* safe-slot: headHtml, body, foot — 本文件视图函数拼好的 HTML */
  function drawerFrame(title, headHtml, body, foot) {
    return '<aside class="adm-drawer" role="dialog" aria-modal="false" aria-labelledby="adm-drawer-title" tabindex="-1" data-adm-drawer><header class="adm-drawer-head">' + (headHtml || '<h2 id="adm-drawer-title">' + esc(title) + '</h2>') + '<button class="button ghost small icon-only adm-drawer-close" type="button" data-adm="drawer-close" aria-label="关闭">' + icon('close') + '</button></header><div class="adm-drawer-scroll">' + body + '</div>' + (foot || '') + '</aside>';
  }

  function drawer() {
    if (!state.drawer) return '';
    var inner = state.drawer.kind === 'param' ? paramDrawer() : userDrawer();
    return '<div class="adm-drawer-layer' + (state.drawer.enter ? ' is-enter' : '') + '"><button class="adm-drawer-scrim" type="button" data-adm="drawer-close" aria-label="关闭详情" tabindex="-1"></button>' + inner + '</div>';
  }

  /* ------------------------------------------------------------------ 操作流程（页内二次确认 + 必填理由） */

  function field(name, labelText, inner, hint) {
    return '<label class="field adm-field"><span>' + esc(labelText) + '</span>' + /* safe: 输入控件由本文件生成 */ inner + (hint ? '<small>' + esc(hint) + '</small>' : '') + '</label>';
  }
  function val(flow, name, fallback) { var v = flow.values[name]; return v == null ? (fallback == null ? '' : fallback) : v; }
  function input(flow, name, attrs) { return '<input data-adm-focus="flow-' + esc(name) + '" data-adm-flow="' + esc(name) + '" name="' + esc(name) + '" value="' + esc(val(flow, name)) + '" ' + /* safe: 属性串为本文件常量 */ (attrs || '') + '>'; }
  function reasonField(flow) { return field('reason', '理由（必填，进审计）', '<textarea data-adm-focus="flow-reason" data-adm-flow="reason" name="reason" rows="3" maxlength="500" required placeholder="写清楚为什么">' + esc(val(flow, 'reason')) + '</textarea>'); }

  function totpField(flow, high) {
    if (!high) return '';
    if (live()) {
      var ok = state.viewer && state.viewer.totp_enabled;
      return '<div class="adm-totp' + (ok ? ' is-ok' : ' is-blocked') + '">' + icon(ok ? 'check' : 'lock') + '<span>' + (ok ? '高危操作 · 已开启两步验证' : '高危操作需要先开启两步验证') + '</span>' + (ok ? '' : '<a class="button tonal small" href="#/account">去开启</a>') + '</div>';
    }
    return field('totp', '两步验证码（高危操作）', input(flow, 'totp', 'inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="6 位数字"'), '示例里任意 6 位数字即可');
  }

  function flowButtons(flow, nextLabel, danger, disabled) {
    if (flow.step === 'done') return '<div class="adm-flow-actions"><button class="button primary" type="button" data-adm="flow-close">完成</button></div>';
    if (flow.step === 'form') return '<div class="adm-flow-actions"><button class="button ghost" type="button" data-adm="flow-close">取消</button><button class="button primary" type="submit">' + esc(nextLabel || '下一步') + '</button></div>';
    var busy = flow.step === 'running';
    return '<div class="adm-flow-actions"><button class="button ghost" type="button" data-adm="flow-back"' + (busy ? ' disabled' : '') + '>返回修改</button><button class="button ' + (danger ? 'danger' : 'primary') + '" type="button" data-adm="flow-run"' + (busy || disabled ? ' disabled' : '') + (busy ? ' aria-busy="true"' : '') + '>' + (busy ? '<span class="button-spinner" aria-hidden="true"></span>正在执行' : '确认执行') + '</button></div>';
  }

  function flowError(flow) { return flow.error ? '<p class="adm-flow-error" role="alert">' + esc(flow.error) + '</p>' : ''; }

  function summary(rows) {
    return '<dl class="adm-summary">' + rows.map(function (r) { return '<div><dt>' + esc(r[0]) + '</dt><dd>' + /* safe: 调用方已转义 */ r[1] + '</dd></div>'; }).join('') + '</dl>';
  }

  function userChange(d, flow) {
    var k = flow.action, v = flow.values;
    if (k === 'mute') return '禁言 ' + num(Number(v.days || 3)) + ' 天';
    if (k === 'ban') return '封禁账号 ' + num(Number(v.days || 30)) + ' 天';
    if (k === 'unban') return '解除封禁';
    if (k === 'role') return (v.grant === 'false' ? '撤销' : '任命') + label(ROLE, v.role || 'governor');
    if (k === 'level') return 'L' + num(d.level) + ' → L' + num(Number(v.level || d.level));
    if (k === 'adjust') return '竹子 ' + signed(Number(v.amount || 0));
    return '';
  }

  function userFlow(d, flow) {
    var a = USER_ACTIONS[flow.action];
    var blocked = live() && a.high && !(state.viewer && state.viewer.totp_enabled);
    if (flow.step !== 'form') {
      var target = live() ? (a.endpoint ? 'POST /api' + a.endpoint + ' · 审计' : '') : '示例，不写入服务器';
      return '<div class="adm-flow is-confirm"><h3>' + (flow.step === 'done' ? icon('check') + '已执行' : '确认' + esc(a.label)) + '</h3>' +
        summary([['对象', esc(d.name || d.handle) + ' <span class="adm-faint">@' + esc(d.handle) + '</span>'], ['操作', esc(a.label)], ['变更', userChange(d, flow)], ['理由', esc(val(flow, 'reason'))], ['写入', esc(target)]]) +
        (a.high && flow.step === 'confirm' ? '<p class="adm-flow-warn">' + icon('alert') + '高危操作，执行后立刻生效并写入审计。</p>' : '') + flowError(flow) + flowButtons(flow, '', a.danger, blocked) + '</div>';
    }
    var fields = '';
    if (flow.action === 'mute' || flow.action === 'ban') fields = field('days', flow.action === 'mute' ? '禁言天数' : '封禁天数', input(flow, 'days', 'type="number" min="1" max="365" required'));
    if (flow.action === 'role') {
      fields = field('role', '角色', '<select data-adm-flow="role" name="role">' + Object.keys(ROLE).map(function (r) { return '<option value="' + esc(r) + '"' + (val(flow, 'role', 'governor') === r ? ' selected' : '') + '>' + esc(ROLE[r]) + '</option>'; }).join('') + '</select>') +
        field('grant', '动作', '<select data-adm-flow="grant" name="grant"><option value="true"' + (val(flow, 'grant', 'true') === 'true' ? ' selected' : '') + '>任命</option><option value="false"' + (val(flow, 'grant') === 'false' ? ' selected' : '') + '>撤销</option></select>');
    }
    if (flow.action === 'level') {
      fields = field('level', '新等级', '<select data-adm-flow="level" name="level">' + [1, 2, 3, 4, 5].map(function (l) { return '<option value="' + l + '"' + (String(val(flow, 'level', d.level)) === String(l) ? ' selected' : '') + '>L' + l + '</option>'; }).join('') + '</select>') +
        (String(val(flow, 'level', d.level)) === '5' ? field('committee_ref', 'L5 决议编号', input(flow, 'committee_ref', 'maxlength="64" required')) : '');
    }
    if (flow.action === 'adjust') fields = field('amount', '调整竹子（负数为扣减）', input(flow, 'amount', 'type="number" min="-100000" max="100000" step="1" required'), '当前余额 ' + (d.bamboo && d.bamboo.value != null ? d.bamboo.value : '—'));
    return '<form class="adm-flow" data-adm-form="flow"><h3>' + esc(a.label) + ' · ' + esc(d.name || d.handle) + '</h3>' + fields + reasonField(flow) + totpField(flow, a.high) + flowError(flow) + flowButtons(flow, '核对') + '</form>';
  }

  function validateUserFlow(d, flow) {
    var v = flow.values;
    if (!v.reason || String(v.reason).trim().length < 2) return '请写理由，至少 2 个字';
    if ((flow.action === 'mute' || flow.action === 'ban') && !(Number(v.days) >= 1 && Number(v.days) <= 365)) return '处置天数在 1 到 365 之间';
    if (flow.action === 'adjust' && (!Number(v.amount) || Math.abs(Number(v.amount)) > 100000)) return '调整数量不能为 0，且不超过 100,000';
    if (flow.action === 'level' && String(v.level || d.level) === '5' && !v.committee_ref) return 'L5 任命必须填写决议编号';
    if (flow.action === 'level' && String(v.level || d.level) === String(d.level)) return '新等级与当前等级相同';
    if (!live() && USER_ACTIONS[flow.action].high && !/^\d{6}$/.test(String(v.totp || ''))) return '请输入 6 位两步验证码';
    return '';
  }

  function runUserFlow(d, flow) {
    var a = USER_ACTIONS[flow.action], v = flow.values, reason = String(v.reason).trim();
    if (!live()) {
      var row = demo().users.filter(function (u) { return u.id === d.id; })[0];
      var detail = demo().detail[d.id] || (demo().detail[d.id] = { recent: [], sanctions: [] });
      detail.sanctions = detail.sanctions || [];
      if (flow.action === 'ban') { row.status = 'suspended'; detail.sanctions.unshift({ id: 'demo-' + Date.now(), action_type: 'ban', state: 'executed', reason: reason, created_at: new Date(nowMs()).toISOString() }); }
      if (flow.action === 'unban') row.status = 'active';
      if (flow.action === 'mute') detail.sanctions.unshift({ id: 'demo-' + Date.now(), action_type: 'mute', state: 'executed', reason: reason, created_at: new Date(nowMs()).toISOString(), expires_at: new Date(nowMs() + Number(v.days || 3) * 86400000).toISOString() });
      if (flow.action === 'role') { var role = v.role || 'governor'; row.roles = row.roles.filter(function (r) { return r !== role; }); if (v.grant !== 'false') row.roles.push(role); }
      if (flow.action === 'level') row.level = Number(v.level || row.level);
      if (flow.action === 'adjust') row.bamboo = Math.max(0, row.bamboo + Number(v.amount));
      demo().audit.unshift({ id: 'demo-' + Date.now(), occurred_at: new Date(nowMs()).toISOString(), actor: { handle: demo().viewer.handle, name: demo().viewer.display_name }, action: a.audit || 'admin.user.' + flow.action, target_type: 'principal', target_id: d.id, outcome: 'ok', request_id: null });
      return Promise.resolve();
    }
    if (flow.action === 'mute' || flow.action === 'ban' || flow.action === 'unban') {
      return apiPost(a.endpoint, {
        action: flow.action,
        principal_id: d.id,
        reason: reason,
        duration_hours: (flow.action === 'unban' ? 1 : Number(v.days || 1) * 24)
      });
    }
    var note = apiPost('/admin/admin/reasons', { action: a.audit, target_type: 'principal', target_id: d.id, reason: reason, summary: userChange(d, flow).replace(/<[^>]+>/g, '') });
    return note.then(function () {
      if (flow.action === 'role') return apiPost(a.endpoint, { handle: d.handle, role: v.role || 'governor', grant: v.grant !== 'false', space_id: null });
      if (flow.action === 'level') return apiPost(a.endpoint, { handle: d.handle, level: Number(v.level || d.level), reason_code: 'correction', committee_ref: v.committee_ref || null });
      return apiPost(a.endpoint, { principal_id: d.id, currency: 'bamboo', amount: Number(v.amount), reason_code: 'admin_adjust', ref: null });
    });
  }

  /* ------------------------------------------------------------------ 统一审核队列 */

  function queueEntry(status) {
    if (!live()) {
      var q = demo().queue;
      return { status: 'ok', data: { items: q.items.filter(function (i) { return status === 'done' ? i.status === 'dismissed' || i.status === 'actioned' : i.status === 'open' || i.status === 'triaged'; }), sources: q.sources } };
    }
    return use('queue:' + status, '/admin/admin/queue', { status: status });
  }

  function queueTitle(item) {
    var cat = CATEGORY[item.category] || '其他事项';
    var t = item.target || {};
    var sub = '';
    if (item.source === 'economy') sub = num(t.amount) + ' 竹子' + (t.peer_id ? ' · 涉及另一成员' : '') + (t.day ? ' · ' + esc(t.day) : '');
    else if (item.source === 'campaign') sub = '活动 ' + esc(t.id || '—');
    else sub = knownLabel(OBJECT_TYPE, t.object_type, '对象') + ' · <code>' + esc(String(t.id || '').slice(0, 10)) + '</code>';
    return '<b>' + esc(cat) + '</b><small>' + sub + '</small>';
  }

  function deadline(item) {
    if (!item.due_at) return '<span class="adm-faint">—</span>';
    var diff = Date.parse(item.due_at) - nowMs();
    if (diff < 0) return '<span class="adm-due is-over">超时 ' + span(diff) + '</span>';
    return '<span class="adm-due' + (diff < 3600000 ? ' is-soon' : '') + '">剩 ' + span(diff) + '</span>';
  }

  function queueFilters(scope) {
    var defaults = { review: ['governance', 'content_report'], reports: [], anomaly: ['economy'] };
    var f = state.filters[scope] || (state.filters[scope] = { source: '', status: 'active' });
    f.allowed = defaults[scope];
    return f;
  }

  function queuePage(scope) {
    var f = queueFilters(scope);
    var entry = queueEntry(f.status);
    var title = scope === 'review' ? '内容与审核' : '举报与治理';
    if (entry.status !== 'ok') return head(title, '') + stateBlock(entry);
    var all = (entry.data.items || []).filter(function (i) { return !f.allowed.length || f.allowed.indexOf(i.source) >= 0; });
    var overdue = all.filter(function (i) { return i.overdue; }).length;
    var sub = num(all.length) + ' 项' + (f.status === 'active' ? '待处理' : '已处理') + (overdue ? ' · <span class="adm-text-danger">超时 ' + num(overdue) + ' 项</span>' : '');
    var actions = scope === 'reports' ? '<div class="adm-head-actions"><a class="button small" href="#/govern">' + icon('external') + '打开治理台</a></div>' : '';
    return head(title, sub, actions) + queueBlock(scope, entry, f);
  }

  function queueBlock(scope, entry, f) {
    var sources = (entry.data.sources || []).filter(function (s) { return !f.allowed.length || f.allowed.indexOf(s.key) >= 0; });
    var base = (entry.data.items || []).filter(function (i) { return !f.allowed.length || f.allowed.indexOf(i.source) >= 0; });
    var items = base.filter(function (i) { return !f.source || i.source === f.source; });
    var chips = '<div class="adm-chips" role="group" aria-label="来源"><button class="chip" type="button" data-adm="queue-source" data-scope="' + esc(scope) + '" data-value="" aria-pressed="' + (!f.source ? 'true' : 'false') + '">全部 <b>' + num(base.length) + '</b></button>' + (sources.length > 1 ? sources.map(function (s) {
      var n = base.filter(function (i) { return i.source === s.key; }).length;
      var off = s.status !== 'ok';
      return '<button class="chip' + (off ? ' is-off' : '') + '" type="button" data-adm="queue-source" data-scope="' + esc(scope) + '" data-value="' + esc(s.key) + '" aria-pressed="' + (f.source === s.key ? 'true' : 'false') + '"' + (off ? ' disabled' : '') + '>' + esc(s.label) + ' <b>' + (off ? '未接' : num(n)) + '</b></button>';
    }).join('') : '') + '</div>';
    var status = '<div class="segmented adm-seg" role="group" aria-label="处理状态"><button type="button" data-adm="queue-status" data-scope="' + esc(scope) + '" data-value="active" aria-pressed="' + (f.status === 'active' ? 'true' : 'false') + '">待处理</button><button type="button" data-adm="queue-status" data-scope="' + esc(scope) + '" data-value="done" aria-pressed="' + (f.status === 'done' ? 'true' : 'false') + '">已处理</button></div>';
    var sel = state.selection[scope] || (state.selection[scope] = {});
    var selected = items.filter(function (i) { return sel[i.id]; });
    var allOn = items.length && selected.length === items.length;
    var cols = [
      { head: '<input type="checkbox" data-adm-change="queue-all" data-scope="' + esc(scope) + '" aria-label="全选"' + (allOn ? ' checked' : '') + '>', cls: 'check', render: function (i) { return '<input type="checkbox" data-adm-change="queue-pick" data-scope="' + esc(scope) + '" data-id="' + esc(i.id) + '" aria-label="选择这一项"' + (sel[i.id] ? ' checked' : '') + '>'; } },
      { label: '来源', render: function (i) { return '<span class="adm-source is-' + esc(i.source) + '">' + label(SOURCE, i.source) + '</span>' + (i.writeback ? '' : '<small class="adm-faint">只读</small>'); } },
      { label: '事项', cls: 'main', render: queueTitle },
      { label: '涉及成员', render: function (i) { return i.subject ? '<button class="adm-link" type="button" data-adm="open-user" data-id="' + esc(i.subject.id) + '">' + esc(i.subject.name || i.subject.handle) + '</button><small class="adm-faint">@' + esc(i.subject.handle || '') + '</small>' : '<span class="adm-faint">—</span>'; } },
      { label: '风险', render: function (i) { return riskPill(i.risk); } },
      { label: '举报', cls: 'num', render: function (i) { return i.reports ? num(i.reports) : '<span class="adm-faint">—</span>'; } },
      { label: f.status === 'active' ? '期限' : '结果', render: function (i) { return f.status === 'active' ? deadline(i) : label(CASE_STATUS, i.status); } }
    ];
    return '<div class="adm-toolbar">' + chips + status + '</div>' + batchBar(scope, selected) +
      table(cols, items, { empty: f.status === 'active' ? '队列已清空' : '还没有已处理的事项', rowAttrs: function (i) { return sel[i.id] ? ' class="is-selected"' : ''; } });
  }

  function batchBar(scope, selected) {
    var flow = state.flow && state.flow.kind === 'batch' && state.flow.scope === scope ? state.flow : null;
    if (!selected.length && !flow) return '';
    if (flow) return batchFlow(flow);
    var writable = selected.filter(function (i) { return i.writeback; }).length;
    return '<div class="adm-batch" role="region" aria-label="批量处理"><span>已选 <b>' + num(selected.length) + '</b> 项' + (writable < selected.length ? ' · <span class="adm-faint">' + num(selected.length - writable) + ' 项只读</span>' : '') + '</span><div>' + Object.keys(BATCH).map(function (k) {
      return '<button class="button small' + (k === 'hide' ? ' danger' : '') + '" type="button" data-adm="batch" data-scope="' + esc(scope) + '" data-value="' + esc(k) + '">' + esc(BATCH[k].label) + '</button>';
    }).join('') + '<button class="button ghost small" type="button" data-adm="batch-clear" data-scope="' + esc(scope) + '">清除选择</button></div></div>';
  }

  function queueWrite(item, action, reason) {
    if (!item.writeback) return null;
    if (item.origin === 'market.report') {
      if (['resolve', 'dismiss', 'hide', 'pending_review'].indexOf(action) < 0) return null;
      return {
        path: item.writeback.dismiss,
        body: { reason: reason, disposition: action === 'hide' ? 'hide' : action === 'pending_review' ? 'pending_review' : 'close' }
      };
    }
    if (item.source === 'economy' || item.source === 'campaign') {
      if (action !== 'resolve' && action !== 'dismiss') return null;
      return { path: item.writeback.dismiss, body: { reason: reason, outcome: action === 'dismiss' ? 'dismissed' : 'resolved' } };
    }
    if (action === 'resolve') return null;
    var spec = BATCH[action];
    return spec && item.writeback[spec.path] ? { path: item.writeback[spec.path], body: spec.body(reason) } : null;
  }

  function batchFlow(flow) {
    var b = BATCH[flow.action];
    var items = flow.items;
    var supported = items.filter(function (i) { return queueWrite(i, flow.action, String(val(flow, 'reason'))); });
    if (flow.step === 'form') {
      return '<form class="adm-flow adm-batch-flow" data-adm-form="flow"><h3>' + esc(b.label) + ' · ' + num(items.length) + ' 项</h3>' + reasonField(flow) + flowError(flow) + flowButtons(flow, '核对') + '</form>';
    }
    var results = flow.results ? '<ul class="adm-results">' + items.map(function (i) {
      var r = flow.results[i.id] || {};
      return '<li class="is-' + esc(r.state || 'wait') + '"><span>' + (r.state === 'ok' ? icon('check') : r.state === 'missing' ? icon('plug') : r.state === 'fail' ? icon('alert') : '') + '</span><b>' + esc(CATEGORY[i.category] || i.category) + '</b><small>' + label(SOURCE, i.source) + '</small><em>' + esc(r.text || '等待') + '</em></li>';
    }).join('') + '</ul>' : '';
    return '<div class="adm-flow adm-batch-flow is-confirm"><h3>' + (flow.step === 'done' ? icon('check') + '处理完成' : '确认' + esc(b.label)) + '</h3>' +
      summary([['数量', num(items.length) + ' 项'], ['可处理', num(supported.length) + ' 项'], ['不支持', num(items.length - supported.length) + ' 项'], ['理由', esc(val(flow, 'reason'))]]) +
      results + flowError(flow) + flowButtons(flow, '', flow.action === 'hide', !supported.length) + '</div>';
  }

  function runBatch(flow) {
    var reason = String(flow.values.reason).trim();
    var b = BATCH[flow.action];
    flow.results = {};
    var chain = Promise.resolve();
    flow.items.forEach(function (item) {
      chain = chain.then(function () {
        var write = queueWrite(item, flow.action, reason);
        if (!write) { flow.results[item.id] = { state: 'missing', text: '来源不支持' + b.label }; paint(); return null; }
        if (!live()) {
          demo().queue.items.forEach(function (q) { if (q.id === item.id) q.status = flow.action === 'dismiss' ? 'dismissed' : 'actioned'; });
          flow.results[item.id] = { state: 'ok', text: '已回写（示例）' }; paint(); return null;
        }
        var path = write.path.replace(/^\/api/, '');
        return apiPost(path, write.body).then(function () {
          flow.results[item.id] = { state: 'ok', text: '已回写' }; paint();
        }).catch(function (error) {
          flow.results[item.id] = { state: 'fail', text: error.status === 404 ? '没有治理员权限或事项已变化' : error.message || '失败' }; paint();
        });
      });
    });
    return chain.then(function () {
      state.selection[flow.scope] = {};
      if (live()) invalidate('queue:');
    });
  }

  /* ------------------------------------------------------------------ 社区运营 */

  function opsView() {
    var nav = navItem('ops'), tab = state.route.tab, d = demo().ops, body = '';
    if (tab === 'announce' || tab === 'marquee' || tab === 'ads') {
      if (window.CommonsAnnounce && window.CommonsAnnounce.adminPanel) body = '<div class="adm-embed" data-announce-admin-host></div>';
      else if (live()) body = missingBlock('announce');
      else if (tab === 'announce') body = table([
        { label: '公告', cls: 'main', render: function (r) { return '<b>' + esc(r.title) + '</b>'; } },
        { label: '位置', render: function (r) { return esc(r.scope); } },
        { label: '状态', render: function (r) { return pill(r.status === 'live' ? '进行中' : r.status === 'scheduled' ? '已排期' : '已结束', r.status === 'live' ? 'good' : r.status === 'scheduled' ? 'info' : 'muted'); } },
        { label: '开始', render: function (r) { return stamp(r.starts_at); } },
        { label: '结束', render: function (r) { return stamp(r.ends_at); } }
      ], d.announcements);
      else if (tab === 'marquee') body = table([
        { label: '短讯', cls: 'main', render: function (r) { return '<b>' + esc(r.text) + '</b>'; } },
        { label: '来源', render: function (r) { return esc(r.source); } },
        { label: '状态', render: function (r) { return pill(r.status === 'live' ? '滚动中' : '排队', r.status === 'live' ? 'good' : 'muted'); } }
      ], d.marquee);
      else body = '<p class="adm-rule">' + icon('alert') + '一屏最多一个广告位，阅读、写作、讲堂回看和考试中不投放。</p>' + table([
        { label: '位置', cls: 'main', render: function (r) { return '<b>' + esc(r.slot) + '</b><small>' + esc(r.sponsor) + '</small>'; } },
        { label: '时间', render: function (r) { return esc(r.window); } },
        { label: '频控', render: function (r) { return esc(r.cap); } },
        { label: '曝光', cls: 'num', render: function (r) { return num(r.impressions); } },
        { label: '状态', render: function (r) { return pill(r.status === 'live' ? '投放中' : '已排期', r.status === 'live' ? 'good' : 'info'); } }
      ], d.ads);
    } else if (tab === 'events' || tab === 'campaigns') {
      var entry = live() ? use('ops:' + tab, tab === 'events' ? '/events' : '/events/campaigns') : { status: 'ok', data: tab === 'events' ? d.events : d.campaigns };
      var statusTone = function (s) { return s === 'live' ? 'good' : s === 'upcoming' ? 'info' : 'muted'; };
      var statusText = function (s) { return s === 'live' ? '进行中' : s === 'upcoming' ? '即将开始' : '已结束'; };
      body = entry.status !== 'ok' ? stateBlock(entry) : tab === 'events' ? table([
        { label: '活动', cls: 'main', render: function (r) { return '<b>' + esc(r.title) + '</b><small>' + esc(r.kind_label || EVENT_KIND[r.kind] || '其他活动') + '</small>'; } },
        { label: '状态', render: function (r) { return pill(statusText(r.status), statusTone(r.status)); } },
        { label: '报名', cls: 'num', render: function (r) { return num(r.signups); } },
        { label: '作品', cls: 'num', render: function (r) { return num(r.submissions); } },
        { label: '结束', render: function (r) { return r.ends_at ? rel(r.ends_at) : '<span class="adm-faint">—</span>'; } }
      ], entry.data, { empty: '还没有活动' }) : table([
        { label: '打榜', cls: 'main', render: function (r) { return '<b>' + esc(r.title) + '</b>'; } },
        { label: '状态', render: function (r) { return pill(statusText(r.status), statusTone(r.status)); } },
        { label: '候选', cls: 'num', render: function (r) { return num(r.candidates != null ? r.candidates : r.submissions); } },
        { label: '票数', cls: 'num', render: function (r) { return num(r.votes); } },
        { label: '异常', cls: 'num', render: function (r) { return r.anomalies ? '<a class="adm-text-danger" href="#/admin/reports?source=campaign">' + num(r.anomalies) + '</a>' : '<span class="adm-faint">0</span>'; } }
      ], entry.data, { empty: '还没有打榜' });
    } else {
      body = live() ? missingBlock('groups') : table([
        { label: '小组', cls: 'main', render: function (r) { return '<b>' + esc(r.name) + '</b><small>' + esc(r.status) + '</small>'; } },
        { label: '成员', cls: 'num', render: function (r) { return num(r.members); } },
        { label: '本周发帖', cls: 'num', render: function (r) { return num(r.weekly_posts); } },
        { label: '入组申请', cls: 'num', render: function (r) { return r.pending ? '<b class="adm-text-accent">' + num(r.pending) + '</b>' : '<span class="adm-faint">0</span>'; } }
      ], d.groups);
    }
    return head('社区运营', '') + tabsBar(nav, tab) + body;
  }

  /* ------------------------------------------------------------------ 经济 */

  function economyView() {
    var nav = navItem('economy'), tab = state.route.tab, e = demo().economy, body = '';
    if (tab === 'bamboo') {
      var sumEntry = live() ? use('economy:summary', '/admin/economy/summary') : { status: 'ok', data: { granted: e.bamboo.issued, spent: e.bamboo.spent, net: e.bamboo.net, reasons: e.bamboo.reasons } };
      if (sumEntry.status !== 'ok') body = stateBlock(sumEntry);
      else {
        var b = sumEntry.data || {};
        var reasons = table([
        { label: '来由', cls: 'main', render: function (r) { return '<b><code>' + esc(r.reason) + '</code></b>'; } },
        { label: '发放', cls: 'num', render: function (r) { return r.granted || r.issued ? num(r.granted != null ? r.granted : r.issued) : '<span class="adm-faint">0</span>'; } },
        { label: '花费', cls: 'num', render: function (r) { return r.spent ? num(r.spent) : '<span class="adm-faint">0</span>'; } },
        { label: '流水', cls: 'num', render: function (r) { return num(r.entries); } },
        { label: '人数', cls: 'num', render: function (r) { return num(r.members != null ? r.members : r.people); } }
      ], b.reasons || []);
        body = kpiRow([['发放', num(b.granted)], ['花费', num(b.spent)], ['净流通', signed(b.net)], ['币种', esc(b.currency || 'bamboo')]]) +
          '<div class="adm-split">' + card('按来由', '', reasons) + card('调账', '', '<p class="adm-card-line">从成员详情发起并填写理由。</p><a class="button small" href="#/admin/users">去找成员</a>', 'is-narrow') + '</div>';
      }
    } else if (tab === 'points') {
      var pointsEntry = live() ? use('bounty:credits', '/admin/bounty/credits') : { status: 'ok', data: { summary: { available: e.points.circulating, held: e.points.held, members: 3 }, items: e.points.rows } };
      if (pointsEntry.status !== 'ok') body = stateBlock(pointsEntry);
      else { var points = pointsEntry.data || {}, ps = points.summary || {}; body = kpiRow([['可用积分', num(ps.available)], ['悬赏冻结', num(ps.held)], ['成员', num(ps.members)]]) + card('最近变动', '', table([
        { label: '成员', cls: 'main', render: function (r) { return person({ handle: r.handle, name: r.display_name || r.name }); } },
        { label: '类型', render: function (r) { return esc(r.kind); } },
        { label: '数量', cls: 'num', render: function (r) { return signed(r.amount); } },
        { label: '时间', render: function (r) { return rel(r.created_at || r.at); } }
      ], points.items || [])); }
    } else if (tab === 'shop') {
      var entry = live() ? use('economy:shop', '/economy/shop') : { status: 'ok', data: e.shop };
      body = entry.status !== 'ok' ? stateBlock(entry) : table([
        { label: '商品', cls: 'main', render: function (r) { return '<b>' + esc(r.name) + '</b><small>' + esc(r.category_label || MARKET_CATEGORY[r.category] || '其他分类') + '</small>'; } },
        { label: '价格', cls: 'num', render: function (r) { return num(r.price); } },
        { label: '限量', cls: 'num', render: function (r) { return r.limited ? num(r.limited) : '<span class="adm-faint">不限</span>'; } },
        { label: '已售', cls: 'num', render: function (r) { return r.sold != null ? num(r.sold) : r.limited ? num(r.limited - (r.remaining || 0)) : '<span class="adm-faint">—</span>'; } },
        { label: '状态', render: function (r) { var out = r.limited && (r.sold >= r.limited || r.remaining === 0); return pill(out ? '售罄' : r.active === false ? '已下架' : '在售', out || r.active === false ? 'muted' : 'good'); } }
      ], entry.data, { empty: '商店还没有商品' });
    } else {
      var f = queueFilters('anomaly');
      var q = queueEntry(f.status);
      body = q.status === 'ok' ? queueBlock('anomaly', q, f) : stateBlock(q);
    }
    return head('经济', '竹子、积分、贡献值互不兑换') + tabsBar(nav, tab) + body;
  }

  /* ------------------------------------------------------------------ 游戏与参数 */

  function gamesView() {
    var nav = navItem('games'), tab = state.route.tab, g = demo().games, body = '';
    if (tab === 'params') body = paramsBlock();
    else if (tab === 'farm') {
      var farmEntry = live() ? use('farm:stats', '/admin/farm/stats') : { status: 'ok', data: { summary: { members: g.farm.members, planted: g.farm.harvests, steals: g.farm.steals, helps: g.farm.blocked }, items: g.farm.steals_rows } };
      if (farmEntry.status !== 'ok') body = stateBlock(farmEntry);
      else { var farm = farmEntry.data || {}, fs = farm.summary || {}; body = kpiRow([['开通农场', num(fs.members)], ['已种植', num(fs.planted)], ['偷菜记录', num(fs.steals)], ['帮忙记录', num(fs.helps)]]) + card('农场成员', '', table([
        { label: '成员', cls: 'main', render: function (r) { return r.handle || r.display_name ? person({ handle: r.handle, name: r.display_name }) : '<b>' + esc(r.owner || r.thief) + '</b>'; } },
        { label: '地块', cls: 'num', render: function (r) { return num(r.plot_count); } },
        { label: '种植', cls: 'num', render: function (r) { return num(r.planted); } },
        { label: '被偷', cls: 'num', render: function (r) { return num(r.stolen); } }
      ], farm.items || [])); }
    } else if (tab === 'parking') {
      var parkingEntry = live() ? use('parking:stats', '/admin/parking/stats') : { status: 'ok', data: { summary: { lots: g.parking.owners, vehicles: g.parking.parked, active_stays: g.parking.income, tickets: g.parking.tickets }, items: g.parking.ticket_rows } };
      if (parkingEntry.status !== 'ok') body = stateBlock(parkingEntry);
      else { var parking = parkingEntry.data || {}, parkSum = parking.summary || {}; body = kpiRow([['车位', num(parkSum.lots)], ['车辆', num(parkSum.vehicles)], ['在停', num(parkSum.active_stays)], ['贴条', num(parkSum.tickets)]]) + card('停车记录', '', table([
        { label: '车位主人', cls: 'main', render: function (r) { return '<b>' + esc(r.lot_owner_name || r.owner || '车位成员') + '</b>'; } },
        { label: '停车人', render: function (r) { return esc(r.parker_name || r.parker || '停车成员'); } },
        { label: '收益', cls: 'num', render: function (r) { return num(r.gross_earned != null ? r.gross_earned : r.fine); } },
        { label: '时间', render: function (r) { return rel(r.created_at || r.at); } }
      ], parking.items || [])); }
    } else {
      var examEntry = live() ? use('games:questions', '/admin/games/questions') : { status: 'ok', data: g.exam };
      body = examEntry.status !== 'ok' ? stateBlock(examEntry) : table([
        { label: '题目', cls: 'main', render: function (r) { return '<b>' + esc(r.prompt) + '</b><small>' + esc(r.direction) + ' · ' + esc(r.kind) + ' · 来自' + esc(r.source) + '</small>'; } },
        { label: '状态', render: function (r) { var status = r.review_status || r.status; return pill(status === 'reviewed' ? '已审核' : '待审核', status === 'reviewed' ? 'good' : 'notice'); } },
        { label: '来源', render: function (r) { return esc(r.source || QUESTION_SOURCE[r.source_kind] || '其他来源'); } }
      ], examEntry.data || []);
    }
    return head('游戏', '') + tabsBar(nav, tab) + body;
  }

  function paramsEntry() { return live() ? use('params', '/admin/admin/params') : { status: 'ok', data: demo().params }; }

  function paramCards(rows) {
    if (!rows || !rows.length) return '<div class="adm-param-cards"><div class="adm-empty"><b>暂无记录</b></div></div>';
    return '<div class="adm-param-cards" role="list" aria-label="参数列表">' + rows.map(function (r) {
      return '<article class="adm-param-card" role="listitem"><div class="adm-param-card-head"><div><strong>' + esc(r.label) + '</strong><small class="adm-param-key">' + esc(r.namespace + '.' + r.key) + '</small></div>' +
        (r.risk === 'high' ? '<span class="adm-tag is-danger">高风险</span>' : '<span class="adm-tag">常规</span>') + '</div>' +
        '<div class="adm-param-card-value"><span>当前值</span><strong>' + num(r.effective_value) + '</strong><small>' + esc(r.unit) + '</small></div>' +
        '<div class="adm-param-card-meta"><span>范围 ' + num(r.min_value) + '–' + num(r.max_value) + '</span><span>v' + num(r.version) + '</span></div>' +
        '<button class="button tonal adm-param-card-edit" type="button" data-adm="open-param" data-ns="' + esc(r.namespace) + '" data-key="' + esc(r.key) + '">编辑参数</button></article>';
    }).join('') + '</div>';
  }

  function paramsBlock() {
    var entry = paramsEntry();
    if (entry.status !== 'ok') return stateBlock(entry);
    var f = state.filters.params || (state.filters.params = { ns: '' });
    var rows = entry.data || [];
    var spaces = [];
    rows.forEach(function (r) { if (spaces.indexOf(r.namespace) < 0) spaces.push(r.namespace); });
    var shown = rows.filter(function (r) { return !f.ns || r.namespace === f.ns; });
    var chips = '<div class="adm-chips" role="group" aria-label="参数分组"><button class="chip" type="button" data-adm="param-ns" data-value="" aria-pressed="' + (!f.ns ? 'true' : 'false') + '">全部 <b>' + num(rows.length) + '</b></button>' + spaces.map(function (ns) {
      return '<button class="chip" type="button" data-adm="param-ns" data-value="' + esc(ns) + '" aria-pressed="' + (f.ns === ns ? 'true' : 'false') + '">' + knownLabel(NAMESPACE, ns, '其他模块') + ' <b>' + num(rows.filter(function (r) { return r.namespace === ns; }).length) + '</b></button>';
    }).join('') + '</div>';
    var cols = [
      { label: '参数', cls: 'main', render: function (r) { return '<button class="adm-row-open" type="button" data-adm="open-param" data-ns="' + esc(r.namespace) + '" data-key="' + esc(r.key) + '"><b>' + esc(r.label) + (r.risk === 'high' ? ' <span class="adm-tag is-danger">高风险</span>' : '') + '</b></button>'; } },
      { label: '当前值', cls: 'num', render: function (r) { return '<span class="adm-param-value">' + num(r.effective_value) + '</span><small class="adm-faint">' + esc(r.unit) + '</small>' + ((r.pending || []).length ? '<small class="adm-pending">' + rel(r.pending[0].effective_at) + '改为 ' + num(r.pending[0].value) + '</small>' : ''); } },
      { label: '范围', cls: 'num', render: function (r) { return '<span class="adm-range">' + num(r.min_value) + '–' + num(r.max_value) + '</span><small class="adm-faint">默认 ' + num(r.default_value) + '</small>'; } },
      { label: '版本', render: function (r) { return 'v' + num(r.version) + (r.handle ? '<small class="adm-faint">@' + esc(r.handle) + ' · ' + rel(r.updated_at) + '</small>' : '<small class="adm-faint">初始</small>'); } },
      { label: '接入', render: function (r) { return !r.module_loaded ? pill('模块未上线', 'muted') : r.wired ? pill('已接入 · ' + (NAMESPACE[r.namespace] || '其他模块'), 'good') : pill('未接入', 'notice'); } }
    ];
    var desktopTable = table(cols, shown, {
      rowAttrs: function (r) { return ' data-adm="open-param" data-ns="' + esc(r.namespace) + '" data-key="' + esc(r.key) + '" class="is-clickable' + (state.drawer && state.drawer.kind === 'param' && state.drawer.ns === r.namespace && state.drawer.key === r.key ? ' is-selected' : '') + '"'; }
    });
    return '<div class="adm-toolbar">' + chips + '</div><div class="adm-param-table">' + desktopTable + '</div>' + paramCards(shown);
  }

  var IMPACT_DEMO = { economy: [1286, '最近 7 天有竹子流水的成员'], farm: [1032, '开通农场的成员'], parking: [874, '拥有车位的成员'], games: [688, '最近 7 天领过游戏奖励的成员'], events: [512, '最近 30 天投过票的成员'] };

  function previewFor(row, value) {
    if (value === '' || value == null || isNaN(Number(value))) return null;
    value = Number(value);
    if (live()) {
      var key = 'preview:' + row.namespace + '.' + row.key + ':' + value;
      if (!state.cache[key] && !state.timers.preview) {
        state.timers.preview = setTimeout(function () { state.timers.preview = null; use(key, '/admin/admin/params/' + encodeURIComponent(row.namespace) + '/' + encodeURIComponent(row.key) + '/preview', { value: value }, refreshPreview); }, 280);
      }
      var entry = state.cache[key];
      return entry && entry.status === 'ok' ? entry.data : entry && entry.status !== 'loading' ? { error: entry } : { loading: true };
    }
    var current = row.effective_value, delta = value - current, impact = IMPACT_DEMO[row.namespace] || [214, '最近 7 天活跃成员（模块未提供精确口径）'];
    return { current: current, proposed: value, delta: delta, delta_pct: current ? Math.round(delta * 1000 / current) / 10 : null, within_range: value >= row.min_value && value <= row.max_value, direction: delta > 0 ? 'loosen' : delta < 0 ? 'tighten' : 'same', affected: { count: impact[0], basis: impact[1] }, wired: row.wired, unit: row.unit, min_value: row.min_value, max_value: row.max_value };
  }

  function previewBox(row, p) {
    if (!p) return '<div class="adm-preview is-idle"><span>输入新值后预览影响</span></div>';
    if (p.loading) return '<div class="adm-preview is-idle" aria-busy="true"><span>正在估算影响…</span></div>';
    if (p.error) return '<div class="adm-preview">' + stateBlock(p.error) + '</div>';
    var dir = p.direction === 'loosen' ? '放宽' : p.direction === 'tighten' ? '收紧' : '不变';
    return '<div class="adm-preview' + (p.within_range ? '' : ' is-bad') + '" aria-live="polite"><div class="adm-preview-main"><strong>' + num(p.affected.count) + '</strong><span>人受影响<small>' + esc(p.affected.basis) + '</small></span></div>' +
      '<div class="adm-preview-meta"><span>' + num(p.current) + ' → <b>' + num(p.proposed) + '</b> ' + esc(row.unit) + '</span><span class="adm-delta is-' + (p.direction === 'same' ? 'flat' : 'flat') + '">' + esc(dir) + ' ' + signed(p.delta) + (p.delta_pct != null ? '（' + signed(p.delta_pct) + '%）' : '') + '</span></div>' +
      (p.within_range ? '' : '<p class="adm-flow-error">超出允许范围 ' + num(row.min_value) + '–' + num(row.max_value) + '，服务器会拒绝</p>') +
      (row.module_loaded && !row.wired ? '<p class="adm-flow-warn">' + icon('plug') + '模块还没读这张表，改了暂不生效</p>' : '') + '</div>';
  }

  function historyEntry(row) {
    if (!live()) return { status: 'ok', data: demo().history[row.namespace + '.' + row.key] || [{ version: row.version, value: row.value, kind: 'seed', reason: '初始值', effective_at: row.updated_at, created_at: row.updated_at }] };
    return use('history:' + row.namespace + '.' + row.key, '/admin/admin/params/' + encodeURIComponent(row.namespace) + '/' + encodeURIComponent(row.key) + '/history');
  }

  function paramDrawer() {
    var entry = paramsEntry();
    if (entry.status !== 'ok') return drawerFrame('参数', '', stateBlock(entry), '');
    var row = (entry.data || []).filter(function (r) { return r.namespace === state.drawer.ns && r.key === state.drawer.key; })[0];
    if (!row) return drawerFrame('参数', '', '<div class="adm-empty"><b>参数不存在</b></div>', '');
    var flow = state.flow && state.flow.kind === 'param' && state.flow.ns === row.namespace && state.flow.key === row.key ? state.flow : null;
    var headHtml = '<div><h2 id="adm-drawer-title">' + esc(row.label) + '</h2>' + (row.risk === 'high' ? '<small><span class="adm-tag is-danger">高风险</span></small>' : '') + '</div>';
    var current = '<div class="adm-param-now"><div><span>当前生效</span><strong>' + num(row.effective_value) + '</strong><em>' + esc(row.unit) + '</em></div>' +
      kv([['范围', num(row.min_value) + '–' + num(row.max_value)], ['默认', num(row.default_value)], ['版本', 'v' + num(row.version)], ['接入', !row.module_loaded ? '模块未上线' : row.wired ? '已接入 · ' + (NAMESPACE[row.namespace] || '其他模块') : '未接入']]) + '</div>' +
      ((row.pending || []).length ? '<p class="adm-pending-line">' + icon('history') + '定时生效：' + num(row.pending[0].value) + ' ' + esc(row.unit) + ' · ' + stamp(row.pending[0].effective_at) + '</p>' : '') + (row.description ? '<p class="adm-param-desc">' + esc(row.description) + '</p>' : '');
    var editor = flow ? paramFlow(row, flow) : '<div class="adm-flow-actions is-start"><button class="button primary" type="button" data-adm="param-edit">调整</button></div>';
    var hist = historyEntry(row);
    var histHtml = hist.status !== 'ok' ? stateBlock(hist) : '<ol class="adm-versions">' + (hist.data || []).map(function (h) {
      var canRollback = h.version !== row.version && h.value !== row.value && !flow;
      return '<li><span class="adm-version">v' + num(h.version) + '</span><div><b>' + (h.previous_value != null ? num(h.previous_value) + ' → ' : '') + num(h.value) + ' <small>' + esc(h.kind === 'rollback' ? '回滚到 v' + h.rollback_of : h.kind === 'seed' ? '初始' : '修改') + '</small></b><small>' + esc(h.reason) + '</small><small class="adm-faint">' + (h.actor_handle ? '@' + esc(h.actor_handle) + ' · ' : '') + stamp(h.created_at) + (Date.parse(h.effective_at) > nowMs() ? ' · ' + stamp(h.effective_at) + ' 生效' : '') + '</small></div>' +
        (canRollback ? '<button class="button ghost small" type="button" data-adm="param-rollback" data-value="' + esc(h.version) + '">回滚</button>' : '') + '</li>';
    }).join('') + '</ol>';
    return drawerFrame('', headHtml, current + editor + '<h3 class="adm-drawer-sub">' + icon('history') + '历史版本</h3>' + histHtml, '');
  }

  function paramFlow(row, flow) {
    if (flow.mode === 'rollback') {
      var target = flow.toVersion;
      if (flow.step === 'form') return '<form class="adm-flow" data-adm-form="flow"><h3>回滚到 v' + num(target) + '</h3>' + reasonField(flow) + totpField(flow, row.risk === 'high') + flowError(flow) + flowButtons(flow, '核对') + '</form>';
      return '<div class="adm-flow is-confirm"><h3>' + (flow.step === 'done' ? icon('check') + '已回滚' : '确认回滚') + '</h3>' + summary([['参数', esc(row.label)], ['回到', 'v' + num(target) + ' · ' + num(flow.toValue) + ' ' + esc(row.unit)], ['生效', '立即'], ['理由', esc(val(flow, 'reason'))]]) + flowError(flow) + flowButtons(flow, '', false, false) + '</div>';
    }
    var value = val(flow, 'value', row.value);
    var p = previewFor(row, value);
    if (flow.step === 'form') {
      var when = val(flow, 'when', 'now');
      return '<form class="adm-flow" data-adm-form="flow"><h3>调整' + esc(row.label) + '</h3>' +
        '<div class="adm-param-input">' + field('value', '新值（' + row.unit + '）', input(flow, 'value', 'type="number" step="1" required min="' + Number(row.min_value) + '" max="' + Number(row.max_value) + '"')) +
        '<input class="adm-range-input" type="range" data-adm-flow="value" min="' + Number(row.min_value) + '" max="' + Number(row.max_value) + '" step="1" value="' + esc(value) + '" aria-label="拖动调整"></div>' +
        '<div data-adm-preview>' + previewBox(row, p) + '</div>' +
        '<fieldset class="adm-when"><legend>生效时间</legend><div class="segmented adm-seg" role="group"><button type="button" data-adm="param-when" data-value="now" aria-pressed="' + (when === 'now' ? 'true' : 'false') + '">立即</button><button type="button" data-adm="param-when" data-value="later" aria-pressed="' + (when === 'later' ? 'true' : 'false') + '">定时</button></div>' +
        (when === 'later' ? input(flow, 'at', 'type="datetime-local" required aria-label="生效时间"') : '') + '</fieldset>' +
        reasonField(flow) + totpField(flow, row.risk === 'high') + flowError(flow) + flowButtons(flow, '核对') + '</form>';
    }
    var at = val(flow, 'when', 'now') === 'later' && flow.values.at ? stamp(new Date(flow.values.at).toISOString()) : '立即';
    return '<div class="adm-flow is-confirm"><h3>' + (flow.step === 'done' ? icon('check') + '已提交' : '确认调整') + '</h3>' +
      summary([['参数', esc(row.label)], ['变更', num(row.value) + ' → <b>' + num(Number(value)) + '</b> ' + esc(row.unit)], ['影响', p && p.affected ? '约 ' + num(p.affected.count) + ' 人 · ' + esc(p.affected.basis) : '—'], ['生效', esc(at)], ['理由', esc(val(flow, 'reason'))]]) +
      (row.risk === 'high' && flow.step === 'confirm' ? '<p class="adm-flow-warn">' + icon('alert') + '高风险参数，会改变竹子发放或收益。</p>' : '') + flowError(flow) + flowButtons(flow, '', row.risk === 'high', false) + '</div>';
  }

  function validateParamFlow(row, flow) {
    var v = flow.values;
    if (flow.mode !== 'rollback') {
      var n = Number(v.value);
      if (v.value === '' || v.value == null || !Number.isInteger(n)) return '请输入整数';
      if (n < row.min_value || n > row.max_value) return '超出允许范围 ' + row.min_value + '–' + row.max_value;
      if (n === row.value) return '新值与当前值相同';
      if (v.when === 'later') {
        var t = Date.parse(v.at || '');
        if (isNaN(t) || t < nowMs()) return '定时生效要晚于现在';
        if (t > nowMs() + 30 * 86400000) return '最多排到 30 天后';
      }
    }
    if (!v.reason || String(v.reason).trim().length < 2) return '请写理由，至少 2 个字';
    if (!live() && row.risk === 'high' && !/^\d{6}$/.test(String(v.totp || ''))) return '请输入 6 位两步验证码';
    if (live() && !(state.viewer && state.viewer.totp_enabled)) return '需要先开启两步验证';
    return '';
  }

  function runParamFlow(row, flow) {
    var v = flow.values, reason = String(v.reason).trim();
    var base = '/admin/admin/params/' + encodeURIComponent(row.namespace) + '/' + encodeURIComponent(row.key);
    if (!live()) {
      var target = demo().params.filter(function (r) { return r.namespace === row.namespace && r.key === row.key; })[0];
      var hist = demo().history[row.namespace + '.' + row.key] || (demo().history[row.namespace + '.' + row.key] = [{ version: 1, value: row.default_value, previous_value: null, kind: 'seed', reason: '初始值', effective_at: row.updated_at, created_at: row.updated_at }]);
      var now = new Date(nowMs()).toISOString();
      var next = flow.mode === 'rollback' ? flow.toValue : Number(v.value);
      var at = flow.mode !== 'rollback' && v.when === 'later' ? new Date(v.at).toISOString() : now;
      hist.unshift({ version: target.version + 1, value: next, previous_value: target.value, kind: flow.mode === 'rollback' ? 'rollback' : 'set', rollback_of: flow.toVersion, effective_at: at, reason: reason, actor_handle: demo().viewer.handle, created_at: now });
      target.version += 1; target.value = next; target.handle = demo().viewer.handle; target.updated_at = now;
      if (Date.parse(at) <= nowMs()) { target.effective_value = next; target.pending = []; } else target.pending = [{ version: target.version, value: next, effective_at: at }];
      demo().audit.unshift({ id: 'demo-' + Date.now(), occurred_at: now, actor: { handle: demo().viewer.handle, name: demo().viewer.display_name }, action: flow.mode === 'rollback' ? 'admin_param.rollback' : 'admin_param.set', target_type: 'admin_param', target_id: row.namespace + '.' + row.key, outcome: 'ok', request_id: null });
      return Promise.resolve();
    }
    var call = flow.mode === 'rollback'
      ? apiPost(base + '/rollback', { to_version: flow.toVersion, reason: reason, expected_version: row.version })
      : apiPost(base, { value: Number(v.value), reason: reason, expected_version: row.version, effective_at: v.when === 'later' && v.at ? new Date(v.at).toISOString() : null });
    return call.then(function () { invalidate('params'); invalidate('history:' + row.namespace + '.' + row.key); invalidate('preview:'); });
  }

  /* ------------------------------------------------------------------ 市集、Agent、商业 */

  function marketView() {
    var m = demo().market;
    var queueLink = '<a class="button small" href="#/admin/reports?source=market">市集举报</a>';
    var listingEntry = live() ? use('market:listings', '/admin/market/listings') : { status: 'ok', data: m.listings };
    var rulesEntry = live() ? use('market:rules', '/admin/market/rules') : { status: 'ok', data: m.rules };
    var listings = table([
      { label: '条目', cls: 'main', render: function (r) { return '<b>' + esc(r.title || '未命名条目') + '</b><small>' + esc(r.category_label || MARKET_CATEGORY[r.category] || '其他分类') + ' · ' + esc(r.display_name || r.handle || r.seller) + '</small>'; } },
      { label: '价格', cls: 'num', render: function (r) { return esc(r.price); } },
      { label: '状态', render: function (r) { return pill(r.status, r.status === 'blocked' || r.status === '已拦截' ? 'danger' : r.status === 'active' || r.status === '在售' ? 'good' : 'muted'); } },
      { label: '想要', cls: 'num', render: function (r) { return num(r.want_count); } },
      { label: '举报', cls: 'num', render: function (r) { var count = r.report_count != null ? r.report_count : r.reports; return count ? '<b class="adm-text-danger">' + num(count) + '</b>' : '<span class="adm-faint">0</span>'; } }
    ], listingEntry.status === 'ok' ? listingEntry.data || [] : []);
    var rules = rulesEntry.status === 'ok' ? rulesEntry.data || {} : {};
    var banned = rules.forbidden || [];
    var rulesBody = rulesEntry.status !== 'ok' ? stateBlock(rulesEntry) : '<ul class="adm-banned">' + banned.map(function (b) { return '<li>' + esc(b.label || b) + '</li>'; }).join('') + '</ul>' +
      '<div class="adm-card-line">L1 每日 ' + num((rules.limits || {}).l1_daily_listings) + ' 条 · ' + num((rules.limits || {}).expire_days) + ' 天过期</div>';
    return head('市集', '不做站内支付，不做担保', '<div class="adm-head-actions">' + queueLink + '</div>') + '<div class="adm-split">' +
      card('最近发布', listingEntry.status === 'ok' ? num((listingEntry.data || []).length) + ' 条' : '', listingEntry.status === 'ok' ? listings : stateBlock(listingEntry)) +
      card('规则', '', rulesBody, 'is-narrow') + '</div>';
  }

  function metricsEntry() { return live() ? use('metrics', '/admin-console/metrics') : null; }

  function agentsView() {
    var nav = navItem('agents'), tab = state.route.tab, a = demo().agents, body = '';
    var m = metricsEntry();
    var metric = function (key) { return m && m.status === 'ok' ? ((m.data.cards || {})[key] || {}).value : null; };
    if (tab === 'agents') {
      var agentEntry = live() ? use('agents:profiles', '/admin/agents/profiles') : { status: 'ok', data: a.agents };
      var agentRows = agentEntry.status === 'ok' ? agentEntry.data || [] : [];
      var stats = agentEntry.status === 'ok' ? kpiRow([['接入 Agent', num(agentRows.filter(function (x) { return x.status === 'active'; }).length)], ['累计调用', num(agentRows.reduce(function (n, x) { return n + Number(x.calls || 0); }, 0))]]) : '';
      body = stats + (agentEntry.status !== 'ok' ? stateBlock(agentEntry) : table([
        { label: 'Agent', cls: 'main', render: function (r) { return '<b>' + esc(r.name) + '</b><small>主人 ' + esc(r.owner_name || r.owner_handle || r.owner) + '</small>'; } },
        { label: '能力', render: function (r) { var abilities = jsonList(r.abilities_json || r.scopes); return '<span class="adm-tags">' + abilities.map(function (s) { return '<span class="adm-scope">' + knownLabel(AGENT_ABILITY, s, '其他能力') + '</span>'; }).join('') + '</span>'; } },
        { label: '令牌', cls: 'num', render: function (r) { return num(r.tokens); } },
        { label: '调用', cls: 'num', render: function (r) { return num(r.calls); } },
        { label: '状态', render: function (r) { return pill(r.status === 'active' ? '启用' : '已吊销', r.status === 'active' ? 'good' : 'muted'); } }
      ], agentRows));
    } else if (tab === 'tokens') {
      var tokenEntry = live() ? use('agents:tokens', '/admin/agents/tokens') : { status: 'ok', data: a.tokens };
      body = tokenEntry.status !== 'ok' ? stateBlock(tokenEntry) : table([
        { label: '令牌', cls: 'main', render: function (r) { var scopes = jsonList(r.scopes_json || r.scopes); return '<code>' + esc(maskedToken(r.masked_token)) + '</code><small>' + esc(r.agent_name || r.owner) + ' · ' + num(scopes.length || r.scope_count) + ' 项权限</small>'; } },
        { label: '最近使用', render: function (r) { return rel(r.last_used_at); } },
        { label: '到期', render: function (r) { return rel(r.expires_at); } },
        { label: '状态', render: function (r) { return pill(r.status === 'active' ? '有效' : '已吊销', r.status === 'active' ? 'good' : 'muted'); } }
      ], tokenEntry.data || []);
    } else {
      var hits = live() ? (m.status === 'ok' && m.data.crawler_hits ? m.data.crawler_hits.value : null) : null;
      if (tab === 'traffic') {
        var byDay = {};
        (hits || []).forEach(function (h) { byDay[h.day] = (byDay[h.day] || 0) + Number(h.value || 0); });
        var series = live() ? Object.keys(byDay).sort().map(function (d) { return { day: d, value: byDay[d] }; }) : demo().overview.trends.crawler;
        var calls = live() ? (m.status === 'ok' && m.data.agent_calls && Array.isArray(m.data.agent_calls.value) ? m.data.agent_calls.value : null) : demo().overview.trends.agent_calls;
        body = live() && m.status !== 'ok' ? stateBlock(m) : '<div class="adm-split is-even">' + card('爬虫请求', '最近 14 天', hits === null && live() ? '<div class="adm-empty"><b>公开层模块未上线</b></div>' : barChart(series, '爬虫请求')) + card('Agent 调用', '最近 14 天', calls ? barChart(calls, 'Agent 调用') : '<div class="adm-empty"><b>Agent 计量未上线</b></div>') + '</div>';
      } else {
        var crawlerEntry = live() ? use('public:crawlers', '/admin/public/crawlers') : { status: 'ok', data: a.crawlers };
        body = crawlerEntry.status !== 'ok' ? stateBlock(crawlerEntry) : table([
          { label: '爬虫', cls: 'main', render: function (r) { return '<b>' + esc(r.vendor || r.label) + '</b><small><code>' + esc(r.id || r.key) + '</code></small>'; } },
          { label: '用途', render: function (r) { return esc(r.purpose || '—'); } },
          { label: '累计命中', cls: 'num', render: function (r) { return num(r.hits != null ? r.hits : r.week); } },
          { label: '策略', render: function (r) { var welcome = r.welcome != null ? r.welcome : r.policy === '允许'; return pill(welcome ? '允许' : '限制', welcome ? 'good' : 'notice'); } }
        ], crawlerEntry.data || [], { empty: '还没有爬虫策略' });
      }
    }
    return head('Agent 与开放平台', '') + tabsBar(nav, tab) + body;
  }

  var CYCLE = { month: '按月', year: '按年' };
  var SUB_STATE = { waitlist: '候补', trial: '试用', active: '生效', expired: '已到期', canceled: '已取消' };

  function bizEntry(key, path) {
    if (!live()) return { status: 'ok', data: demo().biz[key] };
    return use('biz:' + key, path);
  }

  function money(v) { return v === 0 ? '免费' : '¥' + num(v); }

  function bizView() {
    var nav = navItem('biz'), tab = state.route.tab, body = '';
    if (tab === 'applications') return head('会员与商业', '') + tabsBar(nav, tab) + appsView();
    if (tab === 'contributions') return head('会员与商业', '') + tabsBar(nav, tab) + contribView();
    var ov = bizEntry('overview', '/admin/billing/overview');
    var stats = '';
    if (ov.status === 'ok' && ov.data) {
      var subs = ov.data.subscriptions || {}, waiting = (ov.data.waitlist || []).reduce(function (n, w) { return n + Number(w.people || 0); }, 0);
      stats = kpiRow([['候补人数', num(waiting)], ['试用中', num(subs.trial)], ['生效订阅', num(subs.active)], ['支付', ov.data.paymentsEnabled ? '已开通' : '未开通', ov.data.paymentsEnabled ? '' : '只收候补，不扣款']]);
    } else if (ov.status !== 'loading') stats = stateBlock(ov);
    if (tab === 'plans') {
      var plans = live() ? use('biz:plans', '/billing/plans') : { status: 'ok', data: { plans: demo().biz.plans } };
      body = plans.status !== 'ok' ? stateBlock(plans) : table([
        { label: '方案', cls: 'main', render: function (r) { return '<b>' + esc(r.name) + '</b><small>' + esc(r.tagline || '') + '</small>'; } },
        { label: '月付', cls: 'num', render: function (r) { return money(r.price.month) + (r.perSeat ? '<small class="adm-faint">每席</small>' : ''); } },
        { label: '年付', cls: 'num', render: function (r) { return money(r.price.year); } },
        { label: '起订', cls: 'num', render: function (r) { return num(r.minSeats) + ' 席'; } },
        { label: '价格', render: function (r) { return pill(r.priceStatus === 'approved' ? '已定价' : '拟定', r.priceStatus === 'approved' ? 'good' : 'notice'); } }
      ], (plans.data || {}).plans || []);
    } else if (tab === 'waitlist') {
      var wl = bizEntry('waitlist', '/admin/billing/waitlist');
      body = wl.status !== 'ok' ? stateBlock(wl) : table([
        { label: '成员', cls: 'main', render: function (r) { return '<b>@' + esc(r.handle || '—') + '</b><small>L' + num(r.level) + ' · 来自' + esc(r.source) + '</small>'; } },
        { label: '方案', render: function (r) { return esc(r.planName || r.plan); } },
        { label: '周期', render: function (r) { return label(CYCLE, r.cycle); } },
        { label: '席位', cls: 'num', render: function (r) { return num(r.seats); } },
        { label: '加入', render: function (r) { return rel(r.joinedAt); } }
      ], wl.data, { empty: '候补名单还是空的' });
    } else {
      var sub = bizEntry('subscriptions', '/admin/billing/subscriptions');
      var orders = live() ? use('biz:orders', '/admin/billing/orders') : { status: 'ok', data: demo().biz.orders || [] };
      body = card('订阅', '', sub.status !== 'ok' ? stateBlock(sub) : table([
        { label: '成员', cls: 'main', render: function (r) { return '<b>@' + esc(r.handle || '—') + '</b><small><code>' + esc(r.id) + '</code></small>'; } },
        { label: '方案', render: function (r) { return esc(r.plan) + '<small class="adm-faint">' + label(CYCLE, r.cycle) + ' · ' + num(r.seats) + ' 席</small>'; } },
        { label: '状态', render: function (r) { return pill(SUB_STATE[r.state] || r.state, r.state === 'active' ? 'good' : r.state === 'trial' ? 'info' : 'muted'); } },
        { label: '到期', render: function (r) { return r.periodEnd ? rel(r.periodEnd) : '<span class="adm-faint">—</span>'; } }
      ], sub.data, { empty: '还没有订阅' })) + card('订单', '', orders.status !== 'ok' ? stateBlock(orders) : table([
        { label: '订单', cls: 'main', render: function (r) { return '<b><code>' + esc(r.id) + '</code></b><small>@' + esc(r.handle || '—') + ' · ' + esc(r.plan_name || PLAN[r.plan_key] || '未知方案') + '</small>'; } },
        { label: '金额', cls: 'num', render: function (r) { return money(Number(r.amount_fen || 0) / 100); } },
        { label: '渠道', render: function (r) { return esc(r.provider || '—'); } },
        { label: '状态', render: function (r) { return pill(r.state, r.state === 'paid' ? 'good' : r.state === 'failed' ? 'danger' : 'muted'); } },
        { label: '创建', render: function (r) { return rel(r.created_at); } }
      ], orders.data || [], { empty: '还没有订单' }));
    }
    return head('会员与商业', '') + tabsBar(nav, tab) + stats + body;
  }

  /* ------------------------------------------------------------------ 赞助 / 讲师申请审核（R17-H2）：只是申请表，不涉及钱 */

  var APP_KIND = { sponsor: '赞助合作', lecturer: '讲师计划' };
  var APP_STATE = { submitted: '待审', approved: '已通过', rejected: '未通过' };
  var SPONSOR_TYPE = { title: '活动冠名', jobs: '招聘', prize: '奖品赞助', slot: '赞助位' };
  var COURSE_FORM = { workshop: '小班工作坊', one: '一对一' };

  function appsFilters() { return state.filters.apps || (state.filters.apps = { state: 'submitted', kind: '' }); }

  function demoApps() {
    var d = demo();
    if (!d.apps) {
      var ago = function (days) { return new Date(nowMs() - days * 86400000).toISOString(); };
      d.apps = [
        { id: 'demo-app-1', kind: 'sponsor', state: 'submitted', applicant: { handle: 'maple', display_name: '枫' }, fields: { brand: '示例科技', types: ['title', 'jobs'], budget: '¥5,000 以下', time: '本月', note: '想冠名一场线上活动' }, decision_note: null, created_at: ago(1) },
        { id: 'demo-app-2', kind: 'lecturer', state: 'submitted', applicant: { handle: 'river', display_name: '川' }, fields: { title: '用 Agent 做周报', form: 'workshop', length: '2 小时 × 1 次', price: '¥149 / 席', note: '' }, decision_note: null, created_at: ago(2) },
        { id: 'demo-app-3', kind: 'sponsor', state: 'approved', applicant: { handle: 'pine', display_name: '松' }, fields: { brand: '另一家公司', types: ['prize'], budget: '', time: '下月', note: '' }, decision_note: '欢迎，稍后联系', created_at: ago(5) }
      ];
    }
    return d.apps;
  }

  function appsEntry() {
    var f = appsFilters();
    if (!live()) {
      return { status: 'ok', data: { items: demoApps().filter(function (a) { return a.state === f.state && (!f.kind || a.kind === f.kind); }) }, meta: {} };
    }
    var query = { state: f.state, kind: f.kind || null, limit: 30 };
    return use('apps?' + JSON.stringify(query), '/admin/social/applications', query);
  }

  function appFields(a) {
    var v = a.fields || {}, rows;
    if (a.kind === 'sponsor') {
      rows = [['品牌 / 公司', v.brand], ['想合作的方式', (v.types || []).map(function (t) { return SPONSOR_TYPE[t] || t; }).join('、')], ['预算（只是文字）', v.budget], ['时间', v.time], ['补充', v.note]];
    } else {
      rows = [['课程主题', v.title], ['形式', COURSE_FORM[v.form] || v.form], ['时长', v.length], ['定价想法（只是文字）', v.price], ['补充', v.note]];
    }
    return '<dl class="adm-summary">' + rows.filter(function (r) { return r[1]; }).map(function (r) { return '<div><dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd></div>'; }).join('') + '</dl>';
  }

  function appFlow(a, flow) {
    var approve = flow.decision === 'approved';
    var blocked = live() && !(state.viewer && state.viewer.totp_enabled);
    var who = esc(a.applicant && (a.applicant.display_name || a.applicant.handle) || '申请人');
    if (flow.step === 'form') {
      return '<form class="adm-flow adm-inline-flow" data-adm-form="flow"><h3>' + (approve ? '通过' : '不通过') + ' · ' + who + '</h3>' +
        field('reason', '说明（必填，申请人会收到）', '<textarea data-adm-focus="flow-reason" data-adm-flow="reason" name="reason" rows="3" maxlength="300" required placeholder="' + (approve ? '比如：欢迎，我们会联系你' : '比如：目前不合适，原因是…') + '">' + esc(val(flow, 'reason')) + '</textarea>') +
        totpField(flow, true) + flowError(flow) + flowButtons(flow, '核对', false, blocked) + '</form>';
    }
    return '<div class="adm-flow adm-inline-flow is-confirm"><h3>' + (flow.step === 'done' ? icon('check') + '已' + (approve ? '通过' : '不通过') : '确认' + (approve ? '通过' : '不通过')) + '</h3>' +
      summary([['申请', esc(APP_KIND[a.kind] || a.kind) + ' · ' + who], ['结论', approve ? '通过' : '不通过'], ['说明', esc(val(flow, 'reason'))], ['写入', live() ? 'POST /api/admin/social/applications/…/decision · 审计' : '示例，不写入服务器']]) +
      (flow.step === 'confirm' ? '<p class="adm-flow-warn">' + icon('alert') + '结论会通知申请人，不能撤回。</p>' : '') + flowError(flow) + flowButtons(flow, '', !approve, blocked) + '</div>';
  }

  function appCard(a) {
    var flow = state.flow && state.flow.kind === 'app' && state.flow.id === a.id ? state.flow : null;
    var blocked = live() && !(state.viewer && state.viewer.totp_enabled);
    var pending = a.state === 'submitted';
    var tone = a.state === 'approved' ? 'good' : a.state === 'rejected' ? 'danger' : 'notice';
    var who = a.applicant ? person({ name: a.applicant.display_name, handle: a.applicant.handle }) : '<span class="adm-faint">—</span>';
    var actions = pending && !flow ? '<div class="adm-flow-actions is-start"><button class="button primary small" type="button" data-adm="app-decide" data-id="' + esc(a.id) + '" data-value="approved"' + (blocked ? ' disabled title="先开启两步验证"' : '') + '>通过</button><button class="button danger small" type="button" data-adm="app-decide" data-id="' + esc(a.id) + '" data-value="rejected"' + (blocked ? ' disabled title="先开启两步验证"' : '') + '>不通过</button></div>' : '';
    var decided = !pending && a.decision_note ? '<p class="adm-faint">处理说明：' + esc(a.decision_note) + '</p>' : '';
    return '<section class="adm-card adm-app"><header class="adm-card-head"><h2>' + esc(APP_KIND[a.kind] || a.kind) + '</h2><span>' + pill(APP_STATE[a.state] || a.state, tone) + ' <span class="adm-time">' + rel(a.created_at) + '</span></span></header>' +
      '<div class="adm-app-who">' + who + '</div>' + appFields(a) + decided + actions + (flow ? appFlow(a, flow) : '') + '</section>';
  }

  function appsView() {
    var f = appsFilters(), entry = appsEntry();
    var states = [['submitted', '待审'], ['approved', '已通过'], ['rejected', '未通过']];
    var kinds = [['', '全部'], ['sponsor', '赞助合作'], ['lecturer', '讲师计划']];
    var seg = function (name, list, current, act) {
      return '<div class="segmented adm-seg" role="group" aria-label="' + esc(name) + '">' + list.map(function (s) { return '<button type="button" data-adm="' + esc(act) + '" data-value="' + esc(s[0]) + '" aria-pressed="' + (current === s[0] ? 'true' : 'false') + '">' + esc(s[1]) + '</button>'; }).join('') + '</div>';
    };
    var gate = live() && !(state.viewer && state.viewer.totp_enabled)
      ? '<div class="adm-totp is-blocked">' + icon('lock') + '<span>处理申请属于高危操作，需要先开启两步验证（动态验证码）。</span><a class="button tonal small" href="#/account">去开启</a></div>' : '';
    var toolbar = '<div class="adm-toolbar">' + seg('处理状态', states, f.state, 'apps-state') + seg('申请类型', kinds, f.kind, 'apps-kind') + '</div>';
    var body;
    if (entry.status !== 'ok') body = stateBlock(entry);
    else {
      var rows = ((entry.data || {}).items || []).concat(entry.more || []);
      body = rows.length ? '<div class="adm-app-list">' + /* safe-fn: appCard 内逐值转义 */ rows.map(appCard).join('') + '</div>' + (entry.meta && entry.meta.cursor ? '<div class="adm-more"><button class="button small" type="button" data-adm="apps-more"' + (entry.moreLoading ? ' disabled aria-busy="true"' : '') + '>' + (entry.moreLoading ? '正在加载…' : '加载更多') + '</button></div>' : '')
        : '<div class="adm-empty"><b>' + (f.state === 'submitted' ? '没有待审的申请' : '这里还没有记录') + '</b></div>';
    }
    return '<p class="adm-faint">这里只处理申请表：不涉及报价、收款或分成，结论会通知申请人。</p>' + /* safe: gate、toolbar、body 都由本文件拼好并转义 */ gate + toolbar + /* safe: 同上 */ body;
  }

  function moreApps() {
    var f = appsFilters();
    var query = { state: f.state, kind: f.kind || null, limit: 30 };
    var entry = state.cache['apps?' + JSON.stringify(query)];
    if (!entry || !entry.meta || !entry.meta.cursor || entry.moreLoading) return;
    entry.moreLoading = true;
    paint();
    window.CommonsAPI.get('/admin/social/applications', Object.assign({}, query, { cursor: entry.meta.cursor })).then(function (res) {
      var seen = new Set((((entry.data || {}).items || []).concat(entry.more || [])).map(function (item) { return item.id; }));
      var fresh = ((res.data || {}).items || []).filter(function (item) { return !seen.has(item.id); });
      entry.more = (entry.more || []).concat(fresh);
      entry.meta = res.meta || {};
      entry.moreLoading = false;
      paint();
    }).catch(function (error) { entry.moreLoading = false; state.notice = error.message || '加载失败'; paint(); });
  }

  function runApp(flow) {
    var note = String(flow.values.reason).trim();
    if (!live()) {
      var a = demoApps().filter(function (x) { return x.id === flow.id; })[0];
      if (a) { a.state = flow.decision; a.decision_note = note; }
      return Promise.resolve();
    }
    flow.key = flow.key || window.CommonsAPI.newIdempotencyKey();
    return window.CommonsAPI.post('/admin/social/applications/' + encodeURIComponent(flow.id) + '/decision', { decision: flow.decision, note: note }, { idempotencyKey: flow.key })
      .then(function () { invalidate('apps'); });
  }

  /* ------------------------------------------------------------------ 贡献审核（R17-R3b）：通过和退回都要写说明，结果通知投稿人 */

  var CONTRIB_STATE = { review: '待审', accepted: '已通过', draft: '草稿' };

  function contribFilters() { return state.filters.contribs || (state.filters.contribs = { status: 'review' }); }

  function demoContribs() {
    var d = demo();
    if (!d.contribs) {
      var ago = function (days) { return new Date(nowMs() - days * 86400000).toISOString(); };
      d.contribs = [
        { id: 'demo-contrib-1', title: '把周报交给 Agent', kind: '实践案例', summary: '三步交出去', body: '先列清单，再让 Agent 起草，最后自己改。', status: 'review', handle: 'maple', display_name: '枫', last_event: '', updated_at: ago(1) },
        { id: 'demo-contrib-2', title: '方法笔记一则', kind: '方法笔记', summary: '记给自己', body: '还没写完。', status: 'draft', handle: 'river', display_name: '川', last_event: '退回修改：补上具体步骤', updated_at: ago(3) }
      ];
    }
    return d.contribs;
  }

  function contribEntry() {
    var f = contribFilters();
    if (!live()) {
      return { status: 'ok', data: { items: demoContribs().filter(function (row) { return row.status === f.status; }) }, meta: {} };
    }
    var query = { status: f.status, limit: 30 };
    return use('contribs?' + JSON.stringify(query), '/admin/account/contributions', query);
  }

  function contribFlow(row, flow) {
    var accept = flow.decision === 'accept';
    var blocked = live() && !(state.viewer && state.viewer.totp_enabled);
    var who = esc(row.display_name || row.handle || '投稿人');
    if (flow.step === 'form') {
      return '<form class="adm-flow adm-inline-flow" data-adm-form="flow"><h3>' + (accept ? '通过' : '退回') + ' · ' + who + '</h3>' +
        field('reason', '说明', '<textarea data-adm-focus="flow-reason" data-adm-flow="reason" name="reason" rows="3" maxlength="300" required placeholder="' + (accept ? '比如：可以收进案例' : '比如：请补上具体步骤') + '">' + esc(val(flow, 'reason')) + '</textarea>') +
        totpField(flow, true) + flowError(flow) + flowButtons(flow, '核对', false, blocked) + '</form>';
    }
    return '<div class="adm-flow adm-inline-flow is-confirm"><h3>' + (flow.step === 'done' ? icon('check') + '已' + (accept ? '通过' : '退回') : '确认' + (accept ? '通过' : '退回')) + '</h3>' +
      summary([['投稿', esc(row.title || '未命名')], ['结论', accept ? '通过' : '退回'], ['说明', esc(val(flow, 'reason'))]]) +
      (flow.step === 'confirm' ? '<p class="adm-flow-warn">' + icon('alert') + '会通知投稿人，不能撤回。</p>' : '') + flowError(flow) + flowButtons(flow, '', !accept, blocked) + '</div>';
  }

  function contribCard(row) {
    var flow = state.flow && state.flow.kind === 'contrib' && state.flow.id === row.id ? state.flow : null;
    var blocked = live() && !(state.viewer && state.viewer.totp_enabled);
    var pending = row.status === 'review';
    var tone = row.status === 'accepted' ? 'good' : row.status === 'review' ? 'notice' : 'muted';
    var actions = pending && !flow ? '<div class="adm-flow-actions is-start"><button class="button primary small" type="button" data-adm="contrib-decide" data-id="' + esc(row.id) + '" data-value="accept"' + (blocked ? ' disabled title="先开启两步验证"' : '') + '>通过</button><button class="button danger small" type="button" data-adm="contrib-decide" data-id="' + esc(row.id) + '" data-value="return"' + (blocked ? ' disabled title="先开启两步验证"' : '') + '>退回</button></div>' : '';
    var noted = !pending && row.last_event ? '<p>' + esc(row.last_event) + '</p>' : '';
    return '<section class="adm-card adm-app"><header class="adm-card-head"><h2>' + esc(row.title || '未命名') + '</h2><span>' + esc(row.kind || '') + ' ' + pill(CONTRIB_STATE[row.status] || row.status, tone) + ' <span class="adm-time">' + rel(row.updated_at) + '</span></span></header>' +
      '<div class="adm-app-who">' + person({ name: row.display_name || row.handle, handle: row.handle }) + '</div><p>' + esc(row.summary || '') + '</p>' + (row.body ? '<p>' + esc(row.body) + '</p>' : '') + noted + actions + (flow ? contribFlow(row, flow) : '') + '</section>';
  }

  function contribView() {
    var f = contribFilters(), entry = contribEntry();
    var states = [['review', '待审'], ['accepted', '已通过'], ['draft', '草稿']];
    var seg = '<div class="segmented adm-seg" role="group" aria-label="处理状态">' + states.map(function (item) {
      return '<button type="button" data-adm="contrib-state" data-value="' + esc(item[0]) + '" aria-pressed="' + (f.status === item[0] ? 'true' : 'false') + '">' + esc(item[1]) + '</button>';
    }).join('') + '</div>';
    var gate = live() && !(state.viewer && state.viewer.totp_enabled)
      ? '<div class="adm-totp is-blocked">' + icon('lock') + '<span>审核投稿属于高危操作，需要先开启两步验证（动态验证码）。</span><a class="button tonal small" href="#/account">去开启</a></div>' : '';
    var body;
    if (entry.status !== 'ok') body = stateBlock(entry);
    else {
      var rows = ((entry.data || {}).items || []).concat(entry.more || []);
      body = rows.length ? '<div class="adm-app-list">' + /* safe-fn: contribCard 内逐值转义 */ rows.map(contribCard).join('') + '</div>' + (entry.meta && entry.meta.cursor ? '<div class="adm-more"><button class="button small" type="button" data-adm="contrib-more"' + (entry.moreLoading ? ' disabled aria-busy="true"' : '') + '>' + (entry.moreLoading ? '正在加载…' : '加载更多') + '</button></div>' : '')
        : '<div class="adm-empty"><b>' + (f.status === 'review' ? '没有待审的投稿' : '这里还没有记录') + '</b></div>';
    }
    return /* safe: gate、分段都由本文件拼好并转义 */ gate + '<div class="adm-toolbar">' + seg + '</div>' + /* safe: body 同上 */ body;
  }

  function moreContribs() {
    var f = contribFilters();
    var query = { status: f.status, limit: 30 };
    var entry = state.cache['contribs?' + JSON.stringify(query)];
    if (!entry || !entry.meta || !entry.meta.cursor || entry.moreLoading) return;
    entry.moreLoading = true;
    paint();
    window.CommonsAPI.get('/admin/account/contributions', Object.assign({}, query, { cursor: entry.meta.cursor })).then(function (res) {
      var seen = new Set((((entry.data || {}).items || []).concat(entry.more || [])).map(function (item) { return item.id; }));
      var fresh = ((res.data || {}).items || []).filter(function (item) { return !seen.has(item.id); });
      entry.more = (entry.more || []).concat(fresh);
      entry.meta = res.meta || {};
      entry.moreLoading = false;
      paint();
    }).catch(function (error) { entry.moreLoading = false; state.notice = error.message || '加载失败'; paint(); });
  }

  function runContrib(flow) {
    var note = String(flow.values.reason || '').trim();
    if (!live()) {
      var row = demoContribs().filter(function (item) { return item.id === flow.id; })[0];
      if (row) {
        row.status = flow.decision === 'accept' ? 'accepted' : 'draft';
        row.last_event = (flow.decision === 'accept' ? '审核通过' : '退回修改') + '：' + note;
      }
      return Promise.resolve();
    }
    flow.key = flow.key || window.CommonsAPI.newIdempotencyKey();
    return window.CommonsAPI.post('/admin/account/contributions/' + encodeURIComponent(flow.id) + '/decide', { decision: flow.decision, note: note }, { idempotencyKey: flow.key })
      .then(function () { invalidate('contribs'); });
  }

  /* ------------------------------------------------------------------ 系统 */

  function systemEntry() { return live() ? use('system', '/admin/admin/system') : { status: 'ok', data: demo().system }; }

  function systemView() {
    var nav = navItem('system'), tab = state.route.tab, entry = systemEntry();
    var sub = entry.status === 'ok' ? '迁移 ' + num(entry.data.health.migrations) + ' · 事件积压 ' + num(entry.data.health.outbox_pending) : '';
    if (entry.status !== 'ok') return head('系统', '') + tabsBar(nav, tab) + stateBlock(entry);
    var d = entry.data, body = '';
    if (tab === 'flags') body = flagsBlock(d.flags || []);
    else if (tab === 'jobs') body = table([
      { label: '任务', cls: 'main', render: function (j) { return '<b>' + knownLabel(JOB, j.name, '其他任务') + '</b><small>' + knownLabel(MODULE, j.module, '其他模块') + '</small>'; } },
      { label: '周期', render: function (j) { return '每 ' + span(j.every_seconds * 1000); } },
      { label: '上次运行', render: function (j) { return rel(j.last_run_at); } },
      { label: '下次', render: function (j) { return j.next_due_at ? rel(j.next_due_at) : '<span class="adm-faint">—</span>'; } },
      { label: '状态', render: function (j) { return pill(JOB_STATE[j.state] || j.state, j.state === 'idle' ? 'good' : j.state === 'running' ? 'info' : j.state === 'overdue' ? 'danger' : 'muted'); } },
      { label: '耗时 / 失败', render: function (j) { return j.duration_ms != null ? num(j.duration_ms) + ' ms' : '<span class="adm-faint">未记录</span>'; } }
    ], d.jobs, { empty: '还没有注册周期任务' });
    else if (tab === 'health') {
      var h = d.health;
      body = '<div class="adm-health">' +
        healthTile('数据库', h.status === 'ok' ? '正常' : h.status, num(h.db_ms) + ' ms · SQLite ' + esc(h.sqlite), h.status === 'ok') +
        healthTile('迁移', num(h.migrations), h.latest_migration ? '最近一次迁移 · ' + rel(h.latest_migration.applied_at) : '—', true) +
        healthTile('事件队列', '积压 ' + num(h.outbox_pending), '失败 ' + num(h.outbox_dead) + (h.outbox_oldest_pending ? ' · 最早 ' + rel(h.outbox_oldest_pending) : ''), !h.outbox_dead) +
        healthTile('检查时间', stamp(h.checked_at), '每次打开本页重新检查', true) + '</div>' +
        card('已加载模块', num((h.modules || []).length) + ' 个', '<ul class="adm-modules">' + (h.modules || []).map(function (mName) { return '<li>' + esc(mName) + '</li>'; }).join('') + '</ul>');
    } else body = table([
      { label: '配置', cls: 'main', render: function (c) { return '<b>' + esc(c.label) + '</b>'; } },
      { label: '值', render: function (c) { return c.is_secret ? '<span class="adm-secret">' + icon('lock') + (c.set ? '已设置' : '未设置') + '</span>' : '<code class="adm-config-value">' + esc(typeof c.value === 'object' ? JSON.stringify(c.value) : String(c.value)) + '</code>'; } }
    ], d.config);
    return head('系统', sub) + tabsBar(nav, tab) + body;
  }

  function healthTile(name, value, sub, ok) {
    return '<div class="adm-health-tile' + (ok ? '' : ' is-bad') + '"><span><i class="adm-dot is-' + (ok ? 'good' : 'danger') + '"></i>' + esc(name) + '</span><strong>' + /* safe: 调用方已转义 */ value + '</strong><small>' + /* safe: 调用方已转义 */ sub + '</small></div>';
  }

  function flagsBlock(flags) {
    var groups = { core: [], risk: [], low: [] };
    flags.forEach(function (f) {
      var kind = f.key === 'core.objects' || f.key === 'gov.reports' ? 'core' :
        f.key === 'gov.model_egress' || f.key === 'gov.premoderation' || f.key === 'public.crawlers' ? 'risk' : 'low';
      groups[kind].push(f);
    });
    var headings = { core: '核心功能', risk: '高风险开关', low: '低频配置' };
    return '<div class="adm-flag-groups">' + ['core', 'risk', 'low'].filter(function (kind) { return groups[kind].length; }).map(function (kind) {
      return '<section class="adm-flag-section adm-flag-' + kind + '"><h2>' + headings[kind] + '<small>' + num(groups[kind].length) + ' 项</small></h2><ul class="adm-flags">' + groups[kind].map(function (f) {
        var flow = state.flow && state.flow.kind === 'flag' && state.flow.key === f.key ? state.flow : null;
        var flagLabel = FLAG_LABEL[f.key] || '其他开关';
        return '<li><div class="adm-flag-text"><b>' + esc(flagLabel) + '</b>' + (kind === 'risk' ? '<p>' + esc(f.description || '调整前请核对影响范围') + '</p>' : '') +
          ((f.gates || []).length ? '<details class="adm-gates"><summary>影响 ' + num(f.gates.length) + ' 个动作</summary><span>' + f.gates.map(function (g) { return '<code>' + esc(g) + '</code>'; }).join('') + '</span></details>' : '<small class="adm-faint">不直接拦截动作</small>') + '</div>' +
          '<button class="adm-switch" type="button" role="switch" aria-checked="' + (f.enabled ? 'true' : 'false') + '" aria-label="' + esc(flagLabel) + '" data-adm="flag" data-key="' + esc(f.key) + '"' + (flow ? ' disabled' : '') + '><span></span><small>' + (f.enabled ? '开' : '关') + '</small></button>' +
          (flow ? flagFlow(f, flow) : '') + '</li>';
      }).join('') + '</ul></section>';
    }).join('') + '</div>';
  }

  function flagFlow(f, flow) {
    var to = !f.enabled;
    var flagLabel = FLAG_LABEL[f.key] || '其他开关';
    if (flow.step === 'form') return '<form class="adm-flow adm-inline-flow" data-adm-form="flow"><h3>' + (to ? '开启' : '关闭') + '「' + esc(flagLabel) + '」</h3>' + reasonField(flow) + totpField(flow, true) + flowError(flow) + flowButtons(flow, '核对') + '</form>';
    return '<div class="adm-flow adm-inline-flow is-confirm"><h3>' + (flow.step === 'done' ? icon('check') + '已' + (f.enabled ? '开启' : '关闭') : '确认' + (to ? '开启' : '关闭')) + '</h3>' + summary([['开关', esc(flagLabel)], ['影响', num((f.gates || []).length) + ' 个动作'], ['理由', esc(val(flow, 'reason'))]]) + flowError(flow) + flowButtons(flow, '', !to, false) + '</div>';
  }

  /* ------------------------------------------------------------------ 审计 */

  function auditFilters() {
    var f = state.filters.audit;
    if (!f) {
      var q = state.route.query;
      f = state.filters.audit = { actor: q && q.get('actor') || '', action: q && q.get('action') || '', target: q && q.get('target') || '', from_at: '', to_at: '' };
    }
    return f;
  }

  function auditView() {
    var f = auditFilters();
    var entry;
    if (live()) {
      var query = { actor: f.actor || null, action: f.action || null, target: f.target || null, from_at: f.from_at ? new Date(f.from_at).toISOString() : null, to_at: f.to_at ? new Date(f.to_at).toISOString() : null };
      entry = use('audit?' + JSON.stringify(query), '/admin-console/audit', query);
    } else {
      entry = { status: 'ok', data: demo().audit.filter(function (r) {
        return (!f.actor || (r.actor && (r.actor.handle === f.actor || r.actor.name === f.actor))) && (!f.action || r.action.indexOf(f.action) === 0) && (!f.target || r.target_id === f.target || r.target_type === f.target);
      }), meta: {} };
    }
    var form = '<form class="adm-filters adm-audit-filters" data-adm-form="audit">' +
      ['actor', 'action', 'target'].map(function (k) {
        var meta = { actor: ['操作人', '用户名'], action: ['动作', '如 参数调整'], target: ['对象', '对象编号'] }[k];
        return '<label class="field adm-field"><span>' + esc(meta[0]) + '</span><input name="' + k + '" value="' + esc(f[k]) + '" placeholder="' + esc(meta[1]) + '" autocomplete="off"></label>';
      }).join('') +
      '<label class="field adm-field"><span>开始</span><input name="from_at" type="datetime-local" value="' + esc(f.from_at) + '"></label><label class="field adm-field"><span>结束</span><input name="to_at" type="datetime-local" value="' + esc(f.to_at) + '"></label>' +
      '<div class="adm-filter-actions"><button class="button tonal" type="submit">筛选</button>' + (f.actor || f.action || f.target || f.from_at || f.to_at ? '<button class="button ghost" type="button" data-adm="audit-reset">清空</button>' : '') + '</div></form>';
    var rows = entry.status === 'ok' ? (entry.data || []).concat(entry.more || []) : [];
    var body = entry.status !== 'ok' ? stateBlock(entry) : table([
      { label: '时间', render: function (r) { return '<span class="adm-time">' + stamp(r.occurred_at) + '</span>'; } },
      { label: '操作人', render: function (r) { return r.actor && (r.actor.handle || r.actor.name) ? '<b>' + esc(r.actor.name || r.actor.handle) + '</b><small class="adm-faint">@' + esc(r.actor.handle || '') + '</small>' : '<span class="adm-faint">系统</span>'; } },
      { label: '动作', cls: 'main', render: function (r) { return knownLabel(AUDIT_ACTION, r.action, '其他动作'); } },
      { label: '对象', render: function (r) { return '<span>对象类型：' + knownLabel(TARGET_TYPE, r.target_type, '其他对象') + '</span><small class="adm-faint">对象编号：' + esc(r.target_id || '—') + '</small>'; } },
      { label: '结果', render: function (r) { return pill(OUTCOME[r.outcome] || '其他结果', r.outcome === 'ok' ? 'good' : 'danger'); } },
      { label: '请求', render: function (r) { return r.request_id ? '<code class="adm-faint">' + esc(String(r.request_id).slice(0, 8)) + '</code>' : '<span class="adm-faint">—</span>'; } }
    ], rows, { empty: '没有匹配的记录' }) + (entry.meta && entry.meta.next_cursor ? '<div class="adm-more"><button class="button small" type="button" data-adm="audit-more">加载更早</button></div>' : '');
    return head('审计日志', '只追加，不可修改') + form + body;
  }

  /* ------------------------------------------------------------------ 全局搜索 */

  function searchBox() {
    var s = state.search;
    return '<div class="adm-search" role="search"><label class="adm-input-icon">' + icon('search') + '<input type="search" data-adm-focus="search" data-adm-input="search" value="' + esc(s.q) + '" placeholder="搜索用户、内容、订单、事件 ID" aria-label="全局搜索" autocomplete="off" aria-expanded="' + (s.open ? 'true' : 'false') + '" aria-controls="adm-search-results"><kbd>/</kbd></label>' + (s.open && s.q ? searchResults() : '') + '</div>';
  }

  function demoSearch(q) {
    var d = demo(), lower = q.toLowerCase();
    return {
      groups: {
        users: d.users.filter(function (u) { return u.handle.indexOf(lower) >= 0 || u.name.indexOf(q) >= 0 || u.id === q; }).slice(0, 6),
        content: d.queue.items.filter(function (i) { return i.target && String(i.target.id).indexOf(q) === 0 && i.target.type === 'object'; }).map(function (i) { return { id: i.target.id, type: i.target.object_type, lifecycle: 'active', visible: false, title: null, author_handle: i.subject && i.subject.handle }; }),
        orders: [],
        events: d.audit.filter(function (a) { return a.id === q || a.request_id === q; }).map(function (a) { return { id: a.id, action: a.action, occurred_at: a.occurred_at, handle: a.actor && a.actor.handle, kind: 'audit', target_type: a.target_type, target_id: a.target_id }; })
      },
      offline: []
    };
  }

  function searchResults() {
    var s = state.search;
    var data = live() ? s.data : demoSearch(s.q.trim());
    var inner;
    if (live() && s.status === 'loading') inner = '<p class="adm-search-note">正在搜索…</p>';
    else if (live() && s.status !== 'ok') inner = '<p class="adm-search-note">' + esc(s.status === 'locked' ? '搜索需要两步验证' : s.status === 'missing' ? '搜索接口未接' : s.error || '搜索失败') + '</p>';
    else {
      var g = data.groups || {};
      var section = function (title, rows, render) {
        if (!rows || !rows.length) return '';
        return '<div class="adm-search-group"><p>' + esc(title) + '<span>' + num(rows.length) + '</span></p><ul>' + /* safe: 各分组渲染函数自行转义 */ rows.map(render).join('') + '</ul></div>';
      };
      inner = section('成员', g.users, function (u) {
        return '<li><button type="button" data-adm="search-user" data-id="' + esc(u.id) + '">' + person(u) + '<small>L' + num(u.level) + ' · ' + label(USER_STATUS, u.status) + '</small></button></li>';
      }) + section('内容', g.content, function (c) {
        return '<li><a href="#/admin/audit?target=' + esc(encodeURIComponent(c.id)) + '" data-adm="search-go"><span class="adm-search-main"><b>' + (c.visible && c.title ? esc(c.title) : '<span class="adm-faint">无阅读权限，只显示元数据</span>') + '</b><small>' + esc(OBJECT_TYPE[c.type] || c.type) + ' · <code>' + esc(String(c.id).slice(0, 12)) + '</code>' + (c.author_handle ? ' · @' + esc(c.author_handle) : '') + '</small></span></a></li>';
      }) + section('订单', g.orders, function (o) {
        return '<li><a href="#/admin/biz/orders" data-adm="search-go"><span class="adm-search-main"><b>' + esc(o.title) + '</b><small><code>' + esc(String(o.id).slice(0, 12)) + '</code> · ' + num(o.amount) + '</small></span></a></li>';
      }) + section('事件', g.events, function (ev) {
        return '<li><a href="#/admin/audit?target=' + esc(encodeURIComponent(ev.target_id || ev.id)) + '" data-adm="search-go"><span class="adm-search-main"><b>' + knownLabel(AUDIT_ACTION, ev.action || ev.category, '其他事件') + '</b><small>' + (ev.handle ? '@' + esc(ev.handle) + ' · ' : '') + stamp(ev.occurred_at || ev.opened_at) + '</small></span></a></li>';
      });
      if (!inner) inner = '<p class="adm-search-note">没有找到「' + esc(s.q) + '」</p>';
      if (data.offline && data.offline.length) inner += '<p class="adm-search-note is-foot">订单来源未接：' + esc(data.offline.join('、')) + '</p>';
    }
    return '<div class="adm-search-panel" id="adm-search-results" role="region" aria-label="搜索结果">' + /* safe: 上面逐段转义拼好 */ inner + '</div>';
  }

  function runSearch() {
    var q = state.search.q.trim();
    if (!q) { state.search.open = false; paint(); return; }
    state.search.open = true;
    if (!live()) { paint(); return; }
    state.search.status = 'loading';
    paint();
    var token = state.search.token = (state.search.token || 0) + 1;
    window.CommonsAPI.get('/admin/admin/search', { q: q }).then(function (res) {
      if (token !== state.search.token) return;
      state.search.status = 'ok'; state.search.data = res.data; paint();
    }).catch(function (error) {
      if (token !== state.search.token) return;
      state.search.status = classify(error); state.search.error = error && error.message; paint();
    });
  }

  /* ------------------------------------------------------------------ 绘制 */

  function page() {
    var prev = state.route;
    state.route = parseRoute();
    var r = state.route;
    if (prev.section !== r.section || prev.tab !== r.tab) {
      if (!state.keepDrawer) closeDrawer();
      state.flow = null;
      state.menuOpen = false;
    }
    state.keepDrawer = false;
    var source = r.query.get('source');
    if (source && (r.section === 'review' || r.section === 'reports')) {
      var f = state.filters[r.section] || (state.filters[r.section] = { source: '', status: 'active' });
      f.source = source; f.status = 'active';
    }
    if (r.section === 'audit' && ['actor', 'action', 'target'].some(function (k) { return r.query.get(k); })) state.filters.audit = null;
    if (live() && state.boot === 'idle') boot();
    return '<div class="adm" data-admin-root>' + shell() + '</div>';
  }

  var ANNOUNCE_TAB = { announce: 'items', marquee: 'ticker', ads: 'ads' };

  function afterPaint() {
    if (!state.root) return;
    settle();
    state.root.querySelectorAll('.adm-chart-wrap').forEach(function (wrap) { wrap.scrollLeft = wrap.scrollWidth; });
    var host = state.root.querySelector('[data-announce-admin-host]');
    if (!host || !window.CommonsAnnounce || !window.CommonsAnnounce.adminPanel) return;
    if (!host.querySelector('[data-announce-admin]')) window.CommonsAnnounce.adminPanel(host);
    var want = host.querySelector('[data-announce-action="tab"][data-value="' + ANNOUNCE_TAB[state.route.tab] + '"]');
    if (want && !want.classList.contains('selected')) want.click();
  }

  function paint() {
    if (!state.root) return;
    var active = document.activeElement;
    var key = active && state.root.contains(active) ? active.getAttribute('data-adm-focus') : null;
    var caret = null;
    try { caret = key && active.selectionStart; } catch (e) { caret = null; }
    state.root.innerHTML = shell();
    if (key) {
      var next = state.root.querySelector('[data-adm-focus="' + key + '"]');
      if (next) {
        next.focus({ preventScroll: true });
        if (caret != null && next.setSelectionRange) { try { next.setSelectionRange(caret, caret); } catch (e) { /* number inputs */ } }
      }
    }
    afterPaint();
  }

  function settle() {
    if (state.drawer) state.drawer.enter = false;
    state.menuEnter = false;
  }

  function boot() {
    state.boot = 'loading';
    window.CommonsAPI.me().then(function (viewer) {
      state.viewer = viewer;
      var roles = viewer.roles || [];
      state.boot = roles.indexOf('admin') >= 0 || roles.indexOf('governor') >= 0 ? 'ready' : 'denied';
      paint();
    }).catch(function (error) {
      state.boot = error && (error.status === 401 || error.status === 403) ? 'denied' : 'error';
      state.bootError = error && error.message;
      paint();
    });
  }

  /* ------------------------------------------------------------------ 交互 */

  function openFlow(kind, extra) {
    state.flow = Object.assign({ kind: kind, step: 'form', values: {}, error: '' }, extra || {});
  }

  function currentUser() {
    var entry = userDetailEntry(state.drawer.id);
    return entry.status === 'ok' ? entry.data : null;
  }
  function currentParam() {
    var entry = paramsEntry();
    if (entry.status !== 'ok') return null;
    return (entry.data || []).filter(function (r) { return r.namespace === state.drawer.ns && r.key === state.drawer.key; })[0] || null;
  }
  function currentFlag(key) {
    var entry = systemEntry();
    return entry.status === 'ok' ? (entry.data.flags || []).filter(function (f) { return f.key === key; })[0] : null;
  }

  function submitFlow() {
    var flow = state.flow;
    if (!flow) return;
    var error = '';
    if (flow.kind === 'user') error = validateUserFlow(currentUser(), flow);
    else if (flow.kind === 'param') error = validateParamFlow(currentParam(), flow);
    else if (!flow.values.reason || String(flow.values.reason).trim().length < 2) error = '请写理由，至少 2 个字';
    else if ((flow.kind === 'flag' || flow.kind === 'app' || flow.kind === 'contrib') && !live() && !/^\d{6}$/.test(String(flow.values.totp || ''))) error = '请输入 6 位两步验证码';
    else if ((flow.kind === 'app' || flow.kind === 'contrib') && live() && !(state.viewer && state.viewer.totp_enabled)) error = '需要先开启两步验证';
    flow.error = error;
    if (!error) flow.step = 'confirm';
    paint();
  }

  function runFlow() {
    var flow = state.flow;
    if (!flow || flow.step !== 'confirm') return;
    flow.step = 'running'; flow.error = ''; paint();
    var work;
    if (flow.kind === 'user') work = runUserFlow(currentUser(), flow).then(function () { invalidate('user:'); invalidate('users'); });
    else if (flow.kind === 'param') work = runParamFlow(currentParam(), flow);
    else if (flow.kind === 'batch') work = runBatch(flow);
    else if (flow.kind === 'flag') work = runFlag(flow);
    else if (flow.kind === 'app') work = runApp(flow);
    else if (flow.kind === 'contrib') work = runContrib(flow);
    work.then(function () {
      flow.step = 'done';
      state.notice = live() ? '已写入，并进入审计日志。' : '示例操作，没有写入服务器。';
      paint();
    }).catch(function (error) {
      flow.step = 'confirm';
      flow.error = error && error.status === 404 ? '接口未接或没有权限：' + (error.message || '') : (error && error.message) || '执行失败';
      paint();
    });
  }

  function runFlag(flow) {
    var f = currentFlag(flow.key);
    var reason = String(flow.values.reason).trim();
    if (!live()) {
      demo().system.flags.forEach(function (x) { if (x.key === flow.key) { x.enabled = !x.enabled; x.updated_at = new Date(nowMs()).toISOString(); } });
      demo().audit.unshift({ id: 'demo-' + Date.now(), occurred_at: new Date(nowMs()).toISOString(), actor: { handle: demo().viewer.handle, name: demo().viewer.display_name }, action: 'flag.set', target_type: 'feature_flag', target_id: flow.key, outcome: 'ok', request_id: null });
      return Promise.resolve();
    }
    return apiPost('/admin/admin/reasons', { action: 'flag.set', target_type: 'feature_flag', target_id: flow.key, reason: reason, summary: (f.enabled ? '关闭 ' : '开启 ') + flow.key })
      .then(function () { return apiPost('/admin/flags', { key: flow.key, enabled: !f.enabled }); })
      .then(function () { invalidate('system'); });
  }

  function refreshPreview() {
    var host = state.root && state.root.querySelector('[data-adm-preview]');
    var flow = state.flow;
    if (!host || !flow || flow.kind !== 'param' || flow.step !== 'form') return;
    var row = currentParam();
    if (row) host.innerHTML = previewBox(row, previewFor(row, val(flow, 'value', row.value)));
  }

  function closeDrawer() {
    state.drawer = null;
    if (state.flow && (state.flow.kind === 'user' || state.flow.kind === 'param')) state.flow = null;
  }

  function openUser(id) {
    state.drawer = { kind: 'user', id: id, tab: 'summary', enter: !state.drawer };
    if (state.flow && state.flow.kind === 'user') state.flow = null;
    state.search.open = false;
    paint();
    focusDrawer();
  }

  function focusDrawer() {
    var el = state.root && state.root.querySelector('[data-adm-drawer]');
    if (el) el.focus({ preventScroll: true });
  }

  function onClick(event) {
    var el = event.target.closest('[data-adm]');
    if (!state.root) return;
    if (state.search.open && !event.target.closest('.adm-search')) { state.search.open = false; if (!el) { paint(); return; } }
    if (!el || !state.root.contains(el)) return;
    var act = el.getAttribute('data-adm');
    var value = el.getAttribute('data-value');
    var scope = el.getAttribute('data-scope');
    if (el.tagName === 'TR' && event.target.closest('button, a, input, select, label')) return;
    if (act === 'menu') { state.menuOpen = !state.menuOpen; state.menuEnter = state.menuOpen; paint(); return; }
    if (act === 'notice-close') { state.notice = ''; paint(); return; }
    if (act === 'reboot') { state.boot = 'idle'; page(); paint(); return; }
    if (act === 'retry') { invalidate(el.getAttribute('data-key') || ''); Object.keys(state.cache).forEach(function (k) { if (state.cache[k].status === 'error') delete state.cache[k]; }); paint(); return; }
    if (act === 'trend') { state.trend = value; paint(); return; }
    if (act === 'open-user') { event.preventDefault(); openUser(el.getAttribute('data-id')); return; }
    if (act === 'search-user') { state.search.open = false; state.search.q = ''; if (state.route.section !== 'users') { state.keepDrawer = true; location.hash = '#/admin/users'; } openUser(el.getAttribute('data-id')); return; }
    if (act === 'search-go') { state.search.open = false; state.filters.audit = null; return; }
    if (act === 'drawer-close') { closeDrawer(); paint(); return; }
    if (act === 'drawer-tab') { state.drawer.tab = value; paint(); return; }
    if (act === 'user-action') { openFlow('user', { id: state.drawer.id, action: value, values: value === 'mute' ? { days: '3' } : value === 'ban' ? { days: '30' } : {} }); paint(); return; }
    if (act === 'flow-close') { var wasFlag = state.flow && state.flow.kind === 'flag'; state.flow = null; if (wasFlag) state.notice = state.notice; paint(); return; }
    if (act === 'flow-back') { if (state.flow) { state.flow.step = 'form'; state.flow.error = ''; } paint(); return; }
    if (act === 'flow-run') { runFlow(); return; }
    if (act === 'apps-state') { appsFilters().state = value; state.flow = null; paint(); return; }
    if (act === 'apps-kind') { appsFilters().kind = value; state.flow = null; paint(); return; }
    if (act === 'apps-more') { moreApps(); return; }
    if (act === 'app-decide') { openFlow('app', { id: el.getAttribute('data-id'), decision: value }); paint(); return; }
    if (act === 'contrib-state') { contribFilters().status = value; state.flow = null; paint(); return; }
    if (act === 'contrib-more') { moreContribs(); return; }
    if (act === 'contrib-decide') { openFlow('contrib', { id: el.getAttribute('data-id'), decision: value }); paint(); return; }
    if (act === 'users-status') { userFilters().status = value; paint(); return; }
    if (act === 'users-more') { moreUsers(); return; }
    if (act === 'queue-source') { queueFilters(scope).source = value; paint(); return; }
    if (act === 'queue-status') { queueFilters(scope).status = value; state.selection[scope] = {}; paint(); return; }
    if (act === 'batch') {
      var sel = state.selection[scope] || {};
      var entry = queueEntry(queueFilters(scope).status);
      var items = entry.status === 'ok' ? entry.data.items.filter(function (i) { return sel[i.id]; }) : [];
      openFlow('batch', { scope: scope, action: value, items: items }); paint(); return;
    }
    if (act === 'batch-clear') { state.selection[scope] = {}; if (state.flow && state.flow.kind === 'batch') state.flow = null; paint(); return; }
    if (act === 'param-ns') { (state.filters.params = state.filters.params || {}).ns = value; paint(); return; }
    if (act === 'open-param') { event.preventDefault(); state.drawer = { kind: 'param', ns: el.getAttribute('data-ns'), key: el.getAttribute('data-key'), enter: !state.drawer }; if (state.flow && state.flow.kind === 'param') state.flow = null; paint(); focusDrawer(); return; }
    if (act === 'param-edit') { var row = currentParam(); if (row) openFlow('param', { ns: row.namespace, key: row.key, mode: 'set', values: { value: String(row.value), when: 'now' } }); paint(); return; }
    if (act === 'param-when') { if (state.flow) state.flow.values.when = value; paint(); return; }
    if (act === 'param-rollback') {
      var prow = currentParam();
      var hist = prow ? historyEntry(prow) : null;
      var target = hist && hist.status === 'ok' ? (hist.data || []).filter(function (h) { return String(h.version) === value; })[0] : null;
      if (prow && target) openFlow('param', { ns: prow.namespace, key: prow.key, mode: 'rollback', toVersion: target.version, toValue: target.value });
      paint(); return;
    }
    if (act === 'flag') { openFlow('flag', { key: el.getAttribute('data-key') }); paint(); return; }
    if (act === 'exam') { var q = demo().games.exam[Number(el.getAttribute('data-index'))]; if (q) q.status = value; state.notice = '示例操作，没有写入服务器。'; paint(); return; }
    if (act === 'audit-reset') { state.filters.audit = { actor: '', action: '', target: '', from_at: '', to_at: '' }; paint(); return; }
    if (act === 'audit-more') { moreAudit(); }
  }

  function moreUsers() {
    var f = userFilters();
    var query = { q: f.q.trim() || null, status: f.status || null, level: f.level || null, role: f.role || null, limit: 30 };
    var entry = state.cache['users?' + JSON.stringify(query)];
    if (!entry || !entry.meta || !entry.meta.next_cursor) return;
    window.CommonsAPI.get('/admin/admin/users', Object.assign({}, query, { cursor: entry.meta.next_cursor })).then(function (res) {
      entry.more = (entry.more || []).concat(res.data); entry.meta = res.meta; paint();
    }).catch(function (error) { state.notice = error.message || '加载失败'; paint(); });
  }

  function moreAudit() {
    var keys = Object.keys(state.cache).filter(function (k) { return k.indexOf('audit?') === 0; });
    var entry = keys.length ? state.cache[keys[keys.length - 1]] : null;
    if (!entry || !entry.meta || !entry.meta.next_cursor) return;
    var f = auditFilters();
    var query = { actor: f.actor || null, action: f.action || null, target: f.target || null, cursor: entry.meta.next_cursor };
    window.CommonsAPI.get('/admin-console/audit', query).then(function (res) {
      entry.more = (entry.more || []).concat(res.data); entry.meta = res.meta; paint();
    }).catch(function (error) { state.notice = error.message || '加载失败'; paint(); });
  }

  function onInput(event) {
    var el = event.target;
    if (!state.root || !state.root.contains(el)) return;
    var name = el.getAttribute('data-adm-input');
    var flowName = el.getAttribute('data-adm-flow');
    if (flowName && state.flow) {
      state.flow.values[flowName] = el.value;
      if (state.flow.kind === 'param' && flowName === 'value') {
        state.root.querySelectorAll('[data-adm-flow="value"]').forEach(function (other) { if (other !== el) other.value = el.value; });
        refreshPreview();
      }
      return;
    }
    if (name === 'search') {
      state.search.q = el.value;
      clearTimeout(state.timers.search);
      state.timers.search = setTimeout(runSearch, live() ? 260 : 60);
      return;
    }
    if (name === 'users-q') {
      userFilters().q = el.value;
      clearTimeout(state.timers.users);
      state.timers.users = setTimeout(paint, live() ? 320 : 80);
    }
  }

  function onChange(event) {
    var el = event.target;
    if (!state.root || !state.root.contains(el)) return;
    var name = el.getAttribute('data-adm-change');
    var scope = el.getAttribute('data-scope');
    if (el.getAttribute('data-adm-flow') && state.flow) { state.flow.values[el.getAttribute('data-adm-flow')] = el.value; paint(); return; }
    if (name === 'users-level') { userFilters().level = el.value; paint(); return; }
    if (name === 'users-role') { userFilters().role = el.value; paint(); return; }
    if (name === 'queue-pick') {
      var sel = state.selection[scope] || (state.selection[scope] = {});
      if (el.checked) sel[el.getAttribute('data-id')] = true; else delete sel[el.getAttribute('data-id')];
      paint(); return;
    }
    if (name === 'queue-all') {
      var f = queueFilters(scope);
      var entry = queueEntry(f.status);
      var next = {};
      if (el.checked && entry.status === 'ok') entry.data.items.filter(function (i) { return (!f.allowed.length || f.allowed.indexOf(i.source) >= 0) && (!f.source || i.source === f.source); }).forEach(function (i) { next[i.id] = true; });
      state.selection[scope] = next; paint();
    }
  }

  function onSubmit(event) {
    var form = event.target.closest('[data-adm-form]');
    if (!form || !state.root || !state.root.contains(form)) return;
    event.preventDefault();
    var kind = form.getAttribute('data-adm-form');
    if (kind === 'flow') { submitFlow(); return; }
    if (kind === 'audit') {
      var data = {};
      new FormData(form).forEach(function (v, k) { data[k] = String(v).trim(); });
      state.filters.audit = data;
      invalidate('audit?');
      paint();
    }
  }

  function onKey(event) {
    if (event.key === 'Escape') {
      if (state.search.open) { state.search.open = false; paint(); return; }
      if (state.flow && state.flow.step !== 'running') { state.flow = null; paint(); return; }
      if (state.drawer) { closeDrawer(); paint(); return; }
      if (state.menuOpen) { state.menuOpen = false; paint(); }
      return;
    }
    if (event.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName || '') && state.root) {
      var box = state.root.querySelector('[data-adm-focus="search"]');
      if (box) { event.preventDefault(); box.focus(); }
    }
    if (event.key === 'Enter' && event.target.getAttribute && event.target.getAttribute('data-adm-input') === 'search') {
      event.preventDefault();
      clearTimeout(state.timers.search);
      runSearch();
    }
  }

  function on(target, type, handler) {
    target.addEventListener(type, handler);
    state.unbind.push(function () { target.removeEventListener(type, handler); });
  }

  function unbindAll() {
    state.unbind.forEach(function (unbind) { unbind(); });
    state.unbind = [];
  }

  function mount() {
    var root = document.querySelector('[data-admin-root]');
    if (!root) return;
    unbindAll();
    state.root = root;
    state.route = parseRoute();
    on(document, 'click', onClick);
    on(root, 'input', onInput);
    on(root, 'change', onChange);
    on(root, 'submit', onSubmit);
    on(document, 'keydown', onKey);
    if (state.menuOpen) { state.menuOpen = false; paint(); }
    afterPaint();
  }

  function destroy() {
    unbindAll();
    state.controllers.forEach(function (controller) { controller.abort(); });
    state.controllers = [];
    Object.keys(state.cache).forEach(function (key) { if (state.cache[key].status === 'loading') delete state.cache[key]; });
    Object.keys(state.timers).forEach(function (key) { clearTimeout(state.timers[key]); });
    state.timers = {};
    state.root = null;
  }

  window.CommonsAdmin = {
    routes: { admin: page },
    nav: [['admin', '管理后台', 'shield', 'personal']],
    bare: ['admin'],
    icons: { shield: 'M12 3 5 6v5c0 4.5 3 7.5 7 10 4-2.5 7-5.5 7-10V6z' },
    mount: mount,
    destroy: destroy
  };
  (window.CommonsPages = window.CommonsPages || []).push(window.CommonsAdmin);
})();
