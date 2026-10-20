// The sample corpus the workspace falls back to when the FastAPI backend is not reachable — the
// preview build, for instance, serves only the web app. Every record here is marked as a sample, and
// the shell says so on screen, so nothing in it is ever passed off as retrieved authority.

import type { Citation, Edge, RunResult } from "./citations";
import type { RunDetail, SavedRun, StackInfo } from "./runs";

export const SAMPLE_NOTICE =
  "Sample corpus — the research backend is not reachable from this preview, so these records are bundled with the app.";

const NOW = Date.now();
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

const HEAD = (name: string, court: string, year: string) => `${name} | ${court} | ${year}`;

export const DEMO_CITATIONS: Citation[] = [
  {
    id: "statute:crs-38-41-201",
    ref: "[1]",
    title: "Homestead exemption — the statutory grant",
    citation: "C.R.S. § 38-41-201",
    court: "Colorado General Assembly",
    date: "2023-08-07",
    type: "statute",
    origin_text: "Title 38, Article 41, Colorado Revised Statutes",
    passage:
      HEAD("Homestead exemption", "Colorado General Assembly", "2023") +
      "\nEvery householder in Colorado is entitled to a homestead exemption on the house in which the householder resides, to the extent of the statutory amount, against execution and attachment arising from debts contracted after the exemption was recorded. The exemption protects the dwelling and the land on which it stands, together with the improvements, up to the acreage the statute allows.",
  },
  {
    id: "statute:crs-38-41-204",
    ref: "[2]",
    title: "Proceeds of a homestead sale — the reinvestment window",
    citation: "C.R.S. § 38-41-204",
    court: "Colorado General Assembly",
    date: "2023-08-07",
    type: "statute",
    origin_text: "Title 38, Article 41, Colorado Revised Statutes",
    passage:
      HEAD("Proceeds of sale", "Colorado General Assembly", "2023") +
      "\nWhen a homestead is sold, the proceeds are exempt for a period of one year from the date of sale, so that the householder may reinvest them in another homestead. The exemption follows the proceeds only while they remain identifiable and are held for that purpose; commingling the funds with other money ends the protection.",
  },
  {
    id: "case:boulder-severed-estate",
    ref: "[3]",
    title: "Severed mineral estate — homestead claim (sample record)",
    citation: "Colo. App. (sample)",
    court: "Colorado Court of Appeals",
    date: "2019-04-18",
    type: "case",
    origin_text: "Appeal from the District Court, Boulder County",
    passage:
      HEAD("Sample record", "Colorado Court of Appeals", "2019") +
      "\nThe homestead exemption attaches to the dwelling and the land beneath it as one parcel. Where the mineral estate has been severed and conveyed away, the surface owner keeps the exemption in the residence and the surface, but the exemption does not reach the minerals the owner no longer holds. The court reasoned that the exemption protects a home, not an interest the householder has already parted with.",
  },
  {
    id: "case:elpaso-bankruptcy",
    ref: "[4]",
    title: "Bankruptcy estate — state exemption on the petition date (sample record)",
    citation: "Colo. App. (sample)",
    court: "Colorado Court of Appeals",
    date: "2021-11-02",
    type: "case",
    origin_text: "Appeal from the District Court, El Paso County",
    passage:
      HEAD("Sample record", "Colorado Court of Appeals", "2021") +
      "\nA debtor who claims the Colorado homestead exemption in bankruptcy takes the exemption as it stands on the petition date. A recorded exemption that satisfies the statute is allowed in full; an unrecorded or late-recorded claim does not reach debts contracted before it was recorded. The panel noted that the bankruptcy code leaves the amount and the conditions to state law.",
  },
  {
    id: "case:denver-occupancy",
    ref: "[5]",
    title: "Occupancy and the meaning of residence (sample record)",
    citation: "Colo. (sample)",
    court: "Colorado Supreme Court",
    date: "2016-06-13",
    type: "case",
    origin_text: "Certiorari to the Colorado Court of Appeals",
    passage:
      HEAD("Sample record", "Colorado Supreme Court", "2016") +
      "\nA householder does not lose the exemption by a temporary absence, so long as the intention to return to the dwelling continues and the property is not put to another use. The exemption turns on the character of the property as a home, not on continuous physical presence. A dwelling rented out for the whole of the exemption year is not a homestead for that year.",
  },
  {
    id: "federal:10th-mineral-lease",
    ref: "[6]",
    title: "Mineral leasehold and the exemption in federal court (sample record)",
    citation: "10th Cir. (sample)",
    court: "United States Court of Appeals for the Tenth Circuit",
    date: "2018-02-27",
    type: "case",
    origin_text: "Appeal from the U.S. District Court, District of Colorado",
    passage:
      HEAD("Sample record", "United States Court of Appeals for the Tenth Circuit", "2018") +
      "\nSitting in diversity, the panel applied Colorado's homestead statute as the state's highest court would read it. A mineral leasehold is an interest in land, but the exemption is measured by the value of the dwelling and the land around it; a lease that reserves royalties does not enlarge the exemption. The judgment of the district court was affirmed.",
  },
  {
    id: "federal:usc-522",
    ref: "[7]",
    title: "Bankruptcy exemptions — the state-law option",
    citation: "11 U.S.C. § 522(b)",
    court: "United States Congress",
    date: "2022-01-01",
    type: "federal statute",
    origin_text: "Title 11, United States Code",
    passage:
      HEAD("Exemptions", "United States Congress", "2022") +
      "\nAn individual debtor may exempt property under the federal exemptions or under the law of the state in which the debtor's domicile has been located for the one hundred eighty days preceding the petition date. A state may opt out of the federal scheme, and Colorado has done so, which is why the Colorado homestead statute governs the amount a debtor may claim.",
  },
  {
    id: "case:weld-recorded",
    ref: "[8]",
    title: "Recordation and notice to creditors (sample record)",
    citation: "Colo. App. (sample)",
    court: "Colorado Court of Appeals",
    date: "2020-09-24",
    type: "case",
    origin_text: "Appeal from the District Court, Weld County",
    passage:
      HEAD("Sample record", "Colorado Court of Appeals", "2020") +
      "\nThe exemption does not reach debts contracted before the homestead was recorded. A creditor whose judgment predates the recordation may execute against the property notwithstanding the later claim. The panel held that the recording date, and not the date the householder moved in, fixes which debts the exemption can defeat.",
  },
];

