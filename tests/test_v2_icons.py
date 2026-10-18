"""V2 icons/logo refresh (#94): rail uses inline SVG (no emoji), logo.svg at top, links route to canonical pages."""

import re
import pytest
from ui_server import app_server, needs_chromium, open_page

sync_api = pytest.importorskip("playwright.sync_api")
pytestmark = needs_chromium
WIDTHS = [390, 768, 1024, 1440]
EXPECTED = [("/", "Demo page"), ("/map", "Map page"), ("/observability", "Observability page"), ("/guide", "Guide page"), ("/slides", "Slides page")]
EMOJI = ["\u2696", "\U0001f5fa", "\U0001f4ca", "\U0001f4d6", "\U0001f5bc"]


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


def _rail(page):
    return page.locator("aside.v2-rail")


def test_rail_links_route_to_canonical_pages(base, browser):
    ctx, page = open_page(browser, base, "/", 1440)
    rail = _rail(page)
    assert rail.count() == 1
    nav = rail.locator("a.v2-rail-btn")
    assert nav.count() == len(EXPECTED), f"expected {len(EXPECTED)} nav links, got {nav.count()}"
    for i, (href, label) in enumerate(EXPECTED):
        a = nav.nth(i)
        got_href = a.get_attribute("href")
        got_label = a.get_attribute("aria-label")
        assert got_href == href, "rail link href mismatch"
        assert got_label == label, "rail link aria-label mismatch"
    all_hrefs = rail.locator("a").evaluate_all("els => els.map(e => e.getAttribute(\"href\"))")
    for bad in ("/dashboard", "/v1", "/v2", "/runs"):
        assert bad not in all_hrefs, f"legacy/dead href {bad} still in rail: {all_hrefs}"
    ctx.close()


def test_rail_logo_mark_links_home(base, browser):
    ctx, page = open_page(browser, base, "/", 1440)
    rail = _rail(page)
    first = rail.locator("a").first
    assert first.get_attribute("href") == "/"
    assert first.get_attribute("aria-label") == "Precedent home"
    html = first.inner_html().lower()
    assert "logo.svg" in html or "<svg" in html, f"logo mark missing in first rail link: {html[:200]}"
    box = first.bounding_box()
    assert box and box["width"] >= 20 and box["height"] >= 20
    ctx.close()


def test_rail_icons_are_svg_no_emoji(base, browser):
    ctx, page = open_page(browser, base, "/", 1440)
    rail = _rail(page)
    text = rail.inner_text()
    for e in EMOJI:
        assert e not in text, f"emoji {e!r} still in rail text: {text!r}"
    assert not re.search(r"[\U0001F000-\U0001FAFF\u2600-\u27BF]", text), f"pictograph in rail: {text!r}"
    nav = rail.locator("a.v2-rail-btn")
    for i in range(nav.count()):
        a = nav.nth(i)
        assert a.locator("svg").count() >= 1, f"rail link {i} has no inline svg icon"
        assert (a.get_attribute("aria-label") or "").strip(), f"rail link {i} missing aria-label"
    btn = rail.locator("#theme-toggle")
    assert btn.count() == 1 and btn.locator("svg").count() >= 1
    assert (btn.get_attribute("aria-label") or "").strip()
    ctx.close()


def test_rail_active_state(base, browser):
    ctx, page = open_page(browser, base, "/", 1440)
    active = _rail(page).locator("a.v2-rail-btn[aria-current=\"page\"]")
    assert active.count() == 1, f"expected exactly 1 aria-current rail link, got {active.count()}"
    assert active.first.get_attribute("href") == "/"
    ctx.close()


@pytest.mark.parametrize("w", WIDTHS)
def test_v2_icons_no_overflow_dark_and_light(base, browser, w):
    for theme in ("dark", "light"):
        ctx, page = open_page(browser, base, "/", w)
        if theme == "light":
            page.locator("#theme-toggle").click()
            page.wait_for_timeout(300)
            assert page.evaluate("document.documentElement.dataset.theme") == "light"
        sw = page.evaluate("Math.max(document.documentElement.scrollWidth, document.body.scrollWidth)")
        assert sw <= w + 1, f"/ @{w}px {theme} scrolls sideways ({sw}px)"
        assert _rail(page).locator("a.v2-rail-btn svg").count() == len(EXPECTED)
        ctx.close()
