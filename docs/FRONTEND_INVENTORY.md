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
  clip fetching and timing).
- `web/src/lib/` — `api.ts` (every read: the server's routes, with the sample corpus behind them),
  `demo.ts` (the bundled sample corpus and the notice that labels it), `citations.ts` (where a citation
  sits on the map and how it is labelled), `runs.ts` (the shapes of the run data the server returns),
  `session.ts` (the device session id), `utils.ts` (`cn`).
- `web/public/` — assets served as-is: `logo.svg`, `og.png`, `robots.txt`.

The map is MapLibre GL JS over OpenStreetMap raster tiles, styled inline in `CitationMap.tsx` so no
account or API key is needed. Pins are DOM markers, so they stay readable and clickable even when the
tile provider cannot be reached; a browser without WebGL gets a sentence saying so, and the authorities
stay listed in the Sources drawer.

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
| Read the memo aloud, and stop it | `Read aloud`, `Stop` | `Chat.tsx` | `POST /api/tts_ts` |
| Copy the memo | `Copy` | `Chat.tsx` | none |
| Open this answer on the map | `Show on the map` | `Chat.tsx` | none |
| Follow-up questions, asked with the previous run in context | the follow-up text | `Chat.tsx` | `POST /api/ask` with `prev_run_id` |
| One authority: kind, court, date, citation, passage and link | `Authority` | `AuthorityDetail.tsx` | none |
| The authorities at one place, from a pin | the place label | `Chat.tsx`, `EvidenceList.tsx` | none |
| Fit the camera to every authority | `Fit to the authorities` | `CitationMap.tsx` | none |
| Zoom and the map's own scale | `Zoom in`, `Zoom out`, the scale bar | `CitationMap.tsx` | none |
| Each pin, named by the titles it stands for | the citation titles, joined by `; ` | `CitationMap.tsx` | none |
| The legend, naming each kind of authority | the legend | `CitationMap.tsx` | none |
| A saved run read back into the conversation | `?run=<id>` on the address | `Chat.tsx` | `GET /api/run/{id}` |

Behaviour notes:

- `Run progress` names the stage the pipeline has reached and shows the draft as it is written; when the
  result lands the draft is replaced by the finished memo and the region goes away. The sample corpus
  plays the same four stages, so the preview behaves the same way.
- Every answer keeps the line "AI-generated research summary, not legal advice" (the run's own
  disclaimer when it carried one).
- A refused or failed question appears as its own message and leaves the earlier answers in place; it
  never shows a blank pane.
- Escape stops the voice. One answer is read at a time.
- A pin is one place: the authorities that resolve to the same place share it, and the pin's label says
  how many it stands for. A link is drawn between the pins its two authorities sit on; a link inside one
  place is not drawn.
- The camera fits the pins of the answer on screen, and fits them again when the reader switches which
  answer is mapped. With reduced motion requested, camera moves jump instead of gliding.
- A saved run opens as its own conversation and the address keeps `?run=<id>`, so the thread can be
  linked to and reloaded; asking a follow-up moves the address to the new run.
