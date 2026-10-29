(() => {
'use strict';
/* R12-W2 CMD-2 · 命令面板（⌘K）。只导出 window.CommonsCommand；⌘K 与顶栏搜索由主控改绑。 */

const MAX_GROUP = 6;
const PALETTE_MAX_GROUP = 3;
const RECENT_KEY = 'command.recent';
const RECENT_MAX = 8;
const RECENT_PAGE_KEY = 'command.recentPages';
const RECENT_PAGE_MAX = 5;
const ROOT_ID = 'cmd-root';

/* 页面清单：复制自 app.js 的 nav（id、名称），再加几个同义词。 */
const PAGES = [
  ['home', '发现', '首页 主页'], ['knowledge', '知识地图', '知识网 问题簇 地图'], ['workshop', '实战工坊', '方法 工坊 复现'],
  ['people', '作品与同行', '作品 同行 成员 群友实践'], ['buddies', '找搭子', '搭子 结伴'], ['archive', '群记录', '归档 年轮'],
  ['opportunities', '合作机会', '机会 招募'], ['project', '共同项目', '项目'], ['teaching', '共作课堂', '教学 带人'],
  ['events', '活动', '开放麦 活动'], ['membership', '会员会馆', '会员'], ['discuss', '开放讨论', '讨论 提问'],
  ['sources', '外部观察', '外部'], ['governance', '知识治理', '治理 隐私 授权'], ['join', '建立我的资料', '注册 加入'],
  ['profile', '我的主页', '资料'], ['contribute', '我的投稿', '投稿 分享实践'], ['me', '我的工作台', '工作台 设置']
];

const TYPES = [
  ['unit', '知识点'], ['method', '方法'], ['fieldwork', '群友实践'], ['work', '作品'], ['person', '同行'], ['page', '页面']
];
const TYPE_ICON = {
  unit: 'unit', method: 'workshop', fieldwork: 'chat', work: 'project', person: 'person', page: 'page', recent: 'clock', history: 'clock', recommendation: 'spark', action: 'arrow', cluster: 'map', more: 'plus', ask: 'spark',
  problem: 'unit', knowledge: 'unit', skill: 'workshop', prompt: 'spark', component: 'project', pattern: 'map', discussion: 'chat', work: 'project', agent: 'person', member: 'person', hot: 'spark', talk: 'chat', market: 'page', event: 'page', campaign: 'project', bounty: 'project', shop: 'spark', search: 'search'
};
const KIND_LABEL = { question: '问题', solution: '解法', pitfall: '踩坑', 'tool-review': '工具评测', debate: '争论', 'work-lead': '作品线索', resource: '资源' };
const STATUS_LABEL = { candidate: '候选', curated: '已整理', verified: '已验证', stale: '过期', disputed: '有争议' };
const REL_LABEL = { similar: '相似', follows: '追问', answers: '解答', contradicts: '推翻', 'same-tool': '同工具' };

const ICONS = {
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-3.5-3.5',
  unit: 'M12 3.5a5.5 5.5 0 0 0-3.4 9.8c.6.5.9 1.1.9 1.8v.4h5v-.4c0-.7.3-1.3.9-1.8A5.5 5.5 0 0 0 12 3.5zM10 19h4',
  map: 'M5 4v16M12 4v16M19 4v16M3 6l6-2 6 2 6-2v16l-6 2-6-2-6 2z',
  workshop: 'M4 8h16v12H4zM8 8V4h8v4M4 13h16M10 11v4h4v-4',
  chat: 'M5 5h14v10H10l-5 4z',
  project: 'M4 4h6v6H4zM14 14h6v6h-6zM14 4h6v6h-6zM7 10v7h7M10 7h4',
  person: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20a7.5 7.5 0 0 1 15 0',
  page: 'M7 3.5h7l4 4V20.5H7zM14 3.5v4h4',
  clock: 'M12 7v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  plus: 'M12 5v14M5 12h14',
  spark: 'M12 4v4M12 16v4M4 12h4M16 12h4M7 7l2 2M15 15l2 2M17 7l-2 2M9 15l-2 2',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  similar: 'M4 9c3-3 5 3 8 0s5 3 8 0M4 15c3-3 5 3 8 0s5 3 8 0',
  follows: 'M6 4v8a4 4 0 0 0 4 4h9M15 12l4 4-4 4',
  answers: 'M10 7 5 12l5 5M5 12h10a4 4 0 0 1 4 4v1',
  contradicts: 'M12 4v16M5 8l14 8',
  'same-tool': 'M14.5 5.5a3.5 3.5 0 0 0-4.6 4.4L5 14.8V19h4.2l4.9-4.9a3.5 3.5 0 0 0 4.4-4.6l-2.3 2.3-2.4-.6-.6-2.4z'
};
const ico = n => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICONS[n] || ICONS.spark}"/></svg>`;

/* 状态图标占位：ICON-1 交付后主控把这个函数接到真图标集；其他地方一律经过它，不直接画状态图形。 */
const STATE_GLYPH = {
  candidate: '<circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="2.2 2.2"/>',
  curated: '<circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 2.5a5.5 5.5 0 0 1 0 11z" fill="currentColor"/>',
  verified: '<circle cx="8" cy="8" r="6.2" fill="currentColor"/><path class="cmd-st-on" d="M5.4 8.2l1.8 1.8 3.5-3.7" fill="none" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
  stale: '<circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 5v3.2l2 1.3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  disputed: '<path d="M8 1.8 14.2 8 8 14.2 1.8 8z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M8 1.8V14.2L1.8 8z" fill="currentColor"/>'
};
const STATE_ICON = { candidate: 'candidate', curated: 'organized', verified: 'verified', disputed: 'disputed', stale: 'expired' };
const stateIcon = name => window.CommonsIcons?.svg(STATE_ICON[name] || name, { size: 14 }) || `<svg class="cmd-st-g" viewBox="0 0 16 16" aria-hidden="true" focusable="false">${STATE_GLYPH[name] || STATE_GLYPH.candidate}</svg>`;

/* 知识点类型的填充形状，和知识网、组件目录同一套。 */
const KIND_SHAPE = {
  question: '<circle cx="6" cy="6" r="4.6"/>',
  solution: '<rect x="1.6" y="1.6" width="8.8" height="8.8" rx="2.2"/>',
  pitfall: '<path d="M6 1.3 10.9 10H1.1z" stroke-linejoin="round" stroke-width="1.2" stroke="currentColor"/>',
  'tool-review': '<path d="M6 .9 10.6 3.5v5L6 11.1 1.4 8.5v-5z"/>',
  debate: '<path d="M6 .7 11.3 6 6 11.3.7 6z"/>',
  'work-lead': '<path d="M6 .6 7.5 4.5 11.4 6 7.5 7.5 6 11.4 4.5 7.5.6 6 4.5 4.5z"/>',
  resource: '<circle cx="6" cy="6" r="4" fill="none" stroke="currentColor" stroke-width="1.8"/>'
};
const kindGlyph = k => `<svg class="cmd-kind-g" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true" focusable="false">${KIND_SHAPE[k] || KIND_SHAPE.question}</svg>`;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => String(s ?? '').normalize('NFKC').toLowerCase();

const ACTIONS = [
  { id: 'market-sell', title: '发闲置', group: '发布', route: 'market', href: '#/market/new', keys: 'fx fxz fabu xianzhi 闲置 发布' },
  { id: 'market-buy', title: '发求购', group: '发布', route: 'market', href: '#/market/new', keys: 'fqg fabu qiugou 求购 发布' },
  { id: 'bounty-new', title: '发悬赏', group: '发布', route: 'bounties', href: '#/bounties', keys: 'fxs fabu xuanshang 悬赏 发布' },
  { id: 'knowledge-new', title: '写知识卡', group: '发布', route: 'write', href: '#/write', keys: 'xzsk xie zhishika 知识卡 写作' },
  { id: 'farm', title: '去农场', group: '乐园', route: 'farm', href: '#/farm', keys: 'qnc qu nongchang 农场 种菜' },
  { id: 'parking', title: '去抢车位', group: '乐园', route: 'parking', href: '#/parking', keys: 'qqcw qu qiangchewei 车位 停车' },
  { id: 'checkin', title: '签到', group: '乐园', route: 'games', href: '#/games', keys: 'qd qiandao 每日 竹子' },
  { id: 'exam', title: '模拟考', group: '乐园', route: 'exam', href: '#/exam', keys: 'mnk monikao 考试 答题' },
  { id: 'rooms', title: '开房间', group: '其他', route: 'rooms', href: '#/rooms', keys: 'kfj kai fangjian 建房 房间' },
  { id: 'announcements', title: '看公告', group: '其他', route: 'announcements', href: '#/announcements', keys: 'kgg kan gonggao 公告' },
  { id: 'wallet', title: '我的竹子', group: '其他', route: 'wallet', href: '#/wallet', keys: 'wdzz wo de zhuzi 钱包 竹子' },
  { id: 'messages', title: '我的私信', group: '其他', route: 'messages', href: '#/messages', keys: 'wdsx wo de sixin 私信 消息' },
  { id: 'levels', title: '等级外观', group: '其他', route: 'levels', href: '#/levels', keys: 'djwg dengji waiguan 等级 外观' },
  { id: 'pet', title: '去熊猫小窝', group: '其他', route: 'pet', href: '#/pet', keys: 'qxm xmxw pet qu xiongmao xiaowo 熊猫 小窝' },
  { id: 'tools', title: '看工具榜', group: '其他', route: 'tools', href: '#/tools', keys: 'kgjb tools kan gongjubang 工具 榜单' },
  { id: 'invite', title: '邀请好友', group: '其他', route: 'invite', href: '#/invite', keys: 'yqhy invite yaoqing haoyou 邀请 好友' },
  { id: 'feed', title: '看动态', group: '其他', route: 'feed', href: '#/feed', keys: 'kdt feed kan dongtai 动态' },
  { id: 'groups', title: '找小组', group: '其他', route: 'groups', href: '#/groups', keys: 'zxz groups zhao xiaozu 小组' }
];

function registeredRoute(route) {
  return (window.CommonsPages || []).some(page => page && page.routes && Object.prototype.hasOwnProperty.call(page.routes, route));
}

function actionMatches(action, query) {
  const q = norm(query).replace(/\s+/g, '');
  if (!q) return false;
  return norm(action.title + ' ' + action.keys).replace(/\s+/g, '').includes(q);
}

function actionOptions(query) {
  return ACTIONS.filter(action => registeredRoute(action.route) && actionMatches(action, query)).map(action => ({
    key: 'action:' + action.id, type: 'action', id: action.id, title: action.title,
    meta: action.group, href: action.href, raw: action
  }));
}

/* ---------- 索引（首次使用时建，数据文件没加载的类型直接跳过） ---------- */
let INDEX = null;
let DF = null;
let NDOC = 1;

const bigrams = s => {
  const out = new Set();
  const t = s.replace(/[\s\p{P}\p{S}]+/gu, '\u0000');
  for (let i = 0; i < t.length - 1; i++) {
    const a = t[i], b = t[i + 1];
    if (a !== '\u0000' && b !== '\u0000') out.add(a + b);
  }
  return out;
};

function makeEntry(type, id, title, meta, sample, sec, tags, body, raw) {
  const t = norm(title);
  const s = sec.filter(Boolean).map(norm);
  const g = tags.filter(Boolean).map(norm);
  const b = norm(body);
  return { type, id, title, meta, sample, raw, t, s, g, b, bg: bigrams([t, ...s, ...g, b].join(' ')) };
}

function buildIndex() {
  const w = window;
  const K = w.COMMONS_KNOWLEDGE, D = w.COMMONS_DATA, F = w.COMMONS_FIELDWORK;
  const list = [];
  const clusters = new Map((K?.clusters || []).map(c => [c.id, c]));
  const person = id => (D?.people || []).find(p => p.id === id);

  (K?.units || []).forEach(u => {
    const cl = clusters.get(u.cluster);
    list.push(makeEntry('unit', u.id, u.title, `${KIND_LABEL[u.kind] || '知识点'} · ${cl?.label || ''}`, !!K.synthetic,
      [u.question, cl?.label], u.tools || [], [u.context, u.solution, u.outcome, u.unresolved, ...(u.steps || [])].join(' '), u));
  });
  (D?.methods || []).forEach(m => {
    list.push(makeEntry('method', m.id, m.title, `${m.category} · ${m.type}`, !!D.synthetic,
      [m.short, m.category, m.type], m.tags || [], [m.summary, ...(m.steps || [])].join(' '), m));
  });
  (F?.items || []).forEach(f => {
    list.push(makeEntry('fieldwork', f.id, f.title, `群友实践 · ${f.category}`, false,
      [f.category, f.kind], (f.steps || []).map(s => s.tag), [f.summary, f.takeaway, ...(f.steps || []).map(s => s.title + ' ' + s.body)].join(' '), f));
  });
  (D?.works || []).forEach(x => {
    list.push(makeEntry('work', x.id, x.title, `示例作品 · ${x.kind}`, !!D.synthetic,
      [x.subtitle, x.kind], [person(x.owner)?.name], [x.description, ...(x.nodes || [])].join(' '), x));
  });
  (D?.people || []).forEach(p => {
    list.push(makeEntry('person', p.id, p.name, p.role, !!D.synthetic,
      [p.role, p.en], p.skills || [], [p.bio, p.offer, p.seek].join(' '), p));
  });
  PAGES.forEach(([id, label, alias]) => {
    list.push(makeEntry('page', id, label, '页面', false, [], alias.split(' '), '', { id, label }));
  });

  DF = new Map();
  list.forEach(e => e.bg.forEach(b => DF.set(b, (DF.get(b) || 0) + 1)));
  NDOC = list.length || 1;
  return list;
}
const idx = () => INDEX || (INDEX = buildIndex());
const idf = b => Math.log((NDOC + 1) / ((DF?.get(b) || 0) + 0.5));

/* ---------- 打分 ---------- */
/* 标题：精确 100 > 前缀 80 > 子串 60；次要字段（问题句/簇名/分类）：精确 55 / 前缀 45 / 子串 40；
   工具与标签：精确 52 / 前缀 44 / 子串 34；正文子串 15；正文都没有但字有交集：中文二字组近似 ≤ 30。 */
function strictScore(e, tk) {
  let s = 0;
  if (e.t === tk) s = 100; else if (e.t.startsWith(tk)) s = 80; else if (e.t.includes(tk)) s = 60;
  if (s < 60) {
    for (const f of e.s) { const v = f === tk ? 55 : f.startsWith(tk) ? 45 : f.includes(tk) ? 40 : 0; if (v > s) s = v; }
    for (const f of e.g) { const v = f === tk ? 52 : f.startsWith(tk) ? 44 : f.includes(tk) ? 34 : 0; if (v > s) s = v; }
    if (s < 15 && e.b.includes(tk)) s = 15;
  }
  return s;
}

function fuzzyScore(e, tk) {
  const q = bigrams(tk);
  if (q.size < 2) return 0;
  let all = 0, hit = 0, n = 0;
  q.forEach(b => { const w = idf(b); all += w; if (e.bg.has(b)) { hit += w; n++; } });
  const ratio = all ? hit / all : 0;
  return n >= 2 && ratio >= 0.5 ? 10 + 20 * ratio : 0;
}

function tokenize(query) {
  return norm(query).split(/\s+/).filter(Boolean);
}

function scoreEntry(e, tokens) {
  let total = 0;
  for (const tk of tokens) {
    let s = strictScore(e, tk);
    if (!s && tk.length >= 3) s = fuzzyScore(e, tk);
    if (!s) return 0;
    total += s;
  }
  if (e.type === 'unit') total += (e.raw.status === 'verified' ? 3 : 0) + Math.min(e.raw.corroboration || 0, 6) * 0.3;
  return total;
}

function search(query) {
  const q = String(query ?? '').trim();
  const tokens = tokenize(q);
  const out = { query: q, tokens, total: 0, groups: [], nearestCluster: null };
  if (!tokens.length) return out;
  const hits = [];
  idx().forEach((e, order) => {
    const score = scoreEntry(e, tokens);
    if (score > 0) hits.push({ key: e.type + ':' + e.id, type: e.type, id: e.id, title: e.title, meta: e.meta, sample: e.sample, score, order, raw: e.raw });
  });
  hits.sort((a, b) => b.score - a.score || a.order - b.order);
  TYPES.forEach(([type, label]) => {
    const items = hits.filter(h => h.type === type);
    if (items.length) out.groups.push({ type, label, total: items.length, items });
  });
  out.total = hits.length;
  if (!out.total) out.nearestCluster = nearestCluster(q);
  return out;
}

/* ---------- 最近的问题簇 ---------- */
const STOP = new Set([...'的了吗呢么怎什是在和与把给让我你它他她这那有不也都就要会能可以如何怎样一个']);
function nearestCluster(query) {
  const K = window.COMMONS_KNOWLEDGE;
  if (!K?.clusters?.length) return null;
  const qn = norm(query);
  const chars = new Set([...qn].filter(c => /[㐀-鿿]/.test(c) && !STOP.has(c)));
  const qb = bigrams(qn);
  const tokens = tokenize(query).filter(t => /[a-z0-9]/.test(t) && t.length >= 2);
  let best = null, bestScore = 0;
  K.clusters.forEach(c => {
    const label = norm(c.label);
    let s = 0;
    chars.forEach(ch => { if (label.includes(ch)) s += 2; });
    bigrams(label).forEach(b => { if (qb.has(b)) s += 3; });
    tokens.forEach(t => { if (label.includes(t)) s += 4; });
    const units = K.units.filter(u => u.cluster === c.id);
    tokens.forEach(t => { if (units.some(u => (u.tools || []).some(x => norm(x).includes(t)))) s += 3; });
    if (s < 2) return;
    chars.forEach(ch => { if (units.some(u => norm(u.title).includes(ch))) s += 0.1; });
    if (s > bestScore) { bestScore = s; best = c; }
  });
  if (!best) return null;
  const units = K.units.filter(u => u.cluster === best.id);
  return { id: best.id, label: best.label, count: units.length, unresolved: units.filter(u => u.unresolved).length };
}

/* ---------- 「你能接住的事」：没人答过的问题，按佐证人数排 ---------- */
function openQuestions(n = 5) {
  const K = window.COMMONS_KNOWLEDGE;
  if (!K?.units) return [];
  const answered = new Set();
  K.units.forEach(u => (u.links || []).forEach(l => { if (l.rel === 'answers') answered.add(l.to); }));
  const clusters = new Map((K.clusters || []).map(c => [c.id, c]));
  return K.units
    .map((u, order) => ({ u, order }))
    .filter(({ u }) => u.kind === 'question' && !answered.has(u.id))
    .sort((a, b) => (b.u.corroboration || 0) - (a.u.corroboration || 0) || a.order - b.order)
    .slice(0, n)
    .map(({ u }) => ({ key: 'unit:' + u.id, type: 'unit', id: u.id, title: u.title, meta: `问题 · ${clusters.get(u.cluster)?.label || ''}`, sample: !!K.synthetic, raw: u }));
}

/* ---------- 最近搜索 ---------- */
let recentMemory = [];
function readRecent() {
  try {
    const v = window.Commons?.read ? window.Commons.read(RECENT_KEY, null) : null;
    if (Array.isArray(v)) return v.filter(x => typeof x === 'string').slice(0, RECENT_MAX);
  } catch { /* 存储不可用就退回内存 */ }
  return recentMemory.slice();
}
function writeRecent(list) {
  recentMemory = list.slice(0, RECENT_MAX);
  try { window.Commons?.write?.(RECENT_KEY, recentMemory); } catch { /* 忽略 */ }
}
function pushRecent(q) {
  const t = String(q ?? '').trim();
  if (!t) return;
  writeRecent([t, ...readRecent().filter(x => x !== t)]);
}

let recentPageMemory = [];
function readRecentPages() {
  try {
    const value = window.Commons?.read ? window.Commons.read(RECENT_PAGE_KEY, null) : null;
    if (Array.isArray(value)) return value.filter(item => item && typeof item.href === 'string' && typeof item.title === 'string').slice(0, RECENT_PAGE_MAX);
  } catch { /* 存储不可用就退回内存 */ }
  return recentPageMemory.slice();
}

function writeRecentPages(items) {
  recentPageMemory = items.slice(0, RECENT_PAGE_MAX);
  try { window.Commons?.write?.(RECENT_PAGE_KEY, recentPageMemory); } catch { /* 忽略 */ }
}

function routeTitle(route) {
  const local = PAGES.find(([id]) => id === route);
  if (local) return local[1];
  for (const page of window.CommonsPages || []) {
    const nav = (page && page.nav || []).find(item => item && item[0] === route);
    if (nav) return nav[1];
    if (page && page.titles && page.titles[route]) return page.titles[route];
  }
  return '';
}

function rememberCurrentPage() {
  if (typeof location === 'undefined') return;
  const path = String(location.hash || '#/home').replace(/^#\/?/, '').split('?')[0].replace(/^\/+|\/+$/g, '');
  const route = path.split('/')[0] || 'home';
  const title = routeTitle(route);
  if (!title) return;
  const href = '#/' + (path || 'home');
  const item = { route, title, href };
  writeRecentPages([item, ...readRecentPages().filter(old => old.href !== href)]);
}

function sampleState(key, fallback) {
  try {
    const value = window.Commons?.read ? window.Commons.read(key, null) : null;
    return value && typeof value === 'object' ? value : fallback;
  } catch { return fallback; }
}

function recommendations(limit = 3) {
  const found = [];
  const add = (item) => {
    if (!item || !registeredRoute(item.route) || found.some(current => current.href === item.href)) return;
    found.push({ key: 'recommendation:' + item.id, type: 'recommendation', id: item.id, title: item.title, meta: item.meta, href: item.href, raw: item });
  };
  const economy = sampleState('economy.demo.v1', window.COMMONS_ECONOMY_SAMPLE || null);
  const checkin = economy && economy.me && economy.me.checkin;
  if (checkin && !checkin.claimed_today) add({ id: 'checkin', route: 'games', href: '#/games', title: '今天签到', meta: '可领 ' + String(checkin.next_reward || 0) + ' 竹子' });

  const bounty = sampleState('bounty.demo.v1', window.COMMONS_BOUNTY_SAMPLE || null);
  const now = Date.now();
  const soonBounty = (bounty && bounty.bounties || []).filter(item => item && item.status === 'active' && Date.parse(item.deadline_at) > now)
    .sort((a, b) => Date.parse(a.deadline_at) - Date.parse(b.deadline_at))[0];
  if (soonBounty) {
    const title = soonBounty.object && soonBounty.object.title || soonBounty.label || '悬赏快到期';
    add({ id: 'bounty-' + soonBounty.id, route: 'bounties', href: '#/bounties/' + encodeURIComponent(soonBounty.id), title, meta: '悬赏快到期' });
  }

  const event = (window.COMMONS_EVENTS_SAMPLE && window.COMMONS_EVENTS_SAMPLE.events || []).filter(item => item && item.status === 'upcoming' && Date.parse(item.startsAt) > now)
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0];
  if (event) add({ id: 'event-' + event.id, route: 'events', href: '#/event/' + encodeURIComponent(event.id), title: event.title, meta: '活动快开始' });

  [
    { id: 'farm', route: 'farm', href: '#/farm', title: '去农场看看', meta: '乐园' },
    { id: 'shop', route: 'shop', href: '#/shop', title: '逛竹子商店', meta: '外观与装饰' },
    { id: 'events', route: 'events', href: '#/events', title: '看看最近活动', meta: '活动' },
    { id: 'bounties', route: 'bounties', href: '#/bounties', title: '找一个悬赏', meta: '悬赏' }
  ].forEach(add);
  return found.slice(0, limit);
}

/* ---------- 目标 ---------- */
function targetOf(item) {
  if (item.type === 'search' || item.type === 'action' || item.type === 'history' || item.type === 'recommendation') {
    const hash = String(item.href || '');
    return hash.startsWith('#/') && !/[\u0000-\u001f\u007f]/.test(hash) ? { hash } : null;
  }
  switch (item.type) {
    case 'unit': case 'method': return { hash: '#/knowledge/' + item.id };
    case 'person': return { hash: '#/people/' + item.id };
    case 'work': return { hash: '#/work/' + item.id };
    case 'page': return { hash: '#/' + item.id };
    case 'fieldwork': return { hash: '#/people', event: ['commons:fieldwork-open', { id: item.id }] };
    case 'cluster': return { hash: '#/knowledge', event: ['commons:knowledge-cluster', { id: item.id }] };
    default: return null;
  }
}

/* ---------- 渲染片段 ---------- */
function highlight(title, tokens) {
  const t = norm(title);
  if (!tokens.length || t.length !== title.length) return esc(title);
  const mark = new Array(title.length).fill(false);
  tokens.forEach(tk => { let i = t.indexOf(tk); while (i !== -1) { for (let k = i; k < i + tk.length; k++) mark[k] = true; i = t.indexOf(tk, i + tk.length); } });
  let out = '', open = false;
  for (let i = 0; i < title.length; i++) {
    if (mark[i] && !open) { out += '<mark class="cmd-mark">'; open = true; }
    if (!mark[i] && open) { out += '</mark>'; open = false; }
    out += esc(title[i]);
  }
  return out + (open ? '</mark>' : '');
}

const sampleTag = '<span class="cmd-sample" title="合成示例，不是真实内容">示例</span>';

const TYPE_LABEL = Object.fromEntries(TYPES);
const catOf = clusterId => {
  const i = (window.COMMONS_KNOWLEDGE?.clusters || []).findIndex(c => c.id === clusterId);
  return `var(--cat-${((i < 0 ? 0 : i) % 10) + 1})`;
};
const person = id => (window.COMMONS_DATA?.people || []).find(p => p.id === id);

/* 预览区：按组件目录「知识卡 · 完整」型排版：头（类型 + 状态 + 示例）、标题、问句、分节（小标签 + 正文）、脚注（来路）。 */
function previewHTML(item) {
  if (!item) return '<div class="cmd-pv-empty"><span class="cmd-pv-empty-ico">' + ico('search') + '</span><p>用 ↑ ↓ 选一条，这里会看到它的样子。</p></div>';
  const r = item.raw;
  const demo = item.sample ? sampleTag : '';
  /* safe-slot: glyph — 调用方传入 SVG 常量 */
  const kind = (glyph, label) => `<span class="cmd-kind">${glyph}<span>${esc(label)}</span></span>`;
  const typeGlyph = `<svg class="cmd-kind-g cmd-kind-g-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICONS[TYPE_ICON[item.type]] || ICONS.spark}"/></svg>`;
  const status = (key, label) => `<span class="cmd-st cmd-st-${esc(key)}">${stateIcon(key)}<span>${esc(label)}</span></span>`;
  /* safe-slot: inner — 调用方传入已 esc 的片段 */
  const sec = (label, inner) => inner ? `<section class="cmd-kc-sec"><h4 class="cmd-kc-label">${esc(label)}</h4>${inner}</section>` : '';
  const para = t => t ? `<p>${esc(t)}</p>` : '';
  const steps = (list, max = 3) => (list || []).length ? `<ol class="cmd-kc-steps">${list.slice(0, max).map(x => `<li>${esc(x)}</li>`).join('')}</ol>${list.length > max ? `<p class="cmd-kc-more">还有 ${list.length - max} 步，打开后看全部</p>` : ''}` : '';
  const chips = list => (list || []).length ? `<p class="cmd-kc-tools">${list.map(x => `<span class="cmd-chip">${esc(x)}</span>`).join('')}</p>` : '';
  const sep = '<span class="cmd-sep" aria-hidden="true"></span>';
  /* safe-slot: parts — 调用方传入已 esc 的片段数组 */
  const prov = parts => `<footer class="cmd-kc-foot"><p class="cmd-prov">${parts.filter(Boolean).join(sep)}</p></footer>`;
  const dot = (label) => label ? `<span class="cmd-prov-cluster"><i aria-hidden="true"></i>${esc(label)}</span>` : '';
  /* safe-slot: head, body, foot, extra — 调用方传入已 esc 的片段 */
  const kc = (head, title, body, foot, extra, style) => `<article class="cmd-kc" data-type="${esc(item.type)}"${style ? ` style="${esc(style)}"` : ''}><header class="cmd-kc-head"><span class="cmd-kc-top">${head}</span>${extra || ''}</header><h3 class="cmd-kc-title">${esc(title)}</h3>${body}${foot || ''}</article>`;
  let card = '';
  switch (item.type) {
    case 'unit': {
      const K = window.COMMONS_KNOWLEDGE;
      const cl = (K?.clusters || []).find(c => c.id === r.cluster);
      const ans = r.kind === 'question' ? (K.units || []).find(x => (x.links || []).some(l => l.rel === 'answers' && l.to === r.id)) : null;
      const links = (r.links || []).slice(0, 2).map(l => { const t = (K.units || []).find(x => x.id === l.to); return `<li><span class="cmd-rel cmd-rel-${esc(l.rel)}">${ico(l.rel)}<span>${esc(REL_LABEL[l.rel] || l.rel)}</span></span><span class="cmd-kc-linkto">${esc(t ? t.title : l.to)}</span></li>`; }).join('');
      const conf = Number.isFinite(r.confidence) ? `<span class="cmd-conf" title="把握：整理者对这条结论的信心"><span class="cmd-conf-bar" style="--v:${r.confidence.toFixed(2)}" aria-hidden="true"></span><span>把握 ${Math.round(r.confidence * 100)}%</span></span>` : '';
      let main = '';
      if (r.kind === 'question') {
        main = ans ? sec('已有解法', para(ans.title) + steps(ans.steps, 2)) : sec('还没解决', para(r.unresolved || '还没有人给出做法'));
        main = sec('场景', para(r.context)) + main;
      } else {
        main = sec('做法', para(r.solution)) + sec('步骤', steps(r.steps)) + sec('结果', para(r.outcome)) + (r.solution || (r.steps || []).length || r.outcome ? '' : sec('场景', para(r.context)));
        if (r.unresolved) main += sec('还没解决', para(r.unresolved));
      }
      main += sec('用到的工具', chips(r.tools)) + sec('相关知识点', links ? `<ul class="cmd-kc-links">${links}</ul>` : '');
      const foot = prov([dot(cl?.label), r.month ? `<span>${esc(r.month)}</span>` : '', Number.isFinite(r.corroboration) ? `<span>佐证 <b>${esc(r.corroboration)}</b> 人</span>` : '']);
      card = kc(kind(kindGlyph(r.kind), KIND_LABEL[r.kind] || '知识点') + status(r.status in STATE_GLYPH ? r.status : 'candidate', STATUS_LABEL[r.status] || r.status) + demo, r.title, (r.question ? `<p class="cmd-kc-q">${esc(r.question)}</p>` : '') + main, foot, conf, `--c:${catOf(r.cluster)}`);
      break;
    }
    case 'method': {
      const author = person(r.author);
      const foot = prov([`<span>约 <b>${esc(r.time)}</b> 分钟</span>`, `<span>${esc(r.level)}</span>`, author ? `<span>${esc(author.name)}</span>` : '', r.updated ? `<span>${esc(r.updated)}</span>` : '']);
      card = kc(kind(typeGlyph, `${r.category} · ${r.type}`) + status('verified', r.status) + demo, r.title, `<p class="cmd-kc-q">${esc(r.summary)}</p>` + sec('步骤', steps(r.steps)) + sec('前提', para(r.premise)) + sec('适用边界', para(r.limit)) + sec('关键词', chips(r.tags)), foot);
      break;
    }
    case 'fieldwork': {
      const st = (r.steps || []).slice(0, 3).map(x => `<li><span><b>${esc(x.title)}</b>${esc(x.body)}</span></li>`).join('');
      const more = (r.steps || []).length > 3 ? `<p class="cmd-kc-more">还有 ${r.steps.length - 3} 步，打开后看全部</p>` : '';
      const foot = prov([r.source?.date ? `<span>${esc(r.source.date)}</span>` : '', r.source?.group ? `<span>群 ${esc(r.source.group)}</span>` : '', '<span>匿名摘录</span>']);
      card = kc(kind(typeGlyph, `群友实践 · ${r.category}`) + `<span class="cmd-st cmd-st-curated">${stateIcon('curated')}<span>${esc(r.kind)}</span></span>`, r.title, `<p class="cmd-kc-q">${esc(r.summary)}</p>` + sec('经过', st ? `<ol class="cmd-kc-steps cmd-kc-steps-rich">${st}</ol>${more}` : '') + sec('可带走', para(r.takeaway)) + sec('用到的工具', chips((r.steps || []).map(x => x.tag))), foot);
      break;
    }
    case 'work': {
      const owner = person(r.owner);
      const nodes = (r.nodes || []).length ? `<ol class="cmd-flow">${r.nodes.map(n => `<li>${esc(n)}</li>`).join('')}</ol>` : '';
      const foot = prov([owner ? `<span>${esc(owner.name)}</span>` : '', `<span><b>${(r.evidence || []).length}</b> 类证据</span>`]);
      card = kc(kind(typeGlyph, `作品 · ${r.kind}`) + demo, r.title, `<p class="cmd-kc-q">${esc(r.subtitle)}</p>` + sec('过程', nodes) + sec('说明', para(r.description)) + sec('证据', (r.evidence || []).length ? `<ul class="cmd-kc-checks">${r.evidence.map(e => `<li>${esc(e)}</li>`).join('')}</ul>` : ''), foot);
      break;
    }
    case 'person': {
      const open = r.available;
      card = kc(kind(typeGlyph, '同行') + `<span class="cmd-st ${open ? 'cmd-st-verified' : 'cmd-st-stale'}">${stateIcon(open ? 'verified' : 'stale')}<span>${open ? '愿意共作' : '专注创作'}</span></span>` + demo, r.name, `<p class="cmd-kc-q">${esc(r.role)}</p>` + sec('擅长', chips(r.skills)) + sec('我可以带来', para(r.offer)) + sec('我正在寻找', para(r.seek)), prov([r.badge ? `<span>${esc(r.badge)}</span>` : '', (r.works || []).length ? `<span><b>${r.works.length}</b> 件作品</span>` : '']));
      break;
    }
    case 'page':
      card = kc(kind(typeGlyph, '页面'), r.label, `<p class="cmd-kc-q">直接跳到「${esc(r.label)}」。</p>`, '');
      break;
    case 'cluster':
      card = kc(kind(typeGlyph, '问题簇') + demo, item.title, `<p class="cmd-kc-q">离你输入的话最近的一簇。</p>` + sec('里面有', para(`${r.count} 个知识点，其中 ${r.unresolved} 个还没解决`)), '');
      break;
    case 'more':
      return `<div class="cmd-pv-empty"><span class="cmd-pv-empty-ico">${ico('plus')}</span><p>${esc(item.title === '收起' ? '按 Enter 收起这一组。' : '按 Enter 展开这一组的全部结果。')}</p></div>`;
    case 'recent':
      return `<div class="cmd-pv-empty"><span class="cmd-pv-empty-ico">${ico('clock')}</span><p>按 Enter 再搜一次「${esc(item.title)}」。</p></div>`;
    case 'action':
      card = kc(kind(typeGlyph, item.meta || '动作'), item.title, '', '');
      break;
    case 'history':
      card = kc(kind(typeGlyph, '最近去过'), item.title, '', '');
      break;
    case 'recommendation':
      card = kc(kind(typeGlyph, '现在适合做'), item.title, item.meta ? `<p class="cmd-kc-q">${esc(item.meta)}</p>` : '', '');
      break;
    case 'search':
      card = kc(kind(typeGlyph, item.groupLabel || '全站结果') + (item.sample ? sampleTag : ''), item.title, `<p class="cmd-kc-q">${esc(item.snippet || item.meta || '打开查看详情')}</p>`, prov([item.meta ? `<span>${esc(item.meta)}</span>` : '']));
      break;
    default:
      return '<div class="cmd-pv-empty"><p>再按一次 Enter 就会执行。</p></div>';
  }
  const t = targetOf(item);
  const go = `<div class="cmd-pv-go"><button type="button" class="cmd-open" data-cmd="open"><span>打开</span><kbd>↵</kbd></button>${t ? `<code class="cmd-pv-hash">${esc(t.hash)}</code>` : ''}</div>`;
  return `<div class="cmd-pv-body">${card}</div>${go}`;
}

/* ---------- 面板 ---------- */
let S = null; // 打开时的状态；关闭即为 null

/* 换个词试试：从知识点里数出最常出现的工具名 */
function suggestTerms(n = 5) {
  const K = window.COMMONS_KNOWLEDGE;
  const count = new Map();
  (K?.units || []).forEach(u => (u.tools || []).forEach(t => count.set(t, (count.get(t) || 0) + 1)));
  return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([t]) => t);
}

