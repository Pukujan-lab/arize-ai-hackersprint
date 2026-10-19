#!/bin/bash
# Fail unless every given URL answers /api/health and serves a page built from the expected commit.
# usage: health.sh <expected-commit|""> <url>...
# An empty expected commit skips the build-id check (the frontend is not built from a package.json yet).
set -uo pipefail
expected=${1:-}; shift
[ $# -gt 0 ] || { echo "usage: health.sh <expected-commit|\"\"> <url>..." >&2; exit 2; }

build_id() {
  curl -fsS -m 10 "$1/" 2>/dev/null \
    | grep -oE '<meta[^>]+name="build-id"[^>]+content="[^"]+"' \
    | grep -oE 'content="[^"]+"' | head -1 | cut -d'"' -f2
}

for try in $(seq 1 "${HEALTH_TRIES:-30}"); do
  ok=1
  for base in "$@"; do
    if ! curl -fsS -m 5 "$base/api/health" >/dev/null; then ok=0; break; fi
    if [ -n "$expected" ]; then
      got=$(build_id "$base")
      if [ "$got" != "$expected" ]; then
        echo "::error::$base serves build ${got:-none}, expected $expected"
        ok=0; break
      fi
    fi
  done
  if [ "$ok" = 1 ]; then echo "healthy (try $try)"; exit 0; fi
  sleep 3
done
exit 1
