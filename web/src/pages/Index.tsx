import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import MapPane from "@/components/MapPane";
import SiteHeader from "@/components/SiteHeader";
import type { Citation, RunResult } from "@/lib/citations";
import { cn } from "@/lib/utils";
import { installDebug } from "@/map/debug";
import { MapEngine, type MapView } from "@/map/engine";

type Pane = "memo" | "map";

const SOURCE_SEARCH = "https://www.courtlistener.com/?q=";

/** Where a citation's original document lives, or a search for it on an external legal database. */
function sourceHref(citation: Citation): string {
  const url = (citation.url || "").trim();
  if (/^https?:\/\//i.test(url)) return url;
  return SOURCE_SEARCH + encodeURIComponent(citation.citation || citation.title || "legal authority");
}

const buttonClass =
  "h-11 rounded-md border border-border px-3 text-xs font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50";

const POLL_MS = 1000;
const RUN_TIMEOUT_MS = 90_000;

type RunResponse = { events?: unknown[]; result?: RunResult | null; partial?: string | null };

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Read a run until the server has written its result.
 *
 * `/api/ask` only starts the four agents and answers with a run id at once; the result lands several
 * seconds later. Reading the run once would always miss it, so keep asking until it is there.
 */
async function waitForRun(runId: string): Promise<RunResult | null> {
  const deadline = Date.now() + RUN_TIMEOUT_MS;
  for (;;) {
    try {
      const response = await fetch(`/api/run/${encodeURIComponent(runId)}`, { cache: "no-store" });
      if (response.ok) {
        const data: RunResponse | null = await response.json();
        if (data && data.result) return data.result;
      }
    } catch {
      // A blip mid-run must not lose an answer the agents are still writing: fall through and retry.
    }
    if (Date.now() >= deadline) return null;
    await sleep(POLL_MS);
  }
}

export default function Index({ initialPane = "memo" }: { initialPane?: Pane }) {
  const [searchParams] = useSearchParams();
  const runParam = searchParams.get("run");

  const engineRef = useRef<MapEngine | null>(null);
  if (!engineRef.current) engineRef.current = new MapEngine();
  const engine = engineRef.current;

  const [view, setView] = useState<MapView>(() => engine.view());
  const [pane, setPane] = useState<Pane>(initialPane);
  const [result, setResult] = useState<RunResult | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "empty" | "error">("idle");
  const [notice, setNotice] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [question, setQuestion] = useState("");
  const [prevRunId, setPrevRunId] = useState<string | null>(null);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [followUpsOpen, setFollowUpsOpen] = useState(false);
  const [runInfoOpen, setRunInfoOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

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

  useEffect(() => {
    if (!sourcesOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSourcesOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sourcesOpen]);

  const applyResult = useCallback(
    (next: RunResult, runId: string) => {
      setResult(next);
      setPrevRunId(runId);
      engine.setCites(next.citations || [], next.edges || [], {
        question: next.question || "",
        answer: next.answer || "",
      });
    },
    [engine],
  );

  useEffect(() => {
    if (!runParam) return;
    let cancelled = false;
    setStatus("loading");
    setNotice(null);
    fetch(`/api/run/${encodeURIComponent(runParam)}`)
      .then((response) => response.json())
      .then((data) => {
        if (cancelled) return;
        const payload: RunResult | null = data && data.result ? data.result : null;
        if (!payload) {
          setStatus("empty");
          return;
        }
        applyResult(payload, runParam);
        setStatus("idle");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [runParam, applyResult]);

  const ask = async (event: React.FormEvent) => {
    event.preventDefault();
    const text = question.trim();
    if (!text || asking) return;
    setAsking(true);
    setStatus("loading");
    setNotice(null);
    try {
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(prevRunId ? { question: text, prev_run_id: prevRunId } : { question: text }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data || !data.run_id) {
        // A refused question keeps the server's own reason: a rate limit says when to try again.
        const reason = typeof data?.error === "string" ? data.error.trim() : "";
        setNotice(reason || null);
        setStatus("error");
        return;
      }
      const payload = await waitForRun(data.run_id);
      if (!payload) {
        setNotice("That run is taking longer than expected. Please try again.");
        setStatus("error");
        return;
      }
      applyResult(payload, data.run_id);
      setStatus("idle");
      engine.narrateMemo(() => engine.startTour(0));
    } catch {
      setStatus("error");
    } finally {
      setAsking(false);
    }
  };

  const memo = (result && result.answer) || "";
  const citations = result?.citations || [];
  const followUps = (result as (RunResult & { followups?: string[] }) | null)?.followups || [];

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-background text-foreground">
      <SiteHeader />
      <main className="grid min-h-0 flex-1 grid-cols-1 grid-rows-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <section
          className={cn(
            "relative col-start-1 row-start-1 flex min-h-0 min-w-0 flex-col",
            pane !== "memo" && "invisible lg:visible",
          )}
        >
          <div className="shrink-0 border-b border-border px-3 py-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <h1 className="mr-auto text-sm font-semibold">Memo</h1>
              <button
                type="button"
                className={buttonClass}
                onClick={() => (view.narrating ? engine.stopListening() : engine.narrateMemo())}
                disabled={!memo}
              >
                {view.narrating ? "Stop listening" : "Listen"}
              </button>
              {memo && (
                <>
                  <button type="button" className={buttonClass} onClick={() => setSourcesOpen(true)}>
                    Sources
                  </button>
                  <button type="button" className={buttonClass} onClick={() => setFollowUpsOpen((open) => !open)}>
                    Follow-ups
                  </button>
                  <button type="button" className={buttonClass} onClick={() => setRunInfoOpen((open) => !open)}>
                    Run info
                  </button>
                  <button
                    type="button"
                    className={buttonClass}
                    disabled={asking}
                    onClick={() => {
                      inputRef.current?.focus();
                    }}
                  >
                    Follow-up
                  </button>
                  <button
                    type="button"
                    className={buttonClass}
                    onClick={() => {
                      setPrevRunId(null);
                      setQuestion("");
                      inputRef.current?.focus();
                    }}
                  >
                    New question
                  </button>
                </>
              )}
              <button
                type="button"
                className={cn(buttonClass, "lg:hidden")}
                onClick={() => setPane("map")}
              >
                Show map
              </button>
            </div>
            <form onSubmit={ask} className="mt-2 flex items-center gap-1.5">
              <input
                ref={inputRef}
                aria-label="Ask a question"
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                placeholder="Ask a legal question"
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
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            {(notice || status === "error") && (
              <p
                role="status"
                className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-foreground"
              >
                {notice || "That question didn't come back. Please try again."}
              </p>
            )}
            {status === "loading" && (
              <p role="status" className="mb-3 text-sm text-muted-foreground">
                The four agents are working on this. The memo appears here as soon as they finish.
              </p>
            )}
            {memo ? (
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{memo}</p>
            ) : (
              (status === "idle" || status === "empty") && (
                <p className="text-sm text-muted-foreground">
                  {status === "empty"
                    ? "This run has no memo yet. Ask a question to start one."
                    : "Ask a legal question and the memo it returns appears here, with the map of every authority behind it."}
                </p>
              )
            )}

            {followUpsOpen && (
              <section className="mt-4 rounded-md border border-border p-3">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Follow-ups</h2>
                {followUps.length ? (
                  <ul className="mt-2 space-y-1 text-sm">
                    {followUps.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-sm text-muted-foreground">No follow-up questions were recorded for this run.</p>
                )}
              </section>
            )}

            {runInfoOpen && (
              <section className="mt-4 rounded-md border border-border p-3 text-sm">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Run info</h2>
                <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                  <dt className="text-muted-foreground">Run</dt>
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
          </div>

          {sourcesOpen && (
            <div role="dialog" aria-label="Sources" className="absolute inset-0 z-30 flex flex-col bg-background/95 px-4 py-3">
              <div className="flex shrink-0 items-center gap-2">
                <h2 className="mr-auto text-sm font-semibold">Sources</h2>
                <button type="button" className={buttonClass} onClick={() => setSourcesOpen(false)}>
                  Close
                </button>
              </div>
              <ul className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto">
                {citations.map((citation, index) => (
                  <li key={`${citation.id}-${index}`} className="text-sm">
                    <a
                      href={sourceHref(citation)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block rounded-md border border-border px-3 py-2 text-foreground underline-offset-2 hover:bg-accent hover:underline"
                    >
                      <span className="font-medium">{citation.title || citation.citation || "Authority"}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {[citation.citation, citation.court, citation.date].filter(Boolean).join(" · ")}
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <MapPane engine={engine} view={view} pane={pane} onShowMemo={() => setPane("memo")} />
      </main>
    </div>
  );
}
