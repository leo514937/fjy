from __future__ import annotations

from pydantic import BaseModel, Field

from ontology_store.models import ChangeEvent


class ReconciliationResult(BaseModel):
    document_id: str
    mention_to_canonical: dict[str, str] = Field(default_factory=dict)
    relation_to_canonical: dict[str, str] = Field(default_factory=dict)
    affected_canonical_entity_ids: list[str] = Field(default_factory=list)
    changed_canonical_relation_ids: list[str] = Field(default_factory=list)
    change_events: list[ChangeEvent] = Field(default_factory=list)
    created_entities: int = 0
    reused_entities: int = 0
    created_relations: int = 0
    updated_relations: int = 0
