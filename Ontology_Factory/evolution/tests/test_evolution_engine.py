from __future__ import annotations

from ner.schema import NerEntity
from ontology_store import OntologyStore, build_evidence_signature

from evolution import build_classification_tasks


def test_build_classification_tasks_skips_when_signature_unchanged(tmp_path) -> None:
    store = OntologyStore(str(tmp_path / "store.sqlite3"))
    entity = NerEntity(
        entity_id="ent_1",
        text="ESP8266",
        normalized_text="ESP8266",
        label="TECH",
        start=0,
        end=7,
        metadata={"occurrence_count": 1},
    )
    mention_map, _ = store.upsert_canonical_entities(
        run_id="run_1",
        entities=[entity],
        matched_entities={},
    )
    canonical = mention_map["ent_1"]
    evidence_signature = build_evidence_signature(
        normalized_key=canonical.normalized_key,
        relation_signatures=[],
    )
    store.save_entity_classification(
        run_id="run_1",
        canonical_id=canonical.canonical_id,
        result={
            "node_id": canonical.canonical_id,
            "info_name": canonical.preferred_name,
            "ontology_label": "私",
            "confidence": 0.8,
            "epistemology": {"l_mapping": "L1", "ran": "开发板实例", "ti": "实例"},
            "logic_trace": {"reasoning": "test", "xiaogu_list": []},
        },
        evidence_signature=evidence_signature,
        source_reason="unit-test",
    )

    tasks, _ = build_classification_tasks(
        run_id="run_2",
        store=store,
        candidate_canonical_ids=[canonical.canonical_id],
    )

    assert tasks == []
