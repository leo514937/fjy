from __future__ import annotations

from pathlib import Path
from typing import Any

import typer
from qdrant_client import QdrantClient

from ontology_audit_hub._cli_support import (
    emit_json,
    exit_with_error,
    guess_content_type,
    read_json_file,
)
from ontology_audit_hub.domain.audit.models import QuestionAnswerRequest
from ontology_audit_hub.domain.documents.models import DocumentChunk, KnowledgeUploadConfig
from ontology_audit_hub.infra.lexical_index import SqliteLexicalIndex
from ontology_audit_hub.infra.settings import AuditHubSettings
from ontology_audit_hub.knowledge_service import KnowledgeUploadService
from ontology_audit_hub.qa_service import QuestionAnswerService, _build_llm_adapter, _llm_ready

app = typer.Typer(help="QA and knowledge maintenance CLI for Ontology Audit Hub.")


@app.callback()
def qa_cli() -> None:
    """QA and knowledge maintenance CLI for Ontology Audit Hub."""


@app.command("answer")
def answer(
    request_file: Path | None = typer.Option(
        None,
        "--request-file",
        exists=True,
        dir_okay=False,
        readable=True,
        help="Path to a JSON QA request.",
    ),
    question: str | None = typer.Option(None, "--question", help="Question to answer."),
    session_id: str | None = typer.Option(None, "--session-id", help="Optional QA session identifier."),
    request_id: str | None = typer.Option(None, "--request-id", help="Optional request identifier."),
) -> None:
    """Answer a question and print the response as JSON."""
    service = None
    try:
        service = QuestionAnswerService()
        payload = _qa_payload(
            request_file=request_file,
            question=question,
            session_id=session_id,
            request_id=request_id,
        )
        request = QuestionAnswerRequest.model_validate(payload)
        result = service.answer(request)
        emit_json(result.model_dump(mode="json"))
    except Exception as exc:
        exit_with_error(exc)
    finally:
        if service is not None:
            service.close()


@app.command("upload")
def upload(
    file: Path = typer.Option(
        ...,
        "--file",
        dir_okay=False,
        help="Document file to upload into the knowledge store.",
    ),
    collection: str | None = typer.Option(None, "--collection", help="Target collection name."),
    source_id: str | None = typer.Option(None, "--source-id", help="Stable source identifier."),
    chunk_size: int | None = typer.Option(None, "--chunk-size", min=200),
    overlap_size: int | None = typer.Option(None, "--overlap-size", min=0),
    chunk_strategy: str | None = typer.Option(None, "--chunk-strategy"),
    target_chunk_tokens: int | None = typer.Option(None, "--target-chunk-tokens", min=100),
    chunk_overlap_tokens: int | None = typer.Option(None, "--chunk-overlap-tokens", min=0),
    max_chunk_tokens: int | None = typer.Option(None, "--max-chunk-tokens", min=100),
    language: str | None = typer.Option(None, "--language"),
    index_profile: str | None = typer.Option(None, "--index-profile"),
    version: str = typer.Option("uploaded", "--version"),
    status: str = typer.Option("active", "--status"),
) -> None:
    """Upload a local document into the knowledge store and print metrics as JSON."""
    service = None
    try:
        service = KnowledgeUploadService()
        if not file.is_file():
            raise FileNotFoundError(f"File does not exist: {file}")
        defaults = service.default_upload_config()
        config_payload = _upload_config_payload(
            defaults=defaults,
            service=service,
            collection=collection,
            source_id=source_id,
            chunk_size=chunk_size,
            overlap_size=overlap_size,
            chunk_strategy=chunk_strategy,
            target_chunk_tokens=target_chunk_tokens,
            chunk_overlap_tokens=chunk_overlap_tokens,
            max_chunk_tokens=max_chunk_tokens,
            language=language,
            index_profile=index_profile,
            version=version,
            status=status,
        )
        config = KnowledgeUploadConfig.model_validate(config_payload)
        result = service.upload_document(
            filename=file.name,
            content=file.read_bytes(),
            content_type=guess_content_type(file),
            config=config,
        )
        emit_json(result.model_dump(mode="json"))
    except Exception as exc:
        exit_with_error(exc)
    finally:
        if service is not None:
            close = getattr(service, "close", None)
            if callable(close):
                close()


