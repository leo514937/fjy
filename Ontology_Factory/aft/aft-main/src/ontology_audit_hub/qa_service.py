from __future__ import annotations

import asyncio
import inspect
import logging
import threading
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any

from ontology_audit_hub.domain.audit.models import (
    ChatHistoryMessage,
    QAGraphHit,
    QARouteTraceStep,
    QASourceResult,
    QuestionAnswerErrorResponse,
    QuestionAnswerEvidence,
    QuestionAnswerRequest,
    QuestionAnswerResponse,
    RAGReference,
    RetrievalHit,
)
from ontology_audit_hub.infra.llm.base import NullStructuredLLMAdapter
from ontology_audit_hub.infra.llm.pydantic_ai_adapter import PydanticAILLMAdapter
from ontology_audit_hub.infra.qa_sources import (
    GraphReaderProtocol,
    Neo4jReferenceReader,
    QdrantReferenceReader,
    RAGReaderProtocol,
    RAGSearchResult,
)
from ontology_audit_hub.infra.settings import AuditHubSettings

MAX_CHAT_HISTORY_MESSAGES = 8
UNABLE_TO_ANSWER_MESSAGE = (
    "Unable to answer because the LLM is unavailable and no external knowledge evidence could be used."
)

logger = logging.getLogger(__name__)


@dataclass
class RetrievalDecision:
    use_rag: bool = False
    use_graph: bool = False
    detail: str = "No external retrieval was triggered for this request."


@dataclass
class PreparedQuestionAnswerContext:
    request: QuestionAnswerRequest
    route_trace: list[QARouteTraceStep] = field(default_factory=list)
    source_results: list[QASourceResult] = field(default_factory=list)
    rag_hits: list[RetrievalHit] = field(default_factory=list)
    graph_hits: list[QAGraphHit] = field(default_factory=list)
    graph_paths: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    chat_history: list[ChatHistoryMessage] = field(default_factory=list)
    retrieval_decision: RetrievalDecision = field(default_factory=RetrievalDecision)


class QuestionAnswerError(RuntimeError):
    def __init__(self, status_code: int, payload: QuestionAnswerErrorResponse) -> None:
        super().__init__(payload.message)
        self.status_code = status_code
        self.payload = payload


