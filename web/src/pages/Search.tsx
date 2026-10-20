// Knowledge retrieval search: every authority this device's runs cited, scored against the query and
// shown with the passage that matched. A result opens the authority in a drawer, or hands the
// question to the chat so the agents can reason over it.

import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowUpRight, Filter, FlaskConical, Gavel, MessagesSquare, Search as SearchIcon, Sparkles } from "lucide-react";
import AuthorityDetail from "@/components/AuthorityDetail";
import DetailDrawer from "@/components/DetailDrawer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { loadRunResult, loadRuns, type Source } from "@/lib/api";
import {
  dedupeDocs,
  docsFromRun,
  searchDocs,
  segments,
  type Doc,
  type Filters,
  type JurisdictionFilter,
  type KindFilter,
} from "@/lib/corpus";
import type { Citation } from "@/lib/citations";
import { SUGGESTIONS } from "@/lib/demo";
import { cn } from "@/lib/utils";

type Sort = "relevance" | "newest";

function Highlight({ text, terms }: { text: string; terms: string[] }) {
  return (
    <>
      {segments(text, terms).map((part, index) =>
        part.hit ? (
          <mark
            key={index}
            className="rounded-sm bg-amber-200/70 px-0.5 text-foreground dark:bg-amber-400/25 dark:text-foreground"
          >
            {part.text}
          </mark>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </>
  );
}

export default function Search() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const initial = (params.get("q") || "").trim();
  const [draft, setDraft] = useState(initial);
  const [query, setQuery] = useState(initial);
  const [filters, setFilters] = useState<Filters>({ jurisdiction: "all", kind: "all" });
  const [sort, setSort] = useState<Sort>("relevance");
  const [docs, setDocs] = useState<Doc[]>([]);
  const [runCount, setRunCount] = useState(0);
  const [source, setSource] = useState<Source | "loading">("loading");
  const [loading, setLoading] = useState(true);
  const [authority, setAuthority] = useState<Citation | null>(null);

  // The palette can send a new question here while this page is already open, so the address wins.
  const asked = (params.get("q") || "").trim();
  useEffect(() => {
    setDraft(asked);
    setQuery(asked);
  }, [asked]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { runs, source: where } = await loadRuns();
      const read = await Promise.all(runs.slice(0, 12).map(async (run) => ({ run, result: await loadRunResult(run.run_id) })));
      if (cancelled) return;
      const all = read.flatMap(({ run, result }) =>
        result.result ? docsFromRun(result.result, run.run_id) : [],
      );
      setDocs(dedupeDocs(all));
      setRunCount(runs.length);
      setSource(where);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const hits = useMemo(() => {
    const found = searchDocs(docs, query, filters);
    if (sort === "newest") return [...found].sort((a, b) => b.doc.date.localeCompare(a.doc.date));
    return found;
  }, [docs, query, filters, sort]);

  const submit = (next: string) => {
    const asked = next.trim();
    setQuery(asked);
    const params = new URLSearchParams();
    if (asked) params.set("q", asked);
    setParams(params, { replace: true });
  };

  const searching = query.trim().length > 0;

  return (
    <div className="mx-auto h-full w-full max-w-[1080px] overflow-y-auto px-4 py-5">
      <section className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold tracking-tight">Retrieve authorities</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Field-weighted search over every authority your saved runs cite — title and citation first, then the
              passage.
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
          className="mt-3 flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            submit(draft);
          }}
        >
          <div className="relative min-w-0 flex-1">
            <SearchIcon aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              aria-label="Search the corpus"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="mineral estate, C.R.S. § 38-41-201, bankruptcy exemption…"
              className="h-11 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <Button type="submit" className="gap-2">
            <SearchIcon className="h-4 w-4" />
            Search
          </Button>
        </form>

        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Filter className="h-3.5 w-3.5" />
            Narrow
          </span>
          <Select
            value={filters.jurisdiction}
            onValueChange={(value) => setFilters((current) => ({ ...current, jurisdiction: value as JurisdictionFilter }))}
          >
            <SelectTrigger className="h-9 w-[10.5rem] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All jurisdictions</SelectItem>
              <SelectItem value="Colorado">Colorado</SelectItem>
              <SelectItem value="Federal">Federal</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={filters.kind}
            onValueChange={(value) => setFilters((current) => ({ ...current, kind: value as KindFilter }))}
          >
            <SelectTrigger className="h-9 w-[9.5rem] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Every kind</SelectItem>
              <SelectItem value="case">Cases</SelectItem>
              <SelectItem value="statute">Statutes</SelectItem>
              <SelectItem value="regulation">Regulations</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sort} onValueChange={(value) => setSort(value as Sort)}>
            <SelectTrigger className="h-9 w-[9.5rem] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="relevance">By relevance</SelectItem>
              <SelectItem value="newest">Newest first</SelectItem>
            </SelectContent>
          </Select>
          <span className="ml-auto text-xs tabular-nums text-muted-foreground">
            {loading
              ? "Reading the corpus…"
              : `${docs.length} authorities · ${runCount} run${runCount === 1 ? "" : "s"}`}
          </span>
        </div>
      </section>

      {!searching ? (
        <section className="mt-4 rounded-xl border border-border bg-card p-5">
          <span className="grid h-9 w-9 place-items-center rounded-md bg-secondary text-secondary-foreground">
            <Sparkles className="h-4 w-4" />
          </span>
          <h2 className="mt-3 text-sm font-semibold">Start from a question</h2>
          <p className="mt-1 max-w-[62ch] text-sm leading-relaxed text-muted-foreground">
            Search finds the authorities; the chat reasons over them. Pick a question to do both.
          </p>
          <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
            {SUGGESTIONS.map((suggestion) => (
              <li key={suggestion}>
                <button
                  type="button"
                  onClick={() => submit(suggestion)}
                  className="flex h-full w-full items-start gap-2 rounded-lg border border-border px-3 py-2 text-left text-sm transition-colors hover:bg-accent/60"
                >
                  <SearchIcon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0">{suggestion}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <section aria-label="Results" className="mt-4">
          <div className="flex flex-wrap items-baseline gap-2">
            <h2 className="text-sm font-semibold">
              {hits.length ? `${hits.length} result${hits.length === 1 ? "" : "s"}` : "No result"}
            </h2>
            <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
              for “{query}” in {docs.length} authorities
            </p>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => navigate(`/chat?q=${encodeURIComponent(query)}`)}
            >
              <MessagesSquare className="h-4 w-4" />
              Ask this in chat
            </Button>
          </div>

          {loading ? (
            <ul className="mt-3 space-y-2">
              {[0, 1, 2].map((row) => (
                <li key={row} className="h-24 animate-pulse rounded-xl border border-border bg-card motion-reduce:animate-none" />
              ))}
            </ul>
          ) : hits.length ? (
            <ul className="mt-3 space-y-2">
              {hits.map((hit) => (
                <li key={hit.doc.id} className="rounded-xl border border-border bg-card p-3.5">
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                    <Badge variant="secondary" className="gap-1 px-1.5 py-0 text-[10px]">
                      <Gavel className="h-3 w-3" />
                      {hit.doc.kind}
                    </Badge>
                    <span className="rounded border border-border px-1.5 py-0.5">{hit.doc.jurisdiction}</span>
                    {hit.doc.county && (
                      <span className="rounded border border-border px-1.5 py-0.5">{hit.doc.county} County</span>
                    )}
                    <span className="ml-auto flex items-center gap-1.5">
                      <span className="hidden sm:inline">match</span>
                      <span className="h-1 w-16 overflow-hidden rounded-full bg-muted">
                        <span
                          className="block h-full rounded-full bg-primary"
                          style={{ width: `${Math.max(6, Math.round(hit.score * 100))}%` }}
                        />
                      </span>
                      <span className="w-8 text-right tabular-nums">{Math.round(hit.score * 100)}%</span>
                    </span>
                  </div>

                  <h3 className="mt-1.5">
                    <button
                      type="button"
                      onClick={() => setAuthority(hit.doc.record)}
                      className="text-left text-sm font-semibold leading-snug underline-offset-2 hover:underline"
                    >
                      <Highlight text={hit.doc.title} terms={hit.terms} />
                    </button>
                  </h3>

                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {[hit.doc.citation, hit.doc.court, hit.doc.date].filter(Boolean).join(" · ")}
                  </p>

                  {hit.snippet && (
                    <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                      <Highlight text={hit.snippet} terms={hit.terms} />
                    </p>
                  )}

                  <div className="mt-2 flex flex-wrap items-center gap-1 border-t border-border pt-2">
                    <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                      From “{hit.doc.question}”
                    </p>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1.5"
                      onClick={() => setAuthority(hit.doc.record)}
                    >
                      <ArrowUpRight className="h-4 w-4" />
                      Open
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1.5"
                      onClick={() =>
                        navigate(
                          `/chat?q=${encodeURIComponent(`How does ${hit.doc.title} apply to a Colorado homestead claim?`)}`,
                        )
                      }
                    >
                      <MessagesSquare className="h-4 w-4" />
                      Ask about this
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="mt-3 rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">Nothing in the corpus matches “{query}”.</p>
              <p className="mt-1 leading-relaxed">
                Try fewer words, a citation number, or a court. Widening the filters helps too — they are applied
                before the query is scored.
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setFilters({ jurisdiction: "all", kind: "all" })}
                  className={cn(
                    filters.jurisdiction !== "all" || filters.kind !== "all" ? "" : "pointer-events-none opacity-50",
                  )}
                >
                  Clear filters
                </Button>
                <Button
                  size="sm"
                  className="gap-1.5"
                  onClick={() => navigate(`/chat?q=${encodeURIComponent(query)}`)}
                >
                  <MessagesSquare className="h-4 w-4" />
                  Ask the agents instead
                </Button>
              </div>
            </div>
          )}
        </section>
      )}

      <DetailDrawer
        open={authority !== null}
        onOpenChange={(open) => {
          if (!open) setAuthority(null);
        }}
        title={authority?.title || authority?.citation || "Authority"}
        description={authority?.citation || undefined}
      >
        {authority && (
          <AuthorityDetail
            citation={authority}
            onAsk={(question) => {
              setAuthority(null);
              navigate(`/chat?q=${encodeURIComponent(question)}`);
            }}
          />
        )}
      </DetailDrawer>
    </div>
  );
}
