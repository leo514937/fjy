from __future__ import annotations

from entity_relation.schema import EntityRelation
from ner.schema import NerDocument, NerEntity
from ontology_store.models import CanonicalEntity

from pipeline.adapters import canonical_entity_to_graph, ner_document_to_graph


def test_ner_document_to_graph_builds_valid_graph_input() -> None:
    document = NerDocument(
        doc_id="doc-1",
        source_text="溶氧与ESP8266联动。",
        entities=[
            NerEntity(
                entity_id="ent_a",
                text="溶氧",
                normalized_text="溶氧",
                label="TERM",
                start=0,
                end=2,
                source_sentence="溶氧与ESP8266联动。",
                metadata={
                    "mentions": [{"text": "溶氧", "start": 0, "end": 2, "confidence": 0.9}],
                    "occurrence_count": 1,
                    "source_sentences": ["溶氧与ESP8266联动。"],
                    "normalization_notes": "",
                    "llm_enhanced": False,
                },
            )
        ],
    )

    graph = ner_document_to_graph(
        document,
        relations=[
            EntityRelation(
                relation_id="rel_1",
                source_entity_id="ent_a",
                target_entity_id="ent_a",
                source_text="溶氧",
                target_text="溶氧",
                relation_type="co_occurs_with",
                confidence=0.3,
                evidence_sentence="溶氧与ESP8266联动。",
                metadata={"symmetric": True},
            )
        ],
    )

    assert len(graph.nodes) == 1
    assert graph.nodes[0].node_id == "ent_a"
    assert graph.nodes[0].l_level == "L1"
    assert graph.nodes[0].properties["ner_label"] == "TERM"
    assert len(graph.edges) == 1


def test_canonical_entity_to_graph_builds_context_graph() -> None:
    graph = canonical_entity_to_graph(
        CanonicalEntity(
            canonical_id="can_a",
            normalized_key="esp8266::TECH",
            normalized_text="ESP8266",
            preferred_name="ESP8266",
            ner_label="TECH",
            mention_count=2,
            evidence_summary="ESP8266 上传 OneNet。",
        ),
        neighbors=[
            CanonicalEntity(
                canonical_id="can_b",
                normalized_key="onenet::TECH",
                normalized_text="OneNet",
                preferred_name="OneNet",
                ner_label="TECH",
                mention_count=1,
                evidence_summary="平台接收数据。",
            )
        ],
        relations=[
            {
                "source_canonical_id": "can_a",
                "target_canonical_id": "can_b",
                "relation_type": "reports_to",
            }
        ],
        mentions=[{"source_sentence": "ESP8266 上传 OneNet。"}],
    )

    assert len(graph.nodes) == 2
    assert graph.nodes[0].node_id == "can_a"
    assert len(graph.edges) == 1
    assert graph.edges[0].relation == "reports_to"
