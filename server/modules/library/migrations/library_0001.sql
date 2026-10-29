CREATE TABLE lib_item (
  object_id TEXT PRIMARY KEY REFERENCES object_head(id),
  type TEXT NOT NULL CHECK (type IN ('skill', 'prompt', 'component_lib', 'pattern')),
  category TEXT NOT NULL,
  tags_json TEXT NOT NULL,
  clients_or_stacks_json TEXT NOT NULL,
  license TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('pending_review', 'active', 'hidden', 'withdrawn')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX lib_item_type_category ON lib_item(type, category, status, updated_at DESC);

CREATE TABLE lib_usage (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES lib_item(object_id),
  principal_id TEXT NOT NULL REFERENCES principal(id),
  useful INTEGER NOT NULL DEFAULT 1 CHECK (useful IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (item_id, principal_id)
) STRICT;
CREATE INDEX lib_usage_item ON lib_usage(item_id, useful);

CREATE TABLE lib_example (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES lib_item(object_id),
  position INTEGER NOT NULL CHECK (position >= 0),
  input_text TEXT NOT NULL DEFAULT '',
  output_text TEXT NOT NULL DEFAULT '',
  comparison_bad TEXT NOT NULL DEFAULT '',
  comparison_good TEXT NOT NULL DEFAULT '',
  caption TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE (item_id, position)
) STRICT;
CREATE INDEX lib_example_item ON lib_example(item_id, position);

CREATE TABLE lib_install (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES lib_item(object_id),
  client TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 0),
  instructions TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (item_id, client)
) STRICT;
CREATE INDEX lib_install_item ON lib_install(item_id, position);

INSERT OR IGNORE INTO feature_flag (key, enabled, description, updated_at)
VALUES ('library.enabled', 1, 'Skill、提示词、组件库和产品形态资源库', '2026-10-25T00:00:00.000000Z');

INSERT OR IGNORE INTO action_rule
  (action, min_level, roles, owner_only, require_totp, flag, note, updated_at) VALUES
  ('library.submit', 2, '[]', 0, 0, 'library.enabled', 'L2 以上投稿并进入初筛', '2026-10-25T00:00:00.000000Z'),
  ('library.edit', 2, '[]', 1, 0, 'library.enabled', '作者修改资源条目', '2026-10-25T00:00:00.000000Z'),
  ('library.use', 1, '[]', 0, 0, 'library.enabled', '记录我用过和好用', '2026-10-25T00:00:00.000000Z'),
  ('object.create.skill', 2, '[]', 0, 0, 'library.enabled', '资源库 Skill 对象创建闸门', '2026-10-25T00:00:00.000000Z'),
  ('object.create.prompt', 2, '[]', 0, 0, 'library.enabled', '资源库提示词对象创建闸门', '2026-10-25T00:00:00.000000Z'),
  ('object.create.component_lib', 2, '[]', 0, 0, 'library.enabled', '资源库组件对象创建闸门', '2026-10-25T00:00:00.000000Z'),
  ('object.create.pattern', 2, '[]', 0, 0, 'library.enabled', '资源库产品形态对象创建闸门', '2026-10-25T00:00:00.000000Z');

