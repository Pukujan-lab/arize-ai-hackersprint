"""TTS: provider chain + single-worker generation queue + two-layer clip cache + tour-step metadata.

Chain: Fish Audio -> (ElevenLabs if keyed) -> Kokoro (local HTTP service, tools/kokoro) -> browser speechSynthesis.
Queue: ONE worker generates clips, so a tour never fans out parallel Fish calls. Identical in-flight requests share a
       job. Priority: a clip the user is waiting for (0) > the first FAST_START tour steps (1) > the rest of the tour (2,
       in playback order).
Cache: every request checks the cache first, so each line hits a paid API at most once.
       L1 = local SQLite index + .mp3 files in TTS_CACHE_DIR (default .tts_cache/); L2 = the shared Octo workspace
       (managed Postgres, schema/ + migrations/). Clip key = sha256(provider|voice|text)."""

import base64, datetime, hashlib, heapq, itertools, os, pathlib, queue, threading, time
import httpx, limits
from schema import SCHEMA_VERSION, validate
from schema.store import OctoStore, SqliteStore, dumps, loads

ROOT = pathlib.Path(__file__).parent
FISH_URL = "https://api.fish.audio/v1/tts"
ELEVEN_DEFAULT_VOICE = "21m00Tcm4TlvDq8ikWAM"
FAST_START = 2  # tour steps generated on their own first so playback starts fast
PREF = {"fish": 0, "elevenlabs": 1, "kokoro": 2, "legacy": 3}


def _f(name, default):
    try:
        return float(os.environ.get(name, default))
    except ValueError:
        return float(default)


def _now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def cache_dir():
    d = pathlib.Path(os.environ.get("TTS_CACHE_DIR") or ROOT / ".tts_cache")
    d.mkdir(parents=True, exist_ok=True)
    return d


def kokoro_url():
    return (os.environ.get("KOKORO_URL") or "http://127.0.0.1:8880").rstrip("/")


def kokoro_voice():
    return os.environ.get("KOKORO_VOICE", "af_heart")


def _off(name):
    return os.environ.get(name, "") not in ("", "0")


def fish_on():
    return bool(os.environ.get("FISH_API_KEY")) and not _off("TTS_DISABLE_FISH")


def eleven_on():
    return bool(os.environ.get("ELEVENLABS_API_KEY")) and not _off("TTS_DISABLE_ELEVENLABS")


def kokoro_on():
    return not _off("TTS_DISABLE_KOKORO")


def voice_for(p):
    return {
        "fish": os.environ.get("FISH_VOICE_ID") or "fish",
        "elevenlabs": os.environ.get("ELEVENLABS_VOICE_ID", ELEVEN_DEFAULT_VOICE),
        "kokoro": kokoro_voice(),
    }.get(p, p)


def clip_key(text, voice, provider):
    return hashlib.sha256(f"{provider}|{voice}|{text}".encode()).hexdigest()


def text_sha(text):
    return hashlib.sha256(text.encode()).hexdigest()


_kh = {"t": 0.0, "up": False}


def kokoro_up():
    """Cheap liveness probe for /api/health, cached 15s."""
    if time.time() - _kh["t"] < 15:
        return _kh["up"]
    try:
        up = httpx.get(kokoro_url() + "/health", timeout=0.5).status_code == 200
    except Exception:
        up = False
    _kh.update(t=time.time(), up=up)
    return up


def chain():
    return [p for p, on in (("fish", fish_on()), ("elevenlabs", eleven_on()), ("kokoro", kokoro_on())) if on] + ["browser"]


