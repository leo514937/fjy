from __future__ import annotations

from ontology_audit_hub.graphs.nodes.github_review._utils import (
    build_fallback_scope_plan,
    build_local_report,
    dedupe_issues,
    limit_review_issues,
)
from ontology_audit_hub.infra.llm.github_review_agents import (
    GitHubReviewFile,
    GitHubReviewIssue,
    GitHubReviewScopePacket,
    GitHubReviewStagePacket,
    GitHubScopeCandidate,
)


def _issue(
    *,
    title: str,
    severity: str,
    file_path: str,
    line: int | None,
    summary: str,
    evidence: str,
    recommendation: str,
    category: str = "correctness",
) -> GitHubReviewIssue:
    return GitHubReviewIssue(
        title=title,
        severity=severity,  # type: ignore[arg-type]
        file_path=file_path,
        line=line,
        summary=summary,
        evidence=evidence,
        recommendation=recommendation,
        category=category,  # type: ignore[arg-type]
    )


def _scope_packet(file_count: int) -> GitHubReviewScopePacket:
    return GitHubReviewScopePacket(
        repository_url="https://github.com/example/repo",
        ref="main",
        review_request="Review the supplied repository snapshot.",
        paths=[f"src/file_{index}.py" for index in range(file_count)],
        candidates=[
            GitHubScopeCandidate(
                path=f"src/file_{index}.py",
                file_type="python",
                size_bytes=32,
                is_explicit=False,
                declarations_summary=[f"def file_{index}()"],
            )
            for index in range(file_count)
        ],
    )


def _stage_packet(file_count: int) -> GitHubReviewStagePacket:
    return GitHubReviewStagePacket(
        repository_url="https://github.com/example/repo",
        ref="main",
        review_request="Review the supplied repository snapshot.",
        paths=[f"src/file_{index}.py" for index in range(file_count)],
        files=[
            GitHubReviewFile(
                path=f"src/file_{index}.py",
                content=f"1 | print({index})",
                line_start=1,
                line_end=1,
            )
            for index in range(file_count)
        ],
    )


def test_build_local_report_dedupes_and_sorts_issues() -> None:
    packet = _stage_packet(2)
    issues = [
        _issue(
            title="Missing guard",
            severity="low",
            file_path="src/b.py",
            line=18,
            summary="Duplicate entry should be removed.",
            evidence="18 | risky_call()",
            recommendation="Add a guard.",
        ),
        _issue(
            title="Missing guard",
            severity="low",
            file_path="src/b.py",
            line=18,
            summary="Duplicate entry should be removed.",
            evidence="18 | risky_call()",
            recommendation="Add a guard.",
        ),
        _issue(
            title="Unbounded recursion",
            severity="critical",
            file_path="src/a.py",
            line=4,
            summary="This should be ordered first by severity.",
            evidence="4 | recurse()",
            recommendation="Add a recursion limit.",
        ),
        _issue(
            title="Slow path",
            severity="medium",
            file_path="src/a.py",
            line=30,
            summary="This should come after critical and before low.",
            evidence="30 | slow_call()",
            recommendation="Short-circuit the path.",
        ),
    ]

    report = build_local_report(
        stage_packet=packet,
        issues=issues,
        warnings=["审查前已截断大文件：src/b.py", "审查前已截断大文件：src/b.py"],
        enabled_reviewers=["correctness", "security"],
        candidate_count=2,
    )

    assert report.summary == "已深度审查 2/2 个候选文件，执行审查维度：正确性、安全。共发现 3 个问题（1 个严重，1 个中，1 个低）。"
    assert [issue.title for issue in report.issues] == [
        "Unbounded recursion",
        "Slow path",
        "Missing guard",
    ]
    assert report.reviewed_files == ["src/file_0.py", "src/file_1.py"]
    assert report.warnings == ["审查前已截断大文件：src/b.py"]
    assert report.next_steps[0].startswith("优先修复高严重级别问题")


