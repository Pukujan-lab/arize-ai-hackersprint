"""O44-O46: the deck renders at /slides, advances and reverses from the keyboard, states its position, and
leads back to Home."""

import re

import pytest

from ui_server import DESKTOP, app_server, needs_chromium, needs_v3, open_page

sync_api = pytest.importorskip("playwright.sync_api")
pytestmark = [needs_chromium, needs_v3]

POSITION = re.compile(r"Slide\s+(\d+)\s+of\s+(\d+)", re.I)


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


def _open(browser, base):
    ctx, page = open_page(browser, base, "/slides", DESKTOP)
    return ctx, page


def _position(page):
    m = POSITION.search(page.inner_text("body"))
    assert m, "the deck does not state its position"
    return int(m.group(1)), int(m.group(2))


def test_O44_the_deck_advances_and_reverses_from_the_keyboard(base, browser):
    ctx, page = _open(browser, base)
    first, total = _position(page)
    assert total >= 3, f"the deck has only {total} slides"
    page.keyboard.press("ArrowRight")
    page.wait_for_timeout(400)
    assert _position(page)[0] == first + 1, "the right arrow did not advance the deck"
    page.keyboard.press("ArrowLeft")
    page.wait_for_timeout(400)
    assert _position(page)[0] == first, "the left arrow did not reverse the deck"
    ctx.close()


def test_O45_the_deck_states_its_position_and_total(base, browser):
    ctx, page = _open(browser, base)
    first, total = _position(page)
    assert first == 1
    for _ in range(total - 1):
        page.keyboard.press("ArrowRight")
        page.wait_for_timeout(200)
    assert _position(page) == (total, total), "the deck does not stop at its last slide"
    ctx.close()


def test_O46_the_deck_leads_back_to_home(base, browser):
    ctx, page = _open(browser, base)
    links = page.eval_on_selector_all("a[href]", "els => els.map(e => e.getAttribute('href'))")
    assert "/" in links, f"the deck has no call to action pointing at Home: {links}"
    ctx.close()
