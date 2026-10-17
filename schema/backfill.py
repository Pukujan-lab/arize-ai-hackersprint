"""One-shot (idempotent) sync of the local LLM answer + retrieval caches into Octo, purging stale entries on the way.

  python -m schema.backfill        # run by deploy after `schema.migrate --apply`
Stale = empty / template / reasoning-only / pre-PR #5 answers and empty retrievals. Local stale files are moved to
cache/_purged/ (reversible); stale Octo rows are deleted. Never touches TTS tables."""

import json, pathlib, sys
from schema import ROOT

STALE_SQL = (
    "DELETE FROM llm_answer WHERE trim(text) = '' OR provider LIKE 'template%' OR provider = 'inferhub/deepseek' "
    "OR (text LIKE '<think>%' AND text NOT LIKE '%</think>%')"
)


def _load(f):
    try:
        return json.loads(f.read_text())
    except Exception:
        return None


def _purge(f, purged):
    purged.mkdir(exist_ok=True)
    f.rename(purged / f.name)


def _missing(store, table, key):
    return not store.query(f"SELECT key FROM {table} WHERE key = $1", [key])


def run(store, llm_dir, octo_dir):
    from app import llm, octocache

    out = {"answers": 0, "retrievals": 0, "purged_local": 0, "purged_octo": 0}
    purged = pathlib.Path(llm_dir) / "_purged"
    for f in sorted(pathlib.Path(llm_dir).glob("*.json")):
        if f.name.startswith("_"):
            continue
        d = _load(f)
        if not isinstance(d, dict) or "text" not in d or llm.stale(d):
            _purge(f, purged)
            out["purged_local"] += 1
        elif _missing(store, "llm_answer", f.stem):
            store.execute(
                "INSERT INTO llm_answer(key, text, provider, created_at) VALUES ($1, $2, $3, $4) ON CONFLICT (key) DO NOTHING",
                [f.stem, d["text"], d["provider"], octocache.now()],
            )
            out["answers"] += 1
    for f in sorted(pathlib.Path(octo_dir).glob("*.json")):
        d = _load(f)
        if not isinstance(d, dict) or not d.get("passages"):
            _purge(f, purged)
            out["purged_local"] += 1
        elif _missing(store, "retrieval", f.stem):
            store.execute(
                "INSERT INTO retrieval(key, source, passages, n, created_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (key) DO NOTHING",
                [f.stem, d.get("source") or "octo-live", json.dumps(d["passages"]), len(d["passages"]), octocache.now()],
            )
            out["retrievals"] += 1
    out["purged_octo"] = (store.execute(STALE_SQL) or 0) + (store.execute("DELETE FROM retrieval WHERE passages = '[]' OR passages = ''") or 0)
    return out


if __name__ == "__main__":
    from schema import migrate
    from schema.store import OctoStore

    s = OctoStore.from_env(timeout=20)
    if not s:
        print("OCTO_API_KEY not set; nothing to sync")
        sys.exit(0)
    if not migrate.status(s)["ok"]:
        sys.exit("Octo schema not at repo version; run `python -m schema.migrate --apply` first")
    print("backfill:", run(s, ROOT / "cache", ROOT / "cache" / "octo"))
