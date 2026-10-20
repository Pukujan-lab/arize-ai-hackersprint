// Citation → map location, and link typing. This is the parity reference behaviour: the same
// keys, categories and labels the previous map produced for the same run data.

export type Citation = {
  id: string;
  ref?: string;
  title?: string;
  court?: string | null;
  date?: string | null;
  type?: string;
  citation?: string;
  passage?: string;
  origin_text?: string;
  url?: string;
  /** The metadata fields the record does not carry, named so the page can say which is missing. */
  missing?: string[];
};

export type Edge = { src: string; dst: string };

/** What the citation check reports about one run. */
export type Safeguard = {
  pass?: boolean;
  used?: string[];
  invalid?: string[];
  unknown_authorities?: string[];
  unsupported_claims?: string[];
  disclaimer?: string;
};

export type RunResult = {
  run_id?: string;
  question?: string;
  answer?: string;
  citations?: Citation[];
  edges?: Edge[];
  provider?: string;
  elapsed_s?: number;
  safeguard?: Safeguard;
  followups?: string[];
  /** The retrieval record as the run wrote it; `toRetrieval` in `lib/runs` reads it. */
  retrieval?: unknown;
};

export type Category = "county" | "state" | "statute" | "federal";

export type Location = {
  key: string;
  ll: [number, number];
  label: string;
  cat: Category;
  /** The deciding court, as the record names it, so a pin and its label agree with the source list. */
  court: string;
  up?: boolean;
};

const DENVER: [number, number] = [39.7393, -104.9897];
const CAPITOL: [number, number] = [39.7392, -104.9848];
const DC: [number, number] = [38.8906, -77.0044];

// County seats: [lat, lon, seat name]. Labels read "Boulder County (Boulder) → …".
const SEATS: Record<string, [number, number, string]> = {
  adams: [39.9853, -104.8205, "Brighton"],
  alamosa: [37.4695, -105.87, "Alamosa"],
  arapahoe: [39.6133, -105.0166, "Littleton"],
  archuleta: [37.2694, -107.0098, "Pagosa Springs"],
  baca: [37.4086, -102.6141, "Springfield"],
  bent: [38.0717, -103.2227, "Las Animas"],
  boulder: [40.015, -105.2705, "Boulder"],
  broomfield: [39.9205, -105.0867, "Broomfield"],
  chaffee: [38.5347, -105.9989, "Salida"],
  cheyenne: [38.8214, -102.353, "Cheyenne Wells"],
  "clear creek": [39.7055, -105.6972, "Georgetown"],
  conejos: [37.0886, -106.0192, "Conejos"],
  costilla: [37.2003, -105.4239, "San Luis"],
  crowley: [38.2181, -103.7563, "Ordway"],
  custer: [38.135, -105.4664, "Westcliffe"],
  delta: [38.7422, -108.069, "Delta"],
  denver: [39.7393, -104.9897, "Denver"],
  dolores: [37.7664, -108.9062, "Dove Creek"],
  douglas: [39.3722, -104.8561, "Castle Rock"],
  eagle: [39.6553, -106.8287, "Eagle"],
  elbert: [39.2836, -104.5225, "Kiowa"],
  "el paso": [38.8339, -104.8214, "Colorado Springs"],
  fremont: [38.4411, -105.2422, "Cañon City"],
  garfield: [39.5505, -107.3248, "Glenwood Springs"],
  gilpin: [39.8019, -105.5139, "Central City"],
  grand: [40.0733, -106.1031, "Hot Sulphur Springs"],
  gunnison: [38.5458, -106.9253, "Gunnison"],
  hinsdale: [38.03, -107.3153, "Lake City"],
  huerfano: [37.6239, -104.7803, "Walsenburg"],
  jackson: [40.7319, -106.2837, "Walden"],
  jefferson: [39.7555, -105.2211, "Golden"],
  kiowa: [38.4811, -102.781, "Eads"],
  "kit carson": [39.3058, -102.2694, "Burlington"],
  lake: [39.2508, -106.2925, "Leadville"],
  "la plata": [37.2753, -107.8801, "Durango"],
  larimer: [40.5853, -105.0844, "Fort Collins"],
  "las animas": [37.1695, -104.5005, "Trinidad"],
  lincoln: [39.1361, -103.4697, "Hugo"],
  logan: [40.6255, -103.2077, "Sterling"],
  mesa: [39.0639, -108.5506, "Grand Junction"],
  mineral: [37.8497, -106.9264, "Creede"],
  moffat: [40.5153, -107.5464, "Craig"],
  montezuma: [37.3489, -108.5859, "Cortez"],
  montrose: [38.4783, -107.8762, "Montrose"],
  morgan: [40.2503, -103.7999, "Fort Morgan"],
  otero: [37.9853, -103.5438, "La Junta"],
  ouray: [38.0228, -107.6714, "Ouray"],
  park: [39.2247, -106.002, "Fairplay"],
  phillips: [40.5836, -102.3024, "Holyoke"],
  pitkin: [39.1911, -106.8175, "Aspen"],
  prowers: [38.0872, -102.6208, "Lamar"],
  pueblo: [38.2544, -104.6091, "Pueblo"],
  "rio blanco": [40.0372, -107.9131, "Meeker"],
  "rio grande": [37.68, -106.3534, "Del Norte"],
  routt: [40.485, -106.8317, "Steamboat Springs"],
  saguache: [38.0875, -106.142, "Saguache"],
  "san juan": [37.8119, -107.6645, "Silverton"],
  "san miguel": [37.9375, -107.8123, "Telluride"],
  sedgwick: [40.9883, -102.2643, "Julesburg"],
  summit: [39.4817, -106.0384, "Breckenridge"],
  teller: [38.7472, -105.1783, "Cripple Creek"],
  washington: [40.1608, -103.2144, "Akron"],
  weld: [40.4233, -104.7091, "Greeley"],
  yuma: [40.0789, -102.2232, "Wray"],
};

