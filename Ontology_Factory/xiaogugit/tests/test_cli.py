from __future__ import annotations

import json
import shutil
import subprocess
import sys
import uuid
from pathlib import Path
from typing import Any

import pytest

from xiaogugit.cli import main as cli_main
from xiaogugit.manager import XiaoGuGitManager


def _invoke(capsys: pytest.CaptureFixture[str], *args: str) -> tuple[int, Any, str]:
    exit_code = cli_main(list(args))
    captured = capsys.readouterr()
    payload = json.loads(captured.out) if captured.out.strip() else None
    return exit_code, payload, captured.err.strip()


def _write_json(path: Path, payload: Any) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


@pytest.fixture
def test_root() -> Path:
    base = Path(__file__).resolve().parent / ".tmp"
    base.mkdir(exist_ok=True)
    created = base / f"codex_xiaogugit_{uuid.uuid4().hex}"
    created.mkdir()
    try:
        yield created
    finally:
        shutil.rmtree(created, ignore_errors=True)


@pytest.fixture
def storage_root(test_root: Path) -> Path:
    return test_root / "storage"


@pytest.fixture
def seeded_project(storage_root: Path) -> dict[str, Any]:
    manager = XiaoGuGitManager(root_dir=str(storage_root))
    manager.init_project("demo", name="Demo Project", description="CLI seed project")
    first = manager.write_version(
        "demo",
        "ontology.json",
        {"version": 1, "nodes": ["pump"]},
        "AI: ontology v1",
        "agent-1",
        "Teacher",
        0,
    )
    second = manager.write_version(
        "demo",
        "ontology.json",
        {"version": 2, "nodes": ["pump", "sensor"]},
        "AI: ontology v2",
        "agent-1",
        "Teacher",
        first["version_id"],
    )
    student = manager.write_version(
        "demo",
        "student.json",
        {"student": "Alice"},
        "AI: student v1",
        "agent-2",
        "Teacher",
        0,
    )
    return {
        "manager": manager,
        "root_dir": str(storage_root),
        "project_id": "demo",
        "first": first,
        "second": second,
        "student": student,
    }


def test_project_init_and_list(storage_root: Path, capsys: pytest.CaptureFixture[str]) -> None:
    exit_code, payload, stderr = _invoke(
        capsys,
        "--root-dir",
        str(storage_root),
        "project",
        "init",
        "--project-id",
        "demo",
        "--name",
        "Demo Project",
    )

    assert exit_code == 0
    assert stderr == ""
    assert payload["status"] == "created"
    assert (storage_root / "demo" / ".git").exists()

    exit_code, payload, stderr = _invoke(
        capsys,
        "--root-dir",
        str(storage_root),
        "project",
        "list",
    )

    assert exit_code == 0
    assert stderr == ""
    assert payload["projects"][0]["project_id"] == "demo"


def test_write_and_read_latest(storage_root: Path, capsys: pytest.CaptureFixture[str], test_root: Path) -> None:
    manager = XiaoGuGitManager(root_dir=str(storage_root))
    manager.init_project("demo")
    data_file = test_root / "ontology.json"
    expected = {"version": 1, "hello": "world"}
    _write_json(data_file, expected)

    exit_code, payload, stderr = _invoke(
        capsys,
        "--root-dir",
        str(storage_root),
        "write",
        "--project-id",
        "demo",
        "--filename",
        "ontology.json",
        "--message",
        "AI: update ontology",
        "--agent-name",
        "agent-1",
        "--committer-name",
        "Teacher",
        "--basevision",
        "0",
        "--data-file",
        str(data_file),
    )

    assert exit_code == 0
    assert stderr == ""
    assert payload["status"] == "success"
    assert payload["version_id"] == 1

    exit_code, payload, stderr = _invoke(
        capsys,
        "--root-dir",
        str(storage_root),
        "read",
        "--project-id",
        "demo",
        "--filename",
        "ontology.json",
    )

    assert exit_code == 0
    assert stderr == ""
    assert payload == {"data": expected}


