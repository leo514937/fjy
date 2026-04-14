from __future__ import annotations

"""Global config loading for OntologyNegotiator."""

from pathlib import Path
from typing import Any

try:
    import tomllib
except ModuleNotFoundError:  # pragma: no cover - Python < 3.11 fallback
    import tomli as tomllib
from pydantic import BaseModel, ConfigDict, Field


class OpenAIConfig(BaseModel):
    """OpenAI-compatible model settings."""

    model_config = ConfigDict(extra="ignore")

    api_key: str = ""
    model: str = ""
    fallback_model: str = ""
    base_url: str | None = None
    temperature: float = 0.0
    timeout: float | None = None
    max_retries: int | None = None


class LLMRetryConfig(BaseModel):
    """Local retry policy for transient LLM failures."""

    model_config = ConfigDict(extra="ignore")

    max_attempts: int = 3
    base_delay_seconds: float = 0.5
    max_delay_seconds: float = 4.0
    jitter_seconds: float = 0.2


class NegotiationConfig(BaseModel):
    """Negotiation loop limits and guardrails."""

    model_config = ConfigDict(extra="ignore")

    min_rounds: int = 2
    max_rounds: int = 5


class AppConfig(BaseModel):
    """Top-level application config."""

    model_config = ConfigDict(extra="ignore")

    openai: OpenAIConfig = Field(default_factory=OpenAIConfig)
    llm_retry: LLMRetryConfig = Field(default_factory=LLMRetryConfig)


    negotiation: NegotiationConfig = Field(default_factory=NegotiationConfig)
def default_config_path() -> Path:
    """Return the repository default config path."""
    return Path(__file__).resolve().parents[2] / "config" / "ontology_negotiator.toml"


def load_app_config(config_path: str | Path | None = None) -> AppConfig:
    """Load application config from TOML."""
    path = Path(config_path) if config_path else default_config_path()
    if not path.exists():
        return AppConfig()
    with path.open("rb") as fh:
        payload = tomllib.load(fh)
    return AppConfig.model_validate(payload)


def is_configured_api_key(api_key: str | None) -> bool:
    """Return True when the API key is not a placeholder."""
    if not api_key:
        return False
    normalized = api_key.strip()
    if not normalized:
        return False
    placeholder_markers = (
        "replace",
        "your api key",
        "example",
        "dummy",
    )
    return not any(marker in normalized.lower() for marker in placeholder_markers)


def build_chat_openai_kwargs(
    *,
    app_config: AppConfig,
    model_name: str | None,
    llm_kwargs: dict[str, Any],
) -> dict[str, Any]:
    """Merge config and runtime kwargs for ChatOpenAI."""
    openai_config = app_config.openai
    merged_kwargs: dict[str, Any] = {
        "model": model_name or openai_config.model,
        "temperature": openai_config.temperature,
    }
    if is_configured_api_key(openai_config.api_key):
        merged_kwargs["api_key"] = openai_config.api_key
    if openai_config.base_url:
        merged_kwargs["base_url"] = openai_config.base_url
    if openai_config.timeout is not None:
        merged_kwargs["timeout"] = openai_config.timeout
    if openai_config.max_retries is not None:
        merged_kwargs["max_retries"] = openai_config.max_retries
    merged_kwargs.update(llm_kwargs)
    return merged_kwargs


