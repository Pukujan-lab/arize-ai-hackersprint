"""O94-O100: retrieval uses meaning and the citation graph, refuses to dress unrelated authorities as an
answer, keeps what the index returns, completes statute citations, and reports tracing honestly.

The live tests start the app with the real providers. They skip when the credentials are absent, which is
the case in CI; run them on the host with the environment sourced."""

import contextlib
import json
import os
import pathlib
import socket
import subprocess
import sys
import time
import urllib.request

import pytest

ROOT = pathlib.Path(__file__).resolve().parent.parent
LIVE = bool(os.environ.get("OCTO_API_KEY") and os.environ.get("INFERHUB_API_KEY"))
needs_live = pytest.mark.skipif(not LIVE, reason="live retrieval needs the provider credentials")


def _free_port():
    with contextlib.closing(socket.socket()) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@contextlib.contextmanager
def live_server():
    port = _free_port()
    env = dict(os.environ, ACS_HOTLOAD="0")
    proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "app.server:app", "--port", str(port), "--log-level", "warning"],
        cwd=ROOT,
        env=env,
    )
    url = f"http://127.0.0.1:{port}"
    try:
        for _ in range(150):
            try:
                urllib.request.urlopen(url + "/api/health", timeout=1)
                break
            except OSError:
                time.sleep(0.2)
        yield url
    finally:
        proc.terminate()
        proc.wait(timeout=15)


def _post(base, path, body):
    req = urllib.request.Request(base + path, json.dumps(body).encode(), {"Content-Type": "application/json", "User-Agent": "legal-graph/0.1"})
    return json.load(urllib.request.urlopen(req, timeout=30))


def _ask(base, question, timeout=180):
    run_id = _post(base, "/api/ask", {"question": question})["run_id"]
    for _ in range(timeout):
        result = json.load(urllib.request.urlopen(base + "/api/run/" + run_id, timeout=30)).get("result")
        if result:
            return result
        time.sleep(1)
    raise AssertionError(f"the run {run_id} did not finish")


def _ids(result):
    return [str(citation.get("id") or "") for citation in result.get("citations", [])]


@contextlib.contextmanager
def assignment_restored():
    """The retriever writes .coord/assignment.json; a test must leave it exactly as it found it."""
    path = ROOT / ".coord" / "assignment.json"
    before = path.read_bytes() if path.exists() else None
    try:
        yield
    finally:
        if before is not None:
            path.write_bytes(before)
        elif path.exists():
            path.unlink()


@pytest.fixture(scope="module")
def live():
    if not LIVE:
        pytest.skip("live retrieval needs the provider credentials")
    with live_server() as url:
        yield url


@needs_live
@pytest.mark.parametrize(
    "question, expected",
    [
        ("Can someone keep a gun on them in Colorado without a permit?", ("trinen", "concealed carry")),
        ("What happens if a burglar breaks in and I have to defend myself?", ("janes", "phillips", "montez")),
        ("Does a mineral reservation survive when the land is sold?", ("mccormick", "hanna")),
    ],
)
def test_O94_a_paraphrase_reaches_the_governing_authority(live, question, expected):
    result = _ask(live, question)
    haystack = " ".join(_ids(result)).lower()
    assert any(word in haystack for word in expected), f"{question!r} returned {_ids(result)}"


@needs_live
def test_O95_a_question_with_no_authority_says_so(live):
    result = _ask(live, "hello how are you")
    coverage = str(result.get("coverage") or "")
    answer = str(result.get("answer") or "").lower()
    assert coverage and coverage != "on_point", f"an off-corpus question is reported as on point: {coverage!r}"
    assert any(phrase in answer for phrase in ("no authority", "not a legal question", "nothing on point", "cannot answer")), (
        f"the answer does not say it has nothing on point: {answer[:300]!r}"
    )
    assert (result.get("safeguard") or {}).get("pass") is not True, "an off-corpus question reports a passed citation check"


@needs_live
def test_O96_a_typo_and_an_everyday_word_still_find_the_authority(live):
    result = _ask(live, "am i allowed to carry gun withotu license")
    haystack = " ".join(_ids(result)).lower()
    assert any(word in haystack for word in ("trinen", "concealed carry", "18-12-105", "18-12-204")), f"the misspelled question returned {_ids(result)}"


