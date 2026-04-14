from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import uuid
from pathlib import Path

import pytest

pytestmark = pytest.mark.skipif(sys.version_info[:2] < (3, 10), reason="AFT QA CLI tests require Python 3.10+")

if sys.version_info[:2] >= (3, 10):
    from typer.testing import CliRunner

    from ontology_audit_hub.domain.audit.models import QuestionAnswerResponse
    from ontology_audit_hub.domain.documents.models import DocumentChunk, KnowledgeUploadConfig, KnowledgeUploadResponse
    from ontology_audit_hub.infra.lexical_index import SqliteLexicalIndex
    from ontology_audit_hub.infra.retrieval import QdrantRetriever
    from ontology_audit_hub.infra.settings import AuditHubSettings
    from ontology_audit_hub.qa_cli import app

    runner = CliRunner()
else:  # pragma: no cover - test module placeholders for skipped environments
    QuestionAnswerResponse = None
    DocumentChunk = None
    KnowledgeUploadConfig = None
    KnowledgeUploadResponse = None
    SqliteLexicalIndex = None
    QdrantRetriever = None
    AuditHubSettings = None
    app = None
    runner = None


@pytest.fixture
def tmp_path() -> Path:
    base = Path(__file__).resolve().parent / ".tmp"
    base.mkdir(exist_ok=True)
    created = base / f"qa_cli_{uuid.uuid4().hex}"
    created.mkdir()
    try:
        yield created
    finally:
        shutil.rmtree(created, ignore_errors=True)


def _set_qa_env(
    monkeypatch,
    tmp_path: Path,
    *,
    qdrant_enabled: bool = True,
    llm_enabled: bool = True,
) -> None:
    monkeypatch.setenv("ONTOLOGY_AUDIT_RUN_ROOT", str(tmp_path / "runs"))
    monkeypatch.setenv("ONTOLOGY_AUDIT_CHECKPOINT_PATH", str(tmp_path / "checkpoints.sqlite3"))
    monkeypatch.setenv("ONTOLOGY_AUDIT_QDRANT_ENABLED", "true" if qdrant_enabled else "false")
    monkeypatch.setenv("ONTOLOGY_AUDIT_QDRANT_MODE", "embedded")
    monkeypatch.setenv("ONTOLOGY_AUDIT_QDRANT_PATH", str(tmp_path / "qdrant"))
    monkeypatch.setenv("ONTOLOGY_AUDIT_QDRANT_COLLECTION", "qa_cli_collection")
    monkeypatch.setenv("ONTOLOGY_AUDIT_RAG_LEXICAL_DB_PATH", str(tmp_path / "lexical" / "index.sqlite3"))
    monkeypatch.setenv("ONTOLOGY_AUDIT_LLM_ENABLED", "true" if llm_enabled else "false")
    monkeypatch.setenv("ONTOLOGY_AUDIT_LLM_MODEL", "openai:gpt-4o-mini" if llm_enabled else "")
    monkeypatch.setenv("ONTOLOGY_AUDIT_NEO4J_ENABLED", "false")


def test_qa_cli_answer_accepts_request_file(monkeypatch, tmp_path: Path) -> None:
    _set_qa_env(monkeypatch, tmp_path)
    request_path = tmp_path / "qa.json"
    request_path.write_text(
        json.dumps(
            {
                "question": "What does Payment generate?",
                "session_id": "session-1",
                "request_id": "qa-1",
            }
        ),
        encoding="utf-8",
    )
    captured: dict[str, object] = {}

    class FakeQAService:
        def answer(self, request):
            captured["request"] = request
            return QuestionAnswerResponse(answer="Payment generates Invoice.")

        def close(self) -> None:
            captured["closed"] = True

    monkeypatch.setattr("ontology_audit_hub.qa_cli.QuestionAnswerService", lambda: FakeQAService())

    result = runner.invoke(app, ["answer", "--request-file", str(request_path)])

    assert result.exit_code == 0
    payload = json.loads(result.stdout)
    assert payload["answer"] == "Payment generates Invoice."
    assert captured["closed"] is True
    request = captured["request"]
    assert getattr(request, "session_id") == "session-1"


