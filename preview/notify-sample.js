/* R13 NOTIF-2 · 离线示例。所有人物与通知内容均为合成数据。 */
window.COMMONS_NOTIFY_SAMPLE = {
  items: [
    { id: 'nt-01', category: 'reply', title: '2 人回复了你', body: '《怎样给 Agent 留出可撤回的权限》有 3 条新回复', link: '#/threads/thread-agent-permissions/reply-3', target: { kind: 'thread', id: 'thread-agent-permissions/reply-3' }, actors: [{ id: 'p1', handle: 'lin-qi', name: '林栖', level: 1 }, { id: 'p3', handle: 'chen-mo', name: '陈墨', level: 3 }], event_count: 3, occurred_at: '2026-10-25T18:42:00.000Z', read_at: null },
    { id: 'nt-02', category: 'mention', title: '松原提到了你', body: '在 Agent 广场讨论“本机记忆边界”时提到了你', link: '#/agents/a-audit', target: { kind: 'agent', id: 'a-audit' }, actors: [{ id: 'p6', handle: 'song-yuan', name: '松原', level: 5 }], event_count: 1, occurred_at: '2026-10-25T17:18:00.000Z', read_at: null },
    { id: 'nt-03', category: 'reward', title: '你的解法被采纳', body: '问题《SQLite 迁移如何安全回放》向你发放了 20 积分', link: '#/bounties/sqlite-migration', target: { kind: 'bounty', id: 'sqlite-migration' }, actors: [{ id: 'p5', handle: 'yu-lan', name: '余岚', level: 4 }], event_count: 1, occurred_at: '2026-10-25T14:06:00.000Z', read_at: null },
    { id: 'nt-04', category: 'achievement', title: '你升级到 L3 骨干', body: '新增能力：发起讲堂、创建长期共作', link: '#/levels', target: { kind: 'game', id: 'levels' }, actors: [], event_count: 1, occurred_at: '2026-10-25T11:30:00.000Z', read_at: '2026-10-25T12:00:00.000Z' },
    { id: 'nt-05', category: 'room', title: '讲堂将在 30 分钟后开始', body: '「Agent 工具调用的失败恢复」· 19:30', link: '#/room/r-stage-accept', target: { kind: 'room', id: 'r-stage-accept' }, actors: [{ id: 'p2', handle: 'yu-lan', name: '余岚', level: 4 }], event_count: 1, occurred_at: '2026-10-25T10:00:00.000Z', read_at: null },
    { id: 'nt-06', category: 'agent', title: '你的 Agent 草稿已保存', body: '草稿只留在本机，尚未发布或通知任何成员', link: '#/agents/a-review', target: { kind: 'agent', id: 'a-review' }, actors: [], event_count: 1, occurred_at: '2026-10-24T23:20:00.000Z', read_at: '2026-10-25T08:00:00.000Z' },
    { id: 'nt-07', category: 'governance', title: '你的一条内容已被隐藏', body: '原因：重复发布。如有异议，30 天内可以申诉。', link: '#/governance', actors: [], event_count: 1, occurred_at: '2026-10-24T16:50:00.000Z', read_at: '2026-10-24T18:00:00.000Z' },
    { id: 'nt-08', category: 'system', title: '内容已不可见', body: '原内容已撤回、隐藏，或你的访问范围已经变化。', link: null, unavailable: true, actors: [], event_count: 1, occurred_at: '2026-10-24T09:10:00.000Z', read_at: null },
    { id: 'nt-09', category: 'park', title: '3 位好友来过你的农场', body: '共 3 条乐园动态', link: '#/farm', target: { kind: 'farm', id: 'chen-mo' }, actors: [{ id: 'p1', handle: 'lin-qi', name: '林栖', level: 1 }, { id: 'p4', handle: 'yu-lan', name: '余岚', level: 4 }, { id: 'p6', handle: 'song-yuan', name: '松原', level: 5 }], event_count: 3, occurred_at: '2026-10-25T19:05:00.000Z', read_at: null },
    { id: 'nt-10', category: 'park', title: '余岚给你的车贴了条', body: '罚没 4 竹子，车已回家', link: '#/parking', target: { kind: 'parking', id: 'chen-mo' }, actors: [{ id: 'p2', handle: 'yu-lan', name: '余岚', level: 4 }], event_count: 1, occurred_at: '2026-10-25T16:40:00.000Z', read_at: null },
    { id: 'nt-11', category: 'event', title: '你报名的活动开始了', body: '《Agent 七日冲刺》已经开始', link: '#/event/ev-agent-sprint', actors: [], event_count: 1, occurred_at: '2026-10-25T13:00:00.000Z', read_at: null },
    { id: 'nt-12', category: 'event', title: '你在活动中获奖了', body: '《最佳提示词》已经公示结果', link: '#/campaign/camp-top-prompts', actors: [], event_count: 1, occurred_at: '2026-10-24T20:00:00.000Z', read_at: '2026-10-24T21:10:00.000Z' },
    { id: 'nt-13', category: 'bounty', title: '陈墨回答了你的悬赏', body: '有一条新的试用反馈待你查看', link: '#/bounties/plugin-trial', target: { kind: 'bounty', id: 'plugin-trial' }, actors: [{ id: 'p5', handle: 'chen-mo', name: '陈墨', level: 3 }], event_count: 1, occurred_at: '2026-10-25T15:12:00.000Z', read_at: null },
    { id: 'nt-14', category: 'bounty', title: '悬赏已到期退回', body: '未选回答，托管积分已退回', link: '#/opportunities', actors: [], event_count: 1, occurred_at: '2026-10-24T12:00:00.000Z', read_at: '2026-10-24T13:00:00.000Z' },
    { id: 'nt-15', category: 'market', title: '陈墨想要你的市集帖子', body: '有人回应了你的帖子', link: '#/market/market-keyboard', target: { kind: 'market', id: 'market-keyboard' }, actors: [{ id: 'p3', handle: 'chen-mo', name: '陈墨', level: 3 }], event_count: 1, occurred_at: '2026-10-25T12:28:00.000Z', read_at: null },
    { id: 'nt-16', category: 'market', title: '余岚回复了你的市集帖子', body: '《出一台闲置键盘》有了新回复', link: '#/market/market-keyboard', target: { kind: 'market', id: 'market-keyboard' }, actors: [{ id: 'p4', handle: 'yu-lan', name: '余岚', level: 4 }], event_count: 1, occurred_at: '2026-10-25T09:15:00.000Z', read_at: null },
    { id: 'nt-17', category: 'dm', title: '你有 2 条新私信', body: '', link: '#/messages/dm-linqi', actors: [{ id: 'p1', handle: 'lin-qi', name: '林栖', level: 1 }, { id: 'p2', handle: 'yu-lan', name: '余岚', level: 4 }], event_count: 2, occurred_at: '2026-10-25T18:10:00.000Z', read_at: null },
    { id: 'nt-18', category: 'dm', title: '你有一条新私信', body: '', link: '#/messages/dm-group', actors: [{ id: 'p6', handle: 'song-yuan', name: '松原', level: 5 }], event_count: 1, occurred_at: '2026-10-25T08:40:00.000Z', read_at: '2026-10-25T09:00:00.000Z' },
    { id: 'nt-19', category: 'announce', title: '周五晚上站点维护', body: '22:00 到 23:00 暂停发布，已有内容可以继续读。', link: '#/announcements', actors: [], event_count: 1, occurred_at: '2026-10-24T08:00:00.000Z', read_at: null },
    { id: 'nt-20', category: 'announce', title: '邀请制内测开放第二批', body: '本周仍按邀请码进入，不开放公开注册。', link: '#/announcements', actors: [], event_count: 1, occurred_at: '2026-10-23T08:00:00.000Z', read_at: '2026-10-23T10:00:00.000Z' },
    { id: 'nt-21', category: 'social_follow', title: '林栖关注了你', body: '关注了你', link: '#/u/lin-qi', target: { kind: 'person', id: 'lin-qi' }, actors: [{ id: 'p1', handle: 'lin-qi', name: '林栖', level: 1 }], event_count: 1, occurred_at: '2026-10-25T20:00:00.000Z', read_at: null },
    { id: 'nt-22', category: 'social_poke', title: '余岚戳了你一下', body: '戳了你一下', link: '#/u/yu-lan', target: { kind: 'person', id: 'yu-lan' }, actors: [{ id: 'p2', handle: 'yu-lan', name: '余岚', level: 4 }], event_count: 1, occurred_at: '2026-10-25T19:56:00.000Z', read_at: null },
    { id: 'nt-23', category: 'social_reaction', title: '陈墨回应了你的动态', body: '对你的动态有了反应', link: '#/feed/p-agent-retry', actors: [{ id: 'p3', handle: 'chen-mo', name: '陈墨', level: 3 }], event_count: 1, occurred_at: '2026-10-25T19:50:00.000Z', read_at: null },
    { id: 'nt-24', category: 'social_share', title: '松原转发了你的动态', body: '转发了你的动态', link: '#/feed/p-agent-poll', actors: [{ id: 'p6', handle: 'song-yuan', name: '松原', level: 5 }], event_count: 1, occurred_at: '2026-10-25T19:45:00.000Z', read_at: null },
    { id: 'nt-25', category: 'social_join_request', title: '吕遥申请加入小组', body: '申请加入「Agent 开发」', link: '#/group/agent-dev/members', target: { kind: 'group', id: 'agent-dev' }, actors: [{ id: 'p7', handle: 'lu-yao', name: '吕遥', level: 2 }], event_count: 1, occurred_at: '2026-10-25T19:40:00.000Z', read_at: null },
    { id: 'nt-26', category: 'social_join_approved', title: '入组申请已通过', body: '你已加入「求职与内推」', link: '#/group/jobs', target: { kind: 'group', id: 'jobs' }, actors: [{ id: 'p5', handle: 'bei-chen', name: '北辰', level: 4 }], event_count: 1, occurred_at: '2026-10-25T19:35:00.000Z', read_at: null }
  ],
  preferences: {
    categories: {
      reply: true, mention: true, reward: true, achievement: true, room: true, agent: true,
      governance: true, system: true, park: true, event: true, bounty: true, market: true,
      dm: true, announce: true, social_follow: true, social_poke: true, social_reaction: true,
      social_share: true, social_join_request: true, social_join_approved: true
    },
    quiet_start: '22:30',
    quiet_end: '07:30',
    daily_digest: true
  }
};
