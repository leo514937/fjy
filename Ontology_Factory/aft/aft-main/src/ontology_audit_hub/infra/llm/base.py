from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any, Protocol

from ontology_audit_hub.domain.audit.models import (
    ChatHistoryMessage,
    Finding,
    GraphEvidenceHit,
    HumanInputCard,
    QAGraphHit,
    QARouteTraceStep,
    QASourceResult,
    RetrievalHit,
)
from ontology_audit_hub.domain.documents.models import DocumentChunk, DocumentClaim
from ontology_audit_hub.domain.ontology.models import OntologyModel
from ontology_audit_hub.infra.llm.github_review_agents import (
    GitHubReviewIssue,
    GitHubReviewReport,
    GitHubReviewScopePacket,
    GitHubReviewScopePlan,
    GitHubReviewStagePacket,
)


class StructuredLLMAdapter(Protocol):
    """Optional structured LLM hooks for explanation-only enhancements."""

    def classify_intent(self, user_request: str, allowed_modes: list[str]) -> tuple[str, float] | None:
        """Return a structured intent label and confidence."""

    def extract_document_claims(
        self,
        chunks: list[DocumentChunk],
        ontology: OntologyModel,
    ) -> list[DocumentClaim]:
        """Return extra structured claims extracted from documents."""

    def enhance_human_input_card(self, card: HumanInputCard, *, context: dict[str, Any] | None = None) -> HumanInputCard:
        """Polish card wording while preserving structure."""

    def suggest_repairs(
        self,
        findings: list[Finding],
        *,
        retrieval_hits: list[RetrievalHit],
        graph_evidence: list[GraphEvidenceHit],
        existing_suggestions: list[str],
    ) -> list[str]:
        """Return additive repair suggestions."""

    def plan_review_scope(
        self,
        review_packet: GitHubReviewScopePacket | dict[str, Any],
    ) -> GitHubReviewScopePlan | None:
        """Return the highest-priority review scope for a GitHub repository snapshot."""

    def review_correctness(
        self,
        review_packet: GitHubReviewStagePacket | dict[str, Any],
        *,
        scope_plan: GitHubReviewScopePlan | dict[str, Any] | None = None,
    ) -> list[GitHubReviewIssue]:
        """Return correctness findings for the supplied review packet."""

    def review_risk_regression(
        self,
        review_packet: GitHubReviewStagePacket | dict[str, Any],
        *,
        scope_plan: GitHubReviewScopePlan | dict[str, Any] | None = None,
    ) -> list[GitHubReviewIssue]:
        """Return regression-risk findings for the supplied review packet."""

    def review_security(
        self,
        review_packet: GitHubReviewStagePacket | dict[str, Any],
        *,
        scope_plan: GitHubReviewScopePlan | dict[str, Any] | None = None,
    ) -> list[GitHubReviewIssue]:
        """Return security findings for the supplied review packet."""

    def review_test_coverage(
        self,
        review_packet: GitHubReviewStagePacket | dict[str, Any],
        *,
        scope_plan: GitHubReviewScopePlan | dict[str, Any] | None = None,
    ) -> list[GitHubReviewIssue]:
        """Return missing-test findings for the supplied review packet."""

    def judge_review_report(
        self,
        review_packet: GitHubReviewStagePacket | dict[str, Any],
        *,
        scope_plan: GitHubReviewScopePlan | dict[str, Any] | None = None,
        correctness_issues: list[GitHubReviewIssue] | None = None,
        risk_regression_issues: list[GitHubReviewIssue] | None = None,
        security_issues: list[GitHubReviewIssue] | None = None,
        test_coverage_issues: list[GitHubReviewIssue] | None = None,
        warnings: list[str] | None = None,
    ) -> GitHubReviewReport | None:
        """Return the merged GitHub review report."""

    def answer_question(
        self,
        question: str,
        *,
        source_results: list[QASourceResult],
        route_trace: list[QARouteTraceStep],
        rag_hits: list[RetrievalHit],
        graph_hits: list[QAGraphHit],
        graph_paths: list[str],
        warnings: list[str],
        chat_history: list[ChatHistoryMessage] | None = None,
        answer_mode: str = "grounded",
    ) -> str | None:
        """Return a user-facing enhanced answer when the backend supports it."""

    def decide_qa_retrieval(
        self,
        question: str,
        *,
        chat_history: list[ChatHistoryMessage] | None = None,
        rag_available: bool,
        graph_available: bool,
        explicit_rag: bool = False,
        explicit_graph: bool = False,
    ) -> tuple[bool, bool, str] | None:
        """Return whether document or graph retrieval should run for the question."""

    def stream_answer_question(
        self,
        question: str,
        *,
        source_results: list[QASourceResult],
        route_trace: list[QARouteTraceStep],
        rag_hits: list[RetrievalHit],
        graph_hits: list[QAGraphHit],
        graph_paths: list[str],
        warnings: list[str],
        chat_history: list[ChatHistoryMessage] | None = None,
        answer_mode: str = "grounded",
    ) -> AsyncIterator[str]:
        """Yield answer deltas when the backend supports streaming."""

    def check_ready(self) -> tuple[bool, str]:
        """Return a readiness probe result for the LLM adapter."""

    def backend_info(self) -> dict[str, Any]:
        """Return user-facing backend metadata."""

    def rewrite_query_for_retrieval(
        self,
        question: str,
        *,
        chat_history: list[ChatHistoryMessage] | None = None,
    ) -> str | None:
        """Return a retrieval-oriented rewrite while preserving the original question intent."""