# ---------------- providers: (result|None, reason); result = {audio, chars, starts, duration_s}
def _mp3_duration(b):
    """CBR estimate from the first MPEG audio frame header; None if it can't tell."""
    i = 0
    if b[:3] == b"ID3" and len(b) > 10:
        i = 10 + (((b[6] & 0x7F) << 21) | ((b[7] & 0x7F) << 14) | ((b[8] & 0x7F) << 7) | (b[9] & 0x7F))
    v1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
    v2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]
    while i + 4 <= len(b):
        if b[i] == 0xFF and (b[i + 1] & 0xE0) == 0xE0 and (b[i + 1] >> 1) & 3 == 1:
            bi, si = b[i + 2] >> 4, (b[i + 2] >> 2) & 3
            if 0 < bi < 15 and si != 3:
                return round((len(b) - i) * 8 / ((v1 if (b[i + 1] >> 3) & 3 == 3 else v2)[bi] * 1000), 3)
        i += 1
    return None


def _fish(text):
    if not fish_on():
        return None, "off"
    if not limits.take("fish_tts"):
        return None, "cap"
    try:
        r = httpx.post(
            FISH_URL,
            timeout=_f("FISH_TIMEOUT_S", 8),
            headers={"Authorization": "Bearer " + os.environ["FISH_API_KEY"], "Content-Type": "application/json", "model": "s2.1-pro-free"},
            json={"text": text, "reference_id": os.environ.get("FISH_VOICE_ID") or "", "format": "mp3"},
        )
    except Exception as e:
        return None, "error:" + type(e).__name__
    if r.status_code != 200 or not r.content:
        return None, "http:%d" % r.status_code
    return {"audio": r.content, "chars": [], "starts": [], "duration_s": _mp3_duration(r.content)}, "ok"  # client paces by currentTime/duration


def _eleven(text):
    if not eleven_on():
        return None, "off"
    if not limits.take("elevenlabs_tts"):
        return None, "cap"
    try:
        r = httpx.post(
            f"https://api.elevenlabs.io/v1/text-to-speech/{voice_for('elevenlabs')}/with-timestamps",
            timeout=_f("ELEVENLABS_TIMEOUT_S", 10),
            headers={"xi-api-key": os.environ["ELEVENLABS_API_KEY"]},
            json={"text": text, "model_id": "eleven_flash_v2_5"},
        )
        if r.status_code != 200:
            return None, "http:%d" % r.status_code
        j = r.json()
        al = j.get("alignment") or {}
        st = al.get("character_start_times_seconds", [])
        en = al.get("character_end_times_seconds") or []
        return {"audio": base64.b64decode(j["audio_base64"]), "chars": al.get("characters", []), "starts": st, "duration_s": en[-1] if en else None}, "ok"
    except Exception as e:
        return None, "error:" + type(e).__name__


def _kokoro(text):
    if not kokoro_on():
        return None, "off"
    if not limits.take("kokoro_tts"):
        return None, "cap"
    try:
        r = httpx.post(
            kokoro_url() + "/v1/audio/speech",
            timeout=_f("KOKORO_TIMEOUT_S", 10),
            json={"model": "kokoro", "input": text, "voice": kokoro_voice(), "response_format": "mp3"},
        )
    except Exception as e:
        return None, "error:" + type(e).__name__
    if r.status_code != 200 or not r.content:
        return None, "http:%d" % r.status_code
    try:
        dur = float(r.headers.get("X-Audio-Duration") or 0)
    except ValueError:
        dur = 0
    dur = dur or len(text) / 15.0
    n = max(len(text), 1)  # no word timings from Kokoro: spread characters evenly so captions keep pace
    return {"audio": r.content, "chars": list(text), "starts": [round(i * dur / n, 3) for i in range(len(text))], "duration_s": round(dur, 3)}, "ok"


PROVIDERS = {"fish": _fish, "elevenlabs": _eleven, "kokoro": _kokoro}


# ---------------- cache layers
_locals: dict = {}
_locals_l = threading.Lock()


def local():
    """L1 index: SQLite in the cache dir, same migrations as Octo."""
    from schema import migrate

    p = str(cache_dir() / "tts.sqlite")
    with _locals_l:
        if p not in _locals:
            s = SqliteStore(p)
            migrate.apply(s)
            _locals[p] = s
        return _locals[p]


