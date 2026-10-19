import { cn } from "@/lib/utils";

export type Stat = {
  /** The figure itself, written as the server reported it. */
  value: string;
  /** A unit that sits beside the figure, kept out of the figure so the number reads as a number. */
  unit?: string;
  label: string;
  note?: string;
};

type Props = {
  stats: Stat[];
  /** Column classes for the row; the deck uses four across a wide slide. */
  columns?: string;
  className?: string;
};

/** A row of figures: the number large, the label under it. Used by the deck's stat rows. */
export default function StatRow({ stats, columns = "grid-cols-2 sm:grid-cols-4", className }: Props) {
  return (
    <div className={cn("grid gap-2 sm:gap-3", columns, className)}>
      {stats.map((stat) => (
        <div key={stat.label} className="min-w-0 rounded-lg border border-border bg-card px-3 py-2 sm:px-4 sm:py-3">
          <p className="flex flex-wrap items-baseline gap-x-1">
            <span className="break-words text-2xl font-semibold leading-none tracking-tight tabular-nums sm:text-3xl">
              {stat.value}
            </span>
            {stat.unit && <span className="text-xs text-muted-foreground sm:text-sm">{stat.unit}</span>}
          </p>
          <p className="mt-1.5 text-xs text-muted-foreground">{stat.label}</p>
          {stat.note && <p className="mt-1 text-xs text-muted-foreground">{stat.note}</p>}
        </div>
      ))}
    </div>
  );
}
