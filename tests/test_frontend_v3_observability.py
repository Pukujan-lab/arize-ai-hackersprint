"""O39-O42: the observability page lists saved runs, shows the selected run's summary, pipeline steps and
timings, opens a step's raw details, and says so when the data source is unavailable.

O104-O106: the page shows the retrieval stages a run actually took, reports tracing honestly, and reports
the first-in-first-out caps of the saved runs and the trace queue."""

import copy
import re

import pytest

from ui_server import DESKTOP, app_server, load_fixture, needs_chromium, needs_v3, open_page

sync_api = pytest.importorskip("playwright.sync_api")
pytestmark = [needs_chromium, needs_v3]

RUNS = [
    {
        "run_id": "r0",
        "question": "Which Colorado counties apply the exemption to mineral rights?",
        "n": 3,
        "ts": "2026-10-18T12:00:00Z",
    },
    {
        "run_id": "r1",
        "question": "How are severed mineral interests valued?",
        "n": 5,
        "ts": "2026-10-18T11:00:00Z",
    },
]
EVENTS = [
    {"t": 0.0, "agent": "planner", "kind": "claim"},
    {"t": 4.2, "agent": "retriever", "kind": "release"},
    {"t": 9.8, "agent": "writer", "kind": "release"},
    {"t": 12.5, "agent": "safeguard", "kind": "release"},
]
RESULT = {
    "run_id": "r0",
    "question": RUNS[0]["question"],
    "answer": "Short answer: the exemption follows the residence [1].",
    "elapsed_s": 12.5,
    "provider": "inferhub/deepseek",
    "safeguard": {"pass": True, "used": [], "invalid": [], "unknown_authorities": []},
    "citations": [{"id": "a", "title": "A", "ref": "[1]"}, {"id": "b", "title": "B", "ref": "[2]"}],
}

STACK = load_fixture("stack-observability.json")
RUN = load_fixture("run-observability.json")
RUN_ID = RUN["run_id"]
OBSERVED_RUNS = [
    {"run_id": RUN_ID, "question": RUN["question"], "n": len(RUN["citations"]), "ts": "2026-10-19T12:00:00Z"}
]

@pytest.fixture(scope="module")
def base():
    with app_server() as url:
        yield url

@pytest.fixture(scope="module")
def browser():
    with sync_api.sync_playwright() as p:
        b = p.chromium.launch()
        yield b
        b.close()

def _stub(page, runs=RUNS, runs_status=200):
    def handle(route):
        url = route.request.url
        if "/api/runs" in url:
            if runs_status != 200:
                return route.fulfill(status=runs_status, content_type="application/json", body="{}")
            return route.fulfill(json=runs)
        if "/api/run/" in url:
            return route.fulfill(json={"events": EVENTS, "result": RESULT})
        if "observability.json" in url:
            return route.fulfill(json={"traces": [], "project": "precedent"})
        route.continue_()

    page.route("**/*", handle)

def _open(browser, base, **kw):
    ctx, page = open_page(browser, base, "/observability", DESKTOP, setup=lambda p: _stub(p, **kw))
    page.wait_for_timeout(1500)
    return ctx, page

def test_O39_saved_runs_are_listed_and_selectable(base, browser):
    ctx, page = _open(browser, base)
    for run in RUNS:
        assert page.get_by_role("button", name=run["question"]).count() == 1, f"{run['run_id']} is not listed by its question"
    ctx.close()

def test_O40_the_selected_run_shows_its_summary_steps_and_timings(base, browser):
    ctx, page = _open(browser, base)
    page.get_by_role("button", name=RUNS[1]["question"]).click()
    page.wait_for_timeout(800)
    text = page.inner_text("body")
    assert RUNS[1]["question"] in text, "the selected run's question is not shown"
    assert "12.5" in text, "the run's elapsed time is not shown"
    for agent in ("planner", "retriever", "writer", "safeguard"):
        assert agent in text.lower(), f"the pipeline step {agent!r} is missing"
    assert "4.2" in text or "4.2s" in text, "the step timings are not shown"
    ctx.close()

def test_O41_a_step_opens_its_raw_details(base, browser):
    ctx, page = _open(browser, base)
    control = page.get_by_role("button", name="Raw details").first
    assert control.count() == 1, "no step offers its raw details"
    control.click()
    page.wait_for_timeout(400)
    shown = page.inner_text("body")
    assert "agent" in shown and "kind" in shown, "the raw details do not show the step's record"
    ctx.close()

