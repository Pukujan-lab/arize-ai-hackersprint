import { useEffect, useState } from "react";
import SiteHeader from "@/components/SiteHeader";
import { cn } from "@/lib/utils";

type SavedRun = { run_id: string; question: string; n: number | null; ts: string };
type Step = { record: Record<string, unknown>; t: number | null; agent: string; kind: string };
type RunDetail = { question: string; elapsed: number | null; provider: string; steps: Step[] };
type Phase = "loading" | "ready" | "error";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** A finite number from the API, or null. Keeps NaN out of the page. */
function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Any value as readable text; never "undefined", "null" or "NaN". */
function show(value: unknown): string {
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

function seconds(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(1)}s`;
}

function whenLabel(iso: string): string {
  if (!iso) return "time not recorded";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

function toRuns(raw: unknown): SavedRun[] {
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
function toSteps(events: Record<string, unknown>[]): Step[] {
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

function toDetail(raw: unknown): RunDetail {
  const root = isRecord(raw) ? raw : {};
  const result = isRecord(root.result) ? root.result : {};
  const events = Array.isArray(root.events) ? root.events.filter(isRecord) : [];
  return {
    question: text(result.question),
    elapsed: num(result.elapsed_s),
    provider: text(result.provider),
    steps: toSteps(events),
  };
}

const buttonClass =
  "inline-flex min-h-[44px] items-center rounded-md border border-border px-3 text-xs font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground";

export default function Observability() {
  const [runs, setRuns] = useState<SavedRun[]>([]);
  const [runsPhase, setRunsPhase] = useState<Phase>("loading");
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [detailPhase, setDetailPhase] = useState<Phase>("loading");
  const [openStep, setOpenStep] = useState<number | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setRunsPhase("loading");
    fetch("/api/runs", { headers: { Accept: "application/json" } })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((data) => {
        if (cancelled) return;
        const list = toRuns(data);
        setRuns(list);
        setRunsPhase("ready");
        setSelected((prev) => (prev && list.some((run) => run.run_id === prev) ? prev : list[0]?.run_id ?? null));
      })
      .catch(() => {
        if (cancelled) return;
        setRuns([]);
        setSelected(null);
        setRunsPhase("error");
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      setDetailPhase("loading");
      return;
    }
    let cancelled = false;
    setDetail(null);
    setDetailPhase("loading");
    setOpenStep(null);
    fetch(`/api/run/${encodeURIComponent(selected)}`, { headers: { Accept: "application/json" } })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((data) => {
        if (cancelled) return;
        setDetail(toDetail(data));
        setDetailPhase("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setDetail(null);
        setDetailPhase("error");
      });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const selectedRun = runs.find((run) => run.run_id === selected) ?? null;
  const question = detail?.question || selectedRun?.question || "Question not recorded";

  return (
    <div className="flex min-h-[100dvh] flex-col bg-background text-foreground">
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        <h1 className="text-xl font-semibold tracking-tight">Observability</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Every question runs through four agents: planner, retriever, writer and safeguard. Pick a saved run to see
          what it did, how long each step took, and the record behind each step.
        </p>

        <section className="mt-6">
          <h2 className="text-sm font-semibold">Saved runs</h2>

          {runsPhase === "loading" && (
            <p className="mt-2 text-sm text-muted-foreground">Reading the saved runs…</p>
          )}

          {runsPhase === "error" && (
            <div className="mt-2 rounded-lg border border-border p-4">
              <p className="text-sm text-muted-foreground">
                The saved runs are unavailable right now, so this page has nothing to list. Try again in a moment.
              </p>
              <button type="button" className={cn(buttonClass, "mt-3")} onClick={() => setAttempt((n) => n + 1)}>
                Try again
              </button>
            </div>
          )}

          {runsPhase === "ready" && !runs.length && (
            <p className="mt-2 text-sm text-muted-foreground">
              No saved runs yet. Ask a question on Home and the run appears here.
            </p>
          )}

          {runsPhase === "ready" && !!runs.length && (
            <ul className="mt-2 space-y-2">
              {runs.map((run) => {
                const isSelected = run.run_id === selected;
                return (
                  <li key={run.run_id}>
                    <button
                      type="button"
                      aria-label={run.question}
                      aria-pressed={isSelected}
                      onClick={() => setSelected(run.run_id)}
                      className={cn(
                        "flex min-h-[44px] w-full flex-col gap-1 rounded-lg border px-3 py-2 text-left transition-colors",
                        isSelected
                          ? "border-foreground/40 bg-secondary"
                          : "border-border hover:bg-accent hover:text-accent-foreground",
                      )}
                    >
                      <span className="break-words text-sm font-medium leading-snug">{run.question}</span>
                      <span className="break-words text-xs text-muted-foreground">
                        {whenLabel(run.ts)} · {run.n === null ? "authorities not recorded" : `${run.n} ${run.n === 1 ? "authority" : "authorities"}`}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {selected && (
          <section className="mt-6 rounded-lg border border-border p-4">
            <h2 className="text-sm font-semibold">Selected run</h2>

            {detailPhase === "error" ? (
              <p className="mt-2 text-sm text-muted-foreground">
                This run's trace couldn't be read. Pick another run, or try again.
              </p>
            ) : (
              <>
                <dl className="mt-3 grid grid-cols-1 gap-y-2 text-sm sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-x-4">
                  <dt className="text-muted-foreground">Question</dt>
                  <dd className="break-words">{question}</dd>
                  <dt className="text-muted-foreground">Took</dt>
                  <dd className="tabular-nums">{detailPhase === "ready" ? seconds(detail?.elapsed ?? null) : "reading…"}</dd>
                  <dt className="text-muted-foreground">Provider</dt>
                  <dd className="break-words">{detailPhase === "ready" ? detail?.provider || "not recorded" : "reading…"}</dd>
                </dl>

                <h3 className="mt-5 text-sm font-semibold">Pipeline steps</h3>
                {detailPhase === "loading" ? (
                  <p className="mt-2 text-sm text-muted-foreground">Reading the pipeline steps…</p>
                ) : !detail?.steps.length ? (
                  <p className="mt-2 text-sm text-muted-foreground">This run recorded no pipeline steps.</p>
                ) : (
                  <ol className="mt-2 space-y-2">
                    {detail.steps.map((step, index) => {
                      const previousStep = index > 0 ? detail.steps[index - 1] : null;
                      const previous = previousStep ? previousStep.t : null;
                      const gap = step.t === null || previous === null ? null : step.t - previous;
                      const isOpen = openStep === index;
                      return (
                        <li key={index} className="rounded-md border border-border p-3">
                          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                            <span className="text-xs font-semibold tabular-nums text-muted-foreground">
                              {index + 1}
                            </span>
                            <span className="break-words text-sm font-medium">{step.agent}</span>
                            <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                              {step.kind}
                            </span>
                            <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                              {seconds(step.t)}
                            </span>
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {index === 0
                              ? "first step of the run"
                              : gap === null
                                ? "gap not recorded"
                                : `${gap < 0 ? "−" : "+"}${Math.abs(gap).toFixed(1)}s after ${previousStep?.agent ?? "the step before"}`}
                          </div>

                          <button
                            type="button"
                            aria-expanded={isOpen}
                            className={cn(buttonClass, "mt-2")}
                            onClick={() => setOpenStep(isOpen ? null : index)}
                          >
                            Raw details
                          </button>

                          {isOpen && (
                            <dl className="mt-2 grid gap-y-1 rounded-md bg-muted p-3 font-mono text-xs">
                              {Object.entries(step.record).map(([key, value]) => (
                                <div
                                  key={key}
                                  className="grid grid-cols-1 gap-x-3 sm:grid-cols-[auto_minmax(0,1fr)]"
                                >
                                  <dt className="text-muted-foreground">{key}</dt>
                                  <dd className="break-words">{show(value)}</dd>
                                </div>
                              ))}
                            </dl>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                )}
              </>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
