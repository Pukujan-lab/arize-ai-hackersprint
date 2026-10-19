import SiteHeader from "@/components/SiteHeader";

const OUTLINE = [
  {
    title: "Ask a legal question",
    body: "A question in plain language becomes a run: four agents plan, retrieve, write and verify, and the memo comes back with its authorities numbered.",
  },
  {
    title: "The map behind the memo",
    body: "Every authority the memo cites becomes a pin at the court that decided it, over an extruded map of the United States and a county layer for Colorado.",
  },
  {
    title: "The guided tour",
    body: "The tour walks the citations in the order the memo cites them, narrating each stop: title, court, year, holding and the line of the memo that cites it.",
  },
  {
    title: "Check the citation",
    body: "Each stop resolves to a real jurisdiction. The county layer shows where the retrieved cases were decided, and the legend states how many counties and jurisdictions the run touches.",
  },
];

export default function Slides() {
  return (
    <div className="flex min-h-[100dvh] flex-col bg-background text-foreground">
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        <h1 className="text-xl font-semibold tracking-tight">Slides</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          The deck that walks through a run, from the question to the map to the tour. Keyboard control, position and
          the call to action arrive in the next release.
        </p>
        <ol className="mt-6 space-y-4">
          {OUTLINE.map((slide, index) => (
            <li key={slide.title} className="rounded-lg border border-border p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Slide {index + 1} of {OUTLINE.length}
              </div>
              <h2 className="mt-1 text-base font-semibold">{slide.title}</h2>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{slide.body}</p>
            </li>
          ))}
        </ol>
      </main>
    </div>
  );
}