function paletteGroups(query, optId, flat) {
  const api = window.CommonsSearch;
  if (!api || typeof api.palette !== 'function') return { available: false, total: 0, groups: [] };
  let buckets = [];
  try { buckets = api.palette(query); } catch { return { available: false, total: 0, groups: [] }; }
  if (!Array.isArray(buckets)) return { available: false, total: 0, groups: [] };
  let total = 0;
  const groups = [];
  buckets.forEach(bucket => {
    if (!bucket || !Array.isArray(bucket.items)) return;
    const kind = String(bucket.kind || 'search');
    const label = String(bucket.label || '内容');
    const count = Number.isFinite(bucket.total) ? Math.max(0, bucket.total) : bucket.items.length;
    total += count;
    const options = bucket.items.slice(0, PALETTE_MAX_GROUP).map(item => {
      const meta = item && item.meta && typeof item.meta === 'object'
        ? [item.meta.direction, item.meta.tool, item.date].filter(Boolean).join(' · ')
        : '';
      const option = {
        key: `search:${kind}:${String(item?.id || item?.title || flat.length)}`,
        type: 'search', resultKind: kind, groupLabel: label, id: String(item?.id || ''),
        title: String(item?.title || '未命名结果'), snippet: String(item?.snippet || ''),
        meta, href: String(item?.href || ''), sample: !(window.CommonsAPI && window.CommonsAPI.mode === 'live'), optId: optId()
      };
      flat.push(option);
      return option;
    });
    if (options.length) groups.push({ kind: 'group', type: `search-${kind}`, label: `${label} · 全站`, total: count, options });
  });
  return { available: true, total, groups };
}

