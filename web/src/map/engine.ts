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
export type TourState = {
  active: boolean;
  index: number;
  count: number;
  playing: boolean;
  /** The stop being read, so the reader can see which line is live. */
  activeIndex: number;
  /** The section of the memo the walk is in: short answer, sources, opinion, memo, authorities. */
  section: string;
};
export type Level = "national" | "state" | "county" | "court";

/** One stop of the walk: a section of the memo, or one authority. */
export type PlanStop = { section: string; text: string; cite: number | null };
export type Caption = { section: string; shown: number; index: number; total: number };
export type SpeakerState = {
  active: boolean;
  name: string;
  line: string;
  status: "idle" | "loading" | "speaking" | "unavailable" | "silent";
};
export type StageState = "waiting" | "running" | "done";
export type PipelineStage = { name: string; state: StageState; message: string };
export type PipelineState = { replay: boolean; stages: PipelineStage[]; plan: string[] };
export type MotionState = { running: boolean; born: number[]; arcProgress: number };

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
  /** How far the pin has grown since the run arrived: 0 before its birth, 1 once it has landed. */
  scale: number;
  /** The pin stands for the stop the walk is on. */
  active: boolean;
};

export type LabelView = { key: string; text: string; x: number; y: number; w: number; h: number; strong: boolean };

export type MapView = {
  pins: PinView[];
  labels: LabelView[];
  tooltip: string | null;
  summary: string;
  answer: string;
  level: Level;
  label: string | null;
  tour: TourState;
  caption: Caption;
  /** The whole line the caption is revealing, so the page can show it as the voice reads it. */
  captionText: string;
  speaker: SpeakerState;
  pipeline: PipelineState;
  narrating: boolean;
  muted: boolean;
  loading: boolean;
  basemapReady: boolean;
};

type Group = Location & { items: number[]; pinKey: string };
type Rect = { x: number; y: number; w: number; h: number };
type Arc = { from: [number, number]; to: [number, number]; type: ArcType };

const CAMERA_MS = 700;
/** A stop the reader arrives at holds long enough to read before the tour moves on. */
const STOP_HOLD_MS = 2600;
/** How long a new run takes to arrive: pins in order, then the links draw from source to target. */
const ARRIVAL_MS = 2600;
/** How long one pin takes to grow once it is born. */
const PIN_GROW_MS = 280;
/** The gap between one pin's birth and the next. */
const PIN_STAGGER_MS = 110;
/** A section stop holds this long before the walk moves to the next section. */
const SECTION_HOLD_MS = 1800;
/** The height of a map label, in pixels. */
const LABEL_H = 16;
/** Who the page sounds like. */
const SPEAKER_NAME = "Precedent";
const STAGE_PLAN = ["planner", "retriever", "answer", "safeguard"];
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
    countyLineHeld: "#e2e8ff",
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
    countyLineHeld: "#1e1b4b",
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

/**
 * A hue, saturation and lightness as a hex colour. The scene's parser reads hex, so every colour the
 * map hands it is written the one way it understands.
 */
function hslHex(hue: number, saturation: number, lightness: number): string {
  const k = (n: number) => (n + hue / 30) % 12;
  const a = (saturation / 100) * Math.min(lightness / 100, 1 - lightness / 100);
  const f = (n: number) => lightness / 100 - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const byte = (n: number) =>
    Math.round(255 * clamp(f(n), 0, 1))
      .toString(16)
      .padStart(2, "0");
  return `#${byte(0)}${byte(8)}${byte(4)}`;
}

