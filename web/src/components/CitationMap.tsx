// The map: MapLibre GL JS, through react-map-gl's declarative wrapper, over OpenFreeMap's keyless
// OpenStreetMap vector tiles in a pale grey, so the authorities stay the only colour on the page. One pin
// per place an answer's authorities sit in, one curved arc per link between them, and the county lines
// from the Census's public-domain boundaries.
//
// The pins are react-map-gl <Marker>s: the library owns the absolutely positioned wrapper, so the
// pin's own styling can never push it off its coordinate (the old hand-made markers carried a
// `relative` class that overrode MapLibre's positioning and drifted every pin off its place).
//
// The tour drives the camera with flyTo, one flight per change of `focus`.

import type * as GeoJSON from "geojson";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
// MapLibre 6 ships its tile worker as a separate ES module that the bundler has to emit and point it at;
// without this the worker 404s and no tile (vector or raster) is ever drawn.
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import MapGL, {
  AttributionControl,
  Layer,
  Marker,
  NavigationControl,
  ScaleControl,
  Source,
  type MapRef,
} from "react-map-gl/maplibre";
import { LocateFixed } from "lucide-react";
import { Button } from "@/components/ui/button";
import { arcType, locate, type Citation, type Edge, type Location } from "@/lib/citations";
import { OVERVIEW } from "@/map/tour";
import { ARC_COLORS, ARC_LABELS, CATEGORY_COLORS, CATEGORY_LABELS, CONTEXT_COLORS } from "@/map/palette";
import { cn } from "@/lib/utils";

/** The authorities that resolve to one place on the map. */
export type MapPlace = { key: string; label: string; citations: Citation[] };

type Pin = {
  key: string;
  label: string;
  loc: Location;
  lngLat: [number, number];
  citations: Citation[];
};

/** Colorado, low enough that the state sits in the middle of the pane before the pins are fitted. */
const CENTER: [number, number] = [-105.55, 39.0];

/**
 * The basemap: OpenFreeMap's "positron" style — OpenStreetMap data as vector tiles, free, keyless and
 * MIT/ODbL licensed (https://openfreemap.org). Positron is the pale grey cartography the old muted raster
 * imitated, so the pins stay the only colour on the page. Its glyph server also draws the county names.
 */
const BASEMAP = "https://tiles.openfreemap.org/styles/positron";

/**
 * The counties. The tiles draw their own county boundaries but faintly, and a raster tile cannot be
 * asked for a line, so the county mesh and its names come from the Census's own boundaries: public
 * domain, keyless, and served over a CDN. Only Colorado is kept, so the map is Colorado's map.
 */
const COUNTY_URL = "https://cdn.jsdelivr.net/gh/plotly/datasets@master/geojson-counties-fips.json";
const COUNTY_SOURCE = "co-counties";
const COUNTY_LINE = "co-county-line";
const COUNTY_NAME = "co-county-name";

/**
 * Colorado's own bounds, in lng/lat. An authority outside them — the U.S. Code, a circuit court, the
 * Supreme Court — is real and worth a pin, but fitting the camera to it as well drags the whole state
 * down to a smudge in the middle of the country, where nothing can be read. So the camera fits the
 * state's own authorities, and the out-of-state ones are a pan away.
 */
const CO_BOUNDS: [number, number, number, number] = [-109.1, 36.9, -102.0, 41.1];

const inColorado = (pin: Pin) =>
  pin.lngLat[0] >= CO_BOUNDS[0] &&
  pin.lngLat[0] <= CO_BOUNDS[2] &&
  pin.lngLat[1] >= CO_BOUNDS[1] &&
  pin.lngLat[1] <= CO_BOUNDS[3];

/** One download for the whole page: every mount, and every style reload, reads the same promise. */
let counties: Promise<GeoJSON.FeatureCollection | null> | null = null;

