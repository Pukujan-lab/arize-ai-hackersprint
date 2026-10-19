"""TTS provider chain: Fish Audio -> Kokoro (local HTTP) -> browser speechSynthesis, with a disk cache by text hash."""

import base64, importlib, pathlib, sys, uuid

import httpx
import pytest

sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))

FISH_URL = "https://api.fish.audio/v1/tts"
KOKORO_URL = "http://127.0.0.1:8880"
FISH_MP3 = b"ID3\x03\x00fish-bytes"
KOKORO_MP3 = b"ID3\x03\x00kokoro-bytes"


class Resp:
    def __init__(self, status_code=200, content=b"", headers=None):
        self.status_code = status_code
        self.content = content
        self.headers = headers or {}
        self.text = content.decode("latin-1")

    def json(self):
        return {}


@pytest.fixture
def env(monkeypatch, tmp_path):
    return make_client(monkeypatch, tmp_path)


def make_client(monkeypatch, tmp_path):
    monkeypatch.setenv("TTS_CACHE_DIR", str(tmp_path / "tts_cache"))
    monkeypatch.setenv("FISH_API_KEY", "test-fish-key")
    monkeypatch.setenv("FISH_VOICE_ID", "voice-model-1")
    monkeypatch.setenv("KOKORO_URL", KOKORO_URL)
    monkeypatch.delenv("ELEVENLABS_API_KEY", raising=False)
    monkeypatch.delenv("TTS_DISABLE_FISH", raising=False)
    monkeypatch.delenv("OCTO_API_KEY", raising=False)  # shared Octo layer off unless a test injects a fake
    from app import limits

    monkeypatch.setattr(limits, "take", lambda api: True)
    from app import server
    from fastapi.testclient import TestClient

    return TestClient(server.app)


def route(monkeypatch, fish, kokoro):
    """fish/kokoro: a Resp, an Exception instance to raise, or None (must not be called)."""
    calls = []

    def fake_post(url, **kw):
        calls.append((url, kw))
        which = fish if url == FISH_URL else kokoro if url.startswith(KOKORO_URL) else None
        if which is None:
            raise AssertionError("unexpected provider call: " + url)
        if isinstance(which, Exception):
            raise which
        return which

    monkeypatch.setattr(httpx, "post", fake_post)
    return calls


def text():
    return "Tour stop " + uuid.uuid4().hex + " explains the holding."


@pytest.mark.parametrize("fish", [Resp(401), Resp(402), Resp(429), Resp(500), httpx.ReadTimeout("slow")])
def test_fish_fails_kokoro_serves(env, monkeypatch, fish):
    calls = route(monkeypatch, fish, Resp(200, KOKORO_MP3, {"X-Audio-Duration": "2.000"}))
    t = text()
    r = env.post("/api/tts_ts", json={"text": t})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["provider"] == "kokoro"
    assert base64.b64decode(body["audio_b64"]) == KOKORO_MP3
    # even approximate timings so captions keep pace
    assert len(body["chars"]) == len(body["starts"]) == len(t)
    assert body["starts"] == sorted(body["starts"]) and body["starts"][0] == 0 and body["starts"][-1] < 2.0
    assert [u for u, _ in calls] == [FISH_URL, KOKORO_URL + "/v1/audio/speech"]
    fish_kw, kok_kw = calls[0][1], calls[1][1]
    assert fish_kw["timeout"] <= 8.5 and kok_kw["timeout"] <= 10.5
    assert kok_kw["json"]["input"] == t and kok_kw["json"]["response_format"] == "mp3"


def test_raw_tts_endpoint_names_provider(env, monkeypatch):
    route(monkeypatch, Resp(402), Resp(200, KOKORO_MP3, {"X-Audio-Duration": "1.0"}))
    r = env.post("/api/tts", json={"text": text()})
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("audio/mpeg")
    assert r.headers["X-TTS-Provider"] == "kokoro"
    assert r.content == KOKORO_MP3


