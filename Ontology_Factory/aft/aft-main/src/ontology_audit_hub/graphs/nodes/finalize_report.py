from __future__ import annotations

from ontology_audit_hub.domain.audit.models import AuditReport, Finding
from ontology_audit_hub.graphs.state import GraphState
from ontology_audit_hub.infra.llm.base import NullStructuredLLMAdapter, StructuredLLMAdapter


def make_finalize_report_node(llm_adapter: StructuredLLMAdapter | None = None):
    llm_adapter = llm_adapter or NullStructuredLLMAdapter()

    def finalize_report_node(state: GraphState) -> GraphState:
        findings = list(state.get("findings", []))
        prioritized_findings = list(state.get("prioritized_findings", findings))
        human_card = state.get("human_card")
        unresolved_questions = [human_card.question] if state.get("needs_human_input") and human_card else []
        repair_suggestions = _build_repair_suggestions(prioritized_findings)
        try:
            repair_suggestions = llm_adapter.suggest_repairs(
                prioritized_findings,
                retrieval_hits=list(state.get("retrieval_hits", [])),
                graph_evidence=list(state.get("graph_evidence", [])),
                existing_suggestions=repair_suggestions,
            )
        except Exception:
            pass
        if unresolved_questions:
            summary = "Audit paused pending human clarification."
        elif prioritized_findings:
            summary = f"Audit completed with {len(prioritized_findings)} finding(s)."
        else:
            summary = "Audit completed without findings."
        report = AuditReport(
            summary=summary,
            findings=findings,
            prioritized_findings=prioritized_findings,
            repair_suggestions=repair_suggestions,
            test_results=list(state.get("test_results", [])),
            unresolved_questions=unresolved_questions,
            next_steps=_build_next_steps(
                prioritized_findings,
                unresolved_questions,
                errors=list(state.get("errors", [])),
            ),
        )
        return {
            **state,
            "current_phase": "finalize_report",
            "final_report": report,
        }

    return finalize_report_node


def finalize_report_node(state: GraphState) -> GraphState:
    return make_finalize_report_node()(state)


def _build_repair_suggestions(findings: list[Finding]) -> list[str]:
    repair_suggestions: list[str] = []
    for finding in findings:
        if finding.fix_hint.strip():
            repair_suggestions.append(finding.fix_hint)
        if finding.finding_type == "code_missing_required_fields":
            repair_suggestions.append(
                "Align the callable signature with ontology required fields before regenerating pytest."
            )
        if finding.finding_type == "code_ambiguous_callable_binding":
            repair_suggestions.append(
                "Disambiguate validator-style callables so the code audit can generate deterministic tests."
            )
        if finding.finding_type == "generated_test_assumption_mismatch":
            repair_suggestions.append(
                "Verify the generated fixture assumptions before treating the failure as a code defect."
            )
        if finding.finding_type in {"document_required_fields_conflict", "document_relation_conflict"}:
            repair_suggestions.append(
                "Review whether the document, ontology, or code should be treated as the source of truth."
            )
    return list(dict.fromkeys(repair_suggestions))


def _build_next_steps(
    prioritized_findings: list[Finding],
    unresolved_questions: list[str],
    *,
    errors: list[str],
) -> list[str]:
    if unresolved_questions:
        return ["Answer the clarification request and resume the audit session."]
    if prioritized_findings:
        return [
            "Review the prioritized findings and apply the suggested repairs.",
            "Re-run the relevant audit path after changes to verify the fixes.",
        ]
    if errors:
        return ["Review the recorded runtime errors and rerun the audit after the environment is stable."]
    return ["Re-run the audit whenever ontology, documents, or code change to keep the report current."]
