/* R6 Design Contract
 * Membership: one identity card, evidence rows, and two columns of preferences.
 * Events: one chronological agenda; date, host and actions stay in the same row.
 * Teaching: frame code/evidence only; separate context, drafts and consent with rules.
 * Rhythm: shared role tokens; compact controls on desktop, 44px targets on phones.
 * Preserve: 44px controls, whole date cells, focus, local drafts and dual consent.
 * Acceptance: 320/390px review by controller; synthetic data, no live device calls.
 */
(function () {
  'use strict';
  const api = () => window.Commons;
  function isLive() { return !!(window.CommonsAPI && window.CommonsAPI.mode === 'live'); }
  function sampleExt() { return (!isLive() && window.COMMONS_EXTENSIONS_SAMPLE) || { plans: [], events: [], lessons: [], cast: {} }; }
  const plans = () => sampleExt().plans || [];
  const events = () => sampleExt().events || [];
  const lessons = () => sampleExt().lessons || [];
  const teacherName = () => (sampleExt().cast && sampleExt().cast.teacher) || '老师';
  const esc = value => api().esc(String(value == null ? '' : value));
  const read = (key, fallback) => api().read('extensions.' + key, fallback);
  const write = (key, value) => {
    try { return api().write('extensions.' + key, value) === true; }
    catch { api().toast('保存失败，本次输入仍保留在页面中，请复制后保留。'); return false; }
  };
  /* safe-slot: label, attrs — 调用方传入写死文案、glyph() 与已 esc 的 data-* 片段 */
  const button = (label, action, attrs, primary) => '<button type="button" class="button' + (primary ? ' primary' : '') + '" data-action="' + esc(action) + '"' + (attrs ? ' ' + attrs : '') + '>' + label + '</button>';
  const glyph = name => {
    const paths = {
      book: '<path d="M12 5C8 3 5 3 3 4v16c3-1 6-1 9 1 3-2 6-2 9-1V4c-2-1-5-1-9 1Zm0 0v16"/>',
      spark: '<path d="m12 3 3 6 6 3-6 3-3 6-3-6-6-3 6-3Z"/><path d="M12 8v8m-4-4h8"/>',
      file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z"/><path d="M14 3v6h6M8 13h8m-8 4h5"/>',
      flow: '<rect x="3" y="3" width="6" height="6" rx="1.5"/><rect x="15" y="15" width="6" height="6" rx="1.5"/><path d="M6 9v9h9M9 6h9v9"/>',
      search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
      link: '<path d="m10 13 4-4m-6 6-2 2a3 3 0 0 1-4-4l5-5a3 3 0 0 1 4 0m2 1 2-2a3 3 0 0 1 4 4l-5 5a3 3 0 0 1-4 0"/>',
      code: '<path d="m8 7-5 5 5 5m8-10 5 5-5 5m-3-14-2 18"/>',
      grid: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
      pin: '<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 0 1 14 0Z"/><circle cx="12" cy="10" r="2"/>',
      arrow: '<path d="M4 12h15m-5-5 5 5-5 5"/>',
      check: '<path d="m5 12 4 4 10-10"/>',
      play: '<path d="m9 5 10 7-10 7Z"/>',
      calendar: '<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M8 3v4m8-4v4M4 11h16"/>',
      camera: '<rect x="3" y="6" width="12" height="12" rx="2"/><path d="m15 10 6-3v10l-6-3M3 3l18 18"/>',
      mic: '<path d="M9 9V5a3 3 0 0 1 6 0v8m-6 0a3 3 0 0 0 5 2M5 10v2a7 7 0 0 0 12 5m2-5v-2M12 19v3m-3 0h6M3 3l18 18"/>',
      shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z"/><path d="m8 12 3 3 5-6"/>',
      pen: '<path d="m15 4 5 5M4 20l5-1L21 7l-5-5L4 14Z"/>',
      lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 4v3"/>',
      users: '<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3m2-16a3 3 0 0 1 0 6m2 10v-3a6 6 0 0 0-2-4"/>'
    };
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (paths[name] || paths.arrow) + '</svg>';
  };
  let eventFilter = 'all';
  let eventDay = 'all';
  let teachingPane = 'workspace';
  let workspaceView = 'flow';
  const practiceDrafts = Object.create(null);
  const noteDrafts = Object.create(null);
  let teachingMode = 'one';
  let lessonIndex = 1;
  let evaluationRun = false;
  let assistance = { status: 'watch', scopes: [], teacherConsent: false, expires: 0 };
  let assistanceTimer = null;
  let practiceDemo = { sample: '', prompt: '' };

  function savedPracticeAnswer(step) {
    const answers = read('practiceAnswers', {});
    return answers[step] || (step === 1 ? read('practiceAnswer', '') : '');
  }
  function practiceSaveStatus(answer, savedAnswer) {
    if (answer !== savedAnswer) return { state: 'dirty', label: '有修改，尚未保存' };
    return savedAnswer ? { state: 'saved', label: '已保存当前步骤' } : { state: 'empty', label: '当前步骤未保存' };
  }
  function updatePracticeSaveStatus(answer) {
    const node = document.querySelector('[data-practice-save-status]');
    if (!node) return;
    const status = practiceSaveStatus(answer, savedPracticeAnswer(lessonIndex));
    if (node.textContent !== status.label) node.textContent = status.label;
    node.dataset.state = status.state;
  }
  function updateNoteSaveStatus(text) {
    const node = document.querySelector('[data-note-save-status]');
    if (!node) return;
    const label = text ? '批注尚未保存' : '';
    if (node.textContent !== label) node.textContent = label;
  }

  function profile() {
    const value=read('member-profile-v1',null), member=window.CommonsMember?.identity();
    return {name:member?.name||'我的空间',line:String(value?.bio||'把自己的尝试与作品留下来。'),preference:String(value?.seek||value?.give||'填写自己的合作方向'),role:String(value?.role||'尚未填写方向')};
  }
  function redraw(route) {
    const node = document.querySelector('[data-ext-page="' + route + '"]');
    if (!node) return;
    const active = document.activeElement;
    const wasInside = active && node.contains(active);
    const action = wasInside && active.dataset ? active.dataset.action : '';
    const value = wasInside && active.dataset ? active.dataset.value : '';
    const itemId = wasInside && active.dataset ? active.dataset.id : '';
    const activeId = wasInside ? active.id : '';
    const fromCourseMenu = wasInside && active.closest && active.closest('.teach-course-menu');
    node.outerHTML = route === 'membership' ? renderMembership() : routes[route]();
    if (action || activeId) {
      const fresh = document.querySelector('[data-ext-page="' + route + '"]');
      const matches = fresh ? Array.from(fresh.querySelectorAll('[data-action], [id]')).filter(el => activeId ? el.id === activeId : el.dataset.action === action && (el.dataset.value || '') === (value || '') && (el.dataset.id || '') === (itemId || '')) : [];
      let match = fromCourseMenu && fresh ? fresh.querySelector('.teach-course-menu > summary') : matches.find(el => el.getClientRects().length > 0) || matches[0];
      if (!match && fresh) {
        const nextAction = { 'ext-assist-request': 'ext-assist-consent', 'ext-assist-consent': 'ext-assist-revoke', 'ext-assist-revoke': 'ext-assist-request' }[action];
        if (nextAction) match = fresh.querySelector('[data-action="' + nextAction + '"]');
      }
      if (match) match.focus({ preventScroll: true });
    }
  }
  function demoNote(className) {
    return '<details class="ext-disclosure ' + esc(className) + '-demo"><summary>关于此预览</summary><p>本页内容为演示，资料只存在本机。</p></details>';
  }
  function liveEmpty(title, copy) {
    return '<section class="club-page" data-ext-page="' + esc(title) + '"><div class="page-head"><h1>' + esc(title) + '</h1></div><div class="event-filter-empty">' + glyph('calendar') + '<h3>' + esc(copy) + '</h3></div></section>';
  }
  function renderMembership() {
    if (isLive() && !plans().length) {
      return '<section class="club-page" id="ia-membership" data-ext-page="membership"><div class="club-ia-toolbar"><h2>会馆权益</h2></div><div class="event-filter-empty">' + glyph('users') + '<h3>会馆权益还没有开通</h3><p>开通后会显示你的权益档位。</p></div></section>';
    }
    const person = profile();
    const selected = read('membership', 'basic');
    const rawTheme = read('theme', 'silver');
    const theme = ({ forest: 'silver', clay: 'blue', ink: 'graphite' })[rawTheme] || rawTheme;
    const selectedPlan = plans().find(plan => plan.id === selected) || plans()[0];
    const visibility = read('visibility', 'private');
    const visible = {
      public: ['公开', 'RAG 验收清单', '方法 · 公开'],
      members: ['社区成员', '检索实验手记', '手记 · 社区成员'],
      private: ['仅自己', '下一轮实验草稿', '草稿 · 仅自己']
    }[visibility] || ['公开', 'RAG 验收清单', '方法 · 公开'];
    return `<section class="club-page" id="ia-membership" data-ext-page="membership" aria-labelledby="ia-membership-title">
      <div class="club-ia-toolbar"><h2 id="ia-membership-title">会馆权益</h2>${button('编辑展示 ' + glyph('pen'), 'ext-profile-edit', '', false)}</div>
      <div class="club-top-grid">
        <section class="club-identity-panel" aria-label="我的展示名片">
          <article class="club-identity" data-theme="${esc(theme)}">
            <div class="club-identity-top"><span class="club-card-brand">${api().brandMark()}<span>先锋<small>会员卡</small></span></span><span class="club-card-tier">${esc(selectedPlan.name)}</span></div>
            <div class="club-card-owner"><span class="club-card-avatar member-self-avatar" aria-hidden="true">${esc(Array.from(person.name)[0])}</span><div><h2>${esc(person.name)}</h2><p>${esc(person.role)}</p></div></div>
            <p class="club-card-statement">${esc(person.line)}</p>
            <div class="club-card-bottom"><span class="club-card-sigil" aria-hidden="true">${api().brandMark()}</span></div>
          </article>
          <div class="club-card-settings"><div class="club-theme-options" role="group" aria-label="会员卡外观">${[['silver', '冷银'], ['blue', '雾蓝'], ['graphite', '石墨']].map(item => `<button type="button" class="club-theme-option" data-action="ext-theme" data-value="${item[0]}" aria-pressed="${theme === item[0]}"><span class="club-theme-swatch club-theme-${item[0]}">${theme === item[0] ? glyph('check') : ''}</span><span>${item[1]}</span></button>`).join('')}</div>${button('预览主页 ' + glyph('arrow'), 'ext-profile-preview', '', false)}</div>
          <div class="club-cooperation"><span class="club-cooperation-dot"></span><span>${esc(person.preference)}</span></div>
        </section>
        <aside class="club-contribution"><div class="club-panel-heading"><div><h2>贡献凭据</h2><p class="club-local-label">做过的事会记在这里。</p></div>${button('查看凭据 ' + glyph('arrow'), 'ext-contributions', '', false)}</div>
          <div class="club-contribution-list">${[['file', '共写验收清单', '版本修订 · 作者确认'], ['flow', '复现一次实践', '运行环境 · 结果与限制'], ['users', '回应同行问题', '具体建议 · 后续修改']].map(record => `<article><span class="club-record-icon">${glyph(record[0])}</span><div><strong>${record[1]}</strong><p>${record[2]}</p></div><span class="club-record-arrow" aria-hidden="true">↗</span></article>`).join('')}</div>
        </aside>
      </div>
      <div class="club-settings-grid"><section class="club-rights"><div class="club-section-head"><h2>创作方式</h2></div>
        <p class="club-local-label">先选现在适合自己的方式。</p>
        <div class="club-plan-tabs" role="group" aria-label="会员权益选择">${plans().map(plan => `<button type="button" data-action="ext-plan" data-value="${esc(plan.id)}" aria-pressed="${selectedPlan.id === plan.id}"><span>${esc(plan.name)}</span><small>${({basic:'学习与参与',creator:'分享与教学',studio:'团队与共作'})[plan.id]}</small></button>`).join('')}</div>
        <div class="club-plan-detail" aria-live="polite"><dl>${[['book', '学习与内容', 'access'], ['grid', '主页与可见范围', 'studio'], ['users', '教学与活动', 'teaching']].map(row => `<div><dt>${glyph(row[0])}${row[1]}</dt><dd>${esc(selectedPlan[row[2]])}</dd></div>`).join('')}</dl></div>
      </section>
        <section class="club-privacy"><div class="club-section-head"><h2>谁能看见</h2>${glyph('lock')}</div><p class="club-scope-explain">公开、社区成员、仅自己，三选一。</p><div class="club-segmented segmented" role="group" aria-label="谁能看见">${[['public', '公开'], ['members', '社区成员'], ['private', '仅自己']].map(item => button(item[1], 'ext-visibility', `data-value="${item[0]}" aria-pressed="${visibility === item[0]}"`, false)).join('')}</div>
        <div class="club-scope-preview" aria-live="polite"><span class="club-file-icon">${glyph('file')}</span><div><h3>${visible[1]}</h3><span>${visible[2]}</span></div></div></section></div>
      <aside class="club-studio-panel"><span class="club-studio-icon">${glyph('grid')}</span><div><h2>个人工作室</h2><p>课程笔记、作业与下一件作品。</p></div>${button('去我的工作台 ' + glyph('arrow'), 'ext-studio', '', false)}</aside>
      </section>`;
  }

  function eventSaved(id) { return read('savedEvents', []).includes(id); }
  function eventRegistered(id) { return read('registrations', []).some(item => item.id === id); }
  function renderEvents() {
    if (isLive() && !events().length) {
      return '<section class="event-page" data-ext-page="events"><div class="page-head"><h1>活动</h1></div><div class="event-filter-empty">' + glyph('calendar') + '<h3>还没有活动</h3><p>活动发布后会出现在这里。</p></div></section>';
    }
    const shown = events().filter(item => (eventFilter === 'all' || item.mode === eventFilter) && (eventDay === 'all' || item.day === eventDay)).sort((a, b) => Number(a.day) - Number(b.day));
    const saved = events().filter(item => eventSaved(item.id));
    const dates = [['24', '六'], ['25', '日'], ['26', '一'], ['27', '二'], ['28', '三'], ['29', '四'], ['30', '五'], ['31', '六']];
    return `<section class="event-page" data-ext-page="events">
      <div class="page-head"><h1>活动</h1>${button(glyph('calendar') + ' 我的日程' + (saved.length ? ' · ' + saved.length : ''), 'ext-my-schedule', '', false)}</div>
      <section class="event-agenda"><div class="event-section-heading"><div><h2>十月日程</h2><span class="event-agenda-count">${shown.length} 场活动</span></div><div class="event-filter segmented" role="group" aria-label="活动方式筛选">${[['all', '全部'], ['online', '线上'], ['offline', '线下']].map(item => button(item[1], 'ext-event-filter', `data-value="${item[0]}" aria-pressed="${eventFilter === item[0]}"`, false)).join('')}</div></div>
        <div class="event-calendar-shell"><div class="event-calendar-strip" role="group" aria-label="选择活动日期"><button type="button" class="event-all-dates" data-action="ext-event-day" data-value="all" aria-pressed="${eventDay === 'all'}">全部</button>${dates.map(item => `<button type="button" data-action="ext-event-day" data-value="${item[0]}" aria-label="10月${item[0]}日，周${item[1]}" aria-pressed="${eventDay === item[0]}"><span>${item[1]}</span><strong>${item[0]}</strong><i class="${events().some(event => event.day === item[0]) ? 'has-event' : ''}" aria-hidden="true"></i></button>`).join('')}</div><span class="event-calendar-hint" aria-hidden="true">左右滑动 ↔</span></div>
        <div class="event-list" aria-live="polite">${shown.length ? shown.map(item => `<article class="event-row"><div class="event-date"><strong>${esc(item.day)}</strong><span>${esc(item.weekday)}</span></div><div class="event-row-body"><h3><button class="event-title-button" type="button" data-action="ext-event-details" data-id="${esc(item.id)}">${esc(item.title)}</button></h3><div class="event-row-meta"><span class="event-kind event-kind-${esc(item.mode)}">${esc(item.kind)}</span><span>${esc(item.kind === '回放' ? item.duration : item.time)}</span><span class="event-row-host">${esc(item.hosts.replace(/（[^）]*）/g, ''))}</span></div></div><div class="event-row-actions">${button(eventSaved(item.id) ? glyph('check') : glyph('calendar'), 'ext-event-save', `data-id="${esc(item.id)}" aria-pressed="${eventSaved(item.id)}" aria-label="${eventSaved(item.id) ? '移出日程：' : '保存日程：'}${esc(item.title)}" title="${eventSaved(item.id) ? '已存日程，点击移除' : '保存日程'}"`, false)}${item.id === 'open-mic' ? button(glyph('play') + ' 开场前预览', 'ext-event-wait', 'data-id="open-mic"', false) : ''}${button(item.kind === '回放' ? '预览章节' : eventRegistered(item.id) ? '查看报名意向' : '保存报名意向', item.kind === '回放' ? 'ext-event-details' : 'ext-event-register', `data-id="${esc(item.id)}"`, false)}</div></article>`).join('') : `<div class="event-filter-empty">${glyph('calendar')}<h3>这天没有安排</h3><p>换个日期，看看其他安排。</p>${button('查看全部日期', 'ext-event-day', 'data-value="all"', false)}</div>`}</div></section>
      <div class="event-sponsor-line"><span>日程与报名意向仅存本机；赞助支持单独署名。</span>${button('赞助规则 ' + glyph('arrow'), 'ext-sponsor-info', '', false)}</div>${demoNote('event')}</section>`;
  }

  function expireAssistance() {
    if (assistance.status === 'active' && Date.now() >= assistance.expires) {
      assistance = { status: 'expired', scopes: [], teacherConsent: false, expires: 0 };
    }
  }
  const codeSamples = [
    ['SERVICE = {', '    "audience": "客服团队",', '    "sources": "已审核资料",', '    "must_cite": True,', '    "unknown": "明确拒答",', '}', '', 'def in_scope(question):', '    return question in {"保修政策", "产品参数"}'],
    ['def verify_answer(answer, sources):', '    citations = answer["citations"]', '    if not citations:', '        return "缺少来源"', '', '    for ref in citations:', '        if ref not in sources:', '            return "引用无效"', '', '    return "仍需人工检查证据支持"'],
    ['CASES = [', '    ("常见问题", "回答并引用"),', '    ("条件不明", "先追问"),', '    ("资料缺失", "明确拒答"),', '    ("资料冲突", "展示冲突"),', ']', '', 'for question, expected in CASES:', '    print(question, expected)'],
    ['DELIVERY = {', '    "scope": "服务边界.md",', '    "cases": "评估集.csv",', '    "results": "原始结果.json",', '    "steps": "复现说明.md",', '    "limits": "已知限制.md",', '}', '', 'assert all(DELIVERY.values())']
  ];
  function teacherScreen(step) {
    const lesson = lessons()[step];
    const evidence = [
      ['服务范围 · 边界说明', '每条结论须带来源；资料不足时拒答。'],
      ['保修条款 · 第 4 条', '适用范围取决于产品购买地区。'],
      ['评估清单 · 行为分类', '回答、追问、拒答与冲突都需要对应样本。'],
      ['交付目录 · 复现要求', '服务边界、原始结果与复现步骤一起交付。']
    ][step];
    return `<section class="teach-workspace" data-workspace-view="${esc(workspaceView)}">
      <div class="teach-workspace-toolbar"><div>${glyph('flow')}<strong>${esc(lesson.short)}</strong></div><div class="teach-workspace-switch segmented" role="group" aria-label="练习视图">${[['flow', '流程'], ['code', '代码']].map(item => button(item[1], 'ext-workspace-view', `data-value="${item[0]}" aria-pressed="${workspaceView === item[0]}"`, false)).join('')}</div>${button(glyph('play') + ' 模拟验收', 'ext-evaluate', '', false)}</div>
      <div class="teach-workbench-grid"><div class="teach-code-editor"><div class="teach-code-header"><span>${glyph('code')} verify_answer.py</span><small>只读</small></div><ol tabindex="0" aria-label="只读示例代码">${codeSamples[step].map(line => `<li><code class="${/^(def |for |assert)/.test(line.trim()) ? 'teach-code-keyword' : line.includes('"') ? 'teach-code-string' : ''}">${line ? esc(line) : '&nbsp;'}</code></li>`).join('')}</ol><div class="teach-code-foot"><span>Python</span><span>示例代码 · 不执行</span></div></div>
      <div class="teach-flow-view"><div class="teach-flow-heading"><span>${esc(lesson.tab)}</span><span class="teach-view-label">步骤 ${esc(step + 1)} / 4</span></div><div class="teach-flow-nodes">${[['file', '资料'], ['search', '检索'], ['link', '引用'], ['shield', '验收']].map((node, index) => `<div class="teach-flow-node${index === Math.min(step + 1, 3) ? ' teach-flow-selected' : ''}"><span>${glyph(node[0])}</span><strong>${node[1]}</strong>${index < 3 ? `<i aria-hidden="true">${glyph('arrow')}</i>` : ''}</div>`).join('')}</div>
      <div class="teach-result-panel${evaluationRun ? ' is-evaluated' : ''}" aria-live="polite"><div class="teach-result-head"><strong>验收判断</strong><span class="${evaluationRun ? 'teach-result-reviewed' : ''}">${evaluationRun ? '模拟结果' : '练习样本'}</span></div><p class="teach-result-answer">${esc(lesson.result)}</p><div class="teach-source-evidence"><strong>${evidence[0]}</strong><p>“${evidence[1]}”</p></div>${evaluationRun ? `<div class="teach-evaluation-feedback">${glyph('check')}<p>${esc(step === 1 ? '下一步：确认购买地区，再判断是否适用。' : lesson.task)}</p></div>` : ''}${practiceDemo.sample || practiceDemo.prompt ? `<div class="teach-demo-change"><strong>本次协助</strong>${practiceDemo.sample ? `<p>${esc(practiceDemo.sample)}</p>` : ''}${practiceDemo.prompt ? `<p>${esc(practiceDemo.prompt)}</p>` : ''}</div>` : ''}</div></div></div></section>`;
  }

  function assistancePanel() {
    expireAssistance();
    const status = assistance.status;
    const active = status === 'active';
    const requested = status === 'requested';
    const label = { watch: '仅观看', requested: '等待学员确认', active: '本机协助中', revoked: '已撤销', expired: '已到期' }[status] || '仅观看';
    const copy = active ? '仅限下方练习，最长 10 分钟；刷新失效，可立即撤销。' : requested ? '老师已同意规则，请由学员确认这一次的范围。' : '每次都需双方确认；不连接真实设备。';
    return `<section class="teach-assistance${active ? ' teach-assistance-active' : ''}" aria-label="远程协助演示"><div class="teach-assist-head">${glyph('shield')}<div><h3>共同操作</h3><p>${copy}</p></div><span class="teach-assist-status" role="status">${label}</span></div>
      ${active ? `<div class="teach-scope-list"><strong>本次允许</strong>${assistance.scopes.map(scope => `<span>${esc(scope)}</span>`).join('')}</div><div class="teach-assist-actions">${assistance.scopes.includes('在合成画布添加批注') ? button('模拟批注', 'ext-assist-demo', 'data-value="annotation"', false) : ''}${assistance.scopes.includes('选择合成评估样本') ? button('模拟选样本', 'ext-assist-demo', 'data-value="sample"', false) : ''}${assistance.scopes.includes('修改示例提示词') ? button('模拟改提示词', 'ext-assist-demo', 'data-value="prompt"', false) : ''}${button('立即撤销授权', 'ext-assist-revoke', '', true)}</div>` : requested ? `<div class="teach-assist-actions">${button('确认范围', 'ext-assist-consent', '', true)}${button('取消请求', 'ext-assist-revoke', '', false)}</div>` : `<div class="teach-assist-actions">${button('请求共同操作', 'ext-assist-request', '', false)}</div>`}</section>`;
  }
  function renderTeaching() {
    if (isLive() && !lessons().length) {
      return '<section class="teach-page" data-ext-page="teaching"><div class="page-head"><h1>共作课堂</h1></div><div class="event-filter-empty">' + glyph('book') + '<h3>课堂还没有开</h3><p>开课后会显示步骤和练习。</p></div></section>';
    }
    const lesson = lessons()[lessonIndex];
    const notes = read('notes', []);
    const assignment = read('assignment', '');
    const savedAnswer = savedPracticeAnswer(lessonIndex);
    const answer = Object.prototype.hasOwnProperty.call(practiceDrafts, lessonIndex) ? practiceDrafts[lessonIndex] : savedAnswer;
    const noteDraft = noteDrafts[lessonIndex] || '';
    const saveStatus = practiceSaveStatus(answer, savedAnswer);
    const stepButton = (item, index) => `<button type="button" data-action="ext-lesson-step" data-value="${index}" aria-label="${index + 1}. ${esc(item.title)}，${esc(item.duration)}" aria-current="${index === lessonIndex ? 'step' : 'false'}"><span class="teach-step-number">${index + 1}</span><span><strong><span class="teach-step-full">${esc(item.short)}</span><span class="teach-step-compact" aria-hidden="true">${['定义', '依据', '评估', '交付'][index]}</span></strong><small>${esc(item.duration)}</small></span></button>`;
    return `<section class="teach-page" data-ext-page="teaching" data-teaching-pane="${esc(teachingPane)}">
      <div class="page-head"><h1>共作课堂</h1>${button('工作室设置 ' + glyph('arrow'), 'ext-studio-settings', '', false)}</div>
      <div class="teach-class-context"><div class="teach-class-heading"><div><div class="teach-class-meta"><span>RAG 实践课</span><span>60 分钟</span></div><h2>把客服 RAG 做成可验收服务</h2></div><div class="teach-mode segmented" role="group" aria-label="教学形式">${button('1 对 1', 'ext-teach-mode', `data-value="one" aria-pressed="${teachingMode === 'one'}"`, false)}${button('4 人小班', 'ext-teach-mode', `data-value="group" aria-pressed="${teachingMode === 'group'}"`, false)}</div></div>
      <div class="teach-session-strip"><div class="teach-participants"><div class="teach-participant" aria-label="${esc((sampleExt().cast && sampleExt().cast.teacher) || '老师')}，老师"><span class="teach-person-avatar avatar face face-5" aria-hidden="true"></span><strong>${esc((sampleExt().cast && sampleExt().cast.teacher) || '老师')}<small>老师</small></strong></div><span class="teach-participant-divider" aria-hidden="true">↔</span><div class="teach-participant" aria-label="${esc(profile().name)}，学员"><span class="teach-person-avatar member-self-avatar" aria-hidden="true">${esc(Array.from(profile().name)[0])}</span><strong>${esc(profile().name)}<small>学员</small></strong></div>${teachingMode === 'group' && sampleExt().cast && sampleExt().cast.classmates ? '<div class="teach-classmates"><span class="avatar face face-1" aria-hidden="true"></span><span class="avatar face face-3" aria-hidden="true"></span><span>' + esc(sampleExt().cast.classmates) + '</span></div>' : ''}</div><span class="teach-session-status">${glyph('lock')} 未连接设备</span></div></div>
      <div class="teach-mobile-navigation"><div class="teach-mobile-tabs segmented" role="group" aria-label="课堂分区">${[['workspace', '看示范', 'play'], ['practice', '自己练', 'pen'], ['notes', '留批注', 'file']].map(item => button(glyph(item[2]) + item[1], 'ext-teaching-pane', `data-value="${item[0]}" aria-pressed="${teachingPane === item[0]}"`, false)).join('')}</div><details class="teach-course-menu"><summary aria-label="课程步骤：当前第 ${lessonIndex + 1} 步，${esc(lesson.short)}">${lessonIndex + 1} / 4 · ${['定义', '依据', '评估', '交付'][lessonIndex]}</summary><div class="teach-step-strip" role="group" aria-label="课程步骤">${lessons().map(stepButton).join('')}</div></details></div>
      <div class="teach-layout"><div class="teach-main"><div class="teach-pane-workspace">${teacherScreen(lessonIndex)}<section class="teach-instructor-note"><div class="teach-panel-heading"><h3>${esc(lesson.title)}</h3></div><ol>${lesson.lines.map(line => `<li>${esc(line)}</li>`).join('')}</ol></section></div>
        <section class="teach-learner teach-pane-practice"><div class="teach-panel-heading"><h3>轮到你了</h3><span>仅本机</span></div><p class="teach-practice-prompt">${esc(lesson.task)}</p><form data-form="ext-practice"><label class="teach-sr-only" for="ext-practice-answer">写下当前步骤的验收判断</label><textarea id="ext-practice-answer" name="answer" rows="4" maxlength="1000" placeholder="写下你的判断，以及它的依据…">${esc(answer)}</textarea><div class="teach-practice-footer"><span data-practice-save-status data-state="${saveStatus.state}" role="status">${saveStatus.label}</span><button type="submit" class="button primary">保存练习</button></div></form></section>
        <section class="teach-notes teach-pane-notes"><div class="teach-section-heading"><h2>课堂批注</h2><span class="teach-note-count">${notes.length} 条</span></div><form data-form="ext-note" class="teach-note-form"><label class="teach-sr-only" for="ext-note-text">为当前步骤添加批注</label><input id="ext-note-text" name="note" maxlength="240" placeholder="在这一步，留下一个具体问题…" value="${esc(noteDraft)}" required><button class="button" type="submit">${glyph('pen')} 保存批注</button></form><p class="teach-draft-status" data-note-save-status role="status">${noteDraft ? '批注尚未保存' : ''}</p><div class="teach-note-list" aria-live="polite">${notes.length ? notes.slice(-3).reverse().map(note => `<article><span class="teach-note-step">步骤 ${esc(note.step + 1)} · 本机草稿</span><p>${esc(note.text)}</p></article>`).join('') : `<div class="teach-note-empty">${glyph('pen')}<p>${esc(lesson.prompt)}</p></div>`}</div></section>
        ${assistancePanel()}
      </div><aside class="teach-sidebar"><section class="teach-curriculum"><div class="teach-section-heading"><h2>课程路径</h2><span>${lessonIndex + 1} / 4</span></div><ol>${lessons().map((item, index) => `<li>${stepButton(item, index)}</li>`).join('')}</ol><div class="teach-current-task"><span>当前任务</span><p>${esc(lesson.task)}</p>${lessonIndex < 3 ? button('继续下一步 ' + glyph('arrow'), 'ext-lesson-next', '', true) : button('整理作业 ' + glyph('arrow'), 'ext-assignment', '', true)}</div></section>
        <section class="teach-assignment"><span class="teach-assignment-icon">${glyph('file')}</span><div><h3>你的交付说明</h3><p>范围、复现步骤与已知限制。</p></div>${button(assignment ? '继续编辑作业' : '写交付说明', 'ext-assignment', '', false)}<span class="teach-assignment-status">${assignment ? '已有本机草稿 · 未提交' : '仅保存本机'}</span></section></aside></div>
      <div class="teach-device-bar"><span>设备状态</span><div>${button(glyph('mic') + ' 麦克风关闭', 'ext-device-info', 'data-value="麦克风"', false)}${button(glyph('camera') + ' 摄像头关闭', 'ext-device-info', 'data-value="摄像头"', false)}</div></div>${demoNote('teach')}</section>`;
  }

  function eventById(id) { return events().find(item => item.id === id); }
  function eventDetails(item) {
    api().modal(item.title, '<div class="event-modal"><p class="event-modal-meta">' + esc(item.month) + esc(item.day) + '日 · ' + esc(item.time) + ' · ' + esc(item.kind) + '</p><p>' + esc(item.desc) + '</p><div class="event-modal-agenda">' + item.agenda.map(row => '<div><time>' + esc(row[0]) + '</time><span>' + esc(row[1]) + '</span></div>').join('') + '</div><p class="event-modal-note">' + (item.kind === '回放' ? '此处展示回放章节结构，未接入真实视频。' : item.mode === 'offline' ? '城市、场地、容量和取消规则待正式确认；当前记录仅保留为本机意向。' : item.kind === '直播' ? '直播以观看为主；开场前预览不启动会议，也不开启任何设备。' : '小班会议支持交流与练习；正式会议服务尚未接入。') + '</p><div class="event-modal-actions">' + button(eventSaved(item.id) ? '已保存本机日程' : '保存到本机日程', 'ext-event-save', 'data-id="' + esc(item.id) + '"', false) + (item.kind === '回放' ? '' : button('本机演示报名', 'ext-event-register', 'data-id="' + esc(item.id) + '"', true)) + '</div></div>');
  }
  function eventRegistration(item) {
    const previous = read('registrations', []).find(value => value.id === item.id);
    api().modal(previous ? '本机报名记录' : '演示报名 · ' + item.label, '<form class="event-form" data-form="ext-registration"><input type="hidden" name="event" value="' + esc(item.id) + '"><p><strong>' + esc(item.title) + '</strong><br>' + esc(item.month) + esc(item.day) + '日 · ' + esc(item.time) + ' · ' + esc(item.kind) + '</p><label class="field">展示称呼<input name="name" maxlength="24" required value="' + esc(previous ? previous.name : profile().name) + '"></label><label class="field">希望带走什么<textarea name="intent" rows="3" maxlength="300" placeholder="例如：一份能和同事共同使用的验收清单">' + esc(previous ? previous.intent : '') + '</textarea></label><div class="event-form-notice">' + glyph('shield') + '<p>只保存到本机演示记录，不发送给活动组织者，不预留真实席位。</p></div><button class="button primary" type="submit">' + (previous ? '更新本机记录' : '保存本机报名意向') + '</button></form>');
  }
  function requestAssistance() {
    expireAssistance();
    if (assistance.status === 'active') return;
    api().modal('老师提出共同操作请求', '<form class="teach-consent-form" data-form="ext-assist-request"><div class="teach-consent-person"><span class="teach-mini-avatar avatar face face-5" aria-hidden="true"></span><div><strong>' + esc(teacherName()) + ' · 合成老师</strong><p>向 ' + esc(profile().name) + ' 请求协助当前练习</p></div></div><p>先由老师确认协助规则，再由学员选择本次操作范围。每次请求都需要重新授权。</p><div class="teach-safety-boundary"><strong>演示边界</strong><p>只在合成练习区域模拟批注、选样本或修改示例。不会控制真实设备，不涉及文件、账号、支付、发布或系统设置。</p></div><label class="teach-check-row"><input type="checkbox" name="teacherConsent" required><span>我以老师角色确认：只在学员本次明确授权的范围内演示，尊重随时撤销。</span></label><button type="submit" class="button primary">模拟提出请求</button><p class="teach-modal-footnote">本机角色演示，不会向任何人发送请求。</p></form>');
  }
  function consentAssistance() {
    if (assistance.status !== 'requested' || !assistance.teacherConsent) return;
    api().modal('学员确认本次授权范围', '<form class="teach-consent-form" data-form="ext-assist-consent"><div class="teach-consent-person"><span class="teach-mini-avatar teach-avatar-clay">' + esc(profile().name.slice(-1)) + '</span><div><strong>' + esc(profile().name) + ' · 学员角色</strong><p>确认' + esc(teacherName()) + '的本次协助请求</p></div></div><fieldset class="teach-scope-options"><legend>允许本次演示的动作（至少一项）</legend><label class="teach-check-row"><input type="checkbox" name="scope" value="在合成画布添加批注" checked><span>在合成画布添加批注</span></label><label class="teach-check-row"><input type="checkbox" name="scope" value="选择合成评估样本"><span>选择合成评估样本</span></label><label class="teach-check-row"><input type="checkbox" name="scope" value="修改示例提示词"><span>修改示例提示词</span></label></fieldset><p class="teach-safety-boundary">文件、账号、支付、发布、系统设置均不在范围。当前步骤变化后也需重新确认；刷新失效，最长 10 分钟。</p><label class="teach-check-row"><input type="checkbox" name="learnerConsent" required><span>我以学员角色确认这一次授权，并知道可随时撤销。</span></label><p class="teach-form-error" data-ext-error role="alert"></p><div class="teach-consent-actions"><button class="button primary" type="submit">允许这次协助</button>' + button('拒绝', 'ext-assist-revoke', '', false) + '</div><p class="teach-modal-footnote">此预览不控制真实设备。双方授权均为本机角色演示。</p></form>');
  }
  function stopAssistance(status) {
    if (assistanceTimer) window.clearTimeout(assistanceTimer);
    assistanceTimer = null;
    assistance = { status: status || 'revoked', scopes: [], teacherConsent: false, expires: 0 };
  }

  function handle(action, el) {
    const data = el.dataset || {};
    if (!action || !action.startsWith('ext-')) return false;
    if (action === 'ext-plan') {
      if (!plans.some(item => item.id === data.value)) return true;
      if (!write('membership', data.value)) return true; redraw('membership'); api().toast('已记下创作方式。');
    } else if (action === 'ext-theme') {
      if (!['silver', 'blue', 'graphite'].includes(data.value)) return true;
      if (!write('theme', data.value)) return true; redraw('membership'); api().toast('已换卡面。');
    } else if (action === 'ext-visibility') {
      if (!['public', 'members', 'private'].includes(data.value)) return true;
      if (!write('visibility', data.value)) return true; redraw('membership'); api().toast('已记下谁能看见。');
    } else if (action === 'ext-profile-edit') {
      api().go('join');
    } else if (action === 'ext-profile-preview') {
      api().go('profile');
    } else if (action === 'ext-contributions') {
      api().modal('贡献凭据', '<div class="club-evidence"><p>做过的共写、复现和回应会记在这里。</p><dl><div><dt>方法共写</dt><dd>清单修订、作者确认与引用来源。</dd></div><div><dt>复现实践</dt><dd>运行环境、复现步骤、结果与限制。</dd></div><div><dt>同行帮助</dt><dd>具体建议、接收方反馈与后续修改。</dd></div></dl></div>');
    } else if (action === 'ext-studio') {
      api().go('me');
    } else if (action === 'ext-event-day') {
      if (data.value === 'all' || /^(24|25|26|27|28|29|30|31)$/.test(data.value)) { eventDay = data.value; redraw('events'); }
    } else if (action === 'ext-event-filter') {
      if (['all', 'online', 'offline'].includes(data.value)) { eventFilter = data.value; redraw('events'); }
    } else if (action === 'ext-event-save') {
      const item = eventById(data.id);
      if (!item) return true;
      const saved = read('savedEvents', []);
      const has = saved.includes(item.id);
      if (!write('savedEvents', has ? saved.filter(id => id !== item.id) : saved.concat(item.id))) return true;
      redraw('events');
      el.innerHTML = has ? glyph('calendar') + ' 保存日程' : glyph('check') + ' 已存日程';
      el.setAttribute('aria-pressed', String(!has));
      api().toast(has ? '已从本机日程移除。' : '已保存到本机日程；未同步外部日历。');
    } else if (action === 'ext-event-details') {
      const item = eventById(data.id); if (item) eventDetails(item);
    } else if (action === 'ext-event-register') {
      const item = eventById(data.id); if (item) eventRegistration(item);
    } else if (action === 'ext-my-schedule') {
      const saved = events().filter(item => eventSaved(item.id));
      api().modal('我的本机日程', '<div class="event-saved-list">' + (saved.length ? saved.map(item => '<article><span>' + esc(item.month) + esc(item.day) + '日 · ' + esc(item.time) + '</span><h3>' + esc(item.title) + '</h3><p>' + esc(item.kind) + ' · 合成排期</p>' + button('查看安排', 'ext-event-details', 'data-id="' + esc(item.id) + '"', false) + '</article>').join('') : '<div class="event-schedule-empty">' + glyph('calendar') + '<h3>留一点时间，给下一次共作。</h3><p>在活动列表选择“保存日程”，它会出现在这里。仅保存本机，不连接外部日历。</p></div>') + '</div>');
    } else if (action === 'ext-event-wait') {
      const item = eventById(data.id); if (!item) return true;
      api().modal('开场前预览 · ' + esc(item.label), '<div class="event-waiting"><div class="event-wait-stage"><span class="event-wait-mark">' + glyph('play') + '</span><span>开场前示意</span><h3>' + esc(item.title) + '</h3><p>' + esc(item.month) + esc(item.day) + '日 · ' + esc(item.time) + '</p><div>等待正式活动接入</div></div><div class="event-wait-status"><span>' + glyph('mic') + ' 麦克风未启用</span><span>' + glyph('camera') + ' 摄像头未启用</span></div><p>这里只展示开场前体验，没有连接会议或直播，也不会访问任何设备。</p>' + button('试用共作课堂 ' + glyph('arrow'), 'ext-wait-to-teaching', '', true) + '</div>');
    } else if (action === 'ext-wait-to-teaching') {
      api().closeModal(); api().go('teaching');
    } else if (action === 'ext-sponsor-info') {
      api().modal('赞助关系清楚可见', '<div class="event-sponsor-info"><p>正式活动中的赞助将单独署名，并说明提供的是场地、工具、费用还是奖品。</p><ul><li>赞助不购买作品排名或贡献声誉。</li><li>内容评审与参与规则独立公开。</li><li>活动页明确标记商业关系和适用范围。</li><li>成员联系信息不会因赞助自动分享。</li></ul><p class="event-modal-note">当前仅为展示样例，没有真实品牌、赞助合同或交易。</p></div>');
    } else if (action === 'ext-teaching-pane') {
      if (['workspace', 'practice', 'notes'].includes(data.value)) { teachingPane = data.value; redraw('teaching'); }
    } else if (action === 'ext-workspace-view') {
      if (['flow', 'code'].includes(data.value)) { workspaceView = data.value; redraw('teaching'); }
    } else if (action === 'ext-teach-mode') {
      if (!['one', 'group'].includes(data.value)) return true;
      teachingMode = data.value;
      if (assistance.status === 'active' || assistance.status === 'requested') { stopAssistance('revoked'); api().toast('教学形式已切换；此前演示授权已撤销。'); }
      redraw('teaching');
    } else if (action === 'ext-lesson-step' || action === 'ext-lesson-next') {
      const next = action === 'ext-lesson-next' ? Math.min(3, lessonIndex + 1) : Number(data.value);
      if (!Number.isInteger(next) || next < 0 || next > 3) return true;
      if (next !== lessonIndex && (assistance.status === 'active' || assistance.status === 'requested')) { stopAssistance('revoked'); api().toast('练习步骤已变化；请为新范围重新授权。'); }
      if (lessonIndex !== next) practiceDemo = { sample: '', prompt: '' };
      evaluationRun = false;
      lessonIndex = next; redraw('teaching');
    } else if (action === 'ext-evaluate') {
      evaluationRun = true; workspaceView = 'flow'; teachingPane = 'workspace'; redraw('teaching'); api().toast('已展示合成验收结果；没有执行代码或调用外部服务。');
    } else if (action === 'ext-device-info') {
      api().toast('这是教学场景预览，' + data.value + '未启用，也未请求设备权限。');
    } else if (action === 'ext-assist-request') {
      requestAssistance();
    } else if (action === 'ext-assist-consent') {
      consentAssistance();
    } else if (action === 'ext-assist-revoke') {
      stopAssistance('revoked'); api().closeModal(); redraw('teaching'); api().toast('本次演示授权已撤销。再次协助需要双方重新确认。');
    } else if (action === 'ext-assist-demo') {
      expireAssistance();
      if (assistance.status !== 'active') { redraw('teaching'); api().toast('授权已结束，请重新请求。'); return true; }
      const operation = data.value || 'annotation';
      const scopeFor = { annotation: '在合成画布添加批注', sample: '选择合成评估样本', prompt: '修改示例提示词' };
      if (!scopeFor[operation] || !assistance.scopes.includes(scopeFor[operation])) { api().toast('本次未授权此动作；请撤销后重新选择范围。'); return true; }
      if (operation === 'annotation') {
        const notes = read('notes', []);
        if (!write('notes', notes.concat({ step: lessonIndex, text: '协助演示：先把这条结论与来源逐句对照，再判断是否需要追问。', origin: 'local-assistance' }).slice(-30))) return true;
      } else if (operation === 'sample') {
        practiceDemo.sample = '已选样本 C：资料缺失时，应明确拒答。';
      } else {
        practiceDemo.prompt = '示例提示词：仅依据已审核资料回答；资料不足时说明缺口并请求补充。';
      }
      redraw('teaching'); api().toast('本机练习已显示本次协助演示；未控制任何设备。');
    } else if (action === 'ext-assignment') {
      api().modal('整理作业', '<form class="teach-assignment-form" data-form="ext-assignment"><p>用一页说明你做了什么、如何验证，以及还有哪些限制。</p><label class="field">作业内容<textarea name="assignment" rows="8" maxlength="3000" required placeholder="1. 服务边界与必须拒答的情况&#10;2. 一个失败样本及复现步骤&#10;3. 验收方法与已知限制">' + esc(read('assignment', '')) + '</textarea></label><p class="teach-modal-footnote">只保存到本机，不会提交给老师，也不会发布。</p><button class="button primary" type="submit">保存草稿</button></form>');
    } else if (action === 'ext-studio-settings') {
      const scope = read('studioScope', 'private');
      api().modal('工作室设置', '<form class="teach-studio-form" data-form="ext-studio"><div class="teach-studio-preview"><span class="teach-studio-avatar">' + esc(profile().name.slice(-1)) + '</span><div><h3>' + esc(profile().name) + '的实践手记</h3><p>课程笔记 · 作业草稿 · 作品整理</p></div></div><fieldset class="teach-scope-options"><legend>默认内容可见范围（演示）</legend>' + [['private', '仅自己', '草稿只出现在个人空间'], ['invited', '受邀成员', '由你逐个邀请后才可访问'], ['group', '社区成员', '对社区成员开放']].map(item => '<label class="teach-check-row"><input type="radio" name="scope" value="' + item[0] + '"' + (scope === item[0] ? ' checked' : '') + '><span><strong>' + item[1] + '</strong><small>' + item[2] + '</small></span></label>').join('') + '</fieldset><p class="teach-modal-footnote">付费权益不会自动改变内容可见范围。此处只保存本机偏好。</p><button class="button primary" type="submit">保存设置</button></form>');
    } else return false;
    return true;
  }

  function submit(formName, form) {
    if (!formName || !formName.startsWith('ext-')) return false;
    const values = new FormData(form);
    if (formName === 'ext-registration') {
      const id = String(values.get('event') || '');
      const name = String(values.get('name') || '').trim();
      if (!eventById(id) || !name) { api().toast('请填写展示称呼后重试。'); return true; }
      const records = read('registrations', []).filter(item => item.id !== id);
      if (!write('registrations', records.concat({ id: id, name: name.slice(0, 24), intent: String(values.get('intent') || '').trim().slice(0, 300) }))) return true;
      api().closeModal(); redraw('events'); api().toast('已保存本机报名意向；未发送、未预留真实席位。');
    } else if (formName === 'ext-note') {
      const rawNote = String(values.get('note') || '');
      noteDrafts[lessonIndex] = rawNote;
      updateNoteSaveStatus(rawNote);
      const text = rawNote.trim();
      if (!text) { api().toast('写下一条具体疑问再保存。'); return true; }
      const notes = read('notes', []);
      if (!write('notes', notes.concat({ step: lessonIndex, text: text.slice(0, 240), origin: 'local' }).slice(-30))) return true;
      noteDrafts[lessonIndex] = '';
      redraw('teaching'); api().toast('批注已保存到本机，未发送。');
    } else if (formName === 'ext-practice') {
      const rawAnswer = String(values.get('answer') || '');
      practiceDrafts[lessonIndex] = rawAnswer;
      updatePracticeSaveStatus(rawAnswer);
      const answer = rawAnswer.trim();
      if (!answer) { api().toast('写下你的验收判断后再保存。'); return true; }
      const answers = read('practiceAnswers', {});
      if (!write('practiceAnswers', { ...answers, [lessonIndex]: answer.slice(0, 1000) })) return true;
      practiceDrafts[lessonIndex] = answer.slice(0, 1000);
      redraw('teaching'); api().toast('练习副本已保存到本机，未分享或提交。');
    } else if (formName === 'ext-assignment') {
      const text = String(values.get('assignment') || '').trim();
      if (!text) { api().toast('请先写下要保存的作业内容。'); return true; }
      if (!write('assignment', text.slice(0, 3000))) return true; api().closeModal(); redraw('teaching'); api().toast('作业草稿已保存在本机，未提交。');
    } else if (formName === 'ext-studio') {
      const scope = String(values.get('scope') || 'private');
      if (!['private', 'invited', 'group'].includes(scope)) return true;
      if (!write('studioScope', scope)) return true; api().closeModal(); redraw('teaching'); api().toast('工作室范围偏好已保存；真实权限未改变。');
    } else if (formName === 'ext-assist-request') {
      if (!values.has('teacherConsent')) { api().toast('请先确认老师角色的协助规则。'); return true; }
      stopAssistance('watch');
      assistance = { status: 'requested', scopes: [], teacherConsent: true, expires: 0 };
      api().closeModal(); redraw('teaching'); api().toast('本机请求已建立；下一步由学员角色确认本次范围。');
    } else if (formName === 'ext-assist-consent') {
      if (assistance.status !== 'requested' || !assistance.teacherConsent) { api().closeModal(); api().toast('请求已失效，请重新发起。'); return true; }
      const allowed = ['在合成画布添加批注', '选择合成评估样本', '修改示例提示词'];
      const scopes = values.getAll('scope').map(String).filter(value => allowed.includes(value));
      if (!scopes.length || !values.has('learnerConsent')) {
        const error = form.querySelector('[data-ext-error]');
        if (error) error.textContent = !scopes.length ? '请至少选择一项本次允许的演示动作。' : '请确认学员角色的本次授权。';
        return true;
      }
      assistance = { status: 'active', scopes: scopes, teacherConsent: true, expires: Date.now() + 600000 };
      assistanceTimer = window.setTimeout(() => { stopAssistance('expired'); redraw('teaching'); }, 600000);
      api().closeModal(); redraw('teaching'); api().toast('已进入本机演示协助；可立即撤销，不控制真实设备。');
    } else return false;
    return true;
  }
  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape') return;
    const menu = event.target.closest && event.target.closest('.teach-course-menu[open]');
    if (!menu) return;
    menu.open = false;
    menu.querySelector('summary').focus({ preventScroll: true });
    event.preventDefault();
  });
  document.addEventListener('input', function (event) {
    if (event.target.id === 'ext-practice-answer') {
      practiceDrafts[lessonIndex] = event.target.value;
      updatePracticeSaveStatus(event.target.value);
    }
    if (event.target.id === 'ext-note-text') {
      noteDrafts[lessonIndex] = event.target.value;
      updateNoteSaveStatus(event.target.value);
    }
  });
  window.addEventListener('hashchange', function () {
    if (window.location.hash.split('?')[0] !== '#/teaching' && (assistance.status === 'active' || assistance.status === 'requested')) stopAssistance('revoked');
  });
  function reset() {
    stopAssistance('watch');
    for (const key of Object.keys(practiceDrafts)) delete practiceDrafts[key];
    for (const key of Object.keys(noteDrafts)) delete noteDrafts[key];
    eventFilter = 'all';
    eventDay = 'all';
    teachingPane = 'workspace';
    workspaceView = 'flow';
    teachingMode = 'one';
    lessonIndex = 1;
    evaluationRun = false;
    practiceDemo = { sample: '', prompt: '' };
  }
  const routes = { membership: () => window.CommonsGrowth.routes.membership(), events: renderEvents, teaching: renderTeaching };
  window.CommonsExtensions = { routes: routes, hub: ['membership'], membershipSection: renderMembership, handle: handle, submit: submit, reset: reset };
}());

