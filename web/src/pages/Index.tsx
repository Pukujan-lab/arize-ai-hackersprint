import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { MoreHorizontal } from "lucide-react";
import MapPane from "@/components/MapPane";
import Memo from "@/components/Memo";
import SiteHeader from "@/components/SiteHeader";
import SourcesPanel from "@/components/SourcesPanel";
import type { RunResult } from "@/lib/citations";
import { isCache, readJson, toRuns, whenLabel, type SavedRun } from "@/lib/runs";
import { cn } from "@/lib/utils";
import { installDebug } from "@/map/debug";
import { MapEngine, type MapView, type PipelineStage } from "@/map/engine";

type Pane = "memo" | "map";

const buttonClass =
  "h-11 rounded-md border border-border px-3 text-xs font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50";

const menuItemClass =
  "flex h-11 w-full items-center rounded-sm px-2 text-left text-xs font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground";

const POLL_MS = 1000;
const RUN_TIMEOUT_MS = 90_000;

/** Where a dismissed getting-started cue is remembered, so a later visit is not greeted again. */
const STARTED_KEY = "precedent_getting_started";

/** Three questions a first-time reader can send as they stand. */
const EXAMPLES = [
  "Which Colorado counties apply the homestead exemption to mineral rights?",
  "Does a severed mineral estate keep the homestead exemption?",
  "How does a bankruptcy estate treat a Colorado homestead exemption?",
];

/** What each agent's step is called while the run is working. */
const STAGES: Record<string, string> = {
  planner: "Planning the run",
  retriever: "Retrieving authorities",
  answer: "Writing the answer",
  safeguard: "Checking the citations",
};

type RunTick = { events?: unknown[]; result?: RunResult | null; partial?: string | null };

type Progress = { stage: string; detail: string; draft: string };

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The stage the pipeline has reached, from the events the run endpoint reports. */
function stageOf(events: unknown): { stage: string; detail: string } {
  const list = Array.isArray(events)
    ? events.filter((event): event is Record<string, unknown> => !!event && typeof event === "object")
    : [];
  const last = list[list.length - 1];
  const agent = typeof last?.agent === "string" ? last.agent.trim() : "";
  const kind = typeof last?.kind === "string" ? last.kind.trim() : "";
  const msg = typeof last?.msg === "string" ? last.msg.trim() : "";
  const stage = STAGES[agent.toLowerCase()] || (agent ? `${agent}${kind ? ` · ${kind}` : ""}` : STAGES.planner);
  return { stage, detail: msg };
}

/** The four stages a run reports, in the order the pipeline runs them. */
const STAGE_PLAN = ["planner", "retriever", "answer", "safeguard"];
/** A stage that reports one of these has finished its work. */
const STAGE_DONE = /^(done|release|pass|complete|finished)$/i;

/**
 * The pipeline as the run's own events report it: a stage is running from its first event and done
 * once a later stage starts, or once it reports itself finished. A stage that never reported is not
 * listed — the map shows what the run did, not what it might have done.
 */
function pipelineFrom(events: unknown): PipelineStage[] {
  const list = Array.isArray(events)
    ? events.filter((event): event is Record<string, unknown> => !!event && typeof event === "object")
    : [];
  const stages: PipelineStage[] = [];
  for (const event of list) {
    const name = String(event.agent || "").trim().toLowerCase();
    if (!STAGE_PLAN.includes(name)) continue;
    const kind = String(event.kind || "").trim();
    const message = typeof event.msg === "string" ? event.msg.trim() : "";
    let stage = stages.find((entry) => entry.name === name);
    if (!stage) {
      // A stage that has started has ended every stage that began before it.
      for (const earlier of stages) if (earlier.state === "running") earlier.state = "done";
      stage = { name, state: "running" as const, message };
      stages.push(stage);
    } else if (message) {
      stage.message = message;
    }
    if (STAGE_DONE.test(kind)) stage.state = "done";
  }
  return stages;
}

/** A run that produced an answer ran every stage of the pipeline. */
function pipelineDone(): PipelineStage[] {
  return STAGE_PLAN.map((name) => ({ name, state: "done" as const, message: "" }));
}

