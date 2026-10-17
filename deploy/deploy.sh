#!/bin/bash
# CD for the Pro: update ~/precedent to origin/main, install deps, restart via launchd, health-check, roll back on failure.
# Fails closed (no reset) if the checkout has uncommitted code changes, so live hotfixes are never wiped.
set -uo pipefail
APP=${APP_DIR:-$HOME/precedent}; LABEL=com.precedent.app; PUBLIC=${PUBLIC_URL:-https://arize.design-bakery.com}
cd "$APP" || exit 1
ts=$(date +%Y%m%d%H%M%S)
dirty=$(git status --porcelain --untracked-files=no -- . ':(exclude).coord' ':(exclude)uvicorn.log')
# Changes already merged upstream (working file == origin/main) are safe to reset over.
git fetch --quiet origin main || exit 1
if [ -n "$dirty" ]; then
  unmerged=""
  for f in $(git diff --name-only HEAD -- . ':(exclude).coord' ':(exclude)uvicorn.log'); do
    if [ -e "$f" ]; then [ "$(git hash-object "$f")" = "$(git rev-parse -q --verify "origin/main:$f" 2>/dev/null)" ] || unmerged="$unmerged $f"
    else git cat-file -e "origin/main:$f" 2>/dev/null && unmerged="$unmerged $f"; fi
  done
  [ -z "$unmerged" ] && { echo "local changes are all merged in origin/main; continuing"; dirty=""; } || echo "unmerged local changes:$unmerged"
fi
if [ -n "$dirty" ] && [ "${CONFIRM_RESET_OVER_LOCAL:-false}" = true ]; then
  git diff > "$HOME/precedent-uncommitted-$ts.patch"; echo "::warning::resetting over local changes on operator confirmation (saved ~/precedent-uncommitted-$ts.patch)"; dirty=""
fi
if [ -n "$dirty" ]; then
  git diff > "/tmp/precedent-uncommitted.$$"
  last=$(ls -t "$HOME"/precedent-uncommitted-*.patch 2>/dev/null | head -1)
  if [ -n "$last" ] && cmp -s "$last" "/tmp/precedent-uncommitted.$$"; then rm -f "/tmp/precedent-uncommitted.$$"; ts=${last##*uncommitted-}; ts=${ts%.patch}
  else mv "/tmp/precedent-uncommitted.$$" "$HOME/precedent-uncommitted-$ts.patch"; fi
  echo "::error::~/precedent has uncommitted changes (saved to ~/precedent-uncommitted-$ts.patch). Merge them upstream first; not deploying."
  echo "$dirty"; exit 1
fi
cp -p .coord/assignment.json "/tmp/precedent-assignment-$ts.json" 2>/dev/null || true   # runtime claim state
PREV=$(git rev-parse HEAD)
git fetch --quiet origin main || exit 1
NEW=$(git rev-parse origin/main)
if [ "$PREV" = "$NEW" ] && [ "${FORCE_DEPLOY:-0}" != 1 ]; then echo "already at $NEW"; exit 0; fi
echo "deploy $PREV -> $NEW"
health() {
  for i in $(seq 1 30); do
    if curl -fsS -m 5 http://127.0.0.1:3000/api/health >/dev/null && curl -fsS -m 10 "$PUBLIC/api/health" >/dev/null; then echo "healthy (try $i)"; return 0; fi
    sleep 3
  done; return 1
}
switch() {
  git reset --hard --quiet "$1" && [ -f "/tmp/precedent-assignment-$ts.json" ] && cp -p "/tmp/precedent-assignment-$ts.json" .coord/assignment.json
  .venv/bin/pip install -q -r requirements.txt || return 1
  launchctl kickstart -k "gui/$(id -u)/$LABEL"
}
switch "$NEW"; if health; then echo "deployed $NEW"; exit 0; fi
echo "::error::health check failed for $NEW, rolling back to $PREV"
switch "$PREV"; health && echo "rolled back to $PREV"; exit 1
