(() => {
  'use strict';

  /* R13 FEED-1 B · AI 热点页 #/hot。
     导出 window.CommonsHot，自行登记到 window.CommonsPages。
     demo：读 window.COMMONS_HOT_SAMPLE。live：经 window.CommonsAPI 读 /api/feed/...，失败不退回示例。
     点击一律用 data-hot-act；监听只在 mount() 挂，destroy() 全部解除。 */

  const DIR_COLOR = { model: 2, agent: 1, coding: 3, opensource: 7, product: 4, research: 5 };
  const SHOWN_SOURCES = 2;

  const state = {
    root: null,
    sub: [],
    fav: new Set(),
    open: new Set(),
    unbind: [],
    raf: 0,
    live: null,
    digestRead: {},
    keys: {},
    roomNoted: new Set(),
    loading: false,
    error: null,
    seq: 0
  };

  const isLive = () => !!(window.CommonsAPI && window.CommonsAPI.mode === 'live');

  // 能力门：线上、会话对象在、且 can() 说不行时，返回给人看的原因（/api/me.capability_reasons）；其余返回 ''。
  function whyNot(action) {
    const S = window.CommonsSession;
    if (!isLive() || !S || typeof S.can !== 'function' || S.can(action)) return '';
    return (typeof S.reason === 'function' && S.reason(action)) || '你现在还不能这样做';
  }
  const gateAttr = why => (why ? ` disabled aria-disabled="true" title="${esc(why)}"` : '');

  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, ch => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));

  function personLink(handle, name, level) {
    if (window.CommonsLinks && typeof window.CommonsLinks.person === 'function') {
      return window.CommonsLinks.person(handle, name, { level: level });
    }
    return handle ? `<a class="lk-person" href="#/u/${encodeURIComponent(handle)}">${esc(name)}</a>` : esc(name);
  }

  function objectLink(kind, id, label) {
    if (window.CommonsLinks && typeof window.CommonsLinks.a === 'function') return window.CommonsLinks.a(kind, id, label);
    const roots = { knowledge: 'knowledge', thread: 'threads' };
    return id && roots[kind]
      ? `<a class="lk-object" href="#/${roots[kind]}/${encodeURIComponent(id)}">${esc(label)}</a>`
      : `<span>${esc(label)}</span>`;
  }

  const store = {
    read(key, fallback) {
      try { return window.Commons && window.Commons.read ? window.Commons.read(key, fallback) : fallback; } catch (e) { return fallback; }
    },
    write(key, value) {
      try { if (window.Commons && window.Commons.write) window.Commons.write(key, value); } catch (e) { /* 存不了就只在本页生效 */ }
    }
  };

  function keyFor(sig) {
    if (!state.keys[sig]) state.keys[sig] = window.CommonsAPI.newIdempotencyKey();
    return state.keys[sig];
  }
  function dropKey(sig) { delete state.keys[sig]; }
  function rememberRoom(id) {
    state.roomNoted.add(id);
    store.write('hot.roomNotes', Array.from(state.roomNoted));
  }

  const data = () => (isLive() ? state.live : window.COMMONS_HOT_SAMPLE);
  const reduced = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

  /* ---------- 小工具 ---------- */

  const dirLabel = (d, id) => ((d.directions || []).find(x => x.id === id) || {}).label || id;
  const dirColor = id => `var(--cat-${DIR_COLOR[id] || 10})`;
  const sourceInfo = (d, id) => (d.sources || []).find(s => s.id === id) || { id, name: id, initial: String(id).slice(0, 1).toUpperCase() };
  const sourceColor = (d, id) => {
    const i = Math.max(0, (d.sources || []).findIndex(s => s.id === id));
    return `var(--cat-${(i % 10) + 1})`;
  };
  const displayTitle = ev => ev.title_zh || ev.title || '';
  const displaySummary = ev => ev.summary_zh && ev.summary_zh !== displayTitle(ev) ? ev.summary_zh : '';
  const originalTitle = ev => ev.title_zh && ev.title_zh !== ev.title ? ev.title : '';
  const safeUrl = value => {
    if (window.Commons && typeof window.Commons.safeUrl === 'function') return window.Commons.safeUrl(value);
    const raw = String(value || '').trim();
    return /^https?:\/\//i.test(raw) ? esc(raw) : '#';
  };

  function localizedLines(ev, place) {
    const summary = displaySummary(ev);
    const original = originalTitle(ev);
    return (summary ? `<span class="hot-summary ${esc(place)}">${esc(summary)}</span>` : '') +
      (original ? `<span class="hot-original ${esc(place)}"><b>原文</b>${esc(original)}</span>` : '');
  }

  function hoursBefore(d, iso) {
    const t = Date.parse(iso);
    const now = Date.parse(d.generated_at);
    return Number.isFinite(t) && Number.isFinite(now) ? Math.max(0, (now - t) / 3600000) : 0;
  }

  function ago(d, iso) {
    const h = hoursBefore(d, iso);
    if (h < 1) return '不到 1 小时前';
    if (h < 24) return `${Math.floor(h)} 小时前`;
    return `${Math.floor(h / 24)} 天前`;
  }

  const clockFmt = (() => {
    try { return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Shanghai' }); } catch (e) { return null; }
  })();
  const clock = iso => {
    const t = new Date(iso);
    if (Number.isNaN(t.getTime())) return '';
    return clockFmt ? clockFmt.format(t) : t.toISOString().slice(11, 16);
  };

  /* ---------- 曲线：单调三次插值，过每个点，不冲出范围，没有折角 ---------- */

  const f2 = n => (Math.round(n * 100) / 100).toString();

  function monotonePath(pts) {
    const n = pts.length;
    if (n < 2) return '';
    const dx = [];
    const m = [];
    const t = new Array(n).fill(0);
    for (let i = 0; i < n - 1; i++) {
      dx[i] = pts[i + 1][0] - pts[i][0] || 1e-6;
      m[i] = (pts[i + 1][1] - pts[i][1]) / dx[i];
    }
    t[0] = m[0];
    t[n - 1] = m[n - 2];
    for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
    for (let i = 0; i < n - 1; i++) {
      if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
      const a = t[i] / m[i];
      const b = t[i + 1] / m[i];
      const s = a * a + b * b;
      if (s > 9) {
        const k = 3 / Math.sqrt(s);
        t[i] = k * a * m[i];
        t[i + 1] = k * b * m[i];
      }
    }
    let d = `M${f2(pts[0][0])} ${f2(pts[0][1])}`;
    for (let i = 0; i < n - 1; i++) {
      const c = dx[i] / 3;
      d += `C${f2(pts[i][0] + c)} ${f2(pts[i][1] + t[i] * c)} ${f2(pts[i + 1][0] - c)} ${f2(pts[i + 1][1] - t[i + 1] * c)} ${f2(pts[i + 1][0])} ${f2(pts[i + 1][1])}`;
    }
    return d;
  }

  function spark(values, w, h, cls, delay) {
    const vals = (values && values.length > 1) ? values : [0, 0];
    const pad = 4;
    const max = Math.max.apply(null, vals.concat([1]));
    const pts = vals.map((v, i) => [pad + (i * (w - pad * 2)) / (vals.length - 1), h - pad - (v / max) * (h - pad * 2)]);
    const line = monotonePath(pts);
    const last = pts[pts.length - 1];
    const area = `${line}L${f2(last[0])} ${h}L${f2(pts[0][0])} ${h}Z`;
    return `<svg class="hot-spark ${esc(cls || '')}" viewBox="0 0 ${esc(String(w))} ${esc(String(h))}" preserveAspectRatio="none" role="img" aria-label="最近 24 小时热度曲线" style="--d:${esc(String(delay || 0))}">` +
      `<path class="hot-spark-area" d="${esc(area)}"></path>` +
      `<path class="hot-spark-line" d="${line}" vector-effect="non-scaling-stroke"></path>` +
      `</svg>`;
  }

  /* ---------- 片段 ---------- */

  const ICON = {
    chevron: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>',
    star: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 17l-5.2 2.7 1-5.9L3.5 9.7l5.9-.8z"/></svg>',
    chat: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z"/></svg>',
    room: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 20V5a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v15M3 20h18M14 12v.01"/></svg>'
  };

  function pill(text) {
    return `<span class="pill">${esc(text)}</span>`;
  }

  function avatar(d, id, small) {
    const s = sourceInfo(d, id);
    if (window.CommonsLogo && window.CommonsLogo.has(id)) {
      return window.CommonsLogo.html(id, s.name, { size: 'sm' });
    }
    return `<span class="hot-av${small ? ' small' : ''}" style="--c:${sourceColor(d, id)}" title="${esc(s.name)}">${esc(s.initial)}</span>`;
  }

  function sourceLine(d, ev) {
    const ids = Array.from(new Set(ev.sources.map(s => s.source)));
    const names = ids.slice(0, SHOWN_SOURCES).map(id => sourceInfo(d, id).name).join('、');
    const rest = ids.length > SHOWN_SOURCES ? ` 等 ${ids.length} 家` : '';
    return `<span class="hot-srcline" title="${esc(ids.map(id => sourceInfo(d, id).name).join('、'))}">${esc(names + rest)}</span>`;
  }

  function tag(d, id) {
    return `<span class="chip hot-tag" style="--c:${dirColor(id)}">${esc(dirLabel(d, id))}</span>`;
  }

  const visible = d => {
    const list = d.events || [];
    return state.sub.length ? list.filter(e => state.sub.includes(e.direction)) : list;
  };

  /* ---------- 页面各块 ---------- */

  function head(d) {
    return `<header class="hot-head">` +
      `<p>多家报道聚成一件事，按热度排。</p>` +
      `<div class="hot-head-meta"><span class="hot-updated">更新于 ${esc(clock(d.generated_at))}</span>${isLive() && d.sample ? '' : pill(d.sample ? '示例' : '实时')}</div>` +
      `</header>`;
  }

  function lead(d, ev, rank) {
    const big = rank === 0;
    return `<button type="button" class="hot-lead${big ? ' is-first' : ''}" data-hot-act="jump" data-id="${esc(ev.id)}" style="--i:${esc(String(rank))};--c:${dirColor(ev.direction)}">` +
      `<span class="hot-lead-top"><span class="hot-rank" aria-hidden="true">0${esc(String(rank + 1))}</span>${tag(d, ev.direction)}</span>` +
      `<strong class="hot-lead-title">${esc(displayTitle(ev))}</strong>${localizedLines(ev, 'lead')}` +
      `<span class="hot-lead-meta">${esc(String(ev.source_count))} 个来源 · ${esc(ago(d, ev.first_seen))}首次出现</span>` +
      `<span class="hot-lead-foot"><span class="hot-heat"><b>${Math.round(ev.heat)}</b><small>热度</small></span>` +
      spark(ev.series, 220, 56, 'big', rank) + `</span></button>`;
  }

  function topBlock(d, events) {
    const top = events.slice(0, 3);
    if (!top.length) return '';
    return `<section class="hot-top" aria-labelledby="hot-top-title"><h2 id="hot-top-title" class="hot-sr">今日三条</h2>` +
      top.map((ev, i) => lead(d, ev, i)).join('') + `</section>`;
  }

  function subscribeBar(d) {
    const all = !state.sub.length;
    const chips = (d.directions || []).map(x =>
      `<button type="button" class="chip" data-hot-act="sub" data-id="${esc(x.id)}" aria-pressed="${state.sub.includes(x.id)}">` +
      `<span class="hot-dot" style="--c:${dirColor(x.id)}" aria-hidden="true"></span>${esc(x.label)}</button>`
    ).join('');
    return `<div class="hot-sub" role="group" aria-label="订阅方向">` +
      `<span class="hot-sub-label">订阅方向</span>` +
      `<div class="hot-sub-chips"><button type="button" class="chip" data-hot-act="sub-all" aria-pressed="${all}">全部</button>${chips}</div></div>`;
  }

  function related(ev) {
    const kinds = [['knowledge', '知识'], ['work', '作品'], ['discussion', '讨论']];
    const rows = kinds.map(([k, label]) => {
      const r = ev.related && ev.related[k];
      const kind = k === 'discussion' ? 'thread' : k;
      return r
        ? `<li class="hot-rel ${k}"><span class="hot-rel-kind">${label}</span><span class="hot-rel-body"><b>${( /* safe: objectLink 自行转义 */ objectLink(kind, r.id, r.title) )}</b><small>${esc(r.meta)}</small></span></li>`
        : `<li class="hot-rel none"><span class="hot-rel-kind">${label}</span><span class="hot-rel-body"><small>暂时没有相关${label}</small></span></li>`;
    }).join('');
    return `<ul class="hot-rels">${rows}</ul>`;
  }

  function discussedBy(ev) {
    const people = ev.discussed_by || [];
    if (!people.length) return '';
    return `<div class="hot-who"><span>谁在讨论</span><p>${( /* safe: personLink 自行转义 */ people.map(person => personLink(person.handle, person.name, person.level)).join(' · ') )}</p></div>`;
  }

  function sourceRows(d, ev) {
    return `<ul class="hot-srcs">` + ev.sources.map(s =>
      `<li class="hot-src">${avatar(d, s.source, true)}<span class="hot-src-body">` +
      `<span class="hot-src-name">${esc(s.name)}<em>${s.lang === 'zh' ? '中文' : 'English'}</em></span>` +
      `<b>${esc(s.title)}</b><a class="hot-source-link" href="${safeUrl(s.url)}" target="_blank" rel="noopener noreferrer">打开原文</a></span>` +
      `<time class="hot-src-time" datetime="${esc(s.published_at)}">${esc(clock(s.published_at))}</time></li>`
    ).join('') + `</ul>`;
  }

  function counts(ev, faved) {
    const s = ev.site || {};
    const n = (s.favorites || 0) + (faved ? 1 : 0);
    return `${n} 收藏 · ${s.comments || 0} 讨论 · ${s.rooms || 0} 个房间`;
  }

  function card(d, ev, i) {
    const open = state.open.has(ev.id);
    const faved = state.fav.has(ev.id);
    const favWhy = whyNot('feed.favorite');
    // 已经有人开过的讨论，点「讨论」只是跳过去，不需要建帖权限
    const talkWhy = ev.related && ev.related.discussion ? '' : whyNot('object.create.discussion');
    const roomWhy = whyNot('feed.room');
    const roomNoted = state.roomNoted.has(ev.id);
    const roomGate = roomNoted
      ? ' disabled aria-disabled="true" title="只记下意向，不会马上开房间"'
      : gateAttr(roomWhy);
    return `<li class="hot-card${open ? ' is-open' : ''}" data-hot-card="${esc(ev.id)}" style="--i:${Math.min(i, 8)};--c:${dirColor(ev.direction)}">` +
      `<button type="button" class="hot-card-head" data-hot-act="toggle" data-id="${esc(ev.id)}" aria-expanded="${open}" aria-controls="hot-d-${esc(ev.id)}">` +
      `<span class="hot-card-main">` +
      `<span class="hot-card-meta">${tag(d, ev.direction)}<span>${esc(ago(d, ev.first_seen))}</span>${sourceLine(d, ev)}</span>` +
      `<strong class="hot-card-title">${esc(displayTitle(ev))}</strong>${localizedLines(ev, 'card')}</span>` +
      `<span class="hot-card-side"><span class="hot-heat"><b>${Math.round(ev.heat)}</b><small>热度</small></span>` +
      spark(ev.series, 120, 36, 'mini', Math.min(i, 8)) + `</span>` +
      `<span class="hot-chevron" aria-hidden="true">${ICON.chevron}</span></button>` +
      `<div class="hot-detail" id="hot-d-${esc(ev.id)}" role="region" aria-label="${esc(displayTitle(ev))} 的详情"${open ? '' : ' inert'}><div class="hot-detail-clip"><div class="hot-detail-body">` +
      `<div class="hot-detail-col">` +
      `<h3 class="hot-h3">各来源的报道</h3>${sourceRows(d, ev)}` +
      `<h3 class="hot-h3">时间线</h3><div class="hot-rope" data-hot-rope="${esc(ev.id)}"></div>` +
      `</div><div class="hot-detail-col">` +
      `<h3 class="hot-h3">站内相关</h3>${related(ev)}${discussedBy(ev)}` +
      `<div class="hot-actions"><button type="button" class="button tonal small" data-hot-act="fav" data-id="${esc(ev.id)}" aria-pressed="${faved}"${gateAttr(favWhy)}>${ICON.star}<span>${faved ? '已收藏' : '收藏'}</span></button>` +
      `<button type="button" class="button small" data-hot-act="discuss" data-id="${esc(ev.id)}"${gateAttr(talkWhy)}>${ICON.chat}<span>讨论</span></button>` +
      `<button type="button" class="button primary small" data-hot-act="room" data-id="${esc(ev.id)}"${roomGate}>${ICON.room}<span>${roomNoted ? '已记下' : '开个房间聊'}</span></button></div>` +
      [['收藏', favWhy], ['讨论', talkWhy], ['开个房间聊', roomWhy]].filter(row => row[1])
        .map(row => `<p class="hot-why" role="status" data-hot-why>${esc(row[0])}：${esc(row[1])}</p>`).join('') +
      `<p class="hot-counts" data-hot-counts>${esc(counts(ev, faved))}</p>` +
      `</div></div></div></div></li>`;
  }

  function streamBlock(d, events) {
    if (!events.length) {
      return `<div class="hot-empty" role="status"><img src="assets/illus/empty-no-content.webp" alt="" width="120" height="120" loading="lazy">` +
        `<p>${state.sub.length ? '这些方向今天还没有新事件。' : '今天还没有新事件。'}</p>` +
        (state.sub.length ? `<button type="button" class="button tonal" data-hot-act="sub-all">看全部方向</button>` : '') + `</div>`;
    }
    return `<ol class="hot-stream">` + events.map((ev, i) => card(d, ev, i)).join('') + `</ol>`;
  }

  function digestReadBar(d) {
    const day = d.digest && d.digest.date;
    if (!isLive() || !day || !(d.digest.sections || []).length) return '';
    const read = !!state.digestRead[day];
    return `<div class="hot-dg-read"><button type="button" class="button tonal small" data-hot-act="digest-read" data-day="${esc(day)}" aria-pressed="${read}">${read ? '已读 · 点一下改回未读' : '标为已读'}</button></div>`;
  }

  function digestSummary(d) {
    const day = (d.digest && d.digest.date) || '';
    return `${day} · 模板生成${isLive() && state.digestRead[day] ? ' · 已读' : ''}`;
  }

  function digestBlock(d) {
    const g = d.digest;
    if (!g || !g.sections || !g.sections.length) {
      return `<p class="hot-digest-empty">今天的日报还没生成。</p>`;
    }
    const shown = state.sub.length ? g.sections.filter(sec => state.sub.includes(sec.direction)) : g.sections;
    if (!shown.length) return `<p class="hot-digest-empty">所选方向今天没有日报条目。</p>`;
    const sections = shown.map(sec =>
      `<section class="hot-dg-sec"><h3><span class="hot-dot" style="--c:${dirColor(sec.direction)}" aria-hidden="true"></span>${esc(sec.label)}</h3><ol>` +
      sec.items.map(it => {
        const ev = (d.events || []).find(e => e.id === it.event_id);
        return `<li><button type="button" class="hot-dg-item" data-hot-act="jump" data-id="${esc(it.event_id)}">` +
          `<span>${esc(ev ? displayTitle(ev) : (it.title_zh || it.title || it.text))}</span>${ev ? `<b>${Math.round(ev.heat)}</b>` : ''}</button></li>`;
      }).join('') +
      `</ol></section>`
    ).join('');
    return `<p class="hot-dg-intro">${esc(g.intro)}</p>${sections}${digestReadBar(d)}`;
  }

  function footer(d) {
    const failed = (d.failed_sources || []).map(id => sourceInfo(d, id).name);
    return `<footer class="hot-foot">` +
      (failed.length ? `<p class="hot-warn" role="status"><span class="hot-dot warn" aria-hidden="true"></span>${esc(failed.join('、'))} 今天没取到</p>` : '') +
      `<p>热度说明</p></footer>`;
  }

  function errorState(message) {
    if (message === 'closed') {
      return `<div class="hot-page" data-hot><div class="hot-empty" role="status"><p>这个功能还没开放</p><p>管理员还没打开。</p></div></div>`;
    }
    return `<div class="hot-page" data-hot><div class="hot-empty" role="alert"><img src="assets/illus/empty-offline.webp" alt="" width="120" height="120" loading="lazy">` +
      `<p>热点没加载出来${message ? `：${esc(message)}` : '。'}</p>` +
      `<button type="button" class="button tonal" data-hot-act="retry">重试</button></div></div>`;
  }

  function loadingState() {
    return `<div class="hot-page" data-hot><div class="hot-empty" role="status"><p>正在加载热点…</p></div></div>`;
  }

  function body(d) {
    const events = visible(d);
    return head(d) +
      `<div data-hot-top>${topBlock(d, events)}</div>` +
      `<div data-hot-sub>${subscribeBar(d)}</div>` +
      `<div class="hot-layout"><section class="hot-main" aria-labelledby="hot-stream-title"><h2 id="hot-stream-title" class="hot-sr">事件流</h2><div data-hot-stream>${streamBlock(d, events)}</div></section>` +
      `<aside class="hot-side"><details class="hot-digest" open><summary><span><b>今日日报</b><small data-hot-dg-sum>${esc(digestSummary(d))}</small></span><span class="hot-chevron" aria-hidden="true">${ICON.chevron}</span></summary>` +
      `<div class="hot-digest-body">${digestBlock(d)}</div></details></aside></div>` +
      footer(d);
  }

  function view() {
    if (isLive()) {
      if (state.error && !state.live) return errorState(state.error);
      if (!state.live) return loadingState();
    }
    const d = data();
    if (!d || !Array.isArray(d.events)) return errorState();
    state.sub = (store.read('hot.subscribe', []) || []).filter(id => (d.directions || []).some(x => x.id === id));
    state.fav = new Set(store.read('hot.favorites', []) || []);
    state.roomNoted = new Set(store.read('hot.roomNotes', []) || []);
    return `<div class="hot-page" data-hot>${body(d)}</div>`;
  }

  function rerender() {
    if (window.Commons && window.Commons.refresh) {
      window.Commons.refresh();
      return;
    }
    const el = document.querySelector('[data-hot]');
    if (!el || !el.parentNode) return;
    const wrap = document.createElement('div');
    wrap.innerHTML = view();
    el.parentNode.replaceChild(wrap.firstElementChild, el);
    mount();
  }

  function loadLive() {
    const api = window.CommonsAPI;
    if (!api) {
      state.error = '没有 CommonsAPI。';
      state.loading = false;
      return Promise.resolve();
    }
    const seq = ++state.seq;
    state.loading = true;
    state.error = null;
    return api.get('/feed/events', { limit: 50 }).then(function (res) {
      if (seq !== state.seq) return;
      state.live = res.data;
      return api.get('/feed/digest').then(function (dg) {
        if (seq !== state.seq || !state.live) return;
        if (dg && dg.data) state.live.digest = dg.data;
        const day = dg && dg.data && dg.data.date;
        if (!day) return;
        return api.get('/content/digest-read/' + encodeURIComponent(day)).then(function (r) {
          state.digestRead[day] = !!(r.data && r.data.read);
        }).catch(function () { /* 已读状态读不到就当没读过 */ });
      }).catch(function () { /* 日报可缺，事件流仍显示 */ });
    }).then(function () {
      if (seq !== state.seq) return;
      return api.get('/feed/subscriptions').then(function (s) {
        if (seq !== state.seq) return;
        const dirs = (s.data && s.data.directions) || [];
        state.sub = dirs;
        store.write('hot.subscribe', dirs);
      }).catch(function () { /* 未登录用本机 hot.subscribe */ });
    }).then(function () {
      if (seq !== state.seq) return;
      state.loading = false;
    }).catch(function (err) {
      if (seq !== state.seq) return;
      state.loading = false;
      state.live = null;
      state.error = (err && (err.status === 501 || err.code === 'capability_unavailable')) ? 'closed' : ((err && err.message) || '接口没有返回可用的事件。');
    });
  }

  /* ---------- 局部刷新 ---------- */

  function repaintList() {
    const d = data();
    const root = state.root;
    if (!d || !root) return;
    const events = visible(d);
    root.querySelector('[data-hot-top]').innerHTML = topBlock(d, events);
    root.querySelector('[data-hot-sub]').innerHTML = subscribeBar(d);
    root.querySelector('[data-hot-stream]').innerHTML = streamBlock(d, events);
    root.querySelector('.hot-digest-body').innerHTML = digestBlock(d);
    drawRopes();
  }

  function paintDigestRead() {
    const d = data();
    const root = state.root;
    if (!d || !root) return;
    const body = root.querySelector('.hot-digest-body');
    const sum = root.querySelector('[data-hot-dg-sum]');
    if (body) body.innerHTML = digestBlock(d);
    if (sum) sum.textContent = digestSummary(d);
  }

  function setSub(next) {
    var prev = state.sub;
    state.sub = next;
    if (isLive() && window.CommonsAPI) {
      window.CommonsAPI.patch('/feed/subscriptions', { directions: next }, {
        idempotencyKey: window.CommonsAPI.newIdempotencyKey()
      }).then(function () {
        store.write('hot.subscribe', next);
        repaintList();
      }).catch(function (err) {
        state.sub = prev;
        repaintList();
        if (err && (err.status === 501 || err.code === 'capability_unavailable')) toast('这个功能还没开放。管理员还没打开。');
        else if (err && err.status === 401) toast('登录后才能保存订阅。');
        else toast((err && err.message) || '订阅没有保存。原选择没有变化。');
      });
      repaintList();
      return;
    }
    store.write('hot.subscribe', next);
    repaintList();
  }

  /* ---------- 时间线绳子：端点之间的悬链线，每条报道是一颗珠子 ---------- */

  function ropeY(points, x) {
    for (let i = 1; i < points.length; i++) {
      if (points[i][0] >= x) {
        const a = points[i - 1];
        const b = points[i];
        const u = b[0] === a[0] ? 0 : (x - a[0]) / (b[0] - a[0]);
        return a[1] + (b[1] - a[1]) * u;
      }
    }
    return points[points.length - 1][1];
  }

  function drawRope(el) {
    const d = data();
    const ev = (d.events || []).find(e => e.id === el.dataset.hotRope);
    const w = Math.round(el.clientWidth);
    if (!ev || w < 120) return;
    const h = 84;
    const left = 20;
    const right = w - 20;
    const top = 18;
    const rows = ev.sources.slice().sort((a, b) => Date.parse(a.published_at) - Date.parse(b.published_at));
    const t0 = Date.parse(rows[0].published_at);
    const span = Math.max(Date.parse(rows[rows.length - 1].published_at) - t0, 1);
    const gap = 30;
    let xs = rows.map(r => left + ((Date.parse(r.published_at) - t0) / span) * (right - left));
    for (let i = 1; i < xs.length; i++) xs[i] = Math.max(xs[i], xs[i - 1] + gap);
    const over = xs[xs.length - 1] - right;
    if (over > 0) {
      xs = xs.map((x, i) => x - over * (i / Math.max(xs.length - 1, 1)));
      for (let i = xs.length - 2; i >= 0; i--) xs[i] = Math.min(xs[i], xs[i + 1] - gap);
    }
    const chord = right - left;
    const sag = Math.min(26, chord * 0.12);
    const slack = 1 + (8 * sag * sag) / (3 * chord * chord);
    const G = window.CommonsGravity;
    let pts;
    let path;
    if (G && typeof G.catenaryPoints === 'function' && typeof G.catenary === 'function') {
      pts = G.catenaryPoints({ x: left, y: top }, { x: right, y: top }, slack, 48);
      path = G.catenary({ x: left, y: top }, { x: right, y: top }, slack, 24);
    } else {
      pts = [];
      for (let i = 0; i <= 48; i++) { const u = i / 48; pts.push([left + (right - left) * u, top + sag * 4 * u * (1 - u)]); }
      path = `M${left} ${top}Q${(left + right) / 2} ${top + sag * 2} ${right} ${top}`;
    }
    const beads = rows.map((r, i) => {
      const y = ropeY(pts, xs[i]);
      return `<g class="hot-bead" style="--c:${sourceColor(d, r.source)}" transform="translate(${f2(xs[i])} ${f2(y)})"><title>${esc(sourceInfo(d, r.source).name)} · ${esc(clock(r.published_at))}</title>` +
        `<circle r="11"></circle><text y="4" text-anchor="middle">${esc(sourceInfo(d, r.source).initial)}</text></g>`;
    }).join('');
    const label = (x, y, anchor, text) => `<text class="hot-rope-t" x="${f2(x)}" y="${esc(String(y))}" text-anchor="${esc(anchor)}">${esc(text)}</text>`;
    const ends = label(left, h - 4, 'start', `${clock(rows[0].published_at)} 首发`) +
      (rows.length > 1 ? label(right, h - 4, 'end', `${clock(rows[rows.length - 1].published_at)} 最新`) : '');
    el.innerHTML = `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${rows.length} 个来源的报道时间线">` +
      `<path class="hot-rope-line" d="${esc(path)}"></path>${beads}${ends}</svg>`;
  }

  function drawRopes() {
    if (!state.root) return;
    state.root.querySelectorAll('.hot-card.is-open [data-hot-rope]').forEach(drawRope);
  }

  /* ---------- 事件 ---------- */

  function toggle(id, force) {
    const cardEl = state.root.querySelector(`[data-hot-card="${CSS.escape(id)}"]`);
    if (!cardEl) return;
    const open = force == null ? !state.open.has(id) : force;
    if (open) state.open.add(id); else state.open.delete(id);
    cardEl.classList.toggle('is-open', open);
    cardEl.querySelector('.hot-card-head').setAttribute('aria-expanded', String(open));
    const detail = cardEl.querySelector('.hot-detail');
    if (open) detail.removeAttribute('inert'); else detail.setAttribute('inert', '');
    if (open) drawRope(cardEl.querySelector('[data-hot-rope]'));
  }

  function jump(id) {
    const cardEl = state.root.querySelector(`[data-hot-card="${CSS.escape(id)}"]`);
    if (!cardEl) return;
    toggle(id, true);
    cardEl.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
    const headBtn = cardEl.querySelector('.hot-card-head');
    if (headBtn) headBtn.focus({ preventScroll: true });
  }

  function toast(text) {
    if (window.Commons && window.Commons.toast) window.Commons.toast(text);
  }

  function showDiscussConfirm(actions, id) {
    actions.insertAdjacentHTML('beforeend',
      `<div class="hot-confirm" data-hot-confirm="${esc(id)}" data-key="${esc(window.CommonsAPI.newIdempotencyKey())}" role="group" aria-label="确认发起讨论">` +
      `<p>会以你的名义发起一篇讨论，所有登录成员都能看到。同一条热点只会有一篇，别人先开了就直接带你过去。</p>` +
      `<div class="hot-confirm-actions"><button type="button" class="button primary small" data-hot-act="discuss-confirm" data-id="${esc(id)}">确认发起</button>` +
      `<button type="button" class="button small" data-hot-act="discuss-cancel" data-id="${esc(id)}">取消</button></div></div>`);
    const first = actions.querySelector('[data-hot-act="discuss-confirm"]');
    if (first && first.focus) first.focus();
  }

  function onClick(event) {
    const btn = event.target.closest('[data-hot-act]');
    if (!btn || !state.root || !state.root.contains(btn)) return;
    event.preventDefault();
    const act = btn.dataset.hotAct;
    const id = btn.dataset.id;
    const d = data();
    if (act === 'toggle') toggle(id);
    else if (act === 'jump') jump(id);
    else if (act === 'sub') {
      setSub(state.sub.includes(id) ? state.sub.filter(x => x !== id) : state.sub.concat(id));
      const again = state.root.querySelector(`[data-hot-act="sub"][data-id="${CSS.escape(id)}"]`);
      if (again) again.focus({ preventScroll: true });
    } else if (act === 'sub-all') {
      setSub([]);
    } else if (act === 'fav') {
      if (isLive() && window.CommonsAPI) {
        if (btn.disabled) return;
        const sig = 'fav:' + id;
        btn.disabled = true;
        window.CommonsAPI.post('/feed/events/' + id + '/favorite', {}, { idempotencyKey: keyFor(sig) })
          .then(function (res) {
            dropKey(sig);
            const on = !!(res.data && res.data.favorited);
            if (on) state.fav.add(id); else state.fav.delete(id);
            store.write('hot.favorites', Array.from(state.fav));
            const ev = (d.events || []).find(e => e.id === id);
            if (ev && res.data && res.data.site) ev.site = res.data.site;
            btn.disabled = false;
            btn.setAttribute('aria-pressed', String(on));
            const label = btn.querySelector && btn.querySelector('span');
            if (label) label.textContent = on ? '已收藏' : '收藏';
            const col = btn.closest && btn.closest('.hot-detail-col');
            const c = col && col.querySelector('[data-hot-counts]');
            if (c && ev) c.textContent = counts(ev, false);
            toast(on ? '已收藏。' : '已取消收藏。');
          })
          .catch(function (err) {
            btn.disabled = false;
            if (err && err.status === 401) toast('登录后才能收藏到账号。');
            else toast((err && err.message) || '收藏没成功。');
          });
        return;
      }
      if (state.fav.has(id)) state.fav.delete(id); else state.fav.add(id);
      store.write('hot.favorites', Array.from(state.fav));
      const ev = (d.events || []).find(e => e.id === id);
      const on = state.fav.has(id);
      btn.setAttribute('aria-pressed', String(on));
      btn.querySelector('span').textContent = on ? '已收藏' : '收藏';
      const c = btn.closest('.hot-detail-col').querySelector('[data-hot-counts]');
      if (c && ev) c.textContent = counts(ev, on);
      toast(on ? '已收藏（示例，只记在本机）。' : '已取消收藏。');
    } else if (act === 'digest-read') {
      const day = btn.dataset.day;
      if (!day || btn.disabled || !(isLive() && window.CommonsAPI)) return;
      const want = !state.digestRead[day];
      const path = '/content/digest-read/' + encodeURIComponent(day);
      const sig = 'digest:' + day + ':' + (want ? 'read' : 'unread');
      const opts = { idempotencyKey: keyFor(sig) };
      btn.disabled = true;
      (want ? window.CommonsAPI.put(path, {}, opts) : window.CommonsAPI.del(path, {}, opts))
        .then(function (res) {
          dropKey(sig);
          state.digestRead[day] = !!(res.data && res.data.read);
          btn.disabled = false;
          paintDigestRead();
          toast(state.digestRead[day] ? '已标为已读，换台设备也会记得。' : '已改回未读。');
        })
        .catch(function (err) {
          btn.disabled = false;
          if (err && (err.status === 501 || err.code === 'capability_unavailable')) toast('这个功能还没开放');
          else if (err && err.status === 401) toast('登录后才能同步已读。');
          else toast((err && err.message) || '已读没有记上。原状态没有变化。');
        });
    } else if (act === 'discuss-cancel') {
      const panel = btn.closest('[data-hot-confirm]');
      if (panel && !btn.disabled) panel.remove();
    } else if (act === 'discuss-confirm') {
      const panel = btn.closest('[data-hot-confirm]');
      if (!panel || btn.disabled || !(isLive() && window.CommonsAPI)) return;
      const ev = (d.events || []).find(e => e.id === id);
      const buttons = panel.querySelectorAll('button');
      const setBusy = on => buttons.forEach(b => { b.disabled = on; });
      setBusy(true);
      window.CommonsAPI.post('/content/hot-discussions/' + encodeURIComponent(id), {
        title: String((ev && (ev.title_zh || ev.title)) || '讨论').slice(0, 200),
        body: String((ev && (ev.summary_zh || ev.title)) || '').slice(0, 2000)
      }, { idempotencyKey: panel.dataset.key || window.CommonsAPI.newIdempotencyKey() })
        .then(function (res) {
          const found = (res && res.data) || {};
          const nid = found.id;
          if (ev && nid) {
            ev.related = ev.related || {};
            ev.related.discussion = { id: nid, title: found.title || ev.title || '讨论', meta: '讨论' };
          }
          if (nid) {
            if (found.created === false) toast('这条热点已经有人开了讨论，带你过去。');
            location.hash = '#/threads/' + encodeURIComponent(nid);
            return;
          }
          setBusy(false);
        })
        .catch(function (err) {
          setBusy(false);
          if (err && (err.status === 501 || err.code === 'capability_unavailable')) toast('这个功能还没开放');
          else if (err && err.status === 401) toast('登录后才能开讨论。');
          else toast((err && err.message) || '没有建起讨论。');
        });
    } else if (act === 'discuss') {
      if (isLive() && window.CommonsAPI) {
        const ev = (d.events || []).find(e => e.id === id);
        const existing = ev && ev.related && ev.related.discussion && ev.related.discussion.id;
        if (existing) {
          location.hash = '#/threads/' + encodeURIComponent(existing);
          return;
        }
        // 本页没记到：先问服务器这个事件有没有人开过讨论；没有，才在页内说明、确认后以点击者的名义建帖。
        const actions = btn.closest('.hot-actions');
        if (!actions || actions.querySelector('[data-hot-confirm]') || btn.disabled) return;
        btn.disabled = true;
        window.CommonsAPI.get('/content/hot-discussions/' + encodeURIComponent(id))
          .then(function (res) {
            const found = res && res.data;
            if (found && found.id) {
              if (ev) { ev.related = ev.related || {}; ev.related.discussion = { id: found.id, title: found.title || '讨论', meta: '讨论' }; }
              location.hash = '#/threads/' + encodeURIComponent(found.id);
              return;
            }
            showDiscussConfirm(actions, id);
          })
          .catch(function (err) {
            if (err && (err.status === 501 || err.code === 'capability_unavailable')) toast('这个功能还没开放');
            else if (err && err.status === 401) toast('登录后才能开讨论。');
            else showDiscussConfirm(actions, id); // 查询没成功也照样走确认：建帖接口本身按事件去重，不会多出一篇
          })
          .then(function () { btn.disabled = false; });
        return;
      }
      toast('讨论串暂未接入。');
    } else if (act === 'room') {
      if (isLive() && window.CommonsAPI) {
        if (btn.disabled || (btn.dataset && btn.dataset.roomNoted === '1')) return;
        btn.disabled = true;
        const sig = 'room:' + id;
        window.CommonsAPI.post('/feed/events/' + id + '/room', {}, { idempotencyKey: keyFor(sig) })
          .then(function (res) {
            dropKey(sig);
            rememberRoom(id);
            if (btn.dataset) btn.dataset.roomNoted = '1';
            const label = btn.querySelector && btn.querySelector('span');
            if (label) label.textContent = '已记下';
            btn.title = '只记下意向，不会马上开房间';
            const ev = (d.events || []).find(e => e.id === id);
            if (ev && res.data && res.data.site) ev.site = res.data.site;
            const col = btn.closest && btn.closest('.hot-detail-col');
            const c = col && col.querySelector('[data-hot-counts]');
            if (c && ev) c.textContent = counts(ev, state.fav.has(id));
            toast('已记下开房意向。这不会马上开出房间。');
          })
          .catch(function (err) {
            if (err && (err.status === 501 || err.code === 'capability_unavailable')) toast('这个功能还没开放');
            else if (err && err.status === 401) toast('登录后才能开房间。');
            else toast((err && err.message) || '开房意向没记下。');
          })
          .then(function () { btn.disabled = false; });
        return;
      }
      toast('开房功能暂未接入。');
    } else if (act === 'retry') {
      if (isLive()) {
        state.live = null;
        state.error = null;
        state.loading = false;
        loadLive().then(rerender);
        return;
      }
      if (window.Commons && window.Commons.refresh) window.Commons.refresh();
    }
  }

  function on(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    state.unbind.push(() => target.removeEventListener(type, fn, opts));
  }

  function onResize() {
    cancelAnimationFrame(state.raf);
    state.raf = requestAnimationFrame(() => { state.raf = 0; drawRopes(); });
  }

  function mount() {
    const root = document.querySelector('[data-hot]');
    if (!root) return;
    destroy();
    state.root = root;
    const dg = root.querySelector('.hot-digest');
    if (dg && window.matchMedia && matchMedia('(max-width: 1099px)').matches) dg.removeAttribute('open');
    on(document, 'click', onClick);
    on(window, 'resize', onResize);
    drawRopes();
    if (isLive() && !state.live && !state.loading && !state.error) {
      loadLive().then(rerender);
    }
  }

  function destroy() {
    state.unbind.forEach(fn => fn());
    state.unbind = [];
    if (state.raf) cancelAnimationFrame(state.raf);
    state.raf = 0;
    state.root = null;
  }

  window.CommonsHot = {
    routes: { hot: view },
    hub: ['hot'],
    nav: [['hot', 'AI 热点', 'flame', 'discover']],
    icons: { flame: 'M12 3c.6 3.6 5 5.4 5 10.4a5 5 0 0 1-10 0c0-2.1.9-3.6 2.4-4.7.2 1.6.9 2.6 2.1 3.1C11.2 9.6 11 6.3 12 3z' },
    mount: mount,
    destroy: destroy
  };
  (window.CommonsPages = window.CommonsPages || []).push(window.CommonsHot);
})();