// Colorado judicial districts, for citations that name a district instead of a county.
const JD: Record<number, string> = {
  1: "jefferson",
  2: "denver",
  3: "las animas",
  4: "el paso",
  5: "eagle",
  6: "la plata",
  7: "montrose",
  8: "larimer",
  9: "garfield",
  10: "pueblo",
  11: "fremont",
  12: "alamosa",
  13: "morgan",
  14: "routt",
  15: "prowers",
  16: "otero",
  17: "adams",
  18: "arapahoe",
  19: "weld",
  20: "boulder",
  21: "mesa",
  22: "montezuma",
  23: "douglas",
};

const CAP: Record<string, [number, number]> = {
  alabama: [32.377, -86.3],
  alaska: [58.302, -134.42],
  arizona: [33.448, -112.097],
  arkansas: [34.747, -92.289],
  california: [38.577, -121.494],
  colorado: [39.739, -104.985],
  connecticut: [41.764, -72.682],
  delaware: [39.157, -75.52],
  florida: [30.438, -84.281],
  georgia: [33.749, -84.388],
  hawaii: [21.307, -157.857],
  idaho: [43.618, -116.2],
  illinois: [39.798, -89.654],
  indiana: [39.768, -86.163],
  iowa: [41.591, -93.604],
  kansas: [39.048, -95.678],
  kentucky: [38.187, -84.875],
  louisiana: [30.457, -91.187],
  maine: [44.307, -69.782],
  maryland: [38.979, -76.491],
  massachusetts: [42.358, -71.064],
  michigan: [42.733, -84.555],
  minnesota: [44.955, -93.102],
  mississippi: [32.304, -90.182],
  missouri: [38.579, -92.173],
  montana: [46.586, -112.018],
  nebraska: [40.808, -96.7],
  nevada: [39.164, -119.766],
  "new hampshire": [43.207, -71.538],
  "new jersey": [40.22, -74.77],
  "new mexico": [35.682, -105.94],
  "new york": [42.653, -73.757],
  "north carolina": [35.78, -78.639],
  "north dakota": [46.821, -100.783],
  ohio: [39.961, -82.999],
  oklahoma: [35.492, -97.503],
  oregon: [44.938, -123.03],
  pennsylvania: [40.264, -76.884],
  "rhode island": [41.831, -71.415],
  "south carolina": [34.0, -81.033],
  "south dakota": [44.367, -100.346],
  tennessee: [36.166, -86.784],
  texas: [30.275, -97.74],
  utah: [40.777, -111.888],
  vermont: [44.262, -72.581],
  virginia: [37.539, -77.434],
  washington: [47.036, -122.905],
  "west virginia": [38.336, -81.612],
  wisconsin: [43.075, -89.384],
  wyoming: [41.14, -104.82],
};

