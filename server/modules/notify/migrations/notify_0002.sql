-- NOTIF-2 · 扩展通知分类，接乐园 / 活动 / 悬赏 / 市集 / 私信。
-- SQLite 不能改 CHECK，先建新表再搬数据。

CREATE TABLE notify_rule_next (
  id TEXT PRIMARY KEY,
  event_pattern TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL CHECK (category IN (
    'reply', 'mention', 'reward', 'achievement', 'room', 'agent', 'governance', 'system',
    'park', 'event', 'bounty', 'market', 'dm', 'announce'
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
    'park', 'event', 'bounty', 'market', 'dm', 'announce'
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

INSERT INTO notification_source_next (event_id, recipient_id, notification_id, created_at)
SELECT event_id, recipient_id, notification_id, created_at FROM notification_source;

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
INSERT INTO notification_source (event_id, recipient_id, notification_id, created_at)
SELECT event_id, recipient_id, notification_id, created_at FROM notification_source_next;
DROP TABLE notification_source_next;

CREATE INDEX notification_inbox ON notification(recipient_id, available_at, updated_at, id);
CREATE INDEX notification_unread ON notification(recipient_id, available_at, updated_at) WHERE read_at IS NULL;
CREATE INDEX notification_merge ON notification(recipient_id, category, merge_key, updated_at) WHERE read_at IS NULL;

UPDATE notify_rule SET category = 'bounty'
 WHERE id = 'bounty-awarded' AND event_pattern = 'bounty.awarded';

INSERT OR IGNORE INTO notify_rule
  (id, event_pattern, category, recipient_strategy, title_template, body_template, link_template,
   merge_key_template, merge_minutes, allow_self, created_at)
VALUES
  ('farm-stolen', 'farm.stolen', 'park', 'payload:recipient_id',
   '{actor} 来过你的农场', '{message}', '#/farm', 'park:farm', 30, 0, '2026-10-25T12:00:00.000000Z'),
  ('farm-helped', 'farm.helped', 'park', 'payload:recipient_id',
   '{actor} 来过你的农场', '{message}', '#/farm', 'park:farm', 30, 0, '2026-10-25T12:00:00.000000Z'),
  ('parking-parked', 'parking.parked', 'park', 'payload:recipient_id',
   '{actor} 停在你的车位', '第 {slot_no} 号车位来了串门的车', '#/parking', 'park:visit', 30, 0, '2026-10-25T12:00:00.000000Z'),
  ('parking-ticketed', 'parking.ticketed', 'park', 'payload:recipient_id',
   '{actor} 给你的车贴了条', '罚没 {fine} 竹子，车已回家', '#/parking', 'park:ticket', 30, 0, '2026-10-25T12:00:00.000000Z'),
  ('events-live', 'events.status_changed', 'event', 'event_signups',
   '你报名的活动开始了', '《{event_title}》已经开始', '#/event/{target_id}', NULL, 0, 0, '2026-10-25T12:00:00.000000Z'),
  ('events-voted', 'events.voted', 'event', 'event_candidate',
   '打榜名次有变化', '《{event_title}》里你的作品名次更新了', '#/campaign/{target_id}', NULL, 0, 0, '2026-10-25T12:00:00.000000Z'),
  ('events-results', 'events.results_published', 'event', 'event_winners',
   '你在活动中获奖了', '《{event_title}》已经公示结果', '#/event/{target_id}', NULL, 0, 0, '2026-10-25T12:00:00.000000Z'),
  ('bounty-submission', 'bounty.submission_created', 'bounty', 'bounty_owner',
   '{actor} 回答了你的悬赏', '有一条新的试用反馈待你查看', '#/opportunities', 'bounty:{target_id}', 10, 0, '2026-10-25T12:00:00.000000Z'),
  ('bounty-accepted', 'bounty.submission_decided', 'bounty', 'bounty_submitter',
   '你的悬赏回答被采纳了', '发起人已经验收通过', '#/opportunities', NULL, 0, 0, '2026-10-25T12:00:00.000000Z'),
  ('bounty-refunded', 'bounty.refunded', 'bounty', 'bounty_owner',
   '悬赏已到期退回', '未选回答，托管积分已退回', '#/opportunities', NULL, 0, 1, '2026-10-25T12:00:00.000000Z'),
  ('market-wanted', 'market.wanted', 'market', 'payload:recipient_id',
   '{actor} 想要你的市集帖子', '有人回应了你的帖子', '#/market/{target_id}', 'market:{target_id}', 10, 0, '2026-10-25T12:00:00.000000Z'),
  ('dm-message', 'notify.system.dm', 'dm', 'payload:recipient_id',
   '你有一条新私信', '', '#/notifications', 'dm:inbox', 30, 0, '2026-10-25T12:00:00.000000Z'),
  ('gov-notice', 'governance.notice', 'governance', 'payload:principal_id',
   '{title}', '{message}', '#/governance', 'governance:{target_id}', 5, 1, '2026-10-25T12:00:00.000000Z'),
  ('gov-report', 'governance.report_resolved', 'governance', 'payload:reporter_id',
   '举报复核已有结果', '{outcome}', '#/governance', NULL, 0, 1, '2026-10-25T12:00:00.000000Z'),
  ('gov-action', 'governance.action_executed', 'governance', 'payload:subject_id',
   '{title}', '{message}', '#/governance', 'governance:{target_id}', 5, 1, '2026-10-25T12:00:00.000000Z');
