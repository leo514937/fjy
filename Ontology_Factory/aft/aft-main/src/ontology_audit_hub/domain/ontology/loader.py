from __future__ import annotations

from importlib import import_module
from pathlib import Path
from typing import Any, cast

from ontology_audit_hub.domain.ontology.models import OntologyModel

yaml = cast(Any, import_module("yaml"))


def load_ontology(path: str | Path) -> OntologyModel:
    ontology_path = Path(path)
    if not ontology_path.exists():
        raise FileNotFoundError(f"Ontology file not found: {ontology_path}")
    payload = yaml.safe_load(ontology_path.read_text(encoding="utf-8")) or {}
    return OntologyModel.model_validate(payload)
