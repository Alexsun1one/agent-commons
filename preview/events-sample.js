/* R13 EVENT-1 · 活动专区与打榜合成样例。人物、作品与票数均为虚构。 */
(function () {
  'use strict';

  var ILLUS = 'assets/illus/';
  var SAMPLE = 'assets/samples/';
  var MASCOT = 'assets/mascot/';

  function comment(id, authorId, body, at, reply) {
    return {
      id: id, authorId: authorId, body: body, createdAt: at, editedAt: null,
      reply_to: reply || null, thread_root: reply || id, quote: null,
      status: 'ok', reactions: { useful: 1 }, mine: {}
    };
  }

  var people = {
    'chen-mo': { id: 'chen-mo', name: '陈墨', level: 3, handle: 'chen-mo', avatar: MASCOT + 'panda-avatar-brand-blue-512.webp' },
    'yu-lan': { id: 'yu-lan', name: '余岚', level: 4, handle: 'yu-lan', avatar: MASCOT + 'panda-avatar-mist-purple-512.webp' },
    'lin-qi': { id: 'lin-qi', name: '林栖', level: 1, handle: 'lin-qi', avatar: MASCOT + 'panda-avatar-mint-512.webp' },
    'xing-ye': { id: 'xing-ye', name: '松原', level: 5, handle: 'song-yuan', avatar: MASCOT + 'panda-avatar-classic-512.webp' },
    'bei-chen': { id: 'bei-chen', name: '陈墨', level: 3, handle: 'chen-mo', avatar: MASCOT + 'panda-avatar-graphite-512.webp' }
  };

  var events = [
    {
      id: 'ev-agent-sprint', kind: 'challenge', status: 'live',
      title: '三天做一个检索 Agent',
      summary: '只交可复现步骤，不交灵感。',
      cover: ILLUS + 'cover-agent-plaza.webp',
      place: '站内房间', hostId: 'chen-mo', host: '陈墨',
      startsAt: '2026-10-24T12:00:00.000000Z', endsAt: '2026-10-27T16:00:00.000000Z',
      rules: '题目当场公布。提交须带输入、失败样本和验收命令。',
      rewards: [
        { kind: 'bamboo', label: '40 竹子', note: '拟定' },
        { kind: 'badge', label: '检索挑战徽章', note: '拟定' }
      ],
      timeline: [
        { at: '10.24', text: '公布题目与验收表' },
        { at: '10.26', text: '中期互评' },
        { at: '10.27', text: '截止并复盘' }
      ],
      signups: 28, submissions: 11, featured: true
    },
    {
      id: 'ev-camp-seven', kind: 'camp', status: 'live',
      title: '七日共学营 · 把 Skill 写到能装',
      summary: '每天一张可安装的 SKILL.md。',
      cover: ILLUS + 'cover-skills.webp',
      place: '共学小组', hostId: 'yu-lan', host: '余岚',
      startsAt: '2026-10-22T00:00:00.000000Z', endsAt: '2026-10-29T16:00:00.000000Z',
      rules: '连续 7 天打卡。缺一天不补，可以看别人的。',
      rewards: [
        { kind: 'membership', label: '会员 14 天', note: '拟定' },
        { kind: 'bamboo', label: '28 竹子', note: '拟定' }
      ],
      timeline: [
        { at: '第 1 天', text: '目标、输入、验收三栏' },
        { at: '第 4 天', text: '互换安装' },
        { at: '第 7 天', text: '汇总可复用清单' }
      ],
      signups: 46, submissions: 19, featured: true
    },
    {
      id: 'ev-hangzhou-meetup', kind: 'meetup', status: 'upcoming',
      title: '杭州线下小聚',
      summary: '带一件自己的 Agent 作品来。',
      cover: ILLUS + 'cover-hot.webp',
      place: '杭州 · 示例场地', hostId: 'xing-ye', host: '本地模型工坊', hostSlug: 'local-model-workshop',
      startsAt: '2026-11-08T06:00:00.000000Z', endsAt: '2026-11-08T09:30:00.000000Z',
      rules: '现场不录音。座位 24 个，报名后等确认。',
      rewards: [{ kind: 'badge', label: '到场贴纸', note: '拟定' }],
      timeline: [
        { at: '14:00', text: '到场与作品墙' },
        { at: '15:00', text: '三件作品短讲' },
        { at: '16:30', text: '自由组队' }
      ],
      signups: 18, submissions: 0
    },
    {
      id: 'ev-talks-week', kind: 'talks', status: 'upcoming',
      title: '讲堂周 · 讲到别人能复现',
      summary: '四场公开课，每场带走一份清单。',
      cover: ILLUS + 'cover-lecture.webp',
      place: '公开讲堂', hostId: 'yu-lan', host: '余岚',
      startsAt: '2026-11-03T12:00:00.000000Z', endsAt: '2026-11-07T15:00:00.000000Z',
      rules: '报名在房间列表。回看不另开权限。',
      rewards: [{ kind: 'bamboo', label: '听满四场 16 竹子', note: '拟定' }],
      timeline: [
        { at: '11.03', text: '验收清单怎么写' },
        { at: '11.05', text: '用自己的项目走一遍' },
        { at: '11.07', text: '模型跑偏先改哪一层' }
      ],
      signups: 61, submissions: 0
    },
    {
      id: 'ev-eval-ended', kind: 'challenge', status: 'ended',
      title: '评测集切片挑战',
      summary: '把一份大评测切成最小可复现集。',
      cover: ILLUS + 'cover-bounty.webp',
      place: '评测小组', hostId: 'bei-chen', host: '北辰',
      startsAt: '2026-09-28T00:00:00.000000Z', endsAt: '2026-10-05T16:00:00.000000Z',
      rules: '提交须含切片前后对照。',
      rewards: [
        { kind: 'bamboo', label: '30 竹子', note: '拟定' },
        { kind: 'badge', label: '切片徽章', note: '拟定' }
      ],
      timeline: [
        { at: '9.28', text: '发题' },
        { at: '10.05', text: '公示' }
      ],
      signups: 33, submissions: 14,
      awards: [
        { rank: 1, name: '余岚', title: '12 条失败样本集' },
        { rank: 2, name: '林栖', title: 'Windows 路径切片' },
        { rank: 3, name: '陈墨', title: '对照表模板' }
      ]
    },
    {
      id: 'ev-salon-ended', kind: 'meetup', status: 'ended',
      title: '上海作品墙夜',
      summary: '十二件作品，三小时看完。',
      cover: ILLUS + 'cover-product-forms.webp',
      place: '上海 · 示例场地', hostId: 'xing-ye', host: '松原',
      startsAt: '2026-09-20T10:00:00.000000Z', endsAt: '2026-09-20T13:00:00.000000Z',
      rules: '到场即可。',
      rewards: [{ kind: 'badge', label: '到场贴纸', note: '拟定' }],
      timeline: [{ at: '当晚', text: '作品墙与短讲' }],
      signups: 22, submissions: 12,
      awards: [
        { rank: 1, name: '陈墨', title: '评审实验台' },
        { rank: 2, name: '余岚', title: '讲堂切片' }
      ]
    }
  ];

  var liveCampaign = {
    id: 'camp-best-agent', kind: 'campaign', status: 'live',
    title: '本月最佳 Agent 作品',
    summary: '每天三票，不能投自己。',
    cover: ILLUS + 'cover-agent-plaza.webp',
    place: '打榜', hostId: 'chen-mo', host: '陈墨',
    startsAt: '2026-10-20T00:00:00.000000Z', endsAt: '2026-10-31T16:00:00.000000Z',
    rules: '每人每天 3 票。L1 新号前 7 天只能看。同一邀请树互投会记异常。',
    rewards: [
      { kind: 'bamboo', label: '前三名 80 / 40 / 20 竹子', note: '拟定' },
      { kind: 'badge', label: '月度作品徽章', note: '拟定' }
    ],
    timeline: [
      { at: '10.20', text: '开放提名' },
      { at: '10.31', text: '锁票并公示' }
    ],
    signups: 54, submissions: 10, featured: true
  };

  var endedCampaign = {
    id: 'camp-top-prompts', kind: 'campaign', status: 'ended',
    title: '十大提示词',
    summary: '已锁票，结果如下。',
    cover: ILLUS + 'cover-prompts.webp',
    place: '打榜', hostId: 'yu-lan', host: '余岚',
    startsAt: '2026-09-01T00:00:00.000000Z', endsAt: '2026-09-30T16:00:00.000000Z',
    rules: '每人每天 3 票。结束后不再改票。',
    rewards: [{ kind: 'bamboo', label: '前十名各 12 竹子', note: '拟定' }],
    timeline: [
      { at: '9.01', text: '开放提名' },
      { at: '9.30', text: '公示' }
    ],
    signups: 71, submissions: 10
  };

  var earlierCampaigns = [
    {
      id: 'camp-repro-talks', kind: 'campaign', status: 'ended',
      title: '最能复现的共学讲堂', summary: '回看与材料均已公示。',
      cover: ILLUS + 'cover-lecture.webp', place: '打榜', hostId: 'xing-ye', host: '松原',
      startsAt: '2026-08-01T00:00:00.000000Z', endsAt: '2026-08-31T16:00:00.000000Z',
      rules: '每人每天 3 票。结束后不再改票。', rewards: [], timeline: [], signups: 58, submissions: 10,
      stats: { signups: 58, submissions: 10, voters: 39, ballots: 104 }
    },
    {
      id: 'camp-summer-builds', kind: 'campaign', status: 'ended',
      title: '夏季实作精选', summary: '按复现记录与边界说明评选。',
      cover: ILLUS + 'cover-product-forms.webp', place: '打榜', hostId: 'chen-mo', host: '陈墨',
      startsAt: '2026-07-01T00:00:00.000000Z', endsAt: '2026-07-31T16:00:00.000000Z',
      rules: '每人每天 3 票。结束后不再改票。', rewards: [], timeline: [], signups: 43, submissions: 10,
      stats: { signups: 43, submissions: 10, voters: 31, ballots: 88 }
    }
  ];

  var liveCandidates = [
    { id: 'c-local-index', authorId: 'lin-qi', title: '本地资料索引', summary: '20 分钟找到第一条答案。', sourceKind: 'work', sourceRef: 'local-index', cover: ILLUS + 'cover-skills.webp', votes: 41, rank: 1, lastRank: 2 },
    { id: 'c-rag-trace', authorId: 'yu-lan', title: 'RAG 证据追踪', summary: '每个答案回到来源和边界。', sourceKind: 'work', sourceRef: 'rag-trace', cover: ILLUS + 'cover-components.webp', votes: 37, rank: 2, lastRank: 1 },
    { id: 'c-onboarding', authorId: 'yu-lan', title: '新成员共学讲堂', summary: '45 分钟带着产物离开。', sourceKind: 'talk', sourceRef: 'onboarding-class', cover: ILLUS + 'cover-lecture.webp', votes: 29, rank: 3, lastRank: 3 },
    { id: 'c-prompt-01', authorId: 'lin-qi', title: '受众—任务—证据', summary: '写之前先固定读者和缺口。', sourceKind: 'prompt', sourceRef: 'prompt-01', cover: ILLUS + 'cover-prompts.webp', votes: 22, rank: 4, lastRank: 5 },
    { id: 'c-review-lab', authorId: 'chen-mo', title: 'Agent 评审实验台', summary: '结论必须有证据。', sourceKind: 'work', sourceRef: 'review-lab', cover: ILLUS + 'cover-product-forms.webp', votes: 18, rank: 5, lastRank: 4 },
    { id: 'c-accept', authorId: 'yu-lan', title: '讲到能复现', summary: '别人做不出来，这课就没讲完。', sourceKind: 'talk', sourceRef: 'accept', cover: SAMPLE + 'talk-prompt-structure.webp', votes: 15, rank: 6, lastRank: 6 },
    { id: 'c-handoff', authorId: 'xing-ye', title: '可接手的交接台', summary: '状态、证据和下一步放在一起。', sourceKind: 'work', sourceRef: 'handoff-desk', cover: ILLUS + 'cover-product-forms.webp', votes: 13, rank: 7, lastRank: 8 },
    { id: 'c-eval-slice', authorId: 'bei-chen', title: '评测切片器', summary: '把失败样本切到能复跑。', sourceKind: 'work', sourceRef: 'eval-slice', cover: ILLUS + 'cover-bounty.webp', votes: 11, rank: 8, lastRank: 7 },
    { id: 'c-safety-map', authorId: 'chen-mo', title: '安全边界地图', summary: '每条动作都能看到停止条件。', sourceKind: 'work', sourceRef: 'safety-map', cover: ILLUS + 'cover-components.webp', votes: 9, rank: 9, lastRank: 10 },
    { id: 'c-agent-notes', authorId: 'lin-qi', title: 'Agent 运行笔记', summary: '把调用与决策压成一页。', sourceKind: 'work', sourceRef: 'agent-notes', cover: ILLUS + 'cover-agent-plaza.webp', votes: 7, rank: 10, lastRank: 9 }
  ];

  var endedCandidates = [
    { id: 'p-01', authorId: 'lin-qi', title: '最小复现', summary: '先固定步骤再猜修复。', sourceKind: 'prompt', sourceRef: 'prompt-03', cover: ILLUS + 'cover-prompts.webp', votes: 86, rank: 1, lastRank: 1 },
    { id: 'p-02', authorId: 'chen-mo', title: '失败优先代码评审', summary: '只报可复现的问题。', sourceKind: 'prompt', sourceRef: 'prompt-05', cover: ILLUS + 'cover-prompts.webp', votes: 74, rank: 2, lastRank: 3 },
    { id: 'p-03', authorId: 'yu-lan', title: '交接回执', summary: '按字段写给主控。', sourceKind: 'prompt', sourceRef: 'prompt-14', cover: ILLUS + 'cover-prompts.webp', votes: 61, rank: 3, lastRank: 2 },
    { id: 'p-04', authorId: 'xing-ye', title: '系统提示边界', summary: '允许、禁止和停止条件。', sourceKind: 'prompt', sourceRef: 'prompt-12', cover: ILLUS + 'cover-prompts.webp', votes: 48, rank: 4, lastRank: 4 },
    { id: 'p-05', authorId: 'bei-chen', title: '口径到查询', summary: '先定义对象再写 SQL。', sourceKind: 'prompt', sourceRef: 'prompt-07', cover: ILLUS + 'cover-prompts.webp', votes: 39, rank: 5, lastRank: 6 },
    { id: 'p-06', authorId: 'lin-qi', title: '变更计划含不做', summary: '文件所有权写进提示词。', sourceKind: 'prompt', sourceRef: 'prompt-04', cover: ILLUS + 'cover-prompts.webp', votes: 33, rank: 6, lastRank: 5 },
    { id: 'p-07', authorId: 'yu-lan', title: '证据强度分级', summary: '禁止越级措辞。', sourceKind: 'prompt', sourceRef: 'prompt-09', cover: ILLUS + 'cover-prompts.webp', votes: 27, rank: 7, lastRank: 7 },
    { id: 'p-08', authorId: 'chen-mo', title: '观点—反例—边界', summary: '三项同时出现。', sourceKind: 'prompt', sourceRef: 'prompt-02', cover: ILLUS + 'cover-prompts.webp', votes: 21, rank: 8, lastRank: 9 },
    { id: 'p-09', authorId: 'xing-ye', title: '反向验收', summary: '从失败路径走一遍。', sourceKind: 'prompt', sourceRef: 'prompt-15', cover: ILLUS + 'cover-prompts.webp', votes: 17, rank: 9, lastRank: 8 },
    { id: 'p-10', authorId: 'bei-chen', title: '图像构图四槽', summary: '文字留给界面叠加。', sourceKind: 'prompt', sourceRef: 'prompt-10', cover: ILLUS + 'cover-prompts.webp', votes: 11, rank: 10, lastRank: 10 }
  ];

  liveCampaign.candidates = liveCandidates;
  liveCampaign.awards = [];
  endedCampaign.candidates = endedCandidates;
  endedCampaign.awards = endedCandidates.slice(0, 3).map(function (item) {
    return { rank: item.rank, name: people[item.authorId].name, title: item.title };
  });
  endedCampaign.stats = { signups: 71, submissions: 10, voters: 48, ballots: 132 };
  earlierCampaigns.forEach(function (item) {
    item.candidates = endedCandidates;
    item.awards = endedCandidates.slice(0, 3).map(function (candidate) {
      return { rank: candidate.rank, name: people[candidate.authorId].name, title: candidate.title };
    });
  });

  events.forEach(function (item) {
    item.participants = [
      people['chen-mo'], people['yu-lan'], people['lin-qi'], people['xing-ye']
    ].slice(0, Math.min(4, Math.max(2, Math.round(item.signups / 12))));
    item.comments = [
      comment(item.id + '-c1', item.hostId, '规则以页上写的为准，奖励栏都是拟定。', '2026-10-24T10:00:00.000Z'),
      comment(item.id + '-c2', 'lin-qi', '我按验收表准备提交。', '2026-10-24T12:20:00.000Z', item.id + '-c1')
    ];
  });
  [liveCampaign, endedCampaign].concat(earlierCampaigns).forEach(function (item) {
    item.participants = [people['lin-qi'], people['yu-lan'], people['chen-mo'], people['xing-ye']];
    item.comments = [
      comment(item.id + '-c1', item.hostId, '投票每天清一次，不能改已经投下的。', '2026-10-20T09:00:00.000Z'),
      comment(item.id + '-c2', 'bei-chen', '我把拉票卡转给组里了。', '2026-10-21T08:10:00.000Z', item.id + '-c1')
    ];
  });

  window.COMMONS_EVENTS_SAMPLE = {
    viewer: { id: 'chen-mo', name: '陈墨', level: 3, accountDays: 40 },
    people: people,
    events: events,
    campaigns: [liveCampaign, endedCampaign].concat(earlierCampaigns)
  };
})();
