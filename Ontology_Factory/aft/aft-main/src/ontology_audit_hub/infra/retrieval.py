from __future__ import annotations

import uuid
from pathlib import Path
from pathlib import Path as SysPath
from typing import Any, Protocol

from qdrant_client import QdrantClient
from qdrant_client.http import models as rest

from ontology_audit_hub.domain.audit.models import RetrievalHit
from ontology_audit_hub.domain.documents.models import DocumentChunk
from ontology_audit_hub.infra.embeddings import (
    SimpleHashEmbeddingAdapter,
    build_default_embedding_adapter,
)
from ontology_audit_hub.infra.settings import AuditHubSettings


class EmbeddingAdapter(Protocol):
    dimensions: int
    provider: str
    model_name: str

    def embed(self, text: str) -> list[float]:
        """Return an embedding for text."""

    def embed_query(self, text: str) -> list[float]:
        """Return a query embedding."""

    def embed_document(self, text: str) -> list[float]:
        """Return a document embedding."""

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        """Return document embeddings in order."""

    def count_tokens(self, text: str) -> int:
        """Return approximate token count."""


class RetrieverProtocol(Protocol):
    def upsert_chunks(self, chunks: list[DocumentChunk]) -> None:
        """Upsert document chunks into the retrieval backend."""

    def search(self, query: str, limit: int = 3) -> list[RetrievalHit]:
        """Return retrieval hits for a user query."""

    def check_ready(self) -> tuple[bool, str]:
        """Return a readiness probe result for the backend."""

    def backend_info(self) -> dict[str, Any]:
        """Return user-facing backend metadata."""

    def count_source_chunks(self, source_id: str) -> int:
        """Return the number of chunks currently stored for a source identifier."""

    def delete_source_chunks(self, source_id: str) -> int:
        """Delete all chunks associated with a source identifier and return the removed count."""

    def close(self) -> None:
        """Release backend resources when supported."""


class NullRetriever:
    def upsert_chunks(self, chunks: list[DocumentChunk]) -> None:
        return None

    def search(self, query: str, limit: int = 3) -> list[RetrievalHit]:
        return []

    def check_ready(self) -> tuple[bool, str]:
        return False, "Retrieval backend is disabled."

    def backend_info(self) -> dict[str, Any]:
        return {"backend": "null", "mode": "disabled"}

    def count_source_chunks(self, source_id: str) -> int:
        return 0

    def delete_source_chunks(self, source_id: str) -> int:
        return 0

    def close(self) -> None:
        return None


class QdrantRetriever:
    def __init__(
        self,
        embedding_adapter: EmbeddingAdapter | None = None,
        *,
        collection_name: str = "ontology_audit_chunks",
        mode: str = "embedded",
        path: str | Path = "artifacts/qdrant",
        url: str | None = None,
        api_key: str | None = None,
        timeout: float = 5.0,
        settings: AuditHubSettings | None = None,
    ) -> None:
        self.settings = settings or AuditHubSettings.from_env()
        self._explicit_embedding_adapter = embedding_adapter is not None
        self.embedding_adapter = embedding_adapter or build_default_embedding_adapter(self.settings)
        self.collection_name = collection_name
        self.mode = mode
        self.path = Path(path)
        self.url = url
        self.api_key = api_key
        self.timeout = timeout
        if self.mode == "server":
            if not self.url:
                raise ValueError("Qdrant server mode requires a qdrant_url.")
            self.client = QdrantClient(url=self.url, api_key=self.api_key, timeout=int(self.timeout))
        elif self.mode == "embedded":
            self.path.mkdir(parents=True, exist_ok=True)
            self.client = QdrantClient(path=str(self.path))
        else:
            raise ValueError(f"Unsupported Qdrant mode '{self.mode}'.")
        self._ensure_collection()

    def upsert_chunks(self, chunks: list[DocumentChunk]) -> None:
        if not chunks:
            return
        vectors = self.embedding_adapter.embed_documents([chunk.content for chunk in chunks])
        points: list[rest.PointStruct] = []
        for chunk, vector in zip(chunks, vectors, strict=True):
            point_id = _build_point_id(self.collection_name, chunk)
            source_id = chunk.source_id or chunk.source_file
            filename = chunk.filename or SysPath(chunk.source_file).name
            points.append(
                rest.PointStruct(
                    id=point_id,
                    vector=vector,
                    payload={
                        "chunk_id": point_id,
                        "source_file": chunk.source_file,
                        "source_id": source_id,
                        "filename": filename,
                        "content_type": chunk.content_type or "",
                        "section": chunk.section,
                        "content": chunk.content,
                        "heading_path": chunk.heading_path,
                        "section_ordinal": chunk.section_ordinal,
                        "chunk_ordinal": chunk.chunk_ordinal,
                        "ontology_tags": chunk.ontology_tags,
                        "version": chunk.version,
                        "status": chunk.status,
                        "chunk_index": chunk.chunk_index,
                        "content_length": chunk.content_length if chunk.content_length is not None else len(chunk.content),
                        "chunk_size": chunk.chunk_size,
                        "overlap_size": chunk.overlap_size,
                        "token_count": chunk.token_count or self.embedding_adapter.count_tokens(chunk.content),
                        "embedding_model": chunk.embedding_model or self.embedding_adapter.model_name,
                        "embedding_dimensions": chunk.embedding_dimensions or _vector_size(self.embedding_adapter),
                        "index_profile": chunk.index_profile or "semantic_token_v1",
                        "content_sha256": chunk.content_sha256 or "",
                    },
                )
            )
        self.client.upsert(collection_name=self.collection_name, points=points, wait=True)

    def search(self, query: str, limit: int = 3) -> list[RetrievalHit]:
        if not query.strip():
            return []
        response = self.client.query_points(
            collection_name=self.collection_name,
            query=self.embedding_adapter.embed_query(query),
            limit=limit,
            with_payload=True,
        )
        return [_build_retrieval_hit(result, self.collection_name, self.mode, self.url) for result in response.points]

    def check_ready(self) -> tuple[bool, str]:
        try:
            collections = self.client.get_collections().collections
            if any(collection.name == self.collection_name for collection in collections):
                return True, f"Qdrant collection '{self.collection_name}' is reachable."
            return True, f"Qdrant backend is reachable and will create '{self.collection_name}' on demand."
        except Exception as exc:
            return False, str(exc)

    def backend_info(self) -> dict[str, Any]:
        return {
            "backend": "qdrant",
            "mode": self.mode,
            "collection_name": self.collection_name,
            "path": str(self.path),
            "url": self.url,
            "timeout": self.timeout,
            "embedding_provider": getattr(self.embedding_adapter, "provider", "unknown"),
            "embedding_model": getattr(self.embedding_adapter, "model_name", "unknown"),
            "embedding_dimensions": _vector_size(self.embedding_adapter),
        }

    def count_source_chunks(self, source_id: str) -> int:
        if not source_id.strip():
            return 0
        result = self.client.count(
            collection_name=self.collection_name,
            count_filter=_source_filter(source_id),
            exact=True,
        )
        return int(result.count or 0)

    def delete_source_chunks(self, source_id: str) -> int:
        source_id = source_id.strip()
        if not source_id:
            return 0
        existing_count = self.count_source_chunks(source_id)
        if existing_count == 0:
            return 0
        self.client.delete(
            collection_name=self.collection_name,
            points_selector=rest.FilterSelector(filter=_source_filter(source_id)),
            wait=True,
        )
        return existing_count

    def close(self) -> None:
        close = getattr(self.client, "close", None)
        if callable(close):
            close()

    def _ensure_collection(self) -> None:
        existing = {collection.name for collection in self.client.get_collections().collections}
        expected_size = _vector_size(self.embedding_adapter)
        if self.collection_name in existing:
            collection = self.client.get_collection(self.collection_name)
            vectors = getattr(getattr(collection, "config", None), "params", None)
            existing_vectors = getattr(vectors, "vectors", None)
            if isinstance(existing_vectors, rest.VectorParams):
                existing_size = int(existing_vectors.size)
                if existing_size != expected_size:
                    if not self._explicit_embedding_adapter and existing_size == 32:
                        # Keep older local collections readable when the environment is upgraded to a
                        # higher-dimensional embedding model.
                        self.embedding_adapter = SimpleHashEmbeddingAdapter(dimensions=existing_size)
                        return
                    raise ValueError(
                        f"Existing Qdrant collection '{self.collection_name}' uses vector size {existing_size}, "
                        f"but the configured embedding model requires {expected_size}. "
                        "Create a new collection name or recreate the existing collection."
                    )
            return
        self.client.create_collection(
            collection_name=self.collection_name,
            vectors_config=rest.VectorParams(size=expected_size, distance=rest.Distance.COSINE),
        )


