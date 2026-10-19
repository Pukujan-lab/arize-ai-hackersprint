"""Multi-agent legal GraphRAG pipeline: planner -> retriever (the retrieval engine) -> answer -> safeguard.

Retrieval is not reimplemented here. The candidate set is the retrieval engine's result list, in its
order, so an authority the index returns survives even when the local citation graph has no node for it.
The local graph contributes citation edges among the authorities in the final list, and nothing else.
Every stage message names the path the run actually took, and every run stores `retrieval` so the page
can show the stages, their durations and the reason a stage did not run.
"""

import re, time, uuid, json, sys, os
from concurrent.futures import ThreadPoolExecutor
from app.coord import Run
from app import engine, tracing

_G = None


def graph():
    global _G
    if _G is None:
        from app.graph_store import Graph

        _G = Graph()
    return _G


DISCLAIMER = "This is an AI-generated research summary, not legal advice. Verify all authorities and consult a licensed attorney."

# Words that carry no legal subject: a question made only of these has nothing to search for.
_GREETING = set("hello hi hey thanks thank please cheers goodbye test testing there here".split())
_STOP = set(
    "a an the of to in on for and or is are was be by with what when how does do can could would should under law legal court "
    "who which my i if it that this from as at without you your me we our us about someone anyone somebody".split()
)


def content_terms(question):
    """The words in a question that name a subject the corpus could match."""
    return [t for t in re.findall(r"[a-z0-9]+", (question or "").lower()) if len(t) > 2 and t not in _STOP and t not in _GREETING]


def _graph_or_none():
    """(graph, reason it is unavailable). The graph is optional: the engine supplies the candidates."""
    try:
        g = graph()
    except Exception as e:
        return None, f"{type(e).__name__}: {e}"
    if not getattr(g, "nodes", None):
        return g, "the local citation graph has no nodes"
    return g, None


def _kind(nid, node):
    given = str(node.get("type") or "").strip()
    if given:
        return given
    if re.search(r"C\.R\.S\.|U\.S\.C\.|C\.F\.R\.|§", nid or ""):
        return "statute"
    return "caselaw"


def _crs_link(nid, year):
    """A link to the text of a Colorado statute, derived from its own citation (title PDF, else the index)."""
    title = re.search(r"C\.R\.S\.\s*§\s*(\d+)", nid or "")
    if not title:
        return ""
    if re.fullmatch(r"\d{4}", str(year or "")):
        return f"https://leg.colorado.gov/sites/default/files/images/olls/crs{year}-title-{title.group(1)}.pdf"
    return "https://leg.colorado.gov/agencies/office-legislative-counsel/colorado-revised-statutes"


def _cite(nid, passage, node, ref):
    """One authority: what the index holds, what the local graph holds, and what is missing."""
    from app.octo_retriever import passage_header

    head = passage_header(passage.get("text"))
    title = passage.get("case_name") or node.get("title") or head.get("name") or nid
    court = passage.get("court") or node.get("court") or ""
    date = node.get("date") or passage.get("date") or ""
    url = passage.get("url") or node.get("url") or ""
    if not url:
        url = _crs_link(nid, date)
    cite = {
        "id": nid,
        "ref": ref,
        "title": title,
        "type": _kind(nid, node),
        "court": court,
        "date": date,
        "url": url,
        "score": passage.get("score"),
        "path": [nid],
        "seed": True,
    }
    for key in ("score_kind", "rrf", "bm25", "dense", "provenance", "rank", "cap_id"):
        if passage.get(key) is not None:
            cite[key] = passage[key]
    if passage.get("text"):
        cite["passage"] = passage["text"]
    if passage.get("chunk_id"):
        cite["chunk_id"] = passage["chunk_id"]
    if passage.get("passages"):
        cite["passages"] = passage["passages"]
    if node:
        cite["cited_by"] = node.get("cited_by")
        cite["pagerank"] = node.get("pagerank")
    missing = [field for field, value in (("court", court), ("date", date), ("link", url)) if not value]
    if not passage.get("text"):
        missing.append("passage")
    if missing:
        cite["missing"] = missing
    return cite


