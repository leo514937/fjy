from __future__ import annotations

from langgraph.graph import END, START, StateGraph

from ontology_audit_hub.domain.audit.models import (
    QARouteTraceStep,
    QASourceResult,
    QuestionAnswerEvidence,
    QuestionAnswerResponse,
)
from ontology_audit_hub.graphs.qa_state import QAState


def build_question_answer_graph(*, llm_adapter, rag_reader, graph_reader):
    def validate_request(state: QAState) -> QAState:
        request = state["qa_request"]
        route_trace = list(state.get("route_trace", []))
        route_trace.append(
            QARouteTraceStep(
                stage="validate_request",
                status="processed",
                detail="Validated QA request payload.",
            )
        )
        source_results = list(state.get("source_results", []))
        if request.graph_ref is None:
            source_results = _set_source_result(
                source_results,
                QASourceResult(
                    source_type="graph_ref",
                    status="skipped",
                    summary="Graph reference was not provided.",
                ),
            )
        if request.rag_ref is None:
            source_results = _set_source_result(
                source_results,
                QASourceResult(
                    source_type="rag_ref",
                    status="skipped",
                    summary="RAG reference was not provided.",
                ),
            )
        return {
            **state,
            "route_trace": route_trace,
            "source_results": source_results,
            "warnings": list(state.get("warnings", [])),
            "rag_hits": list(state.get("rag_hits", [])),
            "graph_hits": list(state.get("graph_hits", [])),
            "graph_paths": list(state.get("graph_paths", [])),
        }

    def fetch_rag_context(state: QAState) -> QAState:
        request = state["qa_request"]
        route_trace = list(state.get("route_trace", []))
        source_results = list(state.get("source_results", []))
        warnings = list(state.get("warnings", []))

        rag_ref = request.rag_ref
        if rag_ref is None:
            route_trace.append(
                QARouteTraceStep(stage="fetch_rag_context", status="skipped", detail="No RAG reference provided.")
            )
            return {**state, "route_trace": route_trace, "source_results": source_results, "warnings": warnings}

        try:
            hits = rag_reader.search(rag_ref, request.question)
        except Exception as exc:
            warnings.append(f"RAG query failed: {exc}")
            route_trace.append(
                QARouteTraceStep(stage="fetch_rag_context", status="degraded",
                                 detail=f"RAG query failed: {exc}")
            )
            source_results = _set_source_result(
                source_results,
                QASourceResult(source_type="rag_ref", status="degraded",
                               summary=f"RAG source could not be queried: {exc}"),
            )
            return {**state, "route_trace": route_trace, "source_results": source_results,
                    "warnings": warnings, "rag_hits": []}

        route_trace.append(
            QARouteTraceStep(stage="fetch_rag_context", status="processed",
                             detail=f"Retrieved {len(hits)} RAG hit(s).")
        )
        source_results = _set_source_result(
            source_results,
            QASourceResult(source_type="rag_ref", status="processed",
                           summary=f"Retrieved {len(hits)} RAG hit(s)."),
        )
        return {**state, "route_trace": route_trace, "source_results": source_results,
                "warnings": warnings, "rag_hits": hits}

    def fetch_graph_context(state: QAState) -> QAState:
        request = state["qa_request"]
        route_trace = list(state.get("route_trace", []))
        source_results = list(state.get("source_results", []))
        warnings = list(state.get("warnings", []))

        graph_ref = request.graph_ref
        if graph_ref is None:
            route_trace.append(
                QARouteTraceStep(stage="fetch_graph_context", status="skipped", detail="No graph reference provided.")
            )
            return {**state, "route_trace": route_trace, "source_results": source_results, "warnings": warnings}

        ontology_tags = []
        for hit in list(state.get("rag_hits", [])):
            ontology_tags.extend(hit.ontology_tags)

        try:
            graph_hits, graph_paths = graph_reader.query(
                request.graph_ref,
                request.question,
                ontology_tags,
            )
        except Exception as exc:
            warnings.append(f"Graph query failed: {exc}")
            route_trace.append(
                QARouteTraceStep(
                    stage="fetch_graph_context",
                    status="degraded",
                    detail=f"Graph query failed: {exc}",
                )
            )
            source_results = _set_source_result(
                source_results,
                QASourceResult(
                    source_type="graph_ref",
                    status="degraded",
                    summary=f"Graph source could not be queried: {exc}",
                ),
            )
            return {
                **state,
                "route_trace": route_trace,
                "source_results": source_results,
                "warnings": warnings,
                "graph_hits": [],
                "graph_paths": [],
            }

        route_trace.append(
            QARouteTraceStep(
                stage="fetch_graph_context",
                status="processed",
                detail=f"Retrieved {len(graph_hits)} graph hit(s).",
            )
        )
        summary = "No matching graph entities found." if not graph_hits else f"Retrieved {len(graph_hits)} graph hit(s)."
        source_results = _set_source_result(
            source_results,
            QASourceResult(
                source_type="graph_ref",
                status="processed",
                summary=summary,
            ),
        )
        return {
            **state,
            "route_trace": route_trace,
            "source_results": source_results,
            "warnings": warnings,
            "graph_hits": graph_hits,
            "graph_paths": graph_paths,
        }

    def synthesize_answer(state: QAState) -> QAState:
        route_trace = list(state.get("route_trace", []))
        source_results = _sorted_source_results(list(state.get("source_results", [])))
        warnings = list(state.get("warnings", []))
        rag_hits = list(state.get("rag_hits", []))
        graph_hits = list(state.get("graph_hits", []))
        graph_paths = list(state.get("graph_paths", []))
        has_evidence = bool(rag_hits or graph_hits)
        llm_available, llm_detail = _llm_ready(llm_adapter)
        all_sources_skipped = bool(source_results) and all(result.status == "skipped" for result in source_results)

        if not has_evidence:
            if all_sources_skipped:
                llm_only_detail = "No external knowledge references were provided."
                warnings.append("No external knowledge sources were used for this answer.")
            else:
                llm_only_detail = "No external knowledge evidence was available after querying the provided sources."
                warnings.append("External knowledge sources returned no matching evidence for this question.")
            route_trace.append(
                QARouteTraceStep(
                    stage="llm_only",
                    status="processed" if llm_available else "degraded",
                    detail=llm_only_detail,
                )
            )

        answer: str | None = None
        llm_failure: str | None = None

        if llm_available:
            try:
                answer = llm_adapter.answer_question(
                    state["qa_request"].question,
                    source_results=source_results,
                    route_trace=route_trace,
                    rag_hits=rag_hits,
                    graph_hits=graph_hits,
                    graph_paths=graph_paths,
                    warnings=warnings,
                )
            except Exception as exc:
                llm_failure = str(exc)
                warnings.append(f"LLM answer generation failed: {exc}")

        if answer:
            route_trace.append(
                QARouteTraceStep(
                    stage="synthesize_answer",
                    status="processed",
                    detail="Generated answer with LLM support.",
                )
            )
        elif has_evidence:
            answer = _build_template_answer(state["qa_request"].question, rag_hits, graph_hits, graph_paths)
            detail = "Generated template answer because the LLM was unavailable."
            if llm_failure:
                detail = "Generated template answer after LLM generation failed."
            route_trace.append(
                QARouteTraceStep(
                    stage="synthesize_answer",
                    status="processed",
                    detail=detail,
                )
            )
        else:
            message = "Unable to answer because no external knowledge evidence was available and the LLM is unavailable."
            if llm_detail:
                warnings.append(f"LLM unavailable: {llm_detail}")
            if llm_failure:
                warnings.append(f"LLM generation error: {llm_failure}")
            route_trace.append(
                QARouteTraceStep(
                    stage="synthesize_answer",
                    status="degraded",
                    detail=message,
                )
            )
            return {
                **state,
                "route_trace": route_trace,
                "source_results": source_results,
                "warnings": warnings,
                "error_status": 503,
                "error_message": message,
            }

        response = QuestionAnswerResponse(
            answer=answer,
            source_results=source_results,
            evidence=QuestionAnswerEvidence(
                rag_hits=rag_hits,
                graph_hits=graph_hits,
                graph_paths=graph_paths,
            ),
            route_trace=route_trace,
            warnings=list(dict.fromkeys(warnings)),
        )
        return {
            **state,
            "route_trace": route_trace,
            "source_results": source_results,
            "warnings": warnings,
            "answer": answer,
            "qa_response": response,
            "error_status": None,
            "error_message": None,
        }

    graph = StateGraph(QAState)
    graph.add_node("validate_request", validate_request)
    graph.add_node("fetch_rag_context", fetch_rag_context)
    graph.add_node("fetch_graph_context", fetch_graph_context)
    graph.add_node("synthesize_answer", synthesize_answer)
    graph.add_edge(START, "validate_request")
    graph.add_edge("validate_request", "fetch_rag_context")
    graph.add_edge("fetch_rag_context", "fetch_graph_context")
    graph.add_edge("fetch_graph_context", "synthesize_answer")
    graph.add_edge("synthesize_answer", END)
    return graph.compile()


