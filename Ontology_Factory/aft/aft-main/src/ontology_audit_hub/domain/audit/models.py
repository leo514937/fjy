from __future__ import annotations

from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, Field


class AuditMode(StrEnum):
    ONTOLOGY = "ontology"
    DOCUMENT = "document"
    CODE = "code"
    FULL = "full"


class Severity(StrEnum):
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    INFO = "info"


class AuditRequest(BaseModel):
    user_request: str
    audit_mode: AuditMode | None = None
    ontology_path: str | None = None
    document_paths: list[str] = Field(default_factory=list)
    code_paths: list[str] = Field(default_factory=list)
    require_human_review: bool = False
    metadata: dict[str, str] = Field(default_factory=dict)


class Finding(BaseModel):
    finding_type: str
    severity: Severity
    expected: str
    found: str
    evidence: str
    fix_hint: str


class HumanInputOption(BaseModel):
    id: str
    label: str
    value: str
    description: str = ""


class TestSpec(BaseModel):
    name: str
    description: str
    related_entities: list[str] = Field(default_factory=list)
    entity: str | None = None
    target_callable: str | None = None
    test_kind: str = "generic"
    inputs: dict[str, Any] = Field(default_factory=dict)
    expected_outcome: str = "truthy"
    rationale: str = ""
    module_path: str | None = None


class TestResult(BaseModel):
    test_name: str
    status: str
    details: str = ""
    nodeid: str = ""
    related_entity: str | None = None
    related_callable: str | None = None


class HumanInputCard(BaseModel):
    title: str
    question: str
    context: str = ""
    options: list[HumanInputOption] = Field(default_factory=list)


class HumanDecision(BaseModel):
    session_id: str
    resume_token: str | None = None
    selected_option_id: str | None = None
    response_value: str | None = None
    notes: str = ""


class RetrievalHit(BaseModel):
    chunk_id: str = ""
    source_file: str
    section: str
    content: str
    source_id: str = ""
    heading_path: list[str] = Field(default_factory=list)
    ontology_tags: list[str] = Field(default_factory=list)
    version: str = "unknown"
    status: str = "unknown"
    score: float = 0.0
    dense_score: float = 0.0
    sparse_score: float = 0.0
    token_count: int = 0
    citation_id: str = ""
    match_reason: str = ""
    metadata: dict[str, Any] = Field(default_factory=dict)


class GraphEvidenceHit(BaseModel):
    finding_key: str
    evidence_text: str
    related_entities: list[str] = Field(default_factory=list)
    impact_path: list[str] = Field(default_factory=list)
    source: str = "graph"
    metadata: dict[str, Any] = Field(default_factory=dict)


class AuditReport(BaseModel):
    summary: str
    findings: list[Finding] = Field(default_factory=list)
    prioritized_findings: list[Finding] = Field(default_factory=list)
    repair_suggestions: list[str] = Field(default_factory=list)
    test_results: list[TestResult] = Field(default_factory=list)
    unresolved_questions: list[str] = Field(default_factory=list)
    next_steps: list[str] = Field(default_factory=list)


class GraphReference(BaseModel):
    backend: Literal["neo4j"]
    uri: str = Field(min_length=1)
    username: str = Field(min_length=1)
    password: str = Field(min_length=1)
    database: str = "neo4j"


class RAGReference(BaseModel):
    backend: Literal["qdrant"]
    url: str = Field(min_length=1)
    collection_name: str = Field(min_length=1)
    api_key: str | None = None
    top_k: int = Field(default=5, ge=1, le=20)


class RAGOptions(BaseModel):
    candidate_pool: int | None = Field(default=None, ge=1, le=100)
    top_k: int | None = Field(default=None, ge=1, le=20)
    max_context_chunks: int | None = Field(default=None, ge=1, le=20)
    sparse_candidate_pool: int | None = Field(default=None, ge=1, le=100)
    min_relevance_score: float | None = Field(default=None, ge=0.0, le=1.0)
    enable_query_rewrite: bool | None = None
    enable_hybrid_retrieval: bool | None = None
    enable_graph_context: bool | None = None


class ChatHistoryMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = ""


class QuestionAnswerRequest(BaseModel):
    question: str = Field(min_length=1)
    request_id: str | None = Field(default=None, min_length=1)
    session_id: str | None = Field(default=None, min_length=1)
    graph_ref: GraphReference | None = None
    rag_ref: RAGReference | None = None
    rag_options: RAGOptions | None = None
    history: list[ChatHistoryMessage] = Field(default_factory=list)


class QuestionAnswerCancelRequest(BaseModel):
    request_id: str = Field(min_length=1)


class QARouteTraceStep(BaseModel):
    stage: str
    status: str
    detail: str = ""


class QASourceResult(BaseModel):
    source_type: Literal["graph_ref", "rag_ref"]
    status: str
    summary: str


class QAGraphHit(BaseModel):
    entity: str
    evidence_text: str
    related_entities: list[str] = Field(default_factory=list)
    relations: list[str] = Field(default_factory=list)
    citation_id: str = ""


class QuestionAnswerEvidence(BaseModel):
    rag_hits: list[RetrievalHit] = Field(default_factory=list)
    graph_hits: list[QAGraphHit] = Field(default_factory=list)
    graph_paths: list[str] = Field(default_factory=list)


class QuestionAnswerResponse(BaseModel):
    answer: str
    route_trace: list[QARouteTraceStep] = Field(default_factory=list)
    source_results: list[QASourceResult] = Field(default_factory=list)
    evidence: QuestionAnswerEvidence = Field(default_factory=QuestionAnswerEvidence)
    warnings: list[str] = Field(default_factory=list)


class QuestionAnswerErrorResponse(BaseModel):
    status: str = "error"
    message: str
    route_trace: list[QARouteTraceStep] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)

