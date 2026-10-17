"""Sequential audio queue: a new clip waits for the current one to END (never cuts it); only Stop/Mute/new question/skip interrupt.
Offline: pytest -q tests/test_audio_queue.py
Live full flow (ask -> summary -> tour, logs play/ended): LIVE_BASE=https://arize.design-bakery.com pytest -q tests/test_audio_queue.py -k live -s"""

import os, time, pytest
from test_audio_loading import harness, _wav_b64, src, ARGS, STATIC

try:  # static checks still run in CI without Playwright; browser tests skip
    from playwright import sync_api as pw
except ImportError:
    pw = None
LIVE = os.environ.get("LIVE_BASE", "").rstrip("/")

MK = """window.mk=(b,name)=>{const s=atob(b),u=new Uint8Array(s.length);for(let k=0;k<s.length;k++)u[k]=s.charCodeAt(k);
  const a=new Audio(URL.createObjectURL(new Blob([u],{type:'audio/wav'}))); a._n=name; window.LOG=window.LOG||[];
  ['playing','pause','ended'].forEach(e=>a.addEventListener(e,()=>LOG.push([name,e,+a.currentTime.toFixed(2),+(a.duration||0).toFixed(2)]))); return a;};"""


@pytest.fixture(scope="module")
def browser():
    if pw is None:
        pytest.skip("playwright not installed")
    with pw.sync_playwright() as p:
        b = p.chromium.launch(args=ARGS)
        yield b
        b.close()


def cuts(log):
    """a 'pause' well before the end of the clip that wasn't followed by its 'ended' = cut off"""
    return [e for e in log if e[1] == "pause" and e[3] and e[2] < e[3] - 0.15]


def test_static_hooks():
    a, m, h = src("audio.js"), src("map3d.js"), src("map.html")
    assert "queue" in a and "epoch" in a
    assert "X-Prefetch" in m  # next stop's clip is prefetched (no play, no stop)
    assert "{queue:true}" in h  # auto summary queues instead of interrupting


def test_second_clip_waits_for_first_to_end(browser):
    pg = harness(browser, "slow")
    pg.evaluate(MK)
    pg.evaluate("b=>{ window.A=mk(b,'A'); window.B=mk(b,'B'); A.play(); setTimeout(()=>B.play(),300); }", _wav_b64(1.2))
    pg.wait_for_timeout(700)
    assert pg.evaluate("!A.paused && B.paused"), "B must wait, A must keep playing"
    pg.wait_for_function("window.LOG.some(e=>e[0]==='B'&&e[1]==='ended')", timeout=6000)
    log = pg.evaluate("LOG")
    order = [(n, e) for n, e, *_ in log]
    assert order.index(("A", "ended")) < order.index(("B", "playing")), log
    assert cuts(log) == [], log


def test_never_two_playing_at_once(browser):
    pg = harness(browser, "slow")
    pg.evaluate(MK)
    pg.evaluate(
        "b=>{ window.A=mk(b,'A'); window.B=mk(b,'B'); window.MAX=0; A.play(); B.play(); const t=setInterval(()=>{ MAX=Math.max(MAX,[A,B].filter(x=>!x.paused&&!x.ended).length) },20); setTimeout(()=>clearInterval(t),3500); }",
        _wav_b64(1),
    )
    pg.wait_for_timeout(3600)
    assert pg.evaluate("MAX") == 1


def test_stop_drops_queued_stale_clip(browser):
    pg = harness(browser, "slow")
    pg.evaluate(MK)
    pg.evaluate("b=>{ window.A=mk(b,'A'); window.B=mk(b,'B'); A.play(); setTimeout(()=>B.play(),200); setTimeout(()=>AudioMgr.stopAll(),500); }", _wav_b64(1))
    pg.wait_for_timeout(3000)
    assert pg.evaluate("B.currentTime") == 0 and pg.evaluate("!LOG.some(e=>e[0]==='B'&&e[1]==='playing')")


def test_speech_waits_for_clip(browser):
    pg = harness(
        browser,
        "slow",
        init="window.SAID=[];window.SpeechSynthesisUtterance=class extends EventTarget{constructor(t){super();this.text=t}};"
        "Object.defineProperty(window,'speechSynthesis',{value:{speaking:false,cancel(){},speak(u){SAID.push(performance.now());setTimeout(()=>u.onend&&u.onend(),10)}}});",
    )
    pg.evaluate(MK)
    pg.evaluate("b=>{ window.A=mk(b,'A'); A.play(); setTimeout(()=>speechSynthesis.speak(new SpeechSynthesisUtterance('hi')),200); }", _wav_b64(1.2))
    pg.wait_for_timeout(600)
    assert pg.evaluate("SAID.length") == 0 and pg.evaluate("!A.paused")
    pg.wait_for_function("SAID.length===1", timeout=4000)


