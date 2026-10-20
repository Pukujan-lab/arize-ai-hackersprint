// The specialised chat: one question, four agents, a memo with its authorities, and the retrieval
// record behind it. The evidence rail stays alongside the conversation, and every panel that shows
// more opens in a drawer.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowUp,
  CheckCircle2,
  Circle,
  Copy,
  FlaskConical,
  ListTree,
  Loader2,
  MapPin,
  MessagesSquare,
  Plus,
  Search,
  Sparkles,
  Volume2,
  VolumeX,
} from "lucide-react";
import AuthorityDetail from "@/components/AuthorityDetail";
import DetailDrawer from "@/components/DetailDrawer";
import Memo from "@/components/Memo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useNarration } from "@/hooks/use-narration";
import { AskRefused, STAGE_PLAN, STAGE_WORDS, ask, loadRunResult, type AskTick, type StageTick } from "@/lib/api";
import { citeType, courtName, type Citation, type RunResult } from "@/lib/citations";
import { SUGGESTIONS } from "@/lib/demo";
import { seconds, toRetrieval, type Retrieval } from "@/lib/runs";
import { cn } from "@/lib/utils";
import { showError, showSuccess } from "@/utils/toast";

type Turn =
  | { id: string; role: "user"; text: string }
  | { id: string; role: "assistant"; result: RunResult; runId: string; source: "live" | "sample" }
  | { id: string; role: "error"; text: string };

const EMPTY_STAGES: StageTick[] = STAGE_PLAN.map((name) => ({ name, state: "waiting", message: "" }));

let counter = 0;
const nextId = () => `t${(counter += 1)}`;

function StageRow({ stage }: { stage: StageTick }) {
  const Icon = stage.state === "done" ? CheckCircle2 : stage.state === "running" ? Loader2 : Circle;
  return (
    <li className="flex items-start gap-2">
      <Icon
        className={cn(
          "mt-0.5 h-3.5 w-3.5 shrink-0",
          stage.state === "done" && "text-emerald-500",
          stage.state === "running" && "animate-spin text-foreground motion-reduce:animate-none",
          stage.state === "waiting" && "text-muted-foreground/50",
        )}
      />
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block text-xs font-medium",
            stage.state === "waiting" ? "text-muted-foreground" : "text-foreground",
          )}
        >
          {STAGE_WORDS[stage.name]}
        </span>
        {stage.message && <span className="mt-0.5 block text-xs text-muted-foreground">{stage.message}</span>}
      </span>
    </li>
  );
}

