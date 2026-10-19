import { useEffect, useMemo, useState } from "react";

type Point = { name: string; x: number; y: number };
type Shapes = { states: string[]; counties: Point[] };

let cached: Shapes | null = null;
let pending: Promise<Shapes | null> | null = null;

function ringPath(rings: unknown): string {
  if (!Array.isArray(rings)) return "";
  return rings
    .map((ring) => {
      if (!Array.isArray(ring)) return "";
      const points = ring
        .filter((point): point is [number, number] => Array.isArray(point) && point.length >= 2)
        .map(([x, y], index) => `${index ? "L" : "M"}${Number(x).toFixed(1)} ${Number(y).toFixed(1)}`);
      return points.length > 2 ? `${points.join(" ")} Z` : "";
    })
    .filter(Boolean)
    .join(" ");
}

/**
 * The same projected geometry the map draws, fetched once and drawn as outlines. It is the current
 * product's data, not a screenshot of it.
 */
async function loadShapes(): Promise<Shapes | null> {
  if (cached) return cached;
  if (!pending) {
    pending = (async () => {
      try {
        const [statesRaw, countiesRaw] = await Promise.all([
          fetch("/vendor/us_states_proj.json").then((response) => response.json()),
          fetch("/vendor/co_counties_proj.json").then((response) => response.json()),
        ]);
        const states = (Array.isArray(statesRaw) ? statesRaw : [])
          .map((state) => ringPath((state as { polys?: unknown }).polys))
          .filter(Boolean);
        const counties = (Array.isArray(countiesRaw) ? countiesRaw : [])
          .map((county) => {
            const record = county as { name?: unknown; c?: unknown };
            const centre = Array.isArray(record.c) ? record.c : [];
            return { name: String(record.name ?? ""), x: Number(centre[0]), y: Number(centre[1]) };
          })
          .filter((county) => county.name && Number.isFinite(county.x) && Number.isFinite(county.y));
        cached = { states, counties };
        return cached;
      } catch {
        return null;
      }
    })();
  }
  return pending;
}

const NAMED = ["Denver", "Boulder", "El Paso", "La Plata", "Mesa", "Weld", "Pueblo"];

const stroke = "hsl(var(--border))";
const land = "hsl(var(--muted))";
const mark = "hsl(var(--primary))";

/** The deck's map view: the state outlines, seven Colorado county seats, and the links between them. */
export default function DeckMap({ className }: { className?: string }) {
  const [shapes, setShapes] = useState<Shapes | null>(cached);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    loadShapes().then((loaded) => {
      if (!live) return;
      if (loaded) setShapes(loaded);
      else setFailed(true);
    });
    return () => {
      live = false;
    };
  }, []);

  const pins = useMemo(() => {
    if (!shapes) return [];
    return NAMED.map((name) => shapes.counties.find((county) => county.name === name)).filter(
      (county): county is Point => !!county,
    );
  }, [shapes]);

  return (
    <div className={className}>
      <svg
        viewBox="0 0 975 610"
        role="img"
        aria-label="The United States, with seven Colorado counties pinned and the authorities they hold linked"
        className="block w-full"
      >
        <rect x="0" y="0" width="975" height="610" rx="8" style={{ fill: "hsl(var(--background))" }} />
        {shapes?.states.map((path, index) => (
          <path key={index} d={path} style={{ fill: land, stroke }} strokeWidth={1} strokeLinejoin="round" />
        ))}
        {pins.slice(1).map((pin, index) => {
          const from = pins[index];
          const midX = (from.x + pin.x) / 2;
          const midY = Math.min(from.y, pin.y) - 26;
          return (
            <path
              key={`link-${pin.name}`}
              d={`M${from.x.toFixed(1)} ${from.y.toFixed(1)} Q ${midX.toFixed(1)} ${midY.toFixed(1)} ${pin.x.toFixed(1)} ${pin.y.toFixed(1)}`}
              fill="none"
              style={{ stroke: mark }}
              strokeWidth={1.2}
              strokeDasharray="4 3"
              opacity={0.55}
            />
          );
        })}
        {pins.map((pin) => (
          <g key={pin.name}>
            <circle cx={pin.x} cy={pin.y} r={8} style={{ fill: mark }} opacity={0.2} />
            <circle cx={pin.x} cy={pin.y} r={3.4} style={{ fill: mark }} />
            <text
              x={pin.x + 10}
              y={pin.y + 4}
              style={{ fill: "hsl(var(--foreground))", fontSize: 13 }}
              fontWeight={600}
            >
              {pin.name}
            </text>
          </g>
        ))}
        {!shapes && (
          <text x="487" y="305" textAnchor="middle" style={{ fill: "hsl(var(--muted-foreground))", fontSize: 16 }}>
            {failed ? "The map geometry could not be read." : "Reading the map…"}
          </text>
        )}
      </svg>
    </div>
  );
}
