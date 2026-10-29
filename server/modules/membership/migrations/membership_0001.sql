CREATE TABLE membership_benefit (
  key TEXT PRIMARY KEY CHECK (key GLOB '[a-z][a-z0-9_]*'),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  description TEXT NOT NULL CHECK (length(description) BETWEEN 1 AND 240),
  action_key TEXT CHECK (action_key IS NULL OR action_key GLOB '[a-z][a-z0-9_]*'),
  quota_unit TEXT NOT NULL CHECK (quota_unit IN ('count', 'megabyte', 'slot')),
  quota_period TEXT NOT NULL CHECK (quota_period IN ('month', 'season', 'account')),
  sort_order INTEGER NOT NULL CHECK (sort_order >= 0)
) STRICT;

CREATE TABLE membership_benefit_quota (
  benefit_key TEXT NOT NULL REFERENCES membership_benefit(key) ON DELETE CASCADE,
  level INTEGER NOT NULL CHECK (level BETWEEN 1 AND 5),
  quota INTEGER NOT NULL CHECK (quota >= 0),
  PRIMARY KEY (benefit_key, level)
) STRICT;

CREATE TABLE membership_usage (
  principal_id TEXT NOT NULL REFERENCES principal(id) ON DELETE CASCADE,
  benefit_key TEXT NOT NULL REFERENCES membership_benefit(key) ON DELETE CASCADE,
  period_key TEXT NOT NULL CHECK (length(period_key) BETWEEN 1 AND 40),
  used INTEGER NOT NULL DEFAULT 0 CHECK (used >= 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (principal_id, benefit_key, period_key)
) STRICT;
CREATE INDEX membership_usage_by_benefit_period
  ON membership_usage(benefit_key, period_key, principal_id);

INSERT INTO membership_benefit
  (key, name, description, action_key, quota_unit, quota_period, sort_order)
VALUES
  ('discussion_rooms', '讨论室', '当月可以创建的讨论室次数；进入和主持仍分别受房间权限约束。', 'room', 'count', 'month', 10),
  ('upload_megabytes', '上传额度', '本赛季可用于附件和 HTML 作品的上传容量。', 'upload', 'megabyte', 'season', 20),
  ('agent_slots', 'Agent 数量', '账号名下可展示和管理的 Agent 数量上限。', NULL, 'slot', 'account', 30),
  ('stage_rooms', '舞台房', '本赛季可以创建的舞台房次数；需要达到 GROW-1 的舞台解锁等级。', 'stage', 'count', 'season', 40),
  ('member_invites', '成员邀请', '当月可以发出的邀请数量；邀请行为仍受风控与现行动作规则约束。', 'invite', 'count', 'month', 50);

INSERT INTO membership_benefit_quota (benefit_key, level, quota) VALUES
  ('discussion_rooms', 3, 4),
  ('discussion_rooms', 4, 8),
  ('discussion_rooms', 5, 12),
  ('upload_megabytes', 2, 1024),
  ('upload_megabytes', 3, 4096),
  ('upload_megabytes', 4, 10240),
  ('upload_megabytes', 5, 20480),
  ('agent_slots', 2, 1),
  ('agent_slots', 3, 3),
  ('agent_slots', 4, 8),
  ('agent_slots', 5, 16),
  ('stage_rooms', 4, 4),
  ('stage_rooms', 5, 12),
  ('member_invites', 2, 2),
  ('member_invites', 3, 5),
  ('member_invites', 4, 12),
  ('member_invites', 5, 20);

INSERT OR IGNORE INTO action_rule
  (action, min_level, roles, owner_only, require_totp, flag, note, updated_at)
VALUES
  ('membership.benefits.read', 1, '[]', 0, 0, 'membership.enabled', '查看按等级计算的会员权益', '2026-10-25T00:00:00.000000Z'),
  ('membership.me.read', 1, '[]', 0, 0, 'membership.enabled', '查看自己的会员权益与用量；接口只按当前身份取数', '2026-10-25T00:00:00.000000Z');

INSERT OR IGNORE INTO feature_flag (key, enabled, description, updated_at) VALUES
  ('membership.enabled', 1, '会员权益与额度只建模；内测期不接支付', '2026-10-25T00:00:00.000000Z');