function coloradoCounties(): Promise<GeoJSON.FeatureCollection | null> {
  if (counties) return counties;
  counties = fetch(COUNTY_URL)
    .then((response) => (response.ok ? (response.json() as Promise<GeoJSON.FeatureCollection>) : null))
    .then((all) => {
      if (!all?.features) return null;
      const features = all.features.filter(
        (feature) => String((feature.properties as { STATE?: string } | null)?.STATE) === "08",
      );
      return features.length ? ({ type: "FeatureCollection", features } as GeoJSON.FeatureCollection) : null;
    })
    .catch(() => null);
  return counties;
}

const TRAIL = "trail";
const ARROW = "trail-arrow";

/**
 * A quadratic arc between two places. It is bowed to the left of a→b, so the two directions of one link
 * never lie on top of each other, and it is measured in locally scaled degrees so a long link does not
 * bow further off the page than a short one.
 */
function curve(a: [number, number], b: [number, number]): [number, number][] {
  const k = Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180) || 1;
  const ax = a[0] * k;
  const ay = a[1];
  const bx = b[0] * k;
  const by = b[1];
  const dx = bx - ax;
  const dy = by - ay;
  const cx = (ax + bx) / 2 - dy * 0.14;
  const cy = (ay + by) / 2 + dx * 0.14;
  const points: [number, number][] = [];
  for (let i = 0; i <= 24; i += 1) {
    const t = i / 24;
    const u = 1 - t;
    points.push([(u * u * ax + 2 * u * t * cx + t * t * bx) / k, u * u * ay + 2 * u * t * cy + t * t * by]);
  }
  return points;
}

/** An arrowhead pointing right, drawn once on a canvas so the trail needs no sprite sheet or network. */
function addArrow(map: maplibregl.Map, color: string) {
  if (map.hasImage(ARROW)) return;
  const size = 32;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) return;
  context.fillStyle = color;
  context.beginPath();
  context.moveTo(3, 5);
  context.lineTo(size - 3, size / 2);
  context.lineTo(3, size - 5);
  context.closePath();
  context.fill();
  map.addImage(ARROW, context.getImageData(0, 0, size, size), { pixelRatio: 2 });
}

/** One pin per place: the authorities that resolve to the same court share it. */
function buildPins(citations: Citation[]): Pin[] {
  const places = new Map<string, Pin>();
  for (const citation of citations) {
    const loc = locate(citation);
    const existing = places.get(loc.key);
    if (existing) {
      existing.citations.push(citation);
      continue;
    }
    places.set(loc.key, {
      key: loc.key,
      label: loc.label,
      loc,
      lngLat: [loc.ll[1], loc.ll[0]],
      citations: [citation],
    });
  }
  return [...places.values()];
}

const reducedMotion = () => !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

maplibregl.setWorkerUrl(workerUrl);

/** One empty list, shared, so a missing prop does not look like new data on every render. */
const NONE: never[] = [];

