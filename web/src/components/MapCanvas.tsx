import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Compass,
  Layers,
  Minus,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Square,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { MapEngine, MapView } from "@/map/engine";

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
/** How much one pixel of an orbit drag turns the camera, in degrees. */
const ORBIT_PER_PX = 0.32;

const buttonClass =
  "grid h-9 w-9 place-items-center rounded-md border border-border bg-card/95 text-card-foreground shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground";

const LEGEND: { colour: string; label: string }[] = [
  { colour: "#10b981", label: "county ↔ county" },
  { colour: "#3b82f6", label: "county → court" },
  { colour: "#f59e0b", label: "statute" },
  { colour: "#ec4899", label: "federal" },
];

type Props = {
  engine: MapEngine;
  view: MapView;
  /** Where the answer came from, as the memo states it. */
  source: string;
  onSelectAuthority: (index: number) => void;
  onOpenLayers: () => void;
};

/** What the speaker is doing, in the page's own words. */
function speakerStatus(status: string): string {
  if (status === "loading") return "audio loading…";
  if (status === "speaking") return "speaking";
  if (status === "unavailable") return "audio unavailable — the transcript carries on";
  if (status === "silent") return "silent";
  return "not speaking";
}

/**
 * The citation map, drawn full-bleed. The engine owns the geometry; this component owns the pointer,
 * the floating controls and the labels that sit on top of the canvas. Dragging pans, a right-button
 * (or shift) drag orbits the camera, and the wheel zooms where the pointer is.
 */
