"""V2 tour narration (#95): no speaker icon, summary first, skip-to-stop, Stop n of N only."""

import re
import pytest
from ui_server import app_server, needs_chromium, open_page

sync_api = pytest.importorskip("playwright.sync_api")
pytestmark = needs_chromium

RESULT = {
    "run_id": "test95",
    "question": "Alpha question about Colorado vehicle searches?",
    "answer": "**Short answer:** Alpha summary sentence for Colorado drivers. [1]\n\n- **Alpha Case** [1] - alpha point\n- **Beta Case** [2] - beta point\n- **Gamma Case** [3] - gamma point",
    "citations": [
        {
            "id": "Alpha Case, 1 P.3d 1",
            "title": "Alpha Case",
            "type": "caselaw",
            "court": "Colorado Supreme Court",
            "date": "2001-01-01",
            "ref": "[1]",
            "url": "",
            "passage": "Alpha Case held that officers must have probable cause before searching a vehicle on a Colorado road. The court explained the rule in detail for drivers.",
        },
        {
            "id": "Beta Case, 2 P.3d 2",
            "title": "Beta Case",
            "type": "caselaw",
            "court": "Colorado Supreme Court",
            "date": "2002-02-02",
            "ref": "[2]",
            "url": "",
            "passage": "Beta Case held that officers must have probable cause before searching a vehicle on a Colorado road. The court explained the rule in detail for drivers.",
        },
        {
            "id": "Gamma Case, 3 P.3d 3",
            "title": "Gamma Case",
            "type": "caselaw",
            "court": "Colorado Supreme Court",
            "date": "2003-03-03",
            "ref": "[3]",
            "url": "",
            "passage": "Gamma Case held that officers must have probable cause before searching a vehicle on a Colorado road. The court explained the rule in detail for drivers.",
        },
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


def _tour_bar(page):
    page.wait_for_selector("#tour-controls button", timeout=30000)
    return page.locator("#tour-controls")


def test_tour_bar_only_prev_play_next_no_speaker(base, browser):
    for w in (1440, 390):
        ctx, page = open_page(browser, base, "/", w)
        bar = _tour_bar(page)
        kinds = bar.locator("button").evaluate_all("els => els.map(e => e.dataset.tour || '')")
        assert kinds == ["prev", "play", "next"], f"tour buttons must be prev/play/next only, got {kinds} @{w}"
        assert bar.locator("[data-abtn=mute], [data-tour=voice]").count() == 0
        text = bar.inner_text()
        assert "\U0001f50a" not in text and "\U0001f507" not in text, text
        labels = bar.locator("button").evaluate_all("els => els.map(e => (e.getAttribute('aria-label')||'') + ' ' + (e.title||''))")
        assert not any(re.search(r"mute|voice|speaker", x, re.I) for x in labels), labels
        ctx.close()


def _ask_fixture(browser, base, width=1440):
    ctx, page = open_page(browser, base, "/", width)
    page.evaluate(TTS_STUB)
    page.route("**/api/ask", lambda r: r.fulfill(status=200, content_type="application/json", body="{\"run_id\": \"test95\"}"))
    page.route("**/api/run/test95", lambda r: r.fulfill(status=200, content_type="application/json", body=__import__("json").dumps({"result": RESULT})))
    page.wait_for_function("!!(window.Docs3D && Docs3D.tour && Docs3D.order)", timeout=30000)
    page.fill("#q", RESULT["question"])
    page.click("#go")
    page.wait_for_selector("#answer >> text=Alpha Case", timeout=30000)
    return ctx, page


def test_summary_narration_starts_before_any_tour_clip(base, browser):
    ctx, page = _ask_fixture(browser, base)
    page.wait_for_function("window.__tts && window.__tts.length >= 2", timeout=30000)
    tts = page.evaluate("window.__tts")
    assert "Alpha summary sentence" in tts[0], f"first narration must be the summary, got {tts[:3]}"
    assert "Alpha Case" in tts[1], f"tour stop 1 must follow the summary, got {tts[:3]}"
    assert not any("Beta Case" in t or "Gamma Case" in t for t in tts[:1])
    # minimal Stop n of N, and no bare-number citation badges in the answer
    page.wait_for_selector("[data-tour-stop]", timeout=30000)
    stop_text = page.locator("[data-tour-stop]").first.inner_text()
    assert re.search(r"Stop 1 of 3", stop_text), stop_text
    refs = page.locator("#answer .v2-ref").evaluate_all("els => els.map(e => e.textContent.trim())")
    assert refs, "answer citations must still be present/clickable"
    assert not any(re.fullmatch(r"\[?\d+\]?", r) for r in refs), f"numbered citation badges visible: {refs}"
    ctx.close()


def test_pin_tags_have_no_numbered_badges(base, browser):
    ctx, page = _ask_fixture(browser, base)
    page.wait_for_function("window.__tts && window.__tts.length >= 1", timeout=30000)
    page.wait_for_timeout(1200)
    tags = page.evaluate(
        """() => [...document.querySelectorAll('.v2-mapwrap div')].map(d=>d.textContent.trim()).filter(t=>t.includes('Colorado Supreme Court') && t.length < 100)"""
    )
    assert tags, "pin tags should still show the court label"
    assert not any(re.search(r"\[\d+\]", t) for t in tags), f"numbered pin badges visible: {tags}"
    ctx.close()


def test_skip_to_stop_next_prev_and_jump(base, browser):
    ctx, page = _ask_fixture(browser, base)
    page.wait_for_function("window.__tts && window.__tts.length >= 2", timeout=30000)
    page.evaluate("() => { Docs3D.stopTour(); window.__tts.length = 0; }")
    page.wait_for_timeout(300)
    page.evaluate("window.__tts.length = 0")
    # next -> stop 2 starts immediately
    page.locator("#tour-controls [data-tour=next]").click()
    page.wait_for_function("document.querySelector('#transcript') && document.querySelector('#transcript').textContent.includes('Beta Case')", timeout=15000)
    assert re.search(r"Stop 2 of 3", page.locator("[data-tour-stop]").first.inner_text())
    page.wait_for_function("window.__tts.length >= 1", timeout=15000)
    tts = page.evaluate("window.__tts")
    assert "Beta Case" in tts[0], f"next must start stop 2 clip/caption first, got {tts[:3]}"
    assert not any("Alpha Case" in t for t in tts), f"earlier clip played after skip: {tts}"
    # prev -> stop 1
    page.evaluate("() => { window.__tts.length = 0; }")
    page.locator("#tour-controls [data-tour=prev]").click()
    page.wait_for_function("document.querySelector('#transcript') && document.querySelector('#transcript').textContent.includes('Alpha Case')", timeout=15000)
    assert re.search(r"Stop 1 of 3", page.locator("[data-tour-stop]").first.inner_text())
    page.wait_for_function("window.__tts.length >= 1", timeout=15000)
    tts = page.evaluate("window.__tts")
    assert "Alpha Case" in tts[0], tts[:3]
    # jump (pin/citation path) -> stop 3, cancelling pending earlier clips
    page.evaluate("() => { window.__tts.length = 0; Docs3D.jump(Docs3D.order()[2]); }")
    page.wait_for_function("document.querySelector('#transcript') && document.querySelector('#transcript').textContent.includes('Gamma Case')", timeout=15000)
    assert re.search(r"Stop 3 of 3", page.locator("[data-tour-stop]").first.inner_text())
    page.wait_for_function("window.__tts.length >= 1", timeout=15000)
    tts = page.evaluate("window.__tts")
    assert "Gamma Case" in tts[0], tts[:3]
    assert not any(("Alpha Case" in t or "Beta Case" in t) for t in tts), f"earlier clip after jump: {tts}"
    ctx.close()


@pytest.mark.parametrize("w", [390, 768, 1024, 1440])
def test_tour_no_overflow_dark_light(base, browser, w):
    for theme in ("dark", "light"):
        ctx, page = open_page(browser, base, "/", w)
        _tour_bar(page)
        if theme == "light":
            page.locator("#theme-toggle").click()
            page.wait_for_timeout(300)
        sw = page.evaluate("Math.max(document.documentElement.scrollWidth, document.body.scrollWidth)")
        assert sw <= w + 1, f"@{w} {theme} overflow {sw}"
        ctx.close()
