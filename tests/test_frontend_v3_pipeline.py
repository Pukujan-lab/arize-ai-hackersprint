"""O92-O93: the map shows the pipeline working, marks a cached replay, and never names a path the run did
not take."""

import json
import pathlib
import sys

import pytest

from ui_server import needs_chromium, needs_v3

sync_api = pytest.importorskip("playwright.sync_api")
pytestmark = [needs_chromium, needs_v3]


def test_O93_stage_messages_name_the_path_actually_taken():
    root = pathlib.Path(__file__).resolve().parent.parent
    sys.path.insert(0, str(root))
    from app import agents, coord, octo_retriever

    class FakeGraph:
        backend = "networkx"
        nodes = {"A v. B": {"id": "A v. B"}, "C.R.S. § 1-1-101": {"id": "C.R.S. § 1-1-101"}}
        indeg = {"A v. B": 1, "C.R.S. § 1-1-101": 2}

        def seeds(self, question, k=10):
            return ["A v. B", "C.R.S. § 1-1-101"], ["question"]

        def info(self, nid):
            return {"id": nid, "title": nid, "type": "caselaw", "court": "Colorado Supreme Court", "date": "2000-01-01", "url": ""}

        def neighbors(self, nid, direction):
            return []

    passages = [
        {
            "chunk_id": "c1",
            "work_id": "A v. B",
            "case_name": "A v. B",
            "court": "Colorado Supreme Court",
            "date": "2000-01-01",
            "url": "",
            "score": 1.0,
            "text": "A passage.",
        }
    ]

    original_graph, original_search = agents.graph, octo_retriever.search
    agents.graph = lambda: FakeGraph()
    octo_retriever.search = lambda question, k=12: (passages, "octo-live")
    import shutil

    assignment = root / ".coord" / "assignment.json"
    before = assignment.read_bytes() if assignment.exists() else None
    run = coord.Run("test-o93")
    try:
        agents.retriever(run, "a question about a thing")
        events = [json.loads(line) for line in run.log.read_text().splitlines() if line.strip()]
    finally:
        agents.graph, octo_retriever.search = original_graph, original_search
        shutil.rmtree(run.dir, ignore_errors=True)
        if before is not None:
            assignment.write_bytes(before)
    messages = " ".join(event.get("msg", "") for event in events)
    for claim in ("SurrealDB", "hybrid", "PageRank"):
        assert claim.lower() not in messages.lower(), f"the run claims {claim!r} without using it: {messages!r}"

    seed = next((event for event in events if event.get("kind") == "seeds"), {})
    passage = next((event for event in events if event.get("kind") == "passages"), {})
    assert seed.get("backend") == "networkx", f"the seed event does not name the graph actually used: {seed}"
    assert passage.get("source") == "octo-live", f"the passage event does not name the search actually used: {passage}"
