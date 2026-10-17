"""Every page works at phone, tablet and desktop widths: no sideways scroll, big enough tap targets."""

import pytest

from uiserve import browser_or_skip, serve

WIDTHS = [360, 390, 768, 1024, 1440]
PAGES = ["/", "/map", "/dashboard", "/slides", "/guide", "/observability"]
# v1 home (old page) keeps its own tap-target / composer checks at /v1; "/" is now v2 and is covered for overflow above and in test_v2_home.py.
TAP_PAGES = ["/v1", "/map", "/dashboard", "/slides", "/guide", "/observability"]

TAP_JS = """() => [...document.querySelectorAll('button, a[href], input, select, [role=button]')]
 .filter(e => { const r = e.getBoundingClientRect(), s = getComputedStyle(e);
   return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && !e.closest('.hidden, [aria-hidden=true]')
     && r.bottom > 0 && r.top < innerHeight * 3 && e.type !== 'checkbox' && !e.closest('p, li, td, .prose, #answer, #cites, #events, .ans-meta, #deck'); })
 .map(e => { const r = e.getBoundingClientRect(); return {t: (e.id || e.getAttribute('aria-label') || e.textContent || e.tagName).trim().slice(0, 40), w: Math.round(r.width), h: Math.round(r.height)}; })
 .filter(x => x.w < 44 || x.h < 44)"""


@pytest.fixture(scope="module")
def env():
    p, b = browser_or_skip()
    with serve() as base:
        yield b, base
    b.close()
    p.stop()


def _open(env, path, w):
    b, base = env
    pg = b.new_page(viewport={"width": w, "height": 844 if w < 768 else 900})
    pg.goto(base + path, wait_until="domcontentloaded")
    pg.wait_for_timeout(1200)
    return pg


@pytest.mark.parametrize("w", WIDTHS)
@pytest.mark.parametrize("path", PAGES)
def test_no_horizontal_overflow(env, path, w):
    pg = _open(env, path, w)
    sw = pg.evaluate("Math.max(document.documentElement.scrollWidth, document.body.scrollWidth)")
    pg.close()
    assert sw <= w + 1, f"{path} @{w}px scrolls sideways ({sw}px)"


@pytest.mark.parametrize("w", [360, 390, 768])
@pytest.mark.parametrize("path", TAP_PAGES)
def test_tap_targets(env, path, w):
    pg = _open(env, path, w)
    small = pg.evaluate(TAP_JS)
    pg.close()
    assert not small, f"{path} @{w}px small tap targets: {small[:8]}"


@pytest.mark.parametrize("w", [360, 390])
def test_input_and_ask_stack_on_mobile(env, w):
    pg = _open(env, "/v1", w)
    q, go = pg.locator("#q").bounding_box(), pg.locator("#go").bounding_box()
    pg.close()
    assert go["y"] >= q["y"] + q["height"] - 2, "Ask should sit below the input on phones"


@pytest.mark.parametrize("w", [360, 390, 768])
def test_mic_does_not_cover_ask(env, w):
    pg = _open(env, "/v1", w)
    m, go = pg.locator("#vorb").bounding_box(), pg.locator("#go").bounding_box()
    pg.close()
    overlap = not (m["x"] > go["x"] + go["width"] or m["x"] + m["width"] < go["x"] or m["y"] > go["y"] + go["height"] or m["y"] + m["height"] < go["y"])
    assert not overlap and m["width"] <= 64
