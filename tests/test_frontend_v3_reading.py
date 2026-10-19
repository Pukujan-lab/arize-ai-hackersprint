"""O65-O67 and O71: the memo is formatted and its sources can be checked, the header carries one drawer
that closes itself, and Listen speaks the short answer before the tour walks the stops with a live
transcript."""

import pytest

from ui_server import (
    DESKTOP,
    app_server,
    load_fixture,
    map_ready,
    needs_chromium,
    needs_v3,
    open_page,
    serve_run,
)

sync_api = pytest.importorskip("playwright.sync_api")
pytestmark = [needs_chromium, needs_v3]

RUN = load_fixture("run-parity.json")
RUN_ID = RUN["run_id"]
CITES = RUN["citations"]
SHORT_ANSWER = "Short answer"
DRAWER_ACTIONS = ("Sources", "Follow-ups", "Run info", "Follow-up", "New question")


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


def _open(browser, base, width=DESKTOP):
    ctx, page = open_page(browser, base, f"/?run={RUN_ID}", width, setup=lambda p: serve_run(p, RUN, RUN_ID))
    page.get_by_text(SHORT_ANSWER, exact=False).first.wait_for(timeout=30000)
    return ctx, page


def _memo_text(page):
    return page.locator("main").inner_text()


def _visible_action(page, name):
    button = page.get_by_role("button", name=name, exact=True)
    return button.count() == 1 and button.is_visible()


def test_O65_the_memo_renders_as_formatted_text(base, browser):
    ctx, page = _open(browser, base)
    text = _memo_text(page)

    assert "**" not in text, "the memo shows Markdown bold markers as literal text"
    assert "###" not in text, "the memo shows a Markdown heading marker as literal text"

    heading = page.get_by_role("heading", name="Key authorities")
    assert heading.count() == 1, "the memo's section heading is not rendered as a heading"

    bullets = page.locator("main li")
    assert bullets.count() >= 5, "the memo's bullet list is not rendered as a list"

    assert page.locator("main strong").count() >= 1, "the memo's bold text is not rendered as bold"
    ctx.close()


def test_O66_citations_link_to_their_sources_and_the_source_list_is_complete(base, browser):
    ctx, page = _open(browser, base)

    links = page.locator("main a")
    assert links.count() >= len(CITES), "the memo does not link its citation references"

    hrefs = [links.nth(i).get_attribute("href") or "" for i in range(links.count())]
    assert any("justia.com" in href for href in hrefs), "a cited document with a URL is not linked"
    assert any("courtlistener.com" in href for href in hrefs), "a citation without a URL has no search link"

    page.get_by_role("button", name="Memo menu", exact=True).click()
    page.get_by_role("button", name="Sources", exact=True).click()

    panel = page.get_by_role("dialog", name="Sources")
    panel.wait_for(timeout=5000)
    assert panel.is_visible(), "the Sources control opened no source list"

    listed = panel.locator("a")
    assert listed.count() == len(CITES), f"the source list shows {listed.count()} of {len(CITES)} authorities"
    body = panel.inner_text()
    for citation in CITES:
        title = citation.get("title") or citation.get("citation") or ""
        assert title in body, f"the source list omits {title}"
        if citation.get("date"):
            assert str(citation["date"]) in body, f"the source list omits the date for {title}"
    ctx.close()


def test_O67_the_memo_header_carries_one_drawer_that_closes_itself(base, browser):
    ctx, page = _open(browser, base)

    assert _visible_action(page, "Listen"), "the memo header has no Listen control"
    assert _visible_action(page, "Memo menu"), "the memo header has no drawer control"
    for action in DRAWER_ACTIONS:
        assert not _visible_action(page, action), f"{action} is open in the header before the drawer is asked for"

    menu = page.get_by_role("button", name="Memo menu", exact=True)

    menu.click()
    assert _visible_action(page, "Sources"), "the drawer does not hold the source action"
    page.keyboard.press("Escape")
    assert not _visible_action(page, "Sources"), "Escape did not close the drawer"

    menu.click()
    assert _visible_action(page, "Sources")
    page.get_by_text(SHORT_ANSWER, exact=False).first.click()
    assert not _visible_action(page, "Sources"), "a click outside the drawer did not close it"

    menu.click()
    page.get_by_role("button", name="Run info", exact=True).click()
    assert not _visible_action(page, "Sources"), "choosing an action left the drawer open"
    assert page.get_by_text(RUN_ID, exact=False).count() >= 1, "the run information did not open"
    ctx.close()


def test_O71_listen_speaks_the_short_answer_then_walks_the_stops_with_a_transcript(base, browser):
    ctx, page = _open(browser, base)
    map_ready(page)

    page.get_by_role("button", name="Listen", exact=True).click()
    assert page.get_by_role("button", name="Stop listening", exact=True).is_visible(), "Listen did not start"

    page.wait_for_function("() => window.__precedentMap.v1.state().tour.active", timeout=45000)
    assert page.evaluate("() => window.__precedentMap.v1.state().tour.index") == 0, "the tour did not start at stop one"

    transcript = page.get_by_label("Tour transcript")
    transcript.wait_for(timeout=5000)
    assert transcript.is_visible(), "the tour has no transcript"
    first_line = transcript.inner_text().strip()
    assert first_line, "the transcript is empty"

    # A stop is spoken at the clip's own length; a full line can run about twenty seconds.
    page.wait_for_function(
        """(previous) => {
          const el = document.querySelector('[aria-label="Tour transcript"]');
          return !!el && el.innerText.trim().length > 0 && el.innerText.trim() !== previous;
        }""",
        arg=first_line,
        timeout=45000,
    )

    page.get_by_role("button", name="Stop tour", exact=True).click()
    page.wait_for_timeout(400)
    assert not page.evaluate("() => window.__precedentMap.v1.state().tour.active"), "Stop tour did not stop the walk"
    assert not page.evaluate("() => window.__precedentMap.v1.state().narrating"), "Stop tour did not stop the voice"
    # A machine with no audio keeps the transcript standing, because that is all the reader has; what
    # stopping must end is its advance, not the text already spoken.
    stopped_line = transcript.inner_text().strip() if transcript.count() else ""
    page.wait_for_timeout(1500)
    if transcript.count() and transcript.is_visible():
        assert transcript.inner_text().strip() == stopped_line, "Stop tour left the transcript advancing"
    ctx.close()
