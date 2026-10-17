"""In-process live counters for the sponsor dashboard (real values only)."""

import threading, time

_l = threading.Lock()
S = {
    "surreal_queries": 0,
    "surreal_last_ms": None,
    "surreal_total_ms": 0.0,
    "octo_searches": 0,
    "octo_live": 0,
    "octo_snapshot": 0,
    "octo_cache_hits": 0,
    "octo_last_source": None,
    "tts_calls": 0,
    "tts_cache_hits": 0,
    "started": time.time(),
}


def bump(k, n=1):
    with _l:
        S[k] = S.get(k, 0) + n


def put(k, v):
    with _l:
        S[k] = v


import collections

QLOG: collections.deque = collections.deque(maxlen=40)  # recent SurrealQL queries with timings
VLOG: collections.deque = collections.deque(maxlen=60)  # ElevenLabs TTS/STT history


def qlog(sql, ms):
    QLOG.append({"t": time.time(), "sql": sql[:300], "ms": ms})


def vlog(kind, chars, cached):
    VLOG.append({"t": time.time(), "kind": kind, "chars": chars, "cached": cached})
