from __future__ import annotations

"""End-to-end benchmark reporting for the negotiation workflow."""

import json
from concurrent.futures import FIRST_COMPLETED, Future, ThreadPoolExecutor, wait
from datetime import UTC, datetime
from pathlib import Path
from time import perf_counter
from typing import Any, Callable

from ontology_negotiator.agents import NegotiationAgents
from ontology_negotiator.errors import NegotiationExecutionError
from ontology_negotiator.graph_builder import build_negotiation_graph
from ontology_negotiator.models import GraphInput, NegotiationState
from ontology_negotiator.negotiator import DEFAULT_MAX_CONCURRENCY, OntologyNegotiator


def _utc_now_iso() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _to_jsonable(value: Any) -> Any:
    if hasattr(value, "model_dump"):
        return _to_jsonable(value.model_dump(mode="json"))
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, dict):
        return {str(key): _to_jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_to_jsonable(item) for item in value]
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)


def _round_seconds(value: float) -> float:
    return round(value, 6)


def _aggregate_agent_steps(steps: list[dict[str, Any]]) -> list[dict[str, Any]]:
    totals: dict[str, dict[str, Any]] = {}
    for step in steps:
        agent_name = str(step["agent_name"])
        summary = totals.setdefault(
            agent_name,
            {
                "agent_name": agent_name,
                "invocations": 0,
                "total_seconds": 0.0,
                "average_seconds": 0.0,
            },
        )
        summary["invocations"] += 1
        summary["total_seconds"] += float(step["duration_seconds"])

    for summary in totals.values():
        invocations = int(summary["invocations"])
        total_seconds = float(summary["total_seconds"])
        summary["total_seconds"] = _round_seconds(total_seconds)
        summary["average_seconds"] = _round_seconds(total_seconds / invocations) if invocations else 0.0

    return sorted(totals.values(), key=lambda item: (-float(item["total_seconds"]), str(item["agent_name"])))


def _slowest_step(steps: list[dict[str, Any]]) -> dict[str, Any] | None:
    if not steps:
        return None
    return max(steps, key=lambda item: float(item["duration_seconds"]))


def _emit_event(callback: Callable[[dict[str, Any]], None] | None, payload: dict[str, Any]) -> None:
    if callback is None:
        return
    callback(payload)


def _extract_retry_reasons(round_summaries: list[dict[str, Any]]) -> list[str]:
    reasons = []
    for summary in round_summaries:
        if summary.get("arbiter_action") == "retry":
            reason = str(summary.get("retry_reason_type", "")).strip()
            if reason:
                reasons.append(reason)
    return reasons


class WorkflowProfiler:
    def __init__(self, on_event: Callable[[dict[str, Any]], None] | None = None) -> None:
        self.events: list[dict[str, Any]] = []
        self.on_event = on_event

    def wrap(
        self,
        agent_name: str,
        fn: Callable[[NegotiationState], NegotiationState],
    ) -> Callable[[NegotiationState], NegotiationState]:
        def wrapped(state: NegotiationState) -> NegotiationState:
            event_index = len(self.events) + 1
            started_at = _utc_now_iso()
            node_id = state.get("node_data", {}).get("node_id")
            round_index = int(state.get("iterations", 1))
            _emit_event(
                self.on_event,
                {
                    "event_type": "agent_started",
                    "event_index": event_index,
                    "agent_name": agent_name,
                    "node_id": node_id,
                    "round": round_index,
                    "started_at": started_at,
                },
            )
            start = perf_counter()
            try:
                output = fn(state)
            except Exception as exc:
                duration_seconds = perf_counter() - start
                event = {
                    "event_index": event_index,
                    "agent_name": agent_name,
                    "node_id": node_id,
                    "round": round_index,
                    "started_at": started_at,
                    "finished_at": _utc_now_iso(),
                    "duration_seconds": _round_seconds(duration_seconds),
                    "output": None,
                    "error": exc.to_dict() if isinstance(exc, NegotiationExecutionError) else repr(exc),
                }
                self.events.append(event)
                _emit_event(self.on_event, {"event_type": "agent_failed", **event})
                raise

            duration_seconds = perf_counter() - start
            event = {
                "event_index": event_index,
                "agent_name": agent_name,
                "node_id": node_id,
                "round": round_index,
                "started_at": started_at,
                "finished_at": _utc_now_iso(),
                "duration_seconds": _round_seconds(duration_seconds),
                "output": _to_jsonable(output),
            }
            self.events.append(event)
            _emit_event(self.on_event, {"event_type": "agent_finished", **event})
            return output

        return wrapped


