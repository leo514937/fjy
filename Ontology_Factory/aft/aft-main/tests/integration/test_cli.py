import json

from typer.testing import CliRunner

from ontology_audit_hub.cli import app

runner = CliRunner()


def _set_local_env(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("ONTOLOGY_AUDIT_RUN_ROOT", str(tmp_path / "runs"))
    monkeypatch.setenv("ONTOLOGY_AUDIT_CHECKPOINT_PATH", str(tmp_path / "checkpoints.sqlite3"))
    monkeypatch.setenv("ONTOLOGY_AUDIT_QDRANT_ENABLED", "false")
    monkeypatch.setenv("ONTOLOGY_AUDIT_NEO4J_ENABLED", "false")
    monkeypatch.setenv("ONTOLOGY_AUDIT_LLM_ENABLED", "false")


def test_cli_run_outputs_report_json(monkeypatch, tmp_path) -> None:
    _set_local_env(monkeypatch, tmp_path)
    result = runner.invoke(app, ["run", "--request", "examples/minimal/request.yaml"])

    assert result.exit_code == 0
    payload = json.loads(result.stdout)
    assert payload["summary"] == "Audit completed without findings."


def test_cli_run_outputs_human_input_payload(monkeypatch, tmp_path) -> None:
    _set_local_env(monkeypatch, tmp_path)
    result = runner.invoke(app, ["run", "--request", "examples/hitl/request.yaml"])

    assert result.exit_code == 0
    payload = json.loads(result.stdout)
    assert payload["status"] == "requires_human_input"


def test_cli_doctor_outputs_readiness_json(monkeypatch, tmp_path) -> None:
    _set_local_env(monkeypatch, tmp_path)
    result = runner.invoke(app, ["doctor"])

    assert result.exit_code == 0
    payload = json.loads(result.stdout)
    assert payload["status"] == "ready"
    assert "artifact_layout" in payload
