import asyncio
from playwright.async_api import async_playwright

B = "http://localhost:3000"
W = lambda pg, ms: pg.wait_for_timeout(ms)


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"])
        c = await b.new_context(viewport={"width": 1280, "height": 720}, record_video_dir="/tmp/vid", record_video_size={"width": 1280, "height": 720})
        pg = await c.new_page()
        await pg.goto(B + "/slides")
        await W(pg, 3500)
        await pg.keyboard.press("ArrowRight")
        await W(pg, 3500)
        await pg.goto(B + "/")
        await W(pg, 2500)
        await pg.fill("#q", "Water rights priority dispute between ranchers")
        await W(pg, 600)
        await pg.click("#go")
        await W(pg, 9000)
        await pg.mouse.wheel(0, 450)
        await W(pg, 5000)
        await pg.mouse.wheel(0, 500)
        await W(pg, 5000)
        await pg.goto(B + "/map")
        await W(pg, 7000)
        await pg.evaluate("Docs3D.focus(0);Docs3D.open(Docs3D._c[0])")
        await W(pg, 5000)
        await pg.evaluate("Docs3D.focus(2);Docs3D.open(Docs3D._c[2])")
        await W(pg, 4000)
        await pg.goto(B + "/dashboard")
        await W(pg, 4000)
        for y in (500, 500, 500, 600):
            await pg.mouse.wheel(0, y)
            await W(pg, 2500)
        await pg.goto(B + "/slides")
        await W(pg, 1500)
        for i in range(10):
            await pg.keyboard.press("ArrowRight")
            await W(pg, 2300)
        await c.close()
        await b.close()


asyncio.run(main())
