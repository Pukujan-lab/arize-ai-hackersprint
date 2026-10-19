// Projection and the vendored map geometry. The geometry is pre-projected into the 975×610 space
// that d3.geoAlbersUsa().scale(1300).translate([487.5, 305]) produces, and it ships inside this
// build (web/public/vendor) rather than being read from /static at runtime.

export type Ring = [number, number][];
export type StateShape = { name: string; polys: Ring[] };
export type CountyShape = { name: string; fips: string; c: [number, number]; polys: Ring[] };

export type World = { states: StateShape[]; counties: CountyShape[] };

const SCALE = 1300;
const TRANSLATE: [number, number] = [487.5, 305];

type GeoProjection = {
  (point: [number, number]): [number, number] | null;
  invert?: (point: [number, number]) => [number, number] | null;
};

type D3 = {
  geoAlbersUsa: () => GeoProjection;
  geoAlbers: () => GeoProjection;
};

declare global {
  interface Window {
    d3?: D3;
  }
}

let composite: GeoProjection | null = null;
let lower48: GeoProjection | null = null;

function d3(): D3 | null {
  return typeof window !== "undefined" && window.d3 ? window.d3 : null;
}

/** Longitude/latitude → the projected plane the geometry lives in. */
export function project(ll: [number, number]): [number, number] {
  const api = d3();
  if (!api) return [TRANSLATE[0], TRANSLATE[1]];
  if (!composite) composite = api.geoAlbersUsa().scale(SCALE).translate(TRANSLATE);
  const p = composite([ll[1], ll[0]]) || composite([-104.98, 39.74]);
  return p ? [p[0], p[1]] : [TRANSLATE[0], TRANSLATE[1]];
}

/** The projected plane → longitude/latitude, for placing the basemap. */
export function unproject(x: number, y: number): [number, number] | null {
  const api = d3();
  if (!api) return null;
  if (!lower48) lower48 = api.geoAlbers().scale(SCALE).translate(TRANSLATE);
  if (!lower48.invert) return null;
  const p = lower48.invert([x, y]);
  return p ? [p[1], p[0]] : null;
}

export function projectionReady(): boolean {
  return !!d3();
}

export async function loadWorld(): Promise<World> {
  const [states, counties] = await Promise.all([
    fetch("/vendor/us_states_proj.json").then((r) => r.json() as Promise<StateShape[]>),
    fetch("/vendor/co_counties_proj.json").then((r) => r.json() as Promise<CountyShape[]>),
  ]);
  return { states, counties };
}

export const WORLD_WIDTH = 975;
export const WORLD_HEIGHT = 610;

/** The national view: the whole projected plane, centred. */
export const NATIONAL_CAMERA = { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2, zoom: 1 };
