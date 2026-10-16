# LLM-as-judge (InferHub deepseek-v4.1-flash) -> Arize

**Judge model:** `deepseek-v4.1-flash` via InferHub, an OpenAI-compatible endpoint at `https://api.inferhub.dev/v1`. Set `JUDGE_MODEL` to override it.
**Judges** (one call per span; each returns label + score + explanation, and Arize evals are named `judge_*`):
- `judge_groundedness`: grounded/ungrounded. Score = fraction of claims the retrieved passages support.
- `judge_hallucination`: factual/hallucinated. 1 = hallucinated.
- `judge_citation_relevance`: relevant/irrelevant. Score = fraction of cited authorities that are relevant.
- `judge_legal_safety`: safe/unsafe. 1 = informational, with no personalized legal-advice framing.
Every explanation is prefixed with `[deepseek-v4.1-flash via InferHub]`.

## Run it (on the Mac; the sandbox can't reach Arize)
```
uv venv -p 3.12 /tmp/arz312 && VIRTUAL_ENV=/tmp/arz312 uv pip install arize pandas openai pyarrow
# load INFERHUB_API_KEY, ARIZE_API_KEY, ARIZE_SPACE_ID, ARIZE_PROJECT_NAME from the sandbox ~/.hack_env without printing them:
ssh -o BatchMode=yes <sandbox> 'grep -E "^export (INFERHUB_API_KEY|ARIZE_[A-Z_]+)=" ~/.hack_env' > ~/judgework/.env; chmod 600 ~/judgework/.env
set -a; source ~/judgework/.env; set +a
/tmp/arz312/bin/python arize/judge.py --from-arize=20       # judge the last 20 `pipeline` spans and log the evals to Arize
/tmp/arz312/bin/python arize/judge.py file.json --no-log    # offline: [{span_id,question,answer,passages:[{title,passage}]}]
```
Results are also written to `judge_results.csv`. Cost: about $0.00001 per span (InferHub minimum charge).

## Online (continuous) evaluator, created via the API with `arize/setup_online_judge.py`
These were created on 2026-10-16:
- AI integration `inferhub`: provider CUSTOM (OpenAI-compatible), base URL `https://api.inferhub.dev/v1`, model `deepseek-v4.1-flash`
- Template evaluator `judge_groundedness_online`: grounded=1 / ungrounded=0, with explanations
- Continuous task `judge_online_inferhub`: project `precedent-legal-graphrag`, filter `name = 'pipeline'`, sampling 100%

**Check in the UI:** Project → Evals/Tasks → `judge_online_inferhub` should be listed and running. Caveat: the `pipeline` span doesn't carry the retrieved documents (they're on the child `retriever` span), so the template's `{documents}` variable is mapped to the input for now. In the UI, edit the task's column mapping, or switch it to trace-level and map `documents` to the retriever's `attributes.retrieval.documents`.

If the UI or API ever blocks this (enterprise-only), here are the manual steps:
1. Settings → AI Providers / Integrations → Add → **Custom (OpenAI-compatible)**. Name `inferhub`, Base URL `https://api.inferhub.dev/v1`, API key = InferHub key, Model `deepseek-v4.1-flash`.
2. Project `precedent-legal-graphrag` → **Evals** → **New Task** → LLM-as-a-Judge → provider `inferhub`, model `deepseek-v4.1-flash`.
3. Paste the template from `setup_online_judge.py`, choose classification grounded/ungrounded, turn explanations on, filter `name = 'pipeline'`, sampling 100%, Run continuously → Save.
