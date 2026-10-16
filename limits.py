"""API rate limits / slowdown: one in-flight run, per-IP questions/min, global hourly caps per paid API."""
import threading, time, collections
CAPS = {"anthropic": 40, "elevenlabs_tts": 30, "elevenlabs_stt": 20}
PER_IP_PER_MIN = 6
_l = threading.Lock(); run_lock = threading.Lock()
_hour = {k: collections.deque() for k in CAPS}; _ip = collections.defaultdict(collections.deque)
blocked = collections.Counter()
def _trim(d, window):
    now = time.time()
    while d and now - d[0] > window: d.popleft()
def take(api):
    """Consume one unit of an hourly cap; False if the cap is reached."""
    with _l:
        d = _hour[api]; _trim(d, 3600)
        if len(d) >= CAPS[api]: blocked[api] += 1; return False
        d.append(time.time()); return True
def ip_ok(ip):
    with _l:
        d = _ip[ip]; _trim(d, 60)
        if len(d) >= PER_IP_PER_MIN: blocked["per_ip"] += 1; return False
        d.append(time.time()); return True
def snapshot():
    with _l:
        for d in _hour.values(): _trim(d, 3600)
        return {"caps": {k: {"used_last_hour": len(_hour[k]), "cap_per_hour": CAPS[k]} for k in CAPS}, "per_ip_per_min": PER_IP_PER_MIN,
                "in_flight": run_lock.locked(), "blocked": dict(blocked)}
