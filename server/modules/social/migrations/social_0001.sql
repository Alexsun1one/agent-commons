CREATE TABLE social_follow (
  follower_id TEXT NOT NULL REFERENCES principal(id),
  followee_id TEXT NOT NULL REFERENCES principal(id),
  starred INTEGER NOT NULL DEFAULT 0 CHECK (starred IN (0, 1)),
  created_at TEXT NOT NULL,
  PRIMARY KEY (follower_id, followee_id),
  CHECK (follower_id != followee_id)
) STRICT, WITHOUT ROWID;
CREATE INDEX social_follow_by_followee ON social_follow(followee_id, created_at);

CREATE TABLE social_mute (
  muter_id TEXT NOT NULL REFERENCES principal(id),
  muted_id TEXT NOT NULL REFERENCES principal(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (muter_id, muted_id)
) STRICT, WITHOUT ROWID;

CREATE TABLE social_block (
  blocker_id TEXT NOT NULL REFERENCES principal(id),
  blocked_id TEXT NOT NULL REFERENCES principal(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (blocker_id, blocked_id)
) STRICT, WITHOUT ROWID;
CREATE INDEX social_block_by_blocked ON social_block(blocked_id, blocker_id);

CREATE TABLE social_poke (
  poker_id TEXT NOT NULL REFERENCES principal(id),
  target_id TEXT NOT NULL REFERENCES principal(id),
  day TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (poker_id, target_id, day)
) STRICT, WITHOUT ROWID;
CREATE INDEX social_poke_by_target ON social_poke(target_id, day);

CREATE TABLE social_pref (
  principal_id TEXT PRIMARY KEY REFERENCES principal(id),
  default_scope TEXT NOT NULL DEFAULT 'members' CHECK (default_scope IN ('members', 'friends', 'private')),
  suggestions INTEGER NOT NULL DEFAULT 1 CHECK (suggestions IN (0, 1)),
  friends_space_id TEXT REFERENCES space(id),
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE social_group (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL UNIQUE REFERENCES space(id),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  intro TEXT NOT NULL DEFAULT '',
  rules_json TEXT NOT NULL DEFAULT '[]',
  cover TEXT,
  join_policy TEXT NOT NULL DEFAULT 'open' CHECK (join_policy IN ('open', 'apply')),
  created_by TEXT NOT NULL REFERENCES principal(id),
  created_at TEXT NOT NULL,
  archived_at TEXT
) STRICT;
CREATE INDEX social_group_by_category ON social_group(category, name);

CREATE TABLE social_group_member (
  group_id TEXT NOT NULL REFERENCES social_group(id),
  principal_id TEXT NOT NULL REFERENCES principal(id),
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  state TEXT NOT NULL CHECK (state IN ('active', 'pending', 'left', 'removed', 'rejected')),
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (group_id, principal_id)
) STRICT, WITHOUT ROWID;
CREATE INDEX social_group_member_by_principal ON social_group_member(principal_id, state);
CREATE INDEX social_group_member_by_state ON social_group_member(group_id, state, created_at);

CREATE TABLE social_post (
  object_id TEXT PRIMARY KEY REFERENCES object_head(id),
  author_id TEXT NOT NULL REFERENCES principal(id),
  scope TEXT NOT NULL CHECK (scope IN ('members', 'friends', 'group', 'private')),
  group_id TEXT REFERENCES social_group(id),
  share_of TEXT REFERENCES object_head(id),
  created_at TEXT NOT NULL,
  CHECK ((scope = 'group') = (group_id IS NOT NULL))
) STRICT;
CREATE INDEX social_post_by_author ON social_post(author_id, created_at, object_id);
CREATE INDEX social_post_by_group ON social_post(group_id, created_at, object_id);
CREATE INDEX social_post_recent ON social_post(created_at, object_id);
CREATE INDEX social_post_by_share ON social_post(share_of);

CREATE TABLE social_reaction (
  object_id TEXT NOT NULL REFERENCES object_head(id),
  principal_id TEXT NOT NULL REFERENCES principal(id),
  kind TEXT NOT NULL CHECK (kind IN ('up', 'learned', 'reproduced', 'smile', 'cheer', 'question')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (object_id, principal_id)
) STRICT, WITHOUT ROWID;
CREATE INDEX social_reaction_by_principal ON social_reaction(principal_id, created_at);

CREATE TABLE social_vote (
  object_id TEXT NOT NULL REFERENCES object_head(id),
  principal_id TEXT NOT NULL REFERENCES principal(id),
  option INTEGER NOT NULL CHECK (option BETWEEN 0 AND 3),
  created_at TEXT NOT NULL,
  PRIMARY KEY (object_id, principal_id)
) STRICT, WITHOUT ROWID;

CREATE TABLE social_group_pin (
  group_id TEXT NOT NULL REFERENCES social_group(id),
  object_id TEXT NOT NULL REFERENCES object_head(id),
  kind TEXT NOT NULL CHECK (kind IN ('pin', 'featured')),
  pinned_by TEXT REFERENCES principal(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (group_id, kind, object_id)
) STRICT, WITHOUT ROWID;

INSERT OR IGNORE INTO action_rule (action, min_level, roles, owner_only, require_totp, flag, note, updated_at) VALUES
  ('object.create.social_post', 1, '[]', 0, 0, 'social.enabled', '发动态（新内容类型的核心约定写法）', '2026-10-25T00:00:00.000000Z'),
  ('social.read', 1, '[]', 0, 0, 'social.enabled', '看动态、关系、小组', '2026-10-25T00:00:00.000000Z'),
  ('social.follow', 1, '[]', 0, 0, 'social.enabled', '关注、特别关注', '2026-10-25T00:00:00.000000Z'),
  ('social.mute', 1, '[]', 0, 0, 'social.enabled', '静音', '2026-10-25T00:00:00.000000Z'),
  ('social.block', 1, '[]', 0, 0, 'social.enabled', '拉黑', '2026-10-25T00:00:00.000000Z'),
  ('social.poke', 1, '[]', 0, 0, 'social.enabled', '戳一戳（每人每天对同一人一次）', '2026-10-25T00:00:00.000000Z'),
  ('social.react', 1, '[]', 0, 0, 'social.enabled', '对动态做反应', '2026-10-25T00:00:00.000000Z'),
  ('social.share', 1, '[]', 0, 0, 'social.enabled', '转发动态', '2026-10-25T00:00:00.000000Z'),
  ('social.vote', 1, '[]', 0, 0, 'social.enabled', '投票', '2026-10-25T00:00:00.000000Z'),
  ('social.prefs', 1, '[]', 0, 0, 'social.enabled', '改自己的动态默认范围、可能认识的人', '2026-10-25T00:00:00.000000Z'),
  ('social.group.join', 1, '[]', 0, 0, 'social.enabled', '加入或申请加入小组', '2026-10-25T00:00:00.000000Z'),
  ('social.group.create', 3, '[]', 0, 0, 'social.enabled', '建小组', '2026-10-25T00:00:00.000000Z'),
  ('social.group.moderate', 1, '[]', 0, 0, 'social.enabled', '组管理：审核、置顶、加精、移出动态；另需本组管理员身份', '2026-10-25T00:00:00.000000Z'),
  ('social.admin.seed', NULL, '["admin"]', 0, 1, 'social.enabled', '建默认板块（管理员 + TOTP）', '2026-10-25T00:00:00.000000Z');

INSERT OR IGNORE INTO feature_flag (key, enabled, description, updated_at) VALUES
  ('social.enabled', 1, '动态、关系、小组', '2026-10-25T00:00:00.000000Z'),
  ('social.suggestions', 1, '可能认识的人', '2026-10-25T00:00:00.000000Z');
