from __future__ import annotations

from pathlib import Path

from ontology_audit_hub.graphs.github_review_state import GitHubReviewState
from ontology_audit_hub.infra.github_snapshot import collect_review_files


def make_collect_target_files_node():
    def collect_target_files_node(state: GitHubReviewState) -> GitHubReviewState:
        request = state["request"]
        snapshot_dir = Path(state["snapshot_dir"])
        selected_files, warnings = collect_review_files(snapshot_dir, list(request.paths))
        return {
            **state,
            "selected_files": selected_files,
            "warnings": list(dict.fromkeys(list(state.get("warnings", [])) + warnings)),
            "current_phase": "collect_target_files",
        }

    return collect_target_files_node
