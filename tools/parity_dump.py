"""Record how the current map and tour behave for one saved run, so a rewrite can be checked against it.

Run against a live deployment or a local app:

    python tools/parity_dump.py --base https://arize.design-bakery.com --run 150452-fcbb43

Writes tests/fixtures/run-parity.json (the run data) and tests/fixtures/tour_parity.json (the behaviour).
The second file is the golden: stop order, stop text, citation locations, pin groups, county counts and
arc counts. It must be captured before the old map is deleted.
"""

import argparse
import json
import pathlib
import sys
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
FIXTURES = ROOT / "tests" / "fixtures"

EXTRACT = """
() => {
  const D = window.Docs3D;
  if (!D || !D.order) return null;
  try { D.stopTour && D.stopTour(); } catch (e) {}
  const c = D._c || [];
  const e = D._e || [];
  const loc = k => {
    const L = (c[k] && c[k]._loc) || {};
    return { key: L.key || null, cat: L.cat || null, label: L.label || null,
             ll: Array.isArray(L.ll) ? L.ll.slice(0, 2) : null };
  };
  const order = D.order();
  const pins = {};
  c.forEach((x, i) => {
    const L = loc(i);
    if (!L.key) return;
    if (!pins[L.key]) pins[L.key] = { key: L.key, cat: L.cat, label: L.label, ll: L.ll, items: [] };
    pins[L.key].items.push(i);
  });
  const county = {};
  c.forEach(x => {
    const L = x._loc || {};
    if (L.cat === "county" && L.key) county[L.key] = (county[L.key] || 0) + 1;
  });
  const id = {};
  c.forEach((x, i) => { id[x.id] = i; });
  const type = (a, b) => {
    const A = (c[a]._loc || {}).cat, B = (c[b]._loc || {}).cat;
    if (A === "federal" || B === "federal") return "fed";
    if (A === "statute" || B === "statute") return "st";
    if (A === "county" && B === "county") return "cc";
    if ((A === "county") !== (B === "county")) return "cs";
    return "other";
  };
  const arcCounts = { cc: 0, cs: 0, st: 0, fed: 0, other: 0 };
  e.filter(x => x.src in id && x.dst in id).slice(0, 48).forEach(x => { arcCounts[type(id[x.src], id[x.dst])] += 1; });
  return {
    question: (D.ctx || {}).question || null,
    answer: (D.ctx || {}).answer || null,
    order,
    stops: order.map(k => ({ index: k, text: D.explainText(k), ...loc(k), title: c[k].title || null,
                              ref: c[k].ref || null, court: c[k].court || null, date: c[k].date || null })),
    citations: c.map((x, i) => ({ index: i, id: x.id, title: x.title || null, ref: x.ref || null,
                                  court: x.court || null, date: x.date || null, ...loc(i) })),
    edges: e.length,
    arcCounts,
    pins: Object.values(pins).map(p => ({ key: p.key, cat: p.cat, label: p.label, ll: p.ll, count: p.items.length })),
    countyHeat: county,
    countyCount: Object.keys(county).length,
    stateCount: new Set(c.map(x => {
      const L = x._loc || {}, k = L.key || "";
      if (k.startsWith("st:")) return k;
      if (["scotus", "dc-stat", "dccir"].includes(k)) return "dc";
      if (k.startsWith("cir:") && k !== "cir:tenth") return k;
      return "co";
    })).size,
    summary: (document.getElementById("cnt") || {}).textContent || null
  };
}
"""


