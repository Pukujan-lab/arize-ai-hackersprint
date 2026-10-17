"""Versioned data model for the TTS clip cache and tour-step metadata.

Stored in two places with the same migrations: the local fast layer (SQLite in .tts_cache/) and the shared
Octo workspace (managed PostgreSQL, via its SQL-over-HTTP API). Changing MODELS or adding a migration needs:
bump SCHEMA_VERSION, add migrations/NNNN_name.sql, run `python -m schema.lock`. CI (tests/test_schema.py) enforces it."""

import hashlib, json, pathlib

SCHEMA_VERSION = 3

# field -> (type, required). Types: str, int, num, list. Lists are stored as JSON text so the SQL stays portable.
MODELS = {
    "schema_version": {
        "table": "schema_version",
        "fields": {"version": ("int", True), "name": ("str", True), "sha256": ("str", True), "applied_at": ("str", True)},
    },
    "tts_clip": {
        "table": "tts_clip",
        "key": ["key"],
        "fields": {
            "key": ("str", True),  # sha256(provider|voice|text)
            "text_sha": ("str", True),  # sha256(text): lookup without knowing which provider made it
            "provider": ("str", True),
            "voice": ("str", False),
            "text": ("str", True),
            "chars": ("list", False),
            "starts": ("list", False),  # per-char timings (real or evenly approximated)
            "duration_s": ("num", False),
            "bytes": ("int", False),
            "audio_b64": ("str", False),  # mp3, base64; only in the shared Octo layer (local layer keeps .mp3 files)
            "created_at": ("str", True),
        },
    },
    "tour_step": {
        "table": "tour_step",
        "key": ["run_id", "step_index"],
        "fields": {
            "run_id": ("str", True),
            "step_index": ("int", True),
            "text": ("str", True),
            "clip_key": ("str", False),
            "provider": ("str", False),
            "duration_s": ("num", False),
            "cite_ids": ("list", False),
            "refs": ("list", False),  # sources this narration talks about
            "node_ids": ("list", False),
            "coords": ("list", False),  # map pin key(s) and [lat, lon]
            "phase": ("str", False),  # fast | batch (generation order)
            "created_at": ("str", True),
        },
    },
    "llm_answer": {
        "table": "llm_answer",
        "key": ["key"],
        "fields": {
            "key": ("str", True),  # sha256(system\nprompt\nmax_tokens), same as the local cache/<key>.json
            "text": ("str", True),
            "provider": ("str", True),  # e.g. inferhub/cb/deepseek-v4.1-flash; template/empty answers are never stored
            "max_tokens": ("int", False),
            "run_id": ("str", False),  # run that first produced it (all users: run_cache_link)
            "created_at": ("str", True),
        },
    },
    "retrieval": {
        "table": "retrieval",
        "key": ["key"],
        "fields": {
            "key": ("str", True),  # sha256(lower(strip(question)))[:24], same as cache/octo/<key>.json
            "query": ("str", False),
            "source": ("str", True),  # octo-live | octo-snapshot
            "passages": ("list", True),
            "n": ("int", False),
            "run_id": ("str", False),
            "created_at": ("str", True),
        },
    },
    "run_cache_link": {
        "table": "run_cache_link",
        "key": ["run_id", "kind", "key"],
        "fields": {
            "run_id": ("str", True),
            "kind": ("str", True),  # answer | retrieval
            "key": ("str", True),
            "hit": ("int", True),  # 1 = served from cache, 0 = computed by this run
            "created_at": ("str", True),
        },
    },
}
_T = {"str": (str,), "int": (int,), "num": (int, float), "list": (list,)}


def validate(model, rec):
    """Return a list of problems ([] = valid)."""
    errs = []
    for f, (t, req) in MODELS[model]["fields"].items():
        v = rec.get(f)
        if v is None:
            if req:
                errs.append(f"{f}: required")
            continue
        if isinstance(v, bool) or not isinstance(v, _T[t]):
            errs.append(f"{f}: expected {t}, got {type(v).__name__}")
    errs += [f"{f}: unknown field" for f in rec if f not in MODELS[model]["fields"]]
    return errs


def fingerprint():
    from schema import migrate

    h = hashlib.sha256(json.dumps(MODELS, sort_keys=True).encode())
    for m in migrate.discover():
        h.update((m.name + ":" + m.sha256).encode())
    return h.hexdigest()


ROOT = pathlib.Path(__file__).resolve().parent.parent
