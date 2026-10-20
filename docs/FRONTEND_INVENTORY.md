# Frontend inventory

What every page shows, which file owns each control, and which API route it calls. Built from the code in `web/` (October 2026), not from screenshots. API routes match `contracts/openapi.json`. `tests/test_frontend_inventory.py` fails if an HTML route in openapi.json has no section here, so add a section when you add a page.

The workspace is six pages under one shell: the dashboard at `/`, the chat at `/chat`, knowledge retrieval at `/search`, the citation map at `/explore`, the run record at `/observability`, and the deck at `/slides`. There is no `/runs` page: run history is the `/api/runs` JSON route, listed on the dashboard and on `/observability`, and any saved run opens from a row or by `?run=` on the address.

## Layout

- `web/src/pages/` — one file per page: `Dashboard.tsx` (`/`), `Chat.tsx`, `Search.tsx`, `Explore.tsx`, `Observability.tsx`, `Slides.tsx`, `NotFound.tsx` (the catch-all).
- `web/src/components/` — `AppShell.tsx` (the one frame: sidebar, page head, command palette, sample-data notice), `MapCanvas.tsx` (the canvas, its floating controls, legend and tour bar), `DetailDrawer.tsx` (the one drawer shape every page opens), `AuthorityDetail.tsx` (one authority as a drawer shows it), `Memo.tsx` (the memo as formatted text, with its citation links), `BarChart.tsx`, `StatRow.tsx`, `DeckMap.tsx`, `FlowDiagram.tsx`, and the UI primitives under `ui/`.
- `web/src/map/` — `engine.ts` (camera, orbit, layers, pins, arcs, focus, tour state, mute, the `window.__precedentMap.v1` debug object), `narrator.ts` (speech, clip fetching and timing), `gl.ts` (the WebGL renderer, including the tilted camera), `debug.ts` (the debug surface).
- `web/src/lib/` — `api.ts` (every read: the server's routes, with the sample corpus behind them), `demo.ts` (the bundled sample corpus and the notice that labels it), `corpus.ts` (the search index and its scorer), `citations.ts` (where a citation sits on the map and how it is labelled), `geo.ts` (state and county shapes), `explain.ts` (what a tour stop says), `runs.ts` (the shapes of the run data the server returns), `session.ts` (the device session id), `utils.ts` (`cn`).
- `web/public/` — assets served as-is: `logo.svg`, `og.png`, `robots.txt`, `vendor/` (projection data and the d3 builds it needs).

The map is drawn on a canvas with WebGL, with a 2D fallback. It exposes `window.__precedentMap.v1` so behaviour can be asserted without reading pixels; see the spec's verification contract.

## Shared across pages

| Control | Accessible name / id | Owner | API |
|---|---|---|---|
| Navigation: Dashboard, Chat, Search, Explore, Observability, Briefing, in that order, one landmark | `nav[aria-label="Primary"]` | `AppShell.tsx` | none |
| New question, from the sidebar or the mobile sheet | `New question` | `AppShell.tsx` | none |
| The mobile navigation sheet, titled for screen readers | `Navigation` | `AppShell.tsx` | none |
| Open the navigation below the wide breakpoint | `Open navigation` | `AppShell.tsx` | none |
| The command palette, opened by `⌘K` / `Ctrl+K` | `Search or jump to…`, the palette's input | `AppShell.tsx` | none |
| Ask the typed question in the chat, or retrieve authorities for it | `Ask “…” in chat`, `Retrieve authorities for “…”` | `AppShell.tsx` | none |
| The page name and its one-line description | `h1` in the head | `AppShell.tsx` | none |
| Whether the corpus is the server's or the bundled sample, and what that means | `Sample data` | `AppShell.tsx` | `GET /api/stack` |
| Corpus facts: passages, cases, graph edges | `Passages`, `Cases`, `Graph edges` | `AppShell.tsx` | `GET /api/stack` |
| Device session header on every `/api` call | `X-Session-Id` | `lib/session.ts` | all `/api/*` |

Every page renders in light or dark from the system setting; there is no theme toggle. The tokens are in `web/src/globals.css`.

When the server's routes cannot be reached — a preview with no backend, say — `lib/api.ts` answers from `lib/demo.ts` instead and reports `source: "sample"`. Every page that shows a sample record says so: the shell shows the `Sample data` badge, the dashboard and search say `Sample corpus`, and each chat answer carries a `Sample` badge. Nothing is presented as retrieved authority when it came from the bundle.

## `/`

The research desk. File: `web/src/pages/Dashboard.tsx`. What the four agents have done lately, how the corpus is holding up, and the two ways in: ask, or open a run that exists.

| Control | Accessible name | Owner | API |
|---|---|---|---|
| Question box, handing the question to the chat | `Ask a legal question` | `Dashboard.tsx` | none |
| Ask | `Ask` | `Dashboard.tsx` | `POST /api/ask` via `/chat?q=` |
| Search | `Search` | `Dashboard.tsx` | none |
| An example question | the question text | `Dashboard.tsx` | none |
| Answers today, the citation-check pass rate, the mean answer time, the corpus size | the card labels | `Dashboard.tsx` | `GET /api/runs`, `GET /api/stack` |
| Answers over the last seven days | the chart's own title, `Answers this week` | `Dashboard.tsx` | `GET /api/runs` |
| A saved run, opening its record in the drawer | the run's question | `Dashboard.tsx` | `GET /api/runs`, `GET /api/run/{id}` |
| All runs | `All runs` → `/observability` | `Dashboard.tsx` | none |
| Open the chosen run in the chat, or on the map | `Open in chat`, `Show on the map` | `Dashboard.tsx` | `GET /api/run/{id}` |
| The retrieval engine's status and models | `Status`, `Lexical`, `Dense`, `Rerank`, `Fusion`, `Corpus revision` | `Dashboard.tsx` | `GET /api/stack` |
| The places the newest run reaches, with a count each | the place labels | `Dashboard.tsx` | `GET /api/run/{id}` |
| The voice chain, in the order it is tried | the provider names | `Dashboard.tsx` | `GET /api/stack` |

Behaviour notes:

- A figure the server did not send reads `No data yet`; it is never shown as `0`.
- The chart draws one column per day for the last seven days, counting this device's saved runs; with no runs it says so instead of drawing an empty axis.
- The recent-run drawer shows the question, how long the run took, the provider, the citation check, the pipeline steps in order and the retrieval stages with their durations.

## `/chat`

One question, four agents, the memo with its authorities. File: `web/src/pages/Chat.tsx`. The evidence rail stays alongside the conversation; anything that shows more opens in the one drawer.

| Control | Accessible name | Owner | API |
|---|---|---|---|
| Question box | `Ask a question` | `Chat.tsx` | none |
| Send | `Send question` | `Chat.tsx` | `POST /api/ask`, then `GET /api/run/{id}` |
| An example question, asked on the spot | the question text | `Chat.tsx` | `POST /api/ask` |
| The stage the run has reached, with the draft as it is written | `Run progress` | `Chat.tsx` | `GET /api/run/{id}` (`events`, `partial`) |
| The authorities behind one answer | `Sources (n)` | `Chat.tsx` | none |
| What the retriever ran, in order, with durations and the graph it used | `Retrieval` | `Chat.tsx` | `GET /api/run/{id}` |
| Read the memo aloud, and stop it | `Read aloud`, `Stop` | `Chat.tsx` | `POST /api/tts_ts` |
| Copy the memo | `Copy` | `Chat.tsx` | none |
| Open this answer's run on the map | `Map` | `Chat.tsx` | none |
| Follow-up questions, asked with the previous run in context | the follow-up text | `Chat.tsx` | `POST /api/ask` with `prev_run_id` |
| Drop the thread and start again | `New chat` | `Chat.tsx` | none |
| The evidence rail at wide widths, and the same list in a drawer below that | `Evidence`, `Evidence (n)` | `Chat.tsx` | none |
| One authority: kind, court, date, citation, passage and link | `Authority` | `AuthorityDetail.tsx` | none |
| The retrieval record for the answer on screen | `Retrieval record` | `Chat.tsx` | `GET /api/run/{id}` |
| Open this answer's run on the map, from the rail | `Open on the map` | `Chat.tsx` | none |
| A question handed over by the palette or the dashboard | `?q=<question>` on the address | `Chat.tsx` | `POST /api/ask` |
| A saved run read back into the conversation | `?run=<id>` on the address | `Chat.tsx` | `GET /api/run/{id}` |

Behaviour notes:

- `Run progress` names the stage the pipeline has reached and shows the draft as it is written; when the result lands the draft is replaced by the finished memo and the region goes away. The sample corpus plays the same four stages, so the preview behaves the same way.
- A question handed over by `?q=` is asked once, then the parameter is removed from the address so a reload does not ask it again.
- Every answer keeps the line "AI-generated research summary, not legal advice" (the run's own disclaimer when it carried one).
- A refused or failed question appears as its own message and leaves the earlier answers in place; it never shows a blank pane.
- Escape stops the voice. The evidence rail lists the authorities of the answer on screen, not whichever answer arrived last.

## `/search`

Knowledge retrieval over the authorities this device's runs cite. File: `web/src/pages/Search.tsx`.

| Control | Accessible name | Owner | API |
|---|---|---|---|
| The query box | `Search the corpus` | `Search.tsx` | none |
| Search | `Search` | `Search.tsx` | none |
| Narrow by jurisdiction | `All jurisdictions`, `Colorado`, `Federal` | `Search.tsx` | `GET /api/runs`, `GET /api/run/{id}` |
| Narrow by kind | `Every kind`, `Cases`, `Statutes`, `Regulations` | `Search.tsx` | `GET /api/runs`, `GET /api/run/{id}` |
| Order the results | `By relevance`, `Newest first` | `Search.tsx` | none |
| An example question, searched on the spot | the question text | `Search.tsx` | none |
| One result's authority, in the drawer | the authority's title | `Search.tsx` | none |
| Ask the agents the question as typed | `Ask this in chat` | `Search.tsx` | none |
| Open one result, or ask about that authority | `Open`, `Ask about this` | `Search.tsx` | none |
| Clear the filters when nothing matches | `Clear filters` | `Search.tsx` | none |
| Hand the question to the agents instead of the index | `Ask the agents instead` | `Search.tsx` | none |
| A question handed over by the palette | `?q=<question>` on the address | `Search.tsx` | none |

Behaviour notes:

- The index is every authority the saved runs cite, deduplicated by record id; a result states its kind, jurisdiction, county where it has one, its match score, the passage that matched with the query terms marked, and the run it came from.
- Filters are applied before the query is scored, so narrowing never re-ranks what is left.
- The page says how many authorities and runs it read, and says when the corpus is the bundled sample.

## `/explore`

The citation map, tilted and walked. File: `web/src/pages/Explore.tsx`, with the canvas, controls and tour bar in `web/src/components/MapCanvas.tsx` and the camera, layers and layout in `web/src/map/engine.ts`.

| Control | Accessible name | Owner | API |
|---|---|---|---|
| Pan, on a drag | the canvas | `MapCanvas.tsx` | none |
| Orbit: tilt and bearing, on a right-drag or shift-drag | the canvas | `MapCanvas.tsx` | none |
| Zoom, on the wheel or a pinch | the canvas | `MapCanvas.tsx` | none |
| Each pin, named by the titles it stands for | the citation titles, joined by `; ` | `MapCanvas.tsx` | none |
| The authority behind a pin: title, kind, court, date, passage and link | `Authority` | `AuthorityDetail.tsx` | none |
| The legend, naming each kind of authority and link | the legend | `MapCanvas.tsx` | none |
| The camera's tilt and bearing, and what the run reached | the summary strip | `MapCanvas.tsx` | none |
| The layers drawer, with a switch per layer and the camera's two angles | `Layers` | `Explore.tsx` | none |
| Basemap, heat, links, pins and labels on or off | `Basemap`, `Heat`, `Links`, `Pins`, `Labels` | `Explore.tsx` | none |
| Tilt and bearing | `Tilt`, `Bearing` | `Explore.tsx` | none |
| The authorities this run cites | `Authorities` | `Explore.tsx` | `GET /api/run/{id}` |
| Zoom in, zoom out, back to the national view, back to the opening angle | `Zoom in`, `Zoom out`, `Reset view`, `Reset angle` | `MapCanvas.tsx` | none |
| Previous stop / Play or Pause / Next stop | `Previous stop`, `Play the walk`, `Pause the walk`, `Next stop` | `MapCanvas.tsx` | `POST /api/tts_ts` |
| Stop the walk | `Stop the walk` | `MapCanvas.tsx` | none |
| What the current stop says, as the voice reads it | `Tour transcript` | `MapCanvas.tsx` | none |
| The speaker and what it is doing | the speaker's name and status | `MapCanvas.tsx` | `POST /api/tts_ts` |
| Open one saved run by address | `?run=<id>` on the URL | `Explore.tsx` | `GET /api/run/{id}` |

Behaviour notes:

- With no run named, the page opens the newest saved run, and the bundled sample when there is none; either way the top strip says where the answer came from.
- Hovering a pin names the titles it represents; hovering a county names it and its case count. Both clear when the pointer leaves.
- A click or tap on a pin opens the authority behind it; one detail is open at a time, a second pin replaces the first, and Escape or the drawer's close control dismisses it. A drag never counts as a click. Dragging or scrolling the map stops the walk.
- A pin is one place: the authorities that resolve to the same place share it, and `pinCites(i)` reports exactly the citations a pin stands for.
- Turning a layer off rebuilds the scene: counties stay readable with the heat off, the arcs go with the links off, and the pins and labels are laid out only while they are on. The basemap is optional in every case; if its provider is unreachable the map renders without it and says nothing to the reader.
- The camera opens at 58° of tilt facing north; the tilt is held between 16° and 86°, the bearing wraps at 360°. Panning follows the ground under the pointer, so it stays correct at any tilt.
- With reduced motion requested, camera moves jump instead of animating.

## `/observability`

Saved runs, their steps and their timings. File: `web/src/pages/Observability.tsx`. The page sits in the workspace shell, so the shell's head names it and the page starts with its own description.

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

The deck. File: `web/src/pages/Slides.tsx`. One slide at a time, six in total, inside the workspace shell with the slides scrolling in the space below the head.

| Control | Accessible name | Owner | API |
|---|---|---|---|
| Advance, from the keyboard or a click on the slide | ArrowRight | `Slides.tsx` | none |
| Go back, from the keyboard | ArrowLeft | `Slides.tsx` | none |
| Previous slide / Next slide, disabled at the ends | `Previous slide`, `Next slide` | `Slides.tsx` | none |
| Position | `Slide n of N` | `Slides.tsx` | none |
| Start your own question | `Ask your own question` → `/` | `Slides.tsx` | none |
