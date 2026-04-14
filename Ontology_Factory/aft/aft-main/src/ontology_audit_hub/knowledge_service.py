from __future__ import annotations

from dataclasses import dataclass

from ontology_audit_hub.domain.documents.extractors import (
    DocumentExtractionError,
    extract_uploaded_document,
)
from ontology_audit_hub.domain.documents.models import KnowledgeUploadConfig, KnowledgeUploadResponse
from ontology_audit_hub.domain.documents.parser import chunk_uploaded_document
from ontology_audit_hub.infra.embeddings import build_default_embedding_adapter, normalize_embedding_model_name
from ontology_audit_hub.infra.lexical_index import SqliteLexicalIndex
from ontology_audit_hub.infra.retrieval import QdrantRetriever
from ontology_audit_hub.infra.settings import AuditHubSettings


@dataclass
class KnowledgeUploadError(Exception):
    status_code: int
    message: str


class KnowledgeUploadService:
    def __init__(self, *, settings: AuditHubSettings | None = None) -> None:
        self.settings = settings or AuditHubSettings.from_env()

    def default_upload_config(self) -> KnowledgeUploadConfig:
        return KnowledgeUploadConfig(
            chunk_strategy="semantic_token_v1",
            target_chunk_tokens=self.settings.rag_chunk_tokens,
            chunk_overlap_tokens=self.settings.rag_chunk_overlap_tokens,
            max_chunk_tokens=self.settings.rag_max_chunk_tokens,
            index_profile="semantic_token_v1",
        )

    def upload_document(
        self,
        *,
        filename: str,
        content: bytes,
        content_type: str | None,
        config: KnowledgeUploadConfig,
    ) -> KnowledgeUploadResponse:
        if not self.settings.qdrant_enabled:
            raise KnowledgeUploadError(503, "Qdrant upload is disabled by configuration.")

        if not filename.strip():
            raise KnowledgeUploadError(400, "Uploaded file must include a filename.")

        try:
            extracted = extract_uploaded_document(
                filename=filename,
                content=content,
                content_type=content_type,
            )
        except DocumentExtractionError as exc:
            raise KnowledgeUploadError(400, exc.message) from exc

        text = extracted.text
        detected_content_type = extracted.normalized_content_type
        source_id = config.source_id or extracted.filename
        collection_name = config.collection_name or self.settings.qdrant_collection_name
        embedding_adapter = build_default_embedding_adapter(self.settings)
        effective_config = self._merge_with_defaults(config)

        try:
            chunked_document = chunk_uploaded_document(
                filename=extracted.filename,
                text=text,
                content_type=detected_content_type,
                source_id=source_id,
                chunk_size=effective_config.chunk_size,
                overlap_size=effective_config.overlap_size,
                target_chunk_tokens=effective_config.target_chunk_tokens,
                chunk_overlap_tokens=effective_config.chunk_overlap_tokens,
                max_chunk_tokens=effective_config.max_chunk_tokens,
                index_profile=effective_config.index_profile or effective_config.chunk_strategy or "semantic_token_v1",
                embedding_model=normalize_embedding_model_name(self.settings.rag_embedding_model),
                embedding_dimensions=self.settings.rag_embedding_dimensions,
                version=effective_config.version,
                status=effective_config.status,
                embedding_adapter=embedding_adapter,
            )
        except RuntimeError as exc:
            raise KnowledgeUploadError(503, f"Failed to prepare chunk embeddings: {exc}") from exc

        if not chunked_document.chunks:
            raise KnowledgeUploadError(400, "Uploaded document did not produce any chunks.")

        try:
            retriever = self._build_retriever(collection_name, embedding_adapter)
        except Exception as exc:
            raise KnowledgeUploadError(503, f"Failed to initialize Qdrant upload backend: {exc}") from exc

        try:
            replaced_existing_chunks = retriever.delete_source_chunks(source_id) > 0
            retriever.upsert_chunks(chunked_document.chunks)
        except Exception as exc:
            raise KnowledgeUploadError(503, f"Failed to write knowledge document to Qdrant: {exc}") from exc
        finally:
            retriever.close()

        if self.settings.rag_hybrid_enabled:
            try:
                self._sync_lexical_index(
                    collection_name=collection_name,
                    source_id=source_id,
                    chunks=chunked_document.chunks,
                )
            except Exception as exc:
                raise KnowledgeUploadError(503, f"Failed to update lexical index: {exc}") from exc

        return KnowledgeUploadResponse(
            collection_name=collection_name,
            source_id=source_id,
            filename=extracted.filename,
            content_type=detected_content_type,
            chunk_size=effective_config.chunk_size,
            overlap_size=effective_config.overlap_size,
            target_chunk_tokens=effective_config.target_chunk_tokens,
            chunk_overlap_tokens=effective_config.chunk_overlap_tokens,
            max_chunk_tokens=effective_config.max_chunk_tokens,
            index_profile=chunked_document.index_profile,
            embedding_model=normalize_embedding_model_name(self.settings.rag_embedding_model),
            embedding_dimensions=self.settings.rag_embedding_dimensions,
            avg_chunk_tokens=chunked_document.avg_chunk_tokens,
            heading_aware=chunked_document.heading_aware,
            section_count=len(chunked_document.section_titles),
            chunk_count=len(chunked_document.chunks),
            total_characters=chunked_document.total_characters,
            replaced_existing_chunks=replaced_existing_chunks,
            sample_sections=chunked_document.section_titles[:5],
        )

    def close(self) -> None:
        return None

    def _build_retriever(self, collection_name: str, embedding_adapter) -> QdrantRetriever:
        return QdrantRetriever(
            collection_name=collection_name,
            mode=self.settings.qdrant_mode,
            path=self.settings.qdrant_path,
            url=self.settings.qdrant_url,
            api_key=self.settings.qdrant_api_key,
            timeout=self.settings.backend_timeout_seconds,
            settings=self.settings,
            embedding_adapter=embedding_adapter,
        )

    def _merge_with_defaults(self, config: KnowledgeUploadConfig) -> KnowledgeUploadConfig:
        defaults = self.default_upload_config()
        payload = config.model_dump(mode="python")
        if payload["chunk_strategy"] == "legacy_char_window":
            payload["chunk_size"] = payload["chunk_size"] or self.settings.qdrant_upload_chunk_size
            payload["overlap_size"] = payload["overlap_size"] if payload["overlap_size"] is not None else self.settings.qdrant_upload_overlap_size
        else:
            payload["target_chunk_tokens"] = payload["target_chunk_tokens"] or defaults.target_chunk_tokens
            payload["chunk_overlap_tokens"] = (
                payload["chunk_overlap_tokens"]
                if payload["chunk_overlap_tokens"] is not None
                else defaults.chunk_overlap_tokens
            )
            payload["max_chunk_tokens"] = payload["max_chunk_tokens"] or defaults.max_chunk_tokens
            payload["index_profile"] = payload["index_profile"] or defaults.index_profile
        return KnowledgeUploadConfig.model_validate(payload)

    def _sync_lexical_index(self, *, collection_name: str, source_id: str, chunks) -> None:
        lexical_index = SqliteLexicalIndex(self.settings.rag_lexical_db_path)
        try:
            lexical_index.delete_source_chunks(collection_name, source_id)
            lexical_index.upsert_chunks(collection_name, list(chunks))
        finally:
            lexical_index.close()
