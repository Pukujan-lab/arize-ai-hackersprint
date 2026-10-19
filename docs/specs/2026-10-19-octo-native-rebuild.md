# Octo-native rebuild

Date: 2026-10-19
Status: for review

## 1. What this replaces

The app at https://arize.design-bakery.com is a Python service (FastAPI behind uvicorn on port 3000) plus a separate Vite frontend. ABA builds apps on its own stack and cannot build, gate, run or verify a Python service, so it has never been able to own this app end to end.

This design replaces both halves with one ABA-owned project and makes the Octo workspace the only persistent store.

The product does not change: ask a legal question, get a cited memo, see the relevant authorities on a 3D Colorado map with a narrated tour, and read the run in an observability page or a slide deck.

## 2. Decisions

| Decision | Choice |
|---|---|
| Scope | Same product; ABA owns all app code and the Octo schema |
| Store | Octo only — graph, passages, caches, audio, runs |
| Deploy | Same host, same URL; port 3000 serves the app's own Node server |
| Build | One ABA run regenerates the whole app |
| Tracing | Arize retained |
| Dropped | ACS (seats, claim/release, tasks), microphone input, sponsor feed, stack and limits panels, tour prefetch |
| Deploy detail | The app runs from its own release folder, not the git checkout |

## 3. Architecture

One project, one build:

- **Client**: four pages — `/` (ask and memo), `/map` (same page, map pane), `/observability`, `/slides`.
- **Server**: same project, route handlers in a server directory, compiled into a runnable Node server that also serves the built client.
- **Runtime**: `PORT` (default 3000) and `HOST` (default 127.0.0.1) from the environment; one process; no cache daemon and no second database.

Persistent state lives only in Octo. In-process memory holds a run's live events and partial text while it runs; both are written to Octo when the run completes. Nothing is persisted to local files.

## 4. Data

### 4.1 Read-only graph and corpus (already in Octo)

Active snapshot `5f469d7d-18b6-5bb5-95e6-72b348e59799`, pointed at by `legal_graph.active_snapshot`:

| Table | Rows | Use |
|---|---|---|
| `legal_graph.chunk` | 804,646 | Full-text passage search (`tsv`, GIN index) |
| `legal_graph.expression` | 45,048 | Chunk → work |
| `legal_graph.work` | 45,048 | Case name, court, decided date, external ids |
| `legal_graph.authorities` | 427,447 | Authority metadata in `payload` (id, title, court, date, type, url) |
| `legal_graph.citation_edges` | 1,312,328 | `source_id` → `target_id`, `payload.kind` (`cites`, `part_of`) |

The snapshot id is read at boot and refreshed periodically. Every graph query filters on it. No id is hardcoded.

Measured on the host against this workspace:

- passage search, 25 results: 0.22–0.95 s
- out-edges for a seed set: ~0.16 s
- in-edges for a seed set: ~0.14 s
- authority hydration for a candidate set: ~0.14 s
- in-degree ranking for a candidate set: ~0.37 s
- authority types: 369,088 case law, 25,568 statutes, 18,706 regulations, 9,364 Colorado statutes, 3,582 US statutes, 688 rules, 22 guides

Octo caps a single query at 10,000 rows. Nothing in the app may read a whole table; every graph query is keyed by ids or aggregated.

### 4.2 Written tables

| Table | State | Content |
|---|---|---|
| `public.llm_answer` | exists | Memo cache, keyed by content hash |
| `public.retrieval` | exists | Passage-set cache, keyed by query hash |
| `public.run_cache_link` | exists | Which cache rows a run used |
| `public.tts_clip` | exists | Clip audio (base64), provider, voice, character timings, duration |
| `public.schema_version` | exists | Applied migration versions |
| `public.run` | new | Run record: question, session, previous run, result, events, timings, provider |

Dropped: `public.tour_step` (349 rows, no caller), `public.tts_cache` (empty, superseded by `tts_clip`), every local SQLite file, every JSONL graph file, the SQLite passage snapshot, SurrealDB.