class QuestionAnswerService:
    def __init__(
        self,
        *,
        settings: AuditHubSettings | None = None,
        llm_adapter=None,
        rag_reader: RAGReaderProtocol | None = None,
        graph_reader: GraphReaderProtocol | None = None,
    ) -> None:
        self.settings = settings or AuditHubSettings.from_env()
        self.llm_adapter = llm_adapter or _build_llm_adapter(self.settings)
        self.rag_reader = rag_reader or QdrantReferenceReader(settings=self.settings, llm_adapter=self.llm_adapter)
        self.graph_reader = graph_reader or Neo4jReferenceReader(settings=self.settings)
        self._session_histories: dict[str, list[ChatHistoryMessage]] = {}
        self._session_lock = threading.Lock()

    def close(self) -> None:
        for component in (self.rag_reader, self.graph_reader):
            close = getattr(component, "close", None)
            if callable(close):
                try:
                    close()
                except Exception:
                    continue

    def answer(self, request: QuestionAnswerRequest) -> QuestionAnswerResponse:
        prepared = self._prepare_context(request)
        route_trace = list(prepared.route_trace)
        warnings = list(prepared.warnings)
        fallback_answer = _build_template_answer(prepared.rag_hits, prepared.graph_hits, prepared.graph_paths)

        llm_available, llm_detail = _llm_ready(self.llm_adapter)
        answer: str | None = None
        llm_failure: str | None = None
        if llm_available:
            try:
                answer = self.llm_adapter.answer_question(
                    prepared.request.question,
                    **self._answer_kwargs(prepared, route_trace=route_trace, warnings=warnings),
                )
            except Exception as exc:
                llm_failure = str(exc)
                warnings.append(f"LLM answer generation failed: {exc}")

        if answer:
            answer = _ensure_visible_citations(answer, prepared.rag_hits, prepared.graph_hits)
            route_trace.append(
                QARouteTraceStep(
                    stage="synthesize_answer",
                    status="processed",
                    detail="Generated answer through the unified QA chain.",
                )
            )
            self._record_session_turn(prepared, answer)
            return self._build_response(prepared, answer=answer, route_trace=route_trace, warnings=warnings)

        if fallback_answer is not None:
            detail = (
                "Generated a template answer because the LLM was unavailable."
                if not llm_available and not llm_failure
                else "Generated a template answer because the LLM response was unavailable."
            )
            route_trace.append(QARouteTraceStep(stage="synthesize_answer", status="processed", detail=detail))
            self._record_session_turn(prepared, fallback_answer)
            return self._build_response(prepared, answer=fallback_answer, route_trace=route_trace, warnings=warnings)

        if llm_detail:
            warnings.append(f"LLM unavailable: {llm_detail}")
        if llm_failure:
            warnings.append(f"LLM generation error: {llm_failure}")
        route_trace.append(
            QARouteTraceStep(stage="synthesize_answer", status="degraded", detail=UNABLE_TO_ANSWER_MESSAGE)
        )
        raise QuestionAnswerError(
            status_code=503,
            payload=QuestionAnswerErrorResponse(
                message=UNABLE_TO_ANSWER_MESSAGE,
                route_trace=route_trace,
                warnings=list(dict.fromkeys(warnings)),
            ),
        )
    async def stream_answer(self, request: QuestionAnswerRequest) -> AsyncIterator[dict[str, Any]]:
        prepared = self._prepare_context(request)
        route_trace = list(prepared.route_trace)
        warnings = list(prepared.warnings)
        fallback_answer = _build_template_answer(prepared.rag_hits, prepared.graph_hits, prepared.graph_paths)

        yield self._event("status", {"message": "Preparing answer..."})
        yield self._context_event(prepared, route_trace=route_trace, warnings=warnings)

        llm_available, llm_detail = _llm_ready(self.llm_adapter)
        if not llm_available:
            if fallback_answer is None:
                if llm_detail:
                    warnings.append(f"LLM unavailable: {llm_detail}")
                route_trace = route_trace + [
                    QARouteTraceStep(stage="synthesize_answer", status="degraded", detail=UNABLE_TO_ANSWER_MESSAGE)
                ]
                yield self._event(
                    "error",
                    QuestionAnswerErrorResponse(
                        message=UNABLE_TO_ANSWER_MESSAGE,
                        route_trace=route_trace,
                        warnings=list(dict.fromkeys(warnings)),
                    ).model_dump(mode="json"),
                )
                return

            route_trace = route_trace + [
                QARouteTraceStep(
                    stage="synthesize_answer",
                    status="processed",
                    detail="Generated a template answer because the LLM was unavailable.",
                )
            ]
            self._record_session_turn(prepared, fallback_answer)
            response = self._build_response(prepared, answer=fallback_answer, route_trace=route_trace, warnings=warnings)
            yield self._event("answer_delta", {"delta": fallback_answer})
            yield self._event("complete", response.model_dump(mode="json"))
            return

        yield self._event("status", {"message": "Generating answer..."})
        answer_chunks: list[str] = []
        llm_failure: str | None = None
        try:
            async for delta in self.llm_adapter.stream_answer_question(
                prepared.request.question,
                **self._answer_kwargs(prepared, route_trace=route_trace, warnings=warnings),
            ):
                if not delta:
                    continue
                answer_chunks.append(delta)
                yield self._event("answer_delta", {"delta": delta})
        except Exception as exc:
            llm_failure = str(exc)
            warnings.append(f"LLM answer generation failed: {exc}")

        final_answer = "".join(answer_chunks).strip()
        if final_answer:
            final_answer = _ensure_visible_citations(final_answer, prepared.rag_hits, prepared.graph_hits)
            route_trace = route_trace + [
                QARouteTraceStep(
                    stage="synthesize_answer",
                    status="processed",
                    detail="Generated answer through the unified QA chain.",
                )
            ]
            self._record_session_turn(prepared, final_answer)
            response = self._build_response(prepared, answer=final_answer, route_trace=route_trace, warnings=warnings)
            yield self._event("complete", response.model_dump(mode="json"))
            return

        if fallback_answer is not None:
            route_trace = route_trace + [
                QARouteTraceStep(
                    stage="synthesize_answer",
                    status="processed",
                    detail=(
                        "Generated a template answer because the streamed LLM response was empty."
                        if llm_failure is None
                        else "Generated a template answer after LLM streaming failed."
                    ),
                )
            ]
            self._record_session_turn(prepared, fallback_answer)
            response = self._build_response(prepared, answer=fallback_answer, route_trace=route_trace, warnings=warnings)
            yield self._event("answer_delta", {"delta": fallback_answer})
            yield self._event("complete", response.model_dump(mode="json"))
            return

        if llm_detail:
            warnings.append(f"LLM unavailable: {llm_detail}")
        if llm_failure:
            warnings.append(f"LLM generation error: {llm_failure}")
        route_trace = route_trace + [
            QARouteTraceStep(stage="synthesize_answer", status="degraded", detail=UNABLE_TO_ANSWER_MESSAGE)
        ]
        yield self._event(
            "error",
            QuestionAnswerErrorResponse(
                message=UNABLE_TO_ANSWER_MESSAGE,
                route_trace=route_trace,
                warnings=list(dict.fromkeys(warnings)),
            ).model_dump(mode="json"),
        )

    def _prepare_context(self, request: QuestionAnswerRequest) -> PreparedQuestionAnswerContext:
        normalized_question = request.question.strip()
        normalized_session_id = request.session_id.strip() if request.session_id else None
        history_provided = "history" in request.model_fields_set
        explicit_history = _normalize_chat_history(request.history) if history_provided else []
        session_history = [] if history_provided else self._load_session_history(normalized_session_id)
        chat_history = explicit_history if history_provided else session_history
        normalized_request = request.model_copy(
            update={
                "question": normalized_question,
                "session_id": normalized_session_id,
                "history": chat_history,
            }
        )
        prepared = PreparedQuestionAnswerContext(
            request=normalized_request,
            chat_history=chat_history,
            route_trace=[
                QARouteTraceStep(stage="validate_request", status="processed", detail="Validated QA request payload."),
                QARouteTraceStep(
                    stage="memory_load",
                    status="processed",
                    detail=_memory_detail(
                        history_provided=history_provided,
                        session_id=normalized_session_id,
                        history=chat_history,
                    ),
                ),
            ],
        )

        effective_rag_ref, using_default_rag = _resolve_rag_reference(normalized_request, self.settings)
        effective_graph_ref, using_default_graph = _resolve_graph_reference(normalized_request, self.settings)
        graph_context_enabled = _graph_context_enabled(normalized_request.rag_options, self.settings)

        prepared.retrieval_decision = self._decide_retrieval(
            question=normalized_question,
            chat_history=chat_history,
            rag_available=effective_rag_ref is not None,
            graph_available=graph_context_enabled and effective_graph_ref is not None,
            explicit_rag=normalized_request.rag_ref is not None,
            explicit_graph=normalized_request.graph_ref is not None,
            warnings=prepared.warnings,
        )
        prepared.route_trace.append(
            QARouteTraceStep(
                stage="trigger_decision",
                status="processed",
                detail=prepared.retrieval_decision.detail,
            )
        )

        if prepared.retrieval_decision.use_rag:
            prepared.rag_hits = self._collect_rag_hits(
                prepared,
                reference=effective_rag_ref,
                using_default_source=using_default_rag,
            )
        else:
            self._skip_rag(prepared, reference=effective_rag_ref)

        if prepared.retrieval_decision.use_graph:
            prepared.graph_hits, prepared.graph_paths = self._collect_graph_hits(
                prepared,
                reference=effective_graph_ref,
                using_default_source=using_default_graph,
                enabled=graph_context_enabled,
            )
        else:
            self._skip_graph(prepared, reference=effective_graph_ref, enabled=graph_context_enabled)

        prepared.source_results = _sorted_source_results(prepared.source_results)
        if (prepared.retrieval_decision.use_rag or prepared.retrieval_decision.use_graph) and not _has_usable_evidence(
            prepared.rag_hits, prepared.graph_hits, prepared.graph_paths
        ):
            prepared.warnings.append(
                "Triggered external knowledge sources did not return usable evidence for this question."
            )
        return prepared

    def _decide_retrieval(
        self,
        *,
        question: str,
        chat_history: list[ChatHistoryMessage],
        rag_available: bool,
        graph_available: bool,
        explicit_rag: bool,
        explicit_graph: bool,
        warnings: list[str],
    ) -> RetrievalDecision:
        rule_decision = _rule_based_retrieval_decision(
            question,
            rag_available=rag_available,
            graph_available=graph_available,
        )
        if rule_decision.detail.startswith("Skipped external retrieval for conversational"):
            logger.info(
                "Retrieval trigger skipped for conversational input question=%r rag_available=%s graph_available=%s",
                question[:160],
                rag_available,
                graph_available,
            )
            return rule_decision

        llm_method = getattr(self.llm_adapter, "decide_qa_retrieval", None)
        llm_use_rag = False
        llm_use_graph = False
        llm_detail = ""
        llm_skip_reason = ""
        if callable(llm_method) and (rag_available or graph_available):
            if _running_in_async_context():
                llm_skip_reason = (
                    "Skipped the LLM retrieval trigger because the request is running inside an async server context; using rule-based triggers only."
                )
            else:
                llm_result = None
                try:
                    llm_result = llm_method(
                        question,
                        chat_history=chat_history,
                        rag_available=rag_available,
                        graph_available=graph_available,
                        explicit_rag=explicit_rag,
                        explicit_graph=explicit_graph,
                    )
                except Exception as exc:
                    warnings.append(f"QA retrieval decision failed: {exc}")
                if inspect.isawaitable(llm_result):
                    llm_skip_reason = (
                        "Skipped the LLM retrieval trigger because it returned an awaitable in the synchronous QA preparation path."
                    )
                    close = getattr(llm_result, "close", None)
                    if callable(close):
                        close()
                    llm_result = None
                if llm_result is not None:
                    llm_use_rag, llm_use_graph, llm_detail = llm_result

        use_rag = bool(explicit_rag or rule_decision.use_rag or llm_use_rag) and rag_available
        use_graph = bool(explicit_graph or rule_decision.use_graph or llm_use_graph) and graph_available
        detail_parts = [
            f"Availability: rag={rag_available}, graph={graph_available}.",
            f"Explicit sources: rag={explicit_rag}, graph={explicit_graph}.",
            rule_decision.detail,
        ]
        if explicit_rag and rag_available:
            detail_parts.append("Explicit RAG source enabled document retrieval.")
        if explicit_graph and graph_available:
            detail_parts.append("Explicit graph source enabled graph retrieval.")
        if llm_detail:
            detail_parts.append(f"LLM trigger: {llm_detail}")
        if llm_skip_reason:
            detail_parts.append(llm_skip_reason)
        if not use_rag and not use_graph and not llm_detail and not rule_decision.use_rag and not rule_decision.use_graph:
            detail_parts.append("No retrieval channels were selected.")
        logger.info(
            "Retrieval trigger decision question=%r rag_available=%s graph_available=%s explicit_rag=%s explicit_graph=%s rule_rag=%s rule_graph=%s llm_rag=%s llm_graph=%s use_rag=%s use_graph=%s llm_detail=%s llm_skip_reason=%s",
            question[:160],
            rag_available,
            graph_available,
            explicit_rag,
            explicit_graph,
            rule_decision.use_rag,
            rule_decision.use_graph,
            llm_use_rag,
            llm_use_graph,
            use_rag,
            use_graph,
            llm_detail,
            llm_skip_reason,
        )
        return RetrievalDecision(use_rag=use_rag, use_graph=use_graph, detail=" ".join(part for part in detail_parts if part))
    def _skip_rag(self, prepared: PreparedQuestionAnswerContext, *, reference: RAGReference | None) -> None:
        detail = (
            "Document retrieval was not triggered for this request."
            if reference is not None
            else "No RAG source was available."
        )
        summary = (
            "RAG source was available but was not triggered."
            if reference is not None
            else "RAG reference was not provided."
        )
        prepared.source_results = _set_source_result(
            prepared.source_results,
            QASourceResult(source_type="rag_ref", status="skipped", summary=summary),
        )
        logger.info("RAG recall skipped source_available=%s detail=%s", reference is not None, detail)
        prepared.route_trace.extend(
            [
                QARouteTraceStep(stage="query_rewrite", status="skipped", detail=detail),
                QARouteTraceStep(stage="dense_recall", status="skipped", detail=detail),
                QARouteTraceStep(stage="sparse_recall", status="skipped", detail=detail),
                QARouteTraceStep(stage="rank_fusion", status="skipped", detail=detail),
                QARouteTraceStep(stage="mmr_rerank", status="skipped", detail=detail),
                QARouteTraceStep(stage="pack_context", status="skipped", detail=detail),
            ]
        )

    def _skip_graph(self, prepared: PreparedQuestionAnswerContext, *, reference, enabled: bool) -> None:
        if not enabled:
            detail = "Graph enrichment was disabled by the request options."
            summary = "Graph context was disabled by the request options."
        elif reference is None:
            detail = "No graph source was available."
            summary = "Graph reference was not provided."
        else:
            detail = "Graph retrieval was not triggered for this request."
            summary = "Graph source was available but was not triggered."
        prepared.source_results = _set_source_result(
            prepared.source_results,
            QASourceResult(source_type="graph_ref", status="skipped", summary=summary),
        )
        logger.info("Graph recall skipped source_available=%s enabled=%s detail=%s", reference is not None, enabled, detail)
        prepared.route_trace.append(QARouteTraceStep(stage="graph_enrichment", status="skipped", detail=detail))

    def _collect_rag_hits(
        self,
        prepared: PreparedQuestionAnswerContext,
        *,
        reference: RAGReference | None,
        using_default_source: bool,
    ) -> list[RetrievalHit]:
        if reference is None:
            self._skip_rag(prepared, reference=None)
            return []

        source_label = "default RAG source" if using_default_source else "provided RAG source"
        try:
            search_result = self.rag_reader.search(
                reference,
                prepared.request.question,
                prepared.request.rag_options,
                history=prepared.chat_history,
            )
        except Exception as exc:
            logger.exception("RAG recall failed source=%s question=%r", source_label, prepared.request.question[:200])
            prepared.warnings.append(f"RAG query failed: {exc}")
            prepared.source_results = _set_source_result(
                prepared.source_results,
                QASourceResult(source_type="rag_ref", status="degraded", summary=f"RAG source could not be queried: {exc}"),
            )
            prepared.route_trace.extend(
                [
                    QARouteTraceStep(stage="query_rewrite", status="degraded", detail=f"Failed before retrieval could complete: {exc}"),
                    QARouteTraceStep(stage="dense_recall", status="degraded", detail=f"Failed to query the {source_label}: {exc}"),
                    QARouteTraceStep(stage="sparse_recall", status="skipped", detail="Skipped because RAG recall failed."),
                    QARouteTraceStep(stage="rank_fusion", status="skipped", detail="Skipped because RAG recall failed."),
                    QARouteTraceStep(stage="mmr_rerank", status="skipped", detail="Skipped because RAG recall failed."),
                    QARouteTraceStep(stage="pack_context", status="skipped", detail="Skipped because RAG recall failed."),
                ]
            )
            return []

        hits = _normalize_rag_hits(search_result, prepared.request.rag_options, self.settings)
        prepared.warnings.extend(search_result.warnings)
        prepared.source_results = _set_source_result(
            prepared.source_results,
            QASourceResult(
                source_type="rag_ref",
                status="processed",
                summary=(
                    f"Retrieved {len(hits)} chunk(s) from the {source_label}."
                    if hits
                    else f"The {source_label} returned no matching evidence."
                ),
            ),
        )
        prepared.route_trace.extend(
            [
                QARouteTraceStep(stage="query_rewrite", status=search_result.rewrite.status, detail=search_result.rewrite.detail),
                QARouteTraceStep(
                    stage="dense_recall",
                    status="processed",
                    detail=f"Queried the {source_label} and retrieved {search_result.dense_candidate_count} dense candidate chunk(s).",
                ),
                QARouteTraceStep(
                    stage="sparse_recall",
                    status="processed" if search_result.search_mode.startswith("hybrid") else "skipped",
                    detail=(
                        f"Retrieved {search_result.sparse_candidate_count} sparse candidate chunk(s)."
                        if search_result.search_mode.startswith("hybrid")
                        else "Sparse recall was disabled."
                    ),
                ),
                QARouteTraceStep(
                    stage="rank_fusion",
                    status="processed" if search_result.search_mode.startswith("hybrid") else "skipped",
                    detail=(
                        f"Fused {search_result.fusion_candidate_count} candidate chunk(s) across dense and sparse channels."
                        if search_result.search_mode.startswith("hybrid")
                        else "Skipped because only dense recall was enabled."
                    ),
                ),
                QARouteTraceStep(
                    stage="mmr_rerank",
                    status="processed",
                    detail=f"Selected {search_result.returned_count} chunk(s) after reranking.",
                ),
                QARouteTraceStep(
                    stage="pack_context",
                    status="processed",
                    detail=f"Packed {len(hits)} retrieval chunk(s) into the answer context.",
                ),
            ]
        )
        logger.info(
            "RAG recall complete source=%s mode=%s hits=%s rewrite_applied=%s sample=%s",
            source_label,
            search_result.search_mode,
            len(hits),
            search_result.rewrite.applied,
            [f"{hit.citation_id}:{hit.source_file}#{hit.section}:{hit.content[:80]}" for hit in hits[:3]],
        )
        return hits

    def _collect_graph_hits(
        self,
        prepared: PreparedQuestionAnswerContext,
        *,
        reference,
        using_default_source: bool,
        enabled: bool,
    ) -> tuple[list[QAGraphHit], list[str]]:
        if not enabled:
            self._skip_graph(prepared, reference=reference, enabled=False)
            return [], []
        if reference is None:
            self._skip_graph(prepared, reference=None, enabled=True)
            return [], []

        source_label = "default graph source" if using_default_source else "provided graph source"
        ontology_tags = _collect_ontology_tags(prepared.rag_hits)
        try:
            graph_hits, graph_paths = self.graph_reader.query(reference, prepared.request.question, ontology_tags)
        except Exception as exc:
            prepared.warnings.append(f"Graph query failed: {exc}")
            prepared.source_results = _set_source_result(
                prepared.source_results,
                QASourceResult(source_type="graph_ref", status="degraded", summary=f"Graph source could not be queried: {exc}"),
            )
            prepared.route_trace.append(
                QARouteTraceStep(
                    stage="graph_enrichment",
                    status="degraded",
                    detail=f"Failed to query the {source_label}: {exc}",
                )
            )
            return [], []

        normalized_hits = _normalize_graph_hits(graph_hits)
        deduped_paths = [path for path in dict.fromkeys(graph_paths) if path and path.strip()]
        prepared.source_results = _set_source_result(
            prepared.source_results,
            QASourceResult(
                source_type="graph_ref",
                status="processed",
                summary=(
                    f"Retrieved {len(normalized_hits)} graph hit(s) from the {source_label}."
                    if normalized_hits or deduped_paths
                    else f"The {source_label} returned no matching evidence."
                ),
            ),
        )
        prepared.route_trace.append(
            QARouteTraceStep(
                stage="graph_enrichment",
                status="processed",
                detail=f"Retrieved {len(normalized_hits)} graph hit(s) from the {source_label}.",
            )
        )
        logger.info(
            "Graph recall complete source=%s hits=%s paths=%s sample=%s",
            source_label,
            len(normalized_hits),
            len(deduped_paths),
            [f"{hit.citation_id}:{hit.entity}:{','.join(hit.related_entities[:3])}" for hit in normalized_hits[:3]],
        )
        return normalized_hits, deduped_paths

    def _answer_kwargs(
        self,
        prepared: PreparedQuestionAnswerContext,
        *,
        route_trace: list[QARouteTraceStep],
        warnings: list[str],
    ) -> dict[str, Any]:
        return {
            "source_results": _sorted_source_results(prepared.source_results),
            "route_trace": route_trace,
            "rag_hits": prepared.rag_hits,
            "graph_hits": prepared.graph_hits,
            "graph_paths": prepared.graph_paths,
            "warnings": list(dict.fromkeys(warnings)),
            "chat_history": prepared.chat_history,
        }

    def _build_response(
        self,
        prepared: PreparedQuestionAnswerContext,
        *,
        answer: str,
        route_trace: list[QARouteTraceStep] | None = None,
        warnings: list[str] | None = None,
    ) -> QuestionAnswerResponse:
        return QuestionAnswerResponse(
            answer=answer,
            route_trace=route_trace or list(prepared.route_trace),
            source_results=_sorted_source_results(prepared.source_results),
            evidence=QuestionAnswerEvidence(
                rag_hits=prepared.rag_hits,
                graph_hits=prepared.graph_hits,
                graph_paths=prepared.graph_paths,
            ),
            warnings=list(dict.fromkeys(warnings or prepared.warnings)),
        )

    def _context_event(
        self,
        prepared: PreparedQuestionAnswerContext,
        *,
        route_trace: list[QARouteTraceStep] | None = None,
        warnings: list[str] | None = None,
    ) -> dict[str, Any]:
        payload = {
            "route_trace": [step.model_dump(mode="json") for step in (route_trace or prepared.route_trace)],
            "source_results": [item.model_dump(mode="json") for item in _sorted_source_results(prepared.source_results)],
            "evidence": QuestionAnswerEvidence(
                rag_hits=prepared.rag_hits,
                graph_hits=prepared.graph_hits,
                graph_paths=prepared.graph_paths,
            ).model_dump(mode="json"),
            "warnings": list(dict.fromkeys(warnings or prepared.warnings)),
        }
        return self._event("context", payload)

    def _event(self, event: str, data: dict[str, Any]) -> dict[str, Any]:
        return {"event": event, "data": data}

    def _load_session_history(self, session_id: str | None) -> list[ChatHistoryMessage]:
        if not session_id:
            return []
        with self._session_lock:
            history = self._session_histories.get(session_id, [])
            return [item.model_copy() for item in history]

    def _record_session_turn(self, prepared: PreparedQuestionAnswerContext, answer: str) -> None:
        session_id = prepared.request.session_id
        if not session_id:
            return
        updated_history = _normalize_chat_history(
            [
                *prepared.chat_history,
                ChatHistoryMessage(role="user", content=prepared.request.question),
                ChatHistoryMessage(role="assistant", content=answer),
            ]
        )
        with self._session_lock:
            self._session_histories[session_id] = [item.model_copy() for item in updated_history]

