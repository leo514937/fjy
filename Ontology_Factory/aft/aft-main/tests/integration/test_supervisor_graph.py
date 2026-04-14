from ontology_audit_hub.domain.audit.models import AuditRequest
from ontology_audit_hub.graphs.supervisor import build_supervisor_graph


def test_supervisor_graph_full_audit_example() -> None:
    graph = build_supervisor_graph()
    request = AuditRequest.model_validate(
        {
            "user_request": "Run a full ontology-driven QA audit across ontology, documentation, and code.",
            "audit_mode": "full",
            "ontology_path": "examples/minimal/ontology.yaml",
            "document_paths": ["examples/minimal/docs/requirements.md"],
            "code_paths": ["examples/minimal/src/billing.py"],
        }
    )

    result = graph.invoke({"request": request})
    report = result["final_report"]

    assert report.summary == "Audit completed without findings."
    assert report.findings == []
    assert report.prioritized_findings == []


def test_supervisor_graph_routes_to_human_input_for_ambiguous_intent() -> None:
    graph = build_supervisor_graph()
    request = AuditRequest(user_request="Please review this carefully")

    result = graph.invoke({"request": request})

    assert result["needs_human_input"] is True
    assert result["human_card"] is not None
    assert result["final_report"].unresolved_questions
