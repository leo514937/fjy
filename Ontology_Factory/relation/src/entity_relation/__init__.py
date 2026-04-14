"""Relation extraction exports."""

from entity_relation.extractor import extract_relations
from entity_relation.schema import EntityRelation, RelationDocument

__all__ = ["EntityRelation", "RelationDocument", "extract_relations"]