def _build_llm_adapter(settings: AuditHubSettings):
    if not settings.llm_enabled or not settings.llm_model:
        return NullStructuredLLMAdapter()
    try:
        return PydanticAILLMAdapter(settings.llm_model, provider=settings.llm_provider, settings=settings)
    except Exception:
        return NullStructuredLLMAdapter()


def _resolve_rag_reference(
    request: QuestionAnswerRequest,
    settings: AuditHubSettings,
) -> tuple[RAGReference | None, bool]:
    if request.rag_ref is not None:
        return request.rag_ref, False
    if settings.qdrant_enabled and settings.qdrant_url:
        return (
            RAGReference(
                backend="qdrant",
                url=settings.qdrant_url,
                api_key=settings.qdrant_api_key,
                collection_name=settings.qdrant_collection_name,
                top_k=settings.rag_top_k,
            ),
            True,
        )
    return None, False


def _resolve_graph_reference(
    request: QuestionAnswerRequest,
    settings: AuditHubSettings,
):
    if request.graph_ref is not None:
        return request.graph_ref, False
    if settings.neo4j_enabled and settings.neo4j_uri and settings.neo4j_username and settings.neo4j_password:
        from ontology_audit_hub.domain.audit.models import GraphReference

        return (
            GraphReference(
                backend="neo4j",
                uri=settings.neo4j_uri,
                username=settings.neo4j_username,
                password=settings.neo4j_password,
                database=settings.neo4j_database,
            ),
            True,
        )
    return None, False


