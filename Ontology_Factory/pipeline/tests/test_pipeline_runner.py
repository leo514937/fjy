from __future__ import annotations

import json
from pathlib import Path

import yaml
from ner.providers.base import RawEntityMention

from pipeline.runner import run_batch_pipeline, run_pipeline


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


def _fake_classify_graph(**kwargs):
    graph = kwargs["graph"]
    return [
        {
            "node_id": node.node_id,
            "info_name": node.name,
            "ontology_label": "类",
            "confidence": 0.75,
            "epistemology": {"l_mapping": "L1", "ran": node.description or node.name, "ti": node.name},
            "logic_trace": {"reasoning": "unit-test", "xiaogu_list": []},
        }
        for node in graph.nodes
    ]


class DeterministicProvider:
    def __init__(self, model_name: str = "unused") -> None:
        self.model_name = model_name

    def extract(self, text: str):
        mentions: list[RawEntityMention] = []
        for term, label in [("ESP8266", "TECH"), ("OneNet", "TECH"), ("溶氧", "TERM"), ("传感器", "TERM")]:
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


def test_run_pipeline_writes_version_and_exports(monkeypatch, tmp_path: Path) -> None:
    input_path = tmp_path / "sample.txt"
    input_path.write_text("溶氧传感器连接ESP8266并上报OneNet。", encoding="utf-8")
    preprocess_config = tmp_path / "preprocess.yaml"
    pipeline_config = tmp_path / "pipeline.yaml"
    _write_preprocess_config(preprocess_config)
    _write_pipeline_config(pipeline_config, preprocess_config, tmp_path / "store.sqlite3", tmp_path / "pipeline_outputs")

    monkeypatch.setattr("pipeline.runner._classify_graph", _fake_classify_graph)
    monkeypatch.setattr("pipeline.runner.HanLPNerProvider", DeterministicProvider)

    result = run_pipeline(
        str(input_path),
        preprocess_config=str(preprocess_config),
        pipeline_config=str(pipeline_config),
    )

    report = json.loads(Path(result.report_path).read_text(encoding="utf-8"))
    assert result.version_id
    assert Path(result.graph_json_path).exists()
    assert Path(result.graph_graphml_path).exists()
    assert report["documents_processed"] == 1
    assert report["reclassified_canonical_entities"]


def test_run_batch_pipeline_commits_one_version(monkeypatch, tmp_path: Path) -> None:
    input_dir = tmp_path / "docs"
    input_dir.mkdir()
    (input_dir / "a.txt").write_text("ESP8266 上传数据到 OneNet。", encoding="utf-8")
    (input_dir / "b.txt").write_text("溶氧传感器监测鱼缸。", encoding="utf-8")
    preprocess_config = tmp_path / "preprocess.yaml"
    pipeline_config = tmp_path / "pipeline.yaml"
    _write_preprocess_config(preprocess_config)
    _write_pipeline_config(pipeline_config, preprocess_config, tmp_path / "store.sqlite3", tmp_path / "pipeline_outputs")

    monkeypatch.setattr("pipeline.runner._classify_graph", _fake_classify_graph)
    monkeypatch.setattr("pipeline.runner.HanLPNerProvider", DeterministicProvider)

    result = run_batch_pipeline(
        str(input_dir),
        preprocess_config=str(preprocess_config),
        pipeline_config=str(pipeline_config),
    )

    report = json.loads(Path(result.report_path).read_text(encoding="utf-8"))
    assert result.version_id
    assert report["documents_processed"] == 2
    assert Path(result.graph_json_path).exists()


def test_canonical_reuse_skips_reclassification_when_signature_unchanged(monkeypatch, tmp_path: Path) -> None:
    first = tmp_path / "first.txt"
    second = tmp_path / "second.txt"
    first.write_text("ESP8266 上传数据到 OneNet。", encoding="utf-8")
    second.write_text("ESP8266 模块稳定运行。", encoding="utf-8")
    preprocess_config = tmp_path / "preprocess.yaml"
    pipeline_config = tmp_path / "pipeline.yaml"
    _write_preprocess_config(preprocess_config)
    _write_pipeline_config(pipeline_config, preprocess_config, tmp_path / "store.sqlite3", tmp_path / "pipeline_outputs")

    calls: list[int] = []

    def fake_classify(**kwargs):
        calls.append(len(kwargs["graph"].nodes))
        return _fake_classify_graph(**kwargs)

    monkeypatch.setattr("pipeline.runner._classify_graph", fake_classify)
    monkeypatch.setattr("pipeline.runner.HanLPNerProvider", DeterministicProvider)

    first_result = run_pipeline(
        str(first),
        preprocess_config=str(preprocess_config),
        pipeline_config=str(pipeline_config),
    )
    second_result = run_pipeline(
        str(second),
        preprocess_config=str(preprocess_config),
        pipeline_config=str(pipeline_config),
    )

    first_report = json.loads(Path(first_result.report_path).read_text(encoding="utf-8"))
    second_report = json.loads(Path(second_result.report_path).read_text(encoding="utf-8"))
    assert first_report["reclassified_canonical_entities"]
    assert first_report["reclassified_canonical_entities"]
    assert len(calls) == len(first_report["reclassified_canonical_entities"])


def test_duplicate_content_hash_is_skipped(monkeypatch, tmp_path: Path) -> None:
    input_path = tmp_path / "sample.txt"
    input_path.write_text("ESP8266 上传数据到 OneNet。", encoding="utf-8")
    preprocess_config = tmp_path / "preprocess.yaml"
    pipeline_config = tmp_path / "pipeline.yaml"
    _write_preprocess_config(preprocess_config)
    _write_pipeline_config(pipeline_config, preprocess_config, tmp_path / "store.sqlite3", tmp_path / "pipeline_outputs")

    monkeypatch.setattr("pipeline.runner._classify_graph", _fake_classify_graph)
    monkeypatch.setattr("pipeline.runner.HanLPNerProvider", DeterministicProvider)

    first_result = run_pipeline(
        str(input_path),
        preprocess_config=str(preprocess_config),
        pipeline_config=str(pipeline_config),
    )
    second_result = run_pipeline(
        str(input_path),
        preprocess_config=str(preprocess_config),
        pipeline_config=str(pipeline_config),
    )

    assert first_result.version_id
    second_report = json.loads(Path(second_result.report_path).read_text(encoding="utf-8"))
    assert second_report["documents_processed"] == 0
    assert second_report["documents_skipped"] == 1
