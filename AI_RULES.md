# AI_RULES.md

Project guidance for coding agents working on **Precedent** — a legal research memo app: a FastAPI
backend runs four agents (planner → retriever → answer → safeguard) and a React frontend renders the
memo plus a WebGL citation map. `AGENTS.md` holds the repo process rules; this file holds the stack
and library rules.

## Tech stack

- **Backend:** Python 3.9+ (Pro runs 3.9, CI runs 3.10+) with **FastAPI** served by **uvicorn** as
  `app.server:app`. The top-level `server.py` is a shim only — put nothing in it.
- **Frontend:** **React 19 + TypeScript**, built with **Vite 8** (SWC plugin) and **pnpm 10**. Source
  lives in `web/src/`; the build output (`web/dist/`) is not committed.
- **Styling:** **Tailwind CSS 3.4** with the shadcn/ui token layer (`hsl(var(--…))`, dark mode via the
  `class` strategy) and `tailwindcss-animate`.
- **UI components:** **shadcn/ui** on Radix primitives, generated into `web/src/components/ui/`
  (style `default`, base colour `slate`, aliases `@/components`, `@/components/ui`, `@/lib/utils`).
- **Routing:** **react-router-dom 6**; every route is declared in `web/src/App.tsx`.
- **Data:** JSON routes on the same origin (`/api/ask`, `/api/run/<id>`, `/api/runs`, `/api/stack`,
  `/api/tts_ts`) fetched with `fetch`; a device id is attached to `/api/*` calls by
  `web/src/lib/session.ts`.
- **Map:** hand-written **WebGL** (`web/src/map/gl.ts`) with a Canvas 2D fallback and a hand-rolled
  camera/pin layout in `web/src/map/engine.ts`. No mapping or 3D library is used.
- **Voice:** server TTS chain (Fish Audio → ElevenLabs → local Kokoro) behind `/api/tts_ts`, with the
  browser's own `speechSynthesis` as the last resort. All narration goes through
  `web/src/map/narrator.ts`.
- **Backend libs:** `networkx` (case graph), `numpy`/`scipy` (ranking), `httpx`/`requests` (HTTP),
  `arize-otel` + `openinference-instrumentation` (tracing/evals). Storage is Octo (HTTP) and SurrealDB
  (with a NetworkX fallback).
- **Quality gates:** `ruff` (line length 160) and `mypy` for Python, `eslint` + `tsc` for the web app,
  `pytest` (offline via `LLM_MODE=fake`).

## Library rules — what to use for what

### Frontend

- **Anything with a UI primitive** → import from `@/components/ui/*` (button, dialog, tabs, select,
  tooltip, card, input…). Do not rebuild a primitive by hand.
- **`web/src/components/ui/` is generated shadcn code — do not edit it.** Need different behaviour?
  Compose it inside a new component in `web/src/components/`, or add the missing shadcn component.
- **Icons** → `lucide-react` only. No icon fonts, no inline SVG icon sets, no emoji as icons.
- **Class names** → Tailwind utilities plus `cn()` from `@/lib/utils` (`clsx` + `tailwind-merge`) for
  conditional classes. No CSS modules, no styled-components, no ad-hoc `.css` files for components.
  Colours come from the theme tokens (`bg-card`, `text-muted-foreground`, `border-border`), never raw
  hex, so light and dark both work.
- **Routes** → `react-router-dom` (`BrowserRouter`, `Routes`, `Route`, `useSearchParams`), declared in
  `web/src/App.tsx`. The default page is `web/src/pages/Index.tsx`. Keep all custom routes above the
  catch-all `*` route.
- **HTTP** → plain `fetch` through `readJson()` in `web/src/lib/runs.ts` (and `loadRun()` in
  `Index.tsx` for polling a run). `@tanstack/react-query` is installed but the app does not use it —
  do not introduce a second data layer; match the existing `useState` + effect pattern.
- **Response shapes** → parse unknown JSON with the `to*` helpers and `num`/`text`/`show` in
  `web/src/lib/runs.ts`. A field the server did not send stays `null` and renders "No data yet" —
  never invent a `0` or a placeholder value.
- **Forms/validation** → controlled inputs plus `useState` (see the ask form in `Index.tsx`).
  `react-hook-form` + `zod` exist only as shadcn dependencies; only reach for them if a form genuinely
  needs schema validation.
