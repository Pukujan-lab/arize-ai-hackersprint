# Precedent — pass 3: retrieval through the engine, and observability of stages, tracing and retention

This is the pass for **O93–O100** (retrieval and honest stage text, carried over) and **O104–O106** (the
new observability outcomes) in `docs/specs/2026-10-18-frontend-v3.md`. The issues are
`docs/issues/2026-10-19-map-voice-retrieval-regressions.md` and
`docs/issues/2026-10-19-observability-and-engine-port.md`.

Two rules from the spec apply to everything below: you write application code only, and you do not edit
the tests, the fixtures or the spec. Where a gate disagrees with what you think should happen, the gate
is the requirement.

## Part one — retrieval comes from the engine

The retrieval engine is already running on this host. Stop reimplementing retrieval; call the engine.

**Endpoint.** `http://127.0.0.1:8011/api/v1` — base URL and token come from the environment
(`ENGINE_BASE_URL`, `ENGINE_API_TOKEN`; never hardcode either, and never print the token). Both are now
present in `~/.hack_env`, which the app already sources. The process on `:8010` is the same engine started
before its model dependencies were installed: it reports `dense_model: null`, `rerank_model: null` and
skips those stages. Do not point the app at it.

**Health.** `GET /api/v1/health` returns, among other fields:

```
engine: { status, chunks: 804646, cases: 45048, corpus_revision: "octo-chunk:804646",
          graph_revision: "5f469d7d-…", lexical, dense_model, rerank_model, jev_model, auth: "bearer" }
```

**Retrieve.** `POST /api/v1/retrieve`, JSON body, bearer token, `"stream": false` for a single JSON
response or `"stream": true` for Server-Sent Events:

```
{"query": "...", "k": 10, "bm25_k": 100, "dense": true, "dense_pool": 50, "graph": true,
 "graph_seed_docs": 10, "rerank": true, "rerank_k": 30, "jev": false, "passages_per_case": 2,
 "stream": true}
```

Every field except `query` is optional and has the default shown. The response is
`{"stages": [...], "result": {...}}` (or one `stage` event per stage, then `result`, then `done`, when
streaming). The stage event shape is fixed:

```
{"type": "stage", "schema_version": "engine-retrieve/1", "stage": "bm25",
 "duration_ms": 355.16, "elapsed_ms": 356.16, "retriever": "bm25-compact", "chunks_scored": 804646,
 "candidates": [{"doc_id", "chunk_id", "rank", "score"}]}
```

A stage that did not run arrives with `"skipped": true` and a `"reason"` such as
`"no dense model loaded"`. The stages arrive in the order `parse, bm25, dense, hybrid, graph, rerank`,
and `jev` only when requested.

The `result` is:

```
{"type": "result", "schema_version": "engine-retrieve/1", "query", "corpus_revision",
 "graph_revision", "elapsed_ms",
 "results": [{"rank", "case": {"id", "name", "court", "year", "link", "cap_id"},
              "score", "score_kind": "cross-encoder", "rrf", "bm25", "dense", "jev_relevance",
              "provenance": [{"source": "bm25" | "dense" | "graph", "rank"}],
              "passages": [{"chunk_id", "ord", "text", "bm25", "spans": [{"start","end","text","query_term_overlap"}]}]}]}
```

`case.court`, `case.year` and `case.link` are frequently `null` from the engine. The passage `text`
begins `Case Name | Court of X | YYYY`, so the deciding court and year are recoverable from it, and the
Octo `authorities` row for the same id carries the rest. Do not invent metadata; when a field genuinely
has no source, say which field is missing (O99).

**Check.** `POST /api/v1/check` is the support checker the safeguard must use:

```
{"claims": [{"text": "<=4000 chars", "cited_text": "<=20000 chars", "citation": "[1]",
             "chunk_id": "cap:10350369:combined:92"}],
 "scorer": "minicheck", "threshold": 0.5, "temperature": 1.0}
```

One to fifty claims. The response is:

```
{"claims": [{"claim_index", "citation", "raw_prob", "calibrated_prob", "threshold", "accepted",
             "decider", "model_version", "temperature", "decided_at", "schema_version"}],
 "answer_confidence": 0.42, "threshold": 0.5, "abstain": true, "decider", "model_version",
 "decided_at", "latency_ms", "aggregation": "min",
 "quotes": [{"claim_index", "chunk_id", "chunk_found", "quote_verified", "char_start"}],
 "unverified_quotes": [1]}
```

`answer_confidence` is the weakest claim's calibrated score; `abstain` is true when that is below the
threshold **or** any cited quote is not found verbatim in the chunk it claims. A scorer the engine cannot
run answers `503` with the reason in `detail` — treat that as "the checker did not run", never as a pass.

**What to change.**

1. The candidate set for an answer is the engine's `results` list, in its order. Keep every authority the
   index returns even when the local graph has no node for it, with the court, date and link the engine or
   the passage line gives you. (O97, offline gate.)
2. The graph half is the engine's `graph` stage, plus the local/Octo citation edges for the authorities in
   the run's own list. Edges may only connect authorities that are in the final list. (O98.)
3. The safeguard sends each claim plus the exact passage span it cites to `/api/v1/check` and reports the
   engine's `abstain`, `answer_confidence` and `unverified_quotes` instead of the current regex-only
   verdict. A regex check may still run first, but a regex pass is not a support pass. (O95.)
