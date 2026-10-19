# Precedent — the map, the voice, the pipeline, retrieval and follow-ups

The owner's direction, recorded in the spec: the map must carry the geography, the court names and the
movement of the earlier product; the page must sound like a speaker talking to the reader and walk the
memo in the order the memo is written; the pipeline must show itself working and must name the path it
actually took; retrieval must use every path the corpus supports — meaning as well as words, and the
citation graph as well as the passages — and must say when it has nothing on point; and every run must
carry follow-ups the reader can act on.

The binding outcomes are **O80–O103** in `docs/specs/2026-10-18-frontend-v3.md`, under the headings
"Map fidelity and motion", "Voice and the tour", "The pipeline on the map", "Retrieval" and
"Follow-ups and the conversation". The issues are **#131, #132, #133, #134 and #135**. Fix all of them
in one pass. The four pages (`/`, `/map`, `/observability`, `/slides`) and every existing behaviour must
keep working.

## What must be true when you are done

### The map (#131)

1. **Every county boundary is drawn.** At the state and county views, in both themes, with the basemap on
   and off, the scene draws all 64 county outlines as well as the county solids. A county that holds an
   authority is visually distinct from one that does not.
2. **A court label names the authority, the court and the year.** At the court view each label reads as
   the authority, then the court that decided it, then the year. No label overlaps another label or a
   pin. The deciding court is the name the record carries — `Colorado Supreme Court`,
   `Colorado Court of Appeals`, a named circuit — never a flattened `Colorado state court`. The source
   list, the map label and the tour state the same court.
3. **An authority is placed where its record places it.** When the record names a county (the origin
   text or the passage), the authority sits in that county; otherwise it sits at the seat of its
   deciding court. Eight authorities across five places must not collapse into two dots. When no
   authority is tied to a county, the summary says `no county` in words.
4. **Links join only what is shown.** Every drawn link joins two authorities that are on the map, and
   the reported link count equals the number of links drawn.
5. **A run arrives with motion.** Pins appear in order, the active authority is marked, links draw from
   source to target, and the camera moves between stops. With reduced motion requested, the same
   information appears without movement.
6. **The map states the short answer.** It shows the run's short answer in the same words as the memo
   and the voice, with the counts as secondary detail.

### Voice and the tour (#132)

7. **A named speaker.** While the page speaks, the map has a region named `Speaker` that names the
   speaker, shows the line being spoken and shows a live indicator. The indicator stops when the voice
   stops; `Stop listening` stops both.
8. **Visible audio states.** While a clip is being fetched the page says `Audio loading`. When no clip can
   be played it says the voice is unavailable and continues with the transcript. An answer served from a
   cache is marked as cached in the same place on the map as in the memo (`Answer source`).
9. **Every opened run speaks and tours.** A freshly asked run, a saved run, and a run opened from the map
   all speak their summary and then begin the tour, unless the reader has muted the voice.
10. **The walk follows the memo.** The stops are, in order: the short answer, the sources and citations,
    the opinion or caveat, the memo, then the authority stops. The transcript names the section it is in.
11. **The caption follows the voice.** The transcript reveals its text in step with the audio, marks the
    line being spoken, and keeps the current stop's pin highlighted.

### The pipeline on the map (#133)

12. **Stages are visible while the run works.** The map has a region named `Pipeline` that shows each
    stage — planner, retriever, answer, safeguard — as it starts and finishes. A run replayed from a
    cache is marked as a replay (`cached` or `replay` in the region).
13. **Stage text names the path actually taken.** No stage message may claim a capability the run did not
    use. The seed event names the graph backend actually consulted and the passage event names the search
    actually used.

### Retrieval (#134)

14. **Meaning reaches the governing authority.** A question phrased in different words from the
    authority's own reaches the authority that governs it. The fixed questions and expected authorities
    are in the gate. The corpus already stores an embedding for every passage, and the citation graph
    already holds the citation edges; use all of the retrieval paths the corpus supports.
