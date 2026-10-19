// Stop text: what a tour stop says, built from the citation, its resolved location and the memo.
// The wording matches the recorded golden capture, including its quirks.

import type { Citation, Edge, Location } from "./citations";

export type StopParts = {
  title: string;
  court: string;
  year: string;
  holding: string;
  citedBy: string;
  memoLine: string;
};

const CITE_RE =
  /\b\d+\s+(U\.S\.|P\.\s?\d?d|Colo\.(\s?App\.)?|S\.\s?Ct\.|F\.\s?\d?d|L\.\s?Ed\.)\s+\d+|\bv\.\s+[A-Z][\w.]*,\s+\d+/;

const STOP_WORDS = new Set(
  "the a an of to in for and or on is be by with under from that this what when can does".split(" "),
);

/** Split a passage into sentences. A split after "U.S." is part of the recorded behaviour. */
export function sentences(text: string): string[] {
  return String(text || "")
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z“"(])/)
    .map((x) => x.trim())
    .filter(Boolean);
}

/** The sentence of the passage that answers the question best, or "" when nothing qualifies. */
function holding(c: Citation, question: string): string {
  const S = sentences(c.passage || "").filter(
    (x) => x.length >= 50 && x.length <= 320 && !CITE_RE.test(x) && !/^\W|^\d|\|/.test(x) && /[.!?]$/.test(x),
  );
  if (!S.length) return "";
  const terms = String(question || "")
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
  let best = S[0];
  let bestScore = -1;
  S.forEach((x, i) => {
    const l = x.toLowerCase();
    const score =
      terms.reduce((a, t) => a + (l.includes(t) ? 1 : 0), 0) +
      (/\b(held|hold|must|may|requires?|shall|is not|are not)\b/.test(l) ? 0.5 : 0) -
      i * 0.01;
    if (score > bestScore) {
      bestScore = score;
      best = x;
    }
  });
  return best;
}

/** Who else in this run's sources cites this one, when there is no holding to quote. */
function citedByLine(c: Citation, cites: Citation[], edges: Edge[]): string {
  const name =
    String(c.title || "")
      .split(/\s+v\.?\s+/)
      .map((x) => x.trim())
      .find((x) => x.length > 3 && !/^(People|State|United States)$/.test(x)) || "";
  const sources = edges
    .filter((e) => e.dst === c.id)
    .map((e) => cites.find((x) => x.id === e.src))
    .filter((x): x is Citation => !!x && x !== c);
  for (const s of sources) {
    const hit = name && sentences(s.passage || "").find((x) => x.includes(name) && x.length <= 320);
    const who = s.title || "another source";
    if (hit) return `Cited by ${who} in this answer's sources: “${hit}”`;
  }
  if (sources.length) return `Cited by ${sources[0].title || "another source"} in this answer's sources.`;
  return "";
}

/** The line of the memo that cites this authority. */
function memoLineFor(c: Citation, answer: string): string {
  const ref = c.ref || "";
  if (!ref || !answer) return "";
  const lines = String(answer)
    .split("\n")
    .filter((l) => l.includes(ref));
  const line = lines.find((x) => /^\s*[-*•]/.test(x)) || lines[0];
  if (!line) return "";
  let t = line
    .replace(/\*\*|[*#>`]/g, "")
    .replace(/\s*\[\d+\]/g, "")
    .replace(/^\s*[-•]\s*/, "")
    .replace(/^short answer:?\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
  const quoted = t.match(/[“"]([^”"]{20,})[”"]/);
  const lead = t.split(/\s+[-–—]\s+/)[0];
  if (quoted && lead && lead.length < 90) {
    return `The memo relies on ${lead} for the point that ${quoted[1].replace(/[.\s]+$/, "")}.`;
  }
  const parts = sentences(t);
  t = parts[0] || t;
  if (!/[.!?]$/.test(t)) t += ".";
  return "In the memo: " + t;
}

/** The parts of a stop: what is shown on the caption and spoken aloud. */
export function explainParts(c: Citation, loc: Location, ctx: { question?: string; answer?: string }, cites: Citation[], edges: Edge[]): StopParts {
  const holdingText = holding(c, ctx.question || "");
  const fallback = holdingText ? "" : citedByLine(c, cites, edges);
  return {
    title: c.title || "Authority",
    court: String(c.court || "").trim(),
    year: String(c.date || ""),
    holding: holdingText,
    citedBy: fallback,
    memoLine: memoLineFor(c, ctx.answer || ""),
  };
}

const fourDigitYear = (date: string) => (String(date || "").match(/\d{4}/) || [""])[0];

/** The spoken text of a stop, in the recorded order and punctuation. */
export function spokenText(parts: StopParts, loc: Location): string {
  const where = [parts.court, loc.cat === "county" ? loc.label.split("→")[0].trim() : ""]
    .filter(Boolean)
    .join(", ");
  const year = fourDigitYear(parts.year);
  const body = parts.holding || parts.citedBy;
  const head = where
    ? `${parts.title} (${where}${year ? ", " + year : ""})`
    : `${parts.title}${year ? " (" + year + ")" : ""}`;
  const line = `${head}: ${body}`;
  return parts.memoLine ? `${line} ${parts.memoLine}` : line;
}
