CREATE TABLE economy_currency (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE economy_rule (
  key TEXT PRIMARY KEY,
  value INTEGER NOT NULL CHECK (value >= 0),
  description TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT REFERENCES principal(id)
) STRICT;

CREATE TABLE economy_reason_limit (
  currency TEXT NOT NULL REFERENCES economy_currency(code),
  reason TEXT NOT NULL,
  daily_cap INTEGER NOT NULL CHECK (daily_cap >= 0),
  updated_at TEXT NOT NULL,
  updated_by TEXT REFERENCES principal(id),
  PRIMARY KEY (currency, reason)
) STRICT, WITHOUT ROWID;

CREATE TABLE wallet_balance (
  principal_id TEXT NOT NULL REFERENCES principal(id),
  currency TEXT NOT NULL REFERENCES economy_currency(code),
  balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (principal_id, currency)
) STRICT, WITHOUT ROWID;

CREATE TABLE economy_operation (
  idempotency_key TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('credit', 'debit', 'transfer', 'admin_adjust')),
  principal_id TEXT NOT NULL REFERENCES principal(id),
  counterparty_id TEXT REFERENCES principal(id),
  currency TEXT NOT NULL REFERENCES economy_currency(code),
  requested_amount INTEGER NOT NULL CHECK (requested_amount > 0),
  actual_amount INTEGER NOT NULL CHECK (actual_amount >= 0),
  reason TEXT NOT NULL,
  ref TEXT,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE wallet_entry (
  id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL REFERENCES principal(id),
  currency TEXT NOT NULL REFERENCES economy_currency(code),
  amount INTEGER NOT NULL CHECK (amount != 0),
  requested_amount INTEGER NOT NULL CHECK (requested_amount > 0),
  reason TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  ref TEXT,
  counterparty_id TEXT REFERENCES principal(id),
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX wallet_entry_by_owner ON wallet_entry(principal_id, currency, created_at DESC, id DESC);
CREATE INDEX wallet_entry_by_pair ON wallet_entry(principal_id, counterparty_id, created_at DESC);

CREATE TRIGGER wallet_entry_nonnegative BEFORE INSERT ON wallet_entry
BEGIN
  SELECT CASE WHEN coalesce((
    SELECT balance FROM wallet_balance
    WHERE principal_id = NEW.principal_id AND currency = NEW.currency
  ), 0) + NEW.amount < 0
  THEN RAISE(ABORT, 'wallet balance would be negative') END;
END;

CREATE TRIGGER wallet_entry_cache AFTER INSERT ON wallet_entry
BEGIN
  INSERT INTO wallet_balance (principal_id, currency, balance, updated_at)
  VALUES (NEW.principal_id, NEW.currency, CASE WHEN NEW.amount > 0 THEN NEW.amount ELSE 0 END, NEW.created_at)
  ON CONFLICT(principal_id, currency) DO UPDATE SET
    balance = wallet_balance.balance + NEW.amount,
    updated_at = NEW.created_at;
END;

CREATE TRIGGER wallet_entry_no_update BEFORE UPDATE ON wallet_entry
BEGIN SELECT RAISE(ABORT, 'wallet_entry is append-only'); END;
CREATE TRIGGER wallet_entry_no_delete BEFORE DELETE ON wallet_entry
BEGIN SELECT RAISE(ABORT, 'wallet_entry is append-only'); END;

CREATE TABLE wallet_daily_earning (
  principal_id TEXT NOT NULL REFERENCES principal(id),
  currency TEXT NOT NULL REFERENCES economy_currency(code),
  day TEXT NOT NULL,
  amount INTEGER NOT NULL DEFAULT 0 CHECK (amount >= 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (principal_id, currency, day)
) STRICT, WITHOUT ROWID;

CREATE TABLE economy_transfer (
  id TEXT PRIMARY KEY,
  from_id TEXT NOT NULL REFERENCES principal(id),
  to_id TEXT NOT NULL REFERENCES principal(id),
  currency TEXT NOT NULL REFERENCES economy_currency(code),
  amount INTEGER NOT NULL CHECK (amount > 0),
  reason TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  ref TEXT,
  created_at TEXT NOT NULL,
  CHECK (from_id != to_id)
) STRICT;
CREATE INDEX economy_transfer_pair ON economy_transfer(from_id, to_id, created_at DESC);
CREATE TRIGGER economy_transfer_no_update BEFORE UPDATE ON economy_transfer
BEGIN SELECT RAISE(ABORT, 'economy_transfer is append-only'); END;
CREATE TRIGGER economy_transfer_no_delete BEFORE DELETE ON economy_transfer
BEGIN SELECT RAISE(ABORT, 'economy_transfer is append-only'); END;

CREATE TABLE economy_anomaly_marker (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('daily_net_inflow', 'pair_roundtrip')),
  principal_id TEXT NOT NULL,
  peer_id TEXT NOT NULL DEFAULT '',
  day TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount >= 0),
  created_at TEXT NOT NULL,
  UNIQUE (kind, principal_id, peer_id, day)
) STRICT;

CREATE TABLE economy_shop_item (
  item_key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('avatar_frame', 'panda_palette', 'farm_decor', 'vehicle', 'sticker_pack')),
  price INTEGER NOT NULL CHECK (price >= 0),
  limited_total INTEGER CHECK (limited_total IS NULL OR limited_total > 0),
  available_at TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
) STRICT;
CREATE INDEX economy_shop_shelf ON economy_shop_item(category, sort_order, item_key);

