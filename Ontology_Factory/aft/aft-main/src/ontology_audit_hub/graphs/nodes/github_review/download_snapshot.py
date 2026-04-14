from __future__ import annotations

from pathlib import Path

from ontology_audit_hub.graphs.github_review_state import GitHubReviewState
from ontology_audit_hub.infra.github_snapshot import download_repository_snapshot
from ontology_audit_hub.infra.settings import AuditHubSettings


def make_download_repository_snapshot_node(settings: AuditHubSettings):
    def download_repository_snapshot_node(state: GitHubReviewState) -> GitHubReviewState:
        repo_target = state["repo_target"]
        workspace_dir = state.get("snapshot_workspace_dir")
        destination_root = Path(workspace_dir) if workspace_dir else settings.run_root / "github_reviews"
        snapshot_dir = download_repository_snapshot(
            repo_target,
            destination_root=destination_root,
            timeout_seconds=settings.github_review_download_timeout_seconds,
        )
        return {
            "snapshot_dir": str(snapshot_dir),
            "current_phase": "download_repository_snapshot",
        }

    return download_repository_snapshot_node
