(() => {
  'use strict';

  /* R13 GROW-FE / IA-1 · 成长合并页与赛季榜。
     导出 window.CommonsGrowth；旧成长路由在同一页按分区落位。 */

  const LEVELS = [
    { level: 1, name: '新队员', how: '用邀请码注册', note: '', unlocks: ['read', 'discuss', 'favorite', 'report', 'listen'] },
    { level: 2, name: '队员', how: '账号满 7 天、活跃 5 天、收到 3 次合格的「有用」', note: '', unlocks: ['knowledge', 'upload', 'hand', 'invite'] },
    { level: 3, name: '骨干', how: '近 60 天过半活跃、内容被采纳 5 次、举报准确率 ≥ 60%（至少 10 次）', note: '', unlocks: ['room', 'suggest', 'hide', 'volunteer'] },
    { level: 4, name: '领航员', how: '自动达标后由治理员复核', note: '达标后由治理员复核', unlocks: ['stage', 'curate', 'host'] },
    { level: 5, name: '先锋', how: '只能由治理委员会授予', note: '由治理委员会授予', unlocks: ['vote', 'appeal'] }
  ];

  const ACTIONS = {
    read: { label: '读成员可见内容', icon: 'source' },
    discuss: { label: '发讨论和回复', icon: 'discussion' },
    favorite: { label: '收藏', icon: 'favorite' },
    report: { label: '举报（权重低）', icon: 'reminder' },
    listen: { label: '进公开房间收听', icon: 'connection' },
    knowledge: { label: '建知识条目', icon: 'organized' },
    upload: { label: '上传附件和 HTML 作品', icon: 'milestone' },
    hand: { label: '房间里举手', icon: 'help' },
    invite: { label: '邀请（每月 2 个）', icon: 'newcomer' },
    room: { label: '建讨论室（≤ 20 人）', icon: 'discussion' },
    suggest: { label: '对知识提修改建议', icon: 'follow-up' },
    hide: { label: '隐藏 L1 内容（需第二位 L3+ 同意）', icon: 'blocked' },
    volunteer: { label: '接治理志愿队列', icon: 'tool' },
    stage: { label: '建舞台房', icon: 'milestone' },
    curate: { label: '整理知识（合并、标过期）', icon: 'distilled' },
    host: { label: '主持活动', icon: 'trending' },
    vote: { label: '规则修订投票', icon: 'consensus' },
    appeal: { label: '复核申诉', icon: 'verified' }
  };

  const EVENTS = {
    adopted: { label: '知识被采纳或验证', points: '+20', anti: '确认人随机分派，L3+，有利益关系要回避；每赛季每对人只计一次' },
    useful: { label: '回答被标「有用」', points: '+5', anti: '只算 L2+、账号满 7 天、不在你邀请树里的人给的；每天有上限；互相标记打折；标记人等级权重最高 1.5 倍' },
    reproduced: { label: '作品被别人复现', points: '+30', anti: '复现者要提交自己的产物，由第三人确认；每赛季每对人一次' },
    host: { label: '主持房间', points: '+15', anti: '≥ 5 位 L2+ 参与且在场 ≥ 10 分钟；每天最多 2 次' },
    curate: { label: '整理被确认', points: '+10', anti: '合并、补证据、标过期；确认规则同采纳' },
    report: { label: '举报成立', points: '+3', anti: '举报不成立只降权重，不扣分' },
    violation: { label: '违规成立', points: '−50', anti: '治理员确认，可申诉' }
  };

  const FAQ = [
    ['等级会掉吗？', '会。违规成立会降级，过了冷却期可以再升。等级不卖、不能用会员买回来。'],
    ['为什么我的「有用」没算分？', '只算 L2+、账号满 7 天、又不在你邀请树里的人给的。互相标记会打折。点开流水能看到这一笔为什么是这个数。'],
    ['Token 榜为什么是灰的？', 'A 档（平台网关自动计量）还没上。现在全是自报，一律灰标，只展示、不评奖。'],
    ['能不能退出排名？', '能。赛季榜上有「退出赛季榜」。退出后自己那一行还在，但只有你看得到。'],
    ['谁能看到我的贡献明细？', '内测头几周只给本人看。公开排名默认关。管理员和治理员不上榜，也不用明细换管理权。'],
    ['会员能买分或买等级吗？', '不能。会员只给服务：配额、皮肤、席位、先试。不改等级，不给管理权，不能买分。']
  ];

  const ALT_CRITERIA = [
    { key: 'useful-in', label: '收到合格的「有用」', have: 2, need: 3, unit: '次' },
    { key: 'adopted', label: '内容被采纳', have: 2, need: 5, unit: '次' }
  ];

  const BANDS = ['不足 100 万', '100 万–1000 万', '1000 万–5000 万', '5000 万–1 亿', '1–5 亿'];
  const FAMILIES = ['Claude', 'GPT', 'Gemini', '本地开源', '其他'];
  const TABS = [
    ['contribution', '贡献榜'],
    ['spend', 'Token 消耗'],
    ['ratio', 'Token 产出比']
  ];

  const nf = typeof Intl === 'object' && Intl.NumberFormat ? new Intl.NumberFormat('zh-CN') : null;

  const state = {
    root: null,
    page: 'growth',
    anchor: 'growth',
    anchorTimer: null,
    tab: 'contribution',
    openLedger: '',
    unbind: [],
    live: null,
    liveError: '',
    liveLoading: false,
    liveRequest: 0,
    account: '',
    consentBusy: false
  };

  function isLive() {
    return !!(window.CommonsAPI && window.CommonsAPI.mode === 'live');
  }

  function sessionAccount() {
    const me = window.CommonsSession && window.CommonsSession.me;
    return me ? String(me.id || me.handle || '') : '';
  }

  function resetLiveAccount() {
    state.liveRequest += 1;
    state.live = null;
    state.liveError = '';
    state.liveLoading = false;
    state.consentBusy = false;
    state.optoutBusy = false;
    state.reportBusy = false;
  }

  function onSessionChange() {
    const next = sessionAccount();
    if (next === state.account) return;
    state.account = next;
    resetLiveAccount();
    if (isLive() && state.root) loadLive();
  }

  function applyConsent(value) {
    if (!state.live) return;
    if (!state.live.me) state.live.me = {};
    state.live.me.consentMetering = !!value;
  }

  function emitConsent(value) {
    window.dispatchEvent(new CustomEvent('commons:consent-metering', { detail: { consent: !!value } }));
  }

  function onConsentMetering(event) {
    if (!isLive() || state.consentBusy || !state.live) return;
    const value = !!(event && event.detail && event.detail.consent);
    if (state.live.me && state.live.me.consentMetering === value) return;
    applyConsent(value);
    if (state.root) paint();
  }

  window.addEventListener('commons:session', onSessionChange);
  window.addEventListener('commons:consent-metering', onConsentMetering);

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function reduceMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function sample() {
    if (isLive()) return state.live || { me: {}, board: { contribution: [] }, tokens: [] };
    return window.COMMONS_GROWTH_SAMPLE || { me: {}, board: { contribution: [] }, tokens: [] };
  }

  function pref(key, fallback) {
    const api = window.Commons;
    if (api && typeof api.read === 'function') {
      const v = api.read('growth.' + key, fallback);
      return v === undefined || v === null ? fallback : v;
    }
    return fallback;
  }

  function setPref(key, value) {
    const api = window.Commons;
    if (api && typeof api.write === 'function') api.write('growth.' + key, value);
  }

  function toast(message) {
    if (window.Commons && typeof window.Commons.toast === 'function') window.Commons.toast(message);
  }

  function icon(name, size) {
    const lib = window.CommonsIcons;
    if (lib && typeof lib.svg === 'function') return lib.svg(name, { size: size || 16 });
    return '';
  }

  function glyph(kind) {
    const d = {
      chev: 'M6 9l6 6 6-6',
      up: 'M12 19V5m0 0-5 5m5-5 5 5',
      down: 'M12 5v14m0 0 5-5m-5 5-5-5'
    }[kind];
    if (!d) return '';
    return `<svg class="grow-glyph grow-glyph-${esc(kind)}" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
  }

  function fmt(n) {
    const x = Number(n) || 0;
    return nf ? nf.format(x) : String(x);
  }

  function when(iso) {
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return String(iso || '');
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return m + '.' + day + ' ' + hh + ':' + mm;
  }

  function initial(name) {
    const s = String(name || '?');
    return s.slice(s.length - 1);
  }

  /* safe-fn: CommonsAvatar.html 自行逐值转义；兜底分支逐值转义 */
  function avatar(id, name, level) {
    const ava = window.CommonsAvatar;
    if (ava && typeof ava.html === 'function') return `<span class="grow-ava">${/* safe: CommonsAvatar.html 已逐值转义 */ ava.html({ id: id, name: name, size: 32, level: Number(level) || 0 })}</span>`;
    const api = window.Commons;
    if (api && typeof api.avatar === 'function' && /^p\d+$/.test(String(id || ''))) return api.avatar(id, 'tiny');
    return `<span class="grow-avatar" data-tone="${esc(String((name || id || 'x').length % 5))}" aria-hidden="true">${esc(initial(name))}</span>`;
  }

  function consentOn() {
    if (isLive()) {
      const me = (state.live && state.live.me) || {};
      return me.consentMetering === true;
    }
    const me = sample().me || {};
    return pref('consentMetering', me.consentMetering !== false) !== false;
  }

  function optedOut() {
    if (isLive()) return !!(state.live && state.live.me && state.live.me.optedOut);
    return pref('optedOut', !!(sample().board && sample().board.optedOut)) === true;
  }

  function publicOn() {
    if (isLive()) return false;
    return pref('publicRanking', !!(sample().board && sample().board.publicRanking)) === true;
  }

  function myToken() {
    if (isLive()) return (state.live && state.live.tokens || []).find(row => row.isMe) || null;
    const saved = pref('tokenReport', null);
    const list = sample().tokens || [];
    const mine = list.find(row => row.id === (sample().me && sample().me.id));
    if (saved && typeof saved === 'object') {
      return Object.assign({}, mine || { id: 'me', name: (sample().me && sample().me.name) || '我', level: 2, perMillion: { works: 0, adopted: 0, reproduced: 0 } }, saved, { trust: 'self' });
    }
    return mine || null;
  }

  function tokenRows() {
    const list = (sample().tokens || []).slice();
    const overlay = myToken();
    if (!overlay) return list;
    const i = list.findIndex(row => row.id === overlay.id);
    if (i >= 0) list[i] = Object.assign({}, list[i], overlay);
    else list.push(overlay);
    return list;
  }

  function levelOf(n) {
    return LEVELS.find(x => x.level === n) || LEVELS[0];
  }

  function lvName(n) {
    const L = window.CommonsLevel;
    return L && typeof L.name === 'function' ? L.name(n) : levelOf(Number(n) || 1).name;
  }

  /* safe-fn: CommonsLevel.badge 自行逐值转义；兜底分支逐值转义 */
  function lvBadge(n, size) {
    const L = window.CommonsLevel;
    if (L && typeof L.badge === 'function') return L.badge(n, { size: size || 'sm', withName: true });
    return `<span class="grow-lv-text">L${esc(String(n))} ${esc(lvName(n))}</span>`;
  }

  function eventOf(key) {
    return EVENTS[key] || { label: key, points: '', anti: '' };
  }

  /* ---------- 曲线 ---------- */

  function smoothPath(pts) {
    if (pts.length < 2) return '';
    let d = 'M' + pts[0].x.toFixed(1) + ' ' + pts[0].y.toFixed(1);
    for (let i = 0; i < pts.length - 1; i += 1) {
      const a = pts[i];
      const b = pts[i + 1];
      const mx = (a.x + b.x) / 2;
      d += ' C' + mx.toFixed(1) + ' ' + a.y.toFixed(1) + ',' + mx.toFixed(1) + ' ' + b.y.toFixed(1) + ',' + b.x.toFixed(1) + ' ' + b.y.toFixed(1);
    }
    return d;
  }

  function chartSVG(weekly) {
    const rows = Array.isArray(weekly) ? weekly : [];
    if (rows.length < 2) return '<p class="grow-muted">还没有按周累计。</p>';
    const w = 600;
    const h = 160;
    const padT = 12;
    const padB = 6;
    const max = Math.max.apply(null, rows.map(r => Number(r.total) || 0).concat([1]));
    const pts = rows.map((row, i) => ({
      x: (i * w) / (rows.length - 1),
      y: padT + (1 - (Number(row.total) || 0) / max) * (h - padT - padB)
    }));
    const d = smoothPath(pts);
    const area = d + ' L' + w + ' ' + h + ' L0 ' + h + ' Z';
    const dots = pts.map((p, i) =>
      `<i class="${i === pts.length - 1 ? 'is-last' : ''}" style="left:${esc((p.x / w * 100).toFixed(2))}%;top:${esc((p.y / h * 100).toFixed(2))}%" title="${esc(String(rows[i].week || ''))} · ${esc(fmt(rows[i].total))}"></i>`
    ).join('');
    return `<div class="grow-chart-plot">` +
      `<svg class="grow-chart-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="本赛季按周累计贡献">` +
      `<path class="grow-chart-area" d="${esc(area)}"></path>` +
      `<path class="grow-chart-line" d="${esc(d)}" fill="none" vector-effect="non-scaling-stroke"></path></svg>` +
      dots +
      `</div>` +
      `<ol class="grow-chart-x" aria-hidden="true">${rows.map(r => `<li>${esc(String(r.week || '').slice(5).replace('-', '.'))}</li>`).join('')}</ol>`;
  }

  /* ---------- 片段 ---------- */

  function pill(text, kind) {
    return `<span class="pill${kind ? ' ' + esc(kind) : ''}">${esc(text)}</span>`;
  }

  function switchBtn(act, on, label, disabled) {
    return `<button type="button" class="grow-switch" data-grow-act="${esc(act)}" role="switch" aria-checked="${esc(String(on))}"${disabled ? ' disabled aria-disabled="true"' : ''}>` +
      `<span class="grow-switch-track" aria-hidden="true"><span class="grow-switch-thumb"></span></span>` +
      `<span class="grow-switch-label">${esc(label)}</span></button>`;
  }

  function actionCell(key, locked) {
    const a = ACTIONS[key] || { label: key, icon: 'candidate' };
    return `<li class="grow-action${locked ? ' is-locked' : ''}">` +
      `<span class="grow-action-ico">${icon(locked ? 'blocked' : a.icon, 16)}</span>` +
      `<span class="grow-action-copy"><b>${esc(a.label)}</b>${locked ? '<small>下一级</small>' : ''}</span>` +
      `</li>`;
  }

  function actionsHTML(me) {
    const nextLv = levelOf((me.next && me.next.level) || (me.level || 1) + 1);
    const open = me.unlocked || [];
    const locked = me.nextUnlocks || nextLv.unlocks || [];
    return `<ul class="grow-actions">${open.map(k => actionCell(k, false)).join('')}${locked.map(k => actionCell(k, true)).join('')}</ul>`;
  }

  function criteriaList(items, reviewNote) {
    if (reviewNote) return `<p class="grow-note">${esc(reviewNote)}</p>`;
    return `<ul class="grow-criteria">${(items || []).map(c => {
      const have = Number(c.have) || 0;
      const need = Number(c.need) || 1;
      const done = have >= need;
      const pct = Math.max(0, Math.min(100, Math.round((have / need) * 100)));
      return `<li class="grow-criterion${done ? ' is-done' : ''}">` +
        `<div class="grow-criterion-top">` +
        `<span class="grow-criterion-label">${done ? icon('verified', 14) : icon('in-progress', 14)}<span>${esc(c.label)}</span></span>` +
        `<b>${esc(String(have))} / ${esc(String(need))} ${esc(c.unit || '')}</b>` +
        `</div>` +
        `<div class="grow-meter" role="progressbar" aria-valuemin="0" aria-valuemax="${esc(String(need))}" aria-valuenow="${esc(String(have))}" style="--grow-pct:${esc(String(pct))}%"><i></i></div>` +
        `</li>`;
    }).join('')}</ul>`;
  }

  function ladderHTML(me) {
    const current = Number(me.level) || 1;
    const next = (me.next && me.next.level) || current + 1;
    const useAlt = !consentOn();
    const items = useAlt ? ALT_CRITERIA : ((me.next && me.next.criteria) || []);
    const nextLv = levelOf(next);
    const done = Math.max(0, Math.min(1, (current - 1) / (LEVELS.length - 1)));
    const steps = LEVELS.map(lv => {
      const stateName = lv.level < current ? 'done' : lv.level === current ? 'now' : 'later';
      return `<li data-state="${stateName}" data-step-level="${esc(String(lv.level))}"${lv.level === current ? ' aria-current="step"' : ''}>` +
        `<span class="grow-step-art"><img src="assets/illus/badge-l${esc(String(lv.level))}.webp" alt="" width="96" height="96" loading="lazy" decoding="async"></span>` +
        `${/* safe: CommonsLevel 已逐值转义 */ lvBadge(lv.level, 'md')}` +
        `</li>`;
    }).join('');
    const nextBody = nextLv.note ? `<p class="grow-note">${esc(nextLv.note)}</p>` : criteriaList(items);
    return `<ol class="grow-ladder" aria-label="L1 到 L5 的等级" style="--grow-done:${esc(String(done))}">${steps}</ol>` +
      `<div class="grow-next">` +
      `<h3>升到 L${esc(String(nextLv.level))} ${esc(lvName(nextLv.level))} 还差</h3>` +
      nextBody +
      `</div>`;
  }

  function ledgerHTML(me) {
    const rows = (me.ledger || []).slice().sort((a, b) => String(b.at).localeCompare(String(a.at)));
    if (!rows.length) return `<div class="grow-empty">${icon('clue', 20)}<p>还没有流水。做出第一件能被确认的事，就会出现在这里。</p></div>`;
    return `<ol class="grow-ledger">${rows.map(row => {
      const open = state.openLedger === row.id;
      const ev = eventOf(row.event);
      const pos = Number(row.points) >= 0;
      return `<li class="grow-led">` +
        `<button type="button" class="grow-led-main" data-grow-act="ledger" data-id="${esc(row.id)}" aria-expanded="${esc(String(open))}">` +
        `<span class="grow-led-pts ${pos ? 'is-pos' : 'is-neg'}">${pos ? '+' : ''}${esc(String(row.points))}</span>` +
        `<span class="grow-led-copy"><b>${esc(ev.label)}</b><small>${esc(when(row.at))} · L${esc(String((row.confirmer && row.confirmer.level) || '?'))} 确认</small></span>` +
        `<span class="grow-led-chev" aria-hidden="true">${glyph('chev')}</span>` +
        `</button>` +
        `<div class="grow-led-detail" ${open ? '' : 'hidden'}>` +
        `<dl>` +
        `<div><dt>规则</dt><dd>${esc(ev.label)} · ${esc(ev.points)} · ${esc(row.ruleVersion)}</dd></div>` +
        `<div><dt>为什么是这个分</dt><dd>${esc(row.reason || '按当前规则计。')}</dd></div>` +
        `<div><dt>防刷</dt><dd>${row.discount ? esc('折扣 ' + row.discount.factor + ' · ' + row.discount.why) : esc(ev.anti)}</dd></div>` +
        `<div><dt>冲正</dt><dd>${row.reverses ? '指向 ' + esc(row.reverses) : '没有冲正。'}</dd></div>` +
        `</dl>` +
        `</div>` +
        `</li>`;
    }).join('')}</ol>`;
  }

  function deltaHTML(n) {
    const v = Number(n) || 0;
    if (v > 0) return `<span class="grow-delta is-up">${glyph('up')} 较上周 +${esc(String(v))}</span>`;
    if (v < 0) return `<span class="grow-delta is-down">${glyph('down')} 较上周 ${esc(String(v))}</span>`;
    return `<span class="grow-delta is-flat">较上周持平</span>`;
  }

  function rankHTML(rank) {
    const n = Number(rank) || 0;
    if (n >= 1 && n <= 3) {
      return `<span class="grow-place" data-place="${n}"><b>${esc(String(n))}</b></span>`;
    }
    return `<b class="grow-rank">${esc(String(rank))}</b>`;
  }

  function boardRows(kind) {
    const me = sample().me || {};
    if (kind === 'contribution') {
      const rows = (sample().board && sample().board.contribution) || [];
      return rows.map(row => {
        const mine = row.id === me.id;
        const hidden = mine && optedOut();
        return `<li class="grow-row${mine ? ' is-me' : ''}${hidden ? ' is-out' : ''}">` +
          rankHTML(row.rank) +
          avatar(row.id, row.name, row.level) +
          `<span class="grow-row-who is-lv"><b>${esc(row.name)}${mine ? ' · 我' : ''}</b>${/* safe: CommonsLevel 已逐值转义 */ lvBadge(row.level, 'xs')}</span>` +
          `<span class="grow-row-pts">${hidden ? '已退出，只有你看得到' : fmt(row.points)}</span>` +
          (hidden ? '' : deltaHTML(row.delta)) +
          `</li>`;
      }).join('');
    }
    const rows = tokenRows();
    return rows.map(row => {
      const mine = row.id === me.id;
      const a = row.trust === 'gateway';
      const demo = row.demo || a;
      if (kind === 'spend') {
        return `<li class="grow-row${mine ? ' is-me' : ''}${demo ? ' is-demo' : ''}">` +
          avatar(row.id, row.name, row.level) +
          `<span class="grow-row-who"><b>${esc(row.name)}${mine ? ' · 我' : ''}</b><small>${esc(row.family)}</small></span>` +
          `<span class="grow-row-pts">${esc(row.band)}</span>` +
          `<span class="grow-trust${a ? ' is-a' : ''}">${a ? '平台计量' : '自报 · 未核实'}</span>` +
          `</li>`;
      }
      const pm = row.perMillion || {};
      return `<li class="grow-row${mine ? ' is-me' : ''}${demo ? ' is-demo' : ''}">` +
        avatar(row.id, row.name, row.level) +
        `<span class="grow-row-who"><b>${esc(row.name)}${mine ? ' · 我' : ''}</b><small>每百万 Token</small></span>` +
        `<span class="grow-ratio"><b>${esc(String(pm.works ?? '–'))}</b><small>作品</small></span>` +
        `<span class="grow-ratio"><b>${esc(String(pm.adopted ?? '–'))}</b><small>采纳</small></span>` +
        `<span class="grow-ratio"><b>${esc(String(pm.reproduced ?? '–'))}</b><small>复现</small></span>` +
        `<span class="grow-trust${a ? ' is-a' : ''}">${a ? '平台计量' : '自报 · 未核实'}</span>` +
        `</li>`;
    }).join('');
  }

  function reportForm() {
    const mine = myToken() || {};
    return `<form class="grow-report field" data-grow-form="token">` +
      `<p>只记量级区间，不收集 API key。</p>` +
      `<label class="field">模型家族` +
      `<select name="family">${FAMILIES.map(f => `<option${mine.family === f ? ' selected' : ''}>${esc(f)}</option>`).join('')}</select>` +
      `</label>` +
      `<label class="field">本赛季用量区间` +
      `<select name="band">${BANDS.map(b => `<option${mine.band === b ? ' selected' : ''}>${esc(b)}</option>`).join('')}</select>` +
      `</label>` +
      `<label class="field">用量文件（可选）` +
      `<input type="file" name="usage" accept=".json,.csv,.txt,.md">` +
      `<small>只在本机读数字，不上传。</small>` +
      `</label>` +
      `<div class="grow-report-actions">` +
      `<button type="submit" class="button primary">提交自报</button>` +
      `<button type="button" class="button ghost" data-grow-act="report-cancel">取消</button>` +
      `</div>` +
      `</form>`;
  }

  /* ---------- 页面片段 ---------- */

  function progressHeading() {
    return `<div class="grow-ia-heading"><h2 id="ia-growth-title">等级进度</h2><a class="button ghost small" href="#/tiers">等级制度</a></div>`;
  }

  function growthHTML() {
    const me = sample().me || {};
    return `<div class="grow-panel">` +
      ladderHTML(me) +
      `</div>` +
      `<section class="grow-split">` +
      `<section class="grow-panel" aria-labelledby="grow-can-title">` +
      `<div class="grow-panel-head"><h2 id="grow-can-title">你现在能做什么</h2></div>` +
      actionsHTML(me) +
      `</section>` +
      `<section class="grow-panel grow-consent" aria-labelledby="grow-consent-title">` +
      `<div class="grow-panel-head"><h2 id="grow-consent-title">行为计量</h2></div>` +
      `<p>关掉后，晋升只看收到的「有用」和被采纳。</p>` +
      switchBtn('consent', consentOn(), consentOn() ? '已同意记录阅读和活跃' : '已关闭，走另一条路', !!state.consentBusy) +
      `</section>` +
      `</section>` +
      `<section class="grow-panel grow-points" aria-labelledby="grow-points-title">` +
      `<div class="grow-panel-head">` +
      `<h2 id="grow-points-title">贡献值</h2>` +
      `<a class="button ghost small" href="#/leaderboard">看赛季榜</a>` +
      `</div>` +
      `<p class="grow-stat"><b>${fmt(me.points && me.points.season)}</b><small>本赛季</small></p>` +
      `<div class="grow-chart" data-grow-chart>${chartSVG(me.points && me.points.weekly)}</div>` +
      `</section>` +
      `<section class="grow-panel" aria-labelledby="grow-led-title">` +
      `<div class="grow-panel-head"><h2 id="grow-led-title">贡献流水</h2></div>` +
      ledgerHTML(me) +
      `</section>`;
  }

  function boardHTML() {
    const me = sample().me || {};
    const tab = state.tab;
    const notice = publicOn()
      ? '内测默认应该关掉。现在是演示：别人也能看到名次。'
      : '内测头几周排名只给本人看。';
    let body;
    if (tab === 'contribution') {
      body = `<ol class="grow-board">${boardRows('contribution')}</ol>` +
        `<p class="grow-foot">管理员和治理员不上榜。退出后自己那一行还在，只有你看得到。</p>` +
        switchBtn('optout', optedOut(), optedOut() ? '已退出赛季榜' : '退出赛季榜', isLive() && !!state.optoutBusy);
    } else if (tab === 'spend') {
      body = `<ol class="grow-board grow-board-token">${boardRows('spend')}</ol>` +
        `<p class="grow-foot">只显示量级区间；「平台计量」一行是接入后的样子。</p>` +
        `<button type="button" class="button primary" data-grow-act="report">上报本赛季用量</button>`;
    } else {
      body = `<p class="grow-banner">${icon('reminder', 16)}<span>接入平台计量前只展示，不评奖。</span></p>` +
        `<ol class="grow-board grow-board-ratio">${boardRows('ratio')}</ol>` +
        `<button type="button" class="button primary" data-grow-act="report">上报本赛季用量</button>`;
    }
    const mine = myToken();
    return `<div class="grow-ia-toolbar"><span>${esc(me.season && me.season.name || '本赛季')} · ${esc(me.season && me.season.startsAt || '')} 至 ${esc(me.season && me.season.endsAt || '')}</span>${isLive() ? '' : pill('示例')}</div>` +
      `<div class="grow-notice" data-state="${publicOn() ? 'on' : 'off'}">` +
      `<div>${icon('reminder', 16)}<p>${esc(notice)}</p></div>` +
      (isLive()
        ? '<a class="button tonal" href="#/account">去账号页设置公开排名</a>'
        : switchBtn('public', publicOn(), publicOn() ? '公开排名：已开启' : '公开排名：未开启')) +
      `</div>` +
      `<div class="tabs" role="tablist" aria-label="榜单">${TABS.map(([id, label]) =>
        `<button type="button" role="tab" data-grow-act="tab" data-id="${id}" aria-selected="${tab === id}">${esc(label)}</button>`
      ).join('')}</div>` +
      `<section class="grow-panel" data-tab="${esc(tab)}" aria-label="${esc((TABS.find(t => t[0] === tab) || [])[1] || '榜单')}">${/* safe: body 由本函数内已逐值转义的视图片段组成 */ body}</section>` +
      (mine && tab !== 'contribution' ? `<p class="grow-muted">你的自报：${esc(mine.family)} · ${esc(mine.band)} · 自报 · 未核实</p>` : '');
  }

  function tiersHTML() {
    return `<dl class="grow-axes grow-axes-compact" aria-label="等级、角色与会员">` +
      `<div><dt>信任等级</dt><dd>做事解锁能力</dd></div>` +
      `<div><dt>角色</dt><dd>人工任命职责</dd></div>` +
      `<div><dt>会员</dt><dd>只给服务，不买分</dd></div>` +
      `</dl>` +
      `<section class="grow-panel" aria-labelledby="grow-lv-title">` +
      `<div class="grow-panel-head"><h2 id="grow-lv-title">等级表</h2></div>` +
      `<div class="grow-table-wrap"><table class="grow-table grow-table-levels"><thead><tr><th>等级</th><th>怎么到</th><th>解锁</th></tr></thead><tbody>` +
      LEVELS.map(lv => `<tr><th><span class="grow-lv-cell">${/* safe: CommonsLevel 已逐值转义 */ lvBadge(lv.level, 'md')}</span></th><td>${esc(lv.how)}</td><td>${lv.unlocks.map(k => esc((ACTIONS[k] || {}).label || k)).join('、')}</td></tr>`).join('') +
      `</tbody></table></div></section>` +
      `<section class="grow-panel" aria-labelledby="grow-rule-title">` +
      `<div class="grow-panel-head"><h2 id="grow-rule-title">贡献规则</h2><p>每笔可追溯、可冲正</p></div>` +
      `<div class="grow-table-wrap"><table class="grow-table grow-table-rules"><thead><tr><th>事件</th><th>分值</th><th>防刷</th></tr></thead><tbody>` +
      Object.keys(EVENTS).map(k => {
        const ev = EVENTS[k];
        const neg = String(ev.points).charAt(0) !== '+';
        return `<tr><th>${esc(ev.label)}</th><td class="grow-pts-cell${neg ? ' is-neg' : ''}">${esc(ev.points)}</td><td>${esc(ev.anti)}</td></tr>`;
      }).join('') +
      `</tbody></table></div></section>` +
      `<section class="grow-panel" aria-labelledby="grow-faq-title">` +
      `<div class="grow-panel-head"><h2 id="grow-faq-title">常见问题</h2></div>` +
      `<div class="grow-faq">${FAQ.map(([q, a]) => `<details><summary>${esc(q)}<span class="grow-faq-chev" aria-hidden="true">${glyph('chev')}</span></summary><p>${esc(a)}</p></details>`).join('')}</div>` +
      `</section>`;
  }

  function liveStateHTML(kind) {
    if (kind === 'error') {
      if (state.liveError === 'closed') return `<div class="grow-empty" role="status"><p>这个功能还没开放</p><p>管理员还没打开。</p></div>`;
      return `<div class="grow-empty" role="alert"><p>${esc(state.liveError || '成长页没有载入')}</p><button type="button" class="button" data-grow-act="retry">重试</button></div>`;
    }
    return `<div class="grow-empty" aria-live="polite"><p>正在读取成长记录…</p></div>`;
  }

  function pageInner() {
    if (isLive() && state.liveError) return liveStateHTML('error');
    if (isLive() && !state.live) return liveStateHTML('loading');
    if (state.page === 'leaderboard') return boardHTML();
    const me = sample().me || {};
    const achievements = window.CommonsAchievements && window.CommonsAchievements.section
      ? window.CommonsAchievements.section() : '';
    const pricing = window.CommonsBusiness && window.CommonsBusiness.pricingSection
      ? window.CommonsBusiness.pricingSection() : '';
    const membership = window.CommonsExtensions && window.CommonsExtensions.membershipSection
      ? window.CommonsExtensions.membershipSection() : '';
    const appearance = window.CommonsLevelDemo && window.CommonsLevelDemo.section
      ? window.CommonsLevelDemo.section() : '';
    return `<div class="grow-ia-toolbar"><span>${esc(me.season && me.season.name || '本赛季')} · 当前 ${/* safe: CommonsLevel 已逐值转义 */ lvBadge(me.level, 'sm')}</span>${isLive() ? '' : pill('示例')}</div>` +
      `<section class="grow-ia-section" id="ia-growth" data-grow-progress aria-labelledby="ia-growth-title">${progressHeading()}${growthHTML()}</section>` +
      /* safe: 四个片段均由各模块的已转义视图函数产生 */ achievements +
      `<section class="grow-ia-section" id="ia-tiers" aria-labelledby="ia-tiers-title"><h2 id="ia-tiers-title">等级与会员</h2>${tiersHTML()}</section>` +
      /* safe: pricing、membership、appearance 均由各模块的已转义视图函数产生 */ pricing + membership + appearance;
  }

  /* safe-slot: inner — 调用方传入本模块页面函数返回的完整 HTML */
  function wrap(inner) {
    return `<div class="grow-page" data-growth data-page="${esc(state.page)}" data-anchor="${esc(state.anchor)}">${inner}</div>`;
  }

  function paint() {
    if (!state.root) return;
    const act = document.activeElement;
    const keep = act && act.getAttribute && act.getAttribute('data-grow-act');
    const keepId = act && act.dataset ? act.dataset.id : '';
    state.root.dataset.page = state.page;
    const progress = state.page === 'growth' && state.root.querySelector('[data-grow-progress]');
    if (progress) progress.innerHTML = progressHeading() + growthHTML();
    else state.root.innerHTML = pageInner();
    if (keep) {
      const next = state.root.querySelector(`[data-grow-act="${keep}"]${keepId ? `[data-id="${keepId}"]` : ''}`);
      if (next && next.focus) next.focus({ preventScroll: true });
    }
  }

  function view(name) {
    state.page = name === 'leaderboard' ? 'leaderboard' : 'growth';
    state.anchor = name;
    state.openLedger = state.page === 'growth' ? state.openLedger : '';
    return wrap(pageInner());
  }

  /* ---------- 交互 ---------- */

  function closeModal() {
    if (window.Commons && typeof window.Commons.closeModal === 'function') window.Commons.closeModal();
  }

  function openReport() {
    const html = reportForm();
    if (window.Commons && typeof window.Commons.modal === 'function') {
      window.Commons.modal('上报本赛季用量', html);
      return;
    }
    toast('打不开对话框。接线后才能演示上报。');
  }

  function postConsent(next) {
    if (!isLive() || state.consentBusy || !window.CommonsAPI) return;
    const prev = consentOn();
    applyConsent(next);
    state.consentBusy = true;
    paint();
    const opts = window.CommonsAPI.newIdempotencyKey
      ? { idempotencyKey: window.CommonsAPI.newIdempotencyKey() }
      : {};
    window.CommonsAPI.post('/growth/consent', { consent: !!next }, opts).then(function (response) {
      const data = response && response.data;
      const value = data && Object.prototype.hasOwnProperty.call(data, 'consentMetering')
        ? !!data.consentMetering
        : !!next;
      applyConsent(value);
      state.consentBusy = false;
      paint();
      toast(value ? '已同意记录阅读和活跃。' : '已改走「有用」和「被采纳」这一条。');
      emitConsent(value);
    }).catch(function (error) {
      applyConsent(prev);
      state.consentBusy = false;
      paint();
      const code = error && error.code;
      const message = code === 'capability_unavailable'
        ? '这个功能还没开放。管理员还没打开。'
        : ((error && error.message) || '行为计量没有改成。原设置没有变化。');
      toast(message);
    });
  }

  function failureText(error, fallback) {
    return (error && (error.status === 501 || error.code === 'capability_unavailable'))
      ? '这个功能还没开放。管理员还没打开。'
      : ((error && error.message) || fallback);
  }

  // 真实模式：退出/回到赛季榜以服务器为准，失败不改任何东西。
  function postOptout(next) {
    if (!isLive() || state.optoutBusy || !window.CommonsAPI) return;
    state.optoutBusy = true;
    paint();
    window.CommonsAPI.post('/growth/optout', { optout: !!next }, { idempotencyKey: window.CommonsAPI.newIdempotencyKey() }).then(function (response) {
      const value = !!(response && response.data && response.data.optedOut);
      if (state.live && state.live.me) state.live.me.optedOut = value;
      state.optoutBusy = false;
      paint();
      toast(value ? '已退出赛季榜。这一行只有你看得到。' : '已重新出现在赛季榜。');
    }).catch(function (error) {
      state.optoutBusy = false;
      paint();
      toast(failureText(error, '没有改成，原设置没有变化。'));
    });
  }

  function postTokenReport(form) {
    if (state.reportBusy || !window.CommonsAPI) return;
    const family = String((form.elements.namedItem('family') || {}).value || FAMILIES[0]);
    const band = String((form.elements.namedItem('band') || {}).value || BANDS[0]);
    const submitBtn = form.querySelector('button[type="submit"]');
    state.reportBusy = true;
    if (submitBtn) { submitBtn.disabled = true; submitBtn.setAttribute('aria-busy', 'true'); }
    window.CommonsAPI.post('/growth/tokens/report', { family: family, band: band, trust: 'self' }, { idempotencyKey: window.CommonsAPI.newIdempotencyKey() }).then(function () {
      state.reportBusy = false;
      closeModal();
      toast('已记为自报 · 未核实。');
      state.liveLoading = false;
      loadLive();
    }).catch(function (error) {
      state.reportBusy = false;
      if (submitBtn) { submitBtn.disabled = false; submitBtn.removeAttribute('aria-busy'); }
      toast(failureText(error, '自报没有提交成功，请稍后再试。'));
    });
  }

  function onClick(event) {
    const btn = event.target.closest('[data-grow-act]');
    if (!btn) return;
    const act = btn.dataset.growAct;
    if (act === 'ledger') {
      state.openLedger = state.openLedger === btn.dataset.id ? '' : btn.dataset.id;
      paint();
    } else if (act === 'consent') {
      if (isLive()) {
        postConsent(!consentOn());
        return;
      }
      setPref('consentMetering', !consentOn());
      paint();
      toast(consentOn() ? '已按行为计量演示。' : '已改走「有用」和「被采纳」这一条。');
    } else if (act === 'optout') {
      if (isLive()) {
        postOptout(!optedOut());
        return;
      }
      setPref('optedOut', !optedOut());
      paint();
      toast(optedOut() ? '已退出赛季榜。这一行只有你看得到。' : '已重新出现在赛季榜。');
    } else if (act === 'public') {
      if (isLive()) return;
      setPref('publicRanking', !publicOn());
      paint();
    } else if (act === 'tab') {
      if (TABS.some(t => t[0] === btn.dataset.id)) state.tab = btn.dataset.id;
      paint();
    } else if (act === 'report') {
      openReport();
    } else if (act === 'report-cancel') {
      closeModal();
    } else if (act === 'retry') {
      loadLive();
    }
  }

  function loadLive() {
    if (!isLive() || !window.CommonsAPI || state.liveLoading) return;
    const ticket = ++state.liveRequest;
    state.liveLoading = true;
    state.liveError = '';
    Promise.all([
      window.CommonsAPI.get('/growth/me'),
      window.CommonsAPI.get('/growth/board'),
      window.CommonsAPI.get('/growth/tokens')
    ]).then(function (rows) {
      if (ticket !== state.liveRequest) return;
      const incoming = rows[0].data || {};
      if (state.consentBusy && state.live && state.live.me) {
        incoming.consentMetering = state.live.me.consentMetering;
      }
      state.live = {
        me: incoming,
        board: rows[1].data || { contribution: [] },
        tokens: Array.isArray(rows[2].data) ? rows[2].data : []
      };
      state.liveLoading = false;
      paint();
    }).catch(function (error) {
      if (ticket !== state.liveRequest) return;
      state.live = null;
      state.liveLoading = false;
      state.liveError = (error && (error.status === 501 || error.code === 'capability_unavailable')) ? 'closed' : ((error && error.message) || '成长页没有载入');
      paint();
    });
  }

  function onSubmit(event) {
    const form = event.target.closest('[data-grow-form="token"]');
    if (!form) return;
    event.preventDefault();
    if (isLive()) {
      postTokenReport(form);
      return;
    }
    const family = String((form.elements.namedItem('family') || {}).value || FAMILIES[0]);
    const band = String((form.elements.namedItem('band') || {}).value || BANDS[0]);
    setPref('tokenReport', { family: family, band: band, trust: 'self' });
    closeModal();
    if (state.page === 'leaderboard') paint();
    toast('已记为自报 · 未核实。文件没有留下。');
  }

  function on(target, type, fn) {
    target.addEventListener(type, fn);
    state.unbind.push(() => target.removeEventListener(type, fn));
  }

  function mount() {
    const root = document.querySelector('[data-growth]');
    if (!root) return;
    destroy();
    state.root = root;
    state.page = root.dataset.page || state.page;
    state.anchor = root.dataset.anchor || 'growth';
    on(document, 'click', onClick);
    on(document, 'submit', onSubmit);
    if (isLive() && !state.live && !state.liveError && !state.liveLoading) loadLive();
    const targets = { tiers: 'ia-tiers', achievements: 'ia-achievements', levels: 'ia-levels', pricing: 'ia-pricing', membership: 'ia-membership' };
    if (targets[state.anchor]) state.anchorTimer = window.setTimeout(() => {
      const target = document.getElementById(targets[state.anchor]);
      if (target) target.scrollIntoView({ block: 'start' });
    }, 0);
  }

  function destroy() {
    if (state.anchorTimer != null) window.clearTimeout(state.anchorTimer);
    state.anchorTimer = null;
    state.unbind.forEach(fn => fn());
    state.unbind = [];
    state.root = null;
    state.consentBusy = false;
  }

  window.CommonsGrowth = {
    routes: {
      growth: () => view('growth'),
      leaderboard: () => view('leaderboard'),
      tiers: () => view('tiers'),
      achievements: () => view('achievements'),
      levels: () => view('levels'),
      pricing: () => view('pricing'),
      membership: () => view('membership')
    },
    hub: ['growth', 'leaderboard', 'tiers', 'achievements', 'levels', 'pricing', 'membership'],
    mount: mount,
    destroy: destroy
  };
})();
