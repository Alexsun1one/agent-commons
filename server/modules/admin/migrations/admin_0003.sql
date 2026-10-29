-- ADMIN-3: numeric rules that were not present in ADMIN-2's first 21-row seed.
-- Owning modules read these through modules.admin.params.value(); module-local tables remain fallback only.

INSERT OR IGNORE INTO admin_param
  (namespace, key, value, default_value, min_value, max_value, unit, label, description, risk, version, updated_at) VALUES
  ('economy', 'checkin_day_1', 10, 10, 0, 500, '竹子', '签到第 1 天奖励', '连续签到周期第 1 天奖励', 'normal', 1, '2026-10-25T00:00:00.000000Z'),
  ('economy', 'checkin_day_2', 15, 15, 0, 500, '竹子', '签到第 2 天奖励', '连续签到周期第 2 天奖励', 'normal', 1, '2026-10-25T00:00:00.000000Z'),
  ('economy', 'checkin_day_3', 20, 20, 0, 500, '竹子', '签到第 3 天奖励', '连续签到周期第 3 天奖励', 'normal', 1, '2026-10-25T00:00:00.000000Z'),
  ('economy', 'checkin_day_4', 25, 25, 0, 500, '竹子', '签到第 4 天奖励', '连续签到周期第 4 天奖励', 'normal', 1, '2026-10-25T00:00:00.000000Z'),
  ('economy', 'checkin_day_5', 30, 30, 0, 500, '竹子', '签到第 5 天奖励', '连续签到周期第 5 天奖励', 'normal', 1, '2026-10-25T00:00:00.000000Z'),
  ('economy', 'checkin_day_6', 40, 40, 0, 500, '竹子', '签到第 6 天奖励', '连续签到周期第 6 天奖励', 'normal', 1, '2026-10-25T00:00:00.000000Z'),
  ('economy', 'checkin_day_7', 80, 80, 0, 500, '竹子', '签到第 7 天奖励', '连续签到周期第 7 天奖励', 'high', 1, '2026-10-25T00:00:00.000000Z'),
  ('parking', 'ticket_fine_percent', 50, 50, 0, 100, '%', '贴条罚金比例', '贴条时罚没当前累计收益的比例', 'high', 1, '2026-10-25T00:00:00.000000Z'),
  ('bounty', 'minimum_credits', 5, 5, 1, 1000, '积分', '悬赏最低积分', '求助悬赏至少托管的积分', 'normal', 1, '2026-10-25T00:00:00.000000Z');

INSERT OR IGNORE INTO admin_param_version
  (namespace, key, version, value, previous_value, kind, rollback_of, effective_at, reason, actor_id, request_id, created_at)
  SELECT namespace, key, 1, value, NULL, 'seed', NULL, updated_at, '初始值', NULL, NULL, updated_at
  FROM admin_param
  WHERE (namespace = 'economy' AND key LIKE 'checkin_day_%')
     OR (namespace = 'parking' AND key = 'ticket_fine_percent')
     OR (namespace = 'bounty' AND key = 'minimum_credits');
