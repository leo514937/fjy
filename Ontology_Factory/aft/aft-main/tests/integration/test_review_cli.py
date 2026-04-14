from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import uuid
from pathlib import Path

import pytest

pytestmark = pytest.mark.skipif(sys.version_info[:2] < (3, 10), reason="AFT review CLI tests require Python 3.10+")

if sys.version_info[:2] >= (3, 10):
    from typer.testing import CliRunner

    from ontology_audit_hub.domain.review.models import GitHubReviewResponse
    from ontology_audit_hub.review_cli import app

    runner = CliRunner()
else:  # pragma: no cover - test module placeholders for skipped environments
    GitHubReviewResponse = None
    app = None
    runner = None


@pytest.fixture
def tmp_path() -> Path:
    base = Path(__file__).resolve().parent / ".tmp"
    base.mkdir(exist_ok=True)
    created = base / f"review_cli_{uuid.uuid4().hex}"
    created.mkdir()
    try:
        yield created
    finally:
        shutil.rmtree(created, ignore_errors=True)


def _set_review_env(monkeypatch, tmp_path: Path, *, llm_enabled: bool = True) -> None:
    monkeypatch.setenv("ONTOLOGY_AUDIT_RUN_ROOT", str(tmp_path / "runs"))
    monkeypatch.setenv("ONTOLOGY_AUDIT_CHECKPOINT_PATH", str(tmp_path / "checkpoints.sqlite3"))
    monkeypatch.setenv("ONTOLOGY_AUDIT_LLM_ENABLED", "true" if llm_enabled else "false")
    monkeypatch.setenv("ONTOLOGY_AUDIT_LLM_MODEL", "openai:gpt-4o-mini" if llm_enabled else "")


def test_review_cli_github_accepts_request_file(monkeypatch, tmp_path: Path) -> None:
    _set_review_env(monkeypatch, tmp_path)
    request_path = tmp_path / "review.json"
    request_path.write_text(
        json.dumps(
            {
                "repository_url": "https://github.com/example/repo",
                "ref": "main",
                "paths": ["src/app.py"],
                "request_id": "review-1",
            }
        ),
        encoding="utf-8",
    )
    captured: dict[str, object] = {}

    class FakeReviewService:
        def review(self, request):
            captured["request"] = request
            return GitHubReviewResponse(
                summary="review ok",
                reviewed_files=request.paths,
                issues=[],
                warnings=[],
                next_steps=["follow up"],
            )

        def close(self) -> None:
            captured["closed"] = True

    monkeypatch.setattr("ontology_audit_hub.review_cli.GitHubReviewService", lambda: FakeReviewService())

    result = runner.invoke(app, ["github", "--request-file", str(request_path)])

    assert result.exit_code == 0
    payload = json.loads(result.stdout)
    assert payload["summary"] == "review ok"
    assert payload["reviewed_files"] == ["src/app.py"]
    assert captured["closed"] is True
    request = captured["request"]
    assert getattr(request, "repository_url") == "https://github.com/example/repo"
    assert getattr(request, "request_id") == "review-1"


def test_review_cli_github_accepts_direct_arguments(monkeypatch, tmp_path: Path) -> None:
    _set_review_env(monkeypatch, tmp_path)
    captured: dict[str, object] = {}

    class FakeReviewService:
        def review(self, request):
            captured["request"] = request
            return GitHubReviewResponse(
                summary="direct review ok",
                reviewed_files=request.paths,
                issues=[],
                warnings=[],
                next_steps=[],
            )

        def close(self) -> None:
            return None

    monkeypatch.setattr("ontology_audit_hub.review_cli.GitHubReviewService", lambda: FakeReviewService())

    result = runner.invoke(
        app,
        [
            "github",
            "--repository-url",
            "https://github.com/example/repo",
            "--ref",
            "release/v1",
            "--path",
            "src/app.py",
            "--path",
            "tests/test_app.py",
            "--request-id",
            "direct-1",
        ],
    )

    assert result.exit_code == 0
    payload = json.loads(result.stdout)
    assert payload["summary"] == "direct review ok"
    assert payload["reviewed_files"] == ["src/app.py", "tests/test_app.py"]
    request = captured["request"]
    assert getattr(request, "ref") == "release/v1"
    assert getattr(request, "paths") == ["src/app.py", "tests/test_app.py"]


def test_review_cli_doctor_reports_ready_and_not_ready(monkeypatch, tmp_path: Path) -> None:
    _set_review_env(monkeypatch, tmp_path)
    monkeypatch.setattr("ontology_audit_hub.review_cli._build_llm_adapter", lambda settings: object())
    monkeypatch.setattr("ontology_audit_hub.review_cli._llm_ready", lambda adapter: (True, "ready"))

    ready_result = runner.invoke(app, ["doctor"])

    assert ready_result.exit_code == 0
    ready_payload = json.loads(ready_result.stdout)
    assert ready_payload["ready"] is True
    assert ready_payload["readiness"]["llm"]["status"] == "ready"

    monkeypatch.setattr("ontology_audit_hub.review_cli._llm_ready", lambda adapter: (False, "missing credentials"))

    not_ready_result = runner.invoke(app, ["doctor"])

    assert not_ready_result.exit_code == 1
    not_ready_payload = json.loads(not_ready_result.stdout)
    assert not_ready_payload["ready"] is False
    assert not_ready_payload["readiness"]["llm"]["status"] == "not_ready"


def test_review_cli_github_returns_structured_error_for_invalid_repository(monkeypatch, tmp_path: Path) -> None:
    _set_review_env(monkeypatch, tmp_path)

    result = runner.invoke(
        app,
        [
            "github",
            "--repository-url",
            "https://example.com/not-github",
            "--ref",
            "main",
            "--path",
            "src/app.py",
        ],
    )

    assert result.exit_code == 1
    payload = json.loads(result.output)
    assert payload["status"] == "error"
    assert payload["errors"]


def test_review_cli_module_help_smoke() -> None:
    aft_root = Path(__file__).resolve().parents[2]
    env = os.environ.copy()
    env["PYTHONPATH"] = os.pathsep.join(
        [str(aft_root / "src"), env["PYTHONPATH"]]
    ) if env.get("PYTHONPATH") else str(aft_root / "src")

    result = subprocess.run(
        [sys.executable, "-m", "ontology_audit_hub.review_cli", "--help"],
        cwd=str(aft_root),
        capture_output=True,
        text=True,
        env=env,
        check=False,
    )

    assert result.returncode == 0
    assert "github" in result.stdout
