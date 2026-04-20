from __future__ import annotations

import json
import os
import sys
from dataclasses import dataclass
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any


DEFAULT_GATEWAY_URL = "http://127.0.0.1:8080"
DEFAULT_API_KEY = "change-me"
DEFAULT_PROJECT_ID = "demo"
DEFAULT_FILENAME = "wikimg_export.json"
DEFAULT_WIKI_DIR_NAME = "wiki"
WIKIMG_LAYERS = ("common", "domain", "private")
DEFAULT_AGENT_NAME = "wikimg-export"
DEFAULT_COMMITTER_NAME = "wikimg-export"
DEFAULT_STATUS = "开发中"
DEFAULT_MESSAGE = "System: sync WiKiMG export snapshot"
DEFAULT_DIR_SYNC_MESSAGE = "System: sync WiKiMG wiki directory"
DEFAULT_FETCH_MESSAGE = "System: fetch WiKiMG wiki directory"
DEFAULT_TIMEOUT_SECONDS = 15.0


class OntoGitSyncError(RuntimeError):
    def __init__(self, message: str, *, status_code: int | None = None, payload: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.payload = payload or {}


@dataclass(slots=True)
class SyncFileResult:
    filename: str
    action: str
    version_id: int | None = None
    basevision: int | None = None
    commit_id: str | None = None

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "filename": self.filename,
            "action": self.action,
        }
        if self.version_id is not None:
            payload["version_id"] = self.version_id
        if self.basevision is not None:
            payload["basevision"] = self.basevision
        if self.commit_id is not None:
            payload["commit_id"] = self.commit_id
        return payload


def sync_export_payload(
    *,
    workspace_root: Path,
    profile: str,
    payload: dict[str, Any],
) -> dict[str, Any]:
    gateway = _resolve_gateway()
    target = _resolve_target()
    project_state = _safe_get_project_state(gateway, target["project_id"])
    basevision = project_state["latest_version_ids"].get(target["filename"], 0)
    result = _call_api(
        gateway,
        "/xg/write",
        method="POST",
        data={
            "project_id": target["project_id"],
            "filename": target["filename"],
            "data": payload,
            "message": _build_message(profile, workspace_root, payload),
            "agent_name": DEFAULT_AGENT_NAME,
            "committer_name": DEFAULT_COMMITTER_NAME,
            "basevision": basevision,
        },
    )

    return {
        "status": str(result.get("status") or "success"),
        "project_id": target["project_id"],
        "filename": target["filename"],
        "basevision": int(result.get("basevision", basevision) or basevision),
        "currvision": int(result.get("currvision", result.get("version_id", 0)) or 0),
        "version_id": int(result.get("version_id", result.get("currvision", 0)) or 0),
        "commit_id": str(result.get("commit_id") or ""),
    }


