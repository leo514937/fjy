from __future__ import annotations

"""Shared data models for ontology negotiation."""

from typing import Any, Literal, TypedDict

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, model_validator

OntologyLabel = Literal["\u8fbe", "\u7c7b", "\u79c1"]
LLevel = Literal["L0", "L1", "L2"]
ArbiterAction = Literal["retry", "finalize"]
CritiqueStance = Literal["\u652f\u6301", "\u53cd\u5bf9", "\u90e8\u5206\u540c\u610f"]
RetryReasonType = Literal[
    "min_round_enforcement",
    "evidence_gap",
    "conflict_unresolved",
]
DecisionReasonType = Literal[
    "min_round_enforcement",
    "evidence_gap",
    "conflict_unresolved",
    "evidence_closed",
    "no_new_evidence",
    "focus_not_narrowed",
    "repeat_conflict",
    "forced_finalization",
]
EvidenceStatus = Literal["active", "resolved"]
EvidenceEventType = Literal["opened", "retained", "narrowed", "resolved", "reopened"]
MAX_NEGOTIATION_ROUNDS = 5
MIN_NEGOTIATION_ROUNDS = 2


class GraphNode(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="allow")

    node_id: str
    name: str
    l_level: str = Field(validation_alias=AliasChoices("l_level", "L_level"))
    description: str = ""
    properties: dict[str, Any] = Field(default_factory=dict)


class GraphEdge(BaseModel):
    source: str
    target: str
    relation: str


class GraphInput(BaseModel):
    nodes: list[GraphNode]
    edges: list[GraphEdge] = Field(default_factory=list)


class GraphContext(BaseModel):
    neighbors: list[GraphNode] = Field(default_factory=list)
    edges: list[GraphEdge] = Field(default_factory=list)


class VaultContextPayload(BaseModel):
    matched: bool = False
    evidence: list[str] = Field(default_factory=list)
    reason: str = ""
    related_l2_nodes: list[str] = Field(default_factory=list)


class EpistemologyPayload(BaseModel):
    l_mapping: str
    ran: str
    ti: str


class LogicTracePayload(BaseModel):
    reasoning: str
    xiaogu_list: list[str] = Field(default_factory=list)


class ClassificationResult(BaseModel):
    node_id: str
    info_name: str
    ontology_label: OntologyLabel
    confidence: float
    epistemology: EpistemologyPayload
    logic_trace: LogicTracePayload


class CompactNodeContext(TypedDict, total=False):
    node_id: str
    name: str
    l_level: str
    description: str
    properties: dict[str, Any]


class CompactGraphContext(TypedDict, total=False):
    neighbor_ids: list[str]
    neighbor_summaries: list[dict[str, Any]]
    edge_summaries: list[dict[str, Any]]


class CompactVaultContext(TypedDict, total=False):
    matched: bool
    evidence: list[str]
    reason: str
    related_l2_nodes: list[str]


class EvidencePackPayload(TypedDict, total=False):
    node: CompactNodeContext
    graph: CompactGraphContext
    vault: CompactVaultContext


class ProposalPayload(BaseModel):
    label: OntologyLabel
    confidence_hint: float = Field(ge=0.0, le=1.0)
    reason: str
    core_evidence: list[str] = Field(default_factory=list)
    uncertainties: list[str] = Field(default_factory=list)
    revision_strategy: str


class CritiquePayload(BaseModel):
    stance: CritiqueStance
    reason: str
    counter_evidence: list[str] = Field(default_factory=list)
    suggested_label: OntologyLabel | None = None
    open_questions: list[str] = Field(default_factory=list)
    consensus_signal: bool = False
    remaining_gaps: list[str] = Field(default_factory=list)


class ArbiterPayload(BaseModel):
    arbiter_action: ArbiterAction
    decision_reason_type: DecisionReasonType
    final_label: OntologyLabel | None = None
    case_closed: bool
    loop_detected: bool
    loop_reason: str = ""
    decision_reason: str
    next_focus: str = ""
    retry_reason_type: RetryReasonType | None = None
    consensus_status: str
    resolved_evidence_ids: list[str] = Field(default_factory=list)
    retained_evidence_ids: list[str] = Field(default_factory=list)
    new_evidence_ids: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_action(self) -> "ArbiterPayload":
        if self.arbiter_action == "finalize":
            if not self.case_closed:
                raise ValueError("finalize requires case_closed=true")
            if self.final_label is None:
                raise ValueError("finalize requires final_label")
            if self.retry_reason_type is not None:
                raise ValueError("finalize requires retry_reason_type=null")
        if self.arbiter_action == "retry":
            if self.case_closed:
                raise ValueError("retry requires case_closed=false")
            if self.final_label is not None:
                raise ValueError("retry requires final_label=null")
            if not self.next_focus.strip():
                raise ValueError("retry requires next_focus")
            if self.retry_reason_type is None:
                raise ValueError("retry requires retry_reason_type")
        return self


class EvaluationReportPayload(BaseModel):
    confidence_score: float = Field(ge=0.0, le=1.0)
    consensus_stability_score: float = Field(ge=0.0, le=1.0)
    evidence_strength_score: float = Field(ge=0.0, le=1.0)
    logic_consistency_score: float = Field(ge=0.0, le=1.0)
    semantic_fit_score: float = Field(ge=0.0, le=1.0)
    audit_opinion: str
    reasoning: str
    xiaogu_list: list[str] = Field(default_factory=list)
    generated_ran: str | None = None
    generated_ti: str | None = None


class AgentErrorPayload(BaseModel):
    node_id: str | None = None
    agent_name: str
    stage: str
    iteration: int
    message: str
    raw_response: Any = None
    prompt_name: str


class LLMTracePayload(BaseModel):
    agent_name: str
    stage: str
    iteration: int
    prompt_name: str
    llm_model: str | None = None
    fallback_model: str | None = None
    fallback_used: bool = False
    attempts: int = 1
    success: bool = True


class PersistentEvidencePayload(BaseModel):
    evidence_id: str
    source_round: int
    source_role: str
    reason_type: str
    logic_path: str
    canonical_claim: str
    evidence_refs: list[str] = Field(default_factory=list)
    signature: dict[str, Any] = Field(default_factory=dict)
    status: EvidenceStatus = "active"
    resolution_note: str = ""


class EvidenceEventPayload(BaseModel):
    evidence_id: str
    event_type: EvidenceEventType
    round: int
    source_role: str
    reason_type: str = ""
    note: str = ""
    related_evidence_id: str | None = None


class NegotiationState(TypedDict, total=False):
    node_data: dict[str, Any]
    graph_context: dict[str, Any]
    vault_context: dict[str, Any]
    evidence_pack: dict[str, Any]
    proposal: dict[str, Any]
    critique: dict[str, Any]
    history: list[dict[str, Any]]
    working_memory: dict[str, Any]
    iterations: int
    debate_focus: str
    debate_gaps: list[str]
    round_summaries: list[dict[str, Any]]
    confidence_score: float
    evaluation_report: dict[str, Any]
    consensus_reached: bool
    arbiter_summary: str
    arbiter_action: str | None
    final_label: OntologyLabel | None
    debate_log_path: str | None
    loop_detected: bool
    loop_reason: str
    case_closed: bool
    agent_errors: list[dict[str, Any]]
    persistent_evidence: list[dict[str, Any]]
    resolved_evidence: list[dict[str, Any]]
    evidence_events: list[dict[str, Any]]