def _graph_context_enabled(rag_options, settings: AuditHubSettings) -> bool:
    if rag_options is not None and rag_options.enable_graph_context is not None:
        return bool(rag_options.enable_graph_context)
    return bool(settings.rag_enable_graph_context)


def _normalize_chat_history(history: list[ChatHistoryMessage] | None) -> list[ChatHistoryMessage]:
    normalized: list[ChatHistoryMessage] = []
    for item in history or []:
        content = item.content.strip()
        if not content:
            continue
        normalized.append(item.model_copy(update={"content": content}))
    return normalized[-MAX_CHAT_HISTORY_MESSAGES:]


def _memory_detail(*, history_provided: bool, session_id: str | None, history: list[ChatHistoryMessage]) -> str:
    if history_provided:
        return f"Loaded {len(history)} explicit chat history message(s) from the request."
    if session_id and history:
        return f"Loaded {len(history)} chat history message(s) from session '{session_id}'."
    if session_id:
        return f"No stored chat history was found for session '{session_id}'."
    return "No chat history was provided for this request."


def _running_in_async_context() -> bool:
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return False
    return True


def _rule_based_retrieval_decision(question: str, *, rag_available: bool, graph_available: bool) -> RetrievalDecision:
    normalized = " ".join(question.strip().lower().split())
    if not normalized:
        return RetrievalDecision(detail="Question was empty after normalization; no retrieval was triggered.")

    if _is_conversational_turn(normalized):
        return RetrievalDecision(detail="Skipped external retrieval for conversational or recap-style input.")

    graph_keywords = (
        "relationship", "relations", "relation", "connected", "connect", "path", "dependency", "dependencies",
        "depend", "depends", "impact", "upstream", "downstream", "graph", "knowledge graph", "entity",
        "entities", "link", "linked", "generate", "generates", "generated", "关联", "关系", "路径", "依赖",
        "影响", "图谱", "实体", "连接", "生成",
    )
    rag_keywords = (
        "what does", "how does", "why does", "where is", "which", "explain", "describe", "tell me about",
        "api", "endpoint", "schema", "class", "method", "function", "error", "code", "field", "table",
        "document", "rule", "rules", "flow", "process", "approval", "implementation", "design", "spec",
        "接口", "错误码", "类", "方法", "函数", "字段", "表", "文档", "规则", "流程", "审批", "实现", "设计", "规范",
    )

    use_graph = graph_available and any(keyword in normalized for keyword in graph_keywords)
    codeish = any(token in question for token in ("`", "/", "\\", "::", ":"))
    use_rag = rag_available and (codeish or any(keyword in normalized for keyword in rag_keywords) or (len(normalized) > 80))

    if use_rag or use_graph:
        channels: list[str] = []
        if use_rag:
            channels.append("document retrieval")
        if use_graph:
            channels.append("graph retrieval")
        return RetrievalDecision(use_rag=use_rag, use_graph=use_graph, detail=f"Rule trigger selected {', '.join(channels)}.")

    return RetrievalDecision(detail="No strong rule-based retrieval trigger matched.")


