-- R13 BIZ-1 · 会员方案、权益映射、订阅状态机、订单、候补名单。
-- 不接任何真实支付：billing.payments 默认关，支付渠道默认 disabled。
-- billing_entitlement.benefit_key 引用 membership_benefit.key（按值引用，不建外键：
-- 迁移按模块名排序，billing 先于 membership 执行；一致性由测试保证）。

CREATE TABLE billing_plan (
  key TEXT PRIMARY KEY CHECK (key GLOB '[a-z][a-z0-9_]*'),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 20),
  tagline TEXT NOT NULL CHECK (length(tagline) BETWEEN 1 AND 40),
  scope TEXT NOT NULL CHECK (scope IN ('personal', 'team')),
  per_seat INTEGER NOT NULL DEFAULT 0 CHECK (per_seat IN (0, 1)),
  min_seats INTEGER NOT NULL DEFAULT 1 CHECK (min_seats BETWEEN 1 AND 500),
  price_month_fen INTEGER NOT NULL CHECK (price_month_fen >= 0),
  price_year_fen INTEGER NOT NULL CHECK (price_year_fen >= 0),
  currency TEXT NOT NULL DEFAULT 'CNY' CHECK (currency = 'CNY'),
  price_status TEXT NOT NULL DEFAULT 'draft' CHECK (price_status IN ('draft', 'approved')),
  sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
) STRICT;

CREATE TABLE billing_entitlement (
  plan_key TEXT NOT NULL REFERENCES billing_plan(key) ON DELETE CASCADE,
  benefit_key TEXT NOT NULL CHECK (benefit_key GLOB '[a-z][a-z0-9_]*'),
  mode TEXT NOT NULL DEFAULT 'bonus' CHECK (mode = 'bonus'),
  amount INTEGER NOT NULL CHECK (amount > 0),
  PRIMARY KEY (plan_key, benefit_key)
) STRICT;

CREATE TABLE billing_perk (
  plan_key TEXT NOT NULL REFERENCES billing_plan(key) ON DELETE CASCADE,
  perk_key TEXT NOT NULL CHECK (perk_key GLOB '[a-z][a-z0-9_]*'),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 20),
  description TEXT NOT NULL CHECK (length(description) BETWEEN 1 AND 80),
  sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
  PRIMARY KEY (plan_key, perk_key)
) STRICT;

CREATE TABLE billing_subscription (
  id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL REFERENCES principal(id) ON DELETE CASCADE,
  plan_key TEXT NOT NULL REFERENCES billing_plan(key),
  cycle TEXT NOT NULL CHECK (cycle IN ('month', 'year')),
  seats INTEGER NOT NULL DEFAULT 1 CHECK (seats BETWEEN 1 AND 500),
  state TEXT NOT NULL CHECK (state IN ('waitlist', 'trial', 'active', 'expired', 'canceled')),
  source TEXT NOT NULL CHECK (source IN ('admin', 'payment')),
  period_start TEXT,
  period_end TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (state IN ('waitlist', 'canceled') OR period_end IS NOT NULL)
) STRICT;
-- 每人同时只有一条「候补 / 试用 / 生效」的订阅
CREATE UNIQUE INDEX billing_subscription_one_open
  ON billing_subscription(principal_id) WHERE state IN ('waitlist', 'trial', 'active');
CREATE INDEX billing_subscription_due ON billing_subscription(state, period_end);

-- 状态变化流水：只追加，禁止改；注销清理时随订阅一起删
CREATE TABLE billing_subscription_event (
  id TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL REFERENCES billing_subscription(id) ON DELETE CASCADE,
  from_state TEXT CHECK (from_state IS NULL OR from_state IN ('waitlist', 'trial', 'active', 'expired', 'canceled')),
  to_state TEXT NOT NULL CHECK (to_state IN ('waitlist', 'trial', 'active', 'expired', 'canceled')),
  reason TEXT NOT NULL CHECK (reason GLOB '[a-z][a-z_.]*'),
  actor_id TEXT,
  order_id TEXT,
  at TEXT NOT NULL
) STRICT;
CREATE INDEX billing_subscription_event_by_sub ON billing_subscription_event(subscription_id, at);
CREATE TRIGGER billing_subscription_event_no_update BEFORE UPDATE ON billing_subscription_event
BEGIN
  SELECT RAISE(ABORT, 'billing_subscription_event is append-only');
END;

