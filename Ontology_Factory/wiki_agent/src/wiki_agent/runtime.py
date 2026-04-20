from __future__ import annotations

import json
import shlex
from collections import Counter
import hashlib
from pathlib import Path
from typing import Any

from entity_relation import RelationDocument, extract_relations
from ner import NerDocument, OpenRouterClient, extract_entities
from ner.providers.hanlp_provider import HanLPNerProvider
from ontology_store import OntologyStore
from wiki_agent.models import (
    AgentTraceRecord,
    FinalCommitDecision,
    FinalCommitPayload,
    PageExecutionResult,
    ToolCallDecision,
    TopicCandidate,
)
from wiki_agent.prompts import (
    TOOL_SPECS,
    build_commit_system_prompt,
    build_commit_user_prompt,
    build_react_system_prompt,
    build_react_user_prompt,
    build_topic_system_prompt,
    build_topic_user_prompt,
)
from wiki_agent.tools import WikiAgentToolbox

_BAD_TOPIC_TITLES = {
    "if",
    "else",
    "elif",
    "define",
    "endif",
    "for",
    "while",
    "return",
    "include",
}


class WikiAgentRuntime:
    def __init__(
        self,
        *,
        store: OntologyStore,
        llm_client: OpenRouterClient | None = None,
        provider: HanLPNerProvider | None = None,
        workspace_root: str | Path | None = None,
        max_steps: int = 8,
        max_tool_calls: int = 8,
        max_repeat_action: int = 2,
    ) -> None:
        self.store = store
        self.llm_client = llm_client
        self.provider = provider or HanLPNerProvider()
        self.workspace_root = Path(workspace_root or Path.cwd()).resolve()
        self.max_steps = max_steps
        self.max_tool_calls = max_tool_calls
        self.max_repeat_action = max_repeat_action
        self.max_topics_per_document = 4

    def process_document(
        self,
        *,
        run_id: str,
        document_id: str,
        doc_name: str,
        clean_text: str,
        ner_document: NerDocument | None = None,
        relation_document: RelationDocument | None = None,
        document_path: str | Path | None = None,
        metadata_bundle: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        ner_document = ner_document or extract_entities(
            clean_text,
            doc_id=doc_name,
            use_llm=False,
            provider=self.provider,
            llm_client=None,
        )
        relation_document = relation_document or extract_relations(ner_document)
        merged_metadata = self._build_metadata_bundle(
            doc_name=doc_name,
            ner_document=ner_document,
            relation_document=relation_document,
            document_path=document_path,
            metadata_bundle=metadata_bundle,
        )
        toolbox = WikiAgentToolbox(
            store=self.store,
            document_id=document_id,
            doc_name=doc_name,
            clean_text=clean_text,
            run_id=run_id,
            provider=self.provider,
            workspace_root=self.workspace_root,
            target_folder=merged_metadata.get("document_context", {}).get("folder_path") or self.workspace_root,
            document_path=document_path,
        )
        topics, topic_plan_last_exchange = self.propose_topics(
            doc_name=doc_name,
            clean_text=clean_text,
            ner_document=ner_document,
            relation_document=relation_document,
            metadata_bundle=merged_metadata,
        )
        page_results: list[PageExecutionResult] = []
        page_llm_memory_by_page: dict[str, dict[str, Any]] = {}

        for topic in topics:
            page_result, last_exchange = self._run_topic(
                run_id=run_id,
                doc_name=doc_name,
                document_id=document_id,
                topic=topic,
                toolbox=toolbox,
                metadata_bundle=merged_metadata,
            )
            page_results.append(page_result)
            memory_record = self._build_page_llm_memory_record(
                topic=topic,
                page_result=page_result,
                last_exchange=last_exchange,
            )
            page_key = page_result.page_id or page_result.title or topic.title
            existing_record = page_llm_memory_by_page.get(page_key)
            if existing_record is None:
                page_llm_memory_by_page[page_key] = memory_record
            else:
                merged_topics = list(dict.fromkeys(existing_record.get("source_topic_titles", []) + memory_record.get("source_topic_titles", [])))
                updated_record = dict(existing_record)
                updated_record.update(memory_record)
                updated_record["source_topic_titles"] = merged_topics
                page_llm_memory_by_page[page_key] = updated_record

        successful_pages = [result for result in page_results if result.page_id and result.status != "failed"]
        self._link_document_pages(successful_pages)

        return {
            "doc_name": doc_name,
            "ner_entity_hints": merged_metadata.get("ner_entity_hints", []),
            "relation_hints": merged_metadata.get("relation_hints", []),
            "canonical_hints": merged_metadata.get("canonical_hints", []),
            "document_context": merged_metadata.get("document_context", {}),
            "topics": [topic.model_dump(mode="json") for topic in topics],
            "page_results": [result.model_dump(mode="json") for result in page_results],
            "topic_plan_last_exchange": topic_plan_last_exchange,
            "page_llm_memory": list(page_llm_memory_by_page.values()),
            "tool_summary": dict(
                Counter(
                    trace.action_name
                    for result in page_results
                    for trace in result.trace
                )
            ),
        }

    def propose_topics(
        self,
        *,
        doc_name: str,
        clean_text: str,
        ner_document: NerDocument | None = None,
        relation_document: RelationDocument | None = None,
        metadata_bundle: dict[str, Any] | None = None,
    ) -> tuple[list[TopicCandidate], dict[str, Any]]:
        ner_document = ner_document or extract_entities(
            clean_text,
            doc_id=doc_name,
            use_llm=False,
            provider=self.provider,
            llm_client=None,
        )
        relation_document = relation_document or extract_relations(ner_document)
        merged_metadata = metadata_bundle or self._build_metadata_bundle(
            doc_name=doc_name,
            ner_document=ner_document,
            relation_document=relation_document,
        )
        if self.llm_client is not None and self.llm_client.is_enabled():
            try:
                exchange = self._chat_json_with_trace(
                    phase="topic_plan",
                    system_prompt=build_topic_system_prompt(),
                    user_prompt=build_topic_user_prompt(
                        doc_name=doc_name,
                        text=clean_text,
                        ner_entities=merged_metadata.get("ner_entity_hints", []),
                        relation_hints=merged_metadata.get("relation_hints", []),
                        canonical_hints=merged_metadata.get("canonical_hints", []),
                        document_context=merged_metadata.get("document_context", {}),
                    ),
                )
                payload = exchange["parsed_json"]
                topics = []
                for item in payload.get("pages", []):
                    if not isinstance(item, dict):
                        continue
                    title = str(item.get("title", "")).strip()
                    if not title:
                        continue
                    topics.append(
                        TopicCandidate(
                            title=title,
                            page_type=_normalize_page_type(str(item.get("page_type", "topic"))),
                            reason=str(item.get("reason", "")).strip(),
                            seed_sentences=[str(value).strip() for value in item.get("seed_sentences", []) if str(value).strip()],
                        )
                    )
                topics = _dedupe_topics(topics)
                if topics:
                    return topics[: self.max_topics_per_document], exchange
            except Exception:
                pass
        return (
            self._fallback_topics(doc_name=doc_name, clean_text=clean_text, ner_document=ner_document),
            _fallback_exchange("topic_plan", "llm_disabled_or_fallback"),
        )

    def _fallback_topics(self, *, doc_name: str, clean_text: str, ner_document: NerDocument) -> list[TopicCandidate]:
        document = ner_document
        topics: list[TopicCandidate] = []
        if doc_name.strip():
            topics.append(
                TopicCandidate(
                    title=doc_name.strip(),
                    page_type=_infer_doc_page_type(doc_name),
                    reason="来自文档标题的主主题。",
                    seed_sentences=_split_sentences(clean_text)[:2],
                )
            )
        ordered_entities = sorted(
            document.entities,
            key=lambda item: (
                int(item.metadata.get("occurrence_count", 1)),
                len(item.normalized_text or item.text),
            ),
            reverse=True,
        )
        for entity in ordered_entities[:8]:
            title = entity.normalized_text or entity.text
            if _is_bad_topic_title(title):
                continue
            topics.append(
                TopicCandidate(
                    title=title,
                    page_type=_infer_entity_page_type(title, entity.label),
                    reason=f"实体抽取候选，标签为 {entity.label}。",
                    seed_sentences=[
                        sentence
                        for sentence in list(entity.metadata.get("source_sentences", []))[:2]
                        if sentence
                    ]
                    or ([entity.source_sentence] if entity.source_sentence else []),
                )
            )
        deduped = _dedupe_topics(topics)
        if deduped:
            return deduped[: self.max_topics_per_document]
        preview_sentences = _split_sentences(clean_text)[:2]
        return [
            TopicCandidate(
                title=doc_name.strip() or "未命名主题",
                page_type="topic",
                reason="无法提取稳定实体，退化为文档主题页。",
                seed_sentences=preview_sentences,
            )
        ]

    def _run_topic(
        self,
        *,
        run_id: str,
        doc_name: str,
        document_id: str,
        topic: TopicCandidate,
        toolbox: WikiAgentToolbox,
        metadata_bundle: dict[str, Any],
    ) -> tuple[PageExecutionResult, dict[str, Any]]:
        existing_document = toolbox.backend.find_by_title(topic.title)
        existing_page = None
        if existing_document is not None:
            existing_page = self.store.find_page_by_title(existing_document["title"])
            if existing_page is None:
                existing_page = self.store.create_page(
                    title=existing_document["title"],
                    slug=existing_document["slug"],
                    page_type=topic.page_type,
                    layer=existing_document["layer"],
                    doc_ref=existing_document["ref"],
                    file_path=existing_document["path"],
                )
        page_id = existing_page.page_id if existing_page is not None else ""
        history: list[dict[str, Any]] = []
        trace: list[AgentTraceRecord] = []
        repeat_counter: Counter[str] = Counter()
        tool_calls = 0
        last_exchange: dict[str, Any] = {}

        for step_index in range(1, self.max_steps + 1):
            decision, decision_exchange = self._next_decision(
                doc_name=doc_name,
                topic=topic,
                metadata_bundle=metadata_bundle,
                existing_page=self.store.read_page(page_id) if page_id else None,
                history=history,
                step_index=step_index,
            )
            if decision_exchange:
                last_exchange = decision_exchange
            if isinstance(decision, ToolCallDecision):
                repeat_counter[decision.action_name] += 1
                if repeat_counter[decision.action_name] > self.max_repeat_action:
                    break
                try:
                    observation = toolbox.execute(decision.action_name, decision.action_input)
                except Exception as exc:
                    observation = {"error": f"{type(exc).__name__}: {exc}"}
                record = AgentTraceRecord(
                    thought=decision.thought,
                    action_name=decision.action_name,
                    action_input=decision.action_input,
                    observation=observation,
                )
                self.store.record_agent_step(
                    run_id=run_id,
                    page_id=page_id,
                    thought=decision.thought,
                    action_name=decision.action_name,
                    action_input_json=decision.action_input,
                    observation_json=observation,
                )
                trace.append(record)
                history.append(record.model_dump(mode="json"))
                if decision.action_name == "create_page":
                    page = observation.get("page", {})
                    page_id = str(page.get("page_id", "") or page_id)
                elif decision.action_name == "search_pages" and not page_id:
                    matched_pages = observation.get("pages", [])
                    if matched_pages:
                        matched = matched_pages[0]
                        mirrored = self.store.find_page_by_title(str(matched.get("title", "")))
                        if mirrored is None:
                            mirrored = self.store.create_page(
                                title=str(matched.get("title", "")),
                                slug=str(matched.get("slug", "")),
                                page_type=topic.page_type,
                                layer=str(matched.get("layer", "domain")),
                                doc_ref=str(matched.get("ref", "")),
                                file_path=str(matched.get("path", "")),
                            )
                        page_id = mirrored.page_id
                tool_calls += 1
                if tool_calls >= self.max_tool_calls:
                    break
                continue

            commit_result = self._apply_final_commit(
                run_id=run_id,
                topic=topic,
                commit=decision.commit,
                document_id=document_id,
                page_id=page_id,
                toolbox=toolbox,
            )
            self.store.record_agent_step(
                run_id=run_id,
                page_id=commit_result.page_id,
                thought=decision.thought,
                action_name="final_commit",
                action_input_json=decision.commit.model_dump(mode="json"),
                observation_json={
                    "status": commit_result.status,
                    "page_id": commit_result.page_id,
                    "revision_id": commit_result.revision_id,
                },
            )
            trace.append(
                AgentTraceRecord(
                    thought=decision.thought,
                    action_name="final_commit",
                    action_input=decision.commit.model_dump(mode="json"),
                    observation={
                        "status": commit_result.status,
                        "page_id": commit_result.page_id,
                        "revision_id": commit_result.revision_id,
                    },
                )
            )
            commit_result.trace = trace
            return commit_result, last_exchange

        fallback_commit, fallback_exchange = self._generate_commit(
            topic=topic,
            history=history,
            doc_name=doc_name,
            metadata_bundle=metadata_bundle,
        )
        if fallback_exchange:
            last_exchange = fallback_exchange
        commit_result = self._apply_final_commit(
            run_id=run_id,
            topic=topic,
            commit=fallback_commit,
            document_id=document_id,
            page_id=page_id,
            toolbox=toolbox,
        )
        self.store.record_agent_step(
            run_id=run_id,
            page_id=commit_result.page_id,
            thought="达到步数或工具次数上限，使用保底提交。",
            action_name="final_commit",
            action_input_json=fallback_commit.model_dump(mode="json"),
            observation_json={
                "status": commit_result.status,
                "page_id": commit_result.page_id,
                "revision_id": commit_result.revision_id,
            },
        )
        trace.append(
            AgentTraceRecord(
                thought="达到步数或工具次数上限，使用保底提交。",
                action_name="final_commit",
                action_input=fallback_commit.model_dump(mode="json"),
                observation={
                    "status": commit_result.status,
                    "page_id": commit_result.page_id,
                    "revision_id": commit_result.revision_id,
                },
            )
        )
        commit_result.trace = trace
        return commit_result, last_exchange

    def _next_decision(
        self,
        *,
        doc_name: str,
        topic: TopicCandidate,
        metadata_bundle: dict[str, Any],
        existing_page: dict[str, Any] | None,
        history: list[dict[str, Any]],
        step_index: int,
    ) -> tuple[ToolCallDecision | FinalCommitDecision, dict[str, Any]]:
        if step_index >= self.max_steps:
            commit, exchange = self._generate_commit(
                topic=topic,
                history=history,
                doc_name=doc_name,
                metadata_bundle=metadata_bundle,
            )
            return FinalCommitDecision(
                thought="达到最大步数，直接提交。",
                commit=commit,
            ), exchange
        if step_index >= 4 and history:
            commit, exchange = self._generate_commit(
                topic=topic,
                history=history,
                doc_name=doc_name,
                metadata_bundle=metadata_bundle,
            )
            return FinalCommitDecision(
                thought="已经收集到首轮关键 observation，优先收束为可写入 revision 的页面。",
                commit=commit,
            ), exchange
        if self.llm_client is not None and self.llm_client.is_enabled():
            try:
                exchange = self._chat_json_with_trace(
                    phase="react_step",
                    system_prompt=build_react_system_prompt(),
                    user_prompt=build_react_user_prompt(
                        doc_name=doc_name,
                        topic=topic.model_dump(mode="json"),
                        ner_entities=metadata_bundle.get("ner_entity_hints", []),
                        relation_hints=metadata_bundle.get("relation_hints", []),
                        canonical_hints=metadata_bundle.get("canonical_hints", []),
                        document_context=metadata_bundle.get("document_context", {}),
                        available_tools=TOOL_SPECS,
                        history=history,
                        existing_page=existing_page,
                        step_index=step_index,
                        max_steps=self.max_steps,
                    ),
                )
                payload = exchange["parsed_json"]
                decision = _parse_decision(payload)
                if decision is not None:
                    return decision, exchange
            except Exception:
                pass
        return self._scripted_decision(
            topic=topic,
            metadata_bundle=metadata_bundle,
            existing_page=existing_page,
            history=history,
            doc_name=doc_name,
        )

    def _scripted_decision(
        self,
        *,
        topic: TopicCandidate,
        metadata_bundle: dict[str, Any],
        existing_page: dict[str, Any] | None,
        history: list[dict[str, Any]],
        doc_name: str,
    ) -> tuple[ToolCallDecision | FinalCommitDecision, dict[str, Any]]:
        actions = [str(item.get("action_name", "")) for item in history]
        document_context = metadata_bundle.get("document_context", {})
        document_path = str(document_context.get("document_path", "")).strip()
        workspace_root = shlex.quote(str(self.workspace_root))
        topic_query = shlex.quote(topic.title)
        if not any(action == "run_command" and "wikimg" in str(item.get("action_input", {}).get("command", "")) for action, item in ((str(entry.get("action_name", "")), entry) for entry in history)):
            return ToolCallDecision(
                thought="先检查是否已经存在同主题页面。",
                action_name="run_command",
                action_input={"command": f"wikimg --root {workspace_root} search {topic_query} --content"},
            ), {}
        if (
            not any(action == "run_command" and "rg -n" in str(item.get("action_input", {}).get("command", "")) for action, item in ((str(entry.get("action_name", "")), entry) for entry in history))
            and document_context.get("sibling_files")
        ):
            return ToolCallDecision(
                thought="先在当前文档所在目录里做一次只读检索，看看邻近材料里有没有相同主题。",
                action_name="run_command",
                action_input={"command": f"rg -n {shlex.quote(topic.title)} ."},
            ), {}
        if document_path and not any(action == "run_command" and "python -m ner.cli" in str(item.get("action_input", {}).get("command", "")) for action, item in ((str(entry.get("action_name", "")), entry) for entry in history)):
            return ToolCallDecision(
                thought="补一层实体线索，方便组织页面内容和关联主题。",
                action_name="run_command",
                action_input={
                    "command": f"python -m ner.cli extract --input {shlex.quote(document_path)} --query {topic_query} --max-sentences 4 --stdout"
                },
            ), {}
        if (
            document_path
            and topic.page_type in {"system", "project", "topic"}
            and not any(action == "run_command" and "python -m entity_relation.cli" in str(item.get("action_input", {}).get("command", "")) for action, item in ((str(entry.get("action_name", "")), entry) for entry in history))
        ):
            return ToolCallDecision(
                thought="系统或项目主题适合再补一层关系线索。",
                action_name="run_command",
                action_input={
                    "command": f"PYTHONPATH=/Users/qiuboyu/CodeLearning/new_fjy/fjy/Ontology_Factory/relation/src:/Users/qiuboyu/CodeLearning/new_fjy/fjy/Ontology_Factory/ner/src python -m entity_relation.cli extract --input {shlex.quote(document_path)} --query {topic_query} --max-sentences 6 --stdout"
                },
            ), {}
        if (
            existing_page is not None
            and not any(action == "run_command" and "wikimg" in str(item.get("action_input", {}).get("command", "")) and " show " in str(item.get("action_input", {}).get("command", "")) for action, item in ((str(entry.get("action_name", "")), entry) for entry in history))
        ):
            return ToolCallDecision(
                thought="已有匹配页面，先读取当前版本再决定如何修订。",
                action_name="run_command",
                action_input={
                    "command": f"wikimg --root {workspace_root} show {shlex.quote(str(existing_page.get('page', {}).get('doc_ref', '') or str(existing_page.get('page', {}).get('title', ''))))}"
                },
            ), {}
        commit, exchange = self._generate_commit(
            topic=topic,
            history=history,
            doc_name=doc_name,
            metadata_bundle=metadata_bundle,
        )
        return FinalCommitDecision(
            thought="已有足够 observation，可以直接提交页面内容。",
            commit=commit,
        ), exchange

    def _generate_commit(
        self,
        *,
        topic: TopicCandidate,
        history: list[dict[str, Any]],
        doc_name: str,
        metadata_bundle: dict[str, Any],
    ) -> tuple[FinalCommitPayload, dict[str, Any]]:
        if self.llm_client is not None and self.llm_client.is_enabled():
            try:
                exchange = self._chat_json_with_trace(
                    phase="commit",
                    system_prompt=build_commit_system_prompt(),
                    user_prompt=build_commit_user_prompt(
                        doc_name=doc_name,
                        topic=topic.model_dump(mode="json"),
                        ner_entities=metadata_bundle.get("ner_entity_hints", []),
                        relation_hints=metadata_bundle.get("relation_hints", []),
                        canonical_hints=metadata_bundle.get("canonical_hints", []),
                        document_context=metadata_bundle.get("document_context", {}),
                        history=history,
                    ),
                )
                payload = exchange["parsed_json"]
                decision = _parse_decision(payload)
                if isinstance(decision, FinalCommitDecision):
                    return decision.commit, exchange
                if isinstance(payload, dict) and "commit" in payload:
                    commit = payload.get("commit")
                    if isinstance(commit, dict):
                        return FinalCommitPayload(
                            title=str(commit.get("title", topic.title)).strip() or topic.title,
                            page_type=_normalize_page_type(str(commit.get("page_type", topic.page_type))),
                            summary=str(commit.get("summary", "")).strip(),
                            content_markdown=str(commit.get("content_markdown", "")).strip() or self._fallback_markdown(topic, history),
                            sources=[
                                {
                                    "source_sentence": str(item.get("source_sentence", "")).strip(),
                                    "evidence_text": str(item.get("evidence_text", "")).strip(),
                                }
                                for item in commit.get("sources", [])
                                if isinstance(item, dict) and str(item.get("source_sentence", "")).strip()
                            ],
                            related_pages=[str(item).strip() for item in commit.get("related_pages", []) if str(item).strip()],
                            reason=str(commit.get("reason", "")).strip(),
                        ), exchange
            except Exception:
                pass
        sources = self._collect_sources(topic, history)
        related_pages = self._collect_related_pages(topic, history)
        return FinalCommitPayload(
            title=topic.title,
            page_type=_normalize_page_type(topic.page_type),
            summary=self._build_summary(topic, history),
            content_markdown=self._fallback_markdown(topic, history),
            sources=sources,
            related_pages=related_pages,
            reason=topic.reason or "基于文档证据生成主题页。",
        ), _fallback_exchange("commit", "llm_disabled_or_fallback")

    def _apply_final_commit(
        self,
        *,
        run_id: str,
        topic: TopicCandidate,
        commit: FinalCommitPayload,
        document_id: str,
        page_id: str = "",
        toolbox: WikiAgentToolbox,
    ) -> PageExecutionResult:
        title = commit.title.strip() or topic.title
        page_type = _normalize_page_type(commit.page_type or topic.page_type)
        page = self.store.get_page(page_id) if page_id else None
        if page is None:
            page = self.store.find_page_by_title(title)
        layer = page.layer if page is not None and page.layer else toolbox.choose_layer(title, page_type)
        document = toolbox.backend.find_by_title(title, layer=layer)
        if document is None and page is not None and page.doc_ref:
            try:
                document = toolbox.backend.read_document(page.doc_ref)
            except Exception:
                document = None
        if document is None:
            document = toolbox.backend.ensure_document(
                layer=layer,
                title=title,
                slug=build_slug_for_commit(self.store, title),
            )
            status = "created"
        else:
            status = "updated"

        if page is None:
            page = self.store.create_page(
                title=title,
                slug=document["slug"],
                page_type=page_type,
                layer=document["layer"],
                doc_ref=document["ref"],
                file_path=document["path"],
            )
        else:
            self.store.sync_page_location(
                page_id=page.page_id,
                layer=document["layer"],
                doc_ref=document["ref"],
                file_path=document["path"],
            )
            page = self.store.get_page(page.page_id) or page

        human_markdown = self._render_human_markdown(
            topic=topic,
            commit=commit,
            current_ref=document["ref"],
            toolbox=toolbox,
        )
        toolbox.backend.write_document(
            document["ref"],
            content=human_markdown,
            title=title,
        )

        page, revision, update_status = self.store.update_page(
            page_id=page.page_id,
            run_id=run_id,
            content_markdown=human_markdown,
            summary=commit.summary,
            reason=commit.reason or "updated_by_wiki_agent",
            created_by="wiki_agent",
        )
        if update_status == "skipped":
            status = "skipped" if status != "created" else "created"
        elif status != "created":
            status = update_status

        for source in commit.sources[:8]:
            source_sentence = str(source.get("source_sentence", "")).strip()
            evidence_text = str(source.get("evidence_text", "")).strip() or source_sentence
            if not source_sentence:
                continue
            self.store.append_page_source(
                page_id=page.page_id,
                document_id=document_id,
                source_sentence=source_sentence,
                evidence_text=evidence_text,
            )

        return PageExecutionResult(
            title=page.title,
            page_id=page.page_id,
            layer=page.layer,
            doc_ref=page.doc_ref,
            file_path=page.file_path,
            revision_id=revision.revision_id if revision is not None else page.current_revision_id,
            status=status if status in {"created", "updated", "skipped"} else "updated",
            page_type=page.page_type,
            related_pages=[item for item in commit.related_pages if item and item != page.title],
        )

    def _build_summary(self, topic: TopicCandidate, history: list[dict[str, Any]]) -> str:
        sources = self._collect_sources(topic, history)
        if sources:
            return " ".join(item["source_sentence"] for item in sources[:2]).strip()
        if topic.seed_sentences:
            return " ".join(topic.seed_sentences[:2]).strip()
        return topic.reason or f"{topic.title} 是从工程文档中提炼出的主题页。"

    def _fallback_markdown(self, topic: TopicCandidate, history: list[dict[str, Any]]) -> str:
        summary = self._build_summary(topic, history)
        sources = self._collect_sources(topic, history)
        related_pages = self._collect_related_pages(topic, history)
        evidence_lines = [f"- {item['source_sentence']}" for item in sources[:5]] or ["- 暂无更具体证据，后续可继续补充。"]
        related_lines = [f"- {item}" for item in related_pages[:6]] or ["- 暂无明确关联主题。"]
        return (
            f"# {topic.title}\n\n"
            "## 定义与定位\n"
            f"{summary}\n\n"
            "## 证据来源\n"
            f"{chr(10).join(evidence_lines)}\n\n"
            "## 关联主题\n"
            f"{chr(10).join(related_lines)}\n"
        )

    def _render_human_markdown(
        self,
        *,
        topic: TopicCandidate,
        commit: FinalCommitPayload,
        current_ref: str,
        toolbox: WikiAgentToolbox,
    ) -> str:
        sources = commit.sources[:8]
        related_titles = [item for item in commit.related_pages if item and item != commit.title]
        related_lines: list[str] = []
        for related_title in related_titles[:8]:
            target_doc = toolbox.backend.find_by_title(related_title)
            if target_doc is not None:
                link = toolbox.backend.relative_link(current_ref, target_doc["ref"])
                related_lines.append(f"- [{related_title}]({link})")
            else:
                related_lines.append(f"- {related_title}")
        if not related_lines:
            related_lines = ["- 暂无明确关联主题。"]

        evidence_lines = []
        for item in sources:
            sentence = str(item.get("source_sentence", "")).strip()
            evidence = str(item.get("evidence_text", "")).strip() or sentence
            if sentence:
                evidence_lines.append(f"- 证据：{evidence}\n  片段：{sentence}")
        if not evidence_lines:
            evidence_lines = ["- 暂无明确证据，后续可继续补充。"]

        body = commit.content_markdown.strip()
        if body.startswith("# "):
            lines = body.splitlines()
            body = "\n".join(lines[1:]).strip()

        return (
            f"# {commit.title}\n\n"
            f"> {commit.summary.strip() or self._build_summary(topic, [])}\n\n"
            "## 定义与定位\n"
            f"{body or self._build_summary(topic, [])}\n\n"
            "## 证据来源\n"
            f"{chr(10).join(evidence_lines)}\n\n"
            "## 关联主题\n"
            f"{chr(10).join(related_lines)}\n"
        )

    def _collect_sources(self, topic: TopicCandidate, history: list[dict[str, Any]]) -> list[dict[str, str]]:
        collected: list[dict[str, str]] = []
        seen: set[str] = set()
        for item in history:
            observation = item.get("observation", {})
            sentences = observation.get("sentences", [])
            matches = observation.get("matches", [])
            for sentence in list(sentences) + list(matches):
                sentence = str(sentence).strip()
                if not sentence or sentence in seen:
                    continue
                seen.add(sentence)
                collected.append({"source_sentence": sentence, "evidence_text": sentence})
        for sentence in topic.seed_sentences:
            if sentence and sentence not in seen:
                seen.add(sentence)
                collected.append({"source_sentence": sentence, "evidence_text": sentence})
        return collected[:8]

    def _build_metadata_bundle(
        self,
        *,
        doc_name: str,
        ner_document: NerDocument,
        relation_document: RelationDocument,
        document_path: str | Path | None = None,
        metadata_bundle: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        payload = dict(metadata_bundle or {})
        payload.setdefault("ner_entity_hints", _build_ner_entity_hints(ner_document))
        payload.setdefault("relation_hints", _build_relation_hints(relation_document))
        payload.setdefault("canonical_hints", _build_canonical_hints(self.store, ner_document))
        payload.setdefault(
            "document_context",
            _build_document_context(
                doc_name=doc_name,
                document_path=document_path,
                workspace_root=self.workspace_root,
            ),
        )
        return payload

    def _chat_json_with_trace(self, *, phase: str, system_prompt: str, user_prompt: str) -> dict[str, Any]:
        if self.llm_client is None or not self.llm_client.is_enabled():
            raise RuntimeError("llm client is disabled")
        if hasattr(self.llm_client, "chat_json_with_trace"):
            trace = self.llm_client.chat_json_with_trace(
                system_prompt=system_prompt,
                user_prompt=user_prompt,
            )
            return {
                "phase": phase,
                "request": dict(trace.get("request", {})),
                "response": dict(trace.get("response", {})),
                "parsed_json": dict(trace.get("parsed", {})),
            }
        parsed = self.llm_client.chat_json(system_prompt=system_prompt, user_prompt=user_prompt)
        return {
            "phase": phase,
            "request": {
                "payload": {
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt},
                    ]
                }
            },
            "response": {
                "raw_text": json.dumps(parsed, ensure_ascii=False),
                "payload": {"parsed_only": True},
            },
            "parsed_json": dict(parsed),
        }

    def _build_page_llm_memory_record(
        self,
        *,
        topic: TopicCandidate,
        page_result: PageExecutionResult,
        last_exchange: dict[str, Any],
    ) -> dict[str, Any]:
        normalized_exchange = _normalize_exchange(
            last_exchange,
            default_phase="fallback",
            fallback_reason="no_llm_exchange_for_final_page",
        )
        return {
            "title": page_result.title,
            "page_id": page_result.page_id,
            "status": page_result.status,
            "source_topic_title": topic.title,
            "source_topic_titles": [topic.title],
            "resolved_page_title": page_result.title,
            "resolved_strategy": _infer_resolved_strategy(topic.title, page_result.title, page_result.status),
            "final_phase": str(normalized_exchange.get("phase", "")),
            "final_decision_kind": _infer_decision_kind(normalized_exchange),
            **normalized_exchange,
        }

    def _collect_related_pages(self, topic: TopicCandidate, history: list[dict[str, Any]]) -> list[str]:
        related: list[str] = []
        seen = {topic.title}
        for item in history:
            observation = item.get("observation", {})
            for entity in observation.get("entities", []):
                if not isinstance(entity, dict):
                    continue
                title = str(entity.get("normalized_text", "") or entity.get("text", "")).strip()
                if _is_bad_topic_title(title) or title in seen:
                    continue
                seen.add(title)
                related.append(title)
        return related[:6]

    def _link_document_pages(self, page_results: list[PageExecutionResult]) -> None:
        by_title = {result.title: result for result in page_results if result.page_id}
        ordered = [result for result in page_results if result.page_id]
        for index, left in enumerate(ordered):
            for right in ordered[index + 1 :]:
                self.store.link_pages(
                    source_page_id=left.page_id,
                    target_page_id=right.page_id,
                    link_type="related_to",
                    anchor_text="同文档共现",
                )
                self.store.link_pages(
                    source_page_id=right.page_id,
                    target_page_id=left.page_id,
                    link_type="related_to",
                    anchor_text="同文档共现",
                )
        for result in ordered:
            for title in result.related_pages:
                target = by_title.get(title) or self.store.find_page_by_title(title)
                if target is None or not target.page_id or target.page_id == result.page_id:
                    continue
                self.store.link_pages(
                    source_page_id=result.page_id,
                    target_page_id=target.page_id,
                    link_type="related_to",
                    anchor_text="agent 推断关联",
                )


