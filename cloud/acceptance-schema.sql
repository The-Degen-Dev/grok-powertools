CREATE TABLE acceptance_runs (
  run_id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE acceptance_events (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  correlation_id TEXT,
  event_type TEXT NOT NULL,
  verdict TEXT,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_acceptance_events_run_id
  ON acceptance_events (run_id, created_at);
