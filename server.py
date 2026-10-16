import re, json
import os, json, time, uuid, threading, pathlib, httpx
from fastapi import FastAPI, Body
from fastapi.responses import HTMLResponse, Response, JSONResponse
import agents, tracing, acs_board, limits
from coord import Run, CLAIM
ROOT = pathlib.Path(__file__).parent
app = FastAPI(title="Legal GraphRAG Agents")
from fastapi.staticfiles import StaticFiles
app.mount("/static", StaticFiles(directory=str(ROOT / "static")), name="static")
threading.Thread(target=agents.graph, daemon=True).start()
@app.get("/", response_class=HTMLResponse)
def index(): return (ROOT / "static" / "index.html").read_text()
@app.get("/api/health")
def health():
    g = agents._G
    return {"ok": True, "backend": g.backend if g else "loading", "nodes": len(g.nodes) if g else 0,
            "anthropic": bool(os.environ.get("ANTHROPIC_API_KEY")), "elevenlabs": bool(os.environ.get("ELEVENLABS_API_KEY")),
            "arize": tracing.enabled(), "sandbox": os.environ.get("DAYTONA_SANDBOX_ID", "")}
from fastapi import Request
_recent_q = {}
@app.post("/api/ask")
def ask(request: Request, q: dict = Body(...)):
    question = " ".join(str(q.get("question", "")).split())[:500]
    if len(question) < 3: return JSONResponse({"error": "empty question"}, 400)
    prev_id = str(q.get("prev_run_id") or "")[:40]; prev = None
    if prev_id and re.fullmatch(r"[\w-]+", prev_id) and (ROOT / "runs" / prev_id / "result.json").exists():
        prev = json.loads((ROOT / "runs" / prev_id / "result.json").read_text())
    key = question.lower().strip(" ?.!") + ("|" + prev_id if prev else "")
    dd = _recent_q.get(key)
    if dd and time.time() - dd[1] < 600 and (ROOT / "runs" / dd[0] / "result.json").exists():
        return {"run_id": dd[0], "deduped": True}          # identical question: reuse the finished run
    ip = request.headers.get("x-forwarded-for", request.client.host if request.client else "?").split(",")[0].strip()
    if not limits.ip_ok(ip): return JSONResponse({"error": "rate limited: max %d questions/min, slow down" % limits.PER_IP_PER_MIN}, 429)
    if not limits.run_lock.acquire(blocking=False): return JSONResponse({"error": "busy, try again in a few seconds"}, 429)
    rid = time.strftime("%H%M%S-") + uuid.uuid4().hex[:6]
    def job():
        try:
            _run_and_log(question, rid, prev)
            try: _ok = not json.loads((ROOT / "runs" / rid / "result.json").read_text()).get("provider", "").startswith("template")
            except Exception: _ok = False
            if _ok: _recent_q[key] = (rid, time.time())   # never reuse a template fallback run
        finally: limits.run_lock.release()
    threading.Thread(target=job, daemon=True).start()
    return {"run_id": rid}
@app.get("/api/run/{rid}")
def run(rid: str):
    r = Run(rid); res = r.dir / "result.json"
    pf = r.dir / "partial.txt"
    return {"events": r.events(), "result": json.loads(res.read_text()) if res.exists() else None,
            "partial": pf.read_text() if (pf.exists() and not res.exists()) else None}
