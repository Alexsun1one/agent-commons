/* R13 SOCIAL-1 · 动态、小组、好友。
   window.CommonsSocial = { routes, nav, icons, titles, aliases, mount, destroy, wall, composer, stream, newbar, ... }
   demo 模式用 COMMONS_SOCIAL_SAMPLE + 本机记录；live 模式只用 /api/social。 */
(() => {
'use strict';
const C = () => window.Commons;
const esc = v => C().esc(String(v ?? ''));
const safeUrl = u => C().safeUrl(u);
const EMPTY = { viewer: 'me', people: [], relations: {}, suggestions: [], categories: [], rules: [], groups: [], posts: [], incoming: [], system: [], playing: [], anniversaries: [], works: [], quotables: [] };
const isLive = () => !!(window.CommonsAPI && window.CommonsAPI.mode === 'live');
function canDo(action) {
  const S = window.CommonsSession;
  if (!S || typeof S.can !== 'function') return true;
  return !!S.can(action);
}
// CommonsSession.reason(action)：被能力门挡住时的原因（一句话）；没有就返回空。
function whyNot(action) {
  const S = window.CommonsSession;
  return (S && typeof S.reason === 'function' && S.reason(action)) || '';
}
function gateGroup() {
  return `<p class="soc-gate" role="note" data-soc-locked>${esc(whyNot('social.group.create') || '你现在的等级还不能建小组')}，<a href="#/growth">看看怎么升级</a></p>`;
}
const live = { status: 'idle', error: '', data: null, request: 0, key: '', account: '', dismissedBusy: false };
const SAMPLE = () => isLive() ? (live.data || EMPTY) : (window.COMMONS_SOCIAL_SAMPLE || EMPTY);
const T0 = Date.now();
const KEY = 'social.v1';
const BODY_MAX = 2000;
const POST_BURST = [10, 10 * 60 * 1000];
const POKE_DAY = 30;
const PIN_MAX = 3;

const REACTS = [
  { id: 'up', label: '赞' },
  { id: 'learned', label: '学到了' },
  { id: 'reproduced', label: '复现了' },
  { id: 'smile', label: '笑' },
  { id: 'cheer', label: '加油' },
  { id: 'question', label: '疑问' }
];
const REACT_BY = Object.fromEntries(REACTS.map(r => [r.id, r]));
const SCOPES = {
  members: { label: '社区', icon: 'globe', hint: '所有成员可见' },
  friends: { label: '好友', icon: 'users', hint: '互相关注的人可见' },
  group: { label: '小组', icon: 'groups', hint: '发到一个小组' },
  private: { label: '仅自己', icon: 'lock', hint: '只有你能看到' }
};
const SYS_ICON = { solved: 'bulb', drift: 'drift', farm: 'sprout' };
const QUOTE_ICON = { knowledge: 'bulb', work: 'spark', talk: 'teach', market: 'tag' };
const TOOLS = [['image', '图片', 'image'], ['link', '链接', 'link'], ['poll', '投票', 'poll'], ['quote', '引用', 'quote']];
const GROUP_COVERS = {
  'ai-coding': 'claude-code.webp', 'agent-dev': 'agent-eng.webp', 'prompt-eng': 'prompts.webp',
  'model-eval': 'local-models.webp', 'local-hw': 'hardware.webp', 'product-design': 'design.webp',
  'global-growth': 'product.webp', jobs: 'career.webp', 'ai-edu': 'reading.webp',
  'ind-commerce': 'automation.webp', newcomers: 'newcomers.webp', lounge: 'chitchat.webp'
};

const PATHS = {
  feed: 'M5 4h14v16H5zM8.5 8.5h7M8.5 12h7M8.5 15.5h4',
  groups: 'M12 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM5 20a7 7 0 0 1 14 0M4.6 10.6a2.6 2.6 0 1 1 1.9-4.5M19.4 10.6a2.6 2.6 0 1 0-1.9-4.5M1.8 17.5a4.6 4.6 0 0 1 3.6-3.6M22.2 17.5a4.6 4.6 0 0 0-3.6-3.6',
  friends: 'M9.5 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2.5 21a7 7 0 0 1 14 0M19 8v6M16 11h6',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3.5 12h17M12 3c2.4 2.5 3.6 5.5 3.6 9s-1.2 6.5-3.6 9c-2.4-2.5-3.6-5.5-3.6-9S9.6 5.5 12 3z',
  users: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20a6.5 6.5 0 0 1 13 0M16 4.6a3.5 3.5 0 0 1 0 6.3M18.6 14.4A6.5 6.5 0 0 1 21.5 20',
  lock: 'M6 11h12v9.5H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3',
  image: 'M4 5h16v14H4zM4 16l4.5-4.5 3.5 3.5 2.5-2.5L20 18M15.5 9.5h.01',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  poll: 'M5.5 20V11M12 20V5M18.5 20v-6M3 20h18',
  quote: 'M4 5h16v11H9.5L5 19.5V16H4zM8 9h8M8 12.5h5',
  thumb: 'M7.5 10.5V20H4v-9.5zM7.5 10.5 11 4a1.9 1.9 0 0 1 3.4 1.5l-.9 4.5h5.1a2 2 0 0 1 2 2.4l-1.3 5.9A2 2 0 0 1 17.4 20H7.5',
  comment: 'M20.5 12a8.5 8.5 0 0 1-12.4 7.5L3.5 20.5l1.1-4.3A8.5 8.5 0 1 1 20.5 12z',
  share: 'M16.5 3 20 6.5 16.5 10M4 11.5V10a3.5 3.5 0 0 1 3.5-3.5H20M7.5 21 4 17.5 7.5 14M20 12.5V14a3.5 3.5 0 0 1-3.5 3.5H4',
  more: 'M6 12h.01M12 12h.01M18 12h.01',
  close: 'M6.5 6.5l11 11M17.5 6.5l-11 11',
  plus: 'M12 5v14M5 12h14',
  pin: 'M9 3.5h6l-1 6.5 3 3H7l3-3zM12 13v7.5',
  star: 'M12 3.8l2.5 5.1 5.6.8-4 4 1 5.5-5.1-2.6-5 2.6 1-5.5-4.1-4 5.6-.8z',
  mute: 'M3.5 3.5l17 17M10.4 5.2A9 9 0 0 1 12 5c4.8 0 8.2 4.3 9.2 7a12.6 12.6 0 0 1-2.3 3.4M6.5 6.7C4.5 8 3.3 10.1 2.8 12c1 2.7 4.4 7 9.2 7a9 9 0 0 0 4.7-1.4M9.9 10a3 3 0 0 0 4.2 4.2',
  block: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM5.7 5.7l12.6 12.6',
  poke: 'M9.5 11.5V5.2a1.6 1.6 0 0 1 3.2 0v5.3M12.7 10.5V9a1.6 1.6 0 0 1 3.2 0v2M15.9 10.8a1.6 1.6 0 0 1 3.1 0V15a6 6 0 0 1-6 6h-.8a6 6 0 0 1-4.8-2.4L4.6 15.7a1.6 1.6 0 0 1 2.4-2.1l2.5 2.4',
  chat: 'M20.5 12a8.5 8.5 0 0 1-12.4 7.5L3.5 20.5l1.1-4.3A8.5 8.5 0 1 1 20.5 12zM8.5 12h.01M12 12h.01M15.5 12h.01',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  up: 'M12 19V5M6 11l6-6 6 6',
  chevron: 'M7 10l5 5 5-5',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20.5a7.5 7.5 0 0 1 15 0',
  game: 'M7 8h10a4.5 4.5 0 0 1 4.5 4.5v.7A3.8 3.8 0 0 1 15 15.6l-.6-.6h-4.8l-.6.6a3.8 3.8 0 0 1-6.5-2.4v-.7A4.5 4.5 0 0 1 7 8zM7.5 10.5v3M6 12h3M15.5 11.2h.01M17.3 13h.01',
  tag: 'M3.5 12.3V4.5a1 1 0 0 1 1-1h7.8L21 12.2 12.2 21zM8 8h.01',
  flag: 'M5.5 21V4M5.5 4.5h11.5l-2.4 4 2.4 4H5.5',
  map: 'M9 4.5 3.5 6.5v13l5.5-2 6 2 5.5-2v-13l-5.5 2zM9 4.5v13M15 6.5v13',
  gift: 'M4 11h16v9.5H4zM3 7h18v4H3zM12 7v13.5M12 7C10.5 4 7 4 7 5.8S10 7 12 7zm0 0c1.5-3 5-3 5-1.2S14 7 12 7z',
  sprout: 'M12 21v-8.5M12 12.5c0-4-3-7-8-7 0 5 3 7 8 7zM12 10.5c0-3 2.5-6 7-6 0 4.5-2.5 6-7 6',
  bulb: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8V16h7.2v-2.2A6 6 0 0 0 12 3z',
  drift: 'M3 8.5c3-3 6 3 9 0s6 3 9 0M3 15.5c3-3 6 3 9 0s6 3 9 0',
  spark: 'M12 3l2 6.2 6.2 2-6.2 2L12 19.4l-2-6.2-6.2-2 6.2-2z',
  teach: 'M3 4.5h18v12H3zM8 21l4-4.5 4 4.5M10 8l5 2.5-5 2.5z',
  shield: 'M12 3l7.5 3v6c0 4.5-3.2 7.6-7.5 9-4.3-1.4-7.5-4.5-7.5-9V6z',
  leave: 'M14.5 4h4.5v16h-4.5M10 8l-4 4 4 4M6 12h10',
  trash: 'M4 7h16M9.5 7V4h5v3M6 7l1 13h10l1-13',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3.2 2'
};

/* safe-fn: 图标路径来自本文件常量表，再经 esc */
function icon(name) {
  return `<svg class="soc-i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${esc(PATHS[name] || PATHS.spark)}"/></svg>`;
}
const sticker = id => `assets/stickers/react-${REACT_BY[id] ? id : 'up'}.webp`;

// ---------- 本机状态 ----------
let mem = null;
const session = { arrived: [], incomingReady: false, incomingDone: false };
const ui = { feedTab: 'all', feedLimit: 8, groupsFilter: 'all', groupTab: {}, friendsTab: 'friends', friendsQ: '', drafts: {} };

const objOf = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const arrOf = v => (Array.isArray(v) ? v : []);
function store() {
  if (mem) return mem;
  const raw = objOf(C().read(KEY, {}));
  mem = {
    posts: arrOf(raw.posts).filter(p => p && typeof p.id === 'string'),
    reactions: objOf(raw.reactions), votes: objOf(raw.votes), follow: objOf(raw.follow), star: objOf(raw.star),
    mute: objOf(raw.mute), block: objOf(raw.block), lost: objOf(raw.lost), groups: objOf(raw.groups),
    created: arrOf(raw.created), pokes: objOf(raw.pokes), greeted: objOf(raw.greeted), dismissed: arrOf(raw.dismissed),
    sysHidden: arrOf(raw.sysHidden), deleted: arrOf(raw.deleted), pins: objOf(raw.pins), reviewed: objOf(raw.reviewed),
    shares: objOf(raw.shares), postLog: arrOf(raw.postLog), suggestionsOff: raw.suggestionsOff === true,
    defaultScope: ['members', 'friends', 'private'].includes(raw.defaultScope) ? raw.defaultScope : 'members'
  };
  return mem;
}
const save = () => C().write(KEY, store());
const today = () => { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };

function coverForGroup(group) {
  const raw = String(group?.cover || '');
  if (raw.startsWith('assets/groups/')) return raw;
  const file = GROUP_COVERS[group?.slug];
  return file ? `assets/groups/${file}` : raw;
}

function normalPerson(value) {
  const p = objOf(value);
  return {
    id: String(p.id || p.handle || ''), handle: String(p.handle || p.id || ''),
    name: String(p.display_name || p.name || '已注销成员'), level: Number(p.level) || 1,
    levelName: String(p.level_name || p.levelName || ''), avatar: String(p.avatar || ''), line: String(p.line || ''),
    pokedToday: !!(p.poked_today || p.relation?.poked_today)
  };
}

function normalGroup(value) {
  const g = objOf(value), mine = objOf(g.me);
  return {
    slug: String(g.slug || ''), name: String(g.name || ''), category: String(g.category || 'community'),
    intro: String(g.intro || ''), cover: coverForGroup(g), policy: String(g.join_policy || g.policy || 'open'),
    members: Number(g.members) || 0, today: Number(g.today) || 0,
    me: String(mine.state || g.me || 'none'), role: mine.role || g.role || null,
    admins: arrOf(g.admins).map(p => typeof p === 'string' ? p : String(p.id || p.handle || '')),
    memberIds: arrOf(g.member_preview).map(p => String(p.id || p.handle || '')),
    pending: arrOf(g.pending), pinned: arrOf(g.pinned).map(p => typeof p === 'string' ? p : p.id),
    featured: arrOf(g.featured).map(p => typeof p === 'string' ? p : p.id),
    events: arrOf(g.events), rules: arrOf(g.rules), canPost: g.can_post !== false
  };
}

function normalQuote(value) {
  const q = objOf(value);
  if (q.visible === false) return { visible: false };
  const kind = q.type === 'social_post' ? 'thread' : q.type;
  const href = window.CommonsLinks?.href(kind, q.id) || '';
  return { visible: q.visible !== false, id: q.id, type: kind, label: q.type || '引用', title: q.title || '', meta: '', href };
}

function mediaSource(value) {
  if (typeof value === 'string') return value;
  const row = objOf(value);
  return String(row.image?.src || row.content_url || row.url || '');
}

function normalPost(value, people, posts) {
  const p = objOf(value), author = normalPerson(p.author);
  if (author.id) people[author.id] = author;
  const reaction = objOf(p.reactions), poll = p.poll ? objOf(p.poll) : null;
  const item = {
    id: String(p.id || ''), author: author.id, createdAt: String(p.created_at || p.createdAt || new Date().toISOString()),
    scope: String(p.scope || 'members'), group: p.group ? String(p.group.slug || p.group) : undefined,
    body: String(p.body || ''), images: arrOf(p.images).map(mediaSource).filter(Boolean),
    imageDescriptions: arrOf(p.images).map(x => String(objOf(x).alt || objOf(x).caption || '')).filter(Boolean),
    link: p.link || null, quote: p.quote ? normalQuote(p.quote) : null,
    poll: poll ? { options: arrOf(poll.options).map(o => [String(o.label ?? o[0] ?? ''), Number(o.votes ?? o[1]) || 0]), mine: Number.isInteger(poll.mine) ? poll.mine : null, closesIn: poll.closed ? '已截止' : (poll.closes_at ? `${Math.max(1, Math.ceil((Date.parse(poll.closes_at) - Date.now()) / 86400000))} 天后截止` : ''), closed: !!poll.closed } : null,
    reactions: objOf(reaction.counts), mine: reaction.mine || null, shares: Number(p.shares) || 0,
    comments: Number.isFinite(Number(p.comments)) ? [] : arrOf(p.comments), commentCount: Number(p.comments) || 0,
    can: objOf(p.can), pinned: !!p.pinned, featured: !!p.featured, etag: p.etag || ''
  };
  if (p.share_of && typeof p.share_of === 'object' && p.share_of.visible !== false) {
    const shared = normalPost(p.share_of, people, posts);
    posts.push(shared); item.shareOf = shared.id;
  } else if (typeof p.share_of === 'string') item.shareOf = p.share_of;
  return item;
}

function isClosed(err) {
  return !!(err && (err.status === 501 || err.code === 'capability_unavailable' || err === 'closed'));
}

function socialStateHTML() {
  if (live.status === 'error' && isClosed(live.error)) {
    return '<div class="soc-live-state" role="status"><b>这个功能还没开放</b><p>管理员还没打开。</p></div>';
  }
  if (live.status === 'error') return `<div class="soc-live-state" role="alert"><b>社交内容没有载入</b><p>${esc(live.error || '请稍后再试')}</p><button type="button" class="button tonal" data-soc-act="live-retry">重试</button></div>`;
  return '<div class="soc-live-state" role="status"><span class="button-spinner" aria-hidden="true"></span><b>正在读取动态</b></div>';
}

function apiGet(path, query) { return window.CommonsAPI.get(path, query).then(r => r.data || r); }
const PAGE_LIMIT = 50;
async function fetchPaged(path, query, all) {
  const items = [];
  let cursor = '';
  do {
    const q = Object.assign({}, query || {}, { limit: PAGE_LIMIT });
    if (cursor) q.cursor = cursor;
    const res = await window.CommonsAPI.get(path, q);
    const data = res && res.data;
    items.push.apply(items, Array.isArray(data) ? data : arrOf(data && data.items));
    cursor = (res && res.meta && (res.meta.cursor || res.meta.next_cursor)) || '';
    if (!all) break;
  } while (cursor);
  return { items, cursor };
}
const writing = new Set();
let clickEl = null;
function errText(error, fallback) {
  if (isClosed(error)) return '这个功能还没开放';
  return error?.message || fallback;
}
// 同一路径的写请求没回来前不再发第二个；点击的按钮置灰，finishLive 在重新载入后才放开。
// retry=true：同一个动作失败后重试，沿用上一次的幂等键（成功后才换新的），服务器不会处理两次。
const retryKeys = new Map();
function apiWrite(method, path, body, retry) {
  if (writing.has(path)) return Promise.reject({ silent: true });
  const api = window.CommonsAPI, el = clickEl, sig = retry ? method + ' ' + path + ' ' + JSON.stringify(body || {}) : '';
  const opts = { idempotencyKey: (sig && retryKeys.get(sig)) || api.newIdempotencyKey() };
  if (sig) retryKeys.set(sig, opts.idempotencyKey);
  writing.add(path);
  if (el) { el.disabled = true; el.setAttribute('aria-busy', 'true'); }
  let call;
  try {
    if (method === 'PUT') call = api.put(path, body || {}, opts);
    else if (method === 'DELETE') call = api.del(path, undefined, opts);
    else if (method === 'PATCH') call = api.patch(path, body || {}, opts);
    else call = api.post(path, body || {}, opts);
  } catch (error) { call = Promise.reject(error); }
  const promise = Promise.resolve(call);
  if (sig) promise.then(() => retryKeys.delete(sig), () => {});
  promise.release = () => {
    writing.delete(path);
    if (el && el.isConnected) { el.disabled = false; el.removeAttribute('aria-busy'); }
  };
  return promise;
}

function finishLive(promise, success) {
  const release = () => { if (promise.release) promise.release(); };
  return promise.then(() => { if (success) toast(success); return loadLive(true); }, error => {
    if (error?.silent) return null;
    toast(errText(error, '操作没有完成'));
    return null;
  }).then(result => { release(); return result; }, error => { release(); throw error; });
}

function sessionAccount() {
  const me = window.CommonsSession && window.CommonsSession.me;
  return me ? String(me.id || me.handle || '') : '';
}

function dismissedPeople() {
  return live.data && Array.isArray(live.data.dismissed) ? live.data.dismissed : [];
}

function mergeDismissed(page) {
  if (!live.data) return;
  const rows = arrOf(page.items).map(row => Object.assign(normalPerson(row), { dismissedAt: row.dismissed_at || '' }));
  const byId = new Map(dismissedPeople().map(person => [person.id, person]));
  rows.forEach(person => {
    byId.set(person.id, person);
    if (!live.data.people.some(existing => existing.id === person.id)) live.data.people.push(person);
  });
  live.data.dismissed = [...byId.values()];
  live.data.dismissedCursor = page.cursor || '';
}

function removeDismissed(id) {
  if (live.data) live.data.dismissed = dismissedPeople().filter(person => person.id !== id);
}

function loadDismissedMore() {
  const cursor = live.data && live.data.dismissedCursor, account = live.account;
  if (!cursor || live.dismissedBusy) return;
  live.dismissedBusy = true;
  fetchPaged('/social/suggestions/dismissed', { cursor }, false).then(page => {
    if (account !== live.account) return;
    mergeDismissed(page);
    live.dismissedBusy = false;
    rerender();
  }).catch(error => {
    if (account !== live.account) return;
    live.dismissedBusy = false;
    toast(errText(error, '更多已关闭的推荐人没有载入，请重试。'));
    rerender();
  });
}

function liveRouteKey() {
  const parts = routeParts(), wall = document.querySelector('#main [data-soc-root="wall"]');
  return `${sessionAccount()}:${parts.join('/')}:${ui.feedTab}:${ui.friendsTab}:${ui.groupsFilter}:${wall?.dataset.handle || ''}`;
}

function resetLiveAccount() {
  live.request += 1;
  live.data = null;
  live.status = 'idle';
  live.error = '';
  live.key = '';
  live.dismissedBusy = false;
}

function onSessionChange() {
  const next = sessionAccount();
  if (next === live.account) return;
  live.account = next;
  resetLiveAccount();
  if (isLive() && document.querySelector('#main [data-soc-root]')) loadLive(true);
}

window.addEventListener('commons:session', onSessionChange);

async function loadLive(force = false) {
  if (!isLive()) return;
  const key = liveRouteKey();
  if (!force && (live.status === 'ready' || live.status === 'loading') && live.key === key) return;
  const ticket = ++live.request;
  live.status = 'loading'; live.error = ''; live.key = key;
  try {
    const parts = routeParts(), relationKinds = ['following', 'followers', 'friends', 'starred', 'muted', 'blocked'];
    const relationPages = await Promise.all(relationKinds.map(kind => fetchPaged('/social/relations', { kind }, true)));
    const common = await Promise.all([
      window.CommonsAPI.me(), apiGet('/social/me'), apiGet('/social/groups'), apiGet('/social/suggestions'),
      apiGet('/social/anniversaries').catch(() => ({ items: [] })),
      fetchPaged('/social/suggestions/dismissed', {}, false).catch(error => ({ items: [], cursor: '', error: errText(error, '已关闭的推荐人没有载入') }))
    ]);
    if (ticket !== live.request) return;
    const people = {}, posts = [], me = normalPerson(common[0]);
    people[me.id] = me;
    const groups = arrOf(common[2].items).map(normalGroup);
    const relations = {};
    relationKinds.forEach((kind, index) => {
      const rows = relationPages[index].items;
      relations[kind] = rows.map(row => { const p = normalPerson(row); people[p.id] = p; return p.id; });
    });
    const suggestions = arrOf(common[3].items).map(row => {
      const p = normalPerson(row.person || row); people[p.id] = p;
      return { id: p.id, reason: row.reason || '' };
    });
    const anniversaries = [], blessed = [];
    arrOf(common[4].items).forEach(row => {
      const p = normalPerson(row); people[p.id] = people[p.id] || p;
      anniversaries.push({ id: p.id, text: String(row.text || '') });
      if (row.blessed_today) blessed.push(p.id);
    });
    let groupDetail = null, feedRows = [], members = [], pending = [];
    const wall = document.querySelector('#main [data-soc-root="wall"]');
    if (parts[0] === 'group' && parts[1]) {
      groupDetail = await apiGet('/social/groups/' + encodeURIComponent(parts[1]));
      const detail = normalGroup(groupDetail); groups.splice(Math.max(0, groups.findIndex(g => g.slug === detail.slug)), groups.some(g => g.slug === detail.slug) ? 1 : 0, detail);
      const extra = await Promise.all([
        fetchPaged('/social/groups/' + encodeURIComponent(parts[1]) + '/feed', { view: ui.groupTab[parts[1]] === 'featured' ? 'featured' : 'all' }, false),
        fetchPaged('/social/groups/' + encodeURIComponent(parts[1]) + '/members', { state: 'active' }, true)
      ]);
      feedRows = extra[0].items; members = extra[1].items;
      if (detail.role === 'owner' || detail.role === 'admin') pending = (await fetchPaged('/social/groups/' + encodeURIComponent(parts[1]) + '/members', { state: 'pending' }, true)).items;
      members.concat(pending).concat(arrOf(groupDetail.admins)).forEach(row => { const p = normalPerson(row); people[p.id] = p; });
      const target = groups.find(g => g.slug === detail.slug);
      if (target) {
        target.memberIds = members.map(row => normalPerson(row).id);
        target.pending = pending.map(row => ({ id: normalPerson(row).id, note: row.note || '' }));
        target.admins = arrOf(groupDetail.admins).map(row => normalPerson(row).id);
        target.rules = arrOf(groupDetail.rules); target.events = arrOf(groupDetail.events);
      }
    } else if (wall?.dataset.handle) {
      feedRows = (await fetchPaged('/social/walls/' + encodeURIComponent(wall.dataset.handle), {}, false)).items;
    } else if (parts[0] === 'feed' || parts[0] === 'home' || document.querySelector('#main [data-soc-root="home"]')) {
      feedRows = (await fetchPaged('/social/feed', { tab: ui.feedTab }, false)).items;
    }
    feedRows.forEach(row => posts.push(normalPost(row, people, posts)));
    live.data = Object.assign({}, EMPTY, {
      viewer: me.id, people: Object.values(people), relations, suggestions, anniversaries, blessed,
      categories: Object.entries(common[2].categories || {}), groups, posts,
      prefs: common[1].prefs || {}, counts: common[1].counts || {}
    });
    live.data.dismissedError = common[5].error || '';
    mergeDismissed(common[5]);
    if (mem && live.data.prefs.default_scope) mem.defaultScope = live.data.prefs.default_scope;
    live.status = 'ready'; live.error = '';
  } catch (error) {
    if (ticket !== live.request) return;
    live.status = 'error'; live.error = isClosed(error) ? 'closed' : (error?.message || '社交内容没有载入'); live.data = null;
  }
  rerender();
}

// ---------- 派生数据 ----------
const peopleMap = () => Object.fromEntries(SAMPLE().people.map(p => [p.id, p]));
const viewerId = () => SAMPLE().viewer;
function sessionPerson() {
  const me = window.CommonsSession && window.CommonsSession.me;
  if (!me) return null;
  return {
    id: String(me.id || me.handle || ''),
    handle: String(me.handle || ''),
    name: String(me.display_name || me.handle || ''),
    level: Number(me.level) || 1,
    levelName: String(me.level_name || me.levelName || ''),
    avatar: String(me.avatar_ref || me.avatar || ''),
    line: String(me.line || '')
  };
}
const viewer = () => {
  const fromPeople = peopleMap()[viewerId()];
  if (fromPeople) return fromPeople;
  if (isLive()) return sessionPerson() || { id: '', handle: '', name: '', level: 1, levelName: '', avatar: '', line: '' };
  return { id: viewerId(), handle: viewerId(), name: '我', level: 1, levelName: '新队员' };
};
const personOf = id => peopleMap()[id] || { id, handle: id, name: '已注销成员', level: 1, levelName: '', avatar: '', line: '' };

function rel() {
  const r = SAMPLE().relations || {}, st = store();
  if (isLive()) {
    const following = new Set(r.following || []), followers = new Set(r.followers || []), blocked = new Set(r.blocked || []);
    blocked.forEach(id => { following.delete(id); followers.delete(id); });
    return { following, followers, friends: new Set(r.friends || []), starred: new Set(r.starred || []), muted: new Set(r.muted || []), blocked };
  }
  const apply = (base, over) => { const out = new Set(base || []); Object.entries(over).forEach(([k, v]) => (v ? out.add(k) : out.delete(k))); return out; };
  const blocked = apply(r.blocked, st.block);
  const following = apply(r.following, st.follow);
  const followers = new Set((r.followers || []).filter(id => !st.lost[id]));
  blocked.forEach(id => { following.delete(id); followers.delete(id); });
  const starred = new Set([...apply(r.starred, st.star)].filter(id => following.has(id)));
  const muted = apply(r.muted, st.mute);
  const friends = new Set([...following].filter(id => followers.has(id)));
  return { following, followers, friends, starred, muted, blocked };
}

function groupList() {
  if (isLive()) return SAMPLE().groups.map(g => Object.assign({}, g, { cover: coverForGroup(g) }));
  const st = store();
  const made = st.created.filter(g => g && g.slug);
  return [...SAMPLE().groups, ...made].map(g => {
    const me = st.groups[g.slug] || g.me || 'none';
    const role = me === 'active' ? (g.me === 'active' || g.role === 'owner' ? (g.role || 'member') : 'member') : null;
    const reviewed = objOf(st.reviewed[g.slug]);
    const approved = Object.values(reviewed).filter(v => v === 'approved').length;
    const members = (g.members || 0) + approved + (me === 'active' ? 1 : 0) - (g.me === 'active' ? 1 : 0);
    const pending = arrOf(g.pending).filter(x => !reviewed[x.id]);
    return Object.assign({}, g, { me, role, members, pending });
  });
}
const groupMap = () => Object.fromEntries(groupList().map(g => [g.slug, g]));
const isAdmin = g => !!g && (g.role === 'admin' || g.role === 'owner');
function pinsOf(g) {
  if (isLive()) return { pin: arrOf(g.pinned), featured: arrOf(g.featured) };
  const over = store().pins[g.slug];
  return over ? { pin: arrOf(over.pin), featured: arrOf(over.featured) } : { pin: arrOf(g.pinned), featured: arrOf(g.featured) };
}

const at = minutes => new Date(T0 - minutes * 60000).toISOString();
function allPosts() {
  if (isLive()) return SAMPLE().posts.slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  const st = store();
  const local = st.posts.map(p => Object.assign({}, p, { local: true }));
  const sample = SAMPLE().posts.map(p => Object.assign({}, p, { createdAt: p.createdAt || at(p.ago || 0) }));
  return [...local, ...session.arrived, ...sample]
    .filter(p => !st.deleted.includes(p.id))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}
const postById = id => allPosts().find(p => p.id === id) || null;

function canSee(p, R, G) {
  if (!p) return false;
  if (p.author === viewerId()) return true;
  if (R.blocked.has(p.author)) return false;
  if (p.scope === 'private') return false;
  if (p.scope === 'friends') return R.friends.has(p.author);
  if (p.scope === 'group') {
    const g = G[p.group];
    if (!g) return false;
    if (g.policy === 'apply' && g.me !== 'active') return false;
  }
  return true;
}

function streamPosts(o) {
  const R = rel(), G = groupMap(), me = viewerId();
  const mine = g => !!g && g.me === 'active';
  return allPosts().filter(p => {
    if (!canSee(p, R, G)) return false;
    const muted = p.author !== me && R.muted.has(p.author);
    if (o.source === 'group') return p.group === o.slug && (o.tab !== 'featured' || pinsOf(G[o.slug]).featured.includes(p.id));
    if (o.source === 'wall') return p.author === o.handle && p.scope !== 'group';
    if (muted) return false;
    const tab = o.source === 'home' ? 'all' : o.tab || 'all';
    if (tab === 'friends') return R.friends.has(p.author);
    if (tab === 'groups') return p.scope === 'group' && mine(G[p.group]);
    return p.author === me || R.following.has(p.author) || (p.scope === 'group' && mine(G[p.group]));
  });
}

function reactionsOf(p) {
  if (isLive()) {
    const counts = Object.assign({}, p.reactions || {}), mine = REACT_BY[p.mine] ? p.mine : null;
    return { counts, mine, total: REACTS.reduce((n, r) => n + (counts[r.id] || 0), 0) };
  }
  const st = store();
  const counts = Object.assign({}, p.reactions || {});
  const base = p.local ? null : p.mine || null;
  const mine = Object.prototype.hasOwnProperty.call(st.reactions, p.id) ? st.reactions[p.id] : base;
  if (base && counts[base]) counts[base] -= 1;
  if (mine) counts[mine] = (counts[mine] || 0) + 1;
  const total = REACTS.reduce((n, r) => n + (counts[r.id] || 0), 0);
  return { counts, mine: REACT_BY[mine] ? mine : null, total };
}

function pollOf(p) {
  if (isLive()) {
    const options = p.poll.options.map(o => [String(o[0]), Number(o[1]) || 0]);
    return { options, mine: Number.isInteger(p.poll.mine) ? p.poll.mine : null, total: options.reduce((n, o) => n + o[1], 0), closed: !!p.poll.closed || p.poll.closesIn === '已截止', closesIn: p.poll.closesIn || '' };
  }
  const st = store();
  const options = p.poll.options.map(o => [String(o[0]), Number(o[1]) || 0]);
  const has = Object.prototype.hasOwnProperty.call(st.votes, p.id);
  const mine = has ? st.votes[p.id] : (Number.isInteger(p.poll.mine) ? p.poll.mine : null);
  if (has && !Number.isInteger(p.poll.mine) && options[mine]) options[mine][1] += 1;
  const total = options.reduce((n, o) => n + o[1], 0);
  return { options, mine, total, closed: p.poll.closesIn === '已截止', closesIn: p.poll.closesIn || '' };
}

function ago(iso) {
  const d = (Date.now() - Date.parse(iso)) / 60000;
  if (!(d >= 1)) return '刚刚';
  if (d < 60) return `${Math.floor(d)} 分钟前`;
  if (d < 1440) return `${Math.floor(d / 60)} 小时前`;
  if (d < 2880) return '昨天';
  const t = new Date(iso);
  return `${t.getMonth() + 1} 月 ${t.getDate()} 日`;
}
const fmt = n => Number(n || 0).toLocaleString('zh-CN');

// ---------- 小部件 ----------
/* safe-fn: CommonsAvatar.html 自行转义；兜底只拼转义后的首字 */
function avatar(p, size) {
  const s = [24, 32, 40, 48, 56, 96].includes(size) ? size : 40;
  if (window.CommonsAvatar?.html) return window.CommonsAvatar.html({ id: p.id, name: p.name, size: s === 48 ? 56 : s, src: p.avatar || '', level: p.level, letter: !p.avatar });
  return `<span class="soc-ava" style="--s:${Number(s)}px" aria-hidden="true">${esc(String(p.name || '').slice(0, 1))}</span>`;
}
const sample = () => isLive() ? '' : '<span class="pill outline soc-sample">示例</span>';

function coverMedia(group, className, width, height) {
  const src = coverForGroup(group);
  if (!src) return `<span class="${esc(className)} soc-group-cover-fallback" aria-hidden="true"></span>`;
  return `<img class="${esc(className)}" src="${safeUrl(src)}" alt="" loading="lazy" width="${Number(width)}" height="${Number(height)}">`;
}

/* safe-fn: CommonsLinks.person 自行转义；降级分支只输出转义文本。 */
function personHTML(person, label) {
  const p = person || {}, text = label ?? p.name ?? '已注销成员';
  if (window.CommonsLinks?.person) return window.CommonsLinks.person(p.handle || p.id, text, { level: p.level });
  return esc(text);
}

/* safe-fn: 普通文本分段转义，仅 @handle 交给 CommonsLinks.person。 */
function bodyWithMentions(text) {
  return String(text || '').split(/(@[a-zA-Z0-9_-]{2,40})/g).map(part => {
    if (!/^@[a-zA-Z0-9_-]{2,40}$/.test(part)) return esc(part);
    const handle = part.slice(1), found = SAMPLE().people.find(p => p.handle === handle);
    return found ? personHTML(found, part) : esc(part);
  }).join('');
}

/* safe-fn: 标题与说明逐值转义 */
function head(title, sub, actions, detail = false) {
  if (detail) return `<header class="soc-head"><div class="soc-head-copy"><div class="soc-head-title"><h1>${esc(title)}</h1>${sample()}</div></div></header>`;
  return `<header class="soc-head soc-hub-toolbar"><p>${esc(sub)}</p><div class="soc-head-actions">${/* safe: 调用方用 icon() 与写死文案拼成 */ actions || ''}${sample()}</div></header>`;
}

/* safe-fn: 空状态文案为调用方写死常量，链接过 safeUrl */
function emptyState(text, label, href, act) {
  const btn = act ? `<button type="button" class="button tonal small" data-soc-act="${esc(act)}">${esc(label)}</button>` : href ? `<a class="button tonal small" href="${safeUrl(href)}">${esc(label)}</a>` : '';
  return `<div class="soc-empty"><img src="assets/illus/empty-no-content.webp" alt="" width="96" height="72" loading="lazy"><p>${esc(text)}</p>${btn}</div>`;
}

// ---------- 动态卡 ----------
/* safe-fn: 动态字段逐值转义，图片与链接过 safeUrl */
function mediaHTML(p) {
  const imgs = arrOf(p.images).slice(0, 4);
  if (!imgs.length) return '';
  return `<div class="soc-media" data-count="${imgs.length}">${imgs.map((src, i) => {
    const described = arrOf(p.imageDescriptions)[i] || (p.body ? `${String(p.body).slice(0, 80)}（第 ${i + 1} 张图）` : `动态图片 ${i + 1}`);
    return `<img src="${safeUrl(src)}" alt="${esc(described)}" loading="lazy" decoding="async">`;
  }).join('')}</div>`;
}

/* safe-fn: 链接卡字段逐值转义，地址过 safeUrl */
function linkHTML(link) {
  if (!link) return '';
  return `<a class="soc-link" href="${safeUrl(link.url)}" target="_blank" rel="noopener noreferrer"><span class="soc-link-mark">${icon('link')}</span><span class="soc-link-copy"><b>${esc(link.title || link.domain)}</b><small>${esc(link.domain)}</small></span>${icon('arrow')}</a>`;
}

/* safe-fn: 引用卡字段逐值转义，地址过 safeUrl */
function quoteHTML(q) {
  if (!q) return '';
  if (q.visible === false) return '<div class="soc-quote is-gone">引用的内容已不可见</div>';
  const linked = window.CommonsLinks?.a ? window.CommonsLinks.a(q.type, q.id, q.title, 'soc-quote-title') : `<span class="soc-quote-title">${esc(q.title)}</span>`;
  const href = q.href || window.CommonsLinks?.href?.(q.type, q.id) || '';
  return `<div class="soc-quote" data-type="${esc(q.type)}"${href ? ` data-href="${safeUrl(href)}"` : ''}><span class="soc-quote-mark">${icon(QUOTE_ICON[q.type] || 'spark')}</span><span class="soc-quote-copy"><small>${esc(q.label)}</small><b>${/* safe: CommonsLinks.a 自行转义；降级分支已 esc */linked}</b><span>${esc(q.meta)}</span></span></div>`;
}

/* safe-fn: 选项文字逐值转义，百分比是数字 */
function pollHTML(p) {
  if (!p.poll) return '';
  const v = pollOf(p);
  const done = v.mine !== null || v.closed;
  const rows = v.options.map(([label, n], i) => {
    const pct = v.total ? Math.round(n / v.total * 100) : 0;
    if (!done) return `<button type="button" class="button tonal soc-poll-option" data-soc-act="vote" data-id="${esc(p.id)}" data-value="${i}">${esc(label)}</button>`;
    return `<div class="soc-poll-row${v.mine === i ? ' is-mine' : ''}" style="--pct:${pct}%"><span>${esc(label)}${v.mine === i ? icon('check') : ''}</span><b>${pct}%</b></div>`;
  }).join('');
  return `<div class="soc-poll" data-soc-poll="${esc(p.id)}" role="group" aria-label="投票">${rows}<p class="soc-poll-meta">${fmt(v.total)} 票 · ${esc(v.closesIn)}</p></div>`;
}

/* safe-fn: 反应表是写死常量，计数是数字 */
function footHTML(p) {
  const r = reactionsOf(p);
  const comments = Number(p.commentCount) || arrOf(p.comments).length;
  const shares = (Number(p.shares) || 0) + (isLive() ? 0 : (Number(store().shares[p.id]) || 0));
  const top = REACTS.filter(x => (r.counts[x.id] || 0) > 0).sort((a, b) => r.counts[b.id] - r.counts[a.id]).slice(0, 3);
  const who = r.mine ? (r.total > 1 ? `你和其他 ${r.total - 1} 人` : '你') : fmt(r.total);
  const stats = r.total || comments || shares ? `<div class="soc-stats">${r.total ? `<button type="button" class="button ghost small soc-stats-reacts" data-soc-act="reactors" data-id="${esc(p.id)}" aria-label="查看反应"><span class="soc-r-stack">${top.map(x => `<img src="${sticker(x.id)}" alt="" width="20" height="20">`).join('')}</span><span>${esc(who)}</span></button>` : '<span></span>'}<span class="soc-stats-side">${comments ? `<button type="button" class="button ghost small" data-soc-act="comments" data-id="${esc(p.id)}">${comments} 条评论</button>` : ''}${shares ? `<span>${shares} 次转发</span>` : ''}</span></div>` : '';
  const cur = REACT_BY[r.mine];
  const shareable = p.scope === 'members';
  const react = `<div class="soc-react-wrap"><button type="button" class="button ghost soc-act soc-act-react${cur ? ` is-on is-${esc(cur.id)}` : ''}" data-soc-act="react" data-id="${esc(p.id)}" aria-pressed="${cur ? 'true' : 'false'}" aria-haspopup="menu" aria-label="${cur ? `已选「${esc(cur.label)}」，再按取消；上方向键换一个` : '赞；上方向键或长按选其他反应'}">${cur ? `<img class="soc-act-sticker" src="${safeUrl(sticker(cur.id))}" alt="" width="24" height="24">` : icon('thumb')}<span>${cur ? esc(cur.label) : '赞'}</span></button></div>`;
  const reason = `soc-share-reason-${esc(p.id)}`;
  const actions = `<div class="soc-actions">${react}<button type="button" class="button ghost soc-act" data-soc-act="comments" data-id="${esc(p.id)}" aria-expanded="false">${icon('comment')}<span>评论</span></button><button type="button" class="button ghost soc-act" data-soc-act="share" data-id="${esc(p.id)}" aria-expanded="false"${shareable ? '' : ` aria-disabled="true" aria-describedby="${reason}"`}>${icon('share')}<span>转发</span></button>${shareable ? '' : `<span class="soc-sr" id="${reason}">只给特定的人看的动态不能转发</span>`}</div>`;
  return stats + actions;
}

/* safe-fn: 动态字段逐值转义；嵌套的原动态由本函数生成 */
function postHTML(p, opt = {}) {
  const a = personOf(p.author), R = rel(), G = groupMap();
  const g = p.group ? G[p.group] : null;
  const scope = SCOPES[p.scope] || SCOPES.members;
  const pins = g ? pinsOf(g) : { pin: [], featured: [] };
  const flags = (opt.showPin && pins.pin.includes(p.id) ? `<span class="soc-flag">${icon('pin')}置顶</span>` : '') + (g && pins.featured.includes(p.id) ? `<span class="soc-flag is-featured">${icon('star')}精华</span>` : '');
  const where = p.scope === 'group' && g ? `<a href="#/group/${esc(g.slug)}">${icon('groups')}${esc(g.name)}</a>` : `<span title="${esc(scope.hint)}">${icon(scope.icon)}${esc(scope.label)}</span>`;
  const long = String(p.body || '').length > 120;
  const body = p.body ? `<div class="soc-body${long && !opt.nested ? ' is-long' : ''}"><p>${/* safe: bodyWithMentions 逐段转义 */bodyWithMentions(p.body)}</p></div>${long && !opt.nested ? '<button type="button" class="button ghost small soc-expand" data-soc-act="expand" aria-expanded="false">展开</button>' : ''}` : '';
  let shared = '';
  if (p.shareOf) {
    const orig = postById(p.shareOf);
    shared = orig && canSee(orig, R, G) ? `<div class="soc-shared">${postHTML(orig, { nested: true })}</div>` : '<div class="soc-shared is-gone">原动态已不可见</div>';
  }
  const more = opt.nested ? '' : `<div class="soc-menu-wrap"><button type="button" class="button ghost small icon-only soc-more" data-soc-act="menu" data-id="${esc(p.id)}" aria-haspopup="menu" aria-expanded="false" aria-label="更多操作">${icon('more')}</button></div>`;
  const star = R.starred.has(a.id) ? `<span class="soc-star" title="特别关注">${icon('star')}</span>` : '';
  return `<article class="soc-post${opt.nested ? ' is-nested' : ''}" data-soc-post="${esc(p.id)}" aria-label="${esc(a.name)}的动态">
<header class="soc-post-head"><a class="soc-post-ava" href="#/u/${esc(a.handle || a.id)}" tabindex="-1" aria-hidden="true">${avatar(a, opt.nested ? 32 : 40)}</a><div class="soc-post-who"><div class="soc-post-name">${/* safe: personHTML 自行转义 */personHTML(a)}${star}${p.shareOf ? '<span class="soc-verb">转发了</span>' : ''}${flags}</div><div class="soc-post-meta"><time datetime="${esc(p.createdAt)}">${esc(ago(p.createdAt))}</time><span aria-hidden="true">·</span>${where}</div></div>${more}</header>
${body}${mediaHTML(p)}${linkHTML(p.link)}${quoteHTML(p.quote)}${pollHTML(p)}${shared}
${opt.nested ? '' : `<footer class="soc-foot" data-soc-foot>${footHTML(p)}</footer><div class="soc-sharebox" data-soc-sharebox hidden></div><div class="soc-comments" data-soc-comments hidden></div>`}
</article>`;
}

/* safe-fn: 系统卡字段逐值转义，链接过 safeUrl */
function sysHTML(card) {
  const who = card.person ? personOf(card.person) : null;
  return `<aside class="soc-sys" data-kind="${esc(card.kind)}" data-soc-sys="${esc(card.id)}" aria-label="${esc(card.title)}"><span class="soc-sys-mark">${who ? avatar(who, 40) : icon(SYS_ICON[card.kind] || 'spark')}</span><div class="soc-sys-copy"><b>${esc(card.title)}</b><p>${esc(card.body)}</p></div><a class="button tonal small" href="${safeUrl(card.href)}">${esc(card.action)}</a><button type="button" class="button ghost small icon-only" data-soc-act="dismiss-sys" data-id="${esc(card.id)}" aria-label="不再显示这张卡">${icon('close')}</button></aside>`;
}

const systemCards = () => SAMPLE().system.filter(c => !store().sysHidden.includes(c.id));

/* safe-fn: 每条动态由 postHTML 生成，属性逐值转义 */
function stream(o) {
  if (isLive() && live.status !== 'ready') return `<div class="soc-stream" data-soc-stream>${socialStateHTML()}</div>`;
  const opts = Object.assign({ source: 'feed', tab: '', slug: '', handle: '', limit: 8 }, o || {});
  const items = streamPosts(opts);
  const shown = items.slice(0, opts.limit);
  const sys = opts.source === 'feed' || opts.source === 'home' ? systemCards() : [];
  let html = '', k = 0;
  shown.forEach((p, i) => {
    html += postHTML(p, { showPin: opts.source === 'group' });
    if (k < sys.length && (i === 2 || (i > 2 && (i - 2) % 6 === 0))) html += sysHTML(sys[k++]);
  });
  let tail = '';
  if (!shown.length) tail = emptyFor(opts);
  else if (items.length > shown.length) tail = opts.source === 'home' ? `<a class="button soc-more-btn" href="#/feed">看更多动态${icon('arrow')}</a>` : '<button type="button" class="button soc-more-btn" data-soc-act="more">看更多</button>';
  else if (shown.length > 3) tail = '<p class="soc-end">都看完了</p>';
  return `<div class="soc-stream" data-soc-stream data-source="${esc(opts.source)}" data-tab="${esc(opts.tab)}" data-slug="${esc(opts.slug)}" data-handle="${esc(opts.handle)}" data-limit="${Number(opts.limit)}">${html}${tail}</div>`;
}

/* safe-fn: 空状态文案写死 */
function emptyFor(o) {
  if (o.source === 'group') return o.tab === 'featured' ? emptyState('还没有加精的讨论', '', '') : emptyState('组里还没有讨论，来开个头', '', '');
  if (o.source === 'wall') return emptyState('还没有公开的动态', '', '');
  if (o.tab === 'friends') return emptyState('好友最近没有新动态', '找好友', '#/friends');
  if (o.tab === 'groups') return emptyState('加入的小组还没有新讨论', '去逛小组', '#/groups');
  return emptyState('关注几个人，动态就会热闹起来', '找人关注', '#/friends');
}

const newbar = () => `<div class="soc-newbar" data-soc-newbar${session.incomingReady && !session.incomingDone ? '' : ' hidden'}><button type="button" class="button primary small" data-soc-act="show-new">${icon('up')}有 ${SAMPLE().incoming.length} 条新动态</button></div>`;

// ---------- 发布框 ----------
function draftOf(ctx) {
  if (!ui.drafts[ctx]) {
    const saved = objOf(C().read(`social.draft.${ctx}`, {}));
    ui.drafts[ctx] = { body: typeof saved.body === 'string' ? saved.body.slice(0, BODY_MAX) : '', images: [], link: null, poll: { options: ['', ''], days: 3 }, quote: null, scope: store().defaultScope, group: '', panel: '', linkUrl: '', linkTitle: '', error: '' };
  }
  return ui.drafts[ctx];
}
const ctxGroup = ctx => (ctx.startsWith('group:') ? groupMap()[ctx.slice(6)] || null : null);

/* safe-fn: 附件字段逐值转义，图片过 safeUrl */
function attachHTML(d) {
  const imgs = d.images.map((src, i) => `<figure class="soc-thumb"><img src="${safeUrl(src)}" alt=""><button type="button" class="button ghost small icon-only" data-soc-act="img-remove" data-value="${i}" aria-label="移除第 ${i + 1} 张图">${icon('close')}</button></figure>`).join('');
  const link = d.link ? `<div class="soc-attach-card">${linkHTML(d.link)}<button type="button" class="button ghost small icon-only" data-soc-act="link-remove" aria-label="移除链接">${icon('close')}</button></div>` : '';
  const quote = d.quote ? `<div class="soc-attach-card">${quoteHTML(d.quote)}<button type="button" class="button ghost small icon-only" data-soc-act="quote-remove" aria-label="移除引用">${icon('close')}</button></div>` : '';
  return imgs || link || quote ? `<div class="soc-attach">${imgs ? `<div class="soc-thumbs">${imgs}</div>` : ''}${link}${quote}</div>` : '';
}

/* safe-fn: 面板字段逐值转义 */
function panelHTML(d, ctx) {
  const id = `soc-${esc(ctx.replace(/[^a-z0-9]/gi, '-'))}`;
  if (d.panel === 'link') {
    return `<div class="soc-panel" data-panel="link"><div class="field"><label for="${id}-url">链接地址</label><input id="${id}-url" type="url" inputmode="url" placeholder="https://" maxlength="500" data-soc-input="link-url" value="${esc(d.linkUrl)}"></div><div class="field"><label for="${id}-title">标题（可不填）</label><input id="${id}-title" maxlength="120" data-soc-input="link-title" value="${esc(d.linkTitle)}"></div><div class="soc-panel-bar"><button type="button" class="button tonal small" data-soc-act="link-add">${icon('link')}添加链接</button></div></div>`;
  }
  if (d.panel === 'poll') {
    const opts = d.poll.options.map((o, i) => `<div class="field soc-poll-field"><label class="soc-sr" for="${id}-opt-${i}">选项 ${i + 1}</label><div class="soc-poll-input"><input id="${id}-opt-${i}" maxlength="40" placeholder="选项 ${i + 1}" data-soc-input="poll-option" data-value="${i}" value="${esc(o)}">${i > 1 ? `<button type="button" class="button ghost small icon-only" data-soc-act="poll-remove" data-value="${i}" aria-label="删除选项 ${i + 1}">${icon('close')}</button>` : ''}</div></div>`).join('');
    return `<div class="soc-panel" data-panel="poll">${opts}<div class="soc-panel-bar">${d.poll.options.length < 4 ? `<button type="button" class="button ghost small" data-soc-act="poll-add">${icon('plus')}加一个选项</button>` : '<span></span>'}<div class="segmented small" role="group" aria-label="投票时长">${[1, 3, 7].map(n => `<button type="button" data-soc-act="poll-days" data-value="${n}" aria-pressed="${d.poll.days === n}">${n} 天</button>`).join('')}</div></div></div>`;
  }
  return '';
}

/* safe-fn: 发布框字段逐值转义 */
function composer(ctx = 'feed') {
  if (isLive() && live.status !== 'ready') return '';
  const d = draftOf(ctx), me = viewer(), g = ctxGroup(ctx), G = groupMap();
  const scope = g ? 'group' : d.scope;
  const scopeText = g ? g.name : scope === 'group' ? (G[d.group] ? G[d.group].name : '选小组') : SCOPES[scope].label;
  const open = d.body || d.panel || d.images.length || d.link || d.quote;
  const tools = TOOLS.map(([k, label, ic]) => `<button type="button" class="button ghost small soc-tool" data-soc-act="tool" data-value="${k}" aria-pressed="${d.panel === k || (k === 'quote' && !!d.quote)}" aria-label="${label}">${icon(ic)}<span>${label}</span></button>`).join('');
  const scopeBtn = g ? `<span class="soc-scope-fixed">${icon('groups')}${esc(g.name)}</span>` : `<div class="soc-menu-wrap"><button type="button" class="button ghost small soc-scope" data-soc-act="scope-menu" aria-haspopup="menu" aria-expanded="false" aria-label="谁能看到：${esc(scopeText)}">${icon(SCOPES[scope].icon)}<span>${esc(scopeText)}</span>${icon('chevron')}</button></div>`;
  return `<form class="soc-composer${open ? ' is-open' : ''}" data-soc-form="compose" data-ctx="${esc(ctx)}" novalidate>
<div class="soc-composer-main">${avatar(me, 40)}<label class="soc-composer-field"><span class="soc-sr">动态内容</span><textarea name="body" rows="${open ? 3 : 1}" maxlength="${BODY_MAX}" placeholder="${esc(g ? `在「${g.name}」里说点什么` : '分享你在做的事，或踩过的坑')}" data-soc-input="body">${esc(d.body)}</textarea></label></div>
${attachHTML(d)}${panelHTML(d, ctx)}<p class="soc-composer-error" role="alert"${d.error ? '' : ' hidden'}>${esc(d.error)}</p>
<div class="soc-composer-bar"><div class="soc-tools" role="group" aria-label="添加内容">${tools}</div><div class="soc-composer-send">${scopeBtn}<button type="submit" class="button primary small soc-publish">发布</button></div></div>
<input type="file" accept="image/*" multiple hidden data-soc-file>
</form>`;
}

// ---------- 页面：动态 ----------
const FEED_TABS = [['all', '全部'], ['friends', '好友'], ['groups', '小组']];

/* safe-fn: 侧栏字段逐值转义 */
function suggestCard(limit) {
  const list = suggestionsList().slice(0, limit);
  if (!list.length) return '';
  return `<section class="soc-card soc-suggest"><div class="soc-card-head"><h2>可能认识的人</h2><a href="#/friends" data-soc-act="friends-tab" data-value="suggest">全部</a></div><ul class="soc-mini-list">${list.map(s => { const p = personOf(s.id); return `<li>${avatar(p, 40)}<div class="soc-mini-copy"><b>${/* safe: personHTML 自行转义 */personHTML(p)}</b><small>${esc(s.reason)}</small></div><button type="button" class="button tonal small" data-soc-act="follow" data-id="${esc(p.id)}">关注</button></li>`; }).join('')}</ul></section>`;
}

/* safe-fn: 小组字段逐值转义，封面过 safeUrl */
function myGroupsCard(limit) {
  const mine = groupList().filter(g => g.me === 'active').slice(0, limit);
  return `<section class="soc-card"><div class="soc-card-head"><h2>我的小组</h2><a href="#/groups">全部</a></div>${mine.length ? `<ul class="soc-mini-list">${mine.map(g => `<li>${coverMedia(g, 'soc-group-thumb', 40, 40)}<div class="soc-mini-copy"><a href="#/group/${esc(g.slug)}"><b>${esc(g.name)}</b></a><small>今天 ${Number(g.today) || 0} 条新讨论</small></div></li>`).join('')}</ul>` : '<p class="soc-card-empty">还没加入小组</p>'}</section>`;
}

function feedInner() {
  const tabs = `<div class="tabs soc-tabs" role="tablist" aria-label="动态范围">${FEED_TABS.map(([k, label]) => `<button type="button" role="tab" data-soc-act="feed-tab" data-value="${k}" aria-selected="${ui.feedTab === k}">${label}</button>`).join('')}</div>`;
  return `${head('动态', '关注的人和小组里的新鲜事', '')}
<div class="soc-layout"><div class="soc-main">${composer('feed')}${tabs}${newbar()}${stream({ source: 'feed', tab: ui.feedTab, limit: ui.feedLimit })}</div>
<aside class="soc-side" aria-label="推荐">${suggestCard(3)}${myGroupsCard(5)}</aside></div>`;
}

// ---------- 页面：小组 ----------
/* safe-fn: 小组字段逐值转义 */
function joinButton(g, size) {
  const cls = size === 'large' ? '' : ' small';
  if (g.me === 'active') return `<button type="button" class="button${cls} soc-joined" data-soc-act="group-leave" data-id="${esc(g.slug)}" aria-label="已加入「${esc(g.name)}」，点击退出">${icon('check')}<span>已加入</span></button>`;
  if (g.me === 'pending') return `<button type="button" class="button ghost${cls}" data-soc-act="group-cancel" data-id="${esc(g.slug)}" aria-label="审核中，点击撤回申请">${icon('clock')}<span>审核中</span></button>`;
  return g.policy === 'apply'
    ? `<button type="button" class="button tonal${cls}" data-soc-act="group-apply" data-id="${esc(g.slug)}">申请加入</button>`
    : `<button type="button" class="button primary${cls}" data-soc-act="group-join" data-id="${esc(g.slug)}">加入</button>`;
}

/* safe-fn: 小组字段逐值转义，封面过 safeUrl */
function groupRow(g) {
  return `<li class="soc-group-row"><a class="soc-group-cover" href="#/group/${esc(g.slug)}" tabindex="-1" aria-hidden="true">${coverMedia(g, 'soc-group-cover-img', 96, 64)}</a><div class="soc-group-copy"><a href="#/group/${esc(g.slug)}"><b>${esc(g.name)}</b></a>${g.policy === 'apply' ? `<span class="soc-policy">${icon('lock')}需申请</span>` : ''}<p>${esc(g.intro)}</p><small>${fmt(g.members)} 位成员 · 今天 ${Number(g.today) || 0} 条</small></div><div class="soc-group-act">${joinButton(g)}</div></li>`;
}

function groupsInner() {
  const all = groupList(), cats = SAMPLE().categories;
  const filters = [['all', '全部'], ['mine', '我加入的'], ...cats];
  const chips = `<div class="soc-chips" role="group" aria-label="按方向筛选">${filters.map(([k, label]) => `<button type="button" class="chip" data-soc-act="groups-filter" data-value="${esc(k)}" aria-pressed="${ui.groupsFilter === k}">${esc(label)}</button>`).join('')}</div>`;
  const mine = all.filter(g => g.me === 'active');
  const strip = mine.length && ui.groupsFilter === 'all' ? `<section class="soc-strip" aria-labelledby="soc-mine-title"><h2 id="soc-mine-title">我加入的</h2><ul class="soc-strip-list">${mine.map(g => `<li><a class="soc-strip-item" href="#/group/${esc(g.slug)}">${coverMedia(g, 'soc-strip-cover', 160, 90)}<b>${esc(g.name)}</b><small>今天 ${Number(g.today) || 0} 条新讨论</small></a></li>`).join('')}</ul></section>` : '';
  const specs = (ui.groupsFilter === 'mine' ? [['mine', '我加入的']] : cats.filter(([k]) => ui.groupsFilter === 'all' || ui.groupsFilter === k)).map(([k, label]) => {
    const list = k === 'mine' ? mine : all.filter(g => g.category === k);
    return { k: k, label: label, list: list };
  });
  const any = specs.some(row => row.list.length);
  const canCreate = isLive() ? canDo('social.group.create') : viewer().level >= 3;
  const create = `<button type="button" class="button primary" data-soc-act="group-create"${canCreate ? '' : (isLive() ? ` disabled title="${esc(whyNot('social.group.create') || '你现在还不能建小组')}"` : ' disabled title="L3 起可以建小组"')}>${icon('plus')}建小组</button>` +
    (isLive() && !canCreate ? gateGroup() : '');
  if (!any) {
    const text = ui.groupsFilter === 'mine' ? '还没加入小组' : '还没有小组';
    return `${head('小组与板块', '按方向找到一起做事的人', create)}${chips}${emptyState(text, '', '')}`;
  }
  const sections = specs.map(row => `<section class="soc-group-section" aria-labelledby="soc-cat-${esc(row.k)}"><div class="soc-section-head"><h2 id="soc-cat-${esc(row.k)}">${esc(row.label)}</h2><span>${row.list.length}</span></div>${row.list.length ? `<ul class="soc-group-list">${row.list.map(groupRow).join('')}</ul>` : '<p class="soc-card-empty">这一栏还空着</p>'}</section>`).join('');
  return `${head('小组与板块', '按方向找到一起做事的人', create)}${chips}${strip}${sections}`;
}

const GROUP_TABS = [['talk', '讨论'], ['featured', '精华'], ['events', '活动'], ['members', '成员'], ['rules', '规则']];
const routeParts = () => location.hash.replace(/^#\/?/, '').split('?')[0].split('/').filter(Boolean);

/* safe-fn: 活动字段逐值转义，封面过 safeUrl */
function groupEvents(g) {
  if (isLive()) {
    const list = arrOf(g.events);
    if (!list.length) return emptyState('组里还没有活动', '去活动广场', '#/events');
    return `<ul class="soc-event-list">${list.map(e => `<li><a class="soc-event" href="#/event/${esc(e.slug || e.id || '')}"><span class="soc-event-copy"><span class="soc-event-status" data-status="${esc(e.status || 'upcoming')}">${esc(e.status === 'live' ? '进行中' : '即将开始')}</span><b>${esc(e.title)}</b><small>${esc(e.starts_at || '')}</small></span>${icon('arrow')}</a></li>`).join('')}</ul>`;
  }
  const E = window.COMMONS_EVENTS_SAMPLE;
  const list = E && Array.isArray(E.events) ? E.events.filter(e => arrOf(g.events).includes(e.id)) : [];
  if (!list.length) return emptyState('组里还没有活动', '去活动广场', '#/events');
  const status = { live: '进行中', upcoming: '即将开始', ended: '已结束' };
  return `<ul class="soc-event-list">${list.map(e => `<li><a class="soc-event" href="#/event/${esc(e.id)}"><img src="${safeUrl(e.cover)}" alt="" loading="lazy" width="96" height="64"><span class="soc-event-copy"><span class="soc-event-status" data-status="${esc(e.status)}">${esc(status[e.status] || '')}</span><b>${esc(e.title)}</b><small>${esc(e.summary)}</small></span>${icon('arrow')}</a></li>`).join('')}</ul>`;
}

/* safe-fn: 成员字段逐值转义 */
function groupMembers(g) {
  const R = rel(), me = viewerId();
  const ids = [...new Set([...arrOf(g.admins), ...(isLive() ? arrOf(g.memberIds) : SAMPLE().people.map(p => p.id))])].filter(id => !R.blocked.has(id)).slice(0, 12);
  return `<ul class="soc-people">${ids.map(id => {
    const p = personOf(id), admin = arrOf(g.admins).includes(id);
    return personRow(p, admin ? '管理员' : p.line, id === me ? '<span class="soc-you">你</span>' : followButton(id, R));
  }).join('')}</ul>`;
}

/* safe-fn: 待审核字段逐值转义 */
function pendingCard(g) {
  if (!isAdmin(g) || !g.pending.length) return '';
  return `<section class="soc-card soc-pending"><div class="soc-card-head"><h2>待审核 <span class="soc-count">${g.pending.length}</span></h2></div><ul class="soc-mini-list">${g.pending.map(x => { const p = personOf(x.id); return `<li class="soc-pending-row">${avatar(p, 40)}<div class="soc-mini-copy"><b>${/* safe: personHTML 自行转义 */personHTML(p)}</b><small>${esc(x.note || '没有写申请理由')}</small></div><div class="soc-pending-acts"><button type="button" class="button ghost small" data-soc-act="review-reject" data-id="${esc(g.slug)}" data-value="${esc(x.id)}">拒绝</button><button type="button" class="button primary small" data-soc-act="review-approve" data-id="${esc(g.slug)}" data-value="${esc(x.id)}">通过</button></div></li>`; }).join('')}</ul></section>`;
}

/* safe-fn: 小组字段逐值转义 */
function aboutCard(g) {
  const rules = arrOf(g.rules).length ? g.rules : SAMPLE().rules;
  const admins = arrOf(g.admins).map(personOf);
  return `<section class="soc-card"><div class="soc-card-head"><h2>关于小组</h2></div><p class="soc-about">${esc(g.intro)}</p><ul class="soc-facts"><li>${icon(g.policy === 'apply' ? 'lock' : 'globe')}<span>${g.policy === 'apply' ? '需申请加入，讨论只给成员看' : '公开小组，成员都能看讨论'}</span></li><li>${icon('users')}<span>${fmt(g.members)} 位成员</span></li></ul>${admins.length ? `<div class="soc-admins"><small>管理员</small>${admins.map(p => `<span class="soc-admin-person">${avatar(p, 24)}${/* safe: personHTML 自行转义 */personHTML(p)}</span>`).join('')}</div>` : ''}<div class="soc-rules-mini"><small>组规</small><ol>${rules.map(r => `<li>${esc(r)}</li>`).join('')}</ol></div></section>`;
}

function groupInner(slug) {
  const g = groupMap()[slug];
  if (!g) return `${head('小组', '', '', true)}${emptyState('没有找到这个小组', '回到小组列表', '#/groups')}`;
  const tab = ui.groupTab[slug] || 'talk';
  const locked = g.policy === 'apply' && g.me !== 'active';
  const blockedFaces = rel().blocked;
  const faces = [...new Set([...arrOf(g.admins), ...arrOf(g.memberIds)])].filter(id => !blockedFaces.has(id)).slice(0, 5).map(personOf);
  const stack = window.CommonsAvatar?.stack ? window.CommonsAvatar.stack(faces.map(p => ({ id: p.id, name: p.name, src: p.avatar, level: p.level, size: 32 })), { max: 5 }) : '';
  const tabs = `<div class="tabs soc-tabs" role="tablist" aria-label="小组栏目">${GROUP_TABS.map(([k, label]) => `<button type="button" role="tab" data-soc-act="group-tab" data-id="${esc(slug)}" data-value="${k}" aria-selected="${tab === k}">${label}</button>`).join('')}</div>`;
  let main;
  if (locked && (tab === 'talk' || tab === 'featured')) main = `<div class="soc-locked">${icon('lock')}<p>加入后能看到组内讨论</p>${joinButton(g)}</div>`;
  else if (tab === 'talk') main = `${g.me === 'active' ? composer(`group:${slug}`) : ''}${stream({ source: 'group', slug, limit: 12 })}`;
  else if (tab === 'featured') main = stream({ source: 'group', slug, tab: 'featured', limit: 12 });
  else if (tab === 'events') main = groupEvents(g);
  else if (tab === 'members') main = groupMembers(g);
  else { const rules = arrOf(g.rules).length ? g.rules : SAMPLE().rules; main = `<ol class="soc-rules">${rules.map((r, i) => `<li><b>${i + 1}</b><span>${esc(r)}</span></li>`).join('')}</ol>`; }
  return `<section class="soc-group-hero">${coverMedia(g, 'soc-group-banner', 1200, 300)}<div class="soc-group-head"><div class="soc-group-title"><div class="soc-head-title"><h1>${esc(g.name)}</h1>${sample()}</div><p>${g.policy === 'apply' ? `${icon('lock')}需申请` : `${icon('globe')}公开小组`}<span aria-hidden="true">·</span>${fmt(g.members)} 位成员<span aria-hidden="true">·</span>今天 ${Number(g.today) || 0} 条${isAdmin(g) ? '<span class="soc-admin-badge">你是管理员</span>' : ''}</p></div><div class="soc-group-cta">${/* safe: CommonsAvatar.stack 自行转义 */ stack}${joinButton(g, 'large')}</div></div>${tabs}</section>
<div class="soc-layout"><div class="soc-main">${/* safe: 上面各分支都由本模块转义后的片段拼成 */ main}</div><aside class="soc-side" aria-label="小组信息">${pendingCard(g)}${aboutCard(g)}</aside></div>`;
}

// ---------- 页面：好友 ----------
const FRIEND_TABS = [['friends', '好友'], ['following', '关注'], ['followers', '粉丝'], ['suggest', '可能认识的人'], ['manage', '拉黑与静音']];

/* safe-slot: actions — 调用方用 icon() 与写死文案、转义后的 id 拼成 */
function personRow(p, sub, actions) {
  return `<li class="soc-person" data-name="${esc(p.name)}">${avatar(p, 48)}<div class="soc-person-copy"><div class="soc-person-name">${/* safe: personHTML 自行转义 */personHTML(p)}</div><small>${esc(sub || '')}</small></div><div class="soc-person-acts">${actions}</div></li>`;
}

/* safe-fn: 按钮由写死文案与转义后的 id 拼成 */
function followButton(id, R) {
  if (R.friends.has(id)) return `<button type="button" class="button ghost small" data-soc-act="unfollow" data-id="${esc(id)}" aria-label="互相关注，点击取消关注">${icon('users')}互相关注</button>`;
  if (R.following.has(id)) return `<button type="button" class="button ghost small" data-soc-act="unfollow" data-id="${esc(id)}" aria-label="已关注，点击取消关注">${icon('check')}已关注</button>`;
  return `<button type="button" class="button tonal small" data-soc-act="follow" data-id="${esc(id)}">${R.followers.has(id) ? '回关' : '关注'}</button>`;
}

/* safe-fn: 按钮由写死文案与转义后的 id 拼成 */
function friendActions(id) {
  const poked = isLive() ? !!personOf(id).pokedToday : store().pokes[id] === today();
  return `<button type="button" class="button ghost small" data-soc-act="dm" data-id="${esc(id)}" aria-label="私信">${icon('chat')}<span class="soc-btn-label">私信</span></button><button type="button" class="button ghost small" data-soc-act="poke" data-id="${esc(id)}" aria-label="${poked ? '今天已经戳过 TA 了' : '戳一戳'}"${poked ? ' disabled' : ''}>${icon('poke')}<span class="soc-btn-label">${poked ? '戳过了' : '戳一戳'}</span></button><div class="soc-menu-wrap"><button type="button" class="button ghost small icon-only" data-soc-act="person-menu" data-id="${esc(id)}" aria-haspopup="menu" aria-expanded="false" aria-label="更多">${icon('more')}</button></div>`;
}

function suggestionsList() {
  const R = rel(), st = store();
  const off = isLive() ? SAMPLE().prefs?.suggestions === false : st.suggestionsOff;
  if (off) return [];
  return SAMPLE().suggestions.filter(s => !R.following.has(s.id) && !R.blocked.has(s.id) && (isLive() || !st.dismissed.includes(s.id)));
}

function friendsInner() {
  const R = rel(), tab = ui.friendsTab, st = store();
  const counts = { friends: R.friends.size, following: R.following.size, followers: R.followers.size };
  const tabs = `<div class="tabs soc-tabs" role="tablist" aria-label="关系">${FRIEND_TABS.map(([k, label]) => `<button type="button" role="tab" data-soc-act="friends-tab" data-value="${k}" aria-selected="${tab === k}">${label}${counts[k] !== undefined ? `<small class="soc-tab-count">${counts[k]}</small>` : ''}</button>`).join('')}</div>`;
  const search = `<div class="field soc-search"><label for="soc-friend-q" class="soc-sr">按名字找</label><span class="soc-search-icon">${icon('search')}</span><input id="soc-friend-q" type="search" placeholder="按名字找" data-soc-input="friend-q" value="${esc(ui.friendsQ)}"></div>`;
  let body = '';
  const list = (ids, sub, acts) => (ids.length ? `<ul class="soc-people">${/* safe: personRow 转义字段，acts 为本模块按钮片段 */ ids.map(id => personRow(personOf(id), sub(id), acts(id))).join('')}</ul>` : '');
  if (tab === 'friends') body = list([...R.friends], id => personOf(id).line, friendActions) || emptyState('还没有好友，互相关注就是好友', '看看可能认识的人', '', 'suggest-tab');
  else if (tab === 'following') body = list([...R.following], id => (R.friends.has(id) ? '你们互相关注' : personOf(id).line), id => followButton(id, R)) || emptyState('还没有关注任何人', '看看可能认识的人', '', 'suggest-tab');
  else if (tab === 'followers') body = list([...R.followers], id => personOf(id).line, id => followButton(id, R)) || emptyState('还没有人关注你', '去发条动态', '#/feed');
  else if (tab === 'suggest') {
    const suggestionsOff = isLive() ? SAMPLE().prefs?.suggestions === false : st.suggestionsOff;
    const toggle = `<div class="soc-toggle-row"><span>${icon('users')}<span>根据共同好友、小组和活动推荐</span></span><button type="button" class="chip" data-soc-act="suggest-toggle" aria-pressed="${!suggestionsOff}">${suggestionsOff ? '已关闭' : '已开启'}</button></div>`;
    const items = suggestionsList();
    body = toggle + (suggestionsOff ? emptyState('推荐已关闭，你也不会出现在别人的推荐里', '重新开启', '', 'suggest-toggle') : items.length ? `<ul class="soc-people">${items.map(s => personRow(personOf(s.id), s.reason, `<button type="button" class="button tonal small" data-soc-act="follow" data-id="${esc(s.id)}">关注</button><button type="button" class="button ghost small icon-only" data-soc-act="suggest-dismiss" data-id="${esc(s.id)}" aria-label="不再推荐 ${esc(personOf(s.id).name)}">${icon('close')}</button>`)).join('')}</ul>` : emptyState('暂时没有新的推荐', '去逛小组', '#/groups'));
    const dismissed = dismissedPeople();
    if (dismissed.length) body += `<section class="soc-manage"><h2>已关闭的推荐人 <span class="soc-count">${dismissed.length}</span></h2><ul class="soc-people">${dismissed.map(p => personRow(p, p.reason || '不再推荐', `<button type="button" class="button ghost small" data-soc-act="suggest-restore" data-id="${esc(p.id)}">恢复推荐</button>`)).join('')}</ul></section>`;
    if (live.data && live.data.dismissedError) body += `<p class="soc-note" role="alert">${esc(live.data.dismissedError)} <button type="button" class="button ghost small" data-soc-act="live-retry">重试</button></p>`;
    if (live.data && live.data.dismissedCursor) body += `<button type="button" class="button ghost small" data-soc-act="suggest-dismissed-more"${live.dismissedBusy ? ' disabled aria-busy="true"' : ''}>${live.dismissedBusy ? '正在加载…' : '更多已关闭的推荐人'}</button>`;
  } else {
    const blocked = [...R.blocked], muted = [...R.muted];
    body = `<section class="soc-manage"><h2>拉黑 <span class="soc-count">${blocked.length}</span></h2><p class="soc-note">互相看不到动态，也不能私信、停车或偷菜。</p>${list(blocked, () => '已拉黑', id => `<button type="button" class="button ghost small" data-soc-act="unblock" data-id="${esc(id)}">解除拉黑</button>`) || '<p class="soc-card-empty">没有拉黑任何人</p>'}</section><section class="soc-manage"><h2>静音 <span class="soc-count">${muted.length}</span></h2><p class="soc-note">还在关注，只是动态不出现在你的列表里。</p>${list(muted, () => '已静音', id => `<button type="button" class="button ghost small" data-soc-act="unmute" data-id="${esc(id)}">取消静音</button>`) || '<p class="soc-card-empty">没有静音任何人</p>'}</section>`;
  }
  const showSearch = tab === 'friends' || tab === 'following' || tab === 'followers';
  return `${head('好友与关注', '关注是单向的，互相关注就是好友', '')}<div class="soc-layout"><div class="soc-main">${tabs}${showSearch ? search : ''}<div class="soc-friends-body" data-soc-friends>${body}</div></div><aside class="soc-side" aria-label="推荐">${tab === 'suggest' ? myGroupsCard(5) : suggestCard(4)}</aside></div>`;
}

// ---------- 主页墙 ----------
/* safe-fn: 动态由 stream 生成 */
function wall(handle) {
  if (isLive() && live.status !== 'ready') return `<section class="soc-wall" data-soc-root="wall" data-handle="${esc(handle)}">${socialStateHTML()}</section>`;
  const p = personOf(handle);
  const self = handle === viewerId();
  if (rel().blocked.has(handle)) return '<section class="soc-wall" data-soc-root="wall"><p class="soc-card-empty">你已拉黑 TA，动态不再显示。</p></section>';
  return `<section class="soc-wall" data-soc-root="wall" data-handle="${esc(handle)}" aria-label="${esc(p.name)}的动态">${self ? composer('wall') : ''}${stream({ source: 'wall', handle, limit: 6 })}</section>`;
}

// ---------- 路由 ----------
const PAGES = {
  feed: feedInner,
  groups: groupsInner,
  group: () => {
    const parts = routeParts(), slug = parts[1] || '', tab = parts[2];
    if (GROUP_TABS.some(item => item[0] === tab)) ui.groupTab[slug] = tab;
    return groupInner(slug);
  },
  friends: () => { const t = routeParts()[1]; if (FRIEND_TABS.some(x => x[0] === t)) ui.friendsTab = t; return friendsInner(); }
};
const shell = type => `<div class="soc-page soc-${esc(type)}" data-soc-root="${esc(type)}">${isLive() && live.status !== 'ready' ? socialStateHTML() : /* safe: 本模块页面函数，字段均已转义 */ PAGES[type]()}</div>`;

// ---------- 交互 ----------
let bound = false, timers = new Set(), hoverTimer = 0, closeTimer = 0, pressTimer = 0, pressFired = false, menu = null, picker = null;
const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); return t; };
const cancel = t => { if (t) { clearTimeout(t); timers.delete(t); } };
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const roots = () => [...document.querySelectorAll('#main [data-soc-root]')];

function focusKey(el) { return el && el.dataset && el.dataset.socAct ? [el.dataset.socAct, el.dataset.id || '', el.dataset.value || ''] : null; }
function refocus(key) {
  if (!key) return;
  const found = [...document.querySelectorAll('[data-soc-act]')].find(n => n.dataset.socAct === key[0] && (n.dataset.id || '') === key[1] && (n.dataset.value || '') === key[2]);
  if (found) found.focus({ preventScroll: true });
}

function rerender() {
  const key = focusKey(document.activeElement);
  closeMenu(false); closePicker(false);
  roots().forEach(root => {
    const type = root.dataset.socRoot;
    if (PAGES[type]) root.innerHTML = isLive() && live.status !== 'ready' ? socialStateHTML() : PAGES[type]();
    else if (type === 'home' && window.CommonsShowcase?.home) root.outerHTML = window.CommonsShowcase.home();
    else if (type === 'wall') root.outerHTML = wall(root.dataset.handle || '');
    else root.querySelectorAll('[data-soc-stream]').forEach(refreshStream);
  });
  autosize();
  refocus(key);
}

function refreshStream(el) {
  const html = stream({ source: el.dataset.source, tab: el.dataset.tab, slug: el.dataset.slug, handle: el.dataset.handle, limit: Number(el.dataset.limit) || 8 });
  el.outerHTML = html;
}

function refreshFoot(id) {
  const p = postById(id);
  if (!p) return;
  document.querySelectorAll(`[data-soc-post="${CSS.escape(id)}"] > [data-soc-foot]`).forEach(f => { f.innerHTML = footHTML(p); });
}

function refreshComposer(form, focusSel) {
  const ctx = form.dataset.ctx;
  const tmp = document.createElement('div');
  tmp.innerHTML = composer(ctx);
  const next = tmp.firstElementChild;
  form.replaceWith(next);
  autosize();
  if (focusSel) next.querySelector(focusSel)?.focus({ preventScroll: true });
  return next;
}

function toast(msg) { C().toast(msg); }

// —— 菜单与反应面板 ——
/* safe-fn: 菜单项由写死文案与转义后的 id 拼成 */
function menuHTML(items) {
  return `<div class="soc-menu" role="menu">${items.map(([act, id, value, label, ic, checked]) => `<button type="button" role="${checked === undefined ? 'menuitem' : 'menuitemradio'}"${checked === undefined ? '' : ` aria-checked="${checked ? 'true' : 'false'}"`} class="button ghost small" data-soc-act="${esc(act)}" data-id="${esc(id)}" data-value="${esc(value)}">${icon(ic)}<span>${esc(label)}</span>${checked ? icon('check') : ''}</button>`).join('')}</div>`;
}

function postMenuItems(p) {
  const R = rel(), me = viewerId(), g = p.group ? groupMap()[p.group] : null, items = [];
  if (p.author === me) items.push(['post-delete', p.id, '', '删除这条动态', 'trash']);
  else {
    const name = personOf(p.author).name;
    items.push(R.following.has(p.author) ? ['star', p.author, '', R.starred.has(p.author) ? '取消特别关注' : '特别关注 TA', 'star'] : ['follow', p.author, '', `关注 ${name}`, 'plus']);
    items.push(R.muted.has(p.author) ? ['unmute', p.author, '', '取消静音', 'mute'] : ['mute', p.author, '', '静音 TA', 'mute']);
    items.push(['block', p.author, '', '拉黑 TA', 'block']);
  }
  if (isAdmin(g)) {
    const pins = pinsOf(g);
    items.push(['post-pin', p.id, '', pins.pin.includes(p.id) ? '取消置顶' : '置顶到小组', 'pin']);
    items.push(['post-feature', p.id, '', pins.featured.includes(p.id) ? '移出精华' : '加入精华', 'star']);
    if (p.author !== me) items.push(['post-hide', p.id, '', '从小组移出', 'close']);
  }
  return items;
}

function personMenuItems(id) {
  const R = rel();
  return [
    ['star', id, '', R.starred.has(id) ? '取消特别关注' : '特别关注 TA', 'star'],
    R.muted.has(id) ? ['unmute', id, '', '取消静音', 'mute'] : ['mute', id, '', '静音 TA', 'mute'],
    ['unfollow', id, '', '取消关注', 'leave'],
    ['block', id, '', '拉黑 TA', 'block']
  ];
}

function scopeMenuItems(form) {
  const d = draftOf(form.dataset.ctx);
  const items = ['members', 'friends', 'private'].map(k => ['scope', '', k, `${SCOPES[k].label} · ${SCOPES[k].hint}`, SCOPES[k].icon, d.scope === k]);
  groupList().filter(g => g.me === 'active').forEach(g => items.push(['scope-group', '', g.slug, `小组 · ${g.name}`, 'groups', d.scope === 'group' && d.group === g.slug]));
  return items;
}

function openMenu(button, items) {
  closeMenu(false); closePicker(false);
  const wrap = button.closest('.soc-menu-wrap') || button.parentElement;
  wrap.insertAdjacentHTML('beforeend', menuHTML(items));
  const el = wrap.querySelector('.soc-menu');
  const box = el.getBoundingClientRect();
  if (box.bottom > innerHeight - 8) el.classList.add('is-up');
  button.setAttribute('aria-expanded', 'true');
  menu = { el, button };
  (el.querySelector('[aria-checked="true"]') || el.querySelector('button'))?.focus({ preventScroll: true });
}
function closeMenu(restore = true) {
  if (!menu) return;
  const { el, button } = menu;
  menu = null;
  el.remove();
  button.setAttribute('aria-expanded', 'false');
  if (restore && button.isConnected) button.focus({ preventScroll: true });
}

/* safe-fn: 反应表是写死常量 */
function pickerHTML(id, mine) {
  return `<div class="soc-picker" role="menu" aria-label="选择反应">${REACTS.map((r, i) => `<button type="button" role="menuitemradio" class="soc-sticker" aria-checked="${r.id === mine ? 'true' : 'false'}" data-soc-act="pick" data-id="${esc(id)}" data-value="${r.id}" style="--i:${i}" tabindex="-1"><img src="${sticker(r.id)}" alt="" width="56" height="56" draggable="false"><span>${r.label}</span></button>`).join('')}</div>`;
}
function openPicker(button, focus) {
  if (picker && picker.button === button) return;
  closePicker(false); closeMenu(false);
  const wrap = button.closest('.soc-react-wrap');
  const p = postById(button.dataset.id);
  if (!wrap || !p) return;
  wrap.insertAdjacentHTML('beforeend', pickerHTML(p.id, reactionsOf(p).mine));
  const el = wrap.querySelector('.soc-picker');
  picker = { el, button, wrap };
  button.setAttribute('aria-expanded', 'true');
  if (focus) (el.querySelector('[aria-checked="true"]') || el.querySelector('button')).focus({ preventScroll: true });
}
function closePicker(restore = true) {
  cancel(closeTimer); closeTimer = 0;
  if (!picker) return;
  const { el, button } = picker;
  picker = null;
  el.remove();
  button.setAttribute('aria-expanded', 'false');
  if (restore && button.isConnected) button.focus({ preventScroll: true });
}

function setReaction(id, kind) {
  const st = store(), p = postById(id);
  if (!p) return;
  const cur = reactionsOf(p).mine;
  if (isLive()) {
    const next = kind && kind !== cur ? kind : null;
    finishLive(next ? apiWrite('PUT', `/social/posts/${encodeURIComponent(id)}/reaction`, { kind: next }) : apiWrite('DELETE', `/social/posts/${encodeURIComponent(id)}/reaction`), next ? '已记下反应' : '已取消反应');
    return null;
  }
  st.reactions[id] = kind && kind !== cur ? kind : null;
  save();
  refreshFoot(id);
  const btn = document.querySelector(`[data-soc-post="${CSS.escape(id)}"] [data-soc-act="react"]`);
  if (btn && st.reactions[id]) { btn.classList.add('is-pop'); later(() => btn.classList.remove('is-pop'), 400); }
  return btn;
}

// —— 关系 ——
function setFollow(id, on) {
  if (isLive()) {
    const p = personOf(id), handle = p.handle || id;
    finishLive(apiWrite(on ? 'PUT' : 'DELETE', `/social/follows/${encodeURIComponent(handle)}`), on ? `已关注 ${p.name}` : `已取消关注 ${p.name}`);
    return;
  }
  const st = store();
  st.follow[id] = on;
  if (!on) st.star[id] = false;
  save();
  const R = rel();
  toast(on ? (R.friends.has(id) ? `你和 ${personOf(id).name} 现在是好友了` : `已关注 ${personOf(id).name}`) : `已取消关注 ${personOf(id).name}`);
  rerender();
}

function confirmBlock(id) {
  const p = personOf(id);
  C().modal(`拉黑 ${p.name}？`, `<div class="soc-confirm" data-soc-root="confirm"><p>你们会互相看不到动态，也不能私信、停车或偷菜。TA 不会收到通知。</p><div class="dialog-actions"><button type="button" class="button" data-soc-act="modal-close">取消</button><button type="button" class="button danger" data-soc-act="block-confirm" data-id="${esc(id)}">拉黑</button></div></div>`);
}

function poke(id) {
  if (isLive()) {
    const p = personOf(id);
    finishLive(apiWrite('POST', `/social/pokes/${encodeURIComponent(p.handle || id)}`, {}), `戳了 ${p.name} 一下`);
    return;
  }
  const st = store(), day = today();
  if (st.pokes[id] === day) { toast('今天已经戳过 TA 了'); return; }
  const sent = Object.values(st.pokes).filter(v => v === day).length;
  if (sent >= POKE_DAY) { toast('今天戳得够多了，明天再来'); return; }
  st.pokes[id] = day;
  save();
  toast(`戳了 ${personOf(id).name} 一下`);
  rerender();
}

// —— 发布 ——
function publish(form) {
  const ctx = form.dataset.ctx, d = draftOf(ctx), g = ctxGroup(ctx), st = store();
  const body = d.body.trim();
  const options = d.panel === 'poll' ? d.poll.options.map(s => s.trim()).filter(Boolean) : [];
  const fail = msg => { d.error = msg; refreshComposer(form, 'textarea'); };
  if (d.panel === 'poll' && options.length === 1) return fail('投票要有 2 到 4 个选项');
  if (new Set(options).size !== options.length) return fail('选项不能重复');
  if (!body && !d.images.length && !d.link && !options.length && !d.quote) return fail('写点什么，或者加一张图、一个链接、一个投票');
  const scope = g ? 'group' : d.scope;
  const group = g ? g.slug : scope === 'group' ? d.group : '';
  if (scope === 'group' && !group) return fail('先选一个小组');
  if (isLive()) {
    if (d.images.length) return fail('图片还没有完成服务端上传，请先移除图片');
    const payload = { body: body || null, images: [], scope, group: group || null };
    if (d.link) payload.link = { url: d.link.url, title: d.link.title || null };
    if (options.length >= 2) payload.poll = { options, days: d.poll.days };
    if (d.quote?.id) payload.quote = { id: d.quote.id };
    const submit = form.querySelector('[type="submit"]'); if (submit) submit.disabled = true;
    window.CommonsAPI.post('/social/posts', payload, { idempotencyKey: window.CommonsAPI.newIdempotencyKey() }).then(() => {
      ui.drafts[ctx] = null; C().write(`social.draft.${ctx}`, {}); toast('已发布'); return loadLive(true);
    }, error => { if (submit) submit.disabled = false; fail(errText(error, '发布没有完成')); });
    return;
  }
  const now = Date.now();
  st.postLog = st.postLog.filter(t => now - t < POST_BURST[1]);
  if (st.postLog.length >= POST_BURST[0]) return fail('发得有点快，歇一会儿再发');
  const post = {
    id: `local-${now.toString(36)}`, author: viewerId(), createdAt: new Date(now).toISOString(), scope, group: group || undefined,
    body, images: d.images.slice(0, 4), link: d.link, quote: d.quote,
    poll: options.length >= 2 ? { options: options.map(o => [o, 0]), mine: null, closesIn: `${d.poll.days} 天后截止` } : undefined,
    reactions: {}, shares: 0, comments: []
  };
  st.posts.unshift(post);
  st.posts = st.posts.slice(0, 40);
  st.postLog.push(now);
  if (!save()) { st.posts.shift(); post.images = []; st.posts.unshift(post); save(); }
  ui.drafts[ctx] = null;
  C().write(`social.draft.${ctx}`, {});
  const where = scope === 'group' ? `发到「${groupMap()[group].name}」` : scope === 'members' ? '已发布' : `已发布，${SCOPES[scope].label}可见`;
  toast(scope === 'group' ? `已${where}` : where);
  rerender();
}

function readImages(form, files) {
  const d = draftOf(form.dataset.ctx);
  const room = 4 - d.images.length;
  const list = [...files].filter(f => /^image\//.test(f.type)).slice(0, Math.max(0, room));
  if (!room) { toast('最多 4 张图'); return; }
  if (files.length > room) toast('最多 4 张图，多出来的没有加上');
  Promise.all(list.map(shrink)).then(urls => {
    d.images.push(...urls.filter(Boolean));
    d.panel = d.panel === 'image' ? '' : d.panel;
    if (form.isConnected) refreshComposer(form, 'textarea');
  });
}
function shrink(file) {
  return new Promise(resolve => {
    if (file.size > 8 * 1024 * 1024) { toast('单张图不能超过 8 MB'); resolve(''); return; }
    const url = URL.createObjectURL(file), img = new Image();
    img.addEventListener('load', () => {
      const k = Math.min(1, 1280 / Math.max(img.naturalWidth, img.naturalHeight));
      const cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.round(img.naturalWidth * k));
      cv.height = Math.max(1, Math.round(img.naturalHeight * k));
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(url);
      resolve(cv.toDataURL('image/webp', 0.82));
    }, { once: true });
    img.addEventListener('error', () => { URL.revokeObjectURL(url); toast('这张图打不开'); resolve(''); }, { once: true });
    img.src = url;
  });
}

/* safe-fn: 引用候选是样例常量，逐值转义 */
function quotePicker(ctx) {
  return `<div class="soc-quote-pick" data-soc-root="quote"><ul>${SAMPLE().quotables.map((q, i) => `<li><button type="button" class="button ghost soc-quote-choice" data-soc-act="quote-pick" data-id="${esc(ctx)}" data-value="${i}">${icon(QUOTE_ICON[q.type] || 'spark')}<span><small>${esc(q.label)}</small><b>${esc(q.title)}</b></span></button></li>`).join('')}</ul></div>`;
}

function shareBox(art, id) {
  const box = art.querySelector('[data-soc-sharebox]');
  if (!box) return;
  const btn = art.querySelector('[data-soc-act="share"]');
  if (!box.hidden) { box.hidden = true; box.innerHTML = ''; btn?.setAttribute('aria-expanded', 'false'); return; }
  const fid = `soc-share-${esc(id)}`;
  box.innerHTML = `<div class="field"><label for="${fid}">说点什么（可不填）</label><textarea id="${fid}" rows="2" maxlength="500" data-soc-input="share-note"></textarea></div><div class="soc-sharebox-bar"><div class="segmented small" role="group" aria-label="谁能看到">${['members', 'friends'].map(k => `<button type="button" data-soc-act="share-scope" data-value="${k}" aria-pressed="${k === 'members'}">${SCOPES[k].label}</button>`).join('')}</div><div class="soc-sharebox-send"><button type="button" class="button ghost small" data-soc-act="share-cancel" data-id="${esc(id)}">取消</button><button type="button" class="button primary small" data-soc-act="share-send" data-id="${esc(id)}">转发</button></div></div>`;
  box.hidden = false;
  btn?.setAttribute('aria-expanded', 'true');
  box.querySelector('textarea').focus({ preventScroll: true });
}

function openComments(art, id, trigger) {
  const host = art.querySelector('[data-soc-comments]');
  if (!host) return;
  const open = host.hidden;
  host.hidden = !open;
  art.querySelectorAll('[data-soc-act="comments"]').forEach(b => b.setAttribute('aria-expanded', String(open)));
  if (open && isLive()) {
    if (window.CommonsThread?.mount) {
      if (host.dataset.mounted !== String(id)) {
        window.CommonsThread.mount(host, { targetId: id, repliesOnly: true });
        host.dataset.mounted = String(id);
      }
    } else host.innerHTML = '<p class="soc-card-empty">评论组件没有加载</p>';
  } else if (open && !host.dataset.mounted) {
    const p = postById(id), P = peopleMap();
    const list = arrOf(p && p.comments);
    const byId = Object.fromEntries(list.map(c => [c.id, c]));
    const messages = list.map(c => {
      const parent = c.reply_to ? byId[c.reply_to] : null;
      return { id: `${id}-${c.id}`, authorId: c.authorId, body: c.body, createdAt: at(c.ago || 0), editedAt: null, reply_to: parent ? `${id}-${parent.id}` : null, thread_root: parent ? `${id}-${parent.id}` : `${id}-${c.id}`, quote: parent ? { id: `${id}-${parent.id}`, authorId: parent.authorId, authorName: (P[parent.authorId] || {}).name || '', excerpt: String(parent.body).slice(0, 40) } : null, status: 'ok', reactions: {}, mine: {} };
    });
    const people = SAMPLE().people.map(x => ({ id: x.id, name: x.name, level: x.level, levelName: x.levelName, src: x.avatar }));
    const me = viewer();
    if (window.CommonsThread?.mount) window.CommonsThread.mount(host, { targetId: `social:${id}`, messages, me: { id: me.id, name: me.name, level: me.level, levelName: me.levelName, src: me.avatar }, people, mode: 'chat' });
    else host.innerHTML = '<p class="soc-card-empty">评论组件没有加载</p>';
    host.dataset.mounted = '1';
  }
  if (open && trigger && trigger.closest('.soc-actions')) host.querySelector('textarea')?.focus({ preventScroll: true });
}

function showReactors(id) {
  if (isLive()) {
    apiGet(`/social/posts/${encodeURIComponent(id)}/reactions`).then(data => {
      const rows = arrOf(data.items).map(row => { const p = normalPerson(row); return `<li>${avatar(p, 40)}<span>${/* safe: personHTML 自行转义 */personHTML(p)} · ${esc(REACT_BY[row.kind]?.label || row.kind)}</span></li>`; }).join('');
      C().modal('大家的反应', `<ul class="soc-reactors" data-soc-root="reactors">${rows || '<li>还没有反应</li>'}</ul>`);
    }, error => toast(error?.message || '反应列表没有载入'));
    return;
  }
  const p = postById(id);
  if (!p) return;
  const r = reactionsOf(p);
  const rows = REACTS.filter(x => (r.counts[x.id] || 0) > 0).map(x => `<li><img src="${sticker(x.id)}" alt="" width="40" height="40"><span>${x.label}</span><b>${fmt(r.counts[x.id])}</b></li>`).join('');
  C().modal('大家的反应', `<ul class="soc-reactors" data-soc-root="reactors">${rows}</ul>`);
}

// —— 小组 ——
function joinGroup(slug, state, note = '') {
  const st = store(), g = groupMap()[slug];
  if (!g) return;
  if (isLive()) {
    const promise = state === 'none' ? apiWrite('POST', `/social/groups/${encodeURIComponent(slug)}/leave`, {}) : apiWrite('POST', `/social/groups/${encodeURIComponent(slug)}/join`, note ? { note } : {});
    finishLive(promise, state === 'none' ? `已退出「${g.name}」` : (g.policy === 'apply' ? '申请已提交' : `已加入「${g.name}」`));
    return;
  }
  st.groups[slug] = state;
  save();
  if (state === 'active') toast(`已加入「${g.name}」`);
  else if (state === 'pending') toast('申请已提交，管理员通过后会通知你');
  else toast(g.me === 'pending' ? '已撤回申请' : `已退出「${g.name}」`);
  rerender();
}

function createGroupForm() {
  if (isLive() && !canDo('social.group.create')) return;
  const cats = SAMPLE().categories;
  C().modal('建一个小组', `<form class="soc-create" data-soc-form="group-create" data-soc-root="create" novalidate><div class="field"><label for="soc-g-name">组名</label><input id="soc-g-name" name="name" maxlength="24" required placeholder="比如：多模态评测"></div><div class="field"><label for="soc-g-slug">地址</label><input id="soc-g-slug" name="slug" maxlength="40" required placeholder="multimodal-eval" autocapitalize="off" spellcheck="false"><small>小写字母、数字和短横线</small></div><div class="field"><label for="soc-g-cat">方向</label><select id="soc-g-cat" name="category">${cats.map(([k, label]) => `<option value="${esc(k)}">${esc(label)}</option>`).join('')}</select></div><div class="field"><label for="soc-g-intro">一句话简介</label><input id="soc-g-intro" name="intro" maxlength="80"></div><div class="field"><span class="soc-field-label">加入方式</span><div class="segmented small" role="group" aria-label="加入方式"><button type="button" data-soc-act="create-policy" data-value="open" aria-pressed="true">直接加入</button><button type="button" data-soc-act="create-policy" data-value="apply" aria-pressed="false">需要申请</button></div></div><p class="field-error" role="alert" hidden></p><div class="dialog-actions"><button type="button" class="button" data-soc-act="modal-close">取消</button><button type="submit" class="button primary">建小组</button></div></form>`);
}

function submitGroup(form) {
  const data = new FormData(form), st = store();
  const name = String(data.get('name') || '').trim(), slug = String(data.get('slug') || '').trim(), category = String(data.get('category') || 'community');
  const err = form.querySelector('.field-error');
  const fail = msg => { err.textContent = msg; err.hidden = false; };
  if (!name) return fail('组名不能为空');
  if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(slug)) return fail('地址只用小写字母、数字和短横线，2 到 40 位');
  if (groupMap()[slug]) return fail('这个地址已经有小组了');
  const policy = form.querySelector('[data-soc-act="create-policy"][aria-pressed="true"]')?.dataset.value === 'apply' ? 'apply' : 'open';
  if (isLive()) {
    const payload = { slug, name, category, intro: String(data.get('intro') || '').trim().slice(0, 80) || null, join_policy: policy };
    const submit = form.querySelector('[type="submit"]'); if (submit) submit.disabled = true;
    window.CommonsAPI.post('/social/groups', payload, { idempotencyKey: window.CommonsAPI.newIdempotencyKey() }).then(() => {
      C().closeModal(); toast(`「${name}」建好了`); C().go(`group/${slug}`);
    }, error => { if (submit) submit.disabled = false; fail(errText(error, '建小组没有完成')); });
    return;
  }
  const covers = { tech: 'assets/illus/cover-components.webp', career: 'assets/illus/cover-product-forms.webp', industry: 'assets/illus/cover-questions.webp', community: 'assets/illus/cover-agent-plaza.webp' };
  st.created.push({ slug, name, category, intro: String(data.get('intro') || '').trim().slice(0, 80) || '刚建好的小组。', cover: covers[category] || covers.community, policy, members: 1, today: 0, me: 'active', role: 'owner', admins: [viewerId()] });
  st.groups[slug] = 'active';
  save();
  C().closeModal();
  toast(`「${name}」建好了`);
  C().go(`group/${slug}`);
}

