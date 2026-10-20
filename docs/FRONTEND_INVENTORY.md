# Frontend inventory

What the page shows, which file owns each control, and which API route it calls. Built from the code
in `web/` (October 2026), not from screenshots. API routes match `contracts/openapi.json`.
`tests/test_frontend_inventory.py` fails if an HTML route in openapi.json has no section here, so add a
section when you add a page.

There is one page. `/` is a conversation: ask a question, read the memo, and switch the same page to a
map of the authorities behind it. Run history is the `/api/runs` JSON route, listed in the sidebar, and
any saved run opens from that list or from `?run=` on the address.

## Layout

- `web/src/pages/` — one file: `Chat.tsx` (`/`).
- `web/src/components/` — `AppShell.tsx` (the frame: history sidebar, mobile sheet, sample-data notice,
  disclaimer), `CitationMap.tsx` (the MapLibre map, its pins, links and legend), `TurnDetails.tsx`
  (everything behind one answer), `EvidenceList.tsx` (one list of authorities, reused by every drawer),
  `DetailDrawer.tsx` (the one drawer shape), `AuthorityDetail.tsx` (one authority as a drawer shows it),
  `Memo.tsx` (the memo as formatted text, with its citation links), `StatRow.tsx`, and the UI
  primitives under `ui/`.
- `web/src/map/` — `palette.ts` (the colours and labels the map paints with), `narrator.ts` (speech,
  clip fetching and timing), `tour.ts` (the stops the narrated walk takes, built from the run itself).
