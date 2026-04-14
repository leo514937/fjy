from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

ReviewSeverity = Literal["critical", "high", "medium", "low", "info"]
ReviewCategory = Literal["correctness", "risk_regression", "security", "test_coverage"]


class GitHubScopeCandidate(BaseModel):
    path: str
    file_type: str
    size_bytes: int
    is_explicit: bool = False
    truncated: bool = False
    imports_summary: list[str] = Field(default_factory=list)
    declarations_summary: list[str] = Field(default_factory=list)
    head_excerpt: str = ""
    tail_excerpt: str = ""


class GitHubReviewScopePacket(BaseModel):
    repository_url: str
    ref: str
    review_request: str
    paths: list[str] = Field(default_factory=list)
    candidates: list[GitHubScopeCandidate] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    extra_context: dict[str, Any] = Field(default_factory=dict)


class GitHubReviewFile(BaseModel):
    path: str
    content: str
    line_start: int = 1
    line_end: int | None = None
    truncated: bool = False


class GitHubReviewStagePacket(BaseModel):
    repository_url: str
    ref: str
    review_request: str
    paths: list[str] = Field(default_factory=list)
    files: list[GitHubReviewFile] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    extra_context: dict[str, Any] = Field(default_factory=dict)


class GitHubReviewScopePlan(BaseModel):
    focus_files: list[str] = Field(default_factory=list)
    hotspots: list[str] = Field(default_factory=list)
    cross_file_dependencies: list[str] = Field(default_factory=list)
    review_priorities: list[str] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)


class GitHubReviewIssue(BaseModel):
    title: str
    severity: ReviewSeverity
    file_path: str
    line: int | None = None
    summary: str
    evidence: str = ""
    recommendation: str = ""
    category: ReviewCategory | None = None


class GitHubReviewIssueBatch(BaseModel):
    issues: list[GitHubReviewIssue] = Field(default_factory=list)


class GitHubReviewReport(BaseModel):
    summary: str
    issues: list[GitHubReviewIssue] = Field(default_factory=list)
    reviewed_files: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    next_steps: list[str] = Field(default_factory=list)


GitHubReviewPacket = GitHubReviewStagePacket


def build_scope_planner_system_prompt() -> str:
    return (
        "You are the scope planner subagent in a GitHub code review workflow. "
        "Your job is to study only the provided candidate-file summaries and produce a compact review plan. "
        "Focus on which files and interactions deserve the most attention for deep review. "
        "Do not report bugs, style issues, or generic advice. "
        "Do not invent files, dependencies, or behaviors that are not present in the input. "
        "All user-facing natural-language output fields must be written in concise, idiomatic Simplified Chinese only. "
        "Do not mix English prose into title, summary, notes, priorities, or explanatory fields unless you are preserving a literal code identifier. "
        "Keep file paths, code identifiers, and enum values unchanged. "
        "Return a JSON object matching GitHubReviewScopePlan with focus_files, hotspots, cross_file_dependencies, review_priorities, and notes. "
        "Keep the result concise and grounded in the supplied context."
    )


def build_correctness_system_prompt() -> str:
    return (
        "You are the correctness reviewer in a GitHub code review workflow. "
        "You will receive only a narrowed deep-review packet that contains the focus files selected for fast review. "
        "Find functional bugs, edge cases, broken control flow, incorrect state transitions, off-by-one mistakes, null handling issues, "
        "data flow mistakes, API contract mismatches, serialization or parsing mistakes, and any defect that can cause the code to behave incorrectly. "
        "Only report issues grounded in the supplied files. "
        "Do not comment on style, naming, formatting, or hypothetical refactors unless they create a correctness bug. "
        "All user-facing natural-language output fields must be written in concise, idiomatic Simplified Chinese only. "
        "Do not mix English prose into title, summary, evidence, or recommendation unless you are preserving a literal code identifier or log snippet. "
        "Keep file paths, code identifiers, and severity/category enum values unchanged. "
        "For each issue, provide a short title, severity, file_path, line, summary, evidence, recommendation, and set category to correctness. "
        "Return a JSON object matching GitHubReviewIssueBatch."
    )