// —— 事件处理 ——
function onClick(e) {
  clickEl = e.target && e.target.closest ? e.target.closest('[data-soc-act]') : null;
  try { handleClick(e); } finally { clickEl = null; }
}

function handleClick(e) {
  if (menu && !menu.el.contains(e.target) && !menu.button.contains(e.target)) closeMenu(false);
  if (picker && !picker.wrap.contains(e.target)) closePicker(false);
  const el = e.target.closest('[data-soc-act]');
  if (!el || el.disabled) return;
  const act = el.dataset.socAct, id = el.dataset.id || '', value = el.dataset.value || '';
  const art = el.closest('[data-soc-post]');
  const form = el.closest('[data-soc-form="compose"]');
  if (el.tagName === 'A' && act !== 'friends-tab') return;
  if (act === 'friends-tab') { ui.friendsTab = value; if (el.tagName === 'A' && !document.querySelector('[data-soc-root="friends"]')) return; e.preventDefault(); }
  const st = store();
  switch (act) {
    case 'live-retry': loadLive(true); return;
    case 'react':
      if (pressFired) { pressFired = false; return; }
      closePicker(false);
      setReaction(id, reactionsOf(postById(id)).mine ? null : 'up');
      return;
    case 'pick': {
      const btn = setReaction(id, value);
      closePicker(false);
      btn?.focus({ preventScroll: true });
      return;
    }
    case 'reactors': showReactors(id); return;
    case 'comments': if (art) openComments(art, art.dataset.socPost, el); return;
    case 'share':
      if (el.getAttribute('aria-disabled') === 'true') { toast('只给特定的人看的动态不能转发'); return; }
      if (art) shareBox(art, art.dataset.socPost); return;
    case 'share-scope': el.parentElement.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === el))); return;
    case 'share-cancel': if (art) shareBox(art, id); return;
    case 'share-send': {
      const box = el.closest('[data-soc-sharebox]'), orig = postById(id);
      if (!box || !orig) return;
      const root = orig.shareOf ? postById(orig.shareOf) || orig : orig;
      const scope = box.querySelector('[data-soc-act="share-scope"][aria-pressed="true"]')?.dataset.value === 'friends' ? 'friends' : 'members';
      const note = box.querySelector('textarea').value.trim().slice(0, 500);
      if (isLive()) {
        finishLive(apiWrite('POST', `/social/posts/${encodeURIComponent(root.id)}/shares`, { note: note || null, scope }), '已转发');
        return;
      }
      const now = Date.now();
      st.posts.unshift({ id: `local-${now.toString(36)}`, author: viewerId(), createdAt: new Date(now).toISOString(), scope, body: note, shareOf: root.id, reactions: {}, shares: 0, comments: [] });
      st.shares[root.id] = (Number(st.shares[root.id]) || 0) + 1;
      save();
      toast('已转发');
      rerender();
      return;
    }
    case 'expand': {
      const body = el.previousElementSibling;
      const open = body.classList.toggle('is-open');
      el.textContent = open ? '收起' : '展开';
      el.setAttribute('aria-expanded', String(open));
      return;
    }
    case 'menu': { const p = postById(id); if (menu && menu.button === el) closeMenu(); else if (p) openMenu(el, postMenuItems(p)); return; }
    case 'person-menu': if (menu && menu.button === el) closeMenu(); else openMenu(el, personMenuItems(id)); return;
    case 'scope-menu': if (menu && menu.button === el) closeMenu(); else if (form) openMenu(el, scopeMenuItems(form)); return;
    case 'scope': case 'scope-group': {
      const f = menu && menu.button.closest('[data-soc-form="compose"]');
      if (!f) return;
      const d = draftOf(f.dataset.ctx);
      d.scope = act === 'scope' ? value : 'group';
      d.group = act === 'scope-group' ? value : '';
      if (act === 'scope') {
        if (isLive()) finishLive(apiWrite('PUT', '/social/me/prefs', { default_scope: value }), '');
        else { st.defaultScope = value; save(); }
      }
      closeMenu(false);
      refreshComposer(f, '.soc-scope');
      return;
    }
    case 'dismiss-sys': if (!st.sysHidden.includes(id)) st.sysHidden.push(id); save(); el.closest('[data-soc-sys]')?.remove(); toast('这类卡片先不显示了'); return;
    case 'more': ui.feedLimit += 8; el.closest('[data-soc-stream]').dataset.limit = String(ui.feedLimit); refreshStream(el.closest('[data-soc-stream]')); return;
    case 'show-new': {
      session.incomingDone = true;
      session.arrived = SAMPLE().incoming.map((p, i) => Object.assign({}, p, { createdAt: new Date(Date.now() - i * 1000).toISOString() }));
      document.querySelectorAll('[data-soc-newbar]').forEach(b => { b.hidden = true; });
      rerender();
      const top = document.querySelector('#main [data-soc-stream]');
      top?.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
      top?.querySelector('[data-soc-post]')?.classList.add('is-fresh');
      return;
    }
    case 'vote': {
      const p = postById(id);
      if (!p || !p.poll) return;
      const v = pollOf(p);
      if (v.mine !== null || v.closed) return;
      if (isLive()) { finishLive(apiWrite('PUT', `/social/posts/${encodeURIComponent(id)}/vote`, { option: Number(value) }), '已投票'); return; }
      st.votes[id] = Number(value);
      save();
      const box = document.querySelector(`[data-soc-poll="${CSS.escape(id)}"]`);
      if (box) box.outerHTML = pollHTML(postById(id));
      toast('已投票');
      return;
    }
    case 'tool': {
      if (!form) return;
      const d = draftOf(form.dataset.ctx);
      if (value === 'image') { form.querySelector('[data-soc-file]').click(); return; }
      if (value === 'quote') { C().modal('引用一张卡片', quotePicker(form.dataset.ctx)); return; }
      d.panel = d.panel === value ? '' : value;
      d.error = '';
      refreshComposer(form, d.panel === 'link' ? '[data-soc-input="link-url"]' : d.panel === 'poll' ? '[data-soc-input="poll-option"]' : `[data-soc-act="tool"][data-value="${value}"]`);
      return;
    }
    case 'quote-pick': {
      const q = SAMPLE().quotables[Number(value)];
      const d = draftOf(id);
      if (q) d.quote = Object.assign({}, q);
      C().closeModal();
      const f = document.querySelector(`[data-soc-form="compose"][data-ctx="${CSS.escape(id)}"]`);
      if (f) refreshComposer(f, 'textarea');
      return;
    }
    case 'img-remove': if (form) { draftOf(form.dataset.ctx).images.splice(Number(value), 1); refreshComposer(form, 'textarea'); } return;
    case 'link-remove': if (form) { draftOf(form.dataset.ctx).link = null; refreshComposer(form, 'textarea'); } return;
    case 'quote-remove': if (form) { draftOf(form.dataset.ctx).quote = null; refreshComposer(form, 'textarea'); } return;
    case 'link-add': {
      if (!form) return;
      const d = draftOf(form.dataset.ctx);
      let url;
      try { url = new URL(d.linkUrl.trim()); } catch { url = null; }
      if (!url || !/^https?:$/.test(url.protocol) || url.username || url.password) { d.error = '链接只收 http 或 https 地址'; refreshComposer(form, '[data-soc-input="link-url"]'); return; }
      d.link = { url: url.href, title: d.linkTitle.trim().slice(0, 120) || url.hostname, domain: url.hostname };
      d.panel = ''; d.linkUrl = ''; d.linkTitle = ''; d.error = '';
      refreshComposer(form, 'textarea');
      return;
    }
    case 'poll-add': if (form) { const d = draftOf(form.dataset.ctx); if (d.poll.options.length < 4) d.poll.options.push(''); refreshComposer(form, `[data-soc-input="poll-option"][data-value="${d.poll.options.length - 1}"]`); } return;
    case 'poll-remove': if (form) { draftOf(form.dataset.ctx).poll.options.splice(Number(value), 1); refreshComposer(form, '[data-soc-act="poll-add"]'); } return;
    case 'poll-days': if (form) { draftOf(form.dataset.ctx).poll.days = Number(value); refreshComposer(form, `[data-soc-act="poll-days"][data-value="${value}"]`); } return;
    case 'feed-tab': ui.feedTab = value; ui.feedLimit = 8; if (isLive()) loadLive(true); else rerender(); return;
    case 'friends-tab': ui.friendsTab = value; ui.friendsQ = ''; if (isLive()) loadLive(true); else rerender(); return;
    case 'suggest-tab': ui.friendsTab = 'suggest'; if (isLive()) loadLive(true); else rerender(); return;
    case 'groups-filter': ui.groupsFilter = value; rerender(); return;
    case 'group-tab': ui.groupTab[id] = value; if (isLive() && (value === 'talk' || value === 'featured' || value === 'members')) loadLive(true); else rerender(); return;
    case 'follow': setFollow(id, true); return;
    case 'unfollow': closeMenu(false); setFollow(id, false); return;
    case 'star': {
      const on = !rel().starred.has(id), p = personOf(id); closeMenu(false);
      if (isLive()) finishLive(apiWrite(on ? 'PUT' : 'DELETE', `/social/stars/${encodeURIComponent(p.handle || id)}`), on ? `已特别关注 ${p.name}` : '已取消特别关注');
      else { st.star[id] = on; save(); toast(on ? `已特别关注 ${p.name}，TA 的动态会带星标` : '已取消特别关注'); rerender(); }
      return;
    }
    case 'mute': case 'unmute': {
      const on = act === 'mute', p = personOf(id); closeMenu(false);
      if (isLive()) finishLive(apiWrite(on ? 'PUT' : 'DELETE', `/social/mutes/${encodeURIComponent(p.handle || id)}`), on ? `已静音 ${p.name}` : '已取消静音');
      else { st.mute[id] = on; save(); toast(on ? `已静音 ${p.name}，TA 的动态不再出现在列表里` : '已取消静音'); rerender(); }
      return;
    }
    case 'block': closeMenu(false); confirmBlock(id); return;
    case 'block-confirm': {
      const p = personOf(id); C().closeModal();
      if (isLive()) finishLive(apiWrite('PUT', `/social/blocks/${encodeURIComponent(p.handle || id)}`), `已拉黑 ${p.name}`);
      else { st.block[id] = true; st.follow[id] = false; st.star[id] = false; st.lost[id] = true; save(); toast(`已拉黑 ${p.name}`); rerender(); }
      return;
    }
    case 'unblock': {
      const p = personOf(id);
      if (isLive()) finishLive(apiWrite('DELETE', `/social/blocks/${encodeURIComponent(p.handle || id)}`), '已解除拉黑，之前的关注不会恢复');
      else { st.block[id] = false; save(); toast('已解除拉黑，之前的关注不会恢复'); rerender(); }
      return;
    }
    case 'modal-close': C().closeModal(); return;
    case 'poke': poke(id); return;
    case 'dm':
      if (isLive() && window.CommonsDM?.open) {
        el.disabled = true;
        const reopen = () => { if (el.isConnected) el.disabled = false; };
        Promise.resolve().then(() => window.CommonsDM.open({ with: id, name: personOf(id).name })).then(reopen, error => { reopen(); toast(errText(error, '私信没能打开')); });
        return;
      }
      if (window.CommonsDM?.open) window.CommonsDM.open({ with: id, name: personOf(id).name }); else toast('私信还没有开通'); return;
    case 'greet':
      if (isLive()) {
        if (!canDo('social.bless')) { toast(whyNot('social.bless') || '现在还不能送祝福'); return; }
        const p = personOf(id);
        finishLive(apiWrite('POST', `/social/blessings/${encodeURIComponent(p.handle || id)}`, {}, true), `已给 ${p.name} 送上祝福`);
        return;
      }
      st.greeted[id] = today(); save(); toast(`已给 ${personOf(id).name} 送上祝福`); el.disabled = true; el.textContent = '已送祝福'; return;
    case 'suggest-toggle': {
      const off = isLive() ? SAMPLE().prefs?.suggestions === false : st.suggestionsOff;
      if (isLive()) finishLive(apiWrite('PUT', '/social/me/prefs', { suggestions: off }), off ? '已开启推荐' : '已关闭推荐');
      else { st.suggestionsOff = !st.suggestionsOff; save(); toast(st.suggestionsOff ? '已关闭推荐，你也不会被推荐给别人' : '已开启推荐'); rerender(); }
      return;
    }
    case 'suggest-dismiss': {
      if (isLive()) {
        const person = personOf(id);
        finishLive(apiWrite('POST', `/social/suggestions/${encodeURIComponent(person.handle || id)}/dismiss`, {}, true), '以后不再推荐 TA，可在下方恢复')
          .then(result => { if (result !== null) { mergeDismissed({ items: [person], cursor: live.data.dismissedCursor }); rerender(); } return result; });
        return;
      }
      if (!st.dismissed.includes(id)) st.dismissed.push(id); save(); rerender(); return;
    }
    case 'suggest-restore': {
      if (!isLive()) return;
      const person = dismissedPeople().find(p => p.id === id) || personOf(id);
      finishLive(apiWrite('DELETE', `/social/suggestions/${encodeURIComponent(person.handle || id)}/dismiss`, {}, true), '已恢复推荐')
        .then(result => { if (result !== null) { removeDismissed(id); rerender(); } return result; });
      return;
    }
    case 'suggest-dismissed-more': loadDismissedMore(); return;
    case 'post-delete': closeMenu(false); C().modal('删除这条动态？', `<div class="soc-confirm" data-soc-root="confirm"><p>删除后，转发里也只会显示「原动态已不可见」。</p><div class="dialog-actions"><button type="button" class="button" data-soc-act="modal-close">取消</button><button type="button" class="button danger" data-soc-act="post-delete-confirm" data-id="${esc(id)}">删除</button></div></div>`); return;
    case 'post-delete-confirm': C().closeModal(); if (isLive()) finishLive(apiWrite('DELETE', `/social/posts/${encodeURIComponent(id)}`), '已删除'); else { if (!st.deleted.includes(id)) st.deleted.push(id); save(); toast('已删除'); rerender(); } return;
    case 'post-hide': closeMenu(false); if (isLive()) finishLive(apiWrite('DELETE', `/social/posts/${encodeURIComponent(id)}`), '已从小组移出'); else { if (!st.deleted.includes(id)) st.deleted.push(id); save(); toast('已从小组移出'); rerender(); } return;
    case 'post-pin': case 'post-feature': {
      const p = postById(id), g = p && groupMap()[p.group];
      if (!g || !isAdmin(g)) return;
      const pins = pinsOf(g), k = act === 'post-pin' ? 'pin' : 'featured';
      const has = pins[k].includes(id);
      if (!has && k === 'pin' && pins.pin.length >= PIN_MAX) { closeMenu(false); toast(`最多置顶 ${PIN_MAX} 条`); return; }
      if (isLive()) { closeMenu(false); finishLive(apiWrite(has ? 'DELETE' : 'PUT', `/social/groups/${encodeURIComponent(g.slug)}/pins/${encodeURIComponent(id)}?kind=${encodeURIComponent(k)}`), k === 'pin' ? (has ? '已取消置顶' : '已置顶') : (has ? '已移出精华' : '已加入精华')); return; }
      pins[k] = has ? pins[k].filter(x => x !== id) : [id, ...pins[k]];
      st.pins[g.slug] = pins;
      save(); closeMenu(false);
      toast(k === 'pin' ? (has ? '已取消置顶' : '已置顶') : (has ? '已移出精华' : '已加入精华'));
      rerender();
      return;
    }
    case 'group-join': joinGroup(id, 'active'); return;
    case 'group-cancel': joinGroup(id, 'none'); return;
    case 'group-leave': {
      const g = groupMap()[id];
      if (g && g.role === 'owner') { toast('先把组长交给别人再退出'); return; }
      C().modal(`退出「${g ? g.name : ''}」？`, `<div class="soc-confirm" data-soc-root="confirm"><p>退出后看不到只给成员的讨论，随时可以再加入。</p><div class="dialog-actions"><button type="button" class="button" data-soc-act="modal-close">取消</button><button type="button" class="button danger" data-soc-act="group-leave-confirm" data-id="${esc(id)}">退出小组</button></div></div>`);
      return;
    }
    case 'group-leave-confirm': C().closeModal(); joinGroup(id, 'none'); return;
    case 'group-apply': {
      const g = groupMap()[id];
      C().modal(`申请加入「${g ? g.name : ''}」`, `<form class="soc-apply" data-soc-form="join-apply" data-soc-root="apply" data-id="${esc(id)}"><div class="field"><label for="soc-apply-note">想在组里做什么（可不填）</label><textarea id="soc-apply-note" name="note" maxlength="140" rows="3"></textarea><small>管理员会看到这句话</small></div><div class="dialog-actions"><button type="button" class="button" data-soc-act="modal-close">取消</button><button type="submit" class="button primary">提交申请</button></div></form>`);
      return;
    }
    case 'review-approve': case 'review-reject': {
      if (isLive()) {
        const p = personOf(value), decision = act === 'review-approve' ? 'approve' : 'reject';
        finishLive(apiWrite('POST', `/social/groups/${encodeURIComponent(id)}/requests/${encodeURIComponent(p.handle || value)}/${decision}`, {}), act === 'review-approve' ? `已通过 ${p.name} 的申请` : '已拒绝');
        return;
      }
      const r = objOf(st.reviewed[id]);
      r[value] = act === 'review-approve' ? 'approved' : 'rejected';
      st.reviewed[id] = r;
      save();
      toast(act === 'review-approve' ? `已通过 ${personOf(value).name} 的申请` : '已拒绝');
      rerender();
      return;
    }
    case 'group-create': createGroupForm(); return;
    case 'create-policy': el.parentElement.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === el))); return;
    default:
  }
}

