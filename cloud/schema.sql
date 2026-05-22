CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT,
  name TEXT,
  image TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE collections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE movies (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE settings (
  user_id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE r2_dedupe_index (
  user_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  canonical_object_key TEXT NOT NULL,
  source_url_hashes TEXT NOT NULL DEFAULT '[]',
  content_sha256 TEXT,
  media_type TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  upload_status TEXT NOT NULL,
  duplicate_object_keys TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (user_id, asset_id),
  UNIQUE (canonical_object_key)
);

CREATE UNIQUE INDEX idx_r2_dedupe_user_content_type
  ON r2_dedupe_index (user_id, content_sha256, media_type)
  WHERE content_sha256 IS NOT NULL;

CREATE TABLE metadata_snapshot_index (
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  object_key TEXT NOT NULL,
  first_written_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  PRIMARY KEY (user_id, kind, content_hash),
  UNIQUE (object_key)
);
