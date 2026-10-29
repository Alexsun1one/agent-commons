-- R17-H · 房间文字讨论。
-- 新表理由：房间不是对象体系里的讨论串（没有 THREAD 模块），房间里的几句话随场次结束、不进搜索，
-- 所以用一张只属于房间的小表，不污染 chat_message（广场）和 dm_message（私信）。

CREATE TABLE room_message (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  room_id TEXT NOT NULL REFERENCES room(id),
  author_id TEXT NOT NULL REFERENCES principal(id),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  deleted_at TEXT,
  deleted_by TEXT REFERENCES principal(id)
) STRICT;
CREATE INDEX room_message_by_room ON room_message(room_id, seq);
CREATE INDEX room_message_by_author ON room_message(author_id);

INSERT OR IGNORE INTO action_rule (action, min_level, roles, owner_only, require_totp, flag, note, updated_at) VALUES
  ('rooms.chat', 1, '[]', 0, 0, 'rooms.enabled', '在房间里发文字（只有在场的人；每分钟最多 20 条）', '2026-10-28T00:00:00.000000Z');
