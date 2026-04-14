from __future__ import annotations

from ontology_audit_hub.domain.audit.models import Finding
from ontology_audit_hub.graphs.state import GraphState


def make_load_request_node(runtime_findings: list[Finding] | None = None):
    runtime_findings = list(runtime_findings or [])

    def load_request_node(state: GraphState) -> GraphState:
        request = state["request"]
        findings = _merge_findings(list(state.get("findings", [])), runtime_findings)
        return {
            **state,
            "audit_mode": request.audit_mode.value if request.audit_mode else "",
            "current_phase": "load_request",
            "current_target": "",
            "ontology_path": request.ontology_path,
            "document_paths": list(request.document_paths),
            "code_paths": list(request.code_paths),
            "code_specs": list(state.get("code_specs", [])),
            "selected_code_bindings": dict(state.get("selected_code_bindings", {})),
            "document_claims": list(state.get("document_claims", [])),
            "findings": findings,
            "prioritized_findings": list(state.get("prioritized_findings", [])),
            "test_specs": list(state.get("test_specs", [])),
            "test_results": list(state.get("test_results", [])),
            "generated_test_files": list(state.get("generated_test_files", [])),
            "retrieval_hits": list(state.get("retrieval_hits", [])),
            "graph_evidence": list(state.get("graph_evidence", [])),
            "needs_human_input": state.get("needs_human_input", False),
            "human_card": state.get("human_card"),
            "human_response": state.get("human_response"),
            "resume_after_human_input": state.get("resume_after_human_input", False),
            "session_id": state.get("session_id"),
            "resume_token": state.get("resume_token"),
            "final_report": state.get("final_report"),
            "errors": list(state.get("errors", [])),
        }

    return load_request_node


def load_request_node(state: GraphState) -> GraphState:
    return make_load_request_node([])(state)


def _merge_findings(existing: list[Finding], additions: list[Finding]) -> list[Finding]:
    merged = list(existing)
    seen = {(finding.finding_type, finding.expected, finding.found, finding.evidence) for finding in existing}
    for finding in additions:
        key = (finding.finding_type, finding.expected, finding.found, finding.evidence)
        if key not in seen:
            seen.add(key)
            merged.append(finding)
    return merged
