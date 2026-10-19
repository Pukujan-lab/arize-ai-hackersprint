// The source list: every authority the run cites, with the detail behind it — the kind of authority,
// the court, the date and the citation — and the passage that was retrieved, when one was. An
// authority with no passage says so rather than leaving the entry blank.

import { citeType, type Citation } from "@/lib/citations";
import { sourceHref } from "@/components/Memo";

const EXCERPT_CHARS = 240;

const buttonClass =
  "h-11 rounded-md border border-border px-3 text-xs font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground";

/** A passage as an excerpt: whitespace collapsed, cut at a word, so its opening reads intact. */
function excerpt(text: string): string {
  const clean = String(text || "")
    .replace(/\s+/g, " ")
    .trim();
  if (clean.length <= EXCERPT_CHARS) return clean;
  return clean.slice(0, EXCERPT_CHARS).replace(/[,;:.\s]+\S*$/, "") + "…";
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <span>
      <span className="text-muted-foreground">{`${label}: `}</span>
      {value}
    </span>
  );
}

export default function SourcesPanel({ citations, onClose }: { citations: Citation[]; onClose: () => void }) {
  return (
    <div role="dialog" aria-label="Sources" className="fixed inset-0 z-40 flex flex-col bg-background px-4 py-3">
      <div className="flex shrink-0 items-center gap-2">
        <h2 className="mr-auto text-sm font-semibold">Sources</h2>
        <button type="button" className={buttonClass} onClick={onClose}>
          Close
        </button>
      </div>
      <ul className="mx-auto mt-3 min-h-0 w-full max-w-[70ch] flex-1 space-y-2 overflow-y-auto">
        {citations.map((citation, index) => {
          const passage = String(citation.passage || "").trim();
          return (
            <li key={`${citation.id}-${index}`} className="rounded-md border border-border px-3 py-2">
              <a
                href={sourceHref(citation)}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-sm font-medium text-foreground underline-offset-2 hover:underline"
              >
                {citation.title || citation.citation || "Authority"}
              </a>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-foreground">
                <Fact label="Kind" value={citeType(citation)} />
                <Fact label="Court" value={(citation.court || "").trim() || "not recorded"} />
                <Fact label="Date" value={(citation.date || "").trim() || "not recorded"} />
                <Fact label="Citation" value={(citation.citation || "").trim() || "not recorded"} />
              </div>
              {passage ? (
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">“{excerpt(passage)}”</p>
              ) : (
                <p className="mt-1.5 text-xs text-muted-foreground">
                  No passage was retrieved — this authority came from the citation graph.
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
