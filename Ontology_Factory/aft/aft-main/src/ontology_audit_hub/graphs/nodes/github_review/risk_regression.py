from __future__ import annotations

from ontology_audit_hub.graphs.github_review_state import GitHubReviewState


def make_risk_regression_review_node(llm_adapter):
    def risk_regression_review_node(state: GitHubReviewState) -> GitHubReviewState:
        if "risk_regression" not in set(state.get("enabled_reviewers", [])):
            return {"risk_regression_issues": []}
        issues = llm_adapter.review_risk_regression(
            state["stage_packet"],
            scope_plan=state.get("scope_plan"),
        )
        return {"risk_regression_issues": list(issues or [])}

    return risk_regression_review_node
