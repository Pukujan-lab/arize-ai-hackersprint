// Agent pipeline overlay for /map: planner → Octo retrieval → SurrealDB graph → Haiku draft → safeguard.
// Driven by the same /api/run events; cached (burst) runs are replayed with staged delays.
(function(){
const N=[["planner","Planner"],["octo","Octo retrieval"],["graph","SurrealDB graph"],["draft","Haiku draft"],["safe","Safeguard"]];
const BUDGET={planner:600,octo:1500,graph:1000,draft:1500,safe:800};
function node(e){ if(e.agent==="planner") return e.kind==="done"?"safe":"planner"; if(e.agent==="retriever") return (e.kind==="passages"||e.kind==="claim")?"octo":"graph"; if(e.agent==="answer") return "draft"; if(e.agent==="safeguard") return "safe"; return null; }
let el=null, S=null, fadeT=null;
function mount(){ const cv=document.querySelector("canvas"); const host=(cv&&cv.parentElement&&cv.parentElement.parentElement)||document.body;
  if(el&&el.isConnected) return el; el=document.createElement("div"); el.id="agentNodes";
  el.style.cssText="position:absolute;left:16px;top:16px;z-index:30;pointer-events:none;padding:10px 12px;border-radius:14px;background:rgba(15,18,30,.6);backdrop-filter:blur(8px);border:1px solid rgba(165,180,252,.25);font:11px system-ui,sans-serif;color:#cbd5e1;transition:opacity .8s;opacity:0";
  el.innerHTML=`<style>#agentNodes .an{width:14px;height:14px;border-radius:50%;background:#334155;box-shadow:0 0 0 rgba(129,140,248,0);transition:all .25s}#agentNodes .an.on{background:#818cf8;box-shadow:0 0 14px 4px rgba(129,140,248,.8)}#agentNodes .an.done{background:#34d399;box-shadow:0 0 6px rgba(52,211,153,.6)}#agentNodes .an.pulse{animation:anp .6s ease-out}@keyframes anp{0%{transform:scale(1.7)}100%{transform:scale(1)}}#agentNodes .ln{flex:1;height:2px;min-width:22px;background:rgba(148,163,184,.35);margin-top:6px}#agentNodes .ln.done{background:rgba(52,211,153,.7)}</style>
  <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px"><b style="color:#a5b4fc;letter-spacing:.06em;text-transform:uppercase;font-size:10px">Agents</b><span id="anCached" style="display:none;font-size:10px;padding:0 6px;border-radius:999px;border:1px solid rgba(148,163,184,.5);color:#94a3b8">cached · replay</span></div>
  <div style="display:flex;align-items:flex-start">`+N.map(([k,l],i)=>(i?`<div class="ln" data-l="${k}"></div>`:"")+`<div style="display:flex;flex-direction:column;align-items:center;width:64px"><div class="an" data-n="${k}"></div><div style="margin-top:4px;text-align:center;line-height:1.15">${l}</div></div>`).join("")+`</div>
  <div id="anMsg" style="margin-top:6px;max-width:360px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#e2e8f0;min-height:14px"></div>`;
  if(getComputedStyle(host).position==="static") host.style.position="relative"; host.appendChild(el); return el; }
function light(k,msg){ const e=mount(); const order=N.map(x=>x[0]); const i=order.indexOf(k);
  e.querySelectorAll(".an").forEach((d,j)=>{ d.classList.toggle("on",j===i); d.classList.toggle("done",j<i); });
  e.querySelectorAll(".ln").forEach((d,j)=>d.classList.toggle("done",j<i));
  const d=e.querySelector(`[data-n="${k}"]`); d.classList.remove("pulse"); void d.offsetWidth; d.classList.add("pulse");
  e.querySelector("#anMsg").textContent=msg||""; }
function finish(ok){ const e=mount(); e.querySelectorAll(".an").forEach(d=>{ d.classList.remove("on"); d.classList.add("done"); }); e.querySelectorAll(".ln").forEach(d=>d.classList.add("done"));
  const m=e.querySelector("#anMsg"); m.innerHTML=ok?'<b style="color:#34d399">safeguard PASS</b>':'<b style="color:#fbbf24">safeguard flagged issues</b>';
  clearTimeout(fadeT); fadeT=setTimeout(()=>{ e.style.opacity="0"; },1600); }
// gate(runId, d): returns d with events limited to those "released" so far; result withheld until replay drains.
function gate(id,d){ const ev=d.events||[]; const now=performance.now();
  if(!S||S.id!==id){ clearTimeout(fadeT); S={id,at:[],last:now,shown:0,cached:false,fin:false}; const e=mount(); e.style.opacity="1"; e.querySelector("#anCached").style.display="none"; light("planner","planner starting…");
    const ts=ev.map(x=>parseFloat(x.t)||0); S.cached=ev.length>=6&&!!d.result; }
  if(S.cached) mount().querySelector("#anCached").style.display="";
  if(S.at.length<ev.length){ const cnt={}; ev.forEach(x=>{ const k=node(x); cnt[k]=(cnt[k]||0)+1; });
    for(let i=S.at.length;i<ev.length;i++){ const k=node(ev[i]); const dl=S.cached?(BUDGET[k]||300)/(cnt[k]||1):120; S.last=Math.max(now,S.last+dl); S.at.push(S.last); } }
  let n=0; while(n<S.at.length&&S.at[n]<=now) n++;
  for(let i=S.shown;i<n;i++){ const x=ev[i], k=node(x); if(k) light(k,(x.msg||"").slice(0,90)); }
  S.shown=n; const drained=n>=ev.length;
  const out=Object.assign({},d,{events:ev.slice(0,n),result:drained?d.result:null});
  if(drained&&d.result&&!S.fin){ S.fin=true; const sg=(d.result.safeguard||{}); const pass=ev.some(x=>x.kind==="release"&&/pass/i.test(x.status||x.msg||""))||sg.pass; finish(pass); }
  return out; }
window.AgentNodes={gate,light,finish};
})();
