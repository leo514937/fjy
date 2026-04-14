from __future__ import annotations

from types import SimpleNamespace

from ontology_audit_hub.infra.embeddings import OpenAIEmbeddingAdapter, normalize_embedding_model_name


class FakeEmbeddingsAPI:
    def __init__(self) -> None:
        self.calls: list[dict] = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        return SimpleNamespace(
            data=[
                SimpleNamespace(index=index, embedding=[float(index + 1)] * kwargs["dimensions"])
                for index, _ in enumerate(kwargs["input"])
            ]
        )


class FakeOpenAIClient:
    def __init__(self) -> None:
        self.embeddings = FakeEmbeddingsAPI()


def test_openai_embedding_adapter_uses_query_and_document_prefixes() -> None:
    client = FakeOpenAIClient()
    adapter = OpenAIEmbeddingAdapter(
        model="openai/text-embedding-3-small",
        dimensions=8,
        api_key="test-key",
        base_url="https://api.openai.com/v1",
        client=client,
    )

    query_vector = adapter.embed_query("payment rules")
    document_vectors = adapter.embed_documents(["invoice approval", "refund workflow"])

    assert len(query_vector) == 8
    assert len(document_vectors) == 2
    assert client.embeddings.calls[0]["model"] == "text-embedding-3-small"
    assert client.embeddings.calls[0]["input"] == ["Query: payment rules"]
    assert client.embeddings.calls[1]["input"] == ["Document: invoice approval", "Document: refund workflow"]


def test_normalize_embedding_model_name_strips_provider_prefixes() -> None:
    assert normalize_embedding_model_name("openai/text-embedding-3-small") == "text-embedding-3-small"
    assert normalize_embedding_model_name("openai:text-embedding-3-small") == "text-embedding-3-small"
    assert normalize_embedding_model_name("text-embedding-3-small") == "text-embedding-3-small"
