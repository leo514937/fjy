from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, Field

from pipeline.bootstrap import workspace_root


class PreprocessSettings(BaseModel):
    config_path: str = str(workspace_root() / "preprocess" / "config.yaml")


class NerSettings(BaseModel):
    provider: str = "hanlp"
    model_name: str = "MSRA_NER_BERT_BASE_ZH"
    use_llm: bool = True


class DlsSettings(BaseModel):
    config_path: str = str(workspace_root() / "dls" / "config" / "ontology_negotiator.toml")
    artifact_root: str = ""
    max_concurrency: int = 1


class OutputSettings(BaseModel):
    root_dir: str = str(workspace_root() / "pipeline" / "outputs")
    enable_cooccurrence_edges: bool = False
    max_entities_for_classification: int = 0


class StorageSettings(BaseModel):
    enabled: bool = True
    database_path: str = str(workspace_root() / "storage" / "data" / "classification_store.sqlite3")


class PipelineConfig(BaseModel):
    preprocess: PreprocessSettings = Field(default_factory=PreprocessSettings)
    ner: NerSettings = Field(default_factory=NerSettings)
    llm: dict[str, Any] = Field(default_factory=dict)
    dls: DlsSettings = Field(default_factory=DlsSettings)
    output: OutputSettings = Field(default_factory=OutputSettings)
    storage: StorageSettings = Field(default_factory=StorageSettings)


def load_pipeline_config(path: str | None = None) -> PipelineConfig:
    if path is None:
        return PipelineConfig()
    config_path = Path(path).resolve()
    payload = yaml.safe_load(config_path.read_text(encoding="utf-8")) or {}
    config = PipelineConfig.model_validate(payload)
    base_dir = config_path.parent
    config.preprocess.config_path = _resolve_path(config.preprocess.config_path, base_dir)
    config.dls.config_path = _resolve_path(config.dls.config_path, base_dir)
    config.dls.artifact_root = _resolve_optional_path(config.dls.artifact_root, base_dir)
    config.output.root_dir = _resolve_path(config.output.root_dir, base_dir)
    config.storage.database_path = _resolve_path(config.storage.database_path, base_dir)
    return config


def _resolve_path(raw_path: str, base_dir: Path) -> str:
    path = Path(raw_path).expanduser()
    if not path.is_absolute():
        path = (base_dir / path).resolve()
    return str(path)


def _resolve_optional_path(raw_path: str, base_dir: Path) -> str:
    if not raw_path.strip():
        return ""
    return _resolve_path(raw_path, base_dir)
