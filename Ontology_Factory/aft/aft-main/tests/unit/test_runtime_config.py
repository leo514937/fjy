from pathlib import Path

from ontology_audit_hub.infra.graph_augmenter import NullGraphAugmenter
from ontology_audit_hub.infra.retrieval import NullRetriever, QdrantRetriever
from ontology_audit_hub.infra.runtime import GraphRuntime
from ontology_audit_hub.infra.settings import AuditHubSettings
from ontology_audit_hub.service import SupervisorService, build_default_runtime


def test_build_default_runtime_records_llm_diagnostic_when_model_is_missing() -> None:
    runtime = build_default_runtime(
        settings=AuditHubSettings(
            qdrant_enabled=False,
            llm_enabled=True,
            llm_model=None,
            neo4j_enabled=False,
        ),
        interrupt_on_human=False,
    )

    finding_types = {finding.finding_type for finding in runtime.diagnostic_findings}

    assert "llm_adapter_unavailable" in finding_types


def test_settings_from_env_supports_server_qdrant_mode(monkeypatch) -> None:
    monkeypatch.setenv("ONTOLOGY_AUDIT_RUN_ROOT", "custom-runs")
    monkeypatch.setenv("ONTOLOGY_AUDIT_QDRANT_MODE", "server")
    monkeypatch.setenv("ONTOLOGY_AUDIT_QDRANT_URL", "http://qdrant:6333")
    monkeypatch.setenv("ONTOLOGY_AUDIT_QDRANT_API_KEY", "secret")
    monkeypatch.setenv("ONTOLOGY_AUDIT_QDRANT_UPLOAD_CHUNK_SIZE", "1200")
    monkeypatch.setenv("ONTOLOGY_AUDIT_QDRANT_UPLOAD_OVERLAP_SIZE", "240")
    monkeypatch.setenv("ONTOLOGY_AUDIT_RAG_EMBEDDING_PROVIDER", "openai")
    monkeypatch.setenv("ONTOLOGY_AUDIT_RAG_EMBEDDING_MODEL", "openai/text-embedding-3-small")
    monkeypatch.setenv("ONTOLOGY_AUDIT_RAG_EMBEDDING_DIMENSIONS", "1536")
    monkeypatch.setenv("ONTOLOGY_AUDIT_RAG_EMBEDDING_API_KEY", "embedding-key")
    monkeypatch.setenv("ONTOLOGY_AUDIT_RAG_EMBEDDING_BASE_URL", "https://api.openai.com/v1")
    monkeypatch.setenv("ONTOLOGY_AUDIT_RAG_CHUNK_TOKENS", "420")
    monkeypatch.setenv("ONTOLOGY_AUDIT_RAG_CHUNK_OVERLAP_TOKENS", "90")
    monkeypatch.setenv("ONTOLOGY_AUDIT_RAG_MAX_CHUNK_TOKENS", "640")
    monkeypatch.setenv("ONTOLOGY_AUDIT_RAG_CANDIDATE_POOL", "32")
    monkeypatch.setenv("ONTOLOGY_AUDIT_RAG_TOP_K", "6")
    monkeypatch.setenv("ONTOLOGY_AUDIT_RAG_MAX_CONTEXT_CHUNKS", "4")
    monkeypatch.setenv("ONTOLOGY_AUDIT_RAG_ENABLE_GRAPH_CONTEXT", "false")
    monkeypatch.setenv("OPENAI_API_KEY", "fallback-key")
    monkeypatch.setenv("OPENAI_BASE_URL", "https://fallback.example/v1")
    monkeypatch.setenv("ONTOLOGY_AUDIT_BACKEND_TIMEOUT_SECONDS", "12.5")

    settings = AuditHubSettings.from_env()

    assert settings.run_root == Path("custom-runs")
    assert settings.qdrant_mode == "server"
    assert settings.qdrant_url == "http://qdrant:6333"
    assert settings.qdrant_api_key == "secret"
    assert settings.qdrant_upload_chunk_size == 1200
    assert settings.qdrant_upload_overlap_size == 240
    assert settings.rag_embedding_provider == "openai"
    assert settings.rag_embedding_model == "openai/text-embedding-3-small"
    assert settings.rag_embedding_dimensions == 1536
    assert settings.rag_embedding_api_key == "embedding-key"
    assert settings.rag_embedding_base_url == "https://api.openai.com/v1"
    assert settings.rag_chunk_tokens == 420
    assert settings.rag_chunk_overlap_tokens == 90
    assert settings.rag_max_chunk_tokens == 640
    assert settings.rag_candidate_pool == 32
    assert settings.rag_top_k == 6
    assert settings.rag_max_context_chunks == 4
    assert settings.rag_enable_graph_context is False
    assert settings.backend_timeout_seconds == 12.5