4. Stage messages name the path the run actually used. The words `SurrealDB`, `hybrid` and `PageRank`
   must not appear unless the run really used them. Emit one `retrieval` record on the result:

   ```
   result.retrieval = {"source": "engine:parse+bm25+dense+hybrid+graph+rerank",
                       "stages": [{"name", "duration_ms", "skipped", "reason"}],
                       "graph": {"source": "...", "revision": "5f469d7d-…"}}
   ```

   `source` names only the stages that ran; a skipped stage appears in `stages` with `skipped: true` and
   the engine's reason verbatim.
5. If the engine is unreachable, say so in `retrieval` and in the health/stack payload. Do not fall back
   to a silent lexical-only run that then claims a pipeline it did not have.

The acceptance questions for O94 and O96 already reach the right authorities through the engine: the
permit question returns `Trinen v. City & County of Denver` first with `bm25` + `dense` provenance. If
your integration does not reproduce that, the wiring is wrong, not the gate.

## Part two — honest tracing (O100, O105)

`app/tracing.py` collapses every state into one boolean. Replace that with a reportable state:

- `ok` is true only when the exporter accepted spans. Permission errors, connection errors and "not
  configured" are all `ok: false` with a distinct `reason`.
- Track and expose `sent`, `dropped` and `queued` counters, and the `project` name.

`GET /api/health` must return `tracing: {ok, reason?, project?, sent?, dropped?, queued?}` — an object,
not a boolean — and `GET /api/stack` must return the same object under `tracing`. Today the live site
returns `"arize": true` while the log records `StatusCode.PERMISSION_DENIED` on every run; that exact
contradiction is what O100 fails.

Note, from the host right now: the configured space and key are rejected by the exporter. So the honest
answer on this machine today is `ok: false` with `reason: "StatusCode.PERMISSION_DENIED"`. Do not paper
over it — the gate for the healthy case is a fixture the test supplies, not a real delivery.

## Part three — bounded stores, first in first out (O106)

`/api/stack` reports `runs_kept: 200` while `runs_on_disk` is 202, and nothing bounds the span queue at
all. Both stores must be hard FIFO:

- saved runs: at the cap, the oldest run directory is removed before a new one is written;
- queued trace spans: at the cap, the oldest spans are dropped and the drop is counted.

`GET /api/stack` must return:

```
retention: { runs_kept, runs_on_disk, trace_queue_max, spans_dropped }
```

`runs_on_disk` is the count actually found on disk after pruning, so `runs_on_disk > runs_kept` after a
completed run is a bug, not a race.

## Part four — the observability page (O104, O105, O106)

Three new regions on `/observability`, each with exactly the accessible name the spec's table gives it:

| Region name | Content |
| --- | --- |
| `Retrieval stages` | the selected run's `result.retrieval.stages`, in order, each with its duration, plus the reason for any stage that did not run |
| `Tracing` | whether spans reached Arize, the project, sent / dropped / queued counts, and the exporter's reason when it failed |
| `Retention` | the saved-run cap and what is on disk, the trace-queue cap, how many spans were dropped, and the words that the oldest entry is dropped first |
| `Retrieval engine` | the engine panel from `/api/stack.engine`: status, corpus size, revisions, lexical, dense/rerank/jev model names, scorer |

Rules the browser gates enforce:

- stage names appear in the order the engine emitted them, and the panel is derived from the run data,
  not from a hard-coded list;
- a duration is rendered readably — the fixture's `2100.0` ms rerank stage must appear as `2.1s` or
  `2100 ms`, not as `2100`;
- a skipped stage's reason is shown verbatim (`OPENROUTER_API_KEY not configured` in the fixture);
- the tracing panel must show `permission_denied` and `not connected` / `failed` in the failure fixture,
  and must not show `failed` or `permission` in the healthy fixture;
- the retention panel must state the caps (`200`, `2,000` or `2000` both read fine) and say the oldest is
  dropped first.

`/api/stack` also has to be read by the page: extend `toStack` in the run-data library so `engine`,
`tracing` and `retention` are parsed rather than dropped, keeping the existing rule that a field the
server did not send stays null instead of becoming 0.

## The acceptance gates

```
cd /Users/teresaguajardo/aba/workspaces/prec-v3-119
set -a; . ~/.hack_env; set +a   # carries ENGINE_BASE_URL and ENGINE_API_TOKEN

# offline first
/Users/teresaguajardo/aba/precedent-venv/bin/python -m pytest \
  tests/test_frontend_v3_pipeline.py::test_O93_stage_messages_name_the_path_actually_taken \
  tests/test_retrieval_v3.py::test_O97_a_retrieved_authority_survives_a_missing_graph_node -q

# then the browser gates (needs the web build)
/Users/teresaguajardo/aba/precedent-venv/bin/python -m pytest \
  tests/test_frontend_v3_observability.py -q

# then the live ones, each a real end-to-end question
/Users/teresaguajardo/aba/precedent-venv/bin/python -m pytest tests/test_retrieval_v3.py -q
```

`O97` and `O93` run offline against the in-process retriever; `O104–O106` drive the built page against the
fixtures; `O94–O96` and `O98–O100` call the live providers. The gates write `.coord/assignment.json` as a
side effect and restore it — leave that file exactly as you found it.

Also keep green, and rebuild before running them:

```
tests/test_frontend_v3_map_fidelity.py tests/test_frontend_v3_voice_tour.py \
tests/test_frontend_v3_pipeline.py tests/test_frontend_v3_followups.py \
tests/test_frontend_v3_observability.py
```

The `O39–O42` gates in the observability file are the existing behaviour of that page — the run list, the
selected run's steps and timings, raw step details, and the failure message. Adding the three new regions
must not break them.

## Report

For each gate: the exact command and its full output. For each answer you generate: the retrieval path it
took, the stages that ran, and whether the support check abstained. Never print a secret value — if a
failure involves a credential, name the variable only.
