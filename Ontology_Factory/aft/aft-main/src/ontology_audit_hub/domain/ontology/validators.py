from __future__ import annotations

from collections import Counter, defaultdict

from ontology_audit_hub.domain.audit.models import Finding, Severity
from ontology_audit_hub.domain.ontology.models import OntologyModel


def validate_ontology(ontology: OntologyModel) -> list[Finding]:
    findings: list[Finding] = []
    entity_names = [entity.name for entity in ontology.entities]
    entity_set = set(entity_names)

    for entity_name, count in Counter(entity_names).items():
        if count > 1:
            findings.append(
                Finding(
                    finding_type="ontology_duplicate_entity",
                    severity=Severity.HIGH,
                    expected=f"Entity '{entity_name}' is declared exactly once",
                    found=f"Entity '{entity_name}' is declared {count} times",
                    evidence="Ontology entity names must be unique for deterministic relation and constraint resolution.",
                    fix_hint=f"Keep a single '{entity_name}' entity definition and merge duplicate metadata.",
                )
            )

    adjacency: dict[str, set[str]] = defaultdict(set)
    connected_entities: set[str] = set()
    for relation in ontology.relations:
        if relation.source not in entity_set:
            findings.append(
                Finding(
                    finding_type="ontology_missing_relation_source",
                    severity=Severity.HIGH,
                    expected=f"Relation source '{relation.source}' exists as an entity",
                    found=f"Relation source '{relation.source}' is undefined",
                    evidence=f"Relation {relation.source} -[{relation.relation_type}]-> {relation.target} references an unknown source entity.",
                    fix_hint="Define the missing source entity or repair the relation source reference.",
                )
            )
        if relation.target not in entity_set:
            findings.append(
                Finding(
                    finding_type="ontology_missing_relation_target",
                    severity=Severity.HIGH,
                    expected=f"Relation target '{relation.target}' exists as an entity",
                    found=f"Relation target '{relation.target}' is undefined",
                    evidence=f"Relation {relation.source} -[{relation.relation_type}]-> {relation.target} references an unknown target entity.",
                    fix_hint="Define the missing target entity or repair the relation target reference.",
                )
            )
        if relation.source in entity_set and relation.target in entity_set:
            adjacency[relation.source].add(relation.target)
            connected_entities.add(relation.source)
            connected_entities.add(relation.target)

    for entity in ontology.entities:
        required_fields = entity.constraints.get("required_fields")
        if required_fields is None:
            continue
        if not isinstance(required_fields, list) or not required_fields:
            findings.append(
                Finding(
                    finding_type="ontology_invalid_required_constraints",
                    severity=Severity.MEDIUM,
                    expected=f"Entity '{entity.name}' declares a non-empty required_fields list",
                    found=f"Entity '{entity.name}' has invalid required_fields={required_fields!r}",
                    evidence=f"Entity '{entity.name}' defines required_fields under constraints.",
                    fix_hint="Set constraints.required_fields to a non-empty list of attribute names.",
                )
            )
            continue
        missing_fields = [field for field in required_fields if field not in entity.attributes]
        if missing_fields:
            findings.append(
                Finding(
                    finding_type="ontology_invalid_required_constraints",
                    severity=Severity.MEDIUM,
                    expected=f"Entity '{entity.name}' required_fields reference declared attributes only",
                    found=f"Missing attributes referenced by required_fields: {missing_fields}",
                    evidence=f"Entity '{entity.name}' attributes are {entity.attributes}.",
                    fix_hint="Add the missing attributes or remove them from constraints.required_fields.",
                )
            )

    for constraint in ontology.constraints:
        if constraint.entity and constraint.entity not in entity_set:
            findings.append(
                Finding(
                    finding_type="ontology_constraint_unknown_entity",
                    severity=Severity.MEDIUM,
                    expected=f"Constraint entity '{constraint.entity}' exists in the ontology",
                    found=f"Constraint rule '{constraint.rule}' points to an unknown entity",
                    evidence=f"Top-level constraint references entity '{constraint.entity}'.",
                    fix_hint="Repair the constraint.entity reference or define the missing entity.",
                )
            )
        if constraint.entity:
            connected_entities.add(constraint.entity)

    for entity in ontology.entities:
        if entity.name not in connected_entities:
            findings.append(
                Finding(
                    finding_type="ontology_isolated_entity",
                    severity=Severity.LOW,
                    expected=f"Entity '{entity.name}' participates in at least one relation or top-level constraint",
                    found=f"Entity '{entity.name}' is isolated",
                    evidence=f"Entity '{entity.name}' has no incoming/outgoing relations and no top-level constraints reference it.",
                    fix_hint="Either relate the entity to the ontology graph or remove it if it is obsolete.",
                )
            )

    cycle = _find_cycle(entity_set, adjacency)
    if cycle:
        findings.append(
            Finding(
                finding_type="ontology_illegal_cycle",
                severity=Severity.MEDIUM,
                expected="Ontology relations form an acyclic dependency path",
                found=f"Detected cycle: {' -> '.join(cycle)}",
                evidence="A simple cycle was found in the relation graph during ontology validation.",
                fix_hint="Break the cycle by removing or redirecting one of the offending relations.",
            )
        )

    return findings


def _find_cycle(entity_set: set[str], adjacency: dict[str, set[str]]) -> list[str] | None:
    visited: set[str] = set()
    stack: list[str] = []
    in_stack: set[str] = set()

    def visit(node: str) -> list[str] | None:
        visited.add(node)
        stack.append(node)
        in_stack.add(node)
        for neighbor in adjacency.get(node, set()):
            if neighbor not in entity_set:
                continue
            if neighbor not in visited:
                cycle = visit(neighbor)
                if cycle:
                    return cycle
            elif neighbor in in_stack:
                start = stack.index(neighbor)
                return stack[start:] + [neighbor]
        stack.pop()
        in_stack.remove(node)
        return None

    for entity in entity_set:
        if entity not in visited:
            cycle = visit(entity)
            if cycle:
                return cycle
    return None
