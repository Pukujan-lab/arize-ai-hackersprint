import { useCallback, useEffect, useState, type ComponentType, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  Database,
  Eye,
  ListChecks,
  Network,
  PenLine,
  Quote,
  Search,
  Server,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Volume2,
  X,
} from "lucide-react";
import DeckMap from "@/components/DeckMap";
import FlowDiagram from "@/components/FlowDiagram";
import SiteHeader from "@/components/SiteHeader";
import StatRow, { type Stat } from "@/components/StatRow";
import { NO_DATA, count, isCache, readJson, readRun, shortAnswer, toRuns, toStack, type RunDetail } from "@/lib/runs";
import { cn } from "@/lib/utils";

type Icon = ComponentType<{ className?: string; "aria-hidden"?: boolean }>;

type Exchange = {
  question: string;
  answer: string;
  followUp: string | null;
  followUpAnswer: string | null;
  check: boolean | null;
  authorities: number | null;
  elapsed: number | null;
  runId: string | null;
  fromSavedRun: boolean;
};

type DeckData = {
  passages: number | null;
  nodes: number | null;
  edges: number | null;
  cachedSeconds: number | null;
  how: Record<string, string>;
  exchange: Exchange;
};

/**
 * The product's own demo exchange, shown only when this device has no saved run to read. It is the
 * question the presenter guide asks, and the deck labels it as the demo rather than passing it off
 * as a run the reader made.
 */
const DEMO: Exchange = {
  question: "Automobile exception: probable cause standard in Colorado",
  answer: "With probable cause, the automobile exception lets an officer search a car without a warrant.",
  followUp: "Can I refuse a search?",
  followUpAnswer:
    "You can decline to consent, but probable cause under the automobile exception can still justify the search.",
  check: null,
  authorities: null,
  elapsed: null,
  runId: null,
  fromSavedRun: false,
};

/** The figures the product states for itself, replaced by the server's own numbers when it reports them. */
const FALLBACK: DeckData = {
  passages: 327407,
  nodes: 119770,
  edges: 160793,
  cachedSeconds: 1.9,
  how: {},
  exchange: DEMO,
};

const PARTNERS: { name: string; key: string; icon: Icon; how: string }[] = [
  {
    name: "Daytona",
    key: "daytona",
    icon: Server,
    how: "Every agent, the graph and CI run inside one isolated sandbox, served from a Daytona preview.",
  },
  {
    name: "SurrealDB",
    key: "surrealdb",
    icon: Database,
    how: "The citation graph: authorities as nodes, cites as edges, so retrieval can expand along them.",
  },
  {
    name: "Octo",
    key: "octo",
    icon: Search,
    how: "Full-text passage search over Colorado and federal opinions, seeding the graph for each question.",
  },
  {
    name: "Arize",
    key: "arize",
    icon: Activity,
    how: "An OpenTelemetry span per agent, with citation-guard and groundedness evals on every run.",
  },
  {
    name: "ElevenLabs",
    key: "elevenlabs",
    icon: Volume2,
    how: "Reads the short answer aloud for hands-free use, with the audio cached by hash.",
  },
  {
    name: "Anthropic",
    key: "model",
    icon: Sparkles,
    how: "Haiku drafts the memo behind rate limits and hourly cost caps, with a labelled template fallback.",
  },
  {
    name: "ACS",
    key: "acs",
    icon: ListChecks,
    how: "Agents claim seats, hand off work, and log every run as an audit record.",
  },
];

const controlClass =
  "inline-flex min-h-[44px] items-center justify-center rounded-md border border-border px-3 text-sm font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-40";

function PointCard({ icon: Icon, title, detail }: { icon: Icon; title: string; detail: string }) {
  return (
    <li className="flex min-w-0 flex-col gap-1 rounded-lg border border-border bg-card p-3">
      <Icon className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="break-words text-sm font-semibold">{title}</span>
      <span className="break-words text-xs leading-relaxed text-muted-foreground">{detail}</span>
    </li>
  );
}

