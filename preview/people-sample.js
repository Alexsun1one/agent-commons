/* R13 PROFILE-1 · 个人主页与作品详情合成数据。人物、作品、统计、评论均为示例。 */
(function () {
  'use strict';

  var MASCOT = 'assets/mascot/';
  var ILLUS = 'assets/illus/';

  function heat(seed) {
    var rows = [];
    var i;
    for (i = 0; i < 182; i += 1) {
      var active = (i + seed) % 9 !== 0 && (i * seed + 3) % 7 !== 0;
      rows.push(active ? ((i * 3 + seed) % 4) + 1 : 0);
    }
    return rows;
  }

  var LEVEL_NAMES = { 1: '新队员', 2: '队员', 3: '骨干', 4: '领航员', 5: '先锋' };
  var EXTRA_AVATARS = [
    'panda-avatar-classic-512.webp', 'panda-avatar-brand-blue-512.webp',
    'panda-avatar-mint-512.webp', 'panda-avatar-mist-purple-512.webp',
    'panda-avatar-graphite-512.webp', 'panda-avatar-night-sky-512.webp'
  ];

  function extraProfile(row, index) {
    var level = Math.max(1, Math.min(5, Number(row[2]) || 1));
    return {
      handle: row[0], name: row[1], level: level, levelName: LEVEL_NAMES[level], theme: 'sky',
      avatar: MASCOT + EXTRA_AVATARS[index % EXTRA_AVATARS.length],
      intro: row[1] + '参与站内示例协作，公开页仅展示合成资料。',
      direction: ['示例成员'], tools: [],
      stats: { works: 0, knowledge: 0, solved: 0, adopted: 0, season: 0 }, heatmap: [],
      workIds: [], badges: [], agents: [], activity: [],
      privacy: { heatmap: false, works: false, badges: false, agents: false, activity: false }
    };
  }

  var profiles = [
    {
      handle: 'lin-qi', name: '林栖', level: 1, levelName: '新队员', theme: 'sky',
      avatar: MASCOT + 'panda-avatar-mint-512.png',
      intro: '把第一次做成的 Agent 小工具，认真记成下一位新人能复现的步骤。',
      direction: ['本地 AI', '入门工具'], tools: ['Ollama', 'Python', 'Obsidian'],
      stats: { works: 1, knowledge: 3, solved: 2, adopted: 1, season: 28 }, heatmap: heat(2),
      workIds: ['local-index'],
      badges: [
        { name: '第一次被采纳', note: '一张知识卡被确认', image: ILLUS + 'empty-no-content.webp' },
        { name: '连续记录', note: '4 周留下公开记录', image: ILLUS + 'empty-no-content.webp' }
      ],
      agents: [{ name: '文件问答助手', job: '在本机资料夹里找答案', status: '试作' }],
      activity: [{ at: '10.24', text: '更新了「本地资料索引」复现说明' }],
      privacy: { heatmap: true, works: true, badges: true, agents: false, activity: false }
    },
    {
      handle: 'chen-mo', name: '陈墨', level: 3, levelName: '骨干', theme: 'blue',
      avatar: MASCOT + 'panda-avatar-brand-blue-512.png',
      intro: '把 Agent 评审从“感觉不错”改成可复查的证据链。',
      direction: ['Agent 工程', '产品评测'], tools: ['Claude Code', 'TypeScript', 'SQLite'],
      stats: { works: 3, knowledge: 18, solved: 26, adopted: 12, season: 186 }, heatmap: heat(5),
      workIds: ['review-lab', 'agent-weekly', 'prompt-safety'],
      badges: [
        { name: '被人复现', note: '4 位成员交回产物', image: ILLUS + 'empty-no-content.webp' },
        { name: '赛季百分', note: '本赛季贡献值超过 100', image: ILLUS + 'empty-no-content.webp' },
        { name: '把知识理顺', note: '完成一次有依据的整理', image: ILLUS + 'empty-no-content.webp' }
      ],
      agents: [
        { name: '证据审阅 Agent', job: '检查结论与证据是否对齐', status: '公开说明' },
        { name: '回归清单 Agent', job: '按版本生成最小验证集', status: '可复现' }
      ],
      activity: [
        { at: '10.25', text: '发布「评审实验台」v1.3 说明' },
        { at: '10.23', text: '确认一份提示词安全清单的复现记录' },
        { at: '10.20', text: '整理了 6 条常见评审偏差' }
      ],
      privacy: { heatmap: true, works: true, badges: true, agents: true, activity: true }
    },
    {
      handle: 'yu-lan', name: '余岚', level: 4, levelName: '领航员', theme: 'violet',
      avatar: MASCOT + 'panda-avatar-mist-purple-512.png',
      intro: '把一场讲堂变成可回放、可练习、可继续协作的知识现场。',
      direction: ['共学组织', '知识工程'], tools: ['Dify', 'Figma', 'Notion'],
      stats: { works: 2, knowledge: 31, solved: 42, adopted: 24, season: 324 }, heatmap: heat(7),
      workIds: ['onboarding-class', 'rag-trace'],
      badges: [
        { name: '主持成场', note: '完成 8 场合格讨论', image: ILLUS + 'empty-no-content.webp' },
        { name: '知识领航', note: '24 条内容被采纳', image: ILLUS + 'empty-no-content.webp' },
        { name: '复现接力', note: '作品产生连续改版', image: ILLUS + 'empty-no-content.webp' }
      ],
      agents: [
        { name: '讲堂切片 Agent', job: '把讲解整理成章节与练习', status: '演示' },
        { name: '知识回访 Agent', job: '提醒过期内容重新核对', status: '内测' },
        { name: '共学排程 Agent', job: '按成员时段生成备选排期', status: '试作' }
      ],
      activity: [
        { at: '10.25', text: '补充「RAG 证据追踪」的许可说明' },
        { at: '10.22', text: '主持一次知识整理讲堂' }
      ],
      privacy: { heatmap: true, works: true, badges: true, agents: true, activity: true }
    },
    {
      handle: 'song-yuan', name: '松原', level: 5, levelName: '先锋', theme: 'night',
      avatar: MASCOT + 'panda-avatar-night-sky-512.webp',
      intro: '把社群规则、治理记录和复核结果留在同一条可追溯链路里。',
      direction: ['社群治理', 'Agent 协作'], tools: ['Python', 'SQLite', '审计日志'],
      stats: { works: 2, knowledge: 47, solved: 58, adopted: 36, season: 462 }, heatmap: heat(8),
      workIds: [],
      badges: [
        { name: '先锋任命', note: '治理委员会决议记录', image: ILLUS + 'badge-l5.webp' },
        { name: '申诉复核', note: '完成一次有依据的复核', image: ILLUS + 'empty-no-content.webp' }
      ],
      agents: [{ name: '治理审计 Agent', job: '把规则变化连回决议与证据', status: '内测' }],
      activity: [{ at: '10.25', text: '复核等级外观不参与回复排序' }],
      privacy: { heatmap: true, works: true, badges: true, agents: true, activity: true }
    }
  ].concat([
    ['acheng', '阿澄', 3],
    ['an-ran', '安然', 2],
    ['bai-xu', '白序', 2],
    ['baihua', '白桦', 1],
    ['bei-chen', '北辰', 3],
    ['cheng-ye', '程野', 4],
    ['chengye', '程野', 2],
    ['chu-yang', '初阳', 2],
    ['fang-hui', '方回', 2],
    ['gu-cheng', '顾澄', 2],
    ['gu-ning', '顾宁', 3],
    ['han-xing', '寒星', 1],
    ['han-zhu', '韩渚', 1],
    ['jiang-lan', '江岚', 5],
    ['jiang-yue', '江月', 1],
    ['jiangwan', '江晚', 4],
    ['jing-shen', '景深', 2],
    ['keyi', '柯一', 2],
    ['lan-xi', '岚溪', 1],
    ['lin-chuan', '林川', 4],
    ['lin-shan', '林杉', 1],
    ['ling-xi', '灵犀', 2],
    ['linqi', '林栖', 5],
    ['lu-yao', '陆遥', 3],
    ['luming', '陆鸣', 2],
    ['ming-li', '明理', 2],
    ['mu-yun', '暮云', 1],
    ['ping-ye', '平野', 1],
    ['pioneer_demo', '新队员', 1],
    ['qi-wu', '栖梧', 2],
    ['qiu-yin', '秋吟', 2],
    ['ruo-shui', '若水', 1],
    ['shan-hai', '山海', 3],
    ['shen-yan', '沈砚', 5],
    ['shu-heng', '书衡', 2],
    ['song-bai', '松柏', 1],
    ['songzy', '宋知遥', 3],
    ['su-wan', '苏晚', 2],
    ['su-xing', '苏行', 4],
    ['sumu', '苏木', 3],
    ['tian-shu', '天枢', 4],
    ['wei-lan', '蔚蓝', 3],
    ['wen-jing', '文静', 2],
    ['wen-xi', '闻溪', 2],
    ['wenzhou', '闻舟', 1],
    ['xia-lan', '夏岚', 2],
    ['xiamu', '夏木', 1],
    ['xiaoman', '小满', 1],
    ['xing-ye', '星野', 3],
    ['xu-he', '许禾', 1],
    ['xutang', '许棠', 2],
    ['ye-ming', '夜明', 1],
    ['ye-zhi', '叶知', 3],
    ['ye-zhou', '叶舟', 3],
    ['yu-heng', '玉衡', 2],
    ['zhi-yuan', '致远', 5],
    ['zhou-lan', '周岚', 3],
    ['zhouyu', '周屿', 4],
    ['zi-yu', '子语', 2]
  ].map(extraProfile));

  var works = [
    {
      id: 'review-lab', author: 'chen-mo', kind: 'html', title: 'Agent 评审实验台',
      summary: '把评审目标、证据、反例和结论放在同一个可操作界面里。',
      description: '先固定任务契约，再逐条核对结论是否由证据支持。这个版本重点处理“测试通过但真实验收面没看过”的误判。',
      cover: ILLUS + 'cover-product-forms.webp', tools: ['HTML', 'TypeScript', 'SQLite'],
      versions: [
        { version: 'v1.3', at: '10.25', note: '加入未验证项与反例列' },
        { version: 'v1.2', at: '10.21', note: '证据项支持逐条引用' },
        { version: 'v1.0', at: '10.14', note: '第一份可复现界面' }
      ],
      reproduced: 4, likes: 38, saves: 17, related: ['prompt-safety', 'agent-weekly'],
      html: '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;background:whitesmoke;color:midnightblue;font:14px/1.5 system-ui;padding:28px}header{display:flex;justify-content:space-between;align-items:end;border-bottom:1px solid lightgray;padding-bottom:18px}h1{font-size:25px;margin:0}small{color:slategray}main{display:grid;grid-template-columns:1.2fr .8fr;gap:16px;margin-top:18px}section{background:white;border:1px solid lightgray;border-radius:12px;padding:18px}ol{padding-left:20px}.ok{color:seagreen}.open{color:slateblue}@media(max-width:700px){main{grid-template-columns:1fr}}</style></head><body><header><div><small>示例 · REVIEW LAB</small><h1>Agent 评审实验台</h1></div><b>3 / 4 已核对</b></header><main><section><h2>结论与证据</h2><ol><li class="ok">契约范围已固定</li><li class="ok">最小测试已通过</li><li class="ok">失败边界已记录</li><li class="open">真实界面待主控验收</li></ol></section><section><h2>当前判断</h2><p>可以交接，但不能宣称真实页面已经验证。</p></section></main></body></html>'
    },
    {
      id: 'agent-weekly', author: 'chen-mo', kind: 'knowledge', title: 'Agent 周报证据卡',
      summary: '只保留可追溯的变化、风险和接力项。',
      description: '一套高密度周报结构：变化来自哪里、由谁验证、还缺哪一个真实验收面。',
      cover: ILLUS + 'cover-agent-plaza.webp', tools: ['Markdown', 'Obsidian'],
      versions: [{ version: 'v1.1', at: '10.24', note: '增加状态分级' }, { version: 'v1.0', at: '10.18', note: '建立模板' }],
      reproduced: 7, likes: 51, saves: 29, related: ['review-lab', 'local-index']
    },
    {
      id: 'prompt-safety', author: 'chen-mo', kind: 'html', title: '提示词安全清单',
      summary: '在执行前把外发、凭据和越权风险摆到台面上。',
      description: '用四个明确问题判断输入、输出和工具调用有没有越过授权边界。',
      cover: ILLUS + 'cover-prompts.webp', tools: ['HTML', 'Policy'],
      versions: [{ version: 'v1.0', at: '10.23', note: '首版清单' }],
      reproduced: 2, likes: 22, saves: 16, related: ['review-lab'],
      html: '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>body{margin:0;padding:30px;background:aliceblue;color:midnightblue;font:15px/1.6 system-ui}main{max-width:760px;margin:auto;background:white;border:1px solid lightblue;border-radius:16px;padding:24px}h1{margin-top:0}.row{display:grid;grid-template-columns:32px 1fr;gap:12px;padding:14px 0;border-top:1px solid lightgray}.n{color:slateblue;font-weight:700}</style></head><body><main><small>示例 · SAFETY CHECK</small><h1>执行前问四遍</h1><div class="row"><span class="n">01</span><span>内容是否来自被授权的范围？</span></div><div class="row"><span class="n">02</span><span>是否会把凭据或私有源码发到外部？</span></div><div class="row"><span class="n">03</span><span>工具调用是否改变了用户没授权的对象？</span></div><div class="row"><span class="n">04</span><span>验证证据是否真的覆盖最终交付面？</span></div></main></body></html>'
    },
    {
      id: 'local-index', author: 'lin-qi', kind: 'knowledge', title: '本地资料索引',
      summary: '让第一次搭本地知识库的人能在 20 分钟内找到第一条答案。',
      description: '记录文件整理、索引、查询与失败排查的最短路径，不上传任何原文。',
      cover: ILLUS + 'cover-skills.webp', tools: ['Ollama', 'Python', 'SQLite'],
      versions: [{ version: 'v0.4', at: '10.24', note: '补充 Windows 路径示例' }, { version: 'v0.1', at: '10.10', note: '第一版笔记' }],
      reproduced: 1, likes: 14, saves: 21, related: ['rag-trace', 'agent-weekly']
    },
    {
      id: 'onboarding-class', author: 'yu-lan', kind: 'lecture', title: '新成员共学讲堂',
      summary: '从一个真实问题开始，带着产物离开。',
      description: '一场 45 分钟的新人讲堂：问题陈述、现场拆解、独立练习和互相复查。',
      cover: ILLUS + 'cover-lecture.webp', tools: ['白板', 'Dify', 'Figma'],
      versions: [{ version: 'v2.0', at: '10.22', note: '加入独立练习' }, { version: 'v1.0', at: '10.02', note: '首场讲堂' }],
      reproduced: 9, likes: 67, saves: 35, related: ['rag-trace', 'local-index']
    },
    {
      id: 'rag-trace', author: 'yu-lan', kind: 'knowledge', title: 'RAG 证据追踪',
      summary: '每个答案都能回到来源、版本和适用边界。',
      description: '用来源快照、更新时间与不确定项，避免把检索到的片段直接写成确定事实。',
      cover: ILLUS + 'cover-components.webp', tools: ['Dify', 'SQLite', '评测集'],
      versions: [{ version: 'v1.4', at: '10.25', note: '补充许可与撤回边界' }, { version: 'v1.0', at: '10.08', note: '首个可复现流程' }],
      reproduced: 12, likes: 83, saves: 46, related: ['local-index', 'review-lab']
    }
  ];

  function comments(work) {
    return [
      {
        id: work.id + '-c1', authorId: work.author, body: '这份说明是示例。欢迎从适用边界开始核对。',
        createdAt: '2026-10-25T16:00:00.000Z', editedAt: null, reply_to: null,
        thread_root: work.id + '-c1', quote: null, status: 'ok', reactions: { useful: 2 }, mine: {}
      },
      {
        id: work.id + '-c2', authorId: 'viewer-demo', body: '我按版本记录复现了一遍，下一步会补自己的产物链接。',
        createdAt: '2026-10-25T17:20:00.000Z', editedAt: null, reply_to: work.id + '-c1',
        thread_root: work.id + '-c1', quote: { id: work.id + '-c1', authorId: work.author, authorName: '作者', excerpt: '欢迎从适用边界开始核对。' },
        status: 'ok', reactions: { reproduced: 1 }, mine: {}
      }
    ];
  }

  works.forEach(function (work) { work.comments = comments(work); });

  var LEGACY_HANDLES = { p1: 'lin-shan', p2: 'gu-cheng', p3: 'ye-zhi', p4: 'wen-xi', p5: 'cheng-ye', p6: 'lu-yao' };
  function legacyPersonByHandle(handle) {
    var id = Object.keys(LEGACY_HANDLES).find(function (key) { return LEGACY_HANDLES[key] === handle; });
    return id && (window.COMMONS_DATA && window.COMMONS_DATA.people || []).find(function (person) { return person.id === id; });
  }
  function externalWork(raw, options) {
    var config = options || {};
    return {
      id: raw.id, author: config.author, kind: config.kind || 'work', title: raw.title,
      summary: raw.subtitle || raw.summary || '站内示例作品。',
      description: raw.description || raw.summary || '这件示例作品从站内入口进入，详情保留作者与来源。',
      cover: raw.cover || 'assets/illus/cover-product-forms.webp',
      tools: config.tools || [], versions: [{ version: '示例', at: '10.25', note: config.note || '补齐站内作品详情入口' }],
      reproduced: 0, likes: 0, saves: 0, related: [], comments: [],
      sourceHref: config.sourceHref, sourceLabel: config.sourceLabel
    };
  }
  function buddyWorkById(id) {
    var row = (window.COMMONS_DATA && window.COMMONS_DATA.works || []).find(function (work) { return work.id === id; });
    if (!row) return null;
    return externalWork(row, {
      author: LEGACY_HANDLES[row.owner] || row.owner,
      kind: 'work', tools: [row.kind || '作品'], note: '从找搭子入口进入作品详情',
      sourceHref: '#/buddies', sourceLabel: '找搭子'
    });
  }
  function campaignWorkById(id) {
    var sample = window.COMMONS_EVENTS_SAMPLE || {};
    var campaigns = sample.campaigns || [];
    var campaign = null;
    var candidate = null;
    campaigns.some(function (item) {
      candidate = (item.candidates || []).find(function (row) { return row.sourceRef === id; }) || null;
      if (candidate) campaign = item;
      return !!candidate;
    });
    if (!candidate || !campaign) return null;
    var person = sample.people && sample.people[candidate.authorId];
    return externalWork(Object.assign({}, candidate, { id: candidate.sourceRef }), {
      author: person && person.handle || candidate.authorId,
      tools: ['打榜候选'], note: '当前排名第 ' + String(candidate.rank || '—'),
      sourceHref: '#/campaign/' + encodeURIComponent(campaign.id), sourceLabel: campaign.title
    });
  }
  window.COMMONS_PEOPLE_SAMPLE = {
    defaultHandle: 'chen-mo', benefitHeading: 'L3 骨干 · 会员只给服务，不改等级。',
    legacyPersonByHandle: legacyPersonByHandle, buddyWorkById: buddyWorkById, campaignWorkById: campaignWorkById,
    label: '示例数据',
    profiles: profiles,
    works: works,
    viewer: { id: 'viewer-demo', name: '我', level: 3, levelName: '骨干' },
    benefits: [
      { key: 'discussion_rooms', name: '讨论室', used: 1, quota: 4, unit: '次 / 月' },
      { key: 'upload_bytes', name: '上传额度', used: 1260, quota: 4096, unit: 'MB / 赛季' },
      { key: 'agent_slots', name: 'Agent 数量', used: 2, quota: 3, unit: '个' }
    ]
  };
})();
