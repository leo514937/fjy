"""Compatibility shim for callers that still import pipeline.store."""

from ontology_store import (
    CachedClassification,
    ClassificationStore,
    OntologyStore,
    build_cache_key,
    build_relation_cache_key,
)

__all__ = [
    "CachedClassification",
    "ClassificationStore",
    "OntologyStore",
    "build_cache_key",
    "build_relation_cache_key",
]
