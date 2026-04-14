from ontology_audit_hub.domain.code.detector import compare_code_against_ontology
from ontology_audit_hub.domain.code.models import CodeCallableSpec, CodeParameterSpec
from ontology_audit_hub.domain.ontology.models import OntologyModel


def test_compare_code_against_ontology_detects_missing_fields_and_ambiguity() -> None:
    ontology = OntologyModel.model_validate(
        {
            "entities": [
                {
                    "name": "Payment",
                    "attributes": ["payment_id", "amount", "status"],
                    "constraints": {"required_fields": ["payment_id", "amount", "status"]},
                }
            ]
        }
    )
    code_specs = [
        CodeCallableSpec(
            module_path="sample.py",
            qualname="validate_payment",
            name="validate_payment",
            callable_type="function",
            parameters=[
                CodeParameterSpec(name="payment_id"),
                CodeParameterSpec(name="amount"),
            ],
            referenced_entities=["Payment"],
        ),
        CodeCallableSpec(
            module_path="sample.py",
            qualname="validate_payment_record",
            name="validate_payment_record",
            callable_type="function",
            parameters=[
                CodeParameterSpec(name="payment_id"),
                CodeParameterSpec(name="amount"),
                CodeParameterSpec(name="status"),
            ],
            referenced_entities=["Payment"],
        ),
    ]

    findings, _, human_card = compare_code_against_ontology(code_specs, ontology)
    finding_types = {finding.finding_type for finding in findings}

    assert "code_ambiguous_callable_binding" in finding_types
    assert human_card is not None
