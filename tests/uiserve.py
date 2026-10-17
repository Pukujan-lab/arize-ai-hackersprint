"""Tiny static server for browser tests: serves static/ under the same routes as the app, with /api/* stubbed.
No data, model or network needed, so the layout tests run anywhere Playwright's Chromium is installed."""

import http.server
import json
import pathlib
import threading
from contextlib import contextmanager

ROOT = pathlib.Path(__file__).resolve().parent.parent
STATIC = ROOT / "static"
PAGES = {"/": "index.html", "/map": "map.html", "/dashboard": "dashboard.html", "/slides": "slides.html", "/guide": "guide.html", "/observability": "observability.html"}  # fmt: skip
TYPES = {".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg"}  # fmt: skip


class _H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a):  # quiet
        pass

    def _send(self, code, body, ctype):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = self.path.split("?")[0]
        if path.startswith("/api/"):
            return self._send(200, json.dumps({"ok": True, "tasks": {}, "events": []}).encode(), "application/json")
        f = STATIC / PAGES[path] if path in PAGES else STATIC / path.removeprefix("/static/").lstrip("/")
        try:
            f = f.resolve()
            f.relative_to(STATIC)
            body = f.read_bytes()
        except (OSError, ValueError):
            return self._send(404, b"", "text/plain")
        self._send(200, body, TYPES.get(f.suffix, "application/octet-stream"))

    do_POST = do_GET


@contextmanager
def serve():
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), _H)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    try:
        yield f"http://127.0.0.1:{srv.server_port}"
    finally:
        srv.shutdown()


def browser_or_skip():
    import pytest

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        pytest.skip("playwright not installed")
    p = sync_playwright().start()
    try:
        b = p.chromium.launch()
    except Exception as e:  # browser binary missing in CI
        p.stop()
        pytest.skip(f"chromium unavailable: {e}")
    return p, b
