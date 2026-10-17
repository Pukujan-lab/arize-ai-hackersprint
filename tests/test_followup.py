"""Follow-up must run the full pipeline and return a real (non-template) short answer. Live server, ~15s, 1 LLM call."""

import json, time, urllib.request, os

BASE = os.environ.get("BASE", "http://localhost:3000")


def _post(p, b):
    return json.load(urllib.request.urlopen(urllib.request.Request(BASE + p, json.dumps(b).encode(), {"content-type": "application/json"})))


def _wait(rid, t=60):
    for _ in range(t):
        r = json.load(urllib.request.urlopen(BASE + "/api/run/" + rid))["result"]
        if r:
            return r
        time.sleep(1)


def test_followup_real_short_answer():
    runs = json.load(urllib.request.urlopen(BASE + "/api/runs"))
    prev_id = next(x["run_id"] for x in runs if "template" not in (_wait(x["run_id"], 1) or {}).get("provider", "template"))
    r = _wait(_post("/api/ask", {"question": "Can I refuse a search? (%d)" % time.time(), "prev_run_id": prev_id})["run_id"])
    a = r["answer"]
    assert "template" not in r["provider"], r["provider"]
    assert "**Short answer:**" in a and "most relevant authorities retrieved" not in a
    assert "[" in a.split("\n")[0]  # cited
