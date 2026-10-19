// The citation map: extruded states, the raised Colorado county layer, typed links, pins and the tour.
// The scene is drawn by the WebGL renderer in a perspective camera; where the browser has no
// three-dimensional surface it falls back to a flat drawing of the same geometry, and the debug surface
// says which one is on screen. Pins are real buttons laid out in screen space above the surface.

import {
  arcType,
  jurisdictionCount,
  locate,
  titleCase,
  type ArcType,
  type Category,
  type Citation,
  type Edge,
  type Location,
} from "@/lib/citations";
import { explainParts, spokenText, type StopParts } from "@/lib/explain";
import {
  NATIONAL_CAMERA,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  loadWorld,
  project,
  unproject,
  type CountyShape,
  type World,
} from "@/lib/geo";
import {
  SURFACE_Y,
  SceneRenderer,
  buildCamera,
  buildScene,
  projectPoint,
  unprojectGround,
  type Camera3,
  type SceneBuffers,
} from "./gl";
import { narrate, prefetchClip, type Narration } from "./narrator";

export type Camera = { x: number; y: number; zoom: number };
export type TourState = { active: boolean; index: number; count: number; playing: boolean };
export type Level = "national" | "state" | "county" | "court";

/** How far the reader may pull the map out of, or into, the national view. */
const MIN_ZOOM = 0.6;
const MAX_ZOOM = 10;
/** The camera distance each jurisdiction view sits at. */
const LEVEL_ZOOM: Record<Level, number> = { national: 1, state: 2.9, county: 5.2, court: 8.6 };

export type PinView = {
  key: string;
  cat: Category;
  label: string;
  count: number;
  titles: string[];
  items: number[];
  index: number;
  x: number;
  y: number;
  ax: number;
  ay: number;
};

export type LabelView = { key: string; text: string; x: number; y: number; strong: boolean };

export type MapView = {
  pins: PinView[];
  labels: LabelView[];
  tooltip: string | null;
  summary: string;
  level: Level;
  label: string | null;
  tour: TourState;
  narrating: boolean;
  basemapReady: boolean;
};

type Group = Location & { items: number[] };
type Rect = { x: number; y: number; w: number; h: number };
type Arc = { from: [number, number]; to: [number, number]; type: ArcType };

const CAMERA_MS = 700;
/** A stop the reader arrives at holds long enough to read before the tour moves on. */
const STOP_HOLD_MS = 2600;
const PIN_SIZE = 44;
/** How far above its anchor a pin's button stands, so the anchor stays clear for the county itself. */
const PIN_LIFT = 42;
const PIN_MARGIN = 4;

const PIN_COLORS: Record<Category, string> = {
  county: "#10b981",
  state: "#6366f1",
  statute: "#f59e0b",
  federal: "#ec4899",
};

const ARC_COLORS: Record<ArcType, string> = {
  cc: "#10b981",
  cs: "#3b82f6",
  st: "#f59e0b",
  fed: "#ec4899",
  other: "#94a3b8",
};

const PALETTE = {
  dark: {
    ocean: "#070b16",
    stateTop: "#1b2444",
    stateWall: "#0c1230",
    stateLine: "#4f46e5",
    coTop: "#3b3596",
    coWall: "#1a1747",
    coLine: "#a5b4fc",
    countyTop: "#242c5c",
    countyWall: "#141a3c",
    countyLine: "#8b9bd6",
    leader: "rgba(165,180,252,0.45)",
    heatLightness: 58,
  },
  light: {
    ocean: "#eef2f9",
    stateTop: "#dbe2f0",
    stateWall: "#b9c3d8",
    stateLine: "#818cf8",
    coTop: "#c7d2fe",
    coWall: "#a5b4fc",
    coLine: "#4338ca",
    countyTop: "#e8edf8",
    countyWall: "#c4cde0",
    countyLine: "#7c89b0",
    leader: "rgba(67,56,202,0.4)",
    heatLightness: 48,
  },
} as const;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const round4 = (v: number) => Math.round(v * 10000) / 10000;
const countyKey = (name: string) =>
  String(name || "")
    .toLowerCase()
    .replace(/^c:/, "")
    .replace(/\s+county$/, "")
    .trim();

const prefersReducedMotion = () =>
  typeof window !== "undefined" && !!window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function overlaps(a: Rect, b: Rect): boolean {
  return !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
}

function inRing(x: number, y: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const lonToTile = (lon: number, z: number) => ((lon + 180) / 360) * 2 ** z;
const latToTile = (lat: number, z: number) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
};

export class MapEngine {
  onChange: () => void = () => {};
  pane: "memo" | "map" = "memo";
  theme: "light" | "dark" = "dark";
  ready = false;

  cites: Citation[] = [];
  edges: Edge[] = [];
  ctx: { question?: string; answer?: string } = {};
  locs: Location[] = [];
  pins: PinView[] = [];
  labels: LabelView[] = [];
  heat: Record<string, number> = {};
  arcCounts: Record<ArcType, number> = { cc: 0, cs: 0, st: 0, fed: 0, other: 0 };
  summaryText = "0 counties linked · 0 jurisdictions · 0 links";

