// The one page: ask a question, read the memo, and turn the answer into a map. The conversation stays
// a conversation — the figures behind an answer, its sources and its retrieval record open in drawers,
// and the map is a mode of the same page rather than a place of its own.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useOutletContext, useSearchParams } from "react-router-dom";
import {
  ArrowUp,
  BookOpen,
  CheckCircle2,
  Circle,
  Copy,
  CornerDownRight,
  FlaskConical,
  Gauge,
  Loader2,
  MapPin,
  MessagesSquare,
  Plus,
  Sparkles,
  Volume2,
  VolumeX,
} from "lucide-react";
import type { ShellContext } from "@/components/AppShell";
import AuthorityDetail from "@/components/AuthorityDetail";
import CitationMap, { type MapPlace } from "@/components/CitationMap";
import DetailDrawer from "@/components/DetailDrawer";
import EvidenceList from "@/components/EvidenceList";
import Memo from "@/components/Memo";
import PlaceCard from "@/components/PlaceCard";
import TourBar from "@/components/TourBar";
import TurnDetails from "@/components/TurnDetails";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useNarration } from "@/hooks/use-narration";
import { useTour } from "@/hooks/use-tour";
import { pathLine, plainText, tourPlan } from "@/map/tour";
import { AskRefused, STAGE_PLAN, STAGE_WORDS, ask, loadRunResult, type AskTick, type Source, type StageTick } from "@/lib/api";
import { citeType, type Citation, type RunResult } from "@/lib/citations";
import { SUGGESTIONS } from "@/lib/demo";
import { seconds } from "@/lib/runs";
import { cn } from "@/lib/utils";
import { showError, showSuccess } from "@/utils/toast";

type AssistantTurn = {
  id: string;
  role: "assistant";
  result: RunResult;
  runId: string;
  source: Source;
};

type Turn = { id: string; role: "user"; text: string } | AssistantTurn | { id: string; role: "error"; text: string };

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

