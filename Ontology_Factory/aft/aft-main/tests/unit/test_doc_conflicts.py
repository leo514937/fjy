from pathlib import Path

from ontology_audit_hub.domain.documents.claims import extract_claims
from ontology_audit_hub.domain.documents.conflicts import detect_document_conflicts
from ontology_audit_hub.domain.documents.parser import chunk_markdown
from ontology_audit_hub.domain.ontology.loader import load_ontology


def test_document_claims_detect_conflicts_against_ontology() -> None:
    ontology = load_ontology("examples/minimal/ontology.yaml")
    markdown_file = Path("examples/docs/requirements.md")

    chunks = chunk_markdown(markdown_file, ontology)
    claims = extract_claims(chunks, ontology)
    findings = detect_document_conflicts(claims, ontology)
    finding_types = {finding.finding_type for finding in findings}

    assert "document_required_fields_conflict" in finding_types
    assert "document_relation_unknown_target" in finding_types
