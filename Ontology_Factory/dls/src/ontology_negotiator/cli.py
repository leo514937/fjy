from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from ontology_negotiator import GraphInput, OntologyNegotiator


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="OntologyNegotiator CLI.")
    subparsers = parser.add_subparsers(dest="command")

    classify_parser = subparsers.add_parser("classify", help="Classify a graph input.")
    classify_parser.add_argument("--graph", required=True, help="GraphInput JSON path.")
    classify_parser.add_argument("--config", default="", help="Optional ontology negotiator config path.")
    classify_parser.add_argument("--artifact-root", default="", help="Optional artifact output root.")
    classify_parser.add_argument("--node-id", default="", help="Optional node id for single-node classification.")
    classify_parser.add_argument("--max-concurrency", type=int, default=1, help="Graph classify concurrency.")
    classify_parser.add_argument("--output", default="", help="Optional output JSON path.")
    classify_parser.add_argument("--stdout", action="store_true", help="Print JSON to stdout.")
    args = parser.parse_args(argv)

    if args.command != "classify":
        parser.error("only the 'classify' command is supported")

    graph = json.loads(Path(args.graph).read_text(encoding="utf-8"))
    graph_model = GraphInput.model_validate(graph)
    negotiator = OntologyNegotiator(
        config_path=args.config or None,
        artifact_root=args.artifact_root or None,
    )
    if args.node_id.strip():
        result, _ = negotiator.classify_node(args.node_id.strip(), graph_model)
        payload: dict[str, Any] = {"mode": "node", "result": result.model_dump(mode="json")}
    else:
        results = negotiator.classify_graph(graph_model, max_concurrency=max(1, int(args.max_concurrency)))
        payload = {"mode": "graph", "results": [item.model_dump(mode="json") for item in results]}

    rendered = json.dumps(payload, ensure_ascii=False, indent=2)
    if args.output:
        output_path = Path(args.output)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(rendered, encoding="utf-8")
    if args.stdout or not args.output:
        print(rendered)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
