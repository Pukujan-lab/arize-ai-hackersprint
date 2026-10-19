# Precedent — restore the working-page capabilities of the earlier product

The owner's direction, recorded in the spec: the capabilities of the earlier product must exist in
this one, built here rather than patched in by hand, and every one of them must hold up in use. They
need not look the same. The previous pass fixed the reading and map regressions; this pass restores
what the reader could do around them.

The binding outcomes are **O73–O79** in `docs/specs/2026-10-18-frontend-v3.md`, under "The working
page, stated by the owner on 2026-10-19". The issue is #130. Fix all seven in one pass. The four pages
(`/`, `/map`, `/observability`, `/slides`) and every existing behaviour must keep working.

## What must be true when you are done

1. **A run shows its work while it works.** While a question is being answered, the page names the
   stage the pipeline has reached and shows the answer as it is written. When the run completes the
   draft is replaced by the finished memo and the progress region disappears. The progress region is
   named `Run progress`. The run endpoint reports progress as `events` and the draft as `partial`; read
   both.
2. **The source list carries the detail behind each authority.** For every authority it states the
   kind of authority (case, statute, regulation), the court, the date and the citation, and it shows a
   passage excerpt when one was retrieved. An authority with no passage says it came from the citation
   graph instead of leaving the entry blank.
3. **The memo states how the answer was produced.** A region named `Answer status` states whether the
   citation check passed and how many references were verified, how long the run took, and whether the
   answer came from a cache or an offline template. Each label says what it counts.
4. **A first visit is guided.** The page offers a dismissible getting-started cue named `Getting
   started` with at least three example questions. Choosing an example fills the composer. Dismissing
   the cue is remembered on later visits. Asking with an empty composer announces `Question needed`.
5. **A pin opens the authority behind it.** Clicking a pin opens a detail named `Authority` with the
   title, kind, court, date, passage and links of the authority it stands for. Only one detail is open
   at a time, a second pin replaces the first, and Escape closes it. The map contract gains
   `pinCites(i)`: the citation indices the pin for citation `i` stands for.
6. **Speech can always be silenced and stopped.** `Mute` silences all narration and becomes `Unmute`.
   Escape stops the voice and the tour. A clip being fetched shows `Audio loading`. A queued clip never
   cuts off the one playing.
7. **Saved runs open from Home.** An action named `Open a saved run` is reachable from Home, including
   when no run is loaded yet. It opens a panel named `Saved runs` listing the reader's runs by
   question. Choosing one loads its memo, map and tour without typing an address.

## The acceptance gates

These are the definition of done and they are not yours to edit:

```
tests/test_frontend_v3_features.py   # O73, O74, O75, O76, O77, O78, O79
```

Run them from the workspace root against a fresh production build of the app, with the interpreter
`/Users/teresaguajardo/aba/precedent-venv/bin/python`:

```
/Users/teresaguajardo/aba/precedent-venv/bin/python -m pytest \
  tests/test_frontend_v3_features.py -q
```

The fixture is `tests/fixtures/run-features.json`. The accessible names the gates use are listed in the
spec under "Verification contract": `Run progress`, `Answer status`, `Getting started`, `Dismiss
getting started`, `Question needed`, `Authority` (closed by `Close`), `Mute`, `Unmute`, `Audio
loading`, `Open a saved run`, `Saved runs`, plus the existing `Memo menu`, `Sources`, `Map key` and
`Tour transcript`. The map contract must expose `pinCites(i)` honestly: it reports what the map
actually stands for.

The existing suites must also stay green, and the build must succeed.

## Direction

Keep the current identity: dark, restrained, one accent, the reading column first. These capabilities
are about use, not decoration — they must be quiet until needed and never crowd the memo or the map.
Do not add a fallback to an older frontend; there is none to fall back to. Do not change the outcome
wording to fit the implementation.

Work until every gate above passes, then report what you changed and the exact test output.
