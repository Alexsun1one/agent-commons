-- R13 GOV-1 · 治理数据：规则（带版本）、事项、证据、举报、动作、申诉、通知、初筛记录、Agent 任务。
-- 原文片段不入库：证据只存定位（对象版本 + 段落/字符区间、HTML 行号、图片序号）和不含原文的摘要。

CREATE TABLE gov_rule (
  id TEXT PRIMARY KEY,
  version INTEGER NOT NULL CHECK (version >= 1),
  kind TEXT NOT NULL CHECK (kind IN ('detector', 'context', 'agent', 'policy')),
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  threshold REAL NOT NULL CHECK (threshold BETWEEN 0 AND 1),
  auto_action TEXT NOT NULL DEFAULT 'none'
    CHECK (auto_action IN ('none', 'pending_review', 'rate_limit', 'require_source')),
  params_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL,
  updated_by TEXT REFERENCES principal(id),
  CHECK (kind != 'agent' OR auto_action = 'none'),
  CHECK (kind != 'policy' OR auto_action = 'none')
) STRICT;

CREATE TABLE gov_rule_version (
  rule_id TEXT NOT NULL REFERENCES gov_rule(id),
  version INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  reason TEXT NOT NULL,
  changed_by TEXT REFERENCES principal(id),
  changed_at TEXT NOT NULL,
  PRIMARY KEY (rule_id, version)
) STRICT, WITHOUT ROWID;
CREATE TRIGGER gov_rule_version_no_update BEFORE UPDATE ON gov_rule_version
BEGIN SELECT RAISE(ABORT, 'gov_rule_version is append-only'); END;
CREATE TRIGGER gov_rule_version_no_delete BEFORE DELETE ON gov_rule_version
BEGIN SELECT RAISE(ABORT, 'gov_rule_version is append-only'); END;

CREATE TABLE gov_case (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('report', 'rule', 'agent', 'premoderation', 'volunteer', 'manual')),
  target_type TEXT NOT NULL CHECK (target_type IN ('object', 'upload')),
  target_id TEXT NOT NULL,
  target_version INTEGER,
  subject_id TEXT REFERENCES principal(id),
  status TEXT NOT NULL CHECK (status IN ('open', 'triaged', 'actioned', 'dismissed', 'appealed', 'closed')),
  risk TEXT NOT NULL CHECK (risk IN ('low', 'medium', 'high', 'critical')),
  risk_score REAL NOT NULL DEFAULT 0,
  category TEXT NOT NULL,
  assignee_id TEXT REFERENCES principal(id),
  sla_due_at TEXT NOT NULL,
  opened_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  resolved_at TEXT,
  resolution TEXT
) STRICT;
CREATE UNIQUE INDEX gov_case_active_target ON gov_case(target_type, target_id) WHERE status IN ('open', 'triaged');
CREATE INDEX gov_case_queue ON gov_case(status, sla_due_at, id);
CREATE INDEX gov_case_by_target ON gov_case(target_type, target_id, opened_at);
CREATE INDEX gov_case_by_subject ON gov_case(subject_id, opened_at);

