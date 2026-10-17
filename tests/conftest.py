"""CI determinism: skip tests that need a live server, a browser, the network, or graph data unless explicitly enabled.
Set RUN_LIVE=1 to run live-server/network tests; data tests run automatically when data/nodes.jsonl exists."""
import os, pathlib, pytest
ROOT = pathlib.Path(__file__).parent.parent
HAS_DATA = (ROOT / "data" / "nodes.jsonl").exists()
LIVE = os.environ.get("RUN_LIVE") == "1"
LIVE_FILES = {"test_followup.py", "test_ui_smoke.py"}
DATA_FILES = {"test_demo.py"}
collect_ignore = [] if LIVE else sorted(LIVE_FILES)   # also avoids importing playwright in CI
def pytest_configure(config):
    config.addinivalue_line("markers", "live: needs a running server / network / secrets")
    config.addinivalue_line("markers", "data: needs data/nodes.jsonl")
def pytest_collection_modifyitems(config, items):
    for it in items:
        name = pathlib.Path(str(it.fspath)).name
        if name in DATA_FILES:
            it.add_marker(pytest.mark.data)
            if not HAS_DATA: it.add_marker(pytest.mark.skip(reason="data/nodes.jsonl missing"))
        if name in LIVE_FILES or "live" in it.keywords:
            it.add_marker(pytest.mark.live)
            if not LIVE: it.add_marker(pytest.mark.skip(reason="set RUN_LIVE=1"))
