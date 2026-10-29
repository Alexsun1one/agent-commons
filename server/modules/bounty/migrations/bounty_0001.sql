CREATE TABLE bounty (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('help', 'promo')),
  object_id TEXT NOT NULL REFERENCES object_head(id),
  owner_id TEXT NOT NULL REFERENCES principal(id),
  status TEXT NOT NULL CHECK (status IN ('open', 'awarded', 'refunded', 'cancelled', 'closed')),
  credits INTEGER NOT NULL DEFAULT 0 CHECK (credits >= 0),
  cosmetic_id TEXT,
  perk_note TEXT,
  deadline_at TEXT NOT NULL,
  settle_after TEXT NOT NULL,
  season TEXT NOT NULL,
  settle_reason TEXT,
  settled_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (deadline_at < settle_after),
  CHECK (kind = 'help' OR credits = 0)
) STRICT;
CREATE UNIQUE INDEX bounty_one_open_per_object ON bounty(object_id) WHERE status = 'open';
CREATE INDEX bounty_due ON bounty(status, settle_after);
CREATE INDEX bounty_recent ON bounty(created_at, id);
CREATE INDEX bounty_by_owner ON bounty(owner_id, status, created_at);

CREATE TABLE credit_entry (
  id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL REFERENCES principal(id),
  kind TEXT NOT NULL CHECK (kind IN ('grant', 'hold', 'release', 'award', 'refund', 'reverse')),
  amount INTEGER NOT NULL,
  held_delta INTEGER NOT NULL DEFAULT 0,
  bounty_id TEXT REFERENCES bounty(id),
  source_type TEXT NOT NULL,
  source_ref TEXT,
  season TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  actor_id TEXT REFERENCES principal(id),
  reason_code TEXT,
  created_at TEXT NOT NULL,
  CHECK (
    (kind = 'grant' AND amount > 0 AND held_delta = 0)
    OR (kind = 'hold' AND amount < 0 AND held_delta = -amount AND bounty_id IS NOT NULL)
    OR (kind = 'release' AND amount = 0 AND held_delta < 0 AND bounty_id IS NOT NULL)
    OR (kind = 'award' AND amount > 0 AND held_delta = 0 AND bounty_id IS NOT NULL)
    OR (kind = 'refund' AND amount > 0 AND held_delta = -amount AND bounty_id IS NOT NULL)
    OR (kind = 'reverse' AND amount != 0 AND held_delta = 0)
  )
) STRICT;
CREATE INDEX credit_sum ON credit_entry(principal_id, amount, held_delta);
CREATE INDEX credit_by_season ON credit_entry(principal_id, season, created_at);
CREATE INDEX credit_by_bounty ON credit_entry(bounty_id, principal_id, held_delta);
CREATE TRIGGER credit_entry_no_update BEFORE UPDATE ON credit_entry
BEGIN SELECT RAISE(ABORT, 'credit_entry is append-only'); END;
CREATE TRIGGER credit_entry_no_delete BEFORE DELETE ON credit_entry
BEGIN SELECT RAISE(ABORT, 'credit_entry is append-only'); END;
CREATE TRIGGER credit_entry_never_negative BEFORE INSERT ON credit_entry
WHEN (SELECT coalesce(sum(amount), 0) FROM credit_entry WHERE principal_id = NEW.principal_id) + NEW.amount < 0
  OR (SELECT coalesce(sum(held_delta), 0) FROM credit_entry WHERE principal_id = NEW.principal_id) + NEW.held_delta < 0
  OR (NEW.bounty_id IS NOT NULL AND (SELECT coalesce(sum(held_delta), 0) FROM credit_entry
      WHERE bounty_id = NEW.bounty_id AND principal_id = NEW.principal_id) + NEW.held_delta < 0)
BEGIN SELECT RAISE(ABORT, 'credit balance would go negative'); END;