def retriever(run, question, extra_seeds=None):
    A = "retriever"
    run.claim(A, "engine retrieval")
    with tracing.span("retriever", question=question) as _sp:
        from app import octo_retriever

        g, gerr = _graph_or_none()
        passages, psrc = [], None
        if os.environ.get("USE_OCTO", "1") == "1":
            try:
                passages, psrc = octo_retriever.search(question)
            except Exception as e:
                run.event(A, "retrieval_error", f"retrieval failed: {type(e).__name__}: {str(e)[:200]}")
        record = octo_retriever.last_retrieval() or {
            "source": psrc,
            "stages": [],
            "graph": {"source": "local-citation-edges" if g is not None else "none", "revision": None},
            "engine": {"configured": engine.configured(), "ok": False, "reason": "the retrieval path did not report its stages"},
        }
        if psrc:
            run.event(
                A,
                "passages",
                f"{len(passages)} passages from {psrc}",
                source=psrc,
                stages=[stage.get("name") for stage in record.get("stages") or []],
            )
        else:
            run.event(A, "passages", "no retrieval path returned a passage", source=None)

        seeds, qt = [], []
        if g is not None:
            try:
                seeds, qt = g.seeds(question, k=10)
            except Exception as e:
                gerr = gerr or f"{type(e).__name__}: {e}"
        if seeds:
            run.event(
                A,
                "seeds",
                f"{len(seeds)} local graph seed authorities for {' '.join(qt)}",
                seeds=seeds,
                backend=g.backend,
            )
        if gerr:
            run.event(A, "graph_unavailable", f"local citation graph unavailable ({gerr[:200]}); no citation edges drawn")

        # The candidate set is the engine's result list, in its order. Nothing is dropped for want of a node.
        cites, seen = [], set()
        for passage in passages:
            nid = str(passage.get("work_id") or "").strip()
            if not nid or nid in seen:
                continue
            seen.add(nid)
            node = {}
            if g is not None and nid in getattr(g, "nodes", {}):
                try:
                    node = g.info(nid)
                except Exception:
                    node = {}
            cites.append(_cite(nid, passage, node, f"[{len(cites) + 1}]"))
        if not record.get("engine", {}).get("ok"):
            # The lexical fallback has no result list of its own: the local graph contributes candidates.
            for nid in seeds:
                if len(cites) >= 8:
                    break
                if nid in seen:
                    continue
                seen.add(nid)
                node = {}
                try:
                    node = g.info(nid)
                except Exception:
                    node = {}
                cites.append(_cite(nid, {}, node, f"[{len(cites) + 1}]"))

        keep = {c["id"] for c in cites}
        edges, drawn = [], set()
        if g is not None:
            for nid in list(keep):
                try:
                    for out in g.neighbors(nid, "out"):
                        if out in keep and (nid, out) not in drawn:
                            drawn.add((nid, out))
                            edges.append({"src": nid, "dst": out})
                    for inc in g.neighbors(nid, "in"):
                        if inc in keep and (inc, nid) not in drawn:
                            drawn.add((inc, nid))
                            edges.append({"src": inc, "dst": nid})
                except Exception:
                    continue
            run.event(
                A,
                "expand",
                f"1-hop {g.backend} traversal over the {len(keep)} retrieved authorities: {len(edges)} edges among them",
                backend=g.backend,
            )

        graph_source = (record.get("graph") or {}).get("source") or ""
        if edges:
            graph_source = (
                "local-citation-edges" if not graph_source or graph_source.startswith(("not reported", "none")) else graph_source + " + local-citation-edges"
            )
        elif not graph_source:
            graph_source = "none"
        retrieval = {
            "source": record.get("source") or psrc or "none",
            "stages": record.get("stages") or [],
            "graph": {"source": graph_source, "revision": (record.get("graph") or {}).get("revision")},
            "engine": record.get("engine") or {"configured": engine.configured(), "ok": False, "reason": "not reported"},
        }
        coverage = _coverage(question, cites)

        try:
            from app import octo_retriever as _octo

            docs = [dict(g.info(p["work_id"]), passage=p["text"], ref="") for p in passages if p["work_id"] not in keep][:10] if g is not None else []
            heads = _octo.first_chunks([c["id"] for c in cites + docs if str(c.get("type")) == "caselaw"])
            for c in cites + docs:
                if c["id"] in heads:
                    c["origin_text"] = heads[c["id"]]
        except Exception:
            docs = []

        tracing.oi(
            _sp,
            openinference__span__kind="RETRIEVER",
            input__value=question,
            output__value=f"{len(cites)} authorities, {len(edges)} graph edges, path={retrieval['source']}",
        )
        for _i, _c in enumerate(cites[:10]):
            tracing.oi(
                _sp,
                **{
                    f"retrieval__documents__{_i}__document__id": str(_c.get("id")),
                    f"retrieval__documents__{_i}__document__content": (_c.get("title", "") + " — " + (_c.get("passage") or ""))[:1500],
                    f"retrieval__documents__{_i}__document__score": float(_c.get("score") or (10 - _i)),
                    f"retrieval__documents__{_i}__document__metadata": {
                        "ref": _c.get("ref"),
                        "court": _c.get("court"),
                        "date": _c.get("date"),
                        "type": _c.get("type"),
                    },
                },
            )
        try:
            run.event(
                A,
                "ranked",
                f"{len(cites)} authorities in retrieval order",
                citations=[
                    {
                        k: (c.get(k) or "")[:600] if k == "passage" else c.get(k)
                        for k in ("id", "ref", "title", "type", "court", "date", "url", "passage", "origin_text", "path", "cited_by", "missing")
                    }
                    for c in cites
                ],
                edges=edges[:80],
                retrieval=retrieval,
                coverage=coverage,
            )
        except Exception:
            pass
        run.release(A, handoff_to="answer", summary=f"retrieved {len(cites)} authorities in the order the index returned them")
    return {
        "citations": cites,
        "edges": edges,
        "seeds": seeds,
        "passage_source": psrc,
        "documents": docs,
        "retrieval": retrieval,
        "coverage": coverage,
        "graph_error": gerr,
    }