def test_qa_cli_answer_accepts_direct_arguments(monkeypatch, tmp_path: Path) -> None:
    _set_qa_env(monkeypatch, tmp_path)
    captured: dict[str, object] = {}

    class FakeQAService:
        def answer(self, request):
            captured["request"] = request
            return QuestionAnswerResponse(answer="Direct answer.")

        def close(self) -> None:
            return None

    monkeypatch.setattr("ontology_audit_hub.qa_cli.QuestionAnswerService", lambda: FakeQAService())

    result = runner.invoke(
        app,
        ["answer", "--question", "Explain Payment.", "--session-id", "chat-1", "--request-id", "req-1"],
    )

    assert result.exit_code == 0
    payload = json.loads(result.stdout)
    assert payload["answer"] == "Direct answer."
    request = captured["request"]
    assert getattr(request, "question") == "Explain Payment."
    assert getattr(request, "session_id") == "chat-1"


def test_qa_cli_upload_accepts_markdown_file(monkeypatch, tmp_path: Path) -> None:
    _set_qa_env(monkeypatch, tmp_path)
    document_path = tmp_path / "knowledge.md"
    document_path.write_text("# Overview\nPayment approvals require tokens.\n", encoding="utf-8")
    captured: dict[str, object] = {}

    class FakeKnowledgeService:
        def __init__(self) -> None:
            self.settings = AuditHubSettings(
                qdrant_upload_chunk_size=240,
                qdrant_upload_overlap_size=60,
            )

        def default_upload_config(self) -> KnowledgeUploadConfig:
            return KnowledgeUploadConfig(
                chunk_strategy="semantic_token_v1",
                target_chunk_tokens=400,
                chunk_overlap_tokens=80,
                max_chunk_tokens=600,
                index_profile="semantic_token_v1",
            )

        def upload_document(self, *, filename, content, content_type, config):
            captured["filename"] = filename
            captured["content"] = content
            captured["content_type"] = content_type
            captured["config"] = config
            return KnowledgeUploadResponse(
                collection_name=config.collection_name or "qa_cli_collection",
                source_id=config.source_id or filename,
                filename=filename,
                content_type=content_type or "text/markdown",
                chunk_size=config.chunk_size,
                overlap_size=config.overlap_size,
                target_chunk_tokens=config.target_chunk_tokens,
                chunk_overlap_tokens=config.chunk_overlap_tokens,
                max_chunk_tokens=config.max_chunk_tokens,
                index_profile=config.index_profile or "semantic_token_v1",
                embedding_model="hash-32",
                embedding_dimensions=32,
                avg_chunk_tokens=12,
                heading_aware=True,
                section_count=1,
                chunk_count=1,
                total_characters=len(content.decode("utf-8")),
                replaced_existing_chunks=False,
                sample_sections=["Overview"],
            )

    monkeypatch.setattr("ontology_audit_hub.qa_cli.KnowledgeUploadService", lambda: FakeKnowledgeService())

    result = runner.invoke(app, ["upload", "--file", str(document_path)])

    assert result.exit_code == 0
    payload = json.loads(result.stdout)
    assert payload["filename"] == "knowledge.md"
    assert payload["content_type"] == "text/markdown"
    config = captured["config"]
    assert getattr(config, "target_chunk_tokens") == 400
    assert getattr(config, "chunk_overlap_tokens") == 80
    assert getattr(config, "max_chunk_tokens") == 600


def test_qa_cli_upload_returns_structured_error_for_unsupported_file(monkeypatch, tmp_path: Path) -> None:
    _set_qa_env(monkeypatch, tmp_path)
    document_path = tmp_path / "knowledge.bin"
    document_path.write_bytes(b"\x00\x01unsupported")

    class FakeKnowledgeService:
        def __init__(self) -> None:
            self.settings = AuditHubSettings(
                qdrant_upload_chunk_size=240,
                qdrant_upload_overlap_size=60,
            )

        def default_upload_config(self) -> KnowledgeUploadConfig:
            return KnowledgeUploadConfig(
                chunk_strategy="semantic_token_v1",
                target_chunk_tokens=400,
                chunk_overlap_tokens=80,
                max_chunk_tokens=600,
                index_profile="semantic_token_v1",
            )

        def upload_document(self, *, filename, content, content_type, config):
            raise RuntimeError("Unsupported file type for knowledge upload.")

    monkeypatch.setattr("ontology_audit_hub.qa_cli.KnowledgeUploadService", lambda: FakeKnowledgeService())

    result = runner.invoke(app, ["upload", "--file", str(document_path)])

    assert result.exit_code == 1
    payload = json.loads(result.output)
    assert payload["status"] == "error"
    assert "Unsupported file type" in payload["message"]