def sync_wiki_directory(
    *,
    workspace_root: Path,
    wiki_dir: Path,
    project_id: str | None = None,
    root_filename: str | None = None,
) -> dict[str, Any]:
    gateway = _resolve_gateway()

    wiki_dir = wiki_dir.resolve()
    if not wiki_dir.exists() or not wiki_dir.is_dir():
        raise OntoGitSyncError(f"wiki 目录不存在或不是目录: {wiki_dir}")

    local_files = _collect_local_files(workspace_root=workspace_root, wiki_dir=wiki_dir)

    grouped_local_files: dict[str, list[tuple[Path, str, str, Any]]] = {}
    for local_path, relative_filename in local_files:
        project_id_value, target_filename, payload = _prepare_sync_payload(local_path, relative_filename)
        grouped_local_files.setdefault(project_id_value, []).append((local_path, relative_filename, target_filename, payload))

    results: list[SyncFileResult] = []
    written_files: set[str] = set()
    deleted_files: set[str] = set()

    for project_id_value in WIKIMG_LAYERS:
        items = grouped_local_files.get(project_id_value, [])
        project_state = _safe_get_project_state(gateway, project_id_value)
        remote_files = set(project_state["files"])
        if not items and not remote_files:
            continue

        for local_path, _relative_filename, target_filename, payload in items:
            remote_payload = _read_remote_file_payload(
                gateway=gateway,
                project_id=project_id_value,
                filename=target_filename,
            )
            if remote_payload is not None and _payloads_equal(remote_payload, payload):
                results.append(
                    SyncFileResult(
                        filename=f"{project_id_value}/{target_filename}",
                        action="skipped",
                        basevision=project_state["latest_version_ids"].get(target_filename, 0) or None,
                    )
                )
                continue
            write_result = _write_file_and_infer(
                gateway=gateway,
                project_id=project_id_value,
                filename=target_filename,
                data=payload,
                message=_build_directory_message(local_path, workspace_root, wiki_dir),
                basevision=project_state["latest_version_ids"].get(target_filename, 0),
            )
            results.append(
                SyncFileResult(
                    filename=f"{project_id_value}/{target_filename}",
                    action="written" if write_result.get("status") == "success" else "skipped",
                    version_id=int(write_result.get("version_id", 0) or 0) or None,
                    basevision=int(write_result.get("basevision", 0) or 0) or None,
                    commit_id=str(write_result.get("commit_id") or "") or None,
                )
            )
            written_files.add(f"{project_id_value}/{target_filename}")

        local_target_filenames = {item[2] for item in items}
        for remote_filename in sorted(remote_files - local_target_filenames):
            delete_result = _delete_file(
                gateway=gateway,
                project_id=project_id_value,
                filename=remote_filename,
                message=f"{DEFAULT_DIR_SYNC_MESSAGE}: remove missing file {remote_filename}",
                basevision=project_state["latest_version_ids"].get(remote_filename, 0),
            )
            results.append(
                SyncFileResult(
                    filename=f"{project_id_value}/{remote_filename}",
                    action="deleted",
                    version_id=int(delete_result.get("version_id", 0) or 0) or None,
                    basevision=int(delete_result.get("basevision", 0) or 0) or None,
                    commit_id=str(delete_result.get("commit_id") or "") or None,
                )
            )
            deleted_files.add(f"{project_id_value}/{remote_filename}")

    return {
        "status": "success",
        "project_id": project_id or "",
        "wiki_dir": str(wiki_dir),
        "written_count": len(written_files),
        "deleted_count": len(deleted_files),
        "changes": [result.to_dict() for result in results],
    }


def fetch_wiki_directory(
    *,
    workspace_root: Path,
    wiki_dir: Path,
    project_id: str | None = None,
) -> dict[str, Any]:
    gateway = _resolve_gateway()
    wiki_dir = wiki_dir.resolve()
    wiki_dir.mkdir(parents=True, exist_ok=True)

    project_ids = [project_id.strip()] if project_id and project_id.strip() else list(WIKIMG_LAYERS)
    fetched_files: list[str] = []
    skipped_files: list[str] = []

    for project_id_value in project_ids:
        project_state = _safe_get_project_state(gateway, project_id_value)
        for remote_filename in sorted(project_state["files"]):
            remote_payload = _read_remote_file_payload(
                gateway=gateway,
                project_id=project_id_value,
                filename=remote_filename,
            )
            if remote_payload is None:
                continue

            local_path = wiki_dir / project_id_value / _remote_filename_to_local_name(remote_filename)
            local_path.parent.mkdir(parents=True, exist_ok=True)
            rendered = _render_fetched_payload(remote_payload, remote_filename)
            if local_path.exists() and local_path.read_text(encoding="utf-8") == rendered:
                skipped_files.append(f"{project_id_value}/{remote_filename}")
                continue
            local_path.write_text(rendered, encoding="utf-8")
            fetched_files.append(f"{project_id_value}/{remote_filename}")

    return {
        "status": "success",
        "workspace_root": str(workspace_root),
        "wiki_dir": str(wiki_dir),
        "fetched_count": len(fetched_files),
        "skipped_count": len(skipped_files),
        "fetched_files": fetched_files,
        "skipped_files": skipped_files,
    }


def _resolve_target(*, project_id: str | None = None, filename: str | None = None) -> dict[str, str]:
    project_id_value = (
        (project_id or "").strip()
        or os.environ.get("WIKIMG_ONTOGIT_PROJECT_ID", DEFAULT_PROJECT_ID).strip()
        or DEFAULT_PROJECT_ID
    )
    filename_value = (
        (filename or "").strip()
        or os.environ.get("WIKIMG_ONTOGIT_FILENAME", DEFAULT_FILENAME).strip()
        or DEFAULT_FILENAME
    )
    return {
        "project_id": project_id_value,
        "filename": filename_value,
    }


