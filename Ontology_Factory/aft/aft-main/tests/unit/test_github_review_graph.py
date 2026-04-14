from __future__ import annotations

from pathlib import Path

from ontology_audit_hub.domain.review.models import GitHubReviewRequest
from ontology_audit_hub.graphs.github_review_graph import build_github_review_graph
from ontology_audit_hub.infra.llm.base import NullStructuredLLMAdapter
from ontology_audit_hub.infra.llm.github_review_agents import GitHubReviewIssue, GitHubReviewScopePlan
from ontology_audit_hub.infra.settings import AuditHubSettings


class FakeReviewAdapter(NullStructuredLLMAdapter):
    def plan_review_scope(self, review_packet) -> GitHubReviewScopePlan | None:
        return GitHubReviewScopePlan(
            focus_files=["src/app.py"],
            hotspots=["src/app.py"],
            cross_file_dependencies=["src/app.py -> src/security.py"],
            review_priorities=["Check correctness first."],
            notes=["Planned by fake adapter."],
        )

    def review_correctness(self, review_packet, *, scope_plan=None) -> list[GitHubReviewIssue]:
        return [
            GitHubReviewIssue(
                title="Missing null guard",
                severity="high",
                file_path="src/app.py",
                line=12,
                summary="The code dereferences config without checking for None.",
                evidence="12 | return config.value",
                recommendation="Add a guard before accessing config.value.",
                category="correctness",
            )
        ]

    def review_risk_regression(self, review_packet, *, scope_plan=None) -> list[GitHubReviewIssue]:
        return []

    def review_security(self, review_packet, *, scope_plan=None) -> list[GitHubReviewIssue]:
        return [
            GitHubReviewIssue(
                title="Untrusted path usage",
                severity="medium",
                file_path="src/app.py",
                line=24,
                summary="User-controlled input flows into a filesystem path.",
                evidence="24 | open(base / user_input)",
                recommendation="Validate or normalize the path before using it.",
                category="security",
            )
        ]

    def review_test_coverage(self, review_packet, *, scope_plan=None) -> list[GitHubReviewIssue]:
        return []


def test_github_review_graph_runs_fan_out_and_finalizes_response(monkeypatch, tmp_path: Path) -> None:
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

    settings = AuditHubSettings(
        run_root=tmp_path / "runs",
        checkpoint_path=tmp_path / "checkpoints.sqlite3",
        qdrant_enabled=False,
        neo4j_enabled=False,
        llm_enabled=False,
    )
    graph = build_github_review_graph(llm_adapter=FakeReviewAdapter(), settings=settings)

    result = graph.invoke(
        {
            "request": GitHubReviewRequest(
                repository_url="https://github.com/example/repo",
                ref="main",
                paths=["src/app.py"],
            ),
            "snapshot_workspace_dir": str(tmp_path / "workspace"),
            "warnings": [],
        }
    )

    response = result["final_report"]
    assert response.summary == "已深度审查 1/1 个候选文件，执行审查维度：正确性、回归风险、测试覆盖。共发现 1 个问题（1 个高）。"
    assert response.reviewed_files == ["src/app.py"]
    assert [issue.title for issue in response.issues] == ["Missing null guard"]
    assert response.warnings == []
