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
    setCites: (cites: Citation[], edges: Edge[], ctx: { question?: string; answer?: string }) =>
      engine.setCites(cites, edges, ctx),
    order: () => engine.order(),
    explainText: (i: number) => engine.explainText(i),
    focus: (i: number) => engine.focus(i),
    tour: (n?: number) => engine.startTour(n),
    stopTour: () => engine.stopTour(),
    resetCamera: () => engine.resetCamera(),
    zoomToCounty: (name: string) => engine.zoomToCounty(name),
    zoomToCourt: (i: number) => engine.zoomToCourt(i),
    zoomOutLevel: () => engine.zoomOutLevel(),
    countyScreen: (name: string) => engine.countyScreen(name),
    pinScreen: (i: number) => engine.pinScreen(i),
    hoverCounty: (key: string | null) => engine.hoverCounty(key),
    tooltip: () => engine.tooltip(),
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
    get arcCounts() {
      return engine.arcCounts;
    },
    pins: () => engine.pinList(),
    countyHeat: () => engine.heat,
    summary: () => engine.summary(),
  };
  (window as unknown as { __precedentMap?: unknown }).__precedentMap = { v1: api };
}
