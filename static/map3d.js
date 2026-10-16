// 3D United States citation map: states extruded (Albers USA, vendored us-atlas + d3-geo), Colorado raised.
// One glowing pin per retrieved document at its deciding court; arcs for graph links; camera US -> Colorado -> pins.
const host = document.getElementById("docs3d");
const api = { busy(){}, show(){}, focus(){}, pulse(){}, idle(){} }; window.Docs3D = api;
const DENVER=[39.7393,-104.9897], CAPITOL=[39.7392,-104.9848], DC=[38.8906,-77.0044];
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


const CAP={alabama:[32.377,-86.300],alaska:[58.302,-134.420],arizona:[33.448,-112.097],arkansas:[34.747,-92.289],california:[38.577,-121.494],colorado:[39.739,-104.985],connecticut:[41.764,-72.682],delaware:[39.157,-75.520],florida:[30.438,-84.281],georgia:[33.749,-84.388],hawaii:[21.307,-157.857],idaho:[43.618,-116.200],illinois:[39.798,-89.654],indiana:[39.768,-86.163],iowa:[41.591,-93.604],kansas:[39.048,-95.678],kentucky:[38.187,-84.875],louisiana:[30.457,-91.187],maine:[44.307,-69.782],maryland:[38.979,-76.491],massachusetts:[42.358,-71.064],michigan:[42.733,-84.555],minnesota:[44.955,-93.102],mississippi:[32.304,-90.182],missouri:[38.579,-92.173],montana:[46.586,-112.018],nebraska:[40.808,-96.700],nevada:[39.164,-119.766],"new hampshire":[43.207,-71.538],"new jersey":[40.220,-74.770],"new mexico":[35.682,-105.940],"new york":[42.653,-73.757],"north carolina":[35.780,-78.639],"north dakota":[46.821,-100.783],ohio:[39.961,-82.999],oklahoma:[35.492,-97.503],oregon:[44.938,-123.030],pennsylvania:[40.264,-76.884],"rhode island":[41.831,-71.415],"south carolina":[34.000,-81.033],"south dakota":[44.367,-100.346],tennessee:[36.166,-86.784],texas:[30.275,-97.740],utah:[40.777,-111.888],vermont:[44.262,-72.581],virginia:[37.539,-77.434],washington:[47.036,-122.905],"west virginia":[38.336,-81.612],wisconsin:[43.075,-89.384],wyoming:[41.140,-104.820]};
const CIRC={first:[42.352,-71.050,"1st Cir. (Boston)"],second:[40.714,-74.002,"2d Cir. (New York)"],third:[39.951,-75.150,"3d Cir. (Philadelphia)"],fourth:[37.539,-77.434,"4th Cir. (Richmond)"],fifth:[29.951,-90.071,"5th Cir. (New Orleans)"],sixth:[39.103,-84.512,"6th Cir. (Cincinnati)"],seventh:[41.878,-87.630,"7th Cir. (Chicago)"],eighth:[38.627,-90.199,"8th Cir. (St. Louis)"],ninth:[37.780,-122.416,"9th Cir. (San Francisco)"],tenth:[39.745,-104.992,"10th Cir. (Denver)"],eleventh:[33.749,-84.388,"11th Cir. (Atlanta)"]};
const STATES=Object.keys(CAP).sort((a,b)=>b.length-a.length);
const tc=s=>s.replace(/\b\w/g,x=>x.toUpperCase());
function locate(c){ const t=(c.type||"").toLowerCase(), court=(c.court||""), lc=court.toLowerCase();
  if(t.includes("statute")||t.includes("cfr")||/c\.r\.s\./i.test(c.id)) return /u\.s\.c|cfr/i.test(c.id+t)?{key:"dc-stat",ll:DC,label:"U.S. Code / CFR (Washington, DC)",cat:"federal"}:{key:"capitol",ll:CAPITOL,label:"Colorado State Capitol (C.R.S.)",cat:"statute"};
  if(/supreme court of the united states/.test(lc)||(!court&&/ U\.S\. \d/.test(c.id))) return {key:"scotus",ll:DC,label:"U.S. Supreme Court (Washington, DC)",cat:"federal"};
  let m=lc.match(/court of appeals for the (\w+) circuit/); if(m){ if(m[1]==="federal"||m[1]==="district") return {key:"dccir",ll:DC,label:"D.C./Federal Circuit",cat:"federal"};
    const C=CIRC[m[1]]; if(C) return {key:"cir:"+m[1],ll:C,label:"U.S. Court of Appeals, "+C[2],cat:m[1]==="tenth"?"state":"federal"}; }
  const coState=/colorado/.test(lc)||(!court&&/P\.[23]d|COA|CO \d/.test(c.id));
  if(coState){ const courtLabel=/appeals/i.test(court)?"Colorado Court of Appeals (Denver)":/supreme/i.test(court)?"Colorado Supreme Court (Denver)":/district court for the district of colorado/.test(lc)?"U.S. District Court, D. Colo. (Denver)":"Colorado courts (Denver)";
    const k=findCounty((c.origin_text||"")+" "+(c.passage||""));
    if(k&&k!=="denver") return {key:"c:"+k,ll:SEATS[k],label:`${tc(k)} County (${SEATS[k][2]}) → ${courtLabel}`,cat:"county",up:true};
    return {key:"denver",ll:DENVER,label:courtLabel,cat:"state"}; }
  const st=STATES.find(n=>lc.includes(n)); if(st) return {key:"st:"+st,ll:CAP[st],label:`${court.slice(0,48)} (${tc(st)})`,cat:"federal"};
  return {key:"denver",ll:DENVER,label:"Colorado courts (Denver)",cat:"state"}; }
