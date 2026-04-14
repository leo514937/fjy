from __future__ import annotations

import itertools
from collections import defaultdict
from typing import TYPE_CHECKING, Any

from ner.schema import NerDocument

from pipeline.bootstrap import ensure_local_imports

if TYPE_CHECKING:
    from entity_relation.schema import EntityRelation
    from ontology_store.models import CanonicalEntity


def ner_document_to_graph(
    document: NerDocument,
    *,
    relations: list["EntityRelation"] | None = None,
    enable_cooccurrence_edges: bool = False,
):
    ensure_local_imports()
    from ontology_negotiator.models import GraphInput

    nodes: list[dict[str, Any]] = []
    edges: list[dict[str, Any]] = []

    for entity in document.entities:
        llm_description = str(entity.metadata.get("llm_description", "")).strip()
        source_sentences = list(entity.metadata.get("source_sentences", []))
        description = llm_description or entity.source_sentence or (source_sentences[0] if source_sentences else "")
        nodes.append(
            {
                "node_id": entity.entity_id,
                "name": entity.normalized_text or entity.text,
                "l_level": "L1",
                "description": description,
                "properties": {
                    "ner_label": entity.label,
                    "mentions": entity.metadata.get("mentions", []),
                    "occurrence_count": entity.metadata.get("occurrence_count", 1),
                    "source_sentences": source_sentences,
                    "normalization_notes": entity.metadata.get("normalization_notes", ""),
                    "llm_enhanced": entity.metadata.get("llm_enhanced", False),
                    "ran": entity.metadata.get("llm_ran", "") or description,
                    "ti": entity.metadata.get("llm_ti", "") or f"Entity extracted from {document.doc_id}.",
                },
            }
        )

    if relations:
        seen_relation_edges: set[tuple[str, str, str]] = set()
        for relation in relations:
            key = (relation.source_entity_id, relation.target_entity_id, relation.relation_type)
            if key in seen_relation_edges:
                continue
            seen_relation_edges.add(key)
            edges.append(
                {
                    "source": relation.source_entity_id,
                    "target": relation.target_entity_id,
                    "relation": relation.relation_type,
                }
            )

    if enable_cooccurrence_edges:
        sentence_map: dict[str, list[str]] = defaultdict(list)
        for entity in document.entities:
            for sentence in entity.metadata.get("source_sentences", []):
                if sentence:
                    sentence_map[str(sentence)].append(entity.entity_id)
        seen_edges: set[tuple[str, str]] = set()
        for entity_ids in sentence_map.values():
            unique_ids = list(dict.fromkeys(entity_ids))
            for left, right in itertools.combinations(unique_ids, 2):
                key = tuple(sorted((left, right)))
                if key in seen_edges:
                    continue
                seen_edges.add(key)
                edges.append({"source": left, "target": right, "relation": "co_occurs_with"})

    return GraphInput.model_validate({"nodes": nodes, "edges": edges})


def canonical_entity_to_graph(
    entity: "CanonicalEntity",
    *,
    neighbors: list["CanonicalEntity"],
    relations: list[dict[str, Any]],
    mentions: list[dict[str, Any]],
):
    ensure_local_imports()
    from ontology_negotiator.models import GraphInput

    mention_sentences = [
        str(item.get("source_sentence", "")).strip()
        for item in mentions
        if str(item.get("source_sentence", "")).strip()
    ]
    mention_preview = " ".join(dict.fromkeys(mention_sentences))[:300]
    node_lookup = {entity.canonical_id: entity, **{neighbor.canonical_id: neighbor for neighbor in neighbors}}
    nodes = []
    for item in [entity, *neighbors]:
        description = item.evidence_summary or mention_preview
        nodes.append(
            {
                "node_id": item.canonical_id,
                "name": item.preferred_name,
                "l_level": "L1",
                "description": description,
                "properties": {
                    "normalized_key": item.normalized_key,
                    "ner_label": item.ner_label,
                    "mention_count": item.mention_count,
                    "evidence_summary": item.evidence_summary,
                    "source_mentions": mentions if item.canonical_id == entity.canonical_id else [],
                    "ran": description,
                    "ti": f"Canonical entity {item.preferred_name}",
                },
            }
        )
    edges = []
    seen_edges: set[tuple[str, str, str]] = set()
    for relation in relations:
        source = str(relation.get("source_canonical_id", ""))
        target = str(relation.get("target_canonical_id", ""))
        relation_type = str(relation.get("relation_type", ""))
        key = (source, target, relation_type)
        if key in seen_edges:
            continue
        if source not in node_lookup or target not in node_lookup:
            continue
        seen_edges.add(key)
        edges.append({"source": source, "target": target, "relation": relation_type})
    return GraphInput.model_validate({"nodes": nodes, "edges": edges})
