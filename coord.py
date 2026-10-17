"""ACS-style claim-file coordination + append-only agent event log."""

import json, time, fcntl, pathlib, os

ROOT = pathlib.Path(__file__).parent
CLAIM = ROOT / ".coord" / "assignment.json"


def _now():
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()) + "Z"


def _update(fn):
    CLAIM.parent.mkdir(exist_ok=True)
    with open(ROOT / ".coord" / "claim.lock", "w") as lk:
        fcntl.flock(lk, fcntl.LOCK_EX)
        d = json.loads(CLAIM.read_text()) if CLAIM.exists() else {"schema_version": "0.1.0", "project": "legal-graphrag-demo", "seats": {}}
        fn(d)
        d["updated_at"] = _now()
        tmp = CLAIM.with_suffix(".tmp")
        tmp.write_text(json.dumps(d, indent=2))
        os.replace(tmp, CLAIM)


class Run:
    def __init__(self, run_id):
        self.id = run_id
        self.dir = ROOT / "runs" / run_id
        self.dir.mkdir(parents=True, exist_ok=True)
        self.log = self.dir / "events.jsonl"

    def event(self, agent, kind, msg, **data):
        rec = {"ts": _now(), "t": time.time(), "run_id": self.id, "agent": agent, "kind": kind, "msg": msg, **data}
        with open(self.log, "a") as f:
            fcntl.flock(f, fcntl.LOCK_EX)
            f.write(json.dumps(rec) + "\n")
        try:
            import acs_board

            acs_board.event({"source": "demo-run", **rec})  # mirror into ACS
        except Exception:
            pass
        return rec

    def claim(self, agent, role):
        def f(d):
            d["seats"][agent] = {"role": role, "status": "working", "run_id": self.id, "claimed_at": _now()}

        _update(f)
        self.event(agent, "claim", f"{agent} claimed seat ({role})")

    def release(self, agent, status="done", handoff_to=None, summary=""):
        def f(d):
            s = d["seats"].setdefault(agent, {})
            s.update(status=status, released_at=_now(), handoff_to=handoff_to, summary=summary)

        _update(f)
        self.event(agent, "handoff" if handoff_to else "release", summary or status, to=handoff_to, status=status)

    def events(self):
        return [json.loads(l) for l in open(self.log)] if self.log.exists() else []
