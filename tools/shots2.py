import asyncio
from playwright.async_api import async_playwright
B="http://localhost:3000"; OUT="static/slides/"
async def main():
  async with async_playwright() as p:
    b=await p.chromium.launch(args=["--use-gl=swiftshader","--enable-webgl","--ignore-gpu-blocklist"])
    pg=await b.new_page(viewport={"width":1440,"height":900},device_scale_factor=2)
    await pg.goto(B+"/dashboard"); await pg.wait_for_timeout(3000)
    for k,f in [("daytona","dash_Daytona"),("surrealdb","dash_SurrealDB_card"),("arize","dash_Arize"),("elevenlabs","dash_ElevenLabs"),("acs","dash_ACS"),("octo","dash_Octo")]:
      await pg.locator("#"+k).screenshot(path=OUT+f+".png")
    await pg.goto(B+"/map"); await pg.wait_for_timeout(9000)
    await pg.locator("#docs3d").screenshot(path=OUT+"dash_SurrealDB.png")
    await pg.locator("aside").screenshot(path=OUT+"map_sidebar.png")
    await b.close()
asyncio.run(main())
