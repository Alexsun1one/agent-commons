-- R13 AI-1 模型网关（D-R13-01 / FZ-08）。所有外部模型调用只经过 modules/ai/gateway.py。
-- 审计表 ai_call 只记功能、服务商、模型、大小、费用、耗时、结果码，不记输入输出内容。

CREATE TABLE ai_budget (
  feature TEXT PRIMARY KEY,
  daily_calls INTEGER NOT NULL CHECK (daily_calls >= 0),
  daily_cost_micros INTEGER NOT NULL CHECK (daily_cost_micros >= 0),
  cache_ttl_s INTEGER NOT NULL CHECK (cache_ttl_s >= 0),
  updated_at TEXT NOT NULL,
  updated_by TEXT
) STRICT, WITHOUT ROWID;

CREATE TABLE ai_usage_daily (
  feature TEXT NOT NULL,
  day TEXT NOT NULL,
  calls INTEGER NOT NULL DEFAULT 0,
  failures INTEGER NOT NULL DEFAULT 0,
  fallbacks INTEGER NOT NULL DEFAULT 0,
  cache_hits INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_micros INTEGER NOT NULL DEFAULT 0,
  reserved_micros INTEGER NOT NULL DEFAULT 0,
  notified_at TEXT,
  PRIMARY KEY (feature, day)
) STRICT, WITHOUT ROWID;

CREATE TABLE ai_call (
  id TEXT PRIMARY KEY,
  occurred_at TEXT NOT NULL,
  feature TEXT NOT NULL,
  task TEXT NOT NULL,
  provider TEXT,
  model TEXT,
  template_version TEXT,
  actor_id TEXT,
  object_id TEXT,
  result TEXT NOT NULL CHECK (result IN ('ok', 'cache_hit', 'fallback')),
  reason_code TEXT,
  input_chars INTEGER NOT NULL DEFAULT 0,
  output_chars INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_micros INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  redactions_json TEXT NOT NULL DEFAULT '{}',
  provider_request_id TEXT
) STRICT;
CREATE INDEX ai_call_by_time ON ai_call(occurred_at);
CREATE INDEX ai_call_by_feature ON ai_call(feature, occurred_at);
CREATE INDEX ai_call_by_result ON ai_call(result, occurred_at);
CREATE INDEX ai_call_by_actor ON ai_call(actor_id, occurred_at) WHERE actor_id IS NOT NULL;

CREATE TABLE ai_cache (
  key TEXT PRIMARY KEY,
  feature TEXT NOT NULL,
  task TEXT NOT NULL,
  object_id TEXT,
  output_json TEXT NOT NULL,
  model TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  hits INTEGER NOT NULL DEFAULT 0
) STRICT, WITHOUT ROWID;
CREATE INDEX ai_cache_by_object ON ai_cache(object_id) WHERE object_id IS NOT NULL;
CREATE INDEX ai_cache_by_expiry ON ai_cache(expires_at);

-- 成员自己关掉的模型功能（只有 catalog 里 opt_out=True 的功能可以关：个人简报、搜索辅助）。
CREATE TABLE ai_member_pref (
  principal_id TEXT NOT NULL REFERENCES principal(id),
  feature TEXT NOT NULL,
  opted_out INTEGER NOT NULL CHECK (opted_out IN (0, 1)),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (principal_id, feature)
) STRICT, WITHOUT ROWID;

-- 开关默认全关：总开关 + 每功能一个；打开走 POST /api/admin/flags（管理员 + TOTP，记审计）。
INSERT OR IGNORE INTO feature_flag (key, enabled, description, updated_at) VALUES
  ('ai.enabled', 0, '模型外发总开关（D-R13-01）：关掉后所有模型功能改用本机规则', '2026-10-25T00:00:00.000000Z'),
  ('ai.governance.screen_text.enabled', 0, '治理初筛（文字）用外部模型；只出建议，进复核队列', '2026-10-25T00:00:00.000000Z'),
  ('ai.governance.screen_image.enabled', 0, '治理初筛（图片）用外部模型；只出建议，进复核队列', '2026-10-25T00:00:00.000000Z'),
  ('ai.talks.transcribe.enabled', 0, '讲堂与会议录音转写（需全体发言人同意；服务商待定）', '2026-10-25T00:00:00.000000Z'),
  ('ai.talks.translate.enabled', 0, '讲堂与会议逐字稿翻译', '2026-10-25T00:00:00.000000Z'),
  ('ai.talks.minutes.enabled', 0, '讲堂与会议的会后纪要', '2026-10-25T00:00:00.000000Z'),
  ('ai.feed.summarize.enabled', 0, '热点事件摘要', '2026-10-25T00:00:00.000000Z'),
  ('ai.kb.draft_problem.enabled', 0, '问题卡起草（成员确认后才发布）', '2026-10-25T00:00:00.000000Z'),
  ('ai.digest.summarize.enabled', 0, '个人简报文字（成员可关）', '2026-10-25T00:00:00.000000Z'),
  ('ai.search.assist.enabled', 0, '搜索辅助：改写检索词、基于可见片段回答（成员可关）', '2026-10-25T00:00:00.000000Z');

-- 预算初值（与 catalog.py 一致，测试校验）。费用单位：百万分之一美元。
INSERT OR IGNORE INTO ai_budget (feature, daily_calls, daily_cost_micros, cache_ttl_s, updated_at) VALUES
  ('governance.screen_text', 5000, 5000000, 604800, '2026-10-25T00:00:00.000000Z'),
  ('governance.screen_image', 1000, 10000000, 604800, '2026-10-25T00:00:00.000000Z'),
  ('talks.transcribe', 50, 10000000, 2592000, '2026-10-25T00:00:00.000000Z'),
  ('talks.translate', 300, 10000000, 2592000, '2026-10-25T00:00:00.000000Z'),
  ('talks.minutes', 50, 10000000, 2592000, '2026-10-25T00:00:00.000000Z'),
  ('feed.summarize', 300, 5000000, 86400, '2026-10-25T00:00:00.000000Z'),
  ('kb.draft_problem', 200, 5000000, 86400, '2026-10-25T00:00:00.000000Z'),
  ('digest.summarize', 500, 5000000, 43200, '2026-10-25T00:00:00.000000Z'),
  ('search.assist', 1000, 5000000, 3600, '2026-10-25T00:00:00.000000Z');

INSERT OR IGNORE INTO action_rule (action, min_level, roles, owner_only, require_totp, flag, note, updated_at) VALUES
  ('ai.admin.read', NULL, '["admin"]', 0, 1, NULL, '查看模型网关的开关、今日用量与费用、最近失败', '2026-10-25T00:00:00.000000Z'),
  ('ai.admin.budget', NULL, '["admin"]', 0, 1, NULL, '修改模型网关每功能每日预算和缓存有效期', '2026-10-25T00:00:00.000000Z'),
  ('ai.member.prefs', 1, '[]', 0, 0, NULL, '成员关闭可关的模型功能（个人简报、搜索辅助）', '2026-10-25T00:00:00.000000Z');
