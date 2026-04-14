from __future__ import annotations

from ontology_audit_hub.domain.audit.models import Finding, Severity
from ontology_audit_hub.domain.documents.models import DocumentClaim
from ontology_audit_hub.domain.ontology.models import OntologyModel


def detect_document_conflicts(claims: list[DocumentClaim], ontology: OntologyModel) -> list[Finding]:
    findings: list[Finding] = []
    entity_map = {entity.name: entity for entity in ontology.entities}
    relation_triples = {(relation.source, relation.relation_type.lower(), relation.target) for relation in ontology.relations}

    for claim in claims:
        if claim.claim_type == "required_fields":
            entity = entity_map.get(claim.subject)
            if entity is None:
                findings.append(
                    Finding(
                        finding_type="document_unknown_entity",
                        severity=Severity.HIGH,
                        expected=f"Document claim entity '{claim.subject}' exists in the ontology",
                        found=f"Document claim references unknown entity '{claim.subject}'",
                        evidence=claim.evidence,
                        fix_hint="Align document terminology with ontology entity names or extend the ontology deliberately.",
                    )
                )
                continue
            required_fields = entity.constraints.get("required_fields")
            if isinstance(required_fields, list):
                claimed_fields = list(claim.object) if isinstance(claim.object, list) else [str(claim.object)]
                if set(claimed_fields) != set(required_fields):
                    findings.append(
                        Finding(
                            finding_type="document_required_fields_conflict",
                            severity=Severity.HIGH,
                            expected=f"{claim.subject} required_fields={required_fields}",
                            found=f"{claim.subject} document_fields={claimed_fields}",
                            evidence=claim.evidence,
                            fix_hint="Update the document fields to match the ontology, or revise the ontology if the document is authoritative.",
                        )
                    )

        if claim.claim_type == "relation":
            relation_target = str(claim.object)
            if relation_target not in entity_map:
                findings.append(
                    Finding(
                        finding_type="document_relation_unknown_target",
                        severity=Severity.HIGH,
                        expected=f"Document relation target '{relation_target}' exists in the ontology",
                        found=f"Unknown document relation target '{relation_target}'",
                        evidence=claim.evidence,
                        fix_hint="Use a valid ontology entity name in the document or add the missing entity intentionally.",
                    )
                )
                continue
            if (claim.subject, claim.predicate.lower(), relation_target) not in relation_triples:
                findings.append(
                    Finding(
                        finding_type="document_relation_conflict",
                        severity=Severity.HIGH,
                        expected=f"Relation ({claim.subject}, {claim.predicate}, {relation_target}) exists in the ontology",
                        found=f"Document claims relation ({claim.subject}, {claim.predicate}, {relation_target})",
                        evidence=claim.evidence,
                        fix_hint="Align the document relation statement with the ontology relation graph.",
                    )
                )
    return findings
