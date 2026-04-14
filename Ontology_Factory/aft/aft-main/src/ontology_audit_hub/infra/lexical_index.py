from __future__ import annotations

import json
import sqlite3
import uuid
from dataclasses import dataclass
from pathlib import Path

from ontology_audit_hub.domain.documents.models import DocumentChunk


@dataclass(frozen=True)
class LexicalSearchHit:
    chunk_id: str
    source_id: str
    source_file: str
    filename: str
    content_type: str
    section: str
    content: str
    heading_path: list[str]
    ontology_tags: list[str]
    version: str
    status: str
    token_count: int
    section_ordinal: int | None
    chunk_ordinal: int | None
    index_profile: str
    content_sha256: str
    score: float


class SqliteLexicalIndex:
    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._ensure_schema()

    def upsert_chunks(self, collection_name: str, chunks: list[DocumentChunk]) -> None:
        if not chunks:
            return
        with self._connect() as connection:
            for chunk in chunks:
                chunk_id = _build_chunk_id(collection_name, chunk)
                source_id = chunk.source_id or chunk.source_file
                filename = chunk.filename or Path(chunk.source_file).name
                heading_path = list(chunk.heading_path)
                ontology_tags = list(chunk.ontology_tags)
                connection.execute("DELETE FROM lexical_chunks WHERE chunk_id = ?", (chunk_id,))
                connection.execute("DELETE FROM lexical_chunks_fts WHERE chunk_id = ?", (chunk_id,))
                connection.execute(
                    """
                    INSERT INTO lexical_chunks (
                        chunk_id,
                        collection_name,
                        source_id,
                        source_file,
                        filename,
                        content_type,
                        section,
                        content,
                        heading_path,
                        ontology_tags,
                        version,
                        status,
                        token_count,
                        section_ordinal,
                        chunk_ordinal,
                        index_profile,
                        content_sha256
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        chunk_id,
                        collection_name,
                        source_id,
                        chunk.source_file,
                        filename,
                        chunk.content_type or "",
                        chunk.section,
                        chunk.content,
                        json.dumps(heading_path, ensure_ascii=False),
                        json.dumps(ontology_tags, ensure_ascii=False),
                        chunk.version,
                        chunk.status,
                        int(chunk.token_count or 0),
                        chunk.section_ordinal,
                        chunk.chunk_ordinal,
                        chunk.index_profile or "",
                        chunk.content_sha256 or "",
                    ),
                )
                connection.execute(
                    """
                    INSERT INTO lexical_chunks_fts (
                        chunk_id,
                        collection_name,
                        source_id,
                        source_file,
                        filename,
                        section,
                        heading_path,
                        ontology_tags,
                        content
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        chunk_id,
                        collection_name,
                        source_id,
                        chunk.source_file,
                        filename,
                        chunk.section,
                        " ".join(heading_path),
                        " ".join(ontology_tags),
                        chunk.content,
                    ),
                )

    def delete_source_chunks(self, collection_name: str, source_id: str) -> int:
        normalized_source_id = source_id.strip()
        if not normalized_source_id:
            return 0
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT chunk_id FROM lexical_chunks WHERE collection_name = ? AND source_id = ?",
                (collection_name, normalized_source_id),
            ).fetchall()
            if not rows:
                return 0
            chunk_ids = [str(row[0]) for row in rows]
            connection.executemany("DELETE FROM lexical_chunks WHERE chunk_id = ?", [(chunk_id,) for chunk_id in chunk_ids])
            connection.executemany("DELETE FROM lexical_chunks_fts WHERE chunk_id = ?", [(chunk_id,) for chunk_id in chunk_ids])
            return len(chunk_ids)

    def delete_collection_chunks(self, collection_name: str) -> int:
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT chunk_id FROM lexical_chunks WHERE collection_name = ?",
                (collection_name,),
            ).fetchall()
            if not rows:
                return 0
            chunk_ids = [str(row[0]) for row in rows]
            connection.executemany("DELETE FROM lexical_chunks WHERE chunk_id = ?", [(chunk_id,) for chunk_id in chunk_ids])
            connection.executemany("DELETE FROM lexical_chunks_fts WHERE chunk_id = ?", [(chunk_id,) for chunk_id in chunk_ids])
            return len(chunk_ids)

    def search(self, collection_name: str, query: str, *, limit: int) -> list[LexicalSearchHit]:
        normalized_query = query.strip()
        if not normalized_query:
            return []
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT
                    chunks.chunk_id,
                    chunks.source_id,
                    chunks.source_file,
                    chunks.filename,
                    chunks.content_type,
                    chunks.section,
                    chunks.content,
                    chunks.heading_path,
                    chunks.ontology_tags,
                    chunks.version,
                    chunks.status,
                    chunks.token_count,
                    chunks.section_ordinal,
                    chunks.chunk_ordinal,
                    chunks.index_profile,
                    chunks.content_sha256,
                    bm25(lexical_chunks_fts, 8.0, 1.0, 1.0, 2.0, 3.0, 5.0, 5.0, 1.0) AS bm25_score
                FROM lexical_chunks_fts
                JOIN lexical_chunks AS chunks ON chunks.chunk_id = lexical_chunks_fts.chunk_id
                WHERE lexical_chunks_fts MATCH ? AND chunks.collection_name = ?
                ORDER BY bm25_score ASC
                LIMIT ?
                """,
                (normalized_query, collection_name, limit),
            ).fetchall()

        hits: list[LexicalSearchHit] = []
        for row in rows:
            hits.append(
                LexicalSearchHit(
                    chunk_id=str(row[0]),
                    source_id=str(row[1]),
                    source_file=str(row[2]),
                    filename=str(row[3]),
                    content_type=str(row[4]),
                    section=str(row[5]),
                    content=str(row[6]),
                    heading_path=_load_json_list(row[7]),
                    ontology_tags=_load_json_list(row[8]),
                    version=str(row[9]),
                    status=str(row[10]),
                    token_count=int(row[11] or 0),
                    section_ordinal=int(row[12]) if row[12] is not None else None,
                    chunk_ordinal=int(row[13]) if row[13] is not None else None,
                    index_profile=str(row[14]),
                    content_sha256=str(row[15]),
                    score=float(row[16]),
                )
            )
        return hits

    def close(self) -> None:
        return None

    def _ensure_schema(self) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS lexical_chunks (
                    chunk_id TEXT PRIMARY KEY,
                    collection_name TEXT NOT NULL,
                    source_id TEXT NOT NULL,
                    source_file TEXT NOT NULL,
                    filename TEXT NOT NULL,
                    content_type TEXT NOT NULL,
                    section TEXT NOT NULL,
                    content TEXT NOT NULL,
                    heading_path TEXT NOT NULL,
                    ontology_tags TEXT NOT NULL,
                    version TEXT NOT NULL,
                    status TEXT NOT NULL,
                    token_count INTEGER NOT NULL DEFAULT 0,
                    section_ordinal INTEGER,
                    chunk_ordinal INTEGER,
                    index_profile TEXT NOT NULL,
                    content_sha256 TEXT NOT NULL
                )
                """
            )
            connection.execute(
                """
                CREATE VIRTUAL TABLE IF NOT EXISTS lexical_chunks_fts USING fts5(
                    chunk_id UNINDEXED,
                    collection_name UNINDEXED,
                    source_id UNINDEXED,
                    source_file,
                    filename,
                    section,
                    heading_path,
                    ontology_tags,
                    content,
                    tokenize = 'unicode61'
                )
                """
            )
            connection.execute(
                "CREATE INDEX IF NOT EXISTS idx_lexical_chunks_collection_source ON lexical_chunks(collection_name, source_id)"
            )

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path)
        connection.row_factory = sqlite3.Row
        return connection


def _build_chunk_id(collection_name: str, chunk: DocumentChunk) -> str:
    if chunk.source_id is not None and chunk.chunk_index is not None:
        seed = f"{collection_name}|{chunk.source_id}|{chunk.chunk_index}"
    else:
        seed = f"{chunk.source_file}|{chunk.section}|{chunk.content}"
    return str(uuid.uuid5(uuid.NAMESPACE_URL, seed))


def _load_json_list(raw_value: object) -> list[str]:
    if raw_value is None:
        return []
    if isinstance(raw_value, str):
        try:
            loaded = json.loads(raw_value)
        except json.JSONDecodeError:
            return [raw_value] if raw_value else []
        if isinstance(loaded, list):
            return [str(item) for item in loaded]
    return []

