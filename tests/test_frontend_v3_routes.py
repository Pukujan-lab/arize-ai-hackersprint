"""O1-O3 and O52: four pages, each with its own title, description and canonical URL in the initial HTML,
and a build id that names the commit the page was built from."""

import re
import urllib.request

import pytest

from ui_server import MOBILE, V3_PAGES, app_server, map_call, map_ready, needs_chromium, needs_v3, open_page

pytestmark = needs_v3


@pytest.fixture(scope="module")
def base():
    with app_server() as url:
        yield url


@pytest.fixture(scope="module")
def browser():
    sync_api = pytest.importorskip("playwright.sync_api")
    with sync_api.sync_playwright() as p:
        b = p.chromium.launch(args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader"])
        yield b
        b.close()


def _initial(base, path):
    with urllib.request.urlopen(base + path, timeout=15) as r:
        assert r.status == 200, f"{path} returned {r.status}"
        return r.read().decode("utf-8", "replace")


def _meta(html, pattern):
    m = re.search(pattern, html, re.I | re.S)
    return m.group(1).strip() if m else None


@pytest.mark.parametrize("path", V3_PAGES)
def test_O1_O3_each_page_has_its_own_metadata_in_the_initial_html(base, path):
    html = _initial(base, path)
    title = _meta(html, r"<title[^>]*>(.*?)</title>")
    desc = _meta(html, r'<meta[^>]+name=["\']description["\'][^>]+content=["\']([^"\']*)["\']')
    canon = _meta(html, r'<link[^>]+rel=["\']canonical["\'][^>]+href=["\']([^"\']*)["\']')
    assert title, f"{path}: no title in the initial HTML"
    assert desc, f"{path}: no meta description in the initial HTML"
    assert canon, f"{path}: no canonical link in the initial HTML"
    want = path if path != "/" else "/"
    assert canon.rstrip("/").endswith(want.rstrip("/")), f"{path}: canonical points at {canon!r}"


def test_O1_O3_titles_are_unique(base):
    titles = {}
    for path in V3_PAGES:
        t = _meta(_initial(base, path), r"<title[^>]*>(.*?)</title>")
        assert t not in titles, f"{path} and {titles[t]} share the title {t!r}"
        titles[t] = path


@pytest.mark.parametrize("width", [MOBILE, 1440])
@needs_chromium
def test_O2_map_opens_the_home_document_on_the_map_pane(base, browser, width):
    home = _meta(_initial(base, "/"), r"<title[^>]*>(.*?)</title>")
    map_title = _meta(_initial(base, "/map"), r"<title[^>]*>(.*?)</title>")
    assert map_title != home, "/map and / share a title; /map is not its own page"
    ctx, page = open_page(browser, base, "/map", width)
    map_ready(page)
    assert map_call(page, "state().pane") == "map", f"/map opened on another pane @{width}"
    ctx.close()


def test_O52_the_page_reports_the_commit_it_was_built_from(base):
    for path in V3_PAGES:
        html = _initial(base, path)
        build = _meta(html, r'<meta[^>]+name=["\']build-id["\'][^>]+content=["\']([^"\']+)["\']')
        assert build, f"{path}: no build-id meta; a deploy cannot be tied to a commit"


def test_O43_observability_links_back_to_home(base):
    html = _initial(base, "/observability")
    assert re.search(r'<a[^>]+href=["\']/["\']', html), "/observability has no link back to Home"
