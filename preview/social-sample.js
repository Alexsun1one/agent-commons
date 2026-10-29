/* R13 SOCIAL-1 · 合成社交数据：人物、关系、小组、动态。形状对齐 /api/social 的返回，处处是示例。 */
(function () {
  'use strict';

  var M = 'assets/mascot/';
  var I = 'assets/illus/';
  var S = 'assets/samples/';

  function person(id, name, level, levelName, avatar, line) {
    return { id: id, handle: id, name: name, level: level, levelName: levelName, avatar: avatar ? M + avatar : '', line: line };
  }

  var people = [
    person('chen-mo', '陈墨', 3, '骨干', 'panda-avatar-brand-blue-512.webp', 'RAG 评测 · 上海'),
    person('yu-lan', '余岚', 4, '领航员', 'panda-avatar-mist-purple-512.webp', '讲堂主持 · 杭州'),
    person('lin-qi', '林栖', 1, '新队员', 'panda-avatar-mint-512.webp', '本地知识库 · 成都'),
    person('xing-ye', '星野', 3, '骨干', 'panda-avatar-classic-512.webp', 'Agent 编排 · 北京'),
    person('bei-chen', '北辰', 3, '骨干', 'panda-avatar-graphite-512.webp', '模型部署 · 深圳'),
    person('su-wan', '苏晚', 2, '队员', 'panda-avatar-night-sky-512.webp', '量化与推理 · 南京'),
    person('cheng-ye', '程野', 4, '领航员', '', '评测集维护 · 上海'),
    person('jiang-lan', '江岚', 5, '先锋', '', '产品与设计 · 广州'),
    person('ye-zhi', '叶知', 3, '骨干', '', '模型评测 · 武汉'),
    person('wen-xi', '闻溪', 2, '队员', '', 'AI 编程 · 西安'),
    person('fang-hui', '方回', 2, '队员', '', '出海增长 · 厦门'),
    person('xu-he', '许禾', 1, '新队员', '', '提示词练习 · 长沙'),
    person('gu-cheng', '顾澄', 2, '队员', '', '跨境电商 · 义乌'),
    person('bai-xu', '白序', 2, '队员', '', 'AI 教育 · 苏州'),
    person('lu-yao', '陆遥', 3, '骨干', '', 'Agent 开发 · 合肥'),
    person('xia-lan', '夏岚', 2, '队员', '', '内容工作流 · 青岛'),
    person('zhou-lan', '周澜', 3, '骨干', '', '科研数据 · 天津'),
    person('han-zhu', '韩渚', 1, '新队员', '', '')
  ];

  var groups = [
    { slug: 'ai-coding', name: 'AI 编程', category: 'tech', intro: '让模型写代码，也让人读得懂代码。', cover: 'assets/groups/claude-code.webp', policy: 'open', members: 2318, today: 14, me: 'active', role: 'member', admins: ['wen-xi', 'xing-ye'] },
    { slug: 'agent-dev', name: 'Agent 开发', category: 'tech', intro: '工具调用、记忆、编排与评测。', cover: 'assets/groups/agent-eng.webp', policy: 'open', members: 1864, today: 22, me: 'active', role: 'admin', admins: ['xing-ye', 'chen-mo'], pinned: ['p-agent-poll'], featured: ['p-agent-poll', 'p-agent-retry'], events: ['ev-agent-sprint'], pending: [{ id: 'lu-yao', note: '在做客服 Agent，想看大家的重试策略' }, { id: 'xia-lan', note: '' }] },
    { slug: 'prompt-eng', name: '提示词工程', category: 'tech', intro: '能复用、能比较的提示词。', cover: 'assets/groups/prompts.webp', policy: 'open', members: 1532, today: 6, me: 'none' },
    { slug: 'model-eval', name: '模型与评测', category: 'tech', intro: '新模型上手、评测集与对比。', cover: 'assets/groups/local-models.webp', policy: 'open', members: 1207, today: 9, me: 'active', role: 'member', admins: ['cheng-ye'], events: ['ev-eval-ended'] },
    { slug: 'local-hw', name: '本地部署与硬件', category: 'tech', intro: '显卡、量化、推理框架。', cover: 'assets/groups/hardware.webp', policy: 'open', members: 986, today: 5, me: 'none' },
    { slug: 'product-design', name: '产品与设计', category: 'career', intro: 'AI 产品的形态、交互与体验。', cover: 'assets/groups/design.webp', policy: 'open', members: 1120, today: 4, me: 'none' },
    { slug: 'global-growth', name: '出海与增长', category: 'career', intro: '获客、定价、海外合规。', cover: 'assets/groups/product.webp', policy: 'open', members: 642, today: 2, me: 'none' },
    { slug: 'jobs', name: '求职与内推', category: 'career', intro: '岗位、面试与内推，需要申请。', cover: 'assets/groups/career.webp', policy: 'apply', members: 873, today: 3, me: 'pending' },
    { slug: 'ai-edu', name: 'AI 教育', category: 'career', intro: '课堂里的 AI，和教 AI 的课。', cover: 'assets/groups/reading.webp', policy: 'open', members: 498, today: 1, me: 'none', events: ['ev-talks-week'] },
    { slug: 'ind-commerce', name: '电商与零售', category: 'industry', intro: '选品、客服、投放里的 AI。', cover: 'assets/groups/automation.webp', policy: 'open', members: 571, today: 3, me: 'none' },
    { slug: 'ind-content', name: '内容与媒体', category: 'industry', intro: '写作、剪辑、配音的工作流。', cover: '', policy: 'open', members: 433, today: 2, me: 'none' },
    { slug: 'ind-research', name: '科研与数据', category: 'industry', intro: '文献、实验与数据分析。', cover: '', policy: 'apply', members: 312, today: 1, me: 'none' },
    { slug: 'lounge', name: '摸鱼闲聊', category: 'community', intro: '不谈正事的地方。', cover: 'assets/groups/chitchat.webp', policy: 'open', members: 2960, today: 31, me: 'active', role: 'member' },
    { slug: 'newcomers', name: '新人报到', category: 'community', intro: '先打个招呼，再找组织。', cover: 'assets/groups/newcomers.webp', policy: 'open', members: 3402, today: 18, me: 'active', role: 'member', events: ['ev-hangzhou-meetup'] }
  ];

  var rules = ['对事不对人，先看完再回', '求助写清环境、做法和报错', '推广和拉群先问管理员'];

  var categories = [['tech', '技术'], ['career', '产品与职业'], ['industry', '行业应用'], ['community', '社区']];

  function c(id, authorId, body, ago, replyTo) {
    return { id: id, authorId: authorId, body: body, ago: ago, reply_to: replyTo || null };
  }

  var posts = [
    { id: 'p-yu-fail', author: 'yu-lan', ago: 12, scope: 'members', body: '把评测集拆成了 12 条失败样本，每条都附输入、期望和实际输出。比一个总分好用多了，组里谁想接着补？', images: [S + 'work-rag-trace.webp'], reactions: { up: 18, learned: 9, reproduced: 4 }, mine: null, shares: 3,
      comments: [c('c1', 'cheng-ye', '失败样本按「召回错 / 引用错 / 拒答错」分三类会更好比。', 9), c('c2', 'yu-lan', '好主意，今晚就分。', 7, 'c1'), c('c3', 'lin-qi', '我可以补 Windows 路径那几条。', 4)] },
    { id: 'p-agent-poll', author: 'xing-ye', ago: 26, scope: 'group', group: 'agent-dev', body: '你们的 Agent 长期记忆现在存在哪？', poll: { options: [['向量库', 41], ['SQLite 表', 27], ['纯 Markdown 文件', 33], ['不用记忆', 8]], mine: null, closesIn: '2 天后截止' }, reactions: { up: 7, question: 2 }, mine: null, shares: 1, comments: [c('c4', 'bei-chen', '纯文件 + 定期压缩，出错时最好查。', 20)] },
    { id: 'p-lin-card', author: 'lin-qi', ago: 48, scope: 'members', body: '第一次有知识卡被采纳。Windows 下路径大小写导致的漏召回，终于写清楚了。', quote: { type: 'knowledge', label: '知识卡', title: 'Windows 路径切片导致的检索漏召回', meta: '3 步复现 · 已采纳', href: '#/solved' }, reactions: { cheer: 24, up: 11, learned: 6 }, mine: 'cheer', shares: 0,
      comments: [c('c5', 'yu-lan', '写得很清楚，复现一次就跑通了。', 40), c('c6', 'chen-mo', '恭喜！下周讲堂可以讲五分钟。', 31)] },
    { id: 'p-bei-link', author: 'bei-chen', ago: 75, scope: 'members', body: '整理了一份本地推理框架的对照，只比我们真跑过的。', link: { url: 'https://github.com/ggml-org/llama.cpp', title: 'llama.cpp · 本地推理', domain: 'github.com' }, reactions: { learned: 15, up: 6 }, mine: null, shares: 5, comments: [] },
    { id: 'p-su-quant', author: 'su-wan', ago: 110, scope: 'friends', body: '周末把 32B 量化到 4 bit 跑起来了，单卡 24G 刚好够，速度比预想的快。', images: [S + 'room-pair-coding.webp', S + 'lib-component-2.webp'], reactions: { reproduced: 3, smile: 2 }, mine: null, shares: 0, comments: [c('c7', 'bei-chen', '上下文开多长？', 100)] },
    { id: 'p-cheng-share', author: 'cheng-ye', ago: 140, scope: 'members', shareOf: 'p-yu-fail', body: '强烈推荐评测组的人都看一下，样本格式可以直接抄。', reactions: { up: 5 }, mine: null, shares: 0, comments: [] },
    { id: 'p-agent-retry', author: 'lu-yao', ago: 190, scope: 'group', group: 'agent-dev', body: '工具调用失败后的重试，我们现在只重试幂等的那几个，其他直接交给人。大家怎么划线的？', reactions: { question: 6, learned: 4 }, mine: null, shares: 2, comments: [c('c8', 'xing-ye', '我们按「能不能撤回」划线。', 170)] },
    { id: 'p-jiang-talk', author: 'jiang-lan', ago: 260, scope: 'members', body: '讲堂周我讲「讲到别人能复现」，欢迎来挑刺。', quote: { type: 'talk', label: '讲堂', title: '讲到别人能复现', meta: '周四 20:00 · 45 分钟', href: '#/talks' }, reactions: { cheer: 12, up: 9 }, mine: 'up', shares: 4, comments: [] },
    { id: 'p-wen-code', author: 'wen-xi', ago: 320, scope: 'group', group: 'ai-coding', body: '让模型先写测试再写实现，返工少了一半。关键是测试要人看过再放行。', reactions: { learned: 14, up: 8 }, mine: null, shares: 6, comments: [c('c9', 'chen-mo', '同感，测试是给人读的契约。', 300)] },
    { id: 'p-mine-note', author: 'chen-mo', ago: 400, scope: 'private', body: '下周要做：把 RAG 评测的引用检查做成脚本，先只查页码对不对。', reactions: {}, mine: null, shares: 0, comments: [] },
    { id: 'p-yu-market', author: 'yu-lan', ago: 520, scope: 'members', body: '工作室换卡，出一张 3090，同城可以当面跑分。', quote: { type: 'market', label: '市集', title: '二手 3090 · 24G · 杭州自提', meta: '闲置 · 可面交', href: '#/market' }, reactions: { up: 3, question: 1 }, mine: null, shares: 1, comments: [] },
    { id: 'p-xu-first', author: 'xu-he', ago: 600, scope: 'group', group: 'lounge', body: '今天第一次在讨论串里回答别人的问题，还被点了「有用」，开心。', reactions: { cheer: 31, smile: 5 }, mine: null, shares: 0, comments: [] },
    { id: 'p-lin-poll', author: 'lin-qi', ago: 700, scope: 'members', body: '新手想先学哪一块？', poll: { options: [['提示词', 18], ['RAG', 25], ['Agent', 30]], mine: 2, closesIn: '已截止' }, reactions: { up: 4 }, mine: null, shares: 0, comments: [] },
    { id: 'p-ye-eval', author: 'ye-zhi', ago: 760, scope: 'group', group: 'model-eval', body: '新模型在长上下文检索上掉得很厉害，测试集稍后放出。', reactions: { learned: 5 }, mine: null, shares: 0, comments: [] },
    { id: 'p-xing-work', author: 'xing-ye', ago: 900, scope: 'members', body: '回归清单 Agent 开源了说明，按版本生成最小验证集。', quote: { type: 'work', label: '作品', title: '回归清单 Agent', meta: '可复现 · 3 人复现', href: '#/people' }, images: [S + 'work-review-bench.webp'], reactions: { reproduced: 7, up: 10 }, mine: null, shares: 3, comments: [] },
    { id: 'p-gu-hello', author: 'gu-cheng', ago: 1100, scope: 'group', group: 'newcomers', body: '新人报到：在义乌做跨境电商客服，想用 Agent 接住夜里的询盘，先来学习。', reactions: { cheer: 16, up: 4 }, mine: null, shares: 0, comments: [c('c10', 'fang-hui', '欢迎！出海与增长小组可以看看。', 1000)] },
    { id: 'p-bei-long', author: 'bei-chen', ago: 1300, scope: 'members', body: '部署小结：1. 先定延迟预算再选模型；2. 量化前后各跑一遍同一份评测；3. 日志里记下每次请求的上下文长度，出问题时第一个看它；4. 别在周五上线。', reactions: { learned: 22, smile: 9, up: 13 }, mine: null, shares: 8, comments: [] },
    { id: 'p-su-photo', author: 'su-wan', ago: 1500, scope: 'members', body: '线下小聚的白板，没擦，留个纪念。', images: [S + 'room-teaching-board.webp'], reactions: { smile: 6, up: 3 }, mine: null, shares: 0, comments: [] }
  ];

  var incoming = [
    { id: 'p-new-yu', author: 'yu-lan', ago: 0, scope: 'members', body: '失败样本按三类分好了，链接放在组里置顶。', reactions: {}, mine: null, shares: 0, comments: [] },
    { id: 'p-new-xing', author: 'xing-ye', ago: 0, scope: 'group', group: 'agent-dev', body: '投票还剩两天，没投的来投一下。', reactions: {}, mine: null, shares: 0, comments: [] }
  ];

  var system = [
    { id: 'sys-solved', kind: 'solved', person: 'lin-qi', title: '林栖 解决了一个问题', body: 'Windows 路径大小写导致的漏召回', href: '#/solved', action: '去看看' },
    { id: 'sys-drift', kind: 'drift', title: '本周话题漂移', body: '讨论重心从「提示词」移向「评测集」', href: '#/drift', action: '看漂移' },
    { id: 'sys-farm', kind: 'farm', title: '你的菜熟了', body: '2 块地可以收了，晚了会被好友偷', href: '#/farm', action: '去收菜' }
  ];

  window.COMMONS_SOCIAL_SAMPLE = {
    viewer: 'chen-mo',
    people: people,
    relations: {
      following: ['yu-lan', 'lin-qi', 'xing-ye', 'bei-chen', 'su-wan', 'cheng-ye', 'jiang-lan', 'ye-zhi'],
      followers: ['yu-lan', 'lin-qi', 'xing-ye', 'bei-chen', 'su-wan', 'wen-xi', 'fang-hui', 'xu-he', 'gu-cheng'],
      starred: ['yu-lan'],
      muted: ['ye-zhi'],
      blocked: ['han-zhu']
    },
    suggestions: [
      { id: 'bai-xu', reason: '3 位共同好友' },
      { id: 'zhou-lan', reason: '2 位共同好友' },
      { id: 'lu-yao', reason: '同在「Agent 开发」' },
      { id: 'xia-lan', reason: '报名了同一个活动' }
    ],
    categories: categories,
    rules: rules,
    groups: groups,
    posts: posts,
    incoming: incoming,
    system: system,
    playing: [
      { id: 'su-wan', game: '先锋农场', what: '在收菜', href: '#/farm' },
      { id: 'xing-ye', game: '抢车位', what: '停在你家', href: '#/parking' },
      { id: 'lin-qi', game: '猜提示词', what: '连对 5 题', href: '#/guess' }
    ],
    anniversaries: [
      { id: 'bei-chen', text: '入群一周年' },
      { id: 'yu-lan', text: '入群两周年' }
    ],
    works: [
      { title: '失败样本评测台', meta: '余岚 · 4 人复现', cover: S + 'work-rag-trace.webp', href: '#/people' },
      { title: '回归清单 Agent', meta: '星野 · 3 人复现', cover: S + 'work-review-bench.webp', href: '#/people' },
      { title: '周报证据链', meta: '北辰 · 2 人复现', cover: S + 'work-weekly-evidence.webp', href: '#/people' }
    ],
    quotables: [
      { type: 'knowledge', label: '知识卡', title: 'Windows 路径切片导致的检索漏召回', meta: '3 步复现 · 已采纳', href: '#/solved' },
      { type: 'knowledge', label: '知识卡', title: '引用页码校验的最小脚本', meta: '2 步复现', href: '#/solved' },
      { type: 'work', label: '作品', title: '失败样本评测台', meta: '可复现 · 4 人复现', href: '#/people' },
      { type: 'talk', label: '讲堂', title: '讲到别人能复现', meta: '周四 20:00', href: '#/talks' },
      { type: 'market', label: '市集', title: '二手 3090 · 24G · 杭州自提', meta: '闲置 · 可面交', href: '#/market' }
    ]
  };
})();