def test_dedupe_issues_ignores_title_case_and_preserves_distinct_findings() -> None:
    issues = [
        _issue(
            title="Missing Guard",
            severity="high",
            file_path="src/app.py",
            line=10,
            summary="Check is missing.",
            evidence="10 | config.value",
            recommendation="Add a guard.",
        ),
        _issue(
            title="missing guard",
            severity="high",
            file_path="src/app.py",
            line=10,
            summary="Check is missing.",
            evidence="10 | config.value",
            recommendation="Add a guard.",
        ),
        _issue(
            title="Missing Guard",
            severity="high",
            file_path="src/app.py",
            line=11,
            summary="This is a separate location and should remain.",
            evidence="11 | config.value",
            recommendation="Add a guard.",
        ),
    ]

    deduped = dedupe_issues(issues)

    assert len(deduped) == 2
    assert deduped[0].line == 10
    assert deduped[1].line == 11


def test_limit_review_issues_keeps_top_five_in_severity_order() -> None:
    issues = [
        _issue(title="Info issue", severity="info", file_path="src/z.py", line=1, summary="", evidence="", recommendation=""),
        _issue(title="Critical one", severity="critical", file_path="src/a.py", line=1, summary="", evidence="", recommendation=""),
        _issue(title="High one", severity="high", file_path="src/b.py", line=2, summary="", evidence="", recommendation=""),
        _issue(title="Medium one", severity="medium", file_path="src/c.py", line=3, summary="", evidence="", recommendation=""),
        _issue(title="Low one", severity="low", file_path="src/d.py", line=4, summary="", evidence="", recommendation=""),
        _issue(title="Critical two", severity="critical", file_path="src/e.py", line=5, summary="", evidence="", recommendation=""),
        _issue(title="High two", severity="high", file_path="src/f.py", line=6, summary="", evidence="", recommendation=""),
    ]

    limited = limit_review_issues(issues)

    assert [issue.title for issue in limited] == [
        "Critical one",
        "Critical two",
        "High one",
        "High two",
        "Medium one",
    ]


def test_build_local_report_returns_only_top_five_issues() -> None:
    packet = _stage_packet(1)
    issues = [
        _issue(title="Info issue", severity="info", file_path="src/z.py", line=1, summary="", evidence="", recommendation=""),
        _issue(title="Critical one", severity="critical", file_path="src/a.py", line=1, summary="", evidence="", recommendation=""),
        _issue(title="High one", severity="high", file_path="src/b.py", line=2, summary="", evidence="", recommendation=""),
        _issue(title="Medium one", severity="medium", file_path="src/c.py", line=3, summary="", evidence="", recommendation=""),
        _issue(title="Low one", severity="low", file_path="src/d.py", line=4, summary="", evidence="", recommendation=""),
        _issue(title="Critical two", severity="critical", file_path="src/e.py", line=5, summary="", evidence="", recommendation=""),
        _issue(title="High two", severity="high", file_path="src/f.py", line=6, summary="", evidence="", recommendation=""),
    ]

    report = build_local_report(
        stage_packet=packet,
        issues=issues,
        warnings=[],
        enabled_reviewers=["correctness"],
        candidate_count=1,
    )

    assert len(report.issues) == 5
    assert [issue.title for issue in report.issues] == [
        "Critical one",
        "Critical two",
        "High one",
        "High two",
        "Medium one",
    ]


def test_build_fallback_scope_plan_prioritizes_initial_files_and_truncated_hotspots() -> None:
    packet = _scope_packet(10)
    packet.candidates[1].truncated = True
    packet.candidates[3].truncated = True
    packet.candidates[9].truncated = True

    scope_plan = build_fallback_scope_plan(packet)

    assert scope_plan.focus_files == [f"src/file_{index}.py" for index in range(6)]
    assert scope_plan.hotspots == ["src/file_1.py", "src/file_3.py", "src/file_9.py"]
    assert scope_plan.notes == ["范围包包含 10 个候选文件。"]
