import { store as sharedStore } from '../store.js';
import { CATALOG } from '../shell/catalog.js';
import { el, button } from '../shell/dom.js';
import { loadDirectory } from '../data/agents.js';
import { loadTools } from '../data/tools.js';
import { loadPerson, followPerson, LEVEL_NAMES } from '../data/people.js';
import { loadCases } from '../data/cases.js';
import { loadNetwork } from '../data/network.js';
import { faceCard, tile, grid, stack, stage, iconButton, pandaOf, portrait, trimLead } from '../data/ui.js';
import { authenticatedSpace, mountRemote, link, action, communityURL } from './remote.js';

// 成员卡：整卡通往社区主页；关注状态按需读取，只在点击后才请求。
export function personCard(person, lifecycle) {
  const slot = el('span', 'sp-follow');
  const row = faceCard({ kind: 'human', name: person.display_name || person.handle, intro: LEVEL_NAMES[person.level],
    color: pandaOf(person), href: communityURL(`people/${encodeURIComponent(person.handle)}`), trailing: slot });
  const alive = () => lifecycle.alive?.() !== false;
  const check = iconButton('plus', '关注状态', async () => {
    check.disabled = true;
    const state = await loadPerson(person.handle);
    if (!alive()) return;
    check.disabled = false;
    if (state.status === 'guest') { slot.replaceChildren(link('登录', 'login', 'x-btn ghost')); return; }
    const relation = state.items[0];
    if (state.status !== 'ok' || !relation) { slot.replaceChildren(el('span', 'x-action-status', '操作未完成，请重试'), check); return; }
    if (relation.self) { slot.replaceChildren(el('span', 'sp-meta', '我')); return; }
    let following = !!relation.relation?.following;
    const draw = () => slot.replaceChildren(action(following ? '取消关注' : '关注', () => followPerson(person.handle, !following),
      { alive }, { success: following ? '已取消关注' : '已关注', className: 'x-btn sp-follow-btn',
        onSuccess: () => { following = !following; void sharedStore.load('graph', loadNetwork); } }));
    draw();
  });
  slot.append(check);
  return row;
}
export function toolsPage(items, route, label) {
  const list = grid();
  for (const tool of items) list.append(tile({ icon: 'bolt', title: tool.title || tool.name, text: tool.description }));
  const page = stack(); page.append(stage([[items.length, '项能力']], link(label, route, 'x-btn primary')), list);
  return page;
}
const tone = node => node.kind === 'agent' ? 'agent' : 'human';
export default authenticatedSpace({
  ...CATALOG.network, highlights: () => [],
  mount(root, { section, ref, focus, store }) {
    if (section === 'discover') return mountRemote(root, {
      load: loadDirectory, route: 'connect', emptyText: '暂无 Agent', illus: 'empty-no-agent', actionLabel: '接入我的 Agent', render(host, state) {
        const list = grid();
        for (const agent of state.items) list.append(faceCard({ kind: 'agent', name: agent.name, intro: trimLead(agent.blurb, agent.name),
          owner: agent.owner_name, chips: agent.skills || [], color: pandaOf(agent), href: communityURL(`agents/${encodeURIComponent(agent.id)}`),
          active: agent.status === 'active' && !agent.offline && !agent.muted }));
        host.append(list);
      },
    });
    if (section === 'skills') return mountRemote(root, {
      load: loadTools, route: 'connect', emptyText: '暂无可用能力', illus: 'empty-tools', actionLabel: '接入我的 Agent', render(host, state) {
        host.append(toolsPage(state.items, 'connect', '接入我的 Agent'));
      },
    });
    if (section === 'cases') return mountRemote(root, { load: loadCases, route: 'contribute', emptyText: '暂无应用作品', illus: 'empty-no-content', actionLabel: '去社区发布', render(host, state) {
      const list = grid();
      for (const work of state.items) list.append(tile({ icon: 'frame', title: work.title, text: trimLead(work.excerpt, work.title),
        meta: work.author?.display_name, href: communityURL(`read/${encodeURIComponent(work.id)}`) }));
      host.append(list);
    } });
    if (section === 'relations' && ref && ref !== 'me') return mountRemote(root, {
      load: options => store.load('graph', () => loadNetwork(options)), route: 'people', render(host, state, lifecycle) {
        const node = state.nodes.find(n => n.id === ref);
        if (!node) { host.append(tile({ icon: 'network', title: '这个节点已不可见', href: communityURL('people') })); return; }
        focus?.(node.id);
        const row = node.kind === 'human' ? personCard({ ...node, display_name: node.name }, lifecycle)
          : faceCard({ kind: 'agent', name: node.name, color: pandaOf(node), href: communityURL(`agents/${encodeURIComponent(node.id)}`) });
        row.className += ' sp-network-detail';
        host.append(row);
      },
    });
    return mountRemote(root, {
      load: options => store.load('graph', () => loadNetwork(options)), route: 'connect', emptyText: '暂无可见关系节点', illus: 'empty-no-agent', actionLabel: '去社区认识成员',
      render(host, state) {
        const roster = el('div', section === 'graph' ? 'sp-network-stage' : 'sp-network-rel');
        const selected = state.nodes.find(n => n.id === ref);
        for (const node of state.nodes) {
          const btn = button('', () => { focus?.(node.id); select(node); }, 'x-btn sp-network-node');
          btn.append(node.kind === 'me' ? el('span', 'sp-meta', '我') : portrait(tone(node), pandaOf(node), 24), el('span', '', node.name));
          btn.dataset.nodeId = node.id; roster.append(btn);
        }
        const detail = el('article', 'sp-network-detail');
        function select(node) {
          for (const btn of roster.children) { btn.classList.toggle('sel', btn.dataset.nodeId === node.id); btn.setAttribute('aria-selected', String(btn.dataset.nodeId === node.id)); }
          const adjacent = state.relations.filter(r => r.from === node.id || r.to === node.id);
          detail.replaceChildren(portrait(node.kind === 'agent' ? 'agent' : 'human', pandaOf(node), 48), el('div', 'sp-face-body'));
          detail.lastChild.append(el('h3', '', node.kind === 'me' ? '我' : node.name),
            el('p', 'sp-intro', adjacent.length ? `${adjacent.length} 条已确认关系` : '暂无已确认关系'));
          detail.append(link('在社区打开', node.kind === 'agent' ? `agents/${encodeURIComponent(node.id)}` : node.kind === 'me' ? 'profile' : `people/${encodeURIComponent(node.handle)}`, 'x-btn ghost'));
        }
        host.append(roster, detail);
        if (selected) { select(selected); focus?.(selected.id); }
      },
    });
  },
});
