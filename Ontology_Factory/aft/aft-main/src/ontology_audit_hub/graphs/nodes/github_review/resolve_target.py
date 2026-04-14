from __future__ import annotations

from ontology_audit_hub.graphs.github_review_state import GitHubReviewState
from ontology_audit_hub.infra.github_snapshot import parse_github_repo_target


def make_resolve_github_target_node():
    def resolve_github_target_node(state: GitHubReviewState) -> GitHubReviewState:
        request = state["request"]
        repo_target = parse_github_repo_target(request.repository_url, request.ref)
        return {
            "repo_target": repo_target,
            "current_phase": "resolve_github_target",
        }

    return resolve_github_target_node