class TimedNegotiationAgents:
    def __init__(self, base_agents: NegotiationAgents, profiler: WorkflowProfiler) -> None:
        self.proposer_agent = profiler.wrap("proposer_agent", base_agents.proposer_agent)
        self.critic_agent = profiler.wrap("critic_agent", base_agents.critic_agent)
        self.arbiter_node = profiler.wrap("arbiter_node", base_agents.arbiter_node)
        self.evaluator_agent = profiler.wrap("evaluator_agent", base_agents.evaluator_agent)


class BenchmarkedOntologyNegotiator(OntologyNegotiator):
    def classify_node_profiled(
        self,
        node_id: str,
        graph: GraphInput | dict[str, Any],
        *,
        on_event: Callable[[dict[str, Any]], None] | None = None,
    ) -> tuple[Any, NegotiationState, list[dict[str, Any]]]:
        graph_model = GraphInput.model_validate(graph)
        profiler = WorkflowProfiler(on_event=on_event)
        runtime = self._build_profiled_runtime(profiler)
        result, state = self._classify_node_with_runtime(node_id, graph_model, runtime)
        return result, state, [_to_jsonable(item) for item in profiler.events]

    def _build_profiled_runtime(self, profiler: WorkflowProfiler) -> Any:
        agents = TimedNegotiationAgents(NegotiationAgents(llm=self.llm, fallback_llm=self.fallback_llm, retry_policy=self.retry_policy), profiler)
        workflow = build_negotiation_graph(agents)
        return type("BenchmarkedRuntime", (), {"agents": agents, "workflow": workflow})()


def build_benchmark_summary(report: dict[str, Any]) -> str:
    lines = [
        "Ontology negotiator full pipeline benchmark",
        f"Started at: {report['started_at']}",
        f"Finished at: {report['finished_at']}",
        f"Total elapsed seconds: {report['total_seconds']}",
        f"Processed nodes: {report['node_count']}",
        f"Average round count: {report['average_round_count']}",
    ]

    slowest_step = report.get("slowest_step_overall")
    if slowest_step:
        lines.append(
            "Slowest single step: "
            f"{slowest_step['agent_name']} on {slowest_step['node_id']} "
            f"(round {slowest_step['round']}, {slowest_step['duration_seconds']}s)"
        )

    slowest_agent = report.get("slowest_agent_total")
    if slowest_agent:
        lines.append(
            "Slowest aggregated agent: "
            f"{slowest_agent['agent_name']} ({slowest_agent['total_seconds']}s across "
            f"{slowest_agent['invocations']} calls)"
        )

    lines.append("")
    lines.append("Agent totals:")
    for item in report.get("agent_rank_by_total_time", []):
        lines.append(
            f"- {item['agent_name']}: total={item['total_seconds']}s "
            f"calls={item['invocations']} avg={item['average_seconds']}s"
        )

    lines.append("")
    lines.append("Node totals:")
    for item in report.get("node_summaries", []):
        lines.append(
            f"- {item['node_id']}: total={item['total_seconds']}s "
            f"rounds={item['round_count']} "
            f"finalization_type={item['finalization_reason_type'] or '-'} "
            f"finalization={item['finalization_reason']} "
            f"slowest={item['slowest_step']['agent_name']}:{item['slowest_step']['duration_seconds']}s"
        )

    return "\n".join(lines)


