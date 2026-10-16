// Per-device session id: sent as X-Session-Id on every same-origin /api call.
(function(){ let s; try{ s=localStorage.getItem("precedent_sid"); if(!s){ s=(crypto.randomUUID?crypto.randomUUID():String(Date.now())+"-"+Math.random().toString(36).slice(2)); localStorage.setItem("precedent_sid",s); } }catch(e){ s=window.__sid||(window.__sid=String(Date.now())+"-"+Math.random().toString(36).slice(2)); }
window.SESSION_ID=s; const f=window.fetch.bind(window);
window.fetch=(u,o)=>{ const url=typeof u==="string"?u:(u&&u.url)||""; if(/^\/api\//.test(url)||url.startsWith(location.origin+"/api/")){ o=Object.assign({},o); const h=new Headers(o.headers||(typeof u!=="string"&&u.headers)||{}); h.set("X-Session-Id",s); o.headers=h; } return f(u,o); }; })();
