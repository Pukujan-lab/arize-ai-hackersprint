# Pass 5: a page with no authorities must not claim a stop

One defect, found on the live site after the cutover. It is small and self-contained.

## What is wrong

The map's tour bar claims a first stop on a page that has no stops at all:

- On `/` with no run open, the bar reads `Stop 1 of 0`, and `Previous stop`, `Next stop`, `Play` and
  `Stop tour` are all usable.
- On a run that refused because the corpus had nothing on point (`provider: scope:no-authority`, zero
  citations), the same figures: the tour reports `count: 0` and the bar still reads `Stop 1 of 0` with
  every control enabled.

Measured on the deployed build: `tour = {active: false, index: 0, count: 0}` next to `Stop 1 of 0` in
the page text, with `disabled: false` on all four controls.

## What must be true instead

A page or run with no authorities never claims a stop:

- the page never shows an `N of 0` position, and
- none of `Previous stop`, `Next stop`, `Play`, `Stop tour` is usable.

Hiding the bar and disabling its controls are both acceptable. Claiming a first stop is not. A reader
must never be able to press a control that pretends to move through stops that do not exist.

## The gate

```
cd /Users/teresaguajardo/aba/workspaces/prec-v3-119
set -a; . ~/.hack_env; set +a

/Users/teresaguajardo/aba/precedent-venv/bin/python -m pytest \
  tests/test_frontend_v3_tour.py::test_O108_a_page_with_no_authorities_claims_no_stop -q
```

It checks both cases: a fresh page with no run, and the fixture run in
`tests/fixtures/run-no-authority.json`, which is the real refusal payload. It fails on the current build
at the first assertion. Rebuild the frontend before running it.

Keep the rest of the tour green:

```
/Users/teresaguajardo/aba/precedent-venv/bin/python -m pytest \
  tests/test_frontend_v3_tour.py tests/test_frontend_v3_voice_tour.py \
  tests/test_frontend_v3_map_chat.py tests/test_frontend_v3_reading.py \
  tests/test_frontend_v3_home.py -q
```

The tests start the app themselves; `data/nodes.jsonl` is absent in this workspace and that is expected.
The gates write `.coord/assignment.json` as a side effect and restore it — leave that file exactly as
you found it.

Do not edit the tests, the fixtures or the spec. Commit the fix on the workspace branch and report the
exact command and full output for each gate above.
