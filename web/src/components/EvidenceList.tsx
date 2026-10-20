// One list of authorities, used wherever the page shows the sources behind an answer: the rail in the
// chat, the sources drawer and the drawer that opens from a pin on the map.

import { citeType, courtName, type Citation } from "@/lib/citations";

export default function EvidenceList({
  citations,
  onOpen,
}: {
  citations: Citation[];
  onOpen: (citation: Citation) => void;
}) {
  return (
    <ul className="space-y-1.5">
      {citations.map((citation, index) => (
        <li key={`${citation.id}-${index}`}>
          <button
            type="button"
            onClick={() => onOpen(citation)}
            className="w-full rounded-lg border border-border bg-card px-2.5 py-2 text-left transition-colors hover:bg-accent/60"
          >
            <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-medium text-foreground">
                {citeType(citation)}
              </span>
              <span className="min-w-0 flex-1 truncate">{courtName(citation) || "Court not recorded"}</span>
            </span>
            <span className="mt-1 line-clamp-2 block text-sm font-medium leading-snug">
              {citation.title || citation.citation || "Authority"}
            </span>
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
              {[citation.citation, citation.date].filter(Boolean).join(" · ") || "Citation not recorded"}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