CREATE TABLE economy_shop_purchase (
  id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL REFERENCES principal(id),
  item_key TEXT NOT NULL REFERENCES economy_shop_item(item_key),
  price INTEGER NOT NULL CHECK (price >= 0),
  currency TEXT NOT NULL REFERENCES economy_currency(code),
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  UNIQUE (principal_id, item_key)
) STRICT;
CREATE TRIGGER economy_shop_purchase_no_update BEFORE UPDATE ON economy_shop_purchase
BEGIN SELECT RAISE(ABORT, 'economy_shop_purchase is append-only'); END;
CREATE TRIGGER economy_shop_purchase_no_delete BEFORE DELETE ON economy_shop_purchase
BEGIN SELECT RAISE(ABORT, 'economy_shop_purchase is append-only'); END;

CREATE TABLE economy_inventory (
  principal_id TEXT NOT NULL REFERENCES principal(id),
  item_key TEXT NOT NULL REFERENCES economy_shop_item(item_key),
  equipped INTEGER NOT NULL DEFAULT 0 CHECK (equipped IN (0, 1)),
  acquired_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (principal_id, item_key)
) STRICT, WITHOUT ROWID;

CREATE TABLE economy_checkin (
  principal_id TEXT PRIMARY KEY REFERENCES principal(id),
  last_day TEXT NOT NULL,
  streak INTEGER NOT NULL CHECK (streak >= 1),
  total_days INTEGER NOT NULL CHECK (total_days >= 1),
  last_reward INTEGER NOT NULL CHECK (last_reward >= 0),
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE economy_checkin_reward (
  cycle_day INTEGER PRIMARY KEY CHECK (cycle_day BETWEEN 1 AND 7),
  amount INTEGER NOT NULL CHECK (amount > 0)
) STRICT;

INSERT INTO economy_currency (code, name, enabled, created_at)
VALUES ('bamboo', '竹子', 1, '2026-10-25T00:00:00.000000Z');

INSERT INTO economy_rule (key, value, description, updated_at) VALUES
  ('daily_credit_cap', 300, '每人每天获得竹子的全局上限', '2026-10-25T00:00:00.000000Z'),
  ('new_account_days', 7, '新账号上限减半的天数', '2026-10-25T00:00:00.000000Z'),
  ('anomaly_daily_net', 250, '单日净流入异常阈值', '2026-10-25T00:00:00.000000Z'),
  ('anomaly_pair_roundtrip', 120, '两人双向转移异常阈值', '2026-10-25T00:00:00.000000Z');

INSERT INTO economy_reason_limit (currency, reason, daily_cap, updated_at) VALUES
  ('bamboo', 'economy.checkin', 80, '2026-10-25T00:00:00.000000Z');

INSERT INTO economy_checkin_reward (cycle_day, amount) VALUES
  (1, 10), (2, 15), (3, 20), (4, 25), (5, 30), (6, 40), (7, 80);

INSERT INTO economy_shop_item (item_key, name, category, price, limited_total, available_at, sort_order) VALUES
  ('frame-bamboo-mist', '青篁外框', 'avatar_frame', 80, NULL, '2026-10-25T00:00:00.000000Z', 10),
  ('frame-blue-ink', '蓝墨边界', 'avatar_frame', 120, NULL, '2026-10-25T00:00:00.000000Z', 20),
  ('frame-cloud-trace', '云影细框', 'avatar_frame', 160, 500, '2026-10-25T00:00:00.000000Z', 30),
  ('frame-night-radio', '深夜电台', 'avatar_frame', 220, 200, '2026-10-25T00:00:00.000000Z', 40),
  ('panda-pioneer-blue', '先锋蓝', 'panda_palette', 100, NULL, '2026-10-25T00:00:00.000000Z', 50),
  ('panda-mint', '薄荷青', 'panda_palette', 130, NULL, '2026-10-25T00:00:00.000000Z', 60),
  ('panda-mist-violet', '雾紫', 'panda_palette', 160, NULL, '2026-10-25T00:00:00.000000Z', 70),
  ('panda-graphite', '石墨灰', 'panda_palette', 180, NULL, '2026-10-25T00:00:00.000000Z', 80),
  ('farm-waterwheel', '竹影水车', 'farm_decor', 90, NULL, '2026-10-25T00:00:00.000000Z', 90),
  ('farm-cloud-awning', '小云雨棚', 'farm_decor', 110, NULL, '2026-10-25T00:00:00.000000Z', 100),
  ('farm-stone-sign', '青石路牌', 'farm_decor', 140, NULL, '2026-10-25T00:00:00.000000Z', 110),
  ('farm-star-scarecrow', '星图稻草人', 'farm_decor', 200, 300, '2026-10-25T00:00:00.000000Z', 120),
  ('car-sea-salt', '海盐小车', 'vehicle', 150, NULL, '2026-10-25T00:00:00.000000Z', 130),
  ('car-blue-whale', '蓝鲸通勤车', 'vehicle', 220, NULL, '2026-10-25T00:00:00.000000Z', 140),
  ('car-violet-tour', '雾紫巡游车', 'vehicle', 320, 240, '2026-10-25T00:00:00.000000Z', 150),
  ('car-night-flight', '夜航概念车', 'vehicle', 480, 80, '2026-10-25T00:00:00.000000Z', 160),
  ('sticker-it-works', '终于跑通', 'sticker_pack', 60, NULL, '2026-10-25T00:00:00.000000Z', 170),
  ('sticker-water-break', '先喝口水', 'sticker_pack', 70, NULL, '2026-10-25T00:00:00.000000Z', 180),
  ('sticker-reproduce', '我来复现', 'sticker_pack', 90, NULL, '2026-10-25T00:00:00.000000Z', 190),
  ('sticker-ship-today', '今天封板', 'sticker_pack', 120, 600, '2026-10-25T00:00:00.000000Z', 200);

INSERT OR IGNORE INTO action_rule (action, min_level, roles, owner_only, require_totp, flag, note, updated_at) VALUES
  ('economy.read', 1, '[]', 0, 0, 'economy.enabled', '查看自己的竹子与商店', '2026-10-25T00:00:00.000000Z'),
  ('economy.shop.buy', 1, '[]', 0, 0, 'economy.enabled', '购买竹子商店外观', '2026-10-25T00:00:00.000000Z'),
  ('economy.inventory.equip', 1, '[]', 0, 0, 'economy.enabled', '装备已拥有的外观', '2026-10-25T00:00:00.000000Z'),
  ('economy.checkin', 1, '[]', 0, 0, 'economy.enabled', '每日签到领取竹子', '2026-10-25T00:00:00.000000Z'),
  ('economy.admin.adjust', NULL, '["admin"]', 0, 1, 'economy.enabled', '管理员带理由调账', '2026-10-25T00:00:00.000000Z');

INSERT OR IGNORE INTO feature_flag (key, enabled, description, updated_at)
VALUES ('economy.enabled', 1, '竹子经济、签到与外观商店', '2026-10-25T00:00:00.000000Z');
