import os, json, time, datetime as dt, pandas as pd
from arize import ArizeClient
SPACE=os.environ["ARIZE_SPACE_ID"]; PROJ=os.environ.get("ARIZE_PROJECT_NAME","precedent-legal-graphrag")
fr=json.load(open("arize/fresh_traces.json")); runs={r["question"]:r for r in json.load(open("runs10.json"))}
c=ArizeClient(api_key=os.environ["ARIZE_API_KEY"]); OUT={}
def log(k,v): OUT[k]=v; print(k,"->",str(v)[:300],flush=True)
def tryit(k,f):
    try: log(k,f())
    except Exception as e: log(k,f"FAILED {type(e).__name__}: {str(e)[:300]}")
for n in ["groundedness","citation_relevance"]:
    tryit("annot_"+n, lambda n=n: c.annotation_configs.create_continuous(name=n, space=SPACE, minimum_score=0, maximum_score=1, optimization_direction="MAXIMIZE").id)
ev=pd.DataFrame([{"context.span_id":x["span_id"],
 "eval.groundedness.label":"grounded" if x["ground"]>=.7 else "ungrounded","eval.groundedness.score":x["ground"],"eval.groundedness.explanation":"1 - unsupported_claims/sentences (safeguard)",
 "eval.hallucination.label":"hallucinated" if x["halluc"] else "factual","eval.hallucination.score":float(x["halluc"]),"eval.hallucination.explanation":"cited authority not retrieved" if x["halluc"] else "every cited authority was retrieved",
 "eval.citation_relevance.label":"relevant" if x["rel"]>=.5 else "irrelevant","eval.citation_relevance.score":x["rel"],"eval.citation_relevance.explanation":"share of retrieved authorities actually cited",
 "eval.citation_guard.label":"pass" if x["cpass"] else "fail","eval.citation_guard.score":float(x["cpass"]),"eval.citation_guard.explanation":"checks references, not legal accuracy"} for x in fr])
tryit("span_evals", lambda: (c.spans.update_evaluations(space_id=SPACE, project_name=PROJ, dataframe=ev), f"{len(ev)} spans x 4 evals")[1])
ex=[]
for x in fr:
    r=runs[x["q"]]; used=set((r.get("safeguard") or {}).get("used",[]))
    ex.append({"question":x["q"],"expected_citations":json.dumps([cc.get("title") for cc in r.get("citations",[]) if cc.get("ref") in used][:5]),"reference_answer":r["answer"][:3000]})
name="precedent-demo-questions-"+dt.datetime.now().strftime("%m%d-%H%M"); ds=None
try: ds=c.datasets.create(name=name, space=SPACE, examples=ex); log("dataset", f"{name} id={ds.id}")
except Exception as e: log("dataset", f"FAILED {e!s:.300}")
if ds:
  try:
    exs=c.datasets.list_examples(dataset=ds.id, all=True).examples; er=[]
    for e_ in exs:
        d=e_.model_dump() if hasattr(e_,"model_dump") else dict(e_)
        q=d.get("question") or (d.get("additional_properties") or {}).get("question")
        x=next(x for x in fr if x["q"]==q); r=runs[q]
        er.append({"example_id":d["id"],"output":r["answer"][:3000],"g_s":x["ground"],"g_l":"grounded" if x["ground"]>=.7 else "ungrounded","c_s":float(x["cpass"]),"c_l":"pass" if x["cpass"] else "fail"})
    from arize.experiments.types import ExperimentTaskFieldNames, EvaluationResultFieldNames
    e=c.experiments.create(name="cached-haiku-graphrag-v1", dataset=ds.id, experiment_runs=pd.DataFrame(er),
        task_fields=ExperimentTaskFieldNames(example_id="example_id", output="output"),
        evaluator_columns={"groundedness":EvaluationResultFieldNames(score="g_s",label="g_l"),"citation_guard":EvaluationResultFieldNames(score="c_s",label="c_l")})
    log("experiment", f"id={getattr(e,'id',e)}")
  except Exception as e: log("experiment", f"FAILED {type(e).__name__}: {e!s:.400}")
json.dump(OUT,open("push_result.json","w"),indent=1,default=str)
