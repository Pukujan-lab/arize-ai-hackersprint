"""Optional Arize tracing via OpenTelemetry; no-op if keys/packages missing."""
import os, contextlib
_tracer = None
def _init():
    global _tracer
    if _tracer is not None or not (os.environ.get("ARIZE_API_KEY") and os.environ.get("ARIZE_SPACE_ID")): return
    try:
        from arize.otel import register
        tp = register(space_id=os.environ["ARIZE_SPACE_ID"], api_key=os.environ["ARIZE_API_KEY"], project_name=os.environ.get("ARIZE_PROJECT_NAME","precedent-legal-graphrag"))
        _tracer = tp.get_tracer("legal-graphrag")
    except Exception as e:
        print("arize tracing disabled:", e); _tracer = False
def enabled(): _init(); return bool(_tracer)
@contextlib.contextmanager
def span(name, **attrs):
    _init()
    if not _tracer:
        yield None; return
    import stats; stats.bump("arize_spans")
    with _tracer.start_as_current_span(name) as s:
        s.set_attribute("openinference.span.kind", "AGENT" if name != "pipeline" else "CHAIN")
        for k, v in attrs.items(): s.set_attribute(k, str(v))
        yield s
def oi(s, **kv):
    """Set OpenInference attributes on a span (no-op when tracing is off). Keys use __ for dots."""
    if not s: return
    import json as _j
    for k, v in kv.items():
        try: s.set_attribute(k.replace("__", "."), v if isinstance(v, (int, float, bool, str)) else _j.dumps(v)[:4000])
        except Exception: pass
