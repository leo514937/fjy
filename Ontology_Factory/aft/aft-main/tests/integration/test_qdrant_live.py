import os

import pytest

from ontology_audit_hub.domain.documents.models import DocumentChunk
from ontology_audit_hub.infra.retrieval import QdrantRetriever
from ontology_audit_hub.infra.settings import AuditHubSettings
from ontology_audit_hub.knowledge_service import KnowledgeUploadService


@pytest.mark.skipif(
    not os.getenv("ONTOLOGY_AUDIT_QDRANT_URL"),
    reason="Qdrant server integration environment variables are not configured.",
)
def test_live_qdrant_server_round_trip() -> None:
    retriever = QdrantRetriever(
        mode="server",
        url=os.environ["ONTOLOGY_AUDIT_QDRANT_URL"],
        api_key=os.getenv("ONTOLOGY_AUDIT_QDRANT_API_KEY"),
        collection_name="ontology_audit_live_test",
    )
    retriever.upsert_chunks(
        [
            DocumentChunk(
                source_file="docs/live.md",
                section="Overview",
                content="Payment records include payment_id and amount for live Qdrant tests.",
                ontology_tags=["Payment"],
                version="1.0",
                status="draft",
            )
        ]
    )

    hits = retriever.search("payment amount live", limit=1)

    assert hits
    assert hits[0].source_file == "docs/live.md"


@pytest.mark.skipif(
    not os.getenv("ONTOLOGY_AUDIT_QDRANT_URL"),
    reason="Qdrant server integration environment variables are not configured.",
)
def test_live_qdrant_upload_service_replaces_existing_source_chunks() -> None:
    source_id = "live-upload-doc"
    collection_name = "ontology_audit_live_test"
    settings = AuditHubSettings(
        qdrant_enabled=True,
        qdrant_mode="server",
        qdrant_url=os.environ["ONTOLOGY_AUDIT_QDRANT_URL"],
        qdrant_api_key=os.getenv("ONTOLOGY_AUDIT_QDRANT_API_KEY"),
        qdrant_collection_name=collection_name,
        neo4j_enabled=False,
        llm_enabled=False,
    )
    service = KnowledgeUploadService(settings=settings)
    retriever = QdrantRetriever(
        mode="server",
        url=os.environ["ONTOLOGY_AUDIT_QDRANT_URL"],
        api_key=os.getenv("ONTOLOGY_AUDIT_QDRANT_API_KEY"),
        collection_name=collection_name,
    )

    try:
        service.upload_document(
            filename="live-upload.md",
            content=("# Rules\n" + ("legacy-live-token-001 " * 20)).encode("utf-8"),
            content_type="text/markdown",
            config=service.default_upload_config().model_copy(
                update={
                    "source_id": source_id,
                    "collection_name": collection_name,
                    "chunk_size": 220,
                    "overlap_size": 40,
                }
            ),
        )
        second = service.upload_document(
            filename="live-upload.md",
            content=("# Rules\n" + ("replacement-live-token-002 " * 12)).encode("utf-8"),
            content_type="text/markdown",
            config=service.default_upload_config().model_copy(
                update={
                    "source_id": source_id,
                    "collection_name": collection_name,
                    "chunk_size": 220,
                    "overlap_size": 40,
                }
            ),
        )

        assert second.replaced_existing_chunks is True
        assert retriever.count_source_chunks(source_id) == second.chunk_count
        hits = retriever.search("replacement-live-token-002", limit=3)
        assert hits
        assert any(hit.source_file == "live-upload.md" for hit in hits)
    finally:
        retriever.delete_source_chunks(source_id)
        retriever.close()
