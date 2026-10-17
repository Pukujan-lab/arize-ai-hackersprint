"""The guided tour starts at stop 1 (source [1]) right after the memo, and walks the sources in [n] order.

Root cause (issue #64): Docs3D.order() only kept sources whose passage yields a "holding" sentence (or that another
source cites) and sorted those first. Its sentence splitter breaks on "v." and "e.g.", so for the example question
source [1] People v. Chamberlain has no holding, is dropped, and the tour opened on [2]. Sources the memo itself
cites ([1], [3], [7]) were skipped. Separately, Docs3D.show() arms its own autostart timer; on the home page the
"ranked" feed event calls show() a second time after render() has already started the memo, so a silent caption
tour walked stops 1 and 2 while the memo was still playing.

Offline (local app, fake LLM):  pytest -q tests/test_tour_starts_at_stop1.py
Live after deploy:              LIVE_BASE=https://arize.design-bakery.com RUN_LIVE=1 pytest -q -s tests/test_tour_starts_at_stop1.py"""

import contextlib
import json
import os
import pathlib
import re
import socket
import subprocess
import sys
import time
import urllib.request

import pytest

ROOT = pathlib.Path(__file__).resolve().parent.parent
FIXTURE = json.loads((pathlib.Path(__file__).resolve().parent / "fixtures" / "tour_stop1_run.json").read_text())
LIVE_BASE = os.environ.get("LIVE_BASE", "").rstrip("/")

try:
    from playwright.sync_api import sync_playwright
except ImportError:  # CI gates job has no Playwright
    sync_playwright = None


def _free_port():
    with contextlib.closing(socket.socket()) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@contextlib.contextmanager
def _local_app():
    (ROOT / "runs").mkdir(exist_ok=True)
    port = _free_port()
    env = dict(os.environ, LLM_MODE="fake", ACS_HOTLOAD="0")
    cmd = [sys.executable, "-m", "uvicorn", "app.server:app", "--port", str(port), "--log-level", "warning"]
    proc = subprocess.Popen(cmd, cwd=ROOT, env=env)
    url = f"http://127.0.0.1:{port}"
    try:
        for _ in range(150):
            try:
                urllib.request.urlopen(url + "/api/health", timeout=1)
                break
            except OSError:
                time.sleep(0.2)
        yield url
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:  # open keep-alive connections from the browser
            proc.kill()
            proc.wait(timeout=10)


@pytest.fixture(scope="module")
def browser():
    if sync_playwright is None:
        pytest.skip("playwright not installed")
    with sync_playwright() as p:
        try:
            b = p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required", "--use-gl=swiftshader", "--enable-unsafe-swiftshader"])
        except Exception as e:  # noqa: BLE001 - browser binary missing
            pytest.skip(f"chromium unavailable: {e}")
        yield b
        b.close()


@pytest.fixture(scope="module")
def base():
    if os.environ.get("UI_BASE_URL"):  # e.g. the live site
        yield os.environ["UI_BASE_URL"].rstrip("/")
        return
    with _local_app() as url:
        yield url


def _map_page(browser, base):
    ctx = browser.new_context(viewport={"width": 1280, "height": 800}, user_agent="Mozilla/5.0 (Macintosh) Chrome/130 Safari/537.36")
    pg = ctx.new_page()
    pg.goto(base + "/map", wait_until="load")
    pg.wait_for_function("!!(window.Docs3D&&Docs3D.view&&Docs3D.order)", polling=200, timeout=30000)
    pg.wait_for_timeout(500)
    # quiet: no featured-run tour or memo running underneath the test
    pg.evaluate("()=>{ try{ clearTimeout(window.show&&show._t); }catch(e){} Docs3D.stopTour(); AudioMgr.stopAll(); }")
    return pg


def _ref_num(r):
    return int(re.sub(r"\D", "", r))


ORDER_JS = """(a)=>{ Docs3D.ctx={answer:a.answer,question:a.question}; Docs3D.show(a.citations,a.edges,a.documents||[]); Docs3D.stopTour();
  return Docs3D.order().map(k=>Docs3D._c[k].ref); }"""


def _check_order(refs):
    assert refs, "tour has no stops"
    assert refs[0] == "[1]", f"tour must start at source [1], got {refs}"
    nums = [_ref_num(r) for r in refs]
    assert nums == sorted(nums), f"tour stops must follow [n] order, got {refs}"
    memo_refs = sorted(set(re.findall(r"\[\d+\]", FIXTURE["answer"])), key=_ref_num)
    missing = [r for r in memo_refs if r not in refs]
    assert not missing, f"sources cited in the memo are skipped by the tour: {missing} (tour {refs})"


@pytest.mark.parametrize("source", ["result", "ranked_event"])
def test_tour_starts_at_source_1_and_keeps_ref_order(browser, base, source):
    """Both the final result and the earlier 'ranked' event (passages cut at 600 chars, no documents) give stop 1 = [1]."""
    data = FIXTURE if source == "result" else FIXTURE[source]
    pg = _map_page(browser, base)
    refs = pg.evaluate(
        ORDER_JS,
        {
            "answer": FIXTURE["answer"],
            "question": FIXTURE["question"],
            "citations": data["citations"],
            "edges": data["edges"],
            "documents": data.get("documents", []),
        },
    )
    _check_order(refs)


