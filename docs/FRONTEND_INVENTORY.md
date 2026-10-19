# Frontend inventory

What every page shows, which file owns each control, and which API route it calls. Built from the code in `web/` (October 2026), not from screenshots. API routes match `contracts/openapi.json`. `tests/test_frontend_inventory.py` fails if an HTML route in openapi.json has no section here, so add a section when you add a page.

There is no `/runs` page. Run history is the `/api/runs` JSON route, listed on `/observability`; Home opens one of the reader's saved runs from the `Open a saved run` panel, or by `?run=` on the URL.

## Layout

- `web/src/pages/` — one file per page: `Index.tsx` (Home and `/map`), `Observability.tsx`, `Slides.tsx`.
- `web/src/components/` — `SiteHeader.tsx` (the one navigation), `MapPane.tsx` (the map pane, the authority detail and the tour controls), `Memo.tsx` (the memo as formatted text, with its citation links), `SourcesPanel.tsx` (the source list), and the UI primitives under `ui/`.
- `web/src/map/` — `engine.ts` (camera, pins, arcs, focus, tour state, mute, the `window.__precedentMap.v1` debug object), `narrator.ts` (speech, clip fetching and timing), `gl.ts` (the WebGL renderer), `debug.ts` (the debug surface).
- `web/src/lib/` — `citations.ts` (where a citation sits on the map and how it is labelled), `geo.ts` (state and county shapes), `explain.ts` (what a tour stop says), `runs.ts` (the shapes of the run data the server returns), `session.ts` (the device session id).
- `web/public/` — assets served as-is: `logo.svg`, `og.png`, `robots.txt`, `vendor/` (projection data and the d3 builds it needs).

The map is drawn on a canvas with WebGL, with a 2D fallback. It exposes `window.__precedentMap.v1` so behaviour can be asserted without reading pixels; see the spec's verification contract.

## Shared across pages

| Control | Accessible name / id | Owner | API |
|---|---|---|---|
| Navigation: Home, Map, Observability, Slides, in that order, one landmark | `nav[aria-label="Primary"]` | `SiteHeader.tsx` | none |
| Device session header on every `/api` call | `X-Session-Id` | `lib/session.ts` | all `/api/*` |

Every page renders in light or dark from the system setting; there is no theme toggle. The tokens are in `web/src/globals.css`.

## `/`

Home. File: `web/src/pages/Index.tsx`. Opens on the memo pane, with the map pane alongside at wide widths and behind the `Show map` control below that.

| Control | Accessible name | Owner | API |
|---|---|---|---|
| Question box | `Ask a question` | `Index.tsx` | none |
| Ask | `Ask` | `Index.tsx` | `POST /api/ask`, then `GET /api/run/{id}` |
| The stage the run has reached, with the answer as it is written | `Run progress` | `Index.tsx` | `GET /api/run/{id}` (`events`, `partial`) |
| How the answer was produced: the citation check, references verified, run time, answer source | `Answer status` | `Index.tsx` | `GET /api/run/{id}` |
| A first-visit cue with example questions, remembered once dismissed | `Getting started`, `Dismiss getting started` | `Index.tsx` | none |
| The hint an empty question gets | `Question needed` | `Index.tsx` | none |
| Listen / Stop listening, in the memo header, one control for memo and tour narration | `Listen`, `Stop listening` | `Index.tsx` | `POST /api/tts_ts` |
| Silence all narration, and back | `Mute`, `Unmute` | `Index.tsx` | none |
| A clip being fetched | `Audio loading` | `Index.tsx` | `POST /api/tts_ts` |
| The one drawer, holding Sources, Follow-ups, Run info, Follow-up and New question | `Memo menu` | `Index.tsx` | none |
| The source list, with each authority's kind, court, date, citation and passage | `Sources` | `SourcesPanel.tsx` | none |
| Follow-ups | `Follow-ups` | `Index.tsx` | `POST /api/ask` with `prev_run_id` |
| Run info | `Run info` | `Index.tsx` | none |
| Follow-up, replacing the question box's Ask after a memo | `Follow-up` | `Index.tsx` | `POST /api/ask` with `prev_run_id` |
| New question, dropping the thread | `New question` | `Index.tsx` | none |
| The reader's saved runs, listed by question, loading the one chosen | `Open a saved run`, `Saved runs` | `Index.tsx` | `GET /api/runs`, then `GET /api/run/{id}` |
| Show map / Show memo, below the wide breakpoint | `Show map`, `Show memo` | `Index.tsx`, `MapPane.tsx` | none |
| Open one saved run by address | `?run=<id>` on the URL | `Index.tsx` | `GET /api/run/{id}` |

Behaviour notes:

