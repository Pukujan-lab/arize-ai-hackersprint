"""Repo manifest and agent contracts: every top-level entry is declared in repo.manifest.json, every contract under
contracts/agents/ is valid and points at real code and declared stores, and code only writes to declared paths."""

import ast
import json
import os
import pathlib
import re
import subprocess
import sys
import threading

import pytest

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
os.environ.setdefault("LLM_MODE", "fake")
os.environ["ACS_HOTLOAD"] = "0"

MANIFEST = json.loads((ROOT / "repo.manifest.json").read_text())
STORAGE = json.loads((ROOT / "contracts" / "storage.json").read_text())
SCHEMA = json.loads((ROOT / "contracts" / "agents" / "agent-contract.schema.json").read_text())
SCHEMA_NAME = "agent-contract.schema.json"
CONTRACTS = {p.name: json.loads(p.read_text()) for p in sorted((ROOT / "contracts" / "agents").glob("*.json")) if p.name != SCHEMA_NAME}
DECLARED = {e["path"].rstrip("/") for e in MANIFEST["entries"]}
RUNTIME = {r["path"].rstrip("/") for r in MANIFEST["runtime_paths"]}
WRITES = MANIFEST["runtime_writes"]
STORE_IDS = {s["id"] for s in STORAGE["stores"]}
OWN_CODE = (
    sorted((ROOT / "app").glob("*.py"))
    + sorted((ROOT / "schema").glob("*.py"))
    + [ROOT / "acs" / f for f in ("board.py", "claim.py", "hotload.py")]
    + [ROOT / "server.py"]
)


def _git_top_level():
    out = subprocess.run(["git", "ls-files", "--cached", "--others", "--exclude-standard"], cwd=ROOT, capture_output=True, text=True, check=True).stdout
    return {line.split("/", 1)[0] for line in out.splitlines() if line}


def _declared_write(rel):
    return any(rel == w.rstrip("/") or (w.endswith("/") and rel.startswith(w)) for w in WRITES)


def test_manifest_shape():
    assert MANIFEST["schema_version"] == "precedent.repo-manifest.v1"
    owners = set(MANIFEST["owners"])
    for e in MANIFEST["entries"]:
        assert {"path", "kind", "owner", "purpose", "agents_may_edit", "runtime_data"} <= set(e), e.get("path")
        assert e["owner"] in owners and e["kind"] in ("dir", "file") and isinstance(e["agents_may_edit"], bool), e["path"]
        target = ROOT / e["path"]
        assert target.is_dir() if e["kind"] == "dir" else target.is_file(), f"manifest lists missing {e['path']}"
    for r in MANIFEST["runtime_paths"]:
        assert r["in_git"] is False


def test_every_top_level_entry_is_in_the_manifest():
    missing = sorted(_git_top_level() - DECLARED - RUNTIME)
    assert not missing, f"add these to repo.manifest.json (entries or runtime_paths): {missing}"


def test_runtime_paths_are_ignored_by_git():
    for p in RUNTIME:
        r = subprocess.run(["git", "check-ignore", "-q", "--no-index", (p + "/x") if not p.endswith(".log") else p], cwd=ROOT)
        assert r.returncode == 0, f"{p} is a runtime path but .gitignore does not cover it"


def _validate(instance, schema, where):
    """Small JSON Schema subset (type/const/enum/required/properties/additionalProperties/items/pattern/minLength); no extra deps."""
    t = schema.get("type")
    types = {"object": dict, "array": list, "string": str, "boolean": bool, "null": type(None), "number": (int, float), "integer": int}
    if t is not None:
        allowed = t if isinstance(t, list) else [t]
        assert any(isinstance(instance, types[x]) for x in allowed), f"{where}: expected {t}"
    if "const" in schema:
        assert instance == schema["const"], f"{where}: expected {schema['const']!r}"
    if "enum" in schema:
        assert instance in schema["enum"], f"{where}: {instance!r} not in {schema['enum']}"
    if isinstance(instance, str):
        if "pattern" in schema:
            assert re.search(schema["pattern"], instance), f"{where}: {instance!r} !~ {schema['pattern']}"
        assert len(instance) >= schema.get("minLength", 0), f"{where}: too short"
    if isinstance(instance, dict):
        for k in schema.get("required", []):
            assert k in instance, f"{where}: missing {k}"
        props = schema.get("properties", {})
        if schema.get("additionalProperties") is False:
            extra = set(instance) - set(props)
            assert not extra, f"{where}: unexpected {sorted(extra)}"
        for k, v in instance.items():
            if k in props:
                _validate(v, props[k], f"{where}.{k}")
    if isinstance(instance, list) and "items" in schema:
        for i, v in enumerate(instance):
            _validate(v, schema["items"], f"{where}[{i}]")


def _is_schema(s, where):
    assert isinstance(s, dict) and ("type" in s or "enum" in s or "const" in s or s == {}), f"{where}: not a JSON schema"
    for k, v in s.get("properties", {}).items():
        _is_schema(v, f"{where}.{k}")


