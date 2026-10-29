/* RINGS-2 · 群的一年 · 年轮舞台
 * 数字全部来自 window.COMMONS_ARCHIVE（真实记录 · 匿名聚合），不写死任何计数。
 * 配色职责：按天 = 蓝色阶，群钟 = 青色阶，主题 = 分类色 --cat-*；空日 = 最淡的灰。色阶变量定义在 rings.css。
 * 口径：weekday 0=周一；群钟每格的「次数」按日历逐日数出，首日从首条消息的小时起、末日到截止小时止。
 * 只挂载到主控给的宿主元素，导出 window.CommonsRings = { render, destroy }。
 */
(function () {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  const CX = 420;
  const CY = 280;
  const R_HOLE = 46;
  const R_Y0 = 50;
  const R_Y1 = 170;
  const R_WD = 182;
  const R_B0 = 196;
  const R_B1 = 244;
  const R_B_LABEL = 256;
  const R_Z0 = 58;
  const R_Z1 = 220;
  const R_Z_LABEL = 234;
  const R_ELBOW = 256;
  const T_BASE = 132;
  const T_MAX = 70;
  const T_PAD = 6;
  const T_LABEL = 224;
  const HOUR_GAP = 16;
  const HOUR_STEP = (360 - HOUR_GAP) / 24;
  const RING_GAP = 1.6;
  const BAND_GAP = 1.4;
  const ZOOM_GAP = 2.2;
  const SLOT_GAP = 0.3;
  const DAY_BINS = 8;
  const CLOCK_BINS = 7;
  const CAT_COUNT = 10;
  const DAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const WD = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  const WD_SHORT = ['一', '二', '三', '四', '五', '六', '日'];
  const MODES = ['day', 'clock', 'topic'];
  const MODE_LABEL = { day: '按天', clock: '群钟', topic: '主题' };

  const nf = typeof Intl === 'object' && Intl.NumberFormat ? new Intl.NumberFormat('zh-CN') : null;
  const fmt = n => nf ? nf.format(n) : String(n);
  const pct = n => (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const rad = d => d * Math.PI / 180;
  const hh = h => String(h).padStart(2, '0');
  const validCount = n => Number.isSafeInteger(n) && n >= 0;
  const validDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && (() => {
    const d = new Date(s + 'T00:00:00Z');
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s;
  })();
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const dayName = s => DAY_NAMES[new Date(s + 'T00:00:00Z').getUTCDay()];
  const slotOf = s => (new Date(s + 'T00:00:00Z').getUTCDay() + 6) % 7;
  const short = s => String(s || '').slice(5).replace('-', '.');
  const addDays = (s, n) => {
    const d = new Date(s + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const weekKey = s => addDays(s, -slotOf(s));
  const hourOf = iso => {
    const m = /T(\d{2}):/.exec(String(iso || ''));
    return m ? Number(m[1]) : null;
  };
  const point = (r, a) => [CX + r * Math.cos(rad(a)), CY + r * Math.sin(rad(a))];
  const slotAngle = slot => -90 + slot * 360 / 7;
  const hourAngle = h => -90 + HOUR_GAP / 2 + h * HOUR_STEP;
  const binOf = (value, min, max, gamma, bins) => {
    if (!(max > min)) return bins - 1;
    const t = clamp((value - min) / (max - min), 0, 1);
    return Math.min(bins - 1, Math.floor(Math.pow(t, gamma) * bins));
  };
  const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  function make(tag, attrs, text) {
    const node = document.createElementNS(NS, tag);
    if (attrs) for (const key in attrs) {
      if (attrs[key] !== undefined && attrs[key] !== null) node.setAttribute(key, attrs[key]);
    }
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function sector(r0, r1, a0, a1) {
    const [x0, y0] = point(r1, a0);
    const [x1, y1] = point(r1, a1);
    const [x2, y2] = point(r0, a1);
    const [x3, y3] = point(r0, a0);
    const large = a1 - a0 > 180 ? 1 : 0;
    return 'M' + x0.toFixed(2) + ' ' + y0.toFixed(2) +
      'A' + r1.toFixed(2) + ' ' + r1.toFixed(2) + ' 0 ' + large + ' 1 ' + x1.toFixed(2) + ' ' + y1.toFixed(2) +
      'L' + x2.toFixed(2) + ' ' + y2.toFixed(2) +
      'A' + r0.toFixed(2) + ' ' + r0.toFixed(2) + ' 0 ' + large + ' 0 ' + x3.toFixed(2) + ' ' + y3.toFixed(2) + 'Z';
  }

  let root = null;
  let host = null;
  let model = null;
  let refs = null;
  let view = 'day';
  let selectedDay = '';
  let selectedClock = '';
  let selectedTopic = '';
  let defaultClock = '';
  let defaultTopic = '';
  let geo = new Map();
  let listeners = [];
  let raf = 0;
  let rollRaf = 0;
  let rollTimer = 0;
  let observer = null;
  let rolled = false;
  let hoverKey = '';
  let tipKey = '';

  function listen(target, type, fn) {
    if (!target) return;
    target.addEventListener(type, fn);
    listeners.push([target, type, fn]);
  }

  /* ---------- 数据 ---------- */

  function buildModel() {
    const source = window.COMMONS_ARCHIVE;
    if (!source || !source.coverage || !validCount(source.coverage.messageCount)) return null;
    const rawDaily = Array.isArray(source.daily) ? source.daily : [];
    const seen = new Map();
    rawDaily.forEach(row => {
      if (!row || !validDate(row.date) || !validCount(row.count)) return;
      if (!seen.has(row.date)) seen.set(row.date, { date: row.date, count: row.count });
    });
    const daily = [...seen.values()].sort((a, b) => a.date.localeCompare(b.date));
    if (!daily.length) return null;

    const counts = daily.map(row => row.count);
    const total = source.coverage.messageCount;
    const mean = total / daily.length || 0;
    const min = Math.min(...counts);
    const max = Math.max(...counts);
    const peak = daily.reduce((best, row) => row.count > best.count ? row : best, daily[0]);
    const byDate = new Map(daily.map(row => [row.date, row]));
    const indexOf = new Map(daily.map((row, index) => [row.date, index]));
    const rankOf = count => 1 + counts.filter(value => value > count).length;
    const dayBin = count => binOf(count, min, max, 0.85, DAY_BINS);

    const groups = [];
    const groupIndex = new Map();
    daily.forEach(row => {
      const key = weekKey(row.date);
      if (!groupIndex.has(key)) {
        groupIndex.set(key, groups.length);
        groups.push({ key, days: [] });
      }
      groups[groupIndex.get(key)].days.push(row);
    });
    const weekAvg = groups.map(group => group.days.reduce((sum, row) => sum + row.count, 0) / group.days.length);
    const maxAvg = Math.max(...weekAvg, 1);
    const raw = weekAvg.map(value => 1 + Math.pow(value / maxAvg, 1.3) * 4.2);
    const span = R_Y1 - R_Y0 - RING_GAP * (groups.length - 1);
    const scale = span / Math.max(raw.reduce((sum, value) => sum + value, 0), 1);
    let cursor = R_Y0;
    const rings = groups.map((group, index) => {
      const r0 = cursor;
      const r1 = cursor + raw[index] * scale;
      cursor = r1 + RING_GAP;
      return {
        ...group,
        index,
        r0,
        r1,
        avg: weekAvg[index],
        first: group.days[0].date,
        last: group.days[group.days.length - 1].date
      };
    });
    const ringOf = new Map();
    rings.forEach(ring => ring.days.forEach(day => ringOf.set(day.date, ring)));

    const hours = (Array.isArray(source.hourly) ? source.hourly : [])
      .filter(row => row && Number.isInteger(row.hour) && row.hour >= 0 && row.hour < 24 && validCount(row.count))
      .slice()
      .sort((a, b) => a.hour - b.hour);
    const hourTotals = new Array(24).fill(0);
    hours.forEach(row => { hourTotals[row.hour] = row.count; });
    const maxHour = Math.max(...hourTotals, 1);
    const minHour = hours.length ? hours.reduce((best, row) => row.count < best.count ? row : best, hours[0]) : null;
    const evening = hours.filter(row => row.hour >= 18 && row.hour <= 23);
    const eveningMax = evening.length ? evening.reduce((best, row) => row.count > best.count ? row : best, evening[0]) : null;
    const eveningDip = evening.length ? evening.reduce((best, row) => row.count < best.count ? row : best, evening[0]) : null;

    const weekdayRows = (Array.isArray(source.weekdayHourly) ? source.weekdayHourly : [])
      .filter(row => row && Number.isInteger(row.weekday) && row.weekday >= 0 && row.weekday < 7 && Array.isArray(row.counts));
    const grid = Array.from({ length: 7 }, () => new Array(24).fill(0));
    let maxCell = null;
    weekdayRows.forEach(row => {
      row.counts.forEach((count, hour) => {
        if (hour > 23 || !validCount(count)) return;
        grid[row.weekday][hour] = count;
        if (!maxCell || count > maxCell.count) maxCell = { wd: row.weekday, hour, count };
      });
    });
    const cell = (wd, hour) => (grid[wd] && validCount(grid[wd][hour])) ? grid[wd][hour] : 0;
    const clockBin = count => binOf(count, 0, maxCell ? maxCell.count : 1, 1.5, CLOCK_BINS);

    // 每个「星期 × 小时」格子在覆盖期内出现了几次：逐个日历日数，首末两天按首条消息与截止小时截断。
    const firstHour = hourOf(source.coverage.firstMessageAt);
    const lastHour = hourOf(source.coverage.cutoffExclusive);
    const firstDate = daily[0].date;
    const lastDate = daily[daily.length - 1].date;
    const occ = Array.from({ length: 7 }, () => new Array(24).fill(0));
    for (let date = firstDate, guard = 0; date <= lastDate && guard < 4000; date = addDays(date, 1), guard++) {
      const wd = slotOf(date);
      for (let hour = 0; hour < 24; hour++) {
        if (date === firstDate && firstHour !== null && hour < firstHour) continue;
        if (date === lastDate && lastHour !== null && hour > lastHour) continue;
        occ[wd][hour] += 1;
      }
    }

    const topicRows = (Array.isArray(source.topics) ? source.topics : [])
      .filter(row => row && row.key && row.label && validCount(row.recentCount) && validCount(row.previousCount) && row.previousCount > 0)
      .map(row => ({
        key: String(row.key),
        label: String(row.label),
        count: validCount(row.count) ? row.count : row.recentCount,
        recentCount: row.recentCount,
        previousCount: row.previousCount,
        delta: (row.recentCount / row.previousCount - 1) * 100
      }));
    topicRows.slice().sort((a, b) => b.count - a.count).forEach((row, index) => {
      row.cat = index < CAT_COUNT - 1 ? index + 1 : CAT_COUNT;
    });
    const topics = topicRows.sort((a, b) => b.delta - a.delta);
    const risers = topics.filter(row => row.delta > 0);
    const recentTotal = topics.reduce((sum, row) => sum + row.recentCount, 0);
    const maxDelta = Math.max(...topics.map(row => Math.abs(row.delta)), 1);

    const methods = source.methodology || {};
    const recent = methods.topicRecentWindow || {};
    const previous = methods.topicPreviousWindow || {};
    const inWindow = (date, w) => w && w.start && w.end && date >= w.start && date <= w.end;
    const windowOf = date => inWindow(date, recent) ? '近 7 日' : inWindow(date, previous) ? '前 7 日' : '';
    const rate = validCount(source.coverage.topicMatchedTextMessages) && validCount(source.coverage.textMessagesAnalyzed) && source.coverage.textMessagesAnalyzed > 0
      ? (source.coverage.topicMatchedTextMessages / source.coverage.textMessagesAnalyzed * 100)
      : null;

    return {
      source,
      coverage: source.coverage,
      daily,
      byDate,
      indexOf,
      counts,
      total,
      mean,
      min,
      max,
      peak,
      rankOf,
      dayBin,
      rings,
      ringOf,
      hours,
      hourTotals,
      maxHour,
      minHour,
      eveningMax,
      eveningDip,
      cell,
      clockBin,
      maxCell,
      occ,
      topics,
      risers,
      recentTotal,
      maxDelta,
      rate,
      recent,
      previous,
      windowOf,
      cutoff: short(String(source.coverage.cutoffExclusive || '').slice(0, 10)) + ' ' + String(source.coverage.cutoffExclusive || '').slice(11, 16),
      axisStart: short(source.coverage.startDate || firstDate),
      axisEnd: short(source.coverage.endDate || lastDate),
      recentLabel: recent.start && recent.end ? short(recent.start) + '–' + short(recent.end) : '近 7 日',
      previousLabel: previous.start && previous.end ? short(previous.start) + '–' + short(previous.end) : '前 7 日',
      partial: Boolean(recent.endDayPartial)
    };
  }

  /* ---------- 外壳 ---------- */

  function segItem(mode, on) {
    return '<button type="button" role="radio" class="rings-seg-item" data-rings-tab="' + esc(mode) + '" aria-checked="' + esc(on) + '" tabindex="' + (on ? 0 : -1) + '">' +
      '<i class="rings-seg-dot" aria-hidden="true"></i>' + MODE_LABEL[mode] + '</button>';
  }

  function shell() {
    return '<header class="rings-head">' +
        '<div class="rings-head-main">' +
          '<div class="rings-title-row"><h2 class="rings-title">群的一年</h2><span class="rings-src">真实记录 · 匿名聚合</span></div>' +
          '<p class="rings-sub" data-rings-sub></p>' +
        '</div>' +
        '<div class="rings-seg" role="radiogroup" aria-label="年轮读法" data-rings-seg>' +
          '<span class="rings-seg-thumb" aria-hidden="true" data-rings-thumb></span>' +
          segItem('day', true) + segItem('clock', false) + segItem('topic', false) +
        '</div>' +
      '</header>' +
      '<div class="rings-body">' +
        '<div class="rings-stage" data-rings-stage>' +
          '<div class="rings-frame" data-rings-scroll>' +
            '<svg class="rings-viz" data-rings-viz viewBox="0 0 840 560" role="img" tabindex="0" aria-label="群的一年"></svg>' +
          '</div>' +
          '<div class="rings-tip" data-rings-tip role="tooltip" hidden></div>' +
        '</div>' +
        '<aside class="rings-side" aria-label="当前读数" data-rings-side>' +
          '<p class="rings-side-label">当前读数</p>' +
          '<p class="rings-side-kicker" data-rings-k></p>' +
          '<p class="rings-side-big"><b data-rings-n></b><span data-rings-u></span></p>' +
          '<div class="rings-meter" aria-hidden="true"><i data-rings-meter></i></div>' +
          '<dl class="rings-rows">' +
            '<div><dt data-rings-l1></dt><dd data-rings-v1></dd></div>' +
            '<div><dt data-rings-l2></dt><dd data-rings-v2></dd></div>' +
            '<div><dt data-rings-l3></dt><dd data-rings-v3></dd></div>' +
          '</dl>' +
          '<div class="rings-side-act"><button type="button" class="button small rings-reset" data-rings-reset>回到峰值</button></div>' +
          '<p class="rings-keys" data-rings-keys></p>' +
          '<p class="rings-sowhat"><span class="rings-sowhat-k">读法</span><span data-rings-sowhat></span></p>' +
          '<p class="rings-sr" data-rings-live aria-live="polite"></p>' +
        '</aside>' +
        '<div class="rings-below">' +
          '<div class="rings-legend" data-rings-legend></div>' +
          '<div class="rings-ruler" data-rings-ruler>' +
            '<div class="rings-track" data-rings-track="day">' +
              '<svg class="rings-spark" data-rings-spark viewBox="0 0 154 40" preserveAspectRatio="none" aria-hidden="true"></svg>' +
              '<input class="rings-range" data-rings-range type="range" min="0" max="0" step="1" value="0" aria-label="选择日期">' +
              '<div class="rings-months" data-rings-months aria-hidden="true"></div>' +
            '</div>' +
            '<div class="rings-track" data-rings-track="clock" hidden>' +
              '<div class="rings-cap"><span>全期 24 小时合计</span><b data-rings-hours-total></b></div>' +
              '<div class="rings-hours" data-rings-hours aria-hidden="true"></div>' +
              '<div class="rings-hours-axis" aria-hidden="true">' +
                [0, 6, 12, 18, 23].map(h => '<span style="grid-column:' + (h + 1) + '">' + hh(h) + '</span>').join('') +
              '</div>' +
            '</div>' +
            '<div class="rings-track" data-rings-track="topic" hidden>' +
              '<div class="rings-cap"><span data-rings-share-cap></span><b data-rings-share-total></b></div>' +
              '<div class="rings-share" data-rings-share aria-hidden="true"></div>' +
              '<div class="rings-topic-list" data-rings-topic-list></div>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<footer class="rings-foot" data-rings-foot></footer>';
  }

  function emptyShell(message, broken) {
    return '<div class="rings-empty' + (broken ? ' is-error' : '') + '">' +
      '<div class="rings-title-row"><h2 class="rings-title">群的一年</h2><span class="rings-src">真实记录 · 匿名聚合</span></div>' +
      '<p>' + esc(message) + '</p></div>';
  }

  /* ---------- 年轮 SVG ---------- */

  function register(key, d, x, y) {
    geo.set(key, { d, x, y });
  }

  function buildYear(layer) {
    for (let slot = 0; slot < 7; slot++) {
      const [x, y] = point(R_WD, slotAngle(slot) + 180 / 7);
      layer.appendChild(make('text', { x: x.toFixed(1), y: y.toFixed(1), class: 'rings-wd', 'data-wd': slot }, WD[slot]));
    }
    model.rings.forEach(ring => {
      const group = make('g');
      for (let slot = 0; slot < 7; slot++) {
        const a0 = slotAngle(slot) + SLOT_GAP;
        const a1 = slotAngle(slot + 1) - SLOT_GAP;
        const d = sector(ring.r0, ring.r1, a0, a1);
        const day = ring.days.find(row => slotOf(row.date) === slot);
        if (!day) {
          group.appendChild(make('path', { d, class: 'rings-gap' }));
          continue;
        }
        const key = 'day:' + day.date;
        const [x, y] = point((ring.r0 + ring.r1) / 2, (a0 + a1) / 2);
        register(key, d, x, y);
        group.appendChild(make('path', { d, class: 'rings-day', 'data-k': key, style: '--b:var(--rd' + model.dayBin(day.count) + ')' }));
      }
      layer.appendChild(group);
    });
  }

  function buildHourRings(layer, r0Base, r1Base, gap, prefix, cls) {
    const thickness = (r1Base - r0Base - gap * 6) / 7;
    for (let wd = 0; wd < 7; wd++) {
      const r0 = r0Base + wd * (thickness + gap);
      const r1 = r0 + thickness;
      for (let hour = 0; hour < 24; hour++) {
        const a0 = hourAngle(hour) + SLOT_GAP;
        const a1 = hourAngle(hour + 1) - SLOT_GAP;
        const key = prefix + wd + '-' + hour;
        const d = sector(r0, r1, a0, a1);
        const [x, y] = point((r0 + r1) / 2, (a0 + a1) / 2);
        register(key, d, x, y);
        const count = model.cell(wd, hour);
        layer.appendChild(make('path', {
          d,
          class: cls + (count ? '' : ' is-zero'),
          'data-k': key,
          style: '--b:var(' + (count ? '--rc' + model.clockBin(count) : '--rc-empty') + ')'
        }));
      }
    }
    return thickness;
  }

  function buildBand(layer) {
    buildHourRings(layer, R_B0, R_B1, BAND_GAP, 'band:', 'rings-band-cell');
    [0, 6, 12, 18].forEach(hour => {
      const [x, y] = point(R_B_LABEL, hourAngle(hour) + HOUR_STEP / 2);
      layer.appendChild(make('text', { x: x.toFixed(1), y: y.toFixed(1), class: 'rings-h is-major' }, hh(hour)));
    });
  }

  function callout(layer, angle, lines) {
    const [ax, ay] = point(R_Z_LABEL + 10, angle);
    const [ex, ey] = point(R_ELBOW, angle);
    const right = Math.cos(rad(angle)) >= 0;
    const tx = right ? ex + 14 : ex - 14;
    const group = make('g', { class: 'rings-callout-g' });
    group.appendChild(make('path', {
      d: 'M' + ax.toFixed(1) + ' ' + ay.toFixed(1) + 'L' + ex.toFixed(1) + ' ' + ey.toFixed(1) + 'L' + tx.toFixed(1) + ' ' + ey.toFixed(1),
      class: 'rings-leader'
    }));
    group.appendChild(make('circle', { cx: ax.toFixed(1), cy: ay.toFixed(1), r: 2.4, class: 'rings-leader-dot' }));
    const text = make('text', { x: (tx + (right ? 6 : -6)).toFixed(1), y: (ey - 7).toFixed(1), class: 'rings-callout', 'text-anchor': right ? 'start' : 'end' });
    text.appendChild(make('tspan', {}, lines[0]));
    text.appendChild(make('tspan', { x: (tx + (right ? 6 : -6)).toFixed(1), dy: 15, class: 'rings-callout-sub' }, lines[1]));
    group.appendChild(text);
    layer.appendChild(group);
  }

  function perVisit(wd, hour) {
    const n = model.occ[wd] ? model.occ[wd][hour] : 0;
    return n > 0 ? { n, avg: Math.round(model.cell(wd, hour) / n) } : null;
  }

  function buildClock(layer) {
    const thickness = buildHourRings(layer, R_Z0, R_Z1, ZOOM_GAP, 'clock:', 'rings-clock-cell');
    for (let wd = 0; wd < 7; wd++) {
      const [x, y] = point(R_Z0 + wd * (thickness + ZOOM_GAP) + thickness / 2, -90);
      layer.appendChild(make('text', { x: x.toFixed(1), y: y.toFixed(1), class: 'rings-zwd', 'data-wd': wd }, WD_SHORT[wd]));
    }
    for (let hour = 0; hour < 24; hour++) {
      const [x, y] = point(R_Z_LABEL, hourAngle(hour) + HOUR_STEP / 2);
      layer.appendChild(make('text', {
        x: x.toFixed(1), y: y.toFixed(1), class: 'rings-h' + (hour % 6 === 0 ? ' is-major' : ''), 'data-h': hour
      }, hh(hour)));
    }

    const notes = make('g', { class: 'rings-callouts' });
    const maxCell = model.maxCell;
    if (maxCell && maxCell.count > 0) {
      const visit = perVisit(maxCell.wd, maxCell.hour);
      callout(notes, hourAngle(maxCell.hour) + HOUR_STEP / 2, [
        WD[maxCell.wd] + ' ' + hh(maxCell.hour) + ':00 · ' + fmt(maxCell.count),
        visit ? '全年最挤 · 每次约 ' + fmt(visit.avg) + ' 条' : '全年最挤的一格'
      ]);
    }
    if (model.minHour) {
      callout(notes, hourAngle(model.minHour.hour) + HOUR_STEP / 2, [
        hh(model.minHour.hour) + ':00 · ' + fmt(model.minHour.count),
        '全年最静的一小时'
      ]);
    }
    if (model.eveningMax) {
      callout(notes, hourAngle(model.eveningMax.hour) + HOUR_STEP / 2, [
        hh(model.eveningMax.hour) + ':00 · ' + fmt(model.eveningMax.count),
        '夜间最高'
      ]);
    }
    layer.appendChild(notes);
  }

  function buildTopic(layer) {
    const count = model.topics.length;
    if (!count) return;
    const step = 360 / count;
    const half = Math.max(step / 2 - 3, 2);
    const group = (topic, extra) => make('g', {
      class: 'rings-topic' + (topic.delta >= 0 ? ' is-rise' : '') + extra,
      'data-topic': topic.key,
      style: '--c:var(--cat-' + topic.cat + ')'
    });
    const tracks = make('g');
    const bars = make('g');
    model.topics.forEach((topic, index) => {
      const mid = -90 + index * step + step / 2;
      const key = 'topic:' + topic.key;
      const back = group(topic, ' is-back');
      back.appendChild(make('path', {
        d: sector(T_BASE - T_MAX - T_PAD, T_BASE + T_MAX + T_PAD, mid - half, mid + half),
        class: 'rings-topic-track',
        'data-k': key
      }));
      tracks.appendChild(back);

      const front = group(topic, '');
      const length = Math.max(clamp(Math.abs(topic.delta) / model.maxDelta, 0, 1) * T_MAX, 3);
      const rise = topic.delta >= 0;
      const r0 = rise ? T_BASE : T_BASE - length;
      const r1 = rise ? T_BASE + length : T_BASE;
      const d = sector(r0, r1, mid - half, mid + half);
      front.appendChild(make('path', { d, class: 'rings-topic-bar' }));
      const [x, y] = point(rise ? r1 : r0, mid);
      register(key, d, x, y);

      const [lx, ly] = point(T_LABEL, mid);
      const cos = Math.cos(rad(mid));
      const label = make('text', {
        x: lx.toFixed(1),
        y: ly.toFixed(1),
        'text-anchor': cos > 0.2 ? 'start' : cos < -0.2 ? 'end' : 'middle',
        class: 'rings-topic-label',
        'data-k': key
      });
      label.appendChild(make('tspan', {}, topic.label));
      label.appendChild(make('tspan', { dx: 6, class: 'rings-topic-delta' }, pct(topic.delta)));
      front.appendChild(label);
      bars.appendChild(front);
    });
    layer.appendChild(make('circle', { cx: CX, cy: CY, r: T_BASE, class: 'rings-topic-ring', 'stroke-width': 2 * (T_MAX + T_PAD) }));
    layer.appendChild(tracks);
    layer.appendChild(make('circle', { cx: CX, cy: CY, r: T_BASE, class: 'rings-topic-base' }));
    layer.appendChild(bars);
  }

  function buildCenter(layer) {
    layer.appendChild(make('circle', { cx: CX, cy: CY, r: R_HOLE, class: 'rings-center-disc' }));
    const value = make('text', { x: CX, y: CY - 7, class: 'rings-center-value' });
    const alt = make('text', { x: CX, y: CY - 7, class: 'rings-center-value is-alt' });
    const meta = make('text', { x: CX, y: CY + 13, class: 'rings-center-meta' });
    layer.appendChild(value);
    layer.appendChild(alt);
    layer.appendChild(meta);
    return { value, alt, meta };
  }

  function buildSvg() {
    const svg = refs.svg;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    geo = new Map();
    const layer = name => make('g', { class: 'rings-layer', 'data-rings-layer': name });
    const year = layer('year');
    const band = layer('band');
    const clock = layer('clock');
    const topic = layer('topic');
    const center = make('g', { 'data-rings-center': '', 'aria-hidden': 'true' });
    const marks = make('g', { class: 'rings-marks', 'data-rings-marks': '', 'aria-hidden': 'true' });
    buildYear(year);
    buildBand(band);
    buildClock(clock);
    buildTopic(topic);
    const c = buildCenter(center);
    const hover = make('path', { class: 'rings-hover', d: 'M0 0' });
    const halo = make('path', { class: 'rings-sel-halo', d: 'M0 0' });
    const sel = make('path', { class: 'rings-sel', d: 'M0 0' });
    marks.appendChild(hover);
    marks.appendChild(halo);
    marks.appendChild(sel);
    [year, band, clock, topic].forEach(node => {
      node.setAttribute('aria-hidden', 'true');
      svg.appendChild(node);
    });
    svg.appendChild(marks);
    svg.appendChild(center);
    Object.assign(refs, { year, band, clock, topic, marks, hover, halo, sel, centerValue: c.value, centerAlt: c.alt, centerMeta: c.meta });
  }

  /* ---------- 标尺（时间轴 / 24 小时 / 主题构成） ---------- */

  function buildRuler() {
    const spark = refs.spark;
    const n = model.daily.length;
    refs.spark.setAttribute('viewBox', '0 0 ' + Math.max(n - 1, 1) + ' 40');
    model.daily.forEach((row, index) => {
      const h = Math.max(row.count / model.max * 38, 1.5);
      spark.appendChild(make('rect', {
        x: (index - 0.34).toFixed(2), y: (40 - h).toFixed(2), width: 0.68, height: h.toFixed(2),
        class: 'rings-spark-bar', 'data-i': index, style: '--b:var(--rd' + model.dayBin(row.count) + ')'
      }));
    });

    const groups = [];
    model.daily.forEach((row, index) => {
      const key = row.date.slice(0, 7);
      const last = groups[groups.length - 1];
      if (last && last.key === key) last.indexes.push(index);
      else groups.push({ key, indexes: [index] });
    });
    refs.months.textContent = '';
    groups.forEach(group => {
      const mid = group.indexes[Math.floor(group.indexes.length / 2)];
      const span = document.createElement('span');
      span.setAttribute('data-month', group.key);
      span.style.left = 'calc(var(--thumb) / 2 + (100% - var(--thumb)) * ' + (mid / Math.max(n - 1, 1)).toFixed(4) + ')';
      span.textContent = Number(group.key.slice(5)) + '月';
      refs.months.appendChild(span);
    });

    refs.hours.innerHTML = model.hourTotals.map((count, hour) =>
      '<i data-rings-hour="' + hour + '" style="--h:' + Math.max(count / model.maxHour * 100, 4).toFixed(1) + '%;--b:var(--rc' + binOf(count, 0, model.maxHour, 1.5, CLOCK_BINS) + ')"></i>'
    ).join('');
    refs.hoursTotal.textContent = fmt(model.hourTotals.reduce((sum, value) => sum + value, 0)) + ' 条';

    refs.shareCap.textContent = '近 7 日命中构成 · ' + model.recentLabel;
    refs.shareTotal.textContent = fmt(model.recentTotal) + ' 条';
    const byShare = model.topics.slice().sort((a, b) => b.recentCount - a.recentCount);
    refs.share.innerHTML = byShare.map(topic =>
      '<i data-rings-share-topic="' + esc(topic.key) + '" style="--f:' + esc(topic.recentCount) + ';--c:var(--cat-' + esc(topic.cat) + ')"></i>'
    ).join('');
    refs.topicList.innerHTML = model.topics.map(topic =>
      '<button type="button" class="rings-topic-chip" data-rings-chip="' + esc(topic.key) + '" aria-pressed="false" style="--c:var(--cat-' + esc(topic.cat) + ')">' +
        '<i aria-hidden="true"></i><span>' + esc(topic.label) + '</span><b>' + pct(topic.delta) + '</b></button>'
    ).join('');
  }

  /* ---------- 读数 ---------- */

  function numberText(spec, value) {
    if (spec.decimals) return (spec.sign && value > 0 ? '+' : '') + value.toFixed(spec.decimals) + (spec.suffix || '');
    return (spec.sign && value > 0 ? '+' : '') + fmt(Math.round(value)) + (spec.suffix || '');
  }

  function stopRoll() {
    if (rollRaf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rollRaf);
    if (rollTimer) clearTimeout(rollTimer);
    rollRaf = 0;
    rollTimer = 0;
  }

  function rollNumber(spec) {
    stopRoll();
    if (!refs || !refs.n) return;
    const finish = () => { stopRoll(); if (refs) refs.n.textContent = numberText(spec, spec.value); };
    if (reduced() || typeof requestAnimationFrame !== 'function' || !Number.isFinite(spec.value) || spec.value === 0) { finish(); return; }
    const dur = parseFloat(getComputedStyle(root).getPropertyValue('--motion-stage')) || 480;
    let start = 0;
    const step = time => {
      if (!refs) return;
      if (!start) start = time;
      const p = Math.min(1, (time - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      refs.n.textContent = numberText(spec, spec.value * eased);
      if (p < 1) rollRaf = requestAnimationFrame(step);
      else finish();
    };
    refs.n.textContent = numberText(spec, 0);
    rollRaf = requestAnimationFrame(step);
    rollTimer = setTimeout(finish, dur + 160);
  }

  function setReadout(kicker, spec, unit, rows, meter) {
    stopRoll();
    refs.k.textContent = kicker;
    refs.n.textContent = numberText(spec, spec.value);
    refs.spec = spec;
    refs.u.textContent = unit;
    rows.forEach((row, index) => {
      refs['l' + (index + 1)].textContent = row[0];
      refs['v' + (index + 1)].textContent = row[1];
    });
    refs.meter.style.setProperty('--p', clamp(meter.p, 0, 1).toFixed(4));
    refs.meter.style.setProperty('--m', meter.color);
  }

  // alt：窄屏放不下长标签时用的短文本（主题视图在手机上显示涨跌幅）
  function setCenter(value, meta, alt) {
    refs.centerValue.textContent = value;
    refs.centerValue.classList.toggle('is-long', String(value).length > 5);
    refs.centerAlt.textContent = alt || value;
    refs.centerMeta.textContent = meta;
  }

  function setResetLabel() {
    const isDefault = view === 'day'
      ? selectedDay === model.peak.date
      : view === 'clock'
        ? selectedClock === defaultClock
        : selectedTopic === defaultTopic;
    refs.reset.disabled = isDefault;
    refs.reset.textContent = view === 'day' ? '回到峰值' : view === 'clock' ? '回到最挤' : '回到最大变化';
  }

  function toggleAll(selector, test) {
    root.querySelectorAll(selector).forEach(node => node.classList.toggle('is-on', test(node)));
  }

  /* ---------- 选中标记 ---------- */

  function moveSelection(key) {
    const shape = geo.get(key);
    if (!shape || !refs.sel) return;
    const prev = refs.selKey ? geo.get(refs.selKey) : null;
    const far = !prev || Math.hypot(prev.x - shape.x, prev.y - shape.y) > 44 || refs.selView !== view;
    if (far) refs.marks.setAttribute('data-snap', '');
    refs.sel.setAttribute('d', shape.d);
    refs.halo.setAttribute('d', shape.d);
    if (far) {
      void refs.marks.getBoundingClientRect();
      refs.marks.removeAttribute('data-snap');
    }
    refs.selKey = key;
    refs.selView = view;
  }

  function setHover(key) {
    if (!refs || !refs.hover) return;
    hoverKey = key || '';
    const shape = key ? geo.get(key) : null;
    if (!shape) {
      refs.hover.removeAttribute('data-show');
      refs.hover.removeAttribute('data-press');
      return;
    }
    refs.hover.setAttribute('d', shape.d);
    refs.hover.style.transformOrigin = shape.x.toFixed(1) + 'px ' + shape.y.toFixed(1) + 'px';
    refs.hover.setAttribute('data-show', '');
  }

  /* ---------- 选择 ---------- */

  function selectDay(date, announce) {
    const row = model.byDate.get(date);
    if (!row) return;
    selectedDay = date;
    const index = model.indexOf.get(date);
    const ring = model.ringOf.get(date);
    const rank = model.rankOf(row.count);
    const slot = slotOf(date);
    refs.range.value = String(index);
    refs.range.setAttribute('aria-valuetext', short(date) + ' ' + dayName(date) + '，' + fmt(row.count) + ' 条，第 ' + rank + ' 天');
    setReadout(
      short(date) + ' · ' + dayName(date),
      { value: row.count },
      '条',
      [
        ['位次', '第 ' + rank + ' / ' + model.daily.length + ' 天'],
        ['对日均', (row.count / Math.max(model.mean, 1)).toFixed(1) + ' 倍'],
        ['所在周', ring ? short(ring.first) + '–' + short(ring.last) : '—']
      ],
      { p: row.count / model.max, color: 'var(--rd5)' }
    );
    setCenter(short(date), dayName(date) + ' · 第 ' + (ring ? ring.index + 1 : '—') + ' 圈');
    toggleAll('.rings-wd', node => Number(node.getAttribute('data-wd')) === slot);
    toggleAll('.rings-spark-bar', node => Number(node.getAttribute('data-i')) === index);
    toggleAll('.rings-months span', node => node.getAttribute('data-month') === date.slice(0, 7));
    if (view === 'day') moveSelection('day:' + date);
    setResetLabel();
    if (announce) refs.live.textContent = short(date) + ' ' + dayName(date) + '，' + fmt(row.count) + ' 条，第 ' + rank + ' 天。';
  }

  function selectClock(key, announce) {
    const parts = String(key).split('-').map(Number);
    const wd = parts[0];
    const hour = parts[1];
    if (!Number.isInteger(wd) || wd < 0 || wd > 6 || !Number.isInteger(hour) || hour < 0 || hour > 23) return;
    selectedClock = wd + '-' + hour;
    const count = model.cell(wd, hour);
    const isMax = Boolean(model.maxCell && model.maxCell.wd === wd && model.maxCell.hour === hour);
    const visit = perVisit(wd, hour);
    setReadout(
      WD[wd] + ' ' + hh(hour) + ':00',
      { value: count },
      '条累计',
      [
        ['出现', visit ? visit.n + ' 个' + WD[wd] : '—'],
        ['每次约', visit ? fmt(visit.avg) + ' 条' : '—'],
        ['对照', isMax ? '全年最挤的一格' : '最挤 ' + (model.maxCell ? WD[model.maxCell.wd] + ' ' + hh(model.maxCell.hour) + ':00' : '—')]
      ],
      { p: model.maxCell ? count / model.maxCell.count : 0, color: 'var(--rc5)' }
    );
    setCenter(hh(hour) + ':00', WD[wd]);
    toggleAll('.rings-zwd', node => Number(node.getAttribute('data-wd')) === wd);
    toggleAll('.rings-h[data-h]', node => Number(node.getAttribute('data-h')) === hour);
    toggleAll('[data-rings-hour]', node => Number(node.getAttribute('data-rings-hour')) === hour);
    if (view === 'clock') moveSelection('clock:' + selectedClock);
    setResetLabel();
    if (announce) refs.live.textContent = WD[wd] + ' ' + hour + ' 点，累计 ' + fmt(count) + ' 条' + (visit ? '，约每次 ' + fmt(visit.avg) + ' 条' : '') + '。';
  }

  function selectTopic(key, announce) {
    const topic = model.topics.find(item => item.key === key) || model.topics[0];
    if (!topic) return;
    selectedTopic = topic.key;
    refs.topic.classList.add('has-sel');
    refs.share.classList.add('has-sel');
    toggleAll('.rings-topic', node => node.getAttribute('data-topic') === topic.key);
    toggleAll('[data-rings-share-topic]', node => node.getAttribute('data-rings-share-topic') === topic.key);
    root.querySelectorAll('[data-rings-chip]').forEach(node => node.setAttribute('aria-pressed', String(node.getAttribute('data-rings-chip') === topic.key)));
    const share = model.recentTotal ? topic.recentCount / model.recentTotal * 100 : 0;
    setReadout(
      topic.label,
      { value: topic.delta, decimals: 1, sign: true, suffix: '%' },
      '近 7 日对前 7 日',
      [
        ['近 7 日', fmt(topic.recentCount) + ' 条命中'],
        ['前 7 日', fmt(topic.previousCount) + ' 条命中'],
        ['占近 7 日', share.toFixed(1) + '%']
      ],
      { p: Math.abs(topic.delta) / model.maxDelta, color: 'var(--cat-' + topic.cat + ')' }
    );
    setCenter(topic.label, model.risers.length + ' / ' + model.topics.length + ' 在涨', pct(topic.delta));
    if (view === 'topic') moveSelection('topic:' + topic.key);
    setResetLabel();
    if (announce) refs.live.textContent = topic.label + '，近 7 日 ' + topic.recentCount + ' 条，前 7 日 ' + topic.previousCount + ' 条，变化 ' + pct(topic.delta) + '。';
  }

  /* ---------- 文案 ---------- */

  function sowhat(mode) {
    if (mode === 'day') return '想被回应，挑圈厚、颜色深的那几天开口；浅的日子，消息本来就少。';
    if (mode === 'clock') {
      const peakHour = model.maxCell ? model.maxCell.hour : 11;
      const dipHour = model.eveningDip ? model.eveningDip.hour : 20;
      return peakHour + ' 点发，撞上全年最挤的一格；' + dipHour + ' 点发，正好落在最安静的时段。';
    }
    if (!model.topics.length) return '主题统计未载入。';
    if (model.risers.length === 1) return '最近 7 天只剩「' + model.risers[0].label + '」在涨；其余 ' + (model.topics.length - 1) + ' 个主题在退。';
    if (model.risers.length > 1) return '最近 7 天有 ' + model.risers.length + ' 个主题在涨，最大的是「' + model.risers[0].label + '」；其余在退。';
    return '最近 7 天没有主题在涨；写完的东西要自己去找读者。';
  }

  function ariaFor(mode) {
    if (mode === 'day') return '群的年轮：' + model.daily.length + ' 天按自然周长成 ' + model.rings.length + ' 圈；蓝色越深当天消息越多；外环是 7×24 群钟。方向键逐日查看，上下键跨周，1、2、3 切换视图。';
    if (mode === 'clock') return '群钟：7 天 × 24 小时的累计消息量，青色越深越挤；内圈周一，外圈周日。左右键换小时，上下键换星期。';
    return '主题环：' + model.topics.length + ' 个主题近 7 日对前 7 日的变化，向外为上涨、向内为下降。方向键换主题。';
  }

  function ramp(prefix, bins) {
    let html = '';
    for (let b = 0; b < bins; b++) html += '<i class="rings-sw" style="--b:var(' + esc(prefix) + b + ')"></i>';
    return html;
  }

  function legend(mode) {
    if (mode === 'day') {
      return '<span class="rings-scale"><i class="rings-sw" style="--b:var(--rd-empty)"></i>空日</span>' +
        '<span class="rings-scale"><b>' + esc(fmt(model.min)) + '</b><span class="rings-ramp">' + ramp('--rd', DAY_BINS) + '</span><b>' + esc(fmt(model.max)) + '</b> 条/天</span>' +
        '<span class="rings-legend-note">圆心 ' + esc(model.axisStart) + ' → 外圈 ' + esc(model.axisEnd) + ' · 圈越厚那周越忙 · 外环 = 群钟</span>';
    }
    if (mode === 'clock') {
      return '<span class="rings-scale"><b>0</b><span class="rings-ramp">' + ramp('--rc', CLOCK_BINS) + '</span><b>' + esc(fmt(model.maxCell ? model.maxCell.count : 0)) + '</b> 条/格</span>' +
        '<span class="rings-legend-note">内圈周一 → 外圈周日 · 每格 1 小时累计</span>';
    }
    return '<span class="rings-scale"><i class="rings-sw is-base" aria-hidden="true"></i>基线 = 前 7 日</span>' +
      '<span class="rings-scale"><i class="rings-dir" aria-hidden="true">↑</i>向外 = 上涨<i class="rings-dir" aria-hidden="true">↓</i>向内 = 下降</span>' +
      '<span class="rings-legend-note">颜色只区分主题 · 命中最少的 ' + Math.max(model.topics.length - (CAT_COUNT - 1), 0) + ' 个共用灰</span>';
  }

  function keys(mode) {
    const k = s => '<kbd>' + esc(s) + '</kbd>';
    if (mode === 'day') return k('←') + k('→') + ' 逐日 ' + k('↑') + k('↓') + ' 跨周 ' + k('1') + k('2') + k('3') + ' 换视图';
    if (mode === 'clock') return k('←') + k('→') + ' 换小时 ' + k('↑') + k('↓') + ' 换星期 ' + k('Esc') + ' 回到最挤';
    return k('←') + k('→') + ' 换主题 ' + k('Esc') + ' 回到最大变化';
  }

  /* ---------- 浮层提示 ---------- */

  function tipHtml(key) {
    const [kind, id] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
    if (kind === 'day') {
      const row = model.byDate.get(id);
      if (!row) return '';
      const win = model.windowOf(id);
      return '<p class="rings-tip-t"><i class="rings-tip-sw" style="--b:var(--rd' + esc(model.dayBin(row.count)) + ')"></i>' + esc(short(id)) + ' ' + dayName(id) + '</p>' +
        '<p class="rings-tip-n"><b>' + esc(fmt(row.count)) + '</b> 条 · 第 ' + esc(model.rankOf(row.count)) + ' / ' + model.daily.length + ' 天</p>' +
        (win ? '<p class="rings-tip-m">主题统计窗口 · ' + esc(win) + '</p>' : '');
    }
    if (kind === 'clock' || kind === 'band') {
      const parts = id.split('-').map(Number);
      const count = model.cell(parts[0], parts[1]);
      const visit = perVisit(parts[0], parts[1]);
      return '<p class="rings-tip-t"><i class="rings-tip-sw" style="--b:var(' + esc((count ? '--rc' + model.clockBin(count) : '--rc-empty')) + ')"></i>' + WD[parts[0]] + ' ' + esc(hh(parts[1])) + ':00</p>' +
        '<p class="rings-tip-n">累计 <b>' + esc(fmt(count)) + '</b> 条</p>' +
        (visit ? '<p class="rings-tip-m">' + esc(visit.n) + ' 个' + WD[parts[0]] + ' · 每次约 ' + esc(fmt(visit.avg)) + ' 条</p>' : '');
    }
    if (kind === 'topic') {
      const topic = model.topics.find(item => item.key === id);
      if (!topic) return '';
      return '<p class="rings-tip-t"><i class="rings-tip-sw" style="--b:var(--cat-' + esc(topic.cat) + ')"></i>' + esc(topic.label) + '</p>' +
        '<p class="rings-tip-n"><b>' + pct(topic.delta) + '</b> · ' + esc(fmt(topic.recentCount)) + ' ← ' + esc(fmt(topic.previousCount)) + ' 条</p>' +
        '<p class="rings-tip-m">主题 · 近 7 日对前 7 日</p>';
    }
    return '';
  }

  function hideTip() {
    tipKey = '';
    if (refs && refs.tip) {
      refs.tip.removeAttribute('data-show');
      refs.tip.hidden = true;
      refs.tip.textContent = '';
    }
  }

  function showTip(key) {
    const shape = geo.get(key);
    const html = shape ? tipHtml(key) : '';
    if (!html) { hideTip(); return; }
    const ctm = refs.svg.getScreenCTM();
    if (!ctm) { hideTip(); return; }
    const stage = refs.stage.getBoundingClientRect();
    const x = ctm.a * shape.x + ctm.c * shape.y + ctm.e - stage.left;
    const y = ctm.b * shape.x + ctm.d * shape.y + ctm.f - stage.top;
    const fresh = refs.tip.hidden;
    if (tipKey !== key) refs.tip.innerHTML = html;
    tipKey = key;
    refs.tip.hidden = false;
    const box = refs.tip.getBoundingClientRect();
    const half = box.width / 2;
    const left = clamp(x, half + 8, Math.max(half + 8, stage.width - half - 8));
    const below = y - box.height - 14 < 4;
    refs.tip.style.left = left.toFixed(1) + 'px';
    refs.tip.style.top = y.toFixed(1) + 'px';
    refs.tip.setAttribute('data-side', below ? 'bottom' : 'top');
    if (fresh) {
      refs.tip.removeAttribute('data-show');
      void refs.tip.offsetWidth;
    }
    refs.tip.setAttribute('data-show', '');
  }

  /* ---------- 视图切换 ---------- */

  function placeThumb(snap) {
    raf = 0;
    if (!refs || !refs.seg) return;
    const item = refs.seg.querySelector('[aria-checked="true"]');
    if (!item) return;
    const g = refs.seg.getBoundingClientRect();
    const b = item.getBoundingClientRect();
    if (!g.width) return;
    if (snap) refs.seg.removeAttribute('data-ready');
    refs.thumb.style.setProperty('--x', (b.left - g.left).toFixed(1) + 'px');
    refs.thumb.style.setProperty('--w', b.width.toFixed(1) + 'px');
    if (snap) {
      void refs.thumb.offsetWidth;
      refs.seg.setAttribute('data-ready', '');
    }
  }

  function scheduleThumb() {
    if (raf) return;
    if (typeof requestAnimationFrame === 'function') raf = requestAnimationFrame(() => placeThumb(true));
    else placeThumb(true);
  }

  function replay(node) {
    if (!node) return;
    node.removeAttribute('data-enter');
    void node.getBoundingClientRect();
    node.setAttribute('data-enter', '');
  }

  function setMode(mode, options) {
    if (!MODES.includes(mode)) return;
    const opts = options || {};
    const changed = mode !== view || opts.initial;
    view = mode;
    root.setAttribute('data-rings-view', mode);
    root.querySelectorAll('[data-rings-tab]').forEach(button => {
      const on = button.getAttribute('data-rings-tab') === mode;
      button.setAttribute('aria-checked', String(on));
      button.tabIndex = on ? 0 : -1;
    });
    placeThumb(Boolean(opts.initial));
    refs.svg.setAttribute('aria-label', ariaFor(mode));
    refs.legend.innerHTML = legend(mode);
    refs.sowhat.textContent = sowhat(mode);
    refs.keys.innerHTML = keys(mode);
    root.querySelectorAll('[data-rings-track]').forEach(node => {
      node.hidden = node.getAttribute('data-rings-track') !== mode;
    });
    hideTip();
    setHover('');
    if (mode === 'topic' && !model.topics.length) {
      setReadout('主题', { value: NaN }, '', [['近 7 日', '—'], ['前 7 日', '—'], ['占近 7 日', '—']], { p: 0, color: 'var(--line)' });
      refs.n.textContent = '—';
      setCenter('—', '主题未载入');
      refs.reset.disabled = true;
      return;
    }
    if (mode === 'day') selectDay(opts.day || selectedDay || model.peak.date, false);
    if (mode === 'clock') selectClock(opts.clock || selectedClock || defaultClock, false);
    if (mode === 'topic') selectTopic(opts.topic || selectedTopic || defaultTopic, false);
    if (changed && !opts.initial) {
      replay(refs.marks);
      replay(refs.side);
      replay(root.querySelector('[data-rings-track="' + mode + '"]'));
      replay(refs.legend);
      if (refs.spec) rollNumber(refs.spec);
    }
  }

  function resetSelection() {
    if (view === 'day') selectDay(model.peak.date, true);
    else if (view === 'clock') selectClock(defaultClock, true);
    else if (defaultTopic) selectTopic(defaultTopic, true);
  }

  function currentKey() {
    if (view === 'day') return 'day:' + selectedDay;
    if (view === 'clock') return 'clock:' + selectedClock;
    return 'topic:' + selectedTopic;
  }

  /* ---------- 事件 ---------- */

  function activate(key, showAfter) {
    const kind = key.slice(0, key.indexOf(':'));
    const id = key.slice(key.indexOf(':') + 1);
    if (kind === 'day') {
      if (view !== 'day') setMode('day', { day: id });
      selectDay(id, true);
    } else if (kind === 'clock' || kind === 'band') {
      if (view !== 'clock') setMode('clock', { clock: id });
      selectClock(id, true);
    } else if (kind === 'topic') {
      if (view !== 'topic') setMode('topic', { topic: id });
      selectTopic(id, true);
    }
    if (showAfter) showTip(currentKey());
  }

  function onClick(event) {
    const target = event.target;
    if (!target || !target.closest) return;
    const tab = target.closest('[data-rings-tab]');
    if (tab) {
      setMode(tab.getAttribute('data-rings-tab'));
      return;
    }
    if (target.closest('[data-rings-reset]')) {
      resetSelection();
      return;
    }
    const hour = target.closest('[data-rings-hour]');
    if (hour) {
      const wd = Number(String(selectedClock || defaultClock).split('-')[0]) || 0;
      selectClock(wd + '-' + hour.getAttribute('data-rings-hour'), true);
      return;
    }
    const share = target.closest('[data-rings-share-topic]');
    if (share) {
      selectTopic(share.getAttribute('data-rings-share-topic'), true);
      return;
    }
    const chip = target.closest('[data-rings-chip]');
    if (chip) {
      selectTopic(chip.getAttribute('data-rings-chip'), true);
      return;
    }
    const mark = target.closest('[data-k]');
    if (mark) activate(mark.getAttribute('data-k'), event.pointerType === 'touch' || event.pointerType === 'pen');
  }

  function onPointerMove(event) {
    const mark = event.target && event.target.closest && event.target.closest('[data-k]');
    if (!mark) {
      if (hoverKey) { setHover(''); hideTip(); }
      return;
    }
    if (event.pointerType === 'touch') return;
    const key = mark.getAttribute('data-k');
    if (key === hoverKey) return;
    setHover(key);
    showTip(key);
  }

  function onPointerDown(event) {
    const mark = event.target && event.target.closest && event.target.closest('[data-k]');
    if (!mark || !refs.hover) return;
    if (mark.getAttribute('data-k') !== hoverKey) setHover(mark.getAttribute('data-k'));
    refs.hover.setAttribute('data-press', '');
  }

  function onPointerUp() {
    if (refs && refs.hover) refs.hover.removeAttribute('data-press');
  }

  function onPointerLeave() {
    setHover('');
    hideTip();
  }

  function onInput(event) {
    if (!event.target.matches || !event.target.matches('[data-rings-range]')) return;
    const row = model.daily[Number(event.target.value)];
    if (!row) return;
    if (view !== 'day') setMode('day');
    selectDay(row.date, true);
  }

  function onSegKey(event) {
    const item = event.target.closest && event.target.closest('[data-rings-tab]');
    if (!item) return;
    const dir = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (!dir && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    const index = MODES.indexOf(item.getAttribute('data-rings-tab'));
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? MODES.length - 1 : (index + dir + MODES.length) % MODES.length;
    setMode(MODES[next]);
    const button = refs.seg.querySelector('[data-rings-tab="' + MODES[next] + '"]');
    if (button) button.focus();
  }

  function onKey(event) {
    if (event.key === '1' || event.key === '2' || event.key === '3') {
      setMode(MODES[Number(event.key) - 1]);
      event.preventDefault();
      return;
    }
    if (event.key === 'Escape') {
      resetSelection();
      showTip(currentKey());
      event.preventDefault();
      return;
    }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    if (view === 'day') {
      let index = model.indexOf.get(selectedDay) || 0;
      if (event.key === 'Home') index = 0;
      else if (event.key === 'End') index = model.daily.length - 1;
      else {
        const step = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' ? -7 : 7;
        index = clamp(index + step, 0, model.daily.length - 1);
      }
      selectDay(model.daily[index].date, true);
    } else if (view === 'clock') {
      const parts = selectedClock.split('-').map(Number);
      let wd = parts[0];
      let hour = parts[1];
      if (event.key === 'Home') hour = 0;
      else if (event.key === 'End') hour = 23;
      else if (event.key === 'ArrowLeft') hour = (hour + 23) % 24;
      else if (event.key === 'ArrowRight') hour = (hour + 1) % 24;
      else if (event.key === 'ArrowUp') wd = (wd + 6) % 7;
      else if (event.key === 'ArrowDown') wd = (wd + 1) % 7;
      selectClock(wd + '-' + hour, true);
    } else {
      if (!model.topics.length) return;
      let index = model.topics.findIndex(row => row.key === selectedTopic);
      if (event.key === 'Home') index = 0;
      else if (event.key === 'End') index = model.topics.length - 1;
      else index = clamp(index + (event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1), 0, model.topics.length - 1);
      selectTopic(model.topics[index].key, true);
    }
    showTip(currentKey());
  }

  function onResize() {
    scheduleThumb();
    hideTip();
  }

  /* ---------- 生命周期 ---------- */

  function mount(target) {
    const element = typeof target === 'string' ? document.querySelector(target) : target;
    if (!element || !element.appendChild) return null;
    destroy();
    host = element;
    let broken = false;
    try {
      model = buildModel();
    } catch (error) {
      model = null;
      broken = true;
    }
    root = document.createElement('section');
    root.className = 'rings-module';
    root.setAttribute('data-rings-view', 'day');
    root.setAttribute('aria-label', '群的一年');
    root.innerHTML = model ? shell() : emptyShell(broken ? '年轮读取失败；原始统计没有改动，群记录的其他部分照常可用。刷新页面可以重试。' : '记录统计未载入，暂时不能显示年轮。接入匿名聚合数据后会在这里长出来。', broken);
    if (!model) root.setAttribute('data-rings-state', broken ? 'error' : 'empty');
    host.appendChild(root);
    if (!model) return root;

    const q = selector => root.querySelector(selector);
    refs = {
      svg: q('[data-rings-viz]'),
      stage: q('[data-rings-stage]'),
      scroll: q('[data-rings-scroll]'),
      tip: q('[data-rings-tip]'),
      seg: q('[data-rings-seg]'),
      thumb: q('[data-rings-thumb]'),
      sub: q('[data-rings-sub]'),
      side: q('[data-rings-side]'),
      legend: q('[data-rings-legend]'),
      range: q('[data-rings-range]'),
      spark: q('[data-rings-spark]'),
      months: q('[data-rings-months]'),
      hours: q('[data-rings-hours]'),
      hoursTotal: q('[data-rings-hours-total]'),
      share: q('[data-rings-share]'),
      shareCap: q('[data-rings-share-cap]'),
      shareTotal: q('[data-rings-share-total]'),
      topicList: q('[data-rings-topic-list]'),
      sowhat: q('[data-rings-sowhat]'),
      keys: q('[data-rings-keys]'),
      foot: q('[data-rings-foot]'),
      reset: q('[data-rings-reset]'),
      live: q('[data-rings-live]'),
      k: q('[data-rings-k]'),
      n: q('[data-rings-n]'),
      u: q('[data-rings-u]'),
      meter: q('[data-rings-meter]'),
      l1: q('[data-rings-l1]'),
      v1: q('[data-rings-v1]'),
      l2: q('[data-rings-l2]'),
      v2: q('[data-rings-v2]'),
      l3: q('[data-rings-l3]'),
      v3: q('[data-rings-v3]')
    };
    if (!refs.svg || !refs.range || !refs.months || !refs.stage || !refs.seg) {
      destroy();
      return null;
    }
    refs.sub.textContent = model.daily.length + ' 天，' + fmt(model.total) + ' 条消息；每周长一圈，每天一格。';
    refs.foot.innerHTML = ['截至 ' + esc(model.cutoff), model.partial ? '最近 7 日末日未满' : '', model.rate === null ? '' : '主题覆盖 ' + model.rate.toFixed(1) + '%', '群之间无交叉表']
      .filter(Boolean).map(text => '<span>' + esc(text) + '</span>').join('');
    refs.range.max = String(model.daily.length - 1);
    buildSvg();
    buildRuler();

    selectedDay = model.peak.date;
    defaultClock = model.maxCell ? model.maxCell.wd + '-' + model.maxCell.hour : '0-0';
    defaultTopic = model.topics.length ? model.topics[0].key : '';
    selectedClock = defaultClock;
    selectedTopic = defaultTopic;

    listen(root, 'click', onClick);
    listen(refs.stage, 'pointermove', onPointerMove);
    listen(refs.stage, 'pointerleave', onPointerLeave);
    listen(refs.stage, 'pointerdown', onPointerDown);
    listen(window, 'pointerup', onPointerUp);
    listen(window, 'pointercancel', onPointerUp);
    listen(refs.svg, 'keydown', onKey);
    listen(refs.svg, 'blur', hideTip);
    listen(refs.seg, 'keydown', onSegKey);
    listen(root, 'input', onInput);
    listen(window, 'resize', onResize);

    setMode('day', { day: model.peak.date, initial: true });
    scheduleThumb();

    if (typeof IntersectionObserver === 'function') {
      observer = new IntersectionObserver(entries => {
        if (rolled || !entries.some(entry => entry.isIntersecting)) return;
        rolled = true;
        if (refs && refs.spec) rollNumber(refs.spec);
        if (observer) { observer.disconnect(); observer = null; }
      }, { threshold: 0.35 });
      observer.observe(refs.side);
    }
    return root;
  }

  function destroy() {
    if (raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
    raf = 0;
    stopRoll();
    if (observer) observer.disconnect();
    observer = null;
    rolled = false;
    listeners.forEach(([target, type, fn]) => target.removeEventListener(type, fn));
    listeners = [];
    if (root && root.parentNode) root.parentNode.removeChild(root);
    root = null;
    host = null;
    model = null;
    refs = null;
    view = 'day';
    selectedDay = '';
    selectedClock = '';
    selectedTopic = '';
    defaultClock = '';
    defaultTopic = '';
    geo = new Map();
    hoverKey = '';
    tipKey = '';
  }

  window.CommonsRings = { render: mount, destroy };
}());
