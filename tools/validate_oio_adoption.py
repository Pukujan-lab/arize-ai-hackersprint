"""Confirm the pinned OIO checkout matches pins.oio and the installer's --check is VALID."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PIN_DOC = ROOT / "docs" / "continuity" / "oio-pin.md"
AGENTS = ROOT / "AGENTS.md"
START = "<!-- oio:issue-log-guidance:start -->"
END = "<!-- oio:issue-log-guidance:end -->"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--helper-root", required=True, help="checkout of pinned OIO")
    args = ap.parse_args()
    helper = Path(args.helper_root).resolve()
    if not helper.is_dir():
        print(f"FAIL: helper root missing: {helper}", file=sys.stderr)
        return 1

    assignment = json.loads((ROOT / ".coord" / "assignment.json").read_text())
    pin = (assignment.get("pins") or {}).get("oio") or {}
    rev = pin.get("revision")
    if not rev:
        print("FAIL: pins.oio.revision missing in .coord/assignment.json", file=sys.stderr)
        return 1

    head = subprocess.check_output(["git", "-C", str(helper), "rev-parse", "HEAD"], text=True).strip()
    if head != rev:
        print(f"FAIL: OIO checkout HEAD {head} != pins.oio.revision {rev}", file=sys.stderr)
        return 1

    doc = PIN_DOC.read_text()
    if rev not in doc:
        print(f"FAIL: {PIN_DOC} does not mention pins.oio.revision {rev}", file=sys.stderr)
        return 1

    agents = AGENTS.read_text()
    if START not in agents or END not in agents:
        print("FAIL: AGENTS.md missing OIO guidance markers", file=sys.stderr)
        return 1

    installer = ROOT / ".github" / "scripts" / "oio_installer.py"
    if not installer.is_file():
        print("FAIL: managed oio_installer.py missing", file=sys.stderr)
        return 1
    out = subprocess.check_output(
        [sys.executable, str(installer), "--target", str(ROOT), "--check"],
        text=True,
    )
    if "VALID" not in out:
        print(f"FAIL: oio_installer --check did not report VALID:\n{out}", file=sys.stderr)
        return 1

    manifest = json.loads((ROOT / ".oio" / "install-manifest.json").read_text())
    pkg = pin.get("package_version")
    if pkg and manifest.get("oio_version") != pkg:
        print(
            f"FAIL: install-manifest oio_version {manifest.get('oio_version')!r} != pins.oio.package_version {pkg!r}",
            file=sys.stderr,
        )
        return 1

    # Optional: confirm helper installer is byte-compatible with managed copy hash in manifest
    managed_hash = (manifest.get("managed_files") or {}).get(".github/scripts/oio_installer.py")
    if managed_hash:
        import hashlib

        data = installer.read_bytes().replace(b"\r\n", b"\n").replace(b"\r", b"\n")
        if hashlib.sha256(data).hexdigest() != managed_hash:
            print("FAIL: managed oio_installer.py digest mismatch vs install-manifest", file=sys.stderr)
            return 1

    print(f"VALID: OIO pin {rev} and installer --check")
    return 0


if __name__ == "__main__":
    sys.exit(main())
