import { CATALOG } from '../shell/catalog.js';
import { el, button, icon } from '../shell/dom.js';

import { loadAnnouncements, loadFeed } from '../data/news.js';
import { authenticatedSpace, mountRemote, card, link } from './remote.js';
import { avatarUrl, grid, heading } from '../data/ui.js';

export const PANDA_COLORS = [ ['brand-blue','先锋蓝'], ['mint','薄荷青'], ['mist-purple','雾紫'], ['classic','经典黑白'], ['graphite','石墨灰'], ['night-sky','夜空深蓝'] ];
export function completeStep(store, step) {
  const profile = store.get('profile');
  if (profile.onboarded.includes(step)) return;
  store.set('profile', { ...profile, onboarded: [...profile.onboarded, step] });
}
export default authenticatedSpace({
  ...CATALOG.base,
  highlights: () => [],
  mount(root, { store, section, ref, open, fly }) {
    let live = true;
    const unsubscribers = [];
    root.replaceChildren();
    if (section === 'brand') {
      const pages = [
        ['智能体新世界', 'X-GATE 把人与 Agent 放进同一个协作空间。从认识一种能力开始，把想法做成作品。'],
        ['从连接开始', '在连接中心发现 Agent，在管理中心配置接入与工具，让能力成为自己的工作伙伴。'],
        ['一起留下成果', '和社区成员共创项目，把作品、贡献与成长留在价值中心。'],
      ];
      const tabs = el('div', 'x-brand-tabs'); const content = el('article', 'x-brand-story');
      const select = i => { content.replaceChildren(el('h3', '', pages[i][0]), el('p', '', pages[i][1])); [...tabs.children].forEach((b,j) => b.setAttribute('aria-pressed', String(i === j))); };
      pages.forEach(([title], i) => tabs.append(button(title, () => select(i), 'x-chip')));
      root.append(tabs, content); select(0);
    } else if (section === 'mission') {
      const article = el('article', 'x-brand-story');
      article.append(el('h3', '', '连接人与 AI，汇聚社群力量'), el('p', '', '放大社群价值 · 社群影响力 · 个人价值'));
      root.append(article, button('认识四个空间', () => open('guide'), 'x-btn primary'));
    } else if (section === 'news') {
      const sources = [['公告', loadAnnouncements], ['动态', loadFeed]];
      unsubscribers.push(mountRemote(root, { route: 'home', emptyText: '暂无动态', illus: 'empty-events', actionLabel: '去社区看看',
        load: async options => {
          const states = await Promise.all(sources.map(([, load]) => load(options)));
          const bad = states.find(state => !['ok', 'empty'].includes(state.status));
          return bad || { status: states.some(state => state.items.length) ? 'ok' : 'empty', items: [], groups: states.map(state => state.items) };
        },
        render(node, state) {
          state.groups.forEach((items, i) => {
            if (!items.length) return;
            if (state.groups.filter(group => group.length).length > 1) node.append(heading(sources[i][0], items.length));
            const list = el('div', 'sp-stack');
            for (const item of items) list.append(card(item.title_zh || item.title, item.summary_zh || item.body || item.summary));
            node.append(list);
          });
          node.append(link('在社区查看', 'home', 'x-btn ghost'));
        } }));
    } else if (section === 'guide') {
      const list = grid();
      for (const id of ['network', 'hub', 'cocreation', 'value']) {
        const row = button('', () => fly(id), 'sp-guide'); row.dataset.place = id;
        const glyph = el('span', 'sp-tile-mark'); glyph.append(icon(id));
        const text = el('span', 'sp-face-body'); text.append(el('strong', '', CATALOG[id].title), el('span', 'sp-intro', CATALOG[id].tagline));
        row.append(glyph, text); list.append(row);
      }
      root.append(list);
    } else {
      const content = el('div', 'x-onboard'); root.append(content);
      const render = () => {
        if (!live) return;
        const focusedColor = document.activeElement?.dataset?.panda;
        const profile = store.get('profile'), done = step => profile.onboarded.includes(step);
        const next = ['panda', 'network', 'cocreation'].find(step => !done(step));
        content.replaceChildren();
        const title = (text, step) => { const h = el('h3', '', text); if (done(step)) { const mark = el('span', 'sp-done'); mark.append(icon('check')); h.append(mark); } return h; };
        const choice = el('section', 'x-onboard-step');
        const image = el('img', 'x-avatar'); image.src = `/assets/mascot/panda-avatar-${profile.panda}-512.webp`; image.alt = '我的熊猫'; image.width = image.height = 72;
        image.addEventListener('error', () => { image.src = avatarUrl(); }, { once: true });
        const colors = el('div', 'x-panda-colors');
        for (const [id, label] of PANDA_COLORS) {
          const b = button('', () => {
            const before = store.get('profile');
            store.set('profile', { ...before, panda: id });
            if (!before.onboarded.includes('panda')) completeStep(store, 'panda', '选好我的熊猫');
          }, 'sp-swatch');
          const face = el('img', 'x-avatar'); face.src = avatarUrl(id); face.alt = ''; face.width = face.height = 48; b.append(face);
          b.setAttribute('aria-label', label); b.title = label;
          b.dataset.panda = id;
          b.setAttribute('aria-pressed', String(profile.panda === id)); colors.append(b);
        }
        const pick = el('div', 'sp-pick'); pick.append(image, colors);
        choice.append(title('选熊猫配色', 'panda'), pick);
        const network = el('section', 'x-onboard-step');
        network.append(title('认识 Agent', 'network'), button('去连接中心', async () => {
          const arrived = await fly('network');
          if (arrived !== false) completeStep(store, 'network', '认识 Agent');
        }, next === 'network' ? 'x-btn primary' : 'x-btn'));
        const co = el('section', 'x-onboard-step');
        co.append(title('探索共创', 'cocreation'), button('去共创中心', async () => {
          const arrived = await fly('cocreation', 'projects');
          if (arrived !== false) completeStep(store, 'cocreation');
        }, next === 'cocreation' ? 'x-btn primary' : 'x-btn'));
        content.append(choice, network, co);
        if (focusedColor) content.querySelector(`[data-panda="${focusedColor}"]`)?.focus();
      };
      unsubscribers.push(store.on('profile', render)); render();
    }
    return () => { live = false; unsubscribers.forEach(off => off()); root.replaceChildren(); };
  },
});
