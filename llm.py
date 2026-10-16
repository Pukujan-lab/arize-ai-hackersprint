"""LLM helper: InferHub DeepSeek -> Anthropic haiku -> deterministic template. Disk cache by prompt hash."""
import os, json, hashlib, pathlib, httpx
CACHE = pathlib.Path(__file__).parent / "cache"; CACHE.mkdir(exist_ok=True)
COUNT = CACHE / "_real_calls.json"
def _bump(p):
    d = json.loads(COUNT.read_text()) if COUNT.exists() else {}
    d[p] = d.get(p, 0) + 1; COUNT.write_text(json.dumps(d))
def _inferhub(system, prompt, mt):
    key = os.environ.get("INFERHUB_API_KEY"); base = os.environ.get("OPENAI_BASE_URL", "https://api.inferhub.dev/v1")
    if not key: return None
    r = httpx.post(base + "/chat/completions", timeout=8, headers={"Authorization": f"Bearer {key}"},
        json={"model": os.environ.get("DEFAULT_MODEL", "cb/deepseek-v4.1-flash"), "max_tokens": mt,
              "messages": [{"role": "system", "content": system}, {"role": "user", "content": prompt}]})
    r.raise_for_status(); _bump("inferhub"); return r.json()["choices"][0]["message"]["content"]
def _anthropic(system, prompt, mt):
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key: return None
    import limits
    if not limits.take("anthropic"): raise CapReached("anthropic hourly cap")
    r = httpx.post("https://api.anthropic.com/v1/messages", timeout=30,
        headers={"x-api-key": key, "anthropic-version": "2023-06-01"},
        json={"model": "claude-haiku-4-5", "max_tokens": mt, "system": system, "messages": [{"role": "user", "content": prompt}]})
    r.raise_for_status(); _bump("anthropic"); return r.json()["content"][0]["text"]
class CapReached(Exception): pass

def complete(system, prompt, max_tokens=500, fallback=None):
    """Returns (text, provider). LLM_MODE=fake skips network entirely."""
    max_tokens = min(max_tokens, 600)
    h = hashlib.sha256(f"{system}\n{prompt}\n{max_tokens}".encode()).hexdigest()
    f = CACHE / f"{h}.json"
    if f.exists():
        d = json.loads(f.read_text()); return d["text"], d["provider"] + " (cached)"
    capped = False
    if os.environ.get("LLM_MODE") != "fake":
        for name, fn in (("inferhub/deepseek", _inferhub), ("anthropic/claude-haiku-4-5", _anthropic)):
            try:
                t = fn(system, prompt, max_tokens)
                if t:
                    f.write_text(json.dumps({"text": t, "provider": name})); return t, name
            except CapReached:
                capped = True
            except Exception:
                continue
    return (fallback() if fallback else ""), ("template (hourly model cap reached - rate limited)" if capped else "template (offline)")
