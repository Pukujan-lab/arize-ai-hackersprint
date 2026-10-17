"""Build local SQLite FTS5 index from an Octo passage export (octo_chunks.jsonl.gz + octo_works.json.gz)."""

import sqlite3, json, gzip, sys, pathlib, time

src = pathlib.Path(sys.argv[1])
out = pathlib.Path(__file__).resolve().parent.parent / "data" / "octo_snapshot.sqlite"
out.parent.mkdir(exist_ok=True)
tmp = out.with_suffix(".tmp")
tmp.unlink(missing_ok=True)
db = sqlite3.connect(tmp)
t = time.time()
db.executescript(
    "CREATE TABLE p(rowid INTEGER PRIMARY KEY, chunk_id TEXT, work_id TEXT, ord INT, body TEXT);"
    "CREATE TABLE w(work_id TEXT PRIMARY KEY, case_name TEXT, court TEXT, date TEXT, url TEXT);"
    "CREATE VIRTUAL TABLE fts USING fts5(body, content='p', content_rowid='rowid', tokenize='porter');"
)
batch = []
for line in gzip.open(src / "octo_chunks.jsonl.gz", "rt"):
    r = json.loads(line)
    batch.append((r["chunk_id"], r["work_id"], r["ord"], r["body"]))
    if len(batch) >= 20000:
        db.executemany("INSERT INTO p(chunk_id,work_id,ord,body) VALUES(?,?,?,?)", batch)
        batch = []
db.executemany("INSERT INTO p(chunk_id,work_id,ord,body) VALUES(?,?,?,?)", batch)
for r in json.load(gzip.open(src / "octo_works.json.gz", "rt")):
    e = r.get("ext_ids") or {}
    db.execute(
        "INSERT OR REPLACE INTO w VALUES(?,?,?,?,?)",
        (r["work_id"], r.get("case_name"), r.get("court_id"), (r.get("decided_on") or "")[:10], e.get("html") or ""),
    )
db.execute("INSERT INTO fts(fts) VALUES('rebuild')")
db.commit()
db.close()
tmp.replace(out)
print(f"built {out} in {time.time() - t:.0f}s")
