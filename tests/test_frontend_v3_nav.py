"""O6: one navigation on every page, linking exactly the four surviving addresses and nothing retired."""

import pytest

from ui_server import DESKTOP, MOBILE, V3_PAGES, app_server, needs_chromium, needs_v3, open_page

sync_api = pytest.importorskip("playwright.sync_api")
pytestmark = [needs_chromium, needs_v3]

SURVIVORS = {"/", "/map", "/observability", "/slides"}
RETIRED_HREF = ("/v1", "/v2", "/dashboard", "/guide", "/static/", ".html")


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


@pytest.mark.parametrize("width", [MOBILE, DESKTOP])
@pytest.mark.parametrize("path", V3_PAGES)
def test_O6_one_navigation_with_the_four_surviving_links(base, browser, path, width):
    ctx, page = open_page(browser, base, path, width)
    landmarks = page.locator("nav, [role=navigation]").count()
    assert landmarks == 1, f"{path} @{width}: {landmarks} navigation landmarks, expected 1"
    hrefs = page.eval_on_selector_all("nav a[href], [role=navigation] a[href]", "els => els.map(e => e.getAttribute('href'))")
    assert set(hrefs) == SURVIVORS, f"{path} @{width}: navigation links {sorted(set(hrefs))}"
    ctx.close()


@pytest.mark.parametrize("path", V3_PAGES)
def test_O6_no_link_to_a_retired_address(base, browser, path):
    ctx, page = open_page(browser, base, path, DESKTOP)
    bad = page.evaluate(
        "(bad) => [...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href')).filter(h => h && bad.some(b => h.includes(b)))",
        list(RETIRED_HREF),
    )
    assert not bad, f"{path}: links to retired addresses {bad}"
    ctx.close()
