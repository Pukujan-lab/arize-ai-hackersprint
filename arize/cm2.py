import os,requests,json
H={"x-api-key":os.environ["ARIZE_API_KEY"]}; SP=os.environ["ARIZE_SPACE_ID"]; MID="TW9kZWw6MTA0ODgyNDM4ODU6ZmZQUQ=="
def q(s,v=None): return requests.post("https://app.arize.com/graphql",headers=H,json={"query":s,"variables":v or {}},timeout=30).json()
M='mutation($i:CreateCustomMetricMutationInput!){createCustomMetric(input:$i){customMetric{id name}}}'
metrics={
 "citation_pass_rate":["SELECT AVG(\"eval.citation_guard.score\") FROM model","SELECT COUNT(*) FILTER(WHERE \"eval.citation_guard.label\" = 'pass') / COUNT(*) FROM model"],
 "avg_groundedness":["SELECT AVG(\"eval.groundedness.score\") FROM model"],
 "p95_latency_ms":["SELECT APPROX_QUANTILE(\"attributes.latency_ms\", 0.95) FROM model","SELECT APPROX_QUANTILE(latency_ms, 0.95) FROM model"],
 "cost_per_run_usd":["SELECT AVG(\"attributes.precedent.cost_usd\") FROM model"],
 "fallback_rate":["SELECT COUNT(*) FILTER(WHERE \"attributes.precedent.fallback\" = true) / COUNT(*) FROM model","SELECT AVG(CASE WHEN \"attributes.precedent.fallback\" = 'true' THEN 1 ELSE 0 END) FROM model"],
 "error_rate":["SELECT COUNT(*) FILTER(WHERE \"status_code\" = 'ERROR') / COUNT(*) FROM model"],
}
out={}
for n,cands in metrics.items():
    for m in cands:
        j=q(M,{"i":{"spaceId":SP,"modelId":MID,"name":n,"description":"Precedent "+n,"metric":m,"modelEnvironmentName":"tracing"}})
        cm=(j.get("data") or {}).get("createCustomMetric")
        if cm and cm.get("customMetric"): out[n]=cm["customMetric"]["id"]; print(n,"OK",m); break
        print(n,"ERR",m,json.dumps(j.get("errors"))[:250])
j=q('mutation($i:CreateDashboardMutationInput!){createDashboard(input:$i){dashboard{id name}}}',{"i":{"spaceId":SP,"name":"Precedent reliability"}})
print("dashboard",json.dumps(j)[:400]); out["dashboard"]=j
json.dump(out,open("cm.json","w"))
