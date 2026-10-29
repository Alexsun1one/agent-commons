-- R17-H · 社区祝福、关掉推荐人、阅读入口、找搭子、赞助与讲师申请。
-- 新表的理由各一句：
--   social_blessing           祝福要“每人每天每个对象一次”的计数和审计，戳一戳表的主键和用途都不同。
--   social_suggestion_dismiss “不再推荐这个人”要长期记住，prefs 只有整体开关。
--   social_signal             个人保存的阅读入口，是一个人对一个来源的标记，没有现成的表。
--   social_buddy_post         搭子需求是要给别的成员看的公开需求，动态（social_post）是对象体系、带范围和反应，装不下“已收起/已满”状态。
--   social_buddy_invite       一个人约另一个人，有自己的状态（已发/已撤回/已接受/已婉拒）。
--   social_application        赞助和讲师申请是“给平台的一张表”，不是动态也不是订单；只存文字，不涉及钱。

CREATE TABLE social_blessing (
  sender_id TEXT NOT NULL REFERENCES principal(id),
  target_id TEXT NOT NULL REFERENCES principal(id),
  day TEXT NOT NULL,
  years INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (sender_id, target_id, day),
  CHECK (sender_id != target_id)
) STRICT, WITHOUT ROWID;
CREATE INDEX social_blessing_by_target ON social_blessing(target_id, day);

CREATE TABLE social_suggestion_dismiss (
  principal_id TEXT NOT NULL REFERENCES principal(id),
  target_id TEXT NOT NULL REFERENCES principal(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (principal_id, target_id)
) STRICT, WITHOUT ROWID;

CREATE TABLE social_signal (
  principal_id TEXT NOT NULL REFERENCES principal(id),
  key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (principal_id, key)
) STRICT, WITHOUT ROWID;

ALTER TABLE social_pref ADD COLUMN buddy_open INTEGER NOT NULL DEFAULT 0 CHECK (buddy_open IN (0, 1));

CREATE TABLE social_buddy_post (
  id TEXT PRIMARY KEY,
  author_id TEXT NOT NULL REFERENCES principal(id),
  kind TEXT NOT NULL CHECK (kind IN ('project', 'learn', 'review')),
  title TEXT NOT NULL,
  outcome TEXT NOT NULL,
  schedule TEXT NOT NULL,
  contribution TEXT NOT NULL,
  partner TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'paused')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX social_buddy_post_open ON social_buddy_post(state, created_at, id);
CREATE INDEX social_buddy_post_author ON social_buddy_post(author_id, created_at);

CREATE TABLE social_buddy_invite (
  id TEXT PRIMARY KEY,
  sender_id TEXT NOT NULL REFERENCES principal(id),
  target_id TEXT NOT NULL REFERENCES principal(id),
  post_id TEXT REFERENCES social_buddy_post(id),
  kind TEXT NOT NULL CHECK (kind IN ('project', 'learn', 'review')),
  title TEXT NOT NULL,
  outcome TEXT NOT NULL,
  schedule TEXT NOT NULL,
  contribution TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'sent' CHECK (state IN ('sent', 'withdrawn', 'accepted', 'declined')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (sender_id != target_id)
) STRICT;
CREATE INDEX social_buddy_invite_sender ON social_buddy_invite(sender_id, created_at);
CREATE INDEX social_buddy_invite_target ON social_buddy_invite(target_id, state, created_at);
CREATE UNIQUE INDEX social_buddy_invite_live ON social_buddy_invite(sender_id, target_id, COALESCE(post_id, ''))
  WHERE state = 'sent';

CREATE TABLE social_application (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('sponsor', 'lecturer')),
  applicant_id TEXT NOT NULL REFERENCES principal(id),
  body_json TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'submitted' CHECK (state IN ('submitted', 'withdrawn', 'approved', 'rejected')),
  decided_by TEXT REFERENCES principal(id),
  decision_note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  decided_at TEXT
) STRICT;
CREATE INDEX social_application_by_applicant ON social_application(applicant_id, kind, created_at);
CREATE INDEX social_application_by_state ON social_application(state, kind, created_at);
CREATE UNIQUE INDEX social_application_open ON social_application(applicant_id, kind) WHERE state = 'submitted';

INSERT OR IGNORE INTO action_rule (action, min_level, roles, owner_only, require_totp, flag, note, updated_at) VALUES
  ('social.bless', 1, '[]', 0, 0, 'social.enabled', '给关注的人送纪念日祝福（每人每天一次，每天最多 20 个）', '2026-10-28T00:00:00.000000Z'),
  ('social.signal', 1, '[]', 0, 0, 'social.enabled', '保存官方阅读入口', '2026-10-28T00:00:00.000000Z'),
  ('social.buddy.post', 1, '[]', 0, 0, 'social.enabled', '发布和管理自己的找搭子需求', '2026-10-28T00:00:00.000000Z'),
  ('social.buddy.invite', 1, '[]', 0, 0, 'social.enabled', '给开放搭子邀约的成员发邀约，并回应收到的邀约', '2026-10-28T00:00:00.000000Z'),
  ('social.apply.sponsor', 1, '[]', 0, 0, 'social.enabled', '提交赞助合作意向（只是申请表，不涉及钱）', '2026-10-28T00:00:00.000000Z'),
  ('social.apply.lecturer', 3, '[]', 0, 0, 'social.enabled', 'L3 及以上提交讲师计划申请（只是申请表，不涉及钱）', '2026-10-28T00:00:00.000000Z'),
  ('social.application.review', NULL, '["admin"]', 0, 1, 'social.enabled', '管理员（含 TOTP）查看和处理赞助、讲师申请', '2026-10-28T00:00:00.000000Z');
