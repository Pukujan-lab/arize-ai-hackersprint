// What a pin says when it is clicked: a small card over the map, not a full-height panel. It names the
// place, lists the authorities decided there, and opens one of them in place — court, date, citation and
// the passage that was retrieved — so the reader can check a holding without leaving the map.

import { useState } from "react";
import { ExternalLink, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { sourceHref } from "@/components/Memo";
import type { MapPlace } from "@/components/CitationMap";
import { citeType, courtName, type Citation } from "@/lib/citations";

function Row({ citation }: { citation: Citation }) {
  const [open, setOpen] = useState(false);
  const passage = String(citation.passage || "").trim();
  const title = citation.title || citation.citation || "Authority";

  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="w-full px-3 py-2 text-left transition-colors hover:bg-accent/50 focus-visible:bg-accent/60 focus-visible:outline-none"
      >
        <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          {citation.ref && (
            <span className="shrink-0 rounded bg-muted px-1 py-0.5 font-mono font-medium text-foreground">
              {citation.ref}
            </span>
          )}
          <span className="shrink-0 rounded bg-muted px-1 py-0.5 font-medium text-foreground">{citeType(citation)}</span>
          <span className="truncate">{courtName(citation) || "Court not recorded"}</span>
        </span>
        <span className="mt-0.5 line-clamp-2 block text-[13px] font-medium leading-snug">{title}</span>
        <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
          {[citation.citation, citation.date].filter(Boolean).join(" · ") || "Citation not recorded"}
        </span>
      </button>

      {open && (
        <div className="space-y-2 px-3 pb-2.5">
          {passage ? (
            <blockquote className="max-h-40 overflow-y-auto rounded-md border-l-2 border-border bg-muted/40 px-2 py-1.5 text-xs leading-relaxed">
              {passage}
            </blockquote>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              No passage was retrieved for this authority — it came from the citation graph.
            </p>
          )}
          <Button asChild variant="outline" size="sm" className="h-7 gap-1.5 px-2 text-xs">
            <a href={sourceHref(citation)} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-3.5 w-3.5" />
              Open the document
            </a>
          </Button>
        </div>
      )}
    </li>
  );
}

export default function PlaceCard({ place, onClose }: { place: MapPlace; onClose: () => void }) {
  const count = place.citations.length;

  return (
    <aside
      aria-label={`Authorities at ${place.label}`}
      className="absolute right-3 top-[4.5rem] z-10 flex max-h-[calc(100%-6rem)] w-[min(22rem,calc(100%-1.5rem))] flex-col overflow-hidden rounded-lg border border-border bg-background/95 shadow-lg backdrop-blur"
    >
      <header className="flex items-start gap-2 border-b border-border px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold leading-snug">{place.label}</p>
          <p className="text-[11px] leading-tight text-muted-foreground">
            {count} {count === 1 ? "authority" : "authorities"} at this place
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="-mr-1 -mt-0.5 h-6 w-6 shrink-0"
          onClick={onClose}
          aria-label="Close"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </header>

      <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto">
        {place.citations.map((citation, index) => (
          <Row key={`${citation.id}-${index}`} citation={citation} />
        ))}
      </ul>
    </aside>
  );
}
