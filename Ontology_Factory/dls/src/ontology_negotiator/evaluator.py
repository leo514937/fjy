from __future__ import annotations

"""提供从 Evaluator 输出中提取最终解释字段的辅助函数。"""

from ontology_negotiator.errors import NegotiationExecutionError
from ontology_negotiator.models import NegotiationState


def build_reasoning(state: NegotiationState) -> str:
    """优先使用 Evaluator 的结构化 reasoning 作为最终对外解释。"""
    evaluation_report = state.get("evaluation_report", {})
    reasoning = str(evaluation_report.get("reasoning", "")).strip()
    if reasoning:
        return reasoning
    raise NegotiationExecutionError(
        node_id=state.get("node_data", {}).get("node_id"),
        agent_name="evaluator_agent",
        stage="result_assembly",
        iteration=int(state.get("iterations", 1)),
        message="缺少 Evaluator 输出的 reasoning。",
        raw_response=evaluation_report,
        prompt_name="evaluator_system",
    )


def build_xiaogu_list(state: NegotiationState) -> list[str]:
    """直接使用 Evaluator 产出的关联证据节点列表。"""
    evaluation_report = state.get("evaluation_report", {})
    xiaogu_list = evaluation_report.get("xiaogu_list")
    if isinstance(xiaogu_list, list):
        return [str(item) for item in xiaogu_list]
    raise NegotiationExecutionError(
        node_id=state.get("node_data", {}).get("node_id"),
        agent_name="evaluator_agent",
        stage="result_assembly",
        iteration=int(state.get("iterations", 1)),
        message="缺少 Evaluator 输出的 xiaogu_list。",
        raw_response=evaluation_report,
        prompt_name="evaluator_system",
    )
