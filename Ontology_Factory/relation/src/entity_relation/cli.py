from __future__ import annotations

import argparse
import re
from pathlib import Path

from entity_relation.extractor import extract_relations
from ner.extractor import extract_entities


_SENTENCE_SPLIT_RE = re.compile(r"(?<=[。！？；\n])")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="关系提取命令行工具。 "
        "从原始文本中提取实体间的语义关系，并返回包含主体、客体及关系类型的结构化 JSON 结果。"
    )
    subparsers = parser.add_subparsers(dest="command")

    extract_parser = subparsers.add_parser(
        "extract",
        help="对文件执行关系提取。返回符合 RelationDocument 架构的 JSON 对象。"
    )
    extract_parser.add_argument("--input", required=True, help="输入待处理的纯文本文件路径。")
    extract_parser.add_argument("--output", default="", help="可选：将提取结果保存为 JSON 文件的路径。")
    extract_parser.add_argument("--stdout", action="store_true", help="显式打印 JSON 结果到标准输出。")
    extract_parser.add_argument("--doc-id", default="", help="可选：文档标识符；默认使用输入文件名称。")
    extract_parser.add_argument("--query", default="", help="如果提供，则仅从包含此关键词的句子中提取关系。")
    extract_parser.add_argument("--max-sentences", type=int, default=8, help="启用 --query 时使用的最大上下文句子数量。")
    args = parser.parse_args()

    if args.command not in {"extract", None}:
        parser.error(f"unsupported command: {args.command}")

    input_path = Path(args.input)
    text = input_path.read_text(encoding="utf-8")
    if args.query.strip():
        text = _slice_text_by_query(text, args.query.strip(), max_sentences=max(1, int(args.max_sentences)))
    doc_id = args.doc_id or input_path.stem
    ner_document = extract_entities(text, doc_id=doc_id, use_llm=False, llm_client=None)
    relation_document = extract_relations(ner_document)
    rendered = relation_document.model_dump_json(indent=2)
    if args.output:
        output_path = Path(args.output)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(rendered, encoding="utf-8")
    if args.stdout or not args.output:
        print(rendered)
    return 0


def _slice_text_by_query(text: str, query: str, *, max_sentences: int) -> str:
    sentences = [piece.strip() for piece in _SENTENCE_SPLIT_RE.split(text) if piece.strip()]
    direct = [sentence for sentence in sentences if query in sentence]
    if not direct:
        lowered = query.lower()
        direct = [sentence for sentence in sentences if lowered in sentence.lower()]
    return "\n".join(direct[:max_sentences]) or text


if __name__ == "__main__":
    raise SystemExit(main())
