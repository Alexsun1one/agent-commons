(() => {
  'use strict';

  const STORAGE_KEY = 'work-stage-recipes';
  const ROLE_LABEL = { agent: 'Agent 步骤', human: '人的核对点', judgement: '判断' };

  function live() { return !!(window.CommonsAPI && window.CommonsAPI.mode === 'live'); }
  function sampleStage() { return (!live() && window.COMMONS_WORK_STAGE_SAMPLE) || { fieldwork: {}, works: {} }; }

  const fallbackFieldwork = { agents: [], challenge: null, proposal: '', guides: {}, read: '我主动选中的已授权资料。', confirm: '发布、联系、承诺与验收由我确认。' };
  const fallbackWork = { agents: [], challenge: null, proposal: '', guides: {} };

  let active = null;

  const api = () => window.Commons || {};
  const esc = value => {
    const fn = api().esc;
    if (fn) return fn(String(value ?? ''));
    return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  };
  const icon = name => (api().icon ? api().icon(name) : '');
  const clip = (value, max = 12) => {
    const text = String(value ?? '');
    return text.length > max ? text.slice(0, max - 1) + '…' : text;
  };
  const pad = index => String(index + 1).padStart(2, '0');

  function prefersReduced() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function motionEndHook() {
    try {
      if (new URLSearchParams(location.search).get('motion') === 'end') return true;
      const hash = location.hash || '';
      const q = hash.indexOf('?');
      if (q >= 0 && new URLSearchParams(hash.slice(q)).get('motion') === 'end') return true;
    } catch { /* ignore */ }
    return false;
  }

  function instant() {
    return prefersReduced() || motionEndHook();
  }

  function motionStageMs() {
    if (!active) return 480;
    const raw = getComputedStyle(active.el).getPropertyValue('--motion-stage').trim();
    const ms = parseFloat(raw);
    if (!Number.isFinite(ms)) return 480;
    return raw.endsWith('s') && !raw.endsWith('ms') ? ms * 1000 : ms;
  }

  function later(fn, ms) {
    const id = setTimeout(fn, ms);
    active.timers.push(id);
    return id;
  }

  function frame(fn) {
    const id = requestAnimationFrame(fn);
    active.rafs.push(id);
    return id;
  }

  function stopPlay() {
    if (!active) return;
    active.timers.forEach(clearTimeout);
    active.timers = [];
    active.rafs.forEach(cancelAnimationFrame);
    active.rafs = [];
    active.state.playing = false;
  }

  function listen(node, name, fn, options) {
    node.addEventListener(name, fn, options);
    active.cleanup.push(() => node.removeEventListener(name, fn, options));
  }

  function destroy() {
    if (!active) return;
    stopPlay();
    active.cleanup.forEach(fn => { try { fn(); } catch { /* ignore */ } });
    const { el } = active;
    el.removeAttribute('data-ws-mounted');
    el.replaceChildren();
    active = null;
  }

  function statusMarkup(state, title, copy) {
    const skeleton = state === 'loading' ? '<span class="ws-skeleton"></span><span class="ws-skeleton ws-skeleton-short"></span>' : '';
    return `<section class="ws-shell ws-status" data-ws-state="${esc(state)}" aria-live="polite">${skeleton}<h2>${esc(title)}</h2><p>${esc(copy)}</p></section>`;
  }

  function configFor(item, kind) {
    var bag = sampleStage();
    return kind === 'fieldwork' ? (bag.fieldwork[item.id] || fallbackFieldwork) : (bag.works[item.id] || fallbackWork);
  }

  function rawSteps(item, kind) {
    if (kind === 'fieldwork') return Array.isArray(item.steps) ? item.steps : [];
    const nodes = Array.isArray(item.nodes) ? item.nodes : [];
    const notes = Array.isArray(item.nodeNotes) ? item.nodeNotes : [];
    return nodes.map((title, index) => ({ title, body: notes[index] || '这一步暂无补充说明。', tag: index === 0 ? '输入' : index === nodes.length - 1 ? '产物' : '过程' }));
  }

  function displayedSteps() {
    const { item, kind, state } = active;
    const cfg = configFor(item, kind);
    if (kind === 'fieldwork' && item.id === 'field-spreadsheets' && state.mode === 'before') {
      return cfg.before.map(step => decorateStep({ ...step, agent: false }, -1, cfg));
    }
    return rawSteps(item, kind).map((step, index) => decorateStep({ ...step, agent: cfg.agents.includes(index), guide: cfg.guides[index] || null }, index, cfg));
  }

  function decorateStep(step, index, cfg) {
    const text = `${esc(step.title)} ${esc(step.tag || '')}`;
    let role = 'human';
    if (step.agent) role = 'agent';
    else if (/判断|核对|批准|确认/.test(text) || cfg.challenge === index) role = 'judgement';
    return { ...step, role };
  }

  function labelsFor() {
    const { item, kind } = active;
    const cfg = configFor(item, kind);
    if (kind === 'fieldwork' && Array.isArray(cfg.labels)) return cfg.labels;
    return ['做法', '边界'];
  }

  function challengeIndex() {
    const { item, kind, state } = active;
    if (kind === 'fieldwork' && item.id === 'field-spreadsheets' && state.mode === 'before') return null;
    return configFor(item, kind).challenge;
  }

  function sourceLine() {
    const { item, kind } = active;
    if (kind === 'work') return live() ? '作品' : '示例作品';
    const source = item.source || {};
    return `${item.kind || '群友自述'} · ${source.group || '群聊归档'} · ${String(source.date || '').replaceAll('-', '.')}`;
  }

  function headline() {
    const { item, kind } = active;
    if (kind === 'work') return '这件作品，怎么跑起来';
    return item.id === 'field-spreadsheets' ? '以前和现在，一刀切开' : '谁做到哪，一刀切开';
  }

  function description() {
    const { item, kind } = active;
    return kind === 'fieldwork' ? item.summary : item.description;
  }

  function stationBody(role, x) {
    if (role === 'agent') {
      return `<rect class="ws-station-screen" x="${x - 23}" y="198" width="46" height="29" rx="3"/>
        <line class="ws-station-screen" x1="${esc(x)}" y1="227" x2="${esc(x)}" y2="236"/>
        <line class="ws-station-screen" x1="${x - 12}" y1="236" x2="${esc(x + 12)}" y2="236"/>
        <circle class="ws-station-signal" cx="${esc(x + 16)}" cy="205" r="3"/>`;
    }
    const mark = role === 'judgement'
      ? `<path class="ws-station-mark" d="M${esc(x)} 198L${esc(x + 7)} 205L${esc(x)} 212L${x - 7} 205Z"/>`
      : `<circle class="ws-station-person" cx="${esc(x)}" cy="207" r="9"/>`;
    return `${mark}<path class="ws-station-screen" d="M${x - 17} 235Q${esc(x)} 218 ${esc(x + 17)} 235"/><rect class="ws-station-seat" x="${x - 24}" y="236" width="48" height="10" rx="4"/>`;
  }

  function stationSvg(step, index, x) {
    const { state } = active;
    const role = step.role;
    const guide = role === 'agent' && step.guide
      ? `<text class="ws-station-range" x="${esc(x)}" y="340">范围 · ${esc(clip(step.guide[0], 10))}</text><text class="ws-station-stop" x="${esc(x)}" y="356">停手 · ${esc(clip(step.guide[1], 10))}</text>`
      : '';
    const lit = state.activated && index <= state.selected;
    return `<g class="ws-station ws-station-${esc(role)}${state.selected === index ? ' ws-is-active' : ''}${lit ? ' ws-is-done' : ''}" data-ws-station="${index}" data-ws-role="${esc(role)}" tabindex="0" role="button" aria-label="第 ${index + 1} 步，${esc(step.title)}，${ROLE_LABEL[role]}">
      <title>${esc(step.title)} · ${ROLE_LABEL[role]}</title>
      <rect class="ws-station-focus" x="${x - 70}" y="166" width="140" height="208" rx="8"/>
      <text class="ws-station-no" x="${x - 59}" y="180">${pad(index)}</text>
      <text class="ws-station-type" x="${esc(x + 59)}" y="180" text-anchor="end">${role === 'agent' ? 'Agent' : role === 'judgement' ? '判断' : '人'}</text>
      <path class="ws-station-base" d="M${x - 61} 249L${esc(x)} 218L${esc(x + 61)} 249L${esc(x)} 280Z"/>
      <path class="ws-station-side" d="M${x - 61} 249L${esc(x)} 280V289L${x - 61} 258Z M${esc(x + 61)} 249L${esc(x)} 280V289L${esc(x + 61)} 258Z"/>
      ${stationBody(role, x)}
      <g class="ws-station-copy">
        <text class="ws-station-label" x="${esc(x)}" y="304">${esc(clip(step.title, 10))}</text>
        <text class="ws-station-tag" x="${esc(x)}" y="324">${esc(clip(step.tag, 12))}</text>
        ${guide}
      </g>
    </g>`;
  }

  function stageSvg(steps) {
    const { state } = active;
    const x0 = 112;
    const x1 = 690;
    const gap = steps.length > 1 ? (x1 - x0) / (steps.length - 1) : 0;
    const xs = steps.map((_, index) => Math.round(x0 + gap * index));
    const lines = xs.slice(0, -1).map((x, index) => {
      const lit = state.activated && index < state.selected;
      return `<path class="ws-flow${lit ? ' ws-is-lit' : ''}" data-ws-flow="${index}" d="M${esc(x + 61)} 249C${esc(x + 91)} 249 ${xs[index + 1] - 91} 249 ${xs[index + 1] - 61} 249"/>`;
    }).join('');
    const gateX = 810;
    const last = xs.at(-1);
    const gateLit = state.activated && state.selected >= steps.length - 1 && (challengeIndex() === null || state.resolved);
    const gateLine = `<path class="ws-flow${gateLit ? ' ws-is-lit' : ''}" data-ws-flow="gate" d="M${last + 61} 249C${last + 91} 249 ${gateX - 54} 249 ${gateX - 34} 249"/>`;
    const boundary = state.mode === 'boundary' ? ' ws-mode-boundary' : '';
    const before = active.item.id === 'field-spreadsheets' && state.mode === 'before' ? ' ws-mode-before' : '';
    return `<svg class="ws-stage-svg${boundary}${before}" viewBox="0 0 900 428" role="group" aria-label="${esc(active.item.title)}流程剖面">
      <defs><pattern id="ws-stage-grid-${esc(active.item.id)}" width="28" height="16" patternUnits="userSpaceOnUse"><path class="ws-grid-line" d="M0 16L28 0M-14 8L0 0M28 16L42 8"/></pattern></defs>
      <path class="ws-stage-ground" d="M30 148L450 52L870 148L450 418Z"/>
      <path class="ws-stage-grid" d="M30 148L450 52L870 148L450 418Z" style="fill:url(#ws-stage-grid-${esc(active.item.id)})"/>
      ${lines}${gateLine}${steps.map((step, index) => stationSvg(step, index, xs[index])).join('')}
      <g class="ws-human-gate${gateLit ? ' ws-is-lit' : ''}" data-ws-gate aria-hidden="true">
        <path class="ws-gate-shell" d="M${gateX - 27} 217H${gateX + 27}V269H${gateX - 27}Z"/>
        <path class="ws-gate-check" d="M${gateX - 14} 243L${gateX - 3} 254L${gateX + 16} 231"/>
        <text x="${gateX}" y="294">人确认</text><text class="ws-gate-note" x="${gateX}" y="309">判断关口</text>
      </g>
    </svg>`;
  }

  function challengeMarkup() {
    const { item, kind, state } = active;
    const index = challengeIndex();
    if (index === null || !state.activated || state.selected !== index) return '';
    if (state.resolved) {
      return `<div class="ws-challenge ws-is-resolved" data-state="default" role="status"><div><b>边界已补上，可以继续</b><span>由人拍板</span></div><p>${state.resolution === 'refuse' ? '已拒绝这一步，Agent 停在当前范围内。' : '已改成先生成草稿，等你确认后再继续。'}</p></div>`;
    }
    const proposal = configFor(item, kind).proposal;
    return `<div class="ws-challenge" data-ws-challenge data-state="default" tabindex="-1" role="alert"><div><b>Agent 提出了越界的下一步</b><span>判断</span></div><p>“${esc(proposal)}”</p><div class="ws-challenge-actions"><button type="button" class="button" data-ws-resolution="refuse">拒绝</button><button type="button" class="button tonal" data-ws-resolution="confirm">改成需要我确认</button></div></div>`;
  }

  function detailMarkup(steps) {
    const { state } = active;
    const step = steps[Math.max(0, state.selected)] || steps[0];
    if (!step) return '';
    const role = step.role;
    const scope = role === 'agent' && step.guide
      ? `<b>Agent 的范围</b><span>${esc(step.guide[0])}；${esc(step.guide[1])}</span>`
      : `<b>${role === 'judgement' ? '人的判断' : '人的关键点'}</b><span>${esc(step.tag || '人工核对')} · 这一步由人掌握判断。</span>`;
    return `<div class="ws-step-detail" aria-live="polite"><span class="ws-detail-no">${pad(Math.max(0, state.selected))}</span><div><h3>${esc(step.title)}</h3><p>${esc(step.body)}</p></div><div class="ws-step-scope ws-step-scope-${esc(role)}">${scope}</div></div>`;
  }

  function railMarkup(steps) {
    const { state } = active;
    const barrier = challengeIndex();
    return `<ol class="ws-step-rail" style="--ws-count:${Math.max(1, steps.length)}" aria-label="工位时间线">${steps.map((step, index) => {
      const blocked = barrier !== null && !state.resolved && index > barrier;
      const pressed = state.selected === index;
      return `<li><button type="button" class="ws-step-button ws-step-${esc(step.role)}" data-ws-step="${index}" data-state="${blocked ? 'disabled' : pressed ? 'active' : 'default'}" aria-pressed="${esc(pressed)}"${blocked ? ' disabled' : ''}><span>${pad(index)}</span><b>${esc(clip(step.title, 12))}</b><small>${ROLE_LABEL[step.role]}</small></button></li>`;
    }).join('')}</ol>`;
  }

  function recipeDefaults() {
    const { item, kind } = active;
    const cfg = configFor(item, kind);
    const steps = rawSteps(item, kind);
    if (kind === 'fieldwork') {
      return { read: cfg.read || fallbackFieldwork.read, do: steps.map(step => step.title).join(' → '), stop: item.limits || '材料或权限不清楚时停手。', confirm: cfg.confirm || fallbackFieldwork.confirm };
    }
    return { read: `《${item.title}》的示例说明、关联方法与我主动选择的材料。`, do: steps.map(step => step.title).join(' → '), stop: '遇到权限不足、结果未知或缺少证据时停手。', confirm: '工具执行前的副作用、发布与验收由我确认。' };
  }

  function readRecipes() {
    const value = api().read ? api().read(STORAGE_KEY, []) : [];
    return Array.isArray(value) ? value : [];
  }

  function recipeMarkup() {
    const { item, kind, state } = active;
    if (!state.recipeOpen) return '';
    const key = `${kind}:${item.id}`;
    const saved = readRecipes().find(recipe => recipe.key === key);
    const data = saved || recipeDefaults();
    return `<form class="ws-recipe" data-ws-recipe><div class="ws-recipe-head"><div><span>我的配方卡</span><h3>照着做，先把边界写清</h3></div><button type="button" class="button ghost icon-only" data-ws-recipe-close aria-label="关闭配方卡">×</button></div>${kind === 'work' && !live() ? '<span class="ws-demo">示例</span>' : ''}<p class="ws-recipe-from">从《${esc(item.title)}》生成 · 可编辑 · 本机保存</p><div class="ws-recipe-grid">${[['read', '读什么'], ['do', '做什么'], ['stop', '何时停手'], ['confirm', '哪里要我确认']].map(([name, label]) => `<label><span>${label}</span><textarea name="${name}" rows="3" required>${esc(data[name])}</textarea></label>`).join('')}</div><div class="ws-recipe-foot"><span data-ws-save-state role="status">${saved ? '已读出这台设备上的版本。' : '只保存在这台设备的浏览器里。'}</span><button class="button primary" type="submit">保存我的配方</button></div></form>`;
  }

  function playLabel() {
    const { state } = active;
    if (state.playing) return '正在演示…';
    if (state.activated) return '再看一遍';
    return '看它怎么跑';
  }

  function toolbarMarkup() {
    const { state } = active;
    const labels = labelsFor();
    const modes = labels[0] === '以前' ? ['before', 'now'] : ['now', 'boundary'];
    return `<div class="ws-toolbar"><div class="ws-seg" role="group" aria-label="切换流程视角" data-ready><span class="ws-seg-thumb" aria-hidden="true"></span>${labels.map((label, index) => {
      const mode = modes[index];
      return `<button type="button" class="ws-seg-item" data-ws-mode="${esc(mode)}" aria-pressed="${state.mode === mode}">${esc(label)}</button>`;
    }).join('')}</div><button type="button" class="button primary ws-play" data-ws-play${state.playing ? ' data-ws-playing="true"' : ''}>${state.playing ? '<span class="ws-play-spinner" aria-hidden="true"></span>' : icon('spark')}<span data-ws-play-label>${playLabel()}</span></button><div class="ws-legend" aria-hidden="true"><span><i class="ws-agent-dot"></i>Agent</span><span><i class="ws-human-dot"></i>人的核对</span><span><i class="ws-judge-dot"></i>判断</span></div></div>`;
  }

  function renderReady() {
    const { el, item, kind, state } = active;
    const steps = displayedSteps();
    state.selected = Math.max(0, Math.min(state.selected, steps.length - 1));
    const demo = kind === 'work' && !live() ? '<span class="ws-demo">示例</span>' : '';
    const challenge = challengeMarkup();
    el.innerHTML = `<section class="ws-shell" data-ws-kind="${esc(kind)}" data-ws-state="default">
      <header class="ws-head"><div><div class="ws-kicker">作品剖面 ${demo}</div><h2>${esc(headline())}</h2><p>${esc(description())}</p><span class="ws-source">${esc(sourceLine())}</span></div><div class="ws-count"><b>${rawSteps(item, kind).length}</b><span>个环节</span></div></header>
      ${toolbarMarkup()}
      <div class="ws-stage">
        <div class="ws-stage-viewport"><div class="ws-stage-layer ws-is-in">${stageSvg(steps)}</div></div>
        <div class="ws-console"><div data-ws-detail>${detailMarkup(steps)}</div><div data-ws-challenge-slot${challenge ? '' : ' hidden'}>${challenge}</div><div data-ws-rail>${railMarkup(steps)}</div></div>
      </div>
      <div class="ws-sowhat"><b>所以呢</b><span>${esc(kind === 'fieldwork' ? item.takeaway : '沿着这张剖面继续看方法、证据与人工确认点。')}</span><button class="button primary" type="button" data-ws-make-recipe>生成配方卡</button></div>
      <div data-ws-recipe-slot>${recipeMarkup()}</div>
    </section>`;
    syncSeg();
  }

  function paintDetail() {
    const slot = active.el.querySelector('[data-ws-detail]');
    if (slot) slot.innerHTML = detailMarkup(displayedSteps());
  }

  function paintChallenge() {
    const slot = active.el.querySelector('[data-ws-challenge-slot]');
    if (!slot) return;
    const html = challengeMarkup();
    slot.innerHTML = html;
    slot.hidden = !html;
  }

  function paintRail() {
    const slot = active.el.querySelector('[data-ws-rail]');
    if (slot) slot.innerHTML = railMarkup(displayedSteps());
  }

  function paintRecipe() {
    const slot = active.el.querySelector('[data-ws-recipe-slot]');
    if (slot) slot.innerHTML = recipeMarkup();
  }

  function syncPlayButton() {
    const btn = active.el.querySelector('[data-ws-play]');
    if (!btn) return;
    const { state } = active;
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
    btn.removeAttribute('data-state');
    btn.toggleAttribute('data-ws-playing', state.playing);
    btn.innerHTML = `${state.playing ? '<span class="ws-play-spinner" aria-hidden="true"></span>' : icon('spark')}<span data-ws-play-label>${playLabel()}</span>`;
  }

  function syncSeg() {
    const seg = active.el.querySelector('.ws-seg');
    const thumb = active.el.querySelector('.ws-seg-thumb');
    const on = active.el.querySelector('.ws-seg [aria-pressed="true"]');
    if (!seg || !thumb || !on) return;
    const run = () => {
      const sr = seg.getBoundingClientRect();
      const br = on.getBoundingClientRect();
      const style = getComputedStyle(seg);
      const pad = parseFloat(style.paddingLeft) || 0;
      thumb.style.setProperty('--x', `${Math.round(br.left - sr.left - pad)}px`);
      thumb.style.setProperty('--w', `${Math.round(br.width)}px`);
    };
    if (instant()) run();
    else frame(run);
  }

  function lightFlow(path) {
    if (!path) return;
    path.classList.remove('ws-is-running', 'ws-is-lit');
    let len = 80;
    try { len = path.getTotalLength() || 80; } catch { /* ignore */ }
    path.style.strokeDasharray = String(len);
    path.style.strokeDashoffset = String(len);
    path.classList.add('ws-is-running');
    if (instant()) {
      path.style.strokeDashoffset = '0';
      path.classList.add('ws-is-lit');
      path.classList.remove('ws-is-running');
      return;
    }
    path.getBoundingClientRect();
    path.style.transition = `stroke-dashoffset var(--motion-stage) var(--ease-in-out)`;
    path.style.strokeDashoffset = '0';
  }

  function syncLit(opts = {}) {
    const { state } = active;
    const steps = displayedSteps();
    const selected = state.selected;
    active.el.querySelectorAll('[data-ws-station]').forEach(node => {
      const index = Number(node.dataset.wsStation);
      node.classList.toggle('ws-is-active', index === selected);
      node.classList.toggle('ws-is-done', state.activated && index <= selected);
    });
    active.el.querySelectorAll('[data-ws-flow]').forEach(path => {
      const key = path.dataset.wsFlow;
      const index = key === 'gate' ? steps.length - 1 : Number(key);
      const shouldLit = state.activated && selected > index;
      const running = opts.flowing === index;
      path.classList.toggle('ws-is-lit', shouldLit && !running);
      if (running) lightFlow(path);
      else if (!shouldLit) {
        path.classList.remove('ws-is-running');
        path.style.strokeDasharray = '';
        path.style.strokeDashoffset = '';
        path.style.transition = '';
      }
    });
    const gateLit = state.activated && selected >= steps.length - 1 && (challengeIndex() === null || state.resolved);
    active.el.querySelector('[data-ws-gate]')?.classList.toggle('ws-is-lit', gateLit);
    active.el.querySelectorAll('[data-ws-step]').forEach(btn => {
      const index = Number(btn.dataset.wsStep);
      btn.setAttribute('aria-pressed', String(index === selected));
      btn.dataset.state = btn.disabled ? 'disabled' : index === selected ? 'active' : 'default';
    });
  }

  function paintConsole() {
    paintDetail();
    paintChallenge();
    paintRail();
  }

  function setMode(mode) {
    if (!active || active.state.mode === mode) return;
    stopPlay();
    const { state, el } = active;
    state.mode = mode;
    state.selected = 0;
    state.activated = false;
    state.resolved = false;
    state.resolution = '';
    const viewport = el.querySelector('.ws-stage-viewport');
    const outgoing = viewport && viewport.querySelector('.ws-stage-layer');
    const incoming = document.createElement('div');
    incoming.className = 'ws-stage-layer';
    incoming.innerHTML = stageSvg(displayedSteps());
    el.querySelectorAll('[data-ws-mode]').forEach(btn => btn.setAttribute('aria-pressed', String(btn.dataset.wsMode === mode)));
    syncSeg();
    paintConsole();
    syncPlayButton();
    if (!viewport) return;
    viewport.appendChild(incoming);
    if (instant() || !outgoing) {
      outgoing?.remove();
      incoming.classList.add('ws-is-in');
      return;
    }
    outgoing.classList.add('ws-is-out');
    incoming.classList.add('ws-is-enter');
    frame(() => incoming.classList.add('ws-is-in'));
    later(() => outgoing.remove(), motionStageMs());
  }

  function playPath(from) {
    stopPlay();
    const steps = displayedSteps();
    if (!steps.length) return;
    const { state } = active;
    const barrier = challengeIndex();
    const start = Number.isInteger(from) ? from : 0;
    const end = barrier !== null && !state.resolved ? barrier : steps.length - 1;
    state.playing = true;
    state.activated = true;
    syncPlayButton();
    if (instant()) {
      state.selected = end;
      state.playing = false;
      syncLit();
      paintConsole();
      syncPlayButton();
      if (barrier !== null && !state.resolved && state.selected === barrier) {
        active.el.querySelector('[data-ws-challenge]')?.focus();
      }
      return;
    }
    let i = start;
    const tick = () => {
      if (!active || !state.playing) return;
      state.selected = i;
      syncLit({ flowing: i > start ? i - 1 : (start > 0 ? start - 1 : -1) });
      paintDetail();
      paintChallenge();
      if (i === barrier && !state.resolved) {
        state.playing = false;
        paintRail();
        syncPlayButton();
        active.el.querySelector('[data-ws-challenge]')?.focus();
        return;
      }
      if (i >= end) {
        state.playing = false;
        if (end >= steps.length - 1) lightFlow(active.el.querySelector('[data-ws-flow="gate"]'));
        paintRail();
        syncPlayButton();
        return;
      }
      i += 1;
      later(tick, motionStageMs());
    };
    tick();
  }

  function activateStep(index) {
    stopPlay();
    const barrier = challengeIndex();
    if (barrier !== null && !active.state.resolved && index > barrier) {
      active.state.selected = barrier;
      active.state.activated = true;
      syncLit();
      paintConsole();
      syncPlayButton();
      active.el.querySelector('[data-ws-challenge]')?.focus();
      return;
    }
    active.state.selected = index;
    active.state.activated = true;
    syncLit();
    paintConsole();
    syncPlayButton();
  }

  function openRecipe() {
    const barrier = challengeIndex();
    if (barrier !== null && !active.state.resolved) {
      active.state.mode = active.item.id === 'field-spreadsheets' ? 'now' : active.state.mode;
      active.state.selected = barrier;
      active.state.activated = true;
      syncLit();
      paintConsole();
      active.el.querySelector('[data-ws-challenge]')?.focus();
      return;
    }
    active.state.recipeOpen = true;
    paintRecipe();
    active.el.querySelector('[data-ws-recipe] textarea')?.focus();
  }

  function onClick(event) {
    const target = event.target.closest('[data-ws-mode],[data-ws-station],[data-ws-step],[data-ws-resolution],[data-ws-make-recipe],[data-ws-recipe-close],[data-ws-play]');
    if (!target || !active.el.contains(target)) return;
    if (target.matches('[data-ws-mode]')) { setMode(target.dataset.wsMode); return; }
    if (target.matches('[data-ws-play]')) {
      if (active.state.playing) return;
      playPath(0);
      return;
    }
    if (target.matches('[data-ws-station]')) { activateStep(Number(target.dataset.wsStation)); return; }
    if (target.matches('[data-ws-step]')) { activateStep(Number(target.dataset.wsStep)); return; }
    if (target.matches('[data-ws-resolution]')) {
      active.state.resolved = true;
      active.state.resolution = target.dataset.wsResolution;
      paintChallenge();
      paintRail();
      syncLit();
      if (active.state.resolution === 'confirm') playPath(challengeIndex() + 1);
      return;
    }
    if (target.matches('[data-ws-make-recipe]')) { openRecipe(); return; }
    if (target.matches('[data-ws-recipe-close]')) {
      active.state.recipeOpen = false;
      paintRecipe();
      active.el.querySelector('[data-ws-make-recipe]')?.focus();
    }
  }

  function onKeydown(event) {
    const station = event.target.closest('[data-ws-station]');
    if (!station || !active.el.contains(station) || !['Enter', ' '].includes(event.key)) return;
    event.preventDefault();
    activateStep(Number(station.dataset.wsStation));
  }

  function onSubmit(event) {
    const form = event.target.closest('[data-ws-recipe]');
    if (!form || !active.el.contains(form)) return;
    event.preventDefault();
    if (!form.reportValidity()) return;
    const data = Object.fromEntries(new FormData(form).entries());
    const key = `${active.kind}:${active.item.id}`;
    const recipes = readRecipes().filter(recipe => recipe.key !== key);
    recipes.push({ key, kind: active.kind, sourceId: active.item.id, title: active.item.title, ...data, updatedAt: new Date().toISOString() });
    const write = api().write;
    const ok = write ? write(STORAGE_KEY, recipes) : false;
    const status = form.querySelector('[data-ws-save-state]');
    if (status) status.textContent = ok ? '已保存到这台设备。你可以继续修改。' : '保存失败。请先复制卡片内容，再重新打开页面。';
  }

  function refresh() {
    if (!active) return;
    const { el, item, kind, status } = active;
    if (status === 'loading') { el.innerHTML = statusMarkup('loading', '作品剖面正在准备', '数据到达后会在这里展开流程。'); return; }
    if (status === 'empty') { el.innerHTML = statusMarkup('empty', '这里还没有可拆开的步骤', '换一件作品，或先补上至少一个可说明的环节。'); return; }
    if (status === 'forbidden') { el.innerHTML = statusMarkup('forbidden', '没有查看这张剖面的权限', '原有作品内容没有被改动。换一件你能看的，或回到上一页。'); return; }
    if (status === 'error') { el.innerHTML = statusMarkup('error', '作品剖面暂时打不开', '数据结构不完整，原有作品内容没有被改动。'); return; }
    if (!api().read || !api().write) { el.innerHTML = statusMarkup('error', '配方卡暂时不能保存', '先复制内容，刷新后再试。'); return; }
    if (!['fieldwork', 'work'].includes(kind)) { el.innerHTML = statusMarkup('error', '不认识这类作品', '这份内容的类型还不支持，换一件作品试试。'); return; }
    if (!item || !item.id || !item.title || !rawSteps(item, kind).length) { el.innerHTML = statusMarkup('error', '作品剖面缺少必要信息', '需要标题和至少一个步骤才能绘制。'); return; }
    renderReady();
  }

  function render(el, item, kind) {
    destroy();
    if (!el || typeof el.addEventListener !== 'function') return false;
    const status = item === undefined ? 'loading' : item === null ? 'empty' : item && item.forbidden ? 'forbidden' : 'ready';
    active = {
      el, item, kind, status,
      state: { mode: 'now', selected: 0, activated: false, resolved: false, resolution: '', recipeOpen: false, playing: false },
      timers: [], rafs: [], cleanup: []
    };
    el.setAttribute('data-ws-mounted', 'true');
    listen(el, 'click', onClick);
    listen(el, 'keydown', onKeydown);
    listen(el, 'submit', onSubmit);
    listen(window, 'resize', () => { if (active) syncSeg(); });
    const mq = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
    if (mq) {
      const onMotion = () => { if (active && active.state.playing && mq.matches) playPath(active.state.selected); };
      if (mq.addEventListener) listen(mq, 'change', onMotion);
      else if (mq.addListener) {
        mq.addListener(onMotion);
        active.cleanup.push(() => mq.removeListener(onMotion));
      }
    }
    refresh();
    return true;
  }

  window.CommonsWorkStage = { render, destroy };
})();
