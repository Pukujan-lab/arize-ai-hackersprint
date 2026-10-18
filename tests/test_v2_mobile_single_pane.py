"""V2 mobile single-pane (#96): one full-height pane, top panels, bottom-third swipe, slim top preview."""

import json
import re
import pytest
from ui_server import app_server, needs_chromium, open_page

sync_api = pytest.importorskip("playwright.sync_api")
pytestmark = needs_chromium

RESULT = {
    "run_id": "test96",
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
VIS = "() => { const v=(el)=>{ if(!el) return false; const cs=getComputedStyle(el); if(cs.display===\"none\"||cs.visibility===\"hidden\") return false; const r=el.getBoundingClientRect(); return r.width>0 && r.height>0; }; return {answer:v(document.querySelector(\"#answer\")), map:v(document.querySelector(\".v2-mapcol\")), composer:v(document.querySelector(\"#q\"))}; }"


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


def _ask(browser, base, width):
    ctx, page = open_page(browser, base, "/", width)
    page.route("**/api/ask", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps({"run_id": "test96"})))
    page.route("**/api/run/test96", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps({"result": RESULT})))
    page.wait_for_function("!!(window.Docs3D && Docs3D.tour)", timeout=30000)
    page.fill("#q", RESULT["question"])
    page.click("#go")
    page.wait_for_selector("#answer >> text=Alpha Case", timeout=30000)
    page.evaluate("() => { if (window.Docs3D) Docs3D.stopTour(); if (window.AudioMgr) AudioMgr.stopAll(); }")
    return ctx, page


def test_mobile_single_pane_toggle_and_composer(base, browser):
    ctx, page = _ask(browser, base, 390)
    tabs = page.locator("[data-pane]")
    assert tabs.count() == 2, "mobile needs Answer/Map pane buttons"
    st = page.evaluate(VIS)
    assert st["answer"] and not st["map"] and st["composer"], f"default must be Answer only: {st}"
    box = page.locator("#answer").bounding_box()
    assert box and box["height"] > 300, f"Answer pane must be full-height: {box}"
    page.locator("[data-pane=\"map\"]").click()
    page.wait_for_timeout(400)
    st = page.evaluate(VIS)
    assert st["map"] and not st["answer"] and st["composer"], f"Map only after toggle: {st}"
    mbox = page.locator(".v2-mapcol").bounding_box()
    assert mbox and mbox["height"] > 300, f"Map pane must be full-height: {mbox}"
    page.locator("[data-pane=\"answer\"]").click()
    page.wait_for_timeout(400)
    st = page.evaluate(VIS)
    assert st["answer"] and not st["map"], st
    ctx.close()


@pytest.mark.parametrize("w, single", [(768, True), (1024, False), (1440, False)])
def test_breakpoints_single_vs_split(base, browser, w, single):
    ctx, page = open_page(browser, base, "/", w)
    page.wait_for_selector("#docs3d", timeout=30000)
    page.wait_for_timeout(800)
    st = page.evaluate(VIS)
    if single:
        assert st["answer"] != st["map"], f"@{w} must show exactly one pane: {st}"
        assert page.locator("[data-pane]").first.is_visible()
    else:
        assert st["answer"] and st["map"], f"@{w} desktop split must show both: {st}"
        if page.locator("[data-pane]").count():
            assert not page.locator("[data-pane]").first.is_visible(), "pane tabs are mobile-only"
    ctx.close()


def test_mobile_panels_open_from_top_into_same_pane(base, browser):
    ctx, page = _ask(browser, base, 390)
    for btn, panel in [("#sources-btn", "#sources-panel"), ("#legend-btn", "#legend-panel"), ("#followups-btn", "#followups-panel")]:
        page.locator(btn).click()
        page.wait_for_selector(panel + ":visible", timeout=10000)
        box = page.locator(panel).bounding_box()
        assert box and box["y"] < 220, f"{panel} must open from the top, got y={box}"
        page.locator(panel + " [data-close]").click()
        page.wait_for_timeout(300)
        assert not page.locator(panel).is_visible()
        st = page.evaluate(VIS)
        assert st["answer"] and not st["map"], f"close must return to Answer: {st}"
    ctx.close()


