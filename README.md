# Precedent — Arize AI HackerSprint demo

## How to run
```bash
pip install -r requirements.txt   # if present; otherwise install deps used by server.py
./run_all.sh                      # or: python server.py
```
Then open the served `static/index.html` / dashboard in a browser.

## Environment variables (names only — set in `.env`, never commit)
ANTHROPIC_API_KEY, OPENAI_BASE_URL, INFERHUB_API_KEY, DEFAULT_MODEL, LLM_MODE,
ARIZE_API_KEY, ARIZE_SPACE_ID, ARIZE_PROJECT_NAME,
ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID,
OCTO_API_KEY, OCTO_BASE_URL, OCTO_MODE, OCTO_WORKSPACE_ID, USE_OCTO,
DAYTONA_SANDBOX_ID

## Partners
Arize (tracing/evals), Anthropic (LLM), ElevenLabs (voice), Octo (retrieval), Daytona (sandbox).
