// Follow-up questions + "New question" reset, shared by / and /map.
(function(){
const esc=t=>String(t||"").replace(/[<&]/g,m=>m=="<"?"&lt;":"&amp;");
const F=window.FOLLOW={prev:null,thread:[],cfg:null};
function bottom(a){ const m=String(a||"").match(/(?:short answer|bottom line)[:*\s]*([^\n]+)/i); return (m?m[1]:String(a||"")).replace(/\s*\[\d+\]/g,"").replace(/\*\*|[*#>`]/g,"").trim().slice(0,220); }
function chips(r){ const t=(r.question+" "+r.answer).toLowerCase(), out=[];
  if(/stop|police|search|vehicle|traffic|warrant|suppress/.test(t)) out.push("What if they find evidence?","Can I refuse a search?");
  if(/landlord|tenant|deposit|evict/.test(t)) out.push("What damages can the tenant recover?","What notice is required?");
  if(/water|appropriat|ditch|priority/.test(t)) out.push("How is a senior call enforced?","Can a junior user challenge it?");
  if(/\bcontracts?\b|statute of limitations/.test(t)) out.push("When does the clock start running?");
  if(/homestead|bankrupt/.test(t)) out.push("What is the exemption amount?");
  const c=(r.citations||[]).find(x=>x.ref&&/v\./.test(x.title||"")); if(c) out.push(`How does ${String(c.title).split(",")[0].slice(0,48)} apply here?`);
  out.push("What are the main exceptions?","What should I verify before relying on this?");
  return [...new Set(out)].slice(0,3); }
function ui(){ const c=F.cfg; if(!c) return; const inp=c.input();
  let th=document.getElementById("fuThread"); if(!th){ th=document.createElement("details"); th.id="fuThread"; th.className="mb-3 rounded-xl border border-indigo-500/25 bg-slate-900/50 text-[15px]"; c.threadHost().before(th); }
  let ch=document.getElementById("fuChips"); if(!ch){ ch=document.createElement("div"); ch.id="fuChips"; ch.className="flex flex-wrap gap-2 my-2"; c.chipsHost().after(ch); }
  let nb=document.getElementById("fuNew"); if(!nb){ nb=document.createElement("button"); nb.id="fuNew"; nb.type="button"; nb.textContent="✚ New question"; nb.title="Start a fresh research thread"; nb.className="rounded-xl border border-slate-500/50 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-700/60 whitespace-nowrap"; nb.onclick=()=>F.reset(); c.newHost().after(nb); }
  const n=F.thread.length; nb.style.display=n?"":"none";
  th.style.display=n>1?"":"none";
  th.innerHTML=`<summary class="cursor-pointer px-3 py-2 text-xs uppercase tracking-widest text-indigo-300">Research thread · ${n} question${n>1?"s":""}</summary><ol class="px-4 pb-3 space-y-2">`+F.thread.slice(0,-1).map(x=>`<li><b class="text-slate-100">${esc(x.q)}</b><div class="text-slate-400 text-sm">${esc(x.a)}</div></li>`).join("")+"</ol>";
  ch.innerHTML=n?`<span class="text-xs text-slate-400 self-center">Follow up:</span>`+chips(F.last).map(t=>`<button type="button" class="fuc rounded-full border border-indigo-400/40 bg-indigo-500/10 px-3 py-1 text-sm text-indigo-200 hover:bg-indigo-500/25">${esc(t)}</button>`).join(""):"";
  ch.querySelectorAll(".fuc").forEach(b=>b.onclick=()=>{ inp.value=b.textContent; c.submit(); });
  if(inp){ if(n){ inp.placeholder="Ask a follow-up…"; inp.value=""; } else inp.placeholder=c.placeholder||inp.placeholder; } }
F.init=cfg=>{ F.cfg=cfg; };
F.body=q=>F.prev?{question:q,prev_run_id:F.prev}:{question:q};
F.onResult=r=>{ if(!r||!r.run_id||r.run_id===F.prev) return; F.prev=r.run_id; F.last=r; F.thread.push({q:r.question,a:bottom(r.answer)}); ui(); };
F.reset=()=>{ F.prev=null; F.thread=[]; F.last=null; try{ window.AudioMgr&&AudioMgr.stopAll(); }catch(e){}
  try{ const D=window.Docs3D; if(D){ D.stopTour&&D.stopTour(); D.closeDoc&&D.closeDoc(); D.show&&D.show([],[],[]); } }catch(e){}
  try{ F.cfg.onReset&&F.cfg.onReset(); }catch(e){} ui(); const i=F.cfg.input(); if(i){ i.value=""; i.focus(); } };
})();
