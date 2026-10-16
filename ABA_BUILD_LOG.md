# ABA build log (app-builder-automation, Dyad-based thin engine)

Runner: `node --env-file=aba_runs/aba.env ~/hack/aba/server/src/index.mjs generate --spec <spec> --template <tpl> --out <out>`
Model: claude-sonnet-4-5 (served claude-sonnet-4-5-20250929). Every run ends `FAILED` only because ABA's gate runs
`run_typecheck` (needs pnpm and a TS project). These are vanilla JS workspaces, so the gate can't pass. The files ABA wrote are real and are what we use.
Full prompts: `~/hack/aba_runs/spec_*.md`. Full transcripts: `~/hack/aba_runs/logs/*.log`. Log screenshots: `~/hack/shots/aba_*.png`.

## Run 1: declutter sidebar (spec_declutter.md → out_decl/declutter.js)
Prompt: collapsible left sidebar (300px, accordions: activity, sources, run history, voice, partners), hamburger, Esc/backdrop close, localStorage state.
Output: declutter.js plus README (3 files, 16 steps). Integrated in commit be303b1/0da43ae.
Hand patches: sidebar font 15.5-16px, 48px summaries, a larger labelled "Menu" toggle, backdrop, chevrons.
Today: the sidebar starts below the navbar (`--navh` measured from `<nav>`, so it no longer covers the brand), and the duplicate X close button is hidden (the toggle reads "Close").

## Run 2: navbar logo strip + Examples dropdown (spec_navbar.md → out_nav/navbar.js)
Prompt: "Built with" strip of 6 partners (18px, muted, brand color on hover, new-tab deep links from partners.js, tooltips), hide #badges hero pills,
an "Examples ▾" menu next to Ask (#exBtn/#exMenu, ARIA menu, arrows/Enter/Esc/click-outside) on / and /map.
Output: navbar.js (317 lines), deployed byte-for-byte unpatched (commit 4263866).

## Run 3: logo visibility fix (spec_navfix.md → out_navfix/navbar.js), 13:43 ET
Problem found in the headless screenshot: the black Anthropic/ElevenLabs marks were invisible on the dark nav, and Daytona/Arize were PNG placeholders.
Hand step first: downloaded official SVGs to static/vendor/logos/: simple-icons (anthropic, elevenlabs, surrealdb), Daytona's logotype from daytona.io/docs,
the Arize logo from Arize's docs (mintcdn arize-ax logo/dark.svg). Octo publishes no logo, so it stays a text wordmark.
Prompt: render the logos with a CSS mask (slate #94a3b8 at .75 by default, the brand color via --bw on hover/focus), per-logo widths, screen-reader text.
Output: ABA rewrote only the logo-rendering block (15 steps). Deployed as is.
Hand patch: `white-space:nowrap` on the label and `flex-shrink:0` on the strip ("BUILT WITH" was wrapping on /map).
