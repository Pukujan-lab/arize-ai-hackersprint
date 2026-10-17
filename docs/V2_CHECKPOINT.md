# Precedent v2 frontend checkpoint (2026-10-17, 3:06 PM EDT)

Resume point for any agent. Read AGENTS.md, contracts/openapi.json and docs/FRONTEND_INVENTORY.md (being added) first.

## Canonical address (with #92)
- The canonical address is the root, `https://arize.design-bakery.com/`, and it serves v2 (`static/v2.html`).
- `/v1` serves the old page (`static/index.html`) and is the fallback if v2 needs to be taken down.
- `/v2` still works and serves the same file as the root.
- The `arize-v2` subdomain is dropped, so no Cloudflare change is needed.

## Decision so far
- APPROVED DIRECTION (Alex, 3:06 PM EDT): the minimal layout is "a lot cleaner" and "a good approach" but needs more refinement before building. Next step: refine mockups against the real inventory and the real 3D render, then write the v2 build spec for ABA.
- Rebuild only the frontend as v2, served at the root (see Canonical address). Backend, API contracts, Octo, voice chain unchanged.
- KEEP AS IS: static/map3d.js, static/map3d.co.js, static/vendor county/state data, three.module, d3, topojson. The 3D county map, its exploration and the guided tour are the product moat.
- The problem is everything around the map: too many things visible at once.

## Layout rules
- Visible by default: answer, map, chat input. Nothing else.
- Chat input sticky at the BOTTOM; answer above; map in the center of the page.
- Everything else behind small buttons, dropdowns, drawers or bottom sheets (sources, follow-ups, legend, tour controls, run info).
- Map controls never overlap the map or step dots; legend behind a toggle; one popover at a time.
- Desktop favored: "Split" = map left, right column with answer, collapsed Sources and Follow-up dropdowns, input at bottom.
- Phone favored: answer, square map, pills Sources / Tour / Follow-ups opening bottom sheets, input at bottom.
- One collapsible sidebar (links only), no top navbar. Run history on /runs.
- Tour autoplays after the memo, starts at stop 1, visible pause/stop. Voice: Fish, then Kokoro, then browser.
- No overflow or overlap at 390, 768, 1024, 1440.
- Rejected: mockups that crowd the map with legends, cards and control rows; generic redesigns that ignore the existing map.

## Theme (added with #89)
- Dark is the default: `data-theme="dark"` is on `<html>` in the markup and an inline script in `<head>` re-applies a saved choice before the stylesheet paints, so there is no flash.
- One small toggle, `#theme-toggle` (aria-label "Toggle dark or light theme"), sits at the bottom of the icon rail. Light mode sets `data-theme="light"`.
- The choice is remembered in localStorage under `precedent-theme`.
- Both themes must pass the four-width no-overflow tests, so every colour comes from a token pair in `static/v2.css`.

## Built so far
- #89 (this issue): `/v2` home page. `static/v2.html` + `static/v2.css` + `static/v2.js`, served by `GET /v2` in `app/server.py`. The existing `static/map3d.js` is reused as is through `window.Docs3D`; visible by default are only the memo (`#answer`), the map (`#docs3d`) and the bottom composer (`#q`, `#go`). Sources, follow-ups, legend and run info are collapsed bottom sheets, and the tour autoplays from stop 1 after the memo.
- #92: v2 is now the root page. `GET /` serves `static/v2.html`, `GET /v2` stays as an alias, and `GET /v1` serves the old `static/index.html`. `contracts/openapi.json` and `docs/FRONTEND_INVENTORY.md` list `/v1`.

## Hard rules for builders
- Frontend changes via ABA only. Plain HTML/JS, no React/TS/shadcn, no new deps or CDNs.
- Reuse existing buttons and navigation from docs/FRONTEND_INVENTORY.md; don't invent new ones without reason.
- Tests first (Playwright at 4 widths). One issue per feature, PR says Closes #N, auto-merge, deploy, verify live.
- No secrets in issues, commits or docs.

## In flight
- Frontend inventory + agent discoverability (branch docs/frontend-inventory-87: docs/FRONTEND_INVENTORY.md, AGENTS.md links, CI test).
- Older ABA fixes on the v1 frontend (sidebar #50/#53/#54/#55, map #52/#62, tracker #58).

## Parked
- Call logs to Octo, stack lock, reuse-vs-build research: on hold.
- Issue #20 (Python upgrade, AUTOMERGE_TOKEN workflow scope). Rotate keys and the leaked tunnel token.
