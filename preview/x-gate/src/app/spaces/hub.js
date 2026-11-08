import { CATALOG } from '../shell/catalog.js';
import { el } from '../shell/dom.js';
import { loadSession } from '../api.js';
import { loadAgents, loadAgentPreview } from '../data/agents.js';
import { loadTools } from '../data/tools.js';
import { faceCard, grid, stack, stage, iconButton, pandaOf, trimLead } from '../data/ui.js';
import { authenticatedSpace, mountRemote, stateCard, link, communityURL } from './remote.js';
import { toolsPage } from './network.js';

function agentCard(agent, lifecycle) {
  const extra = el('div', 'sp-face-extra');
  const view = iconButton('eye', '预览', async () => {
    if (extra.firstChild) { extra.replaceChildren(); return; }
    extra.replaceChildren(el('p', 'sp-meta', '正在加载…'));
    const state = await loadAgentPreview(agent.id);
    if (!lifecycle.alive()) return;
    extra.replaceChildren(el('p', state.status === 'ok' ? 'sp-intro' : 'sp-meta',
      state.status === 'ok' ? state.items[0].summary_zh : state.status === 'guest' ? '登录后可见' : '暂时无法加载'));
  });
  const row = faceCard({ kind: 'agent', name: agent.name, intro: trimLead(agent.intro, agent.name), chips: agent.abilities || [],
    color: pandaOf(agent), href: communityURL('connect'), active: agent.status === 'active', trailing: view });
  row.append(extra); return row;
}
export default authenticatedSpace({
  ...CATALOG.hub,
  highlights: () => [],
  mount(root, { section, store }) {
    if (section === 'create') return mountRemote(root, { load: loadSession, route: 'connect', render(host) {
      host.append(stateCard({ status: 'empty' }, null, { emptyText: '创建并配置你的 Agent', route: 'connect', actionLabel: '接入我的 Agent', illus: 'empty-no-agent' }));
    } });
    if (section === 'tools') return mountRemote(root, { load: loadTools, route: 'skills', emptyText: '暂无可用能力', illus: 'empty-tools', actionLabel: '打开工具与技能',
      render(host, state) { host.append(toolsPage(state.items, 'skills', '打开工具与技能')); } });
    return mountRemote(root, {
      route: 'connect', illus: 'empty-no-agent', load: async options => {
        const state = await store.load('myAgents', () => loadAgents(options));
        return state.status === 'empty' ? { ...state, status: 'ok' } : state;
      },
      render(host, state, lifecycle) {
        const page = stack();
        if (!state.items.length) {
          page.append(stage([[0, 'Agent']]), stateCard({ status: 'empty' }, null, { emptyText: '还没有接入 Agent', route: 'connect', actionLabel: '接入我的 Agent', illus: 'empty-no-agent' }));
        } else {
          const list = grid();
          for (const agent of state.items) list.append(agentCard(agent, lifecycle));
          const stats = [[state.items.length, 'Agent']], calls = state.items.map(a => a.usage_today?.calls).filter(Number.isFinite);
          if (calls.length) stats.push([calls.reduce((sum, n) => sum + n, 0), '今日调用']);
          page.append(stage(stats, link('接入我的 Agent', 'connect', 'x-btn primary')), list);
        }
        host.append(page);
      },
    });
  },
});
