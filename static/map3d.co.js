// 3D Colorado map: one glowing pin per retrieved document at its deciding court; arcs for graph links.
const host = document.getElementById("docs3d");
const api = { busy(){}, show(){}, focus(){}, pulse(){}, idle(){} }; window.Docs3D = api;
const DENVER=[39.7393,-104.9897], CAPITOL=[39.7392,-104.9848], FED=[39.2,-101.75];
const SEATS={adams:[39.9853,-104.8205,"Brighton"],alamosa:[37.4695,-105.8700,"Alamosa"],arapahoe:[39.6133,-105.0166,"Littleton"],archuleta:[37.2694,-107.0098,"Pagosa Springs"],baca:[37.4086,-102.6141,"Springfield"],
bent:[38.0717,-103.2227,"Las Animas"],boulder:[40.0150,-105.2705,"Boulder"],broomfield:[39.9205,-105.0867,"Broomfield"],chaffee:[38.5347,-105.9989,"Salida"],cheyenne:[38.8214,-102.3530,"Cheyenne Wells"],
"clear creek":[39.7055,-105.6972,"Georgetown"],conejos:[37.0886,-106.0192,"Conejos"],costilla:[37.2003,-105.4239,"San Luis"],crowley:[38.2181,-103.7563,"Ordway"],custer:[38.1350,-105.4664,"Westcliffe"],
delta:[38.7422,-108.0690,"Delta"],denver:[39.7393,-104.9897,"Denver"],dolores:[37.7664,-108.9062,"Dove Creek"],douglas:[39.3722,-104.8561,"Castle Rock"],eagle:[39.6553,-106.8287,"Eagle"],
elbert:[39.2836,-104.5225,"Kiowa"],"el paso":[38.8339,-104.8214,"Colorado Springs"],fremont:[38.4411,-105.2422,"Cañon City"],garfield:[39.5505,-107.3248,"Glenwood Springs"],gilpin:[39.8019,-105.5139,"Central City"],
grand:[40.0733,-106.1031,"Hot Sulphur Springs"],gunnison:[38.5458,-106.9253,"Gunnison"],hinsdale:[38.0300,-107.3153,"Lake City"],huerfano:[37.6239,-104.7803,"Walsenburg"],jackson:[40.7319,-106.2837,"Walden"],
jefferson:[39.7555,-105.2211,"Golden"],kiowa:[38.4811,-102.7810,"Eads"],"kit carson":[39.3058,-102.2694,"Burlington"],lake:[39.2508,-106.2925,"Leadville"],"la plata":[37.2753,-107.8801,"Durango"],
larimer:[40.5853,-105.0844,"Fort Collins"],"las animas":[37.1695,-104.5005,"Trinidad"],lincoln:[39.1361,-103.4697,"Hugo"],logan:[40.6255,-103.2077,"Sterling"],mesa:[39.0639,-108.5506,"Grand Junction"],
mineral:[37.8497,-106.9264,"Creede"],moffat:[40.5153,-107.5464,"Craig"],montezuma:[37.3489,-108.5859,"Cortez"],montrose:[38.4783,-107.8762,"Montrose"],morgan:[40.2503,-103.7999,"Fort Morgan"],
otero:[37.9853,-103.5438,"La Junta"],ouray:[38.0228,-107.6714,"Ouray"],park:[39.2247,-106.0020,"Fairplay"],phillips:[40.5836,-102.3024,"Holyoke"],pitkin:[39.1911,-106.8175,"Aspen"],
prowers:[38.0872,-102.6208,"Lamar"],pueblo:[38.2544,-104.6091,"Pueblo"],"rio blanco":[40.0372,-107.9131,"Meeker"],"rio grande":[37.6800,-106.3534,"Del Norte"],routt:[40.4850,-106.8317,"Steamboat Springs"],
saguache:[38.0875,-106.1420,"Saguache"],"san juan":[37.8119,-107.6645,"Silverton"],"san miguel":[37.9375,-107.8123,"Telluride"],sedgwick:[40.9883,-102.2643,"Julesburg"],summit:[39.4817,-106.0384,"Breckenridge"],
teller:[38.7472,-105.1783,"Cripple Creek"],washington:[40.1608,-103.2144,"Akron"],weld:[40.4233,-104.7091,"Greeley"],yuma:[40.0789,-102.2232,"Wray"]};
const JD={1:"jefferson",2:"denver",3:"las animas",4:"el paso",5:"eagle",6:"la plata",7:"montrose",8:"larimer",9:"garfield",10:"pueblo",11:"fremont",12:"alamosa",13:"morgan",14:"routt",15:"prowers",16:"otero",17:"adams",18:"arapahoe",19:"weld",20:"boulder",21:"mesa",22:"montezuma",23:"douglas"};
const CNAMES=Object.keys(SEATS).sort((a,b)=>b.length-a.length);
function findCounty(txt){ if(!txt) return null; const t=txt.toLowerCase();
  const pats=[/district court (?:of|for|in) (?:the )?(?:city and )?(?:county of )?([a-z ]+?) county/,/(?:appeal|certiorari) (?:from|to) the [a-z ]*?court (?:of|for|in) ([a-z ]+?) county/,/([a-z]+(?: [a-z]+)?) county district court/,/county court (?:of|for|in) ([a-z ]+?) county/,/city and county of (denver|broomfield)/,/([a-z]+(?: [a-z]+)?) county/];
  for(const re of pats){ const m=t.match(re); if(m){ const w=m[1].trim(); const k=CNAMES.find(n=>w===n||w.endsWith(" "+n)); if(k) return k; } }
  const jd=t.match(/(\d{1,2})(?:st|nd|rd|th) judicial district/); if(jd&&JD[+jd[1]]) return JD[+jd[1]]; return null; }