const CIRC: Record<string, [number, number, string]> = {
  first: [42.352, -71.05, "1st Cir. (Boston)"],
  second: [40.714, -74.002, "2d Cir. (New York)"],
  third: [39.951, -75.15, "3d Cir. (Philadelphia)"],
  fourth: [37.539, -77.434, "4th Cir. (Richmond)"],
  fifth: [29.951, -90.071, "5th Cir. (New Orleans)"],
  sixth: [39.103, -84.512, "6th Cir. (Cincinnati)"],
  seventh: [41.878, -87.63, "7th Cir. (Chicago)"],
  eighth: [38.627, -90.199, "8th Cir. (St. Louis)"],
  ninth: [37.78, -122.416, "9th Cir. (San Francisco)"],
  tenth: [39.745, -104.992, "10th Cir. (Denver)"],
  eleventh: [33.749, -84.388, "11th Cir. (Atlanta)"],
};

const CNAMES = Object.keys(SEATS).sort((a, b) => b.length - a.length);
const STATES = Object.keys(CAP).sort((a, b) => b.length - a.length);

const titleCase = (s: string) => s.replace(/\b\w/g, (x) => x.toUpperCase());
const txt = (v: unknown) => String(v == null ? "" : v).trim();

const CFR = /(^|[^a-z])c\.? ?f\.? ?r\b/i;
const USC = /\bu\.? ?s\.? ?c\b/i;
const CRS = /\bc\.? ?r\.? ?s\b/i;
const BLANKISH = /^(unknown|n\/?a|none|null|undefined|\?+|-+|—)$/i;

const given = (v: unknown) => {
  const t = txt(v);
  return t && !BLANKISH.test(t) ? t : "";
};

/** Courts whose stored name is a flattened placeholder rather than the court that decided the case. */
const FLATTENED = /^(colorado(\s+state)?\s+courts?|state court|courts?|colorado)$/i;

/** The court a passage's own header names: "Case | Court | Year". */
function courtFromPassage(passage?: string): string {
  const head = String(passage || "").split("\n")[0] || "";
  const parts = head.split("|").map((part) => part.trim());
  const court = parts.length > 1 ? parts[1] : "";
  if (!court) return "";
  if (/supreme court of colorado/i.test(court)) return "Colorado Supreme Court";
  if (/colorado court of appeals/i.test(court)) return "Colorado Court of Appeals";
  if (/supreme court of the united states/i.test(court)) return "Supreme Court of the United States";
  const circuit = court.match(/court of appeals for the ([a-z]+) circuit/i);
  if (circuit) return `United States Court of Appeals for the ${titleCase(circuit[1])} Circuit`;
  if (/district court for the district of colorado/i.test(court)) return "U.S. District Court, D. Colo.";
  return "";
}

/**
 * The deciding court, as the record names it. A flattened "Colorado state court" is replaced by the
 * court the passage header carries, so the source list, the map label and the tour all state one name.
 */
export function courtName(c: Citation): string {
  const raw = given(c.court);
  const fromPassage = courtFromPassage(c.passage);
  if (!raw) return fromPassage;
  if (FLATTENED.test(raw)) return fromPassage || "Colorado courts";
  if (/^supreme court of colorado$/i.test(raw)) return "Colorado Supreme Court";
  if (/^colorado court of appeals$/i.test(raw)) return "Colorado Court of Appeals";
  return raw;
}

