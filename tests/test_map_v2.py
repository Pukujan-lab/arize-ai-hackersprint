"""Retire the legacy /map (#102): GET /map serves the v2 experience with the map pane selected, and none
of the legacy legend, state pills or RUN dropdown reach the DOM."""

import pytest
from ui_server import app_server, needs_chromium, open_page

sync_api = pytest.importorskip("playwright.sync_api")
pytestmark = needs_chromium

V2_TITLE = "Precedent v2 · Ask, read the memo, tour the map"
LEGACY_TITLE = "Precedent · Citation map of grounded legal authorities"
LEGACY_DOM = "#side, #runs, #sumbox, #sumplay, [data-v='us'], [data-v='co'], .tb-txt"


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


@pytest.mark.parametrize("w", [390, 1440])
def test_map_serves_the_v2_experience(base, browser, w):
    ctx, page = open_page(browser, base, "/map", w)
    assert page.title() == V2_TITLE, f"/map must serve v2, got title {page.title()!r}"
    assert page.locator(".v2-rail").count() == 1, f"/map must carry the v2 rail @{w}"
    assert page.locator(".v2-mapwrap").count() == 1, f"/map must carry the v2 map pane @{w}"
    assert page.locator("#q").count() == 1, f"/map must carry the v2 composer @{w}"
    ctx.close()


@pytest.mark.parametrize("w", [390, 1440])
def test_legacy_map_dom_is_gone(base, browser, w):
    ctx, page = open_page(browser, base, "/map", w)
    assert page.title() != LEGACY_TITLE, "/map still serves the legacy page"
    count = page.locator(LEGACY_DOM).count()
    assert count == 0, f"legacy map UI still in the DOM @{w}: {count} nodes"
    text = page.inner_text("body")
    assert "Colorado counties" not in text, "legacy state pills still render"
    ctx.close()


@pytest.mark.parametrize("w", [390, 1440])
def test_map_opens_with_the_map_pane_selected(base, browser, w):
    ctx, page = open_page(browser, base, "/map", w)
    if w < 900:
        pane = page.locator(".v2-main").get_attribute("data-mobile-pane")
        assert pane == "map", f"/map must open on the map pane on a phone, got {pane!r}"
    else:
        selected = page.locator('.v2-pane-tab[aria-selected="true"]').get_attribute("data-pane")
        assert selected == "map", f"/map must select the Map tab, got {selected!r}"
    ctx.close()


@pytest.mark.parametrize("theme", ["dark", "light"])
@pytest.mark.parametrize("w", [390, 1440])
def test_map_has_no_overflow(base, browser, w, theme):
    ctx, page = open_page(browser, base, "/map", w)
    if theme == "light":
        page.locator("#theme-toggle").click()
        page.wait_for_timeout(300)
    sw = page.evaluate("Math.max(document.documentElement.scrollWidth, document.body.scrollWidth)")
    assert sw <= w + 1, f"/map @{w}px {theme} scrolls sideways ({sw}px)"
    ctx.close()


def test_run_deep_link_still_resolves(base, browser):
    ctx, page = open_page(browser, base, "/map?run=abc123", 1440)
    assert page.title() == V2_TITLE, "/map?run= must still serve the v2 page"
    ctx.close()
