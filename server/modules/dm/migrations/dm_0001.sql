-- R13 DM-1 · member private messages. STRICT; UTC text timestamps.

CREATE TABLE dm_thread (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('direct', 'group')),
  direct_key TEXT,
  title TEXT,
  created_by TEXT NOT NULL REFERENCES principal(id),
  request_state TEXT NOT NULL DEFAULT 'accepted' CHECK (request_state IN ('accepted', 'pending', 'declined')),
  request_recipient_id TEXT REFERENCES principal(id),
  ref_json TEXT,
  last_seq INTEGER NOT NULL DEFAULT 0 CHECK (last_seq >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((kind = 'direct') = (direct_key IS NOT NULL)),
  CHECK ((request_state = 'pending') = (request_recipient_id IS NOT NULL))
) STRICT;
CREATE UNIQUE INDEX dm_thread_direct_pair ON dm_thread(direct_key) WHERE kind = 'direct';
CREATE INDEX dm_thread_updated ON dm_thread(updated_at DESC, id);

CREATE TABLE dm_member (
  thread_id TEXT NOT NULL REFERENCES dm_thread(id),
  principal_id TEXT NOT NULL REFERENCES principal(id),
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'left')),
  joined_at TEXT NOT NULL,
  PRIMARY KEY (thread_id, principal_id)
) STRICT;
CREATE INDEX dm_member_person ON dm_member(principal_id, state, thread_id);

CREATE TABLE dm_message (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES dm_thread(id),
  seq INTEGER NOT NULL CHECK (seq > 0),
  sender_id TEXT NOT NULL REFERENCES principal(id),
  kind TEXT NOT NULL CHECK (kind IN ('text', 'image', 'sticker', 'ref', 'mixed')),
  text TEXT,
  image_ref TEXT,
  sticker_ref TEXT,
  ref_json TEXT,
  reply_to TEXT REFERENCES dm_message(id),
  recalled_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (thread_id, seq)
) STRICT;
CREATE INDEX dm_message_thread_seq ON dm_message(thread_id, seq, id);
CREATE INDEX dm_message_sender_time ON dm_message(sender_id, created_at, id);

CREATE TABLE dm_message_hidden (
  message_id TEXT NOT NULL REFERENCES dm_message(id),
  principal_id TEXT NOT NULL REFERENCES principal(id),
  hidden_at TEXT NOT NULL,
  PRIMARY KEY (message_id, principal_id)
) STRICT;

CREATE TABLE dm_read (
  thread_id TEXT NOT NULL REFERENCES dm_thread(id),
  principal_id TEXT NOT NULL REFERENCES principal(id),
  last_seq INTEGER NOT NULL DEFAULT 0 CHECK (last_seq >= 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (thread_id, principal_id)
) STRICT;

CREATE TABLE dm_thread_pref (
  thread_id TEXT NOT NULL REFERENCES dm_thread(id),
  principal_id TEXT NOT NULL REFERENCES principal(id),
  pinned_at TEXT,
  muted INTEGER NOT NULL DEFAULT 0 CHECK (muted IN (0, 1)),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (thread_id, principal_id)
) STRICT;

CREATE TABLE dm_setting (
  principal_id TEXT PRIMARY KEY REFERENCES principal(id),
  contact_policy TEXT NOT NULL DEFAULT 'following' CHECK (contact_policy IN ('everyone', 'following', 'friends', 'closed')),
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE dm_report (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES dm_message(id),
  reporter_id TEXT NOT NULL REFERENCES principal(id),
  reason TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (message_id, reporter_id)
) STRICT;

INSERT OR IGNORE INTO action_rule (action, min_level, roles, owner_only, require_totp, flag, note, updated_at) VALUES
  ('dm.read', 1, '[]', 0, 0, 'dm.enabled', '读取自己的私信', '2026-10-25T00:00:00.000000Z'),
  ('dm.thread.create', 1, '[]', 0, 0, 'dm.enabled', '创建私信会话', '2026-10-25T00:00:00.000000Z'),
  ('dm.message.send', 1, '[]', 0, 0, 'dm.enabled', '发送私信', '2026-10-25T00:00:00.000000Z'),
  ('dm.settings', 1, '[]', 0, 0, 'dm.enabled', '修改私信偏好', '2026-10-25T00:00:00.000000Z'),
  ('dm.report', 1, '[]', 0, 0, 'dm.enabled', '举报私信', '2026-10-25T00:00:00.000000Z');

INSERT OR IGNORE INTO feature_flag (key, enabled, description, updated_at) VALUES
  ('dm.enabled', 1, '成员私信与小群', '2026-10-25T00:00:00.000000Z');
