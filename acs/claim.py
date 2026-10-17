#!/usr/bin/env python3
"""Teammate CLI for the ACS hackathon task board.
python3 -m acs.claim list | status
python3 -m acs.claim claim HACK-04 --agent bob-claude
python3 -m acs.claim release HACK-04 --agent bob-claude [--status done|blocked|open] [--note "..."]
python3 -m acs.claim log <task|topic> --title "..." --status open|resolved --note "..."
python3 -m acs.claim add HACK-09 "title" [--priority P1]
"""

import argparse, json, sys, pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))  # repo root, so `acs` imports
from acs import board as B

ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
ap.add_argument("cmd", choices=["list", "status", "claim", "release", "add", "log"])
ap.add_argument("task", nargs="?")
ap.add_argument("title", nargs="?")
ap.add_argument("--agent", default="anonymous")
ap.add_argument("--status", default="done")
ap.add_argument("--note", default="")
ap.add_argument("--priority", default="P2")
ap.add_argument("--title", default=None)
ap.add_argument("--force", action="store_true")
ap.add_argument("--json", action="store_true")
a = ap.parse_args()
try:
    if a.cmd in ("list", "status"):
        d = B.tasks()
        if a.json:
            print(json.dumps(d, indent=2))
            sys.exit()
        for k, t in sorted(d["tasks"].items()):
            if a.cmd == "status" and t["status"] == "open":
                continue
            print(f"{k:8} {t['priority']:3} {t['status']:8} {(t['owner'] or '-'):18} {t['title']}")
        if a.cmd == "status":
            print("\nrecent events:")
            ev = B.EVENTS.read_text().splitlines()[-8:] if B.EVENTS.exists() else []
            for l in ev:
                e = json.loads(l)
                print(f"  {e['ts']} {e.get('agent', '')}: {e.get('msg', '')}")
    elif a.cmd == "claim":
        B.claim(a.task, a.agent, a.force)
        print(f"OK {a.agent} claimed {a.task}")
    elif a.cmd == "release":
        B.release(a.task, a.agent, a.status, a.note)
        print(f"OK {a.task} -> {a.status}")
    elif a.cmd == "log":
        st = a.status if a.status in ("open", "resolved") else "open"
        print("OK wrote", B.log(a.task, a.title or a.task, st, a.note, a.agent))
    elif a.cmd == "add":
        B.add(a.task, a.title, a.priority, a.agent)
        print(f"OK added {a.task}")
except (KeyError, PermissionError) as e:
    print("ERROR:", e, file=sys.stderr)
    sys.exit(1)
