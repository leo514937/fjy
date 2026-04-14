from __future__ import annotations

from typing import Any

from entity_relation.schema import RelationDocument
from ner.llm import OpenRouterClient
from ner.schema import NerDocument, NerEntity
from ontology_core.models import ReconciliationResult
from ontology_store import OntologyStore
from ontology_store.models import CanonicalEntity, ChangeEvent
from ontology_store.store import build_change_event_id


def reconcile_document(
    *,
    run_id: str,
    document_id: str,
    ner_document: NerDocument,
    relation_document: RelationDocument,
    store: OntologyStore,
    llm_client: OpenRouterClient | None = None,
) -> ReconciliationResult:
    matched_entities = store.match_canonical_entities(ner_document.entities)
    llm_events: list[ChangeEvent] = []
    unresolved = [entity for entity in ner_document.entities if entity.entity_id not in matched_entities]
    if unresolved and llm_client is not None and llm_client.is_enabled():
        llm_matched, llm_events = _resolve_unmatched_entities_with_llm(
            run_id=run_id,
            unresolved_entities=unresolved,
            store=store,
            llm_client=llm_client,
        )
        matched_entities.update(llm_matched)

    mention_map, entity_events = store.upsert_canonical_entities(
        run_id=run_id,
        entities=ner_document.entities,
        matched_entities=matched_entities,
    )
    mention_to_canonical = {
        mention_id: canonical.canonical_id for mention_id, canonical in mention_map.items()
    }
    store.link_entity_mentions(mention_to_canonical)

    relation_payloads = [relation.model_dump(mode="json") for relation in relation_document.relations]
    relation_map, relation_events = store.upsert_canonical_relations(
        run_id=run_id,
        relations=relation_payloads,
        mention_to_canonical=mention_map,
    )
    relation_to_canonical = {
        relation_id: canonical_relation.canonical_relation_id
        for relation_id, canonical_relation in relation_map.items()
    }
    store.update_relation_mentions(
        relation_to_canonical,
        {
            relation_id: {
                "source_canonical_id": canonical_relation.source_canonical_id,
                "target_canonical_id": canonical_relation.target_canonical_id,
                "relation_type": canonical_relation.relation_type,
                "confidence": canonical_relation.confidence,
            }
            for relation_id, canonical_relation in relation_map.items()
        },
    )

    affected_ids = {canonical.canonical_id for canonical in mention_map.values()}
    for canonical_relation in relation_map.values():
        affected_ids.add(canonical_relation.source_canonical_id)
        affected_ids.add(canonical_relation.target_canonical_id)

    all_events = llm_events + entity_events + relation_events
    created_entities = sum(1 for event in entity_events if event.event_type == "created_entity")
    reused_entities = sum(1 for event in entity_events if event.event_type == "reused_entity")
    created_relations = sum(1 for event in relation_events if event.event_type == "created_relation")
    updated_relations = sum(1 for event in relation_events if event.event_type == "updated_relation")
    return ReconciliationResult(
        document_id=document_id,
        mention_to_canonical=mention_to_canonical,
        relation_to_canonical=relation_to_canonical,
        affected_canonical_entity_ids=sorted(affected_ids),
        changed_canonical_relation_ids=sorted({relation.canonical_relation_id for relation in relation_map.values()}),
        change_events=all_events,
        created_entities=created_entities,
        reused_entities=reused_entities,
        created_relations=created_relations,
        updated_relations=updated_relations,
    )


def _resolve_unmatched_entities_with_llm(
    *,
    run_id: str,
    unresolved_entities: list[NerEntity],
    store: OntologyStore,
    llm_client: OpenRouterClient,
) -> tuple[dict[str, CanonicalEntity], list[ChangeEvent]]:
    candidates_by_entity: dict[str, list[CanonicalEntity]] = {}
    for entity in unresolved_entities:
        candidates = store.get_candidate_canonical_entities(
            normalized_text=entity.normalized_text,
            ner_label=entity.label,
            limit=5,
        )
        if candidates:
            candidates_by_entity[entity.entity_id] = candidates
    if not candidates_by_entity:
        return {}, []
    decisions = llm_client.resolve_canonical_entities(unresolved_entities, candidates_by_entity)
    matched: dict[str, CanonicalEntity] = {}
    events: list[ChangeEvent] = []
    by_entity = {entity.entity_id: entity for entity in unresolved_entities}
    for entity_id, canonical_id in decisions.items():
        entity = by_entity.get(entity_id)
        if entity is None or not canonical_id:
            continue
        candidate = next(
            (
                item
                for item in candidates_by_entity.get(entity_id, [])
                if item.canonical_id == canonical_id
            ),
            None,
        )
        if candidate is None:
            continue
        matched[entity_id] = candidate
        events.append(
            ChangeEvent(
                event_id=build_change_event_id(run_id, "canonical_entity", canonical_id, f"llm-alias:{entity_id}"),
                run_id=run_id,
                object_type="canonical_entity",
                object_id=canonical_id,
                event_type="llm_alias_match",
                reason="openrouter-disambiguation",
                payload={
                    "mention_id": entity_id,
                    "mention_text": entity.normalized_text,
                    "canonical_id": canonical_id,
                },
            )
        )
    return matched, events
