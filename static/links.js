// Client-side research links for a case/statute (no API calls).
window.caseLinks=function(c,cls){ c=c||{}; const name=(c.title||"").trim(), cite=(c.citation||c.cite||"").trim(), e=encodeURIComponent;
  const st=/statute/i.test(c.type||"")||/C\.?R\.?S\.?|§/.test(name+" "+cite);
  const L=st?[["C.R.S. text","https://www.google.com/search?q="+e((cite||name)+" Colorado Revised Statutes")]]
   :[["Images","https://www.google.com/search?tbm=isch&q="+e((name+" "+cite).trim())],["News","https://news.google.com/search?q="+e(name)],["Full opinion","https://www.courtlistener.com/?q="+e(cite||name)]];
  const s=cls||"display:inline-block;margin:6px 6px 0 0;padding:3px 9px;border-radius:999px;border:1px solid #6366f1;color:#4f46e5;font-size:12px;text-decoration:none";
  return L.map(([t,u])=>`<a href="${u}" target="_blank" rel="noopener noreferrer" style="${s}">${t} ↗</a>`).join(""); };
