"""O73-O79: the working page the owner asked for on 2026-10-19 — progress while a run works, the detail
behind each authority, how the answer was produced, a first-visit cue, authority details on the map, speech
that can always be silenced, and saved runs opened from Home."""

import copy
import json
import re

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
    result_payload,
    serve_run,
)

sync_api = pytest.importorskip("playwright.sync_api")
pytestmark = [needs_chromium, needs_v3]

RUN = load_fixture("run-features.json")
RUN_ID = RUN["run_id"]
PARITY = load_fixture("run-parity.json")
PARITY_ID = PARITY["run_id"]
NO_PASSAGE = next(c for c in RUN["citations"] if not c.get("passage"))


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


def _open(browser, base, run=RUN, path="/", width=DESKTOP, run_id=None):
    rid = run_id or run["run_id"]
    ctx, page = open_page(browser, base, f"{path}?run={rid}", width, setup=lambda p: serve_run(p, run, rid))
    return ctx, page


def test_O73_progress_is_named_and_the_draft_appears_before_the_memo(base, browser):
    ctx = browser.new_context(viewport={"width": DESKTOP, "height": 900})
    page = ctx.new_page()
    stream_id = "stream-fixture"
    seen = {"n": 0}
    partial = "**Short answer:** the exemption follows residence [1]."

    page.route("**/api/ask", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps({"run_id": stream_id})))

    def read_run(route):
        seen["n"] += 1
        if seen["n"] <= 4:
            body = json.dumps(
                {
                    "events": [{"agent": "retriever", "kind": "claim", "msg": "Searching Colorado authorities"}],
                    "partial": partial,
                    "result": None,
                }
            )
        else:
            body = json.dumps({"result": result_payload(RUN, stream_id)})
        route.fulfill(status=200, content_type="application/json", body=body)

    page.route(f"**/api/run/{stream_id}", read_run)
    page.goto(base + "/", wait_until="domcontentloaded")

    page.get_by_label("Ask a question").fill("Does the exemption reach severed minerals?")
    page.get_by_role("button", name="Ask", exact=True).click()

    progress = page.get_by_label("Run progress")
    progress.wait_for(timeout=10000)
    assert progress.is_visible(), "the page does not say what the run is doing"
    assert re.search("search|retriev|plann", progress.inner_text(), re.I), f"the progress region does not name the stage: {progress.inner_text()!r}"

    page.get_by_text("the exemption follows residence", exact=False).first.wait_for(timeout=10000)
    page.get_by_role("heading", name="Key authorities").wait_for(timeout=20000)
    page.wait_for_timeout(500)
    assert not page.get_by_label("Run progress").is_visible(), "the progress region stayed after the memo arrived"
    ctx.close()


def test_O74_the_source_list_carries_the_detail_behind_each_authority(base, browser):
    ctx, page = _open(browser, base)
    page.get_by_role("button", name="Memo menu", exact=True).click()
    page.get_by_role("button", name="Sources", exact=True).click()

    panel = page.get_by_role("dialog", name="Sources")
    panel.wait_for(timeout=5000)
    body = panel.inner_text()

    for citation in RUN["citations"]:
        title = citation.get("title") or ""
        assert title in body, f"the source list omits {title}"
        for field in ("citation", "court", "date"):
            value = str(citation.get(field) or "").strip()
            if value:
                assert value in body, f"the source list omits the {field} for {title}"
    assert re.search("statute|case", body, re.I), "the source list does not state the kind of authority"

    with_passage = next(c for c in RUN["citations"] if c.get("passage"))
    assert with_passage["passage"][:40] in body, f"the source list shows no passage for {with_passage['title']}"

    assert NO_PASSAGE["title"] in body
    assert re.search("citation graph", body, re.I), "an authority with no passage does not say where it came from"
    ctx.close()


def test_O75_the_memo_states_how_the_answer_was_produced(base, browser):
    ctx, page = _open(browser, base)
    status = page.get_by_label("Answer status")
    status.wait_for(timeout=10000)
    text = status.inner_text()

    assert re.search("citation check", text, re.I), f"the status does not state the citation check: {text!r}"
    assert re.search("pass", text, re.I), f"the status does not state the citation check result: {text!r}"
    assert re.search(r"\b12\b", text), f"the status does not state how many references were verified: {text!r}"
    assert re.search(r"12\.4|\b12\b", text), f"the status does not state how long the run took: {text!r}"
    ctx.close()

    cached = copy.deepcopy(RUN)
    cached["run_id"] = "cached-fixture"
    cached["provider"] = "cached"
    ctx, page = _open(browser, base, run=cached)
    text = page.get_by_label("Answer status").inner_text()
    assert re.search("cache", text, re.I), f"a cached answer is not labelled as cached: {text!r}"
    ctx.close()

    template = copy.deepcopy(RUN)
    template["run_id"] = "template-fixture"
    template["provider"] = "template"
    ctx, page = _open(browser, base, run=template)
    text = page.get_by_label("Answer status").inner_text()
    assert re.search("template", text, re.I), f"an offline template answer is not labelled: {text!r}"
    ctx.close()


