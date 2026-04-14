from __future__ import annotations

import asyncio
import json
import threading
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from ontology_audit_hub.api import create_app
from ontology_audit_hub.github_review_service import GitHubReviewService
from ontology_audit_hub.infra.checkpointing import SqliteCheckpointStoreFactory
from ontology_audit_hub.infra.graph_augmenter import NullGraphAugmenter
from ontology_audit_hub.infra.human_store import FileHumanInteractionStore
from ontology_audit_hub.infra.llm.base import NullStructuredLLMAdapter
from ontology_audit_hub.infra.llm.github_review_agents import (
    GitHubReviewIssue,
    GitHubReviewReport,
    GitHubReviewScopePlan,
)
from ontology_audit_hub.infra.retrieval import NullRetriever
from ontology_audit_hub.infra.runtime import GraphRuntime
from ontology_audit_hub.infra.settings import AuditHubSettings
from ontology_audit_hub.service import SupervisorService


class ReadyReviewAdapter(NullStructuredLLMAdapter):
    def check_ready(self) -> tuple[bool, str]:
        return True, "ready"

    def plan_review_scope(self, review_packet) -> GitHubReviewScopePlan | None:
        return GitHubReviewScopePlan(
            focus_files=["src/app.py"],
            hotspots=["src/app.py"],
            cross_file_dependencies=[],
            review_priorities=["Focus on correctness and security."],
            notes=[],
        )

    def review_correctness(self, review_packet, *, scope_plan=None) -> list[GitHubReviewIssue]:
        return [
            GitHubReviewIssue(
                title="Missing guard",
                severity="high",
                file_path="src/app.py",
                line=3,
                summary="The handler dereferences config without checking for None.",
                evidence="3 | return config.value",
                recommendation="Check for None before reading config.value.",
                category="correctness",
            )
        ]

    def review_risk_regression(self, review_packet, *, scope_plan=None) -> list[GitHubReviewIssue]:
        return []

    def review_security(self, review_packet, *, scope_plan=None) -> list[GitHubReviewIssue]:
        return []

    def review_test_coverage(self, review_packet, *, scope_plan=None) -> list[GitHubReviewIssue]:
        return []

    def judge_review_report(
        self,
        review_packet,
        *,
        scope_plan=None,
        correctness_issues=None,
        risk_regression_issues=None,
        security_issues=None,
        test_coverage_issues=None,
        warnings=None,
    ) -> GitHubReviewReport | None:
        return GitHubReviewReport(
            summary="Reviewed the requested GitHub files and found one actionable issue.",
            issues=list(correctness_issues or []),
            reviewed_files=["src/app.py"],
            warnings=list(warnings or []),
            next_steps=["Fix the null handling issue and add a regression test."],
        )


class UnavailableReviewAdapter(NullStructuredLLMAdapter):
    def check_ready(self) -> tuple[bool, str]:
        return False, "LLM disabled"


class FallbackReviewAdapter(NullStructuredLLMAdapter):
    def check_ready(self) -> tuple[bool, str]:
        return True, "ready"

    def plan_review_scope(self, review_packet) -> GitHubReviewScopePlan | None:
        return GitHubReviewScopePlan(
            focus_files=["src/app.py"],
            hotspots=["src/app.py"],
            cross_file_dependencies=[],
            review_priorities=["Focus on correctness and security."],
            notes=[],
        )

    def review_correctness(self, review_packet, *, scope_plan=None) -> list[GitHubReviewIssue]:
        return [
            GitHubReviewIssue(
                title="Duplicate guard",
                severity="high",
                file_path="src/app.py",
                line=3,
                summary="This finding should survive local merge fallback.",
                evidence="3 | return config.value",
                recommendation="Check for None before reading config.value.",
                category="correctness",
            )
        ]

    def review_risk_regression(self, review_packet, *, scope_plan=None) -> list[GitHubReviewIssue]:
        return []

    def review_security(self, review_packet, *, scope_plan=None) -> list[GitHubReviewIssue]:
        return [
            GitHubReviewIssue(
                title="Duplicate guard",
                severity="high",
                file_path="src/app.py",
                line=3,
                summary="This finding should survive local merge fallback.",
                evidence="3 | return config.value",
                recommendation="Check for None before reading config.value.",
                category="security",
            )
        ]

    def review_test_coverage(self, review_packet, *, scope_plan=None) -> list[GitHubReviewIssue]:
        return []

    def judge_review_report(
        self,
        review_packet,
        *,
        scope_plan=None,
        correctness_issues=None,
        risk_regression_issues=None,
        security_issues=None,
        test_coverage_issues=None,
        warnings=None,
    ) -> GitHubReviewReport | None:
        return None