@app.get("/api/seats")
def seats(): return json.loads(CLAIM.read_text()) if CLAIM.exists() else {}
@app.post("/api/tts")
def tts(q: dict = Body(...)):
    key = os.environ.get("ELEVENLABS_API_KEY")
    if not key: return JSONResponse({"error": "ELEVENLABS_API_KEY not set"}, 503)
    import hashlib
    text = q["text"][:400]; f = ROOT / "cache" / "tts" / (hashlib.sha256(text.encode()).hexdigest()[:24] + ".mp3"); f.parent.mkdir(parents=True, exist_ok=True)
    import stats
    if f.exists(): stats.bump("tts_cache_hits"); stats.vlog("tts", len(text), True); return Response(f.read_bytes(), media_type="audio/mpeg", headers={"X-TTS-Cache": "hit"})
    if not limits.take("elevenlabs_tts"): return JSONResponse({"error": "TTS hourly cap reached", "fallback": "browser"}, 429)
    stats.bump("tts_calls"); stats.vlog("tts", len(text), False)
    voice = os.environ.get("ELEVENLABS_VOICE_ID", "21m00Tcm4TlvDq8ikWAM")
    r = httpx.post(f"https://api.elevenlabs.io/v1/text-to-speech/{voice}", timeout=60, headers={"xi-api-key": key},
                   json={"text": text, "model_id": "eleven_flash_v2_5"})
    if r.status_code != 200: return JSONResponse({"error": r.text[:200]}, 502)
    f.write_bytes(r.content); return Response(r.content, media_type="audio/mpeg", headers={"X-TTS-Cache": "miss"})

@app.post("/api/tts_ts")
def tts_ts(q: dict = Body(...)):
    """TTS with character alignment (ElevenLabs /with-timestamps), cached as JSON next to the mp3 cache."""
    import hashlib, base64, json as _j, stats
    key = os.environ.get("ELEVENLABS_API_KEY")
    text = q["text"][:400]; h = hashlib.sha256(text.encode()).hexdigest()[:24]
    d = ROOT / "cache" / "tts"; d.mkdir(parents=True, exist_ok=True); fj = d / (h + ".align.json"); fm = d / (h + ".mp3")
    if fj.exists():
        stats.bump("tts_cache_hits"); return _j.loads(fj.read_text())
    if key and limits.take("elevenlabs_tts"):
        voice = os.environ.get("ELEVENLABS_VOICE_ID", "21m00Tcm4TlvDq8ikWAM")
        try:
            r = httpx.post(f"https://api.elevenlabs.io/v1/text-to-speech/{voice}/with-timestamps", timeout=60, headers={"xi-api-key": key},
                           json={"text": text, "model_id": "eleven_flash_v2_5"})
            if r.status_code == 200:
                j = r.json(); al = j.get("alignment") or {}
                out = {"audio_b64": j["audio_base64"], "chars": al.get("characters", []), "starts": al.get("character_start_times_seconds", []), "cache": "miss"}
                stats.bump("tts_calls"); fm.write_bytes(base64.b64decode(j["audio_base64"]))
                fj.write_text(_j.dumps(dict(out, cache="hit"))); return out
        except Exception: pass
    if fm.exists():   # cached audio without alignment -> client paces by currentTime/duration
        return {"audio_b64": base64.b64encode(fm.read_bytes()).decode(), "chars": [], "starts": [], "cache": "audio-only"}
    return JSONResponse({"error": "tts unavailable", "fallback": "browser"}, 429)

def _run_and_log(question, rid, prev=None):
    r = agents.run_pipeline(question, rid, prev); sg = r["safeguard"]
    rec = acs_board.oio_record(f"run-{rid}", f"Demo run {rid}: '{question[:200]}' -> safeguard {'PASS' if sg['pass'] else 'FAIL'}; {len(sg['used'])} citations used, invalid={sg['invalid']}, unknown={sg['unknown_authorities'][:5]}, model={r['provider']}, graph={r['backend']}",
        ["legal-graphrag-demo pipeline"], impact_band="informational" if sg["pass"] else "moderate", evidence="confirmed", extra_session=f"runs/{rid}/events.jsonl")
    acs_board.event({"agent": "planner", "kind": "run_logged", "run_id": rid, "msg": f"run {rid} logged to ACS ({rec.name})"})
@app.get("/api/tasks")
def api_tasks(): return acs_board.tasks()
@app.post("/api/claim")
def api_claim(q: dict = Body(...)):
    try: return {"ok": True, "task": acs_board.claim(q["task"], q.get("agent", "remote-agent"), q.get("force", False))}
    except (KeyError, PermissionError) as e: return JSONResponse({"ok": False, "error": str(e)}, 409)
