-- R13 ROOM-1 · 房间：建房、进房、听、发言、撤权；议程、材料、白板附件；录制与纪要只留位置（第二步）。

CREATE TABLE room_series (
  id TEXT PRIMARY KEY,
  host_id TEXT NOT NULL REFERENCES principal(id),
  cadence TEXT NOT NULL CHECK (cadence IN ('weekly')),
  occurrences INTEGER NOT NULL CHECK (occurrences BETWEEN 2 AND 52),
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE room (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('discussion', 'stage')),
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  host_id TEXT NOT NULL REFERENCES principal(id),
  created_by TEXT NOT NULL REFERENCES principal(id),
  provider TEXT NOT NULL CHECK (provider IN ('livekit', 'external_link')),
  external_url TEXT,
  external_host TEXT,
  starts_at TEXT NOT NULL,
  duration_min INTEGER NOT NULL CHECK (duration_min BETWEEN 5 AND 600),
  extended_min INTEGER NOT NULL DEFAULT 0 CHECK (extended_min >= 0),
  extensions INTEGER NOT NULL DEFAULT 0 CHECK (extensions >= 0),
  state TEXT NOT NULL CHECK (state IN ('scheduled', 'live', 'ended')),
  started_at TEXT,
  ended_at TEXT,
  locked_at TEXT,
  self_unmute INTEGER NOT NULL DEFAULT 0 CHECK (self_unmute IN (0, 1)),
  capacity INTEGER NOT NULL CHECK (capacity >= 2),
  board_mode TEXT NOT NULL DEFAULT 'host' CHECK (board_mode IN ('host', 'speakers', 'all')),
  series_id TEXT REFERENCES room_series(id),
  series_index INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((provider = 'external_link') = (external_url IS NOT NULL))
) STRICT;
CREATE INDEX room_by_state ON room(state, starts_at, id);
CREATE INDEX room_by_host ON room(host_id);
CREATE INDEX room_by_series ON room(series_id, series_index);

-- 进入条件可叠加：同一房间的每一行都要满足（房主除外）。members 是基线；signup 另走等候室。
CREATE TABLE room_access (
  room_id TEXT NOT NULL REFERENCES room(id),
  kind TEXT NOT NULL CHECK (kind IN ('members', 'level', 'space', 'invite', 'signup')),
  min_level INTEGER CHECK (min_level IS NULL OR min_level BETWEEN 1 AND 5),
  space_id TEXT REFERENCES space(id),
  PRIMARY KEY (room_id, kind),
  CHECK ((kind = 'level') = (min_level IS NOT NULL)),
  CHECK ((kind = 'space') = (space_id IS NOT NULL))
) STRICT, WITHOUT ROWID;

CREATE TABLE room_invite (
  room_id TEXT NOT NULL REFERENCES room(id),
  principal_id TEXT NOT NULL REFERENCES principal(id),
  invited_by TEXT NOT NULL REFERENCES principal(id),
  invited_at TEXT NOT NULL,
  PRIMARY KEY (room_id, principal_id)
) STRICT, WITHOUT ROWID;

CREATE TABLE room_signup (
  room_id TEXT NOT NULL REFERENCES room(id),
  principal_id TEXT NOT NULL REFERENCES principal(id),
  state TEXT NOT NULL CHECK (state IN ('pending', 'approved', 'rejected', 'withdrawn')),
  created_at TEXT NOT NULL,
  decided_at TEXT,
  decided_by TEXT REFERENCES principal(id),
  PRIMARY KEY (room_id, principal_id)
) STRICT, WITHOUT ROWID;

-- 每人每房一行：当前角色、授权版本号 epoch、主持人静音、在场、被移出。
CREATE TABLE room_participant (
  room_id TEXT NOT NULL REFERENCES room(id),
  principal_id TEXT NOT NULL REFERENCES principal(id),
  role TEXT NOT NULL CHECK (role IN ('host', 'speaker', 'listener')),
  epoch INTEGER NOT NULL DEFAULT 1 CHECK (epoch >= 1),
  muted INTEGER NOT NULL DEFAULT 0 CHECK (muted IN (0, 1)),
  present INTEGER NOT NULL DEFAULT 1 CHECK (present IN (0, 1)),
  joined_at TEXT NOT NULL,
  left_at TEXT,
  removed_at TEXT,
  removed_by TEXT REFERENCES principal(id),
  removed_reason TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (room_id, principal_id)
) STRICT, WITHOUT ROWID;
CREATE INDEX room_participant_present ON room_participant(room_id, present, role);

