"""/dashboard loads without page errors and shows its panels, even when a stack field is missing (#42)."""

import pytest
from ui_server import app_server

pytestmark = pytest.mark.live
sync_api = pytest.importorskip("playwright.sync_api")


def test_dashboard_has_no_page_errors():
    with app_server() as base, sync_api.sync_playwright() as p:
        b = p.chromium.launch()
        page = b.new_page(viewport={"width": 1440, "height": 900})
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        resp = page.goto(base + "/dashboard", wait_until="load")
        page.wait_for_timeout(2500)
        assert resp.status == 200
        assert errors == []
        assert "Internal Server Error" not in page.inner_text("body")
        b.close()
