# Working in this repo (for coding agents)

This file tells a coding agent where things go in Precedent and how a change gets from a branch to the live site. Read it before your first edit. The layout is also recorded in `repo.manifest.json`, which CI checks, so if this file and the manifest ever disagree, the manifest wins and this file needs a fix.

## Writing rule at boot

Paste the block below into your system prompt when you start. It comes verbatim from the pinned writing helper (`.content-system/system-version.json` names the version and commit) and CI fails if it drifts. Do not edit the text between the markers by hand; change the pin and copy the new block instead.

<!-- cgm:always-on-start -->
CGM ALWAYS-ON WRITING RULE (every adopter that pins this helper)

Before you write ANY human-facing output — including HTML reports, compare HTML/UIs, appendable HTML, PR/issue/commit prose, docs, posts, papers, or other readable artifacts — you MUST load and apply modules/human-sounding-writing/SKILL.md (hsw).

This rule is always on. Opt-in is forbidden. Do not wait for a per-task, per-report, or per-HTML flag.

Exceptions (only these):
- README.md / product entry pages → load modules/writing-direction/SKILL.md instead
- Human-facing research plans, architecture explanations, and evidence briefs → load modules/writing-direction/SKILL.md (reader-facing explanation, not a manuscript or data writeup)
- Generated artifact filenames / asset-manifest paths / media basenames / filename legends → load modules/human-output-naming/SKILL.md (hon) for basenames; visible prose inside HTML still uses hsw

HTML reports, compare HTML, and compare UIs have NO skip path. An exception reason is not allowed for those surfaces.

If you cannot load the skill file from the pinned CGM checkout, stop and report that — do not draft jargon-heavy or tool-dump HTML instead.

Filenames: use scripts/human_filename (speakable basenames; optional safe_twin) and keep a per-feature legend. Hash may stay a separate manifest field.
<!-- cgm:always-on-end -->

## Where things go

New backend code goes in `app/`. The FastAPI app is `app.server:app`, and modules import each other as `from app import llm` or `from app.coord import Run`. Never write `import app.x` inside `app/server.py`: that rebinds the name `app` and replaces the FastAPI object. The top-level `server.py` is only a shim so `uvicorn server:app` keeps working; put nothing else in it.

Coordination code goes in `acs/` (`board.py`, `claim.py`, `hotload.py`). The other files in `acs/` are vendored from agent-custom-setup and are read-only here; `acs/SOURCE.md` says where they came from.

Changes to the tables the app keeps in Octo go in `schema/` and `migrations/`: bump `SCHEMA_VERSION`, add the next numbered migration (never edit a released one), run `python -m schema.lock`, and bump `storage_schema_version` in `contracts/storage.json` to match. `docs/voice-and-data-model.md` has the details.

Tests go in `tests/`, one file per behaviour, named `test_<thing>.py`. Docs go in `docs/` and are indexed in `docs/README.md`. Scripts go in `tools/`. Frontend files stay in `static/`. API contracts live in `contracts/openapi.json`, agent contracts in `contracts/agents/`, and the storage map in `contracts/storage.json`.

Adding a new top-level file or folder? Add it to `repo.manifest.json` in the same PR, with its owner and where its runtime data lives. `tests/test_manifest.py` fails otherwise. The same test fails if code writes somewhere the manifest does not list under `runtime_writes`.

## What never goes in git

Secrets stay in `~/.hack_env` on the Pro or in your own shell. Refer to them by variable name (`INFERHUB_API_KEY`, `ANTHROPIC_API_KEY`, `ELEVENLABS_API_KEY`, `ARIZE_API_KEY`, `OCTO_API_KEY`) and never print their values, even in logs or PR text.

Runtime data is not committed either: `cache/`, `runs/`, `data/`, `logs/`, `.tts_cache/` and `uvicorn.log` are gitignored. The case data and the Octo snapshot live in `~/precedent/data` on the Pro. Running the tests rewrites the seats in `.coord/assignment.json`; restore that file with `git checkout .coord/assignment.json` before you commit unless you meant to change it.

## Test first

Write or extend the test before the change and watch it fail. Then make it pass. CI runs with `LLM_MODE=fake` and no network, so a test that needs a live server, a browser or secrets must be marked live (see `tests/conftest.py`); it then runs only with `RUN_LIVE=1`.

## Branch, PR, auto-merge, deploy

1. Claim the task (next section), then branch from a fresh `main`: `git switch -c <you>/<task>`.
2. Commit small steps. Rebase on `origin/main` right before you push, because several agents push to this repo at once.
3. Open a PR. `automerge.yml` turns on squash auto-merge for the owner's and bots' PRs, and the PR merges as soon as the `gates` job passes. No review is required, so the tests are the review.
4. After the merge, `deploy.yml` runs `deploy/deploy.sh` on the self-hosted runner on the Pro. It health-checks `http://127.0.0.1:3000/api/health` and `https://arize.design-bakery.com/api/health` and rolls back to the previous commit if either fails. It also refuses to deploy when `~/precedent` has uncommitted changes. A merge alone does not prove the site changed; check the deploy run.
5. If the live site breaks after your merge, revert the PR right away.

## Claiming work (ACS)

Tasks live on the ACS board at `$ACS_ROOT/.coord/hackathon/board.json` (ACS_ROOT defaults to `~/development/acs-adopter`). The board is guarded by an `fcntl` lock on `board.lock` next to it, so always go through the CLI or the API instead of editing the JSON:

```bash
python3 acs/claim.py list
python3 acs/claim.py claim HACK-04 --agent <you>
python3 acs/claim.py release HACK-04 --agent <you> --status done --note "PR #NN"
```

`POST /api/claim` and `POST /api/release` do the same over HTTP. Every claim and release is appended to `events.jsonl` on the board, and `acs/hotload.py` picks up board and seat changes without restarting the app (`GET /api/acs/hotload` shows what it loaded).

The four pipeline agents use a separate claim file, `.coord/assignment.json`, locked by `.coord/claim.lock` and written only by `app/coord.py`. Their inputs, outputs, allowed paths and data stores are in `contracts/agents/<role>.json`.

## Running the CI gates locally

```bash
python -m pip install -r requirements.txt pytest ruff mypy
ruff check . && ruff format --check .
mypy server.py app acs/board.py acs/claim.py acs/hotload.py
LLM_MODE=fake ACS_HOTLOAD=0 pytest -q -p no:cacheprovider tests -rs
```

The writing-helper checks need the pinned helper checked out in `.cgm/` (gitignored):

```bash
git clone https://github.com/Pukujan/content-generation-modules.git .cgm
git -C .cgm checkout 6831f91e165b62d719c05eb492f7375fa932b560
python tools/validate_cgm_adoption.py --helper-root .cgm
python .cgm/scripts/validate_content_system.py --root .cgm --adapter .content-system --project-root .
python .cgm/scripts/verify_hsw_applied.py --root .cgm
```

`docs/continuity/cgm-pin.md` explains the pin and how to move it.
