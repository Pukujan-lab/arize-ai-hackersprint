import type { ComponentType } from "react";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

type Icon = ComponentType<{ className?: string; "aria-hidden"?: boolean }>;

export type FlowStep = { label: string; detail?: string; icon: Icon };

type Props = {
  caption: string;
  steps: FlowStep[];
  className?: string;
};

/** A pipeline diagram: one card per step, joined by arrows that turn down the page on a phone. */
export default function FlowDiagram({ caption, steps, className }: Props) {
  return (
    <div className={cn("min-w-0 rounded-lg border border-border bg-card p-3 sm:p-4", className)}>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{caption}</p>
      <ol className="mt-2 flex flex-col sm:flex-row sm:items-stretch">
        {steps.map((step, index) => (
          <li key={step.label} className="flex min-w-0 flex-col items-center sm:flex-1 sm:flex-row">
            <div className="flex w-full min-w-0 flex-1 flex-col gap-1 rounded-md border border-border bg-background px-2.5 py-2">
              <step.icon className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="break-words text-sm font-medium">{step.label}</span>
              {step.detail && <span className="break-words text-xs text-muted-foreground">{step.detail}</span>}
            </div>
            {index < steps.length - 1 && (
              <ArrowRight className="mx-1 h-4 w-4 shrink-0 rotate-90 text-muted-foreground sm:rotate-0" aria-hidden="true" />
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
