/* R13 BIZ-1 · 会员方案 #/pricing、团队空间 #/teams、创作者中心 #/creator、赞助与招聘 #/sponsor。
   file:// 读 business-sample.js；live 模式读 /api/billing/*，出错只显示出错态和重试，不退回示例。
   支付未开通：所有按钮只记意向（候补名单、申请表），表单内容只存本机。 */
(function () {
  'use strict';

  var ICONS = {
    'biz-layers': 'M12 3 2.5 8 12 13l9.5-5L12 3zM2.5 12.5 12 17.5l9.5-5M2.5 16.5 12 21.5l9.5-5',
    'biz-creator': 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z',
    'biz-db': 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
    'biz-agent': 'M9 3h6M12 3v3M5 7h14v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7zM9.5 12h.01M14.5 12h.01M9 16h6',
    'biz-export': 'M12 3v12M7 10l5 5 5-5M4 19h16',
    'biz-invoice': 'M6 3h12v18l-3-2-3 2-3-2-3 2V3zM9 8h6M9 12h6M9 16h3',
    'biz-flow': 'M4 12a8 8 0 0 1 13.7-5.6M20 12a8 8 0 0 1-13.7 5.6M18 3v4h-4M6 21v-4h4',
    'biz-mega': 'M3 10v4h3l7 5V5L6 10H3zM16.5 9a4 4 0 0 1 0 6M19.5 6a8 8 0 0 1 0 12',
    'biz-minus': 'M5 12h14',
    'biz-plus': 'M12 5v14M5 12h14',
    'biz-x': 'M6 6l12 12M18 6 6 18'
  };
  var IMAGES = {
    pricing: ['assets/business/biz-members-club.webp', '玻璃会馆坐落在湖面上，一条步道通向门口'],
    teams: ['assets/business/biz-enterprise-team.webp', '几张工作台围着中间的共享空间，用光带连在一起'],
    creator: ['assets/business/biz-creator-earnings.webp', '一份作品经过棱镜，分成三路流向成员、作品和世界'],
    instructor: ['assets/business/biz-instructor-program.webp', '讲台前排着三块课程卡，台下是空着的座位'],
    sponsor: ['assets/business/biz-sponsor-partners.webp', '两座建筑之间架起一座桥，桥上排着工具图标']
  };
  var KEYS = {
    waitlist: 'business.waitlist',
    team: 'business.team-application',
    sponsor: 'business.sponsor-application',
    instructor: 'business.instructor-application'
  };
  var FREE_POINTS = ['全部知识、问题库和资源库', '讨论、动态与讲堂回看', '等级、成就与赛季榜', '乐园与竹子', '随时导出自己的数据'];
  var ALWAYS_FREE = [
    ['book', '知识与问题库'], ['people', '讨论与动态'], ['teach', '讲堂回看'],
    ['spark', '等级与成就'], ['heart', '乐园与竹子'], ['shield', '导出、注销与申诉']
  ];
  var FAQ = [
    ['会员能让我升级吗？', '不能。等级只看贡献；会员只在等级已解锁的能力上加额度。'],
    ['现在会扣款吗？', '不会。支付还没开通，候补名单只记意向，开通前会在站内通知你。'],
    ['竹子能换会员吗？', '不能。竹子是游戏币，不和钱、积分、贡献值互换。'],
    ['取消以后呢？', '随时取消，已付的周期用到期末；领过的会员装扮保留。'],
    ['赞助位怎么关？', 'L3 起和会员都能在账号里关掉。'],
    ['团队里每个人都要买吗？', '按席位算，5 席起，每席含先锋会员全部权益。']
  ];
  var TEAM_VALUES = [
    ['biz-db', '私有知识库', '问题卡和知识卡只在团队内可见，也能搜社区公开内容。'],
    ['biz-agent', '团队 Agent', '团队的 Agent 经 MCP 读团队库，权限跟着成员走。'],
    ['people', '成员管理', '邀请、角色、离队交接，一处管好。'],
    ['biz-export', '数据导出', 'Markdown 与 JSON，随时整库带走。'],
    ['biz-invoice', '对公发票', '对公转账，按年开具发票。'],
    ['biz-flow', '知识回流', '去敏后的问题卡可一键发到社区，贡献记在作者名下。']
  ];
  var TEAM_USES = ['内部知识库', 'Agent 开发', '团队培训', '研究与评测'];
  var TEAM_STARTS = ['本月', '下个月', '下个季度', '先看看'];
  var SPONSOR_TYPES = [['title', '活动冠名'], ['jobs', '招聘'], ['prize', '奖品赞助'], ['slot', '赞助位']];
  var SPONSOR_BUDGETS = ['¥5,000 以下', '¥5,000–20,000', '¥20,000 以上', '只提供奖品'];
  var SPONSOR_TIMES = ['本月', '下个季度', '还不确定'];
  var COURSE_FORMS = [['workshop', '小班工作坊'], ['one', '一对一']];
  var COURSE_PRICES = { workshop: ['¥149 / 席', '¥199 / 席', '¥299 / 席'], one: ['¥299 / 小时', '¥399 / 小时', '¥599 / 小时'] };
  var SOURCE_TONE = { work: 'blue', talk: 'violet', bounty: 'teal', question: 'sky' };
  var SOURCE_NAME = { work: '作品', talk: '讲堂', bounty: '悬赏', question: '问题卡' };
  var STATE_LABEL = { open: '可谈', beta: '内测可谈', later: '暂未开放' };

  var state = {
    apps: { status: 'idle', items: {}, busy: false, error: '', token: 0 },
    root: null, route: null, cycle: 'month', confirming: null, busy: null,
    seats: 8, teamCycle: 'year', teamUses: null, teamEditing: false,
    sponsorTypes: null, sponsorEditing: false,
    instructorOpen: false, courseForm: 'workshop',
    live: { status: 'idle', plans: null, me: null, error: '' }, loadToken: 0, cleanup: []
  };

  function C() { return window.Commons; }
  function esc(value) { return window.Commons.esc(value); }
  function icon(name) { return window.Commons.icon(name); }
  function sample() { return isLive() ? {} : (window.COMMONS_BUSINESS_SAMPLE || {}); }
  function isLive() { return !!(window.CommonsAPI && window.CommonsAPI.mode === 'live'); }
  function read(key, fallback) { return C().read(key, fallback); }
  function write(key, value) { return C().write(key, value); }
  function num(value) { return Number(value || 0).toLocaleString('zh-CN'); }
  function money(value) { return '¥' + Number(value || 0).toLocaleString('zh-CN', { maximumFractionDigits: 1 }); }
  function today() { var d = new Date(); return (d.getMonth() + 1) + '.' + String(d.getDate()).padStart(2, '0'); }

  function badge(text) { return '<span class="biz-badge">' + esc(text) + '</span>'; }

  function figure(key, extra) {
    var img = IMAGES[key];
    return '<figure class="biz-art ' + esc(extra || '') + '"><img data-biz-img src="' + C().safeUrl(img[0]) +
      '" width="1280" height="720" loading="lazy" decoding="async" alt="' + esc(img[1]) + '"></figure>';
  }

  /* ------------------------------------------------------------ 数据 */

  function plansData() { return isLive() ? state.live.plans : sample().plans; }

  function localWaitlist() {
    var stored = read(KEYS.waitlist, {});
    return stored && typeof stored === 'object' ? stored : {};
  }

  function waitlistEntry(planKey) {
    if (isLive()) {
      var me = state.live.me;
      return me && (me.waitlist || []).filter(function (w) { return w.plan === planKey; })[0] || null;
    }
    return localWaitlist()[planKey] || null;
  }

  function currentPlan() {
    if (isLive()) return state.live.me ? state.live.me.plan : null;
    return (sample().me || {}).plan || 'free';
  }

  function plan(key) {
    var data = plansData();
    return data ? (data.plans || []).filter(function (p) { return p.key === key; })[0] : null;
  }

  function benefitInfo(key) {
    var data = plansData();
    return data ? (data.benefits || []).filter(function (b) { return b.key === key; })[0] : null;
  }

  function amountText(unit, amount) {
    if (unit === 'megabyte') return amount % 1024 === 0 ? (amount / 1024) + ' GB' : num(amount) + ' MB';
    if (unit === 'slot') return amount + ' 个';
    return amount + ' 次';
  }

  function periodText(period) {
    return { month: ' / 月', season: ' / 赛季', account: '' }[period] || '';
  }

  function levelRange(benefit) {
    var levels = Object.keys(benefit.levels || {}).map(Number).sort(function (a, b) { return a - b; });
    if (!levels.length) return '—';
    var low = levels[0], high = levels[levels.length - 1];
    return 'L' + low + ' ' + amountText(benefit.unit, benefit.levels[low]) + ' → L' + high + ' ' + amountText(benefit.unit, benefit.levels[high]);
  }

  function priceParts(p, cycle) {
    var perSeat = p.perSeat ? '席 / ' : '';
    if (!p.price.month && !p.price.year) return { main: '¥0', unit: '', sub: '一直免费' };
    if (cycle === 'year') {
      return { main: money(p.price.year), unit: ' / ' + perSeat + '年', sub: '约 ' + money(p.price.year / 12) + ' / ' + perSeat + '月' };
    }
    return { main: money(p.price.month), unit: ' / ' + perSeat + '月', sub: '年付 ' + money(p.price.year) + '，相当于 10 个月' };
  }

  /* ------------------------------------------------------------ 会员方案 */

  function planPoints(p) {
    if (p.key === 'free') return FREE_POINTS;
    var points = [];
    if (p.scope === 'team') points.push('每席含先锋会员全部权益');
    (p.entitlements || []).forEach(function (e) {
      points.push(e.name + ' +' + amountText(e.unit, e.amount) + periodText(e.period) + (e.minLevel && e.minLevel > 2 ? '（L' + e.minLevel + ' 起）' : ''));
    });
    (p.perks || []).forEach(function (perk) {
      if (p.scope === 'team' && perk.description === '每席同先锋会员') return;
      points.push(perk.name);
    });
    return points.slice(0, p.scope === 'team' ? 6 : 7);
  }

  function planCta(p) {
    if (p.key === 'free') {
      return currentPlan() === 'free' ? '<span class="biz-current">' + icon('check') + '当前方案</span>' : '<span class="biz-current is-muted">基础方案</span>';
    }
    if (p.scope === 'team') return '<a class="button tonal large biz-wide" href="#/teams">了解团队空间</a>';
    var entry = waitlistEntry(p.key);
    if (currentPlan() === p.key) return '<span class="biz-current">' + icon('check') + '当前方案</span>';
    if (entry) {
      return '<div class="biz-joined" role="status"><span>' + icon('check') + '已在候补名单 · ' + (entry.cycle === 'year' ? '年付' : '月付') + '</span>' +
        '<button type="button" class="button ghost small" data-biz-act="leave" data-plan="' + esc(p.key) + '"' +
        (state.busy === 'leave' ? ' aria-busy="true"' : '') + '>退出候补</button></div>';
    }
    if (state.confirming === p.key) {
      return '<div class="biz-confirm" role="group" aria-label="确认加入候补"><p>不扣款。开通收费前会在站内通知你。</p>' +
        '<div class="biz-confirm-row"><button type="button" class="button primary" data-biz-act="join" data-plan="' + esc(p.key) + '"' +
        (state.busy === 'join' ? ' aria-busy="true"' : '') + '>确认加入 · ' + (state.cycle === 'year' ? '年付' : '月付') + '</button>' +
        '<button type="button" class="button ghost" data-biz-act="unconfirm">取消</button></div></div>';
    }
    return '<button type="button" class="button primary large biz-wide" data-biz-act="confirm" data-plan="' + esc(p.key) + '">加入候补名单</button>';
  }

  function planCard(p) {
    var price = priceParts(p, state.cycle);
    var featured = p.key === 'pioneer';
    return '<article class="biz-plan' + (featured ? ' is-featured' : '') + '" data-plan="' + esc(p.key) + '">' +
      '<header><h2>' + esc(p.name) + '</h2>' + (featured ? '<span class="biz-flag">推荐</span>' : '') + '</header>' +
      '<p class="biz-plan-tag">' + esc(p.tagline) + '</p>' +
      '<div class="biz-price" data-biz-price><strong>' + esc(price.main) + '</strong><span>' + esc(price.unit) + '</span></div>' +
      '<p class="biz-price-sub">' + esc(price.sub) + (p.scope === 'team' ? ' · ' + esc(p.minSeats) + ' 席起' : '') + '</p>' +
      '<div class="biz-plan-cta">' + planCta(p) + '</div>' +
      '<ul class="biz-points">' + planPoints(p).map(function (text) {
        return '<li>' + icon('check') + '<span>' + esc(text) + '</span></li>';
      }).join('') + '</ul></article>';
  }

  function compareCell(text, strong) {
    if (text === '✓') return '<td class="is-yes">' + icon('check') + '<span class="biz-sr">包含</span></td>';
    if (text === '—') return '<td class="is-no"><span aria-hidden="true">—</span><span class="biz-sr">不含</span></td>';
    return '<td' + (strong ? ' class="is-strong"' : '') + '>' + esc(text) + '</td>';
  }

  function compareTable() {
    var data = plansData();
    var pioneer = plan('pioneer'), team = plan('team');
    if (!data || !pioneer || !team) return '';
    function bonus(p, key) {
      var e = (p.entitlements || []).filter(function (x) { return x.benefitKey === key; })[0];
      if (!e) return '随等级';
      return '+' + amountText(e.unit, e.amount) + (e.minLevel && e.minLevel > 2 ? '（L' + e.minLevel + ' 起）' : '');
    }
    function has(p, key) { return (p.perks || []).some(function (x) { return x.key === key; }) ? '✓' : '—'; }
    var quotaRows = (data.benefits || []).map(function (b) {
      return '<tr><th scope="row">' + esc(b.name) + '<small>' + esc(periodText(b.period).replace(' / ', '每') || '账号上限') + '</small></th>' +
        compareCell(levelRange(b)) + compareCell(bonus(pioneer, b.key), true) + compareCell(bonus(team, b.key), true) + '</tr>';
    }).join('');
    var perkKeys = [];
    [pioneer, team].forEach(function (p) {
      (p.perks || []).forEach(function (perk) { if (perkKeys.indexOf(perk.key) < 0) perkKeys.push(perk.key); });
    });
    var perkRows = perkKeys.map(function (key) {
      var info = (pioneer.perks || []).concat(team.perks || []).filter(function (x) { return x.key === key; })[0];
      var free = key === 'ad_free' ? 'L3 起可关' : '—';
      return '<tr><th scope="row">' + esc(info.name) + '</th>' + compareCell(free) + compareCell(has(pioneer, key)) + compareCell(has(team, key)) + '</tr>';
    }).join('');
    return '<section class="biz-compare" aria-labelledby="biz-compare-title"><div class="biz-section-head"><h2 id="biz-compare-title">权益对比</h2>' +
      '<p>会员只在等级已解锁的能力上加额度。</p></div>' +
      '<div class="biz-table-wrap" tabindex="0" role="region" aria-labelledby="biz-compare-title"><table class="biz-table">' +
      '<thead><tr><th scope="col">权益</th><th scope="col">免费</th><th scope="col" class="is-featured">先锋会员</th><th scope="col">团队空间 · 每席</th></tr></thead>' +
      '<tbody><tr class="biz-group"><th colspan="4" scope="colgroup">额度</th></tr>' + quotaRows +
      '<tr class="biz-group"><th colspan="4" scope="colgroup">服务</th></tr>' + perkRows + '</tbody></table></div></section>';
  }

  function freeBand() {
    var data = plansData() || {};
    var never = (data.neverForSale || []).filter(function (x) { return x !== '知识'; });
    return '<section class="biz-free" aria-labelledby="biz-free-title"><h2 id="biz-free-title">永远免费</h2><ul>' +
      ALWAYS_FREE.map(function (item) { return '<li>' + icon(item[0]) + '<span>' + esc(item[1]) + '</span></li>'; }).join('') +
      '</ul>' + (never.length ? '<p>花钱也买不到：' + esc(never.join('、')) + '。</p>' : '') + '</section>';
  }

  function faq() {
    return '<section class="biz-faq" aria-labelledby="biz-faq-title"><div class="biz-section-head"><h2 id="biz-faq-title">常见问题</h2></div>' +
      FAQ.map(function (item) {
        return '<details><summary>' + esc(item[0]) + icon('biz-plus') + '</summary><p>' + esc(item[1]) + '</p></details>';
      }).join('') + '</section>';
  }

  function moreLinks(skip) {
    var links = [['teams', '团队空间'], ['creator', '创作者中心'], ['sponsor', '赞助与招聘'], ['pricing', '会员方案']];
    return '<nav class="biz-more" aria-label="商业相关页面">' + links.filter(function (l) { return l[0] !== skip; }).map(function (l) {
      return '<a href="#/' + l[0] + '">' + esc(l[1]) + icon('arrow') + '</a>';
    }).join('') + '</nav>';
  }

  function cycleSwitch(act, value) {
    return '<div class="segmented biz-cycle" role="group" aria-label="付款周期">' +
      '<button type="button" data-biz-act="' + esc(act) + '" data-value="month" aria-pressed="' + (value === 'month') + '">月付</button>' +
      '<button type="button" data-biz-act="' + esc(act) + '" data-value="year" aria-pressed="' + (value === 'year') + '">年付<span class="biz-save">省 2 个月</span></button></div>';
  }

  function stateBlock(kind, title, line, action) {
    return '<div class="biz-state is-' + esc(kind) + '" role="' + (kind === 'error' ? 'alert' : 'status') + '"><strong>' + esc(title) + '</strong><p>' + esc(line) + '</p>' +
      (action ? '<button type="button" class="button" data-biz-act="retry">' + esc(action) + '</button>' : '') + '</div>';
  }

  function pricingBody() {
    var top = '<div class="biz-ia-toolbar"><h2>会员方案</h2>' + badge('拟定') + cycleSwitch('cycle', state.cycle) + '</div>';
    if (isLive() && state.live.status !== 'ready') {
      var body = state.live.status === 'error'
        ? stateBlock('error', '方案没有读到', '请稍后重试。', '重试')
        : '<div class="biz-plans is-loading" aria-busy="true">' + [0, 1, 2].map(function () { return '<div class="biz-plan biz-skeleton"></div>'; }).join('') + '</div>';
      return top + body;
    }
    var data = plansData();
    if (!data || !Array.isArray(data.plans) || !data.plans.length) return top + stateBlock('empty', '暂无会员方案', '', '重试');
    return top + '<section class="biz-plans" aria-label="三档方案">' + (data.plans || []).map(planCard).join('') + '</section>' +
      '<details class="biz-ia-details"><summary>权益对比与常见问题</summary>' + freeBand() + compareTable() + faq() + '</details>';
  }

  function pricingSection() {
    return '<section class="biz-page biz-pricing" id="ia-pricing" data-biz-root="pricing" aria-label="会员方案">' + pricingBody() + '</section>';
  }

  /* ------------------------------------------------------------ 团队空间 */

  function teamPrice() {
    var p = plan('team') || (sample().plans && sample().plans.plans[2]);
    if (!p || !p.price) return null;
    var unit = state.teamCycle === 'year' ? p.price.year : p.price.month;
    return { p: p, total: unit * state.seats, unit: unit };
  }

  function chips(group, options, selected, labelId) {
    return '<div class="biz-chips" role="group" aria-labelledby="' + esc(labelId) + '">' + options.map(function (opt) {
      var value = Array.isArray(opt) ? opt[0] : opt, label = Array.isArray(opt) ? opt[1] : opt;
      return '<button type="button" class="chip" data-biz-act="chip" data-group="' + esc(group) + '" data-value="' + esc(value) + '" aria-pressed="' +
        (selected.indexOf(value) >= 0) + '">' + esc(label) + '</button>';
    }).join('') + '</div>';
  }

  function options(list, selected) {
    return list.map(function (item) {
      return '<option' + (item === selected ? ' selected' : '') + '>' + esc(item) + '</option>';
    }).join('');
  }

  function savedCard(title, rows, editAct, clearAct) {
    return '<div class="biz-saved" role="status"><div class="biz-saved-head">' + icon('check') + '<strong>' + esc(title) + '</strong></div><dl>' +
      rows.filter(function (r) { return r[1]; }).map(function (r) { return '<div><dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd></div>'; }).join('') +
      '</dl><div class="biz-saved-actions"><button type="button" class="button" data-biz-act="' + esc(editAct) + '">修改</button>' +
      '<button type="button" class="button ghost" data-biz-act="' + esc(clearAct) + '">撤回</button></div></div>';
  }

  // 真实模式没有收赞助 / 讲师申请的接口：不画表单，也不把申请写进本机再假装提交过。
  function closedBlock() {
    return '<div class="biz-saved" role="status"><div class="biz-saved-head"><strong>这个功能还没开放</strong></div><p>开放后会在这里通知你。</p></div>';
  }

  // 真实模式的团队申请就是「团队版候补名单」：只发席位和周期，服务器确认才算加入。
  function liveTeamBlock() {
    if (!state.live || !state.live.me) return '<div class="biz-saved" role="status"><p>登录后才能加入团队版候补名单。</p></div>';
    var entry = (state.live.me.waitlist || []).filter(function (w) { return w.plan === 'team'; })[0];
    var busy = state.busy ? ' disabled aria-busy="true"' : '';
    if (entry) {
      return '<div class="biz-saved" role="status"><div class="biz-saved-head">' + icon('check') + '<strong>已加入团队版候补名单</strong></div><dl>' +
        '<div><dt>席位</dt><dd>' + esc(entry.seats || '') + ' 席 · ' + (entry.cycle === 'year' ? '年付' : '月付') + '</dd></div></dl>' +
        '<div class="biz-saved-actions"><button type="button" class="button ghost" data-biz-act="team-clear"' + busy + '>退出候补</button></div></div>';
    }
    return '<div class="biz-form"><h3>加入团队版候补名单</h3><p>先登记席位和周期，开放后通知你。不会扣款。</p>' +
      '<div class="biz-form-foot"><button type="button" class="button primary" data-biz-act="team-join"' + busy + '>加入候补</button></div></div>';
  }

  function joinTeam() {
    if (!state.live || !state.live.me) { toast('登录后才能加入候补名单。'); return; }
    var api = window.CommonsAPI;
    state.busy = 'join';
    refresh();
    api.post('/billing/waitlist', { plan: 'team', cycle: state.teamCycle, seats: state.seats, source: 'teams' }, { idempotencyKey: api.newIdempotencyKey() })
      .then(function (res) {
        var entry = res.data.entry;
        state.live.me.waitlist = (state.live.me.waitlist || []).filter(function (w) { return w.plan !== entry.plan; }).concat([entry]);
        toast(res.data.duplicate ? '已更新候补名单。' : '已加入团队版候补名单，不会扣款。');
      })
      .catch(function (err) { toast(err && (err.status === 501 || err.code === 'capability_unavailable') ? '这个功能还没开放' : (err && err.message ? err.message : '没有加入成功，稍后再来。')); })
      .then(function () { state.busy = null; refresh(); });
  }

  function teamForm() {
    if (isLive()) return liveTeamBlock();
    var saved = read(KEYS.team, null);
    if (saved && !state.teamEditing) {
      return savedCard('申请已保存在本机，未发出', [
        ['团队', saved.name], ['席位', saved.seats + ' 席 · ' + (saved.cycle === 'year' ? '年付' : '月付')],
        ['用途', (saved.uses || []).join('、')], ['开始', saved.start], ['补充', saved.note]
      ], 'team-edit', 'team-clear');
    }
    var draft = saved || {};
    var uses = state.teamUses || draft.uses || [];
    return '<form class="biz-form" data-biz-form="team" aria-labelledby="biz-team-form-title">' +
      '<h3 id="biz-team-form-title">申请团队空间</h3>' +
      '<div class="field"><label for="biz-team-name">团队名称</label><input id="biz-team-name" name="name" required maxlength="40" autocomplete="organization" value="' + esc(draft.name || '') + '"></div>' +
      '<div class="field"><span class="biz-label" id="biz-team-uses">主要用途</span>' + chips('uses', TEAM_USES, uses, 'biz-team-uses') + '</div>' +
      '<div class="field"><label for="biz-team-start">什么时候开始</label><select id="biz-team-start" name="start">' + options(TEAM_STARTS, draft.start) + '</select></div>' +
      '<div class="field"><label for="biz-team-note">补充</label><textarea id="biz-team-note" name="note" rows="3" maxlength="200">' + esc(draft.note || '') + '</textarea></div>' +
      '<div class="biz-form-foot"><button type="submit" class="button primary">提交申请</button><span>只存本机，不会发出。</span></div></form>';
  }

  function teamsBody() {
    var tp = teamPrice();
    if (isLive() && !tp) return '<h1>团队空间</h1>' + stateBlock(state.live.status === 'error' ? 'error' : 'empty', state.live.status === 'error' ? '方案没有读到' : '暂无团队方案', '', '重试');
    var aside = '<div class="biz-head-price"><strong>' + money(tp.p.price.month) + '</strong><span> / 席 / 月</span>' + badge('拟定') +
      '<small>年付 ' + money(tp.p.price.year) + ' / 席 · ' + esc(tp.p.minSeats) + ' 席起 · 每席含先锋会员全部权益</small></div>' +
      '<div class="biz-head-actions"><a class="button primary large" href="#/teams" data-biz-act="scroll" data-target="biz-team-apply">申请团队空间</a>' +
      '<a class="button ghost large" href="#/pricing">看会员方案</a></div>';
    return '<header class="biz-head biz-head-split"><div class="biz-head-copy"><div class="biz-title"><h1>团队空间</h1></div>' +
      '<p>私有知识库和 Agent 席位，给 5 人以上的小组。</p>' + aside + '</div>' + figure('teams', 'biz-head-art') + '</header>' +
      '<section class="biz-values" aria-label="团队空间包含">' + TEAM_VALUES.map(function (v) {
        return '<article><span class="biz-value-icon">' + icon(v[0]) + '</span><h3>' + esc(v[1]) + '</h3><p>' + esc(v[2]) + '</p></article>';
      }).join('') + '</section>' +
      '<section class="biz-apply" id="biz-team-apply" aria-labelledby="biz-seats-title"><div class="biz-calc"><h3 id="biz-seats-title">算一算</h3>' +
      '<div class="biz-stepper" role="group" aria-label="席位数"><button type="button" class="button icon-only" data-biz-act="seats" data-value="-1" aria-label="减少一席"' +
      (state.seats <= tp.p.minSeats ? ' disabled' : '') + '>' + icon('biz-minus') + '</button>' +
      '<label class="biz-seat-input"><input type="number" inputmode="numeric" min="' + esc(tp.p.minSeats) + '" max="50" value="' + esc(state.seats) + '" data-biz-input="seats" aria-label="席位数"><span>席</span></label>' +
      '<button type="button" class="button icon-only" data-biz-act="seats" data-value="1" aria-label="增加一席"' + (state.seats >= 50 ? ' disabled' : '') + '>' + icon('biz-plus') + '</button></div>' +
      cycleSwitch('team-cycle', state.teamCycle) +
      '<div class="biz-total" aria-live="polite"><span>' + (state.teamCycle === 'year' ? '每年' : '每月') + '</span><strong data-biz-total>' + money(tp.total) + '</strong>' +
      '<small>' + esc(state.seats) + ' 席 × ' + money(tp.unit) + ' · 拟定</small></div></div>' + teamForm() + '</section>' + moreLinks('teams');
  }

  /* ------------------------------------------------------------ 创作者中心 */

  /* ---------------------------------------------------- 真实模式：赞助意向、讲师申请（只是申请表，不涉及钱） */
  var APP_STATE = { submitted: '已提交，等待审核', approved: '已通过', rejected: '这次没有通过' };
  var appKeys = {};

  function closedErr(error) { return !!error && (error.status === 501 || error.code === 'capability_unavailable'); }
  function failText(error, fallback) { return closedErr(error) ? '这个功能还没开放' : ((error && error.message) || fallback); }

  // 同一份内容失败后重试沿用上一次的幂等键，成功才换新的。
  function putApp(path, body) {
    var api = window.CommonsAPI, sig = path + ' ' + JSON.stringify(body);
    appKeys[sig] = appKeys[sig] || api.newIdempotencyKey();
    return Promise.resolve(api.put(path, body, { idempotencyKey: appKeys[sig] })).then(function (res) { delete appKeys[sig]; return res; });
  }

  function loadApps() {
    var token = ++state.apps.token;
    state.apps.status = 'loading';
    window.CommonsAPI.get('/social/applications').then(function (res) {
      if (token !== state.apps.token) return;
      var by = {};
      ((res.data && res.data.items) || []).forEach(function (item) { by[item.kind] = item; });
      state.apps.items = by; state.apps.status = 'ready'; state.apps.error = '';
      refresh();
    }).catch(function (error) {
      if (token !== state.apps.token) return;
      state.apps.status = 'error'; state.apps.error = failText(error, '申请记录没有读到');
      refresh();
    });
  }

  function liveApp(kind) { return state.apps.items[kind] || null; }
  function liveFields(kind) { var app = liveApp(kind); return app ? app.fields || {} : {}; }
  function canApply(kind) {
    var session = window.CommonsSession;
    return !(session && typeof session.can === 'function') || session.can('social.apply.' + kind);
  }
  // CommonsSession.reason(action)：被能力门挡住的原因；没有就用兜底句。
  function whyNot(kind, fallback) {
    var session = window.CommonsSession;
    return (session && typeof session.reason === 'function' && session.reason('social.apply.' + kind)) || fallback;
  }

  function appGate(kind) {
    if (state.apps.status === 'error') return stateBlock('error', '申请记录没有读到', state.apps.error, '重试').replace('data-biz-act="retry"', 'data-biz-act="apps-retry"');
    if (state.apps.status !== 'ready') return '<div class="biz-state is-loading" role="status"><strong>正在读取…</strong></div>';
    return '';
  }

  function liveSavedCard(app, rows, editAct, clearAct) {
    var title = APP_STATE[app.state] || '已提交';
    if (app.state === 'submitted') return savedCard(title, rows, editAct, clearAct);
    var note = app.decision_note ? [['审核说明', app.decision_note]] : [];
    return '<div class="biz-saved" role="status"><div class="biz-saved-head">' + icon('check') + '<strong>' + esc(title) + '</strong></div><dl>' +
      rows.concat(note).filter(function (r) { return r[1]; }).map(function (r) { return '<div><dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd></div>'; }).join('') +
      '</dl><div class="biz-saved-actions"><button type="button" class="button" data-biz-act="' + esc(editAct) + '">重新申请</button></div></div>';
  }

  function liveSponsorForm() {
    var gate = appGate('sponsor');
    if (gate) return gate;
    if (!canApply('sponsor')) return '<div class="biz-saved" role="status"><p>' + esc(whyNot('sponsor', '登录后才能提交合作意向')) + '。</p><button type="button" class="button primary" disabled title="' + esc(whyNot('sponsor', '登录后才能提交合作意向')) + '">提交意向</button></div>';
    var app = liveApp('sponsor'), f = liveFields('sponsor');
    if (app && !state.sponsorEditing) {
      var labels = SPONSOR_TYPES.filter(function (t) { return (f.types || []).indexOf(t[0]) >= 0; }).map(function (t) { return t[1]; });
      return liveSavedCard(app, [['公司或品牌', f.brand], ['合作', labels.join('、')], ['预算', f.budget], ['时间', f.time], ['说明', f.note]], 'sponsor-edit', 'sponsor-clear');
    }
    var types = state.sponsorTypes || f.types || [];
    return '<form class="biz-form" data-biz-form="sponsor" aria-labelledby="biz-sponsor-form-title"><h3 id="biz-sponsor-form-title">合作意向</h3>' +
      '<div class="field"><label for="biz-sp-brand">公司或品牌</label><input id="biz-sp-brand" name="brand" required maxlength="40" autocomplete="organization" value="' + esc(f.brand || '') + '"></div>' +
      '<div class="field"><span class="biz-label" id="biz-sp-types">想怎么合作</span>' + chips('types', SPONSOR_TYPES, types, 'biz-sp-types') + '</div>' +
      '<div class="biz-form-row"><div class="field"><label for="biz-sp-budget">预算</label><select id="biz-sp-budget" name="budget">' + options(SPONSOR_BUDGETS, f.budget) + '</select></div>' +
      '<div class="field"><label for="biz-sp-time">时间</label><select id="biz-sp-time" name="time">' + options(SPONSOR_TIMES, f.time) + '</select></div></div>' +
      '<div class="field"><label for="biz-sp-note">说明</label><textarea id="biz-sp-note" name="note" rows="3" maxlength="300" placeholder="产品、想见到的人、活动想法">' + esc(f.note || '') + '</textarea></div>' +
      '<div class="biz-form-foot"><button type="submit" class="button primary">提交意向</button><span>管理员审核后联系你。预算只作沟通参考，这里不收款、不报价。</span></div></form>';
  }

  function liveInstructorBlock() {
    var body, gate = appGate('lecturer');
    if (gate) body = gate;
    else if (!canApply('lecturer')) body = '<div class="biz-saved" role="status"><p>' + esc(whyNot('lecturer', '讲师计划需要 L3 及以上')) + '。</p><button type="button" class="button primary large" disabled title="' + esc(whyNot('lecturer', '讲师计划需要 L3 及以上')) + '">申请讲师计划</button></div>';
    else {
      var app = liveApp('lecturer'), f = liveFields('lecturer');
      if (state.instructorOpen) body = instructorForm(f, state.courseForm || f.form || 'workshop', true);
      else if (app) {
        var formLabel = COURSE_FORMS.filter(function (c) { return c[0] === f.form; }).map(function (c) { return c[1]; })[0] || '';
        body = liveSavedCard(app, [['课程', f.title], ['形式', formLabel], ['时长', f.length], ['拟定价格', f.price], ['补充', f.note]], 'instructor-edit', 'instructor-clear');
      } else body = '<button type="button" class="button primary large" data-biz-act="instructor-open">申请讲师计划</button>';
    }
    return '<section class="biz-instructor" aria-labelledby="biz-instructor-title"><div class="biz-instructor-copy"><h2 id="biz-instructor-title">讲师计划</h2>' +
      '<p>想开小班或一对一？提交申请，管理员审核后联系你。这里只收申请，不涉及付款。</p>' + /* safe: 本函数拼好的按钮、表单或已保存卡片，数据值已逐个转义 */ body + '</div></section>';
  }

  function liveSubmit(form) {
    var kind = form.getAttribute('data-biz-form');
    if (kind !== 'sponsor' && kind !== 'instructor') return;
    if (!form.reportValidity() || state.apps.busy) return;
    var values = {};
    Array.prototype.forEach.call(form.elements, function (field) { if (field.name) values[field.name] = String(field.value).trim(); });
    var path, body;
    if (kind === 'sponsor') {
      var types = state.sponsorTypes || liveFields('sponsor').types || [];
      if (!types.length) { toast('请至少选一种合作方式。'); return; }
      path = '/social/applications/sponsor';
      body = { brand: values.brand, types: types, budget: values.budget || '', time: values.time || '', note: values.note || '' };
    } else {
      path = '/social/applications/lecturer';
      body = { title: values.title, form: state.courseForm || liveFields('lecturer').form || 'workshop', length: values.length || '', price: values.price || '', note: values.note || '' };
    }
    var button = form.querySelector('[type="submit"]');
    state.apps.busy = true;
    if (button) button.disabled = true;
    putApp(path, body).then(function (res) {
      state.apps.items[res.data.kind] = res.data;
      state.sponsorEditing = false; state.instructorOpen = false; state.sponsorTypes = null;
      toast(kind === 'sponsor' ? '合作意向已提交，管理员审核后联系你。' : '讲师申请已提交，管理员审核后通知你。');
      state.apps.busy = false;
      refresh(kind === 'sponsor' ? '[data-biz-act="sponsor-edit"]' : '[data-biz-act="instructor-edit"]');
    }).catch(function (error) {
      state.apps.busy = false;
      if (button) button.disabled = false;
      toast(failText(error, '没有提交成功，输入还在，请重试。'));
    });
  }

  function liveWithdraw(kind) {
    if (state.apps.busy) return;
    var api = window.CommonsAPI, path = '/social/applications/' + kind, sig = 'DELETE ' + path;
    appKeys[sig] = appKeys[sig] || api.newIdempotencyKey();
    state.apps.busy = true;
    Promise.resolve(api.del(path, undefined, { idempotencyKey: appKeys[sig] })).then(function () {
      delete appKeys[sig];
      delete state.apps.items[kind];
      state.sponsorEditing = false; state.instructorOpen = false; state.sponsorTypes = null;
      state.apps.busy = false;
      toast('已撤回。');
      refresh();
    }).catch(function (error) {
      state.apps.busy = false;
      toast(failText(error, '没有撤回成功，请重试。'));
    });
  }

  function sparkline(weeks) {
    var max = Math.max.apply(null, weeks.concat([1]));
    var bars = weeks.map(function (value, i) {
      var h = Math.max(4, Math.round(value / max * 56));
      return '<rect x="' + (i * 14) + '" y="' + (60 - h) + '" width="9" height="' + h + '" rx="2"' + (i === weeks.length - 1 ? ' class="is-now"' : '') + '></rect>';
    }).join('');
    return '<svg class="biz-spark" preserveAspectRatio="xMinYMax meet" viewBox="0 0 ' + (weeks.length * 14 - 5) + ' 60" role="img" aria-label="近 ' + weeks.length + ' 周积分，本周 ' + esc(weeks[weeks.length - 1]) + '">' + bars + '</svg>';
  }

  function instructorForm(draft, form, liveMode) {
    return '<form class="biz-form" data-biz-form="instructor" aria-label="讲师计划申请">' +
        '<div class="field"><label for="biz-course-title">想开的课</label><input id="biz-course-title" name="title" required maxlength="40" placeholder="例如：用 Agent 做周报" value="' + esc(draft.title || '') + '"></div>' +
        '<div class="field"><span class="biz-label" id="biz-course-form">形式</span><div class="segmented" role="group" aria-labelledby="biz-course-form">' +
        COURSE_FORMS.map(function (f) {
          return '<button type="button" data-biz-act="course-form" data-value="' + f[0] + '" aria-pressed="' + (form === f[0]) + '">' + esc(f[1]) + '</button>';
        }).join('') + '</div></div>' +
        '<div class="biz-form-row"><div class="field"><label for="biz-course-length">时长</label><select id="biz-course-length" name="length">' +
        options(form === 'one' ? ['60 分钟', '90 分钟'] : ['2 小时 × 1 次', '90 分钟 × 3 次', '2 小时 × 4 次'], draft.length) + '</select></div>' +
        '<div class="field"><label for="biz-course-price">拟定价格</label><select id="biz-course-price" name="price">' + options(COURSE_PRICES[form], draft.price) + '</select></div></div>' +
        '<div class="field"><label for="biz-course-note">补充</label><textarea id="biz-course-note" name="note" rows="2" maxlength="200">' + esc(draft.note || '') + '</textarea></div>' +
        '<div class="biz-form-foot"><button type="submit" class="button primary">' + (liveMode ? '提交申请' : '保存申请') + '</button><button type="button" class="button ghost" data-biz-act="instructor-close">取消</button><span>' + (liveMode ? '管理员审核后通知你。价格只是你的设想，这里不收款。' : '只存本机，不会发出。') + '</span></div></form>';
  }

  function instructorBlock(data) {
    var saved = isLive() ? null : read(KEYS.instructor, null);
    var allMet = data.criteria.every(function (c) { return c.met; });
    var body;
    if (saved && !state.instructorOpen) {
      body = savedCard('申请已保存在本机，未发出', [
        ['课程', saved.title], ['形式', saved.formLabel], ['时长', saved.length], ['拟定价格', saved.price], ['补充', saved.note]
      ], 'instructor-edit', 'instructor-clear');
    } else if (state.instructorOpen) {
      body = instructorForm(saved || {}, (saved && saved.form) || state.courseForm, false);
    } else if (isLive()) {
      body = closedBlock();
    } else {
      body = '<button type="button" class="button primary large" data-biz-act="instructor-open"' + (allMet ? '' : ' disabled') + '>申请讲师计划</button>';
    }
    return '<section class="biz-instructor" aria-labelledby="biz-instructor-title">' + figure('instructor', 'biz-instructor-art') +
      '<div class="biz-instructor-copy"><h2 id="biz-instructor-title">讲师计划</h2><p>开小班或一对一，讲师得 ' + Math.round(data.share * 100) + '%，平台 ' + Math.round((1 - data.share) * 100) + '%（拟定）。</p>' +
      '<ul class="biz-criteria">' + data.criteria.map(function (c) {
        return '<li class="' + (c.met ? 'is-met' : '') + '">' + icon(c.met ? 'check' : 'clock') + '<span>' + esc(c.name) + '</span><small>' + esc(c.detail) + '</small></li>';
      }).join('') + '</ul>' + /* safe: 本函数拼好的按钮、表单或已保存卡片，数据值已逐个转义 */ body + '</div></section>';
  }

  function earningsTable(data) {
    var share = data.instructor.share;
    var rows = data.earnings.map(function (row) {
      return '<tr><td class="is-date">' + esc(row.date) + '</td><td>' + esc(row.source) + '</td><td class="is-num">' + money(row.gross) +
        '</td><td class="is-num">' + money(row.gross * (1 - share)) + '</td><td class="is-num is-strong">' + money(row.gross * share) +
        '</td><td><span class="biz-status">未结算</span></td></tr>';
    }).join('');
    var gross = data.earnings.reduce(function (sum, row) { return sum + row.gross; }, 0);
    return '<section class="biz-earnings" aria-labelledby="biz-earn-title"><div class="biz-section-head"><h2 id="biz-earn-title">收益明细</h2><p>支付开通后按月结算。</p></div>' +
      '<div class="biz-table-wrap" tabindex="0" role="region" aria-labelledby="biz-earn-title"><table class="biz-table biz-ledger"><thead><tr><th scope="col">日期</th><th scope="col">来源</th>' +
      '<th scope="col" class="is-num">成交</th><th scope="col" class="is-num">平台 15%</th><th scope="col" class="is-num">我得 85%</th><th scope="col">状态</th></tr></thead>' +
      '<tbody>' + rows + '</tbody><tfoot><tr><th scope="row" colspan="2">合计</th><td class="is-num">' + money(gross) + '</td><td class="is-num">' + money(gross * (1 - share)) +
      '</td><td class="is-num is-strong">' + money(gross * share) + '</td><td></td></tr></tfoot></table></div></section>';
  }

  function creatorBody() {
    if (isLive()) return '<h1>创作者中心</h1>' + stateBlock('empty', '暂无创作与收益记录', '') + liveInstructorBlock() + moreLinks('creator');
    var data = sample().creator;
    var top = '<div class="biz-ia-toolbar"><span>本赛季创作与收益</span>' + badge('示例') + '</div>';
    var t = data.totals;
    var pending = data.earnings.reduce(function (sum, row) { return sum + row.gross * data.instructor.share; }, 0);
    var total = data.sources.reduce(function (sum, s) { return sum + s.points; }, 0) || 1;
    var stats = '<section class="biz-stats" aria-label="' + esc(data.season) + '"><div class="biz-stat is-lead"><span>本赛季积分</span><strong>' + num(t.points) + '</strong>' + sparkline(data.weeks) + '</div>' +
      '<div class="biz-stat"><span>被复现</span><strong>' + num(t.reproduced) + '<small>次</small></strong></div>' +
      '<div class="biz-stat"><span>讲堂听众</span><strong>' + num(t.listeners) + '<small>人</small></strong></div>' +
      '<div class="biz-stat"><span>待结算收益</span><strong>' + money(pending) + '</strong><small class="biz-stat-note">支付开通后结算</small></div></section>';
    var sources = '<section class="biz-sources" aria-labelledby="biz-src-title"><div class="biz-section-head"><h2 id="biz-src-title">积分从哪来</h2><p>' + esc(data.season) + '</p></div>' +
      '<div class="biz-bar" role="img" aria-label="' + esc(data.sources.map(function (s) { return s.name + ' ' + s.points; }).join('，')) + '">' +
      data.sources.map(function (s) {
        return '<span class="tone-' + esc(SOURCE_TONE[s.key] || 'blue') + '" style="flex-grow:' + Math.round(s.points / total * 1000) + '"></span>';
      }).join('') + '</div><ul class="biz-legend">' + data.sources.map(function (s) {
        return '<li><i class="tone-' + esc(SOURCE_TONE[s.key] || 'blue') + '" aria-hidden="true"></i>' + esc(s.name) + '<strong>' + num(s.points) + '</strong></li>';
      }).join('') + '</ul><ol class="biz-top">' + data.top.map(function (item) {
        return '<li><span class="biz-kind tone-' + esc(SOURCE_TONE[item.kind] || 'blue') + '">' + esc(SOURCE_NAME[item.kind] || item.kind) + '</span><strong>' + esc(item.title) +
          '</strong><small>' + esc(item.note) + '</small><em>+' + num(item.points) + '</em></li>';
      }).join('') + '</ol></section>';
    return top + stats + '<div class="biz-creator-grid">' + sources + instructorBlock(data.instructor) + '</div>' + earningsTable(data) + moreLinks('creator');
  }

  /* ------------------------------------------------------------ 赞助与招聘 */

  function wire(key) {
    var blocks = {
      hot: '<i class="w-col"></i><i class="w-side"><b class="w-slot">赞助</b></i>',
      events: '<i class="w-banner"></i><i class="w-grid"><b></b><b class="w-slot">赞助</b><b></b></i>',
      market: '<i class="w-list"><b></b><b></b><b></b><b class="w-slot">赞助</b><b></b></i>',
      games: '<i class="w-tiles"><b></b><b></b><b></b><b></b></i><i class="w-foot w-slot">赞助</i>'
    };
    return '<div class="biz-wire-screen" data-wire="' + esc(key) + '" aria-hidden="true">' + (blocks[key] || '') + '</div>';
  }

  function sponsorForm() {
    if (isLive()) return liveSponsorForm();
    var saved = read(KEYS.sponsor, null);
    if (saved && !state.sponsorEditing) {
      return savedCard('意向已保存在本机，未发出', [
        ['公司或品牌', saved.brand], ['合作', (saved.typeLabels || []).join('、')], ['预算', saved.budget], ['时间', saved.time], ['说明', saved.note]
      ], 'sponsor-edit', 'sponsor-clear');
    }
    var draft = saved || {};
    var types = state.sponsorTypes || draft.types || [];
    return '<form class="biz-form" data-biz-form="sponsor" aria-labelledby="biz-sponsor-form-title"><h3 id="biz-sponsor-form-title">合作意向</h3>' +
      '<div class="field"><label for="biz-sp-brand">公司或品牌</label><input id="biz-sp-brand" name="brand" required maxlength="40" autocomplete="organization" value="' + esc(draft.brand || '') + '"></div>' +
      '<div class="field"><span class="biz-label" id="biz-sp-types">想怎么合作</span>' + chips('types', SPONSOR_TYPES, types, 'biz-sp-types') + '</div>' +
      '<div class="biz-form-row"><div class="field"><label for="biz-sp-budget">预算</label><select id="biz-sp-budget" name="budget">' + options(SPONSOR_BUDGETS, draft.budget) + '</select></div>' +
      '<div class="field"><label for="biz-sp-time">时间</label><select id="biz-sp-time" name="time">' + options(SPONSOR_TIMES, draft.time) + '</select></div></div>' +
      '<div class="field"><label for="biz-sp-note">说明</label><textarea id="biz-sp-note" name="note" rows="3" maxlength="300" placeholder="产品、想见到的人、活动想法">' + esc(draft.note || '') + '</textarea></div>' +
      '<div class="biz-form-foot"><button type="submit" class="button primary">提交意向</button><span>只存本机，不会发出。</span></div></form>';
  }

  function sponsorBody() {
    if (isLive()) return '<h1>赞助与招聘</h1>' + stateBlock('empty', '暂无赞助与招聘信息', '想冠名活动、招聘或赞助奖品？在下面提交合作意向，管理员审核后联系你。') + '<section class="biz-apply-card" aria-label="合作意向">' + sponsorForm() + '</section>' + moreLinks('sponsor');
    var data = sample().sponsor;
    var audience = '<ul class="biz-audience">' + data.audience.map(function (a) {
      return '<li><strong>' + esc(a.value) + '</strong><span>' + esc(a.label) + '</span></li>';
    }).join('') + '</ul><div class="biz-directions">' + data.directions.map(function (d) { return '<span>' + esc(d) + '</span>'; }).join('') + '</div>';
    var products = '<section class="biz-products" aria-labelledby="biz-prod-title"><div class="biz-section-head"><h2 id="biz-prod-title">合作方式</h2><p>价格均为拟定。</p></div><div class="biz-product-grid">' +
      data.products.map(function (p) {
        return '<article class="biz-product is-' + esc(p.state) + '"><header><h3>' + esc(p.name) + '</h3><span class="biz-status">' + esc(STATE_LABEL[p.state] || '') + '</span></header>' +
          '<div class="biz-product-price"><strong>' + esc(p.price) + '</strong><span>' + esc(p.unit) + '</span></div><p>' + esc(p.note) + '</p></article>';
      }).join('') + '</div></section>';
    var placements = '<section class="biz-placements" aria-labelledby="biz-place-title"><div class="biz-section-head"><h2 id="biz-place-title">赞助位在哪</h2><p>每个位置同时只有一家。</p></div><div class="biz-wire-grid">' +
      data.placements.map(function (p) {
        return '<figure class="biz-wire">' + wire(p.key) + '<figcaption><strong>' + esc(p.name) + '</strong><span>' + esc(p.reach) + '</span></figcaption></figure>';
      }).join('') + '</div></section>';
    var rules = '<section class="biz-rules" aria-labelledby="biz-rules-title"><h2 id="biz-rules-title">规矩</h2><ul>' +
      data.rules.map(function (r) { return '<li>' + icon('shield') + '<span>' + esc(r) + '</span></li>'; }).join('') + '</ul></section>';
    return '<header class="biz-head biz-head-split"><div class="biz-head-copy"><div class="biz-title"><h1>赞助与招聘</h1>' + badge('拟定') + '</div>' +
      '<p>面向 AI 实践者的活动冠名、招聘和赞助位。</p>' + audience + '</div>' + figure('sponsor', 'biz-head-art') + '</header>' +
      products + placements + '<div class="biz-sponsor-grid">' + rules + '<section class="biz-apply-card" aria-label="合作意向">' + sponsorForm() + '</section></div>' + moreLinks('sponsor');
  }

  /* ------------------------------------------------------------ 渲染与交互 */

  var BODIES = { pricing: pricingBody, teams: teamsBody, creator: creatorBody, sponsor: sponsorBody };

  /* safe-slot: body — 由本文件的视图函数拼好、数据值已逐个转义 */
  function page(route, body) {
    return '<div class="biz-page biz-' + esc(route) + '" data-biz-root="' + esc(route) + '">' + body + '</div>';
  }

  function refresh(focusSelector) {
    if (!state.root || !BODIES[state.route]) return;
    var active = document.activeElement;
    var key = focusSelector || (active && state.root.contains(active) && active.getAttribute('data-biz-act')
      ? '[data-biz-act="' + active.getAttribute('data-biz-act') + '"]' + (active.getAttribute('data-value') ? '[data-value="' + active.getAttribute('data-value') + '"]' : '')
      : null);
    state.root.innerHTML = BODIES[state.route]();
    bindImages();
    if (key) {
      var target = state.root.querySelector(key);
      if (target) target.focus({ preventScroll: true });
    }
  }

  function bindImages() {
    if (!state.root) return;
    Array.prototype.forEach.call(state.root.querySelectorAll('img[data-biz-img]'), function (img) {
      function hide() { var fig = img.closest('figure'); if (fig) fig.hidden = true; }
      if (img.complete && img.naturalWidth === 0 && img.getAttribute('src')) { hide(); return; }
      img.addEventListener('error', hide, { once: true });
      state.cleanup.push(function () { img.removeEventListener('error', hide); });
    });
  }

  function toast(text) { if (C().toast) C().toast(text); }

  function load() {
    var api = window.CommonsAPI;
    var token = ++state.loadToken;
    state.live = { status: 'loading', plans: null, me: null, error: '' };
    refresh();
    Promise.all([
      api.get('/billing/plans'),
      api.get('/billing/me').catch(function (err) { if (err && err.status === 401) return null; throw err; })
    ]).then(function (res) {
      if (token !== state.loadToken) return;
      state.live = { status: 'ready', plans: res[0].data, me: res[1] ? res[1].data : null, error: '' };
      refresh();
    }).catch(function (err) {
      if (token !== state.loadToken) return;
      state.live = { status: 'error', plans: null, me: null, error: err && err.message ? String(err.message) : '' };
      refresh();
    });
  }

  function join(planKey) {
    if (!isLive()) {
      var list = localWaitlist();
      list[planKey] = { plan: planKey, cycle: state.cycle, joinedAt: new Date().toISOString() };
      if (write(KEYS.waitlist, list)) toast('已加入候补名单，不会扣款。');
      state.confirming = null;
      refresh('[data-biz-act="leave"]');
      return;
    }
    if (!state.live.me) { toast('登录后才能加入候补名单。'); return; }
    var api = window.CommonsAPI;
    state.busy = 'join';
    refresh();
    api.post('/billing/waitlist', { plan: planKey, cycle: state.cycle, source: 'pricing' }, { idempotencyKey: api.newIdempotencyKey() })
      .then(function (res) {
        var entry = res.data.entry;
        state.live.me.waitlist = (state.live.me.waitlist || []).filter(function (w) { return w.plan !== entry.plan; }).concat([entry]);
        state.confirming = null;
        toast(res.data.duplicate ? '已更新候补名单。' : '已加入候补名单，不会扣款。');
      })
      .catch(function (err) { toast(err && err.message ? err.message : '没有加入成功，请重试。'); })
      .then(function () { state.busy = null; refresh('[data-biz-act="leave"]'); });
  }

  function leave(planKey) {
    if (!isLive()) {
      var list = localWaitlist();
      delete list[planKey];
      if (write(KEYS.waitlist, list)) toast('已退出候补名单。');
      refresh('[data-biz-act="confirm"]');
      return;
    }
    var api = window.CommonsAPI;
    state.busy = 'leave';
    refresh();
    api.post('/billing/waitlist/leave', { plan: planKey })
      .then(function () {
        state.live.me.waitlist = (state.live.me.waitlist || []).filter(function (w) { return w.plan !== planKey; });
        toast('已退出候补名单。');
      })
      .catch(function (err) { toast(err && err.message ? err.message : '没有退出成功，请重试。'); })
      .then(function () { state.busy = null; refresh('[data-biz-act="confirm"]'); });
  }

  function toggle(list, value) {
    var next = (list || []).slice();
    var at = next.indexOf(value);
    if (at >= 0) next.splice(at, 1); else next.push(value);
    return next;
  }

  function setSeats(value) {
    var p = plan('team') || (sample().plans && sample().plans.plans[2]);
    if (!p) return;
    var seats = Math.max(p.minSeats, Math.min(50, Math.round(Number(value) || p.minSeats)));
    state.seats = seats;
  }

  function onClick(event) {
    var el = event.target.closest('[data-biz-act]');
    if (!el || !state.root.contains(el)) return;
    var act = el.getAttribute('data-biz-act'), value = el.getAttribute('data-value');
    if (el.tagName === 'A' && act !== 'scroll') return;
    event.preventDefault();
    switch (act) {
      case 'cycle': state.cycle = value; refresh(); break;
      case 'team-cycle': state.teamCycle = value; refresh(); break;
      case 'confirm': state.confirming = el.getAttribute('data-plan'); refresh('[data-biz-act="join"]'); break;
      case 'unconfirm': state.confirming = null; refresh('[data-biz-act="confirm"]'); break;
      case 'join': if (!state.busy) join(el.getAttribute('data-plan')); break;
      case 'leave': if (!state.busy) leave(el.getAttribute('data-plan')); break;
      case 'retry': load(); break;
      case 'seats': setSeats(state.seats + Number(value)); refresh(); break;
      case 'scroll': {
        var target = document.getElementById(el.getAttribute('data-target'));
        if (target) {
          target.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
          var first = target.querySelector('input,button,select,textarea');
          if (first) first.focus({ preventScroll: true });
        }
        break;
      }
      case 'apps-retry': loadApps(); refresh(); break;
      case 'chip':
        if (el.getAttribute('data-group') === 'uses') state.teamUses = toggle(state.teamUses || (read(KEYS.team, {}) || {}).uses, value);
        else state.sponsorTypes = toggle(state.sponsorTypes || (isLive() ? liveFields('sponsor').types : (read(KEYS.sponsor, {}) || {}).types), value);
        el.setAttribute('aria-pressed', String(el.getAttribute('aria-pressed') !== 'true'));
        break;
      case 'course-form': state.courseForm = value; keepDraft('instructor'); refresh('[data-biz-act="course-form"][data-value="' + value + '"]'); break;
      case 'team-edit': state.teamEditing = true; refresh('#biz-team-name'); break;
      case 'team-join': if (isLive()) joinTeam(); break;
      case 'team-clear': if (isLive()) { leave('team'); break; } write(KEYS.team, null); state.teamEditing = false; state.teamUses = null; toast('申请已撤回。'); refresh(); break;
      case 'sponsor-edit': state.sponsorEditing = true; refresh('#biz-sp-brand'); break;
      case 'sponsor-clear': if (isLive()) { liveWithdraw('sponsor'); break; } write(KEYS.sponsor, null); state.sponsorEditing = false; state.sponsorTypes = null; toast('意向已撤回。'); refresh(); break;
      case 'instructor-open': state.instructorOpen = true; refresh('#biz-course-title'); break;
      case 'instructor-edit': state.instructorOpen = true; state.courseForm = (isLive() ? liveFields('lecturer') : (read(KEYS.instructor, {}) || {})).form || 'workshop'; refresh('#biz-course-title'); break;
      case 'instructor-close': state.instructorOpen = false; refresh('[data-biz-act="instructor-open"]'); break;
      case 'instructor-clear': if (isLive()) { liveWithdraw('lecturer'); break; } write(KEYS.instructor, null); state.instructorOpen = false; toast('申请已撤回。'); refresh(); break;
      default: break;
    }
  }

  function keepDraft(kind) {
    var form = state.root && state.root.querySelector('[data-biz-form="' + kind + '"]');
    if (!form || kind !== 'instructor') return;
    var title = form.querySelector('[name="title"]'), note = form.querySelector('[name="note"]');
    var draft = read(KEYS.instructor, null);
    state.instructorDraft = { title: title ? title.value : '', note: note ? note.value : '' };
    if (!draft) {
      var input = state.instructorDraft;
      setTimeout(function () {
        if (!state.root) return;
        var t = state.root.querySelector('#biz-course-title'), n = state.root.querySelector('#biz-course-note');
        if (t && !t.value) t.value = input.title;
        if (n && !n.value) n.value = input.note;
      }, 0);
    }
  }

  function onSubmit(event) {
    var form = event.target.closest('[data-biz-form]');
    if (!form) return;
    event.preventDefault();
    if (isLive()) { liveSubmit(form); return; }
    if (!form.reportValidity()) return;
    var values = {};
    Array.prototype.forEach.call(form.elements, function (field) { if (field.name) values[field.name] = String(field.value).trim(); });
    var kind = form.getAttribute('data-biz-form');
    if (kind === 'team') {
      var saved = { name: values.name, uses: state.teamUses || (read(KEYS.team, {}) || {}).uses || [], start: values.start, note: values.note,
        seats: state.seats, cycle: state.teamCycle, savedAt: new Date().toISOString() };
      if (write(KEYS.team, saved)) {
        state.teamEditing = false;
        toast('申请已保存在本机，未发出。');
        if (isLive() && window.CommonsAPI) {
          window.CommonsAPI.post('/billing/waitlist', { plan: 'team', cycle: state.teamCycle, seats: state.seats, source: 'teams' },
            { idempotencyKey: window.CommonsAPI.newIdempotencyKey() }).catch(function () { toast('候补名单没有记上，申请仍在本机。'); });
        }
        refresh('[data-biz-act="team-edit"]');
      }
    } else if (kind === 'sponsor') {
      var types = state.sponsorTypes || (read(KEYS.sponsor, {}) || {}).types || [];
      var labels = SPONSOR_TYPES.filter(function (t) { return types.indexOf(t[0]) >= 0; }).map(function (t) { return t[1]; });
      if (write(KEYS.sponsor, { brand: values.brand, types: types, typeLabels: labels, budget: values.budget, time: values.time, note: values.note, savedAt: new Date().toISOString() })) {
        state.sponsorEditing = false;
        toast('意向已保存在本机，未发出。');
        refresh('[data-biz-act="sponsor-edit"]');
      }
    } else if (kind === 'instructor') {
      var formKey = state.courseForm;
      var label = COURSE_FORMS.filter(function (f) { return f[0] === formKey; })[0][1];
      if (write(KEYS.instructor, { title: values.title, form: formKey, formLabel: label, length: values.length, price: values.price, note: values.note, savedAt: new Date().toISOString() })) {
        state.instructorOpen = false;
        toast('申请已保存在本机，未发出。');
        refresh('[data-biz-act="instructor-edit"]');
      }
    }
  }

  function onInput(event) {
    var el = event.target;
    if (el.getAttribute('data-biz-input') !== 'seats' || event.type !== 'change') return;
    setSeats(el.value);
    refresh('[data-biz-input="seats"]');
  }

  function on(target, type, handler) {
    target.addEventListener(type, handler);
    state.cleanup.push(function () { target.removeEventListener(type, handler); });
  }

  function mount() {
    var root = document.querySelector('[data-biz-root]');
    if (!root) return;
    state.root = root;
    state.route = root.getAttribute('data-biz-root');
    on(root, 'click', onClick);
    on(root, 'submit', onSubmit);
    on(root, 'change', onInput);
    bindImages();
    if (isLive() && (state.route === 'pricing' || state.route === 'teams') && state.live.status === 'idle') load();
    if (isLive() && (state.route === 'sponsor' || state.route === 'creator') && state.apps.status !== 'loading') loadApps();
  }

  function destroy() {
    state.cleanup.forEach(function (fn) { fn(); });
    state.cleanup = [];
    state.root = null;
    state.loadToken += 1;
    state.confirming = null;
    state.busy = null;
    state.teamEditing = false;
    state.sponsorEditing = false;
    state.instructorOpen = false;
    state.teamUses = null;
    state.sponsorTypes = null;
    if (state.live.status !== 'ready') state.live = { status: 'idle', plans: null, me: null, error: '' };
  }

  function route(name) {
    return function () {
      if (isLive() && name === 'pricing' && state.live.status === 'ready') state.live.status = 'idle';
      return page(name, BODIES[name]());
    };
  }

  window.CommonsBusiness = {
    routes: { pricing: function () { return window.CommonsGrowth.routes.pricing(); }, teams: route('teams'), creator: route('creator'), sponsor: route('sponsor') },
    hub: ['pricing', 'creator'],
    nav: [['pricing', '会员方案', 'biz-layers', 'growth'], ['creator', '创作者中心', 'biz-creator', 'personal']],
    icons: ICONS,
    titles: { teams: '团队空间', sponsor: '赞助与招聘' },
    pricingSection: pricingSection,
    mount: mount,
    destroy: destroy
  };
  (window.CommonsPages = window.CommonsPages || []).push(window.CommonsBusiness);
})();