def build_slug_for_commit(store: OntologyStore, title: str) -> str:
    base_slug = _slugify(title)
    direct = store.get_page_by_slug(base_slug)
    if direct is None:
        return base_slug
    if direct.title.strip().lower() == title.strip().lower():
        return direct.slug
    suffix = hashlib.sha1(title.encode("utf-8")).hexdigest()[:6]
    return f"{base_slug}-{suffix}"


def _slugify(title: str) -> str:
    from ontology_store import build_wiki_slug

    return build_wiki_slug(title)


def _parse_decision(payload: dict[str, Any]) -> ToolCallDecision | FinalCommitDecision | None:
    kind = str(payload.get("kind", "")).strip()
    if kind == "tool_call":
        action_name = str(payload.get("action_name", "")).strip()
        if not action_name:
            return None
        action_input = payload.get("action_input", {})
        if not isinstance(action_input, dict):
            action_input = {}
        return ToolCallDecision(
            thought=str(payload.get("thought", "")).strip(),
            action_name=action_name,
            action_input=dict(action_input),
        )
    if kind == "final_commit":
        commit = payload.get("commit", {})
        if not isinstance(commit, dict):
            return None
        content_markdown = str(commit.get("content_markdown", "")).strip()
        if not content_markdown:
            return None
        return FinalCommitDecision(
            thought=str(payload.get("thought", "")).strip(),
            commit=FinalCommitPayload(
                title=str(commit.get("title", "")).strip() or "未命名主题",
                page_type=_normalize_page_type(str(commit.get("page_type", "topic"))),
                summary=str(commit.get("summary", "")).strip(),
                content_markdown=content_markdown,
                sources=[
                    {
                        "source_sentence": str(item.get("source_sentence", "")).strip(),
                        "evidence_text": str(item.get("evidence_text", "")).strip(),
                    }
                    for item in commit.get("sources", [])
                    if isinstance(item, dict) and str(item.get("source_sentence", "")).strip()
                ],
                related_pages=[str(item).strip() for item in commit.get("related_pages", []) if str(item).strip()],
                reason=str(commit.get("reason", "")).strip(),
            ),
        )
    return None