_octo = {"ok": None, "t": 0.0, "down_until": 0.0, "status": None, "store": None}


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
    """Shared L2, or None when unconfigured, unreachable, or its schema version doesn't match this code."""
    if not os.environ.get("OCTO_API_KEY") or _off("TTS_OCTO_DISABLE") or time.time() < _octo["down_until"]:
        return None
    if _octo["ok"] is None or time.time() - _octo["t"] > 300:
        octo_check()
    return _octo["store"] if _octo["ok"] else None


def _octo_down():
    _octo["down_until"] = time.time() + 60


_oq: queue.Queue = queue.Queue()
_ow = {"t": None}


def _octo_writer():
    while True:
        store, sql, params = _oq.get()
        try:
            store.execute(sql, params)
        except Exception:
            _octo_down()
        finally:
            _oq.task_done()


def _octo_write(sql, params):
    s = octo_store()
    if not s:
        return
    if not _ow["t"]:
        _ow["t"] = threading.Thread(target=_octo_writer, daemon=True)
        _ow["t"].start()
    _oq.put((s, sql, params))


def flush_octo():
    _oq.join()


CLIP_COLS = ["key", "text_sha", "provider", "voice", "text", "chars", "starts", "duration_s", "bytes", "audio_b64", "created_at"]


def _clip_sql(cols):
    return "INSERT INTO tts_clip(%s) VALUES (%s) ON CONFLICT (key) DO NOTHING" % (", ".join(cols), ", ".join("$%d" % (i + 1) for i in range(len(cols))))


def _store_clip(text, provider, voice, res, to_octo=True):
    meta = {
        "key": clip_key(text, voice, provider),
        "text_sha": text_sha(text),
        "provider": provider,
        "voice": voice,
        "text": text,
        "chars": res.get("chars") or [],
        "starts": res.get("starts") or [],
        "duration_s": res.get("duration_s"),
        "bytes": len(res["audio"]),
        "created_at": _now(),
    }
    assert validate("tts_clip", meta) == [], validate("tts_clip", meta)
    (cache_dir() / (meta["key"] + ".mp3")).write_bytes(res["audio"])
    row = dict(meta, chars=dumps(meta["chars"]), starts=dumps(meta["starts"]))
    cols = CLIP_COLS[:-2] + ["created_at"]
    local().execute(_clip_sql(cols), [row[c] for c in cols])
    if to_octo:
        _octo_write(_clip_sql(CLIP_COLS), [row[c] for c in CLIP_COLS[:-2]] + [base64.b64encode(res["audio"]).decode(), row["created_at"]])
    return meta


def _clip(meta, audio, cache):
    return {
        "audio": audio,
        "chars": loads(meta.get("chars")) or [],
        "starts": loads(meta.get("starts")) or [],
        "duration_s": meta.get("duration_s"),
        "provider": meta["provider"],
        "key": meta["key"],
        "cache": cache,
    }


def _legacy(text):
    """Clips made before the chain existed live in cache/tts keyed by text|voice; reuse them instead of re-buying."""
    d = ROOT / "cache" / "tts"
    for voice in filter(None, (os.environ.get("FISH_VOICE_ID"), "fish", os.environ.get("ELEVENLABS_VOICE_ID", ELEVEN_DEFAULT_VOICE))):
        base = text if voice == ELEVEN_DEFAULT_VOICE else text + "|" + voice
        f = d / (hashlib.sha256(base.encode()).hexdigest()[:24] + ".mp3")
        if f.exists() and f.stat().st_size:
            return f
    return None


