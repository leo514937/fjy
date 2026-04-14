from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class TopicCandidate(BaseModel):
    title: str
    page_type: str = "topic"
    reason: str = ""
    seed_sentences: list[str] = Field(default_factory=list)


class ToolCallDecision(BaseModel):
    kind: Literal["tool_call"] = "tool_call"
    thought: str = ""
    action_name: str
    action_input: dict[str, Any] = Field(default_factory=dict)


class FinalCommitPayload(BaseModel):
    title: str
    page_type: str = "topic"
    summary: str = ""
    content_markdown: str
    sources: list[dict[str, str]] = Field(default_factory=list)
    related_pages: list[str] = Field(default_factory=list)
    reason: str = ""


class FinalCommitDecision(BaseModel):
    kind: Literal["final_commit"] = "final_commit"
    thought: str = ""
    commit: FinalCommitPayload


class AgentTraceRecord(BaseModel):
    thought: str = ""
    action_name: str
    action_input: dict[str, Any] = Field(default_factory=dict)
    observation: dict[str, Any] = Field(default_factory=dict)


class PageExecutionResult(BaseModel):
    title: str
    page_id: str = ""
    layer: str = "domain"
    doc_ref: str = ""
    file_path: str = ""
    revision_id: str = ""
    status: Literal["created", "updated", "skipped", "failed"] = "skipped"
    page_type: str = "topic"
    related_pages: list[str] = Field(default_factory=list)
    error: str = ""
    trace: list[AgentTraceRecord] = Field(default_factory=list)
