from ontology_audit_hub.domain.ontology.models import OntologyModel
from ontology_audit_hub.domain.ontology.validators import validate_ontology


def test_validate_ontology_detects_core_integrity_issues() -> None:
    ontology = OntologyModel.model_validate(
        {
            "entities": [
                {"name": "Order", "attributes": ["id"], "constraints": {"required_fields": ["id", "missing_attr"]}},
                {"name": "Payment", "attributes": []},
                {"name": "Order", "attributes": []},
                {"name": "Isolated", "attributes": []},
            ],
            "relations": [
                {"source": "Order", "target": "Payment", "type": "depends_on"},
                {"source": "Payment", "target": "Order", "type": "depends_on"},
                {"source": "Order", "target": "MissingEntity", "type": "references"},
            ],
            "constraints": [{"entity": "Ghost", "rule": "ghost_rule"}],
        }
    )

    finding_types = {finding.finding_type for finding in validate_ontology(ontology)}

    assert "ontology_duplicate_entity" in finding_types
    assert "ontology_missing_relation_target" in finding_types
    assert "ontology_invalid_required_constraints" in finding_types
    assert "ontology_constraint_unknown_entity" in finding_types
    assert "ontology_isolated_entity" in finding_types
    assert "ontology_illegal_cycle" in finding_types
