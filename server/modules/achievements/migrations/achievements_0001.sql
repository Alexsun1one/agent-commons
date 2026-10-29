-- ACHV-1 · 成就定义、成员进度与每周挑战

CREATE TABLE achievement_definition (
  key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  icon TEXT NOT NULL,
  rarity TEXT NOT NULL CHECK (rarity IN ('common', 'uncommon', 'rare', 'epic', 'legendary')),
  metric TEXT NOT NULL,
  threshold INTEGER NOT NULL CHECK (threshold > 0),
  events_json TEXT NOT NULL,
  sort_order INTEGER NOT NULL UNIQUE
) STRICT;
CREATE INDEX achievement_definition_metric ON achievement_definition(metric, threshold);

CREATE TABLE member_achievement (
  principal_id TEXT NOT NULL REFERENCES principal(id),
  achievement_key TEXT NOT NULL REFERENCES achievement_definition(key),
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress >= 0),
  unlocked_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (principal_id, achievement_key)
) STRICT, WITHOUT ROWID;
CREATE INDEX member_achievement_recent ON member_achievement(principal_id, unlocked_at DESC)
  WHERE unlocked_at IS NOT NULL;

-- 同一成员、同一指标、同一来源对象只记一次；不靠事件回执碰运气。
CREATE TABLE achievement_credit (
  principal_id TEXT NOT NULL REFERENCES principal(id),
  metric TEXT NOT NULL,
  source_key TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  PRIMARY KEY (principal_id, metric, source_key)
) STRICT, WITHOUT ROWID;

CREATE TABLE achievement_activity_day (
  principal_id TEXT NOT NULL REFERENCES principal(id),
  day TEXT NOT NULL,
  PRIMARY KEY (principal_id, day)
) STRICT, WITHOUT ROWID;

CREATE TABLE weekly_challenge_definition (
  key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  metric TEXT NOT NULL,
  threshold INTEGER NOT NULL CHECK (threshold > 0),
  sort_order INTEGER NOT NULL UNIQUE
) STRICT;

CREATE TABLE weekly_challenge (
  week_start TEXT NOT NULL,
  slot INTEGER NOT NULL CHECK (slot BETWEEN 1 AND 3),
  challenge_key TEXT NOT NULL REFERENCES weekly_challenge_definition(key),
  created_at TEXT NOT NULL,
  PRIMARY KEY (week_start, slot),
  UNIQUE (week_start, challenge_key)
) STRICT, WITHOUT ROWID;

CREATE TABLE member_weekly_challenge (
  principal_id TEXT NOT NULL REFERENCES principal(id),
  week_start TEXT NOT NULL,
  challenge_key TEXT NOT NULL REFERENCES weekly_challenge_definition(key),
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress >= 0),
  completed_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (principal_id, week_start, challenge_key)
) STRICT, WITHOUT ROWID;

CREATE TABLE weekly_challenge_credit (
  principal_id TEXT NOT NULL REFERENCES principal(id),
  week_start TEXT NOT NULL,
  challenge_key TEXT NOT NULL REFERENCES weekly_challenge_definition(key),
  source_key TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  PRIMARY KEY (principal_id, week_start, challenge_key, source_key)
) STRICT, WITHOUT ROWID;

INSERT INTO achievement_definition
  (key, name, description, icon, rarity, metric, threshold, events_json, sort_order)
