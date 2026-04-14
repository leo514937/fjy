from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from wikimg.core import (
    Document,
    Workspace,
    WikiError,
    document_from_path,
    read_document_text,
    resolve_document,
    scan_documents,
)

_LINK_RE = re.compile(r"\[([^\]]+)\]\(([^)]+)\)")
_FRONTMATTER_BOUNDARY = re.compile(r"^\s*---\s*$")
_ORDERED_LIST_RE = re.compile(r"^\s*(\d+)\.\s+(.*)$")
_UNORDERED_LIST_RE = re.compile(r"^\s*[-*+]\s+(.*)$")
_CHECKLIST_RE = re.compile(r"^\s*[-*+]\s+\[( |x|X)\]\s+(.*)$")
_HEADING_RE = re.compile(r"^(#{3,6})\s+(.*)$")
_TABLE_SEPARATOR_RE = re.compile(r"^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$")
_INLINE_TOKEN_RE = re.compile(r"\[([^\]]+)\]\(([^)]+)\)|`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*|_([^_]+)_")


@dataclass(slots=True)
class ProfileIssue:
    code: str
    message: str
    ref: str

    def to_dict(self) -> dict[str, str]:
        return {
            "code": self.code,
            "message": self.message,
            "ref": self.ref,
        }


def show_document_json(workspace: Workspace, reference: str) -> dict[str, Any]:
    document = resolve_document(workspace, reference)
    return parse_document(workspace, document)


def export_profile(workspace: Workspace, profile: str) -> dict[str, Any]:
    normalized = profile.strip().lower()
    if normalized != "kimi":
        raise WikiError(f"Unsupported export profile '{profile}'.")

    documents = collect_profile_documents(workspace, normalized)
    entities = [item for item in documents if item["page_kind"] != "meta"]
    entity_ids = {item["ref"]: item["kimiwa"]["id"] for item in entities if item.get("kimiwa")}
    cross_references: list[dict[str, str]] = []
    seen_edges: set[tuple[str, str, str, str]] = set()

    for item in entities:
        source_id = item["kimiwa"]["id"]
        for relation in item["relations"]:
            target_ref = str(relation.get("target_ref") or "")
            target_id = entity_ids.get(target_ref)
            if not target_id or target_id == source_id:
                continue
            key = (
                source_id,
                target_id,
                str(relation.get("relation") or "相关"),
                str(relation.get("description") or ""),
            )
            if key in seen_edges:
                continue
            seen_edges.add(key)
            cross_references.append(
                {
                    "source": source_id,
                    "target": target_id,
                    "relation": key[2],
                    "description": key[3],
                }
            )

    domains = sorted(
        {
            str(item["kimiwa"].get("domain") or "")
            for item in entities
            if str(item["kimiwa"].get("domain") or "").strip()
        }
    )
    levels = sorted(
        {
            int(item["kimiwa"]["level"])
            for item in entities
            if isinstance(item["kimiwa"].get("level"), int)
        }
    )
    sources = sorted(
        {
            str(item["kimiwa"].get("source") or "")
            for item in entities
            if str(item["kimiwa"].get("source") or "").strip()
        }
    )
    layers = sorted(
        {
            str(item["kimiwa"].get("layer") or "")
            for item in entities
            if str(item["kimiwa"].get("layer") or "").strip()
        },
        key=_layer_sort_key,
    )
    layer_counts = {
        layer: sum(1 for item in entities if str(item["kimiwa"].get("layer") or "") == layer)
        for layer in layers
    }

    knowledge_graph = {
        "metadata": {
            "title": "WiKiMG Kimi Knowledge Graph",
            "version": "1",
            "description": "Exported from WiKiMG profile documents.",
        },
        "statistics": {
            "total_entities": len(entities),
            "total_relations": len(cross_references),
            "domains": domains,
            "levels": levels,
            "sources": sources,
            "layers": layers,
            "layer_counts": layer_counts,
        },
        "entity_index": {
            item["kimiwa"]["id"]: item["kimiwa"]
            for item in entities
            if item.get("kimiwa")
        },
        "cross_references": cross_references,
    }

    return {
        "status": "ok",
        "profile": normalized,
        "metadata": knowledge_graph["metadata"],
        "knowledgeGraph": knowledge_graph,
        "documents": documents,
    }


