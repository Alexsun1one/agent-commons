-- SOCIAL-2 · 六种社交事件各自可关闭。
-- SQLite 不能修改 CHECK，重建两个带 category 约束的表。

CREATE TABLE notify_rule_next (
  id TEXT PRIMARY KEY,
  event_pattern TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL CHECK (category IN (
    'reply', 'mention', 'reward', 'achievement', 'room', 'agent', 'governance', 'system',
    'park', 'event', 'bounty', 'market', 'dm', 'announce',
    'social_follow', 'social_poke', 'social_reaction', 'social_share',
    'social_join_request', 'social_join_approved'
  )),
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

INSERT INTO notify_rule_next
  (id, event_pattern, category, recipient_strategy, title_template, body_template, link_template,
   merge_key_template, merge_minutes, allow_self, enabled, created_at)
SELECT id, event_pattern, category, recipient_strategy, title_template, body_template, link_template,
       merge_key_template, merge_minutes, allow_self, enabled, created_at
FROM notify_rule;

CREATE TABLE notification_next (
  id TEXT PRIMARY KEY,
  recipient_id TEXT NOT NULL REFERENCES principal(id),
  category TEXT NOT NULL CHECK (category IN (
    'reply', 'mention', 'reward', 'achievement', 'room', 'agent', 'governance', 'system',
    'park', 'event', 'bounty', 'market', 'dm', 'announce',
    'social_follow', 'social_poke', 'social_reaction', 'social_share',
    'social_join_request', 'social_join_approved'
  )),
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

INSERT INTO notification_next
  (id, recipient_id, category, title, body, link, target_type, target_id, visibility_object_id,
   merge_key, event_count, actor_ids_json, occurred_at, available_at, read_at, created_at, updated_at)
SELECT id, recipient_id, category, title, body, link, target_type, target_id, visibility_object_id,
       merge_key, event_count, actor_ids_json, occurred_at, available_at, read_at, created_at, updated_at
FROM notification;

CREATE TABLE notification_source_next (
  event_id TEXT NOT NULL REFERENCES outbox_event(id),
  recipient_id TEXT NOT NULL REFERENCES principal(id),
  notification_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (event_id, recipient_id)
) STRICT, WITHOUT ROWID;
INSERT INTO notification_source_next SELECT event_id, recipient_id, notification_id, created_at FROM notification_source;

DROP TABLE notification_source;
DROP TABLE notification;
DROP TABLE notify_rule;
ALTER TABLE notify_rule_next RENAME TO notify_rule;
ALTER TABLE notification_next RENAME TO notification;

CREATE TABLE notification_source (
  event_id TEXT NOT NULL REFERENCES outbox_event(id),
  recipient_id TEXT NOT NULL REFERENCES principal(id),
  notification_id TEXT NOT NULL REFERENCES notification(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (event_id, recipient_id)
) STRICT, WITHOUT ROWID;
INSERT INTO notification_source SELECT event_id, recipient_id, notification_id, created_at FROM notification_source_next;
DROP TABLE notification_source_next;

CREATE INDEX notification_inbox ON notification(recipient_id, available_at, updated_at, id);
CREATE INDEX notification_unread ON notification(recipient_id, available_at, updated_at) WHERE read_at IS NULL;
CREATE INDEX notification_merge ON notification(recipient_id, category, merge_key, updated_at) WHERE read_at IS NULL;

INSERT OR IGNORE INTO notify_rule
  (id, event_pattern, category, recipient_strategy, title_template, body_template, link_template,
   merge_key_template, merge_minutes, allow_self, created_at)
VALUES
  ('social-followed', 'social.followed', 'social_follow', 'payload:recipient_id',
   '{actor} 关注了你', '{message}', '#/u/{actor_handle}', NULL, 0, 0, '2026-10-25T16:00:00.000000Z'),
  ('social-poked', 'social.poked', 'social_poke', 'payload:recipient_id',
   '{actor} 戳了你一下', '{message}', '#/u/{actor_handle}', NULL, 0, 0, '2026-10-25T16:00:00.000000Z'),
  ('social-reacted', 'social.reacted', 'social_reaction', 'payload:recipient_id',
   '{actor} 回应了你的动态', '{message}', '#/feed/{object_id}', NULL, 0, 0, '2026-10-25T16:00:00.000000Z'),
  ('social-shared', 'social.shared', 'social_share', 'payload:recipient_id',
   '{actor} 转发了你的动态', '{message}', '#/feed/{object_id}', NULL, 0, 0, '2026-10-25T16:00:00.000000Z'),
  ('social-join-requested', 'social.group.join_requested', 'social_join_request', 'payload:recipient_id',
   '{actor} 申请加入小组', '{message}', '#/group/{group}/members', NULL, 0, 0, '2026-10-25T16:00:00.000000Z'),
  ('social-join-approved', 'social.group.join_approved', 'social_join_approved', 'payload:recipient_id',
   '入组申请已通过', '{message}', '#/group/{group}', NULL, 0, 0, '2026-10-25T16:00:00.000000Z');
