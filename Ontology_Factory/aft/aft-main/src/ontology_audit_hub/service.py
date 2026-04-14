from __future__ import annotations

import hashlib
import json
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, cast

from ontology_audit_hub.domain.audit.models import (
    AuditReport,
    AuditRequest,
    Finding,
    HumanDecision,
    HumanInputCard,
    Severity,
)
from ontology_audit_hub.graphs.nodes.human_input import apply_resumed_human_response
from ontology_audit_hub.graphs.state import GraphState
from ontology_audit_hub.graphs.supervisor import build_supervisor_graph
from ontology_audit_hub.infra.checkpointing import CheckpointStoreFactory, SqliteCheckpointStoreFactory
from ontology_audit_hub.infra.graph_augmenter import Neo4jGraphAugmenter, Neo4jSettings, NullGraphAugmenter
from ontology_audit_hub.infra.human_store import FileHumanInteractionStore, HumanInteractionStore
from ontology_audit_hub.infra.llm.base import NullStructuredLLMAdapter
from ontology_audit_hub.infra.llm.pydantic_ai_adapter import PydanticAILLMAdapter
from ontology_audit_hub.infra.retrieval import NullRetriever, QdrantRetriever
from ontology_audit_hub.infra.runtime import GraphRuntime
from ontology_audit_hub.infra.settings import AuditHubSettings

_RETRIEVER_CACHE: dict[tuple[bool, str, str, str, str, str, float], object] = {}
_GRAPH_AUGMENTER_CACHE: dict[tuple[bool, str, str, str], object] = {}
_LLM_ADAPTER_CACHE: dict[tuple[bool, str, str | None], object] = {}


@dataclass
class HumanInterruptPayload:
    session_id: str
    resume_token: str | None
    current_phase: str
    human_card: HumanInputCard

    def to_dict(self) -> dict[str, Any]:
        return {
            "status": "requires_human_input",
            "message": "Audit paused pending human clarification.",
            "session_id": self.session_id,
            "resume_token": self.resume_token,
            "current_phase": self.current_phase,
            "human_card": self.human_card.model_dump(mode="json"),
        }


