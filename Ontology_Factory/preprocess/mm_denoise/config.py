from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional

import yaml


@dataclass(frozen=True)
class ModelCandidate:
    name: str
    provider: str
    base_url: str
    api_key_env: str
    model: str
    timeout_s: int = 60


@dataclass(frozen=True)
class ArbitrationConfig:
    max_relative_change: float = 0.08
    require_numbers_preserved: bool = True
    require_two_models_agree: bool = False


@dataclass(frozen=True)
class ChunkingConfig:
    enabled: bool = True
    max_chars: int = 3500


@dataclass(frozen=True)
class ModelsConfig:
    enabled: bool
    candidates: List[ModelCandidate]
    arbitration: ArbitrationConfig
    chunking: ChunkingConfig


@dataclass(frozen=True)
class IOConfig:
    input_globs: List[str]
    output_dir: str
    encoding_fallbacks: List[str]


@dataclass(frozen=True)
class PipelineConfig:
    conservative: bool = True
    output: str = "clean_text"


@dataclass(frozen=True)
class AppConfig:
    pipeline: PipelineConfig
    io: IOConfig
    models: ModelsConfig


def _get(d: Dict[str, Any], path: str, default: Any = None) -> Any:
    cur: Any = d
    for part in path.split("."):
        if not isinstance(cur, dict) or part not in cur:
            return default
        cur = cur[part]
    return cur


def load_config(path: str) -> AppConfig:
    with open(path, "r", encoding="utf-8") as f:
        raw = yaml.safe_load(f) or {}

    pipeline = PipelineConfig(
        conservative=bool(_get(raw, "pipeline.conservative", True)),
        output=str(_get(raw, "pipeline.output", "clean_text")),
    )

    io = IOConfig(
        input_globs=list(_get(raw, "io.input_globs", ["*.txt"])),
        output_dir=str(_get(raw, "io.output_dir", "outputs")),
        encoding_fallbacks=list(_get(raw, "io.encoding_fallbacks", ["utf-8", "utf-8-sig"])),
    )

    arb_raw = _get(raw, "models.arbitration", {}) or {}
    arbitration = ArbitrationConfig(
        max_relative_change=float(arb_raw.get("max_relative_change", 0.08)),
        require_numbers_preserved=bool(arb_raw.get("require_numbers_preserved", True)),
        require_two_models_agree=bool(arb_raw.get("require_two_models_agree", False)),
    )

    candidates_raw = _get(raw, "models.candidates", []) or []
    candidates: List[ModelCandidate] = []
    for c in candidates_raw:
        if not isinstance(c, dict):
            continue
        candidates.append(
            ModelCandidate(
                name=str(c.get("name", "")),
                provider=str(c.get("provider", "openai_compat")),
                base_url=str(c.get("base_url", "")),
                api_key_env=str(c.get("api_key_env", "")),
                model=str(c.get("model", "")),
                timeout_s=int(c.get("timeout_s", 60)),
            )
        )

    chunk_raw = _get(raw, "models.chunking", {}) or {}
    chunking = ChunkingConfig(
        enabled=bool(chunk_raw.get("enabled", True)),
        max_chars=int(chunk_raw.get("max_chars", 3500)),
    )

    models = ModelsConfig(
        enabled=bool(_get(raw, "models.enabled", False)),
        candidates=candidates,
        arbitration=arbitration,
        chunking=chunking,
    )

    return AppConfig(pipeline=pipeline, io=io, models=models)

