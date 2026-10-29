(() => {
'use strict';
const W = typeof window !== 'undefined' ? window : globalThis;

/* ---------- helpers ---------- */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/* safe-fn: 属性名过 /^[a-z][a-z0-9-]*$/i 白名单并排除 on*，属性值全部 esc */
const attrs = o => Object.keys(o || {}).filter(k => /^[a-z][a-z0-9-]*$/i.test(k) && !/^on/i.test(k)).map(k => ` ${k}="${esc(o[k])}"`).join('');
const pick = (v, list, d) => (list.includes(v) ? v : d);
const pad2 = n => String(n).padStart(2, '0');
let uid = 0;
const nextId = p => `kit-${p}-${++uid}`;
function isLive() { return !!(W.CommonsAPI && W.CommonsAPI.mode === 'live'); }
const K = () => isLive() ? null : (W.COMMONS_KNOWLEDGE || null);
const isSynthetic = () => !!(K() && K().synthetic);
const unitById = id => { const k = K(); return (k && (k.units || []).find(u => u.id === id)) || null; };
const clusterIndex = id => { const k = K(); const i = k ? (k.clusters || []).findIndex(c => c.id === id) : -1; return i < 0 ? 0 : i; };
const clusterLabel = id => { const k = K(); const c = k && (k.clusters || []).find(x => x.id === id); return c ? c.label : ''; };
const catVar = id => `var(--cat-${(clusterIndex(id) % 10) + 1})`;
const monthShort = m => { const x = /^(\d{4})-(\d{1,2})$/.exec(String(m || '')); return x ? `${x[1]}-${pad2(x[2])}` : String(m || ''); };

/* 交互八态 + 页面四态（规范 §9） */
const STATES = ['default', 'hover', 'active', 'focus', 'selected', 'disabled', 'loading', 'drag'];
const ST_LABEL = { default: '默认', hover: '悬停', active: '按下', focus: '聚焦', selected: '选中', disabled: '禁用', loading: '加载', drag: '拖起', empty: '空', error: '出错', denied: '无权限' };
const PAGE_STATES = ['loading', 'empty', 'error', 'denied'];

/* ---------- icons（描边 1.5，和 app.js 的 icon() 同一风格） ---------- */
const ICONS = {
  check: 'M5 12.5l4.2 4.2L19 7',
  close: 'M7 7l10 10M17 7 7 17',
  plus: 'M12 5v14M5 12h14',
  copy: 'M9 9h10v10H9zM5 15V5h10',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-3.5-3.5',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  replay: 'M4 12a8 8 0 1 0 2.4-5.7M4 4v4.5h4.5',
  bookmark: 'M7 4h10v16l-5-3.5L7 20z',
  quote: 'M7 7h4v4c0 3-1.5 5-4 6M14 7h4v4c0 3-1.5 5-4 6',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  clock: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM12 8v4l3 2',
  more: 'M6 12h.01M12 12h.01M18 12h.01',
  filter: 'M4 6h16M7 12h10M10 18h4',
  share: 'M12 4v11M8 8l4-4 4 4M5 13v6h14v-6',
  trash: 'M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12',
  info: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM12 11v5M12 8h.01',
  alert: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM12 8v5M12 16h.01',
  spark: 'M12 4v4M12 16v4M4 12h4M16 12h4M7 7l2 2M15 15l2 2M17 7l-2 2M9 15l-2 2',
  lock: 'M7 11h10v8H7zM9 11V8a3 3 0 0 1 6 0v3',
  similar: 'M4 9c3-3 5 3 8 0s5 3 8 0M4 15c3-3 5 3 8 0s5 3 8 0',
  follows: 'M6 4v8a4 4 0 0 0 4 4h9M15 12l4 4-4 4',
  answers: 'M10 7 5 12l5 5M5 12h10a4 4 0 0 1 4 4v1',
  contradicts: 'M12 4v16M5 8l14 8',
  'same-tool': 'M14.5 5.5a3.5 3.5 0 0 0-4.6 4.4L5 14.8V19h4.2l4.9-4.9a3.5 3.5 0 0 0 4.4-4.6l-2.3 2.3-2.4-.6-.6-2.4z'
};
const svg = (name, cls) => `<svg class="kit-ico${esc(cls ? ' ' + cls : '')}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="${ICONS[name] || ICONS.info}"/></svg>`;

/* 知识点类型：填充形状（知识网的点用同一套形状） */
const KIND = {
  question: { zh: '问题', shape: '<circle cx="6" cy="6" r="4.6"/>' },
  solution: { zh: '解法', shape: '<rect x="1.6" y="1.6" width="8.8" height="8.8" rx="2.2"/>' },
  pitfall: { zh: '踩坑', shape: '<path d="M6 1.3 10.9 10H1.1z" stroke-linejoin="round" stroke-width="1.2" stroke="currentColor"/>' },
  'tool-review': { zh: '工具体验', shape: '<path d="M6 .9 10.6 3.5v5L6 11.1 1.4 8.5v-5z"/>' },
  debate: { zh: '争论', shape: '<path d="M6 .7 11.3 6 6 11.3.7 6z"/>' },
  'work-lead': { zh: '作品线索', shape: '<path d="M6 .6 7.5 4.5 11.4 6 7.5 7.5 6 11.4 4.5 7.5.6 6 4.5 4.5z"/>' },
  resource: { zh: '资源', shape: '<circle cx="6" cy="6" r="4" fill="none" stroke="currentColor" stroke-width="1.8"/>' }
};
function kindGlyph(kind) { const k = KIND[kind] || KIND.question; return `<svg class="kit-kind__g" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true" focusable="false">${k.shape}</svg>`; }
function kindTag(kind, color) { const k = KIND[kind] || KIND.question; return `<span class="kit-kind"${color ? ` style="--c:${esc(color)}"` : ''}>${kindGlyph(kind)}<span>${esc(k.zh)}</span></span>`; }

const STATUS = {
  candidate: { zh: '候选', hint: '刚被收集，还没人整理', g: '<circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="2.2 2.2"/>' },
  curated: { zh: '已整理', hint: '已有人整理成可读条目', g: '<circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 2.5a5.5 5.5 0 0 1 0 11z" fill="currentColor"/>' },
  verified: { zh: '已验证', hint: '有人照着做并确认可用', g: '<circle cx="8" cy="8" r="6.2" fill="currentColor"/><path class="kit-g-on" d="M5.4 8.2l1.8 1.8 3.5-3.7" fill="none" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' },
  stale: { zh: '过期', hint: '工具或做法可能已变化，请复核', g: '<circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 5v3.2l2 1.3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>' },
  disputed: { zh: '有争议', hint: '群友意见不一致，请对照阅读', g: '<path d="M8 1.8 14.2 8 8 14.2 1.8 8z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M8 1.8V14.2L1.8 8z" fill="currentColor"/>' }
};
const REL = {
  similar: { zh: '相似', hint: '讲的是相近的事', line: '点线' },
  follows: { zh: '追问', hint: '接着这条继续问', line: '实线 · 箭头' },
  answers: { zh: '解答', hint: '回答了对方的问题', line: '实线' },
  contradicts: { zh: '推翻', hint: '与对方的说法相反', line: '虚线' },
  'same-tool': { zh: '同工具', hint: '用的是同一个工具', line: '细线' }
};

/* ---------- token registries（色块、字阶、尺子都从这里生成；数值在 mount 时从 tokens.css 读） ---------- */
const NEUTRAL = [25, 50, 100, 200, 300, 400, 500, 600, 700, 800, 900];
const STEPS10 = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900];
const STEPS8 = [50, 100, 200, 300, 400, 500, 600, 700];
const HUES = [
  { id: 'blue', zh: '蓝', role: '品牌动作 · 选中 · 焦点', steps: STEPS10, roles: ['--accent', '--accent-hover', '--accent-soft', '--accent-line', '--tint-blue'] },
  { id: 'teal', zh: '青', role: 'Agent · 知识', steps: STEPS10, roles: ['--agent', '--agent-ink', '--agent-soft', '--agent-line', '--tint-teal'] },
  { id: 'violet', zh: '紫', role: '判断 · 教学 · 提醒', steps: STEPS10, roles: ['--notice', '--notice-ink', '--tint-violet'] },
  { id: 'sky', zh: '天蓝', role: '说明', steps: STEPS8, roles: ['--info', '--info-ink'] },
  { id: 'green', zh: '翠绿', role: '成功', steps: STEPS8, roles: ['--success', '--success-ink'] },
  { id: 'rose', zh: '玫红', role: '危险', steps: STEPS8, roles: ['--danger', '--danger-ink'] }
];
const ROLES = ['--paper', '--surface', '--sunk', '--ink', '--ink-2', '--muted', '--faint', '--line', '--line-strong', '--line-soft', '--control-line'];
const SEMANTIC = [
  { id: 'success', zh: '成功', sample: '已验证：3 位群友照着做成了', icon: 'check' },
  { id: 'info', zh: '说明', sample: '佐证是几位群友各自独立说过同一件事', icon: 'info' },
  { id: 'notice', zh: '提醒', sample: '这条做法是 5 月的，工具可能已经更新', icon: 'clock' },
  { id: 'danger', zh: '危险', sample: '撤回后，引用这条的 4 篇笔记会断开', icon: 'alert' }
];
const TYPE = [
  { t: 'hero', w: 'bold', tr: 'tight', s: '群里问过的事，连成一张网' },
  { t: 'stat', w: 'semibold', tr: 'tight', s: '1,284 条 · 已验证 24', num: true },
  { t: 'display', w: 'semibold', tr: 'tight', s: '把长任务拆成带检查点的小步' },
  { t: 'feature', w: 'semibold', tr: 'snug', s: '进度文件只留摘要和下一步' },
  { t: 'section', w: 'semibold', tr: 'snug', s: '重开后先对账，再续跑' },
  { t: 'item', w: 'medium', s: '长任务中途断了，怎么接着跑' },
  { t: 'body', w: 'regular', s: '把长任务拆成带检查点的小步，每步写进进度文件；断了，让新会话先读进度文件再继续。' },
  { t: 'ui', w: 'medium', s: '按状态筛选 · 已验证 · 有争议' },
  { t: 'meta', w: 'regular', s: '让编程 Agent 跑得稳 · 2026-06 · 佐证 4 人' },
  { t: 'micro', w: 'medium', s: '示例 · 合成数据，不是群聊真实内容' }
];
const WEIGHTS = ['regular', 'medium', 'semibold', 'bold'];
const SPACE = [1, 2, 3, 4, 5, 6, 8, 10, 12, 16];
const RADII = [['thumb', '标签、缩略图'], ['control', '按钮、输入框'], ['panel', '卡片、面板'], ['stage', '舞台、弹层'], ['pill', '胶囊、分段']];
const SHADOWS = [['1', '静止卡片'], ['2', '悬停、浮层'], ['3', '弹层、抽屉、命令面板']];
const DURATIONS = [['fast', '悬停、按下'], ['base', '颜色、小件切换'], ['enter', '出现'], ['layout', '选中指示、抽屉'], ['stage', '镜头、数字滚动']];
const CURVES = [['out', '出现、悬停、数字'], ['in-out', '镜头、舞台切换'], ['drawer', '抽屉、弹层'], ['spring', '选中指示（只用在位移上）']];
const BTN_TONES = [
  { cls: 'primary', zh: '主要', label: '保存', use: '一屏最多一个' },
  { cls: '', zh: '次要', label: '引用', use: '默认动作' },
  { cls: 'tonal', zh: '色调', label: '筛选', use: '筛选、轻量确认' },
  { cls: 'ghost', zh: '幽灵', label: '取消', use: '工具栏、行内' },
  { cls: 'danger', zh: '危险', label: '撤回', use: '删除、撤回' }
];
const COMPONENTS = ['按钮', '图标按钮', '选择片', '标签', '分段控件', '标签页', '输入框', '搜索框', '文本域', '下拉选择', '提示条', '轻提示', '浮层提示', '抽屉', '快捷键', '状态徽章', '关系标签', '类型形状', '来路条', '迷你时间线', '知识卡 · 紧凑', '知识卡 · 完整', '知识卡 · 嵌入', '骨架屏', '空态', '出错态', '无权限', '数字滚动', '示例标记'];
const TOKEN_COUNT = NEUTRAL.length + HUES.reduce((n, h) => n + h.steps.length, 0) + 10 + ROLES.length + SEMANTIC.length * 4 + TYPE.length * 2 + WEIGHTS.length + 3 + SPACE.length + RADII.length + SHADOWS.length + 2 + DURATIONS.length + 2 + CURVES.length;

/* ---------- atoms ---------- */
function demoMark() { return '<span class="kit-demo" title="合成示例数据，不是群聊真实内容">示例</span>'; }

/* 按钮：只输出真实类名 .button（外观归 SHELL-2）；state 用 data-state 强制呈现 */
function button(o) {
  o = o || {};
  const st = pick(o.state, STATES, 'default');
  const tone = pick(o.tone, ['primary', 'secondary', 'tonal', 'ghost', 'danger'], 'secondary');
  const size = pick(o.size, ['small', 'default', 'large'], 'default');
  const loading = !!o.loading || st === 'loading';
  const disabled = !!o.disabled || st === 'disabled';
  const cls = ['button', tone === 'secondary' ? '' : tone, size === 'default' ? '' : size, o.iconOnly ? 'icon-only' : '', o.cls || ''].filter(Boolean).join(' ');
  const forced = ['hover', 'active', 'focus', 'disabled', 'loading', 'drag'].includes(st) ? ` data-state="${esc(st)}"` : '';
  const pressed = o.pressed !== undefined || st === 'selected' ? ` aria-pressed="${o.pressed === false ? 'false' : 'true'}"` : '';
  const extra = (disabled ? ' disabled' : '') + (loading ? ' aria-busy="true"' : '') + (o.iconOnly ? ` aria-label="${esc(o.label)}"` : '');
  const lead = loading ? '<span class="button-spinner" aria-hidden="true"></span>' : (o.icon ? svg(o.icon) : '');
  const text = o.iconOnly ? '' : `<span>${esc(o.label ?? '')}</span>`;
  const tail = o.trail ? svg(o.trail) : '';
  return `<button type="${esc(pick(o.type, ['button', 'submit', 'reset'], 'button'))}" class="${esc(cls)}"${forced}${pressed}${extra}${attrs(o.attrs)}>${lead}${text}${tail}</button>`;
}

/* 标签：静态标签用全局 .pill；可选标签走真实 .chip */
function tag(text, tone, o) {
  o = o || {};
  if (o.button) {
    const st = pick(o.state, STATES, 'default');
    const sel = o.selected || st === 'selected';
    const forced = ['hover', 'active', 'focus', 'disabled'].includes(st) ? ` data-state="${esc(st)}"` : '';
    return `<button type="button" class="chip${sel ? ' selected' : ''}" aria-pressed="${sel ? 'true' : 'false'}"${forced}${st === 'disabled' ? ' disabled' : ''}${attrs(o.attrs)}>${esc(text)}</button>`;
  }
  const map = { neutral: 'gray', gray: 'gray', accent: 'accent', knowledge: 'agent', agent: 'agent', outline: 'outline', info: '', notice: 'notice', success: 'success', dot: 'dot', danger: 'danger' };
  const t = map[tone] !== undefined ? map[tone] : 'gray';
  return `<span class="pill${t ? ' ' + t : ''}">${esc(text)}</span>`;
}

/* 状态图标库（state-icons.js）。没加载时返回空串，调用方用自己的字形兜底。 */
const STATUS_ICON = { candidate: 'candidate', curated: 'organized', verified: 'verified', disputed: 'disputed', stale: 'expired' };
const STATE_ICONS = ['spark', 'bulb', 'question', 'follow-up', 'verify-pending', 'verified', 'disputed', 'reversed', 'expired', 'pitfall', 'connected', 'trending'];
const stateIcon = (name, size) => { const I = W.CommonsIcons; return I && typeof I.svg === 'function' ? I.svg(name, { size }) : ''; };

function statusBadge(status) {
  const key = STATUS[status] ? status : 'candidate';
  const s = STATUS[key];
  const g = stateIcon(STATUS_ICON[key], 14) || `<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">${/* safe: STATUS 常量表里的 SVG 片段 */ s.g}</svg>`;
  return `<span class="kit-status kit-status--${esc(key)}" title="${esc(s.hint)}">${g}<span>${esc(s.zh)}</span></span>`;
}

function relTag(rel) {
  const key = REL[rel] ? rel : 'similar';
  return `<span class="kit-rel kit-rel--${esc(key)}" title="${esc(REL[key].hint)}">${svg(key)}<span>${esc(REL[key].zh)}</span></span>`;
}

function kbd(keys) {
  const map = { cmd: '⌘', command: '⌘', ctrl: 'Ctrl', control: 'Ctrl', shift: '⇧', alt: '⌥', option: '⌥', enter: '↵', return: '↵', esc: 'Esc', escape: 'Esc', up: '↑', down: '↓', left: '←', right: '→' };
  const list = Array.isArray(keys) ? keys : String(keys ?? '').split(/\s*\+\s*/);
  return `<span class="kit-kbdg">${list.filter(k => String(k).length).map(k => `<kbd>${esc(map[String(k).toLowerCase()] || k)}</kbd>`).join('')}</span>`;
}

/* ---------- provenance / timeline ---------- */
function avatars(codes) {
  const list = (codes || []).slice(0, 3);
  if (!list.length) return '';
  return `<span class="kit-avs" role="img" aria-label="贡献者代号 ${esc(list.join('、'))}">${list.map((c, i) => `<span class="kit-av kit-av--${i % 3}" title="${esc(c)}">${esc(String(c).slice(-2))}</span>`).join('')}</span>`;
}
function provenance(u, o) {
  if (!u) return '';
  o = o || {};
  const tagName = o.inline ? 'span' : 'p';
  const parts = [];
  const c = clusterLabel(u.cluster);
  if (c) parts.push(`<span class="kit-prov__cluster" style="--c:${catVar(u.cluster)}"><i aria-hidden="true"></i>${esc(c)}</span>`);
  if (u.month) parts.push(`<span class="kit-num">${esc(monthShort(u.month))}</span>`);
  if (Number.isFinite(u.corroboration)) parts.push(`<span>佐证 <b class="kit-num">${esc(u.corroboration)}</b> 人</span>`);
  const av = avatars(u.contributors);
  return `<${tagName} class="kit-prov">${parts.join('<span class="kit-prov__sep" aria-hidden="true"></span>')}${av}</${tagName}>`;
}

function miniTimeline(events) {
  const list = (Array.isArray(events) ? events : []).filter(Boolean);
  if (!list.length) return '<p class="kit-tl-empty">还没有时间线记录。有人追问或验证后，这里按月份排开。</p>';
  return `<ol class="kit-tl" aria-label="时间线">${list.map(e => {
    const key = STATUS[e.status] ? e.status : 'candidate';
    return `<li class="kit-tl__item kit-tl__item--${esc(key)}"><span class="kit-tl__node" aria-hidden="true">${stateIcon(STATUS_ICON[key], 14) || `<svg viewBox="0 0 16 16">${/* safe: STATUS 常量表里的 SVG 片段 */ STATUS[key].g}</svg>`}</span><span class="kit-tl__month kit-num">${esc(monthShort(e.month))}</span><span class="kit-tl__label">${esc(e.label)}</span><span class="kit-tl__st">${esc(STATUS[key].zh)}</span></li>`;
  }).join('')}</ol>`;
}

/* ---------- 插图（内联 SVG，冷色线稿；颜色全部走 CSS 类） ---------- */
const ILLU = {
  empty: '<svg class="kit-illu" viewBox="0 0 160 112" aria-hidden="true" focusable="false"><rect class="i-paper" x="30" y="18" width="100" height="76" rx="10"/><path class="i-soft" d="M30 36h100"/><circle class="i-dot" cx="42" cy="27" r="2.5"/><circle class="i-dot" cx="50" cy="27" r="2.5"/><circle class="i-node" cx="58" cy="60" r="7"/><circle class="i-node" cx="102" cy="52" r="5"/><path class="i-line" d="M64 58l32-5"/><path class="i-dash" d="M58 67l12 13M102 57l-6 22"/><circle class="i-slot" cx="80" cy="82" r="8"/><path class="i-accent" d="M80 78v8M76 82h8"/></svg>',
  error: '<svg class="kit-illu" viewBox="0 0 160 112" aria-hidden="true" focusable="false"><rect class="i-paper" x="30" y="18" width="100" height="76" rx="10"/><path class="i-soft" d="M30 36h100"/><circle class="i-dot" cx="42" cy="27" r="2.5"/><circle class="i-dot" cx="50" cy="27" r="2.5"/><circle class="i-node" cx="56" cy="64" r="7"/><circle class="i-node" cx="104" cy="64" r="7"/><path class="i-line" d="M63 64h9M88 64h9"/><path class="i-warn" d="M76 58l4 6-4 6M84 58l-4 6 4 6"/><path class="i-soft" d="M46 82h68"/></svg>',
  denied: '<svg class="kit-illu" viewBox="0 0 160 112" aria-hidden="true" focusable="false"><rect class="i-paper" x="30" y="18" width="100" height="76" rx="10"/><path class="i-soft" d="M30 36h100M46 52h44M46 62h30"/><rect class="i-node" x="94" y="62" width="22" height="18" rx="4"/><path class="i-accent" d="M99 62v-5a6 6 0 0 1 12 0v5"/><circle class="i-dot" cx="105" cy="71" r="2"/></svg>'
};

/* ---------- feedback ---------- */
function skeleton(lines) {
  const n = Math.max(1, Math.min(8, Number.isFinite(lines) ? Math.round(lines) : 3));
  return `<div class="kit-skel" role="status" aria-busy="true"><span class="kit-sr">加载中</span><span class="kit-skel__row" aria-hidden="true"><span class="kit-skel__dot"></span><span class="kit-skel__bar kit-skel__bar--s"></span></span>${Array.from({ length: n }, (_, i) => `<span class="kit-skel__bar${i === n - 1 ? ' kit-skel__bar--m' : ''}" aria-hidden="true"></span>`).join('')}</div>`;
}
function actionHtml(a, tone) {
  if (!a) return '';
  if (typeof a === 'string') return button({ label: a, tone, size: 'small' });
  return button({ label: a.label, tone: a.tone || tone, attrs: a.attrs, icon: a.icon, size: 'small' });
}
function pageState(kind, o) {
  o = o || {};
  const illu = ILLU[kind] || ILLU.empty;
  const role = kind === 'error' ? ' role="alert"' : '';
  return `<div class="kit-state kit-state--${esc(kind)}"${role}>${illu}<h4 class="kit-state__title">${esc(o.title)}</h4>${o.body ? `<p class="kit-state__body">${esc(o.body)}</p>` : ''}${actionHtml(o.action, o.tone || 'secondary')}</div>`;
}
function empty(o) { o = o || {}; return pageState('empty', { title: o.title ?? '这里还没有内容', body: o.body, action: o.action }); }
function errorState(o) { o = o || {}; return pageState('error', { title: o.title ?? '没加载出来', body: o.body ?? '原数据没有动，可以再试一次。', action: o.retry }); }

function toast(text, tone, o) {
  o = o || {};
  const t = pick(tone === 'error' ? 'danger' : tone, ['success', 'info', 'notice', 'danger', 'neutral'], 'info');
  const ic = { success: 'check', info: 'info', notice: 'clock', danger: 'alert', neutral: 'info' }[t];
  const dismiss = o.dismiss === false ? '' : `<button type="button" class="kit-toast__close" data-kit-dismiss aria-label="关闭提示">${svg('close')}</button>`;
  return `<div class="kit-toast kit-toast--${esc(t)}" role="${t === 'danger' ? 'alert' : 'status'}">${svg(ic, 'kit-toast__ico')}<span class="kit-toast__text">${esc(text)}</span>${o.action ? `<button type="button" class="kit-toast__act" data-kit-dismiss>${esc(o.action)}</button>` : ''}${dismiss}</div>`;
}

function callout(tone, title, body) {
  const t = pick(tone, ['success', 'info', 'notice', 'danger'], 'info');
  const ic = { success: 'check', info: 'info', notice: 'clock', danger: 'alert' }[t];
  return `<div class="kit-callout kit-callout--${esc(t)}" role="${t === 'danger' ? 'alert' : 'note'}">${svg(ic, 'kit-callout__ico')}<div><p class="kit-callout__title">${esc(title)}</p><p class="kit-callout__body">${esc(body)}</p></div></div>`;
}

/* 浮层提示：触发器带 data-kit-tip，mount 后由一个共享浮层负责显示（分组延迟） */
function tooltip(target, text, o) {
  o = o || {};
  if (o.icon) return button({ label: target, tone: 'ghost', iconOnly: true, icon: o.icon, attrs: { 'data-kit-tip': text } });
  return `<button type="button" class="kit-tiptarget" data-kit-tip="${esc(text)}">${esc(target)}</button>`;
}

/* ---------- composite controls ---------- */
function normItems(items) {
  return (Array.isArray(items) ? items : []).map((x, i) => (typeof x === 'object' && x ? { value: String(x.value ?? i), label: x.label ?? x.value ?? '', disabled: !!x.disabled, panel: x.panel, count: x.count } : { value: String(x), label: x }));
}
function segmented(o) {
  o = Array.isArray(o) ? { items: o } : (o || {});
  const items = normItems(o.items);
  let sel = items.findIndex(x => x.value === String(o.value) && !x.disabled);
  if (sel < 0) sel = items.findIndex(x => !x.disabled);
  const body = items.map((x, i) => `<button type="button" role="radio" class="kit-seg__item" aria-checked="${i === sel}" tabindex="${i === sel ? 0 : -1}" data-value="${esc(x.value)}"${x.disabled ? ' aria-disabled="true"' : ''}${o.state && i === 1 ? ` data-state="${esc(o.state)}"` : ''}>${esc(x.label)}${x.count !== undefined ? `<span class="kit-seg__n kit-num">${esc(x.count)}</span>` : ''}</button>`).join('');
  return `<div class="kit-seg${o.size === 'small' ? ' kit-seg--small' : ''}" role="radiogroup" aria-label="${esc(o.label ?? '选择')}"${o.attrs ? attrs(o.attrs) : ''}><span class="kit-seg__thumb" aria-hidden="true"></span>${body}</div>`;
}
function tabs(o) {
  o = Array.isArray(o) ? { items: o } : (o || {});
  const items = normItems(o.items);
  const base = nextId('tabs');
  let sel = items.findIndex(x => x.value === String(o.value) && !x.disabled);
  if (sel < 0) sel = 0;
  const list = items.map((x, i) => `<button type="button" role="tab" class="kit-tabs__tab" id="${esc(base)}-t${i}" aria-controls="${esc(base)}-p${i}" aria-selected="${i === sel}" tabindex="${i === sel ? 0 : -1}"${x.disabled ? ' aria-disabled="true"' : ''}>${esc(x.label)}${x.count !== undefined ? `<span class="kit-tabs__n kit-num">${esc(x.count)}</span>` : ''}</button>`).join('');
  const panels = items.map((x, i) => `<div role="tabpanel" class="kit-tabs__panel" id="${esc(base)}-p${i}" aria-labelledby="${esc(base)}-t${i}" tabindex="0"${i === sel ? '' : ' hidden'}>${/* safe: panelHtml / 以 < 开头的 panel 是调用方显式传入的 HTML 槽，其余走 esc */ x.panelHtml !== undefined ? x.panelHtml : (typeof x.panel === 'string' && x.panel.startsWith('<') ? x.panel : `<p>${esc(x.panel ?? '')}</p>`)}</div>`).join('');
  return `<div class="kit-tabs"><div class="kit-tabs__list" role="tablist" aria-label="${esc(o.label ?? '标签页')}"><span class="kit-tabs__ink" aria-hidden="true"></span>${list}</div>${panels}</div>`;
}
function drawer(o) {
  o = o || {};
  const id = o.id ? String(o.id) : nextId('drawer');
  const body = o.bodyHtml !== undefined ? String(o.bodyHtml) : `<p>${esc(o.body ?? '')}</p>`;
  return `<div class="kit-drawer" id="${esc(id)}" hidden><div class="kit-drawer__scrim" data-kit-close></div><section class="kit-drawer__panel" role="dialog" aria-modal="true" aria-labelledby="${esc(id)}-title" tabindex="-1"><header class="kit-drawer__head"><div><p class="kit-drawer__eyebrow">${esc(o.eyebrow ?? '详情')}</p><h2 class="kit-drawer__title" id="${esc(id)}-title">${esc(o.title ?? '详情')}</h2></div>${button({ label: '关闭', tone: 'ghost', iconOnly: true, icon: 'close', attrs: { 'data-kit-close': '' } })}</header><div class="kit-drawer__body">${/* safe: body 由 o.bodyHtml（调用方显式传入的 HTML 槽）或已 esc 的 <p> 组成 */ body}</div>${o.footHtml ? `<footer class="kit-drawer__foot">${/* safe: footHtml 是调用方显式传入的 HTML 槽 */ o.footHtml}</footer>` : ''}</section></div>`;
}

/* ---------- knowledge card ---------- */
function excerpt(u) { return u.solution || u.outcome || u.question || u.context || ''; }
function confidence(u) {
  if (!Number.isFinite(u.confidence)) return '';
  const v = Math.max(0, Math.min(1, u.confidence));
  return `<span class="kit-conf" title="把握：整理者对这条结论的信心"><span class="kit-conf__bar" style="--v:${v.toFixed(2)}" aria-hidden="true"></span><span class="kit-num">把握 ${Math.round(v * 100)}%</span></span>`;
}
function knowledgeCard(u, variant, o) {
  o = o || {};
  variant = pick(variant, ['compact', 'full', 'embed'], 'compact');
  const cls = `kit-kc kit-kc--${variant}`;
  const demo = o.demo !== undefined ? !!o.demo : isSynthetic();
  if (o.state === 'loading') return `<div class="${esc(cls)}" aria-busy="true">${skeleton(3)}</div>`;
  if (o.state === 'error') return `<div class="${esc(cls)} kit-kc--void" role="alert"><p>这条知识点没加载出来，原数据没有动。</p>${button({ label: '重试', size: 'small', icon: 'replay' })}</div>`;
  if (!u || o.state === 'empty') return `<div class="${esc(cls)} kit-kc--void"><p>这个位置还没有知识点。</p></div>`;
  const color = catVar(u.cluster);
  const top = `${kindTag(u.kind, color)}${statusBadge(u.status)}${demo ? demoMark() : ''}`;
  const title = esc(u.title);
  if (variant === 'compact') {
    const st = ['hover', 'active', 'focus', 'selected', 'drag'].includes(o.state) ? ` data-state="${esc(o.state)}"` : '';
    return `<button type="button" class="${esc(cls)}" style="--c:${color}"${st}${o.selected ? ' aria-pressed="true"' : ''} data-kit-unit="${esc(u.id)}"${attrs(o.attrs)}><span class="kit-kc__top">${top}</span><span class="kit-kc__title">${title}</span><span class="kit-kc__excerpt">${esc(excerpt(u))}</span>${provenance(u, { inline: true })}</button>`;
  }
  if (variant === 'embed') {
    return `<aside class="${esc(cls)}" style="--c:${color}" data-kit-unit="${esc(u.id)}" aria-label="引用的知识点"><span class="kit-kc__from">${svg('quote')}引自知识网</span><p class="kit-kc__title">${title}</p><p class="kit-kc__excerpt">${esc(excerpt(u))}</p><span class="kit-kc__row">${statusBadge(u.status)}${provenance(u, { inline: true })}${demo ? demoMark() : ''}</span></aside>`;
  }
  /* safe-slot: inner — 调用方传入已 esc 的片段 */
  const sec = (label, inner) => (inner ? `<section class="kit-kc__sec"><h4 class="kit-kc__label">${esc(label)}</h4>${inner}</section>` : '');
  const steps = (u.steps || []).length ? `<ol class="kit-kc__steps">${u.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol>` : '';
  const tools = (u.tools || []).length ? `<p class="kit-kc__tools">${u.tools.map(t => tag(t, 'outline')).join('')}</p>` : '';
  const links = (u.links || []).map(l => { const t = unitById(l.to); return `<li>${relTag(l.rel)}<span class="kit-kc__linkto">${esc(t ? t.title : l.to)}</span></li>`; }).join('');
  return `<article class="${esc(cls)}" style="--c:${color}" data-kit-unit="${esc(u.id)}"><header class="kit-kc__head"><span class="kit-kc__top">${top}</span>${confidence(u)}</header><h3 class="kit-kc__title">${title}</h3>${u.question ? `<p class="kit-kc__q">${esc(u.question)}</p>` : ''}${sec('做法', u.solution ? `<p>${esc(u.solution)}</p>` : '')}${sec('步骤', steps)}${sec('结果', u.outcome ? `<p>${esc(u.outcome)}</p>` : '')}${sec('还没解决', u.unresolved ? `<p>${esc(u.unresolved)}</p>` : '')}${sec('用到的工具', tools)}${sec('相关知识点', links ? `<ul class="kit-kc__links">${links}</ul>` : '')}<footer class="kit-kc__foot">${provenance(u)}</footer></article>`;
}

/* ---------- catalog building blocks ---------- */
const SECTIONS = [
  ['color', '颜色'], ['type', '字体'], ['space', '间距 · 圆角 · 阴影'], ['button', '按钮'], ['input', '选择与输入'],
  ['feedback', '反馈'], ['knowledge', '知识组件'], ['states', '加载 · 空 · 出错'], ['motion', '动效'], ['layout', '层级示范']
];
/* safe-slot: lede, inner — 调用方传入写死的说明文案与示例 HTML */
function section(i, id, title, lede, inner) {
  return `<section class="kit-sec" id="kit-s-${esc(id)}" data-kit-section="${esc(id)}" aria-labelledby="kit-h-${esc(id)}"><header class="kit-sec__head"><p class="kit-eyebrow"><span class="kit-num">${pad2(i + 1)}</span>${esc(SECTIONS[i][1])}</p><h2 class="kit-sec__title" id="kit-h-${esc(id)}" tabindex="-1">${esc(title)}</h2>${lede ? `<p class="kit-sec__lede">${lede}</p>` : ''}</header>${inner}</section>`;
}
/* safe-slot: note — 调用方传入写死的说明文案 */
const sub = (t, note) => `<div class="kit-sub"><h3 class="kit-sub__title">${esc(t)}</h3>${note ? `<p class="kit-sub__note">${note}</p>` : ''}</div>`;
const code = t => `<code class="kit-code">${esc(t)}</code>`;

function swatch(name, step, dark) {
  return `<button type="button" class="kit-sw" style="--sw:var(${esc(name)})" data-kit-copy="${esc(name)}"${dark ? ' data-dark' : ''} aria-label="复制变量名 ${esc(name)}"><span class="kit-sw__chip"><span class="kit-sw__step kit-num">${esc(step)}</span><span class="kit-sw__ok" aria-hidden="true">${svg('check')}</span></span><span class="kit-sw__name">${esc(name)}</span><span class="kit-sw__hex kit-num" data-kit-val="${esc(name)}"></span></button>`;
}
function roleChip(name) {
  return `<button type="button" class="kit-role" data-kit-copy="${esc(name)}" aria-label="复制变量名 ${esc(name)}"><span class="kit-role__dot" style="--sw:var(${esc(name)})" aria-hidden="true"></span><span>${esc(name)}</span></button>`;
}

function colorSection() {
  const neutral = `<div class="kit-ramp kit-ramp--11">${NEUTRAL.map(s => swatch(`--slate-${s}`, s, s >= 500)).join('')}</div>`;
  const roles = `<div class="kit-roles"><span class="kit-roles__label">角色层（页面代码优先引用）</span>${ROLES.map(roleChip).join('')}</div>`;
  const hues = HUES.map(h => `<div class="kit-hue"><div class="kit-hue__meta"><p class="kit-hue__name">${esc(h.zh)}<code>${h.id}</code></p><p class="kit-hue__role">${esc(h.role)}</p></div><div class="kit-ramp kit-ramp--${h.steps.length}">${h.steps.map(s => swatch(`--${h.id}-${s}`, s, s >= 500)).join('')}</div><div class="kit-hue__roles">${h.roles.map(roleChip).join('')}</div></div>`).join('');
  const k = K();
  const clusters = (k && k.clusters) || [];
  const counts = {};
  ((k && k.units) || []).forEach(u => { counts[u.cluster] = (counts[u.cluster] || 0) + 1; });
  const cats = `<div class="kit-cats">${Array.from({ length: 10 }, (_, i) => swatch(`--cat-${i + 1}`, i + 1, ![8].includes(i))).join('')}</div>`;
  const blob = (c, i) => {
    const us = ((k && k.units) || []).filter(u => u.cluster === c.id);
    const xs = us.map(u => u.xy[0]), ys = us.map(u => u.xy[1]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const dots = us.slice(0, 14).map(u => {
      const x = 10 + ((u.xy[0] - x0) / ((x1 - x0) || 1)) * 100, y = 8 + ((u.xy[1] - y0) / ((y1 - y0) || 1)) * 36;
      const r = u.status === 'verified' ? 3.4 : (u.kind === 'question' ? 2.8 : 2.2);
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}"${u.status === 'candidate' ? ' class="o"' : ''}/>`;
    }).join('');
    return `<div class="kit-blob" style="--c:var(--cat-${i + 1})"><svg class="kit-blob__dots" viewBox="0 0 120 52" aria-hidden="true" focusable="false">${dots}</svg><p class="kit-blob__label">${esc(c.label)}</p><p class="kit-blob__meta"><code>--cat-${i + 1}</code><span class="kit-num">${esc(counts[c.id] || 0)} 条</span></p></div>`;
  };
  const blobs = clusters.length ? `<div class="kit-blobs">${clusters.slice(0, 10).map(blob).join('')}</div>` : '';
  const semantic = `<div class="kit-sem">${SEMANTIC.map(s => `<div class="kit-sem__card kit-sem__card--${s.id}"><div class="kit-sem__demo">${svg(s.icon)}<p><b>${esc(s.zh)}</b>${esc(s.sample)}</p></div><div class="kit-sem__tokens">${['', '-ink', '-soft', '-line'].map(x => roleChip(`--${s.id}${x}`)).join('')}</div></div>`).join('')}</div>`;
  return section(0, 'color', '九成中性，色彩有职责',
    '底、字、线只用冷灰。色相只出现在四处：品牌动作（蓝）、Agent 与知识（青）、判断与教学（紫）、分类图形。没有黄、橙、棕。<b>点任意色块复制变量名。</b>',
    sub('中性阶', '冷灰 11 级，九成界面用它。') + `<div class="kit-board kit-board--flush">${neutral}${roles}</div>`
    + sub('色相阶', '六个色相，每个色相下面是它的角色变量。') + `<div class="kit-board kit-board--flush kit-hues">${hues}</div>`
    + sub('分类色', `十个分类色只用于图形和识别，避开品牌蓝、Agent 青和语义色，明暗交替。下排模拟知识网的簇：淡底 ${code('12%')} + 实色描边 + 标签。`) + `<div class="kit-board kit-board--flush">${cats}${blobs}</div>`
    + sub('语义四色', '提醒用紫，危险用玫红。文字放在淡底上时用同色相的 <code class="kit-code">-ink</code>。') + semantic);
}

function typeSection() {
  const rows = TYPE.map(r => `<div class="kit-type__row"><div class="kit-type__meta">${code('--text-' + r.t)}<span class="kit-num" data-kit-type="${r.t}"></span><span>${esc(r.w)}${r.tr ? ` · ${esc(r.tr)}` : ''}</span></div><p class="kit-type__sample kit-type--${r.t}"${r.num ? ' data-num' : ''}>${esc(r.s)}</p></div>`).join('');
  const nums = ['1,284', '137', '98.6%', '3.1 倍', '2026-10'];
  const numCol = (cls, label) => `<div class="kit-nums__col ${esc(cls)}"><p class="kit-nums__label">${esc(label)}</p>${nums.map(n => `<p>${esc(n)}</p>`).join('')}</div>`;
  const weights = `<div class="kit-weights">${WEIGHTS.map(w => `<div class="kit-weight"><p class="kit-weight__glyph" style="font-weight:var(--weight-${w})">知 Aa</p>${code('--weight-' + w)}</div>`).join('')}</div>`;
  return section(1, 'type', '一个组件最多三个字号',
    `字阶共 10 档，每档配同名行高。标题字距收紧，正文不动。所有数字加 ${code('--num-features')}，等宽数位让列对齐、滚动时宽度不跳。`,
    `<div class="kit-board kit-type">${rows}</div>`
    + `<div class="kit-split">${`<div class="kit-board"><div class="kit-board__bar"><span>数字样张</span>${code('--num-features')}</div><div class="kit-nums">${numCol('kit-nums--prop', '比例数位')}${numCol('kit-nums--tab', '等宽数位')}<div class="kit-nums__col kit-nums--mono"><p class="kit-nums__label">--mono</p><p>11:00</p><p>M0076</p><p>ku004</p><p>v2 · 10.25</p></div></div></div>`}<div class="kit-board"><div class="kit-board__bar"><span>字重四档</span>${code('--weight-*')}</div>${weights}<div class="kit-tracks"><p class="kit-tracks__row"><span style="letter-spacing:var(--tracking-tight)">知识网 Commons</span>${code('--tracking-tight')}</p><p class="kit-tracks__row"><span style="letter-spacing:var(--tracking-snug)">知识网 Commons</span>${code('--tracking-snug')}</p><p class="kit-tracks__row"><span class="kit-tracks__label">AGENT COMMONS</span>${code('--tracking-label')}</p></div></div></div>`);
}

function spaceSection() {
  const ruler = `<div class="kit-ruler">${SPACE.map(n => `<div class="kit-ruler__row">${code('--space-' + n)}<span class="kit-ruler__bar" style="--w:var(--space-${n})" aria-hidden="true"></span><span class="kit-num" data-kit-val="--space-${n}"></span></div>`).join('')}</div>`;
  const radii = `<div class="kit-radii">${RADII.map(([r, use]) => `<button type="button" class="kit-radius" data-kit-copy="--radius-${r}" aria-label="复制变量名 --radius-${r}"><span class="kit-radius__box" style="border-radius:var(--radius-${r})" aria-hidden="true"></span><span class="kit-radius__name">${esc(r)}<span class="kit-num" data-kit-val="--radius-${r}"></span></span><span class="kit-radius__use">${esc(use)}</span><span class="kit-sr">--radius-${r}</span></button>`).join('')}</div>`;
  const shadows = `<div class="kit-shadows">${SHADOWS.map(([n, use]) => `<div class="kit-shadow" style="box-shadow:var(--shadow-${n})"><span class="kit-shadow__n kit-num">${n}</span>${code('--shadow-' + n)}<span class="kit-shadow__use">${esc(use)}</span></div>`).join('')}<div class="kit-shadow kit-shadow--accent"><span class="kit-shadow__n">主</span>${code('--shadow-accent')}<span class="kit-shadow__use">主按钮的品牌光</span></div></div>`;
  const rings = `<div class="kit-rings"><div class="kit-ringdemo"><span class="kit-ringdemo__box kit-ringdemo--offset"></span>${code('--ring-offset')}<span>键盘焦点</span></div><div class="kit-ringdemo"><span class="kit-ringdemo__box kit-ringdemo--ring"></span>${code('--ring')}<span>输入框聚焦</span></div><div class="kit-ringdemo"><span class="kit-ringdemo__box kit-ringdemo--line1"></span>${code('--line-1')}<span>区块边框</span></div><div class="kit-ringdemo"><span class="kit-ringdemo__box kit-ringdemo--line2"></span>${code('--line-2')}<span>只给选中和焦点</span></div></div>`;
  return section(2, 'space', '间距只有十档，阴影只有三级',
    '间距都是 4 的倍数，容器内用 gap。圆角五档按物件大小递增。阴影是双层冷色投影，越高越远。',
    `<div class="kit-split kit-split--space"><div class="kit-board"><div class="kit-board__bar"><span>间距尺</span>${code('--space-*')}</div>${ruler}</div><div class="kit-board"><div class="kit-board__bar"><span>圆角五档</span>${code('--radius-*')}</div>${radii}<div class="kit-board__bar kit-board__bar--inner"><span>线与焦点</span></div>${rings}</div></div>`
    + `<div class="kit-board kit-board--sunk"><div class="kit-board__bar"><span>三级阴影，同一块底上对比</span>${code('--shadow-1 / 2 / 3')}</div>${shadows}</div>`);
}

function buttonSection() {
  const head = `<tr><th scope="col" class="kit-mx__corner">语气 \\ 状态</th>${STATES.map(s => `<th scope="col"><span>${ST_LABEL[s]}</span>${code(s)}</th>`).join('')}</tr>`;
  const rows = BTN_TONES.map(t => `<tr><th scope="row"><span class="kit-mx__tone">${esc(t.zh)}</span>${code(t.cls ? '.' + t.cls : '.button')}<span class="kit-mx__use">${esc(t.use)}</span></th>${STATES.map(s => `<td data-cell="${s}">${s === 'drag' ? '<span class="kit-na" title="按钮不能拖起；拖起态见知识卡">—</span>' : button({ label: s === 'loading' ? t.label + '中' : t.label, tone: t.cls || 'secondary', state: s })}</td>`).join('')}</tr>`).join('');
  const matrix = `<div class="kit-scroll" tabindex="0" role="region" aria-label="按钮状态矩阵，可横向滚动"><table class="kit-mx"><thead>${head}</thead><tbody>${rows}</tbody></table></div><p class="kit-scroll-hint">左右滑动查看八种状态</p><p class="kit-mx__note">「拖起」不适用于按钮，见知识卡的状态行；「选中」是切换按钮的 ${code('aria-pressed="true"')}。</p>`;
  const sizes = `<div class="kit-specimens"><div class="kit-spec"><div class="kit-spec__row">${button({ label: '小号', tone: 'primary', size: 'small' })}${button({ label: '默认', tone: 'primary' })}${button({ label: '大号', tone: 'primary', size: 'large' })}</div><p class="kit-spec__cap">${code('.small')} 32 · 默认 36 · ${code('.large')} 44</p></div>`
    + `<div class="kit-spec"><div class="kit-spec__row">${button({ label: '收藏', tone: 'secondary', iconOnly: true, icon: 'bookmark', size: 'small' })}${button({ label: '分享', tone: 'secondary', iconOnly: true, icon: 'share' })}${button({ label: '新建', tone: 'primary', iconOnly: true, icon: 'plus', size: 'large' })}${button({ label: '更多', tone: 'ghost', iconOnly: true, icon: 'more' })}</div><p class="kit-spec__cap">${code('.icon-only')} 方形，必须带 aria-label</p></div>`
    + `<div class="kit-spec"><div class="kit-spec__row">${button({ label: '新建知识点', tone: 'primary', icon: 'plus' })}${button({ label: '打开知识网', tone: 'secondary', trail: 'arrow' })}${button({ label: '只看已验证', tone: 'tonal', icon: 'filter' })}</div><p class="kit-spec__cap">图标在前表示动作，在后表示去向</p></div></div>`;
  const live = `<div class="kit-spec kit-spec--live"><div class="kit-spec__row">${button({ label: '保存', tone: 'primary', attrs: { 'data-kit-busy': '' } })}${button({ label: '撤回这条', tone: 'danger', icon: 'trash', attrs: { 'data-kit-toast': 'danger|已撤回。引用它的笔记会显示「原条目已撤回」。' } })}${button({ label: '关注这个簇', tone: 'secondary', pressed: false, attrs: { 'data-kit-toggle': '' } })}</div><p class="kit-spec__cap">真的按一下：保存会进入加载态且宽度不跳；关注是切换按钮（aria-pressed）。</p></div>`;
  return section(3, 'button', '五种语气，八种状态，一套外观',
    `按钮外观只在 ${code('app.css')} / ${code('studio.css')} 定义一次。下面每格都是真实的 ${code('.button')}，悬停、按下、聚焦用 ${code('data-state')} 强制呈现，和真实交互共用同一条规则。`,
    `<div class="kit-board kit-board--flush">${matrix}</div>` + sub('尺寸、图标、手感') + `<div class="kit-board">${sizes}${live}</div>`);
}

function inputSection() {
  const chipStates = ['default', 'hover', 'active', 'focus', 'selected', 'disabled'];
  const chips = `<div class="kit-statestrip">${chipStates.map(s => `<figure class="kit-cell"><div class="kit-cell__demo">${tag('Claude Code', '', { button: true, state: s })}</div><figcaption>${ST_LABEL[s]}</figcaption></figure>`).join('')}</div>`;
  const liveChips = `<div class="kit-chipgroup" role="group" aria-label="按工具筛选（示例）">${['Claude Code', 'Cursor', 'MCP', 'Dify', 'n8n', '本地模型'].map((t, i) => tag(t, '', { button: true, selected: i === 0 || i === 2, attrs: { 'data-kit-chip': '' } })).join('')}</div>`;
  const seg = segmented({ label: '按状态筛选', value: 'all', items: [{ value: 'all', label: '全部', count: 137 }, { value: 'verified', label: '已验证', count: 24 }, { value: 'disputed', label: '有争议', count: 2 }, { value: 'stale', label: '过期', count: 10 }] });
  const seg2 = segmented({ label: '视图', value: 'net', size: 'small', items: [{ value: 'net', label: '网' }, { value: 'list', label: '列表' }, { value: 'time', label: '时间' }] });
  const tb = tabs({ label: '知识点内容', items: [{ label: '做法', count: 3, panel: '把长任务拆成带检查点的小步，每步写进进度文件。' }, { label: '来路', count: 5, panel: '5 位群友各自说过同一件事，最早一条在 2026-05。' }, { label: '追问', count: 2, panel: '进度文件越写越长怎么办？→ 只留摘要和下一步。' }, { label: '已归档', disabled: true, panel: '' }] });
  const field = (st, label, o) => {
    o = o || {};
    const id = nextId('in');
    const forced = ['hover', 'focus'].includes(st) ? ` data-state="${esc(st)}"` : '';
    const ctl = o.textarea ? `<textarea id="${esc(id)}" rows="3"${forced} placeholder="${esc(o.ph || '')}">${esc(o.value || '')}</textarea>`
      : o.select ? `<select id="${esc(id)}"${forced}><option>让编程 Agent 跑得稳</option><option>给 Agent 接工具（MCP）</option></select>`
      : `<input id="${esc(id)}" type="text"${forced}${o.value ? ` value="${esc(o.value)}"` : ''} placeholder="${esc(o.ph || '一句话说清问题')}"${st === 'disabled' ? ' disabled' : ''}${st === 'error' ? ` aria-invalid="true" aria-describedby="${esc(id)}-e"` : ''}>`;
    const help = st === 'error' ? `<small class="field-error" id="${esc(id)}-e">标题至少 6 个字，现在只有 3 个。</small>` : (o.help ? `<small>${esc(o.help)}</small>` : '');
    return `<figure class="kit-cell kit-cell--field"><div class="field"><label for="${esc(id)}">${esc(label)}</label>${ctl}${help}</div><figcaption>${esc(o.cap || ST_LABEL[st] || st)}</figcaption></figure>`;
  };
  const fields = `<div class="kit-fields">${field('default', '标题')}${field('hover', '标题')}${field('focus', '标题', { value: '长任务中途断了' })}${field('filled', '标题', { value: '长任务中途断了怎么接着跑', cap: '已填' })}${field('disabled', '标题', { value: '由整理者锁定' })}${field('error', '标题', { value: '断了' })}${field('default', '背景', { textarea: true, ph: '在什么情况下遇到的', cap: '文本域' })}${field('default', '归入问题簇', { select: true, cap: '下拉选择', help: '找不到合适的簇就留空。' })}</div>`;
  const search = (st, cap, val) => `<figure class="kit-cell kit-cell--field"><label class="kit-search">${svg('search')}<span class="kit-sr">搜索知识点</span><input class="search-input" type="search" placeholder="搜知识点、工具、群友代号"${val ? ` value="${esc(val)}"` : ''}${['hover', 'focus'].includes(st) ? ` data-state="${esc(st)}"` : ''}${st === 'disabled' ? ' disabled' : ''}>${/* safe: kbd() 内部已 esc */ st === 'default' ? kbd('Cmd+K') : ''}</label><figcaption>${esc(cap)}</figcaption></figure>`;
  const searches = `<div class="kit-fields kit-fields--3">${search('default', '默认')}${search('focus', '聚焦', '进度文件')}${search('disabled', '禁用')}</div>`;
  return section(4, 'input', '选中是蓝色，指示块会跟过去',
    `选择片和标签外观归全局类。分段控件的滑块和标签页的下划线在切换时平移，用 spring 只动位移。方向键、Home、End 可以切换。`,
    sub('选择片', `${code('.chip')}，选中同时认 ${code('.selected')} 和 ${code('aria-pressed')}；下排可以真的点。`) + `<div class="kit-board">${chips}<div class="kit-divider"></div>${liveChips}</div>`
    + sub('标签', `${code('.pill')} 只做说明，不可点。`) + `<div class="kit-board"><div class="kit-wrap">${[['', '类型说明'], ['outline', '次要属性'], ['gray', '休息中'], ['notice', '有分歧'], ['dot', '进行中'], ['accent', '人的核对点'], ['agent', 'Agent 整理'], ['danger', '出错']].map(([t, l]) => `<span class="kit-pillspec"><span class="pill${t ? ' ' + t : ''}">${esc(l)}</span>${code(t ? '.' + t : '.pill')}</span>`).join('')}</div></div>`
    + `<div class="kit-split">${`<div class="kit-board">${sub('分段控件', '滑块用 transform 平移，宽度跟着变。')}<div class="kit-stack">${seg}${seg2}</div></div>`}${`<div class="kit-board">${sub('标签页', '下划线滑到选中项；禁用项不可达。')}${tb}</div>`}</div>`
    + sub('输入框', `外观归 ${code('.field')}；聚焦用 ${code('--ring')} 加蓝色描边，出错只说怎么改。`) + `<div class="kit-board">${fields}</div>`
    + sub('搜索框', code('.search-input')) + `<div class="kit-board">${searches}</div>`);
}

function feedbackSection() {
  const callouts = `<div class="kit-callouts">${callout('info', '什么是佐证', '几位群友各自独立说过同一件事，人数越多越可信。')}${callout('success', '已验证', '3 位群友照着做成了，步骤可以直接用。')}${callout('notice', '可能过期', '这条做法是 2026-05 的，工具可能已经更新，请先小范围试。')}${callout('danger', '撤回会断开引用', '引用这条的 4 篇笔记会显示「原条目已撤回」。')}</div>`;
  const toasts = `<div class="kit-toastdemo"><div class="kit-toastdemo__static">${toast('已复制链接。', 'success')}${toast('已加入待整理，整理者会看到。', 'info', { action: '撤销' })}</div><div class="kit-spec__row">${button({ label: '成功', tone: 'secondary', size: 'small', icon: 'check', attrs: { 'data-kit-toast': 'success|已保存到本机。' } })}${button({ label: '说明', tone: 'secondary', size: 'small', icon: 'info', attrs: { 'data-kit-toast': 'info|这条还没人验证过，请先小范围试。' } })}${button({ label: '提醒', tone: 'secondary', size: 'small', icon: 'clock', attrs: { 'data-kit-toast': 'notice|这条做法已经 5 个月没人更新了。' } })}${button({ label: '出错', tone: 'secondary', size: 'small', icon: 'alert', attrs: { 'data-kit-toast': 'danger|没保存上。内容还在页面里，可以再试一次。' } })}</div><p class="kit-spec__cap">从右下进场，4 秒后自己退场；悬停时暂停计时，最多叠 3 条。</p></div>`;
  const tipbar = `<div class="kit-tipbar" role="toolbar" aria-label="知识卡工具栏（示例）">${tooltip('收藏', '收藏到我的工作台', { icon: 'bookmark' })}${tooltip('引用', '插入到笔记里', { icon: 'quote' })}${tooltip('复制链接', '复制这条的链接', { icon: 'link' })}${tooltip('标记过期', '告诉整理者这条可能过期了', { icon: 'clock' })}${tooltip('更多', '更多操作', { icon: 'more' })}</div>`;
  const tips = `<div class="kit-tipdemo">${tipbar}<div class="kit-tiptimer"><p><span class="kit-tiptimer__dot"></span>第一次悬停：等 <b class="kit-num">400ms</b></p><p><span class="kit-tiptimer__dot kit-tiptimer__dot--warm"></span>之后相邻的：<b class="kit-num">立即</b>出现</p><p class="kit-spec__cap">移开超过 0.5 秒再回来，重新等待。键盘聚焦立即出现，Esc 收起。</p></div></div>`;
  const dr = `<div class="kit-drawerdemo"><div class="kit-drawerdemo__mock" aria-hidden="true"><span></span><span></span><span></span></div><div>${button({ label: '打开抽屉', tone: 'secondary', icon: 'arrow', attrs: { 'data-kit-open': 'kit-demo-drawer' } })}<p class="kit-spec__cap">抽屉从右侧进入，关闭后焦点返回。</p></div></div>`;
  return section(5, 'feedback', '反馈说清发生了什么、下一步做什么',
    '提示条常驻在内容里，轻提示自己会走。浮层提示有分组延迟：第一个要等，之后相邻的立即出现，像一排工具一起醒来。',
    sub('提示条', '四种语义；图标和颜色同时表达，不只靠颜色。') + callouts
    + `<div class="kit-split">${`<div class="kit-board">${sub('轻提示', '可以触发。')}${toasts}</div>`}${`<div class="kit-board">${sub('浮层提示', '悬停下面这排工具，从左扫到右。')}${tips}</div>`}</div>`
    + sub('抽屉') + `<div class="kit-board">${dr}</div>`);
}

function sampleUnits() {
  const all = ((K() && K().units) || []);
  const want = ['ku004', 'ku008', 'ku002'];
  const found = want.map(id => all.find(u => u.id === id)).filter(Boolean);
  for (const u of all) { if (found.length >= 3) break; if (!found.includes(u)) found.push(u); }
  return found;
}
function sampleEvents() {
  const chain = ((!isLive() && W.COMMONS_UI_KIT_SAMPLE && W.COMMONS_UI_KIT_SAMPLE.chain) || []).map(unitById).filter(Boolean);
  if (chain.length >= 2) return chain.map(u => ({ month: u.month, label: u.title, status: u.status }));
  return [{ month: '2026-05', label: '有人提出问题', status: 'candidate' }, { month: '2026-06', label: '整理出做法', status: 'curated' }, { month: '2026-08', label: '被另一位群友验证', status: 'verified' }];
}

function stateIconBlock() {
  const I = W.CommonsIcons;
  if (!I || typeof I.svg !== 'function') return `${sub('状态图标')}<p class="kit-note">图标库 ${code('CommonsIcons')} 没有加载。</p>`;
  const meta = typeof I.list === 'function' ? I.list() : [];
  const label = n => (meta.find(m => m.name === n) || {}).label || n;
  const cells = STATE_ICONS.map(n => `<figure class="kit-cell kit-sicon"><div class="kit-sicon__tile">${I.svg(n, { size: 20 })}</div><figcaption><span class="kit-sicon__zh">${esc(label(n))}</span><span class="kit-sicon__en">${esc(n)}</span></figcaption></figure>`).join('');
  return `<div class="kit-board__bar"><span>状态图标 · 20px</span><a class="kit-textlink" href="#/icons">全部 ${meta.length || 37} 个 →</a></div>`
    + `<p class="kit-sub__note">线条跟随 ${code('currentColor')}，辅面用 ${code('--icon-tint')}。状态徽章里的图形也来自这一套。</p><div class="kit-sicons">${cells}</div>`;
}

function knowledgeSection() {
  const [u1, u2, u3] = sampleUnits();
  const badges = `<div class="kit-wrap">${Object.keys(STATUS).map(statusBadge).join('')}</div>`;
  const kinds = `<div class="kit-wrap">${Object.keys(KIND).map(k => kindTag(k)).join('')}</div>`;
  const rels = `<div class="kit-rels">${Object.keys(REL).map(r => `<div class="kit-relrow">${relTag(r)}<svg class="kit-relline kit-relline--${r}" viewBox="0 0 96 12" aria-hidden="true" focusable="false"><path d="M4 6h84"/>${r === 'follows' ? '<path class="h" d="M84 2l5 4-5 4"/>' : ''}</svg><span class="kit-relrow__note">${esc(REL[r].line)}</span></div>`).join('')}</div>`;
  const provs = [u1, u2].filter(Boolean).map(u => `<div class="kit-provrow">${provenance(u)}</div>`).join('') || '<p class="kit-note">样例数据未加载。</p>';
  const cards = `<div class="kit-kcs"><div class="kit-kcs__col">${sub('紧凑', '列表、搜索结果、知识网悬停预览。整张可点，悬停上浮。')}${knowledgeCard(u1, 'compact', { demo: true, attrs: { 'data-kit-open': 'kit-demo-drawer' } })}${knowledgeCard(u3, 'compact', { demo: true, attrs: { 'data-kit-open': 'kit-demo-drawer' } })}${sub('嵌入', '引用在笔记、文章里。')}${knowledgeCard(u2, 'embed', { demo: true })}</div><div class="kit-kcs__col">${sub('完整', '详情页、抽屉。')}${knowledgeCard(u1, 'full', { demo: true })}</div></div>`;
  const kcStates = `<div class="kit-statestrip kit-statestrip--cards">${['default', 'hover', 'active', 'focus', 'selected', 'drag'].map(s => `<figure class="kit-cell"><div class="kit-cell__demo">${knowledgeCard(u3, 'compact', { demo: true, state: s, selected: s === 'selected', attrs: { tabindex: '-1' } })}</div><figcaption>${ST_LABEL[s]}</figcaption></figure>`).join('')}</div>`;
  return section(6, 'knowledge', '每条知识都带着它的来路',
    `知识组件没有全局类，由这里定义。类型用填充形状，状态用图形加颜色，关系用图标和线型；分类色来自问题簇。知识网按同一套样式对齐。卡片数据来自 ${code('COMMONS_KNOWLEDGE')} 合成样例。`,
    `<div class="kit-split kit-split--3"><div class="kit-board">${sub('状态徽章')}${badges}</div><div class="kit-board">${sub('类型形状')}${kinds}</div><div class="kit-board">${sub('关系标签与线型')}${rels}</div></div>`
    + `<div class="kit-board kit-board--icons">${stateIconBlock()}</div>`
    + `<div class="kit-split"><div class="kit-board">${sub('来路条', '簇 · 月份 · 佐证人数 · 贡献者代号')}${provs}</div><div class="kit-board">${sub('迷你时间线', '同一个问题从提出、解答、被推翻到对账的过程')}${miniTimeline(sampleEvents())}</div></div>`
    + sub('知识卡三型') + cards + sub('紧凑卡的状态') + `<div class="kit-scroll" tabindex="0" role="region" aria-label="知识卡状态，可横向滚动">${kcStates}</div>`);
}

function statesSection() {
  const [u1] = sampleUnits();
  const skel = `<div class="kit-pstate"><div class="kit-pstate__bar"><span>加载</span>${button({ label: '看加载完成', tone: 'ghost', size: 'small', icon: 'replay', attrs: { 'data-kit-reload': '' } })}</div><div class="kit-pstate__body" data-kit-loadbox>${skeleton(3)}<div class="kit-loadbox__done" hidden>${u1 ? knowledgeCard(u1, 'compact', { demo: true, attrs: { tabindex: '-1' } }) : ''}</div></div></div>`;
  const emp = `<div class="kit-pstate"><div class="kit-pstate__bar"><span>空</span></div><div class="kit-pstate__body">${pageState('empty', { title: '这个问题簇还没有知识点', body: '群里有人讨论之后，这里会自动出现。也可以先提一个问题。', action: { label: '提一个问题', icon: 'plus', tone: 'tonal' } })}</div></div>`;
  const err = `<div class="kit-pstate"><div class="kit-pstate__bar"><span>出错</span></div><div class="kit-pstate__body">${pageState('error', { title: '知识网没加载出来', body: '原数据没有动。可能是本机存储暂时不可用，再试一次通常就好。', action: { label: '重试', icon: 'replay', attrs: { 'data-kit-busy': 'retry' } } })}</div></div>`;
  const den = `<div class="kit-pstate"><div class="kit-pstate__bar"><span>无权限</span></div><div class="kit-pstate__body">${pageState('denied', { title: '这个簇只对整理者开放', body: '可以先看公开的知识点，或者申请成为整理者。', action: { label: '申请整理权限', tone: 'secondary' } })}</div></div>`;
  return section(7, 'states', '空和出错，也要说下一步',
    '每个模块负责自己的四种页面态。骨架屏的微光只在加载时扫过，开了「减少动态效果」就静止。插图是冷色线稿，安静，不抢内容。',
    `<div class="kit-pstates">${skel}${emp}${err}${den}</div>`);
}

function motionSection() {
  const curvePlot = c => `<svg class="kit-curve" viewBox="-6 -26 112 132" aria-hidden="true" focusable="false"><path class="kit-curve__grid" d="M0 0H100M0 100H100M0 0V100M100 0V100"/><path class="kit-curve__path" data-kit-curve="--ease-${esc(c)}" d=""/></svg>`;
  const lane = (kind, name, label, dur, ease) => `<div class="kit-lane" data-kit-lane data-dur="${esc(dur)}" data-ease="${esc(ease)}"><div class="kit-lane__meta">${code(name)}<span class="kit-num" data-kit-val="${esc(kind === 'dur' ? name : '')}"></span><span class="kit-lane__use">${esc(label)}</span></div><div class="kit-lane__track"><span class="kit-lane__puck" aria-hidden="true"></span></div>${button({ label: `重播 ${name}`, tone: 'ghost', size: 'small', iconOnly: true, icon: 'replay', attrs: { 'data-kit-replay': '' } })}</div>`;
  const durs = DURATIONS.map(([d, use]) => lane('dur', `--motion-${d}`, use, `--motion-${d}`, '--ease-out')).join('');
  const curves = CURVES.map(([c, use]) => `<div class="kit-curvecard">${curvePlot(c)}${lane('ease', `--ease-${c}`, use, '--motion-stage', `--ease-${c}`)}</div>`).join('');
  const roll = `<div class="kit-roll"><div class="kit-roll__num"><span class="kit-num" data-kit-roll="137">137</span><span class="kit-roll__unit">条知识点</span></div>${segmented({ label: '数字滚动数据', value: '137', attrs: { 'data-kit-rollseg': '' }, items: [{ value: '137', label: '全部' }, { value: '24', label: '已验证' }, { value: '1284', label: '累计提问' }] })}<p class="kit-spec__cap">只在首次进入视口或数据切换时滚动一次，用 ${code('--motion-stage')} 和 ${code('--ease-out')}。等宽数位让宽度不跳。</p></div>`;
  return section(8, 'motion', '只在状态变了的时候动',
    `时长五档，曲线四条。每条都能点「重播」。spring 只用在位移上，不用在宽度和颜色上；开了「减少动态效果」，位移和缩放归零，只留透明度。`,
    `<div class="kit-board"><div class="kit-board__bar"><span>时长五档 · 同一条曲线</span>${button({ label: '全部重播', tone: 'secondary', size: 'small', icon: 'replay', attrs: { 'data-kit-replay-all': 'dur' } })}</div><div class="kit-lanes" data-kit-lanes="dur">${durs}</div></div>`
    + `<div class="kit-board"><div class="kit-board__bar"><span>曲线四条 · 同一个时长 ${code('--motion-stage')}</span>${button({ label: '全部重播', tone: 'secondary', size: 'small', icon: 'replay', attrs: { 'data-kit-replay-all': 'ease' } })}</div><div class="kit-curves" data-kit-lanes="ease">${curves}</div></div>`
    + sub('数字滚动') + `<div class="kit-board">${roll}</div>`);
}

function layoutSection() {
  const k = K();
  const all = (k && k.units) || [];
  const rowsData = ((!isLive() && W.COMMONS_UI_KIT_SAMPLE && W.COMMONS_UI_KIT_SAMPLE.rows) || []).map(unitById).filter(Boolean);
  const list = `<ul class="kit-list">${rowsData.map(u => `<li class="kit-list__row"><span class="kit-list__glyph" style="--c:${catVar(u.cluster)}">${kindGlyph(u.kind)}</span><div class="kit-list__main"><p class="kit-list__title">${esc(u.title)}</p>${provenance(u)}</div>${statusBadge(u.status)}${button({ label: '打开', tone: 'ghost', size: 'small', trail: 'arrow', attrs: { 'data-kit-open': 'kit-demo-drawer' } })}</li>`).join('')}</ul>`;
  const kv = `<dl class="kit-kv">${[['佐证', '几位群友各自独立说过同一件事', '≥ 3 人才进「已整理」'], ['把握', '整理者对结论的信心', '0–100%，低于 50% 标灰'], ['状态', '候选 → 已整理 → 已验证', '过期、有争议随时可能出现'], ['来路', '簇 · 月份 · 贡献者代号', '不出现真实昵称'], ['示例', '合成样例数据', '真实聚合挂「真实记录 · 匿名聚合」']].map(([a, b, c]) => `<div class="kit-kv__row"><dt>${esc(a)}</dt><dd><span>${esc(b)}</span><span class="kit-kv__rule">${esc(c)}</span></dd></div>`).join('')}</dl>`;
  const c01 = all.filter(u => u.cluster === 'c01');
  const xs = c01.map(u => u.xy[0]), ys = c01.map(u => u.xy[1]);
  const [x0, x1, y0, y1] = c01.length ? [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)] : [0, 1, 0, 1];
  const pos = u => [8 + ((u.xy[0] - x0) / ((x1 - x0) || 1)) * 84, 12 + ((u.xy[1] - y0) / ((y1 - y0) || 1)) * 76];
  const P = Object.fromEntries(c01.map(u => [u.id, pos(u)]));
  const sel0id = (c01.find(u => u.id === 'ku004') || c01[0] || {}).id;
  const edges = c01.flatMap(u => (u.links || []).filter(l => P[l.to]).map(l => `<path class="kit-edge kit-edge--${esc(l.rel)}${u.id === sel0id || l.to === sel0id ? ' on' : ''}" data-a="${esc(u.id)}" data-b="${esc(l.to)}" d="M${P[u.id][0].toFixed(1)} ${P[u.id][1].toFixed(1)}L${P[l.to][0].toFixed(1)} ${P[l.to][1].toFixed(1)}"/>`)).join('');
  const sel0 = c01.find(u => u.id === 'ku004') || c01[0];
  const nodes = c01.map(u => `<button type="button" class="kit-node kit-node--${esc(u.status)}" style="left:${P[u.id][0].toFixed(1)}%;top:${P[u.id][1].toFixed(1)}%" data-kit-node="${esc(u.id)}" aria-pressed="${u === sel0}" tabindex="${u === sel0 ? 0 : -1}" aria-label="${esc(u.title)}（${esc((KIND[u.kind] || KIND.question).zh)}，${esc((STATUS[u.status] || STATUS.candidate).zh)}）">${kindGlyph(u.kind)}</button>`).join('');
  const stage = c01.length ? `<div class="kit-md"><div class="kit-md__stage" style="--c:var(--cat-1)"><p class="kit-md__label"><i aria-hidden="true"></i>${esc(clusterLabel('c01'))}<span class="kit-num">${c01.length} 条</span>${demoMark()}</p><svg class="kit-md__edges" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">${edges}</svg><div class="kit-md__nodes" role="group" aria-label="问题簇里的知识点，方向键切换">${nodes}</div></div><div class="kit-md__detail" data-kit-detail aria-live="polite">${knowledgeCard(sel0, 'full', { demo: true })}</div></div>` : '<p class="kit-note">样例数据未加载。</p>';
  return section(9, 'layout', '新页面先照这三种排',
    '一屏一个焦点：舞台是主，卡片是从；其余内容靠字重和灰度退后，不靠缩小字号。',
    `<div class="kit-split"><div class="kit-board">${sub('列表行', '标题 · 来路条 · 状态 · 动作')}${list}</div><div class="kit-board">${sub('键值', '口径表：名词、意思、规则')}${kv}</div></div>`
    + sub('舞台 + 知识卡（主从）', '点舞台里的点，右侧卡片跟着换；选中用墨色描边加光晕，不靠蓝色。') + `<div class="kit-board kit-board--flush">${stage}</div>`);
}

