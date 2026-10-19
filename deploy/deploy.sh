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
  local want=""
  git cat-file -e "$1:web/package.json" 2>/dev/null && want="$1"
  bash deploy/health.sh "$want" http://127.0.0.1:3000 "$PUBLIC"
}
point_dist() {
  [ -d "web/releases/$1" ] || return 0
  if [ -L web/dist ] || [ -f web/dist ]; then rm -f web/dist; elif [ -d web/dist ]; then rm -rf web/dist; fi
  ln -s "releases/$1" web/dist
}
# The frontend is built from the exact commit being deployed, before the live checkout moves. A failed build
# leaves the running site untouched. Builds are inert until web/ carries a package.json.
build_frontend() {
  local rev=$1 out node_bin
  git cat-file -e "$rev:web/package.json" 2>/dev/null || return 0
  node_bin=$(command -v node || ls -d "$HOME"/.nvm/versions/node/*/bin/node 2>/dev/null | tail -1)
  if [ -z "$node_bin" ]; then echo "::error::node is required to build web/"; return 1; fi
  export PATH="$(dirname "$node_bin"):$PATH"
  command -v pnpm >/dev/null || corepack enable >/dev/null 2>&1 || true
  if ! command -v pnpm >/dev/null; then echo "::error::pnpm is required to build web/"; return 1; fi
  out=$(mktemp -d)
  if ! git archive "$rev" web | tar -x -C "$out"; then rm -rf "$out"; return 1; fi
  if ! ( cd "$out/web" && pnpm install --frozen-lockfile && BUILD_ID="$rev" pnpm build ); then rm -rf "$out"; return 1; fi
  if [ ! -d "$out/web/dist" ]; then echo "::error::web build produced no dist/"; rm -rf "$out"; return 1; fi
  mkdir -p web/releases
  rm -rf "web/releases/$rev"
  mv "$out/web/dist" "web/releases/$rev"
  rm -rf "$out"
  point_dist "$rev"
}
switch() {
  git reset --hard --quiet "$1" && [ -f "/tmp/precedent-assignment-$ts.json" ] && cp -p "/tmp/precedent-assignment-$ts.json" .coord/assignment.json
  .venv/bin/pip install -q -r requirements.txt || return 1
  # Data model: apply pending migrations/ to the Octo workspace (schema_version must match schema/SCHEMA_VERSION).
  # Non-fatal: if Octo is unreachable the app runs on its local TTS cache and /api/health shows data_schema.ok=false.
  ( set -a; . "$HOME/.hack_env" 2>/dev/null; set +a; .venv/bin/python -m schema.migrate --apply && .venv/bin/python -m schema.backfill ) || echo "::warning::schema migrate did not complete (app falls back to local TTS cache)"
  point_dist "$1"
  launchctl kickstart -k "gui/$(id -u)/$LABEL"
}
build_frontend "$NEW" || { echo "::error::frontend build failed for $NEW; the running site is untouched"; exit 1; }
switch "$NEW"; if health "$NEW"; then echo "deployed $NEW"; exit 0; fi
echo "::error::health check failed for $NEW, rolling back to $PREV"
[ -d "web/releases/$PREV" ] || build_frontend "$PREV" || true
switch "$PREV"; health "$PREV" && echo "rolled back to $PREV"; exit 1