def _dedupe_topics(topics: list[TopicCandidate]) -> list[TopicCandidate]:
    deduped: list[TopicCandidate] = []
    seen: set[str] = set()
    for topic in topics:
        key = _slugify(topic.title)
        if not key or key in seen or _is_bad_topic_title(topic.title):
            continue
        seen.add(key)
        deduped.append(
            TopicCandidate(
                title=topic.title.strip(),
                page_type=_normalize_page_type(topic.page_type),
                reason=topic.reason,
                seed_sentences=[sentence for sentence in topic.seed_sentences if sentence][:3],
            )
        )
    return deduped


def _infer_doc_page_type(doc_name: str) -> str:
    if "系统" in doc_name:
        return "system"
    if any(keyword in doc_name for keyword in ("项目", "阶段", "旅程", "方案")):
        return "project"
    return "topic"


def _infer_entity_page_type(title: str, label: str) -> str:
    if "系统" in title:
        return "system"
    if label.upper() == "TECH":
        return "entity"
    if any(keyword in title for keyword in ("方案", "架构", "流程")):
        return "concept"
    return "topic"


def _normalize_page_type(value: str) -> str:
    allowed = {"entity", "concept", "project", "system", "topic"}
    return value if value in allowed else "topic"


def _is_bad_topic_title(title: str) -> bool:
    normalized = title.strip()
    if not normalized:
        return True
    lowered = normalized.lower()
    if lowered in _BAD_TOPIC_TITLES:
        return True
    if len(normalized) <= 1:
        return True
    if normalized.isdigit():
        return True
    return False


