#!/bin/bash
# One-time: install the app + tunnel as launchd agents (KeepAlive). Usage: bash deploy/install_launchd.sh [app|tunnel|all]
set -eu; what=${1:-all}; D="$(cd "$(dirname "$0")" && pwd)"; LA="$HOME/Library/LaunchAgents"; U=$(id -u)
inst() { sed "s#__HOME__#$HOME#g" "$D/launchd/$1.plist" > "$LA/$1.plist"; launchctl bootout "gui/$U/$1" 2>/dev/null || true; launchctl bootstrap "gui/$U" "$LA/$1.plist"; echo "installed $1"; }
if [ "$what" = app ] || [ "$what" = all ]; then pkill -f "uvicorn server:app" || true; sleep 1; inst com.precedent.app; fi
if [ "$what" = tunnel ] || [ "$what" = all ]; then pkill -f "cftun/run.sh" || true; pkill -f "cftun/cloudflared" || true; sleep 1; inst com.precedent.tunnel; fi
