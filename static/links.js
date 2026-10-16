// Client-side research links + passage cleanup (no API calls).
window.caseLinks=function(c,cls){ c=c||{}; const name=(c.title||"").trim(), cite=(c.citation||c.cite||"").trim(), e=encodeURIComponent;
  const st=/statute/i.test(c.type||"")||/C\.?R\.?S\.?|§/.test(name+" "+cite);
  const L=st?[["C.R.S. text","https://www.google.com/search?q="+e((cite||name)+" Colorado Revised Statutes")]]
   :[["Full opinion","https://www.courtlistener.com/?q="+e(cite||name)]];
  const s=cls||"display:inline-block;margin:6px 6px 0 0;padding:3px 10px;border-radius:999px;border:1px solid rgba(129,140,248,.6);color:#a5b4fc;font-size:12px;text-decoration:none";
  return L.map(([t,u])=>`<a href="${u}" target="_blank" rel="noopener noreferrer" style="${s}">${t} ↗</a>`).join(""); };
window.cleanPassage=function(text,q,max){ max=max||300; q=q||(document.getElementById("q")||{}).value||"";
  const stop=new Set("the a an of to in for and or on is be by with under without from that this what when can does".split(" "));
  const terms=q.toLowerCase().split(/\W+/).filter(w=>w.length>2&&!stop.has(w));
  const parts=String(text||"").split(/\n+|(?<=[.;:])\s+(?=[A-Z“"(])/).map(x=>x.trim()).filter(x=>x.length>=60&&!/^([IVXLC]+|[A-Z]|\d+)\.\s*\S{0,30}$/.test(x)&&!/\|\s*(Supreme|Court|Colorado)/.test(x));
  if(!parts.length) return "";
  let best=parts[0],bs=-1; parts.forEach((p,i)=>{ const l=p.toLowerCase(); const sc=terms.reduce((a,t)=>a+(l.includes(t)?1:0),0)-i*0.01; if(sc>bs){bs=sc;best=p;} });
  const i=parts.indexOf(best); let out=best; for(let j=i+1;j<parts.length&&out.length<max*0.7;j++) out+=" "+parts[j];
  if(out.length<=max) return out;
  let cut=out.slice(0,max); const se=Math.max(cut.lastIndexOf(". "),cut.lastIndexOf("; ")); cut=se>max*0.5?cut.slice(0,se+1):cut.slice(0,cut.lastIndexOf(" "))+"…"; return cut; };
