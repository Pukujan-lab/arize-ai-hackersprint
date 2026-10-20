// The research desk: what the four agents have done lately, how the corpus is holding up, and the two
// ways into the work — ask a question, or open a run that already exists.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  ArrowUpRight,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  Clock,
  FlaskConical,
  Loader2,
  MapPin,
  MessagesSquare,
  Search,
  ShieldCheck,
} from "lucide-react";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import DetailDrawer from "@/components/DetailDrawer";
import { loadRunDetail, loadRunResult, loadRuns, loadStack } from "@/lib/api";
import { locate, titleCase, type Citation, type RunResult } from "@/lib/citations";
import { SUGGESTIONS } from "@/lib/demo";
import {
  NO_DATA,
  count,
  isCache,
  isToday,
  mean,
  seconds,
  startOfDay,
  whenLabel,
  type RunDetail,
  type SavedRun,
  type StackInfo,
} from "@/lib/runs";
import { cn } from "@/lib/utils";

const chartConfig = {
  answers: { label: "Answers", color: "hsl(var(--primary))" },
} satisfies ChartConfig;

function StatCard({
  icon: Icon,
  label,
  value,
  note,
}: {
  icon: typeof Clock;
  label: string;
  value: string;
  note: string;
}) {
  const empty = value === NO_DATA;
  return (
    <div className="rounded-xl border border-border bg-card p-3.5">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        <span className="text-xs font-medium">{label}</span>
      </div>
      <p
        className={cn(
          "mt-2 break-words font-semibold leading-tight tabular-nums",
          empty ? "text-sm text-muted-foreground" : "text-2xl",
        )}
      >
        {value}
      </p>
      <p className="mt-1 text-xs leading-snug text-muted-foreground">{note}</p>
    </div>
  );
}

