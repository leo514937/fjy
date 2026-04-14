from __future__ import annotations

import re

from ontology_audit_hub.domain.documents.models import DocumentChunk, DocumentClaim
from ontology_audit_hub.domain.ontology.models import OntologyModel

RELATION_VERBS = ("generates", "creates", "references", "links")


def extract_claims(chunks: list[DocumentChunk], ontology: OntologyModel) -> list[DocumentClaim]:
    claims: list[DocumentClaim] = []
    entity_map = {entity.name: entity for entity in ontology.entities}
    for chunk in chunks:
        for sentence in _split_sentences(chunk.content):
            lowered_sentence = sentence.lower()
            for entity_name, entity in entity_map.items():
                if entity_name.lower() not in lowered_sentence:
                    continue
                claimed_fields = [attribute for attribute in entity.attributes if attribute.lower() in lowered_sentence]
                if " with " in lowered_sentence and claimed_fields:
                    claims.append(
                        DocumentClaim(
                            source_file=chunk.source_file,
                            section=chunk.section,
                            claim_type="required_fields",
                            subject=entity_name,
                            predicate="requires_fields",
                            object=claimed_fields,
                            evidence=sentence.strip(),
                        )
                    )
                relation_claim = _extract_relation_claim(sentence, chunk.source_file, chunk.section, entity_name)
                if relation_claim is not None:
                    claims.append(relation_claim)
    return claims


def merge_claims(*claim_sets: list[DocumentClaim]) -> list[DocumentClaim]:
    merged: list[DocumentClaim] = []
    seen: set[tuple[str, str, str, str, str, str]] = set()
    for claims in claim_sets:
        for claim in claims:
            claim_key = (
                claim.source_file,
                claim.section,
                claim.claim_type,
                claim.subject,
                claim.predicate,
                str(claim.object),
            )
            if claim_key in seen:
                continue
            seen.add(claim_key)
            merged.append(claim)
    return merged


def _extract_relation_claim(
    sentence: str,
    source_file: str,
    section: str,
    entity_name: str,
) -> DocumentClaim | None:
    verb_pattern = re.compile(
        rf"\b{re.escape(entity_name)}\b.*?\b(?P<verb>{'|'.join(RELATION_VERBS)})\b(?P<trailing>.*)",
        re.IGNORECASE,
    )
    match = verb_pattern.search(sentence)
    if match is None:
        return None

    trailing = match.group("trailing")
    object_match = re.search(r"`(?P<object>[A-Za-z][A-Za-z0-9_]*)`", trailing)
    if object_match is None:
        object_match = re.search(r"\b(?:one|a|an)\s+(?P<object>[A-Z][A-Za-z0-9_]*)\b", trailing)
    if object_match is None:
        object_match = re.search(r"\b(?P<object>[A-Z][A-Za-z0-9_]*)\b", trailing)
    if object_match is None:
        return None

    return DocumentClaim(
        source_file=source_file,
        section=section,
        claim_type="relation",
        subject=entity_name,
        predicate=match.group("verb").lower(),
        object=object_match.group("object"),
        evidence=sentence.strip(),
    )


def _split_sentences(content: str) -> list[str]:
    parts = re.split(r"(?<=[.!?])\s+|\n+", content)
    return [part.strip() for part in parts if part.strip()]
