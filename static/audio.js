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
  if(muted){ try{this.pause();}catch(e){} setTimeout(()=>this.dispatchEvent(new Event("ended")),0); return Promise.resolve(); }
  return play.call(this); };
const of=window.fetch;
window.fetch=function(u,o){ const url=String(u&&u.url||u);
  if(/\/api\/tts/.test(url)){ if(muted) return Promise.resolve(new Response("muted",{status:204}));
    const c=new AbortController(); ctrls.add(c); o=Object.assign({},o||{},{signal:c.signal});
    return of.call(this,u,o).finally(()=>ctrls.delete(c)); }
  return of.apply(this,arguments); };
if("speechSynthesis" in window){ const sp=speechSynthesis.speak.bind(speechSynthesis);
  speechSynthesis.speak=u=>{ if(muted){ setTimeout(()=>u.onend&&u.onend(),0); return; } sp(u); }; }
function stopAll(fromVoice){
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
addEventListener("keydown",e=>{ if(e.key==="Escape") stopAll(); });
window.AudioMgr={stopAll,setMuted,isMuted:()=>muted,playing,instances:()=>[...all]};
})();
