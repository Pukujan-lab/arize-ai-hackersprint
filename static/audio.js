// Global audio manager: every Audio/TTS/speech goes through here so mute & stop always work.
(function(){
const KEY="precedent.mute.v2", all=new Set(), ctrls=new Set();   /* v2: sound ON by default; old saved mutes are ignored */
let muted=false; try{ muted=localStorage.getItem(KEY)==="1"; }catch(e){}
const NA=window.Audio;
// ---- "Audio loading…" indicator: shown from TTS request until playback actually starts; one request token owns it ----
const AUDIO_TIMEOUT_MS=8000; let tok=0, cur=0, tmr=null, hideT=null, el=null;
function ui(){ if(el||!document.body) return el; const st=document.createElement("style"); st.textContent=`
#audio-status{position:fixed;z-index:60;pointer-events:none;display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:999px;font-size:12px;line-height:18px;color:#e2e8f0;background:rgba(15,18,30,.82);border:1px solid rgba(129,140,248,.45);backdrop-filter:blur(8px);box-shadow:0 4px 16px rgba(0,0,0,.35)}
#audio-status[hidden]{display:none}#audio-status .as-spin{width:10px;height:10px;border-radius:50%;border:2px solid rgba(165,180,252,.3);border-top-color:#a5b4fc;animation:asspin .8s linear infinite}
#audio-status .as-dot{width:8px;height:8px;border-radius:50%;background:#fbbf24}@keyframes asspin{to{transform:rotate(360deg)}}`; document.head.appendChild(st);
  el=document.createElement("div"); el.id="audio-status"; el.setAttribute("role","status"); el.setAttribute("aria-live","polite"); el.hidden=true; document.body.appendChild(el); return el; }
const MSG={loading:'<span class="as-spin"></span><span>Audio loading…</span>',fail:'<span class="as-dot"></span><span>Audio unavailable — continuing</span>',gesture:'<span class="as-dot"></span><span>Tap anywhere to enable sound</span>'};
function show(kind){ const e=ui(); if(!e) return; clearTimeout(hideT); e.dataset.kind=kind; e.innerHTML=MSG[kind]; e.hidden=false; place(); }
function hide(){ clearTimeout(hideT); if(el){ el.hidden=true; el.dataset.kind=""; } }
function place(){ if(!el||el.hidden) return; const vis=x=>x&&x.offsetParent!==null&&!x.classList.contains("hidden"); let a=null;
  for(const q of ["#transcript","#play","#sumplay","[data-abtn=mute]","#vorb"]){ const x=document.querySelector(q); if(vis(x)){ a=x; break; } }
  let L=16, T=innerHeight-48; if(a){ const r=a.getBoundingClientRect(); L=r.left; T=r.top-el.offsetHeight-6; if(T<4) T=r.bottom+6; }
  el.style.left=Math.max(4,Math.min(L,innerWidth-el.offsetWidth-4))+"px"; el.style.top=Math.max(4,Math.min(T,innerHeight-el.offsetHeight-4))+"px"; }
function loadStart(){ const t=++tok; cur=t; clearTimeout(tmr); show("loading"); tmr=setTimeout(()=>loadFail(t,true),AUDIO_TIMEOUT_MS); return t; }
function loadDone(t){ if(t!=null&&t!==cur) return; cur=0; clearTimeout(tmr); hide(); }          /* playback started (or caller finished) */
function loadCancel(keepNotice){ cur=0; clearTimeout(tmr); if(!keepNotice||!el||el.dataset.kind==="loading") hide(); }   /* stop / pause / tour advanced */
function loadFail(t,timedOut){ if(t!==cur) return; cur=0; clearTimeout(tmr);
  if(timedOut) ctrls.forEach(c=>{ if(c.__t===t){ try{c.abort();}catch(e){} } });                 /* drop the slow clip so it can't start mid-caption */
  window.AudioMgr&&(AudioMgr.failedAt=Date.now());                                                /* tour goes caption-only for a while */
  show("fail"); hideT=setTimeout(hide,3000); }
function started(a){ if(a&&a.__unlock) return; window.AudioMgr&&(AudioMgr.failedAt=0); loadDone(); }
setInterval(()=>{ place(); if(cur&&[...all,...document.querySelectorAll("audio")].some(a=>!a.__unlock&&!a.paused&&a.currentTime>0)) loadDone(); },200);
function A(src){ const a=new NA(src); all.add(a); return a; } A.prototype=NA.prototype; window.Audio=A;
const play=HTMLMediaElement.prototype.play;
HTMLMediaElement.prototype.play=function(){
  if(this.tagName==="VIDEO") return play.call(this);
  if(this.__unlock||this.volume===0) return play.call(this);   /* silent unlock blips never queue */
  all.add(this);
  if(!this.__as){ this.__as=1; const a=this, on=()=>started(a);              /* hook BEFORE play so an instant 'playing' isn't missed */
    a.addEventListener("playing",on); a.addEventListener("timeupdate",()=>{ if(a.currentTime>0&&!a.paused) on(); });
    ["ended","pause","error"].forEach(ev=>a.addEventListener(ev,()=>setTimeout(pump,0))); }
  if(muted){ try{this.pause();}catch(e){} loadCancel(); setTimeout(()=>this.dispatchEvent(new Event("ended")),0); return Promise.resolve(); }
  const a=this; if(!a.paused&&a.currentTime>0){ started(a); return Promise.resolve(); }
  if(!busy(a)&&!queue.length) return start(a);
  /* never two at once, and never cut: wait in line until the current clip ENDS (only stopAll interrupts) */
  loadDone(); const ep=epoch; return new Promise((res,rej)=>{ queue.push({a,ep,res,rej}); pump(); }); };
function start(a){ return play.call(a).then(v=>{ started(a); return v; },e=>{ if(e&&e.name==="NotAllowedError"&&!(window.AudioMgr&&AudioMgr.unlocked)){ cur=0; clearTimeout(tmr); show("gesture"); } else if(cur) loadFail(cur); setTimeout(pump,0); throw e; }); }
function busyEl(o){ return !o.__unlock&&!o.paused&&!o.ended&&!(o.duration&&o.currentTime>=o.duration-0.05); }
function busy(except){ return [...all].some(o=>o!==except&&busyEl(o)) || ("speechSynthesis" in window && speechSynthesis.speaking) || !!speechWait; }
let epoch=0, speechWait=null; const queue=[];
function pump(){ while(queue.length&&queue[0].ep!==epoch){ const it=queue.shift(); try{ it.a.dispatchEvent(new Event("ended")); }catch(e){} it.res(); }   /* stale clip from an earlier run: never plays */
  if(!queue.length||busy(queue[0].a)) return; const it=queue.shift(); start(it.a).then(it.res,it.rej); }
setInterval(pump,250);
const of=window.fetch;
window.fetch=function(u,o){ const url=String(u&&u.url||u);
  if(/\/api\/tts/.test(url)){ if(muted) return Promise.resolve(new Response("muted",{status:204}));
    const h=o&&o.headers, pre=!!(h&&(h["X-Prefetch"]||(h.get&&h.get("X-Prefetch"))));          /* prefetch: silent, no indicator/timeout */
    const c=new AbortController(); ctrls.add(c); o=Object.assign({},o||{},{signal:c.signal});
    if(pre) return of.call(this,u,o).finally(()=>ctrls.delete(c));
    const t=loadStart(); c.__t=t;
    return of.call(this,u,o).then(r=>{ if(!r.ok||r.status===204) setTimeout(()=>loadFail(t),1500); return r; },   /* grace: caller may fall back to browser voice */
      e=>{ loadFail(t); throw e; }).finally(()=>ctrls.delete(c)); }
  return of.apply(this,arguments); };
if("speechSynthesis" in window){ const sp=speechSynthesis.speak.bind(speechSynthesis);
  const say=u=>{ if(muted){ loadCancel(); setTimeout(()=>u.onend&&u.onend(),0); return; } try{ u.addEventListener("start",()=>loadDone()); }catch(e){} sp(u); };
  speechSynthesis.speak=u=>{ if(![...all].some(busyEl)) return say(u);                       /* browser voice also waits its turn */
    const ep=epoch; loadDone(); const w=setInterval(()=>{ if(ep!==epoch){ clearInterval(w); speechWait=null; setTimeout(()=>u.onend&&u.onend(),0); return; }
      if(![...all].some(busyEl)){ clearInterval(w); speechWait=null; say(u); } },150); speechWait=w; }; }
function stopAll(fromVoice){ if(!fromVoice) window.AudioMgr&&(AudioMgr.gen=(AudioMgr.gen||0)+1);
  epoch++; window.AudioMgr&&(AudioMgr.epoch=epoch); pump();                                      /* deliberate stop: drop queued clips */
  all.forEach(a=>{ try{ a.pause(); a.currentTime=0; a.dispatchEvent(new Event("ended")); }catch(e){} });
  document.querySelectorAll("audio").forEach(a=>{ try{a.pause();a.currentTime=0;}catch(e){} });
  loadCancel(); ctrls.forEach(c=>{ try{c.abort();}catch(e){} }); ctrls.clear();
  try{ speechSynthesis.cancel(); }catch(e){}
  window.__ttsLevel=0; try{ window.Docs3D&&Docs3D.pulse(0); }catch(e){}
  if(!fromVoice) try{ const V=window.PrecedentVoice; if(V&&/speaking|cooldown|thinking/.test(V.state())) V.stop(); }catch(e){}
}
function setMuted(m){ muted=!!m; try{ localStorage.setItem(KEY,muted?"1":"0"); localStorage.setItem("mapVoice",muted?"0":"1"); }catch(e){}
  if(window.Docs3D) Docs3D.voice=!muted; if(muted) stopAll(); document.dispatchEvent(new CustomEvent("precedent:mute",{detail:muted})); }
function playing(){ return [...all].some(a=>!a.paused&&!a.ended) || ("speechSynthesis" in window && speechSynthesis.speaking); }
addEventListener("keydown",e=>{ if(e.key==="Escape"){ try{ window.Docs3D&&Docs3D.stopTour&&Docs3D.stopTour(); }catch(_){} stopAll(); } });
// One user gesture (any click, tap or key anywhere) unlocks audio for the rest of the visit.
const SILENT="data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=";
function unlock(){ const M=window.AudioMgr; if(!M||M.unlocked) return; M.unlocked=true;
  try{ const C=window.AudioContext||window.webkitAudioContext; if(C){ const c=M.ctx||(M.ctx=new C()); c.resume&&c.resume(); const n=c.createBufferSource(); n.buffer=c.createBuffer(1,1,22050); n.connect(c.destination); n.start(0); } }catch(e){}
  try{ const a=new NA(SILENT); a.__unlock=true; a.volume=0; const p=play.call(a); p&&p.catch&&p.catch(()=>{}); }catch(e){}
  if(el&&el.dataset.kind==="gesture") hide();
  ["pointerdown","touchstart","keydown","click"].forEach(ev=>removeEventListener(ev,unlock,true)); }
["pointerdown","touchstart","keydown","click"].forEach(ev=>addEventListener(ev,unlock,{capture:true,passive:true}));
window.AudioMgr={stopAll,setMuted,isMuted:()=>muted,playing,instances:()=>[...all],unlocked:false,loadStart,loadDone,loadCancel,loadFail,epoch:0,busy:()=>busy()};
})();