/** Markdown as it is spoken: markers, heading hashes and reference numbers are not said aloud. */
function plainText(markdown: string): string {
  return String(markdown || "")
    .replace(/\[(\d{1,3})\]/g, "")
    .replace(/[*_`#>]/g, "")
    .replace(/^\s*[-•]\s*/gm, "")
    .replace(/\s+([.,;:])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

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
  summaryText = "no authority yet";

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
    countyOutline: [],
    countyOutlines: 0,
    arcs: [],
    arcRanges: [],
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

  tour: TourState = { active: false, index: 0, count: 0, playing: false, activeIndex: 0, section: "" };
  narrating = false;
  /** The reader silenced the voice; the walk still advances, in silence. */
  muted = false;
  /** A clip for the line being spoken is being fetched. */
  loading = false;
  speaker: SpeakerState = { active: false, name: SPEAKER_NAME, line: "", status: "idle" };
  pipeline: PipelineState = { replay: false, stages: [], plan: STAGE_PLAN.slice() };
  motion: MotionState = { running: false, born: [], arcProgress: 1 };
  /** The short answer, in the memo's own words, so the map can be read on its own. */
  answerText = "";
  private session: Narration | null = null;
  /** Bumped whenever narration stops, so a clip that arrives late cannot report progress. */
  private narrationToken = 0;
  private tourHold = false;
  private tourStartedAt = 0;
  /** -1 when the walk is on the authorities; 0..3 while it reads a section of the memo. */
  private prologue = -1;
  private captionLine = "";
  private captionShown = 0;
  private captionTimer: number | null = null;
  private arrivalStart = 0;
  private bornAt: number[] = [];
  /** The reader has touched the map, so a run that arrives later does not start talking on its own. */
  interacted = false;
  /** Set while the walk moves its own camera, so its focus is not mistaken for a reader's. */
  private walking = false;

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
    this.silence();
    this.stopCaption();
    this.motion = { ...this.motion, running: false };
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
    // A pin is one court at one place: two authorities decided by different courts are two pins even
    // when both sit in the same city, so an eight-authority run never reads as two dots.
    this.cites.forEach((_, i) => {
      const loc = this.locs[i];
      const key = loc.court ? `${loc.key}|${loc.court.toLowerCase()}` : loc.key;
      const group = this.groups.get(key);
      if (group) group.items.push(i);
      else this.groups.set(key, { ...loc, items: [i], pinKey: loc.key });
    });
    const places = new Map<string, number>();
    for (const group of this.groups.values()) places.set(group.key, (places.get(group.key) || 0) + 1);
    for (const group of this.groups.values()) {
      if ((places.get(group.key) || 0) > 1) {
        const slug = group.court.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
        group.pinKey = `${group.key}#${slug || "court"}`;
      }
    }
    this.computeHeat();
    this.computeArcs();
    this.tour.count = this.order().length;
    this.tour.index = 0;
    this.tour.activeIndex = 0;
    this.tour.section = "";
    this.prologue = -1;
    this.captionLine = "";
    this.captionShown = 0;
    this.focusIndex = null;
    this.focusCounty = null;
    this.label = null;
    this.level = "national";
    this.cam = { ...NATIONAL_CAMERA };
    this.camTarget = { ...NATIONAL_CAMERA };
    this.beginArrival();
    this.rebuild();
    this.refresh();
  }

  /** A new run arrives with motion: the pins are born in order and the links draw behind them. */
  private beginArrival(): void {
    this.arrivalStart = performance.now();
    this.bornAt = this.groups.size ? [...Array(this.groups.size).keys()].map((i) => i * PIN_STAGGER_MS) : [];
    if (!this.groups.size) {
      // Nothing arrived: there is no motion to run and no link left to draw.
      this.motion = { running: false, born: [], arcProgress: 1 };
      return;
    }
    if (prefersReducedMotion()) {
      this.motion = { running: false, born: this.bornAt.slice(), arcProgress: 1 };
      return;
    }
    this.motion = { running: true, born: this.bornAt.slice(), arcProgress: 0 };
    requestAnimationFrame(this.stepArrival);
  }

  private stepArrival = (now: number): void => {
    const elapsed = now - this.arrivalStart;
    const t = clamp(elapsed / ARRIVAL_MS, 0, 1);
    this.motion = {
      running: t < 1,
      born: this.bornAt.slice(),
      arcProgress: round4(t),
    };
    this.layoutPins();
    this.render();
    this.emit();
    if (this.motion.running) requestAnimationFrame(this.stepArrival);
  };

  /** How far a pin has grown: 0 until it is born, then 1 over a moment. */
  private pinScale(index: number, now: number): number {
    if (prefersReducedMotion() || !this.motion.running) return 1;
    const born = this.bornAt[index];
    if (born === undefined) return 1;
    const age = now - this.arrivalStart - born;
    if (age <= 0) return 0;
    return clamp(age / PIN_GROW_MS, 0, 1);
  }

  private computeHeat(): void {
    const heat: Record<string, number> = {};
    this.cites.forEach((_, i) => {
      const loc = this.locs[i];
      if (loc && loc.cat === "county" && loc.key.startsWith("c:")) heat[loc.key] = (heat[loc.key] || 0) + 1;
    });
    this.heat = heat;
    this.answerText = this.extractShortAnswer();
  }

  private computeArcs(): void {
    const counts: Record<ArcType, number> = { cc: 0, cs: 0, st: 0, fed: 0, other: 0 };
    const arcs: Arc[] = [];
    for (const e of this.edges) {
      const a = this.indexOf(e.src);
      const b = this.indexOf(e.dst);
      // A link joins two authorities that are shown; one that names an authority the run dropped is
      // not drawn and not counted.
      if (a < 0 || b < 0) continue;
      const type = arcType(this.locs[a], this.locs[b]);
      counts[type] += 1;
      arcs.push({ from: project(this.locs[a].ll), to: project(this.locs[b].ll), type });
    }
    this.arcCounts = counts;
    this.arcs = arcs;
    this.summaryText = this.composeSummary();
  }

  /** The map's own summary: the short answer first, the counts as the secondary detail. */
  private composeSummary(): string {
    const counties = Object.keys(this.heat).length;
    const countyText = counties
      ? `${counties} ${counties === 1 ? "county" : "counties"} linked`
      : "no county linked";
    const jurisdictions = jurisdictionCount(this.locs);
    const counts = `${countyText} · ${jurisdictions} ${jurisdictions === 1 ? "jurisdiction" : "jurisdictions"} · ${
      this.arcs.length
    } ${this.arcs.length === 1 ? "link" : "links"}`;
    return this.answerText ? `${this.answerText} · ${counts}` : counts;
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

  /** The links the map draws: every one joins two authorities the run shows. */
  get arcsDrawn(): number {
    return this.arcs.length;
  }

  get countyMeshCount(): number {
    return this.buffers.countyMeshes || (this.world ? this.world.counties.reduce((n, c) => n + c.polys.length, 0) : 0);
  }

  get stateMeshCount(): number {
    return this.buffers.stateMeshes || (this.world ? this.world.states.reduce((n, s) => n + s.polys.length, 0) : 0);
  }

  /** The county boundaries the scene draws: one outline per county ring, in either drawing mode. */
  get countyOutlineCount(): number {
    if (this.buffers.countyOutlines) return this.buffers.countyOutlines;
    return this.world ? this.world.counties.reduce((n, c) => n + c.polys.length, 0) : 0;
  }

  scene(): {
    mode: "3d" | "flat";
    stateMeshes: number;
    countyMeshes: number;
    countyOutlines: number;
    coloradoRaised: boolean;
  } {
    return {
      mode: this.renderer ? "3d" : "flat",
      stateMeshes: this.stateMeshCount,
      countyMeshes: this.countyMeshCount,
      countyOutlines: this.countyOutlineCount,
      // Only the extruded scene stands Colorado above its neighbours; the flat drawing does not.
      coloradoRaised: !!this.renderer && this.buffers.coloradoRaised,
    };
  }

  state() {
    return {
      camera: { x: round4(this.cam.x), y: round4(this.cam.y), zoom: round4(this.cam.zoom) },
      pane: this.pane,
      tour: { ...this.tour, activeIndex: this.tour.index },
      theme: this.theme,
      focus: this.focusIndex,
      level: this.level,
      focusCounty: this.focusCounty,
      label: this.label,
      scene: this.scene(),
      summary: this.summaryText,
      shortAnswer: this.answerText,
      speaker: { ...this.speaker },
      pipeline: {
        replay: this.pipeline.replay,
        stages: this.pipeline.stages.map((stage) => ({ ...stage })),
        plan: this.pipeline.plan.slice(),
      },
      motion: { running: this.motion.running, born: this.motion.born.slice(), arcProgress: this.motion.arcProgress },
      arcsDrawn: this.arcs.length,
      arcCounts: { ...this.arcCounts },
      narrating: this.narrating,
      muted: this.muted,
      loading: this.loading,
    };
  }

  tooltip(): string | null {
    return this.tooltipText;
  }

  summary(): string {
    return this.summaryText;
  }

  shortAnswer(): string {
    return this.answerText;
  }

  view(): MapView {
    return {
      pins: this.pins,
      labels: this.labels,
      tooltip: this.tooltipText,
      summary: this.summaryText,
      answer: this.answerText,
      level: this.level,
      label: this.label,
      tour: { ...this.tour, activeIndex: this.tour.index },
      caption: this.caption(),
      captionText: this.captionText(),
      speaker: { ...this.speaker },
      pipeline: {
        replay: this.pipeline.replay,
        stages: this.pipeline.stages.map((stage) => ({ ...stage })),
        plan: this.pipeline.plan.slice(),
      },
      narrating: this.narrating,
      muted: this.muted,
      loading: this.loading,
      basemapReady: !!this.basemapImage,
    };
  }

  /** The pipeline as the run reports it: only the stages that have started, in order. */
  setPipeline(stages: PipelineStage[], replay: boolean): void {
    this.pipeline = { replay, stages: stages.map((stage) => ({ ...stage })), plan: STAGE_PLAN.slice() };
    this.emit();
  }

  setReplay(replay: boolean): void {
    if (this.pipeline.replay === replay) return;
    this.pipeline = { ...this.pipeline, replay };
    this.emit();
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

  /**
   * The reader has touched the map: the walk and the voice stop, and a run that arrives later does
   * not start talking on its own. The walk's own camera moves do not come through here.
   */
  private touch(): void {
    if (this.walking) return;
    this.interacted = true;
    if (this.tour.active || this.narrating) this.stopAll();
  }

  /** Bring the camera to a county and name it. */
  zoomToCounty(name: string): void {
    const key = countyKey(name);
    const shape = this.countyShapes.find((c) => c.key === key);
    if (!shape) return;
    this.touch();
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
    this.touch();
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
    this.touch();
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

  /**
   * Open the authority a pin stands for. A court's pin brings the camera to that court; a county's
   * pin does not move the map, because the county itself is the place that zooms and the reader is
   * reading the authority, not looking for the county.
   */
  openAuthority(i: number): void {
    const loc = this.locs[i];
    if (!this.cites[i] || !loc) return;
    this.touch();
    if (loc.cat === "county") {
      this.focusIndex = i;
      this.emit();
      return;
    }
    this.zoomToCourt(i);
  }

  resetCamera(): void {
    this.touch();
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
    this.touch();
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
    this.touch();
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

  /**
   * The walk. With `prologue` it begins at the top of the memo — the short answer, the sources, the
   * opinion and the memo — and then walks the authority stops; without it the reader has asked for
   * the authority walk, which is where the Play control starts.
   */
  startTour(n?: number, options: { prologue?: boolean; skipFirst?: boolean } = {}): void {
    const order = this.order();
    this.tour.count = order.length;
    if (typeof n === "number") this.tour.index = clamp(n, 0, Math.max(0, order.length - 1));
    this.tour.active = true;
    this.tourHold = true;
    this.interacted = true;
    if (options.prologue && this.cites.length) {
      this.prologue = options.skipFirst ? 1 : 0;
      this.playSection();
      return;
    }
    this.prologue = -1;
    this.playStop();
  }

  stopTour(): void {
    this.silence();
    this.stopCaption();
    this.tour.active = false;
    this.tour.playing = false;
    this.narrating = false;
    this.prologue = -1;
    this.emit();
  }

  pauseTour(): void {
    this.silence();
    this.tour.playing = false;
    this.narrating = false;
    this.emit();
  }

  /** Escape: the voice and the walk stop together, whatever was speaking. */
  stopAll(): void {
    this.interacted = true;
    this.stopTour();
  }

  nextStop(): void {
    this.interacted = true;
    this.pauseTour();
    this.prologue = -1;
    this.tour.index = clamp(this.tour.index + 1, 0, Math.max(0, this.order().length - 1));
    this.emit();
  }

  previousStop(): void {
    this.interacted = true;
    this.pauseTour();
    this.prologue = -1;
    this.tour.index = clamp(this.tour.index - 1, 0, Math.max(0, this.order().length - 1));
    this.emit();
  }

  private finishTour(): void {
    this.silence();
    this.stopCaption();
    this.tour.active = false;
    this.tour.playing = false;
    this.narrating = false;
    this.prologue = -1;
    this.emit();
  }

  /** One section of the memo: the short answer, the sources, the opinion, then the memo itself. */
  private playSection(): void {
    const plan = this.plan();
    this.silence();
    if (this.prologue < 0 || this.prologue > 3) {
      this.prologue = -1;
      this.playStop();
      return;
    }
    const stop = plan[this.prologue];
    if (!stop) {
      this.prologue = -1;
      this.playStop();
      return;
    }
    const index = this.prologue;
    this.tour.section = stop.section;
    this.tour.playing = true;
    this.narrating = true;
    this.startCaption(stop.text);
    this.tourStartedAt = performance.now();
    this.emit();

    const session = this.beginNarration(stop.text, () => {
      if (this.session !== session || !this.tour.active) return;
      this.endSpeaking();
      const elapsed = performance.now() - this.tourStartedAt;
      const wait = Math.max(0, SECTION_HOLD_MS - elapsed);
      const advance = () => {
        if (this.session !== session || !this.tour.active) return;
        this.prologue = index + 1;
        this.playSection();
      };
      if (wait > 0) window.setTimeout(advance, wait);
      else advance();
    });
    this.session = session;

    const next = plan[index + 1];
    if (next && !this.muted) prefetchClip(next.text);
  }

  private playStop(): void {
    const order = this.order();
    this.silence();
    if (this.tour.index >= order.length) {
      this.finishTour();
      return;
    }
    const stop = this.tour.index;
    this.walking = true;
    this.focus(order[stop]);
    this.walking = false;
    const text = this.spokenFor(order[stop]);
    const hold = this.tourHold;
    this.tourHold = false;
    this.tour.playing = true;
    this.narrating = true;
    this.tour.section = "Authorities";
    this.startCaption(text);
    this.tourStartedAt = performance.now();
    this.emit();

    const session = this.beginNarration(text, () => {
      if (this.session !== session || !this.tour.active) return;
      this.endSpeaking();
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

    // The next clip is fetched while this one plays, so the walk never waits on the network. It is
    // only cached, never played, so it cannot cut the current line off.
    const next = order[stop + 1];
    if (next !== undefined && !this.muted) prefetchClip(this.spokenFor(next));
  }

  // ---------------------------------------------------------------- the walk's plan and caption

  /** The stops of the walk, in the order the memo is written. */
  plan(): PlanStop[] {
    if (!this.cites.length) return [];
    const out: PlanStop[] = [
      { section: "Short answer", text: this.answerText, cite: null },
      { section: "Sources", text: this.sourcesText(), cite: null },
      { section: "Opinion", text: this.opinionText(), cite: null },
      { section: "Memo", text: this.memoText(), cite: null },
    ];
    for (const i of this.order()) out.push({ section: "Authorities", text: this.spokenFor(i), cite: i });
    return out;
  }

  /** The sources stop: every authority the answer rests on, with the court that decided it. */
  private sourcesText(): string {
    const parts = this.cites.map((c, i) => {
      const court = this.locs[i]?.court || "";
      const year = String(c.date || "").match(/\d{4}/)?.[0] || "";
      return [c.title || c.citation || c.id || "", court, year].filter(Boolean).join(", ");
    });
    const n = parts.length;
    if (!n) return "No authority was retrieved for this answer.";
    return `Sources: ${n} ${n === 1 ? "authority" : "authorities"}. ${parts.slice(0, 8).join("; ")}.`;
  }

  private sectionText(headings: string[]): string {
    const raw = String(this.ctx.answer || "");
    const blocks = raw.split(/\n(?=#{1,6}\s)/);
    return blocks
      .filter((block) => headings.some((h) => new RegExp(`^#{1,6}\\s*${h}`, "i").test(block.trim())))
      .map((block) => plainText(block))
      .join(" ")
      .trim();
  }

  private opinionText(): string {
    const text = this.sectionText(["Opinion", "Caveat", "Holding"]);
    return text || "The memo records no separate opinion or caveat.";
  }

  private memoText(): string {
    const key = this.sectionText(["Key authorities"]);
    const text = key || plainText(String(this.ctx.answer || ""));
    return text.slice(0, 900);
  }

  /** The caption reveals its text as the voice reads it. */
  private startCaption(text: string): void {
    this.stopCaption();
    this.captionLine = text;
    this.captionShown = Math.min(1, text.length);
    const step = Math.max(1, Math.ceil(text.length / 40));
    this.captionTimer = window.setInterval(() => {
      this.captionShown = Math.min(this.captionLine.length, this.captionShown + step);
      this.emit();
      if (this.captionShown >= this.captionLine.length) this.stopCaption();
    }, 70);
  }

  private stopCaption(): void {
    if (this.captionTimer !== null) {
      window.clearInterval(this.captionTimer);
      this.captionTimer = null;
    }
  }

  caption(): Caption {
    const plan = this.plan();
    const stop = this.prologue >= 0 ? plan[this.prologue] : undefined;
    const section = stop ? stop.section : this.tour.section;
    const text = stop ? stop.text : this.captionLine;
    return {
      section: text ? section : "",
      shown: Math.min(this.captionShown, text.length),
      index: this.tour.index,
      total: text.length,
    };
  }

  /** The text of a tour position, for a caller that wants the whole line. */
  captionText(): string {
    const plan = this.plan();
    const stop = this.prologue >= 0 ? plan[this.prologue] : undefined;
    return stop ? stop.text : this.captionLine;
  }

  // ---------------------------------------------------------------- narration

  /**
   * The memo's short answer, in its own words: what Listen speaks first, what the map shows as its
   * summary, and what the walk's first stop says. The Markdown is not spoken.
   */
  private extractShortAnswer(): string {
    const raw = (this.ctx.answer || "").trim();
    if (!raw) return "";
    const first = raw.split(/\n\s*\n/).find((part) => part.trim()) || raw;
    return plainText(first).slice(0, 400);
  }

  /** Listen: speak the short answer, then walk the memo and its authorities. A second press stops both. */
  listen(): void {
    if (this.narrating) {
      this.stopListening();
      return;
    }
    if (!this.answerText) return;
    this.narrateMemo(() => this.startTour(0, { prologue: true, skipFirst: true }));
  }

  narrateMemo(onEnd?: () => void): void {
    const text = this.answerText;
    if (!text) return;
    this.silence();
    this.narrating = true;
    this.tour.section = "Short answer";
    this.startCaption(text);
    this.emit();
    const session = this.beginNarration(text, () => {
      if (this.session !== session) return;
      this.endSpeaking();
      this.narrating = false;
      this.emit();
      onEnd?.();
    });
    this.session = session;
  }

  stopListening(): void {
    this.silence();
    this.stopCaption();
    this.narrating = false;
    if (this.tour.playing) this.tour.playing = false;
    this.emit();
  }

  /**
   * Mute silences every narration: the clip speaking now stops, and later lines are fetched and
   * played not at all. A tour that was walking keeps walking, silently.
   */
  setMuted(next: boolean): void {
    if (this.muted === next) return;
    this.muted = next;
    if (next) {
      const walking = this.tour.active && this.tour.playing;
      this.silence();
      this.narrating = false;
      if (walking) {
        // The walk carries on without sound, so the reader keeps their place.
        if (this.prologue >= 0) this.playSection();
        else this.playStop();
        return;
      }
    }
    this.emit();
  }

  /** Stop whatever is speaking and forget it, so a clip that arrives late changes nothing. */
  private silence(): void {
    this.narrationToken += 1;
    this.session?.stop();
    this.session = null;
    this.loading = false;
    // Nothing is being spoken any more, so the indicator stops and the state says so — except for a
    // voice that could not be heard at all, which stays reported until the next line.
    const status = this.speaker.status;
    this.speaker = {
      ...this.speaker,
      active: false,
      status: status === "speaking" || status === "loading" ? "idle" : status,
    };
  }

  /** The line has ended: the indicator stops, and a state the reader needs to see is kept. */
  private endSpeaking(): void {
    const status = this.speaker.status;
    this.speaker = {
      ...this.speaker,
      active: false,
      status: status === "speaking" || status === "loading" ? "idle" : status,
    };
  }

  private setSpeakerStatus(status: SpeakerState["status"]): void {
    this.speaker = { ...this.speaker, status };
  }

  /** Start one line, telling the page while its clip is being fetched, playing or unavailable. */
  private beginNarration(text: string, onEnd: () => void): Narration {
    const token = (this.narrationToken += 1);
    this.loading = false;
    this.speaker = {
      active: true,
      name: SPEAKER_NAME,
      line: text.length > 240 ? text.slice(0, 240) + "…" : text,
      status: this.muted ? "silent" : "loading",
    };
    this.emit();
    return narrate(text, onEnd, {
      muted: this.muted,
      loading: (on) => {
        if (token !== this.narrationToken) return;
        this.loading = on;
        if (on) this.setSpeakerStatus("loading");
        this.emit();
      },
      playing: () => {
        if (token !== this.narrationToken) return;
        this.setSpeakerStatus("speaking");
        this.emit();
      },
      unavailable: () => {
        if (token !== this.narrationToken) return;
        this.setSpeakerStatus("unavailable");
        this.emit();
      },
    });
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
    const hue = (0.42 - 0.3 * h) * 360;
    return hslHex(hue, 72, p.heatLightness);
  }

  /**
   * The boundary colour of a county: brighter where an authority is placed in it, so the counties the
   * run touches stand out from the sixty-four.
   */
  private countyOutline(county: CountyShape): string {
    const p = this.palette();
    const held = (this.heat["c:" + county.name.toLowerCase()] || 0) > 0;
    return held ? p.countyLineHeld : p.countyLine;
  }

  /** Build (or rebuild) the scene: vertex buffers for the solid map, or the flat layer without WebGL. */
  private rebuild(): void {
    if (!this.world) return;
    const p = this.palette();
    if (this.renderer) {
      this.renderer.setOcean(p.ocean);
      this.buffers = buildScene({
        states: this.world.states,
        counties: this.world.counties.map((c) => ({
          name: c.name,
          polys: c.polys,
          fill: this.countyFill(c),
          outline: this.countyOutline(c),
        })),
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
      g.strokeStyle = n > 0 ? p.countyLineHeld : p.countyLine;
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
    const progress = clamp(this.motion.arcProgress, 0, 1);
    if (this.renderer) {
      this.renderer.resize(this.width, this.height);
      this.renderer.render(this.cam3 as Camera3, this.basemapOn && !!this.basemapImage, progress);
      return;
    }
    this.renderFlat(progress);
  }

  private renderFlat(progress = 1): void {
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
      if (progress <= 0.02) break;
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
      // A link grows from its source to its target: only the part already drawn is traced.
      const steps = Math.max(2, Math.round(14 * progress));
      for (let i = 1; i <= steps; i += 1) {
        const t = (i / steps) * progress;
        const u = 1 - t;
        g.lineTo(u * u * x1 + 2 * u * t * cx + t * t * x2, u * u * y1 + 2 * u * t * cy + t * t * y2);
      }
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

  /**
   * The citations the pin for citation i stands for. A pin is one place, so every authority that
   * resolves to that place shares it; the answer is the pin's own list, never a guess.
   */
  pinCites(i: number): number[] {
    const pin = this.pins.find((p) => p.items.includes(i));
    return pin ? pin.items.slice() : [];
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
    const now = performance.now();
    const activeCite = this.prologue < 0 && this.tour.active ? this.order()[this.tour.index] : undefined;
    for (let order = 0; order < groups.length; order += 1) {
      const group = groups[order];
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
        scale: this.pinScale(order, now),
        active: activeCite !== undefined && group.items.includes(activeCite),
      });
    }
    this.pins = out;
    this.layoutLabels();
  }

  /**
   * The names that belong to a level: court names while a court is in view, county names while a
   * county is, the state's name while the state is. Nothing at the national view, so the drawing
   * stays quiet.
   *
   * A label states what it names — for a court, the authority, the court that decided it and the
   * year — and is placed where it overlaps no other label and no pin. A label with no free place is
   * not drawn, and is not reported.
   */
  private layoutLabels(): void {
    const out: LabelView[] = [];
    const W = this.width;
    const H = this.height;
    if (!W || !H) {
      this.labels = out;
      return;
    }
    // Pins own their own box, so a label never lands on one.
    const placed: Rect[] = this.pins.map((pin) => ({
      x: pin.x - PIN_SIZE / 2,
      y: pin.y - PIN_SIZE / 2,
      w: PIN_SIZE,
      h: PIN_SIZE,
    }));
    const onScreen = (x: number, y: number) => x > -30 && y > -10 && x < W + 30 && y < H + 10;

    if (this.level === "court") {
      const pins = this.pins.filter((pin) => onScreen(pin.ax, pin.ay));
      // The court the reader asked for, and then the stop the walk is on, are named first, so their
      // labels are never the ones that do not fit.
      const rank = (pin: PinView) => (pin.items.includes(this.focusIndex ?? -1) ? 2 : 0) + (pin.active ? 1 : 0);
      pins.sort((a, b) => rank(b) - rank(a));
      for (const pin of pins) {
        const c = this.cites[pin.index];
        if (!c) continue;
        const court = this.locs[pin.index]?.court || "";
        const year = String(c.date || "").match(/\d{4}/)?.[0] || "";
        const text = [c.title || c.citation || "Authority", court, year].filter(Boolean).join(" · ");
        this.placeLabel(out, placed, `court:${pin.key}`, text, pin.x, pin.y, pin.active);
      }
    } else if (this.level === "county") {
      const shapes = this.countyShapes
        .map((shape) => ({ shape, n: this.heat["c:" + shape.key] || 0 }))
        .filter((entry) => entry.n > 0 || entry.shape.key === this.focusCounty)
        .sort((a, b) => b.n - a.n)
        .slice(0, 12);
      for (const { shape } of shapes) {
        const point = this.toScreen(shape.c[0], shape.c[1], SURFACE_Y);
        if (!point || !onScreen(point[0], point[1])) continue;
        this.placeLabel(
          out,
          placed,
          `county:${shape.key}`,
          `${shape.name} County`,
          point[0],
          point[1],
          shape.key === this.focusCounty,
          0,
        );
      }
    } else if (this.level === "state") {
      const co = this.world?.states.find((s) => s.name === "Colorado");
      const [x, y] = co ? this.centreOf(co.polys) : [WORLD_WIDTH / 2, WORLD_HEIGHT / 2];
      const point = this.toScreen(x, y, SURFACE_Y);
      if (point) this.placeLabel(out, placed, "state:co", "Colorado", point[0], point[1], true, 0);
    }
    this.labels = out;
  }

  /**
   * Put one label beside its anchor: above it, below it, then to either side, and finally on the
   * anchor itself for a label with no pin to clear. Returns nothing when no place is free.
   */
  private placeLabel(
    out: LabelView[],
    placed: Rect[],
    key: string,
    text: string,
    ax: number,
    ay: number,
    strong: boolean,
    lift = PIN_SIZE / 2,
  ): void {
    if (!text) return;
    // Wide enough for the whole line at the label's own type size, so nothing the label states is
    // cut off, but never wider than the pane it is drawn in.
    const w = Math.min(Math.round(text.length * 6.6) + 12, Math.max(160, this.width - 8));
    const h = LABEL_H;
    const candidates: [number, number][] = [
      [ax, ay - lift - h / 2 - 2],
      [ax, ay + lift + h / 2 + 2],
      [ax + lift + w / 2 + 2, ay],
      [ax - lift - w / 2 - 2, ay],
      [ax, ay - lift - h * 2 - 6],
      [ax, ay],
    ];
    for (const [x, y] of candidates) {
      const rect = { x: x - w / 2, y: y - h / 2, w, h };
      if (rect.x < 2 || rect.y < 2 || rect.x + w > this.width - 2 || rect.y + h > this.height - 2) continue;
      if (placed.some((q) => overlaps(rect, q))) continue;
      if (this.avoid.some((q) => overlaps(rect, q))) continue;
      placed.push(rect);
      out.push({ key, text, x: round4(x), y: round4(y), w, h, strong });
      return;
    }
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
