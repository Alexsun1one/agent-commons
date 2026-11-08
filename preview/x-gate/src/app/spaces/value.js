import { CATALOG } from '../shell/catalog.js';
import { el, dateLabel } from '../shell/dom.js';
import { loadGrowth, loadContributions, loadAchievements, loadEconomy } from '../data/value.js';
import { loadProjects } from '../data/projects.js';
import { tile, grid, stack, stage, heading, progress, badgeUrl } from '../data/ui.js';
import { authenticatedSpace, mountRemote, link } from './remote.js';
import { projectCard } from './cocreation.js';

const num = value => typeof value === 'number' && Number.isFinite(value) ? String(value) : '—';
const signed = value => typeof value === 'number' && Number.isFinite(value) ? `${value > 0 ? '+' : ''}${value}` : '—';

function achievementTile(item) {
  const threshold = item.condition?.threshold;
  const bar = Number.isFinite(item.progress) && Number.isFinite(threshold) ? progress(item.progress, threshold) : null;
  return tile({ image: badgeUrl(item.icon), icon: 'trophy', title: item.name,
    meta: Number.isFinite(item.progress) && Number.isFinite(threshold) ? `${Math.min(item.progress, threshold)} / ${threshold}` : '',
    extra: bar, className: item.unlocked ? 'is-done' : 'is-locked' });
}
function achievementGrid(items, limit) {
  const sorted = [...items].sort((a, b) => Number(!!b.unlocked) - Number(!!a.unlocked));
  const list = grid(); for (const item of sorted.slice(0, limit)) list.append(achievementTile(item)); return list;
}
function timeline(entries) {
  const list = el('ol', 'sp-timeline');
  for (const entry of entries) {
    const row = el('li'); row.append(el('span', 'sp-timeline-dot'), el('div', 'sp-face-body'), el('b', '', signed(entry.points)));
    row.children[1].append(el('p', '', entry.reason || '贡献记录'));
    if (entry.at && dateLabel(entry.at)) row.children[1].append(el('p', 'sp-meta', dateLabel(entry.at)));
    list.append(row);
  }
  return list;
}
function meters(criteria) {
  const list = grid();
  for (const item of criteria) {
    const card = el('article', 'sp-meter'); card.append(el('p', 'sp-meta', item.label), el('p', '', `${num(item.have)} / ${num(item.need)}${item.unit ? ` ${item.unit}` : ''}`),
      progress(item.have, item.need)); list.append(card);
  }
  return list;
}
export default authenticatedSpace({
  ...CATALOG.value, highlights: () => [],
  mount(root, { section, store }) {
    const configs = {
      profile: { route: 'growth', emptyText: '暂无成长记录', illus: 'empty-no-content', load: async options => {
        const [growth, achievements] = await Promise.all([store.load('growth', () => loadGrowth(options)), loadAchievements(options)]);
        return growth.status === 'ok' ? { ...growth, achievements: achievements.status === 'ok' ? achievements.items : [] } : growth;
      }, render(host, state) {
        const me = state.items[0], page = stack(), done = state.achievements.filter(a => a.unlocked).length;
        page.append(stage([[me.levelName || '—', '等级'], [num(me.points?.season), '赛季贡献'], [state.achievements.length ? done : '—', '成就']]));
        if (me.next?.criteria?.length) page.append(heading(`升级到「${me.next.levelName}」`), meters(me.next.criteria));
        if (me.ledger?.length) page.append(heading('最近贡献'), timeline(me.ledger.slice(0, 5)));
        if (state.achievements.length) page.append(heading('成就', `${done} / ${state.achievements.length}`), achievementGrid(state.achievements, 6),
          link('全部成就', 'achievements', 'x-btn ghost'));
        host.append(page);
      } },
      contrib: { route: 'growth', load: loadContributions, emptyText: '还没有贡献记录', illus: 'empty-no-content', actionLabel: '去社区发布作品', render(host, state) {
        host.append(timeline(state.items));
      } },
      impact: { route: 'achievements', load: loadAchievements, emptyText: '暂无成就', illus: 'empty-no-content', actionLabel: '去社区看成就', render(host, state) {
        const done = state.items.filter(a => a.unlocked).length, page = stack();
        page.append(stage([[done, '已解锁'], [state.items.length, '全部']]), achievementGrid(state.items, state.items.length)); host.append(page);
      } },
      results: { route: 'orgs', load: loadProjects, emptyText: '暂无项目成果', illus: 'empty-org', actionLabel: '去社区看团队', render(host, state) {
        const list = grid(); for (const project of state.items) list.append(projectCard(project, null, { join: false })); host.append(list);
      } },
      growth: { route: 'growth', load: loadEconomy, emptyText: '暂无记录', illus: 'empty-no-content', render(host, state) {
        const eco = state.items[0], page = stack(), stats = [[num(eco.balance), eco.currency_name || '余额']];
        if (Number.isFinite(eco.checkin?.streak)) stats.push([eco.checkin.streak, '连续签到']);
        if (Number.isFinite(eco.today?.earned)) stats.push([eco.today.earned, '今日获得']);
        page.append(stage(stats));
        if (Number.isFinite(eco.today?.earned) && Number.isFinite(eco.today?.cap)) {
          const card = el('article', 'sp-meter'); card.append(el('p', 'sp-meta', '今日上限'), el('p', '', `${eco.today.earned} / ${eco.today.cap}`), progress(eco.today.earned, eco.today.cap)); page.append(card);
        }
        if (Array.isArray(eco.checkin?.rewards)) {
          const row = el('ol', 'sp-days'), today = eco.checkin.next_cycle_day;
          eco.checkin.rewards.forEach((reward, i) => {
            const day = el('li', i + 1 < today ? 'is-done' : i + 1 === today && !eco.checkin.claimed_today ? 'is-now' : '');
            day.append(el('b', '', String(reward)), el('span', '', `第 ${i + 1} 天`)); row.append(day);
          });
          page.append(heading('签到'), row);
        }
        host.append(page);
      } },
    };
    return mountRemote(root, configs[section]);
  },
});
