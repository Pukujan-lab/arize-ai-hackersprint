"""/observability is a plain-language dashboard (#56, #45). Summary cards and charts come from the real endpoints
(/api/runs, /api/run/<id>, the Arize snapshot, /api/health), the filters change what is shown, pipeline steps and raw
details start collapsed, and an empty state shows when there is no data. Responses are stubbed here with known
numbers so the test can check the page computes from them rather than inventing values."""

import datetime as dt
import json

import pytest
from ui_server import DESKTOP, app_server, is_visible, needs_chromium

sync_api = pytest.importorskip("playwright.sync_api")
pytestmark = needs_chromium

NOW = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
RUNS = [
    {"run_id": f"r{i}", "question": f"Question {i}", "n": 3, "ts": NOW, "model": p, "safeguard": "pass" if ok else "fail"}
    for i, (p, ok) in enumerate([("inferhub/deepseek", True), ("inferhub/deepseek (cached)", True), ("inferhub/deepseek", True), ("template", False)])
]
ELAPSED = [2.0, 4.0, 6.0, 8.0]


def _result(i):
    r = RUNS[i]
    return {
        "run_id": r["run_id"],
        "events": [{"t": 0, "agent": "planner", "kind": "claim"}, {"t": ELAPSED[i], "agent": "safeguard", "kind": "release"}],
        "result": {
            "run_id": r["run_id"],
            "question": r["question"],
            "provider": r["model"],
            "elapsed_s": ELAPSED[i],
            "safeguard": {"pass": r["safeguard"] == "pass", "used": [], "invalid": [], "unknown_authorities": []},
            "citations": [],
        },
    }


def _stub(page, runs):
    def handle(route):
        url = route.request.url
        if "/api/runs" in url:
            return route.fulfill(json=runs)
        if "/api/run/" in url:
            rid = url.rsplit("/", 1)[-1].split("?")[0]
            i = next((k for k, r in enumerate(RUNS) if r["run_id"] == rid), None)
            return route.fulfill(json=_result(i) if i is not None else {"events": []})
        if "observability.json" in url:
            return route.fulfill(json={"traces": [], "project": "precedent"})
        return route.continue_()

    page.route("**/*", handle)


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


def _open(browser, base, runs):
    ctx = browser.new_context(viewport={"width": DESKTOP, "height": 900})
    page = ctx.new_page()
    _stub(page, runs)
    page.goto(base + "/observability", wait_until="load")
    page.wait_for_timeout(2500)
    return ctx, page


def test_cards_compute_from_real_responses(browser, base):
    ctx, page = _open(browser, base, RUNS)
    card = lambda k: page.locator(f"[data-card={k}]").inner_text()  # noqa: E731
    assert "4" in card("answered-today")
    assert "25%" in card("cache")
    assert "5.0" in card("avg-time")
    assert "75%" in card("pass-rate")
    assert page.locator("[data-card=voice-share]").count() == 1
    ctx.close()


def test_charts_render_with_plain_titles(browser, base):
    ctx, page = _open(browser, base, RUNS)
    charts = page.locator("[data-chart]")
    assert charts.count() >= 4
    for i in range(charts.count()):
        c = charts.nth(i)
        assert c.locator("svg, canvas").count() >= 1 or "no data" in c.inner_text().lower()
        assert c.locator("h2, h3, figcaption").first.inner_text().strip()
    ctx.close()


def test_filters_change_what_is_shown(browser, base):
    ctx, page = _open(browser, base, RUNS)
    rows = page.locator("[data-run-row]")
    assert rows.count() == 4
    page.select_option("select#f-provider", label="template")
    page.wait_for_timeout(400)
    assert rows.count() == 1
    assert page.locator("select#f-range").count() == 1 and page.locator("select#f-run").count() == 1
    ctx.close()


def test_sections_start_collapsed(browser, base):
    ctx, page = _open(browser, base, RUNS)
    for sel in ["details#pipeline-steps", "details#raw-details"]:
        assert page.locator(sel).count() == 1, sel
        assert page.eval_on_selector(sel, "e => e.open") is False, sel
    ctx.close()


def test_empty_state(browser, base):
    ctx, page = _open(browser, base, [])
    assert is_visible(page, "#obs-empty")
    text = json.dumps(page.locator("[data-card]").all_inner_texts())
    assert "NaN" not in text and "undefined" not in text
    ctx.close()
