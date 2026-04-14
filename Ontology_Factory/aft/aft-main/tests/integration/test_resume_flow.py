from pathlib import Path

from ontology_audit_hub.domain.audit.models import AuditRequest, HumanDecision
from ontology_audit_hub.infra.checkpointing import SqliteCheckpointStoreFactory
from ontology_audit_hub.infra.graph_augmenter import NullGraphAugmenter
from ontology_audit_hub.infra.human_store import FileHumanInteractionStore
from ontology_audit_hub.infra.retrieval import NullRetriever
from ontology_audit_hub.infra.runtime import GraphRuntime
from ontology_audit_hub.infra.settings import AuditHubSettings
from ontology_audit_hub.service import HumanInterruptPayload, SupervisorService


def test_run_then_resume_flow(tmp_path: Path) -> None:
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
    request = AuditRequest.model_validate(
        {
            "user_request": "Audit the payment validator code and ask me if the binding is ambiguous.",
            "audit_mode": "code",
            "ontology_path": "examples/hitl/ontology.yaml",
            "code_paths": ["examples/hitl/src/ambiguous_payment.py"],
        }
    )

    interrupted = service.run(request)

    assert isinstance(interrupted, HumanInterruptPayload)
    assert interrupted.human_card.options

    decision = HumanDecision(
        session_id=interrupted.session_id,
        resume_token=interrupted.resume_token,
        selected_option_id=interrupted.human_card.options[0].id,
        response_value=interrupted.human_card.options[0].value,
        notes="Use the validator callable.",
    )
    report = service.resume(decision)

    assert not isinstance(report, HumanInterruptPayload)
    assert report.unresolved_questions == []
    assert all(f.finding_type != "code_ambiguous_callable_binding" for f in report.findings)
    assert settings.request_snapshot_path_for(interrupted.session_id).exists()
    assert settings.pending_human_path_for(interrupted.session_id).exists() is False
    assert settings.report_snapshot_path_for(interrupted.session_id).exists()


def test_resume_after_intent_clarification_runs_selected_subgraph(tmp_path: Path) -> None:
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
    request = AuditRequest.model_validate(
        {
            "user_request": "Please review this carefully.",
            "ontology_path": "examples/minimal/ontology.yaml",
            "document_paths": ["examples/docs/requirements.md"],
        }
    )

    interrupted = service.run(request)

    assert isinstance(interrupted, HumanInterruptPayload)
    assert {option.id for option in interrupted.human_card.options} >= {"document", "ontology", "code", "full"}

    report = service.resume(
        HumanDecision(
            session_id=interrupted.session_id,
            resume_token=interrupted.resume_token,
            selected_option_id="document",
            response_value="document",
        )
    )

    assert not isinstance(report, HumanInterruptPayload)
    finding_types = {finding.finding_type for finding in report.findings}
    assert "document_required_fields_conflict" in finding_types
    assert "document_relation_unknown_target" in finding_types


def test_resume_accept_relation_replays_document_review_with_decision(tmp_path: Path) -> None:
    ontology_path = tmp_path / "ontology.yaml"
    document_path = tmp_path / "requirements.md"
    ontology_path.write_text(
        "\n".join(
            [
                'version: "1.0"',
                "entities:",
                "  - name: Payment",
                "    attributes: [payment_id]",
                "  - name: Invoice",
                "    attributes: [invoice_id]",
                "relations: []",
                "constraints: []",
            ]
        ),
        encoding="utf-8",
    )
    document_path.write_text(
        "# Requirements\n\nEach Payment generates one Invoice.\n",
        encoding="utf-8",
    )
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
    request = AuditRequest.model_validate(
        {
            "user_request": "Audit the project documentation against the ontology.",
            "audit_mode": "document",
            "ontology_path": str(ontology_path),
            "document_paths": [str(document_path)],
        }
    )

    interrupted = service.run(request)

    assert isinstance(interrupted, HumanInterruptPayload)
    assert {option.id for option in interrupted.human_card.options} == {"accept_relation", "reject_relation"}

    report = service.resume(
        HumanDecision(
            session_id=interrupted.session_id,
            resume_token=interrupted.resume_token,
            selected_option_id="accept_relation",
            response_value="accept_relation",
        )
    )

    assert not isinstance(report, HumanInterruptPayload)
    assert report.unresolved_questions == []
    assert all(finding.finding_type != "document_relation_conflict" for finding in report.findings)


