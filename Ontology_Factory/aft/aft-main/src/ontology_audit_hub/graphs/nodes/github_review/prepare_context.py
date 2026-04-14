from __future__ import annotations

from ontology_audit_hub.graphs.github_review_state import GitHubReviewState
from ontology_audit_hub.infra.github_snapshot import add_line_numbers
from ontology_audit_hub.infra.llm.github_review_agents import GitHubReviewFile, GitHubReviewPacket

DEFAULT_REVIEW_REQUEST = (
    "Review the supplied GitHub repository snapshot. Focus on bugs, behavior regressions, security issues, "
    "and missing test coverage. Avoid generic style commentary unless it creates concrete risk."
)


def make_prepare_review_context_node():
    def prepare_review_context_node(state: GitHubReviewState) -> GitHubReviewState:
        request = state["request"]
        repo_target = state["repo_target"]
        selected_files = list(state.get("selected_files", []))
        review_files = [
            GitHubReviewFile(
                path=file.path,
                content=add_line_numbers(file.content),
                line_start=1,
                line_end=max(1, file.content.count("\n") + 1),
                truncated=file.truncated,
            )
            for file in selected_files
        ]
        review_packet = GitHubReviewPacket(
            repository_url=repo_target.repository_url,
            ref=repo_target.ref,
            review_request=DEFAULT_REVIEW_REQUEST,
            paths=list(request.paths),
            files=review_files,
            warnings=list(state.get("warnings", [])),
            extra_context={
                "repository": repo_target.full_name,
                "requested_paths": list(request.paths),
                "selected_file_count": len(review_files),
            },
        )
        return {
            **state,
            "review_packet": review_packet,
            "current_phase": "prepare_review_context",
        }

    return prepare_review_context_node