def _coverage(question, cites):
    """Whether the retrieved authorities address the question, said plainly.

    `off_corpus` when the question names no subject to search for, when nothing came back, or when the
    best authority shares no word with the question and scored no better than nothing.
    """
    terms = content_terms(question)
    if not terms:
        return "off_corpus"
    if not cites:
        return "off_corpus"
    top = cites[0]
    hay = (str(top.get("title") or "") + " " + str(top.get("passage") or "")).lower()
    overlap = sum(1 for term in set(terms) if term in hay)
    score = top.get("score")
    if overlap == 0 and isinstance(score, (int, float)) and not isinstance(score, bool) and score <= 0:
        return "off_corpus"
    return "on_point"


NO_AUTHORITY = (
    "**Short answer:** I found no authority on point, so there is nothing to cite. Precedent searches the "
    "Colorado and federal opinions and statutes it indexes; ask a legal question about that corpus and it "
    "will return the authorities it finds.\n\n"
    "### Key authorities\nNone: the index returned nothing that addresses this question.\n\n"
    "### Caveat\nNo authority was retrieved, so nothing here is legal advice."
)


def unavailable_answer(reason):
    return (
        "**Short answer:** I cannot answer from the index right now: the retrieval engine did not answer "
        f"({reason}), so there is no authority to cite. Nothing here is a legal answer.\n\n"
        "### Key authorities\nNone: retrieval did not run, so no authority was retrieved.\n\n"
        "### Caveat\nAsk again once the engine answers; until then this memo has no support."
    )


def _clip(t, n):
    t = " ".join((t or "").split())
    return t if len(t) <= n else t[:n].rsplit(" ", 1)[0] + " ..."


def template_answer(question, cites):
    first = cites[0]
    out = [
        f"**Short answer:** AI drafting was unavailable for this question, so no synthesized answer was generated; the top retrieved authority is **{first['title']}** {first['ref']} - review the key authorities below.",
        "",
        "### Key authorities",
    ]
    for c in cites[:5]:
        q = (
            f' - "{_clip(c["passage"].split(chr(10), 1)[-1], 160)}"'
            if c.get("passage")
            else (f" - {str(c.get('type') or '').replace('_', ' ')}" + (f", cited by {c['cited_by']}" if c.get("cited_by") else ""))
        )
        out.append(f"- **{c['title']}** {c['ref']}{q}")
    out += ["", "### Caveat", "Template summary (offline mode) built only from retrieved authorities; verify against the full opinions."]
    return "\n".join(out)


