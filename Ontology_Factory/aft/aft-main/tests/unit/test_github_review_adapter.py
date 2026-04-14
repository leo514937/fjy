from __future__ import annotations

import json
import sys
import types

from ontology_audit_hub.infra.llm.github_review_agents import (
    GitHubReviewFile,
    GitHubReviewIssue,
    GitHubReviewIssueBatch,
    GitHubReviewPacket,
    GitHubReviewReport,
    GitHubReviewScopePlan,
)
from ontology_audit_hub.infra.llm.pydantic_ai_adapter import PydanticAILLMAdapter


class FakeAgent:
    def __init__(self, model_name, *, output_type, system_prompt):
        self.model_name = model_name
        self.output_type = output_type
        self.system_prompt = system_prompt

    def run_sync(self, prompt):
        payload = json.loads(prompt)
        if self.output_type is GitHubReviewScopePlan:
            return types.SimpleNamespace(
                output=GitHubReviewScopePlan(
                    focus_files=["src/app.py"],
                    hotspots=["src/app.py"],
                    cross_file_dependencies=["src/app.py -> src/security.py"],
                    review_priorities=["Check correctness first."],
                    notes=[payload["Stage"]],
                )
            )
        if self.output_type is GitHubReviewIssueBatch:
            return types.SimpleNamespace(
                output=GitHubReviewIssueBatch(
                    issues=[
                        GitHubReviewIssue(
                            title="Issue from fake reviewer",
                            severity="medium",
                            file_path="src/app.py",
                            line=7,
                            summary="A grounded review issue.",
                            evidence="7 | risky_call()",
                            recommendation="Guard the risky call.",
                            category="security",
                        )
                    ]
                )
            )
        if self.output_type is GitHubReviewReport:
            return types.SimpleNamespace(
                output=GitHubReviewReport(
                    summary="Merged fake report.",
                    issues=[],
                    reviewed_files=["src/app.py"],
                    warnings=payload["Warnings"],
                    next_steps=["Add a regression test."],
                )
            )
        return types.SimpleNamespace(output="")


def _sample_packet() -> GitHubReviewPacket:
    return GitHubReviewPacket(
        repository_url="https://github.com/example/repo",
        ref="main",
        review_request="Review the supplied repository snapshot.",
        paths=["src/app.py"],
        files=[
            GitHubReviewFile(
                path="src/app.py",
                content="1 | def run():\n2 |     risky_call()",
            )
        ],
    )


def test_pydantic_ai_adapter_supports_github_review_methods(monkeypatch) -> None:
    monkeypatch.setitem(sys.modules, "pydantic_ai", types.SimpleNamespace(Agent=FakeAgent))
    adapter = PydanticAILLMAdapter("openai:gpt-4o-mini")
    packet = _sample_packet()

    scope_plan = adapter.plan_review_scope(packet)
    issues = adapter.review_security(packet, scope_plan=scope_plan)
    report = adapter.judge_review_report(
        packet,
        scope_plan=scope_plan,
        correctness_issues=[],
        risk_regression_issues=[],
        security_issues=issues,
        test_coverage_issues=[],
        warnings=["Truncated large file before review: src/app.py"],
    )

    assert scope_plan is not None
    assert scope_plan.focus_files == ["src/app.py"]
    assert issues[0].category == "security"
    assert report is not None
    assert report.summary == "Merged fake report."
    assert report.reviewed_files == ["src/app.py"]