export const DEMO_EDGES: Edge[] = [
  { src: "statute:crs-38-41-201", dst: "case:boulder-severed-estate" },
  { src: "statute:crs-38-41-201", dst: "case:elpaso-bankruptcy" },
  { src: "statute:crs-38-41-201", dst: "case:denver-occupancy" },
  { src: "case:boulder-severed-estate", dst: "federal:10th-mineral-lease" },
  { src: "statute:crs-38-41-204", dst: "case:boulder-severed-estate" },
  { src: "federal:usc-522", dst: "case:elpaso-bankruptcy" },
  { src: "statute:crs-38-41-201", dst: "case:weld-recorded" },
  { src: "case:denver-occupancy", dst: "case:weld-recorded" },
];

export const DEMO_RETRIEVAL = {
  source: "sample corpus",
  stages: [
    { name: "Plan the question", duration_ms: 210, skipped: false, reason: "" },
    { name: "Lexical search", duration_ms: 380, skipped: false, reason: "" },
    { name: "Dense search", duration_ms: 640, skipped: false, reason: "" },
    { name: "Rerank passages", duration_ms: 220, skipped: false, reason: "" },
    { name: "Expand the citation graph", duration_ms: 180, skipped: false, reason: "" },
    { name: "JEV relevance screen", duration_ms: null, skipped: true, reason: "the graph revision was already cached" },
  ],
  graph: { source: "networkx", revision: "sample-3" },
  engine: { ok: false, reason: "the retrieval engine is not reachable from this preview" },
};

const ANSWER = `**Short answer:** A severed mineral estate does not travel with the homestead. The exemption protects the dwelling and the land the householder lives on, and the minerals the householder has already conveyed sit outside it [3]. The surface home keeps its exemption, and the severed minerals are available to creditors of the mineral owner [1][6].

### Key authorities

- **Homestead exemption — the statutory grant** fixes the dwelling, the improvements and the permitted acreage as the thing the exemption reaches [1].
- **Severed mineral estate — homestead claim** holds that the exemption does not reach minerals the householder no longer holds [3].
- **Mineral leasehold and the exemption in federal court** applies the same reading where a lease reserves royalties but leaves the dwelling in place [6].

### Opinion

The exemption is a protection for a home, and the statute is written in terms of the residence and the land around it. Once the mineral estate is severed and conveyed, the householder has exchanged that interest for value; the exemption follows the home that remains, not the interest that was sold. A creditor of the surface owner therefore reaches the home only within the statutory amount, while a creditor of the mineral owner is not met by a homestead claim at all.

Where the householder keeps the minerals and lives above them, the analysis changes: the exemption then covers the dwelling and the surface, and the minerals stay part of the same ownership even though the exemption's value is still measured by the home.

### Caveat

This summary is drawn from the sample records in this preview. Confirm the current statutory amount, the acreage limit and the recording requirements against the Colorado statutes before relying on any of it.`;

export const DEMO_RESULT: RunResult = {
  run_id: "sample-homestead-minerals",
  question: "Does a severed mineral estate keep the Colorado homestead exemption?",
  answer: ANSWER,
  retrieval: DEMO_RETRIEVAL,
  citations: DEMO_CITATIONS,
  edges: DEMO_EDGES,
  provider: "sample corpus",
  elapsed_s: 4.6,
  safeguard: {
    pass: true,
    used: ["[1]", "[2]", "[3]", "[4]", "[5]", "[6]", "[7]", "[8]"],
    invalid: [],
    unknown_authorities: [],
    unsupported_claims: [],
    disclaimer: "AI-generated research summary, not legal advice.",
  },
  followups: [
    "What happens to the exemption if the home is sold and the proceeds are held in a savings account?",
    "Does a mineral lease recorded before the homestead changes the analysis?",
    "How does the bankruptcy petition date affect the amount a debtor may claim?",
  ],
};

