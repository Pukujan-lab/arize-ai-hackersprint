"""Create real Arize artifacts for Precedent from CACHED runs (zero LLM calls).
1) 10 fresh demo traces (pipeline CHAIN + LLM child) replayed from cached results
2) span evals: groundedness, hallucination, citation_relevance, citation_guard
3) annotation configs, dataset of 10 demo questions + expected citations, 1 experiment
Run: set -a; . ~/.hack_env; set +a; python arize/setup_arize.py"""
import os, json, time, re, sys, glob, datetime as dt
import pandas as pd
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SPACE = os.environ["ARIZE_SPACE_ID"]; PROJ = os.environ.get("ARIZE_PROJECT_NAME", "precedent-legal-graphrag")
OUT = {}
def log(k, v): OUT[k] = v; print(k, "->", v, flush=True)

# --- pick 10 cached runs with distinct questions
runs, seen = [], set()
for f in sorted(glob.glob(os.path.expanduser("~/hack/demo/runs/*/result.json")), key=os.path.getmtime, reverse=True):
    if "/test" in f or "/arize" in f: continue
    try: r = json.load(open(f))
    except Exception: continue
    q = r.get("question", "").strip()
    if not q or q.lower() in seen or not r.get("answer"): continue
    seen.add(q.lower()); runs.append(r)
    if len(runs) == 10: break

def scores(r):
    sg = r.get("safeguard") or {}
    sents = [s for s in re.split(r"(?<=[.!?])\s+", r["answer"]) if len(s) > 20]
    uns = len(sg.get("unsupported_claims", []))
    ground = max(0.0, 1 - uns / max(1, len(sents)))
    bad = len(sg.get("invalid", [])) + len(sg.get("unknown_authorities", []))
    cits = r.get("citations", []); used = set(sg.get("used", []))
    rel = len([c for c in cits if c.get("ref") in used]) / max(1, len(cits))
    prov = r.get("provider", "")
    return dict(ground=round(ground, 3), halluc=bad > 0, rel=round(rel, 3), cpass=bool(sg.get("pass")),
                fallback=prov.startswith("template") or "fallback" in prov, latency=float(r.get("elapsed_s") or 0),
                cost=0.0 if "cached" in prov or prov.startswith("template") else round((1200*1 + 350*5) / 1e6, 5))

# --- 1) emit fresh traces
from arize.otel import register
from opentelemetry import trace as ot
tp = register(space_id=SPACE, api_key=os.environ["ARIZE_API_KEY"], project_name=PROJ, set_global_tracer_provider=False)
tr = tp.get_tracer("precedent-arize-setup")
rows = []
for r in runs:
    s = scores(r); t0 = time.time_ns(); t1 = t0 + int(s["latency"] * 1e9)
    with tr.start_as_current_span("pipeline", start_time=t0) as p:
        p.set_attribute("openinference.span.kind", "CHAIN")
        p.set_attribute("input.value", r["question"]); p.set_attribute("output.value", r["answer"][:4000])
        for k, v in [("precedent.citation_pass", s["cpass"]), ("precedent.groundedness", s["ground"]), ("precedent.latency_s", s["latency"]),
                     ("precedent.cost_usd", s["cost"]), ("precedent.fallback", s["fallback"]), ("precedent.provider", r.get("provider", "")),
                     ("precedent.replayed_from_run", r["run_id"]), ("precedent.n_citations", len(r.get("citations", [])))]:
            p.set_attribute(k, v)
        with tr.start_as_current_span("retriever", start_time=t0) as rs:
            rs.set_attribute("openinference.span.kind", "RETRIEVER"); rs.set_attribute("input.value", r.get("standalone_query") or r["question"])
            for i, c in enumerate(r.get("citations", [])[:8]):
                rs.set_attribute(f"retrieval.documents.{i}.document.id", c.get("id", "")); rs.set_attribute(f"retrieval.documents.{i}.document.content", (c.get("passage") or "")[:500])
            rs.end(end_time=t0 + int((t1 - t0) * 0.3))
        with tr.start_as_current_span("drafter", start_time=t0 + int((t1 - t0) * 0.3)) as ls:
            ls.set_attribute("openinference.span.kind", "LLM"); ls.set_attribute("llm.model_name", "claude-haiku-4-5")
            ls.set_attribute("input.value", r["question"]); ls.set_attribute("output.value", r["answer"][:4000])
            ls.end(end_time=t1)
        sid = format(p.get_span_context().span_id, "016x"); tid = format(p.get_span_context().trace_id, "032x")
        p.end(end_time=t1)
    rows.append(dict(span_id=sid, trace_id=tid, r=r, s=s))