def validate_profile(workspace: Workspace, profile: str) -> dict[str, Any]:
    normalized = profile.strip().lower()
    if normalized != "kimi":
        raise WikiError(f"Unsupported validation profile '{profile}'.")

    documents = collect_profile_documents(workspace, normalized)
    issues: list[ProfileIssue] = []

    if not documents:
        issues.append(ProfileIssue(code="missing-profile-documents", message="No profile documents found.", ref="*"))

    refs = {item["ref"] for item in documents}
    for item in documents:
        required_fields = [
            ("profile", item.get("profile"), False),
            ("title", item.get("title"), False),
            ("type", item["frontmatter"].get("type") or item.get("kimiwa", {}).get("type"), False),
            ("domain", item["frontmatter"].get("domain") or item.get("kimiwa", {}).get("domain"), False),
            (
                "level",
                item["frontmatter"].get("level") if "level" in item["frontmatter"] else item.get("kimiwa", {}).get("level"),
                False,
            ),
            ("source", item["frontmatter"].get("source") or item.get("kimiwa", {}).get("source"), False),
            ("properties", item.get("properties"), True),
            ("relations", item.get("relations"), True),
        ]
        for field, value, allow_empty_container in required_fields:
            if _is_missing_value(value, allow_empty_container=allow_empty_container):
                issues.append(
                    ProfileIssue(
                        code="missing-required-field",
                        message=f"Missing required field '{field}'.",
                        ref=item["ref"],
                    )
                )

        if not item["sections"].get("定义与定位"):
            issues.append(
                ProfileIssue(
                    code="missing-definition-section",
                    message="Missing '定义与定位' section.",
                    ref=item["ref"],
                )
            )

        for relation in item["relations"]:
            target_ref = str(relation.get("target_ref") or "")
            if not target_ref:
                issues.append(
                    ProfileIssue(
                        code="bad-relation-target",
                        message=f"Relation target '{relation.get('target') or ''}' cannot be resolved.",
                        ref=item["ref"],
                    )
                )
                continue
            if target_ref not in refs:
                issues.append(
                    ProfileIssue(
                        code="target-outside-profile",
                        message=f"Relation target '{target_ref}' is outside the active profile.",
                        ref=item["ref"],
                    )
                )

        for link in item["links"]:
            href = str(link.get("href") or "")
            if _is_external_link(href):
                continue
            resolved_ref = str(link.get("target_ref") or "")
            if href and not resolved_ref:
                issues.append(
                    ProfileIssue(
                        code="bad-markdown-link",
                        message=f"Markdown link '{href}' cannot be resolved.",
                        ref=item["ref"],
                    )
                )

    return {
        "status": "ok",
        "profile": normalized,
        "healthy": not issues,
        "document_count": len(documents),
        "issues": [item.to_dict() for item in issues],
    }


def collect_profile_documents(workspace: Workspace, profile: str) -> list[dict[str, Any]]:
    items = []
    for document in scan_documents(workspace):
        parsed = parse_document(workspace, document)
        if str(parsed.get("profile") or "").strip().lower() == profile:
            items.append(parsed)
    return items


