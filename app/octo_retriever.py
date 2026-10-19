"""Passage retrieval. Primary: the retrieval engine on this host (lexical + dense + citation graph +
reranker, over 804,646 passages), through `app.engine`. Fallback, only when the engine is not configured
or does not answer: Octo workspace SQL full-text search, then the local SQLite FTS5 snapshot. Responses
are cached by query hash: local cache/octo/<key>.json first, shared Octo `retrieval` table second.

`search()` returns (passages, source) as it always has. The stage record behind that call is available
from `last_retrieval()` for the run that asked, so a saved run can report the stages it actually took.
"""

import os, json, re, time, hashlib, sqlite3, pathlib, threading, urllib.request
from app import octocache, engine
from schema.store import loads

ROOT = pathlib.Path(__file__).resolve().parent.parent
CACHE = ROOT / "cache" / "octo"
CACHE.mkdir(parents=True, exist_ok=True)
SNAP = ROOT / "data" / "octo_snapshot.sqlite"
BASE = os.environ.get("OCTO_BASE_URL", "https://octodb.design-bakery.com/api")
WS = os.environ.get("OCTO_WORKSPACE_ID", "76d7577b-2274-42b4-a8dc-1ff1c0efa741")
_live_ok = {"t": 0, "ok": None}
LIVE_SQL = (
    "SELECT c.chunk_id, e.work_id, w.case_name, w.court_id, w.decided_on, w.ext_ids, ts_rank(c.tsv, q) AS score, left(c.body, 900) AS body "
    "FROM legal_graph.chunk c JOIN legal_graph.expression e USING (expr_id) JOIN legal_graph.work w ON w.work_id = e.work_id, "
    "websearch_to_tsquery('english', $1) q WHERE c.tsv @@ q ORDER BY score DESC LIMIT 40"
)
STOP = set(
    "a an the of to in on for and or is are was be by with what when how does do can could would should under law legal court who which my i if it that this from as at without".split()
)

# The record of the call that just happened, per thread: the pipeline runs one question per thread.
_local = threading.local()


def _terms(q):
    return [t for t in re.findall(r"[a-z0-9]+", q.lower()) if t not in STOP and len(t) > 2]


def _live(question):
    key = os.environ.get("OCTO_API_KEY") or os.environ.get("octo_db_legal")
    if not key or os.environ.get("OCTO_MODE") == "snapshot":
        return None
    if _live_ok["ok"] is False and time.time() - _live_ok["t"] < 300:
        return None
    body = {"sql": LIVE_SQL, "params": [" OR ".join(_terms(question)) or question], "rowLimit": 40}
    req = urllib.request.Request(
        f"{BASE}/workspaces/{WS}/query",
        data=json.dumps(body, ensure_ascii=True).encode(),
        headers={"Authorization": "Bearer " + key, "Content-Type": "application/json", "User-Agent": "legal-graph/0.1"},
    )
    try:
        rows = json.load(urllib.request.urlopen(req, timeout=5))["rows"]
        _live_ok.update(ok=True, t=time.time())
    except Exception:
        _live_ok.update(ok=False, t=time.time())
        return None
    out = []
    for r in rows:
        ext = r.get("ext_ids") or {}
        out.append(
            {
                "chunk_id": r["chunk_id"],
                "work_id": r["work_id"],
                "case_name": r.get("case_name") or r["work_id"],
                "court": r.get("court_id") or "",
                "date": (r.get("decided_on") or "")[:10],
                "url": ext.get("html") or "",
                "score": float(r["score"]),
                "text": r["body"],
            }
        )
    return out