def answer(run, question, ret, prior=None):
    A = "answer"
    run.claim(A, "cited answer")
    with tracing.span("answer") as _sp:
        cites = ret["citations"]
        ctx = "\n".join(
            f"{c['ref']} {c['title']} ({c.get('type') or 'authority'}, {c.get('court') or 'court not recorded'} {c.get('date') or ''})"
            + (f"\n   passage: {_clip(c['passage'], 350)}" if c.get("passage") else "")
            for c in cites
        )
        sys_p = (
            "You are a legal research associate writing a brief internal research memo for attorneys. Professional memo tone; state holdings precisely and note jurisdiction. Use ONLY the numbered authorities given; cite them as [n]; never cite anything else. "
            "Reply in short Markdown, <=150 words, exactly this shape:\n**Short answer:** one or two sentences with [n] cites.\n\n"
            "### Key authorities\n- **Case or statute name** [n] - \"one short quote from its passage\"\n(3-4 bullets)\n\n"
            "### Caveat\nOne sentence on limits (jurisdiction, facts, verify)."
        )
        umsg = (
            f"Earlier question: {prior[0]}\nEarlier bottom line: {prior[1]}\nFollow-up question (answer this, using the earlier context): "
            if prior
            else "Question: "
        ) + f"{question}\nAuthorities:\n{ctx}"
        _pf = run.dir / "partial.txt"
        _t0 = time.time()
        _first = []

        def _delta(t):
            if not _first:
                _first.append(1)
                run.event(A, "first_token", f"first tokens streaming after {time.time() - _t0:.2f}s", ttft_s=round(time.time() - _t0, 2))
            try:
                _pf.write_text(t)
            except Exception:
                pass

        from app import llm as _llm

        _llm.LAST_ERR.clear()
        text, provider = _llm.complete_stream(sys_p, umsg, 400, on_delta=_delta, fallback=lambda: template_answer(question, cites))
        if provider.startswith("template") and _llm.LAST_ERR:
            run.event(A, "llm_error", "model call failed, honest template fallback: " + ", ".join(f"{k}={v}" for k, v in _llm.LAST_ERR.items()))
        tracing.oi(
            _sp,
            openinference__span__kind="LLM",
            llm__model_name="",
            llm__provider="anthropic",
            llm__system="anthropic",
            llm__invocation_parameters={"max_tokens": 400},
            llm__input_messages__0__message__role="system",
            llm__input_messages__0__message__content=sys_p,
            llm__input_messages__1__message__role="user",
            llm__input_messages__1__message__content=f"Question: {question}\nAuthorities:\n{ctx}"[:4000],
            llm__output_messages__0__message__role="assistant",
            llm__output_messages__0__message__content=text,
            input__value=question,
            output__value=text,
            metadata={"provider": provider},
            llm__token_count__prompt=int(len((sys_p + ctx + question).split()) * 1.3),
            llm__token_count__completion=int(len(text.split()) * 1.3),
        )
        run.event(A, "draft", f"drafted answer via {provider}", provider=provider)
        run.release(A, handoff_to="safeguard", summary=f"answer drafted ({len(text.split())} words)")
    return {"text": text, "provider": provider}


# --- the support checker ------------------------------------------------------------------------

_QUOTE = re.compile(r'["\u201c]([^"\u201d]{12,})["\u201d]')


def _cited_span(cite, sentence):
    """The exact span of the cited passage the claim leans on, and the chunk it comes from."""
    passages = [p for p in (cite.get("passages") or []) if p.get("chunk_id")]
    if not passages and cite.get("chunk_id"):
        passages = [{"chunk_id": cite["chunk_id"], "text": cite.get("passage") or ""}]
    quote = _QUOTE.search(sentence)
    if quote:
        for needle in (quote.group(1), " ".join(quote.group(1).split())):
            if not needle:
                continue
            for p in passages:
                raw = p.get("text") or ""
                at = raw.find(needle)
                if at >= 0:
                    return p["chunk_id"], raw[at : at + len(needle)]
    for p in passages:  # no quote in the claim: the passage itself is the cited text, verbatim
        raw = p.get("text") or ""
        if raw.strip():
            return p["chunk_id"], raw[:1500]
    return None, None