function SectionCard({
  title,
  action,
  children,
  className,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-xl border border-border bg-card", className)}>
      <div className="flex items-center gap-2 border-b border-border px-3.5 py-2.5">
        <h2 className="mr-auto text-sm font-semibold">{title}</h2>
        {action}
      </div>
      <div className="p-3.5">{children}</div>
    </section>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [question, setQuestion] = useState("");
  const [runs, setRuns] = useState<SavedRun[]>([]);
  const [details, setDetails] = useState<Record<string, RunDetail>>({});
  const [stack, setStack] = useState<StackInfo | null>(null);
  const [latest, setLatest] = useState<RunResult | null>(null);
  const [source, setSource] = useState<"live" | "sample" | "loading">("loading");
  const [openRun, setOpenRun] = useState<SavedRun | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [{ runs: list, source: where }, { stack: info }] = await Promise.all([loadRuns(), loadStack()]);
      if (cancelled) return;
      setRuns(list);
      setSource(where);
      setStack(info);
      const loaded = await Promise.all(list.slice(0, 8).map(async (run) => [run.run_id, await loadRunDetail(run.run_id)] as const));
      if (cancelled) return;
      const read: Record<string, RunDetail> = {};
      for (const [runId, entry] of loaded) if (entry.detail) read[runId] = entry.detail;
      setDetails(read);
      if (list[0]) {
        const { result } = await loadRunResult(list[0].run_id);
        if (!cancelled) setLatest(result);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const figures = useMemo(() => {
    const today = runs.filter((run) => isToday(run.ts)).length;
    const checked = runs.map((run) => details[run.run_id]?.pass).filter((pass): pass is boolean => typeof pass === "boolean");
    const elapsed = runs.map((run) => details[run.run_id]?.elapsed).filter((value): value is number => typeof value === "number");
    const cached = runs.filter((run) => isCache(details[run.run_id]?.provider || "")).length;
    const average = mean(elapsed);
    return {
      today: runs.length ? String(today) : NO_DATA,
      passRate: checked.length ? `${Math.round((checked.filter(Boolean).length / checked.length) * 100)}%` : NO_DATA,
      average: average === null ? NO_DATA : `${average.toFixed(1)}s`,
      cache: runs.length ? `${Math.round((cached / runs.length) * 100)}%` : NO_DATA,
      checked: checked.length,
    };
  }, [runs, details]);

  const activity = useMemo(() => {
    const out: { day: string; answers: number }[] = [];
    const today = startOfDay(new Date());
    for (let back = 6; back >= 0; back -= 1) {
      const from = new Date(today);
      from.setDate(from.getDate() - back);
      const to = new Date(from);
      to.setDate(from.getDate() + 1);
      out.push({
        day: from.toLocaleDateString("en-US", { weekday: "short" }),
        answers: runs.filter((run) => {
          const at = new Date(run.ts);
          return at >= from && at < to;
        }).length,
      });
    }
    return out;
  }, [runs]);

  /** The places the newest run reaches, as the map would place them. */
  const places = useMemo(() => {
    const citations: Citation[] = latest?.citations || [];
    const grouped = new Map<string, { label: string; count: number; cat: string }>();
    for (const citation of citations) {
      const location = locate(citation);
      const entry = grouped.get(location.key);
      if (entry) entry.count += 1;
      else
        grouped.set(location.key, {
          label: location.cat === "county" ? location.label.split("→")[0].trim() : location.label,
          count: 1,
          cat: location.cat,
        });
    }
    return [...grouped.values()].sort((a, b) => b.count - a.count).slice(0, 6);
  }, [latest]);

  const engine = stack?.engine ?? null;
  const recent = runs.slice(0, 6);
  const detail = openRun ? details[openRun.run_id] ?? null : null;

  return (
    <div className="mx-auto h-full w-full max-w-[1180px] overflow-y-auto px-4 py-5">
      <section className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold tracking-tight">Ask the desk</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              A planner, a retriever, a writer and a citation check — then a memo with every authority placed on the map.
            </p>
          </div>
          {source === "sample" && (
            <Badge variant="secondary" className="gap-1">
              <FlaskConical className="h-3.5 w-3.5" />
              Sample corpus
            </Badge>
          )}
        </div>
        <form
          className="mt-3 flex flex-col gap-2 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            const asked = question.trim();
            navigate(asked ? `/chat?q=${encodeURIComponent(asked)}` : "/chat");
          }}
        >
          <input
            aria-label="Ask a legal question"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="Does a severed mineral estate keep the Colorado homestead exemption?"
            className="h-11 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div className="flex gap-2">
            <Button type="submit" className="gap-2">
              <MessagesSquare className="h-4 w-4" />
              Ask
            </Button>
            <Button type="button" variant="outline" className="gap-2" onClick={() => navigate("/search")}>
              <Search className="h-4 w-4" />
              Search
            </Button>
          </div>
        </form>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {SUGGESTIONS.slice(0, 3).map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => navigate(`/chat?q=${encodeURIComponent(suggestion)}`)}
              className="max-w-full truncate rounded-full border border-border px-2.5 py-1 text-left text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              {suggestion}
            </button>
          ))}
        </div>
      </section>

      <section aria-label="Figures" className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          icon={MessagesSquare}
          label="Answered today"
          value={figures.today}
          note={`${count(runs.length)} saved run${runs.length === 1 ? "" : "s"} on this device`}
        />
        <StatCard
          icon={ShieldCheck}
          label="Citation check"
          value={figures.passRate}
          note={figures.checked ? `${figures.checked} run${figures.checked === 1 ? "" : "s"} checked` : "No check recorded"}
        />
        <StatCard
          icon={Clock}
          label="Mean answer time"
          value={figures.average}
          note={`${figures.cache} served from the cache`}
        />
        <StatCard
          icon={BookOpen}
          label="Corpus"
          value={count(engine?.chunkCount ?? stack?.passages ?? null)}
          note={`passages · ${count(engine?.caseCount ?? null)} cases`}
        />
      </section>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <SectionCard
            title="Answers this week"
            action={<span className="text-xs text-muted-foreground">{count(runs.length)} total</span>}
          >
            {runs.length ? (
              <ChartContainer config={chartConfig} className="aspect-auto h-[190px] w-full">
                <AreaChart data={activity} margin={{ top: 6, right: 6, bottom: 0, left: -18 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={8} />
                  <YAxis tickLine={false} axisLine={false} allowDecimals={false} width={30} />
                  <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="line" />} />
                  <Area
                    dataKey="answers"
                    type="monotone"
                    fill="var(--color-answers)"
                    fillOpacity={0.22}
                    stroke="var(--color-answers)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ChartContainer>
            ) : (
              <p className="flex h-[190px] items-center justify-center text-sm text-muted-foreground">{NO_DATA}</p>
            )}
          </SectionCard>

          <SectionCard
            title="Recent runs"
            action={
              <Button asChild variant="ghost" size="sm" className="h-8 gap-1 text-xs">
                <Link to="/observability">
                  All runs
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </Link>
              </Button>
            }
          >
            {recent.length ? (
              <ul className="-mx-1 divide-y divide-border">
                {recent.map((run) => {
                  const entry = details[run.run_id] ?? null;
                  return (
                    <li key={run.run_id}>
                      <button
                        type="button"
                        onClick={() => setOpenRun(run)}
                        className="flex w-full items-start gap-2 rounded-md px-1 py-2.5 text-left transition-colors hover:bg-accent/60"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{run.question}</span>
                          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                            <span>{whenLabel(run.ts)}</span>
                            <span aria-hidden="true">·</span>
                            <span>{count(run.n)} authorit{run.n === 1 ? "y" : "ies"}</span>
                            <span aria-hidden="true">·</span>
                            <span className="tabular-nums">{seconds(entry?.elapsed ?? null)}</span>
                          </span>
                        </span>
                        {entry?.pass === true && (
                          <Badge variant="outline" className="mt-0.5 gap-1 border-emerald-500/40 text-emerald-600 dark:text-emerald-400">
                            <CheckCircle2 className="h-3 w-3" />
                            Passed
                          </Badge>
                        )}
                        {entry?.pass === false && (
                          <Badge variant="outline" className="mt-0.5 border-destructive/50 text-destructive">
                            Failed
                          </Badge>
                        )}
                        <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                No saved runs yet. Ask a question and it appears here.
              </p>
            )}
          </SectionCard>
        </div>

        <div className="space-y-4">
          <SectionCard
            title="Retrieval engine"
            action={
              <Button asChild variant="ghost" size="sm" className="h-8 gap-1 text-xs">
                <Link to="/observability">
                  Detail
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </Link>
              </Button>
            }
          >
            {engine ? (
              <dl className="space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className={cn(
                      "h-2 w-2 shrink-0 rounded-full",
                      engine.ok ? "bg-emerald-500" : engine.configured === false ? "bg-muted-foreground/40" : "bg-amber-500",
                    )}
                  />
                  <dt className="min-w-0 flex-1 truncate text-muted-foreground">Status</dt>
                  <dd className="truncate font-medium">{engine.status || "not reported"}</dd>
                </div>
                {[
                  ["Lexical", engine.lexical || "not reported"],
                  ["Dense", engine.denseModel || "not loaded"],
                  ["Rerank", engine.rerankModel || "not loaded"],
                  ["Fusion", engine.scorer || "not reported"],
                  ["Corpus revision", engine.corpusRevision || "not reported"],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-baseline gap-2">
                    <dt className="min-w-0 flex-1 truncate text-muted-foreground">{label}</dt>
                    <dd className="max-w-[60%] truncate text-right text-xs">{value}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">The server did not report the retrieval engine.</p>
            )}
          </SectionCard>

          <SectionCard
            title="Where the newest run reaches"
            action={
              <Button asChild variant="ghost" size="sm" className="h-8 gap-1 text-xs">
                <Link to="/explore">
                  Explore
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </Link>
              </Button>
            }
          >
            {places.length ? (
              <>
                <ul className="space-y-1.5">
                  {places.map((place) => (
                    <li key={place.label} className="flex items-center gap-2 text-sm">
                      <MapPin
                        className={cn(
                          "h-3.5 w-3.5 shrink-0",
                          place.cat === "county" && "text-emerald-500",
                          place.cat === "statute" && "text-amber-500",
                          place.cat === "federal" && "text-pink-500",
                          place.cat === "state" && "text-indigo-400",
                        )}
                      />
                      <span className="min-w-0 flex-1 truncate">{titleCase(place.label)}</span>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{place.count}</span>
                    </li>
                  ))}
                </ul>
                {latest?.question && (
                  <p className="mt-2.5 line-clamp-2 border-t border-border pt-2 text-xs leading-relaxed text-muted-foreground">
                    From “{latest.question}”
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No authority has been placed yet.</p>
            )}
          </SectionCard>

          <SectionCard title="Voice chain">
            {stack?.chain.length ? (
              <>
                <ol className="flex flex-wrap items-center gap-1.5 text-xs">
                  {stack.chain.map((provider, index) => (
                    <li key={provider} className="flex items-center gap-1.5">
                      {index > 0 && <span className="text-muted-foreground">→</span>}
                      <span className="rounded border border-border bg-background px-1.5 py-0.5 font-medium">{provider}</span>
                    </li>
                  ))}
                </ol>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  Each line of a memo is spoken through this chain, in order, until one answers.
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">The server did not report a voice chain.</p>
            )}
          </SectionCard>
        </div>
      </div>

      <DetailDrawer
        open={openRun !== null}
        onOpenChange={(open) => {
          if (!open) setOpenRun(null);
        }}
        title={openRun?.question || "Run"}
        description={openRun ? `${whenLabel(openRun.ts)} · ${count(openRun.n)} authorities` : undefined}
        footer={
          openRun && (
            <div className="flex flex-wrap gap-2">
              <Button className="gap-2" onClick={() => navigate(`/chat?run=${encodeURIComponent(openRun.run_id)}`)}>
                <MessagesSquare className="h-4 w-4" />
                Open in chat
              </Button>
              <Button variant="outline" className="gap-2" onClick={() => navigate(`/explore?run=${encodeURIComponent(openRun.run_id)}`)}>
                <MapPin className="h-4 w-4" />
                Show on the map
              </Button>
            </div>
          )
        }
      >
        {!detail ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Reading the run…
          </p>
        ) : (
          <div className="space-y-4">
            <dl className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-card/60 p-3 text-sm">
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Run</dt>
                <dd className="truncate font-mono text-xs">{detail.runId}</dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Took</dt>
                <dd className="tabular-nums">{seconds(detail.elapsed)}</dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Answer source</dt>
                <dd className="truncate">{detail.provider || "not recorded"}</dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Citation check</dt>
                <dd>{detail.pass === true ? "Passed" : detail.pass === false ? "Failed" : "not recorded"}</dd>
              </div>
            </dl>

            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pipeline</h3>
              {detail.steps.length ? (
                <ol className="mt-1.5 space-y-1">
                  {detail.steps.map((step, index) => (
                    <li key={index} className="flex items-baseline gap-2 rounded-md border border-border px-2.5 py-1.5 text-sm">
                      <span className="text-xs tabular-nums text-muted-foreground">{index + 1}</span>
                      <span className="min-w-0 flex-1 truncate font-medium">{step.agent}</span>
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{step.kind}</span>
                      <span className="text-xs tabular-nums text-muted-foreground">{seconds(step.t)}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="mt-1.5 text-sm text-muted-foreground">This run recorded no pipeline steps.</p>
              )}
            </div>

            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Retrieval</h3>
              {detail.retrieval?.stages.length ? (
                <ol className="mt-1.5 space-y-1">
                  {detail.retrieval.stages.map((stage, index) => (
                    <li key={`${stage.name}-${index}`} className="rounded-md border border-border px-2.5 py-1.5 text-sm">
                      <div className="flex items-baseline gap-2">
                        <span className="min-w-0 flex-1 truncate">{stage.name}</span>
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {stage.skipped ? "skipped" : stage.durationMs === null ? "—" : `${Math.round(stage.durationMs)} ms`}
                        </span>
                      </div>
                      {stage.skipped && stage.reason && (
                        <p className="mt-0.5 text-xs text-muted-foreground">{stage.reason}</p>
                      )}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="mt-1.5 text-sm text-muted-foreground">This run recorded no retrieval stages.</p>
              )}
            </div>

            <p className="rounded-md border border-border bg-muted/40 p-2.5 text-xs leading-relaxed text-muted-foreground">
              AI-generated research summary, not legal advice. The citation check verifies references, not reasoning.
            </p>
          </div>
        )}
      </DetailDrawer>
    </div>
  );
}
