"""Shared Octo layer for every cache (TTS clips, LLM answers, retrievals, tour steps).

Pattern everywhere: local first (fast, works offline) -> Octo workspace Postgres second -> compute. New entries are
written locally and pushed to Octo in the background; Octo hits are synced back to the local layer. Octo is used only
when its schema_version matches schema.SCHEMA_VERSION (deploy applies migrations). Runs link to the cache rows they used."""

import contextlib, contextvars, datetime, os, queue, threading, time
from schema import SCHEMA_VERSION
from schema.store import OctoStore

_octo: dict = {"ok": None, "t": 0.0, "down_until": 0.0, "status": None, "store": None}
RUN: contextvars.ContextVar = contextvars.ContextVar("precedent_run_id", default="")


def _off(name):
    return os.environ.get(name, "") not in ("", "0")


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def octo_check():
    """Startup/periodic check that Octo's schema_version matches the repo. Pending migrations are applied by deploy."""
    from schema import migrate

    s = OctoStore.from_env()
    if not s:
        _octo.update(ok=False, t=time.time(), status={"repo": SCHEMA_VERSION, "store": None, "ok": False, "reason": "no OCTO_API_KEY"})
        return _octo["status"]
    try:
        st = migrate.status(s)
    except Exception as e:
        st = {"repo": SCHEMA_VERSION, "store": None, "ok": False, "reason": type(e).__name__}
        _octo["down_until"] = time.time() + 60
    _octo.update(ok=st["ok"], t=time.time(), status=st, store=s)
    return st


def octo_store():
    """Shared layer, or None when unconfigured, disabled, unreachable, or its schema version doesn't match this code."""
    if not os.environ.get("OCTO_API_KEY") or _off("OCTO_CACHE_DISABLE") or _off("TTS_OCTO_DISABLE") or time.time() < _octo["down_until"]:
        return None
    if _octo["ok"] is None or time.time() - _octo["t"] > 300:
        octo_check()
    return _octo["store"] if _octo["ok"] else None


def down():
    _octo["down_until"] = time.time() + 60


def up():
    return bool(_octo["ok"]) and time.time() >= _octo["down_until"]


def status():
    return _octo["status"] or {"repo": SCHEMA_VERSION, "store": None, "ok": False}


def query(sql, params=()):
    """Read from Octo; [] when Octo is unavailable (and back off for a minute on errors)."""
    s = octo_store()
    if not s:
        return []
    try:
        return s.query(sql, params)
    except Exception:
        down()
        return []


_oq: queue.Queue = queue.Queue()
_ow: dict = {"t": None}


def _writer():
    while True:
        store, sql, params = _oq.get()
        try:
            store.execute(sql, params)
        except Exception:
            down()
        finally:
            _oq.task_done()


def write(sql, params):
    """Fire-and-forget write to Octo (never blocks a request)."""
    s = octo_store()
    if not s:
        return
    if not _ow["t"]:
        _ow["t"] = threading.Thread(target=_writer, daemon=True, name="octo-writer")
        _ow["t"].start()
    _oq.put((s, sql, params))


def flush():
    _oq.join()


@contextlib.contextmanager
def run_context(run_id):
    tok = RUN.set(str(run_id or ""))
    try:
        yield
    finally:
        RUN.reset(tok)


def link(kind, key, hit):
    """Record that the current run used cache row `key` of `kind` (answer | retrieval)."""
    rid = RUN.get()
    if rid:
        write(
            "INSERT INTO run_cache_link(run_id, kind, key, hit, created_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (run_id, kind, key) DO NOTHING",
            [rid, kind, key, 1 if hit else 0, now()],
        )