def lookup(text, meta_only=False):
    """L1 (local) -> legacy files -> L2 (Octo). Never calls a provider. Returns a clip dict or None."""
    ts = text_sha(text)
    rows = sorted(local().query("SELECT * FROM tts_clip WHERE text_sha = $1", [ts]), key=lambda r: PREF.get(r["provider"], 9))
    for r in rows:
        f = cache_dir() / (r["key"] + ".mp3")
        if f.exists():
            return _clip(r, None if meta_only else f.read_bytes(), "hit")
    old = _legacy(text)
    if old:
        m = _store_clip(text, "legacy", "legacy", {"audio": old.read_bytes(), "duration_s": _mp3_duration(old.read_bytes())})
        return _clip(m, None if meta_only else old.read_bytes(), "hit")
    o = octo_store()
    if o:
        try:
            rows = o.query("SELECT key, provider, voice, chars, starts, duration_s, audio_b64 FROM tts_clip WHERE text_sha = $1", [ts])
        except Exception:
            _octo_down()
            rows = []
        for r in sorted(rows, key=lambda r: PREF.get(r["provider"], 9)):
            if not r.get("audio_b64"):
                continue
            audio = base64.b64decode(r["audio_b64"])
            m = _store_clip(
                text,
                r["provider"],
                r.get("voice") or "",
                {"audio": audio, "chars": loads(r.get("chars")), "starts": loads(r.get("starts")), "duration_s": r.get("duration_s")},
                to_octo=False,
            )
            return _clip(m, None if meta_only else audio, "hit")
    return None


# ---------------- single-worker generation queue
class _Job:
    def __init__(self, text, prio):
        self.text, self.prio, self.running, self.done, self.result, self.hooks = text, prio, False, threading.Event(), None, []


_cv = threading.Condition()
_heap: list = []
_jobs: dict = {}
_seq = itertools.count()
_worker = {"t": None}


def _submit(text, prio, hook=None):
    with _cv:
        j = _jobs.get(text)
        if j is None:
            j = _jobs[text] = _Job(text, prio)
            heapq.heappush(_heap, (prio, next(_seq), text))
        elif prio < j.prio and not j.running:
            j.prio = prio
            heapq.heappush(_heap, (prio, next(_seq), text))
        if hook:
            j.hooks.append(hook)
        if not (_worker["t"] and _worker["t"].is_alive()):
            _worker["t"] = threading.Thread(target=_work, daemon=True, name="tts-worker")
            _worker["t"].start()
        _cv.notify_all()
        return j


def _work():
    while True:
        with _cv:
            while True:
                while not _heap:
                    _cv.wait()
                prio, _, text = heapq.heappop(_heap)
                j = _jobs.get(text)
                if j and not j.running and j.prio == prio:
                    break  # skip stale/duplicate heap entries
            j.running = True
        try:
            j.result = _generate(text)
        except Exception as e:
            j.result = (None, [{"provider": "queue", "result": "error:" + type(e).__name__}])
        for h in j.hooks:
            try:
                h(j.result[0])
            except Exception:
                pass
        with _cv:
            _jobs.pop(text, None)
            j.done.set()
            _cv.notify_all()


def wait_idle(timeout=30):
    with _cv:
        return _cv.wait_for(lambda: not _jobs, timeout)


def _generate(text):
    import stats

    hit = lookup(text)  # re-check: a prefetch or another box may have made it meanwhile
    if hit:
        return hit, []
    tried = []
    for name in chain()[:-1]:
        t0 = time.time()
        res, why = PROVIDERS[name](text)
        tried.append({"provider": name, "result": why, "ms": round((time.time() - t0) * 1000)})
        if res:
            stats.bump("tts_calls")
            stats.vlog("tts", len(text), False)
            m = _store_clip(text, name, voice_for(name), res)
            return dict(res, provider=name, key=m["key"], cache="miss"), tried
    return None, tried


def synth(text):
    """The clip for one line: cache first, else wait for the single worker (jumping the tour batch)."""
    import stats

    text = str(text or "")[:400]
    if not text.strip():
        return None, [{"provider": "none", "result": "empty"}]
    hit = lookup(text)
    if hit:
        stats.bump("tts_cache_hits")
        stats.vlog("tts", len(text), True)
        return hit, []
    j = _submit(text, 0)
    if not j.done.wait(_f("TTS_WAIT_S", 25)):
        return None, [{"provider": "queue", "result": "timeout"}]
    return j.result