function catalog() {
  uid = 0;
  const [u1] = sampleUnits();
  const toc = `<nav class="kit-toc" aria-label="规范页目录"><p class="kit-toc__title">目录</p><ol class="kit-toc__list"><li class="kit-toc__ind" aria-hidden="true"></li>${SECTIONS.map(([id, t], i) => `<li><a class="kit-toc__link" href="#kit-s-${id}" data-kit-anchor="${id}"><span class="kit-num">${pad2(i + 1)}</span>${esc(t)}</a></li>`).join('')}</ol></nav>`;
  const stats = [[COMPONENTS.length, '个组件'], [STATES.length + PAGE_STATES.length, '种状态'], [TOKEN_COUNT, '个令牌']];
  const legend = [['accent', '蓝', '人做的事 · 选中'], ['agent', '青', 'Agent · 知识'], ['notice', '紫', '判断 · 教学'], ['cat-2', '分类', '图形与识别']];
  const art = u1 ? `<div class="kit-hero__art" aria-hidden="true" inert><div class="kit-art__seg">${segmented({ label: '示意', value: 'v', size: 'small', items: [{ value: 'a', label: '全部' }, { value: 'v', label: '已验证' }, { value: 'd', label: '有争议' }] })}</div><div class="kit-art__card">${knowledgeCard(u1, 'compact', { demo: true, attrs: { tabindex: '-1' } })}</div><div class="kit-art__acts">${tag('Claude Code', '', { button: true, selected: true })}${button({ label: '引用到笔记', tone: 'primary', icon: 'quote', size: 'small' })}</div></div>` : '';
  const head = `<header class="kit-hero"><div class="kit-hero__text"><p class="kit-eyebrow">v2 · 活的规范页</p><h1 class="kit-hero__title"><span>同一种东西，</span><span>全站只有一种长相</span></h1><p class="kit-hero__lede">组件直接使用全站设计变量。</p><div class="kit-hero__stats">${stats.map(([n, l]) => `<p class="kit-stat"><span class="kit-stat__n kit-num" data-kit-count="${esc(n)}">${esc(n)}</span><span class="kit-stat__l">${esc(l)}</span></p>`).join('')}</div><ul class="kit-hero__legend" aria-label="色彩职责">${legend.map(([v, n, d]) => `<li style="--sw:var(--${v})"><i aria-hidden="true"></i><b>${n}</b>${d}</li>`).join('')}</ul></div>${art}</header>`;
  const body = colorSection() + typeSection() + spaceSection() + buttonSection() + inputSection() + feedbackSection() + knowledgeSection() + statesSection() + motionSection() + layoutSection();
  const drawerHtml = drawer({ id: 'kit-demo-drawer', eyebrow: '知识点详情 · 示例', title: u1 ? u1.title : '知识点详情', bodyHtml: u1 ? knowledgeCard(u1, 'full', { demo: true }) : '<p>样例数据未加载。</p>', footHtml: button({ label: '关闭', tone: 'secondary', attrs: { 'data-kit-close': '' } }) + button({ label: '引用到笔记', tone: 'primary', icon: 'quote', attrs: { 'data-kit-toast': 'success|已引用到笔记。', 'data-kit-close': '' } }) });
  return `<div class="kit-page" data-kit-root>${toc}<div class="kit-main">${head}${body}</div>${drawerHtml}<div class="kit-toaster" data-kit-toaster aria-live="polite"></div><div class="kit-tipfloat" role="tooltip" id="kit-tipfloat" hidden></div></div>`;
}

