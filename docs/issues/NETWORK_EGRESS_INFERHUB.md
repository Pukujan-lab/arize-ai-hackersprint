# Issue: Sandbox outbound access blocked for InferHub and Octo

- **Date:** 2026-10-16, about 3:05 PM ET (Daytona HackSprint NYC)
- **Sandbox:** hpm8ocjo7sx9gya1
- **Status:** open, waiting on Daytona to allow these hosts

## Symptom
Calls from the app to InferHub (`OPENAI_BASE_URL=https://api.inferhub.dev/v1`, model `cb/deepseek-v4.1-flash`) fail with "fetch failed" or a connection reset. Every answer falls back to Anthropic Haiku, which spends limited Anthropic credit.

## Tests run from the sandbox
- **DNS:** works. api.inferhub.dev resolves to Cloudflare IPs (104.21.8.66, 172.67.138.161).
- **IPv6:** no route ("Network is unreachable"). curl falls back to IPv4 automatically.
- **IPv4:** the TCP connection opens, then is reset during the TLS handshake. This happens with or without an auth header.
- **Same reset on:** octodb.design-bakery.com, www.google.com, workers.cloudflare.com, api.together.xyz
- **These hosts work:** api.anthropic.com, api.openai.com, api.deepseek.com, openrouter.ai, api.groq.com, api.elevenlabs.io, github.com, pypi.org, otlp.arize.com, vercel.com, *.vercel.app
- **Same request from a laptop outside the sandbox:** returns 401 without a key, so the service is up.
- **Config:** no proxy env vars set. Env var names match what llm.py reads.

## Conclusion
The sandbox only allows outbound traffic to a list of approved hostnames. The app config is correct.

## Request to Daytona
Allow outbound HTTPS (port 443) for:
- api.inferhub.dev
- octodb.design-bakery.com

## Workarounds
1. Use a provider that is already allowed (api.deepseek.com or openrouter.ai). This needs a key.
2. Run a small private relay on Vercel (*.vercel.app is allowed) that forwards requests to InferHub.
3. For today: Haiku is the primary model. InferHub DeepSeek becomes the backup once the hosts above are allowed.
