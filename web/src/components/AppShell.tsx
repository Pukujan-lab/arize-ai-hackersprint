// The workspace frame: one navigation for every page, a command palette for jumping between pages and
// starting a question, and a standing note when the app is reading its bundled sample corpus instead
// of the research backend.

import { useEffect, useMemo, useState, type ComponentType } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  Activity,
  Boxes,
  Command as CommandIcon,
  FlaskConical,
  LayoutDashboard,
  Menu,
  MessagesSquare,
  Plus,
  Presentation,
  Search,
  Sparkles,
} from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { loadStack } from "@/lib/api";
import { SAMPLE_NOTICE } from "@/lib/demo";
import { count, type StackInfo } from "@/lib/runs";
import { cn } from "@/lib/utils";

type NavItem = {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  hint: string;
  end?: boolean;
};

const NAV: NavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, hint: "What the desk has been doing", end: true },
  { to: "/chat", label: "Chat", icon: MessagesSquare, hint: "Ask the four agents a legal question" },
  { to: "/search", label: "Search", icon: Search, hint: "Retrieve authorities across your runs" },
  { to: "/explore", label: "Explore", icon: Boxes, hint: "Walk the citation map in three dimensions" },
  { to: "/observability", label: "Observability", icon: Activity, hint: "Traces, judges and engine health" },
  { to: "/slides", label: "Briefing", icon: Presentation, hint: "The product story, slide by slide" },
];

/** The page name and its one-line description, read from the address. */
function pageFor(pathname: string): { title: string; subtitle: string } {
  if (pathname.startsWith("/chat")) return { title: "Chat", subtitle: "Four agents, one memo, every authority behind it" };
  if (pathname.startsWith("/search")) return { title: "Search", subtitle: "Knowledge retrieval over the authorities your runs hold" };
  if (pathname.startsWith("/explore")) return { title: "Explore", subtitle: "The citation map, tilted and walked" };
  if (pathname.startsWith("/observability")) return { title: "Observability", subtitle: "What each run did, step by step" };
  if (pathname.startsWith("/slides")) return { title: "Briefing", subtitle: "The product story" };
  if (pathname === "/") return { title: "Dashboard", subtitle: "The research desk at a glance" };
  return { title: "Not found", subtitle: "That address does not hold a page" };
}