/* ---------- interactivity ---------- */
let M = null;
const reduced = () => { try { return !!(W.matchMedia && W.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch { return false; } };
const cssVar = name => { try { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); } catch { return ''; } };
const ms = name => { const v = cssVar(name); const n = parseFloat(v); return Number.isFinite(n) ? (/ms$/.test(v) ? n : (/s$/.test(v) ? n * 1000 : n)) : 0; };
const later = (fn, t) => { if (!M) return 0; const id = setTimeout(() => { if (M) M.timers.delete(id); fn(); }, t); M.timers.add(id); return id; };
const clearLater = id => { if (id && M) { clearTimeout(id); M.timers.delete(id); } };
const frame = fn => { if (!M) return 0; const id = requestAnimationFrame(t => { if (M) M.frames.delete(id); fn(t); }); M.frames.add(id); return id; };
const fmt = n => Math.round(n).toLocaleString('en-US');
const easeOut = t => 1 - Math.pow(1 - t, 4);

function fillValues(r) {
  r.querySelectorAll('[data-kit-val]').forEach(el => { const n = el.getAttribute('data-kit-val'); if (n) el.textContent = cssVar(n).replace(/\s+/g, ' '); });
  r.querySelectorAll('[data-kit-type]').forEach(el => { const t = el.getAttribute('data-kit-type'); el.textContent = `${parseFloat(cssVar('--text-' + t)) || ''} / ${parseFloat(cssVar('--leading-' + t)) || ''}`; });
  r.querySelectorAll('[data-kit-curve]').forEach(el => el.setAttribute('d', curvePath(cssVar(el.getAttribute('data-kit-curve')))));
}
function curvePath(v) {
  const cb = /cubic-bezier\(([^)]+)\)/.exec(v);
  if (cb) { const [a, b, c, d] = cb[1].split(',').map(Number); return `M0 100C${a * 100} ${100 - b * 100} ${c * 100} ${100 - d * 100} 100 0`; }
  const lin = /linear\(([^)]*)\)/.exec(v);
  if (lin) {
    const raw = lin[1].split(',').map(s => s.trim().split(/\s+/));
    const pts = raw.map(p => ({ y: parseFloat(p[0]), x: p[1] !== undefined ? parseFloat(p[1]) / 100 : null }));
    if (pts.length) { pts[0].x = pts[0].x ?? 0; pts[pts.length - 1].x = pts[pts.length - 1].x ?? 1; }
    for (let i = 1; i < pts.length - 1; i++) if (pts[i].x === null) { let j = i; while (pts[j].x === null) j++; const a = pts[i - 1].x, b = pts[j].x; for (let q = i; q < j; q++) pts[q].x = a + (b - a) * (q - i + 1) / (j - i + 1); }
    return 'M' + pts.map(p => `${(p.x * 100).toFixed(1)} ${(100 - p.y * 100).toFixed(1)}`).join('L');
  }
  return 'M0 100L100 0';
}

