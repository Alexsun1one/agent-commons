-- ANNOUNCE-1 · 公告、跑马灯短讯、广告活动与聚合计数。预算先留空，不记账。

CREATE TABLE announce_item (
  id TEXT PRIMARY KEY,
  level TEXT NOT NULL CHECK (level IN ('normal', 'important', 'maintenance')),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 40),
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 160),
  audience TEXT NOT NULL CHECK (audience IN ('site', 'level', 'group')),
  min_level INTEGER CHECK (min_level IS NULL OR min_level BETWEEN 1 AND 5),
  group_id TEXT REFERENCES space(id),
  starts_at TEXT NOT NULL,
  ends_at TEXT,
  dismissible INTEGER NOT NULL CHECK (dismissible IN (0, 1)),
  status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'archived')),
  created_by TEXT REFERENCES principal(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    (audience = 'site' AND min_level IS NULL AND group_id IS NULL)
    OR (audience = 'level' AND min_level BETWEEN 1 AND 5 AND group_id IS NULL)
    OR (audience = 'group' AND group_id IS NOT NULL AND min_level IS NULL)
  ),
  CHECK (ends_at IS NULL OR ends_at > starts_at)
) STRICT;
CREATE INDEX announce_item_window ON announce_item(status, starts_at);

CREATE TABLE announce_dismiss (
  principal_id TEXT NOT NULL REFERENCES principal(id),
  item_id TEXT NOT NULL REFERENCES announce_item(id),
  dismissed_at TEXT NOT NULL,
  PRIMARY KEY (principal_id, item_id)
) STRICT, WITHOUT ROWID;

CREATE TABLE announce_ticker (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('manual', 'system')),
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 80),
  public INTEGER NOT NULL CHECK (public IN (0, 1)),
  starts_at TEXT NOT NULL,
  ends_at TEXT,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  position INTEGER NOT NULL DEFAULT 0,
  created_by TEXT REFERENCES principal(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  CHECK (kind = 'manual' OR public = 1),
  CHECK (ends_at IS NULL OR ends_at > starts_at)
) STRICT;
CREATE INDEX announce_ticker_queue ON announce_ticker(enabled, position, created_at);

CREATE TABLE announce_campaign (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  placement TEXT NOT NULL CHECK (placement IN ('hot-side', 'events', 'market-8', 'games-foot')),
  image_url TEXT NOT NULL CHECK (length(image_url) BETWEEN 1 AND 300),
  line TEXT NOT NULL CHECK (length(line) BETWEEN 1 AND 36),
  link_url TEXT NOT NULL CHECK (length(link_url) BETWEEN 1 AND 300),
  why TEXT NOT NULL CHECK (length(why) BETWEEN 1 AND 40),
  status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'paused', 'ended')),
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  freq_cap INTEGER NOT NULL DEFAULT 3 CHECK (freq_cap BETWEEN 1 AND 3),
  budget_cents INTEGER CHECK (budget_cents IS NULL OR budget_cents >= 0),
  created_by TEXT REFERENCES principal(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (ends_at > starts_at)
) STRICT;
CREATE INDEX announce_campaign_place ON announce_campaign(placement, status, starts_at);

-- 只为「同一广告每人每天最多 3 次」服务。管理统计不读这张表。
CREATE TABLE announce_ad_cap (
  principal_id TEXT NOT NULL REFERENCES principal(id),
  campaign_id TEXT NOT NULL REFERENCES announce_campaign(id),
  day TEXT NOT NULL,
  shown INTEGER NOT NULL CHECK (shown >= 0),
  PRIMARY KEY (principal_id, campaign_id, day)
) STRICT, WITHOUT ROWID;

-- 展示和点击只按广告、日期、位置累加，没有读者。
CREATE TABLE announce_ad_stat (
  campaign_id TEXT NOT NULL REFERENCES announce_campaign(id),
  day TEXT NOT NULL,
  placement TEXT NOT NULL,
  impressions INTEGER NOT NULL DEFAULT 0 CHECK (impressions >= 0),
  clicks INTEGER NOT NULL DEFAULT 0 CHECK (clicks >= 0),
  PRIMARY KEY (campaign_id, day, placement)
) STRICT, WITHOUT ROWID;

CREATE TABLE announce_pref (
  principal_id TEXT PRIMARY KEY REFERENCES principal(id),
  marquee_on INTEGER NOT NULL CHECK (marquee_on IN (0, 1)),
  ads_on INTEGER NOT NULL CHECK (ads_on IN (0, 1)),
  updated_at TEXT NOT NULL
) STRICT;

INSERT OR IGNORE INTO action_rule
  (action, min_level, roles, owner_only, require_totp, flag, note, updated_at)
VALUES
  ('announce.read', 1, '[]', 0, 0, 'announce.enabled', '查看当前公告、短讯和自己能看到的广告位', '2026-10-25T00:00:00.000000Z'),
  ('announce.pref', 1, '[]', 0, 0, 'announce.enabled', '关闭公告、开关跑马灯；关广告另受等级或会员约束', '2026-10-25T00:00:00.000000Z'),
  ('announce.admin', NULL, '["admin"]', 0, 1, 'announce.enabled', '编辑公告、短讯和广告活动', '2026-10-25T00:00:00.000000Z');

INSERT OR IGNORE INTO feature_flag (key, enabled, description, updated_at)
VALUES ('announce.enabled', 1, '公告、跑马灯与广告位', '2026-10-25T00:00:00.000000Z');