def test_queued_say_does_not_cut(browser):
    pg = harness(browser, "slow")
    pg.evaluate(MK)
    pg.evaluate("b=>{ window.A=mk(b,'A'); A.play(); AudioMgr.say('summary line here',null,{queue:true}); }", _wav_b64(2.5))
    pg.wait_for_timeout(2000)  # TTS arrives at ~1.5s while A still playing
    assert pg.evaluate("!A.paused"), "queued summary must not cut the current clip"
    pg.wait_for_function("LOG.some(e=>e[0]==='A'&&e[1]==='ended')", timeout=5000)


# ---------- live: the real flow ----------
LOGJS = """(()=>{window.ALOG=[];const P=HTMLMediaElement.prototype.play;let n=0;HTMLMediaElement.prototype.play=function(){const a=this;
 if(!a._id&&!(a.volume===0)){a._id=++n;['playing','pause','ended'].forEach(e=>a.addEventListener(e,()=>ALOG.push([a._id,e,+a.currentTime.toFixed(2),+(a.duration||0).toFixed(2),Math.round(performance.now())])));}
 return P.call(this)};})();"""


@pytest.mark.skipif(not LIVE, reason="set LIVE_BASE")
def test_live_full_flow_nothing_cut(browser):
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    if os.environ.get("LOCAL_STATIC"):
        pg.route(LIVE + "/static/**", lambda r: r.fulfill(path=str(STATIC / r.request.url.split("/static/")[1].split("?")[0])))
        pg.route(LIVE + "/map", lambda r: r.fulfill(path=str(STATIC / "map.html")))
    T0 = time.time()
    req = {}
    pg.on("request", lambda r: "/api/tts" in r.url and req.__setitem__(id(r), time.time()))
    pg.on(
        "requestfinished",
        lambda r: (
            "/api/tts" in r.url
            and print(
                "TTS",
                r.headers.get("x-prefetch") and "prefetch" or "request",
                "%.1fs" % (time.time() - req.get(id(r), time.time())),
                "at %.1f" % (time.time() - T0),
            )
        ),
    )
    pg.on("requestfailed", lambda r: "/api/tts" in r.url and print("TTS FAILED", r.failure, "at %.1f" % (time.time() - T0)))
    pg.goto(LIVE + "/map")
    pg.wait_for_function("!!(window.Docs3D&&Docs3D.view)", polling=500, timeout=60000)
    pg.evaluate(LOGJS)  # after audio.js patched play, so we see the real element events
    if os.environ.get("TRACE"):
        pg.on("console", lambda m: m.text.startswith("TRACE") and print(m.text[:900]))
        pg.evaluate("""(()=>{const M=AudioMgr,s=M.stopAll;M.stopAll=function(f){console.log('TRACE stopAll',f,performance.now()|0,new Error().stack);return s.apply(this,arguments)};
          const y=M.say;M.say=function(t,b,o){console.log('TRACE say',JSON.stringify(o),performance.now()|0,new Error().stack);return y.apply(this,arguments)};
          const st=Docs3D.stopTour;Docs3D.stopTour=function(x){console.log('TRACE stopTour',x,performance.now()|0);return st.apply(this,arguments)};
          const tu=Docs3D.tour;Docs3D.tour=function(x){console.log('TRACE tour',x,performance.now()|0,new Error().stack);return tu.apply(this,arguments)};})()""")
    pg.fill("#q", os.environ.get("LIVE_Q", "Water rights priority dispute between ranchers"))
    pg.evaluate("void document.getElementById('f').requestSubmit()")
    t0 = time.time()
    seen = 0
    while time.time() - t0 < float(os.environ.get("LIVE_SECS", "150")):
        pg.wait_for_timeout(3000)
        log = pg.evaluate("ALOG")
        for e in log[seen:]:
            print("AUDIO", e)
        seen = len(log)
        if sum(1 for e in log if e[1] == "ended") >= int(os.environ.get("LIVE_CLIPS", "4")):
            break
    log = pg.evaluate("ALOG")
    assert sum(1 for e in log if e[1] == "ended") >= 2, log  # summary + at least one tour stop finished
    assert cuts(log) == [], log
    # never two clips at once: each clip's playing comes after the previous clip's ended
    starts = [e for e in log if e[1] == "playing"]
    ends = {e[0]: e[4] for e in log if e[1] == "ended"}
    for prev, nxt in zip(starts, starts[1:]):
        if prev[0] in ends:
            assert ends[prev[0]] <= nxt[4] + 50, (prev, nxt)  # next starts only after the previous ended
    assert errs == []