@pytest.mark.parametrize("name", sorted(CONTRACTS))
def test_agent_contract_is_valid(name):
    c = CONTRACTS[name]
    _validate(c, SCHEMA, name)
    assert name == f"{c['role']}.json"
    _is_schema(c["input_schema"], f"{name}.input_schema")
    _is_schema(c["output_schema"], f"{name}.output_schema")
    for s in c["data_stores"]["reads"] + c["data_stores"]["writes"]:
        assert s in STORE_IDS, f"{name}: unknown store {s} (declare it in contracts/storage.json)"
    for w in c["allowed_paths"]["write"]:
        top = w.split("/", 1)[0].rstrip("/")
        assert top in DECLARED or top in RUNTIME, f"{name}: write path {w} is not in repo.manifest.json"
    path, _, func = c["implemented_in"].partition("::")
    assert (ROOT / path).is_file(), f"{name}: {path} missing"
    if func:
        tree = ast.parse((ROOT / path).read_text())
        assert func in {n.name for n in ast.walk(tree) if isinstance(n, ast.FunctionDef)}, f"{name}: {func} not defined in {path}"


def test_pipeline_contracts_cover_every_seat_the_code_claims():
    src = (ROOT / "app" / "agents.py").read_text()
    seats = set(re.findall(r'run\.claim\("(\w+)"', src)) | set(re.findall(r'A = "(\w+)"', src))
    have = {c["seat"] for c in CONTRACTS.values() if c["kind"] == "pipeline"}
    assert seats and seats == have, f"seats in code {sorted(seats)} vs contracts {sorted(have)}"


def test_storage_map_is_consistent():
    assert STORAGE["schema_version"] == "precedent.storage-map.v1" and STORAGE["storage_schema_version"]
    assert len(STORE_IDS) == len(STORAGE["stores"]), "duplicate store id"
    for s in STORAGE["stores"]:
        for k in ("fallback", "fallback_for"):
            assert s.get(k) in (None, *STORE_IDS), f"{s['id']}.{k}"
        for mod in re.findall(r"[\w/]+\.py", s.get("module", "")):
            assert (ROOT / mod).is_file(), f"{s['id']}: {mod} missing"


def test_storage_map_matches_the_octo_schema():
    import schema

    assert STORAGE["storage_schema_version"] == str(schema.SCHEMA_VERSION), "bump contracts/storage.json storage_schema_version with schema.SCHEMA_VERSION"
    octo = next(s for s in STORAGE["stores"] if s["id"] == "octo-app-tables")
    assert set(octo["collections"]) == set(schema.MODELS), "octo-app-tables collections must list every table in schema.MODELS"


def test_code_only_anchors_declared_top_level_paths():
    """Static check: every `ROOT / "x"` (or repo-root `parent.parent / "x"`) in our own code names a declared path."""
    pat = re.compile(r'(?:\bROOT|parent\.parent|\bACS_ROOT_REPO)\s*/\s*"([^"/]+)')
    bad = []
    for f in OWN_CODE:
        for m in pat.finditer(f.read_text()):
            if m.group(1) not in DECLARED | RUNTIME:
                bad.append(f"{f.relative_to(ROOT)}: {m.group(1)}")
    assert not bad, f"undeclared repo paths (add to repo.manifest.json): {bad}"


def _snapshot():
    out = {}
    skip = (".git/", ".venv/", ".cgm/", "web/node_modules/", "web/dist/", "web/releases/")
    for p in ROOT.rglob("*"):
        rel = p.relative_to(ROOT).as_posix()
        if rel.startswith(skip) or "__pycache__" in rel or not p.is_file():
            continue
        st = p.stat()
        out[rel] = (st.st_mtime_ns, st.st_size)
    return out


def test_runtime_writes_stay_inside_declared_paths(tmp_path, monkeypatch):
    """Dynamic check: serve pages and API calls and run the pipeline once, then diff the checkout."""
    from fastapi.testclient import TestClient

    from app import agents, graph_store, server

    monkeypatch.setattr(graph_store, "D", tmp_path / "empty")
    monkeypatch.setattr(graph_store, "CACHE", tmp_path / "graph_meta.pkl")
    monkeypatch.setattr(agents, "_G", None)
    before = _snapshot()
    c = TestClient(server.app)
    for p in ["/", "/api/health", "/api/runs", "/api/seats", "/api/limits", "/map", "/dashboard", "/robots.txt", "/sitemap.xml"]:
        assert c.get(p).status_code < 500, p
    t = threading.Thread(target=lambda: agents.run_pipeline("Water rights priority dispute between ranchers"), daemon=True)
    t.start()
    t.join(30)
    after = _snapshot()
    changed = sorted(k for k, v in after.items() if before.get(k) != v)
    undeclared = [k for k in changed if not _declared_write(k)]
    assert not undeclared, f"code wrote to undeclared paths (declare in repo.manifest.json runtime_writes): {undeclared}"
