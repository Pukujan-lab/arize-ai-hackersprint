#!/usr/bin/env python3
"""Turn pytest red-team failures into OIO-format GitHub issues (deduped by title fingerprint)."""

from __future__ import annotations

import json
import os
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

REPO = os.environ.get("GITHUB_REPOSITORY", "Pukujan/arize-ai-hackersprint")
TOKEN = os.environ["GITHUB_TOKEN"]
API = f"https://api.github.com/repos/{REPO}"
ONTOLOGY = "oio=1.1.0; project=1.0.0"
TITLE_PREFIX = "[ISSUE]: red-team:"
PRIORITY = {
    "security": ("1", "pukujan-arize-ai-hackersprint:priority-1"),
    "integrity": ("2", "pukujan-arize-ai-hackersprint:priority-2"),
    "fallback": ("3", "pukujan-arize-ai-hackersprint:priority-3"),
    "robustness": ("3", "pukujan-arize-ai-hackersprint:priority-3"),
    "audio": ("4", "pukujan-arize-ai-hackersprint:priority-4"),
    "ux": ("5", "pukujan-arize-ai-hackersprint:priority-5"),
    "ops": ("6", "pukujan-arize-ai-hackersprint:priority-6"),
}


def api(method: str, path: str, body: dict | None = None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(
        API + path,
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "Content-Type": "application/json",
            "User-Agent": "precedent-redteam",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read().decode() or "null")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "{}")


def ensure_labels(names: list[str]) -> None:
    _, existing = api("GET", "/labels?per_page=100")
    have = {x["name"] for x in (existing or [])} if isinstance(existing, list) else set()
    colors = {
        "red-team": "b60205",
        "observational-issue": "0e8a16",
        "proposal": "cfd3d7",
        "fallback": "fbca04",
        "robustness": "d93f0b",
        "area:security": "b60205",
        "area:integrity": "d93f0b",
        "area:fallback": "fbca04",
        "area:ux": "1d76db",
        "area:audio": "5319e7",
        "area:ops": "006b75",
        "severity:critical": "b60205",
        "severity:high": "d93f0b",
        "severity:moderate": "fbca04",
        "severity:low": "0e8a16",
        "severity:informational": "cfd3d7",
    }
    for n in names:
        if n not in have:
            api("POST", "/labels", {"name": n, "color": colors.get(n, "ededed")})


def oio_body(finding: dict) -> str:
    area = finding["area"]
    path, concept = PRIORITY.get(area, PRIORITY["ops"])
    sev = finding["severity"]
    sha = os.environ.get("GITHUB_SHA", "local")
    evidence = (finding.get("evidence") or finding["actual"])[:3500]
    return f"""### Issue Type
{finding.get("issue_type", "observational")}

### Lifecycle Status
open

### Filer Origin (who initiated this filing)
agent-initiated

### Filing Authorization Evidence
claimed

### Session, Authorization Evidence, and Instruction Reference
- Session reference: github-actions redteam workflow
- Claimed instruction/source: Alex directed red-team of Precedent and OIO issue logging
- Authorization evidence: claimed (workflow GITHUB_TOKEN)

### Content Author Account or Runtime Identity
agent:github-actions/redteam

### Directing Human GitHub Account ID
137629468

### Destination Repository
{REPO}

### Ontology Versions Used
{ONTOLOGY}

### Project Priority Path
{path}

### Project Priority Concept ID
{concept}

### Affected App, Adopter, Users, or Systems
{finding["affected"]}

### Observed Consequence and Workaround
Observed: {finding["actual"]}
Expected: {finding["expected"]}
Workaround: {finding.get("workaround", "none documented")}

### Evidence Confidence
{finding.get("confidence", "confirmed")}

### Impact if Unresolved
{sev}

### Likelihood
{finding.get("likelihood", "observed")}

### Exposure
{finding.get("exposure", "active-production")}

### Exposure Duration
{finding.get("duration", "unknown")}

### Recoverability
{finding.get("recoverability", "manual-recovery")}

### Recovery Evidence
{finding.get("recovery", "unknown — needs a code fix and redeploy")}

### Risk if the Observation Remains Unresolved
{finding.get("unresolved_risk", finding["actual"])}

### Risk Introduced by a Proposed Change
{finding.get("change_risk", "not assessed")}

### Product or Release Relevance
{finding.get("release_relation", "affects")}

### Named Product Outcome and Cost of Delay
{finding.get("product_outcome", "Reliable, safe Precedent demo for the hackathon audience")}

### Cost of Delay
{finding.get("delay_cost", "continued exposure on the public demo until fixed")}

### Smallest Useful Product Slice
{finding.get("slice", finding.get("acceptance", "see acceptance criteria"))}

### Provenance and Context
- Destination repository: {REPO}
- Source revision/environment: {sha} / redteam CI
- Ontology versions: OIO 1.1.0 / project 1.0.0
- Test: `{finding["test"]}`

### Reproducibility Steps and Evidence
{finding["repro"]}

Observed result:
```
{evidence}
```

### Issue Relations
{finding.get("relations", "none")}

### Citations and References
{finding.get("citations", "- tests/redteam/")}

### Non-Binding Proposed Next Actions
*(proposal)*
- {finding.get("acceptance", "Keep the red-team regression red until the fix lands; then confirm green.")}
- Do not treat this log as broader implementation authorization beyond the red-team task already given.
"""