def parse_document(workspace: Workspace, document: Document) -> dict[str, Any]:
    content_markdown = read_document_text(document)
    frontmatter, body_markdown = split_frontmatter(content_markdown)
    sections = parse_sections(body_markdown)
    formatted_sections = format_sections(workspace, document, sections)
    links = extract_links(workspace, document, body_markdown)
    summary = extract_summary(body_markdown)
    properties = normalize_properties(frontmatter.get("properties"), sections.get("属性", ""))
    relations = normalize_relations(workspace, document, frontmatter.get("relations"), links)
    evidence = extract_list_items(sections.get("证据来源", ""))
    definition = first_non_empty(
        stringify(frontmatter.get("definition")),
        sections.get("定义与定位", ""),
        summary,
        document.title,
    )
    page_kind = str(frontmatter.get("page_kind") or frontmatter.get("kind") or "entity").strip().lower()
    kimi_payload = None
    if str(frontmatter.get("profile") or "").strip().lower() == "kimi":
        kimi_payload = {
            "id": str(frontmatter.get("id") or document.ref),
            "name": str(frontmatter.get("title") or document.title),
            "type": str(frontmatter.get("type") or "未分类主题"),
            "domain": str(frontmatter.get("domain") or document.layer),
            "layer": document.layer,
            "level": coerce_int(frontmatter.get("level")),
            "source": str(frontmatter.get("source") or document.ref),
            "definition": definition,
            "properties": properties,
            "page_kind": page_kind,
            "ref": document.ref,
            "summary": summary,
            "evidence": evidence,
            "formatted_sections": formatted_sections,
        }

    return {
        **document.to_dict(),
        "profile": str(frontmatter.get("profile") or "").strip().lower() or None,
        "page_kind": page_kind,
        "frontmatter": frontmatter,
        "content_markdown": content_markdown,
        "body_markdown": body_markdown,
        "summary": summary,
        "definition": definition,
        "sections": sections,
        "formatted_sections": formatted_sections,
        "properties": properties,
        "relations": relations,
        "links": links,
        "evidence": evidence,
        "meta_role": str(frontmatter.get("meta_role") or "").strip().lower() or None,
        "about_payload": frontmatter.get("about_payload"),
        "education_payload": frontmatter.get("education_payload"),
        "editor_payload": frontmatter.get("editor_payload"),
        "kimiwa": kimi_payload,
    }


def split_frontmatter(text: str) -> tuple[dict[str, Any], str]:
    lines = text.splitlines(keepends=True)
    if not lines or not _FRONTMATTER_BOUNDARY.match(lines[0]):
        return {}, text

    for index in range(1, len(lines)):
        if _FRONTMATTER_BOUNDARY.match(lines[index]):
            raw_frontmatter = "".join(lines[1:index])
            body = "".join(lines[index + 1 :])
            return parse_frontmatter(raw_frontmatter), body
    return {}, text


def parse_frontmatter(raw_frontmatter: str) -> dict[str, Any]:
    text = raw_frontmatter.strip()
    if not text:
        return {}

    try:
        import yaml  # type: ignore
    except Exception:
        yaml = None

    if yaml is not None:
        try:
            parsed = yaml.safe_load(text)
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            pass

    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict):
            return parsed
    except json.JSONDecodeError:
        pass

    payload: dict[str, Any] = {}
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if ":" not in stripped:
            raise WikiError("Unsupported frontmatter format. Use JSON or simple key: value pairs.")
        key, value = stripped.split(":", 1)
        payload[key.strip()] = coerce_scalar(value.strip())
    return payload


def parse_sections(markdown: str) -> dict[str, str]:
    sections: dict[str, list[str]] = {}
    current = "__body__"
    sections[current] = []

    for line in markdown.splitlines():
        if line.startswith("## "):
            current = line[3:].strip()
            sections.setdefault(current, [])
            continue
        sections.setdefault(current, []).append(line)

    rendered: dict[str, str] = {}
    for heading, lines in sections.items():
        rendered[heading] = "\n".join(lines).strip()
    return rendered


def format_sections(workspace: Workspace, document: Document, sections: dict[str, str]) -> list[dict[str, Any]]:
    formatted = []
    for heading, text in sections.items():
        if heading == "__body__" and not text.strip():
            continue
        if heading != "__body__" and not text.strip():
            continue
        formatted.append(
            {
                "title": "" if heading == "__body__" else heading,
                "blocks": format_markdown_blocks(workspace, document, text),
            }
        )
    return formatted


