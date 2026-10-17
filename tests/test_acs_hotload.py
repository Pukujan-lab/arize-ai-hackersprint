import json, os, sys, pathlib, time

sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))
import acs_hotload


def test_reload_picks_up_changes(tmp_path, monkeypatch):
    f = tmp_path / "assignment.json"
    f.write_text(json.dumps({"seats": {"a": {"status": "working"}}}))
    monkeypatch.setattr(acs_hotload, "watched", lambda: {"assignment": f})
    monkeypatch.setattr(acs_hotload, "_state", {"version": 0, "loaded_at": None, "files": {}, "data": {}, "errors": {}})
    assert acs_hotload.reload() == ["assignment"]
    assert acs_hotload.status()["seats"] == {"a": "working"}
    assert acs_hotload.reload() == []  # unchanged -> no reload
    time.sleep(0.01)
    f.write_text(json.dumps({"seats": {"a": {"status": "done"}}}))
    os.utime(f, ns=(time.time_ns(), time.time_ns() + 10**9))
    assert acs_hotload.reload() == ["assignment"] and acs_hotload.status()["seats"] == {"a": "done"}
    f.write_text("{broken")
    os.utime(f, ns=(time.time_ns(), time.time_ns() + 2 * 10**9))
    acs_hotload.reload()
    assert acs_hotload.status()["seats"] == {"a": "done"} and "assignment" in acs_hotload.status()["errors"]  # last good kept
    f.unlink()
    acs_hotload.reload()
    assert acs_hotload.get("assignment") is None


def test_watcher_thread_reloads(tmp_path, monkeypatch):
    f = tmp_path / "c.json"
    f.write_text('{"x": 1}')
    monkeypatch.setattr(acs_hotload, "watched", lambda: {"config": f})
    monkeypatch.setattr(acs_hotload, "_state", {"version": 0, "loaded_at": None, "files": {}, "data": {}, "errors": {}})
    monkeypatch.setattr(acs_hotload, "_thread", None)
    acs_hotload.start(interval=0.05)
    assert acs_hotload.get("config") == {"x": 1}
    f.write_text('{"x": 2}')
    os.utime(f, ns=(time.time_ns(), time.time_ns() + 10**9))
    for _ in range(60):
        if acs_hotload.get("config") == {"x": 2}:
            break
        time.sleep(0.05)
    assert acs_hotload.get("config") == {"x": 2}


def test_vendored_seat_protocol_imports():
    sys.path.insert(0, str(pathlib.Path(__file__).parent.parent / "acs"))
    import seat_protocol, watchdog_check  # noqa: F401
