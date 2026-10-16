"""Multi-agent legal GraphRAG pipeline: planner -> retriever (parallel traversal workers) -> answer -> safeguard."""
import re, time, uuid, json, math, sys, os
from concurrent.futures import ThreadPoolExecutor
from coord import Run
from llm import complete
import tracing
_G = None
def graph():
    global _G
    if _G is None:
        from graph_store import Graph; _G = Graph()
    return _G
DISCLAIMER = "This is an AI-generated research summary, not legal advice. Verify all authorities and consult a licensed attorney."

def retriever(run, question):
    A = "retriever"; run.claim(A, "graph retrieval")
    with tracing.span("retriever", question=question) as _sp:
        g = graph(); seeds, qt = g.seeds(question, k=10)
        cases = [s for s in seeds if g.info(s)["type"] == "caselaw"][:3]
        seeds = (cases + [s for s in seeds if s not in cases])[:6]
        passages, psrc = ([], None)
        if os.environ.get("USE_OCTO", "1") == "1":
            try:
                import octo_retriever; passages, psrc = octo_retriever.search(question)
            except Exception as e:
                run.event(A, "octo_error", f"Octo retriever failed, falling back: {type(e).__name__}")
        octo_seeds = [p["work_id"] for p in passages if p["work_id"] in g.nodes][:6]
        if octo_seeds:
            run.event(A, "passages", f"Octo hybrid passage search ({psrc}): {len(passages)} passages, {len(octo_seeds)} map to graph authorities", source=psrc)
            seeds = (octo_seeds + [s for s in seeds if s not in octo_seeds])[:8]
        run.event(A, "seeds", f"{len(seeds)} seed authorities ({'Octo passages + ' if octo_seeds else ''}keyword match on {qt})", seeds=seeds, backend=g.backend)
        def expand(s):
            return s, g.neighbors(s, "out"), g.neighbors(s, "in")
        edges, cand, paths = [], {}, {}
        with ThreadPoolExecutor(8) as ex:   # parallel SurrealDB traversals
            for s, outs, ins in ex.map(expand, seeds):
                cand[s] = (6.0 - octo_seeds.index(s) * 0.5) if s in octo_seeds else 3.0; paths[s] = [s]
                for o in outs[:40]:
                    edges.append((s, o)); cand[o] = cand.get(o, 0) + 1.0; paths.setdefault(o, [s, o])
                for i in sorted(ins, key=lambda n: -g.pr.get(n, 0))[:15]:
                    edges.append((i, s)); cand[i] = cand.get(i, 0) + 0.8; paths.setdefault(i, [i, s])
        run.event(A, "expand", f"1-hop SurrealDB traversal (->cites / <-cites): {len(cand)} candidates, {len(edges)} edges")
        score = {n: c * (1 + math.log1p(g.indeg.get(n, 0))) for n, c in cand.items()}
        ranked = sorted(score, key=lambda n: -score[n])
        top = (octo_seeds[:4] + [n for n in ranked if n not in octo_seeds[:4]])[:8]   # passage-backed cases first
        cites = []
        for i, n in enumerate(top, 1):
            d = g.info(n); d.update(ref=f"[{i}]", score=round(score[n], 2), path=paths[n], seed=n in seeds)
            pz = next((p for p in passages if p["work_id"] == n), None)
            if pz:
                d.update(passage=pz["text"], chunk_id=pz["chunk_id"], url=d["url"] or pz["url"])
            cites.append(d)
        try:
            import octo_retriever
            docs = [dict(g.info(p["work_id"]), passage=p["text"], ref="") for p in passages if p["work_id"] not in top][:10]
            heads = octo_retriever.first_chunks([c["id"] for c in cites + docs if c["type"] == "caselaw"])
            for c in cites + docs:
                if c["id"] in heads: c["origin_text"] = heads[c["id"]]
        except Exception: docs = []
        keep = set(top) | set(seeds)
        sub = [{"src": a, "dst": b} for a, b in edges if a in keep and b in keep]
        tracing.oi(_sp, openinference__span__kind="RETRIEVER", input__value=question, output__value=f"{len(cites)} authorities, {len(sub)} graph edges, passages={psrc}")
        for _i, _c in enumerate(cites[:10]):
            tracing.oi(_sp, **{f"retrieval__documents__{_i}__document__id": str(_c.get("id")), f"retrieval__documents__{_i}__document__content": (_c.get("title","") + " — " + (_c.get("passage") or ""))[:1500],
                              f"retrieval__documents__{_i}__document__score": float(_c.get("score") or (10 - _i)), f"retrieval__documents__{_i}__document__metadata": {"ref": _c.get("ref"), "court": _c.get("court"), "date": _c.get("date"), "type": _c.get("type")}})
        try: run.event(A, "ranked", f"{len(cites)} authorities ranked", citations=[{k: (c.get(k) or "")[:600] if k == "passage" else c.get(k) for k in ("id","ref","title","type","court","date","url","passage","origin_text","path","cited_by")} for c in cites], edges=sub[:80])
        except Exception: pass
        run.release(A, handoff_to="answer", summary=f"ranked top {len(cites)} authorities by citation-weighted PageRank")
    return {"citations": cites, "edges": sub, "seeds": seeds, "passage_source": psrc, "documents": docs}

