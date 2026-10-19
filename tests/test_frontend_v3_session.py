"""O39: saved runs are scoped to the device that asked. The server reads X-Session-Id on every /api call and
returns only the runs that session created, so the built app must send a stable per-device id with each one."""

import re

import pytest

from ui_server import app_server, needs_chromium, needs_v3, open_page

sync_api = pytest.importorskip("playwright.sync_api")
pytestmark = [needs_chromium, needs_v3]

SID = re.compile(r"^[A-Za-z0-9-]{8,64}$")
PATH = "/observability"


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


def _open(browser, base):
    """Open the page and collect the X-Session-Id of every /api call it makes, from the first load on."""
    seen = []

    def watch(page):
        page.on(
            "request",
            lambda req: seen.append(req.headers.get("x-session-id", "")) if "/api/" in req.url else None,
        )

    ctx, page = open_page(browser, base, PATH, 1440, setup=watch)
    return ctx, page, seen


def test_O39_every_api_call_carries_a_valid_device_session(base, browser):
    ctx, page, seen = _open(browser, base)
    page.reload(wait_until="load")
    page.wait_for_timeout(1200)
    assert seen, "the page made no /api call, so this test cannot see the session header"
    for value in seen:
        assert SID.match(value or ""), f"an /api call went out without a usable X-Session-Id: {value!r}"
    ctx.close()


def test_O39_the_device_session_survives_a_reload(base, browser):
    ctx, page, seen = _open(browser, base)
    page.reload(wait_until="load")
    page.wait_for_timeout(1200)
    assert seen, "the page made no /api call, so this test cannot see the session header"
    assert len(set(seen)) == 1, f"the session id changed across a reload: {sorted(set(seen))}"
    assert SID.match(seen[0]), f"the reloaded page sent an unusable X-Session-Id: {seen[0]!r}"
    ctx.close()


def test_O39_a_second_device_gets_its_own_session(base, browser):
    first_ctx, first, first_seen = _open(browser, base)
    second_ctx, second, second_seen = _open(browser, base)
    first.wait_for_timeout(1200)
    second.wait_for_timeout(1200)
    assert first_seen and second_seen, "a page made no /api call, so this test cannot see the session header"
    shared = set(first_seen) & set(second_seen)
    assert not shared, f"two separate devices share the session id {sorted(shared)}; saved runs would leak between them"
    first_ctx.close()
    second_ctx.close()
