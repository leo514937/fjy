from __future__ import annotations

"""构建 LangGraph 状态机，并把仲裁结果映射成流程走向。"""

from langgraph.graph import END, START, StateGraph

from ontology_negotiator.models import NegotiationState


def route_after_arbiter(state: NegotiationState) -> str:
    """是否重审只看 Arbiter 的明确动作。"""
    return "proposer_agent" if state.get("arbiter_action") == "retry" else "evaluator_agent"


def build_negotiation_graph(agents: object):
    """按照 proposer -> critic -> arbiter -> evaluator 组装状态机。"""
    workflow = StateGraph(NegotiationState)
    workflow.add_node("proposer_agent", agents.proposer_agent)
    workflow.add_node("critic_agent", agents.critic_agent)
    workflow.add_node("arbiter_node", agents.arbiter_node)
    workflow.add_node("evaluator_agent", agents.evaluator_agent)

    workflow.add_edge(START, "proposer_agent")
    workflow.add_edge("proposer_agent", "critic_agent")
    workflow.add_edge("critic_agent", "arbiter_node")
    workflow.add_conditional_edges(
        "arbiter_node",
        route_after_arbiter,
        {
            "proposer_agent": "proposer_agent",
            "evaluator_agent": "evaluator_agent",
        },
    )
    workflow.add_edge("evaluator_agent", END)
    return workflow.compile()
