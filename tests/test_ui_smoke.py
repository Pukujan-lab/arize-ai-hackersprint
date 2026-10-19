"""Headless Playwright UI suite for / and /map. Run: pytest -q tests/test_ui_smoke.py  (server on :3000)."""

import os, re, pytest
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://localhost:3000")
ARGS = ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required", "--no-sandbox"]
CACHED_Q = "Water rights priority dispute between ranchers"


@pytest.fixture(scope="module")
def browser():
    with sync_playwright() as p:
        b = p.chromium.launch(args=ARGS)
        yield b
        b.close()


def page(browser, path, storage=None, w=1440, h=900):
    ctx = browser.new_context(viewport={"width": w, "height": h})
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: m.type == "error" and not re.search(r"favicon|404|net::|Failed to load resource", m.text) and errs.append(m.text))
    if storage:
        pg.add_init_script("".join(f"localStorage.setItem({k!r},{v!r});" for k, v in storage.items()))
    pg.goto(BASE + path, wait_until="load")
    pg.errs = errs
    return pg


def ask_home(pg, q=CACHED_Q):
    pg.fill("#q", q)
    pg.click("#go")
    pg.wait_for_function("window.__total>0 && document.getElementById('cites').children.length>0", timeout=60000)


def wait_map(pg):
    pg.wait_for_function("window.Docs3D && Docs3D._c && Docs3D._c.length>0", timeout=30000)


# ---------- smoke ----------
def test_home_loads_no_errors(browser):
    pg = page(browser, "/")
    pg.wait_for_timeout(2500)
    assert pg.errs == []


def test_map_loads_no_errors_and_tour_autostarts(browser):
    pg = page(browser, "/map")
    wait_map(pg)
    pg.wait_for_function(
        "document.querySelector('#docs3d') && [...document.querySelectorAll('div')].some(d=>d.innerHTML.includes('Docs3D.replay()') && !d.classList.contains('hidden'))",
        timeout=20000,
    )
    assert pg.errs == []


def test_summary_renders(browser):
    pg = page(browser, "/map")
    wait_map(pg)
    pg.wait_for_function("document.getElementById('sum').innerText.length>60", timeout=20000)
    assert "references matched" in pg.inner_text("#sum") or "citation check" in pg.inner_text("#sum")


def test_single_full_opinion_link(browser):
    pg = page(browser, "/")
    ask_home(pg)
    counts = pg.evaluate(
        "[...document.getElementById('cites').children].map(el=>[...el.querySelectorAll('a')].filter(a=>/Full opinion/.test(a.textContent)).length)"
    )
    assert counts and all(c <= 1 for c in counts), counts


def test_mute_stops_all_audio(browser):
    pg = page(browser, "/map", {"precedent.mute": "0", "mapVoice": "1"})
    wait_map(pg)
    pg.wait_for_function("AudioMgr.playing()", timeout=30000)
    pg.click("[data-abtn=mute]")
    pg.wait_for_timeout(800)
    st = pg.evaluate("({p:AudioMgr.playing(), all:AudioMgr.instances().every(a=>a.paused), m:localStorage.getItem('precedent.mute')})")
    assert st == {"p": False, "all": True, "m": "1"}, st


def test_escape_stops_audio(browser):
    pg = page(browser, "/map", {"precedent.mute": "0", "mapVoice": "1"})
    wait_map(pg)
    pg.wait_for_function("AudioMgr.playing()", timeout=30000)
    pg.keyboard.press("Escape")
    pg.wait_for_timeout(600)
    assert pg.evaluate("AudioMgr.instances().every(a=>a.paused) && !AudioMgr.playing()")


def test_summary_speaker_plays_and_stops(browser):
    pg = page(browser, "/map", {"precedent.mute": "0", "mapVoice": "0"})
    wait_map(pg)
    pg.wait_for_function("document.getElementById('sum').innerText.length>60", timeout=20000)
    pg.evaluate("Docs3D.stopTour(); AudioMgr.stopAll()")
    pg.click("#sumplay")
    pg.wait_for_function("AudioMgr.playing()", timeout=20000)
    pg.click("#sumplay")
    pg.wait_for_timeout(500)
    assert not pg.evaluate("AudioMgr.playing()")


def test_voice_buttons_use_svg_icons(browser):
    pg = page(browser, "/map")
    wait_map(pg)
    pg.wait_for_timeout(500)
    txt = pg.evaluate(
        "[document.getElementById('sumplay'), document.querySelector('[data-abtn=mute]'), document.getElementById('vorb')].map(b=>b? b.innerText : 'MISSING').join('|')"
    )
    assert not re.search("[🔊🔇🎙⏳⏹👂💭]", txt), txt
    assert pg.evaluate(
        "[document.getElementById('sumplay'), document.querySelector('[data-abtn=mute]'), document.getElementById('vorb')].every(b=>b&&b.querySelector('svg')&&b.getAttribute('aria-label'))"
    )


