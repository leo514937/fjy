from __future__ import annotations

import os
import shutil
import subprocess
import sys
import uuid
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
for relative in (
    "storage/src",
    "wiki_agent/src",
    "ner/src",
    "relation/src",
    "ontology_core/src",
    "dls/src",
    "evolution/src",
    "WIKI_MG/src",
):
    candidate = str((ROOT / relative).resolve())
    if candidate not in sys.path:
        sys.path.insert(0, candidate)

from ontology_store import OntologyStore
from wiki_agent import WikiAgentToolbox


@pytest.fixture
def workspace_root() -> Path:
    base = Path(__file__).resolve().parent / ".tmp"
    base.mkdir(exist_ok=True)
    created = base / f"codex_aft_cli_{uuid.uuid4().hex}"
    created.mkdir()
    try:
        yield created
    finally:
        shutil.rmtree(created, ignore_errors=True)


def _toolbox(workspace_root: Path) -> WikiAgentToolbox:
    target_dir = workspace_root / "docs"
    target_dir.mkdir(exist_ok=True)
    store = OntologyStore(str(workspace_root / "wiki.sqlite3"))
    return WikiAgentToolbox(
        store=store,
        document_id="doc_demo",
        doc_name="测试文档",
        clean_text="Payment generates Invoice.",
        run_id="run_demo",
        workspace_root=workspace_root,
        target_folder=target_dir,
    )


def test_toolbox_run_command_allows_aft_review_request_file(
    workspace_root: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    request_path = workspace_root / "review.json"
    request_path.write_text(
        '{"repository_url":"https://github.com/example/repo","ref":"main","paths":["src/app.py"]}',
        encoding="utf-8",
    )
    toolbox = _toolbox(workspace_root)

    def fake_run(argv, **kwargs):
        assert argv[:3] == ["python", "-m", "ontology_audit_hub.review_cli"]
        pythonpath = kwargs["env"]["PYTHONPATH"].split(os.pathsep)
        assert str((workspace_root / "aft" / "aft-main" / "src").resolve()) in pythonpath
        assert str(request_path.resolve()) in argv
        return subprocess.CompletedProcess(argv, 0, stdout='{"summary":"ok"}\n', stderr="")

    monkeypatch.setattr("wiki_agent.tools.subprocess.run", fake_run)

    result = toolbox.tool_run_command(
        f"python -m ontology_audit_hub.review_cli github --request-file {str(request_path.resolve())}"
    )

    assert result["returncode"] == 0
    assert result["stdout"] == '{"summary":"ok"}'


@pytest.mark.parametrize(
    ("command", "expected_module"),
    [
        (
            "python -m ontology_audit_hub.qa_cli answer --request-file {path}",
            "ontology_audit_hub.qa_cli",
        ),
        (
            "python -m ontology_audit_hub.qa_cli upload --file {path}",
            "ontology_audit_hub.qa_cli",
        ),
    ],
)
def test_toolbox_run_command_allows_aft_qa_workspace_files(
    workspace_root: Path,
    monkeypatch: pytest.MonkeyPatch,
    command: str,
    expected_module: str,
) -> None:
    payload_path = workspace_root / "payload.json"
    payload_path.write_text('{"question":"Explain Payment."}', encoding="utf-8")
    toolbox = _toolbox(workspace_root)

    def fake_run(argv, **kwargs):
        assert argv[:3] == ["python", "-m", expected_module]
        pythonpath = kwargs["env"]["PYTHONPATH"].split(os.pathsep)
        assert str((workspace_root / "aft" / "aft-main" / "src").resolve()) in pythonpath
        assert str(payload_path.resolve()) in argv
        return subprocess.CompletedProcess(argv, 0, stdout='{"answer":"ok"}\n', stderr="")

    monkeypatch.setattr("wiki_agent.tools.subprocess.run", fake_run)

    result = toolbox.tool_run_command(command.format(path=str(payload_path.resolve())))

    assert result["returncode"] == 0


@pytest.mark.parametrize(
    "command_template",
    [
        "python -m ontology_audit_hub.review_cli github --request-file {path}",
        "python -m ontology_audit_hub.qa_cli answer --request-file {path}",
        "python -m ontology_audit_hub.qa_cli upload --file {path}",
    ],
)
def test_toolbox_run_command_rejects_aft_cli_paths_outside_workspace(
    workspace_root: Path,
    command_template: str,
) -> None:
    toolbox = _toolbox(workspace_root)
    outside_path = workspace_root.parent / "outside-request.json"

    with pytest.raises(ValueError):
        toolbox.tool_run_command(command_template.format(path=str(outside_path.resolve())))
