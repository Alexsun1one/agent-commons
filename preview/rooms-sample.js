/* R13 ROOM-1 · 房间示例数据（全部是合成的，页面上处处挂「示例」）。时间按打开页面的时刻往前后推。 */
(function () {
  'use strict';

  var people = [
    { id: 'me', handle: 'yu-lan', name: '余岚', level: 4 },
    { id: 'p-beichen', handle: 'song-yuan', name: '松原', level: 5 },
    { id: 'p-qinglan', handle: 'chen-mo', name: '陈墨', level: 3 },
    { id: 'p-yunzhou', handle: 'lin-qi', name: '林栖', level: 1 },
    { id: 'p-mingli', handle: 'ming-li', name: '明理', level: 2 },
    { id: 'p-anran', handle: 'an-ran', name: '安然', level: 2 },
    { id: 'p-xingye', handle: 'xing-ye', name: '星野', level: 3 },
    { id: 'p-shuheng', handle: 'shu-heng', name: '书衡', level: 2 },
    { id: 'p-lanxi', handle: 'lan-xi', name: '岚溪', level: 1 },
    { id: 'p-qiwu', handle: 'qi-wu', name: '栖梧', level: 2 },
    { id: 'p-zhiyuan', handle: 'zhi-yuan', name: '致远', level: 5 },
    { id: 'p-ruoshui', handle: 'ruo-shui', name: '若水', level: 1 },
    { id: 'p-jingshen', handle: 'jing-shen', name: '景深', level: 2 },
    { id: 'p-muyun', handle: 'mu-yun', name: '暮云', level: 1 },
    { id: 'p-chuyang', handle: 'chu-yang', name: '初阳', level: 2 },
    { id: 'p-weilan', handle: 'wei-lan', name: '蔚蓝', level: 3 },
    { id: 'p-songbai', handle: 'song-bai', name: '松柏', level: 1 },
    { id: 'p-yuheng', handle: 'yu-heng', name: '玉衡', level: 2 },
    { id: 'p-tianshu', handle: 'tian-shu', name: '天枢', level: 4 },
    { id: 'p-hanxing', handle: 'han-xing', name: '寒星', level: 1 },
    { id: 'p-qiuyin', handle: 'qiu-yin', name: '秋吟', level: 2 },
    { id: 'p-lingxi', handle: 'ling-xi', name: '灵犀', level: 2 },
    { id: 'p-jiangyue', handle: 'jiang-yue', name: '江月', level: 1 },
    { id: 'p-shanhai', handle: 'shan-hai', name: '山海', level: 3 },
    { id: 'p-yeming', handle: 'ye-ming', name: '夜明', level: 1 },
    { id: 'p-wenjing', handle: 'wen-jing', name: '文静', level: 2 },
    { id: 'p-pingye', handle: 'ping-ye', name: '平野', level: 1 },
    { id: 'p-ziyu', handle: 'zi-yu', name: '子语', level: 2 }
  ];

  window.COMMONS_ROOMS_SAMPLE = {
    me: { id: 'me', handle: 'yu-lan', name: '余岚', level: 4, roles: [] },
    people: people,
    spaces: [
      { id: 's-agents', name: 'Agent 实践组', members: 42 },
      { id: 's-eval', name: '评测小组', members: 17 }
    ],
    population: { total: 186, byLevel: { 1: 72, 2: 58, 3: 34, 4: 16, 5: 6 } },
    caps: [
      { min_level: 3, max_minutes: 60 },
      { min_level: 4, max_minutes: 120 },
      { role: 'host', max_minutes: 180 },
      { role: 'lecturer', max_minutes: 180 }
    ],
    rules: {
      discussion: { level: 3, roles: ['host', 'lecturer'], capacity: 20 },
      stage: { level: 4, roles: ['host'], capacity: 500 }
    },
    linkHosts: [
      { host: 'meeting.tencent.com', label: '腾讯会议' },
      { host: 'voovmeeting.com', label: '腾讯会议（VooV）' },
      { host: 'vc.feishu.cn', label: '飞书会议' },
      { host: 'vc.larksuite.com', label: 'Lark 会议' }
    ],
    knowledge: [
      { id: 'k-accept', title: '给 Agent 写验收清单的五条规矩', type: 'knowledge', minLevel: 1 },
      { id: 'k-trace', title: '用调用轨迹复盘一次失败的工具调用', type: 'knowledge', minLevel: 2 },
      { id: 'k-eval', title: '评测集的分层抽样（只给 L4 看的草案）', type: 'knowledge', minLevel: 4 },
      { id: 'w-checklist', title: '作品：验收清单生成器', type: 'work', minLevel: 1 }
    ],
    rooms: [
      {
        id: 'r-stage-accept',
        kind: 'stage',
        title: 'Agent 验收清单怎么写',
        background: 'assets/samples/room-teaching-board.webp',
        summary: '一节小课加问答：从一个真实的翻车案例倒推验收清单，后半场开放举手。',
        hostId: 'me',
        state: 'live',
        startOffsetMin: -18,
        duration: 90,
        provider: 'livekit',
        access: [{ kind: 'members' }, { kind: 'level', min_level: 2 }],
        selfUnmute: false,
        boardMode: 'host',
        stageMode: 'screen',
        screenShare: {
          activeId: 'p-qinglan',
          shareAudio: true,
          pending: ['p-yunzhou'],
          sample: 'editor'
        },
        locked: false,
        speakers: [
          { id: 'me', role: 'host', speaking: true },
          { id: 'p-qinglan', role: 'speaker', speaking: false },
          { id: 'p-yunzhou', role: 'speaker', speaking: false, muted: true }
        ],
        listeners: ['p-mingli', 'p-anran', 'p-xingye', 'p-shuheng', 'p-lanxi', 'p-qiwu', 'p-ruoshui', 'p-jingshen',
          'p-muyun', 'p-chuyang', 'p-weilan', 'p-songbai', 'p-yuheng', 'p-hanxing', 'p-qiuyin', 'p-lingxi',
          'p-jiangyue', 'p-shanhai', 'p-yeming', 'p-wenjing', 'p-pingye', 'p-ziyu'],
        extraListeners: 128,
        queue: [
          { id: 'p-anran', state: 'raised' },
          { id: 'p-shuheng', state: 'raised' }
        ],
        agenda: [
          { title: '开场：这次翻车是怎么发生的', minutes: 10, state: 'done' },
          { title: '逐条过验收清单', minutes: 35, state: 'current' },
          { title: '举手问答', minutes: 30, state: 'pending' },
          { title: '收尾：下周例会选题', minutes: 10, state: 'pending' }
        ],
        materials: [
          { kind: 'object', ref: 'k-accept' },
          { kind: 'object', ref: 'k-eval' },
          { kind: 'object', ref: 'w-checklist' },
          { kind: 'link', title: '讲义 PDF（示例链接）', url: 'https://example.org/slides/acceptance.pdf' }
        ],
        chat: [
          { id: 'p-mingli', text: '第三条「失败也要留轨迹」能展开讲讲吗？', min: -4 },
          { id: 'p-xingye', text: '我们组用的是调用轨迹 + 断言，效果不错。', min: -2 },
          { id: 'p-qiwu', text: '想要讲义链接', min: -1 }
        ],
        series: { index: 3, total: 8 }
      },
      {
        id: 'r-disc-eval',
        kind: 'discussion',
        title: '评测集到底要多大？',
        background: 'assets/samples/room-roundtable.webp',
        summary: '小组讨论，每个人带一个自己踩过的评测坑。音视频在腾讯会议里开，这边管议程、白板和纪要。',
        hostId: 'p-beichen',
        state: 'live',
        startOffsetMin: -6,
        duration: 60,
        provider: 'external_link',
        externalUrl: 'https://meeting.tencent.com/dm/SAMPLE00',
        externalLabel: '腾讯会议',
        access: [{ kind: 'members' }, { kind: 'space', space: 'Agent 实践组' }, { kind: 'signup' }],
        selfUnmute: true,
        boardMode: 'all',
        locked: false,
        speakers: [
          { id: 'p-beichen', role: 'host', speaking: true },
          { id: 'p-tianshu', role: 'speaker', speaking: true },
          { id: 'p-weilan', role: 'speaker', speaking: false }
        ],
        listeners: ['p-zhiyuan', 'p-shanhai', 'p-mingli', 'p-ziyu', 'p-qiuyin'],
        extraListeners: 0,
        queue: [],
        agenda: [
          { title: '各自的坑（每人 3 分钟）', minutes: 25, state: 'current' },
          { title: '归纳成一张表', minutes: 25, state: 'pending' }
        ],
        materials: [{ kind: 'object', ref: 'k-trace' }],
        chat: [],
        mySignup: 'approved'
      },
      {
        id: 'r-soon-trace',
        kind: 'discussion',
        title: '调用轨迹复盘会',
        background: 'assets/samples/room-pair-coding.webp',
        summary: '每人带一条失败的调用轨迹，一起找根因。需要报名，主持人批准后能进。',
        hostId: 'p-xingye',
        state: 'scheduled',
        startOffsetMin: 42,
        duration: 45,
        provider: 'livekit',
        access: [{ kind: 'members' }, { kind: 'level', min_level: 2 }, { kind: 'signup' }],
        selfUnmute: true,
        signups: 9,
        agenda: [
          { title: '轨迹轮读', minutes: 30, state: 'pending' },
          { title: '记下要改的规则', minutes: 15, state: 'pending' }
        ],
        materials: [{ kind: 'object', ref: 'k-trace' }],
        mySignup: null
      },
      {
        id: 'r-soon-weekly',
        kind: 'stage',
        title: '周四例会 · 本周热点里的 Agent',
        summary: '每周四晚上，三位轮值讲者各讲十分钟，后面开放举手。',
        hostId: 'p-qinglan',
        state: 'scheduled',
        startOffsetMin: 60 * 24 * 4 + 120,
        duration: 60,
        provider: 'external_link',
        externalUrl: 'https://vc.feishu.cn/j/000000000',
        externalLabel: '飞书会议',
        access: [{ kind: 'members' }],
        series: { index: 6, total: 12 },
        agenda: [
          { title: '轮值讲者 1', minutes: 10, state: 'pending' },
          { title: '轮值讲者 2', minutes: 10, state: 'pending' },
          { title: '轮值讲者 3', minutes: 10, state: 'pending' },
          { title: '举手', minutes: 30, state: 'pending' }
        ],
        materials: [],
        mySignup: 'approved'
      },
      {
        id: 'r-ended-tools',
        kind: 'discussion',
        title: '工具调用超时怎么兜底',
        summary: '上周的讨论室。',
        hostId: 'p-yunzhou',
        state: 'ended',
        startOffsetMin: -60 * 24 * 3,
        duration: 50,
        provider: 'livekit',
        access: [{ kind: 'members' }],
        agenda: [
          { title: '各家的兜底写法', minutes: 30, state: 'done' },
          { title: '投票选一个默认值', minutes: 20, state: 'done' }
        ],
        materials: [{ kind: 'board', title: '白板 · 兜底写法对比' }],
        attended: 14
      }
    ]
  };
})();
