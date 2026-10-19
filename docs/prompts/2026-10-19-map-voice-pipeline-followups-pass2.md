# Precedent — finish the map, the voice, the pipeline and the follow-ups

This is the second pass on the outcomes **O80–O93** and **O101–O103** in
`docs/specs/2026-10-18-frontend-v3.md`. The first pass built most of the engine work and then stopped
at the step limit before the page could run. Of the twenty-two gates, one passes and twenty-one fail,
because the map throws while it initialises and because several regions were never added.

Do not start from scratch. Read the diff you already made and finish it. The gates are the definition
of done and they are not yours to edit.

## Why the page fails today

1. **The map throws on every run.** `buildScene` in `web/src/map/gl.ts` takes counties as
   `{ name, polys, fill, outline }` and reads `county.outline` at line 322. `rebuild()` in
   `web/src/map/engine.ts` passes only `{ name, polys, fill }`, so `rgb(undefined)` calls
   `undefined.replace` and `init` never finishes. `ready` stays false and every browser gate fails.
   Supply the outline colour the scene asks for, and keep it distinct for a county that holds an
   authority.
2. **`rgb()` parses only hex.** `countyFill()` now returns `hsl(...)`. Even once the scene builds, a
   county with authorities renders black. Either return a hex colour from `countyFill()` or make the
   parser handle what you feed it.
3. **The debug contract is incomplete.** `web/src/map/debug.ts` exposes none of the members the gates
   read. Add them, honestly — they report what the page actually does:
   - `labels()` → `{ text, x, y, w, h }[]`, one entry per label actually drawn, in screen coordinates
   - `shortAnswer()` → the run's short answer
   - `tourPlan()` → `{ section, text }[]`, the stops in the order the walk will take them
   - `caption()` → `{ section, shown, index, total }`
   - `arcsDrawn` → the number of links actually drawn
   The engine already has most of the state; wire it through.
4. **Three regions were never added.** `web/src/components/MapPane.tsx` has no `Speaker` region, no
   `Pipeline` region and no `Answer source` marker. `web/src/pages/Index.tsx` still renders follow-ups
   as plain list items, the composer still says `Ask a legal question`, and `Run info` still shows the
   previous run's id.

## What must be true when you are done

The full outcome text is in the spec under "Map fidelity and motion", "Voice and the tour", "The
pipeline on the map" and "Follow-ups and the conversation". The short form, in the order to work:

1. **O80** All 64 county boundaries are drawn at the state and county views, both themes, basemap on
   and off, and a county holding an authority is distinguishable. The scene must report
   `countyOutlines >= 60` and `countyMeshes > 0` in `state().scene`.
2. **O81–O82** Court-view labels state authority, deciding court and year, with no overlaps. The
   court is the name the record carries, not a flattened `Colorado state court`; the source list, the
   map label and the tour agree.
3. **O83** An authority sits in the county its record names, else at the seat of its deciding court.
   Eight authorities across five places must not collapse into two pins. A run with no county tie says
   `no county` in the summary.
4. **O84** Links join only shown authorities and the reported count equals the drawn count.
5. **O85** Pins are born in order, links draw, the camera moves, and the animation ends. Reduced
   motion keeps the information without movement.
6. **O86** The map states the short answer in the same words as the memo.
7. **O87–O88** A `Speaker` region names the speaker, shows the line and a live indicator that stops
   with the voice. `Audio loading` while a clip is fetched, an unavailable-voice fallback that keeps
   the transcript, and an `Answer source` marker on the map showing `cache` for a cached run.
8. **O89–O91** Every opened run speaks and then tours. The walk is short answer → sources → opinion →
   memo → authority stops, and `tourPlan()` reports exactly that. The caption advances with the voice
   and marks the current stop.
9. **O92** A `Pipeline` region shows each stage starting and finishing while a run works, and marks a
   cached run as a replay.
10. **O101–O103** Follow-ups are buttons that ask their question with the current run as context and
    the resulting memo says it answered a follow-up. The composer says it will ask a follow-up while a
    run is open, one control starts a new question, and `Run info` names the run being read.

`O93` (the retrieval stage messages) and `O94–O100` (retrieval itself) are a separate pass. Do not
spend steps on the backend in this one.

## How to work

Build first, then run the gates, then fix what fails, until all of them pass:

```
cd /Users/teresaguajardo/aba/workspaces/prec-v3-119
/Users/teresaguajardo/aba/precedent-venv/bin/python -m pytest \
  tests/test_frontend_v3_map_fidelity.py tests/test_frontend_v3_voice_tour.py \
  tests/test_frontend_v3_pipeline.py tests/test_frontend_v3_followups.py -q
```

The tests start the app themselves; `data/nodes.jsonl` is absent in this workspace and that is
expected. Each browser gate takes a few seconds; the whole set is about ten minutes.

Run one gate at a time while you iterate (`pytest tests/test_frontend_v3_map_fidelity.py::test_O80_...`)
and the whole set before you report. Report the exact pass/fail output. Do not edit the tests, the
fixtures or the spec. Do not add a fallback to an older frontend; there is none.

Keep the current identity: dark, restrained, one accent, the reading column first. These capabilities
are about use, not decoration.