@app.post("/api/release")
def api_release(q: dict = Body(...)):
    try: return {"ok": True, "task": acs_board.release(q["task"], q.get("agent", "remote-agent"), q.get("status", "done"), q.get("note", ""))}
    except (KeyError, PermissionError) as e: return JSONResponse({"ok": False, "error": str(e)}, 409)
@app.get("/api/acs/events")
def api_acs_events(n: int = 50):
    return [json.loads(l) for l in acs_board.EVENTS.read_text().splitlines()[-n:]] if acs_board.EVENTS.exists() else []

from fastapi.responses import FileResponse
@app.get("/dashboard", response_class=HTMLResponse)
def dashboard(): return (ROOT / "static" / "dashboard.html").read_text()
@app.get("/slides", response_class=HTMLResponse)
def slides(): return (ROOT / "static" / "slides.html").read_text()
def _agent_latency(rid):
    ev = Run(rid).events(); start = {}; out = {}
    for e in ev:
        if e["kind"] == "claim": start[e["agent"]] = e["t"]
        elif e["kind"] in ("release", "handoff") and e["agent"] in start: out[e["agent"]] = round((e["t"] - start[e["agent"]]) * 1000, 1)
    return out
@app.get("/api/stack")
def stack():
    import stats, glob
    S = dict(stats.S); g = agents._G
    runs = sorted((ROOT / "runs").glob("*/result.json"), key=lambda p: p.stat().st_mtime)
    recent = [json.loads(p.read_text()) for p in runs[-12:]]
    provs = [r.get("provider", "") for r in (json.loads(p.read_text()) for p in runs)]
    calls = json.loads((ROOT / "cache" / "_real_calls.json").read_text()) if (ROOT / "cache" / "_real_calls.json").exists() else {}
    mem = {l.split(":")[0]: int(l.split()[1]) for l in open("/proc/meminfo") if l.split(":")[0] in ("MemTotal", "MemAvailable")}
    board = acs_board.tasks(); tasks = board["tasks"].values()
    issue_logs = len(list(acs_board.OIO_DIR.glob("*.json"))) if acs_board.OIO_DIR.exists() else 0
    ev = acs_board.EVENTS.read_text().splitlines() if acs_board.EVENTS.exists() else []
    arize_on = bool(os.environ.get("ARIZE_API_KEY") and os.environ.get("ARIZE_SPACE_ID"))
    return {
      "daytona": {"sandbox": os.environ.get("DAYTONA_SANDBOX_ID", "")[:8], "cpus": os.cpu_count(), "ram_gb": round(mem.get("MemTotal", 0) / 1048576),
                  "ram_used_gb": round((mem.get("MemTotal", 0) - mem.get("MemAvailable", 0)) / 1048576, 1),
                  "uptime_h": round(float(open("/proc/uptime").read().split()[0]) / 3600, 2), "server_uptime_min": round((time.time() - S["started"]) / 60, 1),
                  "how": "Every agent, SurrealDB, CI and triage run inside one Daytona sandbox; served via Daytona preview."},
      "surrealdb": {"nodes": len(g.nodes) if g else 0, "edges": 160793 if g and g.backend == "surrealdb" else 0, "backend": g.backend if g else "loading",
                    "queries": S["surreal_queries"], "last_ms": S["surreal_last_ms"], "avg_ms": round(S["surreal_total_ms"] / S["surreal_queries"], 1) if S["surreal_queries"] else None,
                    "how": "Citation graph as RELATE edges; ->cites / <-cites traversal expands Octo passages into authorities."},
      "octo": {"searches": S["octo_searches"], "live": S["octo_live"], "snapshot": S["octo_snapshot"], "cache_hits": S["octo_cache_hits"], "last_source": S["octo_last_source"],
               "corpus": "804,646 passages (live) / 327,407 in sandbox snapshot", "how": "Full-text passage search over 45k Colorado + federal opinions seeds the graph."},
      "model": {"real_calls": calls, "real_total": sum(calls.values()), "cached_answers": sum("cached" in p for p in provs), "template": sum(p.startswith("template") for p in provs),
                "runs": len(provs), "path": "InferHub DeepSeek > Anthropic claude-haiku-4-5 > template", "anthropic_key": bool(os.environ.get("ANTHROPIC_API_KEY")),
                "how": "One short Haiku call per new question, cached by prompt hash; template fallback is labeled."},
      "elevenlabs": {"enabled": bool(os.environ.get("ELEVENLABS_API_KEY")), "tts_calls": S["tts_calls"], "cache_hits": S["tts_cache_hits"],
                     "cached_files": len(list((ROOT / "cache" / "tts").glob("*.mp3"))) if (ROOT / "cache" / "tts").exists() else 0,
                     "how": "eleven_flash_v2_5 reads the short answer aloud; hands-free mode; audio cached by hash."},
      "acs": {"tasks": len(board["tasks"]), "claimed": sum(t["status"] == "claimed" for t in tasks), "done": sum(t["status"] == "done" for t in board["tasks"].values()),
              "issue_logs": issue_logs, "events": len(ev), "recent": [json.loads(l).get("msg", "")[:90] for l in ev[-6:]],
              "how": "Agents claim seats, hand off and log every run as schema-valid OIO issue records."},
      "arize": {"connected": arize_on and tracing.enabled(), "status": "Connected - tracing every agent span" if arize_on and tracing.enabled() else "Not connected - key pending",
                "spans_sent": S.get("arize_spans", 0), "how": "OpenTelemetry spans per agent via arize-otel; auto-on when keys appear."},
      "limits": limits.snapshot(), "stt_calls": S.get("stt_calls", 0),
      "runs": [{"run_id": r["run_id"], "q": r["question"][:60], "elapsed_s": r["elapsed_s"], "pass": r["safeguard"]["pass"], "provider": r.get("provider"),
                "passages": r.get("passage_source"), "latency": _agent_latency(r["run_id"])} for r in recent],
    }

