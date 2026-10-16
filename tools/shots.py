import asyncio, sys
from playwright.async_api import async_playwright
B="http://localhost:3000"; OUT="static/slides/"
Q=sys.argv[1] if len(sys.argv)>1 else "Water rights priority dispute between ranchers"
async def main():
    async with async_playwright() as p:
        br=await p.chromium.launch(args=["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist"])
        pg=await br.new_page(viewport={"width":1600,"height":1000}, device_scale_factor=1)
        errs=[]; pg.on("pageerror", lambda e: errs.append(str(e)))
        await pg.goto(B+"/"); await pg.wait_for_timeout(1500)
        await pg.evaluate("q=>window.PRECEDENT.ask(q)", Q); await pg.wait_for_timeout(2500)
        await pg.screenshot(path=OUT+"map_us.png")
        await pg.wait_for_timeout(5500); await pg.screenshot(path=OUT+"map_pins.png")
        await pg.evaluate("window.scrollTo(0, 650)"); await pg.wait_for_timeout(600); await pg.screenshot(path=OUT+"answer.png")
        for t in ["Overview","SurrealDB","Daytona","ACS","Arize","ElevenLabs","Octo","Model"]:
            await pg.goto(B+"/dashboard#"+t); await pg.wait_for_timeout(4500 if t=="SurrealDB" else 2500); await pg.screenshot(path=OUT+f"dash_{t}.png")
        print("errors:", errs[:5]); await br.close()
asyncio.run(main())