def _snapshot(question):
    if not SNAP.exists():
        return None
    db = sqlite3.connect(SNAP)
    terms = _terms(question)
    if not terms:
        return []
    rows = db.execute(
        "SELECT p.chunk_id, p.work_id, w.case_name, w.court, w.date, w.url, bm25(fts) AS s, substr(p.body,1,900) FROM fts JOIN p ON p.rowid = fts.rowid "
        "LEFT JOIN w ON w.work_id = p.work_id WHERE fts MATCH ? ORDER BY s LIMIT 40",
        (" OR ".join(terms),),
    ).fetchall()
    return [
        {"chunk_id": a, "work_id": b, "case_name": c or b, "court": d or "", "date": (e or "")[:10], "url": f or "", "score": round(-s, 3), "text": t}
        for a, b, c, d, e, f, s, t in rows
    ]


def _cache_get(h):
    f = CACHE / f"{h}.json"
    if f.exists():
        try:
            d = json.loads(f.read_text())
        except Exception:
            d = {}
        if d.get("passages"):
            octocache.link("retrieval", h, True)
            return d
    for r in octocache.query("SELECT source, passages FROM retrieval WHERE key = $1", [h]):
        ps = loads(r.get("passages")) or []
        if ps:
            d = {"passages": ps, "source": r["source"]}
            f.write_text(json.dumps(d))  # sync back to the local layer
            octocache.link("retrieval", h, True)
            return d
    return None


def _cache_put(h, question, source, passages, retrieval=None):
    (CACHE / f"{h}.json").write_text(json.dumps({"passages": passages, "source": source, "retrieval": retrieval}))
    octocache.write(
        "INSERT INTO retrieval(key, query, source, passages, n, run_id, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (key) DO NOTHING",
        [h, question[:500], source, json.dumps(passages), len(passages), octocache.RUN.get() or None, octocache.now()],
    )
    octocache.link("retrieval", h, False)


# --- the engine's answer, as passages -------------------------------------------------------------------

def passage_header(text):
    """The line a passage begins with: `Case Name | Court of X | YYYY`. Empty when it carries none."""
    head = str(text or "").split("\n")[0]
    parts = [part.strip() for part in head.split("|")]
    if len(parts) < 2:
        return {}
    out = {"name": parts[0]}
    if parts[1]:
        out["court"] = parts[1]
    if len(parts) > 2:
        year = re.search(r"\d{4}", parts[2])
        if year:
            out["year"] = year.group(0)
    return out


def _passage(p):
    return {
        "chunk_id": p.get("chunk_id") or "",
        "ord": p.get("ord"),
        "text": p.get("text") or "",
        "bm25": p.get("bm25"),
        "spans": [s for s in (p.get("spans") or []) if isinstance(s, dict)],
    }


def _from_engine(doc):
    """The engine's results, in its order, as passages the rest of the app already understands."""
    result = doc.get("result") or {}
    stages = [engine.stage_record(raw) for raw in doc.get("stages") or [] if isinstance(raw, dict)]
    passages = []
    for r in result.get("results") or []:
        if not isinstance(r, dict):
            continue
        case = r.get("case") if isinstance(r.get("case"), dict) else {}
        nid = str(case.get("id") or "").strip()
        name = str(case.get("name") or "").strip()
        # The rest of the app keys an authority by its own name (the graph nodes, the citation list); an
        # opaque row id is kept as `cap_id` instead of replacing the name a reader can check.
        if name and (not nid or re.fullmatch(r"[0-9:._-]+", nid)):
            nid = name
        if not nid:
            continue
        found = [p for p in (r.get("passages") or []) if isinstance(p, dict)]
        first = found[0] if found else {}
        head = passage_header(first.get("text"))
        year = case.get("year")
        passages.append(
            {
                "chunk_id": first.get("chunk_id") or "",
                "work_id": nid,
                "case_name": case.get("name") or head.get("name") or nid,
                "court": case.get("court") or head.get("court") or "",
                "date": str(year) if year else (head.get("year") or ""),
                "url": case.get("link") or "",
                "score": r.get("score"),
                "text": first.get("text") or "",
                "rank": r.get("rank"),
                "score_kind": r.get("score_kind"),
                "rrf": r.get("rrf"),
                "bm25": r.get("bm25"),
                "dense": r.get("dense"),
                "cap_id": case.get("cap_id"),
                "provenance": [p.get("source") for p in (r.get("provenance") or []) if isinstance(p, dict) and p.get("source")],
                "passages": [_passage(p) for p in found],
            }
        )
    graph_stage = next((stage for stage in stages if stage.get("name") == "graph"), None)
    if graph_stage is not None and not graph_stage.get("skipped"):
        graph_source = "engine:graph"
    elif graph_stage is not None:
        graph_source = "engine:graph (skipped)"
    else:
        graph_source = "not reported by the engine"
    record = {
        "source": engine.stage_source(stages),
        "stages": stages,
        "graph": {"source": graph_source, "revision": result.get("graph_revision")},
        "engine": {
            "configured": True,
            "ok": True,
            "reason": None,
            "corpus_revision": result.get("corpus_revision"),
            "elapsed_ms": result.get("elapsed_ms"),
        },
    }
    return passages, record