function listModel() {
  const q = S.input.value;
  const res = search(q);
  S.tokens = res.tokens;
  const flat = [];
  const groups = [];
  const optId = () => `cmd-opt-${flat.length}`;
  let palette = { available: false, total: 0, groups: [] };
  let actionTotal = 0;
  if (res.tokens.length) {
    const actions = actionOptions(q);
    actionTotal = actions.length;
    if (actions.length) {
      const gi = { kind: 'group', type: 'page', label: '动作', total: actions.length, options: [] };
      actions.forEach(item => { const option = { ...item, optId: optId() }; flat.push(option); gi.options.push(option); });
      groups.push(gi);
    }
    res.groups.forEach(g => {
      const open = S.expanded.has(g.type);
      const shown = open ? g.items : g.items.slice(0, MAX_GROUP);
      const gi = { kind: 'group', type: g.type, label: g.label, total: g.total, options: [] };
      shown.forEach(it => { const o = { ...it, optId: optId() }; flat.push(o); gi.options.push(o); });
      if (g.total > MAX_GROUP) {
        const o = { key: 'more:' + g.type, type: 'more', id: g.type, title: open ? '收起' : `显示全部 ${g.total} 条`, meta: g.label, optId: optId() };
        flat.push(o); gi.options.push(o);
      }
      groups.push(gi);
    });
    if (!res.total && res.nearestCluster) {
      const c = res.nearestCluster;
      const o = { key: 'cluster:' + c.id, type: 'cluster', id: c.id, title: c.label, meta: `${c.count} 个知识点 · ${c.unresolved} 个未解`, sample: !!window.COMMONS_KNOWLEDGE?.synthetic, raw: c, optId: optId() };
      flat.push(o); groups.push({ kind: 'cluster', type: 'cluster', label: '离它最近的问题簇', options: [o] });
    } else if (!res.total) {
      const o = { key: 'page:knowledge', type: 'page', id: 'knowledge', title: '知识地图', meta: '页面', raw: { id: 'knowledge', label: '知识地图' }, optId: optId() };
      flat.push(o); groups.push({ kind: 'cluster', type: 'page', label: '先去这里看看', options: [o] });
    }
    palette = paletteGroups(q, optId, flat);
    groups.push(...palette.groups);
  } else {
    const pages = readRecentPages();
    if (pages.length) {
      const gi = { kind: 'group', type: 'recent', label: '最近去过', total: pages.length, options: [] };
      pages.forEach(item => {
        const option = { key: 'history:' + item.href, type: 'history', id: item.route, title: item.title, meta: item.href, href: item.href, raw: item, optId: optId() };
        flat.push(option); gi.options.push(option);
      });
      groups.push(gi);
    }
    const picks = recommendations(3);
    if (picks.length) {
      const gi = { kind: 'group', type: 'unit', label: '现在适合做', total: picks.length, options: [] };
      picks.forEach(item => { const option = { ...item, optId: optId() }; flat.push(option); gi.options.push(option); });
      groups.push(gi);
    }
    const recent = readRecent();
    if (recent.length) {
      const gi = { kind: 'group', type: 'recent', label: '最近搜索', total: recent.length, options: [] };
      recent.forEach(t => { const o = { key: 'recent:' + t, type: 'recent', id: t, title: t, meta: '', optId: optId() }; flat.push(o); gi.options.push(o); });
      groups.push(gi);
    }
    const qs = openQuestions(5);
    if (qs.length) {
      const gi = { kind: 'group', type: 'unit', label: '还没人接住的问题', hint: '还没人答过的问题', total: qs.length, options: [] };
      qs.forEach(it => { const o = { ...it, optId: optId() }; flat.push(o); gi.options.push(o); });
      groups.push(gi);
    }
  }
  return { res, flat, groups, palette, actionTotal };
}

