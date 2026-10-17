"""Run upstream .github/scripts/oio_triage.py offline: GitHub API stubbed, writes recorded to a local JSONL file."""

import sys, os, json, importlib.util, pathlib

REPO = pathlib.Path(os.environ.get("REPO", "/home/daytona/hack/legal-graphrag-starter"))
OUT = pathlib.Path(os.environ.get("TRIAGE_OUT", pathlib.Path(__file__).parent / "triage_api_calls.jsonl"))
sys.argv[1] = str(pathlib.Path(sys.argv[1]).resolve())
event = json.loads(pathlib.Path(sys.argv[1]).read_text())
spec = importlib.util.spec_from_file_location("oio_triage", REPO / ".github/scripts/oio_triage.py")
mod = importlib.util.module_from_spec(spec)
sys.path.insert(0, str(REPO / ".github/scripts"))
spec.loader.exec_module(mod)
OUT.write_text("")


def fake_api(token, method, url, payload=None):
    with open(OUT, "a") as f:
        f.write(json.dumps({"method": method, "url": url, "payload": payload}) + "\n")
    path = url.split("api.github.com/repos/", 1)[-1].split("?")[0]
    if method == "GET":
        if path.endswith(f"/issues/{event['issue']['number']}"):
            return 200, event["issue"]
        return 200, []  # labels / events / timeline collections
    return (201 if method == "POST" else 204), {}


mod._api = fake_api
os.environ.update(GITHUB_EVENT_PATH=sys.argv[1], GITHUB_TOKEN="offline-stub", GITHUB_REPOSITORY=event["repository"]["full_name"])
os.chdir(REPO)
rc = mod.main()
print(f"[triage_local] exit={rc}; {sum(1 for _ in open(OUT))} stubbed GitHub API calls recorded in {OUT}")
sys.exit(rc)
