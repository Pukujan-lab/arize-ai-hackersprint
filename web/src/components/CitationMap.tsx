// The map: MapLibre GL JS over OpenStreetMap's own raster tiles, muted to a grey so the authorities
// stay the only colour on the page, with one pin per place an answer's authorities sit in and one curved
// arc per link between them.
//
// Two things here are deliberate. The style is written out in this file rather than fetched, so the map
// has a valid style the instant it is created and never sits blank waiting for a style document from
// somebody else's server; and the pins are DOM markers, so they are there whatever the tiles do. The
// raster tiles carry the county lines, the place names, the neighbourhood names and the historic sites
// at every zoom without an account or a key; the counties are also drawn from the Census's public-domain
// boundaries, because a raster tile is a picture and cannot be asked for a crisp line.
//
// The links are curved arcs with arrowheads and the tour inks the path it has walked, so the citation
// graph reads as a graph rather than as a set of roads.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { LocateFixed } from "lucide-react";
import { Button } from "@/components/ui/button";
import { arcType, locate, type Citation, type Edge, type Location } from "@/lib/citations";
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

/** The font server the county names are drawn with: keyless, and only text ever asks it for anything. */
const GLYPHS = "https://fonts.openmaptiles.org/{fontstack}/{range}.pbf";

/**
 * The basemap, written here rather than fetched. OpenStreetMap's own raster tiles are the one keyless
 * source that carries county boundaries, place names, neighbourhood names and historic sites at every
 * zoom, and a raster layer needs no style document and no glyph server to start drawing. The raster
 * paint properties then mute them, so the map is a grey ground with legible names and the pins carry
 * the meaning.
 */
const basemap = (): maplibregl.StyleSpecification => ({
  version: 8,
  glyphs: GLYPHS,
  sources: {
    osm: {
      type: "raster",
      // The one host OpenStreetMap documents. The old `a`/`b`/`c` subdomains were retired, and a tile
      // URL that 403s leaves a grey pane with nothing to place the pins against.
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      maxzoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    },
  },
  layers: [
    // Painted under the tiles so the pane is paper-coloured while they arrive, not white.
    { id: "ground", type: "background", paint: { "background-color": "#eeece7" } },
    {
      id: "osm",
      type: "raster",
      source: "osm",
      paint: {
        "raster-saturation": -0.62,
        "raster-contrast": 0.06,
        "raster-brightness-min": 0.03,
        "raster-brightness-max": 0.99,
      },
    },
  ],
});

/**
 * The counties. The tiles draw their own county boundaries but faintly, and a raster tile cannot be
 * asked for a line, so the county mesh and its names come from the Census's own boundaries: public
 * domain, keyless, and served over a CDN. Only Colorado is kept, so the map is Colorado's map.
 */