def _is_conversational_turn(normalized_question: str) -> bool:
    greetings = {"hi", "hello", "hey", "你好", "您好"}
    if normalized_question in greetings:
        return True

    conversation_phrases = (
        "what did we discuss",
        "summarize our discussion",
        "summarise our discussion",
        "summarize our conversation",
        "summarise our conversation",
        "recap the conversation",
        "what can you do",
        "who are you",
        "thanks",
        "thank you",
        "我们刚才聊了什么",
        "刚才聊了什么",
        "前面说到哪了",
        "回顾一下我们的对话",
        "总结一下我们的对话",
        "你能干什么",
        "你可以做什么",
        "谢谢",
    )
    return any(phrase in normalized_question for phrase in conversation_phrases)


def _normalize_rag_hits(
    search_result: RAGSearchResult,
    rag_options,
    settings: AuditHubSettings,
) -> list[RetrievalHit]:
    max_context_chunks = settings.rag_max_context_chunks
    if rag_options is not None and rag_options.max_context_chunks is not None:
        max_context_chunks = rag_options.max_context_chunks
    normalized: list[RetrievalHit] = []
    for index, hit in enumerate(search_result.hits[:max_context_chunks], start=1):
        normalized.append(hit.model_copy(update={"citation_id": f"R{index}"}))
    return normalized


