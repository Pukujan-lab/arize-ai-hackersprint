"""Convert the offline triage decision into an OIO issue-log record inside ACS."""

import json, re, sys, pathlib

sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))
import acs_board as B

txt = pathlib.Path(sys.argv[1]).read_text()
m = re.search(r"\{.*\}", txt, re.S)
dec = json.loads(m.group(0)) if m else {"skip": True, "labels": [], "warnings": ["no decision"]}
ev = json.loads(pathlib.Path(sys.argv[2]).read_text())
p = B.oio_record(
    f"triage-issue-{ev['issue']['number']}",
    f"Offline OIO triage of fake issue #{ev['issue']['number']} ('{ev['issue']['title']}'): skip={dec.get('skip')}, labels={','.join(dec.get('labels', []))[:600]}, warnings={','.join(dec.get('warnings', []))[:400]}",
    ["legal-graphrag-demo", "oio_triage (offline, GitHub API stubbed)"],
    impact_band="low",
    relation="supports",
)
B.event(
    {
        "agent": "triage",
        "kind": "triage_result",
        "msg": f"triage of issue #{ev['issue']['number']}: {len(dec.get('labels', []))} labels -> {p.name}",
        "record": str(p),
    }
)
print("[triage_to_oio] wrote", p)
