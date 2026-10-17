"""Security red-team: authz, injection, rate-limit trust, secret leakage, XSS sinks."""

from __future__ import annotations

import pathlib


ROOT = pathlib.Path(__file__).resolve().parents[2]


def test_acs_reload_requires_auth(client):
    """POST /api/acs/reload must not be open on a public demo."""
    r = client.post("/api/acs/reload")
    assert r.status_code in (401, 403, 404, 405), f"acs reload is unauthenticated: {r.status_code} {r.text[:200]}"


def test_acs_claim_requires_auth(client):
    r = client.post("/api/claim", json={"task": "RT-NOPE", "agent": "attacker"})
    assert r.status_code in (401, 403), f"claim open: {r.status_code} {r.text[:200]}"


def test_sponsor_does_not_leak_space_id(client, monkeypatch):
    monkeypatch.setenv("ARIZE_SPACE_ID", "REDACTED_TEST_SPACE_ID")
    monkeypatch.setenv("ARIZE_API_KEY", "REDACTED_TEST_KEY")
    r = client.get("/api/sponsor")
    assert r.status_code == 200
    body = r.json()
    arize = body.get("arize") or {}
    assert "space_id" not in arize, "ARIZE_SPACE_ID must not appear as a field in /api/sponsor"
    blob = str(body)
    assert "REDACTED_TEST_SPACE_ID" not in blob and "REDACTED_TEST_KEY" not in blob


def test_xff_alone_does_not_reset_rate_limit(client):
    """Client-controlled X-Forwarded-For must not bypass the per-IP ask cap."""
    # Burn the no-session per-IP budget, then rotate XFF and expect continued 429.
    codes = []
    for i in range(8):
        codes.append(
            client.post(
                "/api/ask",
                json={"question": f"xff burn probe number {i} about leases"},
            ).status_code
        )
    assert 429 in codes, f"expected to hit rate limit, got {codes}"
    bypass = client.post(
        "/api/ask",
        json={"question": "xff bypass probe about leases after burn"},
        headers={"X-Forwarded-For": "203.0.113.99"},
    )
    assert bypass.status_code == 429, f"X-Forwarded-For bypassed rate limit: {bypass.status_code} {bypass.text[:200]}"


def test_run_id_rejects_path_traversal_and_arbitrary_mkdir(client, tmp_path, monkeypatch):
    monkeypatch.chdir(ROOT)
    before = set(p.name for p in (ROOT / "runs").glob("*")) if (ROOT / "runs").exists() else set()
    r = client.get("/api/run/../../etc/passwd")
    # Must not create runs outside or under odd names; 400/404 preferred
    assert r.status_code in (400, 404, 422), f"traversal accepted: {r.status_code}"
    client.get("/api/run/redteam-should-not-mkdir-xyz")
    after = set(p.name for p in (ROOT / "runs").glob("*")) if (ROOT / "runs").exists() else set()
    created = after - before
    assert "redteam-should-not-mkdir-xyz" not in created, "GET /api/run creates dirs for unknown ids"


def test_voice_caption_escapes_user_text():
    js = (ROOT / "static" / "voice.js").read_text()
    # Unsanitized innerHTML of speech text is XSS
    assert "${t}" not in js or "escapeHtml" in js or "textContent" in js.split("caption")[1][:400], (
        "voice.js caption() assigns unsanitized speech text to innerHTML"
    )
    bad = "cap.innerHTML=dim?`<span class=\"text-slate-400\">${t}</span>`:t;"
    assert bad not in js, "voice.js caption XSS sink still present"


def test_map_pin_tags_escape_refs():
    js = (ROOT / "static" / "map3d.js").read_text()
    # pinTags builds innerHTML with ${refs} — must escape
    assert "${refs}" not in js or "esc(" in js[js.find("function pinTags") : js.find("function pinTags") + 800], (
        "map3d.js pinTags interpolates refs into innerHTML without esc()"
    )


def test_tour_prefetch_rejects_html_payload(client):
    r = client.post(
        "/api/tour/prefetch",
        json={
            "run_id": "rt-xss",
            "steps": [{"step_index": 0, "text": "<img src=x onerror=alert(1)>", "coords": [0, 0]}],
        },
    )
    assert r.status_code in (400, 422) or "<img" not in r.text, f"tour prefetch stores raw HTML: {r.status_code} {r.text[:240]}"


def test_oversized_ask_rejected(client):
    r = client.post("/api/ask", json={"question": "a " * 200_000})
    assert r.status_code in (400, 413, 422), f"oversized ask accepted: {r.status_code}"


def test_acs_events_requires_auth(client):
    r = client.get("/api/acs/events?n=2")
    assert r.status_code in (401, 403, 404), f"acs events public: {r.status_code}"
