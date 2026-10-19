import { useEffect, useMemo, useState, type ReactNode } from "react";
import BarChart, { type Bar } from "@/components/BarChart";
import SiteHeader from "@/components/SiteHeader";
import {
  NO_DATA,
  count,
  isCache,
  isToday,
  mean,
  readJson,
  readRun,
  seconds,
  show,
  startOfDay,
  toRuns,
  toStack,
  whenLabel,
  withinDays,
  type RunDetail,
  type SavedRun,
  type StackInfo,
} from "@/lib/runs";
import { cn } from "@/lib/utils";

type Phase = "loading" | "ready" | "error";
type RangeKey = "all" | "7d" | "today";

const RANGES: { value: RangeKey; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "7d", label: "Last 7 days" },
  { value: "all", label: "All" },
];

const buttonClass =
  "inline-flex min-h-[44px] items-center rounded-md border border-border px-3 text-xs font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground";

function Figure({ label, value, note, small }: { label: string; value: string; note?: string; small?: boolean }) {
  const empty = value === NO_DATA;
  return (
    <div className="min-w-0 rounded-lg border border-border bg-card px-3 py-3">
      <p
        className={cn(
          "break-words font-semibold tabular-nums",
          empty ? "text-sm text-muted-foreground" : small ? "text-base leading-snug" : "text-2xl leading-tight",
        )}
      >
        {value}
      </p>
      <p className="mt-2 text-xs text-muted-foreground">{label}</p>
      {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}

function Filter({
  id,
  label,
  value,
  onChange,
  children,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 min-h-[44px] w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm text-foreground"
      >
        {children}
      </select>
    </div>
  );
}

export default function Observability() {
  const [runs, setRuns] = useState<SavedRun[]>([]);
  const [details, setDetails] = useState<Record<string, RunDetail>>({});
  const [stack, setStack] = useState<StackInfo | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [attempt, setAttempt] = useState(0);
  const [range, setRange] = useState<RangeKey>("all");
  const [source, setSource] = useState("all");
  const [question, setQuestion] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [openStep, setOpenStep] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPhase("loading");

    (async () => {
      const [runsResult, stackResult] = await Promise.allSettled([readJson("/api/runs"), readJson("/api/stack")]);
      const stackInfo = stackResult.status === "fulfilled" ? toStack(stackResult.value) : null;

      if (runsResult.status === "rejected") {
        if (cancelled) return;
        setRuns([]);
        setDetails({});
        setStack(stackInfo);
        setPhase("error");
        return;
      }

      const list = toRuns(runsResult.value);
      const loaded = await Promise.all(list.map(async (run) => [run.run_id, await readRun(run.run_id)] as const));
      if (cancelled) return;

      const read: Record<string, RunDetail> = {};
      for (const [runId, detail] of loaded) if (detail) read[runId] = detail;
      setRuns(list);
      setDetails(read);
      setStack(stackInfo);
      setPhase("ready");
    })();

    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const providers = useMemo(() => {
    const seen = new Set<string>();
    for (const run of runs) {
      const provider = details[run.run_id]?.provider;
      if (provider) seen.add(provider);
    }
    return [...seen].sort();
  }, [runs, details]);

  const filtered = useMemo(
    () =>
      runs.filter((run) => {
        const detail = details[run.run_id];
        if (range === "today" && !isToday(run.ts)) return false;
        if (range === "7d" && !withinDays(run.ts, 7)) return false;
        if (source !== "all" && (detail?.provider ?? "") !== source) return false;
        if (question !== "all" && run.run_id !== question) return false;
        return true;
      }),
    [runs, details, range, source, question],
  );

  const selected = filtered.find((run) => run.run_id === selectedId) ?? filtered[0] ?? null;
  const detail = selected ? details[selected.run_id] ?? null : null;
  const selectedKey = selected?.run_id ?? "";

  useEffect(() => {
    setOpenStep(null);
  }, [selectedKey]);

  const figures = useMemo(() => {
    const today = filtered.filter((run) => isToday(run.ts)).length;
    const withProvider = filtered.filter((run) => (details[run.run_id]?.provider ?? "") !== "");
    const cached = withProvider.filter((run) => isCache(details[run.run_id]?.provider ?? "")).length;
    const elapsed = filtered
      .map((run) => details[run.run_id]?.elapsed)
      .filter((value): value is number => typeof value === "number");
    const checked = filtered
      .map((run) => details[run.run_id]?.pass)
      .filter((value): value is boolean => typeof value === "boolean");
    const average = mean(elapsed);
    return {
      today: filtered.length ? String(today) : NO_DATA,
      cache: withProvider.length ? `${Math.round((cached / withProvider.length) * 100)}%` : NO_DATA,
      average: average === null ? NO_DATA : `${average.toFixed(1)}s`,
      voice: stack && stack.chain.length ? stack.chain.join(" → ") : NO_DATA,
      passRate: checked.length
        ? `${Math.round((checked.filter(Boolean).length / checked.length) * 100)}%`
        : NO_DATA,
    };
  }, [filtered, details, stack]);

  const answerBars = useMemo<Bar[]>(() => {
    const buckets: Bar[] = [];
    if (range === "today") {
      const base = startOfDay(new Date());
      for (let hour = 0; hour < 24; hour += 1) {
        const from = new Date(base);
        from.setHours(hour);
        const to = new Date(base);
        to.setHours(hour + 1);
        const value = filtered.filter((run) => {
          const at = new Date(run.ts);
          return at >= from && at < to;
        }).length;
        buckets.push({ key: `h${hour}`, label: hour % 6 === 0 ? `${hour}:00` : "", value, display: String(value) });
      }
      return buckets;
    }
    const today = startOfDay(new Date());
    for (let back = 6; back >= 0; back -= 1) {
      const from = new Date(today);
      from.setDate(from.getDate() - back);
      const to = new Date(from);
      to.setDate(from.getDate() + 1);
      const value = filtered.filter((run) => {
        const at = new Date(run.ts);
        return at >= from && at < to;
      }).length;
      buckets.push({
        key: from.toISOString(),
        label: from.toLocaleDateString("en-US", { weekday: "short" }),
        value,
        display: String(value),
      });
    }
    return buckets;
  }, [filtered, range]);

  const stepBars = useMemo<Bar[]>(() => {
    const order: string[] = [];
    const gaps = new Map<string, number[]>();
    for (const run of filtered) {
      const runDetail = details[run.run_id];
      if (!runDetail) continue;
      runDetail.steps.forEach((step, index) => {
        if (step.t === null) return;
        const previous = index > 0 ? runDetail.steps[index - 1].t : 0;
        const gap = previous === null ? step.t : Math.max(0, step.t - previous);
        const list = gaps.get(step.agent);
        if (list) {
          list.push(gap);
        } else {
          gaps.set(step.agent, [gap]);
          order.push(step.agent);
        }
      });
    }
    return order.map((agent) => {
      const value = mean(gaps.get(agent) ?? []) ?? 0;
      return { key: agent, label: agent, value, display: `${value.toFixed(1)}s` };
    });
  }, [filtered, details]);

  const questionLabel = detail?.question || selected?.question || "Question not recorded";

  return (
    <div className="flex min-h-[100dvh] flex-col bg-background text-foreground">
      <SiteHeader />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        <h1 className="text-xl font-semibold tracking-tight">Observability</h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          Every question runs through four agents: planner, retriever, writer and safeguard. The figures below are read
          from this server's saved runs; narrow them, then pick a run to see what it did, how long each step took, and
          the record behind each step.
        </p>

        {phase === "error" && (
          <div role="status" className="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 p-4">
            <p className="text-sm text-foreground">
              The saved runs are unavailable right now, so this page has no figures to show. The filters below stay
              usable; try again in a moment.
            </p>
            <button type="button" className={cn(buttonClass, "mt-3")} onClick={() => setAttempt((value) => value + 1)}>
              Try again
            </button>
          </div>
        )}

        {phase === "loading" && (
          <p role="status" className="mt-4 text-sm text-muted-foreground">
            Reading the saved runs…
          </p>
        )}

        <section className="mt-5">
          <h2 className="text-sm font-semibold">Today at a glance</h2>
          <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Figure label="Questions answered today" value={figures.today} />
            <Figure label="Answers from cache" value={figures.cache} note="Share of runs served from the cache" />
            <Figure label="Average answer time" value={figures.average} note="Mean elapsed over these runs" />
            <Figure label="Voice" value={figures.voice} small note="Providers in the chain, in order" />
            <Figure label="Citation check pass rate" value={figures.passRate} note="Runs whose safeguard passed" />
          </div>
        </section>

        <section className="mt-6" aria-label="Filters">
          <h2 className="text-sm font-semibold">Narrow this view</h2>
          <div className="mt-2 grid gap-3 sm:grid-cols-3">
            <Filter id="range-filter" label="Range" value={range} onChange={(next) => setRange(next as RangeKey)}>
              {RANGES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Filter>
            <Filter id="source-filter" label="Answer source" value={source} onChange={setSource}>
              <option value="all">All sources</option>
              {providers.map((provider) => (
                <option key={provider} value={provider}>
                  {provider}
                </option>
              ))}
            </Filter>
            <Filter id="question-filter" label="Question" value={question} onChange={setQuestion}>
              <option value="all">All questions</option>
              {runs.map((run) => (
                <option key={run.run_id} value={run.run_id}>
                  {run.question}
                </option>
              ))}
            </Filter>
          </div>
        </section>

        <section className="mt-6 grid gap-3 lg:grid-cols-2">
          <BarChart
            name="Answers per day"
            caption={range === "today" ? "Answers per day · today, by hour" : "Answers per day · last seven days"}
            bars={answerBars}
            showValues={range !== "today"}
            empty={!filtered.length}
          />
          <BarChart
            name="Seconds per step"
            caption="Seconds per step · mean over these runs"
            bars={stepBars}
            empty={!stepBars.length}
          />
        </section>

        <section className="mt-6">
          <h2 className="text-sm font-semibold">Saved runs</h2>

          {phase === "ready" && !runs.length && (
            <p className="mt-2 text-sm text-muted-foreground">
              No saved runs yet. Ask a question on Home and the run appears here.
            </p>
          )}

          {!!runs.length && (
            <div className="mt-2 overflow-x-auto rounded-lg border border-border">
              <table aria-label="Saved runs table" className="w-full min-w-[46rem] border-collapse text-left">
                <thead>
                  <tr className="border-b border-border bg-muted/60">
                    <th scope="col" className="w-[34%] px-3 py-2 text-xs font-semibold">
                      Question
                    </th>
                    <th scope="col" className="px-3 py-2 text-xs font-semibold">
                      When
                    </th>
                    <th scope="col" className="px-3 py-2 text-xs font-semibold">
                      Answer source
                    </th>
                    <th scope="col" className="px-3 py-2 text-xs font-semibold">
                      Elapsed time
                    </th>
                    <th scope="col" className="px-3 py-2 text-xs font-semibold">
                      Authorities
                    </th>
                    <th scope="col" className="px-3 py-2 text-xs font-semibold">
                      Citation check
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((run) => {
                    const runDetail = details[run.run_id] ?? null;
                    const isSelected = selected?.run_id === run.run_id;
                    const authorities = run.n ?? runDetail?.citations ?? null;
                    return (
                      <tr
                        key={run.run_id}
                        onClick={() => setSelectedId(run.run_id)}
                        className={cn(
                          "cursor-pointer border-b border-border align-top last:border-0",
                          isSelected ? "bg-secondary" : "hover:bg-accent",
                        )}
                      >
                        <td className="px-1 py-1">
                          <button
                            type="button"
                            aria-label={run.question}
                            aria-pressed={isSelected}
                            onClick={() => setSelectedId(run.run_id)}
                            className="min-h-[44px] w-full rounded-md px-2 py-1 text-left text-sm font-medium text-foreground"
                          >
                            {run.question}
                          </button>
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">{whenLabel(run.ts)}</td>
                        <td className="break-words px-3 py-2 text-xs text-muted-foreground">
                          {runDetail?.provider || "—"}
                        </td>
                        <td className="px-3 py-2 text-xs tabular-nums text-muted-foreground">
                          {seconds(runDetail?.elapsed ?? null)}
                        </td>
                        <td className="px-3 py-2 text-xs tabular-nums text-muted-foreground">
                          {count(authorities)}
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {runDetail?.pass === true ? "Passed" : runDetail?.pass === false ? "Failed" : "—"}
                        </td>
                      </tr>
                    );
                  })}
                  {!filtered.length && (
                    <tr>
                      <td colSpan={6} className="px-3 py-3 text-sm text-muted-foreground">
                        No saved run matches these filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {selected && (
          <section className="mt-6 rounded-lg border border-border p-4">
            <h2 className="text-sm font-semibold">Selected run</h2>

            {!detail ? (
              <p className="mt-2 text-sm text-muted-foreground">
                This run's trace couldn't be read. Pick another run, or try again.
              </p>
            ) : (
              <>
                <dl className="mt-3 grid grid-cols-1 gap-y-2 text-sm sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-x-4">
                  <dt className="text-muted-foreground">Question</dt>
                  <dd className="break-words">{questionLabel}</dd>
                  <dt className="text-muted-foreground">Took</dt>
                  <dd className="tabular-nums">{seconds(detail.elapsed)}</dd>
                  <dt className="text-muted-foreground">Provider</dt>
                  <dd className="break-words">{detail.provider || "not recorded"}</dd>
                </dl>

                <h3 className="mt-5 text-sm font-semibold">Pipeline steps</h3>
                {!detail.steps.length ? (
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
                                <div key={key} className="grid grid-cols-1 gap-x-3 sm:grid-cols-[auto_minmax(0,1fr)]">
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
