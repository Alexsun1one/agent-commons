/* R13 ANNOUNCE-1 · 示例公告、短讯和赞助。biz-*.webp 尚未入库，图片用已有插画。 */
window.COMMONS_ANNOUNCE_SAMPLE = {
  viewer: { level: 4, member: false, groupId: 'farm' },
  items: [
    {
      id: 'a-important', level: 'important', title: '周五前领取邀请', body: '本周五 18:00 前还可以领。',
      audience: 'site', minLevel: null, groupId: null, dismissible: true, status: 'active',
      target: { kind: 'invite', href: '#/invite' },
      startsAt: '2026-10-20T00:00:00.000000Z', endsAt: '2026-10-31T18:00:00.000000Z'
    },
    {
      id: 'a-maint', level: 'maintenance', title: '周六凌晨短暂停机', body: '10月26日 01:00–02:00。',
      audience: 'site', minLevel: null, groupId: null, dismissible: false, status: 'active',
      target: null,
      startsAt: '2026-10-24T00:00:00.000000Z', endsAt: '2026-10-26T02:00:00.000000Z'
    },
    {
      id: 'a-level', level: 'normal', title: '讲堂加上了章节', body: '回看可以直接跳到某一段。',
      audience: 'level', minLevel: 2, groupId: null, dismissible: true, status: 'active',
      target: { kind: 'talk', id: 'acceptance-replay', href: '#/talk/acceptance-replay' },
      startsAt: '2026-10-18T00:00:00.000000Z', endsAt: '2026-11-15T00:00:00.000000Z'
    },
    {
      id: 'a-group', level: 'normal', title: '农场小组今晚集合', body: '10 点前到的人一起收成。',
      audience: 'group', minLevel: null, groupId: 'farm', dismissible: true, status: 'active',
      target: { kind: 'farm', id: 'chen-mo', href: '#/farm' },
      startsAt: '2026-10-25T00:00:00.000000Z', endsAt: '2026-10-26T00:00:00.000000Z'
    },
    {
      id: 'a-past', level: 'normal', title: '上周的维护已经结束', body: '服务已经恢复。',
      audience: 'site', minLevel: null, groupId: null, dismissible: true, status: 'archived',
      target: null,
      startsAt: '2026-10-01T00:00:00.000000Z', endsAt: '2026-10-18T00:00:00.000000Z'
    }
  ],
  ticker: [
    { id: 't-rank', kind: 'system', body: '林栖在打榜里冲到第 2', target: { kind: 'campaign', id: 'camp-top-prompts', href: '#/campaign/camp-top-prompts' }, public: true, enabled: true, position: 1, startsAt: '2026-10-20T00:00:00.000000Z', endsAt: null },
    { id: 't-solved', kind: 'system', body: '本周新解决 18 个问题', target: { kind: 'bounty', id: 'solved-this-week', href: '#/bounties/solved-this-week' }, public: true, enabled: true, position: 2, startsAt: '2026-10-20T00:00:00.000000Z', endsAt: null },
    { id: 't-farm', kind: 'manual', body: '农场今晚 10 点双倍收成', target: { kind: 'farm', id: 'chen-mo', href: '#/farm' }, public: true, enabled: true, position: 3, startsAt: '2026-10-20T00:00:00.000000Z', endsAt: null }
  ],
  campaigns: [
    {
      id: 'c-hot', name: '方法小课', placement: 'hot-side', image: 'assets/illus/cover-hot.webp',
      line: '本周方法小课', link: '#/talks', why: '热点页的赞助位', status: 'active', freqCap: 3, budgetCents: null,
      startsAt: '2026-10-20T00:00:00.000000Z', endsAt: '2026-11-20T00:00:00.000000Z', impressions: 128, clicks: 9
    },
    {
      id: 'c-events', name: '活动专区', placement: 'events', image: 'assets/illus/cover-lecture.webp',
      line: '本周有一场讲堂', link: '#/events', why: '活动页的赞助位', status: 'active', freqCap: 3, budgetCents: null,
      startsAt: '2026-10-20T00:00:00.000000Z', endsAt: '2026-11-20T00:00:00.000000Z', impressions: 86, clicks: 7
    },
    {
      id: 'c-market', name: '市集上新', placement: 'market-8', image: 'assets/samples/work-weekly-evidence.webp',
      line: '示例市集上新', link: '#/market', why: '市集列表的赞助位', status: 'active', freqCap: 3, budgetCents: null,
      startsAt: '2026-10-20T00:00:00.000000Z', endsAt: '2026-11-20T00:00:00.000000Z', impressions: 54, clicks: 4
    },
    {
      id: 'c-games', name: '先锋农场', placement: 'games-foot', image: 'assets/mascot/panda-squad-512.webp',
      line: '农场今晚双倍收成', link: '#/farm', why: '游戏中心的赞助位', status: 'active', freqCap: 3, budgetCents: null,
      startsAt: '2026-10-20T00:00:00.000000Z', endsAt: '2026-11-20T00:00:00.000000Z', impressions: 73, clicks: 6
    }
  ]
};
