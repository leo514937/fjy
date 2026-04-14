from __future__ import annotations

import os
import shutil
import subprocess
import uuid
from pathlib import Path

import pytest

from ontology_store import OntologyStore
from wiki_agent import WikiAgentToolbox


@pytest.fixture
def workspace_root() -> Path:
    base = Path(__file__).resolve().parent / ".tmp"
    base.mkdir(exist_ok=True)
    created = base / f"codex_wiki_agent_{uuid.uuid4().hex}"
    created.mkdir()
    try:
        yield created
    finally:
        shutil.rmtree(created, ignore_errors=True)


def test_toolbox_run_command_allows_xiaogugit_module_with_workspace_paths(
    workspace_root: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    target_dir = workspace_root / "docs"
    target_dir.mkdir()
    payload_path = workspace_root / "payload.json"
    payload_path.write_text('{"hello":"world"}', encoding="utf-8")
    store = OntologyStore(str(workspace_root / "wiki.sqlite3"))
    toolbox = WikiAgentToolbox(
        store=store,
        document_id="doc_demo",
        doc_name="测试文档",
        clean_text="智能养鱼系统连接 OneNet",
        run_id="run_demo",
        workspace_root=workspace_root,
        target_folder=target_dir,
    )

    def fake_run(argv, **kwargs):
        assert argv[:3] == ["python", "-m", "xiaogugit"]
        assert kwargs["env"]["PYTHONPATH"].split(os.pathsep)[0] == str(workspace_root.resolve())
        assert str((workspace_root / "storage").resolve()) in argv
        assert str(payload_path.resolve()) in argv
        return subprocess.CompletedProcess(argv, 0, stdout='{"projects":[]}\n', stderr="")

    monkeypatch.setattr("wiki_agent.tools.subprocess.run", fake_run)

    result = toolbox.tool_run_command(
        f"python -m xiaogugit --root-dir {str((workspace_root / 'storage').resolve())} "
        f"write --project-id demo --filename ontology.json --message test "
        f"--agent-name agent-1 --committer-name teacher --basevision 0 --data-file {str(payload_path.resolve())}"
    )

    assert result["returncode"] == 0
    assert result["stdout"] == '{"projects":[]}'


def test_toolbox_run_command_rejects_xiaogugit_path_outside_workspace(workspace_root: Path) -> None:
    target_dir = workspace_root / "docs"
    target_dir.mkdir()
    outside_root = workspace_root.parent / "outside-storage"
    store = OntologyStore(str(workspace_root / "wiki.sqlite3"))
    toolbox = WikiAgentToolbox(
        store=store,
        document_id="doc_demo",
        doc_name="测试文档",
        clean_text="智能养鱼系统连接 OneNet",
        run_id="run_demo",
        workspace_root=workspace_root,
        target_folder=target_dir,
    )

    with pytest.raises(ValueError):
        toolbox.tool_run_command(
            f"python -m xiaogugit --root-dir {str(outside_root.resolve())} project list"
        )
