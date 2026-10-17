"""Record the schema fingerprint for SCHEMA_VERSION in schema/schema.lock.json (run after bumping the version)."""

import json, sys
from schema import SCHEMA_VERSION, ROOT, fingerprint
from schema import migrate

P = ROOT / "schema" / "schema.lock.json"
lock = json.loads(P.read_text()) if P.exists() else {"history": [], "migrations": {}}
fp = fingerprint()
for m in migrate.discover():
    if lock["migrations"].get(m.name, m.sha256) != m.sha256:
        sys.exit(f"{m.name} changed after release; add a new migration instead")
    lock["migrations"][m.name] = m.sha256
last = lock["history"][-1] if lock["history"] else None
if last and last["version"] == SCHEMA_VERSION and last["fingerprint"] != fp:
    sys.exit("schema changed: bump SCHEMA_VERSION (and add a migration) first")
if not last or last["version"] != SCHEMA_VERSION:
    lock["history"].append({"version": SCHEMA_VERSION, "fingerprint": fp})
P.write_text(json.dumps(lock, indent=2) + "\n")
print("schema.lock: version", SCHEMA_VERSION)