function onSubmit(e) {
  const form = e.target.closest('[data-soc-form]');
  if (!form) return;
  e.preventDefault();
  const kind = form.dataset.socForm;
  if (kind === 'compose') publish(form);
  else if (kind === 'group-create') submitGroup(form);
  else if (kind === 'join-apply') { const note = String(new FormData(form).get('note') || '').trim().slice(0, 140); C().closeModal(); joinGroup(form.dataset.id, 'pending', note); if (note && !isLive()) toast('申请已提交，理由会给管理员看'); }
}

function onInput(e) {
  const el = e.target.closest('[data-soc-input]');
  if (!el) return;
  const kind = el.dataset.socInput, form = el.closest('[data-soc-form="compose"]');
  if (kind === 'friend-q') {
    ui.friendsQ = el.value;
    const q = el.value.trim();
    document.querySelectorAll('[data-soc-friends] .soc-person').forEach(row => { row.hidden = !!q && !row.dataset.name.includes(q); });
    return;
  }
  if (!form) return;
  const d = draftOf(form.dataset.ctx);
  if (kind === 'body') {
    d.body = el.value.slice(0, BODY_MAX);
    C().write(`social.draft.${form.dataset.ctx}`, { body: d.body });
    form.classList.add('is-open');
    grow(el);
    if (d.error) { d.error = ''; const er = form.querySelector('.soc-composer-error'); if (er) er.hidden = true; }
  } else if (kind === 'link-url') d.linkUrl = el.value;
  else if (kind === 'link-title') d.linkTitle = el.value;
  else if (kind === 'poll-option') d.poll.options[Number(el.dataset.value)] = el.value.slice(0, 40);
}

