# Precedent UX suggestions

Updated: October 16, 2026

## Status and intent

The user requested restoration of the original design. The dark interface, prominent citation map, answer area, agent seats, event log, task board, voice controls, and sponsor dashboard are the current baseline. The reading-focused redesign was rolled back. This document records suggestions for discussion; it does not authorize another redesign or automatic application of these changes.

Improve the experience for someone doing preliminary legal research: ask a question, understand the draft answer, inspect the cited authority, and recognize what has and has not been checked. A paralegal or law student is a working audience assumption, not a confirmed user-research finding.

## Preserve before changing

- Keep the original visual identity and the visibility and placement of the map, agent activity, voice, task board, and sponsor content unless the user approves a specific change.
- Keep the existing question examples, model and retrieval pipeline, citation checks, disclaimer, API contracts, rate limits, cached responses, voice bridge, dashboard/slides navigation, and case-link helpers.
- Do not replace a collaborator's files or move whole sections as part of a small readability improvement.
- Treat the reverted reading layout as a reference, not the accepted replacement.

## Suggested improvements, in priority order

### 1. Describe checks precisely

The observed safeguard checks whether references match retrieved authorities. Its PASS result does not establish that the answer is legally correct, relevant, or current.

Suggested copy: **"3 references matched retrieved sources"** followed by **"This checks references, not legal accuracy or whether the law is current."** Avoid using "0 hallucinated" or "every citation verified" as broad accuracy claims. Keep the legal-advice disclaimer visible.

Show an explicit template/offline label when a live model was not used. Do not imply a cached answer is a fresh model call.

### 2. Make source evidence easier to inspect

- Let users select an inline reference and find the corresponding authority without losing their place.
- Show the title, jurisdiction/court, date, supplied passage, and source links when available. Label missing information rather than guessing it.
- For graph-only results, explain that titles and citation relationships cannot establish what the law requires.
- Distinguish an excerpt from a full original document. Keep links to original authorities and existing case-link helpers.
- Check the case-file viewer's passage rendering: it was observed displaying a trailing fragment while the full supplied passage was available elsewhere. Avoid extracting only the last line.

### 3. Improve reading within the current design

- Try a body text size around 16px and line height around 1.6–1.8; review actual answers before choosing values.
- Give headings, paragraphs, and lists consistent spacing. Limit long answer lines to roughly 65–75 characters where practical.
- Keep the current dark palette. Check text and focus contrast before adjusting colors.
- Avoid a new font, framework, or global style reset for small changes. Preserve the vendored libraries.

These are proposed ranges, not approved design tokens.

### 4. Clarify progress and failures

- Distinguish idle, researching, completed, empty, failed, and template-response states.
- Prevent duplicate submission while a request is active.
- If polling fails after a run ID is received, offer to check that same run again. Do not automatically issue another model request.
- If a submission times out before confirmation, explain that it may already have started.
- Preserve typed questions after a failure and provide a clear next action.

### 5. Check mobile and keyboard access

- Test the actual question, answer, source, map, and voice flows at 390px width. Confirm there is no horizontal document overflow.
- Keep the microphone and other floating controls from covering source text. Propose any relocation before applying it.
- Use real labels, visible keyboard focus, descriptive button names, and sufficiently large touch targets.
- Test Tab, Enter, Escape, and source navigation. Check that global voice shortcuts do not prevent keyboard activation of normal controls.
- Respect reduced-motion preferences; provide a readable source list alongside animated maps and case files.

## Small-change workflow

1. Read `HACKATHON_POLICY.md`, inspect the current live file, and claim a task before editing.
2. Agree on one issue and its exact scope. Show a preview for changes to section placement, visual identity, or interaction behavior.
3. When a Git repository is available, use a short branch such as `fix/source-reference-labels` or `docs/ux-guidelines`. Do not use a `codex/` prefix. Do not assume the VM demo directory is Git-backed.
4. Back up changed files and check for concurrent edits immediately before writing. Keep unrelated collaborator work.
5. Use recorded fixtures or cached questions first. Check the actual rendered UI and relevant failure states; avoid extra paid model or voice calls.
6. Report the files changed, checks performed, known limits, and rollback path. Deploy only within the agreed scope.

## Evidence and limits

The reverted prototype was checked on desktop and in 390px Chrome emulation. The checks covered a cached Claude answer, inline source selection, source excerpts, graph and case-file display, keyboard tabs, missing-link labels, template labels, and recovery from polling failure without another POST. This is evidence for the proposed interaction patterns, not proof that the restored original implements them. No physical-phone or microphone/audio verification was performed in that UI pass. Legal accuracy was not validated.

## Where this lives

- VM guidelines: `/home/daytona/hack/demo/UX_GUIDELINES.md`
- ACS issue: topic `ux-guidelines`, kept open for discussion.
- Original-design backup: `/home/daytona/.cache/acs/ui-backups/index-20261016-before.html`
- Saved redesign before rollback: `/home/daytona/.cache/acs/ui-backups/index-20261016-redesign.html`

The rollback retained the collaborator's newer vendored libraries and case-link helpers. Backend and other static modules were not rolled back.

The VM file persists between agent sessions while the sandbox exists. It is not a durable backup if the sandbox is deleted. A local copy is retained outside the VM. No GitHub publication is implied by this document.
