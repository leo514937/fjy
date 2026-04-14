from __future__ import annotations

from ontology_audit_hub.graphs.github_review_state import GitHubReviewState


def make_security_review_node(llm_adapter):
    def security_review_node(state: GitHubReviewState) -> GitHubReviewState:
        if "security" not in set(state.get("enabled_reviewers", [])):
            return {"security_issues": []}
        issues = llm_adapter.review_security(
            state["stage_packet"],
            scope_plan=state.get("scope_plan"),
        )
        return {"security_issues": list(issues or [])}

    return security_review_node
