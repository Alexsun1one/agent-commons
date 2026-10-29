CREATE TABLE market_listing (
  object_id TEXT PRIMARY KEY REFERENCES object_head(id),
  category TEXT NOT NULL CHECK (category IN ('sell', 'buy', 'collab', 'jobs', 'groupbuy', 'free')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'reserved', 'sold', 'expired')),
  price TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  shipping TEXT NOT NULL DEFAULT '',
  condition TEXT NOT NULL DEFAULT '',
  budget TEXT NOT NULL DEFAULT '',
  cycle TEXT NOT NULL DEFAULT '',
  company TEXT NOT NULL DEFAULT '',
  position TEXT NOT NULL DEFAULT '',
  work_mode TEXT NOT NULL DEFAULT '',
  target TEXT NOT NULL DEFAULT '',
  deadline TEXT NOT NULL DEFAULT '',
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE INDEX market_listing_browse ON market_listing(status, category, created_at DESC);
CREATE INDEX market_listing_expiry ON market_listing(status, expires_at);

CREATE TABLE market_interest (
  object_id TEXT NOT NULL REFERENCES object_head(id),
  principal_id TEXT NOT NULL REFERENCES principal(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (object_id, principal_id)
) STRICT, WITHOUT ROWID;

CREATE INDEX market_interest_principal ON market_interest(principal_id, object_id);

CREATE TABLE market_report (
  id TEXT PRIMARY KEY,
  object_id TEXT NOT NULL REFERENCES object_head(id),
  reporter_id TEXT NOT NULL REFERENCES principal(id),
  reason_code TEXT NOT NULL CHECK (reason_code IN ('forbidden', 'scam', 'counterfeit', 'contact', 'spam', 'other')),
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_at TEXT NOT NULL,
  closed_at TEXT,
  closed_by TEXT
) STRICT;

CREATE INDEX market_report_queue ON market_report(status, created_at DESC);
CREATE UNIQUE INDEX market_report_open_once ON market_report(object_id, reporter_id) WHERE status = 'open';

INSERT OR IGNORE INTO feature_flag (key, enabled, description, updated_at)
VALUES ('market.enabled', 1, '闲置与线索市集', '2026-10-25T00:00:00.000000Z');

INSERT OR IGNORE INTO action_rule
  (action, min_level, roles, owner_only, require_totp, flag, note, updated_at) VALUES
  ('object.create.market_listing', 1, '[]', 0, 0, 'market.enabled', '发布市集帖子', '2026-10-25T00:00:00.000000Z'),
  ('market.status', 1, '[]', 1, 0, 'market.enabled', '作者修改自己的市集状态', '2026-10-25T00:00:00.000000Z'),
  ('market.want', 1, '[]', 0, 0, 'market.enabled', '对市集帖子表达想要', '2026-10-25T00:00:00.000000Z'),
  ('market.report', 1, '[]', 0, 0, 'market.enabled', '举报市集帖子', '2026-10-25T00:00:00.000000Z'),
  ('market.moderate', NULL, '["admin", "governor"]', 0, 1, 'market.enabled', '查看和关闭市集举报', '2026-10-25T00:00:00.000000Z');
