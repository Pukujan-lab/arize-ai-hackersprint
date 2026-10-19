import { useEffect, useRef, useState } from "react";
import { Minus, Plus, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { MapEngine, type MapView } from "@/map/engine";

const PIN_COLORS: Record<string, string> = {
  county: "#10b981",
  state: "#6366f1",
  statute: "#f59e0b",
  federal: "#ec4899",
};

/** One press of a zoom button, and how far one wheel notch pulls the map in or out. */
const ZOOM_STEP = 1.6;
const WHEEL_ZOOM = 0.0015;
/** Below this a pointer has not moved enough to be a drag, so a tap on a pin stays a click. */
const DRAG_SLOP = 5;

const zoomButtonClass =
  "grid h-11 w-11 place-items-center rounded-md border border-border bg-card/95 text-card-foreground shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground";

type Props = {
  engine: MapEngine;
  view: MapView;
  pane: "memo" | "map";
  onShowMemo: () => void;
};

export default function MapPane({ engine, view, pane, onShowMemo }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const controlsRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  /** Set once a press has travelled far enough to be a drag, so the press cannot also click a pin. */
  const draggedRef = useRef(false);
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
      const controls = controlsRef.current;
      if (!controls) return;
      const box = controls.getBoundingClientRect();
      engine.setAvoidRects([
        { x: box.left - rect.left, y: box.top - rect.top, w: box.width, h: box.height },
      ]);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    if (controlsRef.current) observer.observe(controlsRef.current);
    return () => observer.disconnect();
  }, [engine]);

  // React's own wheel handler is passive, so the listener that can hold the page still is this one.
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      engine.stopTour();
      const rect = element.getBoundingClientRect();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 100 : 1;
      const factor = Math.exp(-event.deltaY * unit * WHEEL_ZOOM);
      engine.zoomAround(factor, event.clientX - rect.left, event.clientY - rect.top);
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
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
        "col-start-1 row-start-2 flex min-h-0 min-w-0 flex-col border-border lg:col-start-2 lg:row-start-1 lg:row-span-2 lg:border-l",
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
        className="relative min-h-0 flex-1 touch-none overflow-hidden bg-background"
        onMouseLeave={() => {
          countyRef.current = null;
          engine.clearTooltip();
        }}
        onPointerDown={(event) => {
          draggedRef.current = false;
          dragRef.current = { x: event.clientX, y: event.clientY };
        }}
        onPointerMove={(event) => {
          const start = dragRef.current;
          if (!start) return;
          // A mouse released outside the pane never sends its own pointerup, so stop here instead.
          if (event.pointerType === "mouse" && !event.buttons) {
            dragRef.current = null;
            return;
          }
          const dx = event.clientX - start.x;
          const dy = event.clientY - start.y;
          if (!draggedRef.current) {
            if (Math.hypot(dx, dy) <= DRAG_SLOP) return;
            draggedRef.current = true;
            engine.stopTour();
          }
          dragRef.current = { x: event.clientX, y: event.clientY };
          engine.panBy(dx, dy);
        }}
        onPointerUp={() => {
          dragRef.current = null;
        }}
        onPointerCancel={() => {
          dragRef.current = null;
        }}
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
              onClick={() => {
                // The press that ended this click may have been a drag across the map.
                if (!draggedRef.current) engine.focus(pin.index);
              }}
            >
              <span
                className="block rounded-full ring-2 ring-white/70"
                style={{ width: size, height: size, background: PIN_COLORS[pin.cat] || "#94a3b8" }}
              />
            </button>
          );
        })}

        <div
          ref={controlsRef}
          role="group"
          aria-label="Map view"
          className="absolute right-1 top-14 flex flex-col gap-1"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            aria-label="Zoom in"
            className={zoomButtonClass}
            onClick={() => engine.zoomAround(ZOOM_STEP)}
          >
            <Plus aria-hidden="true" className="h-5 w-5" />
          </button>
          <button
            type="button"
            aria-label="Zoom out"
            className={zoomButtonClass}
            onClick={() => engine.zoomAround(1 / ZOOM_STEP)}
          >
            <Minus aria-hidden="true" className="h-5 w-5" />
          </button>
          <button
            type="button"
            aria-label="Reset view"
            className={zoomButtonClass}
            onClick={() => engine.resetCamera()}
          >
            <RotateCcw aria-hidden="true" className="h-5 w-5" />
          </button>
        </div>

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
