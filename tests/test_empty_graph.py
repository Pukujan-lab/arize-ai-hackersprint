"""When the graph data (data/nodes.jsonl, edges.jsonl) is missing, a run must finish fast with a clear
'data not loaded' answer instead of raising inside the worker thread and leaving /api/run/<id> polling forever."""

import os, sys, json, pathlib, threading

sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))
os.environ["LLM_MODE"] = "fake"
import agents, graph_store


def test_missing_graph_returns_data_not_loaded(tmp_path, monkeypatch):
    monkeypatch.setattr(graph_store, "D", tmp_path / "empty")  # no nodes.jsonl / edges.jsonl
    monkeypatch.setattr(graph_store, "CACHE", tmp_path / "graph_meta.pkl")
    monkeypatch.setattr(agents, "_G", None)
    out = {}
    t = threading.Thread(target=lambda: out.update(r=agents.run_pipeline("Automobile exception: probable cause standard in Colorado")), daemon=True)
    t.start()
    t.join(20)
    assert not t.is_alive(), "pipeline hung with an empty graph"
    r = out.get("r")
    assert r, "pipeline raised instead of returning a result"
    assert "data not loaded" in r["answer"].lower()
    assert r["citations"] == [] and r["backend"] == "unavailable" and not r["safeguard"]["pass"]
    res = pathlib.Path(agents.__file__).parent / "runs" / r["run_id"] / "result.json"
    assert json.loads(res.read_text())["run_id"] == r["run_id"]  # /api/run/<id> sees a finished result
