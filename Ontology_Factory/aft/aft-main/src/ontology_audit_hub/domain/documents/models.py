from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator


class DocumentChunk(BaseModel):
    source_file: str
    section: str
    content: str
    ontology_tags: list[str] = Field(default_factory=list)
    version: str = "unknown"
    status: str = "unknown"
    source_id: str | None = None
    chunk_index: int | None = None
    content_length: int | None = None
    filename: str | None = None
    content_type: str | None = None
    chunk_size: int | None = None
    overlap_size: int | None = None
    heading_path: list[str] = Field(default_factory=list)
    section_ordinal: int | None = None
    chunk_ordinal: int | None = None
    token_count: int | None = None
    embedding_model: str | None = None
    embedding_dimensions: int | None = None
    index_profile: str | None = None
    content_sha256: str | None = None


class DocumentClaim(BaseModel):
    source_file: str
    section: str
    claim_type: str
    subject: str
    predicate: str
    object: str | list[str]
    evidence: str


class KnowledgeUploadConfig(BaseModel):
    collection_name: str | None = None
    source_id: str | None = None
    chunk_size: int | None = Field(default=None, ge=200)
    overlap_size: int | None = Field(default=None, ge=0)
    chunk_strategy: Literal["semantic_token_v1", "legacy_char_window"] | None = None
    target_chunk_tokens: int | None = Field(default=None, ge=100)
    chunk_overlap_tokens: int | None = Field(default=None, ge=0)
    max_chunk_tokens: int | None = Field(default=None, ge=100)
    language: str | None = None
    index_profile: str | None = None
    version: str = "uploaded"
    status: str = "active"

    @field_validator("collection_name", "source_id", "language", "index_profile", mode="before")
    @classmethod
    def _normalize_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = str(value).strip()
        return normalized or None

    @field_validator("version", "status")
    @classmethod
    def _ensure_non_empty_text(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Field must not be empty.")
        return normalized

    @model_validator(mode="after")
    def _resolve_chunking_strategy(self) -> KnowledgeUploadConfig:
        if self.chunk_strategy is None:
            if self.chunk_size is not None or self.overlap_size is not None:
                self.chunk_strategy = "legacy_char_window"
            else:
                self.chunk_strategy = "semantic_token_v1"

        if self.chunk_strategy == "legacy_char_window":
            if self.chunk_size is None:
                raise ValueError("chunk_size is required for legacy_char_window uploads.")
            if self.overlap_size is None:
                raise ValueError("overlap_size is required for legacy_char_window uploads.")
            if self.overlap_size >= self.chunk_size:
                raise ValueError("overlap_size must be smaller than chunk_size.")
            if self.index_profile is None:
                self.index_profile = "legacy_char_window"
            return self

        if self.target_chunk_tokens is None:
            raise ValueError("target_chunk_tokens is required for semantic_token_v1 uploads.")
        if self.chunk_overlap_tokens is None:
            raise ValueError("chunk_overlap_tokens is required for semantic_token_v1 uploads.")
        if self.max_chunk_tokens is None:
            raise ValueError("max_chunk_tokens is required for semantic_token_v1 uploads.")
        if self.chunk_overlap_tokens >= self.target_chunk_tokens:
            raise ValueError("chunk_overlap_tokens must be smaller than target_chunk_tokens.")
        if self.target_chunk_tokens > self.max_chunk_tokens:
            raise ValueError("target_chunk_tokens must be smaller than or equal to max_chunk_tokens.")
        if self.index_profile is None:
            self.index_profile = "semantic_token_v1"
        return self


class KnowledgeUploadResponse(BaseModel):
    collection_name: str
    source_id: str
    filename: str
    content_type: str
    chunk_size: int | None = None
    overlap_size: int | None = None
    target_chunk_tokens: int | None = None
    chunk_overlap_tokens: int | None = None
    max_chunk_tokens: int | None = None
    index_profile: str
    embedding_model: str
    embedding_dimensions: int
    avg_chunk_tokens: int
    heading_aware: bool
    section_count: int
    chunk_count: int
    total_characters: int
    replaced_existing_chunks: bool
    sample_sections: list[str] = Field(default_factory=list)
