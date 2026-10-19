# Precedent — pass 4: bring the Arize snapshot back onto the observability page

This is the pass for **O107** in `docs/specs/2026-10-18-frontend-v3.md`. It follows the engine and
observability pass; O104–O106 and the existing O39–O42 behaviour must stay green.

The owner asked for the observability page to be hooked up "like how Arize was hooked up to v1". The v1
page merged live runs with a snapshot exported from Arize: each trace carried four judge scores
(`groundedness`, `hallucination`, `citation_relevance`, `legal_safety`), a token count, a model and a span
waterfall, plus a dataset and an experiment summary. That page is gone, but its snapshot is preserved in
git.

## Where the snapshot is

```
git show 19c6498:static/data/observability.json
```

It is 33 KB and holds 18 traces with `generated_at: 2026-10-16T18:42:22+00:00`. Restore it as a data asset
in the rebuilt app and serve it at `GET /api/arize`. Its shape is in the spec's data-shape block:

```
{ generated_at, project, evaluator,
  traces: [{trace_id, run_id?, question, start_time, latency_ms, model?, tokens?, safeguard?,
            evals: {groundedness: {score, label, explanation?}, hallucination: {...},
                    citation_relevance: {...}, legal_safety: {...}},
            spans: [{id, parent?, name, kind, start_ms, dur_ms, model?, tokens?}]}],
  dataset?: {name, rows, columns}, experiment?: {name, examples, metric, by_setting?} }
```

A trace that carries `run_id` and whose run is also on disk is merged into that live run rather than
listed twice. A trace without a `run_id`, or whose run is no longer on disk, is listed as a snapshot-only
row and marked as such.

## What the page must show

Two new regions on `/observability`, with the accessible names the spec's table gives them.

**`Arize evals`** — one row per trace:

- the time, the question, the latency and the safeguard result;
- the four judge columns, each with its label and score (`grounded 0.82`, `ungrounded 0.25`), and the
  explanation available when the row is opened;
- the snapshot's `generated_at` stated in words, and the row marked live or snapshot;
- the dataset name/rows and the experiment name/metric, when the snapshot carries them;
- when the snapshot cannot be read, the region says it is unavailable. It never renders an empty table and
  never invents a score. Live runs stay visible either way.

**`Trace waterfall`** — the spans of the chosen trace:

- one line per span with its name, kind and duration, indented by parent;
- the reader can choose which trace's waterfall is shown;
- a trace with no spans says so.

## Rules

- The judge scores are a snapshot from 2026-10-16, not live values. Do not label them live, do not
  recompute them, and do not present a missing eval as `0`.
- Do not call Arize from the request path. The snapshot is a file; the live export status is what O105
  already reports.
- A field the snapshot does not carry stays absent, not zero and not an empty string.
- Keep the page usable at 360 px wide: the table may scroll horizontally, the regions may not overlap.
- Do not edit the spec, the tests or the fixtures.

## The acceptance gates

```
cd /Users/teresaguajardo/aba/workspaces/prec-v3-119
/Users/teresaguajardo/aba/precedent-venv/bin/python -m pytest \
  tests/test_frontend_v3_observability.py -q
```

The four `O107` gates drive the page with `tests/fixtures/arize-snapshot.json`: two traces, one with a
live run and one snapshot-only, four judge scores each, three spans each, a dataset and an experiment. The
fourth gate serves a `503` from `/api/arize` and requires the page to say the snapshot is unavailable while
still showing the live run.

Also keep green:

```
tests/test_frontend_v3_observability.py tests/test_frontend_v3_pipeline.py \
tests/test_frontend_v3_followups.py tests/test_frontend_v3_map_fidelity.py \
tests/test_frontend_v3_voice_tour.py
```

Report the exact command and output, and say which snapshot fields the page renders and which it omits.
