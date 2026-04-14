from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from ontology_store import OntologyStore, normalize_alias


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="本体存储查询 (Storage) 命令行工具。 "
        "从本地 SQLite 数据库中搜索并检索实体、关系和分类。 "
        "返回统一的 JSON 格式结果。"
    )
    subparsers = parser.add_subparsers(dest="command")

    query_parser = subparsers.add_parser(
        "query",
        help="对存储执行搜索查询。返回包含结果项和总数的 JSON。"
    )
    query_parser.add_argument("--database", required=True, help="SQLite 数据库文件 (.sqlite3) 的路径。")
    query_parser.add_argument(
        "--kind",
        required=True,
        choices=["pages", "entities", "relations", "classifications"],
        help="要查询的具体存储类型：'pages' (原始 wiki 页面), 'entities' (规范实体), "
             "'relations' (语义关系), 或 'classifications' (本体标签)。",
    )
    query_parser.add_argument("--query", default="", help="用于过滤结果的模糊搜索文本。")
    query_parser.add_argument("--limit", type=int, default=10, help="要返回的最大结果项数量。")
    query_parser.add_argument("--output", default="", help="可选：将查询结果保存为 JSON 文件的路径。")
    query_parser.add_argument("--stdout", action="store_true", help="在标准输出中显式打印生成的 JSON。")
    args = parser.parse_args(argv)

    if args.command != "query":
        parser.error("only the 'query' command is supported")

    store = OntologyStore(args.database)
    payload = query_store(store, kind=args.kind, query=args.query, limit=max(1, int(args.limit)))
    rendered = json.dumps(payload, ensure_ascii=False, indent=2)
    if args.output:
        output_path = Path(args.output)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(rendered, encoding="utf-8")
    if args.stdout or not args.output:
        print(rendered)
    return 0


def query_store(store: OntologyStore, *, kind: str, query: str, limit: int) -> dict[str, Any]:
    query = query.strip()
    if kind == "pages":
        pages = store.search_pages(query, limit=limit) if query else store.list_pages()[:limit]
        return {"kind": kind, "count": len(pages), "items": [page.model_dump(mode="json") for page in pages]}

    entities = store.list_canonical_entities()
    filtered_entities = _filter_entities(store, entities, query=query, limit=limit)

    if kind == "entities":
        return {
            "kind": kind,
            "count": len(filtered_entities),
            "items": [
                {
                    "entity": entity.model_dump(mode="json"),
                    "classification": (
                        store.get_current_classification(entity.canonical_id).model_dump(mode="json")
                        if store.get_current_classification(entity.canonical_id) is not None
                        else None
                    ),
                }
                for entity in filtered_entities
            ],
        }

    if kind == "classifications":
        items: list[dict[str, Any]] = []
        for entity in filtered_entities:
            classification = store.get_current_classification(entity.canonical_id)
            if classification is None:
                continue
            items.append(
                {
                    "entity": entity.model_dump(mode="json"),
                    "classification": classification.model_dump(mode="json"),
                }
            )
        return {"kind": kind, "count": len(items), "items": items[:limit]}

    if kind == "relations":
        entity_map = {entity.canonical_id: entity for entity in entities}
        relation_items: list[tuple[float, dict[str, Any]]] = []
        seen: set[str] = set()
        for entity in filtered_entities or entities:
            for relation in store.list_neighbor_relations(entity.canonical_id):
                if relation.canonical_relation_id in seen:
                    continue
                seen.add(relation.canonical_relation_id)
                source_name = entity_map.get(relation.source_canonical_id).preferred_name if entity_map.get(relation.source_canonical_id) else relation.source_canonical_id
                target_name = entity_map.get(relation.target_canonical_id).preferred_name if entity_map.get(relation.target_canonical_id) else relation.target_canonical_id
                haystack = " ".join([relation.relation_type, source_name, target_name]).lower()
                score = _similarity(query.lower(), haystack) if query else 1.0
                if query and score <= 0.0 and query.lower() not in haystack:
                    continue
                relation_items.append(
                    (
                        score,
                        {
                            "relation": relation.model_dump(mode="json"),
                            "source_name": source_name,
                            "target_name": target_name,
                        },
                    )
                )
        ranked = [item for _, item in sorted(relation_items, key=lambda pair: pair[0], reverse=True)[:limit]]
        return {"kind": kind, "count": len(ranked), "items": ranked}

    raise ValueError(f"unsupported kind: {kind}")


def _filter_entities(store: OntologyStore, entities: list[Any], *, query: str, limit: int) -> list[Any]:
    if not query:
        return entities[:limit]
    scored: list[tuple[float, Any]] = []
    normalized = normalize_alias(query)
    for entity in entities:
        classification = store.get_current_classification(entity.canonical_id)
        label = classification.ontology_label if classification is not None else ""
        haystack = " ".join([entity.preferred_name, entity.normalized_text, entity.ner_label, label]).lower()
        score = max(
            _similarity(normalized, normalize_alias(entity.preferred_name)),
            _similarity(normalized, normalize_alias(entity.normalized_text)),
        )
        if normalized in haystack or score > 0.0:
            scored.append((score if score > 0 else 0.5, entity))
    ranked = sorted(scored, key=lambda pair: (pair[0], pair[1].mention_count), reverse=True)
    return [entity for _, entity in ranked[:limit]]


def _similarity(left: str, right: str) -> float:
    if not left or not right:
        return 0.0
    if left == right:
        return 1.0
    if left in right or right in left:
        return min(len(left), len(right)) / max(len(left), len(right))
    matches = sum(1 for a, b in zip(left, right) if a == b)
    return matches / max(len(left), len(right))


if __name__ == "__main__":
    raise SystemExit(main())