def test_O97_a_retrieved_authority_survives_a_missing_graph_node():
    sys.path.insert(0, str(ROOT))
    from app import agents, coord, octo_retriever

    class FakeGraph:
        backend = "networkx"
        nodes = {"Known v. State": {"id": "Known v. State"}}
        indeg = {"Known v. State": 1}

        def seeds(self, question, k=10):
            return ["Known v. State"], ["question"]

        def info(self, nid):
            return {"id": nid, "title": nid, "type": "caselaw", "court": "Colorado Supreme Court", "date": "2000-01-01", "url": ""}

        def neighbors(self, nid, direction):
            return []

    passages = [
        {
            "chunk_id": "c1",
            "work_id": "Known v. State",
            "case_name": "Known v. State",
            "court": "Colorado Supreme Court",
            "date": "2000-01-01",
            "url": "",
            "score": 1.0,
            "text": "A known passage.",
        },
        {
            "chunk_id": "c2",
            "work_id": "Unmapped v. Board",
            "case_name": "Unmapped v. Board",
            "court": "Colorado Court of Appeals",
            "date": "2010-05-05",
            "url": "https://example.test/unmapped",
            "score": 0.9,
            "text": "An unmapped passage that answers the question.",
        },
    ]

    original_graph, original_search = agents.graph, octo_retriever.search
    agents.graph = lambda: FakeGraph()
    octo_retriever.search = lambda question, k=12: (passages, "octo-live")
    import shutil

    run = coord.Run("test-o97")
    try:
        with assignment_restored():
            out = agents.retriever(run, "a question")
    finally:
        agents.graph, octo_retriever.search = original_graph, original_search
        shutil.rmtree(run.dir, ignore_errors=True)

    ids = [citation["id"] for citation in out["citations"]]
    assert "Unmapped v. Board" in ids, f"a retrieved authority was dropped because the graph lacks it: {ids}"
    unmapped = next(citation for citation in out["citations"] if citation["id"] == "Unmapped v. Board")
    assert unmapped.get("court") == "Colorado Court of Appeals", f"the dropped authority lost its metadata: {unmapped}"
    assert unmapped.get("url") == "https://example.test/unmapped", f"the dropped authority lost its link: {unmapped}"


@needs_live
def test_O98_the_graph_contributes_question_relevant_authorities(live):
    result = _ask(live, "Does a severed mineral estate keep the Colorado homestead exemption?")
    ids = _ids(result)
    assert any(identifier.startswith("C.R.S. § 34-60-") for identifier in ids), f"the citation graph did not contribute the oil-and-gas sections: {ids}"
    assert not any("CFR" in identifier or "eCFR" in identifier for identifier in ids), f"generic in-degree titles outrank the question: {ids}"


@needs_live
def test_O99_a_statute_citation_is_complete(live):
    result = _ask(live, "What is the Colorado homestead exemption?")
    statutes = [c for c in result.get("citations", []) if "statute" in str(c.get("type") or "").lower()]
    assert statutes, "the run returned no statute"
    for statute in statutes:
        identifier = str(statute.get("id") or "")
        assert "§" in identifier, f"the statute has no section: {identifier!r}"
        assert statute.get("title"), f"the statute has no title: {statute}"
        assert statute.get("url"), f"the statute has no link to its text: {statute}"
    assert not any("Title" in str(c.get("id") or "") and "Article" in str(c.get("id") or "") for c in result["citations"]), (
        "an article-level placeholder is cited where a section is available"
    )


@needs_live
def test_O100_tracing_status_is_reported(live):
    health = json.load(urllib.request.urlopen(live + "/api/health", timeout=10))
    tracing = health.get("tracing")
    assert isinstance(tracing, dict) and "ok" in tracing, f"the health response does not report tracing: {health}"
    if not tracing["ok"]:
        assert tracing.get("reason"), f"tracing is failing without a reason: {tracing}"
    _ask(live, "What is the Colorado homestead exemption?")
    after = json.load(urllib.request.urlopen(live + "/api/health", timeout=10)).get("tracing") or {}
    assert after.get("ok") is True or (after.get("ok") is False and after.get("reason")), (
        f"a completed run neither reached tracing nor reported why it could not: {after}"
    )