def test_resume_keeps_clear_bindings_and_validates_selected_callable(tmp_path: Path) -> None:
    ontology_path = tmp_path / "ontology.yaml"
    code_path = tmp_path / "validators.py"
    ontology_path.write_text(
        "\n".join(
            [
                'version: "1.0"',
                "entities:",
                "  - name: Payment",
                "    attributes: [payment_id, amount, status]",
                "    constraints:",
                "      required_fields: [payment_id, amount, status]",
                "  - name: Invoice",
                "    attributes: [invoice_id, payment_id]",
                "    constraints:",
                "      required_fields: [invoice_id, payment_id]",
                "relations: []",
                "constraints:",
                "  - entity: Payment",
                "    rule: amount_must_be_positive",
                "    description: Payment amount must be positive.",
            ]
        ),
        encoding="utf-8",
    )
    code_path.write_text(
        "\n".join(
            [
                '"""Validation helpers."""',
                "",
                "def validate_payment(payment_id: str, amount: float) -> bool:",
                '    """Validate Payment records."""',
                "    return bool(payment_id) and amount > 0",
                "",
                "def validate_payment_record(payment_id: str, amount: float, status: str) -> bool:",
                '    """Validate Payment records through an alternate path."""',
                "    return bool(payment_id) and amount > 0 and bool(status)",
                "",
                "def validate_invoice(invoice_id: str, payment_id: str) -> bool:",
                '    """Validate Invoice records."""',
                "    return bool(invoice_id) and bool(payment_id)",
            ]
        ),
        encoding="utf-8",
    )
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
    request = AuditRequest.model_validate(
        {
            "user_request": "Audit the Python validator implementation against the ontology and generate pytest.",
            "audit_mode": "code",
            "ontology_path": str(ontology_path),
            "code_paths": [str(code_path)],
        }
    )

    interrupted = service.run(request)

    assert isinstance(interrupted, HumanInterruptPayload)
    chosen_option = next(option for option in interrupted.human_card.options if option.label == "validate_payment")

    report = service.resume(
        HumanDecision(
            session_id=interrupted.session_id,
            resume_token=interrupted.resume_token,
            selected_option_id=chosen_option.id,
            response_value=chosen_option.value,
        )
    )

    assert not isinstance(report, HumanInterruptPayload)
    assert any(finding.finding_type == "code_missing_required_fields" for finding in report.findings)
    generated_tests = {
        path.stem for path in settings.generated_tests_dir_for(interrupted.session_id).glob("test_generated_*.py")
    }
    assert "test_generated_invoice" in generated_tests


def test_session_scoped_generated_tests_do_not_collide(tmp_path: Path) -> None:
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
        human_store=FileHumanInteractionStore(tmp_path / "runs"),
    )
    request = AuditRequest.model_validate(
        {
            "user_request": "Run a full ontology-driven QA audit across ontology, documentation, and code.",
            "audit_mode": "full",
            "ontology_path": "examples/minimal/ontology.yaml",
            "document_paths": ["examples/minimal/docs/requirements.md"],
            "code_paths": ["examples/minimal/src/billing.py"],
        }
    )

    first_session, first_result = service.run_session(request, session_id="session-a")
    second_session, second_result = service.run_session(request, session_id="session-b")

    assert not isinstance(first_result, HumanInterruptPayload)
    assert not isinstance(second_result, HumanInterruptPayload)
    assert first_session == "session-a"
    assert second_session == "session-b"
    assert settings.generated_tests_dir_for("session-a").exists()
    assert settings.generated_tests_dir_for("session-b").exists()
    assert settings.request_snapshot_path_for("session-a").exists()
    assert settings.request_snapshot_path_for("session-b").exists()
    assert settings.report_snapshot_path_for("session-a").exists()
    assert settings.report_snapshot_path_for("session-b").exists()
    assert list(settings.generated_tests_dir_for("session-a").glob("test_generated_*.py"))
    assert list(settings.generated_tests_dir_for("session-b").glob("test_generated_*.py"))
