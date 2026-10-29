CREATE TABLE account_export (
  id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL REFERENCES principal(id),
  state TEXT NOT NULL CHECK (state IN ('queued', 'ready', 'downloaded', 'expired', 'failed')),
  token_hash TEXT NOT NULL,
  file_key TEXT,
  bytes INTEGER,
  day TEXT NOT NULL,
  created_at TEXT NOT NULL,
  ready_at TEXT,
  expires_at TEXT,
  downloaded_at TEXT
) STRICT;
CREATE INDEX account_export_by_principal ON account_export(principal_id, day);

INSERT OR IGNORE INTO action_rule (action, min_level, roles, owner_only, require_totp, flag, note, updated_at) VALUES
  ('account.avatar.set', 1, '[]', 0, 0, NULL, '设置或清除自己的头像', '2026-10-25T00:00:00.000000Z');

INSERT OR IGNORE INTO feature_flag (key, enabled, description, updated_at) VALUES
  ('account.purge_private_content', 1, '注销到期后物理删除本人草稿和指定人可见内容的正文版本（GOV-1 可登记保全）', '2026-10-25T00:00:00.000000Z');
