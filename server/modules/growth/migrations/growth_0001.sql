-- GROW-1 · 等级引擎、贡献流水元数据、赛季、Token 自报
-- 只动 growth_* 表和 growth.* 动作规则；其他模块的 action_rule 行一概不碰。

CREATE TABLE growth_rule (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT REFERENCES principal(id)
) STRICT;

CREATE TABLE growth_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;

CREATE TABLE growth_season (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT REFERENCES principal(id),
  CHECK (starts_at < ends_at)
) STRICT;
CREATE INDEX growth_season_by_time ON growth_season(starts_at, ends_at);

CREATE TABLE growth_state (
  principal_id TEXT PRIMARY KEY REFERENCES principal(id),
  opted_out INTEGER NOT NULL DEFAULT 0 CHECK (opted_out IN (0, 1)),
  cooldown_until TEXT,
  demoted_from INTEGER,
  demotion_entry_id TEXT,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE growth_activity (
  principal_id TEXT NOT NULL REFERENCES principal(id),
  day TEXT NOT NULL,
  PRIMARY KEY (principal_id, day)
) STRICT, WITHOUT ROWID;

CREATE TABLE growth_counter (
  principal_id TEXT NOT NULL REFERENCES principal(id),
  key TEXT NOT NULL,
  value INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (principal_id, key)
) STRICT, WITHOUT ROWID;

CREATE TABLE growth_entry_meta (
  entry_id TEXT PRIMARY KEY REFERENCES ledger_entry(id),
  event TEXT NOT NULL,
  subject_id TEXT NOT NULL REFERENCES principal(id),
  counterparty_id TEXT REFERENCES principal(id),
  season TEXT,
  base_points INTEGER NOT NULL,
  discount_factor REAL NOT NULL DEFAULT 1.0,
  discount_why TEXT,
  weight REAL NOT NULL DEFAULT 1.0,
  reason TEXT NOT NULL,
  confirmer_level INTEGER
) STRICT;
CREATE INDEX growth_meta_pair ON growth_entry_meta(event, subject_id, counterparty_id, season);

CREATE TABLE growth_review (
  id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL REFERENCES principal(id),
  target_level INTEGER NOT NULL CHECK (target_level BETWEEN 2 AND 5),
  state TEXT NOT NULL CHECK (state IN ('pending', 'approved', 'rejected')),
  snapshot_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  decided_by TEXT REFERENCES principal(id),
  decided_at TEXT,
  reason_code TEXT
) STRICT;
CREATE UNIQUE INDEX growth_review_one_pending ON growth_review(principal_id, target_level) WHERE state = 'pending';

CREATE TABLE growth_token_report (
  principal_id TEXT NOT NULL REFERENCES principal(id),
  season_id TEXT NOT NULL REFERENCES growth_season(id),
  family TEXT NOT NULL,
  band TEXT NOT NULL,
  trust TEXT NOT NULL DEFAULT 'self' CHECK (trust IN ('self', 'gateway')),
  from_file INTEGER NOT NULL DEFAULT 0 CHECK (from_file IN (0, 1)),
  reported_at TEXT NOT NULL,
  PRIMARY KEY (principal_id, season_id)
) STRICT, WITHOUT ROWID;

INSERT INTO growth_rule (key, value_json, updated_at) VALUES
  ('points.adopted', '20', '2026-10-25T00:00:00.000000Z'),
  ('points.useful', '5', '2026-10-25T00:00:00.000000Z'),
  ('points.reproduced', '30', '2026-10-25T00:00:00.000000Z'),
  ('points.host', '15', '2026-10-25T00:00:00.000000Z'),
  ('points.curate', '10', '2026-10-25T00:00:00.000000Z'),
  ('points.report', '3', '2026-10-25T00:00:00.000000Z'),
  ('points.violation', '-50', '2026-10-25T00:00:00.000000Z'),
  ('useful.min_giver_level', '2', '2026-10-25T00:00:00.000000Z'),
  ('useful.min_account_days', '7', '2026-10-25T00:00:00.000000Z'),
  ('useful.daily_cap_points', '30', '2026-10-25T00:00:00.000000Z'),
  ('useful.pair_daily_cap', '2', '2026-10-25T00:00:00.000000Z'),
  ('useful.mutual_factor', '0.5', '2026-10-25T00:00:00.000000Z'),
  ('useful.weight_max', '1.5', '2026-10-25T00:00:00.000000Z'),
  ('useful.weights', '{"2": 1.0, "3": 1.2, "4": 1.35, "5": 1.5}', '2026-10-25T00:00:00.000000Z'),
  ('confirm.min_level', '3', '2026-10-25T00:00:00.000000Z'),
  ('confirm.pair_season_cap', '2', '2026-10-25T00:00:00.000000Z'),
  ('host.min_participants', '5', '2026-10-25T00:00:00.000000Z'),
  ('host.min_minutes', '10', '2026-10-25T00:00:00.000000Z'),
  ('host.daily_cap', '2', '2026-10-25T00:00:00.000000Z'),
  ('l2.account_days', '7', '2026-10-25T00:00:00.000000Z'),
  ('l2.active_days', '5', '2026-10-25T00:00:00.000000Z'),
  ('l2.useful_received', '3', '2026-10-25T00:00:00.000000Z'),
  ('l2alt.useful_received', '5', '2026-10-25T00:00:00.000000Z'),
  ('l3.window_days', '60', '2026-10-25T00:00:00.000000Z'),
  ('l3.active_ratio', '0.5', '2026-10-25T00:00:00.000000Z'),
  ('l3.adopted', '5', '2026-10-25T00:00:00.000000Z'),
  ('l3.report_min', '10', '2026-10-25T00:00:00.000000Z'),
  ('l3.wilson_min', '0.6', '2026-10-25T00:00:00.000000Z'),
  ('l3alt.useful_received', '10', '2026-10-25T00:00:00.000000Z'),
  ('l3alt.adopted', '5', '2026-10-25T00:00:00.000000Z'),
  ('l4.days_at_l3', '30', '2026-10-25T00:00:00.000000Z'),
  ('l4.adopted', '15', '2026-10-25T00:00:00.000000Z'),
  ('l4.high_value', '3', '2026-10-25T00:00:00.000000Z'),
  ('l4.violation_free_days', '90', '2026-10-25T00:00:00.000000Z'),
  ('l4.reject_cooldown_days', '30', '2026-10-25T00:00:00.000000Z'),
  ('demote.cooldown_days', '14', '2026-10-25T00:00:00.000000Z');

INSERT OR IGNORE INTO action_rule (action, min_level, roles, owner_only, require_totp, flag, note, updated_at) VALUES
  ('growth.unlock.read', 1, '[]', 0, 0, NULL, '读成员可见内容', '2026-10-25T00:00:00.000000Z'),
  ('growth.unlock.discuss', 1, '[]', 0, 0, NULL, '发讨论和回复', '2026-10-25T00:00:00.000000Z'),
  ('growth.unlock.favorite', 1, '[]', 0, 0, NULL, '收藏', '2026-10-25T00:00:00.000000Z'),
  ('growth.unlock.report', 1, '[]', 0, 0, NULL, '举报（权重低）', '2026-10-25T00:00:00.000000Z'),
  ('growth.unlock.listen', 1, '[]', 0, 0, NULL, '进公开房间收听', '2026-10-25T00:00:00.000000Z'),
  ('growth.unlock.knowledge', 2, '[]', 0, 0, NULL, '建知识条目', '2026-10-25T00:00:00.000000Z'),
  ('growth.unlock.upload', 2, '[]', 0, 0, NULL, '上传附件和 HTML 作品', '2026-10-25T00:00:00.000000Z'),
  ('growth.unlock.hand', 2, '[]', 0, 0, NULL, '房间里举手', '2026-10-25T00:00:00.000000Z'),
  ('growth.unlock.invite', 2, '[]', 0, 0, NULL, '邀请（每月 2 个）', '2026-10-25T00:00:00.000000Z'),
  ('growth.unlock.room', 3, '[]', 0, 0, NULL, '建讨论室（≤ 20 人）', '2026-10-25T00:00:00.000000Z'),
  ('growth.unlock.suggest', 3, '[]', 0, 0, NULL, '对知识提修改建议', '2026-10-25T00:00:00.000000Z'),
  ('growth.unlock.hide', 3, '[]', 0, 0, NULL, '隐藏 L1 内容（需第二位 L3+ 同意）', '2026-10-25T00:00:00.000000Z'),
  ('growth.unlock.volunteer', 3, '[]', 0, 0, NULL, '接治理志愿队列', '2026-10-25T00:00:00.000000Z'),
  ('growth.unlock.stage', 4, '[]', 0, 0, NULL, '建舞台房', '2026-10-25T00:00:00.000000Z'),
  ('growth.unlock.curate', 4, '[]', 0, 0, NULL, '整理知识（合并、标过期）', '2026-10-25T00:00:00.000000Z'),
  ('growth.unlock.host', 4, '[]', 0, 0, NULL, '主持活动', '2026-10-25T00:00:00.000000Z'),
  ('growth.unlock.vote', 5, '[]', 0, 0, NULL, '规则修订投票', '2026-10-25T00:00:00.000000Z'),
  ('growth.unlock.appeal', 5, '[]', 0, 0, NULL, '复核申诉', '2026-10-25T00:00:00.000000Z'),
  ('growth.appoint', NULL, '["admin"]', 0, 1, 'growth.enabled', '管理员人工任命等级', '2026-10-25T00:00:00.000000Z'),
  ('growth.rules.edit', NULL, '["admin", "governor"]', 0, 1, 'growth.enabled', '改成长规则与解锁等级', '2026-10-25T00:00:00.000000Z'),
  ('growth.review.decide', NULL, '["admin", "governor"]', 0, 1, 'growth.enabled', 'L4 复核队列裁决', '2026-10-25T00:00:00.000000Z'),
  ('growth.recompute', NULL, '["admin"]', 0, 1, 'growth.enabled', '手动触发等级重算', '2026-10-25T00:00:00.000000Z'),
  ('growth.season.manage', NULL, '["admin"]', 0, 1, 'growth.enabled', '建赛季', '2026-10-25T00:00:00.000000Z');

INSERT INTO growth_meta (key, value) VALUES ('revision', '0');

INSERT INTO growth_season (id, name, starts_at, ends_at, created_at) VALUES
  ('s2026q4', '2026 冬赛季', '2026-10-01T00:00:00.000000Z', '2027-01-01T00:00:00.000000Z', '2026-10-25T00:00:00.000000Z');

INSERT OR IGNORE INTO feature_flag (key, enabled, description, updated_at) VALUES
  ('growth.enabled', 1, '等级、贡献、赛季榜、Token 榜', '2026-10-25T00:00:00.000000Z'),
  ('growth.public_ranking', 0, '公开排名（内测期默认关：榜单对非本人只返回自己那行）', '2026-10-25T00:00:00.000000Z');
