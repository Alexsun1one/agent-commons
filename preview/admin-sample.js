/* R13 ADMIN-4 · 管理后台示例数据：只在示例模式使用；live 模式不回退到这里。 */
(function () {
  'use strict';

  var NOW = '2026-10-25T14:20:00.000000Z';
  function ago(minutes) { return new Date(Date.parse(NOW) - minutes * 60000).toISOString(); }
  function later(minutes) { return new Date(Date.parse(NOW) + minutes * 60000).toISOString(); }
  function days(start, values) {
    var base = Date.parse('2026-10-12T00:00:00Z');
    return values.map(function (value, i) { return { day: new Date(base + i * 86400000).toISOString().slice(0, 10), value: value }; });
  }

  var people = [
    ['p-01', 'linqi', '林栖', 5, 'active', ['admin'], 4820, 1260, 312, 26, 3, 0, 4200],
    ['p-02', 'zhouyu', '周屿', 4, 'active', ['governor'], 3110, 860, 145, 11, 12, 0, 9000],
    ['p-03', 'acheng', '阿澄', 3, 'active', [], 1290, 420, 88, 4, 40, 0, 20000],
    ['p-04', 'sumu', '苏木', 3, 'active', ['host'], 1985, 610, 233, 7, 75, 0, 30000],
    ['p-05', 'chengye', '程野', 2, 'active', [], 640, 120, 1840, 2, 18, 1, 6000],
    ['p-06', 'xiaoman', '小满', 1, 'active', [], 35, 0, 66, 0, 5, 0, 900],
    ['p-07', 'songzy', '宋知遥', 3, 'active', [], 1480, 300, 97, 3, 260, 0, 25000],
    ['p-08', 'xutang', '许棠', 2, 'suspended', [], 210, 15, 4, 0, 2900, 2, 12000],
    ['p-09', 'luming', '陆鸣', 2, 'active', [], 520, 80, 1210, 9, 30, 1, 3000],
    ['p-10', 'baihua', '白桦', 1, 'active', [], 12, 0, 20, 0, 1400, 0, 1500],
    ['p-11', 'jiangwan', '江晚', 4, 'active', [], 2640, 720, 410, 5, 9, 0, 40000],
    ['p-12', 'wenzhou', '闻舟', 1, 'pending_deletion', [], 60, 0, 0, 0, 4300, 0, 18000],
    ['p-13', 'keyi', '柯一', 2, 'active', [], 330, 40, 155, 1, 52, 0, 7000],
    ['p-14', 'xiamu', '夏木', 1, 'active', [], 8, 0, 30, 0, 95, 0, 300]
  ];
  var users = people.map(function (p) {
    return {
      id: p[0], handle: p[1], name: p[2], level: p[3], status: p[4], roles: p[5], contribution: p[6], points: p[7],
      bamboo: p[8], invitees: p[9], last_seen_at: ago(p[10]), sanctions: p[11], created_at: ago(p[12] * 10)
    };
  });

  var detail = {
    'p-05': {
      inviter: { id: 'p-02', handle: 'zhouyu', name: '周屿', created_at: ago(60000) },
      invitees: { total: 2, items: [
        { id: 'p-13', handle: 'keyi', name: '柯一', level: 2, status: 'active', invitees: 1, created_at: ago(70000) },
        { id: 'p-14', handle: 'xiamu', name: '夏木', level: 1, status: 'active', invitees: 0, created_at: ago(3000) }
      ] },
      recent: [
        { id: 'a-1', occurred_at: ago(18), action: 'farm.steal', target_type: 'farm_plot', outcome: 'ok' },
        { id: 'a-2', occurred_at: ago(40), action: 'economy.shop.buy', target_type: 'shop_item', outcome: 'ok' },
        { id: 'a-3', occurred_at: ago(95), action: 'parking.ticket', target_type: 'parking_stay', outcome: 'ok' },
        { id: 'a-4', occurred_at: ago(300), action: 'object.create', target_type: 'object', outcome: 'ok' },
        { id: 'a-5', occurred_at: ago(1500), action: 'events.vote', target_type: 'event', outcome: 'denied' }
      ],
      sanctions: [
        { id: 's-1', action_type: 'rate_limit', state: 'executed', reason: '一小时内连发 9 条相似广告帖', actor_kind: 'system', created_at: ago(2900), expires_at: ago(1460) }
      ]
    },
    'p-08': {
      inviter: { id: 'p-03', handle: 'acheng', name: '阿澄', created_at: ago(120000) },
      invitees: { total: 0, items: [] },
      recent: [
        { id: 'a-6', occurred_at: ago(2900), action: 'auth.login', target_type: 'session', outcome: 'denied' },
        { id: 'a-7', occurred_at: ago(3100), action: 'object.create', target_type: 'object', outcome: 'ok' }
      ],
      sanctions: [
        { id: 's-2', action_type: 'ban', state: 'executed', reason: '市集转售 API key，二次确认后封禁', actor_kind: 'governor', created_at: ago(3000), expires_at: null },
        { id: 's-3', action_type: 'hide', state: 'executed', reason: '违禁品类：账号买卖', actor_kind: 'governor', created_at: ago(3010), expires_at: null }
      ]
    }
  };

  var queue = [
    { id: 'gov:c-101', ref_id: 'c-101', source: 'content_report', category: 'contact', risk: 'high', status: 'open', target: { type: 'object', id: 'o-8f2c41', object_type: 'discussion' }, subject: { id: 'p-09', handle: 'luming', name: '陆鸣' }, reports: 4, opened_at: ago(260), due_at: ago(20), overdue: true, writeback: { dismiss: '/api/governance/cases/c-101/dismiss', act: '/api/governance/cases/c-101/actions' } },
    { id: 'gov:c-102', ref_id: 'c-102', source: 'market', category: 'illegal', risk: 'critical', status: 'open', target: { type: 'object', id: 'o-m7741a', object_type: 'market_listing' }, subject: { id: 'p-10', handle: 'baihua', name: '白桦' }, reports: 6, opened_at: ago(90), due_at: later(30), overdue: false, writeback: { dismiss: '/api/governance/cases/c-102/dismiss', act: '/api/governance/cases/c-102/actions' } },
    { id: 'eco:e-201', ref_id: 'e-201', source: 'economy', origin: 'economy.anomaly', category: 'pair_roundtrip', risk: 'high', status: 'open', target: { type: 'principal', id: 'p-05', peer_id: 'p-13', amount: 1460 }, subject: { id: 'p-05', handle: 'chengye', name: '程野' }, reports: 0, opened_at: ago(70), due_at: null, overdue: false, writeback: { dismiss: '/api/admin/economy/anomalies/e-201/resolve', act: null, reasonless: false } },
    { id: 'gov:c-103', ref_id: 'c-103', source: 'governance', category: 'spam', risk: 'medium', status: 'triaged', target: { type: 'object', id: 'o-1d93e0', object_type: 'reply' }, subject: { id: 'p-14', handle: 'xiamu', name: '夏木' }, reports: 0, opened_at: ago(150), due_at: later(210), overdue: false, writeback: { dismiss: '/api/governance/cases/c-103/dismiss', act: '/api/governance/cases/c-103/actions' } },
    { id: 'vote:v-301', ref_id: 'v-301', source: 'campaign', origin: 'events.vote_anomaly', category: 'invite_tree', risk: 'medium', status: 'open', target: { type: 'event', id: 'ev-autumn-agents' }, subject: null, reports: 0, opened_at: ago(45), due_at: null, overdue: false, writeback: { dismiss: '/api/admin/events/vote-anomalies/v-301/resolve', act: null, reasonless: false } },
    { id: 'gov:c-104', ref_id: 'c-104', source: 'content_report', category: 'misinformation', risk: 'medium', status: 'open', target: { type: 'object', id: 'o-77ab10', object_type: 'problem' }, subject: { id: 'p-13', handle: 'keyi', name: '柯一' }, reports: 2, opened_at: ago(400), due_at: later(500), overdue: false, writeback: { dismiss: '/api/governance/cases/c-104/dismiss', act: '/api/governance/cases/c-104/actions' } },
    { id: 'gov:c-105', ref_id: 'c-105', source: 'content_report', category: 'copyright', risk: 'low', status: 'open', target: { type: 'object', id: 'o-3c0f9e', object_type: 'prompt' }, subject: { id: 'p-07', handle: 'songzy', name: '宋知遥' }, reports: 1, opened_at: ago(520), due_at: later(900), overdue: false, writeback: { dismiss: '/api/governance/cases/c-105/dismiss', act: '/api/governance/cases/c-105/actions' } },
    { id: 'gov:c-106', ref_id: 'c-106', source: 'market', category: 'spam', risk: 'low', status: 'open', target: { type: 'object', id: 'o-m2210f', object_type: 'market_listing' }, subject: { id: 'p-09', handle: 'luming', name: '陆鸣' }, reports: 1, opened_at: ago(610), due_at: later(820), overdue: false, writeback: { dismiss: '/api/governance/cases/c-106/dismiss', act: '/api/governance/cases/c-106/actions' } },
    { id: 'mkt:r-77', ref_id: 'r-77', source: 'market', origin: 'market.report', category: 'scam', risk: 'high', status: 'open', target: { type: 'object', id: 'o-m9c03d', object_type: 'market_listing' }, subject: { id: 'p-13', handle: 'keyi', name: '柯一' }, reports: 2, opened_at: ago(35), due_at: null, overdue: false, writeback: { dismiss: '/api/admin/market/reports/r-77/close', act: null, reasonless: false, actions: ['close', 'hide', 'pending_review'] } },
    { id: 'vote:v-302', ref_id: 'v-302', source: 'campaign', origin: 'events.vote_anomaly', category: 'burst', risk: 'medium', status: 'open', target: { type: 'event', id: 'ev-prompt-cup' }, subject: null, reports: 0, opened_at: ago(30), due_at: null, overdue: false, writeback: { dismiss: '/api/admin/events/vote-anomalies/v-302/resolve', act: null, reasonless: false } },
    { id: 'eco:e-202', ref_id: 'e-202', source: 'economy', origin: 'economy.anomaly', category: 'daily_net_inflow', risk: 'medium', status: 'open', target: { type: 'principal', id: 'p-09', amount: 640 }, subject: { id: 'p-09', handle: 'luming', name: '陆鸣' }, reports: 0, opened_at: ago(200), due_at: null, overdue: false, writeback: { dismiss: '/api/admin/economy/anomalies/e-202/resolve', act: null, reasonless: false } }
  ];

  function param(ns, key, value, def, min, max, unit, label, desc, risk, version, wired, extra) {
    return Object.assign({ namespace: ns, key: key, value: value, effective_value: value, default_value: def, min_value: min, max_value: max, unit: unit, label: label, description: desc, risk: risk, version: version, wired: wired, module_loaded: true, pending: [], handle: version > 1 ? 'linqi' : null, updated_at: version > 1 ? ago(800) : '2026-10-25T00:00:00.000000Z' }, extra || {});
  }
  var params = [
    param('economy', 'daily_credit_cap', 300, 300, 0, 2000, '竹子/天', '每日获得上限', '每人每天最多获得的竹子', 'high', 1, true),
    param('economy', 'new_account_days', 7, 7, 0, 30, '天', '新号减半期', '注册后这些天内获得上限减半', 'normal', 1, true),
    param('economy', 'checkin_day_1', 5, 5, 0, 100, '竹子', '签到第 1 天', '连续签到第 1 天奖励', 'normal', 1, true),
    param('economy', 'checkin_day_2', 8, 8, 0, 100, '竹子', '签到第 2 天', '连续签到第 2 天奖励', 'normal', 1, true),
    param('economy', 'checkin_day_3', 12, 12, 0, 100, '竹子', '签到第 3 天', '连续签到第 3 天奖励', 'normal', 1, true),
    param('economy', 'checkin_day_4', 16, 16, 0, 100, '竹子', '签到第 4 天', '连续签到第 4 天奖励', 'normal', 1, true),
    param('economy', 'checkin_day_5', 20, 20, 0, 100, '竹子', '签到第 5 天', '连续签到第 5 天奖励', 'normal', 1, true),
    param('economy', 'checkin_day_6', 25, 25, 0, 100, '竹子', '签到第 6 天', '连续签到第 6 天奖励', 'normal', 1, true),
    param('economy', 'checkin_day_7', 35, 35, 0, 100, '竹子', '签到第 7 天', '连续签到第 7 天奖励', 'high', 1, true),
    param('farm', 'steal_daily_limit', 15, 20, 0, 50, '次/天', '每日偷菜上限', '每人每天最多偷菜次数', 'normal', 3, true),
    param('farm', 'steal_percent', 10, 10, 1, 30, '%', '单次偷取比例', '每次最多偷走成熟作物的比例', 'normal', 1, true),
    param('farm', 'min_owner_percent', 70, 70, 50, 95, '%', '主人保底比例', '无论被偷几次，主人至少留下的比例', 'normal', 1, true),
    param('farm', 'steal_limit_per_cycle', 3, 3, 0, 10, '次', '单轮偷菜上限', '每轮成熟期最多被偷次数', 'normal', 1, true),
    param('farm', 'help_daily_limit', 10, 10, 0, 50, '次/天', '每日帮忙上限', '每人每天帮好友浇水除虫的次数', 'normal', 1, true),
    param('farm', 'watchdog_hours', 8, 8, 1, 48, '小时', '看门时长', '看门保护持续时间', 'normal', 1, true),
    param('parking', 'max_hours', 12, 12, 1, 48, '小时', '单次停车上限', '单次停车最多计费时长', 'normal', 1, true),
    param('parking', 'max_rate', 12, 12, 1, 50, '竹子/小时', '车位每小时收益上限', '任何车型每小时收益的封顶值', 'high', 2, true, { value: 10, effective_value: 12, pending: [{ version: 2, value: 10, effective_at: later(17 * 60) }] }),
    param('parking', 'daily_tickets', 10, 10, 0, 30, '次/天', '每日贴条上限', '每位车位主人每天最多贴条次数', 'normal', 1, true),
    param('parking', 'ticket_fine_percent', 20, 20, 0, 100, '%', '贴条罚金比例', '贴条从停车收益中扣除的比例', 'high', 1, true),
    param('games', 'exam_questions', 10, 10, 1, 50, '题', '模拟考题数', '每场模拟考抽取题目数量', 'normal', 1, true),
    param('games', 'sofa_reward', 3, 3, 0, 20, '竹子', '抢沙发奖励', '新帖前三个有效回复各得的竹子', 'high', 1, true),
    param('games', 'exam_seconds', 600, 600, 300, 3600, '秒', '模拟考时限', '每场模拟考的作答时长', 'normal', 1, true),
    param('games', 'sofa_daily_limit', 5, 5, 0, 30, '次/天', '沙发奖励上限', '每人每天可获得沙发奖励的次数', 'normal', 1, true),
    param('events', 'daily_votes', 3, 3, 1, 10, '票/天', '打榜每日票数', '每人每天可投票数', 'normal', 1, true),
    param('events', 'new_account_days', 7, 7, 0, 30, '天', '新号投票限制', '注册后这些天内限制投票', 'normal', 1, true),
    param('events', 'burst_votes', 20, 20, 5, 200, '票', '短时投票阈值', '短时间集中投票的告警阈值', 'high', 1, true),
    param('market', 'l1_daily_listings', 2, 2, 0, 20, '条/天', 'L1 每日发布', '一级成员每日可发布条数', 'normal', 1, true),
    param('market', 'expire_days', 30, 30, 7, 90, '天', '自动过期天数', '发布后多少天自动过期', 'normal', 1, true),
    param('bounty', 'minimum_credits', 10, 10, 1, 1000, '积分', '悬赏最低积分', '发布积分悬赏的最低额度', 'normal', 1, true),
    param('announce', 'ads_per_screen', 1, 1, 0, 1, '个', '每屏广告位上限', '一屏最多出现的赞助位数量', 'normal', 1, false, { module_loaded: false })
  ];
  var history = {
    'farm.steal_daily_limit': [
      { version: 3, value: 15, previous_value: 25, kind: 'rollback', rollback_of: 2, effective_at: ago(800), reason: '周末偷菜投诉增多，先回到 15', actor_handle: 'linqi', created_at: ago(800) },
      { version: 2, value: 25, previous_value: 20, kind: 'set', effective_at: ago(4000), reason: '秋收活动放宽一周', actor_handle: 'zhouyu', created_at: ago(4000) },
      { version: 1, value: 20, previous_value: null, kind: 'seed', effective_at: '2026-10-25T00:00:00.000000Z', reason: '初始值', actor_handle: null, created_at: '2026-10-25T00:00:00.000000Z' }
    ]
  };

  window.COMMONS_ADMIN_SAMPLE = {
    now: NOW,
    viewer: { id: 'p-01', handle: 'linqi', display_name: '林栖', roles: ['admin'], totp_enabled: true },
    overview: {
      as_of: NOW, day: '2026-10-25',
      cards: {
        active_today: { value: 214, previous: 198, status: 'ok' },
        new_members_today: { value: 17, previous: 22, status: 'ok' },
        posts_today: { value: 96, previous: 81, status: 'ok' },
        solved_today: { value: 23, previous: 19, status: 'ok' },
        reports_pending: { value: 8, previous: null, status: 'ok', opened_yesterday: 11 },
        anomalies_today: { value: 4, previous: 1, status: 'ok' },
        bamboo_net_today: { value: 18420, previous: 16210, status: 'ok', unit: '竹子', issued: 26900, spent: 8480 },
        agent_calls_today: { value: 3862, previous: 3410, status: 'ok' },
        crawler_today: { value: 1275, previous: 1490, status: 'ok' }
      },
      trends: {
        active: days(0, [142, 150, 161, 158, 170, 149, 133, 176, 181, 190, 187, 205, 198, 214]),
        new_members: days(0, [9, 12, 8, 15, 11, 6, 7, 14, 19, 16, 13, 21, 22, 17]),
        posts: days(0, [54, 61, 66, 58, 72, 49, 41, 77, 80, 84, 79, 90, 81, 96]),
        agent_calls: days(0, [1820, 1960, 2105, 2240, 2410, 1990, 1760, 2650, 2890, 3020, 3110, 3330, 3410, 3862]),
        crawler: days(0, [980, 1012, 1105, 1220, 1190, 860, 790, 1310, 1402, 1388, 1460, 1520, 1490, 1275]),
        bamboo_net: days(0, [8200, 9100, 9900, 10400, 11250, 9800, 8700, 12600, 13900, 14800, 15200, 16900, 16210, 18420])
      },
      todos: [
        { key: 'gov_overdue', title: '治理事项已超时', count: 1, urgency: 'critical', oldest_at: ago(260), link: '#/admin/reports' },
        { key: 'gov_second', title: '封禁与删除待第二人确认', count: 1, urgency: 'high', oldest_at: ago(55), link: '#/admin/reports' },
        { key: 'economy_anomaly', title: '竹子流水异常', count: 2, urgency: 'high', oldest_at: ago(200), link: '#/admin/economy/anomaly' },
        { key: 'gov_severe', title: '高风险事项待处理', count: 1, urgency: 'high', oldest_at: ago(90), link: '#/admin/reports' },
        { key: 'gov_open', title: '普通举报待处理', count: 4, urgency: 'normal', oldest_at: ago(610), link: '#/admin/review' },
        { key: 'vote_anomaly', title: '打榜投票异常', count: 2, urgency: 'normal', oldest_at: ago(45), link: '#/admin/reports?source=campaign' },
        { key: 'param_pending', title: '参数变更待生效', count: 1, urgency: 'normal', oldest_at: null, link: '#/admin/games/params' }
      ]
    },
    users: users,
    detail: detail,
    queue: {
      items: queue,
      sources: [
        { key: 'governance', label: '治理队列', status: 'ok', writeback: true },
        { key: 'content_report', label: '内容举报', status: 'ok', writeback: true },
        { key: 'market', label: '市集举报', status: 'ok', writeback: true },
        { key: 'campaign', label: '打榜异常', status: 'ok', writeback: true },
        { key: 'economy', label: '经济异常', status: 'ok', writeback: true }
      ]
    },
    params: params,
    history: history,
    system: {
      flags: [
        { key: 'core.objects', enabled: true, module: 'core', description: '内容对象读写', gates: ['object.create.discussion', 'object.create.reply'], updated_at: '2026-10-25T00:00:00.000000Z' },
        { key: 'economy.enabled', enabled: true, module: 'economy', description: '竹子经济与商店', gates: ['economy.shop.buy', 'economy.checkin'], updated_at: ago(2000), updated_by_handle: 'linqi' },
        { key: 'farm.enabled', enabled: true, module: 'farm', description: '先锋农场', gates: ['farm.steal', 'farm.plant'], updated_at: ago(1900), updated_by_handle: 'linqi' },
        { key: 'gov.model_egress', enabled: false, module: 'gov', description: '治理 Agent 模型层外发（需 Sun 批准）', gates: [], updated_at: '2026-10-25T00:00:00.000000Z' },
        { key: 'gov.premoderation', enabled: false, module: 'gov', description: '先审后发：新内容一律先进待审核', gates: [], updated_at: '2026-10-25T00:00:00.000000Z' },
        { key: 'gov.reports', enabled: true, module: 'gov', description: '成员举报入口', gates: ['gov.report.create'], updated_at: '2026-10-25T00:00:00.000000Z' },
        { key: 'parking.enabled', enabled: true, module: 'parking', description: '抢车位', gates: ['parking.ticket'], updated_at: ago(1800), updated_by_handle: 'zhouyu' },
        { key: 'public.crawlers', enabled: true, module: 'public', description: '公开层对已登记爬虫开放', gates: [], updated_at: ago(9000), updated_by_handle: 'linqi' }
      ],
      jobs: [
        { name: 'economy.daily_reset', module: 'economy', every_seconds: 86400, state: 'idle', last_run_at: ago(380), next_due_at: later(1060), duration_ms: null, last_error: null },
        { name: 'feed.fetch', module: 'feed', every_seconds: 1800, state: 'running', last_run_at: ago(31), next_due_at: null, duration_ms: null, last_error: null },
        { name: 'feed.cluster', module: 'feed', every_seconds: 600, state: 'idle', last_run_at: ago(6), next_due_at: later(4), duration_ms: null, last_error: null },
        { name: 'growth.recompute', module: 'growth', every_seconds: 3600, state: 'overdue', last_run_at: ago(170), next_due_at: ago(110), duration_ms: null, last_error: null },
        { name: 'market.expire', module: 'market', every_seconds: 3600, state: 'never', last_run_at: null, next_due_at: null, duration_ms: null, last_error: null }
      ],
      health: { status: 'ok', checked_at: NOW, db_ms: 0.41, sqlite: '3.46.1', migrations: 31, latest_migration: { id: 'admin/admin_0002.sql', applied_at: ago(400) }, outbox_pending: 3, outbox_dead: 0, outbox_oldest_pending: ago(2), modules: ['account', 'achievements', 'admin', 'agents', 'bounty', 'content', 'economy', 'events', 'farm', 'feed', 'games', 'governance', 'growth', 'kb', 'parking', 'public', 'rooms'] },
      config: [
        { key: 'secret_key', label: '会话与游标签名密钥', is_secret: true, set: true, value: null },
        { key: 'db_path', label: '数据库路径', is_secret: true, set: true, value: null },
        { key: 'backup_dir', label: '备份目录', is_secret: true, set: true, value: null },
        { key: 'storage_dir', label: '附件存储目录', is_secret: true, set: false, value: null },
        { key: 'public_origin', label: '站点来源', is_secret: false, set: true, value: 'https://pioneer.example' },
        { key: 'session_ttl', label: '会话有效期（秒）', is_secret: false, set: true, value: 1209600 },
        { key: 'rate_limits', label: '限流（次数, 窗口秒）', is_secret: false, set: true, value: { auth: [10, 300], write: [120, 60], admin: [30, 60] } },
        { key: 'delete_cooldown_days', label: '注销冷静期（天）', is_secret: false, set: true, value: 7 }
      ]
    },
    audit: [
      { id: 'ev-9001', occurred_at: ago(12), actor: { handle: 'linqi', name: '林栖' }, action: 'admin_param.rollback', target_type: 'admin_param', target_id: 'farm.steal_daily_limit', outcome: 'ok', request_id: 'r-7c21e0' },
      { id: 'ev-9002', occurred_at: ago(25), actor: { handle: 'zhouyu', name: '周屿' }, action: 'gov.case.act', target_type: 'gov_case', target_id: 'c-099', outcome: 'ok', request_id: 'r-11fa02' },
      { id: 'ev-9003', occurred_at: ago(31), actor: { handle: 'linqi', name: '林栖' }, action: 'admin_console.user.view', target_type: 'principal', target_id: 'p-05', outcome: 'ok', request_id: 'r-5e9d77' },
      { id: 'ev-9004', occurred_at: ago(48), actor: { handle: 'acheng', name: '阿澄' }, action: 'admin_param.set', target_type: 'admin_param', target_id: 'economy.daily_credit_cap', outcome: 'denied', request_id: 'r-0b6ac3' },
      { id: 'ev-9005', occurred_at: ago(66), actor: { handle: 'linqi', name: '林栖' }, action: 'flag.set', target_type: 'feature_flag', target_id: 'parking.enabled', outcome: 'ok', request_id: 'r-99c1d0' },
      { id: 'ev-9006', occurred_at: ago(90), actor: { handle: 'zhouyu', name: '周屿' }, action: 'economy.admin_adjust', target_type: 'principal', target_id: 'p-09', outcome: 'ok', request_id: 'r-3fe810' },
      { id: 'ev-9007', occurred_at: ago(140), actor: null, action: 'events.vote_anomaly', target_type: 'event', target_id: 'ev-autumn-agents', outcome: 'ok', request_id: null },
      { id: 'ev-9008', occurred_at: ago(220), actor: { handle: 'linqi', name: '林栖' }, action: 'admin.roles', target_type: 'principal', target_id: 'p-04', outcome: 'ok', request_id: 'r-a1b2c3' }
    ],
    ops: {
      announcements: [
        { title: '秋季 Agent 挑战赛开始报名', scope: '全站顶栏', status: 'live', starts_at: ago(1440), ends_at: later(8640) },
        { title: '周六晚 22:00 维护 30 分钟', scope: '全站顶栏', status: 'scheduled', starts_at: later(3000), ends_at: later(3030) },
        { title: '问题库上线「复现环境」字段', scope: '问题库', status: 'ended', starts_at: ago(10080), ends_at: ago(5760) }
      ],
      marquee: [
        { text: '本周新解决 23 个问题', source: '系统事件', status: 'live' },
        { text: '农场今晚 10 点双倍收成', source: '手写', status: 'live' },
        { text: '江晚 在提示词打榜冲到第 2', source: '系统事件', status: 'queued' }
      ],
      ads: [
        { slot: '讨论串侧栏', sponsor: '示例云 GPU', window: '10-20 至 11-03', cap: '每人每天 3 次', impressions: 18240, status: 'live' },
        { slot: '活动页底部', sponsor: '示例开源基金', window: '10-28 至 11-10', cap: '每人每天 2 次', impressions: 0, status: 'scheduled' }
      ],
      events: [
        { title: '秋季 Agent 挑战赛', kind: '挑战赛', status: 'live', signups: 186, submissions: 42, ends_at: later(8640) },
        { title: '七天提示词共学营', kind: '共学营', status: 'live', signups: 92, submissions: 310, ends_at: later(2880) },
        { title: '杭州线下聚会', kind: '线下聚会', status: 'upcoming', signups: 38, submissions: 0, ends_at: later(14400) },
        { title: '讲堂周：评测与对齐', kind: '讲堂周', status: 'ended', signups: 240, submissions: 12, ends_at: ago(4320) }
      ],
      campaigns: [
        { title: '十月最佳提示词', status: 'live', candidates: 24, votes: 1386, anomalies: 2, ends_at: later(4320) },
        { title: '九月最实用 Skill', status: 'ended', candidates: 18, votes: 2210, anomalies: 0, ends_at: ago(36000) }
      ],
      groups: [
        { name: 'Agent 开发', members: 642, weekly_posts: 118, pending: 3, status: '公开' },
        { name: '提示词工程', members: 511, weekly_posts: 96, pending: 0, status: '公开' },
        { name: '本地部署与硬件', members: 287, weekly_posts: 41, pending: 5, status: '申请制' },
        { name: '求职与内推', members: 403, weekly_posts: 63, pending: 12, status: '申请制' },
        { name: '摸鱼闲聊', members: 820, weekly_posts: 233, pending: 0, status: '公开' }
      ]
    },
    economy: {
      bamboo: {
        issued: 26900, spent: 8480, net: 18420, holders: 1286, capped: 37,
        reasons: [
          { reason: 'economy.checkin', label: '签到', issued: 6120, spent: 0, people: 612 },
          { reason: 'farm.harvest', label: '农场收获', issued: 9840, spent: 0, people: 403 },
          { reason: 'farm.steal', label: '偷菜', issued: 1260, spent: 1260, people: 118 },
          { reason: 'parking.income', label: '停车收益', issued: 4310, spent: 0, people: 266 },
          { reason: 'games.sofa', label: '抢沙发', issued: 870, spent: 0, people: 290 },
          { reason: 'economy.shop', label: '商店购买', issued: 0, spent: 6540, people: 143 },
          { reason: 'parking.fine', label: '贴条罚款', issued: 680, spent: 680, people: 54 }
        ]
      },
      points: { circulating: 182400, held: 12650, granted_week: 9320, rows: [
        { handle: 'linqi', name: '林栖', kind: '贡献发放', amount: 320, at: ago(120) },
        { handle: 'jiangwan', name: '江晚', kind: '悬赏冻结', amount: -200, at: ago(240) },
        { handle: 'sumu', name: '苏木', kind: '悬赏采纳', amount: 150, at: ago(380) }
      ] },
      shop: [
        { name: '竹节头像框', category: '头像框', price: 120, limited: null, sold: 211, active: true },
        { name: '夜光熊猫配色', category: '熊猫配色', price: 260, limited: 300, sold: 284, active: true },
        { name: '番茄风车', category: '农场装饰', price: 80, limited: null, sold: 402, active: true },
        { name: '复古电驴', category: '车型', price: 450, limited: 100, sold: 100, active: false },
        { name: '调参失败表情包', category: '表情包', price: 40, limited: null, sold: 590, active: true }
      ]
    },
    games: {
      farm: { members: 1032, harvests: 2140, steals: 318, blocked: 41, steals_rows: [
        { thief: '程野', owner: '江晚', amount: 6, at: ago(18) },
        { thief: '陆鸣', owner: '阿澄', amount: 4, at: ago(33) },
        { thief: '程野', owner: '苏木', amount: 5, at: ago(51) }
      ] },
      parking: { owners: 874, parked: 1530, tickets: 96, income: 4310, ticket_rows: [
        { owner: '宋知遥', parker: '程野', fine: 18, at: ago(22) },
        { owner: '苏木', parker: '柯一', fine: 9, at: ago(64) }
      ] },
      exam: [
        { direction: 'Agent', kind: '单选', prompt: '工具调用失败后，Agent 首先应该做什么？', source: '问题库', status: 'reviewed' },
        { direction: '提示词', kind: '多选', prompt: '哪些做法能减少模型编造引用？', source: 'Skill', status: 'reviewed' },
        { direction: '安全合规', kind: '判断', prompt: '把 API key 写进前端代码，只要仓库私有就是安全的。', source: '问题库', status: 'draft' },
        { direction: '编程工具', kind: '排序', prompt: '把修复线上回归的步骤按顺序排列', source: '组件', status: 'draft' }
      ]
    },
    market: {
      listings: [
        { title: '出一块 4090，带票', category: '闲置', price: '¥11800', seller: '江晚', status: '在售', reports: 0 },
        { title: '求购树莓派 5 两块', category: '求购', price: '¥600 内', seller: '柯一', status: '在售', reports: 0 },
        { title: '低价转让某模型高额度账号', category: '闲置', price: '¥99', seller: '白桦', status: '已拦截', reports: 6 },
        { title: '招 Agent 外包，周期两周', category: '合作线索', price: '面议', seller: '苏木', status: '已预订', reports: 0 },
        { title: '拼团买 API 额度，还差 3 人', category: '拼车拼单', price: '¥45/人', seller: '陆鸣', status: '在售', reports: 1 }
      ],
      banned: ['账号买卖', 'API key 转售', '破解软件', '灰产代充', '实名信息'],
      rules: {
        forbidden: [{ key: 'account', label: '账号买卖' }, { key: 'key', label: 'API key 转售' }, { key: 'crack', label: '破解软件' }, { key: 'gray', label: '灰产代充' }, { key: 'identity', label: '实名信息' }],
        limits: { l1_daily_listings: 2, expire_days: 30 }
      }
    },
    agents: {
      agents: [
        { name: '林栖的周报助手', owner: '林栖', scopes: ['read:feed', 'draft:post'], calls: 412, status: 'active' },
        { name: '问题库巡检', owner: '周屿', scopes: ['read:kb'], calls: 1290, status: 'active' },
        { name: '农场提醒', owner: '程野', scopes: ['farm:water'], calls: 96, status: 'active' },
        { name: '旧版抓取脚本', owner: '陆鸣', scopes: ['read:feed'], calls: 0, status: 'revoked' }
      ],
      tokens: [
        { masked_token: 'vca_…7f3a', owner: '林栖的周报助手', scopes: ['read:feed', 'draft:post'], expires_at: later(43200), last_used_at: ago(4), status: 'active' },
        { masked_token: 'vca_…c210', owner: '问题库巡检', scopes: ['read:kb'], expires_at: later(10080), last_used_at: ago(1), status: 'active' },
        { masked_token: 'vca_…99e1', owner: '旧版抓取脚本', scopes: ['read:feed'], expires_at: ago(1440), last_used_at: ago(9000), status: 'revoked' }
      ],
      crawlers: [
        { key: 'gptbot', label: 'GPTBot', week: 3120, policy: '允许' },
        { key: 'claudebot', label: 'ClaudeBot', week: 2860, policy: '允许' },
        { key: 'bingbot', label: 'Bingbot', week: 1410, policy: '允许' },
        { key: 'unknown', label: '未登记', week: 388, policy: '限流' }
      ]
    },
    biz: {
      overview: { subscriptions: { waitlist: 0, trial: 6, active: 0, expired: 2, canceled: 1 }, orders: {}, provider: 'disabled', paymentsEnabled: false,
        waitlist: [{ plan: 'pioneer', cycle: 'month', people: 41, seats: 41 }, { plan: 'pioneer', cycle: 'year', people: 12, seats: 12 }, { plan: 'team', cycle: 'year', people: 3, seats: 46 }] },
      plans: [
        { key: 'free', name: '免费', tagline: '社区的知识、讨论、讲堂和乐园', perSeat: false, minSeats: 1, currency: 'CNY', price: { month: 0, year: 0 }, priceStatus: 'draft' },
        { key: 'pioneer', name: '先锋会员', tagline: '更多额度、会员圆桌、关掉赞助位', perSeat: false, minSeats: 1, currency: 'CNY', price: { month: 39, year: 390 }, priceStatus: 'draft' },
        { key: 'team', name: '团队空间', tagline: '私有知识库和 Agent 席位', perSeat: true, minSeats: 5, currency: 'CNY', price: { month: 99, year: 990 }, priceStatus: 'draft' }
      ],
      waitlist: [
        { id: 'w-31', plan: 'pioneer', planName: '先锋会员', cycle: 'month', seats: 1, source: 'pricing', joinedAt: ago(300), handle: 'songzy', level: 3 },
        { id: 'w-30', plan: 'team', planName: '团队空间', cycle: 'year', seats: 20, source: 'pricing', joinedAt: ago(900), handle: 'jiangwan', level: 4 },
        { id: 'w-29', plan: 'pioneer', planName: '先锋会员', cycle: 'year', seats: 1, source: 'account', joinedAt: ago(2000), handle: 'xutang', level: 2 }
      ],
      subscriptions: [
        { id: 's-12', plan: 'pioneer', cycle: 'month', seats: 1, state: 'trial', source: 'admin', periodStart: ago(4000), periodEnd: later(6000), handle: 'acheng' },
        { id: 's-11', plan: 'team', cycle: 'month', seats: 5, state: 'trial', source: 'admin', periodStart: ago(9000), periodEnd: later(1000), handle: 'sumu' },
        { id: 's-09', plan: 'pioneer', cycle: 'month', seats: 1, state: 'expired', source: 'admin', periodStart: ago(60000), periodEnd: ago(20000), handle: 'luming' }
      ],
      orders: [
        { id: 'ord-1042', handle: 'acheng', plan_key: 'pioneer', plan_name: '先锋会员', amount_fen: 3900, provider: 'manual', state: 'paid', created_at: ago(120) },
        { id: 'ord-1041', handle: 'sumu', plan_key: 'team', plan_name: '团队空间', amount_fen: 49500, provider: 'manual', state: 'pending', created_at: ago(480) },
        { id: 'ord-1038', handle: 'luming', plan_key: 'pioneer', plan_name: '先锋会员', amount_fen: 3900, provider: 'manual', state: 'failed', created_at: ago(2880) }
      ]
    }
  };
})();