15. **A relevance floor and an honest scope answer.** A question outside the corpus (`hello how are you`)
    is answered with the fact that there is no authority on the point. Unrelated authorities are never
    presented as the answer, the result reports a coverage other than `on_point`, and the citation check
    is not reported as passed.
16. **A misspelling or an everyday synonym does not block retrieval.** `am i allowed to carry gun withotu
    license` still reaches the concealed-carry authority.
17. **A retrieved authority is not dropped for lack of a local graph node.** It appears with the
    metadata and the link the index holds.
18. **The graph is considered in ranking.** Authorities cited by, and authorities that cite, a retrieved
    authority are considered; the ranking prefers authorities relevant to the question over authorities
    that are merely widely cited.
19. **Statute citations are complete.** A statute names its section, its title, its effective date when
    the record has one, and a link to its text. An article-level placeholder is not cited where a
    section is available. An authority with missing metadata says which field is missing.
20. **Tracing is reported honestly.** A completed run reaches tracing with its question, answer,
    provider, citation-check result and elapsed time, or the page says tracing is unavailable and why.
    `/api/health` reports `tracing` as an object with `ok` and, when not ok, `reason`.

### Follow-ups (#135)

21. **Every completed run carries three grounded follow-ups**, each tied to the run's authorities, and
    the follow-up panel shows them.
22. **A follow-up is a control.** Choosing one asks that question with the current run as context: the
    request carries the run being read. The resulting memo shows that it answered a follow-up.
23. **The conversation is visible.** After a run the composer says it will ask a follow-up. One control
    starts a new question, and `Run info` names the run being read — not its predecessor.

## The acceptance gates

These are the definition of done and they are not yours to edit:

```
tests/test_frontend_v3_map_fidelity.py   # O80, O81, O82, O83, O84, O85, O86
tests/test_frontend_v3_voice_tour.py     # O87, O88, O89, O90, O91
tests/test_frontend_v3_pipeline.py       # O92, O93
tests/test_retrieval_v3.py               # O94, O95, O96, O97, O98, O99, O100
tests/test_frontend_v3_followups.py      # O101, O102, O103
```

The fixtures are `tests/fixtures/run-fidelity.json` and the existing ones. The browser gates drive the
map contract, which must expose these honestly — they report what the page actually does, never a
constant:

```
state().scene.countyOutlines     state().scene.countyMeshes
state().summary                  state().arcsDrawn     state().arcCounts
state().motion.running           state().motion.born   state().motion.arcProgress
state().speaker                  state().pipeline      state().tour
state().tour.activeIndex         pins()                labels()
pinCount                         shortAnswer()         zoomToCourt(i)
tourPlan()                       caption()
```

`labels()` entries carry `text`, `x`, `y`, `w`, `h`. `pins()` entries carry `key`; a pin placed in a
county starts its key with `c:`. `tourPlan()` returns the stops with `section` and `text`. `caption()`
returns `section`, `shown`, `index` and `total`.

Run the browser gates from the workspace root against a fresh production build of the app, with the
interpreter `/Users/teresaguajardo/aba/precedent-venv/bin/python`:

```
/Users/teresaguajardo/aba/precedent-venv/bin/python -m pytest \
  tests/test_frontend_v3_map_fidelity.py tests/test_frontend_v3_voice_tour.py \
  tests/test_frontend_v3_pipeline.py tests/test_frontend_v3_followups.py -q
```

The retrieval gates call the live providers and skip when the credentials are absent. Run them with the
host environment sourced from the environment file (source it, never print it or any value from it):

```
set -a; . ~/.hack_env; set +a
/Users/teresaguajardo/aba/precedent-venv/bin/python -m pytest tests/test_retrieval_v3.py -q
```

The existing suites must also stay green, and the build must succeed.

## Direction

Keep the current identity: dark, restrained, one accent, the reading column first. These capabilities
are about use, not decoration — they must be quiet until needed and never crowd the memo or the map.
Do not add a fallback to an older frontend; there is none to fall back to. Do not change the outcome
wording to fit the implementation. Do not edit the gates, the fixtures or the spec.

Work until every gate above passes, then report what you changed and the exact test output.