@app.command("rebuild-lexical-index")
def rebuild_lexical_index(
    collection: str | None = typer.Option(None, "--collection"),
    batch_size: int = typer.Option(128, "--batch-size", min=1, max=1000),
) -> None:
    """Backfill the lexical sidecar index from the existing Qdrant collection."""
    settings = AuditHubSettings.from_env()
    collection_name = collection or settings.qdrant_collection_name
    lexical_index = SqliteLexicalIndex(settings.rag_lexical_db_path)
    client = _build_qdrant_client(settings)
    next_offset = None
    total_chunks = 0
    total_batches = 0
    try:
        lexical_index.delete_collection_chunks(collection_name)
        while True:
            points, next_offset = client.scroll(
                collection_name=collection_name,
                with_payload=True,
                with_vectors=False,
                limit=batch_size,
                offset=next_offset,
            )
            if not points:
                break
            chunks = [_chunk_from_payload(point.payload or {}) for point in points if point.payload]
            if chunks:
                lexical_index.upsert_chunks(collection_name, chunks)
                total_chunks += len(chunks)
                total_batches += 1
            if next_offset is None:
                break
        emit_json(
            {
                "status": "ok",
                "collection_name": collection_name,
                "lexical_db_path": str(settings.rag_lexical_db_path),
                "batch_count": total_batches,
                "chunk_count": total_chunks,
            }
        )
    except Exception as exc:
        exit_with_error(exc)
    finally:
        close = getattr(client, "close", None)
        if callable(close):
            close()
        lexical_index.close()


@app.command("doctor")
def doctor() -> None:
    """Inspect QA and knowledge runtime readiness."""
    try:
        settings = AuditHubSettings.from_env()
        adapter = _build_llm_adapter(settings)
        llm_ready, llm_detail = _llm_ready(adapter)
        rag_component = _rag_readiness(settings)
        graph_component = _graph_readiness(settings)
        lexical_component = _lexical_readiness(settings)
        llm_component = {
            "enabled": settings.llm_enabled,
            "ready": llm_ready,
            "status": _status_for_component(enabled=settings.llm_enabled, ready=llm_ready),
            "detail": llm_detail if settings.llm_enabled else "LLM QA is disabled by configuration.",
        }
        readiness = {
            "llm": llm_component,
            "rag": rag_component,
            "graph": graph_component,
            "lexical_index": lexical_component,
        }
        overall_ready = (
            llm_component["status"] == "ready"
            and rag_component["status"] == "ready"
            and lexical_component["status"] == "ready"
        )
        payload = {
            "status": "ready" if overall_ready else "not_ready",
            "ready": overall_ready,
            "settings": {
                "run_root": str(settings.run_root),
                "qdrant_enabled": settings.qdrant_enabled,
                "qdrant_mode": settings.qdrant_mode,
                "qdrant_url": settings.qdrant_url,
                "qdrant_path": str(settings.qdrant_path),
                "qdrant_collection_name": settings.qdrant_collection_name,
                "rag_enable_graph_context": settings.rag_enable_graph_context,
                "rag_lexical_db_path": str(settings.rag_lexical_db_path),
                "neo4j_enabled": settings.neo4j_enabled,
                "neo4j_uri": settings.neo4j_uri,
                "llm_enabled": settings.llm_enabled,
                "llm_provider": settings.llm_provider,
                "llm_model": settings.llm_model,
            },
            "readiness": readiness,
        }
        emit_json(payload)
        if not overall_ready:
            raise typer.Exit(code=1)
    except typer.Exit:
        raise
    except Exception as exc:
        exit_with_error(exc)


def _qa_payload(
    *,
    request_file: Path | None,
    question: str | None,
    session_id: str | None,
    request_id: str | None,
) -> dict[str, Any]:
    has_direct_args = any([question, session_id, request_id])
    if request_file is not None:
        if has_direct_args:
            raise ValueError("Use either --request-file or direct QA options, not both.")
        return read_json_file(request_file)
    if not question:
        raise ValueError("Direct mode requires --question.")
    return {
        "question": question,
        "session_id": session_id,
        "request_id": request_id,
    }


def _upload_config_payload(
    *,
    defaults: KnowledgeUploadConfig,
    service: KnowledgeUploadService,
    collection: str | None,
    source_id: str | None,
    chunk_size: int | None,
    overlap_size: int | None,
    chunk_strategy: str | None,
    target_chunk_tokens: int | None,
    chunk_overlap_tokens: int | None,
    max_chunk_tokens: int | None,
    language: str | None,
    index_profile: str | None,
    version: str,
    status: str,
) -> dict[str, Any]:
    payload = defaults.model_dump(mode="python")
    payload.update(
        {
            "collection_name": collection,
            "source_id": source_id,
            "language": language,
            "version": version,
            "status": status,
        }
    )
    if chunk_strategy == "legacy_char_window" or chunk_size is not None or overlap_size is not None:
        payload.update(
            {
                "chunk_strategy": chunk_strategy or "legacy_char_window",
                "chunk_size": chunk_size if chunk_size is not None else service.settings.qdrant_upload_chunk_size,
                "overlap_size": overlap_size if overlap_size is not None else service.settings.qdrant_upload_overlap_size,
            }
        )
    else:
        payload.update(
            {
                "chunk_strategy": chunk_strategy or payload.get("chunk_strategy"),
                "target_chunk_tokens": (
                    target_chunk_tokens if target_chunk_tokens is not None else payload.get("target_chunk_tokens")
                ),
                "chunk_overlap_tokens": (
                    chunk_overlap_tokens
                    if chunk_overlap_tokens is not None
                    else payload.get("chunk_overlap_tokens")
                ),
                "max_chunk_tokens": max_chunk_tokens if max_chunk_tokens is not None else payload.get("max_chunk_tokens"),
            }
        )
    if index_profile is not None:
        payload["index_profile"] = index_profile
    return payload


