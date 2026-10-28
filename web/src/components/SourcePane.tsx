// The opinion behind a citation, shown beside the memo: who decided it, the passage the retriever
// returned with the words the memo relies on marked, and the reference checks that could be run
// without a model. On a wide screen it is a column next to the chat; below that it fills the drawer.

import { Fragment, useMemo, type ReactNode } from "react";
import { CheckCircle2, ChevronLeft, ChevronRight, CircleAlert, ExternalLink, Info, MessagesSquare, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { sourceHref } from "@/components/Memo";
import { citeType, courtName, type Citation, type Safeguard } from "@/lib/citations";
import { sourceReport, type CheckState, type Mark } from "@/lib/sourcecheck";
import { cn } from "@/lib/utils";

const STATE_STYLE: Record<CheckState, { icon: typeof Info; tone: string; word: string }> = {
  pass: { icon: CheckCircle2, tone: "text-emerald-600 dark:text-emerald-400", word: "Passed" },
  fail: { icon: CircleAlert, tone: "text-destructive", word: "Failed" },
  info: { icon: Info, tone: "text-muted-foreground", word: "Note" },
};

/** The passage cut at its marks, so each marked stretch can be wrapped and the rest left as written. */
function marked(passage: string, marks: Mark[]) {
  const out: ReactNode[] = [];
  let at = 0;
  marks.forEach((mark, i) => {
    if (mark.start < at) return;
    if (mark.start > at) out.push(<Fragment key={`t${i}`}>{passage.slice(at, mark.start)}</Fragment>);
    out.push(
      <mark
        key={`m${i}`}
        data-mark={mark.kind}
        className={cn(
          "rounded-sm px-0.5 text-foreground",
          mark.kind === "quote" ? "bg-amber-400/40" : "bg-sky-400/25 underline decoration-sky-400/60 underline-offset-2",
        )}
      >
        {passage.slice(mark.start, mark.end)}
      </mark>,
    );
    at = mark.end;
  });
  if (at < passage.length) out.push(<Fragment key="tail">{passage.slice(at)}</Fragment>);
  return out;
}

export default function SourcePane({
  citations,
  index,
  answer,
  safeguard,
  onSelect,
  onClose,
  onAsk,
  className,
}: {
  citations: Citation[];
  index: number;
  answer: string;
  safeguard?: Safeguard;
  onSelect: (index: number) => void;
  onClose?: () => void;
  onAsk?: (question: string) => void;
  className?: string;
}) {
  const citation = citations[index];
  const report = useMemo(
    () => (citation ? sourceReport(citation, index, answer, safeguard) : null),
    [citation, index, answer, safeguard],
  );
  if (!citation || !report) return null;

  const passage = String(citation.passage || "").trim();
  // Marks were found against the untrimmed passage; shift them if trimming moved the start.
  const lead = String(citation.passage || "").length - String(citation.passage || "").trimStart().length;
  const marks = report.marks.map((m) => ({ ...m, start: m.start - lead, end: m.end - lead })).filter((m) => m.start >= 0);
  const title = citation.title || citation.citation || "Authority";
  const failed = report.checks.filter((c) => c.state === "fail").length;
  const passed = report.checks.filter((c) => c.state === "pass").length;

  return (
    <section aria-label="Source" className={cn("flex min-h-0 flex-col bg-background", className)}>
      <header className={cn("flex shrink-0 items-start gap-2 border-b border-border px-4 py-3", !onClose && "pr-12")}>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
            {citation.ref && (
              <span className="rounded bg-muted px-1.5 py-0.5 font-mono font-medium text-foreground">{citation.ref}</span>
            )}
            <span className="rounded bg-muted px-1.5 py-0.5 font-medium text-foreground">{citeType(citation)}</span>
            <span className="truncate">{courtName(citation) || "Court not recorded"}</span>
          </div>
          <h2 className="mt-1.5 break-words text-base font-semibold leading-snug">{title}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {[citation.citation, citation.date].filter(Boolean).join(" · ") || "Citation not recorded"}
          </p>
        </div>
        <div className="flex shrink-0 items-center">
          <Button variant="ghost" size="icon" className="h-8 w-8" disabled={index <= 0} onClick={() => onSelect(index - 1)} aria-label="Previous source">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" disabled={index >= citations.length - 1} onClick={() => onSelect(index + 1)} aria-label="Next source">
            <ChevronRight className="h-4 w-4" />
          </Button>
          {onClose && (
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose} aria-label="Close source">
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </header>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
        {!!report.claims.length && (
          <div>
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">What the memo says</h3>
            <ul className="mt-1.5 space-y-1.5">
              {report.claims.map((claim) => (
                <li key={claim} className="border-l-2 border-border pl-3 text-sm leading-relaxed">
                  {claim}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div>
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">The passage</h3>
          {passage ? (
            <>
              <p className="mt-1.5 whitespace-pre-wrap text-sm leading-7 text-foreground">{marked(passage, marks)}</p>
              {!!marks.length && (
                <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                  {marks.some((m) => m.kind === "quote") && (
                    <span className="inline-flex items-center gap-1">
                      <span className="h-2.5 w-2.5 rounded-sm bg-amber-400/60" /> quoted in the memo
                    </span>
                  )}
                  {marks.some((m) => m.kind === "closest") && (
                    <span className="inline-flex items-center gap-1">
                      <span className="h-2.5 w-2.5 rounded-sm bg-sky-400/50" /> closest to what the memo says (shared
                      words, not proof)
                    </span>
                  )}
                </p>
              )}
              <p className="mt-2 text-[11px] text-muted-foreground">
                This is the passage the retriever returned, not the whole opinion.
              </p>
            </>
          ) : (
            <p className="mt-1.5 rounded-md border border-border bg-card/60 p-3 text-sm text-muted-foreground">
              No passage was retrieved for this authority. It came from the citation graph, which shows who cites
              whom but not what the opinion holds.
            </p>
          )}
        </div>

        <div>
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Reference checks</h3>
            <span className="text-[11px] tabular-nums text-muted-foreground">
              {passed} passed{failed ? ` · ${failed} failed` : ""}
            </span>
          </div>
          <ul className="mt-1.5 divide-y divide-border rounded-lg border border-border">
            {report.checks.map((check) => {
              const style = STATE_STYLE[check.state];
              const Icon = style.icon;
              return (
                <li key={check.id} className="flex items-start gap-2.5 px-3 py-2">
                  <Icon aria-hidden="true" className={cn("mt-0.5 h-4 w-4 shrink-0", style.tone)} />
                  <div className="min-w-0">
                    <p className="text-sm font-medium leading-snug">
                      {check.label} <span className="sr-only">: {style.word}</span>
                    </p>
                    <p className="text-xs leading-relaxed text-muted-foreground">{check.detail}</p>
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-[11px] text-muted-foreground">
            These check references, not legal accuracy or whether the law is current.
          </p>
        </div>

        {!!citation.missing?.length && (
          <p className="text-xs text-muted-foreground">Not in the record: {citation.missing.join(", ")}.</p>
        )}
      </div>

      <footer className="flex shrink-0 flex-wrap gap-2 border-t border-border px-4 py-3">
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
      </footer>
    </section>
  );
}
