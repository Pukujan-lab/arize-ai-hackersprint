// The tour, under the map: play or stop the walk, the line being spoken, and the transcript of every
// stop so far. It sits below the map rather than over it, so the pins and the legend stay uncovered.

import { useEffect, useRef } from "react";
import { Play, Square, Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { NarrationStatus } from "@/hooks/use-narration";
import type { TourStep } from "@/map/tour";
import { cn } from "@/lib/utils";

const VOICE_WORD: Record<NarrationStatus, string> = {
  idle: "",
  loading: "Audio loading…",
  speaking: "Speaking",
  unavailable: "Audio unavailable, continuing in text",
};

export default function TourPanel({
  steps,
  index,
  status,
  onStart,
  onStop,
}: {
  steps: TourStep[];
  index: number;
  status: NarrationStatus;
  onStart: () => void;
  onStop: () => void;
}) {
  const active = index >= 0;
  const current = active ? steps[index] : null;
  const spoken = active ? steps.slice(0, index + 1) : [];
  const currentRef = useRef<HTMLLIElement | null>(null);

  // The transcript follows the voice, so the line being said is the one in view.
  useEffect(() => {
    const element = currentRef.current;
    if (!element) return;
    element.scrollIntoView({ block: "nearest", behavior: "auto" });
  }, [index]);

  return (
    <section aria-label="Tour" className="shrink-0 rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-2.5 py-2">
        <Button size="sm" className="gap-1.5" onClick={active ? onStop : onStart} disabled={!steps.length}>
          {active ? <Square className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          {active ? "Stop the tour" : "Play the tour"}
        </Button>

        <span className="text-xs tabular-nums text-muted-foreground">
          {active ? `${index + 1} of ${steps.length}` : `${steps.length} stops`}
        </span>

        {current && (
          <span className="rounded-full border border-border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {current.section}
          </span>
        )}

        <span className="ml-auto flex items-center gap-1.5 text-[11px] text-muted-foreground">
          {status === "unavailable" ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
          {VOICE_WORD[status] || (active ? "" : "Speaks each stop, and moves the map to its place")}
        </span>
      </div>

      {active && (
        <>
          <p aria-live="polite" className="border-t border-border px-2.5 py-2 text-sm leading-relaxed">
            {current?.text}
          </p>
          <ol
            aria-label="Tour transcript"
            className="max-h-28 overflow-y-auto border-t border-border px-2.5 py-1.5 text-xs leading-relaxed"
          >
            {spoken.map((step, at) => (
              <li
                key={`${step.section}-${at}`}
                ref={at === index ? currentRef : undefined}
                className={cn("py-0.5", at === index ? "text-foreground" : "text-muted-foreground")}
              >
                <span className="font-medium">{step.section}:</span> {step.text}
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