def _normalize_graph_hits(graph_hits: list[QAGraphHit]) -> list[QAGraphHit]:
    normalized: list[QAGraphHit] = []
    for index, hit in enumerate(graph_hits, start=1):
        normalized.append(hit.model_copy(update={"citation_id": f"G{index}"}))
    return normalized


def _collect_ontology_tags(rag_hits: list[RetrievalHit]) -> list[str]:
    tags: list[str] = []
    for hit in rag_hits:
        tags.extend(hit.ontology_tags)
    return list(dict.fromkeys(tags))


def _ensure_visible_citations(
    answer: str,
    rag_hits: list[RetrievalHit],
    graph_hits: list[QAGraphHit],
) -> str:
    text = answer.strip()
    if not text:
        return text

    missing_tokens: list[str] = []
    for hit in rag_hits:
        citation = hit.citation_id.strip()
        if citation and f"[{citation}]" not in text:
            missing_tokens.append(f"[{citation}]")
    for graph_hit in graph_hits:
        citation = graph_hit.citation_id.strip()
        if citation and f"[{citation}]" not in text:
            missing_tokens.append(f"[{citation}]")

    if not missing_tokens:
        return text

    unique_tokens = list(dict.fromkeys(missing_tokens))
    separator = "\n\nReferences: " if "\n" in text else " References: "
    return text + separator + " ".join(unique_tokens)


