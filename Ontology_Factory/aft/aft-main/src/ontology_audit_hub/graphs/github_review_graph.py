from __future__ import annotations

from langgraph.graph import END, START, StateGraph

from ontology_audit_hub.graphs.github_review_state import GitHubReviewState
from ontology_audit_hub.graphs.nodes.github_review.build_scope_packet import make_build_scope_packet_node
from ontology_audit_hub.graphs.nodes.github_review.correctness import make_correctness_review_node
from ontology_audit_hub.graphs.nodes.github_review.discover_candidate_files import (
    make_discover_candidate_files_node,
)
from ontology_audit_hub.graphs.nodes.github_review.download_snapshot import make_download_repository_snapshot_node
from ontology_audit_hub.graphs.nodes.github_review.local_merge_and_finalize import (
    make_local_merge_and_finalize_node,
)
from ontology_audit_hub.graphs.nodes.github_review.resolve_target import make_resolve_github_target_node
from ontology_audit_hub.graphs.nodes.github_review.risk_regression import make_risk_regression_review_node
from ontology_audit_hub.graphs.nodes.github_review.scope_planner import make_scope_planner_node
from ontology_audit_hub.graphs.nodes.github_review.security import make_security_review_node
from ontology_audit_hub.graphs.nodes.github_review.select_focus_files import make_select_focus_files_node
from ontology_audit_hub.graphs.nodes.github_review.test_coverage import make_test_coverage_review_node
from ontology_audit_hub.graphs.nodes.github_review.validate_request import make_validate_request_node
from ontology_audit_hub.infra.settings import AuditHubSettings


def build_github_review_graph(*, llm_adapter, settings: AuditHubSettings):
    graph = StateGraph(GitHubReviewState)
    graph.add_node("validate_request", make_validate_request_node())
    graph.add_node("resolve_github_target", make_resolve_github_target_node())
    graph.add_node("download_repository_snapshot", make_download_repository_snapshot_node(settings))
    graph.add_node("discover_candidate_files", make_discover_candidate_files_node(settings))
    graph.add_node("build_scope_packet", make_build_scope_packet_node(settings))
    graph.add_node("scope_planner", make_scope_planner_node(llm_adapter))
    graph.add_node("select_focus_files", make_select_focus_files_node(settings))
    graph.add_node("correctness", make_correctness_review_node(llm_adapter))
    graph.add_node("risk_regression", make_risk_regression_review_node(llm_adapter))
    graph.add_node("security", make_security_review_node(llm_adapter))
    graph.add_node("test_coverage", make_test_coverage_review_node(llm_adapter))
    graph.add_node("local_merge_and_finalize", make_local_merge_and_finalize_node())

    graph.add_edge(START, "validate_request")
    graph.add_edge("validate_request", "resolve_github_target")
    graph.add_edge("resolve_github_target", "download_repository_snapshot")
    graph.add_edge("download_repository_snapshot", "discover_candidate_files")
    graph.add_edge("discover_candidate_files", "build_scope_packet")
    graph.add_edge("build_scope_packet", "scope_planner")
    graph.add_edge("scope_planner", "select_focus_files")
    graph.add_edge("select_focus_files", "correctness")
    graph.add_edge("select_focus_files", "risk_regression")
    graph.add_edge("select_focus_files", "security")
    graph.add_edge("select_focus_files", "test_coverage")
    graph.add_edge(["correctness", "risk_regression", "security", "test_coverage"], "local_merge_and_finalize")
    graph.add_edge("local_merge_and_finalize", END)
    return graph.compile()
