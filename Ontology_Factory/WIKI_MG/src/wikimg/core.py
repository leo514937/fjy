from __future__ import annotations

import json
import os
import re
import shlex
import subprocess
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Iterable

LAYERS = ("common", "domain", "private")
LAYER_ALIASES = {
    "common": "common",
    "domain": "domain",
    "private": "private",
    "shared": "common",
    "general": "common",
}
CONFIG_DIR = ".wikimg"
CONFIG_FILE = "config.json"
DEFAULT_DOCS_DIR = "wiki"


class WikiError(RuntimeError):
    """Raised when the workspace or document state is invalid."""


@dataclass(slots=True)
class Workspace:
    root: Path
    docs_dir: Path
    config_path: Path


@dataclass(slots=True)
class Document:
    layer: str
    slug: str
    title: str
    path: Path
    relative_path: str

    @property
    def ref(self) -> str:
        return f"{self.layer}:{self.slug}"

    @property
    def updated_at(self) -> str:
        timestamp = datetime.fromtimestamp(self.path.stat().st_mtime)
        return timestamp.strftime("%Y-%m-%d %H:%M:%S")

    def to_dict(self) -> dict[str, str]:
        return {
            "layer": self.layer,
            "slug": self.slug,
            "title": self.title,
            "path": str(self.path),
            "relative_path": self.relative_path,
            "ref": self.ref,
            "updated_at": self.updated_at,
        }


def init_workspace(root: Path) -> Workspace:
    root = root.resolve()
    config_dir = root / CONFIG_DIR
    config_path = config_dir / CONFIG_FILE
    docs_dir = root / DEFAULT_DOCS_DIR

    config_dir.mkdir(parents=True, exist_ok=True)
    docs_dir.mkdir(parents=True, exist_ok=True)
    for layer in LAYERS:
        (docs_dir / layer).mkdir(parents=True, exist_ok=True)

    config = {"version": 1, "docs_dir": DEFAULT_DOCS_DIR, "layers": list(LAYERS)}
    config_path.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
    return Workspace(root=root, docs_dir=docs_dir, config_path=config_path)


def discover_workspace(start: Path | None = None) -> Workspace:
    current = (start or Path.cwd()).resolve()
    for candidate in [current, *current.parents]:
        config_path = candidate / CONFIG_DIR / CONFIG_FILE
        if config_path.exists():
            config = json.loads(config_path.read_text(encoding="utf-8"))
            docs_dir = candidate / config.get("docs_dir", DEFAULT_DOCS_DIR)
            return Workspace(root=candidate, docs_dir=docs_dir, config_path=config_path)
    raise WikiError("No wiki workspace found. Run 'wikimg init' first.")


def normalize_layer(value: str) -> str:
    key = value.strip().lower()
    try:
        return LAYER_ALIASES[key]
    except KeyError as error:
        supported = ", ".join(LAYERS)
        raise WikiError(f"Unsupported layer '{value}'. Use one of: {supported}.") from error


def slugify(value: str) -> str:
    trimmed = value.strip()
    if not trimmed:
        raise WikiError("Slug or title cannot be empty.")

    segments = []
    for raw_segment in trimmed.replace("\\", "/").split("/"):
        segment = raw_segment.strip().lower()
        segment = re.sub(r"[^\w\s-]", "", segment, flags=re.UNICODE)
        segment = re.sub(r"[-\s]+", "-", segment, flags=re.UNICODE).strip("-")
        if segment in {"", ".", ".."}:
            raise WikiError(f"Invalid slug segment '{raw_segment}'.")
        segments.append(segment)
    return "/".join(segments)


def title_from_markdown(path: Path) -> str:
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.startswith("# "):
            return line[2:].strip()
    return path.stem.replace("-", " ").replace("_", " ").title()


