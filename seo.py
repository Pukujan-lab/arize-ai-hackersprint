"""SEO routes: /robots.txt, /sitemap.xml, /og.png (public pages only; no API routes)."""

import pathlib
from fastapi.responses import PlainTextResponse, Response, FileResponse

BASE = "https://arize.design-bakery.com"
PAGES = ["/", "/dashboard", "/slides", "/map", "/observability", "/guide"]
STATIC = pathlib.Path(__file__).parent / "static"


def install(app):
    @app.get("/robots.txt", include_in_schema=False)
    def robots():
        return PlainTextResponse(f"User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: {BASE}/sitemap.xml\n")

    @app.get("/sitemap.xml", include_in_schema=False)
    def sitemap():
        urls = "".join(f"<url><loc>{BASE}{p}</loc><changefreq>weekly</changefreq><priority>{'1.0' if p == '/' else '0.7'}</priority></url>" for p in PAGES)
        return Response(
            '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + urls + "</urlset>\n",
            media_type="application/xml",
        )

    @app.get("/og.png", include_in_schema=False)
    def og():
        return FileResponse(STATIC / "og.png", media_type="image/png")
