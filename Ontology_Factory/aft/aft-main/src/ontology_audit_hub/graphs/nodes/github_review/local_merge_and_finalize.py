from __future__ import annotations

from ontology_audit_hub.graphs.github_review_state import GitHubReviewState
from ontology_audit_hub.graphs.nodes.github_review._utils import build_local_report, dedupe_issues, sort_issues


def make_local_merge_and_finalize_node():
    def local_merge_and_finalize_node(state: GitHubReviewState) -> GitHubReviewState:
        merged_issues = sort_issues(
            dedupe_issues(
                list(state.get("correctness_issues", []))
                + list(state.get("risk_regression_issues", []))
                + list(state.get("security_issues", []))
                + list(state.get("test_coverage_issues", []))
            )
        )
        final_report = build_local_report(
            stage_packet=state["stage_packet"],
            issues=merged_issues,
            warnings=list(state.get("warnings", [])),
            enabled_reviewers=list(state.get("enabled_reviewers", [])),
            candidate_count=len(state.get("candidate_files", [])),
        )
        return {
            "merged_issues": merged_issues,
            "final_report": final_report,
            "current_phase": "local_merge_and_finalize",
        }

    return local_merge_and_finalize_node
