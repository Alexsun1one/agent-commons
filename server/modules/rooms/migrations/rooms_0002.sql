-- R13 ROOM-2 · 单路投屏授权、逐轨录制同意与讲堂回看数据位。

ALTER TABLE room ADD COLUMN stage_mode TEXT NOT NULL DEFAULT 'screen'
  CHECK (stage_mode IN ('screen', 'board'));

ALTER TABLE join_grant ADD COLUMN can_screen_share INTEGER NOT NULL DEFAULT 0
  CHECK (can_screen_share IN (0, 1));

ALTER TABLE room_recording ADD COLUMN screen_track_json TEXT NOT NULL DEFAULT 'null';
ALTER TABLE room_recording ADD COLUMN audio_tracks_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE room_recording ADD COLUMN talk_id TEXT;

CREATE TABLE room_screen_share (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES room(id),
  principal_id TEXT NOT NULL REFERENCES principal(id),
  state TEXT NOT NULL CHECK (state IN ('pending', 'active', 'rejected', 'stopped', 'revoked')),
  share_audio INTEGER NOT NULL DEFAULT 1 CHECK (share_audio IN (0, 1)),
  requested_at TEXT NOT NULL,
  decided_at TEXT,
  decided_by TEXT REFERENCES principal(id),
  ended_at TEXT,
  reason_code TEXT
) STRICT;
CREATE INDEX room_screen_share_room ON room_screen_share(room_id, requested_at, id);
CREATE UNIQUE INDEX room_screen_share_active ON room_screen_share(room_id) WHERE state = 'active';
CREATE UNIQUE INDEX room_screen_share_pending ON room_screen_share(room_id, principal_id) WHERE state = 'pending';

CREATE TABLE room_recording_track_consent (
  room_id TEXT NOT NULL REFERENCES room(id),
  principal_id TEXT NOT NULL REFERENCES principal(id),
  consent_version INTEGER NOT NULL,
  track_kind TEXT NOT NULL CHECK (track_kind IN ('screen_track', 'screen_share_audio')),
  state TEXT NOT NULL CHECK (state IN ('granted', 'declined', 'withdrawn')),
  track_recorded INTEGER NOT NULL DEFAULT 0 CHECK (track_recorded IN (0, 1)),
  decided_at TEXT NOT NULL,
  PRIMARY KEY (room_id, principal_id, track_kind)
) STRICT, WITHOUT ROWID;
