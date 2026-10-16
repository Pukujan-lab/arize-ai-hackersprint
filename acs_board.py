"""Hackathon task board stored inside ACS (acs-adopter/.coord/hackathon), file-locked; events + OIO issue logs."""
import json, os, time, fcntl, pathlib, contextlib
ACS = pathlib.Path(os.environ.get("ACS_ROOT", os.path.expanduser("~/development/acs-adopter")))
H = ACS / ".coord" / "hackathon"; BOARD = H / "board.json"; EVENTS = H / "events.jsonl"; LOCK = H / "board.lock"
OIO_DIR = ACS / ".oio" / "issue-logs" / "hackathon"
def now(): return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
SEED = [
 ("HACK-01", "Presentation site polish (landing copy, screenshots, sponsor badges)", "P1"),
 ("HACK-02", "Arize tracing: set ARIZE_API_KEY/SPACE_ID, verify spans per agent", "P2"),
 ("HACK-03", "ElevenLabs voice: set ELEVENLABS_API_KEY, verify /api/tts + play button", "P2"),
 ("HACK-04", "Retrieval improvement for case law (seed cases, not just statutes)", "P1"),
 ("HACK-05", "Backup demo video (screen recording of 2-3 questions)", "P1"),
 ("HACK-06", "Slides: problem, architecture, safeguards (citation check + disclaimer), sponsors", "P1"),
 ("HACK-07", "Public preview link: make sandbox public / signed preview URL", "P0"),
 ("HACK-08", "Final submission form + README demo instructions (by 15:30 ET)", "P0"),
]
@contextlib.contextmanager
def locked():
    H.mkdir(parents=True, exist_ok=True)
    with open(LOCK, "w") as lk:
        fcntl.flock(lk, fcntl.LOCK_EX)
        d = json.loads(BOARD.read_text()) if BOARD.exists() else {"schema": "acs.hackathon.board.v1", "policy": ".coord/hackathon/HACKATHON_POLICY.md",
            "tasks": {t: {"title": ti, "priority": p, "status": "open", "owner": None, "history": []} for t, ti, p in SEED}}
        yield d
        d["updated_at"] = now(); tmp = BOARD.with_suffix(".tmp"); tmp.write_text(json.dumps(d, indent=2)); os.replace(tmp, BOARD)
def event(rec):
    rec = {"ts": now(), **rec}; H.mkdir(parents=True, exist_ok=True)
    with open(EVENTS, "a") as f:
        fcntl.flock(f, fcntl.LOCK_EX); f.write(json.dumps(rec) + "\n")
    return rec
def tasks():
    with locked() as d: return d
def claim(task, agent, force=False):
    with locked() as d:
        t = d["tasks"].get(task)
        if not t: raise KeyError(f"unknown task {task}")
        if t["owner"] and t["owner"] != agent and t["status"] == "claimed" and not force:
            raise PermissionError(f"{task} already claimed by {t['owner']}")
        t.update(owner=agent, status="claimed", claimed_at=now()); t["history"].append({"ts": now(), "agent": agent, "action": "claim"})
    event({"agent": agent, "kind": "task_claim", "task": task, "msg": f"{agent} claimed {task}"}); task_log(task, agent, "claim"); return t
def release(task, agent, status="done", note=""):
    with locked() as d:
        t = d["tasks"].get(task)
        if not t: raise KeyError(f"unknown task {task}")
        if t["owner"] not in (None, agent): raise PermissionError(f"{task} is owned by {t['owner']}")
        t.update(status=status, released_at=now(), note=note, owner=agent if status == "done" else None)
        t["history"].append({"ts": now(), "agent": agent, "action": f"release:{status}", "note": note})
    event({"agent": agent, "kind": "task_release", "task": task, "status": status, "msg": f"{agent} released {task} ({status}) {note}".strip()}); task_log(task, agent, status, note); return t
def add(task, title, priority="P2", agent="cli"):
    with locked() as d:
        d["tasks"].setdefault(task, {"title": title, "priority": priority, "status": "open", "owner": None, "history": []})
    event({"agent": agent, "kind": "task_add", "task": task, "msg": f"added {task}: {title}"})
def oio_record(name, consequence, affected, impact_band="low", likelihood="observed", origin="agent-initiated",
               evidence="supported", relation="supports", outcome="hackathon demo", extra_session=None, status=None):
    """Write an OIO issue-log record (schema oio.issue-log-record.v1) into ACS; validated if jsonschema is available."""
    rec = {"schema_version": "oio.issue-log-record.v1", "issue_type": "operational",
        "project": {"id": "Pukujan/agent-custom-setup", "repository": "Pukujan/agent-custom-setup"},
        "ontology": {"default_version": "1.1.0", "project_version": "1.0.0"},
        "filer": {"origin": origin, "authenticated_actor": "daytona-sandbox", "content_author": "legal-graphrag-demo",
                  "directing_human": "alex", "authorization_state": "claimed", "authorization_evidence": None,
                  "session_reference": extra_session, "destination_repository": "Pukujan/agent-custom-setup", "created_at": now()},
        "priority": {"status": "unresolved", "path": None, "concept_id": None},
        "impact": {"affected": affected, "consequence": consequence, "breadth": "hackathon demo only", "workaround": "none needed" if impact_band == "informational" else "see consequence",
                   "impact_band": impact_band, "likelihood": likelihood, "exposure": "limited-test-or-preview", "recoverability": "automatic-recovery",
                   "evidence_confidence": evidence, "unresolved_risk": "low; local demo", "change_risk": "low; additive log only"},
        "release_relevance": {"relation": relation, "product_outcome": outcome, "delay_cost": "none before 15:30 ET submission",
                              "smallest_useful_slice": "log only"},
        "lifecycle": {"status": status or ("open" if impact_band != "informational" else "resolved")}}
    try:
        import jsonschema
        jsonschema.validate(rec, json.loads((ACS / ".oio/schemas/v1/issue-log-record.schema.json").read_text()))
    except ImportError: pass
    OIO_DIR.mkdir(parents=True, exist_ok=True); p = OIO_DIR / f"{name}.json"; p.write_text(json.dumps(rec, indent=2)); return p

def log(topic, title, status="open", note="", agent="cli", impact_band=None):
    import re as _re
    slug = _re.sub(r"[^a-z0-9]+", "-", topic.lower()).strip("-")[:60]
    p = oio_record(f"log-{slug}", f"{title}. {note}".strip(), [f"hackathon:{topic}"], impact_band=impact_band or ("informational" if status == "resolved" else "low"),
                   origin="human-via-agent", status=status, extra_session=f"agent:{agent}")
    event({"agent": agent, "kind": "issue_log", "topic": topic, "status": status, "msg": f"issue log {p.name}: {title} [{status}]"}); return p
def task_log(task, agent, action, note=""):
    with locked() as d: t = d["tasks"].get(task, {})
    st = {"claim": "open", "done": "resolved", "open": "open", "blocked": "open"}.get(action, "open")
    oio_record(f"task-{task}", f"Task {task} ({t.get('title','')}): {action} by {agent}. {note}".strip(), [f"hackathon:{task}"],
               impact_band="informational" if st == "resolved" else "low", origin="human-via-agent", status=st, extra_session=f"agent:{agent}")
