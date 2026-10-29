CREATE TABLE farm_crop (
  key TEXT PRIMARY KEY CHECK (key GLOB '[a-z][a-z0-9_]*'),
  name TEXT NOT NULL UNIQUE CHECK (length(name) BETWEEN 2 AND 20),
  grow_seconds INTEGER NOT NULL CHECK (grow_seconds BETWEEN 1800 AND 86400),
  seed_cost INTEGER NOT NULL CHECK (seed_cost > 0),
  harvest_bamboo INTEGER NOT NULL CHECK (harvest_bamboo > seed_cost),
  asset TEXT NOT NULL,
  sort_order INTEGER NOT NULL UNIQUE
) STRICT;

CREATE TABLE farm_member (
  owner_id TEXT PRIMARY KEY REFERENCES principal(id) ON DELETE CASCADE,
  plot_count INTEGER NOT NULL DEFAULT 6 CHECK (plot_count BETWEEN 6 AND 12),
  watchdog_until TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE farm_plot (
  owner_id TEXT NOT NULL REFERENCES principal(id) ON DELETE CASCADE,
  plot_index INTEGER NOT NULL CHECK (plot_index BETWEEN 1 AND 12),
  crop_key TEXT REFERENCES farm_crop(key),
  cycle_id TEXT,
  planted_at TEXT,
  speed_seconds INTEGER NOT NULL DEFAULT 0 CHECK (speed_seconds >= 0),
  watered_at TEXT,
  weeded_at TEXT,
  yield_settled INTEGER NOT NULL DEFAULT 0 CHECK (yield_settled IN (0, 1)),
  settled_bamboo INTEGER NOT NULL DEFAULT 0 CHECK (settled_bamboo >= 0),
  steal_count INTEGER NOT NULL DEFAULT 0 CHECK (steal_count BETWEEN 0 AND 2),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, plot_index),
  CHECK ((crop_key IS NULL AND cycle_id IS NULL AND planted_at IS NULL AND speed_seconds = 0
          AND watered_at IS NULL AND weeded_at IS NULL AND yield_settled = 0 AND settled_bamboo = 0
          AND steal_count = 0)
      OR (crop_key IS NOT NULL AND cycle_id IS NOT NULL AND planted_at IS NOT NULL))
) STRICT;
CREATE UNIQUE INDEX farm_plot_cycle ON farm_plot(cycle_id) WHERE cycle_id IS NOT NULL;

CREATE TABLE farm_relationship (
  source_id TEXT NOT NULL REFERENCES principal(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES principal(id) ON DELETE CASCADE,
  following INTEGER NOT NULL DEFAULT 0 CHECK (following IN (0, 1)),
  blocked INTEGER NOT NULL DEFAULT 0 CHECK (blocked IN (0, 1)),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (source_id, target_id),
  CHECK (source_id <> target_id)
) STRICT;

CREATE TABLE farm_help_log (
  id TEXT PRIMARY KEY,
  cycle_id TEXT NOT NULL,
  plot_owner_id TEXT NOT NULL REFERENCES principal(id) ON DELETE CASCADE,
  plot_index INTEGER NOT NULL CHECK (plot_index BETWEEN 1 AND 12),
  helper_id TEXT NOT NULL REFERENCES principal(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('water', 'weed')),
  day TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (cycle_id, helper_id, action)
) STRICT;
CREATE INDEX farm_help_daily ON farm_help_log(helper_id, day);

CREATE TABLE farm_steal_log (
  id TEXT PRIMARY KEY,
  cycle_id TEXT NOT NULL,
  plot_owner_id TEXT NOT NULL REFERENCES principal(id) ON DELETE CASCADE,
  plot_index INTEGER NOT NULL CHECK (plot_index BETWEEN 1 AND 12),
  thief_id TEXT NOT NULL REFERENCES principal(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL CHECK (amount > 0),
  day TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (cycle_id, thief_id)
) STRICT;
CREATE INDEX farm_steal_daily ON farm_steal_log(thief_id, day);

CREATE TABLE farm_message (
  id TEXT PRIMARY KEY,
  farm_owner_id TEXT NOT NULL REFERENCES principal(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES principal(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 120),
  kind TEXT NOT NULL DEFAULT 'message' CHECK (kind IN ('message', 'watchdog')),
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX farm_message_owner ON farm_message(farm_owner_id, created_at DESC, id DESC);

INSERT INTO farm_crop (key, name, grow_seconds, seed_cost, harvest_bamboo, asset, sort_order) VALUES
  ('token_tomato', 'Token 番茄', 1800, 3, 8, 'assets/game/farm-crop-token-tomato', 10),
  ('prompt_greens', '提示词青菜', 2700, 4, 10, 'assets/game/farm-crop-prompt-greens', 20),
  ('vector_radish', '向量萝卜', 3600, 5, 13, 'assets/game/farm-crop-vector-radish', 30),
  ('context_corn', '上下文玉米', 5400, 7, 17, 'assets/game/farm-crop-context-corn', 40),
  ('embedding_eggplant', '嵌入茄子', 7200, 9, 22, 'assets/game/farm-crop-embedding-eggplant', 50),
  ('rag_pepper', 'RAG 甜椒', 10800, 12, 29, 'assets/game/farm-crop-rag-pepper', 60),
  ('agent_mushroom', 'Agent 蘑菇', 14400, 15, 36, 'assets/game/farm-crop-agent-mushroom', 70),
  ('diff_melon', 'Diff 蜜瓜', 21600, 20, 48, 'assets/game/farm-crop-diff-melon', 80),
  ('lora_lettuce', 'LoRA 生菜', 28800, 26, 62, 'assets/game/farm-crop-lora-lettuce', 90),
  ('cache_cabbage', '缓存甘蓝', 36000, 31, 75, 'assets/game/farm-crop-cache-cabbage', 100),
  ('eval_berry', '评测蓝莓', 57600, 43, 104, 'assets/game/farm-crop-eval-berry', 110),
  ('gpu_pumpkin', 'GPU 南瓜', 86400, 58, 140, 'assets/game/farm-crop-gpu-pumpkin', 120);

INSERT OR IGNORE INTO action_rule
  (action, min_level, roles, owner_only, require_totp, flag, note, updated_at)
VALUES
  ('farm.read', 1, '[]', 0, 0, 'farm.enabled', '查看未被拉黑的农场', '2026-10-25T00:00:00.000000Z'),
  ('farm.play', 1, '[]', 0, 0, 'farm.enabled', '经营自己的农场', '2026-10-25T00:00:00.000000Z'),
  ('farm.help', 1, '[]', 0, 0, 'farm.enabled', '给自己或好友照料作物', '2026-10-25T00:00:00.000000Z'),
  ('farm.steal', 1, '[]', 0, 0, 'farm.enabled', '互相关注的人之间偷菜', '2026-10-25T00:00:00.000000Z'),
  ('farm.message', 1, '[]', 0, 0, 'farm.enabled', '给可见农场留言', '2026-10-25T00:00:00.000000Z');

INSERT OR IGNORE INTO feature_flag (key, enabled, description, updated_at) VALUES
  ('farm.enabled', 1, '先锋农场', '2026-10-25T00:00:00.000000Z');

