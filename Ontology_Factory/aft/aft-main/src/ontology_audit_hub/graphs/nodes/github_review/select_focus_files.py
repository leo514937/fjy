from __future__ import annotations

from ontology_audit_hub.graphs.github_review_state import GitHubReviewState
from ontology_audit_hub.graphs.nodes.github_review._utils import (
    determine_enabled_reviewers,
    select_focus_paths,
)
from ontology_audit_hub.infra.github_snapshot import add_line_numbers, collect_focus_review_files
from ontology_audit_hub.infra.llm.github_review_agents import GitHubReviewFile, GitHubReviewStagePacket
from ontology_audit_hub.infra.settings import AuditHubSettings


def make_select_focus_files_node(settings: AuditHubSettings):
    def select_focus_files_node(state: GitHubReviewState) -> GitHubReviewState:
        request = state["request"]
        repo_target = state["repo_target"]
        candidate_files = list(state.get("candidate_files", []))
        scope_packet = state["scope_packet"]
        scope_plan = state.get("scope_plan")

        focus_paths = select_focus_paths(
            candidates=candidate_files,
            scope_plan=scope_plan,
            max_focus_files=settings.github_review_max_focus_files,
        )
        focus_files, new_warnings = collect_focus_review_files(
            candidate_files,
            focus_paths,
            max_focus_files=settings.github_review_max_focus_files,
            max_file_characters=settings.github_review_max_stage_file_chars,
            max_total_characters=settings.github_review_max_stage_total_chars,
        )
        merged_warnings = list(dict.fromkeys(list(state.get("warnings", [])) + new_warnings))
        if len(candidate_files) > len(focus_files):
            merged_warnings.append(f"为提升速度，仅深度审查了 {len(focus_files)}/{len(candidate_files)} 个候选文件。")

        stage_packet = GitHubReviewStagePacket(
            repository_url=repo_target.repository_url,
            ref=repo_target.ref,
            review_request=scope_packet.review_request,
            paths=list(request.paths),
            files=[
                GitHubReviewFile(
                    path=file.path,
                    content=add_line_numbers(file.content),
                    line_start=1,
                    line_end=max(1, file.content.count("\n") + 1),
                    truncated=file.truncated,
                )
                for file in focus_files
            ],
            warnings=list(dict.fromkeys(merged_warnings)),
            extra_context={
                "repository": repo_target.full_name,
                "requested_paths": list(request.paths),
                "candidate_file_count": len(candidate_files),
                "focus_file_count": len(focus_files),
                "focus_paths": focus_paths,
            },
        )
        enabled_reviewers = determine_enabled_reviewers(
            candidates=candidate_files,
            stage_packet=stage_packet,
        )
        return {
            "focus_files": focus_files,
            "review_packet": stage_packet,
            "stage_packet": stage_packet,
            "enabled_reviewers": enabled_reviewers,
            "warnings": list(dict.fromkeys(merged_warnings)),
            "current_phase": "select_focus_files",
        }

    return select_focus_files_node
