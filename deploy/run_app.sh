#!/bin/bash
# launchd wrapper for the app (no --reload; ACS config hot-reloads in-process via acs/hotload.py).
cd "$HOME/precedent" || exit 1
set -a; . "$HOME/.hack_env"; set +a
export RUNS_SHOW_LEGACY=1
exec .venv/bin/uvicorn app.server:app --host 127.0.0.1 --port 3000
