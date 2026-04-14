from __future__ import annotations

"""Artifact persistence helpers."""

import json
from pathlib import Path
from typing import Any

from ontology_negotiator.errors import NegotiationExecutionError
from ontology_negotiator.evaluator import build_reasoning, build_xiaogu_list
from ontology_negotiator.models import (
    ClassificationResult,
    EpistemologyPayload,
    GraphInput,
    LogicTracePayload,
    NegotiationState,
)


class ArtifactManager:
    def __init__(self, artifact_root: Path | str | None = None) -> None:
        project_root = Path(__file__).resolve().parents[2]
        self.root = Path(artifact_root) if artifact_root else project_root / "artifacts"
        self.rules_dir = self.root / "rules"
        self.results_dir = self.root / "results"
        self.diagnostics_dir = self.results_dir / "diagnostics"
        self.debates_dir = self.diagnostics_dir / "debates"
        self.ensure_directories()

    def ensure_directories(self) -> None:
        self.rules_dir.mkdir(parents=True, exist_ok=True)
        self.results_dir.mkdir(parents=True, exist_ok=True)
        self.diagnostics_dir.mkdir(parents=True, exist_ok=True)
        self.debates_dir.mkdir(parents=True, exist_ok=True)

    def _resolve_ran(self, state: NegotiationState) -> str:
        node_data = state["node_data"]
        properties = node_data.get("properties", {})
        if properties.get("ran"):
            return str(properties["ran"])
        generated_ran = state.get("evaluation_report", {}).get("generated_ran")
        if generated_ran:
            return str(generated_ran)
        raise NegotiationExecutionError(
            node_id=node_data.get("node_id"),
            agent_name="evaluator_agent",
            stage="result_assembly",
            iteration=int(state.get("iterations", 1)),
            message="Missing ran and evaluator did not generate one.",
            raw_response=state.get("evaluation_report", {}),
            prompt_name="evaluator_system",
        )

    def _resolve_ti(self, state: NegotiationState) -> str:
        node_data = state["node_data"]
        properties = node_data.get("properties", {})
        if properties.get("ti"):
            return str(properties["ti"])
        generated_ti = state.get("evaluation_report", {}).get("generated_ti")
        if generated_ti:
            return str(generated_ti)
        raise NegotiationExecutionError(
            node_id=node_data.get("node_id"),
            agent_name="evaluator_agent",
            stage="result_assembly",
            iteration=int(state.get("iterations", 1)),
            message="Missing ti and evaluator did not generate one.",
            raw_response=state.get("evaluation_report", {}),
            prompt_name="evaluator_system",
        )

    def state_to_result(self, state: NegotiationState) -> ClassificationResult:
        node_data = state["node_data"]
        final_label = state.get("final_label")
        if final_label is None:
            raise NegotiationExecutionError(
                node_id=node_data.get("node_id"),
                agent_name="arbiter",
                stage="result_assembly",
                iteration=int(state.get("iterations", 1)),
                message="Missing final_label when assembling final result.",
                raw_response=state,
                prompt_name="arbiter_system",
            )
        return ClassificationResult(
            node_id=node_data["node_id"],
            info_name=node_data["name"],
            ontology_label=final_label,
            confidence=round(float(state.get("confidence_score", 0.0)), 2),
            epistemology=EpistemologyPayload(
                l_mapping=node_data.get("l_level", ""),
                ran=self._resolve_ran(state),
                ti=self._resolve_ti(state),
            ),
            logic_trace=LogicTracePayload(
                reasoning=build_reasoning(state),
                xiaogu_list=build_xiaogu_list(state),
            ),
        )

    def write_debate(self, state: NegotiationState, result: ClassificationResult) -> Path:
        node_id = state["node_data"]["node_id"]
        payload: dict[str, Any] = {
            "node_data": state["node_data"],
            "graph_context": state.get("graph_context", {}),
            "vault_context": state.get("vault_context", {}),
            "evidence_pack": state.get("evidence_pack", {}),
            "proposal": state.get("proposal", {}),
            "critique": state.get("critique", {}),
            "iterations": state.get("iterations", 1),
            "debate_focus": state.get("debate_focus", ""),
            "debate_gaps": state.get("debate_gaps", []),
            "round_summaries": state.get("round_summaries", []),
            "working_memory": state.get("working_memory", {}),
            "persistent_evidence": state.get("persistent_evidence", []),
            "resolved_evidence": state.get("resolved_evidence", []),
            "evidence_events": state.get("evidence_events", []),
            "audit_history": state.get("history", []),
            "consensus_reached": state.get("consensus_reached", False),
            "arbiter_action": state.get("arbiter_action"),
            "arbiter_summary": state.get("arbiter_summary", ""),
            "final_label": state.get("final_label"),
            "loop_detected": state.get("loop_detected", False),
            "loop_reason": state.get("loop_reason", ""),
            "case_closed": state.get("case_closed", False),
            "confidence_score": state.get("confidence_score", 0.0),
            "evaluation_report": state.get("evaluation_report", {}),
            "agent_errors": state.get("agent_errors", []),
            "llm_trace": state.get("llm_trace", []),
            "result": result.model_dump(mode="json"),
        }
        debate_path = self.debates_dir / f"{node_id}.json"
        debate_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        return debate_path

    def write_results(self, graph: GraphInput, results: list[ClassificationResult]) -> dict[str, Path]:
        results_payload = [item.model_dump(mode="json") for item in results]
        results_path = self.results_dir / "ontology_results.json"
        results_path.write_text(json.dumps(results_payload, ensure_ascii=False, indent=2), encoding="utf-8")

        result_map = {item.node_id: item.model_dump(mode="json") for item in results}
        labeled_nodes = []
        for node in graph.nodes:
            base_node = node.model_dump(mode="json")
            result = result_map.get(node.node_id)
            if result:
                base_node["ontology_label"] = result["ontology_label"]
                base_node["confidence"] = result["confidence"]
                base_node["epistemology"] = result["epistemology"]
                base_node["logic_trace"] = result["logic_trace"]
            labeled_nodes.append(base_node)

        labeled_graph_path = self.results_dir / "labeled_graph.json"
        labeled_graph_path.write_text(
            json.dumps(
                {
                    "nodes": labeled_nodes,
                    "edges": [edge.model_dump(mode="json") for edge in graph.edges],
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
        return {
            "ontology_results": results_path,
            "labeled_graph": labeled_graph_path,
        }
