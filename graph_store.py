"""SurrealDB-backed legal graph (NetworkX fallback). PageRank precomputed once and cached."""
import os, json, hashlib, re, math, pathlib, pickle, httpx, collections
D = pathlib.Path(os.environ.get("GRAPH_DATA_DIR") or (pathlib.Path(__file__).resolve().parent / "data"))
CACHE = pathlib.Path(__file__).parent / "cache" / "graph_meta.pkl"
STOP = set("a an the of to in on for and or is are was be by with what when how does do can under law legal court colorado who which my i if it that this from as at".split())
def key(s): return "n" + hashlib.md5(s.encode()).hexdigest()[:16]
def toks(s): return [t for t in re.findall(r"[a-z0-9§\-\.]+", s.lower()) if t not in STOP and len(t) > 1]
class Graph:
    def __init__(self):
        self.backend = "surrealdb"
        self.c = httpx.Client(base_url="http://127.0.0.1:8000", auth=("root", "root"), timeout=30,
                              headers={"surreal-ns": "legal", "surreal-db": "graph", "Accept": "application/json"})
        try:
            self.q("SELECT count() FROM node LIMIT 1;")
        except Exception:
            self.backend = "networkx"
        if CACHE.exists():
            self.nodes, self.pr, self.indeg, self.inv = pickle.loads(CACHE.read_bytes())
        else:
            import networkx as nx
            g = nx.DiGraph(); self.nodes = {}
            for l in open(D / "nodes.jsonl"):
                n = json.loads(l); self.nodes[n["id"]] = n; g.add_node(n["id"])
            for l in open(D / "edges.jsonl"):
                e = json.loads(l); g.add_edge(e["src"], e["dst"], kind=e["kind"])
            self.pr = nx.pagerank(g, max_iter=50); self.indeg = dict(g.in_degree())
            self.inv = collections.defaultdict(set)
            for nid, n in self.nodes.items():
                for t in set(toks(nid + " " + n.get("title", "") + " " + n.get("type", ""))): self.inv[t].add(nid)
            self.inv = dict(self.inv)
            CACHE.write_bytes(pickle.dumps((self.nodes, self.pr, self.indeg, self.inv)))
        self.by_key = {key(n): n for n in self.nodes}
        if self.backend == "networkx":
            import networkx as nx
            self.g = nx.DiGraph()
            for l in open(D / "edges.jsonl"):
                e = json.loads(l); self.g.add_edge(e["src"], e["dst"], kind=e["kind"])
    def q(self, sql):
        import time as _t, stats; t0 = _t.perf_counter()
        r = self.c.post("/sql", content=sql); r.raise_for_status(); out = r.json()
        ms = round((_t.perf_counter() - t0) * 1000, 1); stats.put("surreal_last_ms", ms); stats.bump("surreal_queries"); stats.qlog(sql, ms); stats.bump("surreal_total_ms", ms)
        for o in out:
            if o.get("status") != "OK": raise RuntimeError(str(o)[:300])
        return [o["result"] for o in out]
    def seeds(self, question, k=6):
        qt = toks(question); score = collections.Counter()
        for t in qt:
            hits = self.inv.get(t, ())
            if not hits or len(hits) > 20000: continue
            idf = math.log(len(self.nodes) / len(hits))
            for h in hits: score[h] += idf
        ranked = sorted(score, key=lambda n: -(score[n] + 2 * math.log1p(self.indeg.get(n, 0))))
        return ranked[:k], qt
    def neighbors(self, nid, direction):
        """direction 'out' = authorities this cites; 'in' = cases citing it. Uses SurrealDB graph traversal."""
        if self.backend == "surrealdb":
            arrow = "->cites->node" if direction == "out" else "<-cites<-node"
            res = self.q(f"SELECT VALUE {arrow}.name FROM node:{key(nid)};")[0]
            return [x for x in (res[0] if res else []) if x]
        if nid not in self.g: return []   # authority with no citation edges (networkx graph is built from edges only)
        return list(self.g.successors(nid) if direction == "out" else self.g.predecessors(nid))
    def info(self, nid):
        n = self.nodes.get(nid, {"id": nid})
        return {"id": nid, "title": n.get("title") or nid, "type": n.get("type", ""), "court": n.get("court", ""),
                "date": n.get("date", ""), "url": n.get("url") or "", "pagerank": round(self.pr.get(nid, 0) * 1e5, 2),
                "cited_by": self.indeg.get(nid, 0)}
