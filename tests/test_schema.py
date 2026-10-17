"""Versioned data model: models validate, migrations apply in order, version is bumped whenever the schema changes."""

import json, pathlib, sys


ROOT = pathlib.Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))
from schema import SCHEMA_VERSION, MODELS, validate, fingerprint, migrate  # noqa: E402
from schema.store import SqliteStore  # noqa: E402


def test_models_validate():
    clip = {
        "key": "a" * 64,
        "text_sha": "b" * 64,
        "provider": "fish",
        "voice": "v",
        "text": "hi",
        "chars": [],
        "starts": [],
        "duration_s": 1.5,
        "bytes": 10,
        "created_at": "2026-10-17T00:00:00Z",
    }
    assert validate("tts_clip", clip) == []
    assert validate("tts_clip", dict(clip, provider=None))  # required field missing
    assert validate("tts_clip", dict(clip, duration_s="long"))  # wrong type
    step = {
        "run_id": "r1",
        "step_index": 0,
        "clip_key": "a" * 64,
        "text": "hi",
        "cite_ids": ["c1"],
        "refs": ["[1]"],
        "node_ids": ["c:denver"],
        "coords": [39.7, -105.0],
        "created_at": "2026-10-17T00:00:00Z",
    }
    assert validate("tour_step", step) == []
    assert validate("tour_step", dict(step, step_index="0"))
    assert set(MODELS) >= {"tts_clip", "tour_step", "schema_version"}


def test_migrations_numbered_and_match_version():
    nums = [m.number for m in migrate.discover()]
    assert nums == list(range(1, len(nums) + 1)), "migrations must be numbered 0001.. with no gaps"
    assert nums[-1] == SCHEMA_VERSION, "SCHEMA_VERSION must equal the newest migration number"


def test_migrations_apply_in_order_and_idempotent():
    s = SqliteStore(":memory:")
    assert migrate.current(s) == 0
    applied = migrate.apply(s)
    assert applied == list(range(1, SCHEMA_VERSION + 1))
    assert migrate.current(s) == SCHEMA_VERSION
    assert migrate.apply(s) == []  # nothing pending
    cols = {r["name"] for r in s.query("PRAGMA table_info(tts_clip)")}
    assert set(MODELS["tts_clip"]["fields"]) <= cols
    cols = {r["name"] for r in s.query("PRAGMA table_info(tour_step)")}
    assert set(MODELS["tour_step"]["fields"]) <= cols


def test_partial_store_gets_only_pending():
    s = SqliteStore(":memory:")
    assert migrate.apply(s, target=1) == [1]
    assert migrate.apply(s) == list(range(2, SCHEMA_VERSION + 1))


def test_version_bumped_when_schema_changes():
    lock = json.loads((ROOT / "schema" / "schema.lock.json").read_text())
    versions = [e["version"] for e in lock["history"]]
    assert versions == sorted(set(versions)), "one lock entry per version"
    last = lock["history"][-1]
    assert last["version"] == SCHEMA_VERSION, "schema changed? bump SCHEMA_VERSION, add a migration, run: python -m schema.lock"
    assert last["fingerprint"] == fingerprint(), "schema/models or migrations changed without a version bump; run: python -m schema.lock"
    for m in migrate.discover():  # applied migrations are immutable: add a new one instead of editing
        assert lock["migrations"][m.name] == m.sha256, f"{m.name} was edited after release"


def test_check_reports_mismatch():
    s = SqliteStore(":memory:")
    migrate.apply(s, target=1)
    st = migrate.status(s)
    assert st == {"repo": SCHEMA_VERSION, "store": 1, "ok": SCHEMA_VERSION == 1, "pending": list(range(2, SCHEMA_VERSION + 1))}
