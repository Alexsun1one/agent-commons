-- R17-H4 · 找搭子的需求帖和邀约能被举报，治理员能收起需求帖。
--   social_buddy_report  举报要存一份被举报内容的快照（同 chat_report / dm_report），需求帖和邀约共用一张，用 target_kind 区分。
--   social_buddy_post.gov_hidden  治理员「收起」要和作者自己的 paused 分开，否则作者能自己恢复；用一列而不是改 state 的 CHECK。

ALTER TABLE social_buddy_post ADD COLUMN gov_hidden INTEGER NOT NULL DEFAULT 0 CHECK (gov_hidden IN (0, 1));

CREATE TABLE social_buddy_report (
  id TEXT PRIMARY KEY,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('post', 'invite')),
  target_id TEXT NOT NULL,
  reporter_id TEXT NOT NULL REFERENCES principal(id),
  reason TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (target_kind, target_id, reporter_id)
) STRICT;
CREATE INDEX social_buddy_report_reporter ON social_buddy_report(reporter_id, created_at);

INSERT OR IGNORE INTO action_rule (action, min_level, roles, owner_only, require_totp, flag, note, updated_at) VALUES
  ('social.buddy.report', 1, '[]', 0, 0, 'social.enabled', '举报别人的找搭子需求或搭子邀约', '2026-10-28T00:00:00.000000Z');
