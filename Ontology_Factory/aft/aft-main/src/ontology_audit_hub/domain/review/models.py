from __future__ import annotations

from typing import Any, Literal
from urllib.parse import urlparse

from pydantic import BaseModel, Field, field_validator, model_validator


class GitHubReviewRequest(BaseModel):
    repository_url: str
    ref: str
    paths: list[str] = Field(default_factory=list)
    request_id: str | None = None

    @field_validator("repository_url", "ref")
    @classmethod
    def _strip_required_text(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("不能为空")
        return cleaned

    @field_validator("request_id")
    @classmethod
    def _normalize_request_id(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        return cleaned or None

    @field_validator("repository_url")
    @classmethod
    def _validate_repository_url(cls, value: str) -> str:
        parsed = urlparse(value)
        host = (parsed.hostname or "").lower()
        if parsed.scheme not in {"http", "https"} or not host:
            raise ValueError("repository_url 必须是 http(s) GitHub URL")
        if host != "github.com" and not host.endswith(".github.com"):
            raise ValueError("repository_url 必须指向 github.com")
        return value.rstrip("/")

    @field_validator("paths")
    @classmethod
    def _normalize_paths(cls, value: list[str]) -> list[str]:
        cleaned_paths: list[str] = []
        for item in value:
            path = item.strip()
            if not path:
                raise ValueError("paths 不能包含空值")
            cleaned_paths.append(path)
        return cleaned_paths

    @model_validator(mode="after")
    def _validate_paths(self) -> GitHubReviewRequest:
        if not self.paths:
            raise ValueError("至少要提供一个路径")
        return self


class GitHubReviewCancelRequest(BaseModel):
    request_id: str

    @field_validator("request_id")
    @classmethod
    def _strip_request_id(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("request_id 不能为空")
        return cleaned


class GitHubReviewIssue(BaseModel):
    title: str
    severity: Literal["critical", "high", "medium", "low", "info"]
    file_path: str
    line: int | None = None
    summary: str
    evidence: str
    recommendation: str


class GitHubRepoTarget(BaseModel):
    repository_url: str
    owner: str
    repo: str
    ref: str
    archive_url: str

    @property
    def full_name(self) -> str:
        return f"{self.owner}/{self.repo}"


class GitHubReviewResponse(BaseModel):
    summary: str
    issues: list[GitHubReviewIssue] = Field(default_factory=list)
    reviewed_files: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    next_steps: list[str] = Field(default_factory=list)


class GitHubReviewProgress(BaseModel):
    phase: str
    completed_phases: int = Field(ge=0)
    total_phases: int = Field(ge=1)


class GitHubReviewPartialReport(BaseModel):
    category: Literal["correctness", "risk_regression", "security", "test_coverage"]
    issues: list[GitHubReviewIssue] = Field(default_factory=list)
    reviewed_files: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class GitHubReviewErrorResponse(BaseModel):
    status: str = "error"
    message: str
    errors: list[dict[str, Any]] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
