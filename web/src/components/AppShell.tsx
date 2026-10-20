// The frame: the conversation history on the left, the one page on the right. History is the runs this
// device asked for; a saved run opens at `/?run=<id>`, so a conversation can be linked to and reloaded.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Outlet, useNavigate, useSearchParams } from "react-router-dom";
import { FlaskConical, Menu, MessageSquarePlus, MessagesSquare, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { loadRuns, type Source } from "@/lib/api";
import { SAMPLE_NOTICE } from "@/lib/demo";
import { isToday, whenLabel, withinDays, type SavedRun } from "@/lib/runs";
import { cn } from "@/lib/utils";

/** What the page under the shell reads: the history, where it came from, and how to start over. */
export type ShellContext = {
  runs: SavedRun[];
  source: Source | "loading";
  refreshRuns: () => void;
  /** Bumped every time the reader asks for a new conversation. */
  resetToken: number;
};

function Brand() {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span aria-hidden="true" className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground">
        <Sparkles className="h-4 w-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold leading-tight tracking-tight">Precedent</span>
        <span className="block text-xs leading-tight text-muted-foreground">Legal research memo</span>
      </span>
    </div>
  );
}

type Group = { title: string; runs: SavedRun[] };

function groupRuns(runs: SavedRun[]): Group[] {
  const today: SavedRun[] = [];
  const week: SavedRun[] = [];
  const earlier: SavedRun[] = [];
  for (const run of runs) {
    if (isToday(run.ts)) today.push(run);
    else if (withinDays(run.ts, 7)) week.push(run);
    else earlier.push(run);
  }
  return [
    { title: "Today", runs: today },
    { title: "Previous 7 days", runs: week },
    { title: "Earlier", runs: earlier },
  ].filter((group) => group.runs.length > 0);
}

function History({
  runs,
  activeRun,
  onOpen,
}: {
  runs: SavedRun[];
  activeRun: string;
  onOpen: (runId: string) => void;
}) {
  const groups = useMemo(() => groupRuns(runs), [runs]);

  if (!groups.length) {
    return <p className="px-2 py-3 text-xs leading-relaxed text-muted-foreground">Your questions appear here.</p>;
  }

  return (
    <div className="space-y-3">
      {groups.map((group) => (
        <section key={group.title}>
          <h2 className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {group.title}
          </h2>
          <ul className="space-y-0.5">
            {group.runs.map((run) => (
              <li key={run.run_id}>
                <button
                  type="button"
                  onClick={() => onOpen(run.run_id)}
                  aria-current={run.run_id === activeRun ? "true" : undefined}
                  className={cn(
                    "flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
                    run.run_id === activeRun
                      ? "bg-secondary text-secondary-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                  )}
                >
                  <MessagesSquare className="mt-0.5 h-4 w-4 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 block text-sm leading-snug">{run.question}</span>
                    <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{whenLabel(run.ts)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export default function AppShell() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const activeRun = (params.get("run") || "").trim();

  const [runs, setRuns] = useState<SavedRun[]>([]);
  const [source, setSource] = useState<Source | "loading">("loading");
  const [resetToken, setResetToken] = useState(0);
  const [navOpen, setNavOpen] = useState(false);

  const refreshRuns = useCallback(() => {
    void loadRuns().then(({ runs: list, source: where }) => {
      setRuns(list);
      setSource(where);
    });
  }, []);

  useEffect(() => {
    refreshRuns();
  }, [refreshRuns]);

  const newChat = () => {
    setNavOpen(false);
    setResetToken((token) => token + 1);
    navigate("/");
  };

  const openRun = (runId: string) => {
    setNavOpen(false);
    navigate(`/?run=${encodeURIComponent(runId)}`);
  };

  const sidebar = (onNavigate?: () => void) => (
    <>
      <div className="px-3 py-3">
        <Brand />
      </div>
      <div className="px-3">
        <Button className="w-full justify-start gap-2" size="sm" onClick={newChat}>
          <MessageSquarePlus className="h-4 w-4" />
          New chat
        </Button>
      </div>
      <nav aria-label="Conversations" className="mt-3 min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        <History
          runs={runs}
          activeRun={activeRun}
          onOpen={(runId) => {
            onNavigate?.();
            openRun(runId);
          }}
        />
      </nav>
      <div className="space-y-1.5 border-t border-border px-3 py-3">
        {source === "sample" && (
          <Badge variant="secondary" className="gap-1" title={SAMPLE_NOTICE}>
            <FlaskConical className="h-3 w-3" />
            Sample data
          </Badge>
        )}
        <p className="text-[11px] leading-snug text-muted-foreground">
          AI-generated research summaries, not legal advice.
        </p>
      </div>
    </>
  );

  return (
    <div className="flex h-[100dvh] overflow-hidden bg-background text-foreground">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-card/60 lg:flex">{sidebar()}</aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3 lg:hidden">
          <Button variant="ghost" size="icon" aria-label="Open conversations" onClick={() => setNavOpen(true)}>
            <Menu className="h-5 w-5" />
          </Button>
          <Brand />
        </header>
        <div className="min-h-0 flex-1">
          <Outlet context={{ runs, source, refreshRuns, resetToken } satisfies ShellContext} />
        </div>
      </div>

      <Sheet open={navOpen} onOpenChange={setNavOpen}>
        <SheetContent side="left" className="flex w-72 flex-col bg-card p-0">
          <SheetTitle className="sr-only">Conversations</SheetTitle>
          {sidebar(() => setNavOpen(false))}
        </SheetContent>
      </Sheet>
    </div>
  );
}
