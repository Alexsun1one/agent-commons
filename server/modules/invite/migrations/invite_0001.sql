-- INVITE-1 · 成员邀请额度、进度、竹子回报和异常。不改核心 invite_code / invite_edge。

CREATE TABLE invite_quota_rule (
  level INTEGER PRIMARY KEY CHECK (level BETWEEN 1 AND 5),
  monthly_quota INTEGER NOT NULL CHECK (monthly_quota >= 0),
  updated_at TEXT NOT NULL,
  updated_by TEXT REFERENCES principal(id)
) STRICT;

CREATE TABLE invite_policy (
  key TEXT PRIMARY KEY,
  value INTEGER NOT NULL CHECK (value >= 0),
  description TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT REFERENCES principal(id)
) STRICT;

CREATE TABLE member_invite (
  invite_code_id TEXT PRIMARY KEY REFERENCES invite_code(id),
  inviter_id TEXT NOT NULL REFERENCES principal(id),
  note TEXT NOT NULL DEFAULT '',
  month_key TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX member_invite_by_month ON member_invite(inviter_id, month_key, created_at);

CREATE TABLE invite_progress (
  invitee_id TEXT PRIMARY KEY REFERENCES principal(id),
  inviter_id TEXT REFERENCES principal(id),
  invite_code_id TEXT NOT NULL REFERENCES invite_code(id),
  registered_at TEXT NOT NULL,
  onboarded_at TEXT,
  first_contribution_at TEXT,
  first_contribution_kind TEXT CHECK (
    first_contribution_kind IS NULL OR first_contribution_kind IN ('useful', 'knowledge')
  )
) STRICT;
CREATE INDEX invite_progress_by_inviter ON invite_progress(inviter_id, registered_at);

CREATE TABLE invite_reward (
  idempotency_key TEXT PRIMARY KEY,
  inviter_id TEXT NOT NULL REFERENCES principal(id),
  invitee_id TEXT NOT NULL REFERENCES principal(id),
  kind TEXT NOT NULL CHECK (kind IN ('onboarding', 'first')),
  requested INTEGER NOT NULL CHECK (requested >= 0),
  actual INTEGER NOT NULL CHECK (actual >= 0),
  month_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (invitee_id, kind)
) STRICT;
CREATE INDEX invite_reward_by_month ON invite_reward(inviter_id, month_key);

CREATE TABLE invite_anomaly (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('mutual_useful', 'mutual_vote')),
  principal_id TEXT NOT NULL,
  peer_id TEXT NOT NULL,
  month_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (kind, principal_id, peer_id, month_key)
) STRICT;

INSERT INTO invite_quota_rule (level, monthly_quota, updated_at) VALUES
  (1, 0, '2026-10-25T00:00:00.000000Z'),
  (2, 1, '2026-10-25T00:00:00.000000Z'),
  (3, 3, '2026-10-25T00:00:00.000000Z'),
  (4, 5, '2026-10-25T00:00:00.000000Z'),
  (5, 10, '2026-10-25T00:00:00.000000Z');

INSERT INTO invite_policy (key, value, description, updated_at) VALUES
  ('member_bonus', 2, '付费会员（试用、生效或当期未结束的取消）额外邀请个数；L1 不加', '2026-10-25T00:00:00.000000Z'),
  ('ttl_days', 7, '成员邀请码有效天数', '2026-10-25T00:00:00.000000Z'),
  ('note_max', 60, '邀请附言最长字数', '2026-10-25T00:00:00.000000Z'),
  ('reward_onboarding', 20, '被邀请人完成新人引导，邀请人得到的竹子', '2026-10-25T00:00:00.000000Z'),
  ('reward_first', 50, '被邀请人第一次被采纳或发布第一张知识卡，邀请人再得到的竹子', '2026-10-25T00:00:00.000000Z'),
  ('reward_monthly_extra', 400, '本模块月上限附加值；实际月上限 = ECON 日上限 + 本值', '2026-10-25T00:00:00.000000Z'),
  ('inactive_days', 7, '连续多少天没有会话、发内容或标有用，算不活跃', '2026-10-25T00:00:00.000000Z');

INSERT OR IGNORE INTO action_rule
  (action, min_level, roles, owner_only, require_totp, flag, note, updated_at)
VALUES
  ('invite.me.read', 1, '[]', 0, 0, 'invite.enabled', '看自己的邀请额度和带来的人', '2026-10-25T00:00:00.000000Z'),
  ('invite.issue', 1, '[]', 0, 0, 'invite.enabled', '发一次性个人邀请；L1 默认额度为 0', '2026-10-25T00:00:00.000000Z'),
  ('invite.onboarding', 1, '[]', 0, 0, 'invite.enabled', '被邀请人标记新人引导已完成', '2026-10-25T00:00:00.000000Z'),
  ('invite.admin', NULL, '["admin"]', 0, 1, 'invite.enabled', '调整邀请额度和回报规则', '2026-10-25T00:00:00.000000Z');

INSERT OR IGNORE INTO feature_flag (key, enabled, description, updated_at) VALUES
  ('invite.enabled', 1, '成员邀请：额度、个人链接、竹子回报', '2026-10-25T00:00:00.000000Z');
