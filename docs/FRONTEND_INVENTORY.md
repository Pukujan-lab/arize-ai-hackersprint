# Frontend inventory

What every page in `static/` shows, which file owns each control, and which API route it calls. Built from the code on `main` (October 2026), not from screenshots. API routes match `contracts/openapi.json`. `tests/test_frontend_inventory.py` fails if an HTML route in openapi.json has no section here, so add a section when you add a page.

There is no `/runs` page. Run history is the `/api/runs` JSON route, shown inside `/v1`, `/map` and `/observability`.

## KEEP AS IS

The 3D county map and the guided tour are the product's moat. v2 rebuilds the UI around them and does not touch these files:

- `static/map3d.js`: 3D US map (Albers USA, d3-geo), Colorado raised, one pin per cited document, arcs for graph links, guided tour. Calls `POST /api/tour/prefetch`, `POST /api/tts_ts`, and loads `/static/vendor/us_states_proj.json` and `/static/vendor/co_counties_proj.json`. Creates `#docpanel`, `#transcript` and the tour bar (`#tour-controls`: prev / play-pause / next, plus a `Stop n of N` indicator and no voice button; aria-label "Map tour controls", "Play or pause the guided tour", "Replay this stop"). Pin tags, the tour caption, the map's now-showing label and a spoken `Cited by …` line carry no `[n]` badges — a Cited-by stop names the source by its title only, and the only stop numbering is the bar's indicator.
- `static/map3d.co.js`: Colorado-only county variant (county seats, pins, arcs).
- `static/vendor/` county and state data (`co_counties_proj.json`, `us_states_proj.json`) and the d3 builds it needs (`d3-array.min.js`, `d3-geo.min.js`).

Both map files mount into `#docs3d` and expose `window.Docs3D` (`focus`, `open`, `jumpRef`, `busy`, `show`, `pulse`, `idle`). Any new UI should drive the map through that object.

## Shared across pages

| Control | id / aria-label | Owner | API |
|---|---|---|---|
| Sidebar navigation on the v1 pages: Home, Map, Run history, Dashboard, Observability, Guide, Slides | `<nav id="sidebar">` (`#side-links`), toggle `#sidebar-toggle` | `navbar.js` | none |
| Navigation on the v2 root: Demo, Map, Observability, Guide, Slides — icon rail only, in that order | `aside.v2-rail[role=navigation]` (`a.v2-rail-btn`) | `v2.html` | none |
| Partner logo strip | `#partner-strip`, links aria-label "{partner} — open dashboard" | `navbar.js` + `partners.js` | none |
| Examples dropdown (replaces `#examples` chips) | `#exBtn`, `#exMenu` | `navbar.js` | none (fills `#q`, triggers ask) |
| Nav logo | `#nav-logo` | `navbar.js` | none |
| Session id header on every `/api` call | `window.SESSION_ID` | `session.js` | all `/api/*` |
| Mute/stop and audio status | `#audio-status`, `[data-abtn]` buttons | `audio.js` | `POST /api/tts_ts` |
| Voice orb (tap to talk) | `#vorb` aria-label "Tap to talk", `#vcap`, `#vstate`, `#vwave` | `voice.js` | `POST /api/stt`, then ask |
| Follow-up chips, thread, New question | `#fuChips`, `#fuThread`, `#fuNew` | `followup.js` | `POST /api/ask` |
| Citation labels and research links | no controls of its own | `links.js` | none |

## `/`

Canonical home. File: `static/v2.html`, the minimal, map-centric v2 page. `GET /` and `GET /v2` serve the same file, so the controls are the ones listed under `/v2` below. The old page is still available at `/v1`.

