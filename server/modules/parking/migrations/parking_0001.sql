CREATE TABLE parking_lot (
  owner_id TEXT PRIMARY KEY REFERENCES principal(id),
  capacity INTEGER NOT NULL DEFAULT 4 CHECK (capacity BETWEEN 4 AND 8),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE parking_space (
  owner_id TEXT NOT NULL REFERENCES parking_lot(owner_id) ON DELETE CASCADE,
  slot_no INTEGER NOT NULL CHECK (slot_no BETWEEN 1 AND 8),
  is_welcome INTEGER NOT NULL DEFAULT 0 CHECK (is_welcome IN (0, 1)),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, slot_no)
) STRICT, WITHOUT ROWID;

CREATE TABLE parking_vehicle_model (
  key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  hourly_rate INTEGER NOT NULL CHECK (hourly_rate BETWEEN 1 AND 12),
  asset_path TEXT NOT NULL
) STRICT, WITHOUT ROWID;

INSERT INTO parking_vehicle_model (key, name, hourly_rate, asset_path) VALUES
  ('cloud', '云朵小车', 8, 'assets/game/park-car-cloud.webp'),
  ('pixel', '像素巡游车', 9, 'assets/game/park-car-pixel.webp'),
  ('vector', '向量旅行车', 10, 'assets/game/park-car-vector.webp'),
  ('agent', 'Agent 跑车', 12, 'assets/game/park-car-agent.webp');

CREATE TABLE parking_vehicle (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES principal(id),
  model_key TEXT NOT NULL REFERENCES parking_vehicle_model(key),
  nickname TEXT NOT NULL,
  acquired_at TEXT NOT NULL
) STRICT;
CREATE INDEX parking_vehicle_owner ON parking_vehicle(owner_id, acquired_at, id);

CREATE TABLE parking_stay (
  id TEXT PRIMARY KEY,
  vehicle_id TEXT NOT NULL REFERENCES parking_vehicle(id),
  lot_owner_id TEXT NOT NULL REFERENCES principal(id),
  slot_no INTEGER NOT NULL CHECK (slot_no BETWEEN 1 AND 8),
  message TEXT NOT NULL DEFAULT '',
  welcome_at_park INTEGER NOT NULL DEFAULT 0 CHECK (welcome_at_park IN (0, 1)),
  parked_at TEXT NOT NULL,
  ended_at TEXT,
  end_reason TEXT CHECK (end_reason IS NULL OR end_reason IN ('move', 'ticket')),
  gross_earned INTEGER NOT NULL DEFAULT 0 CHECK (gross_earned >= 0),
  parker_share INTEGER NOT NULL DEFAULT 0 CHECK (parker_share >= 0),
  owner_share INTEGER NOT NULL DEFAULT 0 CHECK (owner_share >= 0),
  FOREIGN KEY (lot_owner_id, slot_no) REFERENCES parking_space(owner_id, slot_no)
) STRICT;
CREATE UNIQUE INDEX parking_active_vehicle ON parking_stay(vehicle_id) WHERE ended_at IS NULL;
CREATE UNIQUE INDEX parking_active_space ON parking_stay(lot_owner_id, slot_no) WHERE ended_at IS NULL;
CREATE INDEX parking_stay_lot ON parking_stay(lot_owner_id, ended_at, slot_no);
CREATE INDEX parking_ticket_day ON parking_stay(lot_owner_id, ended_at) WHERE end_reason = 'ticket';

INSERT OR IGNORE INTO action_rule (action, min_level, roles, owner_only, require_totp, flag, note, updated_at) VALUES
  ('parking.read', 1, '[]', 0, 0, 'parking.game', '查看停车场', '2026-10-25T00:00:00.000000Z'),
  ('parking.park', 1, '[]', 0, 0, 'parking.game', '把车停到好友车位', '2026-10-25T00:00:00.000000Z'),
  ('parking.move', 1, '[]', 0, 0, 'parking.game', '挪车并结算', '2026-10-25T00:00:00.000000Z'),
  ('parking.ticket', 1, '[]', 0, 0, 'parking.game', '给占位车辆贴条', '2026-10-25T00:00:00.000000Z'),
  ('parking.welcome', 1, '[]', 0, 0, 'parking.game', '设置欢迎停车位', '2026-10-25T00:00:00.000000Z');

INSERT OR IGNORE INTO feature_flag (key, enabled, description, updated_at) VALUES
  ('parking.game', 1, '抢车位与停车结算', '2026-10-25T00:00:00.000000Z');