def _resolve_gateway() -> dict[str, Any]:
    gateway_url = os.environ.get("WIKIMG_ONTOGIT_GATEWAY_URL", DEFAULT_GATEWAY_URL).strip() or DEFAULT_GATEWAY_URL
    api_key = (
        os.environ.get("WIKIMG_ONTOGIT_API_KEY", "").strip()
        or os.environ.get("GATEWAY_SERVICE_API_KEY", "").strip()
        or DEFAULT_API_KEY
    )
    bearer_token = (
        os.environ.get("WIKIMG_ONTOGIT_BEARER_TOKEN", "").strip()
        or os.environ.get("WIKIMG_ONTOGIT_TOKEN", "").strip()
    )
    timeout_raw = os.environ.get("WIKIMG_ONTOGIT_TIMEOUT_SECONDS", "").strip()
    timeout = DEFAULT_TIMEOUT_SECONDS
    if timeout_raw:
        try:
            timeout = max(float(timeout_raw), 0.1)
        except ValueError as exc:
            raise OntoGitSyncError(f"WIKIMG_ONTOGIT_TIMEOUT_SECONDS 非法: {timeout_raw}") from exc
    return {
        "gateway_url": gateway_url.rstrip("/"),
        "api_key": api_key,
        "bearer_token": bearer_token,
        "timeout": timeout,
    }

def _get_project_state(gateway: dict[str, Any], project_id: str) -> dict[str, Any]:
    payload = _call_api(gateway, f"/xg/timelines/{urllib.parse.quote(project_id, safe='')}")
    timelines = payload.get("timelines", [])
    if not isinstance(timelines, list):
        timelines = []

    files: list[str] = []
    latest_version_ids: dict[str, int] = {}
    for item in timelines:
        if not isinstance(item, dict):
            continue
        filename = item.get("filename")
        if not isinstance(filename, str) or not filename.strip():
            continue
        files.append(filename)
        try:
            latest_version_ids[filename] = int(item.get("latest_version_id") or 0)
        except (TypeError, ValueError):
            latest_version_ids[filename] = 0

    return {"files": files, "latest_version_ids": latest_version_ids}


def _safe_get_project_state(gateway: dict[str, Any], project_id: str) -> dict[str, Any]:
    try:
        return _get_project_state(gateway, project_id)
    except OntoGitSyncError as exc:
        if exc.status_code == 404:
            return {"files": [], "latest_version_ids": {}}
        raise


def _write_file_and_infer(
    *,
    gateway: dict[str, Any],
    project_id: str,
    filename: str,
    data: Any,
    message: str,
    basevision: int,
) -> dict[str, Any]:
    return _call_api(
        gateway,
        "/xg/write",
        method="POST",
        data={
            "project_id": project_id,
            "filename": filename,
            "data": data,
            "message": message,
            "agent_name": DEFAULT_AGENT_NAME,
            "committer_name": DEFAULT_COMMITTER_NAME,
            "basevision": basevision,
        },
    )


def _delete_file(
    *,
    gateway: dict[str, Any],
    project_id: str,
    filename: str,
    message: str,
    basevision: int,
) -> dict[str, Any]:
    return _call_api(
        gateway,
        "/xg/delete",
        method="POST",
        data={
            "project_id": project_id,
            "filename": filename,
            "message": message,
            "committer_name": DEFAULT_COMMITTER_NAME,
            "agent_name": DEFAULT_AGENT_NAME,
            "purge_history": False,
            "basevision": basevision,
        },
    )


def _remote_filename_to_local_name(remote_filename: str) -> str:
    name = remote_filename.strip()
    if name.lower().endswith(".json"):
        name = name[:-5] + ".md"
    elif not name.lower().endswith(".md"):
        name = f"{name}.md"
    return name


def _render_fetched_payload(payload: Any, remote_filename: str) -> str:
    if isinstance(payload, dict) and "content" in payload and isinstance(payload["content"], str):
        content = payload["content"]
        if not content.endswith("\n"):
            content += "\n"
        return content
    if isinstance(payload, str):
        return payload if payload.endswith("\n") else payload + "\n"
    rendered = json.dumps(payload, ensure_ascii=False, indent=2)
    if not rendered.endswith("\n"):
        rendered += "\n"
    return rendered


