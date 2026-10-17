# Precedent

Precedent is a reliable pipeline for multi-agent AI. Several agents split up a job,
each one claims its piece, and every answer is checked before it goes out.

The first use case is legal research: verified research memos for law firms and
in-house legal teams. You ask a question, the agents pull the relevant cases, walk
the citation graph, draft a short memo with exact quotes, and a guard step refuses
anything it can't back up.

Live at https://arize.design-bakery.com.

## Layout

The backend is a FastAPI app; its modules sit at the repo root.

- `server.py` - the FastAPI app and API routes
- `agents.py` - the agent pipeline
- `llm.py` - model calls: InferHub DeepSeek first, then Anthropic Haiku, then a plain template if both fail
- `graph_store.py` - the case/citation graph (SurrealDB, with a NetworkX fallback)
- `coord.py`, `acs_board.py`, `acs_claim.py` - agent coordination (who claims what); state lives in `.coord/`
- `tracing.py` - tracing to Arize

`static/` holds the frontend: plain HTML and JS, no build step. Pages: demo
(`index.html`), map, dashboard, slides, guide, observability.

Other folders:

- `tests/` - tests
- `ci/` - CI triage scripts
- `tools/` - screenshots, video, Arize helpers
- `arize/` - Arize experiments and judge setup
- `issues/` - notes on open issues

## Running it

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
uvicorn server:app --port 3000
```

Then open http://localhost:3000.

Set these environment variables (in your shell or a local `.env` - never commit it):

- `INFERHUB_API_KEY`
- `ANTHROPIC_API_KEY`
- `ARIZE_API_KEY`, `ARIZE_SPACE_ID`, `ARIZE_PROJECT_NAME`
- `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`
- `OCTO_API_KEY`, `OCTO_WORKSPACE_ID`, `OCTO_BASE_URL`
- `GRAPH_DATA_DIR` - where the case data lives (defaults to `data/` in the repo)

Note: the case data (`data/nodes.jsonl`, `data/edges.jsonl`) isn't in the repo yet.

## How it was built

Built with ABA. See `ABA_BUILD_LOG.md` for the build log.
