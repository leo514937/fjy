from __future__ import annotations

import json
from typing import Any


def build_topic_system_prompt() -> str:
    return (
        "你是工业知识百科策划助手。"
        "你需要从清洗后的工程文档中提炼适合建立 Wiki 主题页的页面候选。"
        "页面优先是主题页，而不是整篇文档页。"
        '只返回 JSON 对象，格式为 {"pages": [{"title": "...", "page_type": "entity|concept|project|system|topic", '
        '"reason": "...", "seed_sentences": ["..."]}]}。'
    )


def build_topic_user_prompt(
    *,
    doc_name: str,
    text: str,
    ner_entities: list[dict[str, Any]] | None = None,
    relation_hints: list[dict[str, Any]] | None = None,
    canonical_hints: list[dict[str, Any]] | None = None,
    document_context: dict[str, Any] | None = None,
) -> str:
    return json.dumps(
        {
            "doc_name": doc_name,
            "text_preview": text[:5000],
            "pre_extracted_entities": ner_entities or [],
            "pre_extracted_relations": relation_hints or [],
            "canonical_hints": canonical_hints or [],
            "document_context": document_context or {},
            "requirements": {
                "max_pages": 6,
                "page_types": ["entity", "concept", "project", "system", "topic"],
                "prefer_theme_pages": True,
            },
        },
        ensure_ascii=False,
    )


def build_react_system_prompt() -> str:
    return (
        "你是工业知识 Wiki 维护 agent。"
        "你在 ReAct 循环中工作，每一步只能输出一个 JSON 对象。"
        '可输出两类：'
        '1) tool_call: {"kind":"tool_call","thought":"...","action_name":"run_command","action_input":{"command":"..."}}；'
        '2) final_commit: {"kind":"final_commit","thought":"...","commit":{'
        '"title":"...","page_type":"entity|concept|project|system|topic","summary":"...",'
        '"content_markdown":"...","sources":[{"source_sentence":"...","evidence_text":"..."}],'
        '"related_pages":["..."],"reason":"..."}}。'
        "如果信息已足够，请直接输出 final_commit。"
        "你只有一个工具：run_command。"
        "所有探索、检索、抽取、Wiki 查询都必须通过命令行完成。"
        "不要输出 Markdown 代码块，不要输出多余说明。"
    )


def build_react_user_prompt(
    *,
    doc_name: str,
    topic: dict[str, Any],
    ner_entities: list[dict[str, Any]],
    relation_hints: list[dict[str, Any]] | None = None,
    canonical_hints: list[dict[str, Any]] | None = None,
    document_context: dict[str, Any] | None = None,
    available_tools: list[dict[str, Any]],
    history: list[dict[str, Any]],
    existing_page: dict[str, Any] | None,
    step_index: int,
    max_steps: int,
) -> str:
    return json.dumps(
        {
            "doc_name": doc_name,
            "topic": topic,
            "pre_extracted_entities": ner_entities,
            "pre_extracted_relations": relation_hints or [],
            "canonical_hints": canonical_hints or [],
            "document_context": document_context or {},
            "step_index": step_index,
            "max_steps": max_steps,
            "existing_page": existing_page,
            "available_tools": available_tools,
            "history": history,
            "instructions": {
                "prefer_existing_page_when_match": True,
                "must_use_revision_write": True,
                "avoid_duplicate_titles": True,
            },
        },
        ensure_ascii=False,
    )


def build_commit_system_prompt() -> str:
    return (
        "你是工业知识 Wiki 成文助手。"
        "基于已有 observation 生成一个可直接写入 Wiki 的 final_commit JSON。"
        "必须输出 JSON 对象，格式与 ReAct 的 final_commit 完全一致。"
        "内容要保守，不要编造文档中没有的事实。"
    )


def build_commit_user_prompt(
    *,
    doc_name: str,
    topic: dict[str, Any],
    ner_entities: list[dict[str, Any]],
    relation_hints: list[dict[str, Any]] | None = None,
    canonical_hints: list[dict[str, Any]] | None = None,
    document_context: dict[str, Any] | None = None,
    history: list[dict[str, Any]],
) -> str:
    return json.dumps(
        {
            "doc_name": doc_name,
            "topic": topic,
            "pre_extracted_entities": ner_entities,
            "pre_extracted_relations": relation_hints or [],
            "canonical_hints": canonical_hints or [],
            "document_context": document_context or {},
            "history": history,
            "requirements": {
                "sections": ["概述", "证据", "关联主题"],
                "page_types": ["entity", "concept", "project", "system", "topic"],
            },
        },
        ensure_ascii=False,
    )


TOOL_SPECS: list[dict[str, Any]] = [
    {
        "name": "run_command",
        "description": (
            "在当前目标文档目录中执行命令行。"
            "支持只读检索命令，以及 Wiki、NER、relation、storage、ontology、dls、"
            "pipeline、mm_denoise、xiaogugit、AFT 等 CLI 能力。"
            "所有 CLI 都支持先用 `--help` 读取帮助。"
            "可用示例：`pwd`、`ls`、`rg -n 关键词 .`、`cat 文件名`、"
            "`wikimg --help`、`wikimg --root 工作区 search 关键词 --content`、"
            "`python -m ner.cli extract --help`、"
            "`PYTHONPATH=/Users/qiuboyu/CodeLearning/new_fjy/fjy/Ontology_Factory/relation/src:/Users/qiuboyu/CodeLearning/new_fjy/fjy/Ontology_Factory/ner/src python -m entity_relation.cli extract --input 文件 --query 关键词 --stdout`、"
            "`python -m ontology_store.cli query --database storage/data/classification_store.sqlite3 --kind entities --query 关键词 --stdout`、"
            "`python -m ontology_core.cli search --database storage/data/classification_store.sqlite3 --query 关键词 --include-relations --stdout`、"
            "`python -m ontology_negotiator.cli classify --graph graph.json --config dls/config/ontology_negotiator.toml --stdout`、"
            "`python -m pipeline.cli --input 文件 --preprocess-config preprocess.yaml`、"
            "`python -m mm_denoise.cli --config preprocess/mm_denoise/config.yaml --input 文件`、"
            "`python -m xiaogugit --root-dir xiaogugit/storage project list`、"
            "`python -m ontology_audit_hub.review_cli github --request-file review.json`、"
            "`python -m ontology_audit_hub.qa_cli answer --question \"Explain Payment\" --session-id qa-1`。"
        ),
        "input_schema": {"command": "str"},
    },
]
