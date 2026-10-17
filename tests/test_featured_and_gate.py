"""(1) Tour narration waits for the answer summary (stop 1 never heard twice). (2) New visitors see a featured demo run.
Offline: pytest -q tests/test_featured_and_gate.py
Live:    LIVE_BASE=https://arize.design-bakery.com [LOCAL_STATIC=1] pytest -q -s tests/test_featured_and_gate.py"""

import json
import os
import re
import time

import pytest
from test_audio_loading import ARGS, STATIC, src

try:  # static checks run without Playwright
    from playwright import sync_api as pw
except ImportError:
    pw = None
LIVE = os.environ.get("LIVE_BASE", "").rstrip("/")
FEATURED = STATIC / "featured-run.json"


def test_featured_run_file_is_a_good_cached_run():
    r = json.loads(FEATURED.read_text())
    assert r["answer"] and len(r["citations"]) >= 3 and r["question"]
    assert (r.get("safeguard") or {}).get("pass") is True
    assert "session_id" not in r and "prev_run_id" not in r  # no visitor's session leaks into the demo


def test_map_page_hooks():
    h, m = src("map.html"), src("map3d.js")
    assert "featured-run.json" in h  # empty session -> featured run
    assert "awaitSummary" in h and "awaitSummary" in m  # tour voice gated on summary completion
    vs = set(re.findall(r"/static/(?:audio|map3d|voice)\.js\?v=(\w+)", h + src("index.html")))
    assert len(vs) == 1 and vs != {"aq4"}, vs  # one bumped cache-bust version


@pytest.fixture(scope="module")
def browser():
    if pw is None:
        pytest.skip("playwright not installed")
    with pw.sync_playwright() as p:
        b = p.chromium.launch(args=ARGS)
        yield b
        b.close()


def live_page(browser):
    pg = browser.new_context(viewport={"width": 1440, "height": 900}).new_page()
    pg.errs = []
    pg.on("pageerror", lambda e: pg.errs.append(str(e)))
    if os.environ.get("LOCAL_STATIC"):  # pre-deploy: live backend + this checkout's static files
        pg.route(LIVE + "/static/**", lambda r: r.fulfill(path=str(STATIC / r.request.url.split("/static/")[1].split("?")[0])))
        pg.route(LIVE + "/map", lambda r: r.fulfill(path=str(STATIC / "map.html")))
    return pg


@pytest.mark.skipif(not LIVE, reason="set LIVE_BASE")
def test_live_new_visitor_sees_featured_run(browser):
    pg = live_page(browser)  # fresh context = brand-new session with no runs
    pg.goto(LIVE + "/map")
    pg.wait_for_function("!!(window.Docs3D&&Docs3D._c&&Docs3D._c.length>0)", polling=500, timeout=60000)
    pg.wait_for_function("document.getElementById('sum').innerText.length>60", polling=500, timeout=30000)
    assert "Featured" in pg.inner_text("#runs") and pg.errs == []


@pytest.mark.skipif(not LIVE, reason="set LIVE_BASE")
def test_live_summary_before_tour_no_repeat(browser):
    pg = live_page(browser)
    tts = []  # (time, text) of every non-prefetch narration request

    def on_req(r):
        if "/api/tts" in r.url and not r.headers.get("x-prefetch"):
            try:
                tts.append((time.time(), json.loads(r.post_data or "{}").get("text", "")))
            except ValueError:
                pass

    pg.on("request", on_req)
    pg.goto(LIVE + "/map")
    pg.wait_for_function("!!(window.Docs3D&&Docs3D.view)", polling=500, timeout=60000)
    pg.wait_for_timeout(3000)  # let the featured run start, so the ask has to interrupt it
    pg.fill("#q", os.environ.get("LIVE_Q", "Water rights priority dispute between ranchers"))
    pg.evaluate("void document.getElementById('f').requestSubmit()")
    tts.clear()  # ignore the featured run's narration; test the ask flow
    # what is on screen each time a clip actually starts playing ("Summary …" or the stop's citation)
    pg.evaluate("""(()=>{window.HEARD=[];const P=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=function(){const a=this;
      if(!a._h&&a.volume!==0){a._h=1;a.addEventListener('playing',()=>{const t=document.getElementById('transcript');HEARD.push((t&&t.innerText||'').slice(0,40))});}
      return P.call(this)};})()""")
    t0 = time.time()
    while time.time() - t0 < 120 and len(pg.evaluate("HEARD")) < 3:
        pg.wait_for_timeout(2000)
    heard = pg.evaluate("HEARD")
    print("HEARD:", heard)
    assert len(heard) >= 2 and heard[0].startswith("Summary"), heard  # summary first, then the tour
    assert len(heard) == len(set(heard)), heard  # no stop played twice
    summary = pg.evaluate("(window._sumText||'').slice(0,400)")
    texts = [t for _, t in tts]
    print("NARRATION ORDER:", [t[:50] for t in texts])
    assert texts and summary and texts[0] == summary, texts[:2]  # summary is the first thing heard
    assert len(texts) == len(set(texts)), texts  # stop 1 (or any line) never narrated twice
    assert pg.errs == []
