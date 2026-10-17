"""Tiny SQL store adapters with one interface (query/execute/script, $1-style params): local SQLite and Octo."""

import json, os, re, sqlite3, threading
import httpx


class MissingTable(Exception):
    pass


class StoreError(Exception):
    pass


class SqliteStore:
    def __init__(self, path):
        self.db = sqlite3.connect(str(path), check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.lock = threading.Lock()

    def _run(self, sql, params):
        sql = re.sub(r"\$(\d+)", r"?\1", sql)
        try:
            with self.lock:
                cur = self.db.execute(sql, list(params))
                rows = [dict(r) for r in cur.fetchall()]
                self.db.commit()
                return rows, cur.rowcount
        except sqlite3.OperationalError as e:
            if "no such table" in str(e):
                raise MissingTable(str(e))
            raise StoreError(str(e))

    def query(self, sql, params=()):
        return self._run(sql, params)[0]

    def execute(self, sql, params=()):
        return self._run(sql, params)[1]

    def script(self, sql):
        with self.lock:
            self.db.executescript(sql)
            self.db.commit()


class OctoStore:
    """Octo workspace = managed PostgreSQL behind POST {base}/workspaces/{id}/query {sql, params, rowLimit}."""

    def __init__(self, base, workspace, key, timeout=5.0):
        self.url = base.rstrip("/") + f"/workspaces/{workspace}/query"
        self._h = {"Authorization": "Bearer " + key, "User-Agent": "precedent-tts/1"}
        self.timeout = timeout

    @classmethod
    def from_env(cls, timeout=5.0):
        k = os.environ.get("OCTO_API_KEY")
        if not k:
            return None
        return cls(os.environ.get("OCTO_BASE_URL", "https://octodb.design-bakery.com/api"), os.environ.get("OCTO_WORKSPACE_ID", ""), k, timeout)

    def _post(self, sql, params):
        r = httpx.post(self.url, headers=self._h, timeout=self.timeout, json={"sql": sql, "params": list(params), "rowLimit": 1000})
        try:
            j = r.json()
        except Exception:
            j = {}
        if r.status_code >= 400 or "error" in j:
            if j.get("code") == "42P01":
                raise MissingTable(j.get("message", ""))
            raise StoreError("octo %d %s" % (r.status_code, str(j.get("error") or "")[:80]))  # never echo the request
        return j

    def query(self, sql, params=()):
        return self._post(sql, params).get("rows", [])

    def execute(self, sql, params=()):
        return self._post(sql, params).get("rowCount", 0)

    def script(self, sql):
        self._post(sql, [])


def dumps(v):
    return None if v is None else json.dumps(v)


def loads(v):
    if v is None or isinstance(v, (list, dict)):
        return v
    try:
        return json.loads(v)
    except Exception:
        return None