def _fallback_record(source, reason):
    """What a run reports when the engine did not supply the passages."""
    return {
        "source": source,
        "stages": [],
        "graph": {"source": "local-citation-edges", "revision": None},
        "engine": {"configured": engine.configured(), "ok": False, "reason": reason or "not configured"},
    }


def last_retrieval():
    """The stage record behind the `search()` call this thread just made, or None."""
    return getattr(_local, "record", None)


def search(question, k=12):
    """Returns (passages, source). Source: `engine:<stages>` | 'octo-live' | 'octo-snapshot' | None."""
    from app import stats

    _local.record = None
    h = hashlib.sha256(question.strip().lower().encode()).hexdigest()[:24]
    stats.bump("octo_searches")
    d = _cache_get(h)
    if d:
        stats.bump("octo_cache_hits")
        source = d["source"] + " (cached)"
        stats.put("octo_last_source", source)
        record = d.get("retrieval") or _fallback_record(d["source"], "the stage record for this cached retrieval was not saved")
        record = dict(record)
        record["cached"] = True
        _local.record = record
        return d["passages"][:k], source
    engine_error = None
    if engine.configured():
        try:
            doc = engine.retrieve(question, k=k)
        except engine.EngineError as failure:
            engine_error = failure.reason
            stats.put("octo_last_source", "engine unreachable")
        else:
            passages, record = _from_engine(doc, question)
            if passages:
                _cache_put(h, question, record["source"], passages, record)
                stats.bump("octo_engine")
                stats.put("octo_last_source", record["source"])
                _local.record = record
                return passages[:k], record["source"]
            engine_error = "the engine returned no authority"
    for name, fn in (("octo-live", _live), ("octo-snapshot", _snapshot)):
        res = fn(question)
        if res:
            seen, uniq = set(), []  # one best passage per case first, then extras
            for p in res:
                if p["work_id"] not in seen:
                    seen.add(p["work_id"])
                    uniq.append(p)
            record = _fallback_record(name, engine_error)
            _cache_put(h, question, name, uniq, record)
            stats.bump("octo_live" if name == "octo-live" else "octo_snapshot")
            stats.put("octo_last_source", name)
            _local.record = record
            return uniq[:k], name
    _local.record = _fallback_record(None, engine_error or "no retrieval path answered")
    return [], None


def first_chunks(work_ids):
    """County-bearing text per case from the Octo snapshot (sentences mentioning a County in its first passages)."""
    if not SNAP.exists() or not work_ids:
        return {}
    db = sqlite3.connect(SNAP)
    out = {}
    for w in work_ids:
        txt = " ".join(r[0] for r in db.execute("SELECT body FROM p WHERE work_id=? ORDER BY ord", (w,)))
        hits = re.findall(r"[^.|\n]{0,80}\bCounty\b[^.|\n]{0,40}", txt)
        if hits:
            out[w] = " | ".join(hits[:6])
    return out
