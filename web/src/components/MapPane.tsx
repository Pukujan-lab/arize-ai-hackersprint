import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { MapEngine, type MapView } from "@/map/engine";

const PIN_COLORS: Record<string, string> = {
  county: "#10b981",
  state: "#6366f1",
  statute: "#f59e0b",
  federal: "#ec4899",
};

type Props = {
  engine: MapEngine;
  view: MapView;
  pane: "memo" | "map";
  onShowMemo: () => void;
};

export default function MapPane({ engine, view, pane, onShowMemo }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const countyRef = useRef<string | null>(null);
  const [basemap, setBasemap] = useState(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) void engine.init(canvas);
  }, [engine]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      engine.resize(Math.round(rect.width), Math.round(rect.height));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [engine]);

  const trackCounty = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const key = engine.countyAtScreen(event.clientX - rect.left, event.clientY - rect.top);
    if (key === countyRef.current) return;
    countyRef.current = key;
    if (key) engine.hoverCounty(key);
    else engine.clearTooltip();
  };

  const tour = view.tour;
  const position = tour.count ? Math.min(tour.index + 1, tour.count) : 1;

  return (
    <section
      className={cn(
        "col-start-1 row-start-1 flex min-h-0 min-w-0 flex-col border-border lg:col-start-2 lg:border-l",
        pane !== "map" && "invisible lg:visible",
      )}
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-2 py-1 lg:hidden">
        <span className="text-xs font-semibold text-muted-foreground">Citation map</span>
        <button type="button" onClick={onShowMemo} className="h-11 rounded-md border border-border px-3 text-xs font-medium">
          Show memo
        </button>
      </div>

      <div
        ref={containerRef}
        className="relative min-h-0 flex-1 overflow-hidden bg-background"
        onMouseLeave={() => {
          countyRef.current = null;
          engine.clearTooltip();
        }}
        onPointerDown={(event) => {
          dragRef.current = { x: event.clientX, y: event.clientY };
        }}
        onPointerMove={(event) => {
          const start = dragRef.current;
          if (!start || !event.buttons) return;
          if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5) {
            dragRef.current = null;
            engine.stopTour();
          }
        }}
        onPointerUp={() => {
          dragRef.current = null;
        }}
        onWheel={() => engine.stopTour()}
      >
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" onMouseMove={trackCounty} />

        <div className="pointer-events-none absolute left-2 top-1 max-w-[56%] rounded-md bg-card/90 px-2 py-1 text-xs leading-snug text-card-foreground shadow-sm">
          <div className="font-semibold">U.S. citation map · Colorado focus</div>
          <div>{view.summary}</div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-muted-foreground">
            <span>
              <span style={{ color: "#10b981" }}>━</span> county↔county
            </span>
            <span>
              <span style={{ color: "#3b82f6" }}>━</span> county → court
            </span>
            <span>
              <span style={{ color: "#f59e0b" }}>━</span> statute
            </span>
            <span>
              <span style={{ color: "#ec4899" }}>━</span> federal
            </span>
          </div>
        </div>

        <label className="absolute right-1 top-1 flex h-11 items-center gap-1 rounded-md bg-card/90 px-1 text-xs text-card-foreground shadow-sm">
          <input
            type="checkbox"
            className="h-11 w-11 accent-indigo-500"
            checked={basemap}
            onChange={(event) => {
              setBasemap(event.target.checked);
              engine.setBasemap(event.target.checked);
            }}
          />
          <span className="pr-1">Basemap</span>
        </label>

        {view.basemapReady && basemap && (
          <div className="pointer-events-none absolute bottom-0 right-1 rounded-t bg-background/80 px-1 text-xs text-muted-foreground">
            Basemap © Esri, HERE, Garmin, © OpenStreetMap contributors
          </div>
        )}

        {view.pins.map((pin) => {
          const size = Math.min(22, 10 + pin.count * 3);
          return (
            <button
              key={pin.key}
              type="button"
              aria-label={pin.titles.join("; ")}
              className="absolute grid place-items-center rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              style={{ left: pin.x, top: pin.y, width: 44, height: 44, transform: "translate(-50%, -50%)" }}
              onMouseEnter={() => engine.hoverPin(pin.key)}
              onMouseLeave={() => engine.clearTooltip()}
              onFocus={() => engine.hoverPin(pin.key)}
              onBlur={() => engine.clearTooltip()}
              onClick={() => engine.focus(pin.index)}
            >
              <span
                className="block rounded-full ring-2 ring-white/70"
                style={{ width: size, height: size, background: PIN_COLORS[pin.cat] || "#94a3b8" }}
              />
            </button>
          );
        })}

        {view.tooltip && (
          <div className="pointer-events-none absolute bottom-2 left-2 right-2 rounded-md border border-border bg-card/95 px-3 py-2 text-xs text-card-foreground shadow">
            {view.tooltip}
          </div>
        )}
      </div>

      {tour.active && (
        <div className="max-h-28 shrink-0 overflow-y-auto border-t border-border px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          {engine.spokenTextAt(tour.index)}
        </div>
      )}

      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-t border-border px-2 py-1.5">
        <button
          type="button"
          aria-label="Previous stop"
          className="grid h-11 w-11 place-items-center rounded-md border border-border text-sm"
          onClick={() => engine.previousStop()}
        >
          ‹
        </button>
        <button
          type="button"
          aria-label={tour.playing ? "Pause" : "Play"}
          className="grid h-11 w-11 place-items-center rounded-md border border-border text-sm"
          onClick={() => (tour.playing ? engine.pauseTour() : engine.startTour())}
        >
          {tour.playing ? "❙❙" : "▶"}
        </button>
        <button
          type="button"
          aria-label="Next stop"
          className="grid h-11 w-11 place-items-center rounded-md border border-border text-sm"
          onClick={() => engine.nextStop()}
        >
          ›
        </button>
        <button
          type="button"
          aria-label="Stop tour"
          className="h-11 rounded-md border border-border px-3 text-xs font-medium"
          onClick={() => engine.stopTour()}
        >
          Stop tour
        </button>
        <span className="px-1 text-xs font-medium">
          Stop {position} of {tour.count}
        </span>
      </div>
    </section>
  );
}
