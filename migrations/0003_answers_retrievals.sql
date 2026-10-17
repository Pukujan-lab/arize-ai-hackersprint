-- 0003: LLM answer cache + Octo retrieval cache in the shared workspace, linked to the runs that used them.
CREATE TABLE IF NOT EXISTS llm_answer (
  key TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  provider TEXT NOT NULL,
  max_tokens INTEGER,
  run_id TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS retrieval (
  key TEXT PRIMARY KEY,
  query TEXT,
  source TEXT NOT NULL,
  passages TEXT NOT NULL,
  n INTEGER,
  run_id TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS run_cache_link (
  run_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  key TEXT NOT NULL,
  hit INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (run_id, kind, key)
);
CREATE INDEX IF NOT EXISTS run_cache_link_key ON run_cache_link (kind, key);
