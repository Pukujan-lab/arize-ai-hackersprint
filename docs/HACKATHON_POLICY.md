# Hackathon policy (short mirror; canonical: ~/hack/demo/HACKATHON_POLICY.md)
Priority: speed > delivery > presentation > completeness.
- Smallest working slice; no refactors of working code.
- Fake/template fallbacks OK only if labeled.
- Minimize paid LLM calls (cache, Haiku/DeepSeek, max_tokens<=600).
- Never print secrets. Citation safeguard + disclaimer always on.
- Feature freeze 3:00 PM ET; submit by 3:30 PM ET.
- Claim tasks via ~/hack/demo/acs_claim.py (board.json here, file-locked).

## Git workflow (added 2026-10-16 16:45 UTC)
- ~/hack/demo is now a git repo (branch `main` = what is deployed on :3000). Local only; do not push to GitHub.
- Before working: claim a task (`python3 acs/claim.py claim <TASK> --agent <you>` or POST /api/claim), then `git switch -c <you>/<task>`.
- Commit small steps on your branch; merge into `main` to deploy (static files are live right away; app/server.py changes need `tools/run_all.sh`).
- Never commit secrets: keys live only in ~/.hack_env (mode 600, gitignored). cache/, runs/, data/, logs/, bin/, *.mp4 are ignored.
- Back up any file before overwriting it if you're not on a branch.