def format_markdown_blocks(workspace: Workspace, document: Document, markdown: str) -> list[dict[str, Any]]:
    lines = markdown.splitlines()
    blocks: list[dict[str, Any]] = []
    paragraph_lines: list[str] = []
    index = 0

    def flush_paragraph() -> None:
        if not paragraph_lines:
            return
        text = " ".join(line.strip() for line in paragraph_lines if line.strip()).strip()
        paragraph_lines.clear()
        if not text:
            return
        blocks.append(
            {
                "type": "paragraph",
                "text": text,
                "tokens": parse_inline_tokens(workspace, document, text),
            }
        )

    while index < len(lines):
        line = lines[index]
        stripped = line.strip()

        if not stripped:
            flush_paragraph()
            index += 1
            continue

        if stripped.startswith("```"):
            flush_paragraph()
            language = stripped[3:].strip()
            code_lines: list[str] = []
            index += 1
            while index < len(lines) and not lines[index].strip().startswith("```"):
                code_lines.append(lines[index])
                index += 1
            if index < len(lines):
                index += 1
            blocks.append(
                {
                    "type": "code",
                    "language": language or None,
                    "text": "\n".join(code_lines).rstrip(),
                }
            )
            continue

        heading_match = _HEADING_RE.match(stripped)
        if heading_match:
            flush_paragraph()
            heading_text = heading_match.group(2).strip()
            blocks.append(
                {
                    "type": "heading",
                    "level": len(heading_match.group(1)),
                    "text": heading_text,
                    "tokens": parse_inline_tokens(workspace, document, heading_text),
                }
            )
            index += 1
            continue

        if stripped.startswith(">"):
            flush_paragraph()
            quote_lines: list[str] = []
            while index < len(lines) and lines[index].strip().startswith(">"):
                quote_lines.append(lines[index].strip()[1:].lstrip())
                index += 1
            blocks.append(format_quote_block(workspace, document, quote_lines))
            continue

        if _looks_like_table(lines, index):
            flush_paragraph()
            table_lines = [lines[index], lines[index + 1]]
            index += 2
            while index < len(lines) and "|" in lines[index]:
                if not lines[index].strip():
                    break
                table_lines.append(lines[index])
                index += 1
            table_block = format_table_block(workspace, document, table_lines)
            if table_block:
                blocks.append(table_block)
                continue

        checklist_match = _CHECKLIST_RE.match(line)
        if checklist_match:
            flush_paragraph()
            items: list[dict[str, Any]] = []
            while index < len(lines):
                match = _CHECKLIST_RE.match(lines[index])
                if not match:
                    break
                text = match.group(2).strip()
                items.append(
                    {
                        "text": text,
                        "checked": match.group(1).lower() == "x",
                        "tokens": parse_inline_tokens(workspace, document, text),
                    }
                )
                index += 1
            blocks.append({"type": "checklist", "items": items})
            continue

        ordered_match = _ORDERED_LIST_RE.match(line)
        if ordered_match:
            flush_paragraph()
            items: list[dict[str, Any]] = []
            while index < len(lines):
                match = _ORDERED_LIST_RE.match(lines[index])
                if not match:
                    break
                text = match.group(2).strip()
                items.append(
                    {
                        "text": text,
                        "tokens": parse_inline_tokens(workspace, document, text),
                    }
                )
                index += 1
            blocks.append({"type": "ordered_list", "items": items})
            continue

        unordered_match = _UNORDERED_LIST_RE.match(line)
        if unordered_match:
            flush_paragraph()
            items: list[dict[str, Any]] = []
            while index < len(lines):
                match = _UNORDERED_LIST_RE.match(lines[index])
                if not match or _CHECKLIST_RE.match(lines[index]):
                    break
                text = match.group(1).strip()
                items.append(
                    {
                        "text": text,
                        "tokens": parse_inline_tokens(workspace, document, text),
                    }
                )
                index += 1
            blocks.append({"type": "list", "items": items})
            continue

        paragraph_lines.append(line)
        index += 1

    flush_paragraph()
    return blocks


def extract_summary(markdown: str) -> str:
    for line in markdown.splitlines():
        stripped = line.strip()
        if stripped.startswith(">"):
            return stripped.lstrip(">").strip()

    body = parse_sections(markdown).get("__body__", "")
    paragraphs = [chunk.strip() for chunk in body.split("\n\n") if chunk.strip()]
    for paragraph in paragraphs:
        if paragraph.startswith("# "):
            continue
        return paragraph
    return ""