# ---------------- tour steps (clip <-> sources / map linkage)
STEP_COLS = ["run_id", "step_index", "text", "clip_key", "provider", "duration_s", "cite_ids", "refs", "node_ids", "coords", "phase", "created_at"]
_STEP_SQL = "INSERT INTO tour_step(%s) VALUES (%s) ON CONFLICT (run_id, step_index) DO UPDATE SET " % (
    ", ".join(STEP_COLS),
    ", ".join("$%d" % (i + 1) for i in range(len(STEP_COLS))),
) + ", ".join(f"{c} = excluded.{c}" for c in STEP_COLS[2:])


def _lst(v):
    return [x for x in v if isinstance(x, (str, int, float)) and not isinstance(x, bool)][:20] if isinstance(v, list) else []


def _save_step(step, clip=None):
    rec = dict(step)
    if clip:
        rec.update(clip_key=clip["key"], provider=clip["provider"], duration_s=clip.get("duration_s"))
    assert validate("tour_step", {k: v for k, v in rec.items() if v is not None}) == []
    params = [dumps(rec.get(c)) if c in ("cite_ids", "refs", "node_ids", "coords") else rec.get(c) for c in STEP_COLS]
    local().execute(_STEP_SQL, params)
    _octo_write(_STEP_SQL, params)


def _view(rec):
    out = {c: (loads(rec.get(c)) if c in ("cite_ids", "refs", "node_ids", "coords") else rec.get(c)) for c in STEP_COLS if c != "created_at"}
    out["ready"] = bool(out.get("clip_key")) and (cache_dir() / (out["clip_key"] + ".mp3")).exists()
    return out


def prefetch(run_id, steps):
    """Queue a tour's clips: the first FAST_START steps on their own first, then the rest as a background batch in order."""
    run_id = str(run_id or "")[:120] or "adhoc"
    out = []
    for i, s in enumerate(sorted(steps[:60], key=lambda s: int(s.get("step_index", 0)))):
        text = str(s.get("text") or "")[:400]
        if not text.strip():
            continue
        phase = "fast" if i < FAST_START else "batch"
        step = {
            "run_id": run_id,
            "step_index": int(s.get("step_index", i)),
            "text": text,
            "cite_ids": _lst(s.get("cite_ids")),
            "refs": _lst(s.get("refs")),
            "node_ids": _lst(s.get("node_ids")),
            "coords": _lst(s.get("coords")) or None,
            "phase": phase,
            "created_at": _now(),
        }
        hit = lookup(text, meta_only=True)
        _save_step(step, hit)
        if not hit:
            _submit(text, 1 if phase == "fast" else 2, hook=lambda clip, st=step: clip and _save_step(st, clip))
        out.append(
            dict(step, clip_key=hit and hit["key"], provider=hit and hit["provider"], duration_s=hit and hit.get("duration_s"), ready=bool(hit), queued=not hit)
        )
    return {"run_id": run_id, "steps": out, "fast_start": FAST_START}


def tour(run_id):
    rows = local().query("SELECT * FROM tour_step WHERE run_id = $1 ORDER BY step_index", [run_id])
    if not rows and octo_store():
        try:
            rows = octo_store().query("SELECT * FROM tour_step WHERE run_id = $1 ORDER BY step_index", [run_id])
        except Exception:
            _octo_down()
    return {"run_id": run_id, "steps": [_view(r) for r in rows]}


def health():
    st = _octo["status"] or {"repo": SCHEMA_VERSION, "store": None, "ok": False}
    return {
        "tts": chain(),
        "fish": fish_on(),
        "kokoro": kokoro_on() and kokoro_up(),
        "tts_cache": {"local": True, "octo": bool(_octo["ok"]) and time.time() >= _octo["down_until"]},
        "data_schema": st,
    }
