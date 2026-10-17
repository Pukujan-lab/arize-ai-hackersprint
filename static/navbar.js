// navbar.js — the one shared shell for every page (issue #50).
// Builds <header id="topbar"> (logo, sidebar toggle, ask box), <nav id="sidebar"> (page links, Examples, then the
// page's own panels), the drawer backdrop and the "Built with" footer. Style lives in /static/layout.css.
// Navigation used to be a row of links in each page's <nav>; those old navs are removed here.
(function () {
  'use strict';

  // Partner order for the footer logo strip, and logo widths (all 18px tall).
  const PARTNER_ORDER = ['daytona', 'surrealdb', 'octo', 'arize', 'elevenlabs', 'anthropic'];
  const LOGO_DIMS = { daytona: 80, surrealdb: 18, arize: 66, elevenlabs: 18, anthropic: 18 };

  const EXAMPLE_QUESTIONS = [
    'Automobile exception: probable cause standard in Colorado',
    'Landlord liability for security deposit withholding under C.R.S. 38-12-103',
    'Suppression of evidence from warrantless vehicle search',
    'Water rights priority: senior appropriator call doctrine',
  ];

  const ROUTES = [
    ['/', 'Home'],
    ['/map', 'Map'],
    ['/dashboard', 'Dashboards'],
    ['/slides', 'Slides'],
    ['/guide', 'Guide'],
    ['/observability', 'Observability'],
  ];

  const SIDE_KEY = 'precedent.sidebar';
  const DESK = 1024;
  const $ = (id) => document.getElementById(id);
  const isDesk = () => window.innerWidth >= DESK;
  const pagePath = () => {
    const p = location.pathname.replace(/\/+$/, '') || '/';
    return p === '/index.html' ? '/' : p;
  };
  const read = () => {
    try {
      return localStorage.getItem(SIDE_KEY);
    } catch (e) {
      return null;
    }
  };
  const write = (v) => {
    try {
      localStorage.setItem(SIDE_KEY, v);
    } catch (e) {}
  };

  let topbar, toggle, drawerOpen = false, wasDesk = false;

  // ---------- state ----------
  function dockedOpen() {
    return read() !== 'closed';
  }
  function shown() {
    return isDesk() ? dockedOpen() : drawerOpen;
  }
  function measure() {
    if (!topbar) return;
    document.documentElement.style.setProperty('--topbar-h', Math.round(topbar.getBoundingClientRect().height) + 'px');
  }
  function apply() {
    const root = document.documentElement;
    root.classList.toggle('side-docked', isDesk());
    root.classList.toggle('side-shown', shown());
    if (toggle) {
      toggle.setAttribute('aria-expanded', shown() ? 'true' : 'false');
      toggle.setAttribute('aria-label', shown() ? 'Hide menu' : 'Show menu');
      toggle.title = shown() ? 'Hide the menu' : 'Show the menu';
    }
    measure();
  }
  function setOpen(open) {
    if (isDesk()) write(open ? 'open' : 'closed');
    else drawerOpen = open;
    apply();
    window.dispatchEvent(new Event('resize')); // pages re-fit their own canvas or deck
  }
  function closeDrawer() {
    if (isDesk() || !drawerOpen) return;
    drawerOpen = false;
    apply();
    window.dispatchEvent(new Event('resize'));
    if (toggle) toggle.focus();
  }

  // ---------- top bar ----------
  function buildTopbar() {
    topbar = document.createElement('header');
    topbar.id = 'topbar';

    const brand = document.createElement('a');
    brand.id = 'tb-brand';
    brand.href = '/';
    brand.textContent = 'Precedent';
    const mark = document.createElement('img');
    mark.src = '/static/logo.svg';
    mark.alt = '';
    mark.width = 24;
    mark.height = 24;
    brand.insertBefore(mark, brand.firstChild);

    toggle = document.createElement('button');
    toggle.id = 'sidebar-toggle';
    toggle.type = 'button';
    toggle.setAttribute('aria-controls', 'sidebar');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.innerHTML = '<span class="tb-ico" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="5" x2="17" y2="5"></line><line x1="3" y1="10" x2="17" y2="10"></line><line x1="3" y1="15" x2="17" y2="15"></line></svg></span><span class="tb-txt">Menu</span>';
    const dot = document.createElement('span');
    dot.id = 'sideDot';
    dot.hidden = true;
    toggle.appendChild(dot);
    toggle.onclick = () => setOpen(!shown());

    topbar.append(brand, toggle);
    document.body.insertBefore(topbar, document.body.firstChild);
  }

  // A page either brings its own ask form (map: it runs there; demo: it stays in the page body)
  // or gets the plain one below, which asks on the demo page.
  function placeAskForm() {
    const pageForm = $('ask-form') || $('f');
    if (pageForm && !pageForm.hasAttribute('data-in-page')) {
      if (pageForm.id === 'f') pageForm.id = 'ask-form';
      pageForm.removeAttribute('class');
      topbar.appendChild(pageForm);
      pageForm.dataset.inTopbar = '1';
      return pageForm;
    }
    if (pageForm) return pageForm;
    const form = document.createElement('form');
    form.id = 'ask-form';
    const label = document.createElement('label');
    label.className = 'sr-only';
    label.htmlFor = 'q';
    label.textContent = 'Legal research question';
    const input = document.createElement('input');
    input.id = 'q';
    input.type = 'text';
    input.autocomplete = 'off';
    input.setAttribute('aria-label', 'Legal research question');
    input.placeholder = 'Ask a legal question';
    const go = document.createElement('button');
    go.id = 'go';
    go.type = 'submit';
    go.textContent = 'Ask';
    go.setAttribute('aria-label', 'Ask: research this question');
    go.title = 'Ask';
    form.append(label, input, go);
    form.dataset.inTopbar = '1';
    form.onsubmit = (e) => {
      e.preventDefault();
      const q = (input.value || '').trim();
      if (!q) {
        input.focus();
        return;
      }
      location.href = '/?q=' + encodeURIComponent(q);
    };
    topbar.appendChild(form);
    return form;
  }

  // The voice orb (voice.js) belongs to the ask box it drives — but only when that box sits in the top bar.
  // The demo page keeps its floating corner orb (responsive.css sizes it), so nothing moves there.
  // The orb is a plain button: it must never submit the form it now lives in.
  function moveMic(form) {
    let tries = 0;
    (function place() {
      const orb = $('vorb');
      if (!orb) {
        if (tries++ < 40) setTimeout(place, 150);
        return;
      }
      orb.type = 'button';
      if (form.contains(orb)) return;
      orb.classList.add('in-form');
      form.appendChild(orb);
      document.body.classList.add('mic-in-form');
    })();
  }

  // ---------- sidebar ----------
  function buildSidebar() {
    const here = pagePath();
    // A page script may have left an older sidebar behind (cached declutter.js): keep its panels, drop its shell.
    const stale = $('sidebar');
    const staleKids = stale && !stale.querySelector('#side-links') ? [...stale.children] : [];
    if (staleKids.length) stale.remove();

    const side = document.createElement('nav');
    side.id = 'sidebar';
    side.setAttribute('aria-label', 'Main');

    const head = document.createElement('div');
    head.className = 'side-head';
    const kicker = document.createElement('span');
    kicker.className = 'side-kicker';
    kicker.textContent = 'Menu';
    const close = document.createElement('button');
    close.id = 'side-close';
    close.type = 'button';
    close.setAttribute('aria-label', 'Close menu');
    close.textContent = '✕';
    close.onclick = closeDrawer;
    head.append(kicker, close);

    const links = document.createElement('div');
    links.id = 'side-links';
    ROUTES.forEach(([href, label]) => {
      const a = document.createElement('a');
      a.href = href;
      a.textContent = label;
      if (href === here) a.setAttribute('aria-current', 'page');
      links.appendChild(a);
    });

    const ex = document.createElement('details');
    ex.className = 'side-sec';
    ex.id = 'sidebar-examples';
    ex.open = true;
    const sum = document.createElement('summary');
    sum.innerHTML = '<span>Examples</span><svg class="chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>';
    const body = document.createElement('div');
    body.className = 'side-body';
    EXAMPLE_QUESTIONS.forEach((question) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ex-item';
      b.textContent = question;
      b.onclick = () => useExample(question);
      body.appendChild(b);
    });
    ex.append(sum, body);

    const panels = document.createElement('div');
    panels.id = 'sidebar-panels';

    side.append(head, links, ex, panels);
    document.body.appendChild(side);
    staleKids.forEach((k) => panels.appendChild(k));

    const back = document.createElement('div');
    back.id = 'sidebar-backdrop';
    back.onclick = closeDrawer;
    document.body.appendChild(back);
  }

  // An example fills the demo ask box; anywhere else it asks on the demo page.
  function useExample(question) {
    if (pagePath() === '/') {
      const input = $('q');
      if (input) {
        input.value = question;
        input.focus();
      }
      return;
    }
    location.href = '/?q=' + encodeURIComponent(question);
  }

  // Panels a page declares with <div id="page-panels" hidden> become sections below the navigation.
  function movePagePanels() {
    const host = $('sidebar-panels');
    const declared = $('page-panels');
    if (!host || !declared) return;
    while (declared.firstElementChild) host.appendChild(declared.firstElementChild);
    declared.remove();
  }

  // ---------- footer ----------
  function buildFooter() {
    if (!window.PARTNERS) return;
    const foot = document.createElement('footer');
    foot.id = 'site-footer';
    const label = document.createElement('span');
    label.className = 'foot-label';
    label.textContent = 'Built with';
    const strip = document.createElement('div');
    strip.id = 'partner-strip';
    foot.append(label, strip);
    document.body.appendChild(foot);

    PARTNER_ORDER.forEach((key) => {
      const partner = window.PARTNERS[key];
      if (!partner) return;
      const link = document.createElement('a');
      link.href = partner.url;
      link.target = '_blank';
      link.rel = 'noopener';
      link.title = `${partner.name} — open dashboard`;
      link.setAttribute('aria-label', `${partner.name} — open dashboard`);
      link.style.setProperty('--bw', partner.color);

      if (key === 'octo') {
        const text = document.createElement('span');
        text.textContent = partner.name;
        text.style.cssText = 'font-size:13px;font-weight:700;color:#94a3b8;opacity:0.75;transition:all 0.2s;';
        link.appendChild(text);
        const on = () => {
          text.style.color = partner.color;
          text.style.opacity = '1';
        };
        const off = () => {
          text.style.color = '#94a3b8';
          text.style.opacity = '0.75';
        };
        ['mouseenter', 'focus'].forEach((ev) => link.addEventListener(ev, on));
        ['mouseleave', 'blur'].forEach((ev) => link.addEventListener(ev, off));
      } else {
        const logo = document.createElement('span');
        logo.className = 'bw-logo';
        const mask = `url(/static/vendor/logos/${key}.svg)`;
        logo.style.cssText = `display:inline-block;width:${LOGO_DIMS[key] || 18}px;height:18px;background-color:#94a3b8;opacity:0.75;-webkit-mask-image:${mask};mask-image:${mask};-webkit-mask-size:contain;mask-size:contain;-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;-webkit-mask-position:center;mask-position:center;transition:all 0.2s;`;
        const sr = document.createElement('span');
        sr.textContent = partner.name;
        sr.className = 'sr-only';
        link.append(logo, sr);
        const on = () => {
          logo.style.backgroundColor = partner.color;
          logo.style.opacity = '1';
        };
        const off = () => {
          logo.style.backgroundColor = '#94a3b8';
          logo.style.opacity = '0.75';
        };
        ['mouseenter', 'focus'].forEach((ev) => link.addEventListener(ev, on));
        ['mouseleave', 'blur'].forEach((ev) => link.addEventListener(ev, off));
      }
      strip.appendChild(link);
    });
  }

  // ---------- housekeeping on the old markup ----------
  function dropOldNavs() {
    document.querySelectorAll('nav:not(#sidebar)').forEach((n) => n.remove());
    const badges = $('badges');
    if (badges) {
      badges.style.display = 'none';
      badges.innerHTML = '';
    }
  }

  function setFavicon() {
    document.head.querySelectorAll('link[rel~=icon]').forEach((l) => l.remove());
    const f = document.createElement('link');
    f.rel = 'icon';
    f.type = 'image/svg+xml';
    f.href = '/static/logo.svg';
    document.head.appendChild(f);
  }

  // Pages link layout.css in their head; this covers any page that forgot, without loading a file twice.
  function ensureCss(href) {
    const file = href.split('?')[0];
    const have = [...document.querySelectorAll('link[rel=stylesheet]')].some((l) => (l.getAttribute('href') || '').indexOf(file) >= 0);
    if (have) return;
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = href;
    document.head.appendChild(l);
  }

  // A question handed over by another page's ask box.
  function askFromUrl() {
    if (pagePath() !== '/') return;
    let q = '';
    try {
      q = (new URLSearchParams(location.search).get('q') || '').trim();
    } catch (e) {
      return;
    }
    if (!q || !$('q')) return;
    let tries = 0;
    (function go() {
      if (window.PRECEDENT && PRECEDENT.ask) {
        PRECEDENT.ask(q);
        return;
      }
      if (tries++ < 40) setTimeout(go, 150);
    })();
  }

  // ---------- init ----------
  function init() {
    if ($('topbar')) return;

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
      return;
    }

    buildTopbar();
    const form = placeAskForm();
    buildSidebar();
    movePagePanels();
    buildFooter();
    dropOldNavs();
    setFavicon();
    ensureCss('/static/layout.css?v=side2');
    ensureCss('/static/responsive.css?v=side2');
    window.addEventListener('resize', () => {
      const d = isDesk();
      if (d !== wasDesk) {
        wasDesk = d;
        drawerOpen = false;
      }
      apply();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeDrawer();
    });
    wasDesk = isDesk();
    apply();
    if (form.dataset.inTopbar) moveMic(form);
    askFromUrl();
    // The shell changes what is left for the page: hand back the height and width once the styles have settled.
    requestAnimationFrame(() => {
      apply();
      window.dispatchEvent(new Event('resize'));
    });
  }

  init();
})();
