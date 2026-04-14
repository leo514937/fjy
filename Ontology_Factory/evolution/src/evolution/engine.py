from __future__ import annotations

from typing import Any

from evolution.models import ClassificationTask
from ontology_store import OntologyStore
from ontology_store.models import CanonicalEntity, ChangeEvent
from ontology_store.store import build_change_event_id, build_evidence_signature


def build_classification_tasks(
    *,
    run_id: str,
    store: OntologyStore,
    candidate_canonical_ids: list[str],
) -> tuple[list[ClassificationTask], list[ChangeEvent]]:
    tasks: list[ClassificationTask] = []
    events: list[ChangeEvent] = []
    for canonical_id in sorted(set(candidate_canonical_ids)):
        canonical = store.get_canonical_entity(canonical_id)
        if canonical is None:
            continue
        relation_signatures = _relation_signatures(store, canonical_id)
        evidence_signature = build_evidence_signature(
            normalized_key=canonical.normalized_key,
            relation_signatures=relation_signatures,
        )
        current = store.get_current_classification(canonical_id)
        if current is None:
            tasks.append(
                ClassificationTask(
                    canonical_id=canonical_id,
                    evidence_signature=evidence_signature,
                    source_reason="new_or_unclassified",
                    relation_signatures=relation_signatures,
                )
            )
            continue
        if current.evidence_signature != evidence_signature:
            tasks.append(
                ClassificationTask(
                    canonical_id=canonical_id,
                    evidence_signature=evidence_signature,
                    source_reason="evidence_signature_changed",
                    relation_signatures=relation_signatures,
                )
            )
            events.append(
                ChangeEvent(
                    event_id=build_change_event_id(run_id, "canonical_entity", canonical_id, "reclassify"),
                    run_id=run_id,
                    object_type="canonical_entity",
                    object_id=canonical_id,
                    event_type="reclassification_scheduled",
                    reason="evidence_signature_changed",
                    payload={
                        "previous_signature": current.evidence_signature,
                        "new_signature": evidence_signature,
                    },
                )
            )
    return tasks, events


def build_canonical_entity_payload(
    store: OntologyStore,
    canonical_id: str,
    *,
    max_neighbors: int = 6,
) -> tuple[CanonicalEntity, list[CanonicalEntity], list[dict[str, Any]], list[dict[str, Any]]]:
    entity = store.get_canonical_entity(canonical_id)
    if entity is None:
        raise KeyError(f"canonical entity not found: {canonical_id}")
    relations = store.list_neighbor_relations(canonical_id)
    selected_relations = relations[:max_neighbors] if max_neighbors > 0 else relations
    neighbor_ids = {
        relation.source_canonical_id if relation.target_canonical_id == canonical_id else relation.target_canonical_id
        for relation in selected_relations
    }
    neighbors = [item for item in store.list_canonical_entities(sorted(neighbor_ids)) if item.canonical_id != canonical_id]
    mentions = store.list_entity_mentions(canonical_id)
    relation_payloads = [relation.model_dump(mode="json") for relation in selected_relations]
    return entity, neighbors, relation_payloads, mentions


def build_classification_change_events(
    *,
    run_id: str,
    classification_tasks: list[ClassificationTask],
    persisted_results: dict[str, dict[str, Any]],
) -> list[ChangeEvent]:
    events: list[ChangeEvent] = []
    by_task = {task.canonical_id: task for task in classification_tasks}
    for canonical_id, result in persisted_results.items():
        task = by_task.get(canonical_id)
        if task is None:
            continue
        events.append(
            ChangeEvent(
                event_id=build_change_event_id(run_id, "canonical_entity", canonical_id, "classified"),
                run_id=run_id,
                object_type="canonical_entity",
                object_id=canonical_id,
                event_type="classification_updated",
                reason=task.source_reason,
                payload={
                    "ontology_label": result.get("ontology_label", ""),
                    "confidence": result.get("confidence", 0.0),
                    "evidence_signature": task.evidence_signature,
                },
            )
        )
    return events


def _relation_signatures(store: OntologyStore, canonical_id: str) -> list[str]:
    signatures: list[str] = []
    for relation in store.list_neighbor_relations(canonical_id):
        if relation.source_canonical_id == canonical_id:
            other_id = relation.target_canonical_id
        else:
            other_id = relation.source_canonical_id
        signatures.append(f"{relation.relation_type}:{other_id}")
    return sorted(set(signatures))