def _set_source_result(results: list[QASourceResult], result: QASourceResult) -> list[QASourceResult]:
    remaining = [item for item in results if item.source_type != result.source_type]
    remaining.append(result)
    return remaining


def _sorted_source_results(results: list[QASourceResult]) -> list[QASourceResult]:
    order = {"graph_ref": 0, "rag_ref": 1}
    return sorted(results, key=lambda item: order.get(item.source_type, 99))


def _llm_ready(llm_adapter) -> tuple[bool, str]:
    try:
        ready, detail = llm_adapter.check_ready()
        return bool(ready), str(detail)
    except Exception as exc:
        return False, str(exc)


def _build_template_answer(question: str, rag_hits, graph_hits, graph_paths: list[str]) -> str:
    parts = [f"Question: {question}"]
    if rag_hits:
        rag_summary = "; ".join(
            f"{hit.source_file}#{hit.section}: {hit.content[:120]}"
            for hit in rag_hits[:3]
        )
        parts.append(f"RAG evidence: {rag_summary}")
    if graph_hits:
        graph_summary = "; ".join(
            f"{hit.entity} -> {', '.join(hit.related_entities) or 'no direct neighbors surfaced'}"
            for hit in graph_hits[:3]
        )
        parts.append(f"Graph evidence: {graph_summary}")
    if graph_paths:
        parts.append(f"Graph paths: {'; '.join(graph_paths[:5])}")
    parts.append("Answer generated from available external knowledge because the LLM was unavailable.")
    return "\n".join(parts)