def test_card_closes_on_new_search(browser):
    pg = page(browser, "/")
    ask_home(pg)
    pg.evaluate("Docs3D.open(Docs3D._c[0])")
    pg.wait_for_timeout(300)
    ask_home(pg, "Water rights priority: senior appropriator call doctrine")
    pg.wait_for_timeout(500)
    assert pg.evaluate(
        "!document.querySelector('#docpanel') || document.querySelector('#docpanel').classList.contains('hidden') || getComputedStyle(document.querySelector('#docpanel')).display=='none'"
    )


def test_followup_and_new_question(browser):
    pg = page(browser, "/")
    ask_home(pg, "Do I have to stop for police at a traffic stop with no reason?")
    assert pg.evaluate("[...document.querySelectorAll('.fuc')].some(b=>/evidence/.test(b.textContent))")
    assert pg.get_attribute("#q", "placeholder") == "Ask a follow-up…"
    pg.click("#fuNew")
    pg.wait_for_timeout(300)
    assert pg.evaluate("FOLLOW.prev===null && FOLLOW.thread.length===0")


# ---------- transcript bugs (Alex 13:26) ----------
def _transcripts(pg, n=4):
    return pg.evaluate("""n=>{ const O=Docs3D.order().slice(0,n); return O.map(k=>Docs3D.explainText?Docs3D.explainText(k):null); }""", n)


def test_transcript_full_sentences_no_ellipsis(browser):
    pg = page(browser, "/map")
    wait_map(pg)
    T = _transcripts(pg)
    assert T and all(T), T
    for t in T:
        assert "…" not in t and "..." not in t, t


def test_transcript_not_citation_string(browser):
    pg = page(browser, "/map")
    wait_map(pg)
    for t in _transcripts(pg):
        ex = t.split(":", 1)[-1]
        assert not re.search(r"\b\d+\s+(U\.S\.|P\.\d?d|Colo\.|S\. ?Ct\.)\s+\d+", ex[:160]), ex[:160]


def test_relevant_because_is_clean_sentence(browser):
    pg = page(browser, "/map")
    wait_map(pg)
    for t in _transcripts(pg):
        assert "Relevant because:" not in t, t


def test_transcript_bottom_center_compact_no_overlap(browser):
    pg = page(browser, "/map")
    wait_map(pg)
    pg.wait_for_function("document.getElementById('transcript') && !document.getElementById('transcript').classList.contains('hidden')", timeout=20000)
    pg.evaluate("Docs3D.open(Docs3D._c[0])")
    pg.wait_for_timeout(400)
    r = pg.evaluate("""(()=>{const t=document.getElementById('transcript').getBoundingClientRect(), c=document.getElementById('docpanel').getBoundingClientRect(), h=document.getElementById('transcript').offsetParent.getBoundingClientRect();
      const ov=!(t.right<=c.left||c.right<=t.left||t.bottom<=c.top||c.bottom<=t.top);
      return {cx:Math.abs((t.left+t.right)/2-(h.left+h.right)/2)<h.width*0.2, w:t.width, ov, cardLeft:c.left-h.left<40, op:parseFloat(getComputedStyle(document.getElementById('transcript')).backgroundColor.split(',')[3]||'1')}})()""")
    assert r["w"] <= 460 and not r["ov"] and r["cardLeft"] and r["op"] < 0.9, r


def test_pin_click_does_not_stop_tour(browser):
    pg = page(browser, "/map")
    wait_map(pg)
    pg.wait_for_function("document.getElementById('transcript') && !document.getElementById('transcript').classList.contains('hidden')", timeout=20000)
    box = pg.evaluate("(()=>{const r=document.querySelector('#docs3d canvas').getBoundingClientRect(); return [r.left+r.width/2, r.top+r.height/2]})()")
    pg.mouse.click(box[0], box[1])
    pg.wait_for_timeout(300)
    pg.evaluate("Docs3D.open(Docs3D._c[0])")
    pg.click("#docpanel button")
    pg.wait_for_timeout(300)
    assert "Pause" in pg.evaluate("[...document.querySelectorAll('[data-tourctl]')].map(b=>b.innerText).join('|')")


