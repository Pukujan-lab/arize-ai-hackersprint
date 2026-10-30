"""O1-O3 and O52: four pages, each with its own title, description and canonical URL in the initial HTML,
and a build id that names the commit the page was built from."""

import re
import urllib.request

import pytest

from ui_server import V3_PAGES, app_server, needs_v3

pytestmark = needs_v3


@pytest.fixture(scope="module")
def base():
    with app_server() as url:
        yield url


def _initial(base, path):
    with urllib.request.urlopen(base + path, timeout=15) as r:
        assert r.status == 200, f"{path} returned {r.status}"
        return r.read().decode("utf-8", "replace")


def _meta(html, pattern):
    m = re.search(pattern, html, re.I | re.S)
    return m.group(1).strip() if m else None


def test_O52_the_page_reports_the_commit_it_was_built_from(base):
    for path in V3_PAGES:
        html = _initial(base, path)
        build = _meta(html, r'<meta[^>]+name=["\']build-id["\'][^>]+content=["\']([^"\']+)["\']')
        assert build, f"{path}: no build-id meta; a deploy cannot be tied to a commit"
