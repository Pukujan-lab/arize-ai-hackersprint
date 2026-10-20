"""SEO routes: each surviving page carries unique head tags, and the sitemap lists exactly the surviving pages.
Retired addresses forward (see test_retired_routes.py) and are not advertised."""

import os, sys, re, pathlib

sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))
os.environ.setdefault("LLM_MODE", "fake")
from fastapi.testclient import TestClient
from app import server

BASE = "https://arize.design-bakery.com"
PAGES = ["/"]
c = TestClient(server.app)


def head(p):
    r = c.get(p)
    assert r.status_code == 200, p
    return r.text.split("</head>")[0]


def meta(h, attr, name):
    m = re.search(r'<meta\s+%s="%s"\s+content="([^"]+)"' % (attr, re.escape(name)), h)
    return m and m.group(1)


def test_pages_have_unique_seo_tags():
    titles, descs = set(), set()
    for p in PAGES:
        h = head(p)
        t = re.findall(r"<title>([^<]+)</title>", h)
        assert len(t) == 1, p
        d = meta(h, "name", "description")
        assert d and 120 <= len(d) <= 170, (p, d and len(d))
        titles.add(t[0])
        descs.add(d)
        assert f'<link rel="canonical" href="{BASE}{p}">' in h, p
        for k in ("og:title", "og:description", "og:image", "og:url"):
            assert meta(h, "property", k), (p, k)
        assert meta(h, "property", "og:url") == BASE + p
        assert meta(h, "property", "og:image") == BASE + "/og.png"
        assert meta(h, "name", "twitter:card") == "summary_large_image", p
        assert meta(h, "name", "theme-color"), p
        icon = re.search(r'<link[^>]+rel=["\']icon["\'][^>]+href=["\']([^"\']+)["\']', h)
        assert icon, f"{p}: no icon in the head"
        assert "/static/" not in icon.group(1), f"{p}: the icon comes from the retired frontend folder"
        assert "noindex" not in h, p
    assert len(titles) == len(PAGES) and len(descs) == len(PAGES)


def test_home_jsonld():
    assert '"@type": "SoftwareApplication"' in head("/")


def test_robots():
    r = c.get("/robots.txt")
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/plain")
    assert "Allow: /" in r.text and f"Sitemap: {BASE}/sitemap.xml" in r.text


def test_sitemap():
    r = c.get("/sitemap.xml")
    assert r.status_code == 200 and "xml" in r.headers["content-type"]
    for p in PAGES:
        assert f"<loc>{BASE}{p}</loc>" in r.text
    for retired in ("/dashboard", "/guide", "/v1", "/v2"):
        assert retired not in r.text, f"the sitemap still advertises {retired}"
    assert "/api/" not in r.text


def test_og_png():
    r = c.get("/og.png")
    assert r.status_code == 200 and r.content[:8] == b"\x89PNG\r\n\x1a\n"
    import struct

    assert struct.unpack(">II", r.content[16:24]) == (1200, 630)
