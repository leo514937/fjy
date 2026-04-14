from __future__ import annotations

from pydantic import ValidationError

from ontology_audit_hub.domain.documents.models import KnowledgeUploadConfig
from ontology_audit_hub.domain.documents.parser import chunk_uploaded_document
from ontology_audit_hub.infra.embeddings import SimpleHashEmbeddingAdapter


def test_chunk_uploaded_document_uses_character_windows_with_overlap() -> None:
    result = chunk_uploaded_document(
        filename="knowledge.md",
        text="# Rules\nABCDEFGHIJKLMNOPQRSTUVWXYZ",
        content_type="text/markdown",
        source_id="payment-rules",
        chunk_size=10,
        overlap_size=2,
    )

    assert result.section_titles == ["Rules"]
    assert [chunk.content for chunk in result.chunks] == [
        "ABCDEFGHIJ",
        "IJKLMNOPQR",
        "QRSTUVWXYZ",
    ]
    assert result.chunks[0].content[-2:] == result.chunks[1].content[:2]
    assert result.chunks[1].content[-2:] == result.chunks[2].content[:2]
    assert [chunk.chunk_index for chunk in result.chunks] == [0, 1, 2]


def test_chunk_uploaded_document_uses_overview_for_plain_text() -> None:
    result = chunk_uploaded_document(
        filename="knowledge.txt",
        text="Payment rules require invoice references.",
        content_type="text/plain",
        source_id="payment-rules",
        chunk_size=200,
        overlap_size=20,
    )

    assert result.section_titles == ["Overview"]
    assert len(result.chunks) == 1
    assert result.chunks[0].section == "Overview"
    assert result.chunks[0].source_id == "payment-rules"
    assert result.chunks[0].content_type == "text/plain"


def test_knowledge_upload_config_rejects_small_chunk_size() -> None:
    try:
        KnowledgeUploadConfig(chunk_size=199, overlap_size=10)
    except ValidationError as exc:
        assert "greater than or equal to 200" in str(exc)
    else:  # pragma: no cover - defensive assertion
        raise AssertionError("Expected KnowledgeUploadConfig validation to fail for chunk_size < 200.")


def test_knowledge_upload_config_rejects_overlap_larger_than_chunk_size() -> None:
    try:
        KnowledgeUploadConfig(chunk_size=300, overlap_size=300)
    except ValidationError as exc:
        assert "overlap_size must be smaller than chunk_size" in str(exc)
    else:  # pragma: no cover - defensive assertion
        raise AssertionError("Expected KnowledgeUploadConfig validation to fail when overlap_size >= chunk_size.")


def test_chunk_uploaded_document_defaults_to_token_aware_semantic_chunks() -> None:
    result = chunk_uploaded_document(
        filename="knowledge.md",
        text=(
            "# Overview\n"
            "Payment orchestration validates invoices before settlement.\n\n"
            "## Rules\n"
            + ("Amounts must remain positive and each payment carries an approval token. " * 8)
        ),
        content_type="text/markdown",
        source_id="payment-rules",
        target_chunk_tokens=30,
        chunk_overlap_tokens=6,
        max_chunk_tokens=40,
        embedding_adapter=SimpleHashEmbeddingAdapter(),
    )

    assert result.index_profile == "semantic_token_v1"
    assert result.heading_aware is True
    assert result.avg_chunk_tokens > 0
    assert all(chunk.heading_path for chunk in result.chunks)
    assert all(chunk.token_count and chunk.token_count > 0 for chunk in result.chunks)


def test_knowledge_upload_config_defaults_to_semantic_strategy_without_legacy_fields() -> None:
    config = KnowledgeUploadConfig(
        target_chunk_tokens=400,
        chunk_overlap_tokens=80,
        max_chunk_tokens=600,
    )

    assert config.chunk_strategy == "semantic_token_v1"
    assert config.index_profile == "semantic_token_v1"