function locate(c){ const t=(c.type||"").toLowerCase(), court=(c.court||"");
  if(t.includes("statute")||t.includes("cfr")||/c\.r\.s\./i.test(c.id)) return {key:"capitol",ll:CAPITOL,label:"State Capitol (C.R.S.)",cat:"statute"};
  const stateCourt=/colorado|colo\./i.test(court)||/P\.[23]d|COA|CO \d/.test(c.id);
  const courtLabel=/appeals/i.test(court)?"Colorado Court of Appeals (Denver)":/supreme/i.test(court)?"Colorado Supreme Court (Denver)":"Colorado courts (Denver)";
  const k=findCounty((c.origin_text||"")+" "+(c.passage||""));
  if(k&&k!=="denver") return {key:"c:"+k,ll:SEATS[k],label:`${k.replace(/\b\w/g,x=>x.toUpperCase())} County (${SEATS[k][2]})`+(stateCourt?` → ${courtLabel}`:""),cat:"county",up:stateCourt};
  if(stateCourt||!court) return {key:"denver",ll:DENVER,label:courtLabel,cat:"state"};
  return {key:"fed",ll:FED,label:"Federal / out-of-state",cat:"federal"}; }
const LON0=-109.05,LON1=-102.04,LAT0=36.99,LAT1=41.0, SX=1.0, SY=1.3;
const xy=([la,lo])=>[(lo-(LON0+LON1)/2)*SX,(la-(LAT0+LAT1)/2)*SY];
const COL={county:0x34d399,state:0x818cf8,statute:0xf59e0b,federal:0x94a3b8}, ARC={cc:0x34d399,cs:0x60a5fa,st:0xf59e0b,other:0x64748b};
// page-flip panel
const panel=document.createElement("div"); panel.className="absolute inset-4 hidden [perspective:1000px] z-10"; host.parentElement.appendChild(panel);
function openDoc(c){ panel.classList.remove("hidden"); panel.innerHTML=`<div id="pg" class="w-full h-full bg-[#f8f5ec] text-slate-800 rounded-lg shadow-2xl p-5 overflow-auto origin-left transition-transform duration-700" style="transform:rotateY(-95deg)">
 <button class="float-right text-slate-500 hover:text-slate-900" onclick="this.closest('.absolute').classList.add('hidden')">✕</button>
 <div class="text-indigo-600 font-bold text-sm">${c.ref||""} · ${c.type||""}</div><div class="font-serif text-xl font-bold leading-tight mt-1">${(c.title||"").replace(/</g,"&lt;")}</div>
 <div class="text-xs text-slate-500 mt-1">${[c.court,c.date].filter(Boolean).join(" · ")}</div>
 <blockquote class="mt-4 font-serif text-[15px] leading-relaxed bg-yellow-200/60 border-l-4 border-indigo-500 px-3 py-2 shadow-[0_0_24px_rgba(250,204,21,.45)]">${((c.passage||"").split("\n").slice(-1)[0]||"No passage retrieved — graph-linked authority.").replace(/</g,"&lt;")}</blockquote>
 ${c.url?`<a href="${c.url}" target="_blank" class="text-indigo-600 text-sm underline mt-3 inline-block">Open source ↗</a>`:""}</div>`;
 requestAnimationFrame(()=>requestAnimationFrame(()=>{ const p=document.getElementById("pg"); if(p) p.style.transform="rotateY(0)"; })); }
