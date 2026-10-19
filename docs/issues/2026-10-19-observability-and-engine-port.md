# Issue log: retrieval, tracing and the run store are not observable

- **Date:** 2026-10-19
- **Reported by:** owner, after asking that every part of a run be observable
- **Scope:** the retrieval pipeline, `/api/health`, `/api/stack`, the saved-run store, the trace queue, the
  observability page, and the hosted tracing project
- **Status:** open
- **Follows:** `docs/issues/2026-10-19-map-voice-retrieval-regressions.md` (O80–O100)

The owner's direction: "make sure everything is observable … check Arize traces … trace is getting full
please use fifo and prune older ones … also hook it up to our dashboard / observability like how Arize was
hooked up to v1." The page and the API cannot currently answer three questions: which retrieval stages a
run actually took, whether its spans reached Arize, and what the store drops when it is full. This log
records each gap, the evidence, and the outcome that closes it.

---

## 1. The app does not use the tested retrieval engine

**Observed.** The application retrieves with one lexical Octo query and a local graph file. There is no
dense half, no reranker and no support checker in the run.

**Evidence.** `app/octo_retriever.py` issues `websearch_to_tsquery('english', $1)` with `ts_rank` over
`legal_graph.chunk` and joins through `expression` and `work`; `app/agents.py` seeds a networkx graph and
ranks candidates by `score * (1 + log1p(indegree))`. No embedding request exists anywhere in `app/`.

**Engine already available.** The retrieval engine is deployed on the same host. A model-complete process
answers on `127.0.0.1:8011` and reports:

- corpus `804,646` chunks and `45,048` cases, corpus revision `octo-chunk:804646`, graph revision
  `5f469d7d-18b6-5bb5-95e6-72b348e59799`;
- stages in order: `parse`, `bm25`, `dense`, `hybrid`, `graph`, `rerank`;
- `dense` uses `BAAI/bge-small-en-v1.5`; `rerank` uses
  `cross-encoder/ms-marco-MiniLM-L-6-v2`; the checker is `minicheck`.

A retrieval of the O94 question
`Can someone keep a gun on them in Colorado without a permit?` returns `Trinen v. City & County of
Denver` first, with provenance `bm25` and `dense` and `score_kind: cross-encoder`.

The older process on `127.0.0.1:8010` was started before the model dependencies were installed. It
reports `dense_model: null` and `rerank_model: null` and skips both stages. Do not point the app at it
until it is restarted by its owner.

**Must instead.** Every answer is retrieved through the engine's HTTP contract, and the engine's result
list is the candidate set. An authority the index returns survives even when the local graph has no node
for it (O97). The graph half still contributes question-relevant authorities (O98).

## 2. The run does not record the stages it took

**Observed.** The run result carries a free-text `source` and the page has nothing to read. Stage
messages claim paths the run did not take.

**Evidence.** Live run events say `Octo hybrid passage search`, `1-hop SurrealDB traversal (->cites /
<-cites)` and `ranked top N authorities by citation-weighted PageRank` while the same run reports
`backend: networkx` and a single full-text query (O93). `result.retrieval` does not exist in the saved
result.

**Must instead.** The run stores `retrieval.stages` as `{name, duration_ms, skipped, reason}` in the order
the engine emitted them, and `retrieval.source` names only the stages that actually ran. `/api/stack`
exposes the last completed run's stages under `engine.stages`. The observability page shows them (O104).

## 3. Health reports tracing it does not have

**Observed.** `/api/health` returns `"arize": true` on the live site while every export fails.

**Evidence.** `~/precedent/uvicorn.log` records, on every run:

```
Failed to export traces to otlp.arize.com, error code: StatusCode.PERMISSION_DENIED
```

The API key and space in the host environment are rejected. `app/tracing.py` collapses "not configured",
"configured but rejected" and "exported" into one boolean, so the health payload cannot tell them apart.
The Arize API answers `401` for the same credentials and the old Phoenix host answers `410 Gone`.

**Must instead.** `/api/health` and `/api/stack` report
`tracing: {ok, reason, project, sent, dropped, queued}`. `ok` is true only when the exporter accepted the
spans. A failure carries the exporter's reason. The page shows the same figures and never claims delivery
it cannot demonstrate (O105).

**Blocked on the owner:** a hosted-trace check needs an Arize key and space that are permitted to ingest
into the project. With the current pair, no trace can be seen in the hosted project from this host.

## 4. The run store and the trace queue are unbounded

**Observed.** `runs/` holds more directories than the reported cap, and the trace queue has no eviction
rule that the page can state.

**Evidence.** `/api/stack` reports `runs_kept: 200` and `runs_on_disk: 202`; `trace_queue_max` and
`spans_dropped` are not reported at all. Nothing in `app/` prunes `runs/` or the queued spans.

**Must instead.** Both stores are bounded first-in-first-out: at the cap the oldest entry is dropped
first. `/api/stack.retention` reports `runs_kept`, `runs_on_disk`, `trace_queue_max` and
`spans_dropped`, and the page shows the caps, the dropped count and the eviction order (O106).

## 5. The temporary Octo key is rejected

**Observed.** The key the owner supplied as a temporary Octo key cannot read the corpus.

**Evidence.** A query against the real workspace (`76d7577b-2274-42b4-a8dc-1ff1c0efa741`) answers
`401 {"error":"UNAUTHENTICATED"}`. The key already in the host environment reads `804,646` chunks.

**Must instead.** Nothing in the application changes. Use the host key; the temporary key needs to be
reissued.

---

## Outcome mapping

| Gap | Outcomes |
| --- | --- |
| Engine-backed retrieval, no dropped authorities, question-relevant graph | O94, O96, O97, O98, O99 |
| Honest stage text and recorded stages | O93, O104 |
| Honest tracing and counts | O100, O105 |
| FIFO bounds and reported caps | O106 |
| Observability page panels | O104, O105, O106 |

The spec and the gates land first; the builder implements them.