const proj=d3.geoAlbersUsa().scale(1300).translate([487.5,305]), U=0.01;
const xy=([la,lo])=>{ const p=proj([lo,la])||proj([-104.98,39.74]); return [(p[0]-487.5)*U,-(p[1]-305)*U]; };
const COL={county:0x34d399,state:0x818cf8,statute:0xf59e0b,federal:0xf472b6}, ARC={cc:0x34d399,cs:0x60a5fa,st:0xf59e0b,fed:0xf472b6,other:0x94a3b8};
const panel=document.createElement("div"); panel.className="absolute left-4 bottom-4 w-[340px] hidden [perspective:1000px] z-30"; host.parentElement.appendChild(panel);
function openDoc(c){ panel.classList.remove("hidden"); const E=t=>String(t||"").replace(/</g,"&lt;"); const q=window.cleanPassage?cleanPassage(c.passage):(c.passage||"").slice(0,300);
 panel.innerHTML=`<div id="pg" class="w-full max-h-[50vh] overflow-auto rounded-xl p-4 text-slate-100 origin-left transition-transform duration-500 border border-white/10 shadow-2xl" style="transform:rotateY(-95deg);background:rgba(15,18,30,.55);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px)">
 <button class="float-right text-slate-400 hover:text-white" onclick="this.closest('.absolute').classList.add('hidden')">✕</button>
 <div class="text-indigo-300 font-semibold text-xs">${c.ref||"related"} · ${E(c.type)}</div><div class="font-semibold text-base leading-snug mt-1">${E(c.title)}</div>
 <div class="text-[11px] text-slate-400 mt-1">${[c.court,c.date].filter(Boolean).map(E).join(" · ")}${c._loc?" · "+E(c._loc.label):""}</div>
 ${q?`<blockquote class="mt-3 text-[13px] leading-relaxed text-slate-200 border-l-2 border-indigo-400/70 pl-3 italic">${E(q)}</blockquote>`:`<div class="mt-3 text-xs text-slate-400">Graph-linked authority (no passage retrieved).</div>`}
 <div class="mt-2">${window.caseLinks?caseLinks(c):""}</div>${c.url?`<a href="${c.url}" target="_blank" rel="noopener" class="text-indigo-300 text-xs underline mt-2 inline-block">Open source ↗</a>`:""}</div>`;
 requestAnimationFrame(()=>requestAnimationFrame(()=>{ const p=document.getElementById("pg"); if(p) p.style.transform="rotateY(0)"; })); }