function Brand() {
  return (
    <div className="flex items-center gap-2">
      <span aria-hidden="true" className="grid h-8 w-8 place-items-center rounded-md bg-primary text-primary-foreground">
        <Sparkles className="h-4 w-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold leading-tight tracking-tight">Precedent</span>
        <span className="block text-xs leading-tight text-muted-foreground">Legal research workspace</span>
      </span>
    </div>
  );
}

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav aria-label="Primary" className="flex flex-col gap-0.5">
      {NAV.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              "group flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors",
              isActive
                ? "bg-secondary text-secondary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            )
          }
        >
          {({ isActive }) => (
            <>
              <item.icon className={cn("h-4 w-4 shrink-0", isActive ? "text-foreground" : "text-muted-foreground")} />
              <span className="min-w-0 truncate">{item.label}</span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

export default function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [stack, setStack] = useState<StackInfo | null>(null);
  const [source, setSource] = useState<"live" | "sample" | "loading">("loading");

  const page = useMemo(() => pageFor(location.pathname), [location.pathname]);

  useEffect(() => {
    let cancelled = false;
    void loadStack().then(({ stack: info, source: where }) => {
      if (cancelled) return;
      setStack(info);
      setSource(where);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Each page brings its own scroll container, so a move between pages starts at the top; the sheet closes with it.
  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

  const go = (to: string) => {
    setPaletteOpen(false);
    setQuery("");
    navigate(to);
  };

  const asked = query.trim();

  const corpusFacts = [
    { label: "Passages", value: count(stack?.passages ?? null) },
    { label: "Cases", value: count(stack?.engine?.caseCount ?? null) },
    { label: "Graph edges", value: count(stack?.edges ?? null) },
  ];

  return (
    <div className="flex h-[100dvh] overflow-hidden bg-background text-foreground">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-card/60 lg:flex">
        <div className="px-3 py-3">
          <Brand />
        </div>
        <div className="px-3">
          <Button className="w-full justify-start gap-2" size="sm" onClick={() => navigate("/chat")}>
            <Plus className="h-4 w-4" />
            New question
          </Button>
        </div>
        <div className="mt-4 min-h-0 flex-1 overflow-y-auto px-3">
          <p className="px-2.5 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Workspace</p>
          <NavList />
        </div>
        <div className="space-y-2 border-t border-border px-3 py-3">
          <div className="rounded-lg border border-border bg-background/60 p-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold">Corpus</span>
              {source === "sample" ? (
                <Badge variant="secondary" className="gap-1 px-1.5 py-0 text-[10px] font-medium">
                  <FlaskConical className="h-3 w-3" />
                  Sample
                </Badge>
              ) : (
                <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-medium">
                  {source === "live" ? "Live" : "…"}
                </Badge>
              )}
            </div>
            <dl className="mt-1.5 space-y-0.5">
              {corpusFacts.map((fact) => (
                <div key={fact.label} className="flex items-baseline justify-between gap-2 text-xs">
                  <dt className="text-muted-foreground">{fact.label}</dt>
                  <dd className="tabular-nums">{fact.value}</dd>
                </div>
              ))}
            </dl>
          </div>
          <p className="px-0.5 text-[11px] leading-snug text-muted-foreground">
            AI-generated research summaries, not legal advice.
          </p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background px-3">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            aria-label="Open navigation"
            onClick={() => setNavOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-semibold leading-tight tracking-tight">{page.title}</h1>
            <p className="truncate text-xs leading-tight text-muted-foreground">{page.subtitle}</p>
          </div>

          {source === "sample" && (
            <TooltipProvider delayDuration={150}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="secondary" className="hidden gap-1 sm:inline-flex">
                    <FlaskConical className="h-3.5 w-3.5" />
                    Sample data
                  </Badge>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs text-xs leading-relaxed">{SAMPLE_NOTICE}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}

          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="flex h-9 items-center gap-2 rounded-md border border-border bg-card px-2.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <Search className="h-4 w-4" />
            <span className="hidden sm:inline">Search or jump to…</span>
            <kbd className="hidden items-center gap-0.5 rounded border border-border bg-muted px-1 font-mono text-[10px] sm:flex">
              <CommandIcon className="h-2.5 w-2.5" />K
            </kbd>
          </button>
        </header>

        <div className="min-h-0 flex-1">
          <Outlet />
        </div>
      </div>

      <Sheet open={navOpen} onOpenChange={setNavOpen}>
        <SheetContent side="left" className="w-72 bg-card p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <div className="border-b border-border px-4 py-3">
            <Brand />
          </div>
          <div className="px-3 py-3">
            <Button
              className="w-full justify-start gap-2"
              size="sm"
              onClick={() => {
                setNavOpen(false);
                navigate("/chat");
              }}
            >
              <Plus className="h-4 w-4" />
              New question
            </Button>
            <div className="mt-4">
              <NavList onNavigate={() => setNavOpen(false)} />
            </div>
            {source === "sample" && (
              <p className="mt-4 rounded-md border border-border bg-background p-2 text-[11px] leading-relaxed text-muted-foreground">
                {SAMPLE_NOTICE}
              </p>
            )}
          </div>
        </SheetContent>
      </Sheet>

      <CommandDialog open={paletteOpen} onOpenChange={setPaletteOpen}>
        <CommandInput
          value={query}
          onValueChange={setQuery}
          placeholder="Search knowledge, ask a question, or jump to a page…"
        />
        <CommandList>
          <CommandEmpty>Nothing matches that yet.</CommandEmpty>
          {asked && (
            <>
              <CommandGroup heading="This question">
                <CommandItem value={`ask ${asked}`} onSelect={() => go(`/chat?q=${encodeURIComponent(asked)}`)}>
                  <MessagesSquare className="mr-2 h-4 w-4" />
                  <span className="min-w-0 flex-1 truncate">Ask “{asked}” in chat</span>
                  <CommandShortcut>↵</CommandShortcut>
                </CommandItem>
                <CommandItem value={`search ${asked}`} onSelect={() => go(`/search?q=${encodeURIComponent(asked)}`)}>
                  <Search className="mr-2 h-4 w-4" />
                  <span className="min-w-0 flex-1 truncate">Retrieve authorities for “{asked}”</span>
                </CommandItem>
              </CommandGroup>
              <CommandSeparator />
            </>
          )}
          <CommandGroup heading="Go to">
            {NAV.map((item) => (
              <CommandItem key={item.to} value={`go ${item.label}`} onSelect={() => go(item.to)}>
                <item.icon className="mr-2 h-4 w-4" />
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                <span className="hidden truncate text-xs text-muted-foreground sm:inline">{item.hint}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </div>
  );
}
