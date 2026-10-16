// Global audio manager: every Audio/TTS/speech goes through here so mute & stop always work.
(function(){
const KEY="precedent.mute", all=new Set(), ctrls=new Set();
let muted=false; try{ muted=localStorage.getItem(KEY)==="1"; }catch(e){}
const NA=window.Audio;
function A(src){ const a=new NA(src); all.add(a); return a; } A.prototype=NA.prototype; window.Audio=A;
const play=HTMLMediaElement.prototype.play;
HTMLMediaElement.prototype.play=function(){
  if(this.tagName==="VIDEO") return play.call(this);
  all.add(this);
  try{ speechSynthesis.cancel(); }catch(e){}   /* one source: element audio cancels browser speech */
  all.forEach(o=>{ if(o!==this&&!o.paused){ try{ o.pause(); o.dispatchEvent(new Event("ended")); }catch(e){} } });   /* never two at once */
  if(muted){ try{this.pause();}catch(e){} setTimeout(()=>this.dispatchEvent(new Event("ended")),0); return Promise.resolve(); }
  return play.call(this); };
const of=window.fetch;
window.fetch=function(u,o){ const url=String(u&&u.url||u);
  if(/\/api\/tts/.test(url)){ if(muted) return Promise.resolve(new Response("muted",{status:204}));
    const c=new AbortController(); ctrls.add(c); o=Object.assign({},o||{},{signal:c.signal});
    return of.call(this,u,o).finally(()=>ctrls.delete(c)); }
  return of.apply(this,arguments); };
if("speechSynthesis" in window){ const sp=speechSynthesis.speak.bind(speechSynthesis);
  speechSynthesis.speak=u=>{ all.forEach(o=>{ if(!o.paused){ try{ o.pause(); o.dispatchEvent(new Event("ended")); }catch(e){} } }); if(muted){ setTimeout(()=>u.onend&&u.onend(),0); return; } sp(u); }; }
function stopAll(fromVoice){ if(!fromVoice) window.AudioMgr&&(AudioMgr.gen=(AudioMgr.gen||0)+1);
  all.forEach(a=>{ try{ a.pause(); a.currentTime=0; a.dispatchEvent(new Event("ended")); }catch(e){} });
  document.querySelectorAll("audio").forEach(a=>{ try{a.pause();a.currentTime=0;}catch(e){} });
  ctrls.forEach(c=>{ try{c.abort();}catch(e){} }); ctrls.clear();
  try{ speechSynthesis.cancel(); }catch(e){}
  window.__ttsLevel=0; try{ window.Docs3D&&Docs3D.pulse(0); }catch(e){}
  if(!fromVoice) try{ const V=window.PrecedentVoice; if(V&&/speaking|cooldown|thinking/.test(V.state())) V.stop(); }catch(e){}
}
function setMuted(m){ muted=!!m; try{ localStorage.setItem(KEY,muted?"1":"0"); localStorage.setItem("mapVoice",muted?"0":"1"); }catch(e){}
  if(window.Docs3D) Docs3D.voice=!muted; if(muted) stopAll(); document.dispatchEvent(new CustomEvent("precedent:mute",{detail:muted})); }
function playing(){ return [...all].some(a=>!a.paused&&!a.ended) || ("speechSynthesis" in window && speechSynthesis.speaking); }
addEventListener("keydown",e=>{ if(e.key==="Escape"){ try{ window.Docs3D&&Docs3D.stopTour&&Docs3D.stopTour(); }catch(_){} stopAll(); } });
window.AudioMgr={stopAll,setMuted,isMuted:()=>muted,playing,instances:()=>[...all]};
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
M.say=function(text,btn){ if(!text||M.isMuted()) return Promise.resolve(); M.stopAll(true); const D=window.Docs3D; if(D){ D.holdVoice=true; D.stopTour&&D.stopTour(); } M.saying=true; if(btn){ btn.dataset.loading="1"; btn.dataset.owner="1"; paint(); }
  const done=()=>{ if(btn){ btn.dataset.loading="0"; paint(); } };
  return fetch("/api/tts_ts",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({text:text.slice(0,400)})})
   .then(r=>r.ok&&r.status!==204?r.json():null).then(j=>{ done(); if(btn) btn.dataset.owner="1";
     if(j&&j.audio_b64){ const s=atob(j.audio_b64),u=new Uint8Array(s.length); for(let k=0;k<s.length;k++) u[k]=s.charCodeAt(k);
       const a=new Audio(URL.createObjectURL(new Blob([u],{type:"audio/mpeg"}))); return new Promise(res=>{ a.onended=res; a.onerror=res; a.play().catch(res); }); }
     if("speechSynthesis" in window&&!M.isMuted()) return new Promise(res=>{ const u=new SpeechSynthesisUtterance(text); u.onend=res; u.onerror=res; speechSynthesis.speak(u); }); })
   .catch(()=>done()).finally(()=>{ done(); M.saying=false; if(window.Docs3D) Docs3D.holdVoice=false; if(btn) btn.dataset.owner="0"; }); };
})();