def test_settings_from_env_expands_embedded_env_placeholders(monkeypatch) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "real-openai-key")
    monkeypatch.delenv("ONTOLOGY_AUDIT_RAG_EMBEDDING_API_KEY", raising=False)
    monkeypatch.setenv("ONTOLOGY_AUDIT_RAG_EMBEDDING_BASE_URL", "https://openrouter.ai/api/v1")

    original_loader = AuditHubSettings.from_env.__func__.__globals__["_load_dotenv_file"]

    def fake_loader() -> None:
        import os

        if "ONTOLOGY_AUDIT_RAG_EMBEDDING_API_KEY" not in os.environ:
            os.environ["ONTOLOGY_AUDIT_RAG_EMBEDDING_API_KEY"] = "${OPENAI_API_KEY}"

    monkeypatch.setitem(AuditHubSettings.from_env.__func__.__globals__, "_load_dotenv_file", fake_loader)
    try:
        settings = AuditHubSettings.from_env()
    finally:
        monkeypatch.setitem(AuditHubSettings.from_env.__func__.__globals__, "_load_dotenv_file", original_loader)

    assert settings.rag_embedding_api_key == "real-openai-key"


def test_supervisor_service_doctor_reports_session_scoped_artifacts(tmp_path: Path) -> None:
    settings = AuditHubSettings(
        run_root=tmp_path / "runs",
        checkpoint_path=tmp_path / "checkpoints.sqlite3",
        qdrant_enabled=False,
        neo4j_enabled=False,
        llm_enabled=False,
    )
    service = SupervisorService(
        settings=settings,
        runtime=GraphRuntime(
            retriever=NullRetriever(),
            graph_augmenter=NullGraphAugmenter(),
            interrupt_on_human=False,
        ),
    )

    payload = service.doctor()

    assert payload["ready"] is True
    generated_path = Path(payload["artifact_layout"]["generated_tests_dir"])
    assert generated_path.parts[-2:] == ("example-session", "generated_tests")
    error_path = Path(payload["artifact_layout"]["error_snapshot"])
    assert error_path.parts[-2:] == ("example-session", "error.json")


def test_supervisor_service_scopes_qdrant_collection_by_session(tmp_path: Path) -> None:
    settings = AuditHubSettings(
        run_root=tmp_path / "runs",
        checkpoint_path=tmp_path / "checkpoints.sqlite3",
        qdrant_enabled=True,
        qdrant_path=tmp_path / "qdrant",
        neo4j_enabled=False,
        llm_enabled=False,
    )
    service = SupervisorService(
        settings=settings,
        runtime=GraphRuntime(
            retriever=QdrantRetriever(path=tmp_path / "qdrant"),
            graph_augmenter=NullGraphAugmenter(),
            interrupt_on_human=False,
        ),
    )

    first_runtime = service._runtime_for_session("session-a")
    second_runtime = service._runtime_for_session("session-b")

    assert first_runtime.retriever.backend_info()["collection_name"] != second_runtime.retriever.backend_info()[
        "collection_name"
    ]
