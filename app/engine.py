"""HTTP client for the retrieval engine on this host.

The engine owns retrieval: the lexical index, the dense half, the citation graph and the reranker, plus
the support checker. This module is the only place the app talks to it, and it never hardcodes or prints
either half of the credential: the base URL and the bearer token come from `ENGINE_BASE_URL` and
`ENGINE_API_TOKEN`.

Everything here reports what happened. A skipped stage keeps the engine's own reason, a failed call keeps
the reason it failed, and a checker that did not run is never reported as a pass.
"""

import json
import os
import threading
import time
import urllib.error
import urllib.request

DEFAULT_TIMEOUT = float(os.environ.get("ENGINE_TIMEOUT_S", "120"))
HEALTH_TIMEOUT = float(os.environ.get("ENGINE_HEALTH_TIMEOUT_S", "2.5"))
HEALTH_TTL = 10.0

SCORER = os.environ.get("ENGINE_SCORER", "minicheck")
CHECK_THRESHOLD = float(os.environ.get("ENGINE_CHECK_THRESHOLD", "0.5"))

# The engine's defaults, spelled out: every field but `query` is optional there.
RETRIEVE_DEFAULTS = {
    "k": 12,
    "bm25_k": 100,
    "dense": True,
    "dense_pool": 50,
    "graph": True,
    "graph_seed_docs": 10,
    "rerank": True,
    "rerank_k": 30,
    "jev": False,
    "passages_per_case": 2,
    "stream": False,
}

# The order the engine emits its stages in; `jev` only when it was asked for.
STAGE_ORDER = ("parse", "bm25", "dense", "hybrid", "graph", "rerank", "jev")


class EngineError(RuntimeError):
    """The engine did not answer, or answered with an error. `reason` is safe to show to a reader."""

    def __init__(self, reason, status=None, detail=""):
        super().__init__(reason)
        self.reason = str(reason)[:300]
        self.status = status
        self.detail = str(detail or "")[:400]


def base_url():
    return (os.environ.get("ENGINE_BASE_URL") or "").strip().rstrip("/")


def token():
    return (os.environ.get("ENGINE_API_TOKEN") or "").strip()


def configured():
    """Whether this process was handed an engine address and token."""
    return bool(base_url() and token())


def _request(method, path, body=None, timeout=None):
    if not configured():
        raise EngineError("ENGINE_BASE_URL/ENGINE_API_TOKEN not configured")
    data = None if body is None else json.dumps(body).encode("utf-8")
    headers = {
        "Authorization": "Bearer " + token(),
        "Accept": "application/json",
        "User-Agent": "precedent/1",
    }
    if data is not None:
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(base_url() + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=timeout or DEFAULT_TIMEOUT) as response:
            raw = response.read()
    except urllib.error.HTTPError as error:
        detail = ""
        try:
            payload = json.loads(error.read().decode("utf-8", "replace"))
            detail = str(payload.get("detail") or payload.get("error") or "")
        except Exception:
            detail = ""
        raise EngineError(f"{error.code} {path}", status=error.code, detail=detail)
    except Exception as error:  # connection refused, DNS, timeout, TLS
        raise EngineError(f"{type(error).__name__}: {error}")
    try:
        return json.loads(raw or b"{}")
    except Exception:
        raise EngineError(f"{path} did not answer JSON")


# --- health -------------------------------------------------------------------------------------

_health_lock = threading.Lock()
_health = {"at": 0.0, "data": None, "error": None}


def probe(force=False):
    """GET /api/v1/health, cached for a few seconds. Returns {"ok", "data", "error"}."""
    if not configured():
        return {"ok": False, "data": None, "error": "not configured"}
    with _health_lock:
        if not force and _health["at"] and time.time() - _health["at"] < HEALTH_TTL:
            return {"ok": _health["error"] is None, "data": _health["data"], "error": _health["error"]}
    try:
        data = _request("GET", "/health", None, HEALTH_TIMEOUT)
        error = None
    except EngineError as failure:
        data, error = None, failure.reason
    with _health_lock:
        _health.update(at=time.time(), data=data, error=error)
    return {"ok": error is None, "data": data, "error": error}


def _engine_block(data):
    """The `engine` object inside a health payload, tolerating a flatter shape."""
    if not isinstance(data, dict):
        return {}
    block = data.get("engine")
    return block if isinstance(block, dict) else data


