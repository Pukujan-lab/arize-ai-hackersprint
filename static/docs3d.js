// 3D legal-document stack: pages fan while agents work; cited cases flip open with glowing passage.
const host = document.getElementById("docs3d");
const api = { busy(){}, show(){}, focus(){}, pulse(){}, idle(){} };
window.Docs3D = api;
function wrap(ctx, text, x, y, w, lh, maxLines){ const words=(text||"").split(/\s+/); let line="", n=0;
  for(const wd of words){ const t=line?line+" "+wd:wd; if(ctx.measureText(t).width>w&&line){ ctx.fillText(line,x,y+n*lh); line=wd; if(++n>=maxLines-1){ ctx.fillText(line+" …",x,y+n*lh); return n+1; } } else line=t; }
  if(line) ctx.fillText(line,x,y+n*lh); return n+1; }
function paint(ctx, W, H, c, glow){ // page texture
  ctx.fillStyle="#f8f5ec"; ctx.fillRect(0,0,W,H);
  ctx.fillStyle="#e7e1cf"; for(let y=150;y<H-40;y+=22) ctx.fillRect(40,y,W-80,1);
  if(!c){ ctx.fillStyle="#cbbf9f"; for(let y=60;y<H-40;y+=22) ctx.fillRect(40,y,(W-80)*(0.5+Math.random()*0.5),8); return; }
  ctx.fillStyle="#6366f1"; ctx.font="bold 22px Georgia"; ctx.fillText(c.ref||"",40,52);
  ctx.fillStyle="#1e1b4b"; ctx.font="bold 30px Georgia"; const n=wrap(ctx,c.title,40,92,W-80,34,2);
  ctx.fillStyle="#64748b"; ctx.font="16px Helvetica"; ctx.fillText([c.court,c.date].filter(Boolean).join(" · ").slice(0,60),40,100+n*34);
  const top=130+n*34, text=(c.passage||"").split("\n").slice(-1)[0] || (c.type||"")+" authority";
  ctx.font="19px Georgia"; const lines=Math.min(12,Math.ceil(ctx.measureText(text).width/(W-110))+1);
  ctx.fillStyle=`rgba(250,204,21,${0.25+0.45*glow})`; ctx.fillRect(34,top-22,W-68,lines*27+18);
  ctx.fillStyle="#6366f1"; ctx.fillRect(34,top-22,5,lines*27+18);
  ctx.fillStyle="#1f2937"; wrap(ctx,"“"+text+"”",52,top+4,W-110,27,12);
  ctx.fillStyle="#94a3b8"; ctx.font="13px Helvetica"; ctx.fillText(`cited by ${c.cited_by??0} · PageRank ${c.pagerank??0}`,40,H-28);
}
let webgl=false; try{ const t=document.createElement("canvas"); webgl=!!(t.getContext("webgl2")||t.getContext("webgl")); }catch(e){}
if(!webgl){ // 2D CSS fallback
  host.innerHTML='<div id="d2" class="h-full flex items-center justify-center [perspective:900px]"><div id="d2p" class="w-3/4 h-5/6 bg-[#f8f5ec] rounded shadow-2xl p-4 text-slate-800 text-xs overflow-hidden transition-transform duration-700" style="transform-style:preserve-3d"></div></div>';
  const p=document.getElementById("d2p"); let cites=[], i=0, timer=null;
  const render=c=>{ p.style.transform="rotateY(-180deg)"; setTimeout(()=>{ p.innerHTML=c?`<b class="text-indigo-600">${c.ref}</b><div class="font-serif font-bold text-base">${c.title}</div><div class="mt-2 bg-yellow-200/70 border-l-4 border-indigo-500 p-2 font-serif">${(c.passage||c.type||"").slice(0,400)}</div>`:"…"; p.style.transform="rotateY(0)"; },350); };
  Object.assign(api,{ busy(){ clearInterval(timer); timer=setInterval(()=>render(null),700); }, show(c){ clearInterval(timer); cites=c; i=0; render(cites[0]); },
    focus(k){ if(cites[k]) render(cites[k]); }, idle(){ clearInterval(timer); } });
} else {
  const THREE = await import("/static/vendor/three.module.min.js");
  const W=512, H=680, R=new THREE.WebGLRenderer({antialias:true,alpha:true}); R.setPixelRatio(Math.min(devicePixelRatio,2));
  host.appendChild(R.domElement); const scene=new THREE.Scene(), cam=new THREE.PerspectiveCamera(35,1,0.1,100); cam.position.set(0,1.2,7.2); cam.lookAt(0,0.2,0);
  scene.add(new THREE.AmbientLight(0xffffff,0.9)); const key=new THREE.PointLight(0x818cf8,30,20); key.position.set(2,3,4); scene.add(key);
  const glowLight=new THREE.PointLight(0xfacc15,0,6); glowLight.position.set(0,0.5,1.5); scene.add(glowLight);
  const N=14, pages=[], geo=new THREE.PlaneGeometry(2.4,3.2); geo.translate(1.2,0,0); // hinge on left edge
  for(let k=0;k<N;k++){ const cv=document.createElement("canvas"); cv.width=W; cv.height=H; const ctx=cv.getContext("2d"); paint(ctx,W,H,null,0);
    const tex=new THREE.CanvasTexture(cv); tex.colorSpace=THREE.SRGBColorSpace; tex.anisotropy=4;
    const m=new THREE.Mesh(geo,new THREE.MeshStandardMaterial({map:tex,side:THREE.DoubleSide,roughness:0.85}));
    const pivot=new THREE.Group(); pivot.position.set(-1.2,0,-k*0.018); pivot.add(m); scene.add(pivot);
    pages.push({pivot,mesh:m,cv,ctx,tex,target:0,cite:null}); }
  let mode="idle", cites=[], cur=-1, level=0, t0=performance.now(), flipT=0;
  function setPage(p,c,g){ p.cite=c; paint(p.ctx,W,H,c,g); p.tex.needsUpdate=true; }
  Object.assign(api,{
    busy(){ mode="busy"; cites=[]; cur=-1; pages.forEach(p=>{ if(p.cite) setPage(p,null,0); p.target=0; }); },
    idle(){ mode="idle"; },
    show(c){ mode="show"; cites=c.slice(0,Math.min(c.length,N-2)); cites.forEach((ci,k)=>setPage(pages[k],ci,0)); pages.forEach(p=>p.target=0); api.focus(0); },
    focus(k){ if(!cites[k]||k===cur) return; cur=k; pages.forEach((p,j)=>p.target=j<k?-Math.PI*0.92:0); setPage(pages[k],cites[k],1); },
    pulse(v){ level=v; } });
  function resize(){ const w=host.clientWidth, h=host.clientHeight; R.setSize(w,h,false); cam.aspect=w/h; cam.updateProjectionMatrix(); }
  new ResizeObserver(resize).observe(host); resize();
  let lastGlow=0;
  R.setAnimationLoop(now=>{ const t=(now-t0)/1000;
    if(mode==="busy" && now-flipT>140){ flipT=now; const k=Math.floor(t*7)%N; pages.forEach((p,j)=>p.target=j<=k?-Math.PI*0.92:0); if(k===N-1) t0=now+300; }
    pages.forEach((p,j)=>{ const r=p.pivot.rotation; r.y+=(p.target-r.y)*(mode==="busy"?0.35:0.12);
      p.pivot.position.z=(r.y<-1.5? j*0.018 : -j*0.018); });
    scene.rotation.y=Math.sin(t*0.4)*0.12; scene.rotation.x=-0.15+Math.sin(t*0.3)*0.03;
    const g=mode==="show"?0.6+level*2.2:0; glowLight.intensity+=(g-glowLight.intensity)*0.2;
    if(mode==="show"&&cur>=0&&Math.abs(level-lastGlow)>0.08){ lastGlow=level; setPage(pages[cur],cites[cur],Math.min(1,0.4+level*3)); }
    R.render(scene,cam); });
}
