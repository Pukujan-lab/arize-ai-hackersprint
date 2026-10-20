// The tour: the answer walked stop by stop, each stop a sentence spoken and a place the camera moves
// to. The plan is built from the run itself — the question, the memo as it was written, the path the
// retriever took, then one stop per authority — so nothing is said that the run did not record.

import { citeType, courtName, locate, type Citation, type RunResult } from "@/lib/citations";
import { toRetrieval } from "@/lib/runs";

/** One stop on the walk: what is said, under which heading, and the place it moves the camera to. */
export type TourStep = { section: string; text: string; place: string | null };

/** A clip is capped at 400 characters, so a long paragraph is cut at a sentence, never mid-word. */
const SPOKEN = 340;

function clean(value: string): string {
  return String(value || "")
    .replace(/\*\*|__|`/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Cut at the last sentence that fits, else at the last word, so a stop is never read half a word. */
function spoken(value: string): string {
  const text = clean(value);
  if (text.length <= SPOKEN) return text;
  const cut = text.slice(0, SPOKEN);
  const sentence = cut.lastIndexOf(". ");
  if (sentence > SPOKEN / 2) return cut.slice(0, sentence + 1);
  return `${cut.slice(0, cut.lastIndexOf(" "))}…`;
}

/** The memo split into the paragraphs the writer gave it, under the headings it wrote. */
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
    buffer.push(line);
  }
  flush();
  return out;
}

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

export function tourPlan(result: RunResult): TourStep[] {
  const steps: TourStep[] = [];
  const question = clean(result.question || "");
  if (question) steps.push({ section: "Question", text: question, place: null });

  for (const block of paragraphs(result.answer || "")) {
    steps.push({ section: block.section, text: spoken(block.text), place: null });
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

  for (const citation of citations) {
    steps.push({ section: "Authorities", text: authorityLine(citation), place: locate(citation).key });
  }

  return steps;
}
