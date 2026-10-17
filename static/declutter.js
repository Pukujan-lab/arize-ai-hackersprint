// declutter.js — homepage only. The panels stay where the page puts them: the memo and its sources in the main
// column, live agent activity in the column beside it. The sidebar (#sidebar, built by navbar.js) holds nothing
// but navigation, so this file only adds two touches: an activity list that follows the newest line, and a nudge
// on the Menu button when events arrive while the sidebar is closed.
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  // Thin scrollbar + room for the agent lines inside the capped activity list.
  function listStyle() {
    if (document.getElementById('home-list-style')) return;
    const st = document.createElement('style');
    st.id = 'home-list-style';
    st.textContent =
      '#events{scrollbar-width:thin;scrollbar-color:#334155 transparent}' +
      '#events::-webkit-scrollbar{width:6px}#events::-webkit-scrollbar-track{background:transparent}' +
      '#events::-webkit-scrollbar-thumb{background:#334155;border-radius:3px}#events::-webkit-scrollbar-thumb:hover{background:#475569}' +
      '#events>*{scroll-margin-top:8px;padding:6px 8px!important;margin:0!important;overflow-wrap:anywhere;word-break:break-word;min-width:0}';
    document.head.appendChild(st);
  }

  // Follow the newest event, but stop the moment the visitor scrolls up to read something.
  function autoscroll() {
    const events = $('events');
    if (!events) return;
    const isNear = () => events.scrollHeight - events.scrollTop - events.clientHeight < 50;
    let wasNearBottom = true;
    new MutationObserver(() => {
      if (wasNearBottom || isNear()) events.scrollTop = events.scrollHeight;
      wasNearBottom = isNear();
    }).observe(events, { childList: true });
    events.addEventListener('scroll', () => {
      wasNearBottom = isNear();
    });
  }

  // Dot on the Menu button while activity arrives that you cannot see, cleared when the sidebar is open again.
  function activityDot() {
    let tries = 0;
    (function wait() {
      const dot = $('sideDot');
      if (!dot) {
        if (tries++ < 40) setTimeout(wait, 120);
        return;
      }
      const events = $('events');
      if (!events) return;
      const hidden = () => !document.documentElement.classList.contains('side-shown');
      new MutationObserver(() => {
        if (hidden()) dot.hidden = false;
      }).observe(events, { childList: true });
      document.documentElement.addEventListener('transitionend', () => {
        if (!hidden()) dot.hidden = true;
      });
    })();
  }

  function init() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
      return;
    }
    document.documentElement.style.fontSize = '16px';
    listStyle();
    autoscroll();
    activityDot();
  }

  init();
})();