const SECOND_RESULT: RunResult = {
  ...DEMO_RESULT,
  run_id: "sample-proceeds",
  question: "Are the proceeds of a homestead sale still exempt if they sit in a savings account?",
  provider: "sample corpus",
  elapsed_s: 3.9,
  citations: DEMO_CITATIONS.filter((c) => c.id !== "case:boulder-severed-estate"),
  edges: DEMO_EDGES.filter((e) => e.src !== "case:boulder-severed-estate" && e.dst !== "case:boulder-severed-estate"),
};

const THIRD_RESULT: RunResult = {
  ...DEMO_RESULT,
  run_id: "sample-bankruptcy",
  question: "How does a bankruptcy estate treat a recorded Colorado homestead exemption?",
  provider: "sample corpus",
  elapsed_s: 5.4,
};

export const DEMO_SAVED: SavedRun[] = [
  { run_id: "sample-homestead-minerals", question: DEMO_RESULT.question || "", n: DEMO_CITATIONS.length, ts: ago(34) },
  { run_id: "sample-proceeds", question: SECOND_RESULT.question || "", n: SECOND_RESULT.citations?.length ?? 0, ts: ago(190) },
  { run_id: "sample-bankruptcy", question: THIRD_RESULT.question || "", n: THIRD_RESULT.citations?.length ?? 0, ts: ago(1_480) },
];

export const DEMO_RESULTS: RunResult[] = [DEMO_RESULT, SECOND_RESULT, THIRD_RESULT];

function detailOf(result: RunResult): RunDetail {
  return {
    runId: result.run_id || "",
    question: result.question || "",
    answer: result.answer || "",
    elapsed: result.elapsed_s ?? null,
    provider: result.provider || "",
    pass: result.safeguard?.pass ?? null,
    citations: result.citations?.length ?? null,
    prevRunId: null,
    followUps: result.followups || [],
    steps: [
      { agent: "planner", kind: "plan", t: 0.0, record: { question: result.question, plan: "statute → case → federal" } },
      { agent: "retriever", kind: "retrieve", t: 1.1, record: { passages: 24, cases: 8, engine: "sample corpus" } },
      { agent: "answer", kind: "write", t: 2.9, record: { words: 312, provider: result.provider } },
      { agent: "safeguard", kind: "done", t: 4.4, record: { pass: true, checked: result.citations?.length ?? 0 } },
    ],
    retrieval: {
      source: DEMO_RETRIEVAL.source,
      stages: DEMO_RETRIEVAL.stages.map((stage) => ({
        name: stage.name,
        durationMs: stage.duration_ms,
        skipped: stage.skipped,
        reason: stage.reason,
      })),
      graphSource: DEMO_RETRIEVAL.graph.source,
      graphRevision: DEMO_RETRIEVAL.graph.revision,
      engineOk: DEMO_RETRIEVAL.engine.ok,
      engineReason: DEMO_RETRIEVAL.engine.reason,
    },
  };
}

export const DEMO_DETAILS: Record<string, RunDetail> = Object.fromEntries(
  DEMO_RESULTS.map((result) => [result.run_id || "", detailOf(result)]),
);

export const DEMO_STACK: StackInfo = {
  chain: ["Fish Audio", "ElevenLabs", "Kokoro"],
  passages: 327_407,
  nodes: 18_422,
  edges: 51_208,
  how: {
    octo: "sample corpus bundled with the app",
    surrealdb: "citation graph read from the sample edges",
    arize: "tracing is not connected in this preview",
    elevenlabs: "voice chain is configured on the server, not in the preview",
  },
  runs: DEMO_RESULTS.map((result) => ({
    run_id: result.run_id || "",
    elapsed: result.elapsed_s ?? null,
    provider: result.provider || "",
    pass: result.safeguard?.pass ?? null,
  })),
  engine: {
    configured: false,
    ok: false,
    status: "not reachable from the preview",
    chunkCount: 327_407,
    caseCount: 18_422,
    corpusRevision: "sample-3",
    graphRevision: "sample-3",
    lexical: "BM25 over the sample passages",
    denseModel: "bge-large-en-v1.5 (sample)",
    rerankModel: "bge-reranker-base (sample)",
    jevModel: "not loaded",
    scorer: "reciprocal rank fusion (sample)",
    lastError: "",
  },
  tracing: { ok: false, reason: "the preview has no exporter", project: "precedent", sent: 0, dropped: 0, queued: 0 },
  retention: { runsKept: 200, runsOnDisk: 3, traceQueueMax: 2_000, spansDropped: 0 },
};

/** Suggested questions for the empty chat and the search page. */
export const SUGGESTIONS = [
  "Does a severed mineral estate keep the Colorado homestead exemption?",
  "Are the proceeds of a homestead sale still exempt in a savings account?",
  "How does a bankruptcy estate treat a recorded homestead exemption?",
  "Which debts does a homestead exemption defeat in Colorado?",
];