export default function CitationMap({
  citations = NONE,
  edges = NONE,
  focus = null,
  trail = NONE,
  onSelect,
  className,
}: {
  citations?: Citation[];
  edges?: Edge[];
  /** The place the tour is on (a pin key, or OVERVIEW for every pin), so the camera follows the voice. */
  focus?: string | null;
  /** The places the tour has walked so far, in order, so the graph shows its own traversal. */
  trail?: string[];
  onSelect: (place: MapPlace) => void;
  className?: string;
}) {
  const mapRef = useRef<MapRef | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [zoom, setZoom] = useState(6);
  const [countyData, setCountyData] = useState<GeoJSON.FeatureCollection | null>(null);

  const pins = useMemo(() => buildPins(citations), [citations]);

  const fit = useCallback(() => {
    const map = mapRef.current;
    if (!map || !pins.length) return;
    const duration = reducedMotion() ? 0 : 1600;
    // Fit the state's own authorities; a lone federal pin in Washington does not get to decide the scale.
    const home = pins.filter(inColorado);
    const targets = home.length ? home : pins;
    if (targets.length === 1) {
      map.flyTo({ center: targets[0].lngLat, zoom: 9.2, duration, essential: true });
      return;
    }
    const bounds = new maplibregl.LngLatBounds();
    for (const pin of targets) bounds.extend(pin.lngLat);
    map.fitBounds(bounds, { padding: 64, maxZoom: 10, duration, linear: false });
  }, [pins]);

  useEffect(() => {
    let live = true;
    void coloradoCounties().then((data) => {
      if (live) setCountyData(data);
    });
    return () => {
      live = false;
    };
  }, []);

  const links = useMemo<GeoJSON.FeatureCollection<GeoJSON.LineString>>(() => {
    // A link is drawn between the two pins its authorities sit on; a link inside one place is not a link.
    const pinOf = new Map<string, Pin>();
    for (const pin of pins) for (const citation of pin.citations) pinOf.set(citation.id, pin);
    const features: GeoJSON.Feature<GeoJSON.LineString, { arc: string }>[] = [];
    for (const edge of edges) {
      const from = pinOf.get(edge.src);
      const to = pinOf.get(edge.dst);
      if (!from || !to || from.key === to.key) continue;
      features.push({
        type: "Feature",
        properties: { arc: arcType(from.loc, to.loc) },
        geometry: { type: "LineString", coordinates: curve(from.lngLat, to.lngLat) },
      });
    }
    return { type: "FeatureCollection", features };
  }, [pins, edges]);

  // The traversal: the places the tour has already walked, joined in order, inked over the pale links.
  const walked = useMemo<GeoJSON.FeatureCollection<GeoJSON.LineString>>(() => {
    const pinOf = new Map(pins.map((pin) => [pin.key, pin] as const));
    const stops = trail.map((key) => pinOf.get(key)).filter((pin): pin is Pin => !!pin);
    const features: GeoJSON.Feature<GeoJSON.LineString>[] = [];
    for (let index = 1; index < stops.length; index += 1) {
      const from = stops[index - 1];
      const to = stops[index];
      if (from.key === to.key) continue;
      features.push({
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates: curve(from.lngLat, to.lngLat) },
      });
    }
    return { type: "FeatureCollection", features };
  }, [trail, pins]);

  // A new answer: frame its authorities.
  useEffect(() => {
    if (ready) fit();
  }, [ready, fit]);

  // The camera follows the tour. Each change of `focus` comes from the narration (a new spoken step, or
  // the voice reaching a cited authority mid-line), and flies there: out, across and back in, so the
  // reader sees where one authority sits relative to the last. OVERVIEW frames every authority.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || focus === null) return;
    if (focus === OVERVIEW) {
      fit();
      return;
    }
    const pin = pins.find((candidate) => candidate.key === focus);
    if (!pin) return;
    map.flyTo({
      center: pin.lngLat,
      zoom: inColorado(pin) ? 9.2 : 6,
      speed: 0.9,
      curve: 1.5,
      duration: reducedMotion() ? 0 : undefined,
      essential: true,
    });
  }, [focus, ready, pins, fit]);

  const onLoad = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (map) addArrow(map, CONTEXT_COLORS.trail);
    setReady(true);
  }, []);

  const showLabels = zoom >= 5.5;
  const linkColor: maplibregl.ExpressionSpecification = [
    "match",
    ["get", "arc"],
    "cc",
    ARC_COLORS.cc,
    "cs",
    ARC_COLORS.cs,
    "st",
    ARC_COLORS.st,
    "fed",
    ARC_COLORS.fed,
    ARC_COLORS.other,
  ];
  const county = !!countyData;

  if (failed) {
    return (
      <div
        className={cn(
          "grid h-full place-items-center rounded-lg border border-border bg-muted p-6 text-center",
          className,
        )}
      >
        <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
          This browser did not give the page WebGL, so the map cannot be drawn. The authorities are still listed under
          Sources on the answer.
        </p>
      </div>
    );
  }

  return (
    <div className={cn("relative h-full w-full overflow-hidden rounded-lg border border-border bg-muted", className)}>
      <MapGL
        ref={mapRef}
        mapLib={maplibregl}
        mapStyle={BASEMAP}
        initialViewState={{ longitude: CENTER[0], latitude: CENTER[1], zoom: 6 }}
        minZoom={3}
        maxZoom={16}
        maxPitch={0}
        dragRotate={false}
        pitchWithRotate={false}
        touchPitch={false}
        renderWorldCopies={false}
        attributionControl={false}
        onLoad={onLoad}
        onZoom={(event) => setZoom(event.viewState.zoom)}
        onError={(event) => {
          if (/webgl/i.test(String(event.error?.message))) setFailed(true);
        }}
        style={{ position: "absolute", inset: 0 }}
      >
        <AttributionControl compact />
        <NavigationControl position="top-right" showCompass={false} visualizePitch={false} />
        <ScaleControl position="bottom-left" unit="imperial" maxWidth={96} />

        {countyData && (
          <Source id={COUNTY_SOURCE} type="geojson" data={countyData}>
            <Layer
              id={COUNTY_LINE}
              type="line"
              paint={{
                "line-color": CONTEXT_COLORS.county,
                "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.6, 9, 1.2, 14, 1.8],
                "line-dasharray": [2, 1.4],
                "line-opacity": ["interpolate", ["linear"], ["zoom"], 4.5, 0, 6, 0.95],
              }}
            />
            <Layer
              id={COUNTY_NAME}
              type="symbol"
              minzoom={6.5}
              layout={{
                "text-font": ["Noto Sans Regular"],
                "text-field": ["get", "NAME"],
                "text-size": ["interpolate", ["linear"], ["zoom"], 6.5, 9.5, 12, 11.5],
                "text-letter-spacing": 0.12,
                "text-transform": "uppercase",
                "text-max-width": 8,
                "text-padding": 10,
              }}
              paint={{
                "text-color": CONTEXT_COLORS.countyLabel,
                "text-halo-color": "#ffffff",
                "text-halo-width": 1.4,
                "text-halo-blur": 0.4,
                "text-opacity": 0.85,
              }}
            />
          </Source>
        )}

        <Source id="links" type="geojson" data={links}>
          <Layer
            id="links"
            type="line"
            layout={{ "line-cap": "round", "line-join": "round" }}
            paint={{
              "line-color": linkColor,
              "line-width": ["interpolate", ["linear"], ["zoom"], 4, 1.2, 8, 1.8],
              // While the walk is running the untouched links step back, so the traversal is what you see.
              "line-opacity": walked.features.length ? 0.15 : 0.55,
            }}
          />
        </Source>

        <Source id={TRAIL} type="geojson" data={walked}>
          {/* A white casing under the ink, so the walked path stays legible over county lines and names. */}
          <Layer
            id={`${TRAIL}-casing`}
            type="line"
            layout={{ "line-cap": "round", "line-join": "round" }}
            paint={{ "line-color": "#ffffff", "line-width": 6, "line-opacity": 0.85 }}
          />
          <Layer
            id={TRAIL}
            type="line"
            layout={{ "line-cap": "round", "line-join": "round" }}
            paint={{ "line-color": CONTEXT_COLORS.trail, "line-width": 2.6 }}
          />
          {ready && (
            <Layer
              id={`${TRAIL}-arrow`}
              type="symbol"
              layout={{
                "symbol-placement": "line",
                "symbol-spacing": 48,
                "icon-image": ARROW,
                "icon-size": 0.7,
                "icon-rotation-alignment": "map",
                "icon-allow-overlap": true,
                "icon-ignore-placement": true,
              }}
            />
          )}
        </Source>

        {pins.map((pin) => {
          const names = pin.citations.map((citation) => citation.title || citation.citation || "Authority").join("; ");
          const count = pin.citations.length === 1 ? "1 authority" : `${pin.citations.length} authorities`;
          const marked = focus !== null && focus === pin.key;
          // react-map-gl owns the positioned wrapper, so nothing in here can move the dot off its point:
          // the dot's centre is the coordinate at every zoom, and the name hangs beneath it.
          return (
            <Marker key={pin.key} longitude={pin.lngLat[0]} latitude={pin.lngLat[1]} anchor="center">
              <div data-place={pin.key} className="relative flex h-8 w-8 items-center justify-center">
                <button
                  type="button"
                  data-dot=""
                  aria-label={`${count} at ${pin.label}: ${names}`}
                  title={`${pin.label}\n${names}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelect({ key: pin.key, label: pin.label, citations: pin.citations });
                  }}
                  style={{ backgroundColor: CATEGORY_COLORS[pin.loc.cat] }}
                  className={cn(
                    "flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border-2 border-background text-[11px] font-semibold text-white shadow-md transition-transform hover:scale-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                    marked && "scale-125 ring-2 ring-foreground ring-offset-2 ring-offset-background",
                  )}
                >
                  {pin.citations.length > 1 ? String(pin.citations.length) : ""}
                </button>
                <span
                  data-label=""
                  className={cn(
                    "pointer-events-none absolute left-1/2 top-full mt-0.5 max-w-[10rem] -translate-x-1/2 truncate rounded bg-background/85 px-1 text-[10px] font-medium leading-tight text-foreground shadow-sm",
                    !showLabels && "hidden",
                  )}
                >
                  {pin.label}
                </span>
              </div>
            </Marker>
          );
        })}
      </MapGL>
      {/* A hairline and a soft inner shade, so the tiles sit in the card instead of bleeding out of it. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.06),inset_0_2px_18px_rgba(15,23,42,0.10)]"
      />

      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={fit}
        className="absolute left-3 top-3 gap-1.5 shadow-sm"
        disabled={!pins.length}
      >
        <LocateFixed className="h-4 w-4" />
        Fit to the authorities
      </Button>

      <div className="absolute bottom-3 right-3 hidden max-w-[16rem] flex-col gap-1 rounded-md border border-border bg-background/90 px-2.5 py-1.5 text-[11px] text-muted-foreground shadow-sm backdrop-blur sm:flex">
        <ul className="flex flex-wrap gap-x-3 gap-y-1">
          {(Object.keys(CATEGORY_LABELS) as (keyof typeof CATEGORY_LABELS)[]).map((category) => (
            <li key={category} className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: CATEGORY_COLORS[category] }}
              />
              {CATEGORY_LABELS[category]}
            </li>
          ))}
        </ul>
        <ul className="flex flex-wrap gap-x-3 gap-y-1 border-t border-border pt-1">
          {(Object.keys(ARC_LABELS) as (keyof typeof ARC_LABELS)[]).map((arc) => (
            <li key={arc} className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="h-0.5 w-3 shrink-0 rounded-full"
                style={{ backgroundColor: ARC_COLORS[arc] }}
              />
              {ARC_LABELS[arc]}
            </li>
          ))}
        </ul>
        {(county || trail.length > 1) && (
          <ul className="flex flex-wrap gap-x-3 gap-y-1 border-t border-border pt-1">
            {county && (
              <li className="flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className="w-3 shrink-0 border-t border-dashed"
                  style={{ borderColor: CONTEXT_COLORS.county }}
                />
                County boundary
              </li>
            )}
            {trail.length > 1 && (
              <li className="flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className="h-0.5 w-3 shrink-0 rounded-full"
                  style={{ backgroundColor: CONTEXT_COLORS.trail }}
                />
                Path walked
              </li>
            )}
          </ul>
        )}
      </div>

      {!pins.length && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center p-6">
          <p className="rounded-md border border-border bg-background/90 px-3 py-2 text-sm text-muted-foreground shadow-sm">
            This answer cites no authority that can be placed on the map.
          </p>
        </div>
      )}
    </div>
  );
}
