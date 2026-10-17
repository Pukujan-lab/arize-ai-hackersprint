"""/api/health lists in tts only the voice providers that can actually be reached (#32): Kokoro is left out of the
list when its local service is down, and the kokoro flag agrees with the list."""

import os
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
os.environ.setdefault("LLM_MODE", "fake")
os.environ["ACS_HOTLOAD"] = "0"

from fastapi.testclient import TestClient  # noqa: E402


def test_kokoro_down_is_not_listed(monkeypatch):
    from app import ttschain
    from app.server import app

    monkeypatch.setattr(ttschain, "kokoro_up", lambda: False)
    h = TestClient(app).get("/api/health").json()
    assert h["kokoro"] is False
    assert "kokoro" not in h["tts"]
    assert h["tts"][-1] == "browser"


def test_kokoro_up_is_listed(monkeypatch):
    from app import ttschain
    from app.server import app

    monkeypatch.delenv("TTS_DISABLE_KOKORO", raising=False)
    monkeypatch.setattr(ttschain, "kokoro_up", lambda: True)
    h = TestClient(app).get("/api/health").json()
    assert h["kokoro"] is True and "kokoro" in h["tts"]
