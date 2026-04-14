from __future__ import annotations

from pathlib import Path

import typer

from ontology_audit_hub._cli_support import emit_json, exit_with_error, read_json_file
from ontology_audit_hub.domain.review.models import GitHubReviewRequest
from ontology_audit_hub.github_review_service import GitHubReviewService, _build_llm_adapter, _llm_ready
from ontology_audit_hub.infra.settings import AuditHubSettings

app = typer.Typer(help="GitHub review CLI for Ontology Audit Hub.")


@app.callback()
def review_cli() -> None:
    """GitHub review CLI for Ontology Audit Hub."""


@app.command("github")
def github(
    request_file: Path | None = typer.Option(
        None,
        "--request-file",
        exists=True,
        dir_okay=False,
        readable=True,
        help="Path to a JSON GitHub review request.",
    ),
    repository_url: str | None = typer.Option(None, "--repository-url", help="GitHub repository URL."),
    ref: str | None = typer.Option(None, "--ref", help="Git reference to review."),
    path: list[str] | None = typer.Option(None, "--path", help="Repository-relative path to include."),
    request_id: str | None = typer.Option(None, "--request-id", help="Optional request identifier."),
) -> None:
    """Run a GitHub code review request and print the report as JSON."""
    service = None
    try:
        service = GitHubReviewService()
        payload = _review_payload(
            request_file=request_file,
            repository_url=repository_url,
            ref=ref,
            paths=path or [],
            request_id=request_id,
        )
        request = GitHubReviewRequest.model_validate(payload)
        result = service.review(request)
        emit_json(result.model_dump(mode="json"))
    except Exception as exc:
        exit_with_error(exc)
    finally:
        if service is not None:
            service.close()


@app.command("doctor")
def doctor() -> None:
    """Inspect review runtime readiness."""
    try:
        settings = AuditHubSettings.from_env()
        adapter = _build_llm_adapter(settings)
        ready, detail = _llm_ready(adapter)
        component_status = _status_for_component(enabled=settings.llm_enabled, ready=ready)
        payload = {
            "status": "ready" if component_status == "ready" else "not_ready",
            "ready": component_status == "ready",
            "settings": {
                "run_root": str(settings.run_root),
                "llm_enabled": settings.llm_enabled,
                "llm_provider": settings.llm_provider,
                "llm_model": settings.llm_model,
                "backend_timeout_seconds": settings.backend_timeout_seconds,
                "github_review_max_candidates": settings.github_review_max_candidates,
                "github_review_max_scope_files": settings.github_review_max_scope_files,
                "github_review_max_focus_files": settings.github_review_max_focus_files,
                "github_review_download_timeout_seconds": settings.github_review_download_timeout_seconds,
            },
            "readiness": {
                "llm": {
                    "enabled": settings.llm_enabled,
                    "ready": ready,
                    "status": component_status,
                    "detail": detail if settings.llm_enabled else "LLM review is disabled by configuration.",
                }
            },
        }
        emit_json(payload)
        if not payload["ready"]:
            raise typer.Exit(code=1)
    except typer.Exit:
        raise
    except Exception as exc:
        exit_with_error(exc)


def _review_payload(
    *,
    request_file: Path | None,
    repository_url: str | None,
    ref: str | None,
    paths: list[str],
    request_id: str | None,
) -> dict:
    has_direct_args = any([repository_url, ref, paths, request_id])
    if request_file is not None:
        if has_direct_args:
            raise ValueError("Use either --request-file or direct review options, not both.")
        return read_json_file(request_file)
    if not repository_url or not ref or not paths:
        raise ValueError("Direct mode requires --repository-url, --ref, and at least one --path.")
    return {
        "repository_url": repository_url,
        "ref": ref,
        "paths": paths,
        "request_id": request_id,
    }


def _status_for_component(*, enabled: bool, ready: bool) -> str:
    if not enabled:
        return "disabled"
    return "ready" if ready else "not_ready"


def main() -> None:
    app()


if __name__ == "__main__":
    main()
