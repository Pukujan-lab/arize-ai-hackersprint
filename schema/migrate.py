"""Numbered SQL migrations (migrations/NNNN_name.sql), applied in order; each records a schema_version row.

  python -m schema.migrate            # show repo vs Octo version
  python -m schema.migrate --apply    # apply pending migrations to Octo (deploy step)
SQL must run on both PostgreSQL (Octo) and SQLite (local layer, tests): TEXT/INTEGER/DOUBLE PRECISION, IF NOT EXISTS."""

import collections, datetime, hashlib, re, sys
from schema import SCHEMA_VERSION, ROOT
from schema.store import MissingTable

Migration = collections.namedtuple("Migration", "number name sql sha256")
DIR = ROOT / "migrations"


def discover():
    out = []
    for p in sorted(DIR.glob("*.sql")):
        m = re.match(r"(\d{4})_[a-z0-9_]+\.sql$", p.name)
        if not m:
            raise ValueError("bad migration name: " + p.name)
        sql = p.read_text()
        out.append(Migration(int(m.group(1)), p.name, sql, hashlib.sha256(sql.encode()).hexdigest()))
    return out


def current(store):
    try:
        rows = store.query("SELECT max(version) AS v FROM schema_version")
    except MissingTable:
        return 0
    return int((rows[0].get("v") if rows else 0) or 0)


def apply(store, target=None):
    target = SCHEMA_VERSION if target is None else target
    have = current(store)
    done = []
    for m in discover():
        if m.number <= have or m.number > target:
            continue
        store.script(m.sql)
        store.execute(
            "INSERT INTO schema_version(version, name, sha256, applied_at) VALUES ($1, $2, $3, $4) ON CONFLICT (version) DO NOTHING",
            [m.number, m.name, m.sha256, datetime.datetime.now(datetime.timezone.utc).isoformat()],
        )
        done.append(m.number)
    return done


def status(store):
    v = current(store)
    return {"repo": SCHEMA_VERSION, "store": v, "ok": v == SCHEMA_VERSION, "pending": [m.number for m in discover() if m.number > v]}


if __name__ == "__main__":
    from schema.store import OctoStore

    s = OctoStore.from_env(timeout=20)
    if not s:
        print("OCTO_API_KEY not set; nothing to migrate")
        sys.exit(0)
    if "--apply" in sys.argv:
        print("applied:", apply(s))
    st = status(s)
    print("schema:", st)
    sys.exit(0 if st["ok"] else 1)
