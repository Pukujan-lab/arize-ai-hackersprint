"""The memo/summary clip always plays to 'ended' before any tour stop narrates; no timer advances during a playing clip.
Offline: pytest -q tests/test_memo_then_tour.py
Live:    LIVE_BASE=https://arize.design-bakery.com [LOCAL_STATIC=1] pytest -q -s tests/test_memo_then_tour.py"""

import time

import pytest
from test_audio_loading import ARGS, FAIL, LOADING, harness, src, status
from test_featured_and_gate import LIVE, live_page, pw

SLOW12 = (  # uncached Fish: ~12 s before the clip arrives
    "(()=>{const f=window.fetch;window.fetch=function(u,o){const a=arguments;if(String(u&&u.url||u).includes('/api/tts'))"
    "return new Promise(r=>setTimeout(r,12000)).then(()=>f.apply(this,a));return f.apply(this,a)}})();"
)


@pytest.fixture(scope="module")
def browser():
    if pw is None:
        pytest.skip("playwright not installed")
    with pw.sync_playwright() as p:
        b = p.chromium.launch(args=ARGS)
        yield b
        b.close()


def test_static_hooks():
    a, m, h = src("audio.js"), src("map3d.js"), src("index.html")
    assert "X-Audio-Wait" in a  # memo/summary may load longer than the 8 s tour-stop rule
    assert "X-Audio-Wait" in h  # Listen (memo) on the home page too
    assert "stillPlaying" in m  # duration fallback never advances while the clip is still playing


def test_slow_memo_is_not_dropped_at_8s(browser):
    pg = harness(browser, "fast", init=SLOW12)
    pg.evaluate("void (()=>{ window.__done=0; AudioMgr.say('the memo summary line',null,{queue:true}).then(()=>window.__done=1) })()")
    pg.wait_for_timeout(9500)
    assert LOADING in status(pg)  # still waiting for the memo, not "unavailable"
    pg.wait_for_function("AudioMgr.instances().some(a=>a.currentTime>0)", timeout=8000)  # memo plays
    pg.wait_for_function("window.__done===1", timeout=8000)
    assert pg.evaluate("AudioMgr.instances().every(a=>a.ended||a.currentTime>=a.duration-0.05)")  # to the end


def test_tour_stop_keeps_8s_rule(browser):
    pg = harness(browser, "fast", init=SLOW12)
    pg.evaluate("void (()=>{ fetch('/api/tts_ts',{method:'POST'}).catch(()=>{}) })()")
    pg.wait_for_function(f"(document.getElementById('audio-status')||{{}}).innerText?.includes('{FAIL}')", timeout=10000)


HEARD_JS = """(()=>{window.HEARD=[];const P=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=function(){const a=this;
  if(!a._h&&a.volume!==0){a._h=1;const t=document.getElementById('transcript');const e={cap:'',start:0,end:0,t:0,dur:0};
   a.addEventListener('playing',()=>{e.cap=(document.getElementById('transcript')||{}).innerText?.slice(0,30)||'';e.start=performance.now();e.dur=a.duration;HEARD.push(e)});
   a.addEventListener('pause',()=>{e.end=performance.now();e.t=a.currentTime});}
  return P.call(this)};})()"""


@pytest.mark.skipif(not LIVE, reason="set LIVE_BASE")
@pytest.mark.parametrize("fresh", [True, False])
def test_live_memo_plays_to_end_before_tour(browser, fresh):
    pg = live_page(browser)
    pg.goto(LIVE + "/map")
    pg.wait_for_function("!!(window.Docs3D&&Docs3D.view)", polling=500, timeout=60000)
    q = "Automobile exception: probable cause standard in Colorado"
    if fresh:  # uncached memo -> slow Fish
        q = "Colorado automobile exception: when may police search a car without a warrant (%d)?" % int(time.time())
    pg.mouse.click(5, 5)
    pg.fill("#q", q)
    pg.evaluate("void document.getElementById('f').requestSubmit()")
    pg.evaluate(HEARD_JS)
    t0 = time.time()
    while time.time() - t0 < 180 and len([h for h in pg.evaluate("HEARD") if h["end"]]) < 2:
        pg.wait_for_timeout(2000)
    heard = pg.evaluate("HEARD")
    for h in heard:
        print("HEARD", h)
    assert len(heard) >= 2, heard
    memo, nxt = heard[0], heard[1]
    assert memo["cap"].startswith("Summary"), heard  # the memo is the first voice
    assert memo["t"] >= memo["dur"] - 0.2, memo  # ...and it played to the end
    assert nxt["start"] >= memo["end"] - 50, (memo, nxt)  # tour voice only after the memo ended
    assert not nxt["cap"].startswith("Summary"), heard  # memo not repeated as a stop
    for h in heard:  # no clip cut short
        if h["end"]:
            assert h["t"] >= h["dur"] - 0.2, h
    assert pg.errs == []