def support_claims(text, cites):
    """One claim per cited sentence: the sentence, the span it cites, and the chunk that span lives in."""
    by_ref = {c["ref"]: c for c in cites if c.get("ref")}
    claims, unchecked = [], []
    for sentence in re.split(r"(?<=[.!?])\s+", " ".join((text or "").split())):
        refs = re.findall(r"\[\d+\]", sentence)
        if not refs:
            continue
        cite = by_ref.get(refs[0])
        if cite is None:
            continue  # an invented reference: the citation guard already reports it
        chunk_id, cited_text = _cited_span(cite, sentence)
        if not chunk_id or not cited_text:
            unchecked.append(refs[0])
            continue
        claims.append({"text": sentence[:4000], "cited_text": cited_text[:20000], "citation": refs[0], "chunk_id": chunk_id})
        if len(claims) >= 50:
            break
    return claims, unchecked


def _support(text, cites):
    """Ask the engine's checker whether the cited passages support each claim. Never a pass by default."""
    claims, unchecked = support_claims(text, cites)
    support = {"ran": False, "claims": len(claims), "unchecked": unchecked, "scorer": engine.SCORER, "threshold": engine.CHECK_THRESHOLD}
    if not claims:
        support["reason"] = "no cited passage to check"
        return support
    try:
        result = engine.check(claims)
    except engine.EngineError as failure:
        support["reason"] = failure.reason
        if failure.detail:
            support["detail"] = failure.detail
        return support
    support.update(
        ran=True,
        abstain=bool(result.get("abstain")),
        answer_confidence=result.get("answer_confidence"),
        threshold=result.get("threshold", engine.CHECK_THRESHOLD),
        unverified_quotes=result.get("unverified_quotes") or [],
        quotes=result.get("quotes") or [],
        decider=result.get("decider"),
        model_version=result.get("model_version"),
        latency_ms=result.get("latency_ms"),
        aggregation=result.get("aggregation"),
    )
    return support


def safeguard(run, question, ret, ans):
    A = "safeguard"
    run.claim(A, "eval + citation guard")
    with tracing.span("safeguard") as _sp:
        cites = ret["citations"]
        valid = {c["ref"] for c in cites}
        text = ans["text"]

        def check_refs():
            used = set(re.findall(r"\[\d+\]", text))
            bad = sorted(used - valid)
            return used, bad

        def check_named():
            # authority-shaped strings in the answer that are not in the retrieved set
            # verbatim quotes from retrieved passages are grounded; don't treat citations inside them as new authorities
            corpus = " ".join(" ".join((c.get("passage") or "").split()) for c in cites)
            body = re.sub(r'"([^"]{20,})"', lambda m: "" if m.group(1).rstrip(" .").replace(" ...", "") in corpus else m.group(0), text)
            pats = re.findall(r"(\d+\s+(?:U\.S\.C\.|C\.F\.R\.|CFR|P\.[23]d|P\.|U\.S\.|F\.[234]d|B\.R\.)\s*§?\s*[\d\-\.]+|C\.R\.S\.\s*§\s*[\d\-\.]+\d)", body)
            known = " ".join(c["id"] + " " + str(c.get("title") or "") for c in cites)
            return [p for p in pats if p.strip() not in known]

        def check_claims():
            sents = [s for s in re.split(r"(?<=[.!?])\s+", text) if len(s.split()) > 6]
            return [s for s in sents if not re.search(r"\[\d+\]", s)]

        with ThreadPoolExecutor(3) as ex:  # parallel checks
            f1, f2, f3 = ex.submit(check_refs), ex.submit(check_named), ex.submit(check_claims)
            (used, bad), unknown, unsupported = f1.result(), f2.result(), f3.result()
        regex_pass = not bad and not unknown and bool(used)
        support = _support(text, cites)
        passed = regex_pass and bool(support.get("ran")) and not support.get("abstain")
        run.event(
            A,
            "checks",
            f"{len(used)} citations used, {len(bad)} invalid refs, {len(unknown)} unknown authorities, {len(unsupported)} uncited claims; "
            + (
                f"support check {'abstained' if support.get('abstain') else 'accepted'} (confidence {support.get('answer_confidence')})"
                if support.get("ran")
                else f"support check did not run ({support.get('reason')})"
            ),
            used=sorted(used),
            invalid=bad,
            unknown=unknown,
            unsupported=unsupported,
            support=support,
        )
        _sent = max(1, len([x for x in text.replace("\n", " ").split(". ") if len(x.split()) > 4]))
        _g = round(max(0.0, 1 - len(unsupported) / _sent), 3)
        tracing.oi(
            _sp,
            openinference__span__kind="GUARDRAIL",
            input__value=text,
            output__value="PASS" if passed else "FAIL",
            eval__citation_guard__label="pass" if regex_pass else "fail",
            eval__citation_guard__score=1.0 if regex_pass else 0.0,
            eval__citation_guard__explanation=f"{len(used)} cites used; invalid={bad}; unknown={unknown}",
            eval__support__label="pass" if (support.get("ran") and not support.get("abstain")) else "fail",
            eval__support__score=support.get("answer_confidence") if support.get("answer_confidence") is not None else 0.0,
            eval__support__explanation=(
                f"scorer={support.get('scorer')} threshold={support.get('threshold')} abstain={support.get('abstain')} unverified_quotes={support.get('unverified_quotes')}"
                if support.get("ran")
                else f"the checker did not run: {support.get('reason')}"
            ),
            eval__groundedness__label="grounded" if _g >= 0.7 else "partially_grounded",
            eval__groundedness__score=_g,
            eval__groundedness__explanation=f"{len(unsupported)} of ~{_sent} sentences lack a retrieved citation (heuristic, no LLM call)",
        )
        run.release(A, status="pass" if passed else "fail", summary="PASS" if passed else "FAIL")
    return {
        "pass": passed,
        "regex_pass": regex_pass,
        "used": sorted(used),
        "invalid": bad,
        "unknown_authorities": unknown,
        "unsupported_claims": unsupported,
        "support": support,
        "abstain": support.get("abstain"),
        "answer_confidence": support.get("answer_confidence"),
        "disclaimer": DISCLAIMER,
    }


