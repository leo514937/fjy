from __future__ import annotations

from typing import Literal

from langgraph.graph import END, START, StateGraph

from ontology_audit_hub.graphs.nodes.aggregation import (
    aggregate_findings_node,
    make_enrich_findings_node,
    severity_ranking_node,
)
from ontology_audit_hub.graphs.nodes.finalize_report import make_finalize_report_node
from ontology_audit_hub.graphs.nodes.human_input import make_human_input_node
from ontology_audit_hub.graphs.nodes.intent_router import make_intent_router_node
from ontology_audit_hub.graphs.nodes.request_loader import make_load_request_node
from ontology_audit_hub.graphs.state import GraphState
from ontology_audit_hub.graphs.subgraphs.code_subgraph import build_code_subgraph
from ontology_audit_hub.graphs.subgraphs.document_subgraph import build_document_subgraph
from ontology_audit_hub.graphs.subgraphs.ontology_subgraph import build_ontology_subgraph
from ontology_audit_hub.infra.runtime import GraphRuntime


def route_to_subgraph_node(state: GraphState) -> GraphState:
    label = state.get("intent_label", state.get("audit_mode", "unknown"))
    target = {
        "ontology": "ontology_audit",
        "document": "document_review",
        "code": "code_test",
        "full": "full_audit",
    }.get(label, "aggregate_findings")
    return {
        **state,
        "current_phase": "route_to_subgraph",
        "current_target": target,
    }


def route_to_target(state: GraphState) -> Literal[
    "ontology_audit", "document_review", "code_test", "full_audit", "aggregate_findings"
]:
    return state.get("current_target", "aggregate_findings")  # type: ignore[return-value]


def route_after_severity(state: GraphState) -> Literal["human_input", "finalize_report"]:
    return "human_input" if state.get("needs_human_input") else "finalize_report"


def route_after_human_input(state: GraphState) -> Literal["route_to_subgraph", "finalize_report"]:
    return "route_to_subgraph" if state.get("resume_after_human_input") else "finalize_report"


def build_full_audit_subgraph(ontology_graph, document_graph, code_graph):
    def run_ontology(state: GraphState) -> GraphState:
        return ontology_graph.invoke(state)

    def run_document(state: GraphState) -> GraphState:
        return document_graph.invoke(state)

    def run_code(state: GraphState) -> GraphState:
        return code_graph.invoke(state)

    graph = StateGraph(GraphState)
    graph.add_node("ontology_stage", run_ontology)
    graph.add_node("document_stage", run_document)
    graph.add_node("code_stage", run_code)
    graph.add_edge(START, "ontology_stage")
    graph.add_edge("ontology_stage", "document_stage")
    graph.add_edge("document_stage", "code_stage")
    graph.add_edge("code_stage", END)
    return graph.compile()


def build_supervisor_graph(
    *,
    runtime: GraphRuntime | None = None,
    checkpointer=None,
    interrupt_before: list[str] | None = None,
):
    runtime = runtime or GraphRuntime()
    ontology_graph = build_ontology_subgraph()
    document_graph = build_document_subgraph(runtime=runtime)
    code_graph = build_code_subgraph(runtime=runtime)
    full_graph = build_full_audit_subgraph(ontology_graph, document_graph, code_graph)

    def run_ontology(state: GraphState) -> GraphState:
        return ontology_graph.invoke(state)

    def run_document(state: GraphState) -> GraphState:
        return document_graph.invoke(state)

    def run_code(state: GraphState) -> GraphState:
        return code_graph.invoke(state)

    def run_full(state: GraphState) -> GraphState:
        return full_graph.invoke(state)

    graph = StateGraph(GraphState)
    graph.add_node("load_request", make_load_request_node(runtime.diagnostic_findings))
    graph.add_node("intent_router", make_intent_router_node(runtime.llm_adapter))
    graph.add_node("route_to_subgraph", route_to_subgraph_node)
    graph.add_node("ontology_audit", run_ontology)
    graph.add_node("document_review", run_document)
    graph.add_node("code_test", run_code)
    graph.add_node("full_audit", run_full)
    graph.add_node("aggregate_findings", aggregate_findings_node)
    graph.add_node("enrich_findings", make_enrich_findings_node(runtime.graph_augmenter))
    graph.add_node("severity_ranking", severity_ranking_node)
    graph.add_node("human_input", make_human_input_node(runtime.interrupt_on_human, runtime.llm_adapter))
    graph.add_node("finalize_report", make_finalize_report_node(runtime.llm_adapter))

    graph.add_edge(START, "load_request")
    graph.add_edge("load_request", "intent_router")
    graph.add_edge("intent_router", "route_to_subgraph")
    graph.add_conditional_edges("route_to_subgraph", route_to_target)
    graph.add_edge("ontology_audit", "aggregate_findings")
    graph.add_edge("document_review", "aggregate_findings")
    graph.add_edge("code_test", "aggregate_findings")
    graph.add_edge("full_audit", "aggregate_findings")
    graph.add_edge("aggregate_findings", "enrich_findings")
    graph.add_edge("enrich_findings", "severity_ranking")
    graph.add_conditional_edges("severity_ranking", route_after_severity)
    graph.add_conditional_edges("human_input", route_after_human_input)
    graph.add_edge("finalize_report", END)
    return graph.compile(checkpointer=checkpointer, interrupt_before=interrupt_before or [])
