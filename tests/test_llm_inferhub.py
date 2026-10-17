"""InferHub reasoning models can spend the whole token budget on reasoning and return empty content.
llm.complete must then retry once with a non-reasoning model and return a real (non-template) answer."""

import sys, pathlib

sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))
import llm


class _Resp:
    def __init__(self, msg, reasoning_tokens=0):
        self._j = {
            "choices": [{"message": msg, "finish_reason": "length" if not msg.get("content") else "stop"}],
            "usage": {"completion_tokens_details": {"reasoning_tokens": reasoning_tokens}},
        }

    status_code = 200

    def raise_for_status(self):
        pass

    def json(self):
        return self._j


def _setup(tmp_path, monkeypatch, responses):
    monkeypatch.setattr(llm, "CACHE", tmp_path)
    monkeypatch.setattr(llm, "COUNT", tmp_path / "_real_calls.json")
    monkeypatch.setenv("INFERHUB_API_KEY", "test-key")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("LLM_MODE", raising=False)
    monkeypatch.delenv("DEFAULT_MODEL", raising=False)
    monkeypatch.delenv("INFERHUB_FALLBACK_MODEL", raising=False)
    calls = []

    def fake_post(url, **kw):
        calls.append(kw["json"])
        return responses[min(len(calls), len(responses)) - 1]

    monkeypatch.setattr(llm.httpx, "post", fake_post)
    llm.LAST_ERR.clear()
    return calls


def test_empty_reasoning_content_retries_with_non_reasoning_model(tmp_path, monkeypatch):
    calls = _setup(
        tmp_path,
        monkeypatch,
        [
            _Resp({"role": "assistant", "content": "", "reasoning_content": "thinking..."}, 400),
            _Resp({"role": "assistant", "content": "**Short answer:** Probable cause is required [1]."}),
        ],
    )
    text, provider = llm.complete("sys", "question", 400, fallback=lambda: "TEMPLATE")
    assert len(calls) == 2, calls
    assert calls[0]["max_tokens"] >= 2000  # room for reasoning tokens
    assert calls[1]["model"] != calls[0]["model"]  # retried with a different (non-reasoning) model
    assert text.startswith("**Short answer:**") and "template" not in provider, provider


def test_template_fallback_is_logged(tmp_path, monkeypatch, caplog):
    _setup(tmp_path, monkeypatch, [_Resp({"role": "assistant", "content": "", "reasoning_content": "thinking..."}, 400)])
    with caplog.at_level("WARNING"):
        text, provider = llm.complete("sys", "question", 400, fallback=lambda: "TEMPLATE")
    assert text == "TEMPLATE" and provider.startswith("template")
    assert any("template" in r.getMessage().lower() for r in caplog.records)
    assert llm.LAST_ERR  # surfaces as an llm_error run event