def parse_inline_tokens(workspace: Workspace, document: Document, text: str) -> list[dict[str, Any]]:
    if not text:
        return []

    tokens: list[dict[str, Any]] = []
    cursor = 0
    for match in _INLINE_TOKEN_RE.finditer(text):
        start, end = match.span()
        if start > cursor:
            tokens.append({"type": "text", "text": text[cursor:start]})

        if match.group(1) is not None:
            href = match.group(2)
            resolved = resolve_link_target(workspace, document, href)
            tokens.append(
                {
                    "type": "link",
                    "text": match.group(1),
                    "href": href,
                    "target_ref": resolved.ref if resolved is not None else "",
                    "external": _is_external_link(href),
                }
            )
        elif match.group(3) is not None:
            tokens.append({"type": "code", "text": match.group(3)})
        elif match.group(4) is not None:
            tokens.append({"type": "strong", "text": match.group(4)})
        elif match.group(5) is not None:
            tokens.append({"type": "emphasis", "text": match.group(5)})
        elif match.group(6) is not None:
            tokens.append({"type": "emphasis", "text": match.group(6)})

        cursor = end

    if cursor < len(text):
        tokens.append({"type": "text", "text": text[cursor:]})

    return [token for token in tokens if token.get("text") is not None and str(token.get("text") or "") != ""]


def format_quote_block(workspace: Workspace, document: Document, quote_lines: list[str]) -> dict[str, Any]:
    if not quote_lines:
        return {"type": "quote", "text": "", "tokens": []}

    first_line = quote_lines[0].strip()
    callout_match = re.match(r"^\[!([A-Z]+)\]\s*(.*)$", first_line)
    if callout_match:
        tone = callout_match.group(1).strip().lower()
        title = callout_match.group(2).strip()
        body = "\n".join(line for line in quote_lines[1:] if line.strip()).strip()
        text = body or title
        return {
            "type": "callout",
            "tone": tone,
            "title": title or tone.upper(),
            "text": text,
            "tokens": parse_inline_tokens(workspace, document, text),
        }

    text = "\n".join(line for line in quote_lines if line.strip()).strip()
    return {
        "type": "quote",
        "text": text,
        "tokens": parse_inline_tokens(workspace, document, text),
    }


def _looks_like_table(lines: list[str], index: int) -> bool:
    if index + 1 >= len(lines):
        return False
    if "|" not in lines[index]:
        return False
    return bool(_TABLE_SEPARATOR_RE.match(lines[index + 1].strip()))


def format_table_block(workspace: Workspace, document: Document, table_lines: list[str]) -> dict[str, Any] | None:
    if len(table_lines) < 2:
        return None

    header_cells = parse_table_row(workspace, document, table_lines[0])
    rows = [
        parse_table_row(workspace, document, line)
        for line in table_lines[2:]
        if line.strip()
    ]
    return {
        "type": "table",
        "header": header_cells,
        "rows": rows,
    }


def parse_table_row(workspace: Workspace, document: Document, line: str) -> list[dict[str, Any]]:
    raw_cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
    return [
        {
            "text": cell,
            "tokens": parse_inline_tokens(workspace, document, cell),
        }
        for cell in raw_cells
    ]


def normalize_properties(raw_properties: Any, section_text: str) -> dict[str, Any]:
    if isinstance(raw_properties, dict):
        return raw_properties
    if isinstance(raw_properties, list):
        return {"items": raw_properties}
    if isinstance(raw_properties, str) and raw_properties.strip():
        return {"summary": raw_properties.strip()}

    parsed: dict[str, Any] = {}
    for line in section_text.splitlines():
        stripped = line.strip().lstrip("-").strip()
        if not stripped or ":" not in stripped:
            continue
        key, value = stripped.split(":", 1)
        parsed[key.strip()] = value.strip()
    if parsed:
        return parsed
    if section_text.strip():
        return {"summary": section_text.strip()}
    return {}


