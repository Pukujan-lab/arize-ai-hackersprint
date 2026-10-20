# Pass 6: the voice must not make the reader wait, and must not stay broken

The owner reported that audio loading is very long, that the voice is buggy, and that Listen does not work
properly. The measurements below come from the deployed host.

## What the measurements show

A line that is not already cached, through the live app:

| Line | Cold | Warm |
| --- | --- | --- |
| 83–94 characters | 3.7–4.9 s | 0.01 s |
| 220 characters | 7.1 s | 0.01 s |
| 225 characters (the first memo line of a real run) | 8.3 s | — |

The page stops waiting for a clip after 7,000 ms (`REQUEST_GIVE_UP_MS` in `web/src/map/narrator.ts`). The
memo's long lines therefore arrive just after the page has already given up, are cached, and are thrown
away. The reader sees "Audio unavailable — the transcript carries on" and hears nothing.

A line that fails once is never asked for again: `request()` keeps the pending request in a module-level
`cache` map, and the entry resolves to `null`, so every later request for the same text returns that
`null` without asking the server. Reloading the page is the only cure.

Nothing is warmed before the reader presses Listen. The page prefetches only the line *after* the current
one, once narration is already running; a run opened on the home page asks for no audio at all.

## What must be true instead

1. **O109** A clip the server is still producing is never abandoned. A line is reported unavailable only
   when the server has actually failed to produce a clip.
2. **O110** A line that failed is asked for again the next time it is to be spoken, including a line that
   was prefetched too early. No failure is remembered for the session.
3. **O111** Opening a run starts making its first narrated line before any voice control is pressed.
4. **O112** A cold line of the memo's length (about 225 characters) is ready in under 6 seconds on this
   host. Today it takes 8.3 s.

The voice chain, the cache and the providers are yours to change. Keep the existing behaviour intact:
the page still names its speaker, still says "Audio loading…" while a clip is being fetched, still marks a
cached answer, still carries on with the transcript when no audio can be played, and still stops when the
reader drags or scrolls the map.

## The gates

```
cd /Users/teresaguajardo/aba/workspaces/prec-v3-119
set -a; . ~/.hack_env; set +a

# browser gates, offline against fixtures
/Users/teresaguajardo/aba/precedent-venv/bin/python -m pytest \
  tests/test_frontend_v3_voice_tour.py::test_O109_a_slow_clip_is_played_not_abandoned \
  tests/test_frontend_v3_voice_tour.py::test_O110_a_failed_clip_is_asked_for_again \
  tests/test_frontend_v3_voice_tour.py::test_O111_an_opened_run_warms_its_first_line -q

# live latency gate, a real cold line through the provider chain
RUN_LIVE=1 /Users/teresaguajardo/aba/precedent-venv/bin/python -m pytest \
  tests/test_tts_chain.py::test_O112_a_cold_memo_line_is_ready_quickly -q
```

All four fail on the current build. Rebuild the frontend before running the browser gates.

Keep the rest green:

```
/Users/teresaguajardo/aba/precedent-venv/bin/python -m pytest \
  tests/test_frontend_v3_voice_tour.py tests/test_frontend_v3_tour.py \
  tests/test_tts_chain.py tests/test_tts_queue.py tests/test_tts_fish.py -q
```

`O112` writes one clip to the local and shared caches each time it runs. The gates write
`.coord/assignment.json` as a side effect and restore it — leave that file exactly as you found it.

Do not edit the tests, the fixtures or the spec. Commit the fix on the workspace branch and report the
exact command and full output for each gate above. Never print a secret value — if a failure involves a
credential, name the variable only.
