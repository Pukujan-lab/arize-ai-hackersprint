# Issue log: the v3 frontend regressed the reading experience

- **Date:** 2026-10-19
- **Reported by:** owner, after using the deployed build `3243847`
- **Scope:** Home (`/`, `/map`) and the map
- **Status:** open

The rebuild shipped every page and every gate, but the reading experience lost the things that made the
previous version usable. Each item below is an observation from the live build, the evidence behind it, and
what the page must do instead. The outcomes are stated in `docs/specs/2026-10-18-frontend-v3.md` as O65–O72.

## 1. The memo is raw Markdown

**Observed.** A saved run renders as one plain paragraph. The text on screen contains the Markdown source
itself: `**Short answer:**`, `### Key authorities`, `- **C.R.S. Title 38, Article** [1]`.

**Evidence.** The memo element's HTML is a single `<p class="whitespace-pre-wrap">` holding the whole answer;
the page contains no `<strong>`, no list and no heading.

**Must instead.** Headings, bold, lists, quotes and paragraphs render as formatted text. A citation
reference such as `[1]` is a link to that authority, so a reader can check the source from the sentence
that relies on it.

## 2. Sources cannot be checked from the memo

**Observed.** The memo has no clickable citation. The only way to see an authority is a `Sources` button in
the memo's control row, and that row is crowded out by five other buttons.

**Evidence.** The memo section contains zero links. `Sources`, `Follow-ups`, `Run info`, `Follow-up`,
`New question` and `Show map` all sit in the same row as `Listen`.

**Must instead.** A citation in the memo opens its authority. A single, obvious control opens the full
source list, and the list stays reachable at every width, including while the map pane is showing.

## 3. The control row is polluted after a run

**Observed.** After a question, seven buttons appear across the top of the memo pane. On a phone the row
wraps and pushes the memo down. Nothing closes itself.

**Must instead.** The row carries `Listen` and one control that opens a drawer. The drawer closes when the
reader picks something, presses Escape, or clicks outside it. The drawer holds sources, follow-ups, run
info, follow-up and new-question actions.

## 4. The map no longer looks three-dimensional

**Observed.** The map is a flat image with pins drawn on top. The previous version extruded the states,
raised Colorado, and moved a perspective camera through the scene.

**Evidence.** The map canvas exposes a 2D context (`getContext('2d')`), not WebGL.

**Must instead.** The map renders as a perspective scene: states are solid, extruded shapes, Colorado is
raised above them, and pins stand above the surface with their halos. The camera moves through the scene
rather than over a flat picture.

## 5. Zoom does not follow the jurisdiction

**Observed.** Zoom is a free scale factor. A reader can pull the map in or out but cannot ask "show me this
county" or "show me this court". Clicking a county only shows a tooltip.

**Must instead.** The map zooms by jurisdiction: clicking a county brings the camera to that county and
names it; clicking a court pin brings the camera to that court; zooming out steps back through county,
state and national views. The county labels appear at the county level and the court labels at the court
level.

## 6. The legend and attribution cover the map

**Observed.** A legend block, a summary line, a basemap switch and an attribution line are laid over the
map at all times. Together they take the top-left corner and the bottom edge of the drawing area.

**Must instead.** The legend, the basemap switch and the attribution live behind one `Map key` control and
are out of the way until opened. Nothing covers the map by default except the zoom controls and the tour
bar.

## 7. Live narration is gone

**Observed.** The tour shows a static block of text for the current stop. The previous version spoke the
memo's short answer first, then walked the stops with a transcript that advanced with the voice.

**Must instead.** `Listen` speaks the short answer and then starts the tour at stop one. Each stop is
spoken, and its transcript advances with the audio so a reader who cannot hear it still follows the walk.
A stop control stops both the voice and the transcript.

## 8. Visual quality

**Observed.** The complaints above combine into a page that is harder to read than the version it replaced:
raw text, a crowded header, chrome over the map, and no sense of depth.

**Must instead.** No control overlaps another, no map chrome overlaps a pin or a control, the composer stays
at the bottom, and the reading column keeps a consistent measure. The existing layout outcomes O47–O51
continue to hold at 360, 390, 768, 1024 and 1440 wide.
