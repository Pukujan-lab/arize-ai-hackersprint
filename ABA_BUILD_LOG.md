
## Fri Oct 16 06:21:05 PM UTC 2026 demo slide
ABA not used: spec_demo_slide.md missing and no provider key in env; dyad-pro builds whole apps. Hand-coded slide 6 (Ask, then follow up) in static/slides.html.

## Fri Oct 16 06:44:27 PM UTC 2026 observability page
ABA attempted: spec ~/hack/aba_runs/spec_observability.md, workspace out_obs, iterate mode. Previous provider is over its usage limit until 2026-11-01. I switched to InferHub (BUILDER_BASE_URL=https://api.inferhub.dev/v1, model deepseek-v4.1-flash). The run failed with "provider request failed: fetch failed" because the sandbox has no egress to InferHub (log: logs/observability.log). Hand-coded static/observability.html. Data: static/data/observability.json, exported from Arize on the Mac (18 pipeline traces, 72 spans, judge_* evals, dataset/experiment summary).
