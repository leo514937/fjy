from __future__ import annotations

import re
from collections import Counter
from collections.abc import Iterable

from ontology_audit_hub.domain.review.models import (
    GitHubReviewIssue as DomainGitHubReviewIssue,
)
from ontology_audit_hub.domain.review.models import (
    GitHubReviewResponse,
)
from ontology_audit_hub.infra.github_snapshot import GitHubReviewCandidate
from ontology_audit_hub.infra.llm.github_review_agents import (
    GitHubReviewIssue,
    GitHubReviewScopePacket,
    GitHubReviewScopePlan,
    GitHubReviewStagePacket,
)

SECURITY_SIGNAL_RE = re.compile(
    r"(auth|oauth|jwt|token|secret|password|api[_-]?key|sql|select\s+.+from|insert\s+into|shell|subprocess|"
    r"exec\(|eval\(|pickle|yaml\.load|pathlib|os\.path|open\(|requests\.|httpx\.|fetch\(|ssrf|deserialize)",
    re.IGNORECASE,
)
RISK_SIGNAL_RE = re.compile(
    r"(router|route|endpoint|public|export|interface|schema|migration|config|contract|api|serializer|controller|"
    r"handler|settings|feature flag|backward|compat)",
    re.IGNORECASE,
)
MAX_RETURNED_ISSUES = 5

REVIEWER_LABELS = {
    "correctness": "正确性",
    "risk_regression": "回归风险",
    "security": "安全",
    "test_coverage": "测试覆盖",
}

SEVERITY_LABELS = {
    "critical": "严重",
    "high": "高",
    "medium": "中",
    "low": "低",
    "info": "提示",
}


def build_fallback_scope_plan(review_packet: GitHubReviewScopePacket) -> GitHubReviewScopePlan:
    explicit_paths = [candidate.path for candidate in review_packet.candidates if candidate.is_explicit]
    remaining_paths = [candidate.path for candidate in review_packet.candidates if not candidate.is_explicit]
    focus_files = (explicit_paths + remaining_paths)[:6]
    hotspots = [candidate.path for candidate in review_packet.candidates if candidate.truncated][:4]
    return GitHubReviewScopePlan(
        focus_files=focus_files,
        hotspots=hotspots,
        cross_file_dependencies=[],
        review_priorities=[
            "优先检查对外可达的处理入口、状态转换，以及文件系统或网络边界。",
            "优先关注正确性和回归风险，而不是泛泛的风格评论。",
        ],
        notes=[f"范围包包含 {len(review_packet.candidates)} 个候选文件。"],
    )


def dedupe_issues(issues: Iterable[GitHubReviewIssue]) -> list[GitHubReviewIssue]:
    best_by_key: dict[tuple[str, str, int | None], GitHubReviewIssue] = {}
    for issue in issues:
        key = (
            issue.file_path,
            issue.title.strip().lower(),
            issue.line,
        )
        existing = best_by_key.get(key)
        if existing is None or severity_rank(issue.severity) < severity_rank(existing.severity):
            best_by_key[key] = issue
    return list(best_by_key.values())


def severity_rank(severity: str) -> int:
    order = {
        "critical": 0,
        "high": 1,
        "medium": 2,
        "low": 3,
        "info": 4,
    }
    return order.get(severity.lower(), 99)


def sort_issues(issues: Iterable[GitHubReviewIssue]) -> list[GitHubReviewIssue]:
    return sorted(
        issues,
        key=lambda issue: (
            severity_rank(issue.severity),
            issue.file_path,
            issue.line if issue.line is not None else 10**9,
            issue.title,
        ),
    )


def limit_review_issues(
    issues: Iterable[GitHubReviewIssue],
    *,
    max_issues: int = MAX_RETURNED_ISSUES,
) -> list[GitHubReviewIssue]:
    return sort_issues(dedupe_issues(issues))[:max_issues]


def select_focus_paths(
    *,
    candidates: list[GitHubReviewCandidate],
    scope_plan: GitHubReviewScopePlan | None,
    max_focus_files: int,
) -> list[str]:
    explicit_paths = [candidate.path for candidate in candidates if candidate.is_explicit][:max_focus_files]
    selected = list(explicit_paths)
    seen = set(selected)
    for path in (scope_plan.focus_files if scope_plan else []):
        normalized = path.replace("\\", "/").strip()
        if not normalized or normalized in seen:
            continue
        selected.append(normalized)
        seen.add(normalized)
        if len(selected) >= max_focus_files:
            return selected
    for candidate in candidates:
        if candidate.path in seen:
            continue
        selected.append(candidate.path)
        seen.add(candidate.path)
        if len(selected) >= max_focus_files:
            break
    return selected[:max_focus_files]