def test_second_write_with_data_json_and_read_historical_commit(
    storage_root: Path,
    capsys: pytest.CaptureFixture[str],
) -> None:
    manager = XiaoGuGitManager(root_dir=str(storage_root))
    manager.init_project("demo")
    first = manager.write_version(
        "demo",
        "ontology.json",
        {"version": 1, "nodes": ["pump"]},
        "AI: ontology v1",
        "agent-1",
        "Teacher",
        0,
    )

    exit_code, payload, stderr = _invoke(
        capsys,
        "--root-dir",
        str(storage_root),
        "write",
        "--project-id",
        "demo",
        "--filename",
        "ontology.json",
        "--message",
        "AI: ontology v2",
        "--agent-name",
        "agent-1",
        "--committer-name",
        "Teacher",
        "--basevision",
        str(first["version_id"]),
        "--data-json",
        '{"version": 2, "nodes": ["pump", "sensor"]}',
    )

    assert exit_code == 0
    assert stderr == ""
    assert payload["version_id"] == 2

    exit_code, payload, stderr = _invoke(
        capsys,
        "--root-dir",
        str(storage_root),
        "read",
        "--project-id",
        "demo",
        "--filename",
        "ontology.json",
        "--commit-id",
        first["commit_id"],
    )

    assert exit_code == 0
    assert stderr == ""
    assert payload == {"data": {"version": 1, "nodes": ["pump"]}}


def test_log_and_commit_show(seeded_project: dict[str, Any], capsys: pytest.CaptureFixture[str]) -> None:
    exit_code, payload, stderr = _invoke(
        capsys,
        "--root-dir",
        seeded_project["root_dir"],
        "log",
        "--project-id",
        seeded_project["project_id"],
    )

    assert exit_code == 0
    assert stderr == ""
    assert payload["history"][0]["id"] == seeded_project["student"]["commit_id"]

    exit_code, payload, stderr = _invoke(
        capsys,
        "--root-dir",
        seeded_project["root_dir"],
        "commit",
        "show",
        "--project-id",
        seeded_project["project_id"],
        "--commit-id",
        seeded_project["second"]["commit_id"],
    )

    assert exit_code == 0
    assert stderr == ""
    assert payload == seeded_project["manager"].get_commit_detail(
        seeded_project["project_id"],
        seeded_project["second"]["commit_id"],
    )


def test_version_tree_show_and_read(seeded_project: dict[str, Any], capsys: pytest.CaptureFixture[str]) -> None:
    exit_code, payload, stderr = _invoke(
        capsys,
        "--root-dir",
        seeded_project["root_dir"],
        "version",
        "tree",
        "--project-id",
        seeded_project["project_id"],
        "--filename",
        "ontology.json",
    )

    assert exit_code == 0
    assert stderr == ""
    assert payload["version_count"] == 2
    assert payload["latest_version_id"] == 2

    exit_code, payload, stderr = _invoke(
        capsys,
        "--root-dir",
        seeded_project["root_dir"],
        "version",
        "show",
        "--project-id",
        seeded_project["project_id"],
        "--version-id",
        "1",
        "--filename",
        "ontology.json",
    )

    assert exit_code == 0
    assert stderr == ""
    assert payload == seeded_project["manager"].get_version_detail(
        seeded_project["project_id"],
        1,
        "ontology.json",
    )

    exit_code, payload, stderr = _invoke(
        capsys,
        "--root-dir",
        seeded_project["root_dir"],
        "version",
        "read",
        "--project-id",
        seeded_project["project_id"],
        "--version-id",
        "1",
        "--filename",
        "ontology.json",
    )

    assert exit_code == 0
    assert stderr == ""
    assert payload == seeded_project["manager"].read_version_by_id(
        seeded_project["project_id"],
        1,
        "ontology.json",
    )


def test_diff_commits_and_versions(seeded_project: dict[str, Any], capsys: pytest.CaptureFixture[str]) -> None:
    exit_code, payload, stderr = _invoke(
        capsys,
        "--root-dir",
        seeded_project["root_dir"],
        "diff",
        "commits",
        "--project-id",
        seeded_project["project_id"],
        "--filename",
        "ontology.json",
        "--base-commit",
        seeded_project["first"]["commit_id"],
        "--target-commit",
        seeded_project["second"]["commit_id"],
    )

    assert exit_code == 0
    assert stderr == ""
    assert payload["diff"] == seeded_project["manager"].get_diff(
        seeded_project["project_id"],
        "ontology.json",
        seeded_project["first"]["commit_id"],
        seeded_project["second"]["commit_id"],
    )
    assert payload["diff"]

    exit_code, payload, stderr = _invoke(
        capsys,
        "--root-dir",
        seeded_project["root_dir"],
        "diff",
        "versions",
        "--project-id",
        seeded_project["project_id"],
        "--base-version-id",
        "1",
        "--target-version-id",
        "2",
        "--filename",
        "ontology.json",
    )

    assert exit_code == 0
    assert stderr == ""
    assert payload == seeded_project["manager"].diff_versions(
        seeded_project["project_id"],
        1,
        2,
        "ontology.json",
    )


