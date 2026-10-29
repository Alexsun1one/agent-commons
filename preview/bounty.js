(() => {
  'use strict';

  /* R13 BOUNTY-1 · 悬赏广场、悬赏详情、我的积分、发布弹层，外加给其他模块用的 window.CommonsBounty.badge()。
     示例模式读 bounty-sample.js，改动只存本机；live 模式只读写 /api/bounty/*，出错显示出错态，不退回示例。
     奖励只有积分、外观和发起人自备的权益；现金和实物不开放。自行登记 window.CommonsPages。 */

  const KINDS = [['help', '求助悬赏'], ['promo', '推广试用']];
  const STATUS = [['active', '进行中'], ['judging', '待评选'], ['closed', '已结束']];
  const FILTER_KINDS = [['all', '全部'], ...KINDS];
  const FILTER_STATUS = [['all', '全部'], ...STATUS];
  const SETTLE = {
    owner: '发起人已采纳',
    auto: '到期自动发给「有用」最多的回答',
    no_qualified: '没有合格回答，已全额退回',
    hidden: '原帖被隐藏，没发出的已退回',
    withdrawn: '原帖已撤回，没发出的已退回',
    expired: '推广到期，剩余预算已退回'
  };
  const TASK_KIND = { feedback: '试用后提问题', bug: '报 bug', review: '写体验', recording: '录使用过程' };
  const REJECT = [['low_effort', '内容太少，看不出试用过'], ['off_topic', '和任务无关'], ['duplicate', '和别人的提交重复'],
    ['not_reproducible', '按步骤复现不出来'], ['other', '其他原因']];
  const DISPUTE = [['not_received', '没有收到'], ['not_as_promised', '和承诺的不一样'], ['other', '其他原因']];
  const SUB_STATUS = { pending: '待验收', accepted: '已验收', rejected: '已退回', expired: '已过期' };
  const PROMISE_STATUS = { owed: '等你确认', confirmed: '已确认收到', disputed: '已申诉，治理员会看' };
  const DAYS = [1, 3, 7, 14];
  const STORE = 'bounty.demo.v1';
  const NAV_ICON = 'M12 2.6 20.1 7.3v9.4L12 21.4 3.9 16.7V7.3zM12 8.2l2.9 3.8-2.9 3.8-2.9-3.8z';

  const nf = typeof Intl === 'object' && Intl.NumberFormat ? new Intl.NumberFormat('zh-CN') : null;

  const state = {
    root: null,
    unbind: [],
    view: 'square',
    id: '',
    kind: 'all',
    status: 'all',
    data: null,
    live: { key: '', data: null, error: null },
    picks: [],
    perspective: 'auto',
    openEntry: '',
    pub: { kind: 'help', days: 7 }
  };

  /* ---------- 小工具 ---------- */

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* safe-fn: CommonsLinks.person 按接口约定转义；本地退路对名字 esc、handle encodeURIComponent。 */
  function personLink(handle, name, level) {
    if (window.CommonsLinks && typeof window.CommonsLinks.person === 'function') return window.CommonsLinks.person(handle, name, { level: level });
    return handle ? `<a class="lk-person" href="#/u/${encodeURIComponent(handle)}">${esc(name)}</a>` : esc(name);
  }

  /* safe-fn: CommonsLinks.a 按接口约定转义；本地只拼本模块 bounty 路由，其余退为 esc 纯文字。 */
  function objectLink(kind, id, label, cls) {
    if (window.CommonsLinks && typeof window.CommonsLinks.a === 'function') return window.CommonsLinks.a(kind, id, label, cls);
    if (kind !== 'bounty' || !id) return esc(label);
    return `<a${cls ? ` class="${esc(cls)}"` : ''} href="#/bounties/${encodeURIComponent(id)}">${esc(label)}</a>`;
  }

  function fmt(n) {
    const x = Number(n) || 0;
    return nf ? nf.format(x) : String(x);
  }

  function clone(v) {
    return JSON.parse(JSON.stringify(v));
  }

  function read(key, fallback) {
    const C = window.Commons;
    return C && typeof C.read === 'function' ? C.read(key, fallback) : fallback;
  }

  function write(key, value) {
    const C = window.Commons;
    if (C && typeof C.write === 'function') C.write(key, value);
  }

  function toast(message) {
    const C = window.Commons;
    if (C && typeof C.toast === 'function') C.toast(message);
  }

  function modal(title, html) {
    const C = window.Commons;
    if (C && typeof C.modal === 'function') {
      C.modal(title, html);
      return true;
    }
    toast('打不开对话框，接线后才能演示。');
    return false;
  }

  function closeModal() {
    const C = window.Commons;
    if (C && typeof C.closeModal === 'function') C.closeModal();
  }

  function api() {
    return window.CommonsAPI;
  }

  function isLive() {
    const a = api();
    return !!(a && a.mode === 'live');
  }

  function canDo(action) {
    const S = window.CommonsSession;
    if (!S || typeof S.can !== 'function') return true;
    return !!S.can(action);
  }
  function canPublishHelp() { return !isLive() || canDo('bounty.create.help'); }
  function canPublishPromo() { return !isLive() || canDo('bounty.create.promo'); }
  function canPublishAny() { return canPublishHelp() || canPublishPromo(); }
  function canPublishKind(kind) { return kind === 'promo' ? canPublishPromo() : canPublishHelp(); }
  function canTopup() { return !isLive() || canDo('bounty.topup'); }
  function firstPublishKind(preferred) {
    if (!isLive()) return preferred === 'promo' ? 'promo' : 'help';
    if (preferred === 'promo' && canPublishPromo()) return 'promo';
    if (canPublishHelp()) return 'help';
    if (canPublishPromo()) return 'promo';
    return 'help';
  }
  // /api/me.capability_reasons 给的原因；没有就返回空串，调用方退回原来的说法。
  function whyNot(action) {
    const S = window.CommonsSession;
    return S && typeof S.reason === 'function' ? S.reason(action) : '';
  }
  function whyTitle(action) {
    const why = whyNot(action);
    return why ? ` title="${esc(why)}"` : '';
  }
  function gateNote(slot, action, fallback) {
    const why = whyNot(action);
    const text = why ? esc(why) + (/^需要 L/.test(why) ? '，<a href="#/growth">看看怎么升级</a>' : '') : esc(fallback) + '，<a href="#/growth">看看怎么升级</a>';
    return `<p class="bty-gate" role="note" data-bty-locked="${esc(slot)}">${text}</p>`;
  }
  const gatePublish = () => gateNote('publish', 'bounty.create.help', '你现在的等级还不能发悬赏');
  const gatePromo = () => gateNote('promo', 'bounty.create.promo', '你现在的等级还不能发推广');
  const gateTopup = () => gateNote('topup', 'bounty.topup', '你现在的等级还不能追加赏金');
  function publishButton(cls) {
    const extra = cls === 'tonal' ? ' tonal' : ' primary';
    const allowed = canPublishAny();
    return `<button type="button" class="button${extra}" data-bty-act="publish"${allowed ? '' : ' disabled' + whyTitle('bounty.create.help')}>发布悬赏</button>` +
      (allowed ? '' : gatePublish());
  }

  function sample() {
    return window.COMMONS_BOUNTY_SAMPLE || null;
  }

  function demo() {
    if (state.data) return state.data;
    const saved = read(STORE, null);
    const s = sample();
    state.data = saved && saved.version === 1 && Array.isArray(saved.bounties) ? saved : (s ? Object.assign({ version: 1 }, clone(s)) : null);
    return state.data;
  }

  function save() {
    if (state.data) write(STORE, state.data);
  }

  function nowMs() {
    const d = !isLive() && demo();
    const t = d ? Date.parse(d.now) : NaN;
    return Number.isFinite(t) ? t : Date.now();
  }

  function md(iso) {
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return '';
    const p = n => String(n).padStart(2, '0');
    return p(d.getMonth() + 1) + '.' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function secondsTo(iso) {
    const t = Date.parse(iso);
    return Number.isFinite(t) ? Math.max(0, Math.floor((t - nowMs()) / 1000)) : 0;
  }

  function span(seconds) {
    const s = Math.max(0, Math.floor(Number(seconds) || 0));
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    if (d) return d + ' 天' + (h ? ' ' + h + ' 小时' : '');
    if (h) return h + ' 小时';
    return Math.max(1, Math.floor(s / 60)) + ' 分钟';
  }

  function timeLine(b) {
    if (b.status === 'active') return '剩 ' + span(secondsTo(b.deadline_at));
    if (b.status === 'judging') return '待评选 · 还有 ' + span(secondsTo(b.settle_after));
    return SETTLE[b.settle_reason] || '已结束';
  }

  function reduced() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  /* 等级门槛由服务器给（/bounty/rules 的 min_levels）；示例模式没有，沿用示例里写的 L2。 */
  function minLevelText(key) {
    if (!isLive()) return 'L2';
    const n = Number(((rules() || {}).min_levels || {})[key]);
    return n > 0 ? 'L' + n : '';
  }

  function usefulRuleText() {
    if (!isLive()) return '只算 L2 及以上、账号满 7 天的人标的「有用」';
    const m = (rules() || {}).min_levels || {};
    return m.useful_giver && m.useful_account_days
      ? '只算 L' + m.useful_giver + ' 及以上、账号满 ' + m.useful_account_days + ' 天的人标的「有用」'
      : '只算合格成员标的「有用」';
  }

  function capOf(rules, level) {
    return Number(((rules && rules.caps) || {})['L' + level]) || 0;
  }

  function newKey() {
    const a = api();
    if (a && typeof a.newIdempotencyKey === 'function') return a.newIdempotencyKey();
    return 'k' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  /* safe-fn: 返回值只由写死的路径和 Number() 尺寸拼成 */
  function coin(size, tone) {
    const n = Number(size) || 16;
    return `<svg class="bty-coin" data-tone="${tone === 'held' ? 'held' : 'live'}" viewBox="0 0 20 20" width="${n}" height="${n}" aria-hidden="true" focusable="false">` +
      '<path class="bty-coin-face" d="M10 1.9 17 5.95v8.1L10 18.1 3 14.05v-8.1z"/>' +
      '<path class="bty-coin-mark" d="M10 6.4 12.7 10 10 13.6 7.3 10z"/></svg>';
  }

  function glyph(kind) {
    const d = { back: 'M15 18l-6-6 6-6', chev: 'M6 9l6 6 6-6', x: 'M6 6l12 12M18 6 6 18', check: 'M5 12l5 5L20 7' }[kind] || '';
    return `<svg class="bty-glyph" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
  }

  /* safe-fn: CommonsAvatar.html 自行转义；兜底分支只插入 esc() 过的首字 */
  function face(person, size) {
    const p = person || {};
    const n = Number(size) || 24;
    const A = window.CommonsAvatar;
    if (A && typeof A.html === 'function') return A.html({ id: p.id, name: p.display_name, size: n, level: p.level });
    const name = String(p.display_name || '?');
    return `<span class="bty-face" style="--bty-face:${n}px" aria-hidden="true">${esc(name.slice(-1))}</span>`;
  }

  function who(person) {
    const p = person || {};
    return `<span class="bty-who">${face(p, 20)}<span>${personLink(p.handle, p.display_name || '成员', p.level)}</span><small>L${esc(p.level || '?')}</small></span>`;
  }

  function demoPill() {
    return isLive() ? '' : '<span class="pill bty-demo">示例</span>';
  }

  function screenText(text, rules) {
    const norm = String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const list = (rules && rules.promo_rules) || [];
    for (let i = 0; i < list.length; i += 1) {
      const r = list[i];
      if (!r.enabled || !r.pattern) continue;
      try {
        if (new RegExp(r.pattern, 'u').test(norm)) return r;
      } catch (err) {
        /* 规则写坏了就跳过，服务端会再判一次 */
      }
    }
    return null;
  }

  /* 按权重分整数积分，余数给小数部分最大的（同大按顺序）；权重合计 100 时与服务端 logic.split 结果一致 */
  function split(pool, weights) {
    const total = weights.reduce((a, b) => a + b, 0) || 1;
    const raw = weights.map(w => pool * w);
    const base = raw.map(r => Math.floor(r / total));
    let rest = pool - base.reduce((a, b) => a + b, 0);
    const order = weights.map((_, i) => i).sort((a, b) => (raw[b] % total) - (raw[a] % total) || a - b);
    for (let k = 0; order.length && rest > 0; k = (k + 1) % order.length, rest -= 1) base[order[k]] += 1;
    return base;
  }

  function rebalance(picks, index, value) {
    const n = picks.length;
    if (n === 1) {
      picks[0].share = 100;
      return picks;
    }
    const v = Math.max(1, Math.min(100 - (n - 1), Math.round(value)));
    const others = picks.map((p, i) => i).filter(i => i !== index);
    const left = 100 - v;
    const parts = split(left, others.map(i => picks[i].share || 1));
    picks[index].share = v;
    others.forEach((i, k) => { picks[i].share = Math.max(1, parts[k]); });
    const drift = picks.reduce((a, p) => a + p.share, 0) - 100;
    if (drift) {
      const big = others.slice().sort((a, b) => picks[b].share - picks[a].share)[0];
      picks[big].share -= drift;
    }
    return picks;
  }

  /* ---------- 数据：示例或 live ---------- */

  function rules() {
    if (isLive()) return (state.live.data && state.live.data.rules) || { caps: {}, min_levels: {}, promo_rules: [], cosmetics: [], task_kinds: [] };
    return (demo() || {}).rules || {};
  }

  function me() {
    if (isLive()) return (state.live.data && state.live.data.me) || { id: '', display_name: '我', level: 1 };
    return (demo() || {}).me || { id: 'me', display_name: '我', level: 1 };
  }

  function demoList(kind, status) {
    return ((demo() || {}).bounties || []).filter(b => (kind === 'all' || b.kind === kind) && (status === 'all' || b.status === status));
  }

  function demoBounty(id) {
    return ((demo() || {}).bounties || []).find(b => b.id === id) || null;
  }

  function counts(kind) {
    const out = {};
    FILTER_STATUS.forEach(([s]) => { out[s] = isLive() ? null : demoList(kind, s).length; });
    return out;
  }

  function liveKey() {
    if (state.view === 'square') return 'square:' + state.kind + ':' + state.status;
    if (state.view === 'detail') return 'detail:' + state.id;
    return 'wallet';
  }

  function liveGet(path, query) {
    return api().get(path, query).then(r => r.data);
  }

  function fetchLive() {
    const key = liveKey();
    if (state.live.key === key && (state.live.data || state.live.error || state.live.pending)) return;
    state.live = { key: key, data: null, error: null, pending: true };
    const settle = (data, error) => {
      if (state.live.key !== key) return;
      state.live = { key: key, data: data, error: error, pending: false };
      paint();
    };
    let job;
    if (state.view === 'square') {
      const query = { limit: 30 };
      if (state.kind !== 'all') query.kind = state.kind;
      if (state.status !== 'all') query.status = state.status;
      job = Promise.all([liveGet('/bounty/list', query), liveGet('/bounty/rules'), liveGet('/bounty/wallet')])
        .then(([list, r, wallet]) => ({ list: list, rules: r, wallet: wallet }));
    } else if (state.view === 'wallet') {
      job = Promise.all([liveGet('/bounty/wallet'), liveGet('/bounty/rules'), api().me()])
        .then(([w, r, m]) => ({ wallet: w, rules: r, me: { id: m.id, display_name: m.display_name, level: m.level } }));
    } else {
      job = Promise.all([liveGet('/bounty/' + encodeURIComponent(state.id)), liveGet('/bounty/rules'), api().me()])
        .then(([b, r, m]) => Promise.all([
          liveGet('/objects/' + encodeURIComponent(b.object.id)),
          b.kind === 'help' ? liveGet('/objects', { root_id: b.object.id, order: 'old', limit: 50 }) : Promise.resolve([])
        ]).then(([post, replies]) => {
          b.post = { body: (post.content && post.content.body) || '' };
          b.answers = (replies || []).map(x => ({ id: x.id, author: { id: x.author.id, display_name: x.author.display_name }, body: x.excerpt, created_at: x.created_at }));
          return { bounty: b, rules: r, me: { id: m.id, display_name: m.display_name, level: m.level } };
        }));
    }
    job.then(data => settle(data, null), err => settle(null, err || { message: '加载失败' }));
  }

  function invalidate() {
    state.live = { key: '', data: null, error: null };
  }

  function liveWrite(method, path, body, done) {
    const a = api();
    return a.post(path, body, { idempotencyKey: newKey() }).then(r => {
      invalidate();
      if (done) done(r.data);
      paint();
      return r.data;
    }, err => {
      toast((err && err.message) || '没有成功，原数据没有动，可以再试一次。');
      throw err;
    });
  }

  /* ---------- 片段 ---------- */

  function kindTag(b) {
    return b.kind === 'promo'
      ? '<span class="bty-tag-kind" data-kind="promo">推广</span>'
      : '<span class="bty-tag-kind" data-kind="help">求助</span>';
  }

  function statusTag(b) {
    const label = (STATUS.find(s => s[0] === b.status) || STATUS[2])[1];
    return `<span class="bty-status" data-status="${esc(b.status)}">${esc(label)}</span>`;
  }

  function extras(b) {
    let out = '';
    if (b.cosmetic) out += `<span class="bty-extra" title="外观奖励">${esc(b.cosmetic)}</span>`;
    if (b.has_perk) out += '<span class="bty-extra" title="发起人自备权益">自备权益</span>';
    return out;
  }

  function countLine(b) {
    return b.kind === 'promo'
      ? `${esc(fmt(b.task_count))} 个任务 · ${esc(fmt(b.submission_count))} 份提交`
      : `${esc(fmt(b.answer_count))} 个回答`;
  }

  function card(b, i) {
    const tags = (b.tags || []).slice(0, 3);
    return `<article class="bty-card" data-kind="${esc(b.kind)}" style="--bty-i:${Math.min(i, 7)}">` +
      `<span class="bty-card-top">${kindTag(b)}${statusTag(b)}</span>` +
      `<span class="bty-card-title">${objectLink('bounty', b.id, b.object && b.object.title, 'bty-card-link')}</span>` +
      `<span class="bty-card-reward">${coin(18)}<b>${esc(fmt(b.credits))}</b><small>${b.kind === 'promo' ? '积分预算' : '积分'}</small>${extras(b)}</span>` +
      `<span class="bty-card-meta">${who(b.owner)}<span>${countLine(b)}</span><span class="bty-card-time">${esc(timeLine(b))}</span></span>` +
      (tags.length ? `<span class="bty-tags"><span class="bty-tags-label">方向</span>${tags.map(t => `<span class="bty-tag">${esc(t)}</span>`).join('')}</span>` : '') +
      '</article>';
  }

  function head(title, lead, actions) {
    const pub = actions ? publishButton('primary') : '';
    if (title === '悬赏') return '<header class="bty-head bty-hub-toolbar">' +
      `<p>${esc(lead)}</p><div class="bty-head-actions">` +
      pub + demoPill() + '</div></header>';
    return '<header class="bty-head">' +
      `<div><div class="bty-head-title"><h1>${esc(title)}</h1>${demoPill()}</div><p>${esc(lead)}</p></div>` +
      `<div class="bty-head-actions">${pub}</div>` +
      '</header>';
  }

  function subnav(current) {
    const links = [['square', '#/bounties', '悬赏广场'], ['wallet', '#/bounties/wallet', '我的积分']];
    return `<nav class="bty-subnav" aria-label="悬赏相关页面">${links.map(([id, href, label]) =>
      id === current ? `<span aria-current="page">${esc(label)}</span>` : `<a href="${href}">${esc(label)}</a>`).join('')}</nav>`;
  }

  function loadingHTML() {
    return '<div class="bty-skeleton" aria-busy="true" aria-live="polite"><span></span><span></span><span></span><p>正在读取…</p></div>';
  }

  function closedHTML() {
    return '<div class="bty-empty" role="status"><p><b>这个功能还没开放</b></p><p>管理员还没打开。</p></div>';
  }

  function errorHTML(err) {
    const status = Number(err && err.status) || 0;
    if (status === 501 || (err && err.code === 'capability_unavailable')) return closedHTML();
    const msg = status === 404 ? '这条悬赏不存在，或者你看不到它关联的帖子。'
      : ((err && err.message) || '读取失败。');
    return `<div class="bty-error" role="alert"><p>${esc(msg)}</p><p class="bty-muted">原数据没有动。</p>` +
      (status === 404 ? '<a class="button" href="#/bounties">回悬赏广场</a>' : '<button type="button" class="button" data-bty-act="retry">重试</button>') +
      '</div>';
  }

  function emptyHTML(kind, status) {
    const tip = kind === 'promo'
      ? '推广只收实质反馈：试用后提问题、报 bug、写体验、录使用过程。'
      : '在自己的求助帖上挂积分，截止前大家都能追加。';
    const label = (STATUS.find(s => s[0] === status) || STATUS[0])[1];
    return `<div class="bty-empty"><p><b>没有${esc(label)}的${kind === 'promo' ? '推广' : '求助悬赏'}</b></p><p>${esc(tip)}</p>` +
      publishButton('tonal') + '</div>';
  }

  /* ---------- 悬赏广场 ---------- */

  function squarePage() {
    const c = counts(state.kind);
    let list = [];
    let body;
    if (isLive()) {
      if (state.live.error) body = errorHTML(state.live.error);
      else if (!state.live.data) body = loadingHTML();
      else {
        list = state.live.data.list || [];
        body = listHTML(list);
      }
    } else {
      list = demoList(state.kind, state.status);
      body = listHTML(list);
    }
    return head('悬赏', '求助挂积分，答得好就拿走。', true) +
      subnav('square') +
      '<div class="bty-toolbar">' +
      `<div class="segmented" role="group" aria-label="悬赏类型">${FILTER_KINDS.map(([id, label]) =>
        `<button type="button" data-bty-act="kind" data-id="${id}" aria-pressed="${state.kind === id}">${esc(label)}</button>`).join('')}</div>` +
      `<div class="bty-filters" role="group" aria-label="按状态筛选">${FILTER_STATUS.map(([id, label]) =>
        `<button type="button" class="chip" data-bty-act="status" data-id="${id}" aria-pressed="${state.status === id}">${esc(label)}${c[id] === null ? '' : `<span class="bty-count">${esc(c[id])}</span>`}</button>`).join('')}</div>` +
      '</div>' +
      '<div class="bty-square-layout"><div class="bty-square-main">' +
      (state.kind === 'promo' || state.kind === 'all' ? promoNote() : '') +
      /* safe: listHTML/errorHTML/loadingHTML 拼好的片段，数据都已 esc */ body + '</div>' +
      squareSidebar(list) + '</div>';
  }

  function listHTML(list) {
    if (!list.length) return emptyHTML(state.kind, state.status);
    return `<div class="bty-grid">${list.map((b, i) => card(b, i)).join('')}</div>`;
  }

  function promoNote() {
    const lvText = minLevelText('create_promo');
    return '<details class="bty-rules"><summary>推广规则</summary><p><b>只收实质反馈。</b>不得换点赞、收藏、关注、转发、投票、站外好评或刷量；' + esc(lvText ? lvText + ' 及以上' : '达到发布等级的成员') + '每周可发 1 条。</p></details>';
  }

  function squareSidebar(list) {
    const w = isLive() ? ((state.live.data || {}).wallet || {}) : ((demo() || {}).wallet || {});
    const scores = {};
    (list || []).forEach(b => {
      const id = (b.owner && b.owner.id) || 'member';
      if (!scores[id]) scores[id] = { owner: b.owner || {}, points: 0, count: 0 };
      scores[id].points += Number(b.credits) || 0;
      scores[id].count += 1;
    });
    const board = Object.values(scores).sort((a, b) => b.points - a.points).slice(0, 5);
    return '<aside class="bty-square-side">' +
      '<section class="bty-side-wallet"><header><h2>我的积分</h2><a href="#/bounties/wallet">看流水</a></header>' +
      `<div>${coin(26)}<strong>${esc(fmt(w.available))}</strong><span>可用</span></div><small>托管中 ${esc(fmt(w.held))}</small></section>` +
      '<section class="bty-week"><header><h2>本周悬赏榜</h2><span>按积分</span></header>' +
      (board.length ? '<ol>' + board.map((row, index) => `<li><b>${index + 1}</b>${who(row.owner)}<span>${esc(fmt(row.points))}</span></li>`).join('') + '</ol>' : '<p>本周还没人上榜。</p>') +
      '</section></aside>';
  }

  /* ---------- 悬赏详情 ---------- */

  function currentBounty() {
    if (isLive()) return state.live.data && state.live.data.bounty;
    return demoBounty(state.id);
  }

  function isOwner(b) {
    if (!isLive() && state.perspective !== 'auto') return state.perspective === 'owner';
    return !!b.mine;
  }

  function perspectiveBar(b) {
    if (isLive()) return '';
    const cur = state.perspective === 'auto' ? (b.mine ? 'owner' : 'member') : state.perspective;
    return '<div class="bty-perspective"><span>演示视角</span>' +
      `<div class="segmented small" role="group" aria-label="演示视角">${[['member', '参与者'], ['owner', '发起人']].map(([id, label]) =>
        `<button type="button" data-bty-act="perspective" data-id="${id}" aria-pressed="${cur === id}">${esc(label)}</button>`).join('')}</div></div>`;
  }

  function postHTML(b) {
    const tags = b.tags || [];
    return '<article class="bty-post">' +
      `<div class="bty-post-top">${kindTag(b)}${statusTag(b)}</div>` +
      `<h1>${esc(b.object && b.object.title)}</h1>` +
      `<div class="bty-post-by">${who(b.owner)}</div>` +
      (b.post && b.post.body ? `<p class="bty-post-body">${esc(b.post.body)}</p>` : '') +
      (tags.length ? `<div class="bty-tags"><span class="bty-tags-label">方向</span>${tags.map(t => `<span class="bty-tag">${esc(t)}</span>`).join('')}</div>` : '') +
      '</article>';
  }

  function barHTML(b, owner) {
    const open = b.state === 'open' && b.status !== 'closed';
    const promo = b.kind === 'promo';
    let action = '';
    if (!promo && b.status === 'active' && !owner) {
      action = `<button type="button" class="button tonal" data-bty-act="topup"${canTopup() ? '' : ' disabled' + whyTitle('bounty.topup')}>追加悬赏</button>` +
        (canTopup() ? '' : gateTopup());
    }
    if (!promo && open && owner) action = '<p class="bty-bar-hint">从下面的回答里选，最多 3 个，比例自己定。</p>';
    return `<section class="bty-bar" data-kind="${esc(b.kind)}" aria-label="${promo ? '推广预算' : '悬赏'}">` +
      `<div class="bty-bar-main">${coin(28)}<b>${esc(fmt(b.credits))}</b><span>${promo ? '积分预算' : '积分'}${open ? (promo ? ` · 托管中 ${esc(fmt(b.held))}` : ' · 托管中') : ''}</span></div>` +
      '<dl class="bty-bar-facts">' +
      (promo ? '' : `<div><dt>出资</dt><dd>${esc(fmt(b.contributors))} 人${b.my_stake ? ` · 你 ${esc(fmt(b.my_stake))}` : ''}</dd></div>`) +
      `<div><dt>${b.status === 'closed' ? '结果' : '时间'}</dt><dd>${esc(timeLine(b))}</dd></div>` +
      (b.cosmetic ? `<div><dt>外观</dt><dd>${esc(b.cosmetic)}</dd></div>` : '') +
      (b.perk_note ? `<div><dt>自备权益</dt><dd>${esc(b.perk_note)}</dd></div>` : '') +
      '</dl>' +
      `<div class="bty-bar-action">${action}</div>` +
      '</section>';
  }

  function awardsHTML(b) {
    const list = b.awards || [];
    if (b.status !== 'closed') return '';
    if (!list.length) return `<p class="bty-result" data-tone="refund">${esc(SETTLE[b.settle_reason] || '已结束')}。出资的人各自拿回自己的那份。</p>`;
    return '<section class="bty-result" data-tone="award" aria-label="发奖结果">' +
      `<h2>${esc(SETTLE[b.settle_reason] || '已发奖')}</h2>` +
      `<ul>${list.map(a => `<li>${who(a.recipient)}<span>${a.share ? esc(a.share) + '% · ' : ''}${esc(fmt(a.credits))} 积分</span></li>`).join('')}</ul>` +
      '<p class="bty-muted">采纳计分规则</p>' +
      '</section>';
  }

  function answersHTML(b, owner) {
    const answers = b.answers || [];
    const useful = b.useful || {};
    const awarded = {};
    (b.awards || []).forEach(a => { awarded[a.answer_id] = a; });
    const canPick = owner && b.state === 'open' && b.status !== 'closed';
    const rows = answers.map(a => {
      const picked = state.picks.some(p => p.answer_id === a.id);
      const own = a.author && b.owner && a.author.id === b.owner.id;
      const n = Number(useful[a.id]) || 0;
      const win = awarded[a.id];
      return `<li class="bty-answer${picked ? ' is-picked' : ''}" data-answer="${esc(a.id)}">` +
        `<div class="bty-answer-head">${who(a.author)}<small>${esc(md(a.created_at))}</small>${win ? badge({ kind: 'award', credits: win.credits }) + objectLink('thread', a.id, '查看讨论串', 'bty-answer-link') : ''}</div>` +
        `<p>${esc(a.body)}</p>` +
        '<div class="bty-answer-foot">' +
        `<span class="bty-useful" title="${esc(usefulRuleText())}">${esc(n)} 个合格的「有用」</span>` +
        (canPick && !own ? `<button type="button" class="button small${picked ? ' tonal' : ''}" data-bty-act="pick" data-id="${esc(a.id)}" aria-pressed="${picked}">${picked ? '已选 · 再点取消' : '采纳并发奖'}</button>` : '') +
        (canPick && own ? '<small class="bty-muted">自己的回答不能领</small>' : '') +
        '</div></li>';
    }).join('');
    return '<section class="bty-answers" aria-labelledby="bty-answers-title">' +
      `<h2 id="bty-answers-title">回答 · ${esc(fmt(answers.length))}</h2>` +
      (answers.length ? `<ol>${rows}</ol>` : '<p class="bty-muted">还没有回答。</p>') +
      '</section>' +
      (canPick && state.picks.length ? splitHTML(b) : '');
  }

  function splitHTML(b) {
    const pool = Number(b.credits) || 0;
    const amounts = split(pool, state.picks.map(p => p.share));
    const byId = {};
    (b.answers || []).forEach(a => { byId[a.id] = a; });
    const max = 100 - (state.picks.length - 1);
    return '<section class="bty-split" aria-labelledby="bty-split-title">' +
      `<header><h2 id="bty-split-title">分奖比例</h2><p>共 ${esc(fmt(pool))} 积分，比例加起来是 100%。最多 3 个回答。</p></header>` +
      `<ol>${state.picks.map((p, i) => {
        const a = byId[p.answer_id] || {};
        const name = (a.author && a.author.display_name) || '回答者';
        return '<li class="bty-split-row">' +
          `${who(a.author)}` +
          `<input type="range" min="1" max="${esc(max)}" step="1" value="${esc(p.share)}" data-bty-share="${esc(i)}" aria-label="${esc('给 ' + name + ' 的比例')}"${state.picks.length === 1 ? ' disabled' : ''}>` +
          `<output data-bty-pct="${esc(i)}">${esc(p.share)}%</output>` +
          `<b data-bty-amt="${esc(i)}">${esc(fmt(amounts[i]))} 积分</b>` +
          `<button type="button" class="button ghost small icon-only" data-bty-act="pick" data-id="${esc(p.answer_id)}" aria-label="${esc('不选 ' + name)}">${glyph('x')}</button>` +
          '</li>';
      }).join('')}</ol>` +
      '<footer>' +
      `<button type="button" class="button primary" data-bty-act="award">确认发奖 · ${esc(fmt(pool))} 积分</button>` +
      '<button type="button" class="button ghost" data-bty-act="unpick">取消</button>' +
      '<small>发出后不能撤回。截止后 72 小时还没选，会自动给「有用」最多的回答。</small>' +
      '</footer></section>';
  }

  function tasksHTML(b, owner) {
    const tasks = b.tasks || [];
    const mineSubs = (b.submissions || []).filter(s => (s.submitter && s.submitter.id) === me().id || s.submitter_id === me().id);
    const active = b.status === 'active';
    const rows = tasks.map(t => {
      const full = Number(t.accepted) >= Number(t.max_claims);
      const mine = mineSubs.filter(s => s.task_id === t.id && s.status !== 'rejected' && s.status !== 'expired')[0];
      const pct = Math.round((Math.min(Number(t.accepted) || 0, Number(t.max_claims) || 1) / (Number(t.max_claims) || 1)) * 100);
      let action = '';
      if (!owner && mine) action = `<span class="bty-sub-state" data-status="${esc(mine.status)}">${esc(SUB_STATUS[mine.status] || mine.status)}</span>`;
      else if (!owner && active && !full) action = `<button type="button" class="button small" data-bty-act="submit" data-id="${esc(t.id)}">提交反馈</button>`;
      else if (!owner && full) action = '<span class="bty-muted">名额已满</span>';
      return '<li class="bty-task">' +
        `<div class="bty-task-head"><span class="bty-task-kind">${esc(TASK_KIND[t.kind] || t.kind)}</span><h3>${esc(t.title)}</h3></div>` +
        `<p>${esc(t.description)}</p>` +
        '<div class="bty-task-reward">' +
        (t.credits_per ? `<span>${coin(14)}${esc(fmt(t.credits_per))} 积分 / 份</span>` : '') +
        (t.cosmetic_id ? `<span class="bty-extra">${esc(cosmeticLabel(t.cosmetic_id))}</span>` : '') +
        (t.perk_note ? `<span class="bty-extra">${esc(t.perk_note)}</span>` : '') +
        '</div>' +
        '<div class="bty-task-foot">' +
        `<div class="bty-meter" role="progressbar" aria-label="已验收名额" aria-valuemin="0" aria-valuemax="${esc(t.max_claims)}" aria-valuenow="${esc(t.accepted)}" style="--bty-pct:${pct}%"><i></i></div>` +
        `<small>已验收 ${esc(t.accepted)} / ${esc(t.max_claims)} · 待验收 ${esc(t.pending)}</small>` +
        action +
        '</div></li>';
    }).join('');
    return '<section class="bty-tasks" aria-labelledby="bty-tasks-title">' +
      `<h2 id="bty-tasks-title">试用任务 · ${esc(fmt(tasks.length))}</h2>` +
      '<p class="bty-muted">只收实质反馈。发起人逐条验收，验收通过才发奖。</p>' +
      (tasks.length ? `<ol>${rows}</ol>` : '<p class="bty-muted">还没有任务。</p>') +
      '</section>' +
      (owner ? reviewHTML(b) : '');
  }

  function cosmeticLabel(id) {
    const hit = (rules().cosmetics || []).find(c => c.id === id);
    return hit ? hit.label : '外观奖励';
  }

  function reviewHTML(b) {
    const subs = b.submissions || [];
    const titles = {};
    (b.tasks || []).forEach(t => { titles[t.id] = t.title; });
    const open = b.state === 'open';
    const rows = subs.map(s => '<li class="bty-review">' +
      `<div class="bty-review-head">${who(s.submitter || { display_name: '提交人' })}<small>${esc(titles[s.task_id] || '任务')} · ${esc(md(s.created_at))}</small>` +
      `<span class="bty-sub-state" data-status="${esc(s.status)}">${esc(SUB_STATUS[s.status] || s.status)}</span></div>` +
      `<p>${esc(s.body)}</p>` +
      (open && s.status === 'pending'
        ? `<div class="bty-review-acts"><button type="button" class="button small primary" data-bty-act="accept" data-id="${esc(s.id)}">验收通过</button>` +
          `<button type="button" class="button small" data-bty-act="reject" data-id="${esc(s.id)}">退回</button></div>`
        : '') +
      '</li>').join('');
    return '<section class="bty-reviews" aria-labelledby="bty-review-title">' +
      `<h2 id="bty-review-title">待你验收 · ${esc(subs.filter(s => s.status === 'pending').length)}</h2>` +
      (subs.length ? `<ol>${rows}</ol>` : '<p class="bty-muted">还没有人提交。</p>') +
      '</section>';
  }

  function detailPage() {
    if (isLive()) {
      if (state.live.error) return backLink() + errorHTML(state.live.error);
      if (!state.live.data) return backLink() + loadingHTML();
    }
    const b = currentBounty();
    if (!b) return backLink() + errorHTML({ status: 404 });
    const owner = isOwner(b);
    return backLink() +
      perspectiveBar(b) +
      `<div class="bty-detail" data-kind="${esc(b.kind)}">` +
      `<div class="bty-detail-main">${postHTML(b)}${barHTML(b, owner)}${awardsHTML(b)}` +
      (b.kind === 'promo' ? promoNote() + tasksHTML(b, owner) : answersHTML(b, owner)) +
      '</div></div>';
  }

  function backLink() {
    return `<a class="bty-back" href="#/bounties">${glyph('back')}<span>回悬赏广场</span></a>`;
  }

  /* ---------- 我的积分 ---------- */

  function entryTitle(e) {
    if (e.source_type === 'season_start') return '赛季起步积分';
    if (e.source_type === 'ledger') {
      if (e.kind === 'grant') return '贡献同步 · ' + (e.ledger_label || '一笔贡献');
      return e.reason_code === 'reversal' ? '贡献冲正，积分跟着扣回' : '违规扣分同步';
    }
    if (e.kind === 'hold') return e.source_type === 'topup' ? '追加悬赏，转入托管' : e.source_type === 'task' ? '试用任务预算，转入托管' : '发起悬赏，转入托管';
    if (e.kind === 'release') return '托管发给获奖人';
    if (e.kind === 'award') return '获得悬赏奖励';
    if (e.kind === 'refund') return '托管退回';
    return '积分变动';
  }

  function entryWhy(e) {
    if (e.note) return e.note;
    if (e.source_type === 'season_start') {
      const lvText = minLevelText('season_grant');
      return (lvText ? lvText + ' 及以上' : '达到门槛的成员') + '每个赛季发一次，和贡献值无关。';
    }
    if (e.source_type === 'ledger') return '每一笔确认生效的贡献，按同样分值给一份积分；贡献被冲正时积分跟着扣回。';
    if (e.kind === 'hold') return '这部分积分先冻结，发奖或退回之前不能再用。';
    if (e.kind === 'release') return '托管里的积分发给了获奖的人，你的可用积分不变。';
    if (e.kind === 'refund') return SETTLE[e.reason_code] || '没发出去的托管原样退回。';
    return '';
  }

  function walletEntries(w) {
    const rows = w.entries || [];
    if (!rows.length) return '<p class="bty-muted">这个赛季还没有积分变动。</p>';
    return `<ol class="bty-ledger">${rows.map(e => {
      const open = state.openEntry === e.id;
      const amt = Number(e.amount) || 0;
      const held = Number(e.held_delta) || 0;
      const sign = amt > 0 ? 'in' : amt < 0 ? 'out' : 'held';
      const shown = amt !== 0 ? (amt > 0 ? '+' : '−') + fmt(Math.abs(amt)) : '托管 −' + fmt(Math.abs(held));
      return '<li class="bty-led">' +
        `<button type="button" class="bty-led-main" data-bty-act="entry" data-id="${esc(e.id)}" aria-expanded="${/* safe: 布尔 */ open}">` +
        `<span class="bty-led-amt" data-sign="${/* safe: 只取 in/out/held 三个常量 */ sign}">${esc(shown)}</span>` +
        `<span class="bty-led-copy"><b>${esc(entryTitle(e))}</b><small>${esc(md(e.created_at))}${held && amt ? ' · 托管 ' + esc((held > 0 ? '+' : '−') + fmt(Math.abs(held))) : ''}</small></span>` +
        `<span class="bty-led-chev">${glyph('chev')}</span></button>` +
        `<div class="bty-led-detail"${open ? '' : ' hidden'}><dl>` +
        `<div><dt>来由</dt><dd>${esc(entryWhy(e))}</dd></div>` +
        (e.bounty ? `<div><dt>关联</dt><dd>${e.bounty.visible === false ? '关联的帖子现在看不到' : `<a href="#/bounties/${esc(e.bounty.id)}">${esc(e.bounty.title)}</a>`}</dd></div>` : '') +
        '</dl></div></li>';
    }).join('')}</ol>`;
  }

  function promisesHTML(w) {
    const list = w.promises || [];
    if (!list.length) return '';
    const mine = me().id;
    return '<section class="bty-panel" aria-labelledby="bty-promise-title">' +
      '<div class="bty-panel-head"><h2 id="bty-promise-title">发起人自备的权益</h2><p>兑换争议可申诉。</p></div>' +
      `<ul class="bty-promises">${list.map(p => {
        const recipient = p.recipient_id === mine;
        return '<li>' +
          `<div><b>${esc(p.note)}</b><small>${esc(p.bounty_title || '悬赏')}${p.promiser ? ' · ' + esc(p.promiser.display_name) + ' 承诺' : ''}</small></div>` +
          `<span class="bty-sub-state" data-status="${esc(p.status)}">${esc(PROMISE_STATUS[p.status] || p.status)}</span>` +
          (recipient && p.status === 'owed'
            ? `<span class="bty-promise-acts"><button type="button" class="button small tonal" data-bty-act="confirm" data-id="${esc(p.id)}">已收到</button>` +
              `<button type="button" class="button small" data-bty-act="dispute" data-id="${esc(p.id)}">没兑现，申诉</button></span>`
            : '') +
          '</li>';
      }).join('')}</ul></section>`;
  }

  function walletPage() {
    let w;
    if (isLive()) {
      if (state.live.error) return head('我的积分', '积分只能花在悬赏上，和贡献值分开记。', false) + subnav('wallet') + errorHTML(state.live.error);
      if (!state.live.data) return head('我的积分', '积分只能花在悬赏上，和贡献值分开记。', false) + subnav('wallet') + loadingHTML();
      w = state.live.data.wallet;
    } else {
      w = (demo() || {}).wallet || {};
    }
    const lv = me().level;
    return head('我的积分', `${w.season_name || w.season || '本赛季'} · 积分只能花在悬赏上，和贡献值分开记。`, true) +
      subnav('wallet') +
      '<section class="bty-balance" aria-label="余额">' +
      `<div class="bty-balance-main">${coin(36)}<div><b>${esc(fmt(w.available))}</b><span>可用积分</span></div></div>` +
      '<dl class="bty-balance-facts">' +
      `<div><dt>${coin(14, 'held')}托管中</dt><dd>${esc(fmt(w.held))}</dd></div>` +
      `<div><dt>本赛季进</dt><dd>+${esc(fmt(w.season_in))}</dd></div>` +
      `<div><dt>本赛季出</dt><dd>−${esc(fmt(w.season_out))}</dd></div>` +
      `<div><dt>L${esc(lv)} 上限</dt><dd>单个 ${esc(fmt(w.cap))} · 同时 ${esc(fmt(w.concurrent_limit))} 个</dd></div>` +
      '</dl></section>' +
      '<section class="bty-compare" aria-label="积分和贡献值的区别">' +
      '<article><span class="bty-compare-kicker">贡献值</span><h2>决定等级</h2>' +
      `<p>做了被确认的事才加分。不能花、不能转，也买不到。${w.contribution !== undefined ? ` 本赛季 ${esc(fmt(w.contribution))}。` : ''}</p>` +
      '<a class="bty-link" href="#/growth">看贡献流水</a></article>' +
      `<article data-tone="credits"><span class="bty-compare-kicker">${coin(14)}积分</span><h2>能花在悬赏上</h2>` +
      `<p>积分只用于悬赏，不能转账。</p>` +
      '<p class="bty-muted">花掉积分不会扣贡献值，所以等级买不到。</p></article>' +
      '</section>' +
      '<section class="bty-panel" aria-labelledby="bty-led-title">' +
      '<div class="bty-panel-head"><h2 id="bty-led-title">本赛季流水</h2><p>每一笔都能点开看来由。只追加，不改不删。</p></div>' +
      walletEntries(w) + '</section>' +
      promisesHTML(w) +
      (isLive() ? '' : '<p class="bty-foot"><button type="button" class="button ghost small" data-bty-act="reset">把示例恢复成初始状态</button></p>');
  }

  /* ---------- 弹层 ---------- */

  function demoWallet() {
    return (demo() || {}).wallet || { available: 0, held: 0, entries: [] };
  }

  function myPosts(kind) {
    const types = kind === 'promo' ? ['work', 'discussion'] : ['discussion', 'question'];
    const list = isLive() ? ((state.live.data && state.live.data.posts) || []) : ((demo() || {}).myPosts || []);
    const busy = isLive() ? [] : ((demo() || {}).bounties || []).filter(b => b.state === 'open').map(b => b.object.id);
    return list.filter(p => types.indexOf(p.type) >= 0 && busy.indexOf(p.id) < 0);
  }

  function cosmeticOptions() {
    return '<option value="">不加</option>' + (rules().cosmetics || []).map(c =>
      `<option value="${esc(c.id)}">${esc(c.label)}${c.kind === 'palette' ? '' : ' · 徽章'}</option>`).join('');
  }

  function publishHTML() {
    const kind = state.pub.kind;
    const r = rules();
    const lv = me().level;
    const cap = capOf(r, lv);
    const posts = myPosts(kind);
    const avail = isLive() ? null : demoWallet().available;
    const kindOk = canPublishKind(kind);
    const seg = `<div class="segmented" role="group" aria-label="悬赏类型">${KINDS.map(([id, label]) =>
      `<button type="button" data-bty-act="pub-kind" data-id="${id}" aria-pressed="${kind === id}"${canPublishKind(id) ? '' : ' disabled' + whyTitle(id === 'promo' ? 'bounty.create.promo' : 'bounty.create.help')}>${esc(label)}</button>`).join('')}</div>`;
    const postSelect = posts.length
      ? `<select name="object_id" id="bty-pub-post" required>${posts.map(p => `<option value="${esc(p.id)}">${esc(p.title)}</option>`).join('')}</select>`
      : `<p class="bty-muted">${kind === 'promo' ? '先发一个作品，再回来挂试用任务。' : '先发一个求助帖，再回来设悬赏。'}</p>`;
    const locked = isLive()
      ? (kindOk ? '' : (kind === 'promo' ? gatePromo() : gatePublish()))
      : (lv < 2
        ? '<p class="bty-refusal" role="note">L2 及以上才能发悬赏和推广。先去攒几次合格的「有用」吧。</p>'
        : '');
    const days = `<fieldset class="bty-days"><legend>截止</legend>${DAYS.map(d =>
      `<label class="chip"><input type="radio" name="days" value="${d}"${state.pub.days === d ? ' checked' : ''}><span>${d} 天</span></label>`).join('')}</fieldset>`;
    const extrasHTML = '<div class="bty-form-row">' +
      `<label class="field">外观奖励（可选）<select name="cosmetic">${cosmeticOptions()}</select></label>` +
      '<label class="field">你自备的权益（可选）<input name="perk" maxlength="200" placeholder="例如：一个月会员"><small>平台只记你承诺了什么，不保存兑换码。领奖人确认收到，没兑现可以申诉。</small></label>' +
      '</div>' +
      '<p class="bty-unavailable"><span>现金</span><span>实物</span><small>暂不开放：要 Sun 和法务批准后才做。</small></p>';
    let body;
    if (kind === 'help') {
      const start = Math.min(cap || 5, 20);
      body = `<label class="field" for="bty-pub-post">挂在哪个求助帖上 <span class="bty-required">必填</span>${postSelect}</label>` +
        '<div class="field"><label for="bty-amount">悬赏积分 <span class="bty-required">必填</span></label>' +
        `<div class="bty-amount"><input type="range" min="5" max="${esc(Math.max(5, cap))}" value="${esc(start)}" data-bty-amount-range aria-label="悬赏积分">` +
        `<input type="number" id="bty-amount" name="amount" min="5" max="${esc(Math.max(5, cap))}" value="${esc(start)}" required></div>` +
        `<small>L${esc(lv)} 单个最多 ${esc(fmt(cap))}${avail === null ? '' : ` · 你现在可用 ${esc(fmt(avail))}`} · 发布时冻结，选出最佳回答后发出。</small></div>` +
        days +
        '<p class="bty-refusal" id="bty-publish-error" role="alert" data-bty-refusal hidden></p>' +
        '<p class="bty-muted">查看结算规则</p>' +
        extrasHTML;
    } else {
      body = `<label class="field" for="bty-pub-post">推广哪个作品 <span class="bty-required">必填</span>${postSelect}</label>` +
        '<p class="bty-note">推广帖会带「推广」标识，先过治理的广告、联系方式和链接初筛。每人每周 1 条。</p>' +
        days +
        '<fieldset class="bty-taskbox"><legend>试用任务</legend>' +
        '<label class="field">任务标题 <span class="bty-required">必填</span><input name="task_title" maxlength="80" required placeholder="例如：导出功能找 bug" data-bty-screen></label>' +
        `<label class="field">任务类型<select name="task_kind">${(r.task_kinds || []).map(t => `<option value="${esc(t.id)}">${esc(t.label)}</option>`).join('')}</select></label>` +
        '<label class="field">要做什么 <span class="bty-required">必填</span><textarea name="task_desc" maxlength="1000" rows="3" required placeholder="例如：装好以后试一下导出 CSV，把遇到的问题写清楚复现步骤" data-bty-screen></textarea></label>' +
        '<p class="bty-refusal" id="bty-publish-error" role="alert" data-bty-refusal hidden></p>' +
        '<div class="bty-form-row">' +
        '<label class="field">每份奖励（积分）<input type="number" name="per" min="0" max="1000" value="10" data-bty-budget-in></label>' +
        '<label class="field">最多几人<input type="number" name="claims" min="1" max="50" value="3" data-bty-budget-in></label>' +
        '</div>' +
        `<small class="bty-budget" data-bty-budget data-cap="${esc(cap)}">总预算 30 积分，发布时冻结 · L${esc(lv)} 一条推广最多 ${esc(fmt(cap))}</small>` +
        '</fieldset>' +
        extrasHTML;
    }
    return `<form class="bty-form" data-bty-form="publish" novalidate>${seg}${locked}${/* safe: 本函数内拼好的表单片段，插值都已 esc */ body}` +
      '<div class="bty-form-actions">' +
      `<button type="submit" class="button primary"${posts.length && (isLive() ? kindOk : lv >= 2) ? '' : ' disabled'}>发布</button>` +
      '<button type="button" class="button ghost" data-bty-act="close">取消</button>' +
      (isLive() ? '' : '<small>示例：只在本机记一笔，不会发到服务器。</small>') +
      '</div></form>';
  }

  function openPublish() {
    if (isLive() && !(state.live.data && state.live.data.posts)) {
      const a = api();
      a.me().then(m => liveGet('/objects', { author_id: m.id, limit: 50 }).then(list => {
        state.live.data = Object.assign({}, state.live.data || {}, {
          me: { id: m.id, display_name: m.display_name, level: m.level },
          posts: (list || []).filter(o => !o.root_id && o.lifecycle === 'active').map(o => ({ id: o.id, type: o.type, title: o.title }))
        });
        return (state.live.data.rules ? Promise.resolve(state.live.data.rules) : liveGet('/bounty/rules')).then(r => {
          state.live.data.rules = r;
          modal('发布悬赏', publishHTML());
          focusPublishField();
        });
      })).catch(err => toast((err && err.message) || '读不到你的帖子，稍后再试。'));
      return;
    }
    modal('发布悬赏', publishHTML());
    focusPublishField();
  }

  function focusPublishField() {
    window.setTimeout(function () {
      var form = document.querySelector('[data-bty-form="publish"]');
      if (!form) return;
      var selected = form.querySelector('[data-bty-act="pub-kind"][aria-pressed="true"]');
      if (selected && selected.focus) selected.focus();
    }, 0);
  }

  function markPublishError(form, message) {
    form.querySelectorAll('[aria-invalid="true"]').forEach(function (node) {
      node.removeAttribute('aria-invalid');
      node.removeAttribute('aria-describedby');
    });
    var field = null;
    if (/选一个帖子/.test(message)) field = form.elements.namedItem('object_id');
    else if (/标题和要做什么/.test(message)) field = form.elements.namedItem('task_title').value.trim() ? form.elements.namedItem('task_desc') : form.elements.namedItem('task_title');
    else if (/预算|积分/.test(message)) field = form.elements.namedItem(state.pub.kind === 'help' ? 'amount' : 'per');
    if (field) {
      field.setAttribute('aria-invalid', 'true');
      field.setAttribute('aria-describedby', 'bty-publish-error');
      field.focus();
    }
  }

  function simpleForm(name, id, intro, fields, submit) {
    return `<form class="bty-form" data-bty-form="${esc(name)}" data-id="${esc(id)}" novalidate>` +
      `<p class="bty-muted">${esc(intro)}</p>${/* safe: 调用点传入的写死表单片段，插值都已 esc */ fields}` +
      `<div class="bty-form-actions"><button type="submit" class="button primary">${esc(submit)}</button>` +
      '<button type="button" class="button ghost" data-bty-act="close">取消</button></div></form>';
  }

  function radios(name, list) {
    return `<fieldset class="bty-radios"><legend>选一个原因</legend>${list.map(([id, label], i) =>
      `<label><input type="radio" name="${esc(name)}" value="${esc(id)}"${i === 0 ? ' checked' : ''}><span>${esc(label)}</span></label>`).join('')}</fieldset>`;
  }

  /* ---------- 示例里的写操作 ---------- */

  function addEntry(entry) {
    const w = demoWallet();
    w.entries = [Object.assign({ id: 'c-' + Date.now().toString(36), created_at: new Date(nowMs()).toISOString() }, entry)].concat(w.entries || []);
  }

  function doAward(b) {
    const pool = Number(b.credits) || 0;
    if (!state.picks.length) return;
    const picks = state.picks.map(p => ({ answer_id: p.answer_id, share: p.share }));
    if (isLive()) {
      liveWrite('POST', '/bounty/' + encodeURIComponent(b.id) + '/award', { picks: picks }, () => {
        state.picks = [];
        toast('已发出。被采纳的人会收到积分，贡献值由成长规则判断。');
      }).catch(() => {});
      return;
    }
    const amounts = split(pool, picks.map(p => p.share));
    const byId = {};
    (b.answers || []).forEach(a => { byId[a.id] = a; });
    b.awards = picks.map((p, i) => ({ id: 'aw-' + i + Date.now().toString(36), mode: 'owner', answer_id: p.answer_id, recipient: (byId[p.answer_id] || {}).author, share: p.share, credits: amounts[i] }));
    b.state = 'awarded';
    b.status = 'closed';
    b.settle_reason = 'owner';
    b.held = 0;
    if (b.my_stake) {
      demoWallet().held = Math.max(0, (demoWallet().held || 0) - b.my_stake);
      addEntry({ kind: 'release', amount: 0, held_delta: -b.my_stake, source_type: 'award', bounty: { id: b.id, kind: 'help', title: b.object.title, visible: true }, note: '这个悬赏发奖了，你托管的部分一起发给获奖人' });
    }
    state.picks = [];
    save();
    paint();
    toast('示例：已发出 ' + fmt(pool) + ' 积分。只在本机记录，没有通知任何人。');
  }

  function doTopup(b, amount) {
    const w = demoWallet();
    const cap = capOf(rules(), me().level);
    if (amount < 1) return '追加至少 1 积分。';
    if ((b.my_stake || 0) + amount > cap) return `你在这个悬赏上最多投 ${cap} 积分（L${me().level}）。`;
    if (amount > (w.available || 0)) return `可用积分 ${w.available || 0}，不够这次的 ${amount}。`;
    if (!b.my_stake) b.contributors = (b.contributors || 1) + 1;
    b.my_stake = (b.my_stake || 0) + amount;
    b.credits += amount;
    b.held = (b.held || 0) + amount;
    w.available -= amount;
    w.held = (w.held || 0) + amount;
    w.season_out = (w.season_out || 0) + amount;
    addEntry({ kind: 'hold', amount: -amount, held_delta: amount, source_type: 'topup', bounty: { id: b.id, kind: 'help', title: b.object.title, visible: true }, note: '追加的积分同样托管；没有合格回答时各退各的' });
    save();
    return '';
  }

  function doCreate(form) {
    const kind = state.pub.kind;
    const r = rules();
    const lv = me().level;
    const cap = capOf(r, lv);
    const val = n => String((form.elements.namedItem(n) || {}).value || '').trim();
    const objectId = val('object_id');
    const days = Number(val('days')) || state.pub.days;
    const cosmetic = val('cosmetic');
    const perk = val('perk');
    if (!objectId) return '先选一个帖子。';
    if (!isLive() && (demo().bounties || []).some(b => b.state === 'open' && b.object && b.object.id === objectId)) {
      return '这个帖子已经挂着一个进行中的悬赏，等它结束再发新的。';
    }
    if (perk && /[A-Za-z0-9]{4,}(?:[-_ ][A-Za-z0-9]{4,}){2,}|(?=[A-Za-z0-9]*\d)(?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]{12,}/.test(perk)) {
      return '这里不保存兑换码。只写承诺给什么（例如「一个月会员」），发奖后由你交付，领奖人在这里确认收到。';
    }
    const extras = [];
    if (cosmetic) extras.push({ type: 'cosmetic', id: cosmetic });
    if (perk) extras.push({ type: 'perk', note: perk });
    if (kind === 'help') {
      const amount = Number(val('amount')) || 0;
      if (amount < (r.min_credits || 5)) return `求助悬赏至少 ${r.min_credits || 5} 积分。`;
      if (amount > cap) return `L${lv} 单个悬赏最多 ${cap} 积分。`;
      const body = { kind: 'help', object_id: objectId, days: days, rewards: [{ type: 'credits', amount: amount }].concat(extras) };
      if (isLive()) return { live: [['/bounty', body]] };
      const w = demoWallet();
      if (amount > (w.available || 0)) return `可用积分 ${w.available || 0}，这次需要 ${amount}。`;
      const limit = Number(((r.concurrent || {})['L' + lv])) || 0;
      if ((w.open_bounties || 0) >= limit) return `L${lv} 同时最多 ${limit} 个进行中的求助悬赏。`;
      const post = (demo().myPosts || []).find(p => p.id === objectId) || { title: '我的求助' };
      const id = 'b-new-' + Date.now().toString(36);
      const at = nowMs();
      demo().bounties.unshift({
        id: id, kind: 'help', label: '求助', status: 'active', state: 'open', settle_reason: null, mine: true,
        object: { id: objectId, type: 'discussion', title: post.title }, owner: me(), credits: amount, held: amount,
        contributors: 1, my_stake: amount, cosmetic_id: cosmetic || null, cosmetic: cosmetic ? cosmeticLabel(cosmetic) : null,
        has_perk: !!perk, perk_note: perk || null,
        deadline_at: new Date(at + days * 86400000).toISOString(), settle_after: new Date(at + days * 86400000 + 72 * 3600000).toISOString(),
        answer_count: 0, submission_count: 0, task_count: 0, tags: [], awards: [], useful: {}, tasks: [], submissions: [], promises: [], answers: [],
        post: { body: '（示例：正文在原帖里）' }
      });
      w.available -= amount;
      w.held = (w.held || 0) + amount;
      w.season_out = (w.season_out || 0) + amount;
      w.open_bounties = (w.open_bounties || 0) + 1;
      addEntry({ kind: 'hold', amount: -amount, held_delta: amount, source_type: 'bounty', bounty: { id: id, kind: 'help', title: post.title, visible: true } });
      save();
      return { go: id };
    }
    const title = val('task_title');
    const desc = val('task_desc');
    const hit = screenText(title + '\n' + desc, r);
    if (hit) return hit.message;
    if (!title || !desc) return '试用任务要写标题和要做什么。';
    const per = Math.max(0, Number(val('per')) || 0);
    const claims = Math.max(1, Math.min(50, Number(val('claims')) || 1));
    if (!per && !cosmetic && !perk) return '至少给一种奖励：积分、外观或自备权益。';
    if (per * claims > cap) return `L${lv} 一条推广的任务总预算最多 ${cap} 积分。`;
    const rewards = (per ? [{ type: 'credits', amount: per }] : []).concat(extras);
    const task = { title: title, kind: val('task_kind') || 'feedback', description: desc, max_claims: claims, rewards: rewards };
    if (isLive()) return { live: [['/bounty', { kind: 'promo', object_id: objectId, days: days, rewards: [] }], ['tasks', task]] };
    const weekAgo = nowMs() - 7 * 86400000;
    const recent = demo().bounties.some(b => b.kind === 'promo' && b.mine && Date.parse(b.created_at || 0) >= weekAgo);
    if (recent) return '每人每周最多发 1 条推广帖。';
    const w = demoWallet();
    const budget = per * claims;
    if (budget > (w.available || 0)) return `可用积分 ${w.available || 0}，这次预算需要 ${budget}。`;
    const post = (demo().myPosts || []).find(p => p.id === objectId) || { title: '我的作品', type: 'work' };
    const id = 'b-new-' + Date.now().toString(36);
    const at = nowMs();
    demo().bounties.unshift({
      id: id, kind: 'promo', label: '推广', status: 'active', state: 'open', settle_reason: null, mine: true,
      created_at: new Date(at).toISOString(),
      object: { id: objectId, type: post.type, title: post.title }, owner: me(), credits: budget, held: budget, contributors: 1, my_stake: budget,
      cosmetic_id: null, cosmetic: null, has_perk: false, perk_note: null,
      deadline_at: new Date(at + days * 86400000).toISOString(), settle_after: new Date(at + days * 86400000 + 72 * 3600000).toISOString(),
      answer_count: 0, submission_count: 0, task_count: 1, tags: [], awards: [], useful: {}, submissions: [], promises: [], answers: [],
      tasks: [{ id: 't-new-' + Date.now().toString(36), title: title, kind: task.kind, description: desc, credits_per: per, max_claims: claims, cosmetic_id: cosmetic || null, perk_note: perk || null, accepted: 0, pending: 0 }],
      post: { body: '（示例：正文在原作品页里）' }
    });
    if (budget) {
      w.available -= budget;
      w.held = (w.held || 0) + budget;
      w.season_out = (w.season_out || 0) + budget;
      addEntry({ kind: 'hold', amount: -budget, held_delta: budget, source_type: 'task', bounty: { id: id, kind: 'promo', title: post.title, visible: true }, note: '试用任务预算：' + per + ' 积分 × ' + claims + ' 个名额' });
    }
    save();
    return { go: id };
  }

  function runLiveCreate(steps) {
    const [path, body] = steps[0];
    api().post(path, body, { idempotencyKey: newKey() }).then(r => {
      const created = r.data;
      const task = steps[1] && steps[1][1];
      const next = task ? api().post('/bounty/' + encodeURIComponent(created.id) + '/promo/tasks', task, { idempotencyKey: newKey() }) : Promise.resolve(null);
      return next.then(() => created, err => {
        toast('推广帖已建好，但任务没加上：' + ((err && err.message) || '请到详情页再加一次。'));
        return created;
      });
    }).then(created => {
      closeModal();
      invalidate();
      location.hash = '#/bounties/' + encodeURIComponent(created.id);
    }, err => showFormError((err && err.message) || '没有发出去，原数据没有动。'));
  }

  function showFormError(message) {
    const box = document.querySelector('[data-bty-form="publish"] [data-bty-refusal]') || null;
    if (box) {
      box.hidden = false;
      box.textContent = message;
    } else {
      toast(message);
    }
  }

  /* ---------- 绘制 ---------- */

  function parseRoute() {
    const parts = String(location.hash || '').replace(/^#\/?/, '').split('/').filter(Boolean);
    const sub = parts[1] ? decodeURIComponent(parts[1]) : '';
    if (!sub) return { view: 'square', id: '' };
    if (sub === 'wallet') return { view: 'wallet', id: '' };
    return { view: 'detail', id: sub };
  }

  function pageInner() {
    if (state.view === 'wallet') return walletPage();
    if (state.view === 'detail') return detailPage();
    return squarePage();
  }

  function view() {
    const r = parseRoute();
    if (r.view !== state.view || r.id !== state.id) {
      state.picks = [];
      state.perspective = 'auto';
      state.openEntry = '';
    }
    state.view = r.view;
    state.id = r.id;
    return `<div class="bty-page" data-bounty data-view="${esc(state.view)}">${pageInner()}</div>`;
  }

  function paint() {
    if (!state.root || !state.root.isConnected) return;
    const act = document.activeElement;
    const keep = act && act.getAttribute && act.getAttribute('data-bty-act');
    const keepId = act && act.dataset ? act.dataset.id : '';
    state.root.dataset.view = state.view;
    state.root.innerHTML = pageInner();
    if (keep) {
      const sel = `[data-bty-act="${keep}"]` + (keepId ? `[data-id="${window.CSS && window.CSS.escape ? window.CSS.escape(keepId) : keepId}"]` : '');
      const next = state.root.querySelector(sel);
      if (next && next.focus) next.focus({ preventScroll: true });
    }
    if (isLive()) fetchLive();
  }

  function updateSplit() {
    const b = currentBounty();
    const box = document.querySelector('.bty-split');
    if (!b || !box) return;
    const amounts = split(Number(b.credits) || 0, state.picks.map(p => p.share));
    state.picks.forEach((p, i) => {
      const range = box.querySelector(`[data-bty-share="${i}"]`);
      const pct = box.querySelector(`[data-bty-pct="${i}"]`);
      const amt = box.querySelector(`[data-bty-amt="${i}"]`);
      if (range && document.activeElement !== range) range.value = String(p.share);
      if (pct) pct.textContent = p.share + '%';
      if (amt) amt.textContent = fmt(amounts[i]) + ' 积分';
    });
  }

  function updatePublishLive(form) {
    const box = form.querySelector('[data-bty-refusal]');
    if (box) {
      const text = ['task_title', 'task_desc'].map(n => (form.elements.namedItem(n) || {}).value || '').join('\n');
      const hit = screenText(text, rules());
      box.hidden = !hit;
      box.textContent = hit ? hit.message : '';
      const btn = form.querySelector('button[type="submit"]');
      if (btn && myPosts(state.pub.kind).length && (isLive() ? canPublishKind(state.pub.kind) : me().level >= 2)) btn.disabled = !!hit;
    }
    const budget = form.querySelector('[data-bty-budget]');
    if (budget) {
      const per = Math.max(0, Number((form.elements.namedItem('per') || {}).value) || 0);
      const claims = Math.max(1, Number((form.elements.namedItem('claims') || {}).value) || 1);
      const cap = Number(budget.dataset.cap) || 0;
      const total = per * claims;
      budget.textContent = '总预算 ' + fmt(total) + ' 积分，发布时冻结 · 一条推广最多 ' + fmt(cap);
      budget.dataset.over = String(total > cap);
    }
  }

  /* ---------- 交互 ---------- */

  function onClick(event) {
    const btn = event.target.closest('[data-bty-act]');
    if (!btn) return;
    const act = btn.dataset.btyAct;
    const id = btn.dataset.id || '';
    const b = state.view === 'detail' ? currentBounty() : null;
    if (act === 'kind' && FILTER_KINDS.some(k => k[0] === id)) {
      state.kind = id;
      paint();
    } else if (act === 'status' && FILTER_STATUS.some(s => s[0] === id)) {
      state.status = id;
      paint();
    } else if (act === 'retry') {
      invalidate();
      paint();
    } else if (act === 'perspective') {
      state.perspective = id === 'owner' ? 'owner' : 'member';
      state.picks = [];
      paint();
    } else if (act === 'pick' && b) {
      const at = state.picks.findIndex(p => p.answer_id === id);
      if (at >= 0) state.picks.splice(at, 1);
      else if (state.picks.length >= 3) {
        toast('最多分给 3 个回答。');
        return;
      } else state.picks.push({ answer_id: id, share: 0 });
      const n = state.picks.length;
      const even = split(100, state.picks.map(() => 1));
      state.picks.forEach((p, i) => { p.share = n ? even[i] : 0; });
      paint();
      if (!reduced()) {
        const box = document.querySelector('.bty-split');
        if (box && box.animate) box.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 240, easing: 'cubic-bezier(.23,1,.32,1)' });
      }
    } else if (act === 'unpick') {
      state.picks = [];
      paint();
    } else if (act === 'award' && b) {
      doAward(b);
    } else if (act === 'topup' && b) {
      if (isLive() && !canTopup()) return;
      const stake = b.my_stake || 0;
      modal('追加悬赏', simpleForm('topup', b.id, '追加的积分同样托管。发奖时和原悬赏一起按比例发出；没有合格回答时各退各的。',
        `<label class="field">追加多少积分<input type="number" name="amount" min="1" max="1000" value="10" required><small>你已经投了 ${esc(fmt(stake))}；L${esc(me().level)} 在一个悬赏上最多投 ${esc(fmt(capOf(rules(), me().level)))}。</small></label>` +
        '<p class="bty-refusal" role="alert" data-bty-refusal hidden></p>', '追加'));
    } else if (act === 'submit' && b) {
      const t = (b.tasks || []).find(x => x.id === id);
      if (!t) return;
      modal('提交反馈', simpleForm('submit', id, `任务：${t.title}（${TASK_KIND[t.kind] || t.kind}）。验收通过才发奖。`,
        '<label class="field">你的反馈<textarea name="body" minlength="10" maxlength="4000" rows="6" required placeholder="写清楚你的环境、做了什么、看到了什么。报 bug 请附复现步骤。"></textarea><small>至少 10 个字。不要留联系方式，沟通都在站内。</small></label>' +
        '<p class="bty-refusal" role="alert" data-bty-refusal hidden></p>', '提交'));
    } else if ((act === 'accept' || act === 'reject') && b) {
      const sub = (b.submissions || []).find(s => s.id === id);
      if (!sub) return;
      if (act === 'reject') {
        modal('退回这条提交', simpleForm('reject', id, '退回不发奖。对方会看到你选的原因，可以改好以后再交一次。', radios('reason', REJECT), '退回'));
        return;
      }
      decide(b, sub, true, null);
    } else if (act === 'confirm' || act === 'dispute') {
      if (act === 'dispute') {
        modal('申诉没兑现的权益', simpleForm('dispute', id, '申诉会进治理队列。治理员会联系双方核实。', radios('reason', DISPUTE), '提交申诉'));
        return;
      }
      respond(id, true, null);
    } else if (act === 'entry') {
      state.openEntry = state.openEntry === id ? '' : id;
      paint();
    } else if (act === 'publish') {
      if (isLive() && !canPublishAny()) return;
      state.pub = { kind: firstPublishKind(state.view === 'square' && state.kind !== 'all' ? state.kind : 'help'), days: 7 };
      openPublish();
    } else if (act === 'pub-kind' && KINDS.some(k => k[0] === id)) {
      if (!canPublishKind(id)) return;
      state.pub.kind = id;
      modal('发布悬赏', publishHTML());
      focusPublishField();
    } else if (act === 'close') {
      closeModal();
    } else if (act === 'reset') {
      state.data = null;
      write(STORE, null);
      demo();
      paint();
      toast('示例已恢复成初始状态。');
    }
  }

  function decide(b, sub, accept, reason) {
    if (isLive()) {
      liveWrite('POST', '/bounty/submissions/' + encodeURIComponent(sub.id) + '/' + (accept ? 'accept' : 'reject'), reason ? { reason_code: reason } : {}, () => {
        closeModal();
        toast(accept ? '已验收，奖励已发出。' : '已退回。');
      }).catch(() => {});
      return;
    }
    const t = (b.tasks || []).find(x => x.id === sub.task_id) || {};
    if (accept && Number(t.accepted) >= Number(t.max_claims)) {
      toast('这个任务的名额已经发完。');
      return;
    }
    sub.status = accept ? 'accepted' : 'rejected';
    t.pending = Math.max(0, (Number(t.pending) || 0) - 1);
    if (accept) {
      t.accepted = (Number(t.accepted) || 0) + 1;
      const per = Number(t.credits_per) || 0;
      if (per && b.mine) {
        b.held = Math.max(0, (b.held || 0) - per);
        const w = demoWallet();
        w.held = Math.max(0, (w.held || 0) - per);
        addEntry({ kind: 'release', amount: 0, held_delta: -per, source_type: 'award', bounty: { id: b.id, kind: 'promo', title: b.object.title, visible: true }, note: '验收通过' + ((sub.submitter && sub.submitter.display_name) || '') + '的提交，从托管里发出 ' + per });
      }
    }
    save();
    closeModal();
    paint();
    toast(accept ? '示例：已验收，奖励只在本机记录。' : '示例：已退回，对方会看到原因。');
  }

  function respond(id, confirm, reason) {
    if (isLive()) {
      liveWrite('POST', '/bounty/promises/' + encodeURIComponent(id) + '/' + (confirm ? 'confirm' : 'dispute'), reason ? { reason_code: reason } : {}, () => {
        closeModal();
        toast(confirm ? '已确认收到。' : '申诉已提交，治理员会看。');
      }).catch(() => {});
      return;
    }
    const p = (demoWallet().promises || []).find(x => x.id === id);
    if (!p || p.status !== 'owed') return;
    p.status = confirm ? 'confirmed' : 'disputed';
    save();
    closeModal();
    paint();
    toast(confirm ? '示例：已确认收到。' : '示例：申诉已记下，会进治理队列。');
  }

  function onInput(event) {
    const el = event.target;
    if (!el || !el.closest) return;
    if (el.hasAttribute('data-bty-share')) {
      const i = Number(el.getAttribute('data-bty-share'));
      if (state.picks[i]) {
        rebalance(state.picks, i, Number(el.value));
        updateSplit();
      }
      return;
    }
    if (el.hasAttribute('data-bty-amount-range')) {
      const num = el.form && el.form.elements.namedItem('amount');
      if (num) num.value = el.value;
      return;
    }
    const form = el.closest('[data-bty-form="publish"]');
    if (form) {
      if (el.name === 'amount') {
        const range = form.querySelector('[data-bty-amount-range]');
        if (range) range.value = el.value;
      }
      if (el.name === 'days') state.pub.days = Number(el.value) || 7;
      updatePublishLive(form);
    }
  }

  function onSubmit(event) {
    const form = event.target.closest && event.target.closest('[data-bty-form]');
    if (!form) return;
    event.preventDefault();
    const name = form.dataset.btyForm;
    const id = form.dataset.id || '';
    const b = currentBounty();
    const fail = msg => {
      const box = form.querySelector('[data-bty-refusal]');
      if (box) {
        box.hidden = false;
        box.textContent = msg;
        markPublishError(form, msg);
      } else toast(msg);
    };
    const field = n => (form.elements.namedItem(n) || {}).value;
    if (name === 'publish') {
      const out = doCreate(form);
      if (typeof out === 'string') return fail(out);
      if (out && out.live) return runLiveCreate(out.live);
      closeModal();
      toast('示例：已发布，只在本机记录。');
      if (out && out.go) location.hash = '#/bounties/' + encodeURIComponent(out.go);
      return;
    }
    if (name === 'topup' && b) {
      const amount = Math.floor(Number(field('amount')) || 0);
      if (isLive()) {
        liveWrite('POST', '/bounty/' + encodeURIComponent(b.id) + '/topup', { amount: amount }, () => {
          closeModal();
          toast('已追加 ' + fmt(amount) + ' 积分。');
        }).catch(err => fail((err && err.message) || '没有成功。'));
        return;
      }
      const err = doTopup(b, amount);
      if (err) return fail(err);
      closeModal();
      paint();
      toast('示例：已追加 ' + fmt(amount) + ' 积分，转入托管。');
      return;
    }
    if (name === 'submit' && b) {
      const text = String(field('body') || '').trim();
      if (text.length < 10) return fail('至少写 10 个字，说清楚你试了什么、看到了什么。');
      if (isLive()) {
        api().post('/bounty/tasks/' + encodeURIComponent(id) + '/submit', { body: text }, { idempotencyKey: newKey() }).then(() => {
          closeModal();
          invalidate();
          paint();
          toast('已提交，等发起人验收。');
        }, err => fail((err && err.message) || '没有提交成功，原文还在。'));
        return;
      }
      const t = (b.tasks || []).find(x => x.id === id);
      if (!t) return;
      b.submissions = (b.submissions || []).concat([{ id: 's-' + Date.now().toString(36), task_id: id, submitter: me(), status: 'pending', body: text, created_at: new Date(nowMs()).toISOString() }]);
      t.pending = (Number(t.pending) || 0) + 1;
      b.submission_count = (Number(b.submission_count) || 0) + 1;
      save();
      closeModal();
      paint();
      toast('示例：已提交，等发起人验收。验收通过才发奖。');
      return;
    }
    if (name === 'reject' && b) {
      const sub = (b.submissions || []).find(s => s.id === id);
      if (sub) decide(b, sub, false, field('reason') || 'other');
      return;
    }
    if (name === 'dispute') {
      respond(id, false, field('reason') || 'other');
    }
  }

  function on(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    state.unbind.push(() => target.removeEventListener(type, fn, opts));
  }

  function mount() {
    const root = document.querySelector('[data-bounty]');
    if (!root) return;
    destroy();
    state.root = root;
    on(document, 'click', onClick);
    on(document, 'input', onInput);
    on(document, 'change', onInput);
    on(document, 'submit', onSubmit);
    if (isLive()) fetchLive();
  }

  function destroy() {
    state.unbind.forEach(fn => fn());
    state.unbind = [];
    state.root = null;
  }

  /* ---------- 给其他模块的小部件 ---------- */

  function badge(b) {
    if (!b || typeof b !== 'object') return '';
    const kind = b.kind === 'promo' ? 'promo' : b.kind === 'award' ? 'award' : 'help';
    const credits = Number(b.credits !== undefined ? b.credits : b.amount) || 0;
    let text;
    if (kind === 'promo') {
      const n = Number(b.task_count) || 0;
      text = '推广' + (n ? ' · 试用任务 ' + fmt(n) : '');
    } else if (kind === 'award') {
      text = '已采纳 · +' + fmt(credits) + ' 积分';
    } else {
      const ended = ['closed', 'awarded', 'refunded', 'cancelled'].indexOf(b.status) >= 0;
      const status = b.status === 'judging' ? '待评选' : ended ? '已结束' : (b.deadline_at ? '剩 ' + span(secondsTo(b.deadline_at)) : '');
      text = '悬赏 ' + fmt(credits) + ' 积分' + (status ? ' · ' + status : '');
    }
    const href = b.id && kind !== 'award' ? '#/bounties/' + encodeURIComponent(String(b.id)) : '';
    const inner = (kind === 'promo' ? '' : coin(14)) + `<span>${esc(text)}</span>`;
    return href
      ? `<a class="bty-badge" data-kind="${kind}" href="#/bounties/${esc(encodeURIComponent(String(b.id)))}">${inner}</a>`
      : `<span class="bty-badge" data-kind="${kind}">${inner}</span>`;
  }

  window.CommonsBounty = {
    routes: { bounties: view },
    hub: ['bounties'],
    nav: [['bounties', '悬赏', 'bounty', 'discover']],
    icons: { bounty: NAV_ICON },
    badge: badge,
    coin: coin,
    mount: mount,
    destroy: destroy
  };
  (window.CommonsPages = window.CommonsPages || []).push(window.CommonsBounty);
  if (window.CommonsLinks && typeof window.CommonsLinks.provide === 'function') {
    window.CommonsLinks.provide('bounty', handle => {
      const count = ((sample() || {}).bounties || []).filter(bounty => bounty.owner && bounty.owner.handle === handle).length;
      return count ? { label: '发出悬赏', href: '#/bounties', count, icon: 'bounty' } : null;
    });
  }
})();
