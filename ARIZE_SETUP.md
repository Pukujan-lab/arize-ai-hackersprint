# Arize setup for Precedent (space U3BhY2U6NTY4Nzk6MHhDRQ==, project precedent-legal-graphrag)
Base: https://app.arize.com/organizations/QWNjb3VudE9yZ2FuaXphdGlvbjo1MjM0Mjo2cVRj/spaces/U3BhY2U6NTY4Nzk6MHhDRQ==

## Created by API (real, 2026-10-16 ~1:44 PM ET), zero LLM calls (cached answers)
- **10 fresh demo traces** (pipeline CHAIN → retriever RETRIEVER → drafter LLM), replayed from cached runs; attributes `precedent.citation_pass`, `precedent.groundedness`, `precedent.latency_s`, `precedent.cost_usd`, `precedent.fallback`, `precedent.provider`. Span ids: `arize/fresh_traces.json`.
- **Span evals logged on those 10 traces**: `groundedness`, `hallucination`, `citation_relevance`, `citation_guard` (label + score + explanation).
- **Annotation configs**: `groundedness` (QW5ub3RhdGlvbkNvbmZpZzoxODEyMzo2MWRW), `citation_relevance` (QW5ub3RhdGlvbkNvbmZpZzoxODEyNDo5VzlB), continuous 0–1, maximize.
- **Dataset** `precedent-demo-questions-1016-1344` (RGF0YXNldDozNzAyNzY6VzhuaA==): 10 questions + expected_citations + reference_answer.
- **Experiment** `cached-haiku-graphrag-v1` (RXhwZXJpbWVudDoxNjI0MzM6MUk5Qw==) on that dataset with evaluator columns groundedness, citation_guard, citation_relevance.
- Scripts: `arize/setup_arize.py` (trace replay; runs in sandbox), `arize/push.py` + `arize/exp.py` (evals/dataset/experiment; must run off-sandbox because the Daytona egress blocks api.arize.com / flight.arize.com).

## NOT creatable by API on this plan → click (GraphQL mutations return "only available for enterprise accounts")
Metric formulas (paste into custom metric editor, environment = Tracing):
| Name | Formula |
|---|---|
| citation_pass_rate | `SELECT AVG("eval.citation_guard.score") FROM model` |
| avg_groundedness | `SELECT AVG("eval.groundedness.score") FROM model` |
| p95_latency_ms | `SELECT APPROX_QUANTILE(latency_ms, 0.95) FROM model` |
| cost_per_run_usd | `SELECT AVG("attributes.precedent.cost_usd") FROM model` |
| fallback_rate | `SELECT AVG(CASE WHEN "attributes.precedent.fallback" = 'true' THEN 1 ELSE 0 END) FROM model` |

### 1. Custom metrics (~90 s)
Projects → precedent-legal-graphrag → **Config** (or **Custom Metrics**) tab → **+ New Custom Metric** → name + formula from the table → Save. Repeat for 5 rows (if the editor validates a column name differently, pick it from the autocomplete; eval columns appear after the evals load).

### 2. Dashboard (~2 min)
Left nav **Dashboards → + New Dashboard → Blank** → name "Precedent reliability" → **+ Add Widget → Time Series** → project precedent-legal-graphrag, environment Tracing, metric = each custom metric above (5 widgets) → Save. Optional: add a **Statistic** widget for trace count.

### 3. Monitors (~90 s)
Project → **Monitors → + New Monitor → Custom Metric**:
- `citation_pass_rate` **less than 0.9**, window 1 h → name "Citation pass rate < 90%".
- `p95_latency_ms` **greater than 15000** → "Latency p95 > 15 s".
- **Performance/Data quality → Error rate** (span status = ERROR) **greater than 0.05** → "Error rate > 5%".
Add your email as contact → Save.

### 4. Online evaluator task (~1 min, optional)
Project → **Evals → + New Task → LLM-as-judge → Hallucination template**, model Haiku, sampling 10%, filter span kind = LLM. (Not created by script, to save Anthropic quota.)

## Where to look in the demo
- Traces + evals: Project → Traces, filter `name = pipeline`, eval columns on the right.
- Dataset/Experiment: left nav **Datasets → precedent-demo-questions-1016-1344 → Experiments**.
