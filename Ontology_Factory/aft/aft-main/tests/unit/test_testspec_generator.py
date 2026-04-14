from ontology_audit_hub.domain.code.models import CodeCallableSpec, CodeParameterSpec
from ontology_audit_hub.domain.ontology.models import OntologyModel
from ontology_audit_hub.domain.testspec.generator import generate_test_specs


def test_generate_test_specs_produces_positive_negative_and_constraint_cases() -> None:
    ontology = OntologyModel.model_validate(
        {
            "entities": [
                {
                    "name": "Payment",
                    "attributes": ["payment_id", "amount", "status"],
                    "constraints": {"required_fields": ["payment_id", "amount", "status"]},
                }
            ],
            "constraints": [
                {"entity": "Payment", "rule": "amount_must_be_positive", "description": "Amount must be positive."}
            ],
        }
    )
    binding = {
        "Payment": CodeCallableSpec(
            module_path="sample.py",
            qualname="validate_payment",
            name="validate_payment",
            callable_type="function",
            parameters=[
                CodeParameterSpec(name="payment_id"),
                CodeParameterSpec(name="amount"),
                CodeParameterSpec(name="status"),
            ],
        )
    }

    test_specs, findings = generate_test_specs(ontology, binding)
    test_kinds = {spec.test_kind for spec in test_specs}

    assert "positive_required_fields" in test_kinds
    assert "negative_missing_required_field" in test_kinds
    assert "constraint_positive" in test_kinds
    assert findings == []