function placeIndicator(group, item, ind, vertical) {
  if (!group || !item || !ind) return;
  const g = group.getBoundingClientRect(), b = item.getBoundingClientRect();
  if (vertical) { ind.style.setProperty('--y', `${b.top - g.top}px`); ind.style.setProperty('--h', `${b.height}px`); }
  else { ind.style.setProperty('--x', `${b.left - g.left + group.scrollLeft}px`); ind.style.setProperty('--w', `${b.width}px`); }
}
function syncIndicators(r) {
  r.querySelectorAll('.kit-seg').forEach(s => placeIndicator(s, s.querySelector('[aria-checked="true"]'), s.querySelector('.kit-seg__thumb')));
  r.querySelectorAll('.kit-tabs__list').forEach(s => placeIndicator(s, s.querySelector('[aria-selected="true"]'), s.querySelector('.kit-tabs__ink')));
  const toc = r.querySelector('.kit-toc__list');
  if (toc) moveTocBar(toc, toc.querySelector('[aria-current="true"]'), false);
}

function selectIn(item) {
  const group = item.parentElement;
  if (item.classList.contains('kit-seg__item')) {
    group.querySelectorAll('.kit-seg__item').forEach(x => { const on = x === item; x.setAttribute('aria-checked', String(on)); x.tabIndex = on ? 0 : -1; });
    placeIndicator(group, item, group.querySelector('.kit-seg__thumb'));
    if (group.hasAttribute('data-kit-rollseg')) { const num = M.root.querySelector('[data-kit-roll]'); if (num) roll(num, Number(item.getAttribute('data-value'))); }
  } else if (item.classList.contains('kit-tabs__tab')) {
    group.querySelectorAll('.kit-tabs__tab').forEach(x => { const on = x === item; x.setAttribute('aria-selected', String(on)); x.tabIndex = on ? 0 : -1; });
    const scope = group.closest('.kit-tabs');
    scope.querySelectorAll('.kit-tabs__panel').forEach(p => { p.hidden = p.getAttribute('aria-labelledby') !== item.id; });
    placeIndicator(group, item, group.querySelector('.kit-tabs__ink'));
  } else if (item.classList.contains('kit-node')) {
    group.querySelectorAll('.kit-node').forEach(x => { const on = x === item; x.setAttribute('aria-pressed', String(on)); x.tabIndex = on ? 0 : -1; });
    const detail = M.root.querySelector('[data-kit-detail]');
    const u = unitById(item.getAttribute('data-kit-node'));
    const id = item.getAttribute('data-kit-node');
    const stage = group.closest('.kit-md__stage');
    if (stage) stage.querySelectorAll('.kit-edge').forEach(e => e.classList.toggle('on', e.getAttribute('data-a') === id || e.getAttribute('data-b') === id));
    if (detail && u) { detail.innerHTML = knowledgeCard(u, 'full', { demo: true }); detail.removeAttribute('data-enter'); void detail.offsetWidth; detail.setAttribute('data-enter', ''); }
  }
}

