from ontology_audit_hub.domain.audit.models import Finding, Severity
from ontology_audit_hub.infra.graph_augmenter import Neo4jGraphAugmenter, Neo4jSettings


def test_graph_augmenter_summarizes_findings_without_connection() -> None:
    augmenter = Neo4jGraphAugmenter(
        Neo4jSettings(uri="bolt://localhost:7687", username="neo4j", password="password")
    )
    finding = Finding(
        finding_type="document_relation_conflict",
        severity=Severity.HIGH,
        expected="Payment relates to Invoice",
        found="Payment relates to Receipt",
        evidence="Each Payment generates Receipt.",
        fix_hint="Fix the relation.",
    )

    hits = augmenter.enrich_findings([finding])

    assert len(hits) == 1
    assert hits[0].finding_key
    assert hits[0].source == "neo4j"
