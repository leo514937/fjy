from __future__ import annotations

from typing import TypedDict

from ontology_audit_hub.domain.review.models import (
    GitHubRepoTarget,
    GitHubReviewPartialReport,
    GitHubReviewProgress,
    GitHubReviewRequest,
    GitHubReviewResponse,
)
from ontology_audit_hub.infra.github_snapshot import GitHubReviewCandidate, GitHubSnapshotFile
from ontology_audit_hub.infra.llm.github_review_agents import (
    GitHubReviewIssue,
    GitHubReviewReport,
    GitHubReviewScopePacket,
    GitHubReviewScopePlan,
    GitHubReviewStagePacket,
)


class GitHubReviewState(TypedDict, total=False):
    request: GitHubReviewRequest
    repo_target: GitHubRepoTarget
    snapshot_workspace_dir: str
    snapshot_dir: str
    candidate_files: list[GitHubReviewCandidate]
    selected_files: list[GitHubSnapshotFile]
    focus_files: list[GitHubSnapshotFile]
    review_packet: GitHubReviewStagePacket
    scope_packet: GitHubReviewScopePacket
    stage_packet: GitHubReviewStagePacket
    scope_plan: GitHubReviewScopePlan
    enabled_reviewers: list[str]
    correctness_issues: list[GitHubReviewIssue]
    risk_regression_issues: list[GitHubReviewIssue]
    security_issues: list[GitHubReviewIssue]
    test_coverage_issues: list[GitHubReviewIssue]
    merged_issues: list[GitHubReviewIssue]
    warnings: list[str]
    current_phase: str
    progress: GitHubReviewProgress
    partial_report: GitHubReviewPartialReport
    final_report: GitHubReviewResponse | GitHubReviewReport