const COUNTY_URL = "https://cdn.jsdelivr.net/gh/plotly/datasets@master/geojson-counties-fips.json";
const COUNTY_SOURCE = "co-counties";
const COUNTY_FILL = "co-fill";
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
  /** The place the tour is on, so the camera follows the voice. Null fits every authority. */
  focus?: string | null;
  /** The places the tour has walked so far, in order, so the graph shows its own traversal. */
  trail?: string[];
  onSelect: (place: MapPlace) => void;
  className?: string;
}) {
  const container = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markers = useRef<maplibregl.Marker[]>([]);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  /** Whether the county mesh is drawn, so the legend only names what is actually there. */
  const [county, setCounty] = useState(false);

  const pins = useMemo(() => buildPins(citations), [citations]);

  const fit = useCallback(() => {
    const map = mapRef.current;
    if (!map || !pins.length) return;
    const duration = reducedMotion() ? 0 : 700;
    // Fit the state's own authorities; a lone federal pin in Washington does not get to decide the scale.
    const home = pins.filter(inColorado);
    const targets = home.length ? home : pins;
    if (targets.length === 1) {
      map.easeTo({ center: targets[0].lngLat, zoom: 9.2, duration });
      return;
    }
    const bounds = new maplibregl.LngLatBounds();
    for (const pin of targets) bounds.extend(pin.lngLat);
    map.fitBounds(bounds, { padding: 64, maxZoom: 10, duration });
  }, [pins]);

  // The map is created once; everything after this only updates its data. Rotation is off: a map that
  // can be twisted by accident is a map that is hard to get back.
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: element,
        style: basemap(),
        center: CENTER,
        zoom: 6,
        minZoom: 3,
        maxZoom: 16,
        maxPitch: 0,
        dragRotate: false,
        pitchWithRotate: false,
        renderWorldCopies: false,
        attributionControl: { compact: true },
      });
    } catch {
      setFailed(true);
      return;
    }
    mapRef.current = map;
    map.touchZoomRotate.disableRotation();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false, visualizePitch: false }), "top-right");
    map.addControl(new maplibregl.ScaleControl({ unit: "imperial", maxWidth: 96 }), "bottom-left");

    // The style is written in this file, so it can be loaded before the listener below is attached;
    // check first, and only wait if there is something left to wait for.
    const onStyleLoad = () => setReady(true);
    map.on("style.load", onStyleLoad);
    if (map.isStyleLoaded()) setReady(true);

    // A map created before its pane has a height draws into nothing and stays blank until something
    // else resizes the window, so the pane is watched rather than assumed.
    const resize = new ResizeObserver(() => map.resize());
    resize.observe(element);

    return () => {
      resize.disconnect();
      map.off("style.load", onStyleLoad);
      for (const marker of markers.current) marker.remove();
      markers.current = [];
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // The county mesh: the state outline falls out of it for free, because the outer edges of every
  // Colorado county together are the state.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    let live = true;
    void coloradoCounties().then((data) => {
      if (!live || !data || !mapRef.current) return;
      if (!map.getSource(COUNTY_SOURCE)) map.addSource(COUNTY_SOURCE, { type: "geojson", data });
      // The state's own shape, painted *under* the tiles: when they arrive they cover it, and when they
      // do not the map still shows Colorado rather than an empty grey pane.
      if (!map.getLayer(COUNTY_FILL) && map.getLayer("osm")) {
        map.addLayer(
          {
            id: COUNTY_FILL,
            type: "fill",
            source: COUNTY_SOURCE,
            paint: { "fill-color": "#e3e0d8", "fill-opacity": 1 },
          },
          "osm",
        );
      }
      // The counties belong under the citation links and the walked path, not over them, so they are
      // inserted beneath the links layer rather than simply appended.
      const before = map.getLayer("links") ? "links" : undefined;
      if (!map.getLayer(COUNTY_LINE)) {
        map.addLayer(
          {
            id: COUNTY_LINE,
            type: "line",
            source: COUNTY_SOURCE,
            paint: {
              "line-color": CONTEXT_COLORS.county,
              "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.6, 9, 1.2, 14, 1.8],
              "line-dasharray": [2, 1.4],
              "line-opacity": ["interpolate", ["linear"], ["zoom"], 4.5, 0, 6, 0.95],
            },
          },
          before,
        );
      }
      if (!map.getLayer(COUNTY_NAME)) {
        map.addLayer(
          {
            id: COUNTY_NAME,
            type: "symbol",
            source: COUNTY_SOURCE,
            minzoom: 6.5,
            layout: {
              "text-font": ["Noto Sans Regular"],
              "text-field": ["get", "NAME"],
              "text-size": ["interpolate", ["linear"], ["zoom"], 6.5, 9.5, 12, 11.5],
              "text-letter-spacing": 0.12,
              "text-transform": "uppercase",
              "text-max-width": 8,
              "text-padding": 10,
            },
            paint: {
              "text-color": CONTEXT_COLORS.countyLabel,
              "text-halo-color": "#ffffff",
              "text-halo-width": 1.4,
              "text-halo-blur": 0.4,
              "text-opacity": 0.85,
            },
          },
          before,
        );
      }
      setCounty(true);
    });
    return () => {
      live = false;
    };
  }, [ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

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
    const data: GeoJSON.FeatureCollection<GeoJSON.LineString> = { type: "FeatureCollection", features };

    const source = map.getSource("links") as maplibregl.GeoJSONSource | undefined;
    if (source) {
      source.setData(data);
    } else {
      map.addSource("links", { type: "geojson", data });
      map.addLayer({
        id: "links",
        type: "line",
        source: "links",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": [
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
          ],
          "line-width": ["interpolate", ["linear"], ["zoom"], 4, 1.2, 8, 1.8],
          "line-opacity": 0.55,
        },
      });
    }

    for (const marker of markers.current) marker.remove();
    markers.current = pins.map((pin) => {
      // The dot is the marker and the court's name hangs under it, so the map says where each pin is
      // without a hover. The name is absolutely positioned, so it never moves the dot off its point.
      const element = document.createElement("div");
      element.dataset.place = pin.key;
      // A fixed box, so the marker's own anchor arithmetic cannot be thrown by the label hanging
      // outside it: the dot's centre is the coordinate, at every zoom.
      element.className = "relative flex h-8 w-8 items-center justify-center";

      const dot = document.createElement("button");
      dot.type = "button";
      dot.dataset.dot = "";
      dot.className =
        "flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border-2 border-background text-[11px] font-semibold text-white shadow-md transition-transform hover:scale-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
      dot.style.backgroundColor = CATEGORY_COLORS[pin.loc.cat];
      dot.textContent = pin.citations.length > 1 ? String(pin.citations.length) : "";
      const names = pin.citations.map((citation) => citation.title || citation.citation || "Authority").join("; ");
      const count = pin.citations.length === 1 ? "1 authority" : `${pin.citations.length} authorities`;
      dot.setAttribute("aria-label", `${count} at ${pin.label}: ${names}`);
      dot.title = `${pin.label}\n${names}`;
      dot.addEventListener("click", (event) => {
        event.stopPropagation();
        onSelect({ key: pin.key, label: pin.label, citations: pin.citations });
      });

      const label = document.createElement("span");
      label.dataset.label = "";
      label.className =
        "pointer-events-none absolute left-1/2 top-full mt-0.5 max-w-[10rem] -translate-x-1/2 truncate rounded bg-background/85 px-1 text-[10px] font-medium leading-tight text-foreground shadow-sm";
      label.textContent = pin.label;

      element.append(dot, label);
      return new maplibregl.Marker({ element, anchor: "center" }).setLngLat(pin.lngLat).addTo(map);
    });

    fit();
  }, [ready, pins, edges, onSelect, fit]);

  // The traversal: the places the tour has already walked, joined in order, inked over the pale links.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
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
    const data: GeoJSON.FeatureCollection<GeoJSON.LineString> = { type: "FeatureCollection", features };

    const source = map.getSource(TRAIL) as maplibregl.GeoJSONSource | undefined;
    if (source) {
      source.setData(data);
    } else {
      map.addSource(TRAIL, { type: "geojson", data });
      addArrow(map, CONTEXT_COLORS.trail);
      // A white casing under the ink, so the walked path stays legible over county lines and names.
      map.addLayer({
        id: `${TRAIL}-casing`,
        type: "line",
        source: TRAIL,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#ffffff", "line-width": 6, "line-opacity": 0.85 },
      });
      map.addLayer({
        id: TRAIL,
        type: "line",
        source: TRAIL,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": CONTEXT_COLORS.trail, "line-width": 2.6 },
      });
      map.addLayer({
        id: `${TRAIL}-arrow`,
        type: "symbol",
        source: TRAIL,
        layout: {
          "symbol-placement": "line",
          "symbol-spacing": 48,
          "icon-image": ARROW,
          "icon-size": 0.7,
          "icon-rotation-alignment": "map",
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
        },
      });
    }
    // While the walk is running the untouched links step back, so the traversal is the thing you see.
    if (map.getLayer("links")) {
      map.setPaintProperty("links", "line-opacity", features.length ? 0.15 : 0.55);
    }
  }, [ready, trail, pins]);

  // At the scale of a state the pins are close enough that their names would pile up, so the names
  // arrive once the camera is close enough for them to mean something.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const apply = () => {
      const show = map.getZoom() >= 5.5;
      for (const marker of markers.current) {
        const label = marker.getElement().querySelector<HTMLElement>("[data-label]");
        label?.classList.toggle("hidden", !show);
      }
    };
    apply();
    map.on("zoom", apply);
    return () => {
      map.off("zoom", apply);
    };
  }, [ready, pins]);

  // The tour marks the place it is speaking about, so the pin and the voice agree.
  useEffect(() => {
    for (const marker of markers.current) {
      const element = marker.getElement();
      const dot = element.querySelector<HTMLElement>("[data-dot]");
      if (!dot) continue;
      const marked = focus !== null && element.dataset.place === focus;
      dot.classList.toggle("scale-125", marked);
      dot.classList.toggle("ring-2", marked);
      dot.classList.toggle("ring-foreground", marked);
      dot.classList.toggle("ring-offset-2", marked);
      dot.classList.toggle("ring-offset-background", marked);
    }
  }, [focus, ready, pins]);

  // The camera follows the tour to the place it is speaking about; with no place, every pin stays in view.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const pin = focus === null ? undefined : pins.find((candidate) => candidate.key === focus);
    if (!pin) return;
    // The walk zooms to the county scale as it travels: at that zoom the county lines and their names
    // are on the page, so the voice saying "Boulder County" is answered by the map. It never zooms out
    // to reach it, so a reader who has already gone in close is not pulled back.
    map.easeTo({
      center: pin.lngLat,
      zoom: Math.max(map.getZoom(), 9.2),
      duration: reducedMotion() ? 0 : 1200,
    });
  }, [focus, ready, pins]);

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
      <div ref={container} className="absolute inset-0" />
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
