"""O11 and O29-O38: one Listen control drives memo and tour narration; the tour follows the memo's citation
order, says the same thing as the golden capture, narrates in step with its audio, survives a failed clip,
prefetches the next stop, exposes previous/play/next and a position, resumes after a skip, follows the memo,
and stops when the reader drags or scrolls the map."""

import base64
import io
import json
import re
import time
import wave

import pytest

from ui_server import (
    DESKTOP,
    app_server,
    load_fixture,
    map_call,
    map_ready,
    needs_chromium,
    needs_v3,
    open_page,
    open_run,
    serve_run,
    visible_words,
)

sync_api = pytest.importorskip("playwright.sync_api")
pytestmark = [needs_chromium, needs_v3]

RUN = load_fixture("run-spread.json")
GOLDEN = load_fixture("tour_parity_spread.json")
RUN_ID = RUN["run_id"]
STOPS = GOLDEN["stops"]
N = len(GOLDEN["order"])


def _silent_wav(seconds=2.0, rate=8000):
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(b"\x00\x00" * int(rate * seconds))
    return base64.b64encode(buf.getvalue()).decode()


SILENT = _silent_wav()


@pytest.fixture(scope="module")
def base():
    with app_server() as url:
        yield url


@pytest.fixture(scope="module")
def browser():
    with sync_api.sync_playwright() as p:
        b = p.chromium.launch(
            args=[
                "--autoplay-policy=no-user-gesture-required",
                "--use-gl=swiftshader",
                "--enable-unsafe-swiftshader",
            ]
        )
        yield b
        b.close()


def _tts(page, log=None, status=200, seconds=2.0):
    body = json.dumps({"audio_b64": SILENT if seconds == 2.0 else _silent_wav(seconds), "starts": [0]})

    def handle(route):
        data = json.loads(route.request.post_data or "{}")
        if log is not None:
            log.append({"text": data.get("text", ""), "t": time.time()})
        if status != 200:
            return route.fulfill(status=status, content_type="application/json", body="{}")
        route.fulfill(status=200, content_type="application/json", body=body)

    page.route("**/api/tts*", handle)


def _open(browser, base, log=None, tts_status=200, seconds=2.0):
    def install(page):
        serve_run(page, RUN, RUN_ID)
        _tts(page, log=log, status=tts_status, seconds=seconds)

    ctx, page = open_page(browser, base, f"/?run={RUN_ID}", DESKTOP, setup=install)
    map_ready(page)
    return ctx, page


def _tour(page):
    return page.evaluate("() => window.__precedentMap.v1.state().tour")


def _fragment(i):
    return " ".join(STOPS[i]["text"].split())[:40]


def test_O29_the_tour_visits_stops_in_memo_order(base, browser):
    ctx, page = _open(browser, base)
    assert map_call(page, "order()") == GOLDEN["order"], "the stop order does not follow the memo"
    ctx.close()


def test_O30_each_stop_says_what_the_golden_capture_says(base, browser):
    ctx, page = _open(browser, base)
    for stop in STOPS:
        text = map_call(page, f"explainText({stop['index']})")
        assert text["title"] == stop["title"], f"stop {stop['index']} title {text['title']!r}"
        assert (text.get("court") or None) == stop["court"], f"stop {stop['index']} court {text.get('court')!r}"
        assert str(text.get("year") or "") == str(stop["date"] or ""), f"stop {stop['index']} year {text.get('year')!r}, golden {stop['date']!r}"
        spoken = " ".join(str(v) for v in text.values() if v)
        for part in (text.get("holding"), text.get("citedBy"), text.get("memoLine")):
            if part:
                assert " ".join(str(part).split()) in " ".join(stop["text"].split()), f"stop {stop['index']} says {part!r}, which is not in the golden text"
        assert spoken.strip(), f"stop {stop['index']} has no spoken text"
    ctx.close()


def test_O31_narration_tracks_the_audio_timings(base, browser):
    ctx, page = _open(browser, base, seconds=3.0)
    page.get_by_role("button", name="Play").click()
    page.wait_for_timeout(1000)
    assert _tour(page)["index"] == 0, "the caption left stop 1 before its clip ended"
    page.wait_for_function(
        "() => { const t = window.__precedentMap.v1.state().tour; return t.active && t.index === 1; }",
        timeout=15000,
    )
    page.get_by_text(_fragment(1), exact=False).wait_for(timeout=5000)
    ctx.close()


def test_O32_a_failed_clip_leaves_the_tour_running_silently(base, browser):
    ctx, page = _open(browser, base, tts_status=500, seconds=0.2)
    page.get_by_role("button", name="Play").click()
    page.wait_for_function(
        "() => { const t = window.__precedentMap.v1.state().tour; return t.active && t.index >= 1; }",
        timeout=20000,
    )
    page.get_by_text(_fragment(1), exact=False).wait_for(timeout=5000)
    ctx.close()


def test_O33_the_next_stop_is_requested_before_the_current_one_ends(base, browser):
    log = []
    ctx, page = _open(browser, base, log=log, seconds=3.0)
    page.get_by_role("button", name="Play").click()
    deadline = time.time() + 20
    while time.time() < deadline:
        if _tour(page)["index"] == 1:
            break
        time.sleep(0.1)
    assert len(log) >= 2, f"only {len(log)} narration requests were made by the time stop 2 began"
    assert " ".join(STOPS[1]["text"].split())[:30] in " ".join(log[1]["text"].split()), f"the prefetched clip was not stop 2: {log[1]['text'][:80]!r}"
    ctx.close()


