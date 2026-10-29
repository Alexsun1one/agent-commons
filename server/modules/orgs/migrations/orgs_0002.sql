-- R17-B · 入组申请审批：在 org_member 上补记「谁、何时、怎么处理」，不新建表。
-- applied_at 区分「自己申请的」和「被邀请/被直接加入的」，供「我的申请」只列申请。
ALTER TABLE org_member ADD COLUMN applied_at TEXT;
ALTER TABLE org_member ADD COLUMN reviewed_by TEXT;
ALTER TABLE org_member ADD COLUMN reviewed_at TEXT;
ALTER TABLE org_member ADD COLUMN review_note TEXT NOT NULL DEFAULT '';

UPDATE org_member SET applied_at = created_at
 WHERE state IN ('pending', 'rejected')
    OR (state = 'active' AND role = 'member' AND invited_by IS NULL);

CREATE INDEX org_member_applied ON org_member(principal_id, applied_at) WHERE applied_at IS NOT NULL;