function optionHTML(o, active, i) {
  const sel = `role="option" id="${esc(o.optId)}" aria-selected="${active ? 'true' : 'false'}" class="cmd-opt${active ? ' cmd-active' : ''}${o.type === 'more' ? ' cmd-opt-more' : ''}" data-type="${esc(o.type)}"${o.resultKind ? ` data-kind="${esc(o.resultKind)}"` : ''} data-cmd-key="${esc(o.key)}" style="--i:${Math.min(i, 8)}"`;
  const go = '<span class="cmd-go" aria-hidden="true"><kbd>↵</kbd></span>';
  const tile = n => `<span class="cmd-ico">${ico(n)}</span>`;
  if (o.type === 'more') return `<div ${sel}>${tile('plus')}<span class="cmd-opt-text"><span class="cmd-opt-title">${esc(o.title)}</span></span>${go}</div>`;
  if (o.type === 'recent') return `<div ${sel}>${tile('clock')}<span class="cmd-opt-text"><span class="cmd-opt-title">${esc(o.title)}</span></span><span class="cmd-opt-hint">再搜一次</span>${go}</div>`;
  return `<div ${sel}>${tile(TYPE_ICON[o.resultKind] || TYPE_ICON[o.type])}<span class="cmd-opt-text"><span class="cmd-opt-title">${highlight(o.title, S.tokens)}</span><span class="cmd-opt-meta">${esc(o.meta)}</span></span>${o.sample ? sampleTag : ''}${go}</div>`;
}

