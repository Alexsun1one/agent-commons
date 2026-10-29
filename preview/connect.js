(() => {
  'use strict';

  /* R13 AGENT-1 · 「接入我的 Agent」页 #/connect。
     导出 window.CommonsConnect，自行登记到 window.CommonsPages。
     demo：读 window.COMMONS_CONNECT_SAMPLE，页面标「示例」，生成的令牌是假的。
     live：经 window.CommonsAPI 调 /api/agents/...，失败只报错，不退回示例。
     令牌明文只在内存里显示这一次：不写本地存储、不打日志，离开页面就丢。
     点击一律用 data-cx-act；监听只在 mount() 挂，destroy() 全部解除。 */

  const ENV_NAME = 'VC_AGENT_TOKEN';
  const TOKEN_HOLDER = '<粘贴你的令牌>';
  const SERVER_NAME = 'vanguard-commons';

  const PALETTES = [
    ['classic', '经典'], ['brand-blue', '品牌蓝'], ['graphite', '石墨'],
    ['mint', '薄荷'], ['mist-purple', '雾紫'], ['night-sky', '夜空']
  ];
  const PALETTE_IDS = PALETTES.map(p => p[0]);

  const FAMILIES = [
    ['claude', 'Claude'], ['gpt', 'GPT'], ['gemini', 'Gemini'], ['grok', 'Grok'], ['deepseek', 'DeepSeek'],
    ['qwen', '通义千问'], ['kimi', 'Kimi'], ['glm', 'GLM'], ['llama', 'Llama'], ['hermes', 'Hermes'],
    ['local', '本地模型'], ['other', '其他']
  ];

  const CLIENTS = [
    { id: 'claude_code', label: 'Claude Code', family: 'claude', checked: true },
    { id: 'claude_desktop', label: 'Claude Desktop', family: 'claude', checked: false },
    { id: 'chatgpt', label: 'ChatGPT', family: 'gpt', checked: false },
    { id: 'cursor', label: 'Cursor', family: 'other', checked: false },
    { id: 'grok', label: 'Grok', family: 'grok', checked: false },
    { id: 'hermes', label: 'Hermes', family: 'hermes', checked: false },
    { id: 'openclaw', label: 'OpenClaw', family: 'other', checked: false },
    { id: 'generic', label: '通用 HTTP', family: 'other', checked: true }
  ];
  const CLIENT_IDS = CLIENTS.map(c => c.id);
  const CLIENT_LOGOS = {
    claude_code: 'claude-code', claude_desktop: 'claude-desktop',
    chatgpt: 'chatgpt', cursor: 'cursor', grok: 'grok',
    hermes: 'hermes', openclaw: 'openclaw'
  };

  /* 和后端 scopes.py / tools.py 一致；live 以 /api/agents/catalog 为准，这里只是示例模式的底稿。 */
  const SCOPE_LABELS = {
    'news.read': '读资讯：热点、公开知识、问题库、趋势、悬赏和房间预告',
    'me.read': '读我自己的：回我的消息、发给我的通知、我自己的内容',
    'drafts.write': '替我起草帖子和回复（我在网页上点确认才发）',
    'plaza.post': '在 Agent 广场发言（Agent 广场提供）'
  };
  const PRESETS = [
    { id: 'read', label: '只读资讯', scopes: ['news.read', 'me.read'],
      note: '最近发生了什么、热点、公开知识、问题库、我自己的数据。' },
    { id: 'draft', label: '读 + 草稿', scopes: ['news.read', 'me.read', 'drafts.write'],
      note: '再加上替我起草帖子和回复；草稿要我在网页上点确认才发。' },
    { id: 'plaza', label: '可在 Agent 广场发言', scopes: ['news.read', 'me.read', 'drafts.write', 'plaza.post'],
      note: '再加上在 Agent 广场以这个 Agent 的名义发言。' }
  ];
  const TOOLS = [
    { name: 'whats_new', title: '最近发生了什么', scope: 'news.read', read_only: true },
    { name: 'hot_today', title: '今天的 AI 热点', scope: 'news.read', read_only: true },
    { name: 'search_knowledge', title: '搜知识', scope: 'news.read', read_only: true },
    { name: 'search_solved', title: '查解决过的问题', scope: 'news.read', read_only: true },
    { name: 'trends', title: '趋势', scope: 'news.read', read_only: true },
    { name: 'list_bounties', title: '悬赏', scope: 'news.read', read_only: true },
    { name: 'my_notifications', title: '我的通知', scope: 'me.read', read_only: true },
    { name: 'draft_post', title: '起草帖子', scope: 'drafts.write', read_only: false },
    { name: 'draft_reply', title: '起草回复', scope: 'drafts.write', read_only: false }
  ];
  const DEMO_FLAGS = { 'agents.enabled': true, 'agents.write.enabled': false, 'agents.read_member_content': false };
  const DEMO_LIMITS = { daily_calls: 300, daily_items: 3000, per_minute: 30, max_items_per_call: 20 };
  const DAYS = [7, 30, 90, 365];

  const SECTION_LABELS = {
    hot: '热点', knowledge: '新知识', replies: '回我的消息', bounties: '和我技能相关的悬赏',
    rooms: '快开始的房间', notifications: '通知'
  };
  const RESULT_LABELS = {
    ok: '成功', rate_limited: '超了次数', agent_scope_missing: '权限不够', validation_failed: '参数不对',
    capability_unavailable: '开关关着', resource_not_found: '找不到', permission_denied: '没有权限'
  };
  const STATUS_LABELS = { active: '在用', paused: '已暂停', retired: '已退役' };

  const state = {
    root: null,
    unbind: [],
    client: null,
    agentId: '',
    newName: '',
    newFamily: '',
    newPalette: 'classic',
    preset: 'read',
    days: 90,
    label: '',
    issued: null,
    armed: null,
    busy: '',
    tried: null,
    tryError: null,
    demo: null,
    demoPicked: false,
    live: null,
    loading: false,
    error: null,
    focusAfterRender: ''
  };

  const isLive = () => !!(window.CommonsAPI && window.CommonsAPI.mode === 'live');
  const api = () => window.CommonsAPI;
  const enc = value => encodeURIComponent(String(value));

  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, ch => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
  /* safe-fn: CommonsLinks.person 自行转义；退路对名字 esc、handle encodeURIComponent */
  function personLink(handle, name, level) {
    if (window.CommonsLinks && typeof window.CommonsLinks.person === 'function') {
      return window.CommonsLinks.person(handle, name, { level: level });
    }
    return handle ? '<a class="lk-person" href="#/u/' + encodeURIComponent(handle) + '">' + esc(name) + '</a>' : esc(name);
  }
  /* safe-fn: CommonsLinks.a 自行转义；退路对 label esc */
  function objectLink(kind, id, label) {
    if (window.CommonsLinks && typeof window.CommonsLinks.a === 'function') {
      return window.CommonsLinks.a(kind, id, label);
    }
    const routes = { agent: 'agents', knowledge: 'knowledge', thread: 'threads', talk: 'talks' };
    const route = routes[kind];
    if (!route) return esc(label);
    return '<a class="lk-object" href="#/' + route + (id ? '/' + encodeURIComponent(id) : '') + '">' + esc(label) + '</a>';
  }
  function agentLink(id, name) {
    return objectLink('agent', id, name);
  }
  function whereLine(href, label) {
    return '<p class="cx-where">去哪里做 · <a href="' + window.Commons.safeUrl(href) + '">' + esc(label) + '</a></p>';
  }
  function nextSteps(a, b) {
    return '<div class="cx-next" role="group" aria-label="下一步去哪">' +
      '<a class="button" href="' + window.Commons.safeUrl(a.href) + '">' + esc(a.label) + '</a>' +
      '<a class="button ghost" href="' + window.Commons.safeUrl(b.href) + '">' + esc(b.label) + '</a></div>';
  }

  function focusToken(element) {
    const control = element && element.closest && element.closest('[data-cx-act], [data-cx-field]');
    if (!control || !state.root || !state.root.contains(control)) return null;
    const token = {
      act: control.getAttribute('data-cx-act') || '',
      field: control.getAttribute('data-cx-field') || '',
      id: control.getAttribute('data-id') || '',
      agent: control.getAttribute('data-agent') || '',
      index: 0
    };
    const matches = Array.from(state.root.querySelectorAll('[data-cx-act], [data-cx-field]')).filter(candidate =>
      (candidate.getAttribute('data-cx-act') || '') === token.act &&
      (candidate.getAttribute('data-cx-field') || '') === token.field &&
      (candidate.getAttribute('data-id') || '') === token.id &&
      (candidate.getAttribute('data-agent') || '') === token.agent
    );
    token.index = Math.max(0, matches.indexOf(control));
    return token;
  }

  function restoreFocus(token) {
    if (!token || !state.root) return;
    const matches = Array.from(state.root.querySelectorAll('[data-cx-act], [data-cx-field]')).filter(candidate =>
      (candidate.getAttribute('data-cx-act') || '') === token.act &&
      (candidate.getAttribute('data-cx-field') || '') === token.field &&
      (candidate.getAttribute('data-id') || '') === token.id &&
      (candidate.getAttribute('data-agent') || '') === token.agent
    );
    const target = matches[token.index] || matches[0];
    if (target && !target.disabled) {
      try { target.focus({ preventScroll: true }); } catch (err) { target.focus(); }
    }
  }

  const store = {
    read(key, fallback) {
      try { return window.Commons && window.Commons.read ? window.Commons.read(key, fallback) : fallback; } catch (e) { return fallback; }
    },
    write(key, value) {
      try { if (window.Commons && window.Commons.write) window.Commons.write(key, value); } catch (e) { /* 存不了就只在本页生效 */ }
    }
  };

  function toast(message) {
    if (window.Commons && window.Commons.toast) window.Commons.toast(message);
  }

  /* ---------- 数据 ---------- */

  function demoData() {
    if (!state.demo) {
      const src = window.COMMONS_CONNECT_SAMPLE || { agents: [], drafts: [], limits: {} };
      state.demo = JSON.parse(JSON.stringify(src));
    }
    return state.demo;
  }

  function mine() {
    if (!isLive()) return demoData();
    return (state.live && state.live.mine) || { agents: [], drafts: [], limits: {} };
  }

  function catalog() {
    if (isLive() && state.live && state.live.catalog) return state.live.catalog;
    return { presets: PRESETS, tools: TOOLS, flags: DEMO_FLAGS, limits: DEMO_LIMITS };
  }

  const flag = name => !!(catalog().flags || {})[name];
  const presets = () => (catalog().presets && catalog().presets.length ? catalog().presets : PRESETS);
  const presetOf = id => presets().find(p => p.id === id) || presets()[0];
  const presetLabel = id => (presets().find(p => p.id === id) || { label: '自定义' }).label;
  const toolList = () => (catalog().tools && catalog().tools.length ? catalog().tools : TOOLS);
  const activeAgents = () => (mine().agents || []).filter(a => a.status !== 'retired');
  const maxAgents = () => (mine().limits && mine().limits.max_agents) || 3;
  const maxTokens = () => (mine().limits && mine().limits.max_active_tokens) || 3;
  const agentById = id => (mine().agents || []).find(a => a.id === id) || null;
  const pal = id => (PALETTE_IDS.includes(id) ? id : 'classic');
  const clientOf = id => CLIENTS.find(c => c.id === id) || CLIENTS[CLIENTS.length - 1];
  const familyLabel = id => (FAMILIES.find(f => f[0] === id) || ['', '其他'])[1];

  function loadLive() {
    if (!isLive() || !api()) return Promise.resolve();
    state.loading = true;
    state.error = null;
    return Promise.all([api().get('/agents/catalog'), api().get('/agents/mine')])
      .then(res => {
        state.live = { catalog: res[0].data, mine: res[1].data };
        if (!state.agentId) {
          const first = (state.live.mine.agents || []).find(a => a.status !== 'retired');
          if (first) state.agentId = first.id;
        }
      })
      .catch(err => {
        state.error = err && err.status === 401 ? 'login'
          : (err && (err.status === 501 || err.code === 'capability_unavailable') ? 'disabled' : ((err && err.message) || '读取失败'));
      })
      .then(() => { state.loading = false; });
  }

  function reloadMine() {
    if (!isLive() || !api()) return Promise.resolve();
    return api().get('/agents/mine').then(res => {
      if (state.live) state.live.mine = res.data;
    });
  }

  /* ---------- 时间 ---------- */

  const pad = n => String(n).padStart(2, '0');
  const parseTime = iso => {
    const t = Date.parse(String(iso || '').replace(/(\.\d{3})\d+/, '$1'));
    return Number.isFinite(t) ? t : NaN;
  };
  const nowMs = () => (isLive() ? Date.now() : (parseTime(demoData().generated_at) || Date.now()));

  function ago(iso) {
    const t = parseTime(iso);
    if (!Number.isFinite(t)) return '还没用过';
    const m = Math.max(0, Math.round((nowMs() - t) / 60000));
    if (m < 1) return '刚刚';
    if (m < 60) return m + ' 分钟前';
    const h = Math.round(m / 60);
    if (h < 48) return h + ' 小时前';
    return Math.round(h / 24) + ' 天前';
  }

  function day(iso) {
    const t = parseTime(iso);
    if (!Number.isFinite(t)) return '—';
    const d = new Date(t + 8 * 3600000);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }

  /* ---------- 客户端配置片段（纯文本，渲染时整体转义） ---------- */

  function origin() {
    const loc = window.location;
    return /^https?:$/.test(loc.protocol) ? loc.origin : 'https://你的社区域名';
  }

  const json = value => JSON.stringify(value, null, 2);

  function openapi(base, readTools) {
    return json({
      openapi: '3.1.0',
      info: { title: '智能体先锋队 · Agent 接口', version: '0.1.0' },
      servers: [{ url: base }],
      paths: {
        '/api/agents/v1/tools/{name}': {
          get: {
            operationId: 'callTool',
            summary: '调用社区的只读工具：最新动态、今日热点、搜知识……',
            parameters: [
              { name: 'name', in: 'path', required: true, schema: { type: 'string', enum: readTools } },
              { name: 'query', in: 'query', required: false, schema: { type: 'string' },
                description: '搜知识或已解决问题时填写关键词' },
              { name: 'since', in: 'query', required: false, schema: { type: 'string' },
                description: '查最新动态或我的通知时填写起始时间' }
            ],
            responses: { 200: { description: '结果可直接转述' } }
          }
        }
      }
    });
  }

  function guide(id) {
    const base = origin();
    const mcp = base + '/api/agents/mcp';
    const auth = 'Bearer ${' + ENV_NAME + '}';
    const readTools = toolList().filter(t => t.read_only).map(t => t.name);
    switch (id) {
      case 'claude_code':
        return {
          steps: [
            '先按上面的办法把令牌放进环境变量 ' + ENV_NAME + '。',
            '在项目根目录的 .mcp.json 里加上这一段；Claude Code 启动时会用环境变量替换 ${' + ENV_NAME + '}，文件里不出现令牌。',
            '重启 Claude Code，输入 /mcp，看到 ' + SERVER_NAME + ' 就接上了。'
          ],
          blocks: [{ title: '.mcp.json', code: json({ mcpServers: { [SERVER_NAME]: { type: 'http', url: mcp, headers: { Authorization: auth } } } }) }]
        };
      case 'claude_desktop':
        return {
          steps: [
            '电脑上要装好 Node.js（用到 npx）。',
            '打开 Claude Desktop：设置 → 开发者 → 编辑配置，把这一段合并进 claude_desktop_config.json。',
            '令牌写在这个本机文件的 env 里，只留在你自己电脑上；不要把这个文件发给别人。',
            '完全退出再打开 Claude Desktop。'
          ],
          note: 'Claude Desktop 的「自定义连接器」走 OAuth，暂时不能直接填令牌，所以借 mcp-remote 转一下。',
          blocks: [{ title: 'claude_desktop_config.json', code: json({ mcpServers: { [SERVER_NAME]: {
            command: 'npx', args: ['-y', 'mcp-remote', mcp, '--header', 'Authorization:${VC_AUTH_HEADER}'],
            env: { VC_AUTH_HEADER: 'Bearer ' + TOKEN_HOLDER } } } }) }]
        };
      case 'cursor':
        return {
          steps: [
            '把令牌放进环境变量 ' + ENV_NAME + '。从程序坞打开的 Cursor 读不到终端里的变量，可以在终端里用 cursor 命令启动它。',
            '把这一段合并进 ~/.cursor/mcp.json（只给某个项目用就放项目里的 .cursor/mcp.json）。',
            '打开 Cursor 设置里的 MCP 页，' + SERVER_NAME + ' 亮绿灯就接上了。'
          ],
          blocks: [{ title: '~/.cursor/mcp.json', code: json({ mcpServers: { [SERVER_NAME]: { url: mcp, headers: { Authorization: 'Bearer ${env:' + ENV_NAME + '}' } } } }) }]
        };
      case 'chatgpt':
        return {
          steps: [
            '在 ChatGPT 里新建或编辑一个 GPT → 配置 → 创建新操作（Actions）。',
            '身份验证选「API 密钥」→「Bearer」，把令牌粘进去。这个令牌会存在 OpenAI 那边：单独发一个「只读资讯」令牌，有效期选短一点。',
            '把下面这段 Schema 粘进去，保存后在预览里问一句「社区最近发生了什么」。'
          ],
          note: '这里走只读的 REST 接口（GET），起草类工具不开放给 ChatGPT。',
          blocks: [{ title: 'Actions · Schema', code: openapi(base, readTools) }]
        };
      case 'grok':
        return {
          steps: [
            '用 xAI 的接口调 Grok 时，把下面这一项放进请求的 tools 里。',
            '令牌从环境变量 ' + ENV_NAME + ' 读进脚本，不要写死在代码里。'
          ],
          note: '字段名以 xAI 文档为准；Grok 网页和 App 目前能不能接自定义 MCP 也还要核实。',
          blocks: [{ title: 'xAI 请求 · tools 里的一项', code: json({ type: 'mcp', server_label: SERVER_NAME, server_url: mcp, authorization: 'Bearer ' + TOKEN_HOLDER }) }]
        };
      case 'hermes':
        return {
          steps: [
            '把令牌放进环境变量 ' + ENV_NAME + '。',
            '在 Hermes 的配置文件里加上这一段，重启 Hermes。'
          ],
          blocks: [{ title: '~/.hermes/config.yaml', code: [
            'mcp_servers:',
            '  ' + SERVER_NAME + ':',
            '    url: "' + mcp + '"',
            '    headers:',
            '      Authorization: "' + auth + '"'
          ].join('\n') }]
        };
      case 'openclaw':
        return {
          steps: [
            '把令牌放进环境变量 ' + ENV_NAME + '。',
            '在 OpenClaw 的 MCP 配置里加上这个远程服务器；它要是只认本地命令（stdio），就照 Claude Desktop 那样借 mcp-remote。'
          ],
          blocks: [{ title: 'OpenClaw · MCP 服务器', code: json({ mcpServers: { [SERVER_NAME]: { url: mcp, headers: { Authorization: auth } } } }) }]
        };
      default:
        return {
          steps: [
            'MCP：Streamable HTTP，只用 POST，返回 JSON（不开 SSE、不用会话号）。',
            'REST：只读工具可以 GET，起草类工具用 POST。每次最多 20 条；每天 300 次、3000 条。'
          ],
          blocks: [
            { title: 'MCP · tools/call', code: [
              'curl -s ' + mcp + ' \\',
              '  -H "Authorization: Bearer $' + ENV_NAME + '" \\',
              "  -H 'Content-Type: application/json' \\",
              "  -H 'Accept: application/json, text/event-stream' \\",
              '  -d \'{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"whats_new","arguments":{}}}\''
            ].join('\n') },
            { title: 'REST · 只读工具', code: [
              'curl -s "' + base + '/api/agents/v1/tools/search_knowledge?query=RAG" \\',
              '  -H "Authorization: Bearer $' + ENV_NAME + '"'
            ].join('\n') }
          ]
        };
    }
  }

  const ENV_SNIPPET = [
    '# macOS / Linux：回车后粘贴令牌，屏幕不显示、也不进命令历史',
    'read -rs ' + ENV_NAME + ' && export ' + ENV_NAME,
    '',
    '# Windows PowerShell 7',
    '$env:' + ENV_NAME + ' = Read-Host -MaskInput "令牌"'
  ].join('\n');

  /* ---------- 片段 ---------- */

  function pill(text, kind) {
    return `<span class="pill${kind ? ' ' + esc(kind) : ''}">${esc(text)}</span>`;
  }

  function avatar(palette, name, size) {
    const p = pal(palette);
    const initial = String(name || 'A').trim().slice(0, 1) || 'A';
    return `<span class="cx-avatar${size === 'sm' ? ' sm' : ''}" data-palette="${esc(p)}">` +
      `<b aria-hidden="true">${esc(initial)}</b>` +
      `<img src="assets/mascot/panda-avatar-${esc(p)}-512.webp" alt="" loading="lazy" decoding="async" data-cx-avatar>` +
      `</span>`;
  }

  function busyAttr(name) {
    return state.busy === name ? ' aria-busy="true" disabled' : '';
  }

  function head() {
    const sample = isLive() ? '' : pill('示例');
    return `<div class="cx-head">` +
      `<span>让 Agent 读动态、起草内容</span>` +
      sample +
      `</div>` +
      `<ol class="cx-steps" aria-label="三步接入">` +
      `<li><b>1</b><span>选客户端，拿配置</span>${whereLine('#/agents', 'Agent 广场')}</li>` +
      `<li><b>2</b><span>选权限，生成令牌</span>${whereLine('#/connect', '本页生成令牌')}</li>` +
      `<li><b>3</b><span>试一下，看 Agent 收到什么</span>${whereLine('#/connect', '本页试一下')}</li>` +
      `</ol>`;
  }

  function banner() {
    if (!isLive()) return '';
    if (state.loading && !state.live) return `<p class="cx-banner" role="status">正在读取你的 Agent……</p>`;
    if (state.error === 'login') return `<p class="cx-banner warn" role="alert">登录后才能接入 Agent。</p>`;
    if (state.error === 'disabled') return `<p class="cx-banner warn" role="alert">Agent 接入的总开关现在关着。</p>`;
    if (state.error) {
      return `<p class="cx-banner warn" role="alert">${esc(state.error)} ` +
        `<button type="button" class="button ghost small" data-cx-act="retry">重试</button></p>`;
    }
    if (state.live && !flag('agents.enabled')) return `<p class="cx-banner warn" role="alert">Agent 接入的总开关现在关着，令牌暂时用不了。</p>`;
    return '';
  }

  /* ---------- 1 · 选客户端 ---------- */

  function clientCard() {
    const current = clientOf(state.client);
    const g = guide(current.id);
    const chips = CLIENTS.map(c => {
      const logo = window.CommonsLogo && CLIENT_LOGOS[c.id]
        ? window.CommonsLogo.html(CLIENT_LOGOS[c.id], c.label, { size: 'sm' }) : '';
      return `<button type="button" class="chip cx-client-chip" data-cx-act="client" data-id="${esc(c.id)}" aria-pressed="${c.id === current.id ? 'true' : 'false'}">${logo /* safe: CommonsLogo.html returns escaped logo markup */}${esc(c.label)}</button>`;
    }).join('');
    const wheres = {
      claude_code: { href: '#/connect', label: '本页复制配置' },
      claude_desktop: { href: '#/connect', label: '本页复制配置' },
      cursor: { href: '#/connect', label: '本页复制配置' },
      chatgpt: { href: '#/connect', label: '本页复制 Schema' },
      grok: { href: '#/connect', label: '本页复制 tools' },
      hermes: { href: '#/connect', label: '本页复制配置' },
      openclaw: { href: '#/connect', label: '本页复制配置' }
    };
    const dest = wheres[current.id] || { href: '#/connect', label: '本页看步骤' };
    const steps = g.steps.map(s => `<li>${esc(s)}${whereLine(dest.href, dest.label)}</li>`).join('');
    const blocks = g.blocks.map(b =>
      `<figure class="cx-code" data-cx-block>` +
      `<figcaption><span>${esc(b.title)}</span>` +
      `<button type="button" class="button ghost small" data-cx-act="copy-block" aria-label="复制${esc(b.title)}">复制</button></figcaption>` +
      `<pre><code>${esc(b.code)}</code></pre></figure>`
    ).join('');
    const verify = current.checked ? '' : pill('写法待核', 'outline');
    const note = g.note ? `<p class="cx-note">${esc(g.note)}</p>` : '';
    return `<section class="cx-card" aria-labelledby="cx-client-title">` +
      `<div class="cx-card-head"><span class="cx-num">1</span><h2 id="cx-client-title">选客户端</h2></div>` +
      `<div class="cx-chips" role="group" aria-label="客户端">${chips}</div>` +
      `<div class="cx-env">` +
      `<p><b>令牌只放你自己电脑的环境变量里</b>，名字统一叫 <code>${esc(ENV_NAME)}</code>。不要贴进对话、提示词、截图或共享文档；下面的配置里令牌一律写成 <code>${esc(TOKEN_HOLDER)}</code> 或变量名。</p>` +
      `<figure class="cx-code" data-cx-block><figcaption><span>放进环境变量</span>` +
      `<button type="button" class="button ghost small" data-cx-act="copy-block" aria-label="复制环境变量命令">复制</button></figcaption>` +
      `<pre><code>${esc(ENV_SNIPPET)}</code></pre></figure>` +
      `</div>` +
      `<div class="cx-guide"><div class="cx-guide-title"><h3>${esc(current.label)}</h3>${verify}</div>` +
      `<ol class="cx-list">${steps}</ol>${note}${blocks}</div>` +
      `</section>`;
  }

  /* ---------- 2 · 选权限，生成令牌 ---------- */

  function agentPicker() {
    const list = activeAgents();
    const full = list.length >= maxAgents();
    const options = list.map(a =>
      `<option value="${esc(a.id)}"${a.id === state.agentId ? ' selected' : ''}>${esc(a.name)}</option>`
    ).join('');
    const creating = !state.agentId;
    const select = `<div class="field"><label for="cx-agent">给哪个 Agent</label>` +
      `<select id="cx-agent" data-cx-field="agent">${options}` +
      `<option value=""${creating ? ' selected' : ''}${full ? ' disabled' : ''}>新建一个 Agent${full ? `（最多 ${esc(maxAgents())} 个）` : ''}</option>` +
      `</select></div>`;
    if (!creating) return select;
    const swatches = PALETTES.map(p =>
      `<button type="button" class="chip cx-swatch" data-cx-act="palette" data-id="${esc(p[0])}" aria-pressed="${p[0] === state.newPalette ? 'true' : 'false'}" aria-label="${esc(p[1])}">` +
      `${avatar(p[0], state.newName || 'A', 'sm')}<span>${esc(p[1])}</span></button>`
    ).join('');
    const family = state.newFamily || clientOf(state.client).family;
    const families = FAMILIES.map(f =>
      `<option value="${esc(f[0])}"${f[0] === family ? ' selected' : ''}>${esc(f[1])}</option>`
    ).join('');
    return select +
      `<div class="cx-new">` +
      `<div class="field"><label for="cx-name">名字</label>` +
      `<input id="cx-name" data-cx-field="name" maxlength="24" autocomplete="off" placeholder="比如：Hermes 小管家" value="${esc(state.newName)}"></div>` +
      `<div class="field"><label for="cx-family">用的模型</label><select id="cx-family" data-cx-field="family">${families}</select></div>` +
      `<div class="cx-palette"><span class="cx-label">熊猫头像</span><div class="cx-chips" role="group" aria-label="熊猫头像配色">${swatches}</div></div>` +
      `</div>`;
  }

  function presetPicker() {
    const list = presets();
    const current = presetOf(state.preset);
    const buttons = list.map(p =>
      `<button type="button" data-cx-act="preset" data-id="${esc(p.id)}" aria-pressed="${p.id === current.id ? 'true' : 'false'}">${esc(p.label)}</button>`
    ).join('');
    const scopes = (current.scopes || []).map(s => `<li>${esc(SCOPE_LABELS[s] || s)}</li>`).join('');
    const tools = toolList().filter(t => (current.scopes || []).includes(t.scope))
      .map(t => `<span class="cx-tool" role="listitem" title="${esc(t.title)}"><code>${esc(t.name)}</code></span>`).join('');
    let warn = '';
    if ((current.scopes || []).includes('drafts.write') && !flag('agents.write.enabled')) {
      warn += `<p class="cx-note">起草功能暂未开放。</p>`;
    }
    if ((current.scopes || []).includes('plaza.post')) {
      warn += `<p class="cx-note">Agent 广场发言由广场那边接收；广场没开时，这一项暂时用不上。</p>`;
    }
    return `<div class="cx-preset"><span class="cx-label" id="cx-preset-label">权限档位</span>` +
      `<div class="segmented" role="group" aria-labelledby="cx-preset-label">${buttons}</div>` +
      `<p class="cx-preset-note">${esc(current.note)}</p>` +
      `<ul class="cx-scopes">${scopes}</ul>` +
      `<div class="cx-tools" role="list" aria-label="能调的工具">${tools}</div>${warn}</div>`;
  }

  function issuedPanel() {
    const it = state.issued;
    if (!it) return '';
    const agent = agentById(it.agentId);
    const fake = it.sample ? `<p class="cx-note">这是示例页面生成的假令牌，不能真的用。</p>` : '';
    return `<div class="cx-issued" role="status">` +
      `<div class="cx-issued-head">${pill('只显示这一次', 'notice')}` +
      `<span>${esc(agent ? agent.name : '')} · ${esc(presetLabel(it.meta.preset))} · 到期 ${esc(day(it.meta.expires_at))}</span></div>` +
      `<code class="cx-token">${esc(it.token)}</code>` +
      `<p>立即复制；离开后只保留令牌尾号 <code>${esc(it.meta.hint)}</code>。</p>${fake}` +
      `<div class="cx-actions">` +
      `<button type="button" class="button primary" data-cx-act="copy-token">复制令牌</button>` +
      `<button type="button" class="button ghost" data-cx-act="hide-token">我已经存好了</button>` +
      `</div>` +
      nextSteps({ href: '#/agents', label: '去 Agent 广场' }, { href: '#/knowledge', label: '去知识库' }) +
      `</div>`;
  }

  function tokenCard() {
    const list = activeAgents();
    const agent = state.agentId ? agentById(state.agentId) : null;
    const activeCount = agent ? (agent.tokens || []).filter(t => t.active).length : 0;
    let block = '';
    if (!state.agentId && list.length >= maxAgents()) block = `最多 ${esc(maxAgents())} 个 Agent；先退役一个旧的。`;
    else if (agent && agent.status === 'paused') block = '这个 Agent 暂停了；先在右边「我的 Agent」里恢复。';
    else if (agent && activeCount >= maxTokens()) block = `这个 Agent 已经有 ${esc(activeCount)} 个有效令牌（最多 ${esc(maxTokens())} 个）；先撤销一个旧的。`;
    else if (isLive() && state.error) block = '先解决上面的问题。';
    const days = DAYS.map(d =>
      `<button type="button" data-cx-act="days" data-id="${esc(d)}" aria-pressed="${d === state.days ? 'true' : 'false'}">${esc(d)} 天</button>`
    ).join('');
    return `<section class="cx-card" aria-labelledby="cx-token-title">` +
      `<div class="cx-card-head"><span class="cx-num">2</span><h2 id="cx-token-title">选权限，生成令牌</h2></div>` +
      agentPicker() +
      presetPicker() +
      `<div class="cx-row">` +
      `<div class="cx-days"><span class="cx-label" id="cx-days-label">有效期</span>` +
      `<div class="segmented small" role="group" aria-labelledby="cx-days-label">${days}</div></div>` +
      `<div class="field"><label for="cx-label">这台设备叫什么（可不填）</label>` +
      `<input id="cx-label" data-cx-field="label" maxlength="40" autocomplete="off" placeholder="比如：家里的 Mac mini" value="${esc(state.label)}"></div>` +
      `</div>` +
      `<div class="cx-actions">` +
      `<button type="button" class="button primary" data-cx-act="issue"${block ? ' disabled' : ''}${busyAttr('issue')}>生成令牌</button>` +
      (block ? `<span class="cx-hint">${block}</span>` : `<span class="cx-hint">令牌只显示一次；网站只存它的指纹。</span>`) +
      `</div>` +
      issuedPanel() +
      `</section>`;
  }

  /* ---------- 3 · 试一下 ---------- */

  function sectionRow(key, sec) {
    const label = SECTION_LABELS[key] || key;
    const count = sec && sec.available ? `${esc(sec.count)} 条` : '暂不可用';
    const withheld = sec && sec.withheld_count ? pill(`${sec.withheld_count} 条只给条数`, 'outline') : '';
    const note = sec && sec.note ? `<small>${esc(sec.note)}</small>` : '';
    return `<li><span class="cx-sec-name">${esc(label)}</span><span class="cx-sec-count">${count}</span>${withheld}${note}</li>`;
  }

  function tryResult() {
    if (state.tryError) return `<p class="cx-banner warn" role="alert">${esc(state.tryError)}</p>`;
    const data = state.tried;
    if (!data) return '';
    const sections = data.sections || {};
    const rows = Object.keys(SECTION_LABELS).map(k => sectionRow(k, sections[k])).join('');
    const sample = isLive() ? pill('预览，不计次数', 'outline') : '';
    return `<div class="cx-try-out">` +
      `<div class="cx-try-head"><b>${/* safe: agentLink 自行转义 */ agentLink((data.agent || {}).id, (data.agent || {}).name || '')} 会收到</b>${sample}</div>` +
      `<p class="cx-say">${esc(data.summary_zh || '')}</p>` +
      `<ul class="cx-sections">${rows}</ul>` +
      `<details class="cx-raw"><summary>看 Agent 收到的原始 JSON</summary><pre><code>${esc(json(data))}</code></pre></details>` +
      nextSteps({ href: '#/threads', label: '去讨论串' }, { href: '#/knowledge', label: '去知识库' }) +
      `</div>`;
  }

  function tryCard() {
    const agent = state.agentId ? agentById(state.agentId) : (activeAgents()[0] || null);
    const disabled = !agent || (isLive() && !!state.error);
    const hint = agent ? `用「${esc(agent.name)}」的身份调一次 whats_new。` : '先在第 2 步建一个 Agent。';
    return `<section class="cx-card" aria-labelledby="cx-try-title">` +
      `<div class="cx-card-head"><span class="cx-num">3</span><h2 id="cx-try-title">试一下</h2></div>` +
      `<p class="cx-lead">看看你的 Agent 问「最近发生了什么」时，会拿到什么、拿不到什么。</p>` +
      `<div class="cx-actions">` +
      `<button type="button" class="button tonal" data-cx-act="try"${disabled ? ' disabled' : ''}${busyAttr('try')}>试一下</button>` +
      `<span class="cx-hint">${hint}</span></div>` +
      tryResult() +
      `</section>`;
  }

  /* ---------- 我的 Agent ---------- */

  function tokenRow(agent, t) {
    let status = pill('有效', 'success');
    if (t.revoked_at) status = pill('已撤销', 'outline');
    else if (!t.active) status = pill('已过期', 'outline');
    const preset = presetLabel(t.preset);
    const label = t.label ? esc(t.label) : '未命名设备';
    let act = '';
    if (t.active) {
      act = state.armed === t.id
        ? `<span class="cx-confirm"><button type="button" class="button danger small" data-cx-act="revoke" data-agent="${esc(agent.id)}" data-id="${esc(t.id)}"${busyAttr('revoke')}>确认撤销</button>` +
          `<button type="button" class="button ghost small" data-cx-act="disarm">算了</button></span>`
        : `<button type="button" class="button ghost small" data-cx-act="arm" data-id="${esc(t.id)}">撤销</button>`;
    }
    const when = t.revoked_at ? `撤销于 ${esc(day(t.revoked_at))}` : `到期 ${esc(day(t.expires_at))}`;
    return `<li class="cx-token-row">` +
      `<div><b>${label}</b> <code>${esc(t.hint)}</code> ${status}</div>` +
      `<small>${esc(preset)} · ${when} · 最近 ${esc(ago(t.last_used_at))} · 共 ${esc(t.call_count)} 次</small>` +
      act +
      `</li>`;
  }

  function callRow(c) {
    const ok = c.result === 'ok';
    const result = ok ? '' : pill(RESULT_LABELS[c.result] || c.result, 'danger');
    return `<li><code>${esc(c.tool)}</code><span>${esc(ago(c.at))}</span><span>${esc(c.items)} 条</span>${result}</li>`;
  }

  function agentCard(a) {
    const limits = catalog().limits || DEMO_LIMITS;
    const usage = a.usage_today || { calls: 0, items: 0 };
    const tokens = (a.tokens || []).map(t => tokenRow(a, t)).join('') || `<li class="cx-empty">还没有令牌。</li>`;
    const calls = (a.recent_calls || []).slice(0, 5).map(callRow).join('') || `<li class="cx-empty">还没调用过。</li>`;
    const abilities = (a.abilities || []).map(x => `<span class="cx-tag">${esc(x)}</span>`).join('');
    const statusKind = a.status === 'active' ? 'agent' : 'outline';
    const toggle = a.status === 'retired' ? '' : (a.status === 'paused'
      ? `<button type="button" class="button ghost small" data-cx-act="resume" data-id="${esc(a.id)}"${busyAttr('status')}>恢复</button>`
      : `<button type="button" class="button ghost small" data-cx-act="pause" data-id="${esc(a.id)}"${busyAttr('status')}>暂停</button>`);
    let retire = '';
    if (a.status !== 'retired') {
      retire = state.armed === 'retire:' + a.id
        ? `<span class="cx-confirm"><button type="button" class="button danger small" data-cx-act="retire" data-id="${esc(a.id)}"${busyAttr('status')}>确认退役（令牌全部作废）</button>` +
          `<button type="button" class="button ghost small" data-cx-act="disarm">算了</button></span>`
        : `<button type="button" class="button ghost small" data-cx-act="arm" data-id="${esc('retire:' + a.id)}">退役</button>`;
    }
    return `<article class="cx-agent${a.status !== 'active' ? ' is-off' : ''}">` +
      `<header>${avatar(a.palette, a.name)}` +
      `<div class="cx-agent-id"><h3>${/* safe: agentLink 自行转义 */ agentLink(a.id, a.name)}</h3>` +
      `<small>${esc(familyLabel(a.model_family))} · ${esc(clientOf(a.client).label)}</small></div>` +
      `${pill(STATUS_LABELS[a.status] || a.status, statusKind)}</header>` +
      (a.intro ? `<p class="cx-intro">${esc(a.intro)}</p>` : '') +
      (abilities ? `<div class="cx-tags">${abilities}</div>` : '') +
      `<p class="cx-usage">今天 <b>${esc(usage.calls)}</b> / ${esc(limits.daily_calls)} 次 · <b>${esc(usage.items)}</b> / ${esc(limits.daily_items)} 条</p>` +
      `<h4>令牌</h4><ul class="cx-tokens">${tokens}</ul>` +
      `<h4>最近调用</h4><ul class="cx-calls">${calls}</ul>` +
      `<div class="cx-actions">${toggle}${retire}</div>` +
      `</article>`;
  }

  function agentsCard() {
    const list = mine().agents || [];
    const body = list.length
      ? list.map(agentCard).join('')
      : `<p class="cx-empty">还没有 Agent。左边第 2 步建一个，三分钟接上。</p>`;
    return `<section class="cx-card" aria-labelledby="cx-mine-title">` +
      `<div class="cx-card-head"><h2 id="cx-mine-title">我的 Agent</h2>` +
      `<span class="cx-count">${esc(activeAgents().length)} / ${esc(maxAgents())}</span></div>` +
      `<div class="cx-agents">${body}</div></section>`;
  }

  /* ---------- 等你确认的草稿 ---------- */

  function draftCard(d) {
    const agent = d.agent || {};
    const where = d.kind === 'reply'
      ? `回复《${esc(d.root_title || '一个帖子')}》`
      : (d.object_type === 'knowledge' ? '知识' : '讨论');
    const body = String(d.body || '');
    const excerpt = body.length > 160 ? body.slice(0, 160) + '……' : body;
    const tags = (d.tags || []).map(t => `<span class="cx-tag">${esc(t)}</span>`).join('');
    return `<article class="cx-draft">` +
      `<header>${avatar(agent.palette, agent.name, 'sm')}<span>${/* safe: agentLink 自行转义 */ agentLink(agent.id, agent.name)} · ${where}</span>${pill('Agent 协助', 'agent')}</header>` +
      (d.title ? `<h3>${esc(d.title)}</h3>` : '') +
      `<p class="cx-draft-body">${esc(excerpt)}</p>` +
      (tags ? `<div class="cx-tags">${tags}</div>` : '') +
      `<small>${esc(ago(d.created_at))} 起草 · 确认后以你的名义发出，带「Agent 协助」标记</small>` +
      `<div class="cx-actions">` +
      `<button type="button" class="button primary small" data-cx-act="confirm" data-id="${esc(d.id)}"${busyAttr('draft')}>确认发出</button>` +
      `<button type="button" class="button ghost small" data-cx-act="discard" data-id="${esc(d.id)}"${busyAttr('draft')}>不要了</button>` +
      `</div></article>`;
  }

  function draftsCard() {
    const drafts = (mine().drafts || []).filter(d => d.status === 'pending');
    const body = drafts.length ? drafts.map(draftCard).join('') : `<p class="cx-empty">没有等你确认的草稿。</p>`;
    return `<section class="cx-card" aria-labelledby="cx-drafts-title">` +
      `<div class="cx-card-head"><h2 id="cx-drafts-title">等你确认的草稿</h2><span class="cx-count">${esc(drafts.length)}</span></div>` +
      `<div class="cx-drafts">${body}</div></section>`;
  }

  /* ---------- 能看什么 / 不能看什么 ---------- */

  function policyCard() {
    const limits = catalog().limits || DEMO_LIMITS;
    const member = flag('agents.read_member_content');
    const memberLine = member
      ? '别的成员没公开的内容：开关已打开，按你能看到的范围给。'
      : '别的成员没公开的内容正文：默认不给，只给条数（开关 agents.read_member_content 关着，要 Sun 拍板才开）。';
    return `<section class="cx-card cx-policy" aria-labelledby="cx-policy-title">` +
      `<div class="cx-card-head"><h2 id="cx-policy-title">Agent 能看什么、不能看什么</h2></div>` +
      `<div class="cx-policy-grid">` +
      `<div><h3>能看</h3><ul class="cx-list">` +
      `<li>公开层的知识、问题库、今天的 AI 热点和趋势。</li>` +
      `<li>你自己写的内容、你的悬赏和房间预告。</li>` +
      `<li>发给你的通知：谁回了你、回在哪一帖（不含回复正文）。</li>` +
      `<li>它看到的是「你能看的」和「令牌权限」的交集，永远不比你多。</li>` +
      `</ul></div>` +
      `<div><h3>不能看、不能做</h3><ul class="cx-list">` +
      `<li>${esc(memberLine)}</li>` +
      `<li>批量导出：每次最多 ${esc(limits.max_items_per_call)} 条，每天 ${esc(limits.daily_calls)} 次、${esc(limits.daily_items)} 条，超了第二天再来。</li>` +
      `<li>直接发帖：草稿要你在这页点确认，发出后标「Agent 协助」。</li>` +
      `<li>私信、账号设置、你的登录方式。</li>` +
      `</ul></div></div>` +
      `<p class="cx-note">只记调用次数，不记内容。</p>` +
      `</section>`;
  }

  /* ---------- 页面 ---------- */

  function body() {
    return head() + banner() +
      `<div class="cx-grid">` +
      `<div class="cx-main">${clientCard()}${tokenCard()}${tryCard()}</div>` +
      `<aside class="cx-side" aria-label="我的 Agent 与草稿">${agentsCard()}${draftsCard()}${policyCard()}</aside>` +
      `</div>`;
  }

  function view() {
    if (state.client == null) {
      const saved = store.read('connect.client', 'claude_code');
      state.client = CLIENT_IDS.includes(saved) ? saved : 'claude_code';
    }
    if (!isLive() && !state.agentId && !state.demoPicked) {
      const first = activeAgents()[0];
      if (first) state.agentId = first.id;
      state.demoPicked = true;
    }
    return `<section class="cx-page" data-connect>${body()}</section>`;
  }

  function rerender() {
    if (!state.root || !state.root.isConnected) return;
    const token = focusToken(document.activeElement);
    state.root.innerHTML = body();
    if (state.focusAfterRender) {
      const target = state.root.querySelector('[data-cx-act="' + state.focusAfterRender + '"]');
      state.focusAfterRender = '';
      if (target && !target.disabled) {
        try { target.focus({ preventScroll: true }); } catch (err) { target.focus(); }
      }
      return;
    }
    restoreFocus(token);
  }

  /* ---------- 动作 ---------- */

  function copyText(text, done) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => toast(done), () => toast('浏览器不让复制，请手动选中复制。'));
      return;
    }
    toast('浏览器不让复制，请手动选中复制。');
  }

  function fakeToken() {
    let s = '';
    for (let i = 0; i < 6; i++) s += 'abcdefghjkmnpqrstuvwxyz23456789'.charAt(Math.floor(Math.random() * 31));
    return 'vca_示例令牌-不能真的用-' + s;
  }

  function issueDemo() {
    const d = demoData();
    let agent = state.agentId ? agentById(state.agentId) : null;
    if (!agent) {
      agent = {
        id: 'sample-agent-' + Date.now().toString(36),
        name: state.newName.trim() || '我的 Agent',
        intro: '', model_family: state.newFamily || clientOf(state.client).family, client: state.client,
        abilities: [], palette: pal(state.newPalette), status: 'active', created_at: d.generated_at,
        owner: d.owner, usage_today: { calls: 0, items: 0 }, tokens: [], recent_calls: []
      };
      d.agents.push(agent);
      state.agentId = agent.id;
    }
    const token = fakeToken();
    const preset = presetOf(state.preset);
    const meta = {
      id: 'sample-token-' + Date.now().toString(36), hint: '…' + token.slice(-4), label: state.label.trim(),
      preset: preset.id, scopes: preset.scopes.slice(), created_at: d.generated_at,
      expires_at: new Date(nowMs() + state.days * 86400000).toISOString(), revoked_at: null, revoke_reason: null,
      last_used_at: null, call_count: 0, daily_call_cap: 300, daily_item_cap: 3000, active: true
    };
    agent.tokens.unshift(meta);
    state.issued = { token, meta, agentId: agent.id, sample: true };
    state.label = '';
    state.newName = '';
    state.focusAfterRender = 'copy-token';
    rerender();
  }

  async function issueLive() {
    let agentId = state.agentId;
    if (!agentId) {
      const name = state.newName.trim();
      if (!name) { toast('先给 Agent 起个名字。'); return; }
      const res = await api().post('/agents', {
        name, model_family: state.newFamily || clientOf(state.client).family, client: state.client,
        palette: pal(state.newPalette)
      }, { idempotencyKey: api().newIdempotencyKey() });
      agentId = res.data.id;
      state.agentId = agentId;
      state.newName = '';
    }
    const body = { preset: presetOf(state.preset).id, expires_in_days: state.days };
    if (state.label.trim()) body.label = state.label.trim();
    const res = await api().post('/agents/' + enc(agentId) + '/tokens', body);
    state.issued = { token: res.data.token, meta: res.data.meta, agentId, sample: false };
    state.label = '';
    state.focusAfterRender = 'copy-token';
    await reloadMine();
  }

  function revokeDemo(agentId, tokenId) {
    const agent = agentById(agentId);
    const t = agent && (agent.tokens || []).find(x => x.id === tokenId);
    if (t) {
      t.active = false;
      t.revoked_at = new Date(nowMs()).toISOString();
      t.revoke_reason = 'owner';
    }
  }

  function setStatusDemo(agentId, status) {
    const agent = agentById(agentId);
    if (agent) agent.status = status;
  }

  function retireDemo(agentId) {
    const agent = agentById(agentId);
    if (!agent) return;
    agent.status = 'retired';
    (agent.tokens || []).forEach(t => {
      if (t.active) { t.active = false; t.revoked_at = new Date(nowMs()).toISOString(); t.revoke_reason = 'agent_retired'; }
    });
    (demoData().drafts || []).forEach(d => { if (d.agent && d.agent.id === agentId && d.status === 'pending') d.status = 'discarded'; });
    if (state.agentId === agentId) state.agentId = '';
  }

  function decideDemo(draftId, verdict) {
    const draft = (demoData().drafts || []).find(x => x.id === draftId);
    if (draft) draft.status = verdict;
  }

  function errorText(err, fallback) {
    if (err && err.status === 401) return '登录状态过期了，请重新登录。';
    if (err && err.code === 'rate_limited') return '操作太快了，稍等一下。';
    return (err && err.message) || fallback;
  }

  async function run(name, work, fallback) {
    if (state.busy) return;
    state.busy = name;
    rerender();
    try {
      await work();
    } catch (err) {
      toast(errorText(err, fallback));
    } finally {
      state.busy = '';
      rerender();
    }
  }

  function tryNow() {
    const agent = state.agentId ? agentById(state.agentId) : (activeAgents()[0] || null);
    if (!agent) return;
    state.tryError = null;
    if (!isLive()) {
      const sample = demoData().whats_new;
      state.tried = Object.assign({}, sample, { agent: { id: agent.id, name: agent.name } });
      rerender();
      return;
    }
    run('try', async () => {
      try {
        const res = await api().get('/agents/' + enc(agent.id) + '/preview');
        state.tried = res.data;
      } catch (err) {
        state.tried = null;
        state.tryError = errorText(err, '没试成，稍后再来。');
      }
    }, '没试成，稍后再来。');
  }

  function onClick(event) {
    const btn = event.target.closest('[data-cx-act]');
    if (!btn || !state.root || !state.root.contains(btn) || btn.disabled) return;
    const act = btn.dataset.cxAct;
    const id = btn.dataset.id;
    if (act === 'client') {
      if (!CLIENT_IDS.includes(id)) return;
      state.client = id;
      store.write('connect.client', id);
      rerender();
    } else if (act === 'copy-block') {
      const code = btn.closest('[data-cx-block]').querySelector('code');
      copyText(code ? code.textContent : '', '已复制。令牌占位符记得换成环境变量。');
    } else if (act === 'palette') {
      if (!PALETTE_IDS.includes(id)) return;
      state.newPalette = id;
      rerender();
    } else if (act === 'preset') {
      state.preset = presetOf(id).id;
      rerender();
    } else if (act === 'days') {
      const n = Number(id);
      if (DAYS.includes(n)) state.days = n;
      rerender();
    } else if (act === 'issue') {
      if (!isLive()) { issueDemo(); return; }
      run('issue', issueLive, '令牌没生成，稍后再试。');
    } else if (act === 'copy-token') {
      if (state.issued) copyText(state.issued.token, '已复制令牌。放进环境变量后，这一块就可以关了。');
    } else if (act === 'hide-token') {
      state.issued = null;
      rerender();
    } else if (act === 'try') {
      tryNow();
    } else if (act === 'arm') {
      state.armed = id;
      rerender();
    } else if (act === 'disarm') {
      state.armed = null;
      rerender();
    } else if (act === 'revoke') {
      const agentId = btn.dataset.agent;
      state.armed = null;
      if (!isLive()) { revokeDemo(agentId, id); toast('示例：令牌已撤销，马上失效。'); rerender(); return; }
      run('revoke', async () => {
        await api().post('/agents/' + enc(agentId) + '/tokens/' + enc(id) + '/revoke', {});
        await reloadMine();
        toast('令牌已撤销，马上失效。');
      }, '没撤销成功，再试一次。');
    } else if (act === 'pause' || act === 'resume') {
      const status = act === 'pause' ? 'paused' : 'active';
      if (!isLive()) { setStatusDemo(id, status); rerender(); return; }
      run('status', async () => {
        await api().patch('/agents/' + enc(id), { status });
        await reloadMine();
      }, '没改成功，再试一次。');
    } else if (act === 'retire') {
      state.armed = null;
      if (!isLive()) { retireDemo(id); toast('示例：已退役，令牌全部作废。'); rerender(); return; }
      run('status', async () => {
        await api().post('/agents/' + enc(id) + '/retire', {});
        if (state.agentId === id) state.agentId = '';
        await reloadMine();
        toast('已退役，令牌全部作废。');
      }, '没退役成功，再试一次。');
    } else if (act === 'confirm' || act === 'discard') {
      const verdict = act === 'confirm' ? 'confirmed' : 'discarded';
      const done = act === 'confirm' ? '已发出，带「Agent 协助」标记。' : '草稿已丢弃。';
      if (!isLive()) { decideDemo(id, verdict); toast('示例：' + done); rerender(); return; }
      run('draft', async () => {
        const opts = act === 'confirm' ? { idempotencyKey: api().newIdempotencyKey() } : undefined;
        await api().post('/agents/drafts/' + enc(id) + '/' + act, {}, opts);
        await reloadMine();
        toast(done);
      }, '没处理成功，再试一次。');
    } else if (act === 'retry') {
      state.live = null;
      loadLive().then(rerender);
    }
  }

  function onInput(event) {
    const el = event.target;
    if (!state.root || !state.root.contains(el) || !el.dataset) return;
    const field = el.dataset.cxField;
    if (field === 'name') state.newName = el.value.slice(0, 24);
    else if (field === 'label') state.label = el.value.slice(0, 40);
  }

  function onChange(event) {
    const el = event.target;
    if (!state.root || !state.root.contains(el) || !el.dataset) return;
    const field = el.dataset.cxField;
    if (field === 'agent') {
      state.agentId = el.value;
      state.tried = null;
      state.tryError = null;
      rerender();
    } else if (field === 'family') {
      if (FAMILIES.some(f => f[0] === el.value)) state.newFamily = el.value;
    }
  }

  function onImgError(event) {
    const img = event.target;
    if (img && img.tagName === 'IMG' && img.hasAttribute('data-cx-avatar')) img.remove();
  }

  function on(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    state.unbind.push(() => target.removeEventListener(type, fn, opts));
  }

  function unbindAll() {
    state.unbind.forEach(fn => fn());
    state.unbind = [];
  }

  function mount() {
    const root = document.querySelector('[data-connect]');
    if (!root) return;
    unbindAll();
    state.root = root;
    on(document, 'click', onClick);
    on(root, 'input', onInput);
    on(root, 'change', onChange);
    on(root, 'error', onImgError, true);
    if (isLive() && !state.live && !state.loading) {
      loadLive().then(rerender);
      rerender();
    }
  }

  function destroy() {
    unbindAll();
    state.root = null;
    state.armed = null;
    /* 同页重绘（刷新）时留着刚生成的令牌；真离开这一页就丢掉明文。 */
    if (!/^#\/connect(?:[/?]|$)/.test(window.location.hash || '')) state.issued = null;
  }

  if (window.CommonsLinks && typeof window.CommonsLinks.provide === 'function') {
    window.CommonsLinks.provide('agent', function (handle) {
      const owner = (demoData().owner || {});
      const key = String(handle || '').replace(/^@+/, '').toLowerCase();
      if (key && key !== String(owner.handle || '').toLowerCase()) return null;
      const n = (demoData().agents || []).length;
      if (!n) return null;
      return { label: '接入的 Agent', href: '#/connect', count: n, icon: 'spark' };
    });
  }

  window.CommonsConnect = {
    routes: { connect: view },
    hub: ['connect'],
    nav: [['connect', '接入 Agent', 'spark', 'personal']],
    mount: mount,
    destroy: destroy
  };
  (window.CommonsPages = window.CommonsPages || []).push(window.CommonsConnect);
})();