/** How the answer was produced: the citation check, how long it took, and where it came from. */
function answerFacts(result: RunResult | null) {
  const guard = result?.safeguard;
  const pass = guard && typeof guard.pass === "boolean" ? guard.pass : null;
  const verified = guard && Array.isArray(guard.used) ? guard.used.length : null;
  const elapsed = typeof result?.elapsed_s === "number" && Number.isFinite(result.elapsed_s) ? result.elapsed_s : null;
  const provider = (result?.provider || "").trim();
  const source = !provider
    ? "not recorded"
    : isCache(provider)
      ? "cache"
      : /template/i.test(provider)
        ? "offline template"
        : provider;
  return {
    check: pass === null ? "Citation check not recorded" : pass ? "Citation check passed" : "Citation check failed",
    verified,
    elapsed,
    source,
  };
}

function cueDismissed(): boolean {
  try {
    return localStorage.getItem(STARTED_KEY) === "dismissed";
  } catch {
    return false;
  }
}

/**
 * Read a run until the server has written its result, reporting every tick on the way: the events
 * say which stage the pipeline has reached and `partial` is the answer as it is being written.
 *
 * `/api/ask` only starts the four agents and answers with a run id at once; the result lands several
 * seconds later. Reading the run once would always miss it, so keep asking until it is there.
 */
async function loadRun(
  runId: string,
  onTick: (tick: RunTick) => void,
  { quietMeansEmpty = false }: { quietMeansEmpty?: boolean } = {},
): Promise<RunResult | null> {
  const deadline = Date.now() + RUN_TIMEOUT_MS;
  for (;;) {
    let data: RunTick | null = null;
    try {
      const response = await fetch(`/api/run/${encodeURIComponent(runId)}`, { cache: "no-store" });
      if (response.ok) {
        try {
          data = (await response.json()) as RunTick;
        } catch {
          // A page rather than run data: this address has no run to read, and waiting will not help.
          if (quietMeansEmpty) return null;
        }
      }
    } catch {
      // A blip mid-run must not lose an answer the agents are still writing: fall through and retry.
    }
    if (data) {
      onTick(data);
      if (data.result) return data.result;
      // An address the server has never written a run for has no events and no draft: it is empty,
      // not late. A run that is still working always reports at least one of the two.
      if (quietMeansEmpty && !data.partial && !(data.events && data.events.length)) return null;
    } else if (quietMeansEmpty) {
      return null;
    }
    if (Date.now() >= deadline) return null;
    await sleep(POLL_MS);
  }
}