def _build_node_summary(
    *,
    result: Any,
    state: NegotiationState,
    agent_steps: list[dict[str, Any]],
    started_at: str,
    total_seconds: float,
) -> dict[str, Any]:
    round_summaries = list(state.get("round_summaries", []))
    round_count = int(state.get("iterations", 1))
    finalization_reason = ""
    finalization_reason_type = ""
    if round_summaries:
        finalization_reason = str(round_summaries[-1].get("decision_reason", "")).strip()
        finalization_reason_type = str(round_summaries[-1].get("decision_reason_type", "")).strip()
    return {
        "node_id": result.node_id,
        "started_at": started_at,
        "finished_at": _utc_now_iso(),
        "total_seconds": _round_seconds(total_seconds),
        "round_count": round_count,
        "finalization_reason": finalization_reason,
        "finalization_reason_type": finalization_reason_type,
        "retry_reasons": _extract_retry_reasons(round_summaries),
        "round_summaries": round_summaries,
        "agent_steps": agent_steps,
        "agent_rank_by_total_time": _aggregate_agent_steps(agent_steps),
        "slowest_step": _slowest_step(agent_steps),
        "final_result": result.model_dump(mode="json"),
        "debate_log_path": state.get("debate_log_path"),
    }


def run_full_pipeline_benchmark(
    graph: GraphInput | dict[str, Any],
    *,
    llm: Any | None = None,
    artifact_root: Path | str | None = None,
    model_name: str | None = None,
    llm_kwargs: dict[str, Any] | None = None,
    config_path: Path | str | None = None,
    max_concurrency: int = DEFAULT_MAX_CONCURRENCY,
    progress_callback: Callable[[dict[str, Any]], None] | None = None,
) -> dict[str, Any]:
    graph_model = GraphInput.model_validate(graph)
    negotiator = BenchmarkedOntologyNegotiator(
        llm=llm,
        artifact_root=artifact_root,
        model_name=model_name,
        llm_kwargs=llm_kwargs,
        config_path=config_path,
    )
    validated_max_concurrency = negotiator._validate_max_concurrency(max_concurrency)

    started_at = _utc_now_iso()
    total_start = perf_counter()
    indexed_results: dict[int, Any] = {}
    indexed_node_summaries: dict[int, dict[str, Any]] = {}

    if validated_max_concurrency == 1 or len(graph_model.nodes) <= 1:
        for index, node in enumerate(graph_model.nodes):
            node_started_at = _utc_now_iso()
            node_start = perf_counter()
            _emit_event(
                progress_callback,
                {
                    "event_type": "node_started",
                    "node_id": node.node_id,
                    "node_index": index,
                    "started_at": node_started_at,
                },
            )
            result, state, agent_steps = negotiator.classify_node_profiled(
                node.node_id,
                graph_model,
                on_event=progress_callback,
            )
            node_total_seconds = perf_counter() - node_start
            indexed_results[index] = result
            indexed_node_summaries[index] = _build_node_summary(
                result=result,
                state=state,
                agent_steps=agent_steps,
                started_at=node_started_at,
                total_seconds=node_total_seconds,
            )
            _emit_event(
                progress_callback,
                {
                    "event_type": "node_finished",
                    "node_id": node.node_id,
                    "node_index": index,
                    "started_at": node_started_at,
                    "finished_at": _utc_now_iso(),
                    "duration_seconds": _round_seconds(node_total_seconds),
                    "final_label": result.ontology_label,
                    "round_count": indexed_node_summaries[index]["round_count"],
                },
            )
    else:
        nodes = list(graph_model.nodes)
        next_index = 0
        pending: dict[Future[tuple[Any, NegotiationState, list[dict[str, Any]], str, float]], int] = {}

        def submit(executor: ThreadPoolExecutor, index: int) -> Future:
            node = nodes[index]
            node_started_at = _utc_now_iso()
            node_start = perf_counter()
            _emit_event(
                progress_callback,
                {
                    "event_type": "node_started",
                    "node_id": node.node_id,
                    "node_index": index,
                    "started_at": node_started_at,
                },
            )

            def run_node() -> tuple[Any, NegotiationState, list[dict[str, Any]], str, float]:
                result, state, agent_steps = negotiator.classify_node_profiled(
                    node.node_id,
                    graph_model,
                    on_event=progress_callback,
                )
                return result, state, agent_steps, node_started_at, perf_counter() - node_start

            return executor.submit(run_node)

        with ThreadPoolExecutor(max_workers=validated_max_concurrency, thread_name_prefix="benchmark-node") as executor:
            while next_index < len(nodes) and len(pending) < validated_max_concurrency:
                future = submit(executor, next_index)
                pending[future] = next_index
                next_index += 1

            while pending:
                done, _ = wait(pending.keys(), return_when=FIRST_COMPLETED)
                for future in done:
                    index = pending.pop(future)
                    try:
                        result, state, agent_steps, node_started_at, node_total_seconds = future.result()
                    except Exception:
                        for pending_future in pending:
                            pending_future.cancel()
                        raise

                    indexed_results[index] = result
                    indexed_node_summaries[index] = _build_node_summary(
                        result=result,
                        state=state,
                        agent_steps=agent_steps,
                        started_at=node_started_at,
                        total_seconds=node_total_seconds,
                    )
                    _emit_event(
                        progress_callback,
                        {
                            "event_type": "node_finished",
                            "node_id": result.node_id,
                            "node_index": index,
                            "started_at": node_started_at,
                            "finished_at": _utc_now_iso(),
                            "duration_seconds": _round_seconds(node_total_seconds),
                            "final_label": result.ontology_label,
                            "round_count": indexed_node_summaries[index]["round_count"],
                        },
                    )

                    if next_index < len(nodes):
                        next_future = submit(executor, next_index)
                        pending[next_future] = next_index
                        next_index += 1

    final_results = [indexed_results[index] for index in range(len(graph_model.nodes))]
    node_summaries = [indexed_node_summaries[index] for index in range(len(graph_model.nodes))]
    result_paths = negotiator.write_results(graph_model, final_results)
    total_seconds = perf_counter() - total_start

    all_steps: list[dict[str, Any]] = []
    for node_summary in node_summaries:
        all_steps.extend(node_summary["agent_steps"])
    agent_rank_by_total_time = _aggregate_agent_steps(all_steps)
    average_round_count = _round_seconds(
        sum(float(item["round_count"]) for item in node_summaries) / len(node_summaries)
    ) if node_summaries else 0.0

    diagnostics_dir = negotiator.artifacts.diagnostics_dir
    agent_outputs_path = diagnostics_dir / "full_pipeline_agent_outputs.json"
    report_path = diagnostics_dir / "full_pipeline_report.json"
    summary_path = diagnostics_dir / "full_pipeline_summary.txt"

    written_files = {
        "ontology_results": str(result_paths["ontology_results"]),
        "labeled_graph": str(result_paths["labeled_graph"]),
        "agent_outputs": str(agent_outputs_path),
        "benchmark_report": str(report_path),
        "benchmark_summary": str(summary_path),
    }
    report = {
        "started_at": started_at,
        "finished_at": _utc_now_iso(),
        "total_seconds": _round_seconds(total_seconds),
        "node_count": len(graph_model.nodes),
        "max_concurrency": validated_max_concurrency,
        "average_round_count": average_round_count,
        "agent_rank_by_total_time": agent_rank_by_total_time,
        "slowest_step_overall": _slowest_step(all_steps),
        "slowest_agent_total": agent_rank_by_total_time[0] if agent_rank_by_total_time else None,
        "node_summaries": node_summaries,
        "final_results": [item.model_dump(mode="json") for item in final_results],
        "written_files": written_files,
    }

    agent_outputs_path.write_text(json.dumps(all_steps, ensure_ascii=False, indent=2), encoding="utf-8")
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    summary_path.write_text(build_benchmark_summary(report), encoding="utf-8")
    return report


