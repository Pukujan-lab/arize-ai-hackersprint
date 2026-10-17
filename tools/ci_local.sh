#!/usr/bin/env bash
# Local CI mirror of .github/workflows/ci.yml (offline), plus demo tests and offline issue triage.
set -u; cd "$(dirname "$0")/.."; DEMO=$PWD; REPO=~/hack/legal-graphrag-starter; rc=0
echo "== [1/3] upstream repo tests (pytest -m 'not live and not integration') =="
(cd $REPO && python3 -m pytest -q -m "not live and not integration" -p no:cacheprovider 2>&1 | tail -5) || rc=1
echo "== [2/3] demo agent tests (LLM_MODE=fake) =="
LLM_MODE=fake python3 -m pytest -q -p no:cacheprovider tests 2>&1 | tail -3 || rc=1
echo "== [3/3] offline issue triage (oio_triage.py, GitHub API stubbed) =="
python3 ci/triage_local.py ci/fake_issue_event.json > ci/triage_decision.txt 2>&1; t=$?
head -c 600 ci/triage_decision.txt; echo; tail -1 ci/triage_decision.txt
python3 ci/triage_to_oio.py ci/triage_decision.txt ci/fake_issue_event.json
echo "CI result: $([ $rc = 0 ] && echo PASS || echo FAIL) (triage exit $t)"
