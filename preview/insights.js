/* R13 VIZ-1 · 群的走向（#/insights）
 * 读 window.COMMONS_INSIGHTS（DATA-1 匿名聚合）；还没有时读 window.COMMONS_INSIGHTS_SAMPLE（合成示例，整页挂「示例数据」）。
 * 话题漂移 = 流图（wiggle 偏移 + 插入式排序 + B 样条平滑，转折点用重力引线连到注释卡）；群体成长 = 留存曲线 + 成长阶梯；
 * 角色变化 = 小倍数；页底 = 重力线演示。null 是「单格不足 10 人被抑制」：画成斜纹或断开，浮层写「不足 10 人」，从不画成 0。
 * 导出 window.CommonsInsights = { routes: { insights }, mount, destroy }；依赖 gravity-line.js（缺了退回静态弧线）。
 */
(function () {
  'use strict';

  const MOBILE = 760;
  const ROLES = [
    { key: 'askers', label: '提问的人', short: '提问', cat: 2 },
    { key: 'answerers', label: '回答的人', short: '回答', cat: 1 },
    { key: 'sharers', label: '分享链接的人', short: '分享链接', cat: 8 }
  ];
  const STEPS = [
    { key: 'firstQuestion', label: '第一次提问', cat: 2 },
    { key: 'firstAnswer', label: '第一次回答', cat: 1 },
    { key: 'firstShare', label: '第一次分享链接', cat: 8 }
  ];
  const DEMO_NODES = [
    { label: '进群', x: 0.09, y: 0.34, c: 'var(--cat-10)' },
    { label: '提问', x: 0.3, y: 0.7, c: 'var(--cat-2)' },
    { label: '回答', x: 0.5, y: 0.3, c: 'var(--cat-1)' },
    { label: '分享', x: 0.71, y: 0.72, c: 'var(--cat-8)' },
    { label: '整理成知识', x: 0.9, y: 0.36, c: 'var(--agent)' }
  ];
  const DEMO_LINKS = [[0, 1], [1, 2], [2, 3], [3, 4], [2, 4], [1, 3]];

  const nf = typeof Intl === 'object' && Intl.NumberFormat ? new Intl.NumberFormat('zh-CN') : null;
  const fmt = n => (nf ? nf.format(n) : String(n));
  const isNum = v => typeof v === 'number' && Number.isFinite(v);
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const f1 = v => (Math.round(v * 10) / 10).toString();
  const medianText = v => (v === 0 ? '一半人当天就做了' : '中位 ' + f1(v) + ' 天');
  const pct = (v, d) => (v * 100).toFixed(d === undefined ? 1 : d) + '%';
  const signed = (v, d) => (v > 0 ? '+' : v < 0 ? '−' : '±') + Math.abs(v).toFixed(d === undefined ? 1 : d);
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
  const validMonth = s => typeof s === 'string' && /^\d{4}-\d{2}$/.test(s);
  const addDays = (s, n) => {
    const d = new Date(s + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const dayDiff = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);
  const short = s => String(s || '').slice(5).replace('-', '.');
  const monthLabel = ym => Number(String(ym).slice(5, 7)) + ' 月';
  const weekLabel = s => Number(s.slice(5, 7)) + ' 月第 ' + Math.ceil(Number(s.slice(8, 10)) / 7) + ' 周';
  const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const narrow = () => window.innerWidth <= MOBILE;
  const P = v => (Math.round(v * 10) / 10).toString();
  const sum = list => list.reduce((s, v) => s + (isNum(v) ? v : 0), 0);
  const mean = list => {
    const ok = list.filter(isNum);
    return ok.length ? sum(ok) / ok.length : null;
  };

  /* ---------- 曲线 ---------- */

  // d3 curveBasis：流图层边界用。相邻边界的差也是 B 样条，层厚 ≥ 0 时永远不会交叉
  function basis(pts, move) {
    const n = pts.length;
    if (!n) return '';
    let d = (move ? 'M' : 'L') + P(pts[0][0]) + ' ' + P(pts[0][1]);
    if (n < 3) {
      for (let i = 1; i < n; i++) d += 'L' + P(pts[i][0]) + ' ' + P(pts[i][1]);
      return d;
    }
    let [x0, y0] = pts[0];
    let [x1, y1] = pts[1];
    d += 'L' + P((5 * x0 + x1) / 6) + ' ' + P((5 * y0 + y1) / 6);
    const seg = (x, y) => {
      d += 'C' + P((2 * x0 + x1) / 3) + ' ' + P((2 * y0 + y1) / 3) + ' ' + P((x0 + 2 * x1) / 3) + ' ' + P((y0 + 2 * y1) / 3) + ' ' +
        P((x0 + 4 * x1 + x) / 6) + ' ' + P((y0 + 4 * y1 + y) / 6);
    };
    for (let i = 2; i < n; i++) {
      const [x, y] = pts[i];
      seg(x, y);
      x0 = x1; y0 = y1; x1 = x; y1 = y;
    }
    seg(x1, y1);
    return d + 'L' + P(x1) + ' ' + P(y1);
  }

  // B 样条在第 j 个节点处的实际位置
  const basisAt = (arr, j) => (j <= 0 || j >= arr.length - 1 ? arr[clamp(j, 0, arr.length - 1)] : (arr[j - 1] + 4 * arr[j] + arr[j + 1]) / 6);

  // 单调三次插值（Fritsch–Carlson）：留存和角色曲线过每个数据点、不过冲
  function monotone(pts, move) {
    const n = pts.length;
    if (!n) return '';
    let d = (move === false ? 'L' : 'M') + P(pts[0][0]) + ' ' + P(pts[0][1]);
    if (n === 1) return d;
    if (n === 2) return d + 'L' + P(pts[1][0]) + ' ' + P(pts[1][1]);
    const h = [];
    const s = [];
    for (let i = 0; i < n - 1; i++) {
      h.push(pts[i + 1][0] - pts[i][0]);
      s.push((pts[i + 1][1] - pts[i][1]) / (h[i] || 1));
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
      d += 'C' + P(pts[i][0] + dx) + ' ' + P(pts[i][1] + dx * t[i]) + ' ' + P(pts[i + 1][0] - dx) + ' ' + P(pts[i + 1][1] - dx * t[i + 1]) + ' ' +
        P(pts[i + 1][0]) + ' ' + P(pts[i + 1][1]);
    }
    return d;
  }

  // 连续非 null 的段
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

  const niceCeil = (v, step) => Math.max(step, Math.ceil(v / step - 1e-9) * step);

  /* ---------- 数据 ---------- */

  function pickSource() {
    const real = window.COMMONS_INSIGHTS;
    if (real && typeof real === 'object') return { raw: real, synthetic: real.synthetic === true };
    if (window.CommonsAPI && window.CommonsAPI.mode === 'live') return null;
    const sample = window.COMMONS_INSIGHTS_SAMPLE;
    if (sample && typeof sample === 'object') return { raw: sample, synthetic: true };
    return null;
  }

  function fillGaps(values) {
    const out = values.slice();
    const known = [];
    values.forEach((v, i) => { if (isNum(v)) known.push(i); });
    if (!known.length) return out.map(() => 0);
    for (let i = 0; i < out.length; i++) {
      if (isNum(out[i])) continue;
      const prev = known.filter(k => k < i).pop();
      const next = known.find(k => k > i);
      if (prev === undefined) out[i] = values[next];
      else if (next === undefined) out[i] = values[prev];
      else out[i] = values[prev] + (values[next] - values[prev]) * (i - prev) / (next - prev);
    }
    return out;
  }

  function insideOut(layers) {
    const idx = [];
    layers.forEach((l, i) => { if (l.key !== '_other') idx.push(i); });
    idx.sort((a, b) => layers[a].peak - layers[b].peak || layers[b].weight - layers[a].weight);
    let top = 0;
    let bottom = 0;
    const tops = [];
    const bottoms = [];
    idx.forEach(i => {
      if (top < bottom) {
        tops.push(i);
        top += layers[i].weight;
      } else {
        bottoms.push(i);
        bottom += layers[i].weight;
      }
    });
    const order = tops.reverse().concat(bottoms);
    const other = layers.findIndex(l => l.key === '_other');
    if (other >= 0) order.push(other);
    return order;
  }

  // d3.stackOffsetWiggle：让各层的斜率变化总和最小，流图不会整体起伏
  function wiggle(series, m) {
    const n = series.length;
    const base = new Array(m).fill(0);
    let y = 0;
    for (let j = 1; j < m; j++) {
      let s1 = 0;
      let s2 = 0;
      for (let i = 0; i < n; i++) {
        const v = series[i][j];
        let s3 = (v - series[i][j - 1]) / 2;
        for (let k = 0; k < i; k++) s3 += series[k][j] - series[k][j - 1];
        s1 += v;
        s2 += s3 * v;
      }
      base[j - 1] = y;
      if (s1) y -= s2 / s1;
    }
    base[m - 1] = y;
    return base;
  }

  function buildStream(raw, topics) {
    const weeks = (Array.isArray(raw.weeks) ? raw.weeks : [])
      .filter(w => w && validDate(w.start))
      .slice()
      .sort((a, b) => (a.start < b.start ? -1 : 1))
      .map(w => ({
        start: w.start,
        end: addDays(w.start, 6),
        partial: w.partial === true,
        total: isNum(w.textTotal) && w.textTotal > 0 ? w.textTotal : null,
        hits: w.topics && typeof w.topics === 'object' ? w.topics : {}
      }));
    const m = weeks.length;
    if (m < 2 || !topics.length) return { weeks, layers: [], empty: true };
    const share = {};
    const hidden = {};
    topics.forEach(t => {
      share[t.key] = weeks.map(w => (w.total !== null && isNum(w.hits[t.key]) && w.hits[t.key] >= 0 ? w.hits[t.key] / w.total : null));
      hidden[t.key] = weeks.map(w => w.total === null || !isNum(w.hits[t.key]));
    });
    const weight = t => sum(share[t.key]);
    const ranked = topics.slice().sort((a, b) => weight(b) - weight(a));
    const merge = ranked.length > 10;
    const main = merge ? ranked.slice(0, 9) : ranked;
    const rest = merge ? ranked.slice(9) : [];
    const layers = main.map((t, i) => ({
      key: t.key,
      label: t.label,
      cat: i + 1,
      members: [t.key],
      values: share[t.key],
      lower: weeks.map(() => false)
    }));
    if (rest.length) {
      const values = weeks.map((w, j) => {
        if (w.total === null) return null;
        const known = rest.map(t => share[t.key][j]).filter(isNum);
        return known.length ? sum(known) : null;
      });
      layers.push({
        key: '_other',
        label: '其他',
        cat: 10,
        members: rest.map(t => t.key),
        sub: rest.map(t => t.label).join('、'),
        values,
        lower: weeks.map((w, j) => values[j] !== null && rest.some(t => hidden[t.key][j]))
      });
    }
    layers.forEach(l => {
      l.geom = fillGaps(l.values);
      l.weight = sum(l.values);
      let peak = 0;
      l.geom.forEach((v, j) => { if (v > l.geom[peak]) peak = j; });
      l.peak = peak;
    });
    const order = insideOut(layers);
    const series = order.map(i => layers[i].geom);
    const base = wiggle(series, m);
    const y0 = [];
    const y1 = [];
    order.forEach((li, k) => {
      y0[k] = [];
      y1[k] = [];
      for (let j = 0; j < m; j++) {
        const below = k ? y1[k - 1][j] : base[j];
        y0[k][j] = below;
        y1[k][j] = below + series[k][j];
      }
    });
    const ofTopic = {};
    layers.forEach(l => l.members.forEach(key => { ofTopic[key] = l.key; }));
    const fullIdx = weeks.map((w, j) => (!w.partial && w.total !== null ? j : -1)).filter(j => j >= 0);
    return { weeks, layers, order, base, y0, y1, ofTopic, fullIdx, hidden, share, empty: false };
  }

  function buildRuns(raw, stream, labelOf) {
    const index = new Map(stream.weeks.map((w, j) => [w.start, j]));
    const tps = (Array.isArray(raw.turningPoints) ? raw.turningPoints : [])
      .filter(t => t && labelOf[t.topic] && index.has(t.week) && (t.direction === 'up' || t.direction === 'down') && isNum(t.share) && isNum(t.baseline))
      .slice()
      .sort((a, b) => (a.topic < b.topic ? -1 : a.topic > b.topic ? 1 : a.week < b.week ? -1 : 1));
    const out = [];
    tps.forEach(t => {
      const last = out[out.length - 1];
      if (last && last.topic === t.topic && last.direction === t.direction && dayDiff(last.end.week, t.week) <= 14) {
        last.end = t;
        last.count += 1;
      } else {
        out.push({ topic: t.topic, direction: t.direction, first: t, end: t, count: 1 });
      }
    });
    out.forEach(r => {
      r.week = index.get(r.first.week);
      r.layer = stream.ofTopic[r.topic];
      r.label = labelOf[r.topic];
      r.score = Math.abs(r.end.share - r.first.baseline);
      r.title = r.label + (r.direction === 'up' ? '开始起势' : '开始降温');
      r.when = weekLabel(r.first.week);
      r.detail = '占比 ' + pct(r.first.baseline) + ' → ' + pct(r.end.share) + (r.count > 1 ? '，连续 ' + r.count + ' 周' : '');
      r.id = r.topic + '@' + r.first.week;
    });
    return out;
  }

  function build(raw, synthetic) {
    if (!raw || raw.schemaVersion !== 1) throw new Error('schemaVersion');
    const topics = (Array.isArray(raw.topics) ? raw.topics : [])
      .filter(t => t && t.key && t.label)
      .map(t => ({ key: String(t.key), label: String(t.label) }));
    const labelOf = {};
    topics.forEach(t => { labelOf[t.key] = t.label; });
    const stream = buildStream(raw, topics);
    const turnRuns = stream.empty ? [] : buildRuns(raw, stream, labelOf);

    const cohorts = (Array.isArray(raw.cohorts) ? raw.cohorts : [])
      .filter(c => c && validMonth(c.cohort) && Array.isArray(c.weekly))
      .map(c => ({ key: c.cohort, label: monthLabel(c.cohort), size: isNum(c.size) ? c.size : null, weekly: c.weekly.map(v => (isNum(v) ? clamp(v, 0, 1) : null)) }))
      .sort((a, b) => (a.key < b.key ? -1 : 1));
    const milestones = new Map();
    (Array.isArray(raw.milestones) ? raw.milestones : []).forEach(row => {
      if (!row || !validMonth(row.cohort)) return;
      const cell = {};
      STEPS.forEach(s => {
        const c = row[s.key] || {};
        cell[s.key] = isNum(c.median) && isNum(c.p25) && isNum(c.p75) ? { p25: c.p25, median: c.median, p75: c.p75 } : null;
      });
      milestones.set(row.cohort, cell);
    });
    const ladderKeys = Array.from(new Set(cohorts.map(c => c.key).concat(Array.from(milestones.keys())))).sort();

    const roles = (Array.isArray(raw.roles) ? raw.roles : [])
      .filter(r => r && validMonth(r.month))
      .map(r => {
        const row = { month: r.month, active: isNum(r.active) && r.active > 0 ? r.active : null };
        ROLES.forEach(k => {
          row[k.key] = isNum(r[k.key]) ? r[k.key] : null;
          row[k.key + 'Rate'] = row.active !== null && row[k.key] !== null ? row[k.key] / row.active : null;
        });
        return row;
      })
      .sort((a, b) => (a.month < b.month ? -1 : 1));

    const src = raw.source && typeof raw.source === 'object' ? raw.source : {};
    const snapshot = validDate(src.snapshotDate) ? src.snapshotDate : '';
    const suppressed = raw.suppressed && isNum(raw.suppressed.cells) ? raw.suppressed.cells : 0;
    // 建群那个月就在的人没有「进群那周」，不分组；首个分组晚于记录起点时在图上注明
    const firstMonth = stream.weeks.length ? stream.weeks[0].start.slice(0, 7) : '';
    const cohortNote = cohorts.length && firstMonth && cohorts[0].key > firstMonth
      ? monthLabel(firstMonth) + '建群时就在的成员没有「进群那周」，不分组；曲线从 ' + cohorts[0].label + '进群的人算起。'
      : '';
    const review = raw.review && typeof raw.review === 'object' && raw.review.status === 'reviewed'
      ? { at: validDate(raw.review.at) ? raw.review.at : '' } : null;
    const people = (Array.isArray(raw.people) ? raw.people : [])
      .filter(p => p && /^[a-z0-9-]{2,32}$/.test(String(p.handle || '')) && p.name)
      .map(p => ({ handle: String(p.handle), name: String(p.name), topics: Array.isArray(p.topics) ? p.topics.filter(k => TOPIC_DEST[k]) : [] }));
    const model = { synthetic, topics, labelOf, stream, turnRuns, cohorts, milestones, ladderKeys, roles, snapshot, suppressed, cohortNote, review, note: raw.note || '', people };
    model.metrics = metrics(model);
    model.defaultCohort = (cohorts.find(c => isNum(c.weekly[4])) || cohorts[0] || {}).key || '';
    return model;
  }

  function windowShares(stream, key) {
    const idx = stream.fullIdx;
    if (idx.length < 8) return null;
    const head = mean(idx.slice(0, 4).map(j => stream.share[key][j]));
    const tail = mean(idx.slice(-4).map(j => stream.share[key][j]));
    return head === null || tail === null ? null : { head, tail, delta: tail - head };
  }

  function metrics(m) {
    const out = [];
    const st = m.stream;
    let move = null;
    if (!st.empty) {
      m.topics.forEach(t => {
        const w = windowShares(st, t.key);
        if (w && (!move || Math.abs(w.delta) > Math.abs(move.delta))) move = Object.assign({ label: t.label }, w);
      });
    }
    out.push(move
      ? { key: 'drift', label: '变化最大的话题', value: signed(move.delta * 100), unit: '点', sub: move.label + ' · 头 4 周 → 近 4 周', tone: 'neutral' }
      : { key: 'drift', label: '变化最大的话题', value: '—', unit: '', sub: '周数不够，还看不出变化', tone: 'none' });

    const w4 = m.cohorts.filter(c => isNum(c.weekly[4]) && isNum(c.size));
    if (w4.length) {
      const total = sum(w4.map(c => c.size));
      const v = sum(w4.map(c => c.weekly[4] * c.size)) / total;
      out.push({ key: 'retain', label: '新人第 4 周还在说话', value: String(Math.round(v * 100)), unit: '%', sub: w4.length + ' 组进群月份 · 按人数加权' });
    } else out.push({ key: 'retain', label: '新人第 4 周还在说话', value: '—', unit: '', sub: '还没有进群满 4 周的组', tone: 'none' });

    const ans = [];
    m.cohorts.forEach(c => {
      const cell = m.milestones.get(c.key);
      if (cell && cell.firstAnswer && isNum(c.size)) ans.push([cell.firstAnswer.median, c.size]);
    });
    if (ans.length) {
      const v = sum(ans.map(a => a[0] * a[1])) / sum(ans.map(a => a[1]));
      out.push({ key: 'answer', label: '第一次回答 · 中位', value: f1(v), unit: '天', sub: '进群后 · 各组中位数按人数加权' });
    } else out.push({ key: 'answer', label: '第一次回答 · 中位', value: '—', unit: '', sub: '人数不足，不展示', tone: 'none' });

    const rates = m.roles.filter(r => isNum(r.answerersRate));
    if (rates.length) {
      const last = rates[rates.length - 1];
      const first = rates[0];
      const d = (last.answerersRate - first.answerersRate) * 100;
      out.push({
        key: 'roles',
        label: '回答的人占活跃',
        value: String(Math.round(last.answerersRate * 100)),
        unit: '%',
        delta: rates.length > 1 ? signed(d) + ' 点' : '',
        good: d > 0 ? 'good' : d < 0 ? 'bad' : 'neutral',
        sub: monthLabel(last.month) + (rates.length > 1 ? ' · 比 ' + monthLabel(first.month) : '')
      });
    } else out.push({ key: 'roles', label: '回答的人占活跃', value: '—', unit: '', sub: '还没有按月的角色统计', tone: 'none' });
    return out;
  }

  /* ---------- 页面骨架 ---------- */

  function badge(m) {
    return m.synthetic
      ? '<span class="ins-badge is-sample" title="' + esc(m.note || '合成示例数据') + '">示例数据</span>'
      : '<span class="ins-badge is-real">真实记录 · 匿名聚合</span>';
  }

  function metricsHTML(m) {
    return m.metrics.map(x =>
      '<div class="ins-metric" data-key="' + esc(x.key) + '"' + (x.tone === 'none' ? ' data-empty' : '') + '>' +
        '<dt>' + esc(x.label) + '</dt>' +
        '<dd class="ins-metric-n"><b class="ins-metric-v">' + esc(x.value) + '</b>' + (x.unit ? '<span class="ins-metric-u">' + esc(x.unit) + '</span>' : '') +
          (x.delta ? '<span class="ins-delta" data-good="' + esc(String(x.good)) + '">' + esc(x.delta) + '</span>' : '') + '</dd>' +
        '<dd class="ins-metric-s">' + esc(x.sub) + '</dd>' +
      '</div>').join('');
  }

  function headHTML(m) {
    return '<header class="ins-head">' +
        '<div class="ins-head-copy">' +
          '<p class="ins-lede">话题、成员与角色的变化。</p>' + badge(m) +
        '</div>' +
        '<dl class="ins-metrics" aria-label="这一页的主数">' + metricsHTML(m) + '</dl>' +
      '</header>';
  }

  /* safe-slot: tools — 调用方传入本模块拼好的控件 HTML，数据值在生成处转义 */
  function cardHead(id, title, sub, tools) {
    return '<header class="ins-card-head">' +
        '<div class="ins-card-copy"><h2 id="' + esc(id) + '">' + esc(title) + '</h2><p>' + esc(sub) + '</p></div>' +
        (tools ? '<div class="ins-card-tools">' + tools + '</div>' : '') +
      '</header>';
  }

  function emptyBlock(text) {
    return '<div class="ins-empty" role="note"><span class="ins-empty-mark" aria-hidden="true"></span><p>' + esc(text) + '</p></div>';
  }

  /* safe-slot: body — 调用方传入本模块拼好的说明 HTML，数据值在生成处转义 */
  function moreHTML(label, body) {
    if (!body) return '';
    return '<details class="ins-more"><summary><i aria-hidden="true">?</i>' + esc(label) + '</summary><div class="ins-more-body">' + body + '</div></details>';
  }

  function driftHTML(m) {
    const st = m.stream;
    const hiddenCells = st.empty ? 0 : st.layers.reduce((n, l) => n + l.values.filter((v, j) => v === null || l.lower[j]).length, 0);
    const legend = st.empty ? '' : '<div class="ins-legend" role="group" aria-label="只看一个话题">' +
      st.order.map(i => st.layers[i]).map(l =>
        '<span class="ins-legend-item">' +
        '<button type="button" class="chip ins-chip" data-ins-layer="' + esc(l.key) + '" aria-pressed="false" style="--c:var(--cat-' + esc(l.cat) + ')"' +
          (l.sub ? ' title="' + esc(l.sub) + '"' : '') + '><i aria-hidden="true"></i>' + esc(l.label) + '</button>' +
        (l.key === '_other' ? '' : topicLink(l.key, '去看')) +
        '</span>').join('') +
      '</div>';
    const notes = [];
    if (!st.empty) {
      const other = st.layers.find(l => l.key === '_other');
      if (other) notes.push('「其他」= ' + esc(other.sub) + '，命中最少的 ' + other.members.length + ' 个话题合在一起，用灰色。');
      if (hiddenCells) notes.push('<span class="ins-hatch-key" aria-hidden="true"></span>斜纹 = 当周有话题人数不足 10，不展示：单独的话题按前后周连起来，不是实数；「其他」只加了能展示的部分，浮层里标 ≥（共 ' + hiddenCells + ' 格）。');
      if (st.weeks.some(w => w.partial)) notes.push('首尾两周不满 7 天，份额照算，浮层里会标出来。');
    }
    return '<section class="ins-card ins-drift" aria-labelledby="ins-drift-h">' +
        cardHead('ins-drift-h', '话题漂移', '每周各话题占文本消息的比例。', '') +
        (st.empty ? emptyBlock('还没有按周的话题统计。接入群聊归档的匿名聚合后，话题流图会在这里长出来。') :
          '<div class="ins-stage">' +
            '<div class="ins-scroll" data-ins-scroll>' +
              '<div class="ins-canvas" data-ins-stream>' +
                '<svg class="ins-stream" data-ins-stream-svg role="img" tabindex="0" aria-label="' + esc(st.weeks.length + ' 周话题份额流图。左右方向键逐周查看。') + '"></svg>' +
                '<svg class="ins-leaders" data-ins-leaders aria-hidden="true"></svg>' +
                '<div class="ins-notes" data-ins-notes></div>' +
                '<div class="ins-tip" data-ins-tip role="tooltip" hidden></div>' +
              '</div>' +
            '</div>' +
            '<p class="ins-scroll-hint" aria-hidden="true">左右滑动看全部 ' + st.weeks.length + ' 周</p>' +
          '</div>' +
          legend +
          '<div class="ins-drill" data-ins-drill data-topic="" hidden></div>' +
          moreHTML('怎么读这张图', ['层越厚，那周聊得越多；小圆点是转折点。悬停看当周，点话题只看一个。'].concat(notes).map(n => '<p>' + n /* safe: 说明句在生成处已转义 */ + '</p>').join(''))) +
        '<p class="ins-sr" data-ins-live aria-live="polite"></p>' +
      '</section>';
  }

  function cohortHTML(m) {
    const chips = m.cohorts.map(c =>
      '<button type="button" class="chip ins-cohort-chip" data-ins-cohort="' + esc(c.key) + '" aria-pressed="' + (c.key === m.defaultCohort) + '">' +
        esc(c.label) + (isNum(c.size) ? '<span class="ins-chip-n">' + fmt(c.size) + ' 人</span>' : '') + '</button>').join('');
    const hasLadder = m.ladderKeys.some(k => m.milestones.has(k));
    return '<section class="ins-card ins-cohort" aria-labelledby="ins-cohort-h">' +
        cardHead('ins-cohort-h', '群体成长', '按进群月份分组，看留存和开口的节奏。',
          m.cohorts.length ? '<div class="ins-cohort-chips" role="group" aria-label="选一组进群月份">' + chips + '</div>' : '') +
        (m.cohorts.length ?
          '<div class="ins-cohort-body">' +
            '<div class="ins-retain">' +
              '<p class="ins-callout" data-ins-callout></p>' +
              '<p class="ins-callout-sub" data-ins-callout-sub></p>' +
              '<div class="ins-chart" data-ins-retain>' +
                '<svg class="ins-retain-svg" data-ins-retain-svg role="img" tabindex="0" aria-label="各进群月份的周留存曲线"></svg>' +
                '<div class="ins-tip" data-ins-retain-tip role="tooltip" hidden></div>' +
              '</div>' +
            '</div>' +
            '<div class="ins-ladder">' +
              '<div class="ins-sub-head"><h3>成长阶梯</h3></div>' +
              (hasLadder ? '<div class="ins-ladder-chart" data-ins-ladder><svg class="ins-ladder-ropes" data-ins-ladder-ropes aria-hidden="true"></svg><svg class="ins-ladder-svg" data-ins-ladder-svg role="img" aria-label="成长阶梯"></svg></div>' +
                '<ul class="ins-ladder-list" data-ins-ladder-list></ul>' : emptyBlock('每组人数不足 10，暂不展示成长阶梯。')) +
            '</div>' +
          '</div>' + moreHTML('怎么读这张图',
            '<p>留存与首次行动</p>' +
            '<p>查看图表口径</p>' +
            (m.cohortNote ? '<p>' + esc(m.cohortNote) + '</p>' : '')) : emptyBlock('还没有能单独成组的进群月份。')) +
      '</section>';
  }

  function rolesHTML(m) {
    const ok = m.roles.length > 0;
    return '<section class="ins-card ins-roles-card" aria-labelledby="ins-roles-h">' +
        cardHead('ins-roles-h', '角色变化', '提问、回答、分享链接的人各占当月活跃的比例。', '') +
        (ok ? '<div class="ins-roles" data-ins-roles>' +
          '<div class="ins-role-stats" data-ins-role-stats>' +
            '<p class="ins-role-when" data-ins-role-when></p>' +
            ROLES.map(r =>
              '<div class="ins-role" data-ins-role="' + r.key + '" style="--c:var(--cat-' + r.cat + ')">' +
                '<span class="ins-role-label"><i aria-hidden="true"></i>' + r.label + '</span>' +
                '<span class="ins-role-big"><b data-ins-role-v></b><span class="ins-role-u">%</span><span class="ins-delta" data-ins-role-d></span></span>' +
                '<span class="ins-role-meta" data-ins-role-m></span>' +
              '</div>').join('') +
          '</div>' +
          '<div class="ins-chart ins-roles-chart" data-ins-roles-chart>' +
            '<svg class="ins-role-svg" data-ins-role-svg role="img" tabindex="0" aria-label="提问、回答、分享链接的人各占活跃成员的比例，按月"></svg>' +
          '</div>' +
        '</div>' + moreHTML('怎么读这张图', '<p>成员可同时计入多类。</p>') : emptyBlock('还没有按月的角色统计。')) +
      '</section>';
  }

  function demoHTML() {
    if (window.CommonsAPI && window.CommonsAPI.mode === 'live') return '';
    return '<section class="ins-card ins-demo-card" aria-labelledby="ins-demo-h">' +
        '<header class="ins-card-head">' +
          '<div class="ins-card-copy"><h2 id="ins-demo-h">成长路径<span class="ins-tag is-demo">示意</span></h2>' +
          '<p>拖动节点试试。</p></div>' +
          '<div class="ins-card-tools"><button type="button" class="button small" data-ins-pluck>拨一下</button></div>' +
        '</header>' +
        '<div class="ins-demo" data-ins-demo>' +
          '<canvas class="ins-demo-canvas" data-ins-demo-canvas aria-hidden="true"></canvas>' +
          DEMO_NODES.map((n, i) =>
            '<button type="button" class="ins-node" data-ins-node="' + i + '" style="--c:' + n.c + '" aria-label="' + n.label + '：方向键推一下，回车拨动它的线">' +
              '<i class="ins-node-dot" aria-hidden="true"></i><span class="ins-node-label">' + n.label + '</span></button>').join('') +
        '</div>' +
      '</section>';
  }

  function footHTML(m) {
    const rows = [
      ['数据', m.synthetic ? '合成示例（数字是编的）' : '群聊归档 · 匿名聚合，只在本机'],
      ['快照', m.snapshot ? m.snapshot.replace(/-/g, '.').slice(5) + '（' + m.snapshot.slice(0, 4) + '）' : '—'],
      ['周', '北京时间自然周，周一开始'],
      ['份额', '命中该话题的文本消息 ÷ 当周文本消息；一条消息可以命中几个话题'],
      ['留存', '第 k 周有发言的人 ÷ 这组里已经进群满 k 周的人'],
      ['抑制', '单格不足 10 人不展示' + (m.suppressed ? '，本页共 ' + m.suppressed + ' 格' : '')]
    ];
    if (m.review) rows.splice(1, 0, ['审核', '发布前逐项看过：只有计数、比例和分位数，没有成员身份和原文' + (m.review.at ? '（' + m.review.at.slice(5).replace('-', '.') + '）' : '')]);
    return '<footer class="ins-foot"><details class="ins-more"><summary><i aria-hidden="true">?</i>数据口径与隐私</summary>' +
      '<dl class="ins-more-body">' + rows.map(r => '<div><dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd></div>').join('') + '</dl></details></footer>';
  }

  function peopleHTML(m) {
    const people = m.people || [];
    if (!people.length) return '';
    return '<section class="ins-card ins-people" aria-labelledby="ins-people-h">' +
      '<div class="ins-sub-head"><h3 id="ins-people-h">成员</h3></div>' +
      '<ul class="ins-people-list">' + people.map(p =>
        '<li>' + /* safe: personLink / topicLink 自行转义 */ personLink(p.handle, p.name) +
        (p.topics.length ? '<span>' + p.topics.map(k => topicLink(k, m.labelOf[k] || k)).join(' · ') + '</span>' : '') +
        '</li>').join('') + '</ul></section>';
  }

  function pageHTML(m) {
    return '<section class="ins" data-ins-root data-ins-synthetic="' + esc(String(m.synthetic)) + '">' +
      headHTML(m) + driftHTML(m) + peopleHTML(m) + cohortHTML(m) + rolesHTML(m) + demoHTML() + footHTML(m) +
      '<i class="ins-probe" data-ins-probe aria-hidden="true"></i>' +
      '</section>';
  }

  function emptyPageHTML() {
    return '<section class="ins" data-ins-root data-ins-state="empty">' +
      '<header class="ins-head"><p class="ins-lede">暂无群体统计。</p></header>' +
      emptyBlock('还没有群体成长路径。活动、问题和贡献有了记录之后，这里才会出现。') +
      '<i class="ins-probe" data-ins-probe aria-hidden="true"></i></section>';
  }

  function errorHTML() {
    return '<section class="ins" data-ins-root data-ins-state="error">' +
      '<header class="ins-head"><p class="ins-lede">群体统计</p></header>' +
      '<div class="ins-empty is-error" role="alert"><span class="ins-empty-mark" aria-hidden="true"></span>' +
        '<p>统计没读出来，原数据没有改动。</p>' +
        '<button type="button" class="button small" data-ins-retry>重试</button></div>' +
      '</section>';
  }

  let pending = null;

  function page() {
    pending = null;
    const src = pickSource();
    if (!src) return emptyPageHTML();
    try {
      pending = build(src.raw, src.synthetic);
    } catch (err) {
      return errorHTML();
    }
    return pageHTML(pending);
  }

  /* ---------- 运行时状态 ---------- */

  let S = null;

  function listen(target, type, fn, opts) {
    if (!target) return;
    target.addEventListener(type, fn, opts);
    S.off.push(() => target.removeEventListener(type, fn, opts));
  }

  function later(fn, ms) {
    const id = setTimeout(() => {
      S && (S.timers = S.timers.filter(t => t !== id));
      fn();
    }, ms);
    S.timers.push(id);
  }

  function ms(name, fallback) {
    const v = getComputedStyle(S.root).getPropertyValue(name).trim();
    const n = parseFloat(v);
    if (!Number.isFinite(n)) return fallback;
    return /ms$/.test(v) ? n : n * 1000;
  }

  // 运行时读令牌：探针的计算色就是浏览器认的颜色串，Canvas 直接用；透明度交给 globalAlpha
  function cssOf(cssColor) {
    const probe = S.root.querySelector('[data-ins-probe]');
    if (!probe) return '';
    probe.style.color = cssColor;
    return getComputedStyle(probe).color;
  }

  function rgbOf(cssColor) {
    const m = (cssOf(cssColor).match(/[\d.]+/g) || ['0', '0', '0']).map(Number);
    return [m[0], m[1], m[2]];
  }

  const lum = rgb => {
    const c = rgb.map(v => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };

  const GL = () => window.CommonsGravity || null;

  function rope(from, to, slack, data) {
    const G = GL();
    if (G) return G.create({ from, to, slack, data });
    // 引擎缺失：退回一条静态二次弧线，接口保持一致
    let a = from;
    let b = to;
    const d = () => 'M' + P(a.x) + ' ' + P(a.y) + 'Q' + P((a.x + b.x) / 2) + ' ' + P(Math.max(a.y, b.y) + Math.abs(b.x - a.x) * 0.12) + ' ' + P(b.x) + ' ' + P(b.y);
    return {
      path: d, step: () => false, settled: true, data,
      setEnds(f, t) { a = f; b = t; return this; }, pluck() { return this; }, drop() { return this; }, destroy() {},
      trace(ctx) { ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo((a.x + b.x) / 2, Math.max(a.y, b.y) + Math.abs(b.x - a.x) * 0.12, b.x, b.y); }
    };
  }

  function driver(opts) {
    const G = GL();
    if (G) return G.loop(opts);
    return { add() { return this; }, remove() { return this; }, clear() { return this; }, wake() { if (opts.frame) opts.frame(16); return this; }, stop() { return this; }, running: false, frames: 0, cost: 0 };
  }

  /* ---------- 话题流图 ---------- */

  function streamGeom(width) {
    const st = S.model.stream;
    const small = narrow();
    const H = small ? 420 : 456;
    const band = small ? 92 : 96;
    const axis = 30;
    const top = band + 22;
    const bottom = H - axis - 6;
    const nose = small ? 30 : 40;
    const left = 12 + nose;
    const right = width - 12 - nose;
    const m = st.weeks.length;
    const dx = (right - left) / (m - 1);
    let lo = Infinity;
    let hi = -Infinity;
    for (let j = 0; j < m; j++) {
      lo = Math.min(lo, st.base[j]);
      hi = Math.max(hi, st.y1[st.y1.length - 1][j]);
    }
    const sy = (bottom - top) / ((hi - lo) || 1);
    const Y = v => top + (v - lo) * sy;
    const X = j => left + j * dx;
    const px = st.order.map((li, k) => ({
      layer: st.layers[li],
      top: st.y0[k].map(Y),
      bot: st.y1[k].map(Y)
    }));
    return { H, band, top, bottom, left, right, nose, dx, X, Y, px, m };
  }

  function drawStream() {
    const host = S.root.querySelector('[data-ins-stream]');
    const svg = S.root.querySelector('[data-ins-stream-svg]');
    if (!host || !svg) return;
    const st = S.model.stream;
    const W = host.clientWidth;
    const g = streamGeom(W);
    S.sg = g;
    host.style.height = g.H + 'px';
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + g.H);
    svg.setAttribute('width', W);
    svg.setAttribute('height', g.H);

    const defs = ['<pattern id="ins-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">' +
      '<rect class="ins-hatch-bg" width="6" height="6"></rect><line class="ins-hatch-line" x1="0" y1="0" x2="0" y2="6"></line></pattern>'];
    const grid = [];
    const axis = [];
    let lastMonth = '';
    st.weeks.forEach((w, j) => {
      const x = g.X(j);
      const month = w.start.slice(0, 7);
      const monthStart = w.start.slice(8, 10) <= '07' || (j === 0);
      if (month !== lastMonth && monthStart) {
        lastMonth = month;
        grid.push('<line class="ins-grid-line" x1="' + P(x) + '" x2="' + P(x) + '" y1="' + P(g.top - 14) + '" y2="' + P(g.bottom + 6) + '"></line>');
        axis.push('<text class="ins-axis-month" x="' + P(x) + '" y="' + P(g.H - 10) + '">' + monthLabel(month) + '</text>');
      }
      axis.push('<circle class="ins-axis-tick' + (w.partial ? ' is-partial' : '') + '" cx="' + P(x) + '" cy="' + P(g.bottom + 12) + '" r="1.5"></circle>');
    });

    const layers = [];
    const hatches = [];
    const labels = [];
    // 两端收成圆头：所有边界在记录起止之外汇到整条流的中线，流图不再是一刀切的长条
    const midL = (g.px[0].top[0] + g.px[g.px.length - 1].bot[0]) / 2;
    const midR = (g.px[0].top[g.m - 1] + g.px[g.px.length - 1].bot[g.m - 1]) / 2;
    const withNose = arr => [[g.X(0) - g.nose, midL], [g.X(0) - g.nose * 0.45, arr[0]]]
      .concat(arr.map((y, j) => [g.X(j), y]))
      .concat([[g.X(g.m - 1) + g.nose * 0.45, arr[g.m - 1]], [g.X(g.m - 1) + g.nose, midR]]);
    g.px.forEach(p => {
      const l = p.layer;
      const topPts = withNose(p.top);
      const botPts = withNose(p.bot).reverse();
      const d = basis(topPts, true) + basis(botPts, false) + 'Z';
      layers.push('<path class="ins-layer" data-layer="' + esc(l.key) + '" style="--c:var(--cat-' + esc(l.cat) + ')" d="' + esc(d) + '"></path>');
      l.values.forEach((v, j) => {
        if (v !== null && !l.lower[j]) return;
        const x0 = g.X(j) - g.dx / 2;
        const id = 'ins-cut-' + esc(l.key) + '-' + j;
        defs.push('<clipPath id="' + id + '"><rect x="' + P(x0) + '" y="0" width="' + P(g.dx) + '" height="' + esc(String(g.H)) + '"></rect></clipPath>');
        hatches.push('<path class="ins-hatch" data-layer="' + esc(l.key) + '" clip-path="url(#' + id + ')" d="' + d + '"></path>');
      });
      // 层内标签：放在最厚的那一周，太薄就不放
      let best = -1;
      let thick = 0;
      const marked = S.model.turnRuns.filter(r => r.layer === l.key).map(r => r.week);
      for (let j = 1; j < g.m - 1; j++) {
        if (marked.some(w => Math.abs(w - j) <= 2)) continue;
        const t = Math.min(basisAt(p.bot, j) - basisAt(p.top, j), basisAt(p.bot, j - 1) - basisAt(p.top, j - 1), basisAt(p.bot, j + 1) - basisAt(p.top, j + 1));
        if (t > thick && l.values[j] !== null) {
          thick = t;
          best = j;
        }
      }
      const need = narrow() ? 15 : 17;
      if (best > 0 && thick >= need) {
        const cy = (basisAt(p.top, best) + basisAt(p.bot, best)) / 2;
        const c = rgbOf('var(--cat-' + l.cat + ')');
        const bg = rgbOf('var(--surface)');
        const tone = lum(c.map((v, k) => v * 0.82 + bg[k] * 0.18)) < 0.36 ? 'is-light' : 'is-dark';
        labels.push('<text class="ins-layer-label ' + tone + '" data-layer="' + esc(l.key) + '" x="' + P(g.X(best)) + '" y="' + P(cy) + '">' + esc(l.label) + '</text>');
      }
    });

    svg.innerHTML = '<defs>' + defs.join('') + '</defs>' +
      '<g class="ins-grid">' + grid.join('') + '</g>' +
      '<g class="ins-layers" data-ins-layers>' + layers.join('') + hatches.join('') + '</g>' +
      '<g class="ins-labels" aria-hidden="true">' + labels.join('') + '</g>' +
      '<g class="ins-axis" aria-hidden="true">' + axis.join('') + '</g>' +
      '<line class="ins-guide" data-ins-guide x1="0" x2="0" y1="' + P(g.top - 10) + '" y2="' + P(g.bottom + 6) + '" visibility="hidden"></line>' +
      '<g class="ins-marks" data-ins-marks></g>';
    applyHighlight();
    if (!S.revealing) placeNotes(false);
  }

  function layerCenter(key, j) {
    const p = S.sg.px.find(q => q.layer.key === key);
    if (!p) return null;
    const top = basisAt(p.top, j);
    const bot = basisAt(p.bot, j);
    return { x: S.sg.X(j), y: (top + bot) / 2, h: bot - top };
  }

  function visibleRuns() {
    const m = S.model;
    const hl = S.hl;
    const all = m.turnRuns.filter(r => r.layer);
    if (hl) return all.filter(r => r.layer === hl).sort((a, b) => b.score - a.score).slice(0, 3).sort((a, b) => a.week - b.week);
    const max = narrow() ? 3 : 4;
    const picked = [];
    all.slice().sort((a, b) => b.score - a.score).forEach(r => {
      if (picked.length >= max) return;
      if (picked.some(p => p.topic === r.topic || Math.abs(p.week - r.week) < 3)) return;
      picked.push(r);
    });
    return picked.sort((a, b) => a.week - b.week);
  }

  function placeNotes(animate) {
    const holder = S.root.querySelector('[data-ins-notes]');
    const ropesSvg = S.root.querySelector('[data-ins-leaders]');
    const marks = S.root.querySelector('[data-ins-marks]');
    if (!holder || !ropesSvg || !marks || !S.sg) return;
    const g = S.sg;
    const list = visibleRuns();
    const W = g.right + 12 + g.nose;
    ropesSvg.setAttribute('viewBox', '0 0 ' + W + ' ' + g.H);
    ropesSvg.setAttribute('width', W);
    ropesSvg.setAttribute('height', g.H);
    S.leaderLoop.clear();
    S.leaders.forEach(r => r.destroy());
    S.leaders = [];
    S.noteItems = [];
    if (!list.length) {
      holder.innerHTML = S.hl ? '<p class="ins-note-empty">这个话题没有明显的转折：和前 4 周比，没有哪周变化超过两个标准差。</p>' : '';
      ropesSvg.innerHTML = '';
      marks.innerHTML = '';
      return;
    }
    const cardW = narrow() ? 196 : 204;
    const gap = 12;
    const items = list.map(r => {
      const c = layerCenter(r.layer, r.week);
      const layer = S.model.stream.layers.find(l => l.key === r.layer);
      return { r, layer, mx: c.x, my: c.y, want: c.x + (c.x < (g.left + g.right) / 2 ? 1 : -1) * Math.min(112, cardW * 0.55) };
    });
    // 一维排布：先按期望位置排，从左往右推开，再从右往左收回边界
    items.sort((a, b) => a.want - b.want);
    const lo = g.left - g.nose + cardW / 2;
    const hi = g.right + g.nose - cardW / 2;
    items.forEach((it, i) => {
      it.cx = clamp(it.want, lo, hi);
      if (i && it.cx < items[i - 1].cx + cardW + gap) it.cx = items[i - 1].cx + cardW + gap;
    });
    for (let i = items.length - 1; i >= 0; i--) {
      if (items[i].cx > hi) items[i].cx = hi;
      if (i < items.length - 1 && items[i].cx > items[i + 1].cx - cardW - gap) items[i].cx = items[i + 1].cx - cardW - gap;
    }
    S.noteItems = items;
    holder.innerHTML = items.map((it, i) =>
      '<button type="button" class="ins-note" data-ins-note="' + i + '" data-dir="' + esc(it.r.direction) + '" style="--c:var(--cat-' + esc(it.layer.cat) + ');--i:' + i + ';left:' + P(it.cx - cardW / 2) + 'px;width:' + cardW + 'px" aria-pressed="' + (S.hl === it.layer.key) + '" aria-label="' + esc(it.r.title + '，' + it.r.when + '，' + it.r.detail + '。点一下只看这个话题') + '">' +
        '<span class="ins-note-k"><i class="ins-note-arrow" aria-hidden="true"></i>' + esc(it.r.when) + ' · ' + (it.r.direction === 'up' ? '起势' : '降温') + '</span>' +
        '<span class="ins-note-t">' + esc(it.r.title) + '</span>' +
        '<span class="ins-note-m">' + esc(it.r.detail) + '</span>' +
      '</button>').join('');
    marks.innerHTML = items.map(it =>
      '<g class="ins-mark" style="--c:var(--cat-' + esc(it.layer.cat) + ')"><circle class="ins-mark-halo" cx="' + P(it.mx) + '" cy="' + P(it.my) + '" r="9"></circle>' +
        '<circle class="ins-mark-dot" cx="' + P(it.mx) + '" cy="' + P(it.my) + '" r="4.5"></circle></g>').join('');
    const cards = Array.from(holder.querySelectorAll('[data-ins-note]'));
    const paths = [];
    items.forEach((it, i) => {
      const card = cards[i];
      const bottom = card.offsetTop + card.offsetHeight;
      // 挂点在卡片底边上离圆点稍远的一侧，让绳子有横向跨度、垂出弧线
      let ax = it.cx + (it.mx > it.cx ? -1 : 1) * cardW * 0.18;
      if (Math.abs(ax - it.mx) < 48) ax = it.cx + (it.mx > it.cx ? -1 : 1) * (cardW / 2 - 24);
      const from = { x: ax, y: bottom - 1 };
      const to = { x: it.mx, y: it.my - 5 };
      const r = rope(from, to, 1.05, { i, c: it.layer.cat });
      S.leaders.push(r);
      S.leaderLoop.add(r);
      paths.push('<path class="ins-rope" data-ins-rope="' + i + '" style="--c:var(--cat-' + esc(it.layer.cat) + ')" d="' + esc(r.path()) + '"></path>' +
        '<circle class="ins-eyelet" style="--c:var(--cat-' + esc(it.layer.cat) + ')" cx="' + P(from.x) + '" cy="' + P(from.y) + '" r="2.5"></circle>');
    });
    ropesSvg.innerHTML = paths.join('');
    S.ropeEls = Array.from(ropesSvg.querySelectorAll('[data-ins-rope]'));
    if (animate && !reduced()) {
      S.leaders.forEach((r, i) => later(() => {
        if (!S || S.leaders[i] !== r) return;
        r.drop();
        S.leaderLoop.wake();
      }, i * ms('--stagger', 32) * 2));
    }
  }

  function drawLeaders() {
    if (!S || !S.ropeEls) return;
    S.leaders.forEach((r, i) => {
      const el = S.ropeEls[i];
      if (el) el.setAttribute('d', r.path());
    });
  }

  function revealStream() {
    const svg = S.root.querySelector('[data-ins-stream-svg]');
    // 减弱动效（或没有 WAAPI）时 S.revealing 为 false：drawStream 已经直接画好终态和注释卡
    if (!S.revealing || !svg || typeof svg.animate !== 'function') return;
    const dur = ms('--motion-stage', 480);
    const ease = getComputedStyle(S.root).getPropertyValue('--ease-in-out').trim() || 'ease-in-out';
    // 时间从左往右流出来，流完再挂注释卡、放绳子
    svg.animate([{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)' }], { duration: dur * 1.6, easing: ease, fill: 'backwards' });
    later(() => {
      if (!S) return;
      S.revealing = false;
      placeNotes(true);
    }, dur * 1.2);
  }

  function applyHighlight() {
    const svg = S.root.querySelector('[data-ins-stream-svg]');
    if (!svg) return;
    if (S.hl) svg.setAttribute('data-hl', S.hl); else svg.removeAttribute('data-hl');
    svg.querySelectorAll('[data-layer]').forEach(el => el.classList.toggle('is-hl', el.getAttribute('data-layer') === S.hl));
    S.root.querySelectorAll('[data-ins-layer]').forEach(b => b.setAttribute('aria-pressed', String(b.getAttribute('data-ins-layer') === S.hl)));
  }

  // 选话题的唯一入口：图例、流图本体、注释卡、Esc 都走这里（via = chip / stream / note / key）。
  // 以后「点话题 → 展开它下面的行业 / 应用子流图」只要监听 insights:topic（冒泡到 document），
  // 往 detail.slot（流图下方的 data-ins-drill 空位）里画即可，不用改这里。
  function selectTopic(key, via) {
    const next = S.hl === key ? '' : key;
    S.hl = next;
    applyHighlight();
    placeNotes(true);
    const st = S.model.stream;
    const layer = st.layers.find(l => l.key === next) || null;
    say(layer ? '只看「' + layer.label + '」' : '看全部话题');
    const slot = S.root.querySelector('[data-ins-drill]');
    if (slot) slot.setAttribute('data-topic', next);
    if (typeof CustomEvent === 'function') {
      S.root.dispatchEvent(new CustomEvent('insights:topic', {
        bubbles: true,
        detail: {
          key: next,
          label: layer ? layer.label : '',
          topics: layer ? layer.members.slice() : [],
          cat: layer ? layer.cat : 0,
          via: via || '',
          weeks: st.weeks.map(w => w.start),
          synthetic: S.model.synthetic,
          slot
        }
      }));
    }
  }

  function say(text) {
    const live = S.root.querySelector('[data-ins-live]');
    if (live) live.textContent = text;
  }

  function streamTip(j, y, hoverKey) {
    const st = S.model.stream;
    const g = S.sg;
    const tip = S.root.querySelector('[data-ins-tip]');
    const guide = S.root.querySelector('[data-ins-guide]');
    if (!tip || !guide) return;
    const w = st.weeks[j];
    const x = g.X(j);
    guide.setAttribute('x1', P(x));
    guide.setAttribute('x2', P(x));
    guide.setAttribute('visibility', 'visible');
    const rows = st.layers.map(l => ({ l, v: l.values[j], lower: l.lower[j] }));
    rows.sort((a, b) => (b.v === null ? -1 : b.v) - (a.v === null ? -1 : a.v));
    const rank = rows.filter(r => r.v !== null);
    tip.innerHTML = '<p class="ins-tip-t">' + esc(short(w.start)) + '–' + esc(short(w.end)) + '<span>' + weekLabel(w.start) + (w.partial ? ' · 不满一周' : '') + '</span></p>' +
      (w.total === null ? '<p class="ins-tip-m">这一周文本消息的人数不足 10，整周不展示。</p>' :
        '<ol class="ins-tip-rows">' + rows.map(r =>
          '<li class="' + (rank.indexOf(r) > -1 && rank.indexOf(r) < 5 ? 'is-top' : '') + (r.l.key === hoverKey ? ' is-on' : '') + '">' +
            '<i style="--c:var(--cat-' + esc(r.l.cat) + ')"></i><span>' + esc(r.l.label) + '</span>' +
            '<b>' + (r.v === null ? '不足 10 人' : (r.lower ? '≥ ' : '') + pct(r.v)) + '</b></li>').join('') + '</ol>' +
        '<p class="ins-tip-m">当周文本消息 ' + esc(fmt(w.total)) + ' 条' + '</p>');
    tip.hidden = false;
    const host = S.root.querySelector('[data-ins-stream]');
    const scroller = S.root.querySelector('[data-ins-scroll]');
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    // 窄屏流图在横向滚动框里：浮层按「看得见的那一截」翻边，不按整张画布
    const viewL = scroller ? scroller.scrollLeft : 0;
    const viewR = scroller ? viewL + scroller.clientWidth : host.clientWidth;
    let left = x + 16 + tw > viewR - 4 ? x - 16 - tw : x + 16;
    left = clamp(left, viewL + 4, Math.max(viewL + 4, viewR - tw - 4));
    const top = clamp(y - th / 2, 4, g.H - th - 4);
    tip.style.transform = 'translate(' + P(left) + 'px,' + P(top) + 'px)';
    tip.setAttribute('data-show', '');
    S.streamWeek = j;
  }

  function hideStreamTip() {
    const tip = S.root.querySelector('[data-ins-tip]');
    const guide = S.root.querySelector('[data-ins-guide]');
    if (tip) {
      tip.hidden = true;
      tip.removeAttribute('data-show');
    }
    if (guide) guide.setAttribute('visibility', 'hidden');
    const svg = S.root.querySelector('[data-ins-stream-svg]');
    if (svg) svg.removeAttribute('data-hover');
    S.root.querySelectorAll('.ins-layer.is-hover').forEach(el => el.classList.remove('is-hover'));
  }

  function layerAt(j, y) {
    const p = S.sg.px.find(q => y >= basisAt(q.top, j) && y <= basisAt(q.bot, j));
    return p ? p.layer.key : '';
  }

  function onStreamMove(e) {
    if (!S.sg) return;
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (y < S.sg.top - 18) {
      hideStreamTip();
      return;
    }
    const j = clamp(Math.round((x - S.sg.left) / S.sg.dx), 0, S.sg.m - 1);
    const key = layerAt(j, y);
    svg.setAttribute('data-hover', key ? '1' : '');
    S.root.querySelectorAll('.ins-layer').forEach(el => el.classList.toggle('is-hover', !!key && el.getAttribute('data-layer') === key));
    streamTip(j, y, key);
  }

  function onStreamClick(e) {
    if (!S.sg) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const j = clamp(Math.round((e.clientX - rect.left - S.sg.left) / S.sg.dx), 0, S.sg.m - 1);
    const key = layerAt(j, e.clientY - rect.top);
    if (key) selectTopic(key, 'stream');
  }

  function onStreamKey(e) {
    if (!S.sg) return;
    const m = S.sg.m;
    let j = S.streamWeek;
    if (e.key === 'ArrowRight') j = j < 0 ? 0 : Math.min(m - 1, j + 1);
    else if (e.key === 'ArrowLeft') j = j < 0 ? m - 1 : Math.max(0, j - 1);
    else if (e.key === 'Escape') {
      hideStreamTip();
      S.streamWeek = -1;
      if (S.hl) selectTopic(S.hl, 'key');
      return;
    } else return;
    e.preventDefault();
    streamTip(j, (S.sg.top + S.sg.bottom) / 2, '');
    const w = S.model.stream.weeks[j];
    const top = S.model.stream.layers.filter(l => l.values[j] !== null).sort((a, b) => b.values[j] - a.values[j])[0];
    say(weekLabel(w.start) + (top ? '，最多的是' + top.label + ' ' + pct(top.values[j]) : ''));
    const scroller = S.root.querySelector('[data-ins-scroll]');
    if (scroller && scroller.scrollWidth > scroller.clientWidth) {
      const x = S.sg.X(j);
      if (x < scroller.scrollLeft + 40 || x > scroller.scrollLeft + scroller.clientWidth - 40) scroller.scrollLeft = x - scroller.clientWidth / 2;
    }
  }

  /* ---------- 留存曲线 ---------- */

  function retainGeom(width) {
    const small = narrow();
    const H = small ? 236 : 276;
    const pad = { t: 26, r: small ? 40 : 48, b: 30, l: 38 };
    const maxWeek = Math.max(1, ...S.model.cohorts.map(c => c.weekly.length - 1));
    const X = k => pad.l + k / maxWeek * (width - pad.l - pad.r);
    const Y = v => pad.t + (1 - v) * (H - pad.t - pad.b);
    return { H, W: width, pad, maxWeek, X, Y };
  }

  function drawRetain() {
    const host = S.root.querySelector('[data-ins-retain]');
    const svg = S.root.querySelector('[data-ins-retain-svg]');
    if (!host || !svg) return;
    const m = S.model;
    const W = host.clientWidth;
    const g = retainGeom(W);
    S.rg = g;
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + g.H);
    svg.setAttribute('width', W);
    svg.setAttribute('height', g.H);
    const out = [];
    out.push('<defs><linearGradient id="ins-retain-fill" x1="0" x2="0" y1="0" y2="1"><stop class="ins-stop-a" offset="0"></stop><stop class="ins-stop-b" offset="1"></stop></linearGradient></defs>');
    [0, 0.25, 0.5, 0.75, 1].forEach(v => {
      out.push('<line class="ins-grid-line' + (v === 0 ? ' is-base' : '') + '" x1="' + esc(String(g.pad.l)) + '" x2="' + P(W - g.pad.r) + '" y1="' + P(g.Y(v)) + '" y2="' + P(g.Y(v)) + '"></line>' +
        '<text class="ins-axis-y" x="' + (g.pad.l - 8) + '" y="' + P(g.Y(v)) + '">' + Math.round(v * 100) + '%</text>');
    });
    const every = g.maxWeek > 12 ? 4 : 2;
    for (let k = 0; k <= g.maxWeek; k += every) out.push('<text class="ins-axis-x" x="' + P(g.X(k)) + '" y="' + P(g.H - 8) + '">' + (k === 0 ? '第 0 周' : k) + '</text>');
    if (g.maxWeek >= 4) {
      out.push('<line class="ins-ref" x1="' + P(g.X(4)) + '" x2="' + P(g.X(4)) + '" y1="' + P(g.pad.t - 8) + '" y2="' + P(g.Y(0)) + '"></line>' +
        '<text class="ins-ref-label" x="' + P(g.X(4)) + '" y="' + P(g.pad.t - 13) + '">第 4 周</text>');
    }
    const ends = [];
    const sel = S.cohort;
    m.cohorts.slice().sort((a, b) => (a.key === sel) - (b.key === sel)).forEach(c => {
      const on = c.key === sel;
      const segs = runs(c.weekly);
      const pts = k => [g.X(k), g.Y(c.weekly[k])];
      let d = '';
      segs.forEach(seg => { d += monotone(seg.map(pts), true); });
      for (let i = 1; i < segs.length; i++) {
        const a = segs[i - 1][segs[i - 1].length - 1];
        const b = segs[i][0];
        out.push('<path class="ins-gap" d="M' + P(g.X(a)) + ' ' + P(g.Y(c.weekly[a])) + 'L' + P(g.X(b)) + ' ' + P(g.Y(c.weekly[b])) + '"></path>');
      }
      if (on && segs.length) {
        const area = segs.map(seg => monotone(seg.map(pts), true) + 'L' + P(g.X(seg[seg.length - 1])) + ' ' + P(g.Y(0)) + 'L' + P(g.X(seg[0])) + ' ' + P(g.Y(0)) + 'Z').join('');
        out.push('<path class="ins-retain-area" d="' + area + '"></path>');
      }
      out.push('<path class="ins-retain-line' + (on ? ' is-on' : '') + '" data-ins-curve="' + esc(c.key) + '" d="' + esc(d) + '"></path>');
      if (on) {
        segs.forEach(seg => seg.forEach(k => out.push('<circle class="ins-retain-dot' + (k === 4 ? ' is-key' : '') + '" cx="' + P(g.X(k)) + '" cy="' + P(g.Y(c.weekly[k])) + '" r="' + (k === 4 ? 4.5 : 2.5) + '"></circle>')));
        if (isNum(c.weekly[4])) out.push('<text class="ins-retain-key" x="' + P(g.X(4) + 8) + '" y="' + P(g.Y(c.weekly[4]) - 10) + '">' + pct(c.weekly[4], 0) + '</text>');
      }
      const lastSeg = segs[segs.length - 1];
      if (lastSeg) {
        const k = lastSeg[lastSeg.length - 1];
        ends.push({ key: c.key, label: c.label, on, x: g.X(k), y: g.Y(c.weekly[k]) });
      }
    });
    // 末端标签：只常显选中的一组；悬停到别的线时才显示那一组，免得短线的标签挤在图中间
    ends.forEach(e => out.push('<text class="ins-end-label' + (e.on ? ' is-on' : '') + '" data-ins-end="' + esc(e.key) + '" x="' + P(e.x + 7) + '" y="' + P(e.y) + '">' + esc(e.label) + '</text>'));
    out.push('<line class="ins-guide" data-ins-retain-guide x1="0" x2="0" y1="' + P(g.pad.t - 4) + '" y2="' + P(g.Y(0)) + '" visibility="hidden"></line>');
    svg.innerHTML = out.join('');
  }

  function animateRetain() {
    const line = S.root.querySelector('.ins-retain-line.is-on');
    const area = S.root.querySelector('.ins-retain-area');
    if (!line || typeof line.animate !== 'function') return;
    if (reduced()) {
      line.animate([{ opacity: 0 }, { opacity: 1 }], { duration: ms('--motion-fast', 120) });
      return;
    }
    const len = line.getTotalLength();
    const ease = getComputedStyle(S.root).getPropertyValue('--ease-out').trim() || 'ease-out';
    line.animate([{ strokeDasharray: len + ' ' + len, strokeDashoffset: len }, { strokeDasharray: len + ' ' + len, strokeDashoffset: 0 }], { duration: ms('--motion-stage', 480) * 1.5, easing: ease });
    if (area) area.animate([{ opacity: 0 }, { opacity: 1 }], { duration: ms('--motion-stage', 480), delay: ms('--motion-enter', 240), easing: ease, fill: 'backwards' });
  }

  function callout() {
    const m = S.model;
    const c = m.cohorts.find(x => x.key === S.cohort);
    const main = S.root.querySelector('[data-ins-callout]');
    const sub = S.root.querySelector('[data-ins-callout-sub]');
    if (!c || !main) return;
    const known = c.weekly.map((v, k) => (isNum(v) && k > 0 ? k : -1)).filter(k => k > 0);
    const k = isNum(c.weekly[4]) ? 4 : known.length ? known[known.length - 1] : -1;
    const who = c.label + '进群的' + (isNum(c.size) ? ' ' + fmt(c.size) + ' 人' : '人');
    if (k < 0) {
      main.innerHTML = esc(c.label) + '进群的人还不满一周，或者每周人数都不足 10，暂时看不出留存。';
      sub.textContent = '';
      return;
    }
    main.innerHTML = (k === 4 ? esc(who) + '，第 4 周还有 ' : esc(c.label) + '进群的人才来 ' + (c.weekly.length - 1) + ' 周，第 ' + k + ' 周还有 ') +
      '<b>' + pct(c.weekly[k], 0) + '</b> 在说话。';
    const others = m.cohorts.filter(x => x.key !== c.key && isNum(x.weekly[k]));
    if (others.length) {
      const avg = mean(others.map(x => x.weekly[k]));
      const d = Math.round((c.weekly[k] - avg) * 100);
      sub.textContent = d === 0 ? '和其他 ' + others.length + ' 组同一周的平均差不多。' : '比其他 ' + others.length + ' 组同一周的平均' + (d > 0 ? '高 ' : '低 ') + Math.abs(d) + ' 个百分点。';
    } else sub.textContent = '其他组还没有第 ' + k + ' 周的数据，没法比。';
  }

  function retainTip(k, y) {
    const g = S.rg;
    const tip = S.root.querySelector('[data-ins-retain-tip]');
    const guide = S.root.querySelector('[data-ins-retain-guide]');
    if (!tip || !guide) return;
    const x = g.X(k);
    guide.setAttribute('x1', P(x));
    guide.setAttribute('x2', P(x));
    guide.setAttribute('visibility', 'visible');
    tip.innerHTML = '<p class="ins-tip-t">进群后第 ' + esc(String(k)) + ' 周</p><ol class="ins-tip-rows">' + S.model.cohorts.map(c => {
      const v = c.weekly[k];
      const state = k >= c.weekly.length ? '还没到' : isNum(v) ? pct(v, 0) : '不足 10 人';
      return '<li class="' + (c.key === S.cohort ? 'is-top is-on' : '') + '"><i class="is-line' + (c.key === S.cohort ? ' is-sel' : '') + '"></i><span>' + esc(c.label) + '进群</span><b>' + state + '</b></li>';
    }).join('') + '</ol>';
    tip.hidden = false;
    const host = S.root.querySelector('[data-ins-retain]');
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    const left = x + 14 + tw > host.clientWidth ? x - 14 - tw : x + 14;
    tip.style.transform = 'translate(' + P(Math.max(0, left)) + 'px,' + P(clamp(y - th / 2, 0, g.H - th)) + 'px)';
    tip.setAttribute('data-show', '');
    S.retainWeek = k;
  }

  function nearestCohort(k, y) {
    let best = null;
    let dist = Infinity;
    S.model.cohorts.forEach(c => {
      const v = c.weekly[k];
      if (!isNum(v)) return;
      const d = Math.abs(S.rg.Y(v) - y);
      if (d < dist) {
        dist = d;
        best = c.key;
      }
    });
    return dist < 18 ? best : null;
  }

  function onRetainMove(e) {
    if (!S.rg) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const k = clamp(Math.round((x - S.rg.pad.l) / ((S.rg.W - S.rg.pad.l - S.rg.pad.r) / S.rg.maxWeek)), 0, S.rg.maxWeek);
    const near = nearestCohort(k, y);
    S.root.querySelectorAll('[data-ins-curve]').forEach(el => el.classList.toggle('is-peek', el.getAttribute('data-ins-curve') === near && near !== S.cohort));
    S.root.querySelectorAll('[data-ins-end]').forEach(el => el.classList.toggle('is-peek', el.getAttribute('data-ins-end') === near && near !== S.cohort));
    e.currentTarget.style.cursor = near && near !== S.cohort ? 'pointer' : '';
    retainTip(k, y);
  }

  function hideRetainTip() {
    const tip = S.root.querySelector('[data-ins-retain-tip]');
    const guide = S.root.querySelector('[data-ins-retain-guide]');
    if (tip) {
      tip.hidden = true;
      tip.removeAttribute('data-show');
    }
    if (guide) guide.setAttribute('visibility', 'hidden');
    S.root.querySelectorAll('[data-ins-curve].is-peek,[data-ins-end].is-peek').forEach(el => el.classList.remove('is-peek'));
  }

  function onRetainClick(e) {
    if (!S.rg) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const k = clamp(Math.round((e.clientX - rect.left - S.rg.pad.l) / ((S.rg.W - S.rg.pad.l - S.rg.pad.r) / S.rg.maxWeek)), 0, S.rg.maxWeek);
    const near = nearestCohort(k, e.clientY - rect.top);
    if (near && near !== S.cohort) selectCohort(near);
  }

  function onRetainKey(e) {
    if (!S.rg) return;
    const list = S.model.cohorts.map(c => c.key);
    let k = S.retainWeek;
    if (e.key === 'ArrowRight') k = k < 0 ? 0 : Math.min(S.rg.maxWeek, k + 1);
    else if (e.key === 'ArrowLeft') k = k < 0 ? S.rg.maxWeek : Math.max(0, k - 1);
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const i = list.indexOf(S.cohort) + (e.key === 'ArrowDown' ? 1 : -1);
      if (i >= 0 && i < list.length) selectCohort(list[i]);
      e.preventDefault();
      return;
    } else if (e.key === 'Escape') {
      hideRetainTip();
      S.retainWeek = -1;
      return;
    } else return;
    e.preventDefault();
    retainTip(k, S.rg.H / 2);
  }

  function selectCohort(key) {
    if (!key || key === S.cohort) return;
    S.cohort = key;
    S.root.querySelectorAll('[data-ins-cohort]').forEach(b => b.setAttribute('aria-pressed', String(b.getAttribute('data-ins-cohort') === key)));
    drawRetain();
    animateRetain();
    callout();
    ladderTo(true);
    const c = S.model.cohorts.find(x => x.key === key);
    if (S.retainWeek >= 0) retainTip(S.retainWeek, S.rg.H / 2);
    say('选中' + (c ? c.label : '') + '进群的一组');
  }

  /* ---------- 成长阶梯 ---------- */

  function ladderGeom(width) {
    const m = S.model;
    let max = 7;
    m.milestones.forEach(cell => STEPS.forEach(s => { if (cell[s.key]) max = Math.max(max, cell[s.key].p75); }));
    const days = niceCeil(max, 7);
    const row = 58;
    const pad = { t: 10, r: 10, b: 28, l: 10 };
    const H = pad.t + row * STEPS.length + pad.b;
    const X = d => pad.l + d / days * (width - pad.l - pad.r);
    const barY = i => pad.t + i * row + 34;
    return { W: width, H, row, pad, days, X, barY };
  }

  function drawLadder() {
    const host = S.root.querySelector('[data-ins-ladder]');
    const svg = S.root.querySelector('[data-ins-ladder-svg]');
    const ropesSvg = S.root.querySelector('[data-ins-ladder-ropes]');
    if (!host || !svg || !ropesSvg) return;
    const W = host.clientWidth;
    const g = ladderGeom(W);
    S.lg = g;
    host.style.height = g.H + 'px';
    [svg, ropesSvg].forEach(el => {
      el.setAttribute('viewBox', '0 0 ' + W + ' ' + g.H);
      el.setAttribute('width', W);
      el.setAttribute('height', g.H);
    });
    const out = [];
    // 刻度隔一周；横轴太挤（7 天不到 64px）就隔两周，免得「进群当天」和「7 天」叠在一起
    const every = g.X(7) - g.X(0) < 64 ? 14 : 7;
    for (let d = 0; d <= g.days; d += every) {
      const anchor = d === 0 ? ' is-start' : d === g.days ? ' is-end' : '';
      out.push('<line class="ins-grid-line" x1="' + P(g.X(d)) + '" x2="' + P(g.X(d)) + '" y1="' + esc(String(g.pad.t)) + '" y2="' + P(g.H - g.pad.b + 4) + '"></line>' +
        '<text class="ins-axis-x' + anchor + '" x="' + P(g.X(d)) + '" y="' + P(g.H - 8) + '">' + (d === 0 ? '进群当天' : d + ' 天') + '</text>');
    }
    STEPS.forEach((s, i) => {
      const y = g.barY(i);
      out.push('<g class="ins-step" data-ins-step="' + s.key + '" style="--c:var(--cat-' + s.cat + ')">' +
        '<text class="ins-step-label" x="' + esc(String(g.pad.l)) + '" y="' + P(y - 16) + '">' + s.label + '</text>' +
        '<text class="ins-step-value" data-ins-step-v x="' + P(W - g.pad.r) + '" y="' + P(y - 16) + '"></text>' +
        '<rect class="ins-step-track" x="' + esc(String(g.pad.l)) + '" y="' + P(y - 5) + '" width="' + P(W - g.pad.l - g.pad.r) + '" height="10" rx="5"></rect>' +
        '<g data-ins-step-others></g>' +
        '<rect class="ins-step-iqr" data-ins-step-iqr x="0" y="' + P(y - 5) + '" width="0" height="10" rx="5"></rect>' +
        '<rect class="ins-step-none" data-ins-step-none x="' + esc(String(g.pad.l)) + '" y="' + P(y - 5) + '" width="' + P(W - g.pad.l - g.pad.r) + '" height="10" rx="5" visibility="hidden"></rect>' +
        '</g>');
    });
    out.push('<g data-ins-ldots></g>');
    svg.innerHTML = out.join('');
    // 其他月份的中位数：短竖线
    STEPS.forEach((s, i) => {
      const holder = svg.querySelector('[data-ins-step="' + s.key + '"] [data-ins-step-others]');
      const y = g.barY(i);
      holder.innerHTML = S.model.ladderKeys.map(k => {
        const cell = S.model.milestones.get(k);
        const v = cell && cell[s.key];
        return v ? '<line class="ins-step-other" data-k="' + esc(k) + '" x1="' + P(g.X(v.median)) + '" x2="' + P(g.X(v.median)) + '" y1="' + P(y - 9) + '" y2="' + P(y + 9) + '"><title>' + monthLabel(k) + '进群 · 中位 ' + f1(v.median) + ' 天</title></line>' : '';
      }).join('');
    });
    ladderTo(false);
  }

  // 选中组变了：圆点滑到新位置，连着它们的重力线跟着晃
  function ladderTo(animate) {
    const svg = S.root.querySelector('[data-ins-ladder-svg]');
    const ropesSvg = S.root.querySelector('[data-ins-ladder-ropes]');
    const list = S.root.querySelector('[data-ins-ladder-list]');
    if (!svg || !ropesSvg || !S.lg) return;
    const g = S.lg;
    const cell = S.model.milestones.get(S.cohort) || null;
    const label = (S.model.cohorts.find(c => c.key === S.cohort) || {}).label || monthLabel(S.cohort);
    const targets = STEPS.map((s, i) => {
      const v = cell && cell[s.key];
      return v ? { x: g.X(v.median), y: g.barY(i), v } : null;
    });
    STEPS.forEach((s, i) => {
      const grp = svg.querySelector('[data-ins-step="' + s.key + '"]');
      const t = targets[i];
      const iqr = grp.querySelector('[data-ins-step-iqr]');
      const none = grp.querySelector('[data-ins-step-none]');
      const val = grp.querySelector('[data-ins-step-v]');
      grp.querySelectorAll('.ins-step-other').forEach(el => el.classList.toggle('is-self', el.getAttribute('data-k') === S.cohort));
      if (t) {
        const x0 = g.X(t.v.p25);
        const w = Math.max(10, g.X(t.v.p75) - x0);
        iqr.setAttribute('x', P(x0 - (w === 10 ? 5 - (g.X(t.v.p75) - x0) / 2 : 0)));
        iqr.setAttribute('width', P(w));
        iqr.setAttribute('visibility', 'visible');
        none.setAttribute('visibility', 'hidden');
        val.textContent = medianText(t.v.median) + ' · 第 ' + f1(t.v.p25) + '–' + f1(t.v.p75) + ' 天';
        val.classList.remove('is-none');
      } else {
        iqr.setAttribute('visibility', 'hidden');
        none.setAttribute('visibility', 'visible');
        val.textContent = '不足 10 人，不展示';
        val.classList.add('is-none');
      }
    });
    if (list) {
      list.innerHTML = STEPS.map((s, i) => {
        const t = targets[i];
        return '<li style="--c:var(--cat-' + s.cat + ')"><i aria-hidden="true"></i><span>' + s.label + '</span><b>' +
          (t ? medianText(t.v.median) + ' · 中间一半在第 ' + f1(t.v.p25) + '–' + f1(t.v.p75) + ' 天' : '不足 10 人，不展示') + '</b></li>';
      }).join('');
      list.setAttribute('aria-label', label + '进群的一组');
    }
    // 圆点（HTML 外的 SVG 层：画在绳子上面）
    const prev = S.ladderDots || [];
    const fresh = !prev.length || !animate;
    S.ladderDots = targets.map((t, i) => {
      const old = prev[i];
      if (!t) return null;
      const from = !fresh && old ? { x: old.x, y: old.y } : { x: t.x, y: t.y };
      return { x: from.x, y: from.y, fx: from.x, tx: t.x, y0: t.y, cat: STEPS[i].cat };
    });
    S.ladderT0 = performance.now();
    S.ladderDur = fresh || reduced() ? 0 : ms('--motion-stage', 480);
    // 相邻两步之间挂一根线
    S.ladderLoop.clear();
    (S.ladderRopes || []).forEach(r => r.destroy());
    S.ladderRopes = [];
    const pairs = [];
    for (let i = 0; i < STEPS.length - 1; i++) if (S.ladderDots[i] && S.ladderDots[i + 1]) pairs.push([i, i + 1]);
    pairs.forEach(([a, b]) => {
      const r = rope(S.ladderDots[a], S.ladderDots[b], 1.07, { a, b });
      S.ladderRopes.push(r);
      S.ladderLoop.add(r);
    });
    // 绳子在底层（从横条和字后面穿过），圆点在最上层
    ropesSvg.innerHTML = S.ladderRopes.map((r, i) => '<path class="ins-ladder-rope" data-ins-lrope="' + i + '" d="' + esc(r.path()) + '"></path>').join('');
    const dots = svg.querySelector('[data-ins-ldots]');
    if (dots) dots.innerHTML = S.ladderDots.map((d, i) => (d ? '<circle class="ins-step-dot" data-ins-ldot="' + i + '" style="--c:var(--cat-' + esc(d.cat) + ')" cx="' + P(d.x) + '" cy="' + P(d.y0) + '" r="6.5"></circle>' : '')).join('');
    if (animate && S.ladderDur) {
      S.ladderRopes.forEach(r => r.pluck(3));
      S.ladderLoop.wake();
    }
  }

  function ladderFrame() {
    if (!S || !S.ladderDots) return false;
    const t = S.ladderDur ? clamp((performance.now() - S.ladderT0) / S.ladderDur, 0, 1) : 1;
    const e = 1 - Math.pow(1 - t, 3);
    S.ladderDots.forEach(d => { if (d) d.x = d.fx + (d.tx - d.fx) * e; });
    S.ladderRopes.forEach(r => {
      const { a, b } = r.data;
      r.setEnds({ x: S.ladderDots[a].x, y: S.ladderDots[a].y0 }, { x: S.ladderDots[b].x, y: S.ladderDots[b].y0 });
    });
    const ropesSvg = S.root.querySelector('[data-ins-ladder-ropes]');
    if (ropesSvg) {
      S.ladderRopes.forEach((r, i) => {
        const el = ropesSvg.querySelector('[data-ins-lrope="' + i + '"]');
        if (el) el.setAttribute('d', r.path());
      });
      const dots = S.root.querySelector('[data-ins-ldots]');
      S.ladderDots.forEach((d, i) => {
        const el = d && dots && dots.querySelector('[data-ins-ldot="' + i + '"]');
        if (el) el.setAttribute('cx', P(d.x));
      });
    }
    return t < 1;
  }

  /* ---------- 角色变化 ---------- */

  function drawRoles() {
    const m = S.model;
    const host = S.root.querySelector('[data-ins-roles-chart]');
    const svg = S.root.querySelector('[data-ins-role-svg]');
    if (!host || !svg || !m.roles.length) return;
    let max = 0;
    m.roles.forEach(r => ROLES.forEach(k => { if (isNum(r[k.key + 'Rate'])) max = Math.max(max, r[k.key + 'Rate']); }));
    const top = niceCeil(max * 1.08, 0.1);
    const W = host.clientWidth;
    const small = narrow();
    const H = small ? 212 : 248;
    const pad = { t: 14, r: small ? 74 : 92, b: 28, l: 34 };
    const n = m.roles.length;
    const X = i => pad.l + (n === 1 ? (W - pad.l - pad.r) / 2 : i / (n - 1) * (W - pad.l - pad.r));
    const Y = v => pad.t + (1 - v / top) * (H - pad.t - pad.b);
    S.roleGeo = { W, H, X, Y, pad, n };
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('width', W);
    svg.setAttribute('height', H);
    const out = [];
    for (let v = 0; v <= top + 1e-9; v += 0.1) {
      out.push('<line class="ins-grid-line' + (v === 0 ? ' is-base' : '') + '" x1="' + pad.l + '" x2="' + P(W - pad.r + 8) + '" y1="' + P(Y(v)) + '" y2="' + P(Y(v)) + '"></line>' +
        '<text class="ins-axis-y" x="' + (pad.l - 8) + '" y="' + P(Y(v)) + '">' + Math.round(v * 100) + '%</text>');
    }
    m.roles.forEach((r, i) => {
      out.push('<text class="ins-axis-x" x="' + P(X(i)) + '" y="' + P(H - 8) + '">' + monthLabel(r.month) + '</text>');
    });
    const ends = [];
    ROLES.forEach(k => {
      const vals = m.roles.map(r => r[k.key + 'Rate']);
      const segs = runs(vals);
      let d = '';
      segs.forEach(seg => { d += monotone(seg.map(i => [X(i), Y(vals[i])]), true); });
      for (let i = 1; i < segs.length; i++) {
        const a = segs[i - 1][segs[i - 1].length - 1];
        const b = segs[i][0];
        out.push('<path class="ins-gap" d="M' + P(X(a)) + ' ' + P(Y(vals[a])) + 'L' + P(X(b)) + ' ' + P(Y(vals[b])) + '"></path>');
      }
      out.push('<g class="ins-role-series" data-ins-series="' + esc(k.key) + '" style="--c:var(--cat-' + esc(k.cat) + ')">' +
        '<path class="ins-role-line" d="' + d + '"></path>' +
        vals.map((v, i) => (isNum(v) ? '<circle class="ins-role-dot" data-i="' + i + '" cx="' + P(X(i)) + '" cy="' + P(Y(v)) + '" r="3"></circle>' : '')).join('') +
        '</g>');
      vals.forEach((v, i) => {
        if (!isNum(v)) out.push('<text class="ins-role-none" x="' + P(X(i)) + '" y="' + P(Y(0) - 8) + '">' + esc(k.short) + '不足 10 人</text>');
      });
      const last = segs.length ? segs[segs.length - 1][segs[segs.length - 1].length - 1] : -1;
      if (last >= 0) ends.push({ k, y: Y(vals[last]), x: X(last), v: vals[last] });
    });
    // 末端标签：竖向推开，至少隔 16px
    ends.sort((a, b) => a.y - b.y);
    for (let i = 1; i < ends.length; i++) if (ends[i].y < ends[i - 1].y + 16) ends[i].y = ends[i - 1].y + 16;
    ends.forEach(e => out.push('<text class="ins-role-end" style="--c:var(--cat-' + esc(e.k.cat) + ')" x="' + P(e.x + 10) + '" y="' + P(e.y) + '">' +
      '<tspan class="ins-role-end-v">' + pct(e.v, 0) + '</tspan> ' + esc(e.k.short) + '</text>'));
    out.push('<line class="ins-guide" data-ins-role-guide x1="0" x2="0" y1="' + pad.t + '" y2="' + P(Y(0)) + '" visibility="hidden"></line>');
    svg.innerHTML = out.join('');
    roleFocus(S.roleMonth);
  }

  function animateRoles() {
    if (reduced()) return;
    const ease = getComputedStyle(S.root).getPropertyValue('--ease-out').trim() || 'ease-out';
    S.root.querySelectorAll('.ins-role-line').forEach((line, i) => {
      if (typeof line.animate !== 'function') return;
      const len = line.getTotalLength();
      line.animate([{ strokeDasharray: len + ' ' + len, strokeDashoffset: len }, { strokeDasharray: len + ' ' + len, strokeDashoffset: 0 }],
        { duration: ms('--motion-stage', 480) * 1.5, delay: i * ms('--stagger', 32) * 3, easing: ease, fill: 'backwards' });
    });
  }

  function roleFocus(i) {
    const m = S.model;
    const box = S.root.querySelector('[data-ins-roles]');
    if (!box) return;
    const last = (() => {
      for (let x = m.roles.length - 1; x >= 0; x--) if (ROLES.some(k => isNum(m.roles[x][k.key + 'Rate']))) return x;
      return m.roles.length - 1;
    })();
    const idx = i < 0 ? last : i;
    const row = m.roles[idx];
    const first = m.roles[0];
    const partial = m.snapshot && row.month === m.snapshot.slice(0, 7) && Number(m.snapshot.slice(8, 10)) < 28;
    const when = box.querySelector('[data-ins-role-when]');
    if (when) {
      when.textContent = monthLabel(row.month) + (partial ? '（截至 ' + short(m.snapshot) + '）' : '') + ' · ' +
        (isNum(row.active) ? '说过话的 ' + fmt(row.active) + ' 人' : '活跃人数不足 10');
    }
    ROLES.forEach(k => {
      const card = box.querySelector('[data-ins-role="' + k.key + '"]');
      const rate = row[k.key + 'Rate'];
      card.querySelector('[data-ins-role-v]').textContent = isNum(rate) ? String(Math.round(rate * 100)) : '—';
      card.querySelector('.ins-role-u').hidden = !isNum(rate);
      const d = card.querySelector('[data-ins-role-d]');
      const base = first[k.key + 'Rate'];
      if (isNum(rate) && isNum(base) && idx > 0) {
        d.textContent = '比 ' + monthLabel(first.month) + ' ' + signed((rate - base) * 100) + ' 点';
        d.hidden = false;
      } else d.hidden = true;
      card.querySelector('[data-ins-role-m]').textContent = isNum(row[k.key]) ? fmt(row[k.key]) + ' 人' : '人数不足 10，不展示';
    });
    const svg = box.querySelector('[data-ins-role-svg]');
    const g = S.roleGeo;
    if (svg && g) {
      const guide = svg.querySelector('[data-ins-role-guide]');
      svg.querySelectorAll('.ins-role-dot').forEach(el => el.classList.toggle('is-on', Number(el.getAttribute('data-i')) === idx));
      if (guide) {
        guide.setAttribute('x1', P(g.X(idx)));
        guide.setAttribute('x2', P(g.X(idx)));
        guide.setAttribute('visibility', i < 0 ? 'hidden' : 'visible');
      }
    }
    S.roleMonth = i;
  }

  function onRoleMove(e) {
    const g = S.roleGeo;
    if (!g) return;
    const x = e.clientX - e.currentTarget.getBoundingClientRect().left;
    const i = g.n === 1 ? 0 : clamp(Math.round((x - g.pad.l) / ((g.W - g.pad.l - g.pad.r) / (g.n - 1))), 0, g.n - 1);
    if (i !== S.roleMonth) roleFocus(i);
  }

  function onRoleKey(e) {
    const n = S.model.roles.length;
    let i = S.roleMonth;
    if (e.key === 'ArrowRight') i = i < 0 ? 0 : Math.min(n - 1, i + 1);
    else if (e.key === 'ArrowLeft') i = i < 0 ? n - 1 : Math.max(0, i - 1);
    else if (e.key === 'Escape') i = -1;
    else return;
    e.preventDefault();
    roleFocus(i);
    if (i >= 0) say(monthLabel(S.model.roles[i].month) + '：' + ROLES.map(k => k.short + ' ' + (isNum(S.model.roles[i][k.key + 'Rate']) ? pct(S.model.roles[i][k.key + 'Rate'], 0) : '不展示')).join('，'));
  }

  /* ---------- 重力线演示 ---------- */

  function demoLayout() {
    const box = S.root.querySelector('[data-ins-demo]');
    const canvas = S.root.querySelector('[data-ins-demo-canvas]');
    if (!box || !canvas) return;
    const W = box.clientWidth;
    const H = box.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    const D = S.demo;
    D.W = W;
    D.H = H;
    D.dpr = dpr;
    const padX = Math.min(64, W * 0.09);
    D.nodes.forEach((n, i) => {
      const spec = DEMO_NODES[i];
      n.hx = padX + spec.x * (W - 2 * padX) - (spec.x - 0.5) * 2 * padX * 0.2;
      n.hy = 36 + spec.y * (H - 84);
      if (!n.drag) {
        n.x = n.hx;
        n.y = n.hy;
        n.vx = 0;
        n.vy = 0;
      }
    });
    D.colors = DEMO_NODES.map(n => cssOf(n.c));
    D.shadow = cssOf('var(--slate-900)');
    D.ropes.forEach(r => r.setEnds(D.nodes[r.data.a], D.nodes[r.data.b], { instant: true }));
    placeNodes();
    paintDemo();
  }

  function placeNodes() {
    const D = S.demo;
    D.nodes.forEach((n, i) => {
      const el = D.els[i];
      if (el) el.style.translate = P(n.x) + 'px ' + P(n.y) + 'px';
    });
  }

  function paintDemo() {
    const D = S.demo;
    const canvas = S.root.querySelector('[data-ins-demo-canvas]');
    if (!canvas || !D.W) return;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(D.dpr, 0, 0, D.dpr, 0, 0);
    ctx.clearRect(0, 0, D.W, D.H);
    // 墙上的影子：同一批线往下错开，用批量画法一次描完
    ctx.save();
    ctx.translate(0, 10);
    if (window.CommonsGravity) window.CommonsGravity.batch(ctx, D.ropes, { color: D.shadow, width: 3, alpha: 0.07 });
    ctx.restore();
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    D.ropes.forEach(r => {
      const a = D.nodes[r.data.a];
      const b = D.nodes[r.data.b];
      const grad = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
      grad.addColorStop(0, D.colors[r.data.a]);
      grad.addColorStop(1, D.colors[r.data.b]);
      ctx.beginPath();
      r.trace(ctx);
      ctx.strokeStyle = grad;
      ctx.stroke();
    });
    ctx.restore();
  }

  function demoFrame(dt) {
    const D = S.demo;
    let busy = false;
    const h = Math.min(dt, 50) / 1000;
    D.nodes.forEach(n => {
      if (n.drag) {
        busy = true;
        return;
      }
      const dx = n.x - n.hx;
      const dy = n.y - n.hy;
      if (Math.abs(dx) < 0.2 && Math.abs(dy) < 0.2 && Math.abs(n.vx) < 0.2 && Math.abs(n.vy) < 0.2) {
        n.x = n.hx;
        n.y = n.hy;
        n.vx = 0;
        n.vy = 0;
        return;
      }
      busy = true;
      // 欠阻尼弹簧：松手后节点回家时冲过头一点再回来
      const k = 210;
      const c = 15;
      const sub = 4;
      for (let s = 0; s < sub; s++) {
        n.vx += (-k * (n.x - n.hx) - c * n.vx) * h / sub;
        n.vy += (-k * (n.y - n.hy) - c * n.vy) * h / sub;
        n.x += n.vx * h / sub;
        n.y += n.vy * h / sub;
      }
    });
    D.ropes.forEach(r => r.setEnds(D.nodes[r.data.a], D.nodes[r.data.b]));
    placeNodes();
    const t0 = performance.now();
    paintDemo();
    D.paint = performance.now() - t0;
    D.frames += 1;
    if (D.frames % 6 === 1) readout(true);
    return busy;
  }

  function readout(moving) {
    const el = S.root.querySelector('[data-ins-readout]');
    if (!el) return;
    const D = S.demo;
    if (moving) {
      const n = D.ropes.filter(r => !r.settled).length;
      el.textContent = '摆动中 · ' + n + ' 条线 · ' + (D.loop.cost || 0).toFixed(2) + ' ms/帧';
      el.setAttribute('data-moving', '');
    } else {
      el.textContent = reduced() ? '减弱动效：直接画终态，不模拟' : '静止 · 不占动画帧' + (D.frames ? ' · 上次摆了 ' + D.frames + ' 帧' : '');
      el.removeAttribute('data-moving');
    }
  }

  function wakeDemo() {
    const D = S.demo;
    if (!D.loop.running) D.frames = 0;
    D.loop.wake();
  }

  function demoNodeDown(e) {
    const el = e.currentTarget;
    const i = Number(el.getAttribute('data-ins-node'));
    const D = S.demo;
    const n = D.nodes[i];
    const box = S.root.querySelector('[data-ins-demo]').getBoundingClientRect();
    n.drag = { id: e.pointerId, ox: e.clientX - box.left - n.x, oy: e.clientY - box.top - n.y, box };
    el.setPointerCapture && el.setPointerCapture(e.pointerId);
    el.setAttribute('data-drag', '');
    e.preventDefault();
    wakeDemo();
  }

  function demoNodeMove(e) {
    const i = Number(e.currentTarget.getAttribute('data-ins-node'));
    const n = S.demo.nodes[i];
    if (!n.drag || n.drag.id !== e.pointerId) return;
    const D = S.demo;
    n.x = clamp(e.clientX - n.drag.box.left - n.drag.ox, 12, D.W - 12);
    n.y = clamp(e.clientY - n.drag.box.top - n.drag.oy, 12, D.H - 12);
    wakeDemo();
  }

  function demoNodeUp(e) {
    const el = e.currentTarget;
    const i = Number(el.getAttribute('data-ins-node'));
    const n = S.demo.nodes[i];
    if (!n.drag) return;
    n.drag = null;
    n.vx = 0;
    n.vy = 0;
    el.removeAttribute('data-drag');
    if (reduced()) {
      n.x = n.hx;
      n.y = n.hy;
      S.demo.ropes.forEach(r => r.setEnds(S.demo.nodes[r.data.a], S.demo.nodes[r.data.b], { instant: true }));
      placeNodes();
      paintDemo();
      return;
    }
    wakeDemo();
  }

  function demoNodeKey(e) {
    const i = Number(e.currentTarget.getAttribute('data-ins-node'));
    const D = S.demo;
    const n = D.nodes[i];
    const push = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (push) {
      e.preventDefault();
      if (reduced()) return;
      n.x = clamp(n.x + push[0] * 36, 12, D.W - 12);
      n.y = clamp(n.y + push[1] * 36, 12, D.H - 12);
      wakeDemo();
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      D.ropes.filter(r => r.data.a === i || r.data.b === i).forEach((r, k) => r.pluck(k % 2 ? -7 : 7));
      wakeDemo();
    }
  }

  function pluckAll() {
    const D = S.demo;
    if (reduced()) {
      readout(false);
      return;
    }
    D.ropes.forEach((r, i) => r.pluck((i % 2 ? -1 : 1) * (6 + (i % 3) * 2), 0.35 + (i % 3) * 0.15));
    wakeDemo();
  }

  function mountDemo() {
    const box = S.root.querySelector('[data-ins-demo]');
    if (!box) return;
    const D = {
      nodes: DEMO_NODES.map(() => ({ x: 0, y: 0, hx: 0, hy: 0, vx: 0, vy: 0, drag: null })),
      els: Array.from(box.querySelectorAll('[data-ins-node]')),
      ropes: [],
      frames: 0,
      W: 0,
      H: 0
    };
    S.demo = D;
    D.ropes = DEMO_LINKS.map(([a, b]) => rope({ x: 0, y: 0 }, { x: 1, y: 0 }, 1.12, { a, b }));
    D.loop = driver({ ropes: D.ropes, frame: demoFrame, rest: () => { if (S && S.demo === D) readout(false); } });
    S.loops.push(D.loop);
    demoLayout();
    readout(false);
    D.els.forEach(el => {
      listen(el, 'pointerdown', demoNodeDown);
      listen(el, 'pointermove', demoNodeMove);
      listen(el, 'pointerup', demoNodeUp);
      listen(el, 'pointercancel', demoNodeUp);
      listen(el, 'keydown', demoNodeKey);
    });
  }

  /* ---------- 生命周期 ---------- */

  function redrawAll() {
    if (!S) return;
    if (S.model && !S.model.stream.empty) drawStream();
    if (S.model && S.model.cohorts.length) {
      drawRetain();
      if (S.root.querySelector('[data-ins-ladder]')) drawLadder();
    }
    if (S.model && S.model.roles.length) drawRoles();
    if (S.demo) demoLayout();
  }

  function onClick(e) {
    const t = e.target.closest('[data-ins-layer],[data-ins-cohort],[data-ins-pluck],[data-ins-retry],[data-ins-note]');
    if (!t || !S.root.contains(t)) return;
    if (t.hasAttribute('data-ins-layer')) selectTopic(t.getAttribute('data-ins-layer'), 'chip');
    else if (t.hasAttribute('data-ins-cohort')) selectCohort(t.getAttribute('data-ins-cohort'));
    else if (t.hasAttribute('data-ins-pluck')) pluckAll();
    else if (t.hasAttribute('data-ins-note')) {
      const it = (S.noteItems || [])[Number(t.getAttribute('data-ins-note'))];
      if (it) selectTopic(it.r.layer, 'note');
    } else if (t.hasAttribute('data-ins-retry')) {
      const root = S.root;
      destroy();
      root.outerHTML = page();
      mount();
    }
  }

  function onOver(e) {
    const chip = e.target.closest('[data-ins-layer]');
    const note = e.target.closest('[data-ins-note]');
    const svg = S.root.querySelector('[data-ins-stream-svg]');
    if (!svg) return;
    if (note && S.root.contains(note)) {
      const i = Number(note.getAttribute('data-ins-note'));
      const r = S.leaders[i];
      if (r && note !== S.lastNote) {
        r.pluck(4.5);
        S.leaderLoop.wake();
      }
      S.lastNote = note;
      return;
    }
    S.lastNote = null;
    const key = chip && S.root.contains(chip) ? chip.getAttribute('data-ins-layer') : '';
    svg.querySelectorAll('.ins-layer').forEach(el => el.classList.toggle('is-peek', !!key && el.getAttribute('data-layer') === key));
    if (key) svg.setAttribute('data-peek', key); else svg.removeAttribute('data-peek');
  }

  function observeOnce(el, fn) {
    if (!el) return;
    if (typeof IntersectionObserver !== 'function') {
      fn();
      return;
    }
    const io = new IntersectionObserver(entries => {
      if (entries.some(en => en.isIntersecting)) {
        io.disconnect();
        S.observers = S.observers.filter(o => o !== io);
        fn();
      }
    }, { threshold: 0.35 });
    io.observe(el);
    S.observers.push(io);
  }

  function mount() {
    const root = document.querySelector('[data-ins-root]');
    if (!root) return;
    if (S && S.root === root) return;
    destroy();
    let model = pending;
    if (!model && !root.hasAttribute('data-ins-state')) {
      const src = pickSource();
      try {
        model = src ? build(src.raw, src.synthetic) : null;
      } catch (err) {
        model = null;
      }
    }
    S = {
      root,
      model,
      off: [],
      timers: [],
      observers: [],
      loops: [],
      hl: '',
      cohort: model ? model.defaultCohort : '',
      streamWeek: -1,
      retainWeek: -1,
      roleMonth: -1,
      leaders: [],
      ladderRopes: [],
      width: 0
    };
    S.leaderLoop = driver({ frame: () => { drawLeaders(); return false; } });
    S.ladderLoop = driver({ frame: ladderFrame });
    S.loops.push(S.leaderLoop, S.ladderLoop);
    listen(root, 'click', onClick);
    if (model) {
      listen(root, 'pointerover', onOver);
      listen(root, 'pointerleave', () => {
        if (!S) return;
        S.lastNote = null;
        const svg = S.root.querySelector('[data-ins-stream-svg]');
        if (svg) svg.removeAttribute('data-peek');
        S.root.querySelectorAll('.ins-layer.is-peek').forEach(el => el.classList.remove('is-peek'));
      });
      if (!model.stream.empty) {
        S.revealing = !reduced() && typeof Element.prototype.animate === 'function';
        drawStream();
        const svg = root.querySelector('[data-ins-stream-svg]');
        listen(svg, 'pointermove', onStreamMove);
        listen(svg, 'pointerleave', hideStreamTip);
        listen(svg, 'click', onStreamClick);
        listen(svg, 'keydown', onStreamKey);
        listen(svg, 'blur', hideStreamTip);
        revealStream();
      }
      if (model.cohorts.length) {
        drawRetain();
        callout();
        const svg = root.querySelector('[data-ins-retain-svg]');
        listen(svg, 'pointermove', onRetainMove);
        listen(svg, 'pointerleave', hideRetainTip);
        listen(svg, 'click', onRetainClick);
        listen(svg, 'keydown', onRetainKey);
        listen(svg, 'blur', hideRetainTip);
        observeOnce(root.querySelector('[data-ins-retain]'), () => S && animateRetain());
        if (root.querySelector('[data-ins-ladder]')) {
          drawLadder();
          observeOnce(root.querySelector('[data-ins-ladder]'), () => {
            if (!S || reduced()) return;
            S.ladderRopes.forEach(r => r.drop());
            S.ladderLoop.wake();
          });
        }
      }
      if (model.roles.length) {
        drawRoles();
        const svg = root.querySelector('[data-ins-role-svg]');
        listen(svg, 'pointermove', onRoleMove);
        listen(svg, 'pointerleave', () => roleFocus(-1));
        listen(svg, 'keydown', onRoleKey);
        listen(svg, 'blur', () => roleFocus(-1));
        observeOnce(root.querySelector('[data-ins-roles-chart]'), () => S && animateRoles());
      }
    }
    mountDemo();
    if (S.demo) {
      observeOnce(root.querySelector('[data-ins-demo]'), () => {
        if (!S || reduced()) return;
        S.demo.ropes.forEach(r => r.drop());
        wakeDemo();
      });
    }
    S.width = root.clientWidth;
    if (typeof ResizeObserver === 'function') {
      let pendingFrame = 0;
      const ro = new ResizeObserver(() => {
        if (!S || Math.abs(root.clientWidth - S.width) < 1) return;
        S.width = root.clientWidth;
        clearTimeout(pendingFrame);
        pendingFrame = setTimeout(redrawAll, 60);
        S.timers.push(pendingFrame);
      });
      ro.observe(root);
      S.observers.push(ro);
    }
  }

  function destroy() {
    if (!S) return;
    S.off.forEach(fn => fn());
    S.timers.forEach(id => clearTimeout(id));
    S.observers.forEach(o => o.disconnect());
    S.loops.forEach(l => l.stop());
    (S.leaders || []).forEach(r => r.destroy());
    (S.ladderRopes || []).forEach(r => r.destroy());
    if (S.demo) S.demo.ropes.forEach(r => r.destroy());
    S = null;
  }

  if (window.CommonsLinks && typeof window.CommonsLinks.provide === 'function') {
    window.CommonsLinks.provide('insight', function () {
      return { label: '群的走向', href: '#/insights', icon: 'chart' };
    });
  }

  window.CommonsInsights = { routes: { insights: page }, hub: ['insights'], mount, destroy };
})();
