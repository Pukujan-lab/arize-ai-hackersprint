// navbar.js — the one shared shell for every page (issue #50).
// Builds <header id="topbar"> (logo, sidebar toggle, ask box), <nav id="sidebar"> (navigation links only),
// the drawer backdrop and the "Built with" footer. Style lives in /static/layout.css.
// Navigation used to be a row of links in each page's <nav>; those old navs are removed here.
// Everything else a page shows — activity, sources, run pickers — stays in the page itself.
(function () {
  'use strict';

  // Partner order for the footer logo strip, and logo widths (all 18px tall).
  const PARTNER_ORDER = ['daytona', 'surrealdb', 'octo', 'arize', 'elevenlabs', 'anthropic'];
  const LOGO_DIMS = { daytona: 80, surrealdb: 18, arize: 66, elevenlabs: 18, anthropic: 18 };

  const ROUTES = [
    ['/', 'Home'],
    ['/map', 'Map'],
    ['/runs', 'Run history'],
    ['/dashboard', 'Dashboard'],
    ['/observability', 'Observability'],
    ['/guide', 'Guide'],
    ['/slides', 'Slides'],
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

  // ---------- sidebar: navigation links only ----------
  function buildSidebar() {
    const here = pagePath();
    const stale = $('sidebar'); // a cached older shell: it holds nothing we need, the links are rebuilt here
    if (stale) stale.remove();

    const side = document.createElement('nav');
    side.id = 'sidebar';
    side.setAttribute('aria-label', 'Main');

    const head = document.createElement('div');
    head.className = 'side-head';
    const kicker = document.createElement('span');
    kicker.className = 'side-kicker';
    kicker.textContent = 'Menu';
    const close = document.createElement('button');
    close.id = 'sidebar-close';
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

    side.append(head, links);
    document.body.appendChild(side);

    const back = document.createElement('div');
    back.id = 'sidebar-backdrop';
    back.onclick = closeDrawer;
    document.body.appendChild(back);
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
    strip.style.cssText =
      'display:flex;align-items:center;gap:12px;margin-left:auto;flex:0 1 auto;min-width:0;max-width:100%;overflow:hidden;flex-wrap:nowrap;';
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

  // ========== Shell polish (#72) =========
  // Main added this when navigation still lived in a per-page <nav>. That <nav> is gone, so the same outcome is
  // retargeted at the shared shell: a firm bar edge, a divider after the brand, steady gaps, and the partner logo
  // strip never squeezing the page below desktop width (it shrinks and clips, then hides).
  function fixNavbarLayout() {
    if (document.getElementById('navbar-layout-fixes')) return;
    const style = document.createElement('style');
    style.id = 'navbar-layout-fixes';
    style.textContent = `
      #topbar{gap:14px}
      #tb-brand{padding-right:14px;border-right:1px solid rgba(148,163,184,.2);white-space:nowrap}
      #topbar > *:last-child{margin-left:auto}
      #partner-strip{flex:0 1 auto;min-width:0;max-width:100%;flex-wrap:nowrap;overflow:hidden}
      #partner-strip > *{flex:0 1 auto;min-width:0}
      @media (max-width:1279px){#partner-strip{display:none!important}#tb-brand{white-space:nowrap!important}}
      @media (max-width:900px){#topbar{gap:14px}#tb-brand{padding-right:14px}}
    `;
    document.head.appendChild(style);
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
    buildFooter();
    dropOldNavs();
    setFavicon();
    ensureCss('/static/layout.css?v=sb4');
    ensureCss('/static/responsive.css?v=sb4');
    fixNavbarLayout();
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
