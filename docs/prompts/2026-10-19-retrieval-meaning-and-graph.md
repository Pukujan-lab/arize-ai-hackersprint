# Precedent — retrieval by meaning and by the citation graph, and honest stage reporting

This is the pass for **O93–O100** in `docs/specs/2026-10-18-frontend-v3.md`, under "The pipeline on
the map" and "Retrieval". The issues are **#133** and **#134**. The frontend outcomes O80–O92 and
O101–O103 were handled in the previous pass; leave the page working and do not regress it.

## What the corpus already holds

The Octo workspace `legal_graph` is the index. Its shape, as measured on 2026-10-19:

| Table | Rows | What it holds |
| --- | --- | --- |
| `chunk` | 804,646 | passages, each with a 1024-dimension `baai/bge-large-en-v1.5` embedding and an HNSW cosine index |
| `authorities` | 547,219 | one row per citable authority, with `payload` holding title, type, date, url, court |
| `citation_edges` | 1,473,123 | 1,371,959 `cites` and 101,164 `part_of` edges, keyed `[source, target, kind]` |
| `work` | 45,048 | the works the chunks belong to; `court_id` carries the real court name |

The workspace exposes SQL over HTTP: `POST {OCTO_BASE_URL}/workspaces/{WS}/query` with
`{"sql": "...", "params": [...], "rowLimit": n}`. Placeholders are `$1`, not `%s`. A `User-Agent`
header is required or the request is refused. `vector` and `pg_trgm` are installed; the workspace
offers no server-side embedding function, so a query vector must be produced by the caller and sent
as a parameter. `<=>` works against the stored embeddings.

Every retrieval path the corpus supports must be used: meaning (the stored embeddings), words (the
full-text index), and the citation graph (the edges and the works). The current retriever uses words
and a local graph file only.

## What must be true when you are done

1. **O94** A question phrased in different words from the authority's own reaches the authority that
   governs it. The gate's fixed questions and expected authorities are the definition: a
   concealed-carry question reaches `Trinen` or the concealed-carry authority; a self-defence
   question reaches `Janes`, `Phillips` or `Montez`; a mineral-reservation question reaches
   `McCormick` or `Hanna`.
2. **O95** A question outside the corpus is answered with that fact. For `hello how are you` the
   result reports a coverage other than `on_point`, the answer says it has no authority on the point
   (or that it is not a legal question), and the citation check is not reported as passed. Unrelated
   authorities are never dressed as the answer.
3. **O96** A misspelling or an everyday synonym does not block retrieval: `am i allowed to carry gun
   withotu license` still reaches the concealed-carry authority or C.R.S. 18-12-105 / 18-12-204.
4. **O97** An authority the index returns is not dropped because the local graph lacks a node for it;
   it keeps the court and the link the index holds.
5. **O98** Cited-by and cites edges are considered in ranking, and the ranking prefers authorities
   relevant to the question over authorities that are merely widely cited. For the mineral/homestead
   question the run must include a `C.R.S. § 34-60-…` section and must not return generic CFR titles.
6. **O99** A statute citation names its section (`§`), its title and a link to its text; an
   article-level `Title …, Article …` placeholder is not cited where a section exists. An authority
   with missing metadata says which field is missing.
7. **O100** `/api/health` reports `tracing` as an object with `ok` and, when not ok, a `reason`. After
   a completed run it either reports `ok: true` or reports the reason it could not export. It must
   never stay silent, and the page must not claim tracing it does not have.
8. **O93** Every stage message names the path the run actually used. The gate asserts that the words
   `SurrealDB`, `hybrid` and `PageRank` never appear unless the run really used them, and that the
   seed event carries the graph backend actually consulted while the passage event carries the search
   actually used. Today the messages claim all three.

## The acceptance gates

These are the definition of done and they are not yours to edit:

```
tests/test_frontend_v3_pipeline.py::test_O93_stage_messages_name_the_path_actually_taken
tests/test_retrieval_v3.py   # O94, O95, O96, O97, O98, O99, O100
```

`O97` and `O93` run offline. `O94`–`O96` and `O98`–`O100` call the live providers and skip when the
credentials are absent; run them with the host environment sourced (source it, never print it or any
value from it):

```
cd /Users/teresaguajardo/aba/workspaces/prec-v3-119
set -a; . ~/.hack_env; set +a
/Users/teresaguajardo/aba/precedent-venv/bin/python -m pytest \
  tests/test_retrieval_v3.py tests/test_frontend_v3_pipeline.py -q
```

Each live run answers a question end to end and takes a minute or two; the whole file is under ten
minutes. Iterate on the offline gates first, then the live ones.

The gates write `.coord/assignment.json` as a side effect and restore it; do not leave that file
modified. Do not edit the tests, the fixtures or the spec. Do not change the outcome wording to fit
the implementation.

## What must not break

The browser gates for the map, the voice, the pipeline and the follow-ups must stay green, and the
build must succeed:

```
/Users/teresaguajardo/aba/precedent-venv/bin/python -m pytest \
  tests/test_frontend_v3_map_fidelity.py tests/test_frontend_v3_voice_tour.py \
  tests/test_frontend_v3_pipeline.py tests/test_frontend_v3_followups.py -q
```

Report what you changed, the exact test output, and the retrieval path each answer took.
