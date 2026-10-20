// One authority, as the drawer shows it: what it is, who decided it, when, the passage that was
// retrieved, and the two things a reader does next — open the document, or ask about it.

import { ExternalLink, MessagesSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { citeType, courtName, locate, type Citation } from "@/lib/citations";
import { sourceHref } from "@/components/Memo";

const CATEGORY_LABEL: Record<string, string> = {
  county: "Colorado county court",
  state: "Colorado",
  statute: "Colorado statute",
  federal: "Federal",
};

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="break-words text-sm leading-snug">{value}</dd>
    </div>
  );
}

export default function AuthorityDetail({
  citation,
  onAsk,
}: {
  citation: Citation;
  onAsk?: (question: string) => void;
}) {
  const location = locate(citation);
  const passage = String(citation.passage || "").trim();
  const title = citation.title || citation.citation || "Authority";

  return (
    <div className="space-y-4">
      <div>
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="rounded border border-border bg-muted px-1.5 py-0.5 font-medium text-foreground">
            {citeType(citation)}
          </span>
          <span className="rounded border border-border px-1.5 py-0.5">{CATEGORY_LABEL[location.cat] || "Authority"}</span>
          {citation.ref && <span className="tabular-nums">{citation.ref}</span>}
        </div>
        <h3 className="mt-2 break-words text-base font-semibold leading-snug">{title}</h3>
      </div>

      <dl className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-card/60 p-3">
        <Fact label="Court" value={courtName(citation) || "Not recorded"} />
        <Fact label="Date" value={(citation.date || "").trim() || "Not recorded"} />
        <Fact label="Citation" value={(citation.citation || "").trim() || "Not recorded"} />
        <Fact label="Where" value={location.label} />
      </dl>

      {passage ? (
        <div>
          <h4 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Retrieved passage</h4>
          <blockquote className="mt-1.5 border-l-2 border-border pl-3 text-sm leading-relaxed text-foreground">
            {passage}
          </blockquote>
        </div>
      ) : (
        <p className="rounded-md border border-border bg-card/60 p-3 text-sm text-muted-foreground">
          No passage was retrieved for this authority — it came from the citation graph.
        </p>
      )}

      {!!citation.missing?.length && (
        <p className="text-xs text-muted-foreground">Not in the record: {citation.missing.join(", ")}.</p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline" size="sm" className="gap-2">
          <a href={sourceHref(citation)} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="h-4 w-4" />
            Open the document
          </a>
        </Button>
        {onAsk && (
          <Button
            variant="secondary"
            size="sm"
            className="gap-2"
            onClick={() => onAsk(`How does ${title} apply to a Colorado homestead claim?`)}
          >
            <MessagesSquare className="h-4 w-4" />
            Ask about this
          </Button>
        )}
      </div>
    </div>
  );
}
