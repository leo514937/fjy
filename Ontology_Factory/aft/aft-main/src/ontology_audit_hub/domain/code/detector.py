from __future__ import annotations

import re

from ontology_audit_hub.domain.audit.models import Finding, HumanInputCard, HumanInputOption, Severity
from ontology_audit_hub.domain.code.models import CodeCallableSpec
from ontology_audit_hub.domain.ontology.models import OntologyEntity, OntologyModel

CALLABLE_PREFIX_ORDER = ("validate_", "is_", "check_", "create_")


def compare_code_against_ontology(
    code_specs: list[CodeCallableSpec],
    ontology: OntologyModel,
) -> tuple[list[Finding], dict[str, CodeCallableSpec], HumanInputCard | None]:
    findings: list[Finding] = []
    selected_bindings: dict[str, CodeCallableSpec] = {}
    human_card: HumanInputCard | None = None
    for callable_spec in code_specs:
        for unknown_ref in callable_spec.unknown_entity_references:
            findings.append(
                Finding(
                    finding_type="code_unknown_entity_reference",
                    severity=Severity.MEDIUM,
                    expected="Code references ontology entities that exist",
                    found=f"{callable_spec.qualname} mentions unknown entity '{unknown_ref}'",
                    evidence=callable_spec.docstring or callable_spec.source_snippet or callable_spec.qualname,
                    fix_hint="Rename the code reference to an ontology entity or extend the ontology intentionally.",
                )
            )

    for entity in ontology.entities:
        candidates = _rank_candidates(entity, code_specs)
        if not candidates:
            findings.append(
                Finding(
                    finding_type="code_no_callable_for_entity",
                    severity=Severity.HIGH,
                    expected=f"A validator-style callable bound to entity '{entity.name}'",
                    found=f"No callable references entity '{entity.name}'",
                    evidence=f"Available callables: {[spec.qualname for spec in code_specs]}",
                    fix_hint=f"Add a validator-style callable for entity '{entity.name}' or refine the code binding rules.",
                )
            )
            continue
        if len(candidates) > 1 and candidates[0][0] == candidates[1][0]:
            if human_card is None:
                human_card = build_ambiguity_human_card(entity, candidates)
            findings.append(
                Finding(
                    finding_type="code_ambiguous_callable_binding",
                    severity=Severity.HIGH,
                    expected=f"A single best validator callable for entity '{entity.name}'",
                    found=f"Ambiguous candidates: {[spec.qualname for _, spec in candidates if _ == candidates[0][0]]}",
                    evidence=f"Candidate ranking scores: {[(score, spec.qualname) for score, spec in candidates[:5]]}",
                    fix_hint="Choose the intended callable via human review or rename callables to disambiguate the binding.",
                )
            )
            continue
        _, selected = candidates[0]
        selected_bindings[entity.name] = selected
        findings.extend(_validate_required_fields(entity, selected))
        findings.extend(_validate_relations(entity, selected, ontology))
    return findings, selected_bindings, human_card


def build_ambiguity_human_card(
    entity: OntologyEntity,
    candidates: list[tuple[int, CodeCallableSpec]],
) -> HumanInputCard:
    return HumanInputCard(
        title="Ambiguous code binding",
        question=f"Multiple callables match entity '{entity.name}'. Which callable should the audit bind?",
        context=f"Candidates: {[spec.qualname for _, spec in candidates]}",
        options=[
            HumanInputOption(
                id=f"{entity.name}:{spec.qualname}",
                label=spec.qualname,
                value=spec.qualname,
                description=spec.docstring or spec.source_snippet,
            )
            for _, spec in candidates[:5]
        ],
    )


def build_ambiguity_human_card_for_entity(
    entity_name: str,
    code_specs: list[CodeCallableSpec],
    ontology: OntologyModel,
) -> HumanInputCard | None:
    entity = next((candidate for candidate in ontology.entities if candidate.name == entity_name), None)
    if entity is None:
        return None
    candidates = _rank_candidates(entity, code_specs)
    if len(candidates) <= 1 or candidates[0][0] != candidates[1][0]:
        return None
    return build_ambiguity_human_card(entity, candidates)