CREATE TABLE bounty_topup (
  id TEXT PRIMARY KEY,
  bounty_id TEXT NOT NULL REFERENCES bounty(id),
  contributor_id TEXT NOT NULL REFERENCES principal(id),
  amount INTEGER NOT NULL CHECK (amount > 0),
  credit_entry_id TEXT NOT NULL REFERENCES credit_entry(id),
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX bounty_topup_by_bounty ON bounty_topup(bounty_id, contributor_id);

CREATE TABLE promo_task (
  id TEXT PRIMARY KEY,
  bounty_id TEXT NOT NULL REFERENCES bounty(id),
  title TEXT NOT NULL,
  task_kind TEXT NOT NULL CHECK (task_kind IN ('feedback', 'bug', 'review', 'recording')),
  description TEXT NOT NULL,
  credits_per INTEGER NOT NULL DEFAULT 0 CHECK (credits_per >= 0),
  max_claims INTEGER NOT NULL CHECK (max_claims BETWEEN 1 AND 50),
  cosmetic_id TEXT,
  perk_note TEXT,
  created_at TEXT NOT NULL,
  CHECK (credits_per > 0 OR cosmetic_id IS NOT NULL OR perk_note IS NOT NULL)
) STRICT;
CREATE INDEX promo_task_by_bounty ON promo_task(bounty_id, created_at);

CREATE TABLE promo_submission (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES promo_task(id),
  bounty_id TEXT NOT NULL REFERENCES bounty(id),
  submitter_id TEXT NOT NULL REFERENCES principal(id),
  body TEXT NOT NULL,
  evidence_object_id TEXT REFERENCES object_head(id),
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected', 'expired')),
  reason_code TEXT,
  created_at TEXT NOT NULL,
  decided_at TEXT,
  decided_by TEXT REFERENCES principal(id)
) STRICT;
CREATE UNIQUE INDEX promo_submission_live ON promo_submission(task_id, submitter_id) WHERE status IN ('pending', 'accepted');
CREATE INDEX promo_submission_by_bounty ON promo_submission(bounty_id, status, created_at);
CREATE INDEX promo_submission_by_submitter ON promo_submission(submitter_id, created_at);

CREATE TABLE bounty_award (
  id TEXT PRIMARY KEY,
  bounty_id TEXT NOT NULL REFERENCES bounty(id),
  kind TEXT NOT NULL CHECK (kind IN ('help', 'promo')),
  mode TEXT NOT NULL CHECK (mode IN ('owner', 'auto', 'accept')),
  answer_id TEXT REFERENCES object_head(id),
  submission_id TEXT REFERENCES promo_submission(id),
  payer_id TEXT NOT NULL REFERENCES principal(id),
  recipient_id TEXT NOT NULL REFERENCES principal(id),
  share_pct INTEGER CHECK (share_pct IS NULL OR share_pct BETWEEN 1 AND 100),
  credits INTEGER NOT NULL CHECK (credits >= 0),
  cosmetic_id TEXT,
  season TEXT NOT NULL,
  pair_counted INTEGER NOT NULL CHECK (pair_counted IN (0, 1)),
  flagged INTEGER NOT NULL CHECK (flagged IN (0, 1)),
  created_at TEXT NOT NULL,
  CHECK (payer_id != recipient_id),
  CHECK ((answer_id IS NULL) != (submission_id IS NULL))
) STRICT;
CREATE INDEX bounty_award_pair ON bounty_award(season, payer_id, recipient_id);
CREATE INDEX bounty_award_by_bounty ON bounty_award(bounty_id);
CREATE INDEX bounty_award_by_recipient ON bounty_award(recipient_id, created_at);
CREATE TRIGGER bounty_award_no_update BEFORE UPDATE ON bounty_award
BEGIN SELECT RAISE(ABORT, 'bounty_award is append-only'); END;
CREATE TRIGGER bounty_award_no_delete BEFORE DELETE ON bounty_award
BEGIN SELECT RAISE(ABORT, 'bounty_award is append-only'); END;

CREATE TABLE reward_promise (
  id TEXT PRIMARY KEY,
  bounty_id TEXT NOT NULL REFERENCES bounty(id),
  task_id TEXT REFERENCES promo_task(id),
  award_id TEXT NOT NULL UNIQUE REFERENCES bounty_award(id),
  promiser_id TEXT NOT NULL REFERENCES principal(id),
  recipient_id TEXT NOT NULL REFERENCES principal(id),
  note TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('owed', 'confirmed', 'disputed')),
  reason_code TEXT,
  created_at TEXT NOT NULL,
  responded_at TEXT
) STRICT;
CREATE INDEX reward_promise_by_recipient ON reward_promise(recipient_id, status);
CREATE INDEX reward_promise_by_promiser ON reward_promise(promiser_id, status);

CREATE TABLE bounty_useful_mark (
  object_id TEXT NOT NULL REFERENCES object_head(id),
  marker_id TEXT NOT NULL REFERENCES principal(id),
  marked_at TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('content', 'ledger')),
  removed_at TEXT,
  PRIMARY KEY (object_id, marker_id)
) STRICT, WITHOUT ROWID;

CREATE TABLE bounty_promo_rule (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  pattern TEXT NOT NULL,
  message TEXT NOT NULL,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  version INTEGER NOT NULL DEFAULT 1,
  position INTEGER NOT NULL DEFAULT 100,
  updated_at TEXT NOT NULL,
  updated_by TEXT REFERENCES principal(id)
) STRICT;

CREATE TABLE bounty_rule_change (
  id TEXT PRIMARY KEY,
  rule_id TEXT NOT NULL REFERENCES bounty_promo_rule(id),
  version INTEGER NOT NULL,
  pattern TEXT NOT NULL,
  message TEXT NOT NULL,
  enabled INTEGER NOT NULL,
  reason_code TEXT NOT NULL,
  changed_by TEXT REFERENCES principal(id),
  changed_at TEXT NOT NULL,
  UNIQUE (rule_id, version)
) STRICT;
CREATE TRIGGER bounty_rule_change_no_update BEFORE UPDATE ON bounty_rule_change
BEGIN SELECT RAISE(ABORT, 'bounty_rule_change is append-only'); END;
CREATE TRIGGER bounty_rule_change_no_delete BEFORE DELETE ON bounty_rule_change
BEGIN SELECT RAISE(ABORT, 'bounty_rule_change is append-only'); END;

