"""Build the Arize dataset (10 demo questions + expected citations from their verified runs) and a no-LLM
retrieval experiment comparing seed settings k=6 (prod) vs k=3. Writes CSVs for Arize upload."""
import json, glob, csv, os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ["USE_OCTO"] = "0"
import agents
rids = json.load(open("/tmp/arize_rids.json"))
rows = []
for rid in rids:
    r = json.load(open(f"runs/{rid}/result.json"))
    exp = [c["title"] for c in r["citations"] if c.get("ref") and ("[" + c["ref"].strip("[]") + "]") in r["answer"]]
    rows.append({"id": rid, "question": r["question"], "expected_citations": json.dumps(exp), "reference_answer": r["answer"][:600]})
with open("arize/precedent_demo_dataset.csv", "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=list(rows[0])); w.writeheader(); w.writerows(rows)
g = agents.graph(); out = []
for row in rows:
    exp = set(json.loads(row["expected_citations"]))
    from coord import Run
    for k in ("seeds_only_k6", "graph_expansion"):
        if k == "seeds_only_k6":
            seeds, _ = g.seeds(row["question"], k=6); titles = {g.info(s)["title"] for s in seeds}
        else:
            ret = agents.retriever(Run("exp-" + row["id"]), row["question"]); titles = {c["title"] for c in ret["citations"]}
        hit = len([e for e in exp if any(e[:25] in t or t[:25] in e for t in titles)])
        out.append({"example_id": row["id"], "question": row["question"], "setting": k, "expected_n": len(exp), "hits": hit,
                    "eval.citation_recall.score": round(hit / len(exp), 3) if exp else 0.0, "eval.citation_recall.label": "pass" if exp and hit / len(exp) >= 0.5 else "fail"})
with open("arize/experiment_retrieval_k.csv", "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=list(out[0])); w.writeheader(); w.writerows(out)
for k in ("seeds_only_k6", "graph_expansion"):
    s = [o["eval.citation_recall.score"] for o in out if o["setting"] == k]
    print(f"{k}: mean citation recall {sum(s)/len(s):.2f} over {len(s)} questions")
