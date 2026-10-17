// declutter.js — homepage only: folds the secondary panels into the shared sidebar (navbar.js builds it),
// and widens the main column to match. Panels become collapsible sections under Examples.
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const $$$ = (sel) => document.querySelectorAll(sel);

  const STORAGE_ACCORDIONS = 'precedent.acc';

  function getAccordionState() {
    try {
      const stored = localStorage.getItem(STORAGE_ACCORDIONS);
      return stored ? JSON.parse(stored) : {};
    } catch {
      return {};
    }
  }

  function setAccordionState(key, open) {
    try {
      const state = getAccordionState();
      state[key] = open;
      localStorage.setItem(STORAGE_ACCORDIONS, JSON.stringify(state));
    } catch {}
  }

  // accordion section, same shape as the sidebar's own sections
  function createAccordion(key, title, content, defaultOpen = false) {
    const accState = getAccordionState();
    const isOpen = accState.hasOwnProperty(key) ? accState[key] : defaultOpen;

    const details = document.createElement('details');
    details.className = 'side-sec';
    details.open = isOpen;
    details.dataset.key = key;

    const summary = document.createElement('summary');
    summary.innerHTML =
      '<span></span><svg class="chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>';
    summary.querySelector('span').textContent = title;

    const contentDiv = document.createElement('div');
    contentDiv.className = 'side-body';
    if (content) contentDiv.appendChild(content);

    details.addEventListener('toggle', () => {
      setAccordionState(key, details.open);
    });

    details.append(summary, contentDiv);
    return details;
  }

  // Newest first, collapse duplicate questions (keep newest), cap 20
  function normalizeRuns(runs) {
    if (!Array.isArray(runs)) return [];
    const sorted = runs.slice().sort((a, b) => String(b.ts || '').localeCompare(String(a.ts || '')));
    const seen = new Set(),
      out = [];
    for (const r of sorted) {
      const k = (r.question || '').trim().toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(r);
      if (out.length >= 20) break;
    }
    return out;
  }

  if (!document.getElementById('run-history-style')) {
    const st = document.createElement('style');
    st.id = 'run-history-style';
    st.textContent =
      '.run-history-list{max-height:50vh;overflow-y:auto;padding-right:4px;scrollbar-width:thin;scrollbar-color:#334155 transparent}.run-history-list::-webkit-scrollbar{width:6px}.run-history-list::-webkit-scrollbar-track{background:transparent}.run-history-list::-webkit-scrollbar-thumb{background:#334155;border-radius:3px}.run-history-list::-webkit-scrollbar-thumb:hover{background:#475569}';
    document.head.appendChild(st);
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  async function createRunHistory() {
    const container = document.createElement('div');
    container.className = 'space-y-2 text-xs';
    container.innerHTML = '<div class="text-slate-400 text-center py-2">Loading…</div>';

    try {
      const resp = await fetch('/api/runs?n=60');
      if (!resp.ok) throw new Error('Failed to fetch runs');
      const runs = normalizeRuns(await resp.json());

      if (!runs.length) {
        container.innerHTML = '<div class="text-slate-500 text-center py-2">No runs yet</div>';
        return container;
      }

      container.className = 'run-history-list space-y-2 text-xs';
      container.innerHTML = runs.map((run, i) => {
        const id = run.run_id || run.id || '';
        const ts = run.ts ? new Date(run.ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';
        const label = id ? String(id).split('-').pop() : ts || String(i + 1);
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

  function createVoiceSection() {
    const container = document.createElement('div');
    container.className = 'space-y-2';

    const hfLabel = Array.from($$$('label')).find((el) => el.querySelector('#hf') !== null);

    if (hfLabel) {
      const clone = hfLabel.cloneNode(true);
      clone.className = 'text-sm text-slate-300 flex items-center gap-2';
      container.appendChild(clone);

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

  function createPartnersSection() {
    const container = document.createElement('div');
    container.className = 'space-y-3';

    const partnerLink = document.querySelector('a[href="/dashboard"]');
    if (partnerLink) {
      const partners = document.createElement('div');
      partners.className = 'text-xs text-slate-400 flex flex-wrap gap-x-3 gap-y-1';
      partnerLink.querySelectorAll('b').forEach((b) => {
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

  // Live status line under the Answer header, fed by the agent event list
  function addLiveLine() {
    const answerCard = Array.from($$$('.glass')).find((el) => {
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

    const events = $('events');
    if (events) {
      const observer = new MutationObserver(() => {
        const lastEvent = events.lastElementChild;
        if (lastEvent) {
          const textDiv = lastEvent.querySelector('.tw');
          if (textDiv && textDiv.textContent) liveline.textContent = textDiv.textContent.slice(0, 80);
        }
      });
      observer.observe(events, { childList: true, subtree: true });
    }
  }

  // Nudge on the sidebar toggle when events arrive while it is out of view
  function setupActivityDot() {
    const events = $('events');
    const dot = $('sideDot');
    if (!events || !dot) return;
    const hidden = () => !document.documentElement.classList.contains('side-shown');
    new MutationObserver(() => {
      if (hidden()) dot.hidden = false;
    }).observe(events, { childList: true });
    document.documentElement.addEventListener('transitionend', () => {
      if (!hidden()) dot.hidden = true;
    });
  }

  function scrollList(el, cls) {
    el.style.cssText = 'max-height:45vh;overflow-y:auto;scrollbar-width:thin;scrollbar-color:#334155 transparent;display:flex;flex-direction:column;gap:6px;';
    el.className = cls;
  }

  function listStyles() {
    if (document.getElementById('sidebar-list-style')) return;
    const st = document.createElement('style');
    st.id = 'sidebar-list-style';
    st.textContent =
      '.activity-list::-webkit-scrollbar,.sources-list::-webkit-scrollbar{width:6px}.activity-list::-webkit-scrollbar-track,.sources-list::-webkit-scrollbar-track{background:transparent}.activity-list::-webkit-scrollbar-thumb,.sources-list::-webkit-scrollbar-thumb{background:#334155;border-radius:3px}.activity-list::-webkit-scrollbar-thumb:hover,.sources-list::-webkit-scrollbar-thumb:hover{background:#475569}.activity-list>*{scroll-margin-top:52px;padding:6px 8px!important;margin:0!important;overflow-wrap:anywhere;word-break:break-word;min-width:0}.sources-list>*{scroll-margin-top:52px;overflow-wrap:anywhere;word-break:break-word;min-width:0}';
    document.head.appendChild(st);
  }

  async function init() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
      return;
    }
    const sidebar = $('sidebar-panels');
    if (!sidebar) return setTimeout(init, 120); // wait for the shared shell

    document.documentElement.style.fontSize = '16px';
    listStyles();

    // 1. Live agent activity
    const activityCard = Array.from($$$('.glass')).find((el) => {
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
        scrollList(eventsDiv, 'text-xs font-mono activity-list');
        let wasNearBottom = true;
        const isNear = () => eventsDiv.scrollHeight - eventsDiv.scrollTop - eventsDiv.clientHeight < 50;
        new MutationObserver(() => {
          if (wasNearBottom || isNear()) eventsDiv.scrollTop = eventsDiv.scrollHeight;
          wasNearBottom = isNear();
        }).observe(eventsDiv, { childList: true });
        eventsDiv.addEventListener('scroll', () => {
          wasNearBottom = isNear();
        });
        content.appendChild(eventsDiv);
      }

      sidebar.appendChild(createAccordion('activity', 'Live agent activity', content, true));
      activityCard.remove();
    }

    // 2. Retrieved authorities
    const citesCard = Array.from($$$('.glass')).find((el) => {
      const h2 = el.querySelector('h2');
      return h2 && h2.textContent.includes('Retrieved authorities');
    });
    if (citesCard) {
      const citesDiv = $('cites');
      const content = document.createElement('div');
      if (citesDiv) {
        scrollList(citesDiv, 'text-xs sources-list');
        content.appendChild(citesDiv);
      }
      sidebar.appendChild(createAccordion('sources', 'Sources', content, false));
      citesCard.remove();
    }

    // 3. Run history, 4. voice, 5. partners
    sidebar.appendChild(createAccordion('history', 'Run history', await createRunHistory(), false));
    sidebar.appendChild(createAccordion('voice', 'Voice & hands-free', createVoiceSection(), false));
    sidebar.appendChild(createAccordion('partners', 'Partners & pipeline', createPartnersSection(), false));

    // Widen the main column: the right-hand column now lives in the sidebar
    const grid = document.querySelector('.grid.grid-cols-12');
    if (grid) {
      const leftCol = grid.querySelector('.col-span-8');
      const rightCol = grid.querySelector('.col-span-4');
      if (leftCol) leftCol.className = leftCol.className.replace('col-span-8', 'col-span-12');
      if (rightCol) rightCol.remove();
    }

    // The partner line at the bottom is folded into the sidebar; the hands-free box moved with it
    const partnerLink = document.querySelector('a[href="/dashboard"]');
    if (partnerLink && partnerLink.classList.contains('mt-6')) partnerLink.style.display = 'none';

    addLiveLine();
    setupActivityDot();

    const originalHf = $('hf');
    if (originalHf) {
      const parent = originalHf.closest('label');
      if (parent) parent.style.display = 'none';
    }
  }

  init();
})();
