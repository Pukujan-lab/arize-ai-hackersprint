"""LLM helper: InferHub DeepSeek -> Anthropic haiku -> deterministic template.
Cache by prompt hash: local cache/<key>.json first, shared Octo llm_answer table second (synced back); template/empty never cached."""

import os, json, hashlib, pathlib, httpx, logging
import octocache

log = logging.getLogger("llm")
CACHE = pathlib.Path(__file__).parent / "cache"
CACHE.mkdir(exist_ok=True)
COUNT = CACHE / "_real_calls.json"


def _bump(p):
    d = json.loads(COUNT.read_text()) if COUNT.exists() else {}
    d[p] = d.get(p, 0) + 1
    COUNT.write_text(json.dumps(d))


INFERHUB_MODEL = "cb/deepseek-v4.1-flash"  # reasoning model; thinking disabled per request
INFERHUB_FALLBACK = "kiro/claude-haiku-4.5"  # fast non-reasoning model for the empty-content retry
LAST_MODEL: dict = {}


def _inferhub_call(base, key, model, system, prompt, mt):
    r = httpx.post(
        base + "/chat/completions",
        timeout=15,
        headers={"Authorization": f"Bearer {key}"},
        json={
            "model": model,
            "max_tokens": max(mt, 2000),
            "thinking": {"type": "disabled"},  # headroom for reasoning tokens
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": prompt}],
        },
    )
    r.raise_for_status()
    j = r.json()
    m = j["choices"][0]["message"]
    reasoned = bool(m.get("reasoning_content") or m.get("reasoning") or ((j.get("usage") or {}).get("completion_tokens_details") or {}).get("reasoning_tokens"))
    return (m.get("content") or "").strip(), reasoned


def _inferhub(system, prompt, mt):
    key = os.environ.get("INFERHUB_API_KEY")
    base = os.environ.get("OPENAI_BASE_URL", "https://api.inferhub.dev/v1")
    if not key:
        return None
    model = os.environ.get("DEFAULT_MODEL", INFERHUB_MODEL)
    text, reasoned = _inferhub_call(base, key, model, system, prompt, mt)
    if not text and reasoned:  # reasoning model burned the budget on reasoning: retry once with a non-reasoning model
        log.warning(
            "InferHub %s returned empty content (reasoning only); retrying with %s", model, os.environ.get("INFERHUB_FALLBACK_MODEL", INFERHUB_FALLBACK)
        )
        model = os.environ.get("INFERHUB_FALLBACK_MODEL", INFERHUB_FALLBACK)
        text, _ = _inferhub_call(base, key, model, system, prompt, mt)
    if not text:
        raise EmptyContent(model)
    _bump("inferhub")
    LAST_MODEL["inferhub"] = model
    return text


def _anthropic(system, prompt, mt):
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        return None
    import limits

    if not limits.take("anthropic"):
        raise CapReached("anthropic hourly cap")
    r = httpx.post(
        "https://api.anthropic.com/v1/messages",
        timeout=30,
        headers={"x-api-key": key, "anthropic-version": "2023-06-01"},
        json={"model": "claude-haiku-4-5", "max_tokens": mt, "system": system, "messages": [{"role": "user", "content": prompt}]},
    )
    r.raise_for_status()
    _bump("anthropic")
    return r.json()["content"][0]["text"]


class CapReached(Exception):
    pass


class EmptyContent(Exception):
    pass


LAST_ERR: dict = {}


def _err(name, e):
    code = getattr(getattr(e, "response", None), "status_code", None)
    LAST_ERR[name] = f"{type(e).__name__}{' ' + str(code) if code else ''}"  # no message text: never leak keys/urls


def cache_key(system, prompt, max_tokens):
    return hashlib.sha256(f"{system}\n{prompt}\n{max_tokens}".encode()).hexdigest()


def stale(d):
    """Answers that must never be served from cache: empty, template, reasoning-only, or pre-PR #5 ('inferhub/deepseek' label)."""
    t = (d.get("text") or "").strip()
    p = d.get("provider") or ""
    return not t or p.startswith("template") or p == "inferhub/deepseek" or (t.startswith("<think>") and "</think>" not in t)


