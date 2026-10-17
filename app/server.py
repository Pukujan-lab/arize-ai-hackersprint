import re, json
import os, time, uuid, threading, pathlib, httpx, subprocess
from fastapi import FastAPI, Depends
from fastapi.responses import HTMLResponse, Response, JSONResponse
from app import contracts
from app import agents, tracing, limits, ttschain, octocache
from acs import board as acs_board
from app.coord import Run, CLAIM

ROOT = pathlib.Path(__file__).resolve().parent.parent  # repo root: static/, runs/, cache/ live here
app = FastAPI(title="Legal GraphRAG Agents")
from fastapi.staticfiles import StaticFiles

app.mount("/static", StaticFiles(directory=str(ROOT / "static")), name="static")
threading.Thread(target=agents.graph, daemon=True).start()


@app.get("/", response_class=HTMLResponse)
def index():
    return (ROOT / "static" / "index.html").read_text()


@app.get("/api/health", response_model=contracts.HealthResponse, response_model_exclude_unset=True)
def health():
    g = agents._G
    return {
        "ok": True,
        "backend": g.backend if g else "loading",
        "nodes": len(g.nodes) if g else 0,
        "anthropic": bool(os.environ.get("ANTHROPIC_API_KEY")),
        "elevenlabs": bool(os.environ.get("ELEVENLABS_API_KEY")),
        **ttschain.health(),
        "arize": tracing.enabled(),
        "sandbox": os.environ.get("DAYTONA_SANDBOX_ID", ""),
    }


from fastapi import Request

_recent_q: dict = {}
_inflight: dict = {}
_inflight_lock = threading.Lock()  # single-flight: normalized key -> run_id while running
_SID_RE = re.compile(r"[A-Za-z0-9-]{8,64}")


def _sid(request):
    s = (request.headers.get("x-session-id") or "").strip()
    return s if _SID_RE.fullmatch(s) else ""


def _run_sessions(rid):
    f = ROOT / "runs" / rid / "sessions.json"
    try:
        return set(json.loads(f.read_text()))
    except Exception:
        return set()


def _add_session(rid, sid):
    if not sid:
        return
    d = ROOT / "runs" / rid
    d.mkdir(parents=True, exist_ok=True)
    with _inflight_lock:
        ss = _run_sessions(rid)
        ss.add(sid)
        (d / "sessions.json").write_text(json.dumps(sorted(ss)))


def _rl_msg():
    return JSONResponse(
        {"error": "You're asking a bit fast - max %d questions per minute. Give it a few seconds and try again." % limits.ASK_PER_MIN, "rate_limited": True},
        429,
    )


@app.post("/api/ask", response_model=contracts.AskResponse, response_model_exclude_unset=True)
def ask(request: Request, q: dict = Depends(contracts.body(contracts.AskRequest))):
    question = " ".join(str(q.get("question", "")).split())[:500]
    if len(question) < 3:
        return JSONResponse({"error": "empty question"}, 400)
    sid = _sid(request)
    ip = request.headers.get("x-forwarded-for", request.client.host if request.client else "?").split(",")[0].strip()
    if not limits.ask_ok(sid, ip):
        return _rl_msg()
    prev_id = str(q.get("prev_run_id") or "")[:40]
    prev = None
    if prev_id and re.fullmatch(r"[\w-]+", prev_id) and (ROOT / "runs" / prev_id / "result.json").exists():
        if sid and sid not in _run_sessions(prev_id):
            return JSONResponse({"error": "follow-up refers to a run from another session"}, 403)
        prev = json.loads((ROOT / "runs" / prev_id / "result.json").read_text())
    key = re.sub(r"[^a-z0-9 ]", "", question.lower()).strip() + ("|" + prev_id if prev else "")
    dd = _recent_q.get(key)
    if dd and time.time() - dd[1] < 600 and (ROOT / "runs" / dd[0] / "result.json").exists():
        _add_session(dd[0], sid)
        return {"run_id": dd[0], "deduped": True}  # identical question: reuse the finished run
    with _inflight_lock:
        fl = _inflight.get(key)
    if fl:
        _add_session(fl, sid)
        return {"run_id": fl, "deduped": "inflight"}  # identical question running now: share it
    if not limits.run_lock.acquire(blocking=False):
        return JSONResponse({"error": "busy, try again in a few seconds"}, 429)
    with _inflight_lock:
        fl = _inflight.get(key)
        if fl:
            limits.run_lock.release()
        else:
            rid = time.strftime("%H%M%S-") + uuid.uuid4().hex[:6]
            _inflight[key] = rid
    if fl:
        _add_session(fl, sid)
        return {"run_id": fl, "deduped": "inflight"}
    _add_session(rid, sid or "anon")

    def job():
        try:
            limits.pipeline_runs += 1
            _run_and_log(question, rid, prev)
            try:
                _ok = not json.loads((ROOT / "runs" / rid / "result.json").read_text()).get("provider", "").startswith("template")
            except Exception:
                _ok = False
            if _ok:
                _recent_q[key] = (rid, time.time())  # never reuse a template fallback run
        finally:
            with _inflight_lock:
                _inflight.pop(key, None)
            limits.run_lock.release()

    threading.Thread(target=job, daemon=True).start()
    return {"run_id": rid}


