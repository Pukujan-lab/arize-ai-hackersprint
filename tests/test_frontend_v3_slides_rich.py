"""O62-O64: the deck has nine slides, every slide carries a visual element, it states the product's real
figures and names every partner, and it shows a real question and follow-up from a saved run."""

import re

import pytest

from ui_server import DESKTOP, app_server, needs_chromium, needs_v3, open_page

sync_api = pytest.importorskip("playwright.sync_api")
pytestmark = [needs_chromium, needs_v3]

POSITION = re.compile(r"Slide\s+(\d+)\s+of\s+(\d+)", re.I)
PARTNERS = ("Daytona", "SurrealDB", "Octo", "Arize", "ElevenLabs", "Anthropic", "ACS")
QUESTION = "Can police search my car without a warrant in Colorado?"

STACK = {
    "octo": {"corpus": "327,407 passages"},
    "surrealdb": {"nodes": 119770, "edges": 160793},
    "elevenlabs": {"chain": ["fish", "kokoro", "browser"]},
}
RUNS = [{"run_id": "deck-run", "question": QUESTION, "n": 3, "ts": "2026-10-19T10:00:00Z"}]
RESULT = {
    "run_id": "deck-run",
    "question": QUESTION,
    "answer": "Yes, with probable cause: the automobile exception allows a warrantless search [1].",
    "elapsed_s": 12.0,
    "provider": "inferhub/deepseek",
    "safeguard": {"pass": True, "used": [], "invalid": [], "unknown_authorities": []},
    "citations": [{"id": "a", "title": "People v. McMillan", "ref": "[1]"}],
    "followups": ["Can I refuse a search?"],
}

VISUAL_JS = """
() => {
  const vis = el => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight * 2;
  };
  const main = document.querySelector('main') || document.body;
  if ([...main.querySelectorAll('img, svg, canvas, video, table')].some(vis)) return true;
  return [...main.querySelectorAll('*')].some(el => {
    const t = (el.textContent || '').trim();
    if (!/^[~≈]?\\d[\\d,.]*[kKmM]?%?$/.test(t)) return false;
    return vis(el) && parseFloat(getComputedStyle(el).fontSize) >= 24;
  });
}
"""


@pytest.fixture(scope="module")
def base():
    with app_server() as url:
        yield url


@pytest.fixture(scope="module")
def browser():
    with sync_api.sync_playwright() as p:
        b = p.chromium.launch()
        yield b
        b.close()


def _stub(page):
    def handle(route):
        url = route.request.url
        if "/api/stack" in url:
            return route.fulfill(json=STACK)
        if "/api/runs" in url:
            return route.fulfill(json=RUNS)
        if "/api/run/" in url:
            return route.fulfill(json={"events": [], "result": RESULT})
        route.continue_()

    page.route("**/*", handle)


def _open(browser, base):
    ctx, page = open_page(browser, base, "/slides", DESKTOP, setup=_stub)
    page.wait_for_timeout(1500)
    return ctx, page


def _position(page):
    m = POSITION.search(page.inner_text("body"))
    assert m, "the deck does not state its position"
    return int(m.group(1)), int(m.group(2))


def _walk(page):
    """Advance through the whole deck, returning each slide's text and whether it carries a visual."""
    text, visual = [], []
    first, total = _position(page)
    assert first == 1, "the deck does not open on its first slide"
    for _ in range(total):
        text.append(page.inner_text("main"))
        visual.append(page.evaluate(VISUAL_JS))
        page.keyboard.press("ArrowRight")
        page.wait_for_timeout(300)
    return text, visual, total


def test_O62_the_deck_has_nine_slides_and_every_slide_carries_a_visual(base, browser):
    ctx, page = _open(browser, base)
    text, visual, total = _walk(page)
    assert total == 9, f"the deck has {total} slides"
    bare = [i + 1 for i, has in enumerate(visual) if not has]
    assert not bare, f"slides {bare} are text alone"
    assert all(t.strip() for t in text), "a slide rendered blank"
    ctx.close()


def test_O63_the_deck_states_the_real_figures_and_names_every_partner(base, browser):
    ctx, page = _open(browser, base)
    text, _, _ = _walk(page)
    joined = "\n".join(text)

    for partner in PARTNERS:
        assert partner in joined, f"the deck does not name {partner}"
    for pattern, label in (
        (r"327(?:[,.]?407|k)", "passages"),
        (r"119(?:[,.]?770|k)", "nodes"),
        (r"160(?:[,.]?793|k)", "edges"),
    ):
        assert re.search(pattern, joined, re.I), f"the deck does not state the {label} figure"
    ctx.close()


def test_O64_the_deck_shows_a_real_question_and_follow_up(base, browser):
    ctx, page = _open(browser, base)
    text, _, _ = _walk(page)
    joined = " ".join(text)
    assert " ".join(QUESTION.split()[:5]).lower() in joined.lower(), "the deck shows no real question from a saved run"
    assert "follow-up" in joined.lower(), "the deck shows no follow-up"
    ctx.close()
