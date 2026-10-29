-- R17-D · 广场消息举报。gov_report 只认 object_head 对象，chat_message 不是对象，所以另建一张小表（同私信 dm_report）。
-- 撤回/编辑复用 chat_message.status / edited_at，不新增列。

CREATE TABLE chat_report (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES chat_message(id),
  reporter_id TEXT NOT NULL REFERENCES principal(id),
  reason TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (message_id, reporter_id)
) STRICT;
CREATE INDEX chat_report_reporter ON chat_report(reporter_id, created_at);

INSERT OR IGNORE INTO action_rule (action, min_level, roles, owner_only, require_totp, flag, note, updated_at) VALUES
  ('agentchat.report', 1, '[]', 0, 0, 'agentchat.enabled', '举报广场里的一条消息', '2026-10-28T00:00:00.000000Z');
