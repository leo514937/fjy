from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from ontology_audit_hub.api import create_app
from ontology_audit_hub.infra.checkpointing import SqliteCheckpointStoreFactory
from ontology_audit_hub.infra.graph_augmenter import NullGraphAugmenter
from ontology_audit_hub.infra.human_store import FileHumanInteractionStore
from ontology_audit_hub.infra.retrieval import NullRetriever, QdrantRetriever
from ontology_audit_hub.infra.runtime import GraphRuntime
from ontology_audit_hub.infra.settings import AuditHubSettings
from ontology_audit_hub.knowledge_service import KnowledgeUploadService
from ontology_audit_hub.qa_service import QuestionAnswerService
from ontology_audit_hub.service import SupervisorService
from tests.support.document_samples import DOCX_CONTENT_TYPE, PDF_CONTENT_TYPE, build_docx_bytes, build_pdf_bytes


def _make_knowledge_settings(tmp_path: Path) -> AuditHubSettings:
    return AuditHubSettings(
        run_root=tmp_path / "runs",
        checkpoint_path=tmp_path / "checkpoints.sqlite3",
        qdrant_enabled=True,
        qdrant_mode="embedded",
        qdrant_path=tmp_path / "qdrant",
        qdrant_collection_name="knowledge_upload_test",
        qdrant_upload_chunk_size=240,
        qdrant_upload_overlap_size=60,
        neo4j_enabled=False,
        llm_enabled=False,
    )


def _make_audit_service(tmp_path: Path) -> SupervisorService:
    settings = AuditHubSettings(
        run_root=tmp_path / "runs",
        checkpoint_path=tmp_path / "checkpoints.sqlite3",
        qdrant_enabled=False,
        neo4j_enabled=False,
        llm_enabled=False,
    )
    return SupervisorService(
        settings=settings,
        runtime=GraphRuntime(
            retriever=NullRetriever(),
            graph_augmenter=NullGraphAugmenter(),
            interrupt_on_human=False,
        ),
        checkpoint_store_factory=SqliteCheckpointStoreFactory(tmp_path / "checkpoints.sqlite3"),
        human_store=FileHumanInteractionStore(tmp_path / "human"),
    )


def _make_client(tmp_path: Path) -> tuple[TestClient, AuditHubSettings]:
    settings = _make_knowledge_settings(tmp_path)
    client = TestClient(
        create_app(
            service=_make_audit_service(tmp_path / "audit-service"),
            qa_service=QuestionAnswerService(
                settings=AuditHubSettings(
                    qdrant_enabled=False,
                    neo4j_enabled=False,
                    llm_enabled=False,
                )
            ),
            knowledge_service=KnowledgeUploadService(settings=settings),
        )
    )
    return client, settings


