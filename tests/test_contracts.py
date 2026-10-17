"""API contract tests: committed OpenAPI schema must match the app, and every endpoint answers per its model."""

import json
import os
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))
os.environ.setdefault("LLM_MODE", "fake")
os.environ["ACS_HOTLOAD"] = "0"
import pytest
from fastapi.testclient import TestClient

import contracts
import server

c = TestClient(server.app)


def test_openapi_schema_has_no_drift():
    committed = json.loads(contracts.SCHEMA_PATH.read_text())
    assert server.app.openapi() == committed, "API changed: run `python contracts.py --write` and commit contracts/openapi.json"


def test_every_api_route_has_a_contract():
    for path, ops in server.app.openapi()["paths"].items():
        for method, op in ops.items():
            if path.startswith("/api/"):
                ok = op["responses"]["200"].get("content", {})
                assert ok and any(v.get("schema") or k == "audio/mpeg" for k, v in ok.items()), f"{method} {path}"
                if method == "post" and path not in ("/api/acs/reload", "/api/stt"):
                    assert "requestBody" in op, f"{method} {path} has no request model"


def _ok(model, data):
    model.model_validate(data)
    return data


def test_health():
    d = _ok(contracts.HealthResponse, c.get("/api/health").json())
    assert d["ok"] is True and set(d) >= {"backend", "nodes", "anthropic", "elevenlabs", "arize", "sandbox"}


def test_ask_validation_and_shapes():
    r = c.post("/api/ask", json={"question": "x"})
    assert r.status_code == 400 and r.json() == {"error": "empty question"}
    assert c.post("/api/ask", json=["not", "an", "object"]).status_code == 422


def test_run_unknown_id():
    d = _ok(contracts.RunResponse, c.get("/api/run/contract-test-none").json())
    assert d == {"events": [], "result": None, "partial": None}


def test_runs_list():
    (pathlib.Path(server.ROOT) / "runs").mkdir(exist_ok=True)
    r = c.get("/api/runs")
    assert r.status_code == 200 and isinstance(r.json(), list)
    for x in r.json():
        contracts.RunSummary.model_validate(x)


@pytest.mark.parametrize("path", ["/api/seats", "/api/tasks", "/api/limits", "/api/acs/events", "/api/acs/hotload"])
def test_simple_gets(path):
    r = c.get(path)
    assert r.status_code == 200
    assert isinstance(r.json(), (dict, list))


def test_acs_reload():
    d = _ok(contracts.HotloadStatus, c.post("/api/acs/reload").json())
    assert "changed" in d and "version" in d


def test_claim_unknown_task_and_bad_body():
    r = c.post("/api/claim", json={"task": "NO-SUCH-TASK", "agent": "contract-test"})
    contracts.TaskResponse.model_validate(r.json())
    assert c.post("/api/claim", json="nope").status_code == 422


def test_tts_without_key(monkeypatch):
    monkeypatch.delenv("ELEVENLABS_API_KEY", raising=False)
    r = c.post("/api/tts", json={"text": "contract test phrase that is not cached zq"})
    assert r.status_code in (200, 429)
    if r.status_code == 200:
        assert r.headers["content-type"] == "audio/mpeg" and r.headers["X-TTS-Provider"]
    else:
        assert r.json()["fallback"] == "browser"


def test_stt_without_key(monkeypatch):
    monkeypatch.delenv("ELEVENLABS_API_KEY", raising=False)
    r = c.post("/api/stt", files={"file": ("a.webm", b"\x00", "audio/webm")})
    assert r.status_code in (400, 413, 429, 503)
