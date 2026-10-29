-- LG-4 R4: a case-scoped review capability, not a change to general media visibility.
INSERT INTO action_rule (action, min_level, roles, owner_only, require_totp, flag, note, updated_at) VALUES
  ('gov.case.preview', NULL, '["governor","admin"]', 0, 1, 'governance.enabled',
   '按案件读取当前 HTML 作品的内容地址，每次读取审计', '2026-10-27T00:00:00.000000Z');
