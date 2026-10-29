/* R13 BIZ-1 · 商业页的示例数据。plans / me 与 GET /api/billing/plans、/api/billing/me 同形；
   等级额度照抄 server/modules/membership/migrations/membership_0001.sql，价格照抄 billing_0001.sql（全部拟定）。 */
(function () {
  'use strict';

  var benefits = [
    { key: 'discussion_rooms', name: '讨论室', actionKey: 'room', unit: 'count', period: 'month', levels: { 3: 4, 4: 8, 5: 12 } },
    { key: 'upload_megabytes', name: '上传额度', actionKey: 'upload', unit: 'megabyte', period: 'season', levels: { 2: 1024, 3: 4096, 4: 10240, 5: 20480 } },
    { key: 'agent_slots', name: 'Agent 数量', actionKey: null, unit: 'slot', period: 'account', levels: { 2: 1, 3: 3, 4: 8, 5: 16 } },
    { key: 'stage_rooms', name: '舞台房', actionKey: 'stage', unit: 'count', period: 'season', levels: { 4: 4, 5: 12 } },
    { key: 'member_invites', name: '成员邀请', actionKey: 'invite', unit: 'count', period: 'month', levels: { 2: 2, 3: 5, 4: 12, 5: 20 } }
  ];

  function ent(key, amount, minLevel) {
    var info = benefits.filter(function (b) { return b.key === key; })[0];
    return { benefitKey: key, name: info.name, unit: info.unit, period: info.period, mode: 'bonus', amount: amount, minLevel: minLevel };
  }

  var memberPerks = [
    { key: 'ai_quota', name: 'AI 助手额度', description: '翻译、会后纪要和个人简报每月更多次，次数随 AI 网关预算定' },
    { key: 'ad_free', name: '关闭赞助位', description: '账号里一键关掉全站赞助位' },
    { key: 'salon', name: '会员圆桌', description: '每月一场线上圆桌' },
    { key: 'cosmetics', name: '会员装扮', description: '每季一套限定头像框和熊猫配色，到期保留' },
    { key: 'early_signup', name: '工作坊提前报名', description: '比公开报名早 24 小时' }
  ];

  window.COMMONS_BUSINESS_SAMPLE = {
    label: '示例数据',
    plans: {
      currency: 'CNY',
      paymentsEnabled: false,
      neverForSale: ['等级', '成员邀请', '曝光与排名', '知识'],
      benefits: benefits,
      plans: [
        { key: 'free', name: '免费', tagline: '社区的知识、讨论、讲堂和乐园', scope: 'personal', perSeat: false, minSeats: 1, currency: 'CNY',
          price: { month: 0, year: 0 }, priceStatus: 'draft', entitlements: [], perks: [] },
        { key: 'pioneer', name: '先锋会员', tagline: '更多额度、会员圆桌、关掉赞助位', scope: 'personal', perSeat: false, minSeats: 1, currency: 'CNY',
          price: { month: 39, year: 390 }, priceStatus: 'draft',
          entitlements: [ent('agent_slots', 2, 2), ent('discussion_rooms', 4, 3), ent('upload_megabytes', 10240, 2)],
          perks: memberPerks },
        { key: 'team', name: '团队空间', tagline: '私有知识库和 Agent 席位', scope: 'team', perSeat: true, minSeats: 5, currency: 'CNY',
          price: { month: 99, year: 990 }, priceStatus: 'draft',
          entitlements: [ent('agent_slots', 4, 2), ent('discussion_rooms', 8, 3), ent('upload_megabytes', 20480, 2)],
          perks: [
            { key: 'private_space', name: '私有知识库', description: '问题卡和知识卡只在团队内可见，也能搜社区公开内容' },
            { key: 'team_agents', name: '团队 Agent', description: '团队 Agent 经 MCP 读团队库' },
            { key: 'team_admin', name: '成员管理', description: '邀请、角色、离队交接' },
            { key: 'team_export', name: '团队数据导出', description: 'Markdown 与 JSON，随时导出' },
            { key: 'invoice', name: '对公发票', description: '对公转账，开具发票' }
          ].concat(memberPerks.slice(0, 4).map(function (p) { return { key: p.key, name: p.name, description: '每席同先锋会员' }; })) }
      ]
    },
    me: { plan: 'free', planName: '免费', level: 3, subscription: null, waitlist: [], orders: [], paymentsEnabled: false },
    creator: {
      season: '2026 冬赛季',
      totals: { points: 1286, reproduced: 14, listeners: 312 },
      sources: [
        { key: 'work', name: '作品', points: 540 },
        { key: 'talk', name: '讲堂', points: 380 },
        { key: 'bounty', name: '悬赏', points: 246 },
        { key: 'question', name: '问题卡', points: 120 }
      ],
      weeks: [42, 66, 58, 91, 120, 84, 132, 110, 148, 96, 170, 169],
      top: [
        { kind: 'work', title: 'RAG 召回排查清单', note: '被复现 6 次', points: 240 },
        { kind: 'talk', title: '把会议纪要交给 Agent', note: '听众 128', points: 180 },
        { kind: 'bounty', title: '子代理超时怎么排', note: '被采纳', points: 120 },
        { kind: 'work', title: '周报证据板', note: '被复现 4 次', points: 110 },
        { kind: 'question', title: 'MCP 工具返回过长被截断', note: '3 人标有用', points: 64 }
      ],
      instructor: {
        share: 0.85,
        criteria: [
          { name: 'L3 及以上', met: true, detail: '现在 L3 骨干' },
          { name: '讲过一场公开讲堂', met: true, detail: '已讲 2 场' },
          { name: '作品被复现 3 次以上', met: true, detail: '已被复现 14 次' }
        ]
      },
      earnings: [
        { date: '10.18', source: '小班工作坊 · 用 Agent 做周报（8 席）', gross: 1592 },
        { date: '10.11', source: '一对一 · RAG 召回排查', gross: 399 },
        { date: '10.09', source: '一对一 · MCP 工具设计', gross: 399 },
        { date: '09.27', source: '小班工作坊 · 提示词结构（6 席）', gross: 1194 }
      ]
    },
    sponsor: {
      audience: [
        { value: '约 5,000', label: '社群成员' },
        { value: '28', label: '个群' },
        { value: '邀请制', label: '内测中' }
      ],
      directions: ['编程助手', '智能体平台', '设计与多模态', 'RAG 与知识库', '本地模型', '自动化工作流'],
      products: [
        { key: 'title', name: '活动冠名套餐', price: '¥5,000', unit: '每场', note: '含活动期内活动专区赞助位和赛后报告', state: 'open' },
        { key: 'jobs', name: '招聘位', price: '¥600', unit: '每条 30 天', note: '市集招聘分类置顶，每家同时 2 条', state: 'open' },
        { key: 'prize', name: '奖品赞助', price: '不收费', unit: '每场', note: '额度或实物由你直接发给获奖者', state: 'beta' },
        { key: 'slot', name: '赞助位', price: '¥200', unit: '每千次展示', note: '月活过 1,000 后开放', state: 'later' }
      ],
      placements: [
        { key: 'hot', name: '热点页侧栏', reach: '每人每周约 3 次' },
        { key: 'events', name: '活动专区', reach: '活动期间' },
        { key: 'market', name: '市集列表第 8 位', reach: '翻到第 8 条可见' },
        { key: 'games', name: '游戏中心底部', reach: '每人每周约 2 次' }
      ],
      rules: [
        '一屏最多一个赞助位',
        '明确标「赞助」',
        '同一广告每人每天最多 3 次',
        '阅读、写作、讲堂回看、考试时不出现',
        'L3 及以上和会员可以关掉',
        '只给聚合数，不给名单，不追踪个人',
        '买不到排名、评奖和投票'
      ]
    }
  };
})();
