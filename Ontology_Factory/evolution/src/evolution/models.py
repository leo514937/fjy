from __future__ import annotations

from pydantic import BaseModel, Field


class ClassificationTask(BaseModel):
    canonical_id: str
    evidence_signature: str
    source_reason: str
    relation_signatures: list[str] = Field(default_factory=list)
