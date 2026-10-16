# Precedent — presentation copy (PRD-agent story style)

## Hero
**Cited legal answers for people who can't afford legal research.**
Built and checked by coordinated agents inside Daytona.

## The story
**Maria runs a two-lawyer legal-aid office in Pueblo.** A client was searched at a traffic stop. Maria has 20 minutes before the hearing and no Westlaw seat.
She types one question. Four agents claim their seats. Octo pulls the passages, SurrealDB walks the citation graph across Colorado's courts, Haiku drafts a short answer, and the safeguard refuses to let a single authority through that wasn't actually retrieved.
Maria gets three cases, the exact quoted lines, a map of where they were decided — and a disclaimer reminding her to verify. She walks into court prepared.

## Sections
- **Problem** — Legal research costs hundreds of dollars a month. Solo lawyers, paralegals and legal aid go without. Generic chatbots invent case law.
- **Idea** — A team of agents (planner, retriever, answer, safeguard) coordinated through ACS seats and handoffs, running entirely in a Daytona sandbox.
- **How it works** — Octo full-text passages (804k opinions passages) → SurrealDB citation graph (120k authorities, 161k links) → Claude Haiku 4.5 short cited answer → citation safeguard → ElevenLabs voice.
- **Safeguards** — Every citation must exist in the retrieved set or the run fails. Quotes are verbatim from retrieved passages. "Not legal advice" disclaimer always on. Secrets never printed. Paid model calls cached and minimized.
- **Advantages** — Grounded, auditable answers; every run logged as an ACS issue record; teammates' agents can claim tasks remotely; works with any dataset, including Hugging Face corpora.
- **Sponsors** — Daytona (runtime, preview, local CI + triage), SurrealDB (graph + agent memory), ElevenLabs (voice), Arize (traces, auto-on with keys).

## Slides
1. Precedent — cited legal answers for people who can't afford legal research.
2. The problem — research is expensive; chatbots hallucinate case law.
3. Meet Maria — legal aid, 20 minutes, no Westlaw.
4. The agents — planner · retriever · answer · safeguard, coordinated by ACS inside Daytona.
5. Live demo — ask, watch the map light up, hear the answer.
6. Safeguards — no unretrieved citation survives; verbatim quotes; disclaimer; logged.
7. Why it matters — any jurisdiction, any dataset; open, auditable, cheap.
8. Thank you — Daytona · SurrealDB · ElevenLabs · Arize.

## 30-second voiceover
Legal research costs more than most people can pay, and chatbots make up case law. Precedent fixes that. Ask a question, and a team of agents goes to work inside Daytona: Octo finds the passages, SurrealDB follows the citations across Colorado's courts, Claude writes a short answer, and a safeguard rejects any authority that wasn't actually retrieved. You get real cases, real quotes, and a clear reminder to verify. Cited answers, for everyone.
