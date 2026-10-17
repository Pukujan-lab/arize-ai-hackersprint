"""Dependency gate glue for AGENTS.md "Dependencies and SDKs". The tools do the work; this file only wires them up.

  python tools/dep_policy.py pins > /tmp/pins.txt        # lock pins for this Python, for `pip-audit -r`
  python tools/dep_policy.py licenses                     # pip-licenses output checked against the allowlist
  python tools/dep_policy.py maturity --base origin/main  # new direct deps need a PyPI release in the last 12 months

requirements.in lists direct dependencies; requirements.txt is the lock made by `uv pip compile` (command in its header).
"""

from __future__ import annotations

import argparse
import datetime
import json
import pathlib
import subprocess
import sys
import urllib.error
import urllib.request

from packaging.markers import default_environment
from packaging.requirements import InvalidRequirement, Requirement
from packaging.utils import canonicalize_name

ROOT = pathlib.Path(__file__).resolve().parent.parent
MAX_AGE_DAYS = 365
ALLOW = ("MIT", "BSD", "Apache", "ISC", "PSF", "Python Software Foundation", "MPL", "Mozilla Public License 2.0", "Unlicense", "0BSD", "Zlib", "CC0", "HPND")
DENY = ("GPL", "AGPL", "SSPL", "BUSL", "Business Source", "Commons Clause", "Proprietary", "UNKNOWN", "Elastic License")


def _reqs(text: str):
    for raw in text.splitlines():
        line = raw.split("#", 1)[0].strip()
        if not line or line.startswith("-"):
            continue
        try:
            yield Requirement(line)
        except InvalidRequirement:
            continue


def pins(lock_text: str, env: dict | None = None) -> dict:
    """name -> version for the lock lines whose markers match this (or the given) Python."""
    e = dict(default_environment())
    e.update(env or {})
    out = {}
    for r in _reqs(lock_text):
        spec = str(r.specifier)
        if spec.startswith("==") and (r.marker is None or r.marker.evaluate(e)):
            out[canonicalize_name(r.name)] = spec[2:]
    return out


def direct(text: str) -> set:
    return {canonicalize_name(r.name) for r in _reqs(text)}


def _newest_upload(info: dict):
    best = None
    for files in (info.get("releases") or {}).values():
        for f in files or []:
            if f.get("yanked"):
                continue
            t = datetime.datetime.fromisoformat(f["upload_time_iso_8601"].replace("Z", "+00:00")).date()
            best = t if best is None or t > best else best
    return best


def maturity(names, fetch, today: datetime.date) -> list:
    problems = []
    for n in names:
        info = fetch(n)
        if not info:
            problems.append(f"{n}: not found on PyPI")
            continue
        last = _newest_upload(info)
        if last is None or (today - last).days > MAX_AGE_DAYS:
            problems.append(f"{n}: last release {last or 'never'}, more than {MAX_AGE_DAYS} days ago; pick a maintained package or explain in the PR")
    return problems


def license_problems(rows: list, locked: set) -> list:
    bad = []
    for r in rows:
        if canonicalize_name(r["Name"]) not in locked:
            continue
        lic = r.get("License") or "UNKNOWN"
        if any(d.lower() in lic.lower() for d in DENY) or not any(a.lower() in lic.lower() for a in ALLOW):
            bad.append(f"{r['Name']} {r.get('Version', '')}: license '{lic}' is not on the allowlist")
    return bad


def _pypi(name: str):
    try:
        with urllib.request.urlopen(f"https://pypi.org/pypi/{name}/json", timeout=20) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise


def _git_show(ref: str, path: str) -> str:
    p = subprocess.run(["git", "show", f"{ref}:{path}"], cwd=ROOT, capture_output=True, text=True)
    return p.stdout if p.returncode == 0 else ""


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("cmd", choices=["pins", "licenses", "maturity"])
    ap.add_argument("--base", default="origin/main")
    a = ap.parse_args(argv)
    lock = pins((ROOT / "requirements.txt").read_text())
    if a.cmd == "pins":
        print("\n".join(f"{n}=={v}" for n, v in sorted(lock.items())))
        return 0
    if a.cmd == "licenses":
        out = subprocess.run([sys.executable, "-m", "piplicenses", "--from=mixed", "--format=json"], check=True, capture_output=True, text=True).stdout
        bad = license_problems(json.loads(out), set(lock))
    else:
        base = _git_show(a.base, "requirements.in") or _git_show(a.base, "requirements.txt")
        new = direct((ROOT / "requirements.in").read_text()) - direct(base)
        print("new direct dependencies:", ", ".join(sorted(new)) or "none")
        bad = maturity(sorted(new), _pypi, datetime.date.today())
    for b in bad:
        print("::error::" + b)
    print(f"{a.cmd}: {'FAIL' if bad else 'PASS'} ({len(lock)} locked packages for this Python)")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
