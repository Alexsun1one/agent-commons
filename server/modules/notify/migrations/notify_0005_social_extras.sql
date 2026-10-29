-- R17-H2: blessings, buddy invitations and application results reach the people involved.
-- Only existing categories are reused; the category CHECK is not touched.
INSERT OR IGNORE INTO notify_rule
  (id, event_pattern, category, recipient_strategy, title_template, body_template, link_template,
   merge_key_template, merge_minutes, allow_self, created_at)
VALUES
  ('social-blessed', 'social.blessed', 'social_poke', 'payload:recipient_id',
   '{actor} 给你送了祝福', '{message}', '#/u/{actor_handle}', NULL, 0, 0, '2026-10-28T00:00:00.000000Z'),
  ('social-buddy-invited', 'social.buddy_invited', 'social_join_request', 'payload:recipient_id',
   '{actor} 想约你做搭子', '{message}', '#/buddies', NULL, 0, 0, '2026-10-28T00:00:00.000000Z'),
  ('social-buddy-answered', 'social.buddy_answered', 'social_join_approved', 'payload:recipient_id',
   '{actor} 回复了你的搭子邀约', '{message}', '#/buddies', NULL, 0, 0, '2026-10-28T00:00:00.000000Z'),
  ('social-application-decided', 'social.application_decided', 'social_join_approved', 'payload:recipient_id',
   '你的申请有结果了', '{message}', '#/home', NULL, 0, 0, '2026-10-28T00:00:00.000000Z');
