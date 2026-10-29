-- 热点事件 ↔ 讨论的唯一关联（同一事件只开一篇讨论）；日报按天的已读标记。
-- 现有表都没有按热点事件或按（成员，日报日期）记账的地方，所以各加一张小表。
CREATE TABLE content_hot_link (
  event_id TEXT PRIMARY KEY,
  object_id TEXT NOT NULL REFERENCES object_head(id),
  created_by TEXT REFERENCES principal(id),
  created_at TEXT NOT NULL
) STRICT, WITHOUT ROWID;
CREATE INDEX content_hot_link_object ON content_hot_link(object_id);

CREATE TABLE content_digest_read (
  principal_id TEXT NOT NULL REFERENCES principal(id),
  date TEXT NOT NULL,
  read_at TEXT NOT NULL,
  PRIMARY KEY (principal_id, date)
) STRICT, WITHOUT ROWID;
