CREATE TABLE kb_problem (
  object_id TEXT PRIMARY KEY REFERENCES object_head(id),
  phenomenon TEXT NOT NULL,
  error_raw TEXT NOT NULL DEFAULT '',
  error_normalized TEXT NOT NULL DEFAULT '',
  signature_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'stale')),
  stale_hint INTEGER NOT NULL DEFAULT 0 CHECK (stale_hint IN (0, 1)),
  industry_key TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX kb_problem_signature ON kb_problem(signature_hash, updated_at);
CREATE INDEX kb_problem_filters ON kb_problem(status, industry_key, created_at);

CREATE TABLE kb_env (
  id TEXT PRIMARY KEY,
  problem_id TEXT NOT NULL REFERENCES kb_problem(object_id),
  tool_key TEXT NOT NULL,
  version TEXT NOT NULL DEFAULT '',
  system TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE (problem_id, tool_key, version, system)
) STRICT;
CREATE INDEX kb_env_problem ON kb_env(problem_id, tool_key);
CREATE INDEX kb_env_tool ON kb_env(tool_key, problem_id);

CREATE TABLE kb_solution (
  id TEXT PRIMARY KEY,
  problem_id TEXT NOT NULL REFERENCES kb_problem(object_id),
  root_cause TEXT NOT NULL,
  steps_json TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  author_id TEXT NOT NULL REFERENCES principal(id),
  created_at TEXT NOT NULL,
  UNIQUE (problem_id, version)
) STRICT;
CREATE INDEX kb_solution_problem ON kb_solution(problem_id, version DESC);

CREATE TABLE kb_verification (
  id TEXT PRIMARY KEY,
  problem_id TEXT NOT NULL REFERENCES kb_problem(object_id),
  principal_id TEXT NOT NULL REFERENCES principal(id),
  env_json TEXT NOT NULL,
  env_fingerprint TEXT NOT NULL,
  success INTEGER NOT NULL CHECK (success IN (0, 1)),
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (problem_id, principal_id)
) STRICT;
CREATE INDEX kb_verification_problem ON kb_verification(problem_id, success, env_fingerprint);

CREATE TABLE kb_link (
  id TEXT PRIMARY KEY,
  problem_id TEXT NOT NULL REFERENCES kb_problem(object_id),
  target_problem_id TEXT NOT NULL REFERENCES kb_problem(object_id),
  kind TEXT NOT NULL CHECK (kind IN ('duplicate', 'related', 'replacement')),
  created_by TEXT NOT NULL REFERENCES principal(id),
  created_at TEXT NOT NULL,
  CHECK (problem_id != target_problem_id),
  UNIQUE (problem_id, target_problem_id, kind)
) STRICT;
CREATE UNIQUE INDEX kb_one_duplicate ON kb_link(problem_id) WHERE kind = 'duplicate';
CREATE INDEX kb_link_target ON kb_link(target_problem_id, kind);

CREATE TABLE kb_capture (
  id TEXT PRIMARY KEY,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('discussion', 'bounty')),
  source_id TEXT NOT NULL,
  title TEXT NOT NULL,
  phenomenon TEXT NOT NULL,
  error_raw TEXT NOT NULL DEFAULT '',
  answer_text TEXT NOT NULL DEFAULT '',
  requested_by TEXT REFERENCES principal(id),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed')),
  problem_id TEXT REFERENCES kb_problem(object_id),
  created_at TEXT NOT NULL,
  confirmed_at TEXT,
  UNIQUE (source_kind, source_id, requested_by)
) STRICT;
CREATE INDEX kb_capture_requested ON kb_capture(requested_by, status, created_at);

INSERT OR IGNORE INTO feature_flag (key, enabled, description, updated_at)
VALUES ('kb.enabled', 1, '结构化问题库', '2026-10-25T00:00:00.000000Z');

INSERT OR IGNORE INTO action_rule (action, min_level, roles, owner_only, require_totp, flag, note, updated_at) VALUES
  ('object.create.problem', 1, '[]', 0, 0, 'kb.enabled', '创建问题卡对象', '2026-10-25T00:00:00.000000Z'),
  ('kb.create', 1, '[]', 0, 0, 'kb.enabled', '创建问题卡', '2026-10-25T00:00:00.000000Z'),
  ('kb.edit', 1, '["admin","governor"]', 1, 0, 'kb.enabled', '编辑自己的问题卡', '2026-10-25T00:00:00.000000Z'),
  ('kb.solve', 1, '["admin","governor"]', 0, 0, 'kb.enabled', '补充解决方案', '2026-10-25T00:00:00.000000Z'),
  ('kb.verify', 1, '[]', 0, 0, 'kb.enabled', '提交复现结果', '2026-10-25T00:00:00.000000Z'),
  ('kb.link', 1, '["admin","governor"]', 0, 0, 'kb.enabled', '关联或去重问题卡', '2026-10-25T00:00:00.000000Z'),
  ('kb.capture', 1, '[]', 0, 0, 'kb.enabled', '从讨论或悬赏沉淀草稿', '2026-10-25T00:00:00.000000Z');
