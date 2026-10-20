# Issue log: the map, the voice, the tour and retrieval still fall short of v1

- **Date:** 2026-10-19
- **Reported by:** owner, after using the deployed build `f7e87bf`
- **Scope:** Home (`/`), the map pane, `/map`, the tour, the narrator and the retrieval pipeline
- **Status:** open
- **Follows:** `docs/issues/2026-10-19-ui-regressions.md` (O65–O79)

The working page now renders, narrates and opens saved runs, but the owner's comparison with v1 still fails
on five fronts: the map is nearly empty, the voice has no presence, the tour is a slideshow of authorities,
the pipeline is invisible while it works, and retrieval returns topically unrelated authorities without
saying so. Each item below records what was observed, the evidence behind it, and what the product must do
instead. These become outcomes `O80` onward in `docs/specs/2026-10-18-frontend-v3.md`, each with a failing
acceptance test, before any builder run starts.

---

## A. The map

### 1. County borders are missing

**Observed.** Colorado is one flat slab. The sixty-four county outlines that exist in the geometry are not
drawn, so the map reads as a blue rectangle with two dots.

**Evidence.** `web/src/map/engine.ts:1032` builds the WebGL scene with fills only:
`counties: this.world.counties.map((c) => ({ name, polys, fill }))`. `web/src/map/gl.ts:283-346`
(`buildScene`) emits triangle buffers for `stateTop`, `stateWall`, `countyTop`, `countyWall` and `arcs` —
there is no line geometry at all. The `countyLine` colour exists in both palettes
(`web/src/map/engine.ts:118,132`) and is used only by `buildFlatLayer` (`web/src/map/engine.ts:1088`), the
2D fallback. The live scene therefore cannot draw a border.

**Must instead.** Every county has a visible outline at the county and state views, at both themes, and the
outline of a linked county is distinct from an unlinked one. Turning the basemap on does not remove the
outlines.

### 2. Court labels carry no court name and no date

**Observed.** At the court level a pin is labelled with the case title alone. The owner asked for the court
and the year on the map.

**Evidence.** `web/src/map/engine.ts:1301-1330` (`layoutLabels`): at `level === "court"` the label is
`pin.titles[0] || pin.label`; the date and the court are never read. The data needed is present in the
citation (`court`, `date`), and in the passage's own header ("Supreme Court of Colorado | 1923",
"Colorado Court of Appeals | 1998").

**Must instead.** At the court level each label states the authority, the court that decided it and the
year, in that order, and the label does not collide with a neighbouring label or a pin.

### 3. Every case reports the same generic court

**Observed.** All four cases in the mineral run say "Colorado state court". The reader cannot tell a
Supreme Court decision from a Court of Appeals decision.

**Evidence.** Run `145112-49e18a`, citations `[1]`–`[4]`, each has `"court": "Colorado state court"` while
its retrieved passage begins "Supreme Court of Colorado | 1923", "Colorado Court of Appeals | 1998",
"Colorado Court of Appeals | 1996", "Supreme Court of Colorado | 1997". The court that actually decided the
case is in the passage and is flattened before it reaches the citation. `app/graph_store.py` stores the
node's court field as a coarse value; `app/agents.py:60-72` copies it into the citation unchanged.

