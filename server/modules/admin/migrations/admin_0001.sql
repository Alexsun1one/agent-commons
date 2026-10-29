-- ADMIN-1 only adds read permissions for the management console.
INSERT OR IGNORE INTO action_rule
  (action, min_level, roles, owner_only, require_totp, flag, note, updated_at) VALUES
  ('admin_console.metrics', NULL, '["admin", "governor"]', 0, 0, NULL,
   'Read aggregate community health metrics', '2026-10-25T00:00:00.000000Z'),
  ('admin_console.flags.read', NULL, '["admin", "governor"]', 0, 0, NULL,
   'Read feature flag catalogue', '2026-10-25T00:00:00.000000Z'),
  ('admin_console.invites.read', NULL, '["admin", "governor"]', 0, 1, NULL,
   'Read invite codes and invite relationships', '2026-10-25T00:00:00.000000Z'),
  ('admin_console.audit.read', NULL, '["admin", "governor"]', 0, 1, NULL,
   'Browse append-only audit events', '2026-10-25T00:00:00.000000Z');
