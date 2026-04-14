from __future__ import annotations

from pathlib import Path

from ontology_audit_hub.graphs.github_review_state import GitHubReviewState
from ontology_audit_hub.infra.github_snapshot import discover_review_candidates
from ontology_audit_hub.infra.settings import AuditHubSettings


def make_discover_candidate_files_node(settings: AuditHubSettings):
    def discover_candidate_files_node(state: GitHubReviewState) -> GitHubReviewState:
        request = state["request"]
        snapshot_dir = Path(state["snapshot_dir"])
        candidates, warnings = discover_review_candidates(
            snapshot_dir,
            list(request.paths),
            max_candidates=settings.github_review_max_candidates,
        )
        merged_warnings = list(dict.fromkeys(list(state.get("warnings", [])) + warnings))
        return {
            "candidate_files": candidates,
            "warnings": merged_warnings,
            "current_phase": "discover_candidate_files",
        }

    return discover_candidate_files_node
