# Precedent — presenter guide (3:20 total)
Positioning: verified research memos for legal teams (law firms, in-house counsel, litigation support).

## Pre-demo checklist
- [ ] Open https://3000-hpm8ocjo7sx9gya1.daytonaproxy01.net in Chrome, mic permission granted
- [ ] Partner tabs logged in: Daytona, Surrealist, Arize (space U3BhY2U6NTY4Nzk6MHhDRQ==), ElevenLabs
- [ ] /dashboard loads, Arize card shows "Connected"
- [ ] Use a cached chip question (no new model call); sound on
- [ ] Backup video ready: static/backup_demo.mp4

## 1. Problem (20s)
Associates spend hours on first-pass research memos, and generic LLMs cite authorities that were never retrieved, or that don't exist.
## 2. Precedent (20s)
A query becomes a research memo: short answer, key authorities with holdings, caveat. Every citation is checked against what was retrieved, and every step is auditable.
## 3. Live demo (60s)
Click the mic → ask the chip question "Automobile exception: probable cause standard in Colorado" → point at the live agent feed → the map lights up by county and court → hover a case → click Listen.
## 4. Partners (60s)
- **Daytona**: the whole stack (agents, SurrealDB, CI) runs in one isolated sandbox. [Open](https://app.daytona.io)
- **SurrealDB**: a citation graph of 120k authorities and 161k edges expands what's retrieved. [Open](https://surrealist.app)
- **Arize**: OpenInference traces per agent plus citation_guard and groundedness evals. [Open](https://app.arize.com/organizations/QWNjb3VudE9yZ2FuaXphdGlvbjo1MjM0Mjo2cVRj/spaces/U3BhY2U6NTY4Nzk6MHhDRQ==/home)
- **ElevenLabs**: reads the short answer aloud; hands-free voice loop. [Open](https://elevenlabs.io/app)
- **ACS**: agent seats, handoffs and an audit record for every run. [Open](/dashboard#acs)
## 5. Safeguards (20s)
No unretrieved citation survives; quotes are verbatim; rate limits and hourly caps; a "not legal advice" disclaimer.
## 6. Close (20s)
Partner wall slide (/slides, last slide). "Verified memos, auditable agents, built on Daytona, SurrealDB, Arize and ElevenLabs."
