CREATE TABLE content_reply (
  object_id TEXT PRIMARY KEY REFERENCES object_head(id),
  target_id TEXT NOT NULL REFERENCES object_head(id),
  reply_to TEXT REFERENCES object_head(id),
  thread_root TEXT NOT NULL,
  depth INTEGER NOT NULL DEFAULT 0 CHECK (depth BETWEEN 0 AND 64),
  path TEXT NOT NULL,
  quote_author_id TEXT,
  quote_excerpt TEXT,
  quote_version INTEGER,
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX content_reply_tree ON content_reply(target_id, path);
CREATE INDEX content_reply_thread ON content_reply(thread_root, path);
CREATE INDEX content_reply_to ON content_reply(reply_to);
CREATE INDEX content_reply_quote_author ON content_reply(quote_author_id);

CREATE TABLE content_reaction (
  object_id TEXT NOT NULL REFERENCES object_head(id),
  principal_id TEXT NOT NULL REFERENCES principal(id),
  kind TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (object_id, principal_id, kind)
) STRICT, WITHOUT ROWID;
CREATE INDEX content_reaction_by_principal ON content_reaction(principal_id, created_at);

CREATE TABLE content_save (
  principal_id TEXT NOT NULL REFERENCES principal(id),
  object_id TEXT NOT NULL REFERENCES object_head(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (principal_id, object_id)
) STRICT, WITHOUT ROWID;
CREATE INDEX content_save_recent ON content_save(principal_id, created_at, object_id);
CREATE INDEX content_save_by_object ON content_save(object_id);

CREATE TABLE content_useful (
  object_id TEXT NOT NULL REFERENCES object_head(id),
  giver_id TEXT NOT NULL REFERENCES principal(id),
  receiver_id TEXT NOT NULL REFERENCES principal(id),
  counted INTEGER NOT NULL CHECK (counted IN (0, 1)),
  points INTEGER NOT NULL DEFAULT 0,
  reason TEXT,
  ledger_entry_id TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (object_id, giver_id)
) STRICT, WITHOUT ROWID;
CREATE INDEX content_useful_by_giver ON content_useful(giver_id, created_at);
CREATE INDEX content_useful_by_receiver ON content_useful(receiver_id, created_at);

CREATE TABLE content_stat (
  object_id TEXT PRIMARY KEY REFERENCES object_head(id),
  is_root INTEGER NOT NULL CHECK (is_root IN (0, 1)),
  reactions INTEGER NOT NULL DEFAULT 0,
  replies INTEGER NOT NULL DEFAULT 0,
  useful INTEGER NOT NULL DEFAULT 0,
  saves INTEGER NOT NULL DEFAULT 0,
  hot REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX content_stat_hot ON content_stat(is_root, hot, object_id);

CREATE TABLE content_tag (
  tag TEXT NOT NULL,
  object_id TEXT NOT NULL REFERENCES object_head(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (tag, object_id)
) STRICT, WITHOUT ROWID;
CREATE INDEX content_tag_recent ON content_tag(tag, created_at, object_id);
CREATE INDEX content_tag_by_object ON content_tag(object_id);

CREATE TABLE content_follow (
  principal_id TEXT NOT NULL REFERENCES principal(id),
  tag TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (principal_id, tag)
) STRICT, WITHOUT ROWID;

INSERT OR IGNORE INTO action_rule (action, min_level, roles, owner_only, require_totp, flag, note, updated_at) VALUES
  ('object.create.agent_card', 2, '[]', 0, 0, 'core.objects', 'L2 登记 AIGC 接入名片', '2026-10-25T00:00:00.000000Z'),
  ('content.react', 1, '[]', 0, 0, 'content.social', '表情反应（一人一种一次）', '2026-10-25T00:00:00.000000Z'),
  ('content.save', 1, '[]', 0, 0, 'content.social', '收藏', '2026-10-25T00:00:00.000000Z'),
  ('content.useful', 1, '[]', 0, 0, 'content.social', '标「有用」；是否计分由 growth 防刷规则判', '2026-10-25T00:00:00.000000Z'),
  ('content.follow', 1, '[]', 0, 0, 'content.social', '关注方向（标签）', '2026-10-25T00:00:00.000000Z');

INSERT OR IGNORE INTO feature_flag (key, enabled, description, updated_at) VALUES
  ('content.social', 1, '反应、收藏、有用、关注方向', '2026-10-25T00:00:00.000000Z');
