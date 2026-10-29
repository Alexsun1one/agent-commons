-- R17-R3：登录设备标注、名片可见范围。不改核心 session 表；会话编号仍是令牌哈希，不是登录密钥。
CREATE TABLE account_session_label (
  session_id TEXT PRIMARY KEY REFERENCES session(id),
  user_agent TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE account_card_visibility (
  principal_id TEXT PRIMARY KEY REFERENCES principal(id),
  scope TEXT NOT NULL CHECK (scope IN ('self', 'invited', 'members')),
  updated_at TEXT NOT NULL
) STRICT;

INSERT OR IGNORE INTO feature_flag (key, enabled, description, updated_at) VALUES
  ('account.sessions.enabled', 1, '查看并退出自己的登录设备', '2026-10-28T00:00:00.000000Z'),
  ('account.card_visibility.enabled', 1, '设置名片对谁可见', '2026-10-28T00:00:00.000000Z');

INSERT OR IGNORE INTO action_rule (action, min_level, roles, owner_only, require_totp, flag, note, updated_at) VALUES
  ('account.session.revoke', 1, '[]', 0, 0, 'account.sessions.enabled', '退出自己的一台或其余登录设备；已开动态验证码时要提供验证码，否则要当前密码', '2026-10-28T00:00:00.000000Z'),
  ('account.token.revoke', 1, '[]', 0, 0, 'account.sessions.enabled', '吊销自己 Agent 的令牌；验证方式与退出设备相同。列表仍走 /api/agents/mine，只含尾号', '2026-10-28T00:00:00.000000Z'),
  ('account.visibility.set', 1, '[]', 0, 0, 'account.card_visibility.enabled', '设置自己的名片可见范围', '2026-10-28T00:00:00.000000Z');
