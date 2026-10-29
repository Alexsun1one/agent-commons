CREATE TABLE feed_source (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('rss', 'atom', 'json', 'html-list')),
  url TEXT NOT NULL,
  lang TEXT NOT NULL,
  weight REAL NOT NULL,
  direction TEXT NOT NULL,
  etag TEXT,
  last_modified TEXT,
  last_ok_at TEXT,
  last_request_at TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  last_error TEXT,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1))
) STRICT;

CREATE TABLE feed_event (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  direction TEXT NOT NULL,
  first_seen TEXT,
  last_seen TEXT,
  entities_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX feed_event_last_seen ON feed_event(last_seen, id);
CREATE INDEX feed_event_direction ON feed_event(direction, last_seen);

CREATE TABLE feed_item (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES feed_source(id),
  url TEXT NOT NULL,
  canonical_url TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  excerpt TEXT NOT NULL DEFAULT '',
  published_at TEXT,
  lang TEXT NOT NULL,
  event_id TEXT REFERENCES feed_event(id),
  fetched_at TEXT NOT NULL
) STRICT;
CREATE INDEX feed_item_event ON feed_item(event_id, published_at);
CREATE INDEX feed_item_source ON feed_item(source_id, published_at);

CREATE TABLE feed_signal (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES feed_event(id),
  user_id TEXT REFERENCES principal(id),
  kind TEXT NOT NULL CHECK (kind IN ('favorite', 'comment', 'room')),
  at TEXT NOT NULL
) STRICT;
CREATE INDEX feed_signal_event ON feed_signal(event_id, kind, at);
CREATE UNIQUE INDEX feed_signal_favorite_once ON feed_signal(event_id, user_id) WHERE kind = 'favorite' AND user_id IS NOT NULL;
CREATE INDEX feed_signal_user ON feed_signal(user_id, kind);

CREATE TABLE feed_digest (
  date TEXT NOT NULL,
  direction TEXT NOT NULL,
  body TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  PRIMARY KEY (date, direction)
) STRICT;

CREATE TABLE feed_sub (
  user_id TEXT NOT NULL REFERENCES principal(id),
  direction TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, direction)
) STRICT;

INSERT OR IGNORE INTO action_rule (action, min_level, roles, owner_only, require_totp, flag, note, updated_at) VALUES
  ('feed.subscribe', 1, '[]', 0, 0, 'feed.enabled', '订阅热点方向', '2026-10-25T00:00:00.000000Z'),
  ('feed.favorite', 1, '[]', 0, 0, 'feed.enabled', '收藏热点事件', '2026-10-25T00:00:00.000000Z'),
  ('feed.room', 1, '[]', 0, 0, 'feed.enabled', '带着热点开房间（交给房间模块）', '2026-10-25T00:00:00.000000Z');

INSERT OR IGNORE INTO feature_flag (key, enabled, description, updated_at) VALUES
  ('feed.enabled', 1, 'AI 热点模块', '2026-10-25T00:00:00.000000Z'),
  ('feed.collect.enabled', 0, '向白名单源发真实请求；默认关，测试和上线前确认前不得打开', '2026-10-25T00:00:00.000000Z');