def _read_remote_file_payload(
    *,
    gateway: dict[str, Any],
    project_id: str,
    filename: str,
) -> Any | None:
    try:
        payload = _call_api(
            gateway,
            f"/xg/read/{urllib.parse.quote(project_id, safe='')}/{urllib.parse.quote(filename, safe='')}",
        )
    except OntoGitSyncError as exc:
        if exc.status_code == 404:
            return None
        raise

    if not isinstance(payload, dict):
        return None
    return payload.get("data")


def _payloads_equal(left: Any, right: Any) -> bool:
    if isinstance(left, dict) and isinstance(right, dict):
        return _canonical_json(left) == _canonical_json(right)
    return left == right


def _canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _build_message(profile: str, workspace_root: Path, payload: dict[str, Any]) -> str:
    summary = _build_summary(payload)
    return (
        f"{DEFAULT_MESSAGE} profile={profile} "
        f"entities={summary['total_entities']} relations={summary['total_relations']} "
        f"docs={summary['document_count']} workspace={workspace_root}"
    )


def _build_directory_message(local_path: Path, workspace_root: Path, wiki_dir: Path) -> str:
    relative_path = local_path.relative_to(workspace_root).as_posix()
    wiki_relative = local_path.relative_to(wiki_dir).as_posix()
    return f"{DEFAULT_DIR_SYNC_MESSAGE} path={relative_path} wiki_path={wiki_relative}"


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


def _collect_local_files(*, workspace_root: Path, wiki_dir: Path) -> list[tuple[Path, str]]:
    results: list[tuple[Path, str]] = []
    for path in sorted(wiki_dir.rglob("*")):
        if not path.is_file():
            continue
        relative = path.relative_to(wiki_dir).as_posix()
        if relative.startswith(".git/"):
            continue
        filename = f"wiki/{relative}"
        results.append((path, filename))
    return results


def _read_local_file_payload(path: Path) -> Any:
    if path.suffix.lower() in {".json", ".jsonl"}:
        text = path.read_text(encoding="utf-8")
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            return text
    return path.read_text(encoding="utf-8")


def _prepare_sync_payload(local_path: Path, relative_filename: str) -> tuple[str, str, Any]:
    payload = _read_local_file_payload(local_path)
    relative_path = Path(relative_filename)
    parts = relative_path.parts
    if len(parts) < 3 or parts[0] != DEFAULT_WIKI_DIR_NAME:
        raise OntoGitSyncError(f"无法识别的 wiki 文件路径: {relative_filename}")

    layer = parts[1]
    flattened_name = "_".join(parts[2:])
    if local_path.suffix.lower() == ".md":
        flattened_name = str(Path(flattened_name).with_suffix(".json"))
        return layer, flattened_name, {"content": str(payload)}
    return layer, flattened_name, payload


def _call_api(
    gateway: dict[str, Any],
    path: str,
    *,
    method: str = "GET",
    data: dict[str, Any] | None = None,
) -> dict[str, Any]:
    url = f"{gateway['gateway_url']}{path}"
    headers = {
        "Content-Type": "application/json",
    }
    if gateway.get("bearer_token"):
        headers["Authorization"] = f"Bearer {gateway['bearer_token']}"
    elif gateway.get("api_key"):
        headers["X-API-Key"] = str(gateway["api_key"])

    body = None
    if data is not None:
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")

    request = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=float(gateway["timeout"])) as response:
            raw = response.read().decode("utf-8")
            return _load_json_payload(raw, url=url)
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        payload = _try_load_json(raw)
        detail = ""
        if isinstance(payload, dict):
            detail = str(payload.get("detail") or payload.get("message") or "").strip()
        message = detail or raw.strip() or f"HTTP {exc.code}"
        raise OntoGitSyncError(
            f"OntoGit API 请求失败: {method} {url} -> {exc.code} {message}",
            status_code=exc.code,
            payload=payload if isinstance(payload, dict) else {},
        ) from exc
    except urllib.error.URLError as exc:
        raise OntoGitSyncError(f"OntoGit API 不可达: {method} {url} -> {exc.reason}") from exc


def _load_json_payload(raw: str, *, url: str) -> dict[str, Any]:
    payload = _try_load_json(raw)
    if not isinstance(payload, dict):
        raise OntoGitSyncError(f"OntoGit API 返回了非 JSON 对象响应: {url}")
    return payload


def _try_load_json(raw: str) -> Any:
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return None


def _warn(message: str) -> None:
    print(f"Warning: {message}", file=sys.stderr)
