from __future__ import annotations

from ontology_audit_hub.domain.audit.models import Finding, Severity, TestSpec
from ontology_audit_hub.domain.code.models import CodeCallableSpec
from ontology_audit_hub.domain.ontology.models import OntologyModel


def generate_test_specs(
    ontology: OntologyModel,
    selected_bindings: dict[str, CodeCallableSpec],
) -> tuple[list[TestSpec], list[Finding]]:
    test_specs: list[TestSpec] = []
    findings: list[Finding] = []
    entity_map = {entity.name: entity for entity in ontology.entities}
    for entity_name, callable_spec in selected_bindings.items():
        entity = entity_map[entity_name]
        explicit_params = {
            parameter.name
            for parameter in callable_spec.parameters
            if parameter.kind in {"positional_or_keyword", "keyword_only"}
        }
        required_fields = entity.constraints.get("required_fields")
        if not isinstance(required_fields, list):
            continue
        if not set(required_fields).issubset(explicit_params):
            continue

        positive_inputs = {field: _example_value(field, True) for field in required_fields}
        test_specs.append(
            TestSpec(
                name=f"{entity_name.lower()}_positive_required_fields",
                description=f"Positive validation case for {entity_name}",
                related_entities=[entity_name],
                entity=entity_name,
                target_callable=callable_spec.qualname,
                module_path=callable_spec.module_path,
                test_kind="positive_required_fields",
                inputs=positive_inputs,
                expected_outcome="truthy",
                rationale="All required fields are provided with structurally valid values.",
            )
        )
        for missing_field in required_fields:
            negative_inputs = {field: _example_value(field, True) for field in required_fields if field != missing_field}
            test_specs.append(
                TestSpec(
                    name=f"{entity_name.lower()}_missing_{missing_field}",
                    description=f"Missing required field {missing_field} for {entity_name}",
                    related_entities=[entity_name],
                    entity=entity_name,
                    target_callable=callable_spec.qualname,
                    module_path=callable_spec.module_path,
                    test_kind="negative_missing_required_field",
                    inputs=negative_inputs,
                    expected_outcome="falsy_or_exception",
                    rationale=f"The callable should reject or fail when {missing_field} is omitted.",
                )
            )
        for constraint in ontology.constraints:
            if constraint.entity != entity_name:
                continue
            if constraint.rule.endswith("_must_be_positive"):
                target_field = constraint.rule.removesuffix("_must_be_positive")
                if target_field in explicit_params:
                    invalid_inputs = {field: _example_value(field, True) for field in required_fields}
                    invalid_inputs[target_field] = -1
                    test_specs.append(
                        TestSpec(
                            name=f"{entity_name.lower()}_{target_field}_must_be_positive",
                            description=f"Constraint validation for {constraint.rule}",
                            related_entities=[entity_name],
                            entity=entity_name,
                            target_callable=callable_spec.qualname,
                            module_path=callable_spec.module_path,
                            test_kind="constraint_positive",
                            inputs=invalid_inputs,
                            expected_outcome="falsy_or_exception",
                            rationale=constraint.description or constraint.rule,
                        )
                    )
                else:
                    findings.append(_unsupported_constraint_finding(entity_name, callable_spec.qualname, constraint.rule))
            elif constraint.rule.endswith("_must_be_non_empty"):
                target_field = constraint.rule.removesuffix("_must_be_non_empty")
                if target_field in explicit_params:
                    invalid_inputs = {field: _example_value(field, True) for field in required_fields}
                    invalid_inputs[target_field] = ""
                    test_specs.append(
                        TestSpec(
                            name=f"{entity_name.lower()}_{target_field}_must_be_non_empty",
                            description=f"Constraint validation for {constraint.rule}",
                            related_entities=[entity_name],
                            entity=entity_name,
                            target_callable=callable_spec.qualname,
                            module_path=callable_spec.module_path,
                            test_kind="constraint_non_empty",
                            inputs=invalid_inputs,
                            expected_outcome="falsy_or_exception",
                            rationale=constraint.description or constraint.rule,
                        )
                    )
                else:
                    findings.append(_unsupported_constraint_finding(entity_name, callable_spec.qualname, constraint.rule))
            else:
                findings.append(_unsupported_constraint_finding(entity_name, callable_spec.qualname, constraint.rule))
    return test_specs, findings


def _unsupported_constraint_finding(entity_name: str, qualname: str, rule: str) -> Finding:
    return Finding(
        finding_type="unsupported_test_constraint",
        severity=Severity.INFO,
        expected=f"Constraint '{rule}' can be translated into a generated test",
        found=f"No deterministic generator for rule '{rule}' on {qualname}",
        evidence=f"Entity '{entity_name}' includes ontology constraint '{rule}'.",
        fix_hint="Add a deterministic constraint generator or cover the rule with a handwritten pytest.",
    )


def _example_value(field_name: str, positive: bool) -> object:
    lowered = field_name.lower()
    if "amount" in lowered or "count" in lowered or "number" in lowered or lowered.endswith("_id"):
        if lowered.endswith("_id"):
            return "id-123" if positive else ""
        return 10 if positive else -1
    if "status" in lowered:
        return "active" if positive else ""
    return "value" if positive else ""
