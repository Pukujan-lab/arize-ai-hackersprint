"""Local FastAPI client for red-team checks. No live site, no secrets, no flood."""

from __future__ import annotations

import os
import pathlib
import sys

import pytest

# Ensure repo root on path when running as tests/redteam/
ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

os.environ.setdefault("LLM_MODE", "fake")
os.environ.setdefault("ACS_HOTLOAD", "0")
os.environ.setdefault("FISH_API_KEY", "")
os.environ.setdefault("ELEVENLABS_API_KEY", "")
os.environ.setdefault("ANTHROPIC_API_KEY", "")
os.environ.setdefault("INFERHUB_API_KEY", "")
os.environ.setdefault("OCTO_API_KEY", "")
os.environ.setdefault("KOKORO_URL", "http://127.0.0.1:1")


@pytest.fixture()
def client(tmp_path, monkeypatch):
    """Isolated app client; graph data missing so asks take the graph-unavailable path."""
    monkeypatch.setenv("LLM_MODE", "fake")
    monkeypatch.setenv("ACS_HOTLOAD", "0")
    monkeypatch.setenv("GRAPH_DATA_DIR", str(tmp_path / "data"))
    (tmp_path / "data").mkdir()
    monkeypatch.setenv("TTS_CACHE_DIR", str(tmp_path / "tts"))
    monkeypatch.setenv("ACS_ROOT", str(tmp_path / "acsroot"))
    (tmp_path / "acsroot" / ".coord" / "hackathon").mkdir(parents=True)
    # Import after env is set
    from fastapi.testclient import TestClient
    from app.server import app

    with TestClient(app) as c:
        yield c
