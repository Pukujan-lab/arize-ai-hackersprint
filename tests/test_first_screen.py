"""First screen: a first-time visitor can tell where to click (cue, highlighted Ask, steps, labeled controls)."""

import pytest

from uiserve import browser_or_skip, serve


@pytest.fixture(scope="module")
def page():
    p, b = browser_or_skip()
    with serve() as base:
        pg = b.new_page(viewport={"width": 1440, "height": 900})
        pg.goto(base + "/", wait_until="domcontentloaded")
        pg.wait_for_timeout(1500)
        pg.base = base  # type: ignore[attr-defined]
        yield pg
    b.close()
    p.stop()


def test_start_here_cue_visible(page):
    cue = page.locator("#firststep")
    assert cue.is_visible()
    assert "start here" in cue.inner_text().lower()


def test_input_uses_placeholder_not_prefilled_text(page):
    q = page.locator("#q")
    assert q.input_value() == ""
    assert q.get_attribute("placeholder")
    assert q.get_attribute("aria-label")


def test_ask_button_is_highlighted_for_first_visit(page):
    go = page.locator("#go")
    assert "first-visit" in (go.get_attribute("class") or "")
    assert go.get_attribute("aria-label")


def test_numbered_steps(page):
    steps = page.locator("#steps li")
    assert steps.count() == 3
    txt = page.locator("#steps").inner_text().lower()
    for word in ("ask", "memo", "tour"):
        assert word in txt


def test_empty_state_explains_next_step(page):
    t = page.locator("#answer").inner_text().lower()
    assert "your cited memo will appear here" in t
    assert page.locator("#tryex").is_visible()


def test_controls_have_labels(page):
    assert page.locator("#vorb").get_attribute("aria-label")
    assert page.locator("#vorb-label").is_visible()
    assert page.locator("[data-tour=play]").count() == 1
    for el in page.locator("[data-tourctl]").all():
        assert el.get_attribute("aria-label") and el.get_attribute("title")


def test_dismiss_is_remembered(page):
    page.locator("#firststep-dismiss").click()
    assert not page.locator("#firststep").is_visible()
    assert page.evaluate("localStorage.getItem('precedent.firstScreenDismissed')") == "1"
    page.reload(wait_until="domcontentloaded")
    page.wait_for_timeout(800)
    assert not page.locator("#firststep").is_visible()
    assert "pulse-cue" not in (page.locator("#go").get_attribute("class") or "")


def test_empty_ask_gives_feedback(page):
    page.evaluate("document.getElementById('q').placeholder = 'Ask a follow-up'")
    page.locator("#go").click()
    assert page.locator("#askhint").is_visible()
