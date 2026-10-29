/* R13 MARKET-1 · 市集示例数据。人物、价格、城市、时间、留言全部是合成示例。
   24 条覆盖 6 个分类和 4 种状态；页首只标一次「示例」。
   分类字段与 server/modules/market/logic.py 保持一致；live 模式以 /api/market/meta 为准。 */
window.COMMONS_MARKET_SAMPLE = {
  people: [
    { id: 'me', name: '我', level: 3 },
    { id: 'p1', name: '林栖', handle: 'lin-qi', level: 1 },
    { id: 'p2', name: '陈墨', handle: 'chen-mo', level: 3 },
    { id: 'p3', name: '余岚', handle: 'yu-lan', level: 4 },
    { id: 'p4', name: '松原', handle: 'song-yuan', level: 5 }
  ],
  categories: [
    { id: 'sell', label: '闲置转让', active: '在售', glyph: 'workshop',
      fields: ['condition', 'price', 'city', 'shipping'], required: ['condition', 'price', 'city', 'shipping'] },
    { id: 'buy', label: '求购', active: '求购中', glyph: 'search',
      fields: ['budget', 'city'], required: ['budget'] },
    { id: 'collab', label: '合作与外包', active: '招募中', glyph: 'link',
      fields: ['budget', 'cycle'], required: ['budget', 'cycle'] },
    { id: 'jobs', label: '内推与招聘', active: '招聘中', glyph: 'briefcase',
      fields: ['company', 'position', 'city', 'work_mode'], required: ['company', 'position'] },
    { id: 'groupbuy', label: '拼车拼单', active: '征集中', glyph: 'people',
      fields: ['target', 'price', 'deadline'], required: ['target', 'price', 'deadline'] },
    { id: 'free', label: '免费送', active: '可领取', glyph: 'heart',
      fields: ['condition', 'city', 'shipping'], required: ['condition', 'city', 'shipping'] }
  ],
  fieldLabels: {
    condition: '成色', price: '价格', city: '城市', shipping: '邮寄',
    budget: '预算', cycle: '周期', company: '公司', position: '岗位',
    work_mode: '方式', target: '拼单目标', deadline: '截止'
  },
  statusLabels: { reserved: '已预订', sold: '已成交', expired: '已过期' },
  reportReasons: [
    { id: 'forbidden', label: '禁止品类' },
    { id: 'scam', label: '疑似诈骗' },
    { id: 'counterfeit', label: '假货或仿品' },
    { id: 'contact', label: '骚扰或泄露联系方式' },
    { id: 'spam', label: '重复刷屏' },
    { id: 'other', label: '其他' }
  ],
  listings: [
    {
      id: 'mk01', category: 'sell', status: 'active', title: 'RTX 4090 公版显卡',
      body: '自用一年，箱说全，可现场验货。只出同城或顺丰到付。',
      price: '¥3,200', city: '杭州', shipping: '可邮寄', condition: '九成新',
      author: 'p1', createdAt: '2026-10-25T09:20:00Z', photos: 3
    },
    {
      id: 'mk02', category: 'sell', status: 'active', title: 'HHKB Pro 3 键盘',
      body: '手感很好，换了静电容所以出。键帽无油。',
      price: '¥1,100', city: '上海', shipping: '仅同城', condition: '九成新',
      author: 'p3', createdAt: '2026-10-25T08:10:00Z', photos: 2
    },
    {
      id: 'mk03', category: 'sell', status: 'reserved', title: '树莓派 5 8GB 套件',
      body: '买来做过一次家庭服务器，配件齐。',
      price: '¥420', city: '深圳', shipping: '可邮寄', condition: '九成新',
      author: 'p2', createdAt: '2026-10-24T15:30:00Z', photos: 2
    },
    {
      id: 'mk04', category: 'sell', status: 'sold', title: '《Building LLM Apps》纸质书',
      body: '看过一遍，无笔记。',
      price: '¥60', city: '北京', shipping: '可邮寄', condition: '八成新',
      author: 'p4', createdAt: '2026-10-23T11:00:00Z', photos: 1
    },
    {
      id: 'mk05', category: 'buy', status: 'active', title: '求购 27 寸 4K 显示器',
      body: '办公室想换双屏，收一台成色好的。',
      budget: '1,800', city: '广州', author: 'p2', createdAt: '2026-10-25T10:05:00Z', photos: 1
    },
    {
      id: 'mk06', category: 'buy', status: 'active', title: '求购二手 Mac mini M2',
      body: '跑本地模型用，16G 内存优先。',
      budget: '2,600', city: '成都', author: 'p1', createdAt: '2026-10-25T07:40:00Z', photos: 1
    },
    {
      id: 'mk07', category: 'buy', status: 'expired', title: '收一本《设计数据密集型应用》',
      body: '想补一本，品相不限。',
      budget: '80', city: '上海', author: 'p1', createdAt: '2026-10-18T09:00:00Z', photos: 1
    },
    {
      id: 'mk08', category: 'buy', status: 'active', title: '求购 40 系显卡散热模组',
      body: '风扇有异响，收个原装散热模组。',
      budget: '300', city: '武汉', author: 'p2', createdAt: '2026-10-24T18:20:00Z', photos: 1
    },
    {
      id: 'mk09', category: 'collab', status: 'active', title: '找一个 RAG 评测搭档',
      body: '给一个 RAG 助手做评测集，想找做过检索评测的人一起拆任务。',
      budget: '3,000', cycle: '2 周', author: 'p2', createdAt: '2026-10-25T11:30:00Z', photos: 2
    },
    {
      id: 'mk10', category: 'collab', status: 'reserved', title: '外包：客服知识库原型',
      body: '需要一个能演示引用和拒答的客服知识库原型，范围与验收先谈。',
      budget: '8,000', cycle: '3 周', author: 'p2', createdAt: '2026-10-24T13:05:00Z', photos: 1,
      imageUrls: ['assets/samples/talk-meeting-minutes.webp']
    },
    {
      id: 'mk11', category: 'collab', status: 'sold', title: '共写一份 Agent 失败案例集',
      body: '把最近半年踩过的坑整理成可复现的案例，找一位共同署名。',
      budget: '面议', cycle: '1 个月', author: 'p1', createdAt: '2026-10-22T09:15:00Z', photos: 1
    },
    {
      id: 'mk12', category: 'collab', status: 'expired', title: '找一位懂 MCP 的合著者',
      body: '想补 MCP 工具调用和权限边界两章。',
      budget: '2,000', cycle: '2 周', author: 'p3', createdAt: '2026-10-15T16:40:00Z', photos: 1
    },
    {
      id: 'mk13', category: 'jobs', status: 'active', title: '内推：AI 应用工程师',
      body: '团队做 AI 应用，远程优先，先聊项目再做评估。',
      company: '北岸自动化', orgSlug: 'north-automation', position: 'AI 应用工程师', city: '远程', work_mode: '远程',
      author: 'p2', createdAt: '2026-10-25T12:00:00Z', photos: 1
    },
    {
      id: 'mk14', category: 'jobs', status: 'active', title: '招聘：Agent 评测实习生',
      body: '负责评测集和回归，要求能写清楚失败条件。',
      company: '零壹 Agent 实验室', orgSlug: 'zero-one-lab', position: 'Agent 评测实习生', city: '上海', work_mode: '坐班',
      author: 'p4', createdAt: '2026-10-24T10:20:00Z', photos: 1
    },
    {
      id: 'mk15', category: 'jobs', status: 'sold', title: '内推：前端工程师（设计系统）',
      body: '设计系统团队，React 和可访问性优先。',
      company: '灵感工厂', orgSlug: 'inspiration-factory', position: '前端工程师', city: '杭州', work_mode: '混合',
      author: 'p3', createdAt: '2026-10-21T14:00:00Z', photos: 1
    },
    {
      id: 'mk16', category: 'jobs', status: 'expired', title: '招聘：知识库产品经理',
      body: '企业知识库方向，要求做过 B 端产品。',
      company: '北岸自动化', orgSlug: 'north-automation', position: '知识库产品经理', city: '北京', work_mode: '坐班',
      author: 'p2', createdAt: '2026-10-12T09:30:00Z', photos: 1
    },
    {
      id: 'mk17', category: 'groupbuy', status: 'active', title: '拼 5 人 Claude API 额度',
      body: '官方 API，按人头分摊，拼满就开。',
      target: '5 人', price: '¥200/人', deadline: '11.05',
      author: 'p1', createdAt: '2026-10-25T13:10:00Z', photos: 1
    },
    {
      id: 'mk18', category: 'groupbuy', status: 'active', title: '拼课：Agent 工程实战',
      body: '课程回看加一次直播答疑，拼满开课。',
      target: '8 人', price: '¥399/人', deadline: '11.08',
      author: 'p1', createdAt: '2026-10-25T09:45:00Z', photos: 1,
      imageUrls: ['assets/samples/talk-prompt-structure.webp']
    },
    {
      id: 'mk19', category: 'groupbuy', status: 'reserved', title: '拼单：向量数据库年费',
      body: '年费按人头分，已有 3 人。',
      target: '4 人', price: '¥120/人', deadline: '10.30',
      author: 'p3', createdAt: '2026-10-24T16:10:00Z', photos: 1
    },
    {
      id: 'mk20', category: 'groupbuy', status: 'expired', title: '拼车：Figma 团队席',
      body: '团队席还剩两个位置。',
      target: '6 人', price: '¥80/人', deadline: '10.20',
      author: 'p2', createdAt: '2026-10-14T11:20:00Z', photos: 1
    },
    {
      id: 'mk21', category: 'free', status: 'active', title: '免费送：旧机械键盘',
      body: '轴体正常，送一套键帽。',
      price: '免费', condition: '八成新', city: '北京', shipping: '可邮寄',
      author: 'p4', createdAt: '2026-10-25T08:50:00Z', photos: 2
    },
    {
      id: 'mk22', category: 'free', status: 'reserved', title: '免费送：一箱技术书',
      body: '搬家清书，技术书为主，自取。',
      price: '免费', condition: '七成新', city: '上海', shipping: '仅同城',
      author: 'me', createdAt: '2026-10-24T12:30:00Z', photos: 3
    },
    {
      id: 'mk23', category: 'free', status: 'sold', title: '免费送：树莓派外壳',
      body: '多买了一个，全新未拆。',
      price: '免费', condition: '全新', city: '深圳', shipping: '可邮寄',
      author: 'p2', createdAt: '2026-10-23T17:05:00Z', photos: 1
    },
    {
      id: 'mk24', category: 'free', status: 'expired', title: '免费送：显示器支架',
      body: '换桌子用不上了，自取。',
      price: '免费', condition: '九成新', city: '杭州', shipping: '面交',
      author: 'me', createdAt: '2026-10-16T10:00:00Z', photos: 1
    }
  ],
  comments: {
    sell: ['成色看起来不错，能寄到外地吗？', '同城的话我想约个时间看看。', '这个型号的驱动现在好装吗？'],
    buy: ['我有一台，晚点发照片给你。', '预算还能再商量吗？', '同城可以面交。'],
    collab: ['做过类似的评测集，想聊聊范围。', '可以先看一版任务拆分吗？', '周期能不能放到三周？'],
    jobs: ['岗位是远程还是坐班？', '评测集大概多大？', '可以先聊聊团队现在的技术栈吗？'],
    groupbuy: ['算我一个，怎么分摊？', '还能加人吗？', '开课时间定了吗？'],
    free: ['我想要，可以自取。', '还在吗？', '邮费我到付就行。']
  }
};