export default function Chat() {
  const { refreshRuns, resetToken } = useOutletContext<ShellContext>();
  const [params, setParams] = useSearchParams();

  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<AskTick | null>(null);
  const [lastRunId, setLastRunId] = useState<string | null>(null);
  const [mode, setMode] = useState<"chat" | "map">("chat");
  const [mapTurnId, setMapTurnId] = useState<string | null>(null);

  const [authority, setAuthority] = useState<Citation | null>(null);
  const [sources, setSources] = useState<Citation[] | null>(null);
  const [place, setPlace] = useState<MapPlace | null>(null);
  const [details, setDetails] = useState<AssistantTurn | null>(null);
  const [followUps, setFollowUps] = useState<string[] | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  /** The run this page wrote into the address itself, so opening it does not read it back a second time. */
  const skipRun = useRef<string | null>(null);
  const tokenRef = useRef(resetToken);

  const { status: narrationStatus, speak, stop: stopNarration, active: narrating } = useNarration();

  /** The tour is declared below the answer it walks, so the thread's own controls reach it through a ref. */
  const stopTourRef = useRef<() => void>(() => {});

  const clearThread = useCallback(() => {
    stopTourRef.current();
    stopNarration();
    setTurns([]);
    setDraft("");
    setLastRunId(null);
    setProgress(null);
    setMode("chat");
    setMapTurnId(null);
    setAuthority(null);
    setSources(null);
    setPlace(null);
    setDetails(null);
    setFollowUps(null);
    setParams(new URLSearchParams(), { replace: true });
    inputRef.current?.focus();
  }, [stopNarration, setParams]);

  const askQuestion = useCallback(
    async (text: string) => {
      const asked = text.trim();
      if (!asked) return;
      setBusy(true);
      setDraft("");
      setProgress({
        stage: STAGE_WORDS.planner,
        detail: "",
        draft: "",
        stages: EMPTY_STAGES.map((stage) => ({ ...stage })),
      });
      setTurns((current) => [...current, { id: nextId(), role: "user", text: asked }]);
      try {
        const { runId, result, source } = await ask(asked, {
          prevRunId: lastRunId,
          onTick: (tick) => setProgress(tick),
        });
        setLastRunId(runId);
        setTurns((current) => [...current, { id: nextId(), role: "assistant", result, runId, source }]);
        skipRun.current = runId;
        setParams(new URLSearchParams({ run: runId }), { replace: true });
        refreshRuns();
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
    [lastRunId, refreshRuns, setParams],
  );

  // A saved run named in the address opens as its own conversation.
  useEffect(() => {
    const runId = (params.get("run") || "").trim();
    if (!runId) return;
    if (skipRun.current === runId) {
      skipRun.current = null;
      return;
    }
    let cancelled = false;
    void loadRunResult(runId).then(({ result, source }) => {
      if (cancelled || !result) return;
      const id = nextId();
      const question = (result.question || "").trim();
      setLastRunId(runId);
      setTurns(() => [
        ...(question ? [{ id: `${id}-q`, role: "user" as const, text: question }] : []),
        { id, role: "assistant" as const, result, runId, source },
      ]);
      setMode("chat");
      setMapTurnId(null);
    });
    return () => {
      cancelled = true;
    };
  }, [params]);

  // The shell's "New chat" asks for an empty thread by bumping this token.
  useEffect(() => {
    if (tokenRef.current === resetToken) return;
    tokenRef.current = resetToken;
    clearThread();
  }, [resetToken, clearThread]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element || mode !== "chat") return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    element.scrollTo({ top: element.scrollHeight, behavior: reduced ? "auto" : "smooth" });
  }, [turns.length, progress?.draft, mode]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      stopNarration();
      stopTourRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stopNarration]);

  const assistants = useMemo(
    () => turns.filter((turn): turn is AssistantTurn => turn.role === "assistant"),
    [turns],
  );
  const latest = assistants.length ? assistants[assistants.length - 1] : null;
  const mapTurn = useMemo(
    () => assistants.find((turn) => turn.id === mapTurnId) ?? latest,
    [assistants, mapTurnId, latest],
  );

  // The tour walks the answer that is on the map: the short answer, the path the retriever took, the
  // opinion and the rest of the memo, then every authority at the place the camera moves to. It starts
  // on a click, never on its own.
  const tourSteps = useMemo(() => (mapTurn ? tourPlan(mapTurn.result) : []), [mapTurn]);
  const tour = useTour(tourSteps, stopNarration);
  useEffect(() => {
    stopTourRef.current = tour.stop;
  }, [tour.stop]);

  const mapPath = useMemo(() => {
    if (!mapTurn) return "";
    const links = mapTurn.result.edges?.length ?? 0;
    const drawn = links
      ? `${links} citation ${links === 1 ? "link" : "links"} drawn between them.`
      : "No citation link joins them.";
    return `${pathLine(mapTurn.result)} ${drawn}`;
  }, [mapTurn]);

  // The walk belongs to the map: leaving the map leaves the walk.
  useEffect(() => {
    if (mode !== "map") tour.stop();
  }, [mode, tour.stop]);

  const title = useMemo(() => {
    const first = turns.find((turn) => turn.role === "user");
    return first && first.role === "user" ? first.text : "New conversation";
  }, [turns]);

  const submit = () => {
    if (busy || !draft.trim()) return;
    void askQuestion(draft);
  };

  const openMap = (turn: AssistantTurn) => {
    setMapTurnId(turn.id);
    setPlace(null);
    setMode("map");
  };

  const selectPlace = useCallback((next: MapPlace) => setPlace(next), []);

  const copyAnswer = async (answer: string) => {
    try {
      await navigator.clipboard.writeText(answer);
      showSuccess("Memo copied");
    } catch {
      showError("The browser would not copy that");
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold leading-tight tracking-tight">
            {mode === "map" ? "Citation map" : title}
          </h1>
          <p className="truncate text-xs leading-tight text-muted-foreground">
            {mode === "map"
              ? mapTurn?.result.question || "Where this answer's authorities sit"
              : "Four agents, one memo, every authority behind it"}
          </p>
        </div>

        <ToggleGroup
          type="single"
          size="sm"
          value={mode}
          onValueChange={(value) => value && setMode(value as "chat" | "map")}
          className="rounded-md border border-border p-0.5"
          aria-label="Show the conversation or the map"
        >
          <ToggleGroupItem value="chat" className="gap-1.5 px-2.5 text-xs" aria-label="Chat">
            <MessagesSquare className="h-4 w-4" />
            <span className="hidden sm:inline">Chat</span>
          </ToggleGroupItem>
          <ToggleGroupItem value="map" className="gap-1.5 px-2.5 text-xs" aria-label="Map">
            <MapPin className="h-4 w-4" />
            <span className="hidden sm:inline">Map</span>
          </ToggleGroupItem>
        </ToggleGroup>

        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5"
          onClick={clearThread}
          disabled={!turns.length && !busy}
        >
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">New chat</span>
        </Button>
      </header>

      {mode === "map" ? (
        <div className="min-h-0 flex-1 p-3">
          <div className="relative h-full min-h-0">
            {mapTurn ? (
              <>
                <CitationMap
                  citations={mapTurn.result.citations}
                  edges={mapTurn.result.edges}
                  focus={tour.active ? tour.current?.place ?? null : null}
                  onSelect={selectPlace}
                  className="h-full"
                />
                {/* A pin opens a card on the map, not a panel over it: the reader stays where they are. */}
                {place && <PlaceCard place={place} onClose={() => setPlace(null)} />}
                <TourBar
                  steps={tourSteps}
                  index={tour.index}
                  status={tour.status}
                  heard={tour.heard}
                  path={mapPath}
                  onStart={tour.start}
                  onStop={tour.stop}
                />
              </>
            ) : (
              <div className="grid h-full place-items-center rounded-lg border border-border bg-card p-6 text-center">
                <div className="max-w-sm space-y-3">
                  <MapPin className="mx-auto h-6 w-6 text-muted-foreground" />
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    Ask a question first: the map places every authority the answer cites at the court that decided it.
                  </p>
                  <Button variant="outline" size="sm" onClick={() => setMode("chat")}>
                    Back to the chat
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <>
          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-3xl px-4 py-5">
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

                  const answer = turn.result.answer || "";
                  const citations = turn.result.citations || [];
                  const pass = turn.result.safeguard?.pass ?? null;
                  const elapsed = typeof turn.result.elapsed_s === "number" ? turn.result.elapsed_s : null;
                  const suggestions = turn.result.followups || [];

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
                          <Memo answer={answer} citations={citations} />
                        </div>
                      ) : (
                        <p className="mt-2 text-sm text-muted-foreground">The run recorded no answer.</p>
                      )}

                      <p className="mt-3 text-xs text-muted-foreground">
                        {turn.result.safeguard?.disclaimer || "AI-generated research summary, not legal advice."}
                      </p>

                      <div className="mt-3 flex flex-wrap items-center gap-1 border-t border-border pt-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="gap-1.5"
                          onClick={() => setSources(citations)}
                          disabled={!citations.length}
                        >
                          <BookOpen className="h-4 w-4" />
                          Sources ({citations.length})
                        </Button>
                        {!!suggestions.length && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="gap-1.5"
                            onClick={() => setFollowUps(suggestions)}
                          >
                            <CornerDownRight className="h-4 w-4" />
                            Follow-ups ({suggestions.length})
                          </Button>
                        )}
                        <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => setDetails(turn)}>
                          <Gauge className="h-4 w-4" />
                          Details
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="gap-1.5"
                          onClick={() => {
                            if (narrating) {
                              stopNarration();
                              return;
                            }
                            tour.stop();
                            // Markdown read aloud would be "asterisk asterisk" and "[1]"; say the prose.
                            speak(plainText(answer));
                          }}
                        >
                          {narrating ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                          {narrating ? "Stop" : "Read aloud"}
                        </Button>
                        <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => void copyAnswer(answer)}>
                          <Copy className="h-4 w-4" />
                          Copy
                        </Button>
                        <Button variant="ghost" size="sm" className="ml-auto gap-1.5" onClick={() => openMap(turn)}>
                          <MapPin className="h-4 w-4" />
                          Show on the map
                        </Button>
                      </div>
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
              className="mx-auto w-full max-w-3xl"
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
                {narrationStatus === "unavailable"
                  ? "The voice is unavailable here, so the memo stays in text."
                  : "Enter to send · Shift+Enter for a new line · answers are research summaries, not legal advice"}
              </p>
            </form>
          </div>
        </>
      )}

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
        open={sources !== null}
        onOpenChange={(open) => {
          if (!open) setSources(null);
        }}
        title="Sources"
        description={
          sources?.length ? `${sources.length} authorities behind this answer` : "No authority behind this answer"
        }
      >
        {sources?.length ? (
          <EvidenceList
            citations={sources}
            onOpen={(citation) => {
              setSources(null);
              setAuthority(citation);
            }}
          />
        ) : (
          <p className="text-sm text-muted-foreground">This answer cited no authority.</p>
        )}
      </DetailDrawer>

      <DetailDrawer
        open={followUps !== null}
        onOpenChange={(open) => {
          if (!open) setFollowUps(null);
        }}
        title="Follow-ups"
        description="Asked with this answer as the previous run, so the agents keep its context"
      >
        <ul className="space-y-1.5">
          {(followUps || []).map((item) => (
            <li key={item}>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setFollowUps(null);
                  void askQuestion(item);
                }}
                className="flex w-full items-start gap-2 rounded-lg border border-border bg-card px-2.5 py-2 text-left text-sm leading-relaxed transition-colors hover:bg-accent/60 disabled:opacity-50"
              >
                <CornerDownRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0">{item}</span>
              </button>
            </li>
          ))}
        </ul>
      </DetailDrawer>

      <DetailDrawer
        open={details !== null}
        onOpenChange={(open) => {
          if (!open) setDetails(null);
        }}
        title="Behind this answer"
        description={details ? `Run ${details.runId}` : undefined}
      >
        {details && (
          <TurnDetails
            result={details.result}
            onShowMap={() => {
              const turn = details;
              setDetails(null);
              openMap(turn);
            }}
          />
        )}
      </DetailDrawer>
    </div>
  );
}
