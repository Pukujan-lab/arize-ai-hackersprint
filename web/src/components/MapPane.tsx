import { useEffect, useRef, useState } from "react";
import { Layers, Minus, Plus, RotateCcw } from "lucide-react";
import { citeType, type Citation } from "@/lib/citations";
import { cn } from "@/lib/utils";
import { sourceHref } from "@/components/Memo";
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

const LEGEND: { colour: string; label: string }[] = [
  { colour: "#10b981", label: "county↔county" },
  { colour: "#3b82f6", label: "county → court" },
  { colour: "#f59e0b", label: "statute" },
  { colour: "#ec4899", label: "federal" },
];

type Props = {
  engine: MapEngine;
  view: MapView;
  pane: "memo" | "map";
  citations: Citation[];
  onShowMemo: () => void;
};

/** A passage as an excerpt: whitespace collapsed, cut at a word, so its opening reads intact. */
function excerpt(text: string, max = 220): string {
  const clean = String(text || "")
    .replace(/\s+/g, " ")
    .trim();
  if (clean.length <= max) return clean;
  return clean.slice(0, max).replace(/[,;:.\s]+\S*$/, "") + "…";
}

export default function MapPane({ engine, view, pane, citations, onShowMemo }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const controlsRef = useRef<HTMLDivElement | null>(null);
  const keyRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  /** Set once a press has travelled far enough to be a drag, so the press cannot also click a pin. */
  const draggedRef = useRef(false);
  const countyRef = useRef<string | null>(null);
  const [basemap, setBasemap] = useState(true);
  const [keyOpen, setKeyOpen] = useState(false);
  /** The citation whose authority is open. One at a time: a second pin replaces the first. */
  const [authority, setAuthority] = useState<number | null>(null);

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
      const rects: { x: number; y: number; w: number; h: number }[] = [];
      for (const node of [controlsRef.current, keyRef.current]) {
        if (!node) continue;
        const box = node.getBoundingClientRect();
        rects.push({ x: box.left - rect.left, y: box.top - rect.top, w: box.width, h: box.height });
      }
      engine.setAvoidRects(rects);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    if (controlsRef.current) observer.observe(controlsRef.current);
    return () => observer.disconnect();
  }, [engine, keyOpen]);

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

  // The map key closes on Escape and on a click outside it, like any other drawer.
  useEffect(() => {
    if (!keyOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setKeyOpen(false);
    };
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (keyRef.current && target && keyRef.current.contains(target)) return;
      setKeyOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [keyOpen]);

  // Escape closes the authority detail, as it closes every other panel on the page.
  useEffect(() => {
    if (authority === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAuthority(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [authority]);

  // A new run draws new pins; a detail that no pin stands for any more is closed, not left stale.
  useEffect(() => {
    if (authority === null || !view.pins.length) return;
    if (!view.pins.some((pin) => pin.items.includes(authority))) setAuthority(null);
  }, [authority, view.pins]);

  const trackCounty = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const key = engine.countyAtScreen(event.clientX - rect.left, event.clientY - rect.top);
    if (key === countyRef.current) return;
    countyRef.current = key;
    if (key) engine.hoverCounty(key);
    else engine.clearTooltip();
  };

  const clickMap = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (draggedRef.current) return;
    setAuthority(null);
    const rect = event.currentTarget.getBoundingClientRect();
    const key = engine.countyAtScreen(event.clientX - rect.left, event.clientY - rect.top);
    if (key) engine.zoomToCounty(key);
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
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-2 py-1 text-xs">
        <span className="shrink-0 font-semibold">Citation map</span>
        <span className="min-w-0 truncate text-muted-foreground">{view.summary}</span>
        {view.label && <span className="ml-auto min-w-0 truncate font-medium">{view.label}</span>}
        <button
          type="button"
          onClick={onShowMemo}
          className="ml-auto h-11 shrink-0 rounded-md border border-border px-3 text-xs font-medium lg:hidden"
        >
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
        <canvas
          ref={canvasRef}
          className="absolute inset-0 h-full w-full"
          onMouseMove={trackCounty}
          onClick={clickMap}
        />

        {view.labels.map((label) => (
          <div
            key={label.key}
            className={cn(
              "pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded px-1 text-xs leading-tight",
              label.strong
                ? "bg-card/90 font-semibold text-card-foreground shadow-sm"
                : "bg-card/60 text-muted-foreground",
            )}
            style={{ left: label.x, top: label.y }}
          >
            {label.text}
          </div>
        ))}

        {view.pins.map((pin) => {
          const size = Math.min(22, 10 + pin.count * 3);
          const colour = PIN_COLORS[pin.cat] || "#94a3b8";
          return (
            <button
              key={pin.key}
              type="button"
              aria-label={pin.titles.join("; ")}
              className="absolute grid h-11 w-11 place-items-center rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              style={{ left: pin.x, top: pin.y, transform: "translate(-50%, -50%)" }}
              onMouseEnter={() => engine.hoverPin(pin.key)}
              onMouseLeave={() => engine.clearTooltip()}
              onFocus={() => engine.hoverPin(pin.key)}
              onBlur={() => engine.clearTooltip()}
              onClick={(event) => {
                // The press that ended this click may have been a drag across the map.
                if (draggedRef.current) return;
                // The dot is the target; the rest of the 44px box belongs to the place underneath it,
                // so a county whose centre sits beside a pin is still reachable.
                const box = event.currentTarget.getBoundingClientRect();
                const off = Math.hypot(
                  event.clientX - (box.left + box.width / 2),
                  event.clientY - (box.top + box.height / 2),
                );
                if (off <= size / 2 + 1) {
                  engine.openAuthority(pin.index);
                  setAuthority(pin.index);
                  return;
                }
                const pane = containerRef.current;
                if (!pane) return;
                const rect = pane.getBoundingClientRect();
                const key = engine.countyAtScreen(event.clientX - rect.left, event.clientY - rect.top);
                if (key) engine.zoomToCounty(key);
              }}
            >
              <span
                className="block rounded-full ring-2 ring-white/70"
                style={{ width: size, height: size, background: colour }}
              />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute left-1/2 top-full h-[18px] w-px -translate-x-1/2"
                style={{ background: colour, opacity: 0.65 }}
              />
            </button>
          );
        })}

        <div
          ref={controlsRef}
          role="group"
          aria-label="Map view"
          className="absolute right-2 top-2 z-20 flex flex-col items-end gap-1"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            aria-label="Map key"
            aria-expanded={keyOpen}
            className="flex h-11 items-center gap-1 rounded-md border border-border bg-card/95 px-2 text-xs font-medium text-card-foreground shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground"
            onClick={() => setKeyOpen((open) => !open)}
          >
            <Layers aria-hidden="true" className="h-4 w-4" />
            Map key
          </button>
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
            onClick={() => engine.zoomOutLevel()}
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

        {keyOpen && (
          <div
            ref={keyRef}
            className="absolute right-[4.75rem] top-2 z-30 max-h-[calc(100%-1rem)] w-[13rem] max-w-[calc(100%-5.5rem)] overflow-y-auto rounded-md border border-border bg-card/95 p-2 text-xs text-card-foreground shadow-lg"
          >
            <div className="font-semibold">Legend</div>
            <div className="mt-1 space-y-0.5">
              {LEGEND.map((row) => (
                <div key={row.label} className="flex items-center gap-1.5">
                  <span aria-hidden="true" style={{ color: row.colour }}>
                    ━
                  </span>
                  <span>{row.label}</span>
                </div>
              ))}
            </div>
            <div className="mt-2 border-t border-border pt-1 text-muted-foreground">{view.summary}</div>
            <label className="mt-1 flex items-center gap-1">
              <input
                type="checkbox"
                aria-label="Basemap"
                className="h-11 w-11 accent-indigo-500"
                checked={basemap}
                onChange={(event) => {
                  setBasemap(event.target.checked);
                  engine.setBasemap(event.target.checked);
                }}
              />
              <span>Basemap</span>
            </label>
            <div className="mt-1 text-muted-foreground">Basemap © Esri, HERE, Garmin, © OpenStreetMap contributors</div>
          </div>
        )}

        {authority !== null && citations[authority] && (
          // Informational, so it passes clicks through to the map and the pins beneath it: the
          // only things in it that take a press are Close and the link to the document.
          <div
            role="dialog"
            aria-label="Authority"
            className="pointer-events-none absolute bottom-2 left-2 right-2 z-20 rounded-md border border-border bg-card/95 px-3 py-2 text-xs text-card-foreground shadow-lg sm:right-auto sm:w-[22rem]"
          >
            <div className="flex items-start gap-2">
              <h2 className="mr-auto min-w-0 text-sm font-semibold">
                {citations[authority].title || citations[authority].citation || "Authority"}
              </h2>
              <button
                type="button"
                className="pointer-events-auto h-11 w-11 shrink-0 rounded-md border border-border text-xs font-medium"
                onClick={() => setAuthority(null)}
              >
                Close
              </button>
            </div>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-muted-foreground">
              <span>{citeType(citations[authority])}</span>
              <span>{citations[authority].court || "Court not recorded"}</span>
              <span>{citations[authority].date || "Date not recorded"}</span>
            </div>
            {citations[authority].passage ? (
              <p className="mt-1 leading-relaxed">“{excerpt(citations[authority].passage || "")}”</p>
            ) : (
              <p className="mt-1 text-muted-foreground">No passage was retrieved — from the citation graph.</p>
            )}
            <a
              className="pointer-events-auto mt-1 inline-block text-xs font-medium underline underline-offset-2"
              href={sourceHref(citations[authority])}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open the document
            </a>
          </div>
        )}

        {view.tooltip && authority === null && (
          <div className="pointer-events-none absolute bottom-2 left-2 right-2 rounded-md border border-border bg-card/95 px-3 py-2 text-xs text-card-foreground shadow">
            {view.tooltip}
          </div>
        )}
      </div>

      {tour.active && (
        <div
          role="log"
          aria-label="Tour transcript"
          className="max-h-24 shrink-0 overflow-y-auto border-t border-border px-3 py-2 text-xs leading-relaxed text-muted-foreground"
        >
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
