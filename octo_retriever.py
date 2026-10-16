"""Octo passage retriever (primary). Live: Octo workspace SQL full-text search (Postgres tsvector, ts_rank) over
legal_graph.chunk (804,646 passages). Fallback: local SQLite FTS5 snapshot of Octo passages exported via a relay
(the sandbox network cannot reach octodb.design-bakery.com). Responses cached on disk by query hash."""
import os, json, re, time, hashlib, sqlite3, pathlib, gzip, urllib.request
ROOT = pathlib.Path(__file__).parent; CACHE = ROOT / "cache" / "octo"; CACHE.mkdir(parents=True, exist_ok=True)
SNAP = ROOT / "data" / "octo_snapshot.sqlite"
BASE = os.environ.get("OCTO_BASE_URL", "https://octodb.design-bakery.com/api")
WS = os.environ.get("OCTO_WORKSPACE_ID", "76d7577b-2274-42b4-a8dc-1ff1c0efa741")
_live_ok = {"t": 0, "ok": None}
LIVE_SQL = ("SELECT c.chunk_id, e.work_id, w.case_name, w.court_id, w.decided_on, w.ext_ids, ts_rank(c.tsv, q) AS score, left(c.body, 900) AS body "
            "FROM legal_graph.chunk c JOIN legal_graph.expression e USING (expr_id) JOIN legal_graph.work w ON w.work_id = e.work_id, "
            "websearch_to_tsquery('english', $1) q WHERE c.tsv @@ q ORDER BY score DESC LIMIT 40")
STOP = set("a an the of to in on for and or is are was be by with what when how does do can could would should under law legal court who which my i if it that this from as at without".split())
def _terms(q): return [t for t in re.findall(r"[a-z0-9]+", q.lower()) if t not in STOP and len(t) > 2]
def _live(question):
    key = os.environ.get("OCTO_API_KEY") or os.environ.get("octo_db_legal")
    if not key or os.environ.get("OCTO_MODE") == "snapshot": return None
    if _live_ok["ok"] is False and time.time() - _live_ok["t"] < 300: return None
    body = {"sql": LIVE_SQL, "params": [" OR ".join(_terms(question)) or question], "rowLimit": 40}
    req = urllib.request.Request(f"{BASE}/workspaces/{WS}/query", data=json.dumps(body, ensure_ascii=True).encode(),
        headers={"Authorization": "Bearer " + key, "Content-Type": "application/json", "User-Agent": "legal-graph/0.1"})
    try:
        rows = json.load(urllib.request.urlopen(req, timeout=6))["rows"]; _live_ok.update(ok=True, t=time.time())
    except Exception:
        _live_ok.update(ok=False, t=time.time()); return None
    out = []
    for r in rows:
        ext = r.get("ext_ids") or {}
        out.append({"chunk_id": r["chunk_id"], "work_id": r["work_id"], "case_name": r.get("case_name") or r["work_id"], "court": r.get("court_id") or "",
                    "date": (r.get("decided_on") or "")[:10], "url": ext.get("html") or "", "score": float(r["score"]), "text": r["body"]})
    return out
def _snapshot(question):
    if not SNAP.exists(): return None
    db = sqlite3.connect(SNAP); terms = _terms(question)
    if not terms: return []
    rows = db.execute("SELECT p.chunk_id, p.work_id, w.case_name, w.court, w.date, w.url, bm25(fts) AS s, substr(p.body,1,900) FROM fts JOIN p ON p.rowid = fts.rowid "
                      "LEFT JOIN w ON w.work_id = p.work_id WHERE fts MATCH ? ORDER BY s LIMIT 40", (" OR ".join(terms),)).fetchall()
    return [{"chunk_id": a, "work_id": b, "case_name": c or b, "court": d or "", "date": (e or "")[:10], "url": f or "", "score": round(-s, 3), "text": t}
            for a, b, c, d, e, f, s, t in rows]
def search(question, k=12):
    """Returns (passages, source). Source: 'octo-live' | 'octo-snapshot' | None."""
    h = hashlib.sha256(question.strip().lower().encode()).hexdigest()[:24]; f = CACHE / f"{h}.json"
    import stats; stats.bump("octo_searches")
    if f.exists():
        d = json.loads(f.read_text()); stats.bump("octo_cache_hits"); stats.put("octo_last_source", d["source"] + " (cached)"); return d["passages"][:k], d["source"] + " (cached)"
    for name, fn in (("octo-live", _live), ("octo-snapshot", _snapshot)):
        res = fn(question)
        if res:
            seen, uniq = set(), []          # one best passage per case first, then extras
            for p in res:
                if p["work_id"] not in seen: seen.add(p["work_id"]); uniq.append(p)
            f.write_text(json.dumps({"passages": uniq, "source": name})); stats.bump("octo_live" if name == "octo-live" else "octo_snapshot"); stats.put("octo_last_source", name); return uniq[:k], name
    return [], None

def first_chunks(work_ids):
    """County-bearing text per case from the Octo snapshot (sentences mentioning a County in its first passages)."""
    if not SNAP.exists() or not work_ids: return {}
    db = sqlite3.connect(SNAP); out = {}
    for w in work_ids:
        txt = " ".join(r[0] for r in db.execute("SELECT body FROM p WHERE work_id=? ORDER BY ord", (w,)))
        hits = re.findall(r"[^.|\n]{0,80}\bCounty\b[^.|\n]{0,40}", txt)
        if hits: out[w] = " | ".join(hits[:6])
    return out
