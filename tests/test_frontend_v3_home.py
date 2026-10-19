"""O7-O13 and O16: the Home page asks, renders the memo, offers a follow-up and a fresh run, opens a saved
run by address, has exactly one Listen control, and keeps sources, follow-ups and run info reachable."""

import json

import pytest

from ui_server import (
    DESKTOP,
    MOBILE,
    app_server,
    load_fixture,
    needs_chromium,
    needs_v3,
    open_page,
    open_run,
    serve_run,
)

sync_api = pytest.importorskip("playwright.sync_api")
pytestmark = [needs_chromium, needs_v3]

RUN = load_fixture("run-parity.json")
MEMO_WORDS = (RUN["answer"] or "").split()[:6]


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


def _page(browser, base, path="/", width=DESKTOP, ask_status=200):
    def setup(page):
        serve_run(page, RUN, "v3-home")
        page.route(
            "**/api/ask",
            lambda r: r.fulfill(status=ask_status, content_type="application/json", body=json.dumps({"run_id": "v3-home"})),
        )

    return open_page(browser, base, path, width, setup=setup)


def _ask(page):
    page.get_by_role("textbox", name="Ask a question").fill(RUN["question"])
    page.get_by_role("button", name="Ask", exact=True).click()


def _memo(page):
    page.get_by_text(" ".join(MEMO_WORDS), exact=False).wait_for(timeout=30000)


def _menu(page):
    """Open the memo drawer: O67 keeps the run's actions behind one control."""
    page.get_by_role("button", name="Memo menu", exact=True).click()
    page.wait_for_timeout(200)


def test_O7_asking_shows_a_memo_without_reloading(base, browser):
    ctx, page = _page(browser, base)
    _ask(page)
    _memo(page)
    ctx.close()


def test_O8_follow_up_and_new_question_are_offered_after_a_memo(base, browser):
    ctx, page = _page(browser, base)
    _ask(page)
    _memo(page)
    _menu(page)
    assert page.get_by_role("button", name="Follow-up", exact=True).count() == 1
    assert page.get_by_role("button", name="New question", exact=True).count() == 1
    ctx.close()


def test_O9_a_saved_run_opens_by_address(base, browser):
    ctx, page = open_run(browser, base, RUN, run_id=RUN["run_id"])
    _memo(page)
    ctx.close()


@pytest.mark.parametrize("width", [MOBILE, DESKTOP])
def test_O10_there_is_exactly_one_listen_control(base, browser, width):
    ctx, page = _page(browser, base, width=width)
    _ask(page)
    _memo(page)
    listen = page.get_by_role("button", name="Listen")
    assert listen.count() == 1, f"@{width}: {listen.count()} Listen controls"
    others = page.evaluate(
        """() => [...document.querySelectorAll('button,[role=button]')]
             .filter(b => /speaker|voice|mute|narrat/i.test((b.getAttribute('aria-label')||'') + ' ' + b.innerText))
             .map(b => (b.getAttribute('aria-label')||b.innerText).slice(0, 40))"""
    )
    assert not others, f"@{width}: extra audio controls {others}"
    ctx.close()


def test_O12_sources_link_to_the_original_documents(base, browser):
    ctx, page = _page(browser, base)
    _ask(page)
    _memo(page)
    _menu(page)
    page.get_by_role("button", name="Sources").click()
    links = page.evaluate("() => [...document.querySelectorAll('a[href^=http]')].map(a => a.getAttribute('href'))")
    assert links, "the Sources panel has no link to an original document"
    ctx.close()


def test_O13_follow_ups_and_run_info_are_reachable(base, browser):
    ctx, page = _page(browser, base)
    _ask(page)
    _memo(page)
    for name in ("Follow-ups", "Run info"):
        _menu(page)
        control = page.get_by_role("button", name=name)
        assert control.count() == 1, f"{name} is not reachable from Home"
        control.click()
        page.wait_for_timeout(300)
    ctx.close()


def test_O16_a_failed_run_says_so_and_leaves_no_blank_pane(base, browser):
    ctx, page = _page(browser, base, ask_status=500)
    _ask(page)
    page.wait_for_timeout(1500)
    text = page.inner_text("body")
    assert text.strip(), "the page went blank after a failed run"
    assert any(w in text.lower() for w in ("wrong", "error", "try again", "couldn't", "could not")), f"a failed run left no readable message: {text[:200]!r}"
    ctx.close()


def test_O7_asking_waits_for_a_run_the_server_is_still_working_on(base, browser):
    """The server returns the run id at once and writes result.json when the agents finish, so the page
    has to keep asking until the result exists. A single read would fail every real question."""
    body = json.dumps({"result": load_fixture("run-parity.json")})
    seen = []

    def setup(page):
        page.route(
            "**/api/ask",
            lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps({"run_id": "v3-slow"})),
        )

        def run_route(route):
            seen.append(1)
            if len(seen) < 3:
                route.fulfill(status=200, content_type="application/json", body=json.dumps({"events": [], "result": None, "partial": "planning"}))
            else:
                route.fulfill(status=200, content_type="application/json", body=body)

        page.route("**/api/run/v3-slow", run_route)

    ctx, page = open_page(browser, base, "/", DESKTOP, setup=setup)
    _ask(page)
    _memo(page)
    assert len(seen) >= 3, "the page stopped asking before the run was ready"
    assert "didn't come back" not in page.inner_text("body").lower()
    ctx.close()


def test_O16_a_rate_limited_question_says_to_wait_instead_of_failing(base, browser):
    message = "You're asking a bit fast - max 6 questions per minute. Give it a few seconds and try again."

    def setup(page):
        page.route(
            "**/api/ask",
            lambda r: r.fulfill(status=429, content_type="application/json", body=json.dumps({"error": message, "rate_limited": True})),
        )

    ctx, page = open_page(browser, base, "/", DESKTOP, setup=setup)
    _ask(page)
    page.wait_for_timeout(1500)
    text = page.inner_text("body")
    assert "asking a bit fast" in text.lower(), f"the rate-limit reason was replaced by generic copy: {text[:200]!r}"
    ctx.close()
