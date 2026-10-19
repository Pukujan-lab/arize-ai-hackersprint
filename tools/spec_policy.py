"""The v3 spec is approved, every outcome has a test, every test cites a known outcome, and no policy
document prescribes the builder's technology. Runs in CI so a spec change cannot drift away from its tests."""

import os
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SPEC = ROOT / "docs" / "specs" / "2026-10-18-frontend-v3.md"
POLICY_FILES = [
    SPEC,
    ROOT / "docs" / "specs" / "2026-10-18-frontend-v3-parity.md",
    ROOT / "AGENTS.md",
    ROOT / "contracts" / "agents" / "coding-agent.json",
]
PRESCRIPTIONS = [
    r"\breact\b",
    r"\bvue\b",
    r"\bsvelte\b",
    r"\bangular\b",
    r"\bpreact\b",
    r"\bnext\.js\b",
    r"\bnuxt\b",
    r"\btailwind\b",
    r"\bshadcn\b",
    r"\bbootstrap\b",
    r"\bvite\b",
    r"\bwebpack\b",
    r"\btypescript\b",
    r"\bplain html\b",
    r"\bvanilla js\b",
    r"\bno new dependencies\b",
    r"\bno build step\b",
]
OUTCOME = re.compile(r"\*\*O(\d+)\.\*\*")
CITE = re.compile(r"^def (test_(O\d+(?:_O\d+)*)_\w*)\(", re.M)


def outcomes(text):
    return {int(n) for n in OUTCOME.findall(text)}


def citations(tests):
    cited = {}
    for path in sorted(tests.rglob("test_*.py")):
        for name, group in CITE.findall(path.read_text(encoding="utf-8")):
            for n in re.findall(r"O(\d+)", group):
                cited.setdefault(int(n), []).append(f"{path.relative_to(ROOT)}::{name}")
    return cited


def main():
    errors = []
    if not SPEC.exists():
        sys.exit(f"missing {SPEC.relative_to(ROOT)}")
    text = SPEC.read_text(encoding="utf-8")

    status = re.search(r"\*\*Status:\*\*\s*(\S+)", text)
    if not status or status.group(1) != "owner-approved":
        errors.append(f"the spec is not approved (status: {status.group(1) if status else 'none'})")

    declared = outcomes(text)
    if not declared:
        errors.append("the spec declares no outcomes")

    cited = citations(ROOT / "tests")
    missing = sorted(declared - set(cited))
    unknown = sorted(set(cited) - declared)
    if missing:
        errors.append(f"outcomes with no test: {', '.join(f'O{n}' for n in missing)}")
    if unknown:
        errors.append(f"tests cite outcomes the spec does not declare: {', '.join(f'O{n}' for n in unknown)}")

    for path in POLICY_FILES:
        if not path.exists():
            errors.append(f"missing policy file {path.relative_to(ROOT)}")
            continue
        body = path.read_text(encoding="utf-8")
        for pattern in PRESCRIPTIONS:
            m = re.search(pattern, body, re.I)
            if m:
                errors.append(f"{path.relative_to(ROOT)} prescribes a technology: {m.group(0)!r}")

    for message in errors:
        print(f"::error::{message}" if os.environ.get("GITHUB_ACTIONS") else f"error: {message}")
    if errors:
        return 1
    print(f"{len(declared)} outcomes, all cited by tests; no stack prescription found")
    return 0


if __name__ == "__main__":
    sys.exit(main())
