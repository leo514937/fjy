from __future__ import annotations

import json
import sqlite3
from pathlib import Path

from ner.schema import NerEntity
from ontology_store import (
    OntologyStore,
    build_cache_key,
    build_canonical_relation_key,
    build_evidence_signature,
)


def test_store_persists_canonical_classification_and_exports_graph(tmp_path: Path) -> None:
    store = OntologyStore(str(tmp_path / "store.sqlite3"))
    entity = NerEntity(
        entity_id="ent_1",
        text="ESP8266",
        normalized_text="ESP8266",
        label="TECH",
        start=0,
        end=7,
        source_sentence="ESP8266 连接 OneNet。",
        metadata={"occurrence_count": 1},
    )
    mention_map, entity_events = store.upsert_canonical_entities(
        run_id="run_demo",
        entities=[entity],
        matched_entities={},
    )
    canonical = mention_map["ent_1"]
    evidence_signature = build_evidence_signature(
        normalized_key=canonical.normalized_key,
        relation_signatures=[],
    )
    store.save_entity_classification(
        run_id="run_demo",
        canonical_id=canonical.canonical_id,
        result={
            "node_id": canonical.canonical_id,
            "info_name": canonical.preferred_name,
            "ontology_label": "私",
            "confidence": 0.82,
            "epistemology": {"l_mapping": "L1", "ran": "开发板实例", "ti": "单个模块"},
            "logic_trace": {"reasoning": "测试", "xiaogu_list": []},
        },
        evidence_signature=evidence_signature,
        source_reason="unit-test",
    )
    version = store.commit_ontology_version(
        run_id="run_demo",
        processed_documents=1,
        changed_entities=[canonical.canonical_id],
        changed_relations=[],
        manifest={"processed_documents": ["doc.txt"]},
        change_events=entity_events,
    )
    exports = store.export_active_graph(str(tmp_path / "exports"))

    assert version.version_number == 1
    assert Path(exports.json_path).exists()
    assert Path(exports.graphml_path).exists()
    payload = json.loads(Path(exports.json_path).read_text(encoding="utf-8"))
    assert payload["nodes"][0]["canonical_id"] == canonical.canonical_id
    assert payload["nodes"][0]["ontology_label"] == "私"


def test_store_persists_canonical_relations(tmp_path: Path) -> None:
    store = OntologyStore(str(tmp_path / "store.sqlite3"))
    source = NerEntity(
        entity_id="ent_1",
        text="ESP8266",
        normalized_text="ESP8266",
        label="TECH",
        start=0,
        end=7,
        metadata={},
    )
    target = NerEntity(
        entity_id="ent_2",
        text="OneNet",
        normalized_text="OneNet",
        label="TECH",
        start=8,
        end=14,
        metadata={},
    )
    mention_map, _ = store.upsert_canonical_entities(
        run_id="run_demo",
        entities=[source, target],
        matched_entities={},
    )
    relation_map, relation_events = store.upsert_canonical_relations(
        run_id="run_demo",
        relations=[
            {
                "relation_id": "rel_1",
                "source_entity_id": "ent_1",
                "target_entity_id": "ent_2",
                "relation_type": "reports_to",
                "confidence": 0.8,
                "evidence_sentence": "ESP8266 上报 OneNet。",
                "metadata": {"symmetric": False},
            }
        ],
        mention_to_canonical=mention_map,
    )

    source_canonical = mention_map["ent_1"].canonical_id
    target_canonical = mention_map["ent_2"].canonical_id
    relation_key = build_canonical_relation_key(source_canonical, target_canonical, "reports_to")
    canonical_relation = relation_map["rel_1"]

    assert canonical_relation.relation_key == relation_key
    assert any(event.event_type == "created_relation" for event in relation_events)


def test_store_migrates_legacy_tables(tmp_path: Path) -> None:
    database_path = tmp_path / "legacy.sqlite3"
    with sqlite3.connect(database_path) as connection:
        connection.executescript(
            """
            CREATE TABLE classified_entities (
                cache_key TEXT PRIMARY KEY,
                normalized_text TEXT NOT NULL,
                ner_label TEXT NOT NULL,
                ontology_label TEXT NOT NULL,
                confidence REAL NOT NULL,
                result_json TEXT NOT NULL,
                first_doc_id TEXT NOT NULL,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE relation_catalog (
                relation_cache_key TEXT PRIMARY KEY,
                source_cache_key TEXT NOT NULL,
                target_cache_key TEXT NOT NULL,
                relation_type TEXT NOT NULL,
                confidence REAL NOT NULL,
                evidence_sentence TEXT NOT NULL,
                metadata_json TEXT NOT NULL,
                first_doc_id TEXT NOT NULL,
                last_doc_id TEXT NOT NULL,
                mention_count INTEGER NOT NULL DEFAULT 1,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            """
        )
        cache_key = "esp8266::TECH"
        connection.execute(
            """
            INSERT INTO classified_entities (
                cache_key, normalized_text, ner_label, ontology_label, confidence, result_json, first_doc_id
            ) VALUES (?, 'ESP8266', 'TECH', '私', 0.9, ?, 'doc-1')
            """,
            (
                cache_key,
                json.dumps(
                    {
                        "node_id": "ent_legacy",
                        "info_name": "ESP8266",
                        "ontology_label": "私",
                        "confidence": 0.9,
                    },
                    ensure_ascii=False,
                ),
            ),
        )
        target_key = "onenet::TECH"
        connection.execute(
            """
            INSERT INTO classified_entities (
                cache_key, normalized_text, ner_label, ontology_label, confidence, result_json, first_doc_id
            ) VALUES (?, 'OneNet', 'TECH', '私', 0.8, ?, 'doc-1')
            """,
            (
                target_key,
                json.dumps(
                    {
                        "node_id": "ent_legacy2",
                        "info_name": "OneNet",
                        "ontology_label": "私",
                        "confidence": 0.8,
                    },
                    ensure_ascii=False,
                ),
            ),
        )
        connection.execute(
            """
            INSERT INTO relation_catalog (
                relation_cache_key, source_cache_key, target_cache_key, relation_type, confidence,
                evidence_sentence, metadata_json, first_doc_id, last_doc_id, mention_count
            ) VALUES (?, ?, ?, 'reports_to', 0.8, 'ESP8266 上报 OneNet。', '{}', 'doc-1', 'doc-1', 1)
            """,
            ("legacy_rel", cache_key, target_key),
        )

    store = OntologyStore(str(database_path))
    entity = NerEntity(
        entity_id="ent_new",
        text="ESP8266",
        normalized_text="ESP8266",
        label="TECH",
        start=0,
        end=7,
        metadata={},
    )
    cached = store.load_cached_classifications([entity])

    assert build_cache_key(entity) in cached
    assert cached[build_cache_key(entity)].ontology_result["ontology_label"] == "私"
    assert store.list_canonical_entities()
    assert store.list_neighbor_relations(store.list_canonical_entities()[0].canonical_id)
