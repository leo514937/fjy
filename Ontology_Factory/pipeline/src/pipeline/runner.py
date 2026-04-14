from __future__ import annotations

import hashlib
import json
import multiprocessing
import queue
from collections import Counter
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field

from pipeline.adapters import canonical_entity_to_graph
from pipeline.bootstrap import ensure_local_imports, workspace_root
from pipeline.config import PipelineConfig, load_pipeline_config

ensure_local_imports()

from entity_relation import extract_relations
from evolution import build_canonical_entity_payload, build_classification_change_events, build_classification_tasks
from ner import OpenRouterClient, OpenRouterConfig, extract_entities
from ner.providers.hanlp_provider import HanLPNerProvider
from ontology_core import reconcile_document
from ontology_store import OntologyStore
from wiki_agent import WikiAgentRuntime


class OntologyRunResult(BaseModel):
    run_id: str
    version_id: str = ""
    processed_documents: list[str] = Field(default_factory=list)
    skipped_documents: list[str] = Field(default_factory=list)
    store_path: str
    graph_json_path: str = ""
    graph_graphml_path: str = ""
    report_path: str


class BatchPipelineResult(OntologyRunResult):
    input_dir: str
    glob_pattern: str


class WikiRunResult(BaseModel):
    run_id: str
    processed_documents: list[str] = Field(default_factory=list)
    skipped_documents: list[str] = Field(default_factory=list)
    created_pages: list[str] = Field(default_factory=list)
    updated_pages: list[str] = Field(default_factory=list)
    store_path: str
    report_path: str
    page_manifest_path: str = ""
    agent_trace_path: str = ""


class WikiBatchResult(WikiRunResult):
    input_dir: str
    glob_pattern: str


PipelineResult = OntologyRunResult


def run_wiki_pipeline(
    input_path: str,
    *,
    preprocess_config: str | None = None,
    pipeline_config: str | None = None,
    force_reingest: bool = False,
) -> WikiRunResult:
    input_file = Path(input_path).resolve()
    return _run_wiki_documents(
        input_files=[input_file],
        mode="single",
        input_root=str(input_file),
        preprocess_config=preprocess_config,
        pipeline_config=pipeline_config,
        force_reingest=force_reingest,
    )


def run_wiki_batch(
    input_dir: str,
    *,
    glob: str = "*.txt",
    preprocess_config: str | None = None,
    pipeline_config: str | None = None,
    force_reingest: bool = False,
) -> WikiBatchResult:
    input_root = Path(input_dir).resolve()
    input_files = sorted(path.resolve() for path in input_root.glob(glob) if path.is_file())
    result = _run_wiki_documents(
        input_files=input_files,
        mode="batch",
        input_root=str(input_root),
        preprocess_config=preprocess_config,
        pipeline_config=pipeline_config,
        force_reingest=force_reingest,
    )
    return WikiBatchResult(
        **result.model_dump(),
        input_dir=str(input_root),
        glob_pattern=glob,
    )


def run_pipeline(
    input_path: str,
    *,
    preprocess_config: str | None = None,
    pipeline_config: str | None = None,
    force_reingest: bool = False,
) -> OntologyRunResult:
    input_file = Path(input_path).resolve()
    return _run_documents(
        input_files=[input_file],
        mode="single",
        input_root=str(input_file),
        preprocess_config=preprocess_config,
        pipeline_config=pipeline_config,
        force_reingest=force_reingest,
    )


def run_batch_pipeline(
    input_dir: str,
    *,
    glob: str = "*.txt",
    preprocess_config: str | None = None,
    pipeline_config: str | None = None,
    force_reingest: bool = False,
) -> BatchPipelineResult:
    input_root = Path(input_dir).resolve()
    input_files = sorted(path.resolve() for path in input_root.glob(glob) if path.is_file())
    result = _run_documents(
        input_files=input_files,
        mode="batch",
        input_root=str(input_root),
        preprocess_config=preprocess_config,
        pipeline_config=pipeline_config,
        force_reingest=force_reingest,
    )
    return BatchPipelineResult(
        **result.model_dump(),
        input_dir=str(input_root),
        glob_pattern=glob,
    )


