from __future__ import annotations

import subprocess
import sys
import os
from pathlib import Path
from typing import Any

from wikimg.core import (
    create_document,
    discover_workspace,
    init_workspace,
    move_document,
    normalize_layer,
    resolve_document,
    scan_documents,
    search_documents,
    slugify,
)


class WikimgBackend:
    def __init__(self, workspace_root: str | Path) -> None:
        self.workspace_root = Path(workspace_root).resolve()
        try:
            self.workspace = discover_workspace(self.workspace_root)
        except Exception:
            self.workspace = init_workspace(self.workspace_root)

    def run_cli(self, *args: str) -> dict[str, Any]:
        command = [sys.executable, "-m", "wikimg", "--root", str(self.workspace.root), *args]
        completed = subprocess.run(
            command,
            cwd=str(self.workspace.root),
            capture_output=True,
            text=True,
        )
        return {
            "command": command,
            "returncode": completed.returncode,
            "stdout": completed.stdout,
            "stderr": completed.stderr,
            "ok": completed.returncode == 0,
        }

    def list_documents(self, layer: str | None = None) -> list[dict[str, Any]]:
        documents = scan_documents(self.workspace, layer=normalize_layer(layer) if layer else None)
        return [self._document_payload(document) for document in documents]

    def search(self, query: str, *, layer: str | None = None, content: bool = True, limit: int = 8) -> list[dict[str, Any]]:
        documents = search_documents(
            self.workspace,
            query,
            layer=normalize_layer(layer) if layer else None,
            content=content,
        )
        return [self._document_payload(document) for document in documents[:limit]]

    def find_by_title(self, title: str, *, layer: str | None = None, threshold: float = 0.88) -> dict[str, Any] | None:
        normalized_title = title.strip().lower()
        candidates = self.list_documents(layer=layer)
        best: tuple[float, dict[str, Any] | None] = (0.0, None)
        for candidate in candidates:
            score = max(
                _similarity(normalized_title, str(candidate["title"]).strip().lower()),
                _similarity(slugify(title), str(candidate["slug"])),
            )
            if score > best[0]:
                best = (score, candidate)
        if best[0] >= threshold:
            return best[1]
        return None

    def ensure_document(self, *, layer: str, title: str, slug: str | None = None) -> dict[str, Any]:
        normalized_layer = normalize_layer(layer)
        target_slug = slugify(slug or title)
        ref = f"{normalized_layer}:{target_slug}"
        try:
            document = resolve_document(self.workspace, ref)
            return self._document_payload(document)
        except Exception:
            document = create_document(self.workspace, normalized_layer, title, slug=target_slug)
            return self._document_payload(document)

    def read_document(self, reference: str) -> dict[str, Any]:
        document = resolve_document(self.workspace, reference)
        payload = self._document_payload(document)
        payload["content"] = document.path.read_text(encoding="utf-8")
        return payload

    def write_document(self, reference: str, *, content: str, title: str | None = None) -> dict[str, Any]:
        document = resolve_document(self.workspace, reference)
        final_content = content
        if title and not final_content.lstrip().startswith("# "):
            final_content = f"# {title}\n\n{content.strip()}\n"
        elif not final_content.endswith("\n"):
            final_content += "\n"
        document.path.write_text(final_content, encoding="utf-8")
        updated = resolve_document(self.workspace, reference)
        payload = self._document_payload(updated)
        payload["content"] = updated.path.read_text(encoding="utf-8")
        return payload

    def move_document(self, reference: str, target_layer: str) -> dict[str, Any]:
        document = move_document(self.workspace, reference, normalize_layer(target_layer))
        return self._document_payload(document)

    def relative_link(self, source_ref: str, target_ref: str) -> str:
        source = resolve_document(self.workspace, source_ref)
        target = resolve_document(self.workspace, target_ref)
        return os.path.relpath(target.path, start=source.path.parent)

    def _document_payload(self, document) -> dict[str, Any]:
        return {
            "layer": document.layer,
            "slug": document.slug,
            "title": document.title,
            "ref": document.ref,
            "path": str(document.path),
            "relative_path": document.relative_path,
            "updated_at": document.updated_at,
        }


def _similarity(left: str, right: str) -> float:
    if not left or not right:
        return 0.0
    if left == right:
        return 1.0
    if left in right or right in left:
        return min(len(left), len(right)) / max(len(left), len(right))
    matches = sum(1 for a, b in zip(left, right) if a == b)
    return matches / max(len(left), len(right))
