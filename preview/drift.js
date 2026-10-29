/* R13 DRIFT-FE · 话题漂移（#/drift）+ 群的走向页里的行业 / 应用下钻
 * 读 window.COMMONS_INSIGHTS_DRIFT（DATA-2 匿名聚合，主控已审）。没有数据时给空状态，不编数字。
 * 独立页：起落榜（行业一榜、应用一榜）、排名曲线（bump chart + 接替关系重力线）、行业 × 应用、口径说明。
 * 下钻：监听 document 上的 insights:topic，往 detail.slot 里画这个大话题下的行业和应用份额线与涨跌。
 * null = 当格消息或发言人不足 10，不展示：画成断开 / 斜线 / 「不展示」，从不画成 0。
 * 导出 window.CommonsDrift = { routes: { drift }, nav, mount, destroy }，自行登记到 window.CommonsPages。
 * 依赖 gravity-line.js（缺了退回静态弧线）；样式在 drift.css，类名与 data 属性全部 dr- 前缀。
 */
(function () {
  'use strict';

  const MOBILE = 760;
  const CAT_N = 9;
  const FLAGS = { ecommerce: '可能混入买卖账号的聊天，不代表 AI 用在电商（主控推断）' };

  const nf = typeof Intl === 'object' && Intl.NumberFormat ? new Intl.NumberFormat('zh-CN') : null;
  const fmt = n => (nf ? nf.format(n) : String(n));
  const isNum = v => typeof v === 'number' && Number.isFinite(v);
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const P = v => (Math.round(v * 10) / 10).toString();
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const TOPIC_DEST = {
    coding: { kind: 'thread', id: 'post-demo' },
    agents: { kind: 'knowledge', id: 'ku001' },
    knowledge: { kind: 'knowledge', id: 'k1' },
    prompting: { kind: 'prompt', id: '' },
    learning: { kind: 'talk', id: '' },
    models: { kind: 'knowledge', id: 'ku001' },
    design: { kind: 'work', id: '' },
    creation: { kind: 'thread', id: 'post-demo' },
    office: { kind: 'knowledge', id: 'k1' },
    product: { kind: 'thread', id: 'post-demo' },
    opensource: { kind: 'knowledge', id: 'k1' },
    practice: { kind: 'thread', id: 'post-demo' }
  };
  const KIND_ROUTE = { thread: 'threads', knowledge: 'knowledge', prompt: 'prompts', talk: 'talks', work: 'html-lab', agent: 'agents' };
  /* safe-fn: CommonsLinks.person 自行转义；退路对名字 esc、handle encodeURIComponent */
  function personLink(handle, name, level) {
    if (window.CommonsLinks && typeof window.CommonsLinks.person === 'function') {
      return window.CommonsLinks.person(handle, name, { level: level });
    }
    return handle ? '<a class="lk-person" href="#/u/' + encodeURIComponent(handle) + '">' + esc(name) + '</a>' : esc(name);
  }
  /* safe-fn: CommonsLinks.a 自行转义；退路对 label esc、id encodeURIComponent */
  function objectLink(kind, id, label) {
    if (window.CommonsLinks && typeof window.CommonsLinks.a === 'function') {
      return window.CommonsLinks.a(kind, id, label);
    }
    const route = KIND_ROUTE[kind];
    if (!route) return esc(label);
    return '<a class="lk-object" href="#/' + route + (id ? '/' + encodeURIComponent(id) : '') + '">' + esc(label) + '</a>';
  }
  function topicLink(key, label) {
    const dest = TOPIC_DEST[key];
    if (!dest) return esc(label);
    return objectLink(dest.kind, dest.id, label);
  }

  const validDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const narrow = () => window.innerWidth <= MOBILE;
  const pct2 = v => (v * 100).toFixed(2) + '%';
  const pts = v => (v > 0 ? '+' : v < 0 ? '−' : '±') + Math.abs(v * 100).toFixed(2) + ' 点';
  const md = s => Number(s.slice(5, 7)) + '.' + Number(s.slice(8, 10));
  const weekLabel = s => Number(s.slice(5, 7)) + ' 月第 ' + Math.ceil(Number(s.slice(8, 10)) / 7) + ' 周';
  const shortLabel = s => String(s || '').split(' / ')[0];
  const catOf = i => (i % CAT_N) + 1;
  const addDays = (s, n) => {
    const d = new Date(s + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };

  /* ---------- 曲线 ---------- */

  // 单调三次插值（Fritsch–Carlson）：份额线过每个数据点、不过冲
  function monotone(pts2) {
    const n = pts2.length;
    if (!n) return '';
    let d = 'M' + P(pts2[0][0]) + ' ' + P(pts2[0][1]);
    if (n === 1) return d;
    if (n === 2) return d + 'L' + P(pts2[1][0]) + ' ' + P(pts2[1][1]);
    const h = [];
    const s = [];
    for (let i = 0; i < n - 1; i++) {
      h.push(pts2[i + 1][0] - pts2[i][0]);
      s.push((pts2[i + 1][1] - pts2[i][1]) / (h[i] || 1));
    }
    const t = new Array(n);
    for (let i = 1; i < n - 1; i++) {
      if (s[i - 1] * s[i] <= 0) t[i] = 0;
      else {
        const p = (s[i - 1] * h[i] + s[i] * h[i - 1]) / (h[i - 1] + h[i]);
        t[i] = (Math.sign(s[i - 1]) + Math.sign(s[i])) * Math.min(Math.abs(s[i - 1]), Math.abs(s[i]), 0.5 * Math.abs(p));
      }
    }
    t[0] = (3 * s[0] - t[1]) / 2;
    t[n - 1] = (3 * s[n - 2] - t[n - 2]) / 2;
    for (let i = 0; i < n - 1; i++) {
      const dx = h[i] / 3;
      d += 'C' + P(pts2[i][0] + dx) + ' ' + P(pts2[i][1] + dx * t[i]) + ' ' + P(pts2[i + 1][0] - dx) + ' ' + P(pts2[i + 1][1] - dx * t[i + 1]) + ' ' +
        P(pts2[i + 1][0]) + ' ' + P(pts2[i + 1][1]);
    }
    return d;
  }

  // 连续非 null 的段（下标列表）
  function runs(values) {
    const out = [];
    let cur = null;
    values.forEach((v, i) => {
      if (isNum(v)) {
        if (!cur) out.push(cur = []);
        cur.push(i);
      } else cur = null;
    });
    return out;
  }

  // 排名曲线：两点之间 S 形（水平切线），名次交叉一眼能看
  const sCurve = (x0, y0, x1, y1) => {
    const xm = (x0 + x1) / 2;
    return 'C' + P(xm) + ' ' + P(y0) + ' ' + P(xm) + ' ' + P(y1) + ' ' + P(x1) + ' ' + P(y1);
  };

  // 两段 S 形曲线交叉的位置：q = 纵向进度（0..1），返回横向进度。smoothstep 反解 + 横向进度公式
  function crossFrac(q) {
    let lo = 0;
    let hi = 1;
    for (let k = 0; k < 24; k++) {
      const u = (lo + hi) / 2;
      if (3 * u * u - 2 * u * u * u < q) lo = u; else hi = u;
    }
    const u = (lo + hi) / 2;
    return 1.5 * u * (1 - u) + u * u * u;
  }

  const niceStep = max => {
    const steps = [0.0005, 0.001, 0.0025, 0.005, 0.01, 0.02, 0.025, 0.05, 0.1];
    return steps.find(s => max / s <= 4) || 0.1;
  };

  /* ---------- 数据 ---------- */

  function source() {
    const d = window.COMMONS_INSIGHTS_DRIFT;
    return d && typeof d === 'object' ? d : null;
  }

  function build(d) {
    if (d.schemaVersion !== 1 || !Array.isArray(d.weeks) || !Array.isArray(d.entries) || !Array.isArray(d.groups) || !d.series || typeof d.series !== 'object') {
      throw new Error('schema');
    }
    const weeks = d.weeks.map(w => ({ start: w && w.start, partial: !!(w && w.partial), textTotal: w && isNum(w.textTotal) ? w.textTotal : null }));
    const n = weeks.length;
    if (!n || weeks.some(w => !validDate(w.start))) throw new Error('weeks');
    const groups = new Map();
    d.groups.forEach(g => {
      if (g && g.key && g.label) groups.set(g.key, { key: g.key, label: g.label, kind: g.kind === 'industry' ? 'industry' : 'app' });
    });
    const entries = new Map();
    d.entries.forEach(e => {
      if (!e || !e.key || !e.label) return;
      const s = d.series[e.key];
      if (s && (!Array.isArray(s.share) || s.share.length !== n || !Array.isArray(s.hits) || s.hits.length !== n)) throw new Error('series');
      entries.set(e.key, {
        key: e.key,
        label: String(e.label),
        group: e.group,
        kind: e.kind === 'industry' ? 'industry' : 'app',
        parent: e.parent,
        share: s ? s.share.map(v => (isNum(v) ? v : null)) : null,
        hits: s ? s.hits.map(v => (isNum(v) ? v : null)) : null
      });
    });
    const topics = new Map();
    (d.topics || []).forEach(t => { if (t && t.key && t.label) topics.set(t.key, t.label); });

    // 起落榜用的窗口（两个窗口各 4 周）
    const rf = d.risefall || {};
    const win = (rf.apps && rf.apps.window) || (rf.industries && rf.industries.window) || null;
    const idx = start => weeks.findIndex(w => w.start === start);
    let span = null;
    if (win && win.previous && win.recent) {
      const pa = idx(win.previous[0]);
      const pb = idx(win.previous[1]);
      const ra = idx(win.recent[0]);
      const rb = idx(win.recent[1]);
      if (pa >= 0 && pb >= pa && ra >= 0 && rb >= ra) span = { pa, pb, ra, rb, win };
    }
    const published = new Map();
    ['industries', 'apps'].forEach(k => {
      const b = rf[k];
      if (!b) return;
      (b.rising || []).concat(b.falling || []).forEach(r => {
        if (r && r.key && isNum(r.previous) && isNum(r.recent)) published.set(r.key, { previous: r.previous, recent: r.recent, delta: isNum(r.delta) ? r.delta : r.recent - r.previous });
      });
    });
    // 和 DATA-2 同一口径：4 周命中之和 / 4 周全部文字消息之和；8 周里任何一格不展示就不算
    const changeOf = key => {
      if (published.has(key)) return published.get(key);
      const e = entries.get(key);
      if (!e || !e.hits || !span) return null;
      const calc = (a, b) => {
        let h = 0;
        let t = 0;
        for (let i = a; i <= b; i++) {
          if (!isNum(e.hits[i]) || !isNum(weeks[i].textTotal)) return null;
          h += e.hits[i];
          t += weeks[i].textTotal;
        }
        return t ? h / t : null;
      };
      const previous = calc(span.pa, span.pb);
      const recent = calc(span.ra, span.rb);
      if (previous === null || recent === null) return null;
      return { previous: Math.round(previous * 1e4) / 1e4, recent: Math.round(recent * 1e4) / 1e4, delta: Math.round((recent - previous) * 1e4) / 1e4 };
    };

    const board = b => {
      const keep = r => r && entries.has(r.key) && isNum(r.previous) && isNum(r.recent);
      const rising = ((b && b.rising) || []).filter(keep).map(r => ({ key: r.key, previous: r.previous, recent: r.recent, delta: r.delta })).sort((a, c) => c.delta - a.delta);
      const falling = ((b && b.falling) || []).filter(keep).map(r => ({ key: r.key, previous: r.previous, recent: r.recent, delta: r.delta })).sort((a, c) => a.delta - c.delta);
      return { rising, falling };
    };

    const ranks = {};
    Object.keys(d.ranks || {}).forEach(g => {
      const list = (d.ranks[g] || []).filter(r => r && entries.has(r.key) && Array.isArray(r.ranks) && r.ranks.length === n)
        .map(r => ({ key: r.key, label: entries.get(r.key).label, ranks: r.ranks.map(v => (isNum(v) ? v : null)) }));
      const avg = r => {
        const ok = r.ranks.filter(isNum);
        return ok.length ? ok.reduce((s, v) => s + v, 0) / ok.length - ok.length * 0.01 : 99;
      };
      list.sort((a, b) => avg(a) - avg(b));
      list.forEach((r, i) => { r.cat = catOf(i); });
      ranks[g] = list;
    });

    const takeovers = (d.takeovers || []).filter(t => t && entries.has(t.from) && entries.has(t.to) && idx(t.week) >= 0)
      .map(t => ({ group: t.group, week: idx(t.week), from: t.from, to: t.to, fromBefore: t.fromBefore, fromNow: t.fromNow, toBefore: t.toBefore, toNow: t.toNow }));

    const hasData = e => !!(e.share && e.share.some(isNum));
    const withData = Array.from(entries.values()).filter(hasData).length;

    const co = (d.cooccurrence || []).filter(r => r && entries.has(r.industry) && Array.isArray(r.apps))
      .map(r => ({ industry: r.industry, apps: r.apps.filter(a => a && entries.has(a.app) && isNum(a.count)).slice(0, 3) }))
      .filter(r => r.apps.length);
    co.forEach(r => { r.total = r.apps.reduce((s, a) => s + a.count, 0); });
    co.sort((a, b) => b.total - a.total);

    return {
      d,
      weeks,
      n,
      groups,
      entries,
      topics,
      span,
      changeOf,
      boards: { industries: board(rf.industries), apps: board(rf.apps) },
      ranks,
      takeovers,
      co,
      total: entries.size,
      withData,
      hiddenCells: d.suppressed && isNum(d.suppressed.cells) ? d.suppressed.cells : null,
      real: d.synthetic !== true,
      review: d.review && d.review.status === 'reviewed' ? d.review : null
    };
  }

  /* ---------- 页面 HTML ---------- */

  function badge(m) {
    return m.real ? '<span class="dr-badge is-real">真实记录 · 匿名聚合</span>' : '<span class="dr-badge is-sample">示例数据</span>';
  }

  /* safe-slot: id, title, sub, tools — 调用点只传固定文案或已 esc 的片段 */
  function cardHead(id, title, sub, tools) {
    return '<header class="dr-card-head">' +
        '<div class="dr-card-copy"><h2 id="' + id + '">' + title + '</h2><p>' + sub + '</p></div>' +
        (tools ? '<div class="dr-card-tools">' + tools + '</div>' : '') +
      '</header>';
  }

  function emptyBlock(text) {
    return '<div class="dr-empty" role="note"><span class="dr-empty-mark" aria-hidden="true"></span><p>' + esc(text) + '</p></div>';
  }

  /* safe-slot: body — 调用方传入本模块拼好的说明 HTML，数据值在生成处转义 */
  function moreHTML(label, body) {
    if (!body) return '';
    return '<details class="dr-more"><summary><i aria-hidden="true">?</i>' + esc(label) + '</summary><div class="dr-more-body">' + (body || '') + '</div></details>';
  }

  function headHTML(m) {
    const weeks = m.n;
    /* safe-slot: label, value, unit, sub — 固定文案、数字或已 esc 的片段 */
    const metric = (label, value, unit, sub) =>
      '<div class="dr-metric"><dt>' + label + '</dt><dd class="dr-metric-n"><span class="dr-metric-v">' + value + '</span>' + (unit ? '<span class="dr-metric-u">' + unit + '</span>' : '') + '</dd><dd class="dr-metric-s">' + sub + '</dd></div>';
    return '<header class="dr-head">' +
        '<div class="dr-head-copy">' +
          '<p class="dr-lede">行业与应用话题的周度变化。</p>' + badge(m) +
        '</div>' +
        '<dl class="dr-metrics">' +
          metric('收录词条', esc(fmt(m.total)), '个', '行业与应用') +
          metric('有数据的词条', esc(fmt(m.withData)), '个', '至少一周够 10 条 10 人') +
          metric('统计周数', esc(fmt(weeks)), '周', esc(md(m.weeks[0].start)) + ' 起 · 首尾周不完整') +
          metric('接替事件', esc(fmt(m.takeovers.length)), '次', '排名曲线里标出') +
        '</dl>' +
      '</header>';
  }

  function windowText(m) {
    if (!m.span) return '';
    return '近 4 周（' + md(m.weeks[m.span.ra].start) + ' 起）对比前 4 周（' + md(m.weeks[m.span.pa].start) + ' 起）';
  }

  function rowHTML(m, r, i, scale, showGroup) {
    const e = m.entries.get(r.key);
    const g = showGroup && m.groups.get(e.group);
    const a = clamp(r.previous / scale * 100, 0, 100);
    const b = clamp(r.recent / scale * 100, 0, 100);
    const dir = r.delta >= 0 ? 'up' : 'down';
    return '<li class="dr-row" data-dir="' + dir + '">' +
        '<span class="dr-rank">' + (i + 1) + '</span>' +
        '<span class="dr-name"><b title="' + esc(e.label) + '">' + /* safe: topicLink 自行转义 */ topicLink(e.parent || r.key, shortLabel(e.label)) + '</b>' + (g ? '<i>' + esc(g.label) + '</i>' : '') + '</span>' +
        '<span class="dr-delta"><i class="dr-arrow" aria-hidden="true"></i>' + pts(r.delta) + '</span>' +
        '<span class="dr-dumb" role="img" aria-label="' + esc(pct2(r.previous) + ' 到 ' + pct2(r.recent)) + '" style="--a:' + P(a) + '%;--b:' + P(b) + '%">' +
          '<i class="dr-dumb-bar"></i><i class="dr-dumb-a"></i><i class="dr-dumb-b"></i></span>' +
        '<span class="dr-vals"><span>' + pct2(r.previous) + '</span><span aria-hidden="true">→</span><b>' + pct2(r.recent) + '</b></span>' +
      '</li>';
  }

  /* safe-slot: title, sub — 固定文案 */
  function boardHTML(m, title, sub, b, showGroup) {
    const all = b.rising.concat(b.falling);
    const scale = Math.max.apply(null, all.map(r => Math.max(r.previous, r.recent)).concat([0.0001])) * 1.12;
    /* safe-slot: cls, head, none — 固定文案 */
    const col = (cls, head, list, none) =>
      '<div class="dr-col ' + cls + '"><h4>' + head + '</h4>' +
        (list.length ? '<ol>' + list.map((r, i) => rowHTML(m, r, i, scale, showGroup)).join('') + '</ol>' : '<p class="dr-col-none">' + none + '</p>') +
      '</div>';
    return '<div class="dr-board"><div class="dr-sub-head"><h3>' + title + '</h3>' + (sub ? '<p>' + sub + '</p>' : '') + '</div>' +
      '<div class="dr-cols">' +
        col('is-up', '涨得最多', b.rising, '这个窗口里没有份额在涨的词条。') +
        col('is-down', '降得最多', b.falling, '这个窗口里没有份额在降的词条。') +
      '</div></div>';
  }

  function boardsHTML(m) {
    const w = windowText(m);
    const empty = !m.span || (!m.boards.industries.rising.length && !m.boards.industries.falling.length && !m.boards.apps.rising.length && !m.boards.apps.falling.length);
    return '<section class="dr-card" aria-labelledby="dr-board-h">' +
        cardHead('dr-board-h', '起落榜', w ? esc(w) : '近 4 周对比前 4 周') +
        (empty ? emptyBlock('现在的数据不够排榜：要有连续 8 周都够 10 条消息、10 个人的词条才进榜。') :
          '<div class="dr-boards">' +
            boardHTML(m, '行业', '', m.boards.industries, false) +
            boardHTML(m, '应用', '', m.boards.apps, true) +
          '</div>' +
          moreHTML('怎么读这张榜', '<p>份额 = 命中消息 ÷ 当周全部文字消息。空心点是前 4 周，实心点是近 4 周。</p>' +
            '<p>只收这 8 周每周都够 10 条消息、10 个人的词条，新冒出来的小应用上不了榜。</p>')) +
      '</section>';
  }

  function bumpHTML(m) {
    const tabs = Array.from(m.groups.values()).filter(g => m.ranks[g.key]).map(g => {
      const count = m.ranks[g.key].length;
      const ok = count >= 2;
      return '<button type="button" data-dr-group="' + esc(g.key) + '" aria-pressed="false"' + (ok ? '' : ' disabled title="' + esc('只有 ' + count + ' 个词条进过前 10，画不出名次曲线') + '"') + '>' + esc(g.label) + '</button>';
    }).join('');
    return '<section class="dr-card dr-bump-card" aria-labelledby="dr-bump-h">' +
        cardHead('dr-bump-h', '排名曲线', '每组每周的前 10 名。',
          '<div class="segmented small dr-seg" role="group" aria-label="选一组看排名" data-dr-tabs>' + tabs + '</div>') +
        '<div class="dr-bump-body" data-dr-bump-body>' +
          '<div class="dr-stage">' +
            '<div class="dr-scroll" data-dr-scroll>' +
              '<div class="dr-canvas" data-dr-canvas>' +
                '<svg class="dr-bump" data-dr-svg role="img" tabindex="0"></svg>' +
                '<svg class="dr-leaders" data-dr-leaders aria-hidden="true"></svg>' +
                '<div class="dr-notes" data-dr-notes></div>' +
                '<div class="dr-tip" data-dr-tip role="tooltip" hidden></div>' +
              '</div>' +
            '</div>' +
            '<p class="dr-scroll-hint" aria-hidden="true">左右滑动看全部 ' + esc(m.n) + ' 周</p>' +
          '</div>' +
          '<div class="dr-legend" data-dr-legend role="group" aria-label="只看一个词条"></div>' +
          moreHTML('怎么读这张图', '<p>按命中消息数排名，并列取最好名次。小圆点是「B 接替 A」的那一周。</p><p data-dr-bump-note></p>') +
        '</div>' +
        '<p class="dr-sr" data-dr-live aria-live="polite"></p>' +
      '</section>';
  }

  function coHTML(m) {
    const industries = Array.from(m.entries.values()).filter(e => e.kind === 'industry');
    const have = new Set(m.co.map(r => r.industry));
    const missing = industries.filter(e => !have.has(e.key));
    const rows = m.co.map(r => {
      const e = m.entries.get(r.industry);
      const top = r.apps[0].count;
      const cells = [0, 1, 2].map(i => {
        const a = r.apps[i];
        if (!a) return '<td><div class="dr-co is-gap"><span>不展示</span></div></td>';
        return '<td><div class="dr-co' + (i === 0 ? ' is-top' : '') + '" style="--w:' + P(a.count / top * 100) + '%"><i class="dr-co-bar" aria-hidden="true"></i>' +
          '<span class="dr-co-name">' + esc(shortLabel(m.entries.get(a.app).label)) + '</span><span class="dr-co-n">' + esc(fmt(a.count)) + ' 条</span></div></td>';
      }).join('');
      const flag = FLAGS[r.industry] ? '<span class="dr-flag" title="' + esc(FLAGS[r.industry]) + '">可能混入买卖账号</span>' : '';
      return '<tr><th scope="row"><span class="dr-co-ind">' + esc(e.label) + '</span>' + flag + '</th>' + cells + '</tr>';
    }).join('');
    return '<section class="dr-card" aria-labelledby="dr-co-h">' +
        cardHead('dr-co-h', '行业 × 应用', '同一条消息里一起出现最多的应用。') +
        (rows ?
          '<div class="dr-table-wrap"><table class="dr-table"><thead><tr><th scope="col">行业</th><th scope="col">第 1 常见</th><th scope="col">第 2 常见</th><th scope="col">第 3 常见</th></tr></thead><tbody>' + rows + '</tbody></table></div><p class="dr-scroll-hint" aria-hidden="true">左右滑动看第 2、3 常见</p>' :
          emptyBlock('还没有够 10 条消息、10 个人的行业与应用共现。')) +
        moreHTML('怎么读这张表', '<p>每个行业显示前三个应用。</p>' +
          '<p><span class="dr-hatch-key" aria-hidden="true"></span>斜线 = 这一格不够 10 条消息或 10 个人，不展示，不是 0。' +
          (missing.length ? '整行都不够的行业：' + esc(missing.map(e => e.label).join('、')) + '。' : '') + '</p>' +
          '<p>同时出现不代表因果；ChatGPT、Claude、Codex 这类高频应用在大多数行业里都会靠前。</p>') +
      '</section>';
  }

  function notesHTML(m) {
    const partial = m.weeks.filter(w => w.partial).map(w => md(w.start));
    const snap = m.d.source && validDate(m.d.source.snapshotDate) ? m.d.source.snapshotDate : '';
    const items = [
      ['份额怎么算', '分母是当周全部文字消息，分子是命中这个行业或应用的消息条数。一条消息命中多个词条，各算一次。'],
      ['不展示的格子', '当周命中不到 10 条消息，或不到 10 个人，这一格不展示：图里是断开、斜线或「不展示」，绝不会画成 0。为防止从旁边的格子反推，同一行或同一列里还会多藏一格，所以有些够数的格子也看不到。'],
      ['首尾两周不完整', partial.length ? '最早一周（' + partial[0] + ' 起）' + (partial.length > 1 ? '和最后一周（' + partial[partial.length - 1] + ' 起）' : '') + '不满 7 天' + (snap ? '，数据截至 ' + md(snap) : '') + '。份额照算，但别拿它和整周比。' : '本次数据的每一周都完整。'],
      ['行业层的意思', '行业一栏表示「群里聊到这个行业」，不等于 AI 用在这个行业。「学生」「合同」「出行」这类词会带进不少与 AI 无关的闲聊。'],
      ['电商零售', '电商一项和 Codex 同时出现的次数特别高，其中有相当一部分可能是在聊买卖账号的渠道，不代表 AI 用在电商。'],
      ['起落榜', '近 4 周对比前 4 周，份额 = 4 周命中之和 ÷ 4 周全部文字消息之和；8 周里有任何一格不展示的词条不入榜。'],
      ['接替关系', '同一组里，A 的 4 周均值比 3 周前降了至少 10%，B 涨了至少 10%，并且 B 在这一周超过了 A，下一周还保持。'],
      ['词表', '词条来自一份固定的词表，按字面匹配。同名的普通词仍可能混进来；同一产品的不同形态合并成一条（例如 ChatGPT / GPT 含 OpenAI 全系）。']
    ];
    return '<details class="dr-card dr-notes-card">' +
        '<summary><span class="dr-notes-q" aria-hidden="true">?</span><span><b>怎么读这页</b><small>份额、不展示的格子等 ' + items.length + ' 条口径</small></span><i class="dr-notes-chev" aria-hidden="true"></i></summary>' +
        '<dl class="dr-how">' + items.map(it => '<div><dt>' + esc(it[0]) + '</dt><dd>' + esc(it[1]) + '</dd></div>').join('') + '</dl>' +
      '</details>';
  }

  function footHTML(m) {
    const src = m.d.source || {};
    const rows = [];
    if (src.label) rows.push(['来源', esc(src.label)]);
    if (validDate(src.snapshotDate)) rows.push(['快照', esc(src.snapshotDate)]);
    rows.push(['口径', '北京时间自然周 · 仅文字消息 · 只含计数与比例']);
    if (m.review) rows.push(['审核', esc('主控已审' + (validDate(m.review.at) ? ' · ' + m.review.at : ''))]);
    if (m.hiddenCells !== null) rows.push(['不展示的格子', esc(fmt(m.hiddenCells)) + ' 格']);
    return '<footer class="dr-foot"><dl>' + rows.map(r => '<div><dt>' + esc(r[0]) + '</dt><dd>' + /* safe: r[1] 在上面已 esc */ r[1] + '</dd></div>').join('') + '</dl></footer>';
  }

  function pageHTML(m) {
    return '<section class="dr" data-dr-root>' +
      headHTML(m) + boardsHTML(m) + bumpHTML(m) + coHTML(m) + notesHTML(m) + footHTML(m) +
      '</section>';
  }

  function emptyPageHTML() {
    return '<section class="dr" data-dr-root data-dr-state="empty">' +
      '<header class="dr-head"><p class="dr-lede">暂无话题统计。</p></header>' +
      emptyBlock('还没有读到统计数据。') +
      '</section>';
  }

  function errorHTML() {
    return '<section class="dr" data-dr-root data-dr-state="error">' +
      '<header class="dr-head"><p class="dr-lede">话题统计</p></header>' +
      '<div class="dr-empty is-error" role="alert"><span class="dr-empty-mark" aria-hidden="true"></span>' +
        '<p>统计没读出来，原数据没有改动。</p>' +
        '<button type="button" class="button small" data-dr-retry>重试</button></div>' +
      '</section>';
  }

  let pending = null;

  function page() {
    pending = null;
    const d = source();
    if (!d) return emptyPageHTML();
    try {
      pending = build(d);
    } catch (err) {
      return errorHTML();
    }
    return pageHTML(pending);
  }

  /* ---------- 运行时 ---------- */

  let S = null;
  let D = null;

  const GL = () => window.CommonsGravity || null;

  function rope(from, to, slack, data) {
    const G = GL();
    if (G) return G.create({ from, to, slack, data });
    // 引擎缺失：退回一条静态二次弧线，接口保持一致
    const a = from;
    const b = to;
    const d = () => 'M' + P(a.x) + ' ' + P(a.y) + 'Q' + P((a.x + b.x) / 2) + ' ' + P(Math.max(a.y, b.y) + Math.abs(b.x - a.x) * 0.12) + ' ' + P(b.x) + ' ' + P(b.y);
    return { path: d, step: () => false, settled: true, data, pluck() { return this; }, drop() { return this; }, destroy() {} };
  }

  function driver(opts) {
    const G = GL();
    if (G) return G.loop(opts);
    return { add() { return this; }, remove() { return this; }, clear() { return this; }, wake() { if (opts.frame) opts.frame(16); return this; }, stop() { return this; }, running: false };
  }

  function ms(name, fallback) {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    const v = parseFloat(raw);
    return Number.isFinite(v) ? v : fallback;
  }

  function listen(bag, target, type, fn, opts) {
    if (!target) return;
    target.addEventListener(type, fn, opts);
    bag.off.push(() => target.removeEventListener(type, fn, opts));
  }

  function later(bag, fn, delay) {
    const id = setTimeout(() => {
      bag.timers = bag.timers.filter(t => t !== id);
      fn();
    }, delay);
    bag.timers.push(id);
  }

  function say(text) {
    const live = S && S.root.querySelector('[data-dr-live]');
    if (live) live.textContent = text;
  }

  /* ---------- 排名曲线 ---------- */

  function bumpModel() {
    const m = S.m;
    const list = m.ranks[S.group] || [];
    const cards = m.takeovers.filter(t => t.group === S.group);
    return { list, cards };
  }

  // 注释卡的排法：一排放得下就用完整卡；放不下就换紧凑卡，还不够就分两排、错开放
  function cardPlan(W, count, left, small) {
    const gap = 12;
    const span = W - (left - 16) - 12;
    const full = small ? 200 : 216;
    const fit = w => Math.max(1, Math.floor((span + gap) / (w + gap)));
    if (count <= fit(full)) return { w: full, h: small ? 98 : 92, rows: 1, compact: false, gap };
    const comp = small ? 164 : 176;
    return { w: comp, h: 52, rows: Math.ceil(count / fit(comp)), compact: true, gap };
  }

  function bumpGeom(W, cardCount) {
    const small = narrow();
    const rowH = small ? 30 : 34;
    const left = small ? 108 : 136;
    const right = small ? 124 : 156;
    const plan = cardPlan(W, cardCount, left, small);
    const band = cardCount ? 12 + plan.rows * (plan.h + 10) + 4 : 12;
    const top = band + 16;
    const plotH = rowH * 9;
    const H = top + plotH + 44;
    const step = (W - left - right) / Math.max(1, S.m.n - 1);
    return { W, H, left, right, top, rowH, step, band, plan, bottom: top + plotH, x: i => left + i * step, y: r => top + (r - 1) * rowH };
  }

  function drawBump() {
    const root = S.root;
    const svg = root.querySelector('[data-dr-svg]');
    const canvas = root.querySelector('[data-dr-canvas]');
    const body = root.querySelector('[data-dr-bump-body]');
    if (!svg || !canvas) return;
    const m = S.m;
    const bm = bumpModel();
    S.bm = bm;
    const group = m.groups.get(S.group);
    const gl = group ? group.label : '';
    const noteEl = root.querySelector('[data-dr-bump-note]');
    const legend = root.querySelector('[data-dr-legend]');
    const stage = root.querySelector('.dr-stage');
    const enough = bm.list.length >= 2;
    stage.hidden = !enough;
    legend.hidden = !enough;
    let empty = body.querySelector('[data-dr-bump-empty]');
    if (!enough) {
      if (!empty) {
        empty = document.createElement('div');
        empty.setAttribute('data-dr-bump-empty', '');
        body.insertBefore(empty, body.firstChild);
      }
      // safe: 固定文案 + esc 过的分组名
      empty.innerHTML = emptyBlock('「' + gl + '」这一组只有 ' + bm.list.length + ' 个词条进过前 10（要当周够 10 条消息、10 个人），画不出名次曲线。');
      noteEl.textContent = '';
      S.cardRopes = [];
      S.loop.clear();
      return;
    }
    if (empty) empty.remove();

    canvas.classList.toggle('is-enter', !!S.animate && !reduced());
    const W = Math.max(canvas.clientWidth, 320);
    const g = bumpGeom(W, bm.cards.length);
    S.g = g;
    const n = m.n;
    const keyIdx = new Map(bm.list.map((r, i) => [r.key, i]));
    svg.setAttribute('viewBox', '0 0 ' + g.W + ' ' + g.H);
    svg.setAttribute('width', g.W);
    svg.setAttribute('height', g.H);
    svg.setAttribute('aria-label', gl + '每周名次曲线，' + n + ' 周。左右方向键逐周查看。');
    canvas.style.height = g.H + 'px';
    const sc = root.querySelector('[data-dr-scroll]');
    if (sc && sc.scrollWidth > sc.clientWidth + 1) sc.scrollLeft = sc.scrollWidth;

    let html = '';
    // 横线 + 名次
    for (let r = 1; r <= 10; r++) {
      html += '<line class="dr-grid-line' + (r === 10 ? ' is-base' : '') + '" x1="' + P(g.left - 8) + '" x2="' + P(g.W - g.right + 8) + '" y1="' + P(g.y(r)) + '" y2="' + P(g.y(r)) + '"></line>' +
        '<text class="dr-axis-y" x="6" y="' + P(g.y(r)) + '">' + r + '</text>';
    }
    // 横轴
    const showTick = i => i === n - 1 || (i % 4 === 0 && n - 1 - i >= 3);
    for (let i = 0; i < n; i++) {
      const partial = m.weeks[i].partial;
      html += '<circle class="dr-axis-tick' + (partial ? ' is-partial' : '') + '" cx="' + P(g.x(i)) + '" cy="' + P(g.bottom + 16) + '" r="' + (partial ? 3 : 2) + '"></circle>';
      if (showTick(i)) {
        html += '<text class="dr-axis-x' + (i === 0 ? ' is-start' : i === n - 1 ? ' is-end' : '') + '" x="' + P(g.x(i)) + '" y="' + P(g.bottom + 36) + '">' + esc(md(m.weeks[i].start)) + '</text>';
      }
    }
    html += '<line class="dr-guide" data-dr-guide x1="0" x2="0" y1="' + P(g.top - 10) + '" y2="' + P(g.bottom + 8) + '" hidden></line>';

    // 标签位置：先收集，再在左右两列各自推开
    const leftLabels = [];
    const rightLabels = [];
    const lines = bm.list.map((r, i) => {
      const rs = runs(r.ranks);
      let d = '';
      let dots = '';
      rs.forEach(run => {
        const first = run[0];
        d += 'M' + P(g.x(first)) + ' ' + P(g.y(r.ranks[first]));
        for (let k = 1; k < run.length; k++) {
          const a = run[k - 1];
          const b = run[k];
          d += sCurve(g.x(a), g.y(r.ranks[a]), g.x(b), g.y(r.ranks[b]));
        }
        run.forEach(j => {
          dots += '<circle class="dr-dot" cx="' + P(g.x(j)) + '" cy="' + P(g.y(r.ranks[j])) + '" r="' + (run.length === 1 ? 4 : 3.25) + '"></circle>';
        });
      });
      const firstIdx = r.ranks.findIndex(isNum);
      let lastIdx = -1;
      r.ranks.forEach((v, j) => { if (isNum(v)) lastIdx = j; });
      if (firstIdx === 0) leftLabels.push({ i, y: g.y(r.ranks[0]) });
      if (lastIdx >= 0) {
        if (lastIdx === n - 1) rightLabels.push({ i, y: g.y(r.ranks[lastIdx]), edge: true });
        else rightLabels.push({ i, y: g.y(r.ranks[lastIdx]), x: g.x(lastIdx), edge: false });
      }
      return { r, d, dots };
    });
    const spread = (list, gap) => {
      list.sort((a, b) => a.y - b.y);
      list.forEach((it, k) => { it.ly = k && it.y < list[k - 1].ly + gap ? list[k - 1].ly + gap : it.y; });
      for (let k = list.length - 1; k >= 0; k--) {
        if (k < list.length - 1 && list[k].ly > list[k + 1].ly - gap) list[k].ly = list[k + 1].ly - gap;
      }
    };
    const edgeRight = rightLabels.filter(l => l.edge);
    spread(leftLabels, 15);
    spread(edgeRight, 15);
    const placed = [];
    const hitRect = (x0, y0, w, h) => placed.some(r => x0 < r.x1 && x0 + w > r.x0 && y0 < r.y1 && y0 + h > r.y0);
    const labelW = text => Array.from(text).reduce((w, ch) => w + (ch.charCodeAt(0) > 255 ? 12 : 7), 0) + 4;
    leftLabels.forEach(it => placed.push({ x0: g.x(0) - 12 - labelW(shortLabel(lines[it.i].r.label)), x1: g.x(0) - 12, y0: it.ly - 7, y1: it.ly + 7 }));
    edgeRight.forEach(it => placed.push({ x0: g.x(n - 1) + 12, x1: g.x(n - 1) + 12 + labelW(shortLabel(lines[it.i].r.label)), y0: it.ly - 7, y1: it.ly + 7 }));
    const labelOf = (it, side) => {
      const l = lines[it.i];
      const text = shortLabel(l.r.label);
      if (side === 'left') return '<text class="dr-end-label is-left" x="' + P(g.x(0) - 12) + '" y="' + P(it.ly) + '">' + esc(text) + '</text>';
      if (it.edge) return '<text class="dr-end-label" x="' + P(g.x(n - 1) + 12) + '" y="' + P(it.ly) + '">' + esc(text) + '</text>';
      const w = labelW(text);
      const spots = [[it.x + 9, it.y - 10], [it.x + 9, it.y + 10], [it.x - 9 - w, it.y - 10], [it.x - 9 - w, it.y + 10]];
      const spot = spots.find(sp => !hitRect(sp[0], sp[1] - 7, w, 14));
      if (!spot) return '';
      placed.push({ x0: spot[0], x1: spot[0] + w, y0: spot[1] - 7, y1: spot[1] + 7 });
      return '<text class="dr-end-label is-mid' + (spot[0] < it.x ? ' is-left' : '') + '" x="' + P(spot[0] < it.x ? spot[0] + w : spot[0]) + '" y="' + P(spot[1]) + '">' + esc(text) + '</text>';
    };
    lines.forEach((l, i) => {
      const r = l.r;
      const ll = leftLabels.find(it => it.i === i);
      const rl = rightLabels.find(it => it.i === i);
      html += '<g class="dr-ent" data-key="' + esc(r.key) + '" style="--c:var(--cat-' + esc(r.cat) + ')">' +
        '<path class="dr-hit" d="' + esc(l.d) + '"></path>' +
        '<path class="dr-line" d="' + esc(l.d) + '"></path>' + /* safe: 圆点只由数字坐标拼成 */ l.dots +
        (ll ? labelOf(ll, 'left') : '') + (rl ? labelOf(rl, 'right') : '') +
        '</g>';
    });
    svg.innerHTML = html;
    applyHl();

    // 图例
    legend.innerHTML = bm.list.map(r =>
      '<span class="dr-legend-item"><button type="button" class="chip dr-chip" data-dr-ent="' + esc(r.key) + '" aria-pressed="' + S.hl.has(r.key) + '" style="--c:var(--cat-' + esc(r.cat) + ')"><i aria-hidden="true"></i>' + esc(r.label) + '</button>' + topicLink((S.m.entries.get(r.key) || {}).parent || r.key, '去看') + '</span>').join('');

    drawTakeovers(keyIdx);
    const missed = bm.cards.length - (S.noteItems || []).length;
    const noteBits = ['空缺 = 当周不在前 10，或当周不够 10 条消息、10 个人，线在这里断开，不是掉到了最后一名。'];
    if (!bm.cards.length) noteBits.push('这一组在这段时间里没有出现明显的接替。');
    if (missed > 0) noteBits.push('另有 ' + missed + ' 次接替发生时双方都不在前 10，没有在曲线上标出。');
    noteEl.textContent = noteBits.join(' ');
  }

  // 接替点：优先放在两条曲线真正交叉的地方，退一步放在发生那一周
  function takeoverPoint(t) {
    const g = S.g;
    const list = S.bm.list;
    const A = list.find(r => r.key === t.from);
    const B = list.find(r => r.key === t.to);
    if (!A && !B) return null;
    const ra = A ? A.ranks : null;
    const rb = B ? B.ranks : null;
    const w = t.week;
    if (ra && rb && w > 0 && isNum(ra[w - 1]) && isNum(rb[w - 1]) && isNum(ra[w]) && isNum(rb[w])) {
      const d0 = ra[w - 1] - rb[w - 1];
      const d1 = ra[w] - rb[w];
      if (d0 * d1 < 0) {
        const q = d0 / (d0 - d1);
        const y = ra[w - 1] + (ra[w] - ra[w - 1]) * q;
        const fx = crossFrac(q);
        return { x: g.x(w - 1) + (g.x(w) - g.x(w - 1)) * fx, y: g.y(y), exact: true };
      }
    }
    const ys = [];
    if (ra && isNum(ra[w])) ys.push(ra[w]);
    if (rb && isNum(rb[w])) ys.push(rb[w]);
    if (!ys.length) return null;
    return { x: g.x(w), y: g.y(ys.reduce((s, v) => s + v, 0) / ys.length), exact: false };
  }

  const detailText = (m, t) => shortLabel(m.entries.get(t.to).label) + ' ' + pct2(t.toBefore) + ' → ' + pct2(t.toNow) + '；' +
    shortLabel(m.entries.get(t.from).label) + ' ' + pct2(t.fromBefore) + ' → ' + pct2(t.fromNow) + '（4 周均份额）';

  function drawTakeovers() {
    const root = S.root;
    const holder = root.querySelector('[data-dr-notes]');
    const ropesSvg = root.querySelector('[data-dr-leaders]');
    const g = S.g;
    S.loop.clear();
    (S.cardRopes || []).forEach(r => r.destroy());
    S.cardRopes = [];
    S.noteItems = [];
    S.ropeEls = [];
    ropesSvg.setAttribute('viewBox', '0 0 ' + g.W + ' ' + g.H);
    ropesSvg.setAttribute('width', g.W);
    ropesSvg.setAttribute('height', g.H);
    const m = S.m;
    const items = S.bm.cards.map(t => ({ t, pt: takeoverPoint(t) })).filter(it => it.pt);
    if (!items.length) {
      holder.innerHTML = '';
      ropesSvg.innerHTML = '';
      return;
    }
    const plan = g.plan;
    const cardW = plan.w;
    const gap = plan.gap;
    items.forEach(it => { it.want = it.pt.x; });
    items.sort((a, b) => a.want - b.want);
    items.forEach((it, i) => { it.row = i % plan.rows; });
    const lo = g.left - 16 + cardW / 2;
    const hi = g.W - 12 - cardW / 2;
    for (let r = 0; r < plan.rows; r++) {
      const rowItems = items.filter(it => it.row === r);
      rowItems.forEach((it, i) => {
        it.cx = clamp(it.want, lo, hi);
        if (i && it.cx < rowItems[i - 1].cx + cardW + gap) it.cx = rowItems[i - 1].cx + cardW + gap;
      });
      for (let i = rowItems.length - 1; i >= 0; i--) {
        if (rowItems[i].cx > hi) rowItems[i].cx = hi;
        if (i < rowItems.length - 1 && rowItems[i].cx > rowItems[i + 1].cx - cardW - gap) rowItems[i].cx = rowItems[i + 1].cx - cardW - gap;
      }
    }
    S.noteItems = items;
    const catOfKey = k => (S.bm.list.find(r => r.key === k) || { cat: 1 }).cat;
    holder.innerHTML = items.map((it, i) => {
      const t = it.t;
      const a = m.entries.get(t.from);
      const b = m.entries.get(t.to);
      const c = catOfKey(t.to);
      const pressed = S.hl.has(t.from) && S.hl.has(t.to);
      return '<button type="button" class="dr-note" data-dr-note="' + i + '" style="--c:var(--cat-' + esc(c) + ');--i:' + i + ';left:' + P(it.cx - cardW / 2) + 'px;top:' + P(12 + it.row * (plan.h + 10)) + 'px;width:' + esc(cardW) + 'px" aria-pressed="' + pressed + '" title="' + esc(detailText(m, t)) + '" ' +
          'aria-label="' + esc(shortLabel(b.label) + ' 接替 ' + shortLabel(a.label) + '，' + weekLabel(m.weeks[t.week].start) + '。点一下只看这两条') + '">' +
        '<span class="dr-note-k">' + esc(weekLabel(m.weeks[t.week].start)) + ' · 接替</span>' +
        '<span class="dr-note-t">' + esc(shortLabel(b.label)) + ' 接替 ' + esc(shortLabel(a.label)) + '</span>' +
        (plan.compact ? '' : '<span class="dr-note-m">' + esc(shortLabel(b.label)) + ' ' + pct2(t.toBefore) + ' → ' + pct2(t.toNow) + '<br>' + esc(shortLabel(a.label)) + ' ' + pct2(t.fromBefore) + ' → ' + pct2(t.fromNow) + '</span>') +
      '</button>';
    }).join('');
    const cards = Array.from(holder.querySelectorAll('[data-dr-note]'));
    let svgHtml = '';
    items.forEach((it, i) => {
      const card = cards[i];
      const c = catOfKey(it.t.to);
      const bottom = card.offsetTop + card.offsetHeight;
      let ax = it.cx + (it.pt.x > it.cx ? -1 : 1) * cardW * 0.18;
      if (Math.abs(ax - it.pt.x) < 48) ax = it.cx + (it.pt.x > it.cx ? -1 : 1) * (cardW / 2 - 24);
      const from = { x: ax, y: bottom - 1 };
      const to = { x: it.pt.x, y: it.pt.y - 5 };
      const r = rope(from, to, 1.06, { i });
      S.cardRopes.push(r);
      S.loop.add(r);
      svgHtml += '<path class="dr-rope" data-dr-rope="' + i + '" style="--c:var(--cat-' + esc(c) + ')" d="' + esc(r.path()) + '"></path>' +
        '<circle class="dr-eyelet" style="--c:var(--cat-' + esc(c) + ')" cx="' + P(from.x) + '" cy="' + P(from.y) + '" r="2.5"></circle>' +
        '<g class="dr-mark" style="--c:var(--cat-' + esc(c) + ')"><circle class="dr-mark-halo" cx="' + P(it.pt.x) + '" cy="' + P(it.pt.y) + '" r="9"></circle>' +
        '<circle class="dr-mark-dot" cx="' + P(it.pt.x) + '" cy="' + P(it.pt.y) + '" r="4.5"></circle></g>';
    });
    ropesSvg.innerHTML = svgHtml;
    S.ropeEls = Array.from(ropesSvg.querySelectorAll('[data-dr-rope]'));
    if (S.animate && !reduced()) {
      S.cardRopes.forEach((r, i) => later(S, () => {
        if (!S || S.cardRopes[i] !== r) return;
        r.drop();
        S.loop.wake();
      }, i * ms('--stagger', 32) * 2));
    }
    S.animate = false;
  }

  function ropeFrame() {
    if (!S || !S.ropeEls) return false;
    S.cardRopes.forEach((r, i) => {
      const el = S.ropeEls[i];
      if (el) el.setAttribute('d', r.path());
    });
    return false;
  }

  function applyHl() {
    const svg = S.root.querySelector('[data-dr-svg]');
    if (!svg) return;
    if (S.hl.size) svg.setAttribute('data-hl', '1'); else svg.removeAttribute('data-hl');
    svg.querySelectorAll('.dr-ent').forEach(el => el.classList.toggle('is-hl', S.hl.has(el.getAttribute('data-key'))));
    S.root.querySelectorAll('[data-dr-ent]').forEach(b => b.setAttribute('aria-pressed', String(S.hl.has(b.getAttribute('data-dr-ent')))));
    S.root.querySelectorAll('[data-dr-note]').forEach((b, i) => {
      const it = S.noteItems && S.noteItems[i];
      b.setAttribute('aria-pressed', String(!!it && S.hl.has(it.t.from) && S.hl.has(it.t.to)));
    });
  }

  function toggleEntry(key) {
    if (S.hl.size === 1 && S.hl.has(key)) S.hl = new Set(); else S.hl = new Set([key]);
    applyHl();
    const e = S.m.entries.get(key);
    say(S.hl.size && e ? '只看「' + e.label + '」' : '看全部词条');
  }

  function toggleNote(i) {
    const it = S.noteItems && S.noteItems[i];
    if (!it) return;
    const same = S.hl.size === 2 && S.hl.has(it.t.from) && S.hl.has(it.t.to);
    S.hl = same ? new Set() : new Set([it.t.from, it.t.to]);
    applyHl();
    say(same ? '看全部词条' : '只看「' + S.m.entries.get(it.t.to).label + '」和「' + S.m.entries.get(it.t.from).label + '」');
  }

  function setGroup(key) {
    if (!S || S.group === key || !S.m.ranks[key] || S.m.ranks[key].length < 2) return;
    S.group = key;
    S.hl = new Set();
    S.week = -1;
    S.animate = true;
    S.root.querySelectorAll('[data-dr-group]').forEach(b => b.setAttribute('aria-pressed', String(b.getAttribute('data-dr-group') === key)));
    hideTip();
    drawBump();
    const g = S.m.groups.get(key);
    say('切换到「' + (g ? g.label : '') + '」');
  }

  /* ---------- 浮层与悬停 ---------- */

  function placeTip(tip, host, scroll, x, y) {
    tip.hidden = false;
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    let lo = 8;
    let hi = host.clientWidth - w - 8;
    if (scroll) {
      lo = Math.max(lo, scroll.scrollLeft + 8);
      hi = Math.min(hi, scroll.scrollLeft + scroll.clientWidth - w - 8);
    }
    let left = x + 16;
    if (left > hi) left = x - w - 16;
    left = clamp(left, lo, Math.max(lo, hi));
    const top = clamp(y - h / 2, 4, Math.max(4, host.clientHeight - h - 4));
    tip.style.left = P(left) + 'px';
    tip.style.top = P(top) + 'px';
    tip.setAttribute('data-show', '');
  }

  function hideTip() {
    if (!S) return;
    const tip = S.root.querySelector('[data-dr-tip]');
    const guide = S.root.querySelector('[data-dr-guide]');
    if (tip) {
      tip.removeAttribute('data-show');
      tip.hidden = true;
    }
    if (guide) guide.hidden = true;
    S.week = -1;
  }

  function bumpTip(i, y) {
    const m = S.m;
    const g = S.g;
    const list = S.bm.list;
    const tip = S.root.querySelector('[data-dr-tip]');
    const guide = S.root.querySelector('[data-dr-guide]');
    const host = S.root.querySelector('[data-dr-canvas]');
    const scroll = S.root.querySelector('[data-dr-scroll]');
    if (!tip || !guide) return;
    S.week = i;
    guide.setAttribute('x1', P(g.x(i)));
    guide.setAttribute('x2', P(g.x(i)));
    guide.hidden = false;
    const w = m.weeks[i];
    const rows = list.filter(r => isNum(r.ranks[i])).sort((a, b) => a.ranks[i] - b.ranks[i]);
    const hidden = list.filter(r => !isNum(r.ranks[i]));
    tip.innerHTML = '<div class="dr-tip-t">' + esc(md(w.start)) + '<span>' + esc(weekLabel(w.start)) + (w.partial ? ' · 不满一周' : '') + '</span></div>' +
      (rows.length ? '<ul class="dr-tip-rows">' + rows.map(r => {
        const e = m.entries.get(r.key);
        const sh = e.share && isNum(e.share[i]) ? pct2(e.share[i]) : '';
        return '<li><i style="--c:var(--cat-' + esc(r.cat) + ')"></i><span>' + esc(shortLabel(r.label)) + '</span><b>第 ' + esc(r.ranks[i]) + (sh ? ' · ' + sh : '') + '</b></li>';
      }).join('') + '</ul>' : '<p class="dr-tip-m">这周这一组没有词条进前 10。</p>') +
      (hidden.length && rows.length ? '<p class="dr-tip-m">' + hidden.length + ' 个词条这周不在前 10 或不够 10 条消息、10 个人，不展示。</p>' : '');
    placeTip(tip, host, scroll, g.x(i), y);
    say(md(w.start) + ' 这周：' + rows.map(r => shortLabel(r.label) + ' 第 ' + r.ranks[i]).join('，'));
  }

  function onBumpMove(e) {
    if (!S || !S.g) return;
    const svg = e.currentTarget;
    const r = svg.getBoundingClientRect();
    const scale = r.width / S.g.W || 1;
    const x = (e.clientX - r.left) / scale;
    const y = (e.clientY - r.top) / scale;
    const g = S.g;
    if (x < g.left - 24 || x > g.W - g.right + 24) {
      hideTip();
    } else {
      const i = clamp(Math.round((x - g.left) / g.step), 0, S.m.n - 1);
      if (i !== S.week) bumpTip(i, y);
    }
    const ent = e.target.closest ? e.target.closest('.dr-ent') : null;
    const key = ent ? ent.getAttribute('data-key') : '';
    if (key !== S.peek) {
      S.peek = key;
      if (key) svg.setAttribute('data-peek', key); else svg.removeAttribute('data-peek');
      svg.querySelectorAll('.dr-ent').forEach(el => el.classList.toggle('is-peek', !!key && el.getAttribute('data-key') === key));
    }
  }

  function onBumpLeave() {
    if (!S) return;
    hideTip();
    S.peek = '';
    const svg = S.root.querySelector('[data-dr-svg]');
    if (svg) {
      svg.removeAttribute('data-peek');
      svg.querySelectorAll('.dr-ent.is-peek').forEach(el => el.classList.remove('is-peek'));
    }
  }

  function onBumpClick(e) {
    const ent = e.target.closest ? e.target.closest('.dr-ent') : null;
    if (ent) toggleEntry(ent.getAttribute('data-key'));
  }

  function onBumpKey(e) {
    if (!S || !S.g) return;
    const n = S.m.n;
    if (e.key === 'Escape') {
      hideTip();
      if (S.hl.size) { S.hl = new Set(); applyHl(); }
      return;
    }
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    let i = S.week < 0 ? (e.key === 'ArrowLeft' ? n - 1 : 0) : S.week + (e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0);
    if (e.key === 'Home') i = 0;
    if (e.key === 'End') i = n - 1;
    i = clamp(i, 0, n - 1);
    bumpTip(i, S.g.top + S.g.rowH * 3);
    const scroll = S.root.querySelector('[data-dr-scroll]');
    if (scroll && scroll.scrollWidth > scroll.clientWidth) {
      const x = S.g.x(i);
      if (x < scroll.scrollLeft + 40 || x > scroll.scrollLeft + scroll.clientWidth - 40) scroll.scrollLeft = x - scroll.clientWidth / 2;
    }
  }

  function onClick(e) {
    const t = e.target;
    const tab = t.closest('[data-dr-group]');
    if (tab && S.root.contains(tab)) { setGroup(tab.getAttribute('data-dr-group')); return; }
    const chip = t.closest('[data-dr-ent]');
    if (chip && S.root.contains(chip)) { toggleEntry(chip.getAttribute('data-dr-ent')); return; }
    const note = t.closest('[data-dr-note]');
    if (note && S.root.contains(note)) { toggleNote(Number(note.getAttribute('data-dr-note'))); return; }
    if (t.closest('[data-dr-retry]')) retry();
  }

  function onOver(e) {
    const note = e.target.closest ? e.target.closest('[data-dr-note]') : null;
    if (note && S.root.contains(note)) {
      if (note !== S.lastNote) {
        const r = S.cardRopes && S.cardRopes[Number(note.getAttribute('data-dr-note'))];
        if (r) {
          r.pluck(4.5);
          S.loop.wake();
        }
      }
      S.lastNote = note;
      return;
    }
    S.lastNote = null;
    const chip = e.target.closest ? e.target.closest('[data-dr-ent]') : null;
    const svg = S.root.querySelector('[data-dr-svg]');
    if (!svg) return;
    const key = chip && S.root.contains(chip) ? chip.getAttribute('data-dr-ent') : '';
    if (!chip && !S.peekChip) return;
    S.peekChip = !!key;
    svg.querySelectorAll('.dr-ent').forEach(el => el.classList.toggle('is-peek', !!key && el.getAttribute('data-key') === key));
    if (key) svg.setAttribute('data-peek', key); else svg.removeAttribute('data-peek');
  }

  function retry() {
    const root = document.querySelector('[data-dr-root]');
    if (!root) return;
    const html = page();
    destroy();
    root.outerHTML = html;
    mount();
  }

  /* ---------- 下钻：群的走向页里，大话题下面的行业和应用 ---------- */

  function drillChange(m, key) {
    return m.changeOf(key);
  }

  function drillHTML(m, detail, items, shown, hidden) {
    const topicNames = (detail.topics || []).map(k => m.topics.get(k) || '').filter(Boolean);
    const title = '「' + esc(detail.label || topicNames.join('、')) + '」' + ((detail.topics || []).length > 1 ? '（' + esc(topicNames.join('、')) + '）' : '') + '下面的行业和应用';
    const note = [];
    if (detail.synthetic) note.push('上面的话题流图是示例，下面这些行业和应用的数字来自真实记录。');
    if (hidden.length) note.push('<span class="dr-hatch-key" aria-hidden="true"></span>不够 10 条消息或 10 个人、整段都不展示的词条：' + esc(hidden.slice(0, 8).map(e => e.label).join('、')) + (hidden.length > 8 ? ' 等 ' + hidden.length + ' 个' : '') + '。');
    if (shown.length) note.push('虚线 = 中间有周不展示，两头是连起来的；首尾两周不满 7 天。');
    if (shown.length) note.push('行业表示「群里聊到这个行业」，不等于 AI 用在这个行业。');
    if (shown.length) note.unshift('每周份额 = 命中消息 ÷ 当周全部文字消息。右边是近 4 周对前 4 周的变化。');
    const head = '<header class="dr-drill-head"><div><h3>' + title + '</h3></div>' +
      '<a class="dr-drill-link" href="#/drift">看完整的话题漂移</a></header>';
    if (!items.length) {
      return '<div class="dr-drill" data-dr-drill>' + head + emptyBlock('这个话题下面还没有收录行业或应用词条。') + '</div>';
    }
    if (!shown.length) {
      return '<div class="dr-drill" data-dr-drill>' + head + emptyBlock('这个话题下面的 ' + items.length + ' 个词条，每周都不够 10 条消息、10 个人，画不出线。') +
        moreHTML('说明', note.map(n => '<p>' + n /* safe: 说明句在生成处已转义 */ + '</p>').join('')) + '</div>';
    }
    return '<div class="dr-drill" data-dr-drill>' + head +
      '<div class="dr-drill-body">' +
        '<div class="dr-dchart" data-dr-dchart><svg class="dr-dsvg" data-dr-dsvg role="img" tabindex="0"></svg><div class="dr-tip" data-dr-dtip role="tooltip" hidden></div></div>' +
        '<ul class="dr-dlist" data-dr-dlist>' + shown.map((e, i) => {
          const c = drillChange(m, e.key);
          const g = m.groups.get(e.group);
          const dir = c ? (c.delta >= 0 ? 'up' : 'down') : 'none';
          return '<li class="dr-dli" data-dr-dkey="' + esc(e.key) + '" data-dir="' + dir + '" style="--c:var(--cat-' + catOf(i) + ')">' +
            '<i class="dr-dsw" aria-hidden="true"></i>' +
            '<span class="dr-dname"><b>' + esc(e.label) + '</b><em>' + esc(g ? g.label : '') + '</em></span>' +
            (c ? '<span class="dr-dvals">' + pct2(c.previous) + ' → <b>' + pct2(c.recent) + '</b></span><span class="dr-delta"><i class="dr-arrow" aria-hidden="true"></i>' + pts(c.delta) + '</span>' :
              '<span class="dr-dnone">' + esc(e.share.filter(isNum).length) + ' 周够数 · 近 8 周不全，不算涨跌</span>') +
          '</li>';
        }).join('') + '</ul>' +
      '</div>' +
      moreHTML('怎么读这张图', note.map(n => '<p>' + n /* safe: 说明句在生成处已转义 */ + '</p>').join('')) +
      '</div>';
  }

  function drillShow(detail) {
    const slot = detail.slot;
    if (!slot) return;
    D.off.splice(0).forEach(fn => fn());
    if (!detail.key) {
      slot.innerHTML = '';
      slot.hidden = true;
      D.cur = null;
      return;
    }
    const d = source();
    let m = null;
    if (d) {
      try { m = build(d); } catch (err) { m = null; }
    }
    slot.hidden = false;
    if (!m) {
      // safe: 固定文案
      slot.innerHTML = '<div class="dr-drill" data-dr-drill>' + emptyBlock('行业和应用的细分统计还没有接入，或格式对不上，所以这里先留空。') + '</div>';
      D.cur = null;
      return;
    }
    const topics = new Set(detail.topics || [detail.key]);
    const items = Array.from(m.entries.values()).filter(e => topics.has(e.parent));
    const withData = items.filter(e => e.share && e.share.some(isNum));
    const total = e => e.hits.reduce((s, v) => s + (isNum(v) ? v : 0), 0);
    withData.sort((a, b) => total(b) - total(a));
    const hidden = items.filter(e => !withData.includes(e));
    const shown = withData.slice(0, 9);
    // safe: 所有数据字段已 esc，其余为固定文案
    slot.innerHTML = drillHTML(m, detail, items, shown, hidden);
    D.cur = { m, detail, shown };
    drillChart(true);
  }

  function drillChart(enter) {
    if (!D || !D.cur) return;
    D.off.splice(0).forEach(fn => fn());
    const { m, shown, detail } = D.cur;
    const slot = detail.slot;
    const svg = slot.querySelector('[data-dr-dsvg]');
    const host = slot.querySelector('[data-dr-dchart]');
    if (!svg || !host) return;
    const W = Math.max(host.clientWidth, 280);
    const small = W < 460;
    const H = small ? 240 : 272;
    const g = { left: 44, right: small ? 14 : 20, top: 14, bottom: H - 40 };
    const n = m.n;
    const x = i => g.left + (W - g.left - g.right) * i / Math.max(1, n - 1);
    let max = 0;
    shown.forEach(e => e.share.forEach(v => { if (isNum(v) && v > max) max = v; }));
    const step = niceStep(max || 0.001);
    const top = Math.max(step, Math.ceil(max / step - 1e-9) * step);
    const y = v => g.bottom - (g.bottom - g.top) * v / top;
    svg.classList.toggle('is-enter', !!enter && !reduced());
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('width', W);
    svg.setAttribute('height', H);
    svg.setAttribute('aria-label', (detail.label || '') + '下面的行业和应用，每周份额折线，' + n + ' 周。');
    let html = '';
    for (let v = 0; v <= top + step / 2; v += step) {
      html += '<line class="dr-grid-line' + (v === 0 ? ' is-base' : '') + '" x1="' + g.left + '" x2="' + P(W - g.right) + '" y1="' + P(y(v)) + '" y2="' + P(y(v)) + '"></line>' +
        '<text class="dr-axis-y is-in" x="' + (g.left - 8) + '" y="' + P(y(v)) + '">' + (v * 100).toFixed(step < 0.001 ? 2 : step < 0.01 ? 1 : 0) + '%</text>';
    }
    const showTick = i => i === n - 1 || (i % 4 === 0 && n - 1 - i >= 3);
    for (let i = 0; i < n; i++) {
      const partial = m.weeks[i].partial;
      html += '<circle class="dr-axis-tick' + (partial ? ' is-partial' : '') + '" cx="' + P(x(i)) + '" cy="' + (g.bottom + 14) + '" r="' + (partial ? 3 : 2) + '"></circle>';
      if (showTick(i)) html += '<text class="dr-axis-x' + (i === 0 ? ' is-start' : i === n - 1 ? ' is-end' : '') + '" x="' + P(x(i)) + '" y="' + (g.bottom + 32) + '">' + esc(md(m.weeks[i].start)) + '</text>';
    }
    html += '<line class="dr-guide" data-dr-dguide x1="0" x2="0" y1="' + g.top + '" y2="' + g.bottom + '" hidden></line>';
    shown.forEach((e, k) => {
      const rs = runs(e.share);
      let d = '';
      let dots = '';
      let gaps = '';
      rs.forEach((run, ri) => {
        d += monotone(run.map(i => [x(i), y(e.share[i])]));
        run.forEach(i => { dots += '<circle class="dr-ddot" cx="' + P(x(i)) + '" cy="' + P(y(e.share[i])) + '" r="' + (run.length === 1 ? 3.5 : 2.5) + '"></circle>'; });
        if (ri) {
          const a = rs[ri - 1][rs[ri - 1].length - 1];
          const b = run[0];
          gaps += '<line class="dr-gap" x1="' + P(x(a)) + '" y1="' + P(y(e.share[a])) + '" x2="' + P(x(b)) + '" y2="' + P(y(e.share[b])) + '"></line>';
        }
      });
      html += '<g class="dr-dent" data-dr-dkey="' + esc(e.key) + '" style="--c:var(--cat-' + catOf(k) + ')">' + gaps + '<path class="dr-dline" d="' + d + '"></path>' + dots + '</g>';
    });
    svg.innerHTML = html;
    const tip = slot.querySelector('[data-dr-dtip]');
    const guide = svg.querySelector('[data-dr-dguide]');
    let cur = -1;
    const hide = () => {
      cur = -1;
      guide.hidden = true;
      tip.removeAttribute('data-show');
      tip.hidden = true;
    };
    const show = (i, py) => {
      cur = i;
      guide.setAttribute('x1', P(x(i)));
      guide.setAttribute('x2', P(x(i)));
      guide.hidden = false;
      const w = m.weeks[i];
      const rows = shown.map((e, k) => ({ e, k, v: e.share[i] })).sort((a, b) => (isNum(b.v) ? b.v : -1) - (isNum(a.v) ? a.v : -1));
      tip.innerHTML = '<div class="dr-tip-t">' + esc(md(w.start)) + '<span>' + esc(weekLabel(w.start)) + (w.partial ? ' · 不满一周' : '') + '</span></div>' +
        '<ul class="dr-tip-rows">' + rows.map(r => '<li class="' + (isNum(r.v) ? '' : 'is-none') + '"><i style="--c:var(--cat-' + catOf(r.k) + ')"></i><span>' + esc(shortLabel(r.e.label)) + '</span><b>' + (isNum(r.v) ? pct2(r.v) : '不展示') + '</b></li>').join('') + '</ul>';
      placeTip(tip, host, null, x(i), py);
    };
    const move = e => {
      const r = svg.getBoundingClientRect();
      const sc = r.width / W || 1;
      const px = (e.clientX - r.left) / sc;
      const py = (e.clientY - r.top) / sc;
      if (px < g.left - 16 || px > W - g.right + 16) { hide(); return; }
      const i = clamp(Math.round((px - g.left) / ((W - g.left - g.right) / Math.max(1, n - 1))), 0, n - 1);
      if (i !== cur) show(i, py);
    };
    const key = e => {
      if (e.key === 'Escape') { hide(); return; }
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const i = clamp(cur < 0 ? (e.key === 'ArrowLeft' ? n - 1 : 0) : cur + (e.key === 'ArrowRight' ? 1 : -1), 0, n - 1);
      show(i, g.top + 60);
    };
    const peek = k => {
      svg.querySelectorAll('.dr-dent').forEach(el => el.classList.toggle('is-peek', !!k && el.getAttribute('data-dr-dkey') === k));
      if (k) svg.setAttribute('data-peek', k); else svg.removeAttribute('data-peek');
      slot.querySelectorAll('.dr-dli').forEach(el => el.classList.toggle('is-peek', !!k && el.getAttribute('data-dr-dkey') === k));
    };
    const over = e => {
      const li = e.target.closest ? e.target.closest('.dr-dli') : null;
      const ent = e.target.closest ? e.target.closest('.dr-dent') : null;
      peek(li ? li.getAttribute('data-dr-dkey') : ent ? ent.getAttribute('data-dr-dkey') : '');
    };
    const leave = () => { hide(); peek(''); };
    const list = slot.querySelector('[data-dr-dlist]');
    [[svg, 'pointermove', move], [svg, 'pointerleave', leave], [svg, 'keydown', key], [svg, 'blur', hide], [svg, 'pointerover', over], [list, 'pointerover', over], [list, 'pointerleave', () => peek('')]]
      .forEach(a => listen(D, a[0], a[1], a[2]));
  }

  function onTopic(e) {
    if (!D) return;
    const detail = e && e.detail;
    if (!detail || !detail.slot) return;
    drillShow(detail);
  }

  /* ---------- 生命周期 ---------- */

  function mountPage(root) {
    let model = pending;
    if (!model && !root.hasAttribute('data-dr-state')) {
      const d = source();
      try {
        model = d ? build(d) : null;
      } catch (err) {
        model = null;
      }
    }
    S = {
      root,
      m: model,
      off: [],
      timers: [],
      observers: [],
      hl: new Set(),
      group: '',
      week: -1,
      peek: '',
      animate: true,
      width: 0
    };
    S.loop = driver({ frame: ropeFrame });
    listen(S, root, 'click', onClick);
    if (!model) return;
    listen(S, root, 'pointerover', onOver);
    const tabs = Array.from(model.groups.keys()).filter(k => model.ranks[k] && model.ranks[k].length >= 2);
    S.group = tabs.includes('models') ? 'models' : tabs[0] || '';
    root.querySelectorAll('[data-dr-group]').forEach(b => b.setAttribute('aria-pressed', String(b.getAttribute('data-dr-group') === S.group)));
    if (S.group) {
      const svg = root.querySelector('[data-dr-svg]');
      drawBump();
      listen(S, svg, 'pointermove', onBumpMove);
      listen(S, svg, 'pointerleave', onBumpLeave);
      listen(S, svg, 'click', onBumpClick);
      listen(S, svg, 'keydown', onBumpKey);
      listen(S, svg, 'blur', hideTip);
    } else {
      const body = root.querySelector('[data-dr-bump-body]');
      // safe: 固定文案
      if (body) body.innerHTML = emptyBlock('没有哪一组有两个以上进过前 10 的词条，画不出名次曲线。');
    }
    S.width = root.clientWidth;
    if (typeof ResizeObserver === 'function') {
      let frame = 0;
      const ro = new ResizeObserver(() => {
        if (!S || Math.abs(root.clientWidth - S.width) < 1) return;
        S.width = root.clientWidth;
        clearTimeout(frame);
        frame = setTimeout(() => {
          if (!S || !S.group) return;
          S.animate = false;
          drawBump();
        }, 60);
        S.timers.push(frame);
      });
      ro.observe(root);
      S.observers.push(ro);
    }
  }

  function mountDrill(ins) {
    D = { off: [], perm: [], timers: [], observers: [], cur: null };
    document.addEventListener('insights:topic', onTopic);
    D.perm.push(() => document.removeEventListener('insights:topic', onTopic));
    if (typeof ResizeObserver === 'function') {
      let w = ins.clientWidth;
      let frame = 0;
      const ro = new ResizeObserver(() => {
        if (!D || Math.abs(ins.clientWidth - w) < 1) return;
        w = ins.clientWidth;
        clearTimeout(frame);
        frame = setTimeout(() => D && D.cur && drillChart(), 80);
        D.timers.push(frame);
      });
      ro.observe(ins);
      D.observers.push(ro);
    }
  }

  function mount() {
    const root = document.querySelector('[data-dr-root]');
    const ins = document.querySelector('[data-ins-root]');
    if (S && S.root === root && root) return;
    destroy();
    if (root) mountPage(root);
    if (ins) mountDrill(ins);
  }

  function destroy() {
    if (S) {
      S.off.forEach(fn => fn());
      S.timers.forEach(id => clearTimeout(id));
      S.observers.forEach(o => o.disconnect());
      S.loop.stop();
      (S.cardRopes || []).forEach(r => r.destroy());
      S = null;
    }
    if (D) {
      D.off.forEach(fn => fn());
      (D.perm || []).forEach(fn => fn());
      D.timers.forEach(id => clearTimeout(id));
      D.observers.forEach(o => o.disconnect());
      D = null;
    }
  }

  if (window.CommonsLinks && typeof window.CommonsLinks.provide === 'function') {
    window.CommonsLinks.provide('drift', function () {
      return { label: '话题漂移', href: '#/drift', icon: 'chart' };
    });
  }

  window.CommonsDrift = {
    routes: { drift: page },
    hub: ['drift'],
    nav: [['drift', '话题漂移', 'chart', 'data']],
    mount,
    destroy
  };
  (window.CommonsPages = window.CommonsPages || []).push(window.CommonsDrift);
})();