- `web/src/lib/` — `api.ts` (every read: the server's routes, with the sample corpus behind them),
  `demo.ts` (the bundled sample corpus and the notice that labels it), `citations.ts` (where a citation
  sits on the map and how it is labelled), `runs.ts` (the shapes of the run data the server returns),
  `session.ts` (the device session id), `utils.ts` (`cn`).
- `web/public/` — assets served as-is: `logo.svg`, `og.png`, `robots.txt`.

The map is MapLibre GL JS over OpenFreeMap's Positron vector style, so labels stay sharp at every zoom
and the muted basemap leaves the coloured pins to carry the meaning. If the style cannot be fetched the
map falls back to an inline OpenStreetMap raster style rather than showing an empty pane. Neither source
needs an account or an API key. Pins are DOM markers, so they stay readable and clickable even when the
tiles do not arrive; a browser without WebGL gets a sentence saying so, and the authorities stay listed
in the Sources drawer.

The ground under the pins is mostly the basemap's own tiles. Positron ships the country and state
outlines, neighbourhood names and points of interest but paints almost none of them, so
`CitationMap.tsx` adds those layers back: the country and state outlines, suburb and neighbourhood
names once the camera is close enough to mean them, and historic landmarks — monuments, memorials,
battlefields, forts, ruins, archaeological sites — as a dot with its name. Those layers are optional by
construction: a style that does not carry the source-layer draws nothing.

The counties are the exception. OpenMapTiles, which Positron is styled over, stops at state level, so
the county lines and the county names come from the Census's own county boundaries — a public-domain
GeoJSON served keyless over a CDN, filtered to Colorado in the layer so one download serves every zoom.
They are drawn whatever the style is, as a dashed division of land with the county's name in small
caps. Each pin also carries the name of its court under the dot, shown once the camera is past the
state view so the names do not pile up. The legend names the county lines and the historic sites
whenever they were drawn.

## Shared

| Control | Accessible name / id | Owner | API |
|---|---|---|---|
| Conversations, one landmark | `nav[aria-label="Conversations"]` | `AppShell.tsx` | none |
| Start an empty thread, from the sidebar or the mobile sheet | `New chat` | `AppShell.tsx` | none |
| A saved run, opening as its own conversation | the run's question | `AppShell.tsx` | `GET /api/runs`, `GET /api/run/{id}` |
| Open the history below the wide breakpoint | `Open conversations` | `AppShell.tsx` | none |
| The mobile history sheet, titled for screen readers | `Conversations` | `AppShell.tsx` | none |
| Whether the corpus is the server's or the bundled sample, and what that means | `Sample data` | `AppShell.tsx` | `GET /api/stack` |
| The standing disclaimer | the footer line | `AppShell.tsx` | none |
| Device session header on every `/api` call | `X-Session-Id` | `lib/session.ts` | all `/api/*` |

The page renders in light or dark from the system setting; there is no theme toggle. The tokens are in
`web/src/globals.css`. The map's own paint colours are constants in `web/src/map/palette.ts`, because a
WebGL paint value cannot read a CSS variable; in dark mode the raster tiles are dimmed rather than
swapped.

When the server's routes cannot be reached — a preview with no backend, say — `lib/api.ts` answers from
`lib/demo.ts` instead and reports `source: "sample"`. The shell shows the `Sample data` badge and each
answer carries a `Sample` badge. Nothing is presented as retrieved authority when it came from the
bundle.

## `/`

The conversation. File: `web/src/pages/Chat.tsx`. The header names the thread and switches between the
chat and the map; the thread holds the questions and the memos; the composer sits under it. Anything
that shows more than a memo — the figures, the retrieval record, the sources, the authorities at a
place — opens in a drawer, so the page never grows a second column of dashboards.

| Control | Accessible name | Owner | API |
|---|---|---|---|
| Switch the page between the conversation and the map | `Show the conversation or the map`, `Chat`, `Map` | `Chat.tsx` | none |
| Drop the thread and start again | `New chat` | `Chat.tsx` | none |
| Question box | `Ask a question` | `Chat.tsx` | none |
| Send | `Send question` | `Chat.tsx` | `POST /api/ask`, then `GET /api/run/{id}` |
| An example question, asked on the spot | the question text | `Chat.tsx` | `POST /api/ask` |
| The stage the run has reached, with the draft as it is written | `Run progress` | `Chat.tsx` | `GET /api/run/{id}` (`events`, `partial`) |
| Everything behind one answer: the figures, the places, the retrieval stages | `Details` | `Chat.tsx`, `TurnDetails.tsx` | `GET /api/run/{id}` |
| The authorities behind one answer | `Sources (n)` | `Chat.tsx`, `EvidenceList.tsx` | none |
| Read the memo aloud, and stop it | `Read aloud`, `Stop` | `Chat.tsx`, `map/narrator.ts` | none (the browser's own voice; `POST /api/tts_ts` only if it cannot speak) |
| Copy the memo | `Copy` | `Chat.tsx` | none |
| Open this answer on the map | `Show on the map` | `Chat.tsx` | none |
| Follow-up questions, asked with the previous run in context, held in a drawer | `Follow-ups (n)` | `Chat.tsx` | `POST /api/ask` with `prev_run_id` |
| One authority: kind, court, date, citation, passage and link | `Authority` | `AuthorityDetail.tsx` | none |
| The authorities at one place, from a pin — a small card over the map, each authority opening in place | the place label | `PlaceCard.tsx` | none |
| Walk the answer: the short answer, the retrieval path, the opinion, the rest of the memo, then each authority in turn | `Play the tour`, `Stop the tour` | `Chat.tsx`, `TourBar.tsx`, `map/tour.ts`, `hooks/use-tour.ts` | none (the browser's own voice; `POST /api/tts_ts` only if it cannot speak) |
| The stop being spoken, as a subtitle along the bottom of the map, the heard part bright | `Tour` (region) | `TourBar.tsx` | none |
| The path the retriever took and how many citation links join the authorities | the line in the tour strip while it is idle | `Chat.tsx`, `map/tour.ts` | `GET /api/run/{id}` (`retrieval`, `edges`) |
| Fit the camera to every authority | `Fit to the authorities` | `CitationMap.tsx` | none |
| Zoom and the map's own scale | `Zoom in`, `Zoom out`, the scale bar | `CitationMap.tsx` | none |
| Each pin, named on the map and by the titles it stands for | the court's name; the citation titles, joined by `; ` | `CitationMap.tsx` | none |
| The legend, naming each kind of authority, each kind of citation link, the county lines and the historic sites | the legend | `CitationMap.tsx` | none |
| A saved run read back into the conversation | `?run=<id>` on the address | `Chat.tsx` | `GET /api/run/{id}` |

Behaviour notes:

- `Run progress` names the stage the pipeline has reached and shows the draft as it is written; when the
  result lands the draft is replaced by the finished memo and the region goes away. The sample corpus
  plays the same four stages, so the preview behaves the same way.
- Every answer keeps the line "AI-generated research summary, not legal advice" (the run's own
  disclaimer when it carried one).
- The memo is the answer and nothing else: its headings, prose, lists and quotes, with each `[n]` and
  each bolded authority name linking to the document. The list of authorities it cites is not repeated
  under the prose — that list is the `Sources` drawer. Everything else about an answer (sources,
  follow-ups, the figures, the retrieval record) is reachable from the answer's own row of buttons and
  opens in a drawer, so the thread stays a thread.
- A refused or failed question appears as its own message and leaves the earlier answers in place; it
  never shows a blank pane.
- Escape stops the voice, whether it is the read-aloud button or the tour. One thing is spoken at a
  time: starting the tour stops the read-aloud, and starting the read-aloud stops the tour.
- The tour is built from the run, not from a script: the question, the memo's own paragraphs under its
  own headings, the path the retriever recorded, then one stop per authority. A stop that names an
  authority moves the camera to its pin and marks it. It never starts on its own; leaving the map, or
  asking a new question, stops it. When no clip can be played the walk continues in text and the panel
  says the voice is unavailable, so the transcript is never lost with the audio.
- A pin is one place: the authorities that resolve to the same place share it, and the pin's label says
  how many it stands for. A link is drawn between the pins its two authorities sit on; a link inside one
  place is not drawn.
- The camera fits the pins of the answer on screen, and fits them again when the reader switches which
  answer is mapped. With reduced motion requested, camera moves jump instead of gliding.
- A saved run opens as its own conversation and the address keeps `?run=<id>`, so the thread can be
  linked to and reloaded; asking a follow-up moves the address to the new run.
