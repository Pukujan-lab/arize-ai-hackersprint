"""Measure client time-to-first-token and time-to-answer on / (fresh + cached question)."""

import sys, json
from playwright.sync_api import sync_playwright

qs = sys.argv[1:] or ["Water rights priority dispute between ranchers"]
with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"])
    pg = b.new_page()
    pg.goto("http://localhost:3000/", wait_until="load")
    pg.wait_for_timeout(2000)
    for q in qs:
        pg.fill("#q", q)
        pg.click("#go")
        pg.wait_for_function("window.__total>0", timeout=60000)
        print(
            json.dumps(
                {
                    "q": q,
                    "ttft_ms": round(pg.evaluate("window.__ttft||0")),
                    "answer_ms": round(pg.evaluate("window.__total")),
                    "visible": "Short answer" in pg.inner_text("#answer"),
                }
            )
        )
        pg.wait_for_timeout(3000)
        pg.evaluate("window.__total=0")
    b.close()