@app.get("/api/run/{rid}", response_model=contracts.RunResponse, response_model_exclude_unset=True)
def run(rid: str):
    r = Run(rid)
    res = r.dir / "result.json"
    pf = r.dir / "partial.txt"
    return {
        "events": r.events(),
        "result": json.loads(res.read_text()) if res.exists() else None,
        "partial": pf.read_text() if (pf.exists() and not res.exists()) else None,
    }


@app.get("/api/seats", response_model=contracts.AnyObject)
def seats():
    return json.loads(CLAIM.read_text()) if CLAIM.exists() else {}


def _tts_fallback(tried):
    body = {"error": "tts unavailable", "fallback": "browser", "provider": "browser", "tried": tried}
    return JSONResponse(body, 429, headers={"X-TTS-Provider": "browser"})


@app.post("/api/tts", responses=contracts.AUDIO)
def tts(q: dict = Depends(contracts.body(contracts.TtsRequest))):
    """mp3 from the provider chain (Fish -> Kokoro); 429 {fallback:'browser'} tells the client to use speechSynthesis."""
    res, tried = ttschain.synth(q.get("text", ""))
    if not res:
        return _tts_fallback(tried)
    return Response(res["audio"], media_type="audio/mpeg", headers={"X-TTS-Cache": res["cache"], "X-TTS-Provider": res["provider"]})


@app.post("/api/tts_ts", response_model=contracts.TtsTsResponse, response_model_exclude_unset=True)
def tts_ts(q: dict = Depends(contracts.body(contracts.TtsRequest))):
    """JSON audio + per-character start times (real from ElevenLabs, even approximations from Kokoro, empty from Fish)."""
    import base64

    res, tried = ttschain.synth(q.get("text", ""))
    if not res:
        return _tts_fallback(tried)
    body = {
        "audio_b64": base64.b64encode(res["audio"]).decode(),
        "chars": res["chars"],
        "starts": res["starts"],
        "cache": res["cache"],
        "provider": res["provider"],
        "duration_s": res.get("duration_s"),
    }
    return JSONResponse(body, headers={"X-TTS-Cache": res["cache"], "X-TTS-Provider": res["provider"]})


@app.post("/api/tour/prefetch", response_model=contracts.TourResponse, response_model_exclude_unset=True)
def tour_prefetch(q: dict = Depends(contracts.body(contracts.TourPrefetchRequest))):
    """Queue a tour's narration: {run_id, steps:[{step_index, text, cite_ids, refs, node_ids, coords}]}; returns per-step metadata."""
    return ttschain.prefetch(q.get("run_id"), q.get("steps") or [])


@app.get("/api/tour/{run_id}", response_model=contracts.TourResponse, response_model_exclude_unset=True)
def tour_steps(run_id: str):
    """Per-step clip metadata (clip_key, provider, duration_s, cite_ids, refs, node_ids, coords, ready) for highlighting while a clip plays."""
    return ttschain.tour(run_id)


