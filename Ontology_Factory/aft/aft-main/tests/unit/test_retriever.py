from pathlib import Path
from types import SimpleNamespace

from ontology_audit_hub.domain.audit.models import ChatHistoryMessage, RAGOptions, RAGReference
from ontology_audit_hub.domain.documents.models import DocumentChunk
from ontology_audit_hub.infra import qa_sources, retrieval
from ontology_audit_hub.infra.embeddings import SimpleHashEmbeddingAdapter
from ontology_audit_hub.infra.lexical_index import LexicalSearchHit, SqliteLexicalIndex
from ontology_audit_hub.infra.qa_sources import QdrantReferenceReader
from ontology_audit_hub.infra.retrieval import QdrantRetriever
from ontology_audit_hub.infra.settings import AuditHubSettings


def test_qdrant_retriever_round_trip(tmp_path: Path) -> None:
    retriever = QdrantRetriever(path=tmp_path / "qdrant", embedding_adapter=SimpleHashEmbeddingAdapter())
    retriever.upsert_chunks(
        [
            DocumentChunk(
                source_file="docs/spec.md",
                section="Overview",
                content="Payment records include payment_id and amount.",
                ontology_tags=["Payment"],
                version="1.0",
                status="draft",
            )
        ]
    )

    hits = retriever.search("payment amount", limit=1)

    assert len(hits) == 1
    assert hits[0].source_file == "docs/spec.md"
    assert hits[0].section == "Overview"
    assert hits[0].ontology_tags == ["Payment"]


def test_qdrant_retriever_supports_server_mode(monkeypatch) -> None:
    captured: dict[str, object] = {}

    class FakeClient:
        def __init__(self, **kwargs) -> None:
            captured.update(kwargs)

        def get_collections(self):
            return SimpleNamespace(collections=[])

        def create_collection(self, **kwargs) -> None:
            captured["create_collection"] = kwargs

        def upsert(self, **kwargs) -> None:
            captured["upsert"] = kwargs

        def query_points(self, **kwargs):
            return SimpleNamespace(points=[])

    monkeypatch.setattr(retrieval, "QdrantClient", FakeClient)

    retriever = QdrantRetriever(
        mode="server",
        url="http://qdrant:6333",
        api_key="secret",
        timeout=2.5,
        collection_name="test_collection",
    )

    ready, detail = retriever.check_ready()

    assert captured["url"] == "http://qdrant:6333"
    assert captured["api_key"] == "secret"
    assert captured["timeout"] == 2
    assert captured["create_collection"]["collection_name"] == "test_collection"
    assert ready is True
    assert "reachable" in detail


def test_sqlite_lexical_index_round_trip(tmp_path: Path) -> None:
    lexical_index = SqliteLexicalIndex(tmp_path / "lexical.sqlite3")
    lexical_index.upsert_chunks(
        "knowledge",
        [
            DocumentChunk(
                source_file="docs/spec.md",
                source_id="payment-rules",
                chunk_index=0,
                filename="spec.md",
                content_type="text/markdown",
                section="Approval Rules",
                heading_path=["Billing", "Approval Rules"],
                content="PAY_401 requires invoice references and payment_id validation.",
                ontology_tags=["Payment", "PAY_401"],
                version="1.0",
                status="active",
            )
        ],
    )

    hits = lexical_index.search("knowledge", '"PAY_401" OR "payment_id"', limit=3)

    assert len(hits) == 1
    assert hits[0].source_file == "docs/spec.md"
    assert hits[0].section == "Approval Rules"
    assert hits[0].ontology_tags == ["Payment", "PAY_401"]