/** A follow-up run records the run it followed up on, so a saved exchange is a pair of runs, not one. */
function buildExchange(
  candidates: { run_id: string; question: string }[],
  details: Record<string, RunDetail>,
): Exchange {
  const usable = candidates
    .map((candidate) => details[candidate.run_id])
    .filter((detail): detail is RunDetail => !!detail && !!detail.answer.trim());
  if (!usable.length) return DEMO;

  const real = usable.filter((detail) => !/^template/i.test(detail.provider));
  const pool = real.length ? real : usable;
  const questionOf = (detail: RunDetail) =>
    detail.question || candidates.find((candidate) => candidate.run_id === detail.runId)?.question || "Question not recorded";

  const child = pool.find((detail) => detail.prevRunId && details[detail.prevRunId]);
  if (child) {
    const parent = details[child.prevRunId as string];
    return {
      question: questionOf(parent),
      answer: shortAnswer(parent.answer),
      followUp: child.question,
      followUpAnswer: shortAnswer(child.answer),
      check: child.pass,
      authorities: child.citations ?? parent.citations,
      elapsed: child.elapsed,
      runId: child.runId,
      fromSavedRun: true,
    };
  }

  const featured = pool[0];
  return {
    question: questionOf(featured),
    answer: shortAnswer(featured.answer),
    followUp: featured.followUps[0] ?? null,
    followUpAnswer: null,
    check: featured.pass,
    authorities: featured.citations,
    elapsed: featured.elapsed,
    runId: featured.runId,
    fromSavedRun: true,
  };
}

