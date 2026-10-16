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

    // Add media query to hide below 900px
    const style = document.createElement('style');
    style.textContent = '@media (max-width: 899px) { #partner-strip { display: none !important; } }';
    document.head.appendChild(style);

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
    menu.style.cssText = 'display:none;position:absolute;z-index:50;background:rgba(30,41,59,0.95);border:1px solid rgba(99,102,241,0.3);border-radius:0.75rem;backdrop-filter:blur(12px);margin-top:0.5rem;min-width:400px;max-width:600px;box-shadow:0 10px 25px rgba(0,0,0,0.5);';

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
    menuContainer.appendChild(menu);

    // Insert after the go button or form
    let insertTarget = goButton || (form && form.querySelector('button'));
    if (insertTarget && insertTarget.parentElement) {
      insertTarget.parentElement.insertBefore(menuContainer, insertTarget.nextSibling);
      // Add spacing
      menuContainer.style.marginLeft = '0.75rem';
    }

    // Menu state management
    function openMenu() {
      menu.style.display = 'block';
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
      if (!menuContainer.contains(e.target)) {
        closeMenu();
      }
    });

    // Close on focus outside
    document.addEventListener('focusin', (e) => {
      if (!menuContainer.contains(e.target)) {
        closeMenu();
      }
    });
  }

  // ========== Initialize ==========
  function init() {
    // Wait for DOM and partners.js to load
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
      return;
    }

    // Add partner strip to nav
    addPartnerStrip();

    // Hide badges on homepage
    hideBadges();

    // Add examples dropdown
    createExamplesDropdown();
  }

  init();
})();
