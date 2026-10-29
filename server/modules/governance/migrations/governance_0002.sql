-- LG-4: anonymous third-party intake; complaints never apply sanctions.
CREATE TABLE gov_complaint (
  id TEXT PRIMARY KEY,
  locator TEXT NOT NULL CHECK (length(locator) BETWEEN 1 AND 500),
  category TEXT NOT NULL CHECK (category IN ('copyright', 'privacy', 'illegal', 'other')),
  statement TEXT NOT NULL CHECK (length(statement) BETWEEN 1 AND 2000),
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'reviewed', 'dismissed')),
  reviewer_id TEXT REFERENCES principal(id),
  decision_reason TEXT,
  created_at TEXT NOT NULL,
  decided_at TEXT
) STRICT;
CREATE INDEX gov_complaint_queue ON gov_complaint(state, created_at, id);
INSERT OR IGNORE INTO feature_flag (key, enabled, description, updated_at) VALUES
  ('governance.enabled', 1, '治理台总开关', '2026-10-27T00:00:00.000000Z'),
  ('gov.complaints', 1, '第三方投诉入口', '2026-10-27T00:00:00.000000Z');
