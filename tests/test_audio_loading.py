"""'Audio loading…' indicator for TTS (tour, summary, Listen).
Offline: pytest -q tests/test_audio_loading.py   (static checks + Playwright against local static files, fake /api/tts_ts)
Live:    LIVE_BASE=https://arize.design-bakery.com LIVE_RUN=<run id> pytest -q tests/test_audio_loading.py   (also checks the served JS + real /map tour)"""

import base64, io, os, re, struct, wave, pathlib, pytest, urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
STATIC = ROOT / "static"
LIVE = os.environ.get("LIVE_BASE", "").rstrip("/")
ARGS = ["--autoplay-policy=no-user-gesture-required", "--no-sandbox", "--use-gl=swiftshader", "--enable-unsafe-swiftshader"]
LOADING, FAIL = "Audio loading…", "Audio unavailable — continuing"


def src(name):
    return (STATIC / name).read_text()


# ---------- static checks (no browser) ----------
def test_audio_js_has_indicator_and_hooks():
    a = src("audio.js")
    assert "audio-status" in a and 'role","status"' in a.replace("'", '"') or 'role="status"' in a
    assert LOADING in a and FAIL in a
    assert '"playing"' in a  # hidden only once playback actually starts
    assert re.search(r"AUDIO_TIMEOUT_MS\s*=\s*8000", a)
    assert "never two at once" in a  # one-audio-at-a-time rule kept


def test_map3d_tour_hooks_fallback():
    m = src("map3d.js")
    assert "AudioMgr.loadCancel" in m  # pausing the tour hides the indicator
    assert "S.fallback" in m  # captions keep advancing when audio fails/times out
    assert 'localStorage.getItem("mapVoice")==="1"' not in m  # voice on by default


def test_script_tags_cache_busted():
    for page in ("index.html", "map.html"):
        h = src(page)
        assert re.search(r'/static/audio\.js\?v=\w+', h), page
        assert re.search(r'/static/map3d\.js\?v=\w+', h), page


# ---------- Playwright (local static files, fake TTS) ----------
pw = pytest.importorskip("playwright.sync_api")


def _wav_b64(sec=1.0, rate=8000):
    b = io.BytesIO()
    w = wave.open(b, "wb")
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(rate)
    w.writeframes(struct.pack("<h", 0) * int(sec * rate))
    w.close()
    return base64.b64encode(b.getvalue()).decode()


HANG_JS = (
    "(()=>{const f=window.fetch;window.fetch=function(u,o){if(String(u&&u.url||u).includes('/api/tts'))return new Promise((_,rej)=>"
    "o&&o.signal&&o.signal.addEventListener('abort',()=>rej(new DOMException('aborted','AbortError'))));return f.apply(this,arguments)}})();"
)

SLOW_JS = (
    "(()=>{const f=window.fetch;window.fetch=function(u,o){const a=arguments;if(String(u&&u.url||u).includes('/api/tts'))"
    "return new Promise(r=>setTimeout(r,1500)).then(()=>f.apply(this,a));return f.apply(this,a)}})();"
)


@pytest.fixture(scope="module")
def browser():
    with pw.sync_playwright() as p:
        b = p.chromium.launch(args=ARGS)
        yield b
        b.close()


def harness(browser, tts, init=None):
    """tts: 'slow' (1.2s then audio), 'hang' (never answers), 'error' (500)."""
    ctx = browser.new_context()
    pg = ctx.new_page()
    errs = []
    if tts == "hang":
        pg.add_init_script(HANG_JS)
    if tts == "slow":
        pg.add_init_script(SLOW_JS)  # Fish-like latency, in-page so Python never blocks                 # TTS request never answers (until aborted)
    if init:
        pg.add_init_script(init)
    pg.on("pageerror", lambda e: errs.append(str(e)))

    def route(r):
        u = r.request.url
        if u.endswith("/"):
            return r.fulfill(
                content_type="text/html; charset=utf-8",
                body='<!doctype html><html><head><script src="/static/audio.js"></script></head><body><button id="play" data-abtn="play" data-label="Listen" class="abtn"></button></body></html>',
            )
        if "/static/" in u:
            return r.fulfill(content_type="text/javascript; charset=utf-8", body=src(u.split("/static/")[1].split("?")[0]))
        if "/api/tts" in u:
            if tts == "error":
                return r.fulfill(status=500, body="x")
            return r.fulfill(content_type="application/json", body='{"audio_b64":"%s","starts":[]}' % _wav_b64())
        r.fulfill(status=404, body="")

    pg.route("http://precedent.test/**", route)
    pg.goto("http://precedent.test/")
    pg.errs = errs
    return pg


