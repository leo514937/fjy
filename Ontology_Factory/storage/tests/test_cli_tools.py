from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

pytestmark = pytest.mark.skipif(sys.version_info[:2] < (3, 10), reason="storage CLI tests require Python 3.10+")

if sys.version_info[:2] >= (3, 10):
    from ner.schema import NerEntity
    from ontology_core.cli import main as ontology_search_main
    from ontology_negotiator.cli import main as dls_cli_main
    from ontology_store import OntologyStore
    from ontology_store.cli import main as storage_cli_main
else:  # pragma: no cover - test module placeholders for skipped environments
    NerEntity = None
    ontology_search_main = None
    dls_cli_main = None
    OntologyStore = None
    storage_cli_main = None


def _seed_store(database_path: Path) -> OntologyStore:
    store = OntologyStore(str(database_path))
    entity = NerEntity(
        entity_id="ent_demo",
        text="光照",
        normalized_text="光照",
        label="TERM",
        start=0,
        end=2,
        confidence=0.95,
        source_sentence="系统会自动调节光照。",
        metadata={"occurrence_count": 2},
    )
    store.persist_entity_mentions(document_id="doc_demo", doc_id="doc_demo", entities=[entity])
    mention_map, _ = store.upsert_canonical_entities(run_id="run_demo", entities=[entity], matched_entities={})
    canonical = mention_map[entity.entity_id]
    store.link_entity_mentions({entity.entity_id: canonical.canonical_id})
    store.save_entity_classification(
        run_id="run_demo",
        canonical_id=canonical.canonical_id,
        result={"ontology_label": "类", "confidence": 0.91, "node_id": canonical.canonical_id, "info_name": canonical.preferred_name},
        evidence_signature="demo-signature",
        source_reason="unit-test",
    )
    page = store.create_page(title="光照", slug="光照", page_type="entity", layer="domain", doc_ref="domain:光照", file_path="/tmp/wiki/domain/光照.md")
    store.create_revision(page_id=page.page_id, run_id="run_demo", content_markdown="# 光照\n\n测试内容", summary="测试摘要")
    return store


def test_storage_cli_query_entities(tmp_path: Path, capsys) -> None:
    database_path = tmp_path / "store.sqlite3"
    _seed_store(database_path)

    exit_code = storage_cli_main(
        [
            "query",
            "--database",
            str(database_path),
            "--kind",
            "entities",
            "--query",
            "光照",
            "--stdout",
        ]
    )

    assert exit_code == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["kind"] == "entities"
    assert payload["items"][0]["entity"]["preferred_name"] == "光照"
    assert payload["items"][0]["classification"]["ontology_label"] == "类"


def test_ontology_core_cli_search_includes_mentions(tmp_path: Path, capsys) -> None:
    database_path = tmp_path / "store.sqlite3"
    _seed_store(database_path)

    exit_code = ontology_search_main(
        [
            "search",
            "--database",
            str(database_path),
            "--query",
            "光照",
            "--include-mentions",
            "--stdout",
        ]
    )

    assert exit_code == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["items"][0]["entity"]["preferred_name"] == "光照"
    assert payload["items"][0]["classification"]["ontology_label"] == "类"
    assert payload["items"][0]["mentions"]


def test_dls_cli_classify_uses_graph_file(monkeypatch, tmp_path: Path, capsys) -> None:
    graph_path = tmp_path / "graph.json"
    graph_path.write_text(
        json.dumps(
            {
                "nodes": [
                    {"node_id": "n1", "name": "光照", "l_level": "L1", "description": "测试节点", "properties": {}}
                ],
                "edges": [],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    class FakeResult:
        def model_dump(self, mode: str = "json") -> dict[str, object]:
            return {"node_id": "n1", "info_name": "光照", "ontology_label": "类", "confidence": 0.88}

    class FakeNegotiator:
        def __init__(self, **kwargs) -> None:
            self.kwargs = kwargs

        def classify_graph(self, graph, max_concurrency: int = 1):
            return [FakeResult()]

        def classify_node(self, node_id: str, graph):
            return FakeResult(), None

    monkeypatch.setattr("ontology_negotiator.cli.OntologyNegotiator", FakeNegotiator)

    exit_code = dls_cli_main(["classify", "--graph", str(graph_path), "--stdout"])

    assert exit_code == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["mode"] == "graph"
    assert payload["results"][0]["ontology_label"] == "类"