def _build_ner_entity_hints(document: NerDocument) -> list[dict[str, Any]]:
    ranked = sorted(
        document.entities,
        key=lambda item: (
            int(item.metadata.get("occurrence_count", 1)),
            len(item.normalized_text or item.text),
        ),
        reverse=True,
    )
    hints: list[dict[str, Any]] = []
    for entity in ranked[:20]:
        hints.append(
            {
                "text": entity.text,
                "normalized_text": entity.normalized_text,
                "label": entity.label,
                "occurrence_count": int(entity.metadata.get("occurrence_count", 1)),
                "source_sentence": entity.source_sentence,
            }
        )
    return hints


def _build_relation_hints(document: RelationDocument) -> list[dict[str, Any]]:
    ranked = sorted(
        document.relations,
        key=lambda item: (float(item.confidence), len(item.evidence_sentence or "")),
        reverse=True,
    )
    hints: list[dict[str, Any]] = []
    for relation in ranked[:20]:
        hints.append(
            {
                "source_text": relation.source_text,
                "target_text": relation.target_text,
                "relation_type": relation.relation_type,
                "confidence": relation.confidence,
                "evidence_sentence": relation.evidence_sentence,
            }
        )
    return hints


def _build_canonical_hints(store: OntologyStore, document: NerDocument) -> list[dict[str, Any]]:
    matched = store.match_canonical_entities(document.entities)
    grouped: dict[str, dict[str, Any]] = {}
    for entity in document.entities:
        canonical = matched.get(entity.entity_id)
        if canonical is None:
            continue
        classification = store.get_current_classification(canonical.canonical_id)
        payload = grouped.setdefault(
            canonical.canonical_id,
            {
                "canonical_id": canonical.canonical_id,
                "preferred_name": canonical.preferred_name,
                "normalized_text": canonical.normalized_text,
                "ner_label": canonical.ner_label,
                "mention_count": canonical.mention_count,
                "current_classification": classification.ontology_label if classification is not None else "",
                "matched_entities": [],
            },
        )
        payload["matched_entities"].append(entity.normalized_text or entity.text)
    return list(grouped.values())[:20]