def test_O76_the_first_visit_is_guided_and_the_empty_ask_says_what_is_missing(base, browser):
    ctx = browser.new_context(viewport={"width": DESKTOP, "height": 900})
    page = ctx.new_page()
    page.goto(base + "/", wait_until="domcontentloaded")

    cue = page.get_by_label("Getting started")
    cue.wait_for(timeout=5000)
    assert cue.is_visible(), "a first visit has no getting-started cue"

    examples = cue.get_by_role("button").filter(has_not_text="Dismiss getting started")
    assert examples.count() >= 3, "the cue offers no example questions"
    examples.first.click()
    assert page.get_by_label("Ask a question").input_value().strip(), "an example question does not fill the composer"

    page.get_by_label("Ask a question").fill("")
    page.get_by_role("button", name="Ask", exact=True).click()
    page.get_by_label("Question needed").wait_for(timeout=3000)
    assert page.get_by_label("Question needed").is_visible(), "an empty ask says nothing"

    page.get_by_role("button", name="Dismiss getting started").click()
    assert not cue.is_visible(), "the cue cannot be dismissed"
    page.reload(wait_until="domcontentloaded")
    page.wait_for_timeout(800)
    assert not page.get_by_label("Getting started").is_visible(), "the dismissed cue came back on the next visit"
    ctx.close()


def test_O77_a_pin_opens_the_authority_behind_it(base, browser):
    ctx, page = _open(browser, base, path="/map")
    map_ready(page)
    page.wait_for_timeout(600)

    first = 3
    group = map_call(page, f"pinCites({first})")
    assert group, f"the map cannot say what the pin for citation {first} stands for"
    lead = RUN["citations"][group[0]]

    point = map_call(page, f"pinScreen({first})")
    assert point, "the map cannot place the pin"
    box = page.locator("canvas").first.bounding_box()
    page.mouse.click(box["x"] + point["x"], box["y"] + point["y"])

    detail = page.get_by_role("dialog", name="Authority")
    detail.wait_for(timeout=5000)
    assert detail.is_visible(), "clicking a pin opens no authority"
    text = detail.inner_text()
    assert lead["title"] in text, f"the authority detail does not name {lead['title']}"
    if lead.get("passage"):
        assert lead["passage"][:40] in text, "the authority detail shows no passage"
    assert detail.locator("a").count() >= 1, "the authority detail links to nothing"

    others = [i for i in range(len(RUN["citations"])) if i != first and map_call(page, f"pinCites({i})") and map_call(page, f"pinScreen({i})")]
    assert others, "the map has only one pinned authority"
    other = others[0]
    other_point = map_call(page, f"pinScreen({other})")
    page.mouse.click(box["x"] + other_point["x"], box["y"] + other_point["y"])
    page.wait_for_timeout(600)
    assert page.get_by_role("dialog", name="Authority").count() == 1, "more than one authority is open at once"
    other_title = RUN["citations"][map_call(page, f"pinCites({other})")[0]]["title"]
    assert other_title in page.get_by_role("dialog", name="Authority").inner_text(), "the new pin did not replace the detail"

    page.keyboard.press("Escape")
    assert not page.get_by_role("dialog", name="Authority").is_visible(), "Escape did not close the authority"
    ctx.close()


def test_O78_speech_can_always_be_silenced_and_stopped(base, browser):
    ctx, page = _open(browser, base)
    page.get_by_role("button", name="Listen", exact=True).click()
    page.get_by_role("button", name="Stop listening", exact=True).wait_for(timeout=10000)

    page.keyboard.press("Escape")
    page.get_by_role("button", name="Listen", exact=True).wait_for(timeout=5000)
    assert page.get_by_role("button", name="Stop listening", exact=True).count() == 0, "Escape did not stop the voice"

    page.get_by_role("button", name="Mute", exact=True).click()
    assert page.get_by_role("button", name="Unmute", exact=True).is_visible(), "Mute does not say it is muted"
    page.get_by_role("button", name="Unmute", exact=True).click()
    assert page.get_by_role("button", name="Mute", exact=True).is_visible(), "Unmute does not restore sound"
    ctx.close()

    ctx = browser.new_context(viewport={"width": DESKTOP, "height": 900})
    page = ctx.new_page()
    serve_run(page, RUN, RUN_ID)
    page.route(
        "**/api/tts_ts",
        lambda r: (page.wait_for_timeout(1500), r.fulfill(status=200, content_type="application/json", body=json.dumps({"audio_b64": "", "starts": []}))),
    )
    page.goto(base + f"/?run={RUN_ID}", wait_until="domcontentloaded")
    page.get_by_role("button", name="Listen", exact=True).click()
    loading = page.get_by_label("Audio loading")
    loading.wait_for(timeout=4000)
    assert loading.is_visible(), "a clip being fetched shows no loading state"
    loading.wait_for(state="hidden", timeout=8000)
    ctx.close()


def test_O79_a_saved_run_can_be_opened_from_home(base, browser):
    ctx = browser.new_context(viewport={"width": DESKTOP, "height": 900})
    page = ctx.new_page()
    listing = [
        {"run_id": RUN_ID, "question": RUN["question"], "n": len(RUN["citations"])},
        {"run_id": PARITY_ID, "question": PARITY["question"], "n": len(PARITY["citations"])},
    ]
    page.route("**/api/runs", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(listing)))
    serve_run(page, RUN, RUN_ID)
    serve_run(page, PARITY, PARITY_ID)
    page.goto(base + "/", wait_until="domcontentloaded")

    page.get_by_role("button", name="Open a saved run", exact=True).click()

    panel = page.get_by_role("dialog", name="Saved runs")
    panel.wait_for(timeout=5000)
    assert panel.is_visible(), "the saved-runs action opens no list"
    panel.get_by_role("button", name=PARITY["question"], exact=True).click()

    page.get_by_text("AI drafting was unavailable", exact=False).first.wait_for(timeout=15000)
    map_ready(page)
    assert map_call(page, "pinCount") > 0, "opening a saved run leaves the map empty"
    ctx.close()