function render() {
  const model = listModel();
  S.model = model;
  const { res, flat, groups, palette, actionTotal } = model;
  if (S.active >= flat.length) S.active = flat.length - 1;
  if (S.active < 0 && flat.length) S.active = 0;
  const hasQuery = res.tokens.length > 0;
  let empty = '';
  if (!hasQuery && !flat.length) {
    empty = '<div class="cmd-empty"><span class="cmd-empty-ico">' + ico('search') + '</span><h3>没有可展示的内容</h3><p>搜索数据没有加载，页面其他内容不受影响。刷新后再试。</p></div>';
  } else if (hasQuery && !res.total && !palette.total && !actionTotal) {
    const terms = suggestTerms();
    empty = `<div class="cmd-empty"><span class="cmd-empty-ico">${ico('search')}</span><h3>没有找到「${esc(res.query)}」</h3><p>换个更短的词，或者用问题里的关键词试试。</p>${terms.length ? `<div class="cmd-try"><span>试试</span>${terms.map(t => `<button type="button" class="cmd-try-chip" data-cmd="try" data-term="${esc(t)}">${esc(t)}</button>`).join('')}</div>` : ''}</div>`;
  }
  let html = '';
  let n = 0;
  groups.forEach((g, gi) => {
    const hid = `cmd-gh-${gi}`;
    const rows = g.options.map(o => optionHTML(o, flat.indexOf(o) === S.active, n++)).join('');
    const count = g.kind === 'group' ? `<span class="cmd-count">${esc(g.total)}</span>` : '';
    html += `<div class="cmd-group" role="group" aria-labelledby="${esc(hid)}" data-type="${esc(g.type)}"><div class="cmd-group-head" id="${esc(hid)}"><i class="cmd-group-dot" aria-hidden="true"></i><span>${esc(g.label)}</span>${g.hint ? `<small>${esc(g.hint)}</small>` : ''}${count}</div>${rows}</div>`;
  });
  S.emptyHost.innerHTML = empty;
  const combinedTotal = res.total + palette.total + actionTotal;
  S.status.textContent = hasQuery ? (combinedTotal ? `${combinedTotal} 条结果` : '没有结果') : '';
  S.total.textContent = hasQuery && combinedTotal ? `共 ${combinedTotal} 条` : '';
  S.all.hidden = !(hasQuery && palette.available && palette.total);
  S.allLabel.textContent = `在搜索页查看全部 ${palette.total} 条结果`;
  S.list.innerHTML = html;
  S.clear.hidden = hasQuery || !readRecent().length;
  S.input.setAttribute('aria-expanded', flat.length ? 'true' : 'false');
  paintActive(true, true);
}

