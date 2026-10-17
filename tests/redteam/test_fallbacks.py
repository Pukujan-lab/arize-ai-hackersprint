"""Robustness / fallback-chain red-team. Prefer local env flags; never touch the live site."""

from __future__ import annotations

import builtins
import pathlib


ROOT = pathlib.Path(__file__).resolve().parents[2]


def test_stack_survives_missing_proc(client, monkeypatch):
    """Dashboard /api/stack must not 500 when /proc is absent (macOS Pro host)."""
    real_open = builtins.open

    def fake_open(path, *a, **k):
        if str(path) in ("/proc/meminfo", "/proc/uptime"):
            raise FileNotFoundError(path)
        return real_open(path, *a, **k)

    monkeypatch.setattr(builtins, "open", fake_open)
    r = client.get("/api/stack")
    assert r.status_code == 200, f"/api/stack crashed without /proc: {r.status_code} {r.text[:200]}"
    body = r.json()
    assert "daytona" in body or "limits" in body


def test_graph_unavailable_tells_the_user(client):
    r = client.post(
        "/api/ask",
        json={"question": "Is a verbal lease enforceable in Colorado?"},
        headers={"X-Session-Id": "redteam-fallback-sess-1"},
    )
    assert r.status_code == 200
    rid = r.json()["run_id"]
    # poll
    import time

    result = None
    for _ in range(40):
        d = client.get(f"/api/run/{rid}").json()
        if d.get("result"):
            result = d["result"]
            break
        time.sleep(0.05)
    assert result, "run never finished"
    assert "graph" in (result.get("answer") or "").lower() or result.get("provider", "").startswith("template:graph"), (
        f"no clear graph-unavailable message: {result.get('provider')} {(result.get('answer') or '')[:160]}"
    )


def test_tts_all_down_returns_browser_fallback(client):
    r = client.post("/api/tts", json={"text": "fallback check hello"})
    assert r.status_code in (429, 503)
    body = r.json()
    assert body.get("fallback") == "browser" or body.get("provider") == "browser"
    assert "tried" in body or "error" in body


def test_health_does_not_advertise_down_tts_providers(client):
    h = client.get("/api/health").json()
    # If kokoro is false, it should not be listed as an active chain entry without qualification
    if h.get("kokoro") is False:
        assert "kokoro" not in (h.get("tts") or []) or h.get("tts") == ["browser"], f"health lists kokoro while kokoro=false: {h.get('tts')}"


def test_theme_css_exists():
    css = ROOT / "static" / "theme" / "precedent-theme.css"
    assert css.is_file(), "static/theme/precedent-theme.css missing (404 on every page)"


def test_out_of_state_courts_not_silently_denver():
    js = (ROOT / "static" / "map3d.js").read_text()
    # The final return of locate() must not hard-code Denver as a silent default.
    start = js.find("function locate")
    body = js[start : start + 1200]
    assert 'return {key:"denver",ll:DENVER,label:"Colorado courts (Denver)"' not in body, (
        "locate() silently pins unknown courts to Denver without an uncertainty path"
    )


def test_home_or_health_exposes_surreal_degraded_signal():
    """When Surreal is down, clients need a machine-readable degraded flag (not only sponsor)."""
    # Contract: /api/health should carry surreal/backend degraded info beyond backend name.
    from fastapi.testclient import TestClient
    from app.server import app

    with TestClient(app) as c:
        h = c.get("/api/health").json()
    assert "graph_degraded" in h or "surreal_ok" in h, "health lacks an explicit degraded-graph signal for Surreal-down / networkx fallback"