function roll(el, to, start0) {
  const from = start0 !== undefined ? start0 : (Number(String(el.textContent).replace(/[^\d.]/g, '')) || 0);
  if (M.rolls.has(el)) { cancelAnimationFrame(M.rolls.get(el)); M.frames.delete(M.rolls.get(el)); }
  if (reduced() || from === to) { el.textContent = fmt(to); return; }
  const dur = ms('--motion-stage') || 480;
  let start = 0;
  const step = t => {
    if (!M) return;
    if (!start) start = t;
    const p = Math.min(1, (t - start) / dur);
    el.textContent = fmt(from + (to - from) * easeOut(p));
    if (p < 1) M.rolls.set(el, frame(step)); else M.rolls.delete(el);
  };
  M.rolls.set(el, frame(step));
}

function pushToast(spec) {
  const host = M.root.querySelector('[data-kit-toaster]');
  if (!host) return;
  const [tone, text] = String(spec).split('|');
  const wrap = document.createElement('div');
  wrap.innerHTML = toast(text || tone, text ? tone : 'info');
  const node = wrap.firstChild;
  host.appendChild(node);
  while (host.children.length > 3) host.removeChild(host.firstChild);
  void node.offsetWidth;
  node.setAttribute('data-in', '');
  const arm = () => { node._t = later(() => dropToast(node), 4000); };
  node.addEventListener('pointerenter', () => clearLater(node._t));
  node.addEventListener('pointerleave', arm);
  arm();
}
function dropToast(node) {
  if (!node || !node.parentNode || node.hasAttribute('data-out')) return;
  clearLater(node._t);
  node.setAttribute('data-out', '');
  later(() => node.remove(), reduced() ? 0 : ms('--motion-exit') + 40);
}

