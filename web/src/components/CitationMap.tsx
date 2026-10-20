// The map: MapLibre GL JS over CARTO's raster tiles, with one pin per place an answer's authorities sit
// in and one line per link between them. The tiles are keyless; if they cannot be reached the map falls
// back to OpenStreetMap's own raster tiles rather than showing nothing. The pins are DOM markers, so
// they stay readable and clickable whatever the tiles do.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { LocateFixed } from "lucide-react";
import { Button } from "@/components/ui/button";
import { arcType, locate, type Citation, type Edge, type Location } from "@/lib/citations";
import { ARC_COLORS, ARC_LABELS, CATEGORY_COLORS, CATEGORY_LABELS } from "@/map/palette";
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
 * The basemap: CARTO's Voyager raster tiles. They ask for no account and no key, they carry their own
 * labels, and their warm paper tone sits under the pins instead of competing with them. Retina screens
 * get the @2x images, which is what keeps the type crisp rather than furry.
 *
 * The page has one theme — the light one — so the map does not chase the system's. CARTO publishes
 * `dark_all` as Voyager's twin for the day the app grows a dark theme.
 */
const RETINA = typeof window !== "undefined" && (window.devicePixelRatio || 1) > 1.25;

const CARTO: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    carto: {
      type: "raster",
      tiles: [`https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}${RETINA ? "@2x" : ""}.png`],
      tileSize: 256,
      maxzoom: 19,
      attribution:
        '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors ' +
        '© <a href="https://carto.com/attributions">CARTO</a>',
    },
  },
  layers: [
    // Painted under the tiles so the pane is the basemap's colour while they arrive, not white.
    { id: "ground", type: "background", paint: { "background-color": "#f7f5f2" } },
    { id: "carto", type: "raster", source: "carto", paint: { "raster-fade-duration": 150 } },
  ],
};

/** The fallback: OpenStreetMap's own raster tiles, styled inline, also with no account and no key. */
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
  layers: [{ id: "osm", type: "raster", source: "osm" }],
};

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
        style: CARTO,
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

    // Tiles that never arrive would leave an empty pane, so the map falls back to OpenStreetMap's own.
    let fellBack = false;
    const fallBack = () => {
      if (fellBack) return;
      fellBack = true;
      map.setStyle(RASTER);
    };

    const onStyleLoad = () => {
      setReady(true);
      setEpoch((count) => count + 1);
    };
    map.on("style.load", onStyleLoad);
    // One refused tile is a blip; a run of them means the tile host is not answering this page at all.
    let refused = 0;
    const onError = (event: { error?: { message?: string }; sourceId?: string }) => {
      if (event?.sourceId !== "carto" && !/cartocdn/i.test(String(event?.error?.message || ""))) return;
      refused += 1;
      if (refused >= 3) fallBack();
    };
    map.on("error", onError);

    return () => {
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
      const element = document.createElement("button");
      element.type = "button";
      element.className =
        "flex h-7 w-7 items-center justify-center rounded-full border-2 border-background text-[11px] font-semibold text-white shadow-md transition-transform hover:scale-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
      element.dataset.place = pin.key;
      element.style.backgroundColor = CATEGORY_COLORS[pin.loc.cat];
      element.textContent = pin.citations.length > 1 ? String(pin.citations.length) : "";
      const names = pin.citations.map((citation) => citation.title || citation.citation || "Authority").join("; ");
      const count = pin.citations.length === 1 ? "1 authority" : `${pin.citations.length} authorities`;
      element.setAttribute("aria-label", `${count} at ${pin.label}: ${names}`);
      element.title = `${pin.label}\n${names}`;
      element.addEventListener("click", (event) => {
        event.stopPropagation();
        onSelect({ key: pin.key, label: pin.label, citations: pin.citations });
      });
      return new maplibregl.Marker({ element, anchor: "center" }).setLngLat(pin.lngLat).addTo(map);
    });

    fit();
  }, [ready, epoch, pins, edges, onSelect, fit]);

  // The tour marks the place it is speaking about, so the pin and the voice agree.
  useEffect(() => {
    for (const marker of markers.current) {
      const element = marker.getElement();
      const marked = focus !== null && element.dataset.place === focus;
      element.classList.toggle("scale-125", marked);
      element.classList.toggle("ring-2", marked);
      element.classList.toggle("ring-foreground", marked);
      element.classList.toggle("ring-offset-2", marked);
      element.classList.toggle("ring-offset-background", marked);
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