Migrations are additive only (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`) and are applied by our deploy over Octo's HTTP API before restart. Rollback never reverses a migration.

## 5. Request path

### 5.1 Ask

1. **Plan** — rewrite a follow-up into a standalone question using the previous run's question and memo.
2. **Retrieve** — full-text search over passages; map the passages to their works; these are the seeds.
3. **Expand** — one query for outgoing edges and one for incoming edges of the seed works; collect candidate authorities.
4. **Hydrate** — one query for authority metadata across the candidate set.
5. **Rank** — score candidates by passage relevance and by how often the graph cites them (in-degree over the candidate set). No PageRank: the interface never displays it, and it cannot be computed over 1.3M edges per request.
6. **Write** — stream a memo with numbered citations; the memo uses only hydrated authorities.
7. **Verify** — the safeguard checks every citation marker in the memo against the retrieved set, lists invalid or unknown authorities, flags unsupported claims, and appends the disclaimer.
8. **Persist** — write the run, its events and cache links to Octo.

Cache behaviour: a repeated question returns the cached memo and passage set, and records a cache link for the new run. Template or empty answers are never served from cache.

### 5.2 Endpoints

Keep:

- `GET /api/health` — provider availability, Octo schema version and reachability, active snapshot id, node and edge counts, build id
- `POST /api/ask` — starts a run, returns its id immediately
- `GET /api/run/{rid}` — run state: partial text, events, result
- `GET /api/runs` — recent runs
- `POST /api/tts_ts` — timestamped speech: base64 audio plus per-character start times; used by memo narration and the tour

Drop: `/api/seats`, `/api/claim`, `/api/release`, `/api/tasks`, `/api/acs/events`, `/api/sponsor`, `/api/stack`, `/api/limits`, `/api/stt`, `/api/tts`, `/api/tour/prefetch`, `/api/tour/{run_id}`.

### 5.3 Voice

The provider chain ends in browser speech. A clip is looked up by hash of provider, voice and text in `tts_clip`; a miss generates once and stores. If every provider fails, the endpoint says so and the client advances the tour silently after 2.5 seconds — the current behaviour.

### 5.4 Tracing

Arize spans for each run and each pipeline stage, from the same environment variables. No-op when unset.

## 6. Deploy (ours, not ABA's)

The running app executes from a release directory. This is the one deliberate change to today's deploy: the checkout is reset while the app runs, which caused the live 500 outage.

1. Build the target commit into a fresh release directory.
2. Apply pending migrations over Octo HTTP (additive; failure is a warning and caches degrade).
3. Point `current` at the new release.
4. Restart the service (`com.precedent.app`), which execs the built server with `PORT=3000` and `HOST=127.0.0.1`.
5. Health check locally and publicly; the build id must match the commit.
6. On failure, point `current` back at the previous release and restart. Previous releases stay runnable; no rebuild path.

Node must resolve in the launchd environment — reuse the existing nvm fallback. Keep the last N releases and prune.

## 7. Cutover

Order:

1. Spec approved, issue filed, prompt written.
2. ABA run (one).
3. Our browser verification.
4. Repair run if needed.
5. Merge: delete `app/`, `schema/`, `acs/`, `contracts/`, `requirements*`, `pyproject.toml`, the old `web/` and the Python tests; rewrite deploy.
6. Deploy.
7. Nothing-links-back sweep.
8. Prune the last Python release after 48 hours.

Nothing-links-back sweep:

- every served page: no reference to retired paths, build ids or asset names
- the shipped script's route table: only `/`, `/map`, `/observability`, `/slides`, and a not-found route
- `sitemap.xml` and `robots.txt`: only those routes
- old addresses: `/v1`, `/v2` → 308 to `/`; `/dashboard` → 308 to `/observability`; `/guide` → 308 to `/slides`; `/static/*` and any `*.html` path → 308 or 404, never an HTML body
- the public URL resolves to the new service only

## 8. Verification

Before the run:

- Octo reachable from the host; active snapshot present; the five read-only tables populated
- `schema_version` matches what the new app expects after migration

ABA's own gates: build and type check pass; the built server boots; `/api/health` responds; screenshots of the four routes.

Our browser checks, in Chromium, against a local instance:

- **Memo** — a question produces a memo with citations and sources; citation links resolve; a follow-up uses the previous run; a repeated question hits the cache; rapid asks hit the rate limit cleanly
- **Map** — pins appear for case law, statutes and regulations; hover and click work; drag or wheel stops the tour; tour order matches citation order
- **Voice** — memo narration plays; tour stops narrate and advance; with speech failing, the tour still advances silently
- **Observability** — the run list loads; a run shows its stages and timings
- **Slides** — six slides, keyboard navigation, no API calls
- **Store** — a run writes to `run`, `llm_answer`, `retrieval` and `tts_clip`; a second identical question reads them back
- **Tracing** — spans appear in Arize for a run

After deploy: health script green locally and publicly; build id matches; the same browser suite against the public URL; the sweep in §7.

## 9. Risks

1. **One run is a large app.** Mitigation: vertical slices in dependency order, with the exact endpoint and field contracts in the prompt. Expect one repair run.
2. **Provider chains cannot be exercised in ABA's sandbox** (egress is limited to the model gateway, the image host and Octo). Voice and the second model provider are only proven in our verification. This is the most likely source of a repair run.
3. **Octo write latency for run events is unmeasured.** If per-event writes are slow, keep events in memory during the run and write once at completion; the observability page only reads completed runs.
4. **10,000-row query cap.** A query that tries to read a whole table will silently truncate. Every graph query must be keyed or aggregated.
5. **Node under launchd** — verify resolution with a manual restart before the real deploy.
6. **The old app stops being restorable** once the Python files are deleted. Keep one Python release directory for 48 hours.

## 10. What ABA is told, and what it is not

The prompt carries: the product description; the exact endpoint list; the exact result, run and citation field names; the retrieval and safeguard outcomes; the voice chain and its silent-advance rule; the health payload; the four pages and their behaviours; the retired-address table; the environment variable names; accessibility and reduced-motion behaviour.

The prompt does not carry: framework, library, build tool or dependency names; deploy, git or CI instructions; browser automation; documentation work; any mention of the old Python service.
