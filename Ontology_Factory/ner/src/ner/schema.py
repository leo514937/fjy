from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class NerEntity(BaseModel):
    entity_id: str
    text: str
    normalized_text: str
    label: str
    start: int
    end: int
    confidence: float | None = None
    source_sentence: str = ""
    metadata: dict[str, Any] = Field(default_factory=dict)


class NerDocument(BaseModel):
    doc_id: str
    source_text: str
    entities: list[NerEntity] = Field(default_factory=list)