def test_fish_cap_reached_skips_fish(env, monkeypatch):
    from app import limits

    monkeypatch.setattr(limits, "take", lambda api: api != "fish_tts")
    calls = route(monkeypatch, None, Resp(200, KOKORO_MP3, {"X-Audio-Duration": "1.0"}))
    r = env.post("/api/tts_ts", json={"text": text()})
    assert r.status_code == 200 and r.json()["provider"] == "kokoro"
    assert all(u != FISH_URL for u, _ in calls)


def test_disable_fish_env(env, monkeypatch):
    monkeypatch.setenv("TTS_DISABLE_FISH", "1")
    route(monkeypatch, None, Resp(200, KOKORO_MP3, {"X-Audio-Duration": "1.0"}))
    r = env.post("/api/tts_ts", json={"text": text()})
    assert r.status_code == 200 and r.json()["provider"] == "kokoro"


@pytest.mark.parametrize("path", ["/api/tts_ts", "/api/tts"])
def test_both_fail_browser_fallback(env, monkeypatch, path):
    route(monkeypatch, Resp(402), httpx.ConnectError("kokoro down"))
    r = env.post(path, json={"text": text()})
    assert r.status_code == 429
    j = r.json()
    assert j["fallback"] == "browser" and j["provider"] == "browser"
    assert r.headers["X-TTS-Provider"] == "browser"


def test_cache_hit_makes_no_provider_calls(env, monkeypatch):
    route(monkeypatch, Resp(200, FISH_MP3), None)
    t = text()
    first = env.post("/api/tts_ts", json={"text": t}).json()
    assert first["provider"] == "fish"
    calls = route(monkeypatch, None, None)  # any provider call now raises
    from app import limits

    def no_take(api):
        raise AssertionError("cache hit must not count against caps")

    monkeypatch.setattr(limits, "take", no_take)
    again = env.post("/api/tts_ts", json={"text": t})
    assert again.status_code == 200
    assert base64.b64decode(again.json()["audio_b64"]) == FISH_MP3
    assert again.json()["cache"] == "hit" and again.json()["provider"] == "fish"
    raw = env.post("/api/tts", json={"text": t})
    assert raw.status_code == 200 and raw.content == FISH_MP3 and raw.headers["X-TTS-Cache"] == "hit"
    assert calls == []


def test_caps_read_from_env(monkeypatch):
    from app import limits

    monkeypatch.setenv("FISH_TTS_PER_HOUR", "7")
    monkeypatch.setenv("KOKORO_TTS_PER_HOUR", "11")
    try:
        importlib.reload(limits)
        assert limits.CAPS["fish_tts"] == 7
        assert limits.CAPS["kokoro_tts"] == 11
        monkeypatch.delenv("FISH_TTS_PER_HOUR")
        monkeypatch.delenv("KOKORO_TTS_PER_HOUR")
        importlib.reload(limits)
        assert limits.CAPS["fish_tts"] == 200
        assert limits.CAPS["kokoro_tts"] == 1000
    finally:
        importlib.reload(limits)


def test_health_lists_chain(env, monkeypatch):
    from app import ttschain

    monkeypatch.setattr(ttschain, "kokoro_up", lambda: True)
    h = env.get("/api/health").json()
    assert h["tts"] == ["fish", "kokoro", "browser"]
    assert h["kokoro"] is True and h["fish"] is True
    monkeypatch.setattr(ttschain, "kokoro_up", lambda: False)
    monkeypatch.setenv("TTS_DISABLE_FISH", "1")
    h = env.get("/api/health").json()
    assert h["tts"] == ["browser"] and h["kokoro"] is False and h["fish"] is False  # kokoro down is not listed (#32)


def test_fish_timeout_default_is_5s(env, monkeypatch):
    """Fish must time out early enough for Kokoro to answer before the tour gives up on the line."""
    monkeypatch.delenv("FISH_TIMEOUT_S", raising=False)
    calls = route(monkeypatch, httpx.ReadTimeout("slow"), Resp(200, KOKORO_MP3, {"X-Audio-Duration": "1.0"}))
    env.post("/api/tts_ts", json={"text": text()})
    assert calls[0][1]["timeout"] == 5.0
