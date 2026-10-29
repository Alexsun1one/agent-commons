-- R17-R3b：投稿审核结果通知作者。只复用已有的 governance 类别，不重建规则表。
-- 模式比已有的 governance.* 更长，所以优先命中，不会并进通用治理通知。
INSERT OR IGNORE INTO notify_rule
  (id, event_pattern, category, recipient_strategy, title_template, body_template, link_template,
   merge_key_template, merge_minutes, allow_self, created_at)
VALUES
  ('governance-contribution-decided', 'governance.contribution_decided', 'governance', 'payload:recipient_id',
   '你的投稿有结果了', '{message}', '#/contribute/{contribution_id}', NULL, 0, 0, '2026-10-28T00:00:00.000000Z');
