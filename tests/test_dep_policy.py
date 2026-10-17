"""Dependency rules from AGENTS.md: pinned lock, license allowlist, release within 12 months for new direct deps.
All offline: PyPI answers and pip-licenses rows come from tests/fixtures/dep_policy_cases.json."""

import datetime
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
import dep_policy  # noqa: E402

FX = json.loads((ROOT / "tests" / "fixtures" / "dep_policy_cases.json").read_text())
TODAY = datetime.date.fromisoformat(FX["today"])
PY39 = {"python_version": "3.9", "python_full_version": "3.9.6"}
PY311 = {"python_version": "3.11", "python_full_version": "3.11.9"}


def test_pins_follow_the_python_markers():
    assert dep_policy.pins(FX["lock"], PY39) == {"fastapi": "0.128.8", "httpx": "0.28.1", "numpy": "2.0.2"}
    assert dep_policy.pins(FX["lock"], PY311) == {"fastapi": "0.143.3", "httpx": "0.28.1", "numpy": "2.4.6"}


def test_new_direct_dependencies_against_the_base():
    base = "fastapi\nhttpx  # http client\n"
    head = "fastapi\nhttpx\nFresh_Pkg[extra]>=1\n-r other.txt\n"
    assert dep_policy.direct(head) - dep_policy.direct(base) == {"fresh-pkg"}


def _fetch(name):
    return FX["pypi"].get(name)


def test_release_age():
    assert dep_policy.maturity(["freshpkg"], _fetch, TODAY) == []
    problems = dep_policy.maturity(["stalepkg", "yankedpkg", "nosuchpkg"], _fetch, TODAY)
    assert [p.split(":")[0] for p in problems] == ["stalepkg", "yankedpkg", "nosuchpkg"]


def test_license_allowlist():
    locked = {"fastapi", "httpx", "certifi", "uvloop", "copyleftpkg", "mysterypkg"}
    bad = dep_policy.license_problems(FX["licenses"], locked)
    assert sorted(b.split(" ")[0] for b in bad) == ["copyleftpkg", "mysterypkg"]


def test_lock_pins_every_direct_dependency():
    lock = (ROOT / "requirements.txt").read_text()
    pinned = set(dep_policy.pins(lock, PY39)) & set(dep_policy.pins(lock, PY311))
    missing = dep_policy.direct((ROOT / "requirements.in").read_text()) - pinned
    assert not missing, f"run the uv pip compile command at the top of requirements.txt: {missing}"
    for line in lock.splitlines():
        if line and not line.startswith((" ", "#")):
            assert "==" in line, line


def test_pins_for_a_named_python():
    assert dep_policy.pins(FX["lock"], dep_policy.python_env("3.9")) == {"fastapi": "0.128.8", "httpx": "0.28.1", "numpy": "2.0.2"}
    assert dep_policy.pins(FX["lock"], dep_policy.python_env("3.11")) == {"fastapi": "0.143.3", "httpx": "0.28.1", "numpy": "2.4.6"}


def test_pins_cli_takes_python(capsys):
    assert dep_policy.main(["pins", "--python", "3.9"]) == 0
    out = capsys.readouterr().out
    lock = dep_policy.pins((ROOT / "requirements.txt").read_text(), dep_policy.python_env("3.9"))
    assert out.split() == [f"{n}=={v}" for n, v in sorted(lock.items())]
