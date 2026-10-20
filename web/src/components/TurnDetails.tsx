// Everything behind one answer, in the drawer the reader opens from that answer: the figures, the
// places its authorities sit in, and the retrieval stages the run recorded. Nothing here is shown
// until the reader asks for it, so the conversation itself stays a conversation.

import { MapPin } from "lucide-react";
import StatRow from "@/components/StatRow";
import { Button } from "@/components/ui/button";
import { locate, type RunResult } from "@/lib/citations";
import { seconds, toRetrieval } from "@/lib/runs";

export default function TurnDetails({ result, onShowMap }: { result: RunResult; onShowMap: () => void }) {
  const citations = result.citations || [];
  const record = toRetrieval(result.retrieval);
  const pass = result.safeguard?.pass;

  const places = new Map<string, { label: string; n: number }>();
  for (const citation of citations) {
    const loc = locate(citation);
    const seen = places.get(loc.key);
    if (seen) seen.n += 1;
    else places.set(loc.key, { label: loc.label, n: 1 });
  }

  const facts: [string, string][] = record
    ? [
        ["Path", record.source || "not recorded"],
        ["Citation graph", record.graphSource || "not recorded"],
        ["Graph revision", record.graphRevision || "not recorded"],
        [
          "Engine",
          record.engineOk === null
            ? "not reported"
            : record.engineOk
              ? "answered"
              : record.engineReason || "did not answer",
        ],
      ]
    : [];

  return (
    <div className="space-y-5">
      <StatRow
        columns="grid-cols-3"
        stats={[
          { value: String(citations.length), label: "Authorities cited" },
          {
            value: pass === true ? "Pass" : pass === false ? "Fail" : "—",
            label: "Citation check",
          },
          { value: seconds(typeof result.elapsed_s === "number" ? result.elapsed_s : null), label: "Answer time" },
        ]}
      />

      <section>
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Where the law sits</h3>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={onShowMap}>
            <MapPin className="h-4 w-4" />
            Show on the map
          </Button>
        </div>
        {places.size ? (
          <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
            {[...places.values()].map((place) => (
              <li key={place.label} className="flex items-baseline gap-2 px-2.5 py-1.5 text-sm">
                <span className="min-w-0 flex-1">{place.label}</span>
                <span className="text-xs tabular-nums text-muted-foreground">{place.n}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">This answer cites no authority.</p>
        )}
      </section>

      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">What the retriever ran</h3>
        {record && record.stages.length ? (
          <ol className="mt-2 space-y-1.5">
            {record.stages.map((stage, index) => (
              <li key={`${stage.name}-${index}`} className="rounded-lg border border-border px-2.5 py-2">
                <div className="flex items-baseline gap-2">
                  <span className="text-xs tabular-nums text-muted-foreground">{index + 1}</span>
                  <span className="min-w-0 flex-1 text-sm font-medium">{stage.name}</span>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {stage.skipped ? "skipped" : stage.durationMs === null ? "—" : `${Math.round(stage.durationMs)} ms`}
                  </span>
                </div>
                {stage.skipped && stage.reason && (
                  <p className="mt-1 text-xs text-muted-foreground">Did not run: {stage.reason}</p>
                )}
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">This run recorded no retrieval stages.</p>
        )}

        {!!facts.length && (
          <dl className="mt-3 space-y-1.5 text-sm">
            {facts.map(([label, value]) => (
              <div key={label} className="flex items-baseline gap-2">
                <dt className="min-w-0 flex-1 text-muted-foreground">{label}</dt>
                <dd className="max-w-[62%] break-words text-right text-xs">{value}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      <p className="text-xs text-muted-foreground">
        {result.provider ? `Answer written by ${result.provider}. ` : ""}
        {result.safeguard?.disclaimer || "AI-generated research summary, not legal advice."}
      </p>
    </div>
  );
}
