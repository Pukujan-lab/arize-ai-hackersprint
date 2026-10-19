"""Repo layout: the backend lives in the app/ package, ACS code in acs/, docs in docs/, scripts in tools/,
and the old `uvicorn server:app` start command still works through the top-level shim."""

import importlib
import os
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
os.environ.setdefault("LLM_MODE", "fake")
os.environ["ACS_HOTLOAD"] = "0"

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

APP_MODULES = [
    "server", "llm", "agents", "graph_store", "octo_retriever", "limits", "stats", "tracing",
    "seo", "coord", "contracts", "build_octo_snapshot", "load_surreal", "ttschain", "octocache",
]  # fmt: skip
ACS_MODULES = ["board", "claim", "hotload"]
DOCS = ["ABA_BUILD_LOG.md", "ARIZE_SETUP.md", "COPY.md", "HACKATHON_POLICY.md", "PLAN.md", "PRESENTER_GUIDE.md", "UX_GUIDELINES.md"]
SCRIPTS = ["ci_local.sh", "run_all.sh"]


def test_app_imports_from_package():
    from app import server

    assert isinstance(server.app, FastAPI)
    assert pathlib.Path(server.__file__).resolve().parent == ROOT / "app"


def test_top_level_shim_serves_the_same_app():
    shim = importlib.import_module("server")
    from app.server import app

    assert pathlib.Path(shim.__file__).resolve() == ROOT / "server.py"
    assert shim.app is app


def test_health_responds():
    from app.server import app

    r = TestClient(app).get("/api/health")
    assert r.status_code == 200 and r.json()["ok"] is True


def test_files_live_in_their_new_folders():
    for m in APP_MODULES:
        assert (ROOT / "app" / f"{m}.py").is_file(), m
        if m != "server":
            assert not (ROOT / f"{m}.py").exists(), f"{m}.py still at top level"
    for m in ACS_MODULES:
        assert (ROOT / "acs" / f"{m}.py").is_file() and not (ROOT / f"acs_{m}.py").exists(), m
    for d in DOCS:
        assert (ROOT / "docs" / d).is_file() and not (ROOT / d).exists(), d
    for s in SCRIPTS:
        assert (ROOT / "tools" / s).is_file() and not (ROOT / s).exists(), s
    assert (ROOT / "README.md").is_file() and (ROOT / "docs" / "issues").is_dir() and not (ROOT / "issues").exists()


def test_runtime_paths_resolve_to_repo_root():
    from app import coord, graph_store, llm, octo_retriever, server
    from acs import hotload

    assert server.ROOT == ROOT and (server.ROOT / "web" / "package.json").is_file()
    assert llm.CACHE == ROOT / "cache"
    assert graph_store.CACHE == ROOT / "cache" / "graph_meta.pkl"
    assert octo_retriever.CACHE == ROOT / "cache" / "octo" and octo_retriever.SNAP == ROOT / "data" / "octo_snapshot.sqlite"
    assert coord.CLAIM == ROOT / ".coord" / "assignment.json"
    assert hotload.watched()["assignment"] == ROOT / ".coord" / "assignment.json"
    assert hotload.watched()["config"] == ROOT / "acs" / "config.json"


def test_graph_data_dir_env_and_default(monkeypatch, tmp_path):
    from app import graph_store

    try:
        monkeypatch.setenv("GRAPH_DATA_DIR", str(tmp_path))
        assert importlib.reload(graph_store).D == tmp_path
        monkeypatch.delenv("GRAPH_DATA_DIR")
        assert importlib.reload(graph_store).D == ROOT / "data"
    finally:
        monkeypatch.delenv("GRAPH_DATA_DIR", raising=False)
        importlib.reload(graph_store)


def test_start_commands_use_the_package_path():
    assert "uvicorn app.server:app" in (ROOT / "deploy" / "run_app.sh").read_text()
    for f in ["deploy/install_launchd.sh", "tools/run_all.sh", "README.md"]:
        text = (ROOT / f).read_text()
        assert "app.server:app" in text, f
