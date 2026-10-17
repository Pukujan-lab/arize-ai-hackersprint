# Precedent

[![CI](https://github.com/Pukujan/arize-ai-hackersprint/actions/workflows/ci.yml/badge.svg)](https://github.com/Pukujan/arize-ai-hackersprint/actions/workflows/ci.yml)

Precedent is a reliable pipeline for multi-agent AI. Several agents split up a job,
each one claims its piece, and every answer is checked before it goes out.

The first use case is legal research: verified research memos for law firms and
in-house legal teams. You ask a question, the agents pull the relevant cases, walk
the citation graph, draft a short memo with exact quotes, and a guard step refuses
anything it can't back up.

Live at https://arize.design-bakery.com.

## Layout

The backend is a FastAPI app; its modules sit at the repo root.

- `server.py` - the FastAPI app and API routes
- `agents.py` - the agent pipeline
- `llm.py` - model calls: InferHub DeepSeek first, then Anthropic Haiku, then a plain template if both fail
- `graph_store.py` - the case/citation graph (SurrealDB, with a NetworkX fallback)
- `coord.py`, `acs_board.py`, `acs_claim.py` - agent coordination (who claims what); state lives in `.coord/`
- `tracing.py` - tracing to Arize

`static/` holds the frontend: plain HTML and JS, no build step. Pages: demo
(`index.html`), map, dashboard, slides, guide, observability.

Other folders:

- `tests/` - tests
- `ci/` - CI triage scripts
- `tools/` - screenshots, video, Arize helpers
- `arize/` - Arize experiments and judge setup
- `issues/` - notes on open issues

## Running it

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
uvicorn server:app --port 3000
```

Then open http://localhost:3000.

Set these environment variables (in your shell or a local `.env` - never commit it):

- `INFERHUB_API_KEY`
- `ANTHROPIC_API_KEY`
- `ARIZE_API_KEY`, `ARIZE_SPACE_ID`, `ARIZE_PROJECT_NAME`
- `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`
- `OCTO_API_KEY`, `OCTO_WORKSPACE_ID`, `OCTO_BASE_URL`
- `GRAPH_DATA_DIR` - where the case data lives (defaults to `data/` in the repo)

Note: the case data (`data/nodes.jsonl`, `data/edges.jsonl`) isn't in the repo yet.

## How it was built

Built with ABA. See `ABA_BUILD_LOG.md` for the build log.

## Voice (TTS)

`ttschain.py` serves `/api/tts` (mp3) and `/api/tts_ts` (`{audio_b64, chars, starts, cache, provider}`); every response carries `X-TTS-Provider` and `X-TTS-Cache`.

- **Provider chain:** Fish Audio (5 s timeout, so Kokoro can still answer inside the browser's 8 s limit, `FISH_TTS_PER_HOUR` cap, default 200), then ElevenLabs (only if keyed), then **Kokoro**, then `429 {fallback:"browser"}`, at which point the page speaks with `speechSynthesis`. A provider is skipped when it is capped, disabled (`TTS_DISABLE_FISH=1`, `TTS_DISABLE_KOKORO=1`), or returns 401/402/429/5xx or an error. `/api/health` reports `tts: ["fish","kokoro","browser"]`, `fish`, `kokoro`, `tts_cache`, `data_schema`.
- **Kokoro** is a separate local service (`tools/kokoro/`): kokoro-onnx in its own py3.12 venv at `~/kokoro`, OpenAI-style `POST /v1/audio/speech` on `127.0.0.1:8880` (`KOKORO_URL`), voice `af_heart`. Install it or update it with `tools/kokoro/install.sh`, which sets up the launchd agent `com.precedent.kokoro` (RunAtLoad, KeepAlive). It has no word timings, so `starts` is spread evenly over the clip duration.
- **Queue:** one worker generates every clip, so a tour never starts parallel Fish calls. Identical in-flight requests share one job. A line the user is waiting on goes first. `POST /api/tour/prefetch {run_id, steps:[{step_index, text, cite_ids, refs, node_ids, coords}]}` queues a tour: the first 2 steps go alone for a fast start, then the rest go as a background batch in playback order.
- **Cache:** every request checks the cache before calling a provider, so each line reaches a paid API at most once and cache hits don't count against caps. The clip key is `sha256(provider|voice|text)`. L1 is local: `.tts_cache/` (SQLite index plus `.mp3` files, git-ignored, `TTS_CACHE_DIR`). L2 is shared: the **Octo workspace**, a managed PostgreSQL 16 reached through `POST {OCTO_BASE_URL}/workspaces/{OCTO_WORKSPACE_ID}/query`, which holds the `tts_clip` table with base64 audio. An L2 hit fills L1. Octo writes happen asynchronously. If Octo is down or its schema doesn't match, the app runs on L1 only.
- **Tour metadata:** `GET /api/tour/{run_id}` returns each step's `clip_key`, `provider`, `duration_s`, `cite_ids`, `refs`, `node_ids`, `coords`, `phase`, and `ready`, so the UI can highlight the cited source or map pin while that clip plays.

## Answer and retrieval caches

The LLM answer cache (`llm.py`) and the Octo passage-retrieval cache (`octo_retriever.py`) use the same layering as TTS (`octocache.py`): the local file is checked first (`cache/<key>.json`, `cache/octo/<key>.json`), then the shared Octo tables `llm_answer` and `retrieval`. An Octo hit is copied back to the local file, and new entries are written locally and pushed to Octo in the background. Every run's use of a cached row is recorded in `run_cache_link` (`run_id`, `kind`, `key`, `hit`). Template, empty, reasoning-only, and pre-PR #5 answers are never served or stored. `python -m schema.backfill` runs on deploy: it uploads local entries and moves stale local files to `cache/_purged/`.

## Data model and migrations

- `schema/__init__.py` holds `SCHEMA_VERSION` and `MODELS` (`tts_clip`, `tour_step`, `schema_version`) plus `validate()`. `migrations/NNNN_name.sql` are numbered and portable (they run on Postgres and SQLite).
- `python -m schema.migrate [--apply]` compares and applies migrations to Octo. Each applied migration writes a `schema_version` row. The deploy step (`deploy/deploy.sh`) runs `--apply`. On startup the app checks that Octo's version equals `SCHEMA_VERSION` and uses Octo only when they match.
- To change the schema: bump `SCHEMA_VERSION`, add the next numbered migration (never edit a released one), then run `python -m schema.lock`. CI (`tests/test_schema.py`) checks that models validate, that migrations apply in order and are idempotent on an in-memory store, that the version equals the newest migration, and that the schema fingerprint matches `schema/schema.lock.json`. That last check fails if the schema changes without a version bump.

## CI/CD

- **CI** (`.github/workflows/ci.yml`, required job `gates`): Python 3.11, ruff (non-blocking), pytest. Live/data tests are skipped in CI (`RUN_LIVE=1` and `data/nodes.jsonl` turn them on).
- **Auto-merge** (`automerge.yml`): PRs by the owner or bots are set to squash auto-merge, and merge when `gates` passes. No approval is needed.
- **Deploy** (`deploy.yml`): after CI passes on `main`, the self-hosted runner `precedent-pro` on the Pro runs `deploy/deploy.sh`. It resets to origin/main, installs deps, runs `launchctl kickstart -k com.precedent.app`, health-checks local and public, and rolls back on failure. It refuses to deploy over uncommitted changes.
- **ACS hot-loader**: `acs_hotload.py` plus the vendored runtime in `acs/` (see `acs/SOURCE.md`). Endpoints: `GET /api/acs/hotload`, `POST /api/acs/reload`.
