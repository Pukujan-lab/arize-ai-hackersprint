# Writing-helper pin

Precedent pins the content-generation-modules helper at **0.5.12**, commit `6831f91e165b62d719c05eb492f7375fa932b560`. That is the same commit Pukujan-lab/hades-v2 pins, and when this was set up on 2026-10-17 the helper's `main` still reported 0.5.12, so there was nothing newer to move to. The pin names a commit, not a tag.

The pin is recorded in two places, and they have to agree: `.content-system/system-version.json` and `pins.cgm` in `.coord/assignment.json`. None of the helper's source is copied into this repo. CI checks it out into `.cgm/` at that commit and validates against it.

## What the adapter holds

`.content-system/` covers all eight modules (brand-foundation, content-context, writing-direction, human-sounding-writing, human-output-naming, visual-direction, image-generation, html-demo) through these files:

- `system-version.json`: the pin and the module list
- `project-brief.json`: audience, problem and the evidence for each product claim, each tied to a file at a fixed commit
- `brand-language.json`, `visual-style.json`, `review-rubric.json`: tone, visual rules and the questions a reviewer should ask
- `asset-manifest.json` plus `prompts/`: image provenance. The only entry today is `.content-system/assets/adapter-placeholder.txt`, because Precedent has no README art yet. `web/public/og.png` exists, but nobody recorded how it was made, so it is left out instead of being given made-up provenance.
- `agent-system-block.txt`: the always-on writing block, also pasted between the `cgm:always-on` markers in `AGENTS.md`

## What CI checks

The `gates` job runs three checks against the pinned checkout. `tools/validate_cgm_adoption.py` (copied from Pukujan/vastai-gpu-broker) confirms the pin matches the checkout, that both copies of the boot block match the helper's `docs/writing-routing.json` exactly, and that each listed asset exists with the recorded hash and source record. The helper's own `validate_content_system.py` checks the adapter files and that the README stays about Precedent. `verify_hsw_applied.py` confirms the always-on writing contract is present in the helper.

None of this grades the writing. It proves the wiring is in place.

`verify_adopter_content.py` is not in CI, which matches hades-v2. Run by hand on 2026-10-17 it reported one finding: the README's first image is the CI status badge, an SVG, and the check wants a PNG hero image. The badge stays, and the README gets a real PNG hero when art ships. Wiring this check into CI now would block every merge on that one gap.

## Checking or moving the pin

```bash
git clone https://github.com/Pukujan/content-generation-modules.git .cgm
git -C .cgm checkout 6831f91e165b62d719c05eb492f7375fa932b560
python tools/validate_cgm_adoption.py --helper-root .cgm
python .cgm/scripts/validate_content_system.py --root .cgm --adapter .content-system --project-root .
python .cgm/scripts/verify_hsw_applied.py --root .cgm
python .cgm/scripts/verify_adopter_content.py --project-root .
```

To move the pin, change the commit and version in `system-version.json`, `pins.cgm`, the `ref:` in `.github/workflows/ci.yml` and the commands above, copy the new `acs_prompt_inject.system_block` into both `agent-system-block.txt` and `AGENTS.md`, and rerun the checks.
