from __future__ import annotations

from ontology_audit_hub.graphs.github_review_state import GitHubReviewState
from ontology_audit_hub.graphs.nodes.github_review._utils import build_local_report, dedupe_issues, sort_issues


def make_aggregate_issues_node(llm_adapter):
    def aggregate_issues_node(state: GitHubReviewState) -> GitHubReviewState:
        review_packet = state["review_packet"]
        warnings = list(state.get("warnings", []))
        local_issues = sort_issues(
            dedupe_issues(
                list(state.get("correctness_issues", []))
                + list(state.get("risk_regression_issues", []))
                + list(state.get("security_issues", []))
                + list(state.get("test_coverage_issues", []))
            )
        )

        report = llm_adapter.judge_review_report(
            review_packet,
            scope_plan=state.get("scope_plan"),
            correctness_issues=list(state.get("correctness_issues", [])),
            risk_regression_issues=list(state.get("risk_regression_issues", [])),
            security_issues=list(state.get("security_issues", [])),
            test_coverage_issues=list(state.get("test_coverage_issues", [])),
            warnings=warnings,
        )
        if report is None:
            report = build_local_report(
                stage_packet=review_packet,
                issues=local_issues,
                warnings=warnings,
                enabled_reviewers=list(state.get("enabled_reviewers", [])),
                candidate_count=len(state.get("candidate_files", [])),
            )
        elif not report.issues and local_issues:
            report = report.model_copy(update={"issues": local_issues})

        return {
            **state,
            "merged_issues": local_issues,
            "final_report": report,
            "current_phase": "aggregate_issues",
        }

    return aggregate_issues_node
