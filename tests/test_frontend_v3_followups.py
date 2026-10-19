"""O101-O103: a run carries three grounded follow-ups, each one asks with the run as context, and the page
says which question and which run it is answering."""

import json

import pytest

from ui_server import app_server, load_fixture, needs_chromium, needs_v3, open_run

sync_api = pytest.importorskip("playwright.sync_api")
pytestmark = [needs_chromium, needs_v3]

RUN = load_fixture("run-fidelity.json")
RUN_ID = RUN["run_id"]
GROUNDING = ("mineral", "homestead", "38-41", "severed", "reservation", "surface")


@pytest.fixture(scope="module")
def base():
    with app_server() as url:
        yield url


@pytest.fixture(scope="module")
def browser():
    with sync_api.sync_playwright() as p:
        b = p.chromium.launch(args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader"])
        yield b
        b.close()


def _open(browser, base):
    ctx, page = open_run(browser, base, RUN, run_id=RUN_ID)
    page.get_by_role("button", name="Memo menu", exact=True).wait_for(timeout=15000)
    return ctx, page


def _followups(page):
    page.get_by_role("button", name="Memo menu", exact=True).click()
    page.wait_for_timeout(200)
    page.get_by_role("button", name="Follow-ups", exact=True).click()
    heading = page.get_by_role("heading", name="Follow-ups", exact=True)
    heading.wait_for(timeout=5000)
    return heading.locator("xpath=..")


def _memo_text(page):
    return page.locator("section").first.inner_text().lower()


def test_O101_a_run_carries_three_grounded_followups(base, browser):
    ctx, page = _open(browser, base)
    panel = _followups(page)
    items = panel.get_by_role("listitem")
    assert items.count() == len(RUN["followups"]) == 3, f"the panel shows {items.count()} follow-ups, not three"
    for index in range(items.count()):
        text = items.nth(index).inner_text().strip().lower()
        assert text, f"follow-up {index} is empty"
        assert any(term in text for term in GROUNDING), f"follow-up {index} is not grounded in the authorities: {text!r}"
    ctx.close()


def test_O102_a_followup_asks_with_the_run_as_context(base, browser):
    followup = RUN["followups"][0]
    sent = []

    def ask_route(route):
        sent.append(json.loads(route.request.post_data or "{}"))
        route.fulfill(status=200, content_type="application/json", body=json.dumps({"run_id": "run-followup"}))

    ctx, page = _open(browser, base)
    followup_run = dict(RUN, run_id="run-followup", question=followup)
    page.route(
        "**/api/run/run-followup",
        lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps({"result": followup_run})),
    )
    page.route("**/api/ask", ask_route)

    panel = _followups(page)
    panel.get_by_role("button", name=followup).click()

    outside = ""
    for _ in range(30):
        whole = _memo_text(page)
        try:
            panel_text = panel.inner_text().lower()
        except Exception:  # the panel closed with the new run
            panel_text = ""
        outside = whole.replace(panel_text, "", 1) if panel_text else whole
        if "follow-up" in outside:
            break
        page.wait_for_timeout(500)

    assert sent, "clicking a follow-up did not ask the question"
    body = sent[0]
    assert body.get("question") == followup, f"the follow-up was not asked verbatim: {body}"
    assert RUN_ID in json.dumps(body), f"the follow-up did not carry the current run as context: {body}"
    assert "follow-up" in outside, f"the resulting memo does not say it answered a follow-up: {outside[:400]!r}"
    ctx.close()


def test_O103_the_composer_names_the_kind_of_question(base, browser):
    ctx, page = _open(browser, base)
    box = page.get_by_role("textbox", name="Ask a question")
    assert "follow" in (box.get_attribute("placeholder") or "").lower(), "the composer does not say it will ask a follow-up while a run is open"

    page.get_by_role("button", name="Memo menu", exact=True).click()
    page.wait_for_timeout(200)
    assert page.get_by_role("button", name="New question", exact=True).count() == 1, "the memo has no single control that starts a new question"
    page.get_by_role("button", name="Run info", exact=True).click()
    page.wait_for_timeout(300)
    info = page.locator("section", has_text="Run info").first.inner_text()
    assert RUN_ID in info, f"the run info does not name the run being read: {info!r}"

    page.get_by_role("button", name="Memo menu", exact=True).click()
    page.wait_for_timeout(200)
    page.get_by_role("button", name="New question", exact=True).click()
    page.wait_for_timeout(300)
    assert box.input_value() == "", "the new question control leaves the previous text in the composer"
    assert "follow" not in (box.get_attribute("placeholder") or "").lower(), "the composer still promises a follow-up after a new question was started"
    ctx.close()
