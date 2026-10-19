// The map's product-internal debug surface, used by the browser tests to assert behaviour
// without reading pixels. Not a public API.

import type { Citation, Edge } from "@/lib/citations";
import type { MapEngine } from "./engine";

export function installDebug(engine: MapEngine): void {
  const api = {
    get ready() {
      return engine.ready;
    },
    state: () => engine.state(),
    view: () => engine.view(),
    setCites: (cites: Citation[], edges: Edge[], ctx: { question?: string; answer?: string }) =>
      engine.setCites(cites, edges, ctx),
    order: () => engine.order(),
    explainText: (i: number) => engine.explainText(i),
    spokenTextAt: (position: number) => engine.spokenTextAt(position),
    focus: (i: number) => engine.focus(i),
    tour: (n?: number) => engine.startTour(n),
    stopTour: () => engine.stopTour(),
    resetCamera: () => engine.resetCamera(),
    zoomToCounty: (name: string) => engine.zoomToCounty(name),
    zoomToCourt: (i: number) => engine.zoomToCourt(i),
    zoomOutLevel: () => engine.zoomOutLevel(),
    countyScreen: (name: string) => engine.countyScreen(name),
    pinScreen: (i: number) => engine.pinScreen(i),
    pinCites: (i: number) => engine.pinCites(i),
    hoverCounty: (key: string | null) => engine.hoverCounty(key),
    tooltip: () => engine.tooltip(),
    /** Every label actually drawn, in screen coordinates, with the box it occupies. */
    labels: () =>
      engine.labels.map((label) => ({
        key: label.key,
        text: label.text,
        x: label.x,
        y: label.y,
        w: label.w,
        h: label.h,
      })),
    /** The stops the walk will take, in the order it will take them. */
    tourPlan: () => engine.plan().map((stop) => ({ section: stop.section, text: stop.text })),
    caption: () => engine.caption(),
    shortAnswer: () => engine.shortAnswer(),
    get pinCount() {
      return engine.pinCount;
    },
    get countyCount() {
      return engine.countyCount;
    },
    get countyMeshCount() {
      return engine.countyMeshCount;
    },
    get stateMeshCount() {
      return engine.stateMeshCount;
    },
    get countyOutlineCount() {
      return engine.countyOutlineCount;
    },
    get arcCounts() {
      return engine.arcCounts;
    },
    get arcsDrawn() {
      return engine.arcsDrawn;
    },
    scene: () => engine.scene(),
    pins: () => engine.pinList(),
    countyHeat: () => engine.heat,
    summary: () => engine.summary(),
  };
  (window as unknown as { __precedentMap?: unknown }).__precedentMap = { v1: api };
}
