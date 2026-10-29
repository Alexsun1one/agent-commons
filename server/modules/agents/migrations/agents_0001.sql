-- R13 AGENT-1 · 个人 Agent 接入：名片、令牌、调用记录、待确认草稿。
-- Agent 本身是 principal(kind='agent')，没有 credential，不能登录网页；只能用令牌走 /api/agents/v1/ 和 /api/agents/mcp。

CREATE TABLE agent_profile (
  principal_id TEXT PRIMARY KEY REFERENCES principal(id),
  owner_id TEXT NOT NULL REFERENCES principal(id),
  name TEXT NOT NULL,
  intro TEXT NOT NULL DEFAULT '',
  model_family TEXT NOT NULL DEFAULT 'other',
  client TEXT NOT NULL DEFAULT 'generic',
  abilities_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(abilities_json)),
  palette TEXT NOT NULL DEFAULT 'classic'
    CHECK (palette IN ('classic', 'brand-blue', 'graphite', 'mint', 'mist-purple', 'night-sky')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'retired')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  retired_at TEXT,
  CHECK (principal_id != owner_id)
) STRICT;
CREATE INDEX agent_profile_by_owner ON agent_profile(owner_id, status, created_at);

-- 令牌明文只在签发响应里出现一次；这里只存 SHA-256 和末 4 位提示。
CREATE TABLE agent_token (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agent_profile(principal_id),
  token_hash TEXT NOT NULL UNIQUE,
  hint TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  preset TEXT,
  scopes_json TEXT NOT NULL CHECK (json_valid(scopes_json) AND json_array_length(scopes_json) >= 1),
  daily_call_cap INTEGER NOT NULL CHECK (daily_call_cap >= 1),
  daily_item_cap INTEGER NOT NULL CHECK (daily_item_cap >= 1),
  created_by TEXT NOT NULL REFERENCES principal(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  revoked_by TEXT,
  revoke_reason TEXT,
  last_used_at TEXT,
  call_count INTEGER NOT NULL DEFAULT 0,
  whats_new_at TEXT
) STRICT;
CREATE INDEX agent_token_by_agent ON agent_token(agent_id, created_at);

-- 每个令牌每天（UTC）的调用次数和返回条数。
CREATE TABLE agent_usage_day (
  token_id TEXT NOT NULL REFERENCES agent_token(id),
  day TEXT NOT NULL,
  calls INTEGER NOT NULL DEFAULT 0,
  items INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (token_id, day)
) STRICT, WITHOUT ROWID;

-- 只追加：谁（令牌）、调了什么、几条、结果码。不记参数、检索词和返回内容。
CREATE TABLE agent_call_log (
  id TEXT PRIMARY KEY,
  token_id TEXT NOT NULL REFERENCES agent_token(id),
  agent_id TEXT NOT NULL REFERENCES agent_profile(principal_id),
  owner_id TEXT NOT NULL REFERENCES principal(id),
  tool TEXT NOT NULL,
  transport TEXT NOT NULL CHECK (transport IN ('mcp', 'rest', 'module')),
  at TEXT NOT NULL,
  items INTEGER NOT NULL DEFAULT 0 CHECK (items >= 0),
  result TEXT NOT NULL,
  request_id TEXT
) STRICT;
CREATE INDEX agent_call_log_by_agent ON agent_call_log(agent_id, at, id);
CREATE INDEX agent_call_log_by_owner ON agent_call_log(owner_id, at);
CREATE TRIGGER agent_call_log_no_update BEFORE UPDATE ON agent_call_log
BEGIN SELECT RAISE(ABORT, 'agent_call_log is append-only'); END;
CREATE TRIGGER agent_call_log_no_delete BEFORE DELETE ON agent_call_log
BEGIN SELECT RAISE(ABORT, 'agent_call_log is append-only'); END;

-- Agent 起草的帖子和回复。确认前不是对象，不进列表、检索和计数；主人确认后才以主人身份发出并标「Agent 协助」。
CREATE TABLE agent_draft (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agent_profile(principal_id),
  owner_id TEXT NOT NULL REFERENCES principal(id),
  token_id TEXT NOT NULL REFERENCES agent_token(id),
  kind TEXT NOT NULL CHECK (kind IN ('post', 'reply')),
  object_type TEXT NOT NULL,
  root_id TEXT REFERENCES object_head(id),
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  tags_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags_json)),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'discarded')),
  created_at TEXT NOT NULL,
  decided_at TEXT,
  object_id TEXT REFERENCES object_head(id),
  CHECK ((kind = 'reply') = (root_id IS NOT NULL))
) STRICT;
CREATE INDEX agent_draft_by_owner ON agent_draft(owner_id, status, created_at);
CREATE INDEX agent_draft_by_agent ON agent_draft(agent_id, status);
CREATE UNIQUE INDEX agent_draft_by_object ON agent_draft(object_id) WHERE object_id IS NOT NULL;

INSERT OR IGNORE INTO action_rule (action, min_level, roles, owner_only, require_totp, flag, note, updated_at) VALUES
  ('agents.create', 1, '[]', 0, 0, 'agents.enabled', '登记自己的 Agent（L1 起 3 个，L3 起 5 个）', '2026-10-25T00:00:00.000000Z'),
  ('agents.token.issue', 1, '[]', 0, 0, 'agents.enabled', '给自己的 Agent 发令牌', '2026-10-25T00:00:00.000000Z');

INSERT OR IGNORE INTO feature_flag (key, enabled, description, updated_at) VALUES
  ('agents.enabled', 1, '个人 Agent 接入总开关：令牌、MCP 和只读工具', '2026-10-25T00:00:00.000000Z'),
  ('agents.write.enabled', 0, 'Agent 起草帖子和回复（主人在网页上确认后才发出）', '2026-10-25T00:00:00.000000Z'),
  ('agents.read_member_content', 0, '把其他成员的非公开内容给外部 Agent；要开须 Sun 批准（D-R12-03）', '2026-10-25T00:00:00.000000Z');
