-- 0001: schema_version bookkeeping + TTS clip cache (key = sha256(provider|voice|text)).
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  applied_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tts_clip (
  key TEXT PRIMARY KEY,
  text_sha TEXT NOT NULL,
  provider TEXT NOT NULL,
  voice TEXT,
  text TEXT NOT NULL,
  chars TEXT,
  starts TEXT,
  duration_s DOUBLE PRECISION,
  bytes INTEGER,
  audio_b64 TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS tts_clip_text_sha ON tts_clip (text_sha);