threading.Thread(target=octocache.octo_check, daemon=True).start()  # startup: Octo schema_version must match the repo


def _run_and_log(question, rid, prev=None):
    r = agents.run_pipeline(question, rid, prev)
    sg = r["safeguard"]
    rec = acs_board.oio_record(
        f"run-{rid}",
        f"Demo run {rid}: '{question[:200]}' -> safeguard {'PASS' if sg['pass'] else 'FAIL'}; {len(sg['used'])} citations used, invalid={sg['invalid']}, unknown={sg['unknown_authorities'][:5]}, model={r['provider']}, graph={r['backend']}",
        ["legal-graphrag-demo pipeline"],
        impact_band="informational" if sg["pass"] else "moderate",
        evidence="confirmed",
        extra_session=f"runs/{rid}/events.jsonl",
    )
    acs_board.event({"agent": "planner", "kind": "run_logged", "run_id": rid, "msg": f"run {rid} logged to ACS ({rec.name})"})


@app.get("/api/tasks", response_model=contracts.AnyObject)
def api_tasks():
    return acs_board.tasks()


@app.post("/api/claim", response_model=contracts.TaskResponse, response_model_exclude_unset=True)
def api_claim(q: dict = Depends(contracts.body(contracts.ClaimRequest))):
    try:
        return {"ok": True, "task": acs_board.claim(q["task"], q.get("agent", "remote-agent"), q.get("force", False))}
    except (KeyError, PermissionError) as e:
        return JSONResponse({"ok": False, "error": str(e)}, 409)


@app.post("/api/release", response_model=contracts.TaskResponse, response_model_exclude_unset=True)
def api_release(q: dict = Depends(contracts.body(contracts.ReleaseRequest))):
    try:
        return {"ok": True, "task": acs_board.release(q["task"], q.get("agent", "remote-agent"), q.get("status", "done"), q.get("note", ""))}
    except (KeyError, PermissionError) as e:
        return JSONResponse({"ok": False, "error": str(e)}, 409)


@app.get("/api/acs/events", response_model=contracts.EVENTS)
def api_acs_events(n: int = 50):
    return [json.loads(l) for l in acs_board.EVENTS.read_text().splitlines()[-n:]] if acs_board.EVENTS.exists() else []


@app.get("/dashboard", response_class=HTMLResponse)
def dashboard():
    return (ROOT / "static" / "dashboard.html").read_text()


@app.get("/slides", response_class=HTMLResponse)
def slides():
    return (ROOT / "static" / "slides.html").read_text()


def _agent_latency(rid):
    ev = Run(rid).events()
    start = {}
    out = {}
    for e in ev:
        if e["kind"] == "claim":
            start[e["agent"]] = e["t"]
        elif e["kind"] in ("release", "handoff") and e["agent"] in start:
            out[e["agent"]] = round((e["t"] - start[e["agent"]]) * 1000, 1)
    return out


def _sysctl(name):
    """stdout of `sysctl -n <name>` on macOS/BSD; None where there is no sysctl (Linux, containers, timeout)."""
    try:
        return subprocess.run(["sysctl", "-n", name], capture_output=True, text=True, timeout=2).stdout.strip() or None
    except Exception:
        return None


def _host_ram_gb():
    """(total, used) GB from the first source this host has: /proc/meminfo (kB), then hw.memsize + sysconf (bytes); None where nothing reads."""
    kib, gib = 1024.0**2, 1024.0**3
    try:
        mi = {l.split(":")[0]: int(l.split()[1]) for l in open("/proc/meminfo") if l.split(":")[0] in ("MemTotal", "MemAvailable")}
        if "MemTotal" in mi:
            return round(mi["MemTotal"] / kib), round((mi["MemTotal"] - mi.get("MemAvailable", 0)) / kib, 1)
    except Exception:
        pass
    total = None
    hw = _sysctl("hw.memsize")
    if hw:
        try:
            total = int(hw) / gib
        except ValueError:
            total = None
    avail = None
    try:
        page = os.sysconf("SC_PAGE_SIZE")
        if total is None:
            total = page * os.sysconf("SC_PHYS_PAGES") / gib
        avail = page * os.sysconf("SC_AVPHYS_PAGES") / gib
    except Exception:
        avail = None
    used = total - avail if (total is not None and avail is not None and avail <= total) else None
    return (round(total) if total is not None else None), (round(used, 1) if used is not None else None)


