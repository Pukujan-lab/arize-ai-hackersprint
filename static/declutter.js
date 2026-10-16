// declutter.js — restructure Precedent homepage at runtime
// Moves secondary panels into a collapsible left sidebar, widens main content

(function() {
  'use strict';

  const $ = id => document.getElementById(id);
  const $$ = sel => document.querySelector(sel);
  const $$$ = sel => document.querySelectorAll(sel);

  // LocalStorage keys
  const STORAGE_SIDEBAR = 'precedent.side';
  const STORAGE_ACCORDIONS = 'precedent.acc';

  // Read accordion state from localStorage
  function getAccordionState() {
    try {
      const stored = localStorage.getItem(STORAGE_ACCORDIONS);
      return stored ? JSON.parse(stored) : {};
    } catch {
      return {};
    }
  }

  // Save accordion state to localStorage
  function setAccordionState(key, open) {
    try {
      const state = getAccordionState();
      state[key] = open;
      localStorage.setItem(STORAGE_ACCORDIONS, JSON.stringify(state));
    } catch {}
  }

  // Read sidebar state from localStorage
  function getSidebarOpen() {
    try {
      const stored = localStorage.getItem(STORAGE_SIDEBAR);
      return stored === 'true';
    } catch {
      return false;
    }
  }

  // Save sidebar state to localStorage
  function setSidebarOpen(open) {
    try {
      localStorage.setItem(STORAGE_SIDEBAR, open ? 'true' : 'false');
    } catch {}
  }

  // Create the sidebar structure
  function createSidebar() {
    const aside = document.createElement('aside');
    aside.id = 'sidebar';
    aside.className = 'fixed top-11 left-0 bottom-0 w-[360px] z-30 glass border-r border-white/5 overflow-y-auto transition-transform duration-300';
    aside.style.transform = 'translateX(-100%)';
    aside.style.padding = '8px';
    
    document.body.appendChild(aside);
    return aside;
  }

  // Create hamburger toggle button
  function createToggleButton() {
    const nav = $$('nav .max-w-7xl');
    if (!nav) return null;

    const btn = document.createElement('button');
    btn.id = 'sideToggle';
    btn.className = 'relative flex items-center justify-center w-8 h-8 text-slate-300 hover:text-white transition-colors';
    btn.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <line x1="3" y1="5" x2="17" y2="5"></line>
        <line x1="3" y1="10" x2="17" y2="10"></line>
        <line x1="3" y1="15" x2="17" y2="15"></line>
      </svg>
      <span id="sideDot" class="hidden absolute top-0 right-0 w-2 h-2 bg-indigo-400 rounded-full animate-pulse"></span>
    `;
    btn.setAttribute('aria-label', 'Toggle sidebar');
    
    nav.insertBefore(btn, nav.firstChild);
    return btn;
  }

  // Create accordion section
  function createAccordion(key, title, content, defaultOpen = false) {
    const accState = getAccordionState();
    const isOpen = accState.hasOwnProperty(key) ? accState[key] : defaultOpen;

    const details = document.createElement('details');
    details.className = 'border-b border-white/5';
    details.style.marginBottom = '8px';
    details.open = isOpen;
    details.dataset.key = key;

    const summary = document.createElement('summary');
    summary.className = 'flex items-center justify-between px-4 py-3 cursor-pointer text-sm font-semibold text-slate-300 hover:text-white transition-colors select-none';
    summary.style.cssText = 'position:sticky;top:0;background:#0f172a;z-index:10;';
    summary.innerHTML = `
      <span>${title}</span>
      <svg class="chevron w-4 h-4 transition-transform" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <polyline points="6 9 12 15 18 9"></polyline>
      </svg>
    `;

    const contentDiv = document.createElement('div');
    contentDiv.className = 'px-4 pb-4';
    contentDiv.style.paddingTop = '4px';
    if (content) {
      contentDiv.appendChild(content);
    }

    details.appendChild(summary);
    details.appendChild(contentDiv);

    // Save state on toggle
    details.addEventListener('toggle', () => {
      setAccordionState(key, details.open);
      const chevron = summary.querySelector('.chevron');
      if (chevron) {
        chevron.style.transform = details.open ? 'rotate(180deg)' : 'rotate(0deg)';
      }
    });

    // Set initial chevron state
    const chevron = summary.querySelector('.chevron');
    if (chevron) {
      chevron.style.transform = isOpen ? 'rotate(180deg)' : 'rotate(0deg)';
    }

    return details;
  }

  // Newest first, collapse duplicate questions (keep newest), cap 20
  function normalizeRuns(runs) {
    if (!Array.isArray(runs)) return [];
    const sorted = runs.slice().sort((a, b) => String(b.ts || '').localeCompare(String(a.ts || '')));
    const seen = new Set(), out = [];
    for (const r of sorted) {
      const k = (r.question || '').trim().toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k); out.push(r);
      if (out.length >= 20) break;
    }
    return out;
  }
  if (!document.getElementById('run-history-style')) {
    const st = document.createElement('style'); st.id = 'run-history-style';
    st.textContent = '.run-history-list{max-height:50vh;overflow-y:auto;padding-right:4px;scrollbar-width:thin;scrollbar-color:#334155 transparent}.run-history-list::-webkit-scrollbar{width:6px}.run-history-list::-webkit-scrollbar-track{background:transparent}.run-history-list::-webkit-scrollbar-thumb{background:#334155;border-radius:3px}.run-history-list::-webkit-scrollbar-thumb:hover{background:#475569}';
    document.head.appendChild(st);
  }

  // Fetch and render run history
  async function createRunHistory() {
    const container = document.createElement('div');
    container.className = 'space-y-2 text-xs';
    container.innerHTML = '<div class="text-slate-400 text-center py-2">Loading…</div>';

    try {
      const resp = await fetch('/api/runs?n=60');
      if (!resp.ok) throw new Error('Failed to fetch runs');
      const runs = normalizeRuns(await resp.json());

      if (!runs || runs.length === 0) {
        container.innerHTML = '<div class="text-slate-500 text-center py-2">No runs yet</div>';
        return container;
      }

      container.className = 'run-history-list space-y-2 text-xs';
      container.innerHTML = runs.map((run, i) => {
        const id = run.run_id || run.id || '';
        const ts = run.ts ? new Date(run.ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';
        const label = id ? String(id).split('-').pop() : (ts || String(i + 1));
        const question = (run.question || 'Untitled').slice(0, 60);
        return `
          <a href="/map${id ? `?run=${encodeURIComponent(id)}` : ''}" class="block glass rounded-lg p-2 hover:bg-white/10 transition-colors">
            <div class="text-indigo-300 font-mono">#${escapeHtml(label)}</div>
            <div class="text-slate-300 mt-1">${escapeHtml(question)}</div>
            ${ts ? `<div class="text-slate-500 mt-1">${ts}</div>` : ''}
          </a>
        `;
      }).join('');
    } catch (err) {
      container.innerHTML = '<div class="text-red-400 text-center py-2">Failed to load history</div>';
    }

    return container;
  }

  // Escape HTML
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  // Create voice & hands-free section
  function createVoiceSection() {
    const container = document.createElement('div');
    container.className = 'space-y-2';

    const hfLabel = Array.from($$$('label')).find(el => {
      const input = el.querySelector('#hf');
      return input !== null;
    });

    if (hfLabel) {
      const clone = hfLabel.cloneNode(true);
      clone.className = 'text-sm text-slate-300 flex items-center gap-2';
      container.appendChild(clone);
      
      // Sync checkbox state
      const originalCheckbox = $('hf');
      const clonedCheckbox = clone.querySelector('input[type="checkbox"]');
      if (originalCheckbox && clonedCheckbox) {
        clonedCheckbox.checked = originalCheckbox.checked;
        clonedCheckbox.addEventListener('change', () => {
          originalCheckbox.checked = clonedCheckbox.checked;
          originalCheckbox.dispatchEvent(new Event('change'));
        });
        originalCheckbox.addEventListener('change', () => {
          clonedCheckbox.checked = originalCheckbox.checked;
        });
      }
    }

    const tip = document.createElement('div');
    tip.className = 'text-xs text-slate-400 mt-2';
    tip.textContent = 'Enable hands-free mode to automatically hear answers after each query.';
    container.appendChild(tip);

    return container;
  }

  // Create partners section
  function createPartnersSection() {
    const container = document.createElement('div');
    container.className = 'space-y-3';

    const badges = $('badges');
    if (badges) {
      const badgesClone = badges.cloneNode(true);
      badgesClone.removeAttribute('id');
      badgesClone.className = 'flex flex-wrap gap-2 text-sm';
      container.appendChild(badgesClone);
    }

    const partnerLink = $$('a[href="/dashboard"]');
    if (partnerLink) {
      const partners = document.createElement('div');
      partners.className = 'text-xs text-slate-400 flex flex-wrap gap-x-3 gap-y-1';
      const boldTags = partnerLink.querySelectorAll('b');
      boldTags.forEach(b => {
        const span = document.createElement('span');
        span.textContent = b.textContent;
        span.className = 'text-slate-300';
        partners.appendChild(span);
      });
      container.appendChild(partners);

      const link = document.createElement('a');
      link.href = '/dashboard';
      link.className = 'text-xs text-indigo-300 hover:text-indigo-200 inline-block mt-2';
      link.textContent = 'Open dashboards ↗';
      container.appendChild(link);
    }

    return container;
  }

  // Add live status line under Answer header
  function addLiveLine() {
    const answerCard = Array.from($$$('.glass')).find(el => {
      const h2 = el.querySelector('h2');
      return h2 && h2.textContent.includes('Answer');
    });

    if (!answerCard) return;

    const header = answerCard.querySelector('h2');
    if (!header) return;

    const liveline = document.createElement('div');
    liveline.id = 'liveline';
    liveline.className = 'text-xs text-slate-400 mt-1 font-mono';
    liveline.textContent = 'Ready';

    header.parentNode.insertBefore(liveline, header.nextSibling);

    // Watch #events for changes
    const events = $('events');
    if (events) {
      const observer = new MutationObserver(() => {
        const lastEvent = events.lastElementChild;
        if (lastEvent) {
          const textDiv = lastEvent.querySelector('.tw');
          if (textDiv && textDiv.textContent) {
            liveline.textContent = textDiv.textContent.slice(0, 80);
          }
        }
      });

      observer.observe(events, { childList: true, subtree: true });
    }
  }

  // Show activity dot when sidebar is closed and events arrive
  function setupActivityDot() {
    const events = $('events');
    const dot = $('sideDot');
    if (!events || !dot) return;

    const observer = new MutationObserver(() => {
      const sidebar = $('sidebar');
      if (sidebar && sidebar.style.transform === 'translateX(-100%)') {
        dot.classList.remove('hidden');
      }
    });

    observer.observe(events, { childList: true });
  }

  // Toggle sidebar
  function toggleSidebar(open) {
    const sidebar = $('sidebar');
    const main = $$('.max-w-7xl.mx-auto.px-6.py-8');
    const dot = $('sideDot');

    if (!sidebar) return;

    if (open) {
      sidebar.style.transform = 'translateX(0)';
      if (main && window.innerWidth >= 1100) {
        main.style.paddingLeft = '380px';
      }
      if (dot) dot.classList.add('hidden');
    } else {
      sidebar.style.transform = 'translateX(-100%)';
      if (main) {
        main.style.paddingLeft = '1.5rem';
      }
    }

    setSidebarOpen(open);
  }

  // Main initialization
  async function init() {
    // Wait for DOM to be ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
      return;
    }

    // Set base font size
    document.documentElement.style.fontSize = '16px';

    // Create sidebar
    const sidebar = createSidebar();

    // Create toggle button
    const toggleBtn = createToggleButton();
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => {
        const isOpen = sidebar.style.transform === 'translateX(0px)';
        toggleSidebar(!isOpen);
      });
    }

    // Find and move panels into sidebar
    
    // 1. Live agent activity
    const activityCard = Array.from($$$('.glass')).find(el => {
      const h2 = el.querySelector('h2');
      return h2 && h2.textContent.includes('Live agent activity');
    });
    
    if (activityCard) {
      const eventsDiv = $('events');
      const stagesSpan = $('stages');
      const content = document.createElement('div');
      content.className = 'space-y-2';
      
      if (stagesSpan) {
        const stagesClone = stagesSpan.cloneNode(true);
        stagesClone.removeAttribute('id');
        stagesClone.className = 'text-xs text-slate-500 mb-2 block';
        content.appendChild(stagesClone);
      }
      
      if (eventsDiv) {
        eventsDiv.style.cssText = 'max-height:45vh;overflow-y:auto;scrollbar-width:thin;scrollbar-color:#334155 transparent;display:flex;flex-direction:column;gap:6px;';
        eventsDiv.className = 'text-xs font-mono activity-list';
        
        // Add webkit scrollbar styles
        if (!document.getElementById('activity-scrollbar-style')) {
          const st = document.createElement('style');
          st.id = 'activity-scrollbar-style';
          st.textContent = '.activity-list::-webkit-scrollbar{width:6px}.activity-list::-webkit-scrollbar-track{background:transparent}.activity-list::-webkit-scrollbar-thumb{background:#334155;border-radius:3px}.activity-list::-webkit-scrollbar-thumb:hover{background:#475569}.activity-list>*{scroll-margin-top:52px;padding:6px 8px!important;margin:0!important;overflow-wrap:anywhere;word-break:break-word;min-width:0}';
          document.head.appendChild(st);
        }
        
        // Auto-scroll to newest item
        let wasNearBottom = true;
        const observer = new MutationObserver(() => {
          const scrollThreshold = 50;
          const isNearBottom = eventsDiv.scrollHeight - eventsDiv.scrollTop - eventsDiv.clientHeight < scrollThreshold;
          
          if (wasNearBottom || isNearBottom) {
            eventsDiv.scrollTop = eventsDiv.scrollHeight;
          }
          
          wasNearBottom = isNearBottom;
        });
        
        eventsDiv.addEventListener('scroll', () => {
          const scrollThreshold = 50;
          wasNearBottom = eventsDiv.scrollHeight - eventsDiv.scrollTop - eventsDiv.clientHeight < scrollThreshold;
        });
        
        observer.observe(eventsDiv, { childList: true });
        
        content.appendChild(eventsDiv);
      }
      
      const accordion = createAccordion('activity', 'Live agent activity', content, true);
      sidebar.appendChild(accordion);
      
      activityCard.remove();
    }

    // 2. Sources (citations)
    const citesCard = Array.from($$$('.glass')).find(el => {
      const h2 = el.querySelector('h2');
      return h2 && h2.textContent.includes('Retrieved authorities');
    });
    
    if (citesCard) {
      const citesDiv = $('cites');
      const content = document.createElement('div');
      if (citesDiv) {
        citesDiv.style.cssText = 'max-height:45vh;overflow-y:auto;scrollbar-width:thin;scrollbar-color:#334155 transparent;display:flex;flex-direction:column;gap:6px;';
        citesDiv.className = 'text-xs sources-list';
        
        // Add webkit scrollbar styles for sources
        if (!document.getElementById('sources-scrollbar-style')) {
          const st = document.createElement('style');
          st.id = 'sources-scrollbar-style';
          st.textContent = '.sources-list::-webkit-scrollbar{width:6px}.sources-list::-webkit-scrollbar-track{background:transparent}.sources-list::-webkit-scrollbar-thumb{background:#334155;border-radius:3px}.sources-list::-webkit-scrollbar-thumb:hover{background:#475569}.sources-list>*{scroll-margin-top:52px;overflow-wrap:anywhere;word-break:break-word;min-width:0}';
          document.head.appendChild(st);
        }
        
        content.appendChild(citesDiv);
      }
      
      const accordion = createAccordion('sources', 'Sources', content, false);
      sidebar.appendChild(accordion);
      
      citesCard.remove();
    }

    // 3. Run history
    const historyContent = await createRunHistory();
    const historyAccordion = createAccordion('history', 'Run history', historyContent, false);
    sidebar.appendChild(historyAccordion);

    // 4. Voice & hands-free
    const voiceContent = createVoiceSection();
    const voiceAccordion = createAccordion('voice', 'Voice & hands-free', voiceContent, false);
    sidebar.appendChild(voiceAccordion);

    // 5. Partners & pipeline
    const partnersContent = createPartnersSection();
    const partnersAccordion = createAccordion('partners', 'Partners & pipeline', partnersContent, false);
    sidebar.appendChild(partnersAccordion);

    // Widen main column (remove right column, expand left)
    const grid = $$('.grid.grid-cols-12');
    if (grid) {
      const leftCol = grid.querySelector('.col-span-8');
      const rightCol = grid.querySelector('.col-span-4');
      
      if (leftCol) {
        leftCol.className = leftCol.className.replace('col-span-8', 'col-span-12');
      }
      
      if (rightCol) {
        rightCol.remove();
      }
    }

    // Hide the partner link at the bottom since it's now in sidebar
    const partnerLink = $$('a[href="/dashboard"]');
    if (partnerLink && partnerLink.classList.contains('mt-6')) {
      partnerLink.style.display = 'none';
    }

    // Add live status line
    addLiveLine();

    // Setup activity dot
    setupActivityDot();

    // Handle initial sidebar state
    const shouldOpen = getSidebarOpen() && window.innerWidth >= 1100;
    toggleSidebar(shouldOpen);

    // Close sidebar on small screens by default
    if (window.innerWidth < 1100) {
      toggleSidebar(false);
    }

    // Handle window resize
    let resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (window.innerWidth < 1100) {
          toggleSidebar(false);
        } else {
          const shouldBeOpen = getSidebarOpen();
          toggleSidebar(shouldBeOpen);
        }
      }, 150);
    });

    // Handle Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && window.innerWidth < 1100) {
        const sidebar = $('sidebar');
        if (sidebar && sidebar.style.transform === 'translateX(0px)') {
          toggleSidebar(false);
        }
      }
    });

    // Preserve original #hf functionality
    const originalHf = $('hf');
    if (originalHf) {
      // Keep it in the DOM but hidden
      const parent = originalHf.closest('label');
      if (parent) {
        parent.style.display = 'none';
      }
    }
  }

  // Start initialization
  init();
})();

// ---- Hand patches on top of ABA output (sidebar usability, Alex 13:17) ----
(function(){
  function go(){
    const side=document.getElementById('sidebar'), btn=document.getElementById('sideToggle');
    if(!side||!btn) return setTimeout(go,150);
    const css=document.createElement('style'); css.textContent=`
      #sidebar{width:300px!important;top:var(--navh,56px)!important;height:calc(100vh - var(--navh,56px))!important;padding:8px!important;font-size:15.5px;line-height:1.5;z-index:45;overflow-y:auto;overscroll-behavior:contain;transition:transform .28s ease!important;background:rgba(10,14,30,.96)}
      #sidebar summary{min-height:48px;display:flex;align-items:center;padding:12px 16px;font-size:16px;font-weight:600;cursor:pointer;color:#e2e8f0}
      #sidebar summary:hover{background:rgba(99,102,241,.12)}
      #sidebar details>*:not(summary){padding:0 16px 14px}
      #sidebar details{margin-bottom:8px!important}
      #sideToggle{width:32px!important;height:32px!important;min-width:32px;padding:0!important;justify-content:center;border-radius:8px;background:transparent!important;border:1px solid transparent!important;color:#cbd5e1!important;box-shadow:none!important;flex-shrink:0!important;transition:border-color .15s,background .15s,color .15s}
      #sideToggle:hover,#sideToggle:focus-visible{border-color:rgba(148,163,184,.35)!important;background:rgba(148,163,184,.08)!important;color:#fff!important}
      #sideToggle .lbl{display:none!important}
      #sideClose{display:none!important;position:absolute;top:10px;right:10px;width:40px;height:40px;border-radius:10px;font-size:22px;color:#cbd5e1;background:rgba(30,41,59,.8)}
      #sideClose:hover{color:#fff;background:rgba(71,85,105,.9)}
      #sideBack{position:fixed;inset:var(--navh,56px) 0 0 0;background:rgba(2,6,23,.55);z-index:44;opacity:0;pointer-events:none;transition:opacity .25s}
      #sideBack.on{opacity:1;pointer-events:auto}`;
    document.head.appendChild(css);
    if(!btn.querySelector('.lbl')){ const l=document.createElement('span'); l.className='lbl'; l.textContent='Menu'; btn.appendChild(l); }
    btn.style.display='flex'; btn.style.alignItems='center'; btn.title='Menu'; btn.setAttribute('aria-label','Menu'); (document.querySelector('nav .max-w-7xl')||document.body).prepend(btn);
    const x=document.createElement('button'); x.id='sideClose'; x.setAttribute('aria-label','Close menu'); x.textContent='✕'; side.prepend(x);
    const back=document.createElement('div'); back.id='sideBack'; document.body.appendChild(back);
    const isOpen=()=>side.style.transform==='translateX(0px)'||side.style.transform==='translateX(0)';
    const sync=()=>{ const o=isOpen(), narrow=innerWidth<1100; back.classList.toggle('on',o&&narrow); btn.setAttribute('aria-expanded',String(o)); btn.querySelector('.lbl').textContent=o?'Close':'Menu';
      const main=document.querySelector('.max-w-7xl.mx-auto.px-6.py-8'); if(main) main.style.paddingLeft=(o&&!narrow)?'324px':''; };
    const close=()=>{ if(isOpen()) btn.click(); };
    x.onclick=close; back.onclick=close;
    addEventListener('keydown',e=>{ if(e.key==='Escape') close(); });
    new MutationObserver(sync).observe(side,{attributes:true,attributeFilter:['style']}); addEventListener('resize',sync); sync();
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',go); else go();
})();

;(function(){function m(){var n=document.querySelector("nav");if(n)document.documentElement.style.setProperty("--navh",n.getBoundingClientRect().height+"px")}m();addEventListener("resize",m);addEventListener("load",m)})();
