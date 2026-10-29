CREATE TABLE principal (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('human', 'agent')),
  status TEXT NOT NULL CHECK (status IN ('active', 'pending_deletion', 'suspended', 'deleted')),
  created_at TEXT NOT NULL,
  delete_requested_at TEXT,
  deleted_at TEXT
) STRICT;

CREATE TABLE credential (
  principal_id TEXT PRIMARY KEY REFERENCES principal(id),
  handle TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_changed_at TEXT NOT NULL
) STRICT;

CREATE TABLE profile (
  principal_id TEXT PRIMARY KEY REFERENCES principal(id),
  display_name TEXT NOT NULL,
  avatar_ref TEXT,
  level INTEGER NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 5),
  level_source TEXT NOT NULL,
  level_updated_at TEXT NOT NULL,
  metering_consent INTEGER NOT NULL DEFAULT 0 CHECK (metering_consent IN (0, 1)),
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE space (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  owner_id TEXT NOT NULL REFERENCES principal(id),
  created_at TEXT NOT NULL,
  archived_at TEXT
) STRICT;

CREATE TABLE membership (
  space_id TEXT NOT NULL REFERENCES space(id),
  principal_id TEXT NOT NULL REFERENCES principal(id),
  role TEXT NOT NULL DEFAULT 'member',
  state TEXT NOT NULL CHECK (state IN ('active', 'left', 'removed')),
  joined_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (space_id, principal_id)
) STRICT, WITHOUT ROWID;
CREATE INDEX membership_by_principal ON membership(principal_id, state);

CREATE TABLE role_assignment (
  id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL REFERENCES principal(id),
  role TEXT NOT NULL,
  space_id TEXT REFERENCES space(id),
  granted_by TEXT REFERENCES principal(id),
  granted_at TEXT NOT NULL,
  revoked_at TEXT,
  revoked_by TEXT REFERENCES principal(id)
) STRICT;
CREATE UNIQUE INDEX role_assignment_active ON role_assignment(principal_id, role, coalesce(space_id, '')) WHERE revoked_at IS NULL;