tp.force_flush(); log("traces_emitted", len(rows))
json.dump([dict(span_id=x["span_id"], trace_id=x["trace_id"], q=x["r"]["question"], **x["s"]) for x in rows], open(os.path.expanduser("~/hack/demo/arize/fresh_traces.json"), "w"), indent=1)

from arize import ArizeClient
c = ArizeClient(api_key=os.environ["ARIZE_API_KEY"])
def tryit(name, fn):
    try: log(name, fn())
    except Exception as e: log(name, f"FAILED: {type(e).__name__}: {str(e)[:300]}")

# --- 3a) annotation configs
tryit("annot_groundedness", lambda: c.annotation_configs.create_continuous(name="groundedness", space=SPACE, minimum_score=0, maximum_score=1, optimization_direction="maximize").id)
tryit("annot_citation_relevance", lambda: c.annotation_configs.create_continuous(name="citation_relevance", space=SPACE, minimum_score=0, maximum_score=1, optimization_direction="maximize").id)

# --- 2) evals on the fresh spans (retry while spans ingest)
ev = pd.DataFrame([{"context.span_id": x["span_id"],
    "eval.groundedness.label": "grounded" if x["s"]["ground"] >= 0.7 else "ungrounded", "eval.groundedness.score": x["s"]["ground"],
    "eval.groundedness.explanation": "1 - unsupported_claims/sentences from the safeguard",
    "eval.hallucination.label": "hallucinated" if x["s"]["halluc"] else "factual", "eval.hallucination.score": 1.0 if x["s"]["halluc"] else 0.0,
    "eval.hallucination.explanation": "invalid refs or unknown authorities present" if x["s"]["halluc"] else "every cited authority was retrieved",
    "eval.citation_relevance.label": "relevant" if x["s"]["rel"] >= 0.5 else "irrelevant", "eval.citation_relevance.score": x["s"]["rel"],
    "eval.citation_relevance.explanation": "share of retrieved authorities actually cited",
    "eval.citation_guard.label": "pass" if x["s"]["cpass"] else "fail", "eval.citation_guard.score": 1.0 if x["s"]["cpass"] else 0.0,
    "eval.citation_guard.explanation": "safeguard checks references, not legal accuracy"} for x in rows])
for attempt in range(6):
    time.sleep(20)
    try: c.spans.update_evaluations(space_id=SPACE, project_name=PROJ, dataframe=ev); log("span_evals", f"logged {len(ev)} rows x 4 evals"); break
    except Exception as e: log("span_evals", f"attempt {attempt}: {type(e).__name__}: {str(e)[:300]}")

# --- 2b) dataset + experiment
ex = [{"question": x["r"]["question"], "expected_citations": json.dumps([cc.get("title") for cc in x["r"].get("citations", []) if cc.get("ref") in set((x["r"].get("safeguard") or {}).get("used", []))][:5]),
       "reference_answer": x["r"]["answer"][:3000]} for x in rows]
ds_name = "precedent-demo-questions-" + dt.datetime.now().strftime("%m%d-%H%M")
ds = None
try: ds = c.datasets.create(name=ds_name, space=SPACE, examples=ex); log("dataset", f"{ds_name} id={ds.id}")
except Exception as e: log("dataset", f"FAILED: {e!s:.300}")
if ds:
    try:
        exs = c.datasets.list_examples(dataset=ds.id, all=True).examples
        er = []
        for e_ in exs:
            d = e_.model_dump() if hasattr(e_, "model_dump") else dict(e_)
            q = d.get("question") or (d.get("additional_properties") or {}).get("question")
            x = next((x for x in rows if x["r"]["question"] == q), rows[0])
            er.append({"example_id": d.get("id"), "output": x["r"]["answer"][:3000], "groundedness_score": x["s"]["ground"], "groundedness_label": "grounded" if x["s"]["ground"] >= .7 else "ungrounded",
                       "citation_score": 1.0 if x["s"]["cpass"] else 0.0, "citation_label": "pass" if x["s"]["cpass"] else "fail"})
        from arize.experiments.types import ExperimentTaskFieldNames, EvaluationResultFieldNames
        expm = c.experiments.create(name="cached-haiku-graphrag-v1", dataset=ds.id, experiment_runs=pd.DataFrame(er),
            task_fields=ExperimentTaskFieldNames(example_id="example_id", output="output"),
            evaluator_columns={"groundedness": EvaluationResultFieldNames(score="groundedness_score", label="groundedness_label"),
                               "citation_guard": EvaluationResultFieldNames(score="citation_score", label="citation_label")})
        log("experiment", f"id={getattr(expm,'id',expm)}")
    except Exception as e: log("experiment", f"FAILED: {type(e).__name__}: {e!s:.400}")
json.dump(OUT, open(os.path.expanduser("~/hack/demo/arize/setup_result.json"), "w"), indent=1, default=str)
