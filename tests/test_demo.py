import os, sys, json, pathlib

sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))
os.environ["LLM_MODE"] = "fake"
import agents


def test_pipeline_cites_only_retrieved():
    r = agents.run_pipeline("What counts as motor vehicle theft?")
    assert r["citations"] and r["safeguard"]["pass"]
    refs = {c["ref"] for c in r["citations"]}
    assert set(r["safeguard"]["used"]) <= refs


def test_safeguard_catches_hallucination():
    from coord import Run

    ret = {"citations": [{"ref": "[1]", "id": "C.R.S. § 18-4-409", "title": "Motor vehicle theft"}]}
    sg = agents.safeguard(Run("test-halluc"), "q", ret, {"text": "Theft is covered by [1] and also [7] and 999 U.S.C. § 12."})
    assert not sg["pass"] and "[7]" in sg["invalid"] and sg["unknown_authorities"]


def test_events_log_has_all_agents():
    r = agents.run_pipeline("homestead exemption")
    ev = [json.loads(l) for l in open(pathlib.Path(agents.__file__).parent / "runs" / r["run_id"] / "events.jsonl")]
    assert {"planner", "retriever", "answer", "safeguard"} <= {e["agent"] for e in ev}
