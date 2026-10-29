/* R13 GOV-1 · 治理台 #/govern。
   导出 window.CommonsGovern = { routes: { govern }, nav, icons, mount, destroy }，并登记到 window.CommonsPages。
   示例模式读 govern-sample.js（处处标「示例」，操作只在本页模拟）；CommonsAPI.mode === 'live' 时读 /api/governance/*，
   出错只显示错误，不退回示例。点击只用 data-gov-act，监听在 mount() 挂、destroy() 全部解除。 */
(function () {
  'use strict';

  var ICON = 'M12 3 19 6v5c0 4.8-3 8-7 10-4-2-7-5.2-7-10V6l7-3M9 12l2 2 4-5';
  var RISK = { critical: '紧急', high: '高', medium: '中', low: '低' };
  var RISK_ORDER = ['critical', 'high', 'medium', 'low'];
  var STATUS = [['active', '待处理'], ['actioned', '已处理'], ['appealed', '申诉中'], ['all', '全部']];
  var CASE_STATUS = { open: '待处理', triaged: '已分派', actioned: '已处理', dismissed: '不成立', appealed: '申诉中', closed: '已结案' };
  var SOURCE = { report: '举报', rule: '规则', agent: 'Agent', premoderation: '先审后发', volunteer: '骨干隐藏', manual: '手动' };
  var CATEGORY = {
    contact: '联系方式', spam: '广告刷屏', html: 'HTML', file: '文件', image: '图片', duplicate: '重复内容',
    quality: '缺来源', harassment: '骚扰', illegal: '违法', misinformation: '不实信息', copyright: '版权',
    privacy: '隐私', other: '其他', premoderation: '先审后发', volunteer: '骨干隐藏', agent: 'Agent'
  };
  var REVERSIBLE = [
    ['hide', '隐藏', '只对其他成员隐藏，作者自己还能看到'],
    ['pending_review', '转待审核', '先收起来，看过再公开'],
    ['rate_limit', '限速 1 小时', '超出每小时 3 条的内容先待审核'],
    ['require_source', '要求补来源', '提醒作者补上来源'],
    ['deduct', '扣 50 贡献值', '走贡献流水，申诉成立会冲正'],
    ['demote', '降一级', '信任等级下调一级，可申诉恢复'],
    ['restore', '通过并恢复', '撤销这条内容上的隐藏或待审核']
  ];
  var TWO_PERSON = [
    ['ban', '暂停账号', '需要另一位治理员确认才生效'],
    ['delete', '删除内容', '需要另一位治理员确认；删除后无法恢复']
  ];
  var ACTION_LABEL = {
    hide: '隐藏', pending_review: '待审核', rate_limit: '限速', require_source: '要求补来源', deduct: '扣分',
    demote: '降级', restore: '恢复', ban: '暂停账号', delete: '删除'
  };
  var ACTION_STATE = { awaiting_second: '等第二人确认', executed: '已生效', reverted: '已撤销', expired: '已到期', cancelled: '已撤回' };
  var RULE_KIND = { detector: '检测', context: '上下文', agent: 'Agent', policy: '策略' };
  var REPORT_REASON = { spam: '广告刷屏', contact: '留联系方式', harassment: '骚扰', illegal: '违法', misinformation: '不实信息', copyright: '版权', privacy: '隐私', other: '其他' };
  // 聊天消息 / 私信 / 找搭子事项（R17-G、R17-H4）：目标是一条被举报的消息或帖子，不是内容对象。
  // 转待审核、删除对它们无效；「隐藏」（找搭子需求叫「收起」）和「通过并恢复」只给广场消息和需求帖，私信、搭子邀约都不画。
  var CHAT_TITLE = { chat_message: '广场消息', dm_message: '私信（被举报的一条）', buddy_post: '找搭子需求', buddy_invite: '搭子邀约' };
  var HIDEABLE_CHAT = ['chat_message', 'buddy_post'];
  var HIDE_KEEPS = ['hide', 'restore'];
  var CONTENT_ONLY_ACTIONS = ['hide', 'pending_review', 'delete', 'restore'];
  var NEEDS_SUBJECT = ['ban', 'deduct', 'demote', 'rate_limit'];
  var PREVIEW_STATE = { active: '公开中', pending_review: '待审核（仅作者可见）', hidden: '已隐藏（仅作者可见）', draft: '草稿' };
  var DEMO_NOTE = '示例：只在本页模拟，没有发到服务器。';

  var state = {
    loaded: false, loading: false, error: null, data: null, me: null, cursor: null,
    tab: 'queue', status: 'active', risk: 'all', selected: null, detail: null, detailError: null,
    action: null, reason: '', panelError: null, busy: false,
    premod: { open: false, reason: '', typed: '' },
    rule: { editing: null, draft: null, error: null },
    appeal: { reasons: {}, error: null },
    viewer: 'governor'
  };
  var complaint = { locator: '', category: 'copyright', statement: '', busy: false, message: '', error: '', rows: null, reasons: {} };
  var complaintEpoch = 0;
  var bound = false;
  var htmlView = null;
  var htmlEpoch = 0;

  /* ---------- 工具 ---------- */

  function esc(value) {
    return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function focusToken(element) {
    var control = element && element.closest && element.closest('[data-gov-act]');
    if (!control || !control.closest('[data-gov-root]')) return null;
    return {
      act: control.getAttribute('data-gov-act') || '',
      value: control.getAttribute('data-value') || '',
      id: control.getAttribute('data-id') || ''
    };
  }

  function restoreFocus(token) {
    if (!token) return;
    var controls = document.querySelectorAll('[data-gov-root] [data-gov-act]');
    var target = Array.prototype.find.call(controls, function (control) {
      return (control.getAttribute('data-gov-act') || '') === token.act &&
        (control.getAttribute('data-value') || '') === token.value &&
        (control.getAttribute('data-id') || '') === token.id;
    });
    if (target && !target.disabled) {
      try { target.focus({ preventScroll: true }); } catch (err) { target.focus(); }
    }
  }

  /* safe-fn: CommonsLinks.person/a 自行转义；降级分支只使用本函数转义后的字段。 */
  function personLink(person) {
    person = person || {};
    if (window.CommonsLinks && typeof window.CommonsLinks.person === 'function') {
      return window.CommonsLinks.person(person.handle, person.display_name || person.name, { level: person.level });
    }
    var name = person.display_name || person.name || '';
    return person.handle ? '<a class="lk-person" href="#/u/' + encodeURIComponent(person.handle) + '">' + esc(name) + '</a>' : esc(name);
  }

  function targetLink(target, label) {
    target = target || {};
    var kind = target.object_type === 'knowledge' ? 'knowledge' : target.object_type === 'work' ? 'component' : 'thread';
    var fallback = target.object_type === 'knowledge' ? '#/knowledge/' : target.object_type === 'work' ? '#/work/' : '#/threads/';
    if (target.type !== 'object' || !target.id) return esc(label);
    if (window.CommonsLinks && typeof window.CommonsLinks.href === 'function' && typeof window.CommonsLinks.a === 'function' && window.CommonsLinks.href(kind, target.id)) {
      return window.CommonsLinks.a(kind, target.id, label, 'gov-target-link');
    }
    return '<a class="gov-target-link" href="' + fallback + encodeURIComponent(target.id) + '">' + esc(label) + '</a>';
  }

  function icon(size) {
    return '<svg viewBox="0 0 24 24" width="' + Number(size || 18) + '" height="' + Number(size || 18) + '" aria-hidden="true"><path d="' + ICON + '" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }

  function live() { return !!(window.CommonsAPI && window.CommonsAPI.mode === 'live'); }

  function api() { return window.CommonsAPI; }

  function clone(value) { return JSON.parse(JSON.stringify(value)); }

  function key() { return api().newIdempotencyKey(); }

  function toast(message) {
    if (window.Commons && window.Commons.toast) window.Commons.toast(message);
  }

  function pct(value) {
    return value == null ? '—' : Math.round(Number(value) * 100) + '%';
  }

  function sla(item) {
    var left = Math.round((Date.parse(item.sla_due_at) - Date.now()) / 60000);
    var abs = Math.abs(left);
    var text = abs >= 60 ? Math.floor(abs / 60) + ' 小时 ' + (abs % 60) + ' 分' : abs + ' 分';
    return left < 0 ? '超时 ' + text : '剩 ' + text;
  }

  function when(value) {
    if (!value) return '';
    var d = new Date(value);
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  function demoTag() { return live() ? '' : '<span class="pill gov-demo-pill">示例</span>'; }

  function governor() {
    if (live()) return !!(state.me && state.me.governor);
    return state.viewer === 'governor';
  }

  function viewerId() { return state.me && state.me.id; }

  function findCase(id) {
    return (state.data && state.data.queue || []).filter(function (c) { return c.id === id; })[0] || null;
  }

  /* ---------- 数据 ---------- */

  function useSample() {
    var sample = window.COMMONS_GOVERN_SAMPLE;
    if (!sample) { state.error = '示例数据没有加载（缺 govern-sample.js）。'; return; }
    state.data = clone(sample);
    state.me = state.data.me;
    state.loaded = true;
    if (!state.selected && state.data.queue.length) state.selected = state.data.queue[0].id;
    state.detail = state.selected ? state.data.cases[state.selected] || null : null;
  }

  function fail(err) {
    state.loading = false;
    state.busy = false;
    state.error = (err && err.message) || '加载失败';
    refresh();
  }

  function query() {
    var q = { status: state.status === 'active' ? 'active' : state.status };
    if (state.risk !== 'all') q.risk = state.risk;
    return q;
  }

  // 第三方投诉不进 gov_case，首屏单列一个数；这一项失败不影响治理台其余部分。
  function pendingComplaints() {
    return api().get('/governance/complaints').then(function (res) { return res.data.length; }).catch(function () { return null; });
  }

  function loadLive() {
    state.loading = true;
    state.error = null;
    refresh();
    return api().get('/governance/me').then(function (res) {
      state.me = res.data;
      if (!res.data.governor) {
        state.loading = false;
        state.loaded = true;
        state.data = null;
        refresh();
        return null;
      }
      return Promise.all([api().get('/governance/stats'), api().get('/governance/queue', query()), pendingComplaints()]).then(function (out) {
        state.data = state.data || {};
        state.data.stats = out[0].data;
        state.data.complaintsPending = out[2];
        state.data.queue = out[1].data;
        state.cursor = out[1].meta.next_cursor || null;
        state.loading = false;
        state.loaded = true;
        var keep = state.selected && findCase(state.selected) ? state.selected : (state.data.queue[0] && state.data.queue[0].id);
        if (keep) return selectCase(keep);
        state.selected = null;
        state.detail = null;
        refresh();
        return null;
      });
    }).catch(function (err) {
      if (err && (err.code === 'unauthenticated' || err.code === 'session_expired')) {
        state.me = null; state.data = null; state.loaded = true; state.loading = false; state.error = null; refresh();
      } else fail(err);
    });
  }

  function reloadQueue() {
    if (!live()) { refresh(); return Promise.resolve(); }
    return api().get('/governance/queue', query()).then(function (res) {
      state.data.queue = res.data;
      state.cursor = res.meta.next_cursor || null;
      refresh();
    }).catch(fail);
  }

  function moreQueue() {
    if (!state.cursor) return;
    var q = query();
    q.cursor = state.cursor;
    api().get('/governance/queue', q).then(function (res) {
      state.data.queue = state.data.queue.concat(res.data);
      state.cursor = res.meta.next_cursor || null;
      refresh();
    }).catch(fail);
  }

  function selectCase(id) {
    state.selected = id;
    state.action = null;
    state.reason = '';
    state.panelError = null;
    state.detailError = null;
    if (!live()) {
      state.detail = state.data.cases[id] || null;
      refresh();
      return Promise.resolve();
    }
    state.detail = null;
    refresh();
    return api().get('/governance/cases/' + encodeURIComponent(id)).then(function (res) {
      if (state.selected !== id) return;
      state.detail = res.data;
      refresh();
    }).catch(function (err) {
      state.detailError = (err && err.message) || '事项加载失败';
      refresh();
    });
  }

  function afterWrite(message) {
    state.busy = false;
    state.action = null;
    state.reason = '';
    toast(message);
    return Promise.all([
      api().get('/governance/stats').then(function (res) { state.data.stats = res.data; }),
      api().get('/governance/queue', query()).then(function (res) { state.data.queue = res.data; state.cursor = res.meta.next_cursor || null; })
    ]).then(function () { return selectCase(state.selected); }).catch(fail);
  }

  function writeFailed(err) {
    state.busy = false;
    state.panelError = (err && err.message) || '操作没有完成';
    refresh();
  }

  /* ---------- 视图：页头、统计、开关 ---------- */

  function viewerSwitch() {
    if (live()) return '';
    return '<div class="segmented gov-viewer" role="group" aria-label="示例视角">' +
      '<button type="button" aria-pressed="' + (state.viewer === 'governor' ? 'true' : 'false') + '" data-gov-act="viewer" data-value="governor">治理员视角</button>' +
      '<button type="button" aria-pressed="' + (state.viewer === 'member' ? 'true' : 'false') + '" data-gov-act="viewer" data-value="member">普通成员视角</button></div>';
  }

  function header() {
    return '<header class="gov-head"><p>处置由人确认，过程留痕。</p>' +
      '<div class="gov-head-actions">' + viewerSwitch() + demoTag() + '</div></header>' + complaintForm();
  }

  function stat(label, value, hint, tone) {
    return '<div class="gov-stat' + (tone ? ' is-' + esc(tone) : '') + '"><span class="gov-stat-label">' + esc(label) + '</span>' +
      '<strong>' + esc(value) + '</strong><small>' + esc(hint) + '</small></div>';
  }

  function complaintStat() {
    var n = state.data && state.data.complaintsPending;
    if (!live() || n == null) return '';
    return '<div class="gov-stat"><span class="gov-stat-label">第三方投诉</span><strong>' + esc(n >= 50 ? '50+' : String(n)) + '</strong>' +
      '<small>' + (n ? '<button type="button" class="button ghost small" data-gov-act="tab" data-value="complaints">待处理，点此查看</button>' : '没有待处理') + '</small></div>';
  }

  function premodPanel(on) {
    var p = state.premod;
    if (!p.open) return '';
    var ready = p.reason.trim() && p.typed.trim() === '先审后发';
    return '<div class="gov-premod-confirm" role="group" aria-label="确认切换先审后发">' +
      '<p><strong>' + (on ? '关闭先审后发？' : '打开先审后发？') + '</strong>' +
      (on ? '关闭后新内容恢复直接公开，只走规则初筛。' : '打开后所有成员的新内容都先进待审核，作者自己能看到，治理员看过才公开。这会明显拖慢社区节奏，只在紧急时用。') + '</p>' +
      '<label class="field"><span>理由（进审计）</span><textarea rows="2" data-gov-input="premod-reason">' + esc(p.reason) + '</textarea></label>' +
      '<label class="field"><span>输入「先审后发」确认</span><input type="text" autocomplete="off" data-gov-input="premod-typed" value="' + esc(p.typed) + '"></label>' +
      '<div class="gov-row"><button type="button" class="button danger" data-gov-act="premod-confirm"' + (ready && !state.busy ? '' : ' disabled') + '>' + (on ? '确认关闭' : '确认打开') + '</button>' +
      '<button type="button" class="button ghost" data-gov-act="premod-cancel">取消</button></div></div>';
  }

  function statsBar() {
    var s = state.data.stats || {};
    var agent = (s.reviews && s.reviews.agent) || {};
    var rule = (s.reviews && s.reviews.rule) || {};
    var on = !!(s.flags && s.flags['gov.premoderation']);
    var egress = !!(s.flags && s.flags['gov.model_egress']);
    return '<section class="gov-stats" aria-label="治理概况">' +
      stat('待处理', String(Number(s.pending || 0)), '今日新开 ' + Number(s.opened_today || 0) + ' 件', '') +
      stat('超时', String(Number(s.overdue || 0)), '等第二人确认 ' + Number(s.awaiting_second || 0) + ' 件', s.overdue ? 'danger' : '') +
      complaintStat() +
      stat('Agent 采纳率', pct(agent.adoption_rate), '规则采纳 ' + pct(rule.adoption_rate) + '，复核 ' + Number(agent.reviewed || 0) + ' 条', 'agent') +
      stat('误判率', pct(agent.false_positive_rate), '规则误判 ' + pct(rule.false_positive_rate), '') +
      '<div class="gov-stat gov-premod' + (on ? ' is-on' : '') + '"><span class="gov-stat-label">先审后发</span>' +
      '<button type="button" class="button danger small" data-gov-act="premod-open" aria-expanded="' + (state.premod.open ? 'true' : 'false') + '">' + (on ? '已开启 · 点此关闭' : '已关闭 · 点此开启') + '</button>' +
      '<small>' + (egress ? '模型初筛：已开启（建议只进队列）' : '模型初筛：未开启') + '</small></div>' +
      premodPanel(on) + '</section>';
  }

  function tabs() {
    var rows = [['queue', '队列'], ['rules', '规则'], ['appeals', '申诉'], ['complaints', '第三方投诉']];
    return '<div class="tabs gov-tabs" role="tablist" aria-label="治理台分区">' + rows.map(function (row) {
      var selected = state.tab === row[0];
      return '<button type="button" role="tab" id="gov-tab-' + esc(row[0]) + '" aria-selected="' + (selected ? 'true' : 'false') +
        '" aria-controls="gov-panel-' + esc(row[0]) + '" tabindex="' + (selected ? '0' : '-1') +
        '" data-gov-act="tab" data-value="' + esc(row[0]) + '">' + esc(row[1]) + '</button>';
    }).join('') + '</div>';
  }

  /* ---------- 视图：队列 ---------- */

  function visibleQueue() {
    var list = state.data.queue || [];
    if (live()) return list;
    return list.filter(function (c) {
      var okStatus = state.status === 'all' || (state.status === 'active' ? (c.status === 'open' || c.status === 'triaged') : c.status === state.status);
      return okStatus && (state.risk === 'all' || c.risk === state.risk);
    });
  }

  function queueItem(c) {
    var t = c.target || {};
    var selected = c.id === state.selected;
    return '<button type="button" class="gov-item risk-' + esc(c.risk) + (selected ? ' is-selected' : '') + '" data-gov-act="select" data-id="' + esc(c.id) + '" aria-pressed="' + (selected ? 'true' : 'false') + '">' +
      '<span class="gov-item-top"><span class="gov-risk">' + esc(RISK[c.risk] || c.risk) + '</span>' +
      '<span class="chip gov-cat">' + esc(CATEGORY[c.category] || c.category) + '</span>' +
      '<span class="gov-source">' + esc(SOURCE[c.source] || c.source) + '</span></span>' +
      '<strong class="gov-item-title">' + esc(t.title || '（无标题）') + '</strong>' +
      '<span class="gov-item-meta"><span class="' + (c.overdue ? 'gov-overdue' : '') + '">' + esc(sla(c)) + '</span>' +
      '<span>' + esc(c.assignee ? '分派给 ' + c.assignee.display_name : '未分派') + '</span>' +
      (c.report_count ? '<span>举报 ' + Number(c.report_count) + '</span>' : '') +
      (c.awaiting_second ? '<span class="gov-wait">待第二人</span>' : '') + '</span></button>';
  }

  function queueView() {
    var list = visibleQueue();
    var statusBar = '<div class="segmented gov-filter" role="group" aria-label="按状态">' + STATUS.map(function (row) {
      return '<button type="button" aria-pressed="' + (state.status === row[0] ? 'true' : 'false') + '" data-gov-act="status" data-value="' + row[0] + '">' + row[1] + '</button>';
    }).join('') + '</div>';
    var riskBar = '<div class="gov-risk-filter" role="group" aria-label="按风险">' + ['all'].concat(RISK_ORDER).map(function (r) {
      return '<button type="button" class="chip" aria-pressed="' + (state.risk === r ? 'true' : 'false') + '" data-gov-act="risk" data-value="' + r + '">' + (r === 'all' ? '全部风险' : RISK[r]) + '</button>';
    }).join('') + '</div>';
    return '<aside class="gov-queue" aria-label="事项队列">' + statusBar + riskBar +
      '<div class="gov-queue-list">' + (list.length ? list.map(queueItem).join('') : '<p class="gov-empty">这个筛选下没有事项。</p>') + '</div>' +
      (live() && state.cursor ? '<button type="button" class="button ghost small" data-gov-act="more">加载更多</button>' : '') + '</aside>';
  }

  /* ---------- 视图：事项详情 ---------- */

  function textRanges(signals, length) {
    var ranges = [];
    (signals || []).forEach(function (s) {
      var loc = s.locator || {};
      if (loc.field !== 'text') return;
      var spans = Array.isArray(loc.spans) ? loc.spans : [loc];
      spans.forEach(function (sp) {
        var a = Number(sp.start);
        var b = Number(sp.end);
        if (isFinite(a) && isFinite(b) && b > a) ranges.push([Math.max(0, a), Math.min(length, b)]);
      });
    });
    ranges.sort(function (x, y) { return x[0] - y[0]; });
    var merged = [];
    ranges.forEach(function (r) {
      var last = merged[merged.length - 1];
      if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
      else if (r[1] > r[0]) merged.push([r[0], r[1]]);
    });
    return merged;
  }

  function highlighted(text, signals) {
    var ranges = textRanges(signals, text.length);
    var out = '';
    var pos = 0;
    ranges.forEach(function (r) {
      out += esc(text.slice(pos, r[0])) + '<mark class="gov-mark">' + esc(text.slice(r[0], r[1])) + '</mark>';
      pos = r[1];
    });
    return out + esc(text.slice(pos));
  }

  function hasHtmlPreview(p) {
    return !!(p && (live() ? (p.has_html || p.asset_id || p.content_url || p.html) : p.html));
  }

  function previewView(d) {
    var p = d.preview || {};
    if (p.state === 'withdrawn' || p.state === 'missing') {
      return '<div class="gov-preview gov-preview-gone"><strong>' + esc(p.message || '已撤回') + '</strong><p>作者已撤回这条内容，正文不再显示。事项里的证据和处理记录仍然保留。</p></div>';
    }
    if (CHAT_TITLE[p.state]) {
      var attach = (p.has_image ? '<span class="chip">含图片</span>' : '') + (p.has_sticker ? '<span class="chip">含表情</span>' : '');
      return '<div class="gov-preview gov-preview-chat" data-gov-chat="' + esc(p.state) + '"><div class="gov-preview-head"><span class="pill">' + esc(CHAT_TITLE[p.state]) + '</span>' +
        (p.sent_at ? '<span>发送于 ' + esc(when(p.sent_at)) + '</span>' : '') + (p.reported_at ? '<span>举报于 ' + esc(when(p.reported_at)) + '</span>' : '') + '</div>' +
        '<h3>' + esc(CHAT_TITLE[p.state]) + '</h3>' +
        (p.text ? '<p class="gov-text">' + esc(p.text) + '</p>' : '<p class="gov-dim">这条消息没有文字。</p>') +
        (attach ? '<div class="gov-media">' + attach + '</div>' : '') +
        (p.message ? '<p class="gov-note">' + esc(p.message) + '</p>' : '') + '</div>';
    }
    if (p.state === 'upload') {
      return '<div class="gov-preview gov-preview-gone"><strong>上传文件</strong><p>' + esc(p.message) + '</p></div>';
    }
    var media = (p.media || []).map(function (m) {
      return '<span class="chip">' + esc(m.mime || m.kind) + (m.width ? ' · ' + Number(m.width) + '×' + Number(m.height) : '') + '</span>';
    }).join('');
    return '<div class="gov-preview"><div class="gov-preview-head"><span class="pill">' + esc(PREVIEW_STATE[p.state] || p.state) + '</span>' +
      '<span>第 ' + Number(p.version || 1) + ' 版</span></div>' +
      '<h3>' + /* safe: targetLink returns escaped or CommonsLinks-owned HTML */ targetLink(d.target, p.title) + '</h3>' +
      (p.text ? '<p class="gov-text">' + highlighted(p.text, d.signals) + '</p>' : '') +
      (p.truncated ? '<p class="gov-note">正文较长，只显示前 2 万字。</p>' : '') +
      (hasHtmlPreview(p) ? '<div class="gov-html" data-gov-html role="region" aria-label="HTML 安全预览（沙箱）"></div><p class="gov-note">' +
        (live() ? '作品原文在独立内容域名的沙箱中预览，未做联系方式遮盖。' : 'HTML 在沙箱里渲染，不执行外部脚本；联系方式已遮盖。') + '</p>' : '') +
      (media ? '<div class="gov-media">' + media + '</div>' : '') + '</div>';
  }

  function locatorText(loc) {
    if (!loc) return '';
    if (loc.field === 'html') return 'HTML 第 ' + (loc.lines || []).map(Number).join('、') + ' 行 · ' + (loc.code || '');
    if (loc.field === 'media') return '第 ' + (Number(loc.index || 0) + 1) + ' 个文件';
    if (loc.field === 'activity') return '近 ' + Number(loc.window_minutes || 0) + ' 分钟 ' + Number(loc.count || 0) + ' 条';
    if (Array.isArray(loc.spans)) return '正文 ' + loc.spans.length + ' 处（已高亮）';
    if (loc.start != null) return '正文已高亮';
    return '';
  }

  function signalView(s) {
    var agent = s.detector && s.detector.kind === 'agent';
    return '<li class="gov-signal' + (agent ? ' is-agent' : '') + '"><div class="gov-signal-head">' +
      '<strong>' + esc(s.rule.title || s.rule.id) + '</strong><span class="gov-dim">第 ' + Number(s.rule.version) + ' 版</span>' +
      '<span class="pill">' + (agent ? 'Agent' : '规则') + '</span>' +
      '<span class="gov-score">' + pct(s.score) + '</span></div>' +
      '<p>' + esc(s.summary || '') + '</p>' +
      '<span class="gov-dim">' + esc(locatorText(s.locator)) + (agent && s.detector.model ? ' · 模型 ' + esc(s.detector.model) : '') + '</span></li>';
  }

  function suggestionCard(d) {
    var s = d.suggestion;
    if (!s) return '';
    return '<section class="gov-suggest" aria-label="Agent 建议"><div class="gov-suggest-head">' +
      '<span class="pill gov-suggest-pill">' + esc(s.label || 'Agent 建议，需人确认') + '</span>' +
      '<span>置信度 ' + pct(s.confidence) + '</span></div>' +
      '<p>建议：<strong>' + esc(ACTION_LABEL[s.action] || s.action) + '</strong>，依据：' + esc((s.basis || []).join('、')) + '。</p>' +
      (isChatCase(d) && CONTENT_ONLY_ACTIONS.indexOf(s.action) >= 0 && !(canHideChat(d) && HIDE_KEEPS.indexOf(s.action) >= 0)
        ? '<p class="gov-dim">这个动作只能用在内容上，聊天消息不能套用。</p>'
        : '<button type="button" class="button tonal small" data-gov-act="pick" data-value="' + esc(s.action) + '"' + (governor() ? '' : ' disabled') + '>按建议填入</button>') + '</section>';
  }

  function historyView(d) {
    var rows = (d.actions || []).map(function (a) {
      var who = a.actor_kind === 'system' ? '系统自动' : (a.actor ? /* safe: personLink returns escaped or CommonsLinks-owned HTML */ personLink(a.actor) : '');
      return '<li><span class="gov-dim">' + esc(when(a.created_at)) + '</span> <strong>' + esc(ACTION_LABEL[a.type] || a.type) + '</strong> · ' +
        esc(ACTION_STATE[a.state] || a.state) + ' · ' + who + (a.second_actor ? '，' + /* safe: personLink returns escaped or CommonsLinks-owned HTML */ personLink(a.second_actor) + ' 确认' : '') +
        '<br><span class="gov-dim">' + esc(a.reason) + '</span></li>';
    }).join('');
    var reports = (d.reports || []).map(function (r) {
      return '<li><strong>' + esc(REPORT_REASON[r.reason_code] || r.reason_code) + '</strong> · 权重 ' + esc(Number(r.weight).toFixed(1)) +
        ' · ' + (r.reporter ? /* safe: personLink returns escaped or CommonsLinks-owned HTML */ personLink(r.reporter) + '（L' + esc(r.reporter.level) + '）' : '') + (r.note ? '<br><span class="gov-dim">' + esc(r.note) + '</span>' : '') + '</li>';
    }).join('');
    return (reports ? '<h4>举报</h4><ul class="gov-list">' + reports + '</ul>' : '') +
      '<h4>处理记录</h4>' + (rows ? '<ul class="gov-list">' + rows + '</ul>' : '<p class="gov-dim">还没有处理。</p>');
  }

  function detailView() {
    if (state.detailError) return '<section class="gov-detail"><p class="gov-error" role="alert">' + esc(state.detailError) + '</p></section>';
    var d = state.detail;
    if (!d) return '<section class="gov-detail"><p class="gov-empty">' + (state.selected ? '正在加载事项…' : '从左边选一件事项。') + '</p></section>';
    return '<section class="gov-detail" aria-label="事项详情"><div class="gov-detail-head">' +
      '<span class="gov-risk-badge risk-' + esc(d.risk) + '">' + esc(RISK[d.risk] || d.risk) + '风险</span>' +
      '<span class="chip">' + esc(CATEGORY[d.category] || d.category) + '</span>' +
      '<span class="gov-dim">' + esc(SOURCE[d.source] || d.source) + ' · ' + esc(CASE_STATUS[d.status] || d.status) + ' · ' + esc(sla(d)) + '</span></div>' +
      '<p class="gov-subject">涉及成员：' + (d.subject ? /* safe: personLink returns escaped or CommonsLinks-owned HTML */ personLink(d.subject) + '（L' + esc(d.subject.level) + '）' : '无') + '</p>' +
      previewView(d) + suggestionCard(d) +
      '<h4>证据</h4>' + ((d.signals || []).length ? '<ul class="gov-signals">' + d.signals.map(signalView).join('') + '</ul>' : '<p class="gov-dim">没有规则或 Agent 证据，来自举报。</p>') +
      historyView(d) + '</section>';
  }

  /* ---------- 视图：动作面板 ---------- */

  function isChatCase(d) {
    return !!(d && d.preview && CHAT_TITLE[d.preview.state]);
  }

  // 聊天事项不画内容类动作；没有对应成员（比如发消息的是 Agent）时，针对成员的动作灰掉并写原因。
  function canHideChat(d) {
    return isChatCase(d) && HIDEABLE_CHAT.indexOf(d.preview.state) >= 0;
  }

  function actionRows(rows, d) {
    if (!isChatCase(d)) return rows;
    var keep = canHideChat(d) ? HIDE_KEEPS : [];
    return rows.filter(function (row) { return CONTENT_ONLY_ACTIONS.indexOf(row[0]) < 0 || keep.indexOf(row[0]) >= 0; });
  }

  function actionLabel(row, d) {
    return row[0] === 'hide' && d && d.preview && d.preview.state === 'buddy_post' ? '收起' : row[1];
  }

  function actionButtons(rows, disabled, d) {
    return actionRows(rows, d).map(function (row) {
      var on = state.action === row[0];
      var noSubject = isChatCase(d) && !d.subject && NEEDS_SUBJECT.indexOf(row[0]) >= 0;
      return '<button type="button" class="chip gov-action" aria-pressed="' + (on ? 'true' : 'false') + '" data-gov-act="pick" data-value="' + esc(row[0]) + '" title="' + esc(noSubject ? '这条消息没有对应的成员，不能对人处理' : row[2]) + '"' + (disabled || noSubject ? ' disabled' : '') + '>' + esc(actionLabel(row, d)) + '</button>';
    }).join('');
  }

  function noticePreview(d) {
    if (!state.action) return '<p class="gov-dim">选一个动作后，这里显示被处理的人会收到的通知。</p>';
    if (state.action === 'restore') return '<p class="gov-dim">恢复后作者会收到「处理已撤销」的通知。</p>';
    var t = (d.notice_templates || {})[state.action];
    if (!t) return '';
    var reason = state.reason.trim() || '（还没填理由）';
    var body = esc(t.body).split('{reason}').join('<mark class="gov-mark">' + esc(reason) + '</mark>');
    return '<div class="gov-notice"><strong>' + esc(t.title) + '</strong><p>' + body + '</p></div>';
  }

  function waitingView(d) {
    var waiting = (d.actions || []).filter(function (a) { return a.state === 'awaiting_second'; });
    if (!waiting.length) return '';
    return '<div class="gov-waiting"><h4>等第二位治理员确认</h4>' + waiting.map(function (a) {
      var mine = a.actor && a.actor.id === viewerId();
      return '<div class="gov-waiting-item"><p><strong>' + esc(ACTION_LABEL[a.type] || a.type) + '</strong> · ' + (a.actor ? /* safe: personLink returns escaped or CommonsLinks-owned HTML */ personLink(a.actor) : '') + ' 提议<br>' +
        '<span class="gov-dim">' + esc(a.reason) + '</span></p>' +
        (mine ? '<button type="button" class="button ghost small" data-gov-act="cancel" data-id="' + esc(a.id) + '">撤回提议</button><span class="gov-dim">双人原则：要另一位治理员确认</span>'
          : '<button type="button" class="button danger small" data-gov-act="confirm" data-id="' + esc(a.id) + '"' + (state.busy || !governor() ? ' disabled' : '') + '>我确认执行</button>') + '</div>';
    }).join('') + '</div>';
  }

  function panelView() {
    var d = state.detail;
    if (!d) return '<aside class="gov-panel" aria-label="处置"></aside>';
    var conflicts = (d.viewer && d.viewer.conflicts) || [];
    var closed = d.status === 'dismissed' || d.status === 'closed' || d.status === 'appealed';
    var locked = conflicts.length > 0 || closed;
    var two = state.action === 'ban' || state.action === 'delete';
    var ready = state.action && state.reason.trim() && !state.busy && !locked;
    return '<aside class="gov-panel" aria-label="处置"><h3>处置</h3>' +
      (conflicts.length ? '<p class="gov-warn" role="note">' + (conflicts.indexOf('reporter') >= 0 ? '与此事项有关，不能处理。' : '这件事和你本人有关，请交给其他治理员。') + '</p>' : '') +
      (closed ? '<p class="gov-warn" role="note">这件事项已' + esc(CASE_STATUS[d.status] || d.status) + '，不能再处置。</p>' : '') +
      waitingView(d) +
      (isChatCase(d) ? '<p class="gov-dim" data-gov-chat-note>' + (canHideChat(d)
        ? (d.preview.state === 'buddy_post' ? '这条需求可以「收起」：别人看不到，作者看得到但不能自己恢复。没有「转待审核」「删除」。' : '这条消息可以「隐藏」：别人看不到，作者自己还能看到。没有「转待审核」「删除」。')
        : '这类事项没有「隐藏」「删除」：可以对被举报的成员处理，或判为不成立。') + '</p>' : '') +
      '<fieldset class="gov-group"><legend>可逆动作</legend><div class="gov-actions">' + actionButtons(REVERSIBLE, locked, d) + '</div></fieldset>' +
      '<fieldset class="gov-group is-two"><legend>需双人确认</legend><div class="gov-actions">' + actionButtons(TWO_PERSON, locked, d) + '</div>' +
      '<p class="gov-dim">提交后要另一位治理员点「我确认执行」才生效。</p></fieldset>' +
      '<label class="field"><span>理由（必填，原样给被处理的人看）</span><textarea rows="3" maxlength="1000" data-gov-input="reason"' + (locked ? ' disabled' : '') + '>' + esc(state.reason) + '</textarea></label>' +
      '<div class="gov-notice-wrap" data-gov-preview><h4>通知预览</h4>' + noticePreview(d) + '</div>' +
      (state.panelError ? '<p class="gov-error" role="alert">' + esc(state.panelError) + '</p>' : '') +
      '<div class="gov-row"><button type="button" class="button ' + (two ? 'danger' : 'primary') + '" data-gov-act="submit"' + (ready ? '' : ' disabled') + '>' + (two ? '提交，等第二人确认' : '执行') + '</button>' +
      '<button type="button" class="button ghost" data-gov-act="dismiss"' + (state.reason.trim() && !locked && !state.busy ? '' : ' disabled') + '>判为不成立</button></div>' +
      (live() ? '' : '<p class="gov-dim">' + DEMO_NOTE + '</p>') + '</aside>';
  }

  /* ---------- 视图：规则 ---------- */

  function ruleEditor(r) {
    var dr = state.rule.draft;
    var autoOptions = r.kind === 'agent' || r.kind === 'policy' ? ['none'] : ['none', 'pending_review', 'rate_limit', 'require_source'];
    return '<tr class="gov-rule-edit"><td colspan="7"><div class="gov-rule-form">' +
      '<label class="field"><span>启用</span><select data-gov-input="rule-enabled"><option value="1"' + (dr.enabled ? ' selected' : '') + '>启用</option><option value="0"' + (dr.enabled ? '' : ' selected') + '>停用</option></select></label>' +
      '<label class="field"><span>严重度</span><select data-gov-input="rule-severity">' + RISK_ORDER.map(function (k) {
        return '<option value="' + k + '"' + (dr.severity === k ? ' selected' : '') + '>' + RISK[k] + '</option>';
      }).join('') + '</select></label>' +
      '<label class="field"><span>阈值（0–1）</span><input type="number" min="0" max="1" step="0.05" data-gov-input="rule-threshold" value="' + esc(dr.threshold) + '"></label>' +
      '<label class="field"><span>自动动作（只能是可逆的）</span><select data-gov-input="rule-auto">' + autoOptions.map(function (k) {
        return '<option value="' + k + '"' + (dr.auto_action === k ? ' selected' : '') + '>' + (k === 'none' ? '不自动' : ACTION_LABEL[k]) + '</option>';
      }).join('') + '</select></label>' +
      '<label class="field gov-wide"><span>参数（JSON，字段和类型要与当前版本一致）</span><textarea rows="4" spellcheck="false" data-gov-input="rule-params">' + esc(dr.params) + '</textarea></label>' +
      '<label class="field gov-wide"><span>修改理由（必填，进审计）</span><input type="text" maxlength="1000" data-gov-input="rule-reason" value="' + esc(dr.reason) + '"></label>' +
      (state.rule.error ? '<p class="gov-error gov-wide" role="alert">' + esc(state.rule.error) + '</p>' : '') +
      '<div class="gov-row gov-wide"><button type="button" class="button primary" data-gov-act="rule-save"' + (dr.reason.trim() && !state.busy ? '' : ' disabled') + '>保存为第 ' + Number(r.version + 1) + ' 版</button>' +
      '<button type="button" class="button ghost" data-gov-act="rule-cancel">取消</button></div></div></td></tr>';
  }

  function rulesView() {
    var rules = state.data.rules;
    if (!rules) return '<section class="gov-rules"><p class="gov-empty">正在加载规则…</p></section>';
    return '<section class="gov-rules" aria-label="规则"><p class="gov-note">修改会生成新版本。</p>' +
      '<div class="gov-table-wrap"><table class="gov-table"><thead><tr><th>规则</th><th>类型</th><th>严重度</th><th>阈值</th><th>自动动作</th><th>状态</th><th></th></tr></thead><tbody>' +
      rules.map(function (r) {
        var row = '<tr><td><strong>' + esc(r.title) + '</strong><br><span class="gov-dim">' + esc(r.id) + ' · 第 ' + Number(r.version) + ' 版</span><br><span class="gov-dim">' + esc(r.description) + '</span></td>' +
          '<td>' + esc(RULE_KIND[r.kind] || r.kind) + '</td><td>' + esc(RISK[r.severity] || r.severity) + '</td><td>' + esc(Number(r.threshold).toFixed(2)) + '</td>' +
          '<td>' + esc(r.auto_action === 'none' ? '不自动' : (ACTION_LABEL[r.auto_action] || r.auto_action)) + '</td>' +
          '<td>' + (r.enabled ? '<span class="pill">启用</span>' : '<span class="pill gov-off">停用</span>') + '</td>' +
          '<td><button type="button" class="button ghost small" data-gov-act="rule-edit" data-id="' + esc(r.id) + '">编辑</button></td></tr>';
        return row + (state.rule.editing === r.id ? ruleEditor(r) : '');
      }).join('') + '</tbody></table></div></section>';
  }

  /* ---------- 视图：申诉 ---------- */

  function appealsView() {
    if (!state.me || !state.me.reviewer) {
      return '<section class="gov-appeals"><p class="gov-empty">申诉由 L5 成员复核（需开启动态验证码）。你可以在事项里看到申诉状态。</p></section>';
    }
    var list = state.data.appeals;
    if (!list) return '<section class="gov-appeals"><p class="gov-empty">正在加载申诉…</p></section>';
    if (!list.length) return '<section class="gov-appeals"><p class="gov-empty">没有待复核的申诉。</p></section>';
    return '<section class="gov-appeals" aria-label="申诉">' + (state.appeal.error ? '<p class="gov-error" role="alert">' + esc(state.appeal.error) + '</p>' : '') +
      list.map(function (a) {
        var reason = state.appeal.reasons[a.id] || '';
        var done = a.state !== 'submitted';
        var blocked = a.viewer_involved || done || state.busy;
        return '<article class="gov-appeal"><header><strong>' + esc(a.appellant.display_name) + '</strong> 对「' + esc(ACTION_LABEL[a.action.type] || a.action.type) + '」的申诉' +
          '<span class="gov-dim">' + esc(when(a.created_at)) + '</span></header>' +
          '<p class="gov-quote">' + esc(a.statement) + '</p>' +
          '<p class="gov-dim">原处理理由：' + esc(a.action.reason) + ' · 依据 ' + esc(a.action.rule_id || '社区规则') + (a.action.rule_version ? ' 第 ' + Number(a.action.rule_version) + ' 版' : '') + '</p>' +
          (done ? '<p class="pill">' + (a.state === 'overturned' ? '已撤销原处理' : '已维持原处理') + '</p>' :
            (a.viewer_involved ? '<p class="gov-warn">你参与过这件事，不能复核。</p>' : '') +
            '<label class="field"><span>复核意见（必填，申诉人会看到）</span><textarea rows="2" data-gov-input="appeal-reason" data-id="' + esc(a.id) + '"' + (blocked ? ' disabled' : '') + '>' + esc(reason) + '</textarea></label>' +
            '<div class="gov-row"><button type="button" class="button primary" data-gov-act="appeal" data-value="overturned" data-id="' + esc(a.id) + '"' + (reason.trim() && !blocked ? '' : ' disabled') + '>申诉成立，撤销并冲正</button>' +
            '<button type="button" class="button ghost" data-gov-act="appeal" data-value="upheld" data-id="' + esc(a.id) + '"' + (reason.trim() && !blocked ? '' : ' disabled') + '>维持原处理</button></div>') +
          '</article>';
      }).join('') + '</section>';
  }

  /* ---------- 页面 ---------- */

  function complaintForm() {
    return '<details class="gov-complaint"' + (complaint.error || complaint.message || complaint.busy ? ' open' : '') + '><summary>第三方投诉（无需登录）</summary>' +
      '<label class="field"><span>内容位置或链接</span><input data-gov-input="complaint-locator" maxlength="500" value="' + esc(complaint.locator) + '"></label>' +
      '<label class="field"><span>类型</span><select data-gov-input="complaint-category">' + ['copyright', 'privacy', 'illegal', 'other'].map(function (k) {
        return '<option value="' + esc(k) + '"' + (complaint.category === k ? ' selected' : '') + '>' + esc(CATEGORY[k]) + '</option>';
      }).join('') + '</select></label>' +
      '<label class="field"><span>投诉说明</span><textarea rows="3" maxlength="2000" data-gov-input="complaint-statement">' + esc(complaint.statement) + '</textarea></label>' +
      (complaint.error ? '<p role="alert">' + esc(complaint.error) + '</p>' : '') +
      (complaint.message ? '<p role="status">' + esc(complaint.message) + '</p>' : '') +
      '<button type="button" class="button tonal" data-gov-act="complaint-submit"' + (complaint.busy ? ' disabled aria-busy="true"' : '') + '>' +
      (complaint.busy ? '提交中…' : complaint.error ? '重试提交' : '提交投诉') + '</button></details>';
  }

  function sendComplaint() {
    if (complaint.busy) return;
    complaint.error = ''; complaint.message = '';
    if (!complaint.locator.trim() || !complaint.statement.trim()) {
      complaint.error = '请填写内容位置和投诉说明。'; refresh(); return;
    }
    if (!live()) { complaint.message = '示例模式不会提交投诉。'; refresh(); return; }
    var epoch = complaintEpoch;
    complaint.busy = true; refresh();
    api().post('/governance/complaints', { locator: complaint.locator.trim(), category: complaint.category, statement: complaint.statement.trim() })
      .then(function (res) {
        if (epoch !== complaintEpoch) return;
        complaint.message = '已受理，编号：' + res.data.id;
        complaint.locator = ''; complaint.statement = '';
      }).catch(function () { if (epoch === complaintEpoch) complaint.error = '投诉未确认受理，请重试。'; })
      .finally(function () { if (epoch === complaintEpoch) { complaint.busy = false; refresh(); } });
  }

  function complaintQueue() {
    if (!live()) return '<p class="gov-empty">示例模式没有第三方投诉。</p>';
    if (complaint.queueError) return '<p role="alert">投诉队列加载失败。</p><button type="button" class="button tonal" data-gov-act="complaints-retry">重试</button>';
    if (complaint.rows === null) return '<p class="gov-empty" role="status">正在加载…</p>';
    if (!complaint.rows.length) return '<p class="gov-empty">暂无待处理投诉。</p>';
    return '<ul class="gov-list gov-complaint-queue">' + complaint.rows.map(function (row) {
      return '<li><strong>' + esc(CATEGORY[row.category] || '其他') + '</strong><p>' + esc(row.locator) + '</p><p>' + esc(row.statement) + '</p>' +
        '<label class="field"><span>处理说明</span><textarea rows="2" maxlength="1000" data-gov-input="complaint-reason" data-id="' + esc(row.id) + '">' + esc(complaint.reasons[row.id] || '') + '</textarea></label>' +
        '<button type="button" class="button tonal" data-gov-act="complaint-decide" data-value="reviewed" data-id="' + esc(row.id) + '"' + (complaint.busy ? ' disabled' : '') + '>记录处理结果</button> ' +
        '<button type="button" class="button ghost" data-gov-act="complaint-decide" data-value="dismissed" data-id="' + esc(row.id) + '"' + (complaint.busy ? ' disabled' : '') + '>不予受理</button></li>';
    }).join('') + '</ul>' + (complaint.decisionError ? '<p role="alert">' + esc(complaint.decisionError) + '</p>' : '');
  }

  function loadComplaints() {
    if (!live()) { refresh(); return Promise.resolve(); }
    var epoch = complaintEpoch;
    complaint.rows = null; complaint.queueError = false; refresh();
    return api().get('/governance/complaints').then(function (res) {
      if (epoch !== complaintEpoch) return;
      complaint.rows = res.data;
      if (state.data) state.data.complaintsPending = res.data.length;
    })
      .catch(function () { if (epoch === complaintEpoch) complaint.queueError = true; })
      .finally(function () { if (epoch === complaintEpoch) refresh(); });
  }

  function decideComplaint(id, outcome) {
    if (complaint.busy) return;
    var reason = (complaint.reasons[id] || '').trim();
    if (!reason) { complaint.decisionError = '请填写处理说明。'; refresh(); return; }
    var epoch = complaintEpoch;
    complaint.decisionError = ''; complaint.busy = true; refresh();
    api().post('/governance/complaints/' + encodeURIComponent(id) + '/decide', { state: outcome, reason: reason }, { idempotencyKey: key() })
      .then(function () { if (epoch !== complaintEpoch) return; delete complaint.reasons[id]; return loadComplaints(); })
      .catch(function () { if (epoch === complaintEpoch) complaint.decisionError = '处理未成功，请重试。'; })
      .finally(function () { if (epoch === complaintEpoch) { complaint.busy = false; refresh(); } });
  }

  function guardView() {
    return '<section class="gov-guard" role="status">' + icon(28) + '<h2>这里只有治理员能看</h2>' +
      '<p>举报与申诉</p></section>';
  }

  function body() {
    if (state.error) {
      return header() + '<section class="gov-guard" role="alert"><h2>治理台没有加载出来</h2><p>' + esc(state.error) + '</p>' +
        '<button type="button" class="button tonal" data-gov-act="retry">重试</button></section>';
    }
    if (live() && (!state.loaded || state.loading) && !state.data) return header() + '<p class="gov-empty" role="status">正在加载…</p>';
    if (!governor()) return header() + guardView();
    if (!state.data) return header() + '<p class="gov-empty" role="status">正在加载…</p>';
    var main = state.tab === 'complaints' ? complaintQueue() : state.tab === 'rules' ? rulesView() : state.tab === 'appeals' ? appealsView()
      : '<div class="gov-grid">' + queueView() + detailView() + panelView() + '</div>';
    return header() + statsBar() + tabs() + '<section class="gov-tab-panel" id="gov-panel-' + esc(state.tab) +
      '" role="tabpanel" tabindex="0" aria-labelledby="gov-tab-' + esc(state.tab) + '">' + main + '</section>';
  }

  function page() {
    if (!live() && !state.loaded) useSample();
    return '<div class="gov-page" data-gov-root>' + body() + '</div>';
  }

  function mountHtml() {
    var epoch = ++htmlEpoch;
    if (htmlView) { htmlView.destroy(); htmlView = null; }
    var host = document.querySelector('[data-gov-html]');
    var d = state.detail;
    if (!host || !d || !hasHtmlPreview(d.preview)) return;
    if (window.CommonsHTML && window.CommonsHTML.render) {
      var options = { title: d.preview.title || 'HTML 预览' };
      if (!live()) {
        options.html = d.preview.html;
        htmlView = window.CommonsHTML.render(host, options);
        return;
      }
      var p = d.preview;
      if (!p.asset_id && !p.content_url) {
        host.textContent = '这个作品没有内容地址，不能预览。';
        return;
      }
      function current() {
        return epoch === htmlEpoch && state.detail === d && document.querySelector('[data-gov-html]') === host;
      }
      function contentUrl(res) {
        var url = res && res.data && res.data.content_url;
        if (!url) throw new Error('missing_content_url');
        return url;
      }
      host.textContent = '正在读取作品地址…';
      var pending = p.asset_id
        ? api().get('/media/assets/' + encodeURIComponent(p.asset_id)).then(contentUrl)
        : Promise.resolve(p.content_url);
      pending.catch(function () {
        if (!current() || !p.asset_id) return null;
        return api().get('/governance/cases/' + encodeURIComponent(d.id) + '/preview', { asset_id: p.asset_id }).then(contentUrl);
      }).then(function (url) {
        if (!current() || !url) return;
        options.contentUrl = url;
        htmlView = window.CommonsHTML.render(host, options);
      }).catch(function () {
        if (!current()) return;
        host.innerHTML = '<p role="alert">作品地址没有取到。</p><button type="button" class="button tonal" data-gov-act="preview-retry">重试</button>';
      });
    } else {
      host.textContent = 'HTML 预览需要 html-render.js。';
    }
  }

  function refresh() {
    var root = document.querySelector('[data-gov-root]');
    if (!root) return;
    var token = focusToken(document.activeElement);
    if (htmlView) { htmlView.destroy(); htmlView = null; }
    root.innerHTML = body();
    mountHtml();
    restoreFocus(token);
  }

  function refreshPreview() {
    var box = document.querySelector('[data-gov-preview]');
    if (box && state.detail) box.innerHTML = '<h4>通知预览</h4>' + noticePreview(state.detail);
    var submit = document.querySelector('[data-gov-act="submit"]');
    var locked = !!document.querySelector('.gov-panel textarea[data-gov-input="reason"][disabled]');
    if (submit) submit.disabled = !(state.action && state.reason.trim() && !state.busy && !locked);
    var dismiss = document.querySelector('[data-gov-act="dismiss"]');
    if (dismiss) dismiss.disabled = !(state.reason.trim() && !state.busy && !locked);
  }

  /* ---------- 动作 ---------- */

  function demoAct() {
    var d = state.detail;
    var two = state.action === 'ban' || state.action === 'delete';
    var me = { id: viewerId(), display_name: '示例治理员 甲', level: 4 };
    if (state.action === 'restore') {
      d.actions.forEach(function (a) { if (a.state === 'executed' && (a.type === 'hide' || a.type === 'pending_review')) a.state = 'reverted'; });
      if (d.preview && (d.preview.state === 'hidden' || d.preview.state === 'pending_review')) d.preview.state = 'active';
    } else {
      d.actions.push({ id: 'demo-local-' + d.actions.length, type: state.action, state: two ? 'awaiting_second' : 'executed',
        automatic: false, reversible: state.action !== 'delete', actor_kind: 'governor', actor: me, second_actor: null,
        reason: state.reason.trim(), created_at: new Date().toISOString() });
      if (!two && d.preview && !isChatCase(d) && (state.action === 'hide' || state.action === 'pending_review')) d.preview.state = state.action === 'hide' ? 'hidden' : 'pending_review';
    }
    if (!two) { d.status = state.action === 'restore' ? 'dismissed' : 'actioned'; syncCase(d); }
    state.action = null;
    state.reason = '';
    toast(DEMO_NOTE);
    refresh();
  }

  function syncCase(d) {
    var c = findCase(d.id);
    if (c) c.status = d.status;
    if (state.data.stats && d.status !== 'open') state.data.stats.pending = Math.max(0, Number(state.data.stats.pending || 0) - 1);
  }

  function submit() {
    if (!state.action || !state.reason.trim() || !state.detail) return;
    if (!live()) { demoAct(); return; }
    state.busy = true;
    state.panelError = null;
    refresh();
    var two = state.action === 'ban' || state.action === 'delete';
    api().post('/governance/cases/' + encodeURIComponent(state.detail.id) + '/actions', { type: state.action, reason: state.reason.trim() },
      { idempotencyKey: key() }).then(function () {
      return afterWrite(two ? '已提交，等另一位治理员确认。' : '已执行，被处理的人会收到通知。');
    }).catch(writeFailed);
  }

  function dismiss() {
    if (!state.reason.trim() || !state.detail) return;
    if (!live()) {
      state.detail.status = 'dismissed';
      syncCase(state.detail);
      state.reason = '';
      toast(DEMO_NOTE);
      refresh();
      return;
    }
    state.busy = true;
    api().post('/governance/cases/' + encodeURIComponent(state.detail.id) + '/dismiss', { reason: state.reason.trim() },
      { idempotencyKey: key() }).then(function () { return afterWrite('已判为不成立，自动动作已撤销。'); }).catch(writeFailed);
  }

  function confirmAction(id) {
    if (!live()) {
      state.detail.actions.forEach(function (a) {
        if (a.id === id) { a.state = 'executed'; a.second_actor = { id: viewerId(), display_name: '示例治理员 甲' }; }
      });
      state.detail.status = 'actioned';
      syncCase(state.detail);
      toast(DEMO_NOTE);
      refresh();
      return;
    }
    state.busy = true;
    api().post('/governance/actions/' + encodeURIComponent(id) + '/confirm', {}, { idempotencyKey: key() })
      .then(function () { return afterWrite('已确认执行。'); }).catch(writeFailed);
  }

  function cancelAction(id) {
    if (!live()) {
      state.detail.actions.forEach(function (a) { if (a.id === id) a.state = 'cancelled'; });
      toast(DEMO_NOTE);
      refresh();
      return;
    }
    state.busy = true;
    api().post('/governance/actions/' + encodeURIComponent(id) + '/cancel', { reason: '提议人撤回' }, { idempotencyKey: key() })
      .then(function () { return afterWrite('提议已撤回。'); }).catch(writeFailed);
  }

  function premodConfirm() {
    var on = !!(state.data.stats.flags && state.data.stats.flags['gov.premoderation']);
    var p = state.premod;
    if (!p.reason.trim() || p.typed.trim() !== '先审后发') return;
    if (!live()) {
      state.data.stats.flags['gov.premoderation'] = !on;
      state.premod = { open: false, reason: '', typed: '' };
      toast(DEMO_NOTE);
      refresh();
      return;
    }
    state.busy = true;
    refresh();
    api().post('/governance/premoderation', { enabled: !on, reason: p.reason.trim(), confirm: '先审后发' }, { idempotencyKey: key() })
      .then(function () {
        state.premod = { open: false, reason: '', typed: '' };
        return afterWrite(on ? '先审后发已关闭。' : '先审后发已开启，新内容会先进待审核。');
      }).catch(function (err) {
        state.busy = false;
        state.premod.open = true;
        toast((err && err.message) || '没有切换成功');
        refresh();
      });
  }

  function loadRules() {
    if (!live() || state.data.rules) { refresh(); return; }
    refresh();
    api().get('/governance/rules').then(function (res) { state.data.rules = res.data; refresh(); }).catch(fail);
  }

  function loadAppeals() {
    if (!live() || !state.me || !state.me.reviewer) { refresh(); return; }
    state.data.appeals = null;
    refresh();
    api().get('/governance/appeals').then(function (res) { state.data.appeals = res.data; refresh(); }).catch(function (err) {
      state.appeal.error = (err && err.message) || '申诉没有加载出来';
      state.data.appeals = [];
      refresh();
    });
  }

  function ruleEdit(id) {
    var r = state.data.rules.filter(function (x) { return x.id === id; })[0];
    if (!r) return;
    state.rule = { editing: id, error: null, draft: { enabled: !!r.enabled, severity: r.severity, threshold: r.threshold,
      auto_action: r.auto_action, params: JSON.stringify(r.params, null, 2), reason: '' } };
    refresh();
  }

  function ruleSave() {
    var r = state.data.rules.filter(function (x) { return x.id === state.rule.editing; })[0];
    var dr = state.rule.draft;
    if (!r || !dr.reason.trim()) return;
    var params;
    try { params = JSON.parse(dr.params); } catch (e) { state.rule.error = '参数不是合法的 JSON。'; refresh(); return; }
    var body = { reason: dr.reason.trim(), enabled: dr.enabled, severity: dr.severity, threshold: Number(dr.threshold),
      auto_action: dr.auto_action, params: params };
    if (!live()) {
      Object.assign(r, { enabled: dr.enabled, severity: dr.severity, threshold: Number(dr.threshold), auto_action: dr.auto_action,
        params: params, version: r.version + 1 });
      state.rule = { editing: null, draft: null, error: null };
      toast(DEMO_NOTE);
      refresh();
      return;
    }
    state.busy = true;
    api().patch('/governance/rules/' + encodeURIComponent(r.id), body, { idempotencyKey: key() }).then(function (res) {
      state.busy = false;
      state.data.rules = state.data.rules.map(function (x) { return x.id === r.id ? res.data : x; });
      state.rule = { editing: null, draft: null, error: null };
      toast('规则已保存为第 ' + res.data.version + ' 版，已记审计。');
      refresh();
    }).catch(function (err) {
      state.busy = false;
      state.rule.error = (err && err.message) || '没有保存成功';
      refresh();
    });
  }

  function decideAppeal(id, outcome) {
    var reason = (state.appeal.reasons[id] || '').trim();
    if (!reason) return;
    if (!live()) {
      state.data.appeals.forEach(function (a) { if (a.id === id) { a.state = outcome; a.decision_reason = reason; } });
      if (state.data.stats) state.data.stats.appeals_pending = 0;
      toast(DEMO_NOTE);
      refresh();
      return;
    }
    state.busy = true;
    api().post('/governance/appeals/' + encodeURIComponent(id) + '/decide', { outcome: outcome, reason: reason }, { idempotencyKey: key() })
      .then(function () {
        state.busy = false;
        delete state.appeal.reasons[id];
        toast(outcome === 'overturned' ? '申诉成立，原处理已撤销并冲正。' : '已维持原处理。');
        loadAppeals();
      }).catch(function (err) {
        state.busy = false;
        state.appeal.error = (err && err.message) || '没有提交成功';
        refresh();
      });
  }

  /* ---------- 事件 ---------- */

  function onClick(event) {
    var el = event.target.closest('[data-gov-act]');
    if (!el || !el.closest('[data-gov-root]') || el.disabled) return;
    event.preventDefault();
    var act = el.getAttribute('data-gov-act');
    var value = el.getAttribute('data-value');
    var id = el.getAttribute('data-id');
    if (act === 'complaint-submit') sendComplaint();
    else if (act === 'preview-retry') mountHtml();
    else if (act === 'complaints-retry') loadComplaints();
    else if (act === 'complaint-decide') decideComplaint(id, value);
    else if (act === 'viewer') { state.viewer = value; refresh(); }
    else if (act === 'retry') { state.error = null; state.loaded = false; state.data = null; if (live()) loadLive(); else { useSample(); refresh(); } }
    else if (act === 'tab') { state.tab = value; if (value === 'rules') loadRules(); else if (value === 'appeals') loadAppeals(); else if (value === 'complaints') loadComplaints(); else refresh(); }
    else if (act === 'select') selectCase(id);
    else if (act === 'status') { state.status = value; reloadQueue(); }
    else if (act === 'risk') { state.risk = value; reloadQueue(); }
    else if (act === 'more') moreQueue();
    else if (act === 'pick') { state.action = state.action === value ? null : value; state.panelError = null; refresh(); }
    else if (act === 'submit') submit();
    else if (act === 'dismiss') dismiss();
    else if (act === 'confirm') confirmAction(id);
    else if (act === 'cancel') cancelAction(id);
    else if (act === 'premod-open') { state.premod.open = !state.premod.open; refresh(); }
    else if (act === 'premod-cancel') { state.premod = { open: false, reason: '', typed: '' }; refresh(); }
    else if (act === 'premod-confirm') premodConfirm();
    else if (act === 'rule-edit') ruleEdit(id);
    else if (act === 'rule-cancel') { state.rule = { editing: null, draft: null, error: null }; refresh(); }
    else if (act === 'rule-save') ruleSave();
    else if (act === 'appeal') decideAppeal(id, value);
  }

  function onInput(event) {
    var el = event.target;
    var field = el.getAttribute && el.getAttribute('data-gov-input');
    if (!field || !el.closest('[data-gov-root]')) return;
    if (field.indexOf('complaint-') === 0) {
      var name = field.slice(10);
      if (name === 'reason') complaint.reasons[el.getAttribute('data-id')] = el.value;
      else complaint[name] = el.value;
      return;
    }
    if (field === 'reason') { state.reason = el.value; refreshPreview(); return; }
    if (field === 'premod-reason' || field === 'premod-typed') {
      state.premod[field === 'premod-reason' ? 'reason' : 'typed'] = el.value;
      var btn = document.querySelector('[data-gov-act="premod-confirm"]');
      if (btn) btn.disabled = !(state.premod.reason.trim() && state.premod.typed.trim() === '先审后发' && !state.busy);
      return;
    }
    if (field === 'appeal-reason') {
      var id = el.getAttribute('data-id');
      state.appeal.reasons[id] = el.value;
      document.querySelectorAll('[data-gov-act="appeal"]').forEach(function (b) {
        if (b.getAttribute('data-id') === id) b.disabled = !el.value.trim();
      });
      return;
    }
    var dr = state.rule.draft;
    if (!dr) return;
    if (field === 'rule-enabled') dr.enabled = el.value === '1';
    else if (field === 'rule-severity') dr.severity = el.value;
    else if (field === 'rule-threshold') dr.threshold = el.value;
    else if (field === 'rule-auto') dr.auto_action = el.value;
    else if (field === 'rule-params') dr.params = el.value;
    else if (field === 'rule-reason') {
      dr.reason = el.value;
      var save = document.querySelector('[data-gov-act="rule-save"]');
      if (save) save.disabled = !(dr.reason.trim() && !state.busy);
    }
  }

  function onKeydown(event) {
    var current = event.target && event.target.closest && event.target.closest('[data-gov-act="tab"][role="tab"]');
    if (!current || !current.closest('[data-gov-root]')) return;
    var tabs = Array.prototype.slice.call(document.querySelectorAll('[data-gov-root] [role="tablist"] [role="tab"]'));
    var index = tabs.indexOf(current);
    if (index < 0) return;
    var next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else return;
    event.preventDefault();
    tabs[next].focus();
    tabs[next].click();
  }

  function mount() {
    if (!document.querySelector('[data-gov-root]')) return;
    if (!bound) {
      document.addEventListener('click', onClick);
      document.addEventListener('input', onInput);
      document.addEventListener('change', onInput);
      document.addEventListener('keydown', onKeydown);
      bound = true;
    }
    if (live()) {
      // #/govern?tab=complaints：总后台待办直达第三方投诉页签
      var want = new URLSearchParams(location.hash.split('?')[1] || '').get('tab');
      if (want === 'complaints') state.tab = 'complaints';
      loadLive().then(function () { if (want === 'complaints' && state.me && state.me.governor) loadComplaints(); });
    } else mountHtml();
  }

  function destroy() {
    htmlEpoch += 1;
    complaintEpoch += 1;
    complaint = { locator: '', category: 'copyright', statement: '', busy: false, message: '', error: '', rows: null, reasons: {} };
    if (htmlView) { htmlView.destroy(); htmlView = null; }
    if (!bound) return;
    document.removeEventListener('click', onClick);
    document.removeEventListener('input', onInput);
    document.removeEventListener('change', onInput);
    document.removeEventListener('keydown', onKeydown);
    bound = false;
    state.premod.open = false;
  }

  window.CommonsGovern = {
    routes: { govern: page },
    hub: ['govern'],
    nav: [['govern', '治理台', 'govern', 'personal']],
    icons: { govern: ICON },
    mount: mount,
    destroy: destroy
  };
  (window.CommonsPages = window.CommonsPages || []).push(window.CommonsGovern);
})();
