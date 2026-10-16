#!/usr/bin/env bash
# Starts SurrealDB + graph load + web app in parallel; prints summary.
cd "$(dirname "$0")"; source ~/.bashrc 2>/dev/null; [ -f ~/.hack_env ] && source ~/.hack_env; mkdir -p logs
# acs-demo-key:start
# Reuse the private ACS key without copying it into the repository.
if [ -z "$ANTHROPIC_API_KEY" ]; then
  ANTHROPIC_API_KEY="$(python3 - <<'ACS_PRIVATE_KEY'
import os, stat
from pathlib import Path
p = Path.home() / '.config/acs/anthropic-api-key'
fd = os.open(p, os.O_RDONLY | os.O_NOFOLLOW)
with os.fdopen(fd) as stream:
    info = os.fstat(stream.fileno())
    if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise SystemExit('Claude key must be owned by this user with mode 600')
    key = stream.read(16385).strip()
if not key or len(key) > 16384 or any(c.isspace() for c in key):
    raise SystemExit('Saved Claude key is empty or malformed')
print(key, end='')
ACS_PRIVATE_KEY
)" || exit 1
  export ANTHROPIC_API_KEY
fi
# acs-demo-key:end
if ! curl -sf localhost:8000/health >/dev/null; then
  nohup ./bin/surreal start --bind 0.0.0.0:8000 --user root --pass root memory > logs/surreal.log 2>&1 &
  for i in $(seq 30); do curl -sf localhost:8000/health >/dev/null && break; sleep 0.5; done
  python3 load_surreal.py > logs/load.log 2>&1 &
  LOADPID=$!
fi
pkill -f "uvicorn server:app" 2>/dev/null; sleep 0.5
[ -n "$LOADPID" ] && wait $LOADPID
nohup python3 -m uvicorn server:app --host 0.0.0.0 --port 3000 > logs/web.log 2>&1 &
for i in $(seq 60); do curl -sf localhost:3000/api/health >/dev/null && break; sleep 0.5; done
echo "=== Legal GraphRAG demo ==="
echo "SurrealDB : $(curl -sf localhost:8000/health >/dev/null && echo up :8000) $(tail -1 logs/load.log 2>/dev/null)"
echo "Web app   : $(curl -s localhost:3000/api/health)"
echo "Preview   : https://3000-${DAYTONA_SANDBOX_ID}.proxy.daytona.works"
for v in ANTHROPIC_API_KEY ELEVENLABS_API_KEY ARIZE_API_KEY; do [ -n "${!v}" ] && echo "$v: set" || echo "$v: not set"; done
