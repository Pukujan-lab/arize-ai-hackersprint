"""LLM answer cache + Octo retrieval cache: local-first, shared Octo Postgres second, sync-back both ways, linked to runs."""

import json, pathlib, sys, uuid

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))
from schema import migrate  # noqa: E402
from schema.store import SqliteStore  # noqa: E402


@pytest.fixture
def octo(monkeypatch):
    from app import octocache

    store = SqliteStore(":memory:")
    migrate.apply(store)  # stands in for the Octo Postgres workspace
    monkeypatch.setattr(octocache, "octo_store", lambda: store)
    return store


@pytest.fixture
def llm_env(monkeypatch, tmp_path):
    from app import llm

    monkeypatch.setenv("LLM_MODE", "real")
    monkeypatch.setattr(llm, "CACHE", tmp_path / "box1")
    (tmp_path / "box1").mkdir()
    calls = []

    def fake_inferhub(system, prompt, mt):
        calls.append(prompt)
        return "**Short answer:** grounded answer for " + prompt

    monkeypatch.setattr(llm, "_inferhub", fake_inferhub)
    monkeypatch.setattr(llm, "_anthropic", lambda *a: None)
    return llm, calls


def test_llm_answer_shared_through_octo(octo, llm_env, monkeypatch, tmp_path):
    from app import octocache

    llm, calls = llm_env
    p = "question " + uuid.uuid4().hex
    t1, prov1 = llm.complete("sys", p, 400)
    octocache.flush()
    assert calls == [p] and not prov1.endswith("(cached)")
    assert octo.query("SELECT count(*) AS n FROM llm_answer")[0]["n"] == 1
    box2 = tmp_path / "box2"
    box2.mkdir()
    monkeypatch.setattr(llm, "CACHE", box2)  # another box: cold local cache
    t2, prov2 = llm.complete("sys", p, 400)
    assert t2 == t1 and prov2.endswith("(cached)") and calls == [p]  # served by Octo, no model call
    assert len(list(box2.glob("*.json"))) == 1  # synced back to the local layer


def test_llm_stream_uses_same_cache(octo, llm_env):
    llm, calls = llm_env
    p = "q " + uuid.uuid4().hex
    llm.complete("sys", p, 400)
    seen = []
    t, prov = llm.complete_stream("sys", p, 400, on_delta=seen.append)
    assert prov.endswith("(cached)") and seen == [t] and calls == [p]


def test_answers_linked_to_runs(octo, llm_env):
    from app import octocache

    llm, _ = llm_env
    p = "q " + uuid.uuid4().hex
    with octocache.run_context("run-A"):
        llm.complete("sys", p, 400)
    with octocache.run_context("run-B"):
        llm.complete("sys", p, 400)  # cache hit, still linked
    octocache.flush()
    rows = octo.query("SELECT run_id, kind, hit FROM run_cache_link ORDER BY run_id")
    assert [(r["run_id"], r["kind"], r["hit"]) for r in rows] == [("run-A", "answer", 0), ("run-B", "answer", 1)]
    assert octo.query("SELECT run_id FROM llm_answer")[0]["run_id"] == "run-A"


@pytest.mark.parametrize(
    "bad",
    [
        {"text": "", "provider": "inferhub/cb/deepseek-v4.1-flash"},
        {"text": "fallback memo", "provider": "template (offline)"},
        {"text": "<think>reasoning only", "provider": "inferhub/cb/deepseek-v4.1-flash"},
        {"text": "**Short answer:** None of the supplied", "provider": "inferhub/deepseek"},  # pre-PR #5 label
    ],
)
def test_stale_answers_never_served(octo, llm_env, bad):
    from app import llm as L

    assert L.stale(bad)
    llm, calls = llm_env
    p = "q " + uuid.uuid4().hex
    h = llm.cache_key("sys", p, 400)
    (llm.CACHE / f"{h}.json").write_text(json.dumps(bad))
    octo.execute("INSERT INTO llm_answer(key, text, provider, max_tokens, created_at) VALUES ($1, $2, $3, $4, $5)", [h, bad["text"], bad["provider"], 400, "x"])
    t, prov = llm.complete("sys", p, 400)
    assert calls == [p] and "grounded" in t


