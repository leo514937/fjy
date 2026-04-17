from __future__ import annotations

import json
import os
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import Any


SCHEMA_VERSION = 1
DEFAULT_PROJECT_ID = "demo"
DEFAULT_FILENAME = "wikimg_export.json"
DEFAULT_AGENT_NAME = "wikimg-export"
DEFAULT_COMMITTER_NAME = "wikimg-export"
DEFAULT_STATUS = "开发中"


def sync_export_payload(
    *,
    workspace_root: Path,
    profile: str,
    payload: dict[str, Any],
) -> dict[str, Any]:
    target = _resolve_target(workspace_root)
    project_dir = target["storage_root"] / target["project_id"]
    project_dir.mkdir(parents=True, exist_ok=True)

    _ensure_git_repo(project_dir)

    export_path = project_dir / target["filename"]
    container = _load_container(export_path, target["project_id"], target["filename"])
    if container is None:
        _warn(f"跳过 OntoGit 同步：现有文件结构非法，未覆盖 {export_path}")
        return {"status": "skipped", "path": str(export_path)}

    history = container["history"]
    next_sequence = len(history) + 1
    exported_at = datetime.now().astimezone().isoformat()
    snapshot = {
        "sequence": next_sequence,
        "profile": profile,
        "exported_at": exported_at,
        "workspace_root": str(workspace_root),
        "summary": _build_summary(payload),
        "payload": payload,
    }
    history.append(snapshot)
    container["schema_version"] = SCHEMA_VERSION
    container["project_id"] = target["project_id"]
    container["filename"] = target["filename"]

    export_path.write_text(json.dumps(container, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    basevision = _read_latest_version_id(project_dir, target["filename"])
    _write_project_meta(project_dir, target["project_id"], basevision)
    _commit_snapshot(project_dir, target["filename"], next_sequence, basevision)

    return {
        "status": "success",
        "path": str(export_path),
        "sequence": next_sequence,
    }


def _resolve_target(workspace_root: Path) -> dict[str, Any]:
    storage_root = os.environ.get("WIKIMG_ONTOGIT_STORAGE_ROOT", "").strip()
    if storage_root:
        resolved_storage_root = Path(storage_root).resolve()
    else:
        knowledge_data_root = os.environ.get("KNOWLEDGE_DATA_ROOT", "").strip()
        if knowledge_data_root:
            resolved_storage_root = (Path(knowledge_data_root).resolve() / "store").resolve()
        else:
            resolved_storage_root = (workspace_root / "store").resolve()

    project_id = os.environ.get("WIKIMG_ONTOGIT_PROJECT_ID", DEFAULT_PROJECT_ID).strip() or DEFAULT_PROJECT_ID
    filename = os.environ.get("WIKIMG_ONTOGIT_FILENAME", DEFAULT_FILENAME).strip() or DEFAULT_FILENAME
    return {
        "storage_root": resolved_storage_root,
        "project_id": project_id,
        "filename": filename,
    }


def _load_container(path: Path, project_id: str, filename: str) -> dict[str, Any] | None:
    if not path.exists():
        return {
            "schema_version": SCHEMA_VERSION,
            "project_id": project_id,
            "filename": filename,
            "history": [],
        }

    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None

    if not isinstance(payload, dict):
        return None
    history = payload.get("history")
    if not isinstance(history, list):
        return None
    return payload


def _build_summary(payload: dict[str, Any]) -> dict[str, Any]:
    knowledge_graph = payload.get("knowledgeGraph", {}) if isinstance(payload, dict) else {}
    statistics = knowledge_graph.get("statistics", {}) if isinstance(knowledge_graph, dict) else {}
    documents = payload.get("documents", []) if isinstance(payload, dict) else []
    layers = statistics.get("layers", [])
    return {
        "total_entities": int(statistics.get("total_entities", 0) or 0),
        "total_relations": int(statistics.get("total_relations", 0) or 0),
        "document_count": len(documents) if isinstance(documents, list) else 0,
        "layers": list(layers) if isinstance(layers, list) else [],
    }


def _ensure_git_repo(project_dir: Path) -> None:
    git_dir = project_dir / ".git"
    if git_dir.exists():
        return
    _run_git(project_dir, "init")


def _read_latest_version_id(project_dir: Path, filename: str) -> int:
    result = _run_git(project_dir, "log", "--format=%B", "-1", "--", filename, check=False)
    if result.returncode != 0:
        return 0
    for line in result.stdout.splitlines():
        if line.startswith("XG-VersionId:"):
            raw = line.split(":", 1)[1].strip()
            if raw.isdigit():
                return int(raw)
    return 0


def _write_project_meta(project_dir: Path, project_id: str, basevision: int) -> None:
    meta_path = project_dir / "project_meta.json"
    existing: dict[str, Any] = {}
    if meta_path.exists():
        try:
            loaded = json.loads(meta_path.read_text(encoding="utf-8"))
            if isinstance(loaded, dict):
                existing = loaded
        except json.JSONDecodeError:
            existing = {}

    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    meta = {
        "project_id": project_id,
        "name": existing.get("name") or project_id,
        "description": existing.get("description", ""),
        "status": existing.get("status") or DEFAULT_STATUS,
        "created_at": existing.get("created_at") or now,
        "updated_at": now,
        "official_recommendations": existing.get("official_recommendations", {}),
        "official_history": existing.get("official_history", {}),
        "last_agent": DEFAULT_AGENT_NAME,
        "last_committer": DEFAULT_COMMITTER_NAME,
        "last_message": "System: append WiKiMG export snapshot",
        "last_basevision": basevision,
    }
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=4) + "\n", encoding="utf-8")


def _commit_snapshot(project_dir: Path, filename: str, next_version_id: int, basevision: int) -> None:
    full_message = (
        "System: append WiKiMG export snapshot\n\n"
        f"XG-Filename: {filename}\n"
        f"XG-VersionId: {next_version_id}\n"
        f"XG-BaseVersion: {basevision}\n"
        f"XG-ObjectName: {DEFAULT_AGENT_NAME}\n"
        f"XG-CommitterName: {DEFAULT_COMMITTER_NAME}"
    )
    _run_git(project_dir, "add", filename, "project_meta.json")
    _run_git(
        project_dir,
        "-c",
        f"user.name={DEFAULT_COMMITTER_NAME}",
        "-c",
        f"user.email={DEFAULT_COMMITTER_NAME}@local",
        "commit",
        f"--author={DEFAULT_COMMITTER_NAME} <{DEFAULT_COMMITTER_NAME}@local>",
        "-m",
        full_message,
    )


def _run_git(project_dir: Path, *args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    completed = subprocess.run(
        ["git", *args],
        cwd=project_dir,
        capture_output=True,
        text=True,
        check=False,
    )
    if check and completed.returncode != 0:
        raise RuntimeError(completed.stderr.strip() or completed.stdout.strip() or "git command failed")
    return completed


def _warn(message: str) -> None:
    print(f"Warning: {message}", file=sys.stderr)
