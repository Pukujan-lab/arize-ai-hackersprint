// Siri-like voice loop: tap orb -> listen (live caption) -> 1.2s silence -> ask -> speak -> 3s cooldown -> listen again.
(()=>{
const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
const orb=document.createElement("div");
orb.innerHTML=`<div id="vcap" class="hidden fixed bottom-32 right-8 max-w-sm glass rounded-2xl px-4 py-3 text-sm text-slate-100 shadow-2xl z-50"></div>
<button id="vorb" aria-label="Tap to talk" title="Tap to talk (or hold Space)" class="fixed bottom-8 right-8 w-20 h-20 rounded-full z-50 flex items-center justify-center shadow-[0_0_40px_rgba(99,102,241,.6)] transition-all"
 style="background:radial-gradient(circle at 35% 30%,#a5b4fc,#6366f1 45%,#312e81)"><canvas id="vwave" width="80" height="80" class="absolute inset-0 rounded-full pointer-events-none"></canvas><span id="vicon" class="relative text-white"></span></button>
<div id="vstate" class="fixed bottom-2 right-8 w-20 text-center text-[10px] uppercase tracking-widest text-slate-400 z-50">tap to talk</div>`;
document.body.appendChild(orb); setTimeout(()=>{ try{ document.getElementById("vicon").innerHTML=window.ICON?window.ICON("mic",30):""; }catch(e){} },0);
const $=id=>document.getElementById(id), cap=$("vcap"), btn=$("vorb"), st=$("vstate"), cv=$("vwave"), g=cv.getContext("2d");
let gen=0, state="idle", conv=false, rec=null, finalTxt="", interim="", silenceT=null, micStream=null, an=null, buf=null, resubmits=0, wake=false, ptt=false, cooldownUntil=0;
const ICON={paused:"⏸",idle:"🎙",listening:"👂",thinking:"💭",speaking:"🔊",cooldown:"⏳",wake:"✨"};
const LBL={idle:"Tap to talk",listening:"Listening… tap to pause",paused:"Paused, tap to resume",thinking:"Thinking… tap to stop",speaking:"Speaking… tap to stop",cooldown:"tap to pause"};
function setState(s,msg){ state=s; $("vicon").innerHTML=window.ICON?window.ICON(s==="listening"?"mic":s==="paused"?"mic-off":s==="thinking"?"loader":s==="speaking"?"volume-2":"mic",30):""; st.textContent=(s==="listening"?"Listening… tap to pause":s==="paused"?"Paused, tap to resume":msg||s); btn.title=LBL[s]||"Tap to talk"; btn.setAttribute("aria-label",btn.title); btn.setAttribute("aria-pressed",String(s!=="idle"&&s!=="paused")); btn.style.background=s==="paused"?"radial-gradient(circle at 35% 30%,#cbd5e1,#64748b 45%,#1e293b)":s==="listening"?"radial-gradient(circle at 35% 30%,#fca5a5,#ef4444 45%,#7f1d1d)":"radial-gradient(circle at 35% 30%,#a5b4fc,#6366f1 45%,#312e81)"; btn.style.transform=s==="listening"?"scale(1.08)":s==="thinking"?"scale(.95)":"scale(1)"; }
function caption(t,dim){ if(!t){cap.classList.add("hidden");return} cap.classList.remove("hidden"); cap.innerHTML=dim?`<span class="text-slate-400">${t}</span>`:t; }
async function ensureMic(){ if(an) return true; try{ micStream=await navigator.mediaDevices.getUserMedia({audio:true}); const ac=new (window.AudioContext||window.webkitAudioContext)();
  an=ac.createAnalyser(); an.fftSize=512; ac.createMediaStreamSource(micStream).connect(an); buf=new Uint8Array(an.fftSize); return true; }catch(e){ caption("🎙 Microphone blocked — allow mic access in the browser (lock icon → Microphone)."); setState("idle","mic blocked"); return false; } }
(function draw(){ requestAnimationFrame(draw); g.clearRect(0,0,80,80); const t=performance.now()/1000;
  let lvl=0; if(an&&state==="listening"){ an.getByteTimeDomainData(buf); let s=0; for(const v of buf){ const d=(v-128)/128; s+=d*d; } lvl=Math.min(1,Math.sqrt(s/buf.length)*5); }
  if(state==="speaking") lvl=window.__ttsLevel||0.3*(1+Math.sin(t*8))/2;
  g.strokeStyle=state==="thinking"?"rgba(250,204,21,.9)":state==="speaking"?"rgba(52,211,153,.95)":"rgba(255,255,255,.85)"; g.lineWidth=2;
  if(state==="thinking"){ g.beginPath(); g.arc(40,40,34,t*4,t*4+Math.PI*1.2); g.stroke(); return; }
  if(state==="idle"&&!wake) return;
  g.beginPath(); for(let i=0;i<=64;i++){ const a=i/64*Math.PI*2, r=30+Math.sin(a*6+t*6)*(2+lvl*9)*(state==="idle"?0.3:1); const x=40+Math.cos(a)*r, y=40+Math.sin(a)*r; i?g.lineTo(x,y):g.moveTo(x,y); } g.stroke(); })();
function startRec(){ if(!SR) return fallbackRecord(); if(rec) try{rec.abort()}catch(e){}
  rec=new SR(); rec.continuous=true; rec.interimResults=true; rec.lang="en-US"; finalTxt=""; interim="";
  rec.onresult=e=>{ interim=""; for(let i=e.resultIndex;i<e.results.length;i++){ const r=e.results[i]; if(r.isFinal) finalTxt+=r[0].transcript+" "; else interim+=r[0].transcript; }
    let text=(finalTxt+interim).trim();
    if(wake){ const m=text.toLowerCase().match(/hey,? precedent[,.]?\s*(.*)/); if(!m){ return; } text=m[1]; if(!text){ caption("✨ Yes? I'm listening…"); return; } }
    caption(text||"…",!finalTxt); clearTimeout(silenceT); if(!ptt) silenceT=setTimeout(()=>submit(text),1200); };
  rec.onerror=e=>{ if(e.error==="no-speech") return; if(e.error==="not-allowed"||e.error==="service-not-allowed"){ caption("🎙 Microphone permission denied."); stop(); return; }
    if(e.error==="network"){ caption("Speech service unavailable — recording instead…",true); rec=null; fallbackRecord(); } };
  rec.onend=()=>{ if(conv&&(state==="listening")&&rec) try{ rec.start(); }catch(e){} };
  try{ rec.start(); }catch(e){} setState(wake?"listening":"listening", wake?"say “Hey Precedent”":"listening"); }
function pauseRec(){ clearTimeout(silenceT); if(rec){ const r=rec; rec=null; try{r.abort()}catch(e){} } }
// MediaRecorder fallback -> server /api/stt (ElevenLabs scribe_v1, capped)
let mr=null;
async function fallbackRecord(){ if(!(await ensureMic())) return; if(mr&&mr.state==="recording") return; const chunks=[]; mr=new MediaRecorder(micStream);
  mr.ondataavailable=e=>chunks.push(e.data); setState("listening","recording"); caption("Recording… (stops after 1.2s silence)",true);
  const myGen=gen; mr.onstop=async()=>{ if(myGen!==gen) return; setState("thinking","transcribing"); const fd=new FormData(); fd.append("file",new Blob(chunks,{type:"audio/webm"}),"q.webm");
    const r=await fetch("/api/stt",{method:"POST",body:fd}); const d=await r.json().catch(()=>({})); if(d.text) submit(d.text); else { caption("Couldn't transcribe: "+(d.error||"")); if(conv) setTimeout(listen,3000); } };
  mr.start(); let quiet=0; const iv=setInterval(()=>{ an.getByteTimeDomainData(buf); let s=0; for(const v of buf){const d=(v-128)/128;s+=d*d} const lvl=Math.sqrt(s/buf.length);
    quiet=lvl<0.02?quiet+100:0; if(quiet>1200||!conv&&!ptt){ clearInterval(iv); if(mr.state==="recording") mr.stop(); } },100); setTimeout(()=>{ clearInterval(iv); if(mr.state==="recording") mr.stop(); },15000); }
// Voice asks must ALWAYS be spoken: clear global mute + unlock autoplay using the tap gesture.
let unlockCtx=null;
function forceAudio(){ try{ if(window.AudioMgr&&AudioMgr.isMuted()) AudioMgr.setMuted(false); }catch(e){} try{ localStorage.setItem("precedent.mute.v2","0"); localStorage.setItem("mapVoice","1"); }catch(e){}
  try{ if(window.Docs3D){ Docs3D.voice=true; } }catch(e){}
  try{ unlockCtx=unlockCtx||new (window.AudioContext||window.webkitAudioContext)(); if(unlockCtx.state==="suspended") unlockCtx.resume(); const b=unlockCtx.createBuffer(1,1,22050),n=unlockCtx.createBufferSource(); n.buffer=b; n.connect(unlockCtx.destination); n.start(0); }catch(e){}
  try{ const a=new Audio("data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA="); a.volume=0; const p=a.play(); p&&p.catch&&p.catch(()=>{}); }catch(e){} }
async function submit(text){ const myGen=gen; clearTimeout(silenceT); text=(text||"").trim(); pauseRec();
  if(text.split(/\s+/).length<3){ caption(`“${text}” — too short, ask a full question.`,true); if(conv) return setTimeout(listen,800); return setState("idle","tap to talk"); }
  setState("thinking","thinking"); caption("“"+text+"”");
  const res=await window.PRECEDENT.ask(text); if(myGen!==gen) return;
  if(!res){ if(resubmits<1){ resubmits++; caption("Busy — retrying once…",true); await new Promise(r=>setTimeout(r,3000)); return submit(text); } resubmits=0; caption("Server busy — try again in a moment."); return conv?setTimeout(listen,3000):setState("idle"); }
  resubmits=0; setState("speaking","speaking"); forceAudio(); await window.PRECEDENT.speak(); if(myGen!==gen) return;
  cooldownUntil=Date.now()+3000; setState("cooldown","cooldown"); caption("");
  setTimeout(()=>{ if(myGen!==gen) return; if(conv) listen(); else setState("idle","tap to talk"); },3000); }
async function listen(){ const myGen=gen; if(Date.now()<cooldownUntil) return setTimeout(()=>{ if(myGen===gen) listen(); },cooldownUntil-Date.now()); if(!(await ensureMic())) return; startRec(); }
function stop(paused){ gen++; conv=false; wake=false; ptt=false; pauseRec(); if(mr&&mr.state==="recording") try{mr.stop()}catch(e){} try{ window.AudioMgr&&AudioMgr.stopAll(true); }catch(e){} setState(paused?"paused":"idle","tap to talk"); caption(""); }
btn.onclick=()=>{ if(state!=="idle"&&state!=="paused") return stop(true); forceAudio(); conv=true; wake=false; listen(); };
btn.oncontextmenu=e=>{ e.preventDefault(); forceAudio(); if(conv) stop(); conv=true; wake=true; listen(); caption("✨ Wake mode: say “Hey Precedent, …”",true); };
// Space = push-to-talk (when not typing)
addEventListener("keydown",e=>{ if(e.code!=="Space"||e.repeat||/INPUT|TEXTAREA/.test(document.activeElement.tagName)) return; e.preventDefault(); if(state==="thinking"||state==="speaking") return; forceAudio(); ptt=true; listen(); });
addEventListener("keyup",e=>{ if(e.code!=="Space"||!ptt||/INPUT|TEXTAREA/.test(document.activeElement.tagName)) return; e.preventDefault(); ptt=false; const t=(finalTxt+interim).trim(); if(mr&&mr.state==="recording") mr.stop(); else submit(t); });
window.PrecedentVoice={submit,stop,forceAudio,state:()=>state};
})();
