"""One collapsible sidebar holds navigation on every page (#50). The top bar keeps only the logo, the ask box with
Ask and the sidebar toggle. The sidebar is a closed drawer on phones, remembers its state on desktop, marks the
current page, closes on Esc, and holds the Examples."""

import pytest

from ui_server import (
    DESKTOP,
    MOBILE,
    PAGES,
    app_server,
    is_visible,
    needs_chromium,
    open_page,
)

sync_api = pytest.importorskip("playwright.sync_api")
pytestmark = needs_chromium


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


@pytest.mark.parametrize("path", PAGES)
def test_top_bar_has_only_logo_ask_and_toggle(base, browser, path):
    ctx, page = open_page(browser, base, path, DESKTOP)
    assert page.locator("#topbar #sidebar-toggle").count() == 1
    assert page.get_attribute("#sidebar-toggle", "aria-controls") == "sidebar"
    if path == "/":
        # the home page keeps its own ask box in the page body (it becomes a chat composer in #49)
        assert (
            page.locator("#ask-form #q").count() == 1
            and page.locator("#ask-form #go").count() == 1
        )
    else:
        assert page.locator("#topbar #ask-form #q").count() == 1
        assert page.locator("#topbar #ask-form #go").count() == 1
    links = page.eval_on_selector_all(
        "#topbar a[href]", "els => els.map(e => e.getAttribute('href'))"
    )
    assert all(h == "/" for h in links), links
    ctx.close()


@pytest.mark.parametrize("path", PAGES)
def test_sidebar_links_and_current_page(base, browser, path):
    ctx, page = open_page(browser, base, path, DESKTOP)
    hrefs = page.eval_on_selector_all(
        "#sidebar a[href]", "els => els.map(e => e.getAttribute('href'))"
    )
    for p in PAGES:
        assert p in hrefs, p
    cur = page.eval_on_selector_all(
        "#sidebar a[aria-current=page]", "els => els.map(e => e.getAttribute('href'))"
    )
    assert cur == [path]
    ctx.close()


@pytest.mark.parametrize("path", PAGES)
def test_drawer_on_phones_with_escape(base, browser, path):
    ctx, page = open_page(browser, base, path, MOBILE)
    toggle = page.locator("#sidebar-toggle")
    assert toggle.get_attribute("aria-expanded") == "false"
    assert not is_visible(page, "#sidebar a[href='/map']")
    toggle.click()
    page.wait_for_timeout(400)
    assert toggle.get_attribute("aria-expanded") == "true"
    assert is_visible(page, "#sidebar a[href='/map']")
    page.keyboard.press("Escape")
    page.wait_for_timeout(400)
    assert toggle.get_attribute("aria-expanded") == "false"
    assert not is_visible(page, "#sidebar a[href='/map']")
    ctx.close()


def test_desktop_state_is_remembered(base, browser):
    ctx, page = open_page(browser, base, "/guide", DESKTOP)
    toggle = page.locator("#sidebar-toggle")
    before = toggle.get_attribute("aria-expanded")
    toggle.click()
    page.wait_for_timeout(300)
    after = toggle.get_attribute("aria-expanded")
    assert after != before
    page.goto(base + "/dashboard")
    page.wait_for_timeout(800)
    assert page.get_attribute("#sidebar-toggle", "aria-expanded") == after
    ctx.close()


def test_examples_live_in_the_sidebar(base, browser):
    ctx, page = open_page(browser, base, "/", DESKTOP)
    ex = page.locator("#sidebar #sidebar-examples")
    assert ex.count() == 1
    if ex.evaluate("e => e.tagName") == "DETAILS" and not ex.evaluate("e => e.open"):
        ex.locator("summary").click()
    page.locator("#sidebar-examples button, #sidebar-examples a").first.click()
    page.wait_for_timeout(300)
    assert page.input_value("#q").strip()
    ctx.close()
