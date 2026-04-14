from __future__ import annotations

import json
from pathlib import Path

import yaml
from ner.providers.base import RawEntityMention

from pipeline.runner import run_wiki_batch, run_wiki_pipeline


def _write_preprocess_config(path: Path) -> None:
    path.write_text(
        yaml.safe_dump(
            {
                "pipeline": {"conservative": True, "output": "clean_text"},
                "io": {"input_globs": ["*.txt"], "output_dir": "outputs", "encoding_fallbacks": ["utf-8"]},
                "models": {"enabled": False, "candidates": []},
            },
            allow_unicode=True,
        ),
        encoding="utf-8",
    )


def _write_pipeline_config(path: Path, preprocess_config: Path, store_path: Path, output_root: Path) -> None:
    path.write_text(
        yaml.safe_dump(
            {
                "preprocess": {"config_path": str(preprocess_config)},
                "ner": {"provider": "hanlp", "model_name": "unused", "use_llm": False},
                "llm": {"enabled": False},
                "dls": {"config_path": str(path.parent / "unused.toml"), "artifact_root": "", "max_concurrency": 1},
                "output": {"root_dir": str(output_root), "enable_cooccurrence_edges": False},
                "storage": {"enabled": True, "database_path": str(store_path)},
            },
            allow_unicode=True,
        ),
        encoding="utf-8",
    )


class DeterministicProvider:
    def __init__(self, model_name: str = "unused") -> None:
        self.model_name = model_name

    def extract(self, text: str):
        mentions: list[RawEntityMention] = []
        for term, label in [
            ("智能养鱼系统", "TERM"),
            ("ESP8266", "TECH"),
            ("OneNet", "TECH"),
            ("溶氧", "TERM"),
            ("传感器", "TERM"),
        ]:
            start = text.find(term)
            if start >= 0:
                mentions.append(
                    RawEntityMention(
                        text=term,
                        label=label,
                        start=start,
                        end=start + len(term),
                        confidence=0.9,
                    )
                )
        return mentions


def test_run_wiki_pipeline_writes_manifest_and_trace(monkeypatch, tmp_path: Path) -> None:
    input_path = tmp_path / "sample.txt"
    input_path.write_text("智能养鱼系统使用 ESP8266 连接 OneNet。溶氧传感器持续监测鱼缸。", encoding="utf-8")
    preprocess_config = tmp_path / "preprocess.yaml"
    pipeline_config = tmp_path / "pipeline.yaml"
    _write_preprocess_config(preprocess_config)
    _write_pipeline_config(pipeline_config, preprocess_config, tmp_path / "store.sqlite3", tmp_path / "pipeline_outputs")

    monkeypatch.setattr("pipeline.runner.HanLPNerProvider", DeterministicProvider)
    monkeypatch.setattr("pipeline.runner.workspace_root", lambda: tmp_path)

    result = run_wiki_pipeline(
        str(input_path),
        preprocess_config=str(preprocess_config),
        pipeline_config=str(pipeline_config),
    )

    report = json.loads(Path(result.report_path).read_text(encoding="utf-8"))
    manifest = json.loads(Path(result.page_manifest_path).read_text(encoding="utf-8"))
    trace = json.loads(Path(result.agent_trace_path).read_text(encoding="utf-8"))

    assert report["documents_processed"] == 1
    assert result.created_pages
    assert manifest
    assert trace
    assert list((tmp_path / "wiki").rglob("*.md"))
    assert any(item.get("doc_ref") for item in manifest)
    assert any(item.get("file_path") for item in manifest)
    doc_report = report["document_reports"][0]
    assert doc_report["relations_count"] >= 0
    assert Path(doc_report["relations_path"]).exists()
    assert doc_report["document_context"]["folder_path"] == str(tmp_path.resolve())
    assert Path(doc_report["llm_memory_path"]).exists()
    llm_memory = json.loads(Path(doc_report["llm_memory_path"]).read_text(encoding="utf-8"))
    assert llm_memory["topic_plan_last_exchange"]["phase"] == "topic_plan"
    assert llm_memory["page_llm_memory"][0]["resolved_page_title"]
    assert any(step.get("action_name") == "run_command" for step in trace)


def test_run_wiki_batch_processes_two_documents(monkeypatch, tmp_path: Path) -> None:
    input_dir = tmp_path / "docs"
    input_dir.mkdir()
    (input_dir / "a.txt").write_text("智能养鱼系统使用 ESP8266 连接 OneNet。", encoding="utf-8")
    (input_dir / "b.txt").write_text("溶氧传感器持续监测鱼缸，并把数据上传平台。", encoding="utf-8")
    preprocess_config = tmp_path / "preprocess.yaml"
    pipeline_config = tmp_path / "pipeline.yaml"
    _write_preprocess_config(preprocess_config)
    _write_pipeline_config(pipeline_config, preprocess_config, tmp_path / "store.sqlite3", tmp_path / "pipeline_outputs")

    monkeypatch.setattr("pipeline.runner.HanLPNerProvider", DeterministicProvider)
    monkeypatch.setattr("pipeline.runner.workspace_root", lambda: tmp_path)

    result = run_wiki_batch(
        str(input_dir),
        preprocess_config=str(preprocess_config),
        pipeline_config=str(pipeline_config),
    )

    report = json.loads(Path(result.report_path).read_text(encoding="utf-8"))
    assert report["documents_processed"] == 2
    assert Path(result.page_manifest_path).exists()
    assert Path(result.agent_trace_path).exists()
    assert list((tmp_path / "wiki").rglob("*.md"))