CREATE TABLE gov_signal (
  id TEXT PRIMARY KEY,
  case_id TEXT REFERENCES gov_case(id),
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  target_version INTEGER,
  detector_kind TEXT NOT NULL CHECK (detector_kind IN ('rule', 'agent')),
  detector_name TEXT NOT NULL,
  detector_version TEXT NOT NULL,
  rule_id TEXT NOT NULL,
  rule_version INTEGER NOT NULL,
  model_name TEXT,
  model_version TEXT,
  category TEXT NOT NULL,
  score REAL NOT NULL CHECK (score BETWEEN 0 AND 1),
  confidence REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  locator_json TEXT NOT NULL DEFAULT '{}',
  summary TEXT NOT NULL CHECK (length(summary) <= 200),
  suggested_action TEXT,
  input_hash TEXT NOT NULL,
  output_json TEXT NOT NULL DEFAULT '{}',
  latency_ms INTEGER NOT NULL DEFAULT 0,
  over_threshold INTEGER NOT NULL CHECK (over_threshold IN (0, 1)),
  review TEXT NOT NULL DEFAULT 'pending' CHECK (review IN ('pending', 'accepted', 'modified', 'rejected', 'none')),
  reviewed_by TEXT REFERENCES principal(id),
  reviewed_at TEXT,
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX gov_signal_by_case ON gov_signal(case_id, created_at);
CREATE INDEX gov_signal_by_target ON gov_signal(target_type, target_id, target_version);
CREATE INDEX gov_signal_review ON gov_signal(detector_kind, review);

CREATE TABLE gov_report (
  id TEXT PRIMARY KEY,
  reporter_id TEXT NOT NULL REFERENCES principal(id),
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  target_version INTEGER,
  reason_code TEXT NOT NULL
    CHECK (reason_code IN ('spam', 'contact', 'harassment', 'illegal', 'misinformation', 'copyright', 'privacy', 'other')),
  note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 500),
  weight REAL NOT NULL,
  reporter_level INTEGER NOT NULL,
  weight_rule_version INTEGER NOT NULL,
  case_id TEXT NOT NULL REFERENCES gov_case(id),
  outcome TEXT NOT NULL DEFAULT 'pending' CHECK (outcome IN ('pending', 'upheld', 'rejected')),
  reward_entry_id TEXT REFERENCES ledger_entry(id),
  created_at TEXT NOT NULL,
  resolved_at TEXT
) STRICT;
CREATE UNIQUE INDEX gov_report_once ON gov_report(reporter_id, target_type, target_id) WHERE outcome = 'pending';
CREATE INDEX gov_report_by_reporter ON gov_report(reporter_id, outcome);
CREATE INDEX gov_report_by_case ON gov_report(case_id);

CREATE TABLE gov_action (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES gov_case(id),
  action_type TEXT NOT NULL
    CHECK (action_type IN ('hide', 'pending_review', 'rate_limit', 'require_source', 'delete', 'ban', 'deduct', 'demote', 'restore')),
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  subject_id TEXT REFERENCES principal(id),
  reversible INTEGER NOT NULL CHECK (reversible IN (0, 1)),
  automatic INTEGER NOT NULL CHECK (automatic IN (0, 1)),
  state TEXT NOT NULL CHECK (state IN ('awaiting_second', 'executed', 'reverted', 'expired', 'cancelled')),
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('system', 'governor', 'volunteer', 'reviewer')),
  actor_id TEXT REFERENCES principal(id),
  second_actor_id TEXT REFERENCES principal(id),
  rule_id TEXT,
  rule_version INTEGER,
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 1000),
  notice_text TEXT NOT NULL DEFAULT '',
  params_json TEXT NOT NULL DEFAULT '{}',
  prev_state_json TEXT NOT NULL DEFAULT '{}',
  ledger_entry_id TEXT REFERENCES ledger_entry(id),
  reverts_action_id TEXT REFERENCES gov_action(id),
  expires_at TEXT,
  created_at TEXT NOT NULL,
  executed_at TEXT,
  closed_at TEXT,
  closed_by TEXT REFERENCES principal(id),
  close_reason TEXT,
  CHECK (automatic = 0 OR (actor_kind = 'system' AND action_type IN ('pending_review', 'rate_limit', 'require_source'))),
  CHECK (action_type NOT IN ('delete', 'ban') OR state NOT IN ('executed', 'reverted')
         OR (second_actor_id IS NOT NULL AND second_actor_id != actor_id))
) STRICT;
CREATE INDEX gov_action_by_case ON gov_action(case_id, created_at);
CREATE INDEX gov_action_by_subject ON gov_action(subject_id, action_type, state);
CREATE INDEX gov_action_due ON gov_action(state, expires_at);

