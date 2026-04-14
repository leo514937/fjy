from __future__ import annotations

"""Main entrypoint for graph-wide ontology negotiation."""

from concurrent.futures import FIRST_COMPLETED, Future, ThreadPoolExecutor, wait
from dataclasses import dataclass
from pathlib import Path
import threading
from typing import Any

from ontology_negotiator.agents import NegotiationAgents
from ontology_negotiator.artifacts import ArtifactManager
from ontology_negotiator.config import build_chat_openai_kwargs, load_app_config
from ontology_negotiator.errors import NegotiationConfigurationError
from ontology_negotiator.graph_builder import build_negotiation_graph
from ontology_negotiator.models import ClassificationResult, GraphContext, GraphInput, GraphNode, NegotiationState
from ontology_negotiator.vault import match_vault

try:
    from langchain_openai import ChatOpenAI
except Exception:
    ChatOpenAI = None


DEFAULT_MAX_CONCURRENCY = 3
MAX_ALLOWED_CONCURRENCY = 6


@dataclass
class NegotiationRuntime:
    agents: NegotiationAgents
    workflow: Any


class OntologyNegotiator:
    def __init__(
        self,
        llm: Any | None = None,
        artifact_root: Path | str | None = None,
        model_name: str | None = None,
        llm_kwargs: dict[str, Any] | None = None,
        config_path: Path | str | None = None,
    ) -> None:
        self.config_path = Path(config_path) if config_path else None
        self.app_config = load_app_config(self.config_path)
        self.retry_policy = self.app_config.llm_retry
        self.fallback_llm = self._build_fallback_llm(model_name=model_name, llm_kwargs=llm_kwargs or {})
        if llm is not None:
            self.llm = llm
        else:
            self.llm = self._build_llm(model_name=model_name, llm_kwargs=llm_kwargs or {})
        if self.llm is None:
            raise NegotiationConfigurationError("No usable LLM is configured.")
        if not hasattr(self.llm, "generate_json") and not hasattr(self.llm, "invoke"):
            raise NegotiationConfigurationError("LLM must support generate_json or invoke.")
        self.artifacts = ArtifactManager(artifact_root=artifact_root)
        self._thread_local = threading.local()

    def _build_llm(self, model_name: str | None, llm_kwargs: dict[str, Any]) -> Any | None:
        if ChatOpenAI is None:
            if model_name or self.app_config.openai.model or self.app_config.openai.api_key:
                raise NegotiationConfigurationError("langchain_openai is required for configured OpenAI access.")
            return None

        chat_openai_kwargs = build_chat_openai_kwargs(
            app_config=self.app_config,
            model_name=model_name,
            llm_kwargs=llm_kwargs,
        )
        if not chat_openai_kwargs.get("model"):
            return None
        if not chat_openai_kwargs.get("api_key"):
            raise NegotiationConfigurationError("Missing openai.api_key for model invocation.")
        if "model_kwargs" not in chat_openai_kwargs:
            chat_openai_kwargs["model_kwargs"] = {"response_format": {"type": "json_object"}}
        return ChatOpenAI(**chat_openai_kwargs)

    def _build_fallback_llm(self, model_name: str | None, llm_kwargs: dict[str, Any]) -> Any | None:
        fallback_model = self.app_config.openai.fallback_model.strip()
        if not fallback_model:
            return None
        if ChatOpenAI is None:
            raise NegotiationConfigurationError("langchain_openai is required for configured fallback access.")
        fallback_kwargs = build_chat_openai_kwargs(
            app_config=self.app_config,
            model_name=fallback_model,
            llm_kwargs=llm_kwargs,
        )
        if not fallback_kwargs.get("model"):
            return None
        if not fallback_kwargs.get("api_key"):
            raise NegotiationConfigurationError("Missing openai.api_key for fallback model invocation.")
        if "model_kwargs" not in fallback_kwargs:
            fallback_kwargs["model_kwargs"] = {"response_format": {"type": "json_object"}}
        return ChatOpenAI(**fallback_kwargs)

    def _build_runtime(self) -> NegotiationRuntime:
        agents = NegotiationAgents(llm=self.llm, fallback_llm=self.fallback_llm, retry_policy=self.retry_policy, min_rounds=self.app_config.negotiation.min_rounds, max_rounds=self.app_config.negotiation.max_rounds)
        workflow = build_negotiation_graph(agents)
        return NegotiationRuntime(agents=agents, workflow=workflow)

    def _get_thread_runtime(self) -> NegotiationRuntime:
        runtime = getattr(self._thread_local, "runtime", None)
        if runtime is None:
            runtime = self._build_runtime()
            self._thread_local.runtime = runtime
        return runtime

    def _validate_max_concurrency(self, max_concurrency: int) -> int:
        if isinstance(max_concurrency, bool) or not isinstance(max_concurrency, int):
            raise NegotiationConfigurationError("max_concurrency must be an integer.")
        if not 1 <= max_concurrency <= MAX_ALLOWED_CONCURRENCY:
            raise NegotiationConfigurationError(
                f"max_concurrency must be between 1 and {MAX_ALLOWED_CONCURRENCY}."
            )
        return max_concurrency

    def classify_graph(
        self,
        graph: GraphInput | dict[str, Any],
        *,
        max_concurrency: int = DEFAULT_MAX_CONCURRENCY,
    ) -> list[ClassificationResult]:
        graph_model = GraphInput.model_validate(graph)
        validated_max_concurrency = self._validate_max_concurrency(max_concurrency)

        if validated_max_concurrency == 1 or len(graph_model.nodes) <= 1:
            results = [self.classify_node(node.node_id, graph_model)[0] for node in graph_model.nodes]
        else:
            results = self._classify_graph_parallel(graph_model, validated_max_concurrency)

        self.artifacts.write_results(graph_model, results)
        return results

    def _classify_graph_parallel(
        self,
        graph_model: GraphInput,
        max_concurrency: int,
    ) -> list[ClassificationResult]:
        indexed_results: dict[int, ClassificationResult] = {}
        nodes = list(graph_model.nodes)
        next_index = 0
        pending: dict[Future[tuple[ClassificationResult, NegotiationState]], int] = {}

        with ThreadPoolExecutor(max_workers=max_concurrency, thread_name_prefix="ontology-node") as executor:
            while next_index < len(nodes) and len(pending) < max_concurrency:
                future = executor.submit(self.classify_node, nodes[next_index].node_id, graph_model)
                pending[future] = next_index
                next_index += 1

            while pending:
                done, _ = wait(pending.keys(), return_when=FIRST_COMPLETED)
                for future in done:
                    index = pending.pop(future)
                    try:
                        result, _ = future.result()
                    except Exception:
                        for pending_future in pending:
                            pending_future.cancel()
                        raise
                    indexed_results[index] = result

                    if next_index < len(nodes):
                        next_future = executor.submit(self.classify_node, nodes[next_index].node_id, graph_model)
                        pending[next_future] = next_index
                        next_index += 1

        return [indexed_results[index] for index in range(len(nodes))]

    def classify_node(
        self,
        node_id: str,
        graph: GraphInput | dict[str, Any],
    ) -> tuple[ClassificationResult, NegotiationState]:
        graph_model = GraphInput.model_validate(graph)
        runtime = self._get_thread_runtime()
        return self._classify_node_with_runtime(node_id, graph_model, runtime)

    def _classify_node_with_runtime(
        self,
        node_id: str,
        graph_model: GraphInput,
        runtime: NegotiationRuntime,
    ) -> tuple[ClassificationResult, NegotiationState]:
        node = self._find_node(graph_model, node_id)
        state = self._build_initial_state(node, graph_model)
        final_state = runtime.workflow.invoke(state)
        result = self.artifacts.state_to_result(final_state)
        debate_path = self.artifacts.write_debate(final_state, result)
        final_state["debate_log_path"] = str(debate_path)
        return result, final_state

    def write_results(
        self,
        graph: GraphInput | dict[str, Any],
        results: list[ClassificationResult],
    ) -> dict[str, Path]:
        graph_model = GraphInput.model_validate(graph)
        return self.artifacts.write_results(graph_model, results)

    def _find_node(self, graph: GraphInput, node_id: str) -> GraphNode:
        for node in graph.nodes:
            if node.node_id == node_id:
                return node
        raise ValueError(f"Unknown node_id: {node_id}")

    def _build_initial_state(self, node: GraphNode, graph: GraphInput) -> NegotiationState:
        graph_context = self._build_graph_context(node, graph)
        node_payload = node.model_dump(mode="json")
        graph_context_payload = graph_context.model_dump(mode="json")
        llm_trace: list[dict[str, Any]] = []
        return {
            "node_data": node_payload,
            "graph_context": graph_context_payload,
            "vault_context": match_vault(
                node_payload,
                graph_context_payload,
                llm=self.llm,
                fallback_llm=self.fallback_llm,
                retry_policy=self.retry_policy,
                trace_collector=llm_trace,
            ),
            "proposal": {},
            "critique": {},
            "history": [],
            "iterations": 1,
            "debate_focus": "",
            "debate_gaps": [],
            "round_summaries": [],
            "confidence_score": 0.0,
            "evaluation_report": {},
            "consensus_reached": False,
            "arbiter_summary": "",
            "arbiter_action": None,
            "final_label": None,
            "debate_log_path": None,
            "loop_detected": False,
            "loop_reason": "",
            "case_closed": False,
            "agent_errors": [],
            "llm_trace": llm_trace,
            "persistent_evidence": [],
            "resolved_evidence": [],
            "evidence_events": [],
        }
    def _build_graph_context(self, node: GraphNode, graph: GraphInput) -> GraphContext:
        linked_edges = [
            edge
            for edge in graph.edges
            if edge.source == node.node_id or edge.target == node.node_id
        ]
        neighbor_ids: list[str] = []
        for edge in linked_edges:
            for candidate_id in (edge.source, edge.target):
                if candidate_id != node.node_id and candidate_id not in neighbor_ids:
                    neighbor_ids.append(candidate_id)
        neighbors = [candidate for candidate in graph.nodes if candidate.node_id in neighbor_ids]
        return GraphContext(neighbors=neighbors, edges=linked_edges)





