"""O52: the served page reports the commit it was built from, and a health check that sees a different
commit fails instead of accepting a stale build."""

import os
import pathlib
import re
import shutil
import subprocess
import urllib.request

import pytest

from ui_server import app_server, needs_v3

pytestmark = needs_v3

SCRIPT = pathlib.Path(__file__).resolve().parent.parent / "deploy" / "health.sh"


@pytest.fixture(scope="module")
def app():
    with app_server() as url:
        yield url


def _build_id(base):
    with urllib.request.urlopen(base + "/", timeout=15) as r:
        html = r.read().decode("utf-8", "replace")
    m = re.search(r'<meta[^>]+name=["\']build-id["\'][^>]+content=["\']([^"\']+)["\']', html, re.I)
    return m.group(1) if m else None


def _health(expected, base):
    bash = shutil.which("bash")
    assert bash, "bash is required to run the deploy health check"
    return subprocess.run(
        [bash, str(SCRIPT), expected, base],
        capture_output=True,
        text=True,
        timeout=120,
        env={**os.environ, "HEALTH_TRIES": "1"},
    )


def test_O52_the_page_reports_the_commit_it_was_built_from(app):
    build = _build_id(app)
    assert build, "the page carries no build-id; a deploy cannot be tied to a commit"
    assert re.fullmatch(r"[0-9a-f]{7,40}", build), f"build-id {build!r} is not a commit"


def test_the_deploy_builds_from_a_frozen_lockfile():
    web = pathlib.Path(__file__).resolve().parent.parent / "web"
    if not (web / "package.json").exists():
        pytest.skip("the frontend build root is not in place yet")
    assert (web / "pnpm-lock.yaml").exists(), "web/ has no lockfile; CI and the deploy host can build differently"
    deploy = (web.parent / "deploy" / "deploy.sh").read_text(encoding="utf-8")
    assert "pnpm install --frozen-lockfile" in deploy, "the deploy host does not install from the frozen lockfile"


def test_O52_a_health_check_that_sees_the_wrong_commit_fails(app):
    assert SCRIPT.exists(), "deploy/health.sh is missing"
    good = _health(_build_id(app), app)
    assert good.returncode == 0, f"the health check rejected the deployed build:\n{good.stdout}\n{good.stderr}"
    bad = _health("0" * 40, app)
    assert bad.returncode != 0, "a page built from another commit passed the health check"
