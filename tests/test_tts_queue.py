"""Server-side TTS queue + tour prefetch + two-layer cache (local disk/SQLite, shared Octo Postgres)."""

import base64, collections, pathlib, sys, threading, time, uuid

import httpx
import pytest

sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))
from tests.test_tts_chain import FISH_URL, Resp, make_client


@pytest.fixture
def env(monkeypatch, tmp_path):
    return make_client(monkeypatch, tmp_path)


def counting_fish(monkeypatch, delay=0.0, status=200):
    """Fish answers every text (optionally slowly); records call order. Kokoro must not be needed."""
    calls = []
    lock = threading.Lock()

    def fake_post(url, **kw):
        if url != FISH_URL:
            raise AssertionError("unexpected provider call: " + url)
        with lock:
            calls.append(kw["json"]["text"])
        if delay:
            time.sleep(delay)
        return Resp(status, b"ID3mp3:" + kw["json"]["text"].encode())

    monkeypatch.setattr(httpx, "post", fake_post)
    return calls


def tour(n=5):
    rid = "run-" + uuid.uuid4().hex[:8]
    steps = [
        {
            "step_index": i,
            "text": f"Stop {i} of {rid}: the court held X.",
            "cite_ids": [f"case-{i}"],
            "refs": [f"[{i + 1}]"],
            "node_ids": [f"c:county{i}"],
            "coords": [39.7 + i / 10, -105.0],
        }
        for i in range(n)
    ]
    return rid, steps


def drain(timeout=10):
    from app import ttschain

    assert ttschain.wait_idle(timeout), "queue did not drain"


def test_tour_run_and_replay_hit_fish_once_per_line(env, monkeypatch):
    calls = counting_fish(monkeypatch)
    rid, steps = tour(5)
    r = env.post("/api/tour/prefetch", json={"run_id": rid, "steps": steps})
    assert r.status_code == 200, r.text
    drain()
    for _ in range(2):  # the tour, then a replay of it
        for s in steps:
            j = env.post("/api/tts_ts", json={"text": s["text"]}).json()
            assert base64.b64decode(j["audio_b64"]) == b"ID3mp3:" + s["text"].encode()
    env.post("/api/tour/prefetch", json={"run_id": rid, "steps": steps})  # re-prefetch on replay: all cached
    drain()
    assert collections.Counter(calls) == collections.Counter(s["text"] for s in steps)  # exactly once each
    assert calls == [s["text"] for s in steps]  # generated in playback order


def test_inflight_dedupe_no_parallel_fish(env, monkeypatch):
    calls = counting_fish(monkeypatch, delay=0.3)
    rid, steps = tour(3)
    env.post("/api/tour/prefetch", json={"run_id": rid, "steps": steps})
    out = []
    ths = [threading.Thread(target=lambda: out.append(env.post("/api/tts_ts", json={"text": steps[0]["text"]}).status_code)) for _ in range(4)]
    [t.start() for t in ths]
    [t.join() for t in ths]
    drain()
    assert out == [200] * 4
    assert calls.count(steps[0]["text"]) == 1 and len(calls) == 3


def test_fast_start_then_batch_order(env, monkeypatch):
    from app import ttschain

    calls = counting_fish(monkeypatch, delay=0.05)
    rid, steps = tour(6)
    j = env.post("/api/tour/prefetch", json={"run_id": rid, "steps": steps}).json()
    assert [s["phase"] for s in j["steps"]] == ["fast", "fast", "batch", "batch", "batch", "batch"]
    drain()
    assert calls[:2] == [steps[0]["text"], steps[1]["text"]]
    assert calls == [s["text"] for s in steps]
    assert ttschain.FAST_START == 2


def test_interactive_request_jumps_batch(env, monkeypatch):
    calls = counting_fish(monkeypatch, delay=0.1)
    rid, steps = tour(6)
    env.post("/api/tour/prefetch", json={"run_id": rid, "steps": steps})
    other = "Unrelated line " + uuid.uuid4().hex
    assert env.post("/api/tts_ts", json={"text": other}).status_code == 200
    drain()
    assert calls.index(other) <= 2  # served right after the in-flight clip, not after the whole batch


def test_tour_metadata_exposed(env, monkeypatch):
    counting_fish(monkeypatch)
    rid, steps = tour(3)
    env.post("/api/tour/prefetch", json={"run_id": rid, "steps": steps})
    drain()
    t = env.get("/api/tour/" + rid).json()
    assert t["run_id"] == rid and len(t["steps"]) == 3
    for s, got in zip(steps, t["steps"]):
        assert got["step_index"] == s["step_index"] and got["text"] == s["text"]
        assert got["cite_ids"] == s["cite_ids"] and got["node_ids"] == s["node_ids"] and got["coords"] == s["coords"]
        assert got["ready"] is True and got["provider"] == "fish" and len(got["clip_key"]) == 64
        assert "duration_s" in got


def test_clip_key_is_sha256_text_voice_provider():
    import hashlib
    from app import ttschain

    assert ttschain.clip_key("hi", "v1", "fish") == hashlib.sha256("fish|v1|hi".encode()).hexdigest()
    assert ttschain.clip_key("hi", "v1", "fish") != ttschain.clip_key("hi", "v2", "fish") != ttschain.clip_key("hi", "v1", "kokoro")


def test_octo_shared_layer(env, monkeypatch, tmp_path):
    """Clip made by one box lands in Octo; a box with an empty local cache serves it from Octo with zero provider calls."""
    from app import octocache
    from schema.store import SqliteStore
    from schema import migrate

    octo = SqliteStore(":memory:")
    migrate.apply(octo)  # stands in for the Octo Postgres workspace
    monkeypatch.setattr(octocache, "octo_store", lambda: octo)
    calls = counting_fish(monkeypatch)
    t = "Shared line " + uuid.uuid4().hex
    assert env.post("/api/tts_ts", json={"text": t}).json()["provider"] == "fish"
    octocache.flush()
    assert octo.query("SELECT count(*) AS n FROM tts_clip")[0]["n"] == 1
    monkeypatch.setenv("TTS_CACHE_DIR", str(tmp_path / "fresh_box"))  # new box, cold local cache
    calls.clear()
    j = env.post("/api/tts_ts", json={"text": t}).json()
    assert j["cache"] == "hit" and base64.b64decode(j["audio_b64"]) == b"ID3mp3:" + t.encode()
    assert calls == []


def test_octo_down_still_works(env, monkeypatch):
    from app import octocache

    class Down:
        def query(self, *a, **k):
            raise RuntimeError("octo unreachable")

        execute = query

    monkeypatch.setattr(octocache, "octo_store", lambda: Down())
    counting_fish(monkeypatch)
    assert env.post("/api/tts_ts", json={"text": "Octo down " + uuid.uuid4().hex}).status_code == 200
