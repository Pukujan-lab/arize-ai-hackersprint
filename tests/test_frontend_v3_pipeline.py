"""O92-O93: the map shows the pipeline working, marks a cached replay, and never names a path the run did
not take."""

import json
import pathlib
import sys

import pytest

from ui_server import DESKTOP, app_server, load_fixture, map_call, map_ready, needs_chromium, needs_v3, open_page, open_run, serve_run

sync_api = pytest.importorskip("playwright.sync_api")
pytestmark = [needs_chromium, needs_v3]

RUN = load_fixture("run-fidelity.json")
RUN_ID = RUN["run_id"]


@pytest.fixture(scope="module")
def base():
    with app_server() as url:
        yield url


@pytest.fixture(scope="module")
def browser():
    with sync_api.sync_playwright() as p:
        b = p.chromium.launch(args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader"])
        yield b
        b.close()


def test_O92_the_map_shows_the_pipeline_while_it_works(base, browser):
    ticks = [
        {"events": [{"agent": "planner", "kind": "plan", "msg": "plan: retrieve -> answer -> safeguard"}], "result": None},
        {"events": [{"agent": "retriever", "kind": "seeds", "msg": "8 seed authorities"}], "result": None},
        {"events": [{"agent": "answer", "kind": "draft", "msg": "drafted answer"}], "result": None},
        {"events": [{"agent": "safeguard", "kind": "release", "msg": "PASS"}], "result": None},
        {"events": [{"agent": "planner", "kind": "done", "msg": "pipeline complete"}], "result": {"result": RUN}},
    ]
    seen = {"n": 0}

    def run_route(route):
        tick = ticks[min(seen["n"], len(ticks) - 1)]
        seen["n"] += 1
        route.fulfill(status=200, content_type="application/json", body=json.dumps(tick))

    def setup(page):
        page.route("**/api/ask", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps({"run_id": RUN_ID})))
        page.route("**/api/run/**", run_route)

    ctx, page = open_page(browser, base, "/map", DESKTOP, setup=setup)
    map_ready(page)
    page.get_by_role("textbox", name="Ask a question").fill(RUN["question"])
    page.get_by_role("button", name="Ask", exact=True).click()

    page.wait_for_function("() => (window.__precedentMap.v1.state().pipeline || {}).stages.length >= 2", timeout=15000)
    region = page.get_by_role("region", name="Pipeline")
    assert region.count() == 1, "the map has no Pipeline region"
    text = region.inner_text().lower()
    for stage in ("planner", "retriever", "answer", "safeguard"):
        assert stage in text, f"the pipeline does not show {stage}: {text!r}"

    stages = map_call(page, "state().pipeline.stages")
    assert any(stage.get("state") in ("done", "finished") for stage in stages), f"no stage is ever marked finished: {stages}"
    ctx.close()


def test_O92_a_cached_run_is_marked_as_a_replay(base, browser):
    run = dict(RUN, provider="cache")
    ctx, page = open_run(browser, base, run, path="/map", run_id="run-replay")
    map_ready(page)
    page.wait_for_timeout(800)
    pipeline = map_call(page, "state().pipeline") or {}
    assert pipeline.get("replay") is True, f"a cached run is not marked as a replay: {pipeline}"
    text = page.get_by_role("region", name="Pipeline").inner_text().lower()
    assert "replay" in text or "cached" in text, f"the map does not say the run was replayed: {text!r}"
    ctx.close()


def test_O93_stage_messages_name_the_path_actually_taken():
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
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

    run = coord.Run("test-o93")
    try:
        agents.retriever(run, "a question about a thing")
        events = [json.loads(line) for line in run.log.read_text().splitlines() if line.strip()]
    finally:
        agents.graph, octo_retriever.search = original_graph, original_search
        shutil.rmtree(run.dir, ignore_errors=True)
    messages = " ".join(event.get("msg", "") for event in events)
    for claim in ("SurrealDB", "hybrid", "PageRank"):
        assert claim.lower() not in messages.lower(), f"the run claims {claim!r} without using it: {messages!r}"

    seed = next((event for event in events if event.get("kind") == "seeds"), {})
    passage = next((event for event in events if event.get("kind") == "passages"), {})
    assert seed.get("backend") == "networkx", f"the seed event does not name the graph actually used: {seed}"
    assert passage.get("source") == "octo-live", f"the passage event does not name the search actually used: {passage}"
