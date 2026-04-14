from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from ontology_audit_hub.domain.documents.models import DocumentChunk
from ontology_audit_hub.domain.ontology.models import OntologyModel


class TokenChunkingAdapter(Protocol):
    def count_tokens(self, text: str) -> int:
        """Return the approximate token count for text."""

    def encode_tokens(self, text: str) -> list[int]:
        """Encode text into token identifiers."""

    def decode_tokens(self, tokens: list[int]) -> str:
        """Decode token identifiers back into text."""


@dataclass(frozen=True)
class ChunkedKnowledgeDocument:
    chunks: list[DocumentChunk]
    section_titles: list[str]
    total_characters: int
    avg_chunk_tokens: int
    heading_aware: bool
    index_profile: str


@dataclass(frozen=True)
class StructuredSection:
    title: str
    heading_path: list[str]
    content: str
    ordinal: int


def chunk_markdown(path: str | Path, ontology: OntologyModel | None = None) -> list[DocumentChunk]:
    source_path = Path(path)
    text = source_path.read_text(encoding="utf-8")
    sections = split_text_sections(text)
    entity_names = [entity.name for entity in ontology.entities] if ontology else []
    chunks: list[DocumentChunk] = []
    for section, content in sections:
        lowered = content.lower()
        ontology_tags = [entity_name for entity_name in entity_names if entity_name.lower() in lowered]
        chunks.append(
            DocumentChunk(
                source_file=str(source_path),
                section=section,
                content=content,
                ontology_tags=ontology_tags,
            )
        )
    return chunks


def chunk_uploaded_document(
    *,
    filename: str,
    text: str,
    content_type: str,
    source_id: str,
    chunk_size: int | None = None,
    overlap_size: int | None = None,
    target_chunk_tokens: int | None = None,
    chunk_overlap_tokens: int | None = None,
    max_chunk_tokens: int | None = None,
    index_profile: str = "semantic_token_v1",
    embedding_model: str | None = None,
    embedding_dimensions: int | None = None,
    version: str = "uploaded",
    status: str = "active",
    ontology: OntologyModel | None = None,
    embedding_adapter: TokenChunkingAdapter | None = None,
) -> ChunkedKnowledgeDocument:
    normalized_text = normalize_text(text)
    sections = split_structured_sections(normalized_text)
    resolved_index_profile = index_profile
    if (
        resolved_index_profile == "semantic_token_v1"
        and chunk_size is not None
        and overlap_size is not None
        and target_chunk_tokens is None
        and chunk_overlap_tokens is None
        and max_chunk_tokens is None
    ):
        resolved_index_profile = "legacy_char_window"
    entity_names = [entity.name for entity in ontology.entities] if ontology else []
    chunks: list[DocumentChunk] = []
    chunk_index = 0

    for section in sections:
        lowered_section = section.content.lower()
        ontology_tags = [entity_name for entity_name in entity_names if entity_name.lower() in lowered_section]
        section_chunks: list[tuple[str, int]] = []
        if resolved_index_profile == "legacy_char_window":
            effective_chunk_size = chunk_size or len(section.content)
            effective_overlap_size = overlap_size or 0
            section_chunks = _chunk_section_by_characters(
                section.content,
                chunk_size=effective_chunk_size,
                overlap_size=effective_overlap_size,
                embedding_adapter=embedding_adapter,
            )
        else:
            if embedding_adapter is None:
                raise RuntimeError("semantic_token_v1 chunking requires an embedding adapter with token support.")
            section_chunks = _chunk_section_by_tokens(
                section.content,
                embedding_adapter=embedding_adapter,
                target_chunk_tokens=target_chunk_tokens or 400,
                chunk_overlap_tokens=chunk_overlap_tokens or 80,
                max_chunk_tokens=max_chunk_tokens or 600,
            )

        for chunk_ordinal, (chunk_content, token_count) in enumerate(section_chunks):
            if not chunk_content.strip():
                continue
            chunks.append(
                DocumentChunk(
                    source_file=filename,
                    section=section.title,
                    content=chunk_content,
                    ontology_tags=list(ontology_tags),
                    version=version,
                    status=status,
                    source_id=source_id,
                    chunk_index=chunk_index,
                    content_length=len(chunk_content),
                    filename=filename,
                    content_type=content_type,
                    chunk_size=chunk_size,
                    overlap_size=overlap_size,
                    heading_path=list(section.heading_path),
                    section_ordinal=section.ordinal,
                    chunk_ordinal=chunk_ordinal,
                    token_count=token_count,
                    embedding_model=embedding_model,
                    embedding_dimensions=embedding_dimensions,
                    index_profile=resolved_index_profile,
                    content_sha256=hashlib.sha256(chunk_content.encode("utf-8")).hexdigest(),
                )
            )
            chunk_index += 1

    avg_chunk_tokens = 0
    if chunks:
        avg_chunk_tokens = round(sum(chunk.token_count or 0 for chunk in chunks) / len(chunks))

    return ChunkedKnowledgeDocument(
        chunks=chunks,
        section_titles=[section.title for section in sections],
        total_characters=len(text),
        avg_chunk_tokens=avg_chunk_tokens,
        heading_aware=True,
        index_profile=resolved_index_profile,
    )


def split_text_sections(text: str) -> list[tuple[str, str]]:
    sections = split_structured_sections(normalize_text(text))
    return [(section.title, section.content) for section in sections]


