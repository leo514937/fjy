from __future__ import annotations

import json
from importlib import import_module
from pathlib import Path
from typing import Any, cast

import typer
from qdrant_client import QdrantClient

from ontology_audit_hub.domain.audit.models import AuditReport, AuditRequest, HumanDecision
from ontology_audit_hub.domain.documents.models import DocumentChunk
from ontology_audit_hub.infra.lexical_index import SqliteLexicalIndex
from ontology_audit_hub.infra.settings import AuditHubSettings
from ontology_audit_hub.service import HumanInterruptPayload, SupervisorService

yaml = cast(Any, import_module("yaml"))

app = typer.Typer(help="Ontology-driven QA audit hub CLI.")


@app.callback()
def main() -> None:
    """Ontology-driven QA audit hub CLI."""


@app.command("run")
def run(request: Path = typer.Option(..., exists=True, dir_okay=False, readable=True)) -> None:
    """Run the supervisor graph for a request YAML file."""
    service = SupervisorService()
    try:
        payload = yaml.safe_load(request.read_text(encoding="utf-8")) or {}
        audit_request = AuditRequest.model_validate(payload)
        result = service.run(audit_request)
        _echo_result(result)
    except Exception as exc:
        _echo_error(exc)
        raise typer.Exit(code=1) from exc
    finally:
        service.close()


@app.command("resume")
def resume(
    session_id: str = typer.Option(...),
    response: Path = typer.Option(..., exists=True, dir_okay=False, readable=True),
) -> None:
    """Resume an interrupted supervisor session with a human decision."""
    service = SupervisorService()
    try:
        payload = yaml.safe_load(response.read_text(encoding="utf-8")) or {}
        payload.setdefault("session_id", session_id)
        decision = HumanDecision.model_validate(payload)
        result = service.resume(decision)
        _echo_result(result)
    except Exception as exc:
        _echo_error(exc)
        raise typer.Exit(code=1) from exc
    finally:
        service.close()


@app.command("doctor")
def doctor() -> None:
    """Inspect runtime readiness and artifact layout."""
    service = SupervisorService()
    try:
        payload = service.doctor()
        typer.echo(json.dumps(payload, indent=2, ensure_ascii=False))
        if not payload["ready"]:
            raise typer.Exit(code=1)
    except typer.Exit:
        raise
    except Exception as exc:
        _echo_error(exc)
        raise typer.Exit(code=1) from exc
    finally:
        service.close()


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
        typer.echo(
            json.dumps(
                {
                    "status": "ok",
                    "collection_name": collection_name,
                    "lexical_db_path": str(settings.rag_lexical_db_path),
                    "batch_count": total_batches,
                    "chunk_count": total_chunks,
                },
                indent=2,
                ensure_ascii=False,
            )
        )
    except Exception as exc:
        _echo_error(exc)
        raise typer.Exit(code=1) from exc
    finally:
        close = getattr(client, "close", None)
        if callable(close):
            close()
        lexical_index.close()


def _echo_result(result: AuditReport | HumanInterruptPayload) -> None:
    if isinstance(result, AuditReport):
        typer.echo(json.dumps(result.model_dump(mode="json"), indent=2, ensure_ascii=False))
        return
    typer.echo(json.dumps(result.to_dict(), indent=2, ensure_ascii=False))


def _echo_error(exc: Exception) -> None:
    typer.echo(
        json.dumps(
            {
                "status": "error",
                "message": str(exc),
            },
            indent=2,
            ensure_ascii=False,
        )
    )


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


def _chunk_from_payload(payload: dict) -> DocumentChunk:
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


if __name__ == "__main__":
    app()