CREATE TABLE gov_appeal (
  id TEXT PRIMARY KEY,
  action_id TEXT NOT NULL UNIQUE REFERENCES gov_action(id),
  case_id TEXT NOT NULL REFERENCES gov_case(id),
  appellant_id TEXT NOT NULL REFERENCES principal(id),
  statement TEXT NOT NULL CHECK (length(statement) BETWEEN 1 AND 2000),
  state TEXT NOT NULL CHECK (state IN ('submitted', 'upheld', 'overturned')),
  reviewer_id TEXT REFERENCES principal(id),
  decision_reason TEXT,
  created_at TEXT NOT NULL,
  decided_at TEXT
) STRICT;
CREATE INDEX gov_appeal_queue ON gov_appeal(state, created_at);

CREATE TABLE gov_notice (
  id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL REFERENCES principal(id),
  case_id TEXT REFERENCES gov_case(id),
  action_id TEXT REFERENCES gov_action(id),
  appeal_id TEXT REFERENCES gov_appeal(id),
  kind TEXT NOT NULL CHECK (kind IN ('action', 'confirmed', 'reverted', 'expired', 'appeal_received', 'appeal_decided')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  rule_id TEXT,
  rule_version INTEGER,
  rule_title TEXT,
  appealable INTEGER NOT NULL DEFAULT 0 CHECK (appealable IN (0, 1)),
  appeal_deadline TEXT,
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX gov_notice_by_principal ON gov_notice(principal_id, created_at);

CREATE TABLE gov_screening (
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  target_version INTEGER NOT NULL,
  screened_at TEXT NOT NULL,
  signal_count INTEGER NOT NULL,
  case_id TEXT REFERENCES gov_case(id),
  PRIMARY KEY (target_type, target_id, target_version)
) STRICT, WITHOUT ROWID;

CREATE TABLE gov_agent_job (
  id TEXT PRIMARY KEY,
  detector_name TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  target_version INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'done', 'skipped', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  finished_at TEXT,
  error TEXT
) STRICT;
CREATE UNIQUE INDEX gov_agent_job_once ON gov_agent_job(detector_name, target_type, target_id, target_version);
CREATE INDEX gov_agent_job_pending ON gov_agent_job(state, created_at);

-- 规则种子（v1）。描述会原样出现在被处理成员的通知里，写成成员能看懂的话。
INSERT INTO gov_rule (id, version, kind, category, title, description, enabled, severity, threshold, auto_action, params_json, updated_at) VALUES
  ('pii.contact', 1, 'detector', 'contact', '联系方式与个人信息',
   '公开内容里不放手机号、微信号、QQ、邮箱、证件号和私人文档链接。', 1, 'high', 0.5, 'pending_review',
   '{"categories":["phone","wechat","qq","email","idcard","private_link"],"strong":["phone","wechat","qq","email","idcard"],"html_scan_chars":200000}',
   '2026-10-25T00:00:00.000000Z'),
  ('spam.ad', 1, 'detector', 'spam', '广告与引流',
   '不发广告、引流和刷单信息。', 1, 'high', 0.6, 'pending_review',
   '{"keywords":["加微信","加我微信","加v","加vx","招代理","兼职日结","日赚","日入过千","躺赚","刷单","返利","返现","优惠券","免费领取","低价出售","代写","引流","涨粉","互粉","博彩","彩票","贷款","套现","网赚","扫码领取","限时优惠","稳赚","代开发票","内部渠道","包过"],"per_hit":0.35,"max_links":5,"link_bonus":0.3}',
   '2026-10-25T00:00:00.000000Z'),
  ('spam.repeat', 1, 'detector', 'spam', '刷屏',
   '不刷屏：同一个字符或同一行大量重复。', 1, 'medium', 0.6, 'none',
   '{"max_char_run":20,"max_line_repeat":5}', '2026-10-25T00:00:00.000000Z'),
  ('spam.flood', 1, 'context', 'spam', '短时间连续发帖',
   '短时间内连续发很多条内容，会被暂时限速。', 1, 'medium', 0.5, 'rate_limit',
   '{"window_minutes":10,"max_objects":8,"limit_hours":1,"limited_max_per_hour":3}', '2026-10-25T00:00:00.000000Z'),
  ('html.inspect', 1, 'detector', 'html', 'HTML 静态检查',
   'HTML 作品不能收集密码、跳转离开、挖矿、改写地址或嵌套外部页面。', 1, 'high', 0.8, 'pending_review',
   '{"level_score":{"block":0.9,"warn":0.5,"info":0.2},"max_bytes":2097152}', '2026-10-25T00:00:00.000000Z'),
  ('file.type', 1, 'detector', 'file', '文件类型与大小',
   '只接受 JPEG、PNG、WebP、GIF、AVIF 图片和单文件 HTML；不接受 SVG 和其他类型。', 1, 'high', 0.7, 'pending_review',
   '{"allowed_mime":["image/jpeg","image/png","image/webp","image/gif","image/avif","text/html"],"max_bytes":{"image":10485760,"html":2097152}}',
   '2026-10-25T00:00:00.000000Z'),
  ('image.check', 1, 'detector', 'image', '图片检查',
   '图片要去掉拍摄位置等元数据，单边不超过 20000 像素。', 1, 'medium', 0.6, 'none',
   '{"max_px":20000,"require_exif_stripped":true}', '2026-10-25T00:00:00.000000Z'),
  ('dup.content', 1, 'context', 'duplicate', '重复内容',
   '同样的内容不要在多处重复发。', 1, 'low', 0.9, 'none',
   '{"min_length":20,"window_days":30}', '2026-10-25T00:00:00.000000Z'),
  ('quality.no_source', 1, 'detector', 'quality', '知识条目缺来源',
   '知识条目要写明来源。', 0, 'low', 0.5, 'require_source',
   '{"types":["knowledge"]}', '2026-10-25T00:00:00.000000Z'),
  ('agent.default', 1, 'agent', 'agent', '治理 Agent 建议',
   '治理 Agent 给出的建议，只供治理员参考，不会自动执行。', 1, 'medium', 0.8, 'none',
   '{}', '2026-10-25T00:00:00.000000Z'),
  ('policy.report_weight', 1, 'policy', 'report', '举报权重',
   '举报按举报人的信任等级和历史准确率加权；新成员的举报同样进入队列。', 1, 'low', 0, 'none',
   '{"base":1.0,"level_bonus":{"1":-0.5,"2":0.0,"3":0.5,"4":1.0,"5":1.5},"accuracy_axis":0.7,"accuracy_scale":1.0,"min_reviewed":5,"floor":0.1,"cap":6.0}',
   '2026-10-25T00:00:00.000000Z'),
  ('policy.risk', 1, 'policy', 'risk', '风险分级',
   '证据分数乘严重度取最高，加上举报权重之和，按阈值分为低、中、高、紧急。', 1, 'low', 0, 'none',
   '{"severity_weight":{"low":1,"medium":2,"high":3,"critical":4},"report_factor":1.0,"levels":{"medium":1.5,"high":2.5,"critical":3.5}}',
   '2026-10-25T00:00:00.000000Z'),
  ('policy.sla', 1, 'policy', 'sla', '处理时限',
   '紧急 1 小时、高 4 小时、中 24 小时、低 72 小时内处理。', 1, 'low', 0, 'none',
   '{"hours":{"critical":1,"high":4,"medium":24,"low":72}}', '2026-10-25T00:00:00.000000Z'),
  ('policy.auto', 1, 'policy', 'auto', '自动动作范围',
   '自动动作只做可逆的：新成员的高风险内容先进待审核（作者自己仍能看到），刷屏限速，缺来源提醒补充。', 1, 'low', 0, 'none',
   '{"pending_review_levels":[1],"pending_review_min_risk":"high"}', '2026-10-25T00:00:00.000000Z'),
  ('policy.volunteer_hide', 1, 'policy', 'volunteer', '骨干隐藏新成员内容',
   'L3 以上成员可以隐藏 L1 成员的内容；24 小时内没有第二位 L3 以上成员同意，内容自动恢复。', 1, 'low', 0, 'none',
   '{"min_level":3,"target_max_level":1,"restore_after_hours":24}', '2026-10-25T00:00:00.000000Z'),
  ('policy.violation', 1, 'policy', 'violation', '违规扣分',
   '违规成立由治理员确认，扣 50 贡献值，可以申诉；申诉成立会冲正。', 1, 'low', 0, 'none',
   '{"points":-50,"event_type":"violation"}', '2026-10-25T00:00:00.000000Z'),
  ('policy.report_reward', 1, 'policy', 'report', '举报成立奖励',
   '举报成立加 3 贡献值；举报不成立只降低以后的举报权重，不扣分。', 1, 'low', 0, 'none',
   '{"points":3,"event_type":"report"}', '2026-10-25T00:00:00.000000Z'),
  ('policy.appeal', 1, 'policy', 'appeal', '申诉时限',
   '收到处理通知后 30 天内可以申诉，由 L5 成员复核，复核人不能是原处理人。', 1, 'low', 0, 'none',
   '{"window_days":30}', '2026-10-25T00:00:00.000000Z'),
  ('policy.premoderation', 1, 'policy', 'premoderation', '先审后发',
   '先审后发开启期间，所有新内容先进待审核，治理员看过后公开。', 1, 'low', 0, 'none',
   '{}', '2026-10-25T00:00:00.000000Z'),
  ('policy.community', 1, 'policy', 'community', '社区规则',
   '依据社区规则处理成员举报和第三方投诉。', 1, 'low', 0, 'none',
   '{}', '2026-10-25T00:00:00.000000Z');

CREATE TABLE gov_fingerprint (
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  target_version INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (target_type, target_id, target_version)
) STRICT, WITHOUT ROWID;
CREATE INDEX gov_fingerprint_hash ON gov_fingerprint(content_hash, created_at);

INSERT INTO gov_rule_version (rule_id, version, snapshot_json, reason, changed_by, changed_at)
SELECT id, version,
       json_object('enabled', enabled, 'severity', severity, 'threshold', threshold, 'auto_action', auto_action,
                   'params', json(params_json), 'title', title, 'description', description),
       '初始种子', NULL, updated_at
FROM gov_rule;

INSERT OR IGNORE INTO action_rule (action, min_level, roles, owner_only, require_totp, flag, note, updated_at) VALUES
  ('gov.report.create', 1, '[]', 0, 0, 'gov.reports', 'L1 起所有成员可举报（权重按等级与准确率）', '2026-10-25T00:00:00.000000Z'),
  ('gov.queue.read', NULL, '["governor"]', 0, 1, NULL, '治理员查看队列、事项、规则、统计', '2026-10-25T00:00:00.000000Z'),
  ('gov.case.act', NULL, '["governor"]', 0, 1, NULL, '治理员处置事项', '2026-10-25T00:00:00.000000Z'),
  ('gov.rule.edit', NULL, '["governor"]', 0, 1, NULL, '治理员修改规则（进审计）', '2026-10-25T00:00:00.000000Z'),
  ('gov.premoderation.set', NULL, '["governor"]', 0, 1, NULL, '治理员切换先审后发总开关', '2026-10-25T00:00:00.000000Z'),
  ('gov.appeal.review', 5, '[]', 0, 1, NULL, 'L5 复核申诉', '2026-10-25T00:00:00.000000Z'),
  ('gov.volunteer.hide', 3, '[]', 0, 0, 'gov.volunteer_hide', 'L3 以上隐藏 L1 内容，需第二位 L3 以上同意', '2026-10-25T00:00:00.000000Z');

INSERT OR IGNORE INTO feature_flag (key, enabled, description, updated_at) VALUES
  ('gov.reports', 1, '成员举报入口', '2026-10-25T00:00:00.000000Z'),
  ('gov.screening', 1, '规则层初筛（本机，不外发）', '2026-10-25T00:00:00.000000Z'),
  ('gov.premoderation', 0, '先审后发：新内容一律先进待审核', '2026-10-25T00:00:00.000000Z'),
  ('gov.model_egress', 0, '治理 Agent 模型层外发（需 Sun 批准；打开要管理员加 TOTP，并写审计）', '2026-10-25T00:00:00.000000Z'),
  ('gov.volunteer_hide', 1, 'L3 志愿隐藏 L1 内容', '2026-10-25T00:00:00.000000Z');
