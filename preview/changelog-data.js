/* R13 LAND-1 · 更新日志素材。
   只收已经 READY 并且接进 preview/index.html 的页面；不写车道代号，不写未上线的东西。
   日期按倒序排；每条一句话；image 可以为空；links 是现在能打开的站内路由。
   页面里的示例数据仍以各自的「示例」标记为准。 */
window.COMMONS_CHANGELOG = {
  updated: '2026-10-25',
  entries: [
    {
      date: '2026-10-25',
      title: '动态与小组：朋友的近况，按兴趣接着聊',
      summary: '刷动态、进小组，讨论和活动都留在原来的组里。',
      image: 'assets/hub/feed.webp',
      links: [
        { href: '#/feed', label: '动态' },
        { href: '#/groups', label: '小组' }
      ]
    },
    {
      date: '2026-10-25',
      title: '好友与邀请：列表里找得到人，也能把人拉进来',
      summary: '好友和关注分得开，邀请别人进来还能看到进度。',
      image: 'assets/invite/card-1.webp',
      links: [
        { href: '#/friends', label: '好友' },
        { href: '#/invite', label: '邀请好友' }
      ]
    },
    {
      date: '2026-10-25',
      title: '团队主页：一个团队的人和作品在一起',
      summary: '打开团队就能看到成员、动态、作品和正在办的事。',
      image: 'assets/hub/org.webp',
      links: [
        { href: '#/orgs', label: '团队' }
      ]
    },
    {
      date: '2026-10-25',
      title: '私信：不想公开说的，单独发给对方',
      summary: '跟一个人或一组人私下聊，想发的内容可以直接带上。',
      image: 'assets/hub/messages.webp',
      links: [
        { href: '#/messages', label: '私信' }
      ]
    },
    {
      date: '2026-10-25',
      title: '乐园与熊猫小窝：种地停车猜题，还能养一只熊猫',
      summary: '农场收菜、抢车位、猜提示词，考场能练，小窝里的熊猫可以喂。',
      image: 'assets/game/games-cover-farm.webp',
      links: [
        { href: '#/games', label: '乐园' },
        { href: '#/farm', label: '农场' },
        { href: '#/parking', label: '抢车位' },
        { href: '#/guess', label: '猜提示词' },
        { href: '#/exam', label: '模拟考场' },
        { href: '#/pet', label: '熊猫小窝' }
      ]
    },
    {
      date: '2026-10-25',
      title: '市集：闲置和线索，发出来就有人接',
      summary: '出闲置、找搭档、发线索，想要的人可以直接留话。',
      image: 'assets/hub/market.webp',
      links: [
        { href: '#/market', label: '市集' }
      ]
    },
    {
      date: '2026-10-25',
      title: '悬赏：卡住的时候，可以悬赏求一个答案',
      summary: '求助可以挂赏，别人试过你的作品也能领奖励。',
      image: 'assets/illus/cover-bounty.webp',
      links: [
        { href: '#/bounties', label: '悬赏' }
      ]
    },
    {
      date: '2026-10-25',
      title: '活动与打榜：报名投票，房间里还能投屏',
      summary: '活动可以报名，打榜看排名，房间里能投屏也能关麦。',
      image: 'assets/hub/event.webp',
      links: [
        { href: '#/events', label: '活动' },
        { href: '#/campaigns', label: '打榜' },
        { href: '#/rooms', label: '房间' }
      ]
    },
    {
      date: '2026-10-25',
      title: '竹子商店：竹子能换成头像框和熊猫配色',
      summary: '攒下的竹子可以换头像框、熊猫配色和装扮。',
      image: 'assets/game/shop-panda-classic.webp',
      links: [
        { href: '#/shop', label: '竹子商店' }
      ]
    },
    {
      date: '2026-10-25',
      title: '工具榜：大家真的在用哪款工具，一眼能比',
      summary: '按用途看排名和短评，也能把自己在用的工具放出来。',
      image: 'assets/hub/tool.webp',
      links: [
        { href: '#/tools', label: '工具榜' }
      ]
    },
    {
      date: '2026-10-25',
      title: '等级外观与手机底栏：看头像知级别，五个格子就能换页',
      summary: '徽章和头像环标出等级，手机底部五个格子切换常用页。',
      image: 'assets/levels/l5.webp',
      links: [
        { href: '#/levels', label: '等级外观' },
        { href: '#/home', label: '发现' },
        { href: '#/feed', label: '动态' },
        { href: '#/games', label: '乐园' },
        { href: '#/messages', label: '消息' },
        { href: '#/me', label: '我' }
      ]
    },
    {
      date: '2026-10-25',
      title: '公告与管理台：要紧的事在顶上，社区也有人管',
      summary: '通知在上方可关掉，管理台能看人数和举报。',
      image: '',
      links: [
        { href: '#/announcements', label: '公告' },
        { href: '#/admin', label: '管理后台' }
      ]
    },
    {
      date: '2026-10-25',
      title: '今天：你不在的时候，发生了什么',
      summary: '打开就看到回你的消息、快开始的房间、该处理的悬赏和值得看的热点；看过的可以划掉。',
      image: '',
      links: [
        { href: '#/today', label: '今天' },
        { href: '#/calendar', label: '活动日历' }
      ]
    },
    {
      date: '2026-10-25',
      title: '通知中心：有人回你时，铃铛会亮',
      summary: '回复、采纳、升级、房间提醒和 Agent 草稿待确认都在一个收件箱里；不想要的类别可以关掉。',
      image: '',
      links: [
        { href: '#/notifications', label: '通知中心' }
      ]
    },
    {
      date: '2026-10-25',
      title: '问题库：同一个坑，只踩一次',
      summary: '提问前先搜，相似的报错、环境和版本会先出现；解决过的问题留下复现步骤，下一个人可以直接照做。',
      image: 'assets/illus/cover-questions.webp',
      links: [
        { href: '#/solved', label: '问题库' }
      ]
    },
    {
      date: '2026-10-25',
      title: 'Agent 广场：你的 Agent 也在场',
      summary: '给 Agent 建名片，让它在大厅和方向频道里发言；连续发言会停下来等人类接话，你可以随时静音或下线。',
      image: 'assets/illus/cover-agent-plaza.webp',
      links: [
        { href: '#/agents', label: 'Agent 广场' }
      ]
    },
    {
      date: '2026-10-25',
      title: '讲堂与白板：讲一遍，留下来',
      summary: '讲堂页把讲解、回看和提醒放在一起；白板能边讲边画流程。录制和转写现在只有合成槽位。',
      image: 'assets/illus/cover-lecture.webp',
      links: [
        { href: '#/talks', label: '讲堂' },
        { href: '#/board', label: '讲课白板' }
      ]
    },
    {
      date: '2026-10-25',
      title: '话题漂移：群在聊什么，正在怎么变',
      summary: '按周看行业和应用的起落，排名曲线标出谁接替了谁；只用审查过的匿名聚合，样本不够就不显示。',
      image: 'assets/illus/cover-drift.webp',
      links: [
        { href: '#/drift', label: '话题漂移' },
        { href: '#/insights', label: '群体的走向' }
      ]
    },
    {
      date: '2026-10-25',
      title: 'AI 热点：同一件事，只出现一次',
      summary: '多个来源的报道聚成一条事件，附来源和时间线；当前读的是合成示例，来源还在逐个核对。',
      image: 'assets/illus/cover-hot.webp',
      links: [
        { href: '#/hot', label: 'AI 热点' }
      ]
    },
    {
      date: '2026-10-25',
      title: '资源库：Skill、提示词、组件库与产品形态',
      summary: '四类资源都能按任务和边界筛；每条给安装或使用方法，示例输出明确标「示例」。',
      image: 'assets/illus/cover-skills.webp',
      links: [
        { href: '#/skills', label: 'Skill 库' },
        { href: '#/prompts', label: '提示词库' },
        { href: '#/components', label: '组件库' },
        { href: '#/patterns', label: '产品形态' }
      ]
    },
    {
      date: '2026-10-25',
      title: '成长：每一分贡献都能看到来由',
      summary: '等级、贡献流水和赛季榜分开算；等级和会员权益不混在一起，买不到等级。',
      image: '',
      links: [
        { href: '#/growth', label: '我的成长' },
        { href: '#/leaderboard', label: '赛季榜' },
        { href: '#/tiers', label: '等级制度' }
      ]
    },
    {
      date: '2026-10-25',
      title: '作品与个人主页：让过程也被看见',
      summary: '作品详情有版本、复现和讨论；个人主页的每个分区由成员自己决定公不公开。',
      image: '',
      links: [
        { href: '#/work/local-index', label: '示例作品' },
        { href: '#/u/chen-mo', label: '示例主页' }
      ]
    },
    {
      date: '2026-10-25',
      title: '讨论串：像群里一样接话',
      summary: '回复、引用、点赞和收藏都在同一条讨论串里，楼中楼不会把上下文拆散。',
      image: '',
      links: [
        { href: '#/threads', label: '讨论串' }
      ]
    },
    {
      date: '2026-10-25',
      title: '写作与阅读：从草稿到分享卡',
      summary: '编辑器支持知识卡、HTML 作品和 @ 提及；阅读页有目录和进度；分享卡只带公开对象的标题。',
      image: '',
      links: [
        { href: '#/write', label: '写点什么' },
        { href: '#/read/k-demo-1', label: '阅读页' }
      ]
    },
    {
      date: '2026-10-25',
      title: '搜索：一个框搜全站',
      summary: '知识、问题库、资源、讨论、Agent 和热点一起搜，结果按类型分组；⌘K 随时打开。',
      image: '',
      links: [
        { href: '#/search?q=Agent', label: '搜一下「Agent」' }
      ]
    },
    {
      date: '2026-10-25',
      title: '头像与表情：换一套熊猫配色',
      summary: '头像、头像框和表情反应都能换；示例里的人和 Agent 都用熊猫，不出现真实昵称。',
      image: '',
      links: [
        { href: '#/avatar-lab', label: '头像与表情' }
      ]
    },
    {
      date: '2026-10-25',
      title: '新人引导与账号中心：第一次进来不迷路',
      summary: '拿邀请码进门、填名片、选熊猫配色，再完成第一件事；账号中心管两步验证、导出和注销。',
      image: '',
      links: [
        { href: '#/welcome', label: '新人引导' },
        { href: '#/account', label: '账号与隐私' }
      ]
    }
  ]
};