- While a run works, `Run progress` names the stage the pipeline has reached and shows the draft as it is written; when the result lands the draft is replaced by the finished memo and the region goes away.
- `Answer status` says what each figure counts: the citation check and the references it verified, the run time in seconds, and whether the answer came from a cache or an offline template.
- After a memo, narration of the memo completes before the tour starts at stop 1. The one `Listen` control drives both; there is no second speaker control in the tour bar.
- `Mute` silences every narration and becomes `Unmute`; a muted tour keeps walking, silently. Escape stops the voice and the tour.
- The source list states the kind of authority, court, date and citation for every authority, quotes the passage when one was retrieved, and says an authority came from the citation graph when none was.
- The `Memo menu` drawer closes when the reader chooses an action, presses Escape, or clicks outside it.
- A failed question says so and leaves the previous memo in place; it never shows a blank pane.

## `/map`

The same document as `/`, opened on the map pane, with its own title, description and canonical URL. File: `web/src/pages/Index.tsx`, selected by the route.

| Control | Accessible name | Owner | API |
|---|---|---|---|
| Every control on the page | see `/` | `Index.tsx` | see `/` |
| Each pin, named by the titles it stands for | the citation titles, joined by `; ` | `MapPane.tsx` | none |
| The authority behind a pin: title, kind, court, date, passage and link | `Authority`, closed by `Close` | `MapPane.tsx` | none |
| Legend, basemap switch and attribution, behind one control | `Map key` | `MapPane.tsx` | none |
| Basemap on or off | `Basemap` | `MapPane.tsx` | none |
| Zoom in / out by jurisdiction / back to the national view | `Zoom in`, `Zoom out`, `Reset view` | `MapPane.tsx` | none |
| Previous stop / Pause or Play / Next stop | `Previous stop`, `Pause`, `Play`, `Next stop` | `MapPane.tsx` | `POST /api/tts_ts` |
| Stop the tour | `Stop tour` | `MapPane.tsx` | none |
| What the current stop says | `Tour transcript` | `MapPane.tsx` | none |

Behaviour notes:

- Hovering a pin names the titles it represents; hovering a county names it and its case count. Both clear when the pointer leaves.
- A click or tap on a pin opens the authority behind it; one detail is open at a time, a second pin replaces the first, and Escape or `Close` dismisses it. A drag never counts as a click. Dragging or scrolling the map stops the tour.
- A pin is one place: the authorities that resolve to the same place share it, and `pinCites(i)` reports exactly the citations a pin stands for.
- With the basemap off, counties, pins and links still render. If the basemap provider is unreachable, the map renders without it and says nothing to the reader.
- With reduced motion requested, camera moves jump instead of animating.

## `/observability`

Saved runs, their steps and their timings. File: `web/src/pages/Observability.tsx`.

| Control | Accessible name | Owner | API |
|---|---|---|---|
| A saved run, named by its question | the run's question | `Observability.tsx` | `GET /api/runs` |
| Raw details of a step | `Raw details` | `Observability.tsx` | `GET /api/run/{id}` |
| Retry after the source fails | `Try again` | `Observability.tsx` | `GET /api/runs` |
| Arize judge scores, one row per snapshot trace | `Arize evals` | `Observability.tsx` | `GET /api/arize` |
| A trace's judge explanations | `Judge explanations` | `Observability.tsx` | `GET /api/arize` |
| The live run a snapshot trace belongs to | `Open run` | `Observability.tsx` | none |
| One trace's span waterfall | `Trace waterfall` | `Observability.tsx` | `GET /api/arize` |
| The trace whose spans are drawn | `Trace` | `Observability.tsx` | `GET /api/arize` |

The page lists only the runs this device asked for: the server scopes `/api/runs` by the `X-Session-Id` header. The selected run shows its question, how long it took, the provider, and its pipeline steps in order with the time of each and the gap before it. When the source is unavailable the page says so and offers a retry rather than showing an empty or broken view.

`Arize evals` merges the snapshot exported from Arize with the live runs: a trace whose run is also on disk is listed once and marked live, any other trace is listed as snapshot-only, and the page states in words when the snapshot was taken. The judge scores are that snapshot, never live values and never recomputed; a judge the snapshot did not carry is absent, not `0`. When the snapshot cannot be read the region says so and the live runs stay on the page. `Trace waterfall` draws one chosen trace's spans, one line per span, indented by its parent, and says so when a trace has no spans.

## `/slides`

The deck. File: `web/src/pages/Slides.tsx`. One slide at a time, six in total.

| Control | Accessible name | Owner | API |
|---|---|---|---|
| Advance, from the keyboard or a click on the slide | ArrowRight | `Slides.tsx` | none |
| Go back, from the keyboard | ArrowLeft | `Slides.tsx` | none |
| Previous slide / Next slide, disabled at the ends | `Previous slide`, `Next slide` | `Slides.tsx` | none |
| Position | `Slide n of N` | `Slides.tsx` | none |
| Start your own question | `Ask your own question` → `/` | `Slides.tsx` | none |
