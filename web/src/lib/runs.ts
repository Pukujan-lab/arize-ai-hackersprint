// Shapes and parsers for the run data the server already returns.
//
// `/api/runs` lists the saved runs this device asked for, `/api/run/<id>` carries the events and the
// result of one run, and `/api/stack` reports the figures of the stack itself. Nothing here invents a
// value: a field the server did not send stays null so the page can say "No data yet" instead of 0.

export type SavedRun = { run_id: string; question: string; n: number | null; ts: string };

export type Step = { record: Record<string, unknown>; t: number | null; agent: string; kind: string };

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

export type EngineInfo = {
  configured: boolean | null;
  ok: boolean | null;
  status: string;
  chunkCount: number | null;
  caseCount: number | null;
  corpusRevision: string;
  graphRevision: string;
  lexical: string;
  denseModel: string;
  rerankModel: string;
  jevModel: string;
  scorer: string;
  lastError: string;
};

export type TracingInfo = {
  ok: boolean | null;
  reason: string;
  project: string;
  sent: number | null;
  dropped: number | null;
  queued: number | null;
};

export type RetentionInfo = {
  runsKept: number | null;
  runsOnDisk: number | null;
  traceQueueMax: number | null;
  spansDropped: number | null;
};

/** One judge's verdict on a trace: its label, its score, and what the judge said when it said anything. */
export type Judge = { score: number | null; label: string; explanation: string };

/** The four judges the retired dashboard read from Arize. A judge the snapshot did not carry stays null. */
export type Judges = {
  groundedness: Judge | null;
  hallucination: Judge | null;
  citationRelevance: Judge | null;
  legalSafety: Judge | null;
};

export type TraceSpan = {
  id: string;
  parent: string;
  name: string;
  kind: string;
  startMs: number | null;
  durMs: number | null;
  model: string;
  tokens: number | null;
};

export type Trace = {
  traceId: string;
  runId: string;
  question: string;
  startTime: string;
  latencyMs: number | null;
  model: string;
  tokens: number | null;
  safeguard: boolean | null;
  judges: Judges;
  spans: TraceSpan[];
};

/** The snapshot exported from Arize: a file the server reads, never a call to Arize on the request path. */
export type ArizeSnapshot = {
  generatedAt: string;
  project: string;
  evaluator: string;
  traces: Trace[];
  dataset: { name: string; rows: number | null; columns: string[] } | null;
  experiment: { name: string; examples: number | null; metric: string; bySetting: { name: string; value: number }[] } | null;
};

export type RunDetail = {
  runId: string;
  question: string;
  answer: string;
  elapsed: number | null;
  provider: string;
  pass: boolean | null;
  citations: number | null;
  prevRunId: string | null;
  followUps: string[];
  steps: Step[];
  retrieval: Retrieval | null;
};

