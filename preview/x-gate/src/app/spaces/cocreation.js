import { CATALOG } from '../shell/catalog.js';
import { el } from '../shell/dom.js';
import { loadPeople } from '../data/people.js';
import { loadProjects, joinProject } from '../data/projects.js';
import { loadWorks, likeWork, saveWork } from '../data/works.js';
import { loadEvents, signupEvent } from '../data/events.js';
import { loadBounties, loadOpportunities } from '../data/bounties.js';
import { result } from '../api.js';
import { tile, grid, stack, stage, glyph, avatarStack, trimLead } from '../data/ui.js';
import { authenticatedSpace, mountRemote, action, communityURL } from './remote.js';
import { personCard } from './network.js';

export function projectCard(project, lifecycle, { join = true } = {}) {
  const { org } = project, works = (project.works || []).slice(0, 3);
  const node = el('article', 'sp-project');
  const head = el('h3'), a = el('a', 'sp-face-link', org.name || '未命名'); a.href = communityURL(`org/${encodeURIComponent(org.slug)}`); head.append(a);
  node.append(head);
  const intro = trimLead(org.intro, org.name);
  if (intro) node.append(el('p', 'sp-intro', intro));
  if (project.members > 0) node.append(avatarStack(project.members));
  if (works.length) {
    const row = el('div', 'sp-works');
    for (const work of works) { const chip = el('span', 'sp-work'); chip.append(glyph('frame'), el('span', '', String(work.title || '').split(/[·・]/).pop())); chip.title = work.title; row.append(chip); }
    node.append(row);
  }
  if (join) {
    const foot = action('申请加入', () => joinProject(org.slug), lifecycle, { success: '已提交，请到团队页查看状态', className: 'x-btn primary' });
    foot.className += ' sp-project-foot'; node.append(foot);
  }
  return node;
}
export function workCard(work, lifecycle) {
  const foot = el('div', 'sp-actions');
  foot.append(action('赞', () => likeWork(work.id), lifecycle, { success: '已赞', className: 'x-btn ghost sp-icon-btn', content: glyph('heart') }),
    action('收藏', () => saveWork(work.id), lifecycle, { success: '已收藏', className: 'x-btn ghost sp-icon-btn', content: glyph('bookmark') }));
  return tile({ icon: 'frame', title: work.title, text: trimLead(work.excerpt, work.title), meta: work.author?.display_name,
    href: communityURL(`read/${encodeURIComponent(work.id)}`), footer: foot });
}
function eventCard(item, lifecycle) {
  const node = el('article', 'sp-event');
  const date = new Date(item.startsAt), valid = Number.isFinite(date.getTime());
  const when = el('time', 'sp-date');
  if (valid) { when.dateTime = date.toISOString(); when.append(el('span', '', `${date.getMonth() + 1} 月`), el('b', '', String(date.getDate()))); }
  else when.append(glyph('calendar'));
  const body = el('div', 'sp-face-body'), head = el('h3'), a = el('a', 'sp-face-link', item.title || '未命名');
  a.href = communityURL(`event/${encodeURIComponent(item.id)}`); head.append(a); body.append(head);
  const text = trimLead(item.summary, item.title);
  if (text) body.append(el('p', 'sp-intro', text));
  const meta = [item.place, item.status === 'ended' ? item.statusLabel : ''].filter(Boolean).join(' · ');
  if (meta) body.append(el('p', 'sp-meta', meta));
  node.append(when, body);
  if (item.status !== 'ended') {
    const foot = action('报名', () => signupEvent(item.id), lifecycle, { success: '报名已提交', className: 'x-btn primary' });
    foot.className += ' sp-tile-foot'; node.append(foot);
  }
  return node;
}
const usable = state => ['ok', 'empty'].includes(state.status) || (state.status === 'error' && state.error?.code === 'capability_unavailable');
async function loadRecruit(options) {
  const [bounties, opportunities] = await Promise.all([loadBounties(options), loadOpportunities(options)]);
  for (const state of [bounties, opportunities]) if (!usable(state)) return state;
  const rows = [...(bounties.status === 'ok' ? bounties.items.map(item => ({ ...item, label: '悬赏', route: 'bounties' })) : []),
    ...(opportunities.status === 'ok' ? opportunities.items.map(item => ({ ...item, label: item.kindLabel || '机会',
      route: item.href?.startsWith('#/') ? item.href.slice(2) : 'opportunities' })) : [])];
  return result(rows);
}
export default authenticatedSpace({
  ...CATALOG.cocreation, highlights: () => [],
  mount(root, { section, store }) {
    const configs = {
      members: { load: loadPeople, route: 'join', emptyText: '暂无成员', illus: 'empty-org', actionLabel: '去社区认识成员', render(host, state, lifecycle) {
        const list = grid(); for (const person of state.items) list.append(personCard(person, lifecycle)); host.append(list);
      } },
      projects: { load: options => store.load('projects', () => loadProjects(options)), route: 'orgs', emptyText: '暂无共创项目', illus: 'empty-org', actionLabel: '去社区组建团队', render(host, state, lifecycle) {
        const list = grid(), page = stack();
        for (const project of state.items) list.append(projectCard(project, lifecycle));
        const works = state.items.reduce((sum, project) => sum + (Number.isFinite(project.workCount) ? project.workCount : (project.works || []).length), 0);
        page.append(stage([[state.items.length, '团队'], [works, '作品']]), list); host.append(page);
      } },
      works: { load: loadWorks, route: 'contribute', emptyText: '暂无作品', illus: 'empty-no-content', actionLabel: '去社区发布作品', render(host, state, lifecycle) {
        const list = grid(); for (const work of state.items) list.append(workCard(work, lifecycle)); host.append(list);
      } },
      events: { load: options => store.load('events', () => loadEvents(options)), route: 'events', emptyText: '暂无活动', illus: 'empty-events', actionLabel: '去社区看活动', render(host, state, lifecycle) {
        const list = grid(); for (const item of state.items) list.append(eventCard(item, lifecycle)); host.append(list);
      } },
      recruit: { load: loadRecruit, route: 'bounties', emptyText: '暂无招募', illus: 'empty-bounty', actionLabel: '去社区看招募', render(host, state) {
        const list = grid();
        for (const item of state.items) list.append(tile({ icon: 'flow', title: item.title, text: trimLead(item.excerpt || item.summary, item.title),
          meta: item.label, href: communityURL(item.route) }));
        host.append(list);
      } },
    };
    const config = configs[section] || configs.projects;
    return mountRemote(root, config);
  },
});