def normalize_relations(
    workspace: Workspace,
    document: Document,
    raw_relations: Any,
    links: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    relations: list[dict[str, Any]] = []
    seen: set[tuple[str, str, str]] = set()
    covered_targets: set[str] = set()

    explicit_relations = raw_relations if isinstance(raw_relations, list) else []
    for item in explicit_relations:
        relation = relation_from_input(workspace, document, item, source="frontmatter")
        key = relation_key(relation)
        if key not in seen:
            relations.append(relation)
            seen.add(key)
            if relation.get("target_ref"):
                covered_targets.add(str(relation["target_ref"]))

    for link in links:
        target_ref = str(link.get("target_ref") or "")
        if not target_ref or target_ref in covered_targets:
            continue
        relation = {
            "target": str(link.get("href") or ""),
            "target_ref": target_ref,
            "relation": "关联",
            "description": str(link.get("text") or "Markdown 关联"),
            "source": "markdown",
        }
        key = relation_key(relation)
        if key not in seen:
            relations.append(relation)
            seen.add(key)

    return relations


def relation_from_input(
    workspace: Workspace,
    document: Document,
    value: Any,
    *,
    source: str,
) -> dict[str, Any]:
    if isinstance(value, str):
        target = value
        relation = "相关"
        description = ""
    elif isinstance(value, dict):
        target = str(value.get("target") or value.get("href") or value.get("ref") or "")
        relation = str(value.get("type") or value.get("relation") or "相关")
        description = str(value.get("description") or "")
    else:
        target = ""
        relation = "相关"
        description = ""

    target_ref = ""
    resolved = resolve_link_target(workspace, document, target)
    if resolved is not None:
        target_ref = resolved.ref

    return {
        "target": target,
        "target_ref": target_ref,
        "relation": relation or "相关",
        "description": description,
        "source": source,
    }


def extract_links(workspace: Workspace, document: Document, markdown: str) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for text, href in _LINK_RE.findall(markdown):
        resolved = resolve_link_target(workspace, document, href)
        results.append(
            {
                "text": text,
                "href": href,
                "target_ref": resolved.ref if resolved is not None else "",
                "target_path": str(resolved.path) if resolved is not None else "",
            }
        )
    return results


def resolve_link_target(workspace: Workspace, document: Document, href: str) -> Document | None:
    cleaned = href.strip()
    if not cleaned or _is_external_link(cleaned):
        return None

    cleaned = cleaned.split("#", 1)[0].strip()
    if not cleaned:
        return None

    try:
        if ":" in cleaned and not cleaned.startswith(("./", "../")):
            return resolve_document(workspace, cleaned)
    except WikiError:
        return None

    candidates = [
        (document.path.parent / cleaned).resolve(),
        (workspace.root / cleaned).resolve(),
        (workspace.docs_dir / cleaned).resolve(),
    ]
    for candidate in list(candidates):
        if candidate.suffix != ".md":
            candidates.append(candidate.with_suffix(".md"))

    for candidate in candidates:
        if candidate.exists():
            try:
                return document_from_path(workspace, candidate)
            except WikiError:
                continue
    return None


def extract_list_items(text: str) -> list[str]:
    items = []
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("- "):
            items.append(stripped[2:].strip())
    if items:
        return items
    return [paragraph.strip() for paragraph in text.split("\n\n") if paragraph.strip()]


def relation_key(relation: dict[str, Any]) -> tuple[str, str, str]:
    return (
        str(relation.get("target_ref") or relation.get("target") or ""),
        str(relation.get("relation") or "相关"),
        str(relation.get("description") or ""),
    )


def coerce_scalar(value: str) -> Any:
    lowered = value.lower()
    if lowered in {"true", "false"}:
        return lowered == "true"
    if lowered in {"null", "none"}:
        return None
    if re.fullmatch(r"-?\d+", value):
        return int(value)
    if (value.startswith("[") and value.endswith("]")) or (value.startswith("{") and value.endswith("}")):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return value
    return value


def coerce_int(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str) and re.fullmatch(r"-?\d+", value.strip()):
        return int(value.strip())
    return None


def stringify(value: Any) -> str:
    if isinstance(value, str):
        return value.strip()
    if value is None:
        return ""
    return str(value).strip()


def first_non_empty(*values: str) -> str:
    for value in values:
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _is_missing_value(value: Any, *, allow_empty_container: bool = False) -> bool:
    if value is None:
        return True
    if isinstance(value, str):
        return not value.strip()
    if isinstance(value, (list, tuple, set, dict)):
        if allow_empty_container:
            return False
        return len(value) == 0
    return False


def _is_external_link(href: str) -> bool:
    lowered = href.lower()
    return lowered.startswith(("http://", "https://", "mailto:", "tel:")) or href.startswith("#")


def _layer_sort_key(layer: str) -> tuple[int, str]:
    order = {
        "common": 0,
        "domain": 1,
        "private": 2,
    }
    return (order.get(layer, len(order)), layer)
