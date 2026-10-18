"""V2 composer (#103): Ask becomes Follow-up after the first answer, a New question button resets the
thread, the pill row is a horizontal slider without the Tour pill, the input clears on submit, and the
sent question shows in a transparent strip at the top of the map that fades out."""

import json

import pytest
from ui_server import app_server, needs_chromium, open_page

sync_api = pytest.importorskip("playwright.sync_api")
pytestmark = needs_chromium

QUESTION = "Alpha question about Colorado vehicle searches?"
RESULT = {
    "run_id": "test103",
    "question": QUESTION,
    "answer": "**Short answer:** Alpha summary sentence for Colorado drivers. [1]\n\n- **Alpha Case** [1] - alpha point",
    "citations": [
        {
            "id": "Alpha Case, 1 P.3d 1",
            "title": "Alpha Case",
            "type": "caselaw",
            "court": "Colorado Supreme Court",
            "date": "2001-01-01",
            "ref": "[1]",
            "url": "",
            "passage": "Alpha Case held that officers must have probable cause before searching a vehicle.",
        }
    ],
    "edges": [],
    "documents": [],
    "safeguard": {"pass": True},
    "provider": "test",
    "elapsed_s": 1,
}


TTS_STUB = """() => { window.__tts=[]; const of=window.fetch.bind(window); const silent='UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=';
 window.fetch=(u,o)=>{ const url=String(u&&u.url||u); if(url.includes('/api/tts')){ let t=''; try{ t=JSON.parse((o&&o.body)||'{}').text||''; }catch(e){} window.__tts.push(t); return Promise.resolve(new Response(JSON.stringify({audio_b64:silent}),{status:200,headers:{'Content-Type':'application/json'}})); } return of(u,o); }; }"""


@pytest.fixture(scope="module")
def base():
    with app_server() as url:
        yield url


@pytest.fixture(scope="module")
def browser():
    with sync_api.sync_playwright() as p:
        b = p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required", "--use-gl=swiftshader", "--enable-unsafe-swiftshader"])
        yield b
        b.close()


def _open(browser, base, width=1440):
    ctx, page = open_page(browser, base, "/", width)
    page.evaluate(TTS_STUB)
    page.route("**/api/ask", lambda r: r.fulfill(status=200, content_type="application/json", body='{"run_id": "test103"}'))
    page.route("**/api/run/test103", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps({"result": RESULT})))
    page.wait_for_function("!!(window.Docs3D && Docs3D.tour)", timeout=30000)
    return ctx, page


def _answer_once(browser, base, width=1440):
    ctx, page = _open(browser, base, width)
    page.fill("#q", QUESTION)
    page.click("#go")
    page.wait_for_selector("#answer >> text=Alpha Case", timeout=30000)
    return ctx, page


def _label(page):
    return page.inner_text("#go").strip().lower()


def test_submit_says_ask_before_any_answer(base, browser):
    ctx, page = _open(browser, base)
    assert _label(page) == "ask", f"submit must read Ask before a run, got {_label(page)!r}"
    assert page.locator("#new-question").count() == 0, "New question must not show before the first answer"
    ctx.close()


def test_submit_becomes_follow_up_after_an_answer(base, browser):
    ctx, page = _answer_once(browser, base)
    assert _label(page) == "follow-up", f"submit must read Follow-up after a run, got {_label(page)!r}"
    ctx.close()


def test_new_question_resets_to_a_fresh_thread(base, browser):
    ctx, page = _answer_once(browser, base)
    assert page.locator("#new-question").count() == 1, "New question button must appear above the input"
    page.click("#new-question")
    assert _label(page) == "ask", f"New question must flip the submit back to Ask, got {_label(page)!r}"
    assert page.locator("#answer >> text=Alpha Case").count() == 0, "New question must clear the previous answer"
    # the next submit must not carry the previous run
    sent = []
    page.on("request", lambda r: sent.append(r) if "/api/ask" in r.url else None)
    page.fill("#q", "Beta question about a different search?")
    page.click("#go")
    page.wait_for_timeout(800)
    assert sent, "a fresh question must still POST /api/ask"
    body = sent[-1].post_data or ""
    assert "prev_run_id" not in body, f"a fresh thread must not reuse the previous run: {body}"
    ctx.close()


def test_pills_are_a_horizontal_slider_without_tour(base, browser):
    for w in (390, 1440):
        ctx, page = _open(browser, base, w)
        assert page.locator("#tour-btn").count() == 0, f"Tour pill must be gone @{w}"
        assert page.locator(".v2-pills >> text=Tour").count() == 0, f"Tour pill text must be gone @{w}"
        pills = page.locator(".v2-pills")
        assert pills.count() == 1, f"one pill track expected @{w}"
        css = pills.evaluate(
            """el => ({ ox: getComputedStyle(el).overflowX, wrap: getComputedStyle(el).flexWrap,
                        sw: el.scrollWidth, cw: el.clientWidth })"""
        )
        assert css["ox"] in ("auto", "scroll"), f"pill track must scroll horizontally @{w}: {css}"
        assert css["wrap"] == "nowrap", f"pill track must not wrap onto a second row @{w}: {css}"
        labels = pills.locator(".v2-pill").evaluate_all("els => els.map(e => e.textContent.trim())")
        assert labels == ["Sources", "Follow-ups", "Legend"], f"pills after the change are Sources/Follow-ups/Legend, got {labels} @{w}"
        ctx.close()


def test_input_clears_and_sent_question_shows_in_a_top_strip(base, browser):
    ctx, page = _open(browser, base)
    page.fill("#q", QUESTION)
    page.click("#go")
    # read the strip immediately: it fades out a few seconds after submit
    page.wait_for_selector("#sent-question", timeout=10000)
    strip = page.locator("#sent-question")
    assert strip.count() == 1, "the sent question must render in a #sent-question strip"
    assert QUESTION in strip.inner_text(), f"strip must show the sent question, got {strip.inner_text()!r}"
    assert page.input_value("#q") == "", "the input must clear on submit"
    box = strip.bounding_box()
    col = page.locator(".v2-mapcol").bounding_box()
    assert box and col, "strip and map column must be laid out"
    assert box["y"] - col["y"] < col["height"] * 0.4, f"strip must sit at the top of the map pane, strip y={box['y']} col y={col['y']}"
    bg = strip.evaluate("el => getComputedStyle(el).backgroundColor")
    alpha = 1.0
    if bg.startswith("rgba("):
        alpha = float(bg[:-1].split(",")[-1])
    assert alpha < 1.0, f"strip must be transparent, got {bg}"
    ctx.close()


def test_follow_up_still_posts_the_previous_run(base, browser):
    ctx, page = _answer_once(browser, base)
    sent = []
    page.on("request", lambda r: sent.append(r) if "/api/ask" in r.url else None)
    page.fill("#q", "And what about consent?")
    page.click("#go")
    page.wait_for_timeout(800)
    assert sent, "a follow-up must still POST /api/ask"
    body = sent[-1].post_data or ""
    assert '"prev_run_id": "test103"' in body.replace("'", '"'), f"a follow-up must carry the previous run id: {body}"
    ctx.close()