def test_drag_stops_tour(browser):
    pg = page(browser, "/map")
    wait_map(pg)
    pg.wait_for_function("[...document.querySelectorAll('[data-tourctl]')].some(b=>/Pause/.test(b.innerText))", timeout=20000)
    b = pg.evaluate("(()=>{const r=document.querySelector('#docs3d canvas').getBoundingClientRect(); return [r.left+r.width/2, r.top+r.height/3]})()")
    pg.mouse.move(b[0], b[1])
    pg.mouse.down()
    pg.mouse.move(b[0] + 40, b[1] + 20, steps=5)
    pg.mouse.up()
    pg.wait_for_timeout(300)
    assert not pg.evaluate("[...document.querySelectorAll('[data-tourctl]')].some(b=>/Pause/.test(b.innerText))")


def test_one_external_link_per_card(browser):
    pg = page(browser, "/")
    ask_home(pg)
    c = pg.evaluate("[...document.getElementById('cites').children].map(el=>[...el.querySelectorAll('a[target=_blank]')].map(a=>a.textContent.trim()))")
    assert c and all(len(x) == 1 and re.match(r"(Full opinion|Read statute) ↗", x[0]) for x in c), c
    pg2 = page(browser, "/map")
    wait_map(pg2)
    pg2.evaluate("Docs3D.open(Docs3D._c[0])")
    pg2.wait_for_timeout(300)
    d = pg2.evaluate("[...document.querySelectorAll('#docpanel a[target=_blank]')].map(a=>a.textContent.trim())")
    assert len(d) == 1 and "Open source" not in d[0], d


def test_tour_controls_consistent_style(browser):
    pg = page(browser, "/map")
    wait_map(pg)
    cls = pg.evaluate("[...document.querySelectorAll('[data-tourctl]')].map(b=>b.className)")
    assert len(cls) >= 4 and len(set(cls)) == 1, cls


# ---------- navbar logos + examples dropdown (Alex 13:32) ----------
@pytest.mark.parametrize("path", ["/", "/map", "/dashboard", "/slides", "/guide"])
def test_navbar_logo_strip(browser, path):
    pg = page(browser, path)
    pg.wait_for_timeout(1500)
    links = pg.evaluate(
        "[...document.querySelectorAll('#partner-strip a')].map(a=>({t:a.target, l:a.getAttribute('aria-label')||'', img:!!a.querySelector('img,svg')}))"
    )
    assert len(links) == 6 and all(x["t"] == "_blank" and "dashboard" in x["l"] for x in links), links


def test_no_green_pills_in_hero(browser):
    pg = page(browser, "/")
    pg.wait_for_timeout(1500)
    assert pg.evaluate(
        "!document.getElementById('badges') || document.getElementById('badges').offsetParent===null || document.getElementById('badges').innerText.trim()===''"
    )


@pytest.mark.parametrize("path", ["/", "/map"])
def test_examples_dropdown(browser, path):
    pg = page(browser, path)
    pg.wait_for_timeout(1500)
    pg.click("#exBtn")
    assert pg.get_attribute("#exBtn", "aria-expanded") == "true"
    pg.keyboard.press("Escape")
    assert pg.get_attribute("#exBtn", "aria-expanded") == "false"
    pg.click("#exBtn")
    pg.click("#exMenu [role=menuitem] >> nth=3")
    assert "Water rights" in pg.input_value("#q") and not pg.is_visible("#exMenu")


@pytest.mark.parametrize("path", ["/", "/map"])
def test_examples_menu_in_viewport_and_on_top(browser, path):
    pg = page(browser, path)
    pg.wait_for_timeout(1500)
    pg.click("#exBtn")
    pg.wait_for_timeout(200)
    r = pg.evaluate("""(()=>{const m=document.getElementById('exMenu').getBoundingClientRect(); const it=document.querySelector('#exMenu [role=menuitem]').getBoundingClientRect();
      const top=document.elementFromPoint(it.left+it.width/2, it.top+it.height/2); return {right:m.right<=innerWidth+1, left:m.left>=0, onTop:!!(top&&top.closest('#exMenu'))}})()""")
    assert r == {"right": True, "left": True, "onTop": True}, r


@pytest.mark.parametrize("path", ["/", "/map"])
def test_never_two_audios_playing(browser, path):
    pg = page(browser, path, {"precedent.mute": "0", "mapVoice": "1"})
    pg.add_init_script(
        "window.__maxPlay=0; setInterval(()=>{ try{ const n=AudioMgr.instances().filter(a=>!a.paused&&!a.ended).length; window.__maxPlay=Math.max(window.__maxPlay,n);}catch(e){} },50);"
    )
    pg.reload(wait_until="load")
    pg.wait_for_timeout(1500)
    if path == "/":
        ask_home(pg)
    else:
        wait_map(pg)
    pg.wait_for_timeout(12000)
    assert pg.evaluate("window.__maxPlay") <= 1
