// What can be checked about one cited authority without asking a model: which sentences of the memo
// lean on it, whether the words the memo puts in quotation marks appear in the retrieved passage, and
// which sentence of the passage sits closest to what the memo says. Every result is a reference check,
// not a legal one — a quote that is found proves the words are there, not that the memo reads them fairly.

import type { Citation, Safeguard } from "@/lib/citations";

export type CheckState = "pass" | "fail" | "info";
export type Check = { id: string; label: string; state: CheckState; detail: string };

/** A stretch of the passage to mark: a quote the memo put in quotation marks, or the closest sentence. */
export type Mark = { start: number; end: number; kind: "quote" | "closest" };

export type SourceReport = {
  /** The memo sentences that cite this authority, markup removed. */
  claims: string[];
  checks: Check[];
  marks: Mark[];
};

const STOP = new Set(
  "that this with from have been were their there which would about under into than then them they also other such only when what where will shall upon over".split(
    " ",
  ),
);

const WORD = /[\p{L}\p{N}]+/gu;

const words = (text: string): string[] => text.toLowerCase().match(WORD) ?? [];
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The memo with its markdown marks and reference numbers taken off a sentence. */
function plain(text: string): string {
  return text
    .replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "")
    .replace(/\*\*|__|[*_`>#]/g, "")
    .replace(/\[(\d{1,3})\]/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([.,;:?!])/g, "$1")
    .trim();
}

export function refNumber(citation: Citation, index: number): number {
  const fromRef = (citation.ref || "").match(/\d+/);
  return fromRef ? Number(fromRef[0]) : index + 1;
}

/** The sentences of the memo that carry reference `n`. */
export function claimsFor(answer: string, n: number): string[] {
  const marker = new RegExp(`\\[${n}\\]`);
  const out: string[] = [];
  for (const line of String(answer || "").split(/\n+/)) {
    for (const sentence of line.split(/(?<=[.?!])\s+(?=[A-Z“"*\[])/)) {
      if (marker.test(sentence)) {
        const clean = plain(sentence);
        if (clean) out.push(clean);
      }
    }
  }
  return out;
}

/** Phrases the memo puts in quotation marks, long enough that finding them means something. */
export function quotedPhrases(claims: string[]): string[] {
  const out: string[] = [];
  for (const claim of claims) {
    for (const match of claim.matchAll(/[“"]([^”"]{12,}?)[”"]/g)) {
      if (words(match[1]).length >= 4) out.push(match[1].trim());
    }
  }
  return out;
}

/** Where a phrase sits in the passage, matching its words in order and ignoring spacing and punctuation. */
export function locatePhrase(passage: string, phrase: string): { start: number; end: number } | null {
  const tokens = phrase.match(WORD);
  if (!tokens || tokens.length < 4) return null;
  const pattern = new RegExp(tokens.map(escape).join("[^\\p{L}\\p{N}]+"), "iu");
  const hit = pattern.exec(passage);
  return hit ? { start: hit.index, end: hit.index + hit[0].length } : null;
}

/** The passage sentence that shares the most words with the memo's claims, or null when none shares enough. */
function closestSentence(passage: string, claims: string[]): { start: number; end: number } | null {
  const claimWords = new Set(
    claims
      .flatMap(words)
      .filter((w) => w.length > 3 && !STOP.has(w)),
  );
  if (claimWords.size < 3) return null;

  let best: { start: number; end: number; score: number } | null = null;
  const splitter = /[^\n.?!]+(?:[.?!]+|\n|$)/g;
  let match: RegExpExecArray | null;
  while ((match = splitter.exec(passage))) {
    const sentence = match[0];
    const shared = new Set(words(sentence).filter((w) => claimWords.has(w)));
    if (shared.size >= 3 && (!best || shared.size > best.score)) {
      best = { start: match.index, end: match.index + sentence.length, score: shared.size };
    }
  }
  return best ? { start: best.start, end: best.end } : null;
}

export function sourceReport(
  citation: Citation,
  index: number,
  answer: string,
  safeguard?: Safeguard,
): SourceReport {
  const n = refNumber(citation, index);
  const claims = claimsFor(answer, n);
  const passage = String(citation.passage || "");
  const checks: Check[] = [];
  const marks: Mark[] = [];

  // 1. The citation check the pipeline already ran.
  const ref = `[${n}]`;
  if (!safeguard || typeof safeguard.pass !== "boolean") {
    checks.push({ id: "retrieved", label: "In the retrieved set", state: "info", detail: "This run did not report its citation check." });
  } else if (safeguard.invalid?.includes(ref) || safeguard.invalid?.includes(String(n))) {
    checks.push({ id: "retrieved", label: "In the retrieved set", state: "fail", detail: "The citation check flagged this reference." });
  } else {
    checks.push({ id: "retrieved", label: "In the retrieved set", state: "pass", detail: "The memo cites it, and the retriever returned it." });
  }

  // 2. Is there text to read at all?
  if (passage.trim()) {
    checks.push({ id: "passage", label: "Passage on record", state: "pass", detail: "The retriever returned the text below." });
  } else {
    checks.push({
      id: "passage",
      label: "Passage on record",
      state: "info",
      detail: "Graph only: the title and its links were retrieved, not the opinion's words.",
    });
  }

  // 3. Quoted words.
  const quotes = quotedPhrases(claims);
  if (!quotes.length) {
    checks.push({
      id: "quotes",
      label: "Quoted words",
      state: "info",
      detail: claims.length ? "The memo paraphrases this authority, so there are no quoted words to match." : "No sentence of the memo carries this reference.",
    });
  } else if (!passage.trim()) {
    checks.push({ id: "quotes", label: "Quoted words", state: "info", detail: "There is no passage to match the quotation against." });
  } else {
    const missing: string[] = [];
    for (const phrase of quotes) {
      const found = locatePhrase(passage, phrase);
      if (found) marks.push({ ...found, kind: "quote" });
      else missing.push(phrase);
    }
    const found = quotes.length - missing.length;
    checks.push({
      id: "quotes",
      label: "Quoted words",
      state: missing.length ? "fail" : "pass",
      detail: missing.length
        ? `${found} of ${quotes.length} quoted phrase${quotes.length === 1 ? "" : "s"} found word for word. Not found: “${missing[0]}”.`
        : `${found === 1 ? "The quoted phrase appears" : `All ${found} quoted phrases appear`} word for word in the passage.`,
    });
  }

  // 4. The closest sentence, only when no quote already marks the passage.
  if (passage.trim() && !marks.length) {
    const closest = closestSentence(passage, claims);
    if (closest) marks.push({ ...closest, kind: "closest" });
  }

  return { claims, checks, marks: marks.sort((a, b) => a.start - b.start) };
}
