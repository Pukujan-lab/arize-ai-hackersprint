"""API rate limits / slowdown: one in-flight run, per-IP questions/min, global hourly caps per paid API."""

import threading, time, collections

import os

CAPS = {
    "anthropic": 40,
    "elevenlabs_tts": 30,
    "elevenlabs_stt": 20,
    "fish_tts": int(os.environ.get("FISH_TTS_PER_HOUR", "200")),
    "kokoro_tts": int(os.environ.get("KOKORO_TTS_PER_HOUR", "1000")),  # Kokoro is local + free; cap only as a runaway guard
}

PER_IP_PER_MIN = int(os.environ.get("ASK_PER_IP_PER_MIN", "30"))  # backstop per IP (many devices may share one)
ASK_PER_MIN = int(os.environ.get("ASK_PER_MIN", "6"))  # per session (or per IP if no session)
pipeline_runs = 0
_l = threading.Lock()
run_lock = threading.Lock()
_hour: dict = {k: collections.deque() for k in CAPS}
_ip: collections.defaultdict = collections.defaultdict(collections.deque)
blocked: collections.Counter = collections.Counter()


def _trim(d, window):
    now = time.time()
    while d and now - d[0] > window:
        d.popleft()


def take(api):
    """Consume one unit of an hourly cap; False if the cap is reached."""
    with _l:
        d = _hour[api]
        _trim(d, 3600)
        if len(d) >= CAPS[api]:
            blocked[api] += 1
            return False
        d.append(time.time())
        return True


def ip_ok(ip):
    with _l:
        d = _ip[ip]
        _trim(d, 60)
        if len(d) >= PER_IP_PER_MIN:
            blocked["per_ip"] += 1
            return False
        d.append(time.time())
        return True


def ask_ok(sid, ip):
    """Per-session asks/min (falls back to IP when no session header) plus a looser per-IP backstop. No daily limit."""
    with _l:
        k = ("s:" + sid) if sid else ("i:" + ip)
        d = _ip[k]
        _trim(d, 60)
        if len(d) >= ASK_PER_MIN:
            blocked["per_session"] += 1
            return False
        di = _ip["ip:" + ip]
        _trim(di, 60)
        if sid and len(di) >= PER_IP_PER_MIN:
            blocked["per_ip"] += 1
            return False
        d.append(time.time())
        di.append(time.time())
        return True


def snapshot():
    with _l:
        for d in _hour.values():
            _trim(d, 3600)
        return {
            "caps": {k: {"used_last_hour": len(_hour[k]), "cap_per_hour": CAPS[k]} for k in CAPS},
            "per_ip_per_min": PER_IP_PER_MIN,
            "ask_per_session_per_min": ASK_PER_MIN,
            "pipeline_runs": pipeline_runs,
            "in_flight": run_lock.locked(),
            "blocked": dict(blocked),
        }
