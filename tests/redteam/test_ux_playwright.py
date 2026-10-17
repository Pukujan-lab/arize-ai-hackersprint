"""Live UX / flow red-team with Playwright. No security probes.

Set REDTEAM_LIVE=1 and optional REDTEAM_BASE_URL (default https://arize.design-bakery.com).
Keeps load light: at most one real /api/ask, prefer cached UI paths, no floods.
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path

import pytest

BASE = os.environ.get("REDTEAM_BASE_URL", "https://arize.design-bakery.com").rstrip("/")
LIVE = os.environ.get("REDTEAM_LIVE") == "1"
SHOTS = Path(os.environ.get("REDTEAM_SHOTS", "tests/redteam/shots"))
PAGES = ["/", "/map", "/dashboard", "/slides", "/guide", "/observability"]

pytestmark = pytest.mark.skipif(not LIVE, reason="set REDTEAM_LIVE=1 for live UX Playwright")


@pytest.fixture(scope="module")
def browser_mod():
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        yield browser
        browser.close()


def _ctx(browser, *, mobile=False):
    if mobile:
        return browser.new_context(
            viewport={"width": 390, "height": 844},
            is_mobile=True,
            has_touch=True,
            ignore_https_errors=True,
        )
    return browser.new_context(viewport={"width": 1280, "height": 800}, ignore_https_errors=True)


def _collect_console(page, bucket: list):
    page.on("console", lambda m: bucket.append(f"{m.type}:{m.text}") if m.type in ("error", "warning") else None)
    page.on("pageerror", lambda e: bucket.append(f"pageerror:{e}"))
    page.on(
        "response",
        lambda r: bucket.append(f"http{r.status}:{r.url}") if r.status >= 400 and "/api/" not in r.url else None,
    )


def _visible_controls(page):
    """Buttons, links, toggles, selects that look clickable and are visible."""
    return page.locator(
        "a[href], button:not([disabled]), [role='button'], input[type='checkbox'], input[type='radio'], select, [role='switch'], [aria-pressed], summary"
    )


def test_every_page_loads_without_pageerror(browser_mod):
    cons: list[str] = []
    ctx = _ctx(browser_mod)
    page = ctx.new_page()
    _collect_console(page, cons)
    SHOTS.mkdir(parents=True, exist_ok=True)
    failures = []
    for path in PAGES:
        page.goto(BASE + path, wait_until="domcontentloaded", timeout=45000)
        page.wait_for_timeout(1200)
        page.screenshot(path=str(SHOTS / f"load{path.replace('/', '_') or '_home'}.png"), full_page=True)
        pe = [c for c in cons if c.startswith("pageerror:")]
        if pe:
            failures.append(f"{path}: {pe[-1][:200]}")
        cons.clear()
    ctx.close()
    assert not failures, "pageerrors on load:\n" + "\n".join(failures)


def test_click_every_visible_control_desk(browser_mod):
    """Click each visible control once; flag dead clicks (no nav, no DOM/URL/network change, no aria change)."""
    ctx = _ctx(browser_mod)
    page = ctx.new_page()
    cons: list[str] = []
    _collect_console(page, cons)
    SHOTS.mkdir(parents=True, exist_ok=True)
    dead = []
    errors = []
    for path in PAGES:
        page.goto(BASE + path, wait_until="domcontentloaded", timeout=45000)
        page.wait_for_timeout(500)
        n = _visible_controls(page).count()
        # Cap per page to keep the run bounded
        for i in range(min(n, 18)):
            ctrl = _visible_controls(page).nth(i)
            try:
                if not ctrl.is_visible():
                    continue
                label = (
                    ctrl.get_attribute("aria-label")
                    or ctrl.get_attribute("title")
                    or ctrl.inner_text(timeout=1000)[:80]
                    or ctrl.get_attribute("href")
                    or f"ctrl-{i}"
                )
                label = re.sub(r"\s+", " ", label).strip()
                before_url = page.url
                before_html = page.locator("body").inner_html()[:5000]
                cons_before = len(cons)
                # Prefer force=False; skip if obscured
                ctrl.click(timeout=2500, no_wait_after=True)
                page.wait_for_timeout(250)
                after_url = page.url
                after_html = page.locator("body").inner_html()[:5000]
                changed = after_url != before_url or after_html != before_html
                new_errs = [
                    c for c in cons[cons_before:] if c.startswith("pageerror:") or (c.startswith("error:") and "tailwind" not in c.lower() and "404" not in c)
                ]
                if new_errs:
                    errors.append(f"{path} :: {label}: {new_errs[0][:160]}")
                    page.screenshot(path=str(SHOTS / f"err_{path.strip('/') or 'home'}_{i}.png"))
                # External links: allow leave then come back
                if after_url.startswith(BASE) is False and after_url != before_url:
                    page.goto(BASE + path, wait_until="domcontentloaded", timeout=45000)
                    continue
                if after_url != before_url and after_url.startswith(BASE):
                    # navigated inside app — return for remaining clicks on this page
                    page.goto(BASE + path, wait_until="domcontentloaded", timeout=45000)
                    page.wait_for_timeout(400)
                    continue
                if not changed and not label.lower().startswith("#"):
                    href = ctrl.get_attribute("href") or ""
                    # Same-page nav and empty Ask are covered by dedicated findings; don't double-count here
                    if (
                        href.rstrip("/") == path.rstrip("/")
                        or label.strip() in {"Ask", "Guide", "Observability", "Dashboards"}
                        and path in {"/guide", "/observability", "/dashboard", "/"}
                    ):
                        if "Dashboard" in label and path != "/dashboard":
                            pass  # navigating to dashboard is checked via errors list
                        elif label.strip() == "Ask":
                            pass
                        else:
                            continue
                    pressed = ctrl.get_attribute("aria-pressed")
                    if pressed is None:
                        dead.append(f"{path} :: {label}")
            except Exception as e:
                # Detached after prior click is OK; record hard failures
                if "Timeout" in type(e).__name__ or "intercepts" in str(e).lower():
                    dead.append(f"{path} :: (unclickable) {e}")
                page.goto(BASE + path, wait_until="domcontentloaded", timeout=45000)
                page.wait_for_timeout(300)
        page.screenshot(path=str(SHOTS / f"after_clicks_{path.strip('/') or 'home'}.png"), full_page=True)
    ctx.close()
    # Persist for issue filing
    (SHOTS / "dead_clicks.json").write_text(json.dumps({"dead": dead, "errors": errors}, indent=2))
    assert not errors, "console/page errors while clicking:\n" + "\n".join(errors[:12])
    # Dead clicks are findings but allow a small number of decorative controls
    assert len(dead) <= 3, "many dead clicks / unresponsive controls:\n" + "\n".join(dead[:20])


def test_ask_memo_flow_first_time_user(browser_mod):
    """First-time path: land on /, type a question, get a memo or a clear error/loading state."""
    ctx = _ctx(browser_mod)
    page = ctx.new_page()
    cons: list[str] = []
    _collect_console(page, cons)
    SHOTS.mkdir(parents=True, exist_ok=True)
    page.goto(BASE + "/", wait_until="domcontentloaded", timeout=45000)
    page.wait_for_timeout(1000)
    page.screenshot(path=str(SHOTS / "home_before_ask.png"), full_page=True)

    # Find the question input — must be obvious
    q = page.locator("#q, textarea[name='q'], input[name='q'], textarea, input[type='search']").first
    assert q.count() and q.is_visible(), "No obvious question input on / for a first-time user"
    go = page.locator("#go, button:has-text('Ask'), button:has-text('Research'), button[type='submit']").first
    assert go.count() and go.is_visible(), "No obvious Ask/submit control on /"

    q.fill("When can police search a car without a warrant in Colorado?")
    go.click()
    page.screenshot(path=str(SHOTS / "home_after_ask_click.png"), full_page=True)

    # Expect loading feedback within 2s
    page.wait_for_timeout(2000)
    body = page.inner_text("body")
    loading = any(x in body.lower() for x in ("working", "loading", "retriev", "thinking", "agents"))
    # Wait up to ~45s for an answer or clear failure (one LLM call budget)
    answered = False
    for _ in range(30):
        body = page.inner_text("body")
        if "safeguard" in body.lower() or "short answer" in body.lower() or "bottom line" in body.lower():
            answered = True
            break
        if "try again" in body.lower() or "rate" in body.lower() and "limit" in body.lower():
            break
        page.wait_for_timeout(1000)
    page.screenshot(path=str(SHOTS / "home_ask_result.png"), full_page=True)
    ctx.close()
    assert loading or answered, "No loading feedback after Ask click"
    assert answered, "Ask did not produce a memo / safeguard result within ~45s (or clear error)"


def test_map_and_tour_controls_exist_and_respond(browser_mod):
    ctx = _ctx(browser_mod)
    page = ctx.new_page()
    SHOTS.mkdir(parents=True, exist_ok=True)
    page.goto(BASE + "/map", wait_until="domcontentloaded", timeout=45000)
    page.wait_for_timeout(2000)
    page.screenshot(path=str(SHOTS / "map_initial.png"), full_page=True)
    # Tour / play controls
    tour = page.locator("button:has-text('Tour'), button:has-text('Play'), button[aria-label*='tour' i], button[aria-label*='Play' i], [data-tourctl]")
    assert tour.count() >= 1, "Map page has no obvious Tour/Play control — first-time users cannot start the tour"
    # Click first tour-like control
    try:
        tour.first.click(timeout=3000)
        page.wait_for_timeout(1500)
    except Exception as e:
        page.screenshot(path=str(SHOTS / "map_tour_click_fail.png"), full_page=True)
        pytest.fail(f"Tour/Play control not clickable: {e}")
    page.screenshot(path=str(SHOTS / "map_after_tour.png"), full_page=True)
    # Mute / listen if present
    audio_btn = page.locator("button:has-text('Mute'), button:has-text('Listen'), button[aria-label*='mute' i], button[aria-label*='Listen' i], #play")
    if audio_btn.count():
        try:
            audio_btn.first.click(timeout=2000)
            page.wait_for_timeout(500)
        except Exception:
            page.screenshot(path=str(SHOTS / "map_audio_dead.png"))
            pytest.fail("Audio Mute/Listen/Play control visible but not clickable")
    ctx.close()


def test_dashboard_not_stuck_on_error(browser_mod):
    cons: list[str] = []
    ctx = _ctx(browser_mod)
    page = ctx.new_page()
    _collect_console(page, cons)
    SHOTS.mkdir(parents=True, exist_ok=True)
    page.goto(BASE + "/dashboard", wait_until="domcontentloaded", timeout=45000)
    page.wait_for_timeout(2500)
    page.screenshot(path=str(SHOTS / "dashboard.png"), full_page=True)
    body = page.inner_text("body")
    pe = [c for c in cons if "pageerror" in c or "Unexpected token" in c or "Internal S" in c]
    ctx.close()
    assert not pe, f"Dashboard console/page errors: {pe[:5]}"
    assert "internal server error" not in body.lower(), "Dashboard shows Internal Server Error to users"


def test_mobile_home_usable(browser_mod):
    ctx = _ctx(browser_mod, mobile=True)
    page = ctx.new_page()
    SHOTS.mkdir(parents=True, exist_ok=True)
    page.goto(BASE + "/", wait_until="domcontentloaded", timeout=45000)
    page.wait_for_timeout(1000)
    page.screenshot(path=str(SHOTS / "mobile_home.png"), full_page=True)
    q = page.locator("#q, textarea, input[type='search']").first
    go = page.locator("#go, button:has-text('Ask'), button[type='submit']").first
    assert q.is_visible(), "Question input not visible on mobile home"
    assert go.is_visible(), "Ask button not visible on mobile home"
    # Check horizontal overflow roughly
    overflow = page.evaluate("() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 8")
    ctx.close()
    assert not overflow, "Mobile home has horizontal overflow — layout broken"


def test_nav_links_between_pages(browser_mod):
    ctx = _ctx(browser_mod)
    page = ctx.new_page()
    broken = []
    page.goto(BASE + "/", wait_until="domcontentloaded", timeout=45000)
    hrefs = page.eval_on_selector_all(
        "a[href]",
        "els => els.map(e => e.getAttribute('href')).filter(h => h && h.startsWith('/') && !h.startsWith('//'))",
    )
    for h in sorted(set(hrefs))[:20]:
        if h.startswith("/api"):
            continue
        resp = page.goto(BASE + h, wait_until="domcontentloaded", timeout=45000)
        if resp and resp.status >= 400:
            broken.append(f"{h} -> {resp.status}")
    ctx.close()
    assert not broken, "Broken in-app nav links:\n" + "\n".join(broken)


def test_empty_loading_error_states_are_labeled(browser_mod):
    """Observability / runs empty states should not be blank silence."""
    ctx = _ctx(browser_mod)
    page = ctx.new_page()
    SHOTS.mkdir(parents=True, exist_ok=True)
    page.goto(BASE + "/observability", wait_until="domcontentloaded", timeout=45000)
    page.wait_for_timeout(2000)
    page.screenshot(path=str(SHOTS / "observability.png"), full_page=True)
    text = page.inner_text("body").lower()
    ctx.close()
    # Should have some explanatory chrome, not an empty shell
    assert len(text) > 80, "Observability page looks empty — no guidance for a first-time user"


def test_empty_ask_shows_feedback(browser_mod):
    """Clicking Ask with an empty question must show validation — not a silent no-op."""
    ctx = _ctx(browser_mod)
    page = ctx.new_page()
    page.goto(BASE + "/", wait_until="domcontentloaded", timeout=45000)
    page.wait_for_timeout(500)
    go = page.locator("#go, button:has-text('Ask'), button[type='submit']").first
    before = page.inner_text("body")
    go.click()
    page.wait_for_timeout(800)
    after = page.inner_text("body")
    ctx.close()
    assert after != before or any(x in after.lower() for x in ("enter", "type", "question", "empty", "required", "need")), (
        "Empty Ask is a silent no-op — no validation feedback for first-time users"
    )