def scan_documents(workspace: Workspace, layer: str | None = None) -> list[Document]:
    layers = [normalize_layer(layer)] if layer else list(LAYERS)
    documents: list[Document] = []
    for item_layer in layers:
        layer_dir = workspace.docs_dir / item_layer
        if not layer_dir.exists():
            continue
        for path in sorted(layer_dir.rglob("*.md")):
            slug = path.relative_to(layer_dir).with_suffix("").as_posix()
            rel_path = path.relative_to(workspace.root).as_posix()
            documents.append(
                Document(
                    layer=item_layer,
                    slug=slug,
                    title=title_from_markdown(path),
                    path=path,
                    relative_path=rel_path,
                )
            )
    return documents


def render_rows(rows: Iterable[tuple[str, ...]]) -> str:
    rows = list(rows)
    if not rows:
        return ""
    widths = [0] * len(rows[0])
    for row in rows:
        for index, cell in enumerate(row):
            widths[index] = max(widths[index], len(cell))
    lines = []
    for row in rows:
        padded = [cell.ljust(widths[index]) for index, cell in enumerate(row)]
        lines.append("  ".join(padded).rstrip())
    return "\n".join(lines)


def resolve_document(workspace: Workspace, reference: str) -> Document:
    normalized_ref = reference.strip()
    if not normalized_ref:
        raise WikiError("Document reference cannot be empty.")

    path_candidate = Path(normalized_ref)
    if path_candidate.exists():
        absolute = path_candidate.resolve()
        return document_from_path(workspace, absolute)

    if ":" in normalized_ref:
        layer_text, slug_text = normalized_ref.split(":", 1)
        layer = normalize_layer(layer_text)
        slug = slugify(slug_text)
        path = workspace.docs_dir / layer / f"{slug}.md"
        if not path.exists():
            raise WikiError(f"Document '{normalized_ref}' does not exist.")
        return document_from_path(workspace, path)

    candidates = []
    for doc in scan_documents(workspace):
        match_values = {
            doc.ref,
            doc.slug,
            doc.relative_path,
            doc.relative_path.removesuffix(".md"),
            doc.path.name,
            doc.path.stem,
        }
        if normalized_ref in match_values:
            candidates.append(doc)

    if not candidates:
        raise WikiError(f"Document '{reference}' was not found.")
    if len(candidates) > 1:
        refs = ", ".join(doc.ref for doc in candidates)
        raise WikiError(f"Reference '{reference}' is ambiguous. Try one of: {refs}.")
    return candidates[0]


def document_from_path(workspace: Workspace, path: Path) -> Document:
    path = path.resolve()
    try:
        relative = path.relative_to(workspace.docs_dir)
    except ValueError as error:
        raise WikiError(f"Path '{path}' is outside the wiki workspace.") from error
    parts = relative.parts
    if len(parts) < 2:
        raise WikiError(f"Path '{path}' is not a valid document path.")
    layer = normalize_layer(parts[0])
    slug = Path(*parts[1:]).with_suffix("").as_posix()
    return Document(
        layer=layer,
        slug=slug,
        title=title_from_markdown(path),
        path=path,
        relative_path=path.relative_to(workspace.root).as_posix(),
    )


def create_document(
    workspace: Workspace,
    layer: str,
    title: str,
    slug: str | None = None,
) -> Document:
    normalized_layer = normalize_layer(layer)
    final_slug = slugify(slug or title)
    path = workspace.docs_dir / normalized_layer / f"{final_slug}.md"
    if path.exists():
        raise WikiError(f"Document '{normalized_layer}:{final_slug}' already exists.")

    path.parent.mkdir(parents=True, exist_ok=True)
    content = default_markdown(title)
    path.write_text(content, encoding="utf-8")
    return document_from_path(workspace, path)


def default_markdown(title: str) -> str:
    return (
        f"# {title}\n\n"
        "## Summary\n\n"
        "Write your notes here.\n"
    )