def _host_uptime_h():
    """Host uptime in hours: /proc/uptime, else macOS kern.boottime; None when neither can be read."""
    try:
        return round(float(open("/proc/uptime").read().split()[0]) / 3600.0, 2)
    except Exception:
        pass
    m = re.search(r"\{\s*sec\s*=\s*(\d+)", _sysctl("kern.boottime") or "")
    return round(max(0.0, time.time() - int(m.group(1))) / 3600.0, 2) if m else None


@app.get("/api/stack", response_model=contracts.AnyObject)
def stack():
    from app import stats

    S = dict(stats.S)
    g = agents._G
    runs = sorted((ROOT / "runs").glob("*/result.json"), key=lambda p: p.stat().st_mtime)
    recent = [json.loads(p.read_text()) for p in runs[-12:]]
    provs = [r.get("provider", "") for r in (json.loads(p.read_text()) for p in runs)]
    calls = json.loads((ROOT / "cache" / "_real_calls.json").read_text()) if (ROOT / "cache" / "_real_calls.json").exists() else {}
    ram_gb, ram_used_gb = _host_ram_gb()
    uptime_h = _host_uptime_h()
    board = acs_board.tasks()
    tasks = board["tasks"].values()
    issue_logs = len(list(acs_board.OIO_DIR.glob("*.json"))) if acs_board.OIO_DIR.exists() else 0
    ev = acs_board.EVENTS.read_text().splitlines() if acs_board.EVENTS.exists() else []
    arize_on = bool(os.environ.get("ARIZE_API_KEY") and os.environ.get("ARIZE_SPACE_ID"))
    return {
        "daytona": {
            "sandbox": os.environ.get("DAYTONA_SANDBOX_ID", "")[:8],
            "cpus": os.cpu_count(),
            "ram_gb": ram_gb,
            "ram_used_gb": ram_used_gb,
            "uptime_h": uptime_h,
            "server_uptime_min": round((time.time() - S["started"]) / 60, 1),
            "how": "Every agent, SurrealDB, CI and triage run inside one Daytona sandbox; served via Daytona preview.",
        },
        "surrealdb": {
            "nodes": len(g.nodes) if g else 0,
            "edges": 160793 if g and g.backend == "surrealdb" else 0,
            "backend": g.backend if g else "loading",
            "queries": S["surreal_queries"],
            "last_ms": S["surreal_last_ms"],
            "avg_ms": round(S["surreal_total_ms"] / S["surreal_queries"], 1) if S["surreal_queries"] else None,
            "how": "Citation graph as RELATE edges; ->cites / <-cites traversal expands Octo passages into authorities.",
        },
        "octo": {
            "searches": S["octo_searches"],
            "live": S["octo_live"],
            "snapshot": S["octo_snapshot"],
            "cache_hits": S["octo_cache_hits"],
            "last_source": S["octo_last_source"],
            "corpus": "804,646 passages (live) / 327,407 in sandbox snapshot",
            "how": "Full-text passage search over 45k Colorado + federal opinions seeds the graph.",
        },
        "model": {
            "real_calls": calls,
            "real_total": sum(calls.values()),
            "cached_answers": sum("cached" in p for p in provs),
            "template": sum(p.startswith("template") for p in provs),
            "runs": len(provs),
            "path": "InferHub DeepSeek > Anthropic claude-haiku-4-5 > template",
            "anthropic_key": bool(os.environ.get("ANTHROPIC_API_KEY")),
            "how": "One short Haiku call per new question, cached by prompt hash; template fallback is labeled.",
        },
        "elevenlabs": {
            "enabled": bool(os.environ.get("ELEVENLABS_API_KEY")),
            "tts_calls": S["tts_calls"],
            "cache_hits": S["tts_cache_hits"],
            "cached_files": len(list(ttschain.cache_dir().glob("*.mp3"))),
            "chain": ttschain.chain(),
            "how": "eleven_flash_v2_5 reads the short answer aloud; hands-free mode; audio cached by hash.",
        },
        "acs": {
            "tasks": len(board["tasks"]),
            "claimed": sum(t["status"] == "claimed" for t in tasks),
            "done": sum(t["status"] == "done" for t in board["tasks"].values()),
            "issue_logs": issue_logs,
            "events": len(ev),
            "recent": [json.loads(l).get("msg", "")[:90] for l in ev[-6:]],
            "how": "Agents claim seats, hand off and log every run as schema-valid OIO issue records.",
        },
        "arize": {
            "connected": arize_on and tracing.enabled(),
            "status": "Connected - tracing every agent span" if arize_on and tracing.enabled() else "Not connected - key pending",
            "spans_sent": S.get("arize_spans", 0),
            "how": "OpenTelemetry spans per agent via arize-otel; auto-on when keys appear.",
        },
        "limits": limits.snapshot(),
        "stt_calls": S.get("stt_calls", 0),
        "runs": [
            {
                "run_id": r["run_id"],
                "q": r["question"][:60],
                "elapsed_s": r["elapsed_s"],
                "pass": r["safeguard"]["pass"],
                "provider": r.get("provider"),
                "passages": r.get("passage_source"),
                "latency": _agent_latency(r["run_id"]),
            }
            for r in recent
        ],
    }