def test_retrieval_shared_through_octo(octo, monkeypatch, tmp_path):
    from app import octo_retriever, octocache

    live = []
    passages = [{"chunk_id": "c1", "work_id": "w1", "case_name": "A v B", "court": "colo", "date": "2001-01-01", "url": "", "score": 1.0, "text": "t"}]
    monkeypatch.setattr(octo_retriever, "_live", lambda q: live.append(q) or passages)
    monkeypatch.setattr(octo_retriever, "CACHE", tmp_path / "o1")
    (tmp_path / "o1").mkdir()
    q = "warrantless search " + uuid.uuid4().hex
    with octocache.run_context("run-R"):
        got, src = octo_retriever.search(q)
    octocache.flush()
    assert src == "octo-live" and got == passages and live == [q]
    assert octo.query("SELECT source, n, run_id FROM retrieval")[0] == {"source": "octo-live", "n": 1, "run_id": "run-R"}
    monkeypatch.setattr(octo_retriever, "CACHE", tmp_path / "o2")
    (tmp_path / "o2").mkdir()
    got2, src2 = octo_retriever.search(q)
    assert got2 == passages and src2 == "octo-live (cached)" and live == [q]
    assert len(list((tmp_path / "o2").glob("*.json"))) == 1


def test_backfill_uploads_good_and_purges_stale(octo, tmp_path):
    from schema import backfill
    from app import llm

    ldir, odir = tmp_path / "cache", tmp_path / "cache" / "octo"
    odir.mkdir(parents=True)
    (ldir / "_real_calls.json").write_text("{}")  # bookkeeping, not an answer
    (ldir / ("a" * 64 + ".json")).write_text(json.dumps({"text": "**Short answer:** ok", "provider": "inferhub/cb/deepseek-v4.1-flash"}))
    (ldir / ("b" * 64 + ".json")).write_text(json.dumps({"text": "x", "provider": "inferhub/deepseek"}))
    (odir / ("c" * 24 + ".json")).write_text(json.dumps({"passages": [{"work_id": "w"}], "source": "octo-live"}))
    (odir / ("d" * 24 + ".json")).write_text(json.dumps({"passages": [], "source": "octo-live"}))
    octo.execute("INSERT INTO llm_answer(key, text, provider, created_at) VALUES ($1, $2, $3, $4)", ["e" * 64, "", "template (offline)", "x"])
    out = backfill.run(octo, ldir, odir)
    assert out == {"answers": 1, "retrievals": 1, "purged_local": 2, "purged_octo": 1}
    assert {r["key"] for r in octo.query("SELECT key FROM llm_answer")} == {"a" * 64}
    assert sorted(p.name for p in (ldir / "_purged").iterdir()) == ["b" * 64 + ".json", "d" * 24 + ".json"]
    assert backfill.run(octo, ldir, odir) == {"answers": 0, "retrievals": 0, "purged_local": 0, "purged_octo": 0}  # idempotent
    assert llm.stale({"text": "**Short answer:** ok", "provider": "inferhub/cb/deepseek-v4.1-flash"}) is False


def test_octo_down_answers_still_cached_locally(monkeypatch, llm_env):
    from app import octocache

    class Down:
        def query(self, *a, **k):
            raise RuntimeError("octo unreachable")

        execute = query

    monkeypatch.setattr(octocache, "octo_store", lambda: Down())
    llm, calls = llm_env
    p = "q " + uuid.uuid4().hex
    llm.complete("sys", p, 400)
    t, prov = llm.complete("sys", p, 400)
    assert prov.endswith("(cached)") and calls == [p]
