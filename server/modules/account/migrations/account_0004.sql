-- R17-R3：#/contribute 的草稿与审核。只属于作者，不进公开动态，也不另开模块。
CREATE TABLE contribution (
  id TEXT PRIMARY KEY,
  author_id TEXT NOT NULL REFERENCES principal(id),
  title TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('实践案例', '作品', '方法笔记')),
  summary TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('draft', 'review', 'accepted')),
  version INTEGER NOT NULL CHECK (version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX contribution_by_author ON contribution(author_id, updated_at DESC, id DESC);

CREATE TABLE contribution_history (
  contribution_id TEXT NOT NULL REFERENCES contribution(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  event TEXT NOT NULL,
  title TEXT NOT NULL,
  kind TEXT NOT NULL,
  summary TEXT NOT NULL,
  body TEXT NOT NULL,
  at TEXT NOT NULL,
  PRIMARY KEY (contribution_id, version)
) STRICT, WITHOUT ROWID;

INSERT OR IGNORE INTO feature_flag (key, enabled, description, updated_at) VALUES
  ('account.contributions.enabled', 1, '我的投稿：草稿、提交审核、撤回', '2026-10-28T00:00:00.000000Z');

INSERT OR IGNORE INTO action_rule (action, min_level, roles, owner_only, require_totp, flag, note, updated_at) VALUES
  ('account.contribution.write', 1, '[]', 0, 0, 'account.contributions.enabled', '保存、提交、撤回或删除自己的投稿', '2026-10-28T00:00:00.000000Z');
