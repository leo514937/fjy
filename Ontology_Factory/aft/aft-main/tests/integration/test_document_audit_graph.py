from pathlib import Path

from ontology_audit_hub.domain.audit.models import AuditRequest
from ontology_audit_hub.graphs.supervisor import build_supervisor_graph
from ontology_audit_hub.infra.retrieval import QdrantRetriever
from ontology_audit_hub.infra.runtime import GraphRuntime


def test_document_audit_graph_returns_conflicts() -> None:
    graph = build_supervisor_graph()
    request = AuditRequest.model_validate(
        {
            "user_request": "Audit the project documentation against the ontology.",
            "audit_mode": "document",
            "ontology_path": "examples/minimal/ontology.yaml",
            "document_paths": ["examples/docs/requirements.md"],
        }
    )

    result = graph.invoke({"request": request})
    finding_types = {finding.finding_type for finding in result["final_report"].findings}

    assert "document_required_fields_conflict" in finding_types
    assert "document_relation_unknown_target" in finding_types


def test_document_audit_graph_applies_retrieval_evidence(tmp_path: Path) -> None:
    graph = build_supervisor_graph(
        runtime=GraphRuntime(
            retriever=QdrantRetriever(path=tmp_path / "qdrant"),
            interrupt_on_human=False,
        )
    )
    request = AuditRequest.model_validate(
        {
            "user_request": "Audit the project documentation against the ontology.",
            "audit_mode": "document",
            "ontology_path": "examples/minimal/ontology.yaml",
            "document_paths": ["examples/docs/requirements.md"],
        }
    )

    result = graph.invoke({"request": request})

    assert any("Retrieved context:" in finding.evidence for finding in result["final_report"].findings)
