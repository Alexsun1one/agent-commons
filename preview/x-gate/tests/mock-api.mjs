export const me = { id: 'test-user', handle: 'test-user', display_name: '测试成员', level: 1 };
export const people = [{ id: 'test-person', handle: 'lu-yao', display_name: '测试同行', level: 2 }];
export const agents = [
  { id: 'a-zheng', name: '测试 Agent A', intro: '测试接入', owner: { id: me.id, display_name: me.display_name } },
  { id: 'a-zhuiguang', name: '测试 Agent B', intro: '测试工具', owner: { id: people[0].id, display_name: people[0].display_name } },
];
export const payloads = {
  '/me': me,
  '/agents/catalog': { tools: [{ name: 'test_tool', title: '测试能力', description: '测试说明' }], scopes: [], presets: [], flags: {} },
  '/agentchat/agents': { items: agents.map(a => ({ id: a.id, name: a.name, kind: 'agent', owner_id: a.owner.id, owner_name: a.owner.display_name, blurb: a.intro, skills: [] })) },
  '/agentchat/agents/a-zheng': { id: 'a-zheng', name: '测试 Agent A', blurb: '测试接入', skills: ['测试技能'] },
  '/agents/mine': { agents, drafts: [], limits: {} },
  '/agents/a-zheng/preview': { summary_zh: '没有新回复', sections: {} },
  '/social/profiles': { items: people },
  '/social/people/lu-yao': { person: people[0], relation: { following: true }, self: false },
  '/social/people/test-user': { person: me, relation: null, self: true },
  '/orgs/hub/projects': [{ org: { slug: 'test-team', name: '测试团队', intro: '测试项目' }, works: [{ id: 'work-1', title: '测试作品' }], members: 1, workCount: 1 }],
  '/objects?type=work': [{ id: 'work-1', title: '测试作品', excerpt: '测试内容' }],
  '/events': [{ id: 'event-1', title: '测试活动', summary: '测试活动介绍', startsAt: '2026-11-01T00:00:00Z' }],
  '/bounty/list': [{ id: 'bounty-1', title: '测试悬赏', summary: '测试招募' }],
  '/orgs/hub/opportunities': [{ id: 'op-1', title: '测试机会', excerpt: '测试共创', href: '#/org/test-team' }],
  '/announce/active': { announcement: { id: 'announcement-1', title: '测试公告', body: '测试公告内容' }, marquee: { items: [] } },
  '/feed/events': { events: [{ id: 'feed-1', title_zh: '测试动态', summary_zh: '测试摘要' }] },
  '/growth/me': { ...me, name: me.display_name, levelName: '新队员', points: { season: 0 }, ledger: [{ id: 'entry-1', reason: '测试贡献', points: 0 }] },
  '/achievements/me': { achievements: [{ key: 'badge-1', name: '测试成就', unlocked: false, progress: 0, condition: { threshold: 1 } }] },
  '/economy/me': { currency_name: '竹子', balance: 0 },
  '/notify/notifications': { items: [{ id: 'notification-1', title: '<script>server title</script>', body: '接口通知', read_at: null }] },
  '/notify/unread-count': { count: 1 },
  '/dm/unread-count': { count: 2 },
};
export function mockFetch(mode = 'data', calls = []) {
  return async (url, init = {}) => {
    const path = String(url).replace(/^\/api/, ''); calls.push({ path, ...init });
    if (mode === 'guest') return new Response(JSON.stringify({ error: { code: 'unauthenticated' } }), { status: 401 });
    if (mode === 'error') return new Response(JSON.stringify({ error: { code: 'capability_unavailable' } }), { status: 403 });
    if (init.method && init.method !== 'GET') return new Response(JSON.stringify({ data: { ok: true }, meta: {} }));
    let data = structuredClone(payloads[path] ?? []);
    if (mode === 'empty') {
      if (path === '/me') data = me;
      else if (Array.isArray(data)) data = [];
      else if (path === '/agents/catalog') data = { tools: [], scopes: [], presets: [] };
      else if (path === '/agents/mine') data = { agents: [], drafts: [] };
      else if (path === '/social/profiles' || path === '/notify/notifications' || path === '/agentchat/agents') data = { items: [] };
      else if (path === '/feed/events') data = { events: [] };
      else if (path === '/announce/active') data = { announcement: null };
      else if (path === '/achievements/me') data = { achievements: [] };
      else if (path === '/growth/me') data = { ...me, name: me.display_name, points: { season: 0 }, ledger: [] };
      else if (path.endsWith('unread-count')) data = { count: 0 };
    }
    return new Response(JSON.stringify({ data, meta: {} }));
  };
}
