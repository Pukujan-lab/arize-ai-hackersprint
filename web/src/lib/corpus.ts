// The retrieval index behind the search page: the authorities every saved run cited, deduplicated by
// record id, and a small field-weighted scorer over them. It searches the corpus this device already
// holds, which is what the server's saved runs are, so no result is invented.

import { citeType, courtName, locate, titleCase, type Citation, type RunResult } from "./citations";

export type Doc = {
  id: string;
  title: string;
  citation: string;
  court: string;
  date: string;
  /** The readable kind: Case, Statute, Federal regulation, … */
  kind: string;
  passage: string;
  url: string;
  jurisdiction: "Colorado" | "Federal";
  county: string | null;
  runId: string;
  question: string;
  ref: string;
  /** The record as the run wrote it, so a result can open the same drawer the map opens. */
  record: Citation;
};

export type JurisdictionFilter = "all" | "Colorado" | "Federal";
export type KindFilter = "all" | "case" | "statute" | "regulation";
export type Filters = { jurisdiction: JurisdictionFilter; kind: KindFilter };

export type Hit = {
  doc: Doc;
  /** 0–1, relative to the best result for this query. */
  score: number;
  snippet: string;
  terms: string[];
};

const STOP_WORDS = new Set(
  "a an and are as at be by can does do for from has have how if in into is it its of on or that the their there these this to was were what when where which who why will with".split(
    " ",
  ),
);

/** The words a query is matched on: lower-cased, punctuation dropped, stop words removed. */
export function queryTerms(query: string): string[] {
  const words = (query.toLowerCase().match(/[a-z0-9]+/g) || []).filter((word) => word.length > 1);
  const kept = words.filter((word) => !STOP_WORDS.has(word));
  return [...new Set(kept.length ? kept : words)];
}

/** Every authority one run cited, placed the same way the map places it. */
export function docsFromRun(result: RunResult, runId: string): Doc[] {
  const citations: Citation[] = Array.isArray(result.citations) ? result.citations : [];
  return citations.map((citation, index) => {
    const location = locate(citation);
    return {
      id: citation.id || `${runId}-${index}`,
      title: (citation.title || "").trim() || (citation.citation || "").trim() || "Untitled authority",
      citation: (citation.citation || "").trim(),
      court: courtName(citation) || "Court not recorded",
      date: (citation.date || "").trim(),
      kind: citeType(citation),
      passage: (citation.passage || "").trim(),
      url: (citation.url || "").trim(),
      jurisdiction: location.cat === "federal" ? "Federal" : "Colorado",
      county: location.key.startsWith("c:") ? titleCase(location.key.slice(2)) : null,
      runId,
      question: (result.question || "").trim(),
      ref: (citation.ref || "").trim(),
      record: citation,
    };
  });
}

/** The same authority cited by several runs is one document, described by the newest run. */
export function dedupeDocs(docs: Doc[]): Doc[] {
  const seen = new Map<string, Doc>();
  for (const doc of docs) if (!seen.has(doc.id)) seen.set(doc.id, doc);
  return [...seen.values()];
}

function matchesKind(doc: Doc, kind: KindFilter): boolean {
  if (kind === "all") return true;
  const value = doc.kind.toLowerCase();
  if (kind === "case") return value.includes("case");
  if (kind === "statute") return value.includes("statute");
  return value.includes("regulation") || value.includes("rule");
}

function occurrences(haystack: string, term: string, cap = 3): number {
  if (!haystack || !term) return 0;
  let count = 0;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(term, from);
    if (at < 0 || count >= cap) break;
    count += 1;
    from = at + term.length;
  }
  return count;
}

/** The passage around the first word of the query, cut at a word boundary. */
function snippetFor(passage: string, terms: string[]): string {
  const text = passage.replace(/\s+/g, " ").trim();
  if (!text) return "";
  const lower = text.toLowerCase();
  let at = -1;
  for (const term of terms) {
    const found = lower.indexOf(term);
    if (found >= 0 && (at < 0 || found < at)) at = found;
  }
  const start = at < 0 ? 0 : Math.max(0, at - 90);
  const slice = text.slice(start, start + 300);
  const cut = slice.length === 300 ? slice.replace(/[,;:.\s]+\S*$/, "") + "…" : slice;
  return (start > 0 ? "…" : "") + cut;
}

/**
 * Score the corpus for a query. Field weights say what a reader means: a word in the title or the
 * citation identifies the authority, a word in the passage only describes it.
 */
export function searchDocs(docs: Doc[], query: string, filters: Filters): Hit[] {
  const terms = queryTerms(query);
  const filtered = docs.filter(
    (doc) =>
      (filters.jurisdiction === "all" || doc.jurisdiction === filters.jurisdiction) && matchesKind(doc, filters.kind),
  );
  if (!terms.length) {
    return filtered.map((doc) => ({ doc, score: 0, snippet: snippetFor(doc.passage, []), terms }));
  }

  const phrase = query.trim().toLowerCase();
  const raw = filtered.map((doc) => {
    const title = doc.title.toLowerCase();
    const citation = doc.citation.toLowerCase();
    const court = doc.court.toLowerCase();
    const passage = doc.passage.toLowerCase();
    let score = 0;
    for (const term of terms) {
      score += occurrences(title, term, 2) * 3;
      score += occurrences(citation, term, 2) * 2;
      score += occurrences(court, term, 1) * 1.5;
      score += occurrences(passage, term, 3);
    }
    if (phrase.length > 3 && (title.includes(phrase) || passage.includes(phrase))) score += 6;
    return { doc, score, snippet: snippetFor(doc.passage, terms) };
  });

  const best = Math.max(0, ...raw.map((hit) => hit.score));
  return raw
    .filter((hit) => hit.score > 0)
    .map((hit) => ({ ...hit, score: best ? hit.score / best : 0, terms }))
    .sort((a, b) => b.score - a.score || b.doc.date.localeCompare(a.doc.date));
}

/** The text of a snippet split into plain and matched runs, so a result can show what it matched. */
export function segments(text: string, terms: string[]): { text: string; hit: boolean }[] {
  if (!terms.length) return [{ text, hit: false }];
  const lower = text.toLowerCase();
  const out: { text: string; hit: boolean }[] = [];
  let at = 0;
  while (at < text.length) {
    let next = -1;
    let length = 0;
    for (const term of terms) {
      const found = lower.indexOf(term, at);
      if (found < 0) continue;
      if (next < 0 || found < next || (found === next && term.length > length)) {
        next = found;
        length = term.length;
      }
    }
    if (next < 0) {
      out.push({ text: text.slice(at), hit: false });
      break;
    }
    if (next > at) out.push({ text: text.slice(at, next), hit: false });
    out.push({ text: text.slice(next, next + length), hit: true });
    at = next + length;
  }
  return out;
}
