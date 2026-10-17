"""PR-body gate for AGENTS.md "Reuse before you write". Glue around `gh`; the rules live in evaluate().

A PR that adds a source module, or more than LINE_LIMIT non-test lines, under app/, acs/ or tools/ must either
  - have an "OSS considered" section naming at least one specific project or SDK and why it does not fit, or
  - be a bugfix (label `bugfix` or a `Bugfix:` line) that closes an issue whose evidence is confirmed.
Docs, tests, static/ and CI-only PRs are exempt. New raw HTTP calls to providers that ship an official SDK get a warning.

  python tools/pr_policy.py --repo OWNER/REPO --pr N     # in CI (needs GH_TOKEN)
  python tools/pr_policy.py --json pr.json               # offline, same shape as tests/fixtures/pr_policy_cases.json
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys

WATCHED = ("app/", "acs/", "tools/")
SOURCE_EXT = (".py", ".js", ".ts", ".sh")
LINE_LIMIT = 150
PROVIDER_HOSTS = {
    "api.anthropic.com": "anthropic",
    "api.openai.com": "openai",
    "api.inferhub.dev": "openai (OpenAI-compatible, set base_url)",
    "api.elevenlabs.io": "elevenlabs",
    "api.fish.audio": "fish-audio-sdk",
    "generativelanguage.googleapis.com": "google-genai",
    "otlp.arize.com": "arize-otel",
}
RAW_HTTP = re.compile(r"\b(httpx|requests|urllib\.request|aiohttp)\b")
PLACEHOLDER = re.compile(r"(name the open-source packages|write \"no new module\"|<[^>]+>|\bTODO\b|\bTBD\b)", re.I)
EMPTY = re.compile(r"^\W*(none|n/?a|no new module|not applicable)\W*$", re.I)
PROJECT = re.compile(r"(https?://\S+|`[^`\s][^`]*`|\b[\w.-]+/[\w.-]+\b|\b(pypi|npm):\S+)")
REASON = re.compile(r"\b(because|does ?n[o']t|did ?n[o']t|cannot|can't|lacks?|missing|no |not |too |only|instead|requires?|needs?|would)", re.I)
BUGFIX_LINE = re.compile(r"^\s*bugfix\s*:", re.I | re.M)
CONFIRMED = re.compile(r"###\s*Evidence Confidence\s*\n+\s*confirmed\b", re.I)


def _is_test(path: str) -> bool:
    name = path.rsplit("/", 1)[-1]
    return path.startswith("tests/") or "/tests/" in path or name.startswith("test_") or name.endswith("_test.py") or name == "conftest.py"


def scope(files: list[dict]) -> dict:
    watched = [f for f in files if f["path"].startswith(WATCHED) and not _is_test(f["path"])]
    new = [f["path"] for f in watched if f.get("status") == "added" and f["path"].endswith(SOURCE_EXT)]
    lines = sum(int(f.get("additions") or 0) for f in watched)
    return {"new_modules": new, "lines": lines, "needs_reason": bool(new) or lines > LINE_LIMIT}


def oss_section(body: str) -> str:
    """Text of the '## OSS considered' section, or of an 'OSS considered:' line and what follows it."""
    body = re.sub(r"<!--.*?-->", "", body or "", flags=re.S)
    m = re.search(r"^#+\s*OSS considered\s*:?\s*$(.*?)(?=^#+\s|\Z)", body, re.I | re.M | re.S)
    if m:
        return m.group(1).strip()
    m = re.search(r"^\s*OSS considered\s*:\s*(.+?)(?=\n\s*\n|\Z)", body, re.I | re.M | re.S)
    return m.group(1).strip() if m else ""


def oss_ok(text: str) -> bool:
    if not text or EMPTY.match(text) or PLACEHOLDER.search(text):
        return False
    return len(text) >= 30 and bool(PROJECT.search(text)) and bool(REASON.search(text))


def bugfix_ok(pr: dict) -> tuple[bool, str]:
    if "bugfix" not in [x.lower() for x in pr.get("labels", [])] and not BUGFIX_LINE.search(pr.get("body") or ""):
        return False, ""
    issues = pr.get("linked_issues") or []
    if not issues:
        return False, "bugfix PRs must close an issue (Closes #N) that records the confirmed bug"
    for i in issues:
        if "evidence:confirmed" in [x.lower() for x in i.get("labels", [])] or CONFIRMED.search(i.get("body") or ""):
            return True, ""
    return False, "the linked issue does not show confirmed evidence (label evidence:confirmed or Evidence Confidence: confirmed)"


def sdk_warnings(files: list[dict]) -> list[str]:
    out = []
    for f in files:
        if _is_test(f["path"]) or not f["path"].endswith(SOURCE_EXT):
            continue
        for line in (f.get("patch") or "").splitlines():
            if not line.startswith("+") or line.startswith("+++") or not RAW_HTTP.search(line):
                continue
            for host, sdk in PROVIDER_HOSTS.items():
                if host in line:
                    out.append(f"{f['path']}: new raw HTTP call to {host}; prefer the official SDK ({sdk}), see AGENTS.md")
    return out


def evaluate(pr: dict) -> dict:
    files = pr.get("files") or []
    s = scope(files)
    v = {
        "ok": True,
        "scope": s,
        "reason": "exempt (no new module, at most %d new lines under app/, acs/, tools/)" % LINE_LIMIT,
        "warnings": sdk_warnings(files),
    }
    if not s["needs_reason"]:
        return v
    if oss_ok(oss_section(pr.get("body") or "")):
        return dict(v, reason="OSS considered section names a project and why it does not fit")
    fixed, why = bugfix_ok(pr)
    if fixed:
        return dict(v, reason="bugfix linked to a confirmed issue")
    what = ("new modules " + ", ".join(s["new_modules"])) if s["new_modules"] else f"{s['lines']} new lines under app/, acs/ or tools/"
    msg = (
        f"This PR adds {what}. Add an 'OSS considered' section that names at least one specific open-source project or official SDK "
        "and why it does not fit, or mark it as a bugfix (label `bugfix` or a `Bugfix:` line) that closes an issue with confirmed evidence."
    )
    return dict(v, ok=False, reason=msg + (f" ({why})" if why else ""))


def _gh(*args: str):
    return json.loads(subprocess.run(["gh", *args], check=True, capture_output=True, text=True).stdout or "null")


def from_github(repo: str, number: int) -> dict:
    meta = _gh("pr", "view", str(number), "--repo", repo, "--json", "body,labels,closingIssuesReferences")
    files = []
    for page in _gh("api", "--paginate", "--slurp", f"repos/{repo}/pulls/{number}/files?per_page=100"):
        files += [{"path": f["filename"], "status": f["status"], "additions": f["additions"], "patch": f.get("patch", "")} for f in page]
    issues = []
    for ref in meta.get("closingIssuesReferences") or []:
        i = _gh("issue", "view", str(ref["number"]), "--repo", repo, "--json", "number,labels,body")
        issues.append({"number": i["number"], "labels": [x["name"] for x in i["labels"]], "body": i.get("body") or ""})
    return {"body": meta.get("body") or "", "labels": [x["name"] for x in meta["labels"]], "files": files, "linked_issues": issues}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--repo")
    ap.add_argument("--pr", type=int)
    ap.add_argument("--json", help="read the PR from a JSON file instead of GitHub")
    a = ap.parse_args(argv)
    pr = json.load(open(a.json)) if a.json else from_github(a.repo, a.pr)
    v = evaluate(pr)
    for w in v["warnings"]:
        print("::warning::" + w)
    s = v["scope"]
    print(f"scope: {len(s['new_modules'])} new source modules, {s['lines']} new non-test lines under app/, acs/, tools/")
    print(("PASS: " if v["ok"] else "::error::") + v["reason"])
    return 0 if v["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
