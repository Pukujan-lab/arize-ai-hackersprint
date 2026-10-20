// The map, full-bleed: a saved run's authorities in three dimensions, with the camera the reader can
// tilt and turn, the layers they can switch off one at a time, and the walk that reads the memo aloud.

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  FlaskConical,
  Layers,
  ListTree,
  MapPin,
  MessagesSquare,
  RotateCcw,
  Volume2,
  VolumeX,
} from "lucide-react";
import AuthorityDetail from "@/components/AuthorityDetail";
import DetailDrawer from "@/components/DetailDrawer";
import MapCanvas from "@/components/MapCanvas";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { loadRunResult, loadRuns, pipelineDone, type Source } from "@/lib/api";
import { citeType, locate, type Citation, type RunResult } from "@/lib/citations";
import { DEMO_RESULT } from "@/lib/demo";
import { MapEngine, TILT_RANGE, type MapLayers, type MapView } from "@/map/engine";
import { cn } from "@/lib/utils";

const LAYER_ROWS: { key: keyof MapLayers; label: string; hint: string }[] = [
  { key: "basemap", label: "Basemap", hint: "The dark basemap under the shapes (Esri, HERE, Garmin, © OpenStreetMap)" },
  { key: "heat", label: "County heat", hint: "Counties coloured by how many authorities sit in them" },
  { key: "links", label: "Citation links", hint: "The links between the authorities this run cites" },
  { key: "pins", label: "Pins", hint: "One pin per court, standing above its place" },
  { key: "labels", label: "Labels", hint: "The names of the places and courts in view" },
];