INSERT INTO bounty_promo_rule (id, category, pattern, message, enabled, position, updated_at) VALUES
  ('no-like', 'engagement', '点赞|点个赞|求赞|赞一下|给个赞|一键三连|三连|\blikes?\b',
   '奖励不能换点赞。买来的赞会让大家分不清好坏，请改成试用以后的真实反馈。', 1, 10, '2026-10-25T00:00:00.000000Z'),
  ('no-favorite', 'engagement', '求收藏|收藏一下|帮.{0,6}收藏|加星|\bstars?\b|⭐',
   '奖励不能换收藏或加星。收藏和 star 应该来自真的觉得有用。', 1, 20, '2026-10-25T00:00:00.000000Z'),
  ('no-follow', 'follow', '求关注|加关注|关注(我|我们|一下|下|本号|账号|公众号|频道)|互粉|涨粉|粉丝|\bfollow\b|订阅(我|我们|频道|账号)',
   '奖励不能换关注或订阅。关注应该来自对内容的兴趣。', 1, 30, '2026-10-25T00:00:00.000000Z'),
  ('no-share', 'engagement', '转发|分享到|朋友圈|扩散|帮忙宣传|\bretweet\b|\brepost\b',
   '奖励不能换转发或分享。传播要靠东西本身好。', 1, 40, '2026-10-25T00:00:00.000000Z'),
  ('no-vote', 'engagement', '投票|拉票|打榜|\bupvotes?\b|\bvotes?\b',
   '奖励不能换投票或打榜。', 1, 50, '2026-10-25T00:00:00.000000Z'),
  ('no-offsite-review', 'offsite', '好评|五星|5 ?星|刷分|应用商店|app ?store|商店评论|product ?hunt|豆瓣评分',
   '不能用奖励换站外好评或评分。站外的评价必须是自发的，买来的好评也违反那些平台的规则。', 1, 60, '2026-10-25T00:00:00.000000Z'),
  ('no-traffic', 'offsite', '刷量|刷单|刷榜|刷阅读|刷播放|刷数据|引流|拉新|邀请.{0,8}注册|下载量|播放量|阅读量',
   '不能要求刷量、拉新或站外引流。任务只能是你本人试用以后给出的反馈。', 1, 70, '2026-10-25T00:00:00.000000Z'),
  ('no-contact', 'contact', '微信|\bvx\b|\bwx\b|加群|\bqq\b|手机号|电话|私聊|私信我|telegram|\btg\b',
   '任务说明里不留联系方式。提交和沟通都在站内完成，出了问题才能申诉。', 1, 80, '2026-10-25T00:00:00.000000Z');

INSERT INTO bounty_rule_change (id, rule_id, version, pattern, message, enabled, reason_code, changed_by, changed_at)
SELECT 'seed-' || id, id, 1, pattern, message, enabled, 'seed', NULL, updated_at FROM bounty_promo_rule;

INSERT OR IGNORE INTO action_rule (action, min_level, roles, owner_only, require_totp, flag, note, updated_at) VALUES
  ('bounty.create.help', 2, '[]', 0, 0, 'bounty.enabled', 'L2 起发求助悬赏（单个封顶按等级）', '2026-10-25T00:00:00.000000Z'),
  ('bounty.create.promo', 2, '[]', 0, 0, 'bounty.promo.enabled', 'L2 起发推广帖，每人每周 1 条', '2026-10-25T00:00:00.000000Z'),
  ('bounty.topup', 2, '[]', 0, 0, 'bounty.enabled', 'L2 起追加悬赏', '2026-10-25T00:00:00.000000Z'),
  ('bounty.award', 1, '[]', 1, 0, 'bounty.enabled', '发起人本人采纳并发奖', '2026-10-25T00:00:00.000000Z'),
  ('bounty.promo.task', 2, '[]', 1, 0, 'bounty.promo.enabled', '发起人本人给推广帖挂试用任务', '2026-10-25T00:00:00.000000Z'),
  ('bounty.promo.submit', 1, '[]', 0, 0, 'bounty.promo.enabled', 'L1 起提交试用反馈', '2026-10-25T00:00:00.000000Z'),
  ('bounty.promo.review', 1, '[]', 1, 0, 'bounty.promo.enabled', '发起人本人验收提交', '2026-10-25T00:00:00.000000Z'),
  ('bounty.promise.respond', 1, '[]', 0, 0, 'bounty.enabled', '领奖人确认收到或申诉自备权益', '2026-10-25T00:00:00.000000Z'),
  ('bounty.rules.edit', NULL, '["admin", "governor"]', 0, 1, NULL, '治理员调整推广任务拒绝规则', '2026-10-25T00:00:00.000000Z');

INSERT OR IGNORE INTO feature_flag (key, enabled, description, updated_at) VALUES
  ('bounty.enabled', 0, '求助悬赏与积分（不涉及现金；等 Sun 确认规则后打开）', '2026-10-25T00:00:00.000000Z'),
  ('bounty.promo.enabled', 0, '推广帖与试用任务（只收实质反馈；等 Sun 确认规则后打开）', '2026-10-25T00:00:00.000000Z');
