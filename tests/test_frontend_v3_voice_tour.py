"""O87-O91: the page names its speaker, says when audio is loading, unavailable or served from a cache,
narrates every opened run, walks the memo in a fixed order, and reveals the caption with the voice."""

import json

import pytest

from ui_server import DESKTOP, app_server, load_fixture, map_call, map_ready, needs_chromium, needs_v3, open_page, open_run, serve_run

sync_api = pytest.importorskip("playwright.sync_api")
pytestmark = [needs_chromium, needs_v3]

RUN = load_fixture("run-fidelity.json")
RUN_ID = RUN["run_id"]
SHORT = "Likely no"


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


EMPTY_CLIP = {"audio_b64": "", "starts": []}


def _ask_page(browser, base, status=200, hold=False):
    pending = []

    def clip(r):
        if hold:
            pending.append(r)
            return
        r.fulfill(status=status, content_type="application/json", body=json.dumps(EMPTY_CLIP))

    def setup(page):
        serve_run(page, RUN, RUN_ID)
        page.route("**/api/ask", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps({"run_id": RUN_ID})))
        page.route("**/api/tts_ts", clip)

    ctx, page = open_page(browser, base, "/map", DESKTOP, setup=setup)
    page._held_clips = pending
    map_ready(page)
    page.get_by_role("textbox", name="Ask a question").fill(RUN["question"])
    page.get_by_role("button", name="Ask", exact=True).click()
    page.get_by_text(SHORT, exact=False).first.wait_for(timeout=30000)
    return ctx, page


def _state(page):
    return map_call(page, "state()")


def test_O87_the_map_names_the_speaker_and_shows_the_line(base, browser):
    ctx, page = _ask_page(browser, base)
    page.wait_for_function("() => window.__precedentMap.v1.state().speaker.active === true", timeout=15000)

    speaker = _state(page)["speaker"]
    assert speaker.get("name"), f"the speaker has no name: {speaker}"
    assert SHORT.lower() in (speaker.get("line") or "").lower(), f"the speaker is not saying the summary: {speaker}"

    region = page.get_by_role("region", name="Speaker")
    assert region.count() == 1, "the map has no region named Speaker"
    assert region.inner_text().strip(), "the Speaker region is empty"

    page.get_by_role("button", name="Stop listening").click()
    page.wait_for_timeout(400)
    assert _state(page)["speaker"]["active"] is False, "the speaker indicator keeps running after the voice stops"
    ctx.close()


def test_O88_a_slow_clip_says_audio_loading(base, browser):
    ctx, page = _ask_page(browser, base, hold=True)
    page.wait_for_function("() => window.__precedentMap.v1.state().speaker.status === 'loading'", timeout=8000)
    map_text = page.get_by_role("region", name="Citation map").inner_text().lower()
    assert "audio loading" in map_text, f"the map does not say the clip is loading: {map_text[:300]!r}"
    for held in page._held_clips:
        held.fulfill(status=200, content_type="application/json", body=json.dumps(EMPTY_CLIP))
    ctx.close()


def test_O88_a_failed_clip_says_audio_is_unavailable_and_continues(base, browser):
    ctx, page = _ask_page(browser, base, status=500)
    page.wait_for_function("() => ['unavailable', 'failed'].includes(window.__precedentMap.v1.state().speaker.status)", timeout=8000)
    map_text = page.get_by_role("region", name="Citation map").inner_text().lower()
    assert "audio unavailable" in map_text, f"the map does not say the voice is unavailable: {map_text[:300]!r}"
    assert page.get_by_role("log", name="Tour transcript").count() == 1, "the transcript disappeared with the voice"
    ctx.close()


def test_O88_a_cached_answer_is_marked_on_the_map(base, browser):
    run = dict(RUN, provider="cache")
    ctx, page = open_run(browser, base, run, path="/map", run_id="run-cached")
    map_ready(page)
    page.wait_for_timeout(700)
    source = page.get_by_role("status", name="Answer source")
    assert source.count() == 1, "the map has no Answer source marker"
    assert "cache" in source.inner_text().lower(), f"the map does not say the answer was cached: {source.inner_text()!r}"
    ctx.close()


def test_O89_opening_a_saved_run_speaks_and_tours(base, browser):
    ctx, page = open_run(browser, base, RUN, path="/map", run_id=RUN_ID)
    map_ready(page)
    page.wait_for_function("() => window.__precedentMap.v1.state().speaker.active === true", timeout=10000)
    page.wait_for_function("() => window.__precedentMap.v1.state().tour.active === true", timeout=15000)
    ctx.close()


def test_O90_the_walk_follows_the_shape_of_the_memo(base, browser):
    ctx, page = open_run(browser, base, RUN, path="/map", run_id=RUN_ID)
    map_ready(page)
    plan = map_call(page, "tourPlan()")
    sections = [step["section"].lower() for step in plan]
    expected = ["short answer", "sources", "opinion", "memo", "authorities"]
    assert sections[: len(expected)] == expected, f"the walk is {sections}, not {expected}"
    assert SHORT.lower() in plan[0]["text"].lower(), f"the walk does not start with the short answer: {plan[0]!r}"

    page.wait_for_function("() => !!window.__precedentMap.v1.caption().section", timeout=15000)
    assert map_call(page, "caption()")["section"].lower() == "short answer", "the transcript does not name its section"
    ctx.close()


def test_O91_the_caption_follows_the_voice(base, browser):
    ctx, page = _ask_page(browser, base)
    page.wait_for_function("() => window.__precedentMap.v1.state().tour.active === true", timeout=15000)
    page.wait_for_function("() => window.__precedentMap.v1.caption().total > 0", timeout=10000)

    first = map_call(page, "caption()")
    page.wait_for_timeout(700)
    second = map_call(page, "caption()")

    assert first["shown"] > 0, f"the caption never starts: {first}"
    assert second["shown"] > first["shown"] or second["index"] > first["index"], f"the caption does not advance: {first} -> {second}"
    assert second["index"] == _state(page)["tour"]["index"], "the caption is not on the stop the tour is on"
    assert _state(page)["tour"].get("activeIndex") == second["index"], "the current stop's pin is not marked"
    ctx.close()