- **Toasts** → `sonner` via `web/src/utils/toast.ts`. No `alert()`, no bespoke toast component.
- **Dates and numbers** → `Intl`/`toLocaleString` helpers in `web/src/lib/runs.ts`. `date-fns` is
  available for anything non-trivial; do not hand-roll date maths.
- **Charts** → `recharts` through `@/components/ui/chart`. Do not add a second charting library.
- **Overlays and menus** → Radix-backed shadcn components (dialog, drawer/`vaul`, dropdown-menu,
  popover, tooltip, command/`cmdk`). No other modal or menu library.
- **The map** → extend `web/src/map/engine.ts` / `gl.ts`. Do **not** add deck.gl, three.js, Mapbox,
  Leaflet or any mapping dependency; the geometry, camera and pin layout are intentional and tested
  through the debug surface in `web/src/map/debug.ts`.
- **Animation** → CSS transitions/Tailwind animation utilities, or `requestAnimationFrame` in the
  engine. Any motion must honour `prefers-reduced-motion` (see `engine.ts`).
- **New npm dependency** → last resort. Check `web/package.json` first (it already ships Radix,
  recharts, cmdk, vaul, embla, sonner, zod, date-fns, lucide). If you add one, justify it in the PR
  and keep it out of the bundle when it is only used on one route.

### Backend

- **HTTP calls to a provider that ships an official SDK** (Anthropic, any [OI]-compatible API such as
  InferHub, ElevenLabs, Fish Audio, Google GenAI, Arize) → use that SDK, not raw `httpx`/`requests`.
- **Plain HTTP for anything without an SDK** → `httpx` for new code, `requests` only where it already
  exists.
- **New direct dependency** → add to `requirements.in`, then regenerate the lock with the `uv pip
  compile` command at the top of `requirements.txt`. Never edit `requirements.txt` by hand. Allowed
  licences: MIT, BSD, Apache, ISC, PSF, MPL-2.0, Unlicense, 0BSD, Zlib, CC0 — nothing GPL-family.
- **Reuse before you write** (owner's rule): look for a maintained package or a tool already in
  `requirements.in` before hand-writing a module. Hand-written code is for reproduced bug fixes and
  repairs to existing pipelines (`app/agents.py`, `app/llm.py`, `app/ttschain.py`).
- **Data model changes** → edit `schema/`, bump `SCHEMA_VERSION`, add the next numbered migration in
  `migrations/` (never edit a released one), run `python -m schema.lock`, and bump
  `storage_schema_version` in `contracts/storage.json`.
- **API shape changes** → update `contracts/openapi.json` in the same change; CI drift-checks it.
- **Tests** → `pytest`, one behaviour per file, named `tests/test_<thing>.py`, offline with
  `LLM_MODE=fake`. Anything needing a live server, browser or secret gets the `live` marker.

## Project layout

- `app/` — FastAPI backend package (`server.py`, `agents.py`, `llm.py`, `graph_store.py`,
  `octo_retriever.py`, `ttschain.py`, `coord.py`, `contracts.py`).
- `web/src/pages/` — one file per route (`Index.tsx` is `/`), `web/src/components/` — app components,
  `web/src/components/ui/` — shadcn primitives (do not edit), `web/src/lib/` — pure helpers,
  `web/src/map/` — the map engine, `web/src/hooks/` — hooks.
- `schema/`, `migrations/` — the versioned Octo data model. `contracts/` — API, agent and storage
  contracts. `acs/` — agent coordination. `tests/`, `tools/`, `deploy/`, `docs/`.
- A new top-level file or folder must be added to `repo.manifest.json` in the same change.

## Non-negotiables

- Never commit secrets. Refer to them by variable name only (`INFERHUB_API_KEY`,
  `ANTHROPIC_API_KEY`, `ELEVENLABS_API_KEY`, `ARIZE_API_KEY`, `OCTO_API_KEY`, `FISH_API_KEY`).
- Never commit runtime data (`cache/`, `runs/`, `data/`, `logs/`, `.tts_cache/`, `web/dist/`,
  `web/node_modules/`).
- The safeguard checks citations, not legal reasoning. Any answer shown to a reader keeps the
  "AI-generated research summary, not legal advice" line.
- Do not hand-edit the block between the `cgm:always-on` markers in `AGENTS.md`; change the pin
  instead.