def _swipe(page, pane_sel, y_frac, dx):
    page.evaluate(
        """([sel, yf, dx]) => { const el=document.querySelector(sel); const r=el.getBoundingClientRect(); const y=r.top + r.height*yf; const x0=r.left + r.width/2;
      const mk=(type,x)=>{ const t=new Touch({identifier:1,target:el,clientX:x,clientY:y}); return new TouchEvent(type,{touches: type==="touchend"?[]:[t], changedTouches:[t], bubbles:true, cancelable:true}); };
      el.dispatchEvent(mk("touchstart",x0)); el.dispatchEvent(mk("touchmove",x0+dx/2)); el.dispatchEvent(mk("touchend",x0+dx)); }""",
        [pane_sel, y_frac, dx],
    )
    page.wait_for_timeout(400)


def test_bottom_third_swipe_switches_top_does_not(base, browser):
    ctx, page = _ask(browser, base, 390)
    # small movement in the bottom third is a tap, not a swipe
    _swipe(page, "#answer", 0.9, -20)
    st = page.evaluate(VIS)
    assert st["answer"] and not st["map"], f"tap must pass through: {st}"
    # swipe in the top 2/3 must not switch (map drag / content area)
    _swipe(page, "#answer", 0.2, -120)
    st = page.evaluate(VIS)
    assert st["answer"] and not st["map"], f"top swipe must not switch: {st}"
    # bottom-third swipe left: Answer -> Map
    _swipe(page, "#answer", 0.9, -120)
    st = page.evaluate(VIS)
    assert st["map"] and not st["answer"], f"bottom-third swipe must switch to Map: {st}"
    # bottom-third swipe right: Map -> Answer
    _swipe(page, ".v2-mapcol", 0.9, 120)
    st = page.evaluate(VIS)
    assert st["answer"] and not st["map"], f"bottom-third swipe must switch back: {st}"
    ctx.close()


def test_citation_tap_slim_preview_top_read_source_close(base, browser):
    ctx, page = _ask(browser, base, 390)
    page.locator("#answer .v2-ref").first.click()
    page.wait_for_selector("#pin-preview:visible", timeout=15000)
    pv = page.locator("#pin-preview")
    text = pv.inner_text()
    assert "Alpha Case" in text and "Colorado Supreme Court" in text and "2001" in text, text
    assert "held that officers" not in text, f"slim preview must not show the full opinion: {text}"
    box = pv.bounding_box()
    mapbox = page.locator(".v2-mapwrap").bounding_box()
    assert box and mapbox and box["y"] - mapbox["y"] < 60, f"preview must dock at the TOP of the map: {box} vs {mapbox}"
    assert box["height"] < 140, f"preview must be slim: {box}"
    st = page.evaluate(VIS)
    assert st["map"], "citation tap must show the map pane with the preview"
    # Read expands downward with the full text
    pv.locator("[data-preview-read]").click()
    page.wait_for_timeout(400)
    assert "held that officers" in pv.inner_text()
    box2 = pv.bounding_box()
    assert box2 and box2["height"] > box["height"], "Read must expand the strip downward"
    # Escape closes
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)
    assert not pv.is_visible(), "Escape must close the preview"
    # reopen, then Source jumps to its Sources card
    page.locator("[data-pane=\"answer\"]").click()
    page.wait_for_timeout(300)
    page.locator("#answer .v2-ref").first.click()
    page.wait_for_selector("#pin-preview:visible", timeout=15000)
    pv.locator("[data-preview-source]").click()
    page.wait_for_selector("#sources-panel:visible", timeout=10000)
    assert "Alpha Case" in page.locator("#sources-panel").inner_text()
    page.locator("#sources-panel [data-close]").click()
    ctx.close()


def test_click_on_map_outside_preview_closes_it(base, browser):
    ctx, page = _ask(browser, base, 1440)
    page.locator("#answer .v2-ref").first.click()
    page.wait_for_selector("#pin-preview:visible", timeout=15000)
    page.locator(".v2-mapwrap").click(position={"x": 60, "y": 420})
    page.wait_for_timeout(400)
    assert not page.locator("#pin-preview").is_visible(), "clicking the map outside the preview must close it"
    ctx.close()


