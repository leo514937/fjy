from ontology_audit_hub.domain.audit.models import AuditRequest
from ontology_audit_hub.graphs.supervisor import build_supervisor_graph


def test_code_audit_graph_generates_pytest_and_maps_failures() -> None:
    graph = build_supervisor_graph()
    request = AuditRequest.model_validate(
        {
            "user_request": "Audit the Python validator implementation against the ontology and generate pytest.",
            "audit_mode": "code",
            "ontology_path": "examples/code/ontology.yaml",
            "code_paths": ["examples/code/src/broken_payment.py"],
        }
    )

    result = graph.invoke({"request": request})
    report = result["final_report"]
    finding_types = {finding.finding_type for finding in report.findings}

    assert "generated_test_failure" in finding_types
    assert report.test_results


def test_code_audit_graph_flags_pytest_session_errors(monkeypatch) -> None:
    monkeypatch.setattr(
        "ontology_audit_hub.graphs.subgraphs.code_subgraph.run_generated_pytests",
        lambda _: (2, []),
    )
    graph = build_supervisor_graph()
    request = AuditRequest.model_validate(
        {
            "user_request": "Audit the Python validator implementation against the ontology and generate pytest.",
            "audit_mode": "code",
            "ontology_path": "examples/minimal/ontology.yaml",
            "code_paths": ["examples/minimal/src/billing.py"],
        }
    )

    result = graph.invoke({"request": request})
    report = result["final_report"]
    finding_types = {finding.finding_type for finding in report.findings}

    assert "generated_test_error" in finding_types
    assert any(test_result.status == "error" for test_result in report.test_results)