def test_O34_the_tour_offers_previous_play_next_and_its_position(base, browser):
    ctx, page = _open(browser, base)
    for name in ("Previous stop", "Play", "Next stop", "Stop tour"):
        assert page.get_by_role("button", name=name).count() == 1, f"no {name} control"
    assert f"Stop 1 of {N}" in page.inner_text("body"), "the tour does not state its position"
    ctx.close()


def test_O35_the_tour_can_be_stopped_replayed_and_resumed_after_a_skip(base, browser):
    ctx, page = _open(browser, base, seconds=0.3)
    page.get_by_role("button", name="Play").click()
    page.get_by_role("button", name="Pause").click()
    page.get_by_role("button", name="Next stop").click()
    page.get_by_role("button", name="Next stop").click()
    page.wait_for_timeout(500)
    assert _tour(page)["index"] == 2, "next stop did not move the tour to stop 3"
    page.get_by_role("button", name="Stop tour").click()
    page.wait_for_timeout(300)
    assert not _tour(page)["active"], "Stop tour did not stop the tour"
    page.get_by_role("button", name="Play").click()
    page.wait_for_timeout(800)
    assert _tour(page)["active"] and _tour(page)["index"] == 2, "the tour did not resume where the reader left it"
    ctx.close()


def test_O36_the_memo_is_narrated_before_the_first_stop(base, browser):
    log = []
    memo = visible_words(RUN["answer"], 8)[:30]

    def install(page):
        serve_run(page, RUN, "v3-ask")
        page.route(
            "**/api/ask",
            lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps({"run_id": "v3-ask"})),
        )
        _tts(page, log=log, seconds=3.0)

    ctx, page = open_page(browser, base, "/", DESKTOP, setup=install)
    map_ready(page)
    page.get_by_role("textbox", name="Ask a question").fill(RUN["question"])
    page.get_by_role("button", name="Ask", exact=True).click()
    page.wait_for_timeout(1500)
    assert log and memo in " ".join(log[0]["text"].split()), f"the first narration was not the memo: {log[0]['text'][:80] if log else 'nothing'!r}"
    assert not _tour(page)["active"], "the tour started before the memo finished narrating"
    page.wait_for_function(
        "() => { const t = window.__precedentMap.v1.state().tour; return t.active && t.index === 0; }",
        timeout=20000,
    )
    ctx.close()


def test_O37_dragging_or_scrolling_the_map_stops_the_tour(base, browser):
    ctx, page = _open(browser, base, seconds=0.3)
    page.get_by_role("button", name="Play").click()
    page.wait_for_timeout(300)
    canvas = page.locator("canvas").first
    box = canvas.bounding_box()
    page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    page.mouse.down()
    page.mouse.move(box["x"] + box["width"] / 2 + 80, box["y"] + box["height"] / 2 + 60, steps=10)
    page.mouse.up()
    page.wait_for_timeout(500)
    assert not _tour(page)["active"], "dragging the map did not stop the tour"

    page.get_by_role("button", name="Play").click()
    page.wait_for_timeout(300)
    page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    page.mouse.wheel(0, 400)
    page.wait_for_timeout(500)
    assert not _tour(page)["active"], "scrolling the map did not stop the tour"
    ctx.close()


def test_O11_one_listen_control_drives_the_memo_and_the_tour(base, browser):
    ctx, page = _open(browser, base, seconds=3.0)
    page.get_by_role("button", name="Listen").click()
    page.wait_for_timeout(400)
    assert page.get_by_role("button", name="Stop listening").count() == 1, "Listen did not start memo narration"
    assert not _tour(page)["active"], "the tour started when the memo was asked to narrate"

    page.get_by_role("button", name="Play").click()
    page.wait_for_timeout(800)
    assert _tour(page)["active"], "starting the tour did not start it"
    assert page.get_by_role("button", name="Stop listening").count() == 1, "the Listen control does not reflect tour narration"

    page.get_by_role("button", name="Stop listening").click()
    page.wait_for_timeout(400)
    assert not _tour(page)["playing"], "Listen did not stop tour narration"
    ctx.close()


NO_AUTHORITY = load_fixture("run-no-authority.json")


def _stop_controls(page):
    """Each tour control and whether it is usable, so a hidden bar and a disabled bar both pass."""
    states = {}
    for name in ("Previous stop", "Next stop", "Play", "Stop tour"):
        controls = page.get_by_role("button", name=name, exact=True)
        states[name] = [controls.nth(i).is_disabled() for i in range(controls.count())]
    return states


def _assert_no_stop_is_claimed(page, where):
    assert not re.search(r"Stop\s+\d+\s+of\s+0\b", page.inner_text("body")), f"{where}: the page claims a stop when there are none"
    for name, disabled in _stop_controls(page).items():
        assert not any(state is False for state in disabled), f"{where}: {name} is usable with no stops"


def test_O108_a_page_with_no_authorities_claims_no_stop(base, browser):
    ctx, page = open_page(browser, base, "/", DESKTOP)
    map_ready(page)
    _assert_no_stop_is_claimed(page, "a page with no run")
    ctx.close()

    ctx, page = open_run(browser, base, NO_AUTHORITY, path="/map", run_id="no-authority-run")
    map_ready(page)
    assert map_call(page, "state().tour.count") == 0, "the refusal run was given stops"
    _assert_no_stop_is_claimed(page, "a run with no authorities")
    ctx.close()