def _clip(t, n):
    t = " ".join((t or "").split()); return t if len(t) <= n else t[:n].rsplit(" ", 1)[0] + " ..."

def template_answer(question, cites):
    first = cites[0]
    out = [f"**Short answer:** The most relevant authorities retrieved for this question are led by **{first['title']}** {first['ref']}; see the key authorities below.", "", "### Key authorities"]
    for c in cites[:5]:
        q = f' - "{_clip(c["passage"].split(chr(10), 1)[-1], 160)}"' if c.get("passage") else (f" - {c['type'].replace('_', ' ')}" + (f", cited by {c['cited_by']}" if c['cited_by'] else ""))
        out.append(f"- **{c['title']}** {c['ref']}{q}")
    out += ["", "### Caveat", "Template summary (offline mode) built only from retrieved authorities; verify against the full opinions."]
    return "\n".join(out)

def answer(run, question, ret):
    A = "answer"; run.claim(A, "cited answer")
    with tracing.span("answer") as _sp:
        cites = ret["citations"]
        ctx = "\n".join(f"{c['ref']} {c['title']} ({c['type']}, {c['court']} {c['date']}, cited by {c['cited_by']})" + (f"\n   passage: {_clip(c['passage'], 350)}" if c.get("passage") else "") for c in cites)
        sys_p = ("You are a legal research associate writing a brief internal research memo for attorneys. Professional memo tone; state holdings precisely and note jurisdiction. Use ONLY the numbered authorities given; cite them as [n]; never cite anything else. "
                 "Reply in short Markdown, <=150 words, exactly this shape:\n**Short answer:** one or two sentences with [n] cites.\n\n"
                 "### Key authorities\n- **Case or statute name** [n] - \"one short quote from its passage\"\n(3-4 bullets)\n\n"
                 "### Caveat\nOne sentence on limits (jurisdiction, facts, verify).")
        text, provider = complete(sys_p, f"Question: {question}\nAuthorities:\n{ctx}", 400, lambda: template_answer(question, cites))
        tracing.oi(_sp, openinference__span__kind="LLM", llm__model_name="claude-haiku-4-5", llm__provider="anthropic", llm__system="anthropic", llm__invocation_parameters={"max_tokens": 400},
                   llm__input_messages__0__message__role="system", llm__input_messages__0__message__content=sys_p, llm__input_messages__1__message__role="user", llm__input_messages__1__message__content=f"Question: {question}\nAuthorities:\n{ctx}"[:4000],
                   llm__output_messages__0__message__role="assistant", llm__output_messages__0__message__content=text, input__value=question, output__value=text, metadata={"provider": provider},
                   llm__token_count__prompt=int(len((sys_p+ctx+question).split())*1.3), llm__token_count__completion=int(len(text.split())*1.3))
        run.event(A, "draft", f"drafted answer via {provider}", provider=provider)
        run.release(A, handoff_to="safeguard", summary=f"answer drafted ({len(text.split())} words)")
    return {"text": text, "provider": provider}