def _run_wiki_documents(
    *,
    input_files: list[Path],
    mode: str,
    input_root: str,
    preprocess_config: str | None,
    pipeline_config: str | None,
    force_reingest: bool,
) -> WikiRunResult:
    config = load_pipeline_config(pipeline_config)
    resolved_preprocess_config = preprocess_config or config.preprocess.config_path
    store = OntologyStore(config.storage.database_path)
    run = store.start_wiki_run(
        mode=mode,
        input_root=input_root,
        manifest={"input_files": [str(path) for path in input_files]},
    )
    run_dir = Path(config.output.root_dir).expanduser().resolve() / "runs" / run.run_id
    docs_dir = run_dir / "documents"
    docs_dir.mkdir(parents=True, exist_ok=True)

    llm_client = OpenRouterClient(OpenRouterConfig.from_mapping(config.llm))
    provider = HanLPNerProvider(model_name=config.ner.model_name)
    runtime = WikiAgentRuntime(
        store=store,
        llm_client=llm_client,
        provider=provider,
        workspace_root=workspace_root(),
        max_steps=8,
        max_tool_calls=8,
        max_repeat_action=2,
    )

    processed_documents: list[str] = []
    skipped_documents: list[str] = []
    created_pages: list[str] = []
    updated_pages: list[str] = []
    skipped_pages: list[str] = []
    failed_pages: list[str] = []
    document_reports: list[dict[str, Any]] = []
    page_manifest: list[dict[str, Any]] = []
    tool_summary: Counter[str] = Counter()

    for input_file in input_files:
        content_hash = _hash_file(input_file)
        existing_document = store.find_document_by_content_hash(content_hash)
        if existing_document is not None and not force_reingest:
            skipped_documents.append(str(input_file))
            document_reports.append(
                {
                    "input_path": str(input_file),
                    "reason": "duplicate_content_hash",
                    "document_id": existing_document.document_id,
                }
            )
            continue

        doc_id = input_file.stem
        doc_artifact_dir = docs_dir / _artifact_name_for_input(input_file, content_hash)
        doc_artifact_dir.mkdir(parents=True, exist_ok=True)
        clean_text, preprocess_report = _run_preprocess_step(
            input_path=str(input_file),
            preprocess_config=resolved_preprocess_config,
        )
        clean_text_path = doc_artifact_dir / "clean_text.txt"
        clean_text_path.write_text(clean_text, encoding="utf-8")
        document_record = store.record_document(
            source_path=str(input_file),
            doc_name=doc_id,
            content_hash=content_hash,
            clean_text_path=str(clean_text_path),
            run_id=run.run_id,
            report_json=preprocess_report,
        )

        if not clean_text.strip():
            skipped_documents.append(str(input_file))
            document_reports.append(
                {
                    "input_path": str(input_file),
                    "document_id": document_record.document_id,
                    "reason": "empty_clean_text",
                    "clean_text_path": str(clean_text_path),
                }
            )
            continue

        ner_document = extract_entities(
            clean_text,
            doc_id=doc_id,
            use_llm=config.ner.use_llm,
            provider=provider,
            llm_client=llm_client,
        )
        entities_path = doc_artifact_dir / "entities.json"
        entities_path.write_text(ner_document.model_dump_json(indent=2), encoding="utf-8")
        relation_document = extract_relations(ner_document)
        relations_path = doc_artifact_dir / "relations.json"
        relations_path.write_text(relation_document.model_dump_json(indent=2), encoding="utf-8")

        wiki_result = runtime.process_document(
            run_id=run.run_id,
            document_id=document_record.document_id,
            doc_name=doc_id,
            clean_text=clean_text,
            ner_document=ner_document,
            relation_document=relation_document,
            document_path=str(input_file),
        )
        processed_documents.append(str(input_file))
        tool_summary.update(wiki_result.get("tool_summary", {}))

        doc_page_results = list(wiki_result.get("page_results", []))
        llm_memory = {
            "topic_plan_last_exchange": wiki_result.get("topic_plan_last_exchange", {}),
            "page_llm_memory": wiki_result.get("page_llm_memory", []),
        }
        llm_memory_path = doc_artifact_dir / "llm_memory.json"
        llm_memory_path.write_text(
            json.dumps(llm_memory, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        for item in doc_page_results:
            page_manifest.append(
                {
                    "document_id": document_record.document_id,
                    "doc_name": doc_id,
                    **item,
                }
            )
            title = str(item.get("title", ""))
            status = str(item.get("status", ""))
            if status == "created":
                created_pages.append(title)
            elif status == "updated":
                updated_pages.append(title)
            elif status == "skipped":
                skipped_pages.append(title)
            elif status == "failed":
                failed_pages.append(title)

        doc_report = {
            "input_path": str(input_file),
            "document_id": document_record.document_id,
            "clean_text_path": str(clean_text_path),
            "entities_path": str(entities_path),
            "entities_count": len(ner_document.entities),
            "relations_path": str(relations_path),
            "relations_count": len(relation_document.relations),
            "topics": wiki_result.get("topics", []),
            "ner_entity_hints": wiki_result.get("ner_entity_hints", []),
            "relation_hints": wiki_result.get("relation_hints", []),
            "canonical_hints": wiki_result.get("canonical_hints", []),
            "document_context": wiki_result.get("document_context", {}),
            "llm_memory_path": str(llm_memory_path),
            "page_results": doc_page_results,
            "tool_summary": wiki_result.get("tool_summary", {}),
        }
        document_reports.append(doc_report)
        (doc_artifact_dir / "wiki_document.json").write_text(
            json.dumps(doc_report, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    agent_steps = [step.model_dump(mode="json") for step in store.list_wiki_agent_steps(run.run_id)]
    page_manifest_path = run_dir / "page_manifest.json"
    agent_trace_path = run_dir / "agent_trace.json"
    report_path = run_dir / "run_report.json"
    page_manifest_path.write_text(json.dumps(page_manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    agent_trace_path.write_text(json.dumps(agent_steps, ensure_ascii=False, indent=2), encoding="utf-8")

    report = {
        "run_id": run.run_id,
        "mode": mode,
        "input_root": input_root,
        "documents_total": len(input_files),
        "documents_processed": len(processed_documents),
        "documents_skipped": len(skipped_documents),
        "processed_documents": processed_documents,
        "skipped_documents": skipped_documents,
        "created_pages": created_pages,
        "updated_pages": updated_pages,
        "skipped_pages": skipped_pages,
        "failed_pages": failed_pages,
        "document_reports": document_reports,
        "tool_call_summary": dict(tool_summary),
        "page_manifest_path": str(page_manifest_path),
        "agent_trace_path": str(agent_trace_path),
    }
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    store.complete_wiki_run(run_id=run.run_id, status="completed", manifest=report)
    return WikiRunResult(
        run_id=run.run_id,
        processed_documents=processed_documents,
        skipped_documents=skipped_documents,
        created_pages=created_pages,
        updated_pages=updated_pages,
        store_path=str(Path(config.storage.database_path).resolve()),
        report_path=str(report_path),
        page_manifest_path=str(page_manifest_path),
        agent_trace_path=str(agent_trace_path),
    )


def _run_documents(
    *,
    input_files: list[Path],
    mode: str,
    input_root: str,
    preprocess_config: str | None,
    pipeline_config: str | None,
    force_reingest: bool,
) -> OntologyRunResult:
    config = load_pipeline_config(pipeline_config)
    resolved_preprocess_config = preprocess_config or config.preprocess.config_path
    store = OntologyStore(config.storage.database_path)
    run = store.ingest_document_run(
        mode=mode,
        input_root=input_root,
        preprocess_config=resolved_preprocess_config,
        pipeline_config=pipeline_config or "",
        force_reingest=force_reingest,
        manifest={"input_files": [str(path) for path in input_files]},
    )
    run_dir = Path(config.output.root_dir).expanduser().resolve() / "runs" / run.run_id
    docs_dir = run_dir / "documents"
    exports_dir = run_dir / "exports"
    docs_dir.mkdir(parents=True, exist_ok=True)
    exports_dir.mkdir(parents=True, exist_ok=True)

    llm_client = OpenRouterClient(OpenRouterConfig.from_mapping(config.llm))
    provider = HanLPNerProvider(model_name=config.ner.model_name)

    processed_documents: list[str] = []
    skipped_documents: list[str] = []
    skipped_details: list[dict[str, Any]] = []
    document_reports: list[dict[str, Any]] = []
    reconciliation_reports: list[dict[str, Any]] = []
    affected_canonical_ids: set[str] = set()
    changed_relation_ids: set[str] = set()
    run_change_events = []

    for input_file in input_files:
        content_hash = _hash_file(input_file)
        existing_document = store.find_document_by_content_hash(content_hash)
        if existing_document is not None and not force_reingest:
            skipped_documents.append(str(input_file))
            skipped_details.append(
                {
                    "input_path": str(input_file),
                    "reason": "duplicate_content_hash",
                    "document_id": existing_document.document_id,
                }
            )
            continue

        doc_id = input_file.stem
        doc_artifact_dir = docs_dir / _artifact_name_for_input(input_file, content_hash)
        doc_artifact_dir.mkdir(parents=True, exist_ok=True)
        clean_text, preprocess_report = _run_preprocess_step(
            input_path=str(input_file),
            preprocess_config=resolved_preprocess_config,
        )
        clean_text_path = doc_artifact_dir / "clean_text.txt"
        clean_text_path.write_text(clean_text, encoding="utf-8")
        document_record = store.record_document(
            source_path=str(input_file),
            doc_name=doc_id,
            content_hash=content_hash,
            clean_text_path=str(clean_text_path),
            run_id=run.run_id,
            report_json=preprocess_report,
        )

        if not clean_text.strip():
            skipped_documents.append(str(input_file))
            skipped_details.append({"input_path": str(input_file), "reason": "empty_clean_text"})
            document_reports.append(
                {
                    "input_path": str(input_file),
                    "document_id": document_record.document_id,
                    "clean_text_path": str(clean_text_path),
                    "entities_count": 0,
                    "relations_count": 0,
                    "reason": "empty_clean_text",
                }
            )
            continue

        ner_document = extract_entities(
            clean_text,
            doc_id=doc_id,
            use_llm=config.ner.use_llm,
            provider=provider,
            llm_client=llm_client,
        )
        entities_path = doc_artifact_dir / "entities.json"
        entities_path.write_text(ner_document.model_dump_json(indent=2), encoding="utf-8")
        if not ner_document.entities:
            skipped_documents.append(str(input_file))
            skipped_details.append({"input_path": str(input_file), "reason": "no_entities"})
            document_reports.append(
                {
                    "input_path": str(input_file),
                    "document_id": document_record.document_id,
                    "clean_text_path": str(clean_text_path),
                    "entities_path": str(entities_path),
                    "entities_count": 0,
                    "relations_count": 0,
                    "reason": "no_entities",
                }
            )
            continue

        relation_document = extract_relations(ner_document)
        relations_path = doc_artifact_dir / "relations.json"
        relations_path.write_text(relation_document.model_dump_json(indent=2), encoding="utf-8")

        store.persist_entity_mentions(
            document_id=document_record.document_id,
            doc_id=doc_id,
            entities=ner_document.entities,
        )
        relation_payloads = [relation.model_dump(mode="json") for relation in relation_document.relations]
        store.persist_relation_mentions(
            document_id=document_record.document_id,
            doc_id=doc_id,
            relations=relation_payloads,
        )

        reconciliation = reconcile_document(
            run_id=run.run_id,
            document_id=document_record.document_id,
            ner_document=ner_document,
            relation_document=relation_document,
            store=store,
            llm_client=llm_client if config.ner.use_llm else None,
        )
        reconciliation_path = doc_artifact_dir / "reconciliation.json"
        reconciliation_path.write_text(reconciliation.model_dump_json(indent=2), encoding="utf-8")

        affected_canonical_ids.update(reconciliation.affected_canonical_entity_ids)
        changed_relation_ids.update(reconciliation.changed_canonical_relation_ids)
        run_change_events.extend(reconciliation.change_events)
        reconciliation_reports.append(reconciliation.model_dump(mode="json"))
        processed_documents.append(str(input_file))
        document_reports.append(
            {
                "input_path": str(input_file),
                "document_id": document_record.document_id,
                "clean_text_path": str(clean_text_path),
                "entities_path": str(entities_path),
                "relations_path": str(relations_path),
                "reconciliation_path": str(reconciliation_path),
                "entities_count": len(ner_document.entities),
                "relations_count": len(relation_document.relations),
                "affected_canonical_entity_ids": reconciliation.affected_canonical_entity_ids,
            }
        )

    classification_tasks, scheduling_events = build_classification_tasks(
        run_id=run.run_id,
        store=store,
        candidate_canonical_ids=sorted(affected_canonical_ids),
    )
    run_change_events.extend(scheduling_events)
    selected_tasks, deferred_tasks = _select_classification_tasks(
        store=store,
        tasks=classification_tasks,
        max_entities=config.output.max_entities_for_classification,
    )
    persisted_results: dict[str, dict[str, Any]] = {}
    classification_reports: list[dict[str, Any]] = []
    for task in selected_tasks:
        entity, neighbors, relation_payloads, mentions = build_canonical_entity_payload(store, task.canonical_id)
        graph = canonical_entity_to_graph(
            entity,
            neighbors=neighbors,
            relations=relation_payloads,
            mentions=mentions,
        )
        graph_path = docs_dir / f"{entity.canonical_id}_graph_input.json"
        graph_path.write_text(
            json.dumps(graph.model_dump(mode="json"), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        results = _classify_graph(graph=graph, config=config, artifact_dir=run_dir)
        result = _pick_result_for_canonical(entity.canonical_id, results)
        if result is None:
            classification_reports.append(
                {
                    "canonical_id": entity.canonical_id,
                    "status": "no_result_or_timeout",
                    "graph_input_path": str(graph_path),
                }
            )
            continue
        result["node_id"] = entity.canonical_id
        result["info_name"] = entity.preferred_name
        store.save_entity_classification(
            run_id=run.run_id,
            canonical_id=entity.canonical_id,
            result=result,
            evidence_signature=task.evidence_signature,
            source_reason=task.source_reason,
        )
        persisted_results[entity.canonical_id] = result
        classification_reports.append(
            {
                "canonical_id": entity.canonical_id,
                "ontology_label": result.get("ontology_label", ""),
                "confidence": result.get("confidence", 0.0),
                "graph_input_path": str(graph_path),
                "source_reason": task.source_reason,
            }
        )
    run_change_events.extend(
        build_classification_change_events(
            run_id=run.run_id,
            classification_tasks=selected_tasks,
            persisted_results=persisted_results,
        )
    )

    graph_json_path = ""
    graph_graphml_path = ""
    version_id = ""
    version_manifest: dict[str, Any] = {}
    if processed_documents and (affected_canonical_ids or changed_relation_ids):
        version_manifest = {
            "run_id": run.run_id,
            "processed_documents": processed_documents,
            "skipped_documents": skipped_documents,
            "reclassified_canonical_entities": sorted(persisted_results.keys()),
            "affected_canonical_entities": sorted(affected_canonical_ids),
            "changed_canonical_relations": sorted(changed_relation_ids),
        }
        version = store.commit_ontology_version(
            run_id=run.run_id,
            processed_documents=len(processed_documents),
            changed_entities=sorted(affected_canonical_ids),
            changed_relations=sorted(changed_relation_ids),
            manifest=version_manifest,
            change_events=run_change_events,
        )
        version_id = version.version_id
        exports = store.export_active_graph(str(exports_dir))
        graph_json_path = exports.json_path
        graph_graphml_path = exports.graphml_path
        version_manifest.update(
            {
                "version_id": version_id,
                "graph_json_path": graph_json_path,
                "graph_graphml_path": graph_graphml_path,
            }
        )
        _write_json(run_dir / "version_manifest.json", version_manifest)

    reconciliation_report = {
        "run_id": run.run_id,
        "documents": reconciliation_reports,
        "classification_tasks": [task.model_dump(mode="json") for task in selected_tasks],
        "deferred_classification_tasks": [task.model_dump(mode="json") for task in deferred_tasks],
        "classification_reports": classification_reports,
    }
    _write_json(run_dir / "reconciliation_report.json", reconciliation_report)

    report = {
        "run_id": run.run_id,
        "version_id": version_id,
        "mode": mode,
        "input_root": input_root,
        "pipeline_config": str(Path(pipeline_config).resolve()) if pipeline_config else "",
        "preprocess_config": str(Path(resolved_preprocess_config).resolve()),
        "llm_enabled": llm_client.is_enabled() and config.ner.use_llm,
        "store_path": str(Path(config.storage.database_path).resolve()),
        "processed_documents": processed_documents,
        "skipped_documents": skipped_documents,
        "skipped_details": skipped_details,
        "documents_total": len(input_files),
        "documents_processed": len(processed_documents),
        "documents_skipped": len(skipped_documents),
        "affected_canonical_entities": sorted(affected_canonical_ids),
        "changed_canonical_relations": sorted(changed_relation_ids),
        "reclassified_canonical_entities": sorted(persisted_results.keys()),
        "deferred_canonical_entities": [task.canonical_id for task in deferred_tasks],
        "outputs": {
            "run_dir": str(run_dir),
            "graph_json_path": graph_json_path,
            "graph_graphml_path": graph_graphml_path,
            "reconciliation_report_path": str(run_dir / "reconciliation_report.json"),
            "version_manifest_path": str(run_dir / "version_manifest.json") if version_id else "",
        },
        "document_reports": document_reports,
        "classification_reports": classification_reports,
    }
    report_path = run_dir / "run_report.json"
    _write_json(report_path, report)
    store.complete_ingestion_run(
        run_id=run.run_id,
        status="completed",
        documents_total=len(input_files),
        documents_processed=len(processed_documents),
        documents_skipped=len(skipped_documents),
        manifest=report,
    )
    return OntologyRunResult(
        run_id=run.run_id,
        version_id=version_id,
        processed_documents=processed_documents,
        skipped_documents=skipped_documents,
        store_path=str(Path(config.storage.database_path).resolve()),
        graph_json_path=graph_json_path,
        graph_graphml_path=graph_graphml_path,
        report_path=str(report_path),
    )


def _run_preprocess_step(*, input_path: str, preprocess_config: str) -> tuple[str, dict[str, Any]]:
    from mm_denoise.config import load_config
    from mm_denoise.io_loaders import load_document, normalize_text_for_pipeline
    from mm_denoise.pipeline import run_pipeline as run_preprocess_pipeline

    cfg = load_config(preprocess_config)
    document = load_document(input_path, cfg.io.encoding_fallbacks)
    raw_text = normalize_text_for_pipeline(document.text)
    output = run_preprocess_pipeline(raw_text, cfg)
    report = {
        "input_path": str(document.path),
        "rule_removed_lines": output.rule_based.removed_lines,
        "rule_merged_wrap_lines": output.rule_based.merged_wrap_lines,
        "model_candidates": [
            {
                "name": item.name,
                "confidence": item.confidence,
                "notes": item.notes,
            }
            for item in output.model_outputs
        ],
        "model_arbitration": output.model_arbitration.chosen_name if output.model_arbitration else None,
    }
    return output.clean_text, report


def _classify_graph(*, graph, config: PipelineConfig, artifact_dir: Path) -> list[dict[str, Any]]:
    timeout_s = max(60.0, float(config.llm.get("timeout_s", 60.0)))
    try:
        ctx = multiprocessing.get_context("spawn")
        result_queue = ctx.Queue()
        process = ctx.Process(
            target=_classify_graph_worker,
            args=(graph.model_dump(mode="json"), config.model_dump(mode="json"), str(artifact_dir), result_queue),
        )
        process.start()
        process.join(timeout_s)
        if process.is_alive():
            process.terminate()
            process.join()
            return []
        try:
            payload = result_queue.get_nowait()
        except queue.Empty:
            return []
        if payload.get("ok"):
            return list(payload.get("results", []))
        return []
    except Exception:
        return _classify_graph_once(graph=graph, config=config, artifact_dir=artifact_dir)


def _classify_graph_worker(graph_payload: dict[str, Any], config_payload: dict[str, Any], artifact_dir: str, result_queue) -> None:
    try:
        ensure_local_imports()
        from ontology_negotiator.models import GraphInput

        config = PipelineConfig.model_validate(config_payload)
        graph = GraphInput.model_validate(graph_payload)
        results = _classify_graph_once(graph=graph, config=config, artifact_dir=Path(artifact_dir))
        result_queue.put({"ok": True, "results": results})
    except Exception as exc:  # pragma: no cover - defensive worker path
        result_queue.put({"ok": False, "error": f"{type(exc).__name__}: {exc}"})


def _classify_graph_once(*, graph, config: PipelineConfig, artifact_dir: Path) -> list[dict[str, Any]]:
    if not graph.nodes:
        return []

    ensure_local_imports()
    from langchain_openai import ChatOpenAI
    from ontology_negotiator import OntologyNegotiator

    llm = None
    llm_config = OpenRouterConfig.from_mapping(
        {
            **config.llm,
            "api_key_env": config.llm.get("api_key_env", "ONTOLOGY_OPENAI_API_KEY"),
            "model_env": config.llm.get("ontology_model_env", "ONTOLOGY_OPENAI_MODEL"),
            "base_url": config.llm.get("ontology_base_url", config.llm.get("base_url", "")),
            "model": config.llm.get("ontology_model", ""),
            "enabled": True,
        }
    )
    if llm_config.api_key and llm_config.model:
        llm = ChatOpenAI(
            model=llm_config.model,
            api_key=llm_config.api_key,
            base_url=llm_config.base_url,
            temperature=0,
            model_kwargs={"response_format": {"type": "json_object"}},
        )

    negotiator = OntologyNegotiator(
        llm=llm,
        artifact_root=config.dls.artifact_root or str(artifact_dir / "dls_artifacts"),
        config_path=config.dls.config_path,
    )
    results = negotiator.classify_graph(graph, max_concurrency=config.dls.max_concurrency)
    return [result.model_dump(mode="json") for result in results]


def _pick_result_for_canonical(canonical_id: str, results: list[dict[str, Any]]) -> dict[str, Any] | None:
    for result in results:
        if str(result.get("node_id", "")) == canonical_id:
            return result
    return results[0] if results else None


def _select_classification_tasks(
    *,
    store: OntologyStore,
    tasks,
    max_entities: int,
):
    ordered = sorted(tasks, key=lambda item: _classification_task_rank(store, item.canonical_id), reverse=True)
    if max_entities <= 0 or len(ordered) <= max_entities:
        return ordered, []
    return ordered[:max_entities], ordered[max_entities:]


def _classification_task_rank(store: OntologyStore, canonical_id: str) -> tuple[int, int]:
    entity = store.get_canonical_entity(canonical_id)
    if entity is None:
        return (0, 0)
    return (entity.mention_count, len(store.list_neighbor_relations(canonical_id)))


def _artifact_name_for_input(path: Path, content_hash: str) -> str:
    safe_stem = "".join(char if char.isalnum() or char in {"_", "-", "."} else "_" for char in path.stem)
    return f"{safe_stem}_{content_hash[:8]}"


def _hash_file(path: Path) -> str:
    digest = hashlib.sha1()
    digest.update(path.read_bytes())
    return digest.hexdigest()


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
