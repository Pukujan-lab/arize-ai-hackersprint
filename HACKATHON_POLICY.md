# Hackathon Policy — Legal GraphRAG Agents (Fri Oct 16, 2026)

**Priority order: speed > delivery > presentation > completeness.**

## Rules
1. **Ship the smallest working slice.** A demo that works end to end beats a half-built feature.
2. **No refactors of working code.** The legal RAG pipeline (`agents.py`, `graph_store.py`, `llm.py`, `server.py`) is tested and frozen; only additive, small changes are allowed.
3. **Fake/template fallbacks are allowed if labeled.** Any offline/template/fake output must say so in the UI or logs (e.g. `model: template (offline)`).
4. **Minimize paid LLM calls.** Use the on-disk cache, cheap models only (Claude Haiku 4.5 / DeepSeek via InferHub), `max_tokens <= 600`, `LLM_MODE=fake` for testing.
5. **Never print secrets.** Check key presence only (`[ -n "$X" ] && echo set`); never echo, log or commit key values.
6. **Safeguards stay on.** The citation check (no authority outside the retrieved set) and the "not legal advice" disclaimer must not be disabled or bypassed.
7. **Feature freeze at 3:00 PM ET.** After that, only bug fixes, slides, and the backup video.
8. **Submit by 3:30 PM ET.**

## Coordination
- Claim a task before starting: `python3 ~/hack/demo/acs_claim.py claim <TASK> --agent <name>` (or `POST /api/claim`).
- One owner per task; release when done or blocked: `acs_claim.py release <TASK> --agent <name> --status done`.
- Board: `~/development/acs-adopter/.coord/hackathon/board.json`; events: `.coord/hackathon/events.jsonl`; issue logs: `.oio/issue-logs/hackathon/`.
