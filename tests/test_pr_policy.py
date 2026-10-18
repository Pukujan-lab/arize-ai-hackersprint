"""CI rule from AGENTS.md "Reuse before you write": a PR that adds a source module or more than ~150 non-test lines under
app/, acs/ or tools/ names the OSS it considered, or is a bugfix linked to a confirmed issue. Cases live in a fixture."""

import json
import pathlib
import sys

import pytest

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
import pr_policy  # noqa: E402

CASES = json.loads((ROOT / "tests" / "fixtures" / "pr_policy_cases.json").read_text())["cases"]


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_fixture_verdicts(case):
    v = pr_policy.evaluate(case["pr"])
    assert v["ok"] is (case["expect"] == "pass"), v
    assert len(v["warnings"]) == case.get("warnings", 0), v


def _section_body(template):
    return pr_policy.oss_section((ROOT / template).read_text())


def test_default_template_does_not_pass_unedited():
    """Leaving the template's OSS line as is must not satisfy the rule."""
    assert not pr_policy.oss_ok(_section_body(".github/pull_request_template.md"))


def test_aba_template_fills_the_section():
    """ABA PRs start from this template, so its OSS section must pass as written."""
    pr = {"body": (ROOT / ".github/PULL_REQUEST_TEMPLATE/aba.md").read_text(), "labels": [], "linked_issues": []}
    pr["files"] = [{"path": "app/generated_by_aba.py", "status": "added", "additions": 80}]
    assert pr_policy.evaluate(pr)["ok"]


def test_aba_scope_allows_server_and_flags_contracts():
    """ABA may touch app code such as server.py, but never contracts."""
    body = "Built by ABA (`Pukujan/app-builder-automation`, dyad headless)"
    files = [{"path": "server.py"}, {"path": "contracts/agents/coding-agent.json"}]
    assert pr_policy.aba_scope_violations(files, body) == ["contracts/agents/coding-agent.json"]
    assert pr_policy.aba_scope_violations(files, "Human change.") == []


def test_threshold_is_about_150_lines():
    files = [{"path": "app/agents.py", "status": "modified", "additions": 150}]
    assert pr_policy.evaluate({"body": "", "labels": [], "files": files, "linked_issues": []})["ok"]
    files[0]["additions"] = 151
    assert not pr_policy.evaluate({"body": "", "labels": [], "files": files, "linked_issues": []})["ok"]
