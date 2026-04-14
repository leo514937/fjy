from __future__ import annotations

from pathlib import Path

import pytest

from ontology_audit_hub.infra.github_snapshot import GitHubSnapshotError, collect_review_files, parse_github_repo_target


def test_parse_github_repo_target_builds_archive_url() -> None:
    target = parse_github_repo_target("https://github.com/openai/openai-python", "main")

    assert target.owner == "openai"
    assert target.repo == "openai-python"
    assert target.ref == "main"
    assert target.archive_url.endswith("/repos/openai/openai-python/zipball/main")


def test_collect_review_files_expands_directories_and_filters_binary_content(tmp_path: Path) -> None:
    snapshot_dir = tmp_path / "repo"
    (snapshot_dir / "src").mkdir(parents=True)
    (snapshot_dir / ".github").mkdir(parents=True)
    (snapshot_dir / "src" / "app.py").write_text("def run():\n    return 'ok'\n", encoding="utf-8")
    (snapshot_dir / ".github" / "workflow.yml").write_text("name: ci\n", encoding="utf-8")
    (snapshot_dir / "binary.bin").write_bytes(b"\x00\x01\x02\x03")
    (snapshot_dir / "src" / "large.txt").write_text("x" * 19_000, encoding="utf-8")

    files, warnings = collect_review_files(snapshot_dir, ["src", ".github", "binary.bin"])

    assert sorted(item.path for item in files) == [".github/workflow.yml", "src/app.py", "src/large.txt"]
    assert any(item.path == "src/large.txt" and item.truncated for item in files)
    assert "已跳过二进制文件：binary.bin" in warnings
    assert "审查前已截断大文件：src/large.txt" in warnings


def test_collect_review_files_rejects_path_traversal(tmp_path: Path) -> None:
    snapshot_dir = tmp_path / "repo"
    snapshot_dir.mkdir(parents=True)

    with pytest.raises(GitHubSnapshotError) as exc_info:
        collect_review_files(snapshot_dir, ["../secrets.txt"])

    assert exc_info.value.status_code == 400
    assert "无效的仓库相对路径" in exc_info.value.message
