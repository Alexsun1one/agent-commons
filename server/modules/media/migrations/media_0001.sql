CREATE TABLE media_quota (
  bucket TEXT NOT NULL CHECK (bucket IN ('file', 'avatar')),
  level INTEGER NOT NULL CHECK (level BETWEEN 1 AND 5),
  daily_count INTEGER NOT NULL CHECK (daily_count >= 0),
  max_bytes INTEGER NOT NULL CHECK (max_bytes >= 0),
  updated_at TEXT NOT NULL,
  updated_by TEXT,
  PRIMARY KEY (bucket, level)
) STRICT, WITHOUT ROWID;

CREATE TABLE media_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT, WITHOUT ROWID;

CREATE TABLE media_upload (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES principal(id),
  purpose TEXT NOT NULL CHECK (purpose IN ('image', 'avatar', 'html', 'thumbnail')),
  filename TEXT NOT NULL,
  size INTEGER NOT NULL CHECK (size > 0),
  sha256 TEXT NOT NULL,
  chunks INTEGER NOT NULL CHECK (chunks >= 1),
  state TEXT NOT NULL CHECK (state IN ('receiving', 'processing', 'ready', 'rejected')),
  reject_code TEXT,
  kind TEXT,
  raw_key TEXT,
  params_json TEXT NOT NULL DEFAULT '{}',
  asset_id TEXT,
  day TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX media_upload_quota ON media_upload(owner_id, day);

CREATE TABLE media_chunk (
  upload_id TEXT NOT NULL REFERENCES media_upload(id),
  idx INTEGER NOT NULL,
  data BLOB NOT NULL,
  UNIQUE (upload_id, idx)
) STRICT;

CREATE TABLE media_asset (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES principal(id),
  purpose TEXT NOT NULL CHECK (purpose IN ('image', 'avatar', 'html', 'thumbnail')),
  mime TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  bytes INTEGER NOT NULL,
  raw_key TEXT,
  file_key TEXT,
  color TEXT,
  blur TEXT,
  parent_id TEXT,
  self_drawn INTEGER NOT NULL DEFAULT 0 CHECK (self_drawn IN (0, 1)),
  check_json TEXT NOT NULL DEFAULT '{}',
  state TEXT NOT NULL CHECK (state IN ('ready', 'deleted')),
  created_at TEXT NOT NULL,
  deleted_at TEXT
) STRICT;
CREATE INDEX media_asset_by_owner ON media_asset(owner_id, created_at);
CREATE INDEX media_asset_by_parent ON media_asset(parent_id);

CREATE TABLE media_variant (
  asset_id TEXT NOT NULL REFERENCES media_asset(id),
  name TEXT NOT NULL,
  ext TEXT NOT NULL CHECK (ext IN ('webp', 'jpg', 'avif')),
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  PRIMARY KEY (asset_id, name)
) STRICT, WITHOUT ROWID;
CREATE INDEX media_variant_by_sha ON media_variant(sha256, ext);

CREATE TABLE media_attachment (
  asset_id TEXT NOT NULL REFERENCES media_asset(id),
  object_id TEXT NOT NULL REFERENCES object_head(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (asset_id, object_id)
) STRICT, WITHOUT ROWID;
CREATE INDEX media_attachment_by_object ON media_attachment(object_id);

INSERT INTO media_quota (bucket, level, daily_count, max_bytes, updated_at) VALUES
  ('file', 1, 0, 0, '2026-10-25T00:00:00.000000Z'),
  ('file', 2, 20, 10485760, '2026-10-25T00:00:00.000000Z'),
  ('file', 3, 50, 10485760, '2026-10-25T00:00:00.000000Z'),
  ('file', 4, 100, 10485760, '2026-10-25T00:00:00.000000Z'),
  ('file', 5, 200, 10485760, '2026-10-25T00:00:00.000000Z'),
  ('avatar', 1, 5, 5242880, '2026-10-25T00:00:00.000000Z'),
  ('avatar', 2, 5, 5242880, '2026-10-25T00:00:00.000000Z'),
  ('avatar', 3, 10, 5242880, '2026-10-25T00:00:00.000000Z'),
  ('avatar', 4, 10, 5242880, '2026-10-25T00:00:00.000000Z'),
  ('avatar', 5, 10, 5242880, '2026-10-25T00:00:00.000000Z');

INSERT OR IGNORE INTO action_rule (action, min_level, roles, owner_only, require_totp, flag, note, updated_at) VALUES
  ('upload.create', 2, '[]', 0, 0, 'media.uploads', 'L2 起上传图片、HTML 作品和缩略图（配额见 media_quota）', '2026-10-25T00:00:00.000000Z'),
  ('upload.avatar', 1, '[]', 0, 0, 'media.uploads', '上传头像（单独配额，见 media_quota 的 avatar 桶）', '2026-10-25T00:00:00.000000Z'),
  ('media.quota.edit', NULL, '["admin"]', 0, 1, NULL, '管理员调整上传配额', '2026-10-25T00:00:00.000000Z');

INSERT OR IGNORE INTO feature_flag (key, enabled, description, updated_at) VALUES
  ('media.uploads', 1, '上传与图片管线', '2026-10-25T00:00:00.000000Z');