One navigation only (#101): the icon rail is the page's whole menu. `/` loads no `navbar.js` and renders no `#sidebar-toggle`, "Menu" button, drawer or sidebar, so there is no second list of destinations to keep in sync. The rail is the single navigation landmark (`aside.v2-rail` with `role="navigation"`), and `/dashboard` is never linked from this page: `/observability` is the dashboard.

## `/v1`

Old demo page, kept as the fallback. File: `static/index.html`. Scripts: session, audio, tailwind, vis-network, links, d3, map3d (module), voice, followup, declutter, firstscreen, partners, navbar.

| Control | id / aria-label | Owner | API |
|---|---|---|---|
| Top nav links | `<nav>` | `index.html` | none |
| Getting-started tips card | `#firststep` aria-label "How to start" | `index.html`, `firstscreen.js` | none |
| Dismiss tips | `#firststep-dismiss` aria-label "Dismiss the getting-started tips" | `firstscreen.js` | none |
| Question box | `#q`, `#askrow`, `#askhint` | `index.html` | none |
| Ask | `#go` aria-label "Ask: run the research agents" | `index.html` | `POST /api/ask`, `GET /api/run/{rid}` |
| Try an example | `#tryex` | `index.html` | `POST /api/ask` |
| Example chips (hidden, replaced by dropdown) | `#examples` | `index.html` / `navbar.js` | none |
| Voice label | `#vorb-label`, aria-label "Ask by voice: tap to talk" | `firstscreen.js` | none |
| 3D map | `#docs3d` | `map3d.js` (KEEP) | see KEEP AS IS |
| Open full map | `#fullmap` → `/map` | `index.html` | none |
| Source number buttons | `#docnav` buttons, aria-label "Open source N: {title}" | `index.html` | none (`Docs3D.focus/open`) |
| Memo + Listen | `#answer`, `#play` aria-label "Listen to the memo" | `index.html` | `POST /api/tts` |
| Citations list | `#cites` (title buttons, external links) | `index.html` | none |
| Agent stages, events, badges, graph | `#stages`, `#events`, `#badges`, `#net`, `#steps`, `#meta` | `index.html` | `GET /api/run/{rid}` |
| Seats and tasks panels | `#seats`, `#tasks` | `index.html` | `GET /api/tasks`, `GET /api/health` |
| Hands-free toggle | `#hf` | `index.html` | none |
| "Built with" link | `<a href="/dashboard">` | `index.html` | none |
| Sidebar drawer | `#sidebar`, `#sideToggle` "Toggle sidebar", `#sideClose` "Close menu", `#sideBack`, `#sideDot`, mobile "Menu" button | `declutter.js` | none |
| Sidebar accordions: Live agent activity (open), Sources, Run history, Voice & hands-free, Partners & pipeline | built by `createAccordion()` | `declutter.js` | Run history: `GET /api/runs?n=60` |
| Live line | `#liveline` | `declutter.js` | none |

## `/map`

Full map page. File: `static/map.html`. Scripts: session, audio, tailwind, links, d3, map3d (module), agentnodes, voice, followup, partners, navbar.

| Control | id / aria-label | Owner | API |
|---|---|---|---|
| Top nav links | `<nav>` | `map.html` | none |
| Ask form | `#f`, `#q`, Ask button | `map.html` | `POST /api/ask`, `GET /api/run/{rid}` |
| View toggle: United States / Colorado counties | `button[data-v="us"]`, `button[data-v="co"]` | `map.html` | none |
| 3D map | `#docs3d` | `map3d.js` (KEEP) | see KEEP AS IS |
| Summary collapsible | `<details id="sumbox" open>`, `#sum` | `map.html` | none |
| Play summary | `#sumplay` aria-label "Play summary" | `map.html` | `POST /api/tts_ts` |
| Reference jumps `[n]` | inline buttons | `map.html` | none (`Docs3D.jumpRef`) |
| Side panel | `<aside>`, `#side` | `map.html` | none |
| Recent runs | `#runs` | `map.html` | `GET /api/runs` |
| Featured run on first load | none | `map.html` | `/static/featured-run.json` |
| Status | `#stat`, `#st2` | `map.html` | none |
| Agent pipeline overlay | `#agentNodes`, `#anCached`, `#anMsg` | `agentnodes.js` | uses run events |

## `/dashboard`

Partner dashboards. File: `static/dashboard.html`. Scripts: vendor/logos, partners, navbar.

| Control | id / aria-label | Owner | API |
|---|---|---|---|
| Top nav links | `<nav>` | `dashboard.html` | none |
| Partner tabs | `#tabs` (`<a href="#{key}">`) | `dashboard.html` | none |
| Partner cards with "Open ↗" links | `#cards`, `#{key}` | `dashboard.html` | none |
| Arize deep links (Home, Evaluators, Datasets, Experiments, Monitors, Dashboards, Usage) | external `<a>` | `dashboard.html` | none |
| Pipeline flow, updated time | `#flow`, `#upd`, `#a` | `dashboard.html` | `GET /api/stack` |

## `/observability`

Run observability. File: `static/observability.html`. Scripts: vendor/logos, partners, session, navbar.

| Control | id / aria-label | Owner | API |
|---|---|---|---|
| Top nav links (only page with an Observability link) | `<nav>` | `observability.html` | none |
| Refresh | `#rf` | `observability.html` | `GET /api/runs`, `GET /api/run/{rid}`, `GET /api/health` |
| Filters: search, provider, range, run | `#q`, `#f-provider`, `#f-range`, `#f-run`, `#fcount` | `observability.html` | none |
| Summary tiles | `#v-today`, `#v-pass`, `#v-time`, `#v-cache`, `#v-voice` (+ `s-*`) | `observability.html` | as Refresh |
| Detail tabs/panels | `#t-*`/`#p-*`/`#n-*` for steps, time, cache, judge, provider; `#panel` | `observability.html` | as Refresh |
| Pipeline steps collapsible | `<details id="pipeline-steps">`, `#step-rows` | `observability.html` | none |
| Raw details collapsible | `<details id="raw-details">`, `#ev`, `#ev-note` | `observability.html` | none |
| Waterfall | `#wf`, `#wf-hint`, `#wf-what` | `observability.html` | none |
| Empty state with "demo page" link | `#obs-empty` → `/` | `observability.html` | none |
| Snapshot fallback | `#snap`, `#src` | `observability.html` | `/static/data/observability.json` |

## `/guide`

Presenter guide. File: `static/guide.html`. Scripts: vendor/logos, partners, navbar.

| Control | id / aria-label | Owner | API |
|---|---|---|---|
| Top nav links | `<nav>` | `guide.html` | none |
| Steps and flow | `#steps`, `#flow` | `guide.html` | none |
| Open demo ↗, Open slides ↗, Open dashboard ↗ | `a.btn` (new tab) | `guide.html` | none |

## `/slides`

Pitch deck. File: `static/slides.html` (`static/slides.marketing.html` is an older deck, not routed). Scripts: tailwind, partners, navbar.

| Control | id / aria-label | Owner | API |
|---|---|---|---|
| Nav: Demo, Map, Guide (no Dashboards/Slides links) | `<a>` | `slides.html` | none |
| Deck and page counter | `#deck`, `#pg` | `slides.html` | none |
| Closing CTAs: Demo, Map, Guide; external site and GitHub links | `<a>` | `slides.html` | none |

## `/v2`

Alias of `/`: `GET /v2` serves the same `static/v2.html` as the root. Minimal, map-centric home. File: `static/v2.html`, styles `static/v2.css`, behaviour `static/v2.js`. Scripts: session, tailwind, links, d3-array, d3-geo, audio, map3d (module), v2. No top `<nav>` and no `navbar.js`: one icon rail on the left holds the logo link, the page links and the theme toggle, and it is the page's only navigation.

Visible on first load: the memo (`#answer`), the existing 3D map (`#docs3d`) and the composer at the bottom. Everything else sits in collapsed bottom sheets. Once a memo is on screen, a Listen button (`#listen-btn`) appears above it. Below 900px only ONE of the memo and the map is shown at a time, full height, with Answer/Map buttons in the head.

| Control | id / aria-label | Owner | API |
|---|---|---|---|
| Icon rail (the only navigation): logo link to `/`, then Demo `/`, Map `/map`, Observability `/observability`, Guide `/guide`, Slides `/slides` in that order, each one inline SVG line icon; the entry for the page you are on is the only one with `aria-current="page"` | `aside.v2-rail` (`role="navigation"`, `a.v2-rail-logo`, `a.v2-rail-btn`) | `v2.html` | none |
| Theme toggle (dark by default, remembered) | `#theme-toggle` aria-label "Toggle dark or light theme" | `v2.js` | none (localStorage `precedent-theme`) |
| Question box and Ask | `#q`, `#go` aria-label "Ask: run the research agents" | `v2.html`, `v2.js` | `POST /api/ask`, `GET /api/run/{rid}` |
| Empty-ask hint | `#v2-hint` | `v2.js` | none |
| Memo, with its Listen bar above it | `#answer` in `.v2-anscol`; `.v2-answer-head`, `#listen-btn` aria-label "Listen to this memo" (hidden until a memo is on screen) | `v2.js` | `GET /api/run/{rid}`, `POST /api/tts_ts` (`AudioMgr.say`, then `Docs3D.tour(0)`) |
| Answer / Map buttons (under 900px only, `display:none` at wider screens) | `.v2-pane-tabs`, `[data-pane]` | `v2.js` (`data-mobile-pane` on `.v2-main`) | none |
| Slim source strip at the top of the map: case, court, year, then Read / Source | `#pin-preview`, `[data-preview-read]`, `[data-preview-source]` | `v2.js` | none (`Docs3D.onCiteTap`, memo `[data-ref]`) |
| Citation link in the memo (one glyph, no number: ↗ when the citation has a source URL, › when it has none; both carry `data-ref`, aria-label names the title) | `a.v2-ref[data-ref]`, `button.v2-ref[data-ref]` | `v2.js` | none (opens `#pin-preview`; never navigates, never tours) |
| 3D map | `#docs3d` | `map3d.js` (KEEP) | see KEEP AS IS |
| Sources pill and sheet | `#sources-btn` → `#sources-panel` (collapsed by default), `#cites` | `v2.js` | none (`Docs3D.jump` / `open`) |
| Follow-ups pill and sheet | `#followups-btn` → `#followups-panel` (collapsed by default), `#fu-chips` | `v2.js` | `POST /api/ask` with `prev_run_id` |
| Legend pill and sheet | `#legend-btn` → `#legend-panel` | `v2.js` | none |
| Tour pill | `#tour-btn` aria-label "Play the map tour from the first stop" | `v2.js` | none (`Docs3D.tour(0)`) |
| Tour controls inside the map, as one vertical stack on the middle of the map's right edge (prev, play/pause, next — no voice button — with the `Stop n of N` indicator underneath) | `#tour-controls`, `[data-tour]`, `[data-tour-stop]` | `map3d.js` (KEEP), placed by `v2.css` | `POST /api/tts_ts` |
| Run info pill and sheet | `#runinfo-btn` → `#runinfo-panel`, `#runinfo-body` | `v2.js` | none (shows the last run) |

Behaviour notes:

- The memo renders first; then the map shows the citations with the voice held, the summary line is spoken (`AudioMgr.say(shortLine(answer))`) and only when that clip ends does the tour autoplay from stop 1 (`Docs3D.tour(0)`) — never tour-voice-first. With no `AudioMgr`, or when it is muted, the tour starts straight away as a caption tour. Pause and stop are the map's own tour controls; prev/next skip to that stop and start it at once (a pin or memo citation tap does not — it only opens the slim strip), and that stop holds long enough to read the line before the walk carries on.
- `#listen-btn` (`.v2-answer-head`, above `#answer`) replays that same reading without asking the question again: `AudioMgr.say(shortLine(lastResult.answer))` first, then `Docs3D.tour(0)` — the shared starter in `v2.js` (`speakThenTour`). It reads `Listen` / `Stop`, carries `aria-pressed`, and only shows while a memo is on screen. The bar is on the answer, never inside `#tour-controls`; `map3d.js` keeps no speaker button. A press while it says `Stop` calls `AudioMgr.stopAll()` and `Docs3D.stopTour()`, and when nothing is playing for a few beats the label goes back to `Listen` on its own.
- v2 loads `audio.js` (`window.AudioMgr`) for the summary narration; it does not load `followup.js`, it renders follow-ups itself and styles the map's tour controls in `v2.css` — `#tour-controls` becomes one compact vertical column (prev, play/pause, next, then the `Stop n of N` chip) parked at the middle of the map's right edge, every button 44px, in place of the utility classes `map3d.js` puts on the bar.
- Dark is the default theme (`data-theme="dark"` on `<html>`, set in the markup and re-applied from localStorage before the stylesheet paints). Light mode sets `data-theme="light"`.
- At 1024/1440 the layout splits (map left, answer column right, both full height). Under 900px it is single pane: head above, then ONE pane (memo or map) at full height, then pills and composer below. The Answer / Map buttons swap panes and so does a left/right swipe, but only in the bottom third of the pane — the top two thirds stay with the map drag. The unselected pane is hidden (kept laid out so the canvas keeps its box and the tour bar stays reachable over the memo). Sheets open from the top of the same pane area (`top:60px`), not as bottom sheets.
- Tapping a pin, a county or a citation in the memo (either `↗` link form or `›` button form — both carry `data-ref`) opens `#pin-preview` at every width, phone and desktop alike: one slim strip docked at the top of the map with the case name, court and year, plus Read (expands the strip downward with a short piece of the passage, in place) and Source (opens the Sources sheet on that card). A pin or county tap takes the map's own hook over (`Docs3D.onCiteTap` returns `true`), so the big `#docpanel` card never opens from a tap; it is still reached from the Sources sheet. A memo citation tap opens the strip ONLY: it never navigates to the external source and never starts the tour, and the external source stays reachable through that Sources card's own links. A click on the map outside the strip closes it, as does Escape. The strip never carries a `[n]` badge, and it is height-capped (`max-height`) so an opened strip never covers the tour stack parked at the middle of the edge.
- The rail links only route to pages that exist, in one fixed order: `/` (Demo), `/map` (Map), `/observability` (Observability), `/guide` (Guide), `/slides` (Slides). There is no Runs link, because `/runs` has no HTML route yet (issue #53 open, live `/runs` is 404, only `/api/runs` JSON) — `/observability` loads `/api/runs` and is the closest working target. There is no `/dashboard` link either: `/observability` is the canonical dashboard (#101).
- One navigation, no drawer (#101): the rail is the only menu at every width, so the v2 page loads no `navbar.js` and has no `#sidebar-toggle`, "Menu" button, `.tb-drawer` or `#side` sidebar. Under 900px the rail narrows from 56px to 48px and still shows all five icons, so there is no mobile menu that could hold a different list of destinations. If a collapse toggle is ever added, its drawer must repeat these same five hrefs in the same order, with the same active entry.

## Known clutter

- Two navigations on `/v1`: the top `<nav>` links plus the `declutter.js` sidebar drawer (with its own toggle, close, back and mobile Menu buttons). `declutter.js` restructures the page at runtime by cloning panels (badges, stages, hands-free checkbox) instead of the HTML being laid out that way.
- Three ways to run an example on `/v1`: the "Try an example" button (`#tryex`), the hidden `#examples` chips, and the `navbar.js` dropdown (`#exBtn`/`#exMenu`) that replaces them; the tips card also says "or try an example".
- Getting-started cues stack up: the `#firststep` tips card, `firstscreen.js` numbered steps, the pulse on Ask, the `#vorb-label` mic label and `#askhint`.
- Nav links differ by page: only `/observability` links to Observability, `/slides` drops Dashboards and Slides, and `slides.marketing.html` is an unrouted older deck with its own nav.
- Duplicate surfaces: run history appears in the `/v1` sidebar, the `/map` `#runs` list and `/observability`; the map plus Listen/Play controls exist on both `/v1` (`#play`, TTS via `/api/tts`) and `/map` (`#sumplay`, via `/api/tts_ts`), and the voice orb is on both.
