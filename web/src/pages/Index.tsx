import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { MoreHorizontal } from "lucide-react";
import MapPane from "@/components/MapPane";
import Memo, { sourceHref } from "@/components/Memo";
import SiteHeader from "@/components/SiteHeader";
import type { Citation, RunResult } from "@/lib/citations";
import { cn } from "@/lib/utils";
import { installDebug } from "@/map/debug";
import { MapEngine, type MapView } from "@/map/engine";

type Pane = "memo" | "map";

const buttonClass =
  "h-11 rounded-md border border-border px-3 text-xs font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50";

const menuItemClass =
  "flex h-11 w-full items-center rounded-sm px-2 text-left text-xs font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground";

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
  const [menuOpen, setMenuOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [followUpsOpen, setFollowUpsOpen] = useState(false);
  const [runInfoOpen, setRunInfoOpen] = useState(false);
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

  // The memo drawer closes on Escape and on a click outside it; the source list closes on Escape.
  useEffect(() => {
    if (!menuOpen && !sourcesOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMenuOpen(false);
      setSourcesOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen, sourcesOpen]);

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
        if (cancelled) return;
        if (import.meta.env.DEV) {
          void import("@/lib/demo-run").then((mod) => {
            if (cancelled) return;
            applyResult(mod.DEMO_RUN as unknown as RunResult, runParam);
            setStatus("idle");
            const probe = new URLSearchParams(window.location.search).get("probe");
            if (probe === "county") setTimeout(() => engine.zoomToCounty("boulder"), 400);
            if (probe === "court") setTimeout(() => engine.zoomToCourt(7), 400);
            if (probe === "menu") setTimeout(() => setMenuOpen(true), 400);
            if (probe === "listen") setTimeout(() => engine.listen(), 400);
          });
          return;
        }
        setStatus("error");
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
      engine.listen();
    } catch {
      setStatus("error");
    } finally {
      setAsking(false);
    }
  };

  const memo = (result && result.answer) || "";
  const citations = result?.citations || [];
  const followUps = (result as (RunResult & { followups?: string[] }) | null)?.followups || [];

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
        setPrevRunId(null);
        setQuestion("");
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
            <button
              type="button"
              className={buttonClass}
              onClick={() => engine.listen()}
              disabled={!memo}
            >
              {view.narrating ? "Stop listening" : "Listen"}
            </button>
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
          {status === "loading" && (
            <p role="status" className="mb-3 text-sm text-muted-foreground">
              The four agents are working on this. The memo appears here as soon as they finish.
            </p>
          )}
          {memo ? (
            <Memo answer={memo} citations={citations} />
          ) : (
            (status === "idle" || status === "empty") && (
              <p className="max-w-[70ch] text-sm text-muted-foreground">
                {status === "empty"
                  ? "This run has no memo yet. Ask a question to start one."
                  : "Ask a legal question and the memo it returns appears here, with the map of every authority behind it."}
              </p>
            )
          )}

          {followUpsOpen && (
            <section className="mt-4 max-w-[70ch] rounded-md border border-border p-3">
              <h2 className="text-sm font-semibold text-muted-foreground">Follow-ups</h2>
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
            <section className="mt-4 max-w-[70ch] rounded-md border border-border p-3 text-sm">
              <h2 className="text-sm font-semibold text-muted-foreground">Run info</h2>
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
        </section>

        {sourcesOpen && (
          <div role="dialog" aria-label="Sources" className="fixed inset-0 z-40 flex flex-col bg-background px-4 py-3">
            <div className="flex shrink-0 items-center gap-2">
              <h2 className="mr-auto text-sm font-semibold">Sources</h2>
              <button type="button" className={buttonClass} onClick={() => setSourcesOpen(false)}>
                Close
              </button>
            </div>
            <ul className="mx-auto mt-3 min-h-0 w-full max-w-[70ch] flex-1 space-y-2 overflow-y-auto">
              {citations.map((citation, index) => (
                <li key={`${citation.id}-${index}`}>
                  <a
                    href={sourceHref(citation)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block rounded-md border border-border px-3 py-2 text-sm text-foreground underline-offset-2 hover:bg-accent hover:underline"
                  >
                    <span className="font-medium">{citation.title || citation.citation || "Authority"}</span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {[citation.citation, citation.court, citation.date].filter(Boolean).join(" · ") || "Citation not recorded"}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}

        <MapPane engine={engine} view={view} pane={pane} onShowMemo={() => setPane("memo")} />

        <form
          onSubmit={ask}
          className="col-start-1 row-start-3 flex items-center gap-1.5 border-t border-border bg-card px-3 py-2 lg:col-span-2"
        >
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
      </main>
    </div>
  );
}
