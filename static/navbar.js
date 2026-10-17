// navbar.js — shared navigation enhancements for Precedent demo
// Adds partner logo strip, replaces example chips with accessible dropdown menu

(function() {
  'use strict';

  // Partner order for logo strip
  const PARTNER_ORDER = ['daytona', 'surrealdb', 'octo', 'arize', 'elevenlabs', 'anthropic'];
  
  // Logo dimensions (width in px, height is 18px for all)
  const LOGO_DIMS = {
    daytona: 80,
    surrealdb: 18,
    arize: 66,
    elevenlabs: 18,
    anthropic: 18
  };

  // Example questions (same for both pages)
  const EXAMPLE_QUESTIONS = [
    "Automobile exception: probable cause standard in Colorado",
    "Landlord liability for security deposit withholding under C.R.S. 38-12-103",
    "Suppression of evidence from warrantless vehicle search",
    "Water rights priority: senior appropriator call doctrine"
  ];

  // ========== 1. Partner Logo Strip ==========
  function addPartnerStrip() {
    const nav = document.querySelector('nav');
    if (!nav || !window.PARTNERS) return;

    // Create container for logo strip
    const strip = document.createElement('div');
    strip.id = 'partner-strip';
    strip.style.cssText = "display:flex;align-items:center;gap:12px;margin-left:auto;flex-shrink:0;";
    
    // Add "Built with" label
    const label = document.createElement('span');
    label.textContent = 'BUILT WITH';
    label.style.cssText = 'font-size:9px;text-transform:uppercase;letter-spacing:0.08em;color:rgba(148,163,184,0.6);font-weight:600;white-space:nowrap;';
    strip.appendChild(label);

    // Add partner logos
    PARTNER_ORDER.forEach(key => {
      const partner = window.PARTNERS[key];
      if (!partner) return;

      const link = document.createElement('a');
      link.href = partner.url;
      link.target = '_blank';
      link.rel = 'noopener';
      link.title = `${partner.name} — open dashboard`;
      link.setAttribute('aria-label', `${partner.name} — open dashboard`);
      link.style.cssText = `display:inline-flex;align-items:center;transition:all 0.2s;--bw:${partner.color};`;

      if (key === 'octo') {
        // Text wordmark for Octo
        const text = document.createElement('span');
        text.textContent = partner.name;
        text.style.cssText = 'font-size:13px;font-weight:700;color:#94a3b8;opacity:0.75;transition:all 0.2s;';
        link.appendChild(text);
        
        link.addEventListener('mouseenter', () => {
          text.style.color = '#f59e0b';
          text.style.opacity = '1';
        });
        link.addEventListener('mouseleave', () => {
          text.style.color = '#94a3b8';
          text.style.opacity = '0.75';
        });
        link.addEventListener('focus', () => {
          text.style.color = '#f59e0b';
          text.style.opacity = '1';
        });
        link.addEventListener('blur', () => {
          text.style.color = '#94a3b8';
          text.style.opacity = '0.75';
        });
      } else {
        // SVG logo using CSS mask
        const logoSpan = document.createElement('span');
        logoSpan.className = 'bw-logo';
        logoSpan.style.cssText = `display:inline-block;width:${LOGO_DIMS[key]}px;height:18px;background-color:#94a3b8;opacity:0.75;mask-image:url(/static/vendor/logos/${key}.svg);-webkit-mask-image:url(/static/vendor/logos/${key}.svg);mask-size:contain;-webkit-mask-size:contain;mask-repeat:no-repeat;-webkit-mask-repeat:no-repeat;mask-position:center;-webkit-mask-position:center;transition:all 0.2s;`;
        
        // Visually hidden text for screen readers
        const srText = document.createElement('span');
        srText.textContent = partner.name;
        srText.style.cssText = 'position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border-width:0;';
        
        link.appendChild(logoSpan);
        link.appendChild(srText);
        
        link.addEventListener('mouseenter', () => {
          logoSpan.style.backgroundColor = partner.color;
          logoSpan.style.opacity = '1';
        });
        link.addEventListener('mouseleave', () => {
          logoSpan.style.backgroundColor = '#94a3b8';
          logoSpan.style.opacity = '0.75';
        });
        link.addEventListener('focus', () => {
          logoSpan.style.backgroundColor = partner.color;
          logoSpan.style.opacity = '1';
        });
        link.addEventListener('blur', () => {
          logoSpan.style.backgroundColor = '#94a3b8';
          logoSpan.style.opacity = '0.75';
        });
      }

      strip.appendChild(link);
    });

    // Media query for partner strip is now handled in fixNavbarLayout()

    // Append to nav (find the flex container inside nav)
    const navContainer = nav.querySelector('div');
    if (navContainer) {
      navContainer.appendChild(strip);
    } else {
      nav.appendChild(strip);
    }
  }

  // ========== 2. Hide Homepage Badges ==========
  function hideBadges() {
    const badges = document.getElementById('badges');
    if (badges) {
      badges.style.display = 'none';
      badges.innerHTML = ''; // Empty it
    }
  }

  // ========== 3. Examples Dropdown ==========
  function createExamplesDropdown() {
    // Find the input and submit button
    const input = document.getElementById('q');
    const goButton = document.getElementById('go');
    const form = document.getElementById('f');
    const examplesRow = document.getElementById('examples');
    
    if (!input) return; // Guard: input must exist

    // Hide original examples row
    if (examplesRow) {
      examplesRow.style.display = 'none';
    }

    // Create dropdown button
    const button = document.createElement('button');
    button.id = 'exBtn';
    button.type = 'button';
    button.textContent = 'Examples ▾';
    button.setAttribute('aria-haspopup', 'menu');
    button.setAttribute('aria-expanded', 'false');
    button.style.cssText = 'background:rgba(30,41,59,0.9);border:1px solid rgba(99,102,241,0.3);color:#e2e8f0;padding:0.5rem 1rem;border-radius:0.75rem;font-size:0.875rem;font-weight:600;cursor:pointer;transition:all 0.2s;white-space:nowrap;';
    
    button.addEventListener('mouseenter', () => {
      button.style.background = 'rgba(30,41,59,1)';
      button.style.borderColor = 'rgba(99,102,241,0.5)';
    });
    button.addEventListener('mouseleave', () => {
      button.style.background = 'rgba(30,41,59,0.9)';
      button.style.borderColor = 'rgba(99,102,241,0.3)';
    });

    // Create dropdown menu
    const menu = document.createElement('div');
    menu.id = 'exMenu';
    menu.setAttribute('role', 'menu');
    menu.style.cssText = 'display:none;position:absolute;right:0;top:100%;z-index:1000;background:#0f172a;border:1px solid rgba(129,140,248,0.55);border-radius:0.75rem;margin-top:0;width:max-content;min-width:260px;max-width:min(420px,90vw);white-space:normal;overflow-wrap:anywhere;text-align:left;box-shadow:0 18px 40px rgba(0,0,0,0.65);';

    let currentFocus = -1;
    const menuItems = [];

    EXAMPLE_QUESTIONS.forEach((question, index) => {
      const item = document.createElement('button');
      item.setAttribute('role', 'menuitem');
      item.type = 'button';
      item.textContent = question;
      item.style.cssText = 'display:block;width:100%;text-align:left;padding:0.75rem 1rem;background:transparent;border:none;color:#cbd5e1;cursor:pointer;transition:background 0.15s;font-size:0.875rem;line-height:1.4;';
      
      if (index === 0) {
        item.style.borderTopLeftRadius = '0.75rem';
        item.style.borderTopRightRadius = '0.75rem';
      }
      if (index === EXAMPLE_QUESTIONS.length - 1) {
        item.style.borderBottomLeftRadius = '0.75rem';
        item.style.borderBottomRightRadius = '0.75rem';
      }

      item.addEventListener('mouseenter', () => {
        item.style.background = 'rgba(99,102,241,0.2)';
      });
      item.addEventListener('mouseleave', () => {
        item.style.background = 'transparent';
      });

      item.addEventListener('click', () => {
        input.value = question;
        closeMenu();
        
        // Submit the form
        if (goButton) {
          goButton.click();
        } else if (form) {
          form.requestSubmit();
        }
      });

      menuItems.push(item);
      menu.appendChild(item);
    });

    // Position menu container
    const menuContainer = document.createElement('div');
    menuContainer.style.cssText = 'position:relative;display:inline-block;';
    menuContainer.appendChild(button);
    document.body.appendChild(menu); menu.style.position='fixed'; menu.style.right='auto'; menu.style.top='0'; menu.style.zIndex='1000';
    const placeMenu=()=>{ const r=button.getBoundingClientRect(); menu.style.top=(r.bottom+6)+'px'; const w=Math.min(420,innerWidth*0.9); menu.style.left=Math.max(8,Math.min(r.right-menu.offsetWidth, innerWidth-menu.offsetWidth-8))+'px'; menu.style.maxWidth=w+'px'; };
    addEventListener('resize',()=>{ if(menu.style.display!=='none') placeMenu(); }); addEventListener('scroll',()=>{ if(menu.style.display!=='none') placeMenu(); },true);

    // Insert after the go button or form
    let insertTarget = goButton || (form && form.querySelector('button'));
    if (insertTarget && insertTarget.parentElement) {
      insertTarget.parentElement.insertBefore(menuContainer, insertTarget.nextSibling);
      // Add spacing
      menuContainer.style.marginLeft = '0.75rem';
    }

    // Menu state management
    function openMenu() {
      menu.style.display = 'block'; placeMenu();
      button.setAttribute('aria-expanded', 'true');
      currentFocus = -1;
      // Focus first item
      if (menuItems.length > 0) {
        currentFocus = 0;
        menuItems[0].focus();
      }
    }

    function closeMenu() {
      menu.style.display = 'none';
      button.setAttribute('aria-expanded', 'false');
      currentFocus = -1;
    }

    function toggleMenu() {
      if (menu.style.display === 'none') {
        openMenu();
      } else {
        closeMenu();
      }
    }

    // Button click handler
    button.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleMenu();
    });

    // Keyboard navigation
    button.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openMenu();
      } else if (e.key === 'Escape') {
        closeMenu();
      }
    });

    menu.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        currentFocus = (currentFocus + 1) % menuItems.length;
        menuItems[currentFocus].focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        currentFocus = (currentFocus - 1 + menuItems.length) % menuItems.length;
        menuItems[currentFocus].focus();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closeMenu();
        button.focus();
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (currentFocus >= 0 && menuItems[currentFocus]) {
          menuItems[currentFocus].click();
        }
      }
    });

    // Close on click outside
    document.addEventListener('click', (e) => {
      if (!menuContainer.contains(e.target) && !menu.contains(e.target)) {
        closeMenu();
      }
    });

    // Close on focus outside
    document.addEventListener('focusin', (e) => {
      if (!menuContainer.contains(e.target) && !menu.contains(e.target)) {
        closeMenu();
      }
    });
  }

  // ========== Navbar Layout Fixes ==========
  function fixNavbarLayout() {
    const style = document.createElement('style');
    style.id = 'navbar-layout-fixes';
    style.textContent = `
      /* Navbar container: prevent overflow, consistent gaps */
      nav .max-w-7xl {
        display: flex !important;
        align-items: center !important;
        gap: 14px !important;
        flex-wrap: nowrap !important;
        min-width: 0 !important;
        overflow: visible !important;
      }
      
      /* Remove ad-hoc margins from nav items */
      nav .max-w-7xl > * {
        margin: 0 !important;
      }
      
      /* Sidebar toggle button: inline flex item, not floating */
      #sideToggle {
        position: static !important;
        order: -1 !important;
        flex-shrink: 0 !important;
      }
      
      /* Partner strip responsive hiding at 760px */
      @media (max-width: 760px) {
        #partner-strip {
          display: none !important;
        }
        
        /* Wrap nav items instead of clipping on narrow screens */
        nav .max-w-7xl {
          flex-wrap: wrap !important;
          height: auto !important;
          min-height: 44px;
          row-gap: 6px !important;
          padding: 6px 12px !important;
        }
      }
      
      /* Ensure right side never clips */
      nav .max-w-7xl > *:last-child {
        margin-left: auto !important;
      }

      /* Polish (Alex 15:05) */
      nav{min-height:52px;border-bottom:1px solid rgba(148,163,184,.12)!important;backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);overflow:visible!important}
      nav, nav .max-w-7xl{gap:20px!important}
      nav .max-w-7xl{min-height:52px}
      nav b:first-of-type, nav .nav-brand{font-weight:800!important;color:#fff!important;letter-spacing:-.01em;padding-right:20px;border-right:1px solid rgba(148,163,184,.2);white-space:nowrap}
      nav a.nav-link{font-size:14.5px!important;font-weight:500!important;color:#94a3b8!important;position:relative;white-space:nowrap;transition:color .15s;padding:15px 0}
      nav a.nav-link:hover{color:#e2e8f0!important}
      @media (max-width:1000px){#partner-strip{display:none!important} nav b:first-of-type{white-space:nowrap!important}}
      @media (max-width:900px){nav, nav .max-w-7xl{gap:14px!important} nav b:first-of-type{padding-right:14px} nav form{min-width:0;flex:1 1 160px!important;width:auto!important}}
      nav a.nav-link.nav-active{color:#fff!important}
      nav a.nav-link.nav-active::after{content:"";position:absolute;left:0;right:0;bottom:8px;height:2px;border-radius:2px;background:#818cf8}
    `;
    document.head.appendChild(style);
  }

  // ========== Initialize ==========
  function init() {
    // Wait for DOM and partners.js to load
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
      return;
    }

    // Observability link
    const nv=document.querySelector('nav');
    if(nv && !nv.querySelector('a[href="/observability"]')){const g=nv.querySelector('a[href="/guide"]');const o=document.createElement('a');o.href='/observability';o.textContent='Observability';if(location.pathname==='/observability')o.className='on';g?g.after(o):nv.appendChild(o);}


    // Nav link classes + active state
    (function(){var routes={"/":"/","/map":"/map","/dashboard":"/dashboard","/slides":"/slides","/guide":"/guide","/observability":"/observability"};var path=location.pathname.replace(/\/+$/,"")||"/";if(path==="/index.html")path="/";document.querySelectorAll("nav a[href]").forEach(function(a){var h=a.getAttribute("href");if(!(h in routes))return;a.classList.add("nav-link");a.classList.toggle("nav-active",path===h||(h!=="/"&&path.indexOf(h+"/")===0));if(a.classList.contains("nav-active"))a.setAttribute("aria-current","page");});})();

    // Logo + favicon
    (function(){var h=document.head;h.querySelectorAll("link[rel~=icon]").forEach(function(l){l.remove();});var f=document.createElement("link");f.rel="icon";f.type="image/svg+xml";f.href="/static/logo.svg";h.appendChild(f);var b=document.querySelector("nav .nav-brand")||document.querySelector("nav b")||[].slice.call(document.querySelectorAll("nav span,nav a,nav div")).find(function(e){return [].some.call(e.childNodes,function(n){return n.nodeType===3&&/Precedent/.test(n.textContent);});});if(b){[].forEach.call(b.childNodes,function(n){if(n.nodeType===3)n.textContent=n.textContent.replace(/^\s*⚖️?\s*/,"");});}if(b&&!document.getElementById("nav-logo")){var i=document.createElement("img");i.id="nav-logo";i.src="/static/logo.svg";i.alt="";i.width=24;i.height=24;i.style.cssText="width:24px;height:24px;border-radius:6px;display:inline-block;vertical-align:-6px;margin-right:9px;flex-shrink:0";b.insertBefore(i,b.firstChild);}})();

    // Fix navbar layout
    fixNavbarLayout();
    if(!document.getElementById('responsive-css')){const l=document.createElement('link');l.id='responsive-css';l.rel='stylesheet';l.href='/static/responsive.css?v=ux1';document.head.appendChild(l);}

    // Add partner strip to nav
    addPartnerStrip();

    // Hide badges on homepage
    hideBadges();

    // Add examples dropdown
    createExamplesDropdown();
  }

  init();
})();
