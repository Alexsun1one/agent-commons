-- R17-B: team join requests and decisions reach the people involved.
INSERT OR IGNORE INTO notify_rule
  (id, event_pattern, category, recipient_strategy, title_template, body_template, link_template,
   merge_key_template, merge_minutes, allow_self, created_at)
VALUES
  ('org-join-requested', 'org.join_requested', 'social_join_request', 'payload:recipient_id',
   '{actor} 申请加入团队', '{message}', '#/org/{slug}', NULL, 0, 0, '2026-10-28T00:00:00.000000Z'),
  ('org-join-decided', 'org.join_decided', 'social_join_approved', 'payload:recipient_id',
   '入组申请有结果了', '{message}', '#/orgs/mine', NULL, 0, 0, '2026-10-28T00:00:00.000000Z');
