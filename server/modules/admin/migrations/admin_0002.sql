-- ADMIN-2: operations console. Adjustable parameter table with append-only version history,
-- plus read/write rules for the console endpoints mounted on admin_router (/api/admin/admin/*).

CREATE TABLE admin_param (
  namespace TEXT NOT NULL CHECK (length(namespace) BETWEEN 2 AND 32),
  key TEXT NOT NULL CHECK (length(key) BETWEEN 2 AND 64),
  value INTEGER NOT NULL,
  default_value INTEGER NOT NULL,
  min_value INTEGER NOT NULL,
  max_value INTEGER NOT NULL,
  unit TEXT NOT NULL DEFAULT '',
  label TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  risk TEXT NOT NULL DEFAULT 'normal' CHECK (risk IN ('normal', 'high')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  updated_at TEXT NOT NULL,
  updated_by TEXT REFERENCES principal(id),
  PRIMARY KEY (namespace, key),
  CHECK (min_value <= max_value),
  CHECK (default_value BETWEEN min_value AND max_value),
  CHECK (value BETWEEN min_value AND max_value)
) STRICT, WITHOUT ROWID;

CREATE TABLE admin_param_version (
  namespace TEXT NOT NULL,
  key TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  value INTEGER NOT NULL,
  previous_value INTEGER,
  kind TEXT NOT NULL CHECK (kind IN ('seed', 'set', 'rollback')),
  rollback_of INTEGER,
  effective_at TEXT NOT NULL,
  reason TEXT NOT NULL,
  actor_id TEXT REFERENCES principal(id),
  request_id TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (namespace, key, version),
  FOREIGN KEY (namespace, key) REFERENCES admin_param(namespace, key)
) STRICT, WITHOUT ROWID;
CREATE INDEX admin_param_version_effective ON admin_param_version(namespace, key, effective_at);

CREATE TRIGGER admin_param_version_no_update BEFORE UPDATE ON admin_param_version
BEGIN SELECT RAISE(ABORT, 'admin_param_version is append-only'); END;
CREATE TRIGGER admin_param_version_no_delete BEFORE DELETE ON admin_param_version
BEGIN SELECT RAISE(ABORT, 'admin_param_version is append-only'); END;

-- Defaults mirror the constants the owning modules ship with today; a module only follows the
-- table once it reads through modules.admin.params.value() and calls params.declare().
INSERT INTO admin_param
  (namespace, key, value, default_value, min_value, max_value, unit, label, description, risk, version, updated_at) VALUES
  ('economy', 'daily_credit_cap', 300, 300, 0, 2000, '竹子/天', '每日获得上限', '每人每天最多获得的竹子', 'high', 1, '2026-10-25T00:00:00.000000Z'),
  ('economy', 'new_account_days', 7, 7, 0, 30, '天', '新号减半期', '注册后这些天内获得上限减半', 'normal', 1, '2026-10-25T00:00:00.000000Z'),
  ('farm', 'steal_daily_limit', 20, 20, 0, 50, '次/天', '每日偷菜上限', '每人每天最多偷菜次数', 'normal', 1, '2026-10-25T00:00:00.000000Z'),
  ('farm', 'steal_percent', 10, 10, 1, 30, '%', '单次偷取比例', '每次最多偷走成熟作物的比例', 'normal', 1, '2026-10-25T00:00:00.000000Z'),
  ('farm', 'min_owner_percent', 70, 70, 50, 95, '%', '主人保底比例', '无论被偷几次，主人至少留下的比例', 'normal', 1, '2026-10-25T00:00:00.000000Z'),
  ('farm', 'steal_limit_per_cycle', 2, 2, 0, 5, '次', '每茬被偷上限', '每块成熟作物最多被偷次数', 'normal', 1, '2026-10-25T00:00:00.000000Z'),
  ('farm', 'help_daily_limit', 10, 10, 0, 50, '次/天', '每日帮忙上限', '每人每天帮好友浇水除虫的次数', 'normal', 1, '2026-10-25T00:00:00.000000Z'),
  ('farm', 'watchdog_hours', 8, 8, 1, 24, '小时', '熊猫看门时长', '看门道具一次的保护时长', 'normal', 1, '2026-10-25T00:00:00.000000Z'),
  ('parking', 'max_hours', 12, 12, 1, 24, '小时', '收益封顶时长', '一次停车最多计算的小时数', 'normal', 1, '2026-10-25T00:00:00.000000Z'),
  ('parking', 'max_rate', 12, 12, 1, 50, '竹子/小时', '车位每小时收益上限', '任何车型每小时收益的封顶值', 'high', 1, '2026-10-25T00:00:00.000000Z'),
  ('parking', 'daily_tickets', 10, 10, 0, 30, '次/天', '每日贴条上限', '每位车位主人每天最多贴条次数', 'normal', 1, '2026-10-25T00:00:00.000000Z'),
  ('games', 'exam_questions', 10, 10, 5, 30, '题', '模拟考题量', '每场模拟考抽取的题数', 'normal', 1, '2026-10-25T00:00:00.000000Z'),
  ('games', 'exam_seconds', 600, 600, 300, 3600, '秒', '模拟考时限', '每场模拟考的作答时长', 'normal', 1, '2026-10-25T00:00:00.000000Z'),
  ('games', 'sofa_reward', 3, 3, 0, 20, '竹子', '抢沙发奖励', '新帖前三个有效回复各得的竹子', 'high', 1, '2026-10-25T00:00:00.000000Z'),
  ('games', 'sofa_daily_limit', 5, 5, 0, 20, '次/天', '抢沙发每日上限', '每人每天最多领取沙发奖励的次数', 'normal', 1, '2026-10-25T00:00:00.000000Z'),
  ('events', 'daily_votes', 3, 3, 1, 10, '票/天', '打榜每日票数', '每人每天可投票数', 'normal', 1, '2026-10-25T00:00:00.000000Z'),
  ('events', 'new_account_days', 7, 7, 0, 30, '天', '新号票权减半期', '注册后这些天内票权减半', 'normal', 1, '2026-10-25T00:00:00.000000Z'),
  ('events', 'burst_votes', 3, 3, 2, 20, '票', '集中投票阈值', '一分钟内超过这个票数记为异常', 'normal', 1, '2026-10-25T00:00:00.000000Z'),
  ('market', 'l1_daily_listings', 1, 1, 0, 10, '条/天', 'L1 每日发布上限', '一级成员每天最多发布的条数', 'normal', 1, '2026-10-25T00:00:00.000000Z'),
  ('market', 'expire_days', 30, 30, 7, 90, '天', '自动过期天数', '发布后多少天自动过期', 'normal', 1, '2026-10-25T00:00:00.000000Z'),
  ('announce', 'ads_per_screen', 1, 1, 0, 1, '个', '每屏广告位上限', '一屏最多出现的赞助位数量', 'normal', 1, '2026-10-25T00:00:00.000000Z');

INSERT INTO admin_param_version
  (namespace, key, version, value, previous_value, kind, rollback_of, effective_at, reason, actor_id, request_id, created_at)
  SELECT namespace, key, 1, value, NULL, 'seed', NULL, updated_at, '初始值', NULL, NULL, updated_at FROM admin_param;

INSERT OR IGNORE INTO action_rule
  (action, min_level, roles, owner_only, require_totp, flag, note, updated_at) VALUES
  ('admin_console.overview', NULL, '["admin", "governor"]', 0, 0, NULL,
   'Read today''s operating overview and to-do queue', '2026-10-25T00:00:00.000000Z'),
  ('admin_console.search', NULL, '["admin", "governor"]', 0, 1, NULL,
   'Global lookup across members, content, orders and events', '2026-10-25T00:00:00.000000Z'),
  ('admin_console.users.read', NULL, '["admin", "governor"]', 0, 1, NULL,
   'Browse members and open the member detail drawer', '2026-10-25T00:00:00.000000Z'),
  ('admin_console.queue.read', NULL, '["admin", "governor"]', 0, 1, NULL,
   'Read the unified review queue', '2026-10-25T00:00:00.000000Z'),
  ('admin_console.params.read', NULL, '["admin", "governor"]', 0, 1, NULL,
   'Read adjustable parameters, history and impact preview', '2026-10-25T00:00:00.000000Z'),
  ('admin_console.params.write', NULL, '["admin"]', 0, 1, NULL,
   'Change or roll back an adjustable parameter', '2026-10-25T00:00:00.000000Z'),
  ('admin_console.reason', NULL, '["admin", "governor"]', 0, 1, NULL,
   'Attach an operator reason to the audit trail', '2026-10-25T00:00:00.000000Z'),
  ('admin_console.system.read', NULL, '["admin", "governor"]', 0, 1, NULL,
   'Read flags with impact, periodic jobs, health and masked configuration', '2026-10-25T00:00:00.000000Z');