def _rag_readiness(settings: AuditHubSettings) -> dict[str, Any]:
    if not settings.qdrant_enabled:
        return {
            "enabled": False,
            "ready": False,
            "status": "disabled",
            "detail": "Default RAG source is disabled by configuration.",
            "mode": settings.qdrant_mode,
        }
    if settings.qdrant_mode == "server" and not settings.qdrant_url:
        return {
            "enabled": True,
            "ready": False,
            "status": "not_ready",
            "detail": "Qdrant server mode requires ONTOLOGY_AUDIT_QDRANT_URL.",
            "mode": settings.qdrant_mode,
        }
    detail = (
        f"Default RAG source will use collection '{settings.qdrant_collection_name}'."
        if settings.qdrant_mode == "server"
        else f"Default RAG source will use embedded Qdrant at {settings.qdrant_path}."
    )
    return {
        "enabled": True,
        "ready": True,
        "status": "ready",
        "detail": detail,
        "mode": settings.qdrant_mode,
        "collection_name": settings.qdrant_collection_name,
    }


def _graph_readiness(settings: AuditHubSettings) -> dict[str, Any]:
    if not settings.neo4j_enabled:
        return {
            "enabled": False,
            "ready": False,
            "status": "disabled",
            "detail": "Default graph source is disabled by configuration.",
        }
    ready = bool(settings.neo4j_uri and settings.neo4j_username and settings.neo4j_password)
    return {
        "enabled": True,
        "ready": ready,
        "status": "ready" if ready else "not_ready",
        "detail": (
            f"Default graph source will use {settings.neo4j_uri}."
            if ready
            else "Neo4j requires URI, username, and password."
        ),
    }


def _lexical_readiness(settings: AuditHubSettings) -> dict[str, Any]:
    if not settings.qdrant_enabled:
        return {
            "enabled": False,
            "ready": False,
            "status": "disabled",
            "detail": "Lexical index maintenance is disabled because Qdrant is disabled.",
            "path": str(settings.rag_lexical_db_path),
        }
    return {
        "enabled": True,
        "ready": True,
        "status": "ready",
        "detail": f"Lexical index path is {settings.rag_lexical_db_path}.",
        "path": str(settings.rag_lexical_db_path),
    }


def _status_for_component(*, enabled: bool, ready: bool) -> str:
    if not enabled:
        return "disabled"
    return "ready" if ready else "not_ready"


def _build_qdrant_client(settings: AuditHubSettings) -> QdrantClient:
    if settings.qdrant_mode == "server":
        if not settings.qdrant_url:
            raise RuntimeError("Qdrant server mode requires ONTOLOGY_AUDIT_QDRANT_URL.")
        return QdrantClient(
            url=settings.qdrant_url,
            api_key=settings.qdrant_api_key,
            timeout=int(settings.backend_timeout_seconds),
        )
    return QdrantClient(path=str(settings.qdrant_path))


def _chunk_from_payload(payload: dict[str, Any]) -> DocumentChunk:
    return DocumentChunk(
        source_file=str(payload.get("source_file", "")),
        section=str(payload.get("section", "")),
        content=str(payload.get("content", "")),
        ontology_tags=list(payload.get("ontology_tags", [])),
        version=str(payload.get("version", "unknown")),
        status=str(payload.get("status", "unknown")),
        source_id=str(payload.get("source_id", "")) or None,
        chunk_index=int(payload["chunk_index"]) if payload.get("chunk_index") is not None else None,
        content_length=int(payload["content_length"]) if payload.get("content_length") is not None else None,
        filename=str(payload.get("filename", "")) or None,
        content_type=str(payload.get("content_type", "")) or None,
        chunk_size=int(payload["chunk_size"]) if payload.get("chunk_size") is not None else None,
        overlap_size=int(payload["overlap_size"]) if payload.get("overlap_size") is not None else None,
        heading_path=list(payload.get("heading_path", [])),
        section_ordinal=int(payload["section_ordinal"]) if payload.get("section_ordinal") is not None else None,
        chunk_ordinal=int(payload["chunk_ordinal"]) if payload.get("chunk_ordinal") is not None else None,
        token_count=int(payload["token_count"]) if payload.get("token_count") is not None else None,
        embedding_model=str(payload.get("embedding_model", "")) or None,
        embedding_dimensions=int(payload["embedding_dimensions"]) if payload.get("embedding_dimensions") is not None else None,
        index_profile=str(payload.get("index_profile", "")) or None,
        content_sha256=str(payload.get("content_sha256", "")) or None,
    )


def main() -> None:
    app()


if __name__ == "__main__":
    main()
