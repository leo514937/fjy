from __future__ import annotations

from ontology_audit_hub.graphs.github_review_state import GitHubReviewState


def make_test_coverage_review_node(llm_adapter):
    def test_coverage_review_node(state: GitHubReviewState) -> GitHubReviewState:
        if "test_coverage" not in set(state.get("enabled_reviewers", [])):
            return {"test_coverage_issues": []}
        issues = llm_adapter.review_test_coverage(
            state["stage_packet"],
            scope_plan=state.get("scope_plan"),
        )
        return {"test_coverage_issues": list(issues or [])}

    return test_coverage_review_node