def fetch(base, run):
    req = urllib.request.Request(f"{base}/api/run/{run}", headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


# A fixed citation set that reaches every location branch: statute, federal statute, SCOTUS, two circuits,
# a Colorado appellate court without a county, and four county courts. Injected into the live map so the
# golden records how the current implementation resolves and draws them.
SPREAD = {
    "question": "Which Colorado counties apply the homestead exemption to mineral rights?",
    "answer": "\n".join(
        [
            "Short answer: the exemption follows the claimant's residence, not the minerals [1][2].",
            "- Boulder County courts read the exemption narrowly [3].",
            "- Weld County and Pueblo County treat severed minerals separately [4][5].",
            "- The Tenth Circuit applies the federal rule to bankruptcy estates [6].",
            "- The Ninth Circuit reaches the same result [7].",
            "- The Colorado Supreme Court and Court of Appeals agree on the residence test [8][9].",
            "- The state statute and the federal statute differ in scope [10][11].",
            "- The U.S. Supreme Court has not decided the mineral question [12].",
        ]
    ),
    "citations": [
        {
            "id": "co-38-41-201",
            "ref": "[1]",
            "title": "C.R.S. 38-41-201",
            "court": "",
            "date": "2024",
            "type": "statute",
            "citation": "C.R.S. 38-41-201",
            "passage": "The homestead exemption protects a dwelling and its appurtenances from execution and attachment.",
        },
        {
            "id": "11-522",
            "ref": "[2]",
            "title": "11 U.S.C. 522",
            "court": "",
            "date": "2023",
            "type": "statute",
            "citation": "11 U.S.C. 522",
            "passage": "The debtor may exempt property listed under the applicable state or federal exemption scheme.",
        },
        {
            "id": "boulder-1",
            "ref": "[3]",
            "title": "In re Estate of Hartman",
            "court": "Colorado Court of Appeals",
            "date": "2022-03-04",
            "type": "case",
            "citation": "2022 COA 33",
            "origin_text": "Appeal from the Boulder County District Court",
            "passage": "The trial court held that the exemption does not extend to mineral interests severed from the surface estate.",
        },
        {
            "id": "weld-1",
            "ref": "[4]",
            "title": "Sanderson v. Weld Holdings",
            "court": "Colorado Court of Appeals",
            "date": "2021-07-15",
            "type": "case",
            "citation": "2021 COA 88",
            "origin_text": "Appeal from the Weld County District Court",
            "passage": "Severed minerals are personal property and the claimant must record the exemption separately.",
        },
        {
            "id": "pueblo-1",
            "ref": "[5]",
            "title": "Vasquez v. Pueblo Minerals",
            "court": "Colorado Court of Appeals",
            "date": "2020-11-05",
            "type": "case",
            "citation": "2020 COA 141",
            "origin_text": "Appeal from the Pueblo County District Court",
            "passage": "The county court must value the mineral estate before applying the exemption.",
        },
        {
            "id": "tenth-1",
            "ref": "[6]",
            "title": "In re Mineral Estate",
            "court": "United States Court of Appeals for the Tenth Circuit",
            "date": "2019-05-20",
            "type": "case",
            "citation": "925 F.3d 1102",
            "passage": "The bankruptcy estate includes the mineral interests, and the exemption applies to the residence only.",
        },
        {
            "id": "ninth-1",
            "ref": "[7]",
            "title": "Ochoa v. Mineral Trust",
            "court": "United States Court of Appeals for the Ninth Circuit",
            "date": "2018-09-12",
            "type": "case",
            "citation": "902 F.3d 1001",
            "passage": "The panel held that the exemption follows the debtor's residence and does not reach severed minerals.",
        },
        {
            "id": "scotus-1",
            "ref": "[8]",
            "title": "Holland v. Mineral Bank",
            "court": "Supreme Court of the United States",
            "date": "2017-06-01",
            "type": "case",
            "citation": "581 U.S. 402",
            "passage": "The Court declined to decide whether mineral interests fall inside the exemption.",
        },
        {
            "id": "elp-1",
            "ref": "[9]",
            "title": "Reed v. El Paso Royalties",
            "court": "Colorado Supreme Court",
            "date": "2023-01-10",
            "type": "case",
            "citation": "2023 CO 4",
            "origin_text": "Certiorari to the El Paso County District Court",
            "passage": "The residence test controls and the claimant need not list the minerals separately.",
        },
        {
            "id": "co-38-41-202",
            "ref": "[10]",
            "title": "C.R.S. 38-41-202",
            "court": "",
            "date": "2024",
            "type": "statute",
            "citation": "C.R.S. 38-41-202",
            "passage": "The exemption amount is adjusted annually and applies to the dwelling and its appurtenances.",
        },
        {
            "id": "cfr-1",
            "ref": "[11]",
            "title": "11 C.F.R. 522.1",
            "court": "",
            "date": "2024",
            "type": "regulation",
            "citation": "11 C.F.R. 522.1",
            "passage": "The federal exemption schedule applies where the state has opted out of the state scheme.",
        },
        {
            "id": "denver-1",
            "ref": "[12]",
            "title": "City of Denver v. Claimant",
            "court": "Colorado Court of Appeals",
            "date": "2021-02-02",
            "type": "case",
            "citation": "2021 COA 12",
            "passage": "The city and county of Denver must release the exemption on the recorded deed.",
        },
    ],
    "edges": [
        {"src": "co-38-41-201", "dst": "boulder-1"},
        {"src": "co-38-41-201", "dst": "weld-1"},
        {"src": "boulder-1", "dst": "weld-1"},
        {"src": "pueblo-1", "dst": "weld-1"},
        {"src": "tenth-1", "dst": "weld-1"},
        {"src": "ninth-1", "dst": "boulder-1"},
        {"src": "scotus-1", "dst": "ninth-1"},
        {"src": "cfr-1", "dst": "scotus-1"},
        {"src": "elp-1", "dst": "pueblo-1"},
        {"src": "denver-1", "dst": "elp-1"},
        {"src": "co-38-41-202", "dst": "co-38-41-201"},
    ],
}

INJECT = """
(s) => {
  const D = window.Docs3D;
  D.ctx = { question: s.question, answer: s.answer };
  D.show(s.citations, s.edges, []);
  return D.order().length;
}
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="https://arize.design-bakery.com")
    ap.add_argument("--run", help="a saved run id; omit with --spread")
    ap.add_argument("--spread", action="store_true", help="inject the fixed citation set that reaches every location branch")
    ap.add_argument("--out", default=str(FIXTURES / "tour_parity.json"))
    a = ap.parse_args()
    if not a.run and not a.spread:
        ap.error("give --run <id> or --spread")

    FIXTURES.mkdir(parents=True, exist_ok=True)
    if a.run:
        data = fetch(a.base, a.run)
        result = data.get("result") or {}
        if not result.get("citations"):
            sys.exit(f"run {a.run} has no citations; pick one with citations")
        (FIXTURES / "run-parity.json").write_text(
            json.dumps(
                {
                    "run_id": a.run,
                    "question": result.get("question"),
                    "answer": result.get("answer"),
                    "citations": result.get("citations"),
                    "edges": result.get("edges"),
                },
                indent=2,
                ensure_ascii=False,
            )
            + "\n",
            encoding="utf-8",
        )

    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        b = p.chromium.launch(args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader"])
        page = b.new_page(viewport={"width": 1440, "height": 900})
        url = f"{a.base}/map" + (f"?run={a.run}" if a.run else "")
        page.goto(url, wait_until="domcontentloaded")
        page.wait_for_function("() => window.Docs3D && window.Docs3D.order", timeout=90000)
        if a.spread:
            page.evaluate(INJECT, SPREAD)
        page.wait_for_function("() => window.Docs3D.order().length > 0", timeout=90000)
        page.wait_for_timeout(1500)
        dump = page.evaluate(EXTRACT)
        b.close()

    if not dump or not dump.get("order"):
        sys.exit("the map produced no tour stops; nothing captured")

    dump["source"] = {"base": a.base, "run": a.run or "spread-fixture", "viewport": "1440x900"}
    pathlib.Path(a.out).write_text(json.dumps(dump, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"{len(dump['order'])} stops, {len(dump['citations'])} citations, {len(dump['pins'])} pin groups -> {a.out}")
    print(dump.get("summary"))


if __name__ == "__main__":
    main()