# --- retrieve -----------------------------------------------------------------------------------

_last_lock = threading.Lock()
_last = {"stages": [], "error": None, "at": 0.0}


def stage_record(raw):
    """One stage record in the shape a run stores: name, duration, whether it ran and why not."""
    record = {"name": str(raw.get("stage") or raw.get("name") or ""), "duration_ms": None, "skipped": bool(raw.get("skipped"))}
    duration = raw.get("duration_ms")
    if isinstance(duration, (int, float)) and not isinstance(duration, bool):
        record["duration_ms"] = round(float(duration), 3)
    reason = raw.get("reason")
    if reason:
        record["reason"] = str(reason)
    elif record["skipped"]:
        record["reason"] = "the engine did not say why this stage was skipped"
    return record


def retrieve(query, **options):
    """POST /api/v1/retrieve (single JSON response). Returns {"stages": [...], "result": {...}}."""
    body = dict(RETRIEVE_DEFAULTS)
    for key, value in options.items():
        if value is not None:
            body[key] = value
    body["query"] = query
    body["stream"] = False
    try:
        payload = _request("POST", "/retrieve", body)
    except EngineError as failure:
        with _last_lock:
            _last.update(error=failure.reason, at=time.time(), stages=[])
        raise
    result = payload.get("result")
    if not isinstance(result, dict) and isinstance(payload.get("results"), list):
        result = payload
    if not isinstance(result, dict):
        raise EngineError("the engine returned no result")
    stages = [raw for raw in (payload.get("stages") or result.get("stages") or []) if isinstance(raw, dict)]
    with _last_lock:
        _last.update(stages=[stage_record(raw) for raw in stages], error=None, at=time.time())
    return {"stages": stages, "result": result}


def last_stages():
    with _last_lock:
        return [dict(record) for record in _last["stages"]]


def last_error():
    with _last_lock:
        return _last["error"]


def stage_source(stages):
    """`engine:bm25+dense+hybrid+graph+rerank` — only the stages that actually ran, in engine order."""
    ran = [record["name"] for record in stages if record.get("name") and not record.get("skipped")]
    if not ran:
        return "engine:none"
    order = {name: i for i, name in enumerate(STAGE_ORDER)}
    ran.sort(key=lambda name: order.get(name, len(order)))
    return "engine:" + "+".join(ran)


# --- check --------------------------------------------------------------------------------------


def check(claims, scorer=None, threshold=None):
    """POST /api/v1/check: does each claim's cited passage support it?

    Raises EngineError when the checker did not run (a scorer the engine cannot run answers 503); the
    caller must treat that as "the checker did not run", never as a pass.
    """
    body = {
        "claims": claims,
        "scorer": scorer or SCORER,
        "threshold": CHECK_THRESHOLD if threshold is None else float(threshold),
        "temperature": 1.0,
    }
    return _request("POST", "/check", body)


# --- what the stack reports ---------------------------------------------------------------------


def status(stages=None):
    """The `engine` object `/api/health` and `/api/stack` report. Absent fields stay None."""
    reported = {
        "configured": configured(),
        "ok": False,
        "status": "not configured",
        "chunk_count": None,
        "case_count": None,
        "corpus_revision": None,
        "graph_revision": None,
        "lexical": None,
        "dense_model": None,
        "rerank_model": None,
        "jev_model": None,
        "scorer": SCORER,
        "last_error": None,
        "stages": list(stages if stages is not None else last_stages()),
    }
    if not configured():
        return reported
    health = probe()
    if not health["ok"]:
        reported["status"] = "unreachable"
        reported["last_error"] = health["error"]
        return reported
    block = _engine_block(health["data"])
    reported.update(
        ok=str(block.get("status") or "").lower() in ("ready", "ok", "healthy") or bool(block.get("chunks") or block.get("chunk_count")),
        status=str(block.get("status") or "unknown"),
        chunk_count=block.get("chunks", block.get("chunk_count")),
        case_count=block.get("cases", block.get("case_count")),
        corpus_revision=block.get("corpus_revision"),
        graph_revision=block.get("graph_revision"),
        lexical=block.get("lexical"),
        dense_model=block.get("dense_model"),
        rerank_model=block.get("rerank_model"),
        jev_model=block.get("jev_model"),
        scorer=block.get("scorer") or SCORER,
        last_error=block.get("last_error") or last_error(),
    )
    return reported
