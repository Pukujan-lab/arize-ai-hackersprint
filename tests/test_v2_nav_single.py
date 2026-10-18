"""V2 one navigation (#101): the icon rail is the only menu on the v2 pages, its destinations are the
canonical routes in one order, and no legacy text drawer or second navigation survives."""

import pytest
from ui_server import app_server, needs_chromium, open_page

sync_api = pytest.importorskip("playwright.sync_api")
pytestmark = needs_chromium

CANON = ["/", "/map", "/observability", "/guide", "/slides"]
LEGACY = "#sideToggle, .tb-txt, .tb-drawer, #side, nav.navbar"


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


def _hrefs(page, selector):
    return page.locator(selector).evaluate_all(
        "els => els.map(e => { try { return new URL(e.getAttribute('href'), location.href).pathname } catch (_) { return e.getAttribute('href') } })"
    )


@pytest.mark.parametrize("w", [390, 1440])
def test_exactly_one_navigation_and_no_legacy_drawer(base, browser, w):
    ctx, page = open_page(browser, base, "/", w)
    assert page.locator(".v2-rail").count() == 1, f"the icon rail must be the one nav @{w}"
    assert page.locator(LEGACY).count() == 0, f"legacy menu drawer must be gone @{w}: {page.locator(LEGACY).count()} nodes"
    navs = page.locator("nav, [role=navigation]").count()
    assert navs <= 1, f"only one navigation landmark allowed @{w}, found {navs}"
    ctx.close()


@pytest.mark.parametrize("w", [390, 1440])
def test_rail_destinations_are_the_canonical_routes_in_order(base, browser, w):
    ctx, page = open_page(browser, base, "/", w)
    hrefs = _hrefs(page, ".v2-rail a.v2-rail-btn[href]")
    assert hrefs == CANON, f"rail destinations must be {CANON} in that order @{w}, got {hrefs}"
    ctx.close()


def test_active_entry_is_the_current_page(base, browser):
    ctx, page = open_page(browser, base, "/", 1440)
    current = page.locator('.v2-rail a.v2-rail-btn[aria-current="page"]').evaluate_all(
        "els => els.map(e => new URL(e.getAttribute('href'), location.href).pathname)"
    )
    assert current == ["/"], f"only the Demo entry is current on /, got {current}"
    ctx.close()


def test_no_dashboard_link_anywhere(base, browser):
    ctx, page = open_page(browser, base, "/", 1440)
    assert page.locator('a[href="/dashboard"], a[href^="/dashboard?"]').count() == 0, "canonical dashboard is /observability; no /dashboard link"
    ctx.close()


def test_mobile_menu_matches_the_rail_when_a_toggle_exists(base, browser):
    ctx, page = open_page(browser, base, "/", 390)
    rail = _hrefs(page, ".v2-rail a.v2-rail-btn[href]")
    toggles = page.locator("#nav-toggle, .v2-nav-toggle, [data-nav-toggle]")
    if toggles.count():
        toggles.first.click()
        page.wait_for_timeout(300)
        drawer = _hrefs(page, ".v2-drawer a[href], [data-nav-drawer] a[href]")
        assert drawer == rail, f"the mobile drawer must repeat the rail items in the same order, rail={rail} drawer={drawer}"
    else:
        assert rail == CANON, f"with no collapse the rail must still offer every destination @390, got {rail}"
    ctx.close()