def status(pg):
    return pg.evaluate(
        "(()=>{const e=document.getElementById('audio-status'); return e&&getComputedStyle(e).display!=='none'&&!e.hidden ? e.innerText.trim() : ''})()"
    )


def test_loading_shows_until_playing_then_hides(browser):
    pg = harness(browser, "slow")
    pg.evaluate("void (()=>{ window.__p=AudioMgr.say('hello there counsel', document.getElementById('play')).then(()=>window.__done=1) })()")
    pg.wait_for_timeout(300)
    assert LOADING in status(pg)
    assert pg.evaluate("!!document.querySelector('#audio-status .as-spin')")
    pg.wait_for_function("AudioMgr.instances().some(a=>!a.paused&&a.currentTime>0)", timeout=8000)  # actually playing
    pg.wait_for_timeout(250)
    assert status(pg) == ""
    assert pg.errs == []


def test_timeout_shows_unavailable_and_continues(browser):
    pg = harness(browser, "hang")
    pg.evaluate("void (()=>{ window.__done=0; AudioMgr.say('hello there counsel').then(()=>window.__done=1) })()")
    pg.wait_for_timeout(1000)
    assert LOADING in status(pg)
    pg.wait_for_function("window.__done===1", timeout=11000)  # caller is released (~8s) so the tour keeps going
    assert FAIL in status(pg)
    pg.wait_for_timeout(4000)
    assert status(pg) == ""  # notice auto-hides


def test_error_shows_unavailable(browser):
    pg = harness(browser, "error")
    pg.evaluate("window.speechSynthesis && (speechSynthesis.speak=u=>setTimeout(()=>u.onend&&u.onend(),0)); fetch('/api/tts_ts',{method:'POST'}).catch(()=>{})")
    pg.wait_for_function(f"(document.getElementById('audio-status')||{{}}).innerText?.includes('{FAIL}')", timeout=5000)


def test_stop_hides_indicator(browser):
    pg = harness(browser, "hang")
    pg.evaluate("void (()=>{ AudioMgr.say('hello there counsel') })()")
    pg.wait_for_timeout(400)
    assert LOADING in status(pg)
    pg.evaluate("AudioMgr.stopAll()")
    pg.wait_for_timeout(100)
    assert status(pg) == ""


def test_one_audio_at_a_time(browser):
    pg = harness(browser, "slow")
    b = _wav_b64(3)
    n = pg.evaluate(
        """async b=>{ const mk=()=>{const s=atob(b),u=new Uint8Array(s.length);for(let k=0;k<s.length;k++)u[k]=s.charCodeAt(k);return new Audio(URL.createObjectURL(new Blob([u],{type:'audio/wav'})));};
      const a=mk(), c=mk(); await a.play(); await c.play(); return [a,c].filter(x=>!x.paused).length; }""",
        b,
    )
    assert n == 1


def test_hides_when_audio_already_playing_before_listener(browser):
    # 'playing' fired before anyone listened (cached/blob audio): the indicator must still clear
    pg = harness(browser, "hang")
    b = _wav_b64(2)
    pg.evaluate("void (()=>{ fetch('/api/tts_ts',{method:'POST'}).catch(()=>{}) })()")
    pg.wait_for_timeout(300)
    assert LOADING in status(pg)
    pg.evaluate(
        """b=>{const s=atob(b),u=new Uint8Array(s.length);for(let k=0;k<s.length;k++)u[k]=s.charCodeAt(k);
      const a=document.createElement('audio'); a.src=URL.createObjectURL(new Blob([u],{type:'audio/wav'})); document.body.appendChild(a);
      HTMLMediaElement.prototype.play.call(a); }""",
        b,
    )
    pg.wait_for_function("[...document.querySelectorAll('audio')].some(a=>a.currentTime>0)", timeout=5000)
    pg.wait_for_timeout(400)
    assert status(pg) == ""


