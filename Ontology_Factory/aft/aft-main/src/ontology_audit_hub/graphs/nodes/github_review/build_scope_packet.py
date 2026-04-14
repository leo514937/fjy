from __future__ import annotations

from ontology_audit_hub.graphs.github_review_state import GitHubReviewState
from ontology_audit_hub.infra.llm.github_review_agents import GitHubReviewScopePacket, GitHubScopeCandidate
from ontology_audit_hub.infra.settings import AuditHubSettings

DEFAULT_REVIEW_REQUEST = (
    "请审查提供的 GitHub 仓库快照，重点关注 bug、行为回归、安全问题和缺失测试；"
    "除非会形成具体风险，否则不要给出泛泛的风格建议。"
)


def make_build_scope_packet_node(settings: AuditHubSettings):
    def build_scope_packet_node(state: GitHubReviewState) -> GitHubReviewState:
        request = state["request"]
        repo_target = state["repo_target"]
        candidates = list(state.get("candidate_files", []))
        limited_candidates = candidates[: settings.github_review_max_scope_files]
        warnings = list(state.get("warnings", []))
        if len(candidates) > len(limited_candidates):
            warnings = list(
                dict.fromkeys(
                    warnings
                    + [
                        f"范围规划仅摘要前 {settings.github_review_max_scope_files} 个候选文件。"
                    ]
                )
            )

        scope_packet = GitHubReviewScopePacket(
            repository_url=repo_target.repository_url,
            ref=repo_target.ref,
            review_request=DEFAULT_REVIEW_REQUEST,
            paths=list(request.paths),
            candidates=[
                GitHubScopeCandidate(
                    path=candidate.path,
                    file_type=candidate.file_type,
                    size_bytes=candidate.size_bytes,
                    is_explicit=candidate.is_explicit,
                    truncated=candidate.truncated,
                    imports_summary=list(candidate.imports_summary),
                    declarations_summary=list(candidate.declarations_summary),
                    head_excerpt=candidate.head_excerpt,
                    tail_excerpt=candidate.tail_excerpt,
                )
                for candidate in limited_candidates
            ],
            warnings=warnings,
            extra_context={
                "repository": repo_target.full_name,
                "requested_paths": list(request.paths),
                "candidate_file_count": len(candidates),
                "scope_candidate_count": len(limited_candidates),
            },
        )
        return {
            "scope_packet": scope_packet,
            "warnings": warnings,
            "current_phase": "build_scope_packet",
        }

    return build_scope_packet_node
