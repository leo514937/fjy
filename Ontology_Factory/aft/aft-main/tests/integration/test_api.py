from pathlib import Path

from fastapi.testclient import TestClient

from ontology_audit_hub.api import create_app
from ontology_audit_hub.domain.audit.models import AuditRequest
from ontology_audit_hub.infra.checkpointing import SqliteCheckpointStoreFactory
from ontology_audit_hub.infra.graph_augmenter import NullGraphAugmenter
from ontology_audit_hub.infra.human_store import FileHumanInteractionStore
from ontology_audit_hub.infra.retrieval import NullRetriever
from ontology_audit_hub.infra.runtime import GraphRuntime
from ontology_audit_hub.infra.settings import AuditHubSettings
from ontology_audit_hub.service import SupervisorService


def test_api_root_redirects_to_docs_and_favicon_is_suppressed(tmp_path: Path) -> None:
    settings = AuditHubSettings(
        run_root=tmp_path / "runs",
        checkpoint_path=tmp_path / "checkpoints.sqlite3",
        qdrant_enabled=False,
        neo4j_enabled=False,
        llm_enabled=False,
    )
    service = SupervisorService(
        settings=settings,
        runtime=GraphRuntime(
            retriever=NullRetriever(),
            graph_augmenter=NullGraphAugmenter(),
            interrupt_on_human=False,
        ),
        checkpoint_store_factory=SqliteCheckpointStoreFactory(tmp_path / "checkpoints.sqlite3"),
        human_store=FileHumanInteractionStore(tmp_path / "human"),
    )
    client = TestClient(create_app(service))

    root = client.get("/", follow_redirects=False)
    favicon = client.get("/favicon.ico")

    assert root.status_code == 307
    assert root.headers["location"] == "/docs"
    assert favicon.status_code == 204


def test_api_run_and_resume_flow(tmp_path: Path) -> None:
    settings = AuditHubSettings(
        run_root=tmp_path / "runs",
        checkpoint_path=tmp_path / "checkpoints.sqlite3",
        qdrant_enabled=False,
        neo4j_enabled=False,
        llm_enabled=False,
    )
    service = SupervisorService(
        settings=settings,
        runtime=GraphRuntime(
            retriever=NullRetriever(),
            graph_augmenter=NullGraphAugmenter(),
            interrupt_on_human=True,
        ),
        checkpoint_store_factory=SqliteCheckpointStoreFactory(tmp_path / "checkpoints.sqlite3"),
        human_store=FileHumanInteractionStore(tmp_path / "human"),
    )
    client = TestClient(create_app(service))

    health = client.get("/health")
    assert health.status_code == 200
    assert health.json()["status"] == "ok"

    ready = client.get("/ready")
    assert ready.status_code == 200
    assert ready.json()["status"] == "ready"

    paused = client.post(
        "/audit/run",
        json=AuditRequest.model_validate(
            {
                "user_request": "Audit the payment validator code and ask me if the binding is ambiguous.",
                "audit_mode": "code",
                "ontology_path": "examples/hitl/ontology.yaml",
                "code_paths": ["examples/hitl/src/ambiguous_payment.py"],
            }
        ).model_dump(mode="json"),
    )
    assert paused.status_code == 200
    payload = paused.json()
    assert payload["status"] == "requires_human_input"
    assert paused.headers["X-Ontology-Audit-Status"] == "requires_human_input"
    assert paused.headers["X-Ontology-Audit-Session-ID"] == payload["session_id"]
    assert paused.headers["X-Ontology-Audit-Artifact-Dir"].endswith(payload["session_id"])

    resumed = client.post(
        "/audit/resume",
        json={
            "session_id": payload["session_id"],
            "resume_token": payload["resume_token"],
            "selected_option_id": payload["human_card"]["options"][0]["id"],
            "response_value": payload["human_card"]["options"][0]["value"],
            "notes": "Use the validator callable.",
        },
    )
    assert resumed.status_code == 200
    report = resumed.json()
    assert report["unresolved_questions"] == []
    assert resumed.headers["X-Ontology-Audit-Status"] == "completed"
    assert resumed.headers["X-Ontology-Audit-Session-ID"] == payload["session_id"]


def test_api_returns_validation_error_for_bad_resume_token(tmp_path: Path) -> None:
    settings = AuditHubSettings(
        run_root=tmp_path / "runs",
        checkpoint_path=tmp_path / "checkpoints.sqlite3",
        qdrant_enabled=False,
        neo4j_enabled=False,
        llm_enabled=False,
    )
    service = SupervisorService(
        settings=settings,
        runtime=GraphRuntime(
            retriever=NullRetriever(),
            graph_augmenter=NullGraphAugmenter(),
            interrupt_on_human=True,
        ),
        checkpoint_store_factory=SqliteCheckpointStoreFactory(tmp_path / "checkpoints.sqlite3"),
        human_store=FileHumanInteractionStore(tmp_path / "human"),
    )
    client = TestClient(create_app(service))

    paused = client.post(
        "/audit/run",
        json={
            "user_request": "Audit the payment validator code and ask me if the binding is ambiguous.",
            "audit_mode": "code",
            "ontology_path": "examples/hitl/ontology.yaml",
            "code_paths": ["examples/hitl/src/ambiguous_payment.py"],
        },
    )
    payload = paused.json()

    resumed = client.post(
        "/audit/resume",
        json={
            "session_id": payload["session_id"],
            "resume_token": "bad-token",
            "selected_option_id": payload["human_card"]["options"][0]["id"],
            "response_value": payload["human_card"]["options"][0]["value"],
        },
    )

    assert resumed.status_code == 400
    assert "Resume token mismatch" in resumed.json()["detail"]


def test_api_ready_returns_503_when_enabled_backend_is_not_ready(tmp_path: Path) -> None:
    settings = AuditHubSettings(
        run_root=tmp_path / "runs",
        checkpoint_path=tmp_path / "checkpoints.sqlite3",
        qdrant_enabled=True,
        neo4j_enabled=False,
        llm_enabled=False,
    )
    service = SupervisorService(
        settings=settings,
        runtime=GraphRuntime(
            retriever=NullRetriever(),
            graph_augmenter=NullGraphAugmenter(),
            interrupt_on_human=False,
        ),
        checkpoint_store_factory=SqliteCheckpointStoreFactory(tmp_path / "checkpoints.sqlite3"),
        human_store=FileHumanInteractionStore(tmp_path / "human"),
    )
    client = TestClient(create_app(service))

    ready = client.get("/ready")

    assert ready.status_code == 503
    assert ready.json()["status"] == "not_ready"
    assert ready.json()["components"]["qdrant"]["status"] == "not_ready"
