from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class CachedClassification(BaseModel):
    cache_key: str
    normalized_text: str
    ner_label: str
    ontology_result: dict[str, Any]


class IngestionRun(BaseModel):
    run_id: str
    mode: str
    input_root: str
    preprocess_config: str = ""
    pipeline_config: str = ""
    force_reingest: bool = False
    status: str = "running"
    documents_total: int = 0
    documents_processed: int = 0
    documents_skipped: int = 0
    manifest: dict[str, Any] = Field(default_factory=dict)


class DocumentRecord(BaseModel):
    document_id: str
    source_path: str
    doc_name: str
    content_hash: str
    clean_text_path: str = ""
    report_json: dict[str, Any] = Field(default_factory=dict)


class CanonicalEntity(BaseModel):
    canonical_id: str
    normalized_key: str
    normalized_text: str
    preferred_name: str
    ner_label: str
    mention_count: int = 0
    current_classification_id: str = ""
    evidence_summary: str = ""
    metadata: dict[str, Any] = Field(default_factory=dict)


class CanonicalRelation(BaseModel):
    canonical_relation_id: str
    relation_key: str
    source_canonical_id: str
    target_canonical_id: str
    relation_type: str
    confidence: float = 0.0
    mention_count: int = 0
    evidence_sentences: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


class EntityClassification(BaseModel):
    classification_id: str
    canonical_id: str
    ontology_label: str
    confidence: float = 0.0
    evidence_signature: str = ""
    result_json: dict[str, Any] = Field(default_factory=dict)
    source_run_id: str = ""
    source_reason: str = ""
    is_current: bool = False


class OntologyVersion(BaseModel):
    version_id: str
    run_id: str
    parent_version_id: str = ""
    version_number: int
    is_active: bool = True
    processed_documents: int = 0
    changed_entities: int = 0
    changed_relations: int = 0
    manifest: dict[str, Any] = Field(default_factory=dict)


class ChangeEvent(BaseModel):
    event_id: str
    version_id: str = ""
    run_id: str
    object_type: str
    object_id: str
    event_type: str
    reason: str = ""
    payload: dict[str, Any] = Field(default_factory=dict)


class GraphExportArtifacts(BaseModel):
    json_path: str
    graphml_path: str


class WikiPage(BaseModel):
    page_id: str
    slug: str
    title: str
    page_type: str
    layer: str = "domain"
    doc_ref: str = ""
    file_path: str = ""
    status: str = "active"
    current_revision_id: str = ""


class WikiRevision(BaseModel):
    revision_id: str
    page_id: str
    run_id: str
    content_markdown: str
    summary: str = ""
    reason: str = ""
    created_by: str = "wiki_agent"


class WikiLink(BaseModel):
    source_page_id: str
    target_page_id: str
    link_type: str = "related_to"
    anchor_text: str = ""


class WikiPageSource(BaseModel):
    page_id: str
    document_id: str
    source_sentence: str = ""
    evidence_text: str = ""


class WikiRun(BaseModel):
    run_id: str
    mode: str
    input_root: str
    status: str = "running"
    manifest: dict[str, Any] = Field(default_factory=dict)


class WikiAgentStep(BaseModel):
    step_id: str
    run_id: str
    page_id: str = ""
    thought: str = ""
    action_name: str
    action_input_json: dict[str, Any] = Field(default_factory=dict)
    observation_json: dict[str, Any] = Field(default_factory=dict)