CREATE TABLE join_grant (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES room(id),
  principal_id TEXT NOT NULL REFERENCES principal(id),
  role TEXT NOT NULL CHECK (role IN ('host', 'speaker', 'listener')),
  can_publish INTEGER NOT NULL CHECK (can_publish IN (0, 1)),
  epoch INTEGER NOT NULL,
  issued_at TEXT NOT NULL,
  revoked_at TEXT,
  revoke_reason TEXT
) STRICT;
CREATE INDEX join_grant_active ON join_grant(room_id, principal_id) WHERE revoked_at IS NULL;

CREATE TABLE speak_queue (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES room(id),
  principal_id TEXT NOT NULL REFERENCES principal(id),
  state TEXT NOT NULL CHECK (state IN ('raised', 'invited', 'approved', 'declined', 'withdrawn', 'ended')),
  position INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  decided_at TEXT,
  decided_by TEXT REFERENCES principal(id)
) STRICT;
CREATE UNIQUE INDEX speak_queue_open ON speak_queue(room_id, principal_id)
  WHERE state IN ('raised', 'invited', 'approved');
CREATE INDEX speak_queue_by_room ON speak_queue(room_id, state, position);

CREATE TABLE room_agenda_item (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES room(id),
  position INTEGER NOT NULL,
  title TEXT NOT NULL,
  minutes INTEGER NOT NULL CHECK (minutes BETWEEN 1 AND 180),
  state TEXT NOT NULL CHECK (state IN ('pending', 'current', 'done')),
  started_at TEXT,
  UNIQUE (room_id, position)
) STRICT;

-- 材料：站内对象只存编号（标题按读者权限现取），外部链接只存不抓，白板快照存进内容寻址存储。
CREATE TABLE room_material (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES room(id),
  kind TEXT NOT NULL CHECK (kind IN ('object', 'link', 'board')),
  object_id TEXT REFERENCES object_head(id),
  url TEXT,
  storage_key TEXT,
  title TEXT NOT NULL DEFAULT '',
  added_by TEXT NOT NULL REFERENCES principal(id),
  added_at TEXT NOT NULL,
  CHECK ((kind = 'object') = (object_id IS NOT NULL)),
  CHECK ((kind = 'link') = (url IS NOT NULL)),
  CHECK ((kind = 'board') = (storage_key IS NOT NULL))
) STRICT;
CREATE INDEX room_material_by_room ON room_material(room_id, added_at);

-- 录制与纪要：第二步。内测只建这两块数据位，状态机见 modules/rooms/consent.py 与回执。
CREATE TABLE room_recording (
  room_id TEXT PRIMARY KEY REFERENCES room(id),
  state TEXT NOT NULL CHECK (state IN ('not_recorded', 'proposed', 'collecting_consent', 'ready', 'starting',
                                       'active', 'paused', 'stopping', 'stopped', 'denied', 'expired')),
  purpose TEXT NOT NULL DEFAULT 'room_replay',
  consent_version INTEGER NOT NULL DEFAULT 1,
  storage_key TEXT,
  duration_s INTEGER,
  reason_code TEXT,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE room_recording_consent (
  room_id TEXT NOT NULL REFERENCES room(id),
  principal_id TEXT NOT NULL REFERENCES principal(id),
  consent_version INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('granted', 'declined', 'withdrawn')),
  track_recorded INTEGER NOT NULL DEFAULT 0 CHECK (track_recorded IN (0, 1)),
  decided_at TEXT NOT NULL,
  PRIMARY KEY (room_id, principal_id)
) STRICT, WITHOUT ROWID;

