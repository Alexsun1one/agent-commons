-- LG-2: business switch; export, download and deletion stay available.
INSERT OR IGNORE INTO feature_flag (key, enabled, description, updated_at) VALUES
  ('account.avatar.enabled', 1, '设置与清除头像；不阻断账号导出和注销', '2026-10-27T00:00:00.000000Z');

UPDATE action_rule SET flag = 'account.avatar.enabled'
WHERE action = 'account.avatar.set';
