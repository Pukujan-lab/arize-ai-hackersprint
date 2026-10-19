"""O14, O15, O24, O27, O38, O47-O51: one pane at a time on a phone, both panes on a wide screen, camera
jumps under reduced motion, the map tracks the viewport, tour controls stay off the memo, and every page
holds up across widths, themes, tap targets and the keyboard."""

import pytest

from ui_server import (
    DESKTOP,
    MOBILE,
    V3_PAGES,
    WIDTHS,
    app_server,
    covered,
    horizontal_overflow,
    load_fixture,
    map_call,
    map_ready,
    needs_chromium,
    needs_v3,
    memo_text,
    open_page,
    serve_run,
    small_tap_targets,
    tiny_text,
    visible_words,
)

sync_api = pytest.importorskip("playwright.sync_api")
pytestmark = [needs_chromium, needs_v3]

RUN = load_fixture("run-spread.json")
RUN_ID = RUN["run_id"]
MEMO_WORDS = visible_words(RUN["answer"])
TOUR_BUTTONS = ("Previous stop", "Pause", "Next stop", "Stop tour")


@pytest.fixture(scope="module")
def base():
    with app_server() as url:
        yield url


@pytest.fixture(scope="module")
def browser():
    with sync_api.sync_playwright() as p:
        b = p.chromium.launch(
            args=[
                "--autoplay-policy=no-user-gesture-required",
                "--use-gl=swiftshader",
                "--enable-unsafe-swiftshader",
            ]
        )
        yield b
        b.close()


def _open(browser, base, path="/", width=DESKTOP, theme=None, motion=None):
    def setup(page):
        serve_run(page, RUN, RUN_ID)

    ctx, page = open_page(browser, base, f"{path}?run={RUN_ID}", width, setup=setup, color_scheme=theme, motion=motion)
    if path in ("/", "/map"):
        map_ready(page)
    return ctx, page


def _memo_visible(page):
    return memo_text(page, MEMO_WORDS).is_visible()


def _canvas_visible(page):
    canvas = page.locator("canvas")
    return canvas.count() >= 1 and canvas.first.is_visible()


def _tour_control(page, name):
    control = page.get_by_role("button", name=name)
    return control if control.count() and control.is_visible() else None


def _rect(locator):
    box = locator.bounding_box()
    assert box, "the element has no box"
    return box


def _overlap(a, b):
    return not (a["x"] + a["width"] <= b["x"] or b["x"] + b["width"] <= a["x"] or a["y"] + a["height"] <= b["y"] or b["y"] + b["height"] <= a["y"])


def test_O14_a_phone_shows_one_pane_and_can_switch(base, browser):
    ctx, page = _open(browser, base, "/", MOBILE)
    assert _memo_visible(page) != _canvas_visible(page), "a phone shows both panes or neither"
    showing_memo = _memo_visible(page)
    page.get_by_role("button", name="Show map" if showing_memo else "Show memo").click()
    page.wait_for_timeout(600)
    assert _memo_visible(page) != _canvas_visible(page), "the switch left both panes or neither"
    assert _memo_visible(page) != showing_memo, "the pane switch did not change the visible pane"
    ctx.close()


def test_O15_a_wide_screen_shows_both_panes_without_scrolling(base, browser):
    ctx, page = _open(browser, base, "/", DESKTOP)
    assert _memo_visible(page), "the memo is not visible on a wide screen"
    assert _canvas_visible(page), "the map is not visible on a wide screen"
    height = page.evaluate("window.innerHeight")
    for name, box in (("memo", _rect(memo_text(page, MEMO_WORDS))), ("map", _rect(page.locator("canvas").first))):
        assert box["y"] >= 0 and box["y"] + min(box["height"], 200) <= height, f"the {name} is below the fold on a wide screen"
    ctx.close()


def test_O24_reduced_motion_makes_the_camera_jump(base, browser):
    ctx, page = _open(browser, base, "/map", DESKTOP, motion="reduce")
    index = page.evaluate("() => window.__precedentMap.v1.order().slice(-1)[0]")
    page.evaluate("(i) => window.__precedentMap.v1.focus(i)", index)
    immediate = map_call(page, "state().camera")
    page.wait_for_timeout(250)
    settled = map_call(page, "state().camera")
    assert immediate == settled, "the camera animated while reduced motion was requested"
    ctx.close()


@pytest.mark.parametrize("width", WIDTHS)
def test_O27_the_map_tracks_the_viewport(base, browser, width):
    ctx, page = _open(browser, base, "/map", width)
    assert horizontal_overflow(page) <= 1, f"@{width} the page scrolls sideways"
    canvas = _rect(page.locator("canvas").first)
    assert canvas["width"] <= width + 1, f"@{width} the map is wider than the viewport"
    ctx.close()