CREATE TABLE room_minutes (
  room_id TEXT PRIMARY KEY REFERENCES room(id),
  state TEXT NOT NULL CHECK (state IN ('none', 'pending', 'ready')),
  transcript_key TEXT,
  translation_key TEXT,
  chapters_json TEXT NOT NULL DEFAULT '[]',
  highlights_json TEXT NOT NULL DEFAULT '[]',
  todos_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE room_reminder (
  room_id TEXT NOT NULL REFERENCES room(id),
  kind TEXT NOT NULL CHECK (kind IN ('starts_soon', 'overtime_soon')),
  sent_at TEXT NOT NULL,
  PRIMARY KEY (room_id, kind)
) STRICT, WITHOUT ROWID;

-- 可调规则表：单场时长上限（取本人满足的各行最大值）、数值策略、外部会议域名白名单。
CREATE TABLE room_duration_cap (
  id TEXT PRIMARY KEY,
  min_level INTEGER CHECK (min_level IS NULL OR min_level BETWEEN 1 AND 5),
  role TEXT,
  max_minutes INTEGER NOT NULL CHECK (max_minutes BETWEEN 5 AND 600),
  note TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  CHECK ((min_level IS NULL) != (role IS NULL))
) STRICT;

CREATE TABLE room_policy (
  key TEXT PRIMARY KEY,
  value INTEGER NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
) STRICT, WITHOUT ROWID;

CREATE TABLE room_link_host (
  host TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT, WITHOUT ROWID;

INSERT OR IGNORE INTO action_rule (action, min_level, roles, owner_only, require_totp, flag, note, updated_at) VALUES
  ('rooms.create.discussion', 3, '["host","lecturer"]', 0, 0, 'rooms.enabled', 'L3 建讨论室（≤20 人）；主持人、讲师不看等级', '2026-10-25T00:00:00.000000Z'),
  ('rooms.create.stage', 4, '["host"]', 0, 0, 'rooms.enabled', 'L4 或主持人建舞台', '2026-10-25T00:00:00.000000Z'),
  ('rooms.join', 1, '[]', 0, 0, 'rooms.enabled', '进房；再叠加房间自己的进入条件', '2026-10-25T00:00:00.000000Z'),
  ('rooms.raise_hand', 2, '[]', 0, 0, 'rooms.enabled', 'L2 在房间里举手', '2026-10-25T00:00:00.000000Z'),
  ('rooms.moderate', 1, '[]', 1, 0, 'rooms.enabled', '主持人管理自己的房间（发言队列、静音、移出、锁房、转交、结束）', '2026-10-25T00:00:00.000000Z');

INSERT OR IGNORE INTO feature_flag (key, enabled, description, updated_at) VALUES
  ('rooms.enabled', 0, '会议房间（ROOM-1）；部署机验证清单全过之前保持关闭', '2026-10-25T00:00:00.000000Z'),
  ('rooms.recording', 0, '房间录制与 AI 纪要（第二步；内测不录制、不转写）', '2026-10-25T00:00:00.000000Z');

INSERT OR IGNORE INTO room_duration_cap (id, min_level, role, max_minutes, note, updated_at) VALUES
  ('l3', 3, NULL, 60, 'L3 单场 60 分钟', '2026-10-25T00:00:00.000000Z'),
  ('l4', 4, NULL, 120, 'L4 单场 120 分钟', '2026-10-25T00:00:00.000000Z'),
  ('host', NULL, 'host', 180, '主持人单场 180 分钟', '2026-10-25T00:00:00.000000Z'),
  ('lecturer', NULL, 'lecturer', 180, '讲师单场 180 分钟', '2026-10-25T00:00:00.000000Z');

INSERT OR IGNORE INTO room_policy (key, value, note, updated_at) VALUES
  ('capacity.discussion', 20, '讨论室人数上限', '2026-10-25T00:00:00.000000Z'),
  ('capacity.stage', 500, '舞台人数上限', '2026-10-25T00:00:00.000000Z'),
  ('duration.min', 15, '单场最短分钟数', '2026-10-25T00:00:00.000000Z'),
  ('extend.max_times', 1, '每场最多延长几次（总时长仍不超过上限）', '2026-10-25T00:00:00.000000Z'),
  ('remind.before_start_min', 10, '开始前几分钟提醒', '2026-10-25T00:00:00.000000Z'),
  ('remind.before_end_min', 5, '到点前几分钟提醒主持人', '2026-10-25T00:00:00.000000Z'),
  ('open.early_min', 15, '主持人最早提前几分钟开房', '2026-10-25T00:00:00.000000Z'),
  ('schedule.max_days_ahead', 60, '最远能约多少天以后', '2026-10-25T00:00:00.000000Z'),
  ('series.max_occurrences', 12, '每周例会一次最多排几场', '2026-10-25T00:00:00.000000Z'),
  ('token.ttl_s', 600, '媒体访问令牌有效期（秒）', '2026-10-25T00:00:00.000000Z'),
  ('invite.max', 200, '邀请名单人数上限', '2026-10-25T00:00:00.000000Z');

INSERT OR IGNORE INTO room_link_host (host, label, updated_at) VALUES
  ('meeting.tencent.com', '腾讯会议', '2026-10-25T00:00:00.000000Z'),
  ('voovmeeting.com', '腾讯会议（VooV）', '2026-10-25T00:00:00.000000Z'),
  ('vc.feishu.cn', '飞书会议', '2026-10-25T00:00:00.000000Z'),
  ('vc.larksuite.com', 'Lark 会议', '2026-10-25T00:00:00.000000Z');
