import SiteHeader from "@/components/SiteHeader";

const PIPELINE = [
  { agent: "planner", role: "Splits the question into retrieval intents" },
  { agent: "retriever", role: "Expands the citation graph into authorities" },
  { agent: "writer", role: "Writes the memo and its citations" },
  { agent: "safeguard", role: "Checks every cited authority against the graph" },
];

export default function Observability() {
  return (
    <div className="flex min-h-[100dvh] flex-col bg-background text-foreground">
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        <h1 className="text-xl font-semibold tracking-tight">Observability</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Every question runs through four agents. This page reports what each run did: the steps it took, how long
          each one held the claim, and the authorities it cited.
        </p>

        <section className="mt-6 rounded-lg border border-border p-4">
          <h2 className="text-sm font-semibold">The pipeline</h2>
          <ul className="mt-3 space-y-3">
            {PIPELINE.map((step, index) => (
              <li key={step.agent} className="flex gap-3">
                <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-secondary text-xs font-semibold">
                  {index + 1}
                </span>
                <div>
                  <div className="text-sm font-medium">{step.agent}</div>
                  <div className="text-sm text-muted-foreground">{step.role}</div>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-4 rounded-lg border border-border p-4">
          <h2 className="text-sm font-semibold">Saved runs</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Run listings, step timings and raw step records arrive on this page in the next release. Until then, a run
            opened from Home reports its own authorities in the memo.
          </p>
        </section>
      </main>
    </div>
  );
}