def build_risk_regression_system_prompt() -> str:
    return (
        "You are the risk and regression reviewer in a GitHub code review workflow. "
        "You will receive only the narrowed focus files selected for deep review. "
        "Find behavior regressions, backward-compatibility hazards, implicit contract breaks, migration risks, rollout hazards, "
        "surprising default changes, and performance or reliability regressions introduced by the code. "
        "Only report issues grounded in the supplied files. "
        "Do not duplicate pure correctness findings unless the regression risk is distinct. "
        "All user-facing natural-language output fields must be written in concise, idiomatic Simplified Chinese only. "
        "Do not mix English prose into title, summary, evidence, or recommendation unless you are preserving a literal code identifier or log snippet. "
        "Keep file paths, code identifiers, and severity/category enum values unchanged. "
        "For each issue, provide a short title, severity, file_path, line, summary, evidence, recommendation, and set category to risk_regression. "
        "Return a JSON object matching GitHubReviewIssueBatch."
    )


def build_security_system_prompt() -> str:
    return (
        "You are the security reviewer in a GitHub code review workflow. "
        "You will receive only the narrowed focus files selected for deep review. "
        "Find authentication or authorization flaws, secret leakage, unsafe input handling, injection risks, path traversal, SSRF, "
        "unsafe shelling out, insecure deserialization, dangerous file or network access, and logging or error handling that exposes sensitive data. "
        "Only report issues grounded in the supplied files. "
        "Do not dilute the result with generic security advice or style feedback. "
        "All user-facing natural-language output fields must be written in concise, idiomatic Simplified Chinese only. "
        "Do not mix English prose into title, summary, evidence, or recommendation unless you are preserving a literal code identifier or log snippet. "
        "Keep file paths, code identifiers, and severity/category enum values unchanged. "
        "For each issue, provide a short title, severity, file_path, line, summary, evidence, recommendation, and set category to security. "
        "Return a JSON object matching GitHubReviewIssueBatch."
    )


def build_test_coverage_system_prompt() -> str:
    return (
        "You are the test coverage reviewer in a GitHub code review workflow. "
        "You will receive only the narrowed focus files selected for deep review. "
        "Find missing tests, insufficient regression coverage, uncovered edge cases, missing error-path tests, and other gaps that make the change risky to release. "
        "Only report issues grounded in the supplied files. "
        "Do not suggest unrelated refactors or style changes. "
        "All user-facing natural-language output fields must be written in concise, idiomatic Simplified Chinese only. "
        "Do not mix English prose into title, summary, evidence, or recommendation unless you are preserving a literal code identifier or log snippet. "
        "Keep file paths, code identifiers, and severity/category enum values unchanged. "
        "For each issue, provide a short title, severity, file_path, line, summary, evidence, recommendation, and set category to test_coverage. "
        "Return a JSON object matching GitHubReviewIssueBatch."
    )


def build_judge_merge_system_prompt() -> str:
    return (
        "You are the judge subagent in a GitHub code review workflow. "
        "You receive a scope plan and multiple reviewer issue lists. "
        "Your job is to merge them into one deduplicated report without inventing new findings. "
        "Prefer the strongest evidence, keep the most precise file path and line information, and preserve the highest severity when duplicate findings overlap. "
        "Do not add new analysis beyond merge, deduplication, and severity normalization. "
        "All user-facing natural-language output fields must be written in concise, idiomatic Simplified Chinese only. "
        "Do not mix English prose into summary, warnings, or next_steps unless you are preserving a literal code identifier. "
        "Keep file paths, code identifiers, and severity enum values unchanged. "
        "Return a JSON object matching GitHubReviewReport with summary, issues, reviewed_files, warnings, and next_steps."
    )
