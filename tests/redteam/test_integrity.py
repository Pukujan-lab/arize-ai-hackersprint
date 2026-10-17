"""Legal-answer integrity: safeguard gaps and cache honesty."""

from __future__ import annotations


from app import agents


def test_safeguard_fails_uncited_material_claims():
    """Unsupported (uncited) sentences must fail the safeguard, not only invalid [n] refs."""

    class FakeRun:
        def claim(self, *a, **k):
            pass

        def release(self, *a, **k):
            pass

        def event(self, *a, **k):
            pass

    ret = {
        "citations": [
            {
                "ref": "[1]",
                "id": "c-1",
                "title": "Smith v. Jones",
                "passage": "A written lease is preferred.",
                "url": "",
                "type": "caselaw",
                "court": "Colorado",
                "date": "",
            }
        ]
    }
    # Answer uses [1] once but adds a second uncited legal claim
    ans = {"text": ("Short answer: Written leases are safer [1]. Additionally, oral leases over one year are always void under the statute of frauds.")}
    # Patch tracing.span used inside safeguard
    import app.agents as ag

    class Span:
        def __enter__(self):
            return object()

        def __exit__(self, *a):
            return False

    ag.tracing.span = lambda *a, **k: Span()  # type: ignore
    ag.tracing.oi = lambda *a, **k: None  # type: ignore
    sg = agents.safeguard(FakeRun(), "lease question", ret, ans)
    assert sg["pass"] is False, f"safeguard passed despite an uncited material claim; unsupported_claims={sg.get('unsupported_claims')}"


def test_safeguard_fail_withholds_or_quarantines_answer():
    """FAIL must not look like a normal successful memo in the public UI contract."""
    src = open("app/agents.py").read()
    # crude but stable: result always includes answer even on fail today
    assert "if not sg[\"pass\"]" in src or "if not sg['pass']" in src, "pipeline has no branch that withholds/quarantines the answer on safeguard FAIL"
