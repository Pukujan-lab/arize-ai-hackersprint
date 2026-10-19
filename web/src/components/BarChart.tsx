import { cn } from "@/lib/utils";

export type Bar = { key: string; label: string; value: number; display: string };

type Props = {
  /** The accessible name of the plot, e.g. "Answers per day". */
  name: string;
  caption: string;
  bars: Bar[];
  /** Shown inside the plot when the server had nothing to count. */
  empty?: boolean;
  showValues?: boolean;
  className?: string;
};

const PLOT_HEIGHT = 96;

/**
 * A small bar chart drawn with boxes rather than a canvas or a charting library: the bars keep the
 * theme's colours, the labels keep the page's type scale, and the whole plot is one image with a name.
 */
export default function BarChart({ name, caption, bars, empty = false, showValues = true, className }: Props) {
  const max = Math.max(1, ...bars.map((bar) => bar.value));

  return (
    <figure className={cn("min-w-0 rounded-lg border border-border bg-card p-4", className)}>
      <figcaption className="text-sm font-medium">{caption}</figcaption>
      <div role="img" aria-label={name} className="mt-3">
        {empty || !bars.length ? (
          <p className="flex min-h-[96px] items-center text-sm text-muted-foreground">No data yet</p>
        ) : (
          <div className="flex items-end gap-1">
            {bars.map((bar) => (
              <div key={bar.key} className="flex min-w-0 flex-1 flex-col items-center">
                {showValues && (
                  <span className="text-xs tabular-nums text-muted-foreground">{bar.display}</span>
                )}
                <div className="flex w-full items-end justify-center" style={{ height: PLOT_HEIGHT }}>
                  <div
                    className="w-full max-w-[46px] rounded-t bg-primary"
                    style={{ height: Math.max(2, Math.round((bar.value / max) * (PLOT_HEIGHT - 4))) }}
                  />
                </div>
                <span className="mt-1 w-full truncate text-center text-xs text-muted-foreground">{bar.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </figure>
  );
}
