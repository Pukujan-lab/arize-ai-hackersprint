// Precedent v2 home (/v2): the minimal page.
// Visible by default: the memo (#answer), the existing 3D map (#docs3d) and the bottom composer.
// Sources, follow-ups, legend and run info live in collapsed bottom sheets.
// The map is the existing static/map3d.js, driven through window.Docs3D only.
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var THEME_KEY = "precedent-theme";

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (m) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m];
    });
  }

  function safeUrl(u) {
    var s = String(u == null ? "" : u);
    return /^https?:\/\//i.test(s) && !/[\s"'<>]/.test(s) ? s : "";
  }

  // ---------- theme: dark by default, remembered after a toggle ----------
  var root = document.documentElement;
  var themeBtn = $("theme-toggle");

  function currentTheme() { return root.getAttribute("data-theme") === "light" ? "light" : "dark"; }
  function paintTheme() {
    if (themeBtn) themeBtn.setAttribute("aria-pressed", currentTheme() === "light" ? "true" : "false");
  }
  function setTheme(t) {
    root.setAttribute("data-theme", t);
    try { localStorage.setItem(THEME_KEY, t); } catch (e) { /* private mode */ }
    paintTheme();
  }
  paintTheme();
  if (themeBtn) themeBtn.addEventListener("click", function () { setTheme(currentTheme() === "light" ? "dark" : "light"); });

  // ---------- bottom sheets: one at a time ----------
  var SHEETS = ["sources-panel", "followups-panel", "legend-panel", "runinfo-panel"];
  var backdrop = $("sheet-backdrop");

  function closeSheets() {
    SHEETS.forEach(function (id) { var el = $(id); if (el) el.hidden = true; });
    if (backdrop) backdrop.hidden = true;
    document.querySelectorAll("[data-sheet]").forEach(function (b) { b.setAttribute("aria-expanded", "false"); });
  }

  function openSheet(id) {
    closeSheets();
    var el = $(id);
    if (!el) return;
    el.hidden = false;
    if (backdrop) backdrop.hidden = false;
    document.querySelectorAll('[data-sheet="' + id + '"]').forEach(function (b) { b.setAttribute("aria-expanded", "true"); });
  }

  function toggleSheet(id) {
    var el = $(id);
    if (el && !el.hidden) closeSheets(); else openSheet(id);
  }

  ["sources-panel", "followups-panel", "legend-panel", "runinfo-panel"].forEach(function (id) {
    var btn = document.querySelector('[data-sheet="' + id + '"]');
    if (btn) btn.addEventListener("click", function () { if (id === "runinfo-panel") fillRunInfo(); toggleSheet(id); });
  });
  document.querySelectorAll("[data-close]").forEach(function (b) { b.addEventListener("click", closeSheets); });
  if (backdrop) backdrop.addEventListener("click", closeSheets);
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    if (pv && !pv.hidden) hidePreview(); else closeSheets();
  });

  // ---------- phones and tablets under 900px: one full-height pane at a time ----------
  // The Answer / Map buttons swap panes; so does a left/right swipe in the BOTTOM THIRD of a pane.
  // The top two thirds are left alone, because that is where the map is dragged.
  var mainEl = document.querySelector(".v2-main");
  var mapCol = document.querySelector(".v2-mapcol");
  var mapWrap = document.querySelector(".v2-mapwrap");
  var paneTabs = [].slice.call(document.querySelectorAll("[data-pane]"));
  var paneMQ = window.matchMedia ? window.matchMedia("(max-width: 899px)") : null;

  function isMobile() { return !!(paneMQ && paneMQ.matches); }

  function setPane(p) {
    if (!mainEl) return;
    var want = p === "map" ? "map" : "answer";
    mainEl.setAttribute("data-mobile-pane", want);
    paneTabs.forEach(function (b) {
      var on = b.getAttribute("data-pane") === want;
      b.setAttribute("aria-selected", on ? "true" : "false");
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    if (want === "answer") hidePreview();
  }

  function watchSwipe(el) {
    if (!el) return;
    var start = null;
    el.addEventListener("touchstart", function (e) {
      var t = e.changedTouches && e.changedTouches[0];
      start = t && isMobile() ? { x: t.clientX, y: t.clientY } : null;
    }, { passive: true });
    el.addEventListener("touchcancel", function () { start = null; }, { passive: true });
    el.addEventListener("touchend", function (e) {
      var s = start, t = e.changedTouches && e.changedTouches[0];
      start = null;
      if (!s || !t || !isMobile()) return;
      var r = el.getBoundingClientRect();
      if (!r.height) return;
      if ((s.y - r.top) / r.height < 0.66) return;                 // top of the pane: not a pane switch
      var dx = t.clientX - s.x, dy = t.clientY - s.y;
      if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.4) return;  // a tap, or a vertical scroll
      setPane(dx < 0 ? "map" : "answer");
    }, { passive: true });
  }

  // ---------- slim preview strip at the top of the map ----------
  // One line — case, court, year, Read, Source. Read expands the strip downward in place.
  var pv = $("pin-preview");
  var pvTitle = pv ? pv.querySelector(".v2-preview-title") : null;
  var pvMeta = pv ? pv.querySelector(".v2-preview-meta") : null;
  var pvText = pv ? pv.querySelector(".v2-preview-text") : null;
  var pvRead = pv ? pv.querySelector("[data-preview-read]") : null;
  var pvSource = pv ? pv.querySelector("[data-preview-source]") : null;
  var pvCite = null, pvExpanded = false, pvGuard = false, userReading = false;

  function hidePreview() {
    pvGuard = false;
    if (pv) pv.hidden = true;
    pvCite = null; pvExpanded = false;
    if (pvText) pvText.textContent = "";
    if (pvRead) { pvRead.textContent = "Read"; pvRead.setAttribute("aria-expanded", "false"); }
  }

  // Court and year only: the strip never carries the bare [n] badge.
  function showPreview(c) {
    if (!pv || !c) return;
    pvCite = c; pvExpanded = false;
    if (pvTitle) pvTitle.textContent = c.title || "Source";
    if (pvMeta) pvMeta.textContent = [c.court || "", String(c.date || "").slice(0, 4)].filter(Boolean).join(" · ");
    if (pvText) pvText.textContent = "";
    if (pvRead) { pvRead.textContent = "Read"; pvRead.setAttribute("aria-expanded", "false"); }
    pv.hidden = false;
    pvGuard = true;                                   // the tap that opened this strip is still bubbling
    setTimeout(function () { pvGuard = false; }, 0);
    if (isMobile()) setPane("map");
  }

  // A short strip stays a short strip: the passage is trimmed, and the strip itself scrolls if the
  // text is still taller than its box, so it never reaches the tour stack parked below it.
  function passageOf(c) {
    var raw = String(c.passage || "");
    if (!raw) return "No passage stored for this source.";
    var p = raw;
    if (window.cleanPassage) {
      try { p = String(window.cleanPassage(raw, input ? input.value : "")) || raw; } catch (e) { p = raw; }
    }
    return p.length > 360 ? p.slice(0, 360).replace(/\s\S*$/, "") + "…" : p;
  }

  if (pvRead) pvRead.addEventListener("click", function () {
    if (!pvCite) return;
    pvExpanded = !pvExpanded;
    if (pvText) pvText.textContent = pvExpanded ? passageOf(pvCite) : "";
    if (pvRead) {
      pvRead.textContent = pvExpanded ? "Hide" : "Read";
      pvRead.setAttribute("aria-expanded", pvExpanded ? "true" : "false");
    }
  });

  // Source opens the Sources panel on that source's own card.
  if (pvSource) pvSource.addEventListener("click", function () {
    if (!pvCite) return;
    var c = pvCite;
    hidePreview();
    openSheet("sources-panel");
    var i = ((lastResult && lastResult.citations) || []).indexOf(c);
    var card = i >= 0 ? document.querySelector('#cites [data-src="' + i + '"]') : null;
    if (card) { try { card.scrollIntoView({ block: "center" }); } catch (e) { card.scrollIntoView(); } }
  });

  // A click on the map, outside the strip, closes it.
  if (mapWrap) mapWrap.addEventListener("click", function (e) {
    if (!pv || pv.hidden || pvGuard) return;
    var t = e.target;
    if (t && t.closest && t.closest("#pin-preview")) return;
    hidePreview();
  });

  function citeForRef(n) {
    var arr = (lastResult && lastResult.citations) || [];
    for (var i = 0; i < arr.length; i++) {
      if (String(arr[i].ref || "").replace(/\D/g, "") === String(n)) return arr[i];
    }
    return arr[n - 1] || null;
  }

  // A pin or county tap means the reader wants to look at that source, so the slim strip answers it
  // on phones and on desktop alike and the map's own big source card stays shut. The card is still
  // reachable from the strip's Source button and from the Sources sheet.
  function onCiteTap(c) {
    showPreview(c);
    return true;
  }
  if (window.Docs3D) window.Docs3D.onCiteTap = onCiteTap;

  paneTabs.forEach(function (b) {
    b.addEventListener("click", function () { setPane(b.getAttribute("data-pane")); });
  });
  watchSwipe($("answer"));
  watchSwipe(mapCol);
  setPane(mainEl ? mainEl.getAttribute("data-mobile-pane") : "answer");

  // ---------- map helpers (static/map3d.js loads as a module, so it arrives late) ----------
  // window.Docs3D starts as a set of no-op stubs; the real API is filled in once the map has
  // built its scene. explainText (3D) and #pins2 (SVG fallback) only exist after that swap.
  function mapReady() {
    var D = window.Docs3D, host = $("docs3d");
    if (!D || !host) return false;
    return typeof D.explainText === "function" || !!host.querySelector("#pins2");
  }

  function onMapReady(cb, tries) {
    if (mapReady()) { cb(window.Docs3D); return; }
    var left = tries === undefined ? 80 : tries;
    if (left <= 0) return;
    setTimeout(function () { onMapReady(cb, left - 1); }, 250);
  }

  // The map's tap hook goes in as soon as its API exists (it is a module, so it arrives late).
  onMapReady(function (D) { D.onCiteTap = onCiteTap; });

  var tourBtn = $("tour-btn");
  if (tourBtn) {
    tourBtn.addEventListener("click", function () {
      if (!mapReady()) return;
      var D = window.Docs3D;
      try { D.stopTour && D.stopTour(); D.tour(0); } catch (e) { /* map not ready */ }
    });
  }

  // ---------- composer ----------
  var form = $("ask-form");
  var input = $("q");
  var go = $("go");
  var hint = $("v2-hint");
  var answerEl = $("answer");
  var hintTimer = null;

  function showHint(msg) {
    if (!hint) return;
    hint.textContent = msg;
    hint.hidden = false;
    clearTimeout(hintTimer);
    hintTimer = setTimeout(function () { hint.hidden = true; }, 4000);
  }

  function setBusy(on) {
    if (go) go.disabled = on;
  }

  if (form) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      ask(input ? input.value : "");
    });
  }

  // ---------- markdown (escape first, then a small whitelist) ----------
  // A source link shows one glyph, never the bare number: ↗ when the citation has a source URL,
  // › when it has none. Both carry data-ref, so one tap handler covers either form.
  function inline(t, byRef) {
    var s = esc(t)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/`([^`]+)`/g, "<code>$1</code>");
    return s.replace(/\[(\d+)\]/g, function (m, n) {
      var c = (byRef && (byRef["[" + n + "]"] || byRef[n] || byRef[String(n)])) || null;
      if (!c) return m;
      var title = esc(c.title || "");
      var label = esc(c.title ? "Open source: " + c.title : "Open citation " + n);
      var u = safeUrl(c.url);
      var ref = ' data-ref="' + esc(n) + '"';
      return u
        ? '<a class="v2-ref" href="' + esc(u) + '"' + ref + ' target="_blank" rel="noopener noreferrer" title="' + title + '" aria-label="' + label + '">↗</a>'
        : '<button class="v2-ref" type="button"' + ref + ' title="' + title + '" aria-label="' + label + '">›</button>';
    });
  }

  function md(src, byRef) {
    var lines = String(src == null ? "" : src).replace(/\r/g, "").split("\n");
    var out = "", list = null, para = [], quote = [];
    var flushPara = function () { if (para.length) { out += "<p>" + inline(para.join(" "), byRef) + "</p>"; para = []; } };
    var flushList = function () { if (list) { out += "</" + list + ">"; list = null; } };
    var flushQuote = function () { if (quote.length) { out += "<blockquote>" + inline(quote.join(" "), byRef) + "</blockquote>"; quote = []; } };
    lines.forEach(function (raw) {
      var l = raw.trim(), m;
      if (!l) { flushPara(); flushList(); flushQuote(); return; }
      if ((m = l.match(/^#{1,4}\s+(.*)$/))) { flushPara(); flushList(); flushQuote(); out += "<h3>" + inline(m[1], byRef) + "</h3>"; return; }
      if ((m = l.match(/^>\s?(.*)$/))) { flushPara(); flushList(); quote.push(m[1]); return; }
      if ((m = l.match(/^(?:[-*•]|\d+[.)])\s+(.*)$/))) {
        flushPara(); flushQuote();
        var kind = /^\d/.test(l) ? "ol" : "ul";
        if (list !== kind) { flushList(); out += "<" + kind + ">"; list = kind; }
        out += "<li>" + inline(m[1], byRef) + "</li>";
        return;
      }
      flushList(); flushQuote(); para.push(l);
    });
    flushPara(); flushList(); flushQuote();
    return out;
  }

  // ---------- ask: POST /api/ask, then poll GET /api/run/{rid} ----------
  var running = false, lastRun = null, lastResult = null;
  var renderRun = 0;     // per-render token: a stale summary can never start a newer run's tour
  var narrating = false; // the memo's summary line is being spoken: keep the map voice held

  function isFollow(q) {
    return /^(and|but|so|also|what if|what about|how about|then|does (that|this|it)|can (they|i still)|is (that|this|it))\b/i.test(q) ||
      /\b(this|that|it|they|them|those|here|above)\b[?.!]*$/i.test(q);
  }

  function ask(text, asFollow) {
    var q = String(text == null ? "" : text).trim();
    if (!q) { showHint("Type a question first."); if (input) input.focus(); return Promise.resolve(null); }
    if (running) return Promise.resolve(null);
    running = true;
    setBusy(true);
    closeSheets();
    hidePreview();
    showListenBar(false);        // no memo on screen yet, so nothing to listen to
    if (answerEl) answerEl.innerHTML = '<p class="v2-working">Agents working…</p>';
    if (mapReady()) { try { window.Docs3D.holdVoice = true; window.Docs3D.busy(); } catch (e) { /* no map */ } }

    var body = { question: q };
    if (lastRun && (asFollow || isFollow(q))) body.prev_run_id = lastRun;

    return fetch("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok) {
          if (answerEl) answerEl.innerHTML = '<p class="v2-err">' + esc(res.j && res.j.error ? res.j.error : "Something went wrong. Try again.") + "</p>";
          return null;
        }
        return poll(res.j.run_id);
      })
      .catch(function () {
        if (answerEl) answerEl.innerHTML = '<p class="v2-err">Network problem. Try again.</p>';
      })
      .then(function (v) {
        running = false;
        setBusy(false);
        // while the summary is being spoken the voice stays held, so the map cannot start a tour
        if (window.Docs3D && !narrating) { try { window.Docs3D.holdVoice = false; } catch (e) { /* no map */ } }
        return v;
      });
  }

  function poll(rid) {
    var started = Date.now();
    function again(ms) {
      if (Date.now() - started > 180000) {
        if (answerEl) answerEl.innerHTML = '<p class="v2-err">This is taking too long. Try again.</p>';
        return null;
      }
      return new Promise(function (res) { setTimeout(res, ms); }).then(step);
    }
    function step() {
      return fetch("/api/run/" + encodeURIComponent(rid))
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d && d.result) { render(d.result); return null; }
          if (d && d.partial && answerEl) {
            answerEl.innerHTML = md(d.partial, {}) + '<span class="v2-caret">▍</span>';
            answerEl.scrollTop = 0;
          }
          return again(d && d.partial ? 200 : 350);
        })
        .catch(function () { return again(800); });
    }
    return step();
  }

  function render(r) {
    lastRun = r.run_id || lastRun;
    lastResult = r;
    userReading = false;        // a new memo starts a fresh walk; a citation tap stops it again
    var token = ++renderRun;
    var byRef = {};
    (r.citations || []).forEach(function (c) { byRef[c.ref] = c; });
    if (answerEl) {
      answerEl.innerHTML = md(r.answer, byRef);
      answerEl.scrollTop = 0;
    }
    showListenBar(!!(r && r.answer));   // the memo is on screen: the reader can hear it again
    renderSources(r);
    renderFollowups(r);
    fillRunInfo();
    onMapReady(function () { startTourOnMap(r, token); });
  }

  // The short answer line the memo is read out with (same rule as the old page).
  function shortLine(a) {
    var l = String(a == null ? "" : a).split("\n").map(function (x) { return x.trim(); }).filter(Boolean);
    var t = l.filter(function (x) { return /short answer/i.test(x); })[0] || l[0] || "";
    t = t.replace(/\*\*?short answer:?\*\*?:?/i, "").replace(/\[\d+\]/g, "").replace(/[*#>`_]/g, "").replace(/\s+/g, " ").trim();
    return t.length > 300 ? t.slice(0, 300).replace(/\s\S*$/, "") + "." : t;
  }

  // Memo first, the summary line is spoken next, and only then does the tour start at stop 1.
  // No tour clip is requested or played before the summary clip.
  function startTourOnMap(r, token) {
    var D = window.Docs3D;
    if (!D) return;
    try {
      D.ctx = { answer: r.answer || "", question: r.question || "" };
      D.holdVoice = true;               // the map keeps quiet while the summary is heard
      D.show(r.citations || [], r.edges || [], r.documents || []);
      D.stopTour && D.stopTour();       // an older tour must not run under the new memo
    } catch (e) { return; }
    speakThenTour(r, token);
  }

  // The shared starter: the stored summary is spoken first and the tour begins only when that clip
  // is done. A fresh memo and the Listen button both come through here, so a replay follows
  // exactly the same order as the first read. The question is never asked again.
  function speakThenTour(r, token) {
    var D = window.Docs3D;
    var M = window.AudioMgr;
    if (!D) return;
    var line = (M && !M.isMuted() && D.voice !== false) ? shortLine(r.answer) : "";
    if (!line) { beginTour(token); return; }   // no voice: caption tour right away
    narrating = true;
    var after = function () { narrating = false; beginTour(token); };
    try { Promise.resolve(M.say(line)).then(after, after); } catch (e) { after(); }
  }

  function beginTour(token) {
    if (token !== renderRun) return;    // a newer question took over while this summary played
    var D = window.Docs3D;
    if (!D) return;
    // The summary finished after the reader opened a source from the memo: the walk stays stopped.
    // Releasing the hold and stopping again clears any autostart the map still has pending.
    if (userReading) { try { D.holdVoice = false; D.stopTour && D.stopTour(); } catch (e) { /* no map */ } return; }
    try { D.holdVoice = false; D.tour(0); } catch (e) { /* map not ready */ }
  }

  // ---------- Listen: hear the memo again the way it was read the first time ----------
  // One control, on the answer (never in the tour bar). It reuses the starter above: the stored
  // result's summary is spoken first, then the existing tour runs from stop 1. Nothing is re-asked.
  var listenHead = document.querySelector(".v2-answer-head");
  var listenBtn = $("listen-btn");
  var listening = false, listenIdle = 0;

  function setListen(on) {
    listening = !!on;
    listenIdle = 0;
    if (!listenBtn) return;
    listenBtn.textContent = listening ? "Stop" : "Listen";
    listenBtn.setAttribute("aria-pressed", listening ? "true" : "false");
  }

  // The bar belongs to a memo: it shows once an answer is on screen and goes when a new question
  // runs. Either way it starts out saying "Listen" — only a press of the button means "Stop".
  function showListenBar(on) {
    setListen(false);
    if (listenHead) listenHead.hidden = !on;
  }

  // Is anything still being heard? A clip playing, the summary still queued, or the map's own play
  // button reading "Pause". Cheap on purpose: it reads state the page already has, no new machinery.
  function hearing() {
    var M = window.AudioMgr;
    try { if (M && (M.playing() || M.saying)) return true; } catch (e) { /* no audio manager */ }
    if (narrating) return true;
    var pb = document.querySelector('#tour-controls [data-tour="play"]');
    return !!(pb && /Pause/.test(pb.textContent || ""));
  }

  // The walk ends by itself; a few beats of silence puts the button back to "Listen".
  setInterval(function () {
    if (!listening) return;
    if (hearing()) { listenIdle = 0; return; }
    listenIdle += 1;
    if (listenIdle >= 12) setListen(false);            // 12 × 250 ms with nothing playing
  }, 250);

  showListenBar(false);

  if (listenBtn) listenBtn.addEventListener("click", function () {
    if (listening) {                                   // pressed again: stop the audio and the tour
      setListen(false);
      try { window.AudioMgr && AudioMgr.stopAll(); } catch (e) { /* no audio manager */ }
      try { window.Docs3D && Docs3D.stopTour && Docs3D.stopTour(); } catch (e) { /* no map */ }
      return;
    }
    var r = lastResult;
    if (!r || !mapReady()) { showHint("Ask a legal question first."); return; }
    var D = window.Docs3D;
    userReading = false;                               // this press asks for the walk, it does not end it
    var token = ++renderRun;                           // any older pending autoplay is now void
    try { if (window.AudioMgr) AudioMgr.failedAt = 0; } catch (e) { /* an old failure must not mute this */ }
    setListen(true);
    try { D.ctx = { answer: r.answer || "", question: r.question || "" }; D.holdVoice = true; } catch (e) { return; }
    speakThenTour(r, token);
  });

  // ---------- sources ----------
  var citesEl = $("cites");

  function renderSources(r) {
    if (!citesEl) return;
    var list = r.citations || [];
    if (!list.length) {
      citesEl.innerHTML = '<li class="v2-empty">No sources for this run.</li>';
      return;
    }
    citesEl.innerHTML = list.map(function (c, i) {
      var labels = window.citeLabels ? window.citeLabels(c) : { type: c.type || "Authority", jurisdiction: c.court || "Jurisdiction not given" };
      var passage = c.passage
        ? String(window.cleanPassage ? window.cleanPassage(c.passage, input ? input.value : "") : c.passage).slice(0, 300)
        : "";
      var note = window.citeNote ? window.citeNote(c) : "";
      var links = window.caseLinks ? window.caseLinks(c) : "";
      return '<li class="v2-src">' +
        '<div class="v2-src-head">' +
          '<button type="button" class="v2-src-ref" data-src="' + i + '" aria-label="Open source ' + esc(c.ref || String(i + 1)) + ' on the map">' + esc(c.ref || String(i + 1)) + "</button>" +
          '<span class="v2-src-title">' + esc(c.title || "Untitled source") + "</span>" +
        "</div>" +
        '<div class="v2-src-meta">' + esc(labels.type) + " · " + esc(labels.jurisdiction) + (c.date ? " · " + esc(String(c.date)) : "") + "</div>" +
        (passage ? '<blockquote class="v2-quote">' + esc(passage) + "</blockquote>" : (note ? '<p class="v2-src-note">' + esc(note) + "</p>" : "")) +
        links +
        "</li>";
    }).join("");
  }

  if (citesEl) {
    citesEl.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-src]");
      if (!btn || !lastResult) return;
      var i = parseInt(btn.getAttribute("data-src"), 10);
      var c = (lastResult.citations || [])[i];
      if (!c || !mapReady()) return;
      closeSheets();
      try { window.Docs3D.jump(i); window.Docs3D.open && window.Docs3D.open(c); } catch (err) { /* map not ready */ }
    });
  }

  // ---------- follow-ups ----------
  var chipsEl = $("fu-chips");

  function suggest(r) {
    var t = String((r.question || "") + " " + (r.answer || "")).toLowerCase();
    var out = [];
    if (/search|warrant|police|vehicle|traffic|suppress/.test(t)) out.push("What if the officer finds evidence anyway?", "Can I refuse a search?");
    if (/landlord|tenant|deposit|evict/.test(t)) out.push("What can the tenant recover?", "What notice is required?");
    if (/water|appropriat|ditch|priority/.test(t)) out.push("How is a senior call enforced?");
    var named = (r.citations || []).find(function (c) { return c.ref && /v\./.test(c.title || ""); });
    if (named) out.push("How does " + String(named.title || "").split(",")[0].slice(0, 44) + " apply here?");
    out.push("What are the main exceptions?", "What should I check before relying on this?");
    var seen = {};
    return out.filter(function (x) { if (seen[x]) return false; seen[x] = 1; return true; }).slice(0, 3);
  }

  function renderFollowups(r) {
    if (!chipsEl) return;
    chipsEl.innerHTML = "";
    suggest(r).forEach(function (text) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "v2-chip";
      b.textContent = text;
      b.addEventListener("click", function () {
        if (input) input.value = text;
        ask(text, true);
      });
      chipsEl.appendChild(b);
    });
  }

  // ---------- run info ----------
  function fillRunInfo() {
    var box = $("runinfo-body");
    if (!box) return;
    if (!lastResult) { box.innerHTML = '<p class="v2-empty">No run yet.</p>'; return; }
    var r = lastResult;
    var sg = r.safeguard || {};
    var cnt = document.getElementById("cnt");
    var rows = [
      ["Run", r.run_id || ""],
      ["Model", r.provider || ""],
      ["Time", r.elapsed_s != null ? r.elapsed_s + "s" : ""],
      ["Sources", String((r.citations || []).length)],
      ["Safeguard", sg.pass ? "passed" : "check the flagged citations"],
      ["Map", cnt ? String(cnt.textContent || "") : ""]
    ].filter(function (row) { return row[1]; });
    box.innerHTML = '<dl class="v2-dl">' + rows.map(function (row) {
      return "<dt>" + esc(row[0]) + "</dt><dd>" + esc(row[1]) + "</dd>";
    }).join("") + "</dl>";
  }

  // A memo citation tap means the reader stopped walking: the tour halts, its caption goes away,
  // and a summary still being spoken no longer autostarts it behind the strip. The map's own
  // controls (Tour pill, prev / next, pins) are untouched and still start a stop.
  function stopTourForPreview() {
    userReading = true;                 // the pending autoplay (if any) must not start behind the strip
    setListen(false);                   // the walk is over, so the Listen button says Listen again
    var D = window.Docs3D;
    if (D) { try { D.stopTour && D.stopTour(); } catch (e) { /* no map */ } }
    var tr = document.getElementById("transcript");
    if (tr) tr.classList.add("hidden");
  }

  // A citation in the memo (link or button) opens the slim strip and nothing else: it never
  // navigates to the external source and never starts the tour behind the strip. The source
  // stays reachable through the strip's Source button, which opens that card in Sources.
  if (answerEl) {
    answerEl.addEventListener("click", function (e) {
      var ref = e.target.closest && e.target.closest(".v2-ref");
      if (!ref) return;
      e.preventDefault();
      var n = parseInt(ref.getAttribute("data-ref"), 10);
      if (!n) return;
      var c = citeForRef(n);
      if (!c) return;
      stopTourForPreview();
      showPreview(c);
    });
  }

  window.PRECEDENT_V2 = { ask: function (t) { return ask(t, false); }, theme: currentTheme, setTheme: setTheme };
})();
