// One place where the workspace reads its data. Every call prefers the server's own JSON routes and
// falls back to the bundled sample corpus when the backend is not there, saying which one answered so
// the page can mark sample records rather than passing them off as retrieved authority.

import {
  DEMO_DETAILS,
  DEMO_RESULT,
  DEMO_RESULTS,
  DEMO_SAVED,
  DEMO_STACK,
} from "./demo";
import type { RunResult } from "./citations";
import {
  readJson,
  toArize,
  toDetail,
  toRuns,
  toStack,
  type ArizeSnapshot,
  type RunDetail,
  type SavedRun,
  type StackInfo,
} from "./runs";

/** Where an answer came from: the server, or the sample corpus bundled with the app. */
export type Source = "live" | "sample";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

let probe: Promise<Source> | null = null;

/**
 * Whether this build can reach the research backend. Asked once and remembered: the answer does not
 * change while the page is open, and every page would otherwise ask again.
 */
export function probeSource(): Promise<Source> {
  if (!probe) {
    probe = readJson("/api/stack").then(
      () => "live" as Source,
      () => "sample" as Source,
    );
  }
  return probe;
}

export async function loadRuns(): Promise<{ runs: SavedRun[]; source: Source }> {
  try {
    return { runs: toRuns(await readJson("/api/runs")), source: "live" };
  } catch {
    return { runs: DEMO_SAVED, source: "sample" };
  }
}

export async function loadStack(): Promise<{ stack: StackInfo | null; source: Source }> {
  try {
    return { stack: toStack(await readJson("/api/stack")), source: "live" };
  } catch {
    return { stack: DEMO_STACK, source: "sample" };
  }
}

export async function loadArize(): Promise<ArizeSnapshot | null> {
  try {
    return toArize(await readJson("/api/arize"));
  } catch {
    return null;
  }
}

export async function loadRunDetail(runId: string): Promise<{ detail: RunDetail | null; source: Source }> {
  try {
    return { detail: toDetail(runId, await readJson(`/api/run/${encodeURIComponent(runId)}`)), source: "live" };
  } catch {
    return { detail: DEMO_DETAILS[runId] ?? DEMO_DETAILS[DEMO_RESULT.run_id || ""] ?? null, source: "sample" };
  }
}

/** The whole result behind a saved run, which the map and the chat both need. */
export async function loadRunResult(runId: string): Promise<{ result: RunResult | null; source: Source }> {
  try {
    const raw = await readJson(`/api/run/${encodeURIComponent(runId)}`);
    const root = raw && typeof raw === "object" ? (raw as { result?: unknown }) : {};
    const result = root.result && typeof root.result === "object" ? (root.result as RunResult) : null;
    return { result, source: "live" };
  } catch {
    return { result: DEMO_RESULTS.find((entry) => entry.run_id === runId) ?? DEMO_RESULT, source: "sample" };
  }
}

// ------------------------------------------------------------------ asking

export const STAGE_PLAN = ["planner", "retriever", "answer", "safeguard"] as const;
export type StageName = (typeof STAGE_PLAN)[number];
export type StageState = "waiting" | "running" | "done";
export type StageTick = { name: StageName; state: StageState; message: string };

/** What each agent's step is called while the run is working. */
export const STAGE_WORDS: Record<StageName, string> = {
  planner: "Planning the run",
  retriever: "Retrieving authorities",
  answer: "Writing the answer",
  safeguard: "Checking the citations",
};

/** One report from a run in progress: the stage it reached, and the answer as it is being written. */
export type AskTick = { stage: string; detail: string; draft: string; stages: StageTick[] };

/** The server refused the question for a reason the reader needs to see — a rate limit, say. */
export class AskRefused extends Error {}

const RUN_TIMEOUT_MS = 90_000;
const POLL_MS = 1000;

/** The stage the pipeline has reached, from the events the run endpoint reports. */
export function stageOf(events: unknown): { stage: string; detail: string } {
  const list = Array.isArray(events)
    ? events.filter((event): event is Record<string, unknown> => !!event && typeof event === "object")
    : [];
  const last = list[list.length - 1];
  const agent = typeof last?.agent === "string" ? last.agent.trim().toLowerCase() : "";
  const kind = typeof last?.kind === "string" ? last.kind.trim() : "";
  const msg = typeof last?.msg === "string" ? last.msg.trim() : "";
  const stage = STAGE_WORDS[agent as StageName] || (agent ? `${agent}${kind ? ` · ${kind}` : ""}` : STAGE_WORDS.planner);
  return { stage, detail: msg };
}

/**
 * The pipeline as the run's own events report it: a stage is running from its first event and done
 * once a later stage starts, or once it reports itself finished. A stage that never reported is not
 * listed — the page shows what the run did, not what it might have done.
 */