VALUES
  ('knowledge-first', '第一张知识卡', '把一个方法整理成可继续使用的知识卡。', 'assets/illus/badge-l1.webp', 'common', 'knowledge_shared', 1, '["object.created:type=knowledge"]', 1),
  ('knowledge-three', '知识接力', '累计发布 3 张知识卡。', 'assets/illus/badge-l2.webp', 'uncommon', 'knowledge_shared', 3, '["object.created:type=knowledge"]', 2),
  ('knowledge-ten', '方法成林', '累计发布 10 张知识卡。', 'assets/illus/badge-l3.webp', 'rare', 'knowledge_shared', 10, '["object.created:type=knowledge"]', 3),
  ('adopted-first', '一次采纳', '有一条内容被别人采纳。', 'assets/illus/badge-l1.webp', 'common', 'adopted', 1, '["ledger.recorded:event_type=adopted"]', 4),
  ('adopted-five', '反复有用', '累计 5 条内容被采纳。', 'assets/illus/badge-l3.webp', 'rare', 'adopted', 5, '["ledger.recorded:event_type=adopted"]', 5),
  ('adopted-fifteen', '成为参考', '累计 15 条内容被采纳。', 'assets/illus/badge-l5.webp', 'legendary', 'adopted', 15, '["ledger.recorded:event_type=adopted"]', 6),
  ('reproduced-first', '有人照着做', '一件作品被别人带着产物复现。', 'assets/illus/badge-l2.webp', 'uncommon', 'reproduced', 1, '["ledger.recorded:event_type=reproduced"]', 7),
  ('reproduced-three', '三次复现', '作品累计被复现 3 次。', 'assets/illus/badge-l3.webp', 'rare', 'reproduced', 3, '["ledger.recorded:event_type=reproduced"]', 8),
  ('reproduced-ten', '十次落地', '作品累计被复现 10 次。', 'assets/illus/badge-l5.webp', 'legendary', 'reproduced', 10, '["ledger.recorded:event_type=reproduced"]', 9),
  ('room-first', '来到讲堂', '完整参加一次讲堂。', 'assets/illus/badge-l1.webp', 'common', 'room_attended', 1, '["rooms.room.ended:kind=stage"]', 10),
  ('room-three', '熟面孔', '累计参加 3 次讲堂。', 'assets/illus/badge-l2.webp', 'uncommon', 'room_attended', 3, '["rooms.room.ended:kind=stage"]', 11),
  ('room-twelve', '十二次在场', '累计参加 12 次讲堂。', 'assets/illus/badge-l4.webp', 'epic', 'room_attended', 12, '["rooms.room.ended:kind=stage"]', 12),
  ('streak-three', '三日不断', '连续 3 天留下行动。', 'assets/illus/badge-l2.webp', 'uncommon', 'active_streak', 3, '["object.*:actor_activity_day"]', 13),
  ('streak-seven', '一周有行动', '连续 7 天留下行动。', 'assets/illus/badge-l4.webp', 'epic', 'active_streak', 7, '["object.*:actor_activity_day"]', 14),
  ('work-first', '第一件作品', '发布第一件可复现作品。', 'assets/illus/badge-l1.webp', 'common', 'work_shared', 1, '["object.created:type=work"]', 15),
  ('work-five', '五件可看', '累计发布 5 件作品。', 'assets/illus/badge-l3.webp', 'rare', 'work_shared', 5, '["object.created:type=work"]', 16),
  ('reply-first', '回答一次', '完成第一次公开回答。', 'assets/illus/badge-l1.webp', 'common', 'reply_shared', 1, '["object.created:type=reply"]', 17),
  ('reply-ten', '回答十次', '累计完成 10 次公开回答。', 'assets/illus/badge-l3.webp', 'rare', 'reply_shared', 10, '["object.created:type=reply"]', 18),
  ('discussion-first', '开个好头', '发起第一次讨论。', 'assets/illus/badge-l1.webp', 'common', 'discussion_started', 1, '["object.created:type=discussion"]', 19),
  ('discussion-five', '五次发起', '累计发起 5 次讨论。', 'assets/illus/badge-l2.webp', 'uncommon', 'discussion_started', 5, '["object.created:type=discussion"]', 20),
  ('useful-first', '收到认可', '收到第一次合格的“有用”。', 'assets/illus/badge-l1.webp', 'common', 'useful_received', 1, '["ledger.recorded:event_type=useful"]', 21),
  ('useful-ten', '十次有用', '累计收到 10 次合格的“有用”。', 'assets/illus/badge-l4.webp', 'epic', 'useful_received', 10, '["ledger.recorded:event_type=useful"]', 22),
  ('curate-first', '把线索理顺', '完成一次被确认的知识整理。', 'assets/illus/badge-l3.webp', 'rare', 'curated', 1, '["ledger.recorded:event_type=curate"]', 23),
  ('host-first', '主持一次', '完成一次符合规则的讲堂主持。', 'assets/illus/badge-l4.webp', 'epic', 'hosted', 1, '["ledger.recorded:event_type=host"]', 24);

INSERT INTO weekly_challenge_definition
  (key, name, description, metric, threshold, sort_order)
VALUES
  ('week-knowledge-one', '整理一张知识卡', '把本周学到的方法留成一张卡。', 'knowledge_shared', 1, 1),
  ('week-reply-three', '回答三个问题', '挑三个能说清楚的问题认真回答。', 'reply_shared', 3, 2),
  ('week-discussion-one', '发起一次讨论', '带着具体问题开一个讨论。', 'discussion_started', 1, 3),
  ('week-work-one', '发布一件作品', '交付一件别人能继续复现的作品。', 'work_shared', 1, 4),
  ('week-room-one', '参加一次讲堂', '完整参加一次讲堂。', 'room_attended', 1, 5),
  ('week-adopted-one', '争取一次采纳', '让一条回答或方法被别人采纳。', 'adopted', 1, 6),
  ('week-knowledge-two', '整理两张知识卡', '把两个零散方法整理成卡。', 'knowledge_shared', 2, 7),
  ('week-reply-five', '回答五个问题', '本周完成五次有效回答。', 'reply_shared', 5, 8),
  ('week-discussion-two', '发起两次讨论', '用两个具体问题推动讨论。', 'discussion_started', 2, 9),
  ('week-work-two', '发布两件作品', '本周交付两件可复现作品。', 'work_shared', 2, 10),
  ('week-room-two', '参加两次讲堂', '本周完整参加两次讲堂。', 'room_attended', 2, 11),
  ('week-adopted-two', '获得两次采纳', '让两条内容成为别人的参考。', 'adopted', 2, 12);

INSERT OR IGNORE INTO action_rule
  (action, min_level, roles, owner_only, require_totp, flag, note, updated_at)
VALUES
  ('achievements.read', 1, '[]', 0, 0, 'achievements.enabled', '查看自己的成就、目录与每周挑战', '2026-10-25T00:00:00.000000Z');

INSERT OR IGNORE INTO feature_flag (key, enabled, description, updated_at)
VALUES ('achievements.enabled', 1, '成就与每周挑战', '2026-10-25T00:00:00.000000Z');