class ManyIssuesReviewAdapter(NullStructuredLLMAdapter):
    def check_ready(self) -> tuple[bool, str]:
        return True, "ready"

    def plan_review_scope(self, review_packet) -> GitHubReviewScopePlan | None:
        return GitHubReviewScopePlan(
            focus_files=["src/app.py"],
            hotspots=["src/app.py"],
            cross_file_dependencies=[],
            review_priorities=[],
            notes=[],
        )

    def review_correctness(self, review_packet, *, scope_plan=None) -> list[GitHubReviewIssue]:
        severities = ["info", "critical", "high", "medium", "low", "critical", "high"]
        titles = ["Info issue", "Critical one", "High one", "Medium one", "Low one", "Critical two", "High two"]
        return [
            GitHubReviewIssue(
                title=title,
                severity=severity,  # type: ignore[arg-type]
                file_path=f"src/{index}.py",
                line=index + 1,
                summary=f"summary {index}",
                evidence=f"{index + 1} | evidence",
                recommendation=f"recommendation {index}",
                category="correctness",
            )
            for index, (title, severity) in enumerate(zip(titles, severities, strict=True))
        ]

    def review_risk_regression(self, review_packet, *, scope_plan=None) -> list[GitHubReviewIssue]:
        return []

    def review_security(self, review_packet, *, scope_plan=None) -> list[GitHubReviewIssue]:
        return []

    def review_test_coverage(self, review_packet, *, scope_plan=None) -> list[GitHubReviewIssue]:
        return []


class FastStreamingReviewService:
    def close(self) -> None:
        return None

    def review(self, request) -> GitHubReviewReport:
        return GitHubReviewReport(
            summary="审查已完成",
            issues=[],
            reviewed_files=[],
            warnings=[],
            next_steps=[],
        )

    async def stream_review(self, request):
        yield {"event": "status", "data": {"message": "正在下载 GitHub 仓库快照..."}}
        yield {
            "event": "progress",
            "data": {
                "phase": "download_repository_snapshot",
                "completed_phases": 1,
                "total_phases": 5,
            },
        }
        yield {
            "event": "partial_report",
            "data": {
                "category": "correctness",
                "issues": [
                    {
                        "title": "Missing guard",
                        "severity": "high",
                        "file_path": "src/app.py",
                        "line": 3,
                        "summary": "The handler dereferences config without checking for None.",
                        "evidence": "3 | return config.value",
                        "recommendation": "Check for None before reading config.value.",
                    }
                ],
                "warnings": [],
                "reviewed_files": ["src/app.py"],
            },
        }
        yield {
            "event": "complete",
            "data": {
                "summary": "审查已完成",
                "issues": [
                    {
                        "title": "Missing guard",
                        "severity": "high",
                        "file_path": "src/app.py",
                        "line": 3,
                        "summary": "The handler dereferences config without checking for None.",
                        "evidence": "3 | return config.value",
                        "recommendation": "Check for None before reading config.value.",
                    }
                ],
                "reviewed_files": ["src/app.py"],
                "warnings": [],
                "next_steps": ["请修复空值处理问题。"],
            },
        }


