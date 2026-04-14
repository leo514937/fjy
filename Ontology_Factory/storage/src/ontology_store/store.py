from __future__ import annotations

import hashlib
import json
import re
import sqlite3
import time
from pathlib import Path
from typing import Any, Iterable
from xml.etree import ElementTree as ET

from ner.schema import NerDocument, NerEntity
from ontology_store.models import (
    CachedClassification,
    CanonicalEntity,
    CanonicalRelation,
    ChangeEvent,
    DocumentRecord,
    EntityClassification,
    GraphExportArtifacts,
    IngestionRun,
    OntologyVersion,
    WikiAgentStep,
    WikiLink,
    WikiPage,
    WikiPageSource,
    WikiRevision,
    WikiRun,
)


class OntologyStore:
    def __init__(self, database_path: str) -> None:
        self.database_path = Path(database_path)
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database_path)
        connection.row_factory = sqlite3.Row
        return connection

    def _initialize(self) -> None:
        with self._connect() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS ingestion_runs (
                    run_id TEXT PRIMARY KEY,
                    mode TEXT NOT NULL,
                    input_root TEXT NOT NULL,
                    preprocess_config TEXT NOT NULL DEFAULT '',
                    pipeline_config TEXT NOT NULL DEFAULT '',
                    force_reingest INTEGER NOT NULL DEFAULT 0,
                    status TEXT NOT NULL DEFAULT 'running',
                    documents_total INTEGER NOT NULL DEFAULT 0,
                    documents_processed INTEGER NOT NULL DEFAULT 0,
                    documents_skipped INTEGER NOT NULL DEFAULT 0,
                    manifest_json TEXT NOT NULL DEFAULT '{}',
                    started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    completed_at TEXT
                );

                CREATE TABLE IF NOT EXISTS documents (
                    document_id TEXT PRIMARY KEY,
                    source_path TEXT NOT NULL,
                    doc_name TEXT NOT NULL,
                    content_hash TEXT NOT NULL UNIQUE,
                    clean_text_path TEXT NOT NULL DEFAULT '',
                    first_run_id TEXT NOT NULL DEFAULT '',
                    last_run_id TEXT NOT NULL DEFAULT '',
                    report_json TEXT NOT NULL DEFAULT '{}',
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS entity_mentions (
                    mention_id TEXT PRIMARY KEY,
                    document_id TEXT NOT NULL,
                    doc_id TEXT NOT NULL,
                    canonical_entity_id TEXT NOT NULL DEFAULT '',
                    text TEXT NOT NULL,
                    normalized_text TEXT NOT NULL,
                    normalized_key TEXT NOT NULL,
                    ner_label TEXT NOT NULL,
                    start_offset INTEGER NOT NULL DEFAULT 0,
                    end_offset INTEGER NOT NULL DEFAULT 0,
                    confidence REAL,
                    source_sentence TEXT NOT NULL DEFAULT '',
                    metadata_json TEXT NOT NULL DEFAULT '{}',
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );

                CREATE INDEX IF NOT EXISTS idx_entity_mentions_document
                ON entity_mentions(document_id);

                CREATE INDEX IF NOT EXISTS idx_entity_mentions_canonical
                ON entity_mentions(canonical_entity_id);

                CREATE TABLE IF NOT EXISTS canonical_entities (
                    canonical_id TEXT PRIMARY KEY,
                    normalized_key TEXT NOT NULL UNIQUE,
                    normalized_text TEXT NOT NULL,
                    preferred_name TEXT NOT NULL,
                    ner_label TEXT NOT NULL,
                    mention_count INTEGER NOT NULL DEFAULT 0,
                    current_classification_id TEXT NOT NULL DEFAULT '',
                    evidence_summary TEXT NOT NULL DEFAULT '',
                    metadata_json TEXT NOT NULL DEFAULT '{}',
                    created_in_run_id TEXT NOT NULL DEFAULT '',
                    last_seen_run_id TEXT NOT NULL DEFAULT '',
                    last_version_id TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS entity_aliases (
                    canonical_id TEXT NOT NULL,
                    alias_text TEXT NOT NULL,
                    alias_normalized_text TEXT NOT NULL,
                    ner_label TEXT NOT NULL,
                    source TEXT NOT NULL DEFAULT 'system',
                    confidence REAL NOT NULL DEFAULT 1.0,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (canonical_id, alias_normalized_text, ner_label)
                );

                CREATE INDEX IF NOT EXISTS idx_entity_alias_lookup
                ON entity_aliases(alias_normalized_text, ner_label);

                CREATE TABLE IF NOT EXISTS entity_classifications (
                    classification_id TEXT PRIMARY KEY,
                    canonical_id TEXT NOT NULL,
                    ontology_label TEXT NOT NULL,
                    confidence REAL NOT NULL DEFAULT 0.0,
                    evidence_signature TEXT NOT NULL DEFAULT '',
                    result_json TEXT NOT NULL DEFAULT '{}',
                    source_run_id TEXT NOT NULL DEFAULT '',
                    source_reason TEXT NOT NULL DEFAULT '',
                    is_current INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );

                CREATE INDEX IF NOT EXISTS idx_entity_classifications_current
                ON entity_classifications(canonical_id, is_current);

                CREATE TABLE IF NOT EXISTS canonical_relations (
                    canonical_relation_id TEXT PRIMARY KEY,
                    relation_key TEXT NOT NULL UNIQUE,
                    source_canonical_id TEXT NOT NULL,
                    target_canonical_id TEXT NOT NULL,
                    relation_type TEXT NOT NULL,
                    confidence REAL NOT NULL DEFAULT 0.0,
                    mention_count INTEGER NOT NULL DEFAULT 0,
                    evidence_json TEXT NOT NULL DEFAULT '[]',
                    metadata_json TEXT NOT NULL DEFAULT '{}',
                    first_run_id TEXT NOT NULL DEFAULT '',
                    last_run_id TEXT NOT NULL DEFAULT '',
                    last_version_id TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );

                CREATE INDEX IF NOT EXISTS idx_canonical_relations_lookup
                ON canonical_relations(source_canonical_id, target_canonical_id, relation_type);

                CREATE TABLE IF NOT EXISTS relation_mentions (
                    doc_id TEXT NOT NULL,
                    relation_id TEXT NOT NULL,
                    relation_cache_key TEXT NOT NULL DEFAULT '',
                    source_entity_id TEXT NOT NULL,
                    target_entity_id TEXT NOT NULL,
                    evidence_sentence TEXT NOT NULL DEFAULT '',
                    metadata_json TEXT NOT NULL DEFAULT '{}',
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (doc_id, relation_id)
                );

                CREATE TABLE IF NOT EXISTS ontology_versions (
                    version_id TEXT PRIMARY KEY,
                    run_id TEXT NOT NULL,
                    parent_version_id TEXT NOT NULL DEFAULT '',
                    version_number INTEGER NOT NULL,
                    is_active INTEGER NOT NULL DEFAULT 1,
                    processed_documents INTEGER NOT NULL DEFAULT 0,
                    changed_entities INTEGER NOT NULL DEFAULT 0,
                    changed_relations INTEGER NOT NULL DEFAULT 0,
                    manifest_json TEXT NOT NULL DEFAULT '{}',
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS change_events (
                    event_id TEXT PRIMARY KEY,
                    version_id TEXT NOT NULL DEFAULT '',
                    run_id TEXT NOT NULL,
                    object_type TEXT NOT NULL,
                    object_id TEXT NOT NULL,
                    event_type TEXT NOT NULL,
                    reason TEXT NOT NULL DEFAULT '',
                    payload_json TEXT NOT NULL DEFAULT '{}',
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );

                CREATE INDEX IF NOT EXISTS idx_change_events_version
                ON change_events(version_id);

                CREATE TABLE IF NOT EXISTS wiki_runs (
                    run_id TEXT PRIMARY KEY,
                    mode TEXT NOT NULL,
                    input_root TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'running',
                    manifest_json TEXT NOT NULL DEFAULT '{}',
                    started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    completed_at TEXT
                );

                CREATE TABLE IF NOT EXISTS wiki_pages (
                    page_id TEXT PRIMARY KEY,
                    slug TEXT NOT NULL UNIQUE,
                    title TEXT NOT NULL,
                    page_type TEXT NOT NULL,
                    layer TEXT NOT NULL DEFAULT 'domain',
                    doc_ref TEXT NOT NULL DEFAULT '',
                    file_path TEXT NOT NULL DEFAULT '',
                    status TEXT NOT NULL DEFAULT 'active',
                    current_revision_id TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );

                CREATE INDEX IF NOT EXISTS idx_wiki_pages_title
                ON wiki_pages(title);

                CREATE TABLE IF NOT EXISTS wiki_revisions (
                    revision_id TEXT PRIMARY KEY,
                    page_id TEXT NOT NULL,
                    run_id TEXT NOT NULL,
                    content_markdown TEXT NOT NULL,
                    summary TEXT NOT NULL DEFAULT '',
                    reason TEXT NOT NULL DEFAULT '',
                    created_by TEXT NOT NULL DEFAULT 'wiki_agent',
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );

                CREATE INDEX IF NOT EXISTS idx_wiki_revisions_page
                ON wiki_revisions(page_id, created_at DESC);

                CREATE TABLE IF NOT EXISTS wiki_links (
                    source_page_id TEXT NOT NULL,
                    target_page_id TEXT NOT NULL,
                    link_type TEXT NOT NULL DEFAULT 'related_to',
                    anchor_text TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (source_page_id, target_page_id, link_type)
                );

                CREATE TABLE IF NOT EXISTS wiki_page_sources (
                    source_id TEXT PRIMARY KEY,
                    page_id TEXT NOT NULL,
                    document_id TEXT NOT NULL,
                    source_sentence TEXT NOT NULL DEFAULT '',
                    evidence_text TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );

                CREATE INDEX IF NOT EXISTS idx_wiki_page_sources_page
                ON wiki_page_sources(page_id);

                CREATE TABLE IF NOT EXISTS wiki_agent_steps (
                    step_id TEXT PRIMARY KEY,
                    run_id TEXT NOT NULL,
                    page_id TEXT NOT NULL DEFAULT '',
                    thought TEXT NOT NULL DEFAULT '',
                    action_name TEXT NOT NULL,
                    action_input_json TEXT NOT NULL DEFAULT '{}',
                    observation_json TEXT NOT NULL DEFAULT '{}',
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );

                CREATE INDEX IF NOT EXISTS idx_wiki_agent_steps_run
                ON wiki_agent_steps(run_id, created_at ASC);
                """
            )
            self._ensure_columns(
                connection,
                "relation_mentions",
                {
                    "document_id": "TEXT NOT NULL DEFAULT ''",
                    "source_canonical_id": "TEXT NOT NULL DEFAULT ''",
                    "target_canonical_id": "TEXT NOT NULL DEFAULT ''",
                    "canonical_relation_id": "TEXT NOT NULL DEFAULT ''",
                    "relation_type": "TEXT NOT NULL DEFAULT ''",
                    "confidence": "REAL NOT NULL DEFAULT 0.0",
                },
            )
            self._ensure_columns(
                connection,
                "documents",
                {
                    "source_path": "TEXT NOT NULL DEFAULT ''",
                    "doc_name": "TEXT NOT NULL DEFAULT ''",
                    "content_hash": "TEXT NOT NULL DEFAULT ''",
                    "clean_text_path": "TEXT NOT NULL DEFAULT ''",
                    "first_run_id": "TEXT NOT NULL DEFAULT ''",
                    "last_run_id": "TEXT NOT NULL DEFAULT ''",
                    "report_json": "TEXT NOT NULL DEFAULT '{}'",
                },
            )
            self._ensure_columns(
                connection,
                "wiki_pages",
                {
                    "layer": "TEXT NOT NULL DEFAULT 'domain'",
                    "doc_ref": "TEXT NOT NULL DEFAULT ''",
                    "file_path": "TEXT NOT NULL DEFAULT ''",
                },
            )
        self._migrate_legacy_data()

    def _ensure_columns(self, connection: sqlite3.Connection, table_name: str, columns: dict[str, str]) -> None:
        existing = {str(row["name"]) for row in connection.execute(f"PRAGMA table_info({table_name})").fetchall()}
        for column_name, column_sql in columns.items():
            if column_name in existing:
                continue
            connection.execute(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {column_sql}")

    def _migrate_legacy_data(self) -> None:
        with self._connect() as connection:
            self._migrate_legacy_entities(connection)
            self._migrate_legacy_classifications(connection)
            self._migrate_legacy_relations(connection)

    def _migrate_legacy_entities(self, connection: sqlite3.Connection) -> None:
        if not self._table_exists(connection, "extracted_entities"):
            return
        rows = connection.execute(
            """
            SELECT doc_id, entity_id, normalized_text, ner_label, source_sentence, metadata_json
            FROM extracted_entities
            """
        ).fetchall()
        for row in rows:
            doc_id = str(row["doc_id"])
            document_id = build_document_id(f"legacy://{doc_id}", f"legacy:{doc_id}")
            connection.execute(
                """
                INSERT OR IGNORE INTO documents (
                    document_id, source_path, doc_name, content_hash, clean_text_path, first_run_id, last_run_id, report_json
                ) VALUES (?, ?, ?, ?, '', 'legacy-migration', 'legacy-migration', '{}')
                """,
                (document_id, f"legacy://{doc_id}", doc_id, f"legacy:{doc_id}"),
            )
            normalized_text = str(row["normalized_text"])
            ner_label = str(row["ner_label"])
            connection.execute(
                """
                INSERT OR IGNORE INTO entity_mentions (
                    mention_id, document_id, doc_id, text, normalized_text, normalized_key, ner_label,
                    source_sentence, metadata_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    str(row["entity_id"]),
                    document_id,
                    doc_id,
                    normalized_text,
                    normalized_text,
                    build_normalized_key(normalized_text, ner_label),
                    ner_label,
                    str(row["source_sentence"] or ""),
                    str(row["metadata_json"] or "{}"),
                ),
            )

    def _migrate_legacy_classifications(self, connection: sqlite3.Connection) -> None:
        if not self._table_exists(connection, "classified_entities"):
            return
        rows = connection.execute(
            """
            SELECT cache_key, normalized_text, ner_label, ontology_label, confidence, result_json, first_doc_id
            FROM classified_entities
            """
        ).fetchall()
        for row in rows:
            normalized_text = str(row["normalized_text"])
            ner_label = str(row["ner_label"])
            normalized_key = build_normalized_key(normalized_text, ner_label)
            canonical_id = build_canonical_entity_id(normalized_key)
            connection.execute(
                """
                INSERT OR IGNORE INTO canonical_entities (
                    canonical_id, normalized_key, normalized_text, preferred_name, ner_label,
                    mention_count, current_classification_id, evidence_summary, metadata_json,
                    created_in_run_id, last_seen_run_id, last_version_id
                ) VALUES (?, ?, ?, ?, ?, 0, '', '', '{}', 'legacy-migration', 'legacy-migration', '')
                """,
                (canonical_id, normalized_key, normalized_text, normalized_text, ner_label),
            )
            connection.execute(
                """
                INSERT OR IGNORE INTO entity_aliases (
                    canonical_id, alias_text, alias_normalized_text, ner_label, source, confidence
                ) VALUES (?, ?, ?, ?, 'legacy-migration', 1.0)
                """,
                (canonical_id, normalized_text, normalize_alias(normalized_text), ner_label),
            )
            classification_id = build_classification_id(canonical_id, f"legacy::{row['cache_key']}")
            connection.execute(
                """
                INSERT OR IGNORE INTO entity_classifications (
                    classification_id, canonical_id, ontology_label, confidence, evidence_signature,
                    result_json, source_run_id, source_reason, is_current
                ) VALUES (?, ?, ?, ?, ?, ?, 'legacy-migration', 'legacy-cache', 1)
                """,
                (
                    classification_id,
                    canonical_id,
                    str(row["ontology_label"]),
                    float(row["confidence"] or 0.0),
                    f"legacy::{row['cache_key']}",
                    str(row["result_json"] or "{}"),
                ),
            )
            connection.execute(
                """
                UPDATE canonical_entities
                SET current_classification_id = COALESCE(NULLIF(current_classification_id, ''), ?)
                WHERE canonical_id = ?
                """,
                (classification_id, canonical_id),
            )
            first_doc_id = str(row["first_doc_id"] or "")
            if first_doc_id:
                connection.execute(
                    """
                    UPDATE canonical_entities
                    SET evidence_summary = CASE
                        WHEN evidence_summary = '' THEN ?
                        ELSE evidence_summary
                    END
                    WHERE canonical_id = ?
                    """,
                    (f"legacy-source:{first_doc_id}", canonical_id),
                )

    def _migrate_legacy_relations(self, connection: sqlite3.Connection) -> None:
        if not self._table_exists(connection, "relation_catalog"):
            return
        rows = connection.execute(
            """
            SELECT relation_cache_key, source_cache_key, target_cache_key, relation_type, confidence,
                   evidence_sentence, metadata_json, first_doc_id, last_doc_id, mention_count
            FROM relation_catalog
            """
        ).fetchall()
        for row in rows:
            source_canonical = self._canonical_id_for_normalized_key(connection, str(row["source_cache_key"]))
            target_canonical = self._canonical_id_for_normalized_key(connection, str(row["target_cache_key"]))
            if not source_canonical or not target_canonical:
                continue
            relation_key = build_canonical_relation_key(
                source_canonical,
                target_canonical,
                str(row["relation_type"]),
            )
            relation_id = build_canonical_relation_id(relation_key)
            evidence_json = json.dumps([str(row["evidence_sentence"] or "")], ensure_ascii=False)
            connection.execute(
                """
                INSERT OR IGNORE INTO canonical_relations (
                    canonical_relation_id, relation_key, source_canonical_id, target_canonical_id, relation_type,
                    confidence, mention_count, evidence_json, metadata_json,
                    first_run_id, last_run_id, last_version_id
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'legacy-migration', 'legacy-migration', '')
                """,
                (
                    relation_id,
                    relation_key,
                    source_canonical,
                    target_canonical,
                    str(row["relation_type"]),
                    float(row["confidence"] or 0.0),
                    int(row["mention_count"] or 0),
                    evidence_json,
                    str(row["metadata_json"] or "{}"),
                ),
            )

    def _table_exists(self, connection: sqlite3.Connection, table_name: str) -> bool:
        row = connection.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
            (table_name,),
        ).fetchone()
        return row is not None

    def _canonical_id_for_normalized_key(self, connection: sqlite3.Connection, normalized_key: str) -> str:
        row = connection.execute(
            "SELECT canonical_id FROM canonical_entities WHERE normalized_key = ?",
            (normalized_key,),
        ).fetchone()
        return str(row["canonical_id"]) if row is not None else ""

    def ingest_document_run(
        self,
        *,
        mode: str,
        input_root: str,
        preprocess_config: str = "",
        pipeline_config: str = "",
        force_reingest: bool = False,
        manifest: dict[str, Any] | None = None,
    ) -> IngestionRun:
        run_id = build_run_id(mode=mode, input_root=input_root)
        payload = manifest or {}
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO ingestion_runs (
                    run_id, mode, input_root, preprocess_config, pipeline_config, force_reingest, manifest_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    run_id,
                    mode,
                    input_root,
                    preprocess_config,
                    pipeline_config,
                    1 if force_reingest else 0,
                    json.dumps(payload, ensure_ascii=False),
                ),
            )
        return IngestionRun(
            run_id=run_id,
            mode=mode,
            input_root=input_root,
            preprocess_config=preprocess_config,
            pipeline_config=pipeline_config,
            force_reingest=force_reingest,
            manifest=payload,
        )

    def complete_ingestion_run(
        self,
        *,
        run_id: str,
        status: str,
        documents_total: int,
        documents_processed: int,
        documents_skipped: int,
        manifest: dict[str, Any],
    ) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                UPDATE ingestion_runs
                SET status = ?,
                    documents_total = ?,
                    documents_processed = ?,
                    documents_skipped = ?,
                    manifest_json = ?,
                    completed_at = CURRENT_TIMESTAMP
                WHERE run_id = ?
                """,
                (
                    status,
                    documents_total,
                    documents_processed,
                    documents_skipped,
                    json.dumps(manifest, ensure_ascii=False),
                    run_id,
                ),
            )

    def start_wiki_run(
        self,
        *,
        mode: str,
        input_root: str,
        manifest: dict[str, Any] | None = None,
    ) -> WikiRun:
        run_id = build_run_id(mode=f"wiki-{mode}", input_root=input_root)
        payload = manifest or {}
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO wiki_runs (run_id, mode, input_root, status, manifest_json)
                VALUES (?, ?, ?, 'running', ?)
                """,
                (run_id, mode, input_root, json.dumps(payload, ensure_ascii=False)),
            )
        return WikiRun(run_id=run_id, mode=mode, input_root=input_root, status="running", manifest=payload)

    def complete_wiki_run(self, *, run_id: str, status: str, manifest: dict[str, Any]) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                UPDATE wiki_runs
                SET status = ?, manifest_json = ?, completed_at = CURRENT_TIMESTAMP
                WHERE run_id = ?
                """,
                (status, json.dumps(manifest, ensure_ascii=False), run_id),
            )

    def list_pages(self) -> list[WikiPage]:
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT page_id, slug, title, page_type, layer, doc_ref, file_path, status, current_revision_id
                FROM wiki_pages
                ORDER BY updated_at DESC, title ASC
                """
            ).fetchall()
        return [self._row_to_wiki_page(row) for row in rows]

    def search_pages(self, query: str, *, limit: int = 5) -> list[WikiPage]:
        normalized = build_wiki_slug(query)
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT DISTINCT wp.page_id, wp.slug, wp.title, wp.page_type, wp.layer, wp.doc_ref, wp.file_path, wp.status, wp.current_revision_id
                FROM wiki_pages wp
                LEFT JOIN wiki_revisions wr ON wr.revision_id = wp.current_revision_id
                WHERE wp.slug LIKE ?
                   OR wp.title LIKE ?
                   OR wr.content_markdown LIKE ?
                ORDER BY wp.updated_at DESC, wp.title ASC
                LIMIT ?
                """,
                (f"%{normalized}%", f"%{query.strip()}%", f"%{query.strip()}%", limit * 4),
            ).fetchall()
        candidates = [self._row_to_wiki_page(row) for row in rows]
        scored = sorted(
            candidates,
            key=lambda item: max(
                _text_similarity(normalized, build_wiki_slug(item.slug)),
                _text_similarity(query.strip().lower(), item.title.strip().lower()),
            ),
            reverse=True,
        )
        return scored[:limit]

    def get_page(self, page_id: str) -> WikiPage | None:
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT page_id, slug, title, page_type, layer, doc_ref, file_path, status, current_revision_id
                FROM wiki_pages
                WHERE page_id = ?
                """,
                (page_id,),
            ).fetchone()
        if row is None:
            return None
        return self._row_to_wiki_page(row)

    def get_page_by_slug(self, slug: str) -> WikiPage | None:
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT page_id, slug, title, page_type, layer, doc_ref, file_path, status, current_revision_id
                FROM wiki_pages
                WHERE slug = ?
                """,
                (slug,),
            ).fetchone()
        if row is None:
            return None
        return self._row_to_wiki_page(row)

    def find_page_by_title(self, title: str, *, threshold: float = 0.85) -> WikiPage | None:
        title = title.strip()
        slug = build_wiki_slug(title)
        direct = self.get_page_by_slug(slug)
        if direct is not None:
            return direct
        candidates = self.search_pages(title, limit=10)
        for page in candidates:
            if _text_similarity(title.lower(), page.title.lower()) >= threshold:
                return page
        return None

    def read_page(self, page_id: str) -> dict[str, Any] | None:
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT wp.page_id, wp.slug, wp.title, wp.page_type, wp.layer, wp.doc_ref, wp.file_path, wp.status, wp.current_revision_id,
                       wr.content_markdown, wr.summary, wr.reason, wr.created_by, wr.run_id
                FROM wiki_pages wp
                LEFT JOIN wiki_revisions wr ON wr.revision_id = wp.current_revision_id
                WHERE wp.page_id = ?
                """,
                (page_id,),
            ).fetchone()
        if row is None:
            return None
        return {
            "page": self._row_to_wiki_page(row).model_dump(mode="json"),
            "current_revision": {
                "revision_id": str(row["current_revision_id"] or ""),
                "content_markdown": str(row["content_markdown"] or ""),
                "summary": str(row["summary"] or ""),
                "reason": str(row["reason"] or ""),
                "created_by": str(row["created_by"] or ""),
                "run_id": str(row["run_id"] or ""),
            },
            "sources": [source.model_dump(mode="json") for source in self.list_page_sources(str(row["page_id"]))],
            "related_pages": self.list_related_pages(str(row["page_id"])),
        }

    def create_page(
        self,
        *,
        title: str,
        slug: str,
        page_type: str,
        layer: str = "domain",
        doc_ref: str = "",
        file_path: str = "",
        status: str = "active",
    ) -> WikiPage:
        page_id = build_wiki_page_id(slug)
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO wiki_pages (page_id, slug, title, page_type, layer, doc_ref, file_path, status, current_revision_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, '')
                ON CONFLICT(slug) DO UPDATE SET
                    title = excluded.title,
                    page_type = excluded.page_type,
                    layer = excluded.layer,
                    doc_ref = CASE WHEN excluded.doc_ref != '' THEN excluded.doc_ref ELSE wiki_pages.doc_ref END,
                    file_path = CASE WHEN excluded.file_path != '' THEN excluded.file_path ELSE wiki_pages.file_path END,
                    status = excluded.status,
                    updated_at = CURRENT_TIMESTAMP
                """,
                (page_id, slug, title, page_type, layer, doc_ref, file_path, status),
            )
            row = connection.execute(
                """
                SELECT page_id, slug, title, page_type, layer, doc_ref, file_path, status, current_revision_id
                FROM wiki_pages
                WHERE slug = ?
                """,
                (slug,),
            ).fetchone()
        if row is None:
            raise RuntimeError("failed to create wiki page")
        return self._row_to_wiki_page(row)

    def sync_page_location(self, *, page_id: str, layer: str, doc_ref: str, file_path: str) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                UPDATE wiki_pages
                SET layer = ?, doc_ref = ?, file_path = ?, updated_at = CURRENT_TIMESTAMP
                WHERE page_id = ?
                """,
                (layer, doc_ref, file_path, page_id),
            )

    def create_revision(
        self,
        *,
        page_id: str,
        run_id: str,
        content_markdown: str,
        summary: str = "",
        reason: str = "",
        created_by: str = "wiki_agent",
    ) -> WikiRevision:
        revision_id = build_wiki_revision_id(page_id=page_id, run_id=run_id, content_markdown=content_markdown)
        with self._connect() as connection:
            connection.execute(
                """
                INSERT OR REPLACE INTO wiki_revisions (
                    revision_id, page_id, run_id, content_markdown, summary, reason, created_by
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (revision_id, page_id, run_id, content_markdown, summary, reason, created_by),
            )
            connection.execute(
                """
                UPDATE wiki_pages
                SET current_revision_id = ?, updated_at = CURRENT_TIMESTAMP
                WHERE page_id = ?
                """,
                (revision_id, page_id),
            )
            row = connection.execute(
                """
                SELECT revision_id, page_id, run_id, content_markdown, summary, reason, created_by
                FROM wiki_revisions
                WHERE revision_id = ?
                """,
                (revision_id,),
            ).fetchone()
        if row is None:
            raise RuntimeError("failed to create wiki revision")
        return self._row_to_wiki_revision(row)

    def update_page(
        self,
        *,
        page_id: str,
        run_id: str,
        content_markdown: str,
        summary: str = "",
        reason: str = "",
        created_by: str = "wiki_agent",
    ) -> tuple[WikiPage, WikiRevision | None, str]:
        page = self.get_page(page_id)
        if page is None:
            raise ValueError(f"unknown page_id: {page_id}")
        current = self.read_page(page_id)
        current_content = ""
        if current is not None:
            current_content = str(current.get("current_revision", {}).get("content_markdown", "") or "")
        if current_content.strip() == content_markdown.strip():
            return page, None, "skipped"
        revision = self.create_revision(
            page_id=page_id,
            run_id=run_id,
            content_markdown=content_markdown,
            summary=summary,
            reason=reason,
            created_by=created_by,
        )
        refreshed = self.get_page(page_id)
        if refreshed is None:
            raise RuntimeError("failed to refresh wiki page")
        return refreshed, revision, "updated"

    def append_page_source(
        self,
        *,
        page_id: str,
        document_id: str,
        source_sentence: str,
        evidence_text: str,
    ) -> WikiPageSource:
        source_id = build_wiki_source_id(
            page_id=page_id,
            document_id=document_id,
            source_sentence=source_sentence,
            evidence_text=evidence_text,
        )
        with self._connect() as connection:
            connection.execute(
                """
                INSERT OR IGNORE INTO wiki_page_sources (
                    source_id, page_id, document_id, source_sentence, evidence_text
                ) VALUES (?, ?, ?, ?, ?)
                """,
                (source_id, page_id, document_id, source_sentence, evidence_text),
            )
            row = connection.execute(
                """
                SELECT page_id, document_id, source_sentence, evidence_text
                FROM wiki_page_sources
                WHERE source_id = ?
                """,
                (source_id,),
            ).fetchone()
        if row is None:
            raise RuntimeError("failed to persist wiki page source")
        return self._row_to_wiki_page_source(row)

    def list_page_sources(self, page_id: str) -> list[WikiPageSource]:
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT page_id, document_id, source_sentence, evidence_text
                FROM wiki_page_sources
                WHERE page_id = ?
                ORDER BY created_at ASC
                """,
                (page_id,),
            ).fetchall()
        return [self._row_to_wiki_page_source(row) for row in rows]

    def link_pages(
        self,
        *,
        source_page_id: str,
        target_page_id: str,
        link_type: str = "related_to",
        anchor_text: str = "",
    ) -> WikiLink:
        with self._connect() as connection:
            connection.execute(
                """
                INSERT OR REPLACE INTO wiki_links (source_page_id, target_page_id, link_type, anchor_text)
                VALUES (?, ?, ?, ?)
                """,
                (source_page_id, target_page_id, link_type, anchor_text),
            )
            row = connection.execute(
                """
                SELECT source_page_id, target_page_id, link_type, anchor_text
                FROM wiki_links
                WHERE source_page_id = ? AND target_page_id = ? AND link_type = ?
                """,
                (source_page_id, target_page_id, link_type),
            ).fetchone()
        if row is None:
            raise RuntimeError("failed to create wiki link")
        return self._row_to_wiki_link(row)

    def list_related_pages(self, page_id: str) -> list[dict[str, Any]]:
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT wl.source_page_id, wl.target_page_id, wl.link_type, wl.anchor_text,
                       wp.title AS target_title, wp.slug AS target_slug, wp.page_type AS target_page_type
                FROM wiki_links wl
                JOIN wiki_pages wp ON wp.page_id = wl.target_page_id
                WHERE wl.source_page_id = ?
                ORDER BY wp.title ASC
                """,
                (page_id,),
            ).fetchall()
        return [
            {
                "source_page_id": str(row["source_page_id"]),
                "target_page_id": str(row["target_page_id"]),
                "target_title": str(row["target_title"]),
                "target_slug": str(row["target_slug"]),
                "target_page_type": str(row["target_page_type"]),
                "link_type": str(row["link_type"]),
                "anchor_text": str(row["anchor_text"] or ""),
            }
            for row in rows
        ]

    def record_agent_step(
        self,
        *,
        run_id: str,
        page_id: str = "",
        thought: str = "",
        action_name: str,
        action_input_json: dict[str, Any] | None = None,
        observation_json: dict[str, Any] | None = None,
    ) -> WikiAgentStep:
        action_payload = action_input_json or {}
        observation_payload = observation_json or {}
        step_id = build_wiki_step_id(
            run_id=run_id,
            page_id=page_id,
            action_name=action_name,
            action_input_json=action_payload,
            observation_json=observation_payload,
        )
        with self._connect() as connection:
            connection.execute(
                """
                INSERT OR REPLACE INTO wiki_agent_steps (
                    step_id, run_id, page_id, thought, action_name, action_input_json, observation_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    step_id,
                    run_id,
                    page_id,
                    thought,
                    action_name,
                    json.dumps(action_payload, ensure_ascii=False),
                    json.dumps(observation_payload, ensure_ascii=False),
                ),
            )
            row = connection.execute(
                """
                SELECT step_id, run_id, page_id, thought, action_name, action_input_json, observation_json
                FROM wiki_agent_steps
                WHERE step_id = ?
                """,
                (step_id,),
            ).fetchone()
        if row is None:
            raise RuntimeError("failed to record wiki agent step")
        return self._row_to_wiki_agent_step(row)

    def list_wiki_agent_steps(self, run_id: str) -> list[WikiAgentStep]:
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT step_id, run_id, page_id, thought, action_name, action_input_json, observation_json
                FROM wiki_agent_steps
                WHERE run_id = ?
                ORDER BY created_at ASC, step_id ASC
                """,
                (run_id,),
            ).fetchall()
        return [self._row_to_wiki_agent_step(row) for row in rows]

    def find_document_by_content_hash(self, content_hash: str) -> DocumentRecord | None:
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT document_id, source_path, doc_name, content_hash, clean_text_path, report_json
                FROM documents WHERE content_hash = ?
                """,
                (content_hash,),
            ).fetchone()
        if row is None:
            return None
        return self._row_to_document(row)

    def record_document(
        self,
        *,
        source_path: str,
        doc_name: str,
        content_hash: str,
        clean_text_path: str,
        run_id: str,
        report_json: dict[str, Any],
    ) -> DocumentRecord:
        document_id = build_document_id(source_path, content_hash)
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO documents (
                    document_id, source_path, doc_name, content_hash, clean_text_path, first_run_id, last_run_id, report_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(content_hash) DO UPDATE SET
                    source_path = excluded.source_path,
                    doc_name = excluded.doc_name,
                    clean_text_path = excluded.clean_text_path,
                    last_run_id = excluded.last_run_id,
                    report_json = excluded.report_json,
                    updated_at = CURRENT_TIMESTAMP
                """,
                (
                    document_id,
                    source_path,
                    doc_name,
                    content_hash,
                    clean_text_path,
                    run_id,
                    run_id,
                    json.dumps(report_json, ensure_ascii=False),
                ),
            )
            row = connection.execute(
                """
                SELECT document_id, source_path, doc_name, content_hash, clean_text_path, report_json
                FROM documents WHERE content_hash = ?
                """,
                (content_hash,),
            ).fetchone()
        if row is None:
            raise RuntimeError("failed to persist document record")
        return self._row_to_document(row)

    def persist_entity_mentions(
        self,
        *,
        document_id: str,
        doc_id: str,
        entities: list[NerEntity],
        mention_to_canonical: dict[str, str] | None = None,
    ) -> None:
        mention_to_canonical = mention_to_canonical or {}
        rows = []
        for entity in entities:
            rows.append(
                (
                    entity.entity_id,
                    document_id,
                    doc_id,
                    mention_to_canonical.get(entity.entity_id, ""),
                    entity.text,
                    entity.normalized_text,
                    build_cache_key(entity),
                    entity.label,
                    entity.start,
                    entity.end,
                    entity.confidence,
                    entity.source_sentence,
                    json.dumps(entity.metadata, ensure_ascii=False),
                )
            )
        if not rows:
            return
        with self._connect() as connection:
            connection.executemany(
                """
                INSERT OR REPLACE INTO entity_mentions (
                    mention_id, document_id, doc_id, canonical_entity_id, text, normalized_text, normalized_key,
                    ner_label, start_offset, end_offset, confidence, source_sentence, metadata_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                rows,
            )

    def link_entity_mentions(self, mention_to_canonical: dict[str, str]) -> None:
        if not mention_to_canonical:
            return
        with self._connect() as connection:
            connection.executemany(
                "UPDATE entity_mentions SET canonical_entity_id = ? WHERE mention_id = ?",
                [(canonical_id, mention_id) for mention_id, canonical_id in mention_to_canonical.items()],
            )

    def persist_relation_mentions(
        self,
        *,
        document_id: str,
        doc_id: str,
        relations: list[dict[str, Any]],
        mention_to_canonical: dict[str, str] | None = None,
        relation_to_canonical: dict[str, str] | None = None,
    ) -> None:
        mention_to_canonical = mention_to_canonical or {}
        relation_to_canonical = relation_to_canonical or {}
        rows = []
        for relation in relations:
            rows.append(
                (
                    doc_id,
                    str(relation.get("relation_id", "")),
                    str(relation.get("relation_cache_key", "")),
                    str(relation.get("source_entity_id", "")),
                    str(relation.get("target_entity_id", "")),
                    str(relation.get("evidence_sentence", "")),
                    json.dumps(relation.get("metadata", {}), ensure_ascii=False),
                    document_id,
                    mention_to_canonical.get(str(relation.get("source_entity_id", "")), ""),
                    mention_to_canonical.get(str(relation.get("target_entity_id", "")), ""),
                    relation_to_canonical.get(str(relation.get("relation_id", "")), ""),
                    str(relation.get("relation_type", "")),
                    float(relation.get("confidence", 0.0)),
                )
            )
        if not rows:
            return
        with self._connect() as connection:
            connection.executemany(
                """
                INSERT OR REPLACE INTO relation_mentions (
                    doc_id, relation_id, relation_cache_key, source_entity_id, target_entity_id,
                    evidence_sentence, metadata_json, document_id, source_canonical_id,
                    target_canonical_id, canonical_relation_id, relation_type, confidence
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                rows,
            )

    def update_relation_mentions(self, relation_to_canonical: dict[str, str], relation_payloads: dict[str, dict[str, Any]]) -> None:
        if not relation_to_canonical:
            return
        rows = []
        for relation_id, canonical_relation_id in relation_to_canonical.items():
            payload = relation_payloads.get(relation_id, {})
            rows.append(
                (
                    payload.get("source_canonical_id", ""),
                    payload.get("target_canonical_id", ""),
                    canonical_relation_id,
                    payload.get("relation_type", ""),
                    float(payload.get("confidence", 0.0)),
                    relation_id,
                )
            )
        with self._connect() as connection:
            connection.executemany(
                """
                UPDATE relation_mentions
                SET source_canonical_id = ?,
                    target_canonical_id = ?,
                    canonical_relation_id = ?,
                    relation_type = ?,
                    confidence = ?
                WHERE relation_id = ?
                """,
                rows,
            )

    def match_canonical_entities(self, entities: list[NerEntity]) -> dict[str, CanonicalEntity]:
        if not entities:
            return {}
        normalized_keys = list({build_cache_key(entity) for entity in entities})
        alias_keys = list({normalize_alias(entity.normalized_text) for entity in entities})
        with self._connect() as connection:
            direct_rows = connection.execute(
                f"""
                SELECT canonical_id, normalized_key, normalized_text, preferred_name, ner_label, mention_count,
                       current_classification_id, evidence_summary, metadata_json
                FROM canonical_entities
                WHERE normalized_key IN ({','.join('?' for _ in normalized_keys)})
                """,
                normalized_keys,
            ).fetchall()
            alias_rows = connection.execute(
                f"""
                SELECT ce.canonical_id, ce.normalized_key, ce.normalized_text, ce.preferred_name, ce.ner_label,
                       ce.mention_count, ce.current_classification_id, ce.evidence_summary, ce.metadata_json,
                       ea.alias_normalized_text
                FROM entity_aliases ea
                JOIN canonical_entities ce ON ce.canonical_id = ea.canonical_id
                WHERE ea.alias_normalized_text IN ({','.join('?' for _ in alias_keys)})
                """,
                alias_keys,
            ).fetchall()
        direct_map = {str(row["normalized_key"]): self._row_to_canonical_entity(row) for row in direct_rows}
        alias_map = {}
        for row in alias_rows:
            alias_map[(str(row["alias_normalized_text"]), str(row["ner_label"]))] = self._row_to_canonical_entity(row)
        matched: dict[str, CanonicalEntity] = {}
        for entity in entities:
            direct = direct_map.get(build_cache_key(entity))
            if direct is not None:
                matched[entity.entity_id] = direct
                continue
            alias = alias_map.get((normalize_alias(entity.normalized_text), entity.label))
            if alias is not None:
                matched[entity.entity_id] = alias
        return matched

    def get_candidate_canonical_entities(self, *, normalized_text: str, ner_label: str, limit: int = 5) -> list[CanonicalEntity]:
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT canonical_id, normalized_key, normalized_text, preferred_name, ner_label, mention_count,
                       current_classification_id, evidence_summary, metadata_json
                FROM canonical_entities
                WHERE ner_label = ?
                ORDER BY mention_count DESC, updated_at DESC
                LIMIT ?
                """,
                (ner_label, limit * 4),
            ).fetchall()
        candidates = [self._row_to_canonical_entity(row) for row in rows]
        key = normalize_alias(normalized_text)
        scored = sorted(
            candidates,
            key=lambda item: _text_similarity(key, normalize_alias(item.normalized_text)),
            reverse=True,
        )
        return [item for item in scored if _text_similarity(key, normalize_alias(item.normalized_text)) >= 0.6][:limit]

    def upsert_canonical_entities(
        self,
        *,
        run_id: str,
        entities: list[NerEntity],
        matched_entities: dict[str, CanonicalEntity],
    ) -> tuple[dict[str, CanonicalEntity], list[ChangeEvent]]:
        mention_to_canonical: dict[str, CanonicalEntity] = {}
        change_events: list[ChangeEvent] = []
        with self._connect() as connection:
            for entity in entities:
                matched = matched_entities.get(entity.entity_id)
                occurrence = int(entity.metadata.get("occurrence_count", 1))
                if matched is None:
                    normalized_key = build_cache_key(entity)
                    canonical_id = build_canonical_entity_id(normalized_key)
                    connection.execute(
                        """
                        INSERT INTO canonical_entities (
                            canonical_id, normalized_key, normalized_text, preferred_name, ner_label,
                            mention_count, current_classification_id, evidence_summary, metadata_json,
                            created_in_run_id, last_seen_run_id, last_version_id
                        ) VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, '')
                        ON CONFLICT(normalized_key) DO UPDATE SET
                            mention_count = canonical_entities.mention_count + excluded.mention_count,
                            preferred_name = CASE
                                WHEN LENGTH(canonical_entities.preferred_name) >= LENGTH(excluded.preferred_name)
                                THEN canonical_entities.preferred_name
                                ELSE excluded.preferred_name
                            END,
                            evidence_summary = CASE
                                WHEN canonical_entities.evidence_summary = '' THEN excluded.evidence_summary
                                ELSE canonical_entities.evidence_summary
                            END,
                            last_seen_run_id = excluded.last_seen_run_id,
                            updated_at = CURRENT_TIMESTAMP
                        """,
                        (
                            canonical_id,
                            normalized_key,
                            entity.normalized_text,
                            entity.text or entity.normalized_text,
                            entity.label,
                            occurrence,
                            entity.source_sentence,
                            json.dumps({"seed_entity_id": entity.entity_id}, ensure_ascii=False),
                            run_id,
                            run_id,
                        ),
                    )
                    row = connection.execute(
                        """
                        SELECT canonical_id, normalized_key, normalized_text, preferred_name, ner_label, mention_count,
                               current_classification_id, evidence_summary, metadata_json
                        FROM canonical_entities WHERE normalized_key = ?
                        """,
                        (normalized_key,),
                    ).fetchone()
                    if row is None:
                        raise RuntimeError("failed to upsert canonical entity")
                    canonical = self._row_to_canonical_entity(row)
                    mention_to_canonical[entity.entity_id] = canonical
                    change_events.append(
                        ChangeEvent(
                            event_id=build_change_event_id(run_id, "canonical_entity", canonical.canonical_id, f"created:{entity.entity_id}"),
                            run_id=run_id,
                            object_type="canonical_entity",
                            object_id=canonical.canonical_id,
                            event_type="created_entity",
                            reason="new-normalized-key",
                            payload={
                                "mention_id": entity.entity_id,
                                "normalized_key": normalized_key,
                                "preferred_name": canonical.preferred_name,
                            },
                        )
                    )
                else:
                    connection.execute(
                        """
                        UPDATE canonical_entities
                        SET mention_count = mention_count + ?,
                            last_seen_run_id = ?,
                            updated_at = CURRENT_TIMESTAMP
                        WHERE canonical_id = ?
                        """,
                        (occurrence, run_id, matched.canonical_id),
                    )
                    refreshed = connection.execute(
                        """
                        SELECT canonical_id, normalized_key, normalized_text, preferred_name, ner_label, mention_count,
                               current_classification_id, evidence_summary, metadata_json
                        FROM canonical_entities WHERE canonical_id = ?
                        """,
                        (matched.canonical_id,),
                    ).fetchone()
                    if refreshed is None:
                        raise RuntimeError("failed to refresh canonical entity")
                    canonical = self._row_to_canonical_entity(refreshed)
                    mention_to_canonical[entity.entity_id] = canonical
                    change_events.append(
                        ChangeEvent(
                            event_id=build_change_event_id(run_id, "canonical_entity", canonical.canonical_id, f"reused:{entity.entity_id}"),
                            run_id=run_id,
                            object_type="canonical_entity",
                            object_id=canonical.canonical_id,
                            event_type="reused_entity",
                            reason="matched-existing-canonical",
                            payload={"mention_id": entity.entity_id},
                        )
                    )
                canonical = mention_to_canonical[entity.entity_id]
                self._upsert_alias(connection, canonical.canonical_id, entity, source="mention")
            connection.commit()
        return mention_to_canonical, change_events

    def _upsert_alias(self, connection: sqlite3.Connection, canonical_id: str, entity: NerEntity, *, source: str) -> None:
        alias_values = {
            normalize_alias(entity.normalized_text): entity.normalized_text,
            normalize_alias(entity.text): entity.text,
        }
        for alias_normalized, alias_text in alias_values.items():
            if not alias_normalized:
                continue
            connection.execute(
                """
                INSERT OR IGNORE INTO entity_aliases (
                    canonical_id, alias_text, alias_normalized_text, ner_label, source, confidence
                ) VALUES (?, ?, ?, ?, ?, 1.0)
                """,
                (canonical_id, alias_text or entity.normalized_text, alias_normalized, entity.label, source),
            )

    def upsert_canonical_relations(
        self,
        *,
        run_id: str,
        relations: list[dict[str, Any]],
        mention_to_canonical: dict[str, CanonicalEntity],
    ) -> tuple[dict[str, CanonicalRelation], list[ChangeEvent]]:
        relation_map: dict[str, CanonicalRelation] = {}
        change_events: list[ChangeEvent] = []
        with self._connect() as connection:
            for relation in relations:
                source = mention_to_canonical.get(str(relation.get("source_entity_id", "")))
                target = mention_to_canonical.get(str(relation.get("target_entity_id", "")))
                if source is None or target is None:
                    continue
                relation_type = str(relation.get("relation_type", "")).strip() or "co_occurs_with"
                relation_key = build_canonical_relation_key(source.canonical_id, target.canonical_id, relation_type)
                canonical_relation_id = build_canonical_relation_id(relation_key)
                evidence_sentence = str(relation.get("evidence_sentence", "")).strip()
                confidence = float(relation.get("confidence", 0.0))
                metadata = dict(relation.get("metadata", {}))
                existing = connection.execute(
                    """
                    SELECT canonical_relation_id, relation_key, source_canonical_id, target_canonical_id,
                           relation_type, confidence, mention_count, evidence_json, metadata_json
                    FROM canonical_relations WHERE relation_key = ?
                    """,
                    (relation_key,),
                ).fetchone()
                if existing is None:
                    connection.execute(
                        """
                        INSERT INTO canonical_relations (
                            canonical_relation_id, relation_key, source_canonical_id, target_canonical_id,
                            relation_type, confidence, mention_count, evidence_json, metadata_json,
                            first_run_id, last_run_id, last_version_id
                        ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, '')
                        """,
                        (
                            canonical_relation_id,
                            relation_key,
                            source.canonical_id,
                            target.canonical_id,
                            relation_type,
                            confidence,
                            json.dumps([evidence_sentence] if evidence_sentence else [], ensure_ascii=False),
                            json.dumps(metadata, ensure_ascii=False),
                            run_id,
                            run_id,
                        ),
                    )
                    row = connection.execute(
                        """
                        SELECT canonical_relation_id, relation_key, source_canonical_id, target_canonical_id,
                               relation_type, confidence, mention_count, evidence_json, metadata_json
                        FROM canonical_relations WHERE relation_key = ?
                        """,
                        (relation_key,),
                    ).fetchone()
                    event_type = "created_relation"
                    reason = "new-relation-key"
                else:
                    evidence_sentences = _json_load_list(str(existing["evidence_json"]))
                    if evidence_sentence and evidence_sentence not in evidence_sentences:
                        evidence_sentences.append(evidence_sentence)
                    connection.execute(
                        """
                        UPDATE canonical_relations
                        SET confidence = MAX(confidence, ?),
                            mention_count = mention_count + 1,
                            evidence_json = ?,
                            metadata_json = ?,
                            last_run_id = ?,
                            updated_at = CURRENT_TIMESTAMP
                        WHERE relation_key = ?
                        """,
                        (
                            confidence,
                            json.dumps(evidence_sentences, ensure_ascii=False),
                            json.dumps(metadata, ensure_ascii=False),
                            run_id,
                            relation_key,
                        ),
                    )
                    row = connection.execute(
                        """
                        SELECT canonical_relation_id, relation_key, source_canonical_id, target_canonical_id,
                               relation_type, confidence, mention_count, evidence_json, metadata_json
                        FROM canonical_relations WHERE relation_key = ?
                        """,
                        (relation_key,),
                    ).fetchone()
                    event_type = "updated_relation"
                    reason = "existing-relation-extended"
                if row is None:
                    raise RuntimeError("failed to upsert canonical relation")
                canonical_relation = self._row_to_canonical_relation(row)
                relation_map[str(relation.get("relation_id", ""))] = canonical_relation
                change_events.append(
                    ChangeEvent(
                        event_id=build_change_event_id(run_id, "canonical_relation", canonical_relation.canonical_relation_id, str(relation.get("relation_id", ""))),
                        run_id=run_id,
                        object_type="canonical_relation",
                        object_id=canonical_relation.canonical_relation_id,
                        event_type=event_type,
                        reason=reason,
                        payload={
                            "relation_id": str(relation.get("relation_id", "")),
                            "source_canonical_id": source.canonical_id,
                            "target_canonical_id": target.canonical_id,
                            "relation_type": relation_type,
                        },
                    )
                )
            connection.commit()
        return relation_map, change_events

    def list_canonical_entities(self, canonical_ids: Iterable[str] | None = None) -> list[CanonicalEntity]:
        with self._connect() as connection:
            if canonical_ids is None:
                rows = connection.execute(
                    """
                    SELECT canonical_id, normalized_key, normalized_text, preferred_name, ner_label, mention_count,
                           current_classification_id, evidence_summary, metadata_json
                    FROM canonical_entities
                    ORDER BY mention_count DESC, preferred_name ASC
                    """
                ).fetchall()
            else:
                ids = list(dict.fromkeys(canonical_ids))
                if not ids:
                    return []
                rows = connection.execute(
                    f"""
                    SELECT canonical_id, normalized_key, normalized_text, preferred_name, ner_label, mention_count,
                           current_classification_id, evidence_summary, metadata_json
                    FROM canonical_entities
                    WHERE canonical_id IN ({','.join('?' for _ in ids)})
                    """,
                    ids,
                ).fetchall()
        return [self._row_to_canonical_entity(row) for row in rows]

    def get_canonical_entity(self, canonical_id: str) -> CanonicalEntity | None:
        rows = self.list_canonical_entities([canonical_id])
        return rows[0] if rows else None

    def list_entity_mentions(self, canonical_id: str) -> list[dict[str, Any]]:
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT mention_id, doc_id, text, normalized_text, ner_label, source_sentence, metadata_json
                FROM entity_mentions
                WHERE canonical_entity_id = ?
                ORDER BY created_at ASC, mention_id ASC
                """,
                (canonical_id,),
            ).fetchall()
        mentions: list[dict[str, Any]] = []
        for row in rows:
            mentions.append(
                {
                    "mention_id": str(row["mention_id"]),
                    "doc_id": str(row["doc_id"]),
                    "text": str(row["text"]),
                    "normalized_text": str(row["normalized_text"]),
                    "ner_label": str(row["ner_label"]),
                    "source_sentence": str(row["source_sentence"]),
                    "metadata": json.loads(str(row["metadata_json"] or "{}")),
                }
            )
        return mentions

    def list_neighbor_relations(self, canonical_id: str) -> list[CanonicalRelation]:
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT canonical_relation_id, relation_key, source_canonical_id, target_canonical_id, relation_type,
                       confidence, mention_count, evidence_json, metadata_json
                FROM canonical_relations
                WHERE source_canonical_id = ? OR target_canonical_id = ?
                ORDER BY mention_count DESC, relation_type ASC
                """,
                (canonical_id, canonical_id),
            ).fetchall()
        return [self._row_to_canonical_relation(row) for row in rows]

    def get_current_classification(self, canonical_id: str) -> EntityClassification | None:
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT classification_id, canonical_id, ontology_label, confidence, evidence_signature,
                       result_json, source_run_id, source_reason, is_current
                FROM entity_classifications
                WHERE canonical_id = ? AND is_current = 1
                ORDER BY created_at DESC
                LIMIT 1
                """,
                (canonical_id,),
            ).fetchone()
        if row is None:
            return None
        return self._row_to_entity_classification(row)

    def save_entity_classification(
        self,
        *,
        run_id: str,
        canonical_id: str,
        result: dict[str, Any],
        evidence_signature: str,
        source_reason: str,
    ) -> EntityClassification:
        classification_id = build_classification_id(canonical_id, f"{run_id}:{evidence_signature}")
        with self._connect() as connection:
            connection.execute(
                "UPDATE entity_classifications SET is_current = 0 WHERE canonical_id = ? AND is_current = 1",
                (canonical_id,),
            )
            connection.execute(
                """
                INSERT OR REPLACE INTO entity_classifications (
                    classification_id, canonical_id, ontology_label, confidence, evidence_signature,
                    result_json, source_run_id, source_reason, is_current
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
                """,
                (
                    classification_id,
                    canonical_id,
                    str(result.get("ontology_label", "")),
                    float(result.get("confidence", 0.0)),
                    evidence_signature,
                    json.dumps(result, ensure_ascii=False),
                    run_id,
                    source_reason,
                ),
            )
            connection.execute(
                """
                UPDATE canonical_entities
                SET current_classification_id = ?,
                    last_seen_run_id = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE canonical_id = ?
                """,
                (classification_id, run_id, canonical_id),
            )
            row = connection.execute(
                """
                SELECT classification_id, canonical_id, ontology_label, confidence, evidence_signature,
                       result_json, source_run_id, source_reason, is_current
                FROM entity_classifications
                WHERE classification_id = ?
                """,
                (classification_id,),
            ).fetchone()
        if row is None:
            raise RuntimeError("failed to persist entity classification")
        return self._row_to_entity_classification(row)

    def commit_ontology_version(
        self,
        *,
        run_id: str,
        processed_documents: int,
        changed_entities: list[str],
        changed_relations: list[str],
        manifest: dict[str, Any],
        change_events: list[ChangeEvent],
    ) -> OntologyVersion:
        with self._connect() as connection:
            active = connection.execute(
                """
                SELECT version_id, version_number
                FROM ontology_versions
                WHERE is_active = 1
                ORDER BY version_number DESC
                LIMIT 1
                """
            ).fetchone()
            parent_version_id = str(active["version_id"]) if active is not None else ""
            next_number = int(active["version_number"]) + 1 if active is not None else 1
            version_id = build_version_id(run_id, next_number)
            if active is not None:
                connection.execute("UPDATE ontology_versions SET is_active = 0 WHERE version_id = ?", (parent_version_id,))
            connection.execute(
                """
                INSERT INTO ontology_versions (
                    version_id, run_id, parent_version_id, version_number, is_active,
                    processed_documents, changed_entities, changed_relations, manifest_json
                ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)
                """,
                (
                    version_id,
                    run_id,
                    parent_version_id,
                    next_number,
                    processed_documents,
                    len(set(changed_entities)),
                    len(set(changed_relations)),
                    json.dumps(manifest, ensure_ascii=False),
                ),
            )
            if changed_entities:
                connection.executemany(
                    "UPDATE canonical_entities SET last_version_id = ? WHERE canonical_id = ?",
                    [(version_id, canonical_id) for canonical_id in sorted(set(changed_entities))],
                )
            if changed_relations:
                connection.executemany(
                    "UPDATE canonical_relations SET last_version_id = ? WHERE canonical_relation_id = ?",
                    [(version_id, relation_id) for relation_id in sorted(set(changed_relations))],
                )
            if change_events:
                connection.executemany(
                    """
                    INSERT OR REPLACE INTO change_events (
                        event_id, version_id, run_id, object_type, object_id, event_type, reason, payload_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    [
                        (
                            event.event_id,
                            version_id,
                            event.run_id,
                            event.object_type,
                            event.object_id,
                            event.event_type,
                            event.reason,
                            json.dumps(event.payload, ensure_ascii=False),
                        )
                        for event in change_events
                    ],
                )
            row = connection.execute(
                """
                SELECT version_id, run_id, parent_version_id, version_number, is_active,
                       processed_documents, changed_entities, changed_relations, manifest_json
                FROM ontology_versions
                WHERE version_id = ?
                """,
                (version_id,),
            ).fetchone()
        if row is None:
            raise RuntimeError("failed to commit ontology version")
        return self._row_to_ontology_version(row)

    def get_active_version(self) -> OntologyVersion | None:
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT version_id, run_id, parent_version_id, version_number, is_active,
                       processed_documents, changed_entities, changed_relations, manifest_json
                FROM ontology_versions
                WHERE is_active = 1
                ORDER BY version_number DESC
                LIMIT 1
                """
            ).fetchone()
        if row is None:
            return None
        return self._row_to_ontology_version(row)

    def export_active_graph(self, export_dir: str) -> GraphExportArtifacts:
        export_root = Path(export_dir)
        export_root.mkdir(parents=True, exist_ok=True)
        active_version = self.get_active_version()
        with self._connect() as connection:
            node_rows = connection.execute(
                """
                SELECT ce.canonical_id, ce.normalized_key, ce.normalized_text, ce.preferred_name, ce.ner_label,
                       ce.mention_count, ce.evidence_summary, ce.metadata_json,
                       ec.ontology_label, ec.confidence
                FROM canonical_entities ce
                LEFT JOIN entity_classifications ec
                  ON ec.classification_id = ce.current_classification_id
                ORDER BY ce.mention_count DESC, ce.preferred_name ASC
                """
            ).fetchall()
            edge_rows = connection.execute(
                """
                SELECT canonical_relation_id, relation_key, source_canonical_id, target_canonical_id,
                       relation_type, confidence, mention_count, evidence_json, metadata_json, last_version_id
                FROM canonical_relations
                ORDER BY mention_count DESC, relation_type ASC
                """
            ).fetchall()
        json_payload = {
            "version_id": active_version.version_id if active_version is not None else "",
            "nodes": [
                {
                    "canonical_id": str(row["canonical_id"]),
                    "normalized_key": str(row["normalized_key"]),
                    "preferred_name": str(row["preferred_name"]),
                    "normalized_text": str(row["normalized_text"]),
                    "ner_label": str(row["ner_label"]),
                    "mention_count": int(row["mention_count"] or 0),
                    "evidence_summary": str(row["evidence_summary"] or ""),
                    "ontology_label": str(row["ontology_label"] or ""),
                    "confidence": float(row["confidence"] or 0.0),
                    "metadata": json.loads(str(row["metadata_json"] or "{}")),
                }
                for row in node_rows
            ],
            "edges": [
                {
                    "canonical_relation_id": str(row["canonical_relation_id"]),
                    "relation_key": str(row["relation_key"]),
                    "source": str(row["source_canonical_id"]),
                    "target": str(row["target_canonical_id"]),
                    "relation_type": str(row["relation_type"]),
                    "confidence": float(row["confidence"] or 0.0),
                    "mention_count": int(row["mention_count"] or 0),
                    "version_id": str(row["last_version_id"] or ""),
                    "evidence_sentences": _json_load_list(str(row["evidence_json"] or "[]")),
                    "metadata": json.loads(str(row["metadata_json"] or "{}")),
                }
                for row in edge_rows
            ],
        }
        json_path = export_root / "canonical_graph.json"
        json_path.write_text(json.dumps(json_payload, ensure_ascii=False, indent=2), encoding="utf-8")
        graphml_path = export_root / "canonical_graph.graphml"
        self._write_graphml(graphml_path, json_payload)
        return GraphExportArtifacts(json_path=str(json_path), graphml_path=str(graphml_path))

    def _write_graphml(self, path: Path, payload: dict[str, Any]) -> None:
        root = ET.Element("graphml", xmlns="http://graphml.graphdrawing.org/xmlns")
        keys = [
            ("node_name", "node", "name", "string"),
            ("node_label", "node", "ontology_label", "string"),
            ("node_ner", "node", "ner_label", "string"),
            ("node_mentions", "node", "mention_count", "int"),
            ("edge_relation", "edge", "relation_type", "string"),
            ("edge_confidence", "edge", "confidence", "double"),
            ("edge_mentions", "edge", "mention_count", "int"),
            ("edge_version", "edge", "version_id", "string"),
        ]
        for key_id, key_for, attr_name, attr_type in keys:
            ET.SubElement(
                root,
                "key",
                id=key_id,
                **{"for": key_for, "attr.name": attr_name, "attr.type": attr_type},
            )
        graph = ET.SubElement(root, "graph", edgedefault="directed", id="ontology_graph")
        for node in payload.get("nodes", []):
            node_el = ET.SubElement(graph, "node", id=str(node["canonical_id"]))
            _graphml_data(node_el, "node_name", str(node.get("preferred_name", "")))
            _graphml_data(node_el, "node_label", str(node.get("ontology_label", "")))
            _graphml_data(node_el, "node_ner", str(node.get("ner_label", "")))
            _graphml_data(node_el, "node_mentions", str(node.get("mention_count", 0)))
        for index, edge in enumerate(payload.get("edges", []), start=1):
            edge_el = ET.SubElement(
                graph,
                "edge",
                id=f"edge_{index}",
                source=str(edge["source"]),
                target=str(edge["target"]),
            )
            _graphml_data(edge_el, "edge_relation", str(edge.get("relation_type", "")))
            _graphml_data(edge_el, "edge_confidence", str(edge.get("confidence", 0.0)))
            _graphml_data(edge_el, "edge_mentions", str(edge.get("mention_count", 0)))
            _graphml_data(edge_el, "edge_version", str(edge.get("version_id", "")))
        ET.ElementTree(root).write(path, encoding="utf-8", xml_declaration=True)

    def load_cached_classifications(self, entities: list[NerEntity]) -> dict[str, CachedClassification]:
        if not entities:
            return {}
        normalized_keys = [build_cache_key(entity) for entity in entities]
        with self._connect() as connection:
            rows = connection.execute(
                f"""
                SELECT ce.normalized_key, ce.normalized_text, ce.ner_label, ec.result_json
                FROM canonical_entities ce
                JOIN entity_classifications ec
                  ON ec.classification_id = ce.current_classification_id
                WHERE ce.normalized_key IN ({','.join('?' for _ in normalized_keys)})
                """,
                normalized_keys,
            ).fetchall()
        results: dict[str, CachedClassification] = {}
        for row in rows:
            cache_key = str(row["normalized_key"])
            results[cache_key] = CachedClassification(
                cache_key=cache_key,
                normalized_text=str(row["normalized_text"]),
                ner_label=str(row["ner_label"]),
                ontology_result=json.loads(str(row["result_json"] or "{}")),
            )
        return results

    def persist_extracted_entities(self, document: NerDocument) -> None:
        document_id = build_document_id(f"legacy://{document.doc_id}", f"legacy:{document.doc_id}")
        with self._connect() as connection:
            connection.execute(
                """
                INSERT OR IGNORE INTO documents (
                    document_id, source_path, doc_name, content_hash, clean_text_path, first_run_id, last_run_id, report_json
                ) VALUES (?, ?, ?, ?, '', 'legacy-api', 'legacy-api', '{}')
                """,
                (document_id, f"legacy://{document.doc_id}", document.doc_id, f"legacy:{document.doc_id}"),
            )
        self.persist_entity_mentions(document_id=document_id, doc_id=document.doc_id, entities=document.entities)

    def persist_classification_results(self, doc_id: str, entities: list[NerEntity], results: list[dict[str, Any]]) -> None:
        matched = self.match_canonical_entities(entities)
        mention_map, _ = self.upsert_canonical_entities(run_id=doc_id, entities=entities, matched_entities=matched)
        by_entity_id = {entity.entity_id: entity for entity in entities}
        for result in results:
            entity = by_entity_id.get(str(result.get("node_id", "")))
            if entity is None:
                continue
            canonical = mention_map.get(entity.entity_id)
            if canonical is None:
                continue
            evidence_signature = build_evidence_signature(
                normalized_key=canonical.normalized_key,
                relation_signatures=[],
            )
            enriched = dict(result)
            enriched["info_name"] = canonical.preferred_name
            self.save_entity_classification(
                run_id=doc_id,
                canonical_id=canonical.canonical_id,
                result=enriched,
                evidence_signature=evidence_signature,
                source_reason="legacy-api",
            )

    def persist_relations(self, doc_id: str, entities: list[NerEntity], relations: list[dict[str, Any]]) -> None:
        matched = self.match_canonical_entities(entities)
        mention_map, _ = self.upsert_canonical_entities(run_id=doc_id, entities=entities, matched_entities=matched)
        relation_map, _ = self.upsert_canonical_relations(
            run_id=doc_id,
            relations=relations,
            mention_to_canonical=mention_map,
        )
        payload_map = {}
        relation_to_canonical = {}
        for relation in relations:
            relation_id = str(relation.get("relation_id", ""))
            canonical_relation = relation_map.get(relation_id)
            if canonical_relation is None:
                continue
            relation_to_canonical[relation_id] = canonical_relation.canonical_relation_id
            payload_map[relation_id] = {
                "source_canonical_id": mention_map[str(relation.get("source_entity_id", ""))].canonical_id,
                "target_canonical_id": mention_map[str(relation.get("target_entity_id", ""))].canonical_id,
                "relation_type": canonical_relation.relation_type,
                "confidence": canonical_relation.confidence,
            }
        self.persist_relation_mentions(
            document_id=build_document_id(f"legacy://{doc_id}", f"legacy:{doc_id}"),
            doc_id=doc_id,
            relations=relations,
            mention_to_canonical={mention_id: canonical.canonical_id for mention_id, canonical in mention_map.items()},
            relation_to_canonical=relation_to_canonical,
        )
        self.update_relation_mentions(relation_to_canonical, payload_map)

    def _row_to_document(self, row: sqlite3.Row) -> DocumentRecord:
        return DocumentRecord(
            document_id=str(row["document_id"]),
            source_path=str(row["source_path"]),
            doc_name=str(row["doc_name"]),
            content_hash=str(row["content_hash"]),
            clean_text_path=str(row["clean_text_path"] or ""),
            report_json=json.loads(str(row["report_json"] or "{}")),
        )

    def _row_to_canonical_entity(self, row: sqlite3.Row) -> CanonicalEntity:
        return CanonicalEntity(
            canonical_id=str(row["canonical_id"]),
            normalized_key=str(row["normalized_key"]),
            normalized_text=str(row["normalized_text"]),
            preferred_name=str(row["preferred_name"]),
            ner_label=str(row["ner_label"]),
            mention_count=int(row["mention_count"] or 0),
            current_classification_id=str(row["current_classification_id"] or ""),
            evidence_summary=str(row["evidence_summary"] or ""),
            metadata=json.loads(str(row["metadata_json"] or "{}")),
        )

    def _row_to_canonical_relation(self, row: sqlite3.Row) -> CanonicalRelation:
        return CanonicalRelation(
            canonical_relation_id=str(row["canonical_relation_id"]),
            relation_key=str(row["relation_key"]),
            source_canonical_id=str(row["source_canonical_id"]),
            target_canonical_id=str(row["target_canonical_id"]),
            relation_type=str(row["relation_type"]),
            confidence=float(row["confidence"] or 0.0),
            mention_count=int(row["mention_count"] or 0),
            evidence_sentences=_json_load_list(str(row["evidence_json"] or "[]")),
            metadata=json.loads(str(row["metadata_json"] or "{}")),
        )

    def _row_to_entity_classification(self, row: sqlite3.Row) -> EntityClassification:
        return EntityClassification(
            classification_id=str(row["classification_id"]),
            canonical_id=str(row["canonical_id"]),
            ontology_label=str(row["ontology_label"]),
            confidence=float(row["confidence"] or 0.0),
            evidence_signature=str(row["evidence_signature"] or ""),
            result_json=json.loads(str(row["result_json"] or "{}")),
            source_run_id=str(row["source_run_id"] or ""),
            source_reason=str(row["source_reason"] or ""),
            is_current=bool(row["is_current"]),
        )

    def _row_to_ontology_version(self, row: sqlite3.Row) -> OntologyVersion:
        return OntologyVersion(
            version_id=str(row["version_id"]),
            run_id=str(row["run_id"]),
            parent_version_id=str(row["parent_version_id"] or ""),
            version_number=int(row["version_number"] or 0),
            is_active=bool(row["is_active"]),
            processed_documents=int(row["processed_documents"] or 0),
            changed_entities=int(row["changed_entities"] or 0),
            changed_relations=int(row["changed_relations"] or 0),
            manifest=json.loads(str(row["manifest_json"] or "{}")),
        )

    def _row_to_wiki_page(self, row: sqlite3.Row) -> WikiPage:
        return WikiPage(
            page_id=str(row["page_id"]),
            slug=str(row["slug"]),
            title=str(row["title"]),
            page_type=str(row["page_type"]),
            layer=str(row["layer"] or "domain"),
            doc_ref=str(row["doc_ref"] or ""),
            file_path=str(row["file_path"] or ""),
            status=str(row["status"] or "active"),
            current_revision_id=str(row["current_revision_id"] or ""),
        )

    def _row_to_wiki_revision(self, row: sqlite3.Row) -> WikiRevision:
        return WikiRevision(
            revision_id=str(row["revision_id"]),
            page_id=str(row["page_id"]),
            run_id=str(row["run_id"]),
            content_markdown=str(row["content_markdown"]),
            summary=str(row["summary"] or ""),
            reason=str(row["reason"] or ""),
            created_by=str(row["created_by"] or "wiki_agent"),
        )

    def _row_to_wiki_page_source(self, row: sqlite3.Row) -> WikiPageSource:
        return WikiPageSource(
            page_id=str(row["page_id"]),
            document_id=str(row["document_id"]),
            source_sentence=str(row["source_sentence"] or ""),
            evidence_text=str(row["evidence_text"] or ""),
        )

    def _row_to_wiki_link(self, row: sqlite3.Row) -> WikiLink:
        return WikiLink(
            source_page_id=str(row["source_page_id"]),
            target_page_id=str(row["target_page_id"]),
            link_type=str(row["link_type"] or "related_to"),
            anchor_text=str(row["anchor_text"] or ""),
        )

    def _row_to_wiki_agent_step(self, row: sqlite3.Row) -> WikiAgentStep:
        return WikiAgentStep(
            step_id=str(row["step_id"]),
            run_id=str(row["run_id"]),
            page_id=str(row["page_id"] or ""),
            thought=str(row["thought"] or ""),
            action_name=str(row["action_name"]),
            action_input_json=json.loads(str(row["action_input_json"] or "{}")),
            observation_json=json.loads(str(row["observation_json"] or "{}")),
        )


ClassificationStore = OntologyStore


def build_normalized_key(normalized_text: str, ner_label: str) -> str:
    return f"{normalized_text.strip().lower()}::{ner_label.strip().upper()}"


def build_cache_key(entity: NerEntity) -> str:
    return build_normalized_key(entity.normalized_text, entity.label)


def build_relation_cache_key(
    *,
    source_cache_key: str,
    target_cache_key: str,
    relation_type: str,
    symmetric: bool = False,
) -> str:
    if symmetric and source_cache_key > target_cache_key:
        source_cache_key, target_cache_key = target_cache_key, source_cache_key
    return f"{source_cache_key}::{relation_type.strip().lower()}::{target_cache_key}"


def build_canonical_entity_id(normalized_key: str) -> str:
    digest = hashlib.sha1(normalized_key.encode("utf-8")).hexdigest()[:12]
    return f"can_{digest}"


def build_canonical_relation_key(source_canonical_id: str, target_canonical_id: str, relation_type: str) -> str:
    return f"{source_canonical_id}::{relation_type.strip().lower()}::{target_canonical_id}"


def build_canonical_relation_id(relation_key: str) -> str:
    digest = hashlib.sha1(relation_key.encode("utf-8")).hexdigest()[:12]
    return f"crel_{digest}"


def build_run_id(*, mode: str, input_root: str) -> str:
    seed = f"{mode}|{input_root}|{time.time_ns()}"
    digest = hashlib.sha1(seed.encode("utf-8")).hexdigest()[:12]
    return f"run_{digest}"


def build_wiki_slug(title: str) -> str:
    lowered = normalize_alias(title)
    slug = re.sub(r"[^\w\u4e00-\u9fff]+", "-", lowered, flags=re.UNICODE).strip("-")
    return slug or "untitled"


def build_wiki_page_id(slug: str) -> str:
    digest = hashlib.sha1(slug.encode("utf-8")).hexdigest()[:12]
    return f"wpg_{digest}"


def build_wiki_revision_id(*, page_id: str, run_id: str, content_markdown: str) -> str:
    digest = hashlib.sha1(f"{page_id}|{run_id}|{content_markdown}".encode("utf-8")).hexdigest()[:12]
    return f"wrev_{digest}"


def build_wiki_source_id(*, page_id: str, document_id: str, source_sentence: str, evidence_text: str) -> str:
    digest = hashlib.sha1(
        f"{page_id}|{document_id}|{source_sentence}|{evidence_text}".encode("utf-8")
    ).hexdigest()[:12]
    return f"wsrc_{digest}"


def build_wiki_step_id(
    *,
    run_id: str,
    page_id: str,
    action_name: str,
    action_input_json: dict[str, Any],
    observation_json: dict[str, Any],
) -> str:
    payload = json.dumps(
        {
            "run_id": run_id,
            "page_id": page_id,
            "action_name": action_name,
            "action_input_json": action_input_json,
            "observation_json": observation_json,
        },
        ensure_ascii=False,
        sort_keys=True,
    )
    digest = hashlib.sha1(payload.encode("utf-8")).hexdigest()[:12]
    return f"wstep_{digest}"


def build_version_id(run_id: str, version_number: int) -> str:
    digest = hashlib.sha1(f"{run_id}|{version_number}".encode("utf-8")).hexdigest()[:12]
    return f"ver_{version_number}_{digest}"


def build_document_id(source_path: str, content_hash: str) -> str:
    digest = hashlib.sha1(f"{source_path}|{content_hash}".encode("utf-8")).hexdigest()[:12]
    return f"doc_{digest}"


def build_classification_id(canonical_id: str, signature: str) -> str:
    digest = hashlib.sha1(f"{canonical_id}|{signature}".encode("utf-8")).hexdigest()[:12]
    return f"cls_{digest}"


def build_change_event_id(run_id: str, object_type: str, object_id: str, detail: str) -> str:
    digest = hashlib.sha1(f"{run_id}|{object_type}|{object_id}|{detail}".encode("utf-8")).hexdigest()[:12]
    return f"evt_{digest}"


def build_evidence_signature(*, normalized_key: str, relation_signatures: list[str]) -> str:
    payload = json.dumps(
        {"normalized_key": normalized_key, "relation_signatures": sorted(set(relation_signatures))},
        ensure_ascii=False,
        sort_keys=True,
    )
    return hashlib.sha1(payload.encode("utf-8")).hexdigest()


def normalize_alias(value: str) -> str:
    return " ".join(str(value).strip().lower().split())


def _json_load_list(value: str) -> list[str]:
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return []
    if not isinstance(parsed, list):
        return []
    return [str(item) for item in parsed if str(item).strip()]


def _text_similarity(left: str, right: str) -> float:
    if not left or not right:
        return 0.0
    if left == right:
        return 1.0
    if left in right or right in left:
        return min(len(left), len(right)) / max(len(left), len(right))
    matches = sum(1 for a, b in zip(left, right) if a == b)
    return matches / max(len(left), len(right))


def _graphml_data(parent: ET.Element, key: str, value: str) -> None:
    data = ET.SubElement(parent, "data", key=key)
    data.text = value