def test_no_numbered_badges_on_citations_or_pins(base, browser):
    ctx, page = _ask(browser, base, 1440)
    refs = page.locator("#answer .v2-ref").evaluate_all("els => els.map(e => e.textContent.trim())")
    assert refs and not any(re.fullmatch(r"\[?\d+\]?", r) for r in refs), refs
    page.wait_for_timeout(1000)
    tags = page.evaluate(
        "() => [...document.querySelectorAll(\".v2-mapwrap div\")].map(d=>d.textContent.trim()).filter(t=>t.includes(\"Colorado Supreme Court\") && t.length < 100)"
    )
    assert tags and not any(re.search(r"\[\d+\]", t) for t in tags), tags
    ctx.close()


@pytest.mark.parametrize("w", [390, 768, 1024, 1440])
def test_no_overflow_dark_light(base, browser, w):
    for theme in ("dark", "light"):
        ctx, page = open_page(browser, base, "/", w)
        page.wait_for_selector("#docs3d", timeout=30000)
        if theme == "light":
            page.locator("#theme-toggle").click()
            page.wait_for_timeout(300)
        sw = page.evaluate("Math.max(document.documentElement.scrollWidth, document.body.scrollWidth)")
        assert sw <= w + 1, f"@{w} {theme} overflow {sw}"
        ctx.close()


def test_url_citation_tap_shows_preview_without_leaving_or_touring(base, browser):
    import copy

    result = copy.deepcopy(RESULT)
    for c in result["citations"]:
        c["url"] = "https://example.com/" + c["title"].split()[0].lower()
    ctx, page = open_page(browser, base, "/", 390)
    page.route("**/api/ask", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps({"run_id": "test96"})))
    page.route("**/api/run/test96", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps({"result": result})))
    page.wait_for_function("!!(window.Docs3D && Docs3D.tour)", timeout=30000)
    page.fill("#q", result["question"])
    page.click("#go")
    page.wait_for_selector("#answer .v2-ref", timeout=30000)
    page.evaluate("() => { if (window.Docs3D) Docs3D.stopTour(); if (window.AudioMgr) AudioMgr.stopAll(); }")
    ref = page.locator("#answer .v2-ref").first
    assert ref.evaluate("e => e.tagName") == "A", "live citations with URLs render as links; the test needs that shape"
    pages_before = len(ctx.pages)
    ref.click()
    page.wait_for_selector("#pin-preview:visible", timeout=15000)
    assert "Alpha Case" in page.locator("#pin-preview").inner_text()
    assert len(ctx.pages) == pages_before, "citation tap must show the preview, not open the external source"
    assert "/ Alpha" not in page.url and "example.com" not in page.url
    tr = page.locator("#transcript")
    assert not tr.is_visible(), "citation tap opens the preview only; it must not start the tour behind it"
    ctx.close()


TTS_STUB96 = """() => { window.__tts=[]; const of=window.fetch.bind(window); const silent="UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=";
 window.fetch=(u,o)=>{ const url=String(u&&u.url||u); if(url.includes("/api/tts")){ let t=""; try{ t=JSON.parse((o&&o.body)||"{}").text||""; }catch(e){} window.__tts.push(t); return Promise.resolve(new Response(JSON.stringify({audio_b64:silent}),{status:200,headers:{"Content-Type":"application/json"}})); } return of(u,o); }; }"""


def test_listen_button_on_answer_starts_summary_then_tour_and_stops(base, browser):
    ctx, page = _ask(browser, base, 390)
    page.evaluate(TTS_STUB96)
    btn = page.locator("#listen-btn")
    assert btn.count() == 1 and btn.is_visible(), "one clear Listen button must sit on the answer"
    assert page.locator("#tour-controls #listen-btn").count() == 0, "Listen must not live in the tour bar"
    assert btn.inner_text().strip() == "Listen"
    page.evaluate("() => { if (window.Docs3D) Docs3D.stopTour(); if (window.AudioMgr) AudioMgr.stopAll(); window.__tts.length = 0; }")
    page.wait_for_timeout(300)
    page.evaluate("window.__tts.length = 0")
    btn.click()
    page.wait_for_function("window.__tts && window.__tts.length >= 2", timeout=30000)
    tts = page.evaluate("window.__tts")
    assert "Alpha summary sentence" in tts[0], f"Listen must start with the summary: {tts[:3]}"
    assert "Alpha Case" in tts[1], f"tour must follow the summary: {tts[:3]}"
    page.wait_for_function("document.querySelector(\"#listen-btn\") && document.querySelector(\"#listen-btn\").textContent.trim() === \"Stop\"", timeout=15000)
    page.locator("#listen-btn").click()
    page.wait_for_function("document.querySelector(\"#listen-btn\").textContent.trim() === \"Listen\"", timeout=15000)
    ctx.close()


