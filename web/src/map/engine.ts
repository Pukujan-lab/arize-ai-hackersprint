// The citation map: extruded states, the Colorado county layer, typed links, pins, and the tour.
// Everything is drawn into one canvas in the projected plane the vendored geometry already uses;
// pins are real buttons laid out in screen space on top of it.

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
  type StateShape,
  type World,
} from "@/lib/geo";
import { narrate, prefetchClip, type Narration } from "./narrator";

export type Camera = { x: number; y: number; zoom: number };
export type TourState = { active: boolean; index: number; count: number; playing: boolean };

export type PinView = {
  key: string;
  cat: Category;
  label: string;
  count: number;
  titles: string[];
  index: number;
  x: number;
  y: number;
  ax: number;
  ay: number;
};

export type MapView = {
  pins: PinView[];
  tooltip: string | null;
  summary: string;
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
const PIN_TOP_BAND = 64;
const PIN_BOTTOM_BAND = 26;
const STATE_DEPTH = 3.2;
const COUNTY_DEPTH = 1.6;

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
    coTop: "#332e83",
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
  heat: Record<string, number> = {};
  arcCounts: Record<ArcType, number> = { cc: 0, cs: 0, st: 0, fed: 0, other: 0 };
  summaryText = "0 counties linked · 0 jurisdictions · 0 links";

  private canvas: HTMLCanvasElement | null = null;
  private world: World | null = null;
  private countyShapes: (CountyShape & { key: string; minX: number; minY: number; maxX: number; maxY: number })[] = [];
  private groups = new Map<string, Group>();
  private arcs: Arc[] = [];
  private staticLayer: HTMLCanvasElement | null = null;
  private basemapImage: HTMLCanvasElement | null = null;
  private basemapOn = true;

  private width = 0;
  private height = 0;
  private cam: Camera = { ...NATIONAL_CAMERA };
  private camFrom: Camera = { ...NATIONAL_CAMERA };
  private camTarget: Camera = { ...NATIONAL_CAMERA };
  private animStart = 0;
  private animating = false;
  private focusIndex: number | null = null;

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
    this.buildStatic();
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
    this.refresh();
  }

  setPane(pane: "memo" | "map"): void {
    this.pane = pane;
    this.emit();
  }

  setTheme(theme: "light" | "dark"): void {
    if (theme === this.theme) return;
    this.theme = theme;
    this.buildStatic();
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
    this.cam = { ...NATIONAL_CAMERA };
    this.camTarget = { ...NATIONAL_CAMERA };
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
    return this.world ? this.world.counties.reduce((n, c) => n + c.polys.length, 0) : 0;
  }

  get stateMeshCount(): number {
    return this.world ? this.world.states.reduce((n, s) => n + s.polys.length, 0) : 0;
  }

  state() {
    return {
      camera: { x: round4(this.cam.x), y: round4(this.cam.y), zoom: round4(this.cam.zoom) },
      pane: this.pane,
      tour: { ...this.tour },
      theme: this.theme,
      focus: this.focusIndex,
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
      tooltip: this.tooltipText,
      summary: this.summaryText,
      tour: { ...this.tour },
      narrating: this.narrating,
      basemapReady: !!this.basemapImage,
    };
  }

  // ---------------------------------------------------------------- camera

  focus(i: number): void {
    if (!this.cites[i] || !this.locs[i]) return;
    this.focusIndex = i;
    const [x, y] = project(this.locs[i].ll);
    const cat = this.locs[i].cat;
    const zoom = cat === "county" ? 3.4 : cat === "statute" ? 3 : cat === "state" ? 2.6 : 2.2;
    this.moveCamera({ x, y, zoom });
    this.emit();
  }

  resetCamera(): void {
    this.focusIndex = null;
    this.moveCamera({ ...NATIONAL_CAMERA });
    this.emit();
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

  // ---------------------------------------------------------------- narration of the memo

  narrateMemo(onEnd?: () => void): void {
    const text = (this.ctx.answer || "").trim();
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

  /** The county under a point on the canvas, for pointer hover. */
  countyAtScreen(sx: number, sy: number): string | null {
    const [px, py] = this.toProjected(sx, sy);
    for (const c of this.countyShapes) {
      if (px < c.minX || px > c.maxX || py < c.minY || py > c.maxY) continue;
      for (const ring of c.polys) if (inRing(px, py, ring)) return "c:" + c.key;
    }
    return null;
  }

  clearTooltip(): void {
    if (this.tooltipText === null) return;
    this.tooltipText = null;
    this.emit();
  }

  // ---------------------------------------------------------------- basemap

  setBasemap(on: boolean): void {
    this.basemapOn = on;
    this.buildStatic();
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
      this.buildStatic();
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

  private buildStatic(): void {
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
    for (const state of this.world.states) for (const ring of state.polys) this.wall(g, ring, STATE_DEPTH);
    for (const state of this.world.states) this.stateFace(g, state);

    g.fillStyle = p.countyWall;
    for (const county of this.world.counties) for (const ring of county.polys) this.wall(g, ring, COUNTY_DEPTH);
    for (const county of this.world.counties) this.countyFace(g, county);

    this.staticLayer = layer;
  }

  private wall(g: CanvasRenderingContext2D, ring: [number, number][], depth: number): void {
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

  private trace(g: CanvasRenderingContext2D, ring: [number, number][]): void {
    g.beginPath();
    g.moveTo(ring[0][0], ring[0][1]);
    for (let i = 1; i < ring.length; i++) g.lineTo(ring[i][0], ring[i][1]);
    g.closePath();
  }

  private stateFace(g: CanvasRenderingContext2D, state: StateShape): void {
    const p = this.palette();
    const isColorado = state.name === "Colorado";
    g.fillStyle = isColorado ? p.coTop : p.stateTop;
    g.strokeStyle = isColorado ? p.coLine : p.stateLine;
    g.lineWidth = isColorado ? 0.7 : 0.35;
    for (const ring of state.polys) {
      this.trace(g, ring);
      g.fill();
      g.stroke();
    }
  }

  private countyFace(g: CanvasRenderingContext2D, county: CountyShape): void {
    const p = this.palette();
    const key = county.name.toLowerCase();
    const n = this.heat["c:" + key] || 0;
    if (n > 0) {
      const max = Math.max(1, ...Object.values(this.heat));
      const h = n / max;
      const hue = 0.42 - 0.3 * h;
      g.fillStyle = `hsl(${Math.round(hue * 360)}, 72%, ${p.heatLightness}%)`;
    } else {
      g.fillStyle = p.countyTop;
    }
    g.strokeStyle = n > 0 ? "#0f172a" : p.countyLine;
    g.lineWidth = n > 0 ? 0.55 : 0.3;
    for (const ring of county.polys) {
      this.trace(g, ring);
      g.fill();
      g.stroke();
    }
  }

  private scale(): number {
    if (!this.width || !this.height) return 1;
    return Math.min(this.width / WORLD_WIDTH, this.height / WORLD_HEIGHT) * 0.92 * this.cam.zoom;
  }

  private toScreen(px: number, py: number): [number, number] {
    const k = this.scale();
    return [(px - this.cam.x) * k + this.width / 2, (py - this.cam.y) * k + this.height / 2];
  }

  private toProjected(sx: number, sy: number): [number, number] {
    const k = this.scale();
    return [(sx - this.width / 2) / k + this.cam.x, (sy - this.height / 2) / k + this.cam.y];
  }

  render(): void {
    const canvas = this.canvas;
    if (!canvas || !this.width || !this.height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(this.width * dpr);
    const h = Math.round(this.height * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const g = canvas.getContext("2d");
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, this.width, this.height);

    const k = this.scale();
    g.save();
    g.translate(this.width / 2, this.height / 2);
    g.scale(k, k);
    g.translate(-this.cam.x, -this.cam.y);
    if (this.staticLayer) g.drawImage(this.staticLayer, 0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    this.drawArcs(g, k);
    g.restore();

    this.drawLeaders(g);
  }

  private drawArcs(g: CanvasRenderingContext2D, k: number): void {
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
  }

  private drawLeaders(g: CanvasRenderingContext2D): void {
    g.strokeStyle = this.palette().leader;
    g.lineWidth = 1;
    for (const pin of this.pins) {
      if (Math.hypot(pin.x - pin.ax, pin.y - pin.ay) < 2) continue;
      g.beginPath();
      g.moveTo(pin.ax, pin.ay);
      g.lineTo(pin.x, pin.y);
      g.stroke();
    }
  }

  private layoutPins(): void {
    const W = this.width;
    const H = this.height;
    if (!W || !H || !this.cites.length) {
      this.pins = [];
      return;
    }
    const groups = [...this.groups.values()].filter((g) => g.items.length > 0);
    groups.sort((a, b) => b.items.length - a.items.length || a.key.localeCompare(b.key));
    const placed: Rect[] = [];
    const out: PinView[] = [];
    for (const group of groups) {
      const [px, py] = project(group.ll);
      const [ax, ay] = this.toScreen(px, py);
      let spot: [number, number] | null = null;
      for (let ring = 0; ring < 40 && !spot; ring++) {
        const tries = ring === 0 ? 1 : 8 * ring;
        for (let step = 0; step < tries; step++) {
          const angle = (step / tries) * Math.PI * 2 + ring * 0.45;
          const radius = ring * 13;
          const x = ax + Math.cos(angle) * radius;
          const y = ay + Math.sin(angle) * radius;
          const rect = { x: x - PIN_SIZE / 2, y: y - PIN_SIZE / 2, w: PIN_SIZE, h: PIN_SIZE };
          if (rect.x < 4 || rect.y < PIN_TOP_BAND || rect.x + PIN_SIZE > W - 4 || rect.y + PIN_SIZE > H - PIN_BOTTOM_BAND)
            continue;
          if (placed.some((q) => overlaps(rect, q))) continue;
          spot = [x, y];
          break;
        }
      }
      const [x, y] = spot || [ax, ay];
      placed.push({ x: x - PIN_SIZE / 2, y: y - PIN_SIZE / 2, w: PIN_SIZE, h: PIN_SIZE });
      out.push({
        key: group.key,
        cat: group.cat,
        label: group.label,
        count: group.items.length,
        titles: group.items.map((i) => this.cites[i].title || "").filter(Boolean),
        index: group.items[0],
        x,
        y,
        ax,
        ay,
      });
    }
    this.pins = out;
  }

  private refresh(): void {
    this.layoutPins();
    this.render();
    this.emit();
  }

  emit(): void {
    this.onChange();
  }
}
