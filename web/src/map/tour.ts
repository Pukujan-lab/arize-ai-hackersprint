// The tour: the answer walked stop by stop, each stop a sentence spoken and a place the camera moves
// to. The plan is built from the run itself — the question, the short answer, the path the retriever
// took, the opinion and the rest of the memo, then one stop per authority — so nothing is said that the
// run did not record, and nothing the run did record is left out.

import { citeType, courtName, locate, type Citation, type RunResult } from "@/lib/citations";
import { toRetrieval } from "@/lib/runs";

/** One stop on the walk: what is said, under which heading, and the place it moves the camera to. */
export type TourStep = { section: string; text: string; place: string | null };

/** A stop is spoken in one breath, so a long section is split at a sentence, never mid-word. */
const SPOKEN = 340;

function clean(value: string): string {
  return String(value || "")
    .replace(/\*\*|__|`/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** The memo as a reader would say it aloud: no markdown, no citation marks, no list dashes. */
export function plainText(answer: string): string {
  return clean(
    String(answer || "")
      .replace(/^\s{0,3}#{1,6}\s+/gm, "")
      .replace(/^\s*>\s?/gm, "")
      .replace(/^\s*[-*•]\s+/gm, "")
      .replace(/^\s*\d+[.)]\s+/gm, "")
      .replace(/\[(\d{1,3})\]/g, ""),
  );
}

/** Cut at the last sentence that fits, else at the last clause, else at the last word. */
function spoken(value: string): string {
  const text = clean(value);
  if (text.length <= SPOKEN) return text;
  const cut = text.slice(0, SPOKEN);
  const sentence = cut.lastIndexOf(". ");
  if (sentence > SPOKEN / 2) return cut.slice(0, sentence + 1);
  return `${cut.slice(0, cut.lastIndexOf(" "))}…`;
}

/** A whole section as the stops it takes to say it, so the memo is read in full rather than sampled. */
function chunks(value: string): string[] {
  const whole = clean(value);
  if (!whole) return [];
  if (whole.length <= SPOKEN) return [whole];
  const parts: string[] = [];
  let rest = whole;
  while (rest.length > SPOKEN) {
    const cut = rest.slice(0, SPOKEN);
    const at = [". ", "; ", ", ", " "].map((mark) => cut.lastIndexOf(mark)).find((index) => index > SPOKEN / 2);
    const end = at === undefined ? SPOKEN - 1 : at + 1;
    parts.push(rest.slice(0, end).trim());
    rest = rest.slice(end).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

/** The memo split into the blocks the writer gave it, under the headings it wrote. */
function paragraphs(answer: string): { section: string; text: string }[] {
  const out: { section: string; text: string }[] = [];
  let section = "Short answer";
  let buffer: string[] = [];
  const flush = () => {
    const text = clean(buffer.join(" ")).replace(/^short answer:\s*/i, "");
    if (text) out.push({ section, text });
    buffer = [];
  };
  for (const raw of String(answer || "").split("\n")) {
    const line = raw.trim();
    const heading = line.match(/^#{1,6}\s+(.*)$/);
    if (heading) {
      flush();
      section = clean(heading[1]) || section;
      continue;
    }
    if (!line) {
      flush();
      continue;
    }
    buffer.push(line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, ""));
  }
  flush();
  return out;
}

/** The sections that are the run's reasoning rather than its statement of the law. */
const REASONING = /opinion|analysis|reason|discussion|caveat|holding|why|application/i;

/** The path the run recorded, in words, so the walk never claims a retriever the run did not use. */
export function pathLine(result: RunResult): string {
  const record = toRetrieval(result.retrieval);
  if (!record) return "The run did not record which path it took.";
  const parts: string[] = [record.source ? `Retrieved by ${record.source}` : "The run recorded no retriever"];
  if (record.graphSource && !/^none$/i.test(record.graphSource)) {
    parts.push(`citation graph ${record.graphSource}${record.graphRevision ? ` at ${record.graphRevision}` : ""}`);
  }
  if (record.engineOk === false) parts.push(`the retrieval engine did not answer (${record.engineReason || "no reason given"})`);
  return `${parts.join("; ")}.`;
}

function authorityLine(citation: Citation): string {
  const name = citation.title || citation.citation || "An authority";
  const court = courtName(citation);
  const parts = [citeType(citation), name];
  if (court) parts.push(court);
  if (citation.date) parts.push(String(citation.date));
  const head = `${parts.join(", ")}.`;
  // The passage's first line is its own header ("Case | Court | Year"), which the line already says.
  const passage = clean((citation.passage || "").split("\n").slice(1).join(" "));
  return spoken(passage.length > 40 ? `${head} ${passage}` : head);
}

/**
 * The walk, in a fixed order: the question, the short answer, where the authorities came from, the
 * run's own reasoning, the rest of the memo, and then each authority where it sits.
 */
export function tourPlan(result: RunResult): TourStep[] {
  const steps: TourStep[] = [];
  const question = clean(result.question || "");
  if (question) steps.push({ section: "Question", text: question, place: null });

  const blocks = paragraphs(result.answer || "");
  const [first, ...rest] = blocks;
  if (first) {
    for (const text of chunks(first.text)) steps.push({ section: "Short answer", text, place: null });
  }

  const citations = result.citations || [];
  const edges = result.edges || [];
  if (citations.length) {
    const places = new Set(citations.map((citation) => locate(citation).key)).size;
    const head = `${citations.length} ${citations.length === 1 ? "authority" : "authorities"} in ${places} ${
      places === 1 ? "place" : "places"
    }.`;
    const links = edges.length
      ? ` ${edges.length} citation ${edges.length === 1 ? "link" : "links"} join them.`
      : "";
    steps.push({ section: "Sources", text: spoken(`${head}${links} ${pathLine(result)}`), place: null });
  }

  // The run's reasoning first, then the rest of the memo, so the walk reads like the answer does.
  for (const wanted of [true, false]) {
    for (const block of rest) {
      if (REASONING.test(block.section) !== wanted) continue;
      const section = wanted ? "Opinion" : "Memo";
      for (const text of chunks(block.text)) steps.push({ section, text, place: null });
    }
  }

  for (const citation of citations) {
    steps.push({ section: "Authorities", text: authorityLine(citation), place: locate(citation).key });
  }

  return steps;
}