export default function MapCanvas({ engine, view, source, onSelectAuthority, onOpenLayers }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const controlsRef = useRef<HTMLDivElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ x: number; y: number; orbit: boolean } | null>(null);
  /** Set once a press has travelled far enough to be a drag, so the press cannot also click a pin. */
  const draggedRef = useRef(false);
  const countyRef = useRef<string | null>(null);
  const [hint, setHint] = useState(true);

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
      // The controls and the tour bar cover part of the canvas, so pins and labels are kept clear of both.
      for (const node of [controlsRef.current, barRef.current]) {
        if (!node) continue;
        const box = node.getBoundingClientRect();
        rects.push({ x: box.left - rect.left, y: box.top - rect.top, w: box.width, h: box.height });
      }
      engine.setAvoidRects(rects);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    // The bar grows when the transcript appears, which moves the ground it covers.
    if (barRef.current) observer.observe(barRef.current);
    return () => observer.disconnect();
  }, [engine]);

  // React's own wheel handler is passive, so the listener that can hold the page still is this one.
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 100 : 1;
      const factor = Math.exp(-event.deltaY * unit * WHEEL_ZOOM);
      engine.zoomAround(factor, event.clientX - rect.left, event.clientY - rect.top);
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [engine]);

  // The hint has done its job once the reader has touched the map.
  useEffect(() => {
    if (!hint) return;
    const timer = window.setTimeout(() => setHint(false), 9000);
    return () => window.clearTimeout(timer);
  }, [hint]);

  const trackCounty = (event: ReactMouseEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const key = engine.countyAtScreen(event.clientX - rect.left, event.clientY - rect.top);
    if (key === countyRef.current) return;
    countyRef.current = key;
    if (key) engine.hoverCounty(key);
    else engine.clearTooltip();
  };

  const clickMap = (event: ReactMouseEvent<HTMLCanvasElement>) => {
    if (draggedRef.current) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const key = engine.countyAtScreen(event.clientX - rect.left, event.clientY - rect.top);
    if (key) engine.zoomToCounty(key);
  };

  const tour = view.tour;
  const position = tour.count ? Math.min(tour.index + 1, tour.count) : 1;
  const speaking = tour.active || view.narrating || view.speaker.status === "unavailable";
  const tilted = Math.round(view.orbit.tilt) !== 58 || Math.round(view.orbit.yaw) !== 0;

  return (
    <div
      ref={containerRef}
      className="relative h-full min-h-0 w-full touch-none overflow-hidden bg-background"
      onContextMenu={(event) => event.preventDefault()}
      onMouseLeave={() => {
        countyRef.current = null;
        engine.clearTooltip();
      }}
      onPointerDown={(event) => {
        setHint(false);
        draggedRef.current = false;
        dragRef.current = { x: event.clientX, y: event.clientY, orbit: event.button === 2 || event.shiftKey };
        // Capture every press, so a drag that leaves the pane keeps moving the map until it is released.
        event.currentTarget.setPointerCapture(event.pointerId);
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
        dragRef.current = { x: event.clientX, y: event.clientY, orbit: start.orbit };
        if (start.orbit) {
          // Dragging up lifts the camera towards the horizon; dragging across turns it about the point.
          engine.orbitBy(dy * ORBIT_PER_PX, -dx * ORBIT_PER_PX);
        } else {
          engine.panBy(dx, dy);
        }
      }}
      onPointerUp={() => {
        dragRef.current = null;
      }}
      onPointerCancel={() => {
        dragRef.current = null;
      }}
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" onMouseMove={trackCounty} onClick={clickMap} />

      {view.labels.map((label) => (
        <div
          key={label.key}
          className={cn(
            "pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 overflow-hidden text-center text-[11px] leading-tight whitespace-nowrap",
            label.strong
              ? "rounded bg-card/90 font-semibold text-card-foreground shadow-sm"
              : "rounded bg-card/60 text-muted-foreground",
          )}
          style={{ left: label.x, top: label.y, width: label.w, height: label.h, lineHeight: `${label.h}px` }}
        >
          {label.text}
        </div>
      ))}

      {view.layers.pins &&
        view.pins.map((pin) => {
          const size = Math.min(22, 10 + pin.count * 3);
          const dot = Math.max(2, Math.round(size * pin.scale));
          const colour = PIN_COLORS[pin.cat] || "#94a3b8";
          return (
            <button
              key={pin.key}
              type="button"
              aria-label={pin.titles.join("; ")}
              aria-current={pin.active ? "true" : undefined}
              className="absolute grid h-11 w-11 place-items-center rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              style={{ left: pin.x, top: pin.y, transform: "translate(-50%, -50%)" }}
              onMouseEnter={() => engine.hoverPin(pin.key)}
              onMouseLeave={() => engine.clearTooltip()}
              onFocus={() => engine.hoverPin(pin.key)}
              onBlur={() => engine.clearTooltip()}
              onClick={(event) => {
                if (draggedRef.current) return;
                const box = event.currentTarget.getBoundingClientRect();
                const off = Math.hypot(
                  event.clientX - (box.left + box.width / 2),
                  event.clientY - (box.top + box.height / 2),
                );
                if (off <= size / 2 + 1) {
                  engine.openAuthority(pin.index);
                  onSelectAuthority(pin.index);
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
                className="block rounded-full ring-2 ring-white/70 transition-transform"
                style={{
                  width: dot,
                  height: dot,
                  background: colour,
                  boxShadow: pin.active ? "0 0 0 3px rgba(255,255,255,0.4)" : undefined,
                }}
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
        className="absolute right-3 top-3 z-20 flex flex-col items-end gap-1"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          aria-label="Map layers"
          className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-card/95 px-2.5 text-xs font-medium text-card-foreground shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground"
          onClick={onOpenLayers}
        >
          <Layers aria-hidden="true" className="h-4 w-4" />
          Layers
        </button>
        <button type="button" aria-label="Zoom in" className={buttonClass} onClick={() => engine.zoomAround(ZOOM_STEP)}>
          <Plus aria-hidden="true" className="h-4 w-4" />
        </button>
        <button
          type="button"
          aria-label="Zoom out"
          className={buttonClass}
          onClick={() => engine.zoomAround(1 / ZOOM_STEP)}
        >
          <Minus aria-hidden="true" className="h-4 w-4" />
        </button>
        <button type="button" aria-label="Reset view" className={buttonClass} onClick={() => engine.resetCamera()}>
          <RotateCcw aria-hidden="true" className="h-4 w-4" />
        </button>
        <button
          type="button"
          aria-label="Reset camera angle"
          aria-pressed={tilted}
          className={cn(buttonClass, tilted && "border-primary/60 text-primary")}
          onClick={() => engine.resetOrbit()}
        >
          <Compass aria-hidden="true" className="h-4 w-4" />
        </button>
      </div>

      <div className="pointer-events-none absolute left-3 top-3 z-10 max-w-[min(22rem,calc(100%-5rem))] rounded-md border border-border bg-card/90 px-2.5 py-1.5 text-[11px] leading-snug text-card-foreground shadow-sm">
        <div className="flex items-center gap-1.5">
          <span className="font-semibold">{view.label || view.level}</span>
          {view.answer && (
            <span className="truncate rounded border border-border px-1 py-px font-medium">{source}</span>
          )}
        </div>
        <p className="mt-0.5 line-clamp-2 text-muted-foreground">{view.summary}</p>
        <p className="mt-0.5 text-muted-foreground">
          {Math.round(view.orbit.tilt)}° tilt · {Math.round(view.orbit.yaw)}° bearing
        </p>
      </div>

      <div ref={barRef} className="absolute inset-x-0 bottom-0 z-20 border-t border-border bg-card/95 backdrop-blur">
        {/* The key, the hint and the tooltip sit above the bar, so the bar's own height never covers them. */}
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 px-3 pt-1.5 text-[10px] text-muted-foreground">
          {LEGEND.map((row) => (
            <span key={row.label} className="flex items-center gap-1">
              <span aria-hidden="true" className="h-0.5 w-3 rounded" style={{ background: row.colour }} />
              {row.label}
            </span>
          ))}
          {hint && (
            <span className="ml-auto text-[10px] leading-snug">
              Drag to pan · right-drag or shift-drag to orbit · scroll to zoom
            </span>
          )}
        </div>
        {view.tooltip && (
          <div
            role="status"
            className="mx-3 mb-1 rounded-md border border-border bg-background/80 px-2.5 py-1 text-[11px] leading-snug text-card-foreground"
          >
            {view.tooltip}
          </div>
        )}
        {speaking && (
          <div
            role="log"
            aria-label="Tour transcript"
            className="max-h-16 overflow-y-auto border-b border-border px-3 py-1 text-[11px] leading-relaxed text-muted-foreground"
          >
            <span className="font-medium text-foreground">{view.caption.section}</span>
            <span aria-hidden="true"> · </span>
            {view.captionText.slice(0, view.caption.shown)}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-1.5 px-2 py-1.5 text-xs">
          <button
            type="button"
            aria-label="Previous stop"
            className={cn(buttonClass, "disabled:opacity-40")}
            disabled={!tour.count}
            onClick={() => engine.previousStop()}
          >
            <ChevronLeft aria-hidden="true" className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label={tour.playing ? "Pause the walk" : "Play the walk"}
            className={cn(buttonClass, "disabled:opacity-40")}
            disabled={!tour.count}
            onClick={() => (tour.playing ? engine.pauseTour() : engine.startTour())}
          >
            {tour.playing ? (
              <Pause aria-hidden="true" className="h-4 w-4" />
            ) : (
              <Play aria-hidden="true" className="h-4 w-4" />
            )}
          </button>
          <button
            type="button"
            aria-label="Next stop"
            className={cn(buttonClass, "disabled:opacity-40")}
            disabled={!tour.count}
            onClick={() => engine.nextStop()}
          >
            <ChevronRight aria-hidden="true" className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="Stop the walk"
            className="flex h-9 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
            onClick={() => engine.stopTour()}
          >
            <Square aria-hidden="true" className="h-3.5 w-3.5" />
            Stop
          </button>
          <span className="px-1 font-medium">
            Stop {position} of {tour.count || 0}
          </span>
          <span className="ml-auto flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
            <span
              aria-hidden="true"
              className={cn(
                "h-2 w-2 shrink-0 rounded-full",
                view.speaker.active ? "animate-pulse bg-emerald-400 motion-reduce:animate-none" : "bg-muted-foreground/40",
              )}
            />
            <span className="shrink-0 font-medium text-foreground">{view.speaker.name}</span>
            <span className="truncate">{speakerStatus(view.speaker.status)}</span>
          </span>
        </div>
      </div>
    </div>
  );
}
