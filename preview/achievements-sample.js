(function () {
  'use strict';

  window.COMMONS_ACHIEVEMENTS_SAMPLE = {
    owner: { handle: 'chen-mo', name: '陈墨', level: 3 },
    week: {
      weekStart: '2026-10-20',
      endsAt: '2026-10-27',
      daysRemaining: 2,
      challenges: [
        { key: 'week-knowledge-one', name: '整理一张知识卡', description: '把本周学到的方法留成一张卡。', progress: 1, target: 1, complete: true, completedAt: '2026-10-23T09:20:00.000000Z' },
        { key: 'week-reply-three', name: '回答三个问题', description: '挑三个能说清楚的问题认真回答。', progress: 2, target: 3, complete: false, completedAt: null },
        { key: 'week-room-one', name: '参加一次讲堂', description: '完整参加一次讲堂。', progress: 0, target: 1, complete: false, completedAt: null }
      ]
    },
    achievements: [
      { key: 'knowledge-first', name: '第一张知识卡', description: '把一个方法整理成可继续使用的知识卡。', icon: 'assets/illus/badge-l1.webp', rarity: 'common', rarityLabel: '常见', progress: 1, target: 1, unlocked: true, unlockedAt: '2026-10-05T08:30:00.000000Z', sitePercent: 68 },
      { key: 'knowledge-three', name: '知识接力', description: '累计发布 3 张知识卡。', icon: 'assets/illus/badge-l2.webp', rarity: 'uncommon', rarityLabel: '少见', progress: 3, target: 3, unlocked: true, unlockedAt: '2026-10-18T11:40:00.000000Z', sitePercent: 34 },
      { key: 'knowledge-ten', name: '方法成林', description: '累计发布 10 张知识卡。', icon: 'assets/illus/badge-l3.webp', rarity: 'rare', rarityLabel: '稀有', progress: 4, target: 10, unlocked: false, unlockedAt: null, sitePercent: 9 },
      { key: 'adopted-first', name: '一次采纳', description: '有一条内容被别人采纳。', icon: 'assets/illus/badge-l1.webp', rarity: 'common', rarityLabel: '常见', progress: 1, target: 1, unlocked: true, unlockedAt: '2026-10-19T16:40:00.000000Z', sitePercent: 51 },
      { key: 'adopted-five', name: '反复有用', description: '累计 5 条内容被采纳。', icon: 'assets/illus/badge-l3.webp', rarity: 'rare', rarityLabel: '稀有', progress: 2, target: 5, unlocked: false, unlockedAt: null, sitePercent: 14 },
      { key: 'adopted-fifteen', name: '成为参考', description: '累计 15 条内容被采纳。', icon: 'assets/illus/badge-l5.webp', rarity: 'legendary', rarityLabel: '传说', progress: 2, target: 15, unlocked: false, unlockedAt: null, sitePercent: 2 },
      { key: 'reproduced-first', name: '有人照着做', description: '一件作品被别人带着产物复现。', icon: 'assets/illus/badge-l2.webp', rarity: 'uncommon', rarityLabel: '少见', progress: 1, target: 1, unlocked: true, unlockedAt: '2026-10-22T11:04:00.000000Z', sitePercent: 23 },
      { key: 'reproduced-three', name: '三次复现', description: '作品累计被复现 3 次。', icon: 'assets/illus/badge-l3.webp', rarity: 'rare', rarityLabel: '稀有', progress: 1, target: 3, unlocked: false, unlockedAt: null, sitePercent: 7 },
      { key: 'reproduced-ten', name: '十次落地', description: '作品累计被复现 10 次。', icon: 'assets/illus/badge-l5.webp', rarity: 'legendary', rarityLabel: '传说', progress: 1, target: 10, unlocked: false, unlockedAt: null, sitePercent: 1 },
      { key: 'room-first', name: '来到讲堂', description: '完整参加一次讲堂。', icon: 'assets/illus/badge-l1.webp', rarity: 'common', rarityLabel: '常见', progress: 1, target: 1, unlocked: true, unlockedAt: '2026-10-12T10:00:00.000000Z', sitePercent: 73 },
      { key: 'room-three', name: '熟面孔', description: '累计参加 3 次讲堂。', icon: 'assets/illus/badge-l2.webp', rarity: 'uncommon', rarityLabel: '少见', progress: 2, target: 3, unlocked: false, unlockedAt: null, sitePercent: 42 },
      { key: 'room-twelve', name: '十二次在场', description: '累计参加 12 次讲堂。', icon: 'assets/illus/badge-l4.webp', rarity: 'epic', rarityLabel: '珍贵', progress: 2, target: 12, unlocked: false, unlockedAt: null, sitePercent: 6 },
      { key: 'streak-three', name: '三日不断', description: '连续 3 天留下行动。', icon: 'assets/illus/badge-l2.webp', rarity: 'uncommon', rarityLabel: '少见', progress: 3, target: 3, unlocked: true, unlockedAt: '2026-10-21T08:10:00.000000Z', sitePercent: 39 },
      { key: 'streak-seven', name: '一周有行动', description: '连续 7 天留下行动。', icon: 'assets/illus/badge-l4.webp', rarity: 'epic', rarityLabel: '珍贵', progress: 4, target: 7, unlocked: false, unlockedAt: null, sitePercent: 11 },
      { key: 'work-first', name: '第一件作品', description: '发布第一件可复现作品。', icon: 'assets/illus/badge-l1.webp', rarity: 'common', rarityLabel: '常见', progress: 1, target: 1, unlocked: true, unlockedAt: '2026-10-08T14:05:00.000000Z', sitePercent: 46 },
      { key: 'work-five', name: '五件可看', description: '累计发布 5 件作品。', icon: 'assets/illus/badge-l3.webp', rarity: 'rare', rarityLabel: '稀有', progress: 2, target: 5, unlocked: false, unlockedAt: null, sitePercent: 8 },
      { key: 'reply-first', name: '回答一次', description: '完成第一次公开回答。', icon: 'assets/illus/badge-l1.webp', rarity: 'common', rarityLabel: '常见', progress: 1, target: 1, unlocked: true, unlockedAt: '2026-10-06T09:35:00.000000Z', sitePercent: 81 },
      { key: 'reply-ten', name: '回答十次', description: '累计完成 10 次公开回答。', icon: 'assets/illus/badge-l3.webp', rarity: 'rare', rarityLabel: '稀有', progress: 6, target: 10, unlocked: false, unlockedAt: null, sitePercent: 18 },
      { key: 'discussion-first', name: '开个好头', description: '发起第一次讨论。', icon: 'assets/illus/badge-l1.webp', rarity: 'common', rarityLabel: '常见', progress: 1, target: 1, unlocked: true, unlockedAt: '2026-10-07T19:20:00.000000Z', sitePercent: 58 },
      { key: 'discussion-five', name: '五次发起', description: '累计发起 5 次讨论。', icon: 'assets/illus/badge-l2.webp', rarity: 'uncommon', rarityLabel: '少见', progress: 3, target: 5, unlocked: false, unlockedAt: null, sitePercent: 21 },
      { key: 'useful-first', name: '收到认可', description: '收到第一次合格的“有用”。', icon: 'assets/illus/badge-l1.webp', rarity: 'common', rarityLabel: '常见', progress: 1, target: 1, unlocked: true, unlockedAt: '2026-10-15T20:02:00.000000Z', sitePercent: 49 },
      { key: 'useful-ten', name: '十次有用', description: '累计收到 10 次合格的“有用”。', icon: 'assets/illus/badge-l4.webp', rarity: 'epic', rarityLabel: '珍贵', progress: 4, target: 10, unlocked: false, unlockedAt: null, sitePercent: 10 },
      { key: 'curate-first', name: '把线索理顺', description: '完成一次被确认的知识整理。', icon: 'assets/illus/badge-l3.webp', rarity: 'rare', rarityLabel: '稀有', progress: 1, target: 1, unlocked: true, unlockedAt: '2026-10-24T13:28:00.000000Z', sitePercent: 12 },
      { key: 'host-first', name: '主持一次', description: '完成一次符合规则的讲堂主持。', icon: 'assets/illus/badge-l4.webp', rarity: 'epic', rarityLabel: '珍贵', progress: 0, target: 1, unlocked: false, unlockedAt: null, sitePercent: 5 }
    ]
  };
})();