def fingerprint(title: str) -> str:
    return re.sub(r"\W+", "-", title.lower()).strip("-")[:120]


def list_open_redteam():
    _, issues = api("GET", "/issues?state=open&labels=red-team&per_page=100")
    return issues if isinstance(issues, list) else []


def upsert(finding: dict):
    title = f"{TITLE_PREFIX} {finding['title']}"
    fp = fingerprint(title)
    labels = sorted(
        {
            "observational-issue",
            "proposal",
            "red-team",
            f"area:{finding['area']}",
            f"severity:{finding['severity']}",
            *finding.get("extra_labels", []),
        }
    )
    ensure_labels(labels)
    body = oio_body(finding)
    for issue in list_open_redteam():
        if fingerprint(issue.get("title") or "") == fp:
            api("PATCH", f"/issues/{issue['number']}", {"body": body, "labels": labels})
            print(f"updated #{issue['number']}: {title}")
            return issue["number"]
    code, created = api("POST", "/issues", {"title": title, "body": body, "labels": labels})
    if code >= 300 or not isinstance(created, dict):
        print(f"FAIL create {title}: {code} {created}", file=sys.stderr)
        return None
    print(f"created #{created['number']}: {title}")
    return created["number"]


def parse_pytest_report(path: Path) -> list[dict]:
    data = json.loads(path.read_text())
    catalog = json.loads((Path(__file__).resolve().parents[2] / "tests" / "redteam" / "findings_catalog.json").read_text())
    out = []
    for t in data.get("tests", []):
        if t.get("outcome") != "failed":
            continue
        node = t.get("nodeid", "")
        key = node.split("::")[-1]
        meta = dict(
            catalog.get(key)
            or {
                "title": key.replace("_", " "),
                "area": "ops",
                "severity": "moderate",
                "affected": "Precedent demo (arize.design-bakery.com)",
                "expected": "test passes",
                "actual": "failed",
                "repro": f"1. `REDTEAM=1 pytest -q tests/redteam -k {key}`",
                "extra_labels": [],
            }
        )
        meta["test"] = node
        meta["evidence"] = (t.get("call") or {}).get("longrepr", "")[:3500]
        if not meta.get("actual") or meta["actual"] == "failed":
            meta["actual"] = meta["evidence"][:500] or "failed"
        out.append(meta)
    return out


def main() -> int:
    report = Path(sys.argv[1] if len(sys.argv) > 1 else "redteam-report.json")
    if not report.is_file():
        print("no report", file=sys.stderr)
        return 1
    findings = parse_pytest_report(report)
    nums = [n for n in (upsert(f) for f in findings) if n]
    tracking_title = f"{TITLE_PREFIX} tracking — automated red-team findings"
    links = "\n".join(f"- #{n}" for n in nums) or "- (no new failures this run)"
    tracking = {
        "title": "tracking — automated red-team findings",
        "area": "ops",
        "severity": "informational",
        "issue_type": "operational",
        "affected": "Precedent maintainers / ACS board",
        "expected": "A single tracking issue links every open red-team OIO log from this run",
        "actual": f"Red-team pytest finished at {datetime.now(timezone.utc).isoformat()} with {len(nums)} failing checks filed/updated",
        "repro": "Workflow `.github/workflows/redteam.yml` on pull_request and schedule",
        "test": "tests/redteam/",
        "relations": links,
        "acceptance": "Prioritize severity:critical and severity:high; keep tracker links current.",
        "extra_labels": ["fallback", "robustness"],
        "confidence": "confirmed",
        "likelihood": "observed",
        "exposure": "limited-test-or-preview",
    }
    body = oio_body(tracking)
    labels = ["observational-issue", "proposal", "red-team", "area:ops", "severity:informational", "fallback", "robustness"]
    ensure_labels(labels)
    for issue in list_open_redteam():
        if issue.get("title") == tracking_title:
            api("PATCH", f"/issues/{issue['number']}", {"body": body, "labels": labels})
            print(f"tracking updated #{issue['number']}")
            return 0
    code, created = api("POST", "/issues", {"title": tracking_title, "body": body, "labels": labels})
    print(f"tracking created #{created.get('number') if isinstance(created, dict) else code}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
