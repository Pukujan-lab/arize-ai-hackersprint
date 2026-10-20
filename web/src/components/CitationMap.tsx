// The map: MapLibre GL JS over OpenFreeMap's Positron vector tiles, with one pin per place an answer's
// authorities sit in and one line per link between them. The country, the state, the counties and the
// historic landmarks under those pins come from the same tiles, so the map shows where in the country
// and the county a court is, not just a dot. The style is keyless; if it cannot be reached the map
// falls back to OpenStreetMap's own raster tiles rather than showing nothing. The pins are DOM markers,
// so they stay readable and clickable whatever the tiles do.

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

const CENTER: [number, number] = [-98.583, 39.833];

/**
 * The basemap: OpenFreeMap's Positron vector style. It is open source and self-hostable, it asks for no
 * account, no key and no quota, and Positron's muted greys leave the coloured pins as the only thing
 * competing for attention. Vector labels stay sharp at every zoom, which raster tiles do not.
 *
 * Raster providers were tried and dropped: the keyless-looking ones either want an API key from some
 * networks or licence themselves for non-commercial use only.
 */
const VECTOR = "https://tiles.openfreemap.org/styles/positron";

/**
 * The fallback: OpenStreetMap's own raster tiles, styled inline, also with no account and no key. It is
 * plainer than Positron, but a plainer map beats an empty pane.
 */
const RASTER: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      maxzoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    },
  },
  layers: [
    // Painted under the tiles so the pane is paper-coloured while they arrive, not white.
    { id: "ground", type: "background", paint: { "background-color": "#f7f5f2" } },
    { id: "osm", type: "raster", source: "osm" },
  ],
};

/**
 * The historic landmarks worth naming: the things that make an area a place rather than a parcel —
 * monuments, memorials, battlefields, forts, ruins, archaeological sites. The tiles carry them, so no
 * extra data source is needed.
 */
const HISTORIC: maplibregl.FilterSpecification = [
  "any",
  ["==", ["get", "class"], "historic"],
  [
    "in",
    ["get", "subclass"],
    [
      "literal",
      [
        "monument",
        "memorial",
        "castle",
        "ruins",
        "archaeological_site",
        "battlefield",
        "fort",
        "city_gate",
        "wayside_cross",
        "wayside_shrine",
      ],
    ],
  ],
];

/**
 * The counties. The basemap's tiles stop at state level — they carry country and state borders but no
 * county of any state — so the county lines and the county names come from the Census's own boundaries,
 * which are public domain, keyless, and served over a CDN. The layer filters to Colorado, so one
 * download serves every zoom and the map is still Colorado's map.
 */
const COUNTY_DATA = "https://cdn.jsdelivr.net/gh/plotly/datasets@master/geojson-counties-fips.json";
const COUNTY_SOURCE = "co-counties";

/**
 * Where the context layers go: the style's vector source, the font its glyph server already has, and
 * the layer to sit under. All three are read from the style rather than assumed, so a different style
 * (or the raster fallback) cannot point them at something that is not there.
 */
function contextBase(map: maplibregl.Map): { vector: string | null; font?: string[]; before?: string } {
  const style = map.getStyle();
  const sources = (style.sources || {}) as Record<string, { type?: string }>;
  const vector = Object.keys(sources).find((id) => sources[id]?.type === "vector") ?? null;

  const layers = (style.layers || []) as {
    id: string;
    type: string;
    layout?: Record<string, unknown>;
  }[];
  // Boundaries belong under the basemap's own names, and the names of counties and neighbourhoods
  // belong with them, so both are inserted beneath the first label the style draws.
  const before = layers.find((layer) => layer.type === "symbol")?.id;
  // Whatever font the style already uses is the only one its glyph server is guaranteed to have.
  const font = layers.find((layer) => layer.type === "symbol" && layer.layout?.["text-font"])?.layout?.[
    "text-font"
  ] as string[] | undefined;
  return { vector, font, before };
}

/** The type for a county name: small caps, wide spacing, the way an atlas sets a county. */
const countyNameLayout = (font?: string[]): maplibregl.SymbolLayerSpecification["layout"] => ({
  ...(font ? { "text-font": font } : {}),
  "text-field": ["coalesce", ["get", "NAME"], ["get", "name"]],
  "text-size": ["interpolate", ["linear"], ["zoom"], 6, 10, 12, 12.5],
  "text-letter-spacing": 0.1,
  "text-transform": "uppercase",
  "text-max-width": 8,
  "text-padding": 8,
});

