from __future__ import annotations

from typing import TypedDict

from ontology_audit_hub.domain.audit.models import (
    AuditReport,
    AuditRequest,
    Finding,
    GraphEvidenceHit,
    HumanDecision,
    HumanInputCard,
    RetrievalHit,
    TestResult,
    TestSpec,
)
from ontology_audit_hub.domain.code.models import CodeCallableSpec
from ontology_audit_hub.domain.documents.models import DocumentClaim
from ontology_audit_hub.domain.ontology.models import OntologyModel


class GraphState(TypedDict, total=False):
    request: AuditRequest
    audit_mode: str
    intent_label: str
    intent_confidence: float
    current_phase: str
    current_target: str
    ontology_path: str | None
    document_paths: list[str]
    code_paths: list[str]
    ontology: OntologyModel | None
    code_specs: list[CodeCallableSpec]
    selected_code_bindings: dict[str, str]
    document_claims: list[DocumentClaim]
    findings: list[Finding]
    prioritized_findings: list[Finding]
    test_specs: list[TestSpec]
    test_results: list[TestResult]
    generated_test_files: list[str]
    retrieval_hits: list[RetrievalHit]
    graph_evidence: list[GraphEvidenceHit]
    needs_human_input: bool
    human_card: HumanInputCard | None
    human_response: HumanDecision | None
    resume_after_human_input: bool
    session_id: str | None
    resume_token: str | None
    final_report: AuditReport | None
    errors: list[str]
