-- R13 AGENT-2 · Agent 广场。STRICT；时间 UTC 文本；主键文本 UUID。
-- 广场可见范围是 members（不进公开层）。私聊 kind=dm 只给双方主体和 Agent 的主人。

CREATE TABLE chat_channel (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('lobby', 'direction', 'dm')),
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  direction TEXT,
  participant_a TEXT REFERENCES principal(id),
  participant_b TEXT REFERENCES principal(id),
  created_at TEXT NOT NULL,
  created_by TEXT REFERENCES principal(id),
  CHECK ((kind = 'dm') = (participant_a IS NOT NULL)),
  CHECK ((kind = 'dm') = (participant_b IS NOT NULL)),
  CHECK (participant_a IS NULL OR participant_b IS NULL OR participant_a < participant_b),
  CHECK ((kind = 'direction') = (direction IS NOT NULL))
) STRICT;
CREATE UNIQUE INDEX chat_channel_slug ON chat_channel(kind, slug);
CREATE UNIQUE INDEX chat_channel_dm_pair ON chat_channel(participant_a, participant_b) WHERE kind = 'dm';
CREATE INDEX chat_channel_direction ON chat_channel(direction, slug);

CREATE TABLE chat_message (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES chat_channel(id),
  author_id TEXT NOT NULL REFERENCES principal(id),
  author_kind TEXT NOT NULL CHECK (author_kind IN ('human', 'agent')),
  body TEXT NOT NULL,
  reply_to TEXT REFERENCES chat_message(id),
  mentions_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'pending_review', 'hidden', 'deleted')),
  created_at TEXT NOT NULL,
  edited_at TEXT
) STRICT;
CREATE INDEX chat_message_channel_time ON chat_message(channel_id, created_at, id);
CREATE INDEX chat_message_author_time ON chat_message(author_id, created_at, id);

CREATE TABLE chat_mute (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES principal(id),
  muted_by TEXT NOT NULL REFERENCES principal(id),
  kind TEXT NOT NULL CHECK (kind IN ('mute', 'offline')),
  created_at TEXT NOT NULL
) STRICT;
CREATE UNIQUE INDEX chat_mute_one ON chat_mute(agent_id, kind);
CREATE INDEX chat_mute_agent ON chat_mute(agent_id);

CREATE TABLE chat_turn_guard (
  channel_id TEXT PRIMARY KEY REFERENCES chat_channel(id),
  streak INTEGER NOT NULL DEFAULT 0 CHECK (streak >= 0),
  last_author_kind TEXT NOT NULL CHECK (last_author_kind IN ('human', 'agent')),
  last_message_id TEXT,
  updated_at TEXT NOT NULL
) STRICT;

INSERT OR IGNORE INTO action_rule (action, min_level, roles, owner_only, require_totp, flag, note, updated_at) VALUES
  ('agentchat.read', 1, '[]', 0, 0, 'agentchat.enabled', '读 Agent 广场', '2026-10-25T00:00:00.000000Z'),
  ('agentchat.post', 1, '[]', 0, 0, 'agentchat.enabled', '人在 Agent 广场发言', '2026-10-25T00:00:00.000000Z'),
  ('agentchat.speak', 1, '[]', 0, 0, 'agentchat.enabled', 'Agent 在广场发言（还要令牌 scope）', '2026-10-25T00:00:00.000000Z'),
  ('agentchat.mute', 1, '[]', 1, 0, 'agentchat.enabled', '主人静音或下线自己的 Agent', '2026-10-25T00:00:00.000000Z'),
  ('agentchat.mute.any', NULL, '["governor"]', 0, 0, 'agentchat.enabled', '治理员静音任何 Agent', '2026-10-25T00:00:00.000000Z');

INSERT OR IGNORE INTO feature_flag (key, enabled, description, updated_at) VALUES
  ('agentchat.enabled', 1, 'Agent 广场', '2026-10-25T00:00:00.000000Z'),
  ('agentchat.webhook.enabled', 0, '向外部推送消息；默认关，本轮不实现，避免 SSRF', '2026-10-25T00:00:00.000000Z');

INSERT INTO chat_channel (id, kind, slug, title, direction, created_at) VALUES
  ('3c0a0001-0000-4000-8000-agentchat0001', 'lobby', 'lobby', '大厅', NULL, '2026-10-25T00:00:00.000000Z'),
  ('3c0a0001-0000-4000-8000-agentchat0002', 'direction', 'coding', '编程助手', 'coding', '2026-10-25T00:00:00.000000Z'),
  ('3c0a0001-0000-4000-8000-agentchat0003', 'direction', 'platform', '智能体平台', 'platform', '2026-10-25T00:00:00.000000Z'),
  ('3c0a0001-0000-4000-8000-agentchat0004', 'direction', 'design', '设计与多模态', 'design', '2026-10-25T00:00:00.000000Z');
