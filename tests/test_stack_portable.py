"""/api/stack answers 200 on hosts without /proc (macOS), with memory and uptime filled from portable sources or
left empty, so the dashboard never gets an HTML 500 page instead of JSON (#31, #42)."""

import builtins
import os
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
os.environ.setdefault("LLM_MODE", "fake")
os.environ["ACS_HOTLOAD"] = "0"

from fastapi.testclient import TestClient  # noqa: E402


def test_stack_survives_missing_proc(monkeypatch):
    from app.server import app

    real_open = builtins.open

    def no_proc(path, *a, **k):
        if str(path).startswith("/proc/"):
            raise FileNotFoundError(path)
        return real_open(path, *a, **k)

    monkeypatch.setattr(builtins, "open", no_proc)
    (ROOT / "runs").mkdir(exist_ok=True)
    r = TestClient(app, raise_server_exceptions=False).get("/api/stack")
    assert r.status_code == 200, r.text[:200]
    host = r.json()["daytona"]
    for key in ("ram_gb", "ram_used_gb", "uptime_h"):
        assert host[key] is None or isinstance(host[key], (int, float)), key


def test_stack_reads_linux_meminfo_in_kb(monkeypatch):
    import io

    from app.server import app

    real_open = builtins.open
    meminfo = "MemTotal:       16777216 kB\nMemFree:  1000 kB\nMemAvailable:    8388608 kB\n"

    def fake_proc(path, *a, **k):
        if str(path) == "/proc/meminfo":
            return io.StringIO(meminfo)
        if str(path) == "/proc/uptime":
            return io.StringIO("7200.0 100.0\n")
        return real_open(path, *a, **k)

    monkeypatch.setattr(builtins, "open", fake_proc)
    (ROOT / "runs").mkdir(exist_ok=True)
    host = TestClient(app).get("/api/stack").json()["daytona"]
    assert host["ram_gb"] == 16
    assert host["ram_used_gb"] == 8
    assert host["uptime_h"] == 2
