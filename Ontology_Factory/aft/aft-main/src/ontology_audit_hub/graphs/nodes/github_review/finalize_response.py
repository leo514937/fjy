from __future__ import annotations

from ontology_audit_hub.domain.review.models import GitHubReviewResponse
from ontology_audit_hub.graphs.github_review_state import GitHubReviewState
from ontology_audit_hub.graphs.nodes.github_review._utils import build_local_report, to_domain_issue
from ontology_audit_hub.infra.llm.github_review_agents import GitHubReviewReport


def make_finalize_response_node():
    def finalize_response_node(state: GitHubReviewState) -> GitHubReviewState:
        report = state.get("final_report")
        stage_packet = state["stage_packet"]
        if isinstance(report, GitHubReviewResponse):
            return {
                **state,
                "final_report": report,
                "current_phase": "finalize_response",
            }
        if isinstance(report, GitHubReviewReport):
            llm_report = report
        else:
            response = build_local_report(
                stage_packet=stage_packet,
                issues=list(state.get("merged_issues", [])),
                warnings=list(state.get("warnings", [])),
                enabled_reviewers=list(state.get("enabled_reviewers", [])),
                candidate_count=len(state.get("candidate_files", [])),
            )
            return {
                **state,
                "final_report": response,
                "current_phase": "finalize_response",
            }

        reviewed_files = llm_report.reviewed_files or [file.path for file in stage_packet.files]
        response = GitHubReviewResponse(
            summary=llm_report.summary,
            issues=[to_domain_issue(issue) for issue in llm_report.issues],
            reviewed_files=reviewed_files,
            warnings=list(dict.fromkeys(llm_report.warnings or list(state.get("warnings", [])))),
            next_steps=list(dict.fromkeys(llm_report.next_steps)),
        )
        return {
            **state,
            "final_report": response,
            "current_phase": "finalize_response",
        }

    return finalize_response_node