function copyName(btn) {
  const name = btn.getAttribute('data-kit-copy');
  const done = ok => {
    btn.setAttribute('data-copied', '');
    later(() => btn.removeAttribute('data-copied'), 1200);
    pushToast(ok ? `success|已复制 ${name}` : `info|已选中 ${name}，按 ⌘C 复制`);
  };
  const fallback = () => {
    try {
      const target = btn.querySelector('.kit-sw__name, span:last-child') || btn;
      const range = document.createRange(); range.selectNodeContents(target);
      const sel = W.getSelection(); sel.removeAllRanges(); sel.addRange(range);
      if (document.execCommand && document.execCommand('copy')) { sel.removeAllRanges(); done(true); return; }
    } catch { /* selection unsupported */ }
    done(false);
  };
  try {
    if (W.navigator && navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(name).then(() => { if (M) done(true); }, () => { if (M) fallback(); });
    else fallback();
  } catch { fallback(); }
}

function showTip(trigger, instant) {
  const tip = M.root.querySelector('#kit-tipfloat');
  if (!tip) return;
  tip.textContent = trigger.getAttribute('data-kit-tip');
  tip.hidden = false;
  if (instant) tip.setAttribute('data-instant', ''); else tip.removeAttribute('data-instant');
  const b = trigger.getBoundingClientRect(), t = tip.getBoundingClientRect();
  const x = Math.max(8, Math.min(W.innerWidth - t.width - 8, b.left + b.width / 2 - t.width / 2));
  const above = b.top - t.height - 10 > 72;
  tip.style.left = `${x}px`;
  tip.style.top = `${above ? b.top - t.height - 8 : b.bottom + 8}px`;
  tip.setAttribute('data-side', above ? 'top' : 'bottom');
  trigger.setAttribute('aria-describedby', 'kit-tipfloat');
  M.tipFor = trigger;
  void tip.offsetWidth;
  tip.setAttribute('data-show', '');
}
function hideTip() {
  clearLater(M.tipWait);
  M.tipWait = 0;
  M.tipPending = null;
  const tip = M.root.querySelector('#kit-tipfloat');
  if (M.tipFor) { M.tipFor.removeAttribute('aria-describedby'); M.warmUntil = Date.now() + 500; }
  M.tipFor = null;
  if (tip) { tip.removeAttribute('data-show'); tip.hidden = true; }
}
function requestTip(trigger, viaKeyboard) {
  if (M.tipFor === trigger || (M.tipPending === trigger && !viaKeyboard)) return;
  clearLater(M.tipWait);
  M.tipPending = null;
  const warm = !!M.tipFor || Date.now() < M.warmUntil || viaKeyboard;
  if (M.tipFor) { M.tipFor.removeAttribute('aria-describedby'); M.tipFor = null; }
  if (warm) showTip(trigger, true);
  else { hideTip(); M.tipPending = trigger; M.tipWait = later(() => { M.tipPending = null; showTip(trigger, false); }, 400); }
}

function openDrawer(id, opener) {
  const d = M.root.querySelector('#' + id);
  if (!d) return;
  M.opener = opener || document.activeElement;
  clearLater(M.drawerT);
  d.hidden = false;
  d.removeAttribute('data-closing');
  void d.offsetWidth;
  d.setAttribute('data-open', '');
  const p = d.querySelector('.kit-drawer__panel');
  if (p) p.focus({ preventScroll: true });
  M.drawer = d;
}
function closeDrawer() {
  const d = M.drawer;
  if (!d) return;
  M.drawer = null;
  d.setAttribute('data-closing', '');
  d.removeAttribute('data-open');
  const done = () => { d.hidden = true; d.removeAttribute('data-closing'); };
  if (reduced()) done(); else M.drawerT = later(done, ms('--motion-exit') + 60);
  if (M.opener && M.opener.focus) { try { M.opener.focus({ preventScroll: true }); } catch { /* gone */ } }
  M.opener = null;
}

function replayLane(lane) {
  const puck = lane.querySelector('.kit-lane__puck');
  const track = lane.querySelector('.kit-lane__track');
  if (!puck || !track || !puck.animate) return;
  const padX = parseFloat(getComputedStyle(track).paddingLeft) || 0;
  const dist = Math.max(0, track.clientWidth - puck.offsetWidth - padX * 2);
  const dur = ms(lane.getAttribute('data-dur')) || 240;
  const ease = cssVar(lane.getAttribute('data-ease')) || 'ease-out';
  if (lane._anim) lane._anim.cancel();
  const frames = reduced() ? [{ opacity: 0.2 }, { opacity: 1 }] : [{ transform: 'translateX(0)' }, { transform: `translateX(${dist}px)` }];
  try { lane._anim = puck.animate(frames, { duration: dur, easing: ease, fill: 'forwards' }); }
  catch { lane._anim = puck.animate(frames, { duration: dur, easing: 'ease-out', fill: 'forwards' }); }
  M.anims.add(lane._anim);
  lane.setAttribute('data-played', '');
}

function reloadDemo(btn) {
  const box = M.root.querySelector('[data-kit-loadbox]');
  if (!box) return;
  const sk = box.querySelector('.kit-skel'), done = box.querySelector('.kit-loadbox__done');
  const label = btn.querySelector('span');
  if (!sk || !done) return;
  const reveal = () => { clearLater(M.loadT); sk.hidden = true; done.hidden = false; done.removeAttribute('data-enter'); void done.offsetWidth; done.setAttribute('data-enter', ''); if (label) label.textContent = '再加载一次'; };
  if (!sk.hidden) { reveal(); return; }
  done.hidden = true; sk.hidden = false;
  if (label) label.textContent = '跳过加载';
  M.loadT = later(reveal, 1600);
}

function busy(btn) {
  if (btn.getAttribute('aria-busy') === 'true') return;
  const label = btn.querySelector('span:not(.button-spinner)');
  const old = label ? label.textContent : '';
  const icon = btn.querySelector('svg');
  btn.style.minWidth = `${btn.getBoundingClientRect().width}px`;
  btn.setAttribute('aria-busy', 'true');
  if (icon) icon.hidden = true;
  btn.insertAdjacentHTML('afterbegin', '<span class="button-spinner" aria-hidden="true"></span>');
  if (label) label.textContent = btn.getAttribute('data-kit-busy') === 'retry' ? '重试中' : '保存中';
  later(() => {
    btn.removeAttribute('aria-busy');
    const sp = btn.querySelector('.button-spinner'); if (sp) sp.remove();
    if (icon) icon.hidden = false;
    if (label) label.textContent = old;
    btn.style.minWidth = '';
    pushToast(btn.getAttribute('data-kit-busy') === 'retry' ? 'success|加载好了。' : 'success|已保存到本机。');
  }, 1400);
}

/* 目录高亮：文字（aria-current）和指示条只从这里改，同一个来源。
   滚动驱动时指示条直接贴到位（不走过渡），只有点目录这种用户动作才用 spring 滑过去。 */
function moveTocBar(toc, cur, animate) {
  const ind = toc && toc.querySelector('.kit-toc__ind');
  if (!ind || !cur) return;
  if (!animate) ind.setAttribute('data-snap', '');
  placeIndicator(toc, cur, ind, !M.tocInline);
  if (!animate) { void ind.offsetWidth; ind.removeAttribute('data-snap'); }
}
function setActiveToc(id, animate, force) {
  if (!M) return;
  const toc = M.root.querySelector('.kit-toc__list');
  if (!toc) return;
  const changed = M.activeSec !== id;
  if (!changed && !force) return;
  M.activeSec = id;
  let cur = null;
  toc.querySelectorAll('.kit-toc__link').forEach(a => { const on = a.getAttribute('data-kit-anchor') === id; if (on) { a.setAttribute('aria-current', 'true'); cur = a; } else a.removeAttribute('aria-current'); });
  if (!cur) return;
  moveTocBar(toc, cur, !!animate);
  if (M.tocInline && changed) { const left = cur.offsetLeft - (toc.clientWidth - cur.offsetWidth) / 2; toc.scrollTo({ left: Math.max(0, left), behavior: reduced() ? 'auto' : 'smooth' }); }
}

function mount(root) {
  destroy();
  const r = root && root.querySelector ? (root.querySelector('[data-kit-root]') || root) : (typeof document !== 'undefined' ? document.querySelector('[data-kit-root]') : null);
  if (!r || !r.addEventListener) return false;
  M = { root: r, off: [], timers: new Set(), frames: new Set(), anims: new Set(), rolls: new Map(), observers: [], opener: null, drawer: null, tipFor: null, tipWait: 0, warmUntil: 0, activeSec: '', tocInline: false, spyLock: 0, spyAt: 0, spyY: 0 };
  const on = (target, type, fn, opt) => { target.addEventListener(type, fn, opt); M.off.push(() => target.removeEventListener(type, fn, opt)); };
  const near = (e, sel) => (e.target && e.target.closest ? e.target.closest(sel) : null);
  const mq = W.matchMedia ? W.matchMedia('(max-width: 1179px)') : null;
  M.tocInline = !!(mq && mq.matches);

  fillValues(r);
  syncIndicators(r);
  void r.offsetWidth;
  r.setAttribute('data-ready', '');

  on(r, 'click', e => {
    const copy = near(e, '[data-kit-copy]');
    if (copy) { copyName(copy); return; }
    const seg = near(e, '.kit-seg__item, .kit-tabs__tab, .kit-node');
    if (seg) { if (seg.getAttribute('aria-disabled') !== 'true') selectIn(seg); return; }
    const chip = near(e, '[data-kit-chip]');
    if (chip) { const on2 = chip.getAttribute('aria-pressed') !== 'true'; chip.setAttribute('aria-pressed', String(on2)); chip.classList.toggle('selected', on2); return; }
    const tog = near(e, '[data-kit-toggle]');
    if (tog) { const on2 = tog.getAttribute('aria-pressed') !== 'true'; tog.setAttribute('aria-pressed', String(on2)); const s = tog.querySelector('span'); if (s) s.textContent = on2 ? '已关注' : '关注这个簇'; return; }
    const bz = near(e, '[data-kit-busy]');
    if (bz) { busy(bz); return; }
    const op = near(e, '[data-kit-open]');
    if (op && !op.disabled) { openDrawer(op.getAttribute('data-kit-open'), op); return; }
    const ts = near(e, '[data-kit-toast]');
    if (ts) { pushToast(ts.getAttribute('data-kit-toast')); if (ts.hasAttribute('data-kit-close')) closeDrawer(); return; }
    if (near(e, '[data-kit-close]')) { closeDrawer(); return; }
    const dis = near(e, '[data-kit-dismiss]');
    if (dis) { const t = dis.closest('.kit-toast'); if (t && t.parentNode && t.parentNode.hasAttribute('data-kit-toaster')) dropToast(t); else if (t) t.remove(); return; }
    const rp = near(e, '[data-kit-replay]');
    if (rp) { replayLane(rp.closest('[data-kit-lane]')); return; }
    const ra = near(e, '[data-kit-replay-all]');
    if (ra) { const box = r.querySelector(`[data-kit-lanes="${ra.getAttribute('data-kit-replay-all')}"]`); if (box) box.querySelectorAll('[data-kit-lane]').forEach(replayLane); return; }
    const rl = near(e, '[data-kit-reload]');
    if (rl) { reloadDemo(rl); return; }
    const a = near(e, '[data-kit-anchor]');
    if (a) {
      const sec = r.querySelector('#kit-s-' + a.getAttribute('data-kit-anchor'));
      if (sec) { e.preventDefault(); M.spyLock = Date.now() + 2500; setActiveToc(a.getAttribute('data-kit-anchor'), true); sec.scrollIntoView({ block: 'start', behavior: reduced() ? 'auto' : 'smooth' }); const h = sec.querySelector('.kit-sec__title'); if (h) h.focus({ preventScroll: true }); }
    }
  });

  on(r, 'keydown', e => {
    const k = e.key;
    if (k === 'Escape') {
      if (M.drawer) { e.preventDefault(); closeDrawer(); return; }
      if (M.tipFor) { hideTip(); return; }
      return;
    }
    if (k === 'Tab' && M.drawer) {
      const f = Array.from(M.drawer.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter(x => !x.disabled && x.offsetParent !== null);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1], cur = document.activeElement;
      if (e.shiftKey && (cur === first || !M.drawer.contains(cur) || cur === M.drawer.querySelector('.kit-drawer__panel'))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (cur === last || !M.drawer.contains(cur))) { e.preventDefault(); first.focus(); }
      return;
    }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(k)) return;
    const cur = near(e, '.kit-seg__item, .kit-tabs__tab, .kit-node');
    if (!cur) return;
    const sel = cur.classList.contains('kit-seg__item') ? '.kit-seg__item' : (cur.classList.contains('kit-tabs__tab') ? '.kit-tabs__tab' : '.kit-node');
    const list = Array.from(cur.parentElement.querySelectorAll(sel)).filter(x => x.getAttribute('aria-disabled') !== 'true');
    const i = list.indexOf(cur);
    if (i < 0) return;
    let n = i;
    if (k === 'Home') n = 0; else if (k === 'End') n = list.length - 1;
    else if (k === 'ArrowLeft' || k === 'ArrowUp') n = (i - 1 + list.length) % list.length;
    else n = (i + 1) % list.length;
    e.preventDefault();
    list[n].focus();
    selectIn(list[n]);
  });

  on(r, 'pointerover', e => { const t = near(e, '[data-kit-tip]'); if (t) requestTip(t, false); });
  on(r, 'pointerout', e => { const t = near(e, '[data-kit-tip]'); if (t && !(e.relatedTarget && t.contains(e.relatedTarget))) { if (M.tipFor === t || M.tipWait) hideTip(); } });
  on(r, 'focusin', e => { const t = near(e, '[data-kit-tip]'); if (t && t.matches(':focus-visible')) requestTip(t, true); });
  on(r, 'focusout', e => { const t = near(e, '[data-kit-tip]'); if (t) hideTip(); });
  /* 滚动侦测：当前节 = 顶边已经越过「吸顶区下沿 + 56px」的最后一节。
     scroll 事件给滚动中的即时反馈（节流 80ms）；scroll 事件跟着渲染帧走，标签页被降帧时会迟到，
     所以再用 150ms 的位置巡检兜终值：只在 scrollY 变了才重算。 */
  const secs = Array.from(r.querySelectorAll('[data-kit-section]'));
  const stickyBottom = () => {
    let b = 0;
    const bar = document.querySelector('.topbar');
    if (bar) b = Math.max(b, bar.getBoundingClientRect().bottom);
    if (M.tocInline) { const t = r.querySelector('.kit-toc'); if (t) b = Math.max(b, t.getBoundingClientRect().bottom); }
    return b;
  };
  const pickActive = final => {
    if (!M || !secs.length || Date.now() < M.spyLock) return;
    const line = stickyBottom() + 56;
    let cur = secs[0];
    for (const s of secs) { if (s.getBoundingClientRect().top <= line) cur = s; else break; }
    setActiveToc(cur.getAttribute('data-kit-section'), false, !!final);
  };
  const settleSpy = () => { M.spyLock = 0; pickActive(true); };
  on(W, 'scroll', () => {
    if (M.tipFor) hideTip();
    const now = Date.now();
    if (now - M.spyAt > 80) { M.spyAt = now; pickActive(false); }
  }, { passive: true });
  const watchSpy = () => {
    if (!M) return;
    if (W.scrollY !== M.spyY && Date.now() >= M.spyLock) { M.spyY = W.scrollY; pickActive(true); }
    later(watchSpy, 150);
  };
  if ('onscrollend' in W) on(W, 'scrollend', settleSpy);
  on(W, 'resize', () => { M.tocInline = !!(mq && mq.matches); syncIndicators(r); pickActive(true); });
  if (mq) on(mq, 'change', () => { M.tocInline = mq.matches; syncIndicators(r); pickActive(true); });

  if (W.IntersectionObserver) {
    const once = new IntersectionObserver(entries => entries.forEach(en => {
      if (!en.isIntersecting) return;
      once.unobserve(en.target);
      const el = en.target;
      if (el.hasAttribute('data-kit-count')) roll(el, Number(el.getAttribute('data-kit-count')), 0);
      else if (el.hasAttribute('data-kit-lanes')) el.querySelectorAll('[data-kit-lane]').forEach(replayLane);
    }), { threshold: 0.4 });
    r.querySelectorAll('[data-kit-count], [data-kit-lanes]').forEach(el => once.observe(el));
    M.observers.push(once);
  } else {
    r.querySelectorAll('[data-kit-count]').forEach(el => { el.textContent = fmt(Number(el.getAttribute('data-kit-count'))); });
  }
  M.spyY = W.scrollY;
  pickActive(true);
  later(watchSpy, 150);
  return true;
}

function destroy() {
  if (!M) return false;
  M.off.forEach(f => f());
  M.timers.forEach(t => clearTimeout(t));
  M.frames.forEach(f => cancelAnimationFrame(f));
  M.anims.forEach(a => { try { a.cancel(); } catch { /* detached */ } });
  M.observers.forEach(o => o.disconnect());
  if (M.tipFor) M.tipFor.removeAttribute('aria-describedby');
  M = null;
  return true;
}

W.CommonsUI = { button, tag, statusBadge, relTag, kindTag, kindGlyph, knowledgeCard, provenance, miniTimeline, empty, skeleton, errorState, toast, callout, tooltip, segmented, tabs, drawer, kbd, demoMark, catalog, mount, destroy };
})();
