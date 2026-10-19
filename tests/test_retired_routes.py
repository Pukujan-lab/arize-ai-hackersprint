"""O4 and O5: the old addresses forward to a surviving page, and no old page file answers at any address.

Retirement used to mean deleting a menu link while the route and the file stayed live. This test makes
that impossible to repeat."""

import re
import urllib.error
import urllib.request

import pytest

from ui_server import ROOT, app_server, needs_v3

pytestmark = needs_v3

REDIRECTS = {
    "/v1": "/",
    "/v2": "/",
    "/dashboard": "/observability",
    "/guide": "/slides",
}

OLD_FILES = [
    "/static/index.html",
    "/static/map.html",
    "/static/dashboard.html",
    "/static/guide.html",
    "/static/slides.html",
    "/static/slides.marketing.html",
    "/static/v2.html",
    "/static/observability.html",
    "/map.html",
    "/index.html",
]


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, _req, _fp, _code, _msg, _headers, _newurl):
        return None


_OPENER = urllib.request.build_opener(_NoRedirect)


@pytest.fixture(scope="module")
def base():
    with app_server() as url:
        yield url


def _get(base, path):
    try:
        with _OPENER.open(base + path, timeout=15) as r:
            return r.status, r.headers.get("Location"), r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.headers.get("Location"), e.read().decode("utf-8", "replace")


@pytest.mark.parametrize("path,target", sorted(REDIRECTS.items()))
def test_O4_old_addresses_forward_to_a_surviving_page(base, path, target):
    code, location, body = _get(base, path)
    assert code in (301, 302, 307, 308), f"{path} returned {code}, expected a permanent redirect"
    assert location, f"{path} redirected without a Location header"
    assert location.rstrip("/").endswith(target.rstrip("/")), f"{path} -> {location!r}, expected {target!r}"
    assert "<html" not in body.lower(), f"{path} still returns a page body"


@pytest.mark.parametrize("path", OLD_FILES)
def test_O5_no_old_page_file_is_reachable(base, path):
    code, location, body = _get(base, path)
    if code in (301, 302, 307, 308):
        assert location, f"{path} redirected without a Location header"
        return
    assert code == 404, f"{path} still answers with {code}"
    assert "<html" not in body.lower() or "not found" in body.lower(), f"{path} returns an old page"


def test_the_old_frontend_folder_is_gone():
    assert not (ROOT / "static").exists(), "the old frontend folder still exists; a retired page can come back"


def test_built_assets_are_content_hashed():
    html = (ROOT / "web" / "dist" / "index.html").read_text(encoding="utf-8")
    assets = re.findall(r'(?:src|href)="(/[^"]+\.(?:js|css))"', html)
    assert assets, "the built page references no script or stylesheet"
    for asset in assets:
        assert re.search(r"[-.][A-Za-z0-9_-]{8,}\.(?:js|css)$", asset), f"{asset} is not content-hashed"