  level: Level = "national";
  focusCounty: string | null = null;
  label: string | null = null;

  private canvas: HTMLCanvasElement | null = null;
  private renderer: SceneRenderer | null = null;
  private buffers: SceneBuffers = {
    stateTop: [],
    stateWall: [],
    countyTop: [],
    countyWall: [],
    arcs: [],
    stateMeshes: 0,
    countyMeshes: 0,
    coloradoRaised: true,
  };
  private world: World | null = null;
  private countyShapes: (CountyShape & { key: string; minX: number; minY: number; maxX: number; maxY: number })[] = [];
  private groups = new Map<string, Group>();
  private arcs: Arc[] = [];
  private staticLayer: HTMLCanvasElement | null = null;
  private flat: CanvasRenderingContext2D | null = null;
  private basemapImage: HTMLCanvasElement | null = null;
  private basemapOn = true;

  private width = 0;
  private height = 0;
  private cam: Camera = { ...NATIONAL_CAMERA };
  private camFrom: Camera = { ...NATIONAL_CAMERA };
  private camTarget: Camera = { ...NATIONAL_CAMERA };
  private cam3: Camera3 | null = null;
  private animStart = 0;
  private animating = false;
  private focusIndex: number | null = null;
  private avoid: Rect[] = [];

  private tooltipText: string | null = null;

  tour: TourState = { active: false, index: 0, count: 0, playing: false };
  narrating = false;
  private session: Narration | null = null;
  private tourHold = false;
  private tourStartedAt = 0;

  // ---------------------------------------------------------------- lifecycle

  async init(canvas: HTMLCanvasElement): Promise<void> {
    this.canvas = canvas;
    this.theme =
      typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    this.renderer = SceneRenderer.create(canvas);
    if (this.renderer) {
      const box = canvas.getBoundingClientRect();
      this.width = Math.round(box.width) || this.width;
      this.height = Math.round(box.height) || this.height;
      this.renderer.resize(this.width, this.height);
    } else {
      this.flat = canvas.getContext("2d");
    }
    const world = await loadWorld();
    this.world = world;
    this.countyShapes = world.counties.map((c) => {
      const xs: number[] = [];
      const ys: number[] = [];
      for (const ring of c.polys)
        for (const [x, y] of ring) {
          xs.push(x);
          ys.push(y);
        }
      return {
        ...c,
        key: c.name.toLowerCase(),
        minX: Math.min(...xs),
        minY: Math.min(...ys),
        maxX: Math.max(...xs),
        maxY: Math.max(...ys),
      };
    });
    const scheme = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
    scheme?.addEventListener("change", (event) => this.setTheme(event.matches ? "dark" : "light"));
    this.rebuild();
    this.ready = true;
    this.refresh();
    void this.loadBasemap();
  }

  detach(): void {
    this.session?.stop();
    this.session = null;
  }

  resize(width: number, height: number): void {
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    this.renderer?.resize(width, height);
    this.refresh();
  }

  setPane(pane: "memo" | "map"): void {
    this.pane = pane;
    this.emit();
  }