def _cache_get(h):
    f = CACHE / f"{h}.json"
    if f.exists():
        try:
            d = json.loads(f.read_text())
        except Exception:
            d = {}
        if d and not stale(d):
            octocache.link("answer", h, True)
            return d
    for r in octocache.query("SELECT text, provider FROM llm_answer WHERE key = $1", [h]):
        if not stale(r):
            d = {"text": r["text"], "provider": r["provider"]}
            f.write_text(json.dumps(d))  # sync back to the local layer
            octocache.link("answer", h, True)
            return d
    return None


def _cache_put(h, text, provider, max_tokens):
    d = {"text": text, "provider": provider}
    if stale(d):
        return
    (CACHE / f"{h}.json").write_text(json.dumps(d))
    octocache.write(
        "INSERT INTO llm_answer(key, text, provider, max_tokens, run_id, created_at) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (key) DO NOTHING",
        [h, text, provider, max_tokens, octocache.RUN.get() or None, octocache.now()],
    )
    octocache.link("answer", h, False)


def complete(system, prompt, max_tokens=500, fallback=None):
    """Returns (text, provider). LLM_MODE=fake skips network entirely."""
    max_tokens = min(max_tokens, 600)
    h = cache_key(system, prompt, max_tokens)
    d = _cache_get(h)
    if d:
        return d["text"], d["provider"] + " (cached)"
    capped = False
    if os.environ.get("LLM_MODE") != "fake":
        for name, fn in (("inferhub/deepseek", _inferhub), ("anthropic/claude-haiku-4-5", _anthropic)):
            try:
                t = fn(system, prompt, max_tokens)
                if t:
                    if name.startswith("inferhub"):
                        name = "inferhub/" + LAST_MODEL.get("inferhub", INFERHUB_MODEL)
                    _cache_put(h, t, name, max_tokens)
                    return t, name
            except CapReached:
                capped = True
            except Exception as e:
                _err(name, e)
                continue
    if os.environ.get("LLM_MODE") != "fake":
        log.warning(
            "LLM unavailable, falling back to template answer (errors: %s)", ", ".join(f"{k}={v}" for k, v in LAST_ERR.items()) or "no provider configured"
        )
    return (fallback() if fallback else ""), ("template (hourly model cap reached - rate limited)" if capped else "template (offline)")


def _anthropic_stream(system, prompt, mt, on_delta):
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        return None
    import limits

    if not limits.take("anthropic"):
        raise CapReached("anthropic hourly cap")
    out = []
    with httpx.stream(
        "POST",
        "https://api.anthropic.com/v1/messages",
        timeout=30,
        headers={"x-api-key": key, "anthropic-version": "2023-06-01"},
        json={"model": "claude-haiku-4-5", "max_tokens": mt, "stream": True, "system": system, "messages": [{"role": "user", "content": prompt}]},
    ) as r:
        r.raise_for_status()
        for line in r.iter_lines():
            if not line.startswith("data:"):
                continue
            try:
                ev = json.loads(line[5:])
            except Exception:
                continue
            if ev.get("type") == "content_block_delta" and ev.get("delta", {}).get("type") == "text_delta":
                out.append(ev["delta"]["text"])
                on_delta("".join(out))
    _bump("anthropic")
    return "".join(out)


def complete_stream(system, prompt, max_tokens=400, fallback=None, on_delta=None):
    """Like complete() but streams Anthropic tokens to on_delta(text_so_far). Cache hits return instantly."""
    max_tokens = min(max_tokens, 600)
    h = cache_key(system, prompt, max_tokens)
    d = _cache_get(h)
    if d:
        on_delta and on_delta(d["text"])
        return d["text"], d["provider"] + " (cached)"
    capped = False
    if os.environ.get("LLM_MODE") != "fake" and on_delta:
        try:
            t = _anthropic_stream(system, prompt, max_tokens, on_delta)
            if t:
                _cache_put(h, t, "anthropic/claude-haiku-4-5", max_tokens)
                return t, "anthropic/claude-haiku-4-5 (streamed)"
        except CapReached:
            capped = True
        except Exception as e:
            _err("anthropic-stream", e)
    if capped:
        return (fallback() if fallback else ""), "template (hourly model cap reached - rate limited)"
    return complete(system, prompt, max_tokens, fallback)
