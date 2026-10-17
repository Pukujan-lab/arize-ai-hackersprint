"""V2 home (#89): minimal, map-centric, dark-default. Visible by default only answer, the existing 3D map, and a sticky bottom chat input; everything else collapsed; no overflow at 4 widths in both themes."""

import pytest
from ui_server import app_server, needs_chromium, open_page

sync_api = pytest.importorskip("playwright.sync_api")
pytestmark = needs_chromium
WIDTHS = [390, 768, 1024, 1440]


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


@pytest.mark.parametrize("w", WIDTHS)
def test_v2_no_overflow_dark_and_light(base, browser, w):
    for theme in ("dark", "light"):
        ctx, page = open_page(browser, base, "/v2", w)
        if theme == "light":
            page.locator("#theme-toggle").click()
            page.wait_for_timeout(300)
        sw = page.evaluate("Math.max(document.documentElement.scrollWidth, document.body.scrollWidth)")
        assert sw <= w + 1, f"/v2 @{w}px {theme} scrolls sideways ({sw}px)"
        ctx.close()


def test_v2_minimal_defaults_and_dark_default(base, browser):
    ctx, page = open_page(browser, base, "/v2", 1440)
    assert page.locator("#docs3d").count() == 1, "existing 3D map mount #docs3d required"
    assert page.locator("#answer").count() == 1
    assert page.locator("#q").count() == 1
    theme = page.evaluate("document.documentElement.dataset.theme || document.body.dataset.theme || document.documentElement.className")
    assert "dark" in str(theme).lower(), f"dark must be default, got {theme}"
    assert page.locator("#theme-toggle").count() == 1
    # sources/follow-ups collapsed by default: their panels must not be visible
    for sel in ("#sources-panel", "#followups-panel"):
        if page.locator(sel).count():
            assert not page.locator(sel).is_visible(), f"{sel} must be collapsed by default"
    assert page.locator("nav").count() == 0 or not page.locator("nav").first.is_visible(), "no top navbar"
    ctx.close()


def test_v2_theme_toggle_persists(base, browser):
    ctx, page = open_page(browser, base, "/v2", 1440)
    page.locator("#theme-toggle").click()
    page.wait_for_timeout(300)
    t = page.evaluate("document.documentElement.dataset.theme || document.body.dataset.theme || document.documentElement.className")
    assert "light" in str(t).lower(), t
    page.reload()
    page.wait_for_timeout(800)
    t2 = page.evaluate("document.documentElement.dataset.theme || document.body.dataset.theme || document.documentElement.className")
    assert "light" in str(t2).lower(), f"choice must persist, got {t2}"
    ctx.close()


def test_v2_input_sticky_bottom(base, browser):
    ctx, page = open_page(browser, base, "/v2", 390)
    box = page.locator("#q").bounding_box()
    assert box and box["y"] + box["height"] <= 910, "chat input must be sticky at bottom on phone"
    ctx.close()
