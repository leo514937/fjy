from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Any

from pydantic import BaseModel, Field

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
    GitHubReviewIssueBatch,
    GitHubReviewReport,
    GitHubReviewScopePacket,
    GitHubReviewScopePlan,
    GitHubReviewStagePacket,
    build_correctness_system_prompt,
    build_judge_merge_system_prompt,
    build_risk_regression_system_prompt,
    build_scope_planner_system_prompt,
    build_security_system_prompt,
    build_test_coverage_system_prompt,
)
from ontology_audit_hub.infra.settings import AuditHubSettings


class _IntentClassification(BaseModel):
    label: str
    confidence: float = Field(ge=0.0, le=1.0)


class _ClaimExtractionResult(BaseModel):
    claims: list[DocumentClaim] = Field(default_factory=list)


class _HumanCardRewrite(BaseModel):
    title: str
    question: str
    context: str = ""


class _RepairSuggestions(BaseModel):
    suggestions: list[str] = Field(default_factory=list)


class _QueryRewriteResult(BaseModel):
    query: str = ""


class _RetrievalDecisionResult(BaseModel):
    use_rag: bool = False
    use_graph: bool = False
    reason: str = ""


class PydanticAILLMAdapter:
    def __init__(
        self,
        model_name: str,
        provider: str = "pydantic-ai",
        settings: AuditHubSettings | None = None,
    ) -> None:
        if provider != "pydantic-ai":
            raise ValueError(f"Unsupported LLM provider '{provider}'.")
        self.settings = settings or AuditHubSettings.from_env()
        try:
            from pydantic_ai import Agent
        except ImportError as exc:  # pragma: no cover - optional dependency
            raise RuntimeError("pydantic-ai is not installed. Install ontology-audit-hub[ai].") from exc
        self._agent_cls = Agent
        self.model_name = model_name
        self.provider = provider
        self._qa_answer_agent = self._agent_cls(
            self.model_name,
            output_type=str,
            system_prompt=(
                self.settings.prompt_qa_answer
                or (
                    "You will receive a structured payload with Question, ChatHistory, and RetrievedKnowledge. "
                    "ChatHistory contains only the recent user and assistant conversation. "
                    "Use chat history to keep the conversation coherent and resolve references like pronouns or omitted entities. "
                    "RetrievedKnowledge may contain document hits, graph hits, and graph paths. "
                    "If retrieved evidence is available, prioritize it for factual claims and preserve citation ids like [R1] and [G1] exactly. "
                    "Never swap a graph citation into an [R*] citation or vice versa. "
                    "If no retrieved evidence is available, answer naturally without inventing citations. "
                    "Do not mention internal routing, retrieval decisions, or tool mechanics unless the user explicitly asks about them. "
                    "If the user's request is genuinely ambiguous, ask one short clarifying question instead of making up details. "
                    "Use the same language as the user's question."
                )
            ),
        )
        self._retrieval_decision_agent = self._agent_cls(
            self.model_name,
            output_type=_RetrievalDecisionResult,
            system_prompt=(
                self.settings.prompt_qa_retrieval_decision
                or (
                    "Decide whether external retrieval should run before answering a QA request. "
                    "UseRag means document or retrieval-backed knowledge should be queried. "
                    "UseGraph means graph or entity-relationship lookup should be queried. "
                    "Use chat history only to resolve references. "
                    "For greetings, capability questions, thanks, and conversation recap, return false for both fields. "
                    "For factual, technical, specification, codebase, or entity-relationship questions, enable the helpful channels. "
                    "Return only booleans and one short reason."
                )
            ),
        )

    def classify_intent(self, user_request: str, allowed_modes: list[str]) -> tuple[str, float] | None:
        agent = self._agent_cls(
            self.model_name,
            output_type=_IntentClassification,
            system_prompt=(
                self.settings.prompt_qa_classify_intent
                or (
                    "Classify the audit request into one of the allowed supervisor modes. "
                    "Return only a valid label and a confidence between 0 and 1."
                )
            ),
        )
        payload = {"user_request": user_request, "allowed_modes": allowed_modes}
        result = agent.run_sync(json.dumps(payload, ensure_ascii=False))
        if result.output.label not in allowed_modes:
            return None
        return result.output.label, float(result.output.confidence)

    def extract_document_claims(
        self,
        chunks: list[DocumentChunk],
        ontology: OntologyModel,
    ) -> list[DocumentClaim]:
        if not chunks:
            return []
        agent = self._agent_cls(
            self.model_name,
            output_type=_ClaimExtractionResult,
            system_prompt=(
                self.settings.prompt_doc_claim_extraction
                or (
                    "Extract additional ontology-aware document claims. "
                    "Only emit claims that are strongly grounded in the provided text."
                )
            ),
        )
        payload = {
            "ontology_entities": [entity.model_dump(mode="json") for entity in ontology.entities],
            "ontology_relations": [relation.model_dump(mode="json") for relation in ontology.relations],
            "chunks": [chunk.model_dump(mode="json") for chunk in chunks[:6]],
        }
        result = agent.run_sync(json.dumps(payload, ensure_ascii=False))
        return list(result.output.claims)

    def enhance_human_input_card(self, card: HumanInputCard, *, context: dict[str, Any] | None = None) -> HumanInputCard:
        agent = self._agent_cls(
            self.model_name,
            output_type=_HumanCardRewrite,
            system_prompt=(
                self.settings.prompt_human_card_enhancement
                or (
                    "Rewrite the human-review card for clarity while keeping the same intent. "
                    "Do not remove necessary ambiguity details."
                )
            ),
        )
        payload = {"card": card.model_dump(mode="json"), "context": context or {}}
        result = agent.run_sync(json.dumps(payload, ensure_ascii=False))
        return card.model_copy(
            update={
                "title": result.output.title,
                "question": result.output.question,
                "context": result.output.context or card.context,
            }
        )

    def suggest_repairs(
        self,
        findings: list[Finding],
        *,
        retrieval_hits: list[RetrievalHit],
        graph_evidence: list[GraphEvidenceHit],
        existing_suggestions: list[str],
    ) -> list[str]:
        if not findings:
            return existing_suggestions
        agent = self._agent_cls(
            self.model_name,
            output_type=_RepairSuggestions,
            system_prompt=(
                self.settings.prompt_repair_suggestion
                or (
                    "Suggest concise repair actions for ontology-driven audit findings. "
                    "Additive suggestions only; do not repeat the exact same wording."
                )
            ),
        )
        payload = {
            "findings": [finding.model_dump(mode="json") for finding in findings[:10]],
            "retrieval_hits": [hit.model_dump(mode="json") for hit in retrieval_hits[:5]],
            "graph_evidence": [hit.model_dump(mode="json") for hit in graph_evidence[:5]],
            "existing_suggestions": existing_suggestions,
        }
        result = agent.run_sync(json.dumps(payload, ensure_ascii=False))
        return list(dict.fromkeys(existing_suggestions + list(result.output.suggestions)))

    def plan_review_scope(
        self,
        review_packet: GitHubReviewScopePacket | dict[str, Any],
    ) -> GitHubReviewScopePlan | None:
        payload = {
            "Stage": "scope_planner",
            "ReviewPacket": _dump_review_value(review_packet),
        }
        output = self._run_review_agent(
            output_type=GitHubReviewScopePlan,
            system_prompt=self.settings.prompt_github_scope_planner or build_scope_planner_system_prompt(),
            payload=payload,
        )
        return output if isinstance(output, GitHubReviewScopePlan) else None

    def review_correctness(
        self,
        review_packet: GitHubReviewStagePacket | dict[str, Any],
        *,
        scope_plan: GitHubReviewScopePlan | dict[str, Any] | None = None,
    ) -> list[GitHubReviewIssue]:
        return self._review_issue_stage(
            stage="correctness",
            system_prompt=self.settings.prompt_github_correctness or build_correctness_system_prompt(),
            review_packet=review_packet,
            scope_plan=scope_plan,
        )

    def review_risk_regression(
        self,
        review_packet: GitHubReviewStagePacket | dict[str, Any],
        *,
        scope_plan: GitHubReviewScopePlan | dict[str, Any] | None = None,
    ) -> list[GitHubReviewIssue]:
        return self._review_issue_stage(
            stage="risk_regression",
            system_prompt=self.settings.prompt_github_risk_regression or build_risk_regression_system_prompt(),
            review_packet=review_packet,
            scope_plan=scope_plan,
        )

    def review_security(
        self,
        review_packet: GitHubReviewStagePacket | dict[str, Any],
        *,
        scope_plan: GitHubReviewScopePlan | dict[str, Any] | None = None,
    ) -> list[GitHubReviewIssue]:
        return self._review_issue_stage(
            stage="security",
            system_prompt=self.settings.prompt_github_security or build_security_system_prompt(),
            review_packet=review_packet,
            scope_plan=scope_plan,
        )

    def review_test_coverage(
        self,
        review_packet: GitHubReviewStagePacket | dict[str, Any],
        *,
        scope_plan: GitHubReviewScopePlan | dict[str, Any] | None = None,
    ) -> list[GitHubReviewIssue]:
        return self._review_issue_stage(
            stage="test_coverage",
            system_prompt=self.settings.prompt_github_test_coverage or build_test_coverage_system_prompt(),
            review_packet=review_packet,
            scope_plan=scope_plan,
        )

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
        payload = {
            "Stage": "judge",
            "ReviewPacket": _dump_review_value(review_packet),
            "ScopePlan": _dump_review_value(scope_plan),
            "CorrectnessIssues": [_dump_review_value(issue) for issue in (correctness_issues or [])],
            "RiskRegressionIssues": [_dump_review_value(issue) for issue in (risk_regression_issues or [])],
            "SecurityIssues": [_dump_review_value(issue) for issue in (security_issues or [])],
            "TestCoverageIssues": [_dump_review_value(issue) for issue in (test_coverage_issues or [])],
            "Warnings": warnings or [],
        }
        output = self._run_review_agent(
            output_type=GitHubReviewReport,
            system_prompt=self.settings.prompt_github_judge_merge or build_judge_merge_system_prompt(),
            payload=payload,
        )
        return output if isinstance(output, GitHubReviewReport) else None

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
        agent, prompt = self._build_answer_request(
            question=question,
            source_results=source_results,
            route_trace=route_trace,
            rag_hits=rag_hits,
            graph_hits=graph_hits,
            graph_paths=graph_paths,
            warnings=warnings,
            chat_history=chat_history,
        )
        result = agent.run_sync(prompt)
        answer = str(result.output).strip()
        return answer or None

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
        agent, prompt = self._build_answer_request(
            question=question,
            source_results=source_results,
            route_trace=route_trace,
            rag_hits=rag_hits,
            graph_hits=graph_hits,
            graph_paths=graph_paths,
            warnings=warnings,
            chat_history=chat_history,
        )
        async with agent.run_stream(prompt, output_type=str) as result:
            async for delta in result.stream_text(delta=True, debounce_by=None):
                if delta:
                    yield delta

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
        payload = {
            "Question": question,
            "ChatHistory": [item.model_dump(mode="json") for item in (chat_history or [])],
            "SourceAvailability": {
                "rag_available": rag_available,
                "graph_available": graph_available,
                "explicit_rag": explicit_rag,
                "explicit_graph": explicit_graph,
            },
        }
        result = self._retrieval_decision_agent.run_sync(json.dumps(payload, ensure_ascii=False))
        output = result.output
        return bool(output.use_rag), bool(output.use_graph), str(output.reason or "").strip()

    def _run_review_agent(
        self,
        *,
        output_type: type[Any],
        system_prompt: str,
        payload: dict[str, Any],
    ) -> Any:
        agent = self._agent_cls(self.model_name, output_type=output_type, system_prompt=system_prompt)
        result = agent.run_sync(json.dumps(payload, ensure_ascii=False))
        return result.output

    def _review_issue_stage(
        self,
        *,
        stage: str,
        system_prompt: str,
        review_packet: GitHubReviewStagePacket | dict[str, Any],
        scope_plan: GitHubReviewScopePlan | dict[str, Any] | None,
    ) -> list[GitHubReviewIssue]:
        payload = {
            "Stage": stage,
            "ReviewPacket": _dump_review_value(review_packet),
            "ScopePlan": _dump_review_value(scope_plan),
        }
        output = self._run_review_agent(
            output_type=GitHubReviewIssueBatch,
            system_prompt=system_prompt,
            payload=payload,
        )
        issues = list(output.issues) if isinstance(output, GitHubReviewIssueBatch) else []
        normalized: list[GitHubReviewIssue] = []
        for issue in issues:
            if issue.category == stage:
                normalized.append(issue)
            else:
                normalized.append(issue.model_copy(update={"category": stage}))
        return normalized

    def check_ready(self) -> tuple[bool, str]:
        return True, f"Pydantic AI adapter is configured for model '{self.model_name}'."

    def backend_info(self) -> dict[str, Any]:
        return {
            "backend": self.provider,
            "model": self.model_name,
        }

    def rewrite_query_for_retrieval(
        self,
        question: str,
        *,
        chat_history: list[ChatHistoryMessage] | None = None,
    ) -> str | None:
        agent = self._agent_cls(
            self.model_name,
            output_type=_QueryRewriteResult,
            system_prompt=(
                self.settings.prompt_qa_query_rewrite
                or (
                    "Rewrite the user question into one concise retrieval query. "
                    "Use chat history only to resolve references like pronouns or omitted entities. "
                    "Preserve exact identifiers, API names, class names, error codes, and English terms. "
                    "Do not answer the question. Do not add explanations, prefixes, or multiple variants. "
                    "If the original question is already retrieval-ready, return it unchanged."
                )
            ),
        )
        payload = {
            "Question": question,
            "ChatHistory": [item.model_dump(mode="json") for item in (chat_history or [])],
        }
        result = agent.run_sync(json.dumps(payload, ensure_ascii=False))
        rewritten = str(result.output.query or "").strip()
        return rewritten or None

    def _build_answer_request(
        self,
        *,
        question: str,
        source_results: list[QASourceResult],
        route_trace: list[QARouteTraceStep],
        rag_hits: list[RetrievalHit],
        graph_hits: list[QAGraphHit],
        graph_paths: list[str],
        warnings: list[str],
        chat_history: list[ChatHistoryMessage] | None = None,
    ) -> tuple[Any, str]:
        payload = {
            "Question": question,
            "ChatHistory": [item.model_dump(mode="json") for item in (chat_history or [])],
            "RetrievedKnowledge": {
                "SourceResults": [item.model_dump(mode="json") for item in source_results],
                "RouteTrace": [item.model_dump(mode="json") for item in route_trace],
                "RagHits": [hit.model_dump(mode="json") for hit in rag_hits[:5]],
                "GraphHits": [hit.model_dump(mode="json") for hit in graph_hits[:5]],
                "GraphPaths": graph_paths[:10],
                "Warnings": warnings,
            },
        }
        return self._qa_answer_agent, json.dumps(payload, ensure_ascii=False)


def _dump_review_value(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, BaseModel):
        return value.model_dump(mode="json")
    if isinstance(value, dict):
        return {key: _dump_review_value(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_dump_review_value(item) for item in value]
    if isinstance(value, tuple):
        return [_dump_review_value(item) for item in value]
    return value
