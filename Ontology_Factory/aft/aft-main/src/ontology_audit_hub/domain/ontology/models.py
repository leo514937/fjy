from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class OntologyEntity(BaseModel):
    name: str
    description: str = ""
    attributes: list[str] = Field(default_factory=list)
    constraints: dict[str, object] = Field(default_factory=dict)


class OntologyRelation(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    source: str
    target: str
    relation_type: str = Field(alias="type")
    description: str = ""


class OntologyConstraint(BaseModel):
    entity: str | None = None
    rule: str
    description: str = ""


class OntologyModel(BaseModel):
    version: str = "1.0"
    entities: list[OntologyEntity] = Field(default_factory=list)
    relations: list[OntologyRelation] = Field(default_factory=list)
    constraints: list[OntologyConstraint] = Field(default_factory=list)