export default function Index({ initialPane = "memo" }: { initialPane?: Pane }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const runParam = searchParams.get("run");

  const engineRef = useRef<MapEngine | null>(null);
  if (!engineRef.current) engineRef.current = new MapEngine();
  const engine = engineRef.current;

  const [view, setView] = useState<MapView>(() => engine.view());
  const [pane, setPane] = useState<Pane>(initialPane);
  const [result, setResult] = useState<RunResult | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "empty" | "error">("idle");
  const [notice, setNotice] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [asking, setAsking] = useState(false);
  const [question, setQuestion] = useState("");
  const [needsQuestion, setNeedsQuestion] = useState(false);
  const [prevRunId, setPrevRunId] = useState<string | null>(null);
  /** The question this memo was asked as a follow-up to, so the memo can say so. */
  const [followUpTo, setFollowUpTo] = useState<string | null>(null);
  /** The saved run the map should speak on its own, once and only when it is opened from an address. */
  const [autoSpeakFor, setAutoSpeakFor] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [followUpsOpen, setFollowUpsOpen] = useState(false);
  const [runInfoOpen, setRunInfoOpen] = useState(false);
  const [savedOpen, setSavedOpen] = useState(false);
  const [savedRuns, setSavedRuns] = useState<SavedRun[]>([]);
  const [savedPhase, setSavedPhase] = useState<"idle" | "loading" | "error">("idle");
  const [cueGone, setCueGone] = useState(cueDismissed);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    engine.onChange = () => setView(engine.view());
    installDebug(engine);
  }, [engine]);

  useEffect(() => {
    setPane(initialPane);
  }, [initialPane]);

  useEffect(() => {
    engine.setPane(pane);
  }, [engine, pane]);

  useEffect(() => {
    return () => engine.detach();
  }, [engine]);

  // The memo drawer and the saved-run panel close on Escape, and on a click outside the drawer.
  useEffect(() => {
    if (!menuOpen && !sourcesOpen && !savedOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMenuOpen(false);
      setSourcesOpen(false);
      setSavedOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen, sourcesOpen, savedOpen]);

  // Escape always stops the voice and the walk, wherever the reader is on the page.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") engine.stopAll();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [engine]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (menuRef.current && target && menuRef.current.contains(target)) return;
      setMenuOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [menuOpen]);

  useEffect(() => {
    if (!savedOpen) return;
    let cancelled = false;
    setSavedPhase("loading");
    readJson("/api/runs")
      .then((raw) => {
        if (cancelled) return;
        setSavedRuns(toRuns(raw));
        setSavedPhase("idle");
      })
      .catch(() => {
        if (cancelled) return;
        setSavedRuns([]);
        setSavedPhase("error");
      });
    return () => {
      cancelled = true;
    };
  }, [savedOpen]);

  const applyResult = useCallback(
    (next: RunResult, runId: string) => {
      setResult(next);
      setPrevRunId(runId);
      // A run that came back ran every stage; a run served from a cache is a replay of that work.
      engine.setPipeline(pipelineDone(), isCache(next.provider || ""));
      engine.setCites(next.citations || [], next.edges || [], {
        question: next.question || "",
        answer: next.answer || "",
      });
    },
    [engine],
  );

  /**
   * Opening a saved run on the map speaks its summary and then walks the memo, unless the reader has
   * already taken the map in hand or silenced the voice.
   */
  useEffect(() => {
    if (!autoSpeakFor) return;
    let done = false;
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      if (done) return;
      if (!engine.ready && Date.now() - startedAt < 8000) return;
      done = true;
      window.clearInterval(timer);
      if (engine.interacted || engine.narrating || engine.muted) return;
      // The walk opens at the top of the memo, so the summary is its first stop rather than a
      // separate announcement before it.
      engine.startTour(0, { prologue: true });
    }, 250);
    return () => {
      done = true;
      window.clearInterval(timer);
    };
  }, [autoSpeakFor, engine]);

  useEffect(() => {
    if (!runParam) return;
    let cancelled = false;
    setStatus("loading");
    setNotice(null);
    setFollowUpTo(null);
    setProgress({ stage: "Opening the run", detail: "", draft: "" });
    engine.setPipeline([], false);
    loadRun(
      runParam,
      (tick) => {
        if (cancelled) return;
        setProgress({ ...stageOf(tick.events), draft: tick.partial || "" });
        engine.setPipeline(pipelineFrom(tick.events), false);
      },
      { quietMeansEmpty: true },
    )
      .then((payload) => {
        if (cancelled) return;
        if (!payload) {
          setStatus("empty");
          return;
        }
        applyResult(payload, runParam);
        setStatus("idle");
        // A saved run opened on the map is read aloud: the summary first, then the walk.
        if (initialPane === "map") setAutoSpeakFor(runParam);
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      })
      .finally(() => {
        if (!cancelled) setProgress(null);
      });
    return () => {
      cancelled = true;
    };
  }, [runParam, applyResult, engine, initialPane]);

  /**
   * Ask one question. With a run open the question is a follow-up and carries that run as its
   * context, so the answer knows what it is following on from.
   */
  const askQuestion = async (text: string) => {
    const asked = text.trim();
    if (!asked) {
      setNeedsQuestion(true);
      return;
    }
    if (asking) return;
    const context = prevRunId;
    const followed = context ? result?.question || "" : "";
    setNeedsQuestion(false);
    setAsking(true);
    setStatus("loading");
    setNotice(null);
    setFollowUpsOpen(false);
    setProgress({ stage: STAGES.planner, detail: "", draft: "" });
    engine.setPipeline([], false);
    try {
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(context ? { question: asked, prev_run_id: context } : { question: asked }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data || !data.run_id) {
        // A refused question keeps the server's own reason: a rate limit says when to try again.
        const reason = typeof data?.error === "string" ? data.error.trim() : "";
        setNotice(reason || null);
        setStatus("error");
        return;
      }
      const payload = await loadRun(data.run_id, (tick) => {
        setProgress({ ...stageOf(tick.events), draft: tick.partial || "" });
        engine.setPipeline(pipelineFrom(tick.events), false);
      });
      if (!payload) {
        setNotice("That run is taking longer than expected. Please try again.");
        setStatus("error");
        return;
      }
      applyResult(payload, data.run_id);
      setFollowUpTo(context ? followed : null);
      setStatus("idle");
      engine.listen();
    } catch {
      setStatus("error");
    } finally {
      setAsking(false);
      setProgress(null);
    }
  };

  const ask = (event: React.FormEvent) => {
    event.preventDefault();
    void askQuestion(question);
  };

  const dismissCue = () => {
    setCueGone(true);
    try {
      localStorage.setItem(STARTED_KEY, "dismissed");
    } catch {
      // Private mode or a full quota: the cue stays dismissed for this visit.
    }
  };

  const chooseExample = (text: string) => {
    setQuestion(text);
    setNeedsQuestion(false);
    inputRef.current?.focus();
  };

  const openSaved = (runId: string) => {
    setSavedOpen(false);
    const next = new URLSearchParams(searchParams);
    next.set("run", runId);
    setSearchParams(next);
  };

  const memo = (result && result.answer) || "";
  const citations = result?.citations || [];
  const followUps = result?.followups || [];
  const facts = answerFacts(result);

  // The memo controls sit at the top of the memo pane at every width; the body is what the pane
  // switch hides on a phone, so the controls stay reachable while the map is showing.
  const memoBodyHidden = pane !== "memo";

  const actions: { label: string; run: () => void }[] = [
    { label: "Sources", run: () => setSourcesOpen(true) },
    { label: "Follow-ups", run: () => setFollowUpsOpen(true) },
    { label: "Run info", run: () => setRunInfoOpen(true) },
    {
      label: "Follow-up",
      run: () => {
        setFollowUpsOpen(true);
        inputRef.current?.focus();
      },
    },
    {
      label: "New question",
      run: () => {
        // A new question starts from nothing: no run to follow on from, and no memo to read.
        engine.stopAll();
        engine.setCites([], [], {});
        engine.setPipeline([], false);
        setResult(null);
        setPrevRunId(null);
        setFollowUpTo(null);
        setQuestion("");
        setNotice(null);
        setNeedsQuestion(false);
        setStatus("idle");
        const next = new URLSearchParams(searchParams);
        next.delete("run");
        setSearchParams(next, { replace: true });
        inputRef.current?.focus();
      },
    },
  ];

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-background text-foreground">
      <SiteHeader />
      <main className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[auto_minmax(0,1fr)_auto] lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="col-start-1 row-start-1 shrink-0 border-b border-border px-3 py-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <h1 className="mr-auto text-sm font-semibold">Memo</h1>
            <button type="button" className={buttonClass} onClick={() => setSavedOpen(true)}>
              Open a saved run
            </button>
            <button type="button" className={buttonClass} onClick={() => engine.listen()} disabled={!memo}>
              {view.narrating ? "Stop listening" : "Listen"}
            </button>
            {memo && (
              <button type="button" className={buttonClass} onClick={() => engine.setMuted(!view.muted)}>
                {view.muted ? "Unmute" : "Mute"}
              </button>
            )}
            {view.loading && (
              <span role="status" aria-label="Audio loading" className="text-xs text-muted-foreground">
                Audio loading…
              </span>
            )}
            {memo && (
              <div className="relative" ref={menuRef}>
                <button
                  type="button"
                  aria-label="Memo menu"
                  aria-haspopup="true"
                  aria-expanded={menuOpen}
                  className="grid h-11 w-11 place-items-center rounded-md border border-border text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                  onClick={() => setMenuOpen((open) => !open)}
                >
                  <MoreHorizontal aria-hidden="true" className="h-5 w-5" />
                </button>
                {menuOpen && (
                  <div className="absolute right-0 top-full z-30 mt-1 w-48 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg">
                    {actions.map((action) => (
                      <button
                        key={action.label}
                        type="button"
                        className={menuItemClass}
                        onClick={() => {
                          setMenuOpen(false);
                          action.run();
                        }}
                      >
                        {action.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {pane === "memo" && (
              <button type="button" className={cn(buttonClass, "lg:hidden")} onClick={() => setPane("map")}>
                Show map
              </button>
            )}
          </div>
        </div>

        <section
          className={cn(
            "col-start-1 row-start-2 min-h-0 min-w-0 overflow-y-auto px-4 py-3",
            memoBodyHidden && "invisible lg:visible",
          )}
        >
          {(notice || status === "error") && (
            <p
              role="status"
              className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-foreground"
            >
              {notice || "That question didn't come back. Please try again."}
            </p>
          )}

          {needsQuestion && (
            <p
              role="alert"
              aria-label="Question needed"
              className="mb-3 max-w-[70ch] rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground"
            >
              Type a question first — the memo needs one.
            </p>
          )}

          {status === "loading" && (
            <section
              aria-label="Run progress"
              className="mb-3 max-w-[70ch] rounded-md border border-border bg-card/60 px-3 py-2"
            >
              <p role="status" className="text-sm font-medium">
                {progress?.stage || STAGES.planner}
              </p>
              {progress?.detail ? <p className="mt-0.5 text-xs text-muted-foreground">{progress.detail}</p> : null}
              {progress?.draft ? (
                <div className="mt-2 border-t border-border pt-2">
                  <p className="text-xs text-muted-foreground">Draft, as it is written</p>
                  <div className="mt-1">
                    <Memo answer={progress.draft} citations={[]} />
                  </div>
                </div>
              ) : null}
            </section>
          )}

          {memo ? (
            <>
              {followUpTo !== null && (
                <p
                  role="note"
                  aria-label="Answered a follow-up"
                  className="mb-3 max-w-[70ch] rounded-md border border-border bg-card/60 px-3 py-2 text-xs text-muted-foreground"
                >
                  Answered a follow-up{followUpTo ? ` to “${followUpTo}”` : ""} — this run carries the
                  previous answer as its context.
                </p>
              )}
              <div
                role="note"
                aria-label="Answer status"
                className="mb-3 flex max-w-[70ch] flex-wrap gap-x-4 gap-y-0.5 rounded-md border border-border bg-card/60 px-3 py-2 text-xs text-muted-foreground"
              >
                <span className="font-medium text-foreground">{facts.check}</span>
                <span>References verified: {facts.verified === null ? "not recorded" : facts.verified}</span>
                <span>Run time: {facts.elapsed === null ? "not recorded" : `${facts.elapsed.toFixed(1)} s`}</span>
                <span>Answer source: {facts.source}</span>
              </div>
              <Memo answer={memo} citations={citations} />
            </>
          ) : (
            <>
              {!cueGone && status !== "loading" && (
                <section
                  aria-label="Getting started"
                  className="mb-4 max-w-[70ch] rounded-lg border border-border bg-card p-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="mr-auto text-sm font-semibold">Getting started</h2>
                    <button type="button" className={buttonClass} onClick={dismissCue}>
                      Dismiss getting started
                    </button>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Ask a legal question, or start from one of these.
                  </p>
                  <ul className="mt-2 space-y-1.5">
                    {EXAMPLES.map((example) => (
                      <li key={example}>
                        <button
                          type="button"
                          className="flex min-h-[44px] w-full items-center rounded-md border border-border px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                          onClick={() => chooseExample(example)}
                        >
                          {example}
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {(status === "idle" || status === "empty") && (
                <p className="max-w-[70ch] text-sm text-muted-foreground">
                  {status === "empty"
                    ? "This run has no memo yet. Ask a question to start one."
                    : "Ask a legal question and the memo it returns appears here, with the map of every authority behind it."}
                </p>
              )}
            </>
          )}

          {followUpsOpen && (
            <section className="mt-4 max-w-[70ch] rounded-md border border-border p-3">
              <h2 className="text-sm font-semibold text-muted-foreground">Follow-ups</h2>
              {followUps.length ? (
                <ul className="mt-2 space-y-1 text-sm">
                  {followUps.map((item) => (
                    <li key={item}>
                      <button
                        type="button"
                        className="flex min-h-[44px] w-full items-center rounded-md border border-border px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                        onClick={() => void askQuestion(item)}
                      >
                        {item}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">No follow-up questions were recorded for this run.</p>
              )}
            </section>
          )}

          {runInfoOpen && (
            <section className="mt-4 max-w-[70ch] rounded-md border border-border p-3 text-sm">
              <h2 className="text-sm font-semibold text-muted-foreground">Run info</h2>
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                <dt className="text-muted-foreground">Run being read</dt>
                <dd className="font-mono text-xs">{prevRunId || "—"}</dd>
                <dt className="text-muted-foreground">Question</dt>
                <dd>{result?.question || "—"}</dd>
                <dt className="text-muted-foreground">Authorities</dt>
                <dd>{citations.length}</dd>
                <dt className="text-muted-foreground">Links</dt>
                <dd>{engine.summary()}</dd>
              </dl>
            </section>
          )}
        </section>

        {sourcesOpen && <SourcesPanel citations={citations} onClose={() => setSourcesOpen(false)} />}

        {savedOpen && (
          <div role="dialog" aria-label="Saved runs" className="fixed inset-0 z-50 flex flex-col bg-background px-4 py-3">
            <div className="flex shrink-0 items-center gap-2">
              <h2 className="mr-auto text-sm font-semibold">Saved runs</h2>
              <button type="button" className={buttonClass} onClick={() => setSavedOpen(false)}>
                Close
              </button>
            </div>
            <div className="mx-auto mt-3 min-h-0 w-full max-w-[70ch] flex-1 overflow-y-auto">
              {savedPhase === "loading" && <p className="text-sm text-muted-foreground">Reading your saved runs…</p>}
              {savedPhase === "error" && (
                <p className="text-sm text-muted-foreground">
                  Your saved runs are unavailable right now. Ask a question to start a new one.
                </p>
              )}
              {savedPhase === "idle" && !savedRuns.length && (
                <p className="text-sm text-muted-foreground">No saved runs yet. Ask a question and it appears here.</p>
              )}
              {!!savedRuns.length && (
                <ul className="space-y-2">
                  {savedRuns.map((run) => {
                    const meta = [
                      run.n === null ? "" : `${run.n} ${run.n === 1 ? "authority" : "authorities"}`,
                      run.ts ? whenLabel(run.ts) : "",
                    ]
                      .filter(Boolean)
                      .join(" · ");
                    return (
                      <li key={run.run_id}>
                        <button
                          type="button"
                          className="flex min-h-[44px] w-full items-center rounded-md border border-border px-3 py-2 text-left text-sm font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                          onClick={() => openSaved(run.run_id)}
                        >
                          {run.question}
                        </button>
                        {meta && <p className="mt-0.5 text-xs text-muted-foreground">{meta}</p>}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        )}

        <MapPane
          engine={engine}
          view={view}
          pane={pane}
          citations={citations}
          source={facts.source}
          working={status === "loading"}
          onShowMemo={() => setPane("memo")}
        />

        <form
          onSubmit={ask}
          className="col-start-1 row-start-3 flex items-center gap-1.5 border-t border-border bg-card px-3 py-2 lg:col-span-2"
        >
          <input
            ref={inputRef}
            aria-label="Ask a question"
            value={question}
            onChange={(event) => {
              setQuestion(event.target.value);
              if (event.target.value.trim()) setNeedsQuestion(false);
            }}
            placeholder={memo ? "Ask a follow-up question" : "Ask a legal question"}
            className="h-11 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground"
          />
          <button
            type="submit"
            disabled={asking}
            className="h-11 shrink-0 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:pointer-events-none disabled:opacity-50"
          >
            Ask
          </button>
        </form>
      </main>
    </div>
  );
}