CREATE TABLE billing_order (
  id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL REFERENCES principal(id),
  plan_key TEXT NOT NULL REFERENCES billing_plan(key),
  cycle TEXT NOT NULL CHECK (cycle IN ('month', 'year')),
  seats INTEGER NOT NULL DEFAULT 1 CHECK (seats BETWEEN 1 AND 500),
  amount_fen INTEGER NOT NULL CHECK (amount_fen >= 0),
  currency TEXT NOT NULL DEFAULT 'CNY' CHECK (currency = 'CNY'),
  provider TEXT NOT NULL CHECK (provider GLOB '[a-z][a-z0-9_]*'),
  provider_ref TEXT CHECK (provider_ref IS NULL OR length(provider_ref) BETWEEN 1 AND 128),
  state TEXT NOT NULL CHECK (state IN ('created', 'pending', 'paid', 'failed', 'canceled', 'refunded')),
  subscription_id TEXT REFERENCES billing_subscription(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX billing_order_by_principal ON billing_order(principal_id, created_at);
CREATE INDEX billing_order_by_state ON billing_order(state, created_at);

-- 候补名单（意向）：同一人同一方案只有一行，重复加入只更新周期和席位；不存联系方式和自由文本
CREATE TABLE billing_waitlist (
  id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL REFERENCES principal(id) ON DELETE CASCADE,
  plan_key TEXT NOT NULL REFERENCES billing_plan(key),
  cycle TEXT NOT NULL CHECK (cycle IN ('month', 'year')),
  seats INTEGER NOT NULL DEFAULT 1 CHECK (seats BETWEEN 1 AND 500),
  source TEXT NOT NULL CHECK (source IN ('pricing', 'teams', 'creator', 'sponsor', 'other')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (principal_id, plan_key)
) STRICT;
CREATE INDEX billing_waitlist_by_plan ON billing_waitlist(plan_key, created_at);

CREATE TABLE billing_config (
  key TEXT PRIMARY KEY CHECK (key IN ('payments.provider', 'waitlist.per_hour', 'trial.max_days')),
  value TEXT NOT NULL CHECK (length(value) BETWEEN 1 AND 40),
  updated_at TEXT NOT NULL
) STRICT;

INSERT INTO billing_config (key, value, updated_at) VALUES
  ('payments.provider', 'disabled', '2026-10-25T00:00:00.000000Z'),
  ('waitlist.per_hour', '10', '2026-10-25T00:00:00.000000Z'),
  ('trial.max_days', '90', '2026-10-25T00:00:00.000000Z');

-- 价格全部是拟定（price_status = draft），金额单位为分
INSERT INTO billing_plan
  (key, name, tagline, scope, per_seat, min_seats, price_month_fen, price_year_fen, price_status, sort_order)
VALUES
  ('free', '免费', '社区的知识、讨论、讲堂和乐园', 'personal', 0, 1, 0, 0, 'draft', 10),
  ('pioneer', '先锋会员', '更多额度、会员圆桌、关掉赞助位', 'personal', 0, 1, 3900, 39000, 'draft', 20),
  ('team', '团队空间', '私有知识库和 Agent 席位', 'team', 1, 5, 9900, 99000, 'draft', 30);

-- 只在等级已解锁的能力上加额度；stage_rooms、member_invites 永远不加
INSERT INTO billing_entitlement (plan_key, benefit_key, mode, amount) VALUES
  ('pioneer', 'upload_megabytes', 'bonus', 10240),
  ('pioneer', 'agent_slots', 'bonus', 2),
  ('pioneer', 'discussion_rooms', 'bonus', 4),
  ('team', 'upload_megabytes', 'bonus', 20480),
  ('team', 'agent_slots', 'bonus', 4),
  ('team', 'discussion_rooms', 'bonus', 8);

INSERT INTO billing_perk (plan_key, perk_key, name, description, sort_order) VALUES
  ('pioneer', 'ai_quota', 'AI 助手额度', '翻译、会后纪要和个人简报每月更多次，次数随 AI 网关预算定', 10),
  ('pioneer', 'ad_free', '关闭赞助位', '账号里一键关掉全站赞助位', 20),
  ('pioneer', 'salon', '会员圆桌', '每月一场线上圆桌', 30),
  ('pioneer', 'cosmetics', '会员装扮', '每季一套限定头像框和熊猫配色，到期保留', 40),
  ('pioneer', 'early_signup', '工作坊提前报名', '比公开报名早 24 小时', 50),
  ('team', 'private_space', '私有知识库', '问题卡和知识卡只在团队内可见，也能搜社区公开内容', 10),
  ('team', 'team_agents', '团队 Agent', '团队 Agent 经 MCP 读团队库', 20),
  ('team', 'team_admin', '成员管理', '邀请、角色、离队交接', 30),
  ('team', 'team_export', '团队数据导出', 'Markdown 与 JSON，随时导出', 40),
  ('team', 'invoice', '对公发票', '对公转账，开具发票', 50),
  ('team', 'ai_quota', 'AI 助手额度', '每席同先锋会员', 60),
  ('team', 'ad_free', '关闭赞助位', '每席同先锋会员', 70),
  ('team', 'salon', '会员圆桌', '每席同先锋会员', 80),
  ('team', 'cosmetics', '会员装扮', '每席同先锋会员', 90);

INSERT OR IGNORE INTO action_rule
  (action, min_level, roles, owner_only, require_totp, flag, note, updated_at)
VALUES
  ('billing.waitlist.join', 1, '[]', 0, 0, 'billing.enabled', '加入会员方案候补名单；不扣款', '2026-10-25T00:00:00.000000Z'),
  ('billing.me.read', 1, '[]', 0, 0, 'billing.enabled', '查看自己的方案、候补、订单与有效额度', '2026-10-25T00:00:00.000000Z'),
  ('billing.order.create', 1, '[]', 0, 0, 'billing.payments', '下单付款；支付开关默认关', '2026-10-25T00:00:00.000000Z'),
  ('billing.subscription.cancel', 1, '[]', 0, 0, 'billing.enabled', '取消自己的订阅；当期权益保留到期末', '2026-10-25T00:00:00.000000Z'),
  ('billing.admin.read', NULL, '["admin"]', 0, 1, 'billing.enabled', '查看候补、订阅与订单分布', '2026-10-25T00:00:00.000000Z'),
  ('billing.admin.manage', NULL, '["admin"]', 0, 1, 'billing.enabled', '发试用、按状态机改订阅；不能手动设为生效', '2026-10-25T00:00:00.000000Z');

INSERT OR IGNORE INTO feature_flag (key, enabled, description, updated_at) VALUES
  ('billing.enabled', 1, '会员方案、候补名单与试用；不收款', '2026-10-25T00:00:00.000000Z'),
  ('billing.payments', 0, '支付总开关；默认关，开之前需 Sun 批准并接入支付渠道', '2026-10-25T00:00:00.000000Z');