from fastapi import UploadFile, File


@app.post("/api/stt", response_model=contracts.SttResponse, response_model_exclude_unset=True)
async def stt(file: UploadFile = File(...)):
    key = os.environ.get("ELEVENLABS_API_KEY")
    if not key:
        return JSONResponse({"error": "ELEVENLABS_API_KEY not set"}, 503)
    data = await file.read()
    if len(data) > 2_000_000:
        return JSONResponse({"error": "audio too long"}, 413)
    if not limits.take("elevenlabs_stt"):
        return JSONResponse({"error": "STT hourly cap reached"}, 429)
    from app import stats

    stats.bump("stt_calls")
    stats.vlog("stt", len(data), False)
    r = httpx.post(
        "https://api.elevenlabs.io/v1/speech-to-text",
        timeout=60,
        headers={"xi-api-key": key},
        data={"model_id": "scribe_v1", "language_code": "en"},
        files={"file": (file.filename or "audio.webm", data, file.content_type or "audio/webm")},
    )
    if r.status_code != 200:
        return JSONResponse({"error": r.text[:200]}, 502)
    return {"text": r.json().get("text", "")}


@app.get("/api/limits", response_model=contracts.AnyObject)
def api_limits():
    return limits.snapshot()


@app.get("/api/sponsor", response_model=contracts.AnyObject)
def sponsor():
    import subprocess, socket
    from app import stats

    runs = sorted((ROOT / "runs").glob("*/result.json"), key=lambda p: p.stat().st_mtime)
    last = json.loads(runs[-1].read_text()) if runs else None
    spans = []
    if last:
        ev = Run(last["run_id"]).events()
        t0 = ev[0]["t"] if ev else 0
        start = {}
        for e in ev:
            if e["kind"] == "claim":
                start[e["agent"]] = e["t"]
            elif e["kind"] in ("release", "handoff") and e["agent"] in start:
                spans.append(
                    {"name": e["agent"], "start_ms": round((start[e["agent"]] - t0) * 1000, 1), "dur_ms": round((e["t"] - start[e["agent"]]) * 1000, 1)}
                )
            elif e["kind"] not in ("claim",):
                spans.append(
                    {"name": f"{e['agent']}.{e['kind']}", "start_ms": round((e["t"] - t0) * 1000, 1), "dur_ms": 0, "event": True, "msg": e["msg"][:90]}
                )

    def port(p):
        try:
            socket.create_connection(("127.0.0.1", p), 0.3).close()
            return True
        except OSError:
            return False

    try:
        sdk = subprocess.run(["pip", "show", "daytona"], capture_output=True, text=True, timeout=5).stdout.split("Version:")[1].split()[0]
    except Exception:
        sdk = "unknown"
    lock = {}
    try:
        lock = json.loads((acs_board.ACS / ".coord" / "hotload.lock.json").read_text())
    except Exception:
        pass
    board = acs_board.tasks()
    by_agent = {}
    for k, t in board["tasks"].items():
        for h in t.get("history", []):
            by_agent.setdefault(h["agent"], []).append(f"{k}:{h['action']}")
    logs = sorted(acs_board.OIO_DIR.glob("*.json"), key=lambda p: p.stat().st_mtime)[-25:] if acs_board.OIO_DIR.exists() else []
    ev = acs_board.EVENTS.read_text().splitlines()[-30:] if acs_board.EVENTS.exists() else []
    calls = json.loads((ROOT / "cache" / "_real_calls.json").read_text()) if (ROOT / "cache" / "_real_calls.json").exists() else {}
    return {
        "last_run": {k: last[k] for k in ("run_id", "question", "citations", "edges", "seeds", "provider", "passage_source", "elapsed_s")} if last else None,
        "surreal": {"queries": list(stats.QLOG)[-15:], "ns": "legal", "db": "graph", "tables": ["node", "cites", "part_of"]},
        "daytona": {
            "sandbox_id": os.environ.get("DAYTONA_SANDBOX_ID", ""),
            "sdk": sdk,
            "services": {"web :3000": port(3000), "surrealdb :8000": port(8000)},
            "preview": "https://3000-hpm8ocjo7sx9gya1.daytonaproxy01.net",
        },
        "acs": {
            "hotload_state": lock.get("state"),
            "hotload_installed": lock.get("installed_at"),
            "board": board["tasks"],
            "by_agent": by_agent,
            "issue_logs": [
                {
                    "name": p.stem,
                    "status": json.loads(p.read_text())["lifecycle"]["status"],
                    "consequence": json.loads(p.read_text())["impact"]["consequence"][:120],
                }
                for p in reversed(logs)
            ],
            "events": [json.loads(l) for l in ev],
        },
        "arize": {
            "connected": bool(os.environ.get("ARIZE_API_KEY") and os.environ.get("ARIZE_SPACE_ID")) and tracing.enabled(),
            "space_id": os.environ.get("ARIZE_SPACE_ID", ""),
            "spans": spans,
        },
        "elevenlabs": {"history": list(stats.VLOG)[-30:]},
        "model": {
            "calls": calls,
            "chain": ["inferhub/cb/deepseek-v4.1-flash (blocked from sandbox)", "anthropic/claude-haiku-4-5", "template (labeled)"],
            "cache_files": len([p for p in (ROOT / "cache").glob("*.json") if not p.name.startswith("_")]),
            "providers": [json.loads(p.read_text()).get("provider") for p in runs[-20:]],
        },
    }