const countyNamePaint: maplibregl.SymbolLayerSpecification["paint"] = {
  "text-color": CONTEXT_COLORS.countyLabel,
  "text-halo-color": "#ffffff",
  "text-halo-width": 1.5,
  "text-halo-blur": 0.4,
};

/**
 * The ground under the pins: the country and state outlines, the counties, the neighbourhood names and
 * the historic landmarks, so the map says where in the country, the state and the county a court sits
 * rather than showing a dot in a void.
 *
 * The outlines, the neighbourhood names and the landmarks come from the basemap's own source-layers,
 * which the style ships but paints almost none of; the counties come from their own file, because the
 * tiles have none. Every tile-derived layer is optional by construction — a style without that
 * source-layer simply draws nothing — and the function reports whether it found vector tiles at all.
 */
function addContextLayers(map: maplibregl.Map): boolean {
  const base = contextBase(map);
  const { vector, before } = base;

  const add = (layer: maplibregl.LayerSpecification) => {
    if (map.getLayer(layer.id)) return;
    try {
      map.addLayer(layer, before);
    } catch {
      // A style without this source-layer draws nothing; that is not a reason to lose the map.
    }
  };

  // The counties are added whatever the style is, because they come from their own source rather than
  // from the tiles. They are what makes the map answer "which county" at a glance.
  try {
    if (!map.getSource(COUNTY_SOURCE)) map.addSource(COUNTY_SOURCE, { type: "geojson", data: COUNTY_DATA });
  } catch {
    // No county file: the state outline below still stands.
  }

  add({
    id: "co-county-line",
    type: "line",
    source: COUNTY_SOURCE,
    filter: ["==", ["get", "STATE"], "08"],
    paint: {
      "line-color": CONTEXT_COLORS.county,
      "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.6, 9, 1.2, 14, 1.8],
      "line-dasharray": [2, 1.4],
      "line-opacity": ["interpolate", ["linear"], ["zoom"], 4, 0, 5.5, 0.95],
    },
  });

  // Text needs the style's glyph server; the raster fallback has none, so it gets the lines only.
  if (map.getStyle().glyphs) {
    add({
      id: "co-county-name",
      type: "symbol",
      source: COUNTY_SOURCE,
      filter: ["==", ["get", "STATE"], "08"],
      minzoom: 5.5,
      layout: countyNameLayout(base.font),
      paint: countyNamePaint,
    });
  }

  if (!vector) return Boolean(map.getSource(COUNTY_SOURCE));

  add({
    id: "ctx-country",
    type: "line",
    source: vector,
    "source-layer": "boundary",
    filter: ["all", ["<=", ["get", "admin_level"], 4], ["!=", ["get", "maritime"], 1]],
    paint: {
      "line-color": CONTEXT_COLORS.state,
      "line-width": ["interpolate", ["linear"], ["zoom"], 2, 0.7, 6, 1.3, 11, 2],
      "line-opacity": 0.9,
    },
  });

  add({
    id: "ctx-area-name",
    type: "symbol",
    source: vector,
    "source-layer": "place",
    filter: ["in", ["get", "class"], ["literal", ["suburb", "quarter", "neighbourhood"]]],
    minzoom: 11,
    layout: {
      ...(base.font ? { "text-font": base.font } : {}),
      "text-field": ["coalesce", ["get", "name:en"], ["get", "name"]],
      "text-size": ["interpolate", ["linear"], ["zoom"], 11, 9.5, 15, 11.5],
      "text-letter-spacing": 0.14,
      "text-transform": "uppercase",
      "text-max-width": 8,
      "text-padding": 6,
    },
    paint: {
      "text-color": CONTEXT_COLORS.areaLabel,
      "text-halo-color": "#ffffff",
      "text-halo-width": 1.2,
      "text-opacity": 0.95,
    },
  });

  add({
    id: "ctx-historic-dot",
    type: "circle",
    source: vector,
    "source-layer": "poi",
    filter: HISTORIC,
    minzoom: 7,
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 7, 1.4, 11, 2.4, 14, 3.2],
      "circle-color": CONTEXT_COLORS.historic,
      "circle-opacity": 0.9,
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 0.8,
    },
  });

  add({
    id: "ctx-historic-name",
    type: "symbol",
    source: vector,
    "source-layer": "poi",
    filter: HISTORIC,
    minzoom: 11,
    layout: {
      ...(base.font ? { "text-font": base.font } : {}),
      "text-field": ["coalesce", ["get", "name:en"], ["get", "name"]],
      "text-size": 10,
      "text-anchor": "top",
      "text-offset": [0, 0.7],
      "text-max-width": 7,
      "text-padding": 4,
    },
    paint: {
      "text-color": CONTEXT_COLORS.historicLabel,
      "text-halo-color": "#ffffff",
      "text-halo-width": 1.3,
    },
  });

  return true;
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
  onSelect,
  className,
}: {
  citations?: Citation[];
  edges?: Edge[];
  /** The place the tour is on, so the camera follows the voice. Null fits every authority. */
  focus?: string | null;
  onSelect: (place: MapPlace) => void;
  className?: string;
}) {
  const container = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markers = useRef<maplibregl.Marker[]>([]);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  /** Whether the basemap's vector tiles are there, so the legend only names what is actually drawn. */
  const [context, setContext] = useState(false);
  /** Bumped when a style finishes loading, because a new style drops the links layer along with it. */
  const [epoch, setEpoch] = useState(0);

  const pins = useMemo(() => buildPins(citations), [citations]);

  const fit = useCallback(() => {
    const map = mapRef.current;
    if (!map || !pins.length) return;
    const duration = reducedMotion() ? 0 : 700;
    if (pins.length === 1) {
      map.easeTo({ center: pins[0].lngLat, zoom: 6.5, duration });
      return;
    }
    const bounds = new maplibregl.LngLatBounds();
    for (const pin of pins) bounds.extend(pin.lngLat);
    map.fitBounds(bounds, { padding: 72, maxZoom: 9, duration });
  }, [pins]);

  // The map is created once; everything after this only updates its data.
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: element,
        style: VECTOR,
        center: CENTER,
        zoom: 3.4,
        attributionControl: { compact: true },
      });
    } catch {
      setFailed(true);
      return;
    }
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new maplibregl.ScaleControl({ unit: "imperial", maxWidth: 96 }), "bottom-left");

    // A style document that never arrives would leave an empty pane, so the map falls back to the
    // OpenStreetMap tiles, which need nothing from the network but the tiles themselves.
    let fellBack = false;
    const fallBack = () => {
      if (fellBack) return;
      fellBack = true;
      map.setStyle(RASTER);
    };
    const giveUp = window.setTimeout(() => {
      if (!map.isStyleLoaded()) fallBack();
    }, 6000);

    const onStyleLoad = () => {
      window.clearTimeout(giveUp);
      // A new style drops every layer added to the old one, so the country, the counties and their
      // names are put back here rather than once at startup.
      setContext(addContextLayers(map));
      setReady(true);
      setEpoch((count) => count + 1);
    };
    map.on("style.load", onStyleLoad);
    // A tile that 404s is not a failed basemap; only a style document that cannot be fetched is.
    const onError = (event: { error?: { message?: string } }) => {
      if (/style/i.test(String(event?.error?.message || ""))) fallBack();
    };
    map.on("error", onError);

    return () => {
      window.clearTimeout(giveUp);
      map.off("style.load", onStyleLoad);
      map.off("error", onError);
      for (const marker of markers.current) marker.remove();
      markers.current = [];
      map.remove();
      mapRef.current = null;
    };
  }, []);

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
        geometry: { type: "LineString", coordinates: [from.lngLat, to.lngLat] },
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
        layout: { "line-cap": "round" },
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
          "line-width": 1.6,
          "line-opacity": 0.6,
        },
      });
    }

    for (const marker of markers.current) marker.remove();
    markers.current = pins.map((pin) => {
      // The dot is the marker and the court's name hangs under it, so the map says where each pin is
      // without a hover. The name is absolutely positioned, so it never moves the dot off its point.
      const element = document.createElement("div");
      element.dataset.place = pin.key;
      element.className = "relative flex items-center justify-center";

      const dot = document.createElement("button");
      dot.type = "button";
      dot.dataset.dot = "";
      dot.className =
        "flex h-7 w-7 items-center justify-center rounded-full border-2 border-background text-[11px] font-semibold text-white shadow-md transition-transform hover:scale-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
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
  }, [ready, epoch, pins, edges, onSelect, fit]);

  // At the scale of a state the pins are close enough that their names would pile up, so the names
  // arrive once the camera is close enough for them to mean something.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const apply = () => {
      const show = map.getZoom() >= 4.5;
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
  }, [ready, epoch, pins]);

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
    map.easeTo({
      center: pin.lngLat,
      zoom: Math.max(map.getZoom(), 7.5),
      duration: reducedMotion() ? 0 : 900,
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
        {context && (
          <ul className="flex flex-wrap gap-x-3 gap-y-1 border-t border-border pt-1">
            <li className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="w-3 shrink-0 border-t border-dashed"
                style={{ borderColor: CONTEXT_COLORS.county }}
              />
              County boundary
            </li>
            <li className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: CONTEXT_COLORS.historic }}
              />
              Historic site
            </li>
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
