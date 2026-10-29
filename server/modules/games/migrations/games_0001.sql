-- GAMES-1 · 模拟考场、猜提示词、抽签、抢沙发与乐园偏好

CREATE TABLE game_question (
  id TEXT PRIMARY KEY,
  direction TEXT NOT NULL CHECK (direction IN ('agent', 'prompt', 'coding', 'model', 'safety')),
  kind TEXT NOT NULL CHECK (kind IN ('single', 'multiple', 'boolean', 'order')),
  prompt TEXT NOT NULL,
  options_json TEXT NOT NULL,
  answer_json TEXT NOT NULL,
  explanation TEXT NOT NULL,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('problem', 'skill', 'prompt', 'pattern')),
  source_id TEXT NOT NULL,
  source_route TEXT NOT NULL,
  review_status TEXT NOT NULL CHECK (review_status IN ('draft', 'reviewed')),
  sample INTEGER NOT NULL DEFAULT 1 CHECK (sample IN (0, 1)),
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX game_question_pool ON game_question(review_status, direction, id);

CREATE TABLE game_exam (
  id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL REFERENCES principal(id),
  direction TEXT,
  question_count INTEGER NOT NULL CHECK (question_count > 0),
  duration_seconds INTEGER NOT NULL CHECK (duration_seconds > 0),
  started_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  submitted_at TEXT,
  score INTEGER CHECK (score BETWEEN 0 AND 100),
  correct_count INTEGER CHECK (correct_count >= 0),
  sample INTEGER NOT NULL DEFAULT 1 CHECK (sample IN (0, 1))
) STRICT;
CREATE INDEX game_exam_owner ON game_exam(principal_id, started_at DESC);

CREATE TABLE game_exam_question (
  exam_id TEXT NOT NULL REFERENCES game_exam(id) ON DELETE CASCADE,
  slot INTEGER NOT NULL CHECK (slot > 0),
  question_id TEXT NOT NULL REFERENCES game_question(id),
  options_json TEXT NOT NULL,
  answer_json TEXT NOT NULL,
  PRIMARY KEY (exam_id, slot)
) STRICT, WITHOUT ROWID;

CREATE TABLE game_exam_answer (
  exam_id TEXT NOT NULL REFERENCES game_exam(id) ON DELETE CASCADE,
  slot INTEGER NOT NULL,
  response_json TEXT NOT NULL,
  correct INTEGER NOT NULL CHECK (correct IN (0, 1)),
  answered_at TEXT NOT NULL,
  PRIMARY KEY (exam_id, slot),
  FOREIGN KEY (exam_id, slot) REFERENCES game_exam_question(exam_id, slot)
) STRICT, WITHOUT ROWID;

CREATE TABLE game_best_score (
  principal_id TEXT PRIMARY KEY REFERENCES principal(id),
  exam_id TEXT NOT NULL REFERENCES game_exam(id),
  score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
  duration_seconds INTEGER NOT NULL CHECK (duration_seconds >= 0),
  updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX game_best_ranking ON game_best_score(score DESC, duration_seconds, updated_at);

CREATE TABLE game_daily_rotation (
  day TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('guess')),
  slot INTEGER NOT NULL CHECK (slot BETWEEN 1 AND 5),
  item_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (day, kind, slot),
  UNIQUE (day, kind, item_id)
) STRICT, WITHOUT ROWID;

CREATE TABLE game_guess_attempt (
  principal_id TEXT NOT NULL REFERENCES principal(id),
  day TEXT NOT NULL,
  slot INTEGER NOT NULL CHECK (slot BETWEEN 1 AND 5),
  option_id TEXT NOT NULL,
  correct INTEGER NOT NULL CHECK (correct IN (0, 1)),
  streak INTEGER NOT NULL CHECK (streak >= 0),
  reward INTEGER NOT NULL CHECK (reward >= 0),
  attempted_at TEXT NOT NULL,
  PRIMARY KEY (principal_id, day, slot)
) STRICT, WITHOUT ROWID;

CREATE TABLE game_fortune (
  principal_id TEXT NOT NULL REFERENCES principal(id),
  day TEXT NOT NULL,
  fortune_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (principal_id, day)
) STRICT, WITHOUT ROWID;

CREATE TABLE game_sofa_reply (
  object_id TEXT PRIMARY KEY,
  root_id TEXT NOT NULL,
  principal_id TEXT NOT NULL REFERENCES principal(id),
  position INTEGER NOT NULL CHECK (position BETWEEN 1 AND 3),
  body_length INTEGER NOT NULL CHECK (body_length >= 15),
  reward INTEGER NOT NULL CHECK (reward >= 0),
  created_at TEXT NOT NULL,
  UNIQUE (root_id, position)
) STRICT;
CREATE INDEX game_sofa_today ON game_sofa_reply(created_at, principal_id);

CREATE TABLE game_reward (
  principal_id TEXT NOT NULL REFERENCES principal(id),
  reward_key TEXT NOT NULL,
  reason TEXT NOT NULL,
  requested INTEGER NOT NULL CHECK (requested >= 0),
  granted INTEGER NOT NULL CHECK (granted >= 0),
  delivered INTEGER NOT NULL CHECK (delivered IN (0, 1)),
  ref TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (principal_id, reward_key)
) STRICT, WITHOUT ROWID;
CREATE INDEX game_reward_weekly ON game_reward(created_at, granted DESC);

CREATE TABLE game_preference (
  principal_id TEXT PRIMARY KEY REFERENCES principal(id),
  playground_enabled INTEGER NOT NULL DEFAULT 1 CHECK (playground_enabled IN (0, 1)),
  updated_at TEXT NOT NULL
) STRICT;

INSERT OR IGNORE INTO action_rule
  (action, min_level, roles, owner_only, require_totp, flag, note, updated_at)
VALUES
  ('games.read', 1, '[]', 0, 0, 'games.enabled', '查看乐园与排行榜', '2026-10-25T00:00:00.000000Z'),
  ('games.play', 1, '[]', 0, 0, 'games.enabled', '参加乐园游戏', '2026-10-25T00:00:00.000000Z'),
  ('games.preference', 1, '[]', 0, 0, 'games.enabled', '修改自己的乐园偏好', '2026-10-25T00:00:00.000000Z');

INSERT OR IGNORE INTO feature_flag (key, enabled, description, updated_at)
VALUES ('games.enabled', 1, '乐园与轻量游戏', '2026-10-25T00:00:00.000000Z');

