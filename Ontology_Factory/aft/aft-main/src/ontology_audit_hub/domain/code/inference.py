from __future__ import annotations

import re

from ontology_audit_hub.domain.code.models import CodeCallableSpec, CodeModuleSpec
from ontology_audit_hub.domain.ontology.models import OntologyModel

RELATION_HINTS = ("generate", "generates", "create", "creates", "reference", "references", "link", "links")
KNOWN_TYPE_WORDS = {
    "str",
    "int",
    "float",
    "bool",
    "dict",
    "list",
    "none",
    "optional",
    "true",
    "false",
    "validate",
    "check",
    "create",
    "return",
    "records",
    "objects",
    "payment",
    "invoice",
}


def infer_code_specs(modules: list[CodeModuleSpec], ontology: OntologyModel) -> list[CodeCallableSpec]:
    enriched: list[CodeCallableSpec] = []
    entity_names = [entity.name for entity in ontology.entities]
    attribute_names = {attribute for entity in ontology.entities for attribute in entity.attributes}
    for module in modules:
        for callable_spec in module.callables:
            haystack = " ".join(
                [
                    callable_spec.qualname,
                    callable_spec.docstring,
                    callable_spec.return_annotation,
                    " ".join(parameter.name for parameter in callable_spec.parameters),
                    " ".join(parameter.annotation for parameter in callable_spec.parameters if parameter.annotation),
                ]
            )
            lowered = _normalize_text(haystack)
            callable_spec.referenced_entities = [
                entity_name
                for entity_name in entity_names
                if _normalize_token(entity_name) in lowered
            ]
            callable_spec.referenced_attributes = [
                attribute_name
                for attribute_name in attribute_names
                if _normalize_token(attribute_name) in lowered
            ]
            callable_spec.mentioned_targets = [
                entity_name
                for entity_name in entity_names
                if entity_name not in callable_spec.referenced_entities and _normalize_token(entity_name) in lowered
            ]
            callable_spec.relation_verbs = sorted({hint for hint in RELATION_HINTS if hint in lowered})
            callable_spec.unknown_entity_references = [
                token
                for token in _extract_entity_like_tokens(callable_spec.docstring)
                if token not in entity_names and token.lower() not in KNOWN_TYPE_WORDS
            ]
            enriched.append(callable_spec)
    return enriched


def _normalize_text(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", text.lower())


def _normalize_token(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()


def _extract_entity_like_tokens(text: str) -> list[str]:
    tokens = sorted(set(re.findall(r"\b[A-Z][A-Za-z0-9_]+\b", text)))
    return [token for token in tokens if token.lower() not in {"validate", "check", "create", "return", "records", "objects"}]
