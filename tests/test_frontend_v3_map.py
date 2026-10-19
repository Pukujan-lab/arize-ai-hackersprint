"""O17-O23, O25, O26 and O28: the map draws the counties and pins the run supports, colours and scales them
from the run's data, draws typed links, explains what is under the pointer, focuses on a click but not a drag,
moves and resets the camera, survives a missing basemap, and still draws without the 3D renderer."""

import pytest

from ui_server import (
    DESKTOP,
    app_server,
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

RUN = load_fixture("run-spread.json")
GOLDEN = load_fixture("tour_parity_spread.json")
RUN_ID = RUN["run_id"]


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


def _open(browser, base, path="/map", width=DESKTOP, setup=None):
    def install(page):
        serve_run(page, RUN, RUN_ID)
        if setup:
            setup(page)

    ctx, page = open_page(browser, base, f"{path}?run={RUN_ID}", width, setup=install)
    map_ready(page)
    return ctx, page


def test_O17_the_map_renders_the_country_and_the_county_layer(base, browser):
    ctx, page = _open(browser, base)
    assert map_call(page, "countyMeshCount") > 0, "no county polygons were rendered"
    assert map_call(page, "stateMeshCount") >= 50, "the extruded country is not rendered"
    ctx.close()


def test_O18_counties_are_counted_and_the_legend_states_the_counts(base, browser):
    ctx, page = _open(browser, base)
    heat = map_call(page, "countyHeat()")
    assert heat == GOLDEN["countyHeat"], f"county heat {heat} != golden {GOLDEN['countyHeat']}"
    text = page.inner_text("body")
    assert "counties linked" in text.lower(), "the legend does not state the county count"
    assert str(GOLDEN["countyCount"]) in text, "the legend does not state the number of counties with cases"
    ctx.close()


def test_O19_each_citation_group_is_one_pin_coloured_and_sized_by_its_data(base, browser):
    ctx, page = _open(browser, base)
    pins = map_call(page, "pins()")
    got = sorted((p["key"], p["cat"], p["count"]) for p in pins)
    want = sorted((p["key"], p["cat"], p["count"]) for p in GOLDEN["pins"])
    assert got == want, f"pins {got} != golden {want}"
    assert map_call(page, "pinCount") == len(GOLDEN["pins"])
    ctx.close()


def test_O20_links_are_drawn_and_typed(base, browser):
    ctx, page = _open(browser, base)
    assert map_call(page, "arcCounts") == GOLDEN["arcCounts"], f"arc counts {map_call(page, 'arcCounts')} != golden {GOLDEN['arcCounts']}"
    ctx.close()


def test_O21_hovering_a_pin_or_a_county_explains_it_and_clears_on_leave(base, browser):
    ctx, page = _open(browser, base)
    stop = GOLDEN["stops"][0]
    pin = page.get_by_role("button", name=stop["title"], exact=False).first
    pin.hover()
    page.wait_for_timeout(300)
    shown = map_call(page, "tooltip()") or ""
    assert stop["title"] in shown, f"hovering the pin showed {shown!r}"

    page.mouse.move(2, 2)
    page.wait_for_timeout(300)
    assert not map_call(page, "tooltip()"), "the tooltip did not clear when the pointer left"

    county = next(iter(GOLDEN["countyHeat"]))
    page.evaluate("(c) => window.__precedentMap.v1.hoverCounty(c)", county)
    page.wait_for_timeout(300)
    shown = map_call(page, "tooltip()") or ""
    assert county.lower() in shown.lower(), f"hovering {county} showed {shown!r}"
    assert str(GOLDEN["countyHeat"][county]) in shown, "the county tooltip omits the case count"

    page.evaluate("() => window.__precedentMap.v1.hoverCounty(null)")
    page.wait_for_timeout(300)
    assert not map_call(page, "tooltip()"), "the county tooltip did not clear"
    ctx.close()


def test_O22_a_click_focuses_a_pin_and_a_drag_does_not(base, browser):
    ctx, page = _open(browser, base)
    stop = GOLDEN["stops"][0]
    pin = page.get_by_role("button", name=stop["title"], exact=False).first
    box = pin.bounding_box()
    assert box, "the pin has no box to point at"

    page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    page.mouse.down()
    page.mouse.move(box["x"] + box["width"] / 2 + 60, box["y"] + box["height"] / 2 + 40, steps=8)
    page.mouse.up()
    page.wait_for_timeout(400)
    assert map_call(page, "state().focus") is None, "a drag was treated as a click"

    pin.click()
    page.wait_for_timeout(400)
    assert map_call(page, "state().focus") is not None, "clicking a pin did not focus it"
    ctx.close()


def test_O23_the_camera_moves_to_a_citation_and_resets(base, browser):
    ctx, page = _open(browser, base)
    national = map_call(page, "state().camera")
    index = GOLDEN["order"][-1]
    page.evaluate("(i) => window.__precedentMap.v1.focus(i)", index)
    page.wait_for_timeout(1200)
    focused = map_call(page, "state().camera")
    assert focused != national, "the camera did not move to the focused citation"
    page.evaluate("() => window.__precedentMap.v1.resetCamera()")
    page.wait_for_timeout(1200)
    assert map_call(page, "state().camera") == national, "reset did not return to the national view"
    ctx.close()


def test_O25_the_basemap_can_be_turned_off_without_losing_the_map(base, browser):
    ctx, page = _open(browser, base)
    before = (map_call(page, "pinCount"), map_call(page, "countyMeshCount"), map_call(page, "arcCounts"))
    page.get_by_role("checkbox", name="Basemap").uncheck()
    page.wait_for_timeout(800)
    after = (map_call(page, "pinCount"), map_call(page, "countyMeshCount"), map_call(page, "arcCounts"))
    assert after == before, f"turning the basemap off changed the map: {before} -> {after}"
    ctx.close()


def test_O26_an_unreachable_basemap_leaves_a_working_map_and_no_error(base, browser):
    def block_external(page):
        page.route(
            "**/*",
            lambda r: r.abort() if not r.request.url.startswith("http://127.0.0.1") else r.continue_(),
        )

    ctx, page = _open(browser, base, setup=block_external)
    assert map_call(page, "pinCount") > 0, "no pins without the basemap"
    assert map_call(page, "countyMeshCount") > 0, "no counties without the basemap"
    text = page.inner_text("body").lower()
    assert "error" not in text and "failed to load" not in text, "the reader is told the basemap failed"
    ctx.close()


def test_O28_the_map_still_draws_without_a_3d_renderer(base, browser):
    def no_webgl(page):
        page.add_init_script(
            """
            const real = HTMLCanvasElement.prototype.getContext;
            HTMLCanvasElement.prototype.getContext = function (kind, ...rest) {
              if (/webgl/i.test(String(kind))) return null;
              return real.call(this, kind, ...rest);
            };
            """
        )

    ctx, page = _open(browser, base, setup=no_webgl)
    assert map_call(page, "pinCount") > 0, "no pins without WebGL"
    assert map_call(page, "countyMeshCount") > 0, "no counties without WebGL"
    assert "counties linked" in page.inner_text("body").lower(), "the legend is missing without WebGL"
    ctx.close()
