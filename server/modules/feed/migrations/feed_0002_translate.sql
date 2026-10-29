ALTER TABLE feed_item ADD COLUMN title_zh TEXT NOT NULL DEFAULT '';
ALTER TABLE feed_item ADD COLUMN summary_zh TEXT NOT NULL DEFAULT '';

INSERT OR IGNORE INTO admin_param
  (namespace, key, value, default_value, min_value, max_value, unit, label, description, risk, version, updated_at)
VALUES
  ('feed', 'translate_enabled', 0, 0, 0, 1, '开关', '热点中文化',
   '公开来源标题与短摘要经统一模型网关中文化；关闭时不调用模型', 'normal', 1,
   '2026-10-25T00:00:00.000000Z');

INSERT OR IGNORE INTO admin_param_version
  (namespace, key, version, value, previous_value, kind, rollback_of, effective_at, reason, actor_id, request_id, created_at)
VALUES
  ('feed', 'translate_enabled', 1, 0, NULL, 'seed', NULL, '2026-10-25T00:00:00.000000Z',
   '初始值', NULL, NULL, '2026-10-25T00:00:00.000000Z');
