"""O87-O91: the page names its speaker, says when audio is loading, unavailable or served from a cache,
narrates every opened run, walks the memo in a fixed order, and reveals the caption with the voice."""

import json
import time

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


# --- A clip is not abandoned while the server is still making it, and a failure is not remembered forever.

def _silent_wav(seconds=2.0, rate=8000):
    import base64
    import io
    import wave

    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(b"\x00\x00" * int(rate * seconds))
    return base64.b64encode(buf.getvalue()).decode()


SILENT = _silent_wav()


def _speaks_within(page, seconds):
    deadline = time.time() + seconds
    while time.time() < deadline:
        if _state(page)["speaker"].get("status") == "speaking":
            return True
        page.wait_for_timeout(250)
    return False


def test_O109_a_slow_clip_is_played_not_abandoned(base, browser):
    """A cold line on this host takes over seven seconds. The page must wait for the clip the server is
    making instead of declaring the voice unavailable while it is still on its way."""
    def clip(r):
        time.sleep(8.5)
        r.fulfill(status=200, content_type="application/json", body=json.dumps({"audio_b64": SILENT, "starts": [0]}))

    def setup(page):
        serve_run(page, RUN, RUN_ID)
        page.route("**/api/tts_ts", clip)

    ctx, page = open_page(browser, base, f"/map?run={RUN_ID}", DESKTOP, setup=setup)
    map_ready(page)
    assert _speaks_within(page, 25), f"an 8.5s clip was never played: {_state(page)['speaker']}"
    ctx.close()


def test_O110_a_failed_clip_is_asked_for_again(base, browser):
    """A line that could not be voiced must be retried when the reader asks again, not remembered as a
    failure for the rest of the session."""
    asked = []
    served = set()

    def clip(r):
        text = json.loads(r.request.post_data or "{}").get("text", "")
        asked.append(text)
        if text in served:
            r.fulfill(status=200, content_type="application/json", body=json.dumps({"audio_b64": SILENT, "starts": [0]}))
            return
        served.add(text)
        r.fulfill(status=500, content_type="application/json", body="{}")

    def setup(page):
        serve_run(page, RUN, RUN_ID)
        page.route("**/api/tts_ts", clip)

    ctx, page = open_page(browser, base, f"/map?run={RUN_ID}", DESKTOP, setup=setup)
    map_ready(page)
    page.wait_for_function("() => window.__precedentMap.v1.state().speaker.status === 'unavailable'", timeout=15000)
    first = asked[0]
    assert asked.count(first) == 1, f"the first line was asked for {asked.count(first)} times before any retry"

    stop = page.get_by_role("button", name="Stop listening")
    if stop.count():
        stop.first.click()
        page.wait_for_timeout(600)
    page.get_by_role("button", name="Listen").click()

    assert _speaks_within(page, 20), f"the retried clip was never played: {_state(page)['speaker']}"
    assert asked.count(first) >= 2, f"the failed line was never asked for again: {asked[:4]}"
    ctx.close()


def test_O111_an_opened_run_warms_its_first_line(base, browser):
    """The line the reader waits for is the one that must already be in hand: opening a run starts making
    its first line before any voice control is pressed."""
    asked = []

    def clip(r):
        asked.append(json.loads(r.request.post_data or "{}").get("text", ""))
        r.fulfill(status=200, content_type="application/json", body=json.dumps({"audio_b64": SILENT, "starts": [0]}))

    def setup(page):
        serve_run(page, RUN, RUN_ID)
        page.route("**/api/tts_ts", clip)

    ctx, page = open_page(browser, base, f"/?run={RUN_ID}", DESKTOP, setup=setup)
    page.wait_for_timeout(3000)
    assert asked, "an opened run asked for no audio before the reader pressed Listen"
    opening = " ".join(str(RUN["answer"]).split())[:40]
    assert any(opening.lower() in " ".join(text.split()).lower() for text in asked), f"the first line was not warmed: {asked[:2]}"
    ctx.close()
