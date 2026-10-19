"""O68-O70 and O72: the map is a perspective three-dimensional scene, zoom follows the jurisdiction
(county, court, state, national), the legend and attribution live behind one map key, and the chrome
does not cover itself or the drawing at any supported width."""

import pytest

from ui_server import (
    DESKTOP,
    app_server,
    covered,
    horizontal_overflow,
    load_fixture,
    map_call,
    map_ready,
    needs_chromium,
    needs_v3,
    open_page,
    serve_run,
)

sync_api = pytest.importorskip("playwright.sync_api")
pytestmark = [needs_chromium, needs_v3]

RUN = load_fixture("run-parity.json")
RUN_ID = RUN["run_id"]
COURT_INDEX = 7  # Thornburg v. Homestead Minerals Corp., a Colorado state court
COURT_TITLE = RUN["citations"][COURT_INDEX]["title"]

WIDTHS = [360, 390, 768, 1024, 1440]
CHROME = "[aria-label='Zoom in'], [aria-label='Zoom out'], [aria-label='Reset view'], [aria-label='Map key']"


@pytest.fixture(scope="module")
def base():
    with app_server() as url:
        yield url


@pytest.fixture(scope="module")
def browser():
    with sync_api.sync_playwright() as p:
        b = p.chromium.launch(args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader"])
        yield b
        b.close()


def _open(browser, base, width=DESKTOP):
    ctx, page = open_page(browser, base, f"/map?run={RUN_ID}", width, setup=lambda p: serve_run(p, RUN, RUN_ID))
    map_ready(page)
    page.wait_for_timeout(600)
    return ctx, page


def _click_canvas(page, point):
    box = page.locator("canvas").first.bounding_box()
    assert box, "the map canvas has no box"
    page.mouse.click(box["x"] + point["x"], box["y"] + point["y"])


def _state(page):
    return map_call(page, "state()")


def test_O68_the_map_is_a_perspective_three_dimensional_scene(base, browser):
    ctx, page = _open(browser, base)
    scene = _state(page)["scene"]

    assert scene["mode"] == "3d", f"the map renders flat: {scene}"
    assert scene["stateMeshes"] > 0, "the map draws no state solids"
    assert scene["countyMeshes"] > 0, "the map draws no Colorado counties"
    assert scene["coloradoRaised"] is True, "Colorado is not raised above the surrounding states"

    surface = page.evaluate(
        """() => {
          const c = document.querySelector('canvas');
          if (!c) return {webgl: false, flat: true};
          return {webgl: !!(c.getContext('webgl2') || c.getContext('webgl')), flat: c.getContext('2d') !== null};
        }"""
    )
    assert surface["webgl"] and not surface["flat"], f"the map canvas is not a three-dimensional surface: {surface}"
    ctx.close()


def test_O69_the_map_zooms_by_county_and_by_court(base, browser):
    ctx, page = _open(browser, base)
    start = _state(page)
    assert start["level"] == "national", f"the map does not open at the national view: {start['level']}"

    county_point = map_call(page, "countyScreen('boulder')")
    assert county_point, "the map cannot place Boulder County"
    _click_canvas(page, county_point)
    page.wait_for_timeout(1200)

    county = _state(page)
    assert county["level"] == "county", f"clicking a county left the map at {county['level']}"
    assert "boulder" in (county["focusCounty"] or "").lower(), f"the map focused {county['focusCounty']}, not Boulder"
    assert "boulder" in (county["label"] or "").lower(), "the county is not named at the county level"
    assert county["camera"]["zoom"] > start["camera"]["zoom"], "the camera did not move closer to the county"

    court_point = map_call(page, f"pinScreen({COURT_INDEX})")
    assert court_point, "the map cannot place the court's pin"
    _click_canvas(page, court_point)
    page.wait_for_timeout(1200)

    court = _state(page)
    assert court["level"] == "court", f"clicking a court pin left the map at {court['level']}"
    assert court["focus"] == COURT_INDEX, "the map did not focus the court that was clicked"
    assert COURT_TITLE.lower()[:20] in (court["label"] or "").lower(), "the court is not named at the court level"
    assert court["camera"]["zoom"] > county["camera"]["zoom"], "the camera did not move closer to the court"

    for expected in ("county", "state", "national"):
        page.get_by_role("button", name="Zoom out").click()
        page.wait_for_timeout(900)
        assert _state(page)["level"] == expected, f"zooming out did not step back to the {expected} view"
    ctx.close()


def test_O70_the_map_key_holds_the_legend_and_attribution(base, browser):
    ctx, page = _open(browser, base)

    key = page.get_by_role("button", name="Map key", exact=True)
    assert key.is_visible(), "the map has no Map key control"
    assert not page.get_by_text("county↔county").is_visible(), "the legend covers the map before it is asked for"
    assert not page.get_by_role("checkbox", name="Basemap").is_visible(), "the basemap switch covers the map"

    key.click()
    assert page.get_by_text("county↔county").is_visible(), "the Map key opened no legend"
    assert page.get_by_role("checkbox", name="Basemap").is_visible(), "the Map key opened no basemap switch"
    assert page.get_by_text("Basemap ©", exact=False).is_visible(), "the Map key opened no attribution"

    page.keyboard.press("Escape")
    assert not page.get_by_text("county↔county").is_visible(), "Escape did not close the Map key"
    ctx.close()


@pytest.mark.parametrize("width", WIDTHS)
def test_O72_the_map_chrome_does_not_cover_itself_or_the_drawing(base, browser, width):
    ctx, page = _open(browser, base, width)
    assert horizontal_overflow(page) == 0, f"the map overflows horizontally at {width}px"
    assert covered(page, CHROME) == [], f"map chrome is covered by another element at {width}px"

    overlaps = page.evaluate(
        """(sel) => {
          const els = [...document.querySelectorAll(sel)].filter(el => el.offsetParent !== null);
          const boxes = els.map(el => ({el, r: el.getBoundingClientRect()}));
          const hits = [];
          for (let i = 0; i < boxes.length; i += 1) {
            for (let j = i + 1; j < boxes.length; j += 1) {
              const a = boxes[i].r, b = boxes[j].r;
              if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) {
                hits.push([els[i].getAttribute('aria-label'), els[j].getAttribute('aria-label')]);
              }
            }
          }
          return hits;
        }""",
        CHROME,
    )
    assert overlaps == [], f"map controls overlap at {width}px: {overlaps}"
    ctx.close()
