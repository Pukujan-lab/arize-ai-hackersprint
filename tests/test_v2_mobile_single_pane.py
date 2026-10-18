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
