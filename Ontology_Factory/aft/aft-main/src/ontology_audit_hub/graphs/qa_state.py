from __future__ import annotations

from typing import TypedDict

from ontology_audit_hub.domain.audit.models import (
    QAGraphHit,
    QARouteTraceStep,
    QASourceResult,
    QuestionAnswerRequest,
    QuestionAnswerResponse,
    RetrievalHit,
)


class QAState(TypedDict, total=False):
    qa_request: QuestionAnswerRequest
    route_trace: list[QARouteTraceStep]
    source_results: list[QASourceResult]
    rag_hits: list[RetrievalHit]
    graph_hits: list[QAGraphHit]
    graph_paths: list[str]
    warnings: list[str]
    answer: str
    qa_response: QuestionAnswerResponse | None
    error_status: int | None
    error_message: str | None
