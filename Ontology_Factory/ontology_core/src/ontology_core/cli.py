from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from ontology_store import OntologyStore, normalize_alias


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Ontology canonical search CLI.")
    subparsers = parser.add_subparsers(dest="command")

    search_parser = subparsers.add_parser("search", help="Search canonical ontology entities.")
    search_parser.add_argument("--database", required=True, help="SQLite database path.")
    search_parser.add_argument("--query", required=True, help="Entity query text.")
    search_parser.add_argument("--limit", type=int, default=5, help="Maximum number of entities.")
    search_parser.add_argument("--include-mentions", action="store_true", help="Include entity mentions.")
    search_parser.add_argument("--include-relations", action="store_true", help="Include neighbor relations.")
    search_parser.add_argument("--output", default="", help="Optional output JSON path.")
    search_parser.add_argument("--stdout", action="store_true", help="Print JSON to stdout.")
    args = parser.parse_args(argv)

    if args.command != "search":
        parser.error("only the 'search' command is supported")

    store = OntologyStore(args.database)
    payload = search_canonical_entities(
        store,
        query=args.query,
        limit=max(1, int(args.limit)),
        include_mentions=bool(args.include_mentions),
        include_relations=bool(args.include_relations),
    )
    rendered = json.dumps(payload, ensure_ascii=False, indent=2)
    if args.output:
        output_path = Path(args.output)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(rendered, encoding="utf-8")
    if args.stdout or not args.output:
        print(rendered)
    return 0


def search_canonical_entities(
    store: OntologyStore,
    *,
    query: str,
    limit: int,
    include_mentions: bool = False,
    include_relations: bool = False,
) -> dict[str, Any]:
    normalized = normalize_alias(query)
    candidates: list[tuple[float, Any]] = []
    for entity in store.list_canonical_entities():
        score = max(
            _similarity(normalized, normalize_alias(entity.preferred_name)),
            _similarity(normalized, normalize_alias(entity.normalized_text)),
        )
        if normalized in normalize_alias(entity.preferred_name) or normalized in normalize_alias(entity.normalized_text) or score > 0.0:
            candidates.append((score if score > 0 else 0.5, entity))
    ranked = [entity for _, entity in sorted(candidates, key=lambda pair: (pair[0], pair[1].mention_count), reverse=True)[:limit]]

    items: list[dict[str, Any]] = []
    for entity in ranked:
        classification = store.get_current_classification(entity.canonical_id)
        item: dict[str, Any] = {
            "entity": entity.model_dump(mode="json"),
            "classification": classification.model_dump(mode="json") if classification is not None else None,
        }
        if include_mentions:
            item["mentions"] = store.list_entity_mentions(entity.canonical_id)
        if include_relations:
            item["relations"] = [relation.model_dump(mode="json") for relation in store.list_neighbor_relations(entity.canonical_id)]
        items.append(item)
    return {"query": query, "count": len(items), "items": items}


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
