from __future__ import annotations

from ontology_audit_hub.graphs.github_review_state import GitHubReviewState
from ontology_audit_hub.graphs.nodes.github_review._utils import build_fallback_scope_plan


def make_scope_planner_node(llm_adapter):
    def scope_planner_node(state: GitHubReviewState) -> GitHubReviewState:
        review_packet = state["scope_packet"]
        scope_plan = llm_adapter.plan_review_scope(review_packet) or build_fallback_scope_plan(review_packet)
        return {
            "scope_plan": scope_plan,
            "current_phase": "scope_planner",
        }

    return scope_planner_node
