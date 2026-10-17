import json, time, urllib.request

QS = [
    "Landlord liability for security deposit withholding under C.R.S. 38-12-103",
    "Water rights priority: senior appropriator call doctrine",
    "Water rights priority dispute between ranchers",
    "Statute of limitations for breach of written contract in Colorado",
    "Suppression of evidence from warrantless vehicle search",
    "Automobile exception: probable cause standard in Colorado",
    "Is a dog sniff at a traffic stop a search?",
    "Is a confession admissible if the suspect was not given Miranda warnings?",
    "Can a landlord evict a tenant without a court order?",
    "Bankruptcy exemption for a homestead",
]
qs = QS


def post(q):
    r = urllib.request.Request(
        "http://localhost:3000/api/ask", json.dumps({"question": q}).encode(), {"content-type": "application/json", "x-forwarded-for": "10.9.%d.1" % len(out)}
    )
    return json.load(urllib.request.urlopen(r))


out = []
for q in qs:
    try:
        rid = post(q)["run_id"]
    except Exception as e:
        print("ERR", q, e)
        time.sleep(3)
        continue
    for _ in range(60):
        time.sleep(1)
        try:
            res = json.load(urllib.request.urlopen("http://localhost:3000/api/run/" + rid))
        except Exception:
            continue
        if res.get("status") in ("done", "error") or res.get("result"):
            break
    out.append(rid)
    print(rid, q[:60])
json.dump(out, open("/tmp/arize_rids.json", "w"))