def _bottom_line(a):
    import re as _re

    m = _re.search(r"(?:short answer|bottom line)[:*\s]*(.+)", a or "", _re.I)
    t = m.group(1) if m else (a or "")
    return _re.sub(r"\*\*|\[\d+\]|[*#>`]", "", t).strip()[:300]


def _graph_unavailable(run, question, session, prev, t0, err):
    """Neither the engine nor the local graph can retrieve: finish the run with a clear answer instead of raising."""
    run.event("retriever", "graph_unavailable", f"no retrieval path is available ({err[:200]})")
    text = (
        "**Short answer:** Legal graph data not loaded - the citation graph (data/nodes.jsonl, data/edges.jsonl) is missing or empty "
        "and the retrieval engine is not configured, so no authorities could be retrieved. Restore the graph data or point "
        "ENGINE_BASE_URL at the engine and restart the server, then ask again."
    )
    sg = {
        "pass": False,
        "regex_pass": False,
        "used": [],
        "invalid": [],
        "unknown_authorities": [],
        "unsupported_claims": [],
        "support": {"ran": False, "reason": "retrieval did not run", "claims": 0},
        "disclaimer": DISCLAIMER,
    }
    res = {
        "run_id": run.id,
        "question": question,
        "session_id": session,
        "prev_run_id": (prev or {}).get("run_id"),
        "standalone_query": None,
        "answer": text,
        "provider": "template:graph-unavailable",
        "safeguard": sg,
        "citations": [],
        "edges": [],
        "seeds": [],
        "backend": "unavailable",
        "elapsed_s": round(time.time() - t0, 2),
        "passage_source": None,
        "documents": [],
        "coverage": "retrieval_unavailable",
        "retrieval": {
            "source": "none",
            "stages": [],
            "graph": {"source": "unavailable", "revision": None},
            "engine": {"configured": engine.configured(), "ok": False, "reason": err[:200]},
        },
        "error": "graph_data_not_loaded",
    }
    (run.dir / "result.json").write_text(json.dumps(res, indent=2))
    run.event("planner", "done", f"pipeline stopped in {res['elapsed_s']}s - no retrieval path available")
    return res


def run_pipeline(question, run_id=None, prev=None):
    """Runs the pipeline with the run id in context so cache rows (answers, retrievals) are linked to this run in Octo."""
    from app import octocache

    rid = run_id or time.strftime("%H%M%S-") + uuid.uuid4().hex[:6]
    with octocache.run_context(rid):
        return _run_pipeline(question, rid, prev)