def _build_document_context(
    *,
    doc_name: str,
    document_path: str | Path | None,
    workspace_root: str | Path,
) -> dict[str, Any]:
    workspace = Path(workspace_root).resolve()
    context = {
        "doc_name": doc_name,
        "document_path": "",
        "folder_path": str(workspace),
        "workspace_root": str(workspace),
        "sibling_files": [],
    }
    if document_path is None:
        return context
    path = Path(document_path).resolve()
    folder = path.parent
    sibling_files: list[str] = []
    try:
        candidates = sorted(item for item in folder.iterdir() if item.is_file())
    except OSError:
        candidates = []
    for item in candidates[:20]:
        sibling_files.append(item.name)
    context.update(
        {
            "document_path": str(path),
            "folder_path": str(folder),
            "sibling_files": sibling_files,
        }
    )
    return context


def _fallback_exchange(phase: str, fallback_reason: str) -> dict[str, Any]:
    return {
        "phase": phase,
        "request": {},
        "response": {},
        "parsed_json": {},
        "fallback_reason": fallback_reason,
    }


def _normalize_exchange(
    exchange: dict[str, Any] | None,
    *,
    default_phase: str,
    fallback_reason: str,
) -> dict[str, Any]:
    if not exchange:
        return _fallback_exchange(default_phase, fallback_reason)
    normalized = {
        "phase": str(exchange.get("phase", default_phase)),
        "request": dict(exchange.get("request", {})),
        "response": dict(exchange.get("response", {})),
        "parsed_json": dict(exchange.get("parsed_json", {})),
    }
    if "fallback_reason" in exchange:
        normalized["fallback_reason"] = str(exchange.get("fallback_reason", ""))
    return normalized


def _infer_resolved_strategy(source_topic_title: str, resolved_page_title: str, status: str) -> str:
    if status == "created":
        return "created_new_page"
    if resolved_page_title != source_topic_title:
        return "merged_into_existing_page"
    if status == "updated":
        return "updated_existing_page"
    if status == "skipped":
        return "reused_existing_page"
    return "unknown"


def _infer_decision_kind(exchange: dict[str, Any]) -> str:
    parsed = dict(exchange.get("parsed_json", {}))
    kind = str(parsed.get("kind", "")).strip()
    if kind:
        return kind
    if parsed.get("commit"):
        return "final_commit"
    if exchange.get("fallback_reason"):
        return "fallback"
    return ""


def _split_sentences(text: str) -> list[str]:
    import re

    return [piece.strip() for piece in re.split(r"(?<=[。！？；\n])", text) if piece.strip()]
