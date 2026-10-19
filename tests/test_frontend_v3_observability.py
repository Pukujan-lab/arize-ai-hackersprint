"""O39-O42: the observability page lists saved runs, shows the selected run's summary, pipeline steps and
timings, opens a step's raw details, and says so when the data source is unavailable."""

import pytest

from ui_server import DESKTOP, app_server, needs_chromium, needs_v3, open_page

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