def _build_retrieval_hit(result: Any, collection_name: str, mode: str, url: str | None) -> RetrievalHit:
    payload = result.payload or {}
    score = float(result.score or 0.0)
    return RetrievalHit(
        chunk_id=str(payload.get("chunk_id", "")),
        source_file=str(payload.get("source_file", "")),
        section=str(payload.get("section", "")),
        content=str(payload.get("content", "")),
        source_id=str(payload.get("source_id", "")),
        heading_path=list(payload.get("heading_path", [])),
        ontology_tags=list(payload.get("ontology_tags", [])),
        version=str(payload.get("version", "unknown")),
        status=str(payload.get("status", "unknown")),
        score=score,
        dense_score=score,
        token_count=int(payload.get("token_count", 0) or 0),
        citation_id=str(payload.get("citation_id", "")),
        match_reason=_build_match_reason(payload, score),
        metadata={
            "collection": collection_name,
            "id": str(getattr(result, "id", "")),
            "mode": mode,
            "url": url or "",
            "filename": str(payload.get("filename", "")),
            "content_type": str(payload.get("content_type", "")),
            "section_ordinal": payload.get("section_ordinal"),
            "chunk_ordinal": payload.get("chunk_ordinal"),
            "index_profile": str(payload.get("index_profile", "")),
            "content_sha256": str(payload.get("content_sha256", "")),
        },
    )


def _build_match_reason(payload: dict[str, Any], score: float) -> str:
    section = str(payload.get("section", ""))
    tags = ",".join(payload.get("ontology_tags", []))
    heading_path = " > ".join(payload.get("heading_path", []))
    return f"section={section}; heading_path={heading_path or 'none'}; tags={tags or 'none'}; score={score:.3f}"


def _vector_size(embedding_adapter: EmbeddingAdapter) -> int:
    return int(getattr(embedding_adapter, "dimensions", 32))


def _build_point_id(collection_name: str, chunk: DocumentChunk) -> str:
    if chunk.source_id is not None and chunk.chunk_index is not None:
        seed = f"{collection_name}|{chunk.source_id}|{chunk.chunk_index}"
    else:
        seed = f"{chunk.source_file}|{chunk.section}|{chunk.content}"
    return str(uuid.uuid5(uuid.NAMESPACE_URL, seed))


def _source_filter(source_id: str) -> rest.Filter:
    return rest.Filter(
        must=[
            rest.FieldCondition(
                key="source_id",
                match=rest.MatchValue(value=source_id),
            )
        ]
    )
