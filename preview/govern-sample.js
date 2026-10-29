/* R13 GOV-1 · 治理台合成数据（全部是示例，字段与 /api/governance/* 的返回一致）。 */
(function () {
  'use strict';

  var NOW = Date.now();
  var MIN = 60000;
  var HOUR = 60 * MIN;

  function at(offset) { return new Date(NOW + offset).toISOString(); }

  function span(text, needle, category) {
    var start = text.indexOf(needle);
    return { start: start, end: start + needle.length, category: category, paragraph: 0 };
  }

  var phoneText = '示例：周末线下分享会还有名额，想来的直接打[手机号]＊＊＊＊＊＊或者加[微信号]＊＊＊＊＊，我拉你进群。';
  var adText = '示例：内部渠道低价出售大模型会员，稳赚不赔，加vx详聊，刷单返利另有优惠券。';
  var harassText = '示例：你上次那篇复现根本是抄的，别再在这里丢人了，大家都看不起你。';

  var formHtml = '<!doctype html><html><body style="font-family:sans-serif;padding:24px">' +
    '<h2>示例：登录领取周边</h2><form><label>账号 <input name="username"></label><br><br>' +
    '<label>密码 <input type="password" name="pw"></label><br><br><button type="button">领取</button></form>' +
    '<p>示例页面，按钮不会提交任何内容。</p></body></html>';

  var templates = {
    hide: { title: '你的一条内容已被隐藏', body: '原因：{reason}\n依据：社区规则（第 1 版）——依据社区规则处理成员举报和第三方投诉。\n结果：这条内容已对其他成员隐藏，你自己仍能看到。\n如有异议，30 天内可以在「我的治理通知」里申诉，由 L5 成员复核。' },
    pending_review: { title: '你的一条内容正在等待审核', body: '原因：{reason}\n依据：联系方式与个人信息（第 1 版）——公开内容里不放手机号、微信号、QQ、邮箱、证件号和私人文档链接。\n结果：这条内容暂时只有你自己能看到，治理员看过后会公开或说明原因。\n如有异议，30 天内可以在「我的治理通知」里申诉，由 L5 成员复核。' },
    rate_limit: { title: '你的发布暂时被限速', body: '原因：{reason}\n依据：短时间连续发帖（第 1 版）——短时间内连续发很多条内容，会被暂时限速。\n结果：接下来 1 小时内，你每小时发布超过 3 条时，多出的内容会先进入待审核。\n如有异议，30 天内可以在「我的治理通知」里申诉，由 L5 成员复核。' },
    require_source: { title: '请为你的内容补充来源', body: '原因：{reason}\n依据：知识条目缺来源（第 1 版）——知识条目要写明来源。\n结果：请编辑这条内容，写明来源。\n如有异议，30 天内可以在「我的治理通知」里申诉，由 L5 成员复核。' },
    delete: { title: '你的一条内容已被删除', body: '原因：{reason}\n依据：社区规则（第 1 版）——依据社区规则处理成员举报和第三方投诉。\n结果：这条内容已删除，无法恢复。\n如有异议，30 天内可以在「我的治理通知」里申诉，由 L5 成员复核。' },
    ban: { title: '你的账号已暂停使用', body: '原因：{reason}\n依据：社区规则（第 1 版）——依据社区规则处理成员举报和第三方投诉。\n结果：你的账号已暂停使用，期间不能登录。\n如有异议，30 天内可以在「我的治理通知」里申诉，由 L5 成员复核。' },
    deduct: { title: '你被扣除了贡献值', body: '原因：{reason}\n依据：社区规则（第 1 版）——依据社区规则处理成员举报和第三方投诉。\n结果：你的贡献值被扣除 50 分。\n如有异议，30 天内可以在「我的治理通知」里申诉，由 L5 成员复核。' },
    demote: { title: '你的信任等级被下调', body: '原因：{reason}\n依据：社区规则（第 1 版）——依据社区规则处理成员举报和第三方投诉。\n结果：你的信任等级下调一级。\n如有异议，30 天内可以在「我的治理通知」里申诉，由 L5 成员复核。' }
  };

  function person(id, handle, name, level) { return { id: id, handle: handle, display_name: name, level: level }; }

  var me = person('demo-gov-1', 'chen-mo', '陈墨', 3);
  var other = person('demo-gov-2', 'song-yuan', '松原', 5);

  function summary(id, extra) {
    return Object.assign({
      id: id, source: 'rule', status: 'open', risk: 'medium', risk_score: 1.2, category: 'spam',
      sla_due_at: at(20 * HOUR), overdue: false, opened_at: at(-2 * HOUR), updated_at: at(-90 * MIN),
      assignee: null, signal_count: 1, report_count: 0, awaiting_second: 0
    }, extra);
  }

  var cases = [
    summary('demo-case-contact', {
      source: 'rule', risk: 'high', risk_score: 2.7, category: 'contact', sla_due_at: at(70 * MIN),
      opened_at: at(-170 * MIN), assignee: me, signal_count: 1,
      target: { type: 'object', id: 'demo-obj-1', version: 1, object_type: 'discussion', title: '示例：周末线下分享会' }
    }),
    summary('demo-case-html', {
      source: 'rule', risk: 'critical', risk_score: 3.6, category: 'html', sla_due_at: at(-25 * MIN), overdue: true,
      opened_at: at(-85 * MIN), signal_count: 2,
      target: { type: 'object', id: 'demo-obj-2', version: 2, object_type: 'work', title: '示例：领取周边小页面' }
    }),
    summary('demo-case-harass', {
      source: 'report', risk: 'high', risk_score: 2.9, category: 'harassment', sla_due_at: at(3 * HOUR),
      opened_at: at(-HOUR), signal_count: 1, report_count: 2, awaiting_second: 1,
      target: { type: 'object', id: 'demo-obj-3', version: 1, object_type: 'reply', title: '示例：回复「复现记录」' }
    }),
    summary('demo-case-ad', {
      source: 'rule', risk: 'medium', risk_score: 2.0, category: 'spam', sla_due_at: at(22 * HOUR),
      opened_at: at(-2 * HOUR), signal_count: 1,
      target: { type: 'object', id: 'demo-obj-4', version: 1, object_type: 'discussion', title: '示例：会员低价' }
    }),
    summary('demo-case-upload', {
      source: 'rule', risk: 'high', risk_score: 3.0, category: 'file', sla_due_at: at(2 * HOUR),
      opened_at: at(-2 * HOUR), signal_count: 1,
      target: { type: 'upload', id: 'demo-upload-1', version: 1, object_type: 'image', title: '上传文件' }
    }),
    summary('demo-case-withdrawn', {
      source: 'report', risk: 'low', risk_score: 0.5, category: 'misinformation', sla_due_at: at(60 * HOUR),
      opened_at: at(-12 * HOUR), signal_count: 0, report_count: 1,
      target: { type: 'object', id: 'demo-obj-5', version: 1, object_type: 'knowledge', title: '（已撤回）' }
    })
  ];

  function signal(id, extra) {
    return Object.assign({
      id: id, detector: { kind: 'rule', name: 'rule.pii', version: '1', model: null, model_version: null },
      rule: { id: 'pii.contact', version: 1, title: '联系方式与个人信息', severity: 'high' },
      category: 'contact', score: 0.9, confidence: 0.95, locator: { field: 'text', spans: [] }, summary: '',
      suggested_action: 'pending_review', review: 'pending', latency_ms: 2, input_hash: 'demo', output: {},
      created_at: at(-2 * HOUR)
    }, extra);
  }

  function detail(base, extra) {
    return Object.assign({}, base, {
      subject: person('demo-member', 'lin-qi', '林栖', 1),
      signals: [], reports: [], actions: [], appeals: [], suggestion: null,
      notice_templates: templates, viewer: { conflicts: [] }
    }, extra);
  }

  var details = {
    'demo-case-contact': detail(cases[0], {
      preview: { state: 'pending_review', object_type: 'discussion', version: 1, visibility: 'members', min_level: 1,
        title: '示例：周末线下分享会', text: phoneText, truncated: false, html: null, media: [] },
      signals: [signal('demo-sig-1', {
        summary: '含手机号 1 处、微信号 1 处',
        locator: { field: 'text', spans: [span(phoneText, '[手机号]＊＊＊＊＊＊', 'phone'), span(phoneText, '[微信号]＊＊＊＊＊', 'wechat')] }
      })],
      actions: [{ id: 'demo-act-1', type: 'pending_review', state: 'executed', automatic: true, reversible: true,
        actor_kind: 'system', actor: null, second_actor: null, rule_id: 'pii.contact', rule_version: 1,
        reason: '公开内容里不放手机号、微信号、QQ、邮箱、证件号和私人文档链接。', notice_text: '', params: {},
        expires_at: null, created_at: at(-170 * MIN), executed_at: at(-170 * MIN), closed_at: null,
        close_reason: null, reverts_action_id: null }],
      suggestion: { action: 'pending_review', confidence: 0.95, detector_kind: 'rule', basis: ['联系方式与个人信息'],
        label: 'Agent 建议，需人确认' }
    }),
    'demo-case-html': detail(cases[1], {
      subject: person('demo-member-2', 'yu-lan', '余岚', 4),
      preview: { state: 'active', object_type: 'work', version: 2, visibility: 'members', min_level: 1,
        title: '示例：领取周边小页面', text: '示例：一个领取周边的小页面。', truncated: false, html: formHtml, media: [] },
      signals: [
        signal('demo-sig-2', { detector: { kind: 'rule', name: 'rule.html', version: '1' },
          rule: { id: 'html.inspect', version: 1, title: 'HTML 静态检查', severity: 'high' }, category: 'html',
          score: 0.9, confidence: 0.9, summary: 'password-field（block）：有密码输入框：作品页不能收集密码。',
          locator: { field: 'html', code: 'password-field', level: 'block', lines: [1], start: 160 } }),
        signal('demo-sig-3', { detector: { kind: 'rule', name: 'rule.html', version: '1' },
          rule: { id: 'html.inspect', version: 1, title: 'HTML 静态检查', severity: 'high' }, category: 'html',
          score: 0.5, confidence: 0.9, suggested_action: null, summary: 'account-form（warn）：表单在收集账号。',
          locator: { field: 'html', code: 'account-form', level: 'warn', lines: [1], start: 120 } })
      ],
      suggestion: { action: 'pending_review', confidence: 0.9, detector_kind: 'rule', basis: ['HTML 静态检查'],
        label: 'Agent 建议，需人确认' }
    }),
    'demo-case-harass': detail(cases[2], {
      subject: person('demo-member-3', 'chen-mo', '陈墨', 3),
      preview: { state: 'active', object_type: 'reply', version: 1, visibility: 'members', min_level: 1,
        title: '示例：回复「复现记录」', text: harassText, truncated: false, html: null, media: [] },
      signals: [signal('demo-sig-4', {
        detector: { kind: 'agent', name: 'agent.gateway.text', version: '1', model: '示例模型', model_version: 'demo' },
        rule: { id: 'agent.default', version: 1, title: '治理 Agent 建议', severity: 'medium' }, category: 'harassment',
        score: 0.86, confidence: 0.78, summary: '疑似针对个人的贬低，建议隐藏并提醒。', suggested_action: 'hide',
        locator: { field: 'text', start: harassText.indexOf('别再'), end: harassText.indexOf('别再') + 9 }
      })],
      reports: [
        { id: 'demo-rep-1', reason_code: 'harassment', note: '示例：持续针对同一个人', weight: 2.0,
          reporter: person('demo-r1', 'yu-lan', '余岚', 4), outcome: 'pending', created_at: at(-HOUR) },
        { id: 'demo-rep-2', reason_code: 'harassment', note: '', weight: 0.5,
          reporter: person('demo-r2', 'lin-qi', '林栖', 1), outcome: 'pending', created_at: at(-40 * MIN) }
      ],
      actions: [{ id: 'demo-act-ban', type: 'ban', state: 'awaiting_second', automatic: false, reversible: true,
        actor_kind: 'governor', actor: other, second_actor: null, rule_id: 'policy.community', rule_version: 1,
        reason: '示例：一周内第三次人身攻击', notice_text: '', params: {}, expires_at: null, created_at: at(-20 * MIN),
        executed_at: null, closed_at: null, close_reason: null, reverts_action_id: null }],
      suggestion: { action: 'hide', confidence: 0.78, detector_kind: 'agent', basis: ['治理 Agent 建议'],
        label: 'Agent 建议，需人确认' }
    }),
    'demo-case-ad': detail(cases[3], {
      subject: person('demo-member-4', 'lin-qi', '林栖', 1),
      preview: { state: 'active', object_type: 'discussion', version: 1, visibility: 'members', min_level: 1,
        title: '示例：会员低价', text: adText, truncated: false, html: null, media: [] },
      signals: [signal('demo-sig-5', {
        detector: { kind: 'rule', name: 'rule.spam', version: '1' },
        rule: { id: 'spam.ad', version: 1, title: '广告与引流', severity: 'high' }, category: 'spam', score: 1,
        confidence: 0.8, summary: '广告用语 5 处，链接 0 个',
        locator: { field: 'text', spans: ['内部渠道', '低价出售', '稳赚', '刷单', '返利'].map(function (w) { return span(adText, w, 'spam'); }) }
      })],
      suggestion: { action: 'pending_review', confidence: 0.8, detector_kind: 'rule', basis: ['广告与引流'],
        label: 'Agent 建议，需人确认' }
    }),
    'demo-case-upload': detail(cases[4], {
      subject: person('demo-member-5', 'yu-lan', '余岚', 4),
      preview: { state: 'upload', message: '上传文件只显示检测结果，不在治理台打开原文件。',
        locator: { field: 'media', index: 0, kind: 'image' } },
      signals: [signal('demo-sig-6', {
        detector: { kind: 'rule', name: 'rule.media', version: '1' },
        rule: { id: 'file.type', version: 1, title: '文件类型与大小', severity: 'high' }, category: 'file', score: 1,
        confidence: 1, summary: 'SVG 图片不接受（可能带脚本）', locator: { field: 'media', index: 0, kind: 'image' }
      })],
      suggestion: { action: 'pending_review', confidence: 1, detector_kind: 'rule', basis: ['文件类型与大小'],
        label: 'Agent 建议，需人确认' }
    }),
    'demo-case-withdrawn': detail(cases[5], {
      subject: person('demo-member-6', 'song-yuan', '松原', 5),
      preview: { state: 'withdrawn', message: '已撤回', withdrawn_at: at(-3 * HOUR) },
      reports: [{ id: 'demo-rep-3', reason_code: 'misinformation', note: '示例：数据来源不明', weight: 1.0,
        reporter: person('demo-r3', 'chen-mo', '陈墨', 3), outcome: 'pending', created_at: at(-12 * HOUR) }]
    })
  };

  function rule(id, kind, title, severity, threshold, auto, enabled, params, description) {
    return { id: id, version: 1, kind: kind, category: id.split('.')[0], title: title, description: description,
      severity: severity, threshold: threshold, auto_action: auto, enabled: enabled, params: params,
      updated_at: at(-5 * 24 * HOUR), updated_by: null };
  }

  window.COMMONS_GOVERN_SAMPLE = {
    label: '示例',
    me: { governor: true, totp_required: false, reviewer: true, volunteer: true, can_report: true, id: me.id },
    stats: {
      pending: 5, opened_today: 4, overdue: 1, appeals_pending: 1, awaiting_second: 1,
      by_category: { contact: 1, html: 1, harassment: 1, spam: 1, file: 1 },
      avg_handle_minutes: 46.5,
      reviews: {
        rule: { reviewed: 48, accepted: 39, modified: 5, rejected: 4, adoption_rate: 0.813, false_positive_rate: 0.083 },
        agent: { reviewed: 12, accepted: 7, modified: 3, rejected: 2, adoption_rate: 0.583, false_positive_rate: 0.167 }
      },
      flags: { 'gov.reports': true, 'gov.screening': true, 'gov.premoderation': false, 'gov.model_egress': false,
        'gov.volunteer_hide': true },
      agent_jobs_pending: 0
    },
    queue: cases,
    cases: details,
    rules: [
      rule('pii.contact', 'detector', '联系方式与个人信息', 'high', 0.5, 'pending_review', true,
        { categories: ['phone', 'wechat', 'qq', 'email', 'idcard', 'private_link'], html_scan_chars: 200000 },
        '公开内容里不放手机号、微信号、QQ、邮箱、证件号和私人文档链接。'),
      rule('spam.ad', 'detector', '广告与引流', 'high', 0.6, 'pending_review', true,
        { keywords: ['加微信', '招代理', '刷单', '返利'], per_hit: 0.35, max_links: 5, link_bonus: 0.3 },
        '不发广告、引流和刷单信息。'),
      rule('spam.flood', 'context', '短时间连续发帖', 'medium', 0.5, 'rate_limit', true,
        { window_minutes: 10, max_objects: 8, limit_hours: 1, limited_max_per_hour: 3 },
        '短时间内连续发很多条内容，会被暂时限速。'),
      rule('html.inspect', 'detector', 'HTML 静态检查', 'high', 0.8, 'pending_review', true,
        { level_score: { block: 0.9, warn: 0.5, info: 0.2 }, max_bytes: 2097152 },
        'HTML 作品不能收集密码、跳转离开、挖矿、改写地址或嵌套外部页面。'),
      rule('quality.no_source', 'detector', '知识条目缺来源', 'low', 0.5, 'require_source', false, { types: ['knowledge'] },
        '知识条目要写明来源。'),
      rule('agent.default', 'agent', '治理 Agent 建议', 'medium', 0.8, 'none', true, {},
        '治理 Agent 给出的建议，只供治理员参考，不会自动执行。'),
      rule('policy.violation', 'policy', '违规扣分', 'low', 0, 'none', true, { points: -50, event_type: 'violation' },
        '违规成立由治理员确认，扣 50 贡献值，可以申诉；申诉成立会冲正。')
    ],
    appeals: [{
      id: 'demo-appeal-1', action_id: 'demo-act-old', case_id: 'demo-case-old', state: 'submitted',
      statement: '示例：那条是活动报名链接，不是广告，群里提前说过。', created_at: at(-5 * HOUR), decided_at: null,
      decision_reason: null, appellant: { id: 'demo-member-7', display_name: '示例成员 晴天' },
      action: { type: 'deduct', reason: '示例：在讨论区发引流链接', rule_id: 'spam.ad', rule_version: 1,
        actor_id: other.id, second_actor_id: null },
      viewer_involved: false
    }]
  };
})();
