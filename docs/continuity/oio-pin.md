# OIO pin

Precedent pins observational-issue-ops (OIO) at the certified train commit
`e5e5fb1250aa8d154e9a83554638aec4cc8b2c8a`. The release train
(`Pukujan/agent-stack-train` stack-releases.json) labels that commit **0.1.0**.
At the same commit the installer writes `.oio/install-manifest.json` with
`oio_version` **0.2.0**, because OIO's own `stack-manifest.json` pin entry is
empty and the installer falls back to a hardcoded package version. Both numbers
are recorded in `pins.oio` under `.coord/assignment.json`; the commit is the
source of truth.

None of OIO's source tree is vendored. The installer copies its managed files
into `.oio/`, `.github/ISSUE_TEMPLATE/`, `.github/scripts/oio_*.py`,
`.github/workflows/issue-triage.yml`, and the `<!-- oio:issue-log-guidance -->`
block in `AGENTS.md`. Project-owned data (`.oio/ontology/project.json`) stays
editable.

## What CI checks

The `gates` job checks out the pinned OIO commit into `.oio-src/` (gitignored)
and runs `tools/validate_oio_adoption.py`, which:

1. Confirms `pins.oio.revision` matches the checkout and the pin doc.
2. Runs the installer's `--check` against this repository and expects `VALID`.
3. Confirms the AGENTS.md OIO guidance block is present.

## Install or move the pin

```bash
git clone https://github.com/Pukujan/observational-issue-ops.git .oio-src
git -C .oio-src checkout e5e5fb1250aa8d154e9a83554638aec4cc8b2c8a
python3 -m pip install -r .oio-src/requirements.txt
python3 .oio-src/.github/scripts/oio_installer.py --target "$(pwd)"
python3 tools/validate_oio_adoption.py --helper-root .oio-src
```

To move the pin, change the revision (and train/package versions) in
`.coord/assignment.json` (`pins.oio`), this file, and the `ref:` in
`.github/workflows/ci.yml`, reinstall from that checkout, and re-run the
validator.