  /**
   * Screen rectangles, in pane coordinates, that the pins must keep clear of: the map's own floating
   * controls. Without this a pin can land under a zoom button and swallow its clicks.
   */
  setAvoidRects(rects: { x: number; y: number; w: number; h: number }[]): void {
    const same =
      rects.length === this.avoid.length &&
      rects.every((r, i) => {
        const q = this.avoid[i];
        return r.x === q.x && r.y === q.y && r.w === q.w && r.h === q.h;
      });
    if (same) return;
    this.avoid = rects.map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h }));
    this.refresh();
  }

  setTheme(theme: "light" | "dark"): void {
    if (theme === this.theme) return;
    this.theme = theme;
    this.rebuild();
    this.render();
    this.emit();
  }

  // ---------------------------------------------------------------- data

  setCites(cites: Citation[], edges: Edge[], ctx: { question?: string; answer?: string }): void {
    this.cites = Array.isArray(cites) ? cites : [];
    this.edges = (Array.isArray(edges) ? edges : []).slice(0, 48);
    this.ctx = ctx || {};
    this.locs = this.cites.map((c) => locate(c));
    this.groups = new Map();
    this.cites.forEach((_, i) => {
      const loc = this.locs[i];
      const group = this.groups.get(loc.key);
      if (group) group.items.push(i);
      else this.groups.set(loc.key, { ...loc, items: [i] });
    });
    this.computeHeat();
    this.computeArcs();
    this.tour.count = this.order().length;
    this.tour.index = 0;
    this.focusIndex = null;
    this.focusCounty = null;
    this.label = null;
    this.level = "national";
    this.cam = { ...NATIONAL_CAMERA };
    this.camTarget = { ...NATIONAL_CAMERA };
    this.rebuild();
    this.refresh();
  }

  private computeHeat(): void {
    const heat: Record<string, number> = {};
    this.cites.forEach((_, i) => {
      const loc = this.locs[i];
      if (loc && loc.cat === "county" && loc.key.startsWith("c:")) heat[loc.key] = (heat[loc.key] || 0) + 1;
    });
    this.heat = heat;
    const countyGroups = [...this.groups.values()].filter((g) => g.cat === "county").length;
    const links = this.edges.filter((e) => this.indexOf(e.src) >= 0 && this.indexOf(e.dst) >= 0).length + countyGroups;
    this.summaryText = `${Object.keys(heat).length} counties linked · ${jurisdictionCount(this.locs)} jurisdictions · ${links} links`;
  }

  private computeArcs(): void {
    const counts: Record<ArcType, number> = { cc: 0, cs: 0, st: 0, fed: 0, other: 0 };
    const arcs: Arc[] = [];
    for (const e of this.edges) {
      const a = this.indexOf(e.src);
      const b = this.indexOf(e.dst);
      if (a < 0 || b < 0) continue;
      const type = arcType(this.locs[a], this.locs[b]);
      counts[type] += 1;
      arcs.push({ from: project(this.locs[a].ll), to: project(this.locs[b].ll), type });
    }
    const denver = this.groups.get("denver");
    if (denver) {
      for (const g of this.groups.values()) {
        if (!g.up) continue;
        arcs.push({ from: project(g.ll), to: project(denver.ll), type: "cs" });
      }
    }
    this.arcCounts = counts;
    this.arcs = arcs;
  }

  private indexOf(id: string): number {
    return this.cites.findIndex((c) => c.id === id);
  }

  // ---------------------------------------------------------------- debug contract

  order(): number[] {
    return this.cites.map((_, i) => i).filter((i) => !!this.locs[i]);
  }

  explainText(i: number): StopParts {
    const c = this.cites[i];
    if (!c || !this.locs[i]) return { title: "", court: "", year: "", holding: "", citedBy: "", memoLine: "" };
    return explainParts(c, this.locs[i], this.ctx, this.cites, this.edges);
  }

  private spokenFor(i: number): string {
    const c = this.cites[i];
    if (!c || !this.locs[i]) return "";
    return spokenText(this.explainText(i), this.locs[i]);
  }

  /** The caption of a tour position (0-based), which is the same text the stop speaks. */
  spokenTextAt(position: number): string {
    const order = this.order();
    const index = order[position];
    return index === undefined ? "" : this.spokenFor(index);
  }

  pinList(): { key: string; cat: Category; count: number }[] {
    return this.pins.map((p) => ({ key: p.key, cat: p.cat, count: p.count }));
  }

  get pinCount(): number {
    return this.pins.length;
  }

  get countyCount(): number {
    return Object.keys(this.heat).length;
  }

  get countyMeshCount(): number {
    return this.buffers.countyMeshes || (this.world ? this.world.counties.reduce((n, c) => n + c.polys.length, 0) : 0);
  }

  get stateMeshCount(): number {
    return this.buffers.stateMeshes || (this.world ? this.world.states.reduce((n, s) => n + s.polys.length, 0) : 0);
  }

  scene(): { mode: "3d" | "flat"; stateMeshes: number; countyMeshes: number; coloradoRaised: boolean } {
    return {
      mode: this.renderer ? "3d" : "flat",
      stateMeshes: this.stateMeshCount,
      countyMeshes: this.countyMeshCount,
      // Only the extruded scene stands Colorado above its neighbours; the flat drawing does not.
      coloradoRaised: !!this.renderer && this.buffers.coloradoRaised,
    };
  }

  state() {
    return {
      camera: { x: round4(this.cam.x), y: round4(this.cam.y), zoom: round4(this.cam.zoom) },
      pane: this.pane,
      tour: { ...this.tour },
      theme: this.theme,
      focus: this.focusIndex,
      level: this.level,
      focusCounty: this.focusCounty,
      label: this.label,
      scene: this.scene(),
      narrating: this.narrating,
    };
  }

  tooltip(): string | null {
    return this.tooltipText;
  }

  summary(): string {
    return this.summaryText;
  }

  view(): MapView {
    return {
      pins: this.pins,
      labels: this.labels,
      tooltip: this.tooltipText,
      summary: this.summaryText,
      level: this.level,
      label: this.label,
      tour: { ...this.tour },
      narrating: this.narrating,
      basemapReady: !!this.basemapImage,
    };
  }

  // ---------------------------------------------------------------- camera

  /** The camera a jurisdiction view sits at. */
  private cameraFor(level: Level): Camera {
    if (level === "national") return { ...NATIONAL_CAMERA };
    if (level === "state") {
      const co = this.world?.states.find((s) => s.name === "Colorado");
      const [x, y] = co ? this.centreOf(co.polys) : project([39.0, -105.5]);
      return { x, y, zoom: LEVEL_ZOOM.state };
    }
    if (level === "county") {
      const shape = this.countyShapes.find((c) => c.key === this.focusCounty);
      const [x, y] = shape ? shape.c : [this.cam.x, this.cam.y];
      return { x, y, zoom: LEVEL_ZOOM.county };
    }
    const index = this.focusIndex;
    const point = index !== null && this.locs[index] ? project(this.locs[index].ll) : [this.cam.x, this.cam.y];
    return { x: point[0], y: point[1], zoom: LEVEL_ZOOM.court };
  }

  private centreOf(polys: [number, number][][]): [number, number] {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const ring of polys)
      for (const [x, y] of ring) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    if (!Number.isFinite(minX)) return [WORLD_WIDTH / 2, WORLD_HEIGHT / 2];
    return [(minX + maxX) / 2, (minY + maxY) / 2];
  }

  /** Bring the camera to a county and name it. */
  zoomToCounty(name: string): void {
    const key = countyKey(name);
    const shape = this.countyShapes.find((c) => c.key === key);
    if (!shape) return;
    this.focusCounty = shape.key;
    this.focusIndex = null;
    this.level = "county";
    this.label = `${shape.name} County`;
    this.moveCamera({ x: shape.c[0], y: shape.c[1], zoom: LEVEL_ZOOM.county });
    this.emit();
  }

  /** Bring the camera to a court's pin and name it. */
  zoomToCourt(i: number): void {
    if (!this.cites[i] || !this.locs[i]) return;
    this.focusIndex = i;
    this.level = "court";
    this.label = this.cites[i].title || this.locs[i].label;
    const [x, y] = project(this.locs[i].ll);
    const containing = this.countyKeyAt(x, y);
    if (containing) this.focusCounty = containing;
    this.moveCamera({ x, y, zoom: LEVEL_ZOOM.court });
    this.emit();
  }

  /** Step the camera back out: court → county → state → national. */
  zoomOutLevel(): void {
    if (this.level === "court") {
      if (this.focusCounty) {
        this.focusIndex = null;
        this.level = "county";
        this.label = `${titleCase(this.focusCounty)} County`;
        this.moveCamera(this.cameraFor("county"));
      } else {
        this.setLevel("state");
      }
    } else if (this.level === "county") {
      this.setLevel("state");
    } else if (this.level === "state") {
      this.setLevel("national");
    } else {
      this.zoomAround(1 / 1.6);
      return;
    }
    this.emit();
  }

  private setLevel(level: Level): void {
    this.level = level;
    this.focusIndex = null;
    if (level === "national") {
      this.focusCounty = null;
      this.label = null;
    } else if (level === "state") {
      this.label = "Colorado";
    }
    this.moveCamera(this.cameraFor(level));
  }

  focus(i: number): void {
    const loc = this.locs[i];
    if (!this.cites[i] || !loc) return;
    if (loc.cat === "county") {
      this.zoomToCounty(loc.key);
      this.focusIndex = i;
      this.emit();
      return;
    }
    this.zoomToCourt(i);
  }

  resetCamera(): void {
    this.focusIndex = null;
    this.focusCounty = null;
    this.label = null;
    this.level = "national";
    this.moveCamera({ ...NATIONAL_CAMERA });
    this.emit();
  }

  /**
   * Zoom by a factor around a point of the pane — its centre unless the wheel says otherwise — so that
   * whatever is under that point stays under it.
   */
  zoomAround(factor: number, sx?: number, sy?: number): void {
    if (!this.width || !this.height) return;
    const zoom = clamp(this.cam.zoom * factor, MIN_ZOOM, MAX_ZOOM);
    if (zoom === this.cam.zoom) return;
    const cx = sx === undefined ? this.width / 2 : sx;
    const cy = sy === undefined ? this.height / 2 : sy;
    const k = this.scale() * (zoom / this.cam.zoom);
    const [px, py] = this.toProjected(cx, cy);
    this.animating = false;
    this.cam = { x: px - (cx - this.width / 2) / k, y: py - (cy - this.height / 2) / k, zoom };
    this.camTarget = { ...this.cam };
    this.refresh();
  }

  /** Drag the map: the point under the pointer follows it, so the camera moves the other way. */
  panBy(dx: number, dy: number): void {
    if (!this.width || !this.height || (dx === 0 && dy === 0)) return;
    const k = this.scale();
    this.animating = false;
    this.cam = { x: this.cam.x - dx / k, y: this.cam.y - dy / k, zoom: this.cam.zoom };
    this.camTarget = { ...this.cam };
    this.refresh();
  }

  private moveCamera(target: Camera): void {
    this.camTarget = { ...target };
    if (prefersReducedMotion()) {
      this.cam = { ...target };
      this.camFrom = { ...target };
      this.animating = false;
      this.refresh();
      return;
    }
    this.camFrom = { ...this.cam };
    this.animStart = performance.now();
    this.animating = true;
    requestAnimationFrame(this.stepCamera);
  }

  private stepCamera = (now: number): void => {
    // A pan or a zoom stops the animation, but a frame it already asked for may still arrive.
    if (!this.animating) return;
    const t = clamp((now - this.animStart) / CAMERA_MS, 0, 1);
    const e = 1 - Math.pow(1 - t, 3);
    this.cam = {
      x: this.camFrom.x + (this.camTarget.x - this.camFrom.x) * e,
      y: this.camFrom.y + (this.camTarget.y - this.camFrom.y) * e,
      zoom: this.camFrom.zoom + (this.camTarget.zoom - this.camFrom.zoom) * e,
    };
    if (t >= 1) {
      this.cam = { ...this.camTarget };
      this.animating = false;
    }
    this.layoutPins();
    this.render();
    this.emit();
    if (this.animating) requestAnimationFrame(this.stepCamera);
  };

  // ---------------------------------------------------------------- tour

  startTour(n?: number): void {
    const order = this.order();
    if (!order.length) return;
    this.tour.count = order.length;
    if (typeof n === "number") this.tour.index = clamp(n, 0, order.length - 1);
    this.tour.active = true;
    this.tourHold = true;
    this.playStop();
  }

  stopTour(): void {
    this.session?.stop();
    this.session = null;
    this.tour.active = false;
    this.tour.playing = false;
    this.narrating = false;
    this.emit();
  }

  pauseTour(): void {
    this.session?.stop();
    this.session = null;
    this.tour.playing = false;
    this.narrating = false;
    this.emit();
  }

  nextStop(): void {
    this.pauseTour();
    this.tour.index = clamp(this.tour.index + 1, 0, Math.max(0, this.order().length - 1));
    this.emit();
  }

  previousStop(): void {
    this.pauseTour();
    this.tour.index = clamp(this.tour.index - 1, 0, Math.max(0, this.order().length - 1));
    this.emit();
  }

  private finishTour(): void {
    this.session = null;
    this.tour.active = false;
    this.tour.playing = false;
    this.narrating = false;
    this.emit();
  }

  private playStop(): void {
    const order = this.order();
    this.session?.stop();
    if (this.tour.index >= order.length) {
      this.finishTour();
      return;
    }
    const stop = this.tour.index;
    this.focus(order[stop]);
    const text = this.spokenFor(order[stop]);
    const hold = this.tourHold;
    this.tourHold = false;
    this.tour.playing = true;
    this.narrating = true;
    this.tourStartedAt = performance.now();
    this.emit();

    const session = narrate(text, () => {
      if (this.session !== session || !this.tour.active) return;
      const elapsed = performance.now() - this.tourStartedAt;
      const wait = hold ? Math.max(0, STOP_HOLD_MS - elapsed) : 0;
      const advance = () => {
        if (this.session !== session || !this.tour.active) return;
        if (this.tour.index >= order.length - 1) this.finishTour();
        else {
          this.tour.index += 1;
          this.playStop();
        }
      };
      if (wait > 0) window.setTimeout(advance, wait);
      else advance();
    });
    this.session = session;

    const next = order[stop + 1];
    if (next !== undefined) prefetchClip(this.spokenFor(next));
  }

  // ---------------------------------------------------------------- narration

  /**
   * What Listen speaks before the walk begins: the memo's short answer, not the whole memo. The
   * Markdown that formats the memo on screen is not spoken.
   */
  private shortAnswer(): string {
    const raw = (this.ctx.answer || "").trim();
    if (!raw) return "";
    const first = raw.split(/\n\s*\n/).find((part) => part.trim()) || raw;
    return first
      .replace(/\[(\d{1,3})\]/g, "")
      .replace(/[*_`#>]/g, "")
      .replace(/\s+([.,;:])/g, "$1")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 400);
  }

  /** Listen: speak the short answer, then walk the stops. A second press stops both. */
  listen(): void {
    if (this.narrating) {
      this.stopListening();
      return;
    }
    const text = this.shortAnswer();
    if (!text) return;
    this.narrateMemo(() => this.startTour(0));
  }

  narrateMemo(onEnd?: () => void): void {
    const text = this.shortAnswer();
    if (!text) return;
    this.session?.stop();
    this.session = null;
    this.narrating = true;
    this.emit();
    const session = narrate(text, () => {
      if (this.session !== session) return;
      this.narrating = false;
      this.emit();
      onEnd?.();
    });
    this.session = session;
  }

  stopListening(): void {
    this.session?.stop();
    this.session = null;
    this.narrating = false;
    if (this.tour.playing) this.tour.playing = false;
    this.emit();
  }

  // ---------------------------------------------------------------- hover

  hoverCounty(key: string | null): void {
    if (!key) {
      this.tooltipText = null;
      this.emit();
      return;
    }
    const shape = this.countyShapes.find((c) => c.key === key.replace(/^c:/, ""));
    const name = shape ? shape.name : titleCase(key.replace(/^c:/, ""));
    const n = this.heat[key] || 0;
    this.tooltipText = `${name} County — ${n} case${n === 1 ? "" : "s"} (${key})`;
    this.emit();
  }

  hoverPin(key: string | null): void {
    if (!key) {
      this.tooltipText = null;
      this.emit();
      return;
    }
    const pin = this.pins.find((p) => p.key === key);
    if (!pin) {
      this.tooltipText = null;
      this.emit();
      return;
    }
    const titles = pin.titles.join("; ");
    this.tooltipText = `${pin.label} — ${pin.count} source${pin.count === 1 ? "" : "s"}: ${titles}`;
    this.emit();
  }

  /** The county under a point on the canvas, for pointer hover and clicks. */
  countyAtScreen(sx: number, sy: number): string | null {
    const point = this.screenToPlane(sx, sy);
    if (!point) return null;
    const key = this.countyKeyAt(point[0], point[1]);
    return key ? "c:" + key : null;
  }

  private countyKeyAt(px: number, py: number): string | null {
    for (const c of this.countyShapes) {
      if (px < c.minX || px > c.maxX || py < c.minY || py > c.maxY) continue;
      for (const ring of c.polys) if (inRing(px, py, ring)) return c.key;
    }
    return null;
  }

  /** A canvas point → the projected plane, on the surface the counties are drawn on. */
  private screenToPlane(sx: number, sy: number): [number, number] | null {
    this.ensureCamera();
    if (this.cam3) {
      const ground = unprojectGround(this.cam3, sx, sy, SURFACE_Y);
      if (!ground) return null;
      return [ground[0] + WORLD_WIDTH / 2, ground[1] + WORLD_HEIGHT / 2];
    }
    return this.toProjected(sx, sy);
  }

  clearTooltip(): void {
    if (this.tooltipText === null) return;
    this.tooltipText = null;
    this.emit();
  }

  // ---------------------------------------------------------------- basemap

  setBasemap(on: boolean): void {
    this.basemapOn = on;
    this.rebuild();
    this.render();
    this.emit();
  }

  private async loadBasemap(): Promise<void> {
    try {
      const z = 4;
      const x0 = Math.floor(lonToTile(-127, z));
      const x1 = Math.floor(lonToTile(-65, z));
      const y0 = Math.floor(latToTile(51, z));
      const y1 = Math.floor(latToTile(22, z));
      const nx = x1 - x0 + 1;
      const ny = y1 - y0 + 1;
      const mosaic = document.createElement("canvas");
      mosaic.width = nx * 256;
      mosaic.height = ny * 256;
      const mg = mosaic.getContext("2d");
      if (!mg) return;
      let loaded = 0;
      const jobs: Promise<void>[] = [];
      for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) {
          jobs.push(
            new Promise<void>((resolve) => {
              const img = new Image();
              img.crossOrigin = "anonymous";
              const timer = window.setTimeout(() => resolve(), 4000);
              img.onload = () => {
                window.clearTimeout(timer);
                mg.drawImage(img, (x - x0) * 256, (y - y0) * 256);
                loaded += 1;
                resolve();
              };
              img.onerror = () => {
                window.clearTimeout(timer);
                resolve();
              };
              img.src = `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/${z}/${y}/${x}`;
            }),
          );
        }
      }
      await Promise.all(jobs);
      if (loaded < jobs.length * 0.5) return;

      const W = Math.round(WORLD_WIDTH / 2);
      const H = Math.round(WORLD_HEIGHT / 2);
      const out = document.createElement("canvas");
      out.width = W;
      out.height = H;
      const og = out.getContext("2d");
      if (!og) return;
      const source = mg.getImageData(0, 0, mosaic.width, mosaic.height);
      const pixels = og.createImageData(W, H);
      const step = WORLD_WIDTH / W;
      for (let j = 0; j < H; j++) {
        for (let i = 0; i < W; i++) {
          const offset = (j * W + i) * 4;
          const ll = unproject(i * step, j * step);
          if (!ll) continue;
          const sx = Math.floor((lonToTile(ll[1], z) - x0) * 256);
          const sy = Math.floor((latToTile(ll[0], z) - y0) * 256);
          if (sx < 0 || sy < 0 || sx >= source.width || sy >= source.height) continue;
          const from = (sy * source.width + sx) * 4;
          pixels.data[offset] = source.data[from];
          pixels.data[offset + 1] = source.data[from + 1];
          pixels.data[offset + 2] = source.data[from + 2];
          pixels.data[offset + 3] = 230;
        }
      }
      og.putImageData(pixels, 0, 0);
      this.basemapImage = out;
      this.rebuild();
      this.render();
      this.emit();
    } catch {
      // The provider is unreachable: the map is complete without it and says nothing.
    }
  }

  // ---------------------------------------------------------------- drawing

  private palette() {
    return PALETTE[this.theme];
  }

  private countyFill(county: CountyShape): string {
    const p = this.palette();
    const n = this.heat["c:" + county.name.toLowerCase()] || 0;
    if (!n) return p.countyTop;
    const max = Math.max(1, ...Object.values(this.heat));
    const h = n / max;
    const hue = 0.42 - 0.3 * h;
    return `hsl(${Math.round(hue * 360)}, 72%, ${p.heatLightness}%)`;
  }

  /** Build (or rebuild) the scene: vertex buffers for the solid map, or the flat layer without WebGL. */
  private rebuild(): void {
    if (!this.world) return;
    const p = this.palette();
    if (this.renderer) {
      this.renderer.setOcean(p.ocean);
      this.buffers = buildScene({
        states: this.world.states,
        counties: this.world.counties.map((c) => ({ name: c.name, polys: c.polys, fill: this.countyFill(c) })),
        arcs: this.arcs.map((a) => ({ from: a.from, to: a.to, colour: ARC_COLORS[a.type] })),
        palette: {
          stateTop: p.stateTop,
          stateWall: p.stateWall,
          coTop: p.coTop,
          coWall: p.coWall,
          countyTop: p.countyTop,
          countyWall: p.countyWall,
        },
      });
      this.renderer.setScene(this.buffers);
      this.renderer.setBasemap(this.basemapOn ? this.basemapImage : null);
      return;
    }
    this.buildFlatLayer();
  }

  private buildFlatLayer(): void {
    if (!this.world) return;
    const S = 2;
    const layer = document.createElement("canvas");
    layer.width = WORLD_WIDTH * S;
    layer.height = WORLD_HEIGHT * S;
    const g = layer.getContext("2d");
    if (!g) return;
    g.setTransform(S, 0, 0, S, 0, 0);
    const p = this.palette();

    g.fillStyle = p.ocean;
    g.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    if (this.basemapOn && this.basemapImage) g.drawImage(this.basemapImage, 0, 0, WORLD_WIDTH, WORLD_HEIGHT);

    g.fillStyle = p.stateWall;
    for (const state of this.world.states) for (const ring of state.polys) this.flatWall(g, ring, 3);
    for (const state of this.world.states) {
      const isColorado = state.name === "Colorado";
      g.fillStyle = isColorado ? p.coTop : p.stateTop;
      g.strokeStyle = isColorado ? p.coLine : p.stateLine;
      g.lineWidth = isColorado ? 0.7 : 0.35;
      for (const ring of state.polys) {
        this.flatTrace(g, ring);
        g.fill();
        g.stroke();
      }
    }
    for (const county of this.world.counties) {
      const n = this.heat["c:" + county.name.toLowerCase()] || 0;
      g.fillStyle = this.countyFill(county);
      g.strokeStyle = n > 0 ? "#0f172a" : p.countyLine;
      g.lineWidth = n > 0 ? 0.55 : 0.3;
      for (const ring of county.polys) {
        this.flatTrace(g, ring);
        g.fill();
        g.stroke();
      }
    }
    this.staticLayer = layer;
  }

  private flatWall(g: CanvasRenderingContext2D, ring: [number, number][], depth: number): void {
    g.beginPath();
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      g.moveTo(a[0], a[1]);
      g.lineTo(b[0], b[1]);
      g.lineTo(b[0], b[1] + depth);
      g.lineTo(a[0], a[1] + depth);
      g.closePath();
    }
    g.fill();
  }

  private flatTrace(g: CanvasRenderingContext2D, ring: [number, number][]): void {
    g.beginPath();
    g.moveTo(ring[0][0], ring[0][1]);
    for (let i = 1; i < ring.length; i++) g.lineTo(ring[i][0], ring[i][1]);
    g.closePath();
  }

  /** Screen pixels per projected unit at the camera's target. */
  private scale(): number {
    if (!this.width || !this.height) return 1;
    if (this.cam3) {
      const aspect = this.width / this.height;
      return (this.height * this.cam.zoom) / Math.max(WORLD_HEIGHT, WORLD_WIDTH / aspect);
    }
    return Math.min(this.width / WORLD_WIDTH, this.height / WORLD_HEIGHT) * 0.92 * this.cam.zoom;
  }

  /** Projected plane → canvas coordinates, at a height above the surface. */
  private toScreen(px: number, py: number, height = 0): [number, number] | null {
    if (this.cam3) {
      const point = projectPoint(this.cam3, px - WORLD_WIDTH / 2, height, py - WORLD_HEIGHT / 2);
      return point ? [point[0], point[1]] : null;
    }
    const k = this.scale();
    return [(px - this.cam.x) * k + this.width / 2, (py - this.cam.y) * k + this.height / 2];
  }

  private toProjected(sx: number, sy: number): [number, number] {
    const k = this.scale();
    return [(sx - this.width / 2) / k + this.cam.x, (sy - this.height / 2) / k + this.cam.y];
  }

  private ensureCamera(): void {
    if (this.renderer && this.width > 0 && this.height > 0) {
      this.cam3 = buildCamera(
        this.cam.x - WORLD_WIDTH / 2,
        this.cam.y - WORLD_HEIGHT / 2,
        this.cam.zoom,
        this.width,
        this.height,
      );
    } else {
      this.cam3 = null;
    }
  }

  render(): void {
    if (!this.width || !this.height) return;
    this.ensureCamera();
    if (this.renderer) {
      this.renderer.resize(this.width, this.height);
      this.renderer.render(this.cam3 as Camera3, this.basemapOn && !!this.basemapImage);
      return;
    }
    this.renderFlat();
  }

  private renderFlat(): void {
    const canvas = this.canvas;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(this.width * dpr);
    const h = Math.round(this.height * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const g = this.flat || canvas.getContext("2d");
    this.flat = g;
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, this.width, this.height);

    const k = this.scale();
    g.save();
    g.translate(this.width / 2, this.height / 2);
    g.scale(k, k);
    g.translate(-this.cam.x, -this.cam.y);
    if (this.staticLayer) g.drawImage(this.staticLayer, 0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    g.lineWidth = 1.7 / k;
    for (const arc of this.arcs) {
      const [x1, y1] = arc.from;
      const [x2, y2] = arc.to;
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len = Math.hypot(dx, dy) || 1;
      const bend = Math.min(40, len * 0.35);
      const cx = (x1 + x2) / 2 - (dy / len) * bend;
      const cy = (y1 + y2) / 2 + (dx / len) * bend;
      g.strokeStyle = ARC_COLORS[arc.type];
      g.beginPath();
      g.moveTo(x1, y1);
      g.quadraticCurveTo(cx, cy, x2, y2);
      g.stroke();
    }
    g.restore();
  }

  // ---------------------------------------------------------------- pins and labels

  /** Where a citation's pin sits on the canvas, or null when it is not on screen. */
  pinScreen(i: number): { x: number; y: number } | null {
    const pin = this.pins.find((p) => p.items.includes(i));
    if (!pin) return null;
    return { x: round4(pin.x), y: round4(pin.y) };
  }

  /** Where a county's centre sits on the canvas, or null when it is not on screen. */
  countyScreen(name: string): { x: number; y: number } | null {
    const shape = this.countyShapes.find((c) => c.key === countyKey(name));
    if (!shape) return null;
    this.ensureCamera();
    const point = this.toScreen(shape.c[0], shape.c[1], SURFACE_Y);
    return point ? { x: round4(point[0]), y: round4(point[1]) } : null;
  }

  private layoutPins(): void {
    this.ensureCamera();
    const W = this.width;
    const H = this.height;
    if (!W || !H || !this.cites.length) {
      this.pins = [];
      this.labels = [];
      return;
    }
    const groups = [...this.groups.values()].filter((g) => g.items.length > 0);
    groups.sort((a, b) => b.items.length - a.items.length || a.key.localeCompare(b.key));
    const placed: Rect[] = [];
    const out: PinView[] = [];
    for (const group of groups) {
      const [px, py] = project(group.ll);
      const anchor = this.toScreen(px, py, SURFACE_Y);
      if (!anchor) continue;
      const [ax, ay] = anchor;
      // A pin stands above its anchor: the button sits on a stem so the place itself stays clickable.
      const baseY = ay - PIN_LIFT;
      let spot: [number, number] | null = null;
      for (let ring = 0; ring < 30 && !spot; ring++) {
        const tries = ring === 0 ? 1 : 8 * ring;
        for (let step = 0; step < tries; step++) {
          const angle = (step / tries) * Math.PI * 2 + ring * 0.45;
          const radius = ring * 14;
          const x = ax + Math.cos(angle) * radius;
          const y = baseY + Math.sin(angle) * radius;
          if (y > baseY + 4) continue;
          const rect = { x: x - PIN_SIZE / 2, y: y - PIN_SIZE / 2, w: PIN_SIZE, h: PIN_SIZE };
          if (rect.x < PIN_MARGIN || rect.y < PIN_MARGIN || rect.x + PIN_SIZE > W - PIN_MARGIN || rect.y + PIN_SIZE > H - PIN_MARGIN)
            continue;
          if (this.avoid.some((q) => overlaps(rect, q))) continue;
          if (placed.some((q) => overlaps(rect, q))) continue;
          spot = [x, y];
          break;
        }
      }
      const [x, y] = spot || [ax, baseY];
      placed.push({ x: x - PIN_SIZE / 2, y: y - PIN_SIZE / 2, w: PIN_SIZE, h: PIN_SIZE });
      out.push({
        key: group.key,
        cat: group.cat,
        label: group.label,
        count: group.items.length,
        titles: group.items.map((i) => this.cites[i].title || "").filter(Boolean),
        items: group.items.slice(),
        index: group.items[0],
        x,
        y,
        ax,
        ay,
      });
    }
    this.pins = out;
    this.layoutLabels();
  }

  /**
   * The names that belong to a level: county names while a county is in view, court names while a court
   * is. Nothing at the national view, so the drawing stays quiet.
   */
  private layoutLabels(): void {
    const out: LabelView[] = [];
    if (this.level === "county") {
      const shapes = this.countyShapes
        .map((shape) => ({ shape, n: this.heat["c:" + shape.key] || 0 }))
        .filter((entry) => entry.n > 0 || entry.shape.key === this.focusCounty)
        .sort((a, b) => b.n - a.n)
        .slice(0, 12);
      for (const { shape } of shapes) {
        const point = this.toScreen(shape.c[0], shape.c[1], SURFACE_Y);
        if (!point) continue;
        out.push({
          key: "county:" + shape.key,
          text: `${shape.name} County`,
          x: point[0],
          y: point[1],
          strong: shape.key === this.focusCounty,
        });
      }
    } else if (this.level === "court") {
      for (const pin of this.pins) {
        out.push({ key: "court:" + pin.key, text: pin.titles[0] || pin.label, x: pin.ax, y: pin.ay, strong: true });
      }
    } else if (this.level === "state") {
      const co = this.world?.states.find((s) => s.name === "Colorado");
      const [x, y] = co ? this.centreOf(co.polys) : [WORLD_WIDTH / 2, WORLD_HEIGHT / 2];
      const point = this.toScreen(x, y, SURFACE_Y);
      if (point) out.push({ key: "state:co", text: "Colorado", x: point[0], y: point[1], strong: true });
    }
    this.labels = out;
  }

  private refresh(): void {
    this.ensureCamera();
    this.layoutPins();
    this.render();
    this.emit();
  }

  emit(): void {
    this.onChange();
  }
}
