/* Design Contract
 * 任务：按具体目标找搭子，把邀约和组队计划留成本机记录。
 * 层级：需求类型 → 紧凑人物与作品行 → 我的跟进 → 联系偏好。
 * 布局：桌面双栏，手机连续列表；不做等权卡片墙。
 * 状态：筛选、空记录、编辑、保存失败、撤回、重新保存。
 * 边界：人物仅取 COMMONS_DATA；示例需求与本机草稿分开，不发送或匹配。
 * 验收：输入转义、原生表单、主要触控至少 44px；真实界面由主控验收。
 */
(function () {
  'use strict';

  const api = () => window.Commons;
  const data = () => window.COMMONS_DATA || { people: [], works: [] };
  function isLive() {
    return !!(window.CommonsAPI && window.CommonsAPI.mode === 'live');
  }
  const esc = value => api().esc(String(value == null ? '' : value));
  const icon = name => api().icon(name);
  const types = [
    { id: 'project', label: '做项目', icon: 'project' },
    { id: 'learn', label: '一起学习', icon: 'book' },
    { id: 'review', label: '互相评审', icon: 'check' }
  ];
  const examples = () => {
    if (isLive()) return [];
    const bag = window.COMMONS_BUDDIES_SAMPLE;
    return (bag && Array.isArray(bag.examples)) ? bag.examples : [];
  };
  let currentType = 'all';
  let mineView = 'intents';
  let sequence = 0;

  const person = id => data().people.find(item => item.id === id);
  const currentPersonId = () => api().currentPersonId || 'local-self';
  const type = id => types.find(item => item.id === id) || types[0];
  const isKind = id => types.some(item => item.id === id);
  const requests = () => examples().filter(item => item.personId !== currentPersonId() && person(item.personId)?.available === true);
  const text = value => typeof value === 'string' ? value : '';
  const recordFields = ['id', 'kind', 'title', 'outcome', 'schedule', 'contribution', 'note', 'createdAt', 'updatedAt'];

  function readState() {
    const raw = api().read('buddies.state', {});
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const normalize = (items, intent) => (Array.isArray(items) ? items : []).filter(item => item && typeof item === 'object' && text(item.id) && isKind(item.kind) && (!intent || (person(item.personId) && item.personId !== currentPersonId()))).map(item => {
      const record = Object.fromEntries(recordFields.map(key => [key, text(item[key])]));
      if (intent) return { ...record, personId: text(item.personId), requestId: text(item.requestId), status: item.status === 'withdrawn' ? 'withdrawn' : 'saved' };
      return { ...record, partner: text(item.partner), status: item.status === 'paused' ? 'paused' : 'draft' };
    });
    return {
      version: 1,
      contactPreference: source.contactPreference === 'open' ? 'open' : 'closed',
      intents: normalize(source.intents, true),
      drafts: normalize(source.drafts, false)
    };
  }

  function writeState(state) {
    try { return api().write('buddies.state', state) === true; }
    catch { api().toast('保存未完成，输入还在，请重试或复制保留。'); return false; }
  }

  function refresh() {
    if (typeof api().refresh === 'function') api().refresh();
    else api().go('buddies');
  }

  function focusFollowup(scroll) {
    const heading = document.getElementById('buddy-followup-heading');
    heading?.focus({ preventScroll: true });
    if (scroll) heading?.scrollIntoView({ block: 'start', behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  }

  function afterSave(view, message) {
    mineView = view;
    api().closeModal();
    if (document.body?.dataset.route === 'buddies') refresh();
    else api().go('buddies');
    api().toast(message);
  }

  function avatar(id) {
    const index = data().people.findIndex(item => item.id === id);
    return `<span class="avatar face face-${index} buddy-avatar" aria-hidden="true"></span>`;
  }

  function workLink(personId, full) {
    const member = person(personId);
    const work = data().works.find(item => member?.works.includes(item.id));
    return work ? `<a class="buddy-work-link" href="#/work/${esc(work.id)}"${full ? '' : ` aria-label="查看作品：${esc(work.title)}"`}>${icon('link')}<span>${full ? esc(work.title) : '看作品'}</span>${full ? icon('arrow') : ''}</a>` : '';
  }

  function requestRow(request, state) {
    const member = person(request.personId);
    const saved = state.intents.find(item => item.personId === member.id && item.requestId === request.id && item.status === 'saved');
    return `<article class="buddy-demand">
      <div class="buddy-demand-body">
        <h3>${esc(request.title)}</h3>
        <div class="buddy-demand-meta"><span>${request.skills.map(esc).join(' / ')}</span><span>${esc(request.schedule)}</span></div>
      </div>
      <div class="buddy-demand-footer"><div class="buddy-person-line"><a href="#/people/${esc(member.id)}">${avatar(member.id)}${esc(member.name)}</a>${currentType === 'all' ? `<span class="buddy-kind">${esc(type(request.kind).label)}</span>` : ''}</div><div class="buddy-demand-action">${workLink(member.id, false)}<button type="button" class="button buddy-invite${saved ? ' tonal is-saved' : ''}" data-action="buddy-invite" data-id="${esc(member.id)}" data-request="${esc(request.id)}">${saved ? icon('check') + ' 查看意向' : '约个搭子 ' + icon('arrow')}</button>${saved ? '<small>本机 · 未发送</small>' : ''}</div></div>
    </article>`;
  }

  function savedDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '本机记录' : `${date.getMonth() + 1}月${date.getDate()}日更新`;
  }

  function intentRow(item) {
    const member = person(item.personId);
    const withdrawn = item.status === 'withdrawn';
    return `<li class="buddy-followup-row${withdrawn ? ' is-inactive' : ''}">
      <div class="buddy-followup-person">${avatar(member.id)}<a href="#/people/${esc(member.id)}">${esc(member.name)}</a><span>${esc(type(item.kind).label)}</span></div>
      <h3>${esc(item.title)}</h3><p class="buddy-followup-time">${esc(item.schedule)}</p>
      <div class="buddy-followup-meta"><span>${withdrawn ? '已撤回本机意向' : '本机意向 · 未发送'}</span><time datetime="${esc(item.updatedAt)}">${esc(savedDate(item.updatedAt))}</time></div>
      <div class="buddy-row-actions"><button type="button" class="buddy-text-button" data-action="buddy-edit-intent" data-id="${esc(item.id)}">${withdrawn ? '重新保存' : '查看与编辑'}</button>${withdrawn ? '' : `<button type="button" class="buddy-text-button buddy-muted-button" data-action="buddy-withdraw" data-id="${esc(item.id)}" aria-label="撤回与${esc(member.name)}的本机意向">撤回意向</button>`}</div>
    </li>`;
  }

  function draftRow(item) {
    const paused = item.status === 'paused';
    return `<li class="buddy-followup-row${paused ? ' is-inactive' : ''}">
      <div class="buddy-draft-type">${icon(type(item.kind).icon)}<span>${esc(type(item.kind).label)}</span><span>我发起的</span></div>
      <h3>${esc(item.title)}</h3><p class="buddy-followup-time">${esc(item.schedule)}</p><p class="buddy-followup-partner"><b>找搭子</b>${esc(item.partner)}</p>
      <div class="buddy-followup-meta"><span>${paused ? '已收起 · 本机草稿' : '本机草稿 · 仅自己'}</span><time datetime="${esc(item.updatedAt)}">${esc(savedDate(item.updatedAt))}</time></div>
      <div class="buddy-row-actions"><button type="button" class="buddy-text-button" data-action="buddy-edit-draft" data-id="${esc(item.id)}">${paused ? '查看与继续编辑' : '继续编辑'}</button>${paused ? '' : `<button type="button" class="buddy-text-button buddy-muted-button" data-action="buddy-pause-draft" data-id="${esc(item.id)}">收起草稿</button>`}</div>
    </li>`;
  }

  function followup(state) {
    const intents = state.intents.filter(item => item.status === 'saved');
    const drafts = state.drafts.filter(item => item.status === 'draft');
    const items = mineView === 'intents' ? intents : drafts;
    const past = mineView === 'intents' ? state.intents.filter(item => item.status === 'withdrawn') : state.drafts.filter(item => item.status === 'paused');
    const row = mineView === 'intents' ? intentRow : draftRow;
    return `<section class="buddy-followup" aria-labelledby="buddy-followup-heading">
      <div class="buddy-section-heading"><h2 id="buddy-followup-heading" tabindex="-1">我的搭子</h2><span>本机记录</span></div>
      <div class="buddy-mine-tabs" role="group" aria-label="查看我的搭子记录"><button type="button" data-action="buddy-mine" data-value="intents" aria-pressed="${mineView === 'intents'}">我的意向 <span>${intents.length}</span></button><button type="button" data-action="buddy-mine" data-value="drafts" aria-pressed="${mineView === 'drafts'}">我发起的 <span>${drafts.length}</span></button></div>
      ${items.length ? `<ul class="buddy-followup-list">${items.map(row).join('')}</ul>` : `<div class="buddy-empty"><strong>${mineView === 'intents' ? '先找到一件想一起做的事' : '从一个小目标开始'}</strong><p>${mineView === 'intents' ? '点「约个搭子」写下意向，在这里继续编辑和跟进。' : '写清产物、时间和需要的人，再把组队草稿存下来。'}</p>${mineView === 'drafts' ? '<button type="button" class="buddy-text-button" data-action="buddy-publish">发起组队 ' + icon('arrow') + '</button>' : ''}</div>`}
      ${past.length ? `<details class="buddy-history"><summary>${mineView === 'intents' ? '已撤回的意向' : '已收起的草稿'} <span>${past.length}</span></summary><ul class="buddy-followup-list">${past.map(row).join('')}</ul></details>` : ''}
    </section>`;
  }

  function preference(state) {
    return `<section class="buddy-preference" aria-labelledby="buddy-preference-title"><div class="buddy-section-heading"><h2 id="buddy-preference-title">我的邀约偏好</h2>${icon('shield')}</div>
      <form data-form="buddy-preference"><fieldset><legend class="buddy-sr-only">是否愿意了解搭子邀约</legend>
        <label class="buddy-radio" for="buddy-contact-closed"><input id="buddy-contact-closed" name="contactPreference" type="radio" value="closed"${state.contactPreference === 'closed' ? ' checked' : ''}><span>暂不接受搭子邀约</span></label>
        <label class="buddy-radio" for="buddy-contact-open"><input id="buddy-contact-open" name="contactPreference" type="radio" value="open"${state.contactPreference === 'open' ? ' checked' : ''}><span>愿意了解具体的搭子邀约</span></label>
      </fieldset><div class="buddy-preference-bottom"><p>仅保存本机，不公开资料或接收真实消息。</p><button type="submit" class="button">保存偏好</button></div></form>
    </section>`;
  }

  function render() {
    if (isLive()) return liveRender();
    const state = readState();
    const all = requests();
    const shown = all.filter(item => currentType === 'all' || item.kind === currentType);
    const intentCount = state.intents.filter(item => item.status === 'saved').length;
    return `<div class="buddies-page">
      <div class="page-head buddy-page-head"><div><p>选一个具体任务，约一个一起推进的人。</p></div><div class="buddy-page-actions"><button type="button" class="button primary" data-action="buddy-publish">${icon('pen')}发起组队</button>${isLive() ? '' : '<span class="pill outline">示例</span>'}</div></div>
      <div class="buddy-layout"><section class="buddy-directory" aria-labelledby="buddy-directory-heading">
        <div class="buddy-type-tabs" role="group" aria-label="需求类型">${[{ id: 'all', label: '全部' }, ...types].map(item => `<button type="button" data-action="buddy-filter" data-value="${item.id}" aria-pressed="${currentType === item.id}">${item.label}<span>${item.id === 'all' ? all.length : all.filter(request => request.kind === item.id).length}</span></button>`).join('')}</div>
        <div class="buddy-list-heading"><h2 id="buddy-directory-heading">${shown.length} 个任务</h2><button type="button" class="buddy-text-button buddy-jump-mine" data-action="buddy-jump-mine">我的意向 <span>${intentCount}</span>${icon('arrow')}</button></div>
        <div class="buddy-demand-list">${shown.length ? shown.map(item => requestRow(item, state)).join('') : '<div class="buddy-empty"><strong>这个类型还没有需求</strong><p>换个类型，或发起自己的组队草稿。</p></div>'}</div>
      </section><aside class="buddy-sidebar">${followup(state)}${preference(state)}</aside></div>
    </div>`;
  }

  function field(name, label, value, options = {}) {
    const id = 'buddy-field-' + name;
    const attrs = `id="${esc(id)}" name="${esc(name)}" maxlength="${esc(options.max || 160)}"${options.optional ? '' : ' required'}${options.placeholder ? ` placeholder="${esc(options.placeholder)}"` : ''}`;
    return `<div class="field"><label for="${esc(id)}">${esc(label)}${options.optional ? '<span class="buddy-optional">选填</span>' : ''}</label>${options.rows ? `<textarea ${attrs} rows="${esc(options.rows)}">${esc(value)}</textarea>` : `<input ${attrs} value="${esc(value)}">`}</div>`;
  }

  function typeSelect(value) {
    return `<div class="field"><label for="buddy-field-kind">这次想一起做什么</label><select id="buddy-field-kind" name="kind" required>${types.map(item => `<option value="${item.id}"${value === item.id ? ' selected' : ''}>${item.label}</option>`).join('')}</select></div>`;
  }

  function openInvite(personId, requestId, intentId) {
    if (isLive()) { api().toast('到「找搭子」里挑一个需求，再点「约个搭子」。'); api().go('buddies'); return false; }
    const member = person(personId);
    if (!member) { api().toast('没有找到这位示例成员，请回到搭子列表重试。'); return false; }
    if (personId === currentPersonId()) {
      api().toast('这是你的本机身份，可以发起一份组队草稿。');
      openDraft();
      return false;
    }
    const state = readState();
    const request = requests().find(item => item.id === requestId && item.personId === personId) || (!requestId ? requests().find(item => item.personId === personId) : null);
    const existing = intentId ? state.intents.find(item => item.id === intentId && item.personId === personId) : state.intents.find(item => item.personId === personId && item.requestId === (request?.id || '') && item.status === 'saved');
    if (intentId && !existing) { api().toast('这条本机意向已不存在，请重新选择。'); return false; }
    const draft = existing || { kind: request?.kind || 'project', title: request?.title || '', outcome: request?.outcome || '', schedule: request?.schedule || '', contribution: '', note: '' };
    api().modal(existing ? '查看与编辑搭子意向' : `约${member.name}做搭子`, `<div class="buddy-invite-person">${avatar(member.id)}<div><a href="#/people/${esc(member.id)}">${esc(member.name)}</a><p>${esc(member.role)}</p></div>${workLink(member.id, false)}</div>
      <p class="buddy-form-context">${member.available ? '这是合成人物与示例需求。写好的意向仅存本机，不会发送。' : '这位合成成员当前未开放搭子邀约。你可以留一份自己的意向，不会发送。'}</p>
      <form class="buddy-form" data-form="buddy-intent" data-id="${esc(existing?.id || '')}" data-person="${esc(member.id)}" data-request="${esc(existing?.requestId || request?.id || '')}">
        ${typeSelect(draft.kind)}${field('title', '想一起完成的目标', draft.title, { max: 100, placeholder: '例如：把一个检索原型做成可复现作品' })}
        ${field('outcome', '希望留下什么产物', draft.outcome, { rows: 2, max: 600, placeholder: '写清能看到、能检查的结果' })}
        <div class="buddy-form-pair">${field('schedule', '你能投入的时间', draft.schedule, { max: 120, placeholder: '每周几小时，持续多久' })}${field('contribution', '你可以负责什么', draft.contribution, { max: 240, placeholder: '你能带来的技能、资料或工作' })}</div>
        ${field('note', '想补充的话', draft.note, { rows: 2, max: 1000, optional: true, placeholder: '已有尝试、想先交流的问题' })}
        <p class="buddy-form-note">保存后可在「我的意向」继续编辑或撤回。此操作不建立联系或合作承诺。</p><div class="buddy-form-actions"><button type="button" class="button" data-action="buddy-close">返回</button><button type="submit" class="button primary">${existing?.status === 'withdrawn' ? '重新保存' : '保存本机意向'}</button></div>
      </form>`);
    return true;
  }

  function openDraft(id) {
    if (isLive()) { liveDraftModal(id ? live.mine.find(row => row.id === id) : null); return true; }
    const existing = id ? readState().drafts.find(item => item.id === id) : null;
    if (id && !existing) { api().toast('这份本机草稿已不存在，请重新发起。'); return false; }
    const draft = existing || { kind: currentType === 'all' ? 'project' : currentType, title: '', outcome: '', schedule: '', partner: '', contribution: '', note: '' };
    api().modal(existing ? '编辑组队草稿' : '发起一个组队草稿', `<form class="buddy-form" data-form="buddy-draft" data-id="${esc(existing?.id || '')}">
      ${typeSelect(draft.kind)}${field('title', '组队目标', draft.title, { max: 100, placeholder: '用一句话说清要完成什么' })}
      ${field('outcome', '具体产物与完成标准', draft.outcome, { rows: 2, max: 600, placeholder: '例如：一个可演示的原型，通过 10 个测试问题' })}
      <div class="buddy-form-pair">${field('schedule', '每周投入与持续时间', draft.schedule, { max: 120, placeholder: '例如：每周 3 小时，连续 2 周' })}${field('partner', '需要什么搭子', draft.partner, { max: 240, placeholder: '例如：1 位懂交互的伙伴，一起设计走查' })}</div>
      ${field('contribution', '你先负责什么', draft.contribution, { max: 240, placeholder: '已有准备，以及你愿意承担的部分' })}
      ${field('note', '补充说明', draft.note, { rows: 2, max: 1000, optional: true, placeholder: '合作方式、资料范围或退出约定' })}
      <p class="buddy-form-note">保存后只留在本机，不会通知成员；这里没有发布。</p><div class="buddy-form-actions"><button type="button" class="button" data-action="buddy-close">返回</button><button type="submit" class="button primary">保存组队草稿</button></div>
    </form>`);
    return true;
  }

  function validate(form, values, required) {
    if (typeof form.reportValidity === 'function' && !form.reportValidity()) return false;
    for (const [key, label] of required) {
      if (text(values.get(key)).trim()) continue;
      const input = form.elements.namedItem(key);
      input?.setCustomValidity(`请填写${label}，不能只有空格。`);
      input?.addEventListener('input', () => input.setCustomValidity(''), { once: true });
      input?.reportValidity();
      input?.focus();
      return false;
    }
    return true;
  }

  function saveForm(name, form) {
    if (isLive()) { api().toast('这个功能还没开放'); return true; }
    const values = new FormData(form);
    const state = readState();
    if (name === 'buddy-preference') {
      const preference = values.get('contactPreference');
      if (!['closed', 'open'].includes(preference)) return true;
      if (writeState({ ...state, contactPreference: preference })) {
        refresh();
        document.getElementById('buddy-contact-' + preference)?.focus({ preventScroll: true });
        api().toast('联系偏好已保存到本机，未公开或开启真实消息。');
      }
      return true;
    }
    const intent = name === 'buddy-intent';
    if (intent && form.dataset.person === currentPersonId()) {
      api().toast('不能约自己做搭子。请用「发起组队」写下需求，当前输入仍保留。');
      return true;
    }
    const required = [['title', intent ? '目标' : '组队目标'], ['outcome', '具体产物'], ['schedule', '投入时间'], ['contribution', '你负责的部分']];
    if (!intent) required.push(['partner', '所需搭子']);
    if (!validate(form, values, required)) return true;
    const kind = text(values.get('kind'));
    if (!isKind(kind)) { api().toast('请选择一种搭子需求类型。'); return true; }
    const collection = intent ? 'intents' : 'drafts';
    const existing = form.dataset.id ? state[collection].find(item => item.id === form.dataset.id) : null;
    if (form.dataset.id && !existing) { api().toast('原记录已变化，输入还在，请复制后重新发起。'); return true; }
    const member = intent ? person(form.dataset.person) : null;
    if (intent && !member) { api().toast('没有找到目标成员，输入仍保留。'); return true; }
    const now = new Date().toISOString();
    const limits = { title: 100, outcome: 600, schedule: 120, contribution: 240, note: 1000, partner: 240 };
    const content = Object.fromEntries(Object.keys(limits).filter(key => !intent || key !== 'partner').map(key => [key, text(values.get(key)).trim()]));
    const labels = { title: intent ? '目标' : '组队目标', outcome: '具体产物', schedule: '投入时间', contribution: '你负责的部分', note: '补充说明', partner: '所需搭子' };
    for (const [key, value] of Object.entries(content)) {
      if (value.length > limits[key]) { api().toast(`${labels[key]}太长了，请缩短到 ${limits[key]} 字以内。输入仍在。`); return true; }
    }
    const record = { ...content, kind, id: existing?.id || `buddy-${intent ? 'intent' : 'draft'}-${Date.now().toString(36)}-${++sequence}`, createdAt: existing?.createdAt || now, updatedAt: now, status: intent ? 'saved' : 'draft' };
    if (intent) {
      record.personId = member.id;
      record.requestId = examples().some(item => item.id === form.dataset.request && item.personId === member.id) ? form.dataset.request : '';
    }
    const next = { ...state, [collection]: [record, ...state[collection].filter(item => item.id !== record.id)] };
    if (writeState(next)) afterSave(collection, intent ? '搭子意向已存本机，未发送。' : '组队草稿已存本机，其他成员看不到。');
    return true;
  }

  function changeStatus(collection, id, status) {
    if (isLive()) { api().toast('这个功能还没开放'); return true; }
    const state = readState();
    const existing = state[collection].find(item => item.id === id);
    if (!existing) { api().toast('这条本机记录已不存在。'); return true; }
    const next = { ...state, [collection]: state[collection].map(item => item.id === id ? { ...item, status, updatedAt: new Date().toISOString() } : item) };
    if (writeState(next)) {
      mineView = collection;
      refresh();
      focusFollowup(false);
      api().toast(collection === 'intents' ? '已撤回本机意向。可在已撤回列表中重新编辑。' : '草稿已收起。可在已收起列表中继续编辑。');
    }
    return true;
  }

  /* ---------- 真实模式：需求、邀约、联系偏好都走服务器 ---------- */
  const live = { status: 'idle', token: 0, loadedAt: 0, posts: [], cursor: '', mine: [], sent: [], received: [], open: false, error: '', busy: false };
  const keys = new Map();
  const closedErr = error => !!error && (error.status === 501 || error.code === 'capability_unavailable');
  const failText = (error, fallback) => closedErr(error) ? '这个功能还没开放' : ((error && error.message) || fallback);
  const itemsOf = res => (res && res.data && Array.isArray(res.data.items)) ? res.data.items : [];
  const cursorOf = res => (res && res.meta && res.meta.cursor) || '';
  const KIND_LABEL = { sent: '已发出 · 等对方回复', withdrawn: '已撤回', accepted: '对方已接受', declined: '对方婉拒了' };

  // 同一个动作失败后重试，沿用上一次的幂等键；成功了才换新的。
  function send(method, path, body) {
    const a = window.CommonsAPI, sig = method + ' ' + path + ' ' + JSON.stringify(body || {});
    const opts = { idempotencyKey: keys.get(sig) || a.newIdempotencyKey() };
    keys.set(sig, opts.idempotencyKey);
    let call;
    try {
      if (method === 'PUT') call = a.put(path, body || {}, opts);
      else if (method === 'PATCH') call = a.patch(path, body || {}, opts);
      else if (method === 'DELETE') call = a.del(path, undefined, opts);
      else call = a.post(path, body || {}, opts);
    } catch (error) { call = Promise.reject(error); }
    return Promise.resolve(call).then(res => { keys.delete(sig); return res; });
  }

  function load(silent) {
    const a = window.CommonsAPI, token = ++live.token;
    if (!silent) live.status = 'loading';
    live.loadedAt = Date.now();
    Promise.all([
      a.get('/social/buddies', { limit: 50 }), a.get('/social/buddies', { mine: true, limit: 50 }),
      a.get('/social/buddy-invites', { box: 'sent', limit: 50 }), a.get('/social/buddy-invites', { box: 'received', limit: 50 }),
      a.get('/social/me')
    ]).then(res => {
      if (token !== live.token) return;
      live.posts = itemsOf(res[0]); live.cursor = cursorOf(res[0]);
      live.mine = itemsOf(res[1]); live.sent = itemsOf(res[2]); live.received = itemsOf(res[3]);
      live.open = !!(res[4] && res[4].data && res[4].data.prefs && res[4].data.prefs.buddy_open);
      live.status = 'ready'; live.error = ''; refresh();
    }).catch(error => {
      if (token !== live.token) return;
      if (silent && live.status === 'ready') return;
      live.status = 'error'; live.error = failText(error, '搭子没有载入'); refresh();
    });
  }

  function loadMore() {
    const a = window.CommonsAPI, cursor = live.cursor;
    if (!cursor || live.busy) return;
    live.busy = true;
    a.get('/social/buddies', { limit: 50, cursor }).then(res => {
      live.busy = false;
      const seen = new Set(live.posts.map(item => item.id));
      live.posts = live.posts.concat(itemsOf(res).filter(item => !seen.has(item.id)));
      live.cursor = cursorOf(res); refresh();
    }).catch(error => { live.busy = false; api().toast(failText(error, '更多需求没有载入，请重试。')); });
  }

  /* safe-fn: 头像 HTML 来自 CommonsAvatar（已转义）或本函数逐值转义的字母头像 */
  function liveAvatar(p) {
    const name = text(p && p.display_name) || '成员', src = text(p && p.avatar);
    if (window.CommonsAvatar && window.CommonsAvatar.html) return window.CommonsAvatar.html({ id: text(p && p.id), name, size: 24, src, level: Number(p && p.level) || 1, letter: !src });
    return `<span class="buddy-avatar" aria-hidden="true">${esc(name.slice(0, 1))}</span>`;
  }

  function liveWho(p) {
    return `<a href="#/u/${esc((p && (p.handle || p.id)) || '')}">${liveAvatar(p)}${esc((p && p.display_name) || '已注销成员')}</a>`;
  }

  // 被能力门挡住：返回 CommonsSession.reason(action) 的原因，没挡住返回空串。
  function whyNot(action) {
    const S = window.CommonsSession;
    if (!S || typeof S.can !== 'function' || S.can(action)) return '';
    return (typeof S.reason === 'function' && S.reason(action)) || '现在还不能这样做';
  }

  const REPORT_REASONS = ['广告刷屏', '骚扰辱骂', '违法违规', '其他'];

  /* safe-fn: 本函数逐值转义；没有举报权限时按钮灰掉并写原因 */
  function liveReportButton(kind, id) {
    const why = whyNot('social.buddy.report');
    return `<button type="button" class="buddy-text-button buddy-muted-button" data-action="buddy-report" data-kind="${esc(kind)}" data-id="${esc(id)}"${why ? ` disabled title="${esc(why)}"` : ''}>举报</button>`;
  }

  function liveReportModal(kind, id) {
    const why = whyNot('social.buddy.report');
    if (why) { api().toast(why); return true; }
    api().modal(kind === 'invite' ? '举报这条搭子邀约' : '举报这条搭子需求', `<form class="buddy-form" data-form="buddy-report" data-kind="${esc(kind)}" data-id="${esc(id)}">
      <fieldset class="field"><legend>原因</legend>${REPORT_REASONS.map((r, i) => `<label class="buddy-radio"><input type="radio" name="reason" value="${esc(r)}"${i === 0 ? ' checked' : ''}><span>${esc(r)}</span></label>`).join('')}</fieldset>
      <p class="buddy-form-note">治理员只会看到被举报的这一条，不会看到你们的其他记录。</p>
      <div class="buddy-form-actions"><button type="button" class="button" data-action="buddy-close">返回</button><button type="submit" class="button primary">提交举报</button></div></form>`);
    return true;
  }

  function liveRequestRow(post) {
    const blocked = post.contact_open && !post.invited ? whyNot('social.buddy.invite') : '';
    const action = blocked ? `<button type="button" class="button buddy-invite" disabled title="${esc(blocked)}">约个搭子</button><small>${esc(blocked)}</small>` : post.invited ? `<button type="button" class="button buddy-invite tonal is-saved" disabled>${icon('check')} 已发出邀约</button>`
      : post.contact_open ? `<button type="button" class="button buddy-invite" data-action="buddy-invite" data-id="${esc(post.id)}">约个搭子 ${icon('arrow')}</button>`
        : '<small>暂不接受邀约</small>';
    return `<article class="buddy-demand"><div class="buddy-demand-body"><h3>${esc(post.title)}</h3><div class="buddy-demand-meta"><span>${esc(post.partner)}</span><span>${esc(post.schedule)}</span></div></div>
      <div class="buddy-demand-footer"><div class="buddy-person-line">${liveWho(post.author)}${currentType === 'all' ? `<span class="buddy-kind">${esc(type(post.kind).label)}</span>` : ''}</div><div class="buddy-demand-action">${action}${liveReportButton('post', post.id)}</div></div></article>`;
  }

  function liveDmButton(person) {
    return person && person.id ? `<button type="button" class="buddy-text-button" data-action="buddy-dm" data-id="${esc(person.id)}" data-name="${esc(person.display_name || '')}">发私信</button>` : '';
  }

  function liveIntentRow(item) {
    const past = item.state === 'withdrawn' || item.state === 'declined';
    const acts = item.state === 'sent'
      ? `<button type="button" class="buddy-text-button" data-action="buddy-edit-intent" data-id="${esc(item.id)}">查看与编辑</button><button type="button" class="buddy-text-button buddy-muted-button" data-action="buddy-withdraw" data-id="${esc(item.id)}">撤回</button>`
      : item.state === 'accepted' ? liveDmButton(item.person)
        : `<button type="button" class="buddy-text-button" data-action="buddy-resend" data-id="${esc(item.id)}">重新发出</button>`;
    return `<li class="buddy-followup-row${past ? ' is-inactive' : ''}">
      <div class="buddy-followup-person">${liveWho(item.person)}<span>${esc(type(item.kind).label)}</span></div>
      <h3>${esc(item.title)}</h3><p class="buddy-followup-time">${esc(item.schedule)}</p>
      <div class="buddy-followup-meta"><span>${esc(KIND_LABEL[item.state] || '')}</span><time datetime="${esc(item.updated_at)}">${esc(savedDate(item.updated_at))}</time></div>
      <div class="buddy-row-actions">${acts}</div></li>`;
  }

  function livePostRow(item) {
    const paused = item.state === 'paused';
    const collapsed = !!item.collapsed;
    return `<li class="buddy-followup-row${paused || collapsed ? ' is-inactive' : ''}">
      <div class="buddy-draft-type">${icon(type(item.kind).icon)}<span>${esc(type(item.kind).label)}</span><span>我发起的</span></div>
      <h3>${esc(item.title)}</h3><p class="buddy-followup-time">${esc(item.schedule)}</p><p class="buddy-followup-partner"><b>找搭子</b>${esc(item.partner)}</p>
      <div class="buddy-followup-meta"><span>${collapsed ? '已被治理员收起 · 别人看不到，你不能自己重新发布' : paused ? '已收起 · 别人看不到' : '发布中 · 成员可见'}</span><time datetime="${esc(item.updated_at)}">${esc(savedDate(item.updated_at))}</time></div>
      <div class="buddy-row-actions"><button type="button" class="buddy-text-button" data-action="buddy-edit-draft" data-id="${esc(item.id)}">继续编辑</button>
      ${collapsed ? '' : `<button type="button" class="buddy-text-button buddy-muted-button" data-action="${paused ? 'buddy-resume-draft' : 'buddy-pause-draft'}" data-id="${esc(item.id)}">${paused ? '重新发布' : '收起'}</button>`}</div></li>`;
  }

  function liveReceivedRow(item) {
    const acts = item.state === 'sent'
      ? `<button type="button" class="buddy-text-button" data-action="buddy-answer" data-id="${esc(item.id)}" data-accept="1">接受</button><button type="button" class="buddy-text-button buddy-muted-button" data-action="buddy-answer" data-id="${esc(item.id)}" data-accept="0">婉拒</button>`
      : item.state === 'accepted' ? liveDmButton(item.person) : '';
    const report = liveReportButton('invite', item.id);
    const stateText = { sent: '等你回复', accepted: '你已接受', declined: '你已婉拒' }[item.state] || '';
    return `<li class="buddy-followup-row${item.state === 'declined' ? ' is-inactive' : ''}">
      <div class="buddy-followup-person">${liveWho(item.person)}<span>${esc(type(item.kind).label)}</span></div>
      <h3>${esc(item.title)}</h3><p class="buddy-followup-time">${esc(item.outcome)}</p><p class="buddy-followup-partner"><b>时间</b>${esc(item.schedule)}</p><p class="buddy-followup-partner"><b>负责</b>${esc(item.contribution)}</p>${item.note ? `<p class="buddy-followup-partner"><b>补充</b>${esc(item.note)}</p>` : ''}
      <div class="buddy-followup-meta"><span>${esc(stateText)}</span><time datetime="${esc(item.updated_at)}">${esc(savedDate(item.updated_at))}</time></div>
      <div class="buddy-row-actions">${acts}${report}</div></li>`;
  }

  function liveFollowup() {
    const view = ['intents', 'drafts', 'received'].includes(mineView) ? mineView : 'intents';
    const sets = {
      intents: [live.sent.filter(i => i.state === 'sent' || i.state === 'accepted'), live.sent.filter(i => i.state === 'withdrawn' || i.state === 'declined'), liveIntentRow],
      drafts: [live.mine.filter(i => i.state === 'open'), live.mine.filter(i => i.state === 'paused'), livePostRow],
      received: [live.received.filter(i => i.state === 'sent'), live.received.filter(i => i.state !== 'sent'), liveReceivedRow]
    };
    const [active, past, row] = sets[view];
    const empty = {
      intents: ['先找到一件想一起做的事', '点「约个搭子」写下意向，在这里跟进。'],
      drafts: ['从一个小目标开始', '写清产物、时间和需要的人，发布后成员能在搭子列表里看到。'],
      received: ['还没有人约你', '在右下角选「愿意了解具体的搭子邀约」，再发布一个需求，别人才约得到你。']
    }[view];
    const tab = (id, label, n) => `<button type="button" data-action="buddy-mine" data-value="${esc(id)}" aria-pressed="${view === id}">${esc(label)} <span>${esc(String(n))}</span></button>`;
    return `<section class="buddy-followup" aria-labelledby="buddy-followup-heading">
      <div class="buddy-section-heading"><h2 id="buddy-followup-heading" tabindex="-1">我的搭子</h2></div>
      <div class="buddy-mine-tabs" role="group" aria-label="查看我的搭子记录">${tab('intents', '我的意向', sets.intents[0].length)}${tab('drafts', '我发起的', sets.drafts[0].length)}${tab('received', '收到的', sets.received[0].length)}</div>
      ${active.length ? `<ul class="buddy-followup-list">${/* safe: row 函数逐值转义 */ active.map(row).join('')}</ul>` : `<div class="buddy-empty"><strong>${empty[0]}</strong><p>${empty[1]}</p>${view === 'drafts' ? '<button type="button" class="buddy-text-button" data-action="buddy-publish">发起组队</button>' : ''}</div>`}
      ${past.length ? `<details class="buddy-history"><summary>更早的记录 <span>${past.length}</span></summary><ul class="buddy-followup-list">${/* safe: row 函数逐值转义 */ past.map(row).join('')}</ul></details>` : ''}
    </section>`;
  }

  function livePreference() {
    const radio = (value, label) => `<label class="buddy-radio" for="buddy-contact-${esc(value)}"><input id="buddy-contact-${esc(value)}" name="contactPreference" type="radio" value="${esc(value)}"${(live.open ? 'open' : 'closed') === value ? ' checked' : ''}><span>${esc(label)}</span></label>`;
    return `<section class="buddy-preference" aria-labelledby="buddy-preference-title"><div class="buddy-section-heading"><h2 id="buddy-preference-title">我的邀约偏好</h2>${icon('shield')}</div>
      <form data-form="buddy-preference"><fieldset><legend class="buddy-sr-only">是否愿意了解搭子邀约</legend>${radio('closed', '暂不接受搭子邀约')}${radio('open', '愿意了解具体的搭子邀约')}</fieldset>
      <div class="buddy-preference-bottom"><p>选「愿意」后，成员才能约你；关掉后已发的邀约不受影响。</p><button type="submit" class="button">保存偏好</button></div></form></section>`;
  }

  function liveRender() {
    if (live.status === 'idle') load(false);
    else if (live.status === 'ready' && Date.now() - live.loadedAt > 60000) load(true);
    const noPost = whyNot('social.buddy.post');
    const head = `<div class="page-head buddy-page-head"><div><p>选一个具体任务，约一个一起推进的人。</p>${noPost ? `<p class="buddy-form-note" role="note">${esc(noPost)}</p>` : ''}</div><div class="buddy-page-actions"><button type="button" class="button primary" data-action="buddy-publish"${noPost ? ` disabled title="${esc(noPost)}"` : ''}>${icon('pen')}发起组队</button></div></div>`;
    if (live.status === 'error') return `<div class="buddies-page">${head}<div class="buddy-empty" role="alert"><strong>搭子没有载入</strong><p>${esc(live.error)}</p><button type="button" class="buddy-text-button" data-action="buddy-retry">重试</button></div></div>`;
    if (live.status !== 'ready') return `<div class="buddies-page">${head}<div class="buddy-empty" role="status"><strong>正在读取搭子需求…</strong></div></div>`;
    const shown = live.posts.filter(item => currentType === 'all' || item.kind === currentType);
    const waiting = live.sent.filter(i => i.state === 'sent').length;
    const tabs = [{ id: 'all', label: '全部' }, ...types].map(item => `<button type="button" data-action="buddy-filter" data-value="${item.id}" aria-pressed="${currentType === item.id}">${item.label}<span>${item.id === 'all' ? live.posts.length : live.posts.filter(post => post.kind === item.id).length}</span></button>`).join('');
    return `<div class="buddies-page">${head}
      <div class="buddy-layout"><section class="buddy-directory" aria-labelledby="buddy-directory-heading">
        <div class="buddy-type-tabs" role="group" aria-label="需求类型">${tabs}</div>
        <div class="buddy-list-heading"><h2 id="buddy-directory-heading">${shown.length} 个任务</h2><button type="button" class="buddy-text-button buddy-jump-mine" data-action="buddy-jump-mine">我的意向 <span>${waiting}</span>${icon('arrow')}</button></div>
        <div class="buddy-demand-list">${shown.length ? shown.map(liveRequestRow).join('') : '<div class="buddy-empty"><strong>这个类型还没有需求</strong><p>换个类型，或发起自己的组队需求。</p></div>'}</div>
        ${live.cursor ? `<div class="buddy-empty"><button type="button" class="button" data-action="buddy-more"${live.busy ? ' disabled' : ''}>更多需求</button></div>` : ''}
      </section><aside class="buddy-sidebar">${liveFollowup()}${livePreference()}</aside></div></div>`;
  }

  function liveInviteModal(person, post, invite) {
    const draft = invite || { kind: post ? post.kind : 'project', title: post ? post.title : '', outcome: post ? post.outcome : '', schedule: post ? post.schedule : '', contribution: '', note: '' };
    api().modal(invite && invite.state === 'sent' ? '查看与编辑搭子意向' : `约${person.display_name || 'TA'}做搭子`, `<div class="buddy-invite-person">${/* safe: liveAvatar 返回已转义 HTML */ liveAvatar(person)}<div>${liveWho(person)}</div></div>
      <p class="buddy-form-context">邀约会发给 TA，TA 可以接受或婉拒。</p>
      <form class="buddy-form" data-form="buddy-intent" data-id="${esc(invite && invite.state === 'sent' ? invite.id : '')}" data-person="${esc(person.handle || person.id)}" data-post="${esc((post && post.id) || (invite && invite.post_id) || '')}">
        ${typeSelect(draft.kind)}${field('title', '想一起完成的目标', draft.title, { max: 100, placeholder: '例如：把一个检索原型做成可复现作品' })}
        ${field('outcome', '希望留下什么产物', draft.outcome, { rows: 2, max: 600, placeholder: '写清能看到、能检查的结果' })}
        <div class="buddy-form-pair">${field('schedule', '你能投入的时间', draft.schedule, { max: 120, placeholder: '每周几小时，持续多久' })}${field('contribution', '你可以负责什么', draft.contribution, { max: 240, placeholder: '你能带来的技能、资料或工作' })}</div>
        ${field('note', '想补充的话', draft.note, { rows: 2, max: 1000, optional: true, placeholder: '已有尝试、想先交流的问题' })}
        <p class="buddy-form-note">发出后可在「我的意向」修改或撤回。此操作不构成合作承诺。</p><div class="buddy-form-actions"><button type="button" class="button" data-action="buddy-close">返回</button><button type="submit" class="button primary">${invite && invite.state === 'sent' ? '保存修改' : '发出邀约'}</button></div>
      </form>`);
  }

  function liveDraftModal(existing) {
    const draft = existing || { kind: currentType === 'all' ? 'project' : currentType, title: '', outcome: '', schedule: '', partner: '', contribution: '', note: '' };
    api().modal(existing ? '编辑组队需求' : '发起一个组队需求', `<form class="buddy-form" data-form="buddy-draft" data-id="${esc((existing && existing.id) || '')}">
      ${typeSelect(draft.kind)}${field('title', '组队目标', draft.title, { max: 100, placeholder: '用一句话说清要完成什么' })}
      ${field('outcome', '具体产物与完成标准', draft.outcome, { rows: 2, max: 600, placeholder: '例如：一个可演示的原型，通过 10 个测试问题' })}
      <div class="buddy-form-pair">${field('schedule', '每周投入与持续时间', draft.schedule, { max: 120, placeholder: '例如：每周 3 小时，连续 2 周' })}${field('partner', '需要什么搭子', draft.partner, { max: 240, placeholder: '例如：1 位懂交互的伙伴，一起设计走查' })}</div>
      ${field('contribution', '你先负责什么', draft.contribution, { max: 240, placeholder: '已有准备，以及你愿意承担的部分' })}
      ${field('note', '补充说明', draft.note, { rows: 2, max: 1000, optional: true, placeholder: '合作方式、资料范围或退出约定' })}
      <p class="buddy-form-note">发布后，所有成员都能在搭子列表里看到这条需求；随时可以收起。</p><div class="buddy-form-actions"><button type="button" class="button" data-action="buddy-close">返回</button><button type="submit" class="button primary">${existing ? '保存修改' : '发布需求'}</button></div>
    </form>`);
  }

  function done(view, message) {
    if (view) mineView = view;
    api().closeModal();
    live.busy = false;
    load(true);
    api().toast(message);
  }

  function fail(error, fallback, button) {
    live.busy = false;
    if (button) button.disabled = false;
    api().toast(failText(error, fallback));
  }

  function liveSubmit(name, form) {
    if (live.busy) return true;
    const values = new FormData(form), button = form.querySelector('[type="submit"]');
    if (name === 'buddy-preference') {
      const open = values.get('contactPreference') === 'open';
      live.busy = true; if (button) button.disabled = true;
      send('PUT', '/social/me/prefs', { buddy_open: open }).then(() => { live.open = open; live.busy = false; if (button) button.disabled = false; api().toast(open ? '已开启：成员可以约你。' : '已关闭：暂不接受搭子邀约。'); refresh(); }).catch(error => fail(error, '偏好没有保存，请重试。', button));
      return true;
    }
    if (name === 'buddy-report') {
      const reason = text(values.get('reason')).trim(), kind = form.dataset.kind === 'invite' ? 'invite' : 'post';
      if (!REPORT_REASONS.includes(reason)) { api().toast('请选一个举报原因。'); return true; }
      live.busy = true; if (button) button.disabled = true;
      send('POST', (kind === 'invite' ? '/social/buddy-invites/' : '/social/buddies/') + encodeURIComponent(form.dataset.id) + '/report', { reason })
        .then(() => { live.busy = false; api().closeModal(); load(true); api().toast('已举报，治理员会处理这一条。'); })
        .catch(error => fail(error, '举报没有提交，请重试。', button));
      return true;
    }
    const intent = name === 'buddy-intent';
    const required = [['title', intent ? '目标' : '组队目标'], ['outcome', '具体产物'], ['schedule', '投入时间'], ['contribution', '你负责的部分']];
    if (!intent) required.push(['partner', '所需搭子']);
    if (!validate(form, values, required)) return true;
    const kind = text(values.get('kind'));
    if (!isKind(kind)) { api().toast('请选择一种搭子需求类型。'); return true; }
    const body = { kind };
    ['title', 'outcome', 'schedule', 'contribution', 'note'].concat(intent ? [] : ['partner']).forEach(key => { body[key] = text(values.get(key)).trim(); });
    const id = form.dataset.id;
    let request;
    if (intent) {
      if (id) request = send('PATCH', '/social/buddy-invites/' + encodeURIComponent(id), body);
      else {
        if (form.dataset.post) body.post_id = form.dataset.post;
        request = send('POST', '/social/buddy-invites/' + encodeURIComponent(form.dataset.person), body);
      }
    } else request = id ? send('PATCH', '/social/buddies/' + encodeURIComponent(id), body) : send('POST', '/social/buddies', body);
    live.busy = true; if (button) button.disabled = true;
    request.then(() => done(intent ? 'intents' : 'drafts', intent ? (id ? '意向已更新。' : '邀约已发给 TA。') : (id ? '需求已更新。' : '需求已发布，成员能在搭子列表里看到。'))).catch(error => fail(error, '没有保存成功，输入还在，请重试。', button));
    return true;
  }

  function liveChange(request, view, message) {
    if (live.busy) return true;
    live.busy = true;
    request.then(() => done(view, message)).catch(error => fail(error, '操作没有完成，请重试。'));
    return true;
  }

  function liveHandle(action, el) {
    const id = el.dataset.id;
    switch (action) {
      case 'buddy-filter': if (el.dataset.value !== 'all' && !isKind(el.dataset.value)) return true; currentType = el.dataset.value; refresh(); return true;
      case 'buddy-mine': if (!['intents', 'drafts', 'received'].includes(el.dataset.value)) return true; mineView = el.dataset.value; refresh(); return true;
      case 'buddy-jump-mine': mineView = 'intents'; refresh(); focusFollowup(true); return true;
      case 'buddy-retry': load(false); refresh(); return true;
      case 'buddy-more': loadMore(); return true;
      case 'buddy-publish': { const why = whyNot('social.buddy.post'); if (why) { api().toast(why); return true; } liveDraftModal(null); return true; }
      case 'buddy-edit-draft': { const item = live.mine.find(row => row.id === id); if (item) liveDraftModal(item); else api().toast('这条需求已不存在。'); return true; }
      case 'buddy-invite': {
        const why = whyNot('social.buddy.invite');
        if (why) { api().toast(why); return true; }
        const post = live.posts.find(row => row.id === id);
        if (post && post.author) liveInviteModal(post.author, post, null); else api().toast('这条需求已不存在，请刷新。');
        return true;
      }
      case 'buddy-edit-intent': case 'buddy-resend': {
        const item = live.sent.find(row => row.id === id);
        if (!item || !item.person) { api().toast('这条意向已不存在。'); return true; }
        liveInviteModal(item.person, null, action === 'buddy-resend' ? Object.assign({}, item, { state: 'new' }) : item);
        return true;
      }
      case 'buddy-withdraw': return liveChange(send('DELETE', '/social/buddy-invites/' + encodeURIComponent(id)), 'intents', '已撤回这条意向。');
      case 'buddy-pause-draft': return liveChange(send('PATCH', '/social/buddies/' + encodeURIComponent(id), { state: 'paused' }), 'drafts', '需求已收起，别人看不到了。');
      case 'buddy-resume-draft': return liveChange(send('PATCH', '/social/buddies/' + encodeURIComponent(id), { state: 'open' }), 'drafts', '需求已重新发布。');
      case 'buddy-answer': { const accept = el.dataset.accept === '1'; return liveChange(send('POST', '/social/buddy-invites/' + encodeURIComponent(id) + '/answer', { accept }), 'received', accept ? '已接受，可以给 TA 发私信约时间。' : '已婉拒。'); }
      case 'buddy-dm':
        if (window.CommonsDM && window.CommonsDM.open) window.CommonsDM.open({ with: id, name: el.dataset.name || '' });
        else api().toast('私信还没有开通');
        return true;
      case 'buddy-report': return liveReportModal(el.dataset.kind === 'invite' ? 'invite' : 'post', id);
      case 'buddy-close': api().closeModal(); return true;
      default: return false;
    }
  }

  function handle(action, el) {
    if (isLive()) return liveHandle(action, el);
    switch (action) {
      case 'buddy-filter':
        if (el.dataset.value !== 'all' && !isKind(el.dataset.value)) return true;
        currentType = el.dataset.value; refresh(); return true;
      case 'buddy-mine':
        if (!['intents', 'drafts'].includes(el.dataset.value)) return true;
        mineView = el.dataset.value; refresh(); return true;
      case 'buddy-jump-mine': mineView = 'intents'; refresh(); focusFollowup(true); return true;
      case 'buddy-publish': openDraft(); return true;
      case 'buddy-edit-draft': openDraft(el.dataset.id); return true;
      case 'buddy-invite': openInvite(el.dataset.id, el.dataset.request); return true;
      case 'buddy-edit-intent': {
        const item = readState().intents.find(record => record.id === el.dataset.id);
        if (item) openInvite(item.personId, item.requestId, item.id);
        else api().toast('这条本机意向已不存在。');
        return true;
      }
      case 'buddy-withdraw': return changeStatus('intents', el.dataset.id, 'withdrawn');
      case 'buddy-pause-draft': return changeStatus('drafts', el.dataset.id, 'paused');
      case 'buddy-close': api().closeModal(); return true;
      default: return false;
    }
  }

  function submit(name, form) {
    if (isLive()) return ['buddy-intent', 'buddy-draft', 'buddy-preference', 'buddy-report'].includes(name) ? liveSubmit(name, form) : false;
    return ['buddy-intent', 'buddy-draft', 'buddy-preference'].includes(name) ? saveForm(name, form) : false;
  }

  function reset() { currentType = 'all'; mineView = 'intents'; live.status = 'idle'; }

  window.CommonsBuddies = { routes: { buddies: render }, hub: ['buddies'], handle, submit, reset, openInvite, openCreate: () => openDraft() };
}());