def _build_template_answer(
    rag_hits: list[RetrievalHit],
    graph_hits: list[QAGraphHit],
    graph_paths: list[str],
) -> str | None:
    if not _has_usable_evidence(rag_hits, graph_hits, graph_paths):
        return None
    lines: list[str] = []
    for hit in rag_hits[:3]:
        snippet = hit.content.strip()
        if not snippet:
            continue
        if len(snippet) > 180:
            snippet = snippet[:177].rstrip() + "..."
        citation = f" [{hit.citation_id}]" if hit.citation_id else ""
        lines.append(f"{snippet}{citation}")
    for graph_hit in graph_hits[:3]:
        summary = graph_hit.evidence_text.strip() or ", ".join(graph_hit.related_entities)
        if not summary:
            continue
        citation = f" [{graph_hit.citation_id}]" if graph_hit.citation_id else ""
        lines.append(f"{summary}{citation}")
    for path in graph_paths[:1]:
        if path and path.strip():
            lines.append(f"Relevant graph path: {path.strip()}")
    return "\n".join(lines) if lines else None


def _has_usable_evidence(
    rag_hits: list[RetrievalHit],
    graph_hits: list[QAGraphHit],
    graph_paths: list[str],
) -> bool:
    if any(hit.content.strip() for hit in rag_hits):
        return True
    if any((hit.evidence_text or "").strip() or hit.related_entities for hit in graph_hits):
        return True
    return any(path.strip() for path in graph_paths if path)


def _llm_ready(llm_adapter) -> tuple[bool, str]:
    try:
        ready, detail = llm_adapter.check_ready()
        return bool(ready), str(detail)
    except Exception as exc:
        return False, str(exc)


def _set_source_result(results: list[QASourceResult], result: QASourceResult) -> list[QASourceResult]:
    remaining = [item for item in results if item.source_type != result.source_type]
    remaining.append(result)
    return remaining


def _sorted_source_results(results: list[QASourceResult]) -> list[QASourceResult]:
    order = {"graph_ref": 0, "rag_ref": 1}
    return sorted(results, key=lambda item: order.get(item.source_type, 99))