def test_qdrant_reference_reader_supports_query_rewrite_and_hybrid_recall(monkeypatch, tmp_path: Path) -> None:
    payload_a = {
        "chunk_id": "chunk-a",
        "source_file": "docs/payment.md",
        "source_id": "payment-rules",
        "filename": "payment.md",
        "content_type": "text/markdown",
        "section": "Rules",
        "content": "Payment approval requires invoice references.",
        "heading_path": ["Payment", "Rules"],
        "ontology_tags": ["Payment"],
        "version": "1.0",
        "status": "active",
        "token_count": 12,
        "index_profile": "semantic_token_v1",
    }
    payload_b = {
        "chunk_id": "chunk-b",
        "source_file": "docs/payment.md",
        "source_id": "payment-rules",
        "filename": "payment.md",
        "content_type": "text/markdown",
        "section": "Overview",
        "content": "Payments move through validation and settlement.",
        "heading_path": ["Payment", "Overview"],
        "ontology_tags": ["Payment"],
        "version": "1.0",
        "status": "active",
        "token_count": 10,
        "index_profile": "semantic_token_v1",
    }
    payload_c = {
        "chunk_id": "chunk-c",
        "source_file": "docs/approvals.md",
        "source_id": "approval-rules",
        "filename": "approvals.md",
        "content_type": "text/markdown",
        "section": "审批规则",
        "content": "Payment 审批规则要求 approval_token 和 invoice_id。",
        "heading_path": ["审批", "规则"],
        "ontology_tags": ["Payment", "Approval"],
        "version": "1.0",
        "status": "active",
        "token_count": 14,
        "index_profile": "semantic_token_v1",
    }

    class FakeClient:
        def __init__(self, **kwargs) -> None:
            self.kwargs = kwargs

        def query_points(self, **kwargs):
            return SimpleNamespace(
                points=[
                    SimpleNamespace(id="point-a", payload=payload_a, vector=[], score=0.92),
                    SimpleNamespace(id="point-b", payload=payload_b, vector=[], score=0.64),
                ]
            )

        def retrieve(self, **kwargs):
            return [SimpleNamespace(id="point-c", payload=payload_c, vector=[])]

        def close(self) -> None:
            return None

    class FakeLexicalIndex:
        def search(self, collection_name: str, query: str, *, limit: int):
            assert collection_name == "knowledge"
            assert "Payment" in query
            return [
                LexicalSearchHit(
                    chunk_id="chunk-a",
                    source_id="payment-rules",
                    source_file="docs/payment.md",
                    filename="payment.md",
                    content_type="text/markdown",
                    section="Rules",
                    content=payload_a["content"],
                    heading_path=["Payment", "Rules"],
                    ontology_tags=["Payment"],
                    version="1.0",
                    status="active",
                    token_count=12,
                    section_ordinal=None,
                    chunk_ordinal=None,
                    index_profile="semantic_token_v1",
                    content_sha256="",
                    score=0.1,
                ),
                LexicalSearchHit(
                    chunk_id="chunk-c",
                    source_id="approval-rules",
                    source_file="docs/approvals.md",
                    filename="approvals.md",
                    content_type="text/markdown",
                    section="审批规则",
                    content=payload_c["content"],
                    heading_path=["审批", "规则"],
                    ontology_tags=["Payment", "Approval"],
                    version="1.0",
                    status="active",
                    token_count=14,
                    section_ordinal=None,
                    chunk_ordinal=None,
                    index_profile="semantic_token_v1",
                    content_sha256="",
                    score=0.2,
                ),
            ][:limit]

        def close(self) -> None:
            return None

    class FakeLLM:
        def rewrite_query_for_retrieval(self, question: str, *, chat_history=None) -> str:
            assert question == "它的审批规则呢？"
            assert chat_history
            return "Payment approval rules"

    monkeypatch.setattr(qa_sources, "QdrantClient", FakeClient)

    reader = QdrantReferenceReader(
        settings=AuditHubSettings(
            qdrant_enabled=True,
            qdrant_url="http://qdrant:6333",
            rag_hybrid_enabled=True,
            rag_query_rewrite_enabled=True,
            rag_lexical_db_path=tmp_path / "lexical.sqlite3",
        ),
        llm_adapter=FakeLLM(),
        lexical_index=FakeLexicalIndex(),
    )

    result = reader.search(
        RAGReference(
            backend="qdrant",
            url="http://qdrant:6333",
            collection_name="knowledge",
            top_k=2,
        ),
        "它的审批规则呢？",
        history=[ChatHistoryMessage(role="user", content="我们刚才在聊 Payment。")],
    )

    assert result.search_mode == "hybrid_rrf_mmr"
    assert result.rewrite.applied is True
    assert result.rewrite.retrieval_query == "Payment approval rules"
    assert result.sparse_candidate_count == 2
    assert len(result.hits) == 2
    assert set(result.hits[0].metadata["retrieval_channels"]) >= {"dense", "sparse"}


def test_qdrant_reference_reader_filters_low_relevance_hits(monkeypatch) -> None:
    payload_low = {
        "chunk_id": "chunk-low",
        "source_file": "docs/low.md",
        "source_id": "low",
        "filename": "low.md",
        "content_type": "text/markdown",
        "section": "Low",
        "content": "This chunk is weakly related.",
        "heading_path": ["Low"],
        "ontology_tags": ["Low"],
        "version": "1.0",
        "status": "active",
        "token_count": 8,
        "index_profile": "semantic_token_v1",
    }
    payload_high = {
        "chunk_id": "chunk-high",
        "source_file": "docs/high.md",
        "source_id": "high",
        "filename": "high.md",
        "content_type": "text/markdown",
        "section": "High",
        "content": "GTA Benchmark evaluates real-world tool-use workflows.",
        "heading_path": ["High"],
        "ontology_tags": ["GTA"],
        "version": "1.0",
        "status": "active",
        "token_count": 10,
        "index_profile": "semantic_token_v1",
    }

    class FakeClient:
        def __init__(self, **kwargs) -> None:
            self.kwargs = kwargs

        def query_points(self, **kwargs):
            return SimpleNamespace(
                points=[
                    SimpleNamespace(id="point-low", payload=payload_low, vector=[], score=0.16),
                    SimpleNamespace(id="point-high", payload=payload_high, vector=[], score=0.62),
                ]
            )

        def close(self) -> None:
            return None

    monkeypatch.setattr(qa_sources, "QdrantClient", FakeClient)

    reader = QdrantReferenceReader(
        settings=AuditHubSettings(
            qdrant_enabled=True,
            qdrant_url="http://qdrant:6333",
            rag_min_relevance_score=0.3,
        ),
        llm_adapter=None,
    )

    result = reader.search(
        RAGReference(
            backend="qdrant",
            url="http://qdrant:6333",
            collection_name="knowledge",
            top_k=4,
        ),
        "Explain GTA Benchmark workflows.",
        RAGOptions(min_relevance_score=0.3),
        history=[],
    )

    assert len(result.hits) == 1
    assert result.hits[0].source_file == "docs/high.md"
    assert result.hits[0].score == 0.62
    assert result.hits[0].metadata["relevance_score"] == 0.62
    assert any("minimum relevance score 0.30" in warning for warning in result.warnings)
