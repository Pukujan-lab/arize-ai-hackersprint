import os,json,requests,sys
H={"x-api-key":os.environ["ARIZE_API_KEY"],"Content-Type":"application/json"}
def q(s,v=None):
    r=requests.post("https://app.arize.com/graphql",headers=H,json={"query":s,"variables":v or {}},timeout=30); return r.status_code, r.json() if r.headers.get("content-type","").startswith("application/json") else r.text[:300]
sc,j=q("{__schema{mutationType{fields{name}}}}")
names=[f["name"] for f in j["data"]["__schema"]["mutationType"]["fields"]] if sc==200 and "data" in j else j
print(sc, [n for n in names if any(k in n.lower() for k in ["monitor","dashboard","custommetric","metric"])] if isinstance(names,list) else names)
sc,j=q('query($id:ID!){node(id:$id){... on Space{name models(search:"precedent",first:5){edges{node{id name modelType}}}}}}',{"id":os.environ["ARIZE_SPACE_ID"]})
print(sc, json.dumps(j)[:600])
