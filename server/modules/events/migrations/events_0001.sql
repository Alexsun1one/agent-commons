-- EVENT-1 · 活动、报名、提交、投票（只追加）、结果

CREATE TABLE community_event (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('challenge', 'camp', 'meetup', 'talks', 'campaign')),
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  cover TEXT NOT NULL DEFAULT '',
  rules TEXT NOT NULL DEFAULT '',
  rewards_json TEXT NOT NULL DEFAULT '[]',
  timeline_json TEXT NOT NULL DEFAULT '[]',
  place TEXT NOT NULL DEFAULT '',
  host_id TEXT REFERENCES principal(id),
  host_name TEXT NOT NULL DEFAULT '',
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'members'
    CHECK (visibility IN ('members', 'level', 'space', 'named')),
  min_level INTEGER NOT NULL DEFAULT 1 CHECK (min_level BETWEEN 1 AND 5),
  space_id TEXT REFERENCES space(id),
  status TEXT NOT NULL DEFAULT 'upcoming' CHECK (status IN ('upcoming', 'live', 'ended')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (ends_at > starts_at)
) STRICT;
CREATE INDEX community_event_by_status ON community_event(status, starts_at, id);
CREATE INDEX community_event_by_kind ON community_event(kind, status, starts_at);
CREATE INDEX community_event_calendar ON community_event(starts_at, ends_at);

CREATE TABLE event_acl (
  event_id TEXT NOT NULL REFERENCES community_event(id),
  principal_id TEXT NOT NULL REFERENCES principal(id),
  PRIMARY KEY (event_id, principal_id)
) STRICT, WITHOUT ROWID;

CREATE TABLE event_signup (
  event_id TEXT NOT NULL REFERENCES community_event(id),
  principal_id TEXT NOT NULL REFERENCES principal(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (event_id, principal_id)
) STRICT, WITHOUT ROWID;
CREATE INDEX event_signup_by_person ON event_signup(principal_id, created_at);

CREATE TABLE event_submission (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES community_event(id),
  principal_id TEXT NOT NULL REFERENCES principal(id),
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  source_kind TEXT NOT NULL CHECK (source_kind IN ('work', 'prompt', 'talk', 'other')),
  source_ref TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  last_rank INTEGER,
  UNIQUE (event_id, principal_id, source_kind, source_ref)
) STRICT;
CREATE INDEX event_submission_by_event ON event_submission(event_id, created_at);
CREATE INDEX event_submission_by_person ON event_submission(principal_id, created_at);

CREATE TABLE event_vote (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES community_event(id),
  candidate_id TEXT NOT NULL REFERENCES event_submission(id),
  voter_id TEXT NOT NULL REFERENCES principal(id),
  weight REAL NOT NULL DEFAULT 1.0 CHECK (weight > 0),
  created_at TEXT NOT NULL,
  UNIQUE (event_id, voter_id, candidate_id)
) STRICT;
CREATE INDEX event_vote_by_event_day ON event_vote(event_id, voter_id, created_at);
CREATE INDEX event_vote_by_candidate ON event_vote(candidate_id, created_at);

CREATE TRIGGER event_vote_no_update BEFORE UPDATE ON event_vote
BEGIN
  SELECT RAISE(ABORT, 'event_vote is append-only');
END;

CREATE TABLE event_result (
  event_id TEXT PRIMARY KEY REFERENCES community_event(id),
  published_at TEXT NOT NULL,
  stats_json TEXT NOT NULL,
  winners_json TEXT NOT NULL
) STRICT;

INSERT OR IGNORE INTO action_rule
  (action, min_level, roles, owner_only, require_totp, flag, note, updated_at)
VALUES
  ('events.read', 1, '[]', 0, 0, 'events.enabled', '查看活动、打榜与日历', '2026-10-25T00:00:00.000000Z'),
  ('events.signup', 1, '[]', 0, 0, 'events.enabled', '报名参加活动', '2026-10-25T00:00:00.000000Z'),
  ('events.submit', 2, '[]', 0, 0, 'events.enabled', '向活动提交作品', '2026-10-25T00:00:00.000000Z'),
  ('events.vote', 1, '[]', 0, 0, 'events.enabled', '给打榜候选投票', '2026-10-25T00:00:00.000000Z'),
  ('events.manage', NULL, '["admin"]', 0, 1, 'events.enabled', '创建与管理活动', '2026-10-25T00:00:00.000000Z');

INSERT OR IGNORE INTO feature_flag (key, enabled, description, updated_at)
VALUES ('events.enabled', 1, '活动专区与打榜', '2026-10-25T00:00:00.000000Z');