/* 选中高亮条：一个常驻元素，只改 transform 和高度；行本身不重绘。snap 为真时直接落位，不走过渡。 */
function placeHl(snap) {
  const hl = S.hl;
  const cur = S.model.flat[S.active];
  const el = cur ? S.list.querySelector(`#${cur.optId}`) : null;
  if (!el) { hl.dataset.on = 'false'; return; }
  if (snap) hl.dataset.snap = '';
  hl.style.setProperty('--y', `${el.offsetTop}px`);
  hl.style.setProperty('--h', `${el.offsetHeight}px`);
  hl.dataset.on = 'true';
  if (snap) { void hl.offsetWidth; delete hl.dataset.snap; }
}

function paintActive(scroll, snap) {
  const flat = S.model.flat;
  const cur = flat[S.active] || null;
  S.list.querySelectorAll('.cmd-opt').forEach(el => {
    const on = cur && el.id === cur.optId;
    el.classList.toggle('cmd-active', !!on);
    el.setAttribute('aria-selected', on ? 'true' : 'false');
    if (on && scroll) { if (S.active === 0) S.scroller.scrollTop = 0; else el.scrollIntoView({ block: 'nearest' }); }
  });
  placeHl(snap);
  if (cur) S.input.setAttribute('aria-activedescendant', cur.optId); else S.input.removeAttribute('aria-activedescendant');
  if (S.previewKey !== (cur?.key || '')) {
    S.previewKey = cur?.key || '';
    S.preview.innerHTML = previewHTML(cur);
    const body = S.preview.querySelector('.cmd-pv-body');
    if (body) body.scrollTop = 0;
  }
}