**Must instead.** A citation names the deciding court as the record names it (for example "Colorado Supreme
Court", "Colorado Court of Appeals", "U.S. District Court, D. Colo."), and the map, the source list and the
tour all read the same value.

### 4. Eight authorities collapse into two pins

**Observed.** A run with eight authorities shows two pins: the Capitol and Denver. The summary line says
`0 counties linked · 1 jurisdictions · 0 links`. The map is not a map of the answer.

**Evidence.** Live probe of the mineral run: `pins 2`, `pins detail [{'key': 'capitol', 'cat': 'statute',
'count': 4}, {'key': 'denver', 'cat': 'state', 'count': 4}]`, `0 counties linked`, `0 links`, county labels
`None`, court labels `None`. `web/src/lib/citations.ts:275-335` (`locate`) routes every statute to the
Capitol and every Colorado case to Denver unless `findCounty(origin_text + " " + passage)` matches a county
pattern. Every citation in the run has `origin_text: null`, and none of the four case passages names a
county, so the county branch is never taken. The statutes are `co_statute` with empty `court`, empty `date`
and no passage, so they have no location other than the Capitol.

**Must instead.** An authority is placed where the record places it — its county when the record names one,
otherwise its court — and the map never presents two dots as the whole geography of an eight-authority run.
When a run genuinely has no county-level authority, the map says so in words rather than implying coverage.

### 5. Links are computed against authorities the run dropped

**Observed.** The run has four citation links and the map shows zero. The edges name authorities that are
not in the citation list at all.

**Evidence.** Run `145112-49e18a` edges:
`City of Northglenn v. Grynberg → C.R.S. § 24-10-101`,
`City of Northglenn v. Grynberg → C.R.S. § 24-10-106`,
`C.R.S. § 39-11-150 → C.R.S. Title 39, Article`,
`C.R.S. § 10-11-123 → C.R.S. Title 10, Article`.
Northglenn, § 39-11-150 and § 10-11-123 are not among the eight citations. `app/agents.py:66-68` ranks
candidates and cuts to eight after the edge list has been built; the edges are never filtered to the cut.
`web/src/map/engine.ts:361-380` (`computeArcs`) discards any edge whose endpoints are not in the citation
list, which is all four.

**Must instead.** Every drawn link connects two authorities that are on the map. Either the linked
authority is shown, or the link is not claimed. The link count in the summary matches the arcs on screen.

### 6. The map shows no motion

**Observed.** Pins appear fully formed, arcs are static, and nothing moves except the camera when a
jurisdiction is chosen. The owner asked for "a lot of animation" and described the tour as "not dynamic at
all".

**Evidence.** The only animation loop is `stepCamera` (`web/src/map/engine.ts:659-677`), which runs a
`requestAnimationFrame` tween only while `this.animating` is true. Pins are positioned by `layoutPins` on
each refresh; there is no birth scale, no halo pulse, no arc draw-on and no active-stop highlight. The
retired `static/map3d.js` had a staggered pin birth (`scale.setScalar(0.001)`, `born = now + k*200`), a
halo `RingGeometry`, a `busyRing`, and arcs that grew with `setDrawRange(0, 0)`.

**Must instead.** A new run animates in: pins arrive in order, the active authority is visibly marked, links
draw from their source to their target, and the camera moves between stops. A reader who prefers reduced
motion gets the same information without the movement.

### 7. The map's summary is a count, not the answer

**Observed.** The map header reads `0 counties linked · 1 jurisdictions · 0 links`. The owner's "short
answer" is not on the map at all, so the map cannot be read on its own and cannot open the narration.

**Evidence.** `web/src/map/engine.ts:351-359` (`computeHeat`) composes `summaryText` from counts only.
`web/src/components/MapPane.tsx:170` renders that string as the subtitle. The memo's short answer is
available in `ctx.answer` and is already extracted by `shortAnswer()` (`web/src/map/engine.ts:777-788`) for
narration, but it is never shown.

**Must instead.** The map shows the run's short answer as its summary, in the same words the memo and the
voice use, with the counts available as secondary detail. A reader who opens only the map can say what the
answer was.

---

## B. The voice and the tour

### 8. Nothing says who is speaking

**Observed.** The tour transcript is a bare line of small grey text. There is no speaker name, no speaking
indicator, and nothing that tells the reader the page is talking to them.

**Evidence.** `web/src/components/MapPane.tsx:410-420` renders `role="log" aria-label="Tour transcript"`
with `engine.spokenTextAt(tour.index)` and no identity, no label and no live state. The memo's `Listen`
control changes to `Stop listening` while narration runs (`web/src/pages/Index.tsx:387-389`), but the map
does not show that a voice is active. No component names a narrator.

**Must instead.** While the page is speaking, the map shows a named speaker, the line being spoken, and a
live indicator that advances with the audio. When the voice stops, the indicator stops with it.

### 9. Audio loading, fallback and cached answers are invisible

**Observed.** When the voice takes a moment, nothing says so. When the voice fails, the tour continues in
silence with no explanation. A cached answer is not marked as cached.

**Evidence.** `web/src/map/narrator.ts:33-49` (`request`) resolves to `null` on a non-OK response, on a
fetch error and after a 7 s give-up; `narrate` then advances the line on `SILENT_ADVANCE_MS` with no
message. There is no browser-speech fallback and no "audio unavailable" state. `Audio loading…` exists only
in the memo header (`web/src/pages/Index.tsx:395-399`), not on the map or in the tour. `answerFacts`
(`web/src/pages/Index.tsx:63-81`) maps a cache provider to the word "cache" in the `Answer status` line,
but the map and the tour do not carry it. The retired `static/audio.js` had `#audio-status` with
`loading`, `fail: 'Audio unavailable — continuing'`, `gesture: 'Tap anywhere to enable sound'`, a
`speechSynthesis` fallback and a 60 s caption-only period; `static/agentnodes.js` had an `#anCached`
"cached · replay" badge.

**Must instead.** While a clip is being fetched the page says `Audio loading`; when no clip can be played it
says the voice is unavailable and continues with the transcript; when the answer is served from a cache the
page says so in the same place. None of these states is silent.

### 10. A saved run opens silent

**Observed.** Opening a saved run by address, or opening `/map`, shows the memo and the pins but never
speaks and never starts the tour. Only a freshly asked question narrates.

**Evidence.** `engine.listen()` is called from exactly one place after a run: the submit handler at
`web/src/pages/Index.tsx:316`. The saved-run path (`open_run`, `/runs/<id>`, `/map?run=`) applies the result
without calling `listen()` or `startTour()`. The tour starts only from the memo's `Listen` control.

**Must instead.** Opening any run — fresh, saved, or from the map — speaks its summary and then begins the
tour, unless the reader has muted the voice. The reader can stop the voice without losing the tour.

### 11. The tour reads authorities only

**Observed.** The tour walks eight authority pins. The summary, the source reasoning, the opinion and the
memo's own text are not part of the walk. v1 spoke the summary first, then the sources and citations, then
the opinion and the memo.

**Evidence.** `startTour` (`web/src/map/engine.ts:681-689`) orders stops with `order()`, which is the
citation list (`web/src/map/engine.ts:385-390`). `spokenFor` (`web/src/map/engine.ts:399-403`) speaks
`spokenText(explainParts(...))`, which is title, court, year, holding and memo line for one authority. There
is no summary stop, no opinion stop and no memo stop. `listen()` (`web/src/map/engine.ts:791-799`) speaks
the short answer once and then jumps to `startTour(0)`.

**Must instead.** The walk has a fixed shape: the short answer first, then the sources and citations, then
the opinion or caveat, then the memo, and only then the authority stops. The transcript names the section
the reader is in.

### 12. The tour's caption does not follow the voice

**Observed.** The transcript shows the whole stop at once. There is no typing, no highlight, no advance
within a line, so the reader cannot tell how far the voice has got.

**Evidence.** `web/src/components/MapPane.tsx:417` renders `spokenTextAt(tour.index)` as a single string.
The retired `static/map3d.js` typed the summary at 2 characters per 30 ms with a pulsing caret
(`<span class='animate-pulse'>▍</span>`), and `static/v2.js` typed each stop with `typeOut()`.

**Must instead.** The caption reveals text in step with the audio, marks the line being spoken, and keeps
the current stop's pin highlighted.

---

## C. The pipeline

### 13. The run's work is invisible on the map

**Observed.** On `/map`, a question shows no sign that a planner, a retriever, a graph, a writer and a
citation check are running. The map stays static until the memo appears.

**Evidence.** The only progress surface is the `Run progress` block on Home
(`web/src/pages/Index.tsx:459-479`), which renders one stage string and an optional draft. The map pane has
no progress region and no agent representation. The retired `static/agentnodes.js` drew five nodes —
Planner → Octo retrieval → SurrealDB graph → Haiku draft → Safeguard — with `.on/.done/.pulse` states,
connector lines, a `gate()` that drained events on a budget, and a "safeguard PASS" finish.

**Must instead.** While a run is working, the map shows the pipeline's stages as they start and finish, and
the stage names match what the run is actually doing. A cached replay is marked as a replay.

### 14. The progress text claims paths the run does not take

**Observed.** The run says it is doing a "hybrid passage search" and a "SurrealDB traversal" and ranks by
"citation-weighted PageRank". None of those is true of this run.

**Evidence.** Run `145112-49e18a` events: `"Octo hybrid passage search (octo-live (cached)): 12 passages,
6 map to graph authorities"`, `"1-hop SurrealDB traversal (->cites / <-cites): 38 candidates, 30 edges"`,
`"ranked top 8 authorities by citation-weighted PageRank"`, while the same event carries
`"backend": "networkx"`. `app/octo_retriever.py:16-20` performs a single full-text query
(`websearch_to_tsquery`, `ts_rank`); there is no vector half. `app/agents.py:66` ranks by
`c * (1 + log1p(indegree))`, not PageRank. `app/graph_store.py:18-32` falls back to networkx when
SurrealDB does not answer, and the run reports `networkx`.

**Must instead.** Every stage message names the path the run actually used. If the graph is local or the
search is lexical, the page says so. A reader must not be told a capability ran when it did not.

---

## D. Retrieval

### 15. Retrieval matches words, not meaning

**Observed.** A question phrased in ordinary language retrieves authorities that share its words but not
its subject. The owner's suspicion that retrieval is not working is correct in the cases where the wording
does not match the statute.

**Evidence.** `app/octo_retriever.py:26` (`_terms`) strips stopwords and joins the remaining tokens with
`" OR "`; `app/octo_retriever.py:16-20` runs `websearch_to_tsquery('english', $1)` with that string.
There is no embedding call anywhere in `app/`. The Octo workspace holds 804,646 passages, every one with a
1024-dimension `baai/bge-large-en-v1.5` embedding and an HNSW cosine index (`chunk_embedding_hnsw`), and the
application never queries them. The graph half (`app/graph_store.py:82-93`) is IDF over id, title and type
tokens plus in-degree.

**Must instead.** A question phrased differently from the authority's own words still retrieves that
authority. A reader can ask "can I shoot someone who breaks into my house" and reach the self-defence
statute, not a case that happens to contain the word "house".

### 16. There is no relevance floor

**Observed.** "hello how are you" returns 33 passages and eight citations. A question about carrying a
firearm without a licence returns plumbing, teaching-licence and liquor-licence cases, and the citation
check still says PASS.

**Evidence.** Run `142449-adccd3` (question `am i allowed to carry gun withotu license`) returns
`Greene v. City of Loveland` ("shall obtain a license from the board of trustees", plumbing),
`School District No. 1 v. Cornish` ("Her license lapsed", teaching), `Trappers Lake Lodge & Resort`
("revocation of liquor licenses") and `People v. Edwards` ("a gun had been used in the burglary"), with
`safeguard.pass: true`. The answer itself says "none is on point", which is the only part of the run that
tells the truth. `app/octo_retriever.py:113-136` returns whatever the query matches, with no score floor
and no minimum topical overlap. `app/agents.py:217-247` checks references, named authorities and uncited
claims, not whether the authorities address the question.

**Must instead.** A question outside the corpus, or one whose retrieval does not address it, is answered
with that fact: the page says it has no authority on the point and offers what it can search next. It does
not dress unrelated authorities as a legal answer, and it does not report a citation check as passed when
the citations do not support the question.

### 17. Misspellings and synonyms break retrieval

**Observed.** One typo and one ordinary word are enough to lose the statute.

**Evidence.** `_terms("am i allowed to carry gun withotu license")` yields
`['allowed', 'carry', 'gun', 'withotu', 'license']`. `withotu` matches nothing; `gun` is not the statutory
word (`firearm`). The OR-joined query therefore retrieves on `allowed`, `carry` and `license`, which is why
the licence cases surface.

**Must instead.** A misspelled or everyday word still retrieves the authority it means. The page does not
require the reader to know the statute's vocabulary before it can find the statute.

### 18. Retrieved authorities are dropped when the graph lacks a node

**Observed.** Octo returns twelve passages for the firearm question. Only seven of the twelve works exist
as graph nodes, and the rest are discarded before the answer is written.

**Evidence.** Run `142449-adccd3` retrieval: 12 passages; `octo_seeds` keeps only works present in
`g.nodes` (`app/agents.py:41`). The five dropped works never reach the answer, the citation list, the map
or the sources panel. The same loss appears in the mineral run: 12 passages, 6 mapped.

**Must instead.** A retrieved authority is not discarded because the local graph does not have a node for
it. It appears with what is known about it, and the page says when its citation links are unavailable.

### 19. The graph half ranks by generic in-degree

**Observed.** The authorities that rise to the top of the graph half are broad titles such as "eCFR Title
29", "26 CFR" and "20 CFR", not authorities about the question. The statutes in the mineral run are
`C.R.S. Title 10, Article` and `C.R.S. Title 39, Article` with `cited_by` 1369 and 1048.

**Evidence.** `app/agents.py:66` multiplies the candidate weight by `1 + log1p(indegree)`;
`app/graph_store.py:82-93` ranks seeds by `score + 2*log1p(indegree)`. Broad titles accumulate in-degree
regardless of subject. The mineral run's citations `[5]`–`[8]` are all statutes with no passage, no date and
no URL, chosen because they are heavily cited, not because they answer the question.

**Must instead.** The graph half returns authorities that are related to the question and to the passages
already retrieved, not the nodes with the largest global in-degree.

### 20. Statute citations are incomplete

**Observed.** Statutes arrive as `C.R.S. Title 10, Article` with no date, no court, no URL and no passage.
The source list and the map cannot say anything about them.

**Evidence.** Run `145112-49e18a`, citations `[5]`–`[8]`: `title: "C.R.S. Title 10, Article"`,
`date: ""`, `court: ""`, `url: ""`, `passage: ""`, `origin_text: null`. `app/agents.py:60-72` copies
whatever the graph node holds. The titles are truncated at the article level, so the section number is lost.

**Must instead.** A statute citation names the section, its title, its effective date where the record has
one, and a link to the text. An authority with genuinely missing metadata says which field is missing
instead of showing an empty row.

### 21. Tracing loses the runs

**Observed.** The tracing export to Arize fails with `StatusCode.PERMISSION_DENIED`, so the runs the owner
would inspect in Arize are not there.

**Evidence.** The application log records
`Failed to export traces to otlp.arize.com, error code: StatusCode.PERMISSION_DENIED` on every run. The
run itself completes; only the export fails.

**Must instead.** Every completed run appears in the tracing project with its question, answer, provider,
safeguard result and elapsed time, or the page states that tracing is unavailable and why.

---

## E. Follow-ups and new questions

### 22. The backend never produces follow-ups

**Observed.** The Follow-ups panel always says "No follow-up questions were recorded for this run."

**Evidence.** `web/src/pages/Index.tsx:349` reads `result?.followups || []`; the result dict built in
`app/agents.py:352-373` has no `followups` key. The only related field is `"followup": bool(prev)` in the
tracing metadata (`app/agents.py:358`). No prompt, template or post-processing step generates suggested
questions.

**Must instead.** Every completed run carries three follow-up questions grounded in its authorities, and
the panel shows them.

### 23. Follow-ups are inert and the next-question actions are buried

**Observed.** Even when a follow-up is shown, it is a plain list item that cannot be clicked. `Follow-up`
and `New question` sit two levels deep in the memo menu, and the composer button always says `Ask`, so
nothing tells the reader they are in a conversation.

**Evidence.** `web/src/pages/Index.tsx:543-550` renders `<li key={item}>{item}</li>` with no handler. The
actions array (`web/src/pages/Index.tsx:356-372`) holds `Sources`, `Follow-ups`, `Run info`, `Follow-up`
and `New question`, all reachable only through the `Memo menu` drawer. The composer's submit control is
hard-coded `Ask` (`web/src/pages/Index.tsx:644-650`). `Run info` shows `prevRunId || "—"`
(`web/src/pages/Index.tsx:560`), which is the previous run's id, not the run being read.

**Must instead.** A follow-up is a button that asks that question with the current run as context. After a
run the composer says it will ask a follow-up, and one control starts a new question. `Run info` names the
run being read, not its predecessor.

---

## Outcome mapping

These items become the next block of outcomes in `docs/specs/2026-10-18-frontend-v3.md` (`O80` onward),
grouped as:

| Area | Items | Proposed outcomes |
| --- | --- | --- |
| Map geometry and labels | 1–4 | county outlines; court name and year; real court names; placement by record |
| Map links and motion | 5–7 | links only between shown authorities; arrival and link animation; short answer on the map |
| Voice and tour | 8–12 | named speaker; loading/fallback/cache states; saved runs narrate; summary → sources → opinion → memo; caption follows voice |
| Pipeline visibility | 13–14 | stages shown on the map; stage text matches the path taken |
| Retrieval | 15–21 | meaning-based retrieval; relevance floor and scope answer; typo tolerance; no dropping of retrieved works; question-relevant graph ranking; complete statute metadata; tracing export |
| Follow-ups | 22–23 | generated follow-ups; clickable follow-ups; visible next-question actions; current run id |

Each outcome gets one failing acceptance test before the builder is asked to implement it. The spec and the
tests land first; no application code changes until they do.

---

## Post-cutover defect (2026-10-19)

### 24. A page with no authorities claims a first stop

**Observed.** The map's tour bar reads `Stop 1 of 0`, and its `Previous stop`, `Next stop`, `Play` and
`Stop tour` controls are all usable. This appears on a page with no run at all and on a run that refused
because the corpus had nothing on point.

**Evidence.** Live, on `https://arize.design-bakery.com/` with no run:
`tour = {active: false, index: 0, count: 0}` while the page text contains `Stop 1 of 0` and every tour
control reports `disabled: false`. Live, on run `190842-a5aeac` (the greeting `hello`, provider
`scope:no-authority`, 0 citations), the same figures: `count: 0`, `Stop 1 of 0`, all four controls
enabled. The position is computed as `Math.min(tour.index + 1, tour.count) || 1` and the bar renders
whether or not the tour has stops.

**Must instead.** A page or run with no authorities never claims a stop: no `N of 0` position and no
usable previous, next, play or stop-tour control. Hiding the bar and disabling its controls are both
acceptable; claiming a first stop is not.

**Gate.** `test_frontend_v3_tour.py::test_O108_a_page_with_no_authorities_claims_no_stop` fails on the
current build for both cases.

---

## Voice latency and retry (2026-10-20)

The owner reported that audio loading is very long, that the voice is buggy, and that Listen does not
work properly. The measurements below were taken on the deployed host.

**How long a line takes.** Through the live app, a line that is not already cached:

| Line | Provider | Cold | Warm |
| --- | --- | --- | --- |
| 94 characters | fish | 3.7 s | 0.01 s |
| 83 characters | fish | 4.9 s | — |
| 91 characters | fish | 4.0 s | — |
| 220 characters | fish | 7.1 s | 0.01 s |
| 225 characters (a real memo line) | fish | 8.3 s | — |

Kokoro alone, on the same host, produces 42 characters in 0.8 s, 72 in 1.2 s and 347 in 7.0 s. The
provider chain tries Fish first, so every cold line pays Fish's latency before any fallback.

### 25. The page gives up on a clip before the server finishes it

**Observed.** Long memo lines never play. The speaker reads "Audio unavailable — the transcript carries
on" while the server is still producing the clip.

**Evidence.** The page stops waiting for a clip after 7,000 ms (`REQUEST_GIVE_UP_MS` in
`web/src/map/narrator.ts`). The memo's first line of run `001956-d11620` is 225 characters and takes
8.3 s cold. The clip arrives, is cached, and is thrown away.

**Must instead.** A clip the server is still making is never abandoned. A line may only be reported
unavailable when the server has actually failed to produce one.

**Gate.** `test_frontend_v3_voice_tour.py::test_O109_a_slow_clip_is_played_not_abandoned` serves an
8.5 s clip and fails on the current build.

### 26. A line that failed once is never tried again

**Observed.** After one failure the voice stays broken for the rest of the session. Reloading the page is
the only cure.

**Evidence.** `request()` stores the pending request in a module-level `cache` map and never removes it;
the entry resolves to `null` after the give-up, so every later request for the same text returns the same
`null` without asking the server. The prefetch path shares that map, so a prefetch that times out poisons
the line too.

**Must instead.** A failed line is asked for again the next time it is to be spoken, and a line that was
prefetched too early is retried when the reader reaches it.

**Gate.** `test_frontend_v3_voice_tour.py::test_O110_a_failed_clip_is_asked_for_again` fails on the
current build: the second attempt never reaches the server.

### 27. Nothing is warmed before the reader presses Listen

**Observed.** The first line always pays the full cold cost, which is exactly the line the reader is
waiting for.

**Evidence.** The page only prefetches the line *after* the current one (`prefetchClip` is called from
the narration step), and only once narration is already running. A run opened on the home page asks for
no audio at all until Listen is pressed.

**Must instead.** When a run is opened, its first narrated line is already being made before any voice
control is pressed.

**Gate.** `test_frontend_v3_voice_tour.py::test_O111_an_opened_run_warms_its_first_line` fails on the
current build.

### 28. A cold line takes too long to be ready

**Observed.** A 225-character cold line takes 8.3 s on this host, against a page that waits 7 s.

**Must instead.** A cold line of the memo's length is ready in under 6 s on this host.

**Gate.** `test_tts_chain.py::test_O112_a_cold_memo_line_is_ready_quickly` (live) fails on the current
build.

### Cache size, measured

The shared store holds 251 clips totalling 77 MB, an average of 307 KB per clip. A pre-built library of
10,000 clips would therefore be about 3 GB of audio, or about 4 GB stored as base64 in the shared
database. That is the real cost of the pre-cache idea; it is not small.