def validate_selected_binding(
    entity: OntologyEntity,
    callable_spec: CodeCallableSpec,
    ontology: OntologyModel,
) -> list[Finding]:
    return _validate_required_fields(entity, callable_spec) + _validate_relations(entity, callable_spec, ontology)


def apply_human_decision(
    bindings: dict[str, CodeCallableSpec],
    code_specs: list[CodeCallableSpec],
    selected_option_id: str | None,
    response_value: str | None,
) -> dict[str, CodeCallableSpec]:
    if not selected_option_id and not response_value:
        return bindings
    spec_by_qualname = {spec.qualname: spec for spec in code_specs}
    entity_name: str | None = None
    qualname = response_value
    if selected_option_id and ":" in selected_option_id:
        entity_name, option_qualname = selected_option_id.split(":", 1)
        qualname = option_qualname
    if not qualname or qualname not in spec_by_qualname:
        return bindings
    entity_name = entity_name or _extract_entity_name_from_response(qualname, code_specs)
    if entity_name:
        bindings[entity_name] = spec_by_qualname[qualname]
    return bindings


def _extract_entity_name_from_response(response_value: str, code_specs: list[CodeCallableSpec]) -> str | None:
    normalized = _normalize(response_value)
    for spec in code_specs:
        if spec.qualname == response_value and spec.referenced_entities:
            return spec.referenced_entities[0]
        if spec.qualname == response_value:
            match = re.search(r"(payment|invoice|order|account|user)", normalized)
            if match:
                return match.group(1).capitalize()
    return None


def _rank_candidates(entity: OntologyEntity, code_specs: list[CodeCallableSpec]) -> list[tuple[int, CodeCallableSpec]]:
    entity_token = _normalize(entity.name)
    ranked: list[tuple[int, CodeCallableSpec]] = []
    for spec in code_specs:
        if entity.name not in spec.referenced_entities and entity_token not in _normalize(spec.qualname):
            continue
        score = 10
        normalized_name = spec.name.lower()
        for idx, prefix in enumerate(CALLABLE_PREFIX_ORDER):
            if normalized_name.startswith(prefix):
                score += 40 - (idx * 10)
                break
        if entity_token in _normalize(spec.qualname):
            score += 15
        if entity.name in spec.referenced_entities:
            score += 10
        ranked.append((score, spec))
    return sorted(ranked, key=lambda item: (-item[0], item[1].qualname))


def _validate_required_fields(entity: OntologyEntity, callable_spec: CodeCallableSpec) -> list[Finding]:
    findings: list[Finding] = []
    required_fields = entity.constraints.get("required_fields")
    if not isinstance(required_fields, list):
        return findings
    parameter_names = {parameter.name for parameter in callable_spec.parameters if parameter.kind == "positional_or_keyword"}
    missing_fields = [field for field in required_fields if field not in parameter_names]
    if missing_fields:
        findings.append(
            Finding(
                finding_type="code_missing_required_fields",
                severity=Severity.HIGH,
                expected=f"{callable_spec.qualname} accepts required fields {required_fields}",
                found=f"Missing callable parameters: {missing_fields}",
                evidence=f"Callable parameters are {sorted(parameter_names)}.",
                fix_hint="Add the missing required field parameters or bind the entity to a more appropriate callable.",
            )
        )
    return findings


def _validate_relations(
    entity: OntologyEntity,
    callable_spec: CodeCallableSpec,
    ontology: OntologyModel,
) -> list[Finding]:
    findings: list[Finding] = []
    allowed_targets = {relation.target for relation in ontology.relations if relation.source == entity.name}
    if not allowed_targets:
        return findings
    mentioned_other_entities = [
        target
        for target in callable_spec.mentioned_targets
        if target != entity.name
    ]
    for target in mentioned_other_entities:
        if target not in allowed_targets:
            findings.append(
                Finding(
                    finding_type="code_relation_mismatch",
                    severity=Severity.MEDIUM,
                    expected=f"{entity.name} code only mentions related targets {sorted(allowed_targets)}",
                    found=f"{callable_spec.qualname} mentions non-related target '{target}'",
                    evidence=callable_spec.docstring or callable_spec.source_snippet or callable_spec.qualname,
                    fix_hint="Update the callable/docstring to match ontology relations, or extend the ontology relation graph.",
                )
            )
    return findings


def _normalize(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", text.lower())
