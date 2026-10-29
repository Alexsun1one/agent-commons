CREATE TABLE org (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL UNIQUE,
  intro TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL CHECK (kind IN ('company', 'lab', 'school_club', 'open_source', 'interest_group')),
  website TEXT NOT NULL DEFAULT '',
  banner TEXT NOT NULL DEFAULT '',
  join_policy TEXT NOT NULL CHECK (join_policy IN ('invite', 'apply')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'frozen')),
  verified INTEGER NOT NULL DEFAULT 0 CHECK (verified IN (0, 1)),
  owner_id TEXT REFERENCES principal(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  reviewed_at TEXT,
  reviewed_by TEXT REFERENCES principal(id),
  review_note TEXT NOT NULL DEFAULT ''
) STRICT;
CREATE INDEX org_directory ON org(status, kind, name);
CREATE INDEX org_owner ON org(owner_id, status);

CREATE TABLE org_member (
  org_id TEXT NOT NULL REFERENCES org(id),
  principal_id TEXT NOT NULL REFERENCES principal(id),
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  state TEXT NOT NULL CHECK (state IN ('invited', 'pending', 'active', 'rejected', 'left')),
  show_on_profile INTEGER NOT NULL DEFAULT 1 CHECK (show_on_profile IN (0, 1)),
  note TEXT NOT NULL DEFAULT '',
  invited_by TEXT REFERENCES principal(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (org_id, principal_id)
) STRICT, WITHOUT ROWID;
CREATE INDEX org_member_person ON org_member(principal_id, state, created_at);
CREATE INDEX org_member_queue ON org_member(org_id, state, created_at);

CREATE TABLE org_follow (
  org_id TEXT NOT NULL REFERENCES org(id),
  principal_id TEXT NOT NULL REFERENCES principal(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (org_id, principal_id)
) STRICT, WITHOUT ROWID;
CREATE INDEX org_follow_person ON org_follow(principal_id, created_at);

-- 只关联核心对象；帖子正文、版本与可见性仍由 object_head/object_version 管。
CREATE TABLE org_object (
  org_id TEXT NOT NULL REFERENCES org(id),
  object_id TEXT NOT NULL UNIQUE REFERENCES object_head(id),
  kind TEXT NOT NULL CHECK (kind IN ('post', 'work')),
  attached_by TEXT NOT NULL REFERENCES principal(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (org_id, object_id)
) STRICT, WITHOUT ROWID;
CREATE INDEX org_object_feed ON org_object(org_id, kind, created_at DESC);

INSERT OR IGNORE INTO feature_flag (key, enabled, description, updated_at)
VALUES ('orgs.enabled', 1, '团队主页、成员、关注与组织动态', '2026-10-25T00:00:00.000000Z');

INSERT OR IGNORE INTO action_rule
  (action, min_level, roles, owner_only, require_totp, flag, note, updated_at) VALUES
  ('orgs.read', 1, '[]', 0, 0, 'orgs.enabled', '查看已审核团队', '2026-10-25T00:00:00.000000Z'),
  ('orgs.create', 3, '[]', 0, 0, 'orgs.enabled', '申请创建团队', '2026-10-25T00:00:00.000000Z'),
  ('orgs.join', 1, '[]', 0, 0, 'orgs.enabled', '申请加入或接受团队邀请', '2026-10-25T00:00:00.000000Z'),
  ('orgs.follow', 1, '[]', 0, 0, 'orgs.enabled', '关注团队', '2026-10-25T00:00:00.000000Z'),
  ('orgs.manage', 1, '[]', 0, 0, 'orgs.enabled', '团队所有者和管理员管理成员', '2026-10-25T00:00:00.000000Z'),
  ('object.create.org_post', 1, '[]', 0, 0, 'orgs.enabled', '团队成员发布团队动态', '2026-10-25T00:00:00.000000Z'),
  ('orgs.review', NULL, '["admin", "governor"]', 0, 1, 'orgs.enabled', '审核团队申请', '2026-10-25T00:00:00.000000Z'),
  ('orgs.verify', NULL, '["admin"]', 0, 1, 'orgs.enabled', '手动设置团队认证', '2026-10-25T00:00:00.000000Z');