def test_knowledge_upload_indexes_markdown_chunks_and_returns_metrics(tmp_path: Path) -> None:
    client, settings = _make_client(tmp_path)
    markdown = (
        "# Overview\n"
        + ("Payment orchestration keeps invoice references and refund state transitions. " * 6)
        + "\n# Rules\n"
        + ("Amounts must stay positive and every payment stores an approval token. " * 6)
    ).encode("utf-8")

    response = client.post(
        "/knowledge/upload",
        data={
            "chunk_size": "220",
            "overlap_size": "40",
            "source_id": "payments-doc",
        },
        files={"file": ("knowledge.md", markdown, "text/markdown")},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["collection_name"] == settings.qdrant_collection_name
    assert payload["source_id"] == "payments-doc"
    assert payload["filename"] == "knowledge.md"
    assert payload["chunk_size"] == 220
    assert payload["overlap_size"] == 40
    assert payload["section_count"] == 2
    assert payload["chunk_count"] >= 2
    assert payload["total_characters"] == len(markdown.decode("utf-8"))
    assert payload["replaced_existing_chunks"] is False
    assert payload["sample_sections"] == ["Overview", "Rules"]

    retriever = QdrantRetriever(path=settings.qdrant_path, collection_name=payload["collection_name"])
    try:
        hits = retriever.search("approval token payment", limit=3)
        assert hits
        assert any(hit.source_file == "knowledge.md" for hit in hits)
    finally:
        retriever.close()


def test_knowledge_upload_indexes_pdf_chunks_and_returns_metrics(tmp_path: Path) -> None:
    client, settings = _make_client(tmp_path)
    pdf_bytes = build_pdf_bytes("Payment approvals require a signed approval token.")

    response = client.post(
        "/knowledge/upload",
        data={"source_id": "payments-pdf"},
        files={"file": ("knowledge.pdf", pdf_bytes, PDF_CONTENT_TYPE)},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["collection_name"] == settings.qdrant_collection_name
    assert payload["source_id"] == "payments-pdf"
    assert payload["filename"] == "knowledge.pdf"
    assert payload["content_type"] == PDF_CONTENT_TYPE
    assert payload["chunk_count"] >= 1

    retriever = QdrantRetriever(path=settings.qdrant_path, collection_name=payload["collection_name"])
    try:
        hits = retriever.search("approval token payment", limit=3)
        assert hits
        assert any(hit.source_file == "knowledge.pdf" for hit in hits)
    finally:
        retriever.close()


def test_knowledge_upload_indexes_docx_chunks_and_returns_metrics(tmp_path: Path) -> None:
    client, settings = _make_client(tmp_path)
    docx_bytes = build_docx_bytes()

    response = client.post(
        "/knowledge/upload",
        data={"source_id": "payments-docx"},
        files={"file": ("knowledge.docx", docx_bytes, DOCX_CONTENT_TYPE)},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["collection_name"] == settings.qdrant_collection_name
    assert payload["source_id"] == "payments-docx"
    assert payload["filename"] == "knowledge.docx"
    assert payload["content_type"] == DOCX_CONTENT_TYPE
    assert payload["section_count"] == 2
    assert payload["sample_sections"] == ["Overview", "Rules"]
    assert payload["chunk_count"] >= 1

    retriever = QdrantRetriever(path=settings.qdrant_path, collection_name=payload["collection_name"])
    try:
        hits = retriever.search("approval token payment", limit=3)
        assert hits
        assert any(hit.source_file == "knowledge.docx" for hit in hits)
    finally:
        retriever.close()


def test_knowledge_upload_replaces_existing_source_chunks(tmp_path: Path) -> None:
    client, settings = _make_client(tmp_path)
    first_body = ("# Overview\n" + ("legacy settlement flow " * 20)).encode("utf-8")
    second_body = ("# Overview\n" + ("replacement payout ledger " * 10)).encode("utf-8")

    first_response = client.post(
        "/knowledge/upload",
        data={
            "source_id": "replace-me",
            "chunk_size": "220",
            "overlap_size": "40",
        },
        files={"file": ("replace.md", first_body, "text/markdown")},
    )
    assert first_response.status_code == 200

    second_response = client.post(
        "/knowledge/upload",
        data={
            "source_id": "replace-me",
            "chunk_size": "220",
            "overlap_size": "40",
        },
        files={"file": ("replace.md", second_body, "text/markdown")},
    )

    assert second_response.status_code == 200
    payload = second_response.json()
    assert payload["replaced_existing_chunks"] is True

    retriever = QdrantRetriever(path=settings.qdrant_path, collection_name=payload["collection_name"])
    try:
        assert retriever.count_source_chunks("replace-me") == payload["chunk_count"]
    finally:
        retriever.close()


def test_knowledge_upload_rejects_empty_documents(tmp_path: Path) -> None:
    client, _ = _make_client(tmp_path)

    response = client.post(
        "/knowledge/upload",
        files={"file": ("empty.md", b"   \n", "text/markdown")},
    )

    assert response.status_code == 400
    assert response.json()["message"] == "Uploaded document is empty."


def test_knowledge_upload_rejects_legacy_word_documents(tmp_path: Path) -> None:
    client, _ = _make_client(tmp_path)

    response = client.post(
        "/knowledge/upload",
        files={"file": ("knowledge.doc", b"legacy-binary", "application/msword")},
    )

    assert response.status_code == 400
    assert ".doc" in response.json()["message"]


def test_knowledge_upload_rejects_pdf_without_extractable_text(tmp_path: Path) -> None:
    client, _ = _make_client(tmp_path)

    response = client.post(
        "/knowledge/upload",
        files={"file": ("scan.pdf", build_pdf_bytes(""), PDF_CONTENT_TYPE)},
    )

    assert response.status_code == 400
    assert "does not support scanned documents or OCR" in response.json()["message"]


def test_knowledge_upload_defaults_to_token_aware_profile(tmp_path: Path) -> None:
    client, settings = _make_client(tmp_path)
    markdown = (
        "# Overview\n"
        "Payment orchestration validates invoice references before settlement.\n\n"
        "## Approval\n"
        + ("Every payment requires a signed approval token before execution. " * 12)
    ).encode("utf-8")

    response = client.post(
        "/knowledge/upload",
        data={"source_id": "token-aware-doc"},
        files={"file": ("semantic.md", markdown, "text/markdown")},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["collection_name"] == settings.qdrant_collection_name
    assert payload["chunk_size"] is None
    assert payload["overlap_size"] is None
    assert payload["index_profile"] == "semantic_token_v1"
    assert payload["embedding_model"] == "text-embedding-3-small"
    assert payload["embedding_dimensions"] == 1536
    assert payload["avg_chunk_tokens"] > 0
    assert payload["heading_aware"] is True
    assert payload["target_chunk_tokens"] == settings.rag_chunk_tokens