class NullStructuredLLMAdapter:
    def classify_intent(self, user_request: str, allowed_modes: list[str]) -> tuple[str, float] | None:
        return None

    def extract_document_claims(
        self,
        chunks: list[DocumentChunk],
        ontology: OntologyModel,
    ) -> list[DocumentClaim]:
        return []

    def enhance_human_input_card(self, card: HumanInputCard, *, context: dict[str, Any] | None = None) -> HumanInputCard:
        return card

    def suggest_repairs(
        self,
        findings: list[Finding],
        *,
        retrieval_hits: list[RetrievalHit],
        graph_evidence: list[GraphEvidenceHit],
        existing_suggestions: list[str],
    ) -> list[str]:
        return existing_suggestions

    def plan_review_scope(
        self,
        review_packet: GitHubReviewScopePacket | dict[str, Any],
    ) -> GitHubReviewScopePlan | None:
        return None

    def review_correctness(
        self,
        review_packet: GitHubReviewStagePacket | dict[str, Any],
        *,
        scope_plan: GitHubReviewScopePlan | dict[str, Any] | None = None,
    ) -> list[GitHubReviewIssue]:
        return []

    def review_risk_regression(
        self,
        review_packet: GitHubReviewStagePacket | dict[str, Any],
        *,
        scope_plan: GitHubReviewScopePlan | dict[str, Any] | None = None,
    ) -> list[GitHubReviewIssue]:
        return []

    def review_security(
        self,
        review_packet: GitHubReviewStagePacket | dict[str, Any],
        *,
        scope_plan: GitHubReviewScopePlan | dict[str, Any] | None = None,
    ) -> list[GitHubReviewIssue]:
        return []

    def review_test_coverage(
        self,
        review_packet: GitHubReviewStagePacket | dict[str, Any],
        *,
        scope_plan: GitHubReviewScopePlan | dict[str, Any] | None = None,
    ) -> list[GitHubReviewIssue]:
        return []

    def judge_review_report(
        self,
        review_packet: GitHubReviewStagePacket | dict[str, Any],
        *,
        scope_plan: GitHubReviewScopePlan | dict[str, Any] | None = None,
        correctness_issues: list[GitHubReviewIssue] | None = None,
        risk_regression_issues: list[GitHubReviewIssue] | None = None,
        security_issues: list[GitHubReviewIssue] | None = None,
        test_coverage_issues: list[GitHubReviewIssue] | None = None,
        warnings: list[str] | None = None,
    ) -> GitHubReviewReport | None:
        return None

    def answer_question(
        self,
        question: str,
        *,
        source_results: list[QASourceResult],
        route_trace: list[QARouteTraceStep],
        rag_hits: list[RetrievalHit],
        graph_hits: list[QAGraphHit],
        graph_paths: list[str],
        warnings: list[str],
        chat_history: list[ChatHistoryMessage] | None = None,
        answer_mode: str = "grounded",
    ) -> str | None:
        return None

    def decide_qa_retrieval(
        self,
        question: str,
        *,
        chat_history: list[ChatHistoryMessage] | None = None,
        rag_available: bool,
        graph_available: bool,
        explicit_rag: bool = False,
        explicit_graph: bool = False,
    ) -> tuple[bool, bool, str] | None:
        return None

    async def stream_answer_question(
        self,
        question: str,
        *,
        source_results: list[QASourceResult],
        route_trace: list[QARouteTraceStep],
        rag_hits: list[RetrievalHit],
        graph_hits: list[QAGraphHit],
        graph_paths: list[str],
        warnings: list[str],
        chat_history: list[ChatHistoryMessage] | None = None,
        answer_mode: str = "grounded",
    ) -> AsyncIterator[str]:
        if False:
            yield question
        return

    def check_ready(self) -> tuple[bool, str]:
        return False, "LLM enhancement backend is disabled."

    def backend_info(self) -> dict[str, Any]:
        return {"backend": "null", "mode": "disabled"}

    def rewrite_query_for_retrieval(
        self,
        question: str,
        *,
        chat_history: list[ChatHistoryMessage] | None = None,
    ) -> str | None:
        return None


class UnavailableStructuredLLMAdapter(NullStructuredLLMAdapter):
    def __init__(self, detail: str) -> None:
        self.detail = detail

    def check_ready(self) -> tuple[bool, str]:
        return False, self.detail

    def backend_info(self) -> dict[str, Any]:
        return {"backend": "null", "mode": "unavailable", "detail": self.detail}