class SupervisorService:
    def __init__(
        self,
        *,
        settings: AuditHubSettings | None = None,
        runtime: GraphRuntime | None = None,
        checkpoint_store_factory: CheckpointStoreFactory | None = None,
        human_store: HumanInteractionStore | None = None,
    ) -> None:
        self.settings = settings or AuditHubSettings.from_env()
        self.runtime = runtime or build_default_runtime(
            settings=self.settings,
            interrupt_on_human=self.settings.interrupt_on_human,
        )
        self.checkpoint_store_factory = checkpoint_store_factory or SqliteCheckpointStoreFactory(
            self.settings.checkpoint_path
        )
        self.human_store = human_store or FileHumanInteractionStore(self.settings.run_root)

    def close(self) -> None:
        self._close_runtime_resources(self.runtime)

    def run(self, audit_request: AuditRequest, session_id: str | None = None) -> AuditReport | HumanInterruptPayload:
        _, result = self.run_session(audit_request, session_id=session_id)
        return result

    def run_session(
        self,
        audit_request: AuditRequest,
        session_id: str | None = None,
    ) -> tuple[str, AuditReport | HumanInterruptPayload]:
        session_id = session_id or str(uuid.uuid4())
        self._session_dir(session_id).mkdir(parents=True, exist_ok=True)
        self._persist_json(self.settings.request_snapshot_path_for(session_id), audit_request.model_dump(mode="json"))
        try:
            self._enforce_required_capabilities(audit_request)
            runtime = self._runtime_for_session(session_id)
            initial_state = {
                "request": audit_request,
                "session_id": session_id,
                "resume_token": None,
            }
            with self.checkpoint_store_factory.open() as checkpointer:
                graph = build_supervisor_graph(runtime=runtime, checkpointer=checkpointer)
                config = {"configurable": {"thread_id": session_id}}
                result = graph.invoke(initial_state, config=config)
                snapshot = graph.get_state(config)
                interrupt_payload = self._extract_interrupt_payload(snapshot)
                if interrupt_payload is not None:
                    self.human_store.save_pending(
                        session_id=interrupt_payload.session_id,
                        resume_token=interrupt_payload.resume_token,
                        card=interrupt_payload.human_card,
                        current_phase=interrupt_payload.current_phase,
                    )
                    self._delete_if_exists(self.settings.error_snapshot_path_for(session_id))
                    self._persist_json(
                        self.settings.interrupt_snapshot_path_for(session_id),
                        interrupt_payload.to_dict(),
                    )
                    return session_id, interrupt_payload
                self.human_store.clear_pending(session_id)
                self._delete_if_exists(self.settings.interrupt_snapshot_path_for(session_id))
                report = result.get("final_report")
                if isinstance(report, AuditReport):
                    self._delete_if_exists(self.settings.error_snapshot_path_for(session_id))
                    self._persist_json(self.settings.report_snapshot_path_for(session_id), report.model_dump(mode="json"))
                    return session_id, report
                raise RuntimeError("Supervisor graph finished without an AuditReport.")
        except Exception as exc:
            self._persist_error(session_id, exc)
            raise
        finally:
            self._close_runtime_resources(locals().get("runtime"))

    def resume(self, decision: HumanDecision) -> AuditReport | HumanInterruptPayload:
        _, result = self.resume_session(decision)
        return result

    def resume_session(self, decision: HumanDecision) -> tuple[str, AuditReport | HumanInterruptPayload]:
        session_id = decision.session_id
        try:
            pending = self.human_store.load_pending(session_id)
            if pending is None:
                raise RuntimeError(f"No pending human review found for session '{session_id}'.")
            pending_token = str(pending.get("resume_token") or "")
            if pending_token and decision.resume_token and pending_token != decision.resume_token:
                raise RuntimeError(
                    f"Resume token mismatch for session '{session_id}'. Expected '{pending_token}' "
                    f"but got '{decision.resume_token}'."
                )
            if pending_token and not decision.resume_token:
                decision = decision.model_copy(update={"resume_token": pending_token})
            self._persist_json(self._session_dir(session_id) / "resume_decision.json", decision.model_dump(mode="json"))
            card = HumanInputCard.model_validate(pending.get("human_card") or {})
            option_ids = {option.id for option in card.options}
            if decision.selected_option_id and option_ids and decision.selected_option_id not in option_ids:
                raise RuntimeError(
                    f"Selected option '{decision.selected_option_id}' is not valid for session '{session_id}'."
                )
            runtime = self._runtime_for_session(session_id)
            with self.checkpoint_store_factory.open() as checkpointer:
                graph = build_supervisor_graph(runtime=runtime, checkpointer=checkpointer)
                config = {"configurable": {"thread_id": session_id}}
                snapshot = graph.get_state(config)
                if snapshot is None:
                    raise RuntimeError(f"No checkpoint state found for session '{session_id}'.")
                updated_values: dict[str, Any] = {
                    "human_response": decision,
                    "needs_human_input": False,
                    "resume_token": decision.resume_token,
                }
                update_as_node: str | None = None
                if str(pending.get("current_phase") or "") == "human_input":
                    resumed_state = cast(GraphState, dict(snapshot.values))
                    resumed_state.update(cast(GraphState, updated_values))
                    updated_values = cast(dict[str, Any], apply_resumed_human_response(resumed_state, decision))
                    update_as_node = "human_input"
                updated_config = graph.update_state(
                    snapshot.config,
                    updated_values,
                    as_node=update_as_node,
                )
                result = graph.invoke(None, config=updated_config)
                resumed_snapshot = graph.get_state(updated_config)
                interrupt_payload = self._extract_interrupt_payload(resumed_snapshot)
                if interrupt_payload is not None:
                    self.human_store.save_pending(
                        session_id=interrupt_payload.session_id,
                        resume_token=interrupt_payload.resume_token,
                        card=interrupt_payload.human_card,
                        current_phase=interrupt_payload.current_phase,
                    )
                    self._delete_if_exists(self.settings.error_snapshot_path_for(session_id))
                    self._persist_json(
                        self.settings.interrupt_snapshot_path_for(session_id),
                        interrupt_payload.to_dict(),
                    )
                    return session_id, interrupt_payload
                self.human_store.clear_pending(session_id)
                self._delete_if_exists(self.settings.interrupt_snapshot_path_for(session_id))
                report = result.get("final_report")
                if isinstance(report, AuditReport):
                    self._delete_if_exists(self.settings.error_snapshot_path_for(session_id))
                    self._persist_json(self.settings.report_snapshot_path_for(session_id), report.model_dump(mode="json"))
                    return session_id, report
                raise RuntimeError("Supervisor graph resume finished without an AuditReport.")
        except Exception as exc:
            self._persist_error(session_id, exc)
            raise
        finally:
            self._close_runtime_resources(locals().get("runtime"))

    def readiness(self) -> dict[str, Any]:
        checkpoint_ready, checkpoint_detail = self._check_checkpoint_ready()
        components = {
            "checkpoint": {
                "enabled": True,
                "ready": checkpoint_ready,
                "status": "ready" if checkpoint_ready else "not_ready",
                "detail": checkpoint_detail,
                "backend": "sqlite",
                "path": str(self.settings.checkpoint_path),
            },
            "qdrant": self._qdrant_readiness(),
            "neo4j": self._neo4j_readiness(),
            "llm": self._llm_readiness(),
        }
        overall_ready = all(
            component["status"] in {"ready", "disabled"} for component in components.values()
        )
        return {
            "status": "ready" if overall_ready else "not_ready",
            "ready": overall_ready,
            "components": components,
        }

    def doctor(self) -> dict[str, Any]:
        readiness = self.readiness()
        return {
            "status": readiness["status"],
            "ready": readiness["ready"],
            "settings": {
                "run_root": str(self.settings.run_root),
                "qdrant_enabled": self.settings.qdrant_enabled,
                "qdrant_mode": self.settings.qdrant_mode,
                "qdrant_url": self.settings.qdrant_url,
                "qdrant_path": str(self.settings.qdrant_path),
                "neo4j_enabled": self.settings.neo4j_enabled,
                "neo4j_uri": self.settings.neo4j_uri,
                "llm_enabled": self.settings.llm_enabled,
                "llm_provider": self.settings.llm_provider,
                "llm_model": self.settings.llm_model,
                "backend_timeout_seconds": self.settings.backend_timeout_seconds,
            },
            "readiness": readiness["components"],
            "artifact_layout": {
                "example_session_dir": str(self.settings.session_dir("example-session")),
                "generated_tests_dir": str(self.settings.generated_tests_dir_for("example-session")),
                "request_snapshot": str(self.settings.request_snapshot_path_for("example-session")),
                "report_snapshot": str(self.settings.report_snapshot_path_for("example-session")),
                "pending_human": str(self.settings.pending_human_path_for("example-session")),
                "error_snapshot": str(self.settings.error_snapshot_path_for("example-session")),
            },
        }

    def _extract_interrupt_payload(self, snapshot) -> HumanInterruptPayload | None:
        session_id = snapshot.config.get("configurable", {}).get("thread_id")
        resume_token = snapshot.config.get("configurable", {}).get("checkpoint_id")
        for task in snapshot.tasks:
            for interrupt in task.interrupts:
                value = interrupt.value or {}
                human_card = HumanInputCard.model_validate(value["human_card"])
                return HumanInterruptPayload(
                    session_id=str(value.get("session_id") or session_id),
                    resume_token=str(value.get("resume_token") or resume_token),
                    current_phase=str(value.get("current_phase") or task.name),
                    human_card=human_card,
                )
        return None

    def _runtime_for_session(self, session_id: str) -> GraphRuntime:
        retriever = self._session_scoped_retriever(session_id)
        return GraphRuntime(
            retriever=retriever,
            graph_augmenter=self.runtime.graph_augmenter,
            llm_adapter=self.runtime.llm_adapter,
            interrupt_on_human=self.runtime.interrupt_on_human,
            run_artifact_dir=str(self._session_dir(session_id)),
            generated_tests_dir=str(self.settings.generated_tests_dir_for(session_id)),
            diagnostic_findings=list(self.runtime.diagnostic_findings),
        )

    def _session_scoped_retriever(self, session_id: str):
        retriever = self.runtime.retriever
        if not isinstance(retriever, QdrantRetriever):
            return retriever
        session_suffix = hashlib.sha1(session_id.encode("utf-8")).hexdigest()[:12]
        retriever_path = retriever.path
        if retriever.mode == "embedded":
            retriever_path = retriever.path / "sessions" / session_suffix
        return QdrantRetriever(
            embedding_adapter=retriever.embedding_adapter,
            collection_name=f"{retriever.collection_name}_{session_suffix}",
            mode=retriever.mode,
            path=retriever_path,
            url=retriever.url,
            api_key=retriever.api_key,
            timeout=retriever.timeout,
        )

    def _session_dir(self, session_id: str) -> Path:
        session_dir = self.settings.session_dir(session_id)
        session_dir.mkdir(parents=True, exist_ok=True)
        return session_dir

    def _persist_json(self, path: Path, payload: dict[str, Any]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")

    def _persist_error(self, session_id: str, exc: Exception) -> None:
        self._persist_json(
            self.settings.error_snapshot_path_for(session_id),
            {
                "status": "error",
                "session_id": session_id,
                "error_type": exc.__class__.__name__,
                "message": str(exc),
            },
        )

    def _delete_if_exists(self, path: Path) -> None:
        if path.exists():
            path.unlink()

    def _close_runtime_resources(self, runtime: GraphRuntime | None) -> None:
        if runtime is None:
            return
        for component_name in ("retriever", "graph_augmenter"):
            component = getattr(runtime, component_name, None)
            close = getattr(component, "close", None)
            if callable(close):
                try:
                    close()
                except Exception:
                    continue

    def _enforce_required_capabilities(self, audit_request: AuditRequest) -> None:
        readiness = self.readiness()["components"]
        requirements = {
            "qdrant": ("require_qdrant", "require_retrieval"),
            "neo4j": ("require_neo4j", "require_graph"),
            "llm": ("require_llm",),
        }
        for component_name, keys in requirements.items():
            if not any(_metadata_flag(audit_request.metadata, key) for key in keys):
                continue
            component = readiness[component_name]
            if component["status"] != "ready":
                raise RuntimeError(
                    f"Request explicitly requires component '{component_name}', but it is not ready: {component['detail']}"
                )

    def _check_checkpoint_ready(self) -> tuple[bool, str]:
        try:
            with self.checkpoint_store_factory.open():
                return True, "Checkpoint store is writable."
        except Exception as exc:
            return False, str(exc)

    def _qdrant_readiness(self) -> dict[str, Any]:
        if not self.settings.qdrant_enabled:
            return {
                "enabled": False,
                "ready": False,
                "status": "disabled",
                "detail": "Qdrant retrieval is disabled by configuration.",
                "mode": self.settings.qdrant_mode,
            }
        if isinstance(self.runtime.retriever, NullRetriever):
            return {
                "enabled": True,
                "ready": False,
                "status": "not_ready",
                "detail": _first_diagnostic_detail(self.runtime.diagnostic_findings, "retrieval_backend_unavailable"),
                "mode": self.settings.qdrant_mode,
                "fallback": "NullRetriever",
            }
        ready, detail = self.runtime.retriever.check_ready()
        info = self.runtime.retriever.backend_info()
        return {
            "enabled": True,
            "ready": ready,
            "status": "ready" if ready else "not_ready",
            "detail": detail,
            **info,
        }

    def _neo4j_readiness(self) -> dict[str, Any]:
        if not self.settings.neo4j_enabled:
            return {
                "enabled": False,
                "ready": False,
                "status": "disabled",
                "detail": "Neo4j graph augmentation is disabled by configuration.",
            }
        if isinstance(self.runtime.graph_augmenter, NullGraphAugmenter):
            return {
                "enabled": True,
                "ready": False,
                "status": "not_ready",
                "detail": _first_diagnostic_detail(self.runtime.diagnostic_findings, "graph_backend_unavailable"),
                "fallback": "NullGraphAugmenter",
            }
        ready, detail = self.runtime.graph_augmenter.check_ready(self.settings.backend_timeout_seconds)
        info = self.runtime.graph_augmenter.backend_info()
        return {
            "enabled": True,
            "ready": ready,
            "status": "ready" if ready else "not_ready",
            "detail": detail,
            **info,
        }

    def _llm_readiness(self) -> dict[str, Any]:
        if not self.settings.llm_enabled:
            return {
                "enabled": False,
                "ready": False,
                "status": "disabled",
                "detail": "LLM enhancement is disabled by configuration.",
            }
        if isinstance(self.runtime.llm_adapter, NullStructuredLLMAdapter):
            return {
                "enabled": True,
                "ready": False,
                "status": "not_ready",
                "detail": _first_diagnostic_detail(self.runtime.diagnostic_findings, "llm_adapter_unavailable"),
                "fallback": "NullStructuredLLMAdapter",
            }
        ready, detail = self.runtime.llm_adapter.check_ready()
        info = self.runtime.llm_adapter.backend_info()
        return {
            "enabled": True,
            "ready": ready,
            "status": "ready" if ready else "not_ready",
            "detail": detail,
            **info,
        }


def build_default_runtime(*, settings: AuditHubSettings, interrupt_on_human: bool) -> GraphRuntime:
    diagnostic_findings: list[Finding] = []
    retriever = _build_retriever(settings, diagnostic_findings)
    graph_augmenter = _build_graph_augmenter_from_settings(settings, diagnostic_findings)
    llm_adapter = _build_llm_adapter(settings, diagnostic_findings)
    return GraphRuntime(
        retriever=retriever,
        graph_augmenter=graph_augmenter,
        llm_adapter=llm_adapter,
        interrupt_on_human=interrupt_on_human,
        run_artifact_dir=str(settings.run_root / "shared"),
        generated_tests_dir=str(settings.run_root / "shared" / "generated_tests"),
        diagnostic_findings=diagnostic_findings,
    )


def _build_retriever(settings: AuditHubSettings, diagnostics: list[Finding]):
    if not settings.qdrant_enabled:
        return NullRetriever()
    cache_key = (
        settings.qdrant_enabled,
        settings.qdrant_mode,
        str(settings.qdrant_path),
        settings.qdrant_url or "",
        settings.qdrant_api_key or "",
        settings.qdrant_collection_name,
        settings.backend_timeout_seconds,
    )
    if cache_key in _RETRIEVER_CACHE:
        return _RETRIEVER_CACHE[cache_key]
    try:
        retriever = QdrantRetriever(
            collection_name=settings.qdrant_collection_name,
            mode=settings.qdrant_mode,
            path=settings.qdrant_path,
            url=settings.qdrant_url,
            api_key=settings.qdrant_api_key,
            timeout=settings.backend_timeout_seconds,
        )
        _RETRIEVER_CACHE[cache_key] = retriever
        return retriever
    except Exception as exc:
        diagnostics.append(
            _diagnostic_finding(
                "retrieval_backend_unavailable",
                "Qdrant retriever is available",
                str(exc),
                "Fix the Qdrant configuration, switch mode, or disable retrieval with ONTOLOGY_AUDIT_QDRANT_ENABLED=false.",
            )
        )
        return NullRetriever()


def _build_graph_augmenter_from_settings(settings: AuditHubSettings, diagnostics: list[Finding]):
    if not settings.neo4j_enabled:
        return NullGraphAugmenter()
    cache_key = (
        settings.neo4j_enabled,
        settings.neo4j_uri or "",
        settings.neo4j_username or "",
        settings.neo4j_database,
    )
    if cache_key in _GRAPH_AUGMENTER_CACHE:
        return _GRAPH_AUGMENTER_CACHE[cache_key]
    try:
        import neo4j  # noqa: F401
    except ImportError:
        diagnostics.append(
            _diagnostic_finding(
                "graph_backend_unavailable",
                "The neo4j package is installed for graph augmentation",
                "neo4j is not installed",
                "Install ontology-audit-hub[graph] or disable graph augmentation.",
            )
        )
        return NullGraphAugmenter()
    if not settings.neo4j_uri or not settings.neo4j_username or not settings.neo4j_password:
        diagnostics.append(
            _diagnostic_finding(
                "graph_backend_unavailable",
                "Neo4j graph augmentation has a complete connection configuration",
                "Missing Neo4j URI, username, or password",
                "Set ONTOLOGY_AUDIT_NEO4J_URI, ONTOLOGY_AUDIT_NEO4J_USERNAME, and ONTOLOGY_AUDIT_NEO4J_PASSWORD or disable graph augmentation.",
            )
        )
        return NullGraphAugmenter()
    augmenter = Neo4jGraphAugmenter(
        Neo4jSettings(
            uri=settings.neo4j_uri,
            username=settings.neo4j_username,
            password=settings.neo4j_password,
            database=settings.neo4j_database,
        )
    )
    _GRAPH_AUGMENTER_CACHE[cache_key] = augmenter
    return augmenter


def _build_llm_adapter(settings: AuditHubSettings, diagnostics: list[Finding]):
    if not settings.llm_enabled:
        return NullStructuredLLMAdapter()
    cache_key = (settings.llm_enabled, settings.llm_provider, settings.llm_model)
    if cache_key in _LLM_ADAPTER_CACHE:
        return _LLM_ADAPTER_CACHE[cache_key]
    if settings.llm_provider != "pydantic-ai":
        diagnostics.append(
            _diagnostic_finding(
                "llm_adapter_unavailable",
                "A supported LLM provider configuration",
                f"Unsupported LLM provider '{settings.llm_provider}'",
                "Use ONTOLOGY_AUDIT_LLM_PROVIDER=pydantic-ai or disable LLM enhancements.",
            )
        )
        return NullStructuredLLMAdapter()
    if not settings.llm_model:
        diagnostics.append(
            _diagnostic_finding(
                "llm_adapter_unavailable",
                "An LLM model name for explanation enhancements",
                "No ONTOLOGY_AUDIT_LLM_MODEL value was configured",
                "Set ONTOLOGY_AUDIT_LLM_MODEL or disable LLM enhancements.",
            )
        )
        return NullStructuredLLMAdapter()
    try:
        adapter = PydanticAILLMAdapter(settings.llm_model, provider=settings.llm_provider, settings=settings)
        _LLM_ADAPTER_CACHE[cache_key] = adapter
        return adapter
    except Exception as exc:
        diagnostics.append(
            _diagnostic_finding(
                "llm_adapter_unavailable",
                "Pydantic AI adapter initializes successfully",
                str(exc),
                "Install ontology-audit-hub[ai] and configure the model provider before enabling LLM enhancements.",
            )
        )
        return NullStructuredLLMAdapter()


def _diagnostic_finding(finding_type: str, expected: str, found: str, fix_hint: str) -> Finding:
    return Finding(
        finding_type=finding_type,
        severity=Severity.INFO,
        expected=expected,
        found=found,
        evidence="The runtime configuration requested an optional capability that could not be activated.",
        fix_hint=fix_hint,
    )


def _first_diagnostic_detail(findings: list[Finding], finding_type: str) -> str:
    for finding in findings:
        if finding.finding_type == finding_type:
            return finding.found
    return "No diagnostic detail was captured."


def _metadata_flag(metadata: dict[str, str], key: str) -> bool:
    return metadata.get(key, "").strip().lower() in {"1", "true", "yes", "on"}