export default function Slides() {
  const [index, setIndex] = useState(0);
  const [data, setData] = useState<DeckData>(FALLBACK);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const [stackResult, runsResult] = await Promise.allSettled([readJson("/api/stack"), readJson("/api/runs")]);
      const stack = stackResult.status === "fulfilled" ? toStack(stackResult.value) : null;
      const listed = runsResult.status === "fulfilled" ? toRuns(runsResult.value) : [];

      const seen = new Set<string>();
      const candidates: { run_id: string; question: string }[] = [];
      for (const run of [...(stack ? stack.runs.slice().reverse() : []), ...listed]) {
        if (seen.has(run.run_id)) continue;
        seen.add(run.run_id);
        candidates.push({ run_id: run.run_id, question: ("question" in run ? run.question : "") || "" });
      }

      const details: Record<string, RunDetail> = {};
      await Promise.all(
        candidates.slice(0, 12).map(async (candidate) => {
          const detail = await readRun(candidate.run_id);
          if (detail) details[candidate.run_id] = detail;
        }),
      );
      if (cancelled) return;

      const cachedRun = Object.values(details).find((detail) => isCache(detail.provider) && detail.elapsed !== null);

      setData({
        passages: stack?.passages ?? FALLBACK.passages,
        nodes: stack?.nodes || FALLBACK.nodes,
        edges: stack?.edges || FALLBACK.edges,
        cachedSeconds: cachedRun?.elapsed ?? FALLBACK.cachedSeconds,
        how: stack?.how ?? {},
        exchange: buildExchange(candidates, details),
      });
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const exchange = data.exchange;
  const partnerHow = (partner: { key: string; how: string }) => data.how[partner.key] || partner.how;

  const figures: Stat[] = [
    { value: count(data.passages), label: "Octo passages", note: "opinion passages the retriever searches" },
    { value: count(data.nodes), label: "Graph nodes", note: "authorities in the citation graph" },
    { value: count(data.edges), label: "Citation edges", note: "cites links between them" },
    {
      value: data.cachedSeconds === null ? NO_DATA : data.cachedSeconds.toFixed(1),
      unit: "s",
      label: "Pipeline time on a cached answer",
      note: "one run, question to memo",
    },
  ];

  const runFigures: Stat[] = [
    { value: count(exchange.authorities), label: "Authorities cited" },
    {
      value: exchange.elapsed === null ? NO_DATA : exchange.elapsed.toFixed(1),
      unit: "s",
      label: "Answer time",
    },
    {
      value: exchange.check === null ? NO_DATA : exchange.check ? "Passed" : "Failed",
      label: "Citation check",
    },
  ];

  const flow = [
    { label: "Planner", detail: "splits the question", icon: Search },
    { label: "Retriever", detail: "Octo passages, then the graph", icon: Network },
    { label: "Writer", detail: "drafts the memo", icon: PenLine },
    { label: "Safeguard", detail: "checks every citation", icon: ShieldCheck },
    { label: "Voice", detail: "reads it aloud", icon: Volume2 },
  ];

  const slides: { id: string; kicker: string; title: string; body?: string; visual: ReactNode }[] = [
    {
      id: "title",
      kicker: "Precedent",
      title: "Verified research memos for legal teams",
      body: "Ask a legal question in plain language. Four agents retrieve the authorities, expand the citation graph, write the memo, and check every one of them before you read it.",
      visual: (
        <StatRow
          columns="grid-cols-3"
          stats={[
            { value: "4", label: "agents" },
            { value: "5", label: "traced steps" },
            { value: "1", label: "question per memo" },
          ]}
        />
      ),
    },
    {
      id: "problem",
      kicker: "The problem",
      title: "Multi-agent AI is unreliable in production",
      body: "Four failure modes decide whether a multi-agent system can be trusted with real work. Precedent answers each one, and each answer is a partner.",
      visual: (
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <PointCard icon={X} title="Agents collide" detail="Two agents claim the same task and duplicate the work." />
          <PointCard
            icon={ShieldAlert}
            title="Unverified output"
            detail="A claim travels downstream before anything checks it."
          />
          <PointCard icon={Server} title="Unsafe side effects" detail="Agents touch real systems with no isolation." />
          <PointCard icon={Eye} title="No trace" detail="Nobody can say which step produced a wrong answer." />
        </ul>
      ),
    },
    {
      id: "product",
      kicker: "What it does",
      title: "One question, a cited memo, and the map behind it",
      body: "The memo comes back with a short answer, the authorities it relies on and a caveat. Every citation resolves to a real jurisdiction, and the graph behind it is this large:",
      visual: (
        <>
          <StatRow columns="grid-cols-2 sm:grid-cols-4" stats={figures} />
          <p className="mt-2 text-xs text-muted-foreground">
            Read from this server's stack, or the product's own snapshot figures where the stack has not reported them.
          </p>
        </>
      ),
    },
    {
      id: "map",
      kicker: "The map",
      title: "Every authority, at the court that decided it",
      body: "Each citation becomes a pin over the map, with a county layer for Colorado. The arcs show which authorities the memo leans on, so you can see whether a claim rests on one line of cases or on many.",
      visual: (
        <>
          <DeckMap className="overflow-hidden rounded-lg border border-border" />
          <p className="mt-2 text-xs text-muted-foreground">
            Seven Colorado counties, drawn from the same geometry the live map uses.
          </p>
        </>
      ),
    },
    {
      id: "pipeline",
      kicker: "How it works",
      title: "Four agents, and a trace you can read",
      body: "A planner splits the question, a retriever expands the graph, a writer drafts the memo, and a safeguard checks each cited authority. Every step is recorded with the time it happened and the gap before it.",
      visual: <FlowDiagram caption="One run, start to spoken answer" steps={flow} />,
    },
    {
      id: "exchange",
      kicker: "A real run",
      title: "Ask, then follow up",
      body: exchange.fromSavedRun
        ? `Read back from saved run ${exchange.runId}. The follow-up is its own run, so it carries its own answer and its own check.`
        : "The product's demo exchange. Ask your own question on Home and this slide fills with your run.",
      visual: (
        <>
          <StatRow columns="grid-cols-3" stats={runFigures} />
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <div className="min-w-0 rounded-lg border border-border bg-card p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Asked</p>
              <p className="mt-1 break-words text-sm font-medium">{exchange.question}</p>
              <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Short answer
              </p>
              <p className="mt-1 break-words text-sm leading-relaxed">{exchange.answer}</p>
            </div>
            <div className="min-w-0 rounded-lg border border-border bg-card p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Follow-up</p>
              <p className="mt-1 break-words text-sm font-medium">{exchange.followUp ?? "No follow-up recorded"}</p>
              <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Answer</p>
              {exchange.followUpAnswer ? (
                <p className="mt-1 break-words text-sm leading-relaxed">{exchange.followUpAnswer}</p>
              ) : (
                <p className="mt-1 break-words text-sm leading-relaxed text-muted-foreground">
                  No saved run answers this follow-up yet.{" "}
                  <Link to="/" onClick={(event) => event.stopPropagation()} className="underline underline-offset-2">
                    Ask it on Home
                  </Link>
                  .
                </p>
              )}
            </div>
          </div>
        </>
      ),
    },
    {
      id: "trust",
      kicker: "Trust and verification",
      title: "Nothing in the memo is beyond inspection",
      body: "The safeguard rejects any authority that was not retrieved, quotes are copied verbatim, and every step is traceable afterwards.",
      visual: (
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <PointCard
            icon={ShieldCheck}
            title="Safeguard"
            detail="An authority that was never retrieved fails the run."
          />
          <PointCard icon={Quote} title="Verbatim quotes" detail="Quotes are copied from the passage, not paraphrased." />
          <PointCard icon={ListChecks} title="Audit trail" detail="Every run is a record with an ordered event log." />
          <PointCard icon={Activity} title="Arize evals" detail="Citation-guard and groundedness on every trace." />
        </ul>
      ),
    },
    {
      id: "partners",
      kicker: "Built with",
      title: "Seven partners, one pipeline",
      body: "Each failure mode is answered by a partner, and every partner runs in the same sandbox.",
      visual: (
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {PARTNERS.map((partner) => (
            <PointCard key={partner.name} icon={partner.icon} title={partner.name} detail={partnerHow(partner)} />
          ))}
        </ul>
      ),
    },
    {
      id: "close",
      kicker: "Thank you",
      title: "Ask your own question",
      body: "Open the composer, ask something in your own words, and the memo, the map and the trace come back with it.",
      visual: (
        <>
          <StatRow
            columns="grid-cols-3"
            stats={[
              { value: "1", label: "question starts a run" },
              { value: "4", label: "agents record every step" },
              { value: "7", label: "partners in the stack" },
            ]}
          />
          <Link
            to="/"
            onClick={(event) => event.stopPropagation()}
            className={cn(controlClass, "mt-3 border-transparent bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground")}
          >
            Open the live demo
          </Link>
        </>
      ),
    },
  ];

  const total = slides.length;

  const go = useCallback(
    (delta: number) => setIndex((current) => Math.min(slides.length - 1, Math.max(0, current + delta))),
    [slides.length],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight") {
        event.preventDefault();
        go(1);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        go(-1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  const slide = slides[Math.min(index, total - 1)];

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-background text-foreground">
      <SiteHeader />
      <main className="flex min-h-0 flex-1 flex-col">
        <div onClick={() => go(1)} className="min-h-0 min-w-0 flex-1 cursor-pointer overflow-y-auto">
          <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col justify-center px-4 py-6 sm:px-6 sm:py-8">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {index + 1} · {slide.kicker}
            </p>
            <h1 className="mt-2 break-words text-2xl font-semibold leading-tight tracking-tight sm:text-3xl lg:text-4xl">
              {slide.title}
            </h1>
            {slide.body && (
              <p className="mt-3 max-w-3xl break-words text-sm leading-relaxed text-muted-foreground sm:text-base">
                {slide.body}
              </p>
            )}
            <div className="mt-4 min-w-0">{slide.visual}</div>
          </div>
        </div>

        <div className="shrink-0 border-t border-border bg-card">
          <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-2 px-4 py-3 sm:px-6">
            <button type="button" className={controlClass} onClick={() => go(-1)} disabled={index === 0}>
              Previous slide
            </button>
            <button type="button" className={controlClass} onClick={() => go(1)} disabled={index === total - 1}>
              Next slide
            </button>
            <span aria-live="polite" className="px-1 text-sm font-medium tabular-nums text-muted-foreground">
              Slide {index + 1} of {total}
            </span>
            <Link
              to="/"
              className={cn(
                controlClass,
                "ml-auto border-transparent bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground",
              )}
            >
              Ask your own question
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
