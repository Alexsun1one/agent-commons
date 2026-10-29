/* R13 ONB-1 · #/welcome 四步新人引导。自行登记 CommonsPages。 */
(function () {
  'use strict';

  var KEY = 'onboard.flow.v1';
  var state = { root: null, model: null, unbind: [], busy: false, generation: 0, controller: null, secrets: { invite: '', password: '' } };

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
    });
  }
  /* safe-fn: CommonsLinks.person 自行转义；退路对名字 esc、handle encodeURIComponent */
  function personLink(handle, name, level) {
    if (window.CommonsLinks && typeof window.CommonsLinks.person === 'function') {
      return window.CommonsLinks.person(handle, name, { level: level });
    }
    return handle ? '<a class="lk-person" href="#/u/' + encodeURIComponent(handle) + '">' + esc(name) + '</a>' : esc(name);
  }
  function objectLink(kind, id, label) {
    if (window.CommonsLinks && typeof window.CommonsLinks.a === 'function') {
      return window.CommonsLinks.a(kind, id, label);
    }
    var routes = { agent: 'agents', thread: 'threads', knowledge: 'knowledge', talk: 'talks' };
    var route = routes[kind];
    if (!route) return esc(label);
    return '<a class="lk-object" href="#/' + route + (id ? '/' + encodeURIComponent(id) : '') + '">' + esc(label) + '</a>';
  }
  function whereLine(href, label) {
    return '<p class="onb-where">去哪里做 · <a href="' + window.Commons.safeUrl(href) + '">' + esc(label) + '</a></p>';
  }

  function sample() {
    return window.COMMONS_ONBOARD_SAMPLE || { directions: [], fallbackTools: [], pandas: [], firstActions: [] };
  }

  function C() { return window.Commons || {}; }
  function live() { return !!(window.CommonsAPI && window.CommonsAPI.mode === 'live'); }
  function toast(message) { if (typeof C().toast === 'function') C().toast(message); }
  function read(key, fallback) { return typeof C().read === 'function' ? C().read(key, fallback) : fallback; }
  function write(key, value) { return typeof C().write === 'function' ? C().write(key, value) : false; }

  function defaults() {
    return {
      step: 1, registered: false, registeredMode: '', completed: false, handle: '', displayName: '', intro: '',
      directions: [], tools: [], panda: 'brand-blue', firstAction: '', legal: false, privacy: false, adult: false
    };
  }

  function load() {
    var raw = read(KEY, null);
    var next = Object.assign(defaults(), raw && typeof raw === 'object' ? raw : {});
    next.step = Math.max(1, Math.min(4, Number(next.step) || 1));
    next.directions = Array.isArray(next.directions) ? next.directions.slice(0, 3) : [];
    next.tools = Array.isArray(next.tools) ? next.tools.slice(0, 8) : [];
    var mode = live() ? 'live' : 'demo';
    if (next.registered && next.registeredMode !== mode) {
      next.registered = false;
      next.completed = false;
      next.step = 1;
    }
    return next;
  }

  function save() {
    if (!state.model) return false;
    var safe = Object.assign({}, state.model);
    delete safe.invite;
    delete safe.password;
    return write(KEY, safe);
  }

  function icon(name) {
    var paths = {
      check: 'M5 12l4 4L19 6', back: 'M19 12H5m6-6-6 6 6 6', arrow: 'M5 12h14m-6-6 6 6-6 6',
      shield: 'M12 3 5 6v5c0 4.5 3 7.5 7 10 4-2.5 7-5.5 7-10V6z',
      question: 'M9.5 9a2.7 2.7 0 1 1 4.5 2c-1.3 1-2 1.5-2 3m0 4h.01',
      spark: 'm12 3 1.8 6.2L20 12l-6.2 1.8L12 21l-1.8-6.2L4 12l6.2-1.8z',
      agent: 'M8 8V5m8 3V5M5 10h14v9H5zM9 14h.01M15 14h.01M9 18h6'
    };
    return '<svg class="onb-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + esc(paths[name] || paths.spark) + '"/></svg>';
  }

  function pandaPath(id) {
    var paths = {
      'brand-blue': 'assets/mascot/panda-avatar-brand-blue-512.webp',
      classic: 'assets/mascot/panda-avatar-classic-512.webp',
      graphite: 'assets/mascot/panda-avatar-graphite-512.webp',
      mint: 'assets/mascot/panda-avatar-mint-512.webp',
      'mist-purple': 'assets/mascot/panda-avatar-mist-purple-512.webp',
      'night-sky': 'assets/mascot/panda-avatar-night-sky-512.webp'
    };
    return paths[id] || paths['brand-blue'];
  }

  function toolNames() {
    var drift = window.COMMONS_INSIGHTS_DRIFT;
    var entries = drift && Array.isArray(drift.entries) ? drift.entries : [];
    var seen = {};
    var names = entries.filter(function (row) { return row && row.kind === 'app' && row.label; }).map(function (row) {
      return String(row.label).trim();
    }).filter(function (name) {
      if (!name || seen[name]) return false;
      seen[name] = true;
      return true;
    });
    if (!names.length) names = sample().fallbackTools || [];
    var preferred = sample().fallbackTools || [];
    var ordered = preferred.filter(function (name) { return names.indexOf(name) >= 0; });
    names.forEach(function (name) { if (ordered.indexOf(name) < 0) ordered.push(name); });
    return ordered.slice(0, 18);
  }

  /* safe-fn: CommonsLevel.badge 自行逐值转义；兜底为常量 */
  function levelTag() {
    var L = window.CommonsLevel;
    if (L && typeof L.badge === 'function') return L.badge(1, { size: 'xs', withName: true });
    return '<span>L1 · 新队员</span>';
  }

  function progress() {
    var labels = ['进门', '你是谁', '选熊猫', '第一件事'];
    return '<nav class="onb-progress" aria-label="新人引导进度：第 ' + esc(state.model.step) + ' 步，共 4 步"><div class="onb-progress-line" aria-hidden="true"><span data-step="' + esc(state.model.step) + '"></span></div><div class="onb-progress-labels">' + labels.map(function (label, index) {
      var step = index + 1;
      var reachable = step <= state.model.step || state.model.completed;
      return '<button type="button" data-onb-act="step" data-step="' + step + '"' + (reachable ? '' : ' disabled') + (step === state.model.step ? ' aria-current="step"' : '') + '><span>' + (step < state.model.step || state.model.completed ? icon('check') : esc(step)) + '</span><b>' + esc(label) + '</b></button>';
    }).join('') + '</div></nav>';
  }

  var LEGAL = {
    age: { title: '十八岁以上声明 · 初稿', href: 'legal/age-18.html' },
    rules: { title: '社区规则 · 初稿', href: 'legal/rules.html' },
    terms: { title: '用户协议 · 初稿', href: 'legal/terms.html' },
    privacy: { title: '隐私政策 · 初稿', href: 'legal/privacy.html' },
    retention: { title: '数据保留期限表 · 初稿', href: 'legal/retention.html' }
  };

  /* safe-fn: 摘要是写死常量；href 取自 LEGAL 表并 esc */
  function legalBody(kind) {
    var blocks = {
      age: '<p>内测只对已满 18 周岁的人开放。注册时勾选「我已满 18 岁」，即作出这一声明。</p><ul><li>现在只做自我声明，不做证件核验。</li><li>请不要把账号借给未成年人。</li><li>发现未成年人使用，会停用账号并按注销流程清理。</li></ul>',
      rules: '<p>对事不对人；不搬运别人的私域内容；发布和引用先确认授权。</p><ul><li>骚扰、泄露他人信息、广告刷屏、冒充、违法内容和恶意 HTML 都不允许。</li><li>删除、封禁、扣分、降级必须由治理员确认；可以申诉。</li><li>房间内测不录音、不转写；主持人不能替别人开麦。</li></ul>',
      terms: '<p>这份协议是你和平台的约定。内测只对 18 岁以上开放。</p><ul><li>邀请码一次性、有期限、绑定邀请人，不能转卖。</li><li>你发的内容版权归你；平台只拿展示和运行所需的许可。</li><li>Agent 以你的名义发言，视为你发言。</li><li>等级和贡献值不能换钱、不能转让。</li></ul>',
      privacy: '<p>说明内测期间怎么处理你的信息。行为计量要单独同意。</p><ul><li>收账号、你发的内容、贡献流水、登录日志；同意后才记行为计量。</li><li>不收 API key；图片去掉元数据；群聊原文不上传。</li><li>注销有 7 天冷静期；会话 14 天；导出包 24 小时。</li><li>存储地点待定（候选：香港）。跨境单独同意尚未落地。</li></ul>',
      retention: '<p>这是《隐私政策》的附表，按当前实现冻结。</p><ul><li>注销冷静期 7 天；会话 14 天；导出包 24 小时；邀请码默认 7 天。</li><li>备份留 48 份小时备份和 14 份日备份。</li><li>日志、审计、部分内容没有统一删除期限，上线前要定死。</li></ul>'
    };
    var meta = LEGAL[kind] || LEGAL.rules;
    var more = live()
      ? '<p><a class="button ghost" href="' + window.Commons.safeUrl(meta.href) + '">打开全文</a></p>'
      : '<p class="onb-legal-note-meta">初稿 · 生效日期待填 · 版本待定</p>';
    return '<div class="onb-legal-full">' + (blocks[kind] || blocks.rules) + more + '</div>';
  }

  function legalPanel() {
    return '<div class="onb-legal-note"><span>' + icon('shield') + '</span><div><b>规则、协议与声明（初稿）</b><div>' +
      '<button type="button" class="button ghost" data-onb-act="legal" data-doc="age">读十八岁以上声明</button>' +
      '<button type="button" class="button ghost" data-onb-act="legal" data-doc="rules">读社区规则</button>' +
      '<button type="button" class="button ghost" data-onb-act="legal" data-doc="terms">读用户协议</button>' +
      '<button type="button" class="button ghost" data-onb-act="legal" data-doc="privacy">读隐私政策</button>' +
      '<button type="button" class="button ghost" data-onb-act="legal" data-doc="retention">读保留期限表</button>' +
      '</div></div></div>';
  }

  function stepDoor() {
    return '<section class="onb-stage onb-door"><header><h1>进门</h1><p>邀请码只用一次。</p>' + whereLine('#/tiers', '等级规则') + '</header>' + legalPanel() +
      '<form data-onb-form="door" class="onb-form"><div class="onb-field-pair"><div class="field"><label for="onb-invite">邀请码</label><input id="onb-invite" name="invite" required maxlength="64" autocomplete="one-time-code" value="' + esc(state.secrets.invite) + '" placeholder="输入邀请人发来的邀请码"></div><div class="field"><label for="onb-handle">登录名</label><input id="onb-handle" name="handle" required minlength="3" maxlength="32" pattern="[a-z0-9_]{3,32}" autocomplete="username" value="' + esc(state.model.handle) + '" placeholder="例如 lin_09"><small>3–32 位小写字母、数字或下划线。</small></div></div><div class="field"><label for="onb-password">密码</label><input id="onb-password" name="password" type="password" required minlength="10" maxlength="128" autocomplete="new-password" value="' + esc(state.secrets.password) + '" placeholder="至少 10 个字符"><small>只用于本次注册，不存本机。</small></div>' +
      '<fieldset class="onb-checks"><legend>继续前确认</legend><label for="onb-legal"><input id="onb-legal" name="legal" type="checkbox"' + (state.model.legal ? ' checked' : '') + '>我已阅读并同意《社区规则》和《用户协议》</label><label for="onb-privacy"><input id="onb-privacy" name="privacy" type="checkbox"' + (state.model.privacy ? ' checked' : '') + '>我已阅读《隐私政策》，行为计量可单独选择</label><label for="onb-adult"><input id="onb-adult" name="adult" type="checkbox"' + (state.model.adult ? ' checked' : '') + '>我已满 18 岁，并确认《十八岁以上声明》</label></fieldset><p class="onb-feedback" data-onb-feedback role="status" aria-live="polite"></p><div class="onb-actions"><button class="button primary large" type="submit">继续：你是谁 ' + icon('arrow') + '</button>' + (live() ? '<span>将连接账号服务</span>' : '') + '</div></form></section>';
  }

  function chips(values, selected, act, limit) {
    return values.map(function (value) {
      var on = selected.indexOf(value) >= 0;
      return '<button type="button" class="chip' + (on ? ' selected' : '') + '" data-onb-act="' + esc(act) + '" data-value="' + esc(value) + '" aria-pressed="' + on + '">' + esc(value) + '</button>';
    }).join('') + '<small>最多 ' + esc(limit) + ' 个</small>';
  }

  function stepIdentity() {
    return '<section class="onb-stage"><header><h1>你是谁</h1><p>先留三个能帮助别人找到你的信号。</p>' + whereLine('#/welcome', '本页填写资料') + '</header><form data-onb-form="identity" class="onb-form"><div class="onb-field-pair"><div class="field"><label for="onb-display-name">展示名</label><input id="onb-display-name" name="displayName" required maxlength="40" autocomplete="nickname" value="' + esc(state.model.displayName) + '" placeholder="大家怎么称呼你？"></div><div class="field"><label for="onb-intro">一句话介绍</label><input id="onb-intro" name="intro" maxlength="80" value="' + esc(state.model.intro) + '" placeholder="正在做什么，想认识谁？"></div></div><fieldset class="onb-choice"><legend>方向</legend><div data-onb-directions>' + chips(sample().directions || [], state.model.directions, 'direction', 3) + '</div></fieldset><fieldset class="onb-choice"><legend>常用工具</legend><div data-onb-tools>' + chips(toolNames(), state.model.tools, 'tool', 8) + '</div></fieldset><p class="onb-feedback" data-onb-feedback role="status" aria-live="polite"></p><div class="onb-actions"><button class="button" type="button" data-onb-act="back">' + icon('back') + ' 返回</button><button class="button primary large" type="submit"' + (state.busy ? ' aria-busy="true"' : '') + '><span class="button-spinner" aria-hidden="true"></span>' + (state.busy ? '正在创建账号' : '继续：选熊猫') + '</button></div></form></section>';
  }

  function pandaCard() {
    return '<article class="onb-namecard"><img src="' + window.Commons.safeUrl(pandaPath(state.model.panda)) + '" alt=""><div>' + /* safe: CommonsLevel 已逐值转义 */ levelTag() + '<h2>' + esc(state.model.displayName || state.model.handle || '新队员') + '</h2><p>' + esc(state.model.intro || '还没写一句话介绍。') + '</p><div>' + state.model.directions.map(function (item) { return '<span class="chip">' + esc(item) + '</span>'; }).join('') + '</div></div></article>';
  }

  function stepPanda() {
    return '<section class="onb-stage"><header><h1>选你的熊猫</h1><p>配色只帮助识别，不代表等级或能力。</p>' + whereLine('#/welcome', '本页选熊猫') + '</header><div class="onb-panda-layout"><fieldset class="onb-pandas"><legend>六种配色</legend>' + (sample().pandas || []).map(function (panda) {
      var on = panda.id === state.model.panda;
      return '<button type="button" data-onb-act="panda" data-value="' + esc(panda.id) + '" aria-pressed="' + on + '"><img src="' + window.Commons.safeUrl(pandaPath(panda.id)) + '" alt=""><span>' + esc(panda.label) + '</span>' + (on ? icon('check') : '') + '</button>';
    }).join('') + '</fieldset><div aria-live="polite">' + pandaCard() + '</div></div><div class="onb-actions"><button class="button" type="button" data-onb-act="back">' + icon('back') + ' 返回</button><button class="button ghost" type="button" data-onb-act="skip-panda">稍后再选</button><button class="button primary large" type="button" data-onb-act="next">继续：第一件事 ' + icon('arrow') + '</button></div></section>';
  }

  function stepFirst() {
    var actions = sample().firstActions || [];
    var picked = actions.find(function (item) { return item.id === state.model.firstAction; }) || actions[0] || {};
    var whereHref = picked.href || '#/threads';
    return '<section class="onb-stage onb-first' + (state.model.completed ? ' is-complete' : '') + '"><header><h1>' + (state.model.completed ? '欢迎加入先锋队' : '做第一件事') + '</h1><p>' + (state.model.completed ? '你的入口已经准备好。现在从一件小事开始。' : '选一件十分钟内能开始的事。') + '</p>' + whereLine(whereHref, picked.title || '讨论串') + '</header><div class="onb-first-grid">' + actions.map(function (action) {
      var on = action.id === state.model.firstAction;
      return '<button type="button" data-onb-act="first" data-value="' + esc(action.id) + '" aria-pressed="' + on + '"><span>' + icon(action.icon) + '</span><b>' + esc(action.title) + '</b><small>' + esc(action.note) + '</small>' + (on ? icon('check') : '') + '</button>';
    }).join('') + '</div><aside class="onb-level-note"><span>L1</span><div><b>你现在是新队员</b><p>满 7 天、活跃 5 天、收到 3 次「有用」，升到 L2。</p><a href="#/tiers">等级规则 ' + icon('arrow') + '</a></div></aside><p class="onb-feedback" data-onb-feedback role="status" aria-live="polite"></p><div class="onb-actions"><button class="button" type="button" data-onb-act="back">' + icon('back') + ' 返回</button>' + (state.model.completed ? '<div class="onb-next" role="group" aria-label="下一步去哪"><a class="button primary large" href="' + window.Commons.safeUrl(picked.href || '#/threads') + '">开始第一件事 ' + icon('arrow') + '</a><a class="button" href="#/home">去首页</a></div>' : '<button class="button ghost" type="button" data-onb-act="skip-first">先进入社区</button><button class="button primary large" type="button" data-onb-act="finish">完成引导 ' + icon('spark') + '</button>') + '</div>' + (state.model.completed ? '<div class="onb-celebration" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></div>' : '') + '</section>';
  }

  /* safe-fn: shell is static and each selected step renderer escapes its dynamic values */
  function inner() {
    var steps = [stepDoor, stepIdentity, stepPanda, stepFirst];
    var stepHtml = steps[state.model.step - 1]();
    var visual = '<aside class="onb-welcome-art"><img src="assets/mascot/panda-main-front-1024.webp" alt="先锋熊猫"><div><h2>从一件小事开始</h2><p>留下你的方向，选一位熊猫搭档，再进入真实的学习与共作。</p></div></aside>';
    return '<div class="onb-shell"><div class="onb-topline"><span>邀请制内测</span><span>' + (live() ? '实时账号' : '示例 · 本机') + '</span></div><div class="onb-workspace">' + visual + '<div class="onb-flow">' + progress() + /* safe: step renderers escape their dynamic values */ stepHtml + '</div></div></div>';
  }

  function view() {
    state.model = load();
    return '<main class="onb-page" data-onboard>' + inner() + '</main>';
  }

  function paint(focusAct) {
    if (!state.root) return;
    state.root.innerHTML = inner();
    if (focusAct) {
      var next = state.root.querySelector('[data-onb-act="' + focusAct + '"]');
      if (next) next.focus({ preventScroll: true });
    }
  }

  function feedback(message) {
    var node = state.root && state.root.querySelector('[data-onb-feedback]');
    if (node) node.textContent = message || '';
  }

  function messageFor(error) {
    var code = error && error.code;
    if (code === 'invite_invalid') return '这个邀请码无效、已使用或已过期。请向邀请人确认后重试。';
    if (code === 'state_conflict') return '这个 Handle 已被占用。换一个更具体的名称再试。';
    if (code === 'validation_failed' || code === 'unknown_field') return '有一项格式不符合要求。请检查 Handle、展示名和密码长度。';
    if (code === 'rate_limited') return '尝试太频繁了。请按提示稍后再试，当前输入仍在。';
    if (code === 'network_error') return '没有连上账号服务。当前输入仍在，请检查网络后重试。';
    return (error && error.message) || '账号没有创建成功。当前输入仍在，请重试。';
  }

  function advance(step) {
    state.model.step = Math.max(1, Math.min(4, step));
    save();
    paint();
    var heading = state.root && state.root.querySelector('h1');
    if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
  }

  function openLegal(kind) {
    var meta = LEGAL[kind] || LEGAL.rules;
    if (typeof C().modal === 'function') C().modal(meta.title, legalBody(kind));
  }

  function selectLimited(key, value, max) {
    var form = state.root && state.root.querySelector('[data-onb-form="identity"]');
    if (form) {
      state.model.displayName = String(form.elements.displayName.value || '').trim();
      state.model.intro = String(form.elements.intro.value || '').trim();
    }
    var list = state.model[key].slice();
    var index = list.indexOf(value);
    if (index >= 0) list.splice(index, 1);
    else if (list.length < max) list.push(value);
    else { toast('最多选择 ' + max + ' 个。'); return; }
    state.model[key] = list;
    save();
    paint(key === 'directions' ? 'direction' : 'tool');
  }

  function onClick(event) {
    var button = event.target.closest('[data-onb-act]');
    if (!button || !state.root || !state.root.contains(button)) return;
    var act = button.dataset.onbAct;
    if (act === 'legal') openLegal(button.dataset.doc);
    else if (act === 'step') advance(Number(button.dataset.step));
    else if (act === 'back') advance(state.model.step - 1);
    else if (act === 'next') advance(state.model.step + 1);
    else if (act === 'direction') selectLimited('directions', button.dataset.value, 3);
    else if (act === 'tool') selectLimited('tools', button.dataset.value, 8);
    else if (act === 'panda') { state.model.panda = button.dataset.value; save(); paint('panda'); }
    else if (act === 'skip-panda') { state.model.panda = 'brand-blue'; advance(4); }
    else if (act === 'first') { state.model.firstAction = button.dataset.value; save(); paint('first'); }
    else if (act === 'skip-first') { state.model.firstAction = state.model.firstAction || 'hot'; finish(); }
    else if (act === 'finish') finish();
  }

  function finish() {
    if (!state.model.firstAction) { feedback('先选一件事；也可以点「先进入社区」。'); return; }
    state.model.completed = true;
    save();
    paint();
    toast('欢迎加入。你已是 L1 新队员。');
    var heading = state.root && state.root.querySelector('h1');
    if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
  }

  function submitDoor(form) {
    var data = new FormData(form);
    var handle = String(data.get('handle') || '').trim().toLowerCase();
    var invite = String(data.get('invite') || '').trim();
    var password = String(data.get('password') || '');
    if (!/^[a-z0-9_]{3,32}$/.test(handle)) { feedback('Handle 只能用 3–32 位小写字母、数字或下划线。'); form.elements.handle.focus(); return; }
    if (password.length < 10) { feedback('密码至少 10 个字符。'); form.elements.password.focus(); return; }
    if (!data.get('legal') || !data.get('privacy') || !data.get('adult')) { feedback('请先读完规则、协议和声明，并确认已满 18 岁。'); return; }
    state.secrets.invite = invite;
    state.secrets.password = password;
    state.model.handle = handle;
    state.model.legal = true;
    state.model.privacy = true;
    state.model.adult = true;
    save();
    advance(2);
  }

  function submitIdentity(form) {
    if (state.busy) return;
    var data = new FormData(form);
    var displayName = String(data.get('displayName') || '').trim();
    var intro = String(data.get('intro') || '').trim();
    if (!displayName) { feedback('请填写展示名。'); form.elements.displayName.focus(); return; }
    state.model.displayName = displayName;
    state.model.intro = intro;
    save();
    if (!live() || state.model.registered) {
      state.model.registered = true;
      state.model.registeredMode = live() ? 'live' : 'demo';
      save();
      advance(3);
      return;
    }
    if (!state.secrets.invite || !state.secrets.password) {
      feedback('邀请码和密码不会落盘。请返回第一步重新输入，再继续注册。');
      return;
    }
    state.busy = true;
    paint();
    var generation = state.generation;
    if (state.controller) state.controller.abort();
    state.controller = window.AbortController ? new AbortController() : null;
    window.CommonsAPI.post('/auth/register', {
      invite_code: state.secrets.invite,
      handle: state.model.handle,
      password: state.secrets.password,
      display_name: displayName,
      adult_confirmed: !!state.model.adult
    }, { idempotencyKey: window.CommonsAPI.newIdempotencyKey(), signal: state.controller && state.controller.signal }).then(function () {
      if (generation !== state.generation || !state.root) return;
      state.model.registered = true;
      state.model.registeredMode = 'live';
      state.secrets.invite = '';
      state.secrets.password = '';
      save();
      var finish = function () {
        state.busy = false;
        if (typeof C().go === 'function') C().go('home');
        else location.hash = '#/home';
      };
      var session = window.CommonsSession;
      if (session && typeof session.refresh === 'function') Promise.resolve(session.refresh()).then(finish, finish);
      else finish();
    }).catch(function (error) {
      if (generation !== state.generation || !state.root || (error && error.name === 'AbortError')) return;
      state.busy = false;
      paint();
      feedback(messageFor(error));
    });
  }

  function onSubmit(event) {
    var form = event.target.closest('[data-onb-form]');
    if (!form || !state.root || !state.root.contains(form)) return;
    event.preventDefault();
    if (!form.reportValidity()) return;
    if (form.dataset.onbForm === 'door') submitDoor(form);
    if (form.dataset.onbForm === 'identity') submitIdentity(form);
  }

  function on(target, type, handler) {
    target.addEventListener(type, handler);
    state.unbind.push(function () { target.removeEventListener(type, handler); });
  }

  function mount() {
    var root = document.querySelector('[data-onboard]');
    if (!root) return;
    destroy();
    state.root = root;
    state.model = load();
    on(document, 'click', onClick);
    on(document, 'submit', onSubmit);
  }

  function destroy() {
    state.generation += 1;
    state.unbind.forEach(function (unbind) { unbind(); });
    state.unbind = [];
    if (state.controller) state.controller.abort();
    state.controller = null;
    state.root = null;
    state.busy = false;
    state.secrets.invite = '';
    state.secrets.password = '';
  }

  if (window.CommonsLinks && typeof window.CommonsLinks.provide === 'function') {
    window.CommonsLinks.provide('onboard', function () {
      return { label: '新人引导', href: '#/welcome', icon: 'spark' };
    });
  }

  window.CommonsOnboard = { routes: { welcome: view }, mount: mount, destroy: destroy };
  (window.CommonsPages = window.CommonsPages || []).push(window.CommonsOnboard);
})();
