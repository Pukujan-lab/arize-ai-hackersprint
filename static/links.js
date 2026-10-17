// Client-side research links + passage cleanup (no API calls).
// Label helpers (window.citeType / citeJurisdiction / citeLabels / citeNote) give every citation card a
// readable type and jurisdiction when a graph-linked authority arrives with neither (#61).
(function () {
  const ENC = encodeURIComponent;
  const HTTP = /^https?:\/\//i;
  // Values that carry no information: treated as "not given" so no card ever prints them.
  const BLANKISH = /^(unknown|n\/?a|none|null|undefined|\?+|-+|—)$/i;
  const CFR = /(^|[^a-z])c\.? ?f\.? ?r\b/i;
  const USC = /\bu\.? ?s\.? ?c\b/i;
  const CRS = /\bc\.? ?r\.? ?s\b/i;
  const NO_PASSAGE = "Linked through the citation graph; no passage on file.";

  const txt = (v) => String(v == null ? "" : v).trim();
  const given = (v) => {
    const t = txt(v);
    return t && !BLANKISH.test(t) ? t : "";
  };
  const hay = (c) => [txt(c && c.id), txt(c && c.title), txt(c && c.citation), txt(c && c.cite)].join(" ");
  const esc = (s) =>
    String(s == null ? "" : s).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[m]);

  // Readable type label: the real type when it says something, else inferred from the id or title.
  function citeType(c) {
    c = c || {};
    const t = given(c.type);
    if (t) {
      const s = t.replace(/_/g, " ").replace(/\s+/g, " ").trim();
      if (/^case\s*law$/i.test(s) || /^caselaw$/i.test(s) || /^case$/i.test(s)) return "Case";
      return s.charAt(0).toUpperCase() + s.slice(1);
    }
    const H = hay(c),
      id = txt(c.id);
    if (/^statute:/i.test(id) || CRS.test(H)) return "Statute";
    if (CFR.test(H)) return "Federal regulation";
    if (USC.test(H)) return "Federal statute";
    if (/\sv\./i.test(H)) return "Case";
    return "Authority";
  }

  // Where it was decided: the court when given, else inferred; never blank.
  function citeJurisdiction(c) {
    c = c || {};
    const court = given(c.court);
    if (court) return court;
    const H = hay(c);
    if (CFR.test(H) || USC.test(H)) return "Federal";
    if (CRS.test(H) || /colorado/i.test(H)) return "Colorado";
    return "Jurisdiction not given";
  }

  function citeRealUrl(c) {
    const u = txt(c && c.url);
    return HTTP.test(u) && !/["'\s<>]/.test(u) ? u : "";
  }
  function citePassage(c) {
    return given(c && c.passage);
  }
  // Short note shown instead of a link when we have neither a passage nor a real source URL.
  function citeNote(c) {
    return !citePassage(c) && !citeRealUrl(c) ? NO_PASSAGE : "";
  }
  function citeLabels(c) {
    return { type: citeType(c), jurisdiction: citeJurisdiction(c) };
  }
  // The [n] digits, for data-ref on a citation card.
  function citeRef(c) {
    return txt(c && c.ref).replace(/\D/g, "");
  }

  window.citeType = citeType;
  window.citeJurisdiction = citeJurisdiction;
  window.citeLabels = citeLabels;
  window.citeRealUrl = citeRealUrl;
  window.citePassage = citePassage;
  window.citeNote = citeNote;
  window.citeRef = citeRef;
  window.citeNoPassageText = NO_PASSAGE;
  window.citeEsc = esc;

  window.caseLinks = function (c, cls) {
    c = c || {};
    const u = citeRealUrl(c),
      name = txt(c.title),
      cite = txt(c.citation) || txt(c.cite),
      H = name + " " + cite;
    // Nothing on file: no honest page to point at, so offer no link (the card shows citeNote instead).
    if (!u && !citePassage(c)) return "";
    const kind = citeType(c),
      fed = /federal/i.test(kind) || CFR.test(H) || USC.test(H),
      st = /statute|regulation/i.test(kind) || /C\.?R\.?S\.?|§/.test(H);
    const L = st
      ? [["Read statute", u || "https://www.google.com/search?q=" + ENC((cite || name) + (fed ? "" : " Colorado Revised Statutes"))]]
      : [["Full opinion", u || "https://www.courtlistener.com/?q=" + ENC(cite || name)]];
    const s =
      cls ||
      "display:inline-block;margin:6px 6px 0 0;padding:3px 10px;border-radius:999px;border:1px solid rgba(129,140,248,.6);color:#a5b4fc;font-size:12px;text-decoration:none";
    return L.map(([t, url]) => `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer" style="${s}">${t} ↗</a>`).join("");
  };

  window.cleanPassage = function (text, q, max) {
    max = max || 300;
    q = q || (document.getElementById("q") || {}).value || "";
    const stop = new Set("the a an of to in for and or on is be by with under without from that this what when can does".split(" "));
    const terms =
      q
        .toLowerCase()
        .split(/\W+/)
        .filter((w) => w.length > 2 && !stop.has(w));
    const parts = String(text || "")
      .split(/\n+|(?<=[.;:])\s+(?=[A-Z“"(])/)
      .map((x) => x.trim())
      .filter((x) => x.length >= 60 && !/^([IVXLC]+|[A-Z]|\d+)\.\s*\S{0,30}$/.test(x) && !/\|\s*(Supreme|Court|Colorado)/.test(x));
    if (!parts.length) return "";
    let best = parts[0],
      bs = -1;
    parts.forEach((p, i) => {
      const l = p.toLowerCase();
      const sc = terms.reduce((a, t) => a + (l.includes(t) ? 1 : 0), 0) - i * 0.01;
      if (sc > bs) {
        bs = sc;
        best = p;
      }
    });
    const i = parts.indexOf(best);
    let out = best;
    for (let j = i + 1; j < parts.length && out.length < max * 0.7; j++) out += " " + parts[j];
    if (out.length <= max) return out;
    let cut = out.slice(0, max);
    const se = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("; "));
    cut = se > max * 0.5 ? cut.slice(0, se + 1) : cut.slice(0, cut.lastIndexOf(" ")) + "…";
    return cut;
  };
})();