def _run_pipeline(question, run_id, prev=None):
    from app import retention

    retention.prune_runs(keep=run_id)  # saved runs are first-in-first-out: the oldest goes before this one
    run = Run(run_id)
    t0 = time.time()
    run.claim("planner", "orchestrator")
    run.event("planner", "plan", "plan: retrieve -> answer -> safeguard", question=question)
    prior = None
    query = question
    session = run.id
    extra = None
    if prev:
        prior = (prev.get("question", ""), _bottom_line(prev.get("answer", "")))
        session = prev.get("session_id") or prev.get("run_id") or run.id
        query = f"{question} — in context of: {prior[0]}"
        extra = [c.get("id") or c.get("node") for c in prev.get("citations", []) if c.get("ref")] or prev.get("seeds", [])
        extra = [x for x in extra if x]
        run.event("planner", "rewrite", f"follow-up rewritten to standalone query: {query[:160]}", question=query)
    run.release("planner", handoff_to="retriever", summary="dispatched retriever")
    g, _gerr = _graph_or_none()
    if _gerr and not engine.configured():
        return _graph_unavailable(run, question, session, prev, t0, _gerr)
    with tracing.span("pipeline", question=question) as _sp:
        ret = retriever(run, query, extra)
        if ret["coverage"] == "on_point":
            ans = answer(run, question, ret, prior)
        else:
            # Nothing addresses the question: say so, and do not dress the unrelated authorities as the answer.
            path = ret.get("retrieval") or {}
            reason = (path.get("engine") or {}).get("reason") or "the index returned nothing on point"
            nothing = not ret["citations"] and not (path.get("engine") or {}).get("ok")
            text = unavailable_answer(reason) if nothing else NO_AUTHORITY
            ret["citations"], ret["edges"] = [], []
            run.claim("answer", "scope answer")
            run.event("answer", "scope", f"no authority on point: {reason[:200]}")
            run.release("answer", handoff_to="safeguard", summary="no authority on point")
            ans = {"text": text, "provider": "scope:no-authority"}
        sg = safeguard(run, question, ret, ans)
        tracing.oi(
            _sp,
            input__value=question,
            output__value=ans["text"],
            session__id=session,
            metadata={
                "run_id": run.id,
                "prev_run_id": (prev or {}).get("run_id"),
                "followup": bool(prev),
                "safeguard": "PASS" if sg["pass"] else "FAIL",
                "provider": ans["provider"],
                "retrieval": ret["retrieval"].get("source"),
                "coverage": ret["coverage"],
            },
        )
    res = {
        "run_id": run.id,
        "question": question,
        "session_id": session,
        "prev_run_id": (prev or {}).get("run_id"),
        "standalone_query": query if prev else None,
        "answer": ans["text"],
        "provider": ans["provider"],
        "safeguard": sg,
        "citations": ret["citations"],
        "edges": ret["edges"],
        "seeds": ret["seeds"],
        "backend": g.backend if g is not None else "none",
        "elapsed_s": round(time.time() - t0, 2),
        "passage_source": ret.get("passage_source"),
        "documents": ret.get("documents", []),
        "retrieval": ret["retrieval"],
        "coverage": ret["coverage"],
    }
    (run.dir / "result.json").write_text(json.dumps(res, indent=2))
    run.event("planner", "done", f"pipeline complete in {res['elapsed_s']}s — safeguard {'PASS' if sg['pass'] else 'FAIL'}")
    return res


if __name__ == "__main__":
    r = run_pipeline(" ".join(sys.argv[1:]) or "When can police search a vehicle without a warrant?")
    try:
        from acs import board as acs_board

        sg = r["safeguard"]
        acs_board.oio_record(
            f"run-{r['run_id']}",
            f"CLI demo run {r['run_id']}: '{r['question'][:200]}' -> safeguard {'PASS' if sg['pass'] else 'FAIL'}; {len(sg['used'])} citations, invalid={sg['invalid']}, model={r['provider']}, passages={r.get('passage_source')}",
            ["legal-graphrag-demo pipeline (CLI)"],
            impact_band="informational" if sg["pass"] else "moderate",
            evidence="confirmed",
            extra_session=f"runs/{r['run_id']}/events.jsonl",
        )
    except Exception as e:
        print("acs log failed:", e)
    print(json.dumps({k: r[k] for k in ("run_id", "answer", "provider", "backend", "elapsed_s")}, indent=2))
    print("safeguard:", r["safeguard"]["pass"])
