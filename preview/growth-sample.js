/* R13 GROW-FE · 合成样例。形状即 GROW-1 后端契约。处处示例，不用真实群成员。 */
(() => {
  'use strict';

  window.COMMONS_GROWTH_SAMPLE = {
    me: {
      id: 'me',
      name: '顾澄',
      level: 2,
      levelName: '队员',
      consentMetering: true,
      season: {
        id: 's2026q4',
        name: '2026 冬赛季',
        startsAt: '2026-10-01',
        endsAt: '2026-12-31'
      },
      next: {
        level: 3,
        criteria: [
          { key: 'active-half', label: '近 60 天过半活跃', have: 28, need: 30, unit: '天' },
          { key: 'adopted', label: '内容被采纳', have: 2, need: 5, unit: '次' },
          { key: 'report-n', label: '有效举报样本', have: 8, need: 10, unit: '次' },
          { key: 'wilson', label: '举报准确率', have: 52, need: 60, unit: '%' }
        ]
      },
      unlocked: ['read', 'discuss', 'favorite', 'report', 'listen', 'knowledge', 'upload', 'hand', 'invite'],
      nextUnlocks: ['room', 'suggest', 'hide', 'volunteer'],
      points: {
        season: 86,
        weekly: [
          { week: '2026-10-06', total: 5 },
          { week: '2026-10-13', total: 20 },
          { week: '2026-10-20', total: 48 },
          { week: '2026-10-27', total: 86 }
        ]
      },
      ledger: [
        {
          id: 'lg-08',
          at: '2026-10-24T21:18:00+08:00',
          event: 'useful',
          points: 3,
          ruleVersion: 'contrib-2026.10',
          confirmer: { level: 3 },
          reason: '叶知标了「有用」。互相标记，按 0.5 计后再按标记人等级加权到 3 分。',
          discount: { factor: 0.5, why: '互相标记，按 0.5 计' },
          reverses: null
        },
        {
          id: 'lg-07',
          at: '2026-10-22T11:04:00+08:00',
          event: 'reproduced',
          points: 30,
          ruleVersion: 'contrib-2026.10',
          confirmer: { level: 4 },
          reason: '闻溪提交了复现产物，程野作为第三人确认。本赛季这对人只计一次。',
          discount: null,
          reverses: null
        },
        {
          id: 'lg-06',
          at: '2026-10-19T16:40:00+08:00',
          event: 'adopted',
          points: 20,
          ruleVersion: 'contrib-2026.10',
          confirmer: { level: 3 },
          reason: '知识条目「验收清单怎么写失败样本」被采纳。确认人随机分派，无利益关系。',
          discount: null,
          reverses: null
        },
        {
          id: 'lg-05',
          at: '2026-10-17T09:12:00+08:00',
          event: 'host',
          points: 15,
          ruleVersion: 'contrib-2026.10',
          confirmer: { level: 3 },
          reason: '主持公开房间 42 分钟，在场 L2+ 共 6 人。当天第 1 次，未触顶。',
          discount: null,
          reverses: null
        },
        {
          id: 'lg-04',
          at: '2026-10-15T20:02:00+08:00',
          event: 'useful',
          points: 5,
          ruleVersion: 'contrib-2026.10',
          confirmer: { level: 2 },
          reason: '程野标了「有用」。账号满 7 天、不在邀请树里。',
          discount: null,
          reverses: null
        },
        {
          id: 'lg-03',
          at: '2026-10-14T13:28:00+08:00',
          event: 'curate',
          points: 10,
          ruleVersion: 'contrib-2026.10',
          confirmer: { level: 4 },
          reason: '把两条重复的评测方法合并，并补了反例。治理员确认。',
          discount: null,
          reverses: null
        },
        {
          id: 'lg-02',
          at: '2026-10-12T18:55:00+08:00',
          event: 'report',
          points: 3,
          ruleVersion: 'contrib-2026.10',
          confirmer: { level: 4 },
          reason: '举报一条未标来源的转载，治理员判定成立。',
          discount: null,
          reverses: null
        },
        {
          id: 'lg-01',
          at: '2026-10-08T10:06:00+08:00',
          event: 'violation',
          points: -50,
          ruleVersion: 'contrib-2026.10',
          confirmer: { level: 4 },
          reason: '误把未授权摘录写进公开条目。已冲正到 lg-00，冷却期后可回升。',
          discount: null,
          reverses: 'lg-00'
        },
        {
          id: 'lg-00',
          at: '2026-10-09T08:30:00+08:00',
          event: 'adopted',
          points: 20,
          ruleVersion: 'contrib-2026.10',
          confirmer: { level: 4 },
          reason: '冲正：lg-01 的违规成立后，把同日误记的采纳分撤回。',
          discount: null,
          reverses: 'lg-01'
        }
      ],
      badges: [
        { id: 'first-useful', name: '第一次被标有用', earnedAt: '2026-10-15', how: '收到一次合格的「有用」。', icon: 'appreciation' },
        { id: 'reproduced-once', name: '被人复现', earnedAt: '2026-10-22', how: '作品被别人带着产物复现一次。', icon: 'reproduced' },
        { id: 'host-room', name: '把房间撑满', earnedAt: null, how: '主持一场 ≥ 5 位 L2+、在场 ≥ 10 分钟的房间。', icon: 'discussion' },
        { id: 'season-100', name: '赛季百分', earnedAt: null, how: '单个赛季贡献值达到 100。', icon: 'trending' },
        { id: 'curator', name: '把知识理顺', earnedAt: null, how: '一次整理（合并、补证据或标过期）被确认。', icon: 'organized' },
        { id: 'pioneer-mark', name: '先锋印记', earnedAt: null, how: '由治理委员会授予 L5。不能自己攒。', icon: 'milestone' }
      ]
    },
    board: {
      contribution: [
        { rank: 1, id: 'u-ye', name: '叶知', level: 3, points: 240, delta: 18 },
        { rank: 2, id: 'u-wen', name: '闻溪', level: 3, points: 198, delta: 6 },
        { rank: 3, id: 'u-lu', name: '陆遥', level: 4, points: 176, delta: -4 },
        { rank: 4, id: 'u-xu', name: '许禾', level: 3, points: 154, delta: 12 },
        { rank: 5, id: 'u-he', name: '何宁', level: 2, points: 132, delta: 9 },
        { rank: 6, id: 'u-shen', name: '沈酌', level: 3, points: 118, delta: -2 },
        { rank: 7, id: 'me', name: '顾澄', level: 2, points: 86, delta: 14 },
        { rank: 8, id: 'u-cheng', name: '程野', level: 2, points: 81, delta: 3 },
        { rank: 9, id: 'u-an', name: '安栖', level: 2, points: 74, delta: 1 },
        { rank: 10, id: 'u-mu', name: '慕白', level: 2, points: 69, delta: -8 },
        { rank: 11, id: 'u-qi', name: '齐岚', level: 2, points: 61, delta: 5 },
        { rank: 12, id: 'u-fang', name: '方澄', level: 1, points: 44, delta: 7 },
        { rank: 13, id: 'u-tao', name: '陶予', level: 2, points: 39, delta: 0 },
        { rank: 14, id: 'u-lin', name: '林予', level: 1, points: 33, delta: 4 },
        { rank: 15, id: 'u-jiang', name: '江衡', level: 2, points: 28, delta: -1 },
        { rank: 16, id: 'u-su', name: '苏晚', level: 1, points: 22, delta: 2 },
        { rank: 17, id: 'u-pei', name: '裴舟', level: 1, points: 18, delta: 0 },
        { rank: 18, id: 'u-yuan', name: '袁汀', level: 1, points: 14, delta: 3 },
        { rank: 19, id: 'u-zhao', name: '赵岭', level: 1, points: 11, delta: -3 },
        { rank: 20, id: 'u-wu', name: '吴澈', level: 1, points: 8, delta: 1 }
      ],
      optedOut: false,
      publicRanking: false
    },
    tokens: [
      { id: 'demo-gateway', name: '网关计量样例', level: 3, band: '1–5 亿', family: 'Claude', trust: 'gateway', perMillion: { works: 1.8, adopted: 0.6, reproduced: 0.2 }, demo: true },
      { id: 'u-ye', name: '叶知', level: 3, band: '5000 万–1 亿', family: 'Claude', trust: 'self', perMillion: { works: 0.9, adopted: 0.4, reproduced: 0.1 } },
      { id: 'u-wen', name: '闻溪', level: 3, band: '1000 万–5000 万', family: 'GPT', trust: 'self', perMillion: { works: 1.2, adopted: 0.5, reproduced: 0.2 } },
      { id: 'u-lu', name: '陆遥', level: 4, band: '1000 万–5000 万', family: 'Gemini', trust: 'self', perMillion: { works: 2.1, adopted: 0.8, reproduced: 0.3 } },
      { id: 'me', name: '顾澄', level: 2, band: '100 万–1000 万', family: 'Claude', trust: 'self', perMillion: { works: 1.4, adopted: 0.3, reproduced: 0.1 } },
      { id: 'u-cheng', name: '程野', level: 2, band: '不足 100 万', family: '本地开源', trust: 'self', perMillion: { works: 3.0, adopted: 0.7, reproduced: 0.4 } },
      { id: 'u-xu', name: '许禾', level: 3, band: '100 万–1000 万', family: 'GPT', trust: 'self', perMillion: { works: 0.6, adopted: 0.2, reproduced: 0.0 } }
    ]
  };
})();