export default function Explore() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const engineRef = useRef<MapEngine | null>(null);
  if (!engineRef.current) engineRef.current = new MapEngine();
  const engine = engineRef.current;

  const [view, setView] = useState<MapView>(() => engine.view());
  const [result, setResult] = useState<RunResult | null>(null);
  const [source, setSource] = useState<Source>("sample");
  const [layersOpen, setLayersOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [authority, setAuthority] = useState<Citation | null>(null);
  const runParam = (params.get("run") || "").trim();

  useEffect(() => {
    engine.onChange = () => setView(engine.view());
    return () => {
      engine.onChange = () => {};
      engine.detach();
    };
  }, [engine]);

  // The run named in the address, else the newest saved run, else the sample corpus.
  useEffect(() => {
    let alive = true;
    const read = async () => {
      let id = runParam;
      if (!id) {
        const { runs } = await loadRuns();
        id = runs[0]?.run_id || "";
      }
      if (!id) {
        if (!alive) return;
        setResult(DEMO_RESULT);
        setSource("sample");
        return;
      }
      const loaded = await loadRunResult(id);
      if (!alive || !loaded.result) return;
      setResult(loaded.result);
      setSource(loaded.source);
    };
    void read();
    return () => {
      alive = false;
    };
  }, [runParam]);

  // A run that has loaded is drawn: its authorities, its links, and a finished pipeline.
  useEffect(() => {
    if (!result) return;
    engine.setCites(result.citations || [], result.edges || [], {
      question: result.question,
      answer: result.answer,
    });
    engine.setPipeline(pipelineDone(), false);
    setView(engine.view());
  }, [engine, result]);

  const citations = useMemo<Citation[]>(() => result?.citations || [], [result]);
  const places = useMemo(() => new Set(citations.map((c) => locate(c).label)).size, [citations]);

  const openAuthority = (index: number) => {
    const chosen = citations[index];
    if (!chosen) return;
    engine.openAuthority(index);
    setListOpen(false);
    setAuthority(chosen);
  };

  const listen = () => {
    if (view.narrating) engine.stopListening();
    else engine.listen();
  };

  const askAboutPlace = () => {
    const where = view.label || "Colorado";
    navigate(`/chat?q=${encodeURIComponent(`What authority applies at ${where}?`)}`);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h2 className="truncate text-sm font-medium">{result?.question || "The citation map"}</h2>
            {source === "sample" && (
              <Badge variant="secondary" className="shrink-0 gap-1 px-1.5 py-0 text-[10px]">
                <FlaskConical className="h-3 w-3" />
                Sample
              </Badge>
            )}
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {citations.length} {citations.length === 1 ? "authority" : "authorities"} · {places}{" "}
            {places === 1 ? "place" : "places"} · {view.tour.count} {view.tour.count === 1 ? "stop" : "stops"}
            {runParam ? ` · ${runParam}` : ""}
          </p>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setListOpen(true)}>
          <ListTree className="h-4 w-4" />
          Authorities ({citations.length})
        </Button>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setLayersOpen(true)}>
          <Layers className="h-4 w-4" />
          Layers
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={listen}
          disabled={!citations.length}
          aria-pressed={view.narrating}
        >
          {view.narrating ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          {view.narrating ? "Stop" : "Listen"}
        </Button>
        <Button variant="secondary" size="sm" className="gap-1.5" onClick={askAboutPlace}>
          <MessagesSquare className="h-4 w-4" />
          Ask about this place
        </Button>
      </div>

      <div className="relative min-h-0 flex-1">
        <MapCanvas
          engine={engine}
          view={view}
          source={result?.provider || (source === "sample" ? "Sample corpus" : "Backend")}
          onSelectAuthority={(index) => {
            const chosen = citations[index];
            if (chosen) setAuthority(chosen);
          }}
          onOpenLayers={() => setLayersOpen(true)}
        />
      </div>

      <DetailDrawer
        open={layersOpen}
        onOpenChange={setLayersOpen}
        title="Layers and camera"
        description="What the scene draws, and where the camera stands"
        footer={
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              {Math.round(view.orbit.tilt)}° tilt · {Math.round(view.orbit.yaw)}° bearing
            </span>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => engine.resetOrbit()}
              disabled={Math.round(view.orbit.tilt) === 58 && Math.round(view.orbit.yaw) === 0}
            >
              <RotateCcw className="h-4 w-4" />
              Reset angle
            </Button>
          </div>
        }
      >
        <div className="space-y-5">
          <ul className="space-y-2.5">
            {LAYER_ROWS.map((row) => (
              <li key={row.key} className="flex items-start gap-3">
                <Switch
                  id={`layer-${row.key}`}
                  checked={view.layers[row.key]}
                  onCheckedChange={(checked) => engine.setLayers({ [row.key]: checked } as Partial<MapLayers>)}
                  className="mt-0.5"
                />
                <div className="min-w-0">
                  <Label htmlFor={`layer-${row.key}`} className="text-sm font-medium">
                    {row.label}
                  </Label>
                  <p className="text-xs leading-snug text-muted-foreground">{row.hint}</p>
                </div>
              </li>
            ))}
          </ul>

          <div className="space-y-4 border-t border-border pt-4">
            <div>
              <div className="flex items-baseline justify-between">
                <Label htmlFor="tilt" className="text-sm font-medium">
                  Tilt
                </Label>
                <span className="text-xs tabular-nums text-muted-foreground">{Math.round(view.orbit.tilt)}°</span>
              </div>
              <Slider
                id="tilt"
                className="mt-2"
                min={TILT_RANGE.min}
                max={TILT_RANGE.max}
                step={1}
                value={[Math.round(view.orbit.tilt)]}
                onValueChange={([value]) => engine.setOrbit({ tilt: value })}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                {TILT_RANGE.min}° looks almost straight down; {TILT_RANGE.max}° puts the horizon in view.
              </p>
            </div>
            <div>
              <div className="flex items-baseline justify-between">
                <Label htmlFor="bearing" className="text-sm font-medium">
                  Bearing
                </Label>
                <span className="text-xs tabular-nums text-muted-foreground">{Math.round(view.orbit.yaw)}°</span>
              </div>
              <Slider
                id="bearing"
                className="mt-2"
                min={0}
                max={359}
                step={1}
                value={[Math.round(view.orbit.yaw)]}
                onValueChange={([value]) => engine.setOrbit({ yaw: value })}
              />
              <p className="mt-1 text-xs text-muted-foreground">Which way the camera faces, turned about the point.</p>
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card/60 p-2.5 text-xs leading-relaxed text-muted-foreground">
            <p className="font-medium text-foreground">Map key</p>
            <ul className="mt-1 space-y-1">
              {[
                { colour: "bg-emerald-500", label: "county ↔ county" },
                { colour: "bg-blue-500", label: "county → court" },
                { colour: "bg-amber-500", label: "statute" },
                { colour: "bg-pink-500", label: "federal" },
              ].map((row) => (
                <li key={row.label} className="flex items-center gap-2">
                  <span aria-hidden="true" className={cn("h-0.5 w-4 rounded", row.colour)} />
                  {row.label}
                </li>
              ))}
            </ul>
          </div>

          <p className="text-xs leading-relaxed text-muted-foreground">
            {view.basemapReady
              ? "The basemap is drawn from tiles that are fetched once, then sampled into the projection."
              : "No basemap has been fetched, so the map is drawn from the shapes alone."}
          </p>
        </div>
      </DetailDrawer>

      <DetailDrawer
        open={listOpen}
        onOpenChange={setListOpen}
        title="Authorities on the map"
        description="Every authority this run placed, and the place it was placed at"
      >
        {citations.length ? (
          <ul className="space-y-1.5">
            {citations.map((citation, index) => {
              const place = locate(citation);
              return (
                <li key={`${citation.id}-${index}`}>
                  <button
                    type="button"
                    onClick={() => openAuthority(index)}
                    className="w-full rounded-lg border border-border bg-card px-2.5 py-2 text-left transition-colors hover:bg-accent/60"
                  >
                    <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-medium text-foreground">
                        {citeType(citation)}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{place.label}</span>
                    </span>
                    <span className="mt-1 line-clamp-2 block text-sm font-medium leading-snug">
                      {citation.title || citation.citation || "Authority"}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {[citation.court, citation.date].filter(Boolean).join(" · ") || "Court not recorded"}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">This run placed no authority on the map.</p>
        )}
      </DetailDrawer>

      <DetailDrawer
        open={authority !== null}
        onOpenChange={(open) => {
          if (!open) setAuthority(null);
        }}
        title={authority?.title || authority?.citation || "Authority"}
        description={authority ? citeType(authority) : undefined}
        footer={
          authority ? (
            <Button
              variant="outline"
              size="sm"
              className="w-full gap-2"
              onClick={() => {
                const where = locate(authority).label;
                setAuthority(null);
                navigate(`/chat?q=${encodeURIComponent(`How does this authority apply: ${authority.title || authority.citation || "it"} (${where})?`)}`);
              }}
            >
              <MapPin className="h-4 w-4" />
              Ask about this authority
            </Button>
          ) : undefined
        }
      >
        {authority && <AuthorityDetail citation={authority} />}
      </DetailDrawer>
    </div>
  );
}