api.open=openDoc; api.closeDoc=()=>{ panel.classList.add("hidden"); }; addEventListener("keydown",e=>{ if(e.key==="Escape") panel.classList.add("hidden"); });
const legend=document.createElement("div"); legend.className="absolute top-3 left-4 text-[11px] text-slate-300 space-y-0.5 pointer-events-none";
legend.innerHTML=`<div class="uppercase tracking-widest text-slate-500">U.S. citation map · Colorado focus</div><div><span style="color:#34d399">━</span> county↔county</div><div><span style="color:#60a5fa">━</span> county → state court</div><div><span style="color:#f59e0b">━</span> case ↔ statute</div><div><span style="color:#f472b6">━</span> federal / out-of-state</div><div id="cnt" class="text-indigo-300 font-semibold"></div>`;
host.parentElement.appendChild(legend);
const label=document.createElement("div"); label.className="absolute top-3 right-4 text-sm text-slate-200 text-right pointer-events-none max-w-[45%]"; host.parentElement.appendChild(label); if(document.getElementById("fullmap")) label.style.top="44px";
function groups(cites){ const g=new Map(); cites.forEach((c,i)=>{ const L=locate(c); c._loc=L; if(!g.has(L.key)) g.set(L.key,{...L,items:[]}); g.get(L.key).items.push(i); }); return g; }
function arcType(a,b){ const A=a._loc.cat,B=b._loc.cat; if(A==="federal"||B==="federal") return "fed"; if(A==="statute"||B==="statute") return "st"; if(A==="county"&&B==="county") return "cc"; if((A==="county")!==(B==="county")) return "cs"; return "other"; }
function counties(c){ return new Set(c.filter(x=>x._loc&&x._loc.cat==="county").map(x=>x._loc.key)).size; }
function states(c){ return new Set(c.map(x=>x._loc&&x._loc.key.startsWith("st:")?x._loc.key:(x._loc&&["scotus","dc-stat","dccir"].includes(x._loc.key)?"dc":(x._loc&&x._loc.key.startsWith("cir:")&&x._loc.key!=="cir:tenth"?x._loc.key:"co")))).size; }
let webgl=false; try{ const t=document.createElement("canvas"); webgl=!!(t.getContext("webgl2")||t.getContext("webgl")); }catch(e){}
const usData = await (await fetch("/static/vendor/us_states_proj.json")).json();
if(!webgl){
  const path=r=>"M"+r.map(p=>p.join(",")).join("L")+"Z";
  host.innerHTML=`<svg viewBox="0 0 975 610" class="w-full h-full">${usData.map(s=>s.polys.map(r=>`<path d="${path(r)}" fill="${s.name==="Colorado"?"#3730a3":"#1e293b"}" stroke="#6366f1" stroke-width="0.6"/>`).join("")).join("")}<g id="arcs2"></g><g id="pins2"></g></svg>`;
  const P2=([la,lo])=>proj([lo,la])||proj([-104.98,39.74]); let cites=[];
  Object.assign(api,{ busy(){ document.getElementById("pins2").innerHTML=""; document.getElementById("arcs2").innerHTML=""; label.textContent="Agents retrieving…"; },
   show(c0,edges=[],docs=[]){ const c=c0.concat(docs); cites=c; api._c=c; const g=groups(c); const P=document.getElementById("pins2"); P.innerHTML="";
    g.forEach(G=>{ const [x,y]=P2(G.ll); P.insertAdjacentHTML("beforeend",`<circle cx="${x}" cy="${y}" r="${2+G.items.length}" fill="#${COL[G.cat].toString(16)}" style="cursor:pointer" onclick="Docs3D.open(Docs3D._c[${G.items[0]}])"><title>${G.label}</title></circle>`); });
    const id={}; c.forEach((x,i)=>id[x.id]=i); const A=document.getElementById("arcs2"); A.innerHTML="";
    edges.filter(e=>e.src in id&&e.dst in id).forEach(e=>{ const a=c[id[e.src]],b=c[id[e.dst]]; const [x1,y1]=P2(a._loc.ll),[x2,y2]=P2(b._loc.ll);
      A.insertAdjacentHTML("beforeend",`<path d="M${x1},${y1} Q${(x1+x2)/2},${(y1+y2)/2-40} ${x2},${y2}" stroke="#${ARC[arcType(a,b)].toString(16)}" stroke-width="1.2" fill="none"/>`); });
    document.getElementById("cnt").textContent=`${counties(c)} counties linked · ${states(c)} jurisdictions`; },
   focus(k){ if(cites[k]) label.textContent=`${cites[k].ref} ${cites[k].title} — ${cites[k]._loc.label}`; } });
} else {
  const THREE = await import("/static/vendor/three.module.min.js");
  const R=new THREE.WebGLRenderer({antialias:true,alpha:true}); R.setPixelRatio(Math.min(devicePixelRatio,2)); host.appendChild(R.domElement);
  const scene=new THREE.Scene(), cam=new THREE.PerspectiveCamera(36,1,0.01,100); cam.up.set(0,0,1);
  const homeCam=new THREE.Vector3(0,-1.9,8.2), homeLook=new THREE.Vector3(0,0.2,0); cam.position.copy(homeCam);
  const look=homeLook.clone(), lookT=homeLook.clone(), camT=homeCam.clone(); cam.lookAt(look);
  scene.add(new THREE.AmbientLight(0xffffff,0.75)); const dl=new THREE.DirectionalLight(0xc7d2fe,1.5); dl.position.set(-3,-4,6); scene.add(dl);
  const matS=new THREE.MeshStandardMaterial({color:0x172042,roughness:0.7,metalness:0.15}), matCO=new THREE.MeshStandardMaterial({color:0x3730a3,roughness:0.5,metalness:0.3,emissive:0x1e1b4b});
  const lineM=new THREE.LineBasicMaterial({color:0x4f46e5,transparent:true,opacity:0.7}), lineCO=new THREE.LineBasicMaterial({color:0xa5b4fc});
  let coC=new THREE.Vector3();
  for(const s of usData){ const co=s.name==="Colorado"; const depth=co?0.12:0.04;
    for(const r of s.polys){ const sh=new THREE.Shape(r.map(([x,y])=>new THREE.Vector2((x-487.5)*U,-(y-305)*U)));
      const m=new THREE.Mesh(new THREE.ExtrudeGeometry(sh,{depth,bevelEnabled:false}),co?matCO:matS); m.position.z=-depth+(co?0.06:0); scene.add(m);
      const pts=r.map(([x,y])=>new THREE.Vector3((x-487.5)*U,-(y-305)*U,(co?0.061:0.001))); pts.push(pts[0]);
      scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),co?lineCO:lineM));
      if(co){ const b=new THREE.Box3().setFromPoints(pts); b.getCenter(coC); } } }
  const Z0=0.064, Zof=(ll,key)=>{ const [la,lo]=ll; const o=key&&typeof cByName!=='undefined'&&cByName[key]; return (la>36.9&&la<41.1&&lo>-109.1&&lo<-102)?Z0+(o?o.raise:0):0.002; };
  const dots=new THREE.Points(new THREE.BufferGeometry().setFromPoints(Object.values(SEATS).map(s=>{const [x,y]=xy(s);return new THREE.Vector3(x,y,Z0+0.001)})),new THREE.PointsMaterial({color:0x818cf8,size:0.012}));
  scene.add(dots);
  // --- Basemap (CARTO dark, OSM) reprojected onto Albers via UV grid; silent fallback ---
  function lon2t(lo,z){ return (lo+180)/360*2**z; } function lat2t(la,z){ const r=la*Math.PI/180; return (1-Math.log(Math.tan(r)+1/Math.cos(r))/Math.PI)/2*2**z; }
  function basemap(z,lo0,lo1,la0,la1,zpos,clipCO){ const x0=Math.floor(lon2t(lo0,z)),x1=Math.floor(lon2t(lo1,z)),y0=Math.floor(lat2t(la1,z)),y1=Math.floor(lat2t(la0,z));
    const nx=x1-x0+1, ny=y1-y0+1, cv=document.createElement("canvas"); cv.width=nx*256; cv.height=ny*256; const cx=cv.getContext("2d"); let ok=0, done=0, total=nx*ny;
    const finish=()=>{ if(ok<total*0.6) return; const tex=new THREE.CanvasTexture(cv); tex.colorSpace=THREE.SRGBColorSpace; const N=40, pos=[], uv=[], idx=[];
      for(let j=0;j<=N;j++) for(let i=0;i<=N;i++){ const lo=lo0+(lo1-lo0)*i/N, la=la0+(la1-la0)*j/N, p=proj([lo,la]); const [x,y]=p?[(p[0]-487.5)*U,-(p[1]-305)*U]:[NaN,NaN];
        pos.push(x,y,zpos); uv.push((lon2t(lo,z)-x0)/nx, 1-(lat2t(la,z)-y0)/ny); }
      for(let j=0;j<N;j++) for(let i=0;i<N;i++){ const a=j*(N+1)+i,b=a+1,c=a+N+1,d=c+1; if([a,b,c,d].some(k=>isNaN(pos[k*3]))) continue; idx.push(a,b,d,a,d,c); }
      const g=new THREE.BufferGeometry(); g.setAttribute("position",new THREE.Float32BufferAttribute(pos,3)); g.setAttribute("uv",new THREE.Float32BufferAttribute(uv,2)); g.setIndex(idx);
      scene.add(new THREE.Mesh(g,new THREE.MeshBasicMaterial({map:tex,transparent:true,opacity:clipCO?0.9:0.75,depthWrite:false}))); attr.style.display="block"; };
    for(let x=x0;x<=x1;x++) for(let y=y0;y<=y1;y++){ const im=new Image(); im.crossOrigin="anonymous"; let t=setTimeout(()=>{ im.src=""; if(++done===total) finish(); },3000);
      im.onload=()=>{ clearTimeout(t); cx.drawImage(im,(x-x0)*256,(y-y0)*256); cx.filter="none"; ok++; if(++done===total) finish(); }; im.onerror=()=>{ clearTimeout(t); if(++done===total) finish(); };
      im.src=`https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/${z}/${y}/${x}`; } }
  const attr=document.createElement("div"); attr.className="absolute bottom-1 right-2 text-[10px] text-slate-500 z-10"; attr.style.display="none"; attr.innerHTML='Basemap © Esri, HERE, Garmin, © OpenStreetMap contributors'; host.parentElement.appendChild(attr);
  try{ basemap(7,-109.06,-102.04,36.99,41.0,0.0606,true); }catch(e){}
  // --- Colorado counties (us-atlas counties-10m, FIPS 08xxx) ---
  const coCounties=await (await fetch("/static/vendor/co_counties_proj.json")).json(); const cMeshes=[], cByName={};
  const ctyLine=new THREE.LineBasicMaterial({color:0xc7d2fe,transparent:true,opacity:0.95});
  for(const C of coCounties){ const key=C.name.toLowerCase(); const grp=new THREE.Group(); grp.position.z=0.061;
    const mat=new THREE.MeshStandardMaterial({color:0x312e81,transparent:true,opacity:0.18,emissive:0x000000,depthWrite:false});
    for(const r of C.polys){ const sh=new THREE.Shape(r.map(([x,y])=>new THREE.Vector2((x-487.5)*U,-(y-305)*U)));
      const m=new THREE.Mesh(new THREE.ExtrudeGeometry(sh,{depth:0.002,bevelEnabled:false}),mat); m.userData.key=key; grp.add(m); cMeshes.push(m);
      const pts=r.map(([x,y])=>new THREE.Vector3((x-487.5)*U,-(y-305)*U,0.0025)); pts.push(pts[0]); grp.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),ctyLine)); }
    scene.add(grp); cByName[key]={C,grp,mat,n:0,items:[],raise:0}; }
  function heatCounties(c){ Object.values(cByName).forEach(o=>{ o.n=0; o.items=[]; o.raise=0; o.mat.color.setHex(0x312e81); o.mat.opacity=0.18; o.mat.emissive.setHex(0); o.grp.scale.z=1; });
    c.forEach((x,i)=>{ const k=x._loc&&x._loc.cat==="county"&&x._loc.key; if(k&&cByName[k]){ cByName[k].n++; cByName[k].items.push(i); } });
    const mx=Math.max(1,...Object.values(cByName).map(o=>o.n)); Object.values(cByName).forEach(o=>{ if(!o.n) return; const h=o.n/mx;
      o.mat.color.setHSL(0.42-0.3*h,0.8,0.45); o.mat.emissive.setHSL(0.42-0.3*h,0.8,0.15+0.15*h); o.mat.opacity=0.55+0.35*h; o.raise=0.008+0.025*h; o.grp.scale.z=1+o.raise/0.002; }); }
  const tip=document.createElement("div"); tip.className="absolute z-20 pointer-events-none hidden max-w-xs rounded-lg bg-slate-900/95 border border-indigo-500/40 px-3 py-2 text-xs text-slate-200 shadow-xl"; host.parentElement.appendChild(tip);
  let hovT=0; function countyAt(ev){ const r=R.domElement.getBoundingClientRect(); mouse.set(((ev.clientX-r.left)/r.width)*2-1,-((ev.clientY-r.top)/r.height)*2+1); ray.setFromCamera(mouse,cam); const h=ray.intersectObjects(cMeshes,false)[0]; return h&&cByName[h.object.userData.key]; }
  const pinGroup=new THREE.Group(), arcGroup=new THREE.Group(); scene.add(pinGroup, arcGroup);
  let pins=[], arcs=[], cites=[], mode="idle", level=0, cur=-1, busyRing=null, tour=null;
  const ray=new THREE.Raycaster(), mouse=new THREE.Vector2();
  function clear(){ pinGroup.clear(); arcGroup.clear(); pins=[]; arcs=[]; cur=-1; try{ pTags.forEach(t=>t.d.remove()); pTags=[]; }catch(e){} }
  function mkPin(G){ const [x,y]=xy(G.ll); const off=G.key==="capitol"?[0.018,0.018]:[0,0]; const n=G.items.length, col=COL[G.cat], far=G.cat==="federal";
    const k=far?2.2:1, h=(0.07+0.012*n)*k; const g=new THREE.Group(); g.position.set(x+off[0],y+off[1],Zof(G.ll,G.key));
    const stem=new THREE.Mesh(new THREE.CylinderGeometry(0.0025*k,0.0025*k,h,6),new THREE.MeshBasicMaterial({color:col})); stem.rotation.x=Math.PI/2; stem.position.z=h/2; g.add(stem);
    const head=new THREE.Mesh(new THREE.SphereGeometry((0.011+0.002*n)*k,14,10),new THREE.MeshBasicMaterial({color:col})); head.position.z=h; g.add(head);
    const halo=new THREE.Mesh(new THREE.RingGeometry(0.014*k,0.022*k,28),new THREE.MeshBasicMaterial({color:col,transparent:true,opacity:0.5,side:THREE.DoubleSide})); g.add(halo);
    g.userData={G,head,halo,born:performance.now()}; g.scale.setScalar(0.001); pinGroup.add(g); return g; }
  function mkArc(a,b,type){ const mid=a.clone().add(b).multiplyScalar(0.5); mid.z+=0.04+a.distanceTo(b)*0.35;
    const pts=new THREE.QuadraticBezierCurve3(a,mid,b).getPoints(48), geo=new THREE.BufferGeometry().setFromPoints(pts); geo.setDrawRange(0,0);
    const line=new THREE.Line(geo,new THREE.LineBasicMaterial({color:ARC[type],transparent:true,opacity:0.95})); arcGroup.add(line); return {line,n:pts.length,t:0}; }
  const coView=()=>{ lookT.copy(coC); camT.set(coC.x,coC.y-0.28,(host.clientWidth/Math.max(1,host.clientHeight)>1.7?1.25:1.6)); };
  Object.assign(api,{
    busy(){ mode="busy"; panel.classList.add("hidden"); panel.innerHTML=""; try{ tip.classList.add("hidden"); api.stopTour&&api.stopTour(); }catch(e){} clear(); clearTimeout(tour); label.textContent="Agents retrieving across U.S. and Colorado courts…"; document.getElementById("cnt").textContent="";
      busyRing=new THREE.Mesh(new THREE.RingGeometry(0.03,0.04,48),new THREE.MeshBasicMaterial({color:0x818cf8,transparent:true,opacity:0.8,side:THREE.DoubleSide}));
      const [x,y]=xy(DENVER); busyRing.position.set(x,y,Z0+0.002); pinGroup.add(busyRing); coView(); },
    show(c0,edges=[],docs=[]){ mode="show"; clear(); const c=c0.concat(docs); cites=c; api._c=c; const g=groups(c); heatCounties(c); const where={}; let seq=0;
      [...g.values()].forEach((G,k)=>{ const p=mkPin(G); p.userData.born=performance.now()+k*200; pins.push(p); G.items.forEach(i=>where[i]=p); });
      const id={}; c.forEach((x,i)=>id[x.id]=i); const P=p=>new THREE.Vector3().copy(p.position).setZ(p.position.z+0.004);
      let den=pins.find(p=>p.userData.G.key==="denver"); const ups=[...g.values()].filter(G=>G.up);
      if(ups.length&&!den){ den=mkPin({key:"denver",ll:DENVER,label:"Colorado appellate courts (Denver)",cat:"state",items:[]}); den.userData.born=performance.now(); pins.push(den); }
      ups.forEach(G=>{ const p=pins.find(q=>q.userData.G===G); if(p&&den){ const a=mkArc(P(p),P(den),"cs"); a.start=performance.now()+1800+seq++*200; arcs.push(a); } });
      edges.filter(e=>e.src in id&&e.dst in id).slice(0,48).forEach((e,k)=>{ const pa=where[id[e.src]], pb=where[id[e.dst]]; let a;
        if(pa!==pb) a=mkArc(P(pa),P(pb),arcType(c[id[e.src]],c[id[e.dst]]));
        else { const c0v=P(pa), ang=k*0.9, r=0.035+0.006*(k%4); a=mkArc(c0v.clone().add(new THREE.Vector3(Math.cos(ang)*0.008,Math.sin(ang)*0.008,0)),c0v.clone().add(new THREE.Vector3(Math.cos(ang)*r,Math.sin(ang)*r,0)),arcType(c[id[e.src]],c[id[e.dst]])); }
        a.start=performance.now()+1800+seq++*160; arcs.push(a); });
      document.getElementById("cnt").textContent=`${counties(c)} counties linked · ${states(c)} jurisdictions · ${arcs.length} links`; try{ pinTags(); }catch(e){}
      coView(); clearTimeout(tour); tour=setTimeout(()=>api.tour(),1000+Math.min(6,g.size)*200); },
    focus(k){ if(!cites[k]) return; cur=k; const p=pins.find(p=>p.userData.G.items.includes(k)); if(!p) return;
      label.innerHTML=`<b class="text-indigo-300">${cites[k].ref||"retrieved"}</b> ${cites[k].title.replace(/</g,"&lt;")}<br><span class="text-slate-400">${cites[k]._loc.label}</span>`;
      const cat=p.userData.G.cat, far=cat==="federal", d=far?2.6:(cat==="county"?0.75:1.0); lookT.copy(p.position); camT.set(p.position.x,p.position.y-d*0.25,d); if(window.matchMedia&&matchMedia("(prefers-reduced-motion: reduce)").matches){ cam.position.copy(camT); look.copy(lookT); } },
    order(){ return cites.map((c,i)=>[i,parseInt(String(c.ref||"").replace(/\D/g,""))||0]).filter(x=>x[1]>0).sort((a,b)=>a[1]-b[1]).map(x=>x[0]); },
    tour(start=0){ clearTimeout(tour); const O=api.order(); if(!O.length) return; touring=true; tbtn.textContent="❚❚ Pause";
      if(window.matchMedia&&matchMedia("(prefers-reduced-motion: reduce)").matches){ api.focus(O[0]); touring=false; tbtn.textContent="▶ Tour"; return; }
      const step=n=>{ if(!touring) return; if(n>=O.length){ api.fit(); touring=false; tbtn.textContent="▶ Tour"; return; } tpos=n; api.focus(O[n]); tour=setTimeout(()=>step(n+1),2600); }; step(start); },
    stopTour(){ touring=false; clearTimeout(tour); tbtn.textContent="▶ Tour"; },
    fit(){ const fed=pins.some(p=>p.userData.G.cat==="federal"); if(fed){ camT.copy(homeCam); lookT.copy(homeLook); } else coView(); },
    pulse(v){ level=v; }, idle(){ mode="idle"; }, view(m){ clearTimeout(tour); if(m==="co") coView(); else { camT.copy(homeCam); lookT.copy(homeLook); } } });
  R.domElement.addEventListener("click",ev=>{ const r=R.domElement.getBoundingClientRect(); mouse.set(((ev.clientX-r.left)/r.width)*2-1,-((ev.clientY-r.top)/r.height)*2+1);
    ray.setFromCamera(mouse,cam); ray.params.Line.threshold=0.01; const hit=ray.intersectObjects(pins.flatMap(p=>[p.userData.head,p.children[0]]),false)[0];
    R._ph=!!hit; if(hit){ const G=hit.object.parent.userData.G; const k=G.items.includes(cur)?cur:G.items[0]; if(k!==undefined){ api.focus(k); openDoc(cites[k]); } } });
  let touring=false, tpos=0; const tbar=document.createElement("div"); tbar.className="absolute bottom-10 right-4 z-20 flex gap-1 text-xs";
  const mk=(t,f)=>{ const b=document.createElement("button"); b.textContent=t; b.className="px-2.5 py-1 rounded-full bg-slate-900/70 border border-indigo-400/40 text-slate-200 hover:bg-indigo-600/60"; b.onclick=e=>{e.stopPropagation();f();}; tbar.appendChild(b); return b; };
  mk("◀",()=>{ api.stopTour(); const O=api.order(); tpos=Math.max(0,tpos-1); if(O[tpos]!==undefined) api.focus(O[tpos]); });
  const tbtn=mk("▶ Tour",()=>{ touring?api.stopTour():api.tour(0); });
  mk("▶",()=>{ api.stopTour(); const O=api.order(); tpos=Math.min(O.length-1,tpos+1); if(O[tpos]!==undefined) api.focus(O[tpos]); });
  host.parentElement.appendChild(tbar);
  ["wheel","pointerdown"].forEach(ev=>R.domElement.addEventListener(ev,()=>{ if(touring) api.stopTour(); },{passive:true}));
  // --- HTML overlay: county names + always-on pin tags with greedy collision avoidance ---
  const ov=document.createElement("div"); ov.className="absolute inset-0 pointer-events-none z-[15] overflow-hidden"; host.parentElement.appendChild(ov);
  const cLab=coCounties.map(C=>{ const d=document.createElement("div"); d.textContent=C.name; d.style.cssText="position:absolute;left:0;top:0;font-size:10px;letter-spacing:.04em;white-space:nowrap;transform:translate(-50%,-50%);color:rgba(203,213,225,.55);text-shadow:0 1px 2px #000"; ov.appendChild(d);
    const xs=C.polys.flat().map(p=>p[0]), ys=C.polys.flat().map(p=>p[1]); return {C,d,key:C.name.toLowerCase(),v:new THREE.Vector3((C.c[0]-487.5)*U,-(C.c[1]-305)*U,0.066),w:Math.max(...xs)-Math.min(...xs)}; });
  let pTags=[];
  function pinTags(){ pTags.forEach(t=>t.d.remove()); pTags=pins.filter(p=>p.userData.G.items.length).map(p=>{ const G=p.userData.G; const its=G.items.filter(i=>cites[i]&&cites[i].ref).sort((a,b)=>parseInt(String(cites[a].ref).replace(/\D/g,""))-parseInt(String(cites[b].ref).replace(/\D/g,""))); const lead=its.length?its:G.items;
      const c0=cites[lead[0]]||{}; const court=(c0.court||"").trim()||G.label; const refs=its.slice(0,3).map(i=>cites[i].ref).join("");
      const d=document.createElement("div"); d.style.cssText="position:absolute;left:0;top:0;white-space:nowrap;font-size:11px;padding:2px 7px;border-radius:999px;background:rgba(15,18,30,.6);backdrop-filter:blur(6px);border:1px solid rgba(165,180,252,.35);color:#e2e8f0;transform:translate(-50%,-140%)";
      d.innerHTML=(refs?`<b style="color:#a5b4fc">${refs}</b> `:`<span style="color:#94a3b8">related</span> `)+court.replace(/</g,"&lt;").slice(0,38); ov.appendChild(d); return {p,d,items:G.items}; }); }
  const _v=new THREE.Vector3();
  function overlay(){ requestAnimationFrame(overlay); const W=host.clientWidth,H=host.clientHeight; if(!W) return; const boxes=[];
    const fm=document.getElementById("fullmap"); if(fm){ const a=fm.getBoundingClientRect(), r=host.getBoundingClientRect(); boxes.push([a.left-r.left-6,a.top-r.top-6,a.width+12,a.height+12]); } const lb=label.getBoundingClientRect(), rr=host.getBoundingClientRect(); if(lb.width) boxes.push([lb.left-rr.left,lb.top-rr.top,lb.width,lb.height]);
    const hit=(x,y,w,h)=>boxes.some(b=>x<b[0]+b[2]&&x+w>b[0]&&y<b[1]+b[3]&&y+h>b[1]);
    pTags.forEach(t=>{ _v.copy(t.p.position); _v.z+=0.09; _v.project(cam); if(_v.z>1||Math.abs(_v.x)>1.1||Math.abs(_v.y)>1.1){ t.d.style.display="none"; return; }
      let x=(_v.x+1)/2*W, y=(1-_v.y)/2*H; const w=t.d.offsetWidth||90, h=18; let k=0; while(k<5&&hit(x-w/2,y-h*1.4-k*20,w,h)) k++;
      y-=k*20; boxes.push([x-w/2,y-h*1.4,w,h]); const act=t.items.includes(cur); t.d.style.display=""; t.d.style.left=x+"px"; t.d.style.top=y+"px";
      t.d.style.borderColor=act?"#a5b4fc":"rgba(165,180,252,.35)"; t.d.style.boxShadow=act?"0 0 14px rgba(129,140,248,.8)":"none"; t.d.style.zIndex=act?2:1; });
    const px=1/Math.max(1e-6,cam.position.distanceTo(look));
    cLab.forEach(L=>{ _v.copy(L.v); _v.project(cam); const x=(_v.x+1)/2*W, y=(1-_v.y)/2*H; const o=cByName[L.key]; const w=L.d.offsetWidth||50, h=12;
      const scrW=L.w*U*W*0.45*px; if(_v.z>1||x<0||y<0||x>W||y>H||(scrW<w*0.8&&!(o&&o.n))||hit(x-w/2,y-h/2,w,h)){ L.d.style.display="none"; return; }
      boxes.push([x-w/2,y-h/2,w,h]); L.d.style.display=""; L.d.style.left=x+"px"; L.d.style.top=y+"px"; L.d.style.color=o&&o.n?"#6ee7b7":"rgba(203,213,225,.6)"; L.d.style.fontWeight=o&&o.n?"700":"400"; }); }
  overlay();
  coView(); cam.position.copy(camT); look.copy(lookT); cam.lookAt(look);
  R.domElement.style.cursor="pointer";
  R.domElement.addEventListener("mousemove",ev=>{ const now=performance.now(); if(now-hovT<40) return; hovT=now; const _co=countyAt(ev); const esc=t=>String(t||"").replace(/</g,"&lt;"); const r0=host.parentElement.getBoundingClientRect();
    ray.params.Line.threshold=0.01; const ph=ray.intersectObjects(pins.flatMap(p=>[p.userData.head,p.children[0]]),false)[0];
    if(ph){ const G=ph.object.parent.userData.G; tip.style.left=(ev.clientX-r0.left+14)+"px"; tip.style.top=(ev.clientY-r0.top+14)+"px"; tip.classList.remove("hidden");
      tip.innerHTML=`<b class="text-emerald-300">${esc(G.label)}</b><div class="mt-1 text-slate-400">${G.items.length} document${G.items.length>1?"s":""} · click to open</div><ul class="mt-1 list-disc pl-4">${G.items.slice(0,6).map(i=>`<li><b class="text-indigo-300">${esc(cites[i].ref||"")}</b> ${esc(cites[i].title).slice(0,70)}</li>`).join("")}</ul>`; return; }
    const o=_co; if(!o){ tip.classList.add("hidden"); return; }
    const r=host.parentElement.getBoundingClientRect(); tip.style.left=(ev.clientX-r.left+14)+"px"; tip.style.top=(ev.clientY-r.top+14)+"px"; tip.classList.remove("hidden");
    tip.innerHTML=`<b class="text-emerald-300">${esc(o.C.name)} County</b> <span class="text-slate-400">FIPS ${o.C.fips}</span>`+(o.n?`<div class="mt-1 text-slate-400">${o.n} retrieved case${o.n>1?"s":""} · click to open</div><ul class="mt-1 list-disc pl-4">${o.items.slice(0,6).map(i=>`<li>${esc(cites[i].title).slice(0,70)}</li>`).join("")}</ul>`:'<div class="text-slate-500">no retrieved cases</div>'); });
  R.domElement.addEventListener("mouseleave",()=>tip.classList.add("hidden"));
  R.domElement.addEventListener("click",ev=>{ const o=countyAt(ev); if(!R._ph&&o&&o.n){ const k=o.items[0]; api.focus(k); openDoc(cites[k]); } });
  function resize(){ const w=host.clientWidth,h=host.clientHeight; R.setSize(w,h); cam.aspect=w/h; cam.updateProjectionMatrix(); }
  new ResizeObserver(resize).observe(host); resize();
  R.setAnimationLoop(now=>{ const t=now/1000;
    cam.position.lerp(camT,0.035); look.lerp(lookT,0.05); cam.lookAt(look);
    if(busyRing){ busyRing.scale.setScalar(1+((t*1.5)%1)*4); busyRing.material.opacity=0.8*(1-((t*1.5)%1)); }
    pins.forEach(p=>{ const u=p.userData, age=(now-u.born)/400; p.scale.setScalar(Math.max(0.001,Math.min(1,age))); const f=u.G.items.includes(cur);
      u.head.scale.setScalar(1+(f?0.4+level*1.4:0)+Math.sin(t*3+p.position.x*9)*0.08); const ph=((t+p.position.y*5)%1.2)/1.2; u.halo.scale.setScalar(1+ph*2*(f?1.6:1)); u.halo.material.opacity=0.6*(1-ph); });
    arcs.forEach(a=>{ if(now>a.start){ a.t=Math.min(1,a.t+0.03); a.line.geometry.setDrawRange(0,Math.floor(a.t*a.n)); } });
    R.render(scene,cam); });
}
