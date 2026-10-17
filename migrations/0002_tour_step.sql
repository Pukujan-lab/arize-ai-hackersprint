-- 0002: per-step tour metadata so each clip links to its sources and map pin.
CREATE TABLE IF NOT EXISTS tour_step (
  run_id TEXT NOT NULL,
  step_index INTEGER NOT NULL,
  text TEXT NOT NULL,
  clip_key TEXT,
  provider TEXT,
  duration_s DOUBLE PRECISION,
  cite_ids TEXT,
  refs TEXT,
  node_ids TEXT,
  coords TEXT,
  phase TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (run_id, step_index)
);