from fastapi import UploadFile, File
@app.post("/api/stt")
async def stt(file: UploadFile = File(...)):
    key = os.environ.get("ELEVENLABS_API_KEY")
    if not key: return JSONResponse({"error": "ELEVENLABS_API_KEY not set"}, 503)
    data = await file.read()
    if len(data) > 2_000_000: return JSONResponse({"error": "audio too long"}, 413)
    if not limits.take("elevenlabs_stt"): return JSONResponse({"error": "STT hourly cap reached"}, 429)
    import stats; stats.bump("stt_calls"); stats.vlog("stt", len(data), False)
    r = httpx.post("https://api.elevenlabs.io/v1/speech-to-text", timeout=60, headers={"xi-api-key": key},
                   data={"model_id": "scribe_v1", "language_code": "en"}, files={"file": (file.filename or "audio.webm", data, file.content_type or "audio/webm")})
    if r.status_code != 200: return JSONResponse({"error": r.text[:200]}, 502)
    return {"text": r.json().get("text", "")}
@app.get("/api/limits")
def api_limits(): return limits.snapshot()

@app.get("/api/sponsor")
def sponsor():
    import stats, subprocess, socket
    runs = sorted((ROOT / "runs").glob("*/result.json"), key=lambda p: p.stat().st_mtime)
    last = json.loads(runs[-1].read_text()) if runs else None
    spans = []
    if last:
        ev = Run(last["run_id"]).events(); t0 = ev[0]["t"] if ev else 0; start = {}
        for e in ev:
            if e["kind"] == "claim": start[e["agent"]] = e["t"]
            elif e["kind"] in ("release", "handoff") and e["agent"] in start:
                spans.append({"name": e["agent"], "start_ms": round((start[e["agent"]] - t0) * 1000, 1), "dur_ms": round((e["t"] - start[e["agent"]]) * 1000, 1)})
            elif e["kind"] not in ("claim",): spans.append({"name": f"{e['agent']}.{e['kind']}", "start_ms": round((e["t"] - t0) * 1000, 1), "dur_ms": 0, "event": True, "msg": e["msg"][:90]})
    def port(p):
        try: socket.create_connection(("127.0.0.1", p), 0.3).close(); return True
        except OSError: return False
    try: sdk = subprocess.run(["pip", "show", "daytona"], capture_output=True, text=True, timeout=5).stdout.split("Version:")[1].split()[0]
    except Exception: sdk = "unknown"
    lock = {}
    try: lock = json.loads((acs_board.ACS / ".coord" / "hotload.lock.json").read_text())
    except Exception: pass
    board = acs_board.tasks(); by_agent = {}
    for k, t in board["tasks"].items():
        for h in t.get("history", []): by_agent.setdefault(h["agent"], []).append(f"{k}:{h['action']}")
    logs = sorted(acs_board.OIO_DIR.glob("*.json"), key=lambda p: p.stat().st_mtime)[-25:] if acs_board.OIO_DIR.exists() else []
    ev = acs_board.EVENTS.read_text().splitlines()[-30:] if acs_board.EVENTS.exists() else []
    calls = json.loads((ROOT / "cache" / "_real_calls.json").read_text()) if (ROOT / "cache" / "_real_calls.json").exists() else {}
    return {
      "last_run": {k: last[k] for k in ("run_id", "question", "citations", "edges", "seeds", "provider", "passage_source", "elapsed_s")} if last else None,
      "surreal": {"queries": list(stats.QLOG)[-15:], "ns": "legal", "db": "graph", "tables": ["node", "cites", "part_of"]},
      "daytona": {"sandbox_id": os.environ.get("DAYTONA_SANDBOX_ID", ""), "sdk": sdk, "services": {"web :3000": port(3000), "surrealdb :8000": port(8000)},
                  "preview": "https://3000-hpm8ocjo7sx9gya1.daytonaproxy01.net"},
      "acs": {"hotload_state": lock.get("state"), "hotload_installed": lock.get("installed_at"), "board": board["tasks"], "by_agent": by_agent,
              "issue_logs": [{"name": p.stem, "status": json.loads(p.read_text())["lifecycle"]["status"], "consequence": json.loads(p.read_text())["impact"]["consequence"][:120]} for p in reversed(logs)],
              "events": [json.loads(l) for l in ev]},
      "arize": {"connected": bool(os.environ.get("ARIZE_API_KEY") and os.environ.get("ARIZE_SPACE_ID")) and tracing.enabled(),
                "space_id": os.environ.get("ARIZE_SPACE_ID", ""), "spans": spans},
      "elevenlabs": {"history": list(stats.VLOG)[-30:]},
      "model": {"calls": calls, "chain": ["inferhub/cb/deepseek-v4.1-flash (blocked from sandbox)", "anthropic/claude-haiku-4-5", "template (labeled)"],
                "cache_files": len([p for p in (ROOT / "cache").glob("*.json") if not p.name.startswith("_")]),
                "providers": [json.loads(p.read_text()).get("provider") for p in runs[-20:]]},
    }

@app.get("/map", response_class=HTMLResponse)
def map_page(): return (ROOT / "static" / "map.html").read_text()
@app.get("/observability", response_class=HTMLResponse)
def observability_page(): return (ROOT / "static" / "observability.html").read_text()
@app.get("/api/runs")
def runs_list(n: int = 15):
    out = []
    for d in sorted((ROOT / "runs").iterdir(), key=lambda p: p.stat().st_mtime, reverse=True):
        f = d / "result.json"
        if not f.exists() or d.name.startswith(("test","arize","exp-")): continue
        try: r = json.loads(f.read_text())
        except Exception: continue
        out.append({"run_id": d.name, "question": r.get("question", ""), "n": len(r.get("citations", [])), "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(f.stat().st_mtime))})
        if len(out) >= n: break
    return out
@app.get("/guide", response_class=HTMLResponse)
def guide_page(): return (ROOT / "static" / "guide.html").read_text()
