from __future__ import annotations

import hashlib
import math
from typing import Any

tiktoken: Any | None

try:  # pragma: no cover - optional dependency path
    import tiktoken
except ImportError:  # pragma: no cover - optional dependency path
    tiktoken = None


def normalize_embedding_model_name(model_name: str) -> str:
    normalized = model_name.strip()
    for prefix in ("openai:", "openai/"):
        if normalized.startswith(prefix):
            return normalized[len(prefix) :].strip()
    return normalized


class SimpleHashEmbeddingAdapter:
    def __init__(self, dimensions: int = 32) -> None:
        self.dimensions = dimensions
        self.provider = "hash"
        self.model_name = f"hash-{dimensions}"

    def embed(self, text: str) -> list[float]:
        return self.embed_document(text)

    def embed_query(self, text: str) -> list[float]:
        return self._embed_prefixed(f"Query: {text}")

    def embed_document(self, text: str) -> list[float]:
        return self._embed_prefixed(f"Document: {text}")

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return [self.embed_document(text) for text in texts]

    def count_tokens(self, text: str) -> int:
        return len(self.encode_tokens(text))

    def encode_tokens(self, text: str) -> list[int]:
        if tiktoken is not None:
            encoding = _resolve_encoding("cl100k_base")
            return list(encoding.encode(text))
        return [ord(char) for char in text]

    def decode_tokens(self, tokens: list[int]) -> str:
        if not tokens:
            return ""
        if tiktoken is not None:
            encoding = _resolve_encoding("cl100k_base")
            return encoding.decode(tokens)
        return "".join(chr(token) for token in tokens)

    def _embed_prefixed(self, text: str) -> list[float]:
        vector = [0.0] * self.dimensions
        for token in text.lower().split():
            digest = hashlib.sha256(token.encode("utf-8")).digest()
            bucket = digest[0] % self.dimensions
            sign = 1.0 if digest[1] % 2 == 0 else -1.0
            vector[bucket] += sign
            if len(token) >= 3:
                for idx in range(len(token) - 2):
                    trigram = token[idx : idx + 3]
                    ngram_digest = hashlib.sha256(trigram.encode("utf-8")).digest()
                    ngram_bucket = ngram_digest[0] % self.dimensions
                    ngram_sign = 0.5 if ngram_digest[1] % 2 == 0 else -0.5
                    vector[ngram_bucket] += ngram_sign
        norm = math.sqrt(sum(value * value for value in vector)) or 1.0
        return [value / norm for value in vector]


class OpenAIEmbeddingAdapter:
    def __init__(
        self,
        *,
        provider: str = "openai",
        model: str = "text-embedding-3-small",
        dimensions: int = 1536,
        api_key: str | None,
        base_url: str | None = None,
        timeout: float = 20.0,
        client: Any | None = None,
    ) -> None:
        if provider != "openai":
            raise ValueError(f"Unsupported embedding provider '{provider}'.")
        normalized_model = normalize_embedding_model_name(model)
        if not normalized_model:
            raise RuntimeError("Embedding model is not configured.")
        if not api_key:
            raise RuntimeError("Embedding API key is not configured.")
        try:
            from openai import OpenAI
        except ImportError as exc:  # pragma: no cover - optional dependency path
            raise RuntimeError("openai is not installed. Install ontology-audit-hub with core dependencies.") from exc

        self.provider = provider
        self.model_name = normalized_model
        self.dimensions = dimensions
        self.api_key = api_key
        self.base_url = (base_url or "https://api.openai.com/v1").strip()
        self.timeout = timeout
        self.client = client or OpenAI(api_key=self.api_key, base_url=self.base_url, timeout=self.timeout)
        self._encoding = _resolve_encoding(self.model_name)

    def embed(self, text: str) -> list[float]:
        return self.embed_document(text)

    def embed_query(self, text: str) -> list[float]:
        return self._embed_many([_normalize_embedding_input("Query", text)])[0]

    def embed_document(self, text: str) -> list[float]:
        return self._embed_many([_normalize_embedding_input("Document", text)])[0]

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        prepared = [_normalize_embedding_input("Document", text) for text in texts]
        return self._embed_many(prepared)

    def count_tokens(self, text: str) -> int:
        return len(self.encode_tokens(text))

    def encode_tokens(self, text: str) -> list[int]:
        return list(self._encoding.encode(text))

    def decode_tokens(self, tokens: list[int]) -> str:
        if not tokens:
            return ""
        return self._encoding.decode(tokens)

    def _embed_many(self, inputs: list[str]) -> list[list[float]]:
        if not inputs:
            return []
        request: dict[str, Any] = {
            "model": self.model_name,
            "input": inputs,
        }
        if self.dimensions:
            request["dimensions"] = self.dimensions
        try:
            response = self.client.embeddings.create(**request)
        except Exception as exc:  # pragma: no cover - network failure surface
            raise RuntimeError(f"Embedding request failed: {exc}") from exc

        vectors = [list(item.embedding) for item in sorted(response.data, key=lambda item: item.index)]
        if self.dimensions and any(len(vector) != self.dimensions for vector in vectors):
            raise RuntimeError(
                f"Embedding provider returned unexpected vector size for model '{self.model_name}'."
            )
        return vectors


def build_default_embedding_adapter(settings: Any) -> OpenAIEmbeddingAdapter | SimpleHashEmbeddingAdapter:
    provider = getattr(settings, "rag_embedding_provider", "openai")
    model = getattr(settings, "rag_embedding_model", "text-embedding-3-small")
    api_key = getattr(settings, "rag_embedding_api_key", None)
    base_url = getattr(settings, "rag_embedding_base_url", None)
    dimensions = int(getattr(settings, "rag_embedding_dimensions", 1536))
    timeout = float(getattr(settings, "backend_timeout_seconds", 20.0))

    if provider == "openai" and model and api_key:
        return OpenAIEmbeddingAdapter(
            provider=provider,
            model=model,
            dimensions=dimensions,
            api_key=api_key,
            base_url=base_url,
            timeout=timeout,
        )
    return SimpleHashEmbeddingAdapter()


def _normalize_embedding_input(prefix: str, text: str) -> str:
    normalized = text.strip()
    if not normalized:
        return prefix
    return f"{prefix}: {normalized}"


def _resolve_encoding(model_name: str) -> Any:
    if tiktoken is None:  # pragma: no cover - optional dependency path
        raise RuntimeError("tiktoken is not installed. Install ontology-audit-hub with core dependencies.")
    normalized_model = normalize_embedding_model_name(model_name)
    try:
        return tiktoken.encoding_for_model(normalized_model)
    except KeyError:
        return tiktoken.get_encoding("cl100k_base")
