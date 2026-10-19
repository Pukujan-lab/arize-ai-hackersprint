"""O58-O61: the observability page is a dashboard. It states five figures read from the server, plots
answers per day and mean seconds per step, filters all of it by range, answer source and question, and
lists the filtered runs in a table whose rows open the run's steps."""

import re
from datetime import datetime, timedelta, timezone

import pytest

from ui_server import DESKTOP, app_server, needs_chromium, needs_v3, open_page

sync_api = pytest.importorskip("playwright.sync_api")
pytestmark = [needs_chromium, needs_v3]


def _iso(delta):
    return (datetime.now(timezone.utc) - delta).strftime("%Y-%m-%dT%H:%M:%SZ")


RUNS = [
    {"run_id": "r1", "question": "Which counties apply the exemption?", "n": 4, "ts": _iso(timedelta(minutes=10))},
    {"run_id": "r2", "question": "How are severed interests valued?", "n": 6, "ts": _iso(timedelta(minutes=20))},
    {"run_id": "r3", "question": "What notice is required before a hearing?", "n": 2, "ts": _iso(timedelta(days=3))},
    {"run_id": "r4", "question": "When does the appeal period start?", "n": 5, "ts": _iso(timedelta(days=8))},
]

RESULTS = {
    "r1": {"elapsed_s": 10.0, "provider": "cached:abc", "pass": True},
    "r2": {"elapsed_s": 14.0, "provider": "inferhub/deepseek", "pass": True},
    "r3": {"elapsed_s": 20.0, "provider": "template", "pass": False},
    "r4": {"elapsed_s": 16.0, "provider": "inferhub/deepseek", "pass": True},
}

EVENTS = [
    {"t": 0.0, "agent": "planner", "kind": "claim"},
    {"t": 4.2, "agent": "retriever", "kind": "release"},
    {"t": 9.8, "agent": "writer", "kind": "release"},
    {"t": 12.5, "agent": "safeguard", "kind": "release"},
]

STACK = {
    "octo": {"corpus": "327,407 passages"},
    "surrealdb": {"nodes": 119770, "edges": 160793},
    "elevenlabs": {"chain": ["fish", "kokoro", "browser"]},
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


def _stub(page, runs=RUNS):
    def handle(route):
        url = route.request.url
        if "/api/stack" in url:
            return route.fulfill(json=STACK)
        if "/api/runs" in url:
            return route.fulfill(json=runs)
        if "/api/run/" in url:
            run_id = url.rstrip("/").split("/")[-1].split("?")[0]
            run = next((r for r in runs if r["run_id"] == run_id), runs[0])
            extra = RESULTS.get(run["run_id"], RESULTS["r1"])
            return route.fulfill(
                json={
                    "events": EVENTS,
                    "result": {
                        "run_id": run["run_id"],
                        "question": run["question"],
                        "answer": "Short answer: the exemption follows the residence [1].",
                        "elapsed_s": extra["elapsed_s"],
                        "provider": extra["provider"],
                        "safeguard": {"pass": extra["pass"], "used": [], "invalid": [], "unknown_authorities": []},
                        "citations": [{"id": "a", "title": "A", "ref": "[1]"}],
                    },
                }
            )
        if "observability.json" in url:
            return route.fulfill(json={"traces": []})
        route.continue_()

    page.route("**/*", handle)


def _open(browser, base):
    ctx, page = open_page(browser, base, "/observability", DESKTOP, setup=_stub)
    page.wait_for_timeout(2000)
    return ctx, page


def _text(page):
    return page.inner_text("body")


def _figure_near(text, label, value):
    """A figure may print its number above or below its label; check the 90 characters around the label."""
    lowered = text.lower()
    start = lowered.find(label)
    assert start >= 0, f"the page does not label the figure {label!r}: {text[:300]!r}"
    window = lowered[max(0, start - 90) : start + len(label) + 90]
    assert value in window, f"{label!r} does not state {value!r} nearby: {window!r}"


def _rows(page):
    table = page.get_by_role("table", name="Saved runs table")
    assert table.count() == 1, "the page has no table of saved runs"
    return table.get_by_role("row").count() - 1


def test_O58_five_figures_read_from_the_server(base, browser):
    ctx, page = _open(browser, base)
    text = _text(page)

    _figure_near(text, "questions answered today", "2")
    _figure_near(text, "cache", "25%")
    _figure_near(text, "average answer time", "15.0")
    _figure_near(text, "citation", "75%")
    assert "fish" in text.lower() and "kokoro" in text.lower(), f"the voice chain is not stated: {text[:400]!r}"

    ctx.close()


def test_O59_the_page_plots_answers_and_step_times(base, browser):
    ctx, page = _open(browser, base)
    answers = page.get_by_role("img", name=re.compile(r"answer", re.I))
    steps = page.get_by_role("img", name=re.compile(r"step", re.I))
    assert answers.count() >= 1, "no plot is labelled as answers per day"
    assert steps.count() >= 1, "no plot is labelled as seconds per pipeline step"
    ctx.close()


def test_O60_filters_drive_the_figures_and_the_table(base, browser):
    ctx, page = _open(browser, base)
    assert _rows(page) == 4, "the table does not list every saved run by default"

    page.get_by_role("combobox", name="Range").select_option(label="Today")
    page.wait_for_timeout(800)
    assert _rows(page) == 2, "the Today range did not narrow the table"
    _figure_near(_text(page), "questions answered today", "2")

    page.get_by_role("combobox", name="Range").select_option(label="All")
    page.get_by_role("combobox", name="Answer source").select_option(label="template")
    page.wait_for_timeout(800)
    assert _rows(page) == 1, "the answer-source filter did not narrow the table"
    ctx.close()


def test_O61_the_run_table_opens_a_run_and_its_steps(base, browser):
    ctx, page = _open(browser, base)
    table = page.get_by_role("table", name="Saved runs table")
    headers = " ".join(table.get_by_role("columnheader").all_inner_texts()).lower()
    for name in ("question", "source", "time", "authorities", "check"):
        assert name in headers, f"the run table has no {name!r} column: {headers!r}"

    table.get_by_role("row").filter(has_text="Which counties apply the exemption?").click()
    page.wait_for_timeout(1200)
    text = _text(page).lower()
    for step in ("planner", "retriever", "writer", "safeguard"):
        assert step in text, f"opening the run does not show its {step} step"
    assert page.get_by_role("button", name="Raw details").count() >= 1
    ctx.close()