function onChange(e) {
  const input = e.target.closest('[data-soc-file]');
  if (!input) return;
  const form = input.closest('[data-soc-form="compose"]');
  if (form && input.files && input.files.length) readImages(form, input.files);
  input.value = '';
}

function onFocusIn(e) {
  const ta = e.target.closest('[data-soc-form="compose"] textarea');
  if (ta) { ta.closest('form').classList.add('is-open'); grow(ta); }
}

function moveFocus(container, delta, home) {
  const items = [...container.querySelectorAll('button:not([disabled])')];
  if (!items.length) return;
  const i = items.indexOf(document.activeElement);
  const next = home === 'first' ? 0 : home === 'last' ? items.length - 1 : (i + delta + items.length) % items.length;
  items[next].focus({ preventScroll: true });
}

function onKey(e) {
  if (e.key === 'Escape') {
    if (picker) { e.preventDefault(); closePicker(); return; }
    if (menu) { e.preventDefault(); closeMenu(); return; }
    return;
  }
  const react = e.target.closest && e.target.closest('[data-soc-act="react"]');
  if (react && e.key === 'ArrowUp') { e.preventDefault(); openPicker(react, true); return; }
  if (picker && picker.el.contains(e.target)) {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); moveFocus(picker.el, 1); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); moveFocus(picker.el, -1); }
    else if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); moveFocus(picker.el, 0, e.key === 'Home' ? 'first' : 'last'); }
    else if (e.key === 'Tab') closePicker(false);
    return;
  }
  if (menu && menu.el.contains(e.target)) {
    if (e.key === 'ArrowDown') { e.preventDefault(); moveFocus(menu.el, 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveFocus(menu.el, -1); }
    else if (e.key === 'Tab') closeMenu(false);
    return;
  }
  const tab = e.target.closest && e.target.closest('.soc-tabs [role="tab"]');
  if (tab && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
    e.preventDefault();
    const tabs = [...tab.parentElement.querySelectorAll('[role="tab"]')];
    const next = tabs[(tabs.indexOf(tab) + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
    next.focus(); next.click();
  }
}

function onOver(e) {
  const wrap = e.target.closest && e.target.closest('.soc-react-wrap');
  if (!wrap) return;
  if (picker && picker.wrap === wrap) { cancel(closeTimer); closeTimer = 0; }
  const btn = e.target.closest('[data-soc-act="react"]');
  if (btn && e.pointerType === 'mouse' && !(picker && picker.button === btn)) {
    cancel(hoverTimer);
    hoverTimer = later(() => { if (btn.isConnected && btn.matches(':hover')) openPicker(btn, false); }, 350);
  }
}
function onOut(e) {
  const wrap = e.target.closest && e.target.closest('.soc-react-wrap');
  if (!wrap || wrap.contains(e.relatedTarget)) return;
  cancel(hoverTimer); hoverTimer = 0;
  if (picker && picker.wrap === wrap && e.pointerType === 'mouse') { cancel(closeTimer); closeTimer = later(() => closePicker(false), 300); }
}
function onDown(e) {
  const btn = e.target.closest && e.target.closest('[data-soc-act="react"]');
  if (!btn || e.pointerType === 'mouse') return;
  pressFired = false;
  cancel(pressTimer);
  pressTimer = later(() => { pressFired = true; openPicker(btn, false); }, 450);
}
function onUp() { cancel(pressTimer); pressTimer = 0; }
function onContext(e) { if (e.target.closest && e.target.closest('[data-soc-act="react"], .soc-picker')) e.preventDefault(); }

function grow(ta) {
  ta.style.height = 'auto';
  ta.style.height = `${Math.min(ta.scrollHeight, 320)}px`;
}
function autosize() { document.querySelectorAll('#main [data-soc-form="compose"].is-open textarea').forEach(grow); }

function showIncoming() {
  if (session.incomingDone || !SAMPLE().incoming.length) return;
  session.incomingReady = true;
  document.querySelectorAll('#main [data-soc-newbar]').forEach(b => { b.hidden = false; b.classList.add('is-in'); });
}

let linksProvided = false;
function provideLinks() {
  if (linksProvided || !window.CommonsLinks?.provide) return;
  window.CommonsLinks.provide('feed', handle => {
    const person = SAMPLE().people.find(p => p.handle === handle || p.id === handle);
    if (!person) return null;
    const count = allPosts().filter(post => post.author === person.id).length;
    return { label: '动态', href: `#/feed?author=${encodeURIComponent(handle)}`, count, icon: 'rss' };
  });
  window.CommonsLinks.provide('group', handle => {
    const person = SAMPLE().people.find(p => p.handle === handle || p.id === handle);
    if (!person) return null;
    const count = groupList().filter(group => (
      (group.me === 'active' && person.id === viewerId())
      || arrOf(group.admins).includes(person.id)
      || arrOf(group.memberIds).includes(person.id)
    )).length;
    return { label: '小组', href: '#/groups', count, icon: 'people' };
  });
  linksProvided = true;
}

function mount() {
  if (!document.querySelector('#main [data-soc-root]')) return;
  provideLinks();
  if (!bound) {
    document.addEventListener('click', onClick);
    document.addEventListener('submit', onSubmit);
    document.addEventListener('input', onInput);
    document.addEventListener('change', onChange);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerover', onOver);
    document.addEventListener('pointerout', onOut);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
    document.addEventListener('contextmenu', onContext);
    bound = true;
  }
  if (isLive()) loadLive();
  autosize();
  const home = document.querySelector('#main [data-soc-root="home"]');
  if (home) {
    queueMicrotask(() => {
      const slot = document.querySelector('#main .home-digest-slot');
      const host = home.querySelector('[data-digest-host]');
      if (!slot || !host) return;
      if (!host.childElementCount) host.append(...slot.childNodes);
      slot.remove();
    });
  }
  if (!session.incomingDone && !session.incomingReady && document.querySelector('#main [data-soc-stream][data-source="feed"], #main [data-soc-stream][data-source="home"]')) later(showIncoming, 6000);
}

function destroy() {
  live.request += 1;
  timers.forEach(t => clearTimeout(t));
  timers.clear();
  hoverTimer = closeTimer = pressTimer = 0;
  pressFired = false;
  menu = null; picker = null;
  if (!bound) return;
  document.removeEventListener('click', onClick);
  document.removeEventListener('submit', onSubmit);
  document.removeEventListener('input', onInput);
  document.removeEventListener('change', onChange);
  document.removeEventListener('focusin', onFocusIn);
  document.removeEventListener('keydown', onKey);
  document.removeEventListener('pointerover', onOver);
  document.removeEventListener('pointerout', onOut);
  document.removeEventListener('pointerdown', onDown);
  document.removeEventListener('pointerup', onUp);
  document.removeEventListener('pointercancel', onUp);
  document.removeEventListener('contextmenu', onContext);
  bound = false;
}

window.CommonsSocial = {
  routes: { feed: () => shell('feed'), groups: () => shell('groups'), group: () => shell('group'), friends: () => shell('friends') },
  hub: ['feed', 'groups', 'friends'],
  nav: [['feed', '动态流', 'feed', 'social'], ['groups', '小组与板块', 'groups', 'social'], ['friends', '好友与关注', 'friends', 'social']],
  icons: { feed: PATHS.feed, groups: PATHS.groups, friends: PATHS.friends },
  titles: { group: '小组' },
  aliases: { group: 'groups' },
  mount,
  destroy,
  wall,
  composer,
  stream,
  newbar,
  avatar,
  icon,
  viewer,
  person: personOf,
  groups: groupList,
  relations: rel,
  suggestions: suggestionsList,
  data: SAMPLE,
  live: isLive,
  greeted: id => isLive() ? arrOf(SAMPLE().blessed).includes(id) : store().greeted[id] === today()
};
(window.CommonsPages = window.CommonsPages || []).push(window.CommonsSocial);
})();