export type StackInfo = {
  chain: string[];
  passages: number | null;
  nodes: number | null;
  edges: number | null;
  how: Record<string, string>;
  runs: { run_id: string; elapsed: number | null; provider: string; pass: boolean | null }[];
  engine: EngineInfo | null;
  tracing: TracingInfo | null;
  retention: RetentionInfo | null;
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

/** Any value as readable text; never "undefined", "null" or "NaN". */
export function show(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "—";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value === null || value === undefined) return "—";
  try {
    return JSON.stringify(value) ?? "—";
  } catch {
    return "—";
  }
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

/** A count with thousands separators, or an em dash when the server did not report one. */
export function count(value: number | null): string {
  return value === null ? "—" : Math.round(value).toLocaleString("en-US");
}

export function mean(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

/** The first number written in a string, so "327,407 passages" reads as 327407. */
export function firstNumber(value: string): number | null {
  const match = value.match(/\d[\d,.]*/);
  if (!match) return null;
  const parsed = Number(match[0].replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

/** Whether a provider name means the answer came from the cache. */
export function isCache(provider: string): boolean {
  return /cach/i.test(provider);
}

/**
 * The memo's short answer: what follows a "Short answer:" heading, or the whole answer when the memo
 * carries no heading. Markdown emphasis is dropped so the text reads in a card.
 */
export function shortAnswer(answer: string): string {
  const raw = text(answer);
  if (!raw) return "";
  const headed = raw.match(/\*\*\s*short answer\s*:?\s*\*\*\s*([\s\S]*?)(?:\n\s*\n|\*\*|$)/i);
  const body = headed ? headed[1] : raw;
  return body.replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
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

/** Pipeline steps in the order they happened. A trace that carries epoch seconds is shown relative to its first step. */
export function toSteps(events: Record<string, unknown>[]): Step[] {
  const known = events.map((event) => num(event.t)).filter((t): t is number => t !== null);
  const first = known.length ? Math.min(...known) : 0;
  const shift = first > 1e9 ? first : 0;
  return events.map((record) => {
    const t = num(record.t);
    return {
      record,
      t: t === null ? null : t - shift,
      agent: text(record.agent) || "unattributed step",
      kind: text(record.kind) || "event",
    };
  });
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

function toEngine(raw: unknown): EngineInfo | null {
  if (!isRecord(raw)) return null;
  return {
    configured: typeof raw.configured === "boolean" ? raw.configured : null,
    ok: typeof raw.ok === "boolean" ? raw.ok : null,
    status: text(raw.status),
    chunkCount: num(raw.chunk_count),
    caseCount: num(raw.case_count),
    corpusRevision: text(raw.corpus_revision),
    graphRevision: text(raw.graph_revision),
    lexical: text(raw.lexical),
    denseModel: text(raw.dense_model),
    rerankModel: text(raw.rerank_model),
    jevModel: text(raw.jev_model),
    scorer: text(raw.scorer),
    lastError: text(raw.last_error),
  };
}

function toTracing(raw: unknown): TracingInfo | null {
  if (!isRecord(raw)) return null;
  return {
    ok: typeof raw.ok === "boolean" ? raw.ok : null,
    reason: text(raw.reason),
    project: text(raw.project),
    sent: num(raw.sent),
    dropped: num(raw.dropped),
    queued: num(raw.queued),
  };
}

function toRetention(raw: unknown): RetentionInfo | null {
  if (!isRecord(raw)) return null;
  return {
    runsKept: num(raw.runs_kept),
    runsOnDisk: num(raw.runs_on_disk),
    traceQueueMax: num(raw.trace_queue_max),
    spansDropped: num(raw.spans_dropped),
  };
}

function toJudge(raw: unknown): Judge | null {
  if (!isRecord(raw)) return null;
  const label = text(raw.label);
  const score = num(raw.score);
  if (!label && score === null) return null; // a judge the snapshot did not carry is absent, never 0
  return { score, label, explanation: text(raw.explanation) };
}

function toJudges(raw: unknown): Judges {
  const root = isRecord(raw) ? raw : {};
  return {
    groundedness: toJudge(root.groundedness),
    hallucination: toJudge(root.hallucination),
    citationRelevance: toJudge(root.citation_relevance),
    legalSafety: toJudge(root.legal_safety),
  };
}

function toSpan(raw: unknown): TraceSpan | null {
  if (!isRecord(raw)) return null;
  const name = text(raw.name);
  if (!name) return null;
  return {
    id: text(raw.id),
    parent: text(raw.parent),
    name,
    kind: text(raw.kind),
    startMs: num(raw.start_ms),
    durMs: num(raw.dur_ms),
    model: text(raw.model),
    tokens: num(raw.tokens),
  };
}

/**
 * The Arize snapshot the retired dashboard read. Nothing here is recomputed: a judge the snapshot did
 * not carry is null and a field it did not record stays empty rather than becoming 0 or "".
 */
export function toArize(raw: unknown): ArizeSnapshot | null {
  if (!isRecord(raw)) return null;

  const traces: Trace[] = [];
  if (Array.isArray(raw.traces)) {
    for (const item of raw.traces) {
      if (!isRecord(item)) continue;
      traces.push({
        traceId: text(item.trace_id),
        runId: text(item.run_id),
        question: text(item.question) || "question not recorded",
        startTime: text(item.start_time),
        latencyMs: num(item.latency_ms),
        model: text(item.model),
        tokens: num(item.tokens),
        safeguard: typeof item.safeguard === "boolean" ? item.safeguard : null,
        judges: toJudges(item.evals),
        spans: Array.isArray(item.spans)
          ? item.spans.map(toSpan).filter((span): span is TraceSpan => span !== null)
          : [],
      });
    }
  }

  const datasetRaw = isRecord(raw.dataset) ? raw.dataset : null;
  const datasetName = datasetRaw ? text(datasetRaw.name) : "";
  const datasetRows = datasetRaw ? num(datasetRaw.rows) : null;
  const dataset =
    datasetRaw && (datasetName || datasetRows !== null)
      ? {
          name: datasetName,
          rows: datasetRows,
          columns: Array.isArray(datasetRaw.columns) ? datasetRaw.columns.map(text).filter(Boolean) : [],
        }
      : null;

  const experimentRaw = isRecord(raw.experiment) ? raw.experiment : null;
  const experimentName = experimentRaw ? text(experimentRaw.name) : "";
  const experiment =
    experimentRaw && (experimentName || text(experimentRaw.metric))
      ? {
          name: experimentName,
          examples: num(experimentRaw.examples),
          metric: text(experimentRaw.metric),
          bySetting: isRecord(experimentRaw.by_setting)
            ? Object.entries(experimentRaw.by_setting)
                .map(([name, value]) => ({ name, value: num(value) }))
                .filter((row): row is { name: string; value: number } => row.value !== null)
            : [],
        }
      : null;

  return {
    generatedAt: text(raw.generated_at),
    project: text(raw.project),
    evaluator: text(raw.evaluator),
    traces,
    dataset,
    experiment,
  };
}

export function toDetail(runId: string, raw: unknown): RunDetail {
  const root = isRecord(raw) ? raw : {};
  const result = isRecord(root.result) ? root.result : {};
  const events = Array.isArray(root.events) ? root.events.filter(isRecord) : [];
  const safeguard = isRecord(result.safeguard) ? result.safeguard : null;
  const followUps = Array.isArray(result.followups) ? result.followups.map(text).filter(Boolean) : [];
  return {
    runId,
    question: text(result.question),
    answer: text(result.answer),
    elapsed: num(result.elapsed_s),
    provider: text(result.provider),
    pass: safeguard && typeof safeguard.pass === "boolean" ? safeguard.pass : null,
    citations: Array.isArray(result.citations) ? result.citations.length : null,
    prevRunId: text(result.prev_run_id) || null,
    followUps,
    steps: toSteps(events),
    retrieval: toRetrieval(result.retrieval),
  };
}

export function toStack(raw: unknown): StackInfo {
  const root = isRecord(raw) ? raw : {};
  const octo = isRecord(root.octo) ? root.octo : {};
  const surreal = isRecord(root.surrealdb) ? root.surrealdb : {};
  const eleven = isRecord(root.elevenlabs) ? root.elevenlabs : {};
  const how: Record<string, string> = {};
  for (const key of ["daytona", "surrealdb", "octo", "arize", "elevenlabs", "model", "acs"]) {
    const section = isRecord(root[key]) ? root[key] : null;
    const line = section ? text(section.how) : "";
    if (line) how[key] = line;
  }
  const runs = Array.isArray(root.runs)
    ? root.runs.filter(isRecord).map((run) => ({
        run_id: text(run.run_id),
        elapsed: num(run.elapsed_s),
        provider: text(run.provider),
        pass: typeof run.pass === "boolean" ? run.pass : null,
      }))
    : [];
  return {
    chain: Array.isArray(eleven.chain) ? eleven.chain.map(text).filter(Boolean) : [],
    passages: num(octo.passages) ?? firstNumber(text(octo.corpus)),
    nodes: num(surreal.nodes),
    edges: num(surreal.edges),
    how,
    runs: runs.filter((run) => run.run_id),
    engine: toEngine(root.engine),
    tracing: toTracing(root.tracing),
    retention: toRetention(root.retention),
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

export const NO_DATA = "No data yet";

/** Read one of the app's own JSON routes; a non-2xx answer is a rejection, never a half-parsed body. */
export async function readJson(path: string): Promise<unknown> {
  const response = await fetch(path, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(String(response.status));
  return response.json();
}

/** One run's events and result; a run the server cannot answer reads as null rather than failing the page. */
export async function readRun(runId: string): Promise<RunDetail | null> {
  try {
    return toDetail(runId, await readJson(`/api/run/${encodeURIComponent(runId)}`));
  } catch {
    return null;
  }
}