def test_O42_an_unavailable_source_is_stated_not_blank(base, browser):
    ctx, page = _open(browser, base, runs_status=503)
    text = page.inner_text("body")
    assert text.strip(), "the page went blank when the data source failed"
    assert any(w in text.lower() for w in ("unavailable", "couldn't", "could not", "try again", "error")), (
        f"the page does not say the data source is unavailable: {text[:200]!r}"
    )
    assert "NaN" not in text and "undefined" not in text, "the page shows broken values"
    ctx.close()


def _stub_observability(page, stack):
    def handle(route):
        url = route.request.url
        if "/api/runs" in url:
            return route.fulfill(json=OBSERVED_RUNS)
        if "/api/stack" in url:
            return route.fulfill(json=stack)
        if f"/api/run/{RUN_ID}" in url:
            return route.fulfill(json={"result": RUN})
        route.continue_()

    page.route("**/*", handle)


def _open_observability(browser, base, stack=None):
    stack = stack if stack is not None else STACK
    ctx, page = open_page(
        browser, base, "/observability", DESKTOP, setup=lambda p: _stub_observability(p, stack)
    )
    page.wait_for_timeout(1500)
    return ctx, page


def _panel(page, name):
    region = page.get_by_role("region", name=name)
    region.wait_for(timeout=15000)
    return region.inner_text().lower()


def test_O104_the_page_shows_the_retrieval_stages_of_the_selected_run(base, browser):
    ctx, page = _open_observability(browser, base)
    text = _panel(page, "Retrieval stages")

    positions = []
    for stage in ("parse", "bm25", "dense", "hybrid", "graph", "rerank", "jev"):
        at = text.find(stage)
        assert at >= 0, f"the retrieval stages do not name {stage!r}: {text!r}"
        positions.append(at)
    assert positions == sorted(positions), f"the retrieval stages are not shown in the order they ran: {text!r}"

    assert re.search(r"2\.1\s*s|2100\s*ms", text), f"the rerank stage does not show how long it took: {text!r}"
    assert "not configured" in text, f"the stage that did not run does not say why: {text!r}"
    assert "openrouter" in text, f"the skipped stage does not name the missing setting: {text!r}"
    ctx.close()


def test_O105_tracing_reports_failure_and_counts(base, browser):
    ctx, page = _open_observability(browser, base)
    text = _panel(page, "Tracing")

    assert "arize" in text, f"the tracing panel does not name where spans go: {text!r}"
    assert "permission_denied" in text or "permission denied" in text, (
        f"the tracing panel hides why export failed: {text!r}"
    )
    assert "not connected" in text or "failed" in text, f"the tracing panel does not say export is failing: {text!r}"
    assert re.search(r"\b0\b", text), f"the tracing panel does not report how many spans were sent: {text!r}"
    assert re.search(r"\b4\b", text), f"the tracing panel does not report how many spans were dropped: {text!r}"
    assert re.search(r"\b2\b", text), f"the tracing panel does not report how many spans are queued: {text!r}"
    ctx.close()


def test_O105_tracing_reports_delivery(base, browser):
    stack = copy.deepcopy(STACK)
    stack["tracing"] = {"ok": True, "project": "precedent-legal-graphrag", "sent": 37, "dropped": 0, "queued": 0}
    ctx, page = _open_observability(browser, base, stack)
    text = _panel(page, "Tracing")

    assert re.search(r"\b37\b", text), f"the tracing panel does not report the spans that reached Arize: {text!r}"
    assert "permission" not in text, f"a healthy exporter is reported as failing: {text!r}"
    assert "failed" not in text, f"a healthy exporter is reported as failing: {text!r}"
    ctx.close()


def test_O106_saved_runs_and_the_trace_queue_are_bounded_fifo(base, browser):
    ctx, page = _open_observability(browser, base)
    text = _panel(page, "Retention")

    assert re.search(r"\b200\b", text), f"the retention panel does not report the saved-run cap: {text!r}"
    assert re.search(r"\b2000\b", text) or re.search(r"\b2,000\b", text), (
        f"the retention panel does not report the trace-queue cap: {text!r}"
    )
    assert re.search(r"\b4\b", text), f"the retention panel does not report how many spans were dropped: {text!r}"
    assert "oldest" in text, f"the retention panel does not say the oldest entry is dropped first: {text!r}"
    ctx.close()