export function pipelineFrom(events: unknown): StageTick[] {
  const list = Array.isArray(events)
    ? events.filter((event): event is Record<string, unknown> => !!event && typeof event === "object")
    : [];
  const stages: StageTick[] = [];
  for (const event of list) {
    const name = String(event.agent || "").trim().toLowerCase();
    if (!(STAGE_PLAN as readonly string[]).includes(name)) continue;
    const kind = String(event.kind || "").trim();
    const message = typeof event.msg === "string" ? event.msg.trim() : "";
    let stage = stages.find((entry) => entry.name === name);
    if (!stage) {
      for (const earlier of stages) if (earlier.state === "running") earlier.state = "done";
      stage = { name: name as StageName, state: "running", message };
      stages.push(stage);
    } else if (message) {
      stage.message = message;
    }
    if (/^(done|release|pass|complete|finished)$/i.test(kind)) stage.state = "done";
  }
  return stages;
}

/** A run that produced an answer ran every stage of the pipeline. */
export function pipelineDone(): StageTick[] {
  return STAGE_PLAN.map((name) => ({ name, state: "done" as StageState, message: "" }));
}

async function pollRun(runId: string, onTick?: (tick: AskTick) => void): Promise<RunResult | null> {
  const deadline = Date.now() + RUN_TIMEOUT_MS;
  for (;;) {
    let data: { events?: unknown[]; result?: RunResult | null; partial?: string | null } | null = null;
    try {
      const response = await fetch(`/api/run/${encodeURIComponent(runId)}`, { cache: "no-store" });
      if (response.ok) data = (await response.json()) as typeof data;
    } catch {
      // A blip mid-run must not lose an answer the agents are still writing: fall through and retry.
    }
    if (data) {
      onTick?.({ ...stageOf(data.events), draft: data.partial || "", stages: pipelineFrom(data.events) });
      if (data.result) return data.result;
    }
    if (Date.now() >= deadline) return null;
    await sleep(POLL_MS);
  }
}

/** The sample run for a question: the record whose subject the question names, else the main one. */
function sampleResultFor(question: string): RunResult {
  const q = question.toLowerCase();
  const pick =
    (/proceed|savings|reinvest/.test(q) && DEMO_RESULTS[1]) ||
    (/bankrupt|estate|petition/.test(q) && DEMO_RESULTS[2]) ||
    DEMO_RESULT;
  return { ...pick, question };
}

/**
 * Ask the four agents. The server starts a run and answers with its id at once, so the result is
 * polled for and every tick is reported; without a server the same stages are played against the
 * sample corpus, so the workspace behaves the same way in a preview.
 */
export async function ask(
  question: string,
  options: { prevRunId?: string | null; onTick?: (tick: AskTick) => void } = {},
): Promise<{ runId: string; result: RunResult; source: Source }> {
  const source = await probeSource();
  if (source === "sample") return sampleAsk(question, options);

  const body = options.prevRunId ? { question, prev_run_id: options.prevRunId } : { question };
  const started = await fetch("/api/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await started.json().catch(() => null)) as { run_id?: string; error?: string } | null;
  if (!started.ok) {
    throw new AskRefused(data?.error?.trim() || "The server refused that question. Please try again.");
  }
  if (!data?.run_id) throw new Error("The server did not start a run.");
  const result = await pollRun(data.run_id, options.onTick);
  if (!result) throw new Error("That run is taking longer than expected. Please try again.");
  return { runId: data.run_id, result, source: "live" };
}

/** The sample pipeline: the same four stages, played in order against the bundled corpus. */
async function sampleAsk(
  question: string,
  options: { prevRunId?: string | null; onTick?: (tick: AskTick) => void },
): Promise<{ runId: string; result: RunResult; source: Source }> {
  const result = sampleResultFor(question);
  const runId = `sample-${Date.now().toString(36)}`;
  const stages: StageTick[] = STAGE_PLAN.map((name) => ({ name, state: "waiting", message: "" }));
  const report = (name: StageName, detail: string, draft = "") => {
    const index = STAGE_PLAN.indexOf(name);
    stages.forEach((stage, i) => {
      stage.state = i < index ? "done" : i === index ? "running" : "waiting";
    });
    options.onTick?.({ stage: STAGE_WORDS[name], detail, draft, stages: stages.map((stage) => ({ ...stage })) });
  };

  report("planner", "Reading the question and choosing a retrieval path");
  await sleep(320);
  report("retriever", "24 passages → 8 authorities across 4 jurisdictions");
  await sleep(420);
  const answer = result.answer || "";
  report("answer", "Writing the memo from the retrieved passages", answer.slice(0, Math.round(answer.length * 0.35)));
  await sleep(520);
  report("answer", "Writing the memo from the retrieved passages", answer.slice(0, Math.round(answer.length * 0.75)));
  await sleep(360);
  report("safeguard", `Checking ${result.citations?.length ?? 0} references against the record`);
  await sleep(300);
  stages.forEach((stage) => {
    stage.state = "done";
  });
  options.onTick?.({
    stage: "Answer ready",
    detail: `${result.citations?.length ?? 0} authorities checked`,
    draft: answer,
    stages: stages.map((stage) => ({ ...stage })),
  });
  return { runId, result: { ...result, run_id: runId }, source: "sample" };
}
