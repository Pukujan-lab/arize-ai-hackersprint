"""O80-O86: the map draws every county boundary, names the deciding court and the year, places each
authority where its record places it, links only what it shows, moves as a run arrives, and states the
run's short answer."""

import copy

import pytest

from ui_server import DESKTOP, app_server, load_fixture, map_call, map_ready, needs_chromium, needs_v3, open_page, serve_run

sync_api = pytest.importorskip("playwright.sync_api")
pytestmark = [needs_chromium, needs_v3]

RUN = load_fixture("run-fidelity.json")
RUN_ID = RUN["run_id"]
COURT_INDEX = 0
COURT_NAME = RUN["citations"][COURT_INDEX]["court"]
COURT_YEAR = RUN["citations"][COURT_INDEX]["date"][:4]


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


def _open(browser, base, run=RUN, run_id=RUN_ID, width=DESKTOP, path="/map", **kwargs):
    ctx, page = open_page(
        browser,
        base,
        f"{path}?run={run_id}",
        width,
        setup=lambda p: serve_run(p, run, run_id),
        **kwargs,
    )
    map_ready(page)
    page.wait_for_timeout(700)
    return ctx, page


def _state(page):
    return map_call(page, "state()")


def _labels(page):
    return map_call(page, "labels()")


def _ask(page, question):
    page.get_by_role("textbox", name="Ask a question").fill(question)
    page.get_by_role("button", name="Ask", exact=True).click()


def _serve_ask(page, run_id):
    import json

    page.route(
        "**/api/ask",
        lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps({"run_id": run_id})),
    )


def test_O80_every_county_has_a_visible_boundary(base, browser):
    for scheme in ("dark", "light"):
        ctx, page = _open(browser, base, color_scheme=scheme)
        scene = _state(page)["scene"]
        outlines = scene.get("countyOutlines", 0)
        assert outlines >= 60, f"{scheme}: the scene draws {outlines} county boundaries, not the 64 counties"
        assert scene.get("countyMeshes", 0) > 0, f"{scheme}: the scene draws no county solids"
        ctx.close()


def test_O81_court_labels_name_the_court_and_the_year(base, browser):
    ctx, page = _open(browser, base)
    map_call(page, f"zoomToCourt({COURT_INDEX})")
    page.wait_for_timeout(1200)

    labels = _labels(page)
    assert labels, "the court view has no labels"
    target = next((label for label in labels if RUN["citations"][COURT_INDEX]["title"][:18].lower() in label["text"].lower()), None)
    assert target, f"no label names the focused authority: {[l['text'] for l in labels]}"
    assert COURT_NAME.lower() in target["text"].lower(), f"the label omits the deciding court: {target['text']!r}"
    assert COURT_YEAR in target["text"], f"the label omits the year: {target['text']!r}"

    boxes = [(l["x"] - l["w"] / 2, l["y"] - l["h"] / 2, l["x"] + l["w"] / 2, l["y"] + l["h"] / 2) for l in labels]
    for i, a in enumerate(boxes):
        for b in boxes[i + 1 :]:
            overlap = a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]
            assert not overlap, f"two court labels overlap: {labels[i]['text']!r}"
    ctx.close()


def test_O82_the_deciding_court_is_the_same_in_the_memo_and_on_the_map(base, browser):
    ctx, page = _open(browser, base)
    page.get_by_role("button", name="Memo menu", exact=True).click()
    page.wait_for_timeout(200)
    page.get_by_role("button", name="Sources").click()
    page.wait_for_timeout(300)
    panel = page.get_by_role("dialog", name="Sources")
    text = panel.inner_text() if panel.count() else page.inner_text("body")
    assert COURT_NAME.lower() in text.lower(), f"the source list does not name {COURT_NAME!r}: {text[:400]!r}"

    map_call(page, f"zoomToCourt({COURT_INDEX})")
    page.wait_for_timeout(1200)
    labels = " ".join(l["text"] for l in _labels(page))
    assert COURT_NAME.lower() in labels.lower(), f"the map does not name the same court: {labels!r}"
    ctx.close()


def test_O83_authorities_are_placed_where_their_record_places_them(base, browser):
    ctx, page = _open(browser, base)
    state = _state(page)
    pins = map_call(page, "pins()")
    keys = {pin["key"] for pin in pins}
    counties = {key for key in keys if key.startswith("c:")}
    assert len(pins) >= 5, f"eight authorities across five places collapse into {len(pins)} pins: {pins}"
    assert counties, f"no authority is placed in a county named by its record: {pins}"
    assert "0 counties linked" not in state["summary"], f"the map reports no county coverage: {state['summary']!r}"
    ctx.close()


def test_O83_a_run_with_no_county_authority_says_so(base, browser):
    run = copy.deepcopy(RUN)
    run["run_id"] = "run-no-county"
    for citation in run["citations"]:
        citation["origin_text"] = None
        citation["passage"] = ""
        citation["court"] = ""
    ctx, page = _open(browser, base, run=run, run_id="run-no-county")
    summary = _state(page)["summary"].lower()
    assert "no county" in summary or "no county-level" in summary, f"a run with no county authority claims county coverage: {summary!r}"
    ctx.close()


def test_O84_every_drawn_link_joins_two_shown_authorities(base, browser):
    ctx, page = _open(browser, base)
    state = _state(page)
    shown = {c["id"] for c in RUN["citations"]}
    for edge in RUN["edges"]:
        assert edge["src"] in shown and edge["dst"] in shown, f"the fixture links an authority that is not shown: {edge}"

    counts = state.get("arcCounts") or {}
    drawn = state.get("arcsDrawn", sum(counts.values()))
    assert drawn == len(RUN["edges"]), f"the map draws {drawn} links for {len(RUN['edges'])} shown links"
    assert sum(counts.values()) == drawn, f"the reported link count {counts} does not match the drawn links {drawn}"
    ctx.close()


def test_O85_a_run_arrives_with_motion(base, browser):
    ctx, page = _open(browser, base)
    early = _state(page).get("motion") or {}
    assert early.get("running") is True, f"the run appears without motion: {early}"
    assert early.get("born"), f"the pins are not staggered: {early}"
    page.wait_for_timeout(3500)
    late = _state(page).get("motion") or {}
    assert late.get("arcProgress", 1) >= 0.99, f"the links never finish drawing: {late}"
    assert late.get("running") is False, f"the arrival animation never ends: {late}"
    ctx.close()


def test_O85_reduced_motion_keeps_the_information(base, browser):
    ctx, page = _open(browser, base, motion="reduce")
    state = _state(page)
    motion = state.get("motion") or {}
    assert motion.get("running") is False, f"reduced motion still animates: {motion}"
    assert map_call(page, "pinCount") >= 5, "reduced motion hides the pins"
    assert state.get("arcsDrawn", 0) == len(RUN["edges"]), "reduced motion hides the links"
    ctx.close()


def test_O86_the_map_states_the_short_answer(base, browser):
    ctx, page = _open(browser, base)
    short = map_call(page, "shortAnswer()")
    assert short, "the map has no short answer"
    expected = "Likely no"
    assert expected.lower() in short.lower(), f"the map's summary is not the memo's short answer: {short!r}"
    header = page.locator("section").first.inner_text()
    assert expected.lower() in header.lower(), f"the short answer is not shown on the map: {header[:300]!r}"
    ctx.close()
