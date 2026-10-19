"""O53-O57: the composer sits at the bottom of the page, is available with the map shown (including on a
phone at /map), the map zooms from its own controls and from the wheel, and a drag or swipe pans it without
focusing a pin."""

import json

import pytest

from ui_server import (
    DESKTOP,
    MOBILE,
    app_server,
    load_fixture,
    map_call,
    map_ready,
    needs_chromium,
    needs_v3,
    open_page,
    serve_run,
)

sync_api = pytest.importorskip("playwright.sync_api")
pytestmark = [needs_chromium, needs_v3]

RUN = load_fixture("run-spread.json")
RUN_ID = RUN["run_id"]
MEMO_WORDS = " ".join((RUN["answer"] or "").split()[:6])


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


def _install(page):
    serve_run(page, RUN, RUN_ID)
    page.route(
        "**/api/ask",
        lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps({"run_id": RUN_ID})),
    )


def _open(browser, base, path="/", width=DESKTOP):
    ctx, page = open_page(browser, base, f"{path}?run={RUN_ID}", width, setup=_install)
    map_ready(page)
    return ctx, page


def _box(locator):
    box = locator.bounding_box()
    assert box, "the element has no box"
    return box


def _canvas_centre(page):
    box = _box(page.locator("canvas").first)
    return box["x"] + box["width"] / 2, box["y"] + box["height"] / 2


@pytest.mark.parametrize("path", ["/", "/map"])
@pytest.mark.parametrize("width", [MOBILE, DESKTOP])
def test_O53_the_composer_sits_at_the_bottom_of_the_page(base, browser, path, width):
    ctx, page = _open(browser, base, path, width)
    composer = _box(page.get_by_role("textbox", name="Ask a question"))
    height = page.evaluate("window.innerHeight")
    assert composer["y"] + composer["height"] > height * 0.7, f"{path} @{width}: the composer is not at the bottom"

    controls = page.get_by_role("button", name="Listen", exact=True)
    assert controls.count() == 1
    assert _box(controls)["y"] < composer["y"], f"{path} @{width}: the memo controls moved below the composer"

    memo = page.get_by_text(MEMO_WORDS, exact=False).first
    if memo.is_visible():
        assert composer["y"] >= _box(memo)["y"], f"{path} @{width}: the composer is above the memo"
    ctx.close()


def test_O54_the_map_pane_offers_the_composer_on_a_phone(base, browser):
    ctx, page = _open(browser, base, "/map", MOBILE)
    textbox = page.get_by_role("textbox", name="Ask a question")
    ask = page.get_by_role("button", name="Ask", exact=True)
    assert textbox.is_visible(), "the map pane on a phone has no composer"
    assert ask.is_visible() and ask.is_enabled(), "the map pane on a phone has no usable Ask control"

    textbox.fill(RUN["question"])
    ask.click()
    page.get_by_role("button", name="Show memo").click()
    page.get_by_text(MEMO_WORDS, exact=False).first.wait_for(timeout=30000)
    assert page.get_by_text(MEMO_WORDS, exact=False).first.is_visible(), "the question asked from the map left no memo"
    ctx.close()


def test_O55_the_map_zooms_in_out_and_resets_from_its_controls(base, browser):
    ctx, page = _open(browser, base, "/map", DESKTOP)
    start = map_call(page, "state().camera")

    page.get_by_role("button", name="Zoom in").click()
    page.wait_for_timeout(600)
    zoomed = map_call(page, "state().camera")
    assert zoomed["zoom"] > start["zoom"], f"Zoom in did not zoom in: {start} -> {zoomed}"

    page.get_by_role("button", name="Zoom out").click()
    page.get_by_role("button", name="Zoom out").click()
    page.wait_for_timeout(600)
    assert map_call(page, "state().camera")["zoom"] < zoomed["zoom"], "Zoom out did not zoom out"

    page.get_by_role("button", name="Reset view").click()
    page.wait_for_timeout(800)
    assert map_call(page, "state().camera") == start, "Reset view did not return to the national view"
    ctx.close()


def test_O56_a_mouse_drag_pans_the_map_without_focusing_a_pin(base, browser):
    ctx, page = _open(browser, base, "/map", DESKTOP)
    before = map_call(page, "state().camera")
    x, y = _canvas_centre(page)

    page.mouse.move(x, y)
    page.mouse.down()
    page.mouse.move(x + 140, y + 70, steps=10)
    page.mouse.up()
    page.wait_for_timeout(500)

    after = map_call(page, "state().camera")
    assert after != before, "dragging the map did not move the camera"
    assert map_call(page, "state().focus") is None, "a drag focused a pin"
    assert not map_call(page, "state().tour.active"), "a drag started a tour"
    ctx.close()


def test_O56_a_touch_swipe_pans_the_map(browser, base):
    ctx = browser.new_context(viewport={"width": MOBILE, "height": 900}, has_touch=True)
    page = ctx.new_page()
    _install(page)
    page.goto(f"{base}/map?run={RUN_ID}", wait_until="domcontentloaded")
    page.wait_for_load_state("load")
    map_ready(page)
    page.wait_for_timeout(800)

    before = map_call(page, "state().camera")
    x, y = _canvas_centre(page)
    client = ctx.new_cdp_session(page)
    client.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x, "y": y}]})
    for step in range(1, 9):
        client.send(
            "Input.dispatchTouchEvent",
            {"type": "touchMove", "touchPoints": [{"x": x + step * 16, "y": y + step * 8}]},
        )
    client.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
    page.wait_for_timeout(500)

    after = map_call(page, "state().camera")
    assert after != before, "a swipe with a finger did not move the camera"
    ctx.close()


def test_O57_the_wheel_zooms_around_the_pointer(base, browser):
    ctx, page = _open(browser, base, "/map", DESKTOP)
    before = map_call(page, "state().camera")
    x, y = _canvas_centre(page)

    page.mouse.move(x, y)
    page.mouse.wheel(0, -400)
    page.wait_for_timeout(600)

    after = map_call(page, "state().camera")
    assert after["zoom"] > before["zoom"], f"the wheel did not zoom in: {before} -> {after}"
    ctx.close()
