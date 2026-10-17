import os, json, hashlib, httpx, time

D = os.path.join(os.environ.get("GRAPH_DATA_DIR") or os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data"), "")
H = {"surreal-ns": "legal", "surreal-db": "graph", "Accept": "application/json"}
c = httpx.Client(base_url="http://127.0.0.1:8000", auth=("root", "root"), headers=H, timeout=120)


def k(s):
    return "n" + hashlib.md5(s.encode()).hexdigest()[:16]


def q(sql):
    r = c.post("/sql", content=sql)
    r.raise_for_status()
    out = r.json()
    for o in out:
        if o.get("status") != "OK":
            raise SystemExit(str(o)[:500])
    return out


t = time.time()
c.post("/sql", content="DEFINE NAMESPACE IF NOT EXISTS legal; USE NS legal; DEFINE DATABASE IF NOT EXISTS graph;", headers={"Accept": "application/json"})
q("DEFINE TABLE node SCHEMALESS; DEFINE TABLE cites TYPE RELATION; DEFINE TABLE part_of TYPE RELATION;")
nodes = [json.loads(l) for l in open(D + "nodes.jsonl")]
for i in range(0, len(nodes), 1000):
    b = [dict(n, id=k(n["id"]), name=n["id"]) for n in nodes[i : i + 1000]]
    q("INSERT INTO node " + json.dumps(b) + " RETURN NONE;")
ids = {n["id"] for n in nodes}
edges = [json.loads(l) for l in open(D + "edges.jsonl")]
st = []
for e in edges:
    if e["src"] in ids and e["dst"] in ids and e["kind"] in ("cites", "part_of"):
        st.append(f"RELATE node:{k(e['src'])}->{e['kind']}->node:{k(e['dst'])} RETURN NONE;")
for i in range(0, len(st), 1000):
    q("BEGIN;" + "".join(st[i : i + 1000]) + "COMMIT;")
print(f"loaded {len(nodes)} nodes {len(st)} edges in {time.time() - t:.1f}s")
print(q("SELECT count() FROM cites GROUP ALL; SELECT count() FROM node GROUP ALL;"))