def test_show_does_not_autostart_tour_while_memo_holds_voice(browser, base):
    """While the memo is speaking (holdVoice / awaitSummary), a repeat Docs3D.show() must not start a silent tour."""
    pg = _map_page(browser, base)
    pg.evaluate(
        """(r)=>{ window.__focus=[]; const f=Docs3D.focus; Docs3D.focus=function(k){ window.__focus.push(k); return f.apply(this,arguments); };
             Docs3D.ctx={answer:r.answer,question:r.question}; Docs3D.holdVoice=true; Docs3D.show(r.citations,r.edges,r.documents); }""",
        FIXTURE,
    )
    pg.wait_for_timeout(4500)  # autostart timer is 1.0-2.2 s
    moved = pg.evaluate("window.__focus.length")
    pg.evaluate("Docs3D.holdVoice=false")
    assert moved == 0, "tour advanced to a stop while the memo still held the voice"


def test_home_ranked_feed_after_render_keeps_stop_1_and_no_tour_during_memo(browser, base):
    """Home page (v1 at /v1): render() starts the memo, then the activity feed replays the 'ranked' event for the same run.
    That must not swap in the cut-down citations (dropping [1]) nor start a silent tour while the memo plays."""
    ctx = browser.new_context(viewport={"width": 1280, "height": 800}, user_agent="Mozilla/5.0 (Macintosh) Chrome/130 Safari/537.36")
    pg = ctx.new_page()
    pg.goto(base + "/v1", wait_until="load")
    pg.wait_for_function("!!(window.Docs3D&&Docs3D.tour)&&typeof render==='function'&&typeof FEED==='object'", polling=200, timeout=30000)
    pg.wait_for_timeout(1500)  # let the page finish its own start-up (featured run, voice init)
    pg.evaluate("()=>{ Docs3D.stopTour(); AudioMgr.stopAll(); if(AudioMgr.isMuted()) AudioMgr.setMuted(false); Docs3D.voice=true; }")
    pg.evaluate(
        """(fx)=>{ window.__focus=[]; const f=Docs3D.focus; Docs3D.focus=function(k){ window.__focus.push(k); return f.apply(this,arguments); };
             window.__memo=0; AudioMgr.say=function(){ window.__memo=1; Docs3D.holdVoice=true; Docs3D.stopTour(); return new Promise(()=>{}); };  // memo still playing
             const r=Object.assign({}, fx, {run_id: fx.run_id}); delete r.ranked_event; render(r); Docs3D.holdVoice=true;  // memo playing
             setTimeout(()=>{ FEED.q.push([Object.assign({}, fx.ranked_event), fx.run_id]); feedDrain(); }, 1200); }""",
        FIXTURE,
    )
    pg.wait_for_timeout(5000)
    st = pg.evaluate("()=>({memo: window.__memo, focus: window.__focus.length, refs: Docs3D.order().map(k=>Docs3D._c[k].ref)})")
    assert st["focus"] == 0, f"tour moved to a stop while the memo was still playing: {st}"
    _check_order(st["refs"])


@pytest.mark.live
@pytest.mark.skipif(not LIVE_BASE, reason="set LIVE_BASE to the deployed site")
def test_live_stop_1_narrates_right_after_memo(browser):
    """Home page (v1 at /v1), example question: memo plays to the end, then the first tour clip is source [1]."""
    ctx = browser.new_context(viewport={"width": 1280, "height": 800}, user_agent="Mozilla/5.0 (Macintosh) Chrome/130 Safari/537.36")
    ctx.add_init_script(
        """(()=>{ window.HEARD=[]; const P=HTMLMediaElement.prototype.play; HTMLMediaElement.prototype.play=function(){ const a=this;
          if(!a._h&&a.volume!==0){ a._h=1; const e={cap:'',start:0,end:0,t:0,dur:0};
            a.addEventListener('playing',()=>{ if(e.start) return; const T=document.getElementById('transcript'); e.cap=T&&!T.classList.contains('hidden')?T.innerText.slice(0,40):''; e.start=performance.now(); e.dur=a.duration; HEARD.push(e); });
            a.addEventListener('ended',()=>{ e.end=performance.now(); e.t=a.currentTime; }); }
          return P.apply(this,arguments); }; })()"""
    )
    pg = ctx.new_page()
    pg.goto(LIVE_BASE + "/v1", wait_until="load")
    pg.wait_for_function("!!(window.Docs3D&&Docs3D.tour)", polling=300, timeout=60000)
    pg.mouse.click(5, 5)
    pg.fill("#q", FIXTURE["question"])
    pg.click("#go")
    t0 = time.time()
    while time.time() - t0 < 150 and len(pg.evaluate("HEARD")) < 2:
        pg.wait_for_timeout(1000)
    heard = pg.evaluate("HEARD")
    for h in heard:
        print("HEARD", h)
    assert len(heard) >= 2, heard
    memo, stop1 = heard[0], heard[1]
    assert memo["end"] and memo["t"] >= memo["dur"] - 0.2, memo  # memo played to the end
    assert stop1["start"] >= memo["end"] - 50, (memo, stop1)  # tour voice only after the memo
    assert stop1["cap"].lstrip().startswith("[1]"), f"first tour clip after the memo must be stop 1 ([1]): {heard}"