def test_tour_controls_vertical_stack_middle_edge(base, browser):
    ctx, page = open_page(browser, base, "/", 390)
    page.wait_for_selector("#tour-controls button", timeout=30000)
    page.wait_for_timeout(600)
    bar = page.locator("#tour-controls")
    kinds = bar.locator("button").evaluate_all("els => els.map(e => e.dataset.tour)")
    assert kinds == ["prev", "play", "next"], kinds
    boxes = bar.locator("button").evaluate_all("els => els.map(e => { const r=e.getBoundingClientRect(); return {x:r.x, y:r.y, w:r.width, h:r.height}; })")
    assert all(b["w"] >= 43 and b["h"] >= 43 for b in boxes), f"tour targets must be >=44px: {boxes}"
    ys = [b["y"] for b in boxes]
    assert ys[0] < ys[1] < ys[2], f"tour controls must stack vertically (prev, play, next): {boxes}"
    assert abs(boxes[0]["x"] - boxes[1]["x"]) < 8 and abs(boxes[1]["x"] - boxes[2]["x"]) < 8, boxes
    bb = bar.bounding_box(); mb = page.locator(".v2-mapwrap").bounding_box()
    cy = bb["y"] + bb["height"] / 2 - mb["y"]
    assert mb["height"] * 0.25 < cy < mb["height"] * 0.8, f"stack must sit at the middle edge, not bottom-center: {bb} vs {mb}"
    assert bb["x"] + bb["width"] > mb["x"] + mb["width"] - 90, f"stack must hug the right edge: {bb} vs {mb}"
    stop = page.locator("[data-tour-stop]").first.bounding_box()
    assert stop and stop["y"] >= boxes[2]["y"], "Stop n of N sits under the buttons in the stack"
    ctx.close()


def test_pin_tap_opens_slim_preview_not_big_card(base, browser):
    for w in (390, 1440):
        ctx, page = _ask(browser, base, w)
        if w == 390:
            page.locator("[data-pane=\"map\"]").click(); page.wait_for_timeout(500)
        pt = page.evaluate("""() => { const tags=[...document.querySelectorAll(".v2-mapwrap div")].filter(d=>d.textContent.includes("Colorado Supreme Court") && d.offsetWidth>20 && d.offsetWidth<260); if(!tags.length) return null; const r=tags[0].getBoundingClientRect(); return {x:r.x+r.width/2, y:r.bottom + r.height*0.4}; }""")
        assert pt, f"no pin tag at {w}"
        page.mouse.click(pt["x"], pt["y"])
        page.wait_for_selector("#pin-preview:visible", timeout=15000)
        doc = page.evaluate("() => { const d=document.querySelector(\"#docpanel\"); return d && !d.classList.contains(\"hidden\") && getComputedStyle(d).display!==\"none\"; }")
        assert not doc, f"pin tap must not open the big card at {w}"
        ctx.close()


def test_explain_text_has_no_cited_by_numbered_ref(base, browser):
    ctx, page = _ask(browser, base, 1440)
    txt = page.evaluate("""() => { const fx={answer: "Short answer: x [1]", question: "q"}; Docs3D.ctx={answer:fx.answer, question:fx.question};
      const cites=[{id:"Alpha Case, 1 P.3d 1",title:"Alpha Case",court:"Colorado Supreme Court",date:"2001-01-01",ref:"[1]",passage:"Background only."},{id:"Beta Case, 2 P.3d 2",title:"Beta Case",court:"Colorado Supreme Court",date:"2002-02-02",ref:"[2]",passage:"Alpha Case states the governing rule for vehicle searches in Colorado courts today. The court explained the rule in detail for drivers on Colorado roads."}];
      Docs3D.show(cites,[{src:"Beta Case, 2 P.3d 2",dst:"Alpha Case, 1 P.3d 1"}],[]); Docs3D.stopTour(); return Docs3D.explainText(0); }""")
    assert "Cited by" not in txt or not re.search(r"Cited by \[\d+\]", txt), txt
    assert not re.search(r"\[\d+\]", txt), f"numbered refs must not appear in stop text: {txt}"
    ctx.close()
