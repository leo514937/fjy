from __future__ import annotations

from ontology_audit_hub.domain.review.models import GitHubReviewRequest
from ontology_audit_hub.graphs.github_review_state import GitHubReviewState


def make_validate_request_node():
    def validate_request_node(state: GitHubReviewState) -> GitHubReviewState:
        request = state["request"]
        normalized_paths: list[str] = []
        seen: set[str] = set()
        for raw_path in request.paths:
            cleaned = raw_path.replace("\\", "/").strip()
            if not cleaned or cleaned in seen:
                continue
            seen.add(cleaned)
            normalized_paths.append(cleaned)

        normalized_request = GitHubReviewRequest.model_validate(
            {
                "repository_url": request.repository_url.strip(),
                "ref": request.ref.strip(),
                "paths": normalized_paths,
                "request_id": request.request_id,
            }
        )
        return {
            "request": normalized_request,
            "warnings": list(state.get("warnings", [])),
            "current_phase": "validate_request",
        }

    return validate_request_node