def test_speech_fallback_start_hides(browser):
    pg = harness(
        browser,
        "error",
        init="window.SpeechSynthesisUtterance=class extends EventTarget{constructor(t){super();this.text=t}};"
        "Object.defineProperty(window,'speechSynthesis',{value:{speaking:false,cancel(){},speak(u){setTimeout(()=>{u.dispatchEvent(new Event('start'));u.onstart&&u.onstart();},1500)}}});",
    )
    pg.evaluate("void (()=>{ AudioMgr.say('hello there counsel') })()")
    pg.wait_for_timeout(300)
    assert LOADING in status(pg)
    pg.wait_for_timeout(2500)
    assert status(pg) == ""


def test_latest_request_owns_indicator(browser):
    pg = harness(browser, "hang")
    pg.evaluate("const t1=AudioMgr.loadStart(); const t2=AudioMgr.loadStart(); AudioMgr.loadDone(t1)")
    pg.wait_for_timeout(100)
    assert LOADING in status(pg)  # stale token can't hide the newer request
    pg.evaluate("AudioMgr.loadCancel()")
    pg.wait_for_timeout(100)
    assert status(pg) == ""


def test_sound_on_by_default_old_mute_ignored(browser):
    pg = harness(browser, "slow", init="localStorage.setItem('precedent.mute','1');localStorage.setItem('mapVoice','0');")
    assert pg.evaluate("AudioMgr.isMuted()") is False
    pg.evaluate("AudioMgr.setMuted(true)")
    pg.reload()
    assert pg.evaluate("AudioMgr.isMuted()") is True  # manual mute still sticks


def test_first_interaction_unlocks_audio(browser):
    pg = harness(browser, "slow")
    assert pg.evaluate("AudioMgr.unlocked") is False
    pg.keyboard.press("a")
    pg.wait_for_timeout(100)
    assert pg.evaluate("AudioMgr.unlocked") is True


# ---------- live site ----------
@pytest.mark.skipif(not LIVE, reason="set LIVE_BASE to check the deployed site")
def test_live_serves_new_js():
    html = urllib.request.urlopen(LIVE + "/map").read().decode()
    for name in ("audio.js", "map3d.js"):
        m = re.search(r'/static/%s\?v=\w+' % re.escape(name), html)
        assert m, name
        js = urllib.request.urlopen(LIVE + m.group(0)).read().decode()
        assert (LOADING in js) if name == "audio.js" else ("S.fallback" in js)


@pytest.mark.skipif(not LIVE, reason="set LIVE_BASE to check the deployed site")
def test_live_tour_continues_when_tts_hangs(browser):
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    pg = ctx.new_page()
    pg.add_init_script("localStorage.setItem('mapVoice','1');localStorage.setItem('precedent.mute','0');")
    pg.add_init_script(HANG_JS)  # TTS never answers
    if os.environ.get("LOCAL_STATIC"):  # pre-deploy: live backend + this checkout's static files
        pg.route(LIVE + "/static/**", lambda r: r.fulfill(path=str(STATIC / r.request.url.split("/static/")[1].split("?")[0])))
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(LIVE + "/map")
    run = os.environ.get("LIVE_RUN")  # fresh sessions have no runs listed; load a known one
    if run:
        pg.wait_for_function("!!(window.Docs3D&&Docs3D.view)", polling=500, timeout=60000)
        pg.evaluate("id=>void load(id)", run)
    pg.wait_for_function(f"(document.getElementById('audio-status')||{{}}).innerText?.includes('{LOADING}')", polling=500, timeout=30000)
    pg.wait_for_function(f"(document.getElementById('audio-status')||{{}}).innerText?.includes('{FAIL}')", polling=500, timeout=15000)
    # tour still runs: caption appears and its text advances without audio
    pg.wait_for_function(
        "(()=>{const t=document.getElementById('transcript');return t&&!t.classList.contains('hidden')&&t.innerText.length>20})()", polling=500, timeout=30000
    )
    a = pg.evaluate("document.getElementById('transcript').innerText")
    pg.wait_for_timeout(15000)
    b = pg.evaluate("document.getElementById('transcript').innerText")
    assert a != b
    assert errs == []