def determine_enabled_reviewers(
    *,
    candidates: list[GitHubReviewCandidate],
    stage_packet: GitHubReviewStagePacket,
) -> list[str]:
    enabled = ["correctness"]
    combined_text = "\n".join(
        [
            candidate.path + "\n" + "\n".join(candidate.imports_summary + candidate.declarations_summary)
            for candidate in candidates
        ]
        + [file.path + "\n" + file.content for file in stage_packet.files]
    )
    if SECURITY_SIGNAL_RE.search(combined_text):
        enabled.append("security")
    if len(stage_packet.files) > 1 or RISK_SIGNAL_RE.search(combined_text):
        enabled.append("risk_regression")
    if _needs_test_coverage_review(candidates=candidates, stage_packet=stage_packet):
        enabled.append("test_coverage")
    return enabled


def build_local_report(
    *,
    stage_packet: GitHubReviewStagePacket,
    issues: list[GitHubReviewIssue],
    warnings: list[str],
    enabled_reviewers: list[str],
    candidate_count: int,
) -> GitHubReviewResponse:
    deduped = sort_issues(dedupe_issues(issues))
    deduped = deduped[:MAX_RETURNED_ISSUES]
    reviewed_files = [file.path for file in stage_packet.files]
    severity_counts = Counter(issue.severity for issue in deduped)
    severity_summary = "，".join(
        f"{count} 个{SEVERITY_LABELS[severity]}"
        for severity, count in (
            ("critical", severity_counts.get("critical", 0)),
            ("high", severity_counts.get("high", 0)),
            ("medium", severity_counts.get("medium", 0)),
            ("low", severity_counts.get("low", 0)),
            ("info", severity_counts.get("info", 0)),
        )
        if count
    )
    reviewer_summary = "、".join(REVIEWER_LABELS.get(reviewer, reviewer) for reviewer in enabled_reviewers) or "正确性"
    scope_trimmed = candidate_count > len(reviewed_files)
    if deduped:
        summary = (
            f"已深度审查 {len(reviewed_files)}/{candidate_count} 个候选文件，执行审查维度：{reviewer_summary}。"
            f"共发现 {len(deduped)} 个问题"
        )
        if severity_summary:
            summary += f"（{severity_summary}）"
        if scope_trimmed:
            summary += "；为提升速度，审查范围已裁剪。"
        else:
            summary += "。"
        next_steps = [
            "优先修复高严重级别问题，并回归验证受影响的代码路径。",
            "为已深审的焦点文件补充或更新回归测试。",
        ]
        if any(issue.category == "test_coverage" for issue in deduped):
            next_steps.append("在将本次审查结果作为发布依据前，请先补齐缺失测试。")
    else:
        summary = (
            f"已深度审查 {len(reviewed_files)}/{candidate_count} 个候选文件，执行审查维度：{reviewer_summary}，"
            "未发现有依据的阻断性问题。"
        )
        if scope_trimmed:
            summary += " 为提升速度，审查范围已裁剪。"
        next_steps = ["请运行仓库现有测试，确认已审查路径的行为符合预期。"]

    return GitHubReviewResponse(
        summary=summary,
        issues=[to_domain_issue(issue) for issue in deduped],
        reviewed_files=reviewed_files,
        warnings=list(dict.fromkeys(warnings)),
        next_steps=list(dict.fromkeys(next_steps)),
    )


def to_domain_issue(issue: GitHubReviewIssue) -> DomainGitHubReviewIssue:
    return DomainGitHubReviewIssue(
        title=issue.title,
        severity=issue.severity,
        file_path=issue.file_path,
        line=issue.line,
        summary=issue.summary,
        evidence=issue.evidence,
        recommendation=issue.recommendation,
    )


def _needs_test_coverage_review(
    *,
    candidates: list[GitHubReviewCandidate],
    stage_packet: GitHubReviewStagePacket,
) -> bool:
    if not stage_packet.files:
        return False
    focus_paths = [file.path.lower() for file in stage_packet.files]
    if all(_is_test_path(path) for path in focus_paths):
        return False
    candidate_paths = {candidate.path.lower() for candidate in candidates}
    for path in focus_paths:
        if _is_test_path(path):
            continue
        stem = path.rsplit(".", 1)[0]
        expected_tests = {
            f"tests/test_{stem.split('/')[-1]}.py",
            f"{stem}.test.ts",
            f"{stem}.spec.ts",
            f"{stem}.test.js",
            f"{stem}.spec.js",
            f"{stem}_test.go",
        }
        if not any(test_path in candidate_paths for test_path in expected_tests):
            return True
    return False


def _is_test_path(path: str) -> bool:
    normalized = path.lower()
    return (
        "/test" in normalized
        or normalized.startswith("test")
        or "/tests/" in f"/{normalized}/"
        or normalized.endswith("_test.go")
        or normalized.endswith(".spec.ts")
        or normalized.endswith(".spec.js")
        or normalized.endswith(".test.ts")
        or normalized.endswith(".test.js")
        or normalized.endswith("_test.py")
        or normalized.startswith("tests/")
    )
