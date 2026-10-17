"""Citation cards never show 'unknown' or a bare title with a dead 'Full opinion' link (#61). A graph-linked
authority with no type and no passage gets a readable type label and its jurisdiction, and no 'Full opinion' link;
a normal case keeps its link. Checked on every citation card on / (answer cards and sidebar Sources)."""

import pytest
from ui_server import DESKTOP, app_server, needs_chromium

sync_api = pytest.importorskip("playwright.sync_api")
pytestmark = needs_chromium

CITES = [
    {
        "ref": "[1]",
        "id": "case:people-v-jauch",
        "title": "People v. Jauch",
        "type": "case",
        "court": "Colorado Supreme Court",
        "date": "2013",
        "path": ["seed", "case:people-v-jauch"],
        "passage": "Probable cause exists when the facts would lead a reasonable officer to believe...",
        "url": "https://www.courtlistener.com/opinion/1/people-v-jauch/",
    },
    {
        "ref": "[6]",
        "id": "statute:20-cfr",
        "title": "20 CFR",
        "type": "",
        "court": "",
        "date": "",
        "path": ["case:people-v-jauch", "statute:20-cfr"],
        "passage": "",
        "url": "",
    },
]
RESULT = {
    "run_id": "stubcite",
    "question": "Automobile exception: probable cause standard in Colorado",
    "answer": "**Short answer:** Probable cause is required [1]. See also [6].",
    "provider": "fake",
    "backend": "networkx",
    "elapsed_s": 1.0,
    "passage_source": "snapshot",
    "citations": CITES,
    "edges": [{"src": "case:people-v-jauch", "dst": "statute:20-cfr"}],
    "seeds": ["case:people-v-jauch"],
    "documents": [],
    "safeguard": {
        "pass": True,
        "used": ["[1]", "[6]"],
        "invalid": [],
        "unknown_authorities": [],
        "unsupported_claims": [],
        "disclaimer": "Research aid only.",
    },
}


@pytest.fixture(scope="module")
def base():
    with app_server() as url:
        yield url


def _stub(page):
    def handle(route):
        url = route.request.url
        if url.endswith("/api/ask"):
            return route.fulfill(json={"run_id": "stubcite"})
        if "/api/run/stubcite" in url:
            return route.fulfill(json={"run_id": "stubcite", "events": [], "result": RESULT})
        return route.continue_()

    page.route("**/api/**", handle)


def test_fallback_label_and_no_dead_link(base):
    with sync_api.sync_playwright() as p:
        b = p.chromium.launch()
        page = b.new_page(viewport={"width": DESKTOP, "height": 900})
        _stub(page)
        page.goto(base + "/", wait_until="load")
        page.wait_for_timeout(800)
        page.fill("#q", RESULT["question"])
        page.click("#go")
        page.wait_for_selector("[data-citation-card][data-ref='6']", state="attached", timeout=20000)
        page.wait_for_timeout(1000)
        cards = page.locator("[data-citation-card][data-ref='6']")
        assert cards.count() >= 1
        for i in range(cards.count()):
            c = cards.nth(i)
            text = c.inner_text().lower() if c.is_visible() else c.text_content().lower()
            assert "unknown" not in text
            label = c.locator("[data-cite-type]").first.text_content().strip().lower()
            assert label and label != "unknown"
            assert c.locator("[data-cite-jurisdiction]").first.text_content().strip()
            assert c.locator("a, button").filter(has_text="Full opinion").count() == 0
        good = page.locator("[data-citation-card][data-ref='1']").first
        assert good.locator("a[href*='courtlistener']").count() >= 1
        b.close()
