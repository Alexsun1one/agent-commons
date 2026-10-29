/* R13 KB-1 · #/solved 问题库。自行登记 CommonsPages。 */
(function () {
  'use strict';

  var state = { root: null, selected: '', query: '', tool: 'all', industry: 'all', status: 'all', captureStep: 0, timer: 0, controller: null, remote: null, details: {}, unbind: [], error: '', loading: false, liveVerify: {}, verifying: false, panel: '', panelDraft: {}, liveCapture: { id: '', draft: {}, problemId: '' }, taxonomy: null, seed: null, seedKey: '' };

  /* 工具、行业字典来自 GET /api/kb/taxonomy（唯一来源 tools/drift_lexicon.py），这里不再镜像。 */
  var LINK_KINDS = [['related', '相关问题'], ['duplicate', '重复问题'], ['replacement', '被它替代']];

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
    });
  }

  function isLive() {
    return !!(window.CommonsAPI && window.CommonsAPI.mode === 'live');
  }

  // 能力门：线上、会话对象在、且 can() 说不行时，返回给人看的原因（/api/me.capability_reasons）；其余返回 ''。
  function whyNot(action) {
    var S = window.CommonsSession;
    if (!isLive() || !S || typeof S.can !== 'function' || S.can(action)) return '';
    return (typeof S.reason === 'function' && S.reason(action)) || '你现在还不能这样做';
  }
  function gateAttr(why) {
    return why ? ' disabled aria-disabled="true" title="' + esc(why) + '"' : '';
  }

  function emptyData() {
    var tax = state.taxonomy || { tools: [], industries: [] };
    return {
      stats: {},
      tools: [['all', '全部工具']].concat(tax.tools),
      industries: [['all', '全部行业']].concat(tax.industries),
      problems: [], capture: { draft: {} }
    };
  }

  function loadTaxonomy() {
    if (state.taxonomy) return Promise.resolve(state.taxonomy);
    return window.CommonsAPI.get('/kb/taxonomy').then(function (response) {
      var payload = (response && response.data) || {};
      var pair = function (row) { return [row.key, row.label]; };
      state.taxonomy = { tools: (payload.tools || []).map(pair), industries: (payload.industries || []).map(pair) };
      return state.taxonomy;
    });
  }

  function isClosed(error) {
    return !!(error && (error.status === 501 || error.code === 'capability_unavailable'));
  }

  function errorText(error, fallback) {
    if (isClosed(error)) return '这个功能还没开放。管理员还没打开。';
    if (error && error.code === 'version_conflict') return '内容已被改过，请刷新。';
    return (error && error.message) || fallback;
  }

  function newKey() {
    return window.CommonsAPI.newIdempotencyKey();
  }

  function data() {
    if (isLive()) return emptyData();
    return window.COMMONS_KB_SAMPLE || emptyData();
  }

  function personLink(handle, name, level) {
    if (window.CommonsLinks && typeof window.CommonsLinks.person === 'function') {
      return window.CommonsLinks.person(handle, name, { level: level });
    }
    return handle ? '<a class="lk-person" href="#/u/' + encodeURIComponent(handle) + '">' + esc(name) + '</a>' : esc(name);
  }

  function objectLink(kind, id, labelText) {
    if (window.CommonsLinks && typeof window.CommonsLinks.a === 'function') return window.CommonsLinks.a(kind, id, labelText);
    var roots = { knowledge: 'knowledge', thread: 'threads' };
    return id && roots[kind]
      ? '<a class="lk-object" href="#/' + roots[kind] + '/' + encodeURIComponent(id) + '">' + esc(labelText) + '</a>'
      : '<span>' + esc(labelText) + '</span>';
  }

  function icon(name) {
    var paths = {
      search: 'M11 4a7 7 0 1 0 4.9 12L21 21m-10-5a5 5 0 1 1 0-10 5 5 0 0 1 0 10z',
      check: 'm5 12 4 4L19 6', copy: 'M9 8h10v11H9zM5 5h10v3M5 5v11h4',
      spark: 'M12 3l1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5L12 3z',
      arrow: 'm9 6 6 6-6 6'
    };
    return '<svg class="kb-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + esc(paths[name] || paths.search) + '"/></svg>';
  }

  function toast(message) {
    if (window.Commons && typeof window.Commons.toast === 'function') window.Commons.toast(message);
  }

  function readVerifications() {
    if (window.Commons && typeof window.Commons.read === 'function') return window.Commons.read('kb.verifications', {}) || {};
    return {};
  }

  function writeVerifications(value) {
    if (window.Commons && typeof window.Commons.write === 'function') window.Commons.write('kb.verifications', value);
  }

  function label(list, key) {
    var row = (list || []).find(function (item) { return item[0] === key; });
    return row ? row[1] : key;
  }

  function statusLabel(status) {
    return { pending: '待验证', verified: '已验证', stale: '已过时' }[status] || status;
  }

  function apiProblem(raw) {
    var solution = (raw.solutions || [])[0] || {};
    var verification = raw.verification || {};
    var distribution = (verification.distribution || []).map(function (row) {
      var env = row.environment || {};
      return [env.tool_key, env.version, env.system].filter(Boolean).join(' · ');
    }).filter(Boolean);
    return {
      id: raw.id, title: raw.title || '未命名问题', phenomenon: raw.phenomenon || '',
      error_signature: raw.error_signature || '', status: raw.status || 'pending', stale_hint: !!raw.stale_hint,
      industry_key: raw.industry_key || '', environments: raw.environments || [],
      root_cause: solution.root_cause || '尚待补充根因。', steps: solution.steps || [],
      verification: {
        success: verification.success == null ? (raw.successful_verifications || 0) : verification.success,
        failed: verification.failed || 0, environments: distribution
      },
      author: raw.author || null,
      related: (raw.links || []).map(function (link) { return { kind: 'knowledge', id: link.target_id, label: link.target_title || link.target_id }; }),
      updated_at: String(raw.updated_at || '').slice(0, 10),
      etag: raw.etag || '', editable: !!raw.editable,
      otherSolutions: (raw.solutions || []).slice(1).map(function (item) { return { root_cause: item.root_cause || '', steps: item.steps || [] }; })
    };
  }

  function problems() {
    if (isLive()) return state.remote || [];
    return state.remote === null ? data().problems : state.remote;
  }

  function filtered() {
    var q = state.remote === null ? state.query.trim().toLocaleLowerCase() : '';
    return problems().filter(function (problem) {
      var hay = [problem.title, problem.phenomenon, problem.error_signature, problem.root_cause].join(' ').toLocaleLowerCase();
      var toolMatch = state.tool === 'all' || problem.environments.some(function (env) { return env.tool_key === state.tool; });
      return (!q || hay.indexOf(q) >= 0 || q.split(/\s+/).some(function (term) { return term.length > 2 && hay.indexOf(term) >= 0; })) &&
        toolMatch && (state.industry === 'all' || problem.industry_key === state.industry) &&
        (state.status === 'all' || problem.status === state.status);
    });
  }

  function selectOptions(list, selected) {
    return list.map(function (item) {
      return '<option value="' + esc(item[0]) + '"' + (item[0] === selected ? ' selected' : '') + '>' + esc(item[1]) + '</option>';
    }).join('');
  }

  /* safe-fn: all dynamic values are escaped */
  function problemCard(problem) {
    var tools = problem.environments.map(function (env) { return '<span class="chip kb-chip">' + esc(label(data().tools, env.tool_key)) + '</span>'; }).join('');
    return '<button class="kb-result' + (problem.id === state.selected ? ' is-active' : '') + '" type="button" data-kb-act="select" data-id="' + esc(problem.id) + '">' +
      '<span class="kb-result-top"><span class="kb-status is-' + esc(problem.status) + '">' + esc(statusLabel(problem.status)) + '</span><time>' + esc(problem.updated_at) + '</time></span>' +
      '<strong>' + esc(problem.title) + '</strong><span class="kb-result-phenomenon">' + esc(problem.phenomenon) + '</span>' +
      '<span class="kb-result-foot">' + tools + '<span>' + esc(problem.verification.success) + ' 人成功</span></span></button>';
  }

  /* safe-fn: all dynamic values are escaped */
  function listHtml() {
    var rows = filtered();
    if (!rows.length) return '<div class="kb-empty"><strong>没有匹配的问题，换个报错片段再试。</strong><button class="button ghost" data-kb-act="clear" type="button">清除筛选</button></div>';
    return rows.map(problemCard).join('');
  }

  function current() {
    var rows = filtered();
    var chosen = problems().find(function (problem) { return problem.id === state.selected; });
    return chosen && rows.indexOf(chosen) >= 0 ? chosen : rows[0];
  }

  /* safe-fn: all dynamic values are escaped */
  function detailHtml() {
    var problem = current();
    if (!problem) return '<div class="kb-detail kb-empty"><strong>先选一个问题。</strong><a class="button ghost" href="#/solved">返回问题列表</a></div>';
    state.selected = problem.id;
    var saved = isLive() ? state.liveVerify[problem.id] : readVerifications()[problem.id];
    var success = problem.verification.success + (saved === 'success' ? 1 : 0);
    var failed = problem.verification.failed + (saved === 'failed' ? 1 : 0);
    var envs = problem.environments.map(function (env) {
      return '<span class="chip kb-chip">' + esc(label(data().tools, env.tool_key)) + (env.version ? ' · ' + esc(env.version) : '') + (env.system ? ' · ' + esc(env.system) : '') + '</span>';
    }).join('');
    var steps = problem.steps.map(function (step, index) { return '<li><span>' + esc(index + 1) + '</span><p>' + esc(step) + '</p></li>'; }).join('');
    var distribution = problem.verification.environments.map(function (env) { return '<span>' + esc(env) + '</span>'; }).join('');
    var others = (problem.otherSolutions || []).map(function (item) {
      return '<section class="kb-solution kb-solution-alt"><span class="kb-kicker">另一种解法</span><h3>根因</h3><p>' + esc(item.root_cause) + '</p><h3>解决步骤</h3><ol>' +
        item.steps.map(function (step, index) { return '<li><span>' + esc(index + 1) + '</span><p>' + esc(step) + '</p></li>'; }).join('') + '</ol></section>';
    }).join('');
    var solveWhy = whyNot('kb.solve');
    var linkWhy = whyNot('kb.link');
    var verifyWhy = whyNot('kb.verify');
    var whyNotes = [['我也解决了', verifyWhy], ['写解法', solveWhy], ['关联问题', linkWhy]].filter(function (row) { return row[1]; })
      .map(function (row) { return '<p class="kb-why" role="status" data-kb-why>' + esc(row[0]) + '：' + esc(row[1]) + '</p>'; }).join('');
    var liveActions = isLive()
      ? '<button class="button tonal" type="button" data-kb-act="panel-solve"' + gateAttr(solveWhy) + '>写解法</button><button class="button tonal" type="button" data-kb-act="panel-link"' + gateAttr(linkWhy) + '>关联问题</button>' +
        (problem.editable ? '<button class="button tonal" type="button" data-kb-act="panel-edit">编辑</button>' : '')
      : '';
    var related = problem.related.length ? problem.related.map(function (item) {
      var ref = typeof item === 'string' ? { kind: 'knowledge', id: '', label: item } : item;
      return '<span class="kb-related">' + ( /* safe: objectLink 自行转义 */ objectLink(ref.kind || 'knowledge', ref.id, ref.label || ref.title || ref.id) ) + icon('arrow') + '</span>';
    }).join('') : '<span class="kb-muted">暂无相关问题</span>';
    var author = problem.author || {};
    return '<article class="kb-detail" aria-live="polite"><header><div><span class="kb-status is-' + esc(problem.status) + '">' + esc(statusLabel(problem.status)) + '</span>' + (problem.stale_hint ? '<span class="kb-status is-stale">可能已过时</span>' : '') + '</div></header>' +
      '<h2>' + esc(problem.title) + '</h2>' + (author.name ? '<p class="kb-byline">由 ' + ( /* safe: personLink 自行转义 */ personLink(author.handle, author.name, author.level) ) + ' 整理</p>' : '') + '<p class="kb-lead">' + esc(problem.phenomenon) + '</p>' +
      '<section><div class="kb-section-title"><h3>报错特征</h3><button class="button ghost kb-copy" data-kb-act="copy" type="button">' + icon('copy') + '复制</button></div><pre><code>' + esc(problem.error_signature) + '</code></pre></section>' +
      '<section><h3>环境</h3><div class="kb-chips">' + envs + '</div></section>' +
      '<section class="kb-solution"><span class="kb-kicker">已沉淀方案</span><h3>根因</h3><p>' + esc(problem.root_cause) + '</p><h3>解决步骤</h3><ol>' + steps + '</ol></section>' + others +
      '<section class="kb-verification"><div><span class="kb-number">' + esc(success) + '</span><span>人照做成功</span></div><div><span class="kb-number is-muted">' + esc(failed) + '</span><span>人反馈失败</span></div><div class="kb-distribution">' + distribution + '</div></section>' +
      '<div class="kb-actions"><button class="button primary" type="button" data-kb-act="verify-success"' + (saved ? ' disabled' : gateAttr(verifyWhy)) + '>' + icon('check') + (saved ? '已记录复现' : '我也解决了') + '</button><button class="button tonal" type="button" data-kb-act="verify-fail"' + (saved ? ' disabled' : gateAttr(verifyWhy)) + '>在我这不行</button>' + liveActions + '</div>' + whyNotes +
      '<section><h3>相关问题</h3><div class="kb-related-list">' + related + '</div></section></article>';
  }

  /* safe-fn: sample text and draft values are escaped */
  function captureHtml() {
    var capture = data().capture;
    var source = typeof capture.source === 'string' ? esc(capture.source) : objectLink(capture.source.kind, capture.source.id, capture.source.label);
    if (state.captureStep === 0) {
      return '<div class="kb-capture-source"><div><span class="kb-kicker">' + ( /* safe: source 来自 esc 或 objectLink */ source ) + '</span><p>' + esc(capture.question) + '</p><blockquote>' + esc(capture.accepted) + '</blockquote></div><button class="button primary" type="button" data-kb-act="capture">沉淀为问题卡</button></div>';
    }
    if (state.captureStep === 2) {
      return '<div class="kb-capture-done">' + icon('check') + '<div><strong>问题卡草稿已确认</strong><span>等其他人照做后变成「已验证」。</span></div><button class="button ghost" type="button" data-kb-act="capture-reset">再演示一次</button></div>';
    }
    var draft = capture.draft;
    var captureWhy = whyNot('kb.capture');
    return '<form class="kb-draft" data-kb-form="capture"><div class="kb-draft-head"><div><span class="kb-kicker">待提问人确认</span><h3>问题卡草稿</h3></div></div>' +
      '<label class="field"><span>标题</span><input name="title" value="' + esc(draft.title) + '" required></label>' +
      '<label class="field"><span>现象</span><textarea name="phenomenon" rows="3" required>' + esc(draft.phenomenon) + '</textarea></label>' +
      '<label class="field"><span>规范化报错特征</span><textarea name="signature" rows="2">' + esc(draft.signature) + '</textarea></label>' +
      '<label class="field"><span>根因</span><textarea name="cause" rows="2">' + esc(draft.rootCause) + '</textarea></label>' +
      '<div class="kb-draft-actions"><button class="button ghost" type="button" data-kb-act="capture-reset">取消</button><button class="button primary" type="submit"' + gateAttr(captureWhy) + '>确认入库</button></div>' + (captureWhy ? '<p class="kb-why" role="status" data-kb-why>' + esc(captureWhy) + '</p>' : '') + '</form>';
  }

  /* safe-fn: 标题文案由本文件写死，经 esc */
  function panelHead(title) {
    return '<div class="kb-draft-head"><div><span class="kb-kicker">成员操作</span><h3>' + esc(title) + '</h3></div><button class="button ghost small" type="button" data-kb-act="panel-close">取消</button></div>';
  }

  /* safe-fn: 按钮文案由本文件写死，经 esc */
  function panelFoot(label) {
    return '<p class="kb-form-error" role="alert" data-kb-panel-error hidden></p><div class="kb-form-actions"><button class="button primary" type="submit">' + esc(label) + '</button></div>';
  }

  /* safe-fn: 字段值与选项均 esc */
  function panelHtml() {
    if (!isLive() || !state.panel) return '';
    var problem = current();
    var draft = state.panelDraft || {};
    if (state.panel === 'ask') {
      return '<form class="kb-draft kb-panel" data-kb-form="ask">' + panelHead('提一个新问题') +
        '<label class="field kb-wide"><span>标题（一句话说清楚）</span><input name="title" maxlength="200" value="' + esc(draft.title) + '" required></label>' +
        '<label class="field kb-wide"><span>现象（你看到了什么、做了什么）</span><textarea name="phenomenon" rows="4" maxlength="20000" required>' + esc(draft.phenomenon) + '</textarea></label>' +
        '<label class="field kb-wide"><span>报错原文（可选）</span><textarea name="error_signature" rows="3" maxlength="20000">' + esc(draft.error_signature) + '</textarea></label>' +
        '<label class="field"><span>工具</span><select name="tool_key">' + selectOptions([['', '不指定']].concat(data().tools.slice(1)), '') + '</select></label>' +
        '<label class="field"><span>行业</span><select name="industry_key">' + selectOptions([['', '不指定']].concat(data().industries.slice(1)), '') + '</select></label>' +
        '<label class="field"><span>工具版本（可选）</span><input name="version" maxlength="80"></label>' +
        '<label class="field"><span>系统（可选）</span><input name="system" maxlength="120"></label>' +
        panelFoot('提交问题') + '</form>';
    }
    if (!problem) return '';
    if (state.panel === 'edit') {
      return '<form class="kb-draft kb-panel" data-kb-form="edit" data-id="' + esc(problem.id) + '">' + panelHead('编辑这张问题卡') +
        '<label class="field kb-wide"><span>标题</span><input name="title" maxlength="200" value="' + esc(problem.title) + '" required></label>' +
        '<label class="field kb-wide"><span>现象</span><textarea name="phenomenon" rows="4" maxlength="20000" required>' + esc(problem.phenomenon) + '</textarea></label>' +
        '<label class="field kb-wide"><span>报错原文</span><textarea name="error_signature" rows="3" maxlength="20000">' + esc(problem.error_signature) + '</textarea></label>' +
        panelFoot('保存修改') + '</form>';
    }
    if (state.panel === 'solve') {
      return '<form class="kb-draft kb-panel" data-kb-form="solve" data-id="' + esc(problem.id) + '">' + panelHead('写一个解法') +
        '<label class="field kb-wide"><span>根因</span><textarea name="root_cause" rows="3" maxlength="30000" required></textarea></label>' +
        '<label class="field kb-wide"><span>解决步骤（一行一步）</span><textarea name="steps" rows="5" required></textarea></label>' +
        panelFoot('提交解法') + '</form>';
    }
    if (state.panel === 'link') {
      var others = problems().filter(function (item) { return item.id !== problem.id; });
      if (!others.length) {
        return '<div class="kb-draft kb-panel">' + panelHead('关联问题') + '<p class="kb-muted kb-wide">当前列表里没有别的问题可关联。先搜一下，再回来。</p></div>';
      }
      return '<form class="kb-draft kb-panel" data-kb-form="link" data-id="' + esc(problem.id) + '">' + panelHead('关联另一张问题卡') +
        '<label class="field"><span>要关联的问题</span><select name="target_id">' + selectOptions(others.map(function (item) { return [item.id, item.title]; }), '') + '</select></label>' +
        '<label class="field"><span>关系</span><select name="kind">' + selectOptions(LINK_KINDS, 'related') + '</select></label>' +
        panelFoot('提交关联') + '</form>';
    }
    return '';
  }

  /* safe-fn: 草稿字段与服务端返回的标题均 esc */
  function liveCaptureHtml() {
    var cap = state.liveCapture;
    var draft = cap.draft || {};
    if (state.captureStep === 2) {
      return '<div class="kb-capture-done">' + icon('check') + '<div><strong>问题卡已入库</strong><span>等其他人照做后变成「已验证」。</span></div>' +
        (cap.problemId ? '<a class="button ghost" href="#/solved/' + encodeURIComponent(cap.problemId) + '">查看这张问题卡</a>' : '') +
        '<button class="button ghost" type="button" data-kb-act="capture-reset">再沉淀一条</button></div>';
    }
    if (state.captureStep === 1) {
      return '<form class="kb-draft" data-kb-form="capture-confirm"><div class="kb-draft-head"><div><span class="kb-kicker">待提问人确认</span><h3>问题卡草稿</h3></div></div>' +
        '<label class="field kb-wide"><span>标题</span><input name="title" maxlength="200" value="' + esc(draft.title) + '" required></label>' +
        '<label class="field kb-wide"><span>现象</span><textarea name="phenomenon" rows="3" required>' + esc(draft.phenomenon) + '</textarea></label>' +
        '<label class="field kb-wide"><span>规范化报错特征</span><textarea name="error_signature" rows="2">' + esc(draft.signature) + '</textarea></label>' +
        '<label class="field kb-wide"><span>根因</span><textarea name="root_cause" rows="2">' + esc(draft.cause) + '</textarea></label>' +
        panelFoot('确认入库') + '</form>';
    }
    var seed = state.seed || {};
    return '<form class="kb-draft" data-kb-form="capture-source"><div class="kb-draft-head"><div><span class="kb-kicker">从讨论或悬赏里留下答案</span><h3>' + (seed.id ? '核对一下，再生成草稿' : '先写下来源和问题') + '</h3></div></div>' +
      (seed.note ? '<p class="kb-muted kb-wide" role="status">' + esc(seed.note) + '</p>' : '') +
      '<label class="field"><span>来源类型</span><select name="source_kind"><option value="discussion"' + (seed.kind === 'bounty' ? '' : ' selected') + '>讨论串</option><option value="bounty"' + (seed.kind === 'bounty' ? ' selected' : '') + '>悬赏</option></select></label>' +
      '<label class="field"><span>来源编号</span><input name="source_id" maxlength="128" placeholder="讨论或悬赏页地址里的那串编号" value="' + esc(seed.id) + '" required></label>' +
      '<label class="field kb-wide"><span>标题</span><input name="title" maxlength="200" value="' + esc(seed.title) + '" required></label>' +
      '<label class="field kb-wide"><span>现象</span><textarea name="phenomenon" rows="3" required>' + esc(seed.phenomenon) + '</textarea></label>' +
      '<label class="field kb-wide"><span>报错原文（可选）</span><textarea name="error_signature" rows="2"></textarea></label>' +
      '<label class="field kb-wide"><span>被采纳的答案（可选）</span><textarea name="answer_text" rows="3"></textarea></label>' +
      panelFoot('生成草稿') + '</form>';
  }

  /* safe-fn: static shell plus escaped option labels */
  function liveStateHtml(kind) {
    if (kind === 'error') {
      if (state.error === 'closed') return '<div class="kb-empty" role="status"><strong>这个功能还没开放</strong><p>管理员还没打开。</p></div>';
      return '<div class="kb-empty" role="alert"><strong>' + esc(state.error || '问题库没有载入') + '</strong><button class="button" type="button" data-kb-act="retry">重试</button></div>';
    }
    if (kind === 'loading') return '<div class="kb-empty" aria-live="polite"><strong>正在读取问题库</strong></div>';
    return '<div class="kb-empty"><strong>还没有已沉淀的问题。</strong></div>';
  }

  function view() {
    var match = String(location.hash || '').match(/^#\/solved\/([^/?]+)/);
    if (match) {
      try { state.selected = decodeURIComponent(match[1]); } catch (err) { state.selected = ''; }
    }
    if (isLive() && state.error && state.remote === null) {
      return '<main class="kb-page" data-kb><div class="kb-toolbar"><p>贴报错，查已解决的问题。</p></div>' + liveStateHtml('error') + '</main>';
    }
    if (isLive() && state.remote === null) {
      return '<main class="kb-page" data-kb><div class="kb-toolbar"><p>贴报错，查已解决的问题。</p></div>' + liveStateHtml('loading') + '</main>';
    }
    var d = data();
    var stats = '<div class="kb-stats" aria-label="问题库统计"><div><strong>' + esc(d.stats.solvedThisWeek || 0) + '</strong><span>本周新解决</span></div><div><strong>' + esc(d.stats.duplicatesStopped || 0) + '</strong><span>重复提问被拦下</span></div></div>';
    var intro = match
      ? '<header class="kb-detail-intro"><a class="back" href="#/solved">返回问题库</a><h1>问题库</h1></header>'
      : '<div class="kb-toolbar"><p>贴报错，查已解决的问题。</p>' + (isLive() ? '' : '<span class="pill outline">示例</span>') + (isLive() ? '<button class="button primary" type="button" data-kb-act="ask-open"' + gateAttr(whyNot('kb.create')) + '>提一个问题</button>' + (whyNot('kb.create') ? '<small class="kb-why" role="status" data-kb-why>' + esc(whyNot('kb.create')) + '</small>' : '') : '') + '</div>';
    return '<main class="kb-page" data-kb>' + intro + (isLive() ? '' : stats) +
      '<section class="kb-search"><label for="kb-query">' + icon('search') + '<span class="kb-sr">搜索现象或报错</span><textarea id="kb-query" rows="2" placeholder="粘贴报错，或描述你看到的现象…" data-kb-query></textarea></label></section>' +
      '<section class="kb-filters" aria-label="筛选问题"><label>工具<select data-kb-filter="tool">' + selectOptions(d.tools, state.tool) + '</select></label><label>行业<select data-kb-filter="industry">' + selectOptions(d.industries, state.industry) + '</select></label><label>状态<select data-kb-filter="status">' + selectOptions([['all', '全部状态'], ['verified', '已验证'], ['pending', '待验证'], ['stale', '已过时']], state.status) + '</select></label></section>' +
      (isLive() && !state.taxonomy ? '<p class="kb-muted" role="status" data-kb-tax-note>工具和行业的选项没读到，先不能按它们筛选或填写。<button class="button ghost small" type="button" data-kb-act="retry">重试</button></p>' : '') +
      (isLive() ? '<div data-kb-panel>' + panelHtml() + '</div>' : '') +
      '<section class="kb-workspace"><div class="kb-results"><div class="kb-results-head"><h2>可能已经解决过</h2><span data-kb-count></span></div><div data-kb-list>' + listHtml() + '</div></div><div data-kb-detail>' + detailHtml() + '</div></section>' +
      '<section class="kb-capture"><div class="kb-capture-head"><h2>从讨论串生成问题卡</h2></div><div data-kb-capture>' + (isLive() ? liveCaptureHtml() : captureHtml()) + '</div></section></main>';
  }

  function paintResults() {
    if (!state.root) return;
    var list = state.root.querySelector('[data-kb-list]');
    var detail = state.root.querySelector('[data-kb-detail]');
    var count = state.root.querySelector('[data-kb-count]');
    var rows = filtered();
    if (list) list.innerHTML = listHtml();
    if (detail) detail.innerHTML = detailHtml();
    if (count) count.textContent = rows.length + ' 条';
  }

  function performSearch() {
    if (!state.root) return;
    var input = state.root.querySelector('[data-kb-query]');
    state.query = input ? input.value : '';
    if (window.CommonsAPI && window.CommonsAPI.mode === 'live') { loadLive(); return; }
    paintResults();
  }

  function loadLive() {
    if (!window.CommonsAPI || window.CommonsAPI.mode !== 'live') return;
    if (state.controller) state.controller.abort();
    state.controller = window.AbortController ? new AbortController() : null;
    var options = { signal: state.controller && state.controller.signal };
    var hadTaxonomy = !!state.taxonomy;
    /* 字典只管筛选和提问里的下拉；读不到时问题列表、详情、提问表单照常出，只提示一句并给重试。 */
    var request = loadTaxonomy().catch(function () { return null; }).then(function () {
      return state.query.trim() ?
        window.CommonsAPI.post('/kb/similar', { text: state.query }, options) :
        window.CommonsAPI.get('/kb/search', {
          tool_key: state.tool === 'all' ? '' : state.tool,
          industry_key: state.industry === 'all' ? '' : state.industry,
          status: state.status === 'all' ? '' : state.status
        }, options);
    });
    state.loading = true;
    state.error = '';
    request.then(function (response) {
      state.loading = false;
      state.error = '';
      var payload = response && response.data;
      var rows = Array.isArray(payload) ? payload : (payload && payload.items) || [];
      state.remote = rows.map(apiProblem);
      if (!state.remote.some(function (problem) { return problem.id === state.selected; })) state.selected = state.remote[0] ? state.remote[0].id : '';
      state.details = {};
      if (state.root && state.root.querySelector('[data-kb-list]') && (hadTaxonomy || !state.taxonomy)) paintResults();
      else rerenderLive();
      if (state.seedScroll) scrollToCapture();
      if (state.selected) loadDetail(state.selected);
    }).catch(function (error) {
      if (error && error.name === 'AbortError') return;
      state.loading = false;
      state.error = isClosed(error) ? 'closed' : ((error && error.message) || '问题库没有载入');
      state.remote = null;
      rerenderLive();
    });
  }

  function rerenderLive() {
    var root = document.querySelector('[data-kb]');
    if (!root || !root.parentNode) return;
    var host = root.parentNode;
    host.innerHTML = view();
    state.root = host.querySelector('[data-kb]');
  }

  function loadDetail(problemId) {
    if (!window.CommonsAPI || window.CommonsAPI.mode !== 'live' || state.details[problemId]) return;
    window.CommonsAPI.get('/kb/problems/' + encodeURIComponent(problemId)).then(function (response) {
      state.details[problemId] = true;
      var detail = apiProblem(response.data || {});
      state.remote = (state.remote || []).map(function (problem) { return problem.id === problemId ? detail : problem; });
      paintResults();
    }).catch(function (error) { toast((error && error.message) || '问题详情加载失败。'); });
  }

  function paintPanel() {
    if (!state.root) return;
    var host = state.root.querySelector('[data-kb-panel]');
    if (host) host.innerHTML = panelHtml();
    var field = host && host.querySelector('input, textarea');
    if (field && field.focus) field.focus();
  }

  function fieldValue(form, name) {
    var item = form.elements && form.elements[name];
    return item ? String(item.value == null ? '' : item.value) : '';
  }

  function formNote(form, message) {
    var note = form.querySelector && form.querySelector('[data-kb-panel-error]');
    if (!note) { toast(message); return; }
    note.textContent = message;
    note.hidden = false;
  }

  /* 提交中禁用按钮；失败保留表单内容并显示服务器的话。 */
  function liveSubmit(form, run) {
    if (form.dataset.busy === '1') return;
    var button = form.querySelector('[type="submit"]');
    var note = form.querySelector('[data-kb-panel-error]');
    form.dataset.busy = '1';
    if (button) button.disabled = true;
    if (note) { note.textContent = ''; note.hidden = true; }
    run().catch(function (error) {
      form.dataset.busy = '';
      if (button) button.disabled = false;
      formNote(form, errorText(error, '没有提交成功。内容还在，请再试一次。'));
    });
  }

  function putProblem(detail) {
    state.details[detail.id] = true;
    var found = false;
    state.remote = (state.remote || []).map(function (problem) {
      if (problem.id !== detail.id) return problem;
      found = true;
      return detail;
    });
    if (!found) state.remote = [detail].concat(state.remote || []);
    state.selected = detail.id;
  }

  function resetFilters() {
    state.query = ''; state.tool = 'all'; state.industry = 'all'; state.status = 'all'; state.selected = '';
    var query = state.root.querySelector('[data-kb-query]'); if (query) query.value = '';
    state.root.querySelectorAll('[data-kb-filter]').forEach(function (select) { select.value = 'all'; });
  }

  function closePanel() {
    state.panel = '';
    state.panelDraft = {};
    paintPanel();
  }

  function liveAsk(form) {
    var title = fieldValue(form, 'title').trim();
    var phenomenon = fieldValue(form, 'phenomenon').trim();
    if (!title || !phenomenon) { formNote(form, '标题和现象都要写。'); return; }
    var body = { title: title, phenomenon: phenomenon, error_signature: fieldValue(form, 'error_signature').trim() };
    var tool = fieldValue(form, 'tool_key');
    if (tool) body.environments = [{ tool_key: tool, version: fieldValue(form, 'version').trim(), system: fieldValue(form, 'system').trim() }];
    var industry = fieldValue(form, 'industry_key');
    if (industry) body.industry_key = industry;
    liveSubmit(form, function () {
      return window.CommonsAPI.post('/kb/problems', body, { idempotencyKey: newKey() }).then(function (response) {
        resetFilters();
        putProblem(apiProblem((response && response.data) || {}));
        closePanel();
        paintResults();
        toast('问题已提交。');
      });
    });
  }

  function liveEdit(form) {
    var problem = current();
    if (!problem || problem.id !== form.dataset.id) return;
    var title = fieldValue(form, 'title').trim();
    var phenomenon = fieldValue(form, 'phenomenon').trim();
    if (!title || !phenomenon) { formNote(form, '标题和现象都要写。'); return; }
    var body = { title: title, phenomenon: phenomenon, error_signature: fieldValue(form, 'error_signature').trim() };
    liveSubmit(form, function () {
      return window.CommonsAPI.patch('/kb/problems/' + encodeURIComponent(problem.id), body, { idempotencyKey: newKey(), ifMatch: problem.etag }).then(function (response) {
        putProblem(apiProblem((response && response.data) || {}));
        closePanel();
        paintResults();
        toast('修改已保存。');
      });
    });
  }

  function liveSolve(form) {
    var problem = current();
    if (!problem || problem.id !== form.dataset.id) return;
    var cause = fieldValue(form, 'root_cause').trim();
    var steps = fieldValue(form, 'steps').split('\n').map(function (line) { return line.trim(); }).filter(Boolean);
    if (!cause || !steps.length) { formNote(form, '根因和至少一步解决步骤都要写。'); return; }
    liveSubmit(form, function () {
      return window.CommonsAPI.post('/kb/problems/' + encodeURIComponent(problem.id) + '/solutions', { root_cause: cause, steps: steps }, { idempotencyKey: newKey() }).then(function (response) {
        putProblem(apiProblem((response && response.data) || {}));
        closePanel();
        paintResults();
        toast('解法已提交。');
      });
    });
  }

  function liveLink(form) {
    var problem = current();
    if (!problem || problem.id !== form.dataset.id) return;
    var target = fieldValue(form, 'target_id');
    if (!target) { formNote(form, '先选要关联的问题。'); return; }
    liveSubmit(form, function () {
      return window.CommonsAPI.post('/kb/problems/' + encodeURIComponent(problem.id) + '/links', { target_id: target, kind: fieldValue(form, 'kind') || 'related' }, { idempotencyKey: newKey() }).then(function (response) {
        putProblem(apiProblem((response && response.data) || {}));
        closePanel();
        paintResults();
        toast('关联已提交。');
      });
    });
  }

  function liveCaptureStart(form) {
    var title = fieldValue(form, 'title').trim();
    var phenomenon = fieldValue(form, 'phenomenon').trim();
    var sourceId = fieldValue(form, 'source_id').trim();
    if (!title || !phenomenon || !sourceId) { formNote(form, '来源编号、标题和现象都要写。'); return; }
    var body = {
      source_kind: fieldValue(form, 'source_kind') === 'bounty' ? 'bounty' : 'discussion', source_id: sourceId,
      title: title, phenomenon: phenomenon, error_signature: fieldValue(form, 'error_signature').trim(), answer_text: fieldValue(form, 'answer_text').trim()
    };
    liveSubmit(form, function () {
      return window.CommonsAPI.post('/kb/captures', body, { idempotencyKey: newKey() }).then(function (response) {
        var row = (response && response.data) || {};
        state.liveCapture = { id: row.id || '', problemId: '', draft: { title: row.title || title, phenomenon: row.phenomenon || phenomenon, signature: row.error_raw || '', cause: row.answer_text || '' } };
        state.captureStep = 1;
        paintCapture();
      });
    });
  }

  function liveCaptureConfirm(form) {
    var cap = state.liveCapture;
    if (!cap.id) return;
    var title = fieldValue(form, 'title').trim();
    var phenomenon = fieldValue(form, 'phenomenon').trim();
    if (!title || !phenomenon) { formNote(form, '标题和现象都要写。'); return; }
    var body = { title: title, phenomenon: phenomenon, error_signature: fieldValue(form, 'error_signature').trim(), root_cause: fieldValue(form, 'root_cause').trim() };
    liveSubmit(form, function () {
      return window.CommonsAPI.post('/kb/captures/' + encodeURIComponent(cap.id) + '/confirm', body, { idempotencyKey: newKey() }).then(function (response) {
        var detail = apiProblem((response && response.data) || {});
        putProblem(detail);
        cap.problemId = detail.id;
        state.captureStep = 2;
        paintCapture();
        paintResults();
        toast('问题卡已入库。');
      });
    });
  }

  /* #/solved?capture=discussion:<id>：讨论串上的「沉淀为问题卡」跳过来，预填来源、标题和现象，仍由人核对后再生成草稿。 */
  function captureParam() {
    var match = String(location.hash || '').match(/[?&]capture=(discussion|bounty):([^&]+)/);
    if (!match) return null;
    try { return { kind: match[1], id: decodeURIComponent(match[2]) }; } catch (err) { return null; }
  }

  function seedFromHash() {
    var want = captureParam();
    if (!want || !isLive() || state.captureStep !== 0) return;
    var key = want.kind + ':' + want.id;
    if (state.seedKey === key) return;
    state.seedKey = key;
    state.seed = { kind: want.kind, id: want.id, title: '', phenomenon: '', note: '' };
    state.seedScroll = true;
    paintCapture();
    scrollToCapture();
    if (want.kind !== 'discussion') return;
    window.CommonsAPI.get('/objects/' + encodeURIComponent(want.id)).then(function (response) {
      if (state.seedKey !== key) return;
      var object = (response && response.data) || {};
      var content = (object && object.content) || {};
      state.seed.title = String((object && object.title) || '').slice(0, 200);
      state.seed.phenomenon = String(content.body || (object && object.excerpt) || '').slice(0, 20000);
      paintCapture();
    }).catch(function () {
      if (state.seedKey !== key) return;
      state.seed.note = '没读到这个讨论的内容，来源编号已经填好，标题和现象请自己写。';
      paintCapture();
    });
  }

  function scrollToCapture() {
    var host = state.root && state.root.querySelector('[data-kb-capture]');
    if (!host || !host.scrollIntoView) return;
    state.seedScroll = false;
    host.scrollIntoView({ block: 'center' });
  }

  function onInput(event) {
    if (!event.target.matches('[data-kb-query]')) return;
    window.clearTimeout(state.timer);
    state.timer = window.setTimeout(performSearch, 160);
  }

  function onChange(event) {
    var filter = event.target.closest('[data-kb-filter]');
    if (!filter) return;
    state[filter.dataset.kbFilter] = filter.value;
    state.selected = '';
    if (window.CommonsAPI && window.CommonsAPI.mode === 'live') loadLive(); else paintResults();
  }

  function setVerification(kind) {
    var problem = current();
    if (!problem) return;
    if (window.CommonsAPI && window.CommonsAPI.mode === 'live') {
      if (state.verifying) return;
      var env = (problem.environments && problem.environments[0]) || {};
      var tool = env.tool_key || env.tool || '';
      if (!tool) {
        toast('这条问题没写明用的是哪个工具，没法记录复现。请先补上工具环境。');
        return;
      }
      var buttons = state.root ? Array.prototype.slice.call(state.root.querySelectorAll('[data-kb-act="verify-success"],[data-kb-act="verify-fail"]')) : [];
      state.verifying = true;
      buttons.forEach(function (button) { button.disabled = true; });
      window.CommonsAPI.post('/kb/problems/' + encodeURIComponent(problem.id) + '/verify', {
        tool_key: tool,
        version: String(env.version || ''),
        system: String(env.system || ''),
        success: kind === 'success',
        note: ''
      }, { idempotencyKey: window.CommonsAPI.newIdempotencyKey() }).then(function () {
        state.verifying = false;
        state.liveVerify[problem.id] = kind;
        paintResults();
        toast(kind === 'success' ? '已记录：你在当前环境解决了。' : '已记录失败环境，等待补充说明。');
      }).catch(function (error) {
        state.verifying = false;
        buttons.forEach(function (button) { button.disabled = false; });
        toast(errorText(error, '没有记上。原记录没有变化。'));
      });
      return;
    }
    var saved = readVerifications();
    saved[problem.id] = kind;
    writeVerifications(saved);
    paintResults();
    toast(kind === 'success' ? '已记录：你在当前环境解决了。' : '已记录失败环境，等待补充说明。');
  }

  function onClick(event) {
    var button = event.target.closest('[data-kb-act]');
    if (!button) return;
    var act = button.dataset.kbAct;
    if (act === 'retry') { loadLive(); return; }
    if (act === 'select') { state.selected = button.dataset.id || ''; paintResults(); loadDetail(state.selected); }
    else if (act === 'clear') {
      resetFilters(); paintResults();
    } else if (act === 'ask-open') {
      state.panel = 'ask'; state.panelDraft = { phenomenon: state.query }; paintPanel();
    } else if (act === 'panel-solve' || act === 'panel-link' || act === 'panel-edit') {
      state.panel = act.slice(6); state.panelDraft = {}; paintPanel();
    } else if (act === 'panel-close') {
      closePanel();
    } else if (act === 'copy') {
      var problem = current();
      if (problem && navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(problem.steps.join('\n'));
      toast('解决步骤已复制。');
    } else if (act === 'verify-success') setVerification('success');
    else if (act === 'verify-fail') setVerification('failed');
    else if (act === 'related') { state.query = button.dataset.name || ''; var field = state.root.querySelector('[data-kb-query]'); if (field) field.value = state.query; paintResults(); }
    else if (act === 'capture') { state.captureStep = 1; paintCapture(); }
    else if (act === 'capture-reset') { state.captureStep = 0; state.liveCapture = { id: '', draft: {}, problemId: '' }; state.seed = null; state.seedKey = ''; paintCapture(); }
  }

  function onSubmit(event) {
    var form = event.target && event.target.closest ? event.target.closest('[data-kb-form]') : null;
    if (!form) return;
    var kind = form.dataset.kbForm;
    if (isLive()) {
      var handlers = { ask: liveAsk, edit: liveEdit, solve: liveSolve, link: liveLink, 'capture-source': liveCaptureStart, 'capture-confirm': liveCaptureConfirm };
      if (!handlers[kind]) return;
      event.preventDefault();
      handlers[kind](form);
      return;
    }
    if (kind !== 'capture') return;
    event.preventDefault();
    state.captureStep = 2; paintCapture(); toast('问题卡已入库');
  }

  function paintCapture() {
    if (!state.root) return;
    var host = state.root.querySelector('[data-kb-capture]');
    if (host) host.innerHTML = isLive() ? liveCaptureHtml() : captureHtml();
  }

  function on(target, type, handler) {
    target.addEventListener(type, handler);
    state.unbind.push(function () { target.removeEventListener(type, handler); });
  }

  function mount() {
    var root = document.querySelector('[data-kb]');
    if (!root) return;
    destroy(); state.root = root;
    var first = filtered()[0]; if (!state.selected && first) state.selected = first.id;
    on(document, 'click', onClick); on(document, 'input', onInput); on(document, 'change', onChange); on(document, 'submit', onSubmit);
    paintResults();
    if (window.CommonsAPI && window.CommonsAPI.mode === 'live') { loadLive(); seedFromHash(); }
  }

  function destroy() {
    state.unbind.forEach(function (unbind) { unbind(); }); state.unbind = [];
    window.clearTimeout(state.timer); state.timer = 0;
    if (state.controller) state.controller.abort(); state.controller = null; state.root = null;
  }

  window.CommonsKB = {
    hub: ['solved'],
    routes: { solved: view },
    nav: [['solved', '问题库', 'search', 'library']],
    icons: { search: 'M11 4a7 7 0 1 0 4.9 12L21 21m-10-5a5 5 0 1 1 0-10 5 5 0 0 1 0 10z' },
    mount: mount,
    destroy: destroy
  };
  if (window.CommonsLinks && typeof window.CommonsLinks.provide === 'function') {
    window.CommonsLinks.provide('knowledge', function (handle) {
      if (isLive()) return null;
      var rows = (data().problems || []).filter(function (problem) { return problem.author && problem.author.handle === handle; });
      return rows.length ? { label: '问题库', href: '#/solved/' + encodeURIComponent(rows[0].id), count: rows.length, icon: 'search' } : null;
    });
  }
  (window.CommonsPages = window.CommonsPages || []).push(window.CommonsKB);
})();