function move(delta) {
  const n = S.model.flat.length;
  if (!n) return;
  S.active = (S.active + delta + n) % n;
  paintActive(true);
}

function moveGroup(delta) {
  const groups = S.model.groups.filter(group => Array.isArray(group.options) && group.options.length);
  if (!groups.length) return;
  const current = S.model.flat[S.active];
  let index = groups.findIndex(group => current && group.options.some(item => item.key === current.key));
  if (index < 0) index = 0;
  const next = groups[(index + delta + groups.length) % groups.length].options[0];
  const active = S.model.flat.findIndex(item => item.key === next.key);
  if (active >= 0) {
    S.active = active;
    paintActive(true);
  }
}

function activate(item) {
  if (!item) return;
  if (item.type === 'more') {
    if (S.expanded.has(item.id)) S.expanded.delete(item.id); else S.expanded.add(item.id);
    S.active = Math.max(0, S.model.flat.findIndex(o => o.key === item.key));
    S.previewKey = '';
    render();
    return;
  }
  if (item.type === 'recent') {
    S.input.value = item.id;
    S.active = 0;
    S.expanded.clear();
    S.previewKey = '';
    render();
    S.input.focus();
    return;
  }
  const t = targetOf(item);
  if (!t) return;
  pushRecent(S.input.value);
  close();
  if (location.hash !== t.hash) location.hash = t.hash;
  if (t.event) setTimeout(() => document.dispatchEvent(new CustomEvent(t.event[0], { detail: t.event[1], bubbles: true })), 80);
}

function openAllResults() {
  if (!S) return;
  const query = S.input.value.trim();
  if (!query) return;
  pushRecent(query);
  const hash = '#/search?q=' + encodeURIComponent(query);
  close();
  location.hash = hash;
}