class SlowStreamingReviewService:
    def __init__(self) -> None:
        self.started = threading.Event()
        self.waiting = threading.Event()
        self.cancelled = threading.Event()
        self.release_gate = threading.Event()

    def close(self) -> None:
        return None

    def review(self, request) -> GitHubReviewReport:
        return GitHubReviewReport(
            summary="审查已完成",
            issues=[],
            reviewed_files=[],
            warnings=[],
            next_steps=[],
        )

    async def stream_review(self, request):
        self.started.set()
        yield {"event": "status", "data": {"message": "审查已启动。"}}
        self.waiting.set()
        try:
            await asyncio.to_thread(self.release_gate.wait)
        except asyncio.CancelledError:
            self.cancelled.set()
            raise


def _read_sse_events(response) -> list[tuple[str, dict]]:
    events: list[tuple[str, dict]] = []
    current_event = ""
    data_lines: list[str] = []
    for chunk in response.iter_text():
        for line in chunk.splitlines():
            if not line.strip():
                if current_event and data_lines:
                    events.append((current_event, json.loads("\n".join(data_lines))))
                current_event = ""
                data_lines = []
                continue
            if line.startswith("event:"):
                current_event = line.partition(":")[2].strip()
            elif line.startswith("data:"):
                data_lines.append(line.partition(":")[2].strip())
    if current_event and data_lines:
        events.append((current_event, json.loads("\n".join(data_lines))))
    return events


def _make_audit_service(tmp_path: Path) -> SupervisorService:
    settings = AuditHubSettings(
        run_root=tmp_path / "runs",
        checkpoint_path=tmp_path / "checkpoints.sqlite3",
        qdrant_enabled=False,
        neo4j_enabled=False,
        llm_enabled=False,
    )
    return SupervisorService(
        settings=settings,
        runtime=GraphRuntime(
            retriever=NullRetriever(),
            graph_augmenter=NullGraphAugmenter(),
            interrupt_on_human=False,
        ),
        checkpoint_store_factory=SqliteCheckpointStoreFactory(tmp_path / "checkpoints.sqlite3"),
        human_store=FileHumanInteractionStore(tmp_path / "human"),
    )


def _app_has_route(app, route_path: str) -> bool:
    return any(getattr(route, "path", None) == route_path for route in app.routes)


