import os,json,pandas as pd
from arize import ArizeClient
from arize.experiments.types import ExperimentTaskFieldNames
from arize.experiments.evaluators.types import EvaluationResultFieldNames
fr=json.load(open("arize/fresh_traces.json")); runs={r["question"]:r for r in json.load(open("runs10.json"))}
c=ArizeClient(api_key=os.environ["ARIZE_API_KEY"]); DS="RGF0YXNldDozNzAyNzY6VzhuaA=="
exs=c.datasets.list_examples(dataset=DS, all=True).examples; er=[]
for e_ in exs:
    d=e_.model_dump() if hasattr(e_,"model_dump") else dict(e_)
    q=d.get("question") or (d.get("additional_properties") or {}).get("question")
    x=next(x for x in fr if x["q"]==q); r=runs[q]
    er.append({"example_id":d["id"],"output":r["answer"][:3000],"g_s":x["ground"],"g_l":"grounded" if x["ground"]>=.7 else "ungrounded","c_s":float(x["cpass"]),"c_l":"pass" if x["cpass"] else "fail","r_s":x["rel"],"r_l":"relevant" if x["rel"]>=.5 else "irrelevant"})
e=c.experiments.create(name="cached-haiku-graphrag-v1", dataset=DS, experiment_runs=pd.DataFrame(er),
    task_fields=ExperimentTaskFieldNames(example_id="example_id", output="output"),
    evaluator_columns={"groundedness":EvaluationResultFieldNames(score="g_s",label="g_l"),"citation_guard":EvaluationResultFieldNames(score="c_s",label="c_l"),"citation_relevance":EvaluationResultFieldNames(score="r_s",label="r_l")})
print("experiment ->", getattr(e,"id",e))
