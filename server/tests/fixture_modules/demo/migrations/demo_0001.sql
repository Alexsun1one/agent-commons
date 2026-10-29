CREATE TABLE demo_note (
  id TEXT PRIMARY KEY,
  body TEXT NOT NULL
) STRICT;

INSERT OR IGNORE INTO action_rule (action, min_level, roles, owner_only, require_totp, flag, note, updated_at)
VALUES ('demo.ping', 2, '[]', 0, 0, 'demo.enabled', '示例模块', '2026-10-25T00:00:00.000000Z');

INSERT OR IGNORE INTO feature_flag (key, enabled, description, updated_at)
VALUES ('demo.enabled', 1, '示例模块开关', '2026-10-25T00:00:00.000000Z');
