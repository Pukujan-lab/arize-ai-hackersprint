# Precedent — presentation copy (B2B, legal professionals)

## Hero
**Verified research memos for legal teams.**
Every authority checked against what was actually retrieved, with an auditable agent trail, running in isolated Daytona sandboxes.

## Who it's for
Law firms, in-house counsel and litigation-support teams that need a defensible first-pass research memo fast, without cites that were never retrieved.

## The workflow
An associate needs the probable-cause standard under Colorado's automobile exception before a suppression hearing. She enters one query. Four agents claim their seats. Octo retrieves opinion passages, SurrealDB expands the citation graph across Colorado and federal courts, Claude Haiku drafts a memo (short answer, key authorities with holdings, caveat), and the safeguard rejects any authority that wasn't retrieved. She gets the memo, verbatim quotes, a jurisdictional map of the authorities by county and court, and a full trail in ACS and Arize to verify.

## Value props
- **Faster research memos.** A first-pass memo in seconds: short answer, key authorities, caveat.
- **No unretrieved cites.** Every citation must be in the retrieved set or the run fails. Quotes are verbatim.
- **Auditable agent trail.** Every run is an ACS issue record plus events log; Arize traces each agent step.
- **Jurisdictional mapping.** Authorities placed by county, state court and federal circuit; see where the law was made.
- **Secure, isolated execution.** Runs entirely inside a Daytona sandbox; keys never leave it or reach the repo.
- **Cost and rate controls.** One run in flight, per-IP limits, hourly model/TTS caps, cache, template fallback.

## Slides
1. Precedent — verified research memos for legal teams.
2. The problem — memo turnaround is slow; generic LLMs cite authority that doesn't exist.
3. The workflow — query → retrieve → graph-expand → memo → verify.
4. The agents — planner · retriever · answer · safeguard, coordinated by ACS in Daytona.
5. Live demo — query, watch the jurisdiction map light up, hear the short answer.
6. Verification — no unretrieved citation survives; verbatim quotes; audit trail.
7. Controls — isolation, rate limits, caps, caching.
8. Thank you — Daytona · SurrealDB · Octo · ElevenLabs · Arize · ACS.
