CREATE TABLE tool (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  vendor TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('编程 Agent', '对话模型', '本地模型', '自动化', '知识管理', '设计')),
  official_url TEXT NOT NULL,
  price_tier TEXT NOT NULL CHECK (price_tier IN ('免费', '订阅', '按量')),
  tags_json TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending_review' CHECK (status IN ('pending_review', 'active', 'hidden')),
  submitted_by TEXT NOT NULL REFERENCES principal(id),
  approved_by TEXT REFERENCES principal(id),
  claimed_by TEXT,
  sponsored TEXT,
  created_at TEXT NOT NULL,
  approved_at TEXT,
  updated_at TEXT NOT NULL
) STRICT;

CREATE INDEX tool_browse ON tool(status, category, updated_at DESC);

CREATE TABLE tool_use (
  tool_id TEXT NOT NULL REFERENCES tool(id),
  principal_id TEXT NOT NULL REFERENCES principal(id),
  purpose TEXT NOT NULL DEFAULT '',
  show_on_profile INTEGER NOT NULL DEFAULT 0 CHECK (show_on_profile IN (0, 1)),
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tool_id, principal_id)
) STRICT, WITHOUT ROWID;

CREATE INDEX tool_use_principal ON tool_use(principal_id, started_at DESC);
CREATE INDEX tool_use_started ON tool_use(tool_id, started_at);

CREATE TABLE tool_review (
  id TEXT PRIMARY KEY,
  tool_id TEXT NOT NULL REFERENCES tool(id),
  author_id TEXT REFERENCES principal(id),
  author_name TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body TEXT NOT NULL CHECK (length(body) <= 280),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE UNIQUE INDEX tool_review_one_per_member ON tool_review(tool_id, author_id) WHERE author_id IS NOT NULL;
CREATE INDEX tool_review_rank ON tool_review(tool_id, updated_at DESC);

CREATE TABLE tool_review_history (
  id TEXT PRIMARY KEY,
  review_id TEXT NOT NULL REFERENCES tool_review(id),
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body TEXT NOT NULL,
  replaced_at TEXT NOT NULL
) STRICT;

CREATE INDEX tool_review_history_review ON tool_review_history(review_id, replaced_at);

CREATE TABLE tool_review_helpful (
  review_id TEXT NOT NULL REFERENCES tool_review(id),
  principal_id TEXT NOT NULL REFERENCES principal(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (review_id, principal_id)
) STRICT, WITHOUT ROWID;

INSERT OR IGNORE INTO feature_flag (key, enabled, description, updated_at)
VALUES ('tools.enabled', 1, '成员真实在用、真实打分的 AI 工具榜', '2026-10-25T00:00:00.000000Z');

INSERT OR IGNORE INTO action_rule
  (action, min_level, roles, owner_only, require_totp, flag, note, updated_at) VALUES
  ('tools.use', 1, '[]', 0, 0, 'tools.enabled', '标记自己在用的工具', '2026-10-25T00:00:00.000000Z'),
  ('tools.review', 1, '[]', 0, 0, 'tools.enabled', '为连续使用满三天的工具写短评', '2026-10-25T00:00:00.000000Z'),
  ('tools.helpful', 1, '[]', 0, 0, 'tools.enabled', '标记短评有用', '2026-10-25T00:00:00.000000Z'),
  ('tools.submit', 1, '[]', 0, 0, 'tools.enabled', '提交新工具等待治理审核', '2026-10-25T00:00:00.000000Z'),
  ('tools.moderate', NULL, '["admin", "governor"]', 0, 1, 'tools.enabled', '审核工具目录投稿', '2026-10-25T00:00:00.000000Z');

