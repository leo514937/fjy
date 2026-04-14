from __future__ import annotations

import json
import mimetypes
from pathlib import Path
from typing import Any

import typer


def read_json_file(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"Expected a JSON object in {path}.")
    return payload


def emit_json(payload: Any) -> None:
    typer.echo(json.dumps(payload, indent=2, ensure_ascii=False))


def _error_payload(exc: Exception) -> Any:
    payload = getattr(exc, "payload", None)
    if payload is not None:
        model_dump = getattr(payload, "model_dump", None)
        if callable(model_dump):
            return model_dump(mode="json")
        if isinstance(payload, dict):
            return payload

    error_payload: dict[str, Any] = {
        "status": "error",
        "message": str(exc),
    }
    errors = getattr(exc, "errors", None)
    if callable(errors):
        try:
            error_payload["errors"] = json.loads(json.dumps(errors(), ensure_ascii=False, default=str))
        except Exception:
            pass
    status_code = getattr(exc, "status_code", None)
    if isinstance(status_code, int):
        error_payload["status_code"] = status_code
    return error_payload


def emit_error(exc: Exception) -> None:
    typer.echo(json.dumps(_error_payload(exc), indent=2, ensure_ascii=False), err=True)


def exit_with_error(exc: Exception) -> None:
    emit_error(exc)
    raise typer.Exit(code=1) from exc


def guess_content_type(path: Path) -> str | None:
    guessed, _ = mimetypes.guess_type(str(path))
    return guessed
