from __future__ import annotations

from entity_relation.schema import EntityRelation, RelationDocument
from ner.schema import NerDocument, NerEntity
from ontology_core import reconcile_document
from ontology_store import OntologyStore


def test_reconcile_document_creates_canonical_entities_and_relations(tmp_path) -> None:
    store = OntologyStore(str(tmp_path / "store.sqlite3"))
    document = NerDocument(
        doc_id="doc-1",
        source_text="ESP8266 上传 OneNet。",
        entities=[
            NerEntity(
                entity_id="ent_1",
                text="ESP8266",
                normalized_text="ESP8266",
                label="TECH",
                start=0,
                end=7,
                source_sentence="ESP8266 上传 OneNet。",
                metadata={"occurrence_count": 1},
            ),
            NerEntity(
                entity_id="ent_2",
                text="OneNet",
                normalized_text="OneNet",
                label="TECH",
                start=11,
                end=17,
                source_sentence="ESP8266 上传 OneNet。",
                metadata={"occurrence_count": 1},
            ),
        ],
    )
    relation_document = RelationDocument(
        doc_id="doc-1",
        relations=[
            EntityRelation(
                relation_id="rel_1",
                source_entity_id="ent_1",
                target_entity_id="ent_2",
                source_text="ESP8266",
                target_text="OneNet",
                relation_type="reports_to",
                confidence=0.8,
                evidence_sentence="ESP8266 上传 OneNet。",
            )
        ],
    )
    store.record_document(
        source_path="doc-1.txt",
        doc_name="doc-1",
        content_hash="hash-1",
        clean_text_path="clean.txt",
        run_id="run_1",
        report_json={},
    )
    store.persist_entity_mentions(document_id="doc_fake", doc_id="doc-1", entities=document.entities)
    store.persist_relation_mentions(
        document_id="doc_fake",
        doc_id="doc-1",
        relations=[relation.model_dump(mode="json") for relation in relation_document.relations],
    )

    result = reconcile_document(
        run_id="run_1",
        document_id="doc_fake",
        ner_document=document,
        relation_document=relation_document,
        store=store,
        llm_client=None,
    )

    assert len(result.mention_to_canonical) == 2
    assert result.changed_canonical_relation_ids
