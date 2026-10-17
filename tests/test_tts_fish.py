import base64, hashlib, os, pathlib, sys, uuid

sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))

FISH_URL = "https://api.fish.audio/v1/tts"
MP3 = b"ID3" + b"\x03\x00" + b"fake-mp3-bytes-for-fish"


def _cache_paths(text, voice):
    root = pathlib.Path(__file__).parent.parent / "cache" / "tts"
    hashes = {
        hashlib.sha256(text.encode()).hexdigest()[:24],
        hashlib.sha256((text + "|" + voice).encode()).hexdigest()[:24],
    }
    paths = []
    for h in hashes:
        paths.append(root / (h + ".mp3"))
        paths.append(root / (h + ".align.json"))
    return paths


def test_tts_returns_fish_audio(monkeypatch, tmp_path):
    monkeypatch.setenv("TTS_CACHE_DIR", str(tmp_path / "tts_cache"))
    monkeypatch.delenv("TTS_DISABLE_FISH", raising=False)
    monkeypatch.delenv("OCTO_API_KEY", raising=False)
    voice = "voice-model-1"
    os.environ["FISH_API_KEY"] = "test-fish-key"
    os.environ["FISH_VOICE_ID"] = voice
    os.environ["ELEVENLABS_API_KEY"] = "test-eleven-key"
    os.environ["ELEVENLABS_VOICE_ID"] = "21m00Tcm4TlvDq8ikWAM"
    text = "fish audio check " + uuid.uuid4().hex
    calls = {}

    class Resp:
        status_code = 200
        content = MP3
        text = ""

        def json(self):
            return {}

    def fake_post(url, **kwargs):
        calls["url"] = url
        calls["headers"] = kwargs.get("headers") or {}
        calls["json"] = kwargs.get("json") or {}
        return Resp()

    import httpx

    monkeypatch.setattr(httpx, "post", fake_post)
    from app import limits

    monkeypatch.setattr(limits, "take", lambda api: True)

    from app import server
    from fastapi.testclient import TestClient

    client = TestClient(server.app)
    try:
        response = client.post("/api/tts", json={"text": text})
        assert response.status_code == 200, response.text
        assert response.headers["content-type"].startswith("audio/mpeg")
        assert response.content == MP3
        assert calls["url"] == FISH_URL
        assert calls["json"]["text"] == text
        assert calls["json"]["reference_id"] == voice
        assert calls["json"]["format"] == "mp3"
        assert calls["headers"]["Authorization"] == "Bearer test-fish-key"
        assert calls["headers"]["model"] == "s2.1-pro-free"
        assert "xi-api-key" not in {k.lower() for k in calls["headers"]}
        health = client.get("/api/health").json()
        assert health["tts"][0] == "fish"
        text2 = text + " aligned"
        timed = client.post("/api/tts_ts", json={"text": text2})
        assert timed.status_code == 200, timed.text
        body = timed.json()
        assert base64.b64decode(body["audio_b64"]) == MP3
        assert calls["url"] == FISH_URL
        assert calls["json"]["reference_id"] == voice
        assert calls["json"]["format"] == "mp3"
        assert calls["json"]["text"] == text2
    finally:
        for spoken in (text, text + " aligned"):
            for path in _cache_paths(spoken, voice):
                if path.exists():
                    path.unlink()
