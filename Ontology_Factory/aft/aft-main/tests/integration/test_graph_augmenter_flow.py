from ontology_audit_hub.domain.audit.models import AuditRequest, GraphEvidenceHit
from ontology_audit_hub.graphs.supervisor import build_supervisor_graph
from ontology_audit_hub.infra.runtime import GraphRuntime


class FakeGraphAugmenter:
    def ingest_state(self, ontology, document_claims, code_specs) -> None:
        return None

    def enrich_findings(self, findings):
        return [
            GraphEvidenceHit(
                finding_key="|".join([finding.finding_type, finding.expected, finding.found, finding.evidence]),
                evidence_text="Graph traversal found downstream impact.",
                related_entities=["Payment"],
                source="fake",
            )
            for finding in findings
        ]


def test_graph_augmenter_enriches_finding_evidence() -> None:
    graph = build_supervisor_graph(
        runtime=GraphRuntime(graph_augmenter=FakeGraphAugmenter(), interrupt_on_human=False)
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

    assert "Graph evidence:" in result["final_report"].findings[0].evidence
