CREATE TABLE notify_rule (
  id TEXT PRIMARY KEY,
  event_pattern TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL CHECK (category IN ('reply', 'mention', 'reward', 'achievement', 'room', 'agent', 'governance', 'system')),
  recipient_strategy TEXT NOT NULL,
  title_template TEXT NOT NULL,
  body_template TEXT NOT NULL,
  link_template TEXT,
  merge_key_template TEXT,
  merge_minutes INTEGER NOT NULL DEFAULT 0 CHECK (merge_minutes BETWEEN 0 AND 1440),
  allow_self INTEGER NOT NULL DEFAULT 0 CHECK (allow_self IN (0, 1)),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE notification (
  id TEXT PRIMARY KEY,
  recipient_id TEXT NOT NULL REFERENCES principal(id),
  category TEXT NOT NULL CHECK (category IN ('reply', 'mention', 'reward', 'achievement', 'room', 'agent', 'governance', 'system')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  link TEXT,
  target_type TEXT,
  target_id TEXT,
  visibility_object_id TEXT REFERENCES object_head(id),
  merge_key TEXT,
  event_count INTEGER NOT NULL DEFAULT 1 CHECK (event_count >= 1),
  actor_ids_json TEXT NOT NULL DEFAULT '[]',
  occurred_at TEXT NOT NULL,
  available_at TEXT NOT NULL,
  read_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX notification_inbox ON notification(recipient_id, available_at, updated_at, id);
CREATE INDEX notification_unread ON notification(recipient_id, available_at, updated_at) WHERE read_at IS NULL;
CREATE INDEX notification_merge ON notification(recipient_id, category, merge_key, updated_at) WHERE read_at IS NULL;

CREATE TABLE notification_source (
  event_id TEXT NOT NULL REFERENCES outbox_event(id),
  recipient_id TEXT NOT NULL REFERENCES principal(id),
  notification_id TEXT NOT NULL REFERENCES notification(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (event_id, recipient_id)
) STRICT, WITHOUT ROWID;

CREATE TABLE notify_pref (
  principal_id TEXT PRIMARY KEY REFERENCES principal(id),
  category_json TEXT NOT NULL DEFAULT '{}',
  quiet_start TEXT,
  quiet_end TEXT,
  timezone_offset_min INTEGER NOT NULL DEFAULT 0 CHECK (timezone_offset_min BETWEEN -840 AND 840),
  daily_digest INTEGER NOT NULL DEFAULT 1 CHECK (daily_digest IN (0, 1)),
  updated_at TEXT NOT NULL,
  CHECK ((quiet_start IS NULL) = (quiet_end IS NULL))
) STRICT;

INSERT OR IGNORE INTO action_rule (action, min_level, roles, owner_only, require_totp, flag, note, updated_at) VALUES
  ('notify.read', 1, '[]', 0, 0, 'notify.enabled', '读自己的通知；路由固定按主体过滤', '2026-10-25T00:00:00.000000Z'),
  ('notify.mark_read', 1, '[]', 0, 0, 'notify.enabled', '标记自己的通知；路由固定按主体过滤', '2026-10-25T00:00:00.000000Z'),
  ('notify.preferences', 1, '[]', 0, 0, 'notify.enabled', '修改自己的通知偏好；路由固定按主体过滤', '2026-10-25T00:00:00.000000Z');

INSERT OR IGNORE INTO feature_flag (key, enabled, description, updated_at) VALUES
  ('notify.enabled', 1, '站内通知中心', '2026-10-25T00:00:00.000000Z');

INSERT OR IGNORE INTO notify_rule
  (id, event_pattern, category, recipient_strategy, title_template, body_template, link_template,
   merge_key_template, merge_minutes, allow_self, created_at)
VALUES
  ('object-reply', 'object.created', 'reply', 'reply_author', '{actor} 回复了你', '在《{title}》里的发言有了新回复', '#/discuss/{target_id}', 'reply:{merge_id}', 10, 0, '2026-10-25T00:00:00.000000Z'),
  ('growth-level', 'growth.level_changed', 'achievement', 'aggregate_principal', '你升级到 L{to}', '{message}', '#/me', NULL, 0, 1, '2026-10-25T00:00:00.000000Z'),
  ('growth-review', 'growth.review_queued', 'achievement', 'payload:principal_id', '等级复核已进入队列', '目标等级 L{target_level}', '#/me', NULL, 0, 1, '2026-10-25T00:00:00.000000Z'),
  ('bounty-awarded', 'bounty.awarded', 'reward', 'payload:recipient_id', '你的贡献获得了奖励', '收到 {credits} 积分', '#/opportunities', NULL, 0, 0, '2026-10-25T00:00:00.000000Z'),
  ('rooms-removed', 'rooms.participant.removed', 'room', 'payload:principal_id', '房间权限有变化', '你已被移出房间', '#/talks/{target_id}', NULL, 0, 0, '2026-10-25T00:00:00.000000Z'),
  ('rooms-transfer', 'rooms.room.host_transferred', 'room', 'payload:to', '你成为了房间主持人', '房间主持权已转交给你', '#/talks/{target_id}', NULL, 0, 1, '2026-10-25T00:00:00.000000Z'),
  ('rooms-reminder', 'rooms.reminder.*', 'room', 'payload:host_id', '讲堂即将开始', '请查看房间安排', '#/talks/{target_id}', 'room:{target_id}', 5, 1, '2026-10-25T00:00:00.000000Z'),
  ('agents-events', 'agents.*', 'agent', 'payload:recipient_id', 'Agent 有新动态', '{message}', '#/agents', 'agent:{target_id}', 5, 0, '2026-10-25T00:00:00.000000Z'),
  ('agentchat-message', 'agentchat.message.created', 'mention', 'chat_recipients', '{actor} 提到了你', '在 Agent 广场给你留了消息', '#/agents', 'mention:{target_id}', 5, 0, '2026-10-25T00:00:00.000000Z'),
  ('kb-solution', 'kb.solution.added', 'reply', 'kb_author', '问题有了新解法', '《{title}》收到一条解决方案', '#/solved/{target_id}', 'kb:{target_id}', 10, 0, '2026-10-25T00:00:00.000000Z'),
  ('kb-verified', 'kb.problem.verified', 'reward', 'kb_author', '你的问题已通过验证', '《{title}》新增了复现记录', '#/solved/{target_id}', 'kb-verified:{target_id}', 10, 1, '2026-10-25T00:00:00.000000Z'),
  ('governance-events', 'governance.*', 'governance', 'payload:recipient_id', '治理结果已更新', '{message}', '#/governance', 'governance:{target_id}', 5, 1, '2026-10-25T00:00:00.000000Z'),
  ('system-events', 'notify.system.*', 'system', 'payload:recipient_id', '系统通知', '{message}', '#/notifications', NULL, 0, 1, '2026-10-25T00:00:00.000000Z');

