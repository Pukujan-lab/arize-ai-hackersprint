"""Shared helpers for the browser tests: start the app on a free port in fake-LLM mode, open fresh Playwright pages,
and measure layout (horizontal scroll, tap targets, text size, overlap). Browser tests run wherever
Playwright and its Chromium are installed (CI installs both) and skip cleanly otherwise."""

import contextlib
import json
import os
import pathlib
import socket
import subprocess
import sys
import time
import urllib.request

import pytest

ROOT = pathlib.Path(__file__).resolve().parent.parent
FIXTURES = pathlib.Path(__file__).resolve().parent / "fixtures"
V3_PAGES = ["/", "/map", "/observability", "/slides"]
PAGES = ["/", "/map", "/dashboard", "/slides", "/guide", "/observability"]
ALL_PAGES = PAGES + ["/runs"]
WIDTHS = [360, 390, 768, 1024, 1440]
MOBILE = 390
DESKTOP = 1440


def _free_port():
    with contextlib.closing(socket.socket()) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@contextlib.contextmanager
def app_server():
    """Yield a base URL. Uses $UI_BASE_URL if set (e.g. the live site), otherwise starts uvicorn locally."""
    base = os.environ.get("UI_BASE_URL")
    if base:
        yield base.rstrip("/")
        return
    (ROOT / "runs").mkdir(exist_ok=True)
    port = _free_port()
    env = dict(os.environ, LLM_MODE="fake", ACS_HOTLOAD="0")
    proc = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "uvicorn",
            "app.server:app",
            "--port",
            str(port),
            "--log-level",
            "warning",
        ],
        cwd=ROOT,
        env=env,
    )
    url = f"http://127.0.0.1:{port}"
    try:
        for _ in range(100):
            try:
                urllib.request.urlopen(url + "/api/health", timeout=1)
                break
            except OSError:
                time.sleep(0.2)
        yield url
    finally:
        proc.terminate()
        proc.wait(timeout=10)


def open_page(browser, base, path, width, height=900, storage=None, setup=None, color_scheme=None, motion=None):
    ctx = browser.new_context(
        viewport={"width": width, "height": height},
        storage_state=storage,
        color_scheme=color_scheme,
        reduced_motion=motion,
    )
    page = ctx.new_page()
    if setup:
        setup(page)
    page.goto(base + path, wait_until="domcontentloaded")
    page.wait_for_load_state("load")
    page.wait_for_timeout(800)
    return ctx, page


def load_fixture(name):
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def result_payload(run, run_id="v3-run"):
    payload = {
        "run_id": run.get("run_id") or run_id,
        "question": run.get("question", ""),
        "answer": run.get("answer", ""),
        "citations": run.get("citations", []),
        "edges": run.get("edges", []),
    }
    for key in ("provider", "elapsed_s", "safeguard", "followups", "documents"):
        if key in run:
            payload[key] = run[key]
    return payload


def serve_run(page, run, run_id="v3-run"):
    """Answer /api/run/<id> with a fixture so a page renders a known run without a live model."""
    body = json.dumps({"result": result_payload(run, run_id)})
    page.route(f"**/api/run/{run_id}", lambda r: r.fulfill(status=200, content_type="application/json", body=body))


def open_run(browser, base, run, path="/", width=DESKTOP, run_id="v3-run"):
    return open_page(browser, base, f"{path}?run={run_id}", width, setup=lambda p: serve_run(p, run, run_id))


def map_ready(page, timeout=30000):
    page.wait_for_function("window.__precedentMap && window.__precedentMap.v1 && window.__precedentMap.v1.ready", timeout=timeout)


def map_call(page, expr):
    return page.evaluate(f"() => window.__precedentMap.v1.{expr}")


VISIBLE_JS = """
window.__vis = el => {
  if (!el || !el.isConnected) return false;
  const cs = getComputedStyle(el);
  if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) return false;
  if (el.checkVisibility && !el.checkVisibility({checkOpacity: true, checkVisibilityCSS: true})) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return false;
  return r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight * 3;
};
"""


def horizontal_overflow(page):
    return page.evaluate("() => document.documentElement.scrollWidth - window.innerWidth")


def small_tap_targets(page, minimum=44):
    """Visible controls smaller than minimum px in either dimension (buttons, summaries, selects, checkboxes, sidebar links)."""
    return page.evaluate(
        VISIBLE_JS
        + """
        (min) => [...document.querySelectorAll('button, [role=button], summary, select, input[type=checkbox], input[type=submit], #sidebar a, #topbar a')]
          .filter(el => __vis(el) && !el.closest('svg'))
          .map(el => { const r = el.getBoundingClientRect(); return {w: r.width, h: r.height, el: el.outerHTML.slice(0, 120)}; })
          .filter(x => x.w < min - 0.5 || x.h < min - 0.5)
        """,
        minimum,
    )


def tiny_text(page, minimum=12):
    """Visible text whose computed font size is below minimum px (SVG labels excluded)."""
    return page.evaluate(
        VISIBLE_JS
        + """
        (min) => { const out = []; const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          let n; while ((n = w.nextNode())) { const t = n.textContent.trim(); const el = n.parentElement;
            if (!t || !el || el.closest('svg,script,style,noscript')) continue;
            if (!__vis(el)) continue; const fs = parseFloat(getComputedStyle(el).fontSize);
            if (fs < min - 0.01) out.push({fs, t: t.slice(0, 60)}); }
          return out.slice(0, 20); }
        """,
        minimum,
    )


def covered(page, selector):
    """Elements matching selector whose centre point is covered by some other element (overlap)."""
    return page.evaluate(
        VISIBLE_JS
        + """
        (sel) => [...document.querySelectorAll(sel)].filter(__vis).filter(el => {
          const r = el.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2;
          if (y < 0 || y > innerHeight || x < 0 || x > innerWidth) return false;
          const hit = document.elementFromPoint(x, y); return !(hit && (hit === el || el.contains(hit) || hit.contains(el)));
        }).map(el => { const r = el.getBoundingClientRect(); const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return el.outerHTML.slice(0, 80) + ' covered by ' + (h ? h.outerHTML.slice(0, 80) : 'nothing'); })
        """,
        selector,
    )


def is_visible(page, selector):
    return page.evaluate(VISIBLE_JS + "(s) => __vis(document.querySelector(s))", selector)


def chromium_ready():
    try:
        from playwright.sync_api import sync_playwright

        with sync_playwright() as p:
            return pathlib.Path(p.chromium.executable_path).exists()
    except Exception:  # noqa: BLE001 - any failure means no usable browser
        return False


needs_chromium = pytest.mark.skipif(not chromium_ready(), reason="Playwright Chromium not installed")
needs_v3 = pytest.mark.skipif(not (ROOT / "web" / "dist" / "index.html").exists(), reason="v3 build is not present yet")


def _has_data():
    d = pathlib.Path(os.environ.get("GRAPH_DATA_DIR") or ROOT / "data")
    return (d / "nodes.jsonl").exists()


needs_data = pytest.mark.skipif(not _has_data(), reason="graph data (data/nodes.jsonl or GRAPH_DATA_DIR) not present")