def test_review_github_endpoint_returns_structured_report(monkeypatch, tmp_path: Path) -> None:
    snapshot_dir = tmp_path / "snapshot"
    (snapshot_dir / "src").mkdir(parents=True)
    source_file = snapshot_dir / "src" / "app.py"
    source_file.write_text("def run(config):\n    return config.value\n", encoding="utf-8")

    from ontology_audit_hub.graphs.nodes.github_review import download_snapshot as download_snapshot_node

    monkeypatch.setattr(
        download_snapshot_node,
        "download_repository_snapshot",
        lambda repo_target, destination_root, timeout_seconds: snapshot_dir,
    )

    review_service = GitHubReviewService(
        settings=AuditHubSettings(
            run_root=tmp_path / "runs",
            checkpoint_path=tmp_path / "checkpoints.sqlite3",
            qdrant_enabled=False,
            neo4j_enabled=False,
            llm_enabled=True,
            llm_model="openai:gpt-4o-mini",
        ),
        llm_adapter=ReadyReviewAdapter(),
    )
    client = TestClient(
        create_app(
            service=_make_audit_service(tmp_path),
            github_review_service=review_service,
        )
    )

    response = client.post(
        "/review/github",
        json={
            "repository_url": "https://github.com/example/repo",
            "ref": "main",
            "paths": ["src/app.py"],
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["summary"] == (
        "已深度审查 1/1 个候选文件，执行审查维度：正确性、回归风险、测试覆盖。共发现 1 个问题（1 个高）。"
    )
    assert payload["reviewed_files"] == ["src/app.py"]
    assert payload["issues"][0]["title"] == "Missing guard"
    assert payload["next_steps"] == [
        "优先修复高严重级别问题，并回归验证受影响的代码路径。",
        "为已深审的焦点文件补充或更新回归测试。",
    ]


def test_review_github_endpoint_returns_only_top_five_issues(monkeypatch, tmp_path: Path) -> None:
    snapshot_dir = tmp_path / "snapshot"
    (snapshot_dir / "src").mkdir(parents=True)
    source_file = snapshot_dir / "src" / "app.py"
    source_file.write_text("def run(config):\n    return config.value\n", encoding="utf-8")

    from ontology_audit_hub.graphs.nodes.github_review import download_snapshot as download_snapshot_node

    monkeypatch.setattr(
        download_snapshot_node,
        "download_repository_snapshot",
        lambda repo_target, destination_root, timeout_seconds: snapshot_dir,
    )

    review_service = GitHubReviewService(
        settings=AuditHubSettings(
            run_root=tmp_path / "runs",
            checkpoint_path=tmp_path / "checkpoints.sqlite3",
            qdrant_enabled=False,
            neo4j_enabled=False,
            llm_enabled=True,
            llm_model="openai:gpt-4o-mini",
        ),
        llm_adapter=ManyIssuesReviewAdapter(),
    )
    client = TestClient(
        create_app(
            service=_make_audit_service(tmp_path),
            github_review_service=review_service,
        )
    )

    response = client.post(
        "/review/github",
        json={
            "repository_url": "https://github.com/example/repo",
            "ref": "main",
            "paths": ["src/app.py"],
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert len(payload["issues"]) == 5
    assert [issue["title"] for issue in payload["issues"]] == [
        "Critical one",
        "Critical two",
        "High one",
        "High two",
        "Medium one",
    ]


def test_review_github_endpoint_uses_local_fallback_when_judge_is_unavailable(monkeypatch, tmp_path: Path) -> None:
    snapshot_dir = tmp_path / "snapshot"
    (snapshot_dir / "src").mkdir(parents=True)
    source_file = snapshot_dir / "src" / "app.py"
    source_file.write_text("def run(config):\n    return config.value\n", encoding="utf-8")

    from ontology_audit_hub.graphs.nodes.github_review import download_snapshot as download_snapshot_node

    monkeypatch.setattr(
        download_snapshot_node,
        "download_repository_snapshot",
        lambda repo_target, destination_root, timeout_seconds: snapshot_dir,
    )

    review_service = GitHubReviewService(
        settings=AuditHubSettings(
            run_root=tmp_path / "runs",
            checkpoint_path=tmp_path / "checkpoints.sqlite3",
            qdrant_enabled=False,
            neo4j_enabled=False,
            llm_enabled=True,
            llm_model="openai:gpt-4o-mini",
        ),
        llm_adapter=FallbackReviewAdapter(),
    )
    client = TestClient(
        create_app(
            service=_make_audit_service(tmp_path),
            github_review_service=review_service,
        )
    )

    response = client.post(
        "/review/github",
        json={
            "repository_url": "https://github.com/example/repo",
            "ref": "main",
            "paths": ["src/app.py"],
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["summary"] == (
        "已深度审查 1/1 个候选文件，执行审查维度：正确性、回归风险、测试覆盖。共发现 1 个问题（1 个高）。"
    )
    assert payload["issues"] == [
        {
            "title": "Duplicate guard",
            "severity": "high",
            "file_path": "src/app.py",
            "line": 3,
            "summary": "This finding should survive local merge fallback.",
            "evidence": "3 | return config.value",
            "recommendation": "Check for None before reading config.value.",
        }
    ]
    assert payload["warnings"] == []
    assert payload["next_steps"][0].startswith("优先修复高严重级别问题")


def test_review_github_stream_endpoint_emits_progress_and_complete_when_available(tmp_path: Path) -> None:
    app = create_app(
        service=_make_audit_service(tmp_path),
        github_review_service=FastStreamingReviewService(),
    )
    if not _app_has_route(app, "/review/github/stream"):
        pytest.skip("/review/github/stream is not implemented yet.")

    client = TestClient(app)
    with client.stream(
        "POST",
        "/review/github/stream",
        json={
            "repository_url": "https://github.com/example/repo",
            "ref": "main",
            "paths": ["src/app.py"],
            "request_id": "review-stream-1",
        },
    ) as response:
        assert response.status_code == 200
        events = _read_sse_events(response)

    assert [event for event, _ in events][:3] == ["status", "progress", "partial_report"]
    assert events[-1][0] == "complete"
    assert events[-1][1]["summary"] == "审查已完成"


def test_review_github_cancel_endpoint_cancels_active_stream_task_when_available(tmp_path: Path) -> None:
    service = SlowStreamingReviewService()
    app = create_app(service=_make_audit_service(tmp_path), github_review_service=service)
    if not _app_has_route(app, "/review/github/stream") or not _app_has_route(app, "/review/github/cancel"):
        pytest.skip("GitHub review streaming/cancel endpoints are not implemented yet.")

    stream_client = TestClient(app)
    control_client = TestClient(app)

    def consume_stream() -> None:
        with stream_client.stream(
            "POST",
            "/review/github/stream",
            json={
                "repository_url": "https://github.com/example/repo",
                "ref": "main",
                "paths": ["src/app.py"],
                "request_id": "review-cancel-1",
            },
        ) as response:
            assert response.status_code == 200
            for _ in response.iter_text():
                pass

    thread = threading.Thread(target=consume_stream, daemon=True)
    thread.start()

    assert service.started.wait(timeout=5)
    assert service.waiting.wait(timeout=5)

    response = control_client.post("/review/github/cancel", json={"request_id": "review-cancel-1"})
    assert response.status_code == 200
    assert response.json()["status"] == "cancelled"

    assert service.cancelled.wait(timeout=5)
    service.release_gate.set()
    thread.join(timeout=5)
    stream_client.close()
    control_client.close()


def test_review_github_endpoint_returns_400_for_invalid_request(tmp_path: Path) -> None:
    client = TestClient(
        create_app(
            service=_make_audit_service(tmp_path),
            github_review_service=GitHubReviewService(
                settings=AuditHubSettings(
                    run_root=tmp_path / "runs",
                    checkpoint_path=tmp_path / "checkpoints.sqlite3",
                    qdrant_enabled=False,
                    neo4j_enabled=False,
                    llm_enabled=True,
                    llm_model="openai:gpt-4o-mini",
                ),
                llm_adapter=ReadyReviewAdapter(),
            ),
        )
    )

    response = client.post(
        "/review/github",
        json={
            "repository_url": "https://example.com/not-github",
            "ref": "main",
            "paths": ["src/app.py"],
        },
    )

    assert response.status_code == 400
    assert response.json()["message"] == "GitHub 审查请求无效。"


def test_review_github_endpoint_returns_503_when_llm_is_unavailable(tmp_path: Path) -> None:
    review_service = GitHubReviewService(
        settings=AuditHubSettings(
            run_root=tmp_path / "runs",
            checkpoint_path=tmp_path / "checkpoints.sqlite3",
            qdrant_enabled=False,
            neo4j_enabled=False,
            llm_enabled=True,
            llm_model="openai:gpt-4o-mini",
        ),
        llm_adapter=UnavailableReviewAdapter(),
    )
    client = TestClient(
        create_app(
            service=_make_audit_service(tmp_path),
            github_review_service=review_service,
        )
    )

    response = client.post(
        "/review/github",
        json={
            "repository_url": "https://github.com/example/repo",
            "ref": "main",
            "paths": ["src/app.py"],
        },
    )

    assert response.status_code == 503
    payload = response.json()
    assert payload["status"] == "error"
    assert "审查模型尚未就绪" in payload["message"]
