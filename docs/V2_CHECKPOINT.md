# Precedent v2 frontend checkpoint (2026-10-17, 3:05 PM EDT)

Resume point for any agent. Read AGENTS.md, contracts/openapi.json and docs/FRONTEND_INVENTORY.md (being added) first.

## Decision so far
- Rebuild only the frontend as v2 (target: arize-v2.design-bakery.com). Backend, API contracts, Octo, voice chain unchanged. Not yet approved to start building.
- KEEP AS IS: static/map3d.js, static/map3d.co.js, static/vendor county/state data, three.module, d3, topojson. The 3D county map, its exploration and the guided tour are the product moat.
- The problem is everything around the map: too many things visible at once.

## Layout rules
- Chat input sticky at the BOTTOM; answer above; map in the center of the page.
- Minimal visible UI: answer, map, input. Everything else behind small buttons, dropdowns, drawers or bottom sheets (sources, follow-ups, legend, tour controls, run info).
- Map controls never overlap the map or step dots; legend behind a toggle; one popover at a time.
- Desktop favored: "Split" = map left, right column with answer, collapsed Sources and Follow-up dropdowns, input at bottom.
- Phone favored: answer, square map, pills Sources / Tour / Follow-ups opening bottom sheets, input at bottom.
- One collapsible sidebar (links only), no top navbar. Run history on /runs.
- Tour autoplays after the memo, starts at stop 1, visible pause/stop. Voice: Fish, then Kokoro, then browser.
- No overflow or overlap at 390, 768, 1024, 1440.

## Hard rules for builders
- Frontend changes via ABA only. Plain HTML/JS, no React/TS/shadcn, no new deps or CDNs.
- Tests first (Playwright at 4 widths). One issue per feature, PR says Closes #N, auto-merge, deploy, verify live.
- No secrets in issues, commits or docs.

## In flight
- Frontend inventory + agent discoverability (branch docs/frontend-inventory-87: docs/FRONTEND_INVENTORY.md, AGENTS.md links, CI test).
- Older ABA fixes on the v1 frontend (sidebar #50/#53/#54/#55, map #52/#62, tracker #58).

## Parked
- Call logs to Octo, stack lock, reuse-vs-build research: on hold.
- Issue #20 (Python upgrade, AUTOMERGE_TOKEN workflow scope). Rotate keys and the leaked tunnel token.
