from __future__ import annotations

from ontology_audit_hub.graphs.github_review_state import GitHubReviewState


def make_correctness_review_node(llm_adapter):
    def correctness_review_node(state: GitHubReviewState) -> GitHubReviewState:
        issues = llm_adapter.review_correctness(
            state["stage_packet"],
            scope_plan=state.get("scope_plan"),
        )
        return {"correctness_issues": list(issues or [])}

    return correctness_review_node