@app.get("/map", response_class=HTMLResponse)
def map_page():
    return (ROOT / "static" / "map.html").read_text()


@app.get("/observability", response_class=HTMLResponse)
def observability_page():
    return (ROOT / "static" / "observability.html").read_text()


@app.get("/api/runs", response_model=contracts.RUNS, response_model_exclude_unset=True)
def runs_list(request: Request, n: int = 15):
    out = []
    sid = _sid(request)
    legacy = os.environ.get("RUNS_SHOW_LEGACY") == "1"
    for d in sorted((ROOT / "runs").iterdir(), key=lambda p: p.stat().st_mtime, reverse=True):
        f = d / "result.json"
        if not f.exists() or d.name.startswith(("test", "arize", "exp-")):
            continue
        ss = _run_sessions(d.name)
        if not ((sid and sid in ss) or (legacy and not ss)):
            continue
        try:
            r = json.loads(f.read_text())
        except Exception:
            continue
        out.append(
            {
                "run_id": d.name,
                "question": r.get("question", ""),
                "n": len(r.get("citations", [])),
                "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(f.stat().st_mtime)),
            }
        )
        if len(out) >= n:
            break
    return out


@app.get("/guide", response_class=HTMLResponse)
def guide_page():
    return (ROOT / "static" / "guide.html").read_text()


from app import seo

seo.install(app)

# ACS hot-loader: reload claims/config on change (no uvicorn --reload)
from acs import hotload as acs_hotload

acs_hotload.mount(app)