api.open=openDoc;
const legend=document.createElement("div"); legend.className="absolute top-2 left-3 text-[10px] text-slate-300 space-y-0.5 pointer-events-none";
legend.innerHTML=`<div class="uppercase tracking-widest text-slate-500">Colorado citation map</div><div><span style="color:#34d399">━</span> county↔county</div><div><span style="color:#60a5fa">━</span> county↔state court</div><div><span style="color:#f59e0b">━</span> case↔statute</div><div id="cnt" class="text-indigo-300 font-semibold"></div>`;
host.parentElement.appendChild(legend);
const label=document.createElement("div"); label.className="absolute top-2 right-3 text-xs text-slate-200 text-right pointer-events-none max-w-[60%]"; host.parentElement.appendChild(label);
let webgl=false; try{ const t=document.createElement("canvas"); webgl=!!(t.getContext("webgl2")||t.getContext("webgl")); }catch(e){}
function groups(cites){ const g=new Map(); cites.forEach((c,i)=>{ const L=locate(c); c._loc=L; if(!g.has(L.key)) g.set(L.key,{...L,items:[]}); g.get(L.key).items.push(i); }); return g; }
function arcType(a,b){ const A=a._loc.cat,B=b._loc.cat; if(A==="statute"||B==="statute") return "st"; if(A==="county"&&B==="county") return "cc"; if((A==="county")!==(B==="county")) return "cs"; return "other"; }
function counties(cites){ return new Set(cites.filter(c=>c._loc&&c._loc.cat==="county").map(c=>c._loc.key)).size; }
if(!webgl){ // 2D fallback: SVG
  host.innerHTML=`<svg viewBox="-4.2 -3.2 8.4 6.4" class="w-full h-full"><rect x="${-(LON1-LON0)/2}" y="${-(LAT1-LAT0)*SY/2}" width="${LON1-LON0}" height="${(LAT1-LAT0)*SY}" fill="#1e293b" stroke="#6366f1" stroke-width="0.04"/><g id="arcs2"></g><g id="pins2"></g></svg>`;
  let cites=[];
  Object.assign(api,{ busy(){ document.getElementById("pins2").innerHTML=""; document.getElementById("arcs2").innerHTML=""; label.textContent="Agents retrieving…"; },
   show(c,edges=[]){ cites=c; const g=groups(c); const P=document.getElementById("pins2"); P.innerHTML="";
    g.forEach(G=>{ const [x,y]=xy(G.ll); P.insertAdjacentHTML("beforeend",`<circle cx="${x}" cy="${-y}" r="${0.08+0.03*G.items.length}" fill="#${COL[G.cat].toString(16)}" style="cursor:pointer" onclick="Docs3D.open(Docs3D._c[${G.items[0]}])"><title>${G.label}</title></circle>`); });
    api._c=c; const id={}; c.forEach((x,i)=>id[x.id]=i); const A=document.getElementById("arcs2"); A.innerHTML="";
    edges.filter(e=>e.src in id&&e.dst in id).forEach(e=>{ const a=c[id[e.src]],b=c[id[e.dst]]; const [x1,y1]=xy(a._loc.ll),[x2,y2]=xy(b._loc.ll);
      A.insertAdjacentHTML("beforeend",`<path d="M${x1},${-y1} Q${(x1+x2)/2},${-(y1+y2)/2-0.6} ${x2},${-y2}" stroke="#${ARC[arcType(a,b)].toString(16)}" stroke-width="0.03" fill="none"/>`); });
    document.getElementById("cnt").textContent=`${counties(c)} counties linked`; },
   focus(k){ if(cites[k]) label.textContent=`${cites[k].ref} ${cites[k].title} — ${cites[k]._loc.label}`; } });
} else {
  const THREE = await import("/static/vendor/three.module.min.js");
  const R=new THREE.WebGLRenderer({antialias:true,alpha:true}); R.setPixelRatio(Math.min(devicePixelRatio,2)); host.appendChild(R.domElement);
  const scene=new THREE.Scene(), cam=new THREE.PerspectiveCamera(38,1,0.1,100); const home=new THREE.Vector3(0,-4.6,5.0); cam.position.copy(home); cam.up.set(0,0,1);
  const look=new THREE.Vector3(0,0,0), lookT=new THREE.Vector3(), camT=home.clone(); cam.lookAt(look);
  scene.add(new THREE.AmbientLight(0xffffff,0.7)); const dl=new THREE.DirectionalLight(0xc7d2fe,1.6); dl.position.set(-3,-4,6); scene.add(dl);
  // simplified Colorado polygon (near-rectangle with slight western jog), extruded
  const W=(LON1-LON0)*SX/2, H=(LAT1-LAT0)*SY/2, sh=new THREE.Shape();
  sh.moveTo(-W,-H); sh.lineTo(W,-H); sh.lineTo(W,H); sh.lineTo(-W+0.02,H); sh.lineTo(-W,H-0.05); sh.lineTo(-W,-H);
  const slab=new THREE.Mesh(new THREE.ExtrudeGeometry(sh,{depth:0.18,bevelEnabled:true,bevelSize:0.03,bevelThickness:0.03,bevelSegments:2}),
    new THREE.MeshStandardMaterial({color:0x1e1b4b,roughness:0.6,metalness:0.2})); slab.position.z=-0.18; scene.add(slab);
  const edge=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.ShapeGeometry(sh)),new THREE.LineBasicMaterial({color:0x818cf8})); edge.position.z=0.035; scene.add(edge);
  const grid=new THREE.GridHelper(Math.max(W,H)*2,14,0x312e81,0x312e81); grid.rotation.x=Math.PI/2; grid.position.z=0.031; grid.material.transparent=true; grid.material.opacity=0.35; scene.add(grid);
  // faint county-seat dots + Denver label dot
  const dots=new THREE.Points(new THREE.BufferGeometry().setFromPoints(Object.values(SEATS).map(s=>{const [x,y]=xy(s);return new THREE.Vector3(x,y,0.04)})),new THREE.PointsMaterial({color:0x6366f1,size:0.04}));
  scene.add(dots);
  const pinGroup=new THREE.Group(), arcGroup=new THREE.Group(); scene.add(pinGroup, arcGroup);
  let pins=[], arcs=[], cites=[], mode="idle", level=0, cur=-1, busyRing=null;
  const ray=new THREE.Raycaster(), mouse=new THREE.Vector2();
  function clear(){ pinGroup.clear(); arcGroup.clear(); pins=[]; arcs=[]; cur=-1; }
  function mkPin(G){ const [x,y]=xy(G.ll); const off=G.key==="capitol"?[0.09,0.09]:[0,0]; const n=G.items.length, col=COL[G.cat];
    const g=new THREE.Group(); g.position.set(x+off[0],y+off[1],0.04);
    const stem=new THREE.Mesh(new THREE.CylinderGeometry(0.008,0.008,0.25+0.05*n,8),new THREE.MeshBasicMaterial({color:col})); stem.rotation.x=Math.PI/2; stem.position.z=(0.25+0.05*n)/2; g.add(stem);
    const head=new THREE.Mesh(new THREE.SphereGeometry(0.035+0.008*n,16,12),new THREE.MeshBasicMaterial({color:col})); head.position.z=0.25+0.05*n; g.add(head);
    const halo=new THREE.Mesh(new THREE.RingGeometry(0.05,0.08,32),new THREE.MeshBasicMaterial({color:col,transparent:true,opacity:0.5,side:THREE.DoubleSide})); g.add(halo);
    g.userData={G,head,halo,born:performance.now()}; g.scale.setScalar(0.001); pinGroup.add(g); return g; }
  function mkArc(p1,p2,type){ const a=p1.clone(), b=p2.clone(); const mid=a.clone().add(b).multiplyScalar(0.5); mid.z+=0.4+a.distanceTo(b)*0.35;
    const curve=new THREE.QuadraticBezierCurve3(a,mid,b), pts=curve.getPoints(48), geo=new THREE.BufferGeometry().setFromPoints(pts); geo.setDrawRange(0,0);
    const line=new THREE.Line(geo,new THREE.LineBasicMaterial({color:ARC[type],transparent:true,opacity:0.9})); arcGroup.add(line); return {line,n:pts.length,t:0}; }
  Object.assign(api,{
    busy(){ mode="busy"; clear(); label.textContent="Agents retrieving across Colorado courts…"; document.getElementById("cnt").textContent="";
      busyRing=new THREE.Mesh(new THREE.RingGeometry(0.15,0.2,48),new THREE.MeshBasicMaterial({color:0x818cf8,transparent:true,opacity:0.8,side:THREE.DoubleSide}));
      const [x,y]=xy(DENVER); busyRing.position.set(x,y,0.05); pinGroup.add(busyRing); camT.copy(home); lookT.set(0,0,0); },
    show(c0,edges=[],docs=[]){ mode="show"; clear(); const c=c0.concat(docs); cites=c; api._c=c; const g=groups(c); const where={}; let seq=0;
      [...g.values()].forEach((G,k)=>{ const p=mkPin(G); p.userData.born=performance.now()+k*250; pins.push(p); G.items.forEach(i=>where[i]=p); });
      const id={}; c.forEach((x,i)=>id[x.id]=i);
      edges.filter(e=>e.src in id&&e.dst in id&&where[id[e.src]]!==where[id[e.dst]]).slice(0,40).forEach(e=>{
        const pa=where[id[e.src]], pb=where[id[e.dst]]; const A=new THREE.Vector3().copy(pa.position).setZ(0.06), B=new THREE.Vector3().copy(pb.position).setZ(0.06);
        const arc=mkArc(A,B,arcType(c[id[e.src]],c[id[e.dst]])); arc.start=performance.now()+600+seq++*220; arcs.push(arc); });
      let denverPin=pins.find(p=>p.userData.G.key==="denver");
      const ups=[...g.values()].filter(G=>G.up);
      if(ups.length&&!denverPin){ denverPin=mkPin({key:"denver",ll:DENVER,label:"Colorado appellate courts (Denver)",cat:"state",items:[]}); denverPin.userData.born=performance.now(); pins.push(denverPin); }
      ups.forEach(G=>{ const p=pins.find(q=>q.userData.G===G); if(!p||!denverPin) return;
        const arc=mkArc(new THREE.Vector3().copy(p.position).setZ(0.06),new THREE.Vector3().copy(denverPin.position).setZ(0.06),"cs"); arc.start=performance.now()+400+seq++*220; arcs.push(arc); });
      edges.filter(e=>e.src in id&&e.dst in id&&where[id[e.src]]===where[id[e.dst]]).slice(0,16).forEach((e,k)=>{ const p=where[id[e.src]]; const c0=new THREE.Vector3().copy(p.position).setZ(0.06);
        const ang=k*0.9, r=0.18+0.03*(k%4); const a=c0.clone().add(new THREE.Vector3(Math.cos(ang)*0.05,Math.sin(ang)*0.05,0)), b=c0.clone().add(new THREE.Vector3(Math.cos(ang)*r,Math.sin(ang)*r,0));
        const arc=mkArc(a,b,arcType(c[id[e.src]],c[id[e.dst]])); arc.start=performance.now()+600+seq++*160; arcs.push(arc); });
      document.getElementById("cnt").textContent=`${counties(c)} counties linked · ${g.size} locations · ${arcs.length} links`;
      api.focus(0); },
    focus(k){ if(!cites[k]) return; cur=k; const p=pins.find(p=>p.userData.G.items.includes(k)); if(!p) return;
      label.innerHTML=`<b class="text-indigo-300">${cites[k].ref||"retrieved"}</b> ${cites[k].title.replace(/</g,"&lt;")}<br><span class="text-slate-400">${cites[k]._loc.label}</span>`;
      lookT.copy(p.position); camT.set(p.position.x*0.5,p.position.y-4.6,4.4); },
    pulse(v){ level=v; }, idle(){ mode="idle"; } });
  R.domElement.addEventListener("click",ev=>{ const r=R.domElement.getBoundingClientRect(); mouse.set(((ev.clientX-r.left)/r.width)*2-1,-((ev.clientY-r.top)/r.height)*2+1);
    ray.setFromCamera(mouse,cam); const hit=ray.intersectObjects(pins.flatMap(p=>[p.userData.head,p.children[0]]),false)[0];
    if(hit){ const G=hit.object.parent.userData.G; const k=G.items.includes(cur)?cur:G.items[0]; api.focus(k); openDoc(cites[k]); } });
  R.domElement.style.cursor="pointer";
  function resize(){ const w=host.clientWidth,h=host.clientHeight; R.setSize(w,h); cam.aspect=w/h; cam.updateProjectionMatrix(); }
  new ResizeObserver(resize).observe(host); resize();
  R.setAnimationLoop(now=>{ const t=now/1000;
    cam.position.lerp(camT,0.04); look.lerp(lookT,0.06); cam.lookAt(look);
    if(busyRing){ busyRing.scale.setScalar(1+((t*1.5)%1)*3); busyRing.material.opacity=0.8*(1-((t*1.5)%1)); }
    pins.forEach(p=>{ const u=p.userData, age=(now-u.born)/400; p.scale.setScalar(Math.max(0.001,Math.min(1,age))); const focused=u.G.items.includes(cur);
      const s=1+(focused?0.3+level*1.2:0)+Math.sin(t*3+p.position.x)*0.06; u.head.scale.setScalar(s); u.halo.scale.setScalar(1+((t+p.position.y)%1.2)*1.5*(focused?1.6:1)); u.halo.material.opacity=0.55*(1-((t+p.position.y)%1.2)/1.2); });
    arcs.forEach(a=>{ if(now>a.start){ a.t=Math.min(1,a.t+0.025); a.line.geometry.setDrawRange(0,Math.floor(a.t*a.n)); } });
    R.render(scene,cam); });
}
