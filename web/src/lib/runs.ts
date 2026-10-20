// Shapes and parsers for the run data the server already returns.
//
// `/api/runs` lists the saved runs this device asked for and `/api/run/<id>` carries the events and
// the result of one run. Nothing here invents a value: a field the server did not send stays null so
// the page can say so instead of showing 0.

export type SavedRun = { run_id: string; question: string; n: number | null; ts: string };

/** One retrieval stage: what ran, how long it took, and why it did not run when it did not. */
export type RetrievalStage = { name: string; durationMs: number | null; skipped: boolean; reason: string };

/** The path a run's retrieval actually took, as the run recorded it. */
export type Retrieval = {
  source: string;
  stages: RetrievalStage[];
  graphSource: string;
  graphRevision: string;
  engineOk: boolean | null;
  engineReason: string;
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** A finite number from the API, or null. Keeps NaN out of the page. */
export function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function seconds(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(1)}s`;
}

export function whenLabel(iso: string): string {
  if (!iso) return "time not recorded";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

export function toRuns(raw: unknown): SavedRun[] {
  if (!Array.isArray(raw)) return [];
  const out: SavedRun[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const runId = text(item.run_id);
    if (!runId) continue;
    out.push({
      run_id: runId,
      question: text(item.question) || `Run ${runId}`,
      n: num(item.n),
      ts: text(item.ts),
    });
  }
  return out;
}

/** The stages a run recorded, in the order the engine emitted them. A missing duration stays null. */
export function toStages(raw: unknown): RetrievalStage[] {
  if (!Array.isArray(raw)) return [];
  const out: RetrievalStage[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const name = text(item.name) || text(item.stage);
    if (!name) continue;
    out.push({ name, durationMs: num(item.duration_ms), skipped: item.skipped === true, reason: text(item.reason) });
  }
  return out;
}

export function toRetrieval(raw: unknown): Retrieval | null {
  if (!isRecord(raw)) return null;
  const graph = isRecord(raw.graph) ? raw.graph : {};
  const engineBlock = isRecord(raw.engine) ? raw.engine : {};
  return {
    source: text(raw.source),
    stages: toStages(raw.stages),
    graphSource: text(graph.source),
    graphRevision: text(graph.revision),
    engineOk: typeof engineBlock.ok === "boolean" ? engineBlock.ok : null,
    engineReason: text(engineBlock.reason),
  };
}

/** The start of the reader's day, so "today" means the calendar day the reader is in. */
export function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Whether a saved run's timestamp falls on the reader's today. */
export function isToday(iso: string): boolean {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return false;
  return sameDay(date, new Date());
}

/** Whether a saved run's timestamp is inside the last seven days, today included. */
export function withinDays(iso: string, days: number): boolean {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return false;
  const first = startOfDay(new Date());
  first.setDate(first.getDate() - (days - 1));
  return date.getTime() >= first.getTime();
}

/** Read one of the app's own JSON routes; a non-2xx answer is a rejection, never a half-parsed body. */
export async function readJson(path: string): Promise<unknown> {
  const response = await fetch(path, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(String(response.status));
  return response.json();
}