// ---- Icons + button states (Lucide-style inline SVG) ----
(function(){
const P={
 "volume-2":'<path d="M11 4.7 6 9H3v6h3l5 4.3z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/>',
 "volume-x":'<path d="M11 4.7 6 9H3v6h3l5 4.3z"/><line x1="22" y1="9" x2="16" y2="15"/><line x1="16" y1="9" x2="22" y2="15"/>',
 "square":'<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/>',
 "loader":'<path d="M21 12a9 9 0 1 1-6.2-8.6"/>',
 "mic":'<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M19 10v1a7 7 0 0 1-14 0v-1"/><line x1="12" y1="18" x2="12" y2="22"/>',
 "mic-off":'<line x1="2" y1="2" x2="22" y2="22"/><path d="M18.9 13.4A7 7 0 0 0 19 11v-1"/><path d="M5 10v1a7 7 0 0 0 11.9 5"/><path d="M15 9.3V5a3 3 0 0 0-5.7-1.3"/><path d="M9 9v2a3 3 0 0 0 5.1 2.1"/><line x1="12" y1="18" x2="12" y2="22"/>',
 "pause":'<rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor"/>',
 "rotate":'<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
 "brain":'<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>'};
window.ICON=(n,sz)=>`<svg xmlns="http://www.w3.org/2000/svg" width="${sz||20}" height="${sz||20}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="${n==="loader"?"ab-spin":""}" aria-hidden="true">${P[n]||""}</svg>`;
const css=document.createElement("style"); css.textContent=`
.abtn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-width:36px;height:36px;padding:0 8px;border-radius:999px;border:1px solid rgba(129,140,248,.45);background:rgba(15,23,42,.75);color:#e2e8f0;cursor:pointer;transition:background .15s,transform .1s,box-shadow .2s;position:relative}
.abtn:hover{background:rgba(79,70,229,.55)} .abtn:active{transform:scale(.94)} .abtn:focus-visible{outline:2px solid #a5b4fc;outline-offset:2px}
.abtn.ab-on{background:rgba(16,185,129,.22);border-color:rgba(52,211,153,.7);box-shadow:0 0 0 0 rgba(52,211,153,.6);animation:abpulse 1.4s infinite}
.abtn.ab-muted{color:#94a3b8}
@keyframes abpulse{0%{box-shadow:0 0 0 0 rgba(52,211,153,.55)}70%{box-shadow:0 0 0 9px rgba(52,211,153,0)}100%{box-shadow:0 0 0 0 rgba(52,211,153,0)}}
.ab-spin{animation:abspin 1s linear infinite}@keyframes abspin{to{transform:rotate(360deg)}}
.ab-wave{display:inline-flex;gap:2px;align-items:end;height:14px}.ab-wave i{width:3px;background:#6ee7b7;border-radius:2px;animation:abw .9s ease-in-out infinite}.ab-wave i:nth-child(2){animation-delay:.15s}.ab-wave i:nth-child(3){animation-delay:.3s}
@keyframes abw{0%,100%{height:4px}50%{height:14px}}`;
document.head.appendChild(css);
const M=window.AudioMgr, wave='<span class="ab-wave"><i></i><i></i><i></i></span>';
function paint(){ const pl=M.playing(), mu=M.isMuted();
  document.querySelectorAll("[data-abtn]").forEach(b=>{ const k=b.dataset.abtn, lbl=b.dataset.label||""; let ic, tip, on=false;
    if(k==="mute"){ ic=mu?"volume-x":"volume-2"; tip=mu?"Unmute voice":"Mute voice (Esc stops audio)"; on=pl&&!mu; b.classList.toggle("ab-muted",mu); }
    else { if(b.dataset.loading==="1"){ ic="loader"; tip="Loading audio…"; } else if(pl&&b.dataset.owner==="1"){ ic="square"; tip="Stop audio"; on=true; } else { ic="volume-2"; tip=b.dataset.tip||"Play audio"; } }
    const html=ICON(ic)+(on&&k!=="mute"?wave:"")+(lbl&&!on?`<span class="text-sm">${lbl}</span>`:on&&k!=="mute"?'<span class="text-sm">Stop</span>':"");
    if(b._h!==html){ b.innerHTML=html; b._h=html; } b.title=tip; b.setAttribute("aria-label",tip); b.classList.toggle("ab-on",on);
    if(!pl&&b.dataset.owner==="1") b.dataset.owner="0"; }); }
M.paint=paint; setInterval(paint,200);
// Fallback speak: cached ElevenLabs via /api/tts_ts, else browser voice. Returns a promise that resolves when done.
M.say=function(text,btn,opt){ if(!text||M.isMuted()) return Promise.resolve(); const Q=opt&&opt.queue; if(!Q) M.stopAll(true); const ep=M.epoch;   /* queue:true = auto narration, waits its turn */
  const D=window.Docs3D; if(D){ D.holdVoice=true; D.stopTour&&D.stopTour(Q); } M.saying=true; if(btn){ btn.dataset.loading="1"; btn.dataset.owner="1"; paint(); }
  const done=()=>{ if(btn){ btn.dataset.loading="0"; paint(); } };
  return fetch("/api/tts_ts",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({text:text.slice(0,400)})})
   .then(r=>r.ok&&r.status!==204?r.json():null).then(j=>{ done(); if(btn) btn.dataset.owner="1"; if(M.epoch!==ep) return;   /* stopped / new question meanwhile: stale clip never plays */
     if(j&&j.audio_b64){ const s=atob(j.audio_b64),u=new Uint8Array(s.length); for(let k=0;k<s.length;k++) u[k]=s.charCodeAt(k);
       const a=new Audio(URL.createObjectURL(new Blob([u],{type:"audio/mpeg"}))); return new Promise(res=>{ a.onended=res; a.onerror=res; a.play().catch(res); }); }
     if("speechSynthesis" in window&&!M.isMuted()) return new Promise(res=>{ const u=new SpeechSynthesisUtterance(text); u.onend=res; u.onerror=res; speechSynthesis.speak(u); }); })
   .catch(()=>done()).finally(()=>{ done(); M.saying=false; if(window.Docs3D) Docs3D.holdVoice=false; if(btn) btn.dataset.owner="0"; }); };
})();