def safeguard(run, question, ret, ans):
    A = "safeguard"; run.claim(A, "eval + citation guard")
    with tracing.span("safeguard") as _sp:
        cites = ret["citations"]; valid = {c["ref"] for c in cites}; text = ans["text"]
        def check_refs():
            used = set(re.findall(r"\[\d+\]", text)); bad = sorted(used - valid); return used, bad
        def check_named():
            # authority-shaped strings in the answer that are not in the retrieved set
            # verbatim quotes from retrieved passages are grounded; don't treat citations inside them as new authorities
            corpus = " ".join(" ".join((c.get("passage") or "").split()) for c in cites)
            body = re.sub(r'"([^"]{20,})"', lambda m: "" if m.group(1).rstrip(" .").replace(" ...", "") in corpus else m.group(0), text)
            pats = re.findall(r"(\d+\s+(?:U\.S\.C\.|C\.F\.R\.|CFR|P\.[23]d|P\.|U\.S\.|F\.[234]d|B\.R\.)\s*§?\s*[\d\-\.]+|C\.R\.S\.\s*§\s*[\d\-\.]+\d)", body)
            known = " ".join(c["id"] + " " + c["title"] for c in cites)
            return [p for p in pats if p.strip() not in known]
        def check_claims():
            sents = [s for s in re.split(r"(?<=[.!?])\s+", text) if len(s.split()) > 6]
            return [s for s in sents if not re.search(r"\[\d+\]", s)]
        with ThreadPoolExecutor(3) as ex:   # parallel checks
            f1, f2, f3 = ex.submit(check_refs), ex.submit(check_named), ex.submit(check_claims)
            (used, bad), unknown, unsupported = f1.result(), f2.result(), f3.result()
        passed = not bad and not unknown and bool(used)
        run.event(A, "checks", f"{len(used)} citations used, {len(bad)} invalid refs, {len(unknown)} unknown authorities, {len(unsupported)} uncited claims",
                  used=sorted(used), invalid=bad, unknown=unknown, unsupported=unsupported)
        _sent = max(1, len([x for x in text.replace("\n", " ").split(". ") if len(x.split()) > 4])); _g = round(max(0.0, 1 - len(unsupported) / _sent), 3)
        tracing.oi(_sp, openinference__span__kind="GUARDRAIL", input__value=text, output__value="PASS" if passed else "FAIL",
                   eval__citation_guard__label="pass" if passed else "fail", eval__citation_guard__score=1.0 if passed else 0.0,
                   eval__citation_guard__explanation=f"{len(used)} cites used; invalid={bad}; unknown={unknown}",
                   eval__groundedness__label="grounded" if _g >= 0.7 else "partially_grounded", eval__groundedness__score=_g,
                   eval__groundedness__explanation=f"{len(unsupported)} of ~{_sent} sentences lack a retrieved citation (heuristic, no LLM call)")
        run.release(A, status="pass" if passed else "fail", summary="PASS" if passed else "FAIL")
    return {"pass": passed, "used": sorted(used), "invalid": bad, "unknown_authorities": unknown,
            "unsupported_claims": unsupported, "disclaimer": DISCLAIMER}

def run_pipeline(question, run_id=None):
    run = Run(run_id or time.strftime("%H%M%S-") + uuid.uuid4().hex[:6]); t0 = time.time()
    run.claim("planner", "orchestrator"); run.event("planner", "plan", "plan: retrieve -> answer -> safeguard", question=question)
    run.release("planner", handoff_to="retriever", summary="dispatched retriever")
    with tracing.span("pipeline", question=question) as _sp:
        ret = retriever(run, question); ans = answer(run, question, ret); sg = safeguard(run, question, ret, ans)
        tracing.oi(_sp, input__value=question, output__value=ans["text"], session__id=run.id, metadata={"run_id": run.id, "safeguard": "PASS" if sg["pass"] else "FAIL", "provider": ans["provider"]})
    res = {"run_id": run.id, "question": question, "answer": ans["text"], "provider": ans["provider"], "safeguard": sg,
           "citations": ret["citations"], "edges": ret["edges"], "seeds": ret["seeds"], "backend": graph().backend,
           "elapsed_s": round(time.time() - t0, 2), "passage_source": ret.get("passage_source"), "documents": ret.get("documents", [])}
    (run.dir / "result.json").write_text(json.dumps(res, indent=2))
    run.event("planner", "done", f"pipeline complete in {res['elapsed_s']}s — safeguard {'PASS' if sg['pass'] else 'FAIL'}")
    return res

if __name__ == "__main__":
    r = run_pipeline(" ".join(sys.argv[1:]) or "When can police search a vehicle without a warrant?")
    try:
        import acs_board; sg = r["safeguard"]
        acs_board.oio_record(f"run-{r['run_id']}", f"CLI demo run {r['run_id']}: '{r['question'][:200]}' -> safeguard {'PASS' if sg['pass'] else 'FAIL'}; {len(sg['used'])} citations, invalid={sg['invalid']}, model={r['provider']}, passages={r.get('passage_source')}",
            ["legal-graphrag-demo pipeline (CLI)"], impact_band="informational" if sg["pass"] else "moderate", evidence="confirmed", extra_session=f"runs/{r['run_id']}/events.jsonl")
    except Exception as e: print("acs log failed:", e)
    print(json.dumps({k: r[k] for k in ("run_id", "answer", "provider", "backend", "elapsed_s")}, indent=2)); print("safeguard:", r["safeguard"]["pass"])
