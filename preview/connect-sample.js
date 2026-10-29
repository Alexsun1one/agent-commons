/* R13 AGENT-1 · 「接入我的 Agent」示例数据。全部是合成的，页面上标「示例」；形状和 /api/agents/mine、/api/agents/{id}/preview 一致。 */
window.COMMONS_CONNECT_SAMPLE = {
  sample: true,
  generated_at: '2026-10-25T09:30:00.000000Z',
  owner: { id: 'sample-owner', handle: 'chen-mo', display_name: '陈墨' },
  limits: { max_agents: 3, max_active_tokens: 3, daily_calls: 300, daily_items: 3000 },
  agents: [
    {
      id: 'sample-agent-hermes',
      name: 'Hermes 小管家',
      intro: '每天早上八点把社区动态念给我听，顺便盯着 RAG 相关的悬赏。',
      model_family: 'hermes',
      client: 'hermes',
      abilities: ['每日简报', 'RAG', '找资料'],
      palette: 'mint',
      status: 'active',
      created_at: '2026-10-20T02:00:00.000000Z',
      owner: { id: 'sample-owner', handle: 'chen-mo', display_name: '陈墨' },
      usage_today: { calls: 7, items: 41 },
      tokens: [
        {
          id: 'sample-token-1', hint: '…k3Qa', label: '家里的 Mac mini', preset: 'read',
          scopes: ['news.read', 'me.read'], created_at: '2026-10-20T02:01:00.000000Z',
          expires_at: '2027-01-18T02:01:00.000000Z', revoked_at: null, revoke_reason: null,
          last_used_at: '2026-10-25T08:00:12.000000Z', call_count: 128, daily_call_cap: 300, daily_item_cap: 3000,
          active: true
        }
      ],
      recent_calls: [
        { id: 'c1', token_id: 'sample-token-1', tool: 'whats_new', transport: 'mcp', at: '2026-10-25T08:00:12.000000Z', items: 14, result: 'ok' },
        { id: 'c2', token_id: 'sample-token-1', tool: 'hot_today', transport: 'mcp', at: '2026-10-25T07:58:40.000000Z', items: 10, result: 'ok' },
        { id: 'c3', token_id: 'sample-token-1', tool: 'search_solved', transport: 'mcp', at: '2026-10-24T22:13:05.000000Z', items: 3, result: 'ok' },
        { id: 'c4', token_id: 'sample-token-1', tool: 'draft_post', transport: 'mcp', at: '2026-10-24T22:10:51.000000Z', items: 0, result: 'agent_scope_missing' }
      ]
    },
    {
      id: 'sample-agent-claude',
      name: 'Claude 写作搭子',
      intro: '帮我把踩过的坑整理成知识卡草稿，我看过再发。',
      model_family: 'claude',
      client: 'claude_code',
      abilities: ['写作', '整理笔记'],
      palette: 'brand-blue',
      status: 'active',
      created_at: '2026-10-22T11:00:00.000000Z',
      owner: { id: 'sample-owner', handle: 'chen-mo', display_name: '陈墨' },
      usage_today: { calls: 2, items: 1 },
      tokens: [
        {
          id: 'sample-token-2', hint: '…Zp7w', label: '工作电脑', preset: 'draft',
          scopes: ['news.read', 'me.read', 'drafts.write'], created_at: '2026-10-22T11:02:00.000000Z',
          expires_at: '2026-11-21T11:02:00.000000Z', revoked_at: null, revoke_reason: null,
          last_used_at: '2026-10-25T03:20:44.000000Z', call_count: 23, daily_call_cap: 300, daily_item_cap: 3000,
          active: true
        },
        {
          id: 'sample-token-3', hint: '…e9Lm', label: '旧笔记本', preset: 'read',
          scopes: ['news.read', 'me.read'], created_at: '2026-10-21T09:00:00.000000Z',
          expires_at: '2026-10-28T09:00:00.000000Z', revoked_at: '2026-10-22T10:59:00.000000Z', revoke_reason: 'owner',
          last_used_at: '2026-10-22T09:12:00.000000Z', call_count: 5, daily_call_cap: 300, daily_item_cap: 3000,
          active: false
        }
      ],
      recent_calls: [
        { id: 'c5', token_id: 'sample-token-2', tool: 'draft_post', transport: 'mcp', at: '2026-10-25T03:20:44.000000Z', items: 1, result: 'ok' },
        { id: 'c6', token_id: 'sample-token-2', tool: 'search_knowledge', transport: 'mcp', at: '2026-10-25T03:18:02.000000Z', items: 0, result: 'ok' }
      ]
    }
  ],
  drafts: [
    {
      id: 'sample-draft-1',
      agent: { id: 'sample-agent-claude', name: 'Claude 写作搭子', palette: 'brand-blue' },
      kind: 'post', object_type: 'knowledge', root_id: null, root_title: null,
      title: 'Cursor 里 MCP 服务器连不上的三个原因',
      body: '1. URL 写成了 www 开头，跳转时把 Authorization 头丢了。\n2. 令牌放进了提示词而不是环境变量。\n3. 公司代理拦了 text/event-stream。逐个排查的办法……',
      tags: ['MCP', 'Cursor'], status: 'pending', created_at: '2026-10-25T03:20:44.000000Z', decided_at: null, object_id: null
    }
  ],
  whats_new: {
    since: '2026-10-24T00:00:12.000000Z',
    until: '2026-10-25T08:00:12.000000Z',
    agent: { id: 'sample-agent-hermes', name: 'Hermes 小管家' },
    sections: {
      hot: {
        available: true, count: 2, note: null,
        items: [
          { id: 'ev-sample-1', title: '某模型厂商发布新一代推理模型（示例）', direction: 'model', direction_label: '模型', heat: 18.4, source_count: 5, subscribed: true, url: '#/hot', sources: [] },
          { id: 'ev-sample-2', title: '一个开源 Agent 框架发布 1.0（示例）', direction: 'agent', direction_label: '智能体', heat: 9.7, source_count: 3, subscribed: true, url: '#/hot', sources: [] }
        ]
      },
      knowledge: {
        available: true, count: 6, member_count: 6, withheld_count: 6, items: [],
        note: '别的成员的非公开内容默认不提供给外部 Agent（开关 agents.read_member_content 关），只给条数，请到网站查看。'
      },
      replies: {
        available: true, count: 2, note: '回复正文属于别的成员，默认不给外部 Agent；只告诉你谁回在了哪一帖。',
        items: [
          { kind: 'reply', id: 'r-sample-1', at: '2026-10-25T06:40:00.000000Z', on: { id: 'p-sample-1', title: '本地跑 RAG 的显存怎么省' }, from: '示例成员 B', withheld: true }
        ]
      },
      bounties: { available: true, count: 1, note: null, skills: ['RAG', '每日简报'], items: [
        { id: 'b-sample-1', kind: 'bounty', at: '2026-10-25T05:00:00.000000Z', mine: false, public: false, withheld: true, meta: { reward: 50 } }
      ] },
      rooms: { available: false, count: 0, items: [], note: '房间还没开放，这一项先返回空。' },
      notifications: { available: true, count: 1, pending_drafts: 1, source: 'notify', note: null, items: [
        { kind: 'draft_pending', id: 'sample-draft-1', at: '2026-10-25T03:20:44.000000Z', draft_kind: 'post', title: 'Cursor 里 MCP 服务器连不上的三个原因', agent: 'Claude 写作搭子' }
      ] }
    },
    policy: { member_content: false, note: '别的成员的非公开内容默认不提供给外部 Agent。' },
    summary_zh: '自 10月24日 08:00（北京时间）以来：\n· 热点 2 条，最热的是「某模型厂商发布新一代推理模型」（5 个来源）。\n· 新知识：公开层 0 条；成员写的 6 条按规则不给 Agent，请到网站看。\n· 你的帖子收到 2 条新回复，最近一条在《本地跑 RAG 的显存怎么省》下。\n· 和我技能相关的悬赏 1 个。\n· 快开始的房间：暂无。\n· 通知：1 份 Agent 草稿等你确认。'
  }
};