def test_rollback_version(seeded_project: dict[str, Any], capsys: pytest.CaptureFixture[str]) -> None:
    exit_code, payload, stderr = _invoke(
        capsys,
        "--root-dir",
        seeded_project["root_dir"],
        "rollback",
        "version",
        "--project-id",
        seeded_project["project_id"],
        "--version-id",
        "1",
        "--filename",
        "ontology.json",
    )

    assert exit_code == 0
    assert stderr == ""
    assert payload["status"] == "success"
    assert payload["version_id"] == 1

    manager = XiaoGuGitManager(root_dir=seeded_project["root_dir"])
    assert manager.read_version(seeded_project["project_id"], "ontology.json") == {"version": 1, "nodes": ["pump"]}
    assert manager.get_project_info(seeded_project["project_id"])["status"] == "已回滚"


def test_project_status_and_file_list(seeded_project: dict[str, Any], capsys: pytest.CaptureFixture[str]) -> None:
    exit_code, payload, stderr = _invoke(
        capsys,
        "--root-dir",
        seeded_project["root_dir"],
        "project",
        "status",
        "--project-id",
        seeded_project["project_id"],
        "--status",
        "已完成",
        "--operator",
        "teacher",
    )

    assert exit_code == 0
    assert stderr == ""
    assert payload["status"] == "success"
    assert payload["project"]["status"] == "已完成"

    exit_code, payload, stderr = _invoke(
        capsys,
        "--root-dir",
        seeded_project["root_dir"],
        "file",
        "list",
        "--project-id",
        seeded_project["project_id"],
    )

    assert exit_code == 0
    assert stderr == ""
    assert payload == {"files": ["ontology.json", "student.json"]}


def test_delete_soft_marks_latest_version_deleted(seeded_project: dict[str, Any], capsys: pytest.CaptureFixture[str]) -> None:
    exit_code, payload, stderr = _invoke(
        capsys,
        "--root-dir",
        seeded_project["root_dir"],
        "delete",
        "soft",
        "--project-id",
        seeded_project["project_id"],
        "--filename",
        "ontology.json",
        "--message",
        "System: 删除本体 ontology.json",
        "--committer-name",
        "System",
    )

    assert exit_code == 0
    assert stderr == ""
    assert payload["action"] == "deleted"

    tree = seeded_project["manager"].get_file_version_tree(seeded_project["project_id"], "ontology.json")
    assert tree["versions"][-1]["is_deleted"] is True


def test_delete_purge_requires_yes(seeded_project: dict[str, Any], capsys: pytest.CaptureFixture[str]) -> None:
    exit_code, payload, stderr = _invoke(
        capsys,
        "--root-dir",
        seeded_project["root_dir"],
        "delete",
        "purge",
        "--project-id",
        seeded_project["project_id"],
        "--filename",
        "ontology.json",
    )

    assert exit_code == 1
    assert payload is None
    assert "--yes" in stderr


def test_delete_purge_isolated_project(storage_root: Path, capsys: pytest.CaptureFixture[str]) -> None:
    manager = XiaoGuGitManager(root_dir=str(storage_root))
    manager.init_project("demo")
    manager.write_version(
        "demo",
        "ontology.json",
        {"version": 1},
        "AI: ontology v1",
        "agent-1",
        "Teacher",
        0,
    )
    manager.write_version(
        "demo",
        "ontology.json",
        {"version": 2},
        "AI: ontology v2",
        "agent-1",
        "Teacher",
        1,
    )

    exit_code, payload, stderr = _invoke(
        capsys,
        "--root-dir",
        str(storage_root),
        "delete",
        "purge",
        "--project-id",
        "demo",
        "--filename",
        "ontology.json",
        "--yes",
    )

    if exit_code != 0:
        lowered = stderr.lower()
        if "filter-branch" in lowered and ("not a git command" in lowered or "unknown" in lowered or "disabled" in lowered):
            pytest.skip(stderr)
        if "couldn't create signal pipe" in lowered or "win32 error 5" in lowered:
            pytest.skip(stderr)
        pytest.fail(stderr)

    assert payload["action"] == "purged"
    assert payload["version_count"] == 0


def test_python_m_smoke(storage_root: Path) -> None:
    ontology_factory_root = Path(__file__).resolve().parents[2]
    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "xiaogugit",
            "--root-dir",
            str(storage_root),
            "project",
            "list",
        ],
        cwd=ontology_factory_root,
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout) == {"projects": []}
