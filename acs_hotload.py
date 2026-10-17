"""ACS hot-loader: reload ACS claims/config on file change without restarting uvicorn (see acs/SOURCE.md)."""

import json, os, pathlib, threading, time

ROOT = pathlib.Path(__file__).parent
_lock = threading.Lock()
_state: dict = {"version": 0, "loaded_at": None, "files": {}, "data": {}, "errors": {}}
_thread = None


def watched():
    acs = pathlib.Path(os.environ.get("ACS_ROOT", os.path.expanduser("~/development/acs-adopter")))
    return {
        "assignment": ROOT / ".coord" / "assignment.json",
        "config": ROOT / "acs" / "config.json",
        "board": acs / ".coord" / "hackathon" / "board.json",
        "hotload_lock": acs / ".coord" / "hotload.lock.json",
    }


def _mtime(p):
    try:
        return p.stat().st_mtime_ns
    except OSError:
        return None


def reload(force=False):
    """Re-read the changed (or all, if force) watched files. Returns the list of keys that changed."""
    changed = []
    with _lock:
        for k, p in watched().items():
            m = _mtime(p)
            if not force and _state["files"].get(k) == m:
                continue
            _state["files"][k] = m
            changed.append(k)
            if m is None:
                _state["data"].pop(k, None)
                _state["errors"].pop(k, None)
                continue
            try:
                _state["data"][k] = json.loads(p.read_text())
                _state["errors"].pop(k, None)
            except Exception as e:
                _state["errors"][k] = f"{type(e).__name__}: {e}"  # keep last good copy
        if changed:
            _state["version"] += 1
            _state["loaded_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    return changed


def get(key, default=None):
    with _lock:
        return _state["data"].get(key, default)


def status():
    with _lock:
        a = _state["data"].get("assignment") or {}
        return {
            "version": _state["version"],
            "loaded_at": _state["loaded_at"],
            "watching": bool(_thread and _thread.is_alive()),
            "loaded": sorted(_state["data"]),
            "errors": dict(_state["errors"]),
            "seats": {s: v.get("status") for s, v in (a.get("seats") or {}).items()},
        }


def start(interval=None):
    global _thread
    if _thread and _thread.is_alive():
        return _thread
    iv = float(interval or os.environ.get("ACS_HOTLOAD_INTERVAL", "2"))

    def loop():
        while True:
            try:
                reload()
            except Exception:
                pass
            time.sleep(iv)

    reload(force=True)
    _thread = threading.Thread(target=loop, name="acs-hotload", daemon=True)
    _thread.start()
    return _thread


def mount(app):
    @app.get("/api/acs/hotload")
    def _acs_hotload():
        return status()

    @app.post("/api/acs/reload")
    def _acs_reload():
        return {"changed": reload(force=True), **status()}

    if os.environ.get("ACS_HOTLOAD", "1") != "0":
        start()
    else:
        reload(force=True)
