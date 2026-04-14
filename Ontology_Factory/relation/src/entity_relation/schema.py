from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class EntityRelation(BaseModel):
    relation_id: str
    source_entity_id: str
    target_entity_id: str
    source_text: str
    target_text: str
    relation_type: str
    confidence: float
    evidence_sentence: str
    metadata: dict[str, Any] = Field(default_factory=dict)


class RelationDocument(BaseModel):
    doc_id: str
    relations: list[EntityRelation] = Field(default_factory=list)
