import os

import pytest

from ontology_audit_hub.domain.audit.models import Finding, Severity
from ontology_audit_hub.infra.graph_augmenter import Neo4jGraphAugmenter, Neo4jSettings


@pytest.mark.skipif(
    not (
        os.getenv("ONTOLOGY_AUDIT_NEO4J_URI")
        and os.getenv("ONTOLOGY_AUDIT_NEO4J_USERNAME")
        and os.getenv("ONTOLOGY_AUDIT_NEO4J_PASSWORD")
    ),
    reason="Neo4j integration environment variables are not configured.",
)
def test_live_neo4j_enrichment_round_trip() -> None:
    augmenter = Neo4jGraphAugmenter(
        Neo4jSettings(
            uri=os.environ["ONTOLOGY_AUDIT_NEO4J_URI"],
            username=os.environ["ONTOLOGY_AUDIT_NEO4J_USERNAME"],
            password=os.environ["ONTOLOGY_AUDIT_NEO4J_PASSWORD"],
            database=os.getenv("ONTOLOGY_AUDIT_NEO4J_DATABASE", "neo4j"),
        )
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

    assert hits
    assert hits[0].source == "neo4j"