function EvidenceList({ citations, onOpen }: { citations: Citation[]; onOpen: (index: number) => void }) {
  return (
    <ul className="space-y-1.5">
      {citations.map((citation, index) => (
        <li key={`${citation.id}-${index}`}>
          <button
            type="button"
            onClick={() => onOpen(index)}
            className="w-full rounded-lg border border-border bg-card px-2.5 py-2 text-left transition-colors hover:bg-accent/60"
          >
            <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-medium text-foreground">{citeType(citation)}</span>
              <span className="min-w-0 flex-1 truncate">{courtName(citation) || "Court not recorded"}</span>
            </span>
            <span className="mt-1 line-clamp-2 block text-sm font-medium leading-snug">
              {citation.title || citation.citation || "Authority"}
            </span>
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
              {[citation.citation, citation.date].filter(Boolean).join(" · ") || "Citation not recorded"}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export default function Chat() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<AskTick | null>(null);
  const [lastRunId, setLastRunId] = useState<string | null>(null);
  const [authority, setAuthority] = useState<Citation | null>(null);
  /** The sources drawer shows the turn it was opened from, not whichever turn is newest. */
  const [evidence, setEvidence] = useState<Citation[] | null>(null);
  const [record, setRecord] = useState<Retrieval | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const askedRef = useRef<string | null>(null);
  const openedRef = useRef<string | null>(null);
  const narration = useNarration();

  const askQuestion = useCallback(
    async (text: string) => {
      const asked = text.trim();
      if (!asked) return;
      setBusy(true);
      setDraft("");
      setProgress({ stage: STAGE_WORDS.planner, detail: "", draft: "", stages: EMPTY_STAGES.map((stage) => ({ ...stage })) });
      setTurns((current) => [...current, { id: nextId(), role: "user", text: asked }]);
      try {
        const { runId, result, source } = await ask(asked, {
          prevRunId: lastRunId,
          onTick: (tick) => setProgress(tick),
        });
        setLastRunId(runId);
        setTurns((current) => [...current, { id: nextId(), role: "assistant", result, runId, source }]);
      } catch (error) {
        const message =
          error instanceof AskRefused
            ? error.message
            : "That question didn't come back. The agents may still be working — try again in a moment.";
        setTurns((current) => [...current, { id: nextId(), role: "error", text: message }]);
      } finally {
        setBusy(false);
        setProgress(null);
      }
    },
    [lastRunId],
  );

  // A question handed over by the palette or the dashboard is asked once, then the address is tidied.
  useEffect(() => {
    const asked = (params.get("q") || "").trim();
    if (!asked || askedRef.current === asked) return;
    askedRef.current = asked;
    const next = new URLSearchParams(params);
    next.delete("q");
    setParams(next, { replace: true });
    void askQuestion(asked);
  }, [params, setParams, askQuestion]);

  // A saved run opened from the dashboard or the observatory is read into the conversation as it was.
  useEffect(() => {
    const runId = (params.get("run") || "").trim();
    if (!runId || openedRef.current === runId) return;
    openedRef.current = runId;
    void loadRunResult(runId).then(({ result, source }) => {
      if (!result) return;
      setLastRunId(runId);
      setTurns((current) => [...current, { id: nextId(), role: "assistant", result, runId, source }]);
    });
  }, [params]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    element.scrollTo({ top: element.scrollHeight, behavior: reduced ? "auto" : "smooth" });
  }, [turns.length, progress?.draft]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") narration.stop();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [narration.stop]);

  const latest = useMemo(() => {
    for (let index = turns.length - 1; index >= 0; index -= 1) {
      const turn = turns[index];
      if (turn.role === "assistant") return turn;
    }
    return null;
  }, [turns]);

  const citations: Citation[] = latest?.result.citations || [];
  const latestRecord = latest ? toRetrieval(latest.result.retrieval) : null;

  const submit = () => {
    if (busy || !draft.trim()) return;
    void askQuestion(draft);
  };

  const newChat = () => {
    narration.stop();
    setTurns([]);
    setDraft("");
    setLastRunId(null);
    setProgress(null);
    setParams(new URLSearchParams(), { replace: true });
    inputRef.current?.focus();
  };

  const copyAnswer = async (answer: string) => {
    try {
      await navigator.clipboard.writeText(answer);
      showSuccess("Memo copied");
    } catch {
      showError("The browser would not copy that");
    }
  };

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2">
          <h2 className="mr-auto text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {turns.length ? "Conversation" : "New conversation"}
          </h2>
          {!!citations.length && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 xl:hidden"
              onClick={() => setEvidence(citations)}
            >
              <ListTree className="h-4 w-4" />
              Evidence ({citations.length})
            </Button>
          )}
          <Button variant="ghost" size="sm" className="gap-1.5" onClick={newChat} disabled={!turns.length && !busy}>
            <Plus className="h-4 w-4" />
            New chat
          </Button>
        </div>

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[54rem] px-4 py-5">
            {!turns.length && !busy && (
              <div className="rounded-xl border border-border bg-card p-5">
                <span className="grid h-9 w-9 place-items-center rounded-md bg-primary text-primary-foreground">
                  <Sparkles className="h-4 w-4" />
                </span>
                <h2 className="mt-3 text-lg font-semibold tracking-tight">Ask a legal question</h2>
                <p className="mt-1 max-w-[60ch] text-sm leading-relaxed text-muted-foreground">
                  A planner picks the retrieval path, the retriever gathers authorities, the writer drafts a memo, and
                  the safeguard checks every reference. The memo arrives with its sources, its follow-ups, and a map of
                  where the law sits.
                </p>
                <ul className="mt-4 grid gap-1.5 sm:grid-cols-2">
                  {SUGGESTIONS.map((suggestion) => (
                    <li key={suggestion}>
                      <button
                        type="button"
                        onClick={() => void askQuestion(suggestion)}
                        className="flex h-full w-full items-start gap-2 rounded-lg border border-border px-3 py-2 text-left text-sm transition-colors hover:bg-accent/60"
                      >
                        <MessagesSquare className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0">{suggestion}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="space-y-6">
              {turns.map((turn) => {
                if (turn.role === "user") {
                  return (
                    <div key={turn.id} className="flex justify-end">
                      <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-secondary px-3.5 py-2 text-sm leading-relaxed text-secondary-foreground">
                        {turn.text}
                      </p>
                    </div>
                  );
                }
                if (turn.role === "error") {
                  return (
                    <div
                      key={turn.id}
                      role="alert"
                      className="rounded-lg border border-destructive/40 bg-destructive/10 px-3.5 py-2.5 text-sm"
                    >
                      {turn.text}
                    </div>
                  );
                }

                const result = turn.result;
                const answer = result.answer || "";
                const pass = result.safeguard?.pass ?? null;
                const elapsed = typeof result.elapsed_s === "number" ? result.elapsed_s : null;
                const followUps = result.followups || [];
                return (
                  <article key={turn.id} className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                      <span className="grid h-6 w-6 place-items-center rounded-full bg-primary text-primary-foreground">
                        <Sparkles className="h-3.5 w-3.5" />
                      </span>
                      <span className="font-semibold text-foreground">Precedent</span>
                      {turn.source === "sample" && (
                        <Badge variant="secondary" className="gap-1 px-1.5 py-0 text-[10px]">
                          <FlaskConical className="h-3 w-3" />
                          Sample
                        </Badge>
                      )}
                      {pass !== null && (
                        <span
                          className={cn(
                            "rounded-full border px-1.5 py-0.5 text-[10px] font-medium",
                            pass
                              ? "border-emerald-500/40 text-emerald-600 dark:text-emerald-400"
                              : "border-destructive/50 text-destructive",
                          )}
                        >
                          {pass ? "Citations checked" : "Citation check failed"}
                        </span>
                      )}
                      {elapsed !== null && <span className="tabular-nums">{seconds(elapsed)}</span>}
                      <span className="hidden truncate font-mono text-[10px] sm:inline">{turn.runId}</span>
                    </div>

                    {answer ? (
                      <div className="mt-2.5">
                        <Memo answer={answer} citations={result.citations || []} />
                      </div>
                    ) : (
                      <p className="mt-2 text-sm text-muted-foreground">The run recorded no answer.</p>
                    )}

                    <p className="mt-3 text-xs text-muted-foreground">
                      {result.safeguard?.disclaimer || "AI-generated research summary, not legal advice."}
                    </p>

                    {!!followUps.length && (
                      <div className="mt-3">
                        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Follow-ups
                        </h3>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {followUps.map((item) => (
                            <button
                              key={item}
                              type="button"
                              onClick={() => void askQuestion(item)}
                              disabled={busy}
                              className="max-w-full rounded-full border border-border px-2.5 py-1 text-left text-xs text-foreground transition-colors hover:bg-accent disabled:opacity-50"
                            >
                              {item}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="mt-3 flex flex-wrap items-center gap-1 border-t border-border pt-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="gap-1.5"
                        onClick={() => setEvidence(result.citations || [])}
                        disabled={!(result.citations || []).length}
                      >
                        <ListTree className="h-4 w-4" />
                        Sources ({(result.citations || []).length})
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="gap-1.5"
                        onClick={() => setRecord(toRetrieval(result.retrieval))}
                      >
                        <Search className="h-4 w-4" />
                        Retrieval
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="gap-1.5"
                        onClick={() => (narration.active ? narration.stop() : narration.speak(answer))}
                      >
                        {narration.active ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                        {narration.active ? "Stop" : "Read aloud"}
                      </Button>
                      <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => void copyAnswer(answer)}>
                        <Copy className="h-4 w-4" />
                        Copy
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="ml-auto gap-1.5"
                        onClick={() => navigate(`/explore?run=${encodeURIComponent(turn.runId)}`)}
                      >
                        <MapPin className="h-4 w-4" />
                        Map
                      </Button>
                    </div>
                    {narration.status === "unavailable" && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        The voice is unavailable here, so the memo stays in text.
                      </p>
                    )}
                  </article>
                );
              })}

              {busy && progress && (
                <section aria-label="Run progress" className="rounded-xl border border-border bg-card p-3.5">
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground motion-reduce:animate-none" />
                    <p role="status" className="text-sm font-medium">
                      {progress.stage}
                    </p>
                    {progress.detail && (
                      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{progress.detail}</span>
                    )}
                  </div>
                  <ol className="mt-3 grid gap-2 sm:grid-cols-2">
                    {progress.stages.map((stage) => (
                      <StageRow key={stage.name} stage={stage} />
                    ))}
                  </ol>
                  {progress.draft && (
                    <div className="mt-3 border-t border-border pt-2.5">
                      <p className="text-xs text-muted-foreground">Draft, as it is written</p>
                      <div className="mt-1 max-h-64 overflow-hidden">
                        <Memo answer={progress.draft} citations={[]} />
                      </div>
                    </div>
                  )}
                </section>
              )}
            </div>
          </div>
        </div>

        <div className="shrink-0 border-t border-border bg-background px-4 py-3">
          <form
            className="mx-auto w-full max-w-[54rem]"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <div className="flex items-end gap-2 rounded-xl border border-border bg-card p-2 focus-within:ring-2 focus-within:ring-ring">
              <textarea
                ref={inputRef}
                aria-label="Ask a question"
                rows={1}
                value={draft}
                onChange={(event) => {
                  setDraft(event.target.value);
                  const element = event.currentTarget;
                  element.style.height = "auto";
                  element.style.height = `${Math.min(160, element.scrollHeight)}px`;
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    submit();
                  }
                }}
                placeholder={turns.length ? "Ask a follow-up question…" : "Ask a legal question…"}
                className="max-h-40 min-h-[2.25rem] min-w-0 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground focus-visible:outline-none"
              />
              <Button type="submit" size="icon" disabled={busy || !draft.trim()} aria-label="Send question">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
              </Button>
            </div>
            <p className="mt-1.5 px-1 text-[11px] text-muted-foreground">
              Enter to send · Shift+Enter for a new line · answers are research summaries, not legal advice
            </p>
          </form>
        </div>
      </div>

      <aside className="hidden w-[21rem] shrink-0 flex-col border-l border-border bg-card/40 xl:flex">
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
          <h2 className="mr-auto text-xs font-semibold uppercase tracking-wide text-muted-foreground">Evidence</h2>
          {!!citations.length && (
            <span className="text-xs tabular-nums text-muted-foreground">{citations.length}</span>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2.5">
          {citations.length ? (
            <EvidenceList citations={citations} onOpen={(index) => setAuthority(citations[index])} />
          ) : (
            <p className="px-1 py-6 text-xs leading-relaxed text-muted-foreground">
              The authorities behind an answer appear here as soon as the retriever returns them.
            </p>
          )}
        </div>
        {latestRecord && (
          <div className="shrink-0 border-t border-border p-2.5">
            <button
              type="button"
              onClick={() => setRecord(latestRecord)}
              className="flex w-full items-center gap-2 rounded-lg border border-border bg-background px-2.5 py-2 text-left text-xs transition-colors hover:bg-accent/60"
            >
              <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block font-medium">Retrieval record</span>
                <span className="block truncate text-muted-foreground">
                  {latestRecord.stages.length} stages
                  {latestRecord.source ? ` · ${latestRecord.source}` : ""}
                </span>
              </span>
            </button>
            {latest && (
              <Button
                variant="outline"
                size="sm"
                className="mt-2 w-full gap-2"
                onClick={() => navigate(`/explore?run=${encodeURIComponent(latest.runId)}`)}
              >
                <MapPin className="h-4 w-4" />
                Open on the map
              </Button>
            )}
          </div>
        )}
      </aside>

      <DetailDrawer
        open={authority !== null}
        onOpenChange={(open) => {
          if (!open) setAuthority(null);
        }}
        title={authority?.title || authority?.citation || "Authority"}
        description={authority ? citeType(authority) : undefined}
      >
        {authority && (
          <AuthorityDetail
            citation={authority}
            onAsk={(question) => {
              setAuthority(null);
              void askQuestion(question);
            }}
          />
        )}
      </DetailDrawer>

      <DetailDrawer
        open={evidence !== null}
        onOpenChange={(open) => {
          if (!open) setEvidence(null);
        }}
        title="Sources"
        description={
          evidence?.length ? `${evidence.length} authorities behind this answer` : "No authority behind this answer"
        }
      >
        {evidence?.length ? (
          <EvidenceList
            citations={evidence}
            onOpen={(index) => {
              const chosen = evidence[index];
              setEvidence(null);
              setAuthority(chosen);
            }}
          />
        ) : (
          <p className="text-sm text-muted-foreground">This answer cited no authority.</p>
        )}
      </DetailDrawer>

      <DetailDrawer
        open={record !== null}
        onOpenChange={(open) => {
          if (!open) setRecord(null);
        }}
        title="Retrieval record"
        description="What the retriever ran, in the order it ran it"
      >
        {!record ? (
          <p className="text-sm text-muted-foreground">This run recorded no retrieval stages.</p>
        ) : (
          <div className="space-y-4">
            {!!record.stages.length && (
              <ol className="space-y-1.5">
                {record.stages.map((stage, index) => (
                  <li key={`${stage.name}-${index}`} className="rounded-lg border border-border px-2.5 py-2">
                    <div className="flex items-baseline gap-2">
                      <span className="text-xs tabular-nums text-muted-foreground">{index + 1}</span>
                      <span className="min-w-0 flex-1 text-sm font-medium">{stage.name}</span>
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {stage.skipped ? "skipped" : stage.durationMs === null ? "—" : `${Math.round(stage.durationMs)} ms`}
                      </span>
                    </div>
                    {stage.skipped && stage.reason && (
                      <p className="mt-1 text-xs text-muted-foreground">Did not run: {stage.reason}</p>
                    )}
                  </li>
                ))}
              </ol>
            )}
            <dl className="space-y-1.5 text-sm">
              {[
                ["Path", record.source || "not recorded"],
                ["Citation graph", record.graphSource || "not recorded"],
                ["Graph revision", record.graphRevision || "not recorded"],
                [
                  "Engine",
                  record.engineOk === null
                    ? "not reported"
                    : record.engineOk
                      ? "answered"
                      : record.engineReason || "did not answer",
                ],
              ].map(([label, value]) => (
                <div key={label} className="flex items-baseline gap-2">
                  <dt className="min-w-0 flex-1 text-muted-foreground">{label}</dt>
                  <dd className="max-w-[62%] break-words text-right text-xs">{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </DetailDrawer>
    </div>
  );
}
