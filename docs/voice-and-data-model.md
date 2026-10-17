# Voice, caches and the data model

This page holds the technical detail behind the app's voice output, the answer and retrieval caches, and the versioned Octo tables they use. It was written with the TTS chain and Octo cache changes (PRs #11 and #16) and moved here from the README when the backend moved into `app/`. Module paths are updated for that move; nothing else changed. `contracts/storage.json` lists the same stores in machine-readable form.

## Voice (TTS)

`app/ttschain.py` serves `/api/tts` (mp3) and `/api/tts_ts` (`{audio_b64, chars, starts, cache, provider}`); every response carries `X-TTS-Provider` and `X-TTS-Cache`.

- **Provider chain:** Fish Audio (5 s timeout, so Kokoro can still answer inside the browser's 8 s limit, `FISH_TTS_PER_HOUR` cap, default 200), then ElevenLabs (only if keyed), then **Kokoro**, then `429 {fallback:"browser"}`, at which point the page speaks with `speechSynthesis`. A provider is skipped when it is capped, disabled (`TTS_DISABLE_FISH=1`, `TTS_DISABLE_KOKORO=1`), or returns 401/402/429/5xx or an error. `/api/health` reports `tts: ["fish","kokoro","browser"]`, `fish`, `kokoro`, `tts_cache`, `data_schema`.
- **Kokoro** is a separate local service (`tools/kokoro/`): kokoro-onnx in its own py3.12 venv at `~/kokoro`, OpenAI-style `POST /v1/audio/speech` on `127.0.0.1:8880` (`KOKORO_URL`), voice `af_heart`. Install it or update it with `tools/kokoro/install.sh`, which sets up the launchd agent `com.precedent.kokoro` (RunAtLoad, KeepAlive). It has no word timings, so `starts` is spread evenly over the clip duration.
- **Queue:** one worker generates every clip, so a tour never starts parallel Fish calls. Identical in-flight requests share one job. A line the user is waiting on goes first. `POST /api/tour/prefetch {run_id, steps:[{step_index, text, cite_ids, refs, node_ids, coords}]}` queues a tour: the first 2 steps go alone for a fast start, then the rest go as a background batch in playback order.
- **Cache:** every request checks the cache before calling a provider, so each line reaches a paid API at most once and cache hits don't count against caps. The clip key is `sha256(provider|voice|text)`. L1 is local: `.tts_cache/` (SQLite index plus `.mp3` files, git-ignored, `TTS_CACHE_DIR`). L2 is shared: the **Octo workspace**, a managed PostgreSQL 16 reached through `POST {OCTO_BASE_URL}/workspaces/{OCTO_WORKSPACE_ID}/query`, which holds the `tts_clip` table with base64 audio. An L2 hit fills L1. Octo writes happen asynchronously. If Octo is down or its schema doesn't match, the app runs on L1 only.
- **Tour metadata:** `GET /api/tour/{run_id}` returns each step's `clip_key`, `provider`, `duration_s`, `cite_ids`, `refs`, `node_ids`, `coords`, `phase`, and `ready`, so the UI can highlight the cited source or map pin while that clip plays.

## Answer and retrieval caches

The LLM answer cache (`app/llm.py`) and the Octo passage-retrieval cache (`app/octo_retriever.py`) use the same layering as TTS (`app/octocache.py`): the local file is checked first (`cache/<key>.json`, `cache/octo/<key>.json`), then the shared Octo tables `llm_answer` and `retrieval`. An Octo hit is copied back to the local file, and new entries are written locally and pushed to Octo in the background. Every run's use of a cached row is recorded in `run_cache_link` (`run_id`, `kind`, `key`, `hit`). Template, empty, reasoning-only, and pre-PR #5 answers are never served or stored. `python -m schema.backfill` runs on deploy: it uploads local entries and moves stale local files to `cache/_purged/`.

## Data model and migrations

- `schema/__init__.py` holds `SCHEMA_VERSION` and `MODELS` (`tts_clip`, `tour_step`, `schema_version`) plus `validate()`. `migrations/NNNN_name.sql` are numbered and portable (they run on Postgres and SQLite).
- `python -m schema.migrate [--apply]` compares and applies migrations to Octo. Each applied migration writes a `schema_version` row. The deploy step (`deploy/deploy.sh`) runs `--apply`. On startup the app checks that Octo's version equals `SCHEMA_VERSION` and uses Octo only when they match.
- To change the schema: bump `SCHEMA_VERSION`, add the next numbered migration (never edit a released one), then run `python -m schema.lock`. CI (`tests/test_schema.py`) checks that models validate, that migrations apply in order and are idempotent on an in-memory store, that the version equals the newest migration, and that the schema fingerprint matches `schema/schema.lock.json`. That last check fails if the schema changes without a version bump.
