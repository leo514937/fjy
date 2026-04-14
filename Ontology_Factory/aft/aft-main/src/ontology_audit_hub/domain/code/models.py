from __future__ import annotations

from pydantic import BaseModel, Field


class CodeParameterSpec(BaseModel):
    name: str
    annotation: str = ""
    has_default: bool = False
    default_repr: str | None = None
    kind: str = "positional_or_keyword"


class CodeCallableSpec(BaseModel):
    module_path: str
    qualname: str
    name: str
    callable_type: str
    parameters: list[CodeParameterSpec] = Field(default_factory=list)
    return_annotation: str = ""
    docstring: str = ""
    source_snippet: str = ""
    referenced_entities: list[str] = Field(default_factory=list)
    referenced_attributes: list[str] = Field(default_factory=list)
    unknown_entity_references: list[str] = Field(default_factory=list)
    mentioned_targets: list[str] = Field(default_factory=list)
    relation_verbs: list[str] = Field(default_factory=list)


class CodeModuleSpec(BaseModel):
    module_path: str
    callables: list[CodeCallableSpec] = Field(default_factory=list)