function onKey(e) {
  if (e.isComposing || e.keyCode === 229) return; // 输入法选词中，别抢键
  const k = e.key;
  if (k === 'Escape' || ((e.metaKey || e.ctrlKey) && k.toLowerCase() === 'k')) { e.preventDefault(); e.stopPropagation(); close(); return; }
  if (k === 'ArrowDown') { e.preventDefault(); move(1); return; }
  if (k === 'ArrowUp') { e.preventDefault(); move(-1); return; }
  if (k === 'Enter') {
    if (e.target.closest('button') && e.target !== S.input && !e.target.matches('[data-cmd="open"]')) return; // 按钮自己处理
    e.preventDefault();
    activate(S.model.flat[S.active]);
    return;
  }
  if (k === 'Tab') {
    e.preventDefault();
    moveGroup(e.shiftKey ? -1 : 1);
    S.input.focus();
  }
}

function onClick(e) {
  const t = e.target;
  if (t.closest('[data-cmd="scrim"]') || t.closest('[data-cmd="close"]')) { close(); return; }
  if (t.closest('[data-cmd="clear"]')) { writeRecent([]); S.previewKey = ''; render(); S.input.focus(); return; }
  if (t.closest('[data-cmd="all"]')) { openAllResults(); return; }
  const tryBtn = t.closest('[data-cmd="try"]');
  if (tryBtn) { S.input.value = tryBtn.dataset.term || ''; onInput(); S.input.focus(); return; }
  if (t.closest('[data-cmd="open"]')) { activate(S.model.flat[S.active]); return; }
  const opt = t.closest('.cmd-opt');
  if (opt) {
    const i = S.model.flat.findIndex(o => o.key === opt.dataset.cmdKey);
    if (i >= 0) { S.active = i; activate(S.model.flat[i]); }
  }
}

function onMove(e) {
  if (e.clientX === S.px && e.clientY === S.py) return; // 滚动或重绘后浏览器补发的 mousemove：指针没动，不抢选中
  S.px = e.clientX; S.py = e.clientY;
  const opt = e.target.closest?.('.cmd-opt');
  if (!opt) return;
  const i = S.model.flat.findIndex(o => o.optId === opt.id);
  if (i >= 0 && i !== S.active) { S.active = i; paintActive(false); }
}

function onInput() {
  S.active = 0;
  S.expanded.clear();
  S.scroller.scrollTop = 0;
  S.root.classList.remove('cmd-first');
  render();
}

function lockOthers(root) {
  const held = [];
  [...document.body.children].forEach(el => {
    if (el === root || el.inert || el.tagName === 'SCRIPT') return;
    el.inert = true;
    held.push(el);
  });
  return held;
}

function open(initialQuery) {
  rememberCurrentPage();
  if (S) { S.input.focus(); if (typeof initialQuery === 'string') { S.input.value = initialQuery; onInput(); } else S.input.select(); return; }
  const stale = document.getElementById(ROOT_ID);
  if (stale) stale.remove();
  const opener = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
  const root = document.createElement('div');
  root.id = ROOT_ID;
  root.className = 'cmd-root cmd-first';
  root.innerHTML = `<div class="cmd-scrim" data-cmd="scrim"></div>
<div class="cmd-sheet" role="dialog" aria-modal="true" aria-label="搜索全站">
  <div class="cmd-bar">
    <span class="cmd-bar-ico">${ico('search')}</span>
    <input id="cmd-input" class="cmd-input" type="text" role="combobox" aria-expanded="true" aria-controls="cmd-list" aria-autocomplete="list" aria-label="搜索内容或动作" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="go" placeholder="搜内容或动作">
    <button type="button" class="cmd-close" data-cmd="close" aria-label="关闭搜索"><span class="cmd-close-text">关闭</span><kbd>Esc</kbd></button>
  </div>
  <div class="cmd-body">
    <div class="cmd-list">
      <span class="cmd-hl" aria-hidden="true" data-on="false"></span>
      <div class="cmd-empty-host" id="cmd-empty-host"></div>
      <div id="cmd-list" class="cmd-listbox" role="listbox" aria-label="搜索结果"></div>
    </div>
    <aside class="cmd-preview" id="cmd-preview" aria-label="预览" aria-live="polite"></aside>
  </div>
  <div class="cmd-sr" id="cmd-status" role="status"></div>
  <div class="cmd-foot">
    <span class="cmd-keys"><span><kbd>↑</kbd><kbd>↓</kbd> 选择</span><span><kbd>Tab</kbd> 分组</span><span><kbd>↵</kbd> 打开</span><span><kbd>Esc</kbd> 关闭</span></span>
    <button type="button" class="cmd-all" data-cmd="all" hidden><span class="cmd-all-label"></span><kbd>↵</kbd></button>
    <span class="cmd-foot-end"><span class="cmd-total" id="cmd-total"></span><button type="button" class="cmd-clear" data-cmd="clear" hidden>清除最近搜索</button></span>
  </div>
</div>`;
  document.body.appendChild(root);
  document.body.classList.add('cmd-lock');
  S = {
    root, opener, input: root.querySelector('#cmd-input'), list: root.querySelector('#cmd-list'), scroller: root.querySelector('.cmd-list'), hl: root.querySelector('.cmd-hl'), emptyHost: root.querySelector('#cmd-empty-host'), status: root.querySelector('#cmd-status'), total: root.querySelector('#cmd-total'), preview: root.querySelector('#cmd-preview'),
    clear: root.querySelector('.cmd-clear'), all: root.querySelector('.cmd-all'), allLabel: root.querySelector('.cmd-all-label'), active: 0, tokens: [], model: { flat: [], groups: [], res: null }, expanded: new Set(), previewKey: '', px: -1, py: -1, held: lockOthers(root)
  };
  S.onHash = () => close();
  S.onResize = () => { if (S) placeHl(true); };
  S.onSearch = event => {
    if (S && event.detail && event.detail.query === S.input.value.trim()) render();
  };
  root.addEventListener('keydown', onKey);
  root.addEventListener('click', onClick);
  root.addEventListener('mousemove', onMove);
  S.input.addEventListener('input', onInput);
  window.addEventListener('hashchange', S.onHash);
  window.addEventListener('resize', S.onResize);
  document.addEventListener('commons:search-update', S.onSearch);
  if (typeof initialQuery === 'string') S.input.value = initialQuery;
  render();
  root.classList.add('cmd-in');
  S.input.focus();
  if (S.input.value) S.input.select();
}

function close() {
  if (!S) return;
  const s = S;
  S = null;
  window.removeEventListener('hashchange', s.onHash);
  window.removeEventListener('resize', s.onResize);
  document.removeEventListener('commons:search-update', s.onSearch);
  s.held.forEach(el => { el.inert = false; });
  document.body.classList.remove('cmd-lock');
  const finish = () => s.root.remove();
  s.root.classList.remove('cmd-in');
  s.root.classList.add('cmd-leaving');
  setTimeout(finish, 130);
  const back = s.opener && s.opener.isConnected ? s.opener : document.getElementById('main');
  try { back?.focus({ preventScroll: true }); } catch { /* 忽略 */ }
}

window.CommonsCommand = {
  open, close,
  isOpen: () => !!S,
  _search: search,
  _nearestCluster: nearestCluster,
  _openQuestions: openQuestions,
  _targetOf: targetOf,
  _actions: actionOptions,
  _routeRegistered: registeredRoute,
  _recommendations: recommendations,
  _recentPages: readRecentPages
};
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', rememberCurrentPage, { once: true });
  else rememberCurrentPage();
  window.addEventListener('hashchange', rememberCurrentPage);
}
})();