@pytest.mark.parametrize("width", [MOBILE, 768, DESKTOP])
@pytest.mark.parametrize("pane", ["memo", "map"])
def test_O38_tour_controls_never_cover_the_memo(base, browser, width, pane):
    ctx, page = _open(browser, base, "/", width)
    if pane == "map" and width == MOBILE:
        page.get_by_role("button", name="Show map").click()
        page.wait_for_timeout(400)
    page.evaluate("() => window.__precedentMap.v1.tour(0)")
    page.wait_for_timeout(600)

    if width == MOBILE and pane == "memo":
        assert not any(_tour_control(page, n) for n in TOUR_BUTTONS), "tour controls are visible over the memo pane on a phone"
    else:
        memo = _rect(memo_text(page, MEMO_WORDS))
        for name in TOUR_BUTTONS:
            control = _tour_control(page, name)
            if control is not None:
                assert not _overlap(_rect(control), memo), f"{name} covers the memo @{width}"
    ctx.close()


@pytest.mark.parametrize("path", V3_PAGES)
@pytest.mark.parametrize("width", WIDTHS)
def test_O47_O49_no_overflow_and_no_small_targets(base, browser, path, width):
    ctx, page = _open(browser, base, path, width)
    assert horizontal_overflow(page) <= 1, f"{path} @{width}: the page scrolls sideways"
    small = small_tap_targets(page)
    assert not small, f"{path} @{width}: targets under 44px: {small[:4]}"
    tiny = tiny_text(page)
    assert not tiny, f"{path} @{width}: text under 12px: {tiny[:4]}"
    ctx.close()


@pytest.mark.parametrize("theme", ["light", "dark"])
@pytest.mark.parametrize("path", V3_PAGES)
@pytest.mark.parametrize("width", WIDTHS)
def test_O48_no_interactive_element_is_covered(base, browser, path, width, theme):
    ctx, page = _open(browser, base, path, width, theme=theme)
    if path in ("/", "/map"):
        play = _tour_control(page, "Play")
        if play is not None:
            play.click()
            page.wait_for_timeout(400)
    blocked = covered(page, "button, [role=button], a[href], input, select, summary")
    assert not blocked, f"{path} @{width} {theme}: covered controls {blocked[:3]}"
    ctx.close()


@pytest.mark.parametrize("path", V3_PAGES)
def test_O50_every_page_renders_in_both_themes(base, browser, path):
    backgrounds = {}
    for theme in ("light", "dark"):
        ctx, page = _open(browser, base, path, DESKTOP, theme=theme)
        text = page.inner_text("body")
        assert text.strip(), f"{path}: nothing renders in the {theme} theme"
        assert horizontal_overflow(page) <= 1, f"{path}: the {theme} theme scrolls sideways"
        backgrounds[theme] = page.evaluate("getComputedStyle(document.body).backgroundColor")
        ctx.close()
    assert backgrounds["light"] != backgrounds["dark"], f"{path}: the themes look the same"


def test_O51_the_page_works_from_the_keyboard_and_escape_closes_a_drawer(base, browser):
    ctx, page = _open(browser, base, "/", DESKTOP)
    reached = []
    # The memo's citation links sit between the navigation and the composer, so the field can be
    # several dozen tabs away; keep tabbing until it is reached.
    for _ in range(200):
        page.keyboard.press("Tab")
        reached.append(
            page.evaluate(
                "() => (document.activeElement && (document.activeElement.innerText || document.activeElement.getAttribute('aria-label') || '')).slice(0, 40)"
            )
        )
        if any("Ask a question" in r for r in reached):
            break
    joined = " | ".join(reached)
    for name in ("Home", "Map", "Observability", "Slides"):
        assert name in joined, f"the keyboard never reaches the {name} link"
    assert any("Ask a question" in r for r in reached), "the keyboard never reaches the question field"

    # O67 puts the source list behind the memo drawer; the panel itself is the dialog named Sources.
    page.get_by_role("button", name="Memo menu", exact=True).click()
    page.get_by_role("button", name="Sources").click()
    page.wait_for_timeout(300)
    assert page.evaluate(
        """() => {
          const panel = document.querySelector('[role=dialog][aria-label=Sources]');
          return !!panel && [...panel.querySelectorAll('a[href^=http]')].some(a => a.checkVisibility());
        }"""
    ), "the Sources panel did not open"
    page.keyboard.press("Escape")
    page.wait_for_timeout(400)
    assert page.evaluate("() => !document.querySelector('[role=dialog][aria-label=Sources]')"), "Escape did not close the Sources panel"
    ctx.close()
