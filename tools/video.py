import asyncio,glob,os
from playwright.async_api import async_playwright
B="http://localhost:3000"
async def main():
  async with async_playwright() as p:
    b=await p.chromium.launch(args=["--use-gl=swiftshader","--enable-webgl","--ignore-gpu-blocklist"])
    c=await b.new_context(viewport={"width":1280,"height":720},record_video_dir="/tmp/vid",record_video_size={"width":1280,"height":720})
    pg=await c.new_page()
    await pg.goto(B+"/slides",wait_until="load"); await pg.wait_for_timeout(2500)
    await pg.screenshot(path="static/slides/_slides_check.png")
    await pg.goto(B+"/",wait_until="load"); await pg.wait_for_timeout(4000)
    chip=pg.locator("text=water rights").first
    if await chip.count(): await chip.click()
    await pg.wait_for_timeout(25000)
    await pg.mouse.wheel(0,600); await pg.wait_for_timeout(5000)
    await pg.mouse.wheel(0,-600); await pg.wait_for_timeout(5000)
    await pg.goto(B+"/dashboard",wait_until="load"); await pg.wait_for_timeout(3000)
    for t in ["SurrealDB","Daytona","ACS","Arize","ElevenLabs","Octo"]:
      l=pg.locator(f"button:has-text('{t}')").first
      if await l.count(): await l.click(); await pg.wait_for_timeout(2500)
    await pg.goto(B+"/slides",wait_until="load"); await pg.wait_for_timeout(2500)
    for i in range(9):
      await pg.keyboard.press("ArrowRight"); await pg.wait_for_timeout(2200)
    await c.close(); await b.close()
asyncio.run(main())