def update_markdown_title(text: str, title: str) -> str:
    lines = text.splitlines()
    for index, line in enumerate(lines):
        if line.startswith("# "):
            lines[index] = f"# {title}"
            break
    else:
        lines.insert(0, f"# {title}")
        lines.insert(1, "")
    updated = "\n".join(lines)
    if not updated.endswith("\n"):
        updated += "\n"
    return updated


def rename_document(
    workspace: Workspace,
    reference: str,
    new_title: str,
    slug: str | None = None,
) -> Document:
    document = resolve_document(workspace, reference)
    next_slug = slugify(slug or new_title)
    destination = workspace.docs_dir / document.layer / f"{next_slug}.md"
    if destination.exists() and destination.resolve() != document.path.resolve():
        raise WikiError(f"Document '{document.layer}:{next_slug}' already exists.")

    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.resolve() != document.path.resolve():
        document.path.rename(destination)
        cleanup_empty_directories(document.path.parent, workspace.docs_dir / document.layer)

    content = destination.read_text(encoding="utf-8")
    destination.write_text(update_markdown_title(content, new_title), encoding="utf-8")
    return document_from_path(workspace, destination)


def move_document(
    workspace: Workspace,
    reference: str,
    target_layer: str,
    slug: str | None = None,
) -> Document:
    document = resolve_document(workspace, reference)
    normalized_layer = normalize_layer(target_layer)
    final_slug = slugify(slug or document.slug)
    destination = workspace.docs_dir / normalized_layer / f"{final_slug}.md"
    if destination.exists():
        raise WikiError(f"Document '{normalized_layer}:{final_slug}' already exists.")

    destination.parent.mkdir(parents=True, exist_ok=True)
    source_parent = document.path.parent
    document.path.rename(destination)
    cleanup_empty_directories(source_parent, workspace.docs_dir / document.layer)
    return document_from_path(workspace, destination)


def delete_document(workspace: Workspace, reference: str) -> Document:
    document = resolve_document(workspace, reference)
    parent = document.path.parent
    document.path.unlink()
    cleanup_empty_directories(parent, workspace.docs_dir / document.layer)
    return document


def search_documents(
    workspace: Workspace,
    query: str,
    layer: str | None = None,
    content: bool = False,
) -> list[Document]:
    needle = query.strip().lower()
    if not needle:
        raise WikiError("Search query cannot be empty.")

    matches: list[Document] = []
    for document in scan_documents(workspace, layer=layer):
        haystacks = [document.title.lower(), document.slug.lower(), document.ref.lower()]
        if content:
            haystacks.append(document.path.read_text(encoding="utf-8").lower())
        if any(needle in haystack for haystack in haystacks):
            matches.append(document)
    return matches


def launch_editor(path: Path, editor: str | None = None) -> None:
    editor_cmd = editor or os.environ.get("EDITOR")
    if not editor_cmd:
        raise WikiError("No editor configured. Set $EDITOR or pass --editor.")
    command = shlex.split(editor_cmd) + [str(path)]
    result = subprocess.run(command, check=False)
    if result.returncode != 0:
        raise WikiError(f"Editor exited with status {result.returncode}.")


def doctor(workspace: Workspace) -> list[str]:
    issues: list[str] = []
    if not workspace.config_path.exists():
        issues.append("Missing workspace config file.")
    if not workspace.docs_dir.exists():
        issues.append("Missing docs directory.")

    for layer in LAYERS:
        layer_dir = workspace.docs_dir / layer
        if not layer_dir.exists():
            issues.append(f"Missing layer directory: {layer}.")
            continue
        for path in sorted(layer_dir.rglob("*")):
            if path.is_file() and path.suffix.lower() != ".md":
                rel = path.relative_to(workspace.root).as_posix()
                issues.append(f"Non-Markdown file inside wiki tree: {rel}.")
    return issues


def cleanup_empty_directories(start: Path, stop: Path) -> None:
    current = start
    while current != stop and current.exists():
        try:
            current.rmdir()
        except OSError:
            return
        current = current.parent


def read_document_text(document: Document) -> str:
    return document.path.read_text(encoding="utf-8")
