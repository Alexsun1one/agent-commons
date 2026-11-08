// 工作台展示小件：头像卡、舞台大数、头像叠排、去重文案。只管长相，不碰数据加载。
import { el, button, icon } from '../shell/dom.js';

export const AVATAR_BASE = '/assets/mascot/panda-avatar-';
export const avatarUrl = (color = 'brand-blue') => `${AVATAR_BASE}${color}-512.webp`;
const PANDAS = ['brand-blue', 'mint', 'mist-purple', 'classic', 'graphite', 'night-sky'];
const BADGES = {
  'badge-l1': '/assets/illus/badge-l1.webp', 'badge-l2': '/assets/illus/badge-l2.webp', 'badge-l3': '/assets/illus/badge-l3.webp',
  'badge-l4': '/assets/illus/badge-l4.webp', 'badge-l5': '/assets/illus/badge-l5.webp',
};
export const badgeUrl = name => BADGES[String(name || '').replace(/^.*\//, '').replace(/\.webp$/, '')] || '';

const GLYPHS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
  bookmark: '<path d="M7 4h10v16l-5-3.5L7 20z"/>',
  more: '<path d="m9 6 6 6-6 6"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
};
export function glyph(name) {
  if (!GLYPHS[name]) return icon(name);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'x-icon'); svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = GLYPHS[name]; return svg;
}
export function iconButton(name, label, onClick) {
  const node = button('', onClick, 'x-btn ghost sp-icon-btn');
  node.setAttribute('aria-label', label); node.title = label; node.append(glyph(name)); return node;
}

function hash(text) { let h = 0; for (const c of String(text)) h = (h * 31 + c.codePointAt(0)) >>> 0; return h; }
// 头像颜色：接口给了就用；人没有头像时按 handle 稳定地挑一个熊猫配色。
export function pandaOf(item, seed) {
  const ref = String(item?.avatar_ref || '').replace(/^panda:/, '');
  const named = [ref, item?.color, item?.palette].find(c => PANDAS.includes(c));
  return named || PANDAS[hash(seed ?? item?.handle ?? item?.id ?? item?.name ?? '') % PANDAS.length];
}
export function portrait(kind, color, size = 48) {
  const ring = el('span', `sp-ring is-${kind}`);
  const img = el('img', 'x-avatar'); img.src = avatarUrl(color); img.alt = ''; img.width = img.height = size; img.loading = 'lazy';
  img.style.width = img.style.height = `${size}px`;
  img.addEventListener('error', () => { img.src = avatarUrl(); }, { once: true });
  ring.append(img); return ring;
}
export function statusDot(active = true) {
  const dot = el('span', `sp-dot${active ? '' : ' is-off'}`); dot.title = active ? '在线' : '离线'; dot.setAttribute('role', 'img'); dot.setAttribute('aria-label', dot.title); return dot;
}

// 去掉描述里与标题重复的前缀：「虚构团队：云勺开源社，用于…」配标题「虚构团队·云勺开源社」→「用于…」。
export function trimLead(text, title = '') {
  const tail = String(title).split(/[·・]/).pop().trim();
  const strip = line => {
    let t = line.trim();
    const head = t.match(/^[^：:，。\n]{1,14}[：:]/);
    if (head && String(title).startsWith(head[0].slice(0, -1))) t = t.slice(head[0].length).trim();
    if (tail && t.startsWith(tail)) t = t.slice(tail.length).replace(/^(?:的|[，,。、：:\s])+/, '');
    return t.trim();
  };
  const lines = String(text || '').split('\n').map(strip).filter(Boolean);
  return lines.find(line => line.length >= 6) || (lines.length === 1 ? lines[0] : '');
}

export const grid = () => el('div', 'sp-grid');
export const stack = () => el('div', 'sp-stack');
export function stage(stats, action) {
  const node = el('div', 'sp-stage');
  for (const [value, label] of stats) {
    const cell = el('div', 'sp-stat'); cell.append(el('b', '', String(value)), el('span', '', label)); node.append(cell);
  }
  if (action) node.append(action);
  return node;
}
// 区块小标题：整段内容里最多一处，配计数。
export function heading(text, count) {
  const node = el('h3', 'sp-heading', text);
  if (count != null) node.append(el('span', '', String(count)));
  return node;
}

// 头像卡：整卡是一条指向社区的链接（名字撑满全卡），尾部放一个图标按钮。
export function faceCard({ kind, name, intro, owner, chips = [], color, href, active = true, trailing }) {
  const node = el('article', `sp-face is-${kind}`);
  const body = el('div', 'sp-face-body');
  const title = el('h3'); const a = el('a', 'sp-face-link', name || '未命名'); if (href) a.href = href; title.append(a);
  body.append(title);
  if (intro) body.append(el('p', 'sp-intro', intro));
  if (owner) { const row = el('p', 'sp-owner'); row.append(glyph('person'), owner); body.append(row); }
  if (chips.length) { const row = el('div', 'sp-chips'); for (const c of chips.slice(0, 3)) row.append(el('span', 'sp-chip', c)); body.append(row); }
  const side = el('div', 'sp-face-side'); side.append(statusDot(active)); if (trailing) side.append(trailing);
  node.append(portrait(kind, color), body, side);
  return node;
}
// 方块卡：图标 + 标题 + 两行描述 + 尾注；整卡是一条链接，尾部可放按钮。
export function tile({ icon: name, image, title, text, meta, href, footer, extra, className = '' }) {
  const node = el('article', `sp-tile ${className}`.trim());
  const mark = el('span', 'sp-tile-mark');
  if (image) { const img = el('img'); img.src = image; img.alt = ''; img.width = img.height = 36; img.loading = 'lazy'; mark.append(img); mark.className += ' has-image'; }
  else mark.append(glyph(name || 'spark'));
  const body = el('div', 'sp-tile-body');
  const head = el('h3'); const a = el('a', 'sp-face-link', title || '未命名'); if (href) a.href = href; head.append(a);
  body.append(head);
  if (text) body.append(el('p', 'sp-intro', text));
  if (meta) body.append(el('p', 'sp-meta', meta));
  if (extra) body.append(extra);
  node.append(mark, body);
  if (footer) { footer.className += ' sp-tile-foot'; node.append(footer); }
  return node;
}
// 成员头像叠排：接口只给了人数，叠排只表示人数，不代表具体某个人。
export function avatarStack(count) {
  const node = el('div', 'sp-stack-faces');
  const faces = el('span', 'sp-faces');
  for (let i = 0; i < Math.min(count, 4); i++) {
    const img = el('img', 'x-avatar'); img.src = avatarUrl(PANDAS[i % PANDAS.length]); img.alt = ''; img.width = img.height = 28; img.loading = 'lazy';
    faces.append(img);
  }
  node.append(faces, el('span', 'sp-count', `${count} 人`));
  return node;
}
export function progress(value, max) {
  const bar = el('span', 'sp-bar'), fill = el('i');
  fill.style.width = `${max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0}%`;
  bar.append(fill); return bar;
}