def test_qa_cli_rebuild_lexical_index_backfills_embedded_collection(monkeypatch, tmp_path: Path) -> None:
    _set_qa_env(monkeypatch, tmp_path, qdrant_enabled=True, llm_enabled=False)
    settings = AuditHubSettings.from_env()
    retriever = QdrantRetriever(
        settings=settings,
        collection_name=settings.qdrant_collection_name,
        mode=settings.qdrant_mode,
        path=settings.qdrant_path,
    )
    try:
        retriever.upsert_chunks(
            [
                DocumentChunk(
                    source_file="knowledge.md",
                    section="Overview",
                    content="Payment approvals require a signed token.",
                    source_id="payments-doc",
                    chunk_index=0,
                    content_type="text/markdown",
                    token_count=8,
                    index_profile="semantic_token_v1",
                )
            ]
        )
    finally:
        retriever.close()

    result = runner.invoke(app, ["rebuild-lexical-index", "--collection", settings.qdrant_collection_name])

    assert result.exit_code == 0
    payload = json.loads(result.stdout)
    assert payload["status"] == "ok"
    assert payload["chunk_count"] == 1
    lexical_index = SqliteLexicalIndex(settings.rag_lexical_db_path)
    try:
        hits = lexical_index.search(settings.qdrant_collection_name, "signed", limit=5)
        assert hits
        assert hits[0].source_file == "knowledge.md"
    finally:
        lexical_index.close()


def test_qa_cli_doctor_reports_ready_and_not_ready(monkeypatch, tmp_path: Path) -> None:
    _set_qa_env(monkeypatch, tmp_path, qdrant_enabled=True, llm_enabled=True)
    monkeypatch.setattr("ontology_audit_hub.qa_cli._build_llm_adapter", lambda settings: object())
    monkeypatch.setattr("ontology_audit_hub.qa_cli._llm_ready", lambda adapter: (True, "ready"))

    ready_result = runner.invoke(app, ["doctor"])

    assert ready_result.exit_code == 0
    ready_payload = json.loads(ready_result.stdout)
    assert ready_payload["ready"] is True
    assert ready_payload["readiness"]["rag"]["status"] == "ready"

    _set_qa_env(monkeypatch, tmp_path / "degraded", qdrant_enabled=False, llm_enabled=True)
    monkeypatch.setattr("ontology_audit_hub.qa_cli._build_llm_adapter", lambda settings: object())
    monkeypatch.setattr("ontology_audit_hub.qa_cli._llm_ready", lambda adapter: (False, "missing credentials"))

    not_ready_result = runner.invoke(app, ["doctor"])

    assert not_ready_result.exit_code == 1
    not_ready_payload = json.loads(not_ready_result.stdout)
    assert not_ready_payload["ready"] is False
    assert not_ready_payload["readiness"]["rag"]["status"] == "disabled"
    assert not_ready_payload["readiness"]["llm"]["status"] == "not_ready"


def test_qa_cli_module_help_smoke() -> None:
    aft_root = Path(__file__).resolve().parents[2]
    env = os.environ.copy()
    env["PYTHONPATH"] = os.pathsep.join(
        [str(aft_root / "src"), env["PYTHONPATH"]]
    ) if env.get("PYTHONPATH") else str(aft_root / "src")

    result = subprocess.run(
        [sys.executable, "-m", "ontology_audit_hub.qa_cli", "--help"],
        cwd=str(aft_root),
        capture_output=True,
        text=True,
        env=env,
        check=False,
    )

    assert result.returncode == 0
    assert "answer" in result.stdout