CREATE TABLE session (
  id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL REFERENCES principal(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  revoked_at TEXT
) STRICT;
CREATE INDEX session_by_principal ON session(principal_id);

CREATE TABLE invite_code (
  id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE,
  inviter_id TEXT REFERENCES principal(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  max_uses INTEGER NOT NULL CHECK (max_uses BETWEEN 1 AND 1000),
  used_count INTEGER NOT NULL DEFAULT 0,
  revoked_at TEXT,
  revoked_by TEXT REFERENCES principal(id),
  note TEXT,
  CHECK (used_count BETWEEN 0 AND max_uses)
) STRICT;
CREATE INDEX invite_code_by_inviter ON invite_code(inviter_id, created_at);

CREATE TABLE invite_edge (
  invitee_id TEXT PRIMARY KEY REFERENCES principal(id),
  inviter_id TEXT REFERENCES principal(id),
  invite_code_id TEXT NOT NULL REFERENCES invite_code(id),
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX invite_edge_by_inviter ON invite_edge(inviter_id);

CREATE TABLE reset_code (
  id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE,
  principal_id TEXT NOT NULL REFERENCES principal(id),
  issued_by TEXT NOT NULL REFERENCES principal(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
) STRICT;

CREATE TABLE totp_secret (
  principal_id TEXT PRIMARY KEY REFERENCES principal(id),
  secret TEXT NOT NULL,
  created_at TEXT NOT NULL,
  enabled_at TEXT,
  last_step INTEGER NOT NULL DEFAULT 0
) STRICT;

CREATE TABLE object_head (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  author_id TEXT NOT NULL REFERENCES principal(id),
  space_id TEXT REFERENCES space(id),
  root_id TEXT REFERENCES object_head(id),
  visibility TEXT NOT NULL CHECK (visibility IN ('public', 'members', 'level', 'space', 'named')),
  min_level INTEGER NOT NULL DEFAULT 1 CHECK (min_level BETWEEN 1 AND 5),
  lifecycle TEXT NOT NULL CHECK (lifecycle IN ('draft', 'active', 'pending_review', 'hidden', 'withdrawn')),
  current_version INTEGER NOT NULL CHECK (current_version >= 1),
  policy_epoch INTEGER NOT NULL DEFAULT 1,
  doc_no INTEGER NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  published_at TEXT,
  withdrawn_at TEXT,
  CHECK (visibility != 'space' OR space_id IS NOT NULL)
) STRICT;
CREATE INDEX object_head_recent ON object_head(created_at, id);
CREATE INDEX object_head_by_type ON object_head(type, created_at, id);
CREATE INDEX object_head_by_space ON object_head(space_id, created_at, id);
CREATE INDEX object_head_by_author ON object_head(author_id, created_at, id);
CREATE INDEX object_head_by_root ON object_head(root_id, created_at, id);
CREATE INDEX object_head_search ON object_head(doc_no, id, author_id, lifecycle, visibility, min_level, space_id, root_id);

CREATE TABLE object_version (
  object_id TEXT NOT NULL REFERENCES object_head(id),
  version INTEGER NOT NULL,
  title TEXT NOT NULL,
  content_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  editor_id TEXT NOT NULL REFERENCES principal(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (object_id, version)
) STRICT;
CREATE TRIGGER object_version_immutable BEFORE UPDATE ON object_version
BEGIN SELECT RAISE(ABORT, 'object_version is immutable'); END;

CREATE TABLE object_acl (
  object_id TEXT NOT NULL REFERENCES object_head(id),
  principal_id TEXT NOT NULL REFERENCES principal(id),
  granted_by TEXT NOT NULL REFERENCES principal(id),
  granted_at TEXT NOT NULL,
  PRIMARY KEY (object_id, principal_id)
) STRICT, WITHOUT ROWID;
CREATE INDEX object_acl_by_principal ON object_acl(principal_id);

CREATE TABLE search_doc (
  object_id TEXT PRIMARY KEY REFERENCES object_head(id),
  object_version INTEGER NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  indexed_at TEXT NOT NULL
) STRICT;

CREATE VIRTUAL TABLE search_fts USING fts5(
  title, body,
  tokenize = 'unicode61 remove_diacritics 2',
  content = '',
  contentless_delete = 1
);

CREATE TABLE action_rule (
  action TEXT PRIMARY KEY,
  min_level INTEGER CHECK (min_level IS NULL OR min_level BETWEEN 1 AND 5),
  roles TEXT NOT NULL DEFAULT '[]',
  owner_only INTEGER NOT NULL DEFAULT 0 CHECK (owner_only IN (0, 1)),
  require_totp INTEGER NOT NULL DEFAULT 0 CHECK (require_totp IN (0, 1)),
  flag TEXT,
  note TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE feature_flag (
  key TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  description TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  updated_by TEXT
) STRICT, WITHOUT ROWID;

CREATE TABLE ledger_entry (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  subject_id TEXT NOT NULL REFERENCES principal(id),
  points INTEGER NOT NULL,
  rule_version TEXT NOT NULL,
  source_ref TEXT,
  actor_id TEXT REFERENCES principal(id),
  confirmed_by TEXT REFERENCES principal(id),
  season TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  reverses_id TEXT UNIQUE REFERENCES ledger_entry(id),
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX ledger_by_subject ON ledger_entry(subject_id, season, created_at);
CREATE TRIGGER ledger_no_update BEFORE UPDATE ON ledger_entry
BEGIN SELECT RAISE(ABORT, 'ledger_entry is append-only'); END;
CREATE TRIGGER ledger_no_delete BEFORE DELETE ON ledger_entry
BEGIN SELECT RAISE(ABORT, 'ledger_entry is append-only'); END;

CREATE TABLE audit_event (
  id TEXT PRIMARY KEY,
  occurred_at TEXT NOT NULL,
  actor_id TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN ('ok', 'denied', 'error')),
  reason_code TEXT,
  request_id TEXT,
  meta_json TEXT NOT NULL DEFAULT '{}'
) STRICT;
CREATE INDEX audit_by_time ON audit_event(occurred_at);
CREATE INDEX audit_by_actor ON audit_event(actor_id, occurred_at);
CREATE INDEX audit_by_target ON audit_event(target_type, target_id);
CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_event
BEGIN SELECT RAISE(ABORT, 'audit_event is append-only'); END;
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_event
BEGIN SELECT RAISE(ABORT, 'audit_event is append-only'); END;

CREATE TABLE outbox_event (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  aggregate_version INTEGER,
  space_id TEXT,
  actor_id TEXT,
  request_id TEXT,
  policy_epoch INTEGER,
  payload_json TEXT NOT NULL DEFAULT '{}',
  occurred_at TEXT NOT NULL,
  available_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'done', 'dead')),
  last_error TEXT
) STRICT;
CREATE INDEX outbox_pending ON outbox_event(state, available_at);

CREATE TABLE outbox_receipt (
  consumer TEXT NOT NULL,
  event_id TEXT NOT NULL REFERENCES outbox_event(id),
  processed_at TEXT NOT NULL,
  PRIMARY KEY (consumer, event_id)
) STRICT, WITHOUT ROWID;

CREATE TABLE idempotency_key (
  principal_id TEXT NOT NULL,
  route TEXT NOT NULL,
  key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (principal_id, route, key)
) STRICT;
CREATE INDEX idempotency_by_time ON idempotency_key(created_at);

CREATE TABLE rate_bucket (
  key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL
) STRICT, WITHOUT ROWID;

INSERT INTO action_rule (action, min_level, roles, owner_only, require_totp, flag, note, updated_at) VALUES
  ('object.create.discussion', 1, '[]', 0, 0, 'core.objects', 'L1 发讨论', '2026-10-25T00:00:00.000000Z'),
  ('object.create.reply', 1, '[]', 0, 0, 'core.objects', 'L1 回复', '2026-10-25T00:00:00.000000Z'),
  ('object.create.knowledge', 2, '[]', 0, 0, 'core.objects', 'L2 建知识条目', '2026-10-25T00:00:00.000000Z'),
  ('object.create.work', 2, '[]', 0, 0, 'core.objects', 'L2 发作品', '2026-10-25T00:00:00.000000Z'),
  ('object.edit', 1, '[]', 1, 0, 'core.objects', '作者本人修改', '2026-10-25T00:00:00.000000Z'),
  ('object.withdraw', 1, '[]', 1, 0, NULL, '作者本人撤回；撤回不受功能开关影响', '2026-10-25T00:00:00.000000Z'),
  ('admin.invite', NULL, '["admin"]', 0, 1, NULL, '管理员签发邀请码', '2026-10-25T00:00:00.000000Z'),
  ('admin.reset_code', NULL, '["admin"]', 0, 1, NULL, '管理员签发重置码', '2026-10-25T00:00:00.000000Z'),
  ('admin.roles', NULL, '["admin"]', 0, 1, NULL, '管理员任免角色', '2026-10-25T00:00:00.000000Z'),
  ('admin.flags', NULL, '["admin"]', 0, 1, NULL, '管理员切换功能开关', '2026-10-25T00:00:00.000000Z');

INSERT INTO feature_flag (key, enabled, description, updated_at) VALUES
  ('core.registration', 1, '邀请码注册', '2026-10-25T00:00:00.000000Z'),
  ('core.objects', 1, '知识、讨论、作品的创建与修改', '2026-10-25T00:00:00.000000Z'),
  ('core.search', 1, '站内检索', '2026-10-25T00:00:00.000000Z');
