# Frontend inventory

What every page shows, which file owns each control, and which API route it calls. Built from the code in `web/` (October 2026), not from screenshots. API routes match `contracts/openapi.json`. `tests/test_frontend_inventory.py` fails if an HTML route in openapi.json has no section here, so add a section when you add a page.

There is no `/runs` page. Run history is the `/api/runs` JSON route, listed on `/observability`; Home opens one saved run by id (`?run=`).

## Layout

- `web/src/pages/` — one file per page: `Index.tsx` (Home and `/map`), `Observability.tsx`, `Slides.tsx`.
- `web/src/components/` — `SiteHeader.tsx` (the one navigation), `MapPane.tsx` (the map pane and tour controls), and the UI primitives under `ui/`.
- `web/src/map/` — `engine.ts` (camera, pins, arcs, focus, tour state, the `window.__precedentMap.v1` debug object), `narrator.ts` (speech and timing).
- `web/src/lib/` — `citations.ts` (where a citation sits on the map and how it is labelled), `geo.ts` (state and county shapes), `session.ts` (the device session id).
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
| Listen / Stop listening, in the memo header, one control for memo and tour narration | `Listen`, `Stop listening` | `Index.tsx` | `POST /api/tts_ts` |
| Sources, opening a dialog that links to the original documents | `Sources` | `Index.tsx` | none |
| Follow-ups | `Follow-ups` | `Index.tsx` | `POST /api/ask` with `prev_run_id` |
| Run info | `Run info` | `Index.tsx` | none |
| Follow-up, replacing the question box's Ask after a memo | `Follow-up` | `Index.tsx` | `POST /api/ask` with `prev_run_id` |
| New question, dropping the thread | `New question` | `Index.tsx` | none |
| Show map / Show memo, below the wide breakpoint | `Show map`, `Show memo` | `Index.tsx`, `MapPane.tsx` | none |
| Open one saved run | `?run=<id>` on the URL | `Index.tsx` | `GET /api/run/{id}` |

Behaviour notes:

- After a memo, narration of the memo completes before the tour starts at stop 1. The one `Listen` control drives both; there is no second speaker control in the tour bar.
- The Sources dialog lists citations as links out to the original court documents. It closes on Escape.
- A failed question says so and leaves the previous memo in place; it never shows a blank pane.

## `/map`

The same document as `/`, opened on the map pane, with its own title, description and canonical URL. File: `web/src/pages/Index.tsx`, selected by the route.

| Control | Accessible name | Owner | API |
|---|---|---|---|
| Every control on the page | see `/` | `Index.tsx` | see `/` |
| Basemap on or off | `Basemap` | `MapPane.tsx` | none |
| Each pin, named by the titles it stands for | the citation titles, joined by `; ` | `MapPane.tsx` | none |
| Previous stop / Pause or Play / Next stop | `Previous stop`, `Pause`, `Play`, `Next stop` | `MapPane.tsx` | `POST /api/tts_ts` |
| Stop the tour | `Stop tour` | `MapPane.tsx` | none |

Behaviour notes:

- Hovering a pin names the titles it represents; hovering a county names it and its case count. Both clear when the pointer leaves.
- A click or tap focuses a pin; a drag never counts as a click. Dragging or scrolling the map stops the tour.
- With the basemap off, counties, pins and links still render. If the basemap provider is unreachable, the map renders without it and says nothing to the reader.
- With reduced motion requested, camera moves jump instead of animating.

## `/observability`

Saved runs, their steps and their timings. File: `web/src/pages/Observability.tsx`.

| Control | Accessible name | Owner | API |
|---|---|---|---|
| A saved run, named by its question | the run's question | `Observability.tsx` | `GET /api/runs` |
| Raw details of a step | `Raw details` | `Observability.tsx` | `GET /api/run/{id}` |
| Retry after the source fails | `Try again` | `Observability.tsx` | `GET /api/runs` |

The page lists only the runs this device asked for: the server scopes `/api/runs` by the `X-Session-Id` header. The selected run shows its question, how long it took, the provider, and its pipeline steps in order with the time of each and the gap before it. When the source is unavailable the page says so and offers a retry rather than showing an empty or broken view.

## `/slides`

The deck. File: `web/src/pages/Slides.tsx`. One slide at a time, six in total.

| Control | Accessible name | Owner | API |
|---|---|---|---|
| Advance, from the keyboard or a click on the slide | ArrowRight | `Slides.tsx` | none |
| Go back, from the keyboard | ArrowLeft | `Slides.tsx` | none |
| Previous slide / Next slide, disabled at the ends | `Previous slide`, `Next slide` | `Slides.tsx` | none |
| Position | `Slide n of N` | `Slides.tsx` | none |
| Start your own question | `Ask your own question` → `/` | `Slides.tsx` | none |