def split_structured_sections(text: str) -> list[StructuredSection]:
    lines = text.splitlines()
    sections: list[StructuredSection] = []
    heading_stack: list[str] = []
    current_lines: list[str] = []
    current_title = "Overview"
    current_heading_path = ["Overview"]

    def flush_section() -> None:
        if not current_lines:
            return
        content = "\n".join(current_lines).strip()
        if not content:
            return
        sections.append(
            StructuredSection(
                title=current_title,
                heading_path=list(current_heading_path),
                content=content,
                ordinal=len(sections),
            )
        )

    for line in lines:
        stripped = line.strip()
        if stripped.startswith("#"):
            flush_section()
            current_lines = []
            level = len(stripped) - len(stripped.lstrip("#"))
            heading = stripped[level:].strip() or "Untitled"
            heading_stack[:] = heading_stack[: max(0, level - 1)]
            heading_stack.append(heading)
            current_title = heading
            current_heading_path = list(heading_stack)
            continue
        current_lines.append(line)

    flush_section()

    if sections:
        return sections

    normalized = text.strip()
    if not normalized:
        return []
    return [StructuredSection(title="Overview", heading_path=["Overview"], content=normalized, ordinal=0)]


def normalize_text(text: str) -> str:
    normalized = text.replace("\r\n", "\n").replace("\r", "\n").strip()
    normalized = re.sub(r"\n{3,}", "\n\n", normalized)
    return normalized


def _chunk_section_by_characters(
    content: str,
    *,
    chunk_size: int,
    overlap_size: int,
    embedding_adapter: TokenChunkingAdapter | None,
) -> list[tuple[str, int]]:
    if not content:
        return []
    step = max(1, chunk_size - overlap_size)
    chunks: list[tuple[str, int]] = []
    for start in range(0, len(content), step):
        end = min(start + chunk_size, len(content))
        chunk_content = content[start:end]
        if not chunk_content:
            continue
        token_count = embedding_adapter.count_tokens(chunk_content) if embedding_adapter else len(chunk_content)
        chunks.append((chunk_content, token_count))
        if end >= len(content):
            break
    return chunks


def _chunk_section_by_tokens(
    content: str,
    *,
    embedding_adapter: TokenChunkingAdapter,
    target_chunk_tokens: int,
    chunk_overlap_tokens: int,
    max_chunk_tokens: int,
) -> list[tuple[str, int]]:
    if not content.strip():
        return []
    blocks = _split_semantic_blocks(content)
    chunks: list[tuple[str, int]] = []
    current_tokens: list[int] = []
    current_blocks: list[str] = []

    def flush_current() -> None:
        nonlocal current_tokens, current_blocks
        if not current_blocks:
            return
        chunk_text = "\n\n".join(block for block in current_blocks if block.strip()).strip()
        if chunk_text:
            chunks.append((chunk_text, len(current_tokens)))
        overlap_tokens = current_tokens[-chunk_overlap_tokens:] if chunk_overlap_tokens else []
        overlap_text = embedding_adapter.decode_tokens(overlap_tokens).strip()
        current_blocks = [overlap_text] if overlap_text else []
        current_tokens = list(overlap_tokens)

    for block in blocks:
        block_text = block.strip()
        if not block_text:
            continue
        block_tokens = embedding_adapter.encode_tokens(block_text)
        if len(block_tokens) > max_chunk_tokens:
            flush_current()
            for window_tokens in _token_windows(block_tokens, max_chunk_tokens, chunk_overlap_tokens):
                window_text = embedding_adapter.decode_tokens(window_tokens).strip()
                if window_text:
                    chunks.append((window_text, len(window_tokens)))
            current_tokens = []
            current_blocks = []
            continue

        projected_tokens = len(current_tokens) + len(block_tokens)
        if current_blocks and projected_tokens > target_chunk_tokens:
            flush_current()

        current_blocks.append(block_text)
        current_tokens.extend(block_tokens)

        if len(current_tokens) >= max_chunk_tokens:
            flush_current()

    if current_blocks:
        chunk_text = "\n\n".join(block for block in current_blocks if block.strip()).strip()
        if chunk_text:
            chunks.append((chunk_text, len(current_tokens)))

    return chunks


def _split_semantic_blocks(content: str) -> list[str]:
    code_block_pattern = re.compile(r"```.*?```", re.DOTALL)
    blocks: list[str] = []
    cursor = 0
    for match in code_block_pattern.finditer(content):
        prefix = content[cursor : match.start()]
        blocks.extend(_split_paragraph_blocks(prefix))
        blocks.append(match.group(0).strip())
        cursor = match.end()
    blocks.extend(_split_paragraph_blocks(content[cursor:]))
    return [block for block in blocks if block.strip()]


def _split_paragraph_blocks(content: str) -> list[str]:
    pieces = re.split(r"\n\s*\n", content)
    blocks: list[str] = []
    for piece in pieces:
        normalized = piece.strip()
        if not normalized:
            continue
        if any(normalized.startswith(prefix) for prefix in ("- ", "* ", "+ ", "1. ", "2. ", "3. ")):
            blocks.extend([line.strip() for line in normalized.splitlines() if line.strip()])
            continue
        blocks.append(normalized)
    return blocks


def _token_windows(tokens: list[int], window_size: int, overlap_size: int) -> list[list[int]]:
    step = max(1, window_size - overlap_size)
    windows: list[list[int]] = []
    for start in range(0, len(tokens), step):
        window = tokens[start : start + window_size]
        if not window:
            continue
        windows.append(window)
        if start + window_size >= len(tokens):
            break
    return windows