/** The readable kind of an authority ("Statute", "Case", "Federal regulation", …). */
export function citeType(c: Citation): string {
  const t = given(c.type);
  if (t) {
    const s = t.replace(/_/g, " ").replace(/\s+/g, " ").trim();
    if (/^case\s*law$/i.test(s) || /^caselaw$/i.test(s) || /^case$/i.test(s)) return "Case";
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  const hay = [txt(c.id), txt(c.title), txt(c.citation)].join(" ");
  if (/^statute:/i.test(txt(c.id)) || CRS.test(hay)) return "Statute";
  if (CFR.test(hay)) return "Federal regulation";
  if (USC.test(hay)) return "Federal statute";
  if (/\sv\./i.test(hay)) return "Case";
  return "Authority";
}

/** The Colorado county a passage was decided in, as a seat key ("boulder", "el paso"). */
function findCounty(text: string): string | null {
  if (!text) return null;
  const t = text.toLowerCase();
  const pats = [
    /district court (?:of|for|in) (?:the )?(?:city and )?(?:county of )?([a-z ]+?) county/,
    /(?:appeal|certiorari) (?:from|to) the [a-z ]*?court (?:of|for|in) ([a-z ]+?) county/,
    /([a-z]+(?: [a-z]+)?) county district court/,
    /county court (?:of|for|in) ([a-z ]+?) county/,
    /city and county of (denver|broomfield)/,
    /([a-z]+(?: [a-z]+)?) county/,
  ];
  for (const re of pats) {
    const m = t.match(re);
    if (m) {
      const w = m[1].trim();
      const k = CNAMES.find((n) => w === n || w.endsWith(" " + n));
      if (k) return k;
    }
  }
  const jd = t.match(/(\d{1,2})(?:st|nd|rd|th) judicial district/);
  if (jd && JD[+jd[1]]) return JD[+jd[1]];
  return null;
}

/** Where a citation sits on the map, and how it should be labelled there. */
export function locate(c: Citation): Location {
  const kind = citeType(c).toLowerCase();
  const t = kind + " " + txt(c.type).toLowerCase();
  const court = courtName(c);
  const lc = court.toLowerCase();
  const fed =
    /federal/.test(kind) || /u\.s\.c|cfr/i.test([c.id, c.title, c.citation].filter(Boolean).join(" "));

  if (t.includes("statute") || t.includes("regulation") || t.includes("cfr") || /c\.r\.s\./i.test(txt(c.id))) {
    return fed
      ? { key: "dc-stat", ll: DC, label: "U.S. Code / CFR (Washington, DC)", cat: "federal", court }
      : { key: "capitol", ll: CAPITOL, label: "Colorado State Capitol (C.R.S.)", cat: "statute", court };
  }
  if (/supreme court of the united states/.test(lc) || (!txt(c.court) && / U\.S\. \d/.test(txt(c.id)))) {
    return { key: "scotus", ll: DC, label: "U.S. Supreme Court (Washington, DC)", cat: "federal", court };
  }
  const m = lc.match(/court of appeals for the (\w+) circuit/);
  if (m) {
    if (m[1] === "federal" || m[1] === "district") {
      return { key: "dccir", ll: DC, label: "D.C./Federal Circuit", cat: "federal", court };
    }
    const C = CIRC[m[1]];
    if (C) {
      return {
        key: "cir:" + m[1],
        ll: [C[0], C[1]],
        label: "U.S. Court of Appeals, " + C[2],
        cat: m[1] === "tenth" ? "state" : "federal",
        court,
      };
    }
  }
  const coState = /colorado/.test(lc) || (!txt(c.court) && /P\.[23]d|COA|CO \d/.test(txt(c.id)));
  if (coState) {
    const courtLabel = /appeals/i.test(court)
      ? "Colorado Court of Appeals (Denver)"
      : /supreme/i.test(court)
        ? "Colorado Supreme Court (Denver)"
        : /district court for the district of colorado/.test(lc)
          ? "U.S. District Court, D. Colo. (Denver)"
          : "Colorado courts (Denver)";
    const k = findCounty(txt(c.origin_text) + " " + txt(c.passage));
    if (k && k !== "denver") {
      const seat = SEATS[k];
      return {
        key: "c:" + k,
        ll: [seat[0], seat[1]],
        label: `${titleCase(k)} County (${seat[2]}) → ${courtLabel}`,
        cat: "county",
        court,
        up: true,
      };
    }
    // The record names no county: the authority sits at the seat of its deciding court.
    return { key: "denver", ll: DENVER, label: courtLabel, cat: "state", court };
  }
  const st = STATES.find((n) => lc.includes(n));
  if (st)
    return { key: "st:" + st, ll: CAP[st], label: `${court.slice(0, 48)} (${titleCase(st)})`, cat: "federal", court };
  return { key: "denver", ll: DENVER, label: "Colorado courts (Denver)", cat: "state", court };
}

export type ArcType = "cc" | "cs" | "st" | "fed" | "other";

/** How a link between two citations is typed. */
export function arcType(a: Location, b: Location): ArcType {
  const A = a.cat;
  const B = b.cat;
  if (A === "federal" || B === "federal") return "fed";
  if (A === "statute" || B === "statute") return "st";
  if (A === "county" && B === "county") return "cc";
  if ((A === "county") !== (B === "county")) return "cs";
  return "other";
}

