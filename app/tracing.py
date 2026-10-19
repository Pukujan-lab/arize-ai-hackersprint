"""Arize tracing via OpenTelemetry, reported honestly.

`ok` is true only when the exporter accepted spans. "Not configured", a connection error and a rejected
credential are three different failures with three different reasons, and each is reported as a failure:
the app never claims delivery it cannot demonstrate.

The span queue is bounded first-in-first-out: at the cap the oldest queued span is dropped and counted, so
the figures `/api/health` and `/api/stack` report describe a store that cannot grow without limit.
"""

import contextlib
import logging
import os
import re
import threading

QUEUE_MAX = int(os.environ.get("TRACE_QUEUE_MAX", "2000"))
PROJECT_DEFAULT = "precedent-legal-graphrag"

_tracer = None
_lock = threading.Lock()
_state = {
    "ok": False,
    "reason": "not configured",
    "project": None,
    "started": 0,
    "sent": 0,
    "dropped": 0,
}
_captured = {"installed": False}


def _queue():
    return max(0, _state["started"] - _state["sent"] - _state["dropped"])


def _started(count=1):
    with _lock:
        _state["started"] += count
        if _queue() > QUEUE_MAX:  # first in, first out: the oldest queued span goes
            _state["dropped"] += 1


def _delivered(count):
    with _lock:
        _state["sent"] += max(0, count)
        _state["ok"] = True
        _state["reason"] = None


def _failed(reason, count=0):
    with _lock:
        _state["ok"] = False
        _state["reason"] = str(reason or "export failed")[:200]
        if count:
            _state["dropped"] += count


class _Recorder:
    """Wraps the exporter the SDK was given, so an accepted or rejected batch is recorded, not guessed."""

    def __init__(self, inner):
        self._inner = inner

    def __getattr__(self, name):
        return getattr(self._inner, name)

    def export(self, spans):
        count = len(spans) if hasattr(spans, "__len__") else 1
        try:
            result = self._inner.export(spans)
        except Exception as error:
            _failed(f"{type(error).__name__}: {error}", count)
            raise
        if result is None:
            _delivered(count)
            return result
        name = str(getattr(result, "name", result)).upper()
        if name.endswith("SUCCESS"):
            _delivered(count)
        else:
            _failed(str(getattr(result, "name", result)), count)
        return result


def _wrap_provider(provider):
    """Point every span processor at a recording exporter. False when the SDK's shape is not recognised."""
    seen = set()

    def visit(obj, depth=0):
        if obj is None or depth > 4 or id(obj) in seen:
            return False
        seen.add(id(obj))
        for attr in ("_span_exporter", "span_exporter"):
            exporter = getattr(obj, attr, None)
            if exporter is not None and not isinstance(exporter, _Recorder):
                try:
                    setattr(obj, attr, _Recorder(exporter))
                    return True
                except Exception:
                    pass
        for attr in ("_span_processors", "span_processors"):
            children = getattr(obj, attr, None)
            if children:
                results = [visit(child, depth + 1) for child in children]
                return any(results)
        return False

    return visit(getattr(provider, "_active_span_processor", None))


class _Capture(logging.Handler):
    """The exporter logs its rejections; capture them so the reason is the exporter's own words."""

    def emit(self, record):
        try:
            message = record.getMessage()
        except Exception:
            return
        if "Failed to export" not in message:
            return
        code = re.search(r"(StatusCode\.\w+)", message)
        _failed(code.group(1) if code else message[:200], 0)


def _install_capture():
    if _captured["installed"]:
        return
    handler = _Capture()
    for name in ("opentelemetry", "opentelemetry.sdk.trace.export"):
        logging.getLogger(name).addHandler(handler)
    _captured["installed"] = True


def _init():
    global _tracer
    if _tracer is not None:
        return
    space = os.environ.get("ARIZE_SPACE_ID")
    key = os.environ.get("ARIZE_API_KEY")
    if not (space and key):
        _failed("not configured")
        return
    _state["project"] = os.environ.get("ARIZE_PROJECT_NAME", PROJECT_DEFAULT)
    try:
        from arize.otel import register

        provider = register(space_id=space, api_key=key, project_name=_state["project"])
        _tracer = provider.get_tracer("legal-graphrag")
        _wrap_provider(provider)
        _install_capture()
        with _lock:
            _state["ok"] = False
            _state["reason"] = "no span has been exported yet"
    except Exception as error:
        print("arize tracing unavailable:", error)
        _tracer = False
        _failed(f"{type(error).__name__}: {error}")


def enabled():
    """Whether a tracer exists at all. Delivery is a separate question: see `status()`."""
    _init()
    return bool(_tracer)


def status():
    """{ok, reason?, project, sent, dropped, queued} — what the health and stack payloads report."""
    _init()
    with _lock:
        out = {
            "ok": bool(_state["ok"]),
            "project": _state["project"],
            "sent": _state["sent"],
            "dropped": _state["dropped"],
            "queued": _queue(),
        }
        if not out["ok"]:
            out["reason"] = _state["reason"] or "tracing is not delivering"
    return out


def queue_max():
    return QUEUE_MAX


@contextlib.contextmanager
def span(name, **attrs):
    _init()
    if not _tracer:
        yield None
        return
    from app import stats

    stats.bump("arize_spans")
    _started()
    with _tracer.start_as_current_span(name) as s:
        s.set_attribute("openinference.span.kind", "AGENT" if name != "pipeline" else "CHAIN")
        for k, v in attrs.items():
            s.set_attribute(k, str(v))
        yield s


def oi(s, **kv):
    """Set OpenInference attributes on a span (no-op when tracing is off). Keys use __ for dots."""
    if not s:
        return
    import json as _j

    for k, v in kv.items():
        try:
            s.set_attribute(k.replace("__", "."), v if isinstance(v, (int, float, bool, str)) else _j.dumps(v)[:4000])
        except Exception:
            pass
