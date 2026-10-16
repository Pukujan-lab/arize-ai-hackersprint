// Declutter: move secondary panels into a collapsible left sidebar with accordions. Moves existing nodes (IDs and handlers stay intact).
(()=>{ const $=id=>document.getElementById(id); const KEY="precedent.side", AKEY="precedent.acc";
 document.body.style.fontSize="16px";
 const side=document.createElement("aside"); side.id="sidebar"; side.setAttribute("aria-label","Details");
 side.style.cssText="position:fixed;top:44px;left:0;bottom:0;width:360px;z-index:45;overflow:auto;padding:16px;background:rgba(10,13,26,.92);backdrop-filter:blur(12px);border-right:1px solid rgba(255,255,255,.06);transition:transform .25s ease";
 document.body.appendChild(side);
 let accState={}; try{ accState=JSON.parse(localStorage.getItem(AKEY)||"{}"); }catch(e){}
 function section(id,title,nodes,open){ const d=document.createElement("details"); d.id="acc-"+id; d.open=accState[id]??open; d.className="mb-3 rounded-xl border border-white/5 bg-white/[.02]";
   d.innerHTML=`<summary class="cursor-pointer select-none list-none flex items-center justify-between px-4 py-3 text-[15px] font-semibold text-slate-200"><span>${title}</span><span class="chev transition-transform text-slate-500">▸</span></summary><div class="px-3 pb-3 space-y-3"></div>`;
   const body=d.lastElementChild; nodes.filter(Boolean).forEach(n=>body.appendChild(n));
   const sync=()=>{ d.querySelector(".chev").style.transform=d.open?"rotate(90deg)":""; accState[id]=d.open; try{localStorage.setItem(AKEY,JSON.stringify(accState));}catch(e){} };
   d.addEventListener("toggle",sync); sync(); side.appendChild(d); return d; }
 const evCard=$("events")&&$("events").parentElement, ciCard=$("cites")&&$("cites").parentElement, hfLab=$("hf")&&$("hf").parentElement, badges=$("badges"), strip=document.querySelector('a[href="/dashboard"].mt-6');
 [evCard,ciCard].forEach(c=>{ if(c){ c.classList.remove("p-6"); c.classList.add("p-3"); const h=c.querySelector("h2"); if(h) h.classList.add("hidden"); } });
 if($("events")) $("events").style.maxHeight="46vh";
 section("activity","Live agent activity",[evCard],true);
 section("sources","Sources",[ciCard],false);
 const hist=document.createElement("div"); hist.className="text-sm space-y-1"; hist.innerHTML='<div class="text-slate-500">loading…</div>';
 section("history","Run history",[hist],false);
 const vs=document.createElement("div"); vs.className="text-sm text-slate-400 space-y-2"; if(hfLab){ hfLab.className="flex items-center gap-2 text-sm text-slate-300"; vs.appendChild(hfLab); } const tip=document.createElement("div"); tip.textContent="Tap the mic orb or hold Space to talk. Right-click the orb for the wake phrase."; vs.appendChild(tip);
 section("voice","Voice & hands-free",[vs],false);
 const pw=document.createElement("div"); if(badges){ badges.className="flex flex-wrap gap-2 text-sm font-semibold"; pw.appendChild(badges); } if(strip){ strip.classList.remove("mt-6"); strip.classList.add("mt-3"); pw.appendChild(strip); }
 section("partners","Partners & pipeline",[pw],false);
 fetch("/api/runs?n=10").then(r=>r.json()).then(L=>{ hist.innerHTML=L.map(x=>`<a class="block truncate text-slate-300 hover:text-white" href="/map?run=${encodeURIComponent(x.run_id)}">${(x.question||x.run_id).replace(/</g,"&lt;")}</a>`).join("")||'<div class="text-slate-500">no runs yet</div>'; }).catch(()=>{});
 // widen main column now that the right column is empty
 document.querySelectorAll(".col-span-8").forEach(e=>{ e.classList.remove("col-span-8"); e.classList.add("col-span-12"); });
 document.querySelectorAll(".col-span-4").forEach(e=>{ if(!e.textContent.trim()) e.remove(); });
 // compact live status in the answer card header (mirrors latest event)
 const sg=$("sg"); const live=document.createElement("div"); live.id="liveline"; live.className="text-sm text-slate-400 mt-1 truncate"; if(sg&&sg.closest(".glass")){ const h=sg.closest(".glass").querySelector("h2"); h&&h.parentElement.insertAdjacentElement("afterend",live); }
 // hamburger
 const nav=document.querySelector("nav > div")||document.querySelector("nav"); const hb=document.createElement("button"); hb.id="sideToggle"; hb.setAttribute("aria-label","Toggle details sidebar"); hb.setAttribute("aria-controls","sidebar");
 hb.className="relative text-slate-300 hover:text-white text-lg leading-none px-1"; hb.innerHTML='☰<span id="sideDot" class="hidden absolute -top-0.5 -right-1 w-2 h-2 rounded-full bg-indigo-400 animate-pulse"></span>'; nav.prepend(hb);
 const small=()=>innerWidth<1100; let open; try{ const v=localStorage.getItem(KEY); open=v===null?false:v==="1"; }catch(e){ open=false; } if(small()) open=false;
 const main=document.querySelector("body > div.max-w-7xl");
 function apply(){ side.style.transform=open?"none":"translateX(-100%)"; hb.setAttribute("aria-expanded",open); if(main){ main.style.transition="padding .25s"; main.style.paddingLeft=open&&!small()?"384px":""; } }
 hb.onclick=()=>{ open=!open; try{localStorage.setItem(KEY,open?"1":"0");}catch(e){} apply(); }; addEventListener("resize",apply); apply();
 addEventListener("keydown",e=>{ if(e.key==="Escape"&&open&&small()){ open=false; apply(); } });
 if($("events")) new MutationObserver(()=>{ const last=$("events").lastElementChild; if(last){ live.textContent="● "+last.textContent.replace(/\s+/g," ").trim().slice(0,140); } if(!open) $("sideDot").classList.remove("hidden"); clearTimeout(window.__dotT); window.__dotT=setTimeout(()=>$("sideDot").classList.add("hidden"),4000); }).observe($("events"),{childList:true,subtree:true,characterData:true});
})();
