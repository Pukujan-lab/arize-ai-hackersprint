import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import SiteHeader from "@/components/SiteHeader";
import { cn } from "@/lib/utils";

type Slide = { kicker: string; title: string; body: string; points?: string[] };

const SLIDES: Slide[] = [
  {
    kicker: "The question",
    title: "Ask a legal question in plain language",
    body: "Type the question you would ask a colleague. Precedent turns it into a run: it plans the retrieval, gathers the authorities, writes the memo, and checks every citation before you read it.",
  },
  {
    kicker: "The pipeline",
    title: "Four agents, and a trace you can read",
    body: "A planner splits the question into retrieval intents. A retriever expands the citation graph. A writer drafts the memo. A safeguard checks each cited authority against the graph.",
    points: [
      "Every step is recorded, with the time it happened and the gap before it.",
      "The Observability page replays that trace, step by step, for any saved run.",
    ],
  },
  {
    kicker: "The map",
    title: "Every authority, at the court that decided it",
    body: "Each citation becomes a pin over an extruded map of the United States, with a county layer for Colorado. The arcs show which authorities the memo leans on, so you can see whether a claim rests on one line of cases or on many.",
  },
  {
    kicker: "The tour",
    title: "The tour walks the memo, citation by citation",
    body: "Press play and the map narrates the memo in the order it cites its authorities: the title, the court, the year, the holding, and the sentence that relies on it. Pause, step back, or stop at any point.",
  },
  {
    kicker: "The check",
    title: "Trust comes from being able to check",
    body: "Every stop resolves to a real jurisdiction and a real case. The safeguard reports what it could verify and what it could not, and the county layer shows where the retrieved cases were decided. Nothing in the memo is beyond inspection.",
  },
  {
    kicker: "Try it",
    title: "Now ask your own question",
    body: "Open the composer, ask something in your own words, and the memo, the map and the tour come back with it. Use “Ask your own question” below to start.",
  },
];

const controlClass =
  "inline-flex min-h-[44px] items-center justify-center rounded-md border border-border px-3 text-sm font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-40";

export default function Slides() {
  const [index, setIndex] = useState(0);
  const total = SLIDES.length;

  const go = useCallback(
    (delta: number) => setIndex((current) => Math.min(total - 1, Math.max(0, current + delta))),
    [total],
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

  const slide = SLIDES[index];

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-background text-foreground">
      <SiteHeader />
      <main className="flex min-h-0 flex-1 flex-col">
        <div
          onClick={() => go(1)}
          className="min-h-0 min-w-0 flex-1 cursor-pointer overflow-y-auto"
        >
          <div className="mx-auto flex min-h-full w-full max-w-4xl flex-col justify-center px-4 py-8 sm:px-6 sm:py-12">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {index + 1} · {slide.kicker}
            </p>
            <h1 className="mt-3 break-words text-2xl font-semibold leading-tight tracking-tight sm:text-3xl lg:text-4xl">
              {slide.title}
            </h1>
            <p className="mt-4 max-w-2xl break-words text-base leading-relaxed text-muted-foreground sm:text-lg">
              {slide.body}
            </p>
            {slide.points && (
              <ul className="mt-5 max-w-2xl space-y-2">
                {slide.points.map((point) => (
                  <li key={point} className="break-words text-sm leading-relaxed text-muted-foreground sm:text-base">
                    {point}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="shrink-0 border-t border-border bg-card">
          <div className="mx-auto flex w-full max-w-4xl flex-wrap items-center gap-2 px-4 py-3 sm:px-6">
            <button
              type="button"
              className={controlClass}
              onClick={() => go(-1)}
              disabled={index === 0}
            >
              Previous slide
            </button>
            <button
              type="button"
              className={controlClass}
              onClick={() => go(1)}
              disabled={index === total - 1}
            >
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
