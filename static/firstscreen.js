// firstscreen.js: first-visit cues on the demo page (Start here line, numbered steps, gentle pulse on Ask,
// labeled mic). Everything is dismissible; dismissal is remembered in localStorage.
(function(){
  'use strict';
  var KEY='precedent.firstScreenDismissed';
  var $=function(id){return document.getElementById(id);};
  function seen(){ try{ return localStorage.getItem(KEY)==='1'; }catch(e){ return false; } }
  function hideCue(){ var c=$('firststep'); if(c) c.hidden=true; var g=$('go'); if(g) g.classList.remove('pulse-cue','first-visit'); }
  function dismiss(){ try{ localStorage.setItem(KEY,'1'); }catch(e){} hideCue(); }
  function labelMic(){
    var orb=$('vorb'); if(!orb){ return false; }
    orb.setAttribute('aria-label','Ask by voice: tap to talk');
    orb.title='Ask by voice: tap, then speak your question (or hold Space)';
    if(!$('vorb-label')){ var l=document.createElement('span'); l.id='vorb-label'; l.setAttribute('aria-hidden','true'); l.textContent='Ask by voice'; document.body.appendChild(l); }
    return true;
  }
  function labelTour(){
    document.querySelectorAll('[data-tourctl]').forEach(function(b){
      var a=b.getAttribute('aria-label'); if(!a){ a=(b.textContent||'').trim()||'Map control'; b.setAttribute('aria-label',a); }
      if(!b.title) b.title=a;
    });
  }
  function init(){
    if(seen()) hideCue();
    else { var g=$('go'); if(g) g.classList.add('pulse-cue','first-visit'); }
    var x=$('firststep-dismiss'); if(x) x.addEventListener('click',dismiss);
    var go=$('go'); if(go) go.addEventListener('click',function(){ go.classList.remove('pulse-cue','first-visit'); });
    var q=$('q'); if(q) q.addEventListener('keydown',function(e){ if(e.key==='Enter'&&go) go.classList.remove('pulse-cue','first-visit'); });
    var tries=0; (function mic(){ if(!labelMic()&&tries++<40) setTimeout(mic,250); })();
    labelTour(); new MutationObserver(labelTour).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['aria-label']});
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init); else init();
})();
