CREATE TABLE pet_profile (
  owner_id TEXT PRIMARY KEY REFERENCES principal(id),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 8),
  palette TEXT NOT NULL CHECK (palette IN ('classic', 'brand-blue', 'mint', 'mist-purple', 'graphite', 'night-sky')),
  fullness INTEGER NOT NULL CHECK (fullness BETWEEN 0 AND 100),
  mood INTEGER NOT NULL CHECK (mood BETWEEN 0 AND 100),
  affinity INTEGER NOT NULL CHECK (affinity BETWEEN 0 AND 100),
  affinity_total INTEGER NOT NULL DEFAULT 0 CHECK (affinity_total >= 0),
  stage INTEGER NOT NULL DEFAULT 0 CHECK (stage BETWEEN 0 AND 3),
  state_at TEXT NOT NULL,
  adopted_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE pet_action (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES principal(id),
  kind TEXT NOT NULL CHECK (kind IN ('feed', 'pat', 'play', 'visit')),
  target_owner_id TEXT REFERENCES principal(id),
  day TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX pet_action_daily ON pet_action(owner_id, day, kind, target_owner_id);

CREATE TABLE pet_diary (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES principal(id),
  event_key TEXT NOT NULL UNIQUE,
  entry TEXT NOT NULL CHECK (length(entry) BETWEEN 1 AND 120),
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX pet_diary_owner ON pet_diary(owner_id, created_at DESC, id DESC);

INSERT OR IGNORE INTO action_rule (action, min_level, roles, owner_only, require_totp, flag, note, updated_at) VALUES
  ('pet.read', 1, '[]', 0, 0, 'pet.game', '查看熊猫小窝', '2026-10-25T00:00:00.000000Z'),
  ('pet.adopt', 1, '[]', 0, 0, 'pet.game', '领养自己的熊猫', '2026-10-25T00:00:00.000000Z'),
  ('pet.care', 1, '[]', 0, 0, 'pet.game', '照料自己的熊猫', '2026-10-25T00:00:00.000000Z'),
  ('pet.visit', 1, '[]', 0, 0, 'pet.game', '拜访好友熊猫', '2026-10-25T00:00:00.000000Z');

INSERT OR IGNORE INTO feature_flag (key, enabled, description, updated_at) VALUES
  ('pet.game', 1, '熊猫小窝与好友串门', '2026-10-25T00:00:00.000000Z');
